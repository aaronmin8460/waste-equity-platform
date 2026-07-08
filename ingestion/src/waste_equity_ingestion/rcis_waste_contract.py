"""RCIS regional waste generation/treatment contract parsing (Phase 2.2).

Parses the 2020-onward schema of the four regional generation PIDs:

- ``NTN007`` 2-나-1). (시군구) 생활(가정)폐기물 발생량 (household waste)
- ``NTN008`` 2-나-2). (시군구) 사업장비(非)배출시설계폐기물 (non-emission business)
- ``NTN018`` 1-나. (시군구) 사업장배출시설계폐기물 발생량 (emission-facility business)
- ``NTN022`` 1-나. (시군구) 건설폐기물 발생량 (construction)

Each response is the full national region × waste-category matrix. This module
extracts, per real region, the single grand-total row (the row whose waste
major/detail category fields are the ``EMPTY`` placeholder) and reads the
generation and treatment-by-method quantities from it. Pseudo-region rows
(``전국``/``합계``/``소계``/``총계``) are excluded. Deeper category and
treatment-actor (``PUB_``/``SELF_``/``COM_``) breakdowns and pseudo-total rows
are retained only in the sanitized raw response, never as canonical rows.

The PIDs do not share identical field sets: ``NTN008`` carries an extra
``WSTE_S_CODE_NM`` sub-category column. The parser validates each PID's required
fields explicitly rather than assuming one schema for all.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from .errors import (
    ProviderResultError as _ProviderResultError,
)
from .errors import (
    QuotaExceededError,
    SchemaValidationError,
    UnsupportedSchemaEraError,
)

TRANSFORMATION_VERSION = "rcis-waste-capital-region-v1"
RCIS_SOURCE_ID = "waste_statistics"
ACCOUNTING_BASIS = "ORIGIN_BASED_TREATMENT_OUTCOME"
EXPECTED_UNIT = "톤/년"

# The single schema era this phase implements. Older eras are rejected, never
# silently parsed with the 2020+ transformation.
MIN_SUPPORTED_YEAR = 2020

# Provider result codes documented in the official utilization guide.
PROVIDER_OK = "E000"
PROVIDER_NO_DATA = "E099"
PROVIDER_QUOTA_CODES = {"E005", "E006"}
PROVIDER_MESSAGES = {
    "E001": "invalid call",
    "E002": "expired key",
    "E003": "key mismatch",
    "E004": "unregistered user",
    "E005": "per-minute quota exceeded",
    "E006": "daily quota exceeded",
    "E099": "no data for condition",
    "E888": "missing required parameter",
    "E999": "query error",
}

# Region-name fields (Phase 0.7). Despite the _CD_NM suffix these are Korean
# names, not numeric codes.
SIDO_FIELD = "CITY_JIDT_CD_NM"
SIGUNGU_FIELD = "CTS_JIDT_CD_NM"

# Category-hierarchy fields. The grand-total row per region is the one whose
# waste-type group is a total marker AND whose major/detail category fields hold
# the ``EMPTY`` placeholder. The EMPTY placeholder alone is insufficient: each
# region also carries a memo re-breakdown line (e.g. ``음식물류 폐기물 분리배출``
# for NTN007/008, ``기타`` for NTN022) that is EMPTY at major/detail level but is
# NOT the grand total. Restricting the waste-type group to the total markers
# yields exactly one grand-total row per region for every PID.
WT_TYPE_FIELD = "WT_TYPE_GB_NM"
WASTE_MAJOR_FIELD = "WSTE_M_CODE_NM"
WASTE_CATEGORY_FIELD = "WSTE_CODE_NM"
WASTE_SUB_FIELD = "WSTE_S_CODE_NM"
EMPTY_PLACEHOLDER = "EMPTY"
# Region-level grand-total waste-type labels (live-verified 2024): NTN007/NTN018
# use 총계; NTN008/NTN022 use 합계.
GRAND_TOTAL_WT_LABELS = {"총계", "합계"}

# Region labels that are aggregates, not real regions.
PSEUDO_REGION_LABELS = {"전국", "합계", "소계", "총계"}

# Blank/null conventions in RCIS quantity cells. Distinguished from real zero.
NULL_LIKE_QUANTITY = {"", "-", "EMPTY", "N/A", "NA", "NULL", "NONE"}

# Direct quantity fields on the grand-total row (2020-onward schema).
GENERATION_FIELD = "WSTE_QTY"
RECYCLING_FIELD = "TOT_RECY_QTY"
INCINERATION_FIELD = "TOT_INCI_QTY"
LANDFILL_FIELD = "TOT_FILL_QTY"
OTHER_FIELD = "TOT_ETC_QTY"

# Absolute reconciliation tolerance in 톤. Origin-based splits reconcile to
# generation exactly in observed data; a small tolerance absorbs documented
# rounding without masking structurally impossible values.
RECONCILIATION_TOLERANCE = Decimal("1.0")


@dataclass(frozen=True)
class PidSpec:
    pid: str
    waste_stream: str
    official_dataset_name: str
    has_sub_category: bool


# Waste stream is the PID-level classification; official_dataset_name is
# reconfirmed live against ``result[0].TITLE`` before any database write.
PID_SPECS: dict[str, PidSpec] = {
    "NTN007": PidSpec(
        pid="NTN007",
        waste_stream="HOUSEHOLD",
        official_dataset_name="2-나-1). (시군구) 생활(가정)폐기물 발생량",
        has_sub_category=False,
    ),
    "NTN008": PidSpec(
        pid="NTN008",
        waste_stream="BUSINESS_NON_FACILITY",
        official_dataset_name="2-나-2). (시군구) 사업장비(非)배출시설계폐기물",
        has_sub_category=True,
    ),
    "NTN018": PidSpec(
        pid="NTN018",
        waste_stream="INDUSTRIAL_FACILITY",
        official_dataset_name="1-나. (시군구) 사업장배출시설계폐기물 발생량",
        has_sub_category=False,
    ),
    "NTN022": PidSpec(
        pid="NTN022",
        waste_stream="CONSTRUCTION",
        official_dataset_name="1-나. (시군구) 건설폐기물 발생량",
        has_sub_category=False,
    ),
}

TARGET_PIDS: tuple[str, ...] = ("NTN007", "NTN008", "NTN018", "NTN022")


@dataclass(frozen=True)
class WasteRecord:
    """One region's grand-total generation/treatment for a PID."""

    source_pid: str
    waste_stream: str
    official_dataset_name: str
    reference_year: int
    rcis_sido_name: str
    rcis_sigungu_name: str
    waste_category_name: str
    quantity_unit: str
    generation_quantity: Decimal
    recycling_quantity: Decimal
    incineration_quantity: Decimal
    landfill_quantity: Decimal
    other_treatment_quantity: Decimal
    total_treatment_quantity: Decimal
    treatment_reconciliation_difference: Decimal

    @property
    def reconciles(self) -> bool:
        return abs(self.treatment_reconciliation_difference) <= RECONCILIATION_TOLERANCE


