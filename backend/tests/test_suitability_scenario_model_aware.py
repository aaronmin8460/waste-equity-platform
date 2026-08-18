"""User-weight scenarios for the SUCCESSOR (V3) component model.

── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────
Page 4 and Page 5 must run on the V3 successor model. Two things blocked that, and
both are structural rather than behavioural, so they are pinned here without a
database:

1. **The model-support gate refused every non-historical model.** It refused on the
   stated ground that "no approved weight vector or normalization strategy exists"
   for the other model — a fact that was true when it was written and is not any
   more. The successor model now carries an approved ``baseline`` weight profile, a
   declared percentile normalization, an empty ``ACTIVATION_BLOCKERS`` tuple and no
   open Phase-4 decisions. The gate now asks that question directly instead of
   consulting a model allow-list that had drifted away from it.

2. **The scenario scoring SQL read the four legacy ``*_score`` columns.** A
   successor run leaves those NULL and stores its scores in ``component_scores``
   (models/suitability.py, docs/SUITABILITY_COMPONENT_MODEL_CONTRACT.md), so the
   query did not error — it silently matched ZERO rows, because every row failed the
   ``IS NOT NULL`` guards. Opening the gate alone would therefore have produced an
   empty V3 ranking that looked like a real "no candidates" answer.

── WHAT IS DELIBERATELY NOT TESTED HERE ────────────────────────────────────────
Real V3 numbers. No successor RUN exists in any database this tier can reach, and
fabricating one would be exactly the invented analytical result the whole component
-model contract exists to prevent. These tests pin the SQL and the gate; the
end-to-end numbers belong to the PostGIS integration tier once a successor run has
been built with ``successor.runtime.build_successor_run``.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_backend.analysis.suitability import component_model
from waste_equity_backend.analysis.suitability.successor import policy as successor_policy
from waste_equity_backend.api.routes.suitability_scenarios import (
    _approved_scenario_weight_profiles,
    _candidate_rank_sql,
    _preview_sql,
    _score_expressions,
    _tile_sql,
    _weight_params,
)

HISTORICAL = component_model.COMPONENT_MODEL_HISTORICAL
SUCCESSOR = component_model.COMPONENT_MODEL_SUCCESSOR
HISTORICAL_ORDER = list(component_model.COMPONENT_ORDER_HISTORICAL)
SUCCESSOR_ORDER = list(component_model.COMPONENT_ORDER_SUCCESSOR)


# --------------------------------------------------------------------------- #
# The model-support gate
# --------------------------------------------------------------------------- #


def test_the_successor_model_now_has_an_approved_weight_vector() -> None:
    """The premise the old allow-list refused on is no longer true.

    If this ever regresses to `None`, the gate below correctly closes again — which
    is the point of deriving support from the fact rather than from a list.
    """

    assert successor_policy.SUCCESSOR_WEIGHT_PROFILES
    assert successor_policy.SUCCESSOR_POLICY_VERSION is not None
    assert successor_policy.ACTIVATION_BLOCKERS == ()


def test_both_approved_models_are_supported_for_scenarios() -> None:
    assert _approved_scenario_weight_profiles(HISTORICAL) is not None
    assert _approved_scenario_weight_profiles(SUCCESSOR) is not None


@pytest.mark.parametrize(
    "unknown",
    ["", "suitability-components-v9", "successor", "zred", "suitability-components-zred-v2"],
)
def test_an_unknown_model_is_still_refused(unknown: str) -> None:
    """The gate is not "allow all strings" — an unregistered model has no vector."""

    assert _approved_scenario_weight_profiles(unknown) is None


def test_supporting_the_successor_does_not_change_the_production_default() -> None:
    """Scenario support and DEFAULT-run resolution are different decisions.

    Making a scenario recombinable for a model says nothing about which model an
    unpinned reader sees. Flipping that is the product owner's rollout decision.
    """

    assert component_model.DEFAULT_COMPONENT_MODEL == HISTORICAL


# --------------------------------------------------------------------------- #
# Where each model's component scores are read from
# --------------------------------------------------------------------------- #


def test_historical_expressions_are_the_frozen_constants_verbatim() -> None:
    """A historical run's emitted SQL cannot drift by a character."""

    from waste_equity_backend.api.routes import suitability_scenarios as routes

    score, prov_num, prov_den, _present = _score_expressions(HISTORICAL, HISTORICAL_ORDER)
    assert score == routes._RAW_SCORE_SQL
    assert prov_num == routes._PROV_NUM_SQL
    assert prov_den == routes._PROV_DEN_SQL


def test_successor_scoring_reads_component_scores_and_never_a_legacy_column() -> None:
    score, prov_num, prov_den, present = _score_expressions(SUCCESSOR, SUCCESSOR_ORDER)
    for component in SUCCESSOR_ORDER:
        assert f"component_scores ->> '{component}'" in score
    # The four legacy columns are NULL on a successor row. Reading one would make the
    # whole query match nothing — the silent failure this replaced.
    for legacy in HISTORICAL_ORDER:
        assert f"c.{legacy}_score" not in score
        assert f"c.{legacy}_score" not in prov_num
        assert f"c.{legacy}_score" not in prov_den
        assert f"c.{legacy}_score" not in present


