"""Successor component A — ``existing_burden``.

Covers ordering, ties, missing/zero population, unavailable burden, partial
throughput, provenance preservation, and deterministic Decimal output.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_backend.analysis.facility_burden import FacilityThroughput
from waste_equity_backend.analysis.per_capita import (
    EXPECTED_QUANTITY_UNIT,
    per_capita_kg_per_year,
)
from waste_equity_backend.analysis.suitability.successor import contract, existing_burden
from waste_equity_backend.analysis.suitability.successor.existing_burden import (
    ExistingBurdenInput,
    UnmappedFacilityEvidence,
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


# --------------------------------------------------------------------------- #
# B17 — unmapped facility evidence must never read as zero burden
#
# A facility whose geography cannot be resolved to a SIGUNGU vanishes from every
# region's located total. Where the region then has nothing of its own, the
# aggregate is zero — the *best possible* value on a LOWER_RAW_IS_BETTER scale —
# produced entirely by the mapping gap. Reproduced from the real dataset, where
# 99 REQUIRES_GEOCODE rows carrying 1,907,717.3 t/yr are attributed by the source
# to seven CITY-grain Gyeonggi reporting units whose 20 child districts hold no
# facility rows at all.
# --------------------------------------------------------------------------- #


def _unmapped(count: int = 46, tons: str | None = "350662.7") -> UnmappedFacilityEvidence:
    return UnmappedFacilityEvidence(
        facility_count=count,
        reason="REQUIRES_GEOCODE",
        coverage_basis="source reports this facility at CITY grain; region is a child district",
        throughput_tons_per_year=(Decimal(tons) if tons is not None else None),
        source_reporting_unit="경기 용인시",
    )


def test_no_facility_rows_without_unmapped_evidence_is_an_observed_zero() -> None:
    # The control case: a genuinely facility-free district. Zero is a fact here and
    # must stay available, or the fix would erase real observations.
    observation = existing_burden.observe(_region("R", 100_000))

    assert observation.available
    assert observation.raw_value == Decimal("0")
    assert observation.inputs["no_located_facility_rows"] is True
    assert observation.inputs["unmapped_facility_evidence"] is None


def test_unmapped_evidence_with_no_located_rows_is_unavailable_not_zero() -> None:
    observation = existing_burden.observe(
        ExistingBurdenInput(
            region_code="KR-SGIS-31191",
            population=270_000,
            facilities=(),
            unmapped_facility_evidence=_unmapped(),
        )
    )

    assert not observation.available
    assert observation.raw_value is None
    assert contract.REASON_UNMAPPED_FACILITY_EVIDENCE in observation.unavailable_reasons


def test_the_unmapped_throughput_is_recorded_as_evidence_never_as_burden() -> None:
    observation = existing_burden.observe(
        ExistingBurdenInput(
            region_code="KR-SGIS-31191",
            population=270_000,
            facilities=(),
            unmapped_facility_evidence=_unmapped(),
        )
    )

    evidence = observation.inputs["unmapped_facility_evidence"]
    assert evidence["facility_count"] == 46
    assert evidence["throughput_tons_per_year"] == "350662.7"
    assert evidence["reason"] == "REQUIRES_GEOCODE"
    assert evidence["source_reporting_unit"] == "경기 용인시"
    # Evidence of an undercount is not a numerator: the located total stays zero
    # and the observation stays unavailable rather than absorbing the tonnage.
    assert observation.inputs["located_throughput_tons_per_year"] == "0"
    assert observation.raw_value is None


def test_unmapped_evidence_alongside_located_rows_is_a_flagged_undercount() -> None:
    observation = existing_burden.observe(
        ExistingBurdenInput(
            region_code="R",
            population=100_000,
            facilities=(_facility("1000"),),
            unmapped_facility_evidence=_unmapped(count=3, tons="500"),
        )
    )

    # Measurable, so it stays available — but the reader is told it is short.
    assert observation.available
    assert observation.raw_value == per_capita_kg_per_year(
        Decimal("1000"), EXPECTED_QUANTITY_UNIT, 100_000
    )
    assert observation.is_partial
    assert contract.PARTIAL_UNMAPPED_FACILITY_EVIDENCE in observation.partial_reasons


def test_unmapped_evidence_and_missing_throughput_are_both_reported() -> None:
    observation = existing_burden.observe(
        ExistingBurdenInput(
            region_code="R",
            population=100_000,
            facilities=(_facility("1000"), FacilityThroughput(None, None)),
            unmapped_facility_evidence=_unmapped(count=3, tons=None),
        )
    )

    assert observation.available
    assert observation.partial_reasons == (
        contract.PARTIAL_MISSING_FACILITY_THROUGHPUT,
        contract.PARTIAL_UNMAPPED_FACILITY_EVIDENCE,
    )


def test_an_unavailable_region_is_absent_from_the_scores_never_scored_best() -> None:
    # The whole point: the unmapped region must not appear in the ranking at all.
    # Before the fix it would have scored 100 — the best possible avoidance score.
    scores = existing_burden.normalized_scores(
        [
            _region("HIGH", 100_000, _facility("5000")),
            _region("LOW", 100_000, _facility("100")),
            ExistingBurdenInput(
                region_code="UNMAPPED",
                population=100_000,
                facilities=(),
                unmapped_facility_evidence=_unmapped(),
            ),
        ]
    )

    assert "UNMAPPED" not in scores
    assert set(scores) == {"HIGH", "LOW"}


def test_unmapped_evidence_requires_an_explicit_coverage_basis_and_reason() -> None:
    # The module never infers which region unmapped rows cover; the caller must say
    # how it decided, so the resulting unavailability stays auditable.
    for kwargs in (
        {"facility_count": 0},
        {"reason": "  "},
        {"coverage_basis": ""},
    ):
        base = {
            "facility_count": 1,
            "reason": "REQUIRES_GEOCODE",
            "coverage_basis": "CITY-grain source row",
        }
        base.update(kwargs)
        with pytest.raises(ValueError):
            UnmappedFacilityEvidence(**base)  # type: ignore[arg-type]
