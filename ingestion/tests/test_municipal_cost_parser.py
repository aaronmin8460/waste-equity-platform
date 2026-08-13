"""Parser tests for the 2024 municipal waste-cost workbooks.

Every fixture is SYNTHETIC (see ``municipal_cost_fixtures``). The real
disclosure workbooks are Git-ignored local data and are never read here.

The suite is organised around the guarantees the release makes:

- all seven audited layouts parse through one code path, located by header name
- a missing value is never stored as zero, and a measured zero is never lost
- a quantity block copied under several contracts is one logical series
- only an actual paid amount reaches the primary numerator
"""

from __future__ import annotations

import unicodedata
from decimal import Decimal
from pathlib import Path

import pytest
from municipal_cost_fixtures import (
    HEADER_TAIL,
    HEADERS_DATA_B,
    HEADERS_DATA_B_WITH_UNIT_NOTE,
    HEADERS_FAMILY_2,
    HEADERS_FAMILY_2_WIDE,
    HEADERS_FAMILY_2_WIDEST,
    HEADERS_FAMILY_3,
    HEADERS_FAMILY_4,
    HEADERS_FAMILY_5,
    HEADERS_FAMILY_6,
    HEADERS_FAMILY_7,
    HEADERS_FAMILY_8,
    HEADERS_FAMILY_8_ALT_SPELLING,
    contract_row,
    data_b_rows,
    inject_cached_formula,
    monthly_pairs,
    quantity_row,
    write_workbook,
)
from waste_equity_backend.models.municipal_cost import (
    ATTRIBUTION_MUNICIPAL_TOTAL_REPEATED,
    ATTRIBUTION_MUNICIPAL_TOTAL_SINGLE,
    ATTRIBUTION_PER_CONTRACT,
    CLASS_DATA_A_PARTIAL_WASTE_SCOPE,
    CLASS_DATA_A_PAYMENT_AND_QUANTITY,
    CLASS_DATA_A_PAYMENT_ONLY,
    CLASS_DATA_A_QUANTITY_ONLY,
    CLASS_DATA_B_QUANTITY_VALIDATION,
    CLASS_EMPTY_OR_NO_DATA,
    CLASS_UNSUPPORTED_LAYOUT,
    DATASET_ROLE_A,
    DATASET_ROLE_B,
    GEOGRAPHIC_SCOPE_SUB,
    GEOGRAPHIC_SCOPE_WHOLE,
    LAYOUT_DATA_A_CONTRACT_DASH_ONLY_QUANTITY,
    LAYOUT_DATA_A_CONTRACT_DESTINATION_SPLIT,
    LAYOUT_DATA_A_CONTRACT_NUMBERED_PAIRS,
    LAYOUT_DATA_A_CONTRACT_QUANTITY_PAIRS,
    LAYOUT_DATA_A_CONTRACT_TONNE_LABELLED_PAIRS,
    LAYOUT_DATA_A_CONTRACT_WITH_PAYMENT_LEDGER,
    LAYOUT_DATA_B_MONTHLY_CATEGORY_GRID,
    LAYOUT_UNSUPPORTED,
    PAYMENT_ACTUAL_PAID,
    PAYMENT_BUDGET_ESTIMATE,
    PAYMENT_CONTRACT_AWARD,
    QUANTITY_PERIOD_ANNUAL,
    QUANTITY_PERIOD_MONTHLY,
    QUANTITY_PERIOD_MONTHLY_AVERAGE,
    REASON_INCONSISTENT_TOTAL,
    REASON_MIXED_REFERENCE_YEARS,
    REASON_PARTIAL_GEOGRAPHIC_SCOPE,
    REASON_PARTIAL_PERIOD_COVERAGE,
    REASON_PARTIAL_WASTE_SCOPE,
    REASON_PAYMENT_PERIOD_COVERAGE_INCOMPLETE,
    REASON_UNSUPPORTED_SOURCE_LAYOUT,
    REASON_ZERO_TOTAL_QUANTITY,
    VALUE_BLANK,
    VALUE_MEASURED,
    VALUE_MEASURED_ZERO,
    VALUE_SOURCE_DASH_NO_DATA,
    VALUE_SOURCE_TEXT_NO_DATA,
    WASTE_CATEGORY_FOOD,
    WASTE_CATEGORY_GENERAL,
    WASTE_CATEGORY_RECYCLING,
    WASTE_SCOPE_ALL_MUNICIPAL,
    WASTE_SCOPE_FOOD_ONLY,
    WASTE_SCOPE_GENERAL_ONLY,
    WASTE_SCOPE_RECYCLING_ONLY,
)

from waste_equity_ingestion.municipal_cost_parser import (
    ParsedWorkbook,
    classify_contract_waste_scope,
    classify_value,
    covers_all_streams,
    extract_contractor,
    parse_label_period,
    parse_money_text,
    parse_period_label,
    parse_workbook,
    quantize_quantity,
    split_list_cell,
)

YEAR = 2024


def parse_a(path: Path, annotation: str = "") -> ParsedWorkbook:
    return parse_workbook(
        path, dataset_role=DATASET_ROLE_A, reference_year=YEAR, filename_annotation=annotation
    )


def parse_b(path: Path) -> ParsedWorkbook:
    return parse_workbook(path, dataset_role=DATASET_ROLE_B, reference_year=YEAR)


# ---------------------------------------------------------------------------
# Unicode normalization
# ---------------------------------------------------------------------------


def test_nfd_path_and_nfd_cell_text_parse_identically(tmp_path: Path) -> None:
    """macOS returns Korean filenames in NFD; the parser must not care."""

    nfc_name = unicodedata.normalize("NFC", "광명시.xlsx")
    nfd_name = unicodedata.normalize("NFD", "광명시.xlsx")
    assert nfc_name != nfd_name  # the whole point of the guard

    rows = [contract_row(organisation=unicodedata.normalize("NFD", "광명시청"))]
    nfc_path = write_workbook(tmp_path / nfc_name, HEADERS_FAMILY_2, rows)
    nfd_path = write_workbook(tmp_path / "nfd" / nfd_name, HEADERS_FAMILY_2, rows)

    first, second = parse_a(nfc_path), parse_a(nfd_path)
    assert first.source_municipality_names == second.source_municipality_names
    # The organisation cell was authored in NFD and comes back normalized.
    assert first.source_municipality_names == (unicodedata.normalize("NFC", "광명시청"),)


