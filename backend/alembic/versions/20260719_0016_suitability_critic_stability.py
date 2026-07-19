"""CRITIC weight derivation + weight-sensitivity stability (Phase 4/5).

Adds run-level analytical metadata (``weight_derivation``, ``stability_definition``)
to ``suitability_analysis_runs`` and per-candidate stability fields
(``stable_count``, ``stability_class``, ``stability_membership``) to
``suitability_candidates``, plus two composite indexes for stability queries.

This migration is purely additive. Pre-existing rows keep empty derivation/
stability metadata and null stable_count/stability_class, so historical runs stay
interpretable and are never falsely backfilled with invented CRITIC or stability
results. No ingested source data is modified.

Revision ID: 0016
Revises: 0015
Create Date: 2026-07-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JsonVariant = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    # Run-level analytical metadata: non-null with an empty-object default so
    # pre-existing rows carry {} rather than NULL (historically interpretable).
    op.add_column(
        "suitability_analysis_runs",
        sa.Column(
            "weight_derivation",
            JsonVariant,
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    op.add_column(
        "suitability_analysis_runs",
        sa.Column(
            "stability_definition",
            JsonVariant,
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )

    # Per-candidate stability: stable_count / stability_class stay NULL for
    # pre-existing rows and for non-ELIGIBLE candidates (never presented stable);
    # stability_membership defaults to {}.
    op.add_column(
        "suitability_candidates",
        sa.Column("stable_count", sa.SmallInteger(), nullable=True),
    )
    op.add_column(
        "suitability_candidates",
        sa.Column("stability_class", sa.String(length=30), nullable=True),
    )
    op.add_column(
        "suitability_candidates",
        sa.Column(
            "stability_membership",
            JsonVariant,
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )

    op.create_index(
        "ix_suitability_candidates_run_stable",
        "suitability_candidates",
        ["analysis_run_id", "stable_count"],
    )
    op.create_index(
        "ix_suitability_candidates_run_stability_class",
        "suitability_candidates",
        ["analysis_run_id", "stability_class"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_suitability_candidates_run_stability_class", "suitability_candidates"
    )
    op.drop_index("ix_suitability_candidates_run_stable", "suitability_candidates")
    op.drop_column("suitability_candidates", "stability_membership")
    op.drop_column("suitability_candidates", "stability_class")
    op.drop_column("suitability_candidates", "stable_count")
    op.drop_column("suitability_analysis_runs", "stability_definition")
    op.drop_column("suitability_analysis_runs", "weight_derivation")
