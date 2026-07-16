"""Normalized-dataset endpoints (Phase 3).

Read-only views over the normalized tables ingested in Phase 2. Handlers never
call government APIs and never read credentials; they serve exactly what the
ingestion jobs stored, with required source and reference-period metadata on
every item.

Scope rule: an endpoint that serves one series must filter to that series rather
than to its whole table. ``/population`` serves the annual SGIS SIGUNGU series
only, because ``regional_population`` also holds the MOIS monthly SIDO series
that the landfill per-capita endpoints read.

Availability rules: a request for a reference year that is not in the database
returns a structured 404 (never an empty 200 and never substitute data); an
unknown ``region_code`` filter returns a structured 404; a legitimately empty
filtered result within an available year returns 200 with ``count: 0``. Rows
missing provenance or, on the boundary endpoint, geometry raise a visible 500
instead of being served incomplete.
"""

import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from ...db import get_session
from ...models import Region, RegionalPopulation, RegionalWasteStatistics, WasteTreatmentFacility
from ...models.metadata import GRANULARITY_ANNUAL
from ...schemas import (
    DatasetEnvelope,
    FacilityOut,
    PopulationOut,
    RegionBoundaryCollection,
    RegionBoundaryFeature,
    RegionBoundaryProperties,
    RegionOut,
    UnavailableDataError,
    WasteStatisticsOut,
)

router = APIRouter(prefix="/api/v1", tags=["datasets"])

SessionDep = Annotated[Session, Depends(get_session)]
YearParam = Annotated[
    int | None,
    Query(ge=1990, le=2100, description="Reference year; defaults to the latest available."),
]

RegionLevel = Literal["SIDO", "SIGUNGU"]
WasteStream = Literal["HOUSEHOLD", "BUSINESS_NON_FACILITY", "INDUSTRIAL_FACILITY", "CONSTRUCTION"]
FacilityCategory = Literal[
    "PUBLIC_INCINERATION",
    "PUBLIC_OTHER",
    "PUBLIC_LANDFILL",
    "PRIVATE_INTERMEDIATE_INCINERATION",
    "PRIVATE_FINAL_DISPOSAL",
    "PRIVATE_RECYCLING",
]
Ownership = Literal["PUBLIC", "PRIVATE"]

# The vintage year of a region row (regions are versioned by validity dates;
# ingestion sets valid_from to January 1 of the boundary reference year).
_REGION_VINTAGE: ColumnElement[Any] = func.extract("year", Region.valid_from)

# This endpoint's series: the annual SGIS SIGUNGU population, which is the only
# series drawn on the SIGUNGU boundaries served by /regions/boundaries.
_POPULATION_SOURCE_ID = "sgis"
_POPULATION_GEOGRAPHIC_LEVEL = "SIGUNGU"


def _not_found(error: UnavailableDataError) -> HTTPException:
    return HTTPException(status_code=404, detail=error.model_dump())


def _available_years(
    session: Session,
    year_expression: ColumnElement[Any] | InstrumentedAttribute[int],
    *scope: ColumnElement[bool],
) -> list[int]:
    rows = session.scalars(
        select(year_expression).where(*scope).distinct().order_by(year_expression)
    ).all()
    return [int(row) for row in rows]


def _population_scope() -> tuple[ColumnElement[bool], ...]:
    """Restrict `regional_population` to the series this endpoint serves.

    The table also holds the MOIS monthly SIDO series (the landfill per-capita
    denominator), which runs several years ahead of SGIS. Without this scope the
    latest available year resolves to a MOIS year and the endpoint answers with
    SIDO rows whose codes match no SIGUNGU boundary on the map. Year resolution
    and the row query must apply it identically or they disagree.
    """
    return (
        RegionalPopulation.population_temporal_granularity == GRANULARITY_ANNUAL,
        RegionalPopulation.source_id == _POPULATION_SOURCE_ID,
        RegionalPopulation.source_geographic_level == _POPULATION_GEOGRAPHIC_LEVEL,
    )


def _resolve_reference_year(
    available_years: list[int], requested_year: int | None, dataset_name: str
) -> int:
    if not available_years:
        raise _not_found(
            UnavailableDataError(
                error="NO_DATA_AVAILABLE",
                detail=f"No {dataset_name} data has been ingested.",
                requested_year=requested_year,
            )
        )
    if requested_year is None:
        return available_years[-1]
    if requested_year not in available_years:
        raise _not_found(
            UnavailableDataError(
                error="NO_DATA_FOR_PERIOD",
                detail=f"No {dataset_name} data for reference year {requested_year}.",
                requested_year=requested_year,
                available_years=available_years,
            )
        )
    return requested_year


