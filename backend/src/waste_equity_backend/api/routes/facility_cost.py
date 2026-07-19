"""Facility cost model API (Phase 4 V1) — read-only, GET-only.

Serves the versioned standard-cost table, the selectable scenario options, and a
standard-construction-cost calculation over official waste + population data.

The result is an explicitly PARTIAL standard-construction-cost analysis: it is not
an actual project budget, an approved subsidy, an actual transport cost, or a
personal tax bill. Handlers never call government APIs, never read credentials,
aggregate only over leaf (SIGUNGU) regions to avoid double counting, never borrow
population from another year, and return a structured 404/422 (never fabricated
data) when the official inputs are missing or the aggregation is unsafe.
"""

from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from ...analysis import facility_cost as fc
from ...analysis.per_capita import EXPECTED_QUANTITY_UNIT
from ...models import (
    FacilityStandardCost,
    Region,
    RegionalPopulation,
    RegionalWasteStatistics,
    SuitabilityAnalysisRun,
    SuitabilityCandidate,
)
from ...models.metadata import GRANULARITY_ANNUAL
from ...schemas import UnavailableDataError
from ...schemas.facility_cost import (
    AnnualizationOut,
    CandidateContextOut,
    CapacityOut,
    CompletenessOut,
    FacilityCostCalculateOut,
    LabelledOption,
    MissingComponent,
    OfficialInputOut,
    OfficialInputRegion,
    OptionsOut,
    PerCapitaOut,
    ProvenanceOut,
    ScenarioOut,
    StandardCostBandOut,
    StandardCostOut,
    StandardCostVersionOut,
    StandardsEnvelope,
    SubsidyOption,
    SubsidyOut,
    UndergroundMultiplierOption,
)
from .datasets import SessionDep, WasteStream, _available_years, _resolve_reference_year

router = APIRouter(prefix="/api/v1/facility-cost", tags=["facility-cost"])

_POPULATION_SOURCE_ID = "sgis"
_POPULATION_GEOGRAPHIC_LEVEL = "SIGUNGU"
_UNIT_COST_UNIT = "억원/(톤·일)"
_COST_UNIT = "억원"

FacilityTypeParam = Literal["incineration_new", "sorting_auto"]
SubsidySchemeParam = Literal[
    "seoul_special_city", "metropolitan_city", "city_or_county", "joint_regional_facility"
]

ASSUMPTIONS = [
    "표준공사비 단가는 국고보조금 업무처리지침의 시설 규모별 표(억원/(톤·일))를 그대로 사용하며, "
    "물가·설계 변경·부지 여건·실제 계약단가는 반영하지 않습니다. "
    "(Standard unit costs are the guideline's size-band table, not actual contract rates.)",
    "필요 시설 규모 = 연간 처리량 ÷ 연간 가동일수(기본 300일)입니다. 일 단위 환산을 이중 적용하지 "
    "않습니다. (Capacity = annual quantity ÷ operating days; no double conversion.)",
    "국비 추정과 지방비 추정은 명목 보조율에 따른 분석용 추정치이며, 승인된 국고보조금이 아닙니다. "
    "(Subsidy/local-share are analytical estimates at nominal rates, not approved grants.)",
    "지하화 배수(1.00–1.40)는 분석 시나리오이며 실제 보장된 공사비 배수가 아닙니다. "
    "(The underground multiplier is a scenario, not a guaranteed multiplier.)",
    "주민 1인당 환산 지방비는 동일 연도의 공식 인구로 나눈 환산값이며 "
    "개인의 세금 청구액이 아닙니다. "
    "(Per-capita local share is a conversion by same-year population, not a personal tax bill.)",
    "결과는 표준공사비 기반 설치비 분석이며 실제 총사업비가 아닙니다. 운영비·실제 운송비·토지 및 "
    "보상비 등은 포함되지 않습니다. (Partial standard-cost analysis; operating, transport, land "
    "costs excluded.)",
]


