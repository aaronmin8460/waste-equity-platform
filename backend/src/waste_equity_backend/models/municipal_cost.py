"""2024 municipal waste collection-and-transport contract payments (Step 2).

These tables hold **municipal contract payments disclosed by individual local
governments** — a different accounting basis, a different grain, and a different
provider from the official Sudokwon Landfill inbound datasets in
``landfill_inbound_monthly``. Nothing here is an official landfill inbound fee:

- ``landfill_inbound_monthly`` = 수도권매립지관리공사 반입수수료, **metropolitan**
  origin only (서울시/인천시/경기도), accounting basis
  ``VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW``, never disaggregated to a
  city/county/district.
- these tables = 지자체 생활폐기물 **수집·운반 대행 계약 지급액**, city/county/district
  grain, accounting basis ``MUNICIPAL_CONTRACTED_COLLECTION_TRANSPORT_PAYMENT``,
  destinations mixed (incinerator, recycling sorting, food-waste plant, landfill,
  private processor).

The two are **never** summed, differenced, ratioed, or presented as the same
number, and a municipal row is never written to ``landfill_inbound_monthly``
(whose origin CHECK constraint would reject it anyway).

Six additive tables:

``municipal_cost_geographies``
    The 2024 analytical municipality registry — exactly 66 rows (서울 25 자치구 +
    인천 10 (2024 geography) + 경기 31 시·군). The seven Gyeonggi cities that exist
    in ``regions`` only at 일반구 grain get one city-level analytical row whose
    population is the **exact sum** of its constituent wards' 2024 SGIS annual
    populations (``DERIVED_SUM_OF_CONSTITUENT_WARDS``). No ``regions`` row is
    added, renamed, or invalidated, and no synthetic geometry is created.
``municipal_cost_geography_components``
    The constituent ward rows behind a derived city population, with each ward's
    stored 2024 population, so the sum is reproducible from the database alone.
``municipal_cost_source_files``
    One row per discovered workbook, **including rejected ones** — a rejected
    workbook keeps its provenance and its rejection reasons and contributes no
    observation.
``municipal_waste_contracts``
    One row per source contract header row (the payment grain).
``municipal_waste_quantities``
    One row per **logical** quantity observation, deliberately separate from
    payments. A city-wide block copied under every contract row is stored once
    with ``attribution = MUNICIPAL_TOTAL_REPEATED_PER_CONTRACT`` and every
    repetition's source row recorded, so a later SUM can never multiply a city's
    tonnage by its contract count.
``municipal_cost_indicator_values``
    The served indicator, one row per municipality × indicator × year × method
    version — written for all 66 municipalities including the unavailable ones,
    whose value is NULL and never 0.
"""

import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .metadata import JsonVariant

# --------------------------------------------------------------------------
# Indicator identity
# --------------------------------------------------------------------------

# The single primary indicator of this release. The name is deliberately long:
# the numerator measures **collection-and-transport contract payments only**, and
# is not an official landfill fee, not a Sudokwon Landfill inbound fee, not total
# municipal waste-management expenditure, and not a waste-disposal fee.
MUNICIPAL_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA = (
    "MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA"
)
INDICATOR_DISPLAY_NAME_KO = "주민 1인당 생활폐기물 수집·운반 계약 지급액"
INDICATOR_DESCRIPTION_KO = (
    "2024년 지자체 생활폐기물 수집·운반 계약의 확인된 실제 지급액을 동일 행정구역의 "
    "2024년 인구로 나눈 분석 지표"
)
INDICATOR_UNIT = "KRW/인"
INDICATOR_NUMERATOR_DEFINITION_KO = (
    "DATA_A 계약 헤더 행의 '총 금액(총 지급액)'(서구 원본은 '총 금액(원)') 중 실제 "
    "지급액으로 확인된 값의 합계입니다. 합계(소계) 행, DATA_B 값, 계약금액(낙찰금액), "
    "예산·예상금액, 별도 지급 원장, 텍스트('확인 불가')는 제외합니다."
)
INDICATOR_DIFFERENCE_FROM_OFFICIAL_LANDFILL_FEE_KO = (
    "이 지표는 수도권매립지 공식 반입수수료(LANDFILL_INBOUND_FEE_PER_CAPITA)와 다른 "
    "회계 기준입니다. 공식 반입수수료는 수도권매립지관리공사가 광역지자체(서울시·인천시·"
    "경기도) 단위로 보고한 반입수수료이며, 이 지표는 개별 기초지자체가 공개한 생활폐기물 "
    "수집·운반 대행 계약의 지급액입니다. 두 값은 합산·차감·비율 계산 대상이 아닙니다."
)

# Accounting basis — a distinct fourth basis, never merged with
# VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW, ORIGIN_BASED_TREATMENT_OUTCOME,
# or FACILITY_LOCATION_BASED_THROUGHPUT.
ACCOUNTING_BASIS_MUNICIPAL_CONTRACT_PAYMENT = "MUNICIPAL_CONTRACTED_COLLECTION_TRANSPORT_PAYMENT"

METHODOLOGY_VERSION = "municipal-collection-transport-payment-per-capita-v1"
TRANSFORMATION_VERSION = "municipal-cost-v1"

# Local-government information-disclosure workbooks (정보공개청구 회신). Not a
# government open-data API and not an official statistical publication.
SOURCE_ID = "municipal_waste_cost_disclosure"

REFERENCE_YEAR = 2024
BOUNDARY_VINTAGE = "2024"
CURRENCY_KRW = "KRW"
QUANTITY_UNIT_TONNE = "TONNE"

