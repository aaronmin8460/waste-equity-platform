"""Core metadata schema: PostGIS, regions, crosswalk, data operations.

Seeds the data_sources registry with the five official sources validated in
Phase 0. Seed rows carry documented endpoints only — never credentials.

Revision ID: 0001
Revises:
Create Date: 2026-07-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "regions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("region_code", sa.String(length=20), nullable=False, index=True),
        sa.Column("region_name", sa.String(length=100), nullable=False),
        sa.Column("region_level", sa.String(length=20), nullable=False),
        sa.Column("parent_region_code", sa.String(length=20), nullable=True, index=True),
        sa.Column(
            "geometry",
            Geometry(geometry_type="MULTIPOLYGON", srid=4326),
            nullable=True,
        ),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.UniqueConstraint("region_code", "valid_from"),
    )

    op.create_table(
        "region_code_map",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("canonical_region_code", sa.String(length=20), nullable=False, index=True),
        sa.Column("sgis_code", sa.String(length=20), nullable=True),
        sa.Column("rcis_code", sa.String(length=20), nullable=True),
        sa.Column("rcis_sido_name", sa.String(length=50), nullable=True),
        sa.Column("rcis_sigungu_name", sa.String(length=50), nullable=True),
        sa.Column("vworld_code", sa.String(length=20), nullable=True),
        sa.Column("airkorea_name", sa.String(length=50), nullable=True),
        sa.Column("kma_grid_x", sa.Integer(), nullable=True),
        sa.Column("kma_grid_y", sa.Integer(), nullable=True),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.UniqueConstraint("canonical_region_code", "valid_from"),
    )

    op.create_table(
        "data_sources",
        sa.Column("source_id", sa.String(length=50), primary_key=True),
        sa.Column("source_name", sa.String(length=200), nullable=False),
        sa.Column("dataset_name", sa.String(length=200), nullable=False),
        sa.Column("endpoint", sa.String(length=500), nullable=False),
        sa.Column("publication_frequency", sa.String(length=20), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("documentation_url", sa.String(length=500), nullable=True),
    )

    op.create_table(
        "ingestion_runs",
        sa.Column("run_id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "source_id",
            sa.String(length=50),
            sa.ForeignKey("data_sources.source_id"),
            nullable=False,
            index=True,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("rows_received", sa.Integer(), nullable=False),
        sa.Column("rows_inserted", sa.Integer(), nullable=False),
        sa.Column("rows_updated", sa.Integer(), nullable=False),
        sa.Column("rows_rejected", sa.Integer(), nullable=False),
        sa.Column("error_category", sa.String(length=50), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
    )

    op.create_table(
        "dataset_freshness",
        sa.Column(
            "source_id",
            sa.String(length=50),
            sa.ForeignKey("data_sources.source_id"),
            primary_key=True,
        ),
        sa.Column("latest_reference_period", sa.String(length=50), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("freshness_status", sa.String(length=20), nullable=False),
    )

    op.create_table(
        "raw_api_responses",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "source_id",
            sa.String(length=50),
            sa.ForeignKey("data_sources.source_id"),
            nullable=False,
            index=True,
        ),
        sa.Column("endpoint_identifier", sa.String(length=200), nullable=False),
        sa.Column("request_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("response_hash", sa.String(length=64), nullable=False, index=True),
        sa.Column("sanitized_response", postgresql.JSONB(), nullable=False),
        sa.Column(
            "ingestion_run_id",
            sa.BigInteger(),
            sa.ForeignKey("ingestion_runs.run_id"),
            nullable=True,
            index=True,
        ),
    )

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
                "source_id": "waste_statistics",
                "source_name": (
                    "Korea Environment Corporation Resource Circulation Information System"
                ),
                "dataset_name": "전국폐기물발생및처리현황 (waste statistics OpenAPI)",
                "endpoint": "https://www.recycling-info.or.kr/sds/JsonApi.do",
                "publication_frequency": "ANNUAL",
                "enabled": True,
                "documentation_url": (
                    "https://www.recycling-info.or.kr/rrs/viewPage.do?menuNo=M130401"
                ),
            },
            {
                "source_id": "sgis",
                "source_name": "Statistics Korea SGIS",
                "dataset_name": "Population statistics and administrative boundaries",
                "endpoint": "https://sgisapi.kostat.go.kr/OpenAPI3",
                "publication_frequency": "MONTHLY",
                "enabled": True,
                "documentation_url": (
                    "https://sgis.kostat.go.kr/developer/html/openApi/api/data.html"
                ),
            },
            {
                "source_id": "airkorea",
                "source_name": "Korea Environment Corporation AirKorea",
                "dataset_name": "Real-time air-quality observations and stations",
                "endpoint": "http://apis.data.go.kr/B552584/ArpltnInforInqireSvc",
                "publication_frequency": "REAL_TIME",
                "enabled": True,
                "documentation_url": "https://www.data.go.kr/data/15073861/openapi.do",
            },
            {
                "source_id": "kma",
                "source_name": "Korea Meteorological Administration",
                "dataset_name": "Ultra-short-term observations and short-term forecasts",
                "endpoint": "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0",
                "publication_frequency": "REAL_TIME",
                "enabled": True,
                "documentation_url": "https://www.data.go.kr/data/15084084/openapi.do",
            },
            {
                "source_id": "vworld",
                "source_name": "VWorld National Spatial Data Infrastructure",
                "dataset_name": "Cadastral, zoning, and structural spatial layers",
                "endpoint": "https://api.vworld.kr/req/data",
                "publication_frequency": "STRUCTURAL",
                "enabled": True,
                "documentation_url": (
                    "https://www.vworld.kr/dev/v4dv_2ddataguide2_s002.do?svcIde=cadastral"
                ),
            },
        ],
    )


def downgrade() -> None:
    op.drop_table("raw_api_responses")
    op.drop_table("dataset_freshness")
    op.drop_table("ingestion_runs")
    op.drop_table("data_sources")
    op.drop_table("region_code_map")
    op.drop_table("regions")
    # The postgis extension is intentionally left installed.
