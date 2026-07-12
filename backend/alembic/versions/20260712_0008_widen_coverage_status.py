"""Widen structural_dataset_versions.coverage_status to 40 chars (Phase 2.5B).

The coverage vocabulary gained ``COMPLETE_FOR_AVAILABLE_SOURCES`` (30 chars) for
packages that are complete over every officially-published source while some
per-layer sources are documented as officially unavailable. The original
VARCHAR(20) cannot hold it, so widen the column to VARCHAR(40).

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-12

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "structural_dataset_versions",
        "coverage_status",
        existing_type=sa.String(length=20),
        type_=sa.String(length=40),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "structural_dataset_versions",
        "coverage_status",
        existing_type=sa.String(length=40),
        type_=sa.String(length=20),
        existing_nullable=False,
    )
