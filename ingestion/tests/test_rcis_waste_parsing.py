"""Synthetic per-PID parsing tests for RCIS regional waste statistics.

All payloads here are clearly synthetic fixtures. They are NOT official RCIS
data; the quantity values are invented to exercise parser behavior.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from waste_equity_ingestion.errors import (
    ProviderResultError,
    QuotaExceededError,
    SchemaValidationError,
    UnsupportedSchemaEraError,
)
from waste_equity_ingestion.rcis_waste_contract import (
    GENERATION_FIELD,
    INCINERATION_FIELD,
    LANDFILL_FIELD,
    OTHER_FIELD,
    RECYCLING_FIELD,
    SIDO_FIELD,
    SIGUNGU_FIELD,
    WASTE_CATEGORY_FIELD,
    WASTE_MAJOR_FIELD,
    WASTE_SUB_FIELD,
    WT_TYPE_FIELD,
    parse_pid_response,
)

TARGET_PIDS = ("NTN007", "NTN008", "NTN018", "NTN022")
HAS_SUB = {"NTN008"}


def _header(has_sub: bool) -> list[dict[str, str]]:
    fields = [SIDO_FIELD, SIGUNGU_FIELD, WT_TYPE_FIELD, WASTE_MAJOR_FIELD, WASTE_CATEGORY_FIELD]
    if has_sub:
        fields.append(WASTE_SUB_FIELD)
    fields += [GENERATION_FIELD, RECYCLING_FIELD, INCINERATION_FIELD, LANDFILL_FIELD, OTHER_FIELD]
    return [{name: name for name in fields}]


def _grand_total(
    sido: str,
    sigungu: str,
    *,
    gen: Any = 100,
    recy: Any = 40,
    inci: Any = 30,
    fill: Any = 20,
    etc: Any = 10,
    has_sub: bool = False,
    wt_type: str = "총계",
    major: str = "EMPTY",
    category: str = "EMPTY",
) -> dict[str, Any]:
    row: dict[str, Any] = {
        SIDO_FIELD: sido,
        SIGUNGU_FIELD: sigungu,
        WT_TYPE_FIELD: wt_type,
        WASTE_MAJOR_FIELD: major,
        WASTE_CATEGORY_FIELD: category,
        GENERATION_FIELD: gen,
        RECYCLING_FIELD: recy,
        INCINERATION_FIELD: inci,
        LANDFILL_FIELD: fill,
        OTHER_FIELD: etc,
    }
    if has_sub:
        row[WASTE_SUB_FIELD] = "EMPTY"
    return row


def _payload(pid: str, rows: list[dict[str, Any]], *, err="E000", year="2024") -> dict[str, Any]:
    has_sub = pid in HAS_SUB
    return {
        "result": [
            {
                "ERR_CODE": err,
                "RESULT": "SYNTHETIC FIXTURE",
                "YEAR": year,
                "PID": pid,
                "TITLE": f"SYNTHETIC {pid} form name",
                "DUNIT": "( 단위 : 톤/년 )",
            }
        ],
        "dataHeader": _header(has_sub),
        "data": rows,
        "searchOption": None,
    }


def _detail_row(sido: str, sigungu: str, has_sub: bool = False) -> dict[str, Any]:
    # A non-grand-total category detail row (major != EMPTY).
    return _grand_total(
        sido,
        sigungu,
        has_sub=has_sub,
        wt_type="종량제방식 등 혼합배출",
        major="가연성",
        category="폐지류",
    )


@pytest.mark.parametrize("pid", TARGET_PIDS)
def test_valid_2020_response_extracts_grand_total(pid: str) -> None:
    has_sub = pid in HAS_SUB
    rows = [
        _grand_total("전국", "합계", has_sub=has_sub),  # pseudo national total
        _grand_total("서울특별시", "소계", has_sub=has_sub),  # pseudo sido subtotal
        _grand_total(
            "서울특별시", "종로구", gen=100, recy=40, inci=30, fill=20, etc=10, has_sub=has_sub
        ),
        _detail_row("서울특별시", "종로구", has_sub=has_sub),  # detail row, must be excluded
    ]
    result = parse_pid_response(_payload(pid, rows), pid=pid, year=2024)

    assert result.provider_code == "E000"
    assert len(result.records) == 1
    record = result.records[0]
    assert record.rcis_sido_name == "서울특별시"
    assert record.rcis_sigungu_name == "종로구"
    assert record.generation_quantity == Decimal("100")
    assert record.total_treatment_quantity == Decimal("100")
    assert record.treatment_reconciliation_difference == Decimal("0")
    assert record.reconciles is True
    assert result.excluded_pseudo_rows == 2
    assert result.excluded_detail_rows == 1
    assert record.quantity_unit == "톤/년"


def test_ntn008_requires_sub_category_field() -> None:
    # NTN008's dataHeader must declare WSTE_S_CODE_NM; the others must not need it.
    payload = _payload("NTN008", [_grand_total("서울특별시", "종로구", has_sub=True)])
    # Remove the sub-category column from the header to simulate a schema break.
    payload["dataHeader"][0].pop(WASTE_SUB_FIELD)
    with pytest.raises(SchemaValidationError, match=WASTE_SUB_FIELD):
        parse_pid_response(payload, pid="NTN008", year=2024)


def test_required_field_missing_is_rejected() -> None:
    payload = _payload("NTN007", [_grand_total("서울특별시", "종로구")])
    payload["dataHeader"][0].pop(GENERATION_FIELD)
    with pytest.raises(SchemaValidationError, match=GENERATION_FIELD):
        parse_pid_response(payload, pid="NTN007", year=2024)


def test_malformed_numeric_value_rejects_only_region_then_raises() -> None:
    # The only region has a malformed number; with no valid rows left the
    # parser raises rather than writing nothing silently.
    payload = _payload("NTN007", [_grand_total("서울특별시", "종로구", gen="not-a-number")])
    with pytest.raises(SchemaValidationError, match="no mappable grand-total"):
        parse_pid_response(payload, pid="NTN007", year=2024)


def test_malformed_numeric_rejects_row_but_keeps_valid_rows() -> None:
    payload = _payload(
        "NTN007",
        [
            _grand_total("서울특별시", "종로구", gen="not-a-number"),
            _grand_total("서울특별시", "중구", gen=50, recy=20, inci=15, fill=10, etc=5),
        ],
    )
    result = parse_pid_response(payload, pid="NTN007", year=2024)
    assert len(result.records) == 1
    assert result.records[0].rcis_sigungu_name == "중구"
    assert any("non-numeric" in row for row in result.rejected_rows)


def test_blank_generation_value_is_rejected_row() -> None:
    payload = _payload(
        "NTN007",
        [
            _grand_total("서울특별시", "종로구", gen=""),
            _grand_total("서울특별시", "중구"),
        ],
    )
    result = parse_pid_response(payload, pid="NTN007", year=2024)
    assert len(result.records) == 1
    assert any("blank/null" in row for row in result.rejected_rows)


def test_null_generation_distinct_from_zero() -> None:
    payload = _payload(
        "NTN007",
        [
            _grand_total("서울특별시", "종로구", gen=None),
            _grand_total("서울특별시", "중구"),
        ],
    )
    result = parse_pid_response(payload, pid="NTN007", year=2024)
    assert any("blank/null" in row for row in result.rejected_rows)


def test_zero_quantity_is_accepted_as_real_value() -> None:
    payload = _payload(
        "NTN007",
        [_grand_total("서울특별시", "종로구", gen=0, recy=0, inci=0, fill=0, etc=0)],
    )
    result = parse_pid_response(payload, pid="NTN007", year=2024)
    assert result.records[0].generation_quantity == Decimal("0")
    assert result.records[0].total_treatment_quantity == Decimal("0")


def test_negative_quantity_is_rejected() -> None:
    payload = _payload(
        "NTN007",
        [
            _grand_total("서울특별시", "종로구", gen=-5),
            _grand_total("서울특별시", "중구"),
        ],
    )
    result = parse_pid_response(payload, pid="NTN007", year=2024)
    assert any("negative" in row for row in result.rejected_rows)


def test_duplicate_grand_total_row_is_rejected() -> None:
    payload = _payload(
        "NTN007",
        [
            _grand_total("서울특별시", "종로구"),
            _grand_total("서울특별시", "종로구"),
        ],
    )
    result = parse_pid_response(payload, pid="NTN007", year=2024)
    assert len(result.records) == 1
    assert any("duplicate grand-total" in row for row in result.rejected_rows)


def test_pseudo_total_rows_are_excluded_not_written() -> None:
    payload = _payload(
        "NTN007",
        [
            _grand_total("전국", "합계"),
            _grand_total("서울특별시", "소계"),
            _grand_total("서울특별시", "총계"),
            _grand_total("서울특별시", "종로구"),
        ],
    )
    result = parse_pid_response(payload, pid="NTN007", year=2024)
    assert len(result.records) == 1
    assert result.excluded_pseudo_rows == 3


def test_memo_rebreakdown_line_is_not_treated_as_grand_total() -> None:
    # Each region carries a memo re-breakdown line (e.g. 음식물류 폐기물 분리배출)
    # that is EMPTY at major/detail level but is NOT the region grand total. Only
    # the 총계/합계 total-marker row must be extracted.
    rows = [
        _grand_total("서울특별시", "종로구", wt_type="총계", gen=100),
        _grand_total("서울특별시", "종로구", wt_type="음식물류 폐기물 분리배출", gen=25),
    ]
    result = parse_pid_response(_payload("NTN007", rows), pid="NTN007", year=2024)
    assert len(result.records) == 1
    assert result.records[0].generation_quantity == Decimal("100")
    assert result.records[0].waste_category_name == "총계"
    assert result.excluded_detail_rows == 1


def test_ntn008_and_ntn022_use_hapgye_grand_total_label() -> None:
    for pid in ("NTN008", "NTN022"):
        has_sub = pid in HAS_SUB
        rows = [_grand_total("서울특별시", "종로구", wt_type="합계", has_sub=has_sub)]
        result = parse_pid_response(_payload(pid, rows), pid=pid, year=2024)
        assert len(result.records) == 1
        assert result.records[0].waste_category_name == "합계"


def test_unexpected_schema_era_is_rejected() -> None:
    payload = _payload("NTN007", [_grand_total("서울특별시", "종로구")], year="2019")
    with pytest.raises(UnsupportedSchemaEraError):
        parse_pid_response(payload, pid="NTN007", year=2019)


def test_provider_no_data_e099_returns_empty_not_error() -> None:
    payload = _payload("NTN007", [], err="E099")
    result = parse_pid_response(payload, pid="NTN007", year=2024)
    assert result.provider_code == "E099"
    assert result.records == []


def test_provider_quota_e005_raises_quota_error() -> None:
    payload = _payload("NTN007", [], err="E005")
    with pytest.raises(QuotaExceededError):
        parse_pid_response(payload, pid="NTN007", year=2024)


def test_provider_authentication_error_e002_raises() -> None:
    payload = _payload("NTN007", [], err="E002")
    with pytest.raises(ProviderResultError, match="expired key"):
        parse_pid_response(payload, pid="NTN007", year=2024)


def test_invalid_pid_provider_error_e001_raises() -> None:
    payload = _payload("NTN007", [], err="E001")
    with pytest.raises(ProviderResultError):
        parse_pid_response(payload, pid="NTN007", year=2024)


def test_reference_year_mismatch_is_rejected() -> None:
    payload = _payload("NTN007", [_grand_total("서울특별시", "종로구")], year="2023")
    with pytest.raises(SchemaValidationError, match="reference year mismatch"):
        parse_pid_response(payload, pid="NTN007", year=2024)


def test_blank_unit_metadata_is_rejected() -> None:
    payload = _payload("NTN007", [_grand_total("서울특별시", "종로구")])
    payload["result"][0]["DUNIT"] = " "
    with pytest.raises(SchemaValidationError, match="unit metadata"):
        parse_pid_response(payload, pid="NTN007", year=2024)


def test_wrong_unit_metadata_is_rejected() -> None:
    payload = _payload("NTN007", [_grand_total("서울특별시", "종로구")])
    payload["result"][0]["DUNIT"] = "( 단위 : 톤/일 )"
    with pytest.raises(SchemaValidationError, match="does not match expected"):
        parse_pid_response(payload, pid="NTN007", year=2024)


def test_decimal_precision_is_preserved_exactly() -> None:
    payload = _payload(
        "NTN018",
        [
            _grand_total(
                "서울특별시",
                "종로구",
                gen="83761203.273",
                recy="70618439.84",
                inci="3357692.361",
                fill="5828657.122",
                etc="3956413.95",
            )
        ],
    )
    result = parse_pid_response(payload, pid="NTN018", year=2024)
    record = result.records[0]
    assert record.generation_quantity == Decimal("83761203.273")
    assert record.total_treatment_quantity == Decimal("83761203.273")
    assert record.treatment_reconciliation_difference == Decimal("0")


def test_reconciliation_mismatch_is_recorded_not_fatal() -> None:
    # generation deliberately does not equal the treatment component sum.
    payload = _payload(
        "NTN007",
        [_grand_total("서울특별시", "종로구", gen=200, recy=40, inci=30, fill=20, etc=10)],
    )
    result = parse_pid_response(payload, pid="NTN007", year=2024)
    record = result.records[0]
    assert record.treatment_reconciliation_difference == Decimal("100")
    assert record.reconciles is False
    assert len(result.reconciliation_mismatches) == 1


def test_reconciliation_within_tolerance_is_not_flagged() -> None:
    # A sub-1-ton rounding gap is retained but not treated as a mismatch.
    payload = _payload(
        "NTN007",
        [_grand_total("서울특별시", "종로구", gen="100.5", recy=40, inci=30, fill=20, etc=10)],
    )
    result = parse_pid_response(payload, pid="NTN007", year=2024)
    record = result.records[0]
    assert record.treatment_reconciliation_difference == Decimal("0.5")
    assert record.reconciles is True
    assert result.reconciliation_mismatches == []


def test_thousands_separator_is_parsed() -> None:
    payload = _payload(
        "NTN007",
        [
            _grand_total(
                "서울특별시", "종로구", gen="1,000", recy="400", inci="300", fill="200", etc="100"
            )
        ],
    )
    result = parse_pid_response(payload, pid="NTN007", year=2024)
    assert result.records[0].generation_quantity == Decimal("1000")
