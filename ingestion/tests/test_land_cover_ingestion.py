"""Tests for the land-cover PostGIS ingestion foundation (Phase 1B-LC1).

Every fixture is SYNTHETIC and clearly TEST-ONLY: shapefiles are built with pyshp
in ``tmp_path`` and are never represented as official data; the real 세분류 [2025]
토지피복지도 is Git-ignored local data and is never read or committed by this suite.
The PostGIS persistence tests require a real PostgreSQL/PostGIS database
(``TEST_DATABASE_URL``), use an isolated synthetic release, and clean up after
themselves.
"""

from __future__ import annotations

import datetime
import hashlib
import os
import shutil
from collections.abc import Iterator, Sequence
from pathlib import Path

import pytest
import shapefile  # pyshp
from pyproj import CRS, Transformer
from shapely.geometry import box
from shapely.geometry.collection import GeometryCollection
from shapely.geometry.linestring import LineString
from shapely.geometry.multipolygon import MultiPolygon
from shapely.geometry.polygon import Polygon

from waste_equity_ingestion import land_cover_ingestion as lc
from waste_equity_ingestion.land_cover_ingestion import (
    LandCoverIngestionError,
    coverage_against_boundaries,
    discover_sources,
    iter_sheet_features,
    plan_canonical_sheets,
    promote_to_multipolygon,
    repair_source_geometry,
    resolve_canonical_sheet,
    run_land_cover_ingestion,
)

# Central-Belt 2010 (EPSG:5186) ESRI WKT; names the Korea_2000 datum, resolves by
# TM parameters. EAST-Belt variant (5187) for the wrong-CRS test.
PRJ_5186 = (
    'PROJCS["Korea_2000_Korea_Central_Belt_2010",GEOGCS["GCS_Korea_2000",'
    'DATUM["D_Korea_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],'
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
    'PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],'
    'PARAMETER["False_Northing",600000.0],PARAMETER["Central_Meridian",127.0],'
    'PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],UNIT["Meter",1.0]]'
)
PRJ_5187 = PRJ_5186.replace("Central_Belt", "East_Belt").replace(
    'PARAMETER["Central_Meridian",127.0]', 'PARAMETER["Central_Meridian",129.0]'
)

SQUARE_A = [(200000.0, 500000.0), (200400.0, 500000.0), (200400.0, 500400.0), (200000.0, 500400.0)]
SQUARE_B = [(210000.0, 500000.0), (210500.0, 500000.0), (210500.0, 500500.0), (210000.0, 500500.0)]
BOWTIE = [(230000.0, 500000.0), (230400.0, 500400.0), (230400.0, 500000.0), (230000.0, 500400.0)]

# The 15-column authoritative DBF schema, as (name, dbf_type, width).
FIELDS: tuple[tuple[str, str, int], ...] = (
    ("L1_CODE", "C", 3),
    ("L1_NAME", "C", 25),
    ("L2_CODE", "C", 3),
    ("L2_NAME", "C", 25),
    ("L3_CODE", "C", 3),
    ("L3_NAME", "C", 25),
    ("IMG_NAME", "C", 25),
    ("IMG_DATE", "D", 8),
    ("LU_INFO", "C", 25),
    ("ETC_INFO", "C", 25),
    ("ENV_INFO", "C", 25),
    ("FOR_INFO", "C", 25),
    ("UD_INFO", "C", 25),
    ("INX_NUM", "C", 8),
    ("ANNO", "C", 254),
)
_IMG_DATE = datetime.date(2025, 11, 13)
# (L1_CODE, L1_NAME, L2_CODE, L2_NAME, L3_CODE, L3_NAME, INX_NUM). Verbatim Korean.
FOREST = ("300", "산림지역", "310", "활엽수림", "311", "활엽수림", "1")
CROPLAND = ("200", "농업지역", "210", "논", "211", "경지정리답", "2")

Record = tuple[str, str, str, str, str, str, str]
Rings = Sequence[Sequence[tuple[float, float]]] | Sequence[tuple[float, float]]


def _ring(points: Sequence[tuple[float, float]]) -> list[list[float]]:
    closed = [list(p) for p in reversed(points)]
    closed.append(list(points[-1]))
    return closed


