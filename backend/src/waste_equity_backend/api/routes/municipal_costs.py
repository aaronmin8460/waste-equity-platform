"""Read-only 2024 municipal waste collection-and-transport payment endpoint.

Served under the ``/api/v1/landfill`` prefix purely for dashboard placement. It
is **not** the official landfill dataset and every response says so explicitly:
``meta.is_official_landfill_fee`` is always ``false`` and
``meta.difference_from_official_landfill_fee`` spells out the difference in the
payload itself, so a consumer that reads only the JSON cannot confuse this with
``LANDFILL_INBOUND_FEE_PER_CAPITA``.

The handler reads only the six ``municipal_cost_*`` / ``municipal_waste_*``
tables. It never touches ``landfill_inbound_monthly``, never calls a government
API, and never reads credentials.

Full scope always returns exactly one row per expected 2024 municipality — 66 of
them — including the ones with no value. An unavailable municipality carries
``null`` for population, payment, and per-capita value, plus the reason codes
that say why; it is never returned as 0.

That 66-row scope is enforced here and not merely assumed: a stored geography
whose key is not in the reviewed registry is dropped before serialization, so a
post-2024 unit can never be displayed as an observation of the published year.
"""

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...analysis.municipal_cost import (
    EXPECTED_COUNT_BY_METROPOLITAN,
    EXPECTED_MUNICIPALITY_COUNT,
    GEOGRAPHY_POLICY_KO,
    MUNICIPALITIES_BY_KEY,
    POPULATION_POLICY_KO,
    REFERENCE_YEAR,
    REJECTED_FILE_RULES,
    describe_reasons,
    nfc,
)
from ...models import (
    MunicipalCostGeography,
    MunicipalCostGeographyComponent,
    MunicipalCostIndicatorValue,
    MunicipalCostSourceFile,
    MunicipalWasteQuantity,
)
from ...models.municipal_cost import (
    ACCOUNTING_BASIS_MUNICIPAL_CONTRACT_PAYMENT,
    ATTRIBUTION_MUNICIPAL_TOTAL_REPEATED,
    DATASET_ROLE_A,
    DATASET_ROLE_B,
    INDICATOR_DESCRIPTION_KO,
    INDICATOR_DIFFERENCE_FROM_OFFICIAL_LANDFILL_FEE_KO,
    INDICATOR_DISPLAY_NAME_KO,
    INDICATOR_NUMERATOR_DEFINITION_KO,
    INDICATOR_UNIT,
    INGESTION_DECISION_ACCEPTED,
    INGESTION_DECISION_REJECTED,
    METHODOLOGY_VERSION,
    MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
    STATUS_AVAILABLE,
    STATUS_PARTIAL,
    STATUS_UNAVAILABLE,
    VALUE_MEASURED,
    VALUE_MEASURED_ZERO,
)
from ...schemas.municipal_cost import (
    MunicipalCostMeta,
    MunicipalCostOut,
    MunicipalCostPopulationComponent,
    MunicipalCostQuantityCoverage,
    MunicipalCostRejectedSource,
    MunicipalCostRow,
    MunicipalCostSourceCoverage,
    MunicipalCostSourceRef,
)
from .datasets import SessionDep

router = APIRouter(prefix="/api/v1/landfill", tags=["municipal-costs"])

# A bounded ``int``, not ``Literal[2024]``: query values always arrive as strings
# and Pydantic does not coerce ``"2024"`` into an ``int`` literal, so the literal
# form rejects the one year this release publishes. The bounds keep the contract
# identical — 2024 is accepted, every other year is a 422.
YearParam = Annotated[
    int,
    Query(
        ge=REFERENCE_YEAR,
        le=REFERENCE_YEAR,
        description="Reference year. Only 2024 is published in this release.",
    ),
]
SidoParam = Annotated[
    Literal["11", "28", "41"] | None,
    Query(description="Metropolitan SGIS sido code: 11 Seoul, 28 Incheon, 41 Gyeonggi."),
]
StatusParam = Annotated[
    Literal["AVAILABLE", "PARTIAL", "UNAVAILABLE"] | None,
    Query(description="Filter to one indicator status."),
]
SortParam = Annotated[
    Literal["payment_per_capita_desc", "total_payment_desc", "region_name_asc"],
    Query(description="Row ordering."),
]

