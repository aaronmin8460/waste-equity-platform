"""Response schemas for the facility cost model API (Phase 4 V1).

Every monetary value serializes as an exact decimal string (Pydantic renders
``Decimal`` losslessly). The calculate response is explicitly a PARTIAL standard
construction-cost analysis: it carries completeness metadata listing the
components that are deliberately not included, a per-capita share that is ``null``
plus a reason when no valid population denominator exists, and a disclaimer. No
field is ever named "총비용"/total cost.
"""

import datetime
from decimal import Decimal

from pydantic import BaseModel


class StandardCostBandOut(BaseModel):
    facility_type: str
    capacity_min_ton_per_day: Decimal | None
    capacity_min_inclusive: bool
    capacity_max_ton_per_day: Decimal | None
    capacity_max_inclusive: bool
    cost_per_capacity_bn: Decimal
    cost_per_capacity_unit: str


class StandardCostVersionOut(BaseModel):
    cost_version: str
    price_base_date: datetime.date
    source_document: str
    source_page: str
    source_note: str | None
    facility_types: list[str]
    bands: list[StandardCostBandOut]


class StandardsEnvelope(BaseModel):
    derivation_version: str
    active_cost_version: str
    count: int
    versions: list[StandardCostVersionOut]
    disclaimer: str


class LabelledOption(BaseModel):
    value: str
    label: str


class SubsidyOption(BaseModel):
    value: str
    label: str
    rate: Decimal


class UndergroundMultiplierOption(BaseModel):
    min: Decimal
    max: Decimal
    default: Decimal
    note: str


class OptionsOut(BaseModel):
    derivation_version: str
    facility_types: list[LabelledOption]
    subsidy_schemes: list[SubsidyOption]
    underground_multiplier: UndergroundMultiplierOption
    default_operating_days: int
    cost_versions: list[str]
    active_cost_version: str
    disclaimer: str


# --------------------------------------------------------------------------- #
# calculate response sections
# --------------------------------------------------------------------------- #


class ScenarioOut(BaseModel):
    facility_type: str
    facility_type_label: str
    processing_share: Decimal
    processing_share_percent: Decimal
    operating_days_per_year: int
    underground_multiplier: Decimal
    underground_multiplier_note: str
    subsidy_scheme: str
    subsidy_scheme_label: str
    subsidy_rate: Decimal
    cost_version: str


class OfficialInputRegion(BaseModel):
    region_code: str
    region_name: str
    generation_quantity_ton: Decimal
    population: int | None


class OfficialInputOut(BaseModel):
    waste_stream: str
    reference_year: int
    waste_reference_period: str
    accounting_basis: str
    waste_source_id: str
    waste_official_dataset_name: str
    quantity_unit: str
    official_annual_quantity_ton: Decimal
    service_region_codes: list[str]
    regions: list[OfficialInputRegion]
    # Population provenance (null when the per-capita denominator is unavailable).
    population_source_id: str | None
    population_reference_period: str | None
    population_definition: str | None
    official_service_population: int | None


class CapacityOut(BaseModel):
    annual_service_quantity_ton: Decimal
    operating_days_per_year: int
    facility_capacity_ton_per_day: Decimal
    capacity_unit: str


class StandardCostOut(BaseModel):
    term_ko: str
    matched_band: StandardCostBandOut
    standard_unit_cost_bn_per_tpd: Decimal
    underground_multiplier: Decimal
    standard_construction_cost_bn: Decimal
    unit: str


class AnnualizationOut(BaseModel):
    term_ko: str
    facility_lifetime_years: int
    annualized_construction_cost_bn: Decimal
    unit: str
    method: str


class SubsidyOut(BaseModel):
    subsidy_scheme: str
    subsidy_scheme_label: str
    subsidy_rate: Decimal
    # Source + reference period for the nominal rate (AGENTS.md), and its basis.
    rate_source: str
    rate_reference_period: str
    rate_basis: str
    estimated_national_subsidy_bn: Decimal
    simplified_local_government_share_bn: Decimal
    unit: str
    note: str


class PerCapitaOut(BaseModel):
    term_ko: str
    per_capita_local_share_won: Decimal | None
    official_service_population: int | None
    unavailable_reason: str | None
    unit: str
    caveat: str


class CandidateContextOut(BaseModel):
    candidate_id: int
    candidate_key: str | None
    sido_region_name: str | None
    sigungu_region_name: str | None
    suitability_status: str | None
    run_id: int | None
    profile: str | None
    note: str
    suitability_disclaimer: str


class MissingComponent(BaseModel):
    component: str
    reason: str


class CompletenessOut(BaseModel):
    is_partial: bool
    included_components: list[str]
    missing_components: list[MissingComponent]


class ProvenanceOut(BaseModel):
    derivation_version: str
    cost_version: str
    price_base_date: datetime.date
    source_document: str
    source_page: str
    subsidy_rate_source: str
    subsidy_rate_reference_period: str


class FacilityCostCalculateOut(BaseModel):
    scenario: ScenarioOut
    official_input: OfficialInputOut
    capacity: CapacityOut
    standard_cost: StandardCostOut
    annualization: AnnualizationOut
    subsidy: SubsidyOut
    per_capita: PerCapitaOut
    candidate_context: CandidateContextOut | None
    completeness: CompletenessOut
    provenance: ProvenanceOut
    assumptions: list[str]
    disclaimer: str
