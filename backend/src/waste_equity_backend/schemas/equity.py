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