# ---------------------------------------------------------------------------
# Layout families
# ---------------------------------------------------------------------------


def test_family_2_nine_columns(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "f2.xlsx",
        HEADERS_FAMILY_2,
        [contract_row(pairs=["시 전체 수거량: 1월", 100.5])],
    )
    parsed = parse_a(path)
    assert parsed.layout_family == LAYOUT_DATA_A_CONTRACT_QUANTITY_PAIRS
    assert len(parsed.contracts) == 1
    assert parsed.contracts[0].payment_amount_krw == Decimal(1_000_000)


@pytest.mark.parametrize(
    ("headers", "pairs"),
    [
        (HEADERS_FAMILY_2, ["a: 1월", 1.0]),
        (HEADERS_FAMILY_2_WIDE, ["a: 1월", 1.0, "b: 1월", 2.0]),
        (HEADERS_FAMILY_2_WIDEST, ["a: 1월", 1.0, "b: 1월", 2.0, "c: 1월", 3.0, "d: 1월", 4.0]),
    ],
)
def test_variable_column_width_shares_one_code_path(
    tmp_path: Path, headers: list[object], pairs: list[object]
) -> None:
    """9, 11 and 15 column variants differ only in the number of quantity pairs."""

    path = write_workbook(tmp_path / "wide.xlsx", headers, [contract_row(pairs=pairs)])
    parsed = parse_a(path)
    assert parsed.layout_family == LAYOUT_DATA_A_CONTRACT_QUANTITY_PAIRS
    assert len(parsed.contracts) == 1
    assert len(parsed.quantities) == len(pairs) // 2


def test_family_3_payment_ledger_detected(tmp_path: Path) -> None:
    rows = [
        contract_row(pairs=[None, None, None, None], trailing=[None, None, None]),
        quantity_row([None, None, None, None], trailing=["2024-02", "일반", 100]),
    ]
    path = write_workbook(tmp_path / "f3.xlsx", HEADERS_FAMILY_3, rows)
    parsed = parse_a(path)
    assert parsed.layout_family == LAYOUT_DATA_A_CONTRACT_WITH_PAYMENT_LEDGER


def test_family_4_numbered_pairs_detected(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "f4.xlsx",
        HEADERS_FAMILY_4,
        [contract_row(pairs=["일반 반출량: 1월", 10.0, None, None])],
    )
    assert parse_a(path).layout_family == LAYOUT_DATA_A_CONTRACT_NUMBERED_PAIRS


def test_family_5_destination_split_detected(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "f5.xlsx",
        HEADERS_FAMILY_5,
        [
            contract_row(
                pairs=["수도권매립지 반입: 2024-01", 1.0, "소각장 반입: 2024-01", 2.0, None, None]
            )
        ],
    )
    parsed = parse_a(path)
    assert parsed.layout_family == LAYOUT_DATA_A_CONTRACT_DESTINATION_SPLIT
    # 총 금액(원) is the reviewed equivalent of 총 금액(총 지급액).
    assert parsed.contracts[0].payment_amount_krw == Decimal(1_000_000)


def test_family_6_dash_only_quantity_detected(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "f6.xlsx",
        HEADERS_FAMILY_6,
        [contract_row(pairs=["-", "-", "-", "-"])],
    )
    parsed = parse_a(path)
    assert parsed.layout_family == LAYOUT_DATA_A_CONTRACT_DASH_ONLY_QUANTITY
    assert {q.value_state for q in parsed.quantities} == {VALUE_SOURCE_DASH_NO_DATA}
    assert all(q.quantity_value is None for q in parsed.quantities)


def test_family_7_tonne_labelled_pairs_detected(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "f7.xlsx",
        HEADERS_FAMILY_7,
        [contract_row(pairs=["생활쓰레기 반출량: 1월", 177.71, None, None])],
    )
    assert parse_a(path).layout_family == LAYOUT_DATA_A_CONTRACT_TONNE_LABELLED_PAIRS


def test_family_1_data_b_grid_detected(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "b.xlsx",
        HEADERS_DATA_B,
        data_b_rows([1.0] * 12, [2.0] * 12, [3.0] * 12, (12.0, 24.0, 36.0, 72.0)),
        sheet_name="2024년",
    )
    parsed = parse_b(path)
    assert parsed.layout_family == LAYOUT_DATA_B_MONTHLY_CATEGORY_GRID
    assert parsed.primary_classification == CLASS_DATA_B_QUANTITY_VALIDATION


def test_unsupported_layout_is_reported_not_guessed(tmp_path: Path) -> None:
    path = write_workbook(tmp_path / "odd.xlsx", ["a", "b", "c"], [[1, 2, 3]])
    parsed = parse_a(path)
    assert parsed.layout_family == LAYOUT_UNSUPPORTED
    assert parsed.primary_classification == CLASS_UNSUPPORTED_LAYOUT
    assert REASON_UNSUPPORTED_SOURCE_LAYOUT in parsed.payment_limitation_reasons


def test_empty_sheet_yields_no_observations(tmp_path: Path) -> None:
    path = write_workbook(tmp_path / "empty.xlsx", [], [])
    parsed = parse_a(path)
    assert parsed.primary_classification == CLASS_EMPTY_OR_NO_DATA
    assert parsed.contracts == [] and parsed.quantities == []