def _set_dbf_ldid(dbf: Path, ldid: int = 0x4E) -> None:
    """Force the DBF language-driver byte, as the official CP949 source ships it."""

    data = bytearray(dbf.read_bytes())
    data[29] = ldid
    dbf.write_bytes(bytes(data))


def write_sheet(
    tile_dir: Path,
    tile_id: str,
    *,
    records: Sequence[Record],
    rings: Sequence[Rings],
    prj: str | None = PRJ_5186,
    encoding: str = "cp949",
    ldid: int | None = 0x4E,
) -> Path:
    """Build one synthetic map-sheet shapefile set and return its ``.shp``."""

    tile_dir.mkdir(parents=True, exist_ok=True)
    base = tile_dir / tile_id
    writer = shapefile.Writer(str(base), shapeType=shapefile.POLYGON, encoding=encoding)
    for name, ftype, size in FIELDS:
        writer.field(name, ftype, size=size)
    for record, geom_rings in zip(records, rings, strict=True):
        if isinstance(geom_rings[0][0], (int, float)):  # single polygon ring
            writer.poly([_ring(geom_rings)])  # type: ignore[arg-type]
        else:  # multipolygon: several exterior rings
            writer.poly([_ring(r) for r in geom_rings])  # type: ignore[arg-type]
        l1c, l1n, l2c, l2n, l3c, l3n, inx = record
        writer.record(l1c, l1n, l2c, l2n, l3c, l3n, "img", _IMG_DATE, "", "", "", "", "", inx, "")
    writer.close()
    if prj is not None:
        base.with_suffix(".prj").write_text(prj, encoding="utf-8")
    if ldid is not None:
        _set_dbf_ldid(base.with_suffix(".dbf"), ldid)
    return base.with_suffix(".shp")


def _copy_sheet(src_dir: Path, dst_dir: Path) -> None:
    """Byte-for-byte copy of a shapefile set (a cross-region duplicate sheet)."""

    dst_dir.mkdir(parents=True, exist_ok=True)
    for entry in src_dir.iterdir():
        shutil.copy2(entry, dst_dir / entry.name)


def build_full_root(tmp_path: Path, *, conflicting_dup: bool = False) -> Path:
    """A complete 3-region synthetic acquisition that passes the contract gate.

    Includes a valid Polygon, a valid MultiPolygon, an invalid self-intersecting
    Polygon (needs MakeValid), Korean CP949 values, and a byte-identical
    cross-region duplicate sheet. With ``conflicting_dup`` the duplicate carries
    different geometry (a checksum conflict the loader must halt on).
    """

    root = tmp_path / "2025_lv3"
    write_sheet(
        root / "seoul" / "SG05_10000001_20251113",
        "10000001",
        records=(FOREST, CROPLAND, FOREST),
        rings=(SQUARE_A, (SQUARE_A, SQUARE_B), BOWTIE),
    )
    write_sheet(
        root / "incheon" / "SG05_20000002_20251113",
        "20000002",
        records=(CROPLAND,),
        rings=(SQUARE_B,),
    )
    write_sheet(
        root / "gyeonggi" / "SG05_30000003_20251113",
        "30000003",
        records=(FOREST,),
        rings=(SQUARE_A,),
    )
    # Cross-region duplicate sheet 40000004 (seoul + gyeonggi).
    dup_src = root / "seoul" / "SG05_40000004_20251113"
    write_sheet(dup_src, "40000004", records=(FOREST,), rings=(SQUARE_A,))
    dup_dst = root / "gyeonggi" / "SG05_40000004_20251113"
    if conflicting_dup:
        write_sheet(dup_dst, "40000004", records=(CROPLAND,), rings=(SQUARE_B,))
    else:
        _copy_sheet(dup_src, dup_dst)
    return root


@pytest.fixture
def full_root(tmp_path: Path) -> Path:
    return build_full_root(tmp_path)


def _transformer() -> Transformer:
    return Transformer.from_crs(CRS.from_epsg(5186), CRS.from_epsg(4326), always_xy=True)


