"""Successor component B — ``air_impact_proxy``.

**This is a proxy and is named, labelled, and disclaimed as one.** It is derived
from total regional waste-generation activity per resident. It is explicitly
**not**:

* measured atmospheric emissions,
* a modelled stack or dispersion concentration,
* a health-risk or exposure estimate,
* evidence that any particular facility, region, or candidate has an air-quality
  problem.

Derivation, per compatible SIGUNGU and reference period::

    total_generation      = household + business_non_facility
                          + industrial_facility + construction        [톤/년]
    per_capita_generation = total_generation × 1000 / resident_population   [kg/인/년]

The four streams are exactly the canonical streams the repository already ingests
(RCIS PIDs NTN007 / NTN008 / NTN018 / NTN022). **All four are required** for a
complete observation: a missing stream is never zero-filled, because "no row" and
"zero tonnes" are different facts. The per-capita conversion reuses the platform's
validated :func:`~waste_equity_backend.analysis.per_capita.per_capita_kg_per_year`
helper rather than restating the unit conversion.

Direction: **lower per-capita generation → higher score**.

Grain and period compatibility are checked, not assumed. Some RCIS PIDs report
seven large Gyeonggi cities at CITY level rather than SIGUNGU (those records live
in ``reporting_region_waste_statistics``, keyed by a derived reporting region).
Summing a CITY-grain value into a SIGUNGU-grain total would silently mix
geographies, so a stream whose ``source_geographic_level`` does not match the
observation's grain makes the observation unavailable with
``INCOMPATIBLE_GEOGRAPHIC_GRAIN``. Reference periods and quantity units are
checked the same way.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from ....models.waste import ACCOUNTING_BASIS_ORIGIN_TREATMENT
from ...per_capita import (
    DERIVATION_VERSION as PER_CAPITA_DERIVATION_VERSION,
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

METHOD_VERSION = "successor-air-impact-proxy-v1"
COMPONENT = contract.COMPONENT_AIR_IMPACT_PROXY
DIRECTION = contract.LOWER_RAW_IS_BETTER
RAW_UNIT = PER_CAPITA_UNIT

# The canonical waste streams this repository ingests. All four are required.
STREAM_HOUSEHOLD = "HOUSEHOLD"
STREAM_BUSINESS_NON_FACILITY = "BUSINESS_NON_FACILITY"
STREAM_INDUSTRIAL_FACILITY = "INDUSTRIAL_FACILITY"
STREAM_CONSTRUCTION = "CONSTRUCTION"

REQUIRED_WASTE_STREAMS: tuple[str, ...] = (
    STREAM_HOUSEHOLD,
    STREAM_BUSINESS_NON_FACILITY,
    STREAM_INDUSTRIAL_FACILITY,
    STREAM_CONSTRUCTION,
)

GEOGRAPHIC_GRAIN = "SIGUNGU"

PROXY_DISCLAIMER = (
    "PROXY ONLY. air_impact_proxy is total regional waste-generation activity per resident. "
    "It is NOT measured atmospheric emissions, NOT a modelled stack or dispersion "
    "concentration, and NOT a health-risk or exposure estimate. It is a coarse activity "
    "indicator used for analytical screening and must never be presented as air-quality "
    "evidence. No air-quality dataset is ingested by this platform, so this proxy has not "
    "been validated against any measured air variable."
)

# Caveats that travel with every observation. These are known, unresolved limits of
# the inputs — recorded so they cannot be lost between the derivation and whatever
# eventually displays it.
PROXY_CAVEATS: tuple[str, ...] = (
    "Origin-based generation describes how a region's own generated waste was treated. "
    "It is not facility throughput, not an origin-to-destination flow, and says nothing "
    "about where combustion or handling physically occurred.",
    "The HOUSEHOLD stream's population coverage cannot be verified from this platform's "
    "data: RCIS NTN002 (생활폐기물관리구역현황), which reports the household-waste "
    "management-excluded area and population per SIGUNGU, is not ingested. Where a region "
    "has a management-excluded area, HOUSEHOLD generation covers a sub-population while "
    "the per-capita denominator uses the full resident population. The other three streams "
    "are not population-denominated at source, so this caveat is asymmetric across the four.",
    "This component is a region-level variable broadcast to every candidate cell in the "
    "region; it cannot discriminate between cells within one region.",
)

# The numerator this module implements. Origin-based *incinerated* tonnage
# (``incineration_quantity``) is stored on the same rows, at the same unit, grain,
# basis, and coverage, and is a shorter assumption chain to a combustion-linked air
# burden. It is a documented open alternative, not a silent substitution: switching
# would change every value, so it belongs to the same approval as activation.
NUMERATOR_BASIS = "TOTAL_GENERATION_ACROSS_FOUR_CANONICAL_STREAMS"
NUMERATOR_ALTERNATIVE_UNDER_REVIEW = "ORIGIN_BASED_INCINERATION_QUANTITY"

METHOD_NOTE = (
    "Sum of the four canonical RCIS generation streams (HOUSEHOLD, BUSINESS_NON_FACILITY, "
    "INDUSTRIAL_FACILITY, CONSTRUCTION) divided by resident population, using the platform's "
    f"validated per-capita derivation ({PER_CAPITA_DERIVATION_VERSION}). Accounting basis is "
    f"{ACCOUNTING_BASIS_ORIGIN_TREATMENT} — origin-based generation, not facility throughput."
)


@dataclass(frozen=True)
class StreamObservation:
    """One canonical waste stream's reported generation for one region and period.

    ``generation_quantity`` is ``None`` when the official observation is absent.
    That is never coerced to zero.
    """

    waste_stream: str
    generation_quantity: Decimal | None
    quantity_unit: str | None = None
    reference_period: str | None = None
    source_geographic_level: str | None = None
    source_id: str | None = None
    source_pid: str | None = None
    accounting_basis: str | None = None


@dataclass(frozen=True)
class AirImpactProxyInput:
    """The source facts for one region's air-impact-proxy observation."""

    region_code: str
    population: int | None
    streams: tuple[StreamObservation, ...] = ()
    expected_geographic_level: str = GEOGRAPHIC_GRAIN
    population_source_id: str | None = None
    population_reference_period: str | None = None
    extra_provenance: dict[str, Any] = field(default_factory=dict)


