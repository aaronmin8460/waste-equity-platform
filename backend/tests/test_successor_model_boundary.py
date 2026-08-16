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


def test_the_successor_model_is_not_activated() -> None:
    assert policy.is_activated() is False
    assert policy.SUCCESSOR_POLICY_VERSION is None
    assert policy.SUCCESSOR_DERIVATION_VERSION is None


def test_activation_raises_and_names_every_open_blocker() -> None:
    with pytest.raises(SuccessorActivationBlockedError) as excinfo:
        policy.assert_activated()
    assert excinfo.value.category == "SUCCESSOR_MODEL_NOT_ACTIVATED"
    assert len(excinfo.value.blockers) == len(policy.ACTIVATION_BLOCKERS)
    message = str(excinfo.value)
    for blocker in policy.ACTIVATION_BLOCKERS:
        assert blocker.blocker_id in message


def test_the_open_research_dependencies_are_all_recorded() -> None:
    ids = {b.blocker_id for b in policy.activation_blockers()}
    assert {
        "RESIDENT_IMPACT_DISTANCE_FLOOR_UNAPPROVED",
        "LAND_COVER_DEVELOPED_CLASS_REGISTRY_UNAVAILABLE",
        "SUCCESSOR_WEIGHT_VECTOR_UNAPPROVED",
        "MISSING_COMPONENT_ELIGIBILITY_POLICY_UNDECIDED",
        "SUCCESSOR_DEFAULT_RUN_RESOLUTION_UNDECIDED",
    } <= ids
    for blocker in policy.activation_blockers():
        assert blocker.summary and blocker.blocks and blocker.resolution_owner


def test_no_successor_weight_profile_is_registered() -> None:
    assert policy.SUCCESSOR_WEIGHT_PROFILES == {}


# --------------------------------------------------------------------------- #
# Missing-component eligibility policy
# --------------------------------------------------------------------------- #


def test_the_missing_component_policy_is_undecided() -> None:
    assert policy.SELECTED_MISSING_COMPONENT_POLICY is None
    assert policy.OPTIONAL_COMPONENTS == ()


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


def test_the_persistence_design_is_declared_but_not_applied() -> None:
    design = policy.PERSISTENCE_DESIGN
    assert design["status"] == "DESIGN_ONLY_NOT_APPLIED"
    assert "component_scores" in design["candidate_level"]["added_columns"]
    assert "component_model_version" in design["run_level"]["added_columns"]


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
    assert snapshot["activated"] is False
    assert snapshot["policy_version"] is None
    assert snapshot["derivation_version"] is None
    assert snapshot["weight_profiles"] == {}
    assert snapshot["missing_component_policy"]["selected"] is None
    assert snapshot["component_model_version"] == policy.COMPONENT_MODEL_VERSION_SUCCESSOR
    assert snapshot["component_order"] == list(policy.COMPONENT_ORDER_SUCCESSOR)


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
