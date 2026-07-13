"""Active-selection flag for structural dataset versions (Phase 2.5B remediation).

Adds ``structural_dataset_versions.is_active`` (``BOOLEAN NOT NULL DEFAULT true``)
so the suitability engine can restrict input resolution, protected-feature
spatial intersections, coverage-gap computation, and the analysis-signature
inputs to an explicitly selected set of dataset versions. Existing rows are
backfilled to ``true`` by the column default, which is a semantic no-op: every
version that participated before this migration keeps participating. No
historical provenance field (provider, checksum, reference_date, coverage_matrix,
feature counts) is read or modified — only the new selection column is added.

This is the schema half of the Gyeonggi UM901 (습지보호지역) effective-coverage
remediation: a newly obtained, approved official version can satisfy coverage for
a region/layer that an older version recorded as OFFICIAL_SOURCE_UNAVAILABLE,
without ever rewriting that older, immutable record.

Revision ID: 0011
Revises: 0010
Create Date: 2026-07-13

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "structural_dataset_versions",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("structural_dataset_versions", "is_active")
