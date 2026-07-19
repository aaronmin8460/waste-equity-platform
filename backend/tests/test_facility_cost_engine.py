"""Pure calculation-engine tests for the facility cost model (Phase 4 V1).

No database: exercises the Decimal arithmetic, the standard-cost band boundaries,
the structured errors, lifetime rules, subsidy schemes, per-capita null handling,
completeness metadata, and the transport-cost dimensional guardrail.
"""

from decimal import Decimal

import pytest

from waste_equity_backend.analysis import facility_cost as fc

SEED = list(fc.STANDARD_COST_SEED)
INCIN = fc.FACILITY_TYPE_INCINERATION
SORT = fc.FACILITY_TYPE_SORTING


def unit_cost(facility_type: str, capacity: str) -> Decimal:
    return fc.lookup_unit_cost(SEED, facility_type, Decimal(capacity)).cost_per_capacity_bn


# --------------------------------------------------------------------------- #
# Band boundaries (below / at / above each edge).
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("capacity", "expected"),
    [
        ("29", "6.24"),
        ("30", "6.24"),  # at the 30 edge → first band (inclusive upper)
        ("30.000001", "5.90"),  # just above 30 → second band
        ("50", "5.90"),
        ("50.000001", "5.23"),
        ("100", "5.23"),
        ("100.000001", "4.98"),
        ("200", "4.98"),
        ("200.000001", "4.57"),
        ("1000", "4.57"),
    ],
)
def test_incineration_band_boundaries(capacity: str, expected: str) -> None:
    assert unit_cost(INCIN, capacity) == Decimal(expected)


@pytest.mark.parametrize(
    ("capacity", "expected"),
    [
        ("9", "5.97"),
        ("10", "5.97"),
        ("10.000001", "4.63"),
        ("20", "4.63"),
        ("20.000001", "3.60"),
        ("30", "3.60"),
        ("30.000001", "3.45"),
        ("40", "3.45"),
        ("40.000001", "3.31"),
        ("50", "3.31"),
        ("50.000001", "3.23"),
        ("60", "3.23"),
        ("60.000001", "2.98"),
        ("70", "2.98"),
        ("70.000001", "2.94"),
        ("80", "2.94"),
        ("80.000001", "2.92"),
        ("90", "2.92"),
        ("90.000001", "2.90"),
        ("500", "2.90"),
    ],
)
def test_sorting_band_boundaries(capacity: str, expected: str) -> None:
    assert unit_cost(SORT, capacity) == Decimal(expected)


def test_every_positive_capacity_matches_exactly_one_band() -> None:
    for facility_type in (INCIN, SORT):
        bands = fc.seed_bands_for(facility_type)
        for cap in ["0.1", "10", "15", "30", "55", "95", "250", "3000"]:
            matching = [b for b in bands if b.matches(Decimal(cap))]
            assert len(matching) == 1, (facility_type, cap, len(matching))


# --------------------------------------------------------------------------- #
# Spec validation examples.
# --------------------------------------------------------------------------- #


def test_validation_example_sorting_35() -> None:
    assert fc.standard_construction_cost_bn(
        unit_cost(SORT, "35"), Decimal("35"), Decimal("1.00")
    ) == Decimal("120.75")


def test_validation_example_sorting_50() -> None:
    assert fc.standard_construction_cost_bn(
        unit_cost(SORT, "50"), Decimal("50"), Decimal("1.00")
    ) == Decimal("165.50")


def test_validation_example_incineration_1000_underground() -> None:
    assert fc.standard_construction_cost_bn(
        unit_cost(INCIN, "1000"), Decimal("1000"), Decimal("1.40")
    ) == Decimal("6398.00")


# --------------------------------------------------------------------------- #
# Structured errors.
# --------------------------------------------------------------------------- #


