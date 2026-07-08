"""RCIS waste-statistics API probe."""

from __future__ import annotations

from typing import Any

from ..config import ProbeSettings
from ..errors import MissingConfigurationError, MissingCredentialsError, SchemaValidationError
from ..http import JsonResponse, get_json_response
from ..result import ProbeResult
from ..validation import require_paths

SOURCE = "waste_statistics"
SERVICE_ID = "wss"
OPERATION_NAME = "JsonApi"
OPERATION_PATH = "/sds/JsonApi.do"
REQUIRED_REQUEST_PARAMETERS = ("KEY", "USRID", "PID", "YEAR")
PID_PARAMETER_DESCRIPTION = "Waste-statistics form code from the official RCIS guide."
DEFAULT_PID = "NTN001"
DEFAULT_YEAR = "2024"
DEFAULT_PID_DESCRIPTION = "(시도) 생활폐기물관리구역현황"
OK_PROVIDER_CODES = {"00", "000", "0", "E000", "SUCCESS", "OK", "Y"}
PROVIDER_CODE_PATHS = (
    "result.0.ERR_CODE",
    "resultCode",
    "RESULT_CODE",
    "RESULTCODE",
    "code",
    "CODE",
    "header.resultCode",
    "HEADER.RESULT_CODE",
)
PROVIDER_MESSAGE_PATHS = (
    "result.0.RESULT",
    "resultMsg",
    "RESULT_MSG",
    "message",
    "MESSAGE",
)
TOP_LEVEL_REQUIRED_KEYS = ("data", "dataHeader", "result")
PAGINATION_KEYS = ("pageNo", "numOfRows", "totalCount", "PAGE_NO", "NUM_OF_ROWS", "TOTAL_COUNT")
REGION_FIELD_CANDIDATES = (
    "CITY_JIDT_CD_NM",
    "SIDO",
    "CTPV",
    "시도",
    "시도명",
    "지역",
    "지역명",
)
UNIT_FIELD_CANDIDATES = ("UNIT", "DUNIT", "단위", "UNIT_NM", "MEASUREMENT_UNIT")
YEAR_FIELD_CANDIDATES = ("YEAR", "년도", "연도", "BASE_YEAR")
WASTE_FIELD_CANDIDATES = {
    "waste_generation_quantity": ("GEN", "GENER", "발생", "WASTE_QTY"),
    "total_treatment_quantity": ("처리", "TREAT", "PRCS"),
    "incineration_quantity": ("소각", "INCIN"),
    "landfill_quantity": ("매립", "LANDFILL"),
    "recycling_quantity": ("재활용", "RECYCLE"),
    "other_treatment_quantity": ("기타", "OTHER"),
}


def probe(settings: ProbeSettings) -> ProbeResult:
    missing = settings.missing(["RCIS_API_KEY"])
    if missing:
        raise MissingCredentialsError(missing)
    if not settings.rcis_user_id:
        raise MissingConfigurationError(["RCIS_USER_ID"])

    endpoint = settings.rcis_api_base_url.rstrip("/") + OPERATION_PATH
    response = get_json_response(
        endpoint,
        build_request_params(
            api_key=settings.rcis_api_key,
            user_id=settings.rcis_user_id,
            pid=DEFAULT_PID,
            year=DEFAULT_YEAR,
        ),
    )
    validation = validate_live_response(response, pid=DEFAULT_PID, year=DEFAULT_YEAR)

    return {
        "source": SOURCE,
        "endpoint_identifier": f"{SERVICE_ID}/{OPERATION_NAME}/{DEFAULT_PID}",
        "payload": response.payload,
        "schema_validation_status": "LIVE_VERIFIED",
        "geographic_coverage": validation["geographic_coverage"],
        "latest_reference_period_observed": validation["reference_period"],
        "request_metadata": {
            "service_id": SERVICE_ID,
            "operation": OPERATION_NAME,
            "pid": DEFAULT_PID,
            "pid_description": DEFAULT_PID_DESCRIPTION,
            "year": DEFAULT_YEAR,
            "required_parameters": [
                param for param in REQUIRED_REQUEST_PARAMETERS if param != "KEY"
            ],
            "http_status": response.status,
            "content_type": response.content_type,
            "provider_result_code": validation["provider_result_code"],
            "provider_result_message": validation["provider_result_message"],
            "record_count": validation["record_count"],
            "schema_validation_status": "LIVE_VERIFIED",
        },
    }


def build_request_params(
    *,
    api_key: str | None,
    user_id: str | None,
    pid: str,
    year: str,
) -> dict[str, str]:
    if not api_key:
        raise MissingCredentialsError(["RCIS_API_KEY"])
    if not user_id:
        raise MissingConfigurationError(["RCIS_USER_ID"])
    return {"KEY": api_key, "USRID": user_id, "PID": pid, "YEAR": year}


