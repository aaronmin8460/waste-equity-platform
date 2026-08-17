"""Suitability analysis runs and candidate scores (Phase 5.4).

The suitability screen is a versioned, reproducible weighted composite over a
deterministic 500 m candidate grid. Each build is one ``SuitabilityAnalysisRun``
identified by an ``analysis_signature`` (a deterministic hash of the policy
version, grid version, reference year, boundary vintage, input structural
dataset-version ids, component reference periods, derivation version, and active
weight profile), so an identical build is idempotent and a changed policy or
input produces a distinct run without overwriting an earlier one.

``SuitabilityCandidate`` rows hold, per grid cell, the analytical status
(ELIGIBLE / REVIEW_REQUIRED / EXCLUDED), the dimensionless component scores and
their raw source values, exclusion/review reasons, per-profile totals and ranks,
full per-component provenance, and the clipped cell geometry plus its centroid —
never a legal determination. See ``docs/SUITABILITY_POLICY_V1.md``.

Each run also records **which component model produced it**
(``component_model_version`` + ``component_order``), because neither
``policy_version`` nor ``derivation_version`` can answer that — both have already
moved for reasons unrelated to component identity. The historical model's four
``*_score`` columns stay the sole authoritative storage for the runs that used
them; any later component model stores its scores in the version-aware
``component_scores`` map and leaves those four columns NULL, so no successor
quantity has a legacy column to be cross-wired into. See
``docs/SUITABILITY_COMPONENT_MODEL_CONTRACT.md``.
"""

from __future__ import annotations

import datetime
import json
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
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from ..analysis.suitability.component_model import (
    COMPONENT_MODEL_HISTORICAL,
    COMPONENT_ORDER_HISTORICAL,
)
from .base import Base

# JSONB on PostgreSQL, generic JSON elsewhere (unit tests use SQLite).
JsonVariant = JSON().with_variant(postgresql.JSONB(), "postgresql")

# Exact-decimal storage for dimensionless [0, 100] scores (four decimals).
Score = Numeric(precision=7, scale=4, asdecimal=True)

# Constant server-side defaults that *label* every pre-existing run with the
# component model it already used. The candidate table physically cannot hold any
# other component model at the time these columns are added, so the label records a
# fact that is already true — no score, rank, weight, classification, status,
# reason, or geometry is read or written to establish it.
_HISTORICAL_COMPONENT_ORDER_JSON = json.dumps(list(COMPONENT_ORDER_HISTORICAL))


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
    # Which component model produced this run, and in which order its components
    # are enumerated. Order is stored explicitly because it is load-bearing for the
    # CRITIC correlation matrix, the scenario hash payload, and every export column
    # sequence — and it is NOT recoverable from a JSON object's key order.
    #
    # The Python-side default is the historical model, matching the server default,
    # so an ORM-constructed run is labelled with the model it can actually hold. A
    # writer for any other component model must set both fields explicitly; a
    # mismatched pair is rejected by
    # ``analysis.suitability.component_model.validate_run_model_identity``, which
    # makes mislabelling a non-historical run as historical fail loudly rather than
    # serve successor numbers under historical names.
    component_model_version: Mapped[str] = mapped_column(
        String(50),
        default=COMPONENT_MODEL_HISTORICAL,
        server_default=text(f"'{COMPONENT_MODEL_HISTORICAL}'"),
    )
    component_order: Mapped[Any] = mapped_column(
        JsonVariant,
        default=lambda: list(COMPONENT_ORDER_HISTORICAL),
        server_default=text(f"'{_HISTORICAL_COMPONENT_ORDER_JSON}'"),
    )
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
    # Full *actual* run weight profiles ({profile: {component: weight}}), including
    # the run-specific ``critic`` vector (data-derived, not a policy constant).
    weight_profiles: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    # Transparent CRITIC derivation metadata (method, population count, means,
    # standard deviations, correlation matrix, information values, weights,
    # zero-variance criteria, disclaimer). Empty {} for historical/pre-CRITIC runs.
    weight_derivation: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    # Stability definition (compared profiles, top fraction, cutoff rank, classes,
    # applicability rule, disclaimer). Empty {} for historical/pre-stability runs.
    stability_definition: Mapped[Any] = mapped_column(JsonVariant, default=dict)
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
        Index("ix_suitability_candidates_run_stable", "analysis_run_id", "stable_count"),
        Index(
            "ix_suitability_candidates_run_stability_class",
            "analysis_run_id",
            "stability_class",
        ),
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
    # The historical (zred-v1) component model's four scores. These remain the sole
    # authoritative storage for every run of that model and are never rewritten,
    # renamed, or copied elsewhere. For a run of any other component model they are
    # NULL and are never reused to carry a different quantity.
    zoning_score: Mapped[Decimal | None] = mapped_column(Score)
    road_score: Mapped[Decimal | None] = mapped_column(Score)
    equity_score: Mapped[Decimal | None] = mapped_column(Score)
    demand_score: Mapped[Decimal | None] = mapped_column(Score)
    # Version-aware component scores ({component: "decimal string"}) for every
    # component model that is not the historical four-column one. ``{}`` on
    # historical rows: their scores live in the columns above, and a second copy of
    # an authoritative analytical value can drift from the first. The run's
    # ``component_model_version`` says which representation to read.
    component_scores: Mapped[Any] = mapped_column(
        JsonVariant, default=dict, server_default=text("'{}'")
    )
    # {profile: total} and {profile: rank} for all sensitivity profiles (including
    # the run-specific ``critic`` profile).
    profile_totals: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    profile_ranks: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    # Weight-sensitivity stability (ELIGIBLE candidates only). ``stable_count`` is
    # the number of stability profiles (baseline/equal/critic) under which the
    # candidate stays in the top fraction; ``stability_class`` is STABLE /
    # CONDITIONALLY_STABLE / WEIGHT_SENSITIVE; ``stability_membership`` records the
    # per-profile top-tier booleans. All null/{} for REVIEW_REQUIRED, EXCLUDED, and
    # historical pre-stability rows — a candidate is never presented as stable then.
    stable_count: Mapped[int | None] = mapped_column(SmallInteger)
    stability_class: Mapped[str | None] = mapped_column(String(30))
    stability_membership: Mapped[Any] = mapped_column(JsonVariant, default=dict)
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
