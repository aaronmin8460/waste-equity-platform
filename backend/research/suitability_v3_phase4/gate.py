"""Phase-4 policy-gate measurements over the real capital-region dataset.

Read-only. Every function here *measures* an option so a Phase-4 decision can cite
evidence; none of them selects one, persists one, or activates anything.

Three things are measured that Phase 3 could not:

1. **BEFORE vs AFTER**, on one extraction, for each correctness fix. The
   pre-fix behaviour is reconstructed from the corrected observations' own
   recorded inputs (``class_area_excess_m2``, ``unmapped_facility_evidence``)
   rather than by running a second pipeline, so the two sides cannot drift.
2. **The air-impact grain options** (B6), including the CITY-grain projection,
   costed in regions, candidates, and residents.
3. **Normalization, weight, and stability sensitivity** on the corrected
   population, which is a materially different population from Phase 3's.
"""

from __future__ import annotations

import sys
from collections.abc import Mapping, Sequence
from decimal import Decimal
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from suitability_v3_phase3 import stats  # noqa: E402

from waste_equity_backend.analysis.suitability.successor import contract  # noqa: E402

COMPONENT_ORDER = contract.SUCCESSOR_COMPONENTS

# Equal weights, used strictly as a *neutral reference* against which other weight
# profiles are compared. Not a proposal, not a default, and deliberately not
# registered anywhere in runtime policy.
NEUTRAL_REFERENCE_WEIGHTS: dict[str, Decimal] = {
    component: Decimal("0.25") for component in COMPONENT_ORDER
}


def _share(numerator: int, denominator: int) -> str | None:
    if denominator <= 0:
        return None
    return format(
        (Decimal(numerator) / Decimal(denominator) * 100).quantize(Decimal("0.01")), "f"
    )


# --------------------------------------------------------------------------- #
# BEFORE / AFTER reconstruction
# --------------------------------------------------------------------------- #


def land_conversion_before_after(series: contract.ComponentSeries) -> dict[str, Any]:
    """B16 recovery, reconstructed from the corrected observations themselves.

    A cell was rejected pre-fix exactly when its class sum exceeded its
    denominator at all. The corrected observation records that excess, so the
    pre-fix availability is recoverable without a second pipeline run.
    """

    total = len(series.observations)
    after_available = 0
    before_available = 0
    recovered: list[str] = []
    clamped = 0
    genuinely_missing: dict[str, int] = {}

    for observation in series.observations:
        excess_raw = observation.inputs.get("class_area_excess_m2")
        excess = Decimal(str(excess_raw)) if excess_raw is not None else None
        if observation.available:
            after_available += 1
            if excess is not None and excess > 0:
                recovered.append(observation.unit_key)
            else:
                before_available += 1
            if observation.inputs.get("share_clamped_to_unit_interval"):
                clamped += 1
        else:
            for reason in observation.unavailable_reasons:
                genuinely_missing[reason] = genuinely_missing.get(reason, 0) + 1

    return {
        "observation_count": total,
        "before_available": before_available,
        "before_available_share_pct": _share(before_available, total),
        "after_available": after_available,
        "after_available_share_pct": _share(after_available, total),
        "recovered_candidates": len(recovered),
        "clamped_to_unit_interval": clamped,
        "remaining_unavailable": total - after_available,
        "remaining_unavailable_reasons": dict(sorted(genuinely_missing.items())),
    }


def existing_burden_before_after(series: contract.ComponentSeries) -> dict[str, Any]:
    """B17 effect: regions whose zero burden was an artifact of the mapping gap."""

    total = len(series.observations)
    after_available = 0
    withdrawn: list[str] = []
    flagged_undercount: list[str] = []
    observed_zero: list[str] = []

    for observation in series.observations:
        evidence = observation.inputs.get("unmapped_facility_evidence")
        if observation.available:
            after_available += 1
            if evidence is not None:
                flagged_undercount.append(observation.unit_key)
            if observation.raw_value == 0:
                observed_zero.append(observation.unit_key)
        elif contract.REASON_UNMAPPED_FACILITY_EVIDENCE in observation.unavailable_reasons:
            withdrawn.append(observation.unit_key)

    before_available = after_available + len(withdrawn)
    return {
        "observation_count": total,
        "before_available_regions": before_available,
        "after_available_regions": after_available,
        "withdrawn_regions": sorted(withdrawn),
        "withdrawn_region_count": len(withdrawn),
        "flagged_undercount_regions": sorted(flagged_undercount),
        "remaining_observed_zero_regions": sorted(observed_zero),
        "remaining_observed_zero_count": len(observed_zero),
    }


# --------------------------------------------------------------------------- #
# Eligibility under each missing-component policy
# --------------------------------------------------------------------------- #


