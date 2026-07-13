"""Response schemas for the RCIS waste reporting-geography endpoints.

The reporting geography serves the waste-generation and per-capita-waste metrics
on a source-compatible geometry: native SGIS regions RCIS reports directly, plus
the seven Gyeonggi cities RCIS reports at city level (rendered once each as a
DERIVED union of their SGIS child boundaries). Native-versus-derived geometry,
the child lineage, the source reporting level, and the source/reference period
are always explicit, and a city-level quantity is never labelled with a child
district name or code.
"""

from decimal import Decimal
from typing import Any

from pydantic import BaseModel

# reporting_geography_type values.
NATIVE_SGIS = "NATIVE_SGIS"
DERIVED_CITY_UNION = "DERIVED_CITY_UNION"


class ReportingBoundaryProperties(BaseModel):
    reporting_region_code: str
    reporting_region_name: str
    # NATIVE_SGIS | DERIVED_CITY_UNION
    reporting_geography_type: str
    # NATIVE | DERIVED
    geometry_kind: str
    derived_geometry_method: str | None
    # Native SGIS level (e.g. SIGUNGU) or CITY for a derived reporting region.
    source_reporting_level: str
    # For a native reporting region, the underlying SGIS region_code; None for a
    # derived region (a derived city is not a native SGIS region).
    native_region_code: str | None
    # SGIS child lineage (derived regions only).
    child_region_codes: list[str] | None
    child_region_names: list[str] | None
    # Boundary provenance.
    source_id: str
    boundary_reference_period: str


class ReportingBoundaryFeature(BaseModel):
    type: str = "Feature"
    geometry: dict[str, Any]
    properties: ReportingBoundaryProperties


class ReportingBoundaryCollection(BaseModel):
    """GeoJSON FeatureCollection of the RCIS waste reporting geography (EPSG:4326)."""

    type: str = "FeatureCollection"
    reference_year: int
    count: int
    features: list[ReportingBoundaryFeature]


class ReportingWasteStatisticsOut(BaseModel):
    reporting_region_code: str
    reporting_region_name: str
    reporting_geography_type: str
    geometry_kind: str
    source_reporting_level: str
    waste_stream: str
    waste_category_name: str
    generation_quantity: Decimal
    recycling_quantity: Decimal
    incineration_quantity: Decimal
    landfill_quantity: Decimal
    other_treatment_quantity: Decimal
    total_treatment_quantity: Decimal
    total_treatment_is_derived: bool
    quantity_unit: str
    accounting_basis: str
    source_id: str
    source_pid: str
    official_dataset_name: str
    reference_year: int
    reference_period: str
    # Child lineage for a derived city; None for native reporting regions.
    child_region_codes: list[str] | None


class ReportingUnavailableRegion(BaseModel):
    """A reporting region with no value for a waste stream, with a precise reason."""

    reporting_region_code: str
    reporting_region_name: str
    waste_stream: str
    # SOURCE_NOT_REPORTED | COARSER_REPORTING_GEOGRAPHY | SOURCE_ROW_REJECTED |
    # UNMATCHED_REGION_LABEL | AMBIGUOUS_REGION_LABEL
    reason: str


class ReportingWasteStatisticsEnvelope(BaseModel):
    reference_year: int
    count: int
    items: list[ReportingWasteStatisticsOut]
    # Reporting regions in the geography that have no value for a requested
    # stream, each with a precise availability reason (never a bare NO_DATA).
    unavailable_regions: list[ReportingUnavailableRegion]


class ReportingPerCapitaOut(BaseModel):
    reporting_region_code: str
    reporting_region_name: str
    reporting_geography_type: str
    source_reporting_level: str
    waste_stream: str
    per_capita_kg_per_year: Decimal
    per_capita_unit: str
    # Numerator (RCIS), served exactly as stored.
    generation_quantity: Decimal
    quantity_unit: str
    accounting_basis: str
    numerator_reporting_level: str
    waste_source_id: str
    waste_source_pid: str
    waste_official_dataset_name: str
    waste_reference_period: str
    # Denominator (SGIS). For a derived city the denominator is the exact sum of
    # the member SGIS child populations, flagged and lineage-preserved.
    population: int
    population_definition: str
    population_source_id: str
    population_reference_period: str
    population_is_derived: bool
    population_derivation: str | None
    child_region_codes: list[str] | None
    reference_year: int


class ReportingExcludedRegion(BaseModel):
    reporting_region_code: str
    reporting_region_name: str
    waste_stream: str
    # NO_POPULATION_DENOMINATOR | AMBIGUOUS_POPULATION_DEFINITION |
    # ZERO_POPULATION | UNEXPECTED_QUANTITY_UNIT | REFERENCE_PERIOD_MISMATCH |
    # INCOMPLETE_CHILD_POPULATION
    reason: str


class ReportingPerCapitaEnvelope(BaseModel):
    indicator: str
    derivation_version: str
    derivation_formula: str
    unit: str
    assumptions: list[str]
    reference_year: int
    count: int
    items: list[ReportingPerCapitaOut]
    excluded_regions: list[ReportingExcludedRegion]