def test_extra_empty_sheets_are_skipped(tmp_path: Path) -> None:
    """Every real DATA_A file carries empty Sheet2/Sheet3."""

    path = write_workbook(
        tmp_path / "extra.xlsx",
        HEADERS_FAMILY_2,
        [contract_row(pairs=["a: 1월", 1.0])],
        extra_empty_sheets=("Sheet2", "Sheet3"),
    )
    parsed = parse_a(path)
    assert parsed.sheet_name == "Sheet1"
    assert len(parsed.contracts) == 1


def test_merged_cells_do_not_hide_a_contract(tmp_path: Path) -> None:
    """미추홀구/제물포구 merge 기관명 and 총 금액 down their whole block."""

    rows = [
        contract_row(pairs=["반입량: 1월", 10.0]),
        *[quantity_row(pair) for pair in monthly_pairs("반입량", [None] * 12)[1:]],
    ]
    path = write_workbook(
        tmp_path / "merged.xlsx",
        HEADERS_FAMILY_2,
        rows,
        merges=["B2:B12", "D2:D12"],
    )
    parsed = parse_a(path)
    assert len(parsed.contracts) == 1
    assert parsed.contracts[0].payment_amount_krw == Decimal(1_000_000)
    assert parsed.source_municipality_names == ("테스트시청",)


def test_cached_formula_value_is_read(tmp_path: Path) -> None:
    """The parser reads with data_only=True and must see the cached result."""

    path = write_workbook(
        tmp_path / "cached.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(payment=100, pairs=["a: 1월", 1.0]),
            contract_row(payment=200, pairs=["a: 1월", 1.0]),
            [None, None, "합계", 0, None, None, None, None, None],
        ],
    )
    inject_cached_formula(path, "D4", "SUM(D2:D3)", 300)
    parsed = parse_a(path)
    assert parsed.source_total_krw == Decimal(300)
    assert parsed.recomputed_total_krw == Decimal(300)
    assert REASON_INCONSISTENT_TOTAL not in parsed.quantity_limitation_reasons


# ---------------------------------------------------------------------------
# Payment eligibility
# ---------------------------------------------------------------------------


def test_source_total_row_is_a_checksum_not_a_contract(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "total.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(payment=100),
            contract_row(payment=200),
            [None, None, "합계", 300, None, None, None, None, None],
        ],
    )
    parsed = parse_a(path)
    assert len(parsed.contracts) == 2
    assert [c.payment_amount_krw for c in parsed.contracts] == [Decimal(100), Decimal(200)]
    # The total is recorded for reconciliation and never added to the numerator.
    assert parsed.source_total_krw == Decimal(300)
    assert parsed.eligible_payment_total == Decimal(300)


def test_inconsistent_source_total_is_flagged(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "bad_total.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(payment=100),
            [None, None, "합계", 999, None, None, None, None, None],
        ],
    )
    parsed = parse_a(path)
    assert REASON_INCONSISTENT_TOTAL in parsed.quantity_limitation_reasons


def test_text_total_never_becomes_a_number(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "text_total.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(payment=None),
            [None, None, "합계", "확인 불가", None, None, None, None, None],
        ],
    )
    parsed = parse_a(path)
    assert parsed.source_total_krw is None
    assert parsed.source_total_text == "확인 불가"
    assert parsed.eligible_payment_total is None
    assert parsed.contracts[0].payment_source_text is None


def test_payment_cell_text_is_preserved_not_zeroed(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "text_pay.xlsx",
        HEADERS_FAMILY_2,
        [contract_row(payment="확인 불가")],
    )
    contract = parse_a(path).contracts[0]
    assert contract.payment_amount_krw is None
    assert contract.payment_source_text == "확인 불가"
    assert contract.is_primary_numerator_eligible is False


def test_budget_estimate_note_excludes_the_row_from_the_numerator(tmp_path: Path) -> None:
    """미추홀구 r266: 134,000원/t × 1,500 t 예상량, 실적 정산치 아닌 예산/예상금액."""

    path = write_workbook(
        tmp_path / "budget.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(
                payment=201_000_000,
                note=(
                    "톤당 134,000원×1,500톤(예상량)=201,000,000원 "
                    "(내부결재 공문 기준, 실적 정산치 아닌 예산/예상금액)."
                ),
            ),
            contract_row(payment=500),
        ],
    )
    parsed = parse_a(path)
    assert parsed.contracts[0].payment_type == PAYMENT_BUDGET_ESTIMATE
    assert parsed.contracts[0].is_primary_numerator_eligible is False
    assert parsed.eligible_payment_total == Decimal(500)
    assert parsed.eligible_contract_count == 1


def test_contract_award_note_excludes_the_row_from_the_numerator(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "award.xlsx",
        HEADERS_FAMILY_2,
        [contract_row(payment=700, note="총금액은 계약금액이며 실제 지급액이 아님")],
    )
    contract = parse_a(path).contracts[0]
    assert contract.payment_type == PAYMENT_CONTRACT_AWARD
    assert contract.is_primary_numerator_eligible is False


def test_award_mentioned_in_prose_does_not_reclassify_a_paid_amount(tmp_path: Path) -> None:
    """제물포구 states the award *and* that column D is the settled paid amount."""

    note = (
        "예정처리량 2,117.83톤, 톤당단가 258,407원, 계약금액 547,262,000원 "
        "(참고: 최초 계약금액이며 D열은 정산 후 실제지급액=준공금액)"
    )
    path = write_workbook(
        tmp_path / "paid.xlsx", HEADERS_FAMILY_2, [contract_row(payment=485_044_000, note=note)]
    )
    contract = parse_a(path).contracts[0]
    assert contract.payment_type == PAYMENT_ACTUAL_PAID
    assert contract.is_primary_numerator_eligible is True


def test_data_b_never_produces_a_payment(tmp_path: Path) -> None:
    """DATA_B has no monetary field; the parser structurally cannot invent one."""

    path = write_workbook(
        tmp_path / "b.xlsx",
        HEADERS_DATA_B,
        data_b_rows([100.0] * 12, [200.0] * 12, [300.0] * 12, (1200.0, 2400.0, 3600.0, 7200.0)),
        sheet_name="2024년",
    )
    parsed = parse_b(path)
    assert parsed.contracts == []
    assert parsed.eligible_payment_total is None
    assert parsed.eligible_contract_count == 0


