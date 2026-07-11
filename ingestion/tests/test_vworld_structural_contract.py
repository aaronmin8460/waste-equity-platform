"""Fixture tests for the Phase 2.5A VWorld structural-layer probe contract.

Fixtures validate response-shape handling only; they are never presented as
real public data.
"""

import pytest

from waste_equity_ingestion.config import ProbeSettings
from waste_equity_ingestion.errors import (
    IngestionError,
    MissingCredentialsError,
    ProviderResultError,
    SchemaValidationError,
)
from waste_equity_ingestion.probes import vworld_structural
from waste_equity_ingestion.probes.vworld_structural import (
    bbox_to_geom_filter,
    extract_data_api_error,
    parse_provider_error_text,
    sanitize_params,
    sanitize_request_url,
    summarize_data_api_response,
    summarize_wfs_feature_collection,
)


def make_settings(**overrides: object) -> ProbeSettings:
    values: dict[str, object] = {
        "rcis_api_key": None,
        "rcis_user_id": None,
        "rcis_api_base_url": "https://www.recycling-info.or.kr",
        "sgis_consumer_key": None,
        "sgis_consumer_secret": None,
        "data_go_kr_service_key": None,
        "airkorea_service_key": None,
        "kma_service_key": None,
        "vworld_api_key": "fixture-not-a-real-key",
        "vworld_api_domain": None,
        "sample_dir": "unused",
    }
    values.update(overrides)
    return ProbeSettings(**values)  # type: ignore[arg-type]


def wfs_fixture(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": "lt_c_uq111.1",
                "geometry": {"type": "MultiPolygon", "coordinates": []},
                "properties": {"uname": "도시지역", "alias": None},
            }
        ],
        "totalFeatures": 5,
        "numberMatched": 5,
        "numberReturned": 1,
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::4326"}},
    }
    payload.update(overrides)
    return payload


def data_fixture(status: str = "OK", **response_overrides: object) -> dict[str, object]:
    response: dict[str, object] = {
        "status": status,
        "record": {"total": "5", "current": "1"},
        "page": {"total": "5", "current": "1", "size": "1"},
        "result": {
            "featureCollection": {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "id": "LT_C_UQ111.1",
                        "geometry": {"type": "MultiPolygon", "coordinates": []},
                        "properties": {"uname": "도시지역"},
                    }
                ],
            }
        },
    }
    response.update(response_overrides)
    return {"response": response}


def test_request_url_sanitization_strips_credentials() -> None:
    url = (
        "https://api.vworld.kr/req/wfs?service=wfs&key=SECRET-VALUE"
        "&domain=example.test&typename=lt_c_uq111"
    )

    sanitized = sanitize_request_url(url)

    assert "SECRET-VALUE" not in sanitized
    assert "domain=" not in sanitized
    assert "typename=lt_c_uq111" in sanitized


def test_param_sanitization_redacts_api_key() -> None:
    sanitized = sanitize_params({"key": "SECRET-VALUE", "data": "LT_C_UQ111"})

    assert sanitized == {"key": "[REDACTED]", "data": "LT_C_UQ111"}


def test_wfs_summary_reports_counts_attributes_and_nulls() -> None:
    summary = summarize_wfs_feature_collection(wfs_fixture(), expected_geometry="MultiPolygon")

    assert summary["feature_count"] == 1
    assert summary["total_features"] == 5
    assert summary["number_matched"] == 5
    assert summary["number_returned"] == 1
    assert summary["returned_crs"] == "urn:ogc:def:crs:EPSG::4326"
    assert summary["attribute_fields"] == ["alias", "uname"]
    assert summary["null_fields"] == ["alias"]


def test_wfs_summary_rejects_non_feature_collection() -> None:
    with pytest.raises(SchemaValidationError):
        summarize_wfs_feature_collection(
            {"type": "ServiceExceptionReport"}, expected_geometry="MultiPolygon"
        )


def test_wfs_summary_rejects_missing_features_list() -> None:
    with pytest.raises(SchemaValidationError):
        summarize_wfs_feature_collection(
            {"type": "FeatureCollection", "totalFeatures": 1},
            expected_geometry="MultiPolygon",
        )


def test_wfs_summary_rejects_missing_total_count_metadata() -> None:
    fixture = wfs_fixture()
    del fixture["totalFeatures"]
    del fixture["numberMatched"]

    with pytest.raises(SchemaValidationError):
        summarize_wfs_feature_collection(fixture, expected_geometry="MultiPolygon")


def test_wfs_summary_rejects_unexpected_geometry_type() -> None:
    with pytest.raises(SchemaValidationError):
        summarize_wfs_feature_collection(wfs_fixture(), expected_geometry="MultiLineString")


def test_wfs_summary_rejects_missing_feature_identifier() -> None:
    fixture = wfs_fixture()
    fixture["features"][0].pop("id")  # type: ignore[index]

    with pytest.raises(SchemaValidationError):
        summarize_wfs_feature_collection(fixture, expected_geometry="MultiPolygon")


def test_wfs_summary_rejects_missing_crs_on_non_empty_response() -> None:
    fixture = wfs_fixture(crs=None)

    with pytest.raises(SchemaValidationError):
        summarize_wfs_feature_collection(fixture, expected_geometry="MultiPolygon")


