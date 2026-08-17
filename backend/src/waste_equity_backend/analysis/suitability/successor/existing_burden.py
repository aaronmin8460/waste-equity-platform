"""Successor component A — ``existing_burden``.

Concept (unchanged from the validated production derivation)::

    located facility throughput [톤/년]  ×  1000
    ------------------------------------------  =  kg per resident per year
              resident population

This module **does not restate that formula**. It calls the two already-validated
production helpers directly —
:func:`waste_equity_backend.analysis.facility_burden.aggregate_throughput` and
:func:`waste_equity_backend.analysis.per_capita.per_capita_kg_per_year` — so the
successor component can never drift from the burden number the rest of the
platform computes. What this module adds is the successor *contract* around that
number: an explicit availability rule, preserved inputs, provenance, and the
inverse-percentile normalization.

Direction: **lower raw burden → higher score**. A SIGUNGU that already absorbs a
large located-facility throughput per resident is a worse place to add more.

Relationship to the historical ``equity`` component: they read the same source
tables and share the same arithmetic, but they are **different components of
different models**. ``equity_score`` keeps its historical meaning on every stored
run; ``existing_burden`` is a new key in a new namespace. Neither is renamed into
the other.

One availability rule is deliberately stricter than the historical engine's, and
it is stated rather than hidden: when facility rows exist for a region but *every*
row's throughput is unusable (missing, or reported in an unexpected unit), the
located total would be a pure zero-fill of missing data, so the observation is
marked **unavailable** (``ALL_LOCATED_THROUGHPUT_MISSING``) instead of scoring a
best-possible zero burden. A region with genuinely *no* located facility rows is a
different case: zero located throughput is then an observed fact, so the
observation stays available and records ``no_located_facility_rows``.

That distinction only holds while "no rows" really means "no facilities". When the
source *does* hold facility evidence for a region but it could not be attributed
to that region's geography, the aggregate zero is a mapping artifact wearing the
costume of an observation — and zero is the *best possible* value on this scale.
The caller states such evidence explicitly with :class:`UnmappedFacilityEvidence`;
a region with unmapped evidence and nothing located of its own is **unavailable**
(``UNMAPPED_FACILITY_EVIDENCE``), while a region that has both stays available and
is flagged as a documented undercount.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from ....models.facilities import ACCOUNTING_BASIS_FACILITY_THROUGHPUT
from ...facility_burden import (
    BURDEN_DERIVATION_FORMULA,
    BURDEN_DERIVATION_VERSION,
    FacilityThroughput,
    aggregate_throughput,
)
from ...per_capita import (
    EXPECTED_QUANTITY_UNIT,
    PER_CAPITA_UNIT,
    UnexpectedQuantityUnitError,
    ZeroPopulationError,
    per_capita_kg_per_year,
)
from . import contract
from .contract import ComponentObservation, ComponentSeries

METHOD_VERSION = "successor-existing-burden-v1"
COMPONENT = contract.COMPONENT_EXISTING_BURDEN
DIRECTION = contract.LOWER_RAW_IS_BETTER
RAW_UNIT = PER_CAPITA_UNIT

# The analytical grain this component is defined on. A SIGUNGU-grain burden must
# never be mixed with a coarser reporting-geography value.
GEOGRAPHIC_GRAIN = "SIGUNGU"

METHOD_NOTE = (
    "Located-facility throughput per resident, computed by the platform's validated "
    f"burden derivation ({BURDEN_DERIVATION_VERSION}: {BURDEN_DERIVATION_FORMULA}). "
    "Accounting basis is FACILITY_LOCATION_BASED_THROUGHPUT — what facilities *in* the "
    "region process, not what the region's residents generate."
)


@dataclass(frozen=True)
class UnmappedFacilityEvidence:
    """Facility rows the source holds for a region that could not be attributed to it.

    A facility whose geography cannot be resolved to a SIGUNGU disappears from
    every region's located total. Where that region then has no facility of its
    own, its located throughput aggregates to **zero — the best possible value on
    a LOWER_RAW_IS_BETTER scale** — produced entirely by the mapping gap. Left
    unmodelled, the component would systematically reward exactly the regions
    whose burden is least known.

    This type is how the caller states "the source does hold facility evidence
    here, I just cannot place it". It is *evidence of an undercount*, never a
    numerator: ``throughput_tons_per_year`` records the magnitude of what is
    missing for the reader, and is never added to the region's burden.

    Establishing which region a set of unmapped rows covers is the **caller's**
    responsibility and an explicit geography contract, not an inference this
    module makes. ``reason`` and ``coverage_basis`` record how the caller decided,
    so the resulting unavailability is auditable back to its rule.
    """

    facility_count: int
    reason: str
    coverage_basis: str
    throughput_tons_per_year: Decimal | None = None
    source_reporting_unit: str | None = None

    def __post_init__(self) -> None:
        if self.facility_count <= 0:
            raise ValueError(
                "unmapped facility evidence must describe at least one row; "
                "pass None when there is no unmapped evidence"
            )
        if not self.reason.strip():
            raise ValueError("unmapped facility evidence requires an explicit reason")
        if not self.coverage_basis.strip():
            raise ValueError(
                "unmapped facility evidence requires an explicit coverage_basis "
                "(how the caller decided these rows cover this region)"
            )

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "facility_count": self.facility_count,
            "reason": self.reason,
            "coverage_basis": self.coverage_basis,
            "throughput_tons_per_year": (
                format(self.throughput_tons_per_year, "f")
                if self.throughput_tons_per_year is not None
                else None
            ),
            "source_reporting_unit": self.source_reporting_unit,
        }


@dataclass(frozen=True)
class ExistingBurdenInput:
    """The source facts for one region's existing-burden observation.

    ``facilities`` are the located facility rows for the region and reference year,
    passed as the same :class:`FacilityThroughput` pairs the production aggregation
    already consumes. ``population`` is the resident-population denominator;
    ``None`` means the official observation is absent, which is not the same as
    zero and is never treated as such.
    """

    region_code: str
    population: int | None
    facilities: tuple[FacilityThroughput, ...] = ()
    unmapped_facility_evidence: UnmappedFacilityEvidence | None = None
    facility_source_id: str | None = None
    facility_reference_period: str | None = None
    population_source_id: str | None = None
    population_reference_period: str | None = None
    population_definition: str | None = None
    source_geographic_level: str = GEOGRAPHIC_GRAIN
    extra_provenance: dict[str, Any] = field(default_factory=dict)


def _provenance(inp: ExistingBurdenInput) -> dict[str, Any]:
    provenance: dict[str, Any] = {
        "component": COMPONENT,
        "method_version": METHOD_VERSION,
        "burden_derivation_version": BURDEN_DERIVATION_VERSION,
        "burden_derivation_formula": BURDEN_DERIVATION_FORMULA,
        "accounting_basis": ACCOUNTING_BASIS_FACILITY_THROUGHPUT,
        "raw_unit": RAW_UNIT,
        "expected_quantity_unit": EXPECTED_QUANTITY_UNIT,
        "geographic_grain": GEOGRAPHIC_GRAIN,
        "source_geographic_level": inp.source_geographic_level,
        "facility_source_id": inp.facility_source_id,
        "facility_reference_period": inp.facility_reference_period,
        "population_source_id": inp.population_source_id,
        "population_reference_period": inp.population_reference_period,
        "population_definition": inp.population_definition,
        "normalization": contract.NORMALIZATION,
        "direction": DIRECTION,
        "note": METHOD_NOTE,
    }
    provenance.update(inp.extra_provenance)
    return provenance


def observe(inp: ExistingBurdenInput) -> ComponentObservation:
    """Derive one region's ``existing_burden`` observation.

    The located-throughput aggregation always runs (so its facility counts and
    missing-throughput count are preserved even when the observation turns out to
    be unavailable), and the per-capita conversion runs only when the denominator
    and the numerator are both usable.
    """

    aggregate = aggregate_throughput(list(inp.facilities))

    inputs: dict[str, Any] = {
        "population": inp.population,
        "located_throughput_tons_per_year": format(aggregate.total_tons_per_year, "f"),
        "located_throughput_unit": EXPECTED_QUANTITY_UNIT,
        "facility_count_located": aggregate.facility_count,
        "missing_throughput_count": aggregate.missing_throughput_count,
        "no_located_facility_rows": aggregate.facility_count == 0,
        "accounting_basis": ACCOUNTING_BASIS_FACILITY_THROUGHPUT,
        "source_geographic_level": inp.source_geographic_level,
        "unmapped_facility_evidence": (
            inp.unmapped_facility_evidence.sanitized_summary()
            if inp.unmapped_facility_evidence is not None
            else None
        ),
    }
    provenance = _provenance(inp)

    reasons: list[str] = []
    if inp.source_geographic_level != GEOGRAPHIC_GRAIN:
        reasons.append(contract.REASON_INCOMPATIBLE_GEOGRAPHIC_GRAIN)
    if inp.population is None:
        reasons.append(contract.REASON_MISSING_POPULATION)
    elif inp.population <= 0:
        reasons.append(contract.REASON_NON_POSITIVE_POPULATION)
    # Facility rows exist but not one of them carries a usable throughput: the
    # aggregate zero would be a zero-fill of missing data, not an observation.
    if (
        aggregate.facility_count > 0
        and aggregate.missing_throughput_count == aggregate.facility_count
    ):
        reasons.append(contract.REASON_ALL_LOCATED_THROUGHPUT_MISSING)
    # The source holds facility evidence covering this region that could not be
    # attributed to it, and the region has nothing located of its own: the total
    # is not "zero burden observed", it is "burden unknown". Scoring it zero would
    # hand the best possible value to the least-evidenced region.
    unmapped = inp.unmapped_facility_evidence
    if unmapped is not None and aggregate.facility_count == 0:
        reasons.append(contract.REASON_UNMAPPED_FACILITY_EVIDENCE)

    if reasons:
        return ComponentObservation(
            component=COMPONENT,
            unit_key=inp.region_code,
            raw_value=None,
            raw_unit=RAW_UNIT,
            unavailable_reasons=contract.sorted_unique(reasons),
            inputs=inputs,
            provenance=provenance,
        )

    assert inp.population is not None  # narrowed by the checks above
    try:
        burden = per_capita_kg_per_year(
            aggregate.total_tons_per_year, EXPECTED_QUANTITY_UNIT, inp.population
        )
    except (ZeroPopulationError, UnexpectedQuantityUnitError) as exc:  # pragma: no cover
        # Defensive: both conditions are already screened above. Never fall back to
        # a guessed value — report the observation as unavailable instead.
        reason = (
            contract.REASON_NON_POSITIVE_POPULATION
            if isinstance(exc, ZeroPopulationError)
            else contract.REASON_INCOMPATIBLE_QUANTITY_UNIT
        )
        return ComponentObservation(
            component=COMPONENT,
            unit_key=inp.region_code,
            raw_value=None,
            raw_unit=RAW_UNIT,
            unavailable_reasons=(reason,),
            inputs=inputs,
            provenance=provenance,
        )

    inputs["located_burden_kg_per_capita"] = format(burden, "f")
    partial: list[str] = []
    if aggregate.is_partial:
        partial.append(contract.PARTIAL_MISSING_FACILITY_THROUGHPUT)
    # The region does have located facilities, so the burden is measurable — but
    # unmapped evidence means the measurement is a known undercount. It stays
    # available (a real observation) and says so, rather than being silently
    # reported as if it were complete.
    if unmapped is not None:
        partial.append(contract.PARTIAL_UNMAPPED_FACILITY_EVIDENCE)

    return ComponentObservation(
        component=COMPONENT,
        unit_key=inp.region_code,
        raw_value=burden,
        raw_unit=RAW_UNIT,
        is_partial=bool(partial),
        partial_reasons=contract.sorted_unique(partial),
        inputs=inputs,
        provenance=provenance,
    )


def build_series(inputs: Sequence[ExistingBurdenInput]) -> ComponentSeries:
    """Observe every region and assemble the deterministic component series."""

    observations = [observe(item) for item in inputs]
    return contract.build_series(
        component=COMPONENT,
        method_version=METHOD_VERSION,
        direction=DIRECTION,
        raw_unit=RAW_UNIT,
        observations=observations,
        provenance={
            "method_version": METHOD_VERSION,
            "burden_derivation_version": BURDEN_DERIVATION_VERSION,
            "accounting_basis": ACCOUNTING_BASIS_FACILITY_THROUGHPUT,
            "geographic_grain": GEOGRAPHIC_GRAIN,
            "note": METHOD_NOTE,
        },
        disclaimer=(
            "Existing located-facility burden per resident. Facility-location throughput is "
            "not an origin-to-destination waste flow and not a measured environmental impact."
        ),
    )


def normalized_scores(inputs: Sequence[ExistingBurdenInput]) -> dict[str, Decimal]:
    """Convenience: dimensionless [0,100] scores keyed by region code."""

    return build_series(inputs).normalized_scores()
