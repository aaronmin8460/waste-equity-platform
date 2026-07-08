"""RCIS waste-statistics PID discovery (Phase 0.7).

PID catalog source: the official 폐기물통계 OpenAPI 활용가이드 published on the
RCIS OpenAPI page (https://www.recycling-info.or.kr/rrs/viewPage.do?menuNo=M130401,
document path /statDoc/폐기물통계_OpenAPI활용가이드.pdf). The same PID is reused
across statistical-format eras; the requested YEAR selects the response schema
(2018-and-earlier, 2019, or 2020-onward forms).
"""

from __future__ import annotations

import time
from typing import Any

from ..config import ProbeSettings
from ..errors import MissingConfigurationError, MissingCredentialsError
from ..http import get_json_response
from .waste_statistics import (
    OPERATION_PATH,
    PROVIDER_CODE_PATHS,
    PROVIDER_MESSAGE_PATHS,
    build_request_params,
    extract_records,
    find_first_value,
)

DEFAULT_DISCOVERY_YEAR = "2023"
REQUEST_INTERVAL_SECONDS = 0.7  # documented provider limit: 100 calls/minute
NO_DATA_PROVIDER_CODE = "E099"
OK_PROVIDER_CODE = "E000"
SAMPLE_RECORD_LIMIT = 20

SIDO_FIELD = "CITY_JIDT_CD_NM"
SIGUNGU_FIELD = "CTS_JIDT_CD_NM"
SEOUL_METRO_SIDO_NAMES = ("서울", "인천", "경기")

QUANTITY_FIELDS = {
    "generation_quantity": ("WSTE_QTY",),
    "recycling_quantity": ("TOT_RECY_QTY",),
    "incineration_quantity": ("TOT_INCI_QTY",),
    "landfill_quantity": ("TOT_FILL_QTY",),
    "other_treatment_quantity": ("TOT_ETC_QTY",),
    "facility_capacity": ("FAC_CAP", "ABILITY_QTY", "TOT_FILL_CAP"),
    "facility_throughput": ("DISP_QTY", "FILL_QTY_TON", "TRANS_QTY"),
}
FACILITY_ATTRIBUTE_FIELDS = ("FAC_NM", "COM_NM", "ADDR")

# 2020-onward form names from the official PID catalog table in the guide.
TARGET_PIDS: dict[str, dict[str, str]] = {
    "NTN002": {
        "description": "1-나. (시군구) 생활폐기물관리구역현황",
        "expected_granularity": "SIGUNGU",
        "category": "management_area",
    },
    "NTN004": {
        "description": "2-가-1). (시도) 생활(가정)폐기물 발생량",
        "expected_granularity": "SIDO",
        "category": "generation_treatment",
    },
    "NTN007": {
        "description": "2-나-1). (시군구) 생활(가정)폐기물 발생량",
        "expected_granularity": "SIGUNGU",
        "category": "generation_treatment",
    },
    "NTN008": {
        "description": "2-나-2). (시군구) 사업장비(非)배출시설계폐기물",
        "expected_granularity": "SIGUNGU",
        "category": "generation_treatment",
    },
    "NTN017": {
        "description": "1-가. (시도) 사업장배출시설계폐기물 발생량",
        "expected_granularity": "SIDO",
        "category": "generation_treatment",
    },
    "NTN018": {
        "description": "1-나. (시군구) 사업장배출시설계폐기물 발생량",
        "expected_granularity": "SIGUNGU",
        "category": "generation_treatment",
    },
    "NTN022": {
        "description": "1-나. (시군구) 건설폐기물 발생량",
        "expected_granularity": "SIGUNGU",
        "category": "generation_treatment",
    },
    "NTN031": {
        "description": "1-가. 공공소각",
        "expected_granularity": "FACILITY",
        "category": "facility",
    },
    "NTN032": {
        "description": "1-나. 공공기타",
        "expected_granularity": "FACILITY",
        "category": "facility",
    },
    "NTN033": {
        "description": "1-다. 공공매립",
        "expected_granularity": "FACILITY",
        "category": "facility",
    },
    "NTN040": {
        "description": "4-가. 중간처분(소각)",
        "expected_granularity": "FACILITY",
        "category": "facility",
    },
    "NTN043": {
        "description": "5. 최종처분",
        "expected_granularity": "FACILITY",
        "category": "facility",
    },
    "NTN044": {
        "description": "6. 종합처분",
        "expected_granularity": "FACILITY",
        "category": "facility",
    },
    "NTN046": {
        "description": "8-가. 재활용처리(중간)",
        "expected_granularity": "FACILITY",
        "category": "facility",
    },
}


