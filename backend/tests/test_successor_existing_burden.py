"""Successor component A — ``existing_burden``.

Covers ordering, ties, missing/zero population, unavailable burden, partial
throughput, provenance preservation, and deterministic Decimal output.
"""

from __future__ import annotations

from decimal import Decimal

from waste_equity_backend.analysis.facility_burden import FacilityThroughput
from waste_equity_backend.analysis.per_capita import (
    EXPECTED_QUANTITY_UNIT,
    per_capita_kg_per_year,
)
from waste_equity_backend.analysis.suitability.successor import contract, existing_burden
from waste_equity_backend.analysis.suitability.successor.existing_burden import (
    ExistingBurdenInput,
)


def _facility(tons: str, unit: str = EXPECTED_QUANTITY_UNIT) -> FacilityThroughput:
    return FacilityThroughput(throughput_quantity=Decimal(tons), throughput_unit=unit)


def _region(
    code: str, population: int | None, *facilities: FacilityThroughput
) -> ExistingBurdenInput:
    return ExistingBurdenInput(
        region_code=code,
        population=population,
        facilities=tuple(facilities),
        facility_source_id="rcis_facilities",
        facility_reference_period="2024",
        population_source_id="sgis",
        population_reference_period="2024",
    )


# --------------------------------------------------------------------------- #
# Ordering
# --------------------------------------------------------------------------- #


def test_lower_burden_ranks_higher() -> None:
    scores = existing_burden.normalized_scores(
        [
            _region("LOW", 100_000, _facility("100")),
            _region("HIGH", 100_000, _facility("900")),
        ]
    )
    assert scores["LOW"] > scores["HIGH"]
    assert scores["LOW"] == Decimal("100.0000")
    assert scores["HIGH"] == Decimal("0.0000")


def test_higher_burden_ranks_lower_across_three_regions() -> None:
    scores = existing_burden.normalized_scores(
        [
            _region("A", 100_000, _facility("100")),
            _region("B", 100_000, _facility("500")),
            _region("C", 100_000, _facility("900")),
        ]
    )
    assert scores["A"] > scores["B"] > scores["C"]


def test_ties_share_a_score() -> None:
    scores = existing_burden.normalized_scores(
        [
            _region("A", 50_000, _facility("250")),
            _region("B", 50_000, _facility("250")),
            _region("C", 50_000, _facility("900")),
        ]
    )
    assert scores["A"] == scores["B"] > scores["C"]


def test_a_region_with_no_located_facility_has_an_observed_zero_burden() -> None:
    observation = existing_burden.observe(_region("EMPTY", 10_000))
    assert observation.available
    assert observation.raw_value == Decimal("0.000000")
    assert observation.inputs["no_located_facility_rows"] is True
    assert observation.inputs["facility_count_located"] == 0
    assert observation.is_partial is False


# --------------------------------------------------------------------------- #
# Unavailable burden
# --------------------------------------------------------------------------- #


def test_missing_population_makes_the_component_unavailable() -> None:
    observation = existing_burden.observe(_region("NOPOP", None, _facility("100")))
    assert not observation.available
    assert observation.raw_value is None
    assert contract.REASON_MISSING_POPULATION in observation.unavailable_reasons


def test_zero_population_makes_the_component_unavailable() -> None:
    observation = existing_burden.observe(_region("ZERO", 0, _facility("100")))
    assert not observation.available
    assert contract.REASON_NON_POSITIVE_POPULATION in observation.unavailable_reasons


def test_negative_population_makes_the_component_unavailable() -> None:
    observation = existing_burden.observe(_region("NEG", -5, _facility("100")))
    assert not observation.available
    assert contract.REASON_NON_POSITIVE_POPULATION in observation.unavailable_reasons


def test_every_throughput_missing_is_unavailable_not_a_zero_burden() -> None:
    observation = existing_burden.observe(
        _region(
            "ALLMISSING",
            10_000,
            FacilityThroughput(throughput_quantity=None, throughput_unit=None),
            FacilityThroughput(throughput_quantity=None, throughput_unit=None),
        )
    )
    assert not observation.available
    assert contract.REASON_ALL_LOCATED_THROUGHPUT_MISSING in observation.unavailable_reasons
    # The counts survive so the gap is auditable rather than invisible.
    assert observation.inputs["facility_count_located"] == 2
    assert observation.inputs["missing_throughput_count"] == 2