def _bad_request(code: str, detail: str) -> HTTPException:
    return HTTPException(status_code=422, detail={"error": code, "detail": detail})


def _not_found(error: UnavailableDataError) -> HTTPException:
    return HTTPException(status_code=404, detail=error.model_dump())


def _band_out(row: FacilityStandardCost) -> StandardCostBandOut:
    return StandardCostBandOut(
        facility_type=row.facility_type,
        capacity_min_ton_per_day=row.capacity_min_ton_per_day,
        capacity_min_inclusive=row.capacity_min_inclusive,
        capacity_max_ton_per_day=row.capacity_max_ton_per_day,
        capacity_max_inclusive=row.capacity_max_inclusive,
        cost_per_capacity_bn=row.cost_per_capacity_bn,
        cost_per_capacity_unit=_UNIT_COST_UNIT,
    )


def _bands_to_domain(rows: list[FacilityStandardCost]) -> list[fc.StandardCostBand]:
    return [
        fc.StandardCostBand(
            facility_type=r.facility_type,
            capacity_min_ton_per_day=r.capacity_min_ton_per_day,
            capacity_min_inclusive=r.capacity_min_inclusive,
            capacity_max_ton_per_day=r.capacity_max_ton_per_day,
            capacity_max_inclusive=r.capacity_max_inclusive,
            cost_per_capacity_bn=r.cost_per_capacity_bn,
        )
        for r in rows
    ]


@router.get("/standards", response_model=StandardsEnvelope)
def standards(session: SessionDep) -> StandardsEnvelope:
    rows = session.scalars(
        select(FacilityStandardCost).order_by(
            FacilityStandardCost.cost_version,
            FacilityStandardCost.facility_type,
            # NULLS FIRST is dialect-specific; order by a coalesced value so the
            # first (unbounded-min) band sorts first on both SQLite and Postgres.
            FacilityStandardCost.capacity_min_ton_per_day.is_(None).desc(),
            FacilityStandardCost.capacity_min_ton_per_day,
        )
    ).all()
    by_version: dict[str, list[FacilityStandardCost]] = {}
    for row in rows:
        by_version.setdefault(row.cost_version, []).append(row)
    versions = [
        StandardCostVersionOut(
            cost_version=version,
            price_base_date=version_rows[0].price_base_date,
            source_document=version_rows[0].source_document,
            source_page=version_rows[0].source_page,
            source_note=version_rows[0].source_note,
            facility_types=sorted({r.facility_type for r in version_rows}),
            bands=[_band_out(r) for r in version_rows],
        )
        for version, version_rows in by_version.items()
    ]
    return StandardsEnvelope(
        derivation_version=fc.DERIVATION_VERSION,
        active_cost_version=fc.ACTIVE_COST_VERSION,
        count=len(rows),
        versions=versions,
        disclaimer=fc.DISCLAIMER,
    )


@router.get("/options", response_model=OptionsOut)
def options(session: SessionDep) -> OptionsOut:
    cost_versions = sorted(
        set(session.scalars(select(FacilityStandardCost.cost_version).distinct()).all())
    )
    return OptionsOut(
        derivation_version=fc.DERIVATION_VERSION,
        facility_types=[
            LabelledOption(value=key, label=fc.FACILITY_TYPE_LABELS[key])
            for key in sorted(fc.SUPPORTED_FACILITY_TYPES)
        ],
        subsidy_schemes=[
            SubsidyOption(value=key, label=fc.SUBSIDY_SCHEME_LABELS[key], rate=rate)
            for key, rate in fc.SUBSIDY_SCHEMES.items()
        ],
        underground_multiplier=UndergroundMultiplierOption(
            min=fc.UNDERGROUND_MULTIPLIER_MIN,
            max=fc.UNDERGROUND_MULTIPLIER_MAX,
            default=fc.DEFAULT_UNDERGROUND_MULTIPLIER,
            note=fc.UNDERGROUND_MULTIPLIER_NOTE,
        ),
        default_operating_days=fc.DEFAULT_OPERATING_DAYS,
        cost_versions=cost_versions,
        active_cost_version=fc.ACTIVE_COST_VERSION,
        disclaimer=fc.DISCLAIMER,
    )


