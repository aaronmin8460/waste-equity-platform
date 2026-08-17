"""Tests for the Phase-3 research measuring instruments.

These cover the pure helpers only — the statistics, the rank-agreement measures,
the research CRITIC, and the research land-cover registry. The extraction and
driver layers read a real database and are exercised by running the driver, not
here.

The point of these tests is that a research *finding* is only as trustworthy as
the instrument that produced it: if ``spearman`` silently returned 0 for a
constant series, or ``describe`` counted a missing value as a zero, the Phase-3
report would state something false with full confidence.
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from suitability_v3_phase3 import critic_research, registry, stats  # noqa: E402

from waste_equity_backend.analysis.suitability import policy as historical_policy  # noqa: E402


def d(value: str) -> Decimal:
    return Decimal(value)


# --------------------------------------------------------------------------- #
# describe
# --------------------------------------------------------------------------- #


def test_describe_counts_missing_without_imputing_it() -> None:
    """A missing observation is counted, never turned into a zero.

    This is the single most load-bearing property in the report: every successor
    component is LOWER_RAW_IS_BETTER, so a zero-filled missing value would look
    like the *best* possible result.
    """

    result = stats.describe([d("10"), d("20")], observation_count=5)

    assert result.observation_count == 5
    assert result.available_count == 2
    assert result.null_count == 3
    assert result.zero_count == 0
    assert result.mean == d("15.0000000000")


def test_describe_distinguishes_a_real_zero_from_a_missing_value() -> None:
    result = stats.describe([d("0"), d("10")], observation_count=2)

    assert result.zero_count == 1
    assert result.null_count == 0
    assert result.minimum == d("0.0000000000")


def test_describe_rejects_an_observation_count_below_the_available_values() -> None:
    with pytest.raises(ValueError, match="cannot be smaller"):
        stats.describe([d("1"), d("2")], observation_count=1)


def test_describe_of_an_empty_series_reports_no_observations() -> None:
    result = stats.describe([], observation_count=7)

    assert result.available_count == 0
    assert result.null_count == 7
    assert result.mean is None
    assert stats.WARNING_NO_AVAILABLE_OBSERVATIONS in result.warnings


def test_describe_percentiles_interpolate_linearly() -> None:
    values = [d(str(n)) for n in range(1, 11)]  # 1..10

    result = stats.describe(values)

    assert result.minimum == d("1.0000000000")
    assert result.maximum == d("10.0000000000")
    assert result.median == d("5.5000000000")
    # p25 over 1..10: position 0.25*9 = 2.25 -> 3 + 0.25*(4-3) = 3.25
    assert result.p25 == d("3.2500000000")
    assert result.p90 == d("9.1000000000")


def test_describe_uses_population_variance_not_sample_variance() -> None:
    """Every Phase-3 series is a complete enumeration, so the divisor is n."""

    result = stats.describe([d("2"), d("4"), d("4"), d("4"), d("5"), d("5"), d("7"), d("9")])

    assert result.mean == d("5.0000000000")
    assert result.variance == d("4.0000000000")  # 32/8, not 32/7
    assert result.stdev == d("2.0000000000")


def test_describe_flags_a_constant_series_as_zero_variance() -> None:
    result = stats.describe([d("3")] * 20)

    assert result.stdev == d("0E-10")
    assert stats.WARNING_ZERO_VARIANCE in result.warnings


def test_describe_flags_heavy_zero_mass_and_skew() -> None:
    values = [d("0")] * 90 + [d("1000")] * 10

    result = stats.describe(values)

    assert result.zero_count == 90
    assert stats.WARNING_HEAVY_ZERO_MASS in result.warnings
    assert stats.WARNING_HIGH_SKEW in result.warnings


def test_describe_flags_extreme_outliers() -> None:
    values = [d(str(n)) for n in range(1, 51)] + [d("100000")]

    result = stats.describe(values)

    assert stats.WARNING_EXTREME_OUTLIERS in result.warnings


def test_percentile_requires_a_fraction_within_the_unit_interval() -> None:
    with pytest.raises(ValueError, match=r"\[0,1\]"):
        stats.percentile([d("1"), d("2")], d("1.5"))


# --------------------------------------------------------------------------- #
# fast_percentile_ranks — must equal the production function exactly
# --------------------------------------------------------------------------- #
#
# These are the load-bearing tests for the whole resident_impact section of the
# report: the published scores come from fast_percentile_ranks, so if it and
# policy.percentile_ranks ever disagree, the report is quoting a normalization
# the project does not use.


@pytest.mark.parametrize(
    "values",
    [
        {},
        {"a": Decimal("5")},
        {"a": Decimal("1"), "b": Decimal("2")},
        {"a": Decimal("1"), "b": Decimal("1"), "c": Decimal("1")},
        {"a": Decimal("3"), "b": Decimal("1"), "c": Decimal("2"), "d": Decimal("2")},
        {"a": Decimal("-5"), "b": Decimal("0"), "c": Decimal("5")},
        {"a": Decimal("0.0000001"), "b": Decimal("0.0000002"), "c": Decimal("0.0000001")},
    ],
)
def test_fast_percentile_ranks_matches_the_production_function(
    values: dict[str, Decimal],
) -> None:
    assert stats.fast_percentile_ranks(values) == historical_policy.percentile_ranks(values)


def test_fast_percentile_ranks_matches_production_on_a_larger_tied_population() -> None:
    """Heavy ties and repeated values are exactly where a shortcut would drift."""

    values = {f"k{i:04d}": Decimal(i % 37) for i in range(400)}

    assert stats.fast_percentile_ranks(values) == historical_policy.percentile_ranks(values)


def test_fast_percentile_ranks_puts_the_extremes_at_zero_and_one() -> None:
    values = {"low": Decimal("1"), "mid": Decimal("5"), "high": Decimal("9")}

    ranks = stats.fast_percentile_ranks(values)

    assert ranks["low"] == Decimal("0.000000")
    assert ranks["high"] == Decimal("1.000000")


def test_fast_percentile_ranks_returns_the_neutral_half_for_one_value() -> None:
    assert stats.fast_percentile_ranks({"only": Decimal("42")}) == {"only": Decimal("0.5")}


# --------------------------------------------------------------------------- #
# rank agreement
# --------------------------------------------------------------------------- #


def test_average_ranks_share_a_tied_block() -> None:
    ranks = stats.average_ranks({"a": d("1"), "b": d("2"), "c": d("2"), "d": d("3")})

    assert ranks["a"] == d("1")
    assert ranks["b"] == d("2.5")
    assert ranks["c"] == d("2.5")
    assert ranks["d"] == d("4")


def test_spearman_is_one_for_a_monotone_relationship() -> None:
    left = {"a": d("1"), "b": d("2"), "c": d("3"), "d": d("4")}
    right = {"a": d("10"), "b": d("20"), "c": d("30"), "d": d("40")}

    assert stats.spearman(left, right) == d("1.0000000000")


def test_spearman_is_minus_one_when_perfectly_reversed() -> None:
    left = {"a": d("1"), "b": d("2"), "c": d("3")}
    right = {"a": d("3"), "b": d("2"), "c": d("1")}

    assert stats.spearman(left, right) == d("-1.0000000000")


def test_spearman_is_none_when_one_side_is_constant() -> None:
    """Undefined must not be reported as zero correlation."""

    left = {"a": d("1"), "b": d("2"), "c": d("3")}
    right = {"a": d("5"), "b": d("5"), "c": d("5")}

    assert stats.spearman(left, right) is None


def test_spearman_is_none_with_fewer_than_two_shared_units() -> None:
    assert stats.spearman({"a": d("1")}, {"a": d("2")}) is None
    assert stats.spearman({"a": d("1")}, {"b": d("2")}) is None


def test_spearman_handles_ties_via_average_ranks() -> None:
    """The 1 - 6*sum(d^2)/(n^3-n) shortcut is invalid with ties; this is not."""

    left = {"a": d("1"), "b": d("1"), "c": d("2"), "d": d("3")}
    right = {"a": d("10"), "b": d("10"), "c": d("20"), "d": d("30")}

    assert stats.spearman(left, right) == d("1.0000000000")


def test_top_k_overlap_caps_k_at_the_smaller_population() -> None:
    left = {"a": d("3"), "b": d("2"), "c": d("1")}
    right = {"a": d("3"), "b": d("2")}

    overlap, k = stats.top_k_overlap(left, right, 10)

    assert k == 2
    assert overlap == 2


def test_top_k_overlap_detects_a_disjoint_top_set() -> None:
    left = {"a": d("9"), "b": d("8"), "c": d("1"), "d": d("0")}
    right = {"a": d("0"), "b": d("1"), "c": d("8"), "d": d("9")}

    overlap, k = stats.top_k_overlap(left, right, 2)

    assert k == 2
    assert overlap == 0


def test_rank_churn_reports_no_movement_for_an_identical_ranking() -> None:
    scores = {"a": d("3"), "b": d("2"), "c": d("1")}

    churn = stats.rank_churn(scores, scores)

    assert churn.shared_units == 3
    assert churn.unchanged == 3
    assert churn.max_move == 0
    assert churn.mean_abs_move == d("0E-10")


def test_rank_churn_measures_a_full_reversal() -> None:
    left = {"a": d("3"), "b": d("2"), "c": d("1")}
    right = {"a": d("1"), "b": d("2"), "c": d("3")}

    churn = stats.rank_churn(left, right)

    assert churn.max_move == 2
    assert churn.unchanged == 1  # the middle unit


def test_rank_churn_ranks_only_over_shared_units() -> None:
    """A unit missing from one side must not manufacture an enormous move."""

    left = {"a": d("3"), "b": d("2"), "z": d("99")}
    right = {"a": d("3"), "b": d("2")}

    churn = stats.rank_churn(left, right)

    assert churn.shared_units == 2
    assert churn.max_move == 0


# --------------------------------------------------------------------------- #
# research CRITIC
# --------------------------------------------------------------------------- #

_ORDER = ("existing_burden", "air_impact_proxy", "resident_impact", "land_conversion")


def _row(*values: str) -> dict[str, Decimal]:
    return {name: Decimal(value) for name, value in zip(_ORDER, values, strict=True)}


def test_research_critic_weights_sum_to_one() -> None:
    rows = [
        _row("10", "20", "30", "40"),
        _row("20", "10", "40", "30"),
        _row("30", "40", "10", "20"),
        _row("40", "30", "20", "10"),
    ]

    result = critic_research.compute_research_critic_weights(rows, _ORDER)

    total = sum(result.weights.values(), Decimal(0))
    assert abs(total - Decimal(1)) < Decimal("0.00000001")
    assert result.population_count == 4


def test_research_critic_refuses_an_incomplete_row() -> None:
    rows = [_row("10", "20", "30", "40"), {"existing_burden": Decimal("5")}]

    with pytest.raises(critic_research.ResearchCriticUndefinedError, match="never imputed"):
        critic_research.compute_research_critic_weights(rows, _ORDER)


def test_research_critic_is_undefined_for_a_single_unit() -> None:
    with pytest.raises(critic_research.ResearchCriticUndefinedError, match="N=1"):
        critic_research.compute_research_critic_weights([_row("1", "2", "3", "4")], _ORDER)


def test_research_critic_is_undefined_when_every_criterion_is_constant() -> None:
    rows = [_row("5", "5", "5", "5")] * 10

    with pytest.raises(critic_research.ResearchCriticUndefinedError, match="constant"):
        critic_research.compute_research_critic_weights(rows, _ORDER)


def test_research_critic_gives_a_constant_criterion_zero_weight() -> None:
    """A component that does not vary carries no information and earns nothing."""

    rows = [
        _row("10", "50", "30", "40"),
        _row("20", "50", "40", "30"),
        _row("30", "50", "10", "20"),
        _row("40", "50", "20", "10"),
    ]

    result = critic_research.compute_research_critic_weights(rows, _ORDER)

    assert "air_impact_proxy" in result.zero_variance_criteria
    assert result.weights["air_impact_proxy"] == Decimal("0E-8")


def test_research_critic_summary_is_labelled_research_only() -> None:
    rows = [
        _row("10", "20", "30", "40"),
        _row("20", "10", "40", "30"),
    ]

    summary = critic_research.compute_research_critic_weights(rows, _ORDER).sanitized_summary()

    assert "NOT PRODUCTION WEIGHTS" in summary["label"]
    assert summary["activation_status"].startswith("NOT ACTIVATED")


# --------------------------------------------------------------------------- #
# research land-cover registry
# --------------------------------------------------------------------------- #


def test_research_registry_is_not_approved() -> None:
    """The approved registry is another lane's deliverable; this one must never pass."""

    built = registry.research_registry()

    assert built.approved is False
    assert "RESEARCH-ONLY" in built.registry_id
    assert "NOT-PRODUCTION-POLICY" in built.registry_id