# --------------------------------------------------------------------------
# Vocabularies
# --------------------------------------------------------------------------

STATUS_AVAILABLE = "AVAILABLE"
STATUS_PARTIAL = "PARTIAL"
STATUS_UNAVAILABLE = "UNAVAILABLE"
INDICATOR_STATUSES = (STATUS_AVAILABLE, STATUS_PARTIAL, STATUS_UNAVAILABLE)

# Evidence classes. Municipal disclosures are *local government* reported values,
# deliberately distinct from the OFFICIAL_* classes used for national/odcloud
# datasets so a reader can never mistake one for the other.
EVIDENCE_LOCAL_GOVERNMENT_REPORTED = "LOCAL_GOVERNMENT_REPORTED_VALUE"
EVIDENCE_LOCAL_GOVERNMENT_DERIVED = "LOCAL_GOVERNMENT_SOURCE_INPUTS_DERIVED_VALUE"
# Population inputs come from the official SGIS series, so a derived city
# population is an official-inputs derivation.
EVIDENCE_OFFICIAL_REPORTED = "OFFICIAL_REPORTED_VALUE"
EVIDENCE_OFFICIAL_DERIVED = "OFFICIAL_INPUTS_DERIVED_VALUE"
EVIDENCE_STATUSES = (
    EVIDENCE_LOCAL_GOVERNMENT_REPORTED,
    EVIDENCE_LOCAL_GOVERNMENT_DERIVED,
    EVIDENCE_OFFICIAL_REPORTED,
    EVIDENCE_OFFICIAL_DERIVED,
)

# Only ACTUAL_PAID_AMOUNT may enter the primary numerator.
PAYMENT_ACTUAL_PAID = "ACTUAL_PAID_AMOUNT"
PAYMENT_CONTRACT_AWARD = "CONTRACT_AWARD_AMOUNT"
PAYMENT_BUDGET_ESTIMATE = "BUDGET_ESTIMATE"
PAYMENT_TYPES = (PAYMENT_ACTUAL_PAID, PAYMENT_CONTRACT_AWARD, PAYMENT_BUDGET_ESTIMATE)

WASTE_SCOPE_ALL_MUNICIPAL = "ALL_MUNICIPAL"
WASTE_SCOPE_GENERAL_ONLY = "GENERAL_ONLY"
WASTE_SCOPE_FOOD_ONLY = "FOOD_ONLY"
WASTE_SCOPE_RECYCLING_ONLY = "RECYCLING_ONLY"
WASTE_SCOPE_MIXED_PARTIAL = "MIXED_PARTIAL"
WASTE_SCOPE_UNKNOWN = "UNKNOWN"
WASTE_SCOPES = (
    WASTE_SCOPE_ALL_MUNICIPAL,
    WASTE_SCOPE_GENERAL_ONLY,
    WASTE_SCOPE_FOOD_ONLY,
    WASTE_SCOPE_RECYCLING_ONLY,
    WASTE_SCOPE_MIXED_PARTIAL,
    WASTE_SCOPE_UNKNOWN,
)

GEOGRAPHIC_SCOPE_WHOLE = "WHOLE_MUNICIPALITY"
GEOGRAPHIC_SCOPE_SUB = "SUB_MUNICIPAL"
GEOGRAPHIC_SCOPES = (GEOGRAPHIC_SCOPE_WHOLE, GEOGRAPHIC_SCOPE_SUB)

COMPLETENESS_COMPLETE = "COMPLETE"
COMPLETENESS_PARTIAL = "PARTIAL"
COMPLETENESS_UNUSABLE = "UNUSABLE"
COMPLETENESS_STATUSES = (COMPLETENESS_COMPLETE, COMPLETENESS_PARTIAL, COMPLETENESS_UNUSABLE)

# Quantity value states. The CHECK constraint built from these is the
# schema-level guarantee that a missing value is never stored as numeric zero and
# a measured zero is never stored as missing.
VALUE_MEASURED = "MEASURED"
VALUE_MEASURED_ZERO = "MEASURED_ZERO"
VALUE_SOURCE_DASH_NO_DATA = "SOURCE_DASH_NO_DATA"
VALUE_SOURCE_TEXT_NO_DATA = "SOURCE_TEXT_NO_DATA"
VALUE_BLANK = "BLANK"
VALUE_STATES = (
    VALUE_MEASURED,
    VALUE_MEASURED_ZERO,
    VALUE_SOURCE_DASH_NO_DATA,
    VALUE_SOURCE_TEXT_NO_DATA,
    VALUE_BLANK,
)
VALUE_STATES_WITHOUT_NUMBER = (
    VALUE_SOURCE_DASH_NO_DATA,
    VALUE_SOURCE_TEXT_NO_DATA,
    VALUE_BLANK,
)

# How a quantity relates to the contract row it was read under.
ATTRIBUTION_PER_CONTRACT = "PER_CONTRACT"
ATTRIBUTION_MUNICIPAL_TOTAL_REPEATED = "MUNICIPAL_TOTAL_REPEATED_PER_CONTRACT"
ATTRIBUTION_MUNICIPAL_TOTAL_SINGLE = "MUNICIPAL_TOTAL_SINGLE"
ATTRIBUTION_UNKNOWN = "UNKNOWN"
ATTRIBUTIONS = (
    ATTRIBUTION_PER_CONTRACT,
    ATTRIBUTION_MUNICIPAL_TOTAL_REPEATED,
    ATTRIBUTION_MUNICIPAL_TOTAL_SINGLE,
    ATTRIBUTION_UNKNOWN,
)