def _read_sheet(root: Path, tile_id: str) -> list[lc.NormalizedLandCoverFeature]:
    sources = discover_sources(root)[0]
    sheet = resolve_canonical_sheet(tile_id, [s for s in sources if s.tile_id == tile_id])
    features: list[lc.NormalizedLandCoverFeature] = []
    for _index, feature, reason in iter_sheet_features(sheet, transformer=_transformer()):
        assert reason is None, reason
        assert feature is not None
        features.append(feature)
    return features


# --------------------------------------------------------------------------- #
# Source discovery, encoding, CRS
# --------------------------------------------------------------------------- #


def test_missing_source_root_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(Exception, match="not found"):
        run_land_cover_ingestion(source_root=str(tmp_path / "absent"), write=False)


def test_appledouble_and_dsstore_are_excluded(tmp_path: Path) -> None:
    root = build_full_root(tmp_path)
    tile_dir = root / "seoul" / "SG05_10000001_20251113"
    (tile_dir / "._10000001.shp").write_bytes(b"apple metadata")
    (tile_dir / ".DS_Store").write_bytes(b"ds")
    (root / "seoul" / ".DS_Store").write_bytes(b"ds")

    report = run_land_cover_ingestion(source_root=str(root), write=False, region="seoul")

    # Only the two real seoul sheets are processed; the Apple metadata is ignored.
    assert report.map_sheets_processed == 2


def test_strict_cp949_korean_is_preserved(full_root: Path) -> None:
    features = _read_sheet(full_root, "10000001")

    assert features[0].l1_name == "산림지역"
    assert features[0].l3_name == "활엽수림"
    assert features[1].l2_name == "논"
    assert all("�" not in (f.l1_name or "") for f in features)


def test_utf8_source_is_not_silently_accepted(tmp_path: Path) -> None:
    """A UTF-8-encoded sheet must not be decoded as if it were UTF-8.

    The loader forces strict CP949 (the wetland UTF-8 assumption would corrupt
    every Korean label). Under that decode a UTF-8 source either raises or yields
    mojibake — never the original Korean silently.
    """

    root = tmp_path / "2025_lv3"
    write_sheet(
        root / "seoul" / "SG05_10000001_20251113",
        "10000001",
        records=(FOREST,),
        rings=(SQUARE_A,),
        encoding="utf-8",
    )
    sources = discover_sources(root)[0]
    sheet = resolve_canonical_sheet("10000001", sources)
    try:
        features = [f for _, f, _ in iter_sheet_features(sheet, transformer=_transformer()) if f]
    except LandCoverIngestionError:
        return  # strict CP949 decode failure is the correct hard outcome
    assert features and features[0].l1_name != "산림지역"


def test_epsg5186_is_required_by_parameter_match(tmp_path: Path) -> None:
    root = tmp_path / "2025_lv3"
    write_sheet(
        root / "seoul" / "SG05_10000001_20251113",
        "10000001",
        records=(FOREST,),
        rings=(SQUARE_A,),
        prj=PRJ_5187,
    )
    with pytest.raises(LandCoverIngestionError, match="EPSG:5186"):
        run_land_cover_ingestion(
            source_root=str(root), write=False, region="seoul", map_sheet_ids=["10000001"]
        )


def test_always_xy_transform_lands_in_capital_region(full_root: Path) -> None:
    features = _read_sheet(full_root, "10000001")

    minx, miny, maxx, maxy = features[0].geometry_wgs84.bounds
    assert 126.0 < minx < 128.0
    assert 36.0 < miny < 38.0
    assert maxx > minx and maxy > miny


# --------------------------------------------------------------------------- #
# Reference period (year-only, no fabricated date)
# --------------------------------------------------------------------------- #


def test_reference_period_is_year_only_with_no_date(full_root: Path) -> None:
    report = run_land_cover_ingestion(source_root=str(full_root), write=False)

    assert report.reference_period == "2025"
    assert report.reference_date is None
    assert lc.REFERENCE_DATE is None
    assert report.sanitized_summary()["reference_date"] is None


# --------------------------------------------------------------------------- #
# Attribute preservation + geometry normalization
# --------------------------------------------------------------------------- #


