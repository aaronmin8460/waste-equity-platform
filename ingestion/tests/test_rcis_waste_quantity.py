"""Quantity, unit, and reconciliation validation tests (synthetic)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_ingestion.errors import SchemaValidationError
from waste_equity_ingestion.rcis_waste_contract import (
    EXPECTED_UNIT,
    RECONCILIATION_TOLERANCE,
    parse_quantity,
    parse_unit,
)


def _result_payload(dunit: str) -> dict[str, object]:
    return {"result": [{"ERR_CODE": "E000", "DUNIT": dunit}]}


def test_unit_extracted_from_dunit_metadata() -> None:
    assert parse_unit(_result_payload("( 단위 : 톤/년 )")) == EXPECTED_UNIT


def test_unit_not_inferred_when_wrong() -> None:
    with pytest.raises(SchemaValidationError):
        parse_unit(_result_payload("( 단위 : 톤/일 )"))


def test_decimal_quantity_is_exact() -> None:
    assert parse_quantity("83761203.273", "WSTE_QTY", "종로구") == Decimal("83761203.273")


def test_blank_quantity_is_none_not_zero() -> None:
    assert parse_quantity("", "WSTE_QTY", "종로구") is None
    assert parse_quantity("EMPTY", "WSTE_QTY", "종로구") is None
    assert parse_quantity(None, "WSTE_QTY", "종로구") is None


def test_zero_quantity_is_decimal_zero_not_none() -> None:
    assert parse_quantity("0", "WSTE_QTY", "종로구") == Decimal("0")
    assert parse_quantity(0, "WSTE_QTY", "종로구") == Decimal("0")


def test_negative_quantity_is_structurally_invalid() -> None:
    with pytest.raises(SchemaValidationError, match="negative"):
        parse_quantity("-1.5", "WSTE_QTY", "종로구")


def test_invalid_numeric_string_is_rejected() -> None:
    with pytest.raises(SchemaValidationError, match="non-numeric"):
        parse_quantity("12,3x4", "WSTE_QTY", "종로구")


def test_reconciliation_tolerance_is_documented_small() -> None:
    # Rounding differences within tolerance are not treated as mismatches.
    assert RECONCILIATION_TOLERANCE == Decimal("1.0")
