"""Environmental-layer catalogue table (Suitability Phase 1A).

``environmental_layer_registry`` is a **metadata catalogue** of the
environmental/physical layers a future suitability phase may add. It holds no
score, no geometry, and no candidate data — only each layer's identity, form,
lifecycle, and Phase 1B ingestion-readiness recommendation. Every row carries an
explicit ``lifecycle`` (IMPLEMENTED / PLANNED / FUTURE / EXPERIMENTAL) so a
planned layer is never presented as implemented.

The rows are seeded (migration 0017) from the single source of truth in
``waste_equity_backend.environment.layers.registry_seed_rows``; a unit test
asserts the migration's inlined seed never diverges from it, exactly as the
facility standard-cost seed is cross-checked. This table changes no existing
table and no suitability result. See
``docs/SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md``.
"""

import datetime
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    true,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

# JSONB on PostgreSQL, generic JSON elsewhere (unit tests use SQLite).
JsonVariant = JSON().with_variant(postgresql.JSONB(), "postgresql")


class EnvironmentalLayerRegistry(Base):
    """One catalogued environmental layer (metadata only; not data)."""

    __tablename__ = "environmental_layer_registry"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stable machine name (snake_case); the catalogue key (unique constraint
    # provides its index).
    layer_name: Mapped[str] = mapped_column(String(50), unique=True)
    korean_label: Mapped[str] = mapped_column(String(100))
    # LayerModality value: vector_polygon / vector_line / raster / point_and_polygon /
    # raster_or_polygon.
    modality: Mapped[str] = mapped_column(String(30))
    # LayerLifecycle value: IMPLEMENTED / PLANNED / FUTURE / EXPERIMENTAL.
    lifecycle: Mapped[str] = mapped_column(String(20), index=True)
    # Roadmap label: "reuse" (already implemented), "1B", or "1C".
    target_phase: Mapped[str] = mapped_column(String(20))
    # Contract-verification status: LIVE_VERIFIED / DOCUMENTED_NOT_TESTED / ...
    verification_status: Mapped[str] = mapped_column(String(40))
    # Phase 1B ingestion-readiness: GO / CONDITIONAL_GO / NO_GO (never a scoring decision).
    readiness_recommendation: Mapped[str] = mapped_column(String(20))
    suitability_role: Mapped[str] = mapped_column(String(300))
    # 80, not 40: the Phase 1A seed's longest value is 50 characters
    # ("High (sparse network → modelled/uncertain surface)"). SQLite ignores
    # VARCHAR limits, so the original 40 passed unit tests but made migration
    # 0017 fail on PostgreSQL. See that migration's note.
    implementation_difficulty: Mapped[str] = mapped_column(String(80))
    # Short catalogue note; never a fabricated score or completion percentage.
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class EnvironmentalDatasetVersion(Base):
    """One reproducible official *release* of a catalogued environmental layer.

    The Phase 1A ``environmental_layer_registry`` catalogues which layers exist;
    this table records an actual ingested release of one of them — provider,
    official dataset name, reference date, source CRS/encoding, checksums, and
    the transformation version that produced the stored features. It is the
    environmental-layer counterpart of ``structural_dataset_versions`` and is
    deliberately separate, because environmental layers are not structural
    (regulatory) layers and must not inherit their semantics.

    Identity is the natural release key in
    ``uq_environmental_dataset_versions_release``: re-running an ingestion over
    byte-identical sources reuses the version rather than duplicating it.
    """

    __tablename__ = "environmental_dataset_versions"
    __table_args__ = (
        UniqueConstraint(
            "layer_name",
            "provider_dataset_identifier",
            "reference_date",
            "source_checksum",
            "transformation_version",
            name="uq_environmental_dataset_versions_release",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    # Catalogue key from environmental_layer_registry (e.g. "wetland_inventory").
    layer_name: Mapped[str] = mapped_column(
        ForeignKey("environmental_layer_registry.layer_name"), index=True
    )
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.source_id"), index=True)
    provider: Mapped[str] = mapped_column(String(200))
    official_dataset_name: Mapped[str] = mapped_column(String(300))
    provider_dataset_identifier: Mapped[str] = mapped_column(String(200))
    official_source_url: Mapped[str | None] = mapped_column(String(500))
    # Official dataset reference date (기준일), not the local download date.
    reference_date: Mapped[datetime.date] = mapped_column(Date)
    # Original distribution filenames. The files themselves are Git-ignored local
    # raw data and are never committed or stored in the database.
    source_archive_filename: Mapped[str | None] = mapped_column(String(500))
    source_filename: Mapped[str | None] = mapped_column(String(500))
    # SHA-256 of the distribution archive (ZIP) and of the read .shp respectively.
    source_archive_checksum: Mapped[str | None] = mapped_column(String(64))
    source_checksum: Mapped[str] = mapped_column(String(64), index=True)
    source_crs: Mapped[str] = mapped_column(String(20))
    target_crs: Mapped[str] = mapped_column(String(20))
    # Declared attribute encoding taken from the source (.cpg), never guessed.
    source_encoding: Mapped[str | None] = mapped_column(String(30))
    source_geometry_type: Mapped[str | None] = mapped_column(String(50))
    normalized_geometry_type: Mapped[str] = mapped_column(String(50))
    # Feature count the provider declares, kept beside what was actually read so
    # a discrepancy is visible rather than silently absorbed.
    declared_feature_count: Mapped[int | None] = mapped_column(Integer)
    total_feature_count: Mapped[int] = mapped_column(Integer, default=0)
    accepted_feature_count: Mapped[int] = mapped_column(Integer, default=0)
    rejected_feature_count: Mapped[int] = mapped_column(Integer, default=0)
    transformation_version: Mapped[str] = mapped_column(String(100))
    license_note: Mapped[str | None] = mapped_column(String(300))
    ingestion_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("ingestion_runs.run_id"), index=True
    )
    retrieved_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    # Local acquisition date of the raw archive, when known.
    acquired_on: Mapped[datetime.date | None] = mapped_column(Date)
    # Per-file provenance: [{filename, sha256, size_bytes, role}] — names and
    # checksums only, never file contents.
    source_files: Mapped[Any] = mapped_column(JsonVariant, default=list)
    # Sanitized run metadata: contract-validation status, warnings, counts. No
    # local absolute paths and no per-record source values.
    retrieval_metadata: Mapped[Any | None] = mapped_column(JsonVariant)
    # Only active versions may be read by any future consumer. Historical rows
    # are preserved; a version is superseded only by an explicit decision.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=true(), default=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class EnvironmentalWetlandInventoryFeature(Base):
    """One surveyed 내륙습지 (inland wetland) polygon from the 국립생태원 inventory.

    **This is not a statutory protection area.** The inventory is the result of
    the 「습지보전법」 전국내륙습지 기초조사; being surveyed confers no legal status.
    The statutory 습지보호지역 layer (``UM901``) lives in
    ``structural_protected_features`` and is a different dataset with different
    legal effect and different (including coastal) scope. The two tables are
    deliberately unrelated: there is no foreign key between them, no view that
    unions them, and nothing here may be read as designation. See
    ``docs/WETLAND_INVENTORY_DATA_CONTRACT.md`` §9.

    The table holds **no score column** and is read by no scoring, ranking, or
    candidate-generation code. Source attributes are preserved verbatim
    (``raw_attributes``) beside the normalized columns so a source anomaly is
    never silently "fixed" on the way in.
    """

    __tablename__ = "environmental_wetland_inventory_features"
    __table_args__ = (
        # Idempotency: the provider's CODE is unique within a release (verified
        # in Phase 1B-0: 2,704 distinct values over 2,704 records), so it is the
        # natural per-version identity.
        UniqueConstraint(
            "dataset_version_id",
            "source_feature_id",
            name="uq_wetland_inventory_features_version_source_id",
        ),
        # Second, geometry-derived identity guard. Scoped to the version so a
        # future release may legitimately restate the same polygon.
        UniqueConstraint(
            "dataset_version_id",
            "feature_fingerprint",
            name="uq_wetland_inventory_features_version_fingerprint",
        ),
        Index("ix_wetland_inventory_features_source_sido", "source_sido_name"),
        Index("ix_wetland_inventory_features_source_sigungu", "source_sigungu_name"),
        # geoalchemy2 attaches the GIST spatial index on ``geometry`` itself
        # (spatial_index=True by default); it is not declared again here.
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    dataset_version_id: Mapped[int] = mapped_column(
        ForeignKey("environmental_dataset_versions.id"), index=True
    )
    # Authoritative provider identifier (source column ``CODE``).
    source_feature_id: Mapped[str] = mapped_column(String(50), index=True)
    # Source column ``FID`` — source-local ordering only, not a stable key
    # (observed range 1–2,705 over 2,704 rows, i.e. it has a gap).
    source_fid: Mapped[int | None] = mapped_column(Integer)
    wetland_name: Mapped[str] = mapped_column(String(100))
    # Same value as source_feature_id, exposed under its domain name.
    wetland_code: Mapped[str] = mapped_column(String(50), index=True)
    # Korean type label (하천습지 / 호수습지 / 산지습지 / 인공습지).
    wetland_type: Mapped[str] = mapped_column(String(50))
    # Korean classification code, stored exactly as published — including the one
    # observed record whose value is the label 하도습지 rather than a code.
    wetland_type_korea: Mapped[str | None] = mapped_column(String(50))
    # Ramsar type code, stored exactly as published including letter case
    # (``Tp``/``TP`` and ``Xp``/``XP`` are NOT folded together: no official code
    # list ships with the dataset, so equivalence is unproven).
    wetland_type_ramsar: Mapped[str | None] = mapped_column(String(50))
    # Provider-stated area (source column ``AREA``, m²), kept distinct from the
    # measured geometry area so the two can be compared, never conflated.
    reported_area_m2: Mapped[int | None] = mapped_column(BigInteger)
    # Provider representative point (WGS84). Reported metadata only — it is not
    # the polygon centroid and is never used as geometry.
    source_longitude: Mapped[float | None] = mapped_column(Float)
    source_latitude: Mapped[float | None] = mapped_column(Float)
    source_address: Mapped[str | None] = mapped_column(String(200))
    source_sido_name: Mapped[str | None] = mapped_column(String(50))
    source_sigungu_name: Mapped[str | None] = mapped_column(String(100))
    source_eupmyeondong_name: Mapped[str | None] = mapped_column(String(100))
    # Empty in the source for 336 records; preserved as NULL, never as "".
    source_ri_name: Mapped[str | None] = mapped_column(String(100))
    # Source column ``EXP``. Present on only 35 of 2,704 records. An empty value
    # means "no note in this dataset" — it does NOT prove the wetland is
    # undesignated, and this column must never be read as legal status.
    designation_note: Mapped[str | None] = mapped_column(String(200))
    # Canonical region codes assigned SPATIALLY against the official boundaries
    # in ``regions``. NULL when no official boundary covers the feature (the
    # inventory is nationwide; the platform stores capital-region boundaries).
    # Never derived from the source name strings.
    normalized_sido_code: Mapped[str | None] = mapped_column(String(20), index=True)
    normalized_sigungu_code: Mapped[str | None] = mapped_column(String(20), index=True)
    geometry: Mapped[Any] = mapped_column(Geometry(geometry_type="MULTIPOLYGON", srid=4326))
    # Area measured on the projected source CRS (EPSG:5186, metres) before
    # transformation — never computed from EPSG:4326 degrees.
    geometry_area_m2: Mapped[float] = mapped_column(Float)
    source_crs: Mapped[str] = mapped_column(String(20))
    transformation_version: Mapped[str] = mapped_column(String(100))
    source_reference_date: Mapped[datetime.date] = mapped_column(Date)
    source_checksum: Mapped[str] = mapped_column(String(64))
    # Deterministic sha256 over the normalized stored geometry plus the release
    # identity; reproducible from the source, independent of database ids.
    feature_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    # Every source DBF column, verbatim, after a strict UTF-8 decode.
    raw_attributes: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
