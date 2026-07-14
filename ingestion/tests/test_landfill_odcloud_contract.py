"""Pure contract tests for the Sudokwon Landfill odcloud parser.

All rows here are synthetic fixtures shaped like the real odcloud JSON; nothing
represents official data.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_ingestion.errors import IngestionError, SchemaValidationError
from waste_equity_ingestion.odcloud_contract import (
    extract_rows,
    join_inbound_and_fees,
    normalize_origin,
    parse_fee_rows,
    parse_inbound_rows,
    parse_reference_month,
    select_latest_snapshot,
)


def _oas(*dated: tuple[str, str]) -> dict:
    """Build a minimal odcloud OAS payload from (uuid, YYYYMMDD summary) pairs."""
    paths = {}
    for uuid, date in dated:
        summary = f"수도권매립지관리공사_통합반입관리_폐기물반입수수료_{date}" if date else ""
        paths[f"/15064394/v1/uddi:{uuid}"] = {"get": {"summary": summary}}
    return {"paths": paths}


def _inbound(month: str, origin: str, waste: str, qty: object) -> dict:
    return {"마감년월": month, "소재지": origin, "폐기물명": waste, "반입량": qty}


def _fee(month: str, origin: str, waste: str, fee: object) -> dict:
    return {"마감년월": month, "광역지자체명": origin, "폐기물명": waste, "반입수수료": fee}


# --- snapshot discovery -------------------------------------------------------


def test_select_latest_snapshot_picks_max_date() -> None:
    oas = _oas(
        ("11111111-1111-1111-1111-111111111111", "20240111"),
        ("22222222-2222-2222-2222-222222222222", "20260531"),
        ("33333333-3333-3333-3333-333333333333", "20250627"),
    )
    snap = select_latest_snapshot(oas, "15064394")
    assert snap.snapshot_uuid == "22222222-2222-2222-2222-222222222222"
    assert snap.publication_date == "2026-05-31"
    assert snap.path_segment == "uddi:22222222-2222-2222-2222-222222222222"


def test_select_latest_snapshot_falls_back_to_last_when_undated() -> None:
    oas = _oas(
        ("11111111-1111-1111-1111-111111111111", ""),
        ("99999999-9999-9999-9999-999999999999", ""),
    )
    snap = select_latest_snapshot(oas, "15064394")
    assert snap.snapshot_uuid == "99999999-9999-9999-9999-999999999999"


def test_select_latest_snapshot_no_paths_fails() -> None:
    with pytest.raises(IngestionError):
        select_latest_snapshot({"paths": {}}, "15064394")


# --- origin normalization -----------------------------------------------------


@pytest.mark.parametrize(
    ("name", "code"),
    [("서울시", "KR-SGIS-11"), ("인천시", "KR-SGIS-28"), ("경기도", "KR-SGIS-41")],
)
def test_normalize_origin_supported(name: str, code: str) -> None:
    assert normalize_origin(name) == (code, name)


def test_normalize_origin_rejects_submetropolitan() -> None:
    # A city/district value must never be accepted (metropolitan-only).
    with pytest.raises(IngestionError):
        normalize_origin("수원시")


def test_normalize_origin_rejects_empty() -> None:
    with pytest.raises(SchemaValidationError):
        normalize_origin("")


def test_parse_reference_month() -> None:
    assert parse_reference_month("2025-08") == ("2025-08", 2025)
    with pytest.raises(SchemaValidationError):
        parse_reference_month("2025/08")
    with pytest.raises(SchemaValidationError):
        parse_reference_month("2025-13")


# --- row validation -----------------------------------------------------------


def test_parse_inbound_rows_ok() -> None:
    rows = [
        _inbound("2025-01", "서울시", "생활", 1000),
        _inbound("2025-01", "경기도", "생활", 2000),
    ]
    records = parse_inbound_rows(rows)
    assert [r.quantity_kg for r in records] == [Decimal("1000"), Decimal("2000")]
    assert records[0].origin_region_code == "KR-SGIS-11"
    assert records[0].reference_year == 2025


def test_parse_inbound_rejects_missing_field() -> None:
    with pytest.raises(SchemaValidationError):
        parse_inbound_rows([{"마감년월": "2025-01", "소재지": "서울시", "폐기물명": "생활"}])


def test_parse_inbound_rejects_negative_quantity() -> None:
    with pytest.raises(SchemaValidationError):
        parse_inbound_rows([_inbound("2025-01", "서울시", "생활", -5)])


def test_parse_inbound_rejects_null_quantity() -> None:
    with pytest.raises(SchemaValidationError):
        parse_inbound_rows([_inbound("2025-01", "서울시", "생활", None)])


def test_parse_inbound_rejects_duplicate_key() -> None:
    with pytest.raises(IngestionError):
        parse_inbound_rows(
            [_inbound("2025-01", "서울시", "생활", 1), _inbound("2025-01", "서울시", "생활", 2)]
        )


def test_extract_rows_flags_error_body() -> None:
    with pytest.raises(IngestionError):
        extract_rows({"code": -4, "msg": "등록되지 않은 인증키"})
    with pytest.raises(SchemaValidationError):
        extract_rows({"page": 1})


# --- 1:1 join -----------------------------------------------------------------


def test_join_exact_one_to_one() -> None:
    inbound = parse_inbound_rows(
        [_inbound("2025-01", "서울시", "생활", 1000), _inbound("2025-01", "경기도", "생활", 2000)]
    )
    fees = parse_fee_rows(
        [_fee("2025-01", "서울시", "생활", 50000), _fee("2025-01", "경기도", "생활", 90000)]
    )
    joined, report = join_inbound_and_fees(inbound, fees)
    assert report.joined == 2
    assert report.inbound_only_keys == [] and report.fee_only_keys == []
    seoul = next(r for r in joined if r.origin_region_code == "KR-SGIS-11")
    assert seoul.quantity_kg == Decimal("1000")
    assert seoul.inbound_fee_krw == Decimal("50000")


def test_join_reports_inbound_only_and_fee_only() -> None:
    inbound = parse_inbound_rows([_inbound("2025-01", "서울시", "생활", 1000)])
    fees = parse_fee_rows([_fee("2025-01", "경기도", "생활", 90000)])
    joined, report = join_inbound_and_fees(inbound, fees)
    assert report.joined == 0
    assert len(report.inbound_only_keys) == 1
    assert len(report.fee_only_keys) == 1
