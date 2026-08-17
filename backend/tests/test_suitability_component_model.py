"""The component-model boundary: identity, storage, guards, and serialization.

These are the unit-level proof obligations for two component models coexisting in
one backend. Candidate-bearing HTTP paths need PostGIS geometry and live in
``test_suitability_routes_integration.py``; everything the routes *delegate* to is
exercised here directly, against synthetic rows, so the version-aware logic is
covered independently of whether a PostGIS tier is configured.

The governing rule throughout: a historical assertion is a regression contract, not
a stale assumption. Where a test writes out a literal, it is because reading the
value back out of the module under test would prove nothing.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from waste_equity_backend.analysis.suitability import component_model, policy
from waste_equity_backend.analysis.suitability.successor import policy as successor_policy

HISTORICAL = "suitability-components-zred-v1"
SUCCESSOR = "suitability-components-successor-v1"
HISTORICAL_ORDER = ["zoning", "road", "equity", "demand"]
SUCCESSOR_ORDER = [
    "existing_burden",
    "air_impact_proxy",
    "resident_impact",
    "land_conversion",
]


def _historical_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "zoning_score": "55.0000",
        "road_score": "100.0000",
        "equity_score": "80.0000",
        "demand_score": "40.0000",
        "component_scores": {},
    }
    row.update(overrides)
    return row


def _successor_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "zoning_score": None,
        "road_score": None,
        "equity_score": None,
        "demand_score": None,
        "component_scores": {
            "existing_burden": "61.2500",
            "air_impact_proxy": "44.0000",
            "resident_impact": "12.5000",
            "land_conversion": "88.7500",
        },
    }
    row.update(overrides)
    return row


# --------------------------------------------------------------------------- #
# Identity: one definition, three places it must agree
# --------------------------------------------------------------------------- #


def test_the_registry_identifiers_are_the_expected_literals() -> None:
    assert component_model.COMPONENT_MODEL_HISTORICAL == HISTORICAL
    assert component_model.COMPONENT_MODEL_SUCCESSOR == SUCCESSOR
    assert list(component_model.COMPONENT_ORDER_HISTORICAL) == HISTORICAL_ORDER
    assert list(component_model.COMPONENT_ORDER_SUCCESSOR) == SUCCESSOR_ORDER


def test_the_registry_agrees_with_the_successor_foundation() -> None:
    """Pins the identifiers this module writes out rather than imports.

    ``component_model`` has to be importable from ``models`` and from ``scenario``,
    and ``successor.policy`` imports ``scenario``, so importing the constants back
    would be a cycle — the same constraint that keeps ``critic.CRITERION_ORDER`` a
    literal. Asserting equality catches the drift without restructuring anything.
    """

    assert (
        component_model.COMPONENT_MODEL_HISTORICAL
        == successor_policy.COMPONENT_MODEL_VERSION_HISTORICAL
    )
    assert (
        component_model.COMPONENT_MODEL_SUCCESSOR
        == successor_policy.COMPONENT_MODEL_VERSION_SUCCESSOR
    )
    assert component_model.COMPONENT_ORDER_HISTORICAL == tuple(
        successor_policy.COMPONENT_ORDER_HISTORICAL
    )
    assert component_model.COMPONENT_ORDER_SUCCESSOR == tuple(
        successor_policy.COMPONENT_ORDER_SUCCESSOR
    )
    assert component_model.COMPONENT_ORDER_HISTORICAL == policy.COMPONENTS


def test_the_migration_literals_match_the_registry() -> None:
    """The migration must keep labelling rows with the identity the app resolves.

    A migration deliberately holds literals rather than importing the application's
    constants, so that it keeps meaning what it meant on the day it ran. That makes
    an equality test the only thing standing between the two if a constant ever
    moves.
    """

    migration = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260816_0022_suitability_component_model_identity.py"
    ).read_text(encoding="utf-8")
    namespace: dict[str, Any] = {}
    for line in migration.splitlines():
        if line.startswith("HISTORICAL_COMPONENT_MODEL") or line.startswith(
            "HISTORICAL_COMPONENT_ORDER"
        ):
            exec(line, namespace)  # noqa: S102 - two literal assignments from our own file
    assert namespace["HISTORICAL_COMPONENT_MODEL"] == component_model.COMPONENT_MODEL_HISTORICAL
    assert json.loads(namespace["HISTORICAL_COMPONENT_ORDER"]) == HISTORICAL_ORDER


def test_the_two_models_keep_disjoint_component_namespaces() -> None:
    assert not set(HISTORICAL_ORDER) & set(SUCCESSOR_ORDER)
    component_model.validate_registry()  # must not raise


def test_an_unknown_component_model_is_refused_rather_than_guessed() -> None:
    with pytest.raises(component_model.UnknownComponentModelError) as excinfo:
        component_model.component_order_for("suitability-components-imaginary-v9")
    assert excinfo.value.error == "UNKNOWN_COMPONENT_MODEL"
    assert excinfo.value.as_envelope()["fields"]["known"] == [HISTORICAL, SUCCESSOR]


# --------------------------------------------------------------------------- #
# Stored-run identity
# --------------------------------------------------------------------------- #


def test_a_matching_version_and_order_validate() -> None:
    assert component_model.validate_run_model_identity(HISTORICAL, HISTORICAL_ORDER) == (
        HISTORICAL,
        HISTORICAL_ORDER,
    )
    assert component_model.validate_run_model_identity(SUCCESSOR, SUCCESSOR_ORDER) == (
        SUCCESSOR,
        SUCCESSOR_ORDER,
    )


def test_a_successor_run_cannot_be_mislabelled_historical() -> None:
    """The pair is validated, not just the version, and that is the point.

    A version alone could be written on a run whose components are something else.
    Because the successor order is not the historical order, a successor run
    stamped ``zred-v1`` fails here instead of being served as history.
    """

    with pytest.raises(component_model.ComponentModelMismatchError) as excinfo:
        component_model.validate_run_model_identity(HISTORICAL, SUCCESSOR_ORDER)
    assert excinfo.value.error == "COMPONENT_MODEL_MISMATCH"
    assert excinfo.value.fields["stored_component_order"] == SUCCESSOR_ORDER


def test_a_reordered_component_order_is_a_mismatch_not_a_normalization() -> None:
    """Order is load-bearing and is never silently re-sorted into agreement."""

    with pytest.raises(component_model.ComponentModelMismatchError):
        component_model.validate_run_model_identity(
            HISTORICAL, ["road", "zoning", "equity", "demand"]
        )


def test_component_order_is_read_from_raw_json_text_too() -> None:
    """A ``text()`` SELECT returns the JSON column decoded on PostgreSQL and as raw
    text on SQLite; both are supported test tiers, so both must read identically."""

    version, order = component_model.validate_run_model_identity(
        HISTORICAL, json.dumps(HISTORICAL_ORDER)
    )
    assert (version, order) == (HISTORICAL, HISTORICAL_ORDER)


def test_a_run_with_no_component_order_is_refused() -> None:
    with pytest.raises(component_model.ComponentModelMismatchError):
        component_model.validate_run_model_identity(HISTORICAL, None)


# --------------------------------------------------------------------------- #
# Candidate score representation: storage is mirrored, never duplicated
# --------------------------------------------------------------------------- #


def test_a_historical_candidate_keeps_its_legacy_fields_populated() -> None:
    assert component_model.legacy_score_fields(HISTORICAL, _historical_row()) == {
        "zoning_score": "55.0000",
        "road_score": "100.0000",
        "equity_score": "80.0000",
        "demand_score": "40.0000",
    }


def test_a_historical_candidate_does_not_duplicate_its_scores_into_component_scores() -> None:
    """``component_scores`` mirrors storage rather than dual-emitting.

    The four legacy columns are the authoritative representation for a historical
    run and are already on the wire. Copying them into the version-aware map would
    create a second representation of the same number that can drift from the
    first, and would stop "component_scores is populated" from meaning "this run's
    scores live in the version-aware map".
    """

    assert component_model.component_scores_field(HISTORICAL, _historical_row()) == {}


def test_a_successor_candidate_serves_component_scores_and_null_legacy_fields() -> None:
    row = _successor_row()
    assert component_model.component_scores_field(SUCCESSOR, row) == {
        "existing_burden": "61.2500",
        "air_impact_proxy": "44.0000",
        "resident_impact": "12.5000",
        "land_conversion": "88.7500",
    }
    # Present and explicitly null — never omitted (which would invite a client
    # default) and never reused to carry a successor quantity.
    assert component_model.legacy_score_fields(SUCCESSOR, row) == {
        "zoning_score": None,
        "road_score": None,
        "equity_score": None,
        "demand_score": None,
    }


def test_a_successor_candidates_component_scores_follow_the_models_order() -> None:
    scrambled = _successor_row(
        component_scores={
            "land_conversion": "88.7500",
            "existing_burden": "61.2500",
            "resident_impact": "12.5000",
            "air_impact_proxy": "44.0000",
        }
    )
    assert list(component_model.component_scores_field(SUCCESSOR, scrambled)) == SUCCESSOR_ORDER


def test_a_missing_successor_component_is_explicitly_null_never_zero_filled() -> None:
    """Zero is the *best* score on a beneficial [0,100] scale, so a zero-fill would
    systematically promote exactly the cells with the least evidence."""

    partial = _successor_row(component_scores={"existing_burden": "61.2500"})
    served = component_model.component_scores_field(SUCCESSOR, partial)
    assert served["existing_burden"] == "61.2500"
    assert served["air_impact_proxy"] is None
    assert served["resident_impact"] is None
    assert served["land_conversion"] is None


def test_component_scores_carrying_a_foreign_component_is_refused() -> None:
    foreign = _successor_row(component_scores={"zoning": "55.0000"})
    with pytest.raises(component_model.ComponentModelMismatchError) as excinfo:
        component_model.component_scores_field(SUCCESSOR, foreign)
    assert excinfo.value.fields["unknown_components"] == ["zoning"]


def test_the_value_accessor_reads_whichever_storage_owns_the_scores() -> None:
    """One accessor for every reader that needs *values* rather than wire shape, so
    no call site has to know which model stores where and none can drift."""

    assert component_model.resolve_component_values(HISTORICAL, _historical_row()) == {
        "zoning": "55.0000",
        "road": "100.0000",
        "equity": "80.0000",
        "demand": "40.0000",
    }
    assert list(component_model.resolve_component_values(SUCCESSOR, _successor_row())) == (
        SUCCESSOR_ORDER
    )


def test_component_scores_arriving_as_raw_json_text_are_read_identically() -> None:
    row = _successor_row(component_scores=json.dumps({"existing_burden": "61.2500"}))
    assert component_model.component_scores_field(SUCCESSOR, row)["existing_burden"] == "61.2500"


# --------------------------------------------------------------------------- #
# Cross-model guards: CRITIC, stability, and weight vectors
# --------------------------------------------------------------------------- #


def test_a_weight_vector_over_another_models_components_is_refused() -> None:
    successor_weights = dict.fromkeys(SUCCESSOR_ORDER, "0.25")
    with pytest.raises(component_model.ComponentModelMismatchError) as excinfo:
        component_model.assert_weight_vector_matches_model(
            HISTORICAL, successor_weights, context="test"
        )
    assert excinfo.value.fields["received_components"] == sorted(SUCCESSOR_ORDER)

    historical_weights = dict.fromkeys(HISTORICAL_ORDER, "0.25")
    with pytest.raises(component_model.ComponentModelMismatchError):
        component_model.assert_weight_vector_matches_model(
            SUCCESSOR, historical_weights, context="test"
        )
    # The matching direction is inert.
    component_model.assert_weight_vector_matches_model(
        HISTORICAL, historical_weights, context="test"
    )


def test_a_critic_criterion_order_from_another_model_is_refused() -> None:
    """A stored CRITIC vector's ``criterion_order`` is what makes it self-describing.

    If it disagrees with the run's component order, the vector describes a different
    criteria matrix than the run's scores do — the correlation matrix that produced
    it does not exist for the run's criteria.
    """

    component_model.assert_criterion_order_matches_model(
        HISTORICAL, HISTORICAL_ORDER, context="test"
    )
    with pytest.raises(component_model.ComponentModelMismatchError):
        component_model.assert_criterion_order_matches_model(
            HISTORICAL, SUCCESSOR_ORDER, context="test"
        )
    with pytest.raises(component_model.ComponentModelMismatchError):
        component_model.assert_criterion_order_matches_model(HISTORICAL, None, context="test")


def test_weight_key_sets_are_classified_by_model_not_by_shape() -> None:
    assert component_model.classify_weight_components(dict.fromkeys(HISTORICAL_ORDER, "0.25")) == (
        HISTORICAL
    )
    assert component_model.classify_weight_components(dict.fromkeys(SUCCESSOR_ORDER, "0.25")) == (
        SUCCESSOR
    )
    # Four keys is not enough to be a model; nonsense stays nonsense.
    assert component_model.classify_weight_components({"a": "1", "b": "2", "c": "3", "d": "4"}) is (
        None
    )
    assert component_model.classify_weight_components({"zoning": "1"}) is None


# --------------------------------------------------------------------------- #
# Default-run resolution
# --------------------------------------------------------------------------- #


def test_the_default_component_model_is_the_historical_one() -> None:
    """A status-quo lock, not a product default for a successor model.

    Before scoping existed, an unpinned request took the latest succeeded run
    regardless of model, so the first successful successor run would silently
    redefine every default view and every un-pinned shared link. Changing this
    constant IS the rollout decision and is owned by the product owner.
    """

    assert component_model.DEFAULT_COMPONENT_MODEL == HISTORICAL
    assert component_model.resolve_requested_component_model(None) == HISTORICAL


def test_an_explicit_selector_is_honoured_and_an_unknown_one_is_refused() -> None:
    assert component_model.resolve_requested_component_model(SUCCESSOR) == SUCCESSOR
    with pytest.raises(component_model.UnknownComponentModelError):
        component_model.resolve_requested_component_model("zred")


# --------------------------------------------------------------------------- #
# Export serialization contract
# --------------------------------------------------------------------------- #


def test_historical_export_columns_keep_their_original_headers() -> None:
    assert component_model.export_component_columns(HISTORICAL) == [
        "zoning_score",
        "road_score",
        "equity_score",
        "demand_score",
    ]


def test_successor_export_columns_never_reuse_a_legacy_header() -> None:
    assert component_model.export_component_columns(SUCCESSOR) == SUCCESSOR_ORDER
    component_model.assert_export_columns_disjoint()  # must not raise
    assert not set(component_model.export_component_columns(HISTORICAL)) & set(
        component_model.export_component_columns(SUCCESSOR)
    )


# --------------------------------------------------------------------------- #
# Analysis-signature identity
# --------------------------------------------------------------------------- #


def test_the_historical_signature_payload_is_unchanged() -> None:
    """Adding model identity must not change a historical run's idempotency key.

    The signature identifies an unchanged build. If it moved, an identical
    historical rebuild would stop reusing the existing succeeded run and write a
    duplicate instead — a change to historical verification behaviour, not just to
    a label.
    """

    assert component_model.signature_identity(HISTORICAL) == {}


def test_a_non_historical_model_is_a_signed_signature_input() -> None:
    assert component_model.signature_identity(SUCCESSOR) == {
        "component_model_version": SUCCESSOR
    }


def test_an_unknown_model_cannot_contribute_to_a_signature() -> None:
    with pytest.raises(component_model.UnknownComponentModelError):
        component_model.signature_identity("suitability-components-imaginary-v9")


# --------------------------------------------------------------------------- #
# Vector-tile component properties
# --------------------------------------------------------------------------- #


def test_the_historical_tile_fragment_is_the_four_legacy_columns_verbatim() -> None:
    """A historical tile must stay byte-identical to what the map already caches."""

    assert component_model.tile_component_columns_sql(HISTORICAL) == (
        "        c.zoning_score::double precision AS zoning_score,\n"
        "        c.road_score::double precision AS road_score,\n"
        "        c.equity_score::double precision AS equity_score,\n"
        "        c.demand_score::double precision AS demand_score"
    )


def test_the_successor_tile_fragment_never_emits_a_legacy_property_name() -> None:
    fragment = component_model.tile_component_columns_sql(SUCCESSOR)
    for name in SUCCESSOR_ORDER:
        assert f"(c.component_scores ->> '{name}')::double precision AS {name}" in fragment
    for legacy in ("zoning_score", "road_score", "equity_score", "demand_score"):
        assert legacy not in fragment
