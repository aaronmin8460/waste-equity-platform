"""Unit tests for the facility-burden throughput aggregation (Phase 5.2)."""

from decimal import Decimal

from waste_equity_backend.analysis import FacilityThroughput, aggregate_throughput


def _facility(quantity: str | None, unit: str | None = "톤/년") -> FacilityThroughput:
    return FacilityThroughput(
        throughput_quantity=None if quantity is None else Decimal(quantity),
        throughput_unit=unit,
    )


def test_sums_reported_throughput_exactly() -> None:
    aggregate = aggregate_throughput([_facility("100.5"), _facility("0"), _facility("23.456")])
    assert aggregate.facility_count == 3
    assert aggregate.total_tons_per_year == Decimal("123.956")
    assert aggregate.missing_throughput_count == 0
    assert aggregate.is_partial is False


def test_empty_region_is_a_real_zero() -> None:
    aggregate = aggregate_throughput([])
    assert aggregate.facility_count == 0
    assert aggregate.total_tons_per_year == Decimal("0")
    assert aggregate.is_partial is False


def test_missing_throughput_is_counted_never_estimated() -> None:
    aggregate = aggregate_throughput([_facility("100"), _facility(None)])
    assert aggregate.facility_count == 2
    assert aggregate.total_tons_per_year == Decimal("100")
    assert aggregate.missing_throughput_count == 1
    assert aggregate.is_partial is True


def test_unexpected_unit_is_excluded_not_converted() -> None:
    aggregate = aggregate_throughput([_facility("100"), _facility("50", unit="톤/일")])
    assert aggregate.total_tons_per_year == Decimal("100")
    assert aggregate.missing_throughput_count == 1
    assert aggregate.is_partial is True


def test_zero_throughput_rows_are_real_values_not_missing() -> None:
    aggregate = aggregate_throughput([_facility("0"), _facility("0")])
    assert aggregate.total_tons_per_year == Decimal("0")
    assert aggregate.missing_throughput_count == 0
    assert aggregate.is_partial is False