QUANTITY_PERIOD_MONTHLY = "MONTHLY"
QUANTITY_PERIOD_ANNUAL = "ANNUAL"
QUANTITY_PERIOD_MONTHLY_AVERAGE = "MONTHLY_AVERAGE"
QUANTITY_PERIOD_UNSPECIFIED = "UNSPECIFIED"
QUANTITY_PERIODS = (
    QUANTITY_PERIOD_MONTHLY,
    QUANTITY_PERIOD_ANNUAL,
    QUANTITY_PERIOD_MONTHLY_AVERAGE,
    QUANTITY_PERIOD_UNSPECIFIED,
)

WASTE_CATEGORY_GENERAL = "GENERAL"
WASTE_CATEGORY_FOOD = "FOOD"
WASTE_CATEGORY_RECYCLING = "RECYCLING"
WASTE_CATEGORY_BULKY = "BULKY"
WASTE_CATEGORY_COMBINED = "COMBINED"
WASTE_CATEGORY_UNKNOWN = "UNKNOWN"
WASTE_CATEGORIES = (
    WASTE_CATEGORY_GENERAL,
    WASTE_CATEGORY_FOOD,
    WASTE_CATEGORY_RECYCLING,
    WASTE_CATEGORY_BULKY,
    WASTE_CATEGORY_COMBINED,
    WASTE_CATEGORY_UNKNOWN,
)

# Population methods. MOIS monthly population is metropolitan-only and is never
# used here; no year is borrowed, nothing is interpolated, and there is no
# metropolitan fallback.
POPULATION_DIRECT = "DIRECT_REGION_POPULATION"
POPULATION_DERIVED_WARD_SUM = "DERIVED_SUM_OF_CONSTITUENT_WARDS"
POPULATION_METHODS = (POPULATION_DIRECT, POPULATION_DERIVED_WARD_SUM)
POPULATION_DEFINITION_SGIS = "SGIS_TOTAL_POPULATION"

MUNICIPALITY_LEVEL_SIGUNGU = "SIGUNGU"

DATASET_ROLE_A = "DATA_A"
DATASET_ROLE_B = "DATA_B"
DATASET_ROLES = (DATASET_ROLE_A, DATASET_ROLE_B)

INGESTION_DECISION_ACCEPTED = "ACCEPTED"
INGESTION_DECISION_REJECTED = "REJECTED"
INGESTION_DECISIONS = (INGESTION_DECISION_ACCEPTED, INGESTION_DECISION_REJECTED)

# --------------------------------------------------------------------------
# Workbook classification vocabularies
# --------------------------------------------------------------------------

# Structural worksheet layout — the seven families found by the Step 1 audit.
LAYOUT_DATA_B_MONTHLY_CATEGORY_GRID = "DATA_B_MONTHLY_CATEGORY_GRID"
LAYOUT_DATA_A_CONTRACT_QUANTITY_PAIRS = "DATA_A_CONTRACT_QUANTITY_PAIRS"
LAYOUT_DATA_A_CONTRACT_WITH_PAYMENT_LEDGER = "DATA_A_CONTRACT_WITH_PAYMENT_LEDGER"
LAYOUT_DATA_A_CONTRACT_NUMBERED_PAIRS = "DATA_A_CONTRACT_NUMBERED_PAIRS"
LAYOUT_DATA_A_CONTRACT_DESTINATION_SPLIT = "DATA_A_CONTRACT_DESTINATION_SPLIT"
LAYOUT_DATA_A_CONTRACT_DASH_ONLY_QUANTITY = "DATA_A_CONTRACT_DASH_ONLY_QUANTITY"
LAYOUT_DATA_A_CONTRACT_TONNE_LABELLED_PAIRS = "DATA_A_CONTRACT_TONNE_LABELLED_PAIRS"
LAYOUT_UNSUPPORTED = "UNSUPPORTED_LAYOUT"
LAYOUT_FAMILIES = (
    LAYOUT_DATA_B_MONTHLY_CATEGORY_GRID,
    LAYOUT_DATA_A_CONTRACT_QUANTITY_PAIRS,
    LAYOUT_DATA_A_CONTRACT_WITH_PAYMENT_LEDGER,
    LAYOUT_DATA_A_CONTRACT_NUMBERED_PAIRS,
    LAYOUT_DATA_A_CONTRACT_DESTINATION_SPLIT,
    LAYOUT_DATA_A_CONTRACT_DASH_ONLY_QUANTITY,
    LAYOUT_DATA_A_CONTRACT_TONNE_LABELLED_PAIRS,
    LAYOUT_UNSUPPORTED,
)

# Semantic classification of what a workbook actually carries.
CLASS_EMPTY_OR_NO_DATA = "EMPTY_OR_NO_DATA"
CLASS_DATA_A_PAYMENT_AND_QUANTITY = "DATA_A_PAYMENT_AND_QUANTITY"
CLASS_DATA_A_PAYMENT_ONLY = "DATA_A_PAYMENT_ONLY"
CLASS_DATA_A_QUANTITY_ONLY = "DATA_A_QUANTITY_ONLY"
CLASS_DATA_A_PARTIAL_WASTE_SCOPE = "DATA_A_PARTIAL_WASTE_SCOPE"
CLASS_DATA_B_QUANTITY_VALIDATION = "DATA_B_QUANTITY_VALIDATION"
CLASS_BOUNDARY_MISMATCH = "BOUNDARY_MISMATCH"
CLASS_AMBIGUOUS_REGION_MAPPING = "AMBIGUOUS_REGION_MAPPING"
CLASS_AMBIGUOUS_SOURCE_MEANING = "AMBIGUOUS_SOURCE_MEANING"
CLASS_UNSUPPORTED_LAYOUT = "UNSUPPORTED_LAYOUT"
PRIMARY_CLASSES = (
    CLASS_EMPTY_OR_NO_DATA,
    CLASS_DATA_A_PAYMENT_AND_QUANTITY,
    CLASS_DATA_A_PAYMENT_ONLY,
    CLASS_DATA_A_QUANTITY_ONLY,
    CLASS_DATA_A_PARTIAL_WASTE_SCOPE,
    CLASS_DATA_B_QUANTITY_VALIDATION,
    CLASS_BOUNDARY_MISMATCH,
    CLASS_AMBIGUOUS_REGION_MAPPING,
    CLASS_AMBIGUOUS_SOURCE_MEANING,
    CLASS_UNSUPPORTED_LAYOUT,
)

