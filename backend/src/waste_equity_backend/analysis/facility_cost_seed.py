"""Idempotent seed for the active facility standard-cost version.

Kept out of the pure ``facility_cost`` engine (which imports no models) so the
engine stays DB-free and independently testable. The Alembic migration seeds a
self-contained snapshot for production; this reusable helper seeds the SAME active
version's rows and is used by tests and by the Phase 6 pre-deployment re-seed
check. Both derive from ``facility_cost.STANDARD_COST_SEED``, so they never
diverge (a consistency test asserts the migration snapshot matches it too).
"""

import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import FacilityStandardCost
from . import facility_cost as fc


class PartialStandardCostVersionError(RuntimeError):
    """The active version exists in the DB but does not match the canonical seed."""


def _band_keys(bands: object) -> set[tuple[object, object, object, object]]:
    return {
        (
            b.facility_type,
            b.capacity_min_ton_per_day,
            b.capacity_max_ton_per_day,
            b.cost_per_capacity_bn,
        )
        for b in bands  # type: ignore[attr-defined]
    }


def seed_standard_costs(session: Session) -> int:
    """Insert the active cost version's rows if absent; return rows inserted.

    Idempotent AND self-verifying: if the version is already present in full it
    inserts nothing and returns 0; if it is present but PARTIAL or mismatched (a
    restore, manual repair, or earlier failed seed left some bands missing/wrong)
    it raises :class:`PartialStandardCostVersionError` rather than silently leaving
    an incomplete version that would fail some capacities with NO_MATCHING_COST_BAND.
    """
    existing = session.scalars(
        select(FacilityStandardCost).where(
            FacilityStandardCost.cost_version == fc.ACTIVE_COST_VERSION
        )
    ).all()
    if existing:
        if _band_keys(existing) != _band_keys(fc.STANDARD_COST_SEED):
            raise PartialStandardCostVersionError(
                f"facility_standard_costs for {fc.ACTIVE_COST_VERSION!r} is partial or "
                f"mismatched ({len(existing)} rows, expected {len(fc.STANDARD_COST_SEED)}); "
                "refusing to seed over it — repair the version first."
            )
        return 0
    now = datetime.datetime.now(tz=datetime.UTC)
    for band in fc.STANDARD_COST_SEED:
        session.add(
            FacilityStandardCost(
                cost_version=fc.ACTIVE_COST_VERSION,
                facility_type=band.facility_type,
                capacity_min_ton_per_day=band.capacity_min_ton_per_day,
                capacity_min_inclusive=band.capacity_min_inclusive,
                capacity_max_ton_per_day=band.capacity_max_ton_per_day,
                capacity_max_inclusive=band.capacity_max_inclusive,
                cost_per_capacity_bn=band.cost_per_capacity_bn,
                price_base_date=fc.PRICE_BASE_DATE,
                source_document=fc.SOURCE_DOCUMENT,
                source_page=fc.SOURCE_PAGE,
                source_note=fc.SOURCE_NOTE,
                created_at=now,
            )
        )
    session.flush()
    return len(fc.STANDARD_COST_SEED)