def test_wfs_summary_allows_empty_response_without_crs() -> None:
    fixture = wfs_fixture(features=[], crs=None)

    summary = summarize_wfs_feature_collection(fixture, expected_geometry="MultiPolygon")

    assert summary["feature_count"] == 0
    assert summary["returned_crs"] is None


def test_data_summary_parses_ok_status_with_pagination_metadata() -> None:
    summary = summarize_data_api_response(data_fixture(), expected_geometry="MultiPolygon")

    assert summary["provider_status"] == "OK"
    assert summary["record"] == {"total": "5", "current": "1"}
    assert summary["page"] == {"total": "5", "current": "1", "size": "1"}
    assert summary["feature_id"] == "LT_C_UQ111.1"


def test_data_summary_parses_not_found_as_empty_result() -> None:
    fixture = data_fixture(
        status="NOT_FOUND",
        record={"total": "0", "current": "0"},
        page={"total": "1", "current": "1", "size": "1"},
        result=None,
    )

    summary = summarize_data_api_response(fixture, expected_geometry="MultiPolygon")

    assert summary["provider_status"] == "NOT_FOUND"
    assert summary["feature_count"] == 0


def test_data_summary_raises_on_provider_error_status() -> None:
    fixture = {
        "response": {
            "status": "ERROR",
            "error": {"level": "ERROR", "code": "INVALID_PARAMETER", "text": "필수 파라미터 누락"},
        }
    }

    with pytest.raises(ProviderResultError):
        summarize_data_api_response(fixture, expected_geometry="MultiPolygon")


def test_data_summary_raises_on_unexpected_status_value() -> None:
    with pytest.raises(ProviderResultError):
        summarize_data_api_response(
            {"response": {"status": "MAYBE"}}, expected_geometry="MultiPolygon"
        )


def test_data_summary_rejects_missing_pagination_metadata() -> None:
    fixture = data_fixture()
    del fixture["response"]["page"]  # type: ignore[union-attr]

    with pytest.raises(SchemaValidationError):
        summarize_data_api_response(fixture, expected_geometry="MultiPolygon")


def test_data_summary_rejects_malformed_ok_response_without_features() -> None:
    fixture = data_fixture(result={"featureCollection": {"features": []}})

    with pytest.raises(SchemaValidationError):
        summarize_data_api_response(fixture, expected_geometry="MultiPolygon")


def test_data_summary_rejects_unexpected_geometry_type() -> None:
    with pytest.raises(SchemaValidationError):
        summarize_data_api_response(data_fixture(), expected_geometry="MultiLineString")


def test_data_summary_rejects_missing_feature_identifier() -> None:
    fixture = data_fixture()
    fixture["response"]["result"]["featureCollection"]["features"][0].pop("id")  # type: ignore[index]

    with pytest.raises(SchemaValidationError):
        summarize_data_api_response(fixture, expected_geometry="MultiPolygon")


def test_extract_data_api_error_returns_error_object() -> None:
    fixture = {
        "response": {
            "status": "ERROR",
            "error": {"level": "ERROR", "code": "INVALID_PARAMETER", "text": "필수 파라미터 누락"},
        }
    }

    error = extract_data_api_error(fixture)

    assert error["code"] == "INVALID_PARAMETER"


def test_extract_data_api_error_rejects_non_error_response() -> None:
    with pytest.raises(SchemaValidationError):
        extract_data_api_error(data_fixture())


def test_parse_provider_error_text_handles_well_formed_error_body() -> None:
    text = (
        '{"response": {"status": "ERROR", "error": '
        '{"level": "1", "code": "INVALID_RANGE", "text": "범위 초과"}}}'
    )

    parsed = parse_provider_error_text(text)

    assert parsed["json_parse_error"] is False
    assert parsed["error_code"] == "INVALID_RANGE"


def test_parse_provider_error_text_handles_malformed_error_body() -> None:
    # Live-observed defect: unescaped quotes inside error.text break the JSON.
    text = (
        '{"response": {"status": "ERROR", "error": {"level": "1", '
        '"code": "INVALID_RANGE", "text": "attrFilter(단일검색="Y"인 속성명 포함)"}}}'
    )

    parsed = parse_provider_error_text(text)

    assert parsed["json_parse_error"] is True
    assert parsed["provider_status"] == "ERROR"
    assert parsed["error_code"] == "INVALID_RANGE"
    assert parsed["error_level"] == "1"


def test_bbox_to_geom_filter_reorders_axes() -> None:
    assert (
        bbox_to_geom_filter("37.564,126.976,37.568,126.981") == "BOX(126.976,37.564,126.981,37.568)"
    )


def test_unsupported_service_type_is_rejected_before_any_request() -> None:
    with pytest.raises(IngestionError):
        vworld_structural.run_structural_audit(
            make_settings(), save_samples=False, services=("wms",)
        )


def test_missing_credentials_fail_distinctly() -> None:
    with pytest.raises(MissingCredentialsError):
        vworld_structural.probe_ownership(make_settings(vworld_api_key=None))
