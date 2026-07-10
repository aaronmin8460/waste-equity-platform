"""Facility-burden throughput aggregation (Phase 5.2).

Sums official facility throughput (톤/년, accounting basis
``FACILITY_LOCATION_BASED_THROUGHPUT``) for a set of facilities. A facility
whose throughput is missing or reported in an unexpected unit is never
guessed into the sum: it is counted in ``missing_throughput_count`` and the
aggregate is flagged partial so consumers see a known undercount instead of a
fabricated total.
"""

from dataclasses import dataclass
from decimal import Decimal

from .per_capita import EXPECTED_QUANTITY_UNIT

# Bump when the aggregation or unit handling changes.
BURDEN_DERIVATION_VERSION = "facility-burden-v1"
BURDEN_DERIVATION_FORMULA = "sum(throughput_quantity[톤/년]) × 1000 ÷ population[persons]"


@dataclass(frozen=True)
class FacilityThroughput:
    """The two aggregation inputs of one facility row."""

    throughput_quantity: Decimal | None
    throughput_unit: str | None


@dataclass(frozen=True)
class ThroughputAggregate:
    facility_count: int
    total_tons_per_year: Decimal
    missing_throughput_count: int

    @property
    def is_partial(self) -> bool:
        """True when the total is a known undercount."""
        return self.missing_throughput_count > 0


def aggregate_throughput(facilities: list[FacilityThroughput]) -> ThroughputAggregate:
    """Sum reported 톤/년 throughput; count (never estimate) unusable rows."""
    total = Decimal("0")
    missing = 0
    for facility in facilities:
        if (
            facility.throughput_quantity is None
            or facility.throughput_unit != EXPECTED_QUANTITY_UNIT
        ):
            missing += 1
            continue
        total += facility.throughput_quantity
    return ThroughputAggregate(
        facility_count=len(facilities),
        total_tons_per_year=total,
        missing_throughput_count=missing,
    )