def test_research_registry_is_total_over_the_observed_classes() -> None:
    """Every observed class resolves to exactly one bucket, so nothing falls through."""

    built = registry.research_registry()
    developed = built.developed_class_codes
    excluded = built.excluded_class_codes
    non_developed = built.non_developed_class_codes()

    assert developed | excluded | non_developed == built.known_class_codes
    assert not developed & excluded
    assert not developed & non_developed
    assert not excluded & non_developed


def test_research_registry_treats_only_the_built_up_grouping_as_developed() -> None:
    built = registry.research_registry()

    assert built.developed_class_codes == frozenset({"110", "120", "130", "140", "150", "160"})
    assert all(code.startswith("1") for code in built.developed_class_codes)


def test_research_registry_flags_the_contested_classes() -> None:
    """Greenhouse, artificial grassland, artificial bare ground, and water."""

    built = registry.research_registry()

    assert {"230", "420", "620", "710", "720"} <= built.ambiguous_class_codes
    # Flagged does not mean unresolved: each still lands in exactly one bucket.
    for code in built.ambiguous_class_codes:
        assert built.is_known(code)


def test_research_registry_excludes_water_from_both_sides() -> None:
    built = registry.research_registry()

    assert built.excluded_class_codes == frozenset({"710", "720"})
    assert not built.is_developed("710")
    assert "710" not in built.non_developed_class_codes()