# --------------------------------------------------------------------------
# Reason codes (Step 1 audit vocabulary)
# --------------------------------------------------------------------------

REASON_NO_SOURCE_FILE = "NO_SOURCE_FILE"
REASON_MISSING_PAYMENT = "MISSING_PAYMENT"
REASON_MISSING_QUANTITY = "MISSING_QUANTITY"
REASON_MISSING_POPULATION = "MISSING_POPULATION"
REASON_PARTIAL_WASTE_SCOPE = "PARTIAL_WASTE_SCOPE"
REASON_NO_VERIFIED_LANDFILL_QUANTITY = "NO_VERIFIED_LANDFILL_QUANTITY"
REASON_ZERO_TOTAL_QUANTITY = "ZERO_TOTAL_QUANTITY"
REASON_BOUNDARY_MISMATCH = "BOUNDARY_MISMATCH"
REASON_AMBIGUOUS_REGION_MAPPING = "AMBIGUOUS_REGION_MAPPING"
REASON_AMBIGUOUS_SOURCE_MEANING = "AMBIGUOUS_SOURCE_MEANING"
REASON_DUPLICATE_SOURCE_RECORD = "DUPLICATE_SOURCE_RECORD"
REASON_UNSUPPORTED_SOURCE_LAYOUT = "UNSUPPORTED_SOURCE_LAYOUT"
REASON_INCONSISTENT_TOTAL = "INCONSISTENT_TOTAL"
REASON_UNSUPPORTED_UNIT = "UNSUPPORTED_UNIT"
REASON_MIXED_REFERENCE_YEARS = "MIXED_REFERENCE_YEARS"
REASON_PARTIAL_GEOGRAPHIC_SCOPE = "PARTIAL_GEOGRAPHIC_SCOPE"
REASON_PARTIAL_PERIOD_COVERAGE = "PARTIAL_PERIOD_COVERAGE"
REASON_PAYMENT_PERIOD_COVERAGE_INCOMPLETE = "PAYMENT_PERIOD_COVERAGE_INCOMPLETE"
REASON_POST_2024_FILENAME_RESOLVED = "POST_2024_FILENAME_RESOLVED_TO_2024_UNIT"
# A filename that is malformed rather than renamed — the 2024 unit is already
# correct and only the file naming is defective. Kept distinct from
# POST_2024_FILENAME_RESOLVED_TO_2024_UNIT so a reader is never told a
# municipality was renamed when it was not.
REASON_MALFORMED_FILENAME_RESOLVED = "MALFORMED_FILENAME_RESOLVED_BY_WORKBOOK"

REASON_CODES = (
    REASON_NO_SOURCE_FILE,
    REASON_MISSING_PAYMENT,
    REASON_MISSING_QUANTITY,
    REASON_MISSING_POPULATION,
    REASON_PARTIAL_WASTE_SCOPE,
    REASON_NO_VERIFIED_LANDFILL_QUANTITY,
    REASON_ZERO_TOTAL_QUANTITY,
    REASON_BOUNDARY_MISMATCH,
    REASON_AMBIGUOUS_REGION_MAPPING,
    REASON_AMBIGUOUS_SOURCE_MEANING,
    REASON_DUPLICATE_SOURCE_RECORD,
    REASON_UNSUPPORTED_SOURCE_LAYOUT,
    REASON_INCONSISTENT_TOTAL,
    REASON_UNSUPPORTED_UNIT,
    REASON_MIXED_REFERENCE_YEARS,
    REASON_PARTIAL_GEOGRAPHIC_SCOPE,
    REASON_PARTIAL_PERIOD_COVERAGE,
    REASON_PAYMENT_PERIOD_COVERAGE_INCOMPLETE,
    REASON_POST_2024_FILENAME_RESOLVED,
    REASON_MALFORMED_FILENAME_RESOLVED,
)

# Reason codes recording a reviewed, evidence-backed filename resolution. Both are
# informational: the workbook itself names the 2024 unit, so nothing is inferred.
REVIEWED_RESOLUTION_REASONS = (
    REASON_POST_2024_FILENAME_RESOLVED,
    REASON_MALFORMED_FILENAME_RESOLVED,
)

# Reason codes that degrade an otherwise-computable value to PARTIAL. Every other
# code either blocks the value entirely (see UNAVAILABLE_REASONS) or is purely
# informational — notably MISSING_QUANTITY, which cannot degrade a *payment*
# indicator, and the two REVIEWED_RESOLUTION_REASONS, which record a documented,
# reproducible mapping rather than a defect.
PARTIAL_REASONS = (
    REASON_PARTIAL_WASTE_SCOPE,
    REASON_PARTIAL_GEOGRAPHIC_SCOPE,
    REASON_PARTIAL_PERIOD_COVERAGE,
    REASON_PAYMENT_PERIOD_COVERAGE_INCOMPLETE,
)

