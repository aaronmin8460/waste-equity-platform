"""Deterministic distribution and rank-agreement diagnostics for Phase-3 research.

Pure functions over exact :class:`~decimal.Decimal` values. Nothing here reads a
database, imports runtime source, or encodes policy: these are the measuring
instruments the Phase-3 report uses, not any part of the successor model.

Two conventions are fixed here and stated rather than assumed:

* **Variance is population variance** (divided by ``n``, not ``n - 1``). Every
  Phase-3 series is a *complete* enumeration — every capital-region candidate, or
  every SIGUNGU — not a sample drawn from a larger frame, so the population
  moment is the correct one and the Bessel correction would be answering a
  question nobody asked.
* **Percentiles use linear interpolation between closest ranks** on the sorted
  available values (the convention ``numpy.percentile`` uses by default), so a
  reported p10/p90 is reproducible from the same inputs by any reader.

Missing observations are counted, never imputed: :func:`describe` takes the total
observation count separately from the available values, so ``null_count`` is a
measured quantity rather than the absence of one.
"""

from __future__ import annotations

import bisect
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from typing import Any

# Working precision for the intermediate moment arithmetic. Wide enough that the
# cubed deviations behind the skewness statistic do not lose significance.
_WORKING_PRECISION = 60

# Reported statistics are quantized so a summary is byte-stable across machines.
_QUANT = Decimal("0.0000000001")  # 10 dp

# --------------------------------------------------------------------------- #
# Warning vocabulary (stable, machine-readable)
# --------------------------------------------------------------------------- #

WARNING_ZERO_VARIANCE = "ZERO_VARIANCE"
WARNING_NEAR_ZERO_VARIANCE = "NEAR_ZERO_VARIANCE"
WARNING_HIGH_SKEW = "HIGH_SKEW"
WARNING_EXTREME_OUTLIERS = "EXTREME_OUTLIERS"
WARNING_HEAVY_ZERO_MASS = "HEAVY_ZERO_MASS"
WARNING_LOW_UNIQUE_VALUES = "LOW_UNIQUE_VALUES"
WARNING_NO_AVAILABLE_OBSERVATIONS = "NO_AVAILABLE_OBSERVATIONS"

# Thresholds are diagnostic tripwires for a research report, not policy limits.
# They exist to make a reader look, never to make a decision.
NEAR_ZERO_VARIANCE_CV = Decimal("0.01")  # coefficient of variation
HIGH_SKEW_ABS = Decimal("2")
OUTLIER_IQR_MULTIPLIER = Decimal("3")
HEAVY_ZERO_MASS_SHARE = Decimal("0.5")
LOW_UNIQUE_VALUE_COUNT = 10


@dataclass(frozen=True)
class Distribution:
    """Distribution diagnostics for one component over one population.

    ``observation_count`` is every analytical unit the component was *asked*
    about; ``available_count`` is how many produced a real value. Their
    difference is ``null_count`` — a measured missingness, never a zero-fill.
    """

    observation_count: int
    available_count: int
    null_count: int
    zero_count: int
    unique_count: int
    minimum: Decimal | None
    p10: Decimal | None
    p25: Decimal | None
    median: Decimal | None
    p75: Decimal | None
    p90: Decimal | None
    maximum: Decimal | None
    mean: Decimal | None
    stdev: Decimal | None
    variance: Decimal | None
    skewness: Decimal | None
    warnings: tuple[str, ...]

    def sanitized_summary(self) -> dict[str, Any]:
        """JSON-serializable summary using fixed-point decimal strings."""

        def fmt(value: Decimal | None) -> str | None:
            return format(value, "f") if value is not None else None

        return {
            "observation_count": self.observation_count,
            "available_count": self.available_count,
            "null_count": self.null_count,
            "zero_count": self.zero_count,
            "unique_count": self.unique_count,
            "min": fmt(self.minimum),
            "p10": fmt(self.p10),
            "p25": fmt(self.p25),
            "median": fmt(self.median),
            "p75": fmt(self.p75),
            "p90": fmt(self.p90),
            "max": fmt(self.maximum),
            "mean": fmt(self.mean),
            "stdev": fmt(self.stdev),
            "variance": fmt(self.variance),
            "skewness": fmt(self.skewness),
            "warnings": list(self.warnings),
        }


