"""Unit tests for the VWorld geocoder contract (no network, no DB)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from waste_equity_ingestion.vworld_geocoding_contract import (
    PARCEL,
    ROAD,
    build_attempts,
    build_geocoder_params,
    build_request_address,
    expected_sido_prefix,
    level4ac_matches_sido,
    parse_geocoder_response,
    simplify_address,
)
from waste_equity_ingestion.vworld_geocoding_ingestion import (
    GeocodeReport,
    geocode_address,
    skip_reason,
)


def _ok_payload(x: str = "126.8", y: str = "37.6", level4ac: str = "4128551000") -> dict[str, Any]:
    # Mirrors the live-verified response shape (docs/API_CONTRACTS/vworld.md).
    return {
        "response": {
            "service": {"name": "address", "version": "2.0", "operation": "getcoord"},
            "status": "OK",
            "input": {"type": "ROAD", "address": "x"},
            "refined": {
                "text": "경기도 고양시 일산동구 견달산로225번길 26-16 (식사동)",
                "structure": {
                    "level1": "경기도",
                    "level2": "고양시 일산동구",
                    "level4AC": level4ac,
                },
            },
            "result": {"crs": "EPSG:4326", "point": {"x": x, "y": y}},
        }
    }


def _not_found_payload() -> dict[str, Any]:
    return {"response": {"status": "NOT_FOUND"}}


def test_build_request_address_prefixes_bare_road_address() -> None:
    assert build_request_address("인천", "남동구", "고잔로 61") == "인천 남동구 고잔로 61"


def test_build_request_address_keeps_sido_qualified_address() -> None:
    address = "경기도 용인시 처인구 남사읍 완장리 498-1,2"
    assert build_request_address("경기", "용인시", address) == address


def test_build_request_address_adds_sido_when_city_present() -> None:
    assert (
        build_request_address("경기", "고양시", "고양시 일산동구 견달산로225번길 26-16")
        == "경기 고양시 일산동구 견달산로225번길 26-16"
    )


def test_simplify_address_strips_parenthetical_and_alternatives() -> None:
    assert simplify_address("수정구 탄천로 687(태평동)") == "수정구 탄천로 687"
    assert simplify_address("남사읍 완장리 498-1,2") == "남사읍 완장리 498-1"
    assert simplify_address("고잔로 61") is None


def test_build_attempts_ladder() -> None:
    plain = build_attempts("인천 남동구 고잔로 61")
    assert [a.address_type for a in plain] == [ROAD, PARCEL]
    laddered = build_attempts("경기 성남시 수정구 탄천로 687(태평동)")
    assert [a.address_type for a in laddered] == [ROAD, PARCEL, ROAD, PARCEL]
    assert laddered[2].address == "경기 성남시 수정구 탄천로 687"


def test_parse_geocoder_response_ok() -> None:
    parsed = parse_geocoder_response(_ok_payload())
    assert parsed.provider_status == "OK"
    assert parsed.x == "126.8" and parsed.y == "37.6"
    assert parsed.level4ac == "4128551000"
    assert parsed.crs == "EPSG:4326"
    assert parsed.refined_address is not None


def test_parse_geocoder_response_not_found_and_malformed() -> None:
    assert parse_geocoder_response(_not_found_payload()).provider_status == "NOT_FOUND"
    assert parse_geocoder_response({}).provider_status == "MALFORMED"
    ok_without_point = {"response": {"status": "OK", "result": {}}}
    parsed = parse_geocoder_response(ok_without_point)
    assert parsed.x is None and parsed.error_detail is not None


def test_level4ac_sido_prefix_checks() -> None:
    assert expected_sido_prefix("경기") == "41"
    assert level4ac_matches_sido("4128551000", "경기") is True
    assert level4ac_matches_sido("1123010100", "경기") is False
    assert level4ac_matches_sido(None, "경기") is None
    assert level4ac_matches_sido("4128551000", "부산") is None


def test_geocoder_params_include_documented_fields() -> None:
    attempt = build_attempts("인천 남동구 고잔로 61")[0]
    params = build_geocoder_params("test-key", attempt)
    assert params["request"] == "getcoord"
    assert params["crs"] == "epsg:4326"
    assert params["type"] == ROAD
    assert params["refine"] == "true"


def test_geocode_address_ladder_falls_back_to_parcel() -> None:
    calls: list[str] = []

    def fetch(params: dict[str, str]) -> dict[str, Any]:
        calls.append(params["type"])
        if params["type"] == ROAD:
            return _not_found_payload()
        return _ok_payload()

    report = GeocodeReport(mode="dry-run", status="RUNNING")
    result = geocode_address(
        "test-key", "경기 용인시 처인구 완장리 498-1", fetch=fetch, request_delay=0, counter=report
    )
    assert result.status == "SUCCEEDED"
    assert result.address_type == PARCEL
    assert calls == [ROAD, PARCEL]
    assert report.api_calls == 2


def test_geocode_address_exhausted_ladder_fails_without_coordinates() -> None:
    report = GeocodeReport(mode="dry-run", status="RUNNING")
    result = geocode_address(
        "test-key",
        "경기 성남시 수정구 탄천로 687(태평동)",
        fetch=lambda params: _not_found_payload(),
        request_delay=0,
        counter=report,
    )
    assert result.status == "FAILED"
    assert result.parsed is None
    assert report.api_calls == 4  # full ladder including the simplified form


def test_skip_reason_idempotency_rules() -> None:
    def facility(status: str | None, address: str | None, geometry: object) -> Any:
        return SimpleNamespace(
            geocode_status=status, geocode_request_address=address, geometry=geometry
        )

    done = facility("SUCCEEDED", "인천 남동구 고잔로 61", object())
    assert skip_reason(done, "인천 남동구 고잔로 61", retry_failed=False) == "already_geocoded"
    # An address change always re-geocodes.
    assert skip_reason(done, "인천 남동구 고잔로 62", retry_failed=False) is None

    failed = facility("FAILED", "인천 남동구 고잔로 61", None)
    assert skip_reason(failed, "인천 남동구 고잔로 61", retry_failed=False) == "previously_failed"
    assert skip_reason(failed, "인천 남동구 고잔로 61", retry_failed=True) is None

    fresh = facility(None, None, None)
    assert skip_reason(fresh, "인천 남동구 고잔로 61", retry_failed=False) is None
