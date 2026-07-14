"""Response schemas for the capital-region Sudokwon Landfill inbound-flow API.

Plain snake_case models. Official quantities/fees are exact ``Decimal``; the only
derived value is ``effective_fee_per_ton`` (nullable at zero quantity). Every
response carries source provenance, evidence labels, the accounting basis, and
the metropolitan-only + fee caveats.
"""

from decimal import Decimal

from pydantic import BaseModel


class LandfillPoint(BaseModel):
    """A schematic flow-node position (representative, not a precise boundary)."""

    lon: float
    lat: float


class LandfillSourceRef(BaseModel):
    dataset_id: str
    official_dataset_name: str
    snapshot_uuid: str | None
    snapshot_date: str | None


class LandfillEvidence(BaseModel):
    quantity_status: str  # OFFICIAL_REPORTED_VALUE
    fee_status: str  # OFFICIAL_REPORTED_VALUE
    derived_status: str  # OFFICIAL_INPUTS_DERIVED_VALUE (aggregates / effective fee)
    notes: list[str]


class LandfillPeriod(BaseModel):
    year: int
    month: str | None  # YYYY-MM when a single month is selected
    is_complete_year: bool
    available_through_month: str | None
    latest_available_month: str | None
    available_years: list[int]


class LandfillOriginShare(BaseModel):
    origin_region_code: str  # canonical KR-SGIS-11/28/41
    origin_sgis_code: str  # bare SGIS sido code 11/28/41
    origin_name: str  # 서울시 / 인천시 / 경기도
    origin_name_en: str  # Seoul / Incheon / Gyeonggi
    quantity_kg: Decimal
    quantity_tons: Decimal
    inbound_fee_krw: Decimal
    quantity_share: Decimal | None
    effective_fee_per_ton: Decimal | None


class LandfillWasteShare(BaseModel):
    waste_name: str
    quantity_kg: Decimal
    quantity_tons: Decimal
    inbound_fee_krw: Decimal
    quantity_share: Decimal | None
    effective_fee_per_ton: Decimal | None


class LandfillSummaryOut(BaseModel):
    period: LandfillPeriod
    origin_filter: str | None  # bare SGIS sido code or None
    waste_filter: str | None
    accounting_basis: str
    destination_code: str
    destination_name: str
    total_quantity_kg: Decimal
    total_quantity_tons: Decimal
    total_inbound_fee_krw: Decimal
    effective_fee_per_ton: Decimal | None
    largest_origin_share: LandfillOriginShare | None
    largest_waste_share: LandfillWasteShare | None
    origin_shares: list[LandfillOriginShare]
    top_waste_types: list[LandfillWasteShare]
    row_count: int
    evidence: LandfillEvidence
    sources: list[LandfillSourceRef]
    derivation_version: str
    caveats: list[str]


class LandfillTrendPoint(BaseModel):
    reference_month: str
    reference_year: int
    quantity_kg: Decimal
    quantity_tons: Decimal
    inbound_fee_krw: Decimal
    effective_fee_per_ton: Decimal | None


class LandfillTrendsOut(BaseModel):
    start_month: str
    end_month: str
    origin_filter: str | None
    waste_filter: str | None
    accounting_basis: str
    points: list[LandfillTrendPoint]
    evidence: LandfillEvidence
    sources: list[LandfillSourceRef]
    derivation_version: str
    caveats: list[str]


class LandfillCompositionOut(BaseModel):
    period: LandfillPeriod
    origin_filter: str | None
    accounting_basis: str
    total_quantity_kg: Decimal
    total_quantity_tons: Decimal
    total_inbound_fee_krw: Decimal
    waste_types: list[LandfillWasteShare]
    evidence: LandfillEvidence
    sources: list[LandfillSourceRef]
    derivation_version: str
    caveats: list[str]


class LandfillFlow(BaseModel):
    origin_region_code: str
    origin_sgis_code: str
    origin_name: str
    origin_name_en: str
    origin_point: LandfillPoint
    destination_code: str
    destination_name: str
    destination_name_en: str
    destination_point: LandfillPoint
    quantity_kg: Decimal
    quantity_tons: Decimal
    inbound_fee_krw: Decimal
    quantity_share: Decimal | None
    effective_fee_per_ton: Decimal | None
    evidence_status: str


class LandfillDestinationNode(BaseModel):
    code: str
    name: str
    name_en: str
    point: LandfillPoint
    coordinate_provenance: str


class LandfillFlowsOut(BaseModel):
    period: LandfillPeriod
    waste_filter: str | None
    origin_level: str  # SIDO — metropolitan-only marker
    origin_level_label: str  # human label reinforcing metropolitan-only
    total_quantity_kg: Decimal
    total_quantity_tons: Decimal
    total_inbound_fee_krw: Decimal
    accounting_basis: str
    flows: list[LandfillFlow]  # at most three (Seoul / Gyeonggi / Incheon)
    destination: LandfillDestinationNode
    evidence: LandfillEvidence
    sources: list[LandfillSourceRef]
    derivation_version: str
    caveats: list[str]
