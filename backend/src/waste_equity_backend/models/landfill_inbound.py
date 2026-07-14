"""Capital-region Sudokwon Landfill inbound flow (metropolitan → destination).

Two official Sudokwon Landfill Corporation (수도권매립지관리공사) datasets share an
exact 1:1 monthly grain and are stored together as one canonical fact table,
``landfill_inbound_monthly``:

- inbound **quantity** (odcloud ``15064381`` ``반입량``, kg) — ``OFFICIAL_REPORTED_VALUE``
- inbound **fee** (odcloud ``15064394`` ``반입수수료``, KRW) — ``OFFICIAL_REPORTED_VALUE``

Both datasets declare origin at the **metropolitan** level only — 서울시 / 인천시 /
경기도 — and the destination is the single Sudokwon Landfill for every row (the
whole dataset is that corporation's integrated inbound record; there is no
per-row destination field). This is the platform's only source-declared
origin→destination waste flow and is strictly metropolitan: a 광역 value is
**never** disaggregated to a city, county, or district, and no city/district →
landfill arrow is ever drawn.

The accounting basis is a distinct third basis,
``VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW``, kept separate from
``ORIGIN_BASED_TREATMENT_OUTCOME`` (``regional_waste_statistics``) and
``FACILITY_LOCATION_BASED_THROUGHPUT`` (``waste_treatment_facilities``); the
three bases are never summed, differenced, or ratioed against each other.

Effective fee per tonne (``inbound_fee_krw / (quantity_kg / 1000)``) is an
``OFFICIAL_INPUTS_DERIVED_VALUE`` computed in the API layer, never stored; it is
null when quantity is zero.
"""

import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .waste import Quantity

# Distinct accounting basis: a verified metropolitan origin → single-destination
# inbound flow. Never merged with ORIGIN_BASED_TREATMENT_OUTCOME or
# FACILITY_LOCATION_BASED_THROUGHPUT.
ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW = "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW"

# The single destination facility implied by the whole dataset (a reviewed
# constant, not a per-row source field and not a similarly-named RCIS facility).
DESTINATION_SUDOKWON_LANDFILL = "SUDOKWON_LANDFILL"

# Origin is metropolitan-only; the source declares exactly these three 광역 units.
ORIGIN_LEVEL_METROPOLITAN = "SIDO"
ALLOWED_ORIGIN_REGION_CODES = ("KR-SGIS-11", "KR-SGIS-28", "KR-SGIS-41")

# Evidence classes (docs/SL_LANDFILL_DATA_DICTIONARY.md). Stored rows are always
# OFFICIAL_REPORTED_VALUE; OFFICIAL_INPUTS_DERIVED_VALUE labels API aggregates.
EVIDENCE_OFFICIAL_REPORTED = "OFFICIAL_REPORTED_VALUE"
EVIDENCE_OFFICIAL_DERIVED = "OFFICIAL_INPUTS_DERIVED_VALUE"

# Official odcloud dataset ids (Sudokwon Landfill Corporation).
QUANTITY_SOURCE_DATASET_ID = "15064381"
FEE_SOURCE_DATASET_ID = "15064394"

QUANTITY_UNIT_KG = "kg"
FEE_CURRENCY_KRW = "KRW"

# Exact-decimal storage for official KRW fees (whole won; two decimals of scale
# preserve every observed value exactly without binary floating-point error).
FeeAmount = Numeric(precision=20, scale=2, asdecimal=True)

_ORIGIN_CODES_SQL = ", ".join(f"'{code}'" for code in ALLOWED_ORIGIN_REGION_CODES)
_EVIDENCE_SQL = f"'{EVIDENCE_OFFICIAL_REPORTED}', '{EVIDENCE_OFFICIAL_DERIVED}'"


