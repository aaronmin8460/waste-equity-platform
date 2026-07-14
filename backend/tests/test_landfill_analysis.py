"""Unit tests for the pure landfill inbound-flow derivation helpers."""

from __future__ import annotations

from decimal import Decimal

from waste_equity_backend.analysis import landfill as la


def test_effective_fee_per_ton() -> None:
    # 915,000,000 KRW over 17,500,000 kg (17,500 t) = 52,285.71 KRW/t.
    assert la.effective_fee_per_ton(Decimal("915000000"), Decimal("17500000")) == Decimal(
        "52285.71"
    )


def test_effective_fee_per_ton_is_none_at_zero_quantity() -> None:
    assert la.effective_fee_per_ton(Decimal("0"), Decimal("0")) is None
    assert la.effective_fee_per_ton(Decimal("100"), Decimal("0")) is None


def test_to_tons_exact() -> None:
    assert la.to_tons(Decimal("573224990")) == Decimal("573224.990000")


def test_share_none_at_zero_total() -> None:
    assert la.share(Decimal("0"), Decimal("0")) is None
    assert la.share(Decimal("1"), Decimal("4")) == Decimal("0.250000")


def test_period_completeness() -> None:
    months = [f"2024-{m:02d}" for m in range(1, 13)] + ["2025-01", "2025-05", "2025-03"]
    assert la.is_complete_year(months, 2024) is True
    assert la.is_complete_year(months, 2025) is False
    assert la.available_through_month(months, 2025) == "2025-05"
    assert la.latest_available_month(months) == "2025-05"
    # 2024 is complete, 2025 is partial → default is the latest complete year.
    assert la.latest_complete_year(months) == 2024


def test_latest_complete_year_falls_back_to_latest_present() -> None:
    # No complete year → fall back to the latest present year rather than nothing.
    assert la.latest_complete_year(["2026-01", "2026-02"]) == 2026
    assert la.latest_complete_year([]) is None
