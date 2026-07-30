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
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    false,
    text,
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
        # Release identity keys on ``reference_period`` (always present), not
        # ``reference_date`` (nullable). A dataset whose official reference is a
        # bare year — the 세분류 [2025] 토지피복지도 — carries reference_period="2025"
        # and reference_date=NULL, while the wetland inventory keeps its precise
        # reference_date and a reference_period backfilled from it (migration
        # 0019). Keying on reference_period keeps identity deterministic for both
        # (a NULL reference_date can never anchor a unique key). See
        # ``docs/LAND_COVER_INGESTION_FOUNDATION.md`` §"Reference-period decision".
        UniqueConstraint(
            "layer_name",
            "provider_dataset_identifier",
            "reference_period",
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
    # Official dataset reference *period*, always present and part of the release
    # identity. A precise date ("2022-07-20") when the source proves one, or a
    # bare year ("2025") when the source only supports a year. Never fabricated.
    reference_period: Mapped[str] = mapped_column(String(20))
    # Official dataset reference date (기준일), not the local download date.
    # NULL is permitted when the source only supports a year-level reference and
    # no precise date is proven (e.g. the 세분류 [2025] 토지피복지도); it must never
    # be fabricated from a folder token, IMG_DATE, DBF byte, or file timestamp.
    reference_date: Mapped[datetime.date | None] = mapped_column(Date)
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


class EnvironmentalLandCoverMapSheet(Base):
    """One canonical source map sheet of the 세분류 [2025] 토지피복지도 release.

    The acquisition ships 2,117 tiled shapefiles keyed by an 8-digit map-sheet
    number; 101 of those numbers occur under two 시도 folders as **byte-identical
    border sheets** (verified: 0 within-region duplicates, 0 conflicting
    checksums). This table records *one* row per unique canonical sheet — its
    source filename, ``.shp`` checksum, every folder/region occurrence
    (``source_regions``), the duplicate count and classification, and the
    per-sheet processing tallies — so a border sheet is loaded once while its
    provenance still names every place it was found. Directory names are kept as
    *reported* provenance only; a feature is **never** assigned a region from its
    folder (border sheets span 시도), and that assignment is deferred to a spatial
    intersection against the official ``regions`` boundaries.

    A duplicate map-sheet id whose ``.shp`` checksums *differ* is a genuine
    conflict: the loader halts on it rather than auto-picking or merging, so no
    such row is ever written silently. Holds no score column.
    """

    __tablename__ = "environmental_land_cover_map_sheets"
    __table_args__ = (
        UniqueConstraint(
            "dataset_version_id",
            "map_sheet_id",
            name="uq_land_cover_map_sheets_version_sheet",
        ),
        Index("ix_land_cover_map_sheets_map_sheet_id", "map_sheet_id"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    dataset_version_id: Mapped[int] = mapped_column(
        ForeignKey("environmental_dataset_versions.id"), index=True
    )
    # Canonical 8-digit map-sheet number (the ``.shp`` stem, e.g. "37705097").
    map_sheet_id: Mapped[str] = mapped_column(String(40))
    # Filename of the canonical copy that was read (never a local absolute path).
    canonical_source_filename: Mapped[str] = mapped_column(String(255))
    # SHA-256 of the canonical ``.shp`` bytes; every duplicate copy shares it.
    source_shp_checksum: Mapped[str] = mapped_column(String(64), index=True)
    # Every folder occurrence: [{"region": ..., "dir_name": ...}] — reported
    # provenance, never the authoritative region of any feature.
    source_regions: Mapped[Any] = mapped_column(JsonVariant, default=list)
    duplicate_occurrence_count: Mapped[int] = mapped_column(Integer, default=1)
    # "unique" | "byte_identical_cross_region" | "byte_identical_within_region".
    # A conflicting-checksum duplicate never reaches this table (the loader halts).
    duplicate_classification: Mapped[str] = mapped_column(String(40))
    source_feature_count: Mapped[int] = mapped_column(Integer, default=0)
    # [minx, miny, maxx, maxy] from the ``.shp`` header, in the source CRS (5186).
    source_bounds_5186: Mapped[Any | None] = mapped_column(JsonVariant)
    source_crs: Mapped[str] = mapped_column(String(20))
    source_encoding: Mapped[str] = mapped_column(String(30))
    # PENDING | PROCESSED | REJECTED | PILOT_DRY_RUN.
    processing_status: Mapped[str] = mapped_column(String(20), default="PENDING")
    accepted_feature_count: Mapped[int] = mapped_column(Integer, default=0)
    repaired_feature_count: Mapped[int] = mapped_column(Integer, default=0)
    rejected_feature_count: Mapped[int] = mapped_column(Integer, default=0)
    transformation_version: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class EnvironmentalLandCoverFeature(Base):
    """One normalized 세분류 (Level-3) land-cover polygon.

    Each row preserves all 15 source DBF attributes — the six L1/L2/L3 code+name
    columns and IMG_NAME/IMG_DATE/INX_NUM/ANNO as typed convenience columns, plus
    a lossless ``raw_attributes`` JSONB carrying every column verbatim (including
    the five *_INFO imagery-processing fields). Korean labels, spacing, and
    capitalization are stored exactly as published — never corrected.

    Geometry is stored as ``MULTIPOLYGON`` in EPSG:4326; ``geometry_area_m2`` is
    measured in the projected source CRS (EPSG:5186, metres) *before*
    reprojection, never from 4326 degrees. The geometry-repair audit columns
    record, per feature, whether the source geometry was valid, the reason it was
    not, whether ``ST_MakeValid``/``shapely.make_valid`` was applied, how many
    non-polygonal components a GeometryCollection result discarded, and the
    source/repaired/delta areas. Holds no score, weight, exclusion, rank, or
    candidate column and is read by no scoring code.
    """

    __tablename__ = "environmental_land_cover_features"
    __table_args__ = (
        # Stable per-sheet record identity: the source record index within its
        # canonical map sheet, scoped to the release.
        UniqueConstraint(
            "dataset_version_id",
            "map_sheet_id",
            "source_record_index",
            name="uq_land_cover_features_version_sheet_record",
        ),
        # Geometry-derived identity guard (sha-256 over the normalized geometry +
        # release identity), scoped to the release so a later release may legally
        # restate the same polygon.
        UniqueConstraint(
            "dataset_version_id",
            "feature_fingerprint",
            name="uq_land_cover_features_version_fingerprint",
        ),
        # Deliberately lean for a 7-million-row table: the two unique indexes
        # above already serve (dataset_version_id[, map_sheet_id]) prefix lookups,
        # so only class filtering gets its own btree. See
        # ``docs/LAND_COVER_INGESTION_FOUNDATION.md`` §"Identity and indexes".
        Index("ix_land_cover_features_l3_code", "l3_code"),
        # geoalchemy2 attaches the GIST spatial index on ``geometry`` itself.
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    dataset_version_id: Mapped[int] = mapped_column(
        ForeignKey("environmental_dataset_versions.id"), index=True
    )
    # No standalone index: covered by the (dataset_version_id, map_sheet_id,
    # source_record_index) unique index's prefix.
    map_sheet_id: Mapped[str] = mapped_column(String(40))
    # Source record ordinal within the canonical map sheet (0-based, stable).
    source_record_index: Mapped[int] = mapped_column(Integer)
    # Class hierarchy, verbatim (대·중·세분류). Codes are 3-digit strings.
    l1_code: Mapped[str | None] = mapped_column(String(10))
    l1_name: Mapped[str | None] = mapped_column(String(60))
    l2_code: Mapped[str | None] = mapped_column(String(10))
    l2_name: Mapped[str | None] = mapped_column(String(60))
    l3_code: Mapped[str | None] = mapped_column(String(10))
    l3_name: Mapped[str | None] = mapped_column(String(60))
    # Source imagery/annotation attributes, verbatim.
    img_name: Mapped[str | None] = mapped_column(String(60))
    # IMG_DATE is a dBASE 'D' field; stored as its stringified value, never used
    # as the dataset reference date.
    img_date: Mapped[str | None] = mapped_column(String(20))
    inx_num: Mapped[str | None] = mapped_column(String(20))
    anno: Mapped[str | None] = mapped_column(Text)
    geometry: Mapped[Any] = mapped_column(Geometry(geometry_type="MULTIPOLYGON", srid=4326))
    # Area measured on the projected source CRS (EPSG:5186, metres) before
    # reprojection — never computed from EPSG:4326 degrees.
    geometry_area_m2: Mapped[float] = mapped_column(Float)
    # Geometry-repair audit. ``source_geometry_valid`` is the validity of the
    # geometry as published, in the source CRS.
    source_geometry_valid: Mapped[bool] = mapped_column(Boolean)
    source_invalidity_reason: Mapped[str | None] = mapped_column(String(200))
    # "none" (valid source) | "made_valid" (repaired) — never a silent drop.
    geometry_repair_status: Mapped[str] = mapped_column(String(20))
    geometry_repair_method: Mapped[str | None] = mapped_column(String(50))
    # Non-polygonal components discarded when MakeValid returned a mixed
    # GeometryCollection (0 when none were discarded).
    discarded_component_count: Mapped[int] = mapped_column(Integer, default=0)
    discarded_component_types: Mapped[Any | None] = mapped_column(JsonVariant)
    # Source / repaired / delta area in EPSG:5186 m² — only meaningful when the
    # source geometry was repaired; NULL otherwise.
    source_area_m2: Mapped[float | None] = mapped_column(Float)
    repaired_area_m2: Mapped[float | None] = mapped_column(Float)
    area_delta_m2: Mapped[float | None] = mapped_column(Float)
    # sha-256 over the source-CRS geometry WKB (before repair/reprojection).
    source_geometry_fingerprint: Mapped[str] = mapped_column(String(64))
    # Deterministic sha-256 over the normalized stored geometry + release
    # identity; reproducible from the source, independent of database ids.
    feature_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    source_crs: Mapped[str] = mapped_column(String(20))
    target_crs: Mapped[str] = mapped_column(String(20))
    source_encoding: Mapped[str] = mapped_column(String(30))
    # Reference *period* of the release (e.g. "2025"); year-only for this source.
    source_reference_period: Mapped[str] = mapped_column(String(20))
    transformation_version: Mapped[str] = mapped_column(String(100))
    # Every source DBF column, verbatim, after a strict CP949 decode (lossless).
    raw_attributes: Mapped[Any] = mapped_column(JsonVariant, default=dict)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class EnvironmentalLandCoverCellStatVersion(Base):
    """One complete derived release of 500 m candidate-cell land-cover statistics.

    A derived statistics release is a pure **function of two versioned inputs** —
    an active ``land_cover`` ``environmental_dataset_versions`` row and a canonical
    candidate-grid version — plus the deterministic ``derivation_version``. It is
    therefore deliberately **not** linked to any one ``suitability_analysis_runs``
    row: the same grid cell carries the same land-cover composition regardless of
    which scoring profile or analysis run happened to include it. Nothing here is a
    score, weight, exclusion, rank, candidate status, or policy input, and no
    suitability table is written by the derivation that fills it.

    ``input_signature`` is the idempotency key: re-deriving the same inputs reuses
    this row rather than creating a second release. ``is_active`` is set **only**
    after every expected canonical cell has a valid statistics row, so a partial or
    failed derivation can never be presented as a complete active release.
    """

    __tablename__ = "environmental_land_cover_cell_stat_versions"
    __table_args__ = (
        # Deterministic derived-release identity (sha-256 over the land-cover
        # release identity + candidate-grid version/fingerprint + derivation
        # version + area CRS + expected cell count).
        UniqueConstraint("input_signature", name="uq_land_cover_cell_stat_versions_signature"),
        # At most one *active* release per (source release, grid version,
        # derivation version). Partial index: superseded/failed rows are preserved.
        Index(
            "uq_land_cover_cell_stat_versions_active",
            "land_cover_dataset_version_id",
            "candidate_grid_version",
            "derivation_version",
            unique=True,
            postgresql_where=text("is_active"),
            sqlite_where=text("is_active"),
        ),
        Index("ix_land_cover_cell_stat_versions_status", "status"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    # The active land_cover release the statistics were derived from.
    land_cover_dataset_version_id: Mapped[int] = mapped_column(
        ForeignKey("environmental_dataset_versions.id"), index=True
    )
    # Canonical candidate-grid version (e.g. "capital-grid-500m-v1"), taken from
    # ``suitability_analysis_runs.candidate_grid_version`` — never invented here.
    candidate_grid_version: Mapped[str] = mapped_column(String(50), index=True)
    # sha-256 over every canonical cell's (key, geometry fingerprint) in key order:
    # proves *which* grid the release was computed against, independent of run ids.
    candidate_grid_fingerprint: Mapped[str] = mapped_column(String(64))
    # Deterministic derivation version ("land-cover-cell-stats-v1"). Deliberately
    # distinct from the suitability derivation version, which is never touched.
    derivation_version: Mapped[str] = mapped_column(String(50))
    # CRS every area/intersection was measured in. Always a projected metre CRS
    # (EPSG:5186); geometry itself is stored in EPSG:4326 upstream.
    area_crs: Mapped[str] = mapped_column(String(20))
    input_signature: Mapped[str] = mapped_column(String(64))
    # RUNNING | SUCCEEDED | FAILED. A FAILED or RUNNING version is never active.
    status: Mapped[str] = mapped_column(String(20))
    # Canonical cell count discovered from the database, and how many were written.
    expected_cell_count: Mapped[int] = mapped_column(Integer, default=0)
    processed_cell_count: Mapped[int] = mapped_column(Integer, default=0)
    complete_exact_count: Mapped[int] = mapped_column(Integer, default=0)
    partial_count: Mapped[int] = mapped_column(Integer, default=0)
    no_coverage_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_cell_count: Mapped[int] = mapped_column(Integer, default=0)
    # Provenance of the canonicalization (Part 2): how many raw candidate rows the
    # grid version had, how many duplicate occurrences canonicalization removed, and
    # how many cells had a byte-differing but topologically identical (ST_Equals)
    # geometry representation across runs. Recorded, never silently absorbed.
    candidate_row_count: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_candidate_occurrence_count: Mapped[int] = mapped_column(Integer, default=0)
    representation_variant_cell_count: Mapped[int] = mapped_column(Integer, default=0)
    # Aggregate areas in ``area_crs`` m².
    total_cell_area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    total_evaluated_area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    total_uncovered_area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    aggregate_coverage_ratio: Mapped[float | None] = mapped_column(Float)
    # Source-overlap audit (Part 5G): the sum of per-feature intersection areas
    # *before* the cross-feature/cross-class union, the resulting overlap, and its
    # extremes. Overlaps are reported, never normalized away.
    total_intersection_area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    total_overlap_area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    cells_with_source_overlap: Mapped[int] = mapped_column(Integer, default=0)
    max_overlap_area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    max_overlap_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    # Numerical non-negativity guard audit. The guard exists only to stop a
    # floating-point overlay artifact producing an impossible negative area; every
    # application is counted and its largest magnitude recorded, never hidden.
    guard_applied_cell_count: Mapped[int] = mapped_column(Integer, default=0)
    max_guard_adjustment_m2: Mapped[float] = mapped_column(Float, default=0.0)
    class_row_count: Mapped[int] = mapped_column(Integer, default=0)
    batch_size: Mapped[int] = mapped_column(Integer, default=0)
    # Owning derivation attempt. Each attempt gets its own ``ingestion_runs`` row;
    # a failed attempt's row stays FAILED forever even if a later attempt succeeds.
    ingestion_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("ingestion_runs.run_id"), index=True
    )
    # Sanitized derivation metadata (method description, guard definition, coverage
    # semantics). No local path, no geometry, no per-feature payload.
    derivation_metadata: Mapped[Any | None] = mapped_column(JsonVariant)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )
    started_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class EnvironmentalLandCoverCellStatistic(Base):
    """Land-cover composition of one canonical 500 m candidate-grid cell.

    One row per (statistics version, candidate-grid version, candidate key). The
    row holds the cell-level measurements — actual clipped cell area, the union
    (double-count-free) evaluated area, uncovered area, coverage ratio and exact
    coverage status, the source-overlap audit, and the dominant L1/L2/L3 class —
    while the **complete** class composition lives in
    ``environmental_land_cover_cell_class_areas`` (one child row per observed class
    at each level), so nothing beyond the dominant class is discarded.

    No geometry is stored: the cell geometry already exists on
    ``suitability_candidates`` and the class composition is areal. Consequently
    there is no spatial index here. This table holds no score, weight, exclusion,
    rank, or candidate-status column, and no suitability result reads it.
    """

    __tablename__ = "environmental_land_cover_cell_statistics"
    __table_args__ = (
        UniqueConstraint(
            "statistics_version_id",
            "candidate_grid_version",
            "candidate_key",
            name="uq_land_cover_cell_statistics_version_key",
        ),
        Index("ix_land_cover_cell_statistics_candidate_key", "candidate_key"),
        Index("ix_land_cover_cell_statistics_grid_version", "candidate_grid_version"),
        Index("ix_land_cover_cell_statistics_sido", "sido_region_code"),
        Index(
            "ix_land_cover_cell_statistics_version_status",
            "statistics_version_id",
            "coverage_status",
        ),
        Index(
            "ix_land_cover_cell_statistics_version_dominant_l1",
            "statistics_version_id",
            "dominant_l1_code",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    statistics_version_id: Mapped[int] = mapped_column(
        ForeignKey("environmental_land_cover_cell_stat_versions.id"), index=True
    )
    land_cover_dataset_version_id: Mapped[int] = mapped_column(
        ForeignKey("environmental_dataset_versions.id"), index=True
    )
    candidate_grid_version: Mapped[str] = mapped_column(String(50))
    # ``<grid version>:<i>_<j>`` — the canonical grid identity, not a run-scoped id.
    candidate_key: Mapped[str] = mapped_column(String(50))
    # sha-256 over the canonical cell geometry (EWKB) + grid version + key. Ties the
    # row to the exact geometry the areas were measured on.
    candidate_geometry_fingerprint: Mapped[str] = mapped_column(String(64))
    # Region provenance copied verbatim from the canonical candidate row (assigned
    # there against the official boundaries); never re-derived or invented here.
    sido_region_code: Mapped[str | None] = mapped_column(String(20))
    sido_region_name: Mapped[str | None] = mapped_column(String(50))
    sigungu_region_code: Mapped[str | None] = mapped_column(String(20))
    sigungu_region_name: Mapped[str | None] = mapped_column(String(50))
    # Actual clipped cell area in ``area_crs`` m² — measured, never assumed to be
    # 250,000 m² (boundary-clipped edge cells are genuinely smaller).
    cell_area_m2: Mapped[float] = mapped_column(Float)
    # Area of the UNION of all polygonal land-cover intersections with this cell
    # (overlapping source features counted once).
    evaluated_area_m2: Mapped[float] = mapped_column(Float)
    uncovered_area_m2: Mapped[float] = mapped_column(Float)
    coverage_ratio: Mapped[float] = mapped_column(Float)
    # Sum of the per-feature intersection areas *before* any union, kept beside the
    # union area so the exact source overlap is auditable rather than absorbed.
    intersection_area_sum_m2: Mapped[float] = mapped_column(Float)
    overlap_area_m2: Mapped[float] = mapped_column(Float)
    # NO_COVERAGE | COMPLETE_EXACT | PARTIAL. COMPLETE_EXACT means the polygonal
    # residual of (cell − evaluated union) is EMPTY — an exact set-theoretic
    # statement, never "close to 100%"; no completeness tolerance exists.
    coverage_status: Mapped[str] = mapped_column(String(20))
    # Geometry-derived uncovered area: ST_Area of the polygonal residual
    # ST_Difference(cell, evaluated union), i.e. the whole cell for a NO_COVERAGE
    # cell. Kept beside the arithmetic ``uncovered_area_m2`` (cell − evaluated) so
    # the two independent measures can be compared rather than assumed equal.
    uncovered_residual_area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    # Raw ``ST_Covers(evaluated union, cell)`` result, stored as *evidence only*.
    # It is deliberately NOT the status rule: on high-vertex clipped unions GEOS
    # returns false even when the residual is provably empty and zero-area (see
    # ``docs/LAND_COVER_CANDIDATE_CELL_STATISTICS.md``). Recording both keeps that
    # disagreement auditable instead of hidden behind whichever answer was picked.
    topological_cover_predicate: Mapped[bool] = mapped_column(Boolean, default=False)
    # Source features contributing a non-empty polygonal intersection to this cell.
    matched_feature_count: Mapped[int] = mapped_column(Integer, default=0)
    # Largest class by intersection area at each level; ties break on the ascending
    # official class code, never on database row order. NULL for NO_COVERAGE cells.
    dominant_l1_code: Mapped[str | None] = mapped_column(String(10))
    dominant_l1_name: Mapped[str | None] = mapped_column(String(60))
    dominant_l2_code: Mapped[str | None] = mapped_column(String(10))
    dominant_l2_name: Mapped[str | None] = mapped_column(String(60))
    dominant_l3_code: Mapped[str | None] = mapped_column(String(10))
    dominant_l3_name: Mapped[str | None] = mapped_column(String(60))
    # Distinct classes observed in this cell per level, and the exact sum of the
    # stored per-class areas at each level (the documented reconciliation
    # denominator: it equals evaluated_area_m2 when the source partitions the cell).
    l1_class_count: Mapped[int] = mapped_column(Integer, default=0)
    l2_class_count: Mapped[int] = mapped_column(Integer, default=0)
    l3_class_count: Mapped[int] = mapped_column(Integer, default=0)
    l1_class_area_sum_m2: Mapped[float] = mapped_column(Float, default=0.0)
    l2_class_area_sum_m2: Mapped[float] = mapped_column(Float, default=0.0)
    l3_class_area_sum_m2: Mapped[float] = mapped_column(Float, default=0.0)
    # Canonicalization audit for this cell: how many candidate rows carried this key
    # across all runs of the grid version, and how many byte-distinct geometry
    # representations beyond the canonical one were proven ST_Equals to it.
    candidate_occurrence_count: Mapped[int] = mapped_column(Integer, default=1)
    representation_variant_count: Mapped[int] = mapped_column(Integer, default=0)
    # True when the documented non-negativity guard changed a reported value.
    guard_applied: Mapped[bool] = mapped_column(Boolean, default=False)
    derivation_version: Mapped[str] = mapped_column(String(50))
    area_crs: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))


class EnvironmentalLandCoverCellClassArea(Base):
    """One official land-cover class's area inside one candidate cell.

    Three levels are stored per cell (``class_level`` 1/2/3 = 대·중·세분류), each
    keyed by the **official source code and name, preserved verbatim** — never
    re-labelled, re-grouped, or reinterpreted as suitability policy. The area is the
    union of that class's intersections with the cell, so overlapping source
    features of the same class are counted once.

    Shares carry two explicitly different denominators, and they are never
    conflated: ``share_of_evaluated_area`` divides by the covered (evaluated) area,
    ``share_of_cell_area`` by the whole cell. When a cell has no coverage there are
    no rows here at all — uncovered area is a coverage field on the parent row and
    is **never** modelled as a synthetic "unknown" land-cover class.
    """

    __tablename__ = "environmental_land_cover_cell_class_areas"
    __table_args__ = (
        UniqueConstraint(
            "cell_statistics_id",
            "class_level",
            "class_code",
            name="uq_land_cover_cell_class_areas_cell_level_code",
        ),
        Index(
            "ix_land_cover_cell_class_areas_version_level_code",
            "statistics_version_id",
            "class_level",
            "class_code",
        ),
        Index("ix_land_cover_cell_class_areas_candidate_key", "candidate_key"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer(), "sqlite"), primary_key=True
    )
    statistics_version_id: Mapped[int] = mapped_column(
        ForeignKey("environmental_land_cover_cell_stat_versions.id"), index=True
    )
    cell_statistics_id: Mapped[int] = mapped_column(
        ForeignKey("environmental_land_cover_cell_statistics.id"), index=True
    )
    # Denormalized for direct class-level queries without joining the parent.
    candidate_key: Mapped[str] = mapped_column(String(50))
    # 1 = 대분류 (L1), 2 = 중분류 (L2), 3 = 세분류 (L3).
    class_level: Mapped[int] = mapped_column(SmallInteger)
    class_code: Mapped[str] = mapped_column(String(10))
    class_name: Mapped[str] = mapped_column(String(60))
    class_area_m2: Mapped[float] = mapped_column(Float)
    # class_area_m2 / evaluated_area_m2. NULL — never 0 — when the cell has no
    # evaluated area, because the ratio is undefined rather than zero.
    share_of_evaluated_area: Mapped[float | None] = mapped_column(Float)
    # class_area_m2 / cell_area_m2.
    share_of_cell_area: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