def test_all_15_source_attributes_are_preserved(full_root: Path) -> None:
    features = _read_sheet(full_root, "10000001")

    assert set(features[0].raw_attributes) == set(lc.SOURCE_ATTRIBUTE_NAMES)
    assert len(lc.SOURCE_ATTRIBUTE_NAMES) == 15
    assert features[0].raw_attributes["L1_NAME"] == "산림지역"
    # Typed convenience columns mirror the source verbatim.
    assert features[0].l3_code == "311"


def test_polygon_is_promoted_to_multipolygon(full_root: Path) -> None:
    features = _read_sheet(full_root, "10000001")

    assert isinstance(features[0].geometry_wgs84, MultiPolygon)
    assert len(features[0].geometry_wgs84.geoms) == 1


def test_valid_geometry_is_not_altered(full_root: Path) -> None:
    features = _read_sheet(full_root, "10000001")

    valid = features[0]
    assert valid.repair.source_valid is True
    assert valid.repair.repair_status == "none"
    assert valid.repair.repair_method is None
    assert valid.repair.source_area_m2 is None
    # 400 m square measured in EPSG:5186 metres.
    assert valid.geometry_area_m2 == pytest.approx(400 * 400)


def test_invalid_self_intersection_is_repaired_with_makevalid(full_root: Path) -> None:
    features = _read_sheet(full_root, "10000001")

    repaired = features[2]  # the bowtie
    assert repaired.repair.source_valid is False
    assert repaired.repair.repair_status == "made_valid"
    assert repaired.repair.repair_method == "shapely.make_valid"
    assert "self-intersection" in (repaired.repair.invalidity_reason or "").lower()
    assert repaired.geometry_wgs84.geom_type == "MultiPolygon"
    assert repaired.geometry_wgs84.is_valid
    # Two 40 000 m² triangles.
    assert repaired.geometry_area_m2 == pytest.approx(80000)
    assert repaired.repair.source_area_m2 is not None
    assert repaired.repair.repaired_area_m2 is not None


def test_geometrycollection_polygon_extraction_is_audited() -> None:
    collection = GeometryCollection([Polygon(SQUARE_A), LineString([(0, 0), (1, 1)])])

    polygons, discarded = lc._polygonal_components(collection)

    assert len(polygons) == 1
    assert discarded == ["LineString"]


def test_no_polygon_after_makevalid_is_rejected() -> None:
    collinear = Polygon([(0.0, 0.0), (1.0, 1.0), (2.0, 2.0), (0.0, 0.0)])
    assert not collinear.is_valid

    with pytest.raises(LandCoverIngestionError, match="no polygonal geometry"):
        repair_source_geometry(collinear)


def test_empty_and_nonpolygonal_are_rejected() -> None:
    with pytest.raises(LandCoverIngestionError, match="Empty"):
        repair_source_geometry(Polygon())
    with pytest.raises(LandCoverIngestionError, match="Non-polygonal"):
        repair_source_geometry(LineString([(0, 0), (1, 1)]))


def test_multipolygon_source_is_kept_as_multipolygon(full_root: Path) -> None:
    features = _read_sheet(full_root, "10000001")

    multi = features[1]
    assert isinstance(multi.geometry_wgs84, MultiPolygon)
    assert len(multi.geometry_wgs84.geoms) == 2
    assert multi.geometry_area_m2 == pytest.approx(400 * 400 + 500 * 500)


def test_promote_normalizes_and_rejects_nonpolygonal() -> None:
    normalized = promote_to_multipolygon(Polygon(SQUARE_A))
    assert isinstance(normalized, MultiPolygon)
    with pytest.raises(LandCoverIngestionError):
        promote_to_multipolygon(LineString([(0, 0), (1, 1)]))


# --------------------------------------------------------------------------- #
# Fingerprints and stable identity
# --------------------------------------------------------------------------- #