@dataclass(frozen=True)
class PidParseResult:
    pid: str
    reference_year: int
    provider_code: str
    provider_message: str
    official_dataset_name: str
    quantity_unit: str
    records: list[WasteRecord]
    source_record_count: int
    excluded_pseudo_rows: int
    excluded_detail_rows: int
    rejected_rows: list[str]
    reconciliation_mismatches: list[str]


def require_supported_year(year: int) -> None:
    """Reject schema eras this phase does not implement."""
    if year < MIN_SUPPORTED_YEAR:
        raise UnsupportedSchemaEraError(
            f"RCIS waste ingestion implements the {MIN_SUPPORTED_YEAR}-and-later schema only; "
            f"YEAR={year} falls in an unsupported era and is not parsed with the "
            f"{MIN_SUPPORTED_YEAR}+ transformation"
        )


def classify_provider_result(payload: dict[str, Any]) -> tuple[str, str]:
    """Return (code, message); raise for authentication/quota/error codes.

    E000 (success) and E099 (no data) return normally so the caller can decide.
    """
    result = payload.get("result")
    if not isinstance(result, list) or not result or not isinstance(result[0], dict):
        raise SchemaValidationError("RCIS response is missing the result envelope")
    header = result[0]
    code = header.get("ERR_CODE")
    message = header.get("RESULT")
    if code is None:
        raise SchemaValidationError("RCIS response is missing result[0].ERR_CODE")
    code_text = str(code).strip()
    message_text = (
        str(message).strip() if message is not None else PROVIDER_MESSAGES.get(code_text, "")
    )
    if code_text in PROVIDER_QUOTA_CODES:
        raise QuotaExceededError(
            f"RCIS provider quota exceeded: {code_text} ({PROVIDER_MESSAGES.get(code_text, '')})"
        )
    if code_text in {PROVIDER_OK, PROVIDER_NO_DATA}:
        return code_text, message_text
    raise _ProviderResultError(
        f"RCIS provider result code {code_text!r}: "
        f"{PROVIDER_MESSAGES.get(code_text, message_text or 'unclassified provider error')}"
    )


