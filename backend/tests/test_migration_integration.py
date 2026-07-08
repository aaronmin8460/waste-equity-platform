"""Migration integration test against a real PostGIS database.

Runs only when TEST_DATABASE_URL is set (for example the docker compose
database). Applies the migration chain and verifies the schema and seeds.
"""

import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

EXPECTED_TABLES = {
    "regions",
    "region_code_map",
    "data_sources",
    "ingestion_runs",
    "dataset_freshness",
    "raw_api_responses",
    "regional_population",
}
EXPECTED_SOURCE_IDS = {"waste_statistics", "sgis", "airkorea", "kma", "vworld"}


def _run_alembic_upgrade() -> None:
    from alembic.config import Config

    from alembic import command

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    # Settings are cached per process; reset so alembic env sees the URL.
    from waste_equity_backend.config import get_settings

    get_settings.cache_clear()
    command.upgrade(config, "head")


def test_migration_creates_schema_and_seeds() -> None:
    _run_alembic_upgrade()
    engine = create_engine(str(TEST_DATABASE_URL))
    try:
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())
        assert EXPECTED_TABLES.issubset(tables)

        with engine.connect() as connection:
            postgis = connection.execute(
                text("SELECT extname FROM pg_extension WHERE extname = 'postgis'")
            ).scalar()
            assert postgis == "postgis"

            source_ids = set(
                connection.execute(text("SELECT source_id FROM data_sources")).scalars()
            )
            assert EXPECTED_SOURCE_IDS.issubset(source_ids)

            geometry_type = connection.execute(
                text(
                    "SELECT type FROM geometry_columns "
                    "WHERE f_table_name = 'regions' AND f_geometry_column = 'geometry'"
                )
            ).scalar()
            assert geometry_type == "MULTIPOLYGON"

            population_unique = connection.execute(
                text(
                    "SELECT 1 FROM pg_constraint WHERE conname = 'uq_regional_population_region_id'"
                )
            ).scalar()
            assert population_unique == 1
    finally:
        engine.dispose()


def test_migration_is_idempotent_at_head() -> None:
    # Upgrading an already-migrated database must be a no-op, not an error.
    _run_alembic_upgrade()
    _run_alembic_upgrade()
