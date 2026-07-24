"""Inland wetland inventory tables (Suitability Phase 1B-1).

Adds the environmental-layer *release* table
``environmental_dataset_versions`` and the feature table
``environmental_wetland_inventory_features`` (MULTIPOLYGON/4326), plus the
``nie_wetland_inventory`` data source. The 국립생태원 전국 내륙습지 목록 is a
**surveyed inventory**, not a statutory protection area, so it gets its own
table rather than being folded into ``structural_protected_features`` — where it
would be indistinguishable from the legally-designated ``UM901`` 습지보호지역
polygons and would silently acquire regulatory semantics it does not have.

Purely additive. No existing table is altered, no column is dropped, no row is
deleted, and no feature data is seeded here — the 2,704 features are loaded by
``waste-equity-probe wetland-inventory-ingest``. The new tables hold **no score
column** and are read by no scoring, ranking, or candidate-generation code, so
this migration changes no suitability score, rank, candidate status, weight
profile, or API contract. The GIST spatial index on ``geometry`` is created
automatically by geoalchemy2.

Downgrade removes only the objects added here.

Revision ID: 0018
Revises: 0017
Create Date: 2026-07-23

"""

from collections.abc import Sequence

import sqlalchemy as sa
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JsonVariant = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

_SOURCE_ID = "nie_wetland_inventory"
_VERSIONS = "environmental_dataset_versions"
_FEATURES = "environmental_wetland_inventory_features"