def parse_unit(payload: dict[str, Any]) -> str:
    """Extract and validate the measurement unit from result[0].DUNIT metadata."""
    result = payload.get("result")
    if not isinstance(result, list) or not result or not isinstance(result[0], dict):
        raise SchemaValidationError("RCIS response is missing the result envelope for unit")
    raw_unit = result[0].get("DUNIT")
    if raw_unit is None or not str(raw_unit).strip():
        raise SchemaValidationError("RCIS response DUNIT unit metadata is blank")
    # DUNIT looks like "( 단위 : 톤/년 )"; extract the token after the colon.
    match = re.search(r":\s*([^)\s]+)", str(raw_unit))
    unit = match.group(1).strip() if match else str(raw_unit).strip()
    if unit != EXPECTED_UNIT:
        raise SchemaValidationError(
            f"RCIS unit metadata {unit!r} does not match expected {EXPECTED_UNIT!r} "
            f"(raw DUNIT {str(raw_unit)!r})"
        )
    return unit


def require_reference_year(payload: dict[str, Any], year: int) -> None:
    result = payload.get("result")
    if isinstance(result, list) and result and isinstance(result[0], dict):
        observed = result[0].get("YEAR")
        if observed is not None and str(observed).strip() != str(year):
            raise SchemaValidationError(
                f"RCIS response reference year mismatch: requested {year}, "
                f"metadata reports {observed!r}"
            )


def require_pid(payload: dict[str, Any], pid: str) -> str:
    """Confirm the response PID and return its official title."""
    result = payload.get("result")
    if not isinstance(result, list) or not result or not isinstance(result[0], dict):
        raise SchemaValidationError("RCIS response is missing the result envelope for PID")
    header = result[0]
    observed_pid = header.get("PID")
    if observed_pid is not None and str(observed_pid).strip() != pid:
        raise SchemaValidationError(
            f"RCIS response PID mismatch: requested {pid}, response reports {observed_pid!r}"
        )
    title = header.get("TITLE")
    return str(title).strip() if title is not None else PID_SPECS[pid].official_dataset_name


def _data_records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data")
    if not isinstance(data, list):
        raise SchemaValidationError("RCIS response is missing the data record list")
    for row in data:
        if not isinstance(row, dict):
            raise SchemaValidationError("RCIS data row is not an object")
    return data


def _require_header_fields(payload: dict[str, Any], spec: PidSpec) -> None:
    """Validate the PID-specific dataHeader declares the fields we read."""
    header = payload.get("dataHeader")
    if not isinstance(header, list) or not header or not isinstance(header[0], dict):
        raise SchemaValidationError(f"{spec.pid} response is missing the dataHeader specification")
    declared = set(header[0].keys())
    required = {
        SIDO_FIELD,
        SIGUNGU_FIELD,
        WT_TYPE_FIELD,
        WASTE_MAJOR_FIELD,
        WASTE_CATEGORY_FIELD,
        GENERATION_FIELD,
        RECYCLING_FIELD,
        INCINERATION_FIELD,
        LANDFILL_FIELD,
        OTHER_FIELD,
    }
    if spec.has_sub_category:
        required.add(WASTE_SUB_FIELD)
    missing = sorted(required - declared)
    if missing:
        raise SchemaValidationError(
            f"{spec.pid} dataHeader is missing required field(s): {', '.join(missing)}"
        )
    if spec.has_sub_category and WASTE_SUB_FIELD not in declared:
        raise SchemaValidationError(
            f"{spec.pid} is documented with a {WASTE_SUB_FIELD} sub-category column that is absent"
        )


def is_pseudo_region(sido: str, sigungu: str) -> bool:
    return sido in PSEUDO_REGION_LABELS or sigungu in PSEUDO_REGION_LABELS


def _is_grand_total_row(row: dict[str, Any], spec: PidSpec) -> bool:
    wt_type = str(row.get(WT_TYPE_FIELD, "")).strip()
    if wt_type not in GRAND_TOTAL_WT_LABELS:
        return False
    major = str(row.get(WASTE_MAJOR_FIELD, "")).strip()
    category = str(row.get(WASTE_CATEGORY_FIELD, "")).strip()
    if major != EMPTY_PLACEHOLDER or category != EMPTY_PLACEHOLDER:
        return False
    if spec.has_sub_category:
        sub = str(row.get(WASTE_SUB_FIELD, "")).strip()
        if sub != EMPTY_PLACEHOLDER:
            return False
    return True


def parse_quantity(value: Any, field: str, region: str) -> Decimal | None:
    """Parse an official quantity cell.

    Returns ``None`` for explicit blank/null cells (distinct from zero) and
    raises on invalid numeric strings or negative values.
    """
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if text.upper() in {token.upper() for token in NULL_LIKE_QUANTITY}:
        return None
    try:
        quantity = Decimal(text)
    except (InvalidOperation, ValueError) as exc:
        raise SchemaValidationError(f"{region}: {field} has a non-numeric value {value!r}") from exc
    if quantity < 0:
        raise SchemaValidationError(f"{region}: {field} is negative ({quantity})")
    return quantity