def _stream_inputs(streams: Sequence[StreamObservation]) -> dict[str, Any]:
    """Preserve every individual source value, unit, period, grain, and provenance."""

    by_stream: dict[str, Any] = {}
    for observed in streams:
        entry = {
            "generation_quantity": (
                format(observed.generation_quantity, "f")
                if observed.generation_quantity is not None
                else None
            ),
            "quantity_unit": observed.quantity_unit,
            "reference_period": observed.reference_period,
            "source_geographic_level": observed.source_geographic_level,
            "source_id": observed.source_id,
            "source_pid": observed.source_pid,
            "accounting_basis": observed.accounting_basis,
        }
        # A duplicate stream keeps both occurrences visible rather than the last one.
        existing = by_stream.get(observed.waste_stream)
        if existing is None:
            by_stream[observed.waste_stream] = entry
        elif isinstance(existing, list):
            existing.append(entry)
        else:
            by_stream[observed.waste_stream] = [existing, entry]
    return {stream: by_stream[stream] for stream in sorted(by_stream)}


def _provenance(inp: AirImpactProxyInput) -> dict[str, Any]:
    provenance: dict[str, Any] = {
        "component": COMPONENT,
        "method_version": METHOD_VERSION,
        "per_capita_derivation_version": PER_CAPITA_DERIVATION_VERSION,
        "required_waste_streams": list(REQUIRED_WASTE_STREAMS),
        "accounting_basis": ACCOUNTING_BASIS_ORIGIN_TREATMENT,
        "expected_quantity_unit": EXPECTED_QUANTITY_UNIT,
        "raw_unit": RAW_UNIT,
        "numerator_basis": NUMERATOR_BASIS,
        "caveats": list(PROXY_CAVEATS),
        "geographic_grain": inp.expected_geographic_level,
        "population_source_id": inp.population_source_id,
        "population_reference_period": inp.population_reference_period,
        "normalization": contract.NORMALIZATION,
        "direction": DIRECTION,
        "note": METHOD_NOTE,
        "disclaimer": PROXY_DISCLAIMER,
    }
    provenance.update(inp.extra_provenance)
    return provenance


def _compatibility_reasons(
    inp: AirImpactProxyInput, present: dict[str, StreamObservation]
) -> tuple[list[str], dict[str, Any]]:
    """Collect every compatibility failure across the present streams.

    Returns the reason codes and the structured detail (which streams, which units,
    which periods, which grains) so an unavailable observation explains itself.
    """

    reasons: list[str] = []
    detail: dict[str, Any] = {}

    unsupported = sorted({s.waste_stream for s in inp.streams} - set(REQUIRED_WASTE_STREAMS))
    if unsupported:
        reasons.append(contract.REASON_UNSUPPORTED_WASTE_STREAM)
        detail["unsupported_waste_streams"] = unsupported

    seen: dict[str, int] = {}
    for observed in inp.streams:
        seen[observed.waste_stream] = seen.get(observed.waste_stream, 0) + 1
    duplicates = sorted(name for name, count in seen.items() if count > 1)
    if duplicates:
        reasons.append(contract.REASON_DUPLICATE_WASTE_STREAM)
        detail["duplicate_waste_streams"] = duplicates

    missing = [stream for stream in REQUIRED_WASTE_STREAMS if stream not in present]
    if missing:
        reasons.append(contract.REASON_MISSING_WASTE_STREAM)
        detail["missing_waste_streams"] = missing

    bad_units = sorted(
        stream
        for stream, observed in present.items()
        if observed.quantity_unit != EXPECTED_QUANTITY_UNIT
    )
    if bad_units:
        reasons.append(contract.REASON_INCOMPATIBLE_QUANTITY_UNIT)
        detail["incompatible_quantity_unit_streams"] = bad_units
        detail["expected_quantity_unit"] = EXPECTED_QUANTITY_UNIT

    periods = {observed.reference_period for observed in present.values()}
    if len(periods) > 1:
        reasons.append(contract.REASON_INCOMPATIBLE_REFERENCE_PERIOD)
        detail["reference_periods"] = sorted(p if p is not None else "" for p in periods)

    bad_grain = sorted(
        stream
        for stream, observed in present.items()
        if observed.source_geographic_level != inp.expected_geographic_level
    )
    if bad_grain:
        reasons.append(contract.REASON_INCOMPATIBLE_GEOGRAPHIC_GRAIN)
        detail["incompatible_grain_streams"] = bad_grain
        detail["expected_geographic_level"] = inp.expected_geographic_level

    return reasons, detail


