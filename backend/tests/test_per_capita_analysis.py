"""Unit tests for the per-capita derivation math (Phase 5.1)."""

from decimal import Decimal

import pytest

from waste_equity_backend.analysis import (
    UnexpectedQuantityUnitError,
    ZeroPopulationError,
    per_capita_kg_per_year,
)


def test_exact_decimal_division() -> None:
    # 123.456 톤/년 over 250,000 persons is exactly 0.493824 kg/인/년.
    result = per_capita_kg_per_year(Decimal("123.456"), "톤/년", 250000)
    assert result == Decimal("0.493824")


def test_quantizes_to_six_decimals() -> None:
    # 1 톤/년 over 3 persons: 333.333333... quantizes half-even at 6 decimals.
    result = per_capita_kg_per_year(Decimal("1"), "톤/년", 3)
    assert result == Decimal("333.333333")
    assert result.as_tuple().exponent == -6


def test_no_floating_point_drift_on_large_quantities() -> None:
    result = per_capita_kg_per_year(Decimal("83721.300000"), "톤/년", 139417)
    assert result == (Decimal("83721.3") * 1000 / Decimal(139417)).quantize(Decimal("0.000001"))


def test_zero_population_is_refused() -> None:
    with pytest.raises(ZeroPopulationError):
        per_capita_kg_per_year(Decimal("10"), "톤/년", 0)
    with pytest.raises(ZeroPopulationError):
        per_capita_kg_per_year(Decimal("10"), "톤/년", -5)


def test_unexpected_unit_is_refused_not_converted() -> None:
    with pytest.raises(UnexpectedQuantityUnitError) as excinfo:
        per_capita_kg_per_year(Decimal("10"), "kg/월", 1000)
    assert excinfo.value.quantity_unit == "kg/월"
