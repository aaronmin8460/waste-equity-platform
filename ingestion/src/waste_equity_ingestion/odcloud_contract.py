"""Pure parsing/validation for the Sudokwon Landfill odcloud datasets.

Side-effect-free contract for the two official Sudokwon Landfill Corporation
(수도권매립지관리공사) datasets published through the odcloud API:

- ``15064381`` inbound quantity — fields ``마감년월`` / ``소재지`` / ``폐기물명`` /
  ``반입량`` (kg).
- ``15064394`` inbound fee — fields ``마감년월`` / ``광역지자체명`` / ``폐기물명`` /
  ``반입수수료`` (KRW).

Both declare origin at the **metropolitan** level only (서울시 / 인천시 / 경기도);
any other value is rejected — this feature never disaggregates below the
metropolitan unit. The two datasets share the canonical grain
``마감년월 × origin × 폐기물명`` and join **1:1**; a non-1:1 join is a visible
failure. Snapshot discovery parses the public odcloud OpenAPI (OAS) document and
selects the latest dated snapshot, so the current snapshot UUID is never
permanently hardcoded.

No HTTP or DB access lives here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from .errors import IngestionError, SchemaValidationError

TRANSFORMATION_VERSION = "landfill-inbound-v1"

# odcloud endpoints. The data API is authenticated (serviceKey); the OAS is public.
ODCLOUD_API_BASE_URL = "https://api.odcloud.kr/api"
ODCLOUD_OAS_URL = "https://infuser.odcloud.kr/oas/docs"

INBOUND_DATASET_ID = "15064381"
FEE_DATASET_ID = "15064394"

# Metropolitan origin → canonical platform SGIS sido code. The source declares
# exactly these three 광역 units and no city/county/district value.
ORIGIN_CODE_BY_SOURCE_NAME: dict[str, str] = {
    "서울시": "KR-SGIS-11",
    "인천시": "KR-SGIS-28",
    "경기도": "KR-SGIS-41",
}
ORIGIN_LEVEL_METROPOLITAN = "SIDO"
DESTINATION_CODE = "SUDOKWON_LANDFILL"
EVIDENCE_OFFICIAL_REPORTED = "OFFICIAL_REPORTED_VALUE"
# Distinct accounting basis (mirrors models/landfill_inbound.py); never merged
# with the origin-treatment or facility-throughput bases.
ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW = "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW"

QUANTITY_UNIT_KG = "kg"
FEE_CURRENCY_KRW = "KRW"

# Real JSON field names (differ from portal/Swagger labels; verified 2026-07-14).
FIELD_REFERENCE_MONTH = "마감년월"
FIELD_INBOUND_ORIGIN = "소재지"
FIELD_FEE_ORIGIN = "광역지자체명"
FIELD_WASTE_NAME = "폐기물명"
FIELD_QUANTITY = "반입량"
FIELD_FEE = "반입수수료"

_MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")
_DATE_SUFFIX_RE = re.compile(r"(\d{8})\s*$")
_UDDI_RE = re.compile(r"uddi:([0-9a-fA-F-]{36})")


@dataclass(frozen=True)
class SnapshotRef:
    """A single published odcloud snapshot for a dataset namespace."""

    dataset_id: str
    snapshot_uuid: str  # bare UUID (no ``uddi:`` prefix)
    path: str  # OAS path, e.g. ``/15064394/v1/uddi:<uuid>``
    publication_date: str | None  # ISO ``YYYY-MM-DD`` parsed from the summary
    summary: str

    @property
    def path_segment(self) -> str:
        """The ``uddi:<uuid>`` path segment used to build the request URL."""
        return f"uddi:{self.snapshot_uuid}"


def select_latest_snapshot(oas_payload: dict[str, Any], dataset_id: str) -> SnapshotRef:
    """Select the latest dated snapshot from a parsed odcloud OAS document.

    Fails safely (``IngestionError``) if the OAS carries no discoverable snapshot
    path for the dataset.
    """
    paths = oas_payload.get("paths")
    if not isinstance(paths, dict) or not paths:
        raise IngestionError(f"odcloud OAS for {dataset_id} has no discoverable snapshot paths")
    candidates: list[SnapshotRef] = []
    for path, spec in paths.items():
        if not isinstance(path, str):
            continue
        uddi = _UDDI_RE.search(path)
        if uddi is None or f"/{dataset_id}/" not in path:
            continue
        summary = ""
        if isinstance(spec, dict):
            get_spec = spec.get("get")
            if isinstance(get_spec, dict):
                summary = str(get_spec.get("summary") or "")
        candidates.append(
            SnapshotRef(
                dataset_id=dataset_id,
                snapshot_uuid=uddi.group(1),
                path=path,
                publication_date=_publication_date_from_summary(summary),
                summary=summary,
            )
        )
    if not candidates:
        raise IngestionError(
            f"odcloud OAS for {dataset_id} exposes no uddi snapshot for this namespace"
        )
    # Prefer the maximum publication date; fall back to OAS declaration order
    # (odcloud lists snapshots oldest→newest) when a summary carries no date.
    dated = [c for c in candidates if c.publication_date is not None]
    if dated:
        return max(dated, key=lambda c: c.publication_date or "")
    return candidates[-1]


def _publication_date_from_summary(summary: str) -> str | None:
    match = _DATE_SUFFIX_RE.search(summary)
    if match is None:
        return None
    raw = match.group(1)
    return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"


@dataclass(frozen=True)
class LandfillInboundRecord:
    reference_month: str
    reference_year: int
    origin_source_name: str
    origin_region_code: str
    waste_name: str
    quantity_kg: Decimal


@dataclass(frozen=True)
class LandfillFeeRecord:
    reference_month: str
    origin_source_name: str
    origin_region_code: str
    waste_name: str
    inbound_fee_krw: Decimal


@dataclass(frozen=True)
class LandfillInboundJoined:
    """One canonical row: quantity and fee for (month × origin × waste)."""

    reference_month: str
    reference_year: int
    origin_source_name: str
    origin_region_code: str
    waste_name: str
    quantity_kg: Decimal
    inbound_fee_krw: Decimal


@dataclass
class JoinReport:
    joined: int = 0
    inbound_rows: int = 0
    fee_rows: int = 0
    inbound_only_keys: list[str] = field(default_factory=list)
    fee_only_keys: list[str] = field(default_factory=list)


def canonical_key(reference_month: str, origin_region_code: str, waste_name: str) -> str:
    return f"{reference_month}|{origin_region_code}|{waste_name}"


def normalize_origin(raw_name: Any) -> tuple[str, str]:
    """Return ``(canonical_code, cleaned_source_name)`` or fail on an unsupported origin."""
    if not isinstance(raw_name, str) or not raw_name.strip():
        raise SchemaValidationError("landfill row is missing a metropolitan origin value")
    cleaned = raw_name.strip()
    code = ORIGIN_CODE_BY_SOURCE_NAME.get(cleaned)
    if code is None:
        raise IngestionError(
            "Unsupported landfill origin "
            f"{cleaned!r}; capital-region flow supports only "
            f"{', '.join(ORIGIN_CODE_BY_SOURCE_NAME)} (metropolitan-only)"
        )
    return code, cleaned


def parse_reference_month(raw_value: Any) -> tuple[str, int]:
    if not isinstance(raw_value, str):
        raise SchemaValidationError(
            f"landfill {FIELD_REFERENCE_MONTH} is not a string: {raw_value!r}"
        )
    value = raw_value.strip()
    match = _MONTH_RE.match(value)
    if match is None:
        raise SchemaValidationError(f"landfill {FIELD_REFERENCE_MONTH} {value!r} is not YYYY-MM")
    month = int(match.group(2))
    if month < 1 or month > 12:
        raise SchemaValidationError(f"landfill {FIELD_REFERENCE_MONTH} {value!r} has invalid month")
    return value, int(match.group(1))


def _parse_nonnegative_amount(raw_value: Any, *, field_name: str, context: str) -> Decimal:
    if raw_value is None:
        raise SchemaValidationError(f"landfill {field_name} is null for {context}")
    try:
        amount = Decimal(str(raw_value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise SchemaValidationError(
            f"landfill {field_name} {raw_value!r} is not numeric for {context}"
        ) from exc
    if amount < 0:
        raise SchemaValidationError(f"landfill {field_name} {amount} is negative for {context}")
    return amount


def _require_field(row: dict[str, Any], field_name: str) -> Any:
    if field_name not in row:
        raise SchemaValidationError(
            f"landfill row missing required field {field_name!r}; source schema may have changed"
        )
    return row[field_name]


def _clean_waste_name(raw_value: Any, context: str) -> str:
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise SchemaValidationError(f"landfill {FIELD_WASTE_NAME} is empty for {context}")
    return raw_value.strip()


def parse_inbound_rows(rows: list[dict[str, Any]]) -> list[LandfillInboundRecord]:
    """Validate + normalize inbound quantity rows; reject duplicate canonical keys."""
    records: list[LandfillInboundRecord] = []
    seen: set[str] = set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise SchemaValidationError(f"inbound row {index} is not an object")
        reference_month, reference_year = parse_reference_month(
            _require_field(row, FIELD_REFERENCE_MONTH)
        )
        code, source_name = normalize_origin(_require_field(row, FIELD_INBOUND_ORIGIN))
        waste_name = _clean_waste_name(
            _require_field(row, FIELD_WASTE_NAME), f"inbound row {index}"
        )
        quantity = _parse_nonnegative_amount(
            _require_field(row, FIELD_QUANTITY),
            field_name=FIELD_QUANTITY,
            context=f"{reference_month}/{source_name}/{waste_name}",
        )
        key = canonical_key(reference_month, code, waste_name)
        if key in seen:
            raise IngestionError(f"duplicate inbound canonical key: {key}")
        seen.add(key)
        records.append(
            LandfillInboundRecord(
                reference_month=reference_month,
                reference_year=reference_year,
                origin_source_name=source_name,
                origin_region_code=code,
                waste_name=waste_name,
                quantity_kg=quantity,
            )
        )
    return records


def parse_fee_rows(rows: list[dict[str, Any]]) -> list[LandfillFeeRecord]:
    """Validate + normalize inbound fee rows; reject duplicate canonical keys."""
    records: list[LandfillFeeRecord] = []
    seen: set[str] = set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise SchemaValidationError(f"fee row {index} is not an object")
        reference_month, _ = parse_reference_month(_require_field(row, FIELD_REFERENCE_MONTH))
        code, source_name = normalize_origin(_require_field(row, FIELD_FEE_ORIGIN))
        waste_name = _clean_waste_name(_require_field(row, FIELD_WASTE_NAME), f"fee row {index}")
        fee = _parse_nonnegative_amount(
            _require_field(row, FIELD_FEE),
            field_name=FIELD_FEE,
            context=f"{reference_month}/{source_name}/{waste_name}",
        )
        key = canonical_key(reference_month, code, waste_name)
        if key in seen:
            raise IngestionError(f"duplicate fee canonical key: {key}")
        seen.add(key)
        records.append(
            LandfillFeeRecord(
                reference_month=reference_month,
                origin_source_name=source_name,
                origin_region_code=code,
                waste_name=waste_name,
                inbound_fee_krw=fee,
            )
        )
    return records


def join_inbound_and_fees(
    inbound: list[LandfillInboundRecord],
    fees: list[LandfillFeeRecord],
) -> tuple[list[LandfillInboundJoined], JoinReport]:
    """Join quantity and fee rows 1:1 on the canonical grain.

    Returns the joined rows and a :class:`JoinReport`. The caller decides whether
    to fail; a non-empty ``inbound_only_keys``/``fee_only_keys`` is a 1:1 breach.
    """
    fee_by_key = {
        canonical_key(f.reference_month, f.origin_region_code, f.waste_name): f for f in fees
    }
    inbound_by_key = {
        canonical_key(i.reference_month, i.origin_region_code, i.waste_name): i for i in inbound
    }
    joined: list[LandfillInboundJoined] = []
    report = JoinReport(inbound_rows=len(inbound), fee_rows=len(fees))
    for key, record in inbound_by_key.items():
        fee = fee_by_key.get(key)
        if fee is None:
            report.inbound_only_keys.append(key)
            continue
        joined.append(
            LandfillInboundJoined(
                reference_month=record.reference_month,
                reference_year=record.reference_year,
                origin_source_name=record.origin_source_name,
                origin_region_code=record.origin_region_code,
                waste_name=record.waste_name,
                quantity_kg=record.quantity_kg,
                inbound_fee_krw=fee.inbound_fee_krw,
            )
        )
    report.fee_only_keys = [key for key in fee_by_key if key not in inbound_by_key]
    report.joined = len(joined)
    return joined, report


def extract_rows(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], int | None]:
    """Extract the ``data`` array and ``totalCount`` from an odcloud page payload."""
    if not isinstance(payload, dict):
        raise SchemaValidationError("odcloud response is not a JSON object")
    # odcloud error bodies carry a numeric ``code`` and a ``msg`` instead of data.
    if "data" not in payload and ("code" in payload or "msg" in payload):
        raise IngestionError(
            f"odcloud API error response: code={payload.get('code')!r} msg={payload.get('msg')!r}"
        )
    data = payload.get("data")
    if not isinstance(data, list):
        raise SchemaValidationError("odcloud response is missing a 'data' array")
    total = payload.get("totalCount")
    total_count = int(total) if isinstance(total, int) else None
    return data, total_count


__all__ = [
    "ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW",
    "DESTINATION_CODE",
    "EVIDENCE_OFFICIAL_REPORTED",
    "FEE_CURRENCY_KRW",
    "FEE_DATASET_ID",
    "INBOUND_DATASET_ID",
    "ODCLOUD_API_BASE_URL",
    "ODCLOUD_OAS_URL",
    "ORIGIN_CODE_BY_SOURCE_NAME",
    "ORIGIN_LEVEL_METROPOLITAN",
    "QUANTITY_UNIT_KG",
    "TRANSFORMATION_VERSION",
    "JoinReport",
    "LandfillFeeRecord",
    "LandfillInboundJoined",
    "LandfillInboundRecord",
    "SnapshotRef",
    "canonical_key",
    "extract_rows",
    "join_inbound_and_fees",
    "normalize_origin",
    "parse_fee_rows",
    "parse_inbound_rows",
    "parse_reference_month",
    "select_latest_snapshot",
]
