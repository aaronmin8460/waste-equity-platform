"""Successor component D — ``land_conversion`` (foundation).

The repository already derives 2025 land-cover composition statistics for every
canonical 500 m candidate cell (``environmental_land_cover_cell_statistics`` and
its per-class child rows ``environmental_land_cover_cell_class_areas``, derivation
``land-cover-cell-stats-v1``). This component consumes **those existing derived
statistics**; it does not re-measure geometry and does not re-label classes.

What it deliberately does **not** contain is the official developed/artificial
class list. Class codes and names are stored verbatim from the source with no
developed/natural classification anywhere in this repository, and a separate
research lane is auditing the official registry. Hard-coding a guessed code list
here would be exactly the kind of invented classification the project's data
rules forbid, so the registry is a **required explicit input**
(:class:`LandCoverClassRegistry`) and :data:`PRODUCTION_REGISTRY` is ``None``.

Raw metric (over the evaluated-area denominator by default)::

    land_conversion_raw = non_developed_area / denominator_area

i.e. the share of the measured area that is **not** already in a developed /
artificial class — the share a facility would convert. Direction: **lower raw →
higher score** (siting on already-developed land converts less). That direction is
an explicit analytical-policy assumption and is listed as an activation blocker in
:mod:`.policy`; it is not yet approved.

Missing is never zero, at three separate points:

* a cell with ``NO_COVERAGE`` is **unavailable**, not "0% developed";
* a class observed in the cell but absent from the registry's ``known_class_codes``
  makes the cell **unavailable** (``UNCLASSIFIED_LAND_COVER_CLASS``) rather than
  being quietly counted as non-developed;
* a ``PARTIAL`` cell stays available but is flagged ``is_partial`` with its
  coverage ratio, so the smaller denominator is visible rather than implied.

Conversely, *present* is never turned into missing by an arithmetic artifact. The
stored areas are ``double precision`` while this module does exact ``Decimal``
arithmetic, so a class sum can exceed its own denominator by a few units in the
last place. That is a representation-level disagreement, not a structurally
impossible cell, and it is separated from a real overlay defect by the explicit
:data:`AREA_RECONCILIATION_RELATIVE_TOLERANCE`.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from typing import Any

from . import contract
from .contract import ComponentObservation, ComponentSeries

METHOD_VERSION = "successor-land-conversion-v1"
COMPONENT = contract.COMPONENT_LAND_CONVERSION
DIRECTION = contract.LOWER_RAW_IS_BETTER
RAW_UNIT = "share_of_denominator_area"

# Coverage statuses as written by the land-cover cell-statistics derivation.
COVERAGE_NO_COVERAGE = "NO_COVERAGE"
COVERAGE_COMPLETE_EXACT = "COMPLETE_EXACT"
COVERAGE_PARTIAL = "PARTIAL"

# Which area the shares divide by. These denominators mean different things and are
# never conflated (the same discipline the stored class-area rows apply to
# ``share_of_evaluated_area`` vs ``share_of_cell_area``), so each one is a named,
# recorded choice rather than an implicit default.
#
# EVALUATED_AREA — the union of all land-cover intersections with the cell.
# CELL_AREA      — the whole clipped cell, covered or not.
# EVALUATED_AREA_EXCLUDING_EXCLUDED_CLASSES — the evaluated area minus the area of
#   every class the registry marks *excluded* (a class that belongs in neither the
#   numerator nor the denominator, e.g. water under a "share of the *land* that is
#   developed" reading). This is a genuinely third denominator: it must be named
#   explicitly and stored explicitly, and it is never silently substituted for
#   either of the other two.
DENOMINATOR_EVALUATED_AREA = "EVALUATED_AREA"
DENOMINATOR_CELL_AREA = "CELL_AREA"
DENOMINATOR_EVALUATED_AREA_EXCLUDING_EXCLUDED = "EVALUATED_AREA_EXCLUDING_EXCLUDED_CLASSES"

DENOMINATORS: frozenset[str] = frozenset(
    {
        DENOMINATOR_EVALUATED_AREA,
        DENOMINATOR_CELL_AREA,
        DENOMINATOR_EVALUATED_AREA_EXCLUDING_EXCLUDED,
    }
)

_WORKING_PRECISION = 60
_RAW_QUANT = Decimal("0.0000000001")  # 10 dp
_AREA_QUANT = Decimal("0.01")  # m², matching the stored area precision

# --------------------------------------------------------------------------- #
# Area-reconciliation tolerance (the float ↔ exact-Decimal boundary)
# --------------------------------------------------------------------------- #

# ``evaluated_area_m2`` and every ``class_area_m2`` are stored ``double precision``
# and read into exact ``Decimal``. The stored total and the exact sum of the stored
# parts are therefore two different float64 computations of the same quantity and
# disagree in their last units in the last place — the class sum can come out a
# hair *above* its own denominator without anything being structurally wrong.
#
# The tolerance is expressed as a **dimensionless fraction of the denominator
# area**, not as an absolute area, because that is the shape the defect actually
# has: float representation error is proportional to magnitude. Measured on the
# real capital-region dataset (run 47, 40,427 covered cells, EPSG:5186, areas in
# m²), the largest excess anywhere is
#
#     absolute  7.33 × 10⁻⁶ m²   (7.3 square micrometres)
#     relative  2.93 × 10⁻¹¹     of the cell's own denominator
#
# and the relative bound holds across four orders of magnitude of denominator
# (0.5 m² slivers through whole 250,000 m² cells), which an absolute tolerance
# would not. 1 × 10⁻⁹ leaves ~34× headroom over the worst observed artifact while
# staying nine orders of magnitude below anything an overlay defect could produce:
# not one cell in the dataset exceeds its denominator by even 10⁻⁴ m².
#
# This tolerates *representation-level* disagreement only. A materially invalid
# class sum — a double-counted overlay, a mismatched denominator — is still
# reported as ``CLASS_AREA_EXCEEDS_DENOMINATOR`` and is never clamped into a
# plausible-looking share.
AREA_RECONCILIATION_RELATIVE_TOLERANCE = Decimal("1e-9")

# Unit of every area quantity in this module, recorded so the tolerance above is
# never read as an absolute figure in some other unit.
AREA_UNIT = "m2"

# The raw value is already a bounded [0,1] areal share, so it maps straight to a
# [0,100] score without reference to any other cell. That is preferred here over a
# percentile rank for three reasons: the score stays a physically interpretable
# quantity with a source and reference period; it is comparable across runs rather
# than relative to whichever candidate set happened to be scored; and it does not
# hand CRITIC an artificially uniform distribution (see
# ``contract.NORMALIZATION_BOUNDED_RATIO``). Percentile ranking is still selectable
# explicitly, and neither choice is yet approved successor policy.
DEFAULT_NORMALIZATION_STRATEGY = contract.NORMALIZATION_BOUNDED_RATIO

# No official developed/artificial class registry exists in this repository. This
# stays None until the class-registry research lane delivers an audited one; a
# guessed list would be an invented official classification.
PRODUCTION_REGISTRY: LandCoverClassRegistry | None = None

METHOD_NOTE = (
    "Share of the measured cell area that is not in a developed/artificial land-cover class, "
    "computed from the stored candidate-cell land-cover class areas against an explicitly "
    "supplied class registry. No class code is classified by this module."
)


class LandConversionConfigurationError(ValueError):
    """Raised when the land-conversion configuration is unusable as given."""


# --------------------------------------------------------------------------- #
# Externally supplied classification registry
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class LandCoverClassRegistry:
    """An externally supplied developed/artificial land-cover classification.

    ``known_class_codes`` must cover every class code the caller expects to see at
    ``class_level``; ``developed_class_codes`` is the subset treated as already
    developed / artificial. Keeping the two separate is what makes "this code is
    not classified" distinguishable from "this code is not developed" — the former
    makes an observation unavailable, the latter contributes to the conversion
    share.

    ``excluded_class_codes`` names classes that belong in **neither** the numerator
    nor the denominator (the natural treatment for water under a "share of the
    *land* that is developed" reading). Excluding a class is a substantive
    analytical choice, so it is opt-in, recorded in provenance, and only takes
    effect when the caller also selects
    :data:`DENOMINATOR_EVALUATED_AREA_EXCLUDING_EXCLUDED`.

    ``ambiguous_class_codes`` flags classes whose developed/not-developed
    assignment is a contested policy call. Flagging does **not** leave a hole: an
    ambiguous class must still be resolved into exactly one of developed /
    not-developed / excluded, so the registry stays total. The flag makes the
    contested decisions visible and auditable in every observation's provenance.

    ``approved`` stays ``False`` for any registry that has not been through the
    official class-registry audit. Nothing in this module ships an approved one.
    """

    registry_id: str
    class_level: int
    developed_class_codes: frozenset[str]
    known_class_codes: frozenset[str]
    source: str
    excluded_class_codes: frozenset[str] = frozenset()
    ambiguous_class_codes: frozenset[str] = frozenset()
    approved: bool = False
    note: str | None = None

    def __post_init__(self) -> None:
        if not self.registry_id.strip():
            raise LandConversionConfigurationError("registry_id must be a non-empty identifier")
        if self.class_level not in (1, 2, 3):
            raise LandConversionConfigurationError(
                f"class_level must be 1 (대분류), 2 (중분류), or 3 (세분류); got {self.class_level}"
            )
        if not self.known_class_codes:
            raise LandConversionConfigurationError(
                "known_class_codes must enumerate every class code the registry classifies"
            )
        for label, codes in (
            ("developed_class_codes", self.developed_class_codes),
            ("excluded_class_codes", self.excluded_class_codes),
            ("ambiguous_class_codes", self.ambiguous_class_codes),
        ):
            unknown = codes - self.known_class_codes
            if unknown:
                raise LandConversionConfigurationError(
                    f"{label} must be a subset of known_class_codes; unknown: {sorted(unknown)}"
                )
        overlap = self.developed_class_codes & self.excluded_class_codes
        if overlap:
            raise LandConversionConfigurationError(
                "a class cannot be both developed and excluded from the denominator; "
                f"overlapping: {sorted(overlap)}"
            )
        if not self.source.strip():
            raise LandConversionConfigurationError(
                "registry requires an explicit source (where the classification comes from)"
            )

    def is_developed(self, class_code: str) -> bool:
        return class_code in self.developed_class_codes

    def is_excluded(self, class_code: str) -> bool:
        return class_code in self.excluded_class_codes

    def is_known(self, class_code: str) -> bool:
        return class_code in self.known_class_codes

    def non_developed_class_codes(self) -> frozenset[str]:
        """Known classes that count toward the conversion-exposed share."""

        return frozenset(
            self.known_class_codes - self.developed_class_codes - self.excluded_class_codes
        )

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "registry_id": self.registry_id,
            "class_level": self.class_level,
            "developed_class_codes": sorted(self.developed_class_codes),
            "excluded_class_codes": sorted(self.excluded_class_codes),
            "ambiguous_class_codes": sorted(self.ambiguous_class_codes),
            "known_class_code_count": len(self.known_class_codes),
            "source": self.source,
            "approved": self.approved,
            "note": self.note,
        }


# --------------------------------------------------------------------------- #
# Inputs
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class ClassArea:
    """One land-cover class's measured area inside one candidate cell.

    Mirrors a stored ``environmental_land_cover_cell_class_areas`` row: the class
    code and name are the official source values, verbatim.
    """

    class_level: int
    class_code: str
    class_name: str
    class_area_m2: Decimal | None


@dataclass(frozen=True)
class LandConversionInput:
    """The source facts for one candidate cell's land-conversion observation."""

    candidate_key: str
    coverage_status: str
    cell_area_m2: Decimal | None
    evaluated_area_m2: Decimal | None
    class_areas: tuple[ClassArea, ...] = ()
    coverage_ratio: Decimal | None = None
    statistics_version_id: int | None = None
    land_cover_dataset_version_id: int | None = None
    land_cover_derivation_version: str | None = None
    area_crs: str | None = None
    source_reference_period: str | None = None
    extra_provenance: dict[str, Any] = field(default_factory=dict)


def _provenance(
    inp: LandConversionInput, registry: LandCoverClassRegistry, denominator: str
) -> dict[str, Any]:
    provenance: dict[str, Any] = {
        "component": COMPONENT,
        "method_version": METHOD_VERSION,
        "raw_unit": RAW_UNIT,
        "denominator": denominator,
        "class_registry": registry.sanitized_summary(),
        "land_cover_derivation_version": inp.land_cover_derivation_version,
        "statistics_version_id": inp.statistics_version_id,
        "land_cover_dataset_version_id": inp.land_cover_dataset_version_id,
        "area_crs": inp.area_crs,
        "source_reference_period": inp.source_reference_period,
        "normalization_strategy": DEFAULT_NORMALIZATION_STRATEGY,
        "normalization": contract.NORMALIZATION_DESCRIPTIONS[DEFAULT_NORMALIZATION_STRATEGY],
        "direction": DIRECTION,
        "note": METHOD_NOTE,
    }
    provenance.update(inp.extra_provenance)
    return provenance


def _clamp_to_unit_interval(share: Decimal) -> tuple[Decimal, bool]:
    """Clamp a share into ``[0,1]``, reporting whether the clamp bit.

    Only reachable for an excess already proven to be within
    :data:`AREA_RECONCILIATION_RELATIVE_TOLERANCE`; a materially over-unity share
    is rejected before this point.
    """

    if share > 1:
        return Decimal("1"), True
    if share < 0:
        return Decimal("0"), True
    return share, False


def _select_denominator(
    inp: LandConversionInput, denominator: str, excluded_area: Decimal
) -> Decimal | None:
    """The denominator area for the selected, explicitly named convention."""

    if denominator == DENOMINATOR_CELL_AREA:
        return inp.cell_area_m2
    if inp.evaluated_area_m2 is None:
        return None
    if denominator == DENOMINATOR_EVALUATED_AREA_EXCLUDING_EXCLUDED:
        return inp.evaluated_area_m2 - excluded_area
    return inp.evaluated_area_m2


def observe(
    inp: LandConversionInput,
    registry: LandCoverClassRegistry,
    *,
    denominator: str = DENOMINATOR_EVALUATED_AREA,
) -> ComponentObservation:
    """Derive one candidate cell's ``land_conversion`` observation."""

    if denominator not in DENOMINATORS:
        raise LandConversionConfigurationError(
            f"unknown denominator {denominator!r}; expected one of {sorted(DENOMINATORS)}"
        )

    level_rows = tuple(row for row in inp.class_areas if row.class_level == registry.class_level)
    # Excluded-class area is needed before the denominator is chosen, and it is only
    # ever subtracted under the explicitly named excluding denominator.
    excluded_area = sum(
        (
            row.class_area_m2
            for row in level_rows
            if row.class_area_m2 is not None
            and row.class_area_m2 >= 0
            and registry.is_excluded(row.class_code)
        ),
        start=Decimal("0"),
    )
    denominator_area = _select_denominator(inp, denominator, excluded_area)

    inputs: dict[str, Any] = {
        "coverage_status": inp.coverage_status,
        "denominator": denominator,
        "cell_area_m2": (format(inp.cell_area_m2, "f") if inp.cell_area_m2 is not None else None),
        "evaluated_area_m2": (
            format(inp.evaluated_area_m2, "f") if inp.evaluated_area_m2 is not None else None
        ),
        "coverage_ratio": (
            format(inp.coverage_ratio, "f") if inp.coverage_ratio is not None else None
        ),
        "class_registry_id": registry.registry_id,
        "class_level": registry.class_level,
        "class_row_count": len(level_rows),
    }
    provenance = _provenance(inp, registry, denominator)

    reasons: list[str] = []

    if inp.coverage_status == COVERAGE_NO_COVERAGE:
        reasons.append(contract.REASON_NO_LAND_COVER_COVERAGE)
    if denominator_area is None:
        reasons.append(contract.REASON_MISSING_EVALUATED_AREA)
    elif denominator_area <= 0:
        reasons.append(contract.REASON_NO_EVALUATED_AREA)

    missing_area_codes = contract.sorted_unique(
        row.class_code for row in level_rows if row.class_area_m2 is None
    )
    negative_area_codes = contract.sorted_unique(
        row.class_code
        for row in level_rows
        if row.class_area_m2 is not None and row.class_area_m2 < 0
    )
    if missing_area_codes or negative_area_codes:
        reasons.append(contract.REASON_INVALID_CLASS_AREA)
        if missing_area_codes:
            inputs["missing_class_area_codes"] = missing_area_codes
        if negative_area_codes:
            inputs["negative_class_area_codes"] = negative_area_codes

    unclassified = contract.sorted_unique(
        row.class_code for row in level_rows if not registry.is_known(row.class_code)
    )
    if unclassified:
        reasons.append(contract.REASON_UNCLASSIFIED_LAND_COVER_CLASS)
        inputs["unclassified_class_codes"] = unclassified

    if not level_rows and inp.coverage_status != COVERAGE_NO_COVERAGE:
        reasons.append(contract.REASON_MISSING_CLASS_COMPOSITION)

    if reasons:
        return ComponentObservation(
            component=COMPONENT,
            unit_key=inp.candidate_key,
            raw_value=None,
            raw_unit=RAW_UNIT,
            unavailable_reasons=contract.sorted_unique(reasons),
            inputs=inputs,
            provenance=provenance,
        )

    assert denominator_area is not None and denominator_area > 0
    developed_area = Decimal("0")
    non_developed_area = Decimal("0")
    developed_codes: list[str] = []
    non_developed_codes: list[str] = []
    excluded_codes: list[str] = []
    ambiguous_codes: list[str] = []
    for row in level_rows:
        assert row.class_area_m2 is not None
        if registry.is_excluded(row.class_code):
            excluded_codes.append(row.class_code)
        elif registry.is_developed(row.class_code):
            developed_area += row.class_area_m2
            developed_codes.append(row.class_code)
        else:
            non_developed_area += row.class_area_m2
            non_developed_codes.append(row.class_code)
        if row.class_code in registry.ambiguous_class_codes:
            ambiguous_codes.append(row.class_code)

    class_area_sum = developed_area + non_developed_area
    inputs["developed_area_m2"] = format(developed_area.quantize(_AREA_QUANT), "f")
    inputs["non_developed_area_m2"] = format(non_developed_area.quantize(_AREA_QUANT), "f")
    inputs["excluded_area_m2"] = format(excluded_area.quantize(_AREA_QUANT), "f")
    inputs["class_area_sum_m2"] = format(class_area_sum.quantize(_AREA_QUANT), "f")
    inputs["denominator_area_m2"] = format(denominator_area, "f")
    inputs["denominator_reconciliation_difference_m2"] = format(
        (denominator_area - class_area_sum).quantize(_AREA_QUANT), "f"
    )
    inputs["developed_class_codes_observed"] = contract.sorted_unique(developed_codes)
    inputs["non_developed_class_codes_observed"] = contract.sorted_unique(non_developed_codes)
    inputs["excluded_class_codes_observed"] = contract.sorted_unique(excluded_codes)
    # Contested classifications travel with every observation that depends on one,
    # so a downstream reader can see which policy calls the number rests on.
    inputs["ambiguous_class_codes_observed"] = contract.sorted_unique(ambiguous_codes)

    # A class-area sum larger than its own denominator is either (a) a structural
    # impossibility — a double-counted overlay or a mismatched denominator — or
    # (b) the float ↔ exact-Decimal boundary described at
    # :data:`AREA_RECONCILIATION_RELATIVE_TOLERANCE`. The two are separated by an
    # explicit tolerance rather than conflated: (a) is still reported and never
    # clamped, (b) is measured, recorded, and allowed through.
    with localcontext() as ctx:
        ctx.prec = _WORKING_PRECISION
        area_excess = class_area_sum - denominator_area
        excess_tolerance = denominator_area * AREA_RECONCILIATION_RELATIVE_TOLERANCE

    inputs["class_area_excess_m2"] = format(area_excess, "f")
    inputs["area_reconciliation_tolerance_m2"] = format(excess_tolerance, "f")
    inputs["area_reconciliation_relative_tolerance"] = format(
        AREA_RECONCILIATION_RELATIVE_TOLERANCE, "f"
    )
    inputs["area_unit"] = AREA_UNIT
    inputs["class_area_within_reconciliation_tolerance"] = bool(
        Decimal("0") < area_excess <= excess_tolerance
    )

    if area_excess > excess_tolerance:
        return ComponentObservation(
            component=COMPONENT,
            unit_key=inp.candidate_key,
            raw_value=None,
            raw_unit=RAW_UNIT,
            unavailable_reasons=(contract.REASON_CLASS_AREA_EXCEEDS_DENOMINATOR,),
            inputs=inputs,
            provenance=provenance,
        )

    with localcontext() as ctx:
        ctx.prec = _WORKING_PRECISION
        conversion_share = non_developed_area / denominator_area
        developed_share = developed_area / denominator_area

    # Within the tolerance a share can land a hair above 1. Clamping is only ever
    # applied to that proven representation-level excess — anything larger has
    # already been rejected above — and it is recorded rather than silent, because
    # a bounded-ratio score must sit in [0,1] by contract.
    conversion_share, conversion_clamped = _clamp_to_unit_interval(conversion_share)
    developed_share, developed_clamped = _clamp_to_unit_interval(developed_share)
    inputs["share_clamped_to_unit_interval"] = conversion_clamped or developed_clamped

    inputs["developed_share"] = format(
        developed_share.quantize(_RAW_QUANT, rounding=ROUND_HALF_EVEN), "f"
    )

    is_partial = inp.coverage_status == COVERAGE_PARTIAL
    return ComponentObservation(
        component=COMPONENT,
        unit_key=inp.candidate_key,
        raw_value=conversion_share.quantize(_RAW_QUANT, rounding=ROUND_HALF_EVEN),
        raw_unit=RAW_UNIT,
        is_partial=is_partial,
        partial_reasons=((contract.PARTIAL_LAND_COVER_COVERAGE,) if is_partial else ()),
        inputs=inputs,
        provenance=provenance,
    )


def build_series(
    inputs: Sequence[LandConversionInput],
    registry: LandCoverClassRegistry,
    *,
    denominator: str = DENOMINATOR_EVALUATED_AREA,
    normalization_strategy: str = DEFAULT_NORMALIZATION_STRATEGY,
) -> ComponentSeries:
    """Observe every candidate cell and assemble the deterministic series."""

    observations = [observe(item, registry, denominator=denominator) for item in inputs]
    return contract.build_series(
        component=COMPONENT,
        method_version=METHOD_VERSION,
        direction=DIRECTION,
        raw_unit=RAW_UNIT,
        observations=observations,
        normalization_strategy=normalization_strategy,
        provenance={
            "method_version": METHOD_VERSION,
            "denominator": denominator,
            "normalization_strategy": normalization_strategy,
            "class_registry": registry.sanitized_summary(),
            "note": METHOD_NOTE,
        },
        disclaimer=(
            "Land-conversion exposure derived from stored candidate-cell land-cover class "
            "areas against an externally supplied class registry. This module classifies no "
            "land-cover code itself and asserts no official developed/artificial class list."
        ),
    )


def normalized_scores(
    inputs: Sequence[LandConversionInput],
    registry: LandCoverClassRegistry,
    *,
    denominator: str = DENOMINATOR_EVALUATED_AREA,
    normalization_strategy: str = DEFAULT_NORMALIZATION_STRATEGY,
) -> dict[str, Decimal]:
    """Convenience: dimensionless [0,100] scores keyed by candidate key."""

    return build_series(
        inputs,
        registry,
        denominator=denominator,
        normalization_strategy=normalization_strategy,
    ).normalized_scores()


def assert_developed_share_monotone_across_levels(
    coarse: ComponentObservation, fine: ComponentObservation
) -> None:
    """Assert a finer registry never reports *less* developed area than a coarser one.

    A coarse (L1) registry that marks a whole parent class developed is a strict
    lower bound on a finer (L2) registry that additionally marks artificial children
    of *other* parents developed. So for the same cell and denominator,
    ``fine.developed_share >= coarse.developed_share`` must hold. A violation means
    the two registries disagree about a parent/child assignment, which is a registry
    defect rather than a data finding — it is raised, never averaged away.
    """

    if coarse.unit_key != fine.unit_key:
        raise LandConversionConfigurationError(
            f"cannot compare observations for different cells: "
            f"{coarse.unit_key!r} vs {fine.unit_key!r}"
        )
    coarse_share = coarse.inputs.get("developed_share")
    fine_share = fine.inputs.get("developed_share")
    if coarse_share is None or fine_share is None:
        return  # one side is unavailable; there is nothing to compare
    if Decimal(str(fine_share)) < Decimal(str(coarse_share)):
        raise LandConversionConfigurationError(
            f"cell {coarse.unit_key!r}: finer-level developed share {fine_share} is below the "
            f"coarser-level share {coarse_share}; the two class registries disagree"
        )


def aggregate_class_areas(
    class_areas: Iterable[ClassArea], registry: LandCoverClassRegistry
) -> dict[str, Decimal]:
    """Sum developed / non-developed / total area at the registry's class level.

    Raises :class:`LandConversionConfigurationError` when a class is not classified
    by the registry or carries an unusable area — the aggregation never silently
    absorbs an unknown class into either bucket.
    """

    developed = Decimal("0")
    non_developed = Decimal("0")
    for row in class_areas:
        if row.class_level != registry.class_level:
            continue
        if row.class_area_m2 is None or row.class_area_m2 < 0:
            raise LandConversionConfigurationError(
                f"class {row.class_code!r} has an unusable area {row.class_area_m2!r}"
            )
        if not registry.is_known(row.class_code):
            raise LandConversionConfigurationError(
                f"class {row.class_code!r} is not classified by registry {registry.registry_id!r}"
            )
        if registry.is_excluded(row.class_code):
            continue
        if registry.is_developed(row.class_code):
            developed += row.class_area_m2
        else:
            non_developed += row.class_area_m2
    return {
        "developed_area_m2": developed,
        "non_developed_area_m2": non_developed,
        "class_area_sum_m2": developed + non_developed,
    }
