"""Tests for the inland-wetland PostGIS ingestion (Phase 1B-1).

Every unit fixture is SYNTHETIC (built with pyshp in ``tmp_path``); the real
국립생태원 dataset is Git-ignored local data and is never read or committed by this
suite. The PostGIS persistence tests require a real PostgreSQL/PostGIS database
(``TEST_DATABASE_URL``), use an isolated dataset identity so they never touch a
real release, and clean up after themselves.
"""

from __future__ import annotations

import datetime
import hashlib
import os
from collections.abc import Iterator, Sequence
from pathlib import Path

import pytest
import shapefile  # pyshp
import shapely
from shapely.geometry.multipolygon import MultiPolygon
from shapely.geometry.polygon import Polygon

from waste_equity_ingestion.wetland_inventory_ingestion import (
    DECLARED_FEATURE_COUNT,
    LAYER_NAME,
    REFERENCE_DATE,
    SOURCE_CRS,
    SOURCE_ID,
    TARGET_SRID,
    TRANSFORMATION_VERSION,
    NormalizedWetlandFeature,
    WetlandIngestionError,
    collect_source_anomaly_warnings,
    iter_normalized_features,
    normalize_source_geometry,
    promote_to_multipolygon,
    run_wetland_inventory_ingestion,
    wetland_feature_fingerprint,
)

PRJ_5186 = (
    'PROJCS["Korea_2000_Korea_Central_Belt_2010",GEOGCS["GCS_Korea_2000",'
    'DATUM["D_Korea_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],'
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
    'PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],'
    'PARAMETER["False_Northing",600000.0],PARAMETER["Central_Meridian",127.0],'
    'PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],'
    'UNIT["Meter",1.0]]'
)
PRJ_5187 = PRJ_5186.replace("Central_Belt", "East_Belt").replace(
    'PARAMETER["Central_Meridian",127.0]', 'PARAMETER["Central_Meridian",129.0]'
)

SQUARE_A = [(200000.0, 500000.0), (200400.0, 500000.0), (200400.0, 500400.0), (200000.0, 500400.0)]
SQUARE_B = [(210000.0, 500000.0), (210500.0, 500000.0), (210500.0, 500500.0), (210000.0, 500500.0)]
BOWTIE = [(230000.0, 500000.0), (230400.0, 500400.0), (230400.0, 500000.0), (230000.0, 500400.0)]

# One synthetic record: (CODE, NAME, TYPE, TYPE_KOREA, TYPE_RAMSA, RI_NM, EXP).
Record = tuple[str, str, str, str, str, str, str]
DEFAULT_RECORDS: tuple[Record, ...] = (
    ("12-345678-2-001", "가야습지", "하천습지", "R4", "Tp", "거산리", ""),
    ("12-345678-3-002", "나루습지", "호수습지", "L3", "Xp", "", "습지보호지역(환경부지정)"),
)


def _ring(points: Sequence[tuple[float, float]]) -> list[list[float]]:
    """Close a ring in clockwise order — the shapefile outer-ring convention."""

    closed = [list(p) for p in reversed(points)]
    closed.append(list(points[-1]))
    return closed


