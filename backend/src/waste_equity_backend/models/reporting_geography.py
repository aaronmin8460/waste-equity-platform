"""RCIS waste reporting geography (metric-scoped derived regions).

Some RCIS regional waste PIDs report seven large Gyeonggi cities
(고양·부천·성남·수원·안산·안양·용인) at the **city** level, while SGIS 2024
represents each city as its administrative-district (구) children (20 in total).
A city-level RCIS record therefore has no native SGIS region to attach to, and
the child districts have SGIS boundaries and population but no district-level
RCIS waste value.

These tables add an explicit, additive **reporting geography** used only for the
RCIS waste-generation and per-capita-waste metrics. Native ``regions`` and their
SGIS codes are untouched; the seven cities get stable platform reporting codes in
a namespace (``KR-RCISRG-*``) that cannot be mistaken for an SGIS code
(``KR-SGIS-*``), a deterministic ``ST_Union`` of their SGIS child boundaries as a
**derived** display geometry, and the source-native RCIS city value stored once
per PID.

Design note: the city statistic is the source-native RCIS city total copied
verbatim — it is not aggregated. Only the display geometry (union of child
boundaries) and the per-capita denominator (sum of child SGIS populations) are
derived, and both are labelled ``DERIVED``. City rows live here, never in
``regional_waste_statistics``, so the suitability engine and facility-burden joins
(which read that table by native ``region_id``) are unaffected.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .waste import ACCOUNTING_BASIS_ORIGIN_TREATMENT, Quantity

# Reporting geography type: the seven cities are a deterministic union of their
# SGIS child districts. Native exact-match RCIS regions are served from
# ``regions`` and are not duplicated here.
REPORTING_GEOGRAPHY_DERIVED_CITY_UNION = "DERIVED_CITY_UNION"
DERIVED_GEOMETRY_METHOD_ST_UNION = "ST_UNION_OF_SGIS_CHILDREN"
SOURCE_REPORTING_LEVEL_CITY = "CITY"


class WasteReportingRegion(Base):
    """One RCIS waste reporting region whose geometry is derived from SGIS.

    Only the coarser-than-SGIS reporting regions (the seven Gyeonggi cities) are
    stored here; native exact-match regions keep their ``regions`` rows.
    """

    __tablename__ = "waste_reporting_regions"
    __table_args__ = (UniqueConstraint("reporting_region_code", "valid_from"),)

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    # Minted platform code, namespace ``KR-RCISRG-*`` (RCIS reporting region).
    # Never an SGIS ``adm_cd`` and never an RCIS code (RCIS provides no code).
    reporting_region_code: Mapped[str] = mapped_column(String(30), index=True)
    reporting_region_name: Mapped[str] = mapped_column(String(100))
    # Source-preserved RCIS name pair (사도 sido, 시군구 sigungu).
    rcis_sido_name: Mapped[str] = mapped_column(String(50))
    rcis_sigungu_name: Mapped[str] = mapped_column(String(50))
    # DERIVED_CITY_UNION for the seven cities.
    reporting_geography_type: Mapped[str] = mapped_column(String(30))
    # NATIVE or DERIVED; DERIVED for these seven.
    geometry_kind: Mapped[str] = mapped_column(String(20))
    # ST_UNION_OF_SGIS_CHILDREN.
    derived_geometry_method: Mapped[str] = mapped_column(String(50))
    # Source reporting level of the metric (CITY).
    source_reporting_level: Mapped[str] = mapped_column(String(20))
    child_region_count: Mapped[int] = mapped_column(Integer)
    geometry: Mapped[Any] = mapped_column(Geometry(geometry_type="MULTIPOLYGON", srid=4326))
    # Provenance of the derived boundary: the SGIS child boundaries it unions.
    boundary_source_id: Mapped[str | None] = mapped_column(ForeignKey("data_sources.source_id"))
    boundary_reference_period: Mapped[str] = mapped_column(String(50))
    boundary_source_crs: Mapped[str | None] = mapped_column(String(20))
    boundary_target_crs: Mapped[str] = mapped_column(String(20))
    boundary_geometry_hash: Mapped[str | None] = mapped_column(String(64))
    boundary_retrieved_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    valid_from: Mapped[datetime.date] = mapped_column(nullable=False)
    valid_to: Mapped[datetime.date | None] = mapped_column()
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class WasteReportingRegionMember(Base):
    """A native SGIS child region that composes a derived reporting region.

    ``UNIQUE(child_region_id)`` guarantees a child district can belong to at most
    one reporting city, so a city value can never be attached to a child that is
    also claimed by another city.
    """

    __tablename__ = "waste_reporting_region_members"
    __table_args__ = (
        UniqueConstraint("child_region_id"),
        UniqueConstraint(
            "reporting_region_id",
            "child_region_code",
            name="uq_waste_reporting_region_members_pair",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    reporting_region_id: Mapped[int] = mapped_column(
        ForeignKey("waste_reporting_regions.id"), index=True
    )
    child_region_id: Mapped[int] = mapped_column(ForeignKey("regions.id"), index=True)
    child_region_code: Mapped[str] = mapped_column(String(20))
    child_region_name: Mapped[str] = mapped_column(String(100))


class ReportingRegionWasteStatistics(Base):
    """Source-native RCIS city waste total, keyed by reporting region.

    Mirrors the quantity and provenance columns of ``regional_waste_statistics``
    but is keyed by ``reporting_region_id`` instead of native ``region_id``. The
    stored value is the RCIS city total verbatim (not aggregated); the
    ``source_geographic_level`` is ``CITY``.
    """

    __tablename__ = "reporting_region_waste_statistics"
    __table_args__ = (
        UniqueConstraint(
            "reporting_region_id",
            "reference_year",
            "source_pid",
            "waste_category_name",
            name="uq_reporting_region_waste_statistics_grain",
        ),
        CheckConstraint(
            "generation_quantity >= 0",
            name="reporting_region_waste_statistics_generation_nonnegative",
        ),
        CheckConstraint(
            "recycling_quantity >= 0",
            name="reporting_region_waste_statistics_recycling_nonnegative",
        ),
        CheckConstraint(
            "incineration_quantity >= 0",
            name="reporting_region_waste_statistics_incineration_nonnegative",
        ),
        CheckConstraint(
            "landfill_quantity >= 0",
            name="reporting_region_waste_statistics_landfill_nonnegative",
        ),
        CheckConstraint(
            "other_treatment_quantity >= 0",
            name="reporting_region_waste_statistics_other_nonnegative",
        ),
        CheckConstraint(
            "total_treatment_quantity >= 0",
            name="reporting_region_waste_statistics_total_treatment_nonnegative",
        ),
        CheckConstraint(
            f"accounting_basis = '{ACCOUNTING_BASIS_ORIGIN_TREATMENT}'",
            name="reporting_region_waste_statistics_accounting_basis_allowed",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    reporting_region_id: Mapped[int] = mapped_column(
        ForeignKey("waste_reporting_regions.id"), index=True
    )
    reference_year: Mapped[int] = mapped_column(Integer)
    reference_period: Mapped[str] = mapped_column(String(50))
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.source_id"), index=True)
    source_pid: Mapped[str] = mapped_column(String(20), index=True)
    official_dataset_name: Mapped[str] = mapped_column(String(200))
    waste_stream: Mapped[str] = mapped_column(String(40), index=True)
    waste_category_code: Mapped[str | None] = mapped_column(String(40))
    waste_category_name: Mapped[str] = mapped_column(String(100))

    generation_quantity: Mapped[Decimal] = mapped_column(Quantity)
    recycling_quantity: Mapped[Decimal] = mapped_column(Quantity)
    incineration_quantity: Mapped[Decimal] = mapped_column(Quantity)
    landfill_quantity: Mapped[Decimal] = mapped_column(Quantity)
    other_treatment_quantity: Mapped[Decimal] = mapped_column(Quantity)
    total_treatment_quantity: Mapped[Decimal] = mapped_column(Quantity)
    total_treatment_is_derived: Mapped[bool] = mapped_column()
    treatment_reconciliation_difference: Mapped[Decimal] = mapped_column(Quantity)

    quantity_unit: Mapped[str] = mapped_column(String(20))
    accounting_basis: Mapped[str] = mapped_column(String(40))

    rcis_sido_name: Mapped[str] = mapped_column(String(50))
    rcis_sigungu_name: Mapped[str] = mapped_column(String(50))
    # CITY — the source reporting level of this record.
    source_geographic_level: Mapped[str] = mapped_column(String(20))
    reporting_geography_type: Mapped[str] = mapped_column(String(30))

    retrieved_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    transformation_version: Mapped[str] = mapped_column(String(100))
    raw_response_id: Mapped[int | None] = mapped_column(ForeignKey("raw_api_responses.id"))
    ingestion_run_id: Mapped[int] = mapped_column(ForeignKey("ingestion_runs.run_id"), index=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
