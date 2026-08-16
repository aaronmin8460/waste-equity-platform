"""Historical-model regression contract for the successor-model work.

Every assertion here is a statement that adding the successor model changed
**nothing** about what a stored Z/R/E/D run means. They are deliberately literal:
a test that reads a constant back out of the module it is testing proves nothing,
so the expected values are written out in full and would have to be edited by hand
for a historical semantic to move.

These are the proof obligations named in the compatibility audit: historical
component semantics unchanged, historical persisted fields unchanged, and
historical policy tests continuing to mean the same thing.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import Numeric

from waste_equity_backend.analysis.suitability import (
    component_model,
    critic,
    policy,
    scenario,
)
from waste_equity_backend.analysis.suitability.successor import (
    policy as successor_policy,
)
from waste_equity_backend.models.suitability import SuitabilityAnalysisRun, SuitabilityCandidate

# --------------------------------------------------------------------------- #
# Component semantics
# --------------------------------------------------------------------------- #


def test_the_historical_components_are_unchanged_and_in_order() -> None:
    assert policy.COMPONENTS == ("zoning", "road", "equity", "demand")


def test_the_historical_version_identity_is_unchanged() -> None:
    assert policy.POLICY_VERSION == "suitability-policy-v2"
    assert policy.DERIVATION_VERSION == "suitability-screening-v3"
    assert policy.CANDIDATE_GRID_VERSION == "capital-grid-500m-v1"
    assert policy.CRITIC_METHOD_VERSION == "critic-weights-v1"
    assert policy.STABILITY_METHOD_VERSION == "suitability-stability-v1"
    assert scenario.USER_WEIGHT_SCENARIO_METHOD_VERSION == "user-weight-scenario-v1"


def test_the_static_weight_profiles_are_byte_for_byte_unchanged() -> None:
    assert policy.STATIC_WEIGHT_PROFILES == {
        "baseline": {
            "zoning": Decimal("0.35"),
            "road": Decimal("0.25"),
            "equity": Decimal("0.25"),
            "demand": Decimal("0.15"),
        },
        "equal": {
            "zoning": Decimal("0.25"),
            "road": Decimal("0.25"),
            "equity": Decimal("0.25"),
            "demand": Decimal("0.25"),
        },
        "equity_focused": {
            "zoning": Decimal("0.30"),
            "road": Decimal("0.15"),
            "equity": Decimal("0.40"),
            "demand": Decimal("0.15"),
        },
        "access_focused": {
            "zoning": Decimal("0.25"),
            "road": Decimal("0.40"),
            "equity": Decimal("0.20"),
            "demand": Decimal("0.15"),
        },
    }


def test_equity_is_still_an_avoidance_score_not_a_burden_score() -> None:
    """The single most damaging shortcut, pinned.

    ``equity_score`` is ``(1 - burden_percentile) x 100``: **lower** measured burden
    earns a **higher** score. The successor ``existing_burden`` names the burden
    itself. If the historical component's direction ever silently flipped to match
    the successor component's name, every stored ``equity_score`` would assert the
    opposite of what it was computed to mean.
    """

    assert policy.equity_score_from_rank(Decimal("0")) == Decimal("100.0000")
    assert policy.equity_score_from_rank(Decimal("1")) == Decimal("0.0000")
    assert policy.equity_score_from_rank(Decimal("0.25")) == Decimal("75.0000")


def test_demand_is_still_scored_in_the_direct_direction() -> None:
    assert policy.demand_score_from_rank(Decimal("0")) == Decimal("0.0000")
    assert policy.demand_score_from_rank(Decimal("1")) == Decimal("100.0000")


def test_the_road_distance_curve_is_unchanged() -> None:
    assert policy.ROAD_DISTANCE_CURVE == [
        (Decimal("0"), Decimal("100")),
        (Decimal("250"), Decimal("100")),
        (Decimal("1000"), Decimal("70")),
        (Decimal("3000"), Decimal("20")),
        (Decimal("5000"), Decimal("0")),
    ]
    assert policy.road_score(Decimal("0")) == Decimal("100.0000")
    assert policy.road_score(Decimal("1000")) == Decimal("70.0000")
    assert policy.road_score(Decimal("9999")) == Decimal("0.0000")


def test_the_zoning_registry_scores_and_ceiling_are_unchanged() -> None:
    assert policy.ZONING_REGISTRY["UQ112"].score == Decimal("55")
    assert policy.ZONING_REGISTRY["UQ113"].score == Decimal("25")
    assert policy.ZONING_REGISTRY["UQ111"].score is None
    assert policy.ZONING_REGISTRY["UQ114"].score is None
    assert policy.MAX_V1_ZONING_SCORE == Decimal("55")


def test_the_stability_definition_is_unchanged() -> None:
    assert policy.STABILITY_TOP_FRACTION == Decimal("0.10")
    assert policy.STABILITY_PROFILES == ("baseline", "equal", "critic")
    assert policy.DEFAULT_PROFILE == "baseline"


def test_the_historical_composite_still_weights_the_historical_components() -> None:
    scores = {
        "zoning": Decimal("55"),
        "road": Decimal("100"),
        "equity": Decimal("80"),
        "demand": Decimal("40"),
    }
    # 55*0.35 + 100*0.25 + 80*0.25 + 40*0.15 = 19.25 + 25 + 20 + 6 = 70.25
    assert policy.composite(scores, "baseline") == Decimal("70.2500")


def test_the_historical_provisional_composite_still_renormalizes_over_present_only() -> None:
    # Present components are renormalized, never zero-filled — the behaviour the
    # successor's optional-component policy option would build on.
    partial = {"zoning": Decimal("55"), "road": Decimal("100")}
    # (55*0.35 + 100*0.25) / (0.35 + 0.25) = 44.25 / 0.60 = 73.75
    assert policy.provisional_composite(partial, "baseline") == Decimal("73.7500")
    assert policy.provisional_composite({}, "baseline") is None


# --------------------------------------------------------------------------- #
# Persisted fields
# --------------------------------------------------------------------------- #


def test_the_four_historical_score_columns_still_exist_with_their_own_names() -> None:
    columns = SuitabilityCandidate.__table__.columns
    for name in ("zoning_score", "road_score", "equity_score", "demand_score"):
        assert name in columns, f"historical column {name} must never be renamed or dropped"
        column = columns[name]
        assert column.nullable is True
        assert column.type.precision == 7
        assert column.type.scale == 4


def test_no_successor_component_has_taken_a_historical_column() -> None:
    columns = set(SuitabilityCandidate.__table__.columns.keys())
    for component in successor_policy.COMPONENTS:
        assert component not in columns
        assert f"{component}_score" not in columns


def test_the_historical_run_columns_are_unchanged() -> None:
    columns = set(SuitabilityAnalysisRun.__table__.columns.keys())
    for name in (
        "policy_version",
        "derivation_version",
        "candidate_grid_version",
        "weight_profile",
        "weight_profiles",
        "weight_derivation",
        "stability_definition",
        "analysis_signature",
    ):
        assert name in columns


def test_the_persistence_design_is_applied_additively_only() -> None:
    """The recorded design is now applied, and applied *additively*.

    The design in ``successor_policy.PERSISTENCE_DESIGN`` adds three columns and
    alters none. What must stay true is not "no column was added" but "nothing
    historical moved": the four legacy score columns are still present, still
    nullable, still ``Numeric(7,4)``, and still the only columns a historical run's
    component scores live in.
    """

    assert successor_policy.PERSISTENCE_DESIGN["status"] == "APPLIED_ADDITIVE_SCHEMA_ONLY"

    run_columns = SuitabilityAnalysisRun.__table__.columns
    assert "component_model_version" in run_columns
    assert "component_order" in run_columns
    candidate_columns = SuitabilityCandidate.__table__.columns
    assert "component_scores" in candidate_columns

    # The added candidate column is a JSON map, never a fifth score column that
    # could be confused with the four historical ones.
    assert not isinstance(candidate_columns["component_scores"].type, Numeric)

    # Nothing historical was renamed, retyped, or made non-nullable.
    for component in policy.COMPONENTS:
        column = candidate_columns[f"{component}_score"]
        assert column.nullable is True
        assert column.type.precision == 7
        assert column.type.scale == 4


def test_the_added_columns_default_to_labelling_existing_rows_historical() -> None:
    """The new run columns default to the model existing rows already used.

    Stamping a pre-existing run ``zred-v1`` states a fact that is already true — the
    candidate table admits no other component model at this revision — so it is
    labelling, not a semantic backfill. No analytical value is read or written to
    establish it.
    """

    run_columns = SuitabilityAnalysisRun.__table__.columns
    assert run_columns["component_model_version"].server_default is not None
    assert (
        component_model.COMPONENT_MODEL_HISTORICAL
        in run_columns["component_model_version"].server_default.arg.text
    )
    assert run_columns["component_order"].server_default is not None
    for name in policy.COMPONENTS:
        assert name in run_columns["component_order"].server_default.arg.text
    # Candidate rows default to an EMPTY map: a historical score is never copied
    # into the version-aware representation, because a second copy of an
    # authoritative analytical value can drift from the first.
    assert (
        SuitabilityCandidate.__table__.columns["component_scores"].server_default.arg.text == "'{}'"
    )


# --------------------------------------------------------------------------- #
# CRITIC and stability stay bound to the historical component matrix
# --------------------------------------------------------------------------- #


def test_the_critic_criterion_order_still_matches_the_historical_components() -> None:
    """Pins the one duplicated literal in the CRITIC path.

    ``critic.CRITERION_ORDER`` is written out independently of ``policy.COMPONENTS``
    (the policy module imports critic, so critic cannot import policy back without
    a cycle). Drift between the two would make CRITIC compute over a different
    criterion set than the engine scored, so the equality is asserted here instead.
    """

    assert critic.CRITERION_ORDER == policy.COMPONENTS
    assert critic.CRITERION_ORDER == ("zoning", "road", "equity", "demand")


def test_critic_normalization_still_assumes_the_policy_fixed_beneficial_scale() -> None:
    assert "policy-fixed [0,100] scale" in critic.NORMALIZATION
    assert critic.STANDARD_DEVIATION_DEFINITION == "population standard deviation (denominator N)"


def test_critic_still_refuses_to_run_over_successor_components() -> None:
    rows = [
        {c: Decimal("50") for c in successor_policy.COMPONENTS},
        {c: Decimal("60") for c in successor_policy.COMPONENTS},
    ]
    # CRITIC indexes its own criterion order, so successor rows cannot be scored by
    # it even accidentally.
    with pytest.raises(KeyError):
        critic.compute_critic_weights(rows)


def test_critic_still_produces_the_historical_vector_for_historical_rows() -> None:
    rows = [
        {
            "zoning": Decimal("55"),
            "road": Decimal("100"),
            "equity": Decimal("80"),
            "demand": Decimal("40"),
        },
        {
            "zoning": Decimal("25"),
            "road": Decimal("70"),
            "equity": Decimal("20"),
            "demand": Decimal("90"),
        },
        {
            "zoning": Decimal("55"),
            "road": Decimal("20"),
            "equity": Decimal("60"),
            "demand": Decimal("10"),
        },
    ]
    result = critic.compute_critic_weights(rows)
    assert result.criterion_order == ("zoning", "road", "equity", "demand")
    assert sum(result.weights.values(), start=Decimal("0")) == Decimal("1")
    assert result.population_candidate_count == 3


# --------------------------------------------------------------------------- #
# Scenarios stay bound to the historical component matrix
# --------------------------------------------------------------------------- #


def test_the_scenario_weight_contract_still_requires_the_historical_four() -> None:
    assert scenario.COMPONENT_ORDER == ("zoning", "road", "equity", "demand")
    weights = scenario.parse_and_validate_weights(
        {"zoning": "0.25", "road": "0.25", "equity": "0.25", "demand": "0.25"}
    )
    assert set(weights) == set(policy.COMPONENTS)


def test_a_scenario_keyed_by_successor_components_is_rejected() -> None:
    with pytest.raises(scenario.ScenarioWeightError):
        scenario.parse_and_validate_weights({c: "0.25" for c in successor_policy.COMPONENTS})


def test_the_scenario_hash_payload_is_unchanged() -> None:
    weights = scenario.parse_and_validate_weights(
        {"zoning": "0.25", "road": "0.25", "equity": "0.25", "demand": "0.25"}
    )
    payload = scenario.canonical_hash_payload(7, weights)
    assert payload == (
        '{"method_version":"user-weight-scenario-v1","run_id":7,'
        '"weights":{"zoning":"0.25000000","road":"0.25000000",'
        '"equity":"0.25000000","demand":"0.25000000"}}'
    )


# --------------------------------------------------------------------------- #
# The policy snapshot a stored run carries
# --------------------------------------------------------------------------- #


def test_the_policy_snapshot_still_describes_the_historical_model_only() -> None:
    snapshot = policy.policy_snapshot()
    assert snapshot["policy_version"] == "suitability-policy-v2"
    assert snapshot["derivation_version"] == "suitability-screening-v3"
    assert set(snapshot["weight_profiles"]) == set(policy.STATIC_WEIGHT_PROFILES)
    assert set(snapshot["supported_profiles"]) == {
        "baseline",
        "equal",
        "equity_focused",
        "access_focused",
        "critic",
    }
    # No successor component leaks into a historical run's snapshot.
    blob = repr(snapshot)
    for component in successor_policy.COMPONENTS:
        assert component not in blob


def test_the_historical_registry_still_validates() -> None:
    policy.validate_policy()
