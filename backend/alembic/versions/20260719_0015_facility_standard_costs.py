"""Versioned facility standard-cost (표준공사비) reference table + v2022dec seed.

Adds ``facility_standard_costs`` — one row per capacity band of the government
standard-cost table, per cost version and facility type — and idempotently seeds
the ``capex-standard-v2022dec`` version (price base date 2022-12-01, source
``2025년 폐기물처리시설 국고보조금 업무처리지침 붙임2`` p.211).

This is reviewed reference data used only to derive an ANALYTICAL standard
construction cost (억원/(톤·일) × 규모) — never an actual budget or approved
subsidy. Historical versions are retained; a new price base date is a new
``cost_version`` with its own migration. The seed values are duplicated here as a
self-contained snapshot; a unit test asserts they never diverge from
``analysis/facility_cost.STANDARD_COST_SEED``.

Revision ID: 0015
Revises: 0014
Create Date: 2026-07-19

"""

import datetime
from collections.abc import Sequence
from decimal import Decimal

import sqlalchemy as sa

from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "facility_standard_costs"
_COST_VERSION = "capex-standard-v2022dec"
_PRICE_BASE_DATE = datetime.date(2022, 12, 1)
_SOURCE_DOCUMENT = "2025년 폐기물처리시설 국고보조금 업무처리지침 붙임2"
_SOURCE_PAGE = "p.211"
_SOURCE_NOTE = (
    "표준공사비 단가(억원/(톤·일))는 국고보조금 업무처리지침의 시설 규모별 표준공사비 표를 "
    "그대로 옮긴 값입니다. 물가·설계 변경, 부지 여건, 실제 계약단가는 반영되지 않습니다."
)

_COST = sa.Numeric(precision=12, scale=6)
_CAPACITY = sa.Numeric(precision=14, scale=6)

# (facility_type, capacity_min, capacity_max, cost_per_capacity_bn). min/max are
# strings or None (unbounded). First band [0, upper]; middle bands (lower, upper];
# last band (lower, +inf). Self-contained snapshot of the v2022dec table.
_SEED_BANDS: tuple[tuple[str, str | None, str | None, str], ...] = (
    ("incineration_new", None, "30", "6.24"),
    ("incineration_new", "30", "50", "5.90"),
    ("incineration_new", "50", "100", "5.23"),
    ("incineration_new", "100", "200", "4.98"),
    ("incineration_new", "200", None, "4.57"),
    ("sorting_auto", None, "10", "5.97"),
    ("sorting_auto", "10", "20", "4.63"),
    ("sorting_auto", "20", "30", "3.60"),
    ("sorting_auto", "30", "40", "3.45"),
    ("sorting_auto", "40", "50", "3.31"),
    ("sorting_auto", "50", "60", "3.23"),
    ("sorting_auto", "60", "70", "2.98"),
    ("sorting_auto", "70", "80", "2.94"),
    ("sorting_auto", "80", "90", "2.92"),
    ("sorting_auto", "90", None, "2.90"),
)

_INDEXED_COLUMNS = ("cost_version", "facility_type")


