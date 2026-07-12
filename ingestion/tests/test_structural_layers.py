"""Tests for the manifest-driven protected (polygon) and road (line) loader.

All shapefiles and manifests are SYNTHETIC TEST FIXTURES (pyshp / in-memory),
never official data and never a production fallback. The PostGIS persistence
tests require a real PostgreSQL/PostGIS database (``TEST_DATABASE_URL``) and use
isolated reference dates + a dedicated provider identifier, cleaning up after
themselves and never touching real zoning/structural data.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
import shapefile  # pyshp
from pyproj import CRS
from shapely.geometry.polygon import Polygon
from shapely.prepared import prep

from waste_equity_ingestion.config import ProbeSettings
from waste_equity_ingestion.errors import IngestionError
from waste_equity_ingestion.structural_clipping import RegionBoundary
from waste_equity_ingestion.structural_layer_ingestion import (
    _discover_sources,
    _utcnow,
    process_source,
    run_structural_ingestion,
)
from waste_equity_ingestion.structural_manifest import load_manifest

# --------------------------------------------------------------------------- #
# Fixtures / helpers
# --------------------------------------------------------------------------- #

_UNIT_SQUARE = [(0.1, 0.1), (0.1, 0.4), (0.4, 0.4), (0.4, 0.1), (0.1, 0.1)]
_STRADDLE = [(0.5, 0.2), (0.5, 0.8), (1.5, 0.8), (1.5, 0.2), (0.5, 0.2)]
_FAR = [(50.0, 50.0), (50.0, 50.1), (50.1, 50.1), (50.1, 50.0), (50.0, 50.0)]
_LINE = [(0.5, 0.5), (1.5, 0.5)]


def _settings() -> ProbeSettings:
    return ProbeSettings.from_env()


def _write_shapefile(
    directory: Path,
    base: str,
    *,
    epsg: int,
    shape_type: int,
    features: list[tuple[list[tuple[float, float]], tuple[object, ...]]],
    fields: list[tuple[str, str, int]],
    encoding: str = "cp949",
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / base
    writer = shapefile.Writer(str(path), shapeType=shape_type, encoding=encoding)
    for name, ftype, size in fields:
        writer.field(name, ftype, size=size)
    for coords, record in features:
        if shape_type == shapefile.POLYGON:
            writer.poly([coords])
        elif shape_type == shapefile.POLYLINE:
            writer.line([coords])
        else:
            writer.point(coords[0][0], coords[0][1])
        writer.record(*record)
    writer.close()
    path.with_suffix(".prj").write_text(CRS.from_epsg(epsg).to_wkt(), encoding="utf-8")
    return path.with_suffix(".shp")


def _write_manifest(root: Path, manifest: dict) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "source_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
    )


def _protected_regional_manifest(reference_date: str, provider_id: str) -> dict:
    return {
        "family": "protected",
        "datasets": [
            {
                "dataset_key": "test_protected",
                "provider": "TEST",
                "official_dataset_name": "TEST protected",
                "provider_dataset_identifier": provider_id,
                "coverage_type": "regional",
                "reference_date": reference_date,
                "source_crs": "EPSG:4326",
                "layers": [
                    {
                        "layer_code": "UD801",
                        "layer_identifier": "LT_C_UD801",
                        "category": "DEVELOPMENT_RESTRICTION",
                        "official_layer_name": "개발제한구역",
                        "geometry_family": "POLYGON",
                        "filename_aliases": ["UD801"],
                        "provider_feature_id_fields": ["MNUM"],
                    }
                ],
            }
        ],
        "official_source_unavailable": [
            {"region": "incheon", "layer": "UD801", "evidence": "test-unavailable"}
        ],
    }


def _nationwide_manifest() -> dict:
    return {
        "family": "protected",
        "datasets": [
            {
                "dataset_key": "test_np",
                "provider": "TEST",
                "official_dataset_name": "TEST national park",
                "provider_dataset_identifier": "TEST-NP",
                "coverage_type": "nationwide",
                "reference_date": "1999-12-31",
                "source_crs": "EPSG:4326",
                "layers": [
                    {
                        "layer_code": "WGISNPGUG",
                        "layer_identifier": "LT_C_WGISNPGUG",
                        "category": "NATIONAL_PARK",
                        "official_layer_name": "국립자연공원",
                        "geometry_family": "POLYGON",
                        "filename_aliases": ["BSI_NPK_BBNDR"],
                        "provider_feature_id_fields": ["NPK_CD"],
                    }
                ],
            }
        ],
    }


def _synthetic_boundaries() -> list[RegionBoundary]:
    west = Polygon([(0, 0), (1, 0), (1, 1), (0, 1)])
    east = Polygon([(1, 0), (2, 0), (2, 1), (1, 1)])
    return [
        RegionBoundary("seoul", "11", "서울특별시", west, prep(west), west.bounds),
        RegionBoundary("gyeonggi", "41", "경기도", east, prep(east), east.bounds),
    ]


# --------------------------------------------------------------------------- #
# Regional dry-run + discovery
# --------------------------------------------------------------------------- #


def test_protected_regional_dry_run(tmp_path: Path) -> None:
    root = tmp_path / "protected"
    _write_manifest(root, _protected_regional_manifest("2026-05-20", "TEST-P"))
    _write_shapefile(
        root / "seoul",
        "LSMD_CONT_UD801_11",
        epsg=4326,
        shape_type=shapefile.POLYGON,
        features=[(_UNIT_SQUARE, ("mnum-1",))],
        fields=[("MNUM", "C", 40)],
    )
    report = run_structural_ingestion(
        _settings(),
        family="protected",
        source_path=str(root),
        scope="capital-region",
        write=False,
    )
    assert report.status == "VALIDATED"
    assert report.accepted_feature_count == 1
    cell = report.coverage_matrix["seoul"]["layers"]["UD801"]
    assert cell["status"] == "COMPLETE_WITH_FEATURES"
    # Incheon UD801 is documented unavailable in the manifest, not SOURCE_MISSING.
    inc = report.coverage_matrix["incheon"]["layers"]["UD801"]
    assert inc["status"] == "OFFICIAL_SOURCE_UNAVAILABLE"


def test_multiple_dataset_versions_and_reference_dates(tmp_path: Path) -> None:
    root = tmp_path / "protected"
    manifest = _protected_regional_manifest("2026-05-20", "TEST-A")
    # Add a second regional dataset with a DIFFERENT reference date + provider id.
    manifest["datasets"].append(
        {
            "dataset_key": "test_protected_b",
            "provider": "TEST",
            "official_dataset_name": "TEST protected B",
            "provider_dataset_identifier": "TEST-B",
            "coverage_type": "regional",
            "reference_date": "2025-01-15",
            "source_crs": "EPSG:4326",
            "layers": [
                {
                    "layer_code": "UM710",
                    "layer_identifier": "LT_C_UM710",
                    "category": "WATER_SOURCE_PROTECTION",
                    "official_layer_name": "상수원보호구역",
                    "geometry_family": "POLYGON",
                    "filename_aliases": ["UM710"],
                }
            ],
        }
    )
    _write_manifest(root, manifest)
    _write_shapefile(
        root / "seoul",
        "LSMD_CONT_UD801_11",
        epsg=4326,
        shape_type=shapefile.POLYGON,
        features=[(_UNIT_SQUARE, ("m1",))],
        fields=[("MNUM", "C", 40)],
    )
    _write_shapefile(
        root / "seoul",
        "LSMD_CONT_UM710_11",
        epsg=4326,
        shape_type=shapefile.POLYGON,
        features=[(_UNIT_SQUARE, ("m2",))],
        fields=[("MNUM", "C", 40)],
    )
    report = run_structural_ingestion(
        _settings(),
        family="protected",
        source_path=str(root),
        scope="capital-region",
        write=False,
    )
    assert {v["reference_date"] for v in report.dataset_versions} == {"2026-05-20", "2025-01-15"}
    assert report.reference_date_by_dataset == {
        "test_protected": "2026-05-20",
        "test_protected_b": "2025-01-15",
    }


def test_stdlink_node_pointfile_rejected_in_discovery(tmp_path: Path) -> None:
    root = tmp_path / "roads"
    _write_manifest(
        root,
        {
            "family": "roads",
            "datasets": [
                {
                    "dataset_key": "stdlink",
                    "provider": "ITS",
                    "official_dataset_name": "표준노드링크",
                    "provider_dataset_identifier": "STDLINK",
                    "coverage_type": "nationwide",
                    "reference_date": "2026-07-01",
                    "source_crs": "EPSG:4326",
                    "layers": [
                        {
                            "layer_code": "STDLINK",
                            "layer_identifier": "STD_NODE_LINK",
                            "category": "STANDARD_LINK",
                            "official_layer_name": "표준노드링크",
                            "geometry_family": "LINE",
                            "filename_aliases": ["MOCT_LINK"],
                            "exclude_aliases": ["MOCT_NODE"],
                        }
                    ],
                }
            ],
        },
    )
    nationwide = root / "nationwide"
    _write_shapefile(
        nationwide,
        "MOCT_LINK",
        epsg=4326,
        shape_type=shapefile.POLYLINE,
        features=[(_LINE, ("L1",))],
        fields=[("LINK_ID", "C", 20)],
    )
    _write_shapefile(
        nationwide,
        "MOCT_NODE",
        epsg=4326,
        shape_type=shapefile.POINT,
        features=[([(0.5, 0.5)], ("N1",))],
        fields=[("NODE_ID", "C", 20)],
    )
    with TemporaryDirectory() as td:
        sources, _present, skipped = _discover_sources(
            "roads", load_manifest(root, family="roads"), root, Path(td)
        )
        assert len(sources) == 1
        assert sources[0].layer.layer_code == "STDLINK"
        assert any("MOCT_NODE" in s["file"] for s in skipped)


def test_geometry_family_guard_rejects_point_for_line_layer(tmp_path: Path) -> None:
    root = tmp_path / "roads"
    _write_manifest(
        root,
        {
            "family": "roads",
            "datasets": [
                {
                    "dataset_key": "n3a",
                    "provider": "NGII",
                    "official_dataset_name": "도로중심선",
                    "provider_dataset_identifier": "N3A",
                    "coverage_type": "regional",
                    "reference_date": "2024-04-18",
                    "source_crs": "EPSG:4326",
                    "layers": [
                        {
                            "layer_code": "N3A0020000",
                            "layer_identifier": "LT_L_N3A0020000",
                            "category": "ROAD_CENTERLINE",
                            "official_layer_name": "도로중심선",
                            "geometry_family": "LINE",
                            "filename_aliases": ["A0020000"],
                        }
                    ],
                }
            ],
        },
    )
    # A POINT file whose name matches the LINE alias must be rejected by the guard.
    _write_shapefile(
        root / "seoul",
        "N3L_A0020000_11",
        epsg=4326,
        shape_type=shapefile.POINT,
        features=[([(0.5, 0.5)], ("x",))],
        fields=[("UFID", "C", 20)],
    )
    with TemporaryDirectory() as td:
        sources, _present, skipped = _discover_sources(
            "roads", load_manifest(root, family="roads"), root, Path(td)
        )
        assert sources == []
        assert any("geometry family POINT" in s["reason"] for s in skipped)


# --------------------------------------------------------------------------- #
# Nationwide clipping via process_source (synthetic boundaries, no DB)
# --------------------------------------------------------------------------- #


def test_nationwide_polygon_clipping_and_region_assignment(tmp_path: Path) -> None:
    root = tmp_path / "protected"
    _write_manifest(root, _nationwide_manifest())
    _write_shapefile(
        root / "nationwide",
        "BSI_NPK_BBNDR",
        epsg=4326,
        shape_type=shapefile.POLYGON,
        features=[
            (_STRADDLE, ("PARK-CROSS",)),  # spans both synthetic 시도
            (_UNIT_SQUARE, ("PARK-WEST",)),  # only west 시도
            (_FAR, ("PARK-OUT",)),  # outside the capital region
        ],
        fields=[("NPK_CD", "C", 20)],
    )
    with TemporaryDirectory() as td:
        sources, _present, _skipped = _discover_sources(
            "protected", load_manifest(root, family="protected"), root, Path(td)
        )
        assert len(sources) == 1
        src = sources[0]
        assert src.region is None and src.dataset.is_nationwide
        stats = process_source(
            src,
            encoding="cp949",
            boundaries=_synthetic_boundaries(),
            version_id=None,
            writer=None,
            now=_utcnow(),
        )
    # 3 received; PARK-CROSS -> 2 clipped features (seoul + gyeonggi), PARK-WEST -> 1,
    # PARK-OUT -> skipped outside region.
    assert stats.received == 3
    assert stats.skipped_outside_region == 1
    assert stats.clipped_count == 2  # only the straddling park was cut
    assert stats.accepted == 3  # 2 (cross, per region) + 1 (west)
    assert stats.per_region_accepted == {"seoul": 2, "gyeonggi": 1}


def test_undecodable_cp949_attribute_is_rejected(tmp_path: Path) -> None:
    # Reproduces the live Gyeonggi 도로중심선 rejects (982 records in the
    # production run): a DBF attribute whose bytes are undecodable under cp949 is
    # rejected and reported, never silently kept, dropped-to-mojibake, or
    # repaired. pyshp opens the reader with encodingErrors="strict", so an
    # invalid cp949 byte raises UnicodeDecodeError on the record read and the
    # feature is counted as rejected with an explicit warning.
    root = tmp_path / "roads"
    _write_manifest(
        root,
        {
            "family": "roads",
            "datasets": [
                {
                    "dataset_key": "n3a",
                    "provider": "NGII",
                    "official_dataset_name": "도로중심선",
                    "provider_dataset_identifier": "N3A-CP949",
                    "coverage_type": "regional",
                    "reference_date": "2024-04-18",
                    "source_crs": "EPSG:4326",
                    "layers": [
                        {
                            "layer_code": "N3A0020000",
                            "layer_identifier": "LT_L_N3A0020000",
                            "category": "ROAD_CENTERLINE",
                            "official_layer_name": "도로중심선",
                            "geometry_family": "LINE",
                            "filename_aliases": ["N3L_A0020000", "A0020000"],
                            "provider_feature_id_fields": ["UFID"],
                        }
                    ],
                }
            ],
        },
    )
    shp = _write_shapefile(
        root / "gyeonggi",
        "N3L_A0020000_41",
        epsg=4326,
        shape_type=shapefile.POLYLINE,
        features=[([(20.0, 20.0), (20.1, 20.1)], ("SENTINELX",))],
        fields=[("UFID", "C", 20)],
    )
    # Corrupt the stored attribute in-place with a byte that is invalid under
    # cp949 (0xFF is not a valid cp949 single/lead byte). The replacement keeps
    # the DBF record length identical so only the decode fails, not the layout.
    dbf = shp.with_suffix(".dbf")
    raw = dbf.read_bytes()
    assert b"SENTINELX" in raw
    dbf.write_bytes(raw.replace(b"SENTINELX", b"SENTINEL\xff", 1))

    with TemporaryDirectory() as td:
        sources, _present, _skipped = _discover_sources(
            "roads", load_manifest(root, family="roads"), root, Path(td)
        )
        assert len(sources) == 1
        stats = process_source(
            sources[0],
            encoding="cp949",
            boundaries=[],
            version_id=None,
            writer=None,
            now=_utcnow(),
        )
    assert stats.received == 1
    assert stats.rejected == 1
    assert stats.accepted == 0
    assert any("undecodable attribute (cp949)" in w for w in stats.warnings)


# --------------------------------------------------------------------------- #
# PostGIS persistence (requires TEST_DATABASE_URL)
# --------------------------------------------------------------------------- #

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
_ISOLATED = "1999-03-03"
_PROVIDER_ID = "TEST-PROTECTED-PERSIST"


def _reset_db_caches() -> None:
    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    from waste_equity_backend.config import get_settings
    from waste_equity_backend.db import get_engine, get_sessionmaker

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()


def _cleanup() -> None:
    from sqlalchemy import create_engine, text

    assert TEST_DATABASE_URL is not None
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(
            text(
                "DELETE FROM structural_protected_features WHERE dataset_version_id IN "
                "(SELECT id FROM structural_dataset_versions "
                "WHERE provider_dataset_identifier = :p)"
            ),
            {"p": _PROVIDER_ID},
        )
        conn.execute(
            text("DELETE FROM structural_dataset_versions WHERE provider_dataset_identifier = :p"),
            {"p": _PROVIDER_ID},
        )
        conn.execute(
            text(
                "DELETE FROM ingestion_runs WHERE source_id='vworld_structural' "
                "AND reference_period = :d"
            ),
            {"d": _ISOLATED},
        )
    engine.dispose()


def _build_protected_source(root: Path, *, duplicate: bool = False) -> None:
    _write_manifest(root, _protected_regional_manifest(_ISOLATED, _PROVIDER_ID))
    # Ocean-remote squares so a fixture can never overlap real data.
    poly_a = [(10.0, 10.0), (10.0, 10.2), (10.2, 10.2), (10.2, 10.0), (10.0, 10.0)]
    features = [(poly_a, ("mnum-A",))]
    if duplicate:
        features.append((poly_a, ("mnum-A",)))  # identical geometry + id
    else:
        poly_b = [(11.0, 11.0), (11.0, 11.2), (11.2, 11.2), (11.2, 11.0), (11.0, 11.0)]
        features.append((poly_b, ("mnum-B",)))
    _write_shapefile(
        root / "seoul",
        "LSMD_CONT_UD801_11",
        epsg=4326,
        shape_type=shapefile.POLYGON,
        features=features,
        fields=[("MNUM", "C", 40)],
    )


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL required")
def test_protected_write_idempotent_and_zoning_untouched(tmp_path: Path) -> None:
    _reset_db_caches()
    from sqlalchemy import create_engine, text

    assert TEST_DATABASE_URL is not None
    engine = create_engine(TEST_DATABASE_URL)
    try:
        with engine.connect() as conn:
            zoning_before = conn.execute(text("SELECT count(*) FROM structural_features")).scalar()

        root = tmp_path / "protected"
        _build_protected_source(root)
        first = run_structural_ingestion(
            _settings(),
            family="protected",
            source_path=str(root),
            scope="capital-region",
            write=True,
        )
        second = run_structural_ingestion(
            _settings(),
            family="protected",
            source_path=str(root),
            scope="capital-region",
            write=True,
        )
        assert first.status == "SUCCEEDED"
        assert first.features_inserted == 2
        dv = first.dataset_versions[0]
        assert dv["created"] is True
        # Second identical write: version reused, zero new features.
        second_dv = second.dataset_versions[0]
        assert second_dv["created"] is False
        assert second.features_inserted == 0
        assert second.features_skipped_existing == 2
        assert dv["dataset_version_id"] == second_dv["dataset_version_id"]

        with engine.connect() as conn:
            version_id = dv["dataset_version_id"]
            rows = conn.execute(
                text(
                    "SELECT count(*), count(*) FILTER (WHERE ST_SRID(geometry)=4326), "
                    "count(*) FILTER (WHERE ST_IsValid(geometry)), "
                    "count(*) FILTER (WHERE GeometryType(geometry)='MULTIPOLYGON'), "
                    "count(*) FILTER (WHERE geometry IS NULL) "
                    "FROM structural_protected_features WHERE dataset_version_id = :v"
                ),
                {"v": version_id},
            ).one()
            total, srid4326, valid, multipoly, nullgeom = rows
            assert total == 2
            assert srid4326 == 2
            assert valid == 2
            assert multipoly == 2
            assert nullgeom == 0
            # Zoning table (structural_features) is completely untouched.
            zoning_after = conn.execute(text("SELECT count(*) FROM structural_features")).scalar()
            assert zoning_after == zoning_before
    finally:
        engine.dispose()
        _cleanup()
        _reset_db_caches()


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL required")
def test_duplicate_fingerprint_prevented(tmp_path: Path) -> None:
    _reset_db_caches()
    try:
        root = tmp_path / "protected"
        _build_protected_source(root, duplicate=True)
        report = run_structural_ingestion(
            _settings(),
            family="protected",
            source_path=str(root),
            scope="capital-region",
            write=True,
        )
        # Two identical features (same geometry + provider id) persist once.
        assert report.features_inserted == 1
    finally:
        _cleanup()
        _reset_db_caches()


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL required")
def test_freshness_updates_only_after_success(tmp_path: Path) -> None:
    _reset_db_caches()
    from sqlalchemy import create_engine, text

    assert TEST_DATABASE_URL is not None
    try:
        root = tmp_path / "protected"
        _build_protected_source(root)
        run_structural_ingestion(
            _settings(),
            family="protected",
            source_path=str(root),
            scope="capital-region",
            write=True,
        )
        engine = create_engine(TEST_DATABASE_URL)
        with engine.connect() as conn:
            status = conn.execute(
                text(
                    "SELECT freshness_status FROM dataset_freshness "
                    "WHERE source_id='vworld_structural'"
                )
            ).scalar()
        engine.dispose()
        assert status == "FRESH"
    finally:
        _cleanup()
        _reset_db_caches()


_ROADS_PROVIDER_ID = "TEST-ROADS-PERSIST"
_ROADS_ISOLATED = "1999-04-04"


def _cleanup_roads() -> None:
    from sqlalchemy import create_engine, text

    assert TEST_DATABASE_URL is not None
    engine = create_engine(TEST_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(
            text(
                "DELETE FROM structural_line_features WHERE dataset_version_id IN "
                "(SELECT id FROM structural_dataset_versions "
                "WHERE provider_dataset_identifier = :p)"
            ),
            {"p": _ROADS_PROVIDER_ID},
        )
        conn.execute(
            text("DELETE FROM structural_dataset_versions WHERE provider_dataset_identifier = :p"),
            {"p": _ROADS_PROVIDER_ID},
        )
        conn.execute(
            text(
                "DELETE FROM ingestion_runs WHERE source_id='vworld_structural' "
                "AND reference_period = :d"
            ),
            {"d": _ROADS_ISOLATED},
        )
    engine.dispose()


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL required")
def test_road_line_write_idempotent_multilinestring(tmp_path: Path) -> None:
    _reset_db_caches()
    from sqlalchemy import create_engine, text

    assert TEST_DATABASE_URL is not None
    try:
        root = tmp_path / "roads"
        _write_manifest(
            root,
            {
                "family": "roads",
                "datasets": [
                    {
                        "dataset_key": "n3a",
                        "provider": "NGII",
                        "official_dataset_name": "도로중심선",
                        "provider_dataset_identifier": _ROADS_PROVIDER_ID,
                        "coverage_type": "regional",
                        "reference_date": _ROADS_ISOLATED,
                        "source_crs": "EPSG:4326",
                        "layers": [
                            {
                                "layer_code": "N3A0020000",
                                "layer_identifier": "LT_L_N3A0020000",
                                "category": "ROAD_CENTERLINE",
                                "official_layer_name": "도로중심선",
                                "geometry_family": "LINE",
                                "filename_aliases": ["N3L_A0020000", "A0020000"],
                                "provider_feature_id_fields": ["UFID"],
                            }
                        ],
                    }
                ],
            },
        )
        _write_shapefile(
            root / "gyeonggi",
            "N3L_A0020000_41",
            epsg=4326,
            shape_type=shapefile.POLYLINE,
            features=[([(20.0, 20.0), (20.1, 20.1)], ("UFID-1",))],
            fields=[("UFID", "C", 20)],
        )
        first = run_structural_ingestion(
            _settings(),
            family="roads",
            source_path=str(root),
            scope="capital-region",
            write=True,
        )
        second = run_structural_ingestion(
            _settings(),
            family="roads",
            source_path=str(root),
            scope="capital-region",
            write=True,
        )
        assert first.features_inserted == 1
        assert second.features_inserted == 0
        assert second.dataset_versions[0]["created"] is False
        engine = create_engine(TEST_DATABASE_URL)
        with engine.connect() as conn:
            gtype, srid = conn.execute(
                text(
                    "SELECT GeometryType(geometry), ST_SRID(geometry) "
                    "FROM structural_line_features slf "
                    "JOIN structural_dataset_versions v ON v.id = slf.dataset_version_id "
                    "WHERE v.provider_dataset_identifier = :p LIMIT 1"
                ),
                {"p": _ROADS_PROVIDER_ID},
            ).one()
            assert gtype == "MULTILINESTRING"
            assert srid == 4326
        engine.dispose()
    finally:
        _cleanup_roads()
        _reset_db_caches()


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL required")
def test_unsupported_crs_rolls_back_whole_run(tmp_path: Path) -> None:
    _reset_db_caches()
    from sqlalchemy import create_engine, text

    assert TEST_DATABASE_URL is not None
    try:
        root = tmp_path / "protected"
        # Two datasets: A is valid, B carries an unsupported CRS. A is written
        # (pending) before B fails; the whole run must roll back atomically so
        # neither A's nor B's version/features persist (tests the single-transaction
        # atomicity — a per-dataset commit would have leaked A).
        manifest = _protected_regional_manifest(_ISOLATED, _PROVIDER_ID)
        manifest["datasets"].append(
            {
                "dataset_key": "test_protected_bad_crs",
                "provider": "TEST",
                "official_dataset_name": "TEST bad crs",
                "provider_dataset_identifier": _PROVIDER_ID + "-BAD",
                "coverage_type": "regional",
                "reference_date": _ISOLATED,
                "source_crs": "EPSG:3857",
                "layers": [
                    {
                        "layer_code": "UM710",
                        "layer_identifier": "LT_C_UM710",
                        "category": "WATER_SOURCE_PROTECTION",
                        "official_layer_name": "상수원보호구역",
                        "geometry_family": "POLYGON",
                        "filename_aliases": ["UM710"],
                    }
                ],
            }
        )
        _write_manifest(root, manifest)
        # Dataset A: valid EPSG:4326 polygon.
        _write_shapefile(
            root / "seoul",
            "LSMD_CONT_UD801_11",
            epsg=4326,
            shape_type=shapefile.POLYGON,
            features=[
                ([(10.0, 10.0), (10.0, 10.2), (10.2, 10.2), (10.2, 10.0), (10.0, 10.0)], ("m",))
            ],
            fields=[("MNUM", "C", 40)],
        )
        # Dataset B: EPSG:3857 is not in the supported source-CRS allowlist.
        _write_shapefile(
            root / "seoul",
            "LSMD_CONT_UM710_11",
            epsg=3857,
            shape_type=shapefile.POLYGON,
            features=[
                ([(0.0, 0.0), (0.0, 100.0), (100.0, 100.0), (100.0, 0.0), (0.0, 0.0)], ("m",))
            ],
            fields=[("MNUM", "C", 40)],
        )
        with pytest.raises(IngestionError):
            run_structural_ingestion(
                _settings(),
                family="protected",
                source_path=str(root),
                scope="capital-region",
                write=True,
            )
        engine = create_engine(TEST_DATABASE_URL)
        with engine.connect() as conn:
            versions = conn.execute(
                text(
                    "SELECT count(*) FROM structural_dataset_versions "
                    "WHERE provider_dataset_identifier = :p"
                ),
                {"p": _PROVIDER_ID},
            ).scalar()
            failed = conn.execute(
                text(
                    "SELECT count(*) FROM ingestion_runs WHERE source_id='vworld_structural' "
                    "AND reference_period = :d AND status='FAILED'"
                ),
                {"d": _ISOLATED},
            ).scalar()
        engine.dispose()
        assert versions == 0  # rolled back
        assert failed >= 1
    finally:
        _cleanup()
        _reset_db_caches()