def test_unexpected_throughput_unit_counts_as_missing_not_converted() -> None:
    observation = existing_burden.observe(
        _region("BADUNIT", 10_000, _facility("100", unit="kg/년"))
    )
    assert not observation.available
    assert contract.REASON_ALL_LOCATED_THROUGHPUT_MISSING in observation.unavailable_reasons


def test_a_coarser_reporting_grain_is_refused() -> None:
    observation = existing_burden.observe(
        ExistingBurdenInput(
            region_code="CITY",
            population=10_000,
            facilities=(_facility("100"),),
            source_geographic_level="CITY",
        )
    )
    assert not observation.available
    assert contract.REASON_INCOMPATIBLE_GEOGRAPHIC_GRAIN in observation.unavailable_reasons


def test_unavailable_regions_are_excluded_from_the_ranking() -> None:
    series = existing_burden.build_series(
        [
            _region("A", 100_000, _facility("100")),
            _region("B", 100_000, _facility("900")),
            _region("NOPOP", None, _facility("100")),
        ]
    )
    scores = series.normalized_scores()
    assert set(scores) == {"A", "B"}
    assert series.unavailable_reason_counts() == {contract.REASON_MISSING_POPULATION: 1}


# --------------------------------------------------------------------------- #
# Partial state
# --------------------------------------------------------------------------- #


def test_some_missing_throughput_stays_available_but_flagged_partial() -> None:
    observation = existing_burden.observe(
        _region(
            "PARTIAL",
            10_000,
            _facility("100"),
            FacilityThroughput(throughput_quantity=None, throughput_unit=None),
        )
    )
    assert observation.available
    assert observation.is_partial is True
    assert contract.PARTIAL_MISSING_FACILITY_THROUGHPUT in observation.partial_reasons
    assert observation.inputs["missing_throughput_count"] == 1
    assert observation.inputs["facility_count_located"] == 2


# --------------------------------------------------------------------------- #
# Formula reuse, provenance, determinism
# --------------------------------------------------------------------------- #


def test_raw_value_equals_the_production_burden_derivation_exactly() -> None:
    observation = existing_burden.observe(_region("R", 123_457, _facility("456.789")))
    expected = per_capita_kg_per_year(Decimal("456.789"), EXPECTED_QUANTITY_UNIT, 123_457)
    assert observation.raw_value == expected


def test_provenance_and_inputs_are_preserved() -> None:
    observation = existing_burden.observe(_region("R", 10_000, _facility("100"), _facility("50")))
    assert observation.inputs["population"] == 10_000
    assert observation.inputs["located_throughput_tons_per_year"] == "150"
    assert observation.inputs["facility_count_located"] == 2
    assert observation.provenance["accounting_basis"] == "FACILITY_LOCATION_BASED_THROUGHPUT"
    assert observation.provenance["burden_derivation_version"] == "facility-burden-v1"
    assert observation.provenance["facility_reference_period"] == "2024"
    assert observation.provenance["population_reference_period"] == "2024"
    assert observation.provenance["direction"] == contract.LOWER_RAW_IS_BETTER


def test_output_is_deterministic_and_decimal() -> None:
    inputs = [
        _region("A", 100_000, _facility("100")),
        _region("B", 100_000, _facility("900")),
        _region("C", 100_000, _facility("500")),
    ]
    first = existing_burden.build_series(inputs)
    second = existing_burden.build_series(list(reversed(inputs)))
    assert first.sanitized_summary() == second.sanitized_summary()
    for observation in first.observations:
        assert observation.raw_value is None or isinstance(observation.raw_value, Decimal)


def test_component_metadata_is_stable() -> None:
    series = existing_burden.build_series([_region("A", 1_000, _facility("1"))])
    assert series.component == "existing_burden"
    assert series.method_version == "successor-existing-burden-v1"
    assert series.direction == contract.LOWER_RAW_IS_BETTER
    assert series.raw_unit == "kg/인/년"
