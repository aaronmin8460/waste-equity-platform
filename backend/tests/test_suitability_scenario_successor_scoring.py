"""Candidate detail on a SUCCESSOR run — two more model-blind spots, closed.

``db57b06`` closed five places that still assumed the historical
``zoning``/``road``/``equity``/``demand`` namespace. Running Page 5's candidate
detail against the real local V3 run (run 48) found two more on the SAME path,
both invisible to a synthetic fixture for the same reason as before: a fixture
never carries a run whose scores live in ``component_scores`` rather than in the
four legacy columns.

6. ``_component_decimals`` indexed ``row[f"{c}_score"]`` unconditionally. A
   successor run has no ``existing_burden_score`` COLUMN, so every real V3
   candidate detail raised ``NoSuchColumnError`` → HTTP 500.

7. With that fixed, ``scenario.scenario_score`` delegated to ``policy.composite``,
   which sums over ``policy.COMPONENTS`` — the historical four — and so raised
   ``KeyError: 'zoning'`` → HTTP 500 again. Its provisional twin failed more
   quietly: ``policy.provisional_composite`` selects present components with
   ``for c in policy.COMPONENTS``, finds none on a successor run, and returns
   ``None``, i.e. a silently blank score rather than a crash.

THE HISTORICAL PATH IS UNCHANGED, which is what the first class below pins: the
policy functions the engine uses to write stored composites were not loosened, and
the historical four still travel through them.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_backend.analysis.suitability import policy, scenario

HISTORICAL_SCORES = {
    "zoning": Decimal("80.0000"),
    "road": Decimal("70.0000"),
    "equity": Decimal("60.0000"),
    "demand": Decimal("50.0000"),
}
HISTORICAL_WEIGHTS = {
    "zoning": Decimal("0.40"),
    "road": Decimal("0.30"),
    "equity": Decimal("0.20"),
    "demand": Decimal("0.10"),
}

SUCCESSOR_SCORES = {
    "existing_burden": Decimal("61.0558"),
    "air_impact_proxy": Decimal("42.1200"),
    "resident_impact": Decimal("77.5000"),
    "land_conversion": Decimal("33.3300"),
}
SUCCESSOR_WEIGHTS = {
    "existing_burden": Decimal("0.25"),
    "air_impact_proxy": Decimal("0.25"),
    "resident_impact": Decimal("0.25"),
    "land_conversion": Decimal("0.25"),
}


class TestHistoricalIsByteIdentical:
    def test_composite_still_goes_through_policy_unchanged(self) -> None:
        assert scenario.scenario_score(HISTORICAL_SCORES, HISTORICAL_WEIGHTS) == policy.composite(
            dict(HISTORICAL_SCORES), dict(HISTORICAL_WEIGHTS)
        )

    def test_provisional_still_goes_through_policy_unchanged(self) -> None:
        partial = {"zoning": Decimal("80.0000"), "road": Decimal("70.0000")}
        assert scenario.scenario_provisional_score(
            partial, HISTORICAL_WEIGHTS
        ) == policy.provisional_composite(dict(partial), dict(HISTORICAL_WEIGHTS))

    def test_policy_components_are_still_the_historical_four(self) -> None:
        # The engine's own scoring surface was NOT widened to accommodate V3.
        assert policy.COMPONENTS == ("zoning", "road", "equity", "demand")


class TestSuccessorScoring:
    def test_scores_a_successor_run_instead_of_raising_KeyError(self) -> None:
        # Defect 7: this raised KeyError: 'zoning' and surfaced as a 500.
        got = scenario.scenario_score(SUCCESSOR_SCORES, SUCCESSOR_WEIGHTS)
        expected = sum(
            (SUCCESSOR_SCORES[c] * SUCCESSOR_WEIGHTS[c] for c in SUCCESSOR_SCORES),
            start=Decimal("0"),
        )
        assert got == policy.quantize_score(expected)

    def test_matches_the_real_run_48_head_score(self) -> None:
        # The baseline capital-region head cell, from the local V3 QA database.
        real = {
            "existing_burden": Decimal("57.9107"),
            "air_impact_proxy": Decimal("60.0000"),
            "resident_impact": Decimal("100.0000"),
            "land_conversion": Decimal("26.3125"),
        }
        assert scenario.scenario_score(real, SUCCESSOR_WEIGHTS) == Decimal("61.0558")

    def test_provisional_renormalises_over_the_successor_components_present(self) -> None:
        # Defect 7's quiet half: this returned None, blanking the provisional score.
        partial = {
            "existing_burden": Decimal("60.0000"),
            "resident_impact": Decimal("80.0000"),
        }
        got = scenario.scenario_provisional_score(partial, SUCCESSOR_WEIGHTS)
        assert got is not None
        # Renormalised over the two present halves — never zero-filled to 35.
        assert got == Decimal("70.0000")

    def test_provisional_is_None_when_nothing_is_present(self) -> None:
        assert scenario.scenario_provisional_score({}, SUCCESSOR_WEIGHTS) is None


class TestComponentDecimalsReadsTheRunsOwnStorage:
    """``_component_decimals`` — defect 6, the ``NoSuchColumnError`` itself."""

    @staticmethod
    def _routes():
        from waste_equity_backend.api.routes import suitability_scenarios

        return suitability_scenarios

    def test_historical_run_reads_the_legacy_columns(self) -> None:
        routes = self._routes()
        row = {f"{c}_score": HISTORICAL_SCORES[c] for c in HISTORICAL_SCORES}
        got = routes._component_decimals(
            row, list(HISTORICAL_SCORES), "suitability-components-zred-v1"
        )
        assert got == HISTORICAL_SCORES

    def test_successor_run_reads_component_scores_and_never_a_legacy_column(self) -> None:
        routes = self._routes()
        # A row shaped like a real successor candidate: the JSONB map, and NO
        # `existing_burden_score` column at all. Indexing one would KeyError here,
        # which is exactly what the 500 was.
        row = {"component_scores": {c: str(v) for c, v in SUCCESSOR_SCORES.items()}}
        got = routes._component_decimals(
            row, list(SUCCESSOR_SCORES), "suitability-components-successor-v1"
        )
        assert got == SUCCESSOR_SCORES

    def test_a_missing_successor_component_stays_ABSENT_not_zero(self) -> None:
        routes = self._routes()
        row = {"component_scores": {"existing_burden": "61.0558"}}
        got = routes._component_decimals(
            row, list(SUCCESSOR_SCORES), "suitability-components-successor-v1"
        )
        # ZERO_FILL is forbidden by the successor policy: the caller's
        # `all_present` check must be able to see the component is missing.
        assert got == {"existing_burden": Decimal("61.0558")}
        assert "air_impact_proxy" not in got

    def test_a_successor_row_with_no_map_at_all_yields_nothing(self) -> None:
        routes = self._routes()
        got = routes._component_decimals(
            {"component_scores": None},
            list(SUCCESSOR_SCORES),
            "suitability-components-successor-v1",
        )
        assert got == {}


@pytest.mark.parametrize(
    "weights",
    [SUCCESSOR_WEIGHTS, {**SUCCESSOR_WEIGHTS, "resident_impact": Decimal("0.40")}],
)
def test_successor_scoring_is_deterministic(weights: dict[str, Decimal]) -> None:
    first = scenario.scenario_score(SUCCESSOR_SCORES, weights)
    second = scenario.scenario_score(dict(reversed(list(SUCCESSOR_SCORES.items()))), weights)
    # Decimal addition is exact, so component order cannot shift the result.
    assert first == second