def discover(
    settings: ProbeSettings,
    pids: list[str],
    year: str,
    *,
    request_interval_seconds: float = REQUEST_INTERVAL_SECONDS,
) -> list[dict[str, Any]]:
    """Probe each PID live and classify what it provides."""
    missing = settings.missing(["RCIS_API_KEY"])
    if missing:
        raise MissingCredentialsError(missing)
    if not settings.rcis_user_id:
        raise MissingConfigurationError(["RCIS_USER_ID"])

    endpoint = settings.rcis_api_base_url.rstrip("/") + OPERATION_PATH
    summaries: list[dict[str, Any]] = []
    for index, pid in enumerate(pids):
        if index > 0 and request_interval_seconds > 0:
            time.sleep(request_interval_seconds)
        summaries.append(discover_pid(settings, endpoint, pid, year))
    return summaries


def discover_pid(
    settings: ProbeSettings, endpoint: str, pid: str, year: str
) -> dict[str, Any]:
    params = build_request_params(
        api_key=settings.rcis_api_key,
        user_id=settings.rcis_user_id,
        pid=pid,
        year=year,
    )
    try:
        response = get_json_response(endpoint, params)
    except Exception as exc:  # noqa: BLE001 - classified, not swallowed
        return {
            "pid": pid,
            "year": year,
            "description": TARGET_PIDS.get(pid, {}).get("description", "UNDOCUMENTED"),
            "status": "HTTP_ERROR",
            "error": str(exc),
        }
    return classify_response(pid, year, response.payload)


def classify_response(pid: str, year: str, payload: dict[str, Any]) -> dict[str, Any]:
    provider_code = find_first_value(payload, PROVIDER_CODE_PATHS)
    provider_message = find_first_value(payload, PROVIDER_MESSAGE_PATHS)
    metadata = TARGET_PIDS.get(pid, {})
    summary: dict[str, Any] = {
        "pid": pid,
        "year": year,
        "description": metadata.get("description", "UNDOCUMENTED"),
        "expected_granularity": metadata.get("expected_granularity", "UNKNOWN"),
        "provider_result_code": provider_code,
        "provider_result_message": provider_message,
        "title_metadata": find_first_value(payload, ("result.0.TITLE",)),
        "unit_metadata": find_first_value(payload, ("result.0.DUNIT",)),
        "payload": payload,
    }

    code_text = str(provider_code) if provider_code is not None else ""
    if code_text == NO_DATA_PROVIDER_CODE:
        summary["status"] = "NO_DATA_FOR_CONDITION"
        return summary
    if code_text != OK_PROVIDER_CODE:
        summary["status"] = "PROVIDER_ERROR"
        return summary

    records = extract_records(payload)
    if not records:
        summary["status"] = "SCHEMA_UNVERIFIED"
        summary["record_count"] = 0
        return summary

    field_names = sorted({field for record in records for field in record})
    summary["status"] = "LIVE_VERIFIED"
    summary["record_count"] = len(records)
    summary["field_names"] = field_names
    summary["region_granularity"] = observed_granularity(field_names)
    summary["quantity_fields"] = {
        label: [field for field in candidates if field in field_names]
        for label, candidates in QUANTITY_FIELDS.items()
        if any(field in field_names for field in candidates)
    }
    summary["facility_attribute_fields"] = [
        field for field in FACILITY_ATTRIBUTE_FIELDS if field in field_names
    ]
    summary["seoul_metro_sido_observed"] = observed_metro_sido(records)
    summary["sigungu_value_sample"] = value_sample(records, SIGUNGU_FIELD)
    return summary


def observed_granularity(field_names: list[str]) -> str:
    if SIGUNGU_FIELD in field_names:
        return "SIGUNGU"
    if SIDO_FIELD in field_names:
        return "SIDO"
    return "UNKNOWN"


def observed_metro_sido(records: list[dict[str, Any]]) -> list[str]:
    observed = {str(record.get(SIDO_FIELD, "")).strip() for record in records}
    return [name for name in SEOUL_METRO_SIDO_NAMES if name in observed]


def value_sample(records: list[dict[str, Any]], field: str, limit: int = 8) -> list[str]:
    values: list[str] = []
    for record in records:
        value = record.get(field)
        if value is None:
            continue
        text = str(value).strip()
        if text and text not in values:
            values.append(text)
        if len(values) >= limit:
            break
    return values


def truncate_payload_records(
    payload: dict[str, Any], limit: int = SAMPLE_RECORD_LIMIT
) -> dict[str, Any]:
    """Return a copy whose record list is truncated for sanitized sample storage."""
    truncated = dict(payload)
    for key, value in payload.items():
        if isinstance(value, list) and len(value) > limit:
            truncated[key] = value[:limit]
    return truncated
