"""Response schemas for the capital-region Sudokwon Landfill inbound-flow API.

Plain snake_case models. Official quantities/fees are exact ``Decimal``; the
derived values are ``effective_fee_per_ton`` (nullable at zero quantity) and the
nested ``fee_per_capita`` derivation (nullable, with a served reason, whenever a
valid same-reference-year metropolitan population is unavailable). Every
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


class LandfillFeePerCapita(BaseModel):
    """Derived inbound fee per resident, with both inputs' provenance.

    ``fee_per_capita_krw`` and ``unavailable_reason`` are mutually exclusive: a
    value is served only when the official MOIS monthly population exists for
    **exactly** the month the selected period requires
    (``required_population_month``). It is never zero-filled, estimated, or
    borrowed from another period, and never an amount any resident actually paid.
    """

    indicator: str  # LANDFILL_INBOUND_FEE_PER_CAPITA
    fee_per_capita_krw: Decimal | None
    unit: str  # KRW/인
    derivation_version: str  # landfill-fee-per-capita-v2
    derivation_formula: str
    evidence_status: str  # OFFICIAL_INPUTS_DERIVED_VALUE
    # Numerator (official reported inbound fee) and its reference period.
    inbound_fee_krw: Decimal
    fee_reference_year: int
    fee_reference_period: str  # YYYY (annual) or YYYY-MM (single month)
    fee_period_complete: bool  # a complete landfill year vs. a partial one
    # The single month whose population may serve as this period's denominator:
    # the selected month, December of a complete year, or the final month
    # actually included in a partial year's fee.
    required_population_month: str | None
    # Denominator (official population) — null whenever unavailable_reason is set.
    population: int | None
    population_reference_month: str | None
    population_reference_year: int | None
    population_reference_period: str | None
    population_temporal_granularity: str | None
    population_definition: str | None
    population_definition_version: str | None
    population_comparability_note: str | None
    population_source_id: str | None
    population_source_dataset_id: str | None
    population_source_administrative_code: str | None
    population_region_level: str | None
    population_unit: str | None
    # Landfill origin codes whose fee is in the numerator (three for 전체).
    included_origin_region_codes: list[str]
    unavailable_reason: str | None
    interpretation_caveat: str
    # Retained so an existing consumer of the v1 field keeps working; identical
    # to interpretation_caveat.
    caveat: str


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
    fee_per_capita: LandfillFeePerCapita


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
    # Aggregate over every origin in scope: Σ fee ÷ Σ same-year population.
    # Never the average of the per-origin values.
    fee_per_capita: LandfillFeePerCapita
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
