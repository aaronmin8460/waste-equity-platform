"""Pure tests for the suitability screening policy registry (Phase 5.4)."""

from __future__ import annotations

import random
import time
from decimal import ROUND_HALF_EVEN, Decimal

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


# --------------------------------------------------------------------------- #
# B18 — percentile_ranks is O(n log n), and provably the same function
#
# The historical definition ranks 79 SIGUNGU; a candidate-level successor
# component ranks 47,893 cells, where the original per-key linear scan cost 267
# seconds per call. The implementation was replaced with a bisect over the sorted
# values. Because this function feeds the historical equity/demand scores on every
# stored run, "faster" is only acceptable if it is also *identical* — so the
# original body is kept here verbatim as the oracle and the two are compared
# directly rather than against hand-written expectations.
# --------------------------------------------------------------------------- #


def _original_percentile_ranks(values: dict[str, Decimal]) -> dict[str, Decimal]:
    """The pre-B18 O(n²) body, verbatim. The oracle, not a reimplementation."""

    n = len(values)
    if n == 0:
        return {}
    if n == 1:
        return {k: Decimal("0.5") for k in values}
    ordered = sorted(values.values())
    ranks: dict[str, Decimal] = {}
    denom = Decimal(n - 1)
    for key, v in values.items():
        less = sum(1 for other in ordered if other < v)
        ranks[key] = (Decimal(less) / denom).quantize(Decimal("0.000001"), rounding=ROUND_HALF_EVEN)
    return ranks


@pytest.mark.parametrize(
    ("label", "values"),
    [
        ("empty", {}),
        ("singleton", {"a": Decimal("42")}),
        ("two distinct", {"a": Decimal("1"), "b": Decimal("2")}),
        ("all identical", {k: Decimal("5") for k in "abcdef"}),
        ("two-way tie at the bottom", {"a": Decimal("1"), "b": Decimal("1"), "c": Decimal("9")}),
        ("two-way tie at the top", {"a": Decimal("1"), "b": Decimal("9"), "c": Decimal("9")}),
        ("negatives", {"a": Decimal("-5"), "b": Decimal("0"), "c": Decimal("5")}),
        ("all negative", {"a": Decimal("-5"), "b": Decimal("-3"), "c": Decimal("-1")}),
        (
            # Equal numeric value, different Decimal exponents. Both bisect and the
            # original scan compare numerically, and Decimal hashes by value, so the
            # per-value cache must not split these into different ranks.
            "mixed exponents of equal values",
            {"a": Decimal("1.0"), "b": Decimal("1.00"), "c": Decimal("1"), "d": Decimal("2")},
        ),
        (
            "high precision neighbours",
            {
                "a": Decimal("0.1000000000000000001"),
                "b": Decimal("0.1000000000000000002"),
                "c": Decimal("0.1000000000000000003"),
            },
        ),
        (
            # A rank that lands mid-quantum, exercising ROUND_HALF_EVEN at 6 dp.
            "seven values forcing a repeating rank",
            {f"k{i}": Decimal(i) for i in range(7)},
        ),
        ("zeros and positives", {"a": Decimal("0"), "b": Decimal("0"), "c": Decimal("0.0001")}),
    ],
)
def test_percentile_ranks_is_identical_to_the_original_implementation(
    label: str, values: dict[str, Decimal]
) -> None:
    assert policy.percentile_ranks(values) == _original_percentile_ranks(values), label


def test_percentile_ranks_matches_the_original_on_a_large_tied_population() -> None:
    # Deterministic pseudo-random with heavy tie mass — the shape the real
    # components actually have — at a size the original can still be run at.
    rng = random.Random(20260817)
    values = {f"k{i}": Decimal(rng.randint(0, 60)) / Decimal(7) for i in range(1500)}

    assert policy.percentile_ranks(values) == _original_percentile_ranks(values)


def test_percentile_ranks_preserves_the_documented_properties() -> None:
    values = {"lo": Decimal("1"), "mid": Decimal("5"), "hi": Decimal("9")}
    ranks = policy.percentile_ranks(values)

    assert ranks["lo"] == Decimal("0.000000")
    assert ranks["hi"] == Decimal("1.000000")
    assert all(Decimal(0) <= r <= Decimal(1) for r in ranks.values())
    # Ties share a rank; a key with no value is absent rather than zero-filled.
    assert policy.percentile_ranks({"a": Decimal("3"), "b": Decimal("3")}) == {
        "a": Decimal("0.000000"),
        "b": Decimal("0.000000"),
    }
    assert "missing" not in policy.percentile_ranks(values)


def test_percentile_ranks_ignores_insertion_order() -> None:
    forward = {"a": Decimal("3"), "b": Decimal("1"), "c": Decimal("2")}
    reverse = {"c": Decimal("2"), "b": Decimal("1"), "a": Decimal("3")}

    assert policy.percentile_ranks(forward) == policy.percentile_ranks(reverse)


def test_percentile_ranks_is_no_longer_quadratic() -> None:
    # A behavioural guard on the complexity itself: the original needed ~267 s at
    # 47,893 values. Doubling n must not quadruple the work. Generous bounds keep
    # this from flaking on a loaded machine while still failing an O(n²) body,
    # which would need minutes here rather than milliseconds.
    values = {f"k{i}": Decimal(i % 5000) for i in range(40_000)}

    started = time.perf_counter()
    ranks = policy.percentile_ranks(values)
    elapsed = time.perf_counter() - started

    assert len(ranks) == 40_000
    assert elapsed < 30, f"percentile_ranks took {elapsed:.1f}s at n=40,000"