def upgrade() -> None:
    # The environmental raw-file source is distinct from every API source and
    # from the ``vworld_structural`` bulk-file source: different provider,
    # different portal, different legal meaning.
    data_sources = sa.table(
        "data_sources",
        sa.column("source_id", sa.String),
        sa.column("source_name", sa.String),
        sa.column("dataset_name", sa.String),
        sa.column("endpoint", sa.String),
        sa.column("publication_frequency", sa.String),
        sa.column("enabled", sa.Boolean),
        sa.column("documentation_url", sa.String),
    )
    op.bulk_insert(
        data_sources,
        [
            {
                "source_id": _SOURCE_ID,
                "source_name": "국립생태원 (National Institute of Ecology)",
                "dataset_name": "내륙습지 공간데이터 및 속성정보",
                # Local bulk shapefile distribution; no API endpoint exists.
                "endpoint": "https://www.data.go.kr/data/15086410/fileData.do",
                # 수시 (1회성 데이터) — a one-off survey-round publication, not a
                # periodic feed; STRUCTURAL is the platform's non-periodic category.
                "publication_frequency": "STRUCTURAL",
                "enabled": True,
                "documentation_url": "https://www.data.go.kr/data/15086410/fileData.do",
            }
        ],
    )

    op.create_table(
        _VERSIONS,
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "layer_name",
            sa.String(length=50),
            sa.ForeignKey("environmental_layer_registry.layer_name"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "source_id",
            sa.String(length=50),
            sa.ForeignKey("data_sources.source_id"),
            nullable=False,
            index=True,
        ),
        sa.Column("provider", sa.String(length=200), nullable=False),
        sa.Column("official_dataset_name", sa.String(length=300), nullable=False),
        sa.Column("provider_dataset_identifier", sa.String(length=200), nullable=False),
        sa.Column("official_source_url", sa.String(length=500), nullable=True),
        sa.Column("reference_date", sa.Date(), nullable=False),
        sa.Column("source_archive_filename", sa.String(length=500), nullable=True),
        sa.Column("source_filename", sa.String(length=500), nullable=True),
        sa.Column("source_archive_checksum", sa.String(length=64), nullable=True),
        sa.Column("source_checksum", sa.String(length=64), nullable=False, index=True),
        sa.Column("source_crs", sa.String(length=20), nullable=False),
        sa.Column("target_crs", sa.String(length=20), nullable=False),
        sa.Column("source_encoding", sa.String(length=30), nullable=True),
        sa.Column("source_geometry_type", sa.String(length=50), nullable=True),
        sa.Column("normalized_geometry_type", sa.String(length=50), nullable=False),
        sa.Column("declared_feature_count", sa.Integer(), nullable=True),
        sa.Column("total_feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("accepted_feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rejected_feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column("license_note", sa.String(length=300), nullable=True),
        sa.Column(
            "ingestion_run_id",
            sa.BigInteger(),
            sa.ForeignKey("ingestion_runs.run_id"),
            nullable=True,
            index=True,
        ),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acquired_on", sa.Date(), nullable=True),
        sa.Column("source_files", JsonVariant, nullable=True),
        sa.Column("retrieval_metadata", JsonVariant, nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "layer_name",
            "provider_dataset_identifier",
            "reference_date",
            "source_checksum",
            "transformation_version",
            name="uq_environmental_dataset_versions_release",
        ),
    )

    op.create_table(
        _FEATURES,
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "dataset_version_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{_VERSIONS}.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("source_feature_id", sa.String(length=50), nullable=False, index=True),
        sa.Column("source_fid", sa.Integer(), nullable=True),
        sa.Column("wetland_name", sa.String(length=100), nullable=False),
        sa.Column("wetland_code", sa.String(length=50), nullable=False, index=True),
        sa.Column("wetland_type", sa.String(length=50), nullable=False),
        sa.Column("wetland_type_korea", sa.String(length=50), nullable=True),
        sa.Column("wetland_type_ramsar", sa.String(length=50), nullable=True),
        sa.Column("reported_area_m2", sa.BigInteger(), nullable=True),
        sa.Column("source_longitude", sa.Float(), nullable=True),
        sa.Column("source_latitude", sa.Float(), nullable=True),
        sa.Column("source_address", sa.String(length=200), nullable=True),
        sa.Column("source_sido_name", sa.String(length=50), nullable=True),
        sa.Column("source_sigungu_name", sa.String(length=100), nullable=True),
        sa.Column("source_eupmyeondong_name", sa.String(length=100), nullable=True),
        sa.Column("source_ri_name", sa.String(length=100), nullable=True),
        sa.Column("designation_note", sa.String(length=200), nullable=True),
        # Nullable until an official spatial assignment covers the feature; never
        # inferred from the source name strings.
        sa.Column("normalized_sido_code", sa.String(length=20), nullable=True, index=True),
        sa.Column("normalized_sigungu_code", sa.String(length=20), nullable=True, index=True),
        sa.Column(
            "geometry",
            Geometry(geometry_type="MULTIPOLYGON", srid=4326),
            nullable=False,
        ),
        sa.Column("geometry_area_m2", sa.Float(), nullable=False),
        sa.Column("source_crs", sa.String(length=20), nullable=False),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column("source_reference_date", sa.Date(), nullable=False),
        sa.Column("source_checksum", sa.String(length=64), nullable=False),
        sa.Column("feature_fingerprint", sa.String(length=64), nullable=False, index=True),
        sa.Column("raw_attributes", JsonVariant, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "dataset_version_id",
            "source_feature_id",
            name="uq_wetland_inventory_features_version_source_id",
        ),
        sa.UniqueConstraint(
            "dataset_version_id",
            "feature_fingerprint",
            name="uq_wetland_inventory_features_version_fingerprint",
        ),
    )
    op.create_index("ix_wetland_inventory_features_source_sido", _FEATURES, ["source_sido_name"])
    op.create_index(
        "ix_wetland_inventory_features_source_sigungu", _FEATURES, ["source_sigungu_name"]
    )


def downgrade() -> None:
    op.drop_index("ix_wetland_inventory_features_source_sigungu", _FEATURES)
    op.drop_index("ix_wetland_inventory_features_source_sido", _FEATURES)
    op.drop_table(_FEATURES)
    op.drop_table(_VERSIONS)
    # Metadata rows that exist only because of this loader. They reference the
    # data source by foreign key, so they are removed before it; no other
    # source's runs or freshness rows are touched.
    op.execute(sa.text(f"DELETE FROM dataset_freshness WHERE source_id = '{_SOURCE_ID}'"))
    op.execute(sa.text(f"DELETE FROM ingestion_runs WHERE source_id = '{_SOURCE_ID}'"))
    op.execute(sa.text(f"DELETE FROM data_sources WHERE source_id = '{_SOURCE_ID}'"))