def _seed_rows() -> list[dict[str, object]]:
    now = datetime.datetime.now(tz=datetime.UTC)
    rows: list[dict[str, object]] = []
    for facility_type, lo, hi, cost in _SEED_BANDS:
        rows.append(
            {
                "cost_version": _COST_VERSION,
                "facility_type": facility_type,
                "capacity_min_ton_per_day": None if lo is None else Decimal(lo),
                # Lower bound is inclusive only when unbounded (the first band);
                # bounded bands are lower-exclusive, upper-inclusive.
                "capacity_min_inclusive": lo is None,
                "capacity_max_ton_per_day": None if hi is None else Decimal(hi),
                "capacity_max_inclusive": hi is not None,
                "cost_per_capacity_bn": Decimal(cost),
                "price_base_date": _PRICE_BASE_DATE,
                "source_document": _SOURCE_DOCUMENT,
                "source_page": _SOURCE_PAGE,
                "source_note": _SOURCE_NOTE,
                "created_at": now,
            }
        )
    return rows


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("cost_version", sa.String(length=60), nullable=False),
        sa.Column("facility_type", sa.String(length=40), nullable=False),
        sa.Column("capacity_min_ton_per_day", _CAPACITY, nullable=True),
        sa.Column("capacity_min_inclusive", sa.Boolean(), nullable=False),
        sa.Column("capacity_max_ton_per_day", _CAPACITY, nullable=True),
        sa.Column("capacity_max_inclusive", sa.Boolean(), nullable=False),
        sa.Column("cost_per_capacity_bn", _COST, nullable=False),
        sa.Column("price_base_date", sa.Date(), nullable=False),
        sa.Column("source_document", sa.String(length=200), nullable=False),
        sa.Column("source_page", sa.String(length=40), nullable=False),
        sa.Column("source_note", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "cost_per_capacity_bn >= 0",
            name=op.f("ck_facility_standard_costs_facility_standard_costs_cost_nonnegative"),
        ),
        sa.CheckConstraint(
            "capacity_min_ton_per_day IS NULL OR capacity_min_ton_per_day >= 0",
            name=op.f("ck_facility_standard_costs_facility_standard_costs_min_nonnegative"),
        ),
        sa.CheckConstraint(
            "capacity_max_ton_per_day IS NULL OR capacity_max_ton_per_day >= 0",
            name=op.f("ck_facility_standard_costs_facility_standard_costs_max_nonnegative"),
        ),
        sa.CheckConstraint(
            "capacity_min_ton_per_day IS NULL"
            " OR capacity_max_ton_per_day IS NULL"
            " OR capacity_min_ton_per_day < capacity_max_ton_per_day",
            name=op.f("ck_facility_standard_costs_facility_standard_costs_interval_valid"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_facility_standard_costs")),
    )
    for column in _INDEXED_COLUMNS:
        op.create_index(
            op.f(f"ix_facility_standard_costs_{column}"), _TABLE, [column], unique=False
        )
    # NULL-safe uniqueness (a plain unique constraint treats NULL bounds as distinct):
    # COALESCE unbounded bounds to -1 (never a real, nonnegative value) so duplicate
    # first/last bands are rejected on both PostgreSQL and SQLite.
    op.create_index(
        "uq_facility_standard_costs_band",
        _TABLE,
        [
            "cost_version",
            "facility_type",
            sa.text("coalesce(capacity_min_ton_per_day, -1)"),
            sa.text("coalesce(capacity_max_ton_per_day, -1)"),
        ],
        unique=True,
    )

    # Idempotent seed: only insert the v2022dec rows if this version is absent, so
    # re-running the seed step never duplicates rows.
    bind = op.get_bind()
    existing = bind.execute(
        sa.text("SELECT COUNT(*) FROM facility_standard_costs WHERE cost_version = :v"),
        {"v": _COST_VERSION},
    ).scalar_one()
    if existing == 0:
        table = sa.table(
            _TABLE,
            sa.column("cost_version", sa.String),
            sa.column("facility_type", sa.String),
            sa.column("capacity_min_ton_per_day", _CAPACITY),
            sa.column("capacity_min_inclusive", sa.Boolean),
            sa.column("capacity_max_ton_per_day", _CAPACITY),
            sa.column("capacity_max_inclusive", sa.Boolean),
            sa.column("cost_per_capacity_bn", _COST),
            sa.column("price_base_date", sa.Date),
            sa.column("source_document", sa.String),
            sa.column("source_page", sa.String),
            sa.column("source_note", sa.String),
            sa.column("created_at", sa.DateTime(timezone=True)),
        )
        op.bulk_insert(table, _seed_rows())


def downgrade() -> None:
    for column in reversed(_INDEXED_COLUMNS):
        op.drop_index(op.f(f"ix_facility_standard_costs_{column}"), table_name=_TABLE)
    op.drop_table(_TABLE)