# ---------------------------------------------------------------------------
# Classification of DATA_A content
# ---------------------------------------------------------------------------


def test_payment_only_file(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "payonly.xlsx", HEADERS_FAMILY_2, [contract_row(pairs=[None, None])]
    )
    assert parse_a(path).primary_classification == CLASS_DATA_A_PAYMENT_ONLY


def test_quantity_only_file(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "qtyonly.xlsx",
        HEADERS_FAMILY_2,
        [contract_row(payment=None, pairs=["처리량: 1월", 2205.88])],
    )
    assert parse_a(path).primary_classification == CLASS_DATA_A_QUANTITY_ONLY


def test_payment_and_quantity_file(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "both.xlsx", HEADERS_FAMILY_2, [contract_row(pairs=["a: 1월", 5.0])]
    )
    assert parse_a(path).primary_classification == CLASS_DATA_A_PAYMENT_AND_QUANTITY


def test_partial_waste_scope_from_contract_names(tmp_path: Path) -> None:
    """남동구: every contract is 생활폐기물(일반) only."""

    path = write_workbook(
        tmp_path / "general.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(name="2023~2025년도 생활폐기물(일반) 수집·운반 대행용역(1권역)"),
            contract_row(name="2023~2025년도 생활폐기물(일반) 수집·운반 대행용역(2권역)"),
        ],
    )
    parsed = parse_a(path)
    assert parsed.primary_classification == CLASS_DATA_A_PARTIAL_WASTE_SCOPE
    assert REASON_PARTIAL_WASTE_SCOPE in parsed.payment_limitation_reasons
    assert {c.waste_scope for c in parsed.contracts} == {WASTE_SCOPE_GENERAL_ONLY}


def test_partial_waste_scope_from_filename_annotation(tmp_path: Path) -> None:
    """부평구 states its 일반-only scope only in the delivered filename."""

    annotation = "생활(일반)수집운반만 있고 음식물류·재활용 데이터 없음"
    path = write_workbook(
        tmp_path / "부평구.xlsx",
        HEADERS_FAMILY_2,
        [contract_row(name="2024년 생활폐기물 수집운반 대행계약(1권역)")],
    )
    parsed = parse_a(path, annotation)
    assert parsed.contracts[0].waste_scope == WASTE_SCOPE_GENERAL_ONLY
    assert REASON_PARTIAL_WASTE_SCOPE in parsed.payment_limitation_reasons
    # Without the annotation the same workbook is whole-stream.
    assert parse_a(path).contracts[0].waste_scope == WASTE_SCOPE_ALL_MUNICIPAL


def test_streams_covered_separately_are_not_partial(tmp_path: Path) -> None:
    """미추홀구's separate 일반/재활용/음식물 contracts together cover everything."""

    path = write_workbook(
        tmp_path / "allthree.xlsx",
        HEADERS_FAMILY_2,
        [
            contract_row(name="생활폐기물(일반) 수집운반 대행(1권역)"),
            contract_row(name="생활폐기물(재활용) 수집운반 대행(1권역)"),
            contract_row(name="생활폐기물(음식물류) 수집운반 대행(1권역)"),
        ],
    )
    parsed = parse_a(path)
    assert REASON_PARTIAL_WASTE_SCOPE not in parsed.payment_limitation_reasons
    assert parsed.primary_classification == CLASS_DATA_A_PAYMENT_ONLY


def test_partial_geographic_scope(tmp_path: Path) -> None:
    """옹진군's two contracts cover 영흥면 / 북도·영흥면 only."""

    path = write_workbook(
        tmp_path / "onjin.xlsx",
        HEADERS_FAMILY_2,
        [contract_row(name="생활쓰레기 수집·운반 및 수송 민간위탁 용역(3차)(영흥면)")],
    )
    contract = parse_a(path).contracts[0]
    assert contract.geographic_scope == GEOGRAPHIC_SCOPE_SUB
    assert REASON_PARTIAL_GEOGRAPHIC_SCOPE in contract.limitation_reasons


def test_whole_municipality_scope_is_the_default(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "whole.xlsx",
        HEADERS_FAMILY_2,
        [contract_row(name="생활폐기물 수집·운반 대행용역(1구역)")],
    )
    contract = parse_a(path).contracts[0]
    assert contract.geographic_scope == GEOGRAPHIC_SCOPE_WHOLE
    assert contract.limitation_reasons == ()


def test_partial_period_coverage_parses_the_declared_range(tmp_path: Path) -> None:
    """가평군's 년도 cells hold explicit part-year ranges."""

    path = write_workbook(
        tmp_path / "gapyeong.xlsx",
        HEADERS_FAMILY_2,
        [contract_row(year="2024.2.26.~4.5", payment=152_884_450)],
    )
    contract = parse_a(path).contracts[0]
    assert REASON_PARTIAL_PERIOD_COVERAGE in contract.limitation_reasons
    assert contract.payment_period_start is not None
    assert contract.payment_period_start.isoformat() == "2024-02-26"
    assert contract.payment_period_end is not None
    assert contract.payment_period_end.isoformat() == "2024-04-05"


def test_whole_year_label_invents_no_dates(tmp_path: Path) -> None:
    path = write_workbook(tmp_path / "y.xlsx", HEADERS_FAMILY_2, [contract_row(year=2024)])
    contract = parse_a(path).contracts[0]
    assert contract.payment_period_start is None
    assert contract.payment_period_end is None
    assert REASON_PARTIAL_PERIOD_COVERAGE not in contract.limitation_reasons