def _parse_region_codes(raw: str) -> list[str]:
    codes = [code.strip() for code in raw.split(",") if code.strip()]
    if not codes:
        raise _bad_request("MISSING_REGION_CODES", "At least one service region code is required.")
    # De-duplicate while preserving order.
    seen: dict[str, None] = {}
    for code in codes:
        seen.setdefault(code, None)
    return list(seen)


def _candidate_context(session: SessionDep, candidate_id: int) -> CandidateContextOut:
    # Column-scoped (no geometry) so this works without loading the spatial column.
    row = session.execute(
        select(
            SuitabilityCandidate.id,
            SuitabilityCandidate.candidate_key,
            SuitabilityCandidate.sido_region_name,
            SuitabilityCandidate.sigungu_region_name,
            SuitabilityCandidate.status,
            SuitabilityCandidate.analysis_run_id,
            SuitabilityAnalysisRun.weight_profile,
        )
        .join(
            SuitabilityAnalysisRun,
            SuitabilityCandidate.analysis_run_id == SuitabilityAnalysisRun.id,
        )
        .where(SuitabilityCandidate.id == candidate_id)
    ).first()
    if row is None:
        raise _not_found(
            UnavailableDataError(
                error="CANDIDATE_NOT_FOUND",
                detail=f"No suitability candidate with id {candidate_id}.",
            )
        )
    return CandidateContextOut(
        candidate_id=row.id,
        candidate_key=row.candidate_key,
        sido_region_name=row.sido_region_name,
        sigungu_region_name=row.sigungu_region_name,
        suitability_status=row.status,
        run_id=row.analysis_run_id,
        profile=row.weight_profile,
        note=(
            "현재 표준 설치비는 동일한 시설 규모라면 후보 셀별로 크게 달라지지 않습니다. "
            "후보지별 실제 비용 비교에는 토지가격, 토목조건, 실제 운송경로 등 "
            "추가 데이터가 필요합니다."
        ),
        suitability_disclaimer=(
            "적합성 상태는 분석용 스크리닝 결과이며 법적 적격·허가·최종 입지 결정이 아닙니다."
        ),
    )


