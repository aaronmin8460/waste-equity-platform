"""Run-level component-model identity for suitability analysis runs.

Adds ``component_model_version`` and ``component_order`` to
``suitability_analysis_runs`` so a stored run can answer *"which component model
produced this run?"* without consulting whatever source code happens to be
deployed. Neither ``policy_version`` nor ``derivation_version`` can answer it —
both have already moved for reasons unrelated to component identity — and
``candidate_grid_version`` describes geometry. Component **order** is stored
explicitly because it is load-bearing for the CRITIC correlation matrix, the
scenario hash payload, and export column sequences, and is not recoverable from a
JSON object's key order.

**This is labelling, not a semantic backfill.** The constant server defaults state
what every pre-existing row already is: the candidate table physically cannot hold
any component model other than zoning/road/equity/demand at this revision. No
score, rank, weight, classification, status, reason, or geometry is read, written,
transformed, or backfilled. Historical rows are otherwise byte-identical after this
migration, exactly as ``0016`` defaulted ``weight_derivation`` /
``stability_definition`` to ``{}`` rather than inventing CRITIC results for
pre-CRITIC runs.

No index is added: ``suitability_analysis_runs`` holds tens of rows, so a
``component_model_version`` index would not be selected by the planner.

``NOT NULL`` with a constant server default is a metadata-only ``ADD COLUMN`` on
PostgreSQL 11+, so no table rewrite occurs at any scale.

Downgrade drops both columns. Nothing references them and no stored analytical
value depends on them, so the drop is inert for historical runs under all
conditions. Deploy order is migrate-then-app; roll back app-then-migrate.

Revision ID: 0022
Revises: 0021
Create Date: 2026-08-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JsonVariant = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

# Literal, not imported: a migration must keep meaning what it meant on the day it
# ran, even after the application's registry constants move on. The application
# side of this pair lives in
# ``waste_equity_backend.analysis.suitability.component_model`` and is pinned equal
# to these literals by ``test_suitability_component_model.py``.
HISTORICAL_COMPONENT_MODEL = "suitability-components-zred-v1"
HISTORICAL_COMPONENT_ORDER = '["zoning", "road", "equity", "demand"]'


def upgrade() -> None:
    op.add_column(
        "suitability_analysis_runs",
        sa.Column(
            "component_model_version",
            sa.String(length=50),
            nullable=False,
            server_default=sa.text(f"'{HISTORICAL_COMPONENT_MODEL}'"),
        ),
    )
    op.add_column(
        "suitability_analysis_runs",
        sa.Column(
            "component_order",
            JsonVariant,
            nullable=False,
            server_default=sa.text(f"'{HISTORICAL_COMPONENT_ORDER}'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("suitability_analysis_runs", "component_order")
    op.drop_column("suitability_analysis_runs", "component_model_version")
