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

# The model-level analytical identity is intentionally UNASSIGNED. A successor
# policy/derivation version may only be minted once every activation blocker below
# is closed; until then there is no value a run row could legitimately carry, and
# ``None`` makes that impossible to fake by accident.
SUCCESSOR_POLICY_VERSION: str | None = None
SUCCESSOR_DERIVATION_VERSION: str | None = None

# No successor weight profile exists. Inventing one — including "equal weights as
# a placeholder" — would be an unapproved analytical policy assumption, so the
# registry is empty rather than provisional.
SUCCESSOR_WEIGHT_PROFILES: dict[str, dict[str, str]] = {}

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


ACTIVATION_BLOCKERS: tuple[ActivationBlocker, ...] = (
    ActivationBlocker(
        blocker_id="RESIDENT_IMPACT_DISTANCE_FLOOR_UNAPPROVED",
        summary=(
            "The resident_impact distance floor has no approved production value. It is a "
            "required explicit input with no default, so no production scoring profile can "
            "be derived from this component yet."
        ),
        blocks="resident_impact production activation",
        resolution_owner="analytical-method research lane",
    ),
    ActivationBlocker(
        blocker_id="LAND_COVER_DEVELOPED_CLASS_REGISTRY_UNAVAILABLE",
        summary=(
            "No official developed/artificial land-cover class registry is stored in this "
            "repository; class codes and names are preserved verbatim from the source with no "
            "developed/natural classification. The registry must be supplied explicitly and is "
            "under audit by a separate research lane."
        ),
        blocks="land_conversion production activation",
        resolution_owner="land-cover class registry research lane",
    ),
    ActivationBlocker(
        blocker_id="SUCCESSOR_WEIGHT_VECTOR_UNAPPROVED",
        summary=(
            "No approved weight vector exists over the successor components, and the "
            "historical vectors describe a different component matrix. Phase 4 closed the "
            "data-derived route: CRITIC is unsuitable as a successor weighting method (see "
            "SUCCESSOR_CRITIC_UNSUITABLE_FOR_WEIGHTING), so no weight vector can be derived "
            "from the data and any vector is an explicit analytical-policy assertion. The "
            "ranking head is also not uniformly weight-sensitive: on the corrected population "
            "moving 0.15 of weight onto resident_impact retains 1 of the top 50, while the "
            "same shift onto any other component retains 44-49. A weight vector is therefore "
            "acceptable only with an argued interpretation, never because it scored well."
        ),
        blocks="successor composite scoring and profile registration",
        resolution_owner="analytical-policy owner",
    ),
    ActivationBlocker(
        blocker_id="SUCCESSOR_CRITIC_UNSUITABLE_FOR_WEIGHTING",
        summary=(
            "Phase 4 established that CRITIC cannot weight the successor components. Its "
            "standard-deviation term measures normalization and analytical grain rather than "
            "information: the four components reach a candidate-level distribution by three "
            "different mechanisms (candidate-grain percentile rank, region-grain percentile "
            "rank projected onto candidates, and bounded ratio), and on run 47 the two "
            "strategies applied to the same component are rank-equivalent (Spearman "
            "0.9999988, top-50 overlap 50/50) while differing in standard deviation by 11.9% "
            "— so the choice moves the derived weight without moving the ranking. CRITIC "
            "remains usable as a diagnostic. No replacement weighting method is approved."
        ),
        blocks="any data-derived successor weight vector",
        resolution_owner="analytical-method research lane",
    ),
    ActivationBlocker(
        blocker_id="LAND_CONVERSION_DIRECTION_UNAPPROVED",
        summary=(
            "land_conversion is implemented with the documented assumption that a larger "
            "not-already-developed (conversion-exposed) share is the worse screening outcome. "
            "That direction is an analytical-policy assumption and needs explicit approval."
        ),
        blocks="land_conversion production activation",
        resolution_owner="analytical-policy owner",
    ),
    ActivationBlocker(
        blocker_id="SUCCESSOR_CRITIC_STABILITY_METHOD_UNVALIDATED",
        summary=(
            "The stored CRITIC and stability methods are defined over the historical "
            "component matrix. Whether either is valid over the successor components has not "
            "been established, and the historical derivations must not be reused."
        ),
        blocks="successor CRITIC weights and stability classification",
        resolution_owner="analytical-method research lane",
    ),
    ActivationBlocker(
        blocker_id="SUCCESSOR_RUN_WRITE_PATH_NOT_IMPLEMENTED",
        summary=(
            "The additive persistence schema and the version-aware API contract are applied "
            "(run-level component_model_version + component_order, candidate-level "
            "component_scores, legacy columns untouched and NULL for successor runs), but "
            "nothing writes a successor run: no engine stage scores the successor "
            "components into candidate rows, and doing so requires the missing-component "
            "eligibility policy, an approved weight vector, and a normalization strategy "
            "first. Successor user-weight scenarios are refused for the same reason."
        ),
        blocks="producing any stored successor run, and successor scenario recombination",
        resolution_owner="backend owner",
    ),
    ActivationBlocker(
        blocker_id="AIR_IMPACT_PROXY_GRAIN_AND_COVERAGE_UNRESOLVED",
        summary=(
            "Phase 4 decided the scoring-time behaviour — strict SIGUNGU, no projection — and "
            "rejected the CITY-grain projection as a remedy on arithmetic: projecting the "
            "seven Gyeonggi cities' per-capita rates onto their 20 child districts recovers "
            "the component for 5,536 candidates but *zero eligible candidates*, because those "
            "same 20 districts independently lose existing_burden to the identical reporting-"
            "grain gap and facility throughput cannot be projected (a facility sits in one "
            "district, not spread per capita). The root cause is one ingestion-level defect "
            "affecting two components and it is unfixed: 22 regions and 6,349,306 residents "
            "(24.13%) stay outside the model. The numerator basis (total generation vs "
            "origin-based incinerated tonnage) is a second open choice on the same component."
        ),
        blocks="air_impact_proxy production activation and the excluded 24.13% of residents",
        resolution_owner=(
            "ingestion lane (geocoding / district-grain source), then analytical-policy owner"
        ),
    ),
    ActivationBlocker(
        blocker_id="SUCCESSOR_NORMALIZATION_STRATEGY_UNAPPROVED",
        summary=(
            "Each component's normalization strategy (run-relative percentile rank vs "
            "run-independent bounded ratio) is implemented and selectable but not approved. "
            "The choice is analytically load-bearing: percentile-ranking a component hands "
            "CRITIC a near-uniform distribution whose standard deviation sits near the "
            "theoretical maximum, mechanically inflating that component's derived weight."
        ),
        blocks="successor component scoring and any CRITIC derivation over successor scores",
        resolution_owner="analytical-method research lane",
    ),
    ActivationBlocker(
        blocker_id="RESIDENT_IMPACT_POPULATION_RESOLUTION_UNRESOLVED",
        summary=(
            "The finest population geography available is one value per SIGUNGU, represented "
            "by a single point per region. The component therefore varies smoothly per cell "
            "while its information content remains one number per region, and every proposed "
            "distance floor is smaller than the average region's own equivalent-circle "
            "radius — so the floor would be calibrated against the arbitrary placement of a "
            "representative point rather than against anything on the ground."
        ),
        blocks="resident_impact production activation",
        resolution_owner="analytical-method research lane",
    ),
    ActivationBlocker(
        blocker_id="SUCCESSOR_DEFAULT_RUN_RESOLUTION_UNDECIDED",
        summary=(
            "Default-run resolution selects the latest succeeded run regardless of component "
            "model, so the first successful successor run would silently switch every default "
            "view and every un-pinned shared link to a different model. How the default run is "
            "chosen once two component models coexist is a product decision that gates rollout."
        ),
        blocks="successor rollout and default-run switchover",
        resolution_owner="product owner",
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
        status=DECISION_OPEN,
        summary=(
            "No weight vector is approved. Equal weights are used in this phase strictly as a "
            "neutral reference for perturbation, never as a proposal or default."
        ),
        evidence=(
            "The data-derived route is closed (CRITIC_SUITABILITY) and the ranking head is "
            "asymmetrically weight-determined: +0.15 onto resident_impact retains 1/50 of the "
            "top 50 while the same shift onto any other component retains 44-49/50. A vector "
            "chosen now would be choosing a ranking."
        ),
    ),
    PolicyDecision(
        decision_id="RESIDENT_DISTANCE_FLOOR",
        status=DECISION_OPEN,
        summary="No floor is approved. 2 km remains explicitly not a default.",
        evidence=(
            "The floor's importance depends on the unapproved weight: decisive on the "
            "component alone (500 m vs 5 km retains 33/50, max move 20,979 ranks), nearly "
            "inert inside an equal-weighted composite (49/50). Underneath sits an unresolved "
            "defect — one population value per region at a single representative point, with "
            "every proposed floor smaller than the average region's equivalent-circle radius — "
            "so no floor is calibrated against anything on the ground."
        ),
    ),
    PolicyDecision(
        decision_id="LAND_COVER_CLASS_REGISTRY",
        status=DECISION_OPEN,
        summary=(
            "PRODUCTION_REGISTRY stays None. The Phase-3 L2 registry remains research-only and "
            "must not produce, rank, or publish any candidate result."
        ),
        evidence=(
            "92.87% of measurable cells touch at least one class whose developed/not-developed "
            "assignment is contested. 620 인공나지 alone affects 24,411 cells and is arguably "
            "the most developed non-1xx class while being classified not-developed."
        ),
    ),
    PolicyDecision(
        decision_id="AMBIGUOUS_LAND_CLASSES",
        status=DECISION_OPEN,
        summary="Unresolved: 230, 420, 620, 710, 720 all remain contested.",
        evidence=(
            "Exposure is near-total (92.87%), so the ambiguity is a primary driver of the "
            "component's values rather than a rounding detail."
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
        status=DECISION_DEFERRED,
        summary=(
            "Designed in SUCCESSOR_RUNTIME_DESIGN and not activated. Component-model-aware "
            "default-run resolution must ship before the first successor run is written."
        ),
        evidence=(
            "Default-run resolution currently picks the latest succeeded run regardless of "
            "component model, so a successor write would silently switch every default view "
            "and un-pinned shared link."
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
    if SUCCESSOR_WEIGHT_PROFILES:
        raise CrossModelReuseError(
            "no successor weight profile may be registered before an approved weight vector",
            {"profiles": sorted(SUCCESSOR_WEIGHT_PROFILES)},
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
    if is_activated():  # pragma: no cover - defensive; blockers are non-empty
        raise CrossModelReuseError(
            "successor activation requires an explicit, reviewed policy change",
            {"blockers": [b.blocker_id for b in ACTIVATION_BLOCKERS]},
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
