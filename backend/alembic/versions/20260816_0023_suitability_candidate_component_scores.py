"""Candidate-level version-aware component scores.

Adds ``suitability_candidates.component_scores`` — a ``{component: "decimal
string"}`` map — as the storage location for every component model that is not the
historical four-column one. The four legacy ``*_score`` columns are **not** altered,
renamed, dropped, or read: they remain the sole authoritative storage for the runs
that used them, and a run of any later component model writes them NULL. The
load-bearing property is that a successor quantity has no legacy column to be
cross-wired into — a NULL column and a separate versioned map cannot be silently
confused, whereas eight adjacent ``Numeric(7,4)`` columns can.

**No backfill, and backfilling would be actively wrong.** Every existing row gets
``{}``. Copying a historical component score into ``component_scores`` would create
a second copy of an authoritative analytical value that can later drift from the
first, and would make "``component_scores`` is populated" stop meaning "this run's
scores live in the version-aware map".

No index. ``component_scores`` is not a filter predicate on any read path (the
ranking/filtering contract runs on the indexed ``rank`` column and the
``profile_totals`` / ``profile_ranks`` maps), so a GIN index would add write cost on
tens of thousands of rows per run for no read benefit. If scenario ranking over the
map ever measures poorly on real PostGIS data, the remedy is a generated column or a
per-component expression index, added as its own later migration.

``{}`` is ~1 byte of JSONB per row and the constant default makes this a
metadata-only ``ADD COLUMN`` on PostgreSQL 11+, so no table rewrite occurs.

**Rollback constraint.** Dropping this column is safe only *before* the first run of
a non-historical component model is written: after that, those rows' legacy columns
are NULL and hold nothing to fall back on, so the drop destroys their scores.
Historical runs are unaffected by the downgrade under all conditions.

Revision ID: 0023
Revises: 0022
Create Date: 2026-08-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JsonVariant = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column(
        "suitability_candidates",
        sa.Column(
            "component_scores",
            JsonVariant,
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )


def downgrade() -> None:
    # Safe only before the first non-historical component-model run exists; see the
    # rollback constraint in this module's docstring.
    op.drop_column("suitability_candidates", "component_scores")