def write_source(
    directory: Path,
    *,
    stem: str = "Wetlands_Fixture",
    prj: str | None = PRJ_5186,
    cpg: str | None = "UTF-8",
    encoding: str = "utf-8",
    records: Sequence[Record] = DEFAULT_RECORDS,
    rings: Sequence[Sequence[tuple[float, float]]] | None = None,
    drop_field: str | None = None,
) -> Path:
    """Build a synthetic inventory-shaped shapefile and return its ``.shp``."""

    directory.mkdir(parents=True, exist_ok=True)
    base = directory / stem
    if rings is None:
        rings = [SQUARE_A, SQUARE_B][: len(records)]

    fields = [
        ("FID", "N", 4, 0),
        ("NAME", "C", 33, 0),
        ("CODE", "C", 15, 0),
        ("TYPE", "C", 254, 0),
        ("TYPE_KOREA", "C", 254, 0),
        ("TYPE_RAMSA", "C", 254, 0),
        ("AREA", "N", 10, 0),
        ("LONGITUDE", "N", 21, 10),
        ("LATITUDE", "N", 21, 10),
        ("ADDRESS", "C", 63, 0),
        ("SD_NN", "C", 21, 0),
        ("SGG_NM", "C", 254, 0),
        ("EMD_NM", "C", 254, 0),
        ("RI_NM", "C", 254, 0),
        ("EXP", "C", 254, 0),
    ]
    writer = shapefile.Writer(str(base), shapeType=shapefile.POLYGON, encoding=encoding)
    for name, ftype, size, decimal in fields:
        if name == drop_field:
            continue
        writer.field(name, ftype, size=size, decimal=decimal)

    for index, (record, ring) in enumerate(zip(records, rings, strict=True), start=1):
        code, wetland_name, wtype, korea, ramsar, ri, exp = record
        values = {
            "FID": index,
            "NAME": wetland_name,
            "CODE": code,
            "TYPE": wtype,
            "TYPE_KOREA": korea,
            "TYPE_RAMSA": ramsar,
            "AREA": 160000,
            "LONGITUDE": 127.0001,
            "LATITUDE": 37.1002,
            "ADDRESS": "경기도 수원시 팔달구 매산로",
            "SD_NN": "경기도",
            "SGG_NM": "수원시팔달구",
            "EMD_NM": "매산동",
            "RI_NM": ri,
            "EXP": exp,
        }
        writer.poly([_ring(ring)])
        writer.record(*[values[name] for name, *_ in fields if name != drop_field])
    writer.close()

    if prj is not None:
        base.with_suffix(".prj").write_text(prj, encoding="utf-8")
    if cpg is not None:
        base.with_suffix(".cpg").write_text(cpg, encoding="ascii")
    return base.with_suffix(".shp")


@pytest.fixture
def source(tmp_path: Path) -> Path:
    return write_source(tmp_path / "source")


def _read(shp: Path) -> list[NormalizedWetlandFeature]:
    features = []
    for _, feature, reason in iter_normalized_features(shp, source_checksum="deadbeef"):
        assert reason is None, reason
        assert feature is not None
        features.append(feature)
    return features


# --------------------------------------------------------------------------- #
# Source contract gating
# --------------------------------------------------------------------------- #


def test_source_schema_is_validated(tmp_path: Path) -> None:
    shp = write_source(tmp_path / "no_code", drop_field="EXP")

    with pytest.raises(WetlandIngestionError, match="missing column"):
        run_wetland_inventory_ingestion(source_shp=str(shp), write=False)


def test_wrong_crs_is_rejected(tmp_path: Path) -> None:
    """A different Korean belt must abort, naming both the found and expected EPSG."""

    shp = write_source(tmp_path / "east_belt", prj=PRJ_5187)

    with pytest.raises(WetlandIngestionError) as excinfo:
        run_wetland_inventory_ingestion(source_shp=str(shp), write=False)

    # The contract gate reports it first; either way the message is explicit
    # about what was found and what was required, and nothing was reprojected.
    message = str(excinfo.value)
    assert "EPSG:5187" in message
    assert "EPSG:5186" in message


def test_missing_sidecar_is_rejected(tmp_path: Path) -> None:
    shp = write_source(tmp_path / "no_prj")
    shp.with_suffix(".prj").unlink()

    with pytest.raises(WetlandIngestionError, match="Contract validation FAILED"):
        run_wetland_inventory_ingestion(source_shp=str(shp), write=False)


def test_missing_source_file_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(Exception, match="not found"):
        run_wetland_inventory_ingestion(source_shp=str(tmp_path / "absent.shp"), write=False)


def test_wrong_encoding_is_rejected(tmp_path: Path) -> None:
    """A CP949-declared source must be refused, not decoded under a guess."""

    shp = write_source(tmp_path / "cp949", encoding="cp949", cpg="CP949")

    with pytest.raises(WetlandIngestionError, match="Unexpected source encoding"):
        run_wetland_inventory_ingestion(source_shp=str(shp), write=False)


