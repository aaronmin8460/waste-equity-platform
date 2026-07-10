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

from fastapi import APIRouter, Query
from sqlalchemy import select

from ...analysis import (
    DERIVATION_FORMULA,
    DERIVATION_VERSION,
    PER_CAPITA_UNIT,
    UnexpectedQuantityUnitError,
    ZeroPopulationError,
    per_capita_kg_per_year,
)
from ...models import Region, RegionalPopulation, RegionalWasteStatistics
from ...schemas import EquityEnvelope, ExcludedRegion, WastePerCapitaOut
from .datasets import (
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
