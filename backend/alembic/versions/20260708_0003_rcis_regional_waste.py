"""RCIS regional waste generation and treatment statistics schema.

Adds the normalized ``regional_waste_statistics`` table for the four regional
generation PIDs (NTN007, NTN008, NTN018, NTN022). The row grain is one row per
(region, reference year, source PID): the region-level grand total across all
waste categories for that PID's waste stream. The crosswalk columns for RCIS
name pairs already exist on ``region_code_map`` from revision 0001, so this
revision only adds the new table.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-08

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ACCOUNTING_BASIS = "ORIGIN_BASED_TREATMENT_OUTCOME"


def _quantity() -> sa.Numeric:
    return sa.Numeric(precision=20, scale=6)


def upgrade() -> None:
    op.create_table(
        "regional_waste_statistics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("region_id", sa.Integer(), nullable=False),
        sa.Column("reference_year", sa.Integer(), nullable=False),
        sa.Column("reference_period", sa.String(length=50), nullable=False),
        sa.Column("source_id", sa.String(length=50), nullable=False),
        sa.Column("source_pid", sa.String(length=20), nullable=False),
        sa.Column("official_dataset_name", sa.String(length=200), nullable=False),
        sa.Column("waste_stream", sa.String(length=40), nullable=False),
        sa.Column("waste_category_code", sa.String(length=40), nullable=True),
        sa.Column("waste_category_name", sa.String(length=100), nullable=False),
        sa.Column("generation_quantity", _quantity(), nullable=False),
        sa.Column("recycling_quantity", _quantity(), nullable=False),
        sa.Column("incineration_quantity", _quantity(), nullable=False),
        sa.Column("landfill_quantity", _quantity(), nullable=False),
        sa.Column("other_treatment_quantity", _quantity(), nullable=False),
        sa.Column("total_treatment_quantity", _quantity(), nullable=False),
        sa.Column("total_treatment_is_derived", sa.Boolean(), nullable=False),
        sa.Column("treatment_reconciliation_difference", _quantity(), nullable=False),
        sa.Column("quantity_unit", sa.String(length=20), nullable=False),
        sa.Column("accounting_basis", sa.String(length=40), nullable=False),
        sa.Column("rcis_sido_name", sa.String(length=50), nullable=False),
        sa.Column("rcis_sigungu_name", sa.String(length=50), nullable=False),
        sa.Column("source_geographic_level", sa.String(length=20), nullable=False),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column("raw_response_id", sa.BigInteger(), nullable=True),
        sa.Column("ingestion_run_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "generation_quantity >= 0",
            name=op.f(
                "ck_regional_waste_statistics_regional_waste_statistics_generation_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            "recycling_quantity >= 0",
            name=op.f(
                "ck_regional_waste_statistics_regional_waste_statistics_recycling_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            "incineration_quantity >= 0",
            name=op.f(
                "ck_regional_waste_statistics_regional_waste_statistics_incineration_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            "landfill_quantity >= 0",
            name=op.f(
                "ck_regional_waste_statistics_regional_waste_statistics_landfill_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            "other_treatment_quantity >= 0",
            name=op.f("ck_regional_waste_statistics_regional_waste_statistics_other_nonnegative"),
        ),
        sa.CheckConstraint(
            "total_treatment_quantity >= 0",
            name=op.f(
                "ck_regional_waste_statistics_regional_waste_statistics_total_treatment_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            f"accounting_basis = '{_ACCOUNTING_BASIS}'",
            name=op.f(
                "ck_regional_waste_statistics_regional_waste_statistics_accounting_basis_allowed"
            ),
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"],
            ["ingestion_runs.run_id"],
            name=op.f("fk_regional_waste_statistics_ingestion_run_id_ingestion_runs"),
        ),
        sa.ForeignKeyConstraint(
            ["raw_response_id"],
            ["raw_api_responses.id"],
            name=op.f("fk_regional_waste_statistics_raw_response_id_raw_api_responses"),
        ),
        sa.ForeignKeyConstraint(
            ["region_id"],
            ["regions.id"],
            name=op.f("fk_regional_waste_statistics_region_id_regions"),
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["data_sources.source_id"],
            name=op.f("fk_regional_waste_statistics_source_id_data_sources"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_regional_waste_statistics")),
        sa.UniqueConstraint(
            "region_id",
            "reference_year",
            "source_pid",
            "waste_category_name",
            name="uq_regional_waste_statistics_grain",
        ),
    )
    op.create_index(
        op.f("ix_regional_waste_statistics_region_id"),
        "regional_waste_statistics",
        ["region_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_regional_waste_statistics_source_id"),
        "regional_waste_statistics",
        ["source_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_regional_waste_statistics_source_pid"),
        "regional_waste_statistics",
        ["source_pid"],
        unique=False,
    )
    op.create_index(
        op.f("ix_regional_waste_statistics_waste_stream"),
        "regional_waste_statistics",
        ["waste_stream"],
        unique=False,
    )
    op.create_index(
        op.f("ix_regional_waste_statistics_ingestion_run_id"),
        "regional_waste_statistics",
        ["ingestion_run_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_regional_waste_statistics_ingestion_run_id"),
        table_name="regional_waste_statistics",
    )
    op.drop_index(
        op.f("ix_regional_waste_statistics_waste_stream"),
        table_name="regional_waste_statistics",
    )
    op.drop_index(
        op.f("ix_regional_waste_statistics_source_pid"),
        table_name="regional_waste_statistics",
    )
    op.drop_index(
        op.f("ix_regional_waste_statistics_source_id"),
        table_name="regional_waste_statistics",
    )
    op.drop_index(
        op.f("ix_regional_waste_statistics_region_id"),
        table_name="regional_waste_statistics",
    )
    op.drop_table("regional_waste_statistics")