@router.get("/calculate", response_model=FacilityCostCalculateOut)
def calculate(
    session: SessionDep,
    facility_type: FacilityTypeParam,
    waste_stream: WasteStream,
    subsidy_scheme: SubsidySchemeParam,
    region_codes: Annotated[
        str, Query(description="Comma-separated SIGUNGU region codes (the service area).")
    ],
    reference_year: Annotated[int | None, Query(ge=1990, le=2100)] = None,
    processing_share_percent: Annotated[Decimal, Query(ge=0, le=100)] = Decimal("100"),
    operating_days: Annotated[int, Query(ge=1, le=366)] = fc.DEFAULT_OPERATING_DAYS,
    underground_multiplier: Annotated[Decimal, Query(ge=1, le=Decimal("1.40"))] = (
        fc.DEFAULT_UNDERGROUND_MULTIPLIER
    ),
    cost_version: str | None = None,
    candidate_id: int | None = None,
) -> FacilityCostCalculateOut:
    resolved_cost_version = cost_version or fc.ACTIVE_COST_VERSION
    band_rows = session.scalars(
        select(FacilityStandardCost).where(
            FacilityStandardCost.cost_version == resolved_cost_version
        )
    ).all()
    if not band_rows:
        raise _not_found(
            UnavailableDataError(
                error="UNKNOWN_COST_VERSION",
                detail=f"No standard-cost rows for cost_version {resolved_cost_version!r}.",
            )
        )

    codes = _parse_region_codes(region_codes)
    # Column-scoped (never selects the PostGIS geometry): the cost model needs only
    # code/name/level, so this also runs on the non-spatial SQLite test tier. Waste
    # and population are joined by region_code (below), not by a resolved region_id,
    # so a code that maps to several boundary vintages is handled correctly.
    region_rows = session.execute(
        select(Region.region_code, Region.region_name, Region.region_level)
        .where(Region.region_code.in_(codes))
        .distinct()
    ).all()
    found = {r.region_code: r for r in region_rows}
    missing_codes = [code for code in codes if code not in found]
    if missing_codes:
        raise _not_found(
            UnavailableDataError(
                error="REGION_NOT_FOUND",
                detail=f"Unknown region code(s): {missing_codes}.",
            )
        )
    non_leaf = [code for code in codes if found[code].region_level != _POPULATION_GEOGRAPHIC_LEVEL]
    if non_leaf:
        raise _bad_request(
            "NON_LEAF_REGION",
            f"Service regions must be SIGUNGU (leaf) to avoid double counting; got {non_leaf}.",
        )

    ordered_regions = [found[code] for code in codes]

    # Resolve the reference year from the waste series for this stream.
    waste_years = _available_years(
        session,
        RegionalWasteStatistics.reference_year,
        RegionalWasteStatistics.waste_stream == waste_stream,
    )
    resolved_year = _resolve_reference_year(
        waste_years, reference_year, f"{waste_stream} waste generation"
    )

    # Official waste aggregation, joined by region_code. Every requested region MUST
    # have exactly one row: none → undercount (refuse); more than one → ambiguous
    # (refuse) rather than double count.
    waste_rows = session.execute(
        select(
            Region.region_code,
            RegionalWasteStatistics.generation_quantity,
            RegionalWasteStatistics.quantity_unit,
            RegionalWasteStatistics.accounting_basis,
            RegionalWasteStatistics.source_id,
            RegionalWasteStatistics.official_dataset_name,
            RegionalWasteStatistics.reference_period,
        )
        .join(Region, RegionalWasteStatistics.region_id == Region.id)
        .where(
            Region.region_code.in_(codes),
            RegionalWasteStatistics.reference_year == resolved_year,
            RegionalWasteStatistics.waste_stream == waste_stream,
        )
    ).all()
    waste_by_code: dict[str, Any] = {}
    duplicate_codes: list[str] = []
    for row in waste_rows:
        if row.region_code in waste_by_code:
            duplicate_codes.append(row.region_code)
        waste_by_code[row.region_code] = row
    if duplicate_codes:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "AMBIGUOUS_WASTE_ROWS",
                "detail": f"Multiple {waste_stream} rows for {duplicate_codes} in {resolved_year}.",
            },
        )
    missing_waste = [code for code in codes if code not in waste_by_code]
    if missing_waste:
        raise _not_found(
            UnavailableDataError(
                error="OFFICIAL_WASTE_UNAVAILABLE",
                detail=(
                    f"No official {waste_stream} generation for {missing_waste} "
                    f"in {resolved_year}; aggregation would be undercounted."
                ),
                requested_year=resolved_year,
                available_years=waste_years,
            )
        )
    units = {row.quantity_unit for row in waste_rows}
    if units != {EXPECTED_QUANTITY_UNIT}:
        raise _bad_request(
            "MIXED_OR_UNEXPECTED_WASTE_UNIT",
            f"Waste rows must all be {EXPECTED_QUANTITY_UNIT!r}; got {sorted(units)}.",
        )
    bases = {row.accounting_basis for row in waste_rows}
    sources = {row.source_id for row in waste_rows}
    datasets = {row.official_dataset_name for row in waste_rows}
    periods = {row.reference_period for row in waste_rows}
    if len(bases) != 1 or len(sources) != 1 or len(datasets) != 1:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "MIXED_WASTE_PROVENANCE",
                "detail": "Waste rows disagree on accounting basis / source / dataset.",
            },
        )
    official_quantity = sum(
        (waste_by_code[code].generation_quantity for code in codes), start=Decimal("0")
    )

    # Population aggregation (same year only — never borrowed), joined by region_code.
    # Missing/ambiguous population makes the per-capita share null + reason; the cost
    # part still runs.
    population_rows = session.execute(
        select(
            Region.region_code,
            RegionalPopulation.population,
            RegionalPopulation.source_id,
            RegionalPopulation.reference_period,
            RegionalPopulation.population_definition,
        )
        .join(Region, RegionalPopulation.region_id == Region.id)
        .where(
            Region.region_code.in_(codes),
            RegionalPopulation.reference_year == resolved_year,
            RegionalPopulation.population_temporal_granularity == GRANULARITY_ANNUAL,
            RegionalPopulation.source_id == _POPULATION_SOURCE_ID,
            RegionalPopulation.source_geographic_level == _POPULATION_GEOGRAPHIC_LEVEL,
        )
    ).all()
    population_by_code: dict[str, list[Any]] = {}
    for pop_row in population_rows:
        population_by_code.setdefault(pop_row.region_code, []).append(pop_row)
    # Exactly one population row per requested region (ambiguous or missing → not
    # complete → per-capita is null with a reason, never fabricated).
    population_complete = all(len(population_by_code.get(code, [])) == 1 for code in codes)
    official_population: int | None = None
    population_reason: str | None = None
    pop_source_id: str | None = None
    pop_reference_period: str | None = None
    pop_definition: str | None = None
    if population_complete:
        official_population = sum(population_by_code[code][0].population for code in codes)
        sample = population_by_code[codes[0]][0]
        pop_source_id = sample.source_id
        pop_reference_period = sample.reference_period
        pop_definition = sample.population_definition
    else:
        population_reason = "NO_MATCHING_SAME_YEAR_POPULATION"

    # Core calculation (pure Decimal engine).
    processing_share = fc.processing_share_from_percent(processing_share_percent)
    try:
        calc = fc.calculate_facility_cost(
            bands=_bands_to_domain(list(band_rows)),
            facility_type=facility_type,
            official_annual_quantity_ton=official_quantity,
            processing_share=processing_share,
            operating_days_per_year=operating_days,
            underground_multiplier=underground_multiplier,
            subsidy_scheme=subsidy_scheme,
            official_service_population=official_population,
        )
    except fc.FacilityCostError as exc:
        raise _bad_request(exc.code, str(exc)) from exc

    per_capita_reason = calc.per_capita_unavailable_reason or population_reason

    candidate_context = (
        _candidate_context(session, candidate_id) if candidate_id is not None else None
    )

    return FacilityCostCalculateOut(
        scenario=ScenarioOut(
            facility_type=facility_type,
            facility_type_label=fc.FACILITY_TYPE_LABELS[facility_type],
            processing_share=calc.processing_share,
            processing_share_percent=processing_share_percent,
            operating_days_per_year=operating_days,
            underground_multiplier=calc.underground_multiplier,
            underground_multiplier_note=fc.UNDERGROUND_MULTIPLIER_NOTE,
            subsidy_scheme=subsidy_scheme,
            subsidy_scheme_label=fc.SUBSIDY_SCHEME_LABELS[subsidy_scheme],
            subsidy_rate=calc.subsidy_rate,
            cost_version=resolved_cost_version,
        ),
        official_input=OfficialInputOut(
            waste_stream=waste_stream,
            reference_year=resolved_year,
            waste_reference_period=next(iter(periods)),
            accounting_basis=next(iter(bases)),
            waste_source_id=next(iter(sources)),
            waste_official_dataset_name=next(iter(datasets)),
            quantity_unit=EXPECTED_QUANTITY_UNIT,
            official_annual_quantity_ton=official_quantity,
            service_region_codes=codes,
            regions=[
                OfficialInputRegion(
                    region_code=r.region_code,
                    region_name=r.region_name,
                    generation_quantity_ton=waste_by_code[r.region_code].generation_quantity,
                    population=(
                        population_by_code[r.region_code][0].population
                        if population_complete
                        else None
                    ),
                )
                for r in ordered_regions
            ],
            population_source_id=pop_source_id,
            population_reference_period=pop_reference_period,
            population_definition=pop_definition,
            official_service_population=official_population,
        ),
        capacity=CapacityOut(
            annual_service_quantity_ton=calc.annual_service_quantity_ton,
            operating_days_per_year=operating_days,
            facility_capacity_ton_per_day=calc.facility_capacity_ton_per_day,
            capacity_unit="톤/일",
        ),
        standard_cost=StandardCostOut(
            term_ko="표준공사비 기반 설치비 산정액",
            matched_band=StandardCostBandOut(
                facility_type=calc.matched_band.facility_type,
                capacity_min_ton_per_day=calc.matched_band.capacity_min_ton_per_day,
                capacity_min_inclusive=calc.matched_band.capacity_min_inclusive,
                capacity_max_ton_per_day=calc.matched_band.capacity_max_ton_per_day,
                capacity_max_inclusive=calc.matched_band.capacity_max_inclusive,
                cost_per_capacity_bn=calc.matched_band.cost_per_capacity_bn,
                cost_per_capacity_unit=_UNIT_COST_UNIT,
            ),
            standard_unit_cost_bn_per_tpd=calc.standard_unit_cost_bn_per_tpd,
            underground_multiplier=calc.underground_multiplier,
            standard_construction_cost_bn=calc.standard_construction_cost_bn,
            unit=_COST_UNIT,
        ),
        annualization=AnnualizationOut(
            term_ko="연간 환산 설치비",
            facility_lifetime_years=calc.facility_lifetime_years,
            annualized_construction_cost_bn=calc.annualized_construction_cost_bn,
            unit=_COST_UNIT,
            method="STRAIGHT_LINE_ANALYTICAL",
        ),
        subsidy=SubsidyOut(
            subsidy_scheme=subsidy_scheme,
            subsidy_scheme_label=fc.SUBSIDY_SCHEME_LABELS[subsidy_scheme],
            subsidy_rate=calc.subsidy_rate,
            estimated_national_subsidy_bn=calc.estimated_national_subsidy_bn,
            simplified_local_government_share_bn=calc.simplified_local_government_share_bn,
            unit=_COST_UNIT,
            note=(
                "명목 보조율에 따른 분석용 추정치이며 승인된 국고보조금이 아닙니다. "
                "(Analytical estimate at a nominal rate; not an approved grant.)"
            ),
        ),
        per_capita=PerCapitaOut(
            term_ko="주민 1인당 환산 지방비",
            per_capita_local_share_won=calc.per_capita_local_share_won,
            official_service_population=official_population,
            unavailable_reason=per_capita_reason,
            unit="원",
            caveat=("동일 연도의 공식 인구로 나눈 환산값이며 개인의 실제 세금 청구액이 아닙니다."),
        ),
        candidate_context=candidate_context,
        completeness=CompletenessOut(
            is_partial=True,
            included_components=list(fc.INCLUDED_COMPONENTS),
            missing_components=[
                MissingComponent(component=c["component"], reason=c["reason"])
                for c in fc.MISSING_COMPONENTS
            ],
        ),
        provenance=ProvenanceOut(
            derivation_version=fc.DERIVATION_VERSION,
            cost_version=resolved_cost_version,
            price_base_date=band_rows[0].price_base_date,
            source_document=band_rows[0].source_document,
            source_page=band_rows[0].source_page,
        ),
        assumptions=ASSUMPTIONS,
        disclaimer=fc.DISCLAIMER,
    )
