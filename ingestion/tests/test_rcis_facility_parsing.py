"""Synthetic per-PID parsing tests for RCIS waste-treatment facilities.

All payloads are clearly synthetic fixtures; values are invented and do not
represent official RCIS data.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from waste_equity_ingestion.errors import (
    ProviderResultError,
    SchemaValidationError,
    UnsupportedSchemaEraError,
)
from waste_equity_ingestion.rcis_facility_contract import (
    PID_SPECS,
    parse_facility_response,
)

PROCESSING_PIDS = ("NTN031", "NTN032", "NTN040", "NTN046")
LANDFILL_PIDS = ("NTN033", "NTN043")


def _payload(pid: str, rows: list[dict[str, Any]], *, err="E000", year="2024") -> dict[str, Any]:
    return {
        "result": [
            {
                "ERR_CODE": err,
                "RESULT": "SYNTHETIC",
                "YEAR": year,
                "PID": pid,
                "TITLE": f"SYNTHETIC {pid}",
                "DUNIT": " ",
            }
        ],
        "dataHeader": [{"SEQ": "SEQ"}],
        "data": rows,
        "searchOption": None,
    }


def _facility_row(pid: str, sido="서울", sigungu="종로구", **overrides: Any) -> dict[str, Any]:
    spec = PID_SPECS[pid]
    row: dict[str, Any] = {
        "SEQ": "1",
        "CITY_JIDT_CD_NM": sido,
        "CTS_JIDT_CD_NM": sigungu,
        spec.name_field: "테스트시설",
        "ADDR": "테스트로 1",
        "PERM_YYMMDD": "2001.01.01",
    }
    if spec.has_operator:
        row["CEO_NM"] = "홍길동"
    if spec.facility_kind == "LANDFILL":
        row.update(
            {
                "FILL_QTY_TON": 1000,
                "TOT_FILL_AREA": 5000,
                "TOT_FILL_CAP": 90000,
                "RMN_FILL_CAP": 20000,
                "FILL_QTY_M3": 950,
                "USE_YYYY": "2000-2030",
            }
        )
    else:
        row.update(
            {
                spec.capacity_field: 100,
                "DISP_QTY": 500,
                "RSDL_SUM": 50,
                "RSDL_RECY_QTY": 10,
                "RSDL_INCI_QTY": 20,
                "RSDL_FILL_QTY": 15,
                "RSDL_ETC_QTY": 5,
            }
        )
    row.update(overrides)
    return row


def _aggregate_national(pid: str) -> dict[str, Any]:
    return {
        "SEQ": "178개소",
        "CITY_JIDT_CD_NM": "전국",
        "CTS_JIDT_CD_NM": "합계",
        PID_SPECS[pid].name_field: None,
        "ADDR": None,
    }


def _aggregate_sido(pid: str, sido="서울") -> dict[str, Any]:
    return {
        "SEQ": "5개소",
        "CITY_JIDT_CD_NM": sido,
        "CTS_JIDT_CD_NM": "소계",
        PID_SPECS[pid].name_field: None,
        "ADDR": None,
    }


@pytest.mark.parametrize("pid", PID_SPECS.keys())
def test_valid_facility_row_is_parsed(pid: str) -> None:
    rows = [_aggregate_national(pid), _aggregate_sido(pid), _facility_row(pid)]
    result = parse_facility_response(_payload(pid, rows), pid=pid, year=2024)
    assert result.provider_code == "E000"
    assert len(result.records) == 1
    assert result.excluded_aggregate_rows == 2
    rec = result.records[0]
    assert rec.facility_name == "테스트시설"
    assert rec.facility_category == PID_SPECS[pid].facility_category
    assert rec.address == "테스트로 1"
    assert rec.throughput_unit == "톤/년"
    assert rec.source_fields  # full source row preserved


@pytest.mark.parametrize("pid", PROCESSING_PIDS)
def test_processing_capacity_and_residue(pid: str) -> None:
    result = parse_facility_response(_payload(pid, [_facility_row(pid)]), pid=pid, year=2024)
    rec = result.records[0]
    assert rec.capacity_quantity == Decimal("100")
    assert rec.capacity_unit == "톤/일"
    assert rec.throughput_quantity == Decimal("500")
    assert rec.residue_total == Decimal("50")
    assert rec.fill_area_m2 is None


@pytest.mark.parametrize("pid", LANDFILL_PIDS)
def test_landfill_volume_fields(pid: str) -> None:
    result = parse_facility_response(_payload(pid, [_facility_row(pid)]), pid=pid, year=2024)
    rec = result.records[0]
    assert rec.capacity_quantity is None  # landfills use volume, not 톤/일 capacity
    assert rec.throughput_quantity == Decimal("1000")  # FILL_QTY_TON
    assert rec.total_fill_capacity_m3 == Decimal("90000")
    assert rec.remaining_fill_capacity_m3 == Decimal("20000")
    assert rec.fill_area_m2 == Decimal("5000")
    assert rec.fill_use_period == "2000-2030"
    assert rec.residue_total is None


def test_private_pid_captures_operator_public_does_not() -> None:
    private = parse_facility_response(
        _payload("NTN040", [_facility_row("NTN040")]), pid="NTN040", year=2024
    ).records[0]
    public = parse_facility_response(
        _payload("NTN031", [_facility_row("NTN031")]), pid="NTN031", year=2024
    ).records[0]
    assert private.operator_name == "홍길동"
    assert private.ownership == "PRIVATE"
    assert public.operator_name is None
    assert public.ownership == "PUBLIC"


def test_aggregate_rows_excluded_by_null_name_even_without_pseudo_label() -> None:
    # A row with a null facility name is aggregate even if region looks real.
    rows = [dict(_aggregate_national("NTN031")), _facility_row("NTN031")]
    result = parse_facility_response(_payload("NTN031", rows), pid="NTN031", year=2024)
    assert len(result.records) == 1
    assert result.excluded_aggregate_rows == 1


def test_missing_address_is_rejected() -> None:
    row = _facility_row("NTN031", ADDR=None)
    result = parse_facility_response(_payload("NTN031", [row]), pid="NTN031", year=2024)
    assert result.records == []
    assert any("missing address" in r for r in result.rejected_rows)


def test_negative_throughput_is_rejected_row() -> None:
    row = _facility_row("NTN031", DISP_QTY=-5)
    result = parse_facility_response(_payload("NTN031", [row]), pid="NTN031", year=2024)
    assert result.records == []
    assert any("negative" in r for r in result.rejected_rows)


def test_null_capacity_is_none_not_zero() -> None:
    row = _facility_row("NTN031", FAC_CAP=None)
    rec = parse_facility_response(_payload("NTN031", [row]), pid="NTN031", year=2024).records[0]
    assert rec.capacity_quantity is None
    assert rec.capacity_unit is None


def test_provider_no_data_returns_empty() -> None:
    result = parse_facility_response(_payload("NTN031", [], err="E099"), pid="NTN031", year=2024)
    assert result.provider_code == "E099"
    assert result.records == []


def test_provider_error_is_raised() -> None:
    with pytest.raises(ProviderResultError):
        parse_facility_response(_payload("NTN031", [], err="E002"), pid="NTN031", year=2024)


def test_unsupported_year_is_rejected() -> None:
    with pytest.raises(UnsupportedSchemaEraError):
        parse_facility_response(
            _payload("NTN031", [_facility_row("NTN031")], year="2019"), pid="NTN031", year=2019
        )


def test_unknown_pid_is_rejected() -> None:
    with pytest.raises(SchemaValidationError):
        parse_facility_response(_payload("NTN999", []), pid="NTN999", year=2024)


def test_decimal_precision_preserved() -> None:
    row = _facility_row("NTN033", FILL_QTY_TON="262824.5", TOT_FILL_CAP="20539804")
    rec = parse_facility_response(_payload("NTN033", [row]), pid="NTN033", year=2024).records[0]
    assert rec.throughput_quantity == Decimal("262824.5")
    assert rec.total_fill_capacity_m3 == Decimal("20539804")
