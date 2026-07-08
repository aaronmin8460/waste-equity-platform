"""Region and region-code crosswalk tables.

Regions are versioned by validity dates because administrative structures
change (for example the 2026 Incheon restructuring). RCIS responses carry
Korean region names only (Phase 0.7 finding), so the crosswalk stores the
observed RCIS name pair alongside any code-based identifiers.
"""

import datetime
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Region(Base):
    __tablename__ = "regions"
    __table_args__ = (UniqueConstraint("region_code", "valid_from"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    region_code: Mapped[str] = mapped_column(String(20), index=True)
    region_name: Mapped[str] = mapped_column(String(100))
    # SIDO or SIGUNGU; the common analytical geography is the lowest level
    # consistently supported by all required sources.
    region_level: Mapped[str] = mapped_column(String(20))
    parent_region_code: Mapped[str | None] = mapped_column(String(20), index=True)
    geometry: Mapped[Any | None] = mapped_column(Geometry(geometry_type="MULTIPOLYGON", srid=4326))
    source_id: Mapped[str | None] = mapped_column(ForeignKey("data_sources.source_id"))
    source_administrative_code: Mapped[str | None] = mapped_column(String(20), index=True)
    source_geographic_level: Mapped[str | None] = mapped_column(String(20))
    boundary_reference_period: Mapped[str | None] = mapped_column(String(50))
    boundary_source_crs: Mapped[str | None] = mapped_column(String(20))
    boundary_target_crs: Mapped[str | None] = mapped_column(String(20))
    boundary_geometry_hash: Mapped[str | None] = mapped_column(String(64))
    boundary_retrieved_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    valid_from: Mapped[datetime.date] = mapped_column(Date)
    valid_to: Mapped[datetime.date | None] = mapped_column(Date)


class RegionCodeMap(Base):
    __tablename__ = "region_code_map"
    __table_args__ = (UniqueConstraint("canonical_region_code", "valid_from"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    canonical_region_code: Mapped[str] = mapped_column(String(20), index=True)
    sgis_code: Mapped[str | None] = mapped_column(String(20))
    rcis_code: Mapped[str | None] = mapped_column(String(20))
    # RCIS returns Korean names without codes; the name pair is the join key.
    rcis_sido_name: Mapped[str | None] = mapped_column(String(50))
    rcis_sigungu_name: Mapped[str | None] = mapped_column(String(50))
    vworld_code: Mapped[str | None] = mapped_column(String(20))
    airkorea_name: Mapped[str | None] = mapped_column(String(50))
    kma_grid_x: Mapped[int | None] = mapped_column(Integer)
    kma_grid_y: Mapped[int | None] = mapped_column(Integer)
    mapping_status: Mapped[str] = mapped_column(String(40), default="NEEDS_REVIEW")
    cross_source_review_status: Mapped[str] = mapped_column(String(40), default="NEEDS_REVIEW")
    mapping_source: Mapped[str | None] = mapped_column(String(100))
    source_reference_period: Mapped[str | None] = mapped_column(String(50))
    valid_from: Mapped[datetime.date] = mapped_column(Date)
    valid_to: Mapped[datetime.date | None] = mapped_column(Date)