# Reason codes under which no defensible value exists at all.
UNAVAILABLE_REASONS = (
    REASON_NO_SOURCE_FILE,
    REASON_MISSING_PAYMENT,
    REASON_MISSING_POPULATION,
    REASON_BOUNDARY_MISMATCH,
    REASON_AMBIGUOUS_REGION_MAPPING,
    REASON_AMBIGUOUS_SOURCE_MEANING,
    REASON_UNSUPPORTED_SOURCE_LAYOUT,
)

# --------------------------------------------------------------------------
# Column types — exact decimal only; monetary values never touch binary floats.
# --------------------------------------------------------------------------

PaymentAmount = Numeric(precision=20, scale=2, asdecimal=True)
# Tonnage is reported to at most four decimals in these workbooks. Cached formula
# cells sometimes carry 11-13 decimals of IEEE-754 noise around a two-decimal
# source value (남동구's 432.4299999999999 is 432.43); the parser quantizes to this
# scale with ROUND_HALF_EVEN before storing, so the column holds the source's
# declared precision and no binary artefact.
QUANTITY_DECIMAL_PLACES = 4
QuantityTonnes = Numeric(precision=18, scale=QUANTITY_DECIMAL_PLACES, asdecimal=True)
IndicatorAmount = Numeric(precision=20, scale=4, asdecimal=True)


def _sql_in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{value}'" for value in values) + ")"