def test_utf8_korean_text_is_preserved(source: Path) -> None:
    features = _read(source)

    assert [f.wetland_name for f in features] == ["가야습지", "나루습지"]
    assert features[0].source_sido_name == "경기도"
    assert features[0].source_address == "경기도 수원시 팔달구 매산로"
    assert all("�" not in f.wetland_name for f in features)


# --------------------------------------------------------------------------- #
# Geometry normalization
# --------------------------------------------------------------------------- #


def test_polygon_is_promoted_to_multipolygon(source: Path) -> None:
    features = _read(source)

    assert all(isinstance(f.geometry_wgs84, MultiPolygon) for f in features)
    assert all(len(f.geometry_wgs84.geoms) == 1 for f in features)


def test_multipolygon_is_kept_as_multipolygon() -> None:
    parts = MultiPolygon([Polygon(SQUARE_A), Polygon(SQUARE_B)])

    normalized = normalize_source_geometry(parts)

    assert isinstance(normalized, MultiPolygon)
    assert len(normalized.geoms) == 2


def test_invalid_source_geometry_is_rejected_not_repaired() -> None:
    bowtie = Polygon(BOWTIE)
    assert not bowtie.is_valid

    with pytest.raises(WetlandIngestionError, match="Invalid source geometry"):
        normalize_source_geometry(bowtie)


def test_invalid_source_geometry_is_reported_per_record(tmp_path: Path) -> None:
    shp = write_source(
        tmp_path / "bowtie",
        records=(
            DEFAULT_RECORDS[0],
            ("12-345678-2-003", "뒤틀린습지", "하천습지", "R4", "Tp", "", ""),
        ),
        rings=[SQUARE_A, BOWTIE],
    )

    results = list(iter_normalized_features(shp, source_checksum="deadbeef"))

    assert len(results) == 2
    assert results[0][1] is not None and results[0][2] is None
    assert results[1][1] is None
    assert "Invalid source geometry" in (results[1][2] or "")


def test_empty_and_nonpolygonal_geometry_are_rejected() -> None:
    with pytest.raises(WetlandIngestionError, match="Empty geometry"):
        promote_to_multipolygon(Polygon())
    with pytest.raises(WetlandIngestionError, match="Unexpected geometry type"):
        promote_to_multipolygon(Polygon(SQUARE_A).exterior)


def test_area_is_measured_in_projected_source_crs(source: Path) -> None:
    features = _read(source)

    # 400 m and 500 m squares measured in EPSG:5186 metres, not 4326 degrees.
    assert features[0].geometry_area_m2 == pytest.approx(400 * 400)
    assert features[1].geometry_area_m2 == pytest.approx(500 * 500)


def test_geometry_is_reprojected_to_wgs84(source: Path) -> None:
    features = _read(source)

    minx, miny, maxx, maxy = features[0].geometry_wgs84.bounds
    assert 126.0 < minx < 128.0
    assert 36.0 < miny < 38.0
    assert maxx > minx and maxy > miny


# --------------------------------------------------------------------------- #
# Fingerprint
# --------------------------------------------------------------------------- #


def test_fingerprint_is_deterministic(source: Path) -> None:
    first = _read(source)
    second = _read(source)

    assert [f.feature_fingerprint for f in first] == [f.feature_fingerprint for f in second]
    assert len({f.feature_fingerprint for f in first}) == 2


def test_fingerprint_changes_with_identity_and_geometry() -> None:
    geometry = MultiPolygon([Polygon(SQUARE_A)])
    base = wetland_feature_fingerprint(
        geometry,
        source_feature_id="A",
        source_checksum="c1",
        reference_date=REFERENCE_DATE,
        transformation_version=TRANSFORMATION_VERSION,
    )

    assert base != wetland_feature_fingerprint(
        geometry,
        source_feature_id="B",
        source_checksum="c1",
        reference_date=REFERENCE_DATE,
        transformation_version=TRANSFORMATION_VERSION,
    )
    assert base != wetland_feature_fingerprint(
        geometry,
        source_feature_id="A",
        source_checksum="c2",
        reference_date=REFERENCE_DATE,
        transformation_version=TRANSFORMATION_VERSION,
    )
    assert base != wetland_feature_fingerprint(
        geometry,
        source_feature_id="A",
        source_checksum="c1",
        reference_date=datetime.date(2030, 1, 1),
        transformation_version=TRANSFORMATION_VERSION,
    )
    assert base != wetland_feature_fingerprint(
        MultiPolygon([Polygon(SQUARE_B)]),
        source_feature_id="A",
        source_checksum="c1",
        reference_date=REFERENCE_DATE,
        transformation_version=TRANSFORMATION_VERSION,
    )


