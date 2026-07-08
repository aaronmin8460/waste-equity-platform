from __future__ import annotations

import json
from pathlib import Path

import pytest

from waste_equity_ingestion.config import ProbeSettings, find_env_file, resolve_config_path
from waste_equity_ingestion.errors import (
    MissingConfigurationError,
    MissingCredentialsError,
    SchemaValidationError,
)
from waste_equity_ingestion.http import JsonResponse, get_json_response
from waste_equity_ingestion.probes import waste_statistics


def _settings(rcis_api_key: str | None, rcis_user_id: str | None = None) -> ProbeSettings:
    return ProbeSettings(
        rcis_api_key=rcis_api_key,
        rcis_user_id=rcis_user_id,
        rcis_api_base_url="https://www.recycling-info.or.kr",
        sgis_consumer_key=None,
        sgis_consumer_secret=None,
        data_go_kr_service_key=None,
        airkorea_service_key=None,
        kma_service_key=None,
        vworld_api_key=None,
        vworld_api_domain=None,
        sample_dir="data/samples",
    )


def test_rcis_api_key_and_user_id_build_documented_request_without_api_id() -> None:
    params = waste_statistics.build_request_params(
        api_key="fixture-api-key",
        user_id="fixture-user-id",
        pid=waste_statistics.DEFAULT_PID,
        year=waste_statistics.DEFAULT_YEAR,
    )

    assert params == {
        "KEY": "fixture-api-key",
        "USRID": "fixture-user-id",
        "PID": "NTN001",
        "YEAR": "2024",
    }


def test_rcis_missing_api_key_is_reported_without_api_id_requirement() -> None:
    with pytest.raises(MissingCredentialsError) as exc_info:
        waste_statistics.probe(_settings(None))

    assert exc_info.value.missing == ["RCIS_API_KEY"]


def test_rcis_missing_user_id_is_configuration_missing_not_credential_missing() -> None:
    with pytest.raises(MissingConfigurationError) as exc_info:
        waste_statistics.probe(_settings("fixture-api-key"))

    assert exc_info.value.missing == ["RCIS_USER_ID"]


def test_env_file_can_be_found_from_child_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path
    child = root / "ingestion"
    child.mkdir()
    env_path = root / ".env"
    env_path.write_text("RCIS_API_KEY=fixture\n", encoding="utf-8")
    monkeypatch.chdir(child)

    assert find_env_file() == env_path


def test_relative_config_path_resolves_from_env_directory(tmp_path: Path) -> None:
    assert resolve_config_path(tmp_path, "./data/samples") == str(tmp_path / "data/samples")


def test_rcis_documented_service_metadata_is_not_secret_configuration() -> None:
    assert waste_statistics.SERVICE_ID == "wss"
    assert waste_statistics.OPERATION_NAME == "JsonApi"
    assert waste_statistics.OPERATION_PATH == "/sds/JsonApi.do"
    assert waste_statistics.REQUIRED_REQUEST_PARAMETERS == ("KEY", "USRID", "PID", "YEAR")


def _live_payload() -> dict[str, object]:
    return {
        "result": [
            {
                "ERR_CODE": "E000",
                "RESULT": "fixture success",
                "PID": "NTN001",
                "YEAR": "2024",
                "TITLE": "fixture title",
                "DUNIT": " ",
            }
        ],
        "dataHeader": [
            {
                "CITY_JIDT_CD_NM": "CITY_JIDT_CD_NM",
                "TOT_AREA": "TOT_AREA",
            }
        ],
        "searchOption": None,
        "data": [
            {
                "CITY_JIDT_CD_NM": "서울",
                "TOT_AREA": "605.24",
                "TOT_POP": "1",
            }
        ],
    }


def test_rcis_provider_level_error_response_is_rejected() -> None:
    response = JsonResponse(
        status=200,
        content_type="application/json",
        payload={"result": [{"ERR_CODE": "E999"}], "data": [], "dataHeader": []},
    )

    with pytest.raises(SchemaValidationError, match="provider-level result code"):
        waste_statistics.validate_live_response(
            response,
            pid=waste_statistics.DEFAULT_PID,
            year=waste_statistics.DEFAULT_YEAR,
        )


def test_rcis_missing_required_fields_are_rejected() -> None:
    response = JsonResponse(
        status=200,
        content_type="application/json",
        payload={"result": [{"ERR_CODE": "E000", "YEAR": "2024"}], "data": [], "dataHeader": []},
    )

    with pytest.raises(SchemaValidationError, match="non-empty records"):
        waste_statistics.validate_live_response(
            response,
            pid=waste_statistics.DEFAULT_PID,
            year=waste_statistics.DEFAULT_YEAR,
        )


def test_rcis_pagination_region_unit_and_waste_fields_are_parsed() -> None:
    response = JsonResponse(status=200, content_type="application/json", payload=_live_payload())

    validation = waste_statistics.validate_live_response(
        response,
        pid=waste_statistics.DEFAULT_PID,
        year=waste_statistics.DEFAULT_YEAR,
    )

    assert validation["pagination"]["status"] == "NOT_APPLICABLE"
    assert validation["region_fields"] == ["CITY_JIDT_CD_NM"]
    assert validation["unit_fields"] == []
    assert validation["waste_fields"]["waste_generation_quantity"] == []
    assert validation["waste_fields"]["total_treatment_quantity"] == []
    assert validation["provider_result_code"] == "E000"


def test_rcis_malformed_json_response_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResponse:
        status = 200
        headers = {"Content-Type": "application/json"}

        def getcode(self) -> int:
            return 200

        def read(self) -> bytes:
            return b"{not-valid-json"

        def __enter__(self) -> FakeResponse:
            return self

        def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
            return None

    def fake_urlopen(request: object, timeout: float) -> FakeResponse:
        return FakeResponse()

    monkeypatch.setattr("waste_equity_ingestion.http.urlopen", fake_urlopen)

    with pytest.raises(json.JSONDecodeError):
        get_json_response("https://example.test/rcis", {"PID": "NTN001"})