def percentile(sorted_values: Sequence[Decimal], fraction: Decimal) -> Decimal:
    """Linear-interpolated percentile of an already-sorted, non-empty sequence.

    ``fraction`` is in ``[0, 1]``. Matches the default convention of
    ``numpy.percentile`` so a figure in the report can be re-derived by a reader.
    """

    if not sorted_values:
        raise ValueError("percentile requires at least one value")
    if fraction < 0 or fraction > 1:
        raise ValueError(f"fraction must be within [0,1]; got {fraction}")
    if len(sorted_values) == 1:
        return sorted_values[0]
    with localcontext() as ctx:
        ctx.prec = _WORKING_PRECISION
        position = fraction * Decimal(len(sorted_values) - 1)
        lower_index = int(position // 1)
        if lower_index >= len(sorted_values) - 1:
            return sorted_values[-1]
        weight = position - Decimal(lower_index)
        lower = sorted_values[lower_index]
        upper = sorted_values[lower_index + 1]
        return lower + (upper - lower) * weight


def describe(
    values: Sequence[Decimal],
    *,
    observation_count: int | None = None,
) -> Distribution:
    """Full distribution diagnostics for the *available* values of one series.

    ``values`` must contain only real observations. ``observation_count`` is the
    total number of units the component was asked about, including the ones that
    produced nothing; it defaults to ``len(values)`` (no missingness).
    """

    total = len(values) if observation_count is None else observation_count
    if total < len(values):
        raise ValueError(
            f"observation_count ({total}) cannot be smaller than the number of "
            f"available values ({len(values)})"
        )
    available = len(values)
    null_count = total - available

    if available == 0:
        return Distribution(
            observation_count=total,
            available_count=0,
            null_count=null_count,
            zero_count=0,
            unique_count=0,
            minimum=None,
            p10=None,
            p25=None,
            median=None,
            p75=None,
            p90=None,
            maximum=None,
            mean=None,
            stdev=None,
            variance=None,
            skewness=None,
            warnings=(WARNING_NO_AVAILABLE_OBSERVATIONS,),
        )

    ordered = sorted(values)
    zero_count = sum(1 for value in ordered if value == 0)
    unique_count = len(set(ordered))

    with localcontext() as ctx:
        ctx.prec = _WORKING_PRECISION
        n = Decimal(available)
        mean = sum(ordered, Decimal(0)) / n
        squared = sum(((value - mean) ** 2 for value in ordered), Decimal(0))
        variance = squared / n
        stdev = variance.sqrt()
        if stdev > 0:
            cubed = sum(((value - mean) ** 3 for value in ordered), Decimal(0))
            skewness: Decimal | None = (cubed / n) / (stdev**3)
        else:
            skewness = Decimal(0)

        p10 = percentile(ordered, Decimal("0.10"))
        p25 = percentile(ordered, Decimal("0.25"))
        median = percentile(ordered, Decimal("0.50"))
        p75 = percentile(ordered, Decimal("0.75"))
        p90 = percentile(ordered, Decimal("0.90"))

        warnings = _warnings(
            ordered=ordered,
            available=available,
            zero_count=zero_count,
            unique_count=unique_count,
            mean=mean,
            stdev=stdev,
            skewness=skewness,
            p25=p25,
            p75=p75,
        )

    def q(value: Decimal | None) -> Decimal | None:
        return value.quantize(_QUANT) if value is not None else None

    return Distribution(
        observation_count=total,
        available_count=available,
        null_count=null_count,
        zero_count=zero_count,
        unique_count=unique_count,
        minimum=q(ordered[0]),
        p10=q(p10),
        p25=q(p25),
        median=q(median),
        p75=q(p75),
        p90=q(p90),
        maximum=q(ordered[-1]),
        mean=q(mean),
        stdev=q(stdev),
        variance=q(variance),
        skewness=q(skewness),
        warnings=warnings,
    )


def _warnings(
    *,
    ordered: Sequence[Decimal],
    available: int,
    zero_count: int,
    unique_count: int,
    mean: Decimal,
    stdev: Decimal,
    skewness: Decimal | None,
    p25: Decimal,
    p75: Decimal,
) -> tuple[str, ...]:
    """Diagnostic tripwires. Each says *look here*, never *do this*."""

    found: list[str] = []
    if stdev == 0:
        found.append(WARNING_ZERO_VARIANCE)
    elif mean != 0 and (stdev / abs(mean)) < NEAR_ZERO_VARIANCE_CV:
        found.append(WARNING_NEAR_ZERO_VARIANCE)

    if skewness is not None and abs(skewness) > HIGH_SKEW_ABS:
        found.append(WARNING_HIGH_SKEW)

    iqr = p75 - p25
    if iqr > 0:
        upper_fence = p75 + OUTLIER_IQR_MULTIPLIER * iqr
        lower_fence = p25 - OUTLIER_IQR_MULTIPLIER * iqr
        outliers = sum(1 for value in ordered if value > upper_fence or value < lower_fence)
        if outliers > 0:
            found.append(WARNING_EXTREME_OUTLIERS)

    if available > 0 and Decimal(zero_count) / Decimal(available) > HEAVY_ZERO_MASS_SHARE:
        found.append(WARNING_HEAVY_ZERO_MASS)

    if unique_count < LOW_UNIQUE_VALUE_COUNT:
        found.append(WARNING_LOW_UNIQUE_VALUES)

    return tuple(found)


# --------------------------------------------------------------------------- #
# Percentile ranks — the project convention, at candidate scale
# --------------------------------------------------------------------------- #

# ``policy.percentile_ranks`` counts strictly-lesser values with a linear scan per
# key, so it is O(n^2). That is unremarkable for the 79 SIGUNGU a region-level
# component ranks, and unremarkable for the historical engine, which percentile-
# ranks region-level inputs. It is *not* unremarkable for a candidate-level
# successor component: at n = 47,893 it is ~2.3 billion Decimal comparisons per
# call, minutes of CPU each, and ``resident_impact`` needs one call per distance
# floor.
#
# This is a byte-identical O(n log n) restatement of the same definition —
# rank = count(strictly less) / (n - 1), ties share a rank, a single value is the
# neutral 0.5, same 6-dp ROUND_HALF_EVEN quantization — obtained by noting that
# "how many values are strictly less than v" is exactly ``bisect_left`` on the
# sorted values. ``test_phase3_stats.py`` pins exact agreement with the
# production function, including on ties and negatives, so this is a speed
# equivalence rather than a second definition.
#
# The production function is deliberately NOT modified: this lane changes no
# runtime source. The O(n^2) cost of percentile-ranking a candidate-level
# component is recorded as a Phase-3 finding instead.
_RANK_QUANT = Decimal("0.000001")


def fast_percentile_ranks(values: Mapping[str, Decimal]) -> dict[str, Decimal]:
    """O(n log n) equivalent of ``policy.percentile_ranks``."""

    n = len(values)
    if n == 0:
        return {}
    if n == 1:
        return {key: Decimal("0.5") for key in values}
    ordered = sorted(values.values())
    denominator = Decimal(n - 1)
    cache: dict[Decimal, Decimal] = {}
    ranks: dict[str, Decimal] = {}
    for key, value in values.items():
        cached = cache.get(value)
        if cached is None:
            less = bisect.bisect_left(ordered, value)
            cached = (Decimal(less) / denominator).quantize(_RANK_QUANT, rounding=ROUND_HALF_EVEN)
            cache[value] = cached
        ranks[key] = cached
    return ranks


# --------------------------------------------------------------------------- #
# Rank agreement
# --------------------------------------------------------------------------- #


def average_ranks(values: Mapping[str, Decimal]) -> dict[str, Decimal]:
    """Average ranks (1 = smallest), with tied values sharing their mean rank.

    Average ranks are what make the Spearman coefficient below tie-correct: the
    shortcut ``1 - 6Σd²/(n³-n)`` is only valid without ties, and every successor
    component here has them.
    """

    ordered = sorted(values.items(), key=lambda item: (item[1], item[0]))
    ranks: dict[str, Decimal] = {}
    index = 0
    with localcontext() as ctx:
        ctx.prec = _WORKING_PRECISION
        while index < len(ordered):
            stop = index
            while stop + 1 < len(ordered) and ordered[stop + 1][1] == ordered[index][1]:
                stop += 1
            # Ranks are 1-based; the shared rank is the mean of the tied block.
            shared = (Decimal(index + 1) + Decimal(stop + 1)) / Decimal(2)
            for position in range(index, stop + 1):
                ranks[ordered[position][0]] = shared
            index = stop + 1
    return ranks


def spearman(left: Mapping[str, Decimal], right: Mapping[str, Decimal]) -> Decimal | None:
    """Tie-corrected Spearman rank correlation over the shared keys.

    Returns ``None`` when the coefficient is undefined: fewer than two shared
    units, or one side constant across them (zero rank variance). Returning
    ``None`` rather than a placeholder keeps "the data cannot answer this" from
    being read as "the answer is zero".
    """

    shared = sorted(set(left) & set(right))
    if len(shared) < 2:
        return None
    left_ranks = average_ranks({key: left[key] for key in shared})
    right_ranks = average_ranks({key: right[key] for key in shared})
    with localcontext() as ctx:
        ctx.prec = _WORKING_PRECISION
        n = Decimal(len(shared))
        left_mean = sum((left_ranks[key] for key in shared), Decimal(0)) / n
        right_mean = sum((right_ranks[key] for key in shared), Decimal(0)) / n
        covariance = sum(
            ((left_ranks[key] - left_mean) * (right_ranks[key] - right_mean) for key in shared),
            Decimal(0),
        )
        left_ss = sum(((left_ranks[key] - left_mean) ** 2 for key in shared), Decimal(0))
        right_ss = sum(((right_ranks[key] - right_mean) ** 2 for key in shared), Decimal(0))
        if left_ss == 0 or right_ss == 0:
            return None
        return (covariance / (left_ss * right_ss).sqrt()).quantize(_QUANT)


def pearson(left: Sequence[Decimal], right: Sequence[Decimal]) -> Decimal | None:
    """Pearson correlation over paired values; ``None`` when undefined."""

    if len(left) != len(right):
        raise ValueError("pearson requires equal-length sequences")
    if len(left) < 2:
        return None
    with localcontext() as ctx:
        ctx.prec = _WORKING_PRECISION
        n = Decimal(len(left))
        left_mean = sum(left, Decimal(0)) / n
        right_mean = sum(right, Decimal(0)) / n
        covariance = sum(
            ((a - left_mean) * (b - right_mean) for a, b in zip(left, right, strict=True)),
            Decimal(0),
        )
        left_ss = sum(((a - left_mean) ** 2 for a in left), Decimal(0))
        right_ss = sum(((b - right_mean) ** 2 for b in right), Decimal(0))
        if left_ss == 0 or right_ss == 0:
            return None
        return (covariance / (left_ss * right_ss).sqrt()).quantize(_QUANT)


def top_k_overlap(
    left: Mapping[str, Decimal],
    right: Mapping[str, Decimal],
    k: int,
    *,
    higher_is_better: bool = True,
) -> tuple[int, int]:
    """Size of the intersection of the two top-``k`` sets, and the ``k`` used.

    The effective ``k`` is capped at the smaller population. **Ties at the
    boundary are not broken by score**: the selection is deterministic in the
    unit key, so a reader re-deriving the figure gets the same set. Where a run's
    top-``k`` is largely tied — which run 47's is — the overlap therefore measures
    a *deterministic slice* of a tied block, and the report says so rather than
    presenting it as a stability finding.
    """

    if k <= 0:
        raise ValueError(f"k must be positive; got {k}")
    effective = min(k, len(left), len(right))
    if effective == 0:
        return 0, 0
    left_top = _top_keys(left, effective, higher_is_better=higher_is_better)
    right_top = _top_keys(right, effective, higher_is_better=higher_is_better)
    return len(left_top & right_top), effective


def _top_keys(values: Mapping[str, Decimal], k: int, *, higher_is_better: bool) -> frozenset[str]:
    ordered = sorted(
        values.items(),
        key=lambda item: (-item[1], item[0]) if higher_is_better else (item[1], item[0]),
    )
    return frozenset(key for key, _ in ordered[:k])


@dataclass(frozen=True)
class RankChurn:
    """How far units move between two rankings of the same shared population."""

    shared_units: int
    unchanged: int
    moved_gt_10: int
    moved_gt_100: int
    moved_gt_1000: int
    max_move: int
    mean_abs_move: Decimal | None

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "shared_units": self.shared_units,
            "unchanged": self.unchanged,
            "moved_gt_10": self.moved_gt_10,
            "moved_gt_100": self.moved_gt_100,
            "moved_gt_1000": self.moved_gt_1000,
            "max_move": self.max_move,
            "mean_abs_move": (
                format(self.mean_abs_move, "f") if self.mean_abs_move is not None else None
            ),
        }


