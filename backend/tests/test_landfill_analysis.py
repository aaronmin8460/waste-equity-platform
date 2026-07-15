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
# Inbound fee per resident (landfill-fee-per-capita-v1)
# --------------------------------------------------------------------------- #

SEOUL = "KR-SGIS-11"
INCHEON = "KR-SGIS-28"
GYEONGGI = "KR-SGIS-41"
ALL_ORIGINS = (SEOUL, INCHEON, GYEONGGI)


def _pop(
    origin: str,
    year: int,
    population: int,
    *,
    definition: str = la.EXPECTED_POPULATION_DEFINITION,
    level: str = "SIDO",
    source_id: str = "sgis",
) -> la.MetropolitanPopulation:
    canonical = {SEOUL: "KR-SGIS-11", INCHEON: "KR-SGIS-23", GYEONGGI: "KR-SGIS-31"}[origin]
    name = {SEOUL: "서울특별시", INCHEON: "인천광역시", GYEONGGI: "경기도"}[origin]
    return la.MetropolitanPopulation(
        origin_region_code=origin,
        canonical_region_code=canonical,
        region_name=name,
        region_level=level,
        reference_year=year,
        reference_period=str(year),
        population=population,
        population_definition=definition,
        source_id=source_id,
        unit="persons",
    )


# Real 2024 denominators (SGIS total population) and the live 2024 fee totals, so
# the expected values below are hand-checkable against the official inputs.
POP_2024 = [
    _pop(SEOUL, 2024, 9_335_444),
    _pop(INCHEON, 2024, 3_058_033),
    _pop(GYEONGGI, 2024, 13_914_479),
]
FEE_2024 = {
    SEOUL: Decimal("41647362920.00"),
    INCHEON: Decimal("15228400200.00"),
    GYEONGGI: Decimal("51300279950.00"),
}


def test_fee_per_capita_exact_decimal_and_rounding() -> None:
    # 41,647,362,920 / 9,335,444 = 4,461.2085... -> 4461.21 (ROUND_HALF_EVEN, 2dp).
    assert la.fee_per_capita(FEE_2024[SEOUL], 9_335_444) == Decimal("4461.21")
    # Exact ties round half to even, never through binary float.
    assert la.fee_per_capita(Decimal("5"), 2) == Decimal("2.50")
    assert la.fee_per_capita(Decimal("0.125"), 1) == Decimal("0.12")
    assert la.fee_per_capita(Decimal("0.135"), 1) == Decimal("0.14")


def test_fee_per_capita_none_at_zero_or_negative_population() -> None:
    assert la.fee_per_capita(Decimal("100"), 0) is None
    assert la.fee_per_capita(Decimal("100"), -1) is None


def test_2024_fee_with_valid_2024_population_for_each_origin() -> None:
    expected = {SEOUL: "4461.21", INCHEON: "4979.80", GYEONGGI: "3686.83"}
    for origin, want in expected.items():
        result = la.origin_fee_per_capita(
            FEE_2024[origin], POP_2024, origin_region_code=origin, fee_reference_year=2024
        )
        assert result.reason is None
        assert result.fee_per_capita_krw == Decimal(want)
        assert result.population_reference_year == 2024
        assert result.population_definition == la.EXPECTED_POPULATION_DEFINITION
        assert result.population_source_id == "sgis"
        assert result.population_region_level == "SIDO"