CAVEATS = [
    "이 지표는 개별 기초지자체가 공개한 2024년 생활폐기물 수집·운반 대행 계약의 지급액을 "
    "동일 행정구역의 2024년 인구로 나눈 분석 지표입니다.",
    "수도권매립지 공식 반입수수료(LANDFILL_INBOUND_FEE_PER_CAPITA)와는 회계 기준·"
    "제공기관·공간 단위가 모두 다릅니다. 두 값을 합산해 1인당 총 관리비용으로 제시할 "
    "때에는 인구 기준이 서로 다르다는 점을 함께 밝혀야 합니다.",
    "분자는 수집·운반 계약 지급액만 포함하며, 지자체 전체 폐기물 관리비용·시설 투자비·"
    "직영 인건비·처리시설 반입수수료는 포함하지 않습니다.",
    "값이 없는 지자체는 null로 표시되며 0이 아닙니다. 사유 코드를 함께 확인해야 합니다.",
    "경기 7개 시(수원·성남·안양·부천·안산·고양·용인)의 인구는 구성 일반구 인구의 합계로 "
    "산출한 계산값이며, 원자료가 시 단위로 보고한 값이 아닙니다.",
]

_SORTS = {
    # Nulls last on both value sorts: an unavailable municipality is never
    # ordered as if it were the cheapest.
    #
    # ``municipality_key`` is the final tiebreak on every ordering. Without it the
    # dozens of rows that share a null value tie on the whole key, Python's stable
    # sort then falls back to the order the rows arrived in, and that order is
    # whatever the database happened to return for a SELECT with no ORDER BY — so
    # two identical requests could serve two different orderings. The key is unique
    # per municipality (``<metropolitan_code>-<display_name>``), which also keeps
    # 서울 중구 and 인천 중구 apart where ``display_name`` alone cannot.
    "payment_per_capita_desc": lambda row: (
        row.payment_per_capita_krw is None,
        -(row.payment_per_capita_krw or Decimal(0)),
        row.display_name,
        row.municipality_key,
    ),
    "total_payment_desc": lambda row: (
        row.total_eligible_payment_krw is None,
        -(row.total_eligible_payment_krw or Decimal(0)),
        row.display_name,
        row.municipality_key,
    ),
    "region_name_asc": lambda row: (
        row.metropolitan_code,
        row.display_name,
        row.municipality_key,
    ),
}


