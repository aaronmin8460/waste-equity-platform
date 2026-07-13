"""Add RCIS metric reporting geography (seven Gyeonggi city reporting regions).

Purely additive: three new tables and nothing else. No column, constraint, or
index of any existing table is changed, so every existing row in ``regions``,
``regional_population``, ``regional_waste_statistics``,
``waste_treatment_facilities``, ``structural_*``, and ``suitability_*`` keeps its
exact meaning. The suitability engine and facility-burden joins read
``regional_waste_statistics`` by native ``region_id``; keeping the derived
city-level waste rows in the separate ``reporting_region_waste_statistics`` table
guarantees they are untouched.

- ``waste_reporting_regions`` — the coarser-than-SGIS reporting regions (the seven
  Gyeonggi cities RCIS reports at city level). ``geometry`` is a derived
  ``ST_Union`` of the SGIS child boundaries; the geoalchemy2 ``Geometry`` column
  auto-creates its GiST index, matching the ``regions`` table.
- ``waste_reporting_region_members`` — the SGIS child lineage; ``UNIQUE`` on
  ``child_region_id`` prevents a child from belonging to two reporting cities.
- ``reporting_region_waste_statistics`` — the source-native RCIS city waste
  totals, keyed by ``reporting_region_id``, mirroring the quantity/provenance
  columns and non-negativity/accounting-basis checks of
  ``regional_waste_statistics``.

Revision ID: 0012
Revises: 0011
Create Date: 2026-07-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from geoalchemy2 import Geometry

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ACCOUNTING_BASIS = "ORIGIN_BASED_TREATMENT_OUTCOME"
_BIGINT = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _quantity() -> sa.Numeric:
    return sa.Numeric(precision=20, scale=6)


def upgrade() -> None:
    op.create_table(
        "waste_reporting_regions",
        sa.Column("id", _BIGINT, nullable=False),
        sa.Column("reporting_region_code", sa.String(length=30), nullable=False),
        sa.Column("reporting_region_name", sa.String(length=100), nullable=False),
        sa.Column("rcis_sido_name", sa.String(length=50), nullable=False),
        sa.Column("rcis_sigungu_name", sa.String(length=50), nullable=False),
        sa.Column("reporting_geography_type", sa.String(length=30), nullable=False),
        sa.Column("geometry_kind", sa.String(length=20), nullable=False),
        sa.Column("derived_geometry_method", sa.String(length=50), nullable=False),
        sa.Column("source_reporting_level", sa.String(length=20), nullable=False),
        sa.Column("child_region_count", sa.Integer(), nullable=False),
        sa.Column(
            "geometry",
            Geometry(geometry_type="MULTIPOLYGON", srid=4326),
            nullable=False,
        ),
        sa.Column("boundary_source_id", sa.String(length=50), nullable=True),
        sa.Column("boundary_reference_period", sa.String(length=50), nullable=False),
        sa.Column("boundary_source_crs", sa.String(length=20), nullable=True),
        sa.Column("boundary_target_crs", sa.String(length=20), nullable=False),
        sa.Column("boundary_geometry_hash", sa.String(length=64), nullable=True),
        sa.Column("boundary_retrieved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["boundary_source_id"],
            ["data_sources.source_id"],
            name=op.f("fk_waste_reporting_regions_boundary_source_id_data_sources"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_waste_reporting_regions")),
        sa.UniqueConstraint(
            "reporting_region_code",
            "valid_from",
            name=op.f("uq_waste_reporting_regions_reporting_region_code"),
        ),
    )
    op.create_index(
        op.f("ix_waste_reporting_regions_reporting_region_code"),
        "waste_reporting_regions",
        ["reporting_region_code"],
        unique=False,
    )

    op.create_table(
        "waste_reporting_region_members",
        sa.Column("id", _BIGINT, nullable=False),
        sa.Column("reporting_region_id", _BIGINT, nullable=False),
        sa.Column("child_region_id", sa.Integer(), nullable=False),
        sa.Column("child_region_code", sa.String(length=20), nullable=False),
        sa.Column("child_region_name", sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(
            ["child_region_id"],
            ["regions.id"],
            name=op.f("fk_waste_reporting_region_members_child_region_id_regions"),
        ),
        sa.ForeignKeyConstraint(
            ["reporting_region_id"],
            ["waste_reporting_regions.id"],
            name=op.f(
                "fk_waste_reporting_region_members_reporting_region_id_waste_reporting_regions"
            ),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_waste_reporting_region_members")),
        sa.UniqueConstraint(
            "child_region_id",
            name=op.f("uq_waste_reporting_region_members_child_region_id"),
        ),
        sa.UniqueConstraint(
            "reporting_region_id",
            "child_region_code",
            name="uq_waste_reporting_region_members_pair",
        ),
    )
    op.create_index(
        op.f("ix_waste_reporting_region_members_child_region_id"),
        "waste_reporting_region_members",
        ["child_region_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_waste_reporting_region_members_reporting_region_id"),
        "waste_reporting_region_members",
        ["reporting_region_id"],
        unique=False,
    )

    op.create_table(
        "reporting_region_waste_statistics",
        sa.Column("id", _BIGINT, nullable=False),
        sa.Column("reporting_region_id", _BIGINT, nullable=False),
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
        sa.Column("reporting_geography_type", sa.String(length=30), nullable=False),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column("raw_response_id", _BIGINT, nullable=True),
        sa.Column("ingestion_run_id", _BIGINT, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "generation_quantity >= 0",
            name=op.f(
                "ck_reporting_region_waste_statistics_reporting_region_waste_statistics_generation_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            "recycling_quantity >= 0",
            name=op.f(
                "ck_reporting_region_waste_statistics_reporting_region_waste_statistics_recycling_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            "incineration_quantity >= 0",
            name=op.f(
                "ck_reporting_region_waste_statistics_reporting_region_waste_statistics_incineration_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            "landfill_quantity >= 0",
            name=op.f(
                "ck_reporting_region_waste_statistics_reporting_region_waste_statistics_landfill_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            "other_treatment_quantity >= 0",
            name=op.f(
                "ck_reporting_region_waste_statistics_reporting_region_waste_statistics_other_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            "total_treatment_quantity >= 0",
            name=op.f(
                "ck_reporting_region_waste_statistics_reporting_region_waste_statistics_total_treatment_nonnegative"
            ),
        ),
        sa.CheckConstraint(
            f"accounting_basis = '{_ACCOUNTING_BASIS}'",
            name=op.f(
                "ck_reporting_region_waste_statistics_reporting_region_waste_statistics_accounting_basis_allowed"
            ),
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"],
            ["ingestion_runs.run_id"],
            name=op.f("fk_reporting_region_waste_statistics_ingestion_run_id_ingestion_runs"),
        ),
        sa.ForeignKeyConstraint(
            ["raw_response_id"],
            ["raw_api_responses.id"],
            name=op.f("fk_reporting_region_waste_statistics_raw_response_id_raw_api_responses"),
        ),
        sa.ForeignKeyConstraint(
            ["reporting_region_id"],
            ["waste_reporting_regions.id"],
            name=op.f(
                "fk_reporting_region_waste_statistics_reporting_region_id_waste_reporting_regions"
            ),
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["data_sources.source_id"],
            name=op.f("fk_reporting_region_waste_statistics_source_id_data_sources"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reporting_region_waste_statistics")),
        sa.UniqueConstraint(
            "reporting_region_id",
            "reference_year",
            "source_pid",
            "waste_category_name",
            name="uq_reporting_region_waste_statistics_grain",
        ),
    )
    op.create_index(
        op.f("ix_reporting_region_waste_statistics_ingestion_run_id"),
        "reporting_region_waste_statistics",
        ["ingestion_run_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_reporting_region_waste_statistics_reporting_region_id"),
        "reporting_region_waste_statistics",
        ["reporting_region_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_reporting_region_waste_statistics_source_id"),
        "reporting_region_waste_statistics",
        ["source_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_reporting_region_waste_statistics_source_pid"),
        "reporting_region_waste_statistics",
        ["source_pid"],
        unique=False,
    )
    op.create_index(
        op.f("ix_reporting_region_waste_statistics_waste_stream"),
        "reporting_region_waste_statistics",
        ["waste_stream"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_reporting_region_waste_statistics_waste_stream"),
        table_name="reporting_region_waste_statistics",
    )
    op.drop_index(
        op.f("ix_reporting_region_waste_statistics_source_pid"),
        table_name="reporting_region_waste_statistics",
    )
    op.drop_index(
        op.f("ix_reporting_region_waste_statistics_source_id"),
        table_name="reporting_region_waste_statistics",
    )
    op.drop_index(
        op.f("ix_reporting_region_waste_statistics_reporting_region_id"),
        table_name="reporting_region_waste_statistics",
    )
    op.drop_index(
        op.f("ix_reporting_region_waste_statistics_ingestion_run_id"),
        table_name="reporting_region_waste_statistics",
    )
    op.drop_table("reporting_region_waste_statistics")

    op.drop_index(
        op.f("ix_waste_reporting_region_members_reporting_region_id"),
        table_name="waste_reporting_region_members",
    )
    op.drop_index(
        op.f("ix_waste_reporting_region_members_child_region_id"),
        table_name="waste_reporting_region_members",
    )
    op.drop_table("waste_reporting_region_members")

    op.drop_index(
        op.f("ix_waste_reporting_regions_reporting_region_code"),
        table_name="waste_reporting_regions",
    )
    op.drop_table("waste_reporting_regions")