def validate_live_response(response: JsonResponse, *, pid: str, year: str) -> dict[str, Any]:
    payload = response.payload
    require_top_level_structure(payload)
    require_provider_success(payload)
    records = extract_records(payload)
    if not records:
        raise SchemaValidationError("RCIS response did not contain a non-empty records list")
    require_reference_year(payload, records, year)
    region_fields = parse_region_fields(records)
    unit_fields = parse_unit_fields(payload, records)
    waste_fields = parse_waste_fields(records)
    pagination = parse_pagination(payload)
    return {
        "pid": pid,
        "reference_period": year,
        "record_count": len(records),
        "geographic_coverage": summarize_geographic_coverage(records, region_fields),
        "region_fields": region_fields,
        "unit_fields": unit_fields,
        "waste_fields": waste_fields,
        "pagination": pagination,
        "provider_result_code": find_first_value(payload, PROVIDER_CODE_PATHS),
        "provider_result_message": find_first_value(payload, PROVIDER_MESSAGE_PATHS),
    }


def require_top_level_structure(payload: dict[str, Any]) -> None:
    missing = [key for key in TOP_LEVEL_REQUIRED_KEYS if key not in payload]
    if missing:
        raise SchemaValidationError(
            "RCIS response missing top-level field(s): " + ", ".join(missing)
        )


def require_provider_success(payload: dict[str, Any]) -> None:
    code = find_first_value(payload, PROVIDER_CODE_PATHS)
    if code is None:
        raise SchemaValidationError("RCIS response is missing a provider-level result code")
    if str(code).upper() not in OK_PROVIDER_CODES:
        raise SchemaValidationError(f"RCIS provider-level result code was not successful: {code!r}")


def extract_records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    candidate_paths = (
        "data",
        "DATA",
        "items",
        "ITEMS",
        "list",
        "LIST",
        "rows",
        "ROWS",
        "result",
        "RESULT",
        "body.items",
        "response.body.items",
    )
    for path in candidate_paths:
        value = find_first_value(payload, (path,))
        if isinstance(value, list) and all(isinstance(item, dict) for item in value):
            return value
    for value in payload.values():
        if isinstance(value, list) and all(isinstance(item, dict) for item in value):
            return value
    return []


def require_reference_year(
    payload: dict[str, Any],
    records: list[dict[str, Any]],
    year: str,
) -> None:
    year_fields = _matching_fields(records, YEAR_FIELD_CANDIDATES)
    metadata_year = find_first_value(payload, ("result.0.YEAR",))
    if metadata_year is not None and str(metadata_year) == year:
        return
    if not year_fields:
        raise SchemaValidationError("RCIS response is missing a reference year field")
    observed = {
        str(record.get(field))
        for record in records
        for field in year_fields
        if record.get(field) is not None
    }
    if year not in observed:
        raise SchemaValidationError(
            f"RCIS response reference year mismatch: requested {year}, observed {sorted(observed)}"
        )


def parse_region_fields(records: list[dict[str, Any]]) -> list[str]:
    fields = _matching_fields(records, REGION_FIELD_CANDIDATES)
    if not fields:
        raise SchemaValidationError("RCIS response is missing documented geographic fields")
    return fields


def parse_unit_fields(payload: dict[str, Any], records: list[dict[str, Any]]) -> list[str]:
    fields = _matching_fields(records, UNIT_FIELD_CANDIDATES)
    metadata_unit = find_first_value(payload, ("result.0.DUNIT",))
    if metadata_unit is not None and str(metadata_unit).strip():
        fields.append("result.0.DUNIT")
    return sorted(set(fields))


def parse_waste_fields(records: list[dict[str, Any]]) -> dict[str, list[str]]:
    return {
        field_type: _matching_fields(records, candidates)
        for field_type, candidates in WASTE_FIELD_CANDIDATES.items()
    }


def parse_pagination(payload: dict[str, Any]) -> dict[str, Any]:
    pagination = {
        key: find_first_value(payload, (key,))
        for key in PAGINATION_KEYS
        if find_first_value(payload, (key,)) is not None
    }
    if not pagination:
        return {"status": "NOT_APPLICABLE"}
    return {"status": "LIVE_VERIFIED", "fields": pagination}


def summarize_geographic_coverage(records: list[dict[str, Any]], region_fields: list[str]) -> str:
    values = []
    for record in records:
        for field in region_fields:
            value = record.get(field)
            if value:
                values.append(str(value))
    observed = sorted(set(values))
    return ", ".join(observed[:12]) if observed else "SCHEMA_UNVERIFIED"


def find_first_value(payload: dict[str, Any], dotted_paths: tuple[str, ...]) -> Any | None:
    for path in dotted_paths:
        current: Any = payload
        for part in path.split("."):
            if isinstance(current, dict):
                current = current.get(part)
            elif isinstance(current, list) and part.isdigit():
                index = int(part)
                current = current[index] if index < len(current) else None
            else:
                current = None
                break
        if current is not None:
            return current
    return None


def _matching_fields(records: list[dict[str, Any]], candidates: tuple[str, ...]) -> list[str]:
    fields = sorted({field for record in records for field in record})
    return [
        field
        for field in fields
        if any(candidate.upper() in field.upper() or candidate in field for candidate in candidates)
    ]


def require_minimal_live_schema(response: dict[str, Any]) -> None:
    require_paths(response, ["payload", "request_metadata"], provider="RCIS fixture")
