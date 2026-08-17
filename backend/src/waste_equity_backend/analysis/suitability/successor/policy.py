"""Successor-model identity, activation gate, and cross-model reuse guards.

The historical screen has a complete, frozen identity —
``suitability-policy-v2`` / ``suitability-screening-v3`` /
``capital-grid-500m-v1`` / ``critic-weights-v1`` / ``suitability-stability-v1``
(see :mod:`waste_equity_backend.analysis.suitability.policy`). **None of those
constants are read, redefined, or reinterpreted here**, and this module never
changes what a historical run means.

What this module provides is the *boundary* for the successor model:

1. **A separate identity namespace.** Each successor component derivation carries
   its own method version. The model-level policy/derivation identity is
   deliberately **unassigned** (``None``) because the successor model is not yet a
   real analytical policy — see the activation gate below.

2. **An explicit activation gate.** The implementation foundation existing is not
   the same as the model being approved. :func:`assert_activated` always raises
   while :data:`ACTIVATION_BLOCKERS` is non-empty, and it is non-empty until the
   open research dependencies close. This is the mechanism that stops a future
   caller from quietly switching production onto a half-specified model.

3. **Cross-model reuse guards.** The historical CRITIC weights, stability ranks,
   saved Z/R/E/D scenarios, and positional URL weight vectors describe the
   historical component matrix. They are meaningless against the successor
   components, and translating them by *array position* would silently rename
   ``road`` to ``resident_impact``. Every such translation raises
   :class:`CrossModelReuseError` instead of returning a plausible answer.

Nothing here is a legal, permitting, engineering, environmental-review, or final
siting determination.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from .. import critic as historical_critic
from .. import policy as historical_policy
from .. import scenario as historical_scenario
from .contract import (
    COMPONENT_AIR_IMPACT_PROXY,
    COMPONENT_CONTRACT_VERSION,
    COMPONENT_EXISTING_BURDEN,
    COMPONENT_LAND_CONVERSION,
    COMPONENT_RESIDENT_IMPACT,
    NORMALIZATION,
    SUCCESSOR_COMPONENTS,
)

# --------------------------------------------------------------------------- #
# Identity
# --------------------------------------------------------------------------- #

# A stable family label for the successor model. It is *not* a policy version and
# must never be written into ``suitability_analysis_runs.policy_version``.
SUCCESSOR_MODEL_ID = "suitability-successor"

# --------------------------------------------------------------------------- #
# Component-model identity
# --------------------------------------------------------------------------- #

# ``policy_version`` cannot answer "which components produced this run?". It has
# already moved once (v1 → v2) for a reason unrelated to component identity — the
# CRITIC profile and stability output surface — while the component-score formulas
# stayed byte-for-byte unchanged. ``derivation_version`` is overloaded the same
# way, and ``candidate_grid_version`` describes geometry. So component identity
# needs its own identifier, and the component *order* needs to travel with it:
# order is load-bearing for the CRITIC correlation matrix, the scenario hash
# payload, and every export column sequence, and it is not recoverable from a JSON
# object's key order.
#
# These constants are the single source of truth for those two values. They are
# defined here now so guards and tests can reference them, but **nothing writes
# them yet**: no migration, model column, or serializer in this branch persists or
# emits them (see ``SUCCESSOR_PERSISTENCE_NOT_DESIGNED``).
COMPONENT_MODEL_VERSION_HISTORICAL = "suitability-components-zred-v1"
COMPONENT_MODEL_VERSION_SUCCESSOR = "suitability-components-successor-v1"

# The order each model's components are enumerated in.
COMPONENT_ORDER_HISTORICAL: tuple[str, ...] = historical_policy.COMPONENTS
COMPONENT_ORDER_SUCCESSOR: tuple[str, ...] = SUCCESSOR_COMPONENTS

# Stamping an existing run ``zred-v1`` records a fact that is already true — the
# candidate table physically cannot hold any other component model today — so it is
# *labelling*, not a semantic backfill. No stored score, rank, weight,
# classification, status, reason, or geometry is read or written to establish it.
COMPONENT_MODEL_LABELLING_NOTE = (
    "Labelling every existing run 'suitability-components-zred-v1' states what those rows "
    "already are; the schema admits no other component model. No analytical value is read, "
    "written, transformed, or backfilled to establish the label."
)

# The four successor components, re-exported so callers can depend on one name.
COMPONENTS: tuple[str, ...] = SUCCESSOR_COMPONENTS

# The historical four, read-only, for disjointness assertions. Never mutated.
HISTORICAL_COMPONENTS: tuple[str, ...] = historical_policy.COMPONENTS

# Per-derivation method versions. Each is owned by its component module and is
# bumped when *that* derivation's formula, unit handling, availability rule, or
# precision changes. They are independent of every historical version constant.
EXISTING_BURDEN_METHOD_VERSION = "successor-existing-burden-v1"
AIR_IMPACT_PROXY_METHOD_VERSION = "successor-air-impact-proxy-v1"
RESIDENT_IMPACT_METHOD_VERSION = "successor-resident-impact-v1"
LAND_CONVERSION_METHOD_VERSION = "successor-land-conversion-v1"

COMPONENT_METHOD_VERSIONS: dict[str, str] = {
    COMPONENT_EXISTING_BURDEN: EXISTING_BURDEN_METHOD_VERSION,
    COMPONENT_AIR_IMPACT_PROXY: AIR_IMPACT_PROXY_METHOD_VERSION,
    COMPONENT_RESIDENT_IMPACT: RESIDENT_IMPACT_METHOD_VERSION,
    COMPONENT_LAND_CONVERSION: LAND_CONVERSION_METHOD_VERSION,
}

# The model-level analytical identity, minted by the project-owner delegated policy
# closure of 2026-08-17 (docs/research/SUITABILITY_V3_FINAL_POLICY.md).
#
# Minting the policy identity is NOT activation. The identity says "an approved
# analytical policy exists and this is its version"; activation additionally
# requires the engineering blockers below to close. ``is_activated()`` therefore
# still returns False, and no run row can carry these values until a runtime
# writes one.
SUCCESSOR_POLICY_VERSION: str | None = "suitability-successor-policy-v1"
SUCCESSOR_DERIVATION_VERSION: str | None = "suitability-successor-derivation-v1"

# --------------------------------------------------------------------------- #
# Approved weight vector
# --------------------------------------------------------------------------- #

# EQUAL WEIGHTING, adopted as the governance-neutral Successor-V3 baseline.
#
# What this is: a project-approved analytical-policy assertion, versioned and
# revisable, made under explicit project-owner delegation on 2026-08-17.
#
# What it is NOT, stated plainly because the distinction is the whole point:
#   * it is NOT claimed to be empirically optimal, and no evidence says it is;
#   * it is NOT an expert, AHP, or stakeholder-elicited result;
#   * it is NOT data-derived — Phase 4 closed that route by establishing CRITIC
#     measures normalization and analytical grain rather than information
#     (Spearman 0.9999988 across a change that moved a component's sigma 11.9%);
#   * it has NOT been through external expert review.
#
# Why equal rather than an asymmetric vector: every asymmetric vector available
# here would assert a *preference ordering over the four considerations* that
# nothing in the repository, the source data, or the measured evidence supports.
# Equal weighting is the one vector that declines to assert such an ordering. It
# is chosen for that property, not because it scored well.
#
# The measured consequence is recorded rather than hidden: the ranking head is
# resident_impact-determined (moving 0.15 onto it retains 1 of the top 50, while
# the same shift onto any other component retains 44-49), so this vector's
# stability is asymmetric and later policy versions may reasonably change it.
SUCCESSOR_WEIGHT_PROFILE_BASELINE = "baseline"

SUCCESSOR_WEIGHT_PROFILES: dict[str, dict[str, str]] = {
    SUCCESSOR_WEIGHT_PROFILE_BASELINE: {
        COMPONENT_EXISTING_BURDEN: "0.25",
        COMPONENT_AIR_IMPACT_PROXY: "0.25",
        COMPONENT_RESIDENT_IMPACT: "0.25",
        COMPONENT_LAND_CONVERSION: "0.25",
    },
}

# One sentence per weight, stating what the weight asserts — the form
# docs/ANALYTICAL_METHODS.md "Weighting Policy" item 1 requires before any
# weighted composite is served.
SUCCESSOR_WEIGHT_RATIONALE: dict[str, str] = {
    COMPONENT_EXISTING_BURDEN: (
        "0.25 asserts that the waste-facility throughput a district already carries per "
        "resident weighs neither more nor less than the other three considerations — the "
        "platform's equity premise is that existing burden must count, and this weight "
        "declines to claim how much more than the rest it should count."
    ),
    COMPONENT_AIR_IMPACT_PROXY: (
        "0.25 asserts that the district's waste-generation-derived air-impact proxy counts "
        "equally with the others, and deliberately does not elevate it, because the proxy is "
        "a generation rate rather than a measured emission or dispersion result."
    ),
    COMPONENT_RESIDENT_IMPACT: (
        "0.25 asserts that population-weighted proximity counts equally, and specifically "
        "declines to elevate it: Phase 4 measured that moving 0.15 onto this component "
        "retains 1 of the top 50, so any elevation would rewrite the ranking head, and no "
        "evidence supports doing so. Its underlying geography is also the coarsest of the "
        "four (one value per SIGUNGU at one representative point), which is a reason not to "
        "let it dominate."
    ),
    COMPONENT_LAND_CONVERSION: (
        "0.25 asserts that the share of the candidate cell not already in a developed class "
        "counts equally — siting on already-converted land is preferable, and this weight "
        "does not claim that preference outranks existing burden, air impact, or proximity."
    ),
}

# The successor model reuses the *existing* candidate grid identity rather than
# inventing a second geography. It is recorded here as a read-only reference; the
# grid version constant itself continues to live in the historical policy module.
CANDIDATE_GRID_VERSION_REFERENCE = historical_policy.CANDIDATE_GRID_VERSION

DISCLAIMER = (
    "Successor-model foundation only. These components are implemented and tested "
    "but are not an activated analytical policy: no weight vector is approved, no "
    "run is scored with them, and no historical result is reinterpreted. Output is "
    "analytical decision support, never a legal, permitting, engineering, "
    "environmental-review, or final siting determination."
)


# --------------------------------------------------------------------------- #
# Activation gate
# --------------------------------------------------------------------------- #


# --------------------------------------------------------------------------- #
# Missing-component eligibility policy — declared, enumerated, and UNDECIDED
# --------------------------------------------------------------------------- #

# The historical engine's rule is "any missing component ⇒ REVIEW_REQUIRED". Under
# that rule every successor component *shrinks* the eligible set rather than
# re-ranking it, because each one is unavailable for a real and non-trivial share
# of units. That makes missing-value handling a **model policy decision**, not an
# implementation detail — and it is deliberately not made here.
#
# Two coherent options exist, plus one that is permanently forbidden:
MISSING_POLICY_STRICT = "STRICT_ALL_COMPONENTS_REQUIRED"
MISSING_POLICY_OPTIONAL_RENORMALIZED = "OPTIONAL_COMPONENT_RENORMALIZED"
MISSING_POLICY_ZERO_FILL = "ZERO_FILL"

MISSING_COMPONENT_POLICIES: dict[str, str] = {
    MISSING_POLICY_STRICT: (
        "The historical rule, unchanged: a unit missing any component is REVIEW_REQUIRED "
        "and never ranked. Honest and already implemented, but it shrinks the eligible "
        "population by the union of every component's unavailability, which must be "
        "measured before it is adopted."
    ),
    MISSING_POLICY_OPTIONAL_RENORMALIZED: (
        "A declared subset of components is optional: a unit missing only optional "
        "components stays eligible and its composite renormalizes over the components "
        "actually present — the mechanism policy.provisional_composite already implements "
        "and tests for review candidates, promoted to a first-class rule. Nothing is "
        "zero-filled; the unit loses the component, not its eligibility."
    ),
    MISSING_POLICY_ZERO_FILL: (
        "FORBIDDEN. Substituting 0 for an unobserved component asserts a measurement that "
        "was never made, and 0 is the *best possible* score for every LOWER_RAW_IS_BETTER "
        "component — so it would systematically promote exactly the units with the least "
        "evidence. This violates the project's missing-is-never-safe rule."
    ),
}

# Permanently rejected; listed above only so the rejection is explicit and testable.
FORBIDDEN_MISSING_COMPONENT_POLICIES: frozenset[str] = frozenset({MISSING_POLICY_ZERO_FILL})

# DECIDED in Phase 4 against the measured post-correction population, not inherited.
#
# The renormalized option was rejected on evidence, not on principle. Phase 4
# measured whether the units that lose a component are exchangeable with the
# complete cases — the property a shared ranking silently assumes — and they are
# not. On the corrected run-47 population (33,980 complete cases):
#
#   making air_impact_proxy optional admits 758 further units whose mean
#   resident_impact score is 81.10 against the complete cases' 49.79 (+31.31);
#
#   making land_conversion optional admits 4,612 further units whose mean
#   existing_burden score is 56.68 against the complete cases' 33.29 (+23.39).
#
# Those groups are systematically different on the components they *do* have, so a
# renormalized three-component composite and a four-component one are not measuring
# comparable things, and ranking them together would promote the less-evidenced
# group for reasons unrelated to siting. Making existing_burden optional was
# measured too and admits exactly zero further units — its unavailability is a
# strict subset of air_impact_proxy's — so that variant buys nothing at any price.
#
# Strict keeps the eligible set honest at a measured cost of 29.05% of candidates
# and 24.13% of residents. That cost is real and is carried forward as an explicit
# limitation, not as a solved problem.
SELECTED_MISSING_COMPONENT_POLICY: str | None = MISSING_POLICY_STRICT

# Empty under STRICT by definition: no component is optional.
OPTIONAL_COMPONENTS: tuple[str, ...] = ()

# --------------------------------------------------------------------------- #
# Ranking population — eligibility is NOT the same thing as a score
# --------------------------------------------------------------------------- #

# The successor model re-scores; it does not re-screen. The historical constraint
# screening (zoning, protected areas, road access) stays authoritative, and the
# successor ranks only what that screening already ranks.
#
# Measured on run 47, which is why this is a rule and not a preference: only
# ELIGIBLE candidates carry a rank or a score at all — 17,501 ranked, while all
# 18,132 REVIEW_REQUIRED and 12,260 EXCLUDED carry neither. The strict complete
# case of 33,980 is a component-AVAILABILITY set and contains 8,933 EXCLUDED and
# 11,313 REVIEW_REQUIRED candidates. Ranking it whole would publish a siting
# recommendation over locations the constraint screening had already set aside,
# which docs/ANALYTICAL_METHODS.md "Weighting Policy" item 2 forbids: burden and
# demand indicators alone must never be presented as siting suitability.
SCREENING_STATUS_RANKABLE = "ELIGIBLE"

RANKING_POPULATION_RULE = (
    "successor ranking population = historical screening status ELIGIBLE INTERSECT strict "
    "complete case over all four successor components. Run 47: 13,734 of 33,980 complete "
    "cases and of 17,501 ELIGIBLE candidates. A candidate outside this set is not scored, "
    "not ranked, and never zero-filled."
)


def resolve_missing_component_policy(policy_name: str) -> str:
    """Validate a proposed missing-component policy, refusing the forbidden one.

    This is the gate any future engine stage calls before applying a policy. It
    never returns ``ZERO_FILL``, and it never invents a default.
    """

    if policy_name in FORBIDDEN_MISSING_COMPONENT_POLICIES:
        raise CrossModelReuseError(
            f"missing-component policy {policy_name!r} is permanently forbidden: "
            + MISSING_COMPONENT_POLICIES[policy_name],
            {"policy": policy_name},
        )
    if policy_name not in MISSING_COMPONENT_POLICIES:
        raise CrossModelReuseError(
            f"unknown missing-component policy {policy_name!r}; expected one of "
            f"{sorted(set(MISSING_COMPONENT_POLICIES) - FORBIDDEN_MISSING_COMPONENT_POLICIES)}",
            {"policy": policy_name},
        )
    return policy_name


@dataclass(frozen=True)
class ActivationBlocker:
    """One open dependency that must close before the successor model activates."""

    blocker_id: str
    summary: str
    blocks: str
    resolution_owner: str

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "blocker_id": self.blocker_id,
            "summary": self.summary,
            "blocks": self.blocks,
            "resolution_owner": self.resolution_owner,
        }


# Every activation blocker is now closed — the analytical ones by the project-owner
# delegated policy closure of 2026-08-17, the engineering ones by the Phase-5
# runtime. See CLOSED_BLOCKERS for what closed and on what basis, and
# ACCEPTED_LIMITATIONS for the two data defects that are carried in published scope
# rather than blocking activation.
#
# **Activation is not a default switch.** An empty blocker list means the successor
# model may produce and serve runs under its own identity. Which model an unpinned
# request resolves to is a separate, deliberately separate decision, held in
# ``component_model.DEFAULT_COMPONENT_MODEL`` and still pinned to the historical
# model. Writing a successor run therefore changes nothing a user sees until that
# constant is changed by an explicit, reviewed edit.
ACTIVATION_BLOCKERS: tuple[ActivationBlocker, ...] = ()


@dataclass(frozen=True)
class ClosedBlocker:
    """An activation blocker that has been closed, and the basis for closing it."""

    blocker_id: str
    closed_by: str
    basis: str

    def sanitized_summary(self) -> dict[str, Any]:
        return {"blocker_id": self.blocker_id, "closed_by": self.closed_by, "basis": self.basis}


# The audit trail. A closed blocker is not deleted — the reason it stopped
# blocking is part of the policy record and is asserted by tests.
POLICY_CLOSURE_APPROVAL = (
    "Project-owner delegated policy closure, 2026-08-17, recorded in "
    "docs/research/SUITABILITY_V3_FINAL_POLICY.md. This is an explicit project-owner "
    "judgement made under delegation. It is NOT external expert review, NOT an AHP or "
    "elicitation result, and NOT a claim of empirical optimality."
)

CLOSED_BLOCKERS: tuple[ClosedBlocker, ...] = (
    ClosedBlocker(
        blocker_id="SUCCESSOR_WEIGHT_VECTOR_UNAPPROVED",
        closed_by=POLICY_CLOSURE_APPROVAL,
        basis=(
            "Equal weighting (0.25 each) approved as the governance-neutral baseline, with a "
            "written rationale per weight in SUCCESSOR_WEIGHT_RATIONALE. Chosen because it is "
            "the one vector that asserts no unsupported preference ordering, not because it "
            "scored well; the asymmetric weight-sensitivity of the ranking head is recorded "
            "rather than resolved."
        ),
    ),
    ClosedBlocker(
        blocker_id="SUCCESSOR_CRITIC_UNSUITABLE_FOR_WEIGHTING",
        closed_by=POLICY_CLOSURE_APPROVAL,
        basis=(
            "Satisfied rather than overturned: CRITIC is confirmed DIAGNOSTIC ONLY and the "
            "approved vector is not data-derived, so no CRITIC weight is persisted, served, or "
            "used to score a successor run."
        ),
    ),
    ClosedBlocker(
        blocker_id="RESIDENT_IMPACT_DISTANCE_FLOOR_UNAPPROVED",
        closed_by=POLICY_CLOSURE_APPROVAL,
        basis=(
            "500 m approved (resident_impact.PRODUCTION_DISTANCE_FLOOR), on the basis that it "
            "is exactly one candidate grid cell — the model does not resolve distance below "
            "its own spatial resolution. Measured as near-inert in the composite: adjacent "
            "floors retain 50/50, 50/50 and 49/50 of the top 50."
        ),
    ),
    ClosedBlocker(
        blocker_id="LAND_COVER_DEVELOPED_CLASS_REGISTRY_UNAVAILABLE",
        closed_by=POLICY_CLOSURE_APPROVAL,
        basis=(
            "land_conversion.PRODUCTION_REGISTRY populated with successor-land-cover-l2-v1: "
            "22 published L2 codes, developed = the 1xx 시가화건조지역 grouping only. It is an "
            "approved project reading of the published code structure, explicitly NOT an "
            "authority's developed/natural designation — none exists."
        ),
    ),
    ClosedBlocker(
        blocker_id="LAND_CONVERSION_DIRECTION_UNAPPROVED",
        closed_by=POLICY_CLOSURE_APPROVAL,
        basis=(
            "Direction approved as implemented: a larger not-already-developed share is the "
            "worse screening outcome, because siting on already-converted land converts less."
        ),
    ),
    ClosedBlocker(
        blocker_id="SUCCESSOR_RUN_WRITE_PATH_NOT_IMPLEMENTED",
        closed_by="Phase 5 runtime, 2026-08-17",
        basis=(
            "successor.runtime.build_successor_run writes a successor run derived from a "
            "historical source run, copying screening status and geometry rather than "
            "re-deriving them. Validated on run 47: 47,893 candidates, 13,734 ranked, 0 of "
            "47,893 statuses differing from the source, 0 ranked candidates that are not "
            "ELIGIBLE, 0 legacy score columns written, and the source run still carrying all "
            "17,501 of its own scores."
        ),
    ),
    ClosedBlocker(
        blocker_id="SUCCESSOR_STABILITY_THRESHOLDS_UNVALIDATED",
        closed_by="Phase 5 runtime, 2026-08-17",
        basis=(
            "successor.stability defines the class over successor axes only — one symmetric "
            "perturbation per component, anchored on the approved baseline — and the "
            "historical class is not inherited. Thresholds validated on run 47: 1,195 STABLE, "
            "214 CONDITIONALLY_STABLE, 12,325 WEIGHT_SENSITIVE at a top-decile cutoff of "
            "1,374, so every class is populated and none is degenerate."
        ),
    ),
    ClosedBlocker(
        blocker_id="SUCCESSOR_MODEL_AWARE_DEFAULT_RUN_NOT_IMPLEMENTED",
        closed_by="already shipped in Phase 2; verified in Phase 5",
        basis=(
            "component_model.DEFAULT_COMPONENT_MODEL is pinned to the historical model and "
            "api.routes.suitability._resolve_run_id already scopes an unpinned request to that "
            "model, so writing a successor run cannot move the default. Covered by "
            "test_the_default_run_stays_historical_when_a_successor_shaped_run_is_newer. "
            "Step 1 of the approved switchover sequence was therefore already in place before "
            "the first successor run was written, which is the ordering the sequence requires."
        ),
    ),
    ClosedBlocker(
        blocker_id="SUCCESSOR_NORMALIZATION_STRATEGY_UNAPPROVED",
        closed_by=POLICY_CLOSURE_APPROVAL,
        basis=(
            "Phase 4's measured choice approved: BOUNDED_RATIO where the raw value is a "
            "bounded ratio (land_conversion only), percentile rank elsewhere because the other "
            "three raws are unbounded rates. Percentile-ranking a bounded ratio was measured "
            "to buy no ranking change (Spearman 0.9999988, top-50 50/50) while inflating its "
            "standard deviation 11.9%."
        ),
    ),
)


@dataclass(frozen=True)
class AcceptedLimitation:
    """A known defect carried in published scope instead of blocking activation."""

    limitation_id: str
    summary: str
    measured_cost: str
    why_not_blocking: str

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "limitation_id": self.limitation_id,
            "summary": self.summary,
            "measured_cost": self.measured_cost,
            "why_not_blocking": self.why_not_blocking,
        }


# These two are NOT closed and NOT solved. They are accepted, published limits on
# what the model claims. Neither can be closed by a decision — both need data that
# does not exist locally — and neither is made better by refusing to ship.
ACCEPTED_LIMITATIONS: tuple[AcceptedLimitation, ...] = (
    AcceptedLimitation(
        limitation_id="AIR_IMPACT_PROXY_GRAIN_AND_COVERAGE_UNRESOLVED",
        summary=(
            "One ingestion-level defect affects two components: 99 facility rows carrying "
            "1,907,717.3 t/yr are ungeocoded, and RCIS reports seven large Gyeonggi cities at "
            "CITY grain while regions holds only their child 구. Scoring-time behaviour is "
            "strict SIGUNGU with no projection. The numerator basis stays total generation, "
            "as implemented and measured; origin-based incinerated tonnage is a candidate for "
            "a later policy version, not a silent alternative."
        ),
        measured_cost=(
            "22 regions and 6,349,306 residents (24.13% of the capital region) stay outside "
            "the model."
        ),
        why_not_blocking=(
            "The remedy is upstream geocoding or district-grain statistics, neither available "
            "locally. The CITY-grain projection was evaluated numerically and rejected: it "
            "recovers the component for 5,536 candidates but ZERO eligible ones, because the "
            "same districts independently lose existing_burden to the identical gap. Refusing "
            "to activate would not recover a single resident; publishing the exclusion does."
        ),
    ),
    AcceptedLimitation(
        limitation_id="RESIDENT_IMPACT_POPULATION_RESOLUTION_UNRESOLVED",
        summary=(
            "The finest population geography available is one value per SIGUNGU at a single "
            "representative point, so within-region variation in resident_impact reflects that "
            "point's placement as much as anything on the ground."
        ),
        measured_cost=(
            "The within-region score range — an upper bound on the placement artifact — only "
            "falls from 46.71 to 40.55 as the floor rises from 500 m to 5 km, so no available "
            "floor controls it."
        ),
        why_not_blocking=(
            "Closing it needs finer-than-SIGUNGU population geography, which does not exist in "
            "this dataset. The approved floor does not claim to fix it, and the component's "
            "coarse grain is a published property of the model rather than a hidden one."
        ),
    ),
)


class SuccessorActivationBlockedError(RuntimeError):
    """Raised when successor-model activation is attempted while blockers remain.

    ``category`` is a stable machine-readable label, matching the convention used
    by :class:`critic.CriticUndefinedError`.
    """

    category = "SUCCESSOR_MODEL_NOT_ACTIVATED"

    def __init__(self, blockers: Sequence[ActivationBlocker]) -> None:
        detail = "; ".join(f"{b.blocker_id}: {b.summary}" for b in blockers)
        super().__init__(
            "The successor suitability model is not activated. Open blockers: " + detail
        )
        self.blockers = tuple(blockers)


class CrossModelReuseError(RuntimeError):
    """Raised when historical model artifacts are reused for the successor model.

    ``category`` is a stable machine-readable label.
    """

    category = "CROSS_MODEL_REUSE_REJECTED"

    def __init__(self, detail: str, fields: Mapping[str, Any] | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.fields = dict(fields or {})


def activation_blockers() -> tuple[ActivationBlocker, ...]:
    """The open dependencies blocking successor-model activation."""

    return ACTIVATION_BLOCKERS


def is_activated() -> bool:
    """True only when a successor policy identity exists and nothing blocks it."""

    return (
        not ACTIVATION_BLOCKERS
        and SUCCESSOR_POLICY_VERSION is not None
        and SUCCESSOR_DERIVATION_VERSION is not None
    )


def assert_activated() -> None:
    """Raise unless the successor model is fully activated.

    Any future production path — engine stage, persistence writer, API serializer,
    or scenario evaluator — must call this before producing a successor result
    that is presented as an analytical outcome. Component-level derivation and
    testing do **not** call it: computing a component is exactly what the
    foundation is for.
    """

    if not is_activated():
        raise SuccessorActivationBlockedError(ACTIVATION_BLOCKERS)


# --------------------------------------------------------------------------- #
# Component-namespace classification and cross-model guards
# --------------------------------------------------------------------------- #

COMPONENT_SET_HISTORICAL = "HISTORICAL"
COMPONENT_SET_SUCCESSOR = "SUCCESSOR"
COMPONENT_SET_MIXED = "MIXED"
COMPONENT_SET_UNKNOWN = "UNKNOWN"


def classify_component_set(components: Iterable[str]) -> str:
    """Identify which model a component set belongs to.

    Returns ``HISTORICAL``, ``SUCCESSOR``, ``MIXED`` (members of both namespaces —
    always an error at the call site), or ``UNKNOWN``. This is the integration
    seam a future engine stage uses to pick the right CRITIC/stability path
    instead of assuming the historical one applies.
    """

    names = set(components)
    if not names:
        return COMPONENT_SET_UNKNOWN
    historical = names & set(HISTORICAL_COMPONENTS)
    successor = names & set(COMPONENTS)
    if historical and successor:
        return COMPONENT_SET_MIXED
    if historical and historical == names:
        return COMPONENT_SET_HISTORICAL
    if successor and successor == names:
        return COMPONENT_SET_SUCCESSOR
    return COMPONENT_SET_UNKNOWN


def assert_historical_component_set(components: Iterable[str]) -> None:
    """Raise unless ``components`` is exactly the historical component matrix.

    Guards the historical CRITIC/stability/scenario entry points against being
    handed successor rows.
    """

    names = set(components)
    if names != set(HISTORICAL_COMPONENTS):
        raise CrossModelReuseError(
            "This derivation is defined over the historical component matrix "
            f"{list(HISTORICAL_COMPONENTS)}; refusing to run it over {sorted(names)}.",
            {"expected": list(HISTORICAL_COMPONENTS), "received": sorted(names)},
        )


def assert_successor_component_set(components: Iterable[str]) -> None:
    """Raise unless ``components`` is exactly the successor component matrix."""

    names = set(components)
    if names != set(COMPONENTS):
        raise CrossModelReuseError(
            "This derivation is defined over the successor component matrix "
            f"{list(COMPONENTS)}; refusing to run it over {sorted(names)}.",
            {"expected": list(COMPONENTS), "received": sorted(names)},
        )


def assert_component_namespaces_disjoint() -> None:
    """Fail fast if a successor component name ever collides with a historical one.

    A collision would mean a historical column's meaning had been reused for a new
    factor — precisely the reinterpretation this model boundary exists to prevent.
    """

    overlap = set(COMPONENTS) & set(HISTORICAL_COMPONENTS)
    if overlap:
        raise CrossModelReuseError(
            "Successor and historical component namespaces must stay disjoint; "
            f"overlapping names: {sorted(overlap)}.",
            {"overlap": sorted(overlap)},
        )


def translate_historical_weights(weights: Mapping[str, Any]) -> dict[str, Any]:
    """Always raises. Historical weights do not carry over to the successor model.

    ``baseline``/``equal``/``equity_focused``/``access_focused`` and every stored
    run's ``critic`` vector are weights *over the historical components*. Neither a
    name-based nor a position-based mapping onto the successor components is
    meaningful: ``road`` is not ``resident_impact`` and ``equity`` is not
    ``existing_burden``.
    """

    raise CrossModelReuseError(
        "Historical weight profiles are defined over "
        f"{list(HISTORICAL_COMPONENTS)} and cannot be translated to the successor "
        f"components {list(COMPONENTS)}. A successor weight vector must be approved "
        "explicitly, not derived from a historical one.",
        {"received_components": sorted(weights)},
    )


def translate_weights_by_position(weights: Sequence[Any]) -> dict[str, Any]:
    """Always raises. Positional weight translation is structurally unsafe.

    A saved scenario or URL weight vector is ordered by the *historical* component
    order. Reading it positionally into the successor order would silently relabel
    every weight — the exact failure mode this guard exists to make impossible.
    """

    raise CrossModelReuseError(
        "Refusing to map a positional weight vector onto the successor components: "
        f"position {list(range(len(weights)))} means {list(HISTORICAL_COMPONENTS)} in the "
        f"historical model and would be silently relabelled to {list(COMPONENTS)}.",
        {"received_length": len(weights)},
    )


def translate_saved_scenario(scenario_payload: Mapping[str, Any]) -> dict[str, Any]:
    """Always raises. Saved Z/R/E/D scenarios are not successor scenarios.

    A stored user-weight scenario recombines the four *frozen historical* component
    scores of one fixed run. It has no successor equivalent until a successor run
    exists to recombine.
    """

    raise CrossModelReuseError(
        "A saved user-weight scenario "
        f"({historical_scenario.USER_WEIGHT_SCENARIO_METHOD_VERSION}) reweights the historical "
        f"components {list(HISTORICAL_COMPONENTS)} of one stored run and cannot be carried "
        "over to the successor model.",
        {"received_keys": sorted(scenario_payload)},
    )


# --------------------------------------------------------------------------- #
# Snapshot
# --------------------------------------------------------------------------- #


# --------------------------------------------------------------------------- #
# CRITIC pre-flight (successor-scoped)
# --------------------------------------------------------------------------- #

# The historical CRITIC derivation raises when fewer than two complete eligible
# candidates exist or every criterion is perfectly redundant, and that guard has
# been treated as an unreachable path because real runs carry ~10³ eligible
# candidates. Every added required component weakens that assumption: each one
# demotes the units it cannot measure, and a sufficiently collapsed eligible set
# makes a region-level component *exactly constant* — zero variance, zero weight,
# and in the limit an undefined CRITIC that fails the whole build.
#
# So a successor CRITIC derivation must be pre-flighted: assert the population is
# large enough and every component actually varies, and fail loudly at build time
# rather than emit a weight vector that is an artifact of a collapsed population.
# The minimum is deliberately not fixed here — it is part of the same approval as
# the component weights.
CRITIC_PREFLIGHT_MINIMUM_POPULATION_UNAPPROVED = (
    "No minimum eligible-population size is approved for a successor CRITIC derivation; "
    "the caller must pass one explicitly."
)


class SuccessorCriticPreflightError(RuntimeError):
    """Raised when a successor CRITIC derivation would run on a degenerate population.

    ``category`` is a stable machine-readable label, matching the convention used by
    :class:`critic.CriticUndefinedError`.
    """

    category = "SUCCESSOR_CRITIC_PREFLIGHT_FAILED"

    def __init__(self, detail: str, fields: Mapping[str, Any] | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.fields = dict(fields or {})


def critic_preflight(
    rows: Sequence[Mapping[str, Any]], *, minimum_population: int
) -> dict[str, Any]:
    """Assert a successor component matrix can support a CRITIC derivation.

    ``rows`` is one mapping per complete eligible unit, keyed by the successor
    component names. Raises :class:`SuccessorCriticPreflightError` when the
    population is below ``minimum_population`` or any component is constant across
    it. Returns the per-component distinct-value counts so the caller can record
    what it checked.

    ``minimum_population`` has no default: no value is approved, and inventing one
    would put an unreviewed threshold on the build's failure boundary.
    """

    if minimum_population < 2:
        raise SuccessorCriticPreflightError(
            "a CRITIC derivation needs at least 2 complete units; "
            f"minimum_population={minimum_population} is not a usable threshold",
            {"minimum_population": minimum_population},
        )
    if len(rows) < minimum_population:
        raise SuccessorCriticPreflightError(
            f"successor CRITIC population is {len(rows)}, below the required "
            f"{minimum_population}. A collapsed eligible set produces weights that describe "
            "the collapse, not the data.",
            {"population": len(rows), "minimum_population": minimum_population},
        )
    for row in rows:
        assert_successor_component_set(row.keys())

    distinct_counts = {component: len({row[component] for row in rows}) for component in COMPONENTS}
    constant = sorted(c for c, count in distinct_counts.items() if count < 2)
    if constant:
        raise SuccessorCriticPreflightError(
            f"successor components {constant} are constant across the eligible population, "
            "so they carry no information and their derived weight would be zero. Fail here "
            "rather than publish a weight vector that reflects a degenerate population.",
            {"constant_components": constant, "distinct_value_counts": distinct_counts},
        )
    return {
        "population": len(rows),
        "minimum_population": minimum_population,
        "distinct_value_counts": distinct_counts,
    }


# --------------------------------------------------------------------------- #
# Persistence design contract (declared, not applied)
# --------------------------------------------------------------------------- #

# The narrowest safe additive design for storing successor scores, recorded here as
# the single source of truth so the decision stays reviewable and testable.
#
# **The schema is now applied** (alembic ``0022`` run-level identity, ``0023``
# candidate-level ``component_scores``), and the API serves it — see
# ``analysis.suitability.component_model`` and
# ``docs/SUITABILITY_COMPONENT_MODEL_CONTRACT.md``. What is *not* applied is any
# successor write: no engine stage produces a successor run, no successor score is
# stored, and the columns hold their historical labelling defaults on every row.
#
# The load-bearing property is that the successor model has *no column to be
# cross-wired into*. Four adjacent Numeric(7,4) columns and a fifth successor
# quantity are one careless edit away from each other; a NULL legacy column and a
# separate versioned map are not.
PERSISTENCE_DESIGN: dict[str, Any] = {
    "status": "APPLIED_ADDITIVE_SCHEMA_ONLY",
    "applied_migrations": ["0022", "0023"],
    "not_applied": (
        "No successor run write path exists: nothing produces a successor run, so "
        "component_scores is {} and the legacy columns are populated on every stored row."
    ),
    "run_level": {
        "table": "suitability_analysis_runs",
        "added_columns": {
            "component_model_version": (
                f"String(50) NOT NULL, server_default '{COMPONENT_MODEL_VERSION_HISTORICAL}'"
            ),
            "component_order": (
                f"JsonVariant NOT NULL, server_default '{list(COMPONENT_ORDER_HISTORICAL)}'"
            ),
        },
        "rationale": (
            "policy_version and derivation_version have both already moved for reasons "
            "unrelated to component identity, so neither can answer 'which components "
            "produced this run?'. Component order is not recoverable from a JSON object's "
            "key order and is load-bearing for correlation matrices, hash payloads, and "
            "export column sequences."
        ),
    },
    "candidate_level": {
        "table": "suitability_candidates",
        "added_columns": {
            "component_scores": "JsonVariant NOT NULL, server_default '{}'",
        },
        "write_rules": [
            "Historical runs: nothing written, nothing backfilled; component_scores stays {}. "
            "The four legacy *_score columns remain the sole authoritative storage.",
            "Successor runs: component_scores is populated; the four legacy columns are "
            "written NULL and are never reused for any successor quantity.",
            "No historical component score is ever copied into component_scores — a second "
            "copy of an authoritative analytical value can drift from the first.",
        ],
    },
    "signature": (
        "component_model_version must be added to the analysis signature payload so model "
        "identity is a signed input rather than a convention that two versions always move "
        "together. This changes future signatures only; stored signatures are never recomputed."
    ),
    "rollback_constraint": (
        "Dropping candidate-level component_scores is safe only before the first successor "
        "run is written: after that the legacy columns are NULL for those rows and hold "
        "nothing to fall back on. Historical runs are unaffected by the rollback in all cases."
    ),
    "explicitly_not_required": [
        "successor *_score columns (they could be cross-wired with the historical four)",
        "a normalized candidate_component_scores child table",
        "a component catalogue table (the project's pattern is code registry + per-run snapshot)",
        "any alteration, rename, or drop of an existing column",
        "any data migration of any kind",
    ],
}


# --------------------------------------------------------------------------- #
# Phase-4 stability contract (defined, not yet satisfiable)
# --------------------------------------------------------------------------- #

# The historical stability contract classifies a candidate by how often it stays
# in the eligible set across the historical weight profiles. It is NOT inherited:
# it is defined over a different component matrix and a different profile
# registry, and the successor has no profile registry at all. What "stable" means
# for the successor is defined here from successor-specific evidence, and cannot
# be *evaluated* until a weight vector exists — which is the point.
#
# The perturbation axes are the four things Phase 4 showed actually move the
# result, with the measured run-47 behaviour of each recorded beside it.
STABILITY_CONTRACT_DESIGN: dict[str, Any] = {
    "status": "DEFINED_NOT_SATISFIABLE",
    "reason": (
        "Every axis below is measurable, but a stability *classification* needs an approved "
        "reference weight vector to perturb around, and none exists."
    ),
    "inherited_from_historical": False,
    "inheritance_note": (
        "The historical stability class is defined over zoning/road/equity/demand and the "
        "historical weight-profile registry. Reusing it would assert that a successor "
        "candidate's robustness had been tested against profiles that do not exist."
    ),
    "metrics": [
        "Spearman rank correlation over the complete-case population",
        "top-10 overlap",
        "top-50 overlap",
        "regional concentration of the top 50 (candidates per SIGUNGU)",
        "eligible-population delta",
    ],
    "perturbation_axes": {
        "weights": {
            "definition": "move 0.05 and 0.15 of weight onto each component in turn",
            "measured_run_47": (
                "asymmetric: +0.15 onto resident_impact retains 1/50 of the top 50 "
                "(Spearman 0.852); the same shift onto existing_burden retains 49/50, onto "
                "air_impact_proxy 44/50, onto land_conversion 44/50"
            ),
        },
        "resident_distance_floor": {
            "definition": "recompute resident_impact at 500 m / 1 km / 2 km / 5 km",
            "measured_run_47": (
                "scale-dependent: on the component alone 500 m vs 5 km retains 33/50 of the "
                "top 50 (Spearman 0.9956, max move 20,979 ranks); inside an equal-weighted "
                "four-component composite the same change retains 49/50 (Spearman 0.9982). "
                "The floor's importance is therefore a function of resident_impact's weight "
                "and cannot be settled before it."
            ),
        },
        "normalization": {
            "definition": "bounded ratio vs percentile rank per component",
            "measured_run_47": (
                "rank-neutral, weight-decisive: on land_conversion the two strategies agree "
                "at Spearman 0.9999988 with a 50/50 top-50 overlap, while the standard "
                "deviation moves 24.92 -> 27.87 (+11.9%)"
            ),
        },
        "missingness_and_eligibility": {
            "definition": "strict complete case vs each single-optional-component variant",
            "measured_run_47": (
                "strict 33,980 (70.95%); optional air_impact_proxy +758, optional "
                "land_conversion +4,612, optional existing_burden +0. The admitted groups are "
                "not exchangeable with the complete cases (see "
                "SELECTED_MISSING_COMPONENT_POLICY)."
            ),
        },
    },
    "acceptance_criteria": (
        "UNSET. Thresholds must be argued against an approved weight vector and an approved "
        "floor; setting them now would fix the target to whatever the current data happens to "
        "produce."
    ),
}


# --------------------------------------------------------------------------- #
# Phase-4D runtime / version behaviour (designed, NOT activated)
# --------------------------------------------------------------------------- #

# Everything here is a design record. No value in it is read by a runtime path, no
# successor version identifier is minted, and no default-run behaviour changes.
SUCCESSOR_RUNTIME_DESIGN: dict[str, Any] = {
    "status": "DESIGNED_NOT_ACTIVATED",
    "model_version": {
        "component_model_version": COMPONENT_MODEL_VERSION_SUCCESSOR,
        "policy_version": (
            "UNMINTED. A successor policy_version may only be minted when every activation "
            "blocker is closed; until then SUCCESSOR_POLICY_VERSION is None so no run row can "
            "carry a plausible-looking successor identity by accident."
        ),
        "derivation_version": "UNMINTED, same rule.",
        "identity_rule": (
            "component_model_version answers 'which components produced this run?' and is "
            "independent of policy_version and derivation_version, both of which have already "
            "moved for unrelated reasons. It must be part of the signed analysis signature."
        ),
    },
    "scenario_versions": {
        "rule": (
            "A saved scenario stores weights against a component namespace. A historical "
            "scenario's four weights are meaningless over the successor components and must "
            "never be positionally re-read as successor weights — translate_weights_by_position "
            "exists to refuse exactly that, not to enable it."
        ),
        "behaviour": (
            "Successor user-weight scenarios stay refused while no successor weight vector is "
            "approved. A stored scenario must record the component_model_version it was "
            "authored against; one authored under a different model is surfaced as "
            "incompatible rather than silently recombined."
        ),
    },
    "coexistence": {
        "rule": (
            "Historical and successor runs coexist as peers in one table, distinguished by "
            "component_model_version. Historical runs keep the four legacy *_score columns as "
            "their sole authoritative storage; successor runs write component_scores and leave "
            "the legacy columns NULL. Neither reads the other's storage."
        ),
        "historical_guarantee": (
            "Every stored historical run stays byte-identical and fully interpretable. No "
            "historical score, weight, profile, rank, CRITIC vector, or stability class is "
            "recomputed, relabelled, or reinterpreted by successor activation."
        ),
        "verified": (
            "The component namespaces are asserted disjoint at import time and the historical "
            "CRITIC criterion order is asserted unchanged (validate_successor_policy)."
        ),
    },
    "default_run_resolution": {
        "current_behaviour": (
            "Default-run resolution selects the latest succeeded run regardless of component "
            "model. The first successful successor run would therefore silently switch every "
            "default view and every un-pinned shared link to a different model."
        ),
        "required_change": (
            "Default-run resolution must become component-model-aware: the default resolves "
            "within an explicitly configured component model, so writing a successor run "
            "cannot move the default as a side effect. This must ship BEFORE the first "
            "successor run is written, not with it."
        ),
        "open": "Which model is the configured default, and who flips it, is a product decision.",
    },
    "switchover": {
        "sequence": [
            "1. component-model-aware default-run resolution ships while the default stays "
            "pinned to the historical model",
            "2. a successor run is written and is reachable only by explicit run id",
            "3. the successor result is reviewed against the historical one on the same grid",
            "4. the default is moved by an explicit configuration change, reversible without "
            "a data migration",
        ],
        "rollback": (
            "Reverting the default is a configuration change: historical runs are untouched "
            "throughout, so rollback never needs to restore or recompute anything."
        ),
        "irreversibility_note": (
            "Dropping candidate-level component_scores stops being safe once the first "
            "successor run exists, because those rows' legacy columns are NULL by design."
        ),
    },
    "api_exposure": {
        "rule": (
            "A successor result must be labelled with its component model wherever it is "
            "served, and a derived or coarser-geography input must be labelled as derived "
            "rather than presented as an official observation of that unit."
        ),
        "not_implemented_here": (
            "Phase 4 changes no frontend and no API wording. This records the requirement "
            "that any later exposure work must satisfy."
        ),
    },
}


# --------------------------------------------------------------------------- #
# Phase-4 decision register
# --------------------------------------------------------------------------- #

DECISION_DECIDED = "POLICY_DECIDED"
DECISION_RESOLVED = "RESOLVED"
DECISION_DEFERRED = "DEFERRED"
DECISION_OPEN = "OPEN"


@dataclass(frozen=True)
class PolicyDecision:
    """One Phase-4 gate decision, its status, and the evidence behind it."""

    decision_id: str
    status: str
    summary: str
    evidence: str

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "status": self.status,
            "summary": self.summary,
            "evidence": self.evidence,
        }


# Every Phase-4 question, with an explicit status. A question that could not be
# answered on evidence is recorded OPEN rather than answered anyway.
PHASE4_DECISIONS: tuple[PolicyDecision, ...] = (
    PolicyDecision(
        decision_id="LAND_CONVERSION_AREA_RECONCILIATION",
        status=DECISION_RESOLVED,
        summary=(
            "A dimensionless relative tolerance (1e-9 of the denominator area, m²) separates "
            "float↔Decimal representation disagreement from a materially invalid class sum. "
            "Shares inside the tolerance are clamped into [0,1] and the clamp is recorded."
        ),
        evidence=(
            "run 47: worst excess anywhere 7.33e-6 m² / 2.93e-11 relative across 40,427 "
            "covered cells; no cell exceeds its denominator by even 1e-4 m². Recovered 11,653 "
            "candidates (28,853 -> 40,506 available)."
        ),
    ),
    PolicyDecision(
        decision_id="EXISTING_BURDEN_UNMAPPED_FACILITY_EVIDENCE",
        status=DECISION_RESOLVED,
        summary=(
            "Facility evidence the source holds for a region but cannot attribute to it is "
            "declared explicitly. A region with such evidence and nothing located of its own "
            "is unavailable, not zero; a region with both is available and flagged as an "
            "undercount."
        ),
        evidence=(
            "run 47: 99 REQUIRES_GEOCODE rows carrying 1,907,717.3 t/yr (21.7% of all located "
            "throughput) were silently dropped, leaving 20 districts reading zero burden — the "
            "best possible score. 79 -> 59 available regions; the 5 genuinely facility-free "
            "districts correctly keep their observed zero."
        ),
    ),
    PolicyDecision(
        decision_id="PERCENTILE_RANK_COMPLEXITY",
        status=DECISION_RESOLVED,
        summary=(
            "policy.percentile_ranks counts strictly-lesser values by bisection over the "
            "sorted values instead of rescanning per key. The definition is unchanged and the "
            "output is byte-identical."
        ),
        evidence=(
            "n=47,893: 267.450 s -> 0.117 s (2,285x), identical key-for-key. Pinned in "
            "test_suitability_policy.py against the original body kept verbatim as an oracle."
        ),
    ),
    PolicyDecision(
        decision_id="CANDIDATE_REGION_MAPPING",
        status=DECISION_RESOLVED,
        summary=(
            "The 553 candidates without a SIGUNGU code are expected geography, not a defect to "
            "repair. No code is fabricated and none is dropped silently."
        ),
        evidence=(
            "All 553 centroids fall inside their SIDO polygon and outside every SIGUNGU "
            "polygon — the two layers do not coincide (gap: Seoul 19.63 km², Incheon 48.80 "
            "km², Gyeonggi 106.07 km²). Median distance to the nearest SIGUNGU is 130-162 m "
            "and 366 are within 250 m. The historical engine already flags all 455 "
            "REVIEW_REQUIRED ones as AMBIGUOUS_OR_MISSING_SIGUNGU; none of the 553 is "
            "ELIGIBLE, so the eligible-population consequence is zero."
        ),
    ),
    PolicyDecision(
        decision_id="MISSING_COMPONENT_POLICY",
        status=DECISION_DECIDED,
        summary="STRICT_ALL_COMPONENTS_REQUIRED. See SELECTED_MISSING_COMPONENT_POLICY.",
        evidence=(
            "The groups admitted by each renormalized variant are not exchangeable with the "
            "complete cases (+31.31 mean resident_impact, +23.39 mean existing_burden). Cost: "
            "33,980 eligible (70.95%), 57 of 79 regions, 19,958,650 of 26,307,956 residents."
        ),
    ),
    PolicyDecision(
        decision_id="AIR_IMPACT_GRAIN",
        status=DECISION_DECIDED,
        summary=(
            "Scoring time: strict SIGUNGU, option A. The CITY-grain projection (option B) is "
            "rejected for production. The root-cause remedy is DEFERRED to the ingestion lane."
        ),
        evidence=(
            "Projection would recover the component for 20 regions / 5,536 candidates but zero "
            "*eligible* candidates, because those same districts independently lose "
            "existing_burden and facility throughput cannot be projected per capita. The "
            "within-city uniformity assumption is also untestable here: no city in the dataset "
            "is reported at both grains."
        ),
    ),
    PolicyDecision(
        decision_id="NORMALIZATION_STRATEGY",
        status=DECISION_DECIDED,
        summary=(
            "BOUNDED_RATIO wherever the raw value is a bounded ratio (land_conversion only); "
            "percentile rank elsewhere because the other three raws are unbounded rates. The "
            "consequence — a mixed-strategy component set — is precisely why CRITIC is "
            "unusable, and is recorded as such rather than worked around."
        ),
        evidence=(
            "On land_conversion the two strategies are rank-equivalent (Spearman 0.9999988, "
            "top-50 overlap 50/50) but differ in standard deviation by 11.9% (24.92 vs 27.87, "
            "the latter 96.5% of the theoretical uniform maximum). Percentile ranking buys no "
            "ranking change and inflates the derived weight."
        ),
    ),
    PolicyDecision(
        decision_id="CRITIC_SUITABILITY",
        status=DECISION_DECIDED,
        summary=(
            "CRITIC is DIAGNOSTIC ONLY and is not a successor weighting method. No CRITIC "
            "vector may be persisted, served, or used to score a successor run."
        ),
        evidence=(
            "Its σ term measures normalization and grain, not information: the four components "
            "reach their candidate-level distributions by three different mechanisms. The "
            "research CRITIC also moved between Phase 3 and Phase 4 on the same run purely "
            "because the data was corrected (resident_impact 0.361 -> 0.35246), confirming it "
            "tracks the data's shape rather than a siting judgement."
        ),
    ),
    PolicyDecision(
        decision_id="FINAL_WEIGHT_VECTOR",
        status=DECISION_DECIDED,
        summary=(
            "Equal weighting, 0.25 to each of the four components, approved as the "
            "governance-neutral Successor-V3 baseline with a written rationale per weight "
            "(SUCCESSOR_WEIGHT_RATIONALE). Explicitly not claimed to be empirically optimal "
            "and not data-derived; versioned and revisable."
        ),
        evidence=(
            "The data-derived route is closed (CRITIC_SUITABILITY), and no evidence supports "
            "any asymmetric preference ordering over the four components. Equal weighting is "
            "the only vector that asserts none. The measured consequence is carried rather "
            "than hidden: +0.15 onto resident_impact retains 1/50 of the top 50 while the same "
            "shift onto any other component retains 44-49/50."
        ),
    ),
    PolicyDecision(
        decision_id="RESIDENT_DISTANCE_FLOOR",
        status=DECISION_DECIDED,
        summary=(
            "500 m approved (resident_impact.PRODUCTION_DISTANCE_FLOOR): exactly one candidate "
            "grid cell, so the model does not resolve distance below its own spatial "
            "resolution. The smallest option with a coherent interpretation."
        ),
        evidence=(
            "Near-inert in the approved composite on the ranking population: adjacent floors "
            "retain 50/50, 50/50 and 49/50 of the top 50 at Spearman 0.99996 / 0.99966 / "
            "0.99886. No floor controls the underlying placement artifact — the within-region "
            "score range only falls 46.71 -> 40.55 across a tenfold floor increase — so the "
            "tie was broken toward the simplest interpretation, and the artifact is carried as "
            "an accepted limitation."
        ),
    ),
    PolicyDecision(
        decision_id="LAND_COVER_CLASS_REGISTRY",
        status=DECISION_DECIDED,
        summary=(
            "successor-land-cover-l2-v1 approved: 22 published L2 codes, developed = the 1xx "
            "시가화건조지역 grouping only, no class excluded from the denominator. An approved "
            "project reading of the published code structure, not an authority's designation."
        ),
        evidence=(
            "1xx is the one grouping the source taxonomy itself labels built-up, so it is the "
            "only boundary readable from the published structure rather than asserted. "
            "Measured ranking cost of the alternatives is published, not assumed away."
        ),
    ),
    PolicyDecision(
        decision_id="AMBIGUOUS_LAND_CLASSES",
        status=DECISION_DECIDED,
        summary=(
            "All five contested classes (230, 420, 620, 710, 720) resolved NOT developed and "
            "kept in the denominator — the conservative direction, since land_conversion is "
            "LOWER_RAW_IS_BETTER so any other resolution improves a candidate's score. All "
            "five stay flagged in ambiguous_class_codes and travel in every provenance record."
        ),
        evidence=(
            "Exposure is near-total (92.87% of measurable cells touch a contested class), so "
            "each resolution is measured on real data: 620 as developed retains 38/50 of the "
            "top 50 (Spearman 0.9842); all three land classes as developed retains 26/50 "
            "(0.9300); excluding water retains 16/50 (0.9915). Water exclusion was rejected on "
            "evidence — it made water-dominated cells 7.4x more likely to reach a near-perfect "
            "score (45 of 679 cells at >=50% water against 351 of 39,089 below 20%), which is "
            "ambiguity improving a score."
        ),
    ),
    PolicyDecision(
        decision_id="SUCCESSOR_RANKING_POPULATION",
        status=DECISION_DECIDED,
        summary=(
            "The successor model ranks the historical constraint screening's ELIGIBLE set "
            "intersected with its own strict complete case. It never re-litigates, overrides, "
            "or bypasses the constraint screening."
        ),
        evidence=(
            "Measured on run 47: only ELIGIBLE candidates carry a rank or score at all "
            "(17,501 ranked; REVIEW_REQUIRED and EXCLUDED carry neither). The strict complete "
            "case of 33,980 is a component-AVAILABILITY set that contains 8,933 EXCLUDED and "
            "11,313 REVIEW_REQUIRED candidates, leaving a rankable population of 13,734. "
            "Ranking the unfiltered complete case would present burden and impact indicators "
            "as siting suitability over locations the constraint screening had already set "
            "aside, which docs/ANALYTICAL_METHODS.md 'Weighting Policy' item 2 forbids."
        ),
    ),
    PolicyDecision(
        decision_id="STABILITY_CONTRACT",
        status=DECISION_DEFERRED,
        summary=(
            "Metrics and perturbation axes are DEFINED (STABILITY_CONTRACT_DESIGN) and each "
            "axis is measured on run 47. Acceptance thresholds are deliberately unset."
        ),
        evidence=(
            "A classification needs a reference weight vector to perturb around; setting "
            "thresholds now would fix the target to whatever the current data produces."
        ),
    ),
    PolicyDecision(
        decision_id="RUNTIME_AND_VERSION_BEHAVIOUR",
        status=DECISION_DECIDED,
        summary=(
            "The four-step switchover in SUCCESSOR_RUNTIME_DESIGN['switchover'] is approved as "
            "the rollout contract: model-aware default-run resolution ships FIRST with the "
            "default pinned to the historical model; a successor run is then written and is "
            "reachable only by explicit run id; it is reviewed against the historical run on "
            "the same grid; and only then does an explicit configuration change move the "
            "default. Historical runs are never deleted and rollback is a configuration "
            "change, not a data migration."
        ),
        evidence=(
            "Default-run resolution currently picks the latest succeeded run regardless of "
            "component model, so a successor write would silently switch every default view "
            "and un-pinned shared link. Pinning first makes the switch an explicit act. "
            "Implementation remains open as SUCCESSOR_MODEL_AWARE_DEFAULT_RUN_NOT_IMPLEMENTED."
        ),
    ),
)


def phase4_decisions() -> tuple[PolicyDecision, ...]:
    """The Phase-4 gate decisions and their statuses."""

    return PHASE4_DECISIONS


def open_phase4_decisions() -> tuple[PolicyDecision, ...]:
    """Decisions that are still OPEN — the ones that block Phase 5."""

    return tuple(d for d in PHASE4_DECISIONS if d.status == DECISION_OPEN)


def validate_successor_policy() -> None:
    """Fail fast if the successor registry violates its own invariants."""

    assert_component_namespaces_disjoint()
    if set(COMPONENT_METHOD_VERSIONS) != set(COMPONENTS):
        raise CrossModelReuseError(
            "every successor component must declare exactly one method version",
            {
                "components": list(COMPONENTS),
                "method_versions": sorted(COMPONENT_METHOD_VERSIONS),
            },
        )
    # A weight profile may exist only alongside a minted policy identity, and every
    # registered profile must be total over the successor components, carry a
    # written rationale per component, and sum to exactly 1.
    if SUCCESSOR_WEIGHT_PROFILES and SUCCESSOR_POLICY_VERSION is None:
        raise CrossModelReuseError(
            "no successor weight profile may be registered before an approved policy version",
            {"profiles": sorted(SUCCESSOR_WEIGHT_PROFILES)},
        )
    for profile_name, weights in SUCCESSOR_WEIGHT_PROFILES.items():
        assert_successor_component_set(weights.keys())
        total = sum(Decimal(value) for value in weights.values())
        if total != Decimal("1"):
            raise CrossModelReuseError(
                f"successor weight profile {profile_name!r} must sum to exactly 1; got {total}",
                {"profile": profile_name, "total": format(total, "f")},
            )
        if any(Decimal(value) < 0 for value in weights.values()):
            raise CrossModelReuseError(
                f"successor weight profile {profile_name!r} may not carry a negative weight",
                {"profile": profile_name},
            )
    if SUCCESSOR_WEIGHT_PROFILES and set(SUCCESSOR_WEIGHT_RATIONALE) != set(COMPONENTS):
        raise CrossModelReuseError(
            "every successor component must carry a written weight rationale before any "
            "weighted composite is served (docs/ANALYTICAL_METHODS.md, Weighting Policy item 1)",
            {"documented": sorted(SUCCESSOR_WEIGHT_RATIONALE)},
        )
    # Policy identity moves as a pair: a run row must never carry one half of it.
    if (SUCCESSOR_POLICY_VERSION is None) != (SUCCESSOR_DERIVATION_VERSION is None):
        raise CrossModelReuseError(
            "successor policy_version and derivation_version must be minted together",
            {
                "policy_version": SUCCESSOR_POLICY_VERSION,
                "derivation_version": SUCCESSOR_DERIVATION_VERSION,
            },
        )
    # A blocker cannot be both open and closed.
    closed_ids = {b.blocker_id for b in CLOSED_BLOCKERS}
    open_ids = {b.blocker_id for b in ACTIVATION_BLOCKERS}
    if closed_ids & open_ids:
        raise CrossModelReuseError(
            "a blocker cannot be both open and closed",
            {"both": sorted(closed_ids & open_ids)},
        )
    # An accepted limitation is not a closed blocker: it stays a published limit.
    limitation_ids = {limitation.limitation_id for limitation in ACCEPTED_LIMITATIONS}
    if limitation_ids & (closed_ids | open_ids):
        raise CrossModelReuseError(
            "an accepted limitation must not be recorded as a blocker, open or closed",
            {"both": sorted(limitation_ids & (closed_ids | open_ids))},
        )
    if COMPONENT_MODEL_VERSION_HISTORICAL == COMPONENT_MODEL_VERSION_SUCCESSOR:
        raise CrossModelReuseError(
            "the historical and successor component models must have distinct identifiers",
            {"identifier": COMPONENT_MODEL_VERSION_HISTORICAL},
        )
    if SELECTED_MISSING_COMPONENT_POLICY in FORBIDDEN_MISSING_COMPONENT_POLICIES:
        raise CrossModelReuseError(
            "the zero-fill missing-component policy is permanently forbidden",
            {"policy": SELECTED_MISSING_COMPONENT_POLICY},
        )
    if OPTIONAL_COMPONENTS and SELECTED_MISSING_COMPONENT_POLICY is None:
        raise CrossModelReuseError(
            "components cannot be declared optional before a missing-component policy is chosen",
            {"optional_components": list(OPTIONAL_COMPONENTS)},
        )
    if SELECTED_MISSING_COMPONENT_POLICY == MISSING_POLICY_STRICT and OPTIONAL_COMPONENTS:
        raise CrossModelReuseError(
            "the strict policy admits no optional component",
            {"optional_components": list(OPTIONAL_COMPONENTS)},
        )
    # An OPEN Phase-4 decision and an activated model are mutually exclusive: the
    # gate exists precisely so an unanswered question cannot be shipped as an answer.
    if open_phase4_decisions() and is_activated():  # pragma: no cover - defensive
        raise CrossModelReuseError(
            "the successor model cannot be activated while Phase-4 decisions remain open",
            {"open_decisions": [d.decision_id for d in open_phase4_decisions()]},
        )
    for decision in PHASE4_DECISIONS:
        if decision.status not in {
            DECISION_DECIDED,
            DECISION_RESOLVED,
            DECISION_DEFERRED,
            DECISION_OPEN,
        }:
            raise CrossModelReuseError(
                f"Phase-4 decision {decision.decision_id!r} has an unknown status",
                {"status": decision.status},
            )
    # Activation is now reachable, so the guard that used to forbid it outright is
    # replaced by the invariants that make it *safe*. An activated model must:
    #   * carry a full policy identity (checked above);
    #   * have no open policy question (checked above);
    #   * still leave the default component model pinned to the historical one, so
    #     activation alone changes nothing an unpinned request sees.
    # The last is the switchover contract, and it is the one an accidental edit is
    # most likely to break, so it is asserted rather than assumed.
    if is_activated():
        from .. import component_model as _component_model

        if _component_model.DEFAULT_COMPONENT_MODEL != _component_model.COMPONENT_MODEL_HISTORICAL:
            raise CrossModelReuseError(
                "the successor model is activated and the default component model has been "
                "moved off the historical model; moving the default is a separate, explicitly "
                "reviewed rollout decision and must not travel with activation",
                {"default_component_model": _component_model.DEFAULT_COMPONENT_MODEL},
            )
    # The historical criterion order must stay exactly the historical four: the
    # successor model never widens or reorders it.
    if tuple(historical_critic.CRITERION_ORDER) != tuple(HISTORICAL_COMPONENTS):
        raise CrossModelReuseError(
            "the historical CRITIC criterion order must remain the historical component order",
            {
                "criterion_order": list(historical_critic.CRITERION_ORDER),
                "historical_components": list(HISTORICAL_COMPONENTS),
            },
        )


def successor_snapshot() -> dict[str, Any]:
    """JSON-serializable snapshot of the successor-model boundary."""

    validate_successor_policy()
    return {
        "model_id": SUCCESSOR_MODEL_ID,
        "component_model_version": COMPONENT_MODEL_VERSION_SUCCESSOR,
        "component_order": list(COMPONENT_ORDER_SUCCESSOR),
        "component_contract_version": COMPONENT_CONTRACT_VERSION,
        "components": list(COMPONENTS),
        "component_method_versions": dict(COMPONENT_METHOD_VERSIONS),
        "normalization": NORMALIZATION,
        "policy_version": SUCCESSOR_POLICY_VERSION,
        "derivation_version": SUCCESSOR_DERIVATION_VERSION,
        "weight_profiles": dict(SUCCESSOR_WEIGHT_PROFILES),
        "weight_rationale": dict(SUCCESSOR_WEIGHT_RATIONALE),
        "policy_closure_approval": POLICY_CLOSURE_APPROVAL,
        "closed_blockers": [b.sanitized_summary() for b in CLOSED_BLOCKERS],
        "accepted_limitations": [
            limitation.sanitized_summary() for limitation in ACCEPTED_LIMITATIONS
        ],
        "ranking_population_rule": RANKING_POPULATION_RULE,
        "candidate_grid_version_reference": CANDIDATE_GRID_VERSION_REFERENCE,
        "missing_component_policy": {
            "selected": SELECTED_MISSING_COMPONENT_POLICY,
            "optional_components": list(OPTIONAL_COMPONENTS),
            "options": dict(MISSING_COMPONENT_POLICIES),
            "forbidden": sorted(FORBIDDEN_MISSING_COMPONENT_POLICIES),
        },
        "persistence_design": PERSISTENCE_DESIGN,
        "stability_contract_design": STABILITY_CONTRACT_DESIGN,
        "runtime_design": SUCCESSOR_RUNTIME_DESIGN,
        "phase4_decisions": [d.sanitized_summary() for d in PHASE4_DECISIONS],
        "open_phase4_decisions": [d.decision_id for d in open_phase4_decisions()],
        "activated": is_activated(),
        "activation_blockers": [b.sanitized_summary() for b in ACTIVATION_BLOCKERS],
        "historical_model": {
            "component_model_version": COMPONENT_MODEL_VERSION_HISTORICAL,
            "component_order": list(COMPONENT_ORDER_HISTORICAL),
            "component_model_labelling_note": COMPONENT_MODEL_LABELLING_NOTE,
            "policy_version": historical_policy.POLICY_VERSION,
            "derivation_version": historical_policy.DERIVATION_VERSION,
            "components": list(HISTORICAL_COMPONENTS),
            "relationship": (
                "additive successor; historical components, weights, profiles, ranks, CRITIC "
                "vectors, stability classes, and stored runs are unchanged and remain fully "
                "interpretable"
            ),
        },
        "disclaimer": DISCLAIMER,
    }
