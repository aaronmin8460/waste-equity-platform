"""Synthetic SGIS client tests.

Fixtures here are API-shaped examples only; they are not official SGIS data.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from waste_equity_ingestion.config import ProbeSettings
from waste_equity_ingestion.errors import ProviderResultError, SchemaValidationError
from waste_equity_ingestion.http import get_json_response
from waste_equity_ingestion.probes import sgis
from waste_equity_ingestion.samples import sanitize


def _settings() -> ProbeSettings:
    return ProbeSettings(
        rcis_api_key=None,
        rcis_user_id=None,
        rcis_api_base_url="https://www.recycling-info.or.kr",
        sgis_consumer_key="fixture-key",
        sgis_consumer_secret="fixture-secret",
        data_go_kr_service_key=None,
        airkorea_service_key=None,
        kma_service_key=None,
        vworld_api_key=None,
        vworld_api_domain=None,
        sample_dir="data/samples",
    )


class FakeResponse:
    status = 200
    headers = {"Content-Type": "application/json;charset=UTF-8"}

    def __init__(self, payload: dict[str, Any] | str) -> None:
        self.payload = payload

    def getcode(self) -> int:
        return self.status

    def read(self) -> bytes:
        if isinstance(self.payload, str):
            return self.payload.encode("utf-8")
        return json.dumps(self.payload).encode("utf-8")

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None


def test_sgis_authentication_success(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(request: object, timeout: float) -> FakeResponse:
        return FakeResponse(
            {
                "errCd": 0,
                "errMsg": "Success",
                "result": {"accessToken": "fixture-token", "accessTimeout": "123"},
            }
        )

    monkeypatch.setattr("waste_equity_ingestion.http.urlopen", fake_urlopen)

    auth = sgis.authenticate(_settings())

    assert auth.access_token == "fixture-token"
    assert sgis.sanitized_auth_summary(auth)["access_token_present"] is True


def test_sgis_authentication_provider_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(request: object, timeout: float) -> FakeResponse:
        return FakeResponse({"errCd": -401, "errMsg": "failure", "result": {}})

    monkeypatch.setattr("waste_equity_ingestion.http.urlopen", fake_urlopen)

    with pytest.raises(ProviderResultError):
        sgis.authenticate(_settings())


def test_sgis_authentication_missing_access_token(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(request: object, timeout: float) -> FakeResponse:
        return FakeResponse({"errCd": 0, "errMsg": "Success", "result": {}})

    monkeypatch.setattr("waste_equity_ingestion.http.urlopen", fake_urlopen)

    with pytest.raises(SchemaValidationError, match="accessToken"):
        sgis.authenticate(_settings())


def test_sgis_timeout_is_not_swallowed(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(request: object, timeout: float) -> FakeResponse:
        raise TimeoutError("fixture timeout")

    monkeypatch.setattr("waste_equity_ingestion.http.urlopen", fake_urlopen)

    with pytest.raises(TimeoutError):
        sgis.authenticate(_settings())


def test_sgis_malformed_json_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(request: object, timeout: float) -> FakeResponse:
        return FakeResponse("{not-json")

    monkeypatch.setattr("waste_equity_ingestion.http.urlopen", fake_urlopen)

    with pytest.raises(json.JSONDecodeError):
        get_json_response(sgis.AUTH_URL, {})


def test_token_sanitization_redacts_access_token() -> None:
    clean = sanitize({"result": {"accessToken": "fixture-token"}, "safe": "value"})

    assert clean["result"]["accessToken"] == "[REDACTED]"
    assert clean["safe"] == "value"