def _require_known_region_code(session: Session, region_code: str) -> None:
    known = session.scalar(select(Region.id).where(Region.region_code == region_code).limit(1))
    if known is None:
        raise _not_found(
            UnavailableDataError(
                error="REGION_NOT_FOUND",
                detail=f"Unknown region_code {region_code!r}.",
            )
        )


def _require_provenance(value: str | None, region_code: str, field_name: str) -> str:
    # Serving an unsourced row would violate the data-integrity rules; fail
    # visibly instead.
    if value is None:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "MISSING_PROVENANCE",
                "detail": f"Region {region_code} has no {field_name}; refusing to serve it.",
            },
        )
    return value


@router.get("/regions", response_model=DatasetEnvelope[RegionOut])
def list_regions(
    session: SessionDep,
    year: YearParam = None,
    level: RegionLevel | None = None,
) -> DatasetEnvelope[RegionOut]:
    resolved_year = _resolve_reference_year(
        _available_years(session, _REGION_VINTAGE), year, "region boundary"
    )
    query = select(Region).where(_REGION_VINTAGE == resolved_year).order_by(Region.region_code)
    if level is not None:
        query = query.where(Region.region_level == level)
    regions = session.scalars(query).all()
    items = [
        RegionOut(
            region_code=region.region_code,
            region_name=region.region_name,
            region_level=region.region_level,
            parent_region_code=region.parent_region_code,
            source_id=_require_provenance(region.source_id, region.region_code, "source_id"),
            boundary_reference_period=_require_provenance(
                region.boundary_reference_period, region.region_code, "boundary_reference_period"
            ),
            valid_from=region.valid_from,
            valid_to=region.valid_to,
        )
        for region in regions
    ]
    return DatasetEnvelope(reference_year=resolved_year, count=len(items), items=items)


@router.get("/regions/boundaries", response_model=RegionBoundaryCollection)
def region_boundaries(
    session: SessionDep,
    year: YearParam = None,
    level: RegionLevel = "SIGUNGU",
) -> RegionBoundaryCollection:
    resolved_year = _resolve_reference_year(
        _available_years(session, _REGION_VINTAGE), year, "region boundary"
    )
    rows = session.execute(
        select(Region, func.ST_AsGeoJSON(Region.geometry))
        .where(_REGION_VINTAGE == resolved_year, Region.region_level == level)
        .order_by(Region.region_code)
    ).all()
    features: list[RegionBoundaryFeature] = []
    for region, geojson in rows:
        if geojson is None:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "MISSING_GEOMETRY",
                    "detail": (
                        f"Region {region.region_code} has no stored boundary; "
                        "refusing to serve an incomplete collection."
                    ),
                },
            )
        features.append(
            RegionBoundaryFeature(
                geometry=json.loads(geojson),
                properties=RegionBoundaryProperties(
                    region_code=region.region_code,
                    region_name=region.region_name,
                    region_level=region.region_level,
                    parent_region_code=region.parent_region_code,
                    source_id=_require_provenance(
                        region.source_id, region.region_code, "source_id"
                    ),
                    boundary_reference_period=_require_provenance(
                        region.boundary_reference_period,
                        region.region_code,
                        "boundary_reference_period",
                    ),
                ),
            )
        )
    return RegionBoundaryCollection(
        reference_year=resolved_year, count=len(features), features=features
    )


@router.get("/population", response_model=DatasetEnvelope[PopulationOut])
def list_population(
    session: SessionDep,
    year: YearParam = None,
    region_code: str | None = None,
) -> DatasetEnvelope[PopulationOut]:
    scope = _population_scope()
    resolved_year = _resolve_reference_year(
        _available_years(session, RegionalPopulation.reference_year, *scope),
        year,
        "regional population",
    )
    if region_code is not None:
        _require_known_region_code(session, region_code)
    query = (
        select(RegionalPopulation, Region)
        .join(Region, RegionalPopulation.region_id == Region.id)
        .where(RegionalPopulation.reference_year == resolved_year, *scope)
        .order_by(Region.region_code)
    )
    if region_code is not None:
        query = query.where(Region.region_code == region_code)
    rows = session.execute(query).all()
    items = [
        PopulationOut(
            region_code=region.region_code,
            region_name=region.region_name,
            region_level=region.region_level,
            population=population.population,
            unit=population.unit,
            population_definition=population.population_definition,
            source_id=population.source_id,
            reference_year=population.reference_year,
            reference_period=population.reference_period,
        )
        for population, region in rows
    ]
    return DatasetEnvelope(reference_year=resolved_year, count=len(items), items=items)


