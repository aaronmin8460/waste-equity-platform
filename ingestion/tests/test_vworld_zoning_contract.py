"""Pure-logic tests for the VWorld zoning ingestion contract (no DB, no I/O).

All geometries here are synthetic test fixtures, never official data.
"""

from __future__ import annotations

import pytest
from shapely import affinity
from shapely.geometry.multipolygon import MultiPolygon
from shapely.geometry.point import Point
from shapely.geometry.polygon import Polygon

from waste_equity_ingestion.vworld_zoning_contract import (
    SUPPORTED_SOURCE_EPSG,
    ZONING_LAYERS_BY_CODE,
    GeometryValidationError,
    UnsupportedCrsError,
    classify_region_layer,
    epsg_from_prj,
    feature_fingerprint,
    normalize_polygonal_geometry,
    region_for_dir_name,
    require_supported_source_crs,
    validate_required_attributes,
    zoning_layer_for_name,
)

# Synthetic (fixture) unit square in EPSG:4326 space.
_SQUARE = Polygon([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)])


def test_uq111_to_uq114_mapping_is_exhaustive_and_correct() -> None:
    assert ZONING_LAYERS_BY_CODE["UQ111"].zoning_category == "URBAN"
    assert ZONING_LAYERS_BY_CODE["UQ111"].zoning_name == "도시지역"
    assert ZONING_LAYERS_BY_CODE["UQ112"].zoning_category == "MANAGEMENT"
    assert ZONING_LAYERS_BY_CODE["UQ112"].zoning_name == "관리지역"
    assert ZONING_LAYERS_BY_CODE["UQ113"].zoning_category == "AGRICULTURAL_FOREST"
    assert ZONING_LAYERS_BY_CODE["UQ113"].zoning_name == "농림지역"
    assert ZONING_LAYERS_BY_CODE["UQ114"].zoning_category == "NATURAL_ENV_CONSERVATION"
    assert ZONING_LAYERS_BY_CODE["UQ114"].zoning_name == "자연환경보전지역"


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("LT_C_UQ111", "UQ111"),
        ("seoul_uq113_2026", "UQ113"),
        ("UQ114.shp", "UQ114"),
        ("lt-c-uq112-gyeonggi", "UQ112"),
    ],
)
def test_source_layer_identifier_mapping(name: str, expected: str) -> None:
    spec = zoning_layer_for_name(name)
    assert spec is not None
    assert spec.layer_code == expected
    assert spec.layer_identifier == f"LT_C_{expected}"


def test_non_zoning_layer_is_not_guessed() -> None:
    assert zoning_layer_for_name("moctlink_roads") is None
    assert zoning_layer_for_name("dt_d160_ownership") is None


def test_region_for_dir_name() -> None:
    assert region_for_dir_name("seoul").sido_code == "11"  # type: ignore[union-attr]
    assert region_for_dir_name("Incheon").sido_code == "28"  # type: ignore[union-attr]
    assert region_for_dir_name("gyeonggi").sido_name == "경기도"  # type: ignore[union-attr]
    assert region_for_dir_name("busan") is None


def test_source_crs_detection_from_prj() -> None:
    from pyproj import CRS

    prj = CRS.from_epsg(5179).to_wkt()
    assert epsg_from_prj(prj) == 5179


# Real official LSMD .prj WKT (Korea 2000 / Central Belt 2010). pyproj cannot
# map it to an EPSG code, but it declares its own AUTHORITY["EPSG","5186"].
_LSMD_ESRI_PRJ = (
    'PROJCS["Korea 2000 / Central Belt 2010", GEOGCS["Korea 2000", '
    'DATUM["Geocentric datum of Korea", SPHEROID["GRS 1980", 6378137.0, '
    '298.257222101, AUTHORITY["EPSG","7019"]], TOWGS84[0.0, 0.0, 0.0, 0.0, 0.0, '
    '0.0, 0.0], AUTHORITY["EPSG","6737"]], PRIMEM["Greenwich", 0.0, '
    'AUTHORITY["EPSG","8901"]], UNIT["degree", 0.017453292519943295], '
    'AXIS["Geodetic longitude", EAST], AXIS["Geodetic latitude", NORTH], '
    'AUTHORITY["EPSG","4737"]], PROJECTION["Transverse_Mercator", '
    'AUTHORITY["EPSG","9807"]], PARAMETER["central_meridian", 127.0], '
    'PARAMETER["latitude_of_origin", 38.0], PARAMETER["scale_factor", 1.0], '
    'PARAMETER["false_easting", 200000.0], PARAMETER["false_northing", 600000.0], '
    'UNIT["m", 1.0], AXIS["Easting", EAST], AXIS["Northing", NORTH], '
    'AUTHORITY["EPSG","5186"]]'
)


