"""Loader tests for VWorld zoning ingestion: shapefile/ZIP/CRS/coverage.

Every shapefile built here is a SYNTHETIC TEST FIXTURE created with pyshp — it
is never official data and is never used as a production fallback. Fixtures use
real Korean CRS codes and Korean attribute text so the encoding and
reprojection paths are exercised honestly.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest
import shapefile  # pyshp
from pyproj import CRS

from waste_equity_ingestion.config import ProbeSettings
from waste_equity_ingestion.vworld_zoning_contract import TARGET_REGIONS_BY_DIR
from waste_equity_ingestion.vworld_zoning_ingestion import (
    SidecarValidationError,
    SourceLayoutError,
    build_load_result,
    discover_region_sources,
    run_zoning_ingestion,
    validate_shapefile_sidecars,
)

# Fixture squares. EPSG:5179 metres near Seoul so reprojection lands in Korea.
_SEOUL_5179_SQUARE = [
    (955000.0, 1950000.0),
    (955000.0, 1950200.0),
    (955200.0, 1950200.0),
    (955200.0, 1950000.0),
    (955000.0, 1950000.0),
]
_WGS84_SQUARE = [(127.0, 37.5), (127.0, 37.6), (127.1, 37.6), (127.1, 37.5), (127.0, 37.5)]
_BOWTIE = [(0.0, 0.0), (1.0, 1.0), (1.0, 0.0), (0.0, 1.0), (0.0, 0.0)]

_ZONE_FIELDS = [("uname", "C", 80), ("ucode", "C", 20), ("mnum", "N", 10)]


def write_zoning_shapefile(
    directory: Path,
    layer_code: str,
    *,
    epsg: int | None,
    rings: list[list[tuple[float, float]]],
    records: list[tuple[object, ...]],
    fields: list[tuple[str, str, int]] | None = None,
    encoding: str = "cp949",
    shape_type: int = shapefile.POLYGON,
    write_prj: bool = True,
    prj_text: str | None = None,
) -> Path:
    """Write a synthetic zoning shapefile (fixture) and return its .shp path."""

    directory.mkdir(parents=True, exist_ok=True)
    base = directory / f"LT_C_{layer_code}"
    writer = shapefile.Writer(
        str(base), shapeType=shape_type, encoding=encoding, encodingErrors="strict"
    )
    for name, ftype, size in fields or _ZONE_FIELDS:
        writer.field(name, ftype, size=size)
    for ring, record in zip(rings, records, strict=True):
        if shape_type == shapefile.POINT:
            writer.point(ring[0][0], ring[0][1])
        else:
            writer.poly([ring])
        writer.record(*record)
    writer.close()
    if write_prj:
        text = prj_text if prj_text is not None else CRS.from_epsg(epsg).to_wkt()
        base.with_suffix(".prj").write_text(text, encoding="utf-8")
    return base.with_suffix(".shp")


def _settings() -> ProbeSettings:
    return ProbeSettings.from_env()


# --------------------------------------------------------------------------- #
# Sidecar validation
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("missing", [".shp", ".shx", ".dbf", ".prj"])
def test_missing_required_sidecar_is_rejected(tmp_path: Path, missing: str) -> None:
    shp = write_zoning_shapefile(
        tmp_path,
        "UQ111",
        epsg=5179,
        rings=[_SEOUL_5179_SQUARE],
        records=[("도시지역", "UQA100", 1)],
    )
    shp.with_suffix(missing).unlink()
    with pytest.raises(SidecarValidationError) as exc:
        validate_shapefile_sidecars(shp)
    assert missing in str(exc.value)


def test_complete_shapefile_passes_sidecar_validation(tmp_path: Path) -> None:
    shp = write_zoning_shapefile(
        tmp_path,
        "UQ111",
        epsg=5179,
        rings=[_SEOUL_5179_SQUARE],
        records=[("도시지역", "UQA100", 1)],
    )
    validate_shapefile_sidecars(shp)  # no raise


# --------------------------------------------------------------------------- #
# ZIP + extracted-directory inspection
# --------------------------------------------------------------------------- #


def _zip_shapefile(shp: Path, zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "w") as archive:
        for suffix in (".shp", ".shx", ".dbf", ".prj"):
            component = shp.with_suffix(suffix)
            archive.write(component, arcname=component.name)


def test_zip_archive_is_inspected_and_loaded(tmp_path: Path) -> None:
    staging = tmp_path / "staging"
    shp = write_zoning_shapefile(
        staging,
        "UQ112",
        epsg=5179,
        rings=[_SEOUL_5179_SQUARE],
        records=[("계획관리지역", "UQB100", 1)],
    )
    incheon = tmp_path / "src" / "incheon"
    incheon.mkdir(parents=True)
    _zip_shapefile(shp, incheon / "LT_C_UQ112_incheon.zip")

    region = TARGET_REGIONS_BY_DIR["incheon"]
    sources = discover_region_sources(incheon, region, tmp_path / "extract")
    assert len(sources) == 1
    assert sources[0].layer.layer_code == "UQ112"
    assert sources[0].origin_filename == "LT_C_UQ112_incheon.zip"


def test_extracted_shapefile_directory_is_inspected(tmp_path: Path) -> None:
    gyeonggi = tmp_path / "src" / "gyeonggi"
    write_zoning_shapefile(
        gyeonggi,
        "UQ113",
        epsg=5179,
        rings=[_SEOUL_5179_SQUARE],
        records=[("농림지역", "UQC001", 1)],
    )
    region = TARGET_REGIONS_BY_DIR["gyeonggi"]
    sources = discover_region_sources(gyeonggi, region, tmp_path / "extract")
    assert len(sources) == 1
    assert sources[0].layer.layer_code == "UQ113"
    assert sources[0].origin_filename == "LT_C_UQ113.shp"


def test_unsupported_archive_layout_is_rejected(tmp_path: Path) -> None:
    seoul = tmp_path / "src" / "seoul"
    seoul.mkdir(parents=True)
    bogus = seoul / "LT_C_UQ111_seoul.zip"
    with zipfile.ZipFile(bogus, "w") as archive:
        archive.writestr("readme.txt", "not a shapefile")
    region = TARGET_REGIONS_BY_DIR["seoul"]
    with pytest.raises(SourceLayoutError):
        discover_region_sources(seoul, region, tmp_path / "extract")


# --------------------------------------------------------------------------- #
# Encoding
# --------------------------------------------------------------------------- #


def test_korean_attribute_encoding_is_decoded(tmp_path: Path) -> None:
    seoul = tmp_path / "seoul"
    write_zoning_shapefile(
        seoul, "UQ111", epsg=5179, rings=[_SEOUL_5179_SQUARE], records=[("도시지역", "UQA100", 1)]
    )
    region = TARGET_REGIONS_BY_DIR["seoul"]
    sources = discover_region_sources(seoul, region, tmp_path / "extract")
    result = build_load_result(
        sources, present_region_dirs={"seoul"}, reference_date="2026-05-20", encoding="cp949"
    )
    assert result.accepted_feature_count == 1
    assert result.features[0].source_attributes["uname"] == "도시지역"


def test_undecodable_attribute_is_not_silently_replaced(tmp_path: Path) -> None:
    seoul = tmp_path / "seoul"
    write_zoning_shapefile(
        seoul, "UQ111", epsg=5179, rings=[_SEOUL_5179_SQUARE], records=[("도시지역", "UQA100", 1)]
    )
    region = TARGET_REGIONS_BY_DIR["seoul"]
    sources = discover_region_sources(seoul, region, tmp_path / "extract")
    # Reading cp949 Korean text as ASCII must reject the record, not mangle it.
    result = build_load_result(
        sources, present_region_dirs={"seoul"}, reference_date="2026-05-20", encoding="ascii"
    )
    assert result.accepted_feature_count == 0
    assert result.rejected_feature_count == 1
    assert any("undecodable" in warning for warning in result.warnings)


def test_missing_required_attribute_record_is_rejected(tmp_path: Path) -> None:
    seoul = tmp_path / "seoul"
    write_zoning_shapefile(
        seoul,
        "UQ111",
        epsg=5179,
        rings=[_SEOUL_5179_SQUARE],
        records=[("", "UQA100", 1)],  # blank uname (required)
    )
    region = TARGET_REGIONS_BY_DIR["seoul"]
    sources = discover_region_sources(seoul, region, tmp_path / "extract")
    result = build_load_result(
        sources, present_region_dirs={"seoul"}, reference_date="2026-05-20", encoding="cp949"
    )
    assert result.rejected_feature_count == 1
    assert any("missing required attribute" in warning for warning in result.warnings)


# --------------------------------------------------------------------------- #
# CRS + geometry
# --------------------------------------------------------------------------- #


def test_crs_is_transformed_to_epsg_4326(tmp_path: Path) -> None:
    seoul = tmp_path / "seoul"
    write_zoning_shapefile(
        seoul, "UQ111", epsg=5179, rings=[_SEOUL_5179_SQUARE], records=[("도시지역", "UQA100", 1)]
    )
    region = TARGET_REGIONS_BY_DIR["seoul"]
    sources = discover_region_sources(seoul, region, tmp_path / "extract")
    result = build_load_result(
        sources, present_region_dirs={"seoul"}, reference_date="2026-05-20", encoding="cp949"
    )
    assert result.source_crs_by_region["seoul"] == "EPSG:5179"
    feature = result.features[0]
    assert feature.geometry_wkt.startswith("MULTIPOLYGON")
    # Reprojected EPSG:5179 metres near Seoul land in the Korea lon/lat window.
    from shapely import wkt

    centroid = wkt.loads(feature.geometry_wkt).centroid
    assert 124.0 < centroid.x < 132.0
    assert 33.0 < centroid.y < 43.0


def test_missing_prj_source_is_rejected(tmp_path: Path) -> None:
    seoul = tmp_path / "seoul"
    write_zoning_shapefile(
        seoul,
        "UQ111",
        epsg=None,
        rings=[_SEOUL_5179_SQUARE],
        records=[("도시지역", "UQA100", 1)],
        write_prj=False,
    )
    region = TARGET_REGIONS_BY_DIR["seoul"]
    # Missing .prj fails sidecar validation before any CRS guessing occurs.
    with pytest.raises(SidecarValidationError):
        discover_region_sources(seoul, region, tmp_path / "extract")


def test_unsupported_source_crs_marks_validation_failure(tmp_path: Path) -> None:
    seoul = tmp_path / "seoul"
    write_zoning_shapefile(
        seoul,
        "UQ111",
        epsg=3857,  # web mercator: not in the supported allowlist
        rings=[_WGS84_SQUARE],
        records=[("도시지역", "UQA100", 1)],
    )
    region = TARGET_REGIONS_BY_DIR["seoul"]
    sources = discover_region_sources(seoul, region, tmp_path / "extract")
    result = build_load_result(
        sources, present_region_dirs={"seoul"}, reference_date="2026-05-20", encoding="cp949"
    )
    cell = result.coverage_matrix["seoul"]["layers"]["UQ111"]
    assert cell["status"] == "VALIDATION_FAILURE"
    assert result.accepted_feature_count == 0


def test_polygon_promoted_to_multipolygon_counted(tmp_path: Path) -> None:
    seoul = tmp_path / "seoul"
    write_zoning_shapefile(
        seoul, "UQ111", epsg=4326, rings=[_WGS84_SQUARE], records=[("도시지역", "UQA100", 1)]
    )
    region = TARGET_REGIONS_BY_DIR["seoul"]
    sources = discover_region_sources(seoul, region, tmp_path / "extract")
    result = build_load_result(
        sources, present_region_dirs={"seoul"}, reference_date="2026-05-20", encoding="cp949"
    )
    assert result.polygon_promoted_count == 1
    assert result.features[0].geometry_wkt.startswith("MULTIPOLYGON")


def test_unexpected_point_geometry_is_rejected(tmp_path: Path) -> None:
    seoul = tmp_path / "seoul"
    write_zoning_shapefile(
        seoul,
        "UQ111",
        epsg=4326,
        rings=[_WGS84_SQUARE],
        records=[("도시지역", "UQA100", 1)],
        shape_type=shapefile.POINT,
    )
    region = TARGET_REGIONS_BY_DIR["seoul"]
    sources = discover_region_sources(seoul, region, tmp_path / "extract")
    result = build_load_result(
        sources, present_region_dirs={"seoul"}, reference_date="2026-05-20", encoding="cp949"
    )
    assert result.accepted_feature_count == 0
    assert result.rejected_feature_count == 1


def test_invalid_polygon_geometry_is_reported(tmp_path: Path) -> None:
    seoul = tmp_path / "seoul"
    write_zoning_shapefile(
        seoul, "UQ111", epsg=4326, rings=[_BOWTIE], records=[("도시지역", "UQA100", 1)]
    )
    region = TARGET_REGIONS_BY_DIR["seoul"]
    sources = discover_region_sources(seoul, region, tmp_path / "extract")
    result = build_load_result(
        sources, present_region_dirs={"seoul"}, reference_date="2026-05-20", encoding="cp949"
    )
    assert result.rejected_feature_count == 1
    assert any("Invalid polygon" in warning for warning in result.warnings)


# --------------------------------------------------------------------------- #
# Coverage + region filtering (via the full dry-run path)
# --------------------------------------------------------------------------- #


def _make_capital_region_tree(root: Path) -> None:
    write_zoning_shapefile(
        root / "seoul",
        "UQ111",
        epsg=5179,
        rings=[_SEOUL_5179_SQUARE],
        records=[("도시지역", "UQA100", 1)],
    )
    write_zoning_shapefile(
        root / "incheon",
        "UQ111",
        epsg=5179,
        rings=[_SEOUL_5179_SQUARE],
        records=[("도시지역", "UQA100", 1)],
    )
    write_zoning_shapefile(
        root / "gyeonggi",
        "UQ111",
        epsg=5179,
        rings=[_SEOUL_5179_SQUARE],
        records=[("도시지역", "UQA100", 1)],
    )


def test_dry_run_evaluates_all_three_regions_without_writing(tmp_path: Path) -> None:
    root = tmp_path / "zoning"
    _make_capital_region_tree(root)
    report = run_zoning_ingestion(
        _settings(),
        source_path=str(root),
        reference_date="2026-05-20",
        scope="capital-region",
        write=False,
    )
    assert report.mode == "dry-run"
    assert report.status == "VALIDATED"
    assert report.features_inserted == 0
    assert set(report.regions_evaluated) == {"seoul", "incheon", "gyeonggi"}
    assert report.coverage_status == "COMPLETE"


def test_honest_zero_occurrence_is_not_not_evaluated(tmp_path: Path) -> None:
    root = tmp_path / "zoning"
    _make_capital_region_tree(root)
    report = run_zoning_ingestion(
        _settings(),
        source_path=str(root),
        reference_date="2026-05-20",
        scope="capital-region",
        write=False,
    )
    # Seoul provided only UQ111; UQ112 (관리지역) has no source there.
    seoul_layers = report.coverage_matrix["seoul"]["layers"]
    assert seoul_layers["UQ111"]["status"] == "EVALUATED_WITH_FEATURES"
    assert seoul_layers["UQ112"]["status"] == "SOURCE_MISSING"


def test_only_capital_region_directories_are_read(tmp_path: Path) -> None:
    root = tmp_path / "zoning"
    _make_capital_region_tree(root)
    # An out-of-scope 시도 directory must be ignored, not ingested.
    write_zoning_shapefile(
        root / "busan",
        "UQ111",
        epsg=5179,
        rings=[_SEOUL_5179_SQUARE],
        records=[("도시지역", "UQA100", 1)],
    )
    report = run_zoning_ingestion(
        _settings(),
        source_path=str(root),
        reference_date="2026-05-20",
        scope="capital-region",
        write=False,
    )
    assert "busan" not in report.coverage_matrix
    assert set(report.coverage_matrix) == {"seoul", "incheon", "gyeonggi"}


def test_source_metadata_is_sanitized_of_local_paths(tmp_path: Path) -> None:
    root = tmp_path / "zoning"
    _make_capital_region_tree(root)
    report = run_zoning_ingestion(
        _settings(),
        source_path=str(root),
        reference_date="2026-05-20",
        scope="capital-region",
        write=False,
    )
    serialized = json.dumps(report.source_files, ensure_ascii=False)
    # Only base filenames are recorded; the absolute fixture path never leaks.
    assert str(tmp_path) not in serialized
    for entry in report.source_files:
        assert "/" not in entry["origin_filename"]


def test_no_production_fallback_when_sources_absent(tmp_path: Path) -> None:
    empty = tmp_path / "zoning"
    empty.mkdir()
    report = run_zoning_ingestion(
        _settings(),
        source_path=str(empty),
        reference_date="2026-05-20",
        scope="capital-region",
        write=False,
    )
    assert report.status == "NO_SOURCE_FILES"
    assert report.accepted_feature_count == 0
    assert report.required_sources  # tells the operator exactly what to place
    assert report.next_command is not None


def test_ignored_local_directory_expectations() -> None:
    # The zoning data directories live under the repository's ignored data tree.
    repo_root = Path(__file__).resolve().parents[2]
    gitignore = (repo_root / ".gitignore").read_text(encoding="utf-8")
    for rule in ("data/raw/", "data/interim/", "data/processed/"):
        assert rule in gitignore