@router.get("/municipal-costs", response_model=MunicipalCostOut)
def get_municipal_costs(
    session: SessionDep,
    year: YearParam = REFERENCE_YEAR,
    sido: SidoParam = None,
    status: StatusParam = None,
    sort: SortParam = "payment_per_capita_desc",
) -> MunicipalCostOut:
    geographies = [
        geography
        for geography in session.scalars(
            select(MunicipalCostGeography).where(MunicipalCostGeography.reference_year == year)
        )
        # Published-scope guard. Only the reviewed analytical municipalities of the
        # requested vintage are ever served, whatever a later ingestion writes. A
        # post-2024 Incheon district (제물포구·영종구·서해구·검단구) is not 2024
        # geography and must never be *displayed* as a 2024 observation, so it is
        # dropped here rather than trusted through to a citizen-facing dashboard.
        # This is a geography-scope check against the shared registry, not a
        # recomputation of the indicator: statuses, values and reasons are still
        # served exactly as the backend stored them.
        #
        # The key is NFC-normalized first. macOS hands Korean text back in NFD, and
        # an unnormalized comparison would fail to match *every* Korean key and
        # blank the whole response instead of dropping only what is out of scope.
        if nfc(geography.municipality_key) in MUNICIPALITIES_BY_KEY
    ]
    indicators = {
        row.geography_id: row
        for row in session.scalars(
            select(MunicipalCostIndicatorValue)
            .where(MunicipalCostIndicatorValue.reference_year == year)
            .where(
                MunicipalCostIndicatorValue.indicator_code
                == MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA
            )
            .where(MunicipalCostIndicatorValue.methodology_version == METHODOLOGY_VERSION)
        )
    }
    components = _components_by_geography(session)
    source_files = _source_files_by_geography(session, year)
    quantity_coverage = _quantity_coverage_by_geography(session, year)

    rows: list[MunicipalCostRow] = []
    for geography in geographies:
        indicator = indicators.get(geography.id)
        reason_codes = list(indicator.reason_codes) if indicator else list(geography.reason_codes)
        limitations = list(indicator.limitations) if indicator else describe_reasons(reason_codes)
        files = source_files.get(geography.id, [])
        rows.append(
            MunicipalCostRow(
                municipality_key=geography.municipality_key,
                display_name=geography.display_name,
                metropolitan_code=geography.metropolitan_code,
                metropolitan_name=geography.metropolitan_name,
                direct_region_code=geography.direct_region_code,
                boundary_vintage=geography.boundary_vintage,
                population=geography.population,
                population_method=geography.population_method,
                population_definition=geography.population_definition,
                population_components=components.get(geography.id, []),
                total_eligible_payment_krw=(indicator.numerator_amount_krw if indicator else None),
                eligible_contract_count=(indicator.numerator_contract_count if indicator else 0),
                payment_per_capita_krw=indicator.value if indicator else None,
                status=indicator.status if indicator else STATUS_UNAVAILABLE,
                evidence_status=(
                    indicator.evidence_status if indicator else geography.evidence_status
                ),
                reason_codes=reason_codes,
                limitations=limitations,
                source_files=files,
                has_data_a=any(ref.dataset_role == DATASET_ROLE_A for ref in files),
                has_data_b=any(ref.dataset_role == DATASET_ROLE_B for ref in files),
                quantity_coverage=quantity_coverage.get(geography.id, _empty_quantity_coverage()),
            )
        )

    # Scope counts are computed over the selected metropolitan *before* the status
    # filter, so a filtered response still reports honest denominators.
    in_scope = [row for row in rows if sido is None or row.metropolitan_code == sido]
    expected = EXPECTED_MUNICIPALITY_COUNT if sido is None else EXPECTED_COUNT_BY_METROPOLITAN[sido]
    counts = {value: 0 for value in (STATUS_AVAILABLE, STATUS_PARTIAL, STATUS_UNAVAILABLE)}
    for row in in_scope:
        counts[row.status] = counts.get(row.status, 0) + 1

    selected = [row for row in in_scope if status is None or row.status == status]
    selected.sort(key=_SORTS[sort])

    return MunicipalCostOut(
        meta=MunicipalCostMeta(
            indicator_code=MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA,
            display_name=INDICATOR_DISPLAY_NAME_KO,
            description=INDICATOR_DESCRIPTION_KO,
            reference_year=year,
            unit=INDICATOR_UNIT,
            accounting_basis=ACCOUNTING_BASIS_MUNICIPAL_CONTRACT_PAYMENT,
            methodology_version=METHODOLOGY_VERSION,
            geography_policy=GEOGRAPHY_POLICY_KO,
            population_policy=POPULATION_POLICY_KO,
            numerator_definition=INDICATOR_NUMERATOR_DEFINITION_KO,
            difference_from_official_landfill_fee=(
                INDICATOR_DIFFERENCE_FROM_OFFICIAL_LANDFILL_FEE_KO
            ),
            is_official_landfill_fee=False,
            expected_count=expected,
            available_count=counts[STATUS_AVAILABLE],
            partial_count=counts[STATUS_PARTIAL],
            unavailable_count=counts[STATUS_UNAVAILABLE],
            returned_count=len(selected),
            rejected_source_file_count=_rejected_file_count(session, year),
            rejected_source_files=_rejected_files(session, year),
            source_coverage=_source_coverage(session, year, rows),
            caveats=CAVEATS,
        ),
        sido_filter=sido,
        status_filter=status,
        sort=sort,
        municipalities=selected,
    )


def _empty_quantity_coverage() -> MunicipalCostQuantityCoverage:
    return MunicipalCostQuantityCoverage(
        observation_count=0,
        measured_count=0,
        measured_zero_count=0,
        missing_count=0,
        repeated_municipal_block_count=0,
        months_covered=0,
        waste_categories=[],
    )


def _components_by_geography(
    session: Session,
) -> dict[int, list[MunicipalCostPopulationComponent]]:
    grouped: dict[int, list[MunicipalCostPopulationComponent]] = {}
    for row in session.scalars(
        select(MunicipalCostGeographyComponent).order_by(
            MunicipalCostGeographyComponent.component_region_code
        )
    ):
        grouped.setdefault(row.geography_id, []).append(
            MunicipalCostPopulationComponent(
                region_code=row.component_region_code,
                region_name=row.component_region_name,
                population=row.component_population,
            )
        )
    return grouped


def _source_files_by_geography(
    session: Session, year: int
) -> dict[int, list[MunicipalCostSourceRef]]:
    grouped: dict[int, list[MunicipalCostSourceRef]] = {}
    for row in session.scalars(
        select(MunicipalCostSourceFile)
        .where(MunicipalCostSourceFile.reference_year == year)
        .where(MunicipalCostSourceFile.ingestion_decision == INGESTION_DECISION_ACCEPTED)
        .order_by(MunicipalCostSourceFile.relative_path)
    ):
        if row.resolved_geography_id is None:
            continue
        grouped.setdefault(row.resolved_geography_id, []).append(
            MunicipalCostSourceRef(
                filename=row.filename,
                dataset_role=row.dataset_role,
                layout_family=row.layout_family,
                primary_classification=row.primary_classification,
                resolution_basis=row.resolution_basis,
                sha256=row.sha256,
            )
        )
    return grouped