def test_feature_identity_and_fingerprint_are_stable(full_root: Path) -> None:
    first = _read_sheet(full_root, "10000001")
    second = _read_sheet(full_root, "10000001")

    assert [f.source_record_index for f in first] == [0, 1, 2]
    assert [f.feature_fingerprint for f in first] == [f.feature_fingerprint for f in second]
    assert len({f.feature_fingerprint for f in first}) == 3
    assert all(len(f.source_geometry_fingerprint) == 64 for f in first)


def test_geometry_fingerprint_is_independent_of_ring_order() -> None:
    forward = MultiPolygon([Polygon(SQUARE_A)])
    reversed_ring = MultiPolygon([Polygon(list(reversed(SQUARE_A)))])
    kwargs = {
        "map_sheet_id": "1",
        "source_record_index": 0,
        "sheet_checksum": "c1",
        "reference_period": "2025",
        "transformation_version": "land-cover-v1",
    }

    assert lc.land_cover_feature_fingerprint(
        forward, **kwargs
    ) == lc.land_cover_feature_fingerprint(reversed_ring, **kwargs)


# --------------------------------------------------------------------------- #
# Duplicate map sheets
# --------------------------------------------------------------------------- #


def test_byte_identical_duplicate_is_loaded_once_with_full_provenance(full_root: Path) -> None:
    sources = discover_sources(full_root)[0]
    by_id, unique, duplicate = plan_canonical_sheets(sources)

    assert duplicate == 1
    sheet = resolve_canonical_sheet("40000004", by_id["40000004"])
    assert sheet.duplicate_classification == "byte_identical_cross_region"
    assert sheet.duplicate_occurrence_count == 2
    assert {occ["region"] for occ in sheet.occurrences} == {"seoul", "gyeonggi"}

    report = run_land_cover_ingestion(source_root=str(full_root), write=False)
    # 4 canonical sheets processed (the duplicate counted once); one occurrence
    # loaded-once.
    assert report.total_unique_sheets == 4
    assert report.map_sheets_processed == 4
    assert report.duplicate_occurrences_loaded_once == 1


def test_conflicting_duplicate_sheet_halts(tmp_path: Path) -> None:
    root = build_full_root(tmp_path, conflicting_dup=True)

    with pytest.raises(LandCoverIngestionError, match="distinct .shp checksums"):
        run_land_cover_ingestion(source_root=str(root), write=False)


# --------------------------------------------------------------------------- #
# Streaming, selectors, source safety
# --------------------------------------------------------------------------- #


def test_iter_sheet_features_streams_records(full_root: Path) -> None:
    sources = discover_sources(full_root)[0]
    sheet = resolve_canonical_sheet("10000001", [s for s in sources if s.tile_id == "10000001"])

    iterator = iter_sheet_features(sheet, transformer=_transformer())
    first = next(iterator)

    # A generator that yields per record — never a materialized list.
    assert first[0] == 0
    assert hasattr(iterator, "__next__")


def test_max_map_sheets_truncation_is_reported(full_root: Path) -> None:
    report = run_land_cover_ingestion(
        source_root=str(full_root), write=False, max_map_sheets=2, run_full_contract=False
    )

    assert report.map_sheets_selected == 2
    assert report.map_sheets_truncated == 2
    assert any("max-map-sheets" in w for w in report.warnings)


