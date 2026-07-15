"""Unit tests for the pure landfill inbound-flow derivation helpers."""

from __future__ import annotations

from decimal import Decimal

from waste_equity_backend.analysis import landfill as la


def test_effective_fee_per_ton() -> None:
    # 915,000,000 KRW over 17,500,000 kg (17,500 t) = 52,285.71 KRW/t.
    assert la.effective_fee_per_ton(Decimal("915000000"), Decimal("17500000")) == Decimal(
        "52285.71"
    )


def test_effective_fee_per_ton_is_none_at_zero_quantity() -> None:
    assert la.effective_fee_per_ton(Decimal("0"), Decimal("0")) is None
    assert la.effective_fee_per_ton(Decimal("100"), Decimal("0")) is None


def test_to_tons_exact() -> None:
    assert la.to_tons(Decimal("573224990")) == Decimal("573224.990000")


def test_share_none_at_zero_total() -> None:
    assert la.share(Decimal("0"), Decimal("0")) is None
    assert la.share(Decimal("1"), Decimal("4")) == Decimal("0.250000")


def test_period_completeness() -> None:
    months = [f"2024-{m:02d}" for m in range(1, 13)] + ["2025-01", "2025-05", "2025-03"]
    assert la.is_complete_year(months, 2024) is True
    assert la.is_complete_year(months, 2025) is False
    assert la.available_through_month(months, 2025) == "2025-05"
    assert la.latest_available_month(months) == "2025-05"
    # 2024 is complete, 2025 is partial → default is the latest complete year.
    assert la.latest_complete_year(months) == 2024


def test_latest_complete_year_falls_back_to_latest_present() -> None:
    # No complete year → fall back to the latest present year rather than nothing.
    assert la.latest_complete_year(["2026-01", "2026-02"]) == 2026
    assert la.latest_complete_year([]) is None


# --------------------------------------------------------------------------- #
# Inbound fee per resident (landfill-fee-per-capita-v2)
# --------------------------------------------------------------------------- #

SEOUL = "KR-SGIS-11"
INCHEON = "KR-SGIS-28"
GYEONGGI = "KR-SGIS-41"
ALL_ORIGINS = (SEOUL, INCHEON, GYEONGGI)

CANONICAL = {SEOUL: "KR-SGIS-11", INCHEON: "KR-SGIS-23", GYEONGGI: "KR-SGIS-31"}
NAME = {SEOUL: "서울특별시", INCHEON: "인천광역시", GYEONGGI: "경기도"}
MOIS_CODE = {SEOUL: "1100000000", INCHEON: "2800000000", GYEONGGI: "4100000000"}


def _pop(
    origin: str,
    month: str,
    population: int,
    *,
    definition: str = la.EXPECTED_POPULATION_DEFINITION,
    source_id: str = la.EXPECTED_POPULATION_SOURCE_ID,
    granularity: str = la.EXPECTED_POPULATION_GRANULARITY,
    level: str = "SIDO",
) -> la.MetropolitanPopulation:
    return la.MetropolitanPopulation(
        origin_region_code=origin,
        canonical_region_code=CANONICAL[origin],
        region_name=NAME[origin],
        region_level=level,
        reference_month=month,
        reference_year=int(month[:4]),
        reference_period=month,
        population=population,
        population_definition=definition,
        population_definition_version="MOIS_TOTAL_WITH_UNREGISTERED_RESIDENT_AND_OVERSEAS_NATIONALS",
        population_comparability_note="2015-01 이후: 거주불명자와 재외국민이 포함됩니다.",
        temporal_granularity=granularity,
        source_id=source_id,
        source_administrative_code=MOIS_CODE[origin],
        unit="persons",
    )


# Real official 2024-12 MOIS denominators and the live 2024 landfill fee totals,
# so the expected values below are hand-checkable against the official inputs.
POP_2024_12 = [
    _pop(SEOUL, "2024-12", 9_331_828),
    _pop(INCHEON, "2024-12", 3_021_010),
    _pop(GYEONGGI, "2024-12", 13_694_685),
]
FEE_2024 = {
    SEOUL: Decimal("41647362920.00"),
    INCHEON: Decimal("15228400200.00"),
    GYEONGGI: Decimal("51300279950.00"),
}