def test_incomplete_payment_ledger_is_derived_from_the_ledger(tmp_path: Path) -> None:
    """계양구 records only 2·3·9·10·11·12월; the gap is computed, not read from prose."""

    present = ["2024-02", "2024-03", "2024-09", "2024-10", "2024-11", "2024-12"]
    rows = [contract_row(pairs=[None, None, None, None], trailing=[None, None, None])]
    rows.extend(
        quantity_row([None, None, None, None], trailing=[month, "일반", 1000]) for month in present
    )
    path = write_workbook(tmp_path / "gyeyang.xlsx", HEADERS_FAMILY_3, rows)
    contract = parse_a(path).contracts[0]
    assert REASON_PAYMENT_PERIOD_COVERAGE_INCOMPLETE in contract.limitation_reasons


def test_complete_payment_ledger_raises_no_limitation(tmp_path: Path) -> None:
    rows = [contract_row(pairs=[None, None, None, None], trailing=[None, None, None])]
    rows.extend(
        quantity_row([None, None, None, None], trailing=[f"2024-{month:02d}", "일반", 1000])
        for month in range(1, 13)
    )
    path = write_workbook(tmp_path / "full_ledger.xlsx", HEADERS_FAMILY_3, rows)
    contract = parse_a(path).contracts[0]
    assert REASON_PAYMENT_PERIOD_COVERAGE_INCOMPLETE not in contract.limitation_reasons


def test_mixed_reference_years_is_a_quantity_side_limitation(tmp_path: Path) -> None:
    """서해구's quantities span 2023-06 → 2024-05 while the payment is 2024."""

    path = write_workbook(
        tmp_path / "mixed.xlsx",
        HEADERS_FAMILY_5,
        [
            contract_row(
                pairs=[
                    "수도권매립지 반입: 2023-06",
                    1527.77,
                    "소각장 반입: 2024-01",
                    2.0,
                    None,
                    None,
                ]
            )
        ],
    )
    parsed = parse_a(path)
    assert REASON_MIXED_REFERENCE_YEARS in parsed.quantity_limitation_reasons
    # It must NOT degrade the payment side.
    assert REASON_MIXED_REFERENCE_YEARS not in parsed.payment_limitation_reasons
    months = {q.reference_month for q in parsed.quantities}
    assert months == {"2023-06", "2024-01"}


# ---------------------------------------------------------------------------
# Missing versus zero
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("cell", "expected_state"),
    [
        (None, VALUE_BLANK),
        ("-", VALUE_SOURCE_DASH_NO_DATA),
        ("–", VALUE_SOURCE_DASH_NO_DATA),
        ("자료 없음", VALUE_SOURCE_TEXT_NO_DATA),
        ("자료없음", VALUE_SOURCE_TEXT_NO_DATA),
        ("미제공", VALUE_SOURCE_TEXT_NO_DATA),
        ("확인 불가", VALUE_SOURCE_TEXT_NO_DATA),
    ],
)
def test_every_missing_form_stays_null(cell: object, expected_state: str) -> None:
    value, state = classify_value(cell)
    assert value is None
    assert state == expected_state


def test_measured_zero_stays_numeric_zero() -> None:
    value, state = classify_value(0)
    assert value == Decimal(0)
    assert state == VALUE_MEASURED_ZERO


def test_measured_value_is_exact_decimal() -> None:
    value, state = classify_value(5882.03)
    assert state == VALUE_MEASURED
    assert value == Decimal("5882.0300")
    assert isinstance(value, Decimal)


def test_boolean_cell_is_not_read_as_a_number() -> None:
    value, state = classify_value(True)
    assert value is None
    assert state == VALUE_SOURCE_TEXT_NO_DATA


def test_ieee_noise_is_quantized_to_the_declared_precision() -> None:
    """남동구's cached 432.4299999999999 is the source's 432.43, not a new value."""

    value, _state = classify_value(432.4299999999999)
    assert value == Decimal("432.4300")
    assert quantize_quantity(Decimal("24822.29830000001")) == Decimal("24822.2983")


def test_no_data_label_with_empty_value_is_text_not_blank(tmp_path: Path) -> None:
    """군포시 writes 미제공 in the *label* column and leaves the value empty."""

    path = write_workbook(
        tmp_path / "gunpo.xlsx", HEADERS_FAMILY_2, [contract_row(pairs=["미제공", None])]
    )
    quantity = parse_a(path).quantities[0]
    assert quantity.quantity_value is None
    assert quantity.value_state == VALUE_SOURCE_TEXT_NO_DATA


def test_sum_over_dashes_zero_is_rejected_as_a_measured_zero(tmp_path: Path) -> None:
    """서해구 DATA_B: 일반/재활용 총계 0 sits over twelve '-' months."""

    path = write_workbook(
        tmp_path / "dashsum.xlsx",
        HEADERS_DATA_B,
        data_b_rows(
            ["-"] * 12,
            [1819.01] * 12,
            ["-"] * 12,
            (0, 21828.12, 0, 21828.12),
            combined=[1819.01] * 12,
        ),
        sheet_name="2024년",
    )
    parsed = parse_b(path)
    totals = {q.source_label: q for q in parsed.quantities if q.source_label.endswith(":계")}
    general = totals["일반:계"]
    assert general.quantity_value is None
    assert general.value_state == VALUE_SOURCE_DASH_NO_DATA
    assert REASON_ZERO_TOTAL_QUANTITY in general.limitation_reasons
    # The genuinely measured category keeps its number.
    assert totals["음식물:계"].quantity_value == Decimal("21828.1200")
    assert totals["음식물:계"].value_state == VALUE_MEASURED


def test_data_b_measured_zero_month_is_kept(tmp_path: Path) -> None:
    months = [0, *([1.0] * 11)]
    path = write_workbook(
        tmp_path / "zero.xlsx",
        HEADERS_DATA_B,
        data_b_rows(months, ["-"] * 12, ["-"] * 12, (11.0, "-", "-", 11.0)),
        sheet_name="2024년",
    )
    parsed = parse_b(path)
    january = next(q for q in parsed.quantities if q.source_label == "일반:1월")
    assert january.quantity_value == Decimal(0)
    assert january.value_state == VALUE_MEASURED_ZERO