def parse_pid_response(
    payload: dict[str, Any],
    *,
    pid: str,
    year: int,
) -> PidParseResult:
    """Validate and transform one PID's live response into grand-total records."""
    if pid not in PID_SPECS:
        raise SchemaValidationError(f"Unsupported RCIS waste PID {pid!r}")
    require_supported_year(year)
    spec = PID_SPECS[pid]

    provider_code, provider_message = classify_provider_result(payload)
    if provider_code == PROVIDER_NO_DATA:
        return PidParseResult(
            pid=pid,
            reference_year=year,
            provider_code=provider_code,
            provider_message=provider_message,
            official_dataset_name=spec.official_dataset_name,
            quantity_unit=EXPECTED_UNIT,
            records=[],
            source_record_count=0,
            excluded_pseudo_rows=0,
            excluded_detail_rows=0,
            rejected_rows=[],
            reconciliation_mismatches=[],
        )

    require_reference_year(payload, year)
    official_dataset_name = require_pid(payload, pid)
    unit = parse_unit(payload)
    _require_header_fields(payload, spec)
    rows = _data_records(payload)

    records: list[WasteRecord] = []
    rejected: list[str] = []
    reconciliation_mismatches: list[str] = []
    excluded_pseudo = 0
    excluded_detail = 0
    grand_total_seen: Counter[tuple[str, str]] = Counter()

    for row in rows:
        sido = str(row.get(SIDO_FIELD, "")).strip()
        sigungu = str(row.get(SIGUNGU_FIELD, "")).strip()
        if is_pseudo_region(sido, sigungu):
            excluded_pseudo += 1
            continue
        if not _is_grand_total_row(row, spec):
            excluded_detail += 1
            continue
        region_label = f"{sido} {sigungu}".strip()
        grand_total_seen[(sido, sigungu)] += 1
        if grand_total_seen[(sido, sigungu)] > 1:
            rejected.append(f"{region_label}: duplicate grand-total row")
            continue

        try:
            generation = parse_quantity(row.get(GENERATION_FIELD), GENERATION_FIELD, region_label)
            recycling = parse_quantity(row.get(RECYCLING_FIELD), RECYCLING_FIELD, region_label)
            incineration = parse_quantity(
                row.get(INCINERATION_FIELD), INCINERATION_FIELD, region_label
            )
            landfill = parse_quantity(row.get(LANDFILL_FIELD), LANDFILL_FIELD, region_label)
            other = parse_quantity(row.get(OTHER_FIELD), OTHER_FIELD, region_label)
        except SchemaValidationError as exc:
            rejected.append(str(exc))
            continue

        if generation is None:
            rejected.append(f"{region_label}: {GENERATION_FIELD} is blank/null")
            continue
        treatment_parts = [recycling, incineration, landfill, other]
        if any(part is None for part in treatment_parts):
            rejected.append(f"{region_label}: a treatment-method quantity is blank/null")
            continue

        recycling_q = recycling if recycling is not None else Decimal(0)
        incineration_q = incineration if incineration is not None else Decimal(0)
        landfill_q = landfill if landfill is not None else Decimal(0)
        other_q = other if other is not None else Decimal(0)
        total_treatment = recycling_q + incineration_q + landfill_q + other_q
        difference = generation - total_treatment

        record = WasteRecord(
            source_pid=pid,
            waste_stream=spec.waste_stream,
            official_dataset_name=official_dataset_name,
            reference_year=year,
            rcis_sido_name=sido,
            rcis_sigungu_name=sigungu,
            waste_category_name=str(row.get(WT_TYPE_FIELD, "")).strip() or "총계",
            quantity_unit=unit,
            generation_quantity=generation,
            recycling_quantity=recycling_q,
            incineration_quantity=incineration_q,
            landfill_quantity=landfill_q,
            other_treatment_quantity=other_q,
            total_treatment_quantity=total_treatment,
            treatment_reconciliation_difference=difference,
        )
        if not record.reconciles:
            reconciliation_mismatches.append(
                f"{region_label}: generation {generation} vs treatment total "
                f"{total_treatment} (difference {difference})"
            )
        records.append(record)

    if not records:
        raise SchemaValidationError(
            f"{pid} returned {PROVIDER_OK} but produced no mappable grand-total region rows"
        )

    return PidParseResult(
        pid=pid,
        reference_year=year,
        provider_code=provider_code,
        provider_message=provider_message,
        official_dataset_name=official_dataset_name,
        quantity_unit=unit,
        records=records,
        source_record_count=len(rows),
        excluded_pseudo_rows=excluded_pseudo,
        excluded_detail_rows=excluded_detail,
        rejected_rows=rejected,
        reconciliation_mismatches=reconciliation_mismatches,
    )