# --- required_population_month: the denominator-selection policy -------------- #


def test_selected_month_uses_that_exact_month() -> None:
    assert (
        la.required_population_month(
            reference_year=2024,
            selected_month="2024-07",
            is_complete_year=True,
            available_through_month="2024-12",
        )
        == "2024-07"
    )


def test_complete_year_uses_that_years_december() -> None:
    for year in (2008, 2015, 2024, 2025):
        assert (
            la.required_population_month(
                reference_year=year,
                selected_month=None,
                is_complete_year=True,
                available_through_month=f"{year}-12",
            )
            == f"{year}-12"
        )


def test_partial_year_uses_the_final_month_in_the_fee_numerator() -> None:
    # Landfill fees stop at 2026-05 even though MOIS has published 2026-06: the
    # denominator must never post-date the numerator.
    assert (
        la.required_population_month(
            reference_year=2026,
            selected_month=None,
            is_complete_year=False,
            available_through_month="2026-05",
        )
        == "2026-05"
    )


def test_partial_year_without_any_month_has_no_denominator() -> None:
    assert (
        la.required_population_month(
            reference_year=2026,
            selected_month=None,
            is_complete_year=False,
            available_through_month=None,
        )
        is None
    )


# --- arithmetic --------------------------------------------------------------- #


def test_fee_per_capita_exact_decimal_and_rounding() -> None:
    # 41,647,362,920 / 9,331,828 = 4,462.94... exact Decimal, 2dp.
    assert la.fee_per_capita(FEE_2024[SEOUL], 9_331_828) == Decimal("4462.94")
    # Exact ties round half to even, never through binary float.
    assert la.fee_per_capita(Decimal("5"), 2) == Decimal("2.50")
    assert la.fee_per_capita(Decimal("0.125"), 1) == Decimal("0.12")
    assert la.fee_per_capita(Decimal("0.135"), 1) == Decimal("0.14")


def test_fee_per_capita_none_at_zero_or_negative_population() -> None:
    assert la.fee_per_capita(Decimal("100"), 0) is None
    assert la.fee_per_capita(Decimal("100"), -1) is None


# --- resolution --------------------------------------------------------------- #


def test_valid_2024_12_population_for_each_origin() -> None:
    expected = {SEOUL: "4462.94", INCHEON: "5040.83", GYEONGGI: "3746.00"}
    for origin, want in expected.items():
        result = la.origin_fee_per_capita(
            FEE_2024[origin], POP_2024_12, origin_region_code=origin, required_month="2024-12"
        )
        assert result.reason is None
        assert result.fee_per_capita_krw == Decimal(want)
        assert result.population_reference_month == "2024-12"
        assert result.population_definition == la.EXPECTED_POPULATION_DEFINITION
        assert result.population_source_id == la.EXPECTED_POPULATION_SOURCE_ID
        assert result.population_temporal_granularity == "MONTHLY"
        assert result.population_region_level == "SIDO"
        assert result.population_source_administrative_code == MOIS_CODE[origin]
        assert result.required_population_month == "2024-12"


def test_exact_month_is_never_swapped_for_a_neighbour_or_december() -> None:
    for wanted in ["2024-11", "2025-01", "2024-01"]:
        result = la.origin_fee_per_capita(
            Decimal("1000000"), POP_2024_12, origin_region_code=SEOUL, required_month=wanted
        )
        assert result.fee_per_capita_krw is None
        assert result.reason == la.REASON_NO_MATCHING_POPULATION_PERIOD
        assert result.population is None


def test_missing_month_reports_a_period_not_a_year() -> None:
    result = la.origin_fee_per_capita(
        Decimal("1"), POP_2024_12, origin_region_code=SEOUL, required_month="2025-12"
    )
    assert result.reason == la.REASON_NO_MATCHING_POPULATION_PERIOD
    assert "YEAR" not in (result.reason or "")


