"""Land-cover (세분류 [2025] 토지피복지도) PostGIS foundation (Phase 1B-LC1).

Two additive changes, both reversible:

1. **Year-only reference period.** ``environmental_dataset_versions`` gains a
   NOT-NULL ``reference_period`` column and its ``reference_date`` is relaxed to
   NULLABLE. Existing rows (the inland-wetland release) are backfilled so
   ``reference_period`` = the ISO string of their ``reference_date`` and their
   ``reference_date`` is preserved exactly. The release-identity unique
   constraint is re-keyed from ``reference_date`` to ``reference_period`` so a
   dataset whose official reference is a bare year (land cover → "2025",
   ``reference_date`` NULL) still has a deterministic identity. No wetland row is
   altered or deleted, and no reference date is fabricated.

2. **Land-cover storage.** Adds ``environmental_land_cover_map_sheets`` (one row
   per canonical map sheet, with cross-region duplicate provenance and per-sheet
   processing tallies) and ``environmental_land_cover_features`` (one normalized
   MULTIPOLYGON/4326 feature per source record, with the full 15-column source
   attribute set and a geometry-repair audit), plus the ``egis_land_cover`` data
   source. **No feature data is seeded here** — the loader
   (``waste-equity-probe land-cover-ingest``) writes it. The new tables carry no
   score, weight, exclusion, rank, or candidate column and are read by no scoring
   code, so this migration changes no suitability result. The GIST spatial index
   on ``geometry`` is created automatically by geoalchemy2.

Downgrade removes only the objects introduced here and restores the prior
``reference_date`` NOT NULL / ``reference_date``-keyed identity. It first deletes
any ``land_cover`` release rows (which exist only because of this phase's loader)
so the NOT-NULL restoration on ``reference_date`` cannot be blocked by a
year-only row.

Revision ID: 0019
Revises: 0018
Create Date: 2026-07-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JsonVariant = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

_SOURCE_ID = "egis_land_cover"
_VERSIONS = "environmental_dataset_versions"
_MAP_SHEETS = "environmental_land_cover_map_sheets"
_FEATURES = "environmental_land_cover_features"
_RELEASE_UQ = "uq_environmental_dataset_versions_release"


def upgrade() -> None:
    # --- 1. Year-only reference period on the shared release table ----------
    op.add_column(_VERSIONS, sa.Column("reference_period", sa.String(length=20), nullable=True))
    # Backfill every existing row deterministically from its (NOT-NULL, pre-0019)
    # reference_date, preserving that date. reference_period then becomes the
    # identity component; the value is identical in meaning to the old key.
    op.execute(
        sa.text(
            f"UPDATE {_VERSIONS} "
            "SET reference_period = to_char(reference_date, 'YYYY-MM-DD') "
            "WHERE reference_period IS NULL"
        )
    )
    op.alter_column(
        _VERSIONS, "reference_period", existing_type=sa.String(length=20), nullable=False
    )
    # Relax reference_date so a year-only release can leave it NULL.
    op.alter_column(_VERSIONS, "reference_date", existing_type=sa.Date(), nullable=True)
    # Re-key release identity onto reference_period (a NULL reference_date could
    # not anchor a unique key).
    op.drop_constraint(_RELEASE_UQ, _VERSIONS, type_="unique")
    op.create_unique_constraint(
        _RELEASE_UQ,
        _VERSIONS,
        [
            "layer_name",
            "provider_dataset_identifier",
            "reference_period",
            "source_checksum",
            "transformation_version",
        ],
    )

    # --- 2. EGIS land-cover data source ------------------------------------
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
                "source_name": "환경부 환경공간정보서비스 EGIS (Ministry of Environment, EGIS)",
                "dataset_name": (
                    "세분류 [2025] 전국 토지피복지도 (Detailed / Level-3 Land Cover Map, 2025)"
                ),
                # Bulk vector shapefile distribution from the EGIS portal; no API.
                "endpoint": "https://egis.me.go.kr",
                # 부정기 (권역별) — released per region, not on a periodic feed;
                # STRUCTURAL is the platform's non-periodic category.
                "publication_frequency": "STRUCTURAL",
                "enabled": True,
                "documentation_url": "https://egis.me.go.kr",
            }
        ],
    )

    # --- 3. Canonical map-sheet provenance ---------------------------------
    op.create_table(
        _MAP_SHEETS,
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "dataset_version_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{_VERSIONS}.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("map_sheet_id", sa.String(length=40), nullable=False),
        sa.Column("canonical_source_filename", sa.String(length=255), nullable=False),
        sa.Column("source_shp_checksum", sa.String(length=64), nullable=False, index=True),
        sa.Column("source_regions", JsonVariant, nullable=True),
        sa.Column("duplicate_occurrence_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("duplicate_classification", sa.String(length=40), nullable=False),
        sa.Column("source_feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source_bounds_5186", JsonVariant, nullable=True),
        sa.Column("source_crs", sa.String(length=20), nullable=False),
        sa.Column("source_encoding", sa.String(length=30), nullable=False),
        sa.Column(
            "processing_status", sa.String(length=20), nullable=False, server_default="PENDING"
        ),
        sa.Column("accepted_feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("repaired_feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rejected_feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "dataset_version_id", "map_sheet_id", name="uq_land_cover_map_sheets_version_sheet"
        ),
    )
    op.create_index("ix_land_cover_map_sheets_map_sheet_id", _MAP_SHEETS, ["map_sheet_id"])

    # --- 4. Normalized land-cover features ---------------------------------
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
        sa.Column("map_sheet_id", sa.String(length=40), nullable=False),
        sa.Column("source_record_index", sa.Integer(), nullable=False),
        sa.Column("l1_code", sa.String(length=10), nullable=True),
        sa.Column("l1_name", sa.String(length=60), nullable=True),
        sa.Column("l2_code", sa.String(length=10), nullable=True),
        sa.Column("l2_name", sa.String(length=60), nullable=True),
        sa.Column("l3_code", sa.String(length=10), nullable=True),
        sa.Column("l3_name", sa.String(length=60), nullable=True),
        sa.Column("img_name", sa.String(length=60), nullable=True),
        sa.Column("img_date", sa.String(length=20), nullable=True),
        sa.Column("inx_num", sa.String(length=20), nullable=True),
        sa.Column("anno", sa.Text(), nullable=True),
        sa.Column("geometry", Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False),
        sa.Column("geometry_area_m2", sa.Float(), nullable=False),
        sa.Column("source_geometry_valid", sa.Boolean(), nullable=False),
        sa.Column("source_invalidity_reason", sa.String(length=200), nullable=True),
        sa.Column("geometry_repair_status", sa.String(length=20), nullable=False),
        sa.Column("geometry_repair_method", sa.String(length=50), nullable=True),
        sa.Column("discarded_component_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discarded_component_types", JsonVariant, nullable=True),
        sa.Column("source_area_m2", sa.Float(), nullable=True),
        sa.Column("repaired_area_m2", sa.Float(), nullable=True),
        sa.Column("area_delta_m2", sa.Float(), nullable=True),
        sa.Column("source_geometry_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("feature_fingerprint", sa.String(length=64), nullable=False, index=True),
        sa.Column("source_crs", sa.String(length=20), nullable=False),
        sa.Column("target_crs", sa.String(length=20), nullable=False),
        sa.Column("source_encoding", sa.String(length=30), nullable=False),
        sa.Column("source_reference_period", sa.String(length=20), nullable=False),
        sa.Column("transformation_version", sa.String(length=100), nullable=False),
        sa.Column("raw_attributes", JsonVariant, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "dataset_version_id",
            "map_sheet_id",
            "source_record_index",
            name="uq_land_cover_features_version_sheet_record",
        ),
        sa.UniqueConstraint(
            "dataset_version_id",
            "feature_fingerprint",
            name="uq_land_cover_features_version_fingerprint",
        ),
    )
    op.create_index("ix_land_cover_features_l3_code", _FEATURES, ["l3_code"])


def downgrade() -> None:
    op.drop_index("ix_land_cover_features_l3_code", _FEATURES)
    op.drop_table(_FEATURES)
    op.drop_index("ix_land_cover_map_sheets_map_sheet_id", _MAP_SHEETS)
    op.drop_table(_MAP_SHEETS)

    # Metadata rows that exist only because of this loader / phase.
    op.execute(sa.text(f"DELETE FROM dataset_freshness WHERE source_id = '{_SOURCE_ID}'"))
    # Year-only releases (reference_date NULL) would block the NOT-NULL
    # restoration below; they exist only because of the land-cover loader.
    op.execute(sa.text(f"DELETE FROM {_VERSIONS} WHERE layer_name = 'land_cover'"))
    op.execute(sa.text(f"DELETE FROM ingestion_runs WHERE source_id = '{_SOURCE_ID}'"))
    op.execute(sa.text(f"DELETE FROM data_sources WHERE source_id = '{_SOURCE_ID}'"))

    # Revert the release identity to the reference_date key and restore NOT NULL.
    op.drop_constraint(_RELEASE_UQ, _VERSIONS, type_="unique")
    op.alter_column(_VERSIONS, "reference_date", existing_type=sa.Date(), nullable=False)
    op.create_unique_constraint(
        _RELEASE_UQ,
        _VERSIONS,
        [
            "layer_name",
            "provider_dataset_identifier",
            "reference_date",
            "source_checksum",
            "transformation_version",
        ],
    )
    op.drop_column(_VERSIONS, "reference_period")
