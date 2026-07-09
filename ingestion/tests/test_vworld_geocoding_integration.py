"""Opt-in live VWorld geocoding integration test.

Requires TEST_DATABASE_URL (with Phase 2.3 facilities loaded), RUN_LIVE_VWORLD=1,
and VWORLD_API_KEY. Performs live geocoder requests and writes provenance;
never runs by default. Confirms the second identical run is idempotent (zero
API calls, zero row changes) and that no coordinate was fabricated.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from waste_equity_ingestion.config import ProbeSettings
from waste_equity_ingestion.vworld_geocoding_ingestion import run_vworld_geocoding

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
RUN_LIVE_VWORLD = os.getenv("RUN_LIVE_VWORLD") == "1"

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL or not RUN_LIVE_VWORLD,
    reason="TEST_DATABASE_URL and RUN_LIVE_VWORLD=1 are required",
)


def _upgrade() -> None:
    from alembic import command
    from alembic.config import Config

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


def test_live_geocoding_is_idempotent_and_never_fabricates() -> None:
    _upgrade()
    settings = ProbeSettings.from_env()

    first = run_vworld_geocoding(settings, write=True)
    second = run_vworld_geocoding(settings, write=True)

    assert first.status == "SUCCEEDED"
    assert second.status == "SUCCEEDED"
    # Everything processed in the first run is skipped in the second.
    assert second.api_calls == 0
    assert second.rows_updated == 0
    assert second.processed == 0
    assert (
        second.skipped_already_geocoded + second.skipped_previously_failed
        == first.facilities_considered
    )

    engine = create_engine(str(TEST_DATABASE_URL))
    try:
        with engine.connect() as connection:
            fabricated = connection.execute(
                text(
                    "SELECT count(*) FROM waste_treatment_facilities "
                    "WHERE geometry IS NOT NULL AND geocode_status IS DISTINCT FROM 'SUCCEEDED'"
                )
            ).scalar_one()
            success_without_point = connection.execute(
                text(
                    "SELECT count(*) FROM waste_treatment_facilities "
                    "WHERE geocode_status = 'SUCCEEDED' AND geometry IS NULL"
                )
            ).scalar_one()
            dangling_match = connection.execute(
                text(
                    "SELECT count(*) FROM waste_treatment_facilities "
                    "WHERE region_mapping_status = 'GEOCODED_MATCH' AND region_id IS NULL"
                )
            ).scalar_one()
            outside_korea = connection.execute(
                text(
                    "SELECT count(*) FROM waste_treatment_facilities "
                    "WHERE geometry IS NOT NULL AND NOT ("
                    "ST_X(geometry) BETWEEN 124 AND 132 AND ST_Y(geometry) BETWEEN 33 AND 39)"
                )
            ).scalar_one()
            wrong_srid = connection.execute(
                text(
                    "SELECT count(*) FROM waste_treatment_facilities "
                    "WHERE geometry IS NOT NULL AND ST_SRID(geometry) <> 4326"
                )
            ).scalar_one()
        assert fabricated == 0
        assert success_without_point == 0
        assert dangling_match == 0
        assert outside_korea == 0
        assert wrong_srid == 0
    finally:
        engine.dispose()
