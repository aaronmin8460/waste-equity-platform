"""Facility geocoding provenance columns (Phase 2.4, VWorld geocoder).

Adds geocode provenance to ``waste_treatment_facilities`` and widens the
``region_mapping_status`` check constraint with ``GEOCODED_MATCH`` (a
multi-district-city facility resolved to a single SGIS region via
point-in-polygon on the geocoded point). Coordinates are only ever written
from successful VWorld geocoder responses; failures keep geometry NULL with
``geocode_status = 'FAILED'``.

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-09

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "waste_treatment_facilities"
STATUS_CONSTRAINT = "waste_treatment_facilities_region_status_allowed"
GEOCODE_STATUS_CONSTRAINT = "waste_treatment_facilities_geocode_status_allowed"


def upgrade() -> None:
    op.add_column(TABLE, sa.Column("geocode_status", sa.String(length=20), nullable=True))
    op.add_column(TABLE, sa.Column("geocode_request_address", sa.String(length=600), nullable=True))
    op.add_column(TABLE, sa.Column("geocode_address_type", sa.String(length=10), nullable=True))
    op.add_column(TABLE, sa.Column("geocode_refined_address", sa.String(length=600), nullable=True))
    op.add_column(TABLE, sa.Column("geocode_level4ac", sa.String(length=10), nullable=True))
    op.add_column(TABLE, sa.Column("geocode_crs", sa.String(length=20), nullable=True))
    op.add_column(TABLE, sa.Column("geocode_note", sa.Text(), nullable=True))
    op.add_column(TABLE, sa.Column("geocoded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        TABLE,
        sa.Column(
            "geocode_raw_response_id",
            sa.BigInteger(),
            sa.ForeignKey("raw_api_responses.id"),
            nullable=True,
        ),
    )
    op.create_index("ix_waste_treatment_facilities_geocode_status", TABLE, ["geocode_status"])

    op.drop_constraint(STATUS_CONSTRAINT, TABLE, type_="check")
    op.create_check_constraint(
        STATUS_CONSTRAINT,
        TABLE,
        "region_mapping_status IN "
        "('EXACT_MATCH','GEOCODED_MATCH','REQUIRES_GEOCODE','UNMATCHED','AMBIGUOUS')",
    )
    op.create_check_constraint(
        GEOCODE_STATUS_CONSTRAINT,
        TABLE,
        "geocode_status IS NULL OR geocode_status IN ('SUCCEEDED','FAILED')",
    )


def downgrade() -> None:
    # Revert geocoding-derived data before restoring the narrower constraint:
    # GEOCODED_MATCH rows return to REQUIRES_GEOCODE with no region, and
    # geometry written by the geocoder is cleared because its provenance
    # columns are being dropped.
    op.execute(
        f"UPDATE {TABLE} SET region_mapping_status = 'REQUIRES_GEOCODE', region_id = NULL "
        "WHERE region_mapping_status = 'GEOCODED_MATCH'"
    )
    op.execute(f"UPDATE {TABLE} SET geometry = NULL WHERE geocode_status IS NOT NULL")

    op.drop_constraint(GEOCODE_STATUS_CONSTRAINT, TABLE, type_="check")
    op.drop_constraint(STATUS_CONSTRAINT, TABLE, type_="check")
    op.create_check_constraint(
        STATUS_CONSTRAINT,
        TABLE,
        "region_mapping_status IN ('EXACT_MATCH','REQUIRES_GEOCODE','UNMATCHED','AMBIGUOUS')",
    )
    op.drop_index("ix_waste_treatment_facilities_geocode_status", TABLE)
    op.drop_column(TABLE, "geocode_raw_response_id")
    op.drop_column(TABLE, "geocoded_at")
    op.drop_column(TABLE, "geocode_note")
    op.drop_column(TABLE, "geocode_crs")
    op.drop_column(TABLE, "geocode_level4ac")
    op.drop_column(TABLE, "geocode_refined_address")
    op.drop_column(TABLE, "geocode_address_type")
    op.drop_column(TABLE, "geocode_request_address")
    op.drop_column(TABLE, "geocode_status")
