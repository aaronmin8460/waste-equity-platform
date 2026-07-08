"""Normalized regional waste generation and treatment statistics (RCIS).

The RCIS generation PIDs report, per region and waste category, annual
generation and how that generated waste was treated by disposition method. The
accounting basis is ``ORIGIN_BASED_TREATMENT_OUTCOME`` (Phase 0.7 finding): the
treatment fields describe how the reporting region's own generated waste was
treated, not the throughput of facilities located in the region. See
``docs/API_CONTRACTS/waste_statistics.md``.

Canonical row grain: one row per (region, reference year, source PID). Each row
carries the region-level grand total across all waste categories for that PID's
waste stream. Deeper category and treatment-actor breakdowns and pseudo-total
rows (``전국``/``합계``/``소계``) are preserved only in the sanitized raw
response, never as canonical rows.
"""

import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

# The only accounting basis this table is allowed to store. Facility-location
# throughput and any origin-to-destination interpretation are out of scope.
ACCOUNTING_BASIS_ORIGIN_TREATMENT = "ORIGIN_BASED_TREATMENT_OUTCOME"

# Exact-decimal storage for official 톤/년 quantities. Observed source precision
# is at most three decimals; six decimals of scale preserve every observed value
# exactly without binary floating-point error.
Quantity = Numeric(precision=20, scale=6, asdecimal=True)


class RegionalWasteStatistics(Base):
    __tablename__ = "regional_waste_statistics"
    __table_args__ = (
        UniqueConstraint(
            "region_id",
            "reference_year",
            "source_pid",
            "waste_category_name",
            name="uq_regional_waste_statistics_grain",
        ),
        CheckConstraint(
            "generation_quantity >= 0",
            name="regional_waste_statistics_generation_nonnegative",
        ),
        CheckConstraint(
            "recycling_quantity >= 0",
            name="regional_waste_statistics_recycling_nonnegative",
        ),
        CheckConstraint(
            "incineration_quantity >= 0",
            name="regional_waste_statistics_incineration_nonnegative",
        ),
        CheckConstraint(
            "landfill_quantity >= 0",
            name="regional_waste_statistics_landfill_nonnegative",
        ),
        CheckConstraint(
            "other_treatment_quantity >= 0",
            name="regional_waste_statistics_other_nonnegative",
        ),
        CheckConstraint(
            "total_treatment_quantity >= 0",
            name="regional_waste_statistics_total_treatment_nonnegative",
        ),
        CheckConstraint(
            f"accounting_basis = '{ACCOUNTING_BASIS_ORIGIN_TREATMENT}'",
            name="regional_waste_statistics_accounting_basis_allowed",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    region_id: Mapped[int] = mapped_column(ForeignKey("regions.id"), index=True)
    reference_year: Mapped[int] = mapped_column(Integer)
    reference_period: Mapped[str] = mapped_column(String(50))
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.source_id"), index=True)
    source_pid: Mapped[str] = mapped_column(String(20), index=True)
    official_dataset_name: Mapped[str] = mapped_column(String(200))
    # PID-level stream classification (HOUSEHOLD, BUSINESS_NON_FACILITY,
    # INDUSTRIAL_FACILITY, CONSTRUCTION).
    waste_stream: Mapped[str] = mapped_column(String(40), index=True)
    # RCIS provides no numeric waste-category code for the grand-total row.
    waste_category_code: Mapped[str | None] = mapped_column(String(40))
    # Source-preserved grand-total label (총계 / 합계).
    waste_category_name: Mapped[str] = mapped_column(String(100))

    generation_quantity: Mapped[Decimal] = mapped_column(Quantity)
    recycling_quantity: Mapped[Decimal] = mapped_column(Quantity)
    incineration_quantity: Mapped[Decimal] = mapped_column(Quantity)
    landfill_quantity: Mapped[Decimal] = mapped_column(Quantity)
    other_treatment_quantity: Mapped[Decimal] = mapped_column(Quantity)
    # Derived: the official response has no single total-treatment column, so
    # this is the transparent sum of the four disposition components.
    total_treatment_quantity: Mapped[Decimal] = mapped_column(Quantity)
    total_treatment_is_derived: Mapped[bool] = mapped_column()
    # generation_quantity - total_treatment_quantity, retained for transparency;
    # observed to be zero because origin-based splits reconcile to generation.
    treatment_reconciliation_difference: Mapped[Decimal] = mapped_column(Quantity)

    quantity_unit: Mapped[str] = mapped_column(String(20))
    accounting_basis: Mapped[str] = mapped_column(String(40))

    rcis_sido_name: Mapped[str] = mapped_column(String(50))
    rcis_sigungu_name: Mapped[str] = mapped_column(String(50))
    source_geographic_level: Mapped[str] = mapped_column(String(20))

    retrieved_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    transformation_version: Mapped[str] = mapped_column(String(100))
    raw_response_id: Mapped[int | None] = mapped_column(ForeignKey("raw_api_responses.id"))
    ingestion_run_id: Mapped[int] = mapped_column(ForeignKey("ingestion_runs.run_id"), index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