class LandfillInboundMonthly(Base):
    """One official monthly inbound record: (month × metropolitan origin × waste).

    Quantity (``15064381``) and fee (``15064394``) join 1:1 on the canonical grain
    ``마감년월 × 소재지 × 폐기물명`` (verified 9,212 / 9,212, 0 inbound-only,
    0 fee-only), so both official reported values live on one row.
    """

    __tablename__ = "landfill_inbound_monthly"
    __table_args__ = (
        UniqueConstraint(
            "reference_month",
            "origin_region_code",
            "destination_code",
            "waste_name",
            name="uq_landfill_inbound_monthly_grain",
        ),
        CheckConstraint(
            "quantity_kg >= 0",
            name="landfill_inbound_monthly_quantity_nonnegative",
        ),
        CheckConstraint(
            "inbound_fee_krw >= 0",
            name="landfill_inbound_monthly_fee_nonnegative",
        ),
        CheckConstraint(
            f"origin_region_code IN ({_ORIGIN_CODES_SQL})",
            name="landfill_inbound_monthly_origin_allowed",
        ),
        CheckConstraint(
            f"origin_region_level = '{ORIGIN_LEVEL_METROPOLITAN}'",
            name="landfill_inbound_monthly_origin_level_allowed",
        ),
        CheckConstraint(
            f"destination_code = '{DESTINATION_SUDOKWON_LANDFILL}'",
            name="landfill_inbound_monthly_destination_allowed",
        ),
        CheckConstraint(
            f"accounting_basis = '{ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW}'",
            name="landfill_inbound_monthly_accounting_basis_allowed",
        ),
        CheckConstraint(
            f"quantity_evidence_status IN ({_EVIDENCE_SQL})",
            name="landfill_inbound_monthly_quantity_evidence_allowed",
        ),
        CheckConstraint(
            f"fee_evidence_status IN ({_EVIDENCE_SQL})",
            name="landfill_inbound_monthly_fee_evidence_allowed",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Reference month as source `마감년월` (YYYY-MM); reference_year is the parsed
    # calendar year kept for fast annual filtering/aggregation.
    reference_month: Mapped[str] = mapped_column(String(7), index=True)
    reference_year: Mapped[int] = mapped_column(Integer, index=True)

    # Origin is metropolitan-only. origin_region_code is the platform canonical
    # SGIS sido code (KR-SGIS-11/28/41); origin_source_name is `소재지`/`광역지자체명`
    # verbatim (서울시/인천시/경기도). origin_region_level is always SIDO.
    origin_region_code: Mapped[str] = mapped_column(String(20), index=True)
    origin_source_name: Mapped[str] = mapped_column(String(50))
    origin_region_level: Mapped[str] = mapped_column(String(20))

    # Single destination facility implied by the dataset scope.
    destination_code: Mapped[str] = mapped_column(String(40))

    # Source waste name `폐기물명` (no code on the inbound dataset); join key.
    waste_name: Mapped[str] = mapped_column(String(100), index=True)

    # Official reported values.
    quantity_kg: Mapped[Decimal] = mapped_column(Quantity)
    inbound_fee_krw: Mapped[Decimal] = mapped_column(FeeAmount)
    quantity_unit: Mapped[str] = mapped_column(String(20))
    fee_currency: Mapped[str] = mapped_column(String(10))

    accounting_basis: Mapped[str] = mapped_column(String(60))

    # Dual source provenance (two official datasets, one 1:1 row).
    quantity_source_dataset_id: Mapped[str] = mapped_column(
        ForeignKey("data_sources.source_id"), index=True
    )
    quantity_source_snapshot_uuid: Mapped[str] = mapped_column(String(60))
    quantity_source_snapshot_date: Mapped[datetime.date | None] = mapped_column(Date)
    fee_source_dataset_id: Mapped[str] = mapped_column(
        ForeignKey("data_sources.source_id"), index=True
    )
    fee_source_snapshot_uuid: Mapped[str] = mapped_column(String(60))
    fee_source_snapshot_date: Mapped[datetime.date | None] = mapped_column(Date)

    quantity_evidence_status: Mapped[str] = mapped_column(String(40))
    fee_evidence_status: Mapped[str] = mapped_column(String(40))

    # Standard ingestion provenance linkage.
    retrieved_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    transformation_version: Mapped[str] = mapped_column(String(100))
    quantity_raw_response_id: Mapped[int | None] = mapped_column(
        ForeignKey("raw_api_responses.id")
    )
    fee_raw_response_id: Mapped[int | None] = mapped_column(ForeignKey("raw_api_responses.id"))
    ingestion_run_id: Mapped[int] = mapped_column(ForeignKey("ingestion_runs.run_id"), index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