def test_fingerprint_is_independent_of_ring_order() -> None:
    forward = MultiPolygon([Polygon(SQUARE_A)])
    reversed_ring = MultiPolygon([Polygon(list(reversed(SQUARE_A)))])

    assert shapely.normalize(forward).equals(shapely.normalize(reversed_ring))
    kwargs = {
        "source_feature_id": "A",
        "source_checksum": "c1",
        "reference_date": REFERENCE_DATE,
        "transformation_version": TRANSFORMATION_VERSION,
    }
    assert wetland_feature_fingerprint(forward, **kwargs) == wetland_feature_fingerprint(
        reversed_ring, **kwargs
    )


# --------------------------------------------------------------------------- #
# Source-value preservation
# --------------------------------------------------------------------------- #


def test_raw_attributes_preserve_every_source_column(source: Path) -> None:
    features = _read(source)

    raw = features[0].raw_attributes
    assert set(raw) == {
        "FID",
        "NAME",
        "CODE",
        "TYPE",
        "TYPE_KOREA",
        "TYPE_RAMSA",
        "AREA",
        "LONGITUDE",
        "LATITUDE",
        "ADDRESS",
        "SD_NN",
        "SGG_NM",
        "EMD_NM",
        "RI_NM",
        "EXP",
    }
    assert raw["NAME"] == "가야습지"
    assert raw["TYPE_RAMSA"] == "Tp"


def test_empty_ri_and_exp_become_null_not_empty_string(source: Path) -> None:
    features = _read(source)

    assert features[0].source_ri_name == "거산리"
    assert features[0].designation_note is None  # EXP empty in the source
    assert features[1].source_ri_name is None  # RI_NM empty in the source
    assert features[1].designation_note == "습지보호지역(환경부지정)"


def test_reported_lonlat_is_metadata_not_geometry(source: Path) -> None:
    features = _read(source)

    assert features[0].source_longitude == pytest.approx(127.0001)
    assert features[0].source_latitude == pytest.approx(37.1002)
    # The stored geometry is the polygon, not the reported point.
    assert features[0].geometry_wgs84.geom_type == "MultiPolygon"


def test_reported_area_is_kept_separate_from_measured_area(source: Path) -> None:
    features = _read(source)

    assert features[0].reported_area_m2 == 160000
    assert features[0].geometry_area_m2 == pytest.approx(160000)
    assert features[1].reported_area_m2 == 160000
    # The provider figure is NOT overwritten by the measured value.
    assert features[1].geometry_area_m2 == pytest.approx(250000)


def test_type_codes_are_preserved_exactly(tmp_path: Path) -> None:
    shp = write_source(
        tmp_path / "codes",
        records=(
            ("12-345678-2-001", "가야습지", "하천습지", "하도습지", "TP", "", ""),
            ("12-345678-3-002", "나루습지", "호수습지", "L3", "Tp", "", ""),
        ),
    )

    features = _read(shp)

    # The anomalous label is stored verbatim, and TP/Tp are not folded together.
    assert features[0].wetland_type_korea == "하도습지"
    assert {f.wetland_type_ramsar for f in features} == {"TP", "Tp"}


def test_source_anomalies_are_warned_about_not_corrected(tmp_path: Path) -> None:
    shp = write_source(
        tmp_path / "anomalies",
        records=(
            ("12-345678-2-001", "가야습지", "하천습지", "하도습지", "TP", "", ""),
            ("12-345678-3-002", "나루습지", "호수습지", "L3", "Tp", "", ""),
        ),
    )

    warnings = collect_source_anomaly_warnings(_read(shp))

    assert any("TYPE_KOREA" in w for w in warnings)
    assert any("TYPE_RAMSA" in w and "case variants" in w for w in warnings)