@dataclass
class _CoverageAccumulator:
    observation_count: int = 0
    measured_count: int = 0
    measured_zero_count: int = 0
    missing_count: int = 0
    repeated_count: int = 0
    months: set[str] = field(default_factory=set)
    categories: set[str] = field(default_factory=set)

    def to_schema(self) -> MunicipalCostQuantityCoverage:
        return MunicipalCostQuantityCoverage(
            observation_count=self.observation_count,
            measured_count=self.measured_count,
            measured_zero_count=self.measured_zero_count,
            missing_count=self.missing_count,
            repeated_municipal_block_count=self.repeated_count,
            months_covered=len(self.months),
            waste_categories=sorted(self.categories),
        )


def _quantity_coverage_by_geography(
    session: Session, year: int
) -> dict[int, MunicipalCostQuantityCoverage]:
    """Tonnage evidence per municipality — reported, never fed into the indicator.

    ``missing_count`` counts blank / dash / source-text observations together:
    all three are stored with a NULL value and none of them is a zero.
    """

    coverage: dict[int, _CoverageAccumulator] = {}
    rows = session.execute(
        select(
            MunicipalWasteQuantity.geography_id,
            MunicipalWasteQuantity.value_state,
            MunicipalWasteQuantity.attribution,
            MunicipalWasteQuantity.reference_month,
            MunicipalWasteQuantity.waste_category,
        ).where(MunicipalWasteQuantity.reference_year == year)
    ).all()
    for geography_id, value_state, attribution, month, category in rows:
        bucket = coverage.setdefault(int(geography_id), _CoverageAccumulator())
        bucket.observation_count += 1
        if value_state == VALUE_MEASURED:
            bucket.measured_count += 1
        elif value_state == VALUE_MEASURED_ZERO:
            bucket.measured_zero_count += 1
        else:
            bucket.missing_count += 1
        if attribution == ATTRIBUTION_MUNICIPAL_TOTAL_REPEATED:
            bucket.repeated_count += 1
        if month is not None:
            bucket.months.add(str(month))
        bucket.categories.add(str(category))
    return {key: bucket.to_schema() for key, bucket in coverage.items()}


def _rejected_file_count(session: Session, year: int) -> int:
    return len(
        session.scalars(
            select(MunicipalCostSourceFile.id)
            .where(MunicipalCostSourceFile.reference_year == year)
            .where(MunicipalCostSourceFile.ingestion_decision == INGESTION_DECISION_REJECTED)
        ).all()
    )


def _rejected_files(session: Session, year: int) -> list[MunicipalCostRejectedSource]:
    explanations = {rule.filename: rule.explanation for rule in REJECTED_FILE_RULES}
    rejected: list[MunicipalCostRejectedSource] = []
    for row in session.scalars(
        select(MunicipalCostSourceFile)
        .where(MunicipalCostSourceFile.reference_year == year)
        .where(MunicipalCostSourceFile.ingestion_decision == INGESTION_DECISION_REJECTED)
        .order_by(MunicipalCostSourceFile.relative_path)
    ):
        rejected.append(
            MunicipalCostRejectedSource(
                filename=row.filename,
                dataset_role=row.dataset_role,
                reason_codes=list(row.rejection_reasons),
                explanation=explanations.get(row.filename) or row.resolution_evidence,
            )
        )
    return rejected


def _source_coverage(
    session: Session, year: int, rows: list[MunicipalCostRow]
) -> MunicipalCostSourceCoverage:
    files = list(
        session.scalars(
            select(MunicipalCostSourceFile).where(MunicipalCostSourceFile.reference_year == year)
        )
    )
    accepted = [f for f in files if f.ingestion_decision == INGESTION_DECISION_ACCEPTED]
    return MunicipalCostSourceCoverage(
        discovered_file_count=len(files),
        accepted_file_count=len(accepted),
        rejected_file_count=len(files) - len(accepted),
        data_a_file_count=sum(1 for f in files if f.dataset_role == DATASET_ROLE_A),
        data_b_file_count=sum(1 for f in files if f.dataset_role == DATASET_ROLE_B),
        municipalities_with_data_a=sum(1 for row in rows if row.has_data_a),
        municipalities_with_data_b=sum(1 for row in rows if row.has_data_b),
        municipalities_with_no_source_file=sum(1 for row in rows if not row.source_files),
    )


__all__ = ["router"]
