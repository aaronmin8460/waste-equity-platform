"""Suitability analysis runs and candidate scores (Phase 5.4).

Adds ``suitability_analysis_runs`` (one reproducible weighted-composite build,
keyed by a deterministic ``analysis_signature``) and ``suitability_candidates``
(per 500 m grid cell: analytical status, four component scores, raw values,
per-profile totals/ranks, provenance, and clipped geometry + centroid). Both are
derived analytical tables; no ingested source data is modified. The GiST spatial
indexes on ``centroid`` and ``geometry`` are created automatically by geoalchemy2
during ``create_table``. See ``docs/SUITABILITY_POLICY_V1.md``.

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-12

"""

from collections.abc import Sequence

import sqlalchemy as sa
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JsonVariant = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
Score = sa.Numeric(precision=7, scale=4)


def upgrade() -> None:
    op.create_table(
        "suitability_analysis_runs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("derivation_version", sa.String(length=50), nullable=False),
        sa.Column("policy_version", sa.String(length=50), nullable=False),
        sa.Column("candidate_grid_version", sa.String(length=50), nullable=False),
        sa.Column("reference_year", sa.Integer(), nullable=False),
        sa.Column("boundary_vintage", sa.String(length=20), nullable=False),
        sa.Column("weight_profile", sa.String(length=30), nullable=False),
        sa.Column("analysis_signature", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("candidate_count_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("candidate_count_eligible", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("candidate_count_review", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("candidate_count_excluded", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("input_dataset_version_ids", JsonVariant, nullable=True),
        sa.Column("input_provenance", JsonVariant, nullable=True),
        sa.Column("policy_snapshot", JsonVariant, nullable=True),
        sa.Column("weight_profiles", JsonVariant, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_category", sa.String(length=50), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_suitability_analysis_runs_signature",
        "suitability_analysis_runs",
        ["analysis_signature"],
    )
    op.create_index(
        "ix_suitability_analysis_runs_status",
        "suitability_analysis_runs",
        ["status"],
    )

    op.create_table(
        "suitability_candidates",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "analysis_run_id",
            sa.BigInteger(),
            sa.ForeignKey("suitability_analysis_runs.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("candidate_key", sa.String(length=50), nullable=False),
        sa.Column("sido_region_code", sa.String(length=20), nullable=True),
        sa.Column("sido_region_name", sa.String(length=50), nullable=True),
        sa.Column("sigungu_region_code", sa.String(length=20), nullable=True),
        sa.Column("sigungu_region_name", sa.String(length=50), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=True),
        sa.Column("provisional_score", Score, nullable=True),
        sa.Column("total_score", Score, nullable=True),
        sa.Column("zoning_score", Score, nullable=True),
        sa.Column("road_score", Score, nullable=True),
        sa.Column("equity_score", Score, nullable=True),
        sa.Column("demand_score", Score, nullable=True),
        sa.Column("profile_totals", JsonVariant, nullable=True),
        sa.Column("profile_ranks", JsonVariant, nullable=True),
        sa.Column("raw_components", JsonVariant, nullable=True),
        sa.Column("exclusion_reasons", JsonVariant, nullable=True),
        sa.Column("review_reasons", JsonVariant, nullable=True),
        sa.Column("penalties", JsonVariant, nullable=True),
        sa.Column("nearest_road_distance_m", sa.Numeric(precision=12, scale=3), nullable=True),
        sa.Column("nearest_road_provenance", JsonVariant, nullable=True),
        sa.Column("component_provenance", JsonVariant, nullable=True),
        sa.Column("original_area_m2", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("clipped_area_m2", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("clipped_area_ratio", sa.Numeric(precision=6, scale=5), nullable=False),
        sa.Column("centroid", Geometry(geometry_type="POINT", srid=4326), nullable=False),
        sa.Column("geometry", Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "analysis_run_id",
            "candidate_key",
            name="uq_suitability_candidates_run_key",
        ),
    )
    op.create_index(
        "ix_suitability_candidates_status", "suitability_candidates", ["status"]
    )
    op.create_index(
        "ix_suitability_candidates_total_score", "suitability_candidates", ["total_score"]
    )
    op.create_index("ix_suitability_candidates_rank", "suitability_candidates", ["rank"])
    op.create_index(
        "ix_suitability_candidates_sido", "suitability_candidates", ["sido_region_code"]
    )
    op.create_index(
        "ix_suitability_candidates_sigungu", "suitability_candidates", ["sigungu_region_code"]
    )


def downgrade() -> None:
    op.drop_index("ix_suitability_candidates_sigungu", "suitability_candidates")
    op.drop_index("ix_suitability_candidates_sido", "suitability_candidates")
    op.drop_index("ix_suitability_candidates_rank", "suitability_candidates")
    op.drop_index("ix_suitability_candidates_total_score", "suitability_candidates")
    op.drop_index("ix_suitability_candidates_status", "suitability_candidates")
    op.drop_table("suitability_candidates")
    op.drop_index("ix_suitability_analysis_runs_status", "suitability_analysis_runs")
    op.drop_index("ix_suitability_analysis_runs_signature", "suitability_analysis_runs")
    op.drop_table("suitability_analysis_runs")