def test_source_files_are_not_mutated(source: Path) -> None:
    before = {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(source.parent.iterdir())
    }

    run_wetland_inventory_ingestion(source_shp=str(source), write=False)
    run_wetland_inventory_ingestion(source_shp=str(source), write=False)

    after = {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(source.parent.iterdir())
    }
    assert after == before


# --------------------------------------------------------------------------- #
# Structured result
# --------------------------------------------------------------------------- #


def test_dry_run_reports_structured_result_without_writing(source: Path) -> None:
    report = run_wetland_inventory_ingestion(source_shp=str(source), write=False)
    summary = report.sanitized_summary()

    assert report.mode == "dry-run"
    assert report.status == "SUCCEEDED"
    assert report.total_feature_count == 2
    assert report.inserted_count == 0
    assert report.skipped_count == 2
    assert report.rejected_count == 0
    assert report.dataset_version_id is None
    assert summary["layer_name"] == LAYER_NAME
    assert summary["source_crs"] == SOURCE_CRS
    assert summary["transformation_version"] == TRANSFORMATION_VERSION
    assert summary["source_filename"] == source.name
    # Sanitized: no local path, no per-record source values.
    serialized = str(summary)
    assert str(source.parent) not in serialized
    assert "가야습지" not in serialized


def test_declared_count_mismatch_is_warned(source: Path) -> None:
    report = run_wetland_inventory_ingestion(source_shp=str(source), write=False)

    assert report.declared_feature_count == DECLARED_FEATURE_COUNT
    assert any("declares" in w for w in report.warnings)


def test_duplicate_code_is_reported_by_the_contract_gate(tmp_path: Path) -> None:
    shp = write_source(
        tmp_path / "dupes",
        records=(
            ("12-345678-2-001", "가야습지", "하천습지", "R4", "Tp", "", ""),
            ("12-345678-2-001", "나루습지", "호수습지", "L3", "Xp", "", ""),
        ),
    )

    with pytest.raises(WetlandIngestionError, match="Contract validation FAILED"):
        run_wetland_inventory_ingestion(source_shp=str(shp), write=False)


# --------------------------------------------------------------------------- #
# PostGIS persistence (requires TEST_DATABASE_URL)
# --------------------------------------------------------------------------- #

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
_ISOLATED_CHECKSUM_PREFIX = "test-wetland-"


def _reset_db_caches() -> None:
    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    from waste_equity_backend.config import get_settings
    from waste_equity_backend.db import get_engine, get_sessionmaker

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()
    return None


@pytest.fixture
def db_session() -> Iterator[object]:
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL is not configured")
    _reset_db_caches()
    from waste_equity_backend.db import get_sessionmaker

    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()


