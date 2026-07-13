"""RCIS waste reporting-geography endpoints (source-compatible waste metrics).

The waste-generation and per-capita-waste maps must render on the geography RCIS
actually reports: native SGIS regions where RCIS reports directly, plus the seven
Gyeonggi cities RCIS reports at city level rendered once each as a DERIVED union
of their SGIS child boundaries. These endpoints never touch the native
``/regions/boundaries``, ``/waste-statistics``, or ``/equity/waste-per-capita``
contracts used by the population and facility-burden maps.

Invariants: a city-level quantity is never returned with a child district name or
code; native-versus-derived geometry and the child lineage are explicit; source
and reference period are mandatory; and a missing value carries a precise reason
(SOURCE_NOT_REPORTED, …) instead of a bare NO_DATA.
"""

import json
from typing import Annotated, Any

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from ...analysis import (
    DERIVATION_FORMULA,
    DERIVATION_VERSION,
    PER_CAPITA_UNIT,
    UnexpectedQuantityUnitError,
    ZeroPopulationError,
    per_capita_kg_per_year,
)
from ...models import (
    Region,
    RegionalPopulation,
    RegionalWasteStatistics,
    ReportingRegionWasteStatistics,
    WasteReportingRegion,
    WasteReportingRegionMember,
)
from ...schemas import (
    ReportingBoundaryCollection,
    ReportingBoundaryFeature,
    ReportingBoundaryProperties,
    ReportingExcludedRegion,
    ReportingPerCapitaEnvelope,
    ReportingPerCapitaOut,
    ReportingUnavailableRegion,
    ReportingWasteStatisticsEnvelope,
    ReportingWasteStatisticsOut,
)
from ...schemas.reporting import NATIVE_SGIS
from .datasets import (
    _REGION_VINTAGE,
    SessionDep,
    WasteStream,
    YearParam,
    _available_years,
    _require_provenance,
    _resolve_reference_year,
)

router = APIRouter(prefix="/api/v1/waste-reporting", tags=["waste-reporting"])

INDICATOR_NAME = "PER_CAPITA_WASTE_GENERATION_REPORTING"
NATIVE_GEOMETRY_KIND = "NATIVE"
DERIVED_GEOMETRY_KIND = "DERIVED"

WasteStreamParam = Annotated[
    WasteStream | None,
    Query(description="Optional single waste stream; defaults to all streams."),
]

PER_CAPITA_ASSUMPTIONS = [
    "분자는 발생지 기준 RCIS 발생량(ORIGIN_BASED_TREATMENT_OUTCOME)입니다. "
    "(Numerator is origin-based RCIS generation.)",
    "일곱 개 시(고양·부천·성남·수원·안산·안양·용인)는 RCIS가 시 단위로 보고하므로 "
    "시 단위 값을 그대로 사용하고, 분모는 해당 시의 SGIS 자치구 인구의 합입니다. "
    "(For the seven cities RCIS reports at city level, the numerator is the "
    "source-native city value and the denominator is the exact sum of the SGIS "
    "child-district populations — a derived city total.)",
    "구별 공식 폐기물 값은 제공되지 않으므로 구 단위 1인당 값은 생성하지 않습니다. "
    "(District-level official waste values are not provided, so no district-level "
    "per-capita value is derived from the city numerator.)",
    "인구가 없거나 자치구 인구가 불완전한 시는 제외하고 사유와 함께 보고합니다. "
    "(Regions with missing or incomplete child population are excluded and "
    "reported, never zero-filled.)",
]


def _reporting_years(session: SessionDep) -> list[int]:
    return _available_years(session, RegionalWasteStatistics.reference_year)


def _child_region_ids(session: SessionDep, year: int) -> set[int]:
    rows = session.execute(
        select(WasteReportingRegionMember.child_region_id)
        .join(
            WasteReportingRegion,
            WasteReportingRegionMember.reporting_region_id == WasteReportingRegion.id,
        )
        .where(func.extract("year", WasteReportingRegion.valid_from) == year)
    ).all()
    return {int(row[0]) for row in rows}


