"""Successor run write path — scoring, ranking population, and determinism.

Pure tests: no database. The database-facing half is covered by the PostGIS tier
and by the real-data validation in
``docs/research/SUITABILITY_V3_PHASE5_RUNTIME_VALIDATION.md``.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_backend.analysis.suitability.successor import (
    contract,
    policy,
    runtime,
    stability,
)
from waste_equity_backend.analysis.suitability.successor.inputs import CandidateRow

ELIGIBLE = "ELIGIBLE"
REVIEW = "REVIEW_REQUIRED"
EXCLUDED = "EXCLUDED"


def _candidate(key: str, status: str = ELIGIBLE, region: str | None = "R1") -> CandidateRow:
    return CandidateRow(candidate_key=key, sigungu_region_code=region, status=status)


def _scores(**per_candidate: dict[str, str]) -> dict[str, dict[str, Decimal]]:
    """Build ``{component: {candidate: score}}`` from ``candidate -> {component: value}``."""

    out: dict[str, dict[str, Decimal]] = {c: {} for c in policy.COMPONENTS}
    for key, components in per_candidate.items():
        for component, value in components.items():
            out[component][key] = Decimal(value)
    return out


def _full(value: str) -> dict[str, str]:
    return {component: value for component in policy.COMPONENTS}


# --------------------------------------------------------------------------- #
# Ranking population
# --------------------------------------------------------------------------- #


def test_only_eligible_and_complete_candidates_are_ranked() -> None:
    candidates = [
        _candidate("elig_complete", ELIGIBLE),
        _candidate("review_complete", REVIEW),
        _candidate("excluded_complete", EXCLUDED),
    ]
    scores = _scores(
        elig_complete=_full("60"), review_complete=_full("90"), excluded_complete=_full("95")
    )

    rows, _ = runtime.score_candidates(candidates, scores)
    by_key = {row.candidate_key: row for row in rows}

    # The screened-out candidates score higher on every component and are still
    # never ranked: the successor re-scores but never re-screens.
    assert by_key["elig_complete"].rank == 1
    assert by_key["review_complete"].rank is None
    assert by_key["excluded_complete"].rank is None
    assert by_key["review_complete"].total_score is None
    assert by_key["excluded_complete"].total_score is None


def test_an_eligible_candidate_missing_a_component_is_not_ranked_and_not_zero_filled() -> None:
    candidates = [_candidate("complete"), _candidate("partial")]
    partial = _full("80")
    del partial[policy.COMPONENTS[1]]
    scores = _scores(complete=_full("40"), partial=partial)

    rows, _ = runtime.score_candidates(candidates, scores)
    by_key = {row.candidate_key: row for row in rows}

    assert by_key["complete"].rank == 1
    assert by_key["partial"].rank is None
    assert by_key["partial"].total_score is None
    assert by_key["partial"].missing_components == (policy.COMPONENTS[1],)
    # The components it DOES have are preserved — missing one is not "no data".
    assert len(by_key["partial"].component_scores) == len(policy.COMPONENTS) - 1
    # And the missing one is absent, never 0 (which is the best possible score for
    # a LOWER_RAW_IS_BETTER component).
    assert policy.COMPONENTS[1] not in by_key["partial"].component_scores


def test_the_not_ranked_reason_distinguishes_screening_from_missing_data() -> None:
    candidates = [
        _candidate("screened_out", EXCLUDED),
        _candidate("incomplete", ELIGIBLE),
        _candidate("both", REVIEW),
    ]
    incomplete = _full("50")
    del incomplete[policy.COMPONENTS[0]]
    both = _full("50")
    del both[policy.COMPONENTS[0]]
    scores = _scores(screened_out=_full("50"), incomplete=incomplete, both=both)

    rows, _ = runtime.score_candidates(candidates, scores)
    reasons = {row.candidate_key: runtime._not_ranked_reason(row) for row in rows}

    assert reasons["screened_out"] == "SCREENING_NOT_ELIGIBLE"
    assert reasons["incomplete"] == "INCOMPLETE_COMPONENTS"
    assert reasons["both"] == "SCREENING_NOT_ELIGIBLE_AND_INCOMPLETE_COMPONENTS"


# --------------------------------------------------------------------------- #
# Composite
# --------------------------------------------------------------------------- #


def test_the_composite_is_the_equal_weighted_sum_of_the_component_scores() -> None:
    candidates = [_candidate("a")]
    scores = _scores(a={"existing_burden": "40", "air_impact_proxy": "60",
                        "resident_impact": "80", "land_conversion": "20"})

    rows, _ = runtime.score_candidates(candidates, scores)

    # 0.25 * (40 + 60 + 80 + 20) = 50
    assert rows[0].total_score == Decimal("50.0000")


def test_the_approved_weights_are_read_from_policy_not_hardcoded() -> None:
    weights = runtime.approved_weights()
    assert set(weights) == set(policy.COMPONENTS)
    assert sum(weights.values()) == Decimal("1")
    registered = policy.SUCCESSOR_WEIGHT_PROFILES[policy.SUCCESSOR_WEIGHT_PROFILE_BASELINE]
    assert weights == {c: Decimal(v) for c, v in registered.items()}


def test_ranking_is_deterministic_under_ties_and_input_order() -> None:
    # Three candidates with identical scores: the ranking must be stable and must
    # not depend on the order they arrive in.
    forward = [_candidate("c"), _candidate("a"), _candidate("b")]
    reverse = list(reversed(forward))
    scores = _scores(a=_full("50"), b=_full("50"), c=_full("50"))

    rows_forward, _ = runtime.score_candidates(forward, scores)
    rows_reverse, _ = runtime.score_candidates(reverse, scores)

    ranks_forward = {row.candidate_key: row.rank for row in rows_forward}
    ranks_reverse = {row.candidate_key: row.rank for row in rows_reverse}
    assert ranks_forward == ranks_reverse
    # Ties resolve by candidate key, so the ordering is a documented fact.
    assert ranks_forward == {"a": 1, "b": 2, "c": 3}


def test_a_candidate_with_no_region_loses_the_region_grain_components() -> None:
    # Region-level components attach via the SIGUNGU code. A candidate without one
    # is not assigned to a neighbour; it simply lacks those components.
    candidates = [_candidate("orphan", ELIGIBLE, region=None)]
    burden = contract.ComponentSeries(
        component=contract.COMPONENT_EXISTING_BURDEN,
        method_version="v",
        direction=contract.LOWER_RAW_IS_BETTER,
        raw_unit=None,
        observations=(
            contract.ComponentObservation(
                component=contract.COMPONENT_EXISTING_BURDEN,
                unit_key="R1",
                raw_value=Decimal("1"),
                raw_unit=None,
            ),
        ),
    )
    empty = contract.ComponentSeries(
        component=contract.COMPONENT_AIR_IMPACT_PROXY,
        method_version="v",
        direction=contract.LOWER_RAW_IS_BETTER,
        raw_unit=None,
        observations=(),
    )
    resident = contract.ComponentSeries(
        component=contract.COMPONENT_RESIDENT_IMPACT,
        method_version="v",
        direction=contract.LOWER_RAW_IS_BETTER,
        raw_unit=None,
        observations=(
            contract.ComponentObservation(
                component=contract.COMPONENT_RESIDENT_IMPACT,
                unit_key="orphan",
                raw_value=Decimal("5"),
                raw_unit=None,
            ),
        ),
    )
    land = contract.ComponentSeries(
        component=contract.COMPONENT_LAND_CONVERSION,
        method_version="v",
        direction=contract.LOWER_RAW_IS_BETTER,
        raw_unit=None,
        observations=(),
    )

    projected = runtime.project_component_scores(candidates, burden, empty, resident, land)

    assert "orphan" not in projected[contract.COMPONENT_EXISTING_BURDEN]
    assert "orphan" not in projected[contract.COMPONENT_AIR_IMPACT_PROXY]
    assert "orphan" in projected[contract.COMPONENT_RESIDENT_IMPACT]


# --------------------------------------------------------------------------- #
# Stability
# --------------------------------------------------------------------------- #


def test_only_ranked_candidates_are_classified() -> None:
    candidates = [_candidate("ranked"), _candidate("screened", EXCLUDED)]
    scores = _scores(ranked=_full("70"), screened=_full("70"))

    rows, _ = runtime.score_candidates(candidates, scores)
    by_key = {row.candidate_key: row for row in rows}

    assert by_key["ranked"].stability_class is not None
    assert by_key["screened"].stability_class is None
    assert by_key["screened"].stable_count is None
    assert by_key["screened"].stability_membership == {}


def test_every_stability_profile_is_a_valid_weight_vector() -> None:
    profiles = stability.perturbed_profiles()
    # One perturbation per component, so no component is privileged.
    assert len(profiles) == len(policy.COMPONENTS)
    for name, weights in profiles.items():
        assert set(weights) == set(policy.COMPONENTS), name
        assert sum(weights.values()) == Decimal("1"), name
        assert all(w > 0 for w in weights.values()), name


def test_the_stability_step_divides_exactly_across_the_other_components() -> None:
    # 0.05 would leave every profile summing to 0.999...; the step must terminate.
    others = len(policy.COMPONENTS) - 1
    share = stability.STABILITY_WEIGHT_STEP / Decimal(others)
    assert share * Decimal(others) == stability.STABILITY_WEIGHT_STEP


def test_stability_classes_span_the_full_survival_range() -> None:
    n = stability.STABILITY_PERTURBATION_COUNT
    assert stability.classify(n) == stability.STABILITY_CLASS_STABLE
    assert stability.classify(n - 1) == stability.STABILITY_CLASS_CONDITIONAL
    assert stability.classify(n - 2) == stability.STABILITY_CLASS_CONDITIONAL
    assert stability.classify(0) == stability.STABILITY_CLASS_SENSITIVE


def test_the_stored_stability_definition_disclaims_historical_comparability() -> None:
    definition = stability.evaluate(["a"], _scores(a=_full("50")))["definition"]
    assert definition["inherited_from_historical"] is False
    assert definition["component_model_version"] == policy.COMPONENT_MODEL_VERSION_SUCCESSOR
    assert definition["method_version"] == stability.STABILITY_METHOD_VERSION
    assert "never be read as comparable" in definition["inheritance_note"]


def test_an_empty_ranking_population_classifies_nothing_rather_than_dividing_by_zero() -> None:
    result = stability.evaluate([], {c: {} for c in policy.COMPONENTS})
    assert result["top_cutoff_rank"] == 0
    assert result["classes"] == {}
    assert sum(result["tally"].values()) == 0


# --------------------------------------------------------------------------- #
# Refusals
# --------------------------------------------------------------------------- #


def test_the_build_refuses_a_source_run_of_the_wrong_component_model(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # A successor run inherits its screening from a historical run. Deriving one
    # from another successor run would re-score an already re-scored population.
    class _Session:
        def execute(self, *args: object, **kwargs: object) -> object:
            raise AssertionError("should not be reached")

    monkeypatch.setattr(
        runtime,
        "_assert_source_run",
        lambda session, run_id: (_ for _ in ()).throw(
            runtime.SuccessorBuildError("wrong model")
        ),
    )
    with pytest.raises(runtime.SuccessorBuildError):
        runtime.build_successor_run(_Session(), source_run_id=1)  # type: ignore[arg-type]
