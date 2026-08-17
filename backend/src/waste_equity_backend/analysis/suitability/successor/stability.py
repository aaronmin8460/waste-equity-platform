"""Successor stability — defined over the successor axes, never inherited.

The historical stability class is top-decile membership across the three
historical weight profiles (``baseline``/``equity_focused``/``access_focused``).
It cannot be reused here: those profiles are vectors over
zoning/road/equity/demand, and the successor has one approved profile rather than
a registry of three. Reusing the historical class would assert that a successor
candidate had been tested against profiles that do not exist.

What is defined instead follows the perturbation axis Phase 4 already specified
(``policy.STABILITY_CONTRACT_DESIGN['perturbation_axes']['weights']``): move a
fixed step of weight onto each component in turn, and ask how often the candidate
survives in the top fraction.

Two properties make this defensible rather than arbitrary:

* **Symmetric.** There is exactly one perturbation per component and they all use
  the same step, so no component is privileged by the construction. That matters
  here more than it did historically, because Phase 4 showed the ranking head is
  ``resident_impact``-determined — a perturbation set that happened to include two
  resident-leaning profiles would manufacture instability.
* **Anchored on the approved vector.** Every perturbation is a displacement of
  ``SUCCESSOR_WEIGHT_PROFILES['baseline']``, so the class describes robustness of
  *the approved policy* rather than robustness in the abstract.

A candidate is classified only if it is in the ranking population. Nothing else is
classified, and nothing unclassified is ever presented as stable.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from decimal import Decimal
from typing import Any

from . import policy

# The step moved onto each component in turn, taken equally from the other three.
#
# Size: Phase 4 defined two perturbation axes, 0.05 and 0.15. 0.15 is a *large*
# displacement that reorders the head on its own (+0.15 onto resident_impact
# retains 1/50 of the top 50), so using it as the stability step would classify
# almost everything as sensitive and the class would carry no information. The
# small axis is the right one: it represents a plausible disagreement about
# emphasis rather than a different policy.
#
# Value: 0.06 rather than 0.05, for an arithmetic reason worth stating. The step is
# taken equally from the other three components, and 0.05/3 does not terminate in
# decimal — every profile would then sum to 0.999... instead of 1, and a weight
# vector that misses 1 is exactly the kind of quiet defect this codebase refuses
# elsewhere. 0.06 is the smallest step at or above Phase 4's small axis that
# divides exactly by three (0.02 each), so every profile sums to exactly 1 with no
# rounding residual and no component absorbing the remainder.
STABILITY_WEIGHT_STEP = Decimal("0.06")

# Membership fraction, matching the historical method so the two classes are read
# on the same scale even though they are computed over different components.
STABILITY_TOP_FRACTION = Decimal("0.10")

STABILITY_METHOD = "successor_weight_perturbation_top_fraction"
STABILITY_METHOD_VERSION = "successor-stability-v1"

STABILITY_CLASS_STABLE = "STABLE"
STABILITY_CLASS_CONDITIONAL = "CONDITIONALLY_STABLE"
STABILITY_CLASS_SENSITIVE = "WEIGHT_SENSITIVE"

# One perturbation per component => four. Thresholds are stated as fractions of
# that count so they stay meaningful if the component set ever changes.
STABILITY_PERTURBATION_COUNT = len(policy.COMPONENTS)

STABILITY_DISCLAIMER = (
    "Stability describes how robust a candidate's top-fraction membership is to small "
    "disagreements about the weight vector. It is not a measure of siting quality, legal "
    "suitability, or environmental outcome, and it says nothing about the data limitations "
    "the model carries."
)


def perturbed_profiles() -> dict[str, dict[str, Decimal]]:
    """One perturbation per component, each moving ``STABILITY_WEIGHT_STEP`` onto it.

    The step is taken equally from the other components, so every profile still
    sums to 1 and no component is silently zeroed.
    """

    baseline = {
        component: Decimal(weight)
        for component, weight in policy.SUCCESSOR_WEIGHT_PROFILES[
            policy.SUCCESSOR_WEIGHT_PROFILE_BASELINE
        ].items()
    }
    profiles: dict[str, dict[str, Decimal]] = {}
    others_count = len(policy.COMPONENTS) - 1
    share = STABILITY_WEIGHT_STEP / Decimal(others_count)
    for component in policy.COMPONENTS:
        profile = {
            other: baseline[other] - share for other in policy.COMPONENTS if other != component
        }
        profile[component] = baseline[component] + STABILITY_WEIGHT_STEP
        if any(weight < 0 for weight in profile.values()):
            raise ValueError(
                f"stability perturbation onto {component!r} produces a negative weight; "
                "the step is too large for the approved baseline"
            )
        total = sum(profile.values(), start=Decimal("0"))
        if total != Decimal("1"):
            raise ValueError(
                f"stability profile plus_{component} sums to {total}, not 1; the step must "
                "divide exactly across the other components"
            )
        profiles[f"plus_{component}"] = {c: profile[c] for c in policy.COMPONENTS}
    return profiles


def top_cutoff_rank(ranked_count: int) -> int:
    """``max(1, ceil(N * STABILITY_TOP_FRACTION))``; 0 when nothing is ranked."""

    if ranked_count <= 0:
        return 0
    return max(1, math.ceil(ranked_count * float(STABILITY_TOP_FRACTION)))


def classify(stable_count: int) -> str:
    """Map a survival count onto a class.

    STABLE requires surviving every perturbation; SENSITIVE means surviving at
    most one. The middle band is CONDITIONAL. Stated over the perturbation count
    rather than hard-coded to 4.
    """

    if stable_count >= STABILITY_PERTURBATION_COUNT:
        return STABILITY_CLASS_STABLE
    if stable_count >= STABILITY_PERTURBATION_COUNT - 2:
        return STABILITY_CLASS_CONDITIONAL
    return STABILITY_CLASS_SENSITIVE


def _ranks_from_scores(scores: Mapping[str, Decimal]) -> dict[str, int]:
    """Dense competition ranking, highest score first, ties broken by key.

    Deterministic by construction: the key is the final sort term, so the same
    inputs always produce the same ranks regardless of dict iteration order.
    """

    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    return {key: index + 1 for index, (key, _) in enumerate(ordered)}


def evaluate(
    rankable_keys: Sequence[str],
    component_scores: Mapping[str, Mapping[str, Decimal]],
) -> dict[str, Any]:
    """Classify every rankable candidate against the four perturbations.

    Returns the per-candidate membership detail plus the run-level definition that
    is stored on the run row, so a stored classification stays interpretable
    without the code that produced it.
    """

    profiles = perturbed_profiles()
    cutoff = top_cutoff_rank(len(rankable_keys))

    membership: dict[str, dict[str, bool]] = {key: {} for key in rankable_keys}
    for profile_name, weights in profiles.items():
        totals = {
            key: sum(
                (
                    component_scores[component][key] * weights[component]
                    for component in policy.COMPONENTS
                ),
                start=Decimal("0"),
            )
            for key in rankable_keys
        }
        ranks = _ranks_from_scores(totals)
        for key in rankable_keys:
            membership[key][profile_name] = cutoff > 0 and ranks[key] <= cutoff

    counts = {key: sum(1 for hit in flags.values() if hit) for key, flags in membership.items()}
    classes = {key: classify(count) for key, count in counts.items()}

    tally = {
        STABILITY_CLASS_STABLE: 0,
        STABILITY_CLASS_CONDITIONAL: 0,
        STABILITY_CLASS_SENSITIVE: 0,
    }
    for stability_class in classes.values():
        tally[stability_class] += 1

    return {
        "membership": membership,
        "stable_counts": counts,
        "classes": classes,
        "tally": tally,
        "top_cutoff_rank": cutoff,
        "definition": definition(len(rankable_keys), cutoff, profiles),
    }


def definition(
    ranked_count: int, cutoff: int, profiles: Mapping[str, Mapping[str, Decimal]]
) -> dict[str, Any]:
    """The stored, self-describing stability definition for a successor run."""

    return {
        "method": STABILITY_METHOD,
        "method_version": STABILITY_METHOD_VERSION,
        "component_model_version": policy.COMPONENT_MODEL_VERSION_SUCCESSOR,
        "inherited_from_historical": False,
        "inheritance_note": (
            "The historical stability class is defined over zoning/road/equity/demand and the "
            "historical three-profile registry. It is not reused here, and a successor class "
            "must never be read as comparable with a historical one."
        ),
        "baseline_profile": policy.SUCCESSOR_WEIGHT_PROFILE_BASELINE,
        "weight_step": format(STABILITY_WEIGHT_STEP, "f"),
        "compared_profiles": {
            name: {component: format(weight, "f") for component, weight in weights.items()}
            for name, weights in profiles.items()
        },
        "top_fraction": format(STABILITY_TOP_FRACTION, "f"),
        "ranked_candidate_count": ranked_count,
        "top_cutoff_rank": cutoff,
        "class_definitions": {
            STABILITY_CLASS_STABLE: (
                f"top-fraction under all {STABILITY_PERTURBATION_COUNT} perturbations"
            ),
            STABILITY_CLASS_CONDITIONAL: (
                f"top-fraction under {STABILITY_PERTURBATION_COUNT - 2} or "
                f"{STABILITY_PERTURBATION_COUNT - 1} perturbations"
            ),
            STABILITY_CLASS_SENSITIVE: (
                f"top-fraction under at most {STABILITY_PERTURBATION_COUNT - 3} perturbations"
            ),
        },
        "applicability": (
            "Ranking population only (historical ELIGIBLE screening status INTERSECT strict "
            "complete case). No other candidate is classified, and an unclassified candidate is "
            "never presented as stable."
        ),
        "disclaimer": STABILITY_DISCLAIMER,
    }
