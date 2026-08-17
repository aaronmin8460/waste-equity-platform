"""Phase-4 gate helpers.

Pure tests over synthetic inputs. Nothing here touches a database, and nothing
here asserts a policy — these cover the *measurement* helpers the Phase-4
decisions cite, so a number in the report cannot come from a broken counter.
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from suitability_v3_phase4 import gate  # noqa: E402

from waste_equity_backend.analysis.suitability.successor import (  # noqa: E402
    contract,
    existing_burden,
    land_conversion,
)

REGISTRY = land_conversion.LandCoverClassRegistry(
    registry_id="synthetic-phase4-registry-v0",
    class_level=1,
    developed_class_codes=frozenset({"DEV"}),
    known_class_codes=frozenset({"DEV", "NAT"}),
    source="synthetic fixture; not an official classification",
)


def _land_cell(key: str, dev: str, nat: str, evaluated: str = "250000") -> Any:  # noqa: ANN401
    return land_conversion.LandConversionInput(
        candidate_key=key,
        coverage_status=land_conversion.COVERAGE_COMPLETE_EXACT,
        cell_area_m2=Decimal("250000"),
        evaluated_area_m2=Decimal(evaluated),
        class_areas=(
            land_conversion.ClassArea(1, "DEV", "developed", Decimal(dev)),
            land_conversion.ClassArea(1, "NAT", "natural", Decimal(nat)),
        ),
    )


# --------------------------------------------------------------------------- #
# BEFORE / AFTER reconstruction
# --------------------------------------------------------------------------- #


def test_land_before_after_counts_a_tolerated_excess_as_recovered() -> None:
    tolerance = Decimal("250000") * land_conversion.AREA_RECONCILIATION_RELATIVE_TOLERANCE
    series = land_conversion.build_series(
        [
            _land_cell("clean", "100000", "150000"),
            _land_cell("tolerated", "100000", str(Decimal("150000") + tolerance / 2)),
            _land_cell("material", "200000", "200000"),
            land_conversion.LandConversionInput(
                candidate_key="uncovered",
                coverage_status=land_conversion.COVERAGE_NO_COVERAGE,
                cell_area_m2=Decimal("250000"),
                evaluated_area_m2=Decimal("0"),
            ),
        ],
        REGISTRY,
    )
    result = gate.land_conversion_before_after(series)

    assert result["observation_count"] == 4
    assert result["before_available"] == 1  # only the clean cell
    assert result["after_available"] == 2  # plus the tolerated one
    assert result["recovered_candidates"] == 1
    # The materially invalid cell and the uncovered cell are still unavailable, and
    # the recovery count must never absorb either.
    assert result["remaining_unavailable"] == 2
    assert contract.REASON_CLASS_AREA_EXCEEDS_DENOMINATOR in result["remaining_unavailable_reasons"]


def test_burden_before_after_separates_withdrawn_from_observed_zero() -> None:
    evidence = existing_burden.UnmappedFacilityEvidence(
        facility_count=5,
        reason="REQUIRES_GEOCODE",
        coverage_basis="CITY-grain source row",
    )
    series = existing_burden.build_series(
        [
            # Genuinely facility-free: an observed zero that must survive.
            existing_burden.ExistingBurdenInput(region_code="FREE", population=1000),
            # Unmapped evidence and nothing of its own: withdrawn.
            existing_burden.ExistingBurdenInput(
                region_code="GAP", population=1000, unmapped_facility_evidence=evidence
            ),
        ]
    )
    result = gate.existing_burden_before_after(series)

    assert result["before_available_regions"] == 2
    assert result["after_available_regions"] == 1
    assert result["withdrawn_regions"] == ["GAP"]
    assert result["remaining_observed_zero_regions"] == ["FREE"]


# --------------------------------------------------------------------------- #
# Eligibility
# --------------------------------------------------------------------------- #


def test_eligibility_costs_strict_and_each_optional_variant_separately() -> None:
    keys = ["a", "b", "c"]
    scores: dict[str, dict[str, Decimal]] = {
        contract.COMPONENT_EXISTING_BURDEN: {"a": Decimal(1), "b": Decimal(2), "c": Decimal(3)},
        contract.COMPONENT_AIR_IMPACT_PROXY: {"a": Decimal(1)},
        contract.COMPONENT_RESIDENT_IMPACT: {"a": Decimal(1), "b": Decimal(2), "c": Decimal(3)},
        contract.COMPONENT_LAND_CONVERSION: {"a": Decimal(1), "b": Decimal(2)},
    }
    result = gate.eligibility_by_policy(keys, scores)

    assert result["strict_all_components_required"]["eligible"] == 1
    optional = result["optional_component_renormalized"]
    # Dropping the air requirement admits b (which has the other three).
    assert optional[contract.COMPONENT_AIR_IMPACT_PROXY]["eligible"] == 2
    assert optional[contract.COMPONENT_AIR_IMPACT_PROXY]["gain_over_strict"] == 1
    # Dropping a requirement nothing is missing on gains nothing.
    assert optional[contract.COMPONENT_EXISTING_BURDEN]["gain_over_strict"] == 0


def test_comparability_reports_the_gap_between_the_two_groups() -> None:
    scores: dict[str, dict[str, Decimal]] = {
        contract.COMPONENT_EXISTING_BURDEN: {"a": Decimal(10), "b": Decimal(90)},
        contract.COMPONENT_AIR_IMPACT_PROXY: {"a": Decimal(10)},
        contract.COMPONENT_RESIDENT_IMPACT: {"a": Decimal(10), "b": Decimal(90)},
        contract.COMPONENT_LAND_CONVERSION: {"a": Decimal(10), "b": Decimal(90)},
    }
    result = gate.partial_scoring_comparability(
        ["a"], ["a", "b"], scores, contract.COMPONENT_AIR_IMPACT_PROXY
    )

    assert result["units_missing_only_the_optional_component"] == 1
    means = result["retained_component_means"][contract.COMPONENT_EXISTING_BURDEN]
    assert means["complete_case_mean"] == "10.0000"
    assert means["missing_optional_mean"] == "90.0000"
    assert means["difference"] == "80.0000"


# --------------------------------------------------------------------------- #
# Weights
# --------------------------------------------------------------------------- #


def test_perturbation_keeps_the_weights_summing_to_one() -> None:
    perturbed = gate.perturb(
        gate.NEUTRAL_REFERENCE_WEIGHTS, contract.COMPONENT_RESIDENT_IMPACT, Decimal("0.15")
    )

    assert sum(perturbed.values()) == Decimal("1")
    assert perturbed[contract.COMPONENT_RESIDENT_IMPACT] == Decimal("0.40")
    assert perturbed[contract.COMPONENT_EXISTING_BURDEN] == Decimal("0.20")


def test_the_phase4_neutral_reference_matches_the_approved_baseline() -> None:
    from waste_equity_backend.analysis.suitability.successor import policy

    assert set(gate.NEUTRAL_REFERENCE_WEIGHTS) == set(contract.SUCCESSOR_COMPONENTS)
    assert sum(gate.NEUTRAL_REFERENCE_WEIGHTS.values()) == Decimal("1")
    # Phase 4 used equal weights strictly as a neutral perturbation reference, and
    # the policy closure later adopted that same vector as the approved baseline.
    # They must stay numerically identical, because every Phase-4 sensitivity figure
    # is calibrated against this reference and is cited as evidence for the approved
    # vector. If the approved baseline ever changes, that citation stops holding and
    # this test is where it fails.
    approved = policy.SUCCESSOR_WEIGHT_PROFILES[policy.SUCCESSOR_WEIGHT_PROFILE_BASELINE]
    assert {c: Decimal(w) for c, w in approved.items()} == dict(gate.NEUTRAL_REFERENCE_WEIGHTS)


def test_composite_is_the_weighted_sum_of_the_component_scores() -> None:
    scores = {c: {"a": Decimal("40")} for c in contract.SUCCESSOR_COMPONENTS}
    composite = gate.composite_scores(["a"], scores, gate.NEUTRAL_REFERENCE_WEIGHTS)

    assert composite["a"] == Decimal("40.00")


def test_comparing_a_ranking_with_itself_is_a_perfect_match() -> None:
    scores = {f"k{i}": Decimal(i) for i in range(60)}
    result = gate.compare_rankings(scores, scores, label="identity")

    assert result["spearman"] == "1.0000000000"
    assert result["top_10_overlap"] == (10, 10)
    assert result["top_50_overlap"] == (50, 50)


def test_region_counts_report_the_concentration_of_the_top_k() -> None:
    scores = {f"k{i}": Decimal(i) for i in range(10)}
    region_of = {f"k{i}": ("A" if i >= 7 else "B") for i in range(10)}
    counts = gate._region_counts(scores, 5, region_of)

    assert counts == {"B": 2, "A": 3}


@pytest.mark.parametrize("denominator", [0, -1])
def test_share_is_undefined_rather_than_zero_for_an_empty_population(denominator: int) -> None:
    assert gate._share(0, denominator) is None