class MunicipalCostGeography(Base):
    """One analytical 2024 municipality. Exactly 66 rows for reference year 2024.

    ``direct_region_id`` points at the canonical ``regions`` row for the 59
    municipalities that exist at the required grain. The seven ward-split
    Gyeonggi cities have no such row — their population is the exact sum of the
    ward populations in ``municipal_cost_geography_components`` and
    ``direct_region_id`` stays NULL so the aggregate can never be mistaken for a
    source-reported SGIS region row. No geometry is stored or synthesised, so a
    derived city must not be placed on a map layer that requires boundaries.
    """

    __tablename__ = "municipal_cost_geographies"
    __table_args__ = (
        UniqueConstraint(
            "municipality_key",
            "reference_year",
            name="uq_municipal_cost_geographies_key_year",
        ),
        Index(
            "ix_municipal_cost_geographies_metro_year",
            "metropolitan_code",
            "reference_year",
        ),
        CheckConstraint(
            "population IS NULL OR population >= 0",
            name="population_nonnegative",
        ),
        CheckConstraint(
            f"boundary_vintage = '{BOUNDARY_VINTAGE}'",
            name="boundary_vintage_fixed",
        ),
        CheckConstraint(
            _sql_in("population_method", POPULATION_METHODS),
            name="population_method_allowed",
        ),
        CheckConstraint(
            _sql_in("status", (STATUS_AVAILABLE, STATUS_UNAVAILABLE)),
            name="status_allowed",
        ),
        CheckConstraint(
            _sql_in("evidence_status", EVIDENCE_STATUSES),
            name="evidence_allowed",
        ),
        CheckConstraint(
            _sql_in("municipality_level", (MUNICIPALITY_LEVEL_SIGUNGU,)),
            name="level_allowed",
        ),
        # A direct-population geography must name the region it read; a derived
        # one must not fabricate one.
        CheckConstraint(
            f"(population_method = '{POPULATION_DIRECT}' AND direct_region_id IS NOT NULL)"
            f" OR (population_method = '{POPULATION_DERIVED_WARD_SUM}'"
            " AND direct_region_id IS NULL)",
            name="population_method_consistent",
        ),
        # A usable denominator is strictly positive; an unusable one is NULL,
        # never 0.
        CheckConstraint(
            f"(status = '{STATUS_AVAILABLE}' AND population IS NOT NULL AND population > 0)"
            f" OR (status = '{STATUS_UNAVAILABLE}' AND population IS NULL)",
            name="population_status_consistent",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stable registry key, NFC-normalized: "<metropolitan_code>-<display_name>",
    # e.g. "11-종로구", "28-미추홀구", "41-수원시". The metropolitan prefix is what
    # keeps 서울 중구 and 인천 중구 distinct.
    municipality_key: Mapped[str] = mapped_column(String(80), index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    # 11 서울 / 28 인천 / 41 경기 — the same sido-code namespace the landfill
    # dashboard filters on. The canonical ``regions`` parent codes are
    # KR-SGIS-11 / KR-SGIS-23 / KR-SGIS-31; the 28→23 and 41→31 bridge is a
    # reviewed crosswalk and is never joined directly.
    metropolitan_code: Mapped[str] = mapped_column(String(10), index=True)
    metropolitan_name: Mapped[str] = mapped_column(String(40))
    municipality_level: Mapped[str] = mapped_column(String(20))
    boundary_vintage: Mapped[str] = mapped_column(String(10))

    direct_region_id: Mapped[int | None] = mapped_column(
        ForeignKey("regions.id", name="fk_mc_geo_direct_region"), index=True
    )
    # Canonical code of ``direct_region_id`` (NULL for a derived city), copied so
    # an API response never has to re-resolve it.
    direct_region_code: Mapped[str | None] = mapped_column(String(20))

    population_method: Mapped[str] = mapped_column(String(40))
    population_definition: Mapped[str | None] = mapped_column(String(100))
    reference_year: Mapped[int] = mapped_column(Integer, index=True)
    population: Mapped[int | None] = mapped_column(BigInteger().with_variant(Integer(), "sqlite"))
    evidence_status: Mapped[str] = mapped_column(String(60))

    status: Mapped[str] = mapped_column(String(20))
    reason_codes: Mapped[Any] = mapped_column(JsonVariant)

    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class MunicipalCostGeographyComponent(Base):
    """A constituent 일반구 whose 2024 population is summed into a derived city.

    Present only for ``DERIVED_SUM_OF_CONSTITUENT_WARDS`` geographies. The ward's
    own ``regions`` row is referenced, never modified.
    """

    __tablename__ = "municipal_cost_geography_components"
    __table_args__ = (
        UniqueConstraint(
            "geography_id",
            "component_region_id",
            name="uq_municipal_cost_geography_components_pair",
        ),
        CheckConstraint(
            "component_population >= 0",
            name="population_nonnegative",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    geography_id: Mapped[int] = mapped_column(
        ForeignKey(
            "municipal_cost_geographies.id",
            ondelete="CASCADE",
            name="fk_mc_geo_comp_geography",
        ),
        index=True,
    )
    component_region_id: Mapped[int] = mapped_column(
        ForeignKey("regions.id", name="fk_mc_geo_comp_region"), index=True
    )
    component_region_code: Mapped[str] = mapped_column(String(20))
    component_region_name: Mapped[str] = mapped_column(String(100))
    component_population: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite")
    )
    reference_year: Mapped[int] = mapped_column(Integer)
    population_definition: Mapped[str] = mapped_column(String(100))


class MunicipalCostSourceFile(Base):
    """One discovered workbook. Rejected workbooks are kept, with their reasons.

    ``sha256`` is the file identity, so a byte-identical re-run finds the
    existing row and inserts nothing. ``relative_path`` is metadata (the source
    folders are progress-labelled and change between deliveries).
    """

    __tablename__ = "municipal_cost_source_files"
    __table_args__ = (
        UniqueConstraint("sha256", name="uq_municipal_cost_source_files_sha256"),
        Index("ix_municipal_cost_source_files_geography", "resolved_geography_id"),
        CheckConstraint(
            _sql_in("dataset_role", DATASET_ROLES),
            name="dataset_role_allowed",
        ),
        CheckConstraint(
            _sql_in("layout_family", LAYOUT_FAMILIES),
            name="layout_family_allowed",
        ),
        CheckConstraint(
            _sql_in("primary_classification", PRIMARY_CLASSES),
            name="primary_class_allowed",
        ),
        CheckConstraint(
            _sql_in("ingestion_decision", INGESTION_DECISIONS),
            name="decision_allowed",
        ),
        # A rejected workbook resolves to no municipality and therefore
        # contributes no observation.
        CheckConstraint(
            f"ingestion_decision = '{INGESTION_DECISION_ACCEPTED}'"
            " OR resolved_geography_id IS NULL",
            name="rejected_has_no_geography",
        ),
        CheckConstraint(
            "file_size_bytes >= 0",
            name="size_nonnegative",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    relative_path: Mapped[str] = mapped_column(String(500))
    filename: Mapped[str] = mapped_column(String(300))
    sha256: Mapped[str] = mapped_column(String(64))
    file_size_bytes: Mapped[int] = mapped_column(BigInteger().with_variant(Integer(), "sqlite"))
    dataset_role: Mapped[str] = mapped_column(String(20), index=True)
    region_folder: Mapped[str] = mapped_column(String(200))
    workbook_sheet: Mapped[str] = mapped_column(String(120))
    used_range: Mapped[str] = mapped_column(String(40))
    layout_family: Mapped[str] = mapped_column(String(60))
    # Verbatim in-workbook 기관명 (DATA_A only; DATA_B has no such column).
    source_municipality_name: Mapped[str | None] = mapped_column(String(120))
    resolved_geography_id: Mapped[int | None] = mapped_column(
        ForeignKey("municipal_cost_geographies.id", name="fk_mc_file_geography")
    )
    # WORKBOOK_ORGANISATION_NAME / FILENAME / REVIEWED_MAPPING / UNRESOLVED.
    resolution_basis: Mapped[str] = mapped_column(String(60))
    resolution_evidence: Mapped[str | None] = mapped_column(Text)
    reference_year: Mapped[int] = mapped_column(Integer, index=True)
    boundary_vintage: Mapped[str] = mapped_column(String(10))
    primary_classification: Mapped[str] = mapped_column(String(60))
    ingestion_decision: Mapped[str] = mapped_column(String(20), index=True)
    rejection_reasons: Mapped[Any] = mapped_column(JsonVariant)
    source_notes: Mapped[Any] = mapped_column(JsonVariant)

    ingestion_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("ingestion_runs.run_id", name="fk_mc_file_run")
    )
    transformation_version: Mapped[str] = mapped_column(String(100))
    imported_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class MunicipalWasteContract(Base):
    """One source contract header row — the payment grain.

    ``payment_amount_krw`` is the value in the source's 총 금액(총 지급액) /
    총 금액(원) column. ``is_primary_numerator_eligible`` records, per row and
    reproducibly, whether that value entered the indicator numerator; the source
    ``합계`` row is never stored as a contract, so no total is double counted.
    """

    __tablename__ = "municipal_waste_contracts"
    __table_args__ = (
        UniqueConstraint(
            "source_file_id",
            "source_row",
            name="uq_municipal_waste_contracts_source_row",
        ),
        Index("ix_municipal_waste_contracts_geography_year", "geography_id", "reference_year"),
        CheckConstraint(
            "payment_amount_krw IS NULL OR payment_amount_krw >= 0",
            name="payment_nonnegative",
        ),
        CheckConstraint(
            _sql_in("payment_type", PAYMENT_TYPES),
            name="payment_type_allowed",
        ),
        CheckConstraint(
            _sql_in("waste_scope", WASTE_SCOPES),
            name="waste_scope_allowed",
        ),
        CheckConstraint(
            _sql_in("geographic_scope", GEOGRAPHIC_SCOPES),
            name="geographic_scope_allowed",
        ),
        CheckConstraint(
            _sql_in("evidence_status", EVIDENCE_STATUSES),
            name="evidence_allowed",
        ),
        CheckConstraint(
            _sql_in("completeness_status", COMPLETENESS_STATUSES),
            name="completeness_allowed",
        ),
        CheckConstraint(
            f"currency = '{CURRENCY_KRW}'",
            name="currency_krw",
        ),
        # Only an ACTUAL_PAID_AMOUNT with a real number may be eligible. An award
        # amount, a budget estimate, or a text cell can never reach the numerator.
        CheckConstraint(
            "NOT is_primary_numerator_eligible"
            f" OR (payment_type = '{PAYMENT_ACTUAL_PAID}' AND payment_amount_krw IS NOT NULL)",
            name="eligibility_consistent",
        ),
        CheckConstraint(
            "payment_period_start IS NULL"
            " OR payment_period_end IS NULL"
            " OR payment_period_start <= payment_period_end",
            name="period_ordered",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_file_id: Mapped[int] = mapped_column(
        ForeignKey(
            "municipal_cost_source_files.id",
            ondelete="CASCADE",
            name="fk_mc_contract_file",
        ),
        index=True,
    )
    geography_id: Mapped[int] = mapped_column(
        ForeignKey("municipal_cost_geographies.id", name="fk_mc_contract_geography"),
        index=True,
    )
    source_row: Mapped[int] = mapped_column(Integer)
    # Last worksheet row belonging to this contract's block, so a repeated block's
    # extent stays provable from the database.
    source_row_end: Mapped[int] = mapped_column(Integer)
    reference_year: Mapped[int] = mapped_column(Integer, index=True)
    # Verbatim 년도 cell (2024, or an explicit part-year range such as
    # "2024.2.26.~4.5").
    source_period_label: Mapped[str | None] = mapped_column(String(120))

    contract_name: Mapped[str] = mapped_column(String(400))
    contractor_name: Mapped[str | None] = mapped_column(String(200))

    payment_type: Mapped[str] = mapped_column(String(40))
    payment_amount_krw: Mapped[Decimal | None] = mapped_column(PaymentAmount)
    currency: Mapped[str] = mapped_column(String(10))
    # Verbatim text when the payment cell holds prose ("확인 불가") instead of a
    # number — never coerced to 0.
    payment_source_text: Mapped[str | None] = mapped_column(String(200))
    is_primary_numerator_eligible: Mapped[bool] = mapped_column(Boolean)

    payment_period_start: Mapped[datetime.date | None] = mapped_column(Date)
    payment_period_end: Mapped[datetime.date | None] = mapped_column(Date)

    waste_scope: Mapped[str] = mapped_column(String(30))
    geographic_scope: Mapped[str] = mapped_column(String(30))
    destination_names: Mapped[Any] = mapped_column(JsonVariant)
    treatment_methods: Mapped[Any] = mapped_column(JsonVariant)

    evidence_status: Mapped[str] = mapped_column(String(60))
    completeness_status: Mapped[str] = mapped_column(String(20))
    limitation_reasons: Mapped[Any] = mapped_column(JsonVariant)
    source_note: Mapped[str | None] = mapped_column(Text)

    ingestion_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("ingestion_runs.run_id", name="fk_mc_contract_run")
    )
    transformation_version: Mapped[str] = mapped_column(String(100))
    imported_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class MunicipalWasteQuantity(Base):
    """One **logical** quantity observation, stored separately from payments.

    A DATA_A quantity block that the source copied verbatim under every contract
    row is stored **once**, with ``attribution =
    MUNICIPAL_TOTAL_REPEATED_PER_CONTRACT`` and every repetition's worksheet row
    listed in ``source_repetition_rows`` — so the repetition stays provable while
    a SUM over this table can never multiply the city total by the contract count.
    """

    __tablename__ = "municipal_waste_quantities"
    __table_args__ = (
        UniqueConstraint(
            "source_file_id",
            "source_row",
            "source_column",
            "source_label",
            name="uq_municipal_waste_quantities_source_cell",
        ),
        Index(
            "ix_municipal_waste_quantities_geography_year",
            "geography_id",
            "reference_year",
            "waste_category",
        ),
        CheckConstraint(
            _sql_in("value_state", VALUE_STATES),
            name="value_state_allowed",
        ),
        CheckConstraint(
            _sql_in("attribution", ATTRIBUTIONS),
            name="attribution_allowed",
        ),
        CheckConstraint(
            _sql_in("quantity_period", QUANTITY_PERIODS),
            name="period_allowed",
        ),
        CheckConstraint(
            _sql_in("waste_category", WASTE_CATEGORIES),
            name="category_allowed",
        ),
        CheckConstraint(
            _sql_in("evidence_status", EVIDENCE_STATUSES),
            name="evidence_allowed",
        ),
        CheckConstraint(
            f"quantity_unit = '{QUANTITY_UNIT_TONNE}'",
            name="unit_tonne",
        ),
        # The structural guarantee that missing is never zero and zero is never
        # missing: MEASURED needs a value > 0, MEASURED_ZERO needs exactly 0, and
        # every missing state needs NULL.
        # Each branch tests IS NOT NULL explicitly: `quantity_value = 0` alone
        # evaluates to NULL (not FALSE) when the column is NULL, and a CHECK that
        # evaluates to NULL passes — which would let a MEASURED_ZERO row store no
        # value at all.
        CheckConstraint(
            f"(value_state = '{VALUE_MEASURED}'"
            " AND quantity_value IS NOT NULL AND quantity_value > 0)"
            f" OR (value_state = '{VALUE_MEASURED_ZERO}'"
            " AND quantity_value IS NOT NULL AND quantity_value = 0)"
            f" OR ({_sql_in('value_state', VALUE_STATES_WITHOUT_NUMBER)}"
            " AND quantity_value IS NULL)",
            name="value_state_consistent",
        ),
        CheckConstraint(
            "reference_month IS NULL OR reference_month LIKE '____-__'",
            name="reference_month_format",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_file_id: Mapped[int] = mapped_column(
        ForeignKey(
            "municipal_cost_source_files.id",
            ondelete="CASCADE",
            name="fk_mc_qty_file",
        ),
        index=True,
    )
    contract_id: Mapped[int | None] = mapped_column(
        ForeignKey("municipal_waste_contracts.id", ondelete="CASCADE", name="fk_mc_qty_contract"),
        index=True,
    )
    geography_id: Mapped[int] = mapped_column(
        ForeignKey("municipal_cost_geographies.id", name="fk_mc_qty_geography"), index=True
    )
    # Worksheet coordinates of the *first* occurrence of this logical value.
    source_row: Mapped[int] = mapped_column(Integer)
    source_column: Mapped[int] = mapped_column(Integer)
    source_label: Mapped[str] = mapped_column(String(200))
    # Every worksheet row at which the source repeated this identical block.
    source_repetition_rows: Mapped[Any] = mapped_column(JsonVariant)

    reference_year: Mapped[int] = mapped_column(Integer, index=True)
    reference_month: Mapped[str | None] = mapped_column(String(7))
    quantity_period: Mapped[str] = mapped_column(String(30))
    waste_category: Mapped[str] = mapped_column(String(20))
    destination_name: Mapped[str | None] = mapped_column(String(300))
    treatment_method: Mapped[str | None] = mapped_column(String(300))

    quantity_value: Mapped[Decimal | None] = mapped_column(QuantityTonnes)
    quantity_unit: Mapped[str] = mapped_column(String(20))
    value_state: Mapped[str] = mapped_column(String(30))
    attribution: Mapped[str] = mapped_column(String(50), index=True)

    evidence_status: Mapped[str] = mapped_column(String(60))
    limitation_reasons: Mapped[Any] = mapped_column(JsonVariant)

    ingestion_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("ingestion_runs.run_id", name="fk_mc_qty_run")
    )
    transformation_version: Mapped[str] = mapped_column(String(100))
    imported_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class MunicipalCostIndicatorValue(Base):
    """The served indicator: one row per municipality × indicator × year × method.

    Written for **all 66** municipalities, including the unavailable ones. An
    ``UNAVAILABLE`` row carries ``value IS NULL`` — never 0 — enforced below.
    """

    __tablename__ = "municipal_cost_indicator_values"
    __table_args__ = (
        UniqueConstraint(
            "geography_id",
            "reference_year",
            "indicator_code",
            "methodology_version",
            name="uq_municipal_cost_indicator_values_grain",
        ),
        CheckConstraint(
            _sql_in("status", INDICATOR_STATUSES),
            name="status_allowed",
        ),
        CheckConstraint(
            _sql_in("evidence_status", EVIDENCE_STATUSES),
            name="evidence_allowed",
        ),
        # An unavailable indicator is never rendered — or stored — as zero.
        CheckConstraint(
            f"status <> '{STATUS_UNAVAILABLE}' OR value IS NULL",
            name="unavailable_is_null",
        ),
        # A served value must show both of its inputs, and the denominator must be
        # strictly positive.
        CheckConstraint(
            "value IS NULL"
            " OR (numerator_amount_krw IS NOT NULL"
            " AND denominator_population IS NOT NULL"
            " AND denominator_population > 0)",
            name="inputs_present",
        ),
        CheckConstraint(
            "value IS NULL OR value >= 0",
            name="value_nonnegative",
        ),
        CheckConstraint(
            "numerator_amount_krw IS NULL OR numerator_amount_krw >= 0",
            name="numerator_nonnegative",
        ),
        CheckConstraint(
            "numerator_contract_count >= 0",
            name="contract_count_nonnegative",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    geography_id: Mapped[int] = mapped_column(
        ForeignKey("municipal_cost_geographies.id", name="fk_mc_indicator_geography"),
        index=True,
    )
    reference_year: Mapped[int] = mapped_column(Integer, index=True)
    indicator_code: Mapped[str] = mapped_column(String(80), index=True)
    value: Mapped[Decimal | None] = mapped_column(IndicatorAmount)
    unit: Mapped[str] = mapped_column(String(20))

    numerator_amount_krw: Mapped[Decimal | None] = mapped_column(PaymentAmount)
    denominator_population: Mapped[int | None] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite")
    )
    numerator_contract_count: Mapped[int] = mapped_column(Integer)

    population_method: Mapped[str] = mapped_column(String(40))
    population_definition: Mapped[str | None] = mapped_column(String(100))

    evidence_status: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20), index=True)
    reason_codes: Mapped[Any] = mapped_column(JsonVariant)
    limitations: Mapped[Any] = mapped_column(JsonVariant)

    methodology_version: Mapped[str] = mapped_column(String(100))
    ingestion_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("ingestion_runs.run_id", name="fk_mc_indicator_run")
    )
    computed_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
