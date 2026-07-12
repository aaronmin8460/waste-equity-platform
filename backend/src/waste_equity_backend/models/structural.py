"""Versioned structural spatial-layer tables (Phase 2.5B).

These tables store official bulk structural spatial layers (zoning first, with
protected/restricted areas and roads to follow) as reproducible, versioned
loads. A ``structural_dataset_versions`` row identifies one official source
release (provider dataset + reference date + content checksum); previous
versions are preserved rather than overwritten. ``structural_features`` holds
the normalized EPSG:4326 features for a version, keyed for idempotency by a
deterministic geometry-plus-attribute fingerprint rather than by the provider
feature id, whose stability across provider refreshes is unverified.
"""

import datetime
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    JSON,
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

# JSONB on PostgreSQL, generic JSON elsewhere (unit tests use SQLite).
JsonVariant = JSON().with_variant(postgresql.JSONB(), "postgresql")


class StructuralDatasetVersion(Base):
    """One reproducible official structural-layer source release."""

    __tablename__ = "structural_dataset_versions"
    __table_args__ = (
        # A given official release (provider dataset + reference date + exact
        # content) is ingested at most once per transformation version. Re-runs
        # of the same files therefore reuse the version instead of duplicating.
        UniqueConstraint(
            "source_id",
            "layer_family",
            "provider_dataset_identifier",
            "reference_date",
            "source_checksum",
            "transformation_version",
            name="uq_structural_dataset_versions_release",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.source_id"), index=True)
    # Official provider (e.g. 국토교통부) and its bulk/service dataset identifier.
    provider: Mapped[str] = mapped_column(String(200))
    provider_dataset_identifier: Mapped[str] = mapped_column(String(200))
    # VWorld layer identifier or official bulk dataset identifier, when a single
    # value applies to the whole version; per-feature layer ids are on the rows.
    layer_identifier: Mapped[str | None] = mapped_column(String(100))
    # Layer family: "zoning" now; "protected"/"roads" in later subphases.
    layer_family: Mapped[str] = mapped_column(String(50), index=True)
    # Official dataset reference date (기준일 / 고시/갱신일).
    reference_date: Mapped[datetime.date] = mapped_column(Date)
    # Summary of the original source filename(s); per-file detail is in
    # source_files. Bulk files themselves are never committed to the repository.
    source_filename: Mapped[str | None] = mapped_column(String(500))
    # Deterministic checksum over all accepted source files (sorted).
    source_checksum: Mapped[str] = mapped_column(String(64), index=True)
    source_crs: Mapped[str] = mapped_column(String(20))
    target_crs: Mapped[str] = mapped_column(String(20))
    source_geometry_type: Mapped[str | None] = mapped_column(String(50))
    normalized_geometry_type: Mapped[str] = mapped_column(String(50))
    transformation_version: Mapped[str] = mapped_column(String(100))
    ingestion_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("ingestion_runs.run_id"), index=True
    )
    retrieved_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    total_feature_count: Mapped[int] = mapped_column(Integer, default=0)
    accepted_feature_count: Mapped[int] = mapped_column(Integer, default=0)
    rejected_feature_count: Mapped[int] = mapped_column(Integer, default=0)
    # COMPLETE, PARTIAL, or INCOMPLETE — whether all target regions were
    # evaluated with a valid source (never conflates zero-features with
    # not-evaluated; see coverage_matrix for the honest per-region breakdown).
    coverage_status: Mapped[str] = mapped_column(String(20))
    # Per-file provenance: [{filename, checksum, region, layer, features...}].
    source_files: Mapped[Any] = mapped_column(JsonVariant, default=list)
    # Region-by-layer completeness matrix, per-region/per-layer counts, and
    # validation warnings/failures. Sanitized (no local absolute paths).
    coverage_matrix: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    retrieval_metadata: Mapped[Any | None] = mapped_column(JsonVariant)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class StructuralFeature(Base):
    """A normalized EPSG:4326 structural-layer feature within a version."""

    __tablename__ = "structural_features"
    __table_args__ = (
        # Idempotency: the same normalized geometry + relevant attributes within
        # a dataset version is stored once. The fingerprint (not the provider
        # feature id) is the identity because provider-id stability is unverified.
        UniqueConstraint(
            "dataset_version_id",
            "feature_fingerprint",
            name="uq_structural_features_version_fingerprint",
        ),
        Index("ix_structural_features_category", "zoning_category"),
        Index("ix_structural_features_target_region", "target_region_code"),
        # geoalchemy2 attaches the GIST spatial index on ``geometry``
        # automatically (spatial_index=True by default), so it is not declared
        # again here to avoid a duplicate index.
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    dataset_version_id: Mapped[int] = mapped_column(
        ForeignKey("structural_dataset_versions.id"), index=True
    )
    # Official layer identifier for this feature (e.g. LT_C_UQ111).
    layer_identifier: Mapped[str] = mapped_column(String(100), index=True)
    # Provider feature identifier when present; not used as an identity key.
    provider_feature_id: Mapped[str | None] = mapped_column(String(200))
    # Normalized zoning category: URBAN / MANAGEMENT / AGRICULTURAL_FOREST /
    # NATURAL_ENV_CONSERVATION.
    zoning_category: Mapped[str] = mapped_column(String(40), index=True)
    # Official layer-level zoning code (UQ111..UQ114) and Korean name.
    official_zoning_code: Mapped[str] = mapped_column(String(20))
    official_zoning_name: Mapped[str] = mapped_column(String(100))
    # Canonical target 시도 association where deterministically resolvable.
    target_region_code: Mapped[str | None] = mapped_column(String(20))
    target_region_name: Mapped[str | None] = mapped_column(String(50))
    # Official source attributes needed for interpretation (uname, ucode, dyear,
    # dnum, sido_cd, ...). Preserved verbatim after explicit decoding.
    source_attributes: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    geometry: Mapped[Any] = mapped_column(Geometry(geometry_type="MULTIPOLYGON", srid=4326))
    # Deterministic sha256 over normalized geometry + relevant attributes.
    feature_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    # Source provenance: {source_filename, region, source_crs, target_crs}.
    source_provenance: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    ingested_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
