"""Capital-region Sudokwon Landfill inbound-flow endpoints (V2 Phase 1).

Read-only views over ``landfill_inbound_monthly`` — the two official Sudokwon
Landfill Corporation datasets (inbound quantity ``15064381`` + inbound fee
``15064394``) joined 1:1 by ingestion. Scope is strictly capital-region: origins
are the three metropolitan units only (서울시/인천시/경기도), the destination is
the single Sudokwon Landfill, and a 광역 value is never disaggregated to a
city/district. Handlers never call government APIs and never read credentials.

Period completeness is derived from the stored months: the default reporting
period is the latest complete year (the current partial year is labelled).
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...analysis import landfill as landfill_analysis
from ...models import DataSource, LandfillInboundMonthly
from ...models.landfill_inbound import ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW
from ...schemas import UnavailableDataError
from ...schemas.landfill import (
    LandfillCompositionOut,
    LandfillDestinationNode,
    LandfillEvidence,
    LandfillFlow,
    LandfillFlowsOut,
    LandfillOriginShare,
    LandfillPeriod,
    LandfillPoint,
    LandfillSourceRef,
    LandfillSummaryOut,
    LandfillTrendPoint,
    LandfillTrendsOut,
    LandfillWasteShare,
)
from .datasets import SessionDep, _not_found

router = APIRouter(prefix="/api/v1/landfill", tags=["landfill"])

OriginCode = Literal["11", "28", "41"]
OriginParam = Annotated[
    OriginCode | None,
    Query(description="Metropolitan origin SGIS sido code: 11 Seoul, 28 Incheon, 41 Gyeonggi."),
]
WasteNameParam = Annotated[str | None, Query(description="Filter to a single source waste name.")]
_MONTH_QUERY = Query(default=None, ge=1, le=12, description="Calendar month 1-12 (optional).")

# Bare SGIS sido code → canonical platform region code.
_CANONICAL_BY_SGIS: dict[str, str] = {"11": "KR-SGIS-11", "28": "KR-SGIS-28", "41": "KR-SGIS-41"}


@dataclass(frozen=True)
class _OriginMeta:
    sgis: str
    name: str
    name_en: str
    lon: float
    lat: float


# Reviewed metropolitan origin metadata + schematic flow-node coordinates. These
# are representative points (metropolitan seat), used only to draw the schematic
# straight-line flow; they are not precise boundaries or geocoded coordinates.
_ORIGIN_META: dict[str, _OriginMeta] = {
    "KR-SGIS-11": _OriginMeta("11", "서울시", "Seoul", 126.9780, 37.5665),
    "KR-SGIS-28": _OriginMeta("28", "인천시", "Incheon", 126.7052, 37.4563),
    "KR-SGIS-41": _OriginMeta("41", "경기도", "Gyeonggi", 127.0286, 37.2752),
}

DESTINATION_CODE = "SUDOKWON_LANDFILL"
DESTINATION_NAME = "수도권매립지"
DESTINATION_NAME_EN = "Sudokwon Landfill"
# Representative site point of the Sudokwon Landfill (인천 서구), reviewed constant.
DESTINATION_POINT = LandfillPoint(lon=126.6180, lat=37.5776)
DESTINATION_COORDINATE_PROVENANCE = (
    "수도권매립지 부지(인천 서구)의 대표 지점으로 검토된 상수입니다. 개략(직선) 흐름 표시용이며 "
    "정밀 경계나 지오코딩된 시설 좌표가 아닙니다. (Reviewed representative point of the Sudokwon "
    "Landfill site; schematic flow-node position, not a precise boundary or geocoded coordinate.)"
)

QUANTITY_DATASET_ID = "15064381"
FEE_DATASET_ID = "15064394"

CAVEATS = [
    "수도권매립지관리공사가 서울시·경기도·인천시 단위로 보고한 반입 자료입니다. "
    "시·군·구별 반입량을 의미하지 않습니다.",
    "반입수수료는 공식 보고된 금액이며 순수 운송비 또는 전체 폐기물 관리비가 아닙니다.",
]

ORIGIN_LEVEL_METROPOLITAN = "SIDO"
ORIGIN_LEVEL_LABEL = "광역지자체(metropolitan) 단위 — 시·군·구가 아님"


def _evidence() -> LandfillEvidence:
    return LandfillEvidence(
        quantity_status=landfill_analysis.EVIDENCE_OFFICIAL_REPORTED,
        fee_status=landfill_analysis.EVIDENCE_OFFICIAL_REPORTED,
        derived_status=landfill_analysis.EVIDENCE_OFFICIAL_DERIVED,
        notes=[
            "반입량·반입수수료는 공식 보고값입니다.",
            "월·연 집계, 비중, 톤당 실효 수수료는 공식자료 기반 계산값입니다.",
        ],
    )


def _distinct_months(session: Session) -> list[str]:
    rows = session.scalars(
        select(LandfillInboundMonthly.reference_month)
        .distinct()
        .order_by(LandfillInboundMonthly.reference_month)
    ).all()
    return [str(row) for row in rows]


def _resolve_period(
    session: Session, requested_year: int | None, month: int | None
) -> tuple[LandfillPeriod, int, str | None]:
    months = _distinct_months(session)
    if not months:
        raise _not_found(
            UnavailableDataError(
                error="NO_DATA_AVAILABLE",
                detail="No landfill inbound data has been ingested.",
                requested_year=requested_year,
            )
        )
    available_years = sorted({int(m[:4]) for m in months})
    year = (
        requested_year
        if requested_year is not None
        else landfill_analysis.latest_complete_year(months)
    )
    assert year is not None  # months is non-empty
    if year not in available_years:
        raise _not_found(
            UnavailableDataError(
                error="NO_DATA_FOR_PERIOD",
                detail=f"No landfill inbound data for reference year {year}.",
                requested_year=requested_year,
                available_years=available_years,
            )
        )
    month_str: str | None = None
    if month is not None:
        month_str = f"{year:04d}-{month:02d}"
        if month_str not in months:
            raise _not_found(
                UnavailableDataError(
                    error="NO_DATA_FOR_PERIOD",
                    detail=f"No landfill inbound data for {month_str}.",
                    requested_year=year,
                    available_years=available_years,
                )
            )
    period = LandfillPeriod(
        year=year,
        month=month_str,
        is_complete_year=landfill_analysis.is_complete_year(months, year),
        available_through_month=landfill_analysis.available_through_month(months, year),
        latest_available_month=landfill_analysis.latest_available_month(months),
        available_years=available_years,
    )
    return period, year, month_str


def _query(
    session: Session,
    *,
    year: int | None = None,
    month_str: str | None = None,
    start_month: str | None = None,
    end_month: str | None = None,
    origin_code: str | None = None,
    waste_name: str | None = None,
) -> list[LandfillInboundMonthly]:
    query = select(LandfillInboundMonthly)
    if year is not None:
        query = query.where(LandfillInboundMonthly.reference_year == year)
    if month_str is not None:
        query = query.where(LandfillInboundMonthly.reference_month == month_str)
    if start_month is not None:
        query = query.where(LandfillInboundMonthly.reference_month >= start_month)
    if end_month is not None:
        query = query.where(LandfillInboundMonthly.reference_month <= end_month)
    if origin_code is not None:
        query = query.where(LandfillInboundMonthly.origin_region_code == origin_code)
    if waste_name is not None:
        query = query.where(LandfillInboundMonthly.waste_name == waste_name)
    return list(session.scalars(query).all())


def _sources(session: Session, rows: list[LandfillInboundMonthly]) -> list[LandfillSourceRef]:
    names = {
        source.source_id: source.dataset_name
        for source in session.scalars(
            select(DataSource).where(
                DataSource.source_id.in_([QUANTITY_DATASET_ID, FEE_DATASET_ID])
            )
        ).all()
    }
    quantity_dates = sorted(
        {r.quantity_source_snapshot_date for r in rows if r.quantity_source_snapshot_date}
    )
    fee_dates = sorted({r.fee_source_snapshot_date for r in rows if r.fee_source_snapshot_date})
    quantity_uuids = {r.quantity_source_snapshot_uuid for r in rows}
    fee_uuids = {r.fee_source_snapshot_uuid for r in rows}
    return [
        LandfillSourceRef(
            dataset_id=QUANTITY_DATASET_ID,
            official_dataset_name=names.get(QUANTITY_DATASET_ID, "수도권매립지 반입량"),
            snapshot_uuid=next(iter(quantity_uuids)) if len(quantity_uuids) == 1 else None,
            snapshot_date=quantity_dates[-1].isoformat() if quantity_dates else None,
        ),
        LandfillSourceRef(
            dataset_id=FEE_DATASET_ID,
            official_dataset_name=names.get(FEE_DATASET_ID, "수도권매립지 반입수수료"),
            snapshot_uuid=next(iter(fee_uuids)) if len(fee_uuids) == 1 else None,
            snapshot_date=fee_dates[-1].isoformat() if fee_dates else None,
        ),
    ]


def _origin_share(code: str, kg: Decimal, fee: Decimal, total_kg: Decimal) -> LandfillOriginShare:
    meta = _ORIGIN_META[code]
    return LandfillOriginShare(
        origin_region_code=code,
        origin_sgis_code=meta.sgis,
        origin_name=meta.name,
        origin_name_en=meta.name_en,
        quantity_kg=kg,
        quantity_tons=landfill_analysis.to_tons(kg),
        inbound_fee_krw=fee,
        quantity_share=landfill_analysis.share(kg, total_kg),
        effective_fee_per_ton=landfill_analysis.effective_fee_per_ton(fee, kg),
    )


def _waste_share(name: str, kg: Decimal, fee: Decimal, total_kg: Decimal) -> LandfillWasteShare:
    return LandfillWasteShare(
        waste_name=name,
        quantity_kg=kg,
        quantity_tons=landfill_analysis.to_tons(kg),
        inbound_fee_krw=fee,
        quantity_share=landfill_analysis.share(kg, total_kg),
        effective_fee_per_ton=landfill_analysis.effective_fee_per_ton(fee, kg),
    )


def _group(rows: list[LandfillInboundMonthly], key: str) -> dict[str, tuple[Decimal, Decimal]]:
    grouped: dict[str, tuple[Decimal, Decimal]] = {}
    for row in rows:
        bucket = str(getattr(row, key))
        kg, fee = grouped.get(bucket, (Decimal("0"), Decimal("0")))
        grouped[bucket] = (kg + row.quantity_kg, fee + row.inbound_fee_krw)
    return grouped


def _totals(rows: list[LandfillInboundMonthly]) -> tuple[Decimal, Decimal]:
    total_kg = sum((r.quantity_kg for r in rows), Decimal("0"))
    total_fee = sum((r.inbound_fee_krw for r in rows), Decimal("0"))
    return total_kg, total_fee


@router.get("/summary", response_model=LandfillSummaryOut)
def landfill_summary(
    session: SessionDep,
    year: int | None = Query(default=None, ge=1990, le=2100),
    month: int | None = _MONTH_QUERY,
    origin: OriginParam = None,
    waste_name: WasteNameParam = None,
) -> LandfillSummaryOut:
    period, resolved_year, month_str = _resolve_period(session, year, month)
    origin_code = _CANONICAL_BY_SGIS[origin] if origin is not None else None
    rows = _query(
        session,
        year=resolved_year if month_str is None else None,
        month_str=month_str,
        origin_code=origin_code,
        waste_name=waste_name,
    )
    total_kg, total_fee = _totals(rows)

    origin_shares = [
        _origin_share(code, kg, fee, total_kg)
        for code, (kg, fee) in sorted(
            _group(rows, "origin_region_code").items(), key=lambda kv: kv[1][0], reverse=True
        )
    ]
    waste_shares = [
        _waste_share(name, kg, fee, total_kg)
        for name, (kg, fee) in sorted(
            _group(rows, "waste_name").items(), key=lambda kv: kv[1][0], reverse=True
        )
    ]
    return LandfillSummaryOut(
        period=period,
        origin_filter=origin,
        waste_filter=waste_name,
        accounting_basis=ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW,
        destination_code=DESTINATION_CODE,
        destination_name=DESTINATION_NAME,
        total_quantity_kg=total_kg,
        total_quantity_tons=landfill_analysis.to_tons(total_kg),
        total_inbound_fee_krw=total_fee,
        effective_fee_per_ton=landfill_analysis.effective_fee_per_ton(total_fee, total_kg),
        largest_origin_share=origin_shares[0] if origin_shares else None,
        largest_waste_share=waste_shares[0] if waste_shares else None,
        origin_shares=origin_shares,
        top_waste_types=waste_shares[:10],
        row_count=len(rows),
        evidence=_evidence(),
        sources=_sources(session, rows),
        derivation_version=landfill_analysis.DERIVATION_VERSION,
        caveats=CAVEATS,
    )


@router.get("/trends", response_model=LandfillTrendsOut)
def landfill_trends(
    session: SessionDep,
    start_month: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
    end_month: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
    origin: OriginParam = None,
    waste_name: WasteNameParam = None,
) -> LandfillTrendsOut:
    months = _distinct_months(session)
    if not months:
        raise _not_found(
            UnavailableDataError(
                error="NO_DATA_AVAILABLE",
                detail="No landfill inbound data has been ingested.",
            )
        )
    # Default window: the latest complete year (Jan–Dec).
    default_year = landfill_analysis.latest_complete_year(months)
    resolved_start = start_month or f"{default_year:04d}-01"
    resolved_end = end_month or f"{default_year:04d}-12"
    origin_code = _CANONICAL_BY_SGIS[origin] if origin is not None else None
    rows = _query(
        session,
        start_month=resolved_start,
        end_month=resolved_end,
        origin_code=origin_code,
        waste_name=waste_name,
    )
    grouped: dict[str, tuple[Decimal, Decimal]] = {}
    for row in rows:
        kg, fee = grouped.get(row.reference_month, (Decimal("0"), Decimal("0")))
        grouped[row.reference_month] = (kg + row.quantity_kg, fee + row.inbound_fee_krw)
    points = [
        LandfillTrendPoint(
            reference_month=month,
            reference_year=int(month[:4]),
            quantity_kg=kg,
            quantity_tons=landfill_analysis.to_tons(kg),
            inbound_fee_krw=fee,
            effective_fee_per_ton=landfill_analysis.effective_fee_per_ton(fee, kg),
        )
        for month, (kg, fee) in sorted(grouped.items())
    ]
    return LandfillTrendsOut(
        start_month=resolved_start,
        end_month=resolved_end,
        origin_filter=origin,
        waste_filter=waste_name,
        accounting_basis=ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW,
        points=points,
        evidence=_evidence(),
        sources=_sources(session, rows),
        derivation_version=landfill_analysis.DERIVATION_VERSION,
        caveats=CAVEATS,
    )


@router.get("/composition", response_model=LandfillCompositionOut)
def landfill_composition(
    session: SessionDep,
    year: int | None = Query(default=None, ge=1990, le=2100),
    origin: OriginParam = None,
) -> LandfillCompositionOut:
    period, resolved_year, _ = _resolve_period(session, year, None)
    origin_code = _CANONICAL_BY_SGIS[origin] if origin is not None else None
    rows = _query(session, year=resolved_year, origin_code=origin_code)
    total_kg, total_fee = _totals(rows)
    waste_shares = [
        _waste_share(name, kg, fee, total_kg)
        for name, (kg, fee) in sorted(
            _group(rows, "waste_name").items(), key=lambda kv: kv[1][0], reverse=True
        )
    ]
    return LandfillCompositionOut(
        period=period,
        origin_filter=origin,
        accounting_basis=ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW,
        total_quantity_kg=total_kg,
        total_quantity_tons=landfill_analysis.to_tons(total_kg),
        total_inbound_fee_krw=total_fee,
        waste_types=waste_shares,
        evidence=_evidence(),
        sources=_sources(session, rows),
        derivation_version=landfill_analysis.DERIVATION_VERSION,
        caveats=CAVEATS,
    )


@router.get("/flows", response_model=LandfillFlowsOut)
def landfill_flows(
    session: SessionDep,
    year: int | None = Query(default=None, ge=1990, le=2100),
    month: int | None = _MONTH_QUERY,
    waste_name: WasteNameParam = None,
) -> LandfillFlowsOut:
    period, resolved_year, month_str = _resolve_period(session, year, month)
    rows = _query(
        session,
        year=resolved_year if month_str is None else None,
        month_str=month_str,
        waste_name=waste_name,
    )
    total_kg, total_fee = _totals(rows)
    grouped = _group(rows, "origin_region_code")
    # Only the three metropolitan origins can ever appear; no municipal rows.
    flows = [
        LandfillFlow(
            origin_region_code=code,
            origin_sgis_code=_ORIGIN_META[code].sgis,
            origin_name=_ORIGIN_META[code].name,
            origin_name_en=_ORIGIN_META[code].name_en,
            origin_point=LandfillPoint(lon=_ORIGIN_META[code].lon, lat=_ORIGIN_META[code].lat),
            destination_code=DESTINATION_CODE,
            destination_name=DESTINATION_NAME,
            destination_name_en=DESTINATION_NAME_EN,
            destination_point=DESTINATION_POINT,
            quantity_kg=kg,
            quantity_tons=landfill_analysis.to_tons(kg),
            inbound_fee_krw=fee,
            quantity_share=landfill_analysis.share(kg, total_kg),
            effective_fee_per_ton=landfill_analysis.effective_fee_per_ton(fee, kg),
            evidence_status=landfill_analysis.EVIDENCE_OFFICIAL_REPORTED,
        )
        for code, (kg, fee) in sorted(grouped.items(), key=lambda kv: kv[1][0], reverse=True)
    ]
    return LandfillFlowsOut(
        period=period,
        waste_filter=waste_name,
        origin_level=ORIGIN_LEVEL_METROPOLITAN,
        origin_level_label=ORIGIN_LEVEL_LABEL,
        total_quantity_kg=total_kg,
        total_quantity_tons=landfill_analysis.to_tons(total_kg),
        total_inbound_fee_krw=total_fee,
        accounting_basis=ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW,
        flows=flows,
        destination=LandfillDestinationNode(
            code=DESTINATION_CODE,
            name=DESTINATION_NAME,
            name_en=DESTINATION_NAME_EN,
            point=DESTINATION_POINT,
            coordinate_provenance=DESTINATION_COORDINATE_PROVENANCE,
        ),
        evidence=_evidence(),
        sources=_sources(session, rows),
        derivation_version=landfill_analysis.DERIVATION_VERSION,
        caveats=CAVEATS,
    )
