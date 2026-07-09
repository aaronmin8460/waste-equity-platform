"""RCIS waste-treatment facility contract parsing (Phase 2.3).

Parses the 2020-onward schema of the six facility PIDs into one facility record
per real facility row. Facility rows are per-facility (``SEQ`` sequence,
``FAC_NM``/``COM_NM`` name, ``ADDR`` address). Aggregate rows (national
``전국``/``합계`` and per-sido ``소계``, which carry a ``N개소`` count in ``SEQ``
and a null facility name) are excluded.

Unlike the Phase 2.2 regional generation PIDs, facility PIDs have a blank
``DUNIT``; units are per field and per PID and are taken from the official guide
(``FAC_CAP``/``ABILITY_QTY`` 톤/일, ``DISP_QTY``/``FILL_QTY_TON`` 톤/년,
``TOT_FILL_CAP``/``RMN_FILL_CAP`` ㎥, ``TOT_FILL_AREA`` ㎡, ``FILL_QTY_M3``
㎥). Accounting basis is ``FACILITY_LOCATION_BASED_THROUGHPUT``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from .errors import SchemaValidationError
from .rcis_waste_contract import (
    SIDO_FIELD,
    SIGUNGU_FIELD,
    classify_provider_result,
    is_pseudo_region,
    parse_quantity,
    require_pid,
    require_reference_year,
    require_supported_year,
)

TRANSFORMATION_VERSION = "rcis-facility-capital-region-v1"
RCIS_SOURCE_ID = "waste_statistics"
ACCOUNTING_BASIS = "FACILITY_LOCATION_BASED_THROUGHPUT"
PROVIDER_NO_DATA = "E099"

UNIT_TON_PER_DAY = "톤/일"
UNIT_TON_PER_YEAR = "톤/년"
UNIT_M2 = "㎡"
UNIT_M3 = "㎥"

# Field names shared across facility PIDs.
FAC_NAME_FIELD = "FAC_NM"
COM_NAME_FIELD = "COM_NM"
OPERATOR_FIELD = "CEO_NM"
ADDRESS_FIELD = "ADDR"
SEQ_FIELD = "SEQ"
PERMIT_FIELD = "PERM_YYMMDD"
RETURN_FIELD = "RETURN_YYMMDD"

DISPOSAL_THROUGHPUT_FIELD = "DISP_QTY"
LANDFILL_THROUGHPUT_FIELD = "FILL_QTY_TON"
RESIDUE_FIELDS = {
    "residue_total": "RSDL_SUM",
    "residue_recycling": "RSDL_RECY_QTY",
    "residue_incineration": "RSDL_INCI_QTY",
    "residue_landfill": "RSDL_FILL_QTY",
    "residue_other": "RSDL_ETC_QTY",
}
LANDFILL_AREA_FIELD = "TOT_FILL_AREA"
LANDFILL_TOTAL_CAP_FIELD = "TOT_FILL_CAP"
LANDFILL_REMAIN_CAP_FIELD = "RMN_FILL_CAP"
LANDFILL_QTY_M3_FIELD = "FILL_QTY_M3"
LANDFILL_USE_PERIOD_FIELD = "USE_YYYY"


@dataclass(frozen=True)
class FacilityPidSpec:
    pid: str
    official_dataset_name: str
    facility_category: str
    facility_kind: str  # PROCESSING | LANDFILL
    ownership: str  # PUBLIC | PRIVATE
    name_field: str
    has_operator: bool
    capacity_field: str | None  # None for landfills (volume capacity instead)
    capacity_unit: str | None


PID_SPECS: dict[str, FacilityPidSpec] = {
    "NTN031": FacilityPidSpec(
        pid="NTN031",
        official_dataset_name="1-가. 공공소각",
        facility_category="PUBLIC_INCINERATION",
        facility_kind="PROCESSING",
        ownership="PUBLIC",
        name_field=FAC_NAME_FIELD,
        has_operator=False,
        capacity_field="FAC_CAP",
        capacity_unit=UNIT_TON_PER_DAY,
    ),
    "NTN032": FacilityPidSpec(
        pid="NTN032",
        official_dataset_name="1-나. 공공기타",
        facility_category="PUBLIC_OTHER",
        facility_kind="PROCESSING",
        ownership="PUBLIC",
        name_field=FAC_NAME_FIELD,
        has_operator=False,
        capacity_field="FAC_CAP",
        capacity_unit=UNIT_TON_PER_DAY,
    ),
    "NTN033": FacilityPidSpec(
        pid="NTN033",
        official_dataset_name="1-다. 공공매립",
        facility_category="PUBLIC_LANDFILL",
        facility_kind="LANDFILL",
        ownership="PUBLIC",
        name_field=FAC_NAME_FIELD,
        has_operator=False,
        capacity_field=None,
        capacity_unit=None,
    ),
    "NTN040": FacilityPidSpec(
        pid="NTN040",
        official_dataset_name="4-가. 중간처분(소각)",
        facility_category="PRIVATE_INTERMEDIATE_INCINERATION",
        facility_kind="PROCESSING",
        ownership="PRIVATE",
        name_field=COM_NAME_FIELD,
        has_operator=True,
        capacity_field="FAC_CAP",
        capacity_unit=UNIT_TON_PER_DAY,
    ),
    "NTN043": FacilityPidSpec(
        pid="NTN043",
        official_dataset_name="5. 최종처분",
        facility_category="PRIVATE_FINAL_DISPOSAL",
        facility_kind="LANDFILL",
        ownership="PRIVATE",
        name_field=COM_NAME_FIELD,
        has_operator=True,
        capacity_field=None,
        capacity_unit=None,
    ),
    "NTN046": FacilityPidSpec(
        pid="NTN046",
        official_dataset_name="8-가. 재활용처리(중간)",
        facility_category="PRIVATE_RECYCLING",
        facility_kind="PROCESSING",
        ownership="PRIVATE",
        name_field=COM_NAME_FIELD,
        has_operator=True,
        capacity_field="ABILITY_QTY",
        capacity_unit=UNIT_TON_PER_DAY,
    ),
}

TARGET_PIDS: tuple[str, ...] = ("NTN031", "NTN032", "NTN033", "NTN040", "NTN043", "NTN046")


@dataclass(frozen=True)
class FacilityRecord:
    source_pid: str
    official_dataset_name: str
    reference_year: int
    facility_category: str
    facility_kind: str
    ownership: str
    facility_name: str
    operator_name: str | None
    address: str
    source_seq: str | None
    # Stable 0-based position among real facility rows in the PID response.
    # Facilities have no official id and multiple process lines at one site can
    # share every business attribute (name, address, SEQ, type), so this
    # positional index is the reviewed identity key for idempotent upserts.
    source_row_index: int
    rcis_sido_name: str
    rcis_sigungu_name: str
    capacity_quantity: Decimal | None
    capacity_unit: str | None
    throughput_quantity: Decimal | None
    throughput_unit: str | None
    residue_total: Decimal | None
    residue_recycling: Decimal | None
    residue_incineration: Decimal | None
    residue_landfill: Decimal | None
    residue_other: Decimal | None
    fill_area_m2: Decimal | None
    total_fill_capacity_m3: Decimal | None
    remaining_fill_capacity_m3: Decimal | None
    fill_quantity_m3: Decimal | None
    fill_use_period: str | None
    permit_date: str | None
    return_date: str | None
    source_fields: dict[str, Any]


@dataclass(frozen=True)
class FacilityParseResult:
    pid: str
    reference_year: int
    provider_code: str
    provider_message: str
    official_dataset_name: str
    records: list[FacilityRecord]
    source_record_count: int
    excluded_aggregate_rows: int
    rejected_rows: list[str] = field(default_factory=list)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _is_aggregate_row(row: dict[str, Any], name: str | None) -> bool:
    sido = str(row.get(SIDO_FIELD, "")).strip()
    sigungu = str(row.get(SIGUNGU_FIELD, "")).strip()
    if is_pseudo_region(sido, sigungu):
        return True
    # Facility rows always carry a facility name; aggregate rows do not.
    return name is None


def parse_facility_response(
    payload: dict[str, Any],
    *,
    pid: str,
    year: int,
) -> FacilityParseResult:
    if pid not in PID_SPECS:
        raise SchemaValidationError(f"Unsupported RCIS facility PID {pid!r}")
    require_supported_year(year)
    spec = PID_SPECS[pid]

    provider_code, provider_message = classify_provider_result(payload)
    if provider_code == PROVIDER_NO_DATA:
        return FacilityParseResult(
            pid=pid,
            reference_year=year,
            provider_code=provider_code,
            provider_message=provider_message,
            official_dataset_name=spec.official_dataset_name,
            records=[],
            source_record_count=0,
            excluded_aggregate_rows=0,
        )

    require_reference_year(payload, year)
    official_dataset_name = require_pid(payload, pid)

    data = payload.get("data")
    if not isinstance(data, list):
        raise SchemaValidationError(f"{pid} response is missing the data record list")

    records: list[FacilityRecord] = []
    rejected: list[str] = []
    excluded_aggregate = 0
    # Position among real (non-aggregate) facility rows, in source order. Stable
    # for identical published data and used as the idempotency identity key.
    facility_index = -1

    for row in data:
        if not isinstance(row, dict):
            raise SchemaValidationError(f"{pid} data row is not an object")
        name = _text(row.get(spec.name_field))
        if _is_aggregate_row(row, name):
            excluded_aggregate += 1
            continue
        facility_index += 1
        sido = str(row.get(SIDO_FIELD, "")).strip()
        sigungu = str(row.get(SIGUNGU_FIELD, "")).strip()
        address = _text(row.get(ADDRESS_FIELD))
        label = f"{sido} {sigungu} {name}"
        if name is None:
            rejected.append(f"{label}: missing facility name")
            continue
        if address is None:
            rejected.append(f"{label}: missing address")
            continue
        try:
            record = _build_record(
                row,
                spec,
                official_dataset_name,
                year,
                sido,
                sigungu,
                name,
                address,
                facility_index,
            )
        except SchemaValidationError as exc:
            rejected.append(str(exc))
            continue
        records.append(record)

    return FacilityParseResult(
        pid=pid,
        reference_year=year,
        provider_code=provider_code,
        provider_message=provider_message,
        official_dataset_name=official_dataset_name,
        records=records,
        source_record_count=len(data),
        excluded_aggregate_rows=excluded_aggregate,
        rejected_rows=rejected,
    )


def _build_record(
    row: dict[str, Any],
    spec: FacilityPidSpec,
    official_dataset_name: str,
    year: int,
    sido: str,
    sigungu: str,
    name: str,
    address: str,
    source_row_index: int,
) -> FacilityRecord:
    label = f"{sido} {sigungu} {name}"

    capacity = (
        parse_quantity(row.get(spec.capacity_field), spec.capacity_field, label)
        if spec.capacity_field
        else None
    )

    if spec.facility_kind == "LANDFILL":
        throughput = parse_quantity(
            row.get(LANDFILL_THROUGHPUT_FIELD), LANDFILL_THROUGHPUT_FIELD, label
        )
        residues: dict[str, Decimal | None] = dict.fromkeys(RESIDUE_FIELDS, None)
        fill_area = parse_quantity(row.get(LANDFILL_AREA_FIELD), LANDFILL_AREA_FIELD, label)
        total_cap = parse_quantity(
            row.get(LANDFILL_TOTAL_CAP_FIELD), LANDFILL_TOTAL_CAP_FIELD, label
        )
        remain_cap = parse_quantity(
            row.get(LANDFILL_REMAIN_CAP_FIELD), LANDFILL_REMAIN_CAP_FIELD, label
        )
        fill_m3 = parse_quantity(row.get(LANDFILL_QTY_M3_FIELD), LANDFILL_QTY_M3_FIELD, label)
        use_period = _text(row.get(LANDFILL_USE_PERIOD_FIELD))
    else:
        throughput = parse_quantity(
            row.get(DISPOSAL_THROUGHPUT_FIELD), DISPOSAL_THROUGHPUT_FIELD, label
        )
        residues = {
            attr: parse_quantity(row.get(source_field), source_field, label)
            for attr, source_field in RESIDUE_FIELDS.items()
        }
        fill_area = total_cap = remain_cap = fill_m3 = None
        use_period = None

    return FacilityRecord(
        source_pid=spec.pid,
        official_dataset_name=official_dataset_name,
        reference_year=year,
        facility_category=spec.facility_category,
        facility_kind=spec.facility_kind,
        ownership=spec.ownership,
        facility_name=name,
        operator_name=_text(row.get(OPERATOR_FIELD)) if spec.has_operator else None,
        address=address,
        source_seq=_text(row.get(SEQ_FIELD)),
        source_row_index=source_row_index,
        rcis_sido_name=sido,
        rcis_sigungu_name=sigungu,
        capacity_quantity=capacity,
        capacity_unit=spec.capacity_unit if capacity is not None else None,
        throughput_quantity=throughput,
        throughput_unit=UNIT_TON_PER_YEAR if throughput is not None else None,
        residue_total=residues["residue_total"],
        residue_recycling=residues["residue_recycling"],
        residue_incineration=residues["residue_incineration"],
        residue_landfill=residues["residue_landfill"],
        residue_other=residues["residue_other"],
        fill_area_m2=fill_area,
        total_fill_capacity_m3=total_cap,
        remaining_fill_capacity_m3=remain_cap,
        fill_quantity_m3=fill_m3,
        fill_use_period=use_period,
        permit_date=_text(row.get(PERMIT_FIELD)),
        return_date=_text(row.get(RETURN_FIELD)),
        source_fields=row,
    )
