"""Measurements that close the four open Successor-V3 policy decisions.

Read-only. Every function measures; none writes, activates, or persists.

What this adds over the Phase-4 gate:

1. **Adjacent-floor sensitivity.** Phase 4 compared every floor against 500 m
   only. A floor decision needs to know where the *step changes* are, so each
   floor is also compared with its immediate neighbour.
2. **The within-region placement artifact.** The known unresolved defect is that
   population is one value per SIGUNGU at a single representative point, so
   distance inside a region is an artifact of where that point was put. This
   quantifies how much of each floor's score spread is that artifact, by
   measuring the score range *inside* single regions.
3. **Land-cover class sensitivity.** The approved registry resolves three
   contested classes conservatively. Each alternative resolution is re-measured
   end to end so the ranking cost of the contested calls is published rather
   than asserted.
"""

from __future__ import annotations

import sys
from collections.abc import Mapping, Sequence
from decimal import Decimal
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from suitability_v3_phase3 import stats  # noqa: E402
from suitability_v3_phase4 import gate  # noqa: E402

from waste_equity_backend.analysis.suitability.successor import (  # noqa: E402
    contract,
    land_conversion,
)

COMPONENT_ORDER = contract.SUCCESSOR_COMPONENTS


def _fmt(value: Decimal | None) -> str | None:
    return format(value, "f") if value is not None else None


# --------------------------------------------------------------------------- #
# Registry variants
# --------------------------------------------------------------------------- #


def registry_variants() -> dict[str, land_conversion.LandCoverClassRegistry]:
    """The approved registry plus every alternative resolution it was chosen over.

    Each variant differs from the approved registry in exactly one contested
    decision, so the measured difference is attributable to that decision alone.
    """

    approved = land_conversion.PRODUCTION_REGISTRY
    assert approved is not None, "PRODUCTION_REGISTRY must be populated before closure measurement"

    known = approved.known_class_codes
    base_developed = approved.developed_class_codes
    water = frozenset({"710", "720"})

    def _variant(
        variant_id: str,
        developed: frozenset[str],
        excluded: frozenset[str],
        note: str,
    ) -> land_conversion.LandCoverClassRegistry:
        return land_conversion.LandCoverClassRegistry(
            registry_id=variant_id,
            class_level=approved.class_level,
            developed_class_codes=developed,
            known_class_codes=known,
            excluded_class_codes=excluded,
            ambiguous_class_codes=approved.ambiguous_class_codes,
            source=f"SENSITIVITY VARIANT of {approved.registry_id}; measurement only",
            approved=False,
            note=note,
        )

    return {
        "approved": approved,
        "alt_620_developed": _variant(
            "SENSITIVITY-620-developed",
            base_developed | {"620"},
            frozenset(),
            "인공나지 counted as developed — the permissive resolution of the largest "
            "contested class (24,411 cells).",
        ),
        "alt_230_420_620_developed": _variant(
            "SENSITIVITY-230-420-620-developed",
            base_developed | {"230", "420", "620"},
            frozenset(),
            "All three non-water contested classes counted as developed — the maximally "
            "permissive resolution.",
        ),
        "alt_water_excluded": _variant(
            "SENSITIVITY-water-excluded",
            base_developed,
            water,
            "Water removed from numerator and denominator — the Phase-3 research reading, "
            "REJECTED on evidence because it makes water-dominated cells 7.4x more likely "
            "to reach a near-perfect score.",
        ),
    }


# --------------------------------------------------------------------------- #
# Distance-floor evidence
# --------------------------------------------------------------------------- #


def adjacent_floor_sensitivity(
    floor_composites: Mapping[int, Mapping[str, Decimal]],
    region_of: Mapping[str, str],
) -> list[dict[str, Any]]:
    """Compare each floor with its immediate neighbour, not only with the base.

    A decision needs the step size between the options actually adjacent to it;
    comparing everything against the smallest floor hides where the change is.
    """

    floors = sorted(floor_composites)
    comparisons: list[dict[str, Any]] = []
    for lower, upper in zip(floors, floors[1:], strict=False):
        comparisons.append(
            gate.compare_rankings(
                floor_composites[lower],
                floor_composites[upper],
                label=f"{lower}m vs {upper}m floor (adjacent, approved weights)",
                region_of=region_of,
            )
        )
    return comparisons


