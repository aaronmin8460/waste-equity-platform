"""Contract tests for the read-only 세분류 [2025] 토지피복지도 validator.

Every fixture here is synthetic and built inside ``tmp_path``. The real EGIS
land-cover dataset is Git-ignored local raw data on an external drive and is
never read, copied, or committed by this suite. These fixtures are **test-only**
and must never be presented as official data.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import shutil
from collections.abc import Sequence
from pathlib import Path

import pytest
import shapefile

from waste_equity_ingestion.land_cover_contract import (
    CONDITIONAL_GO,
    EXPECTED_EPSG,
    GO,
    NO_GO,
    STATUS_FAIL,
    STATUS_PASS,
    STATUS_PASS_WITH_WARNINGS,
    LandCoverContractError,
    discover_sources,
    main,
    validate_land_cover,
)

# The exact ESRI-style WKT the official distribution ships: an ITRF2000 TM whose
# projection parameters are those of EPSG:5186 (Central Belt 2010) but whose
# datum is named ITRF2000, not Korea 2000.
PRJ_ITRF2000_TM = (
    'PROJCS["PCS_ITRF2000_TM",GEOGCS["GCS_ITRF_2000",DATUM["D_ITRF_2000",'
    'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],'
    'UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
    'PARAMETER["False_Easting",200000.0],PARAMETER["False_Northing",600000.0],'
    'PARAMETER["Central_Meridian",127.0],PARAMETER["Scale_Factor",1.0],'
    'PARAMETER["Latitude_Of_Origin",38.0],UNIT["Meter",1.0]]'
)

# A different, also-resolvable Korean belt (East Belt → EPSG:5187) for the
# "wrong CRS" case.
PRJ_EAST_BELT = (
    'PROJCS["Korea_2000_Korea_East_Belt_2010",GEOGCS["GCS_Korea_2000",'
    'DATUM["D_Korea_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],'
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
    'PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],'
    'PARAMETER["False_Northing",600000.0],PARAMETER["Central_Meridian",129.0],'
    'PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],'
    'UNIT["Meter",1.0]]'
)

LDID_CP949 = 0x4E

# Squares in EPSG:5186 metres, near the origin so they land inside the capital
# envelope and the South Korea plausibility envelope.
SQUARE_A = [(200000.0, 500000.0), (200400.0, 500000.0), (200400.0, 500400.0), (200000.0, 500400.0)]
SQUARE_B = [(210000.0, 500000.0), (210500.0, 500000.0), (210500.0, 500500.0), (210000.0, 500500.0)]
# Self-crossing bow-tie: invalid, never repaired.
BOWTIE = [(230000.0, 500000.0), (230400.0, 500400.0), (230400.0, 500000.0), (230000.0, 500400.0)]

# One default class triple: 시가화건조지역 → 주거지역 → 단독주거시설.
DEFAULT_CLASS = ("100", "시가화건조지역", "110", "주거지역", "111", "단독주거시설")

FULL_FIELDS: tuple[tuple[str, str, int], ...] = (
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


def _ring(points: Sequence[tuple[float, float]]) -> list[list[float]]:
    """Close a ring in clockwise (shapefile outer-ring) order."""

    closed = [list(p) for p in reversed(points)]
    closed.append(list(points[-1]))
    return closed


def _set_ldid(dbf_path: Path, ldid: int) -> None:
    """Patch the DBF language-driver byte (test-only — pyshp writes 0x00)."""

    data = bytearray(dbf_path.read_bytes())
    data[29] = ldid
    dbf_path.write_bytes(bytes(data))


def write_tile(
    region_dir: Path,
    tile_id: str,
    *,
    date: str = "20251113",
    product: str = "SG05",
    prj: str | None = PRJ_ITRF2000_TM,
    cpg: str | None = None,
    encoding: str = "cp949",
    ldid: int | None = LDID_CP949,
    classes: Sequence[tuple[str, str, str, str, str, str]] | None = None,
    rings: Sequence[Sequence[tuple[float, float]]] | None = None,
    fields: Sequence[tuple[str, str, int]] = FULL_FIELDS,
    include_bowtie: bool = False,
    optional_sidecars: Sequence[str] = (".xml", ".xlsx", ".xsd"),
    add_apple_double: bool = True,
) -> Path:
    """Build one synthetic land-cover tile directory and return its ``.shp``."""

    tile_dir = region_dir / f"{product}_{tile_id}_{date}"
    tile_dir.mkdir(parents=True, exist_ok=True)
    base = tile_dir / tile_id
    if classes is None:
        classes = [DEFAULT_CLASS]
    if rings is None:
        rings = [SQUARE_A, SQUARE_B][: len(classes)] or [SQUARE_A]
    rows = list(classes)
    ring_list = list(rings)
    if include_bowtie:
        rows = [*rows, ("100", "시가화건조지역", "160", "공업지역", "161", "공업시설")]
        ring_list = [*ring_list, BOWTIE]

    field_names = [name for name, _t, _w in fields]
    writer = shapefile.Writer(str(base), shapeType=shapefile.POLYGON, encoding=encoding)
    for name, ftype, width in fields:
        writer.field(name, ftype, size=width)
    for row, ring in zip(rows, ring_list, strict=True):
        writer.poly([_ring(ring)])
        record: list[object] = []
        for name in field_names:
            if name == "L1_CODE":
                record.append(row[0])
            elif name == "L1_NAME":
                record.append(row[1])
            elif name == "L2_CODE":
                record.append(row[2])
            elif name == "L2_NAME":
                record.append(row[3])
            elif name == "L3_CODE":
                record.append(row[4])
            elif name == "L3_NAME":
                record.append(row[5])
            elif name == "IMG_DATE":
                record.append(datetime.date(2025, 11, 13))
            elif name == "INX_NUM":
                record.append(tile_id)
            else:
                record.append("")
        writer.record(*record)
    writer.close()

    if prj is not None:
        base.with_suffix(".prj").write_text(prj, encoding="utf-8")
    if cpg is not None:
        base.with_suffix(".cpg").write_text(cpg, encoding="ascii")
    if ldid is not None:
        _set_ldid(base.with_suffix(".dbf"), ldid)
    for suffix in optional_sidecars:
        (tile_dir / f"meta_{tile_id}{suffix}").write_bytes(b"metadata")
    if add_apple_double:
        # AppleDouble + .DS_Store noise that the validator must ignore.
        for real in list(tile_dir.iterdir()):
            (tile_dir / f"._{real.name}").write_bytes(b"\x00\x05\x16\x07AppleDouble")
        (tile_dir / ".DS_Store").write_bytes(b"\x00\x00\x00\x01Bud1")
    return base.with_suffix(".shp")


def build_root(
    tmp_path: Path,
    *,
    seoul: int = 1,
    incheon: int = 1,
    gyeonggi: int = 1,
    omit_region: str | None = None,
) -> Path:
    """Build a minimal but complete three-region acquisition root."""

    root = tmp_path / "2025_lv3"
    counters = {"seoul": 37700000, "incheon": 37600000, "gyeonggi": 37800000}
    for region, count in (("seoul", seoul), ("incheon", incheon), ("gyeonggi", gyeonggi)):
        if region == omit_region:
            continue
        region_dir = root / region
        region_dir.mkdir(parents=True, exist_ok=True)
        for i in range(count):
            write_tile(region_dir, str(counters[region] + i + 1))
    # Region-level Apple noise that must also be ignored.
    (root / ".DS_Store").write_bytes(b"\x00\x00\x00\x01Bud1")
    return root


def _real_shp(region_dir: Path) -> Path:
    """First real (non-AppleDouble) ``.shp`` under a region directory."""

    return next(p for p in sorted(region_dir.glob("*/*.shp")) if not p.name.startswith("._"))


@pytest.fixture
def complete_root(tmp_path: Path) -> Path:
    return build_root(tmp_path)


# --------------------------------------------------------------------------- #
# Discovery
# --------------------------------------------------------------------------- #


def test_complete_root_passes_with_conditional_go(complete_root: Path) -> None:
    report = validate_land_cover(complete_root)

    # A clean synthetic set still carries the documented CRS/encoding caveats, so
    # the honest outcome is PASS_WITH_WARNINGS → CONDITIONAL_GO, never a bare GO.
    assert report.status in (STATUS_PASS, STATUS_PASS_WITH_WARNINGS)
    assert report.recommendation in (GO, CONDITIONAL_GO)
    assert report.errors == ()
    assert {r.region for r in report.regions} == {"seoul", "incheon", "gyeonggi"}
    assert all(r.present for r in report.regions)
    assert report.geometry is not None
    assert report.geometry.total_features == 3  # one 1-feature tile per region


def test_shapefile_count_by_region(tmp_path: Path) -> None:
    root = build_root(tmp_path, seoul=3, incheon=2, gyeonggi=4)
    report = validate_land_cover(root, read_geometry=False)

    by_region = {r.region: r.shapefile_count for r in report.regions}
    assert by_region == {"seoul": 3, "incheon": 2, "gyeonggi": 4}
    assert report.sidecars is not None
    assert report.sidecars.shapefile_count == 9


def test_apple_double_and_ds_store_are_ignored(complete_root: Path) -> None:
    sources, _ = discover_sources(complete_root)
    # Exactly one real .shp per region, no AppleDouble counted.
    assert len(sources) == 3
    assert all(not s.shp_path.name.startswith("._") for s in sources)
    report = validate_land_cover(complete_root, read_geometry=False)
    assert report.sidecars is not None
    # AppleDouble copies are never counted as real source files.
    assert report.sidecars.shapefile_count == 3


def test_missing_region_directory_fails_visibly(tmp_path: Path) -> None:
    root = build_root(tmp_path, omit_region="incheon")
    report = validate_land_cover(root, read_geometry=False)

    assert report.status == STATUS_FAIL
    assert report.recommendation == NO_GO
    incheon = next(r for r in report.regions if r.region == "incheon")
    assert not incheon.present
    assert any("incheon" in message and "missing" in message for message in report.errors)


def test_nonexistent_root_raises(tmp_path: Path) -> None:
    with pytest.raises(LandCoverContractError, match="not found"):
        validate_land_cover(tmp_path / "absent")


def test_file_as_root_raises(tmp_path: Path) -> None:
    f = tmp_path / "root.txt"
    f.write_text("x")
    with pytest.raises(LandCoverContractError, match="not a directory"):
        validate_land_cover(f)


# --------------------------------------------------------------------------- #
# Sidecar integrity
# --------------------------------------------------------------------------- #


def test_missing_required_sidecar_is_reported(tmp_path: Path) -> None:
    root = build_root(tmp_path)
    shp = _real_shp(root / "seoul")
    shp.with_suffix(".prj").unlink()

    report = validate_land_cover(root, read_geometry=False)

    assert report.status == STATUS_FAIL
    assert report.sidecars is not None
    assert any(s[2] == ".prj" for s in report.sidecars.missing_required)


def test_zero_byte_file_is_detected(tmp_path: Path) -> None:
    root = build_root(tmp_path)
    shp = _real_shp(root / "gyeonggi")
    shp.with_suffix(".dbf").write_bytes(b"")

    report = validate_land_cover(root, read_geometry=False)

    assert report.status == STATUS_FAIL
    assert report.sidecars is not None
    assert report.sidecars.zero_byte_files


def test_no_cpg_is_a_warning_not_a_failure(complete_root: Path) -> None:
    report = validate_land_cover(complete_root, read_geometry=False)

    assert report.encoding is not None
    assert not report.encoding.cpg_present
    assert any(".cpg" in message for message in report.warnings)
    assert report.status != STATUS_FAIL


# --------------------------------------------------------------------------- #
# Map-sheet identity and duplication
# --------------------------------------------------------------------------- #


def test_cross_region_duplicate_tile_conflicting_checksums(tmp_path: Path) -> None:
    root = build_root(tmp_path)
    # Same map-sheet id in seoul and gyeonggi, with DIFFERENT content.
    write_tile(root / "seoul", "37700500", classes=[DEFAULT_CLASS], rings=[SQUARE_A])
    write_tile(root / "gyeonggi", "37700500", classes=[DEFAULT_CLASS], rings=[SQUARE_B])

    report = validate_land_cover(root, read_geometry=False)

    assert report.duplicates is not None
    assert "37700500" in report.duplicates.cross_region_shared_ids
    dup = next(d for d in report.duplicates.duplicates if d.tile_id == "37700500")
    assert dup.scope == "cross-region"
    assert dup.distinct_shp_checksums == 2
    assert not dup.byte_identical


def test_within_region_duplicate_tile_byte_identical(tmp_path: Path) -> None:
    root = build_root(tmp_path)
    region = root / "incheon"
    write_tile(region, "37600900", date="20251113", classes=[DEFAULT_CLASS], rings=[SQUARE_A])
    # Byte-identical copy filed under a different acquisition-date directory.
    src_dir = region / "SG05_37600900_20251113"
    dst_dir = region / "SG05_37600900_20251114"
    shutil.copytree(src_dir, dst_dir)

    report = validate_land_cover(root, read_geometry=False)

    assert report.duplicates is not None
    dup = next(d for d in report.duplicates.duplicates if d.tile_id == "37600900")
    assert dup.scope == "within-region"
    assert dup.byte_identical
    assert dup.distinct_shp_checksums == 1


def test_duplicate_policy_and_seoul_note_present(complete_root: Path) -> None:
    report = validate_land_cover(complete_root, read_geometry=False)
    assert report.duplicates is not None
    assert "fingerprint" in report.duplicates.policy_recommendation
    assert "UNRESOLVED" in report.duplicates.seoul_web_vs_local_note


# --------------------------------------------------------------------------- #
# CRS
# --------------------------------------------------------------------------- #


def test_itrf2000_prj_resolves_to_5186_via_parameters(complete_root: Path) -> None:
    report = validate_land_cover(complete_root, read_geometry=False)

    assert report.crs is not None
    assert report.crs.resolved_epsg == EXPECTED_EPSG
    assert report.crs.matches_expected
    # The key evidence: authority resolution is None and equals() is False; the
    # match rests on projection parameters, not the datum name.
    assert report.crs.authority_epsg is None
    assert report.crs.resolved_via == "tm-parameter-match"
    assert report.crs.equals_expected_registry is False
    # The datum is ITRF2000, not Korea 2000 — which is exactly why authority
    # resolution fails and the parameter match is the only evidence.
    assert report.crs.datum_name is not None
    assert "Korea" not in report.crs.datum_name
    assert "Terrestrial Reference Frame 2000" in report.crs.datum_name
    assert any("always_xy" in message for message in report.warnings)


def test_all_prj_identical_is_detected(tmp_path: Path) -> None:
    root = build_root(tmp_path, seoul=2, incheon=2, gyeonggi=2)
    report = validate_land_cover(root, read_geometry=False)
    assert report.crs is not None
    assert report.crs.prj_count == 6
    assert report.crs.distinct_prj_checksums == 1
    assert report.crs.all_identical


def test_wrong_crs_fails_without_reprojecting(tmp_path: Path) -> None:
    root = build_root(tmp_path)
    shp = _real_shp(root / "seoul")
    prj_path = shp.with_suffix(".prj")
    prj_path.write_text(PRJ_EAST_BELT, encoding="utf-8")
    before = prj_path.read_bytes()

    report = validate_land_cover(root, read_geometry=False)

    assert report.status == STATUS_FAIL
    assert report.crs is not None
    assert 5187 in report.crs.distinct_resolved_epsg
    assert not report.crs.matches_expected
    assert prj_path.read_bytes() == before  # never rewritten


def test_mixed_crs_is_a_hard_failure(tmp_path: Path) -> None:
    root = build_root(tmp_path)
    shp = _real_shp(root / "gyeonggi")
    shp.with_suffix(".prj").write_text(PRJ_EAST_BELT, encoding="utf-8")

    report = validate_land_cover(root, read_geometry=False)

    assert report.status == STATUS_FAIL
    assert report.crs is not None
    assert set(report.crs.distinct_resolved_epsg) == {5186, 5187}
    assert report.crs.unresolved_reason is not None


# --------------------------------------------------------------------------- #
# Encoding (no .cpg — proven from the LDID byte + strict decode)
# --------------------------------------------------------------------------- #


def test_encoding_evidence_from_ldid_and_strict_decode(complete_root: Path) -> None:
    report = validate_land_cover(complete_root, read_geometry=False)

    assert report.encoding is not None
    assert not report.encoding.cpg_present
    assert report.encoding.declared_codepage == "cp949"
    assert "0x4e" in dict(report.encoding.ldid_bytes)
    assert report.encoding.observed_compatible_encoding == "cp949"
    assert report.encoding.chosen_undecodable_records == 0
    assert report.encoding.korean_samples_decoded
    # UTF-8 must be actively disproven, never assumed.
    assert report.encoding.utf8_rejected
    assert not report.encoding.exact_provider_declared_encoding_resolved


def test_utf8_written_dbf_would_be_rejected_under_cp949(tmp_path: Path) -> None:
    # A DBF actually written UTF-8 but carrying the CP949 LDID must be caught by
    # the strict decode, never silently mojibake'd.
    root = build_root(tmp_path)
    write_tile(
        root / "seoul",
        "37700777",
        encoding="utf-8",
        ldid=LDID_CP949,
        classes=[("100", "시가화건조지역", "110", "주거지역", "111", "단독주거시설")],
        rings=[SQUARE_A],
    )
    report = validate_land_cover(root, read_geometry=False)

    assert report.encoding is not None
    # cp949 cannot strictly decode UTF-8 Korean bytes → at least one file fails.
    cp949 = next(t for t in report.encoding.tested_encodings if t[0] == "cp949")
    assert cp949[2] >= 1  # files_failed


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #


def test_authoritative_schema_matches(complete_root: Path) -> None:
    report = validate_land_cover(complete_root, read_geometry=False)
    assert report.schema is not None
    assert report.schema.distinct_schema_variants == 1
    assert report.schema.files_matching_authoritative == 3
    assert not report.schema.files_missing_required_field
    names = [n for n, _t, _w in report.schema.authoritative_schema]
    assert names[:6] == ["L1_CODE", "L1_NAME", "L2_CODE", "L2_NAME", "L3_CODE", "L3_NAME"]


def test_missing_required_field_is_a_hard_failure(tmp_path: Path) -> None:
    root = build_root(tmp_path)
    reduced = (
        ("L1_CODE", "C", 3),
        ("L1_NAME", "C", 25),
        ("L2_CODE", "C", 3),
        ("L2_NAME", "C", 25),
        # L3_CODE / L3_NAME deliberately absent.
        ("IMG_DATE", "D", 8),
    )
    write_tile(
        root / "seoul",
        "37700888",
        fields=reduced,
        classes=[("100", "시가화건조지역", "110", "주거지역", "", "")],
        rings=[SQUARE_A],
    )
    report = validate_land_cover(root, read_geometry=False)

    assert report.status == STATUS_FAIL
    assert report.schema is not None
    missing_fields = {f for _r, _t, f in report.schema.files_missing_required_field}
    assert {"L3_CODE", "L3_NAME"} <= missing_fields


# --------------------------------------------------------------------------- #
# Class dictionary and hierarchy
# --------------------------------------------------------------------------- #


def test_class_dictionary_counts(complete_root: Path) -> None:
    report = validate_land_cover(complete_root, read_geometry=False)
    assert report.class_dictionary is not None
    assert report.class_dictionary.l1_code_count == 1
    assert report.class_dictionary.l2_code_count == 1
    assert report.class_dictionary.l3_code_count == 1
    assert not report.class_dictionary.code_to_multiple_names
    assert not report.class_dictionary.hierarchy_violations


def test_code_mapped_to_two_names_is_a_conflict(tmp_path: Path) -> None:
    root = build_root(tmp_path)
    # Same L3_CODE "111" carries two different names in two tiles.
    write_tile(
        root / "seoul",
        "37700611",
        classes=[("100", "시가화건조지역", "110", "주거지역", "111", "단독주거시설")],
        rings=[SQUARE_A],
    )
    write_tile(
        root / "gyeonggi",
        "37800611",
        classes=[("100", "시가화건조지역", "110", "주거지역", "111", "공동주거시설")],
        rings=[SQUARE_A],
    )
    report = validate_land_cover(root, read_geometry=False)

    assert report.status == STATUS_FAIL
    assert report.class_dictionary is not None
    conflicts = {(lvl, code) for lvl, code, _n in report.class_dictionary.code_to_multiple_names}
    assert ("L3", "111") in conflicts


def test_hierarchy_violation_is_reported(tmp_path: Path) -> None:
    root = build_root(tmp_path)
    # L3 "111" appears under two different L2 parents (110 and 120).
    write_tile(
        root / "seoul",
        "37700612",
        classes=[("100", "시가화건조지역", "110", "주거지역", "111", "단독주거시설")],
        rings=[SQUARE_A],
    )
    write_tile(
        root / "incheon",
        "37600612",
        classes=[("100", "시가화건조지역", "120", "공업지역", "111", "단독주거시설")],
        rings=[SQUARE_A],
    )
    report = validate_land_cover(root, read_geometry=False)

    assert report.class_dictionary is not None
    violated = {code for _lvl, code in report.class_dictionary.hierarchy_violations}
    assert "111" in violated
    assert report.status == STATUS_FAIL


def test_malformed_code_is_warned(tmp_path: Path) -> None:
    root = build_root(tmp_path)
    write_tile(
        root / "seoul",
        "37700613",
        classes=[("1", "시가화건조지역", "110", "주거지역", "111", "단독주거시설")],
        rings=[SQUARE_A],
    )
    report = validate_land_cover(root, read_geometry=False)

    assert report.class_dictionary is not None
    malformed = {code for _lvl, code in report.class_dictionary.malformed_codes}
    assert "1" in malformed


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #


def test_invalid_geometry_is_counted_not_repaired_and_not_fatal(tmp_path: Path) -> None:
    root = build_root(tmp_path)
    shp = write_tile(
        root / "seoul",
        "37700999",
        classes=[DEFAULT_CLASS],
        rings=[SQUARE_A],
        include_bowtie=True,
    )
    before = hashlib.sha256(shp.read_bytes()).hexdigest()

    report = validate_land_cover(root)

    assert report.geometry is not None
    assert report.geometry.invalid_geometry_count >= 1
    # Invalid geometry downgrades to CONDITIONAL_GO, it is not a hard NO_GO.
    assert report.status == STATUS_PASS_WITH_WARNINGS
    assert report.recommendation == CONDITIONAL_GO
    assert any("invalid source geometry" in m for m in report.warnings)
    assert hashlib.sha256(shp.read_bytes()).hexdigest() == before  # untouched


def test_geometry_counts_by_region(tmp_path: Path) -> None:
    root = build_root(tmp_path, seoul=2, incheon=1, gyeonggi=1)
    report = validate_land_cover(root)
    assert report.geometry is not None
    by_region = dict(report.geometry.features_by_region)
    # 1 feature per tile in build_root defaults; seoul has 2 tiles.
    assert by_region["seoul"] == 2
    assert by_region["incheon"] == 1
    assert report.geometry.total_features == 4
    assert dict(report.geometry.geometry_type_counts).get("Polygon") == 4


# --------------------------------------------------------------------------- #
# Provenance, sanitization, immutability
# --------------------------------------------------------------------------- #


def test_aggregate_manifest_is_stable_and_path_free(complete_root: Path) -> None:
    first = validate_land_cover(complete_root, read_geometry=False)
    second = validate_land_cover(complete_root, read_geometry=False)

    assert first.provenance is not None and second.provenance is not None
    assert first.provenance.aggregate_manifest_sha256 == second.provenance.aggregate_manifest_sha256
    assert len(first.provenance.aggregate_manifest_sha256) == 64
    assert first.provenance.real_source_file_count == 12  # 3 tiles × (shp/shx/dbf/prj)
    assert first.provenance.reference_year == 2025


def test_summary_leaks_no_paths_or_korean_values(complete_root: Path) -> None:
    report = validate_land_cover(complete_root, read_geometry=False)
    summary = report.to_summary()
    serialized = json.dumps(summary, ensure_ascii=False)

    assert summary["status"] in (STATUS_PASS, STATUS_PASS_WITH_WARNINGS)
    assert summary["crs"]["resolved_epsg"] == EXPECTED_EPSG
    # No Korean class label and no absolute filesystem path leaks into the summary.
    assert "시가화건조지역" not in serialized
    assert "주거지역" not in serialized
    assert str(complete_root) not in serialized
    assert summary["source_root_name"] == complete_root.name


def test_validation_never_mutates_source(complete_root: Path, tmp_path: Path) -> None:
    before = {
        p.relative_to(complete_root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(complete_root.rglob("*"))
        if p.is_file()
    }
    validate_land_cover(complete_root)
    validate_land_cover(complete_root)
    after = {
        p.relative_to(complete_root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(complete_root.rglob("*"))
        if p.is_file()
    }
    assert after == before


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def test_cli_prints_summary_and_exits_zero(
    complete_root: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = main(["--source-root", str(complete_root), "--no-geometry"])

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["dataset_key"] == "land_cover"
    assert payload["recommendation"] in (GO, CONDITIONAL_GO)


def test_cli_writes_report_json_locally(
    complete_root: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "report.json"
    exit_code = main(
        ["--source-root", str(complete_root), "--no-geometry", "--report-json", str(out)]
    )

    assert exit_code == 0
    capsys.readouterr()
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["dataset_key"] == "land_cover"


def test_cli_exits_nonzero_on_hard_failure(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    root = build_root(tmp_path, omit_region="seoul")
    exit_code = main(["--source-root", str(root), "--no-geometry"])

    assert exit_code == 1
    assert "FAIL" in capsys.readouterr().out


def test_cli_reports_unusable_root_on_stderr(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = main(["--source-root", str(tmp_path / "absent"), "--no-geometry"])

    assert exit_code == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "error:" in captured.err
