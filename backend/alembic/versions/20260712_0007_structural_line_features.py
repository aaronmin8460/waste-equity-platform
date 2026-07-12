"""Structural line features table for road/transport layers (Phase 2.5B).

Adds ``structural_line_features`` (MULTILINESTRING/4326) so road and transport
structural layers are not forced into the polygon-only ``structural_features``
table. It reuses ``structural_dataset_versions`` for versioning/provenance and
shares the fingerprint-based idempotency contract. The GIST spatial index on
``geometry`` is created automatically by geoalchemy2.

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-12

"""

from collections.abc import Sequence

import sqlalchemy as sa
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JsonVariant = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "structural_line_features",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "dataset_version_id",
            sa.BigInteger(),
            sa.ForeignKey("structural_dataset_versions.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("layer_identifier", sa.String(length=100), nullable=False, index=True),
        sa.Column("provider_feature_id", sa.String(length=200), nullable=True),
        sa.Column("layer_category", sa.String(length=40), nullable=False),
        sa.Column("official_layer_code", sa.String(length=20), nullable=False),
        sa.Column("official_layer_name", sa.String(length=100), nullable=False),
        sa.Column("target_region_code", sa.String(length=20), nullable=True),
        sa.Column("target_region_name", sa.String(length=50), nullable=True),
        sa.Column("source_attributes", JsonVariant, nullable=True),
        sa.Column(
            "geometry",
            Geometry(geometry_type="MULTILINESTRING", srid=4326),
            nullable=False,
        ),
        sa.Column("feature_fingerprint", sa.String(length=64), nullable=False, index=True),
        sa.Column("source_provenance", JsonVariant, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "dataset_version_id",
            "feature_fingerprint",
            name="uq_structural_line_features_version_fingerprint",
        ),
    )
    op.create_index(
        "ix_structural_line_features_category", "structural_line_features", ["layer_category"]
    )
    op.create_index(
        "ix_structural_line_features_target_region",
        "structural_line_features",
        ["target_region_code"],
    )


def downgrade() -> None:
    op.drop_index("ix_structural_line_features_target_region", "structural_line_features")
    op.drop_index("ix_structural_line_features_category", "structural_line_features")
    op.drop_table("structural_line_features")
