"""Pure tests for the suitability screening policy registry (Phase 5.4)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_backend.analysis.suitability import policy


def test_weight_profiles_sum_to_one() -> None:
    for name, weights in policy.WEIGHT_PROFILES.items():
        assert set(weights) == set(policy.COMPONENTS), name
        assert sum(weights.values()) == Decimal("1"), name


def test_expected_profiles_present() -> None:
    assert set(policy.WEIGHT_PROFILES) == {
        "baseline",
        "equal",
        "equity_focused",
        "access_focused",
    }
    assert policy.WEIGHT_PROFILES["baseline"] == {
        "zoning": Decimal("0.35"),
        "road": Decimal("0.25"),
        "equity": Decimal("0.25"),
        "demand": Decimal("0.15"),
    }


def test_validate_policy_passes() -> None:
    policy.validate_policy()  # raises on any inconsistency


def test_hard_and_review_codes_disjoint() -> None:
    hard = set(policy.PROTECTED_HARD_CODES) | set(policy.ZONING_HARD_CODES)
    assert hard.isdisjoint(policy.REVIEW_PROTECTED_CODES)


def test_zoning_registry_completeness_and_bounds() -> None:
    for code, rule in policy.ZONING_REGISTRY.items():
        assert rule.code == code
        if rule.status_effect == "ELIGIBLE_WITH_PENALTY":
            assert rule.score is not None
            assert Decimal("0") <= rule.score <= Decimal("100")
        if rule.status_effect == "REVIEW_REQUIRED":
            assert rule.review_reason is not None
    # UQ114 is a hard exclusion; UQ111 is review; UQ112/UQ113 are scored.
    assert policy.ZONING_REGISTRY["UQ114"].status_effect == "HARD_EXCLUSION"
    assert policy.ZONING_REGISTRY["UQ111"].status_effect == "REVIEW_REQUIRED"
    assert policy.ZONING_REGISTRY["UQ112"].score == Decimal("55")
    assert policy.ZONING_REGISTRY["UQ113"].score == Decimal("25")
    # No industrial high-compatibility class exists in v1.
    assert (
        max(r.score for r in policy.ZONING_REGISTRY.values() if r.score is not None)
        == policy.MAX_V1_ZONING_SCORE
    )


@pytest.mark.parametrize(
    "distance,expected",
    [
        (Decimal("0"), Decimal("100")),
        (Decimal("250"), Decimal("100")),
        (Decimal("625"), Decimal("85")),  # midpoint 250-1000 -> 85
        (Decimal("1000"), Decimal("70")),
        (Decimal("2000"), Decimal("45")),  # midpoint 1000-3000 -> 45
        (Decimal("3000"), Decimal("20")),
        (Decimal("4000"), Decimal("10")),  # midpoint 3000-5000 -> 10
        (Decimal("5000"), Decimal("0")),
        (Decimal("9999"), Decimal("0")),
    ],
)
def test_road_score_curve(distance: Decimal, expected: Decimal) -> None:
    assert policy.road_score(distance) == expected


def test_road_score_bounds() -> None:
    for d in range(0, 6000, 137):
        s = policy.road_score(Decimal(d))
        assert Decimal("0") <= s <= Decimal("100")


def test_percentile_ranks_deterministic_and_bounded() -> None:
    values = {"a": Decimal("10"), "b": Decimal("20"), "c": Decimal("30"), "d": Decimal("20")}
    ranks = policy.percentile_ranks(values)
    assert ranks["a"] == Decimal("0")  # minimum
    assert ranks["c"] == Decimal("1")  # maximum
    assert ranks["b"] == ranks["d"]  # ties share a rank
    for r in ranks.values():
        assert Decimal("0") <= r <= Decimal("1")
    # single value -> neutral 0.5
    assert policy.percentile_ranks({"x": Decimal("5")}) == {"x": Decimal("0.5")}
    assert policy.percentile_ranks({}) == {}


def test_equity_and_demand_direction() -> None:
    # lower burden (lower percentile) -> higher equity score
    assert policy.equity_score_from_rank(Decimal("0")) == Decimal("100")
    assert policy.equity_score_from_rank(Decimal("1")) == Decimal("0")
    # higher demand (higher percentile) -> higher demand score
    assert policy.demand_score_from_rank(Decimal("1")) == Decimal("100")
    assert policy.demand_score_from_rank(Decimal("0")) == Decimal("0")


def test_composite_exact_arithmetic() -> None:
    scores = {
        "zoning": Decimal("55"),
        "road": Decimal("100"),
        "equity": Decimal("100"),
        "demand": Decimal("0"),
    }
    assert policy.composite(scores, "baseline") == Decimal("69.2500")
    assert policy.composite(scores, "equal") == Decimal("63.7500")
    assert policy.composite(scores, "access_focused") == Decimal("73.7500")
    assert policy.composite(scores, "equity_focused") == Decimal("71.5000")


def test_composite_bounded() -> None:
    full = dict.fromkeys(policy.COMPONENTS, Decimal("100"))
    zero = dict.fromkeys(policy.COMPONENTS, Decimal("0"))
    for prof in policy.WEIGHT_PROFILES:
        assert policy.composite(full, prof) == Decimal("100.0000")
        assert policy.composite(zero, prof) == Decimal("0.0000")


def test_provisional_composite_renormalizes() -> None:
    # only road + equity present; renormalize over their weights
    present = {"road": Decimal("80"), "equity": Decimal("40")}
    pv = policy.provisional_composite(present, "baseline")
    # baseline road=0.25, equity=0.25 -> equal renorm -> (80+40)/2 = 60
    assert pv == Decimal("60.0000")
    assert policy.provisional_composite({}, "baseline") is None


def test_quantize_score_clamps_and_rounds() -> None:
    assert policy.quantize_score(Decimal("150")) == Decimal("100.0000")
    assert policy.quantize_score(Decimal("-5")) == Decimal("0.0000")
    assert policy.quantize_score(Decimal("12.34565")) == Decimal("12.3456")  # ROUND_HALF_EVEN


def test_policy_snapshot_serializable() -> None:
    snap = policy.policy_snapshot()
    assert snap["policy_version"] == policy.POLICY_VERSION
    assert snap["candidate_grid_version"] == policy.CANDIDATE_GRID_VERSION
    assert set(snap["weight_profiles"]) == set(policy.WEIGHT_PROFILES)
    assert "UD801" in snap["hard_exclusion_codes"]
    assert "not legal eligibility" in snap["disclaimer"]
