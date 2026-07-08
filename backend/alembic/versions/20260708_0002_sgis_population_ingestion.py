"""SGIS canonical geography and population ingestion schema.

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-08

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ingestion_runs",
        sa.Column("reference_period", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "ingestion_runs",
        sa.Column("transformation_version", sa.String(length=100), nullable=True),
    )

    op.add_column(
        "raw_api_responses",
        sa.Column("reference_period", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "raw_api_responses",
        sa.Column("transformation_version", sa.String(length=100), nullable=True),
    )
    op.create_unique_constraint(
        op.f("uq_raw_api_responses_source_id"),
        "raw_api_responses",
        [
            "source_id",
            "endpoint_identifier",
            "reference_period",
            "response_hash",
            "transformation_version",
        ],
    )

    op.add_column(
        "regions",
        sa.Column("source_id", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "regions",
        sa.Column("source_administrative_code", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "regions",
        sa.Column("source_geographic_level", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "regions",
        sa.Column("boundary_reference_period", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "regions",
        sa.Column("boundary_source_crs", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "regions",
        sa.Column("boundary_target_crs", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "regions",
        sa.Column("boundary_geometry_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "regions",
        sa.Column("boundary_retrieved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_regions_source_id_data_sources"),
        "regions",
        "data_sources",
        ["source_id"],
        ["source_id"],
    )
    op.create_index(
        op.f("ix_regions_source_administrative_code"),
        "regions",
        ["source_administrative_code"],
        unique=False,
    )

    op.add_column(
        "region_code_map",
        sa.Column(
            "mapping_status",
            sa.String(length=40),
            nullable=False,
            server_default="NEEDS_REVIEW",
        ),
    )
    op.add_column(
        "region_code_map",
        sa.Column(
            "cross_source_review_status",
            sa.String(length=40),
            nullable=False,
            server_default="NEEDS_REVIEW",
        ),
    )
    op.add_column(
        "region_code_map",
        sa.Column("mapping_source", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "region_code_map",
        sa.Column("source_reference_period", sa.String(length=50), nullable=True),
    )

    op.create_table(
        "regional_population",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("region_id", sa.Integer(), nullable=False),
        sa.Column("reference_year", sa.Integer(), nullable=False),
        sa.Column("reference_period", sa.String(length=50), nullable=False),
        sa.Column("population", sa.BigInteger(), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=False),
        sa.Column("population_definition", sa.String(length=100), nullable=False),
        sa.Column("source_id", sa.String(length=50), nullable=False),
        sa.Column("source_administrative_code", sa.String(length=20), nullable=False),
        sa.Column("source_geographic_level", sa.String(length=20), nullable=False),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column("raw_response_id", sa.BigInteger(), nullable=True),
        sa.Column("ingestion_run_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "population >= 0",
            name=op.f("ck_regional_population_regional_population_population_nonnegative"),
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"],
            ["ingestion_runs.run_id"],
            name=op.f("fk_regional_population_ingestion_run_id_ingestion_runs"),
        ),
        sa.ForeignKeyConstraint(
            ["raw_response_id"],
            ["raw_api_responses.id"],
            name=op.f("fk_regional_population_raw_response_id_raw_api_responses"),
        ),
        sa.ForeignKeyConstraint(
            ["region_id"],
            ["regions.id"],
            name=op.f("fk_regional_population_region_id_regions"),
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["data_sources.source_id"],
            name=op.f("fk_regional_population_source_id_data_sources"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_regional_population")),
        sa.UniqueConstraint(
            "region_id",
            "reference_year",
            "source_id",
            "population_definition",
            name=op.f("uq_regional_population_region_id"),
        ),
    )
    op.create_index(
        op.f("ix_regional_population_ingestion_run_id"),
        "regional_population",
        ["ingestion_run_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_regional_population_region_id"),
        "regional_population",
        ["region_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_regional_population_source_administrative_code"),
        "regional_population",
        ["source_administrative_code"],
        unique=False,
    )
    op.create_index(
        op.f("ix_regional_population_source_id"),
        "regional_population",
        ["source_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_regional_population_source_id"), table_name="regional_population")
    op.drop_index(
        op.f("ix_regional_population_source_administrative_code"),
        table_name="regional_population",
    )
    op.drop_index(op.f("ix_regional_population_region_id"), table_name="regional_population")
    op.drop_index(
        op.f("ix_regional_population_ingestion_run_id"),
        table_name="regional_population",
    )
    op.drop_table("regional_population")

    op.drop_column("region_code_map", "source_reference_period")
    op.drop_column("region_code_map", "mapping_source")
    op.drop_column("region_code_map", "cross_source_review_status")
    op.drop_column("region_code_map", "mapping_status")

    op.drop_index(op.f("ix_regions_source_administrative_code"), table_name="regions")
    op.drop_constraint(op.f("fk_regions_source_id_data_sources"), "regions", type_="foreignkey")
    op.drop_column("regions", "boundary_retrieved_at")
    op.drop_column("regions", "boundary_geometry_hash")
    op.drop_column("regions", "boundary_target_crs")
    op.drop_column("regions", "boundary_source_crs")
    op.drop_column("regions", "boundary_reference_period")
    op.drop_column("regions", "source_geographic_level")
    op.drop_column("regions", "source_administrative_code")
    op.drop_column("regions", "source_id")

    op.drop_constraint(op.f("uq_raw_api_responses_source_id"), "raw_api_responses", type_="unique")
    op.drop_column("raw_api_responses", "transformation_version")
    op.drop_column("raw_api_responses", "reference_period")

    op.drop_column("ingestion_runs", "transformation_version")
    op.drop_column("ingestion_runs", "reference_period")