def test_unknown_facility_type() -> None:
    with pytest.raises(fc.UnsupportedFacilityTypeError) as exc:
        fc.lookup_unit_cost(SEED, "landfill_only", Decimal("100"))
    assert exc.value.code == "UNSUPPORTED_FACILITY_TYPE"


def test_no_matching_range_when_bands_empty() -> None:
    with pytest.raises(fc.NoMatchingCostBandError) as exc:
        fc.lookup_unit_cost([], INCIN, Decimal("100"))
    assert exc.value.code == "NO_MATCHING_COST_BAND"


def test_overlapping_range_protection() -> None:
    overlap = [
        fc.StandardCostBand(INCIN, None, True, Decimal("100"), True, Decimal("6.24")),
        fc.StandardCostBand(INCIN, None, True, Decimal("100"), True, Decimal("5.90")),
    ]
    with pytest.raises(fc.OverlappingCostBandError) as exc:
        fc.lookup_unit_cost(overlap, INCIN, Decimal("50"))
    assert exc.value.code == "OVERLAPPING_COST_BAND"
    assert exc.value.count == 2


@pytest.mark.parametrize("share", ["-0.1", "1.1"])
def test_invalid_processing_share_fraction(share: str) -> None:
    with pytest.raises(fc.InvalidProcessingShareError):
        fc.validate_processing_share(Decimal(share))


@pytest.mark.parametrize("percent", ["-1", "101"])
def test_invalid_processing_share_percent(percent: str) -> None:
    with pytest.raises(fc.InvalidProcessingShareError):
        fc.processing_share_from_percent(Decimal(percent))


@pytest.mark.parametrize("days", [0, -5, 400])
def test_invalid_operating_days(days: int) -> None:
    with pytest.raises(fc.InvalidOperatingDaysError):
        fc.facility_capacity_ton_per_day(Decimal("30000"), days)


@pytest.mark.parametrize("multiplier", ["0.99", "1.41", "2.0"])
def test_invalid_underground_multiplier(multiplier: str) -> None:
    with pytest.raises(fc.InvalidUndergroundMultiplierError):
        fc.validate_underground_multiplier(Decimal(multiplier))


def test_unknown_subsidy_scheme() -> None:
    with pytest.raises(fc.UnknownSubsidySchemeError):
        fc.subsidy_rate("national_100_percent")


# --------------------------------------------------------------------------- #
# Lifetime, subsidy, per-capita.
# --------------------------------------------------------------------------- #


def test_incineration_lifetime_at_and_above_50() -> None:
    assert fc.facility_lifetime_years(INCIN, Decimal("50")) == 15
    assert fc.facility_lifetime_years(INCIN, Decimal("50.000001")) == 20
    assert fc.facility_lifetime_years(INCIN, Decimal("200")) == 20


def test_sorting_lifetime_is_15() -> None:
    assert fc.facility_lifetime_years(SORT, Decimal("10")) == 15
    assert fc.facility_lifetime_years(SORT, Decimal("500")) == 15


def test_annualization_is_straight_line() -> None:
    # 300 억원 over 20 years → 15 억원/year exactly.
    assert fc.annualized_construction_cost_bn(Decimal("300"), 20) == Decimal("15")


@pytest.mark.parametrize(
    ("scheme", "rate"),
    [
        ("seoul_special_city", "0.30"),
        ("metropolitan_city", "0.40"),
        ("city_or_county", "0.30"),
        ("joint_regional_facility", "0.50"),
    ],
)
def test_all_subsidy_schemes(scheme: str, rate: str) -> None:
    assert fc.subsidy_rate(scheme) == Decimal(rate)
    # subsidy + local share reconcile to the standard cost.
    standard = Decimal("1000")
    subsidy = fc.estimated_national_subsidy_bn(standard, fc.subsidy_rate(scheme))
    local = fc.simplified_local_government_share_bn(standard, subsidy)
    assert subsidy + local == standard