def test_data_b_total_mismatch_is_flagged(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "mismatch.xlsx",
        HEADERS_DATA_B,
        data_b_rows([1.0] * 12, ["-"] * 12, ["-"] * 12, (999.0, "-", "-", 999.0)),
        sheet_name="2024년",
    )
    parsed = parse_b(path)
    assert REASON_INCONSISTENT_TOTAL in parsed.quantity_limitation_reasons


def test_data_b_categories_and_periods(tmp_path: Path) -> None:
    path = write_workbook(
        tmp_path / "cats.xlsx",
        HEADERS_DATA_B,
        data_b_rows([1.0] * 12, [2.0] * 12, [3.0] * 12, (12.0, 24.0, 36.0, 72.0)),
        sheet_name="2024년",
    )
    parsed = parse_b(path)
    categories = {q.waste_category for q in parsed.quantities}
    assert {WASTE_CATEGORY_GENERAL, WASTE_CATEGORY_FOOD, WASTE_CATEGORY_RECYCLING} <= categories
    assert {q.attribution for q in parsed.quantities} == {ATTRIBUTION_MUNICIPAL_TOTAL_SINGLE}
    periods = {q.quantity_period for q in parsed.quantities}
    assert periods == {QUANTITY_PERIOD_MONTHLY, QUANTITY_PERIOD_ANNUAL}


def test_data_b_note_rows_are_captured(tmp_path: Path) -> None:
    rows = data_b_rows([1.0] * 12, ["-"] * 12, ["-"] * 12, (12.0, "-", "-", 12.0))
    rows.append(["※ 단위: 톤(t)"])
    rows.append(["※ 원본 파일 내 지역(기관)명 명시 없음 — 남동구 자료로 확인(사용자 확인 완료)"])
    path = write_workbook(tmp_path / "notes.xlsx", HEADERS_DATA_B, rows, sheet_name="2024년")
    parsed = parse_b(path)
    assert any("단위: 톤(t)" in note for note in parsed.source_notes)
    assert any("남동구 자료로 확인" in note for note in parsed.source_notes)


# ---------------------------------------------------------------------------
# Repeated municipal quantity blocks
# ---------------------------------------------------------------------------


def _repeated_workbook(path: Path, contracts: int, series: list[float]) -> Path:
    rows: list[list[object]] = []
    for index in range(contracts):
        pairs = monthly_pairs("시 전체 수거량", series)
        rows.append(contract_row(name=f"수집·운반 대행용역({index + 1}구역)", pairs=pairs[0]))
        rows.extend(quantity_row(pair) for pair in pairs[1:])
    return write_workbook(path, HEADERS_FAMILY_2, rows)


def test_repeated_block_is_stored_once_with_full_traceability(tmp_path: Path) -> None:
    series = [float(100 + month) for month in range(12)]
    path = _repeated_workbook(tmp_path / "repeat.xlsx", 7, series)
    parsed = parse_a(path)

    assert len(parsed.contracts) == 7
    # One logical 12-month series, not 7 × 12.
    assert len(parsed.quantities) == 12
    assert {q.attribution for q in parsed.quantities} == {ATTRIBUTION_MUNICIPAL_TOTAL_REPEATED}
    # A repeated municipal total belongs to no single contract.
    assert {q.contract_index for q in parsed.quantities} == {None}
    # Every repetition's worksheet row stays provable.
    january = next(q for q in parsed.quantities if q.reference_month == "2024-01")
    assert len(january.source_repetition_rows) == 7
    assert january.source_repetition_rows[0] == january.source_row
    assert any("반복" in note for note in parsed.source_notes)


def test_summing_repeated_quantities_does_not_multiply_the_city_total(
    tmp_path: Path,
) -> None:
    series = [10.0] * 12
    parsed = parse_a(_repeated_workbook(tmp_path / "sum.xlsx", 9, series))
    total = sum(q.quantity_value or Decimal(0) for q in parsed.quantities)
    assert total == Decimal("120.0000")  # not 9 × 120


def test_only_the_identical_group_is_collapsed(tmp_path: Path) -> None:
    """광명시: seven 구역 contracts share the city series; an eighth does not."""

    series = [float(100 + month) for month in range(12)]
    rows: list[list[object]] = []
    for index in range(7):
        pairs = monthly_pairs("시 전체 수거량", series)
        rows.append(contract_row(name=f"수집·운반 용역({index + 1}구역)", pairs=pairs[0]))
        rows.extend(quantity_row(pair) for pair in pairs[1:])
    other = monthly_pairs("민간소각 처리량", [7.0] * 12)
    rows.append(contract_row(name="민간소각 처리 용역", pairs=other[0]))
    rows.extend(quantity_row(pair) for pair in other[1:])

    parsed = parse_a(write_workbook(tmp_path / "kwangmyeong.xlsx", HEADERS_FAMILY_2, rows))
    assert len(parsed.contracts) == 8
    assert len(parsed.quantities) == 24  # 12 shared + 12 standalone
    repeated = [
        q for q in parsed.quantities if q.attribution == ATTRIBUTION_MUNICIPAL_TOTAL_REPEATED
    ]
    per_contract = [q for q in parsed.quantities if q.attribution == ATTRIBUTION_PER_CONTRACT]
    assert len(repeated) == 12
    assert len(per_contract) == 12
    assert {q.contract_index for q in per_contract} == {7}


def test_distinct_blocks_stay_per_contract(tmp_path: Path) -> None:
    """미추홀구's blocks genuinely differ per contract and must not be collapsed."""

    rows: list[list[object]] = []
    for index in range(3):
        pairs = monthly_pairs("반입량", [float(index + 1)] * 12)
        rows.append(contract_row(name=f"대행({index + 1}권역)", pairs=pairs[0]))
        rows.extend(quantity_row(pair) for pair in pairs[1:])
    parsed = parse_a(write_workbook(tmp_path / "distinct.xlsx", HEADERS_FAMILY_2, rows))
    assert len(parsed.quantities) == 36
    assert {q.attribution for q in parsed.quantities} == {ATTRIBUTION_PER_CONTRACT}
    assert {q.contract_index for q in parsed.quantities} == {0, 1, 2}