def rank_churn(
    left: Mapping[str, Decimal],
    right: Mapping[str, Decimal],
    *,
    higher_is_better: bool = True,
) -> RankChurn:
    """Absolute rank movement between two scorings of the same units.

    Ranks are dense positional ranks over the shared units only, so a unit that
    is missing from one side never appears as a huge artificial move.
    """

    shared = sorted(set(left) & set(right))
    if not shared:
        return RankChurn(0, 0, 0, 0, 0, 0, None)

    def positions(values: Mapping[str, Decimal]) -> dict[str, int]:
        ordered = sorted(
            ((key, values[key]) for key in shared),
            key=lambda item: (-item[1], item[0]) if higher_is_better else (item[1], item[0]),
        )
        return {key: index for index, (key, _) in enumerate(ordered)}

    left_pos = positions(left)
    right_pos = positions(right)
    moves = [abs(left_pos[key] - right_pos[key]) for key in shared]
    with localcontext() as ctx:
        ctx.prec = _WORKING_PRECISION
        mean_move = (
            sum((Decimal(move) for move in moves), Decimal(0)) / Decimal(len(moves))
        ).quantize(_QUANT)
    return RankChurn(
        shared_units=len(shared),
        unchanged=sum(1 for move in moves if move == 0),
        moved_gt_10=sum(1 for move in moves if move > 10),
        moved_gt_100=sum(1 for move in moves if move > 100),
        moved_gt_1000=sum(1 for move in moves if move > 1000),
        max_move=max(moves),
        mean_abs_move=mean_move,
    )
