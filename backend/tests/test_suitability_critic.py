"""Focused unit tests for the CRITIC data-derived weight computation.

Pure Decimal math, no DB. Covers hand-verifiable weights, invariants (sum to 1,
bounded), determinism/permutation-invariance, zero-variance handling, the lone
informative criterion, N<2 / all-zero-information failures, missing-component
rejection, and correlation/redundancy behavior. See
``docs/SUITABILITY_CRITIC_STABILITY.md``.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_backend.analysis.suitability import critic


def _row(z: str, r: str, e: str, d: str) -> dict[str, Decimal]:
    return {"zoning": Decimal(z), "road": Decimal(r), "equity": Decimal(e), "demand": Decimal(d)}


def test_known_matrix_hand_verified_weights() -> None:
    # Two criteria vary and are perfectly negatively correlated (r = -1); the other
    # two are constant. Hand derivation (normalize by /100):
    #   zoning: values {0,1}, mean 0.5, sigma 0.5
    #   road:   values {1,0}, mean 0.5, sigma 0.5
    #   equity/demand constant -> sigma 0
    #   r(zoning,road) = -1
    #   C_zoning = 0.5 * (1 - (-1)) = 1.0 ; C_road = 1.0 ; C_equity = C_demand = 0
    #   weights = 0.5, 0.5, 0, 0
    rows = [_row("0", "100", "50", "50"), _row("100", "0", "50", "50")]
    result = critic.compute_critic_weights(rows)
    assert result.weights_as_strings() == {
        "zoning": "0.50000000",
        "road": "0.50000000",
        "equity": "0.00000000",
        "demand": "0.00000000",
    }
    assert result.zero_variance_criteria == ["equity", "demand"]
    assert result.correlation_matrix["zoning"]["road"] == Decimal("-1")
    # correlation with a constant criterion is undefined (None)
    assert result.correlation_matrix["zoning"]["equity"] is None
    # serialized weights are fixed-point 8dp strings, never exponent form
    assert result.metadata(method_version="v")["weights"]["equity"] == "0.00000000"


def test_weights_sum_exactly_one_and_bounded() -> None:
    rows = [
        _row("10", "80", "30", "90"),
        _row("55", "20", "60", "40"),
        _row("25", "70", "0", "100"),
        _row("55", "100", "100", "0"),
        _row("25", "45", "50", "50"),
    ]
    result = critic.compute_critic_weights(rows)
    assert sum(result.weights.values()) == Decimal("1")
    for w in result.weights.values():
        assert Decimal("0") <= w <= Decimal("1")
    # at least 8 decimal places of precision exposed
    for s in result.weights_as_strings().values():
        assert len(s.split(".")[1]) >= 8


def test_identical_input_is_deterministic() -> None:
    rows = [
        _row("10", "80", "30", "90"),
        _row("55", "20", "60", "40"),
        _row("25", "70", "0", "100"),
    ]
    a = critic.compute_critic_weights(rows)
    b = critic.compute_critic_weights([dict(r) for r in rows])
    assert a.weights_as_strings() == b.weights_as_strings()
    assert a.metadata(method_version="critic-weights-v1") == b.metadata(
        method_version="critic-weights-v1"
    )


def test_row_permutation_does_not_change_output() -> None:
    rows = [
        _row("10", "80", "30", "90"),
        _row("55", "20", "60", "40"),
        _row("25", "70", "0", "100"),
    ]
    base = critic.compute_critic_weights(rows)
    shuffled = critic.compute_critic_weights(list(reversed(rows)))
    assert base.metadata(method_version="v") == shuffled.metadata(method_version="v")


def test_zero_variance_criterion_gets_weight_zero() -> None:
    # demand constant -> weight 0, listed in zero_variance_criteria, excluded from
    # correlation-conflict sums (its correlations are None).
    rows = [_row("10", "80", "30", "50"), _row("55", "20", "60", "50"), _row("25", "70", "0", "50")]
    result = critic.compute_critic_weights(rows)
    assert result.weights["demand"] == Decimal("0.00000000")
    assert "demand" in result.zero_variance_criteria
    assert result.correlation_matrix["demand"]["zoning"] is None
    assert result.information_values["demand"] == Decimal("0E-10")


def test_single_informative_criterion_gets_weight_one() -> None:
    # only zoning varies; the three constants receive weight 0.
    rows = [_row("0", "50", "50", "50"), _row("100", "50", "50", "50")]
    result = critic.compute_critic_weights(rows)
    assert result.weights["zoning"] == Decimal("1.00000000")
    assert result.weights["road"] == Decimal("0.00000000")
    assert result.weights["equity"] == Decimal("0.00000000")
    assert result.weights["demand"] == Decimal("0.00000000")
    assert set(result.zero_variance_criteria) == {"road", "equity", "demand"}


def test_n_less_than_two_raises_critic_undefined() -> None:
    with pytest.raises(critic.CriticUndefinedError) as exc:
        critic.compute_critic_weights([_row("10", "20", "30", "40")])
    assert exc.value.category == "CRITIC_UNDEFINED"
    with pytest.raises(critic.CriticUndefinedError):
        critic.compute_critic_weights([])


def test_all_constant_matrix_raises_critic_undefined() -> None:
    rows = [
        _row("50", "50", "50", "50"),
        _row("50", "50", "50", "50"),
        _row("50", "50", "50", "50"),
    ]
    with pytest.raises(critic.CriticUndefinedError) as exc:
        critic.compute_critic_weights(rows)
    assert exc.value.category == "CRITIC_UNDEFINED"


def test_perfectly_redundant_varying_criteria_raise_critic_undefined() -> None:
    # two criteria vary but are perfectly correlated (r = 1) -> zero conflict info.
    rows = [_row("0", "0", "50", "50"), _row("100", "100", "50", "50")]
    with pytest.raises(critic.CriticUndefinedError):
        critic.compute_critic_weights(rows)


def test_missing_component_is_rejected_not_zero_filled() -> None:
    # A row missing a component raises (KeyError) rather than being treated as 0.
    rows = [
        {"zoning": Decimal("10"), "road": Decimal("20"), "equity": Decimal("30")},
        _row("55", "20", "60", "40"),
    ]
    with pytest.raises(KeyError):
        critic.compute_critic_weights(rows)  # type: ignore[arg-type]


def test_negative_correlation_increases_conflict_information() -> None:
    # Four criteria of equal dispersion: road is negatively correlated with the
    # other two varying criteria (zoning, equity) while zoning and equity are
    # positively correlated (redundant) with each other. Road therefore accumulates
    # the largest conflict (1 - r) sum and carries the most information. (N>2 is
    # required — with only 2 points any two varying criteria are perfectly
    # correlated, which is a documented CRITIC_UNDEFINED degeneracy.)
    #   zoning = [0,40,60,100], road = 100 - zoning (r = -1 with zoning),
    #   equity = zoning (r = +1 with zoning), demand constant.
    result = critic.compute_critic_weights(
        [
            _row("0", "100", "0", "50"),
            _row("40", "60", "40", "50"),
            _row("60", "40", "60", "50"),
            _row("100", "0", "100", "50"),
        ]
    )
    assert result.information_values["road"] > result.information_values["zoning"]
    assert result.information_values["road"] > result.information_values["equity"]
    # zoning and equity are identical columns -> identical information.
    assert result.information_values["zoning"] == result.information_values["equity"]


def test_redundant_criteria_produce_lower_relative_information() -> None:
    # zoning & road strongly redundant (near-identical), equity independent. The
    # redundant pair should carry lower per-criterion information than equity.
    rows = [
        _row("0", "0", "100", "50"),
        _row("50", "50", "0", "50"),
        _row("100", "100", "50", "50"),
        _row("25", "25", "75", "50"),
    ]
    result = critic.compute_critic_weights(rows)
    # equity is non-redundant with the zoning/road pair -> higher information than
    # either redundant member.
    assert result.information_values["equity"] > result.information_values["zoning"]
    assert result.information_values["equity"] > result.information_values["road"]
