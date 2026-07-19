"""Seed idempotency + migration/engine consistency for the standard-cost table.

Runs on SQLite (the reference table is non-spatial). Verifies that the reusable
seed helper is idempotent and that the self-contained Alembic migration snapshot
never diverges from the engine's canonical ``STANDARD_COST_SEED``.
"""

import datetime
import importlib.util
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from waste_equity_backend.analysis import facility_cost as fc
from waste_equity_backend.analysis.facility_cost_seed import (
    PartialStandardCostVersionError,
    seed_standard_costs,
)
from waste_equity_backend.models import FacilityStandardCost

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260719_0015_facility_standard_costs.py"
)


def _load_migration() -> object:
    spec = importlib.util.spec_from_file_location("_facility_cost_migration_0015", _MIGRATION_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_seed_is_idempotent(session: Session) -> None:
    inserted_first = seed_standard_costs(session)
    assert inserted_first == len(fc.STANDARD_COST_SEED)
    # A second seed inserts nothing (the version is already present).
    inserted_second = seed_standard_costs(session)
    assert inserted_second == 0
    total = session.scalar(select(func.count()).select_from(FacilityStandardCost))
    assert total == len(fc.STANDARD_COST_SEED)


def test_seeded_rows_match_the_canonical_bands(session: Session) -> None:
    seed_standard_costs(session)
    rows = session.scalars(
        select(FacilityStandardCost).where(
            FacilityStandardCost.cost_version == fc.ACTIVE_COST_VERSION
        )
    ).all()
    # Include the inclusivity flags: the route's band matching (and therefore the
    # boundary behaviour) depends on them, so they must survive the seed exactly.
    seeded = {
        (
            r.facility_type,
            r.capacity_min_ton_per_day,
            r.capacity_min_inclusive,
            r.capacity_max_ton_per_day,
            r.capacity_max_inclusive,
            r.cost_per_capacity_bn,
        )
        for r in rows
    }
    expected = {
        (
            b.facility_type,
            b.capacity_min_ton_per_day,
            b.capacity_min_inclusive,
            b.capacity_max_ton_per_day,
            b.capacity_max_inclusive,
            b.cost_per_capacity_bn,
        )
        for b in fc.STANDARD_COST_SEED
    }
    assert seeded == expected
    # Every seeded row carries the version's provenance.
    for row in rows:
        assert row.price_base_date == fc.PRICE_BASE_DATE
        assert row.source_document == fc.SOURCE_DOCUMENT
        assert row.source_page == fc.SOURCE_PAGE


def test_reseeding_a_partial_version_fails_visibly(session: Session) -> None:
    # Seed the full version, then drop one band to simulate a partial restore.
    seed_standard_costs(session)
    one = session.scalars(
        select(FacilityStandardCost).where(
            FacilityStandardCost.cost_version == fc.ACTIVE_COST_VERSION
        )
    ).first()
    assert one is not None
    session.delete(one)
    session.flush()
    # Re-seeding must NOT silently leave the version incomplete — it fails visibly.
    with pytest.raises(PartialStandardCostVersionError):
        seed_standard_costs(session)


def _band_row(min_val: Decimal | None, max_val: Decimal | None) -> FacilityStandardCost:
    return FacilityStandardCost(
        cost_version="test-version",
        facility_type="incineration_new",
        capacity_min_ton_per_day=min_val,
        capacity_min_inclusive=min_val is None,
        capacity_max_ton_per_day=max_val,
        capacity_max_inclusive=max_val is not None,
        cost_per_capacity_bn=Decimal("6.24"),
        price_base_date=datetime.date(2022, 12, 1),
        source_document="test",
        source_page="p.1",
        source_note=None,
        created_at=datetime.datetime.now(tz=datetime.UTC),
    )


def test_duplicate_null_bound_bands_are_rejected(session: Session) -> None:
    # A plain unique constraint treats NULL as distinct; the NULL-safe COALESCE
    # index must still reject a duplicate first band (NULL, 30) …
    session.add(_band_row(None, Decimal("30")))
    session.add(_band_row(None, Decimal("30")))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()
    # … and a duplicate last band (200, NULL).
    session.add(_band_row(Decimal("200"), None))
    session.add(_band_row(Decimal("200"), None))
    with pytest.raises(IntegrityError):
        session.flush()


def test_migration_snapshot_matches_engine_seed() -> None:
    migration = _load_migration()
    migration_bands = {
        (
            facility_type,
            None if lo is None else Decimal(lo),
            None if hi is None else Decimal(hi),
            Decimal(cost),
        )
        for facility_type, lo, hi, cost in migration._SEED_BANDS  # type: ignore[attr-defined]
    }
    engine_bands = {
        (
            b.facility_type,
            b.capacity_min_ton_per_day,
            b.capacity_max_ton_per_day,
            b.cost_per_capacity_bn,
        )
        for b in fc.STANDARD_COST_SEED
    }
    assert migration_bands == engine_bands
    # The migration's version metadata matches the engine's active version.
    assert migration._COST_VERSION == fc.ACTIVE_COST_VERSION  # type: ignore[attr-defined]
    assert migration._PRICE_BASE_DATE == fc.PRICE_BASE_DATE  # type: ignore[attr-defined]
    assert migration._SOURCE_PAGE == fc.SOURCE_PAGE  # type: ignore[attr-defined]
