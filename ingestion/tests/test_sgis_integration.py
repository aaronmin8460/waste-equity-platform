"""Opt-in live SGIS ingestion integration test.

Requires:
- TEST_DATABASE_URL pointing at PostgreSQL/PostGIS.
- RUN_LIVE_SGIS=1.
- SGIS_CONSUMER_KEY and SGIS_CONSUMER_SECRET.

This test writes official SGIS data and is never run by default.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from waste_equity_ingestion.config import ProbeSettings
from waste_equity_ingestion.sgis_ingestion import run_sgis_ingestion

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
RUN_LIVE_SGIS = os.getenv("RUN_LIVE_SGIS") == "1"

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL or not RUN_LIVE_SGIS,
    reason="TEST_DATABASE_URL and RUN_LIVE_SGIS=1 are required",
)


def _upgrade_database() -> None:
    backend_dir = Path(__file__).resolve().parents[2] / "backend"
    config = Config(str(backend_dir / "alembic.ini"))
    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    from waste_equity_backend.config import get_settings
    from waste_equity_backend.db import get_engine, get_sessionmaker

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()
    command.upgrade(config, "head")


def test_live_sgis_write_is_idempotent_against_postgis() -> None:
    _upgrade_database()
    settings = ProbeSettings.from_env()

    first = run_sgis_ingestion(settings, year=2024, scope="capital-region", write=True)
    second = run_sgis_ingestion(settings, year=2024, scope="capital-region", write=True)

    assert first.status == "SUCCEEDED"
    assert second.status == "SUCCEEDED"
    assert second.rows_inserted == 0

    engine = create_engine(str(TEST_DATABASE_URL))
    try:
        with engine.connect() as connection:
            duplicate_regions = connection.execute(
                text(
                    "SELECT count(*) FROM ("
                    "SELECT region_code, valid_from FROM regions "
                    "GROUP BY region_code, valid_from HAVING count(*) > 1"
                    ") duplicates"
                )
            ).scalar_one()
            duplicate_population = connection.execute(
                text(
                    "SELECT count(*) FROM ("
                    "SELECT region_id, reference_year, source_id, population_definition "
                    "FROM regional_population "
                    "GROUP BY region_id, reference_year, source_id, population_definition "
                    "HAVING count(*) > 1"
                    ") duplicates"
                )
            ).scalar_one()
            invalid_geometry = connection.execute(
                text("SELECT count(*) FROM regions WHERE NOT ST_IsValid(geometry)")
            ).scalar_one()
            srid = connection.execute(
                text("SELECT ST_SRID(geometry) FROM regions WHERE geometry IS NOT NULL LIMIT 1")
            ).scalar_one()
            spatial_index = connection.execute(
                text(
                    "SELECT count(*) FROM pg_indexes "
                    "WHERE schemaname = 'public' AND indexname = 'idx_regions_geometry'"
                )
            ).scalar_one()
        assert duplicate_regions == 0
        assert duplicate_population == 0
        assert invalid_geometry == 0
        assert srid == 4326
        assert spatial_index == 1
    finally:
        engine.dispose()