def test_successor_component_order_is_the_registry_order() -> None:
    """Order is load-bearing for hashes and export columns; it comes from the run."""

    assert SUCCESSOR_ORDER == [
        "existing_burden",
        "air_impact_proxy",
        "resident_impact",
        "land_conversion",
    ]
    score, *_ = _score_expressions(SUCCESSOR, SUCCESSOR_ORDER)
    positions = [score.index(f"'{component}'") for component in SUCCESSOR_ORDER]
    assert positions == sorted(positions)


def test_the_two_namespaces_never_overlap() -> None:
    """A Z/R/E/D name must never be readable as a successor component, or vice versa."""

    assert set(HISTORICAL_ORDER).isdisjoint(SUCCESSOR_ORDER)


# --------------------------------------------------------------------------- #
# Missing components: absent, never zero
# --------------------------------------------------------------------------- #


def test_a_missing_successor_component_is_NULL_not_zero() -> None:
    """``->>`` yields NULL for an absent key, which the guards then exclude.

    The successor policy forbids ZERO_FILL outright: 0 is the BEST possible score for
    every lower-is-better component, so substituting it would systematically promote
    exactly the candidates with the least evidence.
    """

    assert "ZERO_FILL" in successor_policy.successor_snapshot()["missing_component_policy"][
        "forbidden"
    ]
    score, prov_num, prov_den, present = _score_expressions(SUCCESSOR, SUCCESSOR_ORDER)
    # ELIGIBLE ranking: a candidate missing any component is filtered OUT entirely
    # (STRICT_ALL_COMPONENTS_REQUIRED), never ranked with a substituted value.
    for component in SUCCESSOR_ORDER:
        assert f"(c.component_scores ->> '{component}')::numeric IS NOT NULL" in present
    # The provisional path renormalizes over the components actually present: a
    # missing one contributes to NEITHER the numerator nor the denominator.
    for component in SUCCESSOR_ORDER:
        assert f"coalesce((c.component_scores ->> '{component}')::numeric" in prov_num
        assert f"CASE WHEN (c.component_scores ->> '{component}')::numeric IS NOT NULL" in prov_den
    assert "0" in prov_den  # the ELSE branch contributes zero WEIGHT, not a zero SCORE
    assert score.count("*") == len(SUCCESSOR_ORDER)


# --------------------------------------------------------------------------- #
# Bound parameters
# --------------------------------------------------------------------------- #


def test_weight_parameter_names_match_the_generated_expressions() -> None:
    weights = {component: Decimal("0.25") for component in SUCCESSOR_ORDER}
    params = _weight_params(weights, SUCCESSOR)
    score, *_ = _score_expressions(SUCCESSOR, SUCCESSOR_ORDER)
    for name in params:
        assert f":{name}" in score


def test_historical_keeps_its_public_wz_wr_we_wd_parameter_names() -> None:
    """Those four names are also the scenario tile URL's public query parameters."""

    weights = {
        "zoning": Decimal("0.4"),
        "road": Decimal("0.3"),
        "equity": Decimal("0.2"),
        "demand": Decimal("0.1"),
    }
    assert set(_weight_params(weights)) == {"wz", "wr", "we", "wd"}
    assert set(_weight_params(weights, HISTORICAL)) == {"wz", "wr", "we", "wd"}


def test_no_component_value_is_ever_interpolated_as_a_literal() -> None:
    """Only placeholder NAMES are interpolated; every weight is a bound parameter."""

    score, *_ = _score_expressions(SUCCESSOR, SUCCESSOR_ORDER)
    assert "0.25" not in score
    assert ":w_existing_burden" in score


# --------------------------------------------------------------------------- #
# The three queries, built for the successor
# --------------------------------------------------------------------------- #


def test_all_three_successor_queries_read_component_scores() -> None:
    score, prov_num, prov_den, present = _score_expressions(SUCCESSOR, SUCCESSOR_ORDER)
    preview = _preview_sql("", score, present)
    rank = _candidate_rank_sql("", score, present)
    tile = _tile_sql("", score, prov_num, prov_den)
    for sql in (preview, rank, tile):
        assert "component_scores ->>" in sql
    # …and none of them still FILTERS or SCORES on a legacy column.
    assert "AND c.zoning_score IS NOT NULL" not in preview
    assert "AND c.zoning_score IS NOT NULL" not in rank


def test_the_successor_preview_still_ranks_within_the_scope() -> None:
    """The V3 transition must not cost the geographic-scope contract."""

    from waste_equity_backend.api.routes.suitability_scenarios import _scope_predicate

    scope_sql, params = _scope_predicate("KR-SGIS-31", [])
    score, _n, _d, present = _score_expressions(SUCCESSOR, SUCCESSOR_ORDER)
    sql = _preview_sql(scope_sql, score, present)
    assert params == {"scope_sido": "KR-SGIS-31"}
    assert sql.index(":scope_sido") < sql.index("row_number() OVER")
    assert sql.index(":scope_sido") < sql.index("count(*) OVER ()")


def test_the_historical_queries_are_untouched_by_all_of_this() -> None:
    """Legacy runs keep byte-identical SQL — no successor artefact anywhere in it."""

    score, prov_num, prov_den, present = _score_expressions(HISTORICAL, HISTORICAL_ORDER)
    for sql in (
        _preview_sql("", score, present),
        _candidate_rank_sql("", score, present),
        _tile_sql("", score, prov_num, prov_den),
    ):
        assert "component_scores ->>" not in sql
        assert "w_existing_burden" not in sql