def test_esri_prj_epsg_authority_is_honored() -> None:
    # The official LSMD WKT is unresolvable by pyproj.to_epsg() yet declares its
    # own EPSG:5186 authority; that declared top-level authority must be honored.
    assert epsg_from_prj(_LSMD_ESRI_PRJ) == 5186
    assert require_supported_source_crs(epsg_from_prj(_LSMD_ESRI_PRJ)) == "EPSG:5186"


def test_missing_crs_is_rejected_not_guessed() -> None:
    assert epsg_from_prj("") is None
    assert epsg_from_prj("   ") is None
    with pytest.raises(UnsupportedCrsError):
        require_supported_source_crs(None)


def test_unsupported_crs_is_rejected() -> None:
    assert 3857 not in SUPPORTED_SOURCE_EPSG
    with pytest.raises(UnsupportedCrsError):
        require_supported_source_crs(3857)


def test_supported_crs_returns_canonical_string() -> None:
    assert require_supported_source_crs(5186) == "EPSG:5186"


def test_polygon_is_promoted_to_multipolygon() -> None:
    normalized, promoted = normalize_polygonal_geometry(_SQUARE)
    assert isinstance(normalized, MultiPolygon)
    assert promoted is True


def test_multipolygon_is_preserved_without_promotion() -> None:
    multi = MultiPolygon([_SQUARE])
    normalized, promoted = normalize_polygonal_geometry(multi)
    assert isinstance(normalized, MultiPolygon)
    assert promoted is False


def test_unexpected_geometry_is_rejected() -> None:
    with pytest.raises(GeometryValidationError):
        normalize_polygonal_geometry(Point(0, 0))


def test_invalid_geometry_is_reported_not_repaired() -> None:
    # A self-intersecting "bowtie" ring is invalid; it must be rejected, not
    # silently repaired into a different (legally meaningful) boundary.
    bowtie = Polygon([(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)])
    assert bowtie.is_valid is False
    with pytest.raises(GeometryValidationError):
        normalize_polygonal_geometry(bowtie)


def test_no_dbf_attribute_is_required_for_bulk_zoning() -> None:
    # Official LSMD bulk zoning shapefiles carry no zone-name column; the zone
    # type is the layer itself, so no per-feature DBF attribute is mandatory.
    assert validate_required_attributes({"mnum": "1", "ntfdate": "20090413"}) == []
    assert validate_required_attributes({}) == []


def test_fingerprint_is_deterministic() -> None:
    attrs = {"uname": "도시지역", "ucode": "UQA100"}
    first = feature_fingerprint(
        MultiPolygon([_SQUARE]),
        layer_code="UQ111",
        target_region_code="11",
        source_attributes=attrs,
    )
    second = feature_fingerprint(
        MultiPolygon([_SQUARE]),
        layer_code="UQ111",
        target_region_code="11",
        source_attributes=dict(attrs),
    )
    assert first == second


def test_fingerprint_changes_when_geometry_changes() -> None:
    attrs = {"uname": "도시지역", "ucode": "UQA100"}
    base = feature_fingerprint(
        MultiPolygon([_SQUARE]),
        layer_code="UQ111",
        target_region_code="11",
        source_attributes=attrs,
    )
    moved = affinity.translate(_SQUARE, xoff=5.0)
    changed = feature_fingerprint(
        MultiPolygon([moved]),
        layer_code="UQ111",
        target_region_code="11",
        source_attributes=attrs,
    )
    assert base != changed


def test_fingerprint_changes_when_relevant_attribute_changes() -> None:
    base = feature_fingerprint(
        MultiPolygon([_SQUARE]),
        layer_code="UQ111",
        target_region_code="11",
        source_attributes={"uname": "도시지역", "ucode": "UQA100"},
    )
    changed = feature_fingerprint(
        MultiPolygon([_SQUARE]),
        layer_code="UQ111",
        target_region_code="11",
        source_attributes={"uname": "도시지역", "ucode": "UQA210"},
    )
    assert base != changed


def test_coverage_classification_distinguishes_zero_from_not_evaluated() -> None:
    zero = classify_region_layer(
        source_present=True, validation_failed=False, feature_count=0, evaluated=True
    )
    assert zero.status == "EVALUATED_ZERO_FEATURES"

    not_evaluated = classify_region_layer(
        source_present=False, validation_failed=False, feature_count=0, evaluated=False
    )
    assert not_evaluated.status == "SOURCE_MISSING"

    with_features = classify_region_layer(
        source_present=True, validation_failed=False, feature_count=7, evaluated=True
    )
    assert with_features.status == "EVALUATED_WITH_FEATURES"
    assert with_features.feature_count == 7

    failed = classify_region_layer(
        source_present=True, validation_failed=True, feature_count=0, evaluated=False
    )
    assert failed.status == "VALIDATION_FAILURE"
