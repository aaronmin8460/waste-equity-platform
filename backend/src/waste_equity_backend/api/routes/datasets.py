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
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from ...db import get_session
from ...models import Region, RegionalPopulation, RegionalWasteStatistics, WasteTreatmentFacility
from ...models.metadata import GRANULARITY_ANNUAL
from ...schemas import (
    CategoryBreakdownRow,
    DatasetEnvelope,
    FacilityMappingTransparencyOut,
    FacilityOut,
    OwnershipBreakdownRow,
    PaginatedUnmapped,
    PopulationOut,
    RegionBoundaryCollection,
    RegionBoundaryFeature,
    RegionBoundaryProperties,
    RegionMappingBreakdownRow,
    RegionOut,
    SourceBreakdownRow,
    UnavailableDataError,
    UnmappedFacilityRow,
    WasteStatisticsOut,
)

router = APIRouter(prefix="/api/v1", tags=["datasets"])

SessionDep = Annotated[Session, Depends(get_session)]
YearParam = Annotated[
    int | None,
    Query(ge=1990, le=2100, description="Reference year; defaults to the latest available."),
]
PageParam = Annotated[int, Query(ge=1, description="1-based page of the unmapped-facility list.")]
PageSizeParam = Annotated[
    int, Query(ge=1, le=100, description="Unmapped-facility page size (max 100).")
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

# A missing map location means the official address could not be geocoded; it is
# never a claim that the facility does not exist and never a zero.
_MAPPING_TRANSPARENCY_DISCLAIMER = (
    "지도 위치가 없는 시설은 공식 주소를 좌표로 변환(지오코딩)하지 못한 경우이며, "
    "해당 시설이 존재하지 않거나 처리량이 0임을 의미하지 않습니다."
)


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


def _missing_location_reason(geocode_note: str | None) -> str | None:
    """The operator-recorded geocode annotation, or None when none was recorded.

    Only the curated ``geocode_note`` is ever surfaced, and only when it holds a
    non-empty value; a NULL or blank note collapses to None so the UI renders its
    "실패 사유 기록 없음" placeholder. No raw geocoder or database diagnostics,
    secrets, or filesystem paths are exposed.
    """
    if geocode_note is None:
        return None
    stripped = geocode_note.strip()
    return stripped or None


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


@router.get(
    "/facilities/mapping-transparency",
    response_model=FacilityMappingTransparencyOut,
)
def facility_mapping_transparency(
    session: SessionDep,
    year: YearParam = None,
    page: PageParam = 1,
    page_size: PageSizeParam = 25,
) -> FacilityMappingTransparencyOut:
    """Report facility map-location coverage for the citizen transparency page.

    Distinct path from ``/facilities`` (no path parameter, so the two never
    collide). Breakdown counts come from GROUP BY aggregates; the un-mapped list
    is bounded with LIMIT/OFFSET. A NULL geometry is reported as "without map
    location", never as zero, and the only geocode diagnostic surfaced is the
    curated ``geocode_note``.
    """
    resolved_year = _resolve_reference_year(
        _available_years(session, WasteTreatmentFacility.reference_year),
        year,
        "waste-treatment facility",
    )
    in_year = WasteTreatmentFacility.reference_year == resolved_year

    totals = session.execute(
        select(
            func.count(),
            func.count().filter(WasteTreatmentFacility.geometry.is_not(None)),
            func.count().filter(WasteTreatmentFacility.geometry.is_(None)),
            func.count().filter(
                or_(
                    WasteTreatmentFacility.address.is_(None),
                    func.trim(WasteTreatmentFacility.address) == "",
                )
            ),
        ).where(in_year)
    ).one()
    total = int(totals[0])
    with_map_location = int(totals[1])
    without_map_location = int(totals[2])
    without_address = int(totals[3])

    # reference_period comes from a representative row; the non-optional response
    # field rejects any row missing it (a visible failure) rather than serving it
    # unsourced. Year resolution guarantees at least one row exists.
    representative = session.scalars(
        select(WasteTreatmentFacility)
        .where(in_year)
        .order_by(WasteTreatmentFacility.source_pid, WasteTreatmentFacility.source_row_index)
        .limit(1)
    ).first()
    if representative is None:  # defensive: unreachable once a year is resolved
        raise _not_found(
            UnavailableDataError(
                error="NO_DATA_AVAILABLE",
                detail="No waste-treatment facility data has been ingested.",
                requested_year=year,
            )
        )

    category_rows = session.execute(
        select(
            WasteTreatmentFacility.facility_category,
            func.count(),
            func.count().filter(WasteTreatmentFacility.geometry.is_not(None)),
            func.count().filter(WasteTreatmentFacility.geometry.is_(None)),
        )
        .where(in_year)
        .group_by(WasteTreatmentFacility.facility_category)
        .order_by(WasteTreatmentFacility.facility_category)
    ).all()
    category_breakdown = [
        CategoryBreakdownRow(
            category=row[0],
            total=int(row[1]),
            with_map_location=int(row[2]),
            without_map_location=int(row[3]),
        )
        for row in category_rows
    ]

    ownership_rows = session.execute(
        select(WasteTreatmentFacility.ownership, func.count())
        .where(in_year)
        .group_by(WasteTreatmentFacility.ownership)
        .order_by(WasteTreatmentFacility.ownership)
    ).all()
    ownership_breakdown = [
        OwnershipBreakdownRow(ownership=row[0], total=int(row[1])) for row in ownership_rows
    ]

    region_mapping_rows = session.execute(
        select(WasteTreatmentFacility.region_mapping_status, func.count())
        .where(in_year)
        .group_by(WasteTreatmentFacility.region_mapping_status)
        .order_by(WasteTreatmentFacility.region_mapping_status)
    ).all()
    region_mapping_breakdown = [
        RegionMappingBreakdownRow(region_mapping_status=row[0], total=int(row[1]))
        for row in region_mapping_rows
    ]

    source_rows = session.execute(
        select(
            WasteTreatmentFacility.source_id,
            WasteTreatmentFacility.official_dataset_name,
            func.count(),
        )
        .where(in_year)
        .group_by(
            WasteTreatmentFacility.source_id,
            WasteTreatmentFacility.official_dataset_name,
        )
        .order_by(
            WasteTreatmentFacility.source_id,
            WasteTreatmentFacility.official_dataset_name,
        )
    ).all()
    source_breakdown = [
        SourceBreakdownRow(source_id=row[0], official_dataset_name=row[1], total=int(row[2]))
        for row in source_rows
    ]

    offset = (page - 1) * page_size
    unmapped_rows = session.execute(
        select(WasteTreatmentFacility, Region)
        .outerjoin(Region, WasteTreatmentFacility.region_id == Region.id)
        .where(in_year, WasteTreatmentFacility.geometry.is_(None))
        .order_by(WasteTreatmentFacility.source_pid, WasteTreatmentFacility.id)
        .limit(page_size)
        .offset(offset)
    ).all()
    unmapped_items = [
        UnmappedFacilityRow(
            id=facility.id,
            facility_name=facility.facility_name,
            facility_category=facility.facility_category,
            ownership=facility.ownership,
            rcis_sido_name=facility.rcis_sido_name,
            rcis_sigungu_name=facility.rcis_sigungu_name,
            region_code=region.region_code if region is not None else None,
            region_name=region.region_name if region is not None else None,
            region_mapping_status=facility.region_mapping_status,
            geocode_status=facility.geocode_status,
            missing_location_reason=_missing_location_reason(facility.geocode_note),
        )
        for facility, region in unmapped_rows
    ]

    return FacilityMappingTransparencyOut(
        reference_year=resolved_year,
        reference_period=representative.reference_period,
        total=total,
        with_map_location=with_map_location,
        without_map_location=without_map_location,
        without_address=without_address,
        category_breakdown=category_breakdown,
        ownership_breakdown=ownership_breakdown,
        region_mapping_breakdown=region_mapping_breakdown,
        source_breakdown=source_breakdown,
        unmapped=PaginatedUnmapped(
            page=page,
            page_size=page_size,
            total=without_map_location,
            items=unmapped_items,
        ),
        disclaimer=_MAPPING_TRANSPARENCY_DISCLAIMER,
    )
