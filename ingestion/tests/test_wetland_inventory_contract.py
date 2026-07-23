"""Contract tests for the read-only inland-wetland inventory validator.

Every fixture here is synthetic and built inside ``tmp_path``. The real
국립생태원 dataset is Git-ignored local raw data and is never read, copied, or
committed by this suite.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from collections.abc import Sequence
from pathlib import Path

import pytest
import shapefile

from waste_equity_ingestion.wetland_inventory_contract import (
    EXPECTED_EPSG,
    STATUS_FAIL,
    STATUS_PASS,
    STATUS_PASS_WITH_WARNINGS,
    WetlandInventoryContractError,
    inspect_crs,
    inspect_sidecars,
    main,
    read_declared_encoding,
    validate_wetland_inventory,
)

# ESRI-style WKT identical in shape to the official distribution's .prj:
# Korea 2000 / Central Belt 2010, false easting 200000, false northing 600000,
# central meridian 127, latitude of origin 38, metre units.
PRJ_5186 = (
    'PROJCS["Korea_2000_Korea_Central_Belt_2010",GEOGCS["GCS_Korea_2000",'
    'DATUM["D_Korea_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],'
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
    'PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],'
    'PARAMETER["False_Northing",600000.0],PARAMETER["Central_Meridian",127.0],'
    'PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],'
    'UNIT["Meter",1.0]]'
)

# A different, also-supported Korean belt so the "wrong CRS" case is realistic.
PRJ_5187 = (
    'PROJCS["Korea_2000_Korea_East_Belt_2010",GEOGCS["GCS_Korea_2000",'
    'DATUM["D_Korea_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],'
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
    'PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],'
    'PARAMETER["False_Northing",600000.0],PARAMETER["Central_Meridian",129.0],'
    'PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],'
    'UNIT["Meter",1.0]]'
)

# Squares in EPSG:5186 metres, near the origin (127°E / 38°N) so they land
# inside the South Korea plausibility envelope.
SQUARE_A = [(200000.0, 500000.0), (200400.0, 500000.0), (200400.0, 500400.0), (200000.0, 500400.0)]
SQUARE_B = [(210000.0, 500000.0), (210500.0, 500000.0), (210500.0, 500500.0), (210000.0, 500500.0)]
TINY_SQUARE = [
    (220000.0, 500000.0),
    (220010.0, 500000.0),
    (220010.0, 500010.0),
    (220000.0, 500010.0),
]
# Ring that crosses itself: a classic bow-tie, invalid but not repaired here.
BOWTIE = [(230000.0, 500000.0), (230400.0, 500400.0), (230400.0, 500000.0), (230000.0, 500400.0)]


def _ring(points: Sequence[tuple[float, float]]) -> list[list[float]]:
    """Close a ring in clockwise order — the shapefile outer-ring convention."""

    closed = [list(p) for p in reversed(points)]
    closed.append(list(points[-1]))
    return closed


def write_shapefile(
    directory: Path,
    *,
    stem: str = "Wetlands_Fixture",
    prj: str | None = PRJ_5186,
    cpg: str | None = "UTF-8",
    encoding: str = "utf-8",
    records: Sequence[tuple[str, str]] | None = None,
    rings: Sequence[Sequence[tuple[float, float]]] | None = None,
    include_bowtie: bool = False,
    include_fid: bool = True,
) -> Path:
    """Build a synthetic wetland-inventory-shaped shapefile and return its .shp."""

    directory.mkdir(parents=True, exist_ok=True)
    base = directory / stem
    if records is None:
        records = [("12-345678-9-001", "가야습지"), ("12-345678-9-002", "나루습지")]
    if rings is None:
        rings = [SQUARE_A, SQUARE_B]
    if include_bowtie:
        records = [*records, ("12-345678-9-003", "뒤틀린습지")]
        rings = [*rings, BOWTIE]

    writer = shapefile.Writer(str(base), shapeType=shapefile.POLYGON, encoding=encoding)
    if include_fid:
        writer.field("FID", "N", size=4, decimal=0)
    writer.field("CODE", "C", size=15)
    writer.field("NAME", "C", size=33)
    writer.field("SD_NN", "C", size=21)
    writer.field("AREA", "N", size=10, decimal=0)
    for index, ((code, name), ring) in enumerate(zip(records, rings, strict=True), start=1):
        writer.poly([_ring(ring)])
        if include_fid:
            writer.record(index, code, name, "경기도", 160000)
        else:
            writer.record(code, name, "경기도", 160000)
    writer.close()

    if prj is not None:
        base.with_suffix(".prj").write_text(prj, encoding="utf-8")
    if cpg is not None:
        base.with_suffix(".cpg").write_text(cpg, encoding="ascii")
    return base.with_suffix(".shp")


@pytest.fixture
def complete_set(tmp_path: Path) -> Path:
    return write_shapefile(tmp_path / "complete")


# --------------------------------------------------------------------------- #
# Sidecar completeness
# --------------------------------------------------------------------------- #


def test_complete_shapefile_set_passes(complete_set: Path) -> None:
    report = validate_wetland_inventory(complete_set)

    assert report.status == STATUS_PASS
    assert report.errors == ()
    assert report.sidecars.complete
    assert report.sidecars.missing_required == ()
    assert {f.suffix for f in report.sidecars.files} >= {".shp", ".shx", ".dbf", ".prj", ".cpg"}
    assert report.geometry is not None
    assert report.geometry.record_count == 2


@pytest.mark.parametrize("suffix", [".shx", ".dbf", ".prj", ".cpg"])
def test_missing_required_sidecar_is_reported(tmp_path: Path, suffix: str) -> None:
    shp = write_shapefile(tmp_path / f"missing{suffix.replace('.', '_')}")
    shp.with_suffix(suffix).unlink()

    report = validate_wetland_inventory(shp)

    assert report.status == STATUS_FAIL
    assert report.sidecars.missing_required == (suffix,)
    assert any(suffix in message for message in report.errors)


def test_missing_shx_skips_attribute_and_geometry_inspection(tmp_path: Path) -> None:
    shp = write_shapefile(tmp_path / "no_shx")
    shp.with_suffix(".shx").unlink()

    report = validate_wetland_inventory(shp)

    assert report.geometry is None
    assert report.schema == ()
    assert any("inspection skipped" in message for message in report.errors)


def test_missing_dbf_skips_attribute_and_geometry_inspection(tmp_path: Path) -> None:
    shp = write_shapefile(tmp_path / "no_dbf")
    shp.with_suffix(".dbf").unlink()

    report = validate_wetland_inventory(shp)

    assert report.geometry is None
    assert report.schema == ()


def test_optional_qmd_sidecar_is_reported_but_not_required(tmp_path: Path) -> None:
    shp = write_shapefile(tmp_path / "with_qmd")
    shp.with_suffix(".qmd").write_text("<qgis/>", encoding="utf-8")

    report = validate_wetland_inventory(shp)

    assert report.sidecars.present_optional == (".qmd",)
    assert report.status == STATUS_PASS


def test_non_shapefile_path_raises(tmp_path: Path) -> None:
    archive = tmp_path / "wetlands.zip"
    archive.write_bytes(b"not a shapefile")

    with pytest.raises(WetlandInventoryContractError, match="Expected a .shp file"):
        validate_wetland_inventory(archive)


def test_missing_path_raises(tmp_path: Path) -> None:
    with pytest.raises(WetlandInventoryContractError, match="not found"):
        validate_wetland_inventory(tmp_path / "absent.shp")


# --------------------------------------------------------------------------- #
# CRS
# --------------------------------------------------------------------------- #


def test_crs_is_resolved_from_esri_wkt(complete_set: Path) -> None:
    report = validate_wetland_inventory(complete_set)

    assert report.crs is not None
    assert report.crs.resolved_epsg == EXPECTED_EPSG
    assert report.crs.matches_expected
    assert report.crs.is_projected is True
    assert set(report.crs.axis_units) == {"metre"}
    assert report.crs.datum_name == "Korean Geodetic Datum 2002"
    assert report.crs.projection_method == "Transverse Mercator"
    parameters = {name: value for name, value, _ in report.crs.projection_parameters}
    assert parameters["False easting"] == pytest.approx(200000.0)
    assert parameters["False northing"] == pytest.approx(600000.0)
    assert parameters["Longitude of natural origin"] == pytest.approx(127.0)
    assert parameters["Latitude of natural origin"] == pytest.approx(38.0)


def test_unexpected_crs_fails_without_reprojecting(tmp_path: Path) -> None:
    shp = write_shapefile(tmp_path / "east_belt", prj=PRJ_5187)
    before = shp.with_suffix(".prj").read_bytes()

    report = validate_wetland_inventory(shp)

    assert report.status == STATUS_FAIL
    assert report.crs is not None
    assert report.crs.resolved_epsg == 5187
    assert not report.crs.matches_expected
    assert any("expected EPSG:5186" in message for message in report.errors)
    assert shp.with_suffix(".prj").read_bytes() == before


def test_unparseable_prj_is_reported_not_guessed(tmp_path: Path) -> None:
    shp = write_shapefile(tmp_path / "bad_prj", prj="NOT WKT AT ALL")

    report = validate_wetland_inventory(shp)

    assert report.status == STATUS_FAIL
    assert report.crs is not None
    assert report.crs.resolved_epsg is None
    assert report.crs.unresolved_reason is not None


def test_absent_prj_reports_that_projection_must_not_be_guessed() -> None:
    crs = inspect_crs(None)

    assert not crs.prj_present
    assert crs.resolved_epsg is None
    assert crs.unresolved_reason is not None
    assert "guessed" in crs.unresolved_reason


# --------------------------------------------------------------------------- #
# Encoding
# --------------------------------------------------------------------------- #


def test_declared_encoding_is_read_from_cpg(complete_set: Path) -> None:
    assert read_declared_encoding(complete_set.with_suffix(".cpg")) == "UTF-8"

    report = validate_wetland_inventory(complete_set)

    assert report.encoding is not None
    assert report.encoding.cpg_present
    assert report.encoding.declared_encoding == "UTF-8"
    assert report.encoding.decoded_strictly
    assert report.encoding.undecodable_record_count == 0


def test_korean_text_survives_declared_encoding(complete_set: Path) -> None:
    reader = shapefile.Reader(str(complete_set), encoding="utf-8", encodingErrors="strict")
    try:
        names = [record.as_dict()["NAME"] for record in reader.iterRecords()]
    finally:
        reader.close()

    assert names == ["가야습지", "나루습지"]
    assert all("�" not in name for name in names)


def test_empty_cpg_is_reported_rather_than_guessed(tmp_path: Path) -> None:
    shp = write_shapefile(tmp_path / "empty_cpg", cpg="   ")

    report = validate_wetland_inventory(shp)

    assert report.status == STATUS_FAIL
    assert report.encoding is not None
    assert report.encoding.declared_encoding is None
    assert any("must not be guessed" in message for message in report.errors)
    assert report.schema == ()


def test_undecodable_record_is_counted_not_replaced(tmp_path: Path) -> None:
    """A CP949-written DBF declared as UTF-8 must fail loudly, not mojibake."""

    shp = write_shapefile(tmp_path / "mismatched", encoding="cp949", cpg="UTF-8")

    report = validate_wetland_inventory(shp)

    assert report.status == STATUS_FAIL
    assert report.encoding is not None
    assert not report.encoding.decoded_strictly
    assert report.encoding.undecodable_record_count == 2
    assert report.encoding.decode_error is not None


# --------------------------------------------------------------------------- #
# Schema, duplicates, geometry
# --------------------------------------------------------------------------- #


def test_schema_is_extracted_with_declared_types(complete_set: Path) -> None:
    report = validate_wetland_inventory(complete_set)

    by_name = {s.name: s for s in report.schema}
    assert list(by_name) == ["FID", "CODE", "NAME", "SD_NN", "AREA"]
    assert by_name["CODE"].field_type == "C"
    assert by_name["CODE"].width == 15
    assert by_name["NAME"].width == 33
    assert by_name["AREA"].field_type == "N"
    assert by_name["AREA"].decimal == 0
    assert by_name["SD_NN"].distinct_count == 1
    assert by_name["CODE"].distinct_count == 2
    assert by_name["CODE"].empty_count == 0


def test_record_count_matches_source(complete_set: Path) -> None:
    report = validate_wetland_inventory(complete_set)

    assert report.geometry is not None
    assert report.geometry.record_count == 2
    assert report.geometry.geometry_type_counts == (("Polygon", 2),)
    assert report.geometry.null_geometry_count == 0
    assert report.geometry.empty_geometry_count == 0
    assert report.geometry.singlepart_count == 2
    assert report.geometry.multipart_count == 0


def test_unique_identifiers_report_no_duplicates(complete_set: Path) -> None:
    report = validate_wetland_inventory(complete_set)

    by_field = {d.field_name: d for d in report.duplicates}
    assert {d.field_name for d in report.duplicates} == {"CODE", "FID", "NAME"}
    assert all(d.present for d in report.duplicates)
    assert by_field["CODE"].distinct_count == 2
    assert by_field["CODE"].surplus_record_count == 0
    assert by_field["FID"].surplus_record_count == 0


def test_absent_identifier_column_is_reported_not_assumed_unique(tmp_path: Path) -> None:
    shp = write_shapefile(tmp_path / "no_fid", include_fid=False)

    report = validate_wetland_inventory(shp)

    by_field = {d.field_name: d for d in report.duplicates}
    assert not by_field["FID"].present
    assert by_field["FID"].distinct_count == 0
    assert report.status == STATUS_PASS_WITH_WARNINGS
    assert any("'FID' is not in this schema" in message for message in report.warnings)


def test_duplicate_identifiers_are_reported(tmp_path: Path) -> None:
    shp = write_shapefile(
        tmp_path / "dupes",
        records=[("12-345678-9-001", "가야습지"), ("12-345678-9-001", "나루습지")],
    )

    report = validate_wetland_inventory(shp)

    assert report.status == STATUS_FAIL
    by_field = {d.field_name: d for d in report.duplicates}
    assert by_field["CODE"].duplicated_value_count == 1
    assert by_field["CODE"].surplus_record_count == 1
    assert by_field["NAME"].surplus_record_count == 0
    assert any("'CODE' is not unique" in message for message in report.errors)


def test_invalid_geometry_is_reported_and_not_repaired(tmp_path: Path) -> None:
    shp = write_shapefile(tmp_path / "invalid", include_bowtie=True)
    before = hashlib.sha256(shp.read_bytes()).hexdigest()

    report = validate_wetland_inventory(shp)

    assert report.status == STATUS_FAIL
    assert report.geometry is not None
    assert report.geometry.record_count == 3
    assert report.geometry.invalid_geometry_count == 1
    assert report.geometry.self_intersection_count == 1
    assert report.geometry.invalid_reason_counts
    assert any("invalid geometry" in message for message in report.errors)
    assert hashlib.sha256(shp.read_bytes()).hexdigest() == before


def test_duplicate_geometry_is_a_warning_not_an_error(tmp_path: Path) -> None:
    shp = write_shapefile(
        tmp_path / "same_shape",
        records=[("12-345678-9-001", "가야습지"), ("12-345678-9-002", "나루습지")],
        rings=[SQUARE_A, SQUARE_A],
    )

    report = validate_wetland_inventory(shp)

    assert report.status == STATUS_PASS_WITH_WARNINGS
    assert report.errors == ()
    assert report.geometry is not None
    assert report.geometry.duplicate_geometry_count == 1
    assert report.geometry.surplus_duplicate_geometry_records == 1


def test_bounding_box_and_area_are_summarized(complete_set: Path) -> None:
    report = validate_wetland_inventory(complete_set)

    assert report.geometry is not None
    assert report.geometry.bounds == pytest.approx((200000.0, 500000.0, 210500.0, 500500.0))
    assert report.geometry.source_area_sum_m2 == pytest.approx(400 * 400 + 500 * 500)
    assert report.geometry.min_area_m2 == pytest.approx(400 * 400)
    assert report.geometry.max_area_m2 == pytest.approx(500 * 500)
    assert report.geometry.wgs84_bounds is not None
    west, south, east, north = report.geometry.wgs84_bounds
    assert 126.0 < west < 128.0
    assert 34.0 < south < 38.0
    assert report.geometry.within_south_korea_envelope is True


def test_tiny_polygon_is_warned_about(tmp_path: Path) -> None:
    shp = write_shapefile(
        tmp_path / "tiny",
        records=[("12-345678-9-001", "가야습지"), ("12-345678-9-002", "점습지")],
        rings=[SQUARE_A, TINY_SQUARE],
    )

    report = validate_wetland_inventory(shp)

    assert report.geometry is not None
    assert report.geometry.tiny_polygon_count == 1
    assert any("smaller than" in message for message in report.warnings)


# --------------------------------------------------------------------------- #
# Checksums, immutability, sanitized output
# --------------------------------------------------------------------------- #


def test_checksums_match_independent_digest_and_are_stable(complete_set: Path) -> None:
    first = inspect_sidecars(complete_set)
    second = inspect_sidecars(complete_set)

    assert first == second
    for entry in first.files:
        expected = hashlib.sha256((complete_set.parent / entry.filename).read_bytes()).hexdigest()
        assert entry.sha256 == expected
        assert entry.size_bytes == (complete_set.parent / entry.filename).stat().st_size


def test_validation_does_not_mutate_any_source_file(complete_set: Path, tmp_path: Path) -> None:
    pristine = tmp_path / "pristine"
    shutil.copytree(complete_set.parent, pristine)
    before = {
        path.name: (path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest())
        for path in sorted(complete_set.parent.iterdir())
    }

    validate_wetland_inventory(complete_set)
    validate_wetland_inventory(complete_set)

    after = {
        path.name: (path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest())
        for path in sorted(complete_set.parent.iterdir())
    }
    assert after == before
    assert sorted(p.name for p in pristine.iterdir()) == sorted(before)


def test_summary_is_json_safe_and_leaks_no_attribute_values(complete_set: Path) -> None:
    report = validate_wetland_inventory(complete_set)
    summary = report.to_summary()
    serialized = json.dumps(summary, ensure_ascii=False)

    # Column names and counts are present...
    assert summary["status"] == STATUS_PASS
    assert summary["crs"]["resolved_epsg"] == EXPECTED_EPSG
    assert [s["name"] for s in summary["schema"]] == ["FID", "CODE", "NAME", "SD_NN", "AREA"]
    # ...but no per-record attribute value, and no local filesystem path.
    assert "가야습지" not in serialized
    assert "12-345678-9-001" not in serialized
    assert "경기도" not in serialized
    assert str(complete_set.parent) not in serialized
    assert summary["source_filename"] == complete_set.name


def test_cli_prints_summary_and_exits_zero(
    complete_set: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = main([str(complete_set)])

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["dataset_key"] == "wetland_inventory"
    assert payload["status"] == STATUS_PASS


def test_cli_exits_nonzero_on_failure(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    shp = write_shapefile(tmp_path / "cli_fail", prj=PRJ_5187)

    exit_code = main([str(shp)])

    assert exit_code == 1
    assert "FAIL" in capsys.readouterr().out


def test_cli_reports_unusable_path_on_stderr(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = main([str(tmp_path / "absent.shp")])

    assert exit_code == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "error:" in captured.err