def test_source_files_are_not_mutated(full_root: Path) -> None:
    before = {
        path.relative_to(full_root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(full_root.rglob("*"))
        if path.is_file()
    }

    run_land_cover_ingestion(source_root=str(full_root), write=False)
    run_land_cover_ingestion(source_root=str(full_root), write=False, region="incheon")

    after = {
        path.relative_to(full_root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(full_root.rglob("*"))
        if path.is_file()
    }
    assert after == before


def test_dry_run_reports_structured_result_without_paths(full_root: Path) -> None:
    report = run_land_cover_ingestion(source_root=str(full_root), write=False)
    summary = report.sanitized_summary()

    assert report.mode == "dry-run"
    assert report.status == "SUCCEEDED"
    assert report.dataset_version_id is None
    assert summary["layer_name"] == "land_cover"
    assert summary["source_crs"] == "EPSG:5186"
    assert summary["transformation_version"] == "land-cover-v1"
    serialized = str(summary)
    assert str(full_root) not in serialized
    assert "산림지역" not in serialized


def test_partial_write_is_prohibited(full_root: Path) -> None:
    with pytest.raises(LandCoverIngestionError, match="filtered/partial --write is prohibited"):
        run_land_cover_ingestion(
            source_root=str(full_root),
            write=True,
            region="seoul",
            expected_manifest_sha256="whatever",
        )


def test_write_requires_expected_manifest_checksum(full_root: Path) -> None:
    with pytest.raises(LandCoverIngestionError, match="expected-manifest-sha256"):
        run_land_cover_ingestion(source_root=str(full_root), write=True)


# --------------------------------------------------------------------------- #
# Coverage-proof design (validated on fixtures; no invented tolerance)
# --------------------------------------------------------------------------- #


def test_coverage_reports_exact_areas_and_no_tolerance() -> None:
    footprints = [box(0.0, 0.0, 100.0, 100.0)]
    boundaries = {"11": box(0.0, 0.0, 200.0, 100.0)}

    result = coverage_against_boundaries(footprints, boundaries)

    region = result.per_region[0]
    assert region.coverage_ratio == pytest.approx(0.5)
    assert region.covered_area_m2 == pytest.approx(10000.0)
    assert region.uncovered_area_m2 == pytest.approx(10000.0)
    assert "UNRESOLVED" in result.tolerance_policy


def test_coverage_reports_footprint_overlap() -> None:
    footprints = [box(0.0, 0.0, 100.0, 100.0), box(50.0, 0.0, 150.0, 100.0)]
    boundaries = {"11": box(0.0, 0.0, 150.0, 100.0)}

    result = coverage_against_boundaries(footprints, boundaries)

    # 50×100 overlap between the two footprints.
    assert result.footprint_overlap_area_m2 == pytest.approx(5000.0)
    assert result.per_region[0].coverage_ratio == pytest.approx(1.0)


# --------------------------------------------------------------------------- #
# PostGIS persistence (requires TEST_DATABASE_URL)
# --------------------------------------------------------------------------- #

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


def _reset_db_caches() -> None:
    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    from waste_equity_backend.config import get_settings
    from waste_equity_backend.db import get_engine, get_sessionmaker

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()


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


def _aggregate_manifest(root: Path) -> str:
    from waste_equity_ingestion.land_cover_contract import validate_land_cover

    report = validate_land_cover(root)
    assert report.provenance is not None
    return report.provenance.aggregate_manifest_sha256


def _cleanup(session: object, version_ids: Sequence[int]) -> None:
    from sqlalchemy import text as sa_text

    for version_id in version_ids:
        for table in (
            "environmental_land_cover_features",
            "environmental_land_cover_map_sheets",
        ):
            session.execute(  # type: ignore[attr-defined]
                sa_text(f"DELETE FROM {table} WHERE dataset_version_id = :v"), {"v": version_id}
            )
        session.execute(  # type: ignore[attr-defined]
            sa_text("DELETE FROM environmental_dataset_versions WHERE id = :v"), {"v": version_id}
        )
    session.execute(  # type: ignore[attr-defined]
        sa_text("DELETE FROM dataset_freshness WHERE source_id = 'egis_land_cover'")
    )
    session.execute(  # type: ignore[attr-defined]
        sa_text("DELETE FROM ingestion_runs WHERE source_id = 'egis_land_cover'")
    )
    session.commit()  # type: ignore[attr-defined]


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")
def test_synthetic_first_write_and_idempotent_second_write(
    full_root: Path, db_session: object
) -> None:
    from sqlalchemy import text as sa_text

    manifest = _aggregate_manifest(full_root)
    first = run_land_cover_ingestion(
        source_root=str(full_root), write=True, expected_manifest_sha256=manifest
    )
    version_id = first.dataset_version_id
    assert version_id is not None
    try:
        # 6 accepted features across 4 canonical sheets (the duplicate loaded once).
        assert first.accepted_feature_count == 6
        assert first.inserted_feature_count == 6
        assert first.map_sheets_processed == 4
        assert first.inserted_map_sheet_count == 4
        assert first.dataset_version_created is True
        assert first.source_invalid_feature_count == 1
        assert first.repaired_feature_count == 1

        rows = db_session.execute(  # type: ignore[attr-defined]
            sa_text(
                "SELECT count(*) AS n, count(DISTINCT ST_SRID(geometry)) AS srids, "
                "min(ST_SRID(geometry)) AS srid, "
                "count(DISTINCT ST_GeometryType(geometry)) AS gtypes, "
                "min(ST_GeometryType(geometry)) AS gtype "
                "FROM environmental_land_cover_features WHERE dataset_version_id = :v"
            ),
            {"v": version_id},
        ).one()
        assert rows.n == 6
        assert rows.srid == 4326
        assert rows.gtypes == 1
        assert rows.gtype == "ST_MultiPolygon"

        # Area measured in EPSG:5186; repair audit persisted.
        audit = db_session.execute(  # type: ignore[attr-defined]
            sa_text(
                "SELECT count(*) FILTER (WHERE geometry_repair_status = 'made_valid') AS repaired, "
                "count(*) FILTER (WHERE source_geometry_valid) AS valid, "
                "max(geometry_area_m2) AS max_area "
                "FROM environmental_land_cover_features WHERE dataset_version_id = :v"
            ),
            {"v": version_id},
        ).one()
        assert audit.repaired == 1
        assert audit.valid == 5
        assert audit.max_area == pytest.approx(400 * 400 + 500 * 500)

        # Duplicate provenance: sheet 40000004 recorded once, two occurrences.
        dup = db_session.execute(  # type: ignore[attr-defined]
            sa_text(
                "SELECT duplicate_occurrence_count, duplicate_classification, "
                "jsonb_array_length(source_regions) AS occ "
                "FROM environmental_land_cover_map_sheets "
                "WHERE dataset_version_id = :v AND map_sheet_id = '40000004'"
            ),
            {"v": version_id},
        ).one()
        assert dup.duplicate_occurrence_count == 2
        assert dup.duplicate_classification == "byte_identical_cross_region"
        assert dup.occ == 2

        # Korean CP949 round-trip in the database.
        name = db_session.execute(  # type: ignore[attr-defined]
            sa_text(
                "SELECT l1_name FROM environmental_land_cover_features "
                "WHERE dataset_version_id = :v AND l1_code = '300' LIMIT 1"
            ),
            {"v": version_id},
        ).scalar()
        assert name == "산림지역"

        # Provenance release row.
        prov = db_session.execute(  # type: ignore[attr-defined]
            sa_text(
                "SELECT layer_name, source_id, reference_period, reference_date, source_crs, "
                "target_crs, source_encoding, source_checksum, is_active "
                "FROM environmental_dataset_versions WHERE id = :v"
            ),
            {"v": version_id},
        ).one()
        assert prov.layer_name == "land_cover"
        assert prov.source_id == "egis_land_cover"
        assert prov.reference_period == "2025"
        assert prov.reference_date is None
        assert prov.source_crs == "EPSG:5186"
        assert prov.source_encoding == "cp949"
        assert prov.source_checksum == manifest
        assert prov.is_active is True

        # Freshness set only after a full successful write.
        freshness = db_session.execute(  # type: ignore[attr-defined]
            sa_text(
                "SELECT latest_reference_period, freshness_status FROM dataset_freshness "
                "WHERE source_id = 'egis_land_cover'"
            )
        ).one()
        assert freshness.latest_reference_period == "2025"
        assert freshness.freshness_status == "FRESH"

        # Identical second write inserts zero new rows and reuses the release.
        second = run_land_cover_ingestion(
            source_root=str(full_root), write=True, expected_manifest_sha256=manifest
        )
        assert second.dataset_version_id == version_id
        assert second.dataset_version_created is False
        assert second.inserted_feature_count == 0
        assert second.skipped_feature_count == 6
        assert second.inserted_map_sheet_count == 0

        total = db_session.execute(  # type: ignore[attr-defined]
            sa_text(
                "SELECT count(*) FROM environmental_land_cover_features "
                "WHERE dataset_version_id = :v"
            ),
            {"v": version_id},
        ).scalar()
        assert total == 6
    finally:
        _cleanup(db_session, [version_id])


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")
def test_small_batch_size_flushes_across_boundaries(full_root: Path, db_session: object) -> None:
    """A batch_size below the row count exercises multiple COPY→INSERT→TRUNCATE flushes."""

    manifest = _aggregate_manifest(full_root)
    first = run_land_cover_ingestion(
        source_root=str(full_root), write=True, expected_manifest_sha256=manifest, batch_size=2
    )
    version_id = first.dataset_version_id
    assert version_id is not None
    try:
        assert first.inserted_feature_count == 6  # 3 flushes of 2 rows
        second = run_land_cover_ingestion(
            source_root=str(full_root), write=True, expected_manifest_sha256=manifest, batch_size=2
        )
        assert second.inserted_feature_count == 0
        assert second.skipped_feature_count == 6
    finally:
        _cleanup(db_session, [version_id])


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")
def test_coverage_method_runs_against_the_database(full_root: Path, db_session: object) -> None:
    from waste_equity_ingestion.land_cover_ingestion import compute_land_cover_coverage

    manifest = _aggregate_manifest(full_root)
    report = run_land_cover_ingestion(
        source_root=str(full_root), write=True, expected_manifest_sha256=manifest
    )
    version_id = report.dataset_version_id
    assert version_id is not None
    try:
        # The method runs (unions per-sheet footprints, transforms boundaries); it
        # returns exact results and never claims full official coverage.
        result = compute_land_cover_coverage(db_session, dataset_version_id=version_id)  # type: ignore[arg-type]
        assert "UNRESOLVED" in result.tolerance_policy
        assert result.footprint_overlap_area_m2 >= 0.0
    finally:
        _cleanup(db_session, [version_id])


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")
def test_write_leaves_scoring_and_candidate_tables_untouched(
    full_root: Path, db_session: object
) -> None:
    from sqlalchemy import text as sa_text

    def counts() -> tuple[int, int, int, int]:
        row = db_session.execute(  # type: ignore[attr-defined]
            sa_text(
                "SELECT (SELECT count(*) FROM suitability_candidates) AS candidates, "
                "(SELECT count(*) FROM suitability_analysis_runs) AS runs, "
                "(SELECT count(*) FROM structural_protected_features) AS protected, "
                "(SELECT count(*) FROM environmental_wetland_inventory_features) AS wetland"
            )
        ).one()
        return row.candidates, row.runs, row.protected, row.wetland

    before = counts()
    manifest = _aggregate_manifest(full_root)
    report = run_land_cover_ingestion(
        source_root=str(full_root), write=True, expected_manifest_sha256=manifest
    )
    version_id = report.dataset_version_id
    assert version_id is not None
    try:
        assert counts() == before
    finally:
        _cleanup(db_session, [version_id])


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")
def test_conflicting_duplicate_write_halts_before_persisting(
    tmp_path: Path, db_session: object
) -> None:
    from sqlalchemy import text as sa_text

    root = build_full_root(tmp_path, conflicting_dup=True)
    manifest = _aggregate_manifest(root)
    before = db_session.execute(  # type: ignore[attr-defined]
        sa_text("SELECT count(*) FROM environmental_land_cover_features")
    ).scalar()

    with pytest.raises(LandCoverIngestionError, match="distinct .shp checksums"):
        run_land_cover_ingestion(
            source_root=str(root), write=True, expected_manifest_sha256=manifest
        )

    db_session.commit()  # type: ignore[attr-defined]
    after = db_session.execute(  # type: ignore[attr-defined]
        sa_text("SELECT count(*) FROM environmental_land_cover_features")
    ).scalar()
    assert after == before
    # Clean up any egis_land_cover run/freshness rows the aborted attempt created.
    session = db_session
    session.execute(  # type: ignore[attr-defined]
        sa_text("DELETE FROM dataset_freshness WHERE source_id = 'egis_land_cover'")
    )
    session.execute(  # type: ignore[attr-defined]
        sa_text("DELETE FROM ingestion_runs WHERE source_id = 'egis_land_cover'")
    )
    session.commit()  # type: ignore[attr-defined]
