"""RCIS waste-treatment facilities schema (Phase 2.3).

Adds the normalized ``waste_treatment_facilities`` table for the six facility
PIDs (NTN031/032/033 public, NTN040/043/046 private). One row per facility per
PID per reference year; accounting basis
``FACILITY_LOCATION_BASED_THROUGHPUT``. A nullable POINT ``geometry`` column is
added for a later VWorld geocoding phase and is not populated here.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ACCOUNTING_BASIS = "FACILITY_LOCATION_BASED_THROUGHPUT"


def _q() -> sa.Numeric:
    return sa.Numeric(precision=20, scale=6)


def upgrade() -> None:
    op.create_table(
        "waste_treatment_facilities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_id", sa.String(length=50), nullable=False),
        sa.Column("source_pid", sa.String(length=20), nullable=False),
        sa.Column("official_dataset_name", sa.String(length=200), nullable=False),
        sa.Column("reference_year", sa.Integer(), nullable=False),
        sa.Column("reference_period", sa.String(length=50), nullable=False),
        sa.Column("facility_category", sa.String(length=40), nullable=False),
        sa.Column("facility_kind", sa.String(length=20), nullable=False),
        sa.Column("ownership", sa.String(length=20), nullable=False),
        sa.Column("facility_name", sa.String(length=300), nullable=False),
        sa.Column("operator_name", sa.String(length=200), nullable=True),
        sa.Column("address", sa.String(length=500), nullable=False),
        sa.Column("source_seq", sa.String(length=20), nullable=True),
        sa.Column("source_row_index", sa.Integer(), nullable=False),
        sa.Column("region_id", sa.Integer(), nullable=True),
        sa.Column("rcis_sido_name", sa.String(length=50), nullable=False),
        sa.Column("rcis_sigungu_name", sa.String(length=50), nullable=False),
        sa.Column("source_geographic_level", sa.String(length=20), nullable=False),
        sa.Column("region_mapping_status", sa.String(length=20), nullable=False),
        sa.Column(
            "geometry",
            Geometry(geometry_type="POINT", srid=4326),
            nullable=True,
        ),
        sa.Column("capacity_quantity", _q(), nullable=True),
        sa.Column("capacity_unit", sa.String(length=20), nullable=True),
        sa.Column("throughput_quantity", _q(), nullable=True),
        sa.Column("throughput_unit", sa.String(length=20), nullable=True),
        sa.Column("residue_total", _q(), nullable=True),
        sa.Column("residue_recycling", _q(), nullable=True),
        sa.Column("residue_incineration", _q(), nullable=True),
        sa.Column("residue_landfill", _q(), nullable=True),
        sa.Column("residue_other", _q(), nullable=True),
        sa.Column("fill_area_m2", _q(), nullable=True),
        sa.Column("total_fill_capacity_m3", _q(), nullable=True),
        sa.Column("remaining_fill_capacity_m3", _q(), nullable=True),
        sa.Column("fill_quantity_m3", _q(), nullable=True),
        sa.Column("fill_use_period", sa.String(length=50), nullable=True),
        sa.Column("permit_date", sa.String(length=20), nullable=True),
        sa.Column("return_date", sa.String(length=20), nullable=True),
        sa.Column("quantity_note", sa.Text(), nullable=True),
        sa.Column("accounting_basis", sa.String(length=40), nullable=False),
        sa.Column("source_fields", postgresql.JSONB(), nullable=False),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column("raw_response_id", sa.BigInteger(), nullable=True),
        sa.Column("ingestion_run_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            f"accounting_basis = '{_ACCOUNTING_BASIS}'",
            name=op.f(
                "ck_waste_treatment_facilities_waste_treatment_facilities_accounting_basis_allowed"
            ),
        ),
        sa.CheckConstraint(
            "capacity_quantity IS NULL OR capacity_quantity >= 0",
            name=op.f(
                "ck_waste_treatment_facilities_waste_treatment_facilities_capacity_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            "throughput_quantity IS NULL OR throughput_quantity >= 0",
            name=op.f(
                "ck_waste_treatment_facilities_waste_treatment_facilities_throughput_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            "region_mapping_status IN ('EXACT_MATCH','REQUIRES_GEOCODE','UNMATCHED','AMBIGUOUS')",
            name=op.f(
                "ck_waste_treatment_facilities_waste_treatment_facilities_region_status_allowed"
            ),
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"],
            ["ingestion_runs.run_id"],
            name=op.f("fk_waste_treatment_facilities_ingestion_run_id_ingestion_runs"),
        ),
        sa.ForeignKeyConstraint(
            ["raw_response_id"],
            ["raw_api_responses.id"],
            name=op.f("fk_waste_treatment_facilities_raw_response_id_raw_api_responses"),
        ),
        sa.ForeignKeyConstraint(
            ["region_id"],
            ["regions.id"],
            name=op.f("fk_waste_treatment_facilities_region_id_regions"),
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["data_sources.source_id"],
            name=op.f("fk_waste_treatment_facilities_source_id_data_sources"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_waste_treatment_facilities")),
        sa.UniqueConstraint(
            "source_pid",
            "reference_year",
            "source_row_index",
            name="uq_waste_treatment_facilities_identity",
        ),
    )
    for column in (
        "source_id",
        "source_pid",
        "facility_category",
        "facility_kind",
        "ownership",
        "region_id",
        "region_mapping_status",
        "ingestion_run_id",
    ):
        op.create_index(
            op.f(f"ix_waste_treatment_facilities_{column}"),
            "waste_treatment_facilities",
            [column],
            unique=False,
        )


def downgrade() -> None:
    for column in (
        "ingestion_run_id",
        "region_mapping_status",
        "region_id",
        "ownership",
        "facility_kind",
        "facility_category",
        "source_pid",
        "source_id",
    ):
        op.drop_index(
            op.f(f"ix_waste_treatment_facilities_{column}"),
            table_name="waste_treatment_facilities",
        )
    op.drop_table("waste_treatment_facilities")
