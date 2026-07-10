"""Derived equity-indicator endpoints (Phase 5.1).

Serves per-capita waste generation computed on read from the normalized Phase
2 tables. Handlers never call government APIs, never read credentials, and
never merge the two accounting bases: the numerator is origin-based RCIS
generation only.

Availability rules extend the Phase 3 conventions: a reference year is
available only when BOTH the waste statistics and the population dataset have
rows for it (the served ``available_years`` is that intersection). Region and
stream pairs that cannot be derived honestly — missing or ambiguous population
denominator, zero population, unexpected source unit — are excluded from
``items`` and reported in ``excluded_regions`` with a reason, never
zero-filled.
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from geoalchemy2 import Geography
from sqlalchemy import cast, func, select

from ...analysis import (
    BURDEN_DERIVATION_FORMULA,
    BURDEN_DERIVATION_VERSION,
    DERIVATION_FORMULA,
    DERIVATION_VERSION,
    PER_CAPITA_UNIT,
    FacilityThroughput,
    UnexpectedQuantityUnitError,
    ZeroPopulationError,
    aggregate_throughput,
    per_capita_kg_per_year,
)
from ...analysis.per_capita import EXPECTED_QUANTITY_UNIT
from ...models import (
    Region,
    RegionalPopulation,
    RegionalWasteStatistics,
    WasteTreatmentFacility,
)
from ...schemas import (
    EquityEnvelope,
    ExcludedBurdenRegion,
    ExcludedRegion,
    FacilityBurdenEnvelope,
    FacilityBurdenOut,
    WastePerCapitaOut,
)
from .datasets import (
    _REGION_VINTAGE,
    SessionDep,
    WasteStream,
    YearParam,
    _available_years,
    _require_known_region_code,
    _resolve_reference_year,
)

router = APIRouter(prefix="/api/v1/equity", tags=["equity"])

INDICATOR_NAME = "PER_CAPITA_WASTE_GENERATION"

# Served with every response so displayed values carry their caveats.
# Korean-first with an English gloss, matching the platform UI convention.
ASSUMPTIONS = [
    "분모는 지역의 SGIS 총인구입니다(항목별 population_definition 참조). "
    "서비스 인구나 가구 수가 아닙니다. "
    "(Denominator is the SGIS total population of the region, "
    "not a service population or household count.)",
    "분자는 발생지 기준 발생량(ORIGIN_BASED_TREATMENT_OUTCOME)이며, 이 지표는 "
    "주민 부담의 근사치이지 시설 처리량이 아닙니다. "
    "(Numerator is origin-based generation; the indicator is a residential "
    "burden proxy, not facility throughput.)",
    "기준 연도에 두 데이터셋 중 하나라도 없는 지역·폐기물군 조합은 제외하고 "
    "excluded_regions에 보고하며, 0으로 대체하거나 추정하지 않습니다. "
    "(Region/stream pairs missing either dataset are excluded and reported, "
    "never zero-filled or estimated.)",
    "사업장 배출시설계(INDUSTRIAL_FACILITY)·건설(CONSTRUCTION) 폐기물은 지역 내 "
    "사업장과 현장 활동으로 발생하므로 주민 1인당 값 해석에 주의가 필요합니다. "
    "(Workplace-driven generation divided by resident population must be "
    "interpreted with caution.)",
]

WasteStreamParam = Annotated[
    WasteStream | None,
    Query(description="Optional single waste stream; defaults to all streams."),
]


@router.get("/waste-per-capita", response_model=EquityEnvelope)
def waste_per_capita(
    session: SessionDep,
    year: YearParam = None,
    waste_stream: WasteStreamParam = None,
    region_code: str | None = None,
) -> EquityEnvelope:
    waste_years = _available_years(session, RegionalWasteStatistics.reference_year)
    population_years = _available_years(session, RegionalPopulation.reference_year)
    shared_years = sorted(set(waste_years) & set(population_years))
    resolved_year = _resolve_reference_year(
        shared_years, year, "per-capita waste generation (waste statistics and population)"
    )
    if region_code is not None:
        _require_known_region_code(session, region_code)

    population_rows = session.scalars(
        select(RegionalPopulation).where(RegionalPopulation.reference_year == resolved_year)
    ).all()
    populations: dict[int, list[RegionalPopulation]] = {}
    for row in population_rows:
        populations.setdefault(row.region_id, []).append(row)

    query = (
        select(RegionalWasteStatistics, Region)
        .join(Region, RegionalWasteStatistics.region_id == Region.id)
        .where(RegionalWasteStatistics.reference_year == resolved_year)
        .order_by(Region.region_code, RegionalWasteStatistics.waste_stream)
    )
    if waste_stream is not None:
        query = query.where(RegionalWasteStatistics.waste_stream == waste_stream)
    if region_code is not None:
        query = query.where(Region.region_code == region_code)

    items: list[WastePerCapitaOut] = []
    excluded: list[ExcludedRegion] = []
    for statistics, region in session.execute(query).all():
        candidates = populations.get(statistics.region_id, [])
        if not candidates:
            excluded.append(_excluded(region, statistics.waste_stream, "NO_POPULATION_DENOMINATOR"))
            continue
        if len(candidates) > 1:
            # More than one population row (definition/source variants) makes
            # the denominator ambiguous; refusing beats silently picking one.
            excluded.append(
                _excluded(region, statistics.waste_stream, "AMBIGUOUS_POPULATION_DEFINITION")
            )
            continue
        population = candidates[0]
        try:
            per_capita = per_capita_kg_per_year(
                statistics.generation_quantity, statistics.quantity_unit, population.population
            )
        except ZeroPopulationError:
            excluded.append(_excluded(region, statistics.waste_stream, "ZERO_POPULATION"))
            continue
        except UnexpectedQuantityUnitError:
            excluded.append(_excluded(region, statistics.waste_stream, "UNEXPECTED_QUANTITY_UNIT"))
            continue
        items.append(
            WastePerCapitaOut(
                region_code=region.region_code,
                region_name=region.region_name,
                region_level=region.region_level,
                waste_stream=statistics.waste_stream,
                per_capita_kg_per_year=per_capita,
                per_capita_unit=PER_CAPITA_UNIT,
                generation_quantity=statistics.generation_quantity,
                quantity_unit=statistics.quantity_unit,
                accounting_basis=statistics.accounting_basis,
                waste_source_id=statistics.source_id,
                waste_source_pid=statistics.source_pid,
                waste_official_dataset_name=statistics.official_dataset_name,
                waste_reference_period=statistics.reference_period,
                population=population.population,
                population_definition=population.population_definition,
                population_source_id=population.source_id,
                population_reference_period=population.reference_period,
                reference_year=resolved_year,
            )
        )

    return EquityEnvelope(
        indicator=INDICATOR_NAME,
        derivation_version=DERIVATION_VERSION,
        derivation_formula=DERIVATION_FORMULA,
        unit=PER_CAPITA_UNIT,
        assumptions=ASSUMPTIONS,
        reference_year=resolved_year,
        count=len(items),
        items=items,
        excluded_regions=excluded,
    )


def _excluded(region: Region, waste_stream: str, reason: str) -> ExcludedRegion:
    return ExcludedRegion(
        region_code=region.region_code,
        region_name=region.region_name,
        waste_stream=waste_stream,
        reason=reason,
    )


BURDEN_INDICATOR_NAME = "FACILITY_BURDEN"
# Geodesic buffer distance around the region boundary. ST_DWithin over
# geography measures meters on the spheroid, so facilities inside the region
# (distance zero) are always included.
BUFFER_METERS = 5000
# Conservative bounding-box prefilter so the join can use the GiST geometry
# indexes before the exact (index-blind) geography check. Must be at least
# BUFFER_METERS in degrees at the highest latitude served: one degree of
# longitude is ≥ 81 km up to 43°N, so 0.07° ≥ 5.7 km everywhere the platform
# operates. A too-large margin only costs speed, never correctness — the
# geography ST_DWithin still decides membership.
BUFFER_BBOX_MARGIN_DEGREES = 0.07

BURDEN_ASSUMPTIONS = [
    "처리량은 시설 소재지 기준(FACILITY_LOCATION_BASED_THROUGHPUT)이며 발생지 "
    "기준 통계와 합산하거나 비교할 수 없습니다. "
    "(Facility-location-based throughput; never merged with origin-based "
    "statistics.)",
    "'소재(located)'는 정식 지역 매핑(region_id) 기준이라 좌표가 없는 시설도 "
    "포함하고, '인근(within buffer)'은 좌표 보유 시설만 경계로부터 5,000 m "
    "측지 거리(ST_DWithin, EPSG:4326 geography)로 판정합니다. "
    "(Located = canonical region assignment, includes facilities without "
    "coordinates; buffer = geodesic distance from the region boundary, "
    "geocoded facilities only.)",
    "처리량이 없거나 단위가 다른 시설은 합계에서 제외하고 개수로 보고하며 "
    "(throughput_is_partial), 값을 추정하지 않습니다. "
    "(Unusable throughput rows are counted, flagged partial, never "
    "estimated.)",
    "분모는 SGIS 총인구입니다(Phase 5.1과 동일). 인구가 없거나 0인 지역은 "
    "제외하고 보고합니다. "
    "(Denominator is the SGIS total population; missing or zero denominators "
    "are excluded and reported.)",
    "시설이 0개인 지역의 0 값은 실제 관측된 부재이며 대체값이 아닙니다. "
    "(Zeros for facility-free regions are real observed absences, not "
    "fill.)",
]


def _single_value(values: set[str], field_name: str) -> str:
    # Aggregates may only be served when every underlying row agrees on the
    # provenance field; mixed values would silently mislabel the aggregate.
    if len(values) != 1:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "MIXED_PROVENANCE",
                "detail": (
                    f"Facility rows disagree on {field_name} ({sorted(values)!r}); "
                    "refusing to serve a mislabeled aggregate."
                ),
            },
        )
    return values.pop()


def _require_wgs84(region: Region) -> None:
    # Distance is measured on EPSG:4326 geography; a region stored in any
    # other CRS would silently corrupt the buffer measure.
    if region.boundary_target_crs != "EPSG:4326":
        raise HTTPException(
            status_code=500,
            detail={
                "error": "CRS_MISMATCH",
                "detail": (
                    f"Region {region.region_code} boundary CRS is "
                    f"{region.boundary_target_crs!r}, not 'EPSG:4326'; refusing to "
                    "measure distance against it."
                ),
            },
        )


@router.get("/facility-burden", response_model=FacilityBurdenEnvelope)
def facility_burden(
    session: SessionDep,
    year: YearParam = None,
    region_code: str | None = None,
) -> FacilityBurdenEnvelope:
    facility_years = _available_years(session, WasteTreatmentFacility.reference_year)
    population_years = _available_years(session, RegionalPopulation.reference_year)
    shared_years = sorted(set(facility_years) & set(population_years))
    resolved_year = _resolve_reference_year(
        shared_years, year, "facility burden (facilities and population)"
    )
    if region_code is not None:
        _require_known_region_code(session, region_code)

    facilities = session.scalars(
        select(WasteTreatmentFacility).where(WasteTreatmentFacility.reference_year == resolved_year)
    ).all()
    # Dataset-level provenance: every facility row of the year must agree.
    facility_source_id = _single_value({f.source_id for f in facilities}, "source_id")
    facility_reference_period = _single_value(
        {f.reference_period for f in facilities}, "reference_period"
    )
    accounting_basis = _single_value({f.accounting_basis for f in facilities}, "accounting_basis")
    facilities_without_coordinates = 0
    facilities_without_region = 0
    located: dict[int, list[FacilityThroughput]] = {}
    throughput_by_id: dict[int, FacilityThroughput] = {}
    for facility in facilities:
        record = FacilityThroughput(
            throughput_quantity=facility.throughput_quantity,
            throughput_unit=facility.throughput_unit,
        )
        throughput_by_id[facility.id] = record
        if facility.region_id is None:
            facilities_without_region += 1
        else:
            located.setdefault(facility.region_id, []).append(record)
        if facility.geometry is None:
            facilities_without_coordinates += 1

    # Geodesic buffer membership (spatial join); only geocoded facilities can
    # participate. Region rows are validated to be EPSG:4326 before serving.
    # The && bbox prefilter runs on the GiST geometry indexes; the geography
    # ST_DWithin then decides exact membership on the spheroid.
    buffer_pairs = session.execute(
        select(Region.id, WasteTreatmentFacility.id)
        .select_from(Region)
        .join(
            WasteTreatmentFacility,
            Region.geometry.op("&&")(
                func.ST_Expand(WasteTreatmentFacility.geometry, BUFFER_BBOX_MARGIN_DEGREES)
            )
            & func.ST_DWithin(
                cast(Region.geometry, Geography(srid=4326)),
                cast(WasteTreatmentFacility.geometry, Geography(srid=4326)),
                BUFFER_METERS,
            ),
        )
        .where(
            _REGION_VINTAGE == resolved_year,
            Region.region_level == "SIGUNGU",
            WasteTreatmentFacility.reference_year == resolved_year,
            WasteTreatmentFacility.geometry.is_not(None),
        )
    ).all()
    within_buffer: dict[int, list[FacilityThroughput]] = {}
    for region_id, facility_id in buffer_pairs:
        within_buffer.setdefault(region_id, []).append(throughput_by_id[facility_id])

    population_rows = session.scalars(
        select(RegionalPopulation).where(RegionalPopulation.reference_year == resolved_year)
    ).all()
    populations: dict[int, list[RegionalPopulation]] = {}
    for row in population_rows:
        populations.setdefault(row.region_id, []).append(row)

    region_query = (
        select(Region)
        .where(_REGION_VINTAGE == resolved_year, Region.region_level == "SIGUNGU")
        .order_by(Region.region_code)
    )
    if region_code is not None:
        region_query = region_query.where(Region.region_code == region_code)
    regions = session.scalars(region_query).all()

    items: list[FacilityBurdenOut] = []
    excluded: list[ExcludedBurdenRegion] = []
    for region in regions:
        _require_wgs84(region)
        candidates = populations.get(region.id, [])
        if not candidates:
            excluded.append(_excluded_burden(region, "NO_POPULATION_DENOMINATOR"))
            continue
        if len(candidates) > 1:
            excluded.append(_excluded_burden(region, "AMBIGUOUS_POPULATION_DEFINITION"))
            continue
        population = candidates[0]
        located_aggregate = aggregate_throughput(located.get(region.id, []))
        buffer_aggregate = aggregate_throughput(within_buffer.get(region.id, []))
        try:
            located_per_capita = per_capita_kg_per_year(
                located_aggregate.total_tons_per_year,
                EXPECTED_QUANTITY_UNIT,
                population.population,
            )
            buffer_per_capita = per_capita_kg_per_year(
                buffer_aggregate.total_tons_per_year,
                EXPECTED_QUANTITY_UNIT,
                population.population,
            )
        except ZeroPopulationError:
            excluded.append(_excluded_burden(region, "ZERO_POPULATION"))
            continue
        items.append(
            FacilityBurdenOut(
                region_code=region.region_code,
                region_name=region.region_name,
                region_level=region.region_level,
                facility_count_located=located_aggregate.facility_count,
                throughput_located_tons_per_year=located_aggregate.total_tons_per_year,
                throughput_located_kg_per_capita=located_per_capita,
                located_missing_throughput_count=located_aggregate.missing_throughput_count,
                located_throughput_is_partial=located_aggregate.is_partial,
                facility_count_within_buffer=buffer_aggregate.facility_count,
                throughput_within_buffer_tons_per_year=buffer_aggregate.total_tons_per_year,
                throughput_within_buffer_kg_per_capita=buffer_per_capita,
                buffer_missing_throughput_count=buffer_aggregate.missing_throughput_count,
                buffer_throughput_is_partial=buffer_aggregate.is_partial,
                quantity_unit=EXPECTED_QUANTITY_UNIT,
                accounting_basis=accounting_basis,
                facility_source_id=facility_source_id,
                facility_reference_period=facility_reference_period,
                population=population.population,
                population_definition=population.population_definition,
                population_source_id=population.source_id,
                population_reference_period=population.reference_period,
                reference_year=resolved_year,
            )
        )

    return FacilityBurdenEnvelope(
        indicator=BURDEN_INDICATOR_NAME,
        derivation_version=BURDEN_DERIVATION_VERSION,
        derivation_formula=BURDEN_DERIVATION_FORMULA,
        buffer_meters=BUFFER_METERS,
        unit=PER_CAPITA_UNIT,
        assumptions=BURDEN_ASSUMPTIONS,
        reference_year=resolved_year,
        count=len(items),
        items=items,
        excluded_regions=excluded,
        facilities_without_coordinates=facilities_without_coordinates,
        facilities_without_region=facilities_without_region,
    )


def _excluded_burden(region: Region, reason: str) -> ExcludedBurdenRegion:
    return ExcludedBurdenRegion(
        region_code=region.region_code,
        region_name=region.region_name,
        reason=reason,
    )
