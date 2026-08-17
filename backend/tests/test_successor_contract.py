"""Successor component contract: availability, partiality, and normalization.

These tests pin the *shape* every successor component must produce — the
missing-is-never-zero rule, the deterministic percentile normalization, and the
disjointness of the successor and historical component namespaces.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_backend.analysis.suitability import policy as historical_policy
from waste_equity_backend.analysis.suitability.successor import contract
from waste_equity_backend.analysis.suitability.successor.contract import (
    ComponentObservation,
    ComponentSeries,
    SuccessorContractError,
)


def _available(unit: str, raw: str) -> ComponentObservation:
    return ComponentObservation(
        component=contract.COMPONENT_EXISTING_BURDEN,
        unit_key=unit,
        raw_value=Decimal(raw),
        raw_unit="kg/인/년",
    )


def _unavailable(unit: str, reason: str) -> ComponentObservation:
    return ComponentObservation(
        component=contract.COMPONENT_EXISTING_BURDEN,
        unit_key=unit,
        raw_value=None,
        raw_unit="kg/인/년",
        unavailable_reasons=(reason,),
    )


# --------------------------------------------------------------------------- #
# Namespace
# --------------------------------------------------------------------------- #


def test_successor_components_are_the_four_named_factors() -> None:
    assert contract.SUCCESSOR_COMPONENTS == (
        "existing_burden",
        "air_impact_proxy",
        "resident_impact",
        "land_conversion",
    )


def test_successor_and_historical_component_namespaces_are_disjoint() -> None:
    assert not set(contract.SUCCESSOR_COMPONENTS) & set(historical_policy.COMPONENTS)


def test_observation_rejects_a_component_outside_the_successor_namespace() -> None:
    with pytest.raises(SuccessorContractError):
        ComponentObservation(
            component="equity",  # a historical component name
            unit_key="KR-SGIS-11110",
            raw_value=Decimal("1"),
            raw_unit="kg/인/년",
        )


# --------------------------------------------------------------------------- #
# Availability invariants
# --------------------------------------------------------------------------- #


def test_an_absent_value_must_carry_a_reason_code() -> None:
    with pytest.raises(SuccessorContractError):
        ComponentObservation(
            component=contract.COMPONENT_EXISTING_BURDEN,
            unit_key="KR-SGIS-11110",
            raw_value=None,
            raw_unit="kg/인/년",
        )


def test_an_observation_cannot_be_available_and_unavailable_at_once() -> None:
    with pytest.raises(SuccessorContractError):
        ComponentObservation(
            component=contract.COMPONENT_EXISTING_BURDEN,
            unit_key="KR-SGIS-11110",
            raw_value=Decimal("1"),
            raw_unit="kg/인/년",
            unavailable_reasons=(contract.REASON_MISSING_POPULATION,),
        )


def test_a_partial_observation_must_name_why() -> None:
    with pytest.raises(SuccessorContractError):
        ComponentObservation(
            component=contract.COMPONENT_EXISTING_BURDEN,
            unit_key="KR-SGIS-11110",
            raw_value=Decimal("1"),
            raw_unit="kg/인/년",
            is_partial=True,
        )


def test_unavailable_units_are_absent_from_scores_never_zero_filled() -> None:
    series = contract.build_series(
        component=contract.COMPONENT_EXISTING_BURDEN,
        method_version="successor-existing-burden-v1",
        direction=contract.LOWER_RAW_IS_BETTER,
        raw_unit="kg/인/년",
        observations=[
            _available("A", "10"),
            _available("B", "20"),
            _unavailable("C", contract.REASON_MISSING_POPULATION),
        ],
    )
    scores = series.normalized_scores()
    assert set(scores) == {"A", "B"}
    assert "C" not in scores
    assert series.unavailable_reason_counts() == {contract.REASON_MISSING_POPULATION: 1}


# --------------------------------------------------------------------------- #
# Normalization
# --------------------------------------------------------------------------- #


def test_lower_raw_is_better_inverts_the_percentile() -> None:
    scores = contract.normalize_raw_values(
        {"low": Decimal("1"), "mid": Decimal("5"), "high": Decimal("9")},
        contract.LOWER_RAW_IS_BETTER,
    )
    assert scores["low"] == Decimal("100.0000")
    assert scores["high"] == Decimal("0.0000")
    assert scores["low"] > scores["mid"] > scores["high"]


def test_higher_raw_is_better_uses_the_percentile_directly() -> None:
    scores = contract.normalize_raw_values(
        {"low": Decimal("1"), "high": Decimal("9")},
        contract.HIGHER_RAW_IS_BETTER,
    )
    assert scores["high"] == Decimal("100.0000")
    assert scores["low"] == Decimal("0.0000")


def test_ties_share_a_score() -> None:
    scores = contract.normalize_raw_values(
        {"a": Decimal("4"), "b": Decimal("4"), "c": Decimal("9")},
        contract.LOWER_RAW_IS_BETTER,
    )
    assert scores["a"] == scores["b"]
    assert scores["a"] > scores["c"]


def test_a_single_observation_is_the_neutral_midpoint() -> None:
    scores = contract.normalize_raw_values({"only": Decimal("42")}, contract.LOWER_RAW_IS_BETTER)
    assert scores["only"] == Decimal("50.0000")


def test_scores_sit_on_the_historical_zero_to_hundred_four_dp_scale() -> None:
    scores = contract.normalize_raw_values(
        {f"u{i}": Decimal(i) for i in range(7)}, contract.LOWER_RAW_IS_BETTER
    )
    for score in scores.values():
        assert Decimal("0") <= score <= Decimal("100")
        assert score == score.quantize(Decimal("0.0001"))


def test_normalization_reuses_the_project_percentile_convention() -> None:
    values = {"a": Decimal("1"), "b": Decimal("2"), "c": Decimal("2"), "d": Decimal("8")}
    series = contract.build_series(
        component=contract.COMPONENT_EXISTING_BURDEN,
        method_version="successor-existing-burden-v1",
        direction=contract.LOWER_RAW_IS_BETTER,
        raw_unit="kg/인/년",
        observations=[_available(k, format(v, "f")) for k, v in values.items()],
    )
    assert series.percentile_ranks() == historical_policy.percentile_ranks(values)


def test_unknown_direction_is_rejected() -> None:
    with pytest.raises(SuccessorContractError):
        contract.score_from_percentile(Decimal("0.5"), "SOMETIMES_BETTER")


def test_a_series_must_declare_a_known_normalization_strategy() -> None:
    with pytest.raises(SuccessorContractError):
        contract.build_series(
            component=contract.COMPONENT_LAND_CONVERSION,
            method_version="successor-land-conversion-v1",
            direction=contract.LOWER_RAW_IS_BETTER,
            raw_unit="share_of_denominator_area",
            observations=[],
            normalization_strategy="EYEBALL",
        )


def test_the_two_strategies_disagree_and_the_series_reports_which_it_used() -> None:
    observations = [
        ComponentObservation(
            component=contract.COMPONENT_LAND_CONVERSION,
            unit_key=key,
            raw_value=Decimal(raw),
            raw_unit="share_of_denominator_area",
        )
        for key, raw in (("a", "0.1"), ("b", "0.2"), ("c", "0.9"))
    ]

    def _series(strategy: str) -> ComponentSeries:
        return contract.build_series(
            component=contract.COMPONENT_LAND_CONVERSION,
            method_version="successor-land-conversion-v1",
            direction=contract.LOWER_RAW_IS_BETTER,
            raw_unit="share_of_denominator_area",
            observations=observations,
            normalization_strategy=strategy,
        )

    ranked = _series(contract.NORMALIZATION_PERCENTILE_RANK)
    direct = _series(contract.NORMALIZATION_BOUNDED_RATIO)
    # Percentile rank spreads the three units to 100 / 50 / 0 regardless of how
    # close the raw values are; the bounded ratio keeps the raw spacing.
    assert ranked.normalized_scores() == {
        "a": Decimal("100.0000"),
        "b": Decimal("50.0000"),
        "c": Decimal("0.0000"),
    }
    assert direct.normalized_scores() == {
        "a": Decimal("90.0000"),
        "b": Decimal("80.0000"),
        "c": Decimal("10.0000"),
    }
    assert ranked.sanitized_summary()["normalization_strategy"] == "PERCENTILE_RANK"
    assert direct.sanitized_summary()["normalization_strategy"] == "BOUNDED_RATIO"


# --------------------------------------------------------------------------- #
# Determinism
# --------------------------------------------------------------------------- #


def test_series_order_does_not_change_the_result() -> None:
    observations = [_available("c", "3"), _available("a", "1"), _available("b", "2")]
    first = contract.build_series(
        component=contract.COMPONENT_EXISTING_BURDEN,
        method_version="successor-existing-burden-v1",
        direction=contract.LOWER_RAW_IS_BETTER,
        raw_unit="kg/인/년",
        observations=observations,
    )
    second = contract.build_series(
        component=contract.COMPONENT_EXISTING_BURDEN,
        method_version="successor-existing-burden-v1",
        direction=contract.LOWER_RAW_IS_BETTER,
        raw_unit="kg/인/년",
        observations=list(reversed(observations)),
    )
    assert first.sanitized_summary() == second.sanitized_summary()
    assert [o.unit_key for o in first.observations] == ["a", "b", "c"]


def test_duplicate_units_in_one_series_are_rejected() -> None:
    with pytest.raises(SuccessorContractError):
        ComponentSeries(
            component=contract.COMPONENT_EXISTING_BURDEN,
            method_version="successor-existing-burden-v1",
            direction=contract.LOWER_RAW_IS_BETTER,
            raw_unit="kg/인/년",
            observations=(_available("a", "1"), _available("a", "2")),
        )


def test_summary_serializes_exact_decimal_strings() -> None:
    series = contract.build_series(
        component=contract.COMPONENT_EXISTING_BURDEN,
        method_version="successor-existing-burden-v1",
        direction=contract.LOWER_RAW_IS_BETTER,
        raw_unit="kg/인/년",
        observations=[_available("a", "1.5"), _available("b", "2.5")],
    )
    summary = series.sanitized_summary()
    assert summary["scores"] == {"a": "100.0000", "b": "0.0000"}
    assert all(isinstance(value, str) for value in summary["scores"].values())