def test_2025_fee_never_falls_back_to_2024_population() -> None:
    # The only population on hand is 2024; a 2025 fee must NOT use it.
    result = la.origin_fee_per_capita(
        Decimal("1000000"), POP_2024, origin_region_code=SEOUL, fee_reference_year=2025
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_NO_MATCHING_POPULATION_YEAR
    assert result.population is None
    assert result.population_reference_year is None


def test_2026_fee_never_falls_back_to_2024_population() -> None:
    result = la.origin_fee_per_capita(
        Decimal("1000000"), POP_2024, origin_region_code=SEOUL, fee_reference_year=2026
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_NO_MATCHING_POPULATION_YEAR


def test_no_population_row_for_origin_at_all() -> None:
    result = la.origin_fee_per_capita(
        Decimal("1000000"),
        [_pop(SEOUL, 2024, 9_335_444)],
        origin_region_code=INCHEON,
        fee_reference_year=2024,
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_NO_METROPOLITAN_POPULATION


def test_zero_population_returns_none_not_zero() -> None:
    result = la.origin_fee_per_capita(
        Decimal("1000000"),
        [_pop(SEOUL, 2024, 0)],
        origin_region_code=SEOUL,
        fee_reference_year=2024,
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_ZERO_POPULATION


def test_competing_population_definitions_are_ambiguous() -> None:
    candidates = [
        _pop(SEOUL, 2024, 9_335_444),
        _pop(SEOUL, 2024, 9_400_000, definition="RESIDENT_REGISTERED"),
    ]
    # Only one row carries the accepted definition, so it is unambiguous.
    ok = la.origin_fee_per_capita(
        FEE_2024[SEOUL], candidates, origin_region_code=SEOUL, fee_reference_year=2024
    )
    assert ok.fee_per_capita_krw == Decimal("4461.21")
    # Two *competing* accepted rows cannot be silently resolved.
    conflicting = [_pop(SEOUL, 2024, 9_335_444), _pop(SEOUL, 2024, 9_400_000)]
    result = la.origin_fee_per_capita(
        FEE_2024[SEOUL], conflicting, origin_region_code=SEOUL, fee_reference_year=2024
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_AMBIGUOUS_POPULATION_DEFINITION


def test_identical_duplicate_population_rows_are_not_ambiguous() -> None:
    # Regions are versioned by boundary vintage, so the same denominator can
    # legitimately appear twice; identical values are not a conflict.
    duplicated = [_pop(SEOUL, 2024, 9_335_444), _pop(SEOUL, 2024, 9_335_444)]
    result = la.origin_fee_per_capita(
        FEE_2024[SEOUL], duplicated, origin_region_code=SEOUL, fee_reference_year=2024
    )
    assert result.fee_per_capita_krw == Decimal("4461.21")


def test_unexpected_definition_only_is_rejected() -> None:
    result = la.origin_fee_per_capita(
        FEE_2024[SEOUL],
        [_pop(SEOUL, 2024, 9_335_444, definition="RESIDENT_REGISTERED")],
        origin_region_code=SEOUL,
        fee_reference_year=2024,
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_AMBIGUOUS_POPULATION_DEFINITION


def test_non_sido_population_is_rejected() -> None:
    result = la.origin_fee_per_capita(
        FEE_2024[SEOUL],
        [_pop(SEOUL, 2024, 9_335_444, level="SIGUNGU")],
        origin_region_code=SEOUL,
        fee_reference_year=2024,
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_AMBIGUOUS_POPULATION_DEFINITION


def test_all_origin_aggregate_is_total_fee_over_total_population() -> None:
    total_fee = sum(FEE_2024.values(), Decimal("0"))
    result = la.aggregate_fee_per_capita(
        total_fee, POP_2024, origin_region_codes=ALL_ORIGINS, fee_reference_year=2024
    )
    assert result.reason is None
    # 108,176,043,070 / 26,307,956 = 4,111.90... -> 4111.91
    assert result.population == 26_307_956
    assert result.fee_per_capita_krw == Decimal("4111.91")
    assert result.population_reference_year == 2024
    assert set(result.included_origin_region_codes) == set(ALL_ORIGINS)


def test_all_origin_aggregate_is_not_the_mean_of_per_origin_values() -> None:
    total_fee = sum(FEE_2024.values(), Decimal("0"))
    aggregate = la.aggregate_fee_per_capita(
        total_fee, POP_2024, origin_region_codes=ALL_ORIGINS, fee_reference_year=2024
    )
    per_origin = [
        la.origin_fee_per_capita(
            FEE_2024[o], POP_2024, origin_region_code=o, fee_reference_year=2024
        ).fee_per_capita_krw
        for o in ALL_ORIGINS
    ]
    mean = sum(v for v in per_origin if v is not None) / Decimal(len(per_origin))
    # The population-weighted aggregate (4111.91) must differ from the mean of
    # the three per-capita values (4375.95) — averaging would misweight regions.
    assert aggregate.fee_per_capita_krw != mean.quantize(Decimal("0.01"))
    assert aggregate.fee_per_capita_krw == Decimal("4111.91")


def test_all_origin_aggregate_unavailable_when_one_origin_lacks_population() -> None:
    partial = [_pop(SEOUL, 2024, 9_335_444), _pop(INCHEON, 2024, 3_058_033)]  # no Gyeonggi
    total_fee = sum(FEE_2024.values(), Decimal("0"))
    result = la.aggregate_fee_per_capita(
        total_fee, partial, origin_region_codes=ALL_ORIGINS, fee_reference_year=2024
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_INCOMPLETE_POPULATION_COVERAGE
    assert result.population is None


def test_all_origin_aggregate_propagates_the_shared_reason_when_every_origin_fails() -> None:
    # 2025 fee with only 2024 population: every origin fails identically, so the
    # precise reason is more useful than "incomplete coverage".
    result = la.aggregate_fee_per_capita(
        Decimal("1000"), POP_2024, origin_region_codes=ALL_ORIGINS, fee_reference_year=2025
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_NO_MATCHING_POPULATION_YEAR


def test_all_origin_aggregate_rejects_mixed_population_sources() -> None:
    mixed = [
        _pop(SEOUL, 2024, 9_335_444),
        _pop(INCHEON, 2024, 3_058_033, source_id="other-source"),
        _pop(GYEONGGI, 2024, 13_914_479),
    ]
    result = la.aggregate_fee_per_capita(
        sum(FEE_2024.values(), Decimal("0")),
        mixed,
        origin_region_codes=ALL_ORIGINS,
        fee_reference_year=2024,
    )
    assert result.fee_per_capita_krw is None
    assert result.reason == la.REASON_AMBIGUOUS_POPULATION_DEFINITION


def test_monthly_fee_divided_by_same_year_annual_population() -> None:
    # A single month's fee over the SAME calendar year's annual population.
    march_fee = Decimal("2721000000.00")
    result = la.origin_fee_per_capita(
        march_fee, POP_2024, origin_region_code=SEOUL, fee_reference_year=2024
    )
    assert result.population == 9_335_444
    assert result.population_reference_year == 2024
    assert result.fee_per_capita_krw == la.fee_per_capita(march_fee, 9_335_444)


def test_empty_inputs_are_unavailable_never_zero() -> None:
    empty = la.aggregate_fee_per_capita(
        Decimal("0"), [], origin_region_codes=[], fee_reference_year=2024
    )
    assert empty.fee_per_capita_krw is None
    assert empty.reason == la.REASON_NO_METROPOLITAN_POPULATION
    no_candidates = la.origin_fee_per_capita(
        Decimal("0"), [], origin_region_code=SEOUL, fee_reference_year=2024
    )
    assert no_candidates.fee_per_capita_krw is None
    assert no_candidates.reason == la.REASON_NO_METROPOLITAN_POPULATION


def test_zero_fee_with_valid_population_is_a_real_zero() -> None:
    # A genuine zero fee is a measured value, not an unavailable one.
    result = la.origin_fee_per_capita(
        Decimal("0"), POP_2024, origin_region_code=SEOUL, fee_reference_year=2024
    )
    assert result.reason is None
    assert result.fee_per_capita_krw == Decimal("0.00")
