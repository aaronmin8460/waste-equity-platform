"""The successor-model boundary: identity, activation gate, and reuse guards.

These tests pin the rules that keep the successor model *additive*: it may not be
activated by accident, it may not inherit a historical weight vector, CRITIC
result, stability class, or saved scenario, and it may not quietly zero-fill a
missing observation to keep a candidate eligible.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_backend.analysis.suitability import critic as historical_critic
from waste_equity_backend.analysis.suitability import policy as historical_policy
from waste_equity_backend.analysis.suitability import scenario as historical_scenario
from waste_equity_backend.analysis.suitability.successor import contract, policy
from waste_equity_backend.analysis.suitability.successor.policy import (
    CrossModelReuseError,
    SuccessorActivationBlockedError,
    SuccessorCriticPreflightError,
)

# --------------------------------------------------------------------------- #
# Identity
# --------------------------------------------------------------------------- #


def test_the_registry_validates_its_own_invariants() -> None:
    policy.validate_successor_policy()


def test_every_component_declares_exactly_one_method_version() -> None:
    assert set(policy.COMPONENT_METHOD_VERSIONS) == set(policy.COMPONENTS)
    assert len(set(policy.COMPONENT_METHOD_VERSIONS.values())) == len(policy.COMPONENTS)


def test_the_two_component_models_have_distinct_identifiers_and_orders() -> None:
    assert policy.COMPONENT_MODEL_VERSION_HISTORICAL != policy.COMPONENT_MODEL_VERSION_SUCCESSOR
    assert policy.COMPONENT_ORDER_HISTORICAL == ("zoning", "road", "equity", "demand")
    assert policy.COMPONENT_ORDER_SUCCESSOR == (
        "existing_burden",
        "air_impact_proxy",
        "resident_impact",
        "land_conversion",
    )


def test_the_successor_model_reuses_the_existing_candidate_grid_identity() -> None:
    # Cell geometry did not change because the scored quantities did, and keeping
    # the grid identity is what lets a reader compare the same place across models.
    assert policy.CANDIDATE_GRID_VERSION_REFERENCE == historical_policy.CANDIDATE_GRID_VERSION


# --------------------------------------------------------------------------- #
# Activation gate
# --------------------------------------------------------------------------- #


def test_an_approved_policy_is_still_not_an_activated_model() -> None:
    # The distinction the whole gate rests on, and the one the policy closure did
    # NOT erase: minting a policy identity says an approved analytical policy
    # exists. Activation additionally requires a runtime that can write a run.
    # Engineering blockers remain, so the model stays inactive.
    assert policy.SUCCESSOR_POLICY_VERSION == "suitability-successor-policy-v1"
    assert policy.SUCCESSOR_DERIVATION_VERSION == "suitability-successor-derivation-v1"
    assert policy.ACTIVATION_BLOCKERS
    assert policy.is_activated() is False


def test_policy_identity_is_minted_as_a_pair() -> None:
    # A run row must never carry one half of the identity.
    assert (policy.SUCCESSOR_POLICY_VERSION is None) == (
        policy.SUCCESSOR_DERIVATION_VERSION is None
    )


def test_activation_raises_and_names_every_open_blocker() -> None:
    with pytest.raises(SuccessorActivationBlockedError) as excinfo:
        policy.assert_activated()
    assert excinfo.value.category == "SUCCESSOR_MODEL_NOT_ACTIVATED"
    assert len(excinfo.value.blockers) == len(policy.ACTIVATION_BLOCKERS)
    message = str(excinfo.value)
    for blocker in policy.ACTIVATION_BLOCKERS:
        assert blocker.blocker_id in message


def test_only_engineering_blockers_remain_open() -> None:
    ids = {b.blocker_id for b in policy.activation_blockers()}
    assert ids == {
        "SUCCESSOR_RUN_WRITE_PATH_NOT_IMPLEMENTED",
        "SUCCESSOR_STABILITY_THRESHOLDS_UNVALIDATED",
        "SUCCESSOR_MODEL_AWARE_DEFAULT_RUN_NOT_IMPLEMENTED",
    }
    # A closed question must not keep blocking, and an open one must not vanish.
    assert "MISSING_COMPONENT_ELIGIBILITY_POLICY_UNDECIDED" not in ids
    assert "SUCCESSOR_ELIGIBLE_POPULATION_NOT_MEASURED" not in ids
    for blocker in policy.activation_blockers():
        assert blocker.summary and blocker.blocks and blocker.resolution_owner


def test_every_closed_blocker_records_the_basis_it_closed_on() -> None:
    # A blocker is never silently deleted: closing one is itself part of the
    # policy record, so the reason survives in the repository.
    closed = {b.blocker_id: b for b in policy.CLOSED_BLOCKERS}
    assert {
        "SUCCESSOR_WEIGHT_VECTOR_UNAPPROVED",
        "RESIDENT_IMPACT_DISTANCE_FLOOR_UNAPPROVED",
        "LAND_COVER_DEVELOPED_CLASS_REGISTRY_UNAVAILABLE",
        "LAND_CONVERSION_DIRECTION_UNAPPROVED",
        "SUCCESSOR_NORMALIZATION_STRATEGY_UNAPPROVED",
        "SUCCESSOR_CRITIC_UNSUITABLE_FOR_WEIGHTING",
    } <= set(closed)
    for blocker in policy.CLOSED_BLOCKERS:
        assert blocker.basis and blocker.closed_by
    open_ids = {b.blocker_id for b in policy.ACTIVATION_BLOCKERS}
    assert not open_ids & set(closed)


def test_the_approval_basis_claims_no_more_than_it_should() -> None:
    # The approval is a project-owner judgement under delegation. It must not be
    # dressed up as expert review or as an empirically optimal result.
    approval = policy.POLICY_CLOSURE_APPROVAL
    assert "project-owner" in approval.lower()
    assert "NOT external expert review" in approval
    assert "NOT a claim of empirical optimality" in approval


def test_accepted_limitations_are_published_not_closed() -> None:
    # These two are not solved and not blockers. They are limits on what the model
    # claims, and each must carry its measured cost.
    ids = {limitation.limitation_id for limitation in policy.ACCEPTED_LIMITATIONS}
    assert ids == {
        "AIR_IMPACT_PROXY_GRAIN_AND_COVERAGE_UNRESOLVED",
        "RESIDENT_IMPACT_POPULATION_RESOLUTION_UNRESOLVED",
    }
    for limitation in policy.ACCEPTED_LIMITATIONS:
        assert limitation.measured_cost and limitation.why_not_blocking
    blocker_ids = {b.blocker_id for b in policy.ACTIVATION_BLOCKERS}
    closed_ids = {b.blocker_id for b in policy.CLOSED_BLOCKERS}
    assert not ids & (blocker_ids | closed_ids)


def test_the_approved_weight_profile_is_equal_total_and_documented() -> None:
    profiles = policy.SUCCESSOR_WEIGHT_PROFILES
    assert set(profiles) == {"baseline"}
    weights = profiles["baseline"]
    assert set(weights) == set(policy.COMPONENTS)
    assert all(value == "0.25" for value in weights.values())
    assert sum(Decimal(v) for v in weights.values()) == Decimal("1")
    # Weighting Policy item 1: a written rationale per weight, before it is served.
    assert set(policy.SUCCESSOR_WEIGHT_RATIONALE) == set(policy.COMPONENTS)
    for component, rationale in policy.SUCCESSOR_WEIGHT_RATIONALE.items():
        assert len(rationale) > 80, component


def test_the_successor_ranks_only_what_the_constraint_screening_ranks() -> None:
    # The successor re-scores; it never re-screens. Ranking a candidate the
    # constraint screening excluded would present burden and impact indicators as
    # siting suitability (ANALYTICAL_METHODS.md, Weighting Policy item 2).
    assert policy.SCREENING_STATUS_RANKABLE == "ELIGIBLE"
    assert "ELIGIBLE" in policy.RANKING_POPULATION_RULE
    assert "complete case" in policy.RANKING_POPULATION_RULE


# --------------------------------------------------------------------------- #
# Missing-component eligibility policy
# --------------------------------------------------------------------------- #


def test_the_missing_component_policy_is_strict_and_admits_nothing_optional() -> None:
    # Decided in Phase 4 against the measured post-correction population: the units
    # each renormalized variant would admit are not exchangeable with the complete
    # cases, so a three-component composite is not comparable with a four-component
    # one. Strict is the only policy that keeps one ranking meaning one thing.
    assert policy.SELECTED_MISSING_COMPONENT_POLICY == policy.MISSING_POLICY_STRICT
    assert policy.OPTIONAL_COMPONENTS == ()
    assert policy.MISSING_POLICY_ZERO_FILL in policy.FORBIDDEN_MISSING_COMPONENT_POLICIES


def test_deciding_every_policy_question_did_not_activate_anything() -> None:
    # A fully decided policy is still not an activated model: nothing writes a
    # successor run yet. This is the distinction the whole gate rests on.
    assert not policy.open_phase4_decisions()
    assert policy.SUCCESSOR_WEIGHT_PROFILES
    assert policy.is_activated() is False
    with pytest.raises(SuccessorActivationBlockedError):
        policy.assert_activated()


def test_every_phase4_question_carries_an_explicit_status() -> None:
    # No blocker may disappear silently: every decision is enumerated with one of
    # four statuses, and the ones that could not be answered say so.
    statuses = {
        policy.DECISION_DECIDED,
        policy.DECISION_RESOLVED,
        policy.DECISION_DEFERRED,
        policy.DECISION_OPEN,
    }
    decisions = policy.phase4_decisions()
    assert decisions
    for decision in decisions:
        assert decision.status in statuses, decision.decision_id
        assert decision.summary and decision.evidence, decision.decision_id
    assert len({d.decision_id for d in decisions}) == len(decisions)


def test_the_four_gating_decisions_are_closed_with_evidence() -> None:
    decided = {
        d.decision_id: d
        for d in policy.phase4_decisions()
        if d.status == policy.DECISION_DECIDED
    }
    for decision_id in (
        "FINAL_WEIGHT_VECTOR",
        "RESIDENT_DISTANCE_FLOOR",
        "LAND_COVER_CLASS_REGISTRY",
        "AMBIGUOUS_LAND_CLASSES",
        "SUCCESSOR_RANKING_POPULATION",
    ):
        assert decision_id in decided, decision_id
        assert decided[decision_id].evidence, decision_id
    assert not policy.open_phase4_decisions()
    # The invariant survives closure: an open question and an activated model stay
    # mutually exclusive.
    open_ids = {d.decision_id for d in policy.open_phase4_decisions()}
    assert not (open_ids and policy.is_activated())


def test_critic_is_diagnostic_only_for_the_successor_model() -> None:
    decision = next(d for d in policy.phase4_decisions() if d.decision_id == "CRITIC_SUITABILITY")
    assert decision.status == policy.DECISION_DECIDED
    assert "DIAGNOSTIC ONLY" in decision.summary
    # The finding stopped blocking because the approved vector is not data-derived,
    # so it is recorded as CLOSED rather than deleted. The guarantee it protects —
    # that no CRITIC vector weights a successor run — is unchanged.
    closed = {b.blocker_id: b for b in policy.CLOSED_BLOCKERS}
    assert "SUCCESSOR_CRITIC_UNSUITABLE_FOR_WEIGHTING" in closed
    assert "not data-derived" in closed["SUCCESSOR_CRITIC_UNSUITABLE_FOR_WEIGHTING"].basis
    assert "SUCCESSOR_CRITIC_UNSUITABLE_FOR_WEIGHTING" not in {
        b.blocker_id for b in policy.activation_blockers()
    }
    # No CRITIC vector may ever be registered as a successor weight profile.
    assert "critic" not in policy.SUCCESSOR_WEIGHT_PROFILES


def test_the_stability_contract_is_defined_but_has_no_thresholds() -> None:
    design = policy.STABILITY_CONTRACT_DESIGN
    assert design["status"] == "DEFINED_NOT_SATISFIABLE"
    assert design["inherited_from_historical"] is False
    assert set(design["perturbation_axes"]) == {
        "weights",
        "resident_distance_floor",
        "normalization",
        "missingness_and_eligibility",
    }
    assert design["acceptance_criteria"].startswith("UNSET")


def test_the_runtime_design_is_designed_not_activated() -> None:
    design = policy.SUCCESSOR_RUNTIME_DESIGN
    assert design["status"] == "DESIGNED_NOT_ACTIVATED"
    assert "UNMINTED" in design["model_version"]["policy_version"]
    # The switchover ordering is the load-bearing part: making default-run
    # resolution model-aware must precede the first successor write, not accompany
    # it, or the write itself moves every default view.
    assert "BEFORE the first" in design["default_run_resolution"]["required_change"]
    assert design["coexistence"]["historical_guarantee"]


def test_zero_filling_a_missing_component_is_permanently_forbidden() -> None:
    assert policy.MISSING_POLICY_ZERO_FILL in policy.FORBIDDEN_MISSING_COMPONENT_POLICIES
    with pytest.raises(CrossModelReuseError) as excinfo:
        policy.resolve_missing_component_policy(policy.MISSING_POLICY_ZERO_FILL)
    assert "forbidden" in str(excinfo.value)


def test_the_two_permitted_policies_resolve_and_unknown_ones_do_not() -> None:
    assert (
        policy.resolve_missing_component_policy(policy.MISSING_POLICY_STRICT)
        == policy.MISSING_POLICY_STRICT
    )
    assert (
        policy.resolve_missing_component_policy(policy.MISSING_POLICY_OPTIONAL_RENORMALIZED)
        == policy.MISSING_POLICY_OPTIONAL_RENORMALIZED
    )
    with pytest.raises(CrossModelReuseError):
        policy.resolve_missing_component_policy("BEST_EFFORT")


# --------------------------------------------------------------------------- #
# Component-set classification
# --------------------------------------------------------------------------- #


def test_component_sets_classify_to_their_own_model() -> None:
    assert policy.classify_component_set(historical_policy.COMPONENTS) == "HISTORICAL"
    assert policy.classify_component_set(policy.COMPONENTS) == "SUCCESSOR"
    assert policy.classify_component_set(["zoning", "land_conversion"]) == "MIXED"
    assert policy.classify_component_set(["something_else"]) == "UNKNOWN"
    assert policy.classify_component_set([]) == "UNKNOWN"


def test_a_historical_derivation_refuses_successor_components() -> None:
    historical_policy_components = list(historical_policy.COMPONENTS)
    policy.assert_historical_component_set(historical_policy_components)
    with pytest.raises(CrossModelReuseError):
        policy.assert_historical_component_set(policy.COMPONENTS)


def test_a_successor_derivation_refuses_historical_components() -> None:
    policy.assert_successor_component_set(policy.COMPONENTS)
    with pytest.raises(CrossModelReuseError):
        policy.assert_successor_component_set(historical_policy.COMPONENTS)


def test_the_two_namespaces_are_asserted_disjoint() -> None:
    policy.assert_component_namespaces_disjoint()


# --------------------------------------------------------------------------- #
# Cross-model reuse is refused, never approximated
# --------------------------------------------------------------------------- #


def test_historical_weight_profiles_cannot_be_translated_by_name() -> None:
    with pytest.raises(CrossModelReuseError) as excinfo:
        policy.translate_historical_weights(historical_policy.STATIC_WEIGHT_PROFILES["baseline"])
    assert excinfo.value.category == "CROSS_MODEL_REUSE_REJECTED"


def test_weights_cannot_be_translated_by_position() -> None:
    # The exact hazard: position 1 is `road` historically and `air_impact_proxy` in
    # the successor model, so a positional read silently relabels every weight.
    with pytest.raises(CrossModelReuseError):
        policy.translate_weights_by_position(
            [Decimal("0.35"), Decimal("0.25"), Decimal("0.25"), Decimal("0.15")]
        )


def test_a_saved_historical_scenario_cannot_be_carried_over() -> None:
    with pytest.raises(CrossModelReuseError):
        policy.translate_saved_scenario(
            {"zoning": "0.25", "road": "0.25", "equity": "0.25", "demand": "0.25"}
        )


def test_a_critic_vector_from_a_historical_run_is_not_a_successor_vector() -> None:
    # A stored CRITIC vector is keyed by the historical criteria; feeding it to a
    # successor derivation must be refused rather than partially matched.
    historical_vector = {c: Decimal("0.25") for c in historical_critic.CRITERION_ORDER}
    with pytest.raises(CrossModelReuseError):
        policy.assert_successor_component_set(historical_vector.keys())


# --------------------------------------------------------------------------- #
# CRITIC pre-flight
# --------------------------------------------------------------------------- #


def _successor_row(index: int) -> dict[str, Decimal]:
    return {
        "existing_burden": Decimal(index),
        "air_impact_proxy": Decimal(index * 2),
        "resident_impact": Decimal(index * 3),
        "land_conversion": Decimal(index * 4),
    }


def test_preflight_passes_on_a_varying_population_and_reports_what_it_checked() -> None:
    report = policy.critic_preflight(
        [_successor_row(i) for i in range(1, 11)], minimum_population=5
    )
    assert report["population"] == 10
    assert report["distinct_value_counts"]["existing_burden"] == 10


def test_preflight_fails_on_a_collapsed_population() -> None:
    with pytest.raises(SuccessorCriticPreflightError) as excinfo:
        policy.critic_preflight([_successor_row(1), _successor_row(2)], minimum_population=50)
    assert excinfo.value.category == "SUCCESSOR_CRITIC_PREFLIGHT_FAILED"
    assert excinfo.value.fields["population"] == 2


def test_preflight_fails_when_a_component_is_constant() -> None:
    rows = [_successor_row(i) for i in range(1, 6)]
    for row in rows:
        row["air_impact_proxy"] = Decimal("50")  # region-level value, one region
    with pytest.raises(SuccessorCriticPreflightError) as excinfo:
        policy.critic_preflight(rows, minimum_population=3)
    assert excinfo.value.fields["constant_components"] == ["air_impact_proxy"]


def test_preflight_requires_an_explicit_usable_minimum() -> None:
    with pytest.raises(SuccessorCriticPreflightError):
        policy.critic_preflight([_successor_row(1)], minimum_population=1)


def test_preflight_refuses_a_historical_component_matrix() -> None:
    rows = [{c: Decimal(index) for c in historical_policy.COMPONENTS} for index in range(1, 4)]
    with pytest.raises(CrossModelReuseError):
        policy.critic_preflight(rows, minimum_population=2)


# --------------------------------------------------------------------------- #
# Persistence design (declared, not applied)
# --------------------------------------------------------------------------- #


def test_the_persistence_design_is_applied_but_writes_no_successor_run() -> None:
    """The schema is applied; the successor *write path* is still blocked.

    Applying the columns is what lets two component models coexist in storage and
    on the wire. It does not make a successor run producible, and the blocker that
    replaced the design-only one says exactly that.
    """

    design = policy.PERSISTENCE_DESIGN
    assert design["status"] == "APPLIED_ADDITIVE_SCHEMA_ONLY"
    assert design["applied_migrations"] == ["0022", "0023"]
    assert "component_scores" in design["candidate_level"]["added_columns"]
    assert "component_model_version" in design["run_level"]["added_columns"]
    assert "SUCCESSOR_RUN_WRITE_PATH_NOT_IMPLEMENTED" in {
        b.blocker_id for b in policy.activation_blockers()
    }


def test_the_design_forbids_reusing_or_copying_the_historical_columns() -> None:
    rules = " ".join(policy.PERSISTENCE_DESIGN["candidate_level"]["write_rules"]).lower()
    assert "never reused" in rules
    assert "nothing backfilled" in rules
    assert "never copied" in rules or "is ever copied" in rules


# --------------------------------------------------------------------------- #
# Snapshot
# --------------------------------------------------------------------------- #


def test_the_snapshot_is_json_serializable_and_states_it_is_not_activated() -> None:
    import json

    snapshot = policy.successor_snapshot()
    json.dumps(snapshot, ensure_ascii=False)  # must not raise
    # An approved, fully decided policy that is still not an activated model.
    assert snapshot["activated"] is False
    assert snapshot["activation_blockers"]
    assert snapshot["policy_version"] == policy.SUCCESSOR_POLICY_VERSION
    assert snapshot["derivation_version"] == policy.SUCCESSOR_DERIVATION_VERSION
    assert snapshot["weight_profiles"] == dict(policy.SUCCESSOR_WEIGHT_PROFILES)
    assert snapshot["missing_component_policy"]["selected"] == policy.MISSING_POLICY_STRICT
    assert snapshot["open_phase4_decisions"] == []
    assert snapshot["component_model_version"] == policy.COMPONENT_MODEL_VERSION_SUCCESSOR
    assert snapshot["component_order"] == list(policy.COMPONENT_ORDER_SUCCESSOR)
    # The closure is self-describing: approval basis, what closed, what is still a
    # published limitation, and the ranking-population rule all travel with it.
    assert snapshot["policy_closure_approval"] == policy.POLICY_CLOSURE_APPROVAL
    assert snapshot["closed_blockers"]
    assert snapshot["accepted_limitations"]
    assert snapshot["weight_rationale"]
    assert "ELIGIBLE" in snapshot["ranking_population_rule"]


def test_the_snapshot_records_the_historical_model_unchanged() -> None:
    historical = policy.successor_snapshot()["historical_model"]
    assert historical["policy_version"] == historical_policy.POLICY_VERSION
    assert historical["derivation_version"] == historical_policy.DERIVATION_VERSION
    assert historical["components"] == list(historical_policy.COMPONENTS)
    assert historical["component_model_version"] == "suitability-components-zred-v1"


def test_the_scenario_method_version_is_referenced_not_bumped_here() -> None:
    # The successor lane must not move the scenario contract's own version; that is
    # a separate change with its own client-side migration.
    assert historical_scenario.USER_WEIGHT_SCENARIO_METHOD_VERSION == "user-weight-scenario-v1"


# --------------------------------------------------------------------------- #
# Successor scores are on the scale the existing CRITIC normalization assumes
# --------------------------------------------------------------------------- #


def test_every_successor_component_normalizes_to_a_beneficial_zero_to_hundred_score() -> None:
    """CRITIC assumes a policy-fixed [0,100] *beneficial-direction* scale.

    Both successor normalization strategies map to exactly that scale regardless of
    the component's raw direction, so no direction-aware CRITIC normalization — and
    therefore no CRITIC method-version bump — is implied by the successor model.
    """

    for direction in (contract.LOWER_RAW_IS_BETTER, contract.HIGHER_RAW_IS_BETTER):
        for percentile in ("0", "0.5", "1"):
            score = contract.score_from_percentile(Decimal(percentile), direction)
            assert Decimal("0") <= score <= Decimal("100")
        for ratio in ("0", "0.25", "1"):
            score = contract.score_from_bounded_ratio(Decimal(ratio), direction)
            assert Decimal("0") <= score <= Decimal("100")
    # Beneficial direction: a better raw value earns the higher score in both modes.
    assert contract.score_from_percentile(
        Decimal("0"), contract.LOWER_RAW_IS_BETTER
    ) > contract.score_from_percentile(Decimal("1"), contract.LOWER_RAW_IS_BETTER)
    assert contract.score_from_bounded_ratio(
        Decimal("0"), contract.LOWER_RAW_IS_BETTER
    ) > contract.score_from_bounded_ratio(Decimal("1"), contract.LOWER_RAW_IS_BETTER)


def test_a_bounded_ratio_outside_zero_to_one_is_an_error_not_a_clamp() -> None:
    with pytest.raises(contract.SuccessorContractError):
        contract.score_from_bounded_ratio(Decimal("1.5"), contract.LOWER_RAW_IS_BETTER)
    with pytest.raises(contract.SuccessorContractError):
        contract.score_from_bounded_ratio(Decimal("-0.1"), contract.LOWER_RAW_IS_BETTER)