def test_per_capita_local_share_exact() -> None:
    # 100 억원 local share ÷ 1,000,000 people = 100e8 / 1e6 = 10,000 원/인.
    assert fc.per_capita_local_share_won(Decimal("100"), 1_000_000) == Decimal("10000.00")


@pytest.mark.parametrize("population", [0, -100])
def test_per_capita_missing_population_raises(population: int) -> None:
    with pytest.raises(fc.MissingServicePopulationError) as exc:
        fc.per_capita_local_share_won(Decimal("100"), population)
    assert exc.value.reason == "NO_OFFICIAL_SERVICE_POPULATION"


# --------------------------------------------------------------------------- #
# Completeness + transport guardrail.
# --------------------------------------------------------------------------- #


def test_completeness_marks_partial_and_lists_missing_components() -> None:
    meta = fc.completeness()
    assert meta["is_partial"] is True
    assert set(meta["included_components"]) == {  # type: ignore[arg-type]
        "STANDARD_CONSTRUCTION_COST",
        "ANNUALIZED_CONSTRUCTION_COST",
        "SIMPLIFIED_SUBSIDY",
        "SIMPLIFIED_LOCAL_GOVERNMENT_SHARE",
    }
    missing = {m["component"] for m in meta["missing_components"]}  # type: ignore[attr-defined]
    assert missing == {
        "OPERATING_COST",
        "ACTUAL_TRANSPORT_COST",
        "LAND_AND_COMPENSATION",
        "REMAINING_LANDFILL_COST",
    }


def test_transport_dimensional_conversion() -> None:
    # 50 원/t·km × 100 만t·km × 0.0001 = 0.5 억원 (the documented unit algebra).
    assert fc.transport_cost_bn_from_ton_km(Decimal("50"), Decimal("100")) == Decimal("0.5")


# --------------------------------------------------------------------------- #
# Orchestrator (end-to-end, still no DB).
# --------------------------------------------------------------------------- #


def test_calculate_facility_cost_full_scenario() -> None:
    # 9,000,000 톤/년 × 50% ÷ 300일 = 15,000 톤/일 → incineration >200 band 4.57.
    calc = fc.calculate_facility_cost(
        bands=SEED,
        facility_type=INCIN,
        official_annual_quantity_ton=Decimal("9000000"),
        processing_share=Decimal("0.5"),
        operating_days_per_year=300,
        underground_multiplier=Decimal("1.00"),
        subsidy_scheme="metropolitan_city",
        official_service_population=1_000_000,
    )
    assert calc.annual_service_quantity_ton == Decimal("4500000")
    assert calc.facility_capacity_ton_per_day == Decimal("15000")
    assert calc.standard_unit_cost_bn_per_tpd == Decimal("4.57")
    assert calc.standard_construction_cost_bn == Decimal("68550")  # 4.57 × 15000
    assert calc.facility_lifetime_years == 20
    assert calc.estimated_national_subsidy_bn == Decimal("27420")  # 68550 × 0.40
    assert calc.simplified_local_government_share_bn == Decimal("41130")  # 68550 − 27420
    # 41130 억원 = 41130e8 원 ÷ 1e6 people = 4,113,000 원/인.
    assert calc.per_capita_local_share_won == Decimal("4113000.00")
    assert calc.per_capita_unavailable_reason is None


def test_calculate_returns_null_per_capita_without_population() -> None:
    calc = fc.calculate_facility_cost(
        bands=SEED,
        facility_type=SORT,
        official_annual_quantity_ton=Decimal("3000000"),
        processing_share=Decimal("1"),
        operating_days_per_year=300,
        underground_multiplier=Decimal("1.00"),
        subsidy_scheme="city_or_county",
        official_service_population=None,
    )
    assert calc.per_capita_local_share_won is None
    assert calc.per_capita_unavailable_reason == "NO_OFFICIAL_SERVICE_POPULATION"
    # The cost part is still computed.
    assert calc.standard_construction_cost_bn > 0