def test_repeated_placeholder_block_is_not_a_municipal_total(tmp_path: Path) -> None:
    """군포시 repeats a '미제공' placeholder — that is not a city-wide measurement."""

    rows = [contract_row(name=f"대행용역({i}구역)", pairs=["미제공", None]) for i in range(1, 4)]
    parsed = parse_a(write_workbook(tmp_path / "placeholder.xlsx", HEADERS_FAMILY_2, rows))
    assert len(parsed.quantities) == 3
    assert {q.attribution for q in parsed.quantities} == {ATTRIBUTION_PER_CONTRACT}


# ---------------------------------------------------------------------------
# Small pure helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("label", "month", "period"),
    [
        ("시 전체 수거량: 1월", "2024-01", QUANTITY_PERIOD_MONTHLY),
        ("수도권매립지 반입: 2023-06", "2023-06", QUANTITY_PERIOD_MONTHLY),
        ("생활쓰레기 반출량: 6월(1차)", "2024-06", QUANTITY_PERIOD_MONTHLY),
        ("생활쓰레기 반출량: 계", None, QUANTITY_PERIOD_ANNUAL),
        ("월평균: 재활용품", None, QUANTITY_PERIOD_MONTHLY_AVERAGE),
    ],
)
def test_parse_label_period(label: str, month: str | None, period: str) -> None:
    assert parse_label_period(label, YEAR) == (month, period)


def test_monthly_average_is_never_read_as_a_total() -> None:
    """안성시 reports 월평균 values; they are not an annual total."""

    _month, period = parse_label_period("월평균: 소각용", YEAR)
    assert period == QUANTITY_PERIOD_MONTHLY_AVERAGE


@pytest.mark.parametrize(
    ("name", "scope"),
    [
        ("생활폐기물 수집·운반 대행용역(1구역)", WASTE_SCOPE_ALL_MUNICIPAL),
        ("청소업무 민간대행 용역(1구역)", WASTE_SCOPE_ALL_MUNICIPAL),
        ("생활폐기물(일반) 수집운반 대행(1권역)", WASTE_SCOPE_GENERAL_ONLY),
        ("2024년도 음식물류폐기물 민간위탁 처리대행 용역", WASTE_SCOPE_FOOD_ONLY),
        ("재활용가능자원 수집·운반 대행용역(1구역)", WASTE_SCOPE_RECYCLING_ONLY),
        ("생활·재활용가능자원·음식물류폐기물 수집·운반 대행(2권역)", WASTE_SCOPE_ALL_MUNICIPAL),
    ],
)
def test_classify_contract_waste_scope(name: str, scope: str) -> None:
    assert classify_contract_waste_scope(name, filename_forces_general=False) == scope


def test_covers_all_streams() -> None:
    assert covers_all_streams([WASTE_SCOPE_ALL_MUNICIPAL])
    assert covers_all_streams(
        [WASTE_SCOPE_GENERAL_ONLY, WASTE_SCOPE_FOOD_ONLY, WASTE_SCOPE_RECYCLING_ONLY]
    )
    assert not covers_all_streams([WASTE_SCOPE_GENERAL_ONLY])
    assert not covers_all_streams([WASTE_SCOPE_GENERAL_ONLY, WASTE_SCOPE_FOOD_ONLY])


@pytest.mark.parametrize(
    ("name", "note", "expected"),
    [
        ("용역", "계약상대자: 부원산업(주); 담당구역: …", "부원산업(주)"),
        ("용역", "계약상대방 ㈜동구환경 | 예정처리량 …", "㈜동구환경"),
        ("용역", "업체: (주)태성환경.", "(주)태성환경"),
        ("대행 용역 - (주)성남환경", "", "(주)성남환경"),
        ("대행용역(1구역)", "", None),
    ],
)
def test_extract_contractor(name: str, note: str, expected: str | None) -> None:
    assert extract_contractor(name, note) == expected


def test_split_list_cell_preserves_elements() -> None:
    assert split_list_cell("청라자원환경센터;수도권매립지") == (
        "청라자원환경센터",
        "수도권매립지",
    )
    assert split_list_cell("소각·매립(일반쓰레기) / 자원화(음식물류)") == (
        "소각·매립(일반쓰레기)",
        "자원화(음식물류)",
    )
    assert split_list_cell(None) == ()


def test_parse_period_label_whole_year() -> None:
    assert parse_period_label("2024", YEAR) == (None, None, False)


# ---------------------------------------------------------------------------
# 2024-refresh delivery: seven-column spine, alternative header spellings, and
# amounts delivered as formatted text
# ---------------------------------------------------------------------------


def test_seven_column_spine_with_no_quantity_pairs_parses(tmp_path: Path) -> None:
    """The refresh DATA_A spine puts the payment directly before 최종 처리시설."""

    path = write_workbook(
        tmp_path / "no_pairs.xlsx",
        HEADERS_FAMILY_8,
        [contract_row(payment=1_234_567, pairs=[])],
    )
    parsed = parse_a(path)
    assert parsed.layout_family == LAYOUT_DATA_A_CONTRACT_QUANTITY_PAIRS
    assert parsed.primary_classification == CLASS_DATA_A_PAYMENT_ONLY
    assert len(parsed.contracts) == 1
    assert parsed.contracts[0].payment_amount_krw == Decimal(1_234_567)
    assert parsed.contracts[0].is_primary_numerator_eligible is True
    assert parsed.quantities == []


