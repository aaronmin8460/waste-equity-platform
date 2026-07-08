"""Opt-in live RCIS waste ingestion integration test.

Requires:
- TEST_DATABASE_URL pointing at PostgreSQL/PostGIS with SGIS geography loaded.
- RUN_LIVE_RCIS=1.
- RCIS_API_KEY and RCIS_USER_ID.

This test performs live RCIS requests and writes official data; it is never run
by default. It confirms the second identical write is idempotent.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from waste_equity_ingestion.config import ProbeSettings
from waste_equity_ingestion.rcis_waste_ingestion import run_rcis_waste_ingestion

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
RUN_LIVE_RCIS = os.getenv("RUN_LIVE_RCIS") == "1"

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL or not RUN_LIVE_RCIS,
    reason="TEST_DATABASE_URL and RUN_LIVE_RCIS=1 are required",
)


def _upgrade_database() -> None:
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


def test_live_rcis_waste_write_is_idempotent() -> None:
    _upgrade_database()
    settings = ProbeSettings.from_env()

    first = run_rcis_waste_ingestion(settings, year=2024, scope="capital-region", write=True)
    second = run_rcis_waste_ingestion(settings, year=2024, scope="capital-region", write=True)

    assert first.status == "SUCCEEDED"
    assert second.status == "SUCCEEDED"
    assert second.rows_inserted == 0
    assert first.normalized_row_total == second.normalized_row_total

    engine = create_engine(str(TEST_DATABASE_URL))
    try:
        with engine.connect() as connection:
            duplicates = connection.execute(
                text(
                    "SELECT count(*) FROM ("
                    "SELECT region_id, reference_year, source_pid, waste_category_name "
                    "FROM regional_waste_statistics "
                    "GROUP BY region_id, reference_year, source_pid, waste_category_name "
                    "HAVING count(*) > 1"
                    ") d"
                )
            ).scalar_one()
            negatives = connection.execute(
                text(
                    "SELECT count(*) FROM regional_waste_statistics "
                    "WHERE generation_quantity < 0 OR recycling_quantity < 0 "
                    "OR incineration_quantity < 0 OR landfill_quantity < 0 "
                    "OR other_treatment_quantity < 0"
                )
            ).scalar_one()
            bad_basis = connection.execute(
                text(
                    "SELECT count(*) FROM regional_waste_statistics "
                    "WHERE accounting_basis <> 'ORIGIN_BASED_TREATMENT_OUTCOME'"
                )
            ).scalar_one()
        assert duplicates == 0
        assert negatives == 0
        assert bad_basis == 0
    finally:
        engine.dispose()
