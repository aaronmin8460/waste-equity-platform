"""Suitability analysis runs and candidate scores (Phase 5.4).

The suitability screen is a versioned, reproducible weighted composite over a
deterministic 500 m candidate grid. Each build is one ``SuitabilityAnalysisRun``
identified by an ``analysis_signature`` (a deterministic hash of the policy
version, grid version, reference year, boundary vintage, input structural
dataset-version ids, component reference periods, derivation version, and active
weight profile), so an identical build is idempotent and a changed policy or
input produces a distinct run without overwriting an earlier one.

``SuitabilityCandidate`` rows hold, per grid cell, the analytical status
(ELIGIBLE / REVIEW_REQUIRED / EXCLUDED), the four dimensionless component scores
and their raw source values, exclusion/review reasons, per-profile totals and
ranks, full per-component provenance, and the clipped cell geometry plus its
centroid — never a legal determination. See ``docs/SUITABILITY_POLICY_V1.md``.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

# JSONB on PostgreSQL, generic JSON elsewhere (unit tests use SQLite).
JsonVariant = JSON().with_variant(postgresql.JSONB(), "postgresql")

# Exact-decimal storage for dimensionless [0, 100] scores (four decimals).
Score = Numeric(precision=7, scale=4, asdecimal=True)


class SuitabilityAnalysisRun(Base):
    """One reproducible suitability build, keyed by a deterministic signature."""

    __tablename__ = "suitability_analysis_runs"
    __table_args__ = (
        Index("ix_suitability_analysis_runs_signature", "analysis_signature"),
        Index("ix_suitability_analysis_runs_status", "status"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    derivation_version: Mapped[str] = mapped_column(String(50))
    policy_version: Mapped[str] = mapped_column(String(50))
    candidate_grid_version: Mapped[str] = mapped_column(String(50))
    reference_year: Mapped[int] = mapped_column(Integer)
    # Administrative boundary vintage (region valid_from year) the run was
    # computed against, so a spatial result is reproducible against the same
    # geography.
    boundary_vintage: Mapped[str] = mapped_column(String(20))
    # Active weight profile whose totals/ranks populate the first-class candidate
    # columns; all profiles' totals/ranks are stored per candidate as well.
    weight_profile: Mapped[str] = mapped_column(String(30))
    # Deterministic sha-256 identity of the run (idempotency key).
    analysis_signature: Mapped[str] = mapped_column(String(64))
    # RUNNING, SUCCEEDED, or FAILED.
    status: Mapped[str] = mapped_column(String(20))
    candidate_count_total: Mapped[int] = mapped_column(Integer, default=0)
    candidate_count_eligible: Mapped[int] = mapped_column(Integer, default=0)
    candidate_count_review: Mapped[int] = mapped_column(Integer, default=0)
    candidate_count_excluded: Mapped[int] = mapped_column(Integer, default=0)
    # Input structural dataset-version ids (zoning/protected/road) used.
    input_dataset_version_ids: Mapped[Any] = mapped_column(JsonVariant, default=list)
    # Per-component source ids, reference periods, units, and accounting bases.
    input_provenance: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    # Snapshot of the policy applied (weights, profiles, distance curve,
    # classification summary) so the run is interpretable without the code.
    policy_snapshot: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    # Full weight profiles used ({profile: {component: weight}}).
    weight_profiles: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    started_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    error_category: Mapped[str | None] = mapped_column(String(50))
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class SuitabilityCandidate(Base):
    """One 500 m candidate cell scored within a suitability run."""

    __tablename__ = "suitability_candidates"
    __table_args__ = (
        UniqueConstraint(
            "analysis_run_id",
            "candidate_key",
            name="uq_suitability_candidates_run_key",
        ),
        Index("ix_suitability_candidates_status", "status"),
        Index("ix_suitability_candidates_total_score", "total_score"),
        Index("ix_suitability_candidates_rank", "rank"),
        Index("ix_suitability_candidates_sido", "sido_region_code"),
        Index("ix_suitability_candidates_sigungu", "sigungu_region_code"),
        # geoalchemy2 attaches the GiST spatial indexes on ``geometry`` and
        # ``centroid`` automatically.
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    analysis_run_id: Mapped[int] = mapped_column(
        ForeignKey("suitability_analysis_runs.id"), index=True
    )
    # Stable grid identity: ``<grid version>:<i>_<j>`` (EPSG:5179 cell indices).
    candidate_key: Mapped[str] = mapped_column(String(50))
    sido_region_code: Mapped[str | None] = mapped_column(String(20))
    sido_region_name: Mapped[str | None] = mapped_column(String(50))
    sigungu_region_code: Mapped[str | None] = mapped_column(String(20))
    sigungu_region_name: Mapped[str | None] = mapped_column(String(50))
    # ELIGIBLE, REVIEW_REQUIRED, or EXCLUDED (analytical status, not legal).
    status: Mapped[str] = mapped_column(String(20))
    # Official rank (eligible candidates only, active profile).
    rank: Mapped[int | None] = mapped_column(Integer)
    # Provisional composite for REVIEW_REQUIRED candidates (badged, never ranked).
    provisional_score: Mapped[Decimal | None] = mapped_column(Score)
    # Official composite for ELIGIBLE candidates (active profile).
    total_score: Mapped[Decimal | None] = mapped_column(Score)
    zoning_score: Mapped[Decimal | None] = mapped_column(Score)
    road_score: Mapped[Decimal | None] = mapped_column(Score)
    equity_score: Mapped[Decimal | None] = mapped_column(Score)
    demand_score: Mapped[Decimal | None] = mapped_column(Score)
    # {profile: total} and {profile: rank} for all sensitivity profiles.
    profile_totals: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    profile_ranks: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    # Raw component inputs (zoning class + code, nearest-road distance, raw
    # burden and demand values with unit/basis) kept separate from the scores.
    raw_components: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    exclusion_reasons: Mapped[Any] = mapped_column(JsonVariant, default=list)
    review_reasons: Mapped[Any] = mapped_column(JsonVariant, default=list)
    penalties: Mapped[Any] = mapped_column(JsonVariant, default=list)
    nearest_road_distance_m: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    nearest_road_provenance: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    # Per-component source id + reference period + unit + accounting basis.
    component_provenance: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    original_area_m2: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    clipped_area_m2: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    clipped_area_ratio: Mapped[Decimal] = mapped_column(Numeric(6, 5))
    centroid: Mapped[Any] = mapped_column(Geometry(geometry_type="POINT", srid=4326))
    geometry: Mapped[Any] = mapped_column(Geometry(geometry_type="MULTIPOLYGON", srid=4326))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
