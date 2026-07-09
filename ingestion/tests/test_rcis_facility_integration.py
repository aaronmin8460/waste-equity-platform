"""Opt-in live RCIS facility ingestion integration test.

Requires TEST_DATABASE_URL (PostGIS with SGIS geography), RUN_LIVE_RCIS=1, and
RCIS credentials. Performs live requests and writes official data; never run by
default. Confirms the second identical write is idempotent.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from waste_equity_ingestion.config import ProbeSettings
from waste_equity_ingestion.rcis_facility_ingestion import run_rcis_facility_ingestion

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
RUN_LIVE_RCIS = os.getenv("RUN_LIVE_RCIS") == "1"

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL or not RUN_LIVE_RCIS,
    reason="TEST_DATABASE_URL and RUN_LIVE_RCIS=1 are required",
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


def test_live_facility_write_is_idempotent() -> None:
    _upgrade()
    settings = ProbeSettings.from_env()

    first = run_rcis_facility_ingestion(settings, year=2024, scope="capital-region", write=True)
    second = run_rcis_facility_ingestion(settings, year=2024, scope="capital-region", write=True)

    assert first.status == "SUCCEEDED"
    assert second.status == "SUCCEEDED"
    assert second.rows_inserted == 0
    assert first.normalized_row_total == second.normalized_row_total

    engine = create_engine(str(TEST_DATABASE_URL))
    try:
        with engine.connect() as connection:
            # The reviewed identity key is (source_pid, reference_year,
            # source_row_index): one site legitimately reports multiple
            # process lines sharing name/address/SEQ/line type and differing
            # only in quantities (live-verified 2026-07-09, e.g. NTN032
            # 동대문환경자원센터 with four lines). Name/address is therefore
            # NOT a unique business key and must not be asserted as one.
            duplicates = connection.execute(
                text(
                    "SELECT count(*) FROM ("
                    "SELECT source_pid, reference_year, source_row_index "
                    "FROM waste_treatment_facilities "
                    "GROUP BY 1,2,3 HAVING count(*) > 1) d"
                )
            ).scalar_one()
            bad_basis = connection.execute(
                text(
                    "SELECT count(*) FROM waste_treatment_facilities "
                    "WHERE accounting_basis <> 'FACILITY_LOCATION_BASED_THROUGHPUT'"
                )
            ).scalar_one()
            bad_status = connection.execute(
                text(
                    "SELECT count(*) FROM waste_treatment_facilities "
                    "WHERE region_mapping_status = 'EXACT_MATCH' AND region_id IS NULL"
                )
            ).scalar_one()
            stored_rows = connection.execute(
                text("SELECT count(*) FROM waste_treatment_facilities WHERE reference_year = 2024")
            ).scalar_one()
        assert duplicates == 0
        assert bad_basis == 0
        assert bad_status == 0
        # Catches phantom inserts under shifted row indices, which the
        # identity-key duplicate check alone cannot see.
        assert stored_rows == second.normalized_row_total
    finally:
        engine.dispose()