def eligibility_by_policy(
    candidate_keys: Sequence[str],
    component_scores: Mapping[str, Mapping[str, Decimal]],
    populations: Mapping[str, int] | None = None,
    candidate_region: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Eligible population under STRICT vs each single-optional-component variant.

    ``OPTIONAL_COMPONENT_RENORMALIZED`` is not one policy but a family — one per
    choice of optional set — so each candidate optional component is costed
    separately instead of the family being reported as a single number.
    """

    def _covered(required: Sequence[str]) -> list[str]:
        return [
            key
            for key in candidate_keys
            if all(key in component_scores[component] for component in required)
        ]

    def _residents(keys: Sequence[str]) -> int | None:
        if populations is None or candidate_region is None:
            return None
        regions = {candidate_region[k] for k in keys if k in candidate_region}
        return sum(populations.get(region, 0) for region in regions)

    strict_keys = _covered(COMPONENT_ORDER)
    result: dict[str, Any] = {
        "candidate_population": len(candidate_keys),
        "per_component_available": {
            component: len(component_scores[component]) for component in COMPONENT_ORDER
        },
        "strict_all_components_required": {
            "eligible": len(strict_keys),
            "eligible_share_pct": _share(len(strict_keys), len(candidate_keys)),
            "regions_represented": (
                len({candidate_region[k] for k in strict_keys if k in candidate_region})
                if candidate_region is not None
                else None
            ),
            "residents_represented": _residents(strict_keys),
        },
        "optional_component_renormalized": {},
    }
    for optional in COMPONENT_ORDER:
        required = [c for c in COMPONENT_ORDER if c != optional]
        keys = _covered(required)
        result["optional_component_renormalized"][optional] = {
            "optional_component": optional,
            "eligible": len(keys),
            "eligible_share_pct": _share(len(keys), len(candidate_keys)),
            "gain_over_strict": len(keys) - len(strict_keys),
            "regions_represented": (
                len({candidate_region[k] for k in keys if k in candidate_region})
                if candidate_region is not None
                else None
            ),
            "residents_represented": _residents(keys),
            # A candidate scored on three components and one scored on four are
            # only comparable if the missing component carries no systematic
            # signal. Measured below, never assumed.
            "scored_on_fewer_components": len(keys) - len(strict_keys),
        }
    return result


def partial_scoring_comparability(
    strict_keys: Sequence[str],
    partial_keys: Sequence[str],
    component_scores: Mapping[str, Mapping[str, Decimal]],
    optional_component: str,
) -> dict[str, Any]:
    """Are renormalized 3-component scores comparable with 4-component ones?

    Compares the *retained* components' distributions between the candidates that
    have the optional component and those that do not. A large gap means the two
    groups are not exchangeable, so putting them in one ranking compares different
    things — the concrete hazard behind ``OPTIONAL_COMPONENT_RENORMALIZED``.
    """

    strict_set = set(strict_keys)
    only_partial = [key for key in partial_keys if key not in strict_set]
    retained = [c for c in COMPONENT_ORDER if c != optional_component]

    comparison: dict[str, Any] = {
        "optional_component": optional_component,
        "complete_case_units": len(strict_set),
        "units_missing_only_the_optional_component": len(only_partial),
        "retained_component_means": {},
    }
    for component in retained:
        with_values = [component_scores[component][k] for k in strict_keys]
        without_values = [
            component_scores[component][k] for k in only_partial if k in component_scores[component]
        ]
        if not with_values or not without_values:
            continue
        mean_with = sum(with_values, start=Decimal("0")) / Decimal(len(with_values))
        mean_without = sum(without_values, start=Decimal("0")) / Decimal(len(without_values))
        comparison["retained_component_means"][component] = {
            "complete_case_mean": format(mean_with.quantize(Decimal("0.0001")), "f"),
            "missing_optional_mean": format(mean_without.quantize(Decimal("0.0001")), "f"),
            "difference": format((mean_without - mean_with).quantize(Decimal("0.0001")), "f"),
        }
    return comparison


# --------------------------------------------------------------------------- #
# Weight sensitivity and stability
# --------------------------------------------------------------------------- #


def composite_scores(
    keys: Sequence[str],
    component_scores: Mapping[str, Mapping[str, Decimal]],
    weights: Mapping[str, Decimal],
) -> dict[str, Decimal]:
    """Weighted composite over the complete-case units only."""

    return {
        key: sum(
            (component_scores[c][key] * weights[c] for c in COMPONENT_ORDER),
            start=Decimal("0"),
        )
        for key in keys
    }


def compare_rankings(
    baseline: Mapping[str, Decimal],
    variant: Mapping[str, Decimal],
    *,
    label: str,
    region_of: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Spearman, top-10/top-50 overlap, and regional concentration of a change."""

    comparison: dict[str, Any] = {
        "label": label,
        "spearman": _fmt(stats.spearman(baseline, variant)),
        "top_10_overlap": stats.top_k_overlap(baseline, variant, 10, higher_is_better=True),
        "top_50_overlap": stats.top_k_overlap(baseline, variant, 50, higher_is_better=True),
    }
    if region_of is not None:
        comparison["baseline_top_50_regions"] = _region_counts(baseline, 50, region_of)
        comparison["variant_top_50_regions"] = _region_counts(variant, 50, region_of)
    return comparison


def _region_counts(
    scores: Mapping[str, Decimal], k: int, region_of: Mapping[str, str]
) -> dict[str, int]:
    top = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:k]
    counts: dict[str, int] = {}
    for key, _ in top:
        region = region_of.get(key, "UNKNOWN")
        counts[region] = counts.get(region, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def perturb(weights: Mapping[str, Decimal], component: str, delta: Decimal) -> dict[str, Decimal]:
    """Move ``delta`` of weight onto ``component``, taken equally from the others."""

    others = [c for c in COMPONENT_ORDER if c != component]
    share = delta / Decimal(len(others))
    perturbed = {c: weights[c] - share for c in others}
    perturbed[component] = weights[component] + delta
    return {c: perturbed[c] for c in COMPONENT_ORDER}


def _fmt(value: Decimal | None) -> str | None:
    return format(value, "f") if value is not None else None
