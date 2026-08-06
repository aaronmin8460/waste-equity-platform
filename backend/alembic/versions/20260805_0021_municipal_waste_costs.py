"""2024 municipal waste collection-and-transport contract payments (Step 2).

Purely additive. Adds six tables and one ``data_sources`` row:

- ``municipal_cost_geographies`` — the 2024 analytical municipality registry
  (exactly 66 rows once loaded: 서울 25 + 인천 10 (2024 geography) + 경기 31)
- ``municipal_cost_geography_components`` — the constituent 일반구 populations
  summed into the seven derived Gyeonggi city populations
- ``municipal_cost_source_files`` — one row per discovered workbook, rejected
  ones included
- ``municipal_waste_contracts`` — one row per source contract header (payment)
- ``municipal_waste_quantities`` — one row per **logical** quantity observation
- ``municipal_cost_indicator_values`` — the served per-capita indicator

**No existing table is altered.** ``landfill_inbound_monthly`` is untouched: its
columns, constraints, rows, and the ``LANDFILL_INBOUND_FEE_PER_CAPITA`` indicator
contract are all unchanged by this migration. The municipal payments here are a
different accounting basis
(``MUNICIPAL_CONTRACTED_COLLECTION_TRANSPORT_PAYMENT``) at city/county/district
grain and are never written into the official metropolitan landfill table — whose
origin CHECK constraint would reject them anyway.

No ``regions`` row is added, modified, renamed, or invalidated. The seven Gyeonggi
cities stored only as 일반구 get an analytical registry row that *references* the
existing ward rows; no city-level region and no synthetic geometry is created.

Two CHECK constraints carry the release's core data-integrity promises:
``ck_municipal_waste_quantities_value_state_consistent`` makes it structurally
impossible to store a missing value as numeric zero (or a measured zero as
missing), and ``ck_municipal_cost_indicator_values_unavailable_is_null`` makes it
impossible to store an unavailable indicator as 0.

Downgrade removes only the objects added here.

Revision ID: 0021
Revises: 0020
Create Date: 2026-08-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JsonVariant = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
BigIntVariant = sa.BigInteger().with_variant(sa.Integer(), "sqlite")

_SOURCE_ID = "municipal_waste_cost_disclosure"

_GEOGRAPHIES = "municipal_cost_geographies"
_COMPONENTS = "municipal_cost_geography_components"
_SOURCE_FILES = "municipal_cost_source_files"
_CONTRACTS = "municipal_waste_contracts"
_QUANTITIES = "municipal_waste_quantities"
_INDICATOR_VALUES = "municipal_cost_indicator_values"

_PAYMENT = sa.Numeric(precision=20, scale=2)
_QUANTITY = sa.Numeric(precision=18, scale=4)
_INDICATOR = sa.Numeric(precision=20, scale=4)

_POPULATION_METHODS = ("DIRECT_REGION_POPULATION", "DERIVED_SUM_OF_CONSTITUENT_WARDS")
_EVIDENCE_STATUSES = (
    "LOCAL_GOVERNMENT_REPORTED_VALUE",
    "LOCAL_GOVERNMENT_SOURCE_INPUTS_DERIVED_VALUE",
    "OFFICIAL_REPORTED_VALUE",
    "OFFICIAL_INPUTS_DERIVED_VALUE",
)
_LAYOUT_FAMILIES = (
    "DATA_B_MONTHLY_CATEGORY_GRID",
    "DATA_A_CONTRACT_QUANTITY_PAIRS",
    "DATA_A_CONTRACT_WITH_PAYMENT_LEDGER",
    "DATA_A_CONTRACT_NUMBERED_PAIRS",
    "DATA_A_CONTRACT_DESTINATION_SPLIT",
    "DATA_A_CONTRACT_DASH_ONLY_QUANTITY",
    "DATA_A_CONTRACT_TONNE_LABELLED_PAIRS",
    "UNSUPPORTED_LAYOUT",
)
_PRIMARY_CLASSES = (
    "EMPTY_OR_NO_DATA",
    "DATA_A_PAYMENT_AND_QUANTITY",
    "DATA_A_PAYMENT_ONLY",
    "DATA_A_QUANTITY_ONLY",
    "DATA_A_PARTIAL_WASTE_SCOPE",
    "DATA_B_QUANTITY_VALIDATION",
    "BOUNDARY_MISMATCH",
    "AMBIGUOUS_REGION_MAPPING",
    "AMBIGUOUS_SOURCE_MEANING",
    "UNSUPPORTED_LAYOUT",
)
_PAYMENT_TYPES = ("ACTUAL_PAID_AMOUNT", "CONTRACT_AWARD_AMOUNT", "BUDGET_ESTIMATE")
_WASTE_SCOPES = (
    "ALL_MUNICIPAL",
    "GENERAL_ONLY",
    "FOOD_ONLY",
    "RECYCLING_ONLY",
    "MIXED_PARTIAL",
    "UNKNOWN",
)
_VALUE_STATES = (
    "MEASURED",
    "MEASURED_ZERO",
    "SOURCE_DASH_NO_DATA",
    "SOURCE_TEXT_NO_DATA",
    "BLANK",
)
_ATTRIBUTIONS = (
    "PER_CONTRACT",
    "MUNICIPAL_TOTAL_REPEATED_PER_CONTRACT",
    "MUNICIPAL_TOTAL_SINGLE",
    "UNKNOWN",
)
_QUANTITY_PERIODS = ("MONTHLY", "ANNUAL", "MONTHLY_AVERAGE", "UNSPECIFIED")
_WASTE_CATEGORIES = ("GENERAL", "FOOD", "RECYCLING", "BULKY", "COMBINED", "UNKNOWN")

# (table, column) pairs that get a plain non-unique index, named by the
# repository's ix_%(column_0_label)s convention.
_INDEXED: tuple[tuple[str, str], ...] = (
    (_GEOGRAPHIES, "municipality_key"),
    (_GEOGRAPHIES, "metropolitan_code"),
    (_GEOGRAPHIES, "direct_region_id"),
    (_GEOGRAPHIES, "reference_year"),
    (_COMPONENTS, "geography_id"),
    (_COMPONENTS, "component_region_id"),
    (_SOURCE_FILES, "dataset_role"),
    (_SOURCE_FILES, "reference_year"),
    (_SOURCE_FILES, "ingestion_decision"),
    (_CONTRACTS, "source_file_id"),
    (_CONTRACTS, "geography_id"),
    (_CONTRACTS, "reference_year"),
    (_QUANTITIES, "source_file_id"),
    (_QUANTITIES, "contract_id"),
    (_QUANTITIES, "geography_id"),
    (_QUANTITIES, "reference_year"),
    (_QUANTITIES, "attribution"),
    (_INDICATOR_VALUES, "geography_id"),
    (_INDICATOR_VALUES, "reference_year"),
    (_INDICATOR_VALUES, "indicator_code"),
    (_INDICATOR_VALUES, "status"),
)

_COMPOSITE_INDEXES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    (
        "ix_municipal_cost_geographies_metro_year",
        _GEOGRAPHIES,
        ("metropolitan_code", "reference_year"),
    ),
    ("ix_municipal_cost_source_files_geography", _SOURCE_FILES, ("resolved_geography_id",)),
    (
        "ix_municipal_waste_contracts_geography_year",
        _CONTRACTS,
        ("geography_id", "reference_year"),
    ),
    (
        "ix_municipal_waste_quantities_geography_year",
        _QUANTITIES,
        ("geography_id", "reference_year", "waste_category"),
    ),
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{value}'" for value in values) + ")"


def upgrade() -> None:
    # Local-government information-disclosure workbooks (정보공개청구 회신) — a
    # distinct provider class from every open-data API source and from the
    # official odcloud landfill datasets, so it gets its own data_sources row.
    data_sources = sa.table(
        "data_sources",
        sa.column("source_id", sa.String),
        sa.column("source_name", sa.String),
        sa.column("dataset_name", sa.String),
        sa.column("endpoint", sa.String),
        sa.column("publication_frequency", sa.String),
        sa.column("enabled", sa.Boolean),
        sa.column("documentation_url", sa.String),
    )
    op.bulk_insert(
        data_sources,
        [
            {
                "source_id": _SOURCE_ID,
                "source_name": "수도권 기초지자체 (정보공개청구 회신)",
                "dataset_name": "2024년 생활폐기물 수집·운반 대행 계약 지급액 및 반출량",
                # Local workbooks supplied per municipality; there is no API and
                # no single public endpoint.
                "endpoint": "local-file://data/import/municipal-costs/2024",
                # Delivered ad hoc per disclosure response, not on a schedule.
                "publication_frequency": "STRUCTURAL",
                "enabled": True,
                "documentation_url": None,
            }
        ],
    )

    op.create_table(
        _GEOGRAPHIES,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("municipality_key", sa.String(length=80), nullable=False),
        sa.Column("display_name", sa.String(length=80), nullable=False),
        sa.Column("metropolitan_code", sa.String(length=10), nullable=False),
        sa.Column("metropolitan_name", sa.String(length=40), nullable=False),
        sa.Column("municipality_level", sa.String(length=20), nullable=False),
        sa.Column("boundary_vintage", sa.String(length=10), nullable=False),
        sa.Column("direct_region_id", sa.Integer(), nullable=True),
        sa.Column("direct_region_code", sa.String(length=20), nullable=True),
        sa.Column("population_method", sa.String(length=40), nullable=False),
        sa.Column("population_definition", sa.String(length=100), nullable=True),
        sa.Column("reference_year", sa.Integer(), nullable=False),
        sa.Column("population", BigIntVariant, nullable=True),
        sa.Column("evidence_status", sa.String(length=60), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("reason_codes", JsonVariant, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_municipal_cost_geographies"),
        sa.UniqueConstraint(
            "municipality_key",
            "reference_year",
            name="uq_municipal_cost_geographies_key_year",
        ),
        sa.ForeignKeyConstraint(
            ["direct_region_id"], ["regions.id"], name="fk_mc_geo_direct_region"
        ),
        sa.CheckConstraint(
            "population IS NULL OR population >= 0",
            name="ck_municipal_cost_geographies_population_nonnegative",
        ),
        sa.CheckConstraint(
            "boundary_vintage = '2024'",
            name="ck_municipal_cost_geographies_boundary_vintage_fixed",
        ),
        sa.CheckConstraint(
            _in("population_method", _POPULATION_METHODS),
            name="ck_municipal_cost_geographies_population_method_allowed",
        ),
        sa.CheckConstraint(
            _in("status", ("AVAILABLE", "UNAVAILABLE")),
            name="ck_municipal_cost_geographies_status_allowed",
        ),
        sa.CheckConstraint(
            _in("evidence_status", _EVIDENCE_STATUSES),
            name="ck_municipal_cost_geographies_evidence_allowed",
        ),
        sa.CheckConstraint(
            _in("municipality_level", ("SIGUNGU",)),
            name="ck_municipal_cost_geographies_level_allowed",
        ),
        # A direct-population geography must name the region it read; a derived
        # one must not fabricate one.
        sa.CheckConstraint(
            "(population_method = 'DIRECT_REGION_POPULATION' AND direct_region_id IS NOT NULL)"
            " OR (population_method = 'DERIVED_SUM_OF_CONSTITUENT_WARDS'"
            " AND direct_region_id IS NULL)",
            name="ck_municipal_cost_geographies_population_method_consistent",
        ),
        # A usable denominator is strictly positive; an unusable one is NULL,
        # never 0.
        sa.CheckConstraint(
            "(status = 'AVAILABLE' AND population IS NOT NULL AND population > 0)"
            " OR (status = 'UNAVAILABLE' AND population IS NULL)",
            name="ck_municipal_cost_geographies_population_status_consistent",
        ),
    )

    op.create_table(
        _COMPONENTS,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("geography_id", sa.Integer(), nullable=False),
        sa.Column("component_region_id", sa.Integer(), nullable=False),
        sa.Column("component_region_code", sa.String(length=20), nullable=False),
        sa.Column("component_region_name", sa.String(length=100), nullable=False),
        sa.Column("component_population", BigIntVariant, nullable=False),
        sa.Column("reference_year", sa.Integer(), nullable=False),
        sa.Column("population_definition", sa.String(length=100), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_municipal_cost_geography_components"),
        sa.UniqueConstraint(
            "geography_id",
            "component_region_id",
            name="uq_municipal_cost_geography_components_pair",
        ),
        sa.ForeignKeyConstraint(
            ["geography_id"],
            [f"{_GEOGRAPHIES}.id"],
            name="fk_mc_geo_comp_geography",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["component_region_id"], ["regions.id"], name="fk_mc_geo_comp_region"
        ),
        sa.CheckConstraint(
            "component_population >= 0",
            name="ck_municipal_cost_geography_components_population_nonnegative",
        ),
    )

    op.create_table(
        _SOURCE_FILES,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("relative_path", sa.String(length=500), nullable=False),
        sa.Column("filename", sa.String(length=300), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("file_size_bytes", BigIntVariant, nullable=False),
        sa.Column("dataset_role", sa.String(length=20), nullable=False),
        sa.Column("region_folder", sa.String(length=200), nullable=False),
        sa.Column("workbook_sheet", sa.String(length=120), nullable=False),
        sa.Column("used_range", sa.String(length=40), nullable=False),
        sa.Column("layout_family", sa.String(length=60), nullable=False),
        sa.Column("source_municipality_name", sa.String(length=120), nullable=True),
        sa.Column("resolved_geography_id", sa.Integer(), nullable=True),
        sa.Column("resolution_basis", sa.String(length=60), nullable=False),
        sa.Column("resolution_evidence", sa.Text(), nullable=True),
        sa.Column("reference_year", sa.Integer(), nullable=False),
        sa.Column("boundary_vintage", sa.String(length=10), nullable=False),
        sa.Column("primary_classification", sa.String(length=60), nullable=False),
        sa.Column("ingestion_decision", sa.String(length=20), nullable=False),
        sa.Column("rejection_reasons", JsonVariant, nullable=False),
        sa.Column("source_notes", JsonVariant, nullable=False),
        sa.Column("ingestion_run_id", BigIntVariant, nullable=True),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_municipal_cost_source_files"),
        sa.UniqueConstraint("sha256", name="uq_municipal_cost_source_files_sha256"),
        sa.ForeignKeyConstraint(
            ["resolved_geography_id"], [f"{_GEOGRAPHIES}.id"], name="fk_mc_file_geography"
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"], ["ingestion_runs.run_id"], name="fk_mc_file_run"
        ),
        sa.CheckConstraint(
            _in("dataset_role", ("DATA_A", "DATA_B")),
            name="ck_municipal_cost_source_files_dataset_role_allowed",
        ),
        sa.CheckConstraint(
            _in("layout_family", _LAYOUT_FAMILIES),
            name="ck_municipal_cost_source_files_layout_family_allowed",
        ),
        sa.CheckConstraint(
            _in("primary_classification", _PRIMARY_CLASSES),
            name="ck_municipal_cost_source_files_primary_class_allowed",
        ),
        sa.CheckConstraint(
            _in("ingestion_decision", ("ACCEPTED", "REJECTED")),
            name="ck_municipal_cost_source_files_decision_allowed",
        ),
        # A rejected workbook resolves to no municipality and therefore
        # contributes no observation.
        sa.CheckConstraint(
            "ingestion_decision = 'ACCEPTED' OR resolved_geography_id IS NULL",
            name="ck_municipal_cost_source_files_rejected_has_no_geography",
        ),
        sa.CheckConstraint(
            "file_size_bytes >= 0",
            name="ck_municipal_cost_source_files_size_nonnegative",
        ),
    )

    op.create_table(
        _CONTRACTS,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_file_id", sa.Integer(), nullable=False),
        sa.Column("geography_id", sa.Integer(), nullable=False),
        sa.Column("source_row", sa.Integer(), nullable=False),
        sa.Column("source_row_end", sa.Integer(), nullable=False),
        sa.Column("reference_year", sa.Integer(), nullable=False),
        sa.Column("source_period_label", sa.String(length=120), nullable=True),
        sa.Column("contract_name", sa.String(length=400), nullable=False),
        sa.Column("contractor_name", sa.String(length=200), nullable=True),
        sa.Column("payment_type", sa.String(length=40), nullable=False),
        sa.Column("payment_amount_krw", _PAYMENT, nullable=True),
        sa.Column("currency", sa.String(length=10), nullable=False),
        sa.Column("payment_source_text", sa.String(length=200), nullable=True),
        sa.Column("is_primary_numerator_eligible", sa.Boolean(), nullable=False),
        sa.Column("payment_period_start", sa.Date(), nullable=True),
        sa.Column("payment_period_end", sa.Date(), nullable=True),
        sa.Column("waste_scope", sa.String(length=30), nullable=False),
        sa.Column("geographic_scope", sa.String(length=30), nullable=False),
        sa.Column("destination_names", JsonVariant, nullable=False),
        sa.Column("treatment_methods", JsonVariant, nullable=False),
        sa.Column("evidence_status", sa.String(length=60), nullable=False),
        sa.Column("completeness_status", sa.String(length=20), nullable=False),
        sa.Column("limitation_reasons", JsonVariant, nullable=False),
        sa.Column("source_note", sa.Text(), nullable=True),
        sa.Column("ingestion_run_id", BigIntVariant, nullable=True),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_municipal_waste_contracts"),
        sa.UniqueConstraint(
            "source_file_id", "source_row", name="uq_municipal_waste_contracts_source_row"
        ),
        sa.ForeignKeyConstraint(
            ["source_file_id"],
            [f"{_SOURCE_FILES}.id"],
            name="fk_mc_contract_file",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["geography_id"], [f"{_GEOGRAPHIES}.id"], name="fk_mc_contract_geography"
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"], ["ingestion_runs.run_id"], name="fk_mc_contract_run"
        ),
        sa.CheckConstraint(
            "payment_amount_krw IS NULL OR payment_amount_krw >= 0",
            name="ck_municipal_waste_contracts_payment_nonnegative",
        ),
        sa.CheckConstraint(
            _in("payment_type", _PAYMENT_TYPES),
            name="ck_municipal_waste_contracts_payment_type_allowed",
        ),
        sa.CheckConstraint(
            _in("waste_scope", _WASTE_SCOPES),
            name="ck_municipal_waste_contracts_waste_scope_allowed",
        ),
        sa.CheckConstraint(
            _in("geographic_scope", ("WHOLE_MUNICIPALITY", "SUB_MUNICIPAL")),
            name="ck_municipal_waste_contracts_geographic_scope_allowed",
        ),
        sa.CheckConstraint(
            _in("evidence_status", _EVIDENCE_STATUSES),
            name="ck_municipal_waste_contracts_evidence_allowed",
        ),
        sa.CheckConstraint(
            _in("completeness_status", ("COMPLETE", "PARTIAL", "UNUSABLE")),
            name="ck_municipal_waste_contracts_completeness_allowed",
        ),
        sa.CheckConstraint("currency = 'KRW'", name="ck_municipal_waste_contracts_currency_krw"),
        # Only an ACTUAL_PAID_AMOUNT with a real number may be eligible. An award
        # amount, a budget estimate, or a text cell can never reach the numerator.
        sa.CheckConstraint(
            "NOT is_primary_numerator_eligible"
            " OR (payment_type = 'ACTUAL_PAID_AMOUNT' AND payment_amount_krw IS NOT NULL)",
            name="ck_municipal_waste_contracts_eligibility_consistent",
        ),
        sa.CheckConstraint(
            "payment_period_start IS NULL"
            " OR payment_period_end IS NULL"
            " OR payment_period_start <= payment_period_end",
            name="ck_municipal_waste_contracts_period_ordered",
        ),
    )

    op.create_table(
        _QUANTITIES,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_file_id", sa.Integer(), nullable=False),
        sa.Column("contract_id", sa.Integer(), nullable=True),
        sa.Column("geography_id", sa.Integer(), nullable=False),
        sa.Column("source_row", sa.Integer(), nullable=False),
        sa.Column("source_column", sa.Integer(), nullable=False),
        sa.Column("source_label", sa.String(length=200), nullable=False),
        sa.Column("source_repetition_rows", JsonVariant, nullable=False),
        sa.Column("reference_year", sa.Integer(), nullable=False),
        sa.Column("reference_month", sa.String(length=7), nullable=True),
        sa.Column("quantity_period", sa.String(length=30), nullable=False),
        sa.Column("waste_category", sa.String(length=20), nullable=False),
        sa.Column("destination_name", sa.String(length=300), nullable=True),
        sa.Column("treatment_method", sa.String(length=300), nullable=True),
        sa.Column("quantity_value", _QUANTITY, nullable=True),
        sa.Column("quantity_unit", sa.String(length=20), nullable=False),
        sa.Column("value_state", sa.String(length=30), nullable=False),
        sa.Column("attribution", sa.String(length=50), nullable=False),
        sa.Column("evidence_status", sa.String(length=60), nullable=False),
        sa.Column("limitation_reasons", JsonVariant, nullable=False),
        sa.Column("ingestion_run_id", BigIntVariant, nullable=True),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_municipal_waste_quantities"),
        sa.UniqueConstraint(
            "source_file_id",
            "source_row",
            "source_column",
            "source_label",
            name="uq_municipal_waste_quantities_source_cell",
        ),
        sa.ForeignKeyConstraint(
            ["source_file_id"],
            [f"{_SOURCE_FILES}.id"],
            name="fk_mc_qty_file",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["contract_id"],
            [f"{_CONTRACTS}.id"],
            name="fk_mc_qty_contract",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["geography_id"], [f"{_GEOGRAPHIES}.id"], name="fk_mc_qty_geography"
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"], ["ingestion_runs.run_id"], name="fk_mc_qty_run"
        ),
        sa.CheckConstraint(
            _in("value_state", _VALUE_STATES),
            name="ck_municipal_waste_quantities_value_state_allowed",
        ),
        sa.CheckConstraint(
            _in("attribution", _ATTRIBUTIONS),
            name="ck_municipal_waste_quantities_attribution_allowed",
        ),
        sa.CheckConstraint(
            _in("quantity_period", _QUANTITY_PERIODS),
            name="ck_municipal_waste_quantities_period_allowed",
        ),
        sa.CheckConstraint(
            _in("waste_category", _WASTE_CATEGORIES),
            name="ck_municipal_waste_quantities_category_allowed",
        ),
        sa.CheckConstraint(
            _in("evidence_status", _EVIDENCE_STATUSES),
            name="ck_municipal_waste_quantities_evidence_allowed",
        ),
        sa.CheckConstraint(
            "quantity_unit = 'TONNE'", name="ck_municipal_waste_quantities_unit_tonne"
        ),
        # The structural guarantee that missing is never zero and zero is never
        # missing: a source '-' or '자료 없음' can never become numeric 0. Each
        # branch tests IS NOT NULL explicitly — `quantity_value = 0` alone
        # evaluates to NULL when the column is NULL, and a CHECK that evaluates to
        # NULL passes.
        sa.CheckConstraint(
            "(value_state = 'MEASURED' AND quantity_value IS NOT NULL AND quantity_value > 0)"
            " OR (value_state = 'MEASURED_ZERO'"
            " AND quantity_value IS NOT NULL AND quantity_value = 0)"
            " OR ("
            + _in("value_state", ("SOURCE_DASH_NO_DATA", "SOURCE_TEXT_NO_DATA", "BLANK"))
            + " AND quantity_value IS NULL)",
            name="ck_municipal_waste_quantities_value_state_consistent",
        ),
        sa.CheckConstraint(
            "reference_month IS NULL OR reference_month LIKE '____-__'",
            name="ck_municipal_waste_quantities_reference_month_format",
        ),
    )

    op.create_table(
        _INDICATOR_VALUES,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("geography_id", sa.Integer(), nullable=False),
        sa.Column("reference_year", sa.Integer(), nullable=False),
        sa.Column("indicator_code", sa.String(length=80), nullable=False),
        sa.Column("value", _INDICATOR, nullable=True),
        sa.Column("unit", sa.String(length=20), nullable=False),
        sa.Column("numerator_amount_krw", _PAYMENT, nullable=True),
        sa.Column("denominator_population", BigIntVariant, nullable=True),
        sa.Column("numerator_contract_count", sa.Integer(), nullable=False),
        sa.Column("population_method", sa.String(length=40), nullable=False),
        sa.Column("population_definition", sa.String(length=100), nullable=True),
        sa.Column("evidence_status", sa.String(length=60), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("reason_codes", JsonVariant, nullable=False),
        sa.Column("limitations", JsonVariant, nullable=False),
        sa.Column("methodology_version", sa.String(length=100), nullable=False),
        sa.Column("ingestion_run_id", BigIntVariant, nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_municipal_cost_indicator_values"),
        sa.UniqueConstraint(
            "geography_id",
            "reference_year",
            "indicator_code",
            "methodology_version",
            name="uq_municipal_cost_indicator_values_grain",
        ),
        sa.ForeignKeyConstraint(
            ["geography_id"], [f"{_GEOGRAPHIES}.id"], name="fk_mc_indicator_geography"
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"], ["ingestion_runs.run_id"], name="fk_mc_indicator_run"
        ),
        sa.CheckConstraint(
            _in("status", ("AVAILABLE", "PARTIAL", "UNAVAILABLE")),
            name="ck_municipal_cost_indicator_values_status_allowed",
        ),
        sa.CheckConstraint(
            _in("evidence_status", _EVIDENCE_STATUSES),
            name="ck_municipal_cost_indicator_values_evidence_allowed",
        ),
        # An unavailable indicator is never stored — or rendered — as zero.
        sa.CheckConstraint(
            "status <> 'UNAVAILABLE' OR value IS NULL",
            name="ck_municipal_cost_indicator_values_unavailable_is_null",
        ),
        sa.CheckConstraint(
            "value IS NULL"
            " OR (numerator_amount_krw IS NOT NULL"
            " AND denominator_population IS NOT NULL"
            " AND denominator_population > 0)",
            name="ck_municipal_cost_indicator_values_inputs_present",
        ),
        sa.CheckConstraint(
            "value IS NULL OR value >= 0",
            name="ck_municipal_cost_indicator_values_value_nonnegative",
        ),
        sa.CheckConstraint(
            "numerator_amount_krw IS NULL OR numerator_amount_krw >= 0",
            name="ck_municipal_cost_indicator_values_numerator_nonnegative",
        ),
        sa.CheckConstraint(
            "numerator_contract_count >= 0",
            name="ck_municipal_cost_indicator_values_contract_count_nonnegative",
        ),
    )

    for table, column in _INDEXED:
        op.create_index(op.f(f"ix_{table}_{column}"), table, [column], unique=False)
    for name, table, columns in _COMPOSITE_INDEXES:
        op.create_index(name, table, list(columns), unique=False)


def downgrade() -> None:
    for name, table, _columns in reversed(_COMPOSITE_INDEXES):
        op.drop_index(name, table_name=table)
    for table, column in reversed(_INDEXED):
        op.drop_index(op.f(f"ix_{table}_{column}"), table_name=table)
    op.drop_table(_INDICATOR_VALUES)
    op.drop_table(_QUANTITIES)
    op.drop_table(_CONTRACTS)
    op.drop_table(_SOURCE_FILES)
    op.drop_table(_COMPONENTS)
    op.drop_table(_GEOGRAPHIES)
    op.execute(sa.text(f"DELETE FROM data_sources WHERE source_id = '{_SOURCE_ID}'"))
