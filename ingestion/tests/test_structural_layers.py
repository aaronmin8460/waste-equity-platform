"""Tests for the generalized protected (polygon) and road (line) loader.

All shapefiles are SYNTHETIC TEST FIXTURES (pyshp), never official data and
never a production fallback.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import shapefile  # pyshp
from pyproj import CRS
from shapely.geometry.linestring import LineString
from shapely.geometry.multilinestring import MultiLineString
from shapely.geometry.point import Point

from waste_equity_ingestion.config import ProbeSettings
from waste_equity_ingestion.structural_layer_ingestion import (
    build_load_result,
    run_structural_ingestion,
)
from waste_equity_ingestion.structural_layers import (
    FAMILY_LAYERS,
    GeometryValidationError,
    layer_for_name,
    normalize_line_geometry,
)
from waste_equity_ingestion.vworld_zoning_contract import TARGET_REGIONS_BY_DIR
from waste_equity_ingestion.vworld_zoning_ingestion import discover_region_sources  # noqa: F401

_SEOUL_5179_POLY = [
    (955000.0, 1950000.0),
    (955000.0, 1950200.0),
    (955200.0, 1950200.0),
    (955200.0, 1950000.0),
    (955000.0, 1950000.0),
]
_SEOUL_5179_LINE = [(955000.0, 1950000.0), (955200.0, 1950200.0), (955400.0, 1950100.0)]


def _settings() -> ProbeSettings:
    return ProbeSettings.from_env()


def _write_shapefile(
    directory: Path,
    layer_identifier: str,
    *,
    epsg: int,
    shape_type: int,
    coords: list[tuple[float, float]],
    fields: list[tuple[str, str, int]],
    record: tuple[object, ...],
    encoding: str = "cp949",
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    base = directory / layer_identifier
    writer = shapefile.Writer(str(base), shapeType=shape_type, encoding=encoding)
    for name, ftype, size in fields:
        writer.field(name, ftype, size=size)
    if shape_type == shapefile.POLYLINE:
        writer.line([coords])
    else:
        writer.poly([coords])
    writer.record(*record)
    writer.close()
    base.with_suffix(".prj").write_text(CRS.from_epsg(epsg).to_wkt(), encoding="utf-8")
    return base.with_suffix(".shp")


def _discover(family: str, region_dir: Path, region_key: str, tmp: Path):  # type: ignore[no-untyped-def]
    from waste_equity_ingestion.structural_layer_ingestion import _discover_region_sources

    return _discover_region_sources(family, region_dir, TARGET_REGIONS_BY_DIR[region_key], tmp)


# --------------------------------------------------------------------------- #
# Registry + line normalization
# --------------------------------------------------------------------------- #


def test_protected_layer_mapping() -> None:
    spec = layer_for_name("protected", "LT_C_UD801_seoul")
    assert spec is not None
    assert spec.category == "DEVELOPMENT_RESTRICTION"
    assert spec.geometry_family == "POLYGON"
    assert spec.mandatory is True


def test_road_layer_mapping_prefers_longer_code() -> None:
    spec = layer_for_name("roads", "LT_L_N3A0020000_gyeonggi")
    assert spec is not None
    assert spec.category == "ROAD_CENTERLINE"
    assert spec.geometry_family == "LINE"


def test_mandatory_protected_layers_present() -> None:
    codes = {s.layer_code for s in FAMILY_LAYERS["protected"] if s.mandatory}
    assert {"UD801", "UM710", "UM901", "UF151", "WGISNPGUG", "UO101", "UO301"} <= codes


def test_line_normalization_promotes_and_rejects() -> None:
    line = LineString([(0, 0), (1, 1)])
    normalized, promoted = normalize_line_geometry(line)
    assert isinstance(normalized, MultiLineString)
    assert promoted is True
    with pytest.raises(GeometryValidationError):
        normalize_line_geometry(Point(0, 0))


# --------------------------------------------------------------------------- #
# Loader
# --------------------------------------------------------------------------- #


def test_protected_polygon_dry_run(tmp_path: Path) -> None:
    seoul = tmp_path / "protected" / "seoul"
    _write_shapefile(
        seoul,
        "LT_C_UD801",
        epsg=5179,
        shape_type=shapefile.POLYGON,
        coords=_SEOUL_5179_POLY,
        fields=[("uname", "C", 80)],
        record=("개발제한구역",),
    )
    report = run_structural_ingestion(
        _settings(),
        family="protected",
        source_path=str(tmp_path / "protected"),
        reference_date="2026-05-20",
        scope="capital-region",
        write=False,
    )
    assert report.status == "VALIDATED"
    assert report.accepted_feature_count == 1
    cell = report.coverage_matrix["seoul"]["layers"]["UD801"]
    assert cell["status"] == "COMPLETE_WITH_FEATURES"


def test_road_line_dry_run_produces_multilinestring(tmp_path: Path) -> None:
    gyeonggi = tmp_path / "roads" / "gyeonggi"
    _write_shapefile(
        gyeonggi,
        "LT_L_N3A0020000",
        epsg=5179,
        shape_type=shapefile.POLYLINE,
        coords=_SEOUL_5179_LINE,
        fields=[("rdnu", "C", 20), ("rdln", "N", 5)],
        record=("고속국도1", 4),
    )
    sources = _discover("roads", gyeonggi, "gyeonggi", tmp_path / "extract")
    load = build_load_result(
        "roads",
        sources,
        present_region_dirs={"gyeonggi"},
        reference_date="2026-07-01",
        encoding="cp949",
    )
    assert load.accepted_feature_count == 1
    assert load.geometry_family == "LINE"
    assert load.features[0].geometry_wkt.startswith("MULTILINESTRING")


def test_polygon_in_roads_family_is_rejected(tmp_path: Path) -> None:
    # A polygon file mapped to a road layer must be rejected, not coerced.
    gyeonggi = tmp_path / "roads" / "gyeonggi"
    _write_shapefile(
        gyeonggi,
        "LT_L_MOCTLINK",
        epsg=5179,
        shape_type=shapefile.POLYGON,
        coords=_SEOUL_5179_POLY,
        fields=[("road_name", "C", 40)],
        record=("bogus",),
    )
    sources = _discover("roads", gyeonggi, "gyeonggi", tmp_path / "extract")
    load = build_load_result(
        "roads",
        sources,
        present_region_dirs={"gyeonggi"},
        reference_date="2026-07-01",
        encoding="cp949",
    )
    assert load.accepted_feature_count == 0
    assert load.rejected_feature_count == 1


def test_no_source_files_reports_required(tmp_path: Path) -> None:
    empty = tmp_path / "protected"
    empty.mkdir()
    report = run_structural_ingestion(
        _settings(),
        family="protected",
        source_path=str(empty),
        reference_date="2026-05-20",
        scope="capital-region",
        write=False,
    )
    assert report.status == "NO_SOURCE_FILES"
    assert report.required_sources
    assert report.next_command is not None


# --------------------------------------------------------------------------- #
# PostGIS end-to-end idempotency (line + polygon families). Requires PostGIS.
# --------------------------------------------------------------------------- #

import os  # noqa: E402

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
_ISOLATED_DATE = "1999-02-02"  # keep fixtures away from real data


def _clean_isolated(url: str) -> None:
    from sqlalchemy import create_engine, text

    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(
            text(
                "DELETE FROM structural_line_features WHERE dataset_version_id IN "
                "(SELECT id FROM structural_dataset_versions WHERE reference_date = :d)"
            ),
            {"d": _ISOLATED_DATE},
        )
        conn.execute(
            text(
                "DELETE FROM structural_features WHERE dataset_version_id IN "
                "(SELECT id FROM structural_dataset_versions WHERE reference_date = :d)"
            ),
            {"d": _ISOLATED_DATE},
        )
        conn.execute(
            text("DELETE FROM structural_dataset_versions WHERE reference_date = :d"),
            {"d": _ISOLATED_DATE},
        )
        conn.execute(
            text(
                "DELETE FROM ingestion_runs WHERE source_id='vworld_structural' "
                "AND reference_period = :d"
            ),
            {"d": _ISOLATED_DATE},
        )
    engine.dispose()


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL required")
def test_road_line_write_is_idempotent(tmp_path: Path) -> None:
    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    from waste_equity_backend.config import get_settings
    from waste_equity_backend.db import get_engine, get_sessionmaker

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()

    gyeonggi = tmp_path / "roads" / "gyeonggi"
    _write_shapefile(
        gyeonggi,
        "LT_L_N3A0020000",
        epsg=5179,
        shape_type=shapefile.POLYLINE,
        coords=_SEOUL_5179_LINE,
        fields=[("rdnu", "C", 20)],
        record=("고속국도1",),
    )
    try:
        first = run_structural_ingestion(
            _settings(),
            family="roads",
            source_path=str(tmp_path / "roads"),
            reference_date=_ISOLATED_DATE,
            scope="capital-region",
            write=True,
        )
        second = run_structural_ingestion(
            _settings(),
            family="roads",
            source_path=str(tmp_path / "roads"),
            reference_date=_ISOLATED_DATE,
            scope="capital-region",
            write=True,
        )
        assert first.status == "SUCCEEDED"
        assert first.dataset_version_created is True
        assert first.features_inserted == 1
        assert second.dataset_version_created is False
        assert second.features_inserted == 0
        assert second.features_skipped_existing == 1
        assert first.dataset_version_id == second.dataset_version_id
    finally:
        _clean_isolated(TEST_DATABASE_URL)
        get_settings.cache_clear()
        get_engine.cache_clear()
        get_sessionmaker.cache_clear()