def _cleanup(session: object, version_ids: Sequence[int]) -> None:
    from sqlalchemy import text as sa_text

    for version_id in version_ids:
        session.execute(  # type: ignore[attr-defined]
            sa_text(
                "DELETE FROM environmental_wetland_inventory_features WHERE dataset_version_id = :v"
            ),
            {"v": version_id},
        )
        session.execute(  # type: ignore[attr-defined]
            sa_text("DELETE FROM environmental_dataset_versions WHERE id = :v"),
            {"v": version_id},
        )
    session.commit()  # type: ignore[attr-defined]


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")
def test_ingestion_is_idempotent_against_postgis(source: Path, db_session: object) -> None:
    from sqlalchemy import text as sa_text

    first = run_wetland_inventory_ingestion(source_shp=str(source), write=True)
    version_id = first.dataset_version_id
    assert version_id is not None
    try:
        assert first.inserted_count == 2
        assert first.skipped_count == 0
        assert first.rejected_count == 0
        assert first.dataset_version_created is True

        second = run_wetland_inventory_ingestion(source_shp=str(source), write=True)
        assert second.dataset_version_id == version_id
        assert second.dataset_version_created is False
        assert second.inserted_count == 0
        assert second.skipped_count == 2
        assert second.rejected_count == 0

        rows = db_session.execute(  # type: ignore[attr-defined]
            sa_text(
                "SELECT count(*) AS n, count(DISTINCT source_feature_id) AS ids, "
                "count(DISTINCT ST_SRID(geometry)) AS srids, "
                "min(ST_SRID(geometry)) AS srid, "
                "count(DISTINCT ST_GeometryType(geometry)) AS gtypes, "
                "min(ST_GeometryType(geometry)) AS gtype "
                "FROM environmental_wetland_inventory_features "
                "WHERE dataset_version_id = :v"
            ),
            {"v": version_id},
        ).one()
        assert rows.n == 2
        assert rows.ids == 2
        assert rows.srids == 1
        assert rows.srid == TARGET_SRID
        assert rows.gtypes == 1
        assert rows.gtype == "ST_MultiPolygon"

        provenance = db_session.execute(  # type: ignore[attr-defined]
            sa_text(
                "SELECT layer_name, source_id, source_crs, target_crs, source_encoding, "
                "transformation_version, reference_date, is_active "
                "FROM environmental_dataset_versions WHERE id = :v"
            ),
            {"v": version_id},
        ).one()
        assert provenance.layer_name == LAYER_NAME
        assert provenance.source_id == SOURCE_ID
        assert provenance.source_crs == SOURCE_CRS
        assert provenance.target_crs == "EPSG:4326"
        assert provenance.source_encoding == "UTF-8"
        assert provenance.transformation_version == TRANSFORMATION_VERSION
        assert provenance.reference_date == REFERENCE_DATE
        assert provenance.is_active is True
    finally:
        _cleanup(db_session, [version_id])


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")
def test_ingestion_leaves_um901_and_suitability_untouched(source: Path, db_session: object) -> None:
    from sqlalchemy import text as sa_text

    def counts() -> tuple[int, int, int]:
        row = db_session.execute(  # type: ignore[attr-defined]
            sa_text(
                "SELECT (SELECT count(*) FROM structural_protected_features) AS protected, "
                "(SELECT count(*) FROM suitability_candidates) AS candidates, "
                "(SELECT count(*) FROM suitability_analysis_runs) AS runs"
            )
        ).one()
        return row.protected, row.candidates, row.runs

    before = counts()
    report = run_wetland_inventory_ingestion(source_shp=str(source), write=True)
    version_id = report.dataset_version_id
    assert version_id is not None
    try:
        assert counts() == before
    finally:
        _cleanup(db_session, [version_id])


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")
def test_failed_ingestion_rolls_back_and_writes_no_features(
    source: Path, db_session: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failure mid-load must leave no release and no features behind."""

    from sqlalchemy import text as sa_text

    import waste_equity_ingestion.wetland_inventory_ingestion as module

    def _boom(*args: object, **kwargs: object) -> None:
        raise RuntimeError("simulated failure during load")

    monkeypatch.setattr(module._BatchWriter, "finish", _boom)

    before = db_session.execute(  # type: ignore[attr-defined]
        sa_text("SELECT count(*) FROM environmental_wetland_inventory_features")
    ).scalar()
    versions_before = db_session.execute(  # type: ignore[attr-defined]
        sa_text("SELECT count(*) FROM environmental_dataset_versions")
    ).scalar()

    with pytest.raises(RuntimeError, match="simulated failure"):
        run_wetland_inventory_ingestion(source_shp=str(source), write=True)

    db_session.commit()  # type: ignore[attr-defined]
    assert (
        db_session.execute(  # type: ignore[attr-defined]
            sa_text("SELECT count(*) FROM environmental_wetland_inventory_features")
        ).scalar()
        == before
    )
    assert (
        db_session.execute(  # type: ignore[attr-defined]
            sa_text("SELECT count(*) FROM environmental_dataset_versions")
        ).scalar()
        == versions_before
    )
    # The failure is visible in the run log, never silent.
    failed = db_session.execute(  # type: ignore[attr-defined]
        sa_text(
            "SELECT status FROM ingestion_runs WHERE source_id = :s ORDER BY run_id DESC LIMIT 1"
        ),
        {"s": SOURCE_ID},
    ).scalar()
    assert failed == "FAILED"