def test_no_population_row_for_origin_at_all() -> None:
    result = la.origin_fee_per_capita(
        Decimal("1000000"),
        [_pop(SEOUL, "2024-12", 9_331_828)],
        origin_region_code=INCHEON,
        required_month="2024-12",
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_NO_METROPOLITAN_POPULATION


def test_zero_population_returns_none_not_zero() -> None:
    result = la.origin_fee_per_capita(
        Decimal("1000000"),
        [_pop(SEOUL, "2024-12", 0)],
        origin_region_code=SEOUL,
        required_month="2024-12",
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_ZERO_POPULATION


def test_sgis_annual_rows_are_never_accepted_as_a_v2_denominator() -> None:
    sgis = _pop(
        SEOUL,
        "2024-12",
        9_335_444,
        definition="SGIS_TOTAL_POPULATION",
        source_id="sgis",
        granularity="ANNUAL",
    )
    result = la.origin_fee_per_capita(
        FEE_2024[SEOUL], [sgis], origin_region_code=SEOUL, required_month="2024-12"
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_AMBIGUOUS_POPULATION_DEFINITION


def test_competing_population_values_are_ambiguous() -> None:
    conflicting = [_pop(SEOUL, "2024-12", 9_331_828), _pop(SEOUL, "2024-12", 9_400_000)]
    result = la.origin_fee_per_capita(
        FEE_2024[SEOUL], conflicting, origin_region_code=SEOUL, required_month="2024-12"
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_AMBIGUOUS_POPULATION_DEFINITION


def test_identical_duplicate_population_rows_are_not_ambiguous() -> None:
    duplicated = [_pop(SEOUL, "2024-12", 9_331_828), _pop(SEOUL, "2024-12", 9_331_828)]
    result = la.origin_fee_per_capita(
        FEE_2024[SEOUL], duplicated, origin_region_code=SEOUL, required_month="2024-12"
    )
    assert result.fee_per_capita_krw == Decimal("4462.94")


def test_non_sido_population_is_rejected() -> None:
    result = la.origin_fee_per_capita(
        FEE_2024[SEOUL],
        [_pop(SEOUL, "2024-12", 9_331_828, level="SIGUNGU")],
        origin_region_code=SEOUL,
        required_month="2024-12",
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_AMBIGUOUS_POPULATION_DEFINITION


# --- aggregate ---------------------------------------------------------------- #


def test_all_origin_aggregate_is_total_fee_over_total_population() -> None:
    total_fee = sum(FEE_2024.values(), Decimal("0"))
    result = la.aggregate_fee_per_capita(
        total_fee, POP_2024_12, origin_region_codes=ALL_ORIGINS, required_month="2024-12"
    )
    assert result.reason is None
    assert result.population == 26_047_523
    # 108,176,043,070 / 26,047,523 = 4,153.026... -> 4153.03
    assert result.fee_per_capita_krw == Decimal("4153.03")
    assert result.population_reference_month == "2024-12"
    assert set(result.included_origin_region_codes) == set(ALL_ORIGINS)


def test_all_origin_aggregate_is_not_the_mean_of_per_origin_values() -> None:
    total_fee = sum(FEE_2024.values(), Decimal("0"))
    aggregate = la.aggregate_fee_per_capita(
        total_fee, POP_2024_12, origin_region_codes=ALL_ORIGINS, required_month="2024-12"
    )
    per_origin = [
        la.origin_fee_per_capita(
            FEE_2024[o], POP_2024_12, origin_region_code=o, required_month="2024-12"
        ).fee_per_capita_krw
        for o in ALL_ORIGINS
    ]
    mean = sum(v for v in per_origin if v is not None) / Decimal(len(per_origin))
    # The population-weighted aggregate must differ from the mean of the three;
    # averaging would reweight the regions as if they were equal in size.
    assert aggregate.fee_per_capita_krw != mean.quantize(Decimal("0.01"))
    assert aggregate.fee_per_capita_krw == Decimal("4153.03")


def test_all_origin_aggregate_unavailable_when_one_origin_lacks_population() -> None:
    partial = [_pop(SEOUL, "2024-12", 9_331_828), _pop(INCHEON, "2024-12", 3_021_010)]
    result = la.aggregate_fee_per_capita(
        sum(FEE_2024.values(), Decimal("0")),
        partial,
        origin_region_codes=ALL_ORIGINS,
        required_month="2024-12",
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_INCOMPLETE_POPULATION_COVERAGE
    assert result.population is None


def test_all_origin_aggregate_propagates_the_shared_reason_when_every_origin_fails() -> None:
    result = la.aggregate_fee_per_capita(
        Decimal("1000"), POP_2024_12, origin_region_codes=ALL_ORIGINS, required_month="2007-12"
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_NO_MATCHING_POPULATION_PERIOD


def test_all_origin_aggregate_rejects_mixed_population_months() -> None:
    mixed = [
        _pop(SEOUL, "2024-12", 9_331_828),
        _pop(INCHEON, "2024-12", 3_021_010),
        _pop(GYEONGGI, "2024-12", 13_694_685),
        # A stray extra month must not silently join the sum.
        _pop(GYEONGGI, "2024-11", 13_600_000),
    ]
    result = la.aggregate_fee_per_capita(
        sum(FEE_2024.values(), Decimal("0")),
        mixed,
        origin_region_codes=ALL_ORIGINS,
        required_month="2024-12",
    )
    # Only the exact month is summed, so this stays a clean 2024-12 aggregate.
    assert result.fee_per_capita_krw == Decimal("4153.03")
    assert result.population == 26_047_523


def test_monthly_fee_over_the_same_exact_month_population() -> None:
    march = [
        _pop(SEOUL, "2008-03", 10_180_000),
        _pop(INCHEON, "2008-03", 2_670_000),
        _pop(GYEONGGI, "2008-03", 11_150_000),
    ]
    march_fee = Decimal("2721000000.00")
    result = la.origin_fee_per_capita(
        march_fee, march, origin_region_code=SEOUL, required_month="2008-03"
    )
    assert result.population == 10_180_000
    assert result.population_reference_month == "2008-03"
    assert result.fee_per_capita_krw == la.fee_per_capita(march_fee, 10_180_000)


def test_empty_inputs_are_unavailable_never_zero() -> None:
    empty = la.aggregate_fee_per_capita(
        Decimal("0"), [], origin_region_codes=[], required_month="2024-12"
    )
    assert empty.fee_per_capita_krw is None
    assert empty.reason == la.REASON_NO_METROPOLITAN_POPULATION
    no_candidates = la.origin_fee_per_capita(
        Decimal("0"), [], origin_region_code=SEOUL, required_month="2024-12"
    )
    assert no_candidates.fee_per_capita_krw is None
    assert no_candidates.reason == la.REASON_NO_METROPOLITAN_POPULATION
    no_month = la.origin_fee_per_capita(
        Decimal("0"), POP_2024_12, origin_region_code=SEOUL, required_month=None
    )
    assert no_month.reason == la.REASON_NO_MATCHING_POPULATION_PERIOD


def test_zero_fee_with_valid_population_is_a_real_zero() -> None:
    result = la.origin_fee_per_capita(
        Decimal("0"), POP_2024_12, origin_region_code=SEOUL, required_month="2024-12"
    )
    assert result.reason is None
    assert result.fee_per_capita_krw == Decimal("0.00")


def test_v2_version_and_unit() -> None:
    assert la.PER_CAPITA_DERIVATION_VERSION == "landfill-fee-per-capita-v2"
    assert la.PER_CAPITA_INDICATOR == "LANDFILL_INBOUND_FEE_PER_CAPITA"
    assert la.PER_CAPITA_FEE_UNIT == "KRW/인"
    assert "동일 기간" in la.PER_CAPITA_CAVEAT