def within_region_placement_artifact(
    resident_scores: Mapping[str, Decimal],
    region_of: Mapping[str, str],
    *,
    minimum_candidates: int = 30,
) -> dict[str, Any]:
    """How much within-region score spread does each floor leave?

    Population is one value per SIGUNGU held at a single representative point, so
    two candidates in the same region differ only in their distances to that point
    and to every *other* region's point. The within-region score range is therefore
    an upper bound on the placement artifact, not the artifact itself: part of it is
    genuine variation in proximity to neighbouring regions' populations, and only
    the own-region term is placement-driven. The floor bounds that own-region term,
    so a floor that compresses this range is damping the artifact — but the residual
    is not all artifact and must not be reported as if it were.
    """

    by_region: dict[str, list[Decimal]] = {}
    for key, score in resident_scores.items():
        region = region_of.get(key)
        if region is None:
            continue
        by_region.setdefault(region, []).append(score)

    ranges: list[Decimal] = []
    per_region: dict[str, str] = {}
    for region, scores in by_region.items():
        if len(scores) < minimum_candidates:
            continue
        spread = max(scores) - min(scores)
        ranges.append(spread)
        per_region[region] = format(spread.quantize(Decimal("0.01")), "f")

    if not ranges:
        return {"regions_measured": 0}

    mean_range = sum(ranges, start=Decimal("0")) / Decimal(len(ranges))
    return {
        "regions_measured": len(ranges),
        "minimum_candidates_per_region": minimum_candidates,
        "mean_within_region_score_range": format(mean_range.quantize(Decimal("0.0001")), "f"),
        "max_within_region_score_range": format(max(ranges).quantize(Decimal("0.0001")), "f"),
        "interpretation": (
            "Upper bound on the representative-point placement artifact, not the artifact "
            "itself: within-region spread also contains genuine variation in proximity to "
            "OTHER regions' populations. A larger floor compresses the own-region term and "
            "so lowers this bound."
        ),
        "per_region_score_range": dict(sorted(per_region.items())),
    }


# --------------------------------------------------------------------------- #
# Weight evidence
# --------------------------------------------------------------------------- #


def weight_perturbations(
    strict_keys: Sequence[str],
    component_scores: Mapping[str, Mapping[str, Decimal]],
    approved_weights: Mapping[str, Decimal],
    region_of: Mapping[str, str],
) -> dict[str, Any]:
    """Sensitivity of the approved vector to ±0.05 and ±0.15 on each component."""

    baseline = gate.composite_scores(strict_keys, component_scores, approved_weights)
    results: list[dict[str, Any]] = []
    for component in COMPONENT_ORDER:
        for delta in (Decimal("0.05"), Decimal("0.15")):
            perturbed = gate.perturb(approved_weights, component, delta)
            if any(w < 0 for w in perturbed.values()):
                continue
            variant = gate.composite_scores(strict_keys, component_scores, perturbed)
            comparison = gate.compare_rankings(
                baseline,
                variant,
                label=f"+{delta} -> {component}",
                region_of=region_of,
            )
            comparison["weights"] = {c: format(perturbed[c], "f") for c in COMPONENT_ORDER}
            results.append(comparison)
    return {
        "approved_weights": {c: format(approved_weights[c], "f") for c in COMPONENT_ORDER},
        "baseline_top_50_regions": gate._region_counts(baseline, 50, region_of),
        "baseline_top_10_regions": gate._region_counts(baseline, 10, region_of),
        "perturbations": results,
    }


def score_distribution(scores: Mapping[str, Decimal]) -> dict[str, Any]:
    """Mean / stdev / min / max / distinct of a score map."""

    values = list(scores.values())
    if not values:
        return {"count": 0}
    mean = sum(values, start=Decimal("0")) / Decimal(len(values))
    variance = sum(((v - mean) ** 2 for v in values), start=Decimal("0")) / Decimal(len(values))
    return {
        "count": len(values),
        "mean": format(mean.quantize(Decimal("0.0001")), "f"),
        "stdev": format(variance.sqrt().quantize(Decimal("0.0001")), "f"),
        "min": format(min(values).quantize(Decimal("0.0001")), "f"),
        "max": format(max(values).quantize(Decimal("0.0001")), "f"),
        "distinct": len(set(values)),
    }


def spearman(
    baseline: Mapping[str, Decimal], variant: Mapping[str, Decimal]
) -> str | None:
    return _fmt(stats.spearman(baseline, variant))