def observe(inp: AirImpactProxyInput) -> ComponentObservation:
    """Derive one region's ``air_impact_proxy`` observation.

    A stream present in ``inp.streams`` but carrying ``generation_quantity=None`` is
    treated as *not observed* (``MISSING_WASTE_STREAM``), never as zero tonnes.
    """

    # A stream counts as present only when it actually carries a quantity. The
    # first occurrence wins for lookup; duplicates are flagged separately.
    present: dict[str, StreamObservation] = {}
    for observed in inp.streams:
        if observed.waste_stream not in REQUIRED_WASTE_STREAMS:
            continue
        if observed.generation_quantity is None:
            continue
        present.setdefault(observed.waste_stream, observed)

    inputs: dict[str, Any] = {
        "population": inp.population,
        "streams": _stream_inputs(inp.streams),
        "required_waste_streams": list(REQUIRED_WASTE_STREAMS),
        "expected_geographic_level": inp.expected_geographic_level,
        "accounting_basis": ACCOUNTING_BASIS_ORIGIN_TREATMENT,
    }
    provenance = _provenance(inp)

    reasons, detail = _compatibility_reasons(inp, present)
    inputs.update(detail)

    if inp.population is None:
        reasons.append(contract.REASON_MISSING_POPULATION)
    elif inp.population <= 0:
        reasons.append(contract.REASON_NON_POSITIVE_POPULATION)

    # The total is only meaningful once every required stream is present and
    # compatible; report it whenever it is well-defined, even if the population
    # denominator is what failed, so the numerator stays visible.
    if len(present) == len(REQUIRED_WASTE_STREAMS):
        total = sum(
            (
                observed.generation_quantity
                for observed in present.values()
                if observed.generation_quantity is not None
            ),
            start=Decimal("0"),
        )
        inputs["total_generation_tons_per_year"] = format(total, "f")
        inputs["total_generation_unit"] = EXPECTED_QUANTITY_UNIT
        inputs["reference_period"] = next(iter(present.values())).reference_period
    else:
        total = None
        inputs["total_generation_tons_per_year"] = None

    if reasons or total is None or inp.population is None:
        return ComponentObservation(
            component=COMPONENT,
            unit_key=inp.region_code,
            raw_value=None,
            raw_unit=RAW_UNIT,
            unavailable_reasons=contract.sorted_unique(
                reasons or [contract.REASON_MISSING_WASTE_STREAM]
            ),
            inputs=inputs,
            provenance=provenance,
        )

    try:
        per_capita = per_capita_kg_per_year(total, EXPECTED_QUANTITY_UNIT, inp.population)
    except (ZeroPopulationError, UnexpectedQuantityUnitError) as exc:  # pragma: no cover
        # Defensive: both conditions are screened above.
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

    inputs["per_capita_generation"] = format(per_capita, "f")
    inputs["per_capita_generation_unit"] = RAW_UNIT
    return ComponentObservation(
        component=COMPONENT,
        unit_key=inp.region_code,
        raw_value=per_capita,
        raw_unit=RAW_UNIT,
        inputs=inputs,
        provenance=provenance,
    )


def build_series(inputs: Sequence[AirImpactProxyInput]) -> ComponentSeries:
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
            "per_capita_derivation_version": PER_CAPITA_DERIVATION_VERSION,
            "required_waste_streams": list(REQUIRED_WASTE_STREAMS),
            "accounting_basis": ACCOUNTING_BASIS_ORIGIN_TREATMENT,
            "geographic_grain": GEOGRAPHIC_GRAIN,
            "numerator_basis": NUMERATOR_BASIS,
            "caveats": list(PROXY_CAVEATS),
            "note": METHOD_NOTE,
        },
        disclaimer=PROXY_DISCLAIMER,
    )


def normalized_scores(inputs: Sequence[AirImpactProxyInput]) -> dict[str, Decimal]:
    """Convenience: dimensionless [0,100] scores keyed by region code."""

    return build_series(inputs).normalized_scores()