@router.get("/waste-statistics", response_model=DatasetEnvelope[WasteStatisticsOut])
def list_waste_statistics(
    session: SessionDep,
    year: YearParam = None,
    waste_stream: WasteStream | None = None,
    region_code: str | None = None,
) -> DatasetEnvelope[WasteStatisticsOut]:
    resolved_year = _resolve_reference_year(
        _available_years(session, RegionalWasteStatistics.reference_year),
        year,
        "regional waste statistics",
    )
    if region_code is not None:
        _require_known_region_code(session, region_code)
    query = (
        select(RegionalWasteStatistics, Region)
        .join(Region, RegionalWasteStatistics.region_id == Region.id)
        .where(RegionalWasteStatistics.reference_year == resolved_year)
        .order_by(Region.region_code, RegionalWasteStatistics.source_pid)
    )
    if waste_stream is not None:
        query = query.where(RegionalWasteStatistics.waste_stream == waste_stream)
    if region_code is not None:
        query = query.where(Region.region_code == region_code)
    rows = session.execute(query).all()
    items = [
        WasteStatisticsOut(
            region_code=region.region_code,
            region_name=region.region_name,
            waste_stream=statistics.waste_stream,
            waste_category_name=statistics.waste_category_name,
            generation_quantity=statistics.generation_quantity,
            recycling_quantity=statistics.recycling_quantity,
            incineration_quantity=statistics.incineration_quantity,
            landfill_quantity=statistics.landfill_quantity,
            other_treatment_quantity=statistics.other_treatment_quantity,
            total_treatment_quantity=statistics.total_treatment_quantity,
            total_treatment_is_derived=statistics.total_treatment_is_derived,
            quantity_unit=statistics.quantity_unit,
            accounting_basis=statistics.accounting_basis,
            source_id=statistics.source_id,
            source_pid=statistics.source_pid,
            official_dataset_name=statistics.official_dataset_name,
            reference_year=statistics.reference_year,
            reference_period=statistics.reference_period,
        )
        for statistics, region in rows
    ]
    return DatasetEnvelope(reference_year=resolved_year, count=len(items), items=items)


@router.get("/facilities", response_model=DatasetEnvelope[FacilityOut])
def list_facilities(
    session: SessionDep,
    year: YearParam = None,
    facility_category: FacilityCategory | None = None,
    ownership: Ownership | None = None,
    region_code: str | None = None,
    has_coordinates: bool | None = None,
) -> DatasetEnvelope[FacilityOut]:
    resolved_year = _resolve_reference_year(
        _available_years(session, WasteTreatmentFacility.reference_year),
        year,
        "waste-treatment facility",
    )
    if region_code is not None:
        _require_known_region_code(session, region_code)
    query = (
        select(
            WasteTreatmentFacility,
            Region,
            func.ST_X(WasteTreatmentFacility.geometry),
            func.ST_Y(WasteTreatmentFacility.geometry),
        )
        .outerjoin(Region, WasteTreatmentFacility.region_id == Region.id)
        .where(WasteTreatmentFacility.reference_year == resolved_year)
        .order_by(WasteTreatmentFacility.source_pid, WasteTreatmentFacility.source_row_index)
    )
    if facility_category is not None:
        query = query.where(WasteTreatmentFacility.facility_category == facility_category)
    if ownership is not None:
        query = query.where(WasteTreatmentFacility.ownership == ownership)
    if region_code is not None:
        query = query.where(Region.region_code == region_code)
    if has_coordinates is True:
        query = query.where(WasteTreatmentFacility.geometry.is_not(None))
    elif has_coordinates is False:
        query = query.where(WasteTreatmentFacility.geometry.is_(None))
    rows = session.execute(query).all()
    items = [
        FacilityOut(
            id=facility.id,
            facility_name=facility.facility_name,
            operator_name=facility.operator_name,
            address=facility.address,
            facility_category=facility.facility_category,
            facility_kind=facility.facility_kind,
            ownership=facility.ownership,
            region_code=region.region_code if region is not None else None,
            region_name=region.region_name if region is not None else None,
            region_mapping_status=facility.region_mapping_status,
            rcis_sido_name=facility.rcis_sido_name,
            rcis_sigungu_name=facility.rcis_sigungu_name,
            longitude=longitude,
            latitude=latitude,
            geocode_status=facility.geocode_status,
            capacity_quantity=facility.capacity_quantity,
            capacity_unit=facility.capacity_unit,
            throughput_quantity=facility.throughput_quantity,
            throughput_unit=facility.throughput_unit,
            remaining_fill_capacity_m3=facility.remaining_fill_capacity_m3,
            accounting_basis=facility.accounting_basis,
            source_id=facility.source_id,
            source_pid=facility.source_pid,
            official_dataset_name=facility.official_dataset_name,
            reference_year=facility.reference_year,
            reference_period=facility.reference_period,
        )
        for facility, region, longitude, latitude in rows
    ]
    return DatasetEnvelope(reference_year=resolved_year, count=len(items), items=items)