def test_alternative_year_and_payment_header_spellings_are_located(tmp_path: Path) -> None:
    """연도 + '2024년 금액' name the same two columns as 년도 + 총 금액(총 지급액)."""

    canonical = write_workbook(
        tmp_path / "canonical.xlsx",
        HEADERS_FAMILY_8,
        [contract_row(payment=4_873_944_335, pairs=[])],
    )
    variant = write_workbook(
        tmp_path / "variant.xlsx",
        HEADERS_FAMILY_8_ALT_SPELLING,
        [contract_row(payment=4_873_944_335, pairs=[])],
    )
    first, second = parse_a(canonical), parse_a(variant)

    assert second.layout_family == first.layout_family != LAYOUT_UNSUPPORTED
    assert second.primary_classification == first.primary_classification
    assert second.contracts[0].payment_amount_krw == Decimal(4_873_944_335)
    assert second.contracts[0].payment_type == PAYMENT_ACTUAL_PAID
    assert second.contracts[0].is_primary_numerator_eligible is True
    assert second.source_municipality_names == first.source_municipality_names


def test_alternative_payment_header_still_honours_the_source_note(tmp_path: Path) -> None:
    """Locating the column by a new spelling must not bypass payment semantics."""

    path = write_workbook(
        tmp_path / "variant_award.xlsx",
        HEADERS_FAMILY_8_ALT_SPELLING,
        [contract_row(payment=500, pairs=[], note="총 금액은 계약금액이며 지급액이 아님")],
    )
    contract = parse_a(path).contracts[0]
    assert contract.payment_type == PAYMENT_CONTRACT_AWARD
    assert contract.is_primary_numerator_eligible is False


def test_contract_award_and_budget_headers_are_never_read_as_the_payment(
    tmp_path: Path,
) -> None:
    """계약금액 / 낙찰금액 / 예산액 must not satisfy the payment-column locator."""

    for header in ("계약금액", "낙찰금액", "예산액", "2024년 계약금액"):
        path = write_workbook(
            tmp_path / f"{header}.xlsx",
            ["년도", "기관명", "계약명", header, *["최종 처리시설", "처리방식", "비고"]],
            [contract_row(payment=999, pairs=[])],
        )
        parsed = parse_a(path)
        assert parsed.layout_family == LAYOUT_UNSUPPORTED, header
        assert REASON_UNSUPPORTED_SOURCE_LAYOUT in parsed.payment_limitation_reasons
        assert parsed.contracts == []


def test_repeated_header_row_inside_the_data_is_not_a_contract(tmp_path: Path) -> None:
    """미추홀구 restates the header on row 2 with a different payment spelling."""

    path = write_workbook(
        tmp_path / "double_header.xlsx",
        HEADERS_FAMILY_8,
        [
            ["연도", "기관명", "계약명", "총 금액(2024년 실제 지급액)", *HEADER_TAIL],
            contract_row(organisation="미추홀구청", payment=6_556_861_120, pairs=[]),
        ],
    )
    parsed = parse_a(path)
    assert len(parsed.contracts) == 1
    assert parsed.contracts[0].payment_amount_krw == Decimal(6_556_861_120)
    # The header row must not pollute the 기관명 signal used to resolve the
    # municipality: '기관명' itself must never be offered as an organisation name.
    assert parsed.source_municipality_names == ("미추홀구청",)


def test_text_formatted_amount_is_read_as_that_exact_number(tmp_path: Path) -> None:
    """'6,556,861,120원' is the source's own number, merely stored as text."""

    path = write_workbook(
        tmp_path / "text_money.xlsx",
        HEADERS_FAMILY_8,
        [
            contract_row(payment="6,556,861,120원", pairs=[]),
            [None, None, "합계", "6,556,861,120원", None, None, None],
        ],
    )
    parsed = parse_a(path)
    contract = parsed.contracts[0]
    assert contract.payment_amount_krw == Decimal(6_556_861_120)
    assert contract.is_primary_numerator_eligible is True
    # Provenance of a text-delivered amount is kept, not discarded.
    assert contract.payment_source_text == "6,556,861,120원"
    assert parsed.source_total_krw == Decimal(6_556_861_120)
    assert REASON_INCONSISTENT_TOTAL not in parsed.quantity_limitation_reasons


@pytest.mark.parametrize(
    "raw",
    [
        "확인 불가",
        "-",
        "미제공",
        "약 6,000,000원",
        "6,556,861,120원 (예정)",
        "1,23,456원",
        "6,556,861,120~7,000,000,000원",
        "",
        "원",
    ],
)
def test_non_numeric_money_text_never_becomes_a_number(tmp_path: Path, raw: str) -> None:
    """Anything that is not a well-formed currency literal stays missing."""

    path = write_workbook(
        tmp_path / "not_money.xlsx", HEADERS_FAMILY_8, [contract_row(payment=raw, pairs=[])]
    )
    contract = parse_a(path).contracts[0]
    assert contract.payment_amount_krw is None
    assert contract.is_primary_numerator_eligible is False


def test_parse_money_text_unit() -> None:
    assert parse_money_text("6,556,861,120원") == Decimal(6_556_861_120)
    assert parse_money_text("18,403,834,210") == Decimal(18_403_834_210)
    assert parse_money_text("1000") == Decimal(1000)
    assert parse_money_text("1,000.50원") == Decimal("1000.50")
    # Never invents a number from a placeholder, prose, or a non-string.
    assert parse_money_text("확인 불가") is None
    assert parse_money_text("-") is None
    assert parse_money_text(None) is None
    assert parse_money_text(1000) is None
    assert parse_money_text("0") == Decimal(0)


def test_data_b_grid_tolerates_a_trailing_unit_annotation_column(tmp_path: Path) -> None:
    """The refresh DATA_B grid appends a '(단위:톤)' header after 계."""

    path = write_workbook(
        tmp_path / "unit_note.xlsx",
        HEADERS_DATA_B_WITH_UNIT_NOTE,
        data_b_rows([1] * 12, [2] * 12, [3] * 12),
    )
    parsed = parse_b(path)
    assert parsed.layout_family == LAYOUT_DATA_B_MONTHLY_CATEGORY_GRID
    assert parsed.primary_classification == CLASS_DATA_B_QUANTITY_VALIDATION
    assert parsed.has_numeric_quantity is True
