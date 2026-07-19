"""Support monthly population observations alongside the annual SGIS series.

``regional_population`` was built around one annual observation per
(region, year, source, definition). The MOIS resident-registration series
(행정안전부 주민등록 인구통계) is **monthly**, so twelve observations share a
single ``reference_year`` and would violate the existing annual unique
constraint. This migration is additive and preserves every existing SGIS row
byte-for-byte:

- ``reference_month`` (``YYYY-MM``, NULL for annual rows);
- ``population_temporal_granularity`` (``ANNUAL`` | ``MONTHLY``), backfilled to
  ``ANNUAL`` for every existing row, then made NOT NULL;
- ``population_definition_version`` and ``population_comparability_note``, so a
  series whose definition changed over time carries that fact with the data
  rather than only in prose.

The annual unique constraint is **replaced**, not dropped: two granularity-scoped
partial unique indexes keep the legacy annual guarantee exactly as strong while
admitting one row per month for a monthly series. A monthly row must carry a
``reference_month`` and an annual row must not — enforced by a check, so the two
grains can never blur.

Revision ID: 0014
Revises: 0013
Create Date: 2026-07-15

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Reviewed constants (mirrored from models/metadata.py) — duplicated here per the
# migration convention of not importing model types.
_GRANULARITY_ANNUAL = "ANNUAL"
_GRANULARITY_MONTHLY = "MONTHLY"
# The legacy annual unique constraint's real name, produced by the repo's
# "uq_%(table_name)s_%(column_0_name)s" naming convention (models/base.py) —
# verified against the live schema, not the SQLAlchemy/PostgreSQL default.
_LEGACY_UNIQUE = "uq_regional_population_region_id"


def upgrade() -> None:
    op.add_column(
        "regional_population",
        sa.Column("reference_month", sa.String(length=7), nullable=True),
    )
    op.add_column(
        "regional_population",
        sa.Column("population_temporal_granularity", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "regional_population",
        sa.Column("population_definition_version", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "regional_population",
        sa.Column("population_comparability_note", sa.Text(), nullable=True),
    )

    # Every pre-existing row is an annual SGIS observation. Backfill only the new
    # granularity column; no existing value is rewritten, relabelled, or removed.
    op.execute(
        sa.text(
            "UPDATE regional_population "
            "SET population_temporal_granularity = :annual "
            "WHERE population_temporal_granularity IS NULL"
        ).bindparams(annual=_GRANULARITY_ANNUAL)
    )
    op.alter_column(
        "regional_population",
        "population_temporal_granularity",
        existing_type=sa.String(length=20),
        nullable=False,
    )

    # The legacy annual unique constraint cannot survive a monthly series: twelve
    # MOIS months share one reference_year. Replace it with granularity-scoped
    # partial unique indexes that keep the annual guarantee identical.
    op.drop_constraint(_LEGACY_UNIQUE, "regional_population", type_="unique")
    op.create_index(
        "uq_regional_population_annual",
        "regional_population",
        ["region_id", "reference_year", "source_id", "population_definition"],
        unique=True,
        postgresql_where=sa.text(f"population_temporal_granularity = '{_GRANULARITY_ANNUAL}'"),
        sqlite_where=sa.text(f"population_temporal_granularity = '{_GRANULARITY_ANNUAL}'"),
    )
    op.create_index(
        "uq_regional_population_monthly",
        "regional_population",
        ["region_id", "reference_month", "source_id", "population_definition"],
        unique=True,
        postgresql_where=sa.text(f"population_temporal_granularity = '{_GRANULARITY_MONTHLY}'"),
        sqlite_where=sa.text(f"population_temporal_granularity = '{_GRANULARITY_MONTHLY}'"),
    )

    # A monthly row must name its month; an annual row must not carry one. This is
    # what stops a monthly value from ever being read as an annual denominator.
    op.create_check_constraint(
        "regional_population_granularity_month_consistent",
        "regional_population",
        f"(population_temporal_granularity = '{_GRANULARITY_MONTHLY}'"
        " AND reference_month IS NOT NULL)"
        f" OR (population_temporal_granularity = '{_GRANULARITY_ANNUAL}'"
        " AND reference_month IS NULL)",
    )
    op.create_check_constraint(
        "regional_population_reference_month_format",
        "regional_population",
        "reference_month IS NULL OR reference_month LIKE '____-__'",
    )

    # Query indexes for the landfill per-capita resolver: it looks up an exact
    # month for a small set of regions, filtered by source and definition.
    op.create_index(
        "ix_regional_population_reference_month",
        "regional_population",
        ["reference_month"],
    )
    op.create_index(
        "ix_regional_population_month_lookup",
        "regional_population",
        ["region_id", "reference_month", "source_id", "population_definition"],
    )
    op.create_index(
        "ix_regional_population_year_lookup",
        "regional_population",
        ["region_id", "reference_year", "source_id", "population_definition"],
    )


def downgrade() -> None:
    # Monthly rows cannot be represented by the annual schema. Converting them to
    # annual rows would fabricate a year-level observation the source never
    # published (and twelve of them would collide), so the downgrade refuses
    # rather than silently mangling official data. Delete the monthly series
    # explicitly first if the downgrade is genuinely intended.
    monthly = op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM regional_population "
            "WHERE population_temporal_granularity = :monthly"
        ).bindparams(monthly=_GRANULARITY_MONTHLY)
    )
    if monthly:
        raise RuntimeError(
            f"Refusing to downgrade: {monthly} monthly population rows exist and the "
            "annual schema cannot represent them. A downgrade must not convert monthly "
            "observations into annual ones. Delete the monthly series deliberately "
            "(e.g. DELETE FROM regional_population WHERE population_temporal_granularity "
            "= 'MONTHLY') and re-run this downgrade."
        )

    op.drop_index("ix_regional_population_year_lookup", table_name="regional_population")
    op.drop_index("ix_regional_population_month_lookup", table_name="regional_population")
    op.drop_index("ix_regional_population_reference_month", table_name="regional_population")
    op.drop_constraint(
        "regional_population_reference_month_format", "regional_population", type_="check"
    )
    op.drop_constraint(
        "regional_population_granularity_month_consistent", "regional_population", type_="check"
    )
    op.drop_index("uq_regional_population_monthly", table_name="regional_population")
    op.drop_index("uq_regional_population_annual", table_name="regional_population")
    op.create_unique_constraint(
        _LEGACY_UNIQUE,
        "regional_population",
        ["region_id", "reference_year", "source_id", "population_definition"],
    )
    op.drop_column("regional_population", "population_comparability_note")
    op.drop_column("regional_population", "population_definition_version")
    op.drop_column("regional_population", "population_temporal_granularity")
    op.drop_column("regional_population", "reference_month")
