"""Versioned structural spatial layers: dataset versions and features (2.5B-1).

Adds the reusable ``structural_dataset_versions`` and ``structural_features``
tables for versioned official bulk spatial layers, and seeds a dedicated
``vworld_structural`` data source (distinct from the ``vworld`` geocoder source
so structural-layer freshness is tracked independently). Zoning (UQ111–UQ114)
is the first layer family loaded through this schema; protected/restricted and
road layers reuse it in later subphases.

The ``structural_features.geometry`` GIST spatial index is created
automatically by geoalchemy2 during ``create_table`` (as for ``regions`` in
revision 0001).

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-12

"""

from collections.abc import Sequence

import sqlalchemy as sa
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JsonVariant = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
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
                "source_id": "vworld_structural",
                "source_name": "VWorld National Spatial Data Infrastructure (structural layers)",
                "dataset_name": (
                    "용도지역지구도 및 구조적 공간레이어 (zoning/protected/road bulk files)"
                ),
                "endpoint": "https://www.vworld.kr/dtmk/dtmk_ntads_s001.do",
                "publication_frequency": "STRUCTURAL",
                "enabled": True,
                "documentation_url": "https://www.vworld.kr/dtmk/dtmk_ntads_s001.do",
            }
        ],
    )

    op.create_table(
        "structural_dataset_versions",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "source_id",
            sa.String(length=50),
            sa.ForeignKey("data_sources.source_id"),
            nullable=False,
            index=True,
        ),
        sa.Column("provider", sa.String(length=200), nullable=False),
        sa.Column("provider_dataset_identifier", sa.String(length=200), nullable=False),
        sa.Column("layer_identifier", sa.String(length=100), nullable=True),
        sa.Column("layer_family", sa.String(length=50), nullable=False, index=True),
        sa.Column("reference_date", sa.Date(), nullable=False),
        sa.Column("source_filename", sa.String(length=500), nullable=True),
        sa.Column("source_checksum", sa.String(length=64), nullable=False, index=True),
        sa.Column("source_crs", sa.String(length=20), nullable=False),
        sa.Column("target_crs", sa.String(length=20), nullable=False),
        sa.Column("source_geometry_type", sa.String(length=50), nullable=True),
        sa.Column("normalized_geometry_type", sa.String(length=50), nullable=False),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column(
            "ingestion_run_id",
            sa.BigInteger(),
            sa.ForeignKey("ingestion_runs.run_id"),
            nullable=True,
            index=True,
        ),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("accepted_feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rejected_feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("coverage_status", sa.String(length=20), nullable=False),
        sa.Column("source_files", JsonVariant, nullable=True),
        sa.Column("coverage_matrix", JsonVariant, nullable=True),
        sa.Column("retrieval_metadata", JsonVariant, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "source_id",
            "layer_family",
            "provider_dataset_identifier",
            "reference_date",
            "source_checksum",
            "transformation_version",
            name="uq_structural_dataset_versions_release",
        ),
    )

    op.create_table(
        "structural_features",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "dataset_version_id",
            sa.BigInteger(),
            sa.ForeignKey("structural_dataset_versions.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("layer_identifier", sa.String(length=100), nullable=False, index=True),
        sa.Column("provider_feature_id", sa.String(length=200), nullable=True),
        sa.Column("zoning_category", sa.String(length=40), nullable=False),
        sa.Column("official_zoning_code", sa.String(length=20), nullable=False),
        sa.Column("official_zoning_name", sa.String(length=100), nullable=False),
        sa.Column("target_region_code", sa.String(length=20), nullable=True),
        sa.Column("target_region_name", sa.String(length=50), nullable=True),
        sa.Column("source_attributes", JsonVariant, nullable=True),
        sa.Column(
            "geometry",
            Geometry(geometry_type="MULTIPOLYGON", srid=4326),
            nullable=False,
        ),
        sa.Column("feature_fingerprint", sa.String(length=64), nullable=False, index=True),
        sa.Column("source_provenance", JsonVariant, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "dataset_version_id",
            "feature_fingerprint",
            name="uq_structural_features_version_fingerprint",
        ),
    )
    op.create_index("ix_structural_features_category", "structural_features", ["zoning_category"])
    op.create_index(
        "ix_structural_features_target_region",
        "structural_features",
        ["target_region_code"],
    )


def downgrade() -> None:
    op.drop_index("ix_structural_features_target_region", "structural_features")
    op.drop_index("ix_structural_features_category", "structural_features")
    op.drop_table("structural_features")
    op.drop_table("structural_dataset_versions")
    op.execute("DELETE FROM data_sources WHERE source_id = 'vworld_structural'")
