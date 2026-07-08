"""RCIS waste-ingestion client behavior tests (synthetic).

No real credentials or live requests are used. Network behavior is simulated by
monkeypatching the stdlib HTTP helper.
"""

from __future__ import annotations

import json
import urllib.error
from typing import Any

import pytest

from waste_equity_ingestion import rcis_waste_ingestion
from waste_equity_ingestion.config import ProbeSettings
from waste_equity_ingestion.errors import (
    IngestionError,
    MissingConfigurationError,
    MissingCredentialsError,
)
from waste_equity_ingestion.probes.waste_statistics import build_request_params
from waste_equity_ingestion.rcis_waste_ingestion import (
    _sanitize_error,
    fetch_all_pids,
    fetch_pid,
)

ENDPOINT = "https://example.test/sds/JsonApi.do"


def _settings(api_key: str | None, user_id: str | None) -> ProbeSettings:
    return ProbeSettings(
        rcis_api_key=api_key,
        rcis_user_id=user_id,
        rcis_api_base_url="https://example.test",
        sgis_consumer_key=None,
        sgis_consumer_secret=None,
        data_go_kr_service_key=None,
        airkorea_service_key=None,
        kma_service_key=None,
        vworld_api_key=None,
        vworld_api_domain=None,
        sample_dir="data/samples",
    )


class _FakeHttpResponse:
    def __init__(self, body: bytes, content_type: str = "application/json") -> None:
        self._body = body
        self.status = 200
        self.headers = {"Content-Type": content_type}

    def getcode(self) -> int:
        return 200

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> _FakeHttpResponse:
        return self

    def __exit__(self, *args: object) -> None:
        return None


def test_build_request_params_uses_documented_names() -> None:
    params = build_request_params(
        api_key="fixture-key", user_id="fixture-user", pid="NTN007", year="2024"
    )
    assert params == {
        "KEY": "fixture-key",
        "USRID": "fixture-user",
        "PID": "NTN007",
        "YEAR": "2024",
    }


def test_missing_api_key_is_credential_error() -> None:
    with pytest.raises(MissingCredentialsError) as exc_info:
        fetch_all_pids(_settings(None, "user"), year=2024, pids=("NTN007",), request_delay=0)
    assert exc_info.value.missing == ["RCIS_API_KEY"]


def test_missing_user_id_is_configuration_error() -> None:
    with pytest.raises(MissingConfigurationError) as exc_info:
        fetch_all_pids(_settings("key", None), year=2024, pids=("NTN007",), request_delay=0)
    assert exc_info.value.missing == ["RCIS_USER_ID"]


def test_transient_network_failure_is_retried_then_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}

    def fake_urlopen(request: Any, timeout: float) -> _FakeHttpResponse:
        calls["count"] += 1
        raise urllib.error.URLError("transient boom")

    sleeps: list[float] = []
    monkeypatch.setattr("waste_equity_ingestion.http.urlopen", fake_urlopen)
    monkeypatch.setattr(rcis_waste_ingestion.time, "sleep", lambda seconds: sleeps.append(seconds))

    with pytest.raises(IngestionError, match="failed after"):
        fetch_pid(_settings("key", "user"), ENDPOINT, "NTN007", 2024)

    assert calls["count"] == rcis_waste_ingestion.NETWORK_RETRY_LIMIT + 1
    assert len(sleeps) == rcis_waste_ingestion.NETWORK_RETRY_LIMIT


def test_timeout_is_treated_as_transient(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(request: Any, timeout: float) -> _FakeHttpResponse:
        raise TimeoutError("slow")

    monkeypatch.setattr("waste_equity_ingestion.http.urlopen", fake_urlopen)
    monkeypatch.setattr(rcis_waste_ingestion.time, "sleep", lambda seconds: None)

    with pytest.raises(IngestionError):
        fetch_pid(_settings("key", "user"), ENDPOINT, "NTN007", 2024)


def test_recovers_after_one_transient_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    body = json.dumps({"result": [{"ERR_CODE": "E000"}], "data": [], "dataHeader": []}).encode(
        "utf-8"
    )
    calls = {"count": 0}

    def fake_urlopen(request: Any, timeout: float) -> _FakeHttpResponse:
        calls["count"] += 1
        if calls["count"] == 1:
            raise urllib.error.URLError("transient")
        return _FakeHttpResponse(body)

    monkeypatch.setattr("waste_equity_ingestion.http.urlopen", fake_urlopen)
    monkeypatch.setattr(rcis_waste_ingestion.time, "sleep", lambda seconds: None)

    response, retrieved_at = fetch_pid(_settings("key", "user"), ENDPOINT, "NTN007", 2024)
    assert response.status == 200
    assert calls["count"] == 2
    assert retrieved_at is not None


def test_malformed_json_is_not_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_urlopen(request: Any, timeout: float) -> _FakeHttpResponse:
        return _FakeHttpResponse(b"{not valid json")

    monkeypatch.setattr("waste_equity_ingestion.http.urlopen", fake_urlopen)

    with pytest.raises(json.JSONDecodeError):
        fetch_pid(_settings("key", "user"), ENDPOINT, "NTN007", 2024)


def test_sanitize_error_redacts_key_and_user_id() -> None:
    message = "request failed for KEY=super-secret-key&USRID=my-user-id&PID=NTN007 accessToken=x"
    sanitized = _sanitize_error(message)
    assert "super-secret-key" not in sanitized
    assert "my-user-id" not in sanitized
    assert "[REDACTED]" in sanitized
