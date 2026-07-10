"""Response schemas for the Phase 5 derived equity indicators.

Derived items carry BOTH provenances as required (non-optional) fields: the
waste numerator (RCIS source, PID, reference period, accounting basis) and the
population denominator (SGIS source, definition, reference period). The
envelope names the indicator, formula, unit, derivation version, and the
documented assumptions, and reports every excluded region with a reason so
gaps are visible instead of zero-filled.
"""

from decimal import Decimal

from pydantic import BaseModel


class ExcludedRegion(BaseModel):
    """A region/stream pair that could not be served honestly."""

    region_code: str
    region_name: str
    waste_stream: str
    # NO_POPULATION_DENOMINATOR | ZERO_POPULATION | UNEXPECTED_QUANTITY_UNIT
    reason: str


class WastePerCapitaOut(BaseModel):
    region_code: str
    region_name: str
    region_level: str
    waste_stream: str
    per_capita_kg_per_year: Decimal
    per_capita_unit: str
    # Numerator, served exactly as stored.
    generation_quantity: Decimal
    quantity_unit: str
    accounting_basis: str
    waste_source_id: str
    waste_source_pid: str
    waste_official_dataset_name: str
    waste_reference_period: str
    # Denominator, served exactly as stored.
    population: int
    population_definition: str
    population_source_id: str
    population_reference_period: str
    reference_year: int


class EquityEnvelope(BaseModel):
    """Derived-indicator envelope with explicit derivation metadata."""

    indicator: str
    derivation_version: str
    derivation_formula: str
    unit: str
    assumptions: list[str]
    reference_year: int
    count: int
    items: list[WastePerCapitaOut]
    excluded_regions: list[ExcludedRegion]


class ExcludedBurdenRegion(BaseModel):
    """A region whose burden indicator could not be derived honestly."""

    region_code: str
    region_name: str
    # NO_POPULATION_DENOMINATOR | AMBIGUOUS_POPULATION_DEFINITION |
    # ZERO_POPULATION
    reason: str


class FacilityBurdenOut(BaseModel):
    region_code: str
    region_name: str
    region_level: str
    # Facilities with this region as their canonical assignment (includes
    # name-crosswalk matches without coordinates). Zeros are real absences.
    facility_count_located: int
    throughput_located_tons_per_year: Decimal
    throughput_located_kg_per_capita: Decimal
    located_missing_throughput_count: int
    located_throughput_is_partial: bool
    # Facilities within the geodesic buffer of the region boundary; only
    # facilities with official coordinates can participate.
    facility_count_within_buffer: int
    throughput_within_buffer_tons_per_year: Decimal
    throughput_within_buffer_kg_per_capita: Decimal
    buffer_missing_throughput_count: int
    buffer_throughput_is_partial: bool
    quantity_unit: str
    accounting_basis: str
    facility_source_id: str
    facility_reference_period: str
    # Denominator, served exactly as stored.
    population: int
    population_definition: str
    population_source_id: str
    population_reference_period: str
    reference_year: int


class FacilityBurdenEnvelope(BaseModel):
    """Facility-burden envelope with buffer definition and coverage gaps."""

    indicator: str
    derivation_version: str
    derivation_formula: str
    buffer_meters: int
    unit: str
    assumptions: list[str]
    reference_year: int
    count: int
    items: list[FacilityBurdenOut]
    excluded_regions: list[ExcludedBurdenRegion]
    # Coverage gaps, reported so the served aggregates are never mistaken
    # for complete coverage.
    facilities_without_coordinates: int
    facilities_without_region: int
