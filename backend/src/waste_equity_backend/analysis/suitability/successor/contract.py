"""Typed component contract for the **successor** suitability model (foundation).

The historical screen scores four components — ``zoning`` / ``road`` / ``equity`` /
``demand`` — defined in :mod:`waste_equity_backend.analysis.suitability.policy`.
The successor model scores a *different* four:

``existing_burden`` · ``air_impact_proxy`` · ``resident_impact`` · ``land_conversion``

This module defines the shared, typed shape every successor component produces.
It is deliberately **additive**: nothing here reads, writes, renames, or
reinterprets a historical component, and no historical column, weight, profile,
rank, CRITIC vector, or stability class is touched. The two component namespaces
are disjoint by construction and the disjointness is asserted (see
:func:`waste_equity_backend.analysis.suitability.successor.policy.classify_component_set`).

Design rules encoded here, not just documented:

* **Missing is never zero.** An observation is either *available* (it carries an
  exact ``Decimal`` raw value) or *unavailable* (it carries one or more stable
  machine-readable reason codes). There is no third state and no zero-fill.
* **Partial is visible.** A value computed from a known-incomplete input stays
  available but is flagged ``is_partial`` with its reasons, so a consumer sees a
  documented undercount rather than a silent one.
* **Sources survive.** Every observation preserves the individual source values,
  their units, reference periods, and provenance beside the derived number.
* **Deterministic.** All arithmetic is exact ``Decimal``; normalization reuses the
  project's existing percentile convention (:func:`policy.percentile_ranks`) so a
  successor score is reproducible byte-for-byte from the same inputs.

Nothing in this module is a legal, permitting, engineering, or final-siting
determination, and no successor component is production-activated — see
:mod:`.policy` for the explicit activation gate.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from .. import policy as historical_policy

# --------------------------------------------------------------------------- #
# Component namespace
# --------------------------------------------------------------------------- #

COMPONENT_EXISTING_BURDEN = "existing_burden"
COMPONENT_AIR_IMPACT_PROXY = "air_impact_proxy"
COMPONENT_RESIDENT_IMPACT = "resident_impact"
COMPONENT_LAND_CONVERSION = "land_conversion"

# Fixed order for every successor vector, mapping, and serialization. Its members
# are intentionally disjoint from ``policy.COMPONENTS``: a successor component is
# never an alias, rename, or re-derivation of a historical one.
SUCCESSOR_COMPONENTS: tuple[str, ...] = (
    COMPONENT_EXISTING_BURDEN,
    COMPONENT_AIR_IMPACT_PROXY,
    COMPONENT_RESIDENT_IMPACT,
    COMPONENT_LAND_CONVERSION,
)

# The version of *this* contract shape (dataclass fields, reason-code vocabulary,
# normalization convention). Bumping it signals a change to the component
# interface itself, never to a historical policy/derivation identity.
COMPONENT_CONTRACT_VERSION = "successor-component-contract-v1"

# --------------------------------------------------------------------------- #
# Normalization direction
# --------------------------------------------------------------------------- #

# Which end of the raw scale is the *better* screening outcome. Every successor
# component must declare one explicitly; there is no default.
LOWER_RAW_IS_BETTER = "LOWER_RAW_IS_BETTER"
HIGHER_RAW_IS_BETTER = "HIGHER_RAW_IS_BETTER"

DIRECTIONS: frozenset[str] = frozenset({LOWER_RAW_IS_BETTER, HIGHER_RAW_IS_BETTER})

# --------------------------------------------------------------------------- #
# Normalization strategy
# --------------------------------------------------------------------------- #

# Two deterministic strategies are supported, and a component must declare which
# one it uses. Both produce a dimensionless [0,100] **beneficial-direction** score
# (higher = better screening outcome), so a successor score sits on exactly the
# scale the existing CRITIC normalization already assumes
# (``critic.NORMALIZATION``: ``x = score / 100`` on a policy-fixed [0,100]
# beneficial scale). Neither strategy is yet approved as successor policy.
#
# PERCENTILE_RANK — the project's existing convention, reused verbatim from
#   :func:`policy.percentile_ranks` (rank = count(strictly less) / (n - 1); a
#   single value is the neutral 0.5; ties share a rank; absent keys are never
#   zero-filled). Run-relative: the score describes a unit's position among the
#   other units in this run.
#
# BOUNDED_RATIO — the raw value is already a bounded [0,1] ratio, so it maps
#   directly to [0,100] with no reference to any other unit. Run-independent and
#   physically interpretable ("this cell is 18% built-up"), and it preserves the
#   raw distribution's natural shape.
#
# The choice is analytically load-bearing, not cosmetic: percentile-ranking a
# component hands CRITIC a near-uniform distribution whose standard deviation sits
# near the theoretical maximum, mechanically inflating that component's derived
# weight relative to a naturally-clustered one. Which strategy each successor
# component uses in production is an open analytical decision (see
# ``SUCCESSOR_NORMALIZATION_STRATEGY_UNAPPROVED`` in :mod:`.policy`).
NORMALIZATION_PERCENTILE_RANK = "PERCENTILE_RANK"
NORMALIZATION_BOUNDED_RATIO = "BOUNDED_RATIO"

NORMALIZATION_STRATEGIES: frozenset[str] = frozenset(
    {NORMALIZATION_PERCENTILE_RANK, NORMALIZATION_BOUNDED_RATIO}
)

NORMALIZATION_DESCRIPTIONS: dict[str, str] = {
    NORMALIZATION_PERCENTILE_RANK: (
        "percentile rank over the available observations "
        "(policy.percentile_ranks: strictly-less / (n-1), single value = 0.5, ties share a "
        "rank), mapped to a dimensionless [0,100] score in the component's declared "
        "direction. Run-relative: changing the observed population changes every score."
    ),
    NORMALIZATION_BOUNDED_RATIO: (
        "the raw value is a bounded [0,1] ratio mapped directly to a dimensionless "
        "[0,100] score in the component's declared direction. Run-independent: a unit's "
        "score depends only on its own measurement, and the raw distribution's shape is "
        "preserved rather than flattened to uniform."
    ),
}

# Backwards-compatible alias for the default strategy's description.
NORMALIZATION = NORMALIZATION_DESCRIPTIONS[NORMALIZATION_PERCENTILE_RANK]

# --------------------------------------------------------------------------- #
# Unavailability reason codes (stable, machine-readable)
# --------------------------------------------------------------------------- #

# Population denominator
REASON_MISSING_POPULATION = "MISSING_POPULATION"
REASON_NON_POSITIVE_POPULATION = "NON_POSITIVE_POPULATION"
REASON_INVALID_POPULATION = "INVALID_POPULATION"

# Quantities / units / periods / grain
REASON_INCOMPATIBLE_QUANTITY_UNIT = "INCOMPATIBLE_QUANTITY_UNIT"
REASON_INCOMPATIBLE_REFERENCE_PERIOD = "INCOMPATIBLE_REFERENCE_PERIOD"
REASON_INCOMPATIBLE_GEOGRAPHIC_GRAIN = "INCOMPATIBLE_GEOGRAPHIC_GRAIN"

# existing_burden
REASON_ALL_LOCATED_THROUGHPUT_MISSING = "ALL_LOCATED_THROUGHPUT_MISSING"
# Facility evidence exists in the source for a reporting unit covering this region
# but could not be attributed to this region's geography, and the region has no
# located facility of its own. The resulting zero would be the *best possible*
# score on a LOWER_RAW_IS_BETTER scale, produced entirely by a mapping gap.
REASON_UNMAPPED_FACILITY_EVIDENCE = "UNMAPPED_FACILITY_EVIDENCE"

# air_impact_proxy
REASON_MISSING_WASTE_STREAM = "MISSING_WASTE_STREAM"
REASON_DUPLICATE_WASTE_STREAM = "DUPLICATE_WASTE_STREAM"
REASON_UNSUPPORTED_WASTE_STREAM = "UNSUPPORTED_WASTE_STREAM"

# resident_impact
REASON_NO_POPULATION_UNITS = "NO_POPULATION_UNITS"
REASON_MISSING_DISTANCE = "MISSING_DISTANCE"
REASON_INVALID_DISTANCE = "INVALID_DISTANCE"
REASON_INCOMPATIBLE_DISTANCE_MEASUREMENT = "INCOMPATIBLE_DISTANCE_MEASUREMENT"

# land_conversion
REASON_NO_LAND_COVER_COVERAGE = "NO_LAND_COVER_COVERAGE"
REASON_MISSING_EVALUATED_AREA = "MISSING_EVALUATED_AREA"
REASON_NO_EVALUATED_AREA = "NO_EVALUATED_AREA"
REASON_MISSING_CLASS_COMPOSITION = "MISSING_CLASS_COMPOSITION"
REASON_UNCLASSIFIED_LAND_COVER_CLASS = "UNCLASSIFIED_LAND_COVER_CLASS"
REASON_INVALID_CLASS_AREA = "INVALID_CLASS_AREA"
REASON_CLASS_AREA_EXCEEDS_DENOMINATOR = "CLASS_AREA_EXCEEDS_DENOMINATOR"

# Partial-state reason codes (the observation *is* available, but undercounted or
# measured over an incomplete input).
PARTIAL_MISSING_FACILITY_THROUGHPUT = "MISSING_FACILITY_THROUGHPUT"
PARTIAL_LAND_COVER_COVERAGE = "PARTIAL_LAND_COVER_COVERAGE"
# The region has its own located facilities *and* the source holds further facility
# evidence that could not be attributed to it: the burden is a documented
# undercount of a known-but-unquantified size, not an unmeasurable one.
PARTIAL_UNMAPPED_FACILITY_EVIDENCE = "UNMAPPED_FACILITY_EVIDENCE_UNDERCOUNT"


class SuccessorContractError(ValueError):
    """Raised when a successor component contract object is internally invalid."""


# --------------------------------------------------------------------------- #
# Observation
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class ComponentObservation:
    """One successor component's value for one analytical unit.

    ``unit_key`` is whatever the component is measured on: a SIGUNGU region code
    for the region-level components (``existing_burden``, ``air_impact_proxy``) or
    a candidate key for the candidate-level ones (``resident_impact``,
    ``land_conversion``).

    Exactly one of the two states holds, enforced in ``__post_init__``:

    * **available** — ``raw_value`` is an exact ``Decimal`` and
      ``unavailable_reasons`` is empty;
    * **unavailable** — ``raw_value`` is ``None`` and ``unavailable_reasons`` names
      at least one stable reason code.

    ``inputs`` preserves the individual source values the raw number was derived
    from (never only the derived result), and ``provenance`` carries source ids,
    reference periods, units, accounting bases, and method versions.
    """

    component: str
    unit_key: str
    raw_value: Decimal | None
    raw_unit: str | None
    unavailable_reasons: tuple[str, ...] = ()
    is_partial: bool = False
    partial_reasons: tuple[str, ...] = ()
    inputs: Mapping[str, Any] = field(default_factory=dict)
    provenance: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.component not in SUCCESSOR_COMPONENTS:
            raise SuccessorContractError(
                f"unknown successor component {self.component!r}; "
                f"expected one of {SUCCESSOR_COMPONENTS}"
            )
        if not self.unit_key:
            raise SuccessorContractError("unit_key must be a non-empty analytical unit identifier")
        if self.raw_value is None and not self.unavailable_reasons:
            raise SuccessorContractError(
                f"{self.component}[{self.unit_key}]: an unavailable observation must carry at "
                "least one reason code (a missing value is never silently absent)"
            )
        if self.raw_value is not None and self.unavailable_reasons:
            raise SuccessorContractError(
                f"{self.component}[{self.unit_key}]: an observation cannot be both available "
                f"and unavailable (reasons: {list(self.unavailable_reasons)})"
            )
        if self.raw_value is not None and self.raw_value.is_nan():
            raise SuccessorContractError(
                f"{self.component}[{self.unit_key}]: raw_value must be a finite Decimal"
            )
        if self.is_partial and not self.partial_reasons:
            raise SuccessorContractError(
                f"{self.component}[{self.unit_key}]: a partial observation must name why"
            )
        if self.partial_reasons and not self.is_partial:
            raise SuccessorContractError(
                f"{self.component}[{self.unit_key}]: partial_reasons set without is_partial"
            )

    @property
    def available(self) -> bool:
        """True when this unit has a real measured value for the component."""

        return self.raw_value is not None

    def sanitized_summary(self) -> dict[str, Any]:
        """JSON-serializable summary (exact decimal strings, no floats)."""

        return {
            "component": self.component,
            "unit_key": self.unit_key,
            "available": self.available,
            "raw_value": (format(self.raw_value, "f") if self.raw_value is not None else None),
            "raw_unit": self.raw_unit,
            "unavailable_reasons": list(self.unavailable_reasons),
            "is_partial": self.is_partial,
            "partial_reasons": list(self.partial_reasons),
            "inputs": dict(self.inputs),
            "provenance": dict(self.provenance),
        }


# --------------------------------------------------------------------------- #
# Series (one component across every analytical unit of one derivation)
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class ComponentSeries:
    """Every observation of one successor component, plus its method identity.

    Normalization happens **only** over the available observations: an unavailable
    unit is simply absent from :meth:`normalized_scores` (it is never scored 0,
    never imputed, and never ranked). This mirrors the historical engine, which
    likewise omits an absent component rather than zero-filling it — the shared
    behaviour is the *missing-data rule*, not the component's meaning.
    """

    component: str
    method_version: str
    direction: str
    raw_unit: str | None
    observations: tuple[ComponentObservation, ...]
    normalization_strategy: str = NORMALIZATION_PERCENTILE_RANK
    provenance: Mapping[str, Any] = field(default_factory=dict)
    disclaimer: str | None = None

    def __post_init__(self) -> None:
        if self.component not in SUCCESSOR_COMPONENTS:
            raise SuccessorContractError(f"unknown successor component {self.component!r}")
        if self.direction not in DIRECTIONS:
            raise SuccessorContractError(
                f"{self.component}: direction must be one of {sorted(DIRECTIONS)}"
            )
        if self.normalization_strategy not in NORMALIZATION_STRATEGIES:
            raise SuccessorContractError(
                f"{self.component}: normalization_strategy must be one of "
                f"{sorted(NORMALIZATION_STRATEGIES)}"
            )
        seen: set[str] = set()
        for obs in self.observations:
            if obs.component != self.component:
                raise SuccessorContractError(
                    f"series {self.component!r} contains a {obs.component!r} observation"
                )
            if obs.unit_key in seen:
                raise SuccessorContractError(
                    f"{self.component}: duplicate observation for unit {obs.unit_key!r}"
                )
            seen.add(obs.unit_key)

    def available_observations(self) -> tuple[ComponentObservation, ...]:
        return tuple(o for o in self.observations if o.available)

    def unavailable_observations(self) -> tuple[ComponentObservation, ...]:
        return tuple(o for o in self.observations if not o.available)

    def raw_values(self) -> dict[str, Decimal]:
        """``{unit_key: raw_value}`` for the available observations only."""

        return {o.unit_key: o.raw_value for o in self.observations if o.raw_value is not None}

    def percentile_ranks(self) -> dict[str, Decimal]:
        """Deterministic percentile rank per available unit (project convention)."""

        return historical_policy.percentile_ranks(self.raw_values())

    def normalized_scores(self) -> dict[str, Decimal]:
        """Dimensionless [0,100] scores per available unit, in the declared direction.

        Dispatches on the declared :attr:`normalization_strategy`. Unavailable units
        are absent from the result — never zero, never imputed.
        """

        if self.normalization_strategy == NORMALIZATION_BOUNDED_RATIO:
            return {
                unit: score_from_bounded_ratio(raw, self.direction)
                for unit, raw in self.raw_values().items()
            }
        return {
            unit: score_from_percentile(rank, self.direction)
            for unit, rank in self.percentile_ranks().items()
        }

    def sanitized_summary(self) -> dict[str, Any]:
        scores = self.normalized_scores()
        return {
            "component": self.component,
            "method_version": self.method_version,
            "contract_version": COMPONENT_CONTRACT_VERSION,
            "direction": self.direction,
            "raw_unit": self.raw_unit,
            "normalization_strategy": self.normalization_strategy,
            "normalization": NORMALIZATION_DESCRIPTIONS[self.normalization_strategy],
            "observation_count": len(self.observations),
            "available_count": len(self.available_observations()),
            "unavailable_count": len(self.unavailable_observations()),
            "partial_count": sum(1 for o in self.observations if o.is_partial),
            "unavailable_reason_counts": self.unavailable_reason_counts(),
            "scores": {unit: format(score, "f") for unit, score in sorted(scores.items())},
            "provenance": dict(self.provenance),
            "disclaimer": self.disclaimer,
        }

    def unavailable_reason_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for obs in self.unavailable_observations():
            for reason in obs.unavailable_reasons:
                counts[reason] = counts.get(reason, 0) + 1
        return dict(sorted(counts.items()))


# --------------------------------------------------------------------------- #
# Normalization helpers
# --------------------------------------------------------------------------- #


def score_from_percentile(percentile: Decimal, direction: str) -> Decimal:
    """Map a [0,1] percentile rank to a dimensionless [0,100] score.

    ``LOWER_RAW_IS_BETTER`` inverts the rank (a low raw value earns a high score);
    ``HIGHER_RAW_IS_BETTER`` uses it directly. Both clamp and quantize through
    :func:`policy.quantize_score`, so a successor score sits on exactly the same
    0–100, 4-dp, ROUND_HALF_EVEN scale as every historical component score.
    """

    if direction == LOWER_RAW_IS_BETTER:
        return historical_policy.quantize_score((Decimal("1") - percentile) * Decimal("100"))
    if direction == HIGHER_RAW_IS_BETTER:
        return historical_policy.quantize_score(percentile * Decimal("100"))
    raise SuccessorContractError(f"unknown normalization direction {direction!r}")


def score_from_bounded_ratio(raw_value: Decimal, direction: str) -> Decimal:
    """Map a bounded [0,1] raw ratio directly to a dimensionless [0,100] score.

    Unlike :func:`score_from_percentile` this is **run-independent**: the score is a
    function of the unit's own measurement only, so it stays comparable across runs
    and keeps its natural (non-uniform) distribution shape. Raising a value outside
    [0,1] is an error rather than a clamp — an out-of-range ratio means the caller's
    denominator is wrong, and silently clamping would hide that.
    """

    if direction not in DIRECTIONS:
        raise SuccessorContractError(f"unknown normalization direction {direction!r}")
    if raw_value.is_nan() or raw_value < 0 or raw_value > 1:
        raise SuccessorContractError(
            f"bounded-ratio normalization requires a raw value in [0,1]; got {raw_value}"
        )
    if direction == LOWER_RAW_IS_BETTER:
        return historical_policy.quantize_score((Decimal("1") - raw_value) * Decimal("100"))
    return historical_policy.quantize_score(raw_value * Decimal("100"))


def normalize_raw_values(values: Mapping[str, Decimal], direction: str) -> dict[str, Decimal]:
    """Percentile-normalize a ``{unit_key: raw_value}`` mapping in one direction.

    Keys absent from ``values`` stay absent from the result: the caller must pass
    only units with a real observation, never a zero placeholder.
    """

    if direction not in DIRECTIONS:
        raise SuccessorContractError(f"unknown normalization direction {direction!r}")
    ranks = historical_policy.percentile_ranks(dict(values))
    return {unit: score_from_percentile(rank, direction) for unit, rank in ranks.items()}


def sorted_unique(values: Iterable[str]) -> tuple[str, ...]:
    """Deterministic, duplicate-free ordering for reason-code and key lists."""

    return tuple(sorted(set(values)))


def build_series(
    component: str,
    method_version: str,
    direction: str,
    raw_unit: str | None,
    observations: Sequence[ComponentObservation],
    normalization_strategy: str = NORMALIZATION_PERCENTILE_RANK,
    provenance: Mapping[str, Any] | None = None,
    disclaimer: str | None = None,
) -> ComponentSeries:
    """Assemble a :class:`ComponentSeries` with deterministic observation order.

    Observations are ordered by ``unit_key`` so the series (and every summary
    derived from it) is byte-stable regardless of the caller's input order.
    """

    return ComponentSeries(
        component=component,
        method_version=method_version,
        direction=direction,
        raw_unit=raw_unit,
        observations=tuple(sorted(observations, key=lambda o: o.unit_key)),
        normalization_strategy=normalization_strategy,
        provenance=dict(provenance or {}),
        disclaimer=disclaimer,
    )
