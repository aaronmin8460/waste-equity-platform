"""Versioned 500 m candidate-cell land-cover statistics (Phase 1B-LC3).

Purely **additive**: three new tables, no change to any existing table, column,
constraint, or row. Nothing here is seeded — the derivation CLI
(``waste-equity-probe land-cover-cell-stats --write``) writes every row.

1. ``environmental_land_cover_cell_stat_versions`` — one row per complete derived
   statistics release, identified by a deterministic ``input_signature`` over the
   source ``land_cover`` release, the canonical candidate-grid version and its
   fingerprint, the derivation version, the area CRS, and the expected cell count.
   ``is_active`` is guarded by a **partial** unique index so at most one release
   can be active per (source release, grid version, derivation version); a failed
   or superseded release is preserved but never active.
2. ``environmental_land_cover_cell_statistics`` — one row per canonical candidate
   cell per statistics version: measured cell area, union-based evaluated area,
   uncovered area, coverage ratio, exact coverage status, the source-overlap
   audit, and the dominant L1/L2/L3 class.
3. ``environmental_land_cover_cell_class_areas`` — the complete class composition,
   one child row per observed official class at each of the three levels, so the
   whole distribution is preserved rather than only the dominant class.

No geometry column is added anywhere (the cell geometry already lives on
``suitability_candidates``), so **no spatial index is created**. No table carries
a score, weight, exclusion, rank, candidate status, or policy column, and no
suitability, structural, wetland, or land-cover feature row is read or written by
this migration — it changes no suitability result.

Downgrade drops exactly and only these three tables.

Revision ID: 0020
Revises: 0019
Create Date: 2026-07-28

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JsonVariant = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

_VERSIONS = "environmental_dataset_versions"
_STAT_VERSIONS = "environmental_land_cover_cell_stat_versions"
_CELL_STATS = "environmental_land_cover_cell_statistics"
_CLASS_AREAS = "environmental_land_cover_cell_class_areas"


def upgrade() -> None:
    # --- 1. Derived statistics release header -------------------------------
    op.create_table(
        _STAT_VERSIONS,
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "land_cover_dataset_version_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{_VERSIONS}.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("candidate_grid_version", sa.String(length=50), nullable=False, index=True),
        sa.Column("candidate_grid_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("derivation_version", sa.String(length=50), nullable=False),
        sa.Column("area_crs", sa.String(length=20), nullable=False),
        sa.Column("input_signature", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("expected_cell_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed_cell_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("complete_exact_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("partial_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("no_coverage_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_cell_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("candidate_row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "duplicate_candidate_occurrence_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "representation_variant_cell_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("total_cell_area_m2", sa.Float(), nullable=False, server_default="0"),
        sa.Column("total_evaluated_area_m2", sa.Float(), nullable=False, server_default="0"),
        sa.Column("total_uncovered_area_m2", sa.Float(), nullable=False, server_default="0"),
        sa.Column("aggregate_coverage_ratio", sa.Float(), nullable=True),
        sa.Column("total_intersection_area_m2", sa.Float(), nullable=False, server_default="0"),
        sa.Column("total_overlap_area_m2", sa.Float(), nullable=False, server_default="0"),
        sa.Column("cells_with_source_overlap", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_overlap_area_m2", sa.Float(), nullable=False, server_default="0"),
        sa.Column("max_overlap_ratio", sa.Float(), nullable=False, server_default="0"),
        sa.Column("guard_applied_cell_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_guard_adjustment_m2", sa.Float(), nullable=False, server_default="0"),
        sa.Column("class_row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("batch_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "ingestion_run_id",
            sa.BigInteger(),
            sa.ForeignKey("ingestion_runs.run_id"),
            nullable=True,
            index=True,
        ),
        sa.Column("derivation_metadata", JsonVariant, nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("input_signature", name="uq_land_cover_cell_stat_versions_signature"),
    )
    # Partial unique index: only ONE active release per source release + grid
    # version + derivation version. Historical/failed releases are preserved.
    op.create_index(
        "uq_land_cover_cell_stat_versions_active",
        _STAT_VERSIONS,
        ["land_cover_dataset_version_id", "candidate_grid_version", "derivation_version"],
        unique=True,
        postgresql_where=sa.text("is_active"),
        sqlite_where=sa.text("is_active"),
    )
    op.create_index("ix_land_cover_cell_stat_versions_status", _STAT_VERSIONS, ["status"])

    # --- 2. Per-candidate-cell statistics ----------------------------------
    op.create_table(
        _CELL_STATS,
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "statistics_version_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{_STAT_VERSIONS}.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "land_cover_dataset_version_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{_VERSIONS}.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("candidate_grid_version", sa.String(length=50), nullable=False),
        sa.Column("candidate_key", sa.String(length=50), nullable=False),
        sa.Column("candidate_geometry_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("sido_region_code", sa.String(length=20), nullable=True),
        sa.Column("sido_region_name", sa.String(length=50), nullable=True),
        sa.Column("sigungu_region_code", sa.String(length=20), nullable=True),
        sa.Column("sigungu_region_name", sa.String(length=50), nullable=True),
        sa.Column("cell_area_m2", sa.Float(), nullable=False),
        sa.Column("evaluated_area_m2", sa.Float(), nullable=False),
        sa.Column("uncovered_area_m2", sa.Float(), nullable=False),
        sa.Column("coverage_ratio", sa.Float(), nullable=False),
        sa.Column("intersection_area_sum_m2", sa.Float(), nullable=False),
        sa.Column("overlap_area_m2", sa.Float(), nullable=False),
        sa.Column("coverage_status", sa.String(length=20), nullable=False),
        # Geometry-derived uncovered area (residual of cell − evaluated union) and
        # the raw ST_Covers predicate, stored as independent evidence beside the
        # arithmetic uncovered area and the status rule.
        sa.Column("uncovered_residual_area_m2", sa.Float(), nullable=False, server_default="0"),
        sa.Column(
            "topological_cover_predicate",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("matched_feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("dominant_l1_code", sa.String(length=10), nullable=True),
        sa.Column("dominant_l1_name", sa.String(length=60), nullable=True),
        sa.Column("dominant_l2_code", sa.String(length=10), nullable=True),
        sa.Column("dominant_l2_name", sa.String(length=60), nullable=True),
        sa.Column("dominant_l3_code", sa.String(length=10), nullable=True),
        sa.Column("dominant_l3_name", sa.String(length=60), nullable=True),
        sa.Column("l1_class_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("l2_class_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("l3_class_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("l1_class_area_sum_m2", sa.Float(), nullable=False, server_default="0"),
        sa.Column("l2_class_area_sum_m2", sa.Float(), nullable=False, server_default="0"),
        sa.Column("l3_class_area_sum_m2", sa.Float(), nullable=False, server_default="0"),
        sa.Column("candidate_occurrence_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("representation_variant_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("guard_applied", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("derivation_version", sa.String(length=50), nullable=False),
        sa.Column("area_crs", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "statistics_version_id",
            "candidate_grid_version",
            "candidate_key",
            name="uq_land_cover_cell_statistics_version_key",
        ),
    )
    op.create_index("ix_land_cover_cell_statistics_candidate_key", _CELL_STATS, ["candidate_key"])
    op.create_index(
        "ix_land_cover_cell_statistics_grid_version", _CELL_STATS, ["candidate_grid_version"]
    )
    op.create_index("ix_land_cover_cell_statistics_sido", _CELL_STATS, ["sido_region_code"])
    op.create_index(
        "ix_land_cover_cell_statistics_version_status",
        _CELL_STATS,
        ["statistics_version_id", "coverage_status"],
    )
    op.create_index(
        "ix_land_cover_cell_statistics_version_dominant_l1",
        _CELL_STATS,
        ["statistics_version_id", "dominant_l1_code"],
    )

    # --- 3. Complete per-class composition ---------------------------------
    op.create_table(
        _CLASS_AREAS,
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "statistics_version_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{_STAT_VERSIONS}.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "cell_statistics_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{_CELL_STATS}.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("candidate_key", sa.String(length=50), nullable=False),
        sa.Column("class_level", sa.SmallInteger(), nullable=False),
        sa.Column("class_code", sa.String(length=10), nullable=False),
        sa.Column("class_name", sa.String(length=60), nullable=False),
        sa.Column("class_area_m2", sa.Float(), nullable=False),
        # NULL (not 0) when the cell has no evaluated area: the ratio is undefined.
        sa.Column("share_of_evaluated_area", sa.Float(), nullable=True),
        sa.Column("share_of_cell_area", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "cell_statistics_id",
            "class_level",
            "class_code",
            name="uq_land_cover_cell_class_areas_cell_level_code",
        ),
    )
    op.create_index(
        "ix_land_cover_cell_class_areas_version_level_code",
        _CLASS_AREAS,
        ["statistics_version_id", "class_level", "class_code"],
    )
    op.create_index("ix_land_cover_cell_class_areas_candidate_key", _CLASS_AREAS, ["candidate_key"])


def downgrade() -> None:
    op.drop_index("ix_land_cover_cell_class_areas_candidate_key", _CLASS_AREAS)
    op.drop_index("ix_land_cover_cell_class_areas_version_level_code", _CLASS_AREAS)
    op.drop_table(_CLASS_AREAS)

    op.drop_index("ix_land_cover_cell_statistics_version_dominant_l1", _CELL_STATS)
    op.drop_index("ix_land_cover_cell_statistics_version_status", _CELL_STATS)
    op.drop_index("ix_land_cover_cell_statistics_sido", _CELL_STATS)
    op.drop_index("ix_land_cover_cell_statistics_grid_version", _CELL_STATS)
    op.drop_index("ix_land_cover_cell_statistics_candidate_key", _CELL_STATS)
    op.drop_table(_CELL_STATS)

    op.drop_index("ix_land_cover_cell_stat_versions_status", _STAT_VERSIONS)
    op.drop_index("uq_land_cover_cell_stat_versions_active", _STAT_VERSIONS)
    op.drop_table(_STAT_VERSIONS)
