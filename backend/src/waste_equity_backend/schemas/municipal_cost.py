"""Response schemas for the 2024 municipal waste-cost endpoint.

Every nullable numeric field means "no defensible value exists" and is served as
``null`` — never 0. The response metadata states, in full, that this is **not**
the official Sudokwon Landfill inbound-fee dataset, so a consumer that only ever
reads the payload cannot mistake one for the other.
"""

from decimal import Decimal

from pydantic import BaseModel


class MunicipalCostPopulationComponent(BaseModel):
    """One constituent 일반구 behind a derived city population."""

    region_code: str
    region_name: str
    population: int


class MunicipalCostSourceRef(BaseModel):
    """One workbook that resolved to this municipality."""

    filename: str
    dataset_role: str  # DATA_A | DATA_B
    layout_family: str
    primary_classification: str
    resolution_basis: str
    sha256: str


class MunicipalCostQuantityCoverage(BaseModel):
    """What tonnage evidence exists — never an input to the payment indicator."""

    observation_count: int
    measured_count: int
    measured_zero_count: int
    missing_count: int
    repeated_municipal_block_count: int
    months_covered: int
    waste_categories: list[str]


class MunicipalCostRow(BaseModel):
    municipality_key: str
    display_name: str
    metropolitan_code: str  # 11 서울 / 28 인천 / 41 경기
    metropolitan_name: str
    # Canonical ``regions`` code when the municipality exists at this grain;
    # null for the seven Gyeonggi cities stored only as 일반구.
    direct_region_code: str | None
    boundary_vintage: str  # always 2024 in this release
    population: int | None
    population_method: str  # DIRECT_REGION_POPULATION | DERIVED_SUM_OF_CONSTITUENT_WARDS
    population_definition: str | None
    population_components: list[MunicipalCostPopulationComponent]
    total_eligible_payment_krw: Decimal | None
    eligible_contract_count: int
    payment_per_capita_krw: Decimal | None
    status: str  # AVAILABLE | PARTIAL | UNAVAILABLE
    evidence_status: str
    reason_codes: list[str]
    limitations: list[str]
    source_files: list[MunicipalCostSourceRef]
    has_data_a: bool
    has_data_b: bool
    quantity_coverage: MunicipalCostQuantityCoverage


class MunicipalCostSourceCoverage(BaseModel):
    discovered_file_count: int
    accepted_file_count: int
    rejected_file_count: int
    data_a_file_count: int
    data_b_file_count: int
    municipalities_with_data_a: int
    municipalities_with_data_b: int
    municipalities_with_no_source_file: int


class MunicipalCostRejectedSource(BaseModel):
    filename: str
    dataset_role: str
    reason_codes: list[str]
    explanation: str | None


class MunicipalCostMeta(BaseModel):
    indicator_code: str
    display_name: str  # Korean display name
    description: str
    reference_year: int
    unit: str  # KRW/인
    accounting_basis: str
    methodology_version: str
    geography_policy: str
    population_policy: str
    numerator_definition: str
    # The explicit statement that this is a different dataset, different
    # provider, and a different accounting basis from the official metropolitan
    # Sudokwon Landfill inbound fee.
    difference_from_official_landfill_fee: str
    is_official_landfill_fee: bool  # always False
    expected_count: int
    available_count: int
    partial_count: int
    unavailable_count: int
    returned_count: int
    rejected_source_file_count: int
    rejected_source_files: list[MunicipalCostRejectedSource]
    source_coverage: MunicipalCostSourceCoverage
    caveats: list[str]


class MunicipalCostOut(BaseModel):
    meta: MunicipalCostMeta
    sido_filter: str | None
    status_filter: str | None
    sort: str
    municipalities: list[MunicipalCostRow]
