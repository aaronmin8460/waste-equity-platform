"""Versioned facility standard-cost (표준공사비) reference table (Phase 4 V1).

One row per capacity band of the government standard-cost table, per cost version
and facility type. This is reviewed reference data (not ingested official metrics):
the 억원/(톤·일) unit cost is copied from the 국고보조금 업무처리지침 standard-cost
table and used only to derive an ANALYTICAL standard construction cost — never an
actual project budget or approved subsidy.

Historical versions are retained (never overwritten): a new price base date is a
new ``cost_version`` with its own rows, so past analyses stay reproducible. See
``src/.../analysis/facility_cost.py`` and ``docs/FACILITY_COST_MODEL_V1.md``.
"""

import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

# Exact-decimal storage for the 억원/(톤·일) standard unit cost. The source values
# have two decimals; six decimals of scale preserve them (and any future finer
# value) exactly with no binary floating-point error.
CostPerCapacity = Numeric(precision=12, scale=6, asdecimal=True)
# Capacity bounds in 톤/일; NULL means unbounded on that side.
Capacity = Numeric(precision=14, scale=6, asdecimal=True)


class FacilityStandardCost(Base):
    __tablename__ = "facility_standard_costs"
    __table_args__ = (
        # NULL-safe uniqueness: a plain unique constraint would treat NULL bounds as
        # distinct, so duplicate first bands (NULL, upper) or last bands (lower, NULL)
        # could slip in and make lookup_unit_cost find overlapping matches. COALESCE
        # to -1 (never a real value — capacities are nonnegative) normalizes NULLs so
        # a duplicate band is rejected on both SQLite and PostgreSQL.
        Index(
            "uq_facility_standard_costs_band",
            "cost_version",
            "facility_type",
            text("coalesce(capacity_min_ton_per_day, -1)"),
            text("coalesce(capacity_max_ton_per_day, -1)"),
            unique=True,
        ),
        CheckConstraint(
            "cost_per_capacity_bn >= 0",
            name="facility_standard_costs_cost_nonnegative",
        ),
        CheckConstraint(
            "capacity_min_ton_per_day IS NULL OR capacity_min_ton_per_day >= 0",
            name="facility_standard_costs_min_nonnegative",
        ),
        CheckConstraint(
            "capacity_max_ton_per_day IS NULL OR capacity_max_ton_per_day >= 0",
            name="facility_standard_costs_max_nonnegative",
        ),
        # Valid interval: when both bounds are present, min < max (bands are
        # half-open, so equal bounds would be an empty/degenerate band).
        CheckConstraint(
            "capacity_min_ton_per_day IS NULL"
            " OR capacity_max_ton_per_day IS NULL"
            " OR capacity_min_ton_per_day < capacity_max_ton_per_day",
            name="facility_standard_costs_interval_valid",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cost_version: Mapped[str] = mapped_column(String(60), index=True)
    facility_type: Mapped[str] = mapped_column(String(40), index=True)

    capacity_min_ton_per_day: Mapped[Decimal | None] = mapped_column(Capacity)
    capacity_min_inclusive: Mapped[bool] = mapped_column(Boolean)
    capacity_max_ton_per_day: Mapped[Decimal | None] = mapped_column(Capacity)
    capacity_max_inclusive: Mapped[bool] = mapped_column(Boolean)

    cost_per_capacity_bn: Mapped[Decimal] = mapped_column(CostPerCapacity)

    price_base_date: Mapped[datetime.date] = mapped_column(Date)
    source_document: Mapped[str] = mapped_column(String(200))
    source_page: Mapped[str] = mapped_column(String(40))
    source_note: Mapped[str | None] = mapped_column(String(500))

    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
