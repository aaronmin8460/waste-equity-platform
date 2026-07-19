"""Facility standard-cost migration + seed integration test (PostGIS).

Runs only when TEST_DATABASE_URL is set. Applies the migration chain and verifies
the ``facility_standard_costs`` table, the seeded v2022dec rows (values match the
engine's canonical seed), and that re-seeding is idempotent against the real DB.
"""

import os
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session

from waste_equity_backend.analysis import facility_cost as fc
from waste_equity_backend.analysis.facility_cost_seed import seed_standard_costs
from waste_equity_backend.models import FacilityStandardCost

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")


def _run_alembic_upgrade() -> None:
    from alembic.config import Config

    from alembic import command

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    assert TEST_DATABASE_URL is not None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    from waste_equity_backend.config import get_settings

    get_settings.cache_clear()
    command.upgrade(config, "head")


def test_migration_creates_and_seeds_standard_costs() -> None:
    _run_alembic_upgrade()
    engine = create_engine(str(TEST_DATABASE_URL))
    try:
        assert "facility_standard_costs" in set(inspect(engine).get_table_names())
        with Session(engine) as session:
            rows = session.scalars(
                select(FacilityStandardCost).where(
                    FacilityStandardCost.cost_version == fc.ACTIVE_COST_VERSION
                )
            ).all()
            assert len(rows) == len(fc.STANDARD_COST_SEED)
            seeded = {
                (
                    r.facility_type,
                    r.capacity_min_ton_per_day,
                    r.capacity_max_ton_per_day,
                    r.cost_per_capacity_bn,
                )
                for r in rows
            }
            expected = {
                (
                    b.facility_type,
                    b.capacity_min_ton_per_day,
                    b.capacity_max_ton_per_day,
                    b.cost_per_capacity_bn,
                )
                for b in fc.STANDARD_COST_SEED
            }
            assert seeded == expected
            # Spot-check an exact value survives the round trip through Postgres.
            sorting_35 = next(
                r
                for r in rows
                if r.facility_type == "sorting_auto" and r.capacity_min_ton_per_day == Decimal("30")
            )
            assert sorting_35.cost_per_capacity_bn == Decimal("3.45")

            # Re-seeding is idempotent: the version is already present → 0 inserted.
            inserted = seed_standard_costs(session)
            session.rollback()
            assert inserted == 0
    finally:
        engine.dispose()
