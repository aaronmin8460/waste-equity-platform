"""Synthetic SGIS parsing tests.

These fixtures are contract examples only, not official public data.
"""

from __future__ import annotations

import pytest

from waste_equity_ingestion.errors import SchemaValidationError
from waste_equity_ingestion.sgis_contract import (
    SGIS_SOURCE_CRS,
    TARGET_CRS,
    parse_boundary_response,
    parse_population_response,
)


def _population_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {"adm_cd": "11010", "adm_nm": "종로구", "tot_ppltn": "0"}
    row.update(overrides)
    return row


def _population_payload(rows: list[dict[str, object]]) -> dict[str, object]:
    return {"errCd": 0, "errMsg": "Success", "result": rows}


def test_population_valid_zero_record() -> None:
    records = parse_population_response(
        _population_payload([_population_row()]),
        reference_year=2024,
        parent_administrative_code="11",
        expected_level="SIGUNGU",
    )

    assert records[0].population == 0
    assert records[0].source_parent_administrative_code == "11"


def test_population_missing_null_and_negative_rejections() -> None:
    for value in (None, "N/A", "-1"):
        with pytest.raises(SchemaValidationError):
            parse_population_response(
                _population_payload([_population_row(tot_ppltn=value)]),
                reference_year=2024,
                parent_administrative_code="11",
                expected_level="SIGUNGU",
            )


def test_population_duplicate_record_rejected() -> None:
    with pytest.raises(SchemaValidationError, match="duplicate"):
        parse_population_response(
            _population_payload([_population_row(), _population_row()]),
            reference_year=2024,
            parent_administrative_code="11",
            expected_level="SIGUNGU",
        )


def test_population_unexpected_level_rejected() -> None:
    with pytest.raises(SchemaValidationError, match="Unexpected"):
        parse_population_response(
            _population_payload([_population_row(adm_cd="1101011")]),
            reference_year=2024,
            parent_administrative_code="11",
            expected_level="SIGUNGU",
        )


def _feature(
    *,
    adm_cd: str = "11010",
    adm_nm: str = "서울특별시 종로구",
    geometry: dict[str, object] | None = None,
) -> dict[str, object]:
    polygon = {
        "type": "Polygon",
        "coordinates": [
            [
                [950000.0, 1950000.0],
                [950100.0, 1950000.0],
                [950100.0, 1950100.0],
                [950000.0, 1950100.0],
                [950000.0, 1950000.0],
            ]
        ],
    }
    return {
        "type": "Feature",
        "properties": {"adm_cd": adm_cd, "adm_nm": adm_nm, "x": "950050", "y": "1950050"},
        "geometry": geometry or polygon,
    }


def _boundary_payload(features: list[dict[str, object]]) -> dict[str, object]:
    return {"type": "FeatureCollection", "errCd": 0, "errMsg": "Success", "features": features}


def test_boundary_valid_feature_outputs_epsg4326_multipolygon() -> None:
    records = parse_boundary_response(
        _boundary_payload([_feature()]),
        reference_year=2024,
        parent_administrative_code="11",
        expected_level="SIGUNGU",
    )

    geometry = records[0].geometry
    minx, miny, maxx, maxy = geometry.bounds
    assert geometry.geom_type == "MultiPolygon"
    assert 120 < minx < maxx < 132
    assert 33 < miny < maxy < 39


def test_boundary_missing_properties_rejected() -> None:
    bad = _feature()
    bad.pop("properties")

    with pytest.raises(SchemaValidationError, match="properties"):
        parse_boundary_response(
            _boundary_payload([bad]),
            reference_year=2024,
            parent_administrative_code="11",
            expected_level="SIGUNGU",
        )


def test_boundary_empty_geometry_rejected() -> None:
    with pytest.raises(SchemaValidationError, match="empty"):
        parse_boundary_response(
            _boundary_payload([_feature(geometry={"type": "Polygon", "coordinates": []})]),
            reference_year=2024,
            parent_administrative_code="11",
            expected_level="SIGUNGU",
        )


def test_boundary_invalid_geometry_repaired_deterministically() -> None:
    bowtie = {
        "type": "Polygon",
        "coordinates": [
            [
                [950000.0, 1950000.0],
                [950100.0, 1950100.0],
                [950000.0, 1950100.0],
                [950100.0, 1950000.0],
                [950000.0, 1950000.0],
            ]
        ],
    }

    records = parse_boundary_response(
        _boundary_payload([_feature(geometry=bowtie)]),
        reference_year=2024,
        parent_administrative_code="11",
        expected_level="SIGUNGU",
    )

    assert records[0].geometry.is_valid
    assert records[0].repair_method == "shapely.make_valid_polygonal"


def test_boundary_source_crs_handling_rejects_mismatch() -> None:
    payload = _boundary_payload([_feature()])
    payload["crs"] = {"type": "name", "properties": {"name": "EPSG:4326"}}

    with pytest.raises(SchemaValidationError, match="CRS"):
        parse_boundary_response(
            payload,
            reference_year=2024,
            parent_administrative_code="11",
            expected_level="SIGUNGU",
            source_crs=SGIS_SOURCE_CRS,
            target_crs=TARGET_CRS,
        )


def test_boundary_duplicate_feature_rejected() -> None:
    with pytest.raises(SchemaValidationError, match="duplicate"):
        parse_boundary_response(
            _boundary_payload([_feature(), _feature()]),
            reference_year=2024,
            parent_administrative_code="11",
            expected_level="SIGUNGU",
        )
