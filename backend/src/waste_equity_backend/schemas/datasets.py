"""Response schemas for the Phase 3 normalized-dataset endpoints.

Every dataset item requires ``source_id`` and a reference-period field: a row
whose provenance is missing fails FastAPI response validation visibly instead
of being served unsourced. Quantities are ``Decimal`` and serialize to exact
JSON strings, preserving official precision.

The two accounting bases (``ORIGIN_BASED_TREATMENT_OUTCOME`` for regional
statistics, ``FACILITY_LOCATION_BASED_THROUGHPUT`` for facilities) live on
separate schemas and endpoints and must never be merged.
"""

import datetime
from decimal import Decimal
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

ItemT = TypeVar("ItemT", bound=BaseModel)


class DatasetEnvelope(BaseModel, Generic[ItemT]):
    """List envelope echoing the resolved reference year.

    ``reference_year`` is the year actually served (the requested year, or the
    latest available year when the request omitted one) so clients never have
    to guess which vintage they received.
    """

    reference_year: int
    count: int
    items: list[ItemT]


class UnavailableDataError(BaseModel):
    """Structured 404 detail for data that is not in the database."""

    error: str
    detail: str
    requested_year: int | None = None
    available_years: list[int] = []


class RegionOut(BaseModel):
    region_code: str
    region_name: str
    region_level: str
    parent_region_code: str | None
    source_id: str
    boundary_reference_period: str
    valid_from: datetime.date
    valid_to: datetime.date | None


class RegionBoundaryProperties(BaseModel):
    region_code: str
    region_name: str
    region_level: str
    parent_region_code: str | None
    source_id: str
    boundary_reference_period: str


class RegionBoundaryFeature(BaseModel):
    type: str = "Feature"
    geometry: dict[str, Any]
    properties: RegionBoundaryProperties


class RegionBoundaryCollection(BaseModel):
    """GeoJSON FeatureCollection of region boundaries (EPSG:4326)."""

    type: str = "FeatureCollection"
    reference_year: int
    count: int
    features: list[RegionBoundaryFeature]


class PopulationOut(BaseModel):
    region_code: str
    region_name: str
    region_level: str
    population: int
    unit: str
    population_definition: str
    source_id: str
    reference_year: int
    reference_period: str


class WasteStatisticsOut(BaseModel):
    region_code: str
    region_name: str
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


class FacilityOut(BaseModel):
    id: int
    facility_name: str
    operator_name: str | None
    address: str
    facility_category: str
    facility_kind: str
    ownership: str
    # Canonical region assignment; NULL while region_mapping_status is a
    # review status (UNMATCHED / AMBIGUOUS / REQUIRES_GEOCODE).
    region_code: str | None
    region_name: str | None
    region_mapping_status: str
    rcis_sido_name: str
    rcis_sigungu_name: str
    # EPSG:4326 point from the VWorld geocoder; NULL when geocoding failed or
    # has not run. Coordinates are never fabricated.
    longitude: float | None
    latitude: float | None
    geocode_status: str | None
    capacity_quantity: Decimal | None
    capacity_unit: str | None
    throughput_quantity: Decimal | None
    throughput_unit: str | None
    remaining_fill_capacity_m3: Decimal | None
    accounting_basis: str
    source_id: str
    source_pid: str
    official_dataset_name: str
    reference_year: int
    reference_period: str


class CategoryBreakdownRow(BaseModel):
    """Facility-category counts split by whether a map location exists.

    ``without_map_location`` counts facilities with NULL geometry; it is a
    "no usable map location" tally, never a zero-quantity claim.
    """

    category: str
    total: int
    with_map_location: int
    without_map_location: int


class OwnershipBreakdownRow(BaseModel):
    ownership: str
    total: int


class RegionMappingBreakdownRow(BaseModel):
    region_mapping_status: str
    total: int


class SourceBreakdownRow(BaseModel):
    source_id: str
    official_dataset_name: str
    total: int


class UnmappedFacilityRow(BaseModel):
    """One waste-treatment facility that has no usable map location.

    A NULL geometry means the official address could not be geocoded, not that
    the facility does not exist. ``missing_location_reason`` carries only the
    operator-recorded ``geocode_note`` annotation and only when it is non-empty;
    it is NULL otherwise (the UI renders "실패 사유 기록 없음"). No raw geocoder
    or database diagnostics are ever surfaced here.
    """

    id: int
    facility_name: str
    facility_category: str
    ownership: str
    rcis_sido_name: str
    rcis_sigungu_name: str
    # Canonical region assignment; NULL unless the facility matched a region by
    # exact name (an EXACT_MATCH can carry a region while geocoding failed).
    region_code: str | None
    region_name: str | None
    region_mapping_status: str
    geocode_status: str | None
    missing_location_reason: str | None


class PaginatedUnmapped(BaseModel):
    """Bounded page over the facilities without a map location.

    ``total`` is the count of all such facilities in the resolved year, so the
    caller can page without ever loading the whole set at once.
    """

    page: int
    page_size: int
    total: int
    items: list[UnmappedFacilityRow]


class FacilityMappingTransparencyOut(BaseModel):
    """Facility map-location transparency report for a citizen data page.

    Reports, over the waste-treatment facilities of one reference year, how many
    have a usable map location (a geocoded EPSG:4326 point) versus none, with
    category / ownership / region-mapping / source breakdowns and a paginated
    list of the facilities without a map location. A missing map location always
    means the official address could not be geocoded; it is never a zero and
    never a claim that the facility does not exist.
    """

    reference_year: int
    reference_period: str
    total: int
    with_map_location: int
    without_map_location: int
    without_address: int
    category_breakdown: list[CategoryBreakdownRow]
    ownership_breakdown: list[OwnershipBreakdownRow]
    region_mapping_breakdown: list[RegionMappingBreakdownRow]
    source_breakdown: list[SourceBreakdownRow]
    unmapped: PaginatedUnmapped
    disclaimer: str