@router.get("/boundaries", response_model=ReportingBoundaryCollection)
def reporting_boundaries(
    session: SessionDep,
    year: YearParam = None,
) -> ReportingBoundaryCollection:
    resolved_year = _resolve_reference_year(
        _available_years(session, _REGION_VINTAGE), year, "waste reporting boundary"
    )
    child_ids = _child_region_ids(session, resolved_year)

    features: list[ReportingBoundaryFeature] = []

    # Native reporting regions: SGIS SIGUNGU regions RCIS reports directly (i.e.
    # every SIGUNGU that is not subsumed into a derived city).
    native_rows = session.execute(
        select(Region, func.ST_AsGeoJSON(Region.geometry))
        .where(_REGION_VINTAGE == resolved_year, Region.region_level == "SIGUNGU")
        .order_by(Region.region_code)
    ).all()
    for region, geojson in native_rows:
        if region.id in child_ids:
            continue
        if geojson is None:
            continue
        features.append(
            ReportingBoundaryFeature(
                geometry=json.loads(geojson),
                properties=ReportingBoundaryProperties(
                    reporting_region_code=region.region_code,
                    reporting_region_name=region.region_name,
                    reporting_geography_type=NATIVE_SGIS,
                    geometry_kind=NATIVE_GEOMETRY_KIND,
                    derived_geometry_method=None,
                    source_reporting_level=region.region_level,
                    native_region_code=region.region_code,
                    child_region_codes=None,
                    child_region_names=None,
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

    # Derived city reporting regions.
    members_by_region = _members_by_region(session, resolved_year)
    derived_rows = session.execute(
        select(WasteReportingRegion, func.ST_AsGeoJSON(WasteReportingRegion.geometry))
        .where(func.extract("year", WasteReportingRegion.valid_from) == resolved_year)
        .order_by(WasteReportingRegion.reporting_region_code)
    ).all()
    for region, geojson in derived_rows:
        codes, names = members_by_region.get(region.id, ([], []))
        features.append(
            ReportingBoundaryFeature(
                geometry=json.loads(geojson),
                properties=ReportingBoundaryProperties(
                    reporting_region_code=region.reporting_region_code,
                    reporting_region_name=region.reporting_region_name,
                    reporting_geography_type=region.reporting_geography_type,
                    geometry_kind=region.geometry_kind,
                    derived_geometry_method=region.derived_geometry_method,
                    source_reporting_level=region.source_reporting_level,
                    native_region_code=None,
                    child_region_codes=codes,
                    child_region_names=names,
                    source_id=_require_provenance(
                        region.boundary_source_id, region.reporting_region_code, "source_id"
                    ),
                    boundary_reference_period=region.boundary_reference_period,
                ),
            )
        )

    features.sort(key=lambda f: f.properties.reporting_region_code)
    return ReportingBoundaryCollection(
        reference_year=resolved_year, count=len(features), features=features
    )


def _members_by_region(session: SessionDep, year: int) -> dict[int, tuple[list[str], list[str]]]:
    rows = session.execute(
        select(
            WasteReportingRegionMember.reporting_region_id,
            WasteReportingRegionMember.child_region_code,
            WasteReportingRegionMember.child_region_name,
        )
        .join(
            WasteReportingRegion,
            WasteReportingRegionMember.reporting_region_id == WasteReportingRegion.id,
        )
        .where(func.extract("year", WasteReportingRegion.valid_from) == year)
        .order_by(WasteReportingRegionMember.child_region_code)
    ).all()
    result: dict[int, tuple[list[str], list[str]]] = {}
    for region_id, code, name in rows:
        codes, names = result.setdefault(int(region_id), ([], []))
        codes.append(code)
        names.append(name)
    return result


@router.get("/statistics", response_model=ReportingWasteStatisticsEnvelope)
def reporting_statistics(
    session: SessionDep,
    year: YearParam = None,
    waste_stream: WasteStreamParam = None,
    region_code: str | None = None,
) -> ReportingWasteStatisticsEnvelope:
    resolved_year = _resolve_reference_year(
        _reporting_years(session), year, "waste reporting statistics"
    )
    child_ids = _child_region_ids(session, resolved_year)
    members_by_region = _members_by_region(session, resolved_year)

    items: list[ReportingWasteStatisticsOut] = []

    # Native reporting-region values.
    native_query = (
        select(RegionalWasteStatistics, Region)
        .join(Region, RegionalWasteStatistics.region_id == Region.id)
        .where(RegionalWasteStatistics.reference_year == resolved_year)
        .order_by(Region.region_code, RegionalWasteStatistics.source_pid)
    )
    if waste_stream is not None:
        native_query = native_query.where(RegionalWasteStatistics.waste_stream == waste_stream)
    if region_code is not None:
        native_query = native_query.where(Region.region_code == region_code)
    native_codes_present: dict[str, set[str]] = {}
    for stats, region in session.execute(native_query).all():
        if region.id in child_ids:
            continue
        native_codes_present.setdefault(region.region_code, set()).add(stats.waste_stream)
        items.append(
            ReportingWasteStatisticsOut(
                reporting_region_code=region.region_code,
                reporting_region_name=region.region_name,
                reporting_geography_type=NATIVE_SGIS,
                geometry_kind=NATIVE_GEOMETRY_KIND,
                source_reporting_level=region.region_level,
                waste_stream=stats.waste_stream,
                waste_category_name=stats.waste_category_name,
                generation_quantity=stats.generation_quantity,
                recycling_quantity=stats.recycling_quantity,
                incineration_quantity=stats.incineration_quantity,
                landfill_quantity=stats.landfill_quantity,
                other_treatment_quantity=stats.other_treatment_quantity,
                total_treatment_quantity=stats.total_treatment_quantity,
                total_treatment_is_derived=stats.total_treatment_is_derived,
                quantity_unit=stats.quantity_unit,
                accounting_basis=stats.accounting_basis,
                source_id=stats.source_id,
                source_pid=stats.source_pid,
                official_dataset_name=stats.official_dataset_name,
                reference_year=stats.reference_year,
                reference_period=stats.reference_period,
                child_region_codes=None,
            )
        )

    # Derived city values.
    derived_query = (
        select(ReportingRegionWasteStatistics, WasteReportingRegion)
        .join(
            WasteReportingRegion,
            ReportingRegionWasteStatistics.reporting_region_id == WasteReportingRegion.id,
        )
        .where(ReportingRegionWasteStatistics.reference_year == resolved_year)
        .order_by(
            WasteReportingRegion.reporting_region_code,
            ReportingRegionWasteStatistics.source_pid,
        )
    )
    if waste_stream is not None:
        derived_query = derived_query.where(
            ReportingRegionWasteStatistics.waste_stream == waste_stream
        )
    if region_code is not None:
        derived_query = derived_query.where(
            WasteReportingRegion.reporting_region_code == region_code
        )
    for stats, region in session.execute(derived_query).all():
        codes, _ = members_by_region.get(region.id, ([], []))
        items.append(
            ReportingWasteStatisticsOut(
                reporting_region_code=region.reporting_region_code,
                reporting_region_name=region.reporting_region_name,
                reporting_geography_type=region.reporting_geography_type,
                geometry_kind=region.geometry_kind,
                source_reporting_level=region.source_reporting_level,
                waste_stream=stats.waste_stream,
                waste_category_name=stats.waste_category_name,
                generation_quantity=stats.generation_quantity,
                recycling_quantity=stats.recycling_quantity,
                incineration_quantity=stats.incineration_quantity,
                landfill_quantity=stats.landfill_quantity,
                other_treatment_quantity=stats.other_treatment_quantity,
                total_treatment_quantity=stats.total_treatment_quantity,
                total_treatment_is_derived=stats.total_treatment_is_derived,
                quantity_unit=stats.quantity_unit,
                accounting_basis=stats.accounting_basis,
                source_id=stats.source_id,
                source_pid=stats.source_pid,
                official_dataset_name=stats.official_dataset_name,
                reference_year=stats.reference_year,
                reference_period=stats.reference_period,
                child_region_codes=codes,
            )
        )

    unavailable = _unavailable_regions(
        session, resolved_year, waste_stream, region_code, child_ids, native_codes_present
    )
    return ReportingWasteStatisticsEnvelope(
        reference_year=resolved_year,
        count=len(items),
        items=items,
        unavailable_regions=unavailable,
    )


def _unavailable_regions(
    session: SessionDep,
    year: int,
    waste_stream: str | None,
    region_code: str | None,
    child_ids: set[int],
    native_codes_present: dict[str, set[str]],
) -> list[ReportingUnavailableRegion]:
    """Native reporting regions missing a value for a stream = SOURCE_NOT_REPORTED.

    A native reporting region is a genuine RCIS reporting region (it appears in at
    least one PID); a stream with no row means the source did not report that
    region for that PID — a precise omission, not a bare no-data. Ingestion
    surfaces parser/blank rejects separately (rejected_rows), which are zero for
    the current data, so an absent native value is a source omission.
    """
    streams_present = [
        row[0]
        for row in session.execute(
            select(RegionalWasteStatistics.waste_stream)
            .where(RegionalWasteStatistics.reference_year == year)
            .distinct()
        ).all()
    ]
    target_streams = [waste_stream] if waste_stream is not None else sorted(streams_present)

    native_rows = session.execute(
        select(Region.id, Region.region_code, Region.region_name)
        .where(_REGION_VINTAGE == year, Region.region_level == "SIGUNGU")
        .order_by(Region.region_code)
    ).all()
    unavailable: list[ReportingUnavailableRegion] = []
    for region_id, code, name in native_rows:
        if int(region_id) in child_ids:
            continue
        if region_code is not None and code != region_code:
            continue
        present = native_codes_present.get(code, set())
        for stream in target_streams:
            if stream not in present:
                unavailable.append(
                    ReportingUnavailableRegion(
                        reporting_region_code=code,
                        reporting_region_name=name,
                        waste_stream=stream,
                        reason="SOURCE_NOT_REPORTED",
                    )
                )
    return unavailable


@router.get("/per-capita", response_model=ReportingPerCapitaEnvelope)
def reporting_per_capita(
    session: SessionDep,
    year: YearParam = None,
    waste_stream: WasteStreamParam = None,
    region_code: str | None = None,
) -> ReportingPerCapitaEnvelope:
    waste_years = _available_years(session, RegionalWasteStatistics.reference_year)
    population_years = _available_years(session, RegionalPopulation.reference_year)
    shared_years = sorted(set(waste_years) & set(population_years))
    resolved_year = _resolve_reference_year(
        shared_years, year, "per-capita waste reporting (waste statistics and population)"
    )
    child_ids = _child_region_ids(session, resolved_year)
    members_by_region = _members_by_region(session, resolved_year)

    # One population row per region_id for the year (definition/source variants
    # make the denominator ambiguous, handled per region below).
    population_rows = session.scalars(
        select(RegionalPopulation).where(RegionalPopulation.reference_year == resolved_year)
    ).all()
    populations: dict[int, list[RegionalPopulation]] = {}
    for row in population_rows:
        populations.setdefault(row.region_id, []).append(row)

    items: list[ReportingPerCapitaOut] = []
    excluded: list[ReportingExcludedRegion] = []

    # Native reporting regions.
    native_query = (
        select(RegionalWasteStatistics, Region)
        .join(Region, RegionalWasteStatistics.region_id == Region.id)
        .where(RegionalWasteStatistics.reference_year == resolved_year)
        .order_by(Region.region_code, RegionalWasteStatistics.waste_stream)
    )
    if waste_stream is not None:
        native_query = native_query.where(RegionalWasteStatistics.waste_stream == waste_stream)
    if region_code is not None:
        native_query = native_query.where(Region.region_code == region_code)
    for stats, region in session.execute(native_query).all():
        if region.id in child_ids:
            continue
        candidates = populations.get(region.id, [])
        excluded_reason = _population_issue(candidates)
        if excluded_reason is not None:
            excluded.append(
                _excluded(
                    region.region_code, region.region_name, stats.waste_stream, excluded_reason
                )
            )
            continue
        population = candidates[0]
        derived = _per_capita_or_reason(
            stats.generation_quantity, stats.quantity_unit, population.population
        )
        if isinstance(derived, str):
            excluded.append(
                _excluded(region.region_code, region.region_name, stats.waste_stream, derived)
            )
            continue
        items.append(
            ReportingPerCapitaOut(
                reporting_region_code=region.region_code,
                reporting_region_name=region.region_name,
                reporting_geography_type=NATIVE_SGIS,
                source_reporting_level=region.region_level,
                waste_stream=stats.waste_stream,
                per_capita_kg_per_year=derived,
                per_capita_unit=PER_CAPITA_UNIT,
                generation_quantity=stats.generation_quantity,
                quantity_unit=stats.quantity_unit,
                accounting_basis=stats.accounting_basis,
                numerator_reporting_level=region.region_level,
                waste_source_id=stats.source_id,
                waste_source_pid=stats.source_pid,
                waste_official_dataset_name=stats.official_dataset_name,
                waste_reference_period=stats.reference_period,
                population=population.population,
                population_definition=population.population_definition,
                population_source_id=population.source_id,
                population_reference_period=population.reference_period,
                population_is_derived=False,
                population_derivation=None,
                child_region_codes=None,
                reference_year=resolved_year,
            )
        )

    # Derived city reporting regions: denominator = sum of SGIS child populations.
    derived_query = (
        select(ReportingRegionWasteStatistics, WasteReportingRegion)
        .join(
            WasteReportingRegion,
            ReportingRegionWasteStatistics.reporting_region_id == WasteReportingRegion.id,
        )
        .where(ReportingRegionWasteStatistics.reference_year == resolved_year)
        .order_by(
            WasteReportingRegion.reporting_region_code,
            ReportingRegionWasteStatistics.waste_stream,
        )
    )
    if waste_stream is not None:
        derived_query = derived_query.where(
            ReportingRegionWasteStatistics.waste_stream == waste_stream
        )
    if region_code is not None:
        derived_query = derived_query.where(
            WasteReportingRegion.reporting_region_code == region_code
        )
    child_id_by_region = _child_ids_by_region(session, resolved_year)
    for stats, region in session.execute(derived_query).all():
        codes, _ = members_by_region.get(region.id, ([], []))
        child_region_ids = child_id_by_region.get(region.id, [])
        total_population, pop_reason = _sum_child_population(
            child_region_ids, region.child_region_count, populations
        )
        if pop_reason is not None:
            excluded.append(
                _excluded(
                    region.reporting_region_code,
                    region.reporting_region_name,
                    stats.waste_stream,
                    pop_reason,
                )
            )
            continue
        derived = _per_capita_or_reason(
            stats.generation_quantity, stats.quantity_unit, total_population
        )
        if isinstance(derived, str):
            excluded.append(
                _excluded(
                    region.reporting_region_code,
                    region.reporting_region_name,
                    stats.waste_stream,
                    derived,
                )
            )
            continue
        # Every member shares the same population definition/source (validated in
        # _sum_child_population), so it is safe to report one.
        sample_pop = populations[child_region_ids[0]][0]
        items.append(
            ReportingPerCapitaOut(
                reporting_region_code=region.reporting_region_code,
                reporting_region_name=region.reporting_region_name,
                reporting_geography_type=region.reporting_geography_type,
                source_reporting_level=region.source_reporting_level,
                waste_stream=stats.waste_stream,
                per_capita_kg_per_year=derived,
                per_capita_unit=PER_CAPITA_UNIT,
                generation_quantity=stats.generation_quantity,
                quantity_unit=stats.quantity_unit,
                accounting_basis=stats.accounting_basis,
                numerator_reporting_level=region.source_reporting_level,
                waste_source_id=stats.source_id,
                waste_source_pid=stats.source_pid,
                waste_official_dataset_name=stats.official_dataset_name,
                waste_reference_period=stats.reference_period,
                population=total_population,
                population_definition=sample_pop.population_definition,
                population_source_id=sample_pop.source_id,
                population_reference_period=sample_pop.reference_period,
                population_is_derived=True,
                population_derivation="SUM_OF_SGIS_CHILD_DISTRICTS",
                child_region_codes=codes,
                reference_year=resolved_year,
            )
        )

    items.sort(key=lambda i: (i.reporting_region_code, i.waste_stream))
    return ReportingPerCapitaEnvelope(
        indicator=INDICATOR_NAME,
        derivation_version=DERIVATION_VERSION,
        derivation_formula=DERIVATION_FORMULA,
        unit=PER_CAPITA_UNIT,
        assumptions=PER_CAPITA_ASSUMPTIONS,
        reference_year=resolved_year,
        count=len(items),
        items=items,
        excluded_regions=excluded,
    )


def _child_ids_by_region(session: SessionDep, year: int) -> dict[int, list[int]]:
    rows = session.execute(
        select(
            WasteReportingRegionMember.reporting_region_id,
            WasteReportingRegionMember.child_region_id,
        )
        .join(
            WasteReportingRegion,
            WasteReportingRegionMember.reporting_region_id == WasteReportingRegion.id,
        )
        .where(func.extract("year", WasteReportingRegion.valid_from) == year)
    ).all()
    result: dict[int, list[int]] = {}
    for region_id, child_id in rows:
        result.setdefault(int(region_id), []).append(int(child_id))
    return result


def _sum_child_population(
    child_region_ids: list[int],
    expected_count: int,
    populations: dict[int, list["RegionalPopulation"]],
) -> tuple[int, str | None]:
    """Exact sum of the child SGIS populations, or a precise exclusion reason.

    Requires exactly one eligible population row per child at the same reference
    year, with a single shared definition/source. Any gap excludes the city.
    """
    if len(child_region_ids) != expected_count or not child_region_ids:
        return 0, "INCOMPLETE_CHILD_POPULATION"
    definitions: set[str] = set()
    sources: set[str] = set()
    total = 0
    for child_id in child_region_ids:
        rows = populations.get(child_id, [])
        if not rows:
            return 0, "NO_POPULATION_DENOMINATOR"
        if len(rows) > 1:
            return 0, "AMBIGUOUS_POPULATION_DEFINITION"
        total += rows[0].population
        definitions.add(rows[0].population_definition)
        sources.add(rows[0].source_id)
    if len(definitions) != 1 or len(sources) != 1:
        return 0, "AMBIGUOUS_POPULATION_DEFINITION"
    return total, None


def _population_issue(candidates: list["RegionalPopulation"]) -> str | None:
    if not candidates:
        return "NO_POPULATION_DENOMINATOR"
    if len(candidates) > 1:
        return "AMBIGUOUS_POPULATION_DEFINITION"
    return None


def _per_capita_or_reason(generation_quantity: Any, quantity_unit: str, population: int) -> Any:
    try:
        return per_capita_kg_per_year(generation_quantity, quantity_unit, population)
    except ZeroPopulationError:
        return "ZERO_POPULATION"
    except UnexpectedQuantityUnitError:
        return "UNEXPECTED_QUANTITY_UNIT"


def _excluded(
    reporting_region_code: str, reporting_region_name: str, waste_stream: str, reason: str
) -> ReportingExcludedRegion:
    return ReportingExcludedRegion(
        reporting_region_code=reporting_region_code,
        reporting_region_name=reporting_region_name,
        waste_stream=waste_stream,
        reason=reason,
    )
