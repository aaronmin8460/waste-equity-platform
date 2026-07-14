"""Synthetic SQLite persistence tests for landfill-inbound ingestion.

SQLite backs the non-spatial provenance and fact tables. HTTP is not called:
snapshot discovery and page fetching are monkeypatched with deterministic
fixtures. All values are synthetic; nothing here represents official data.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterator
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from waste_equity_backend.models import (
    Base,
    DatasetFreshness,
    DataSource,
    IngestionRun,
    LandfillInboundMonthly,
    RawApiResponse,
)

from waste_equity_ingestion import landfill_inbound as li
from waste_equity_ingestion.config import ProbeSettings
from waste_equity_ingestion.errors import IngestionError
from waste_equity_ingestion.odcloud_contract import (
    FEE_DATASET_ID,
    INBOUND_DATASET_ID,
    LandfillInboundJoined,
    SnapshotRef,
)

NOW = datetime.datetime(2026, 7, 14, tzinfo=datetime.UTC)

_INBOUND_SNAP = SnapshotRef(
    dataset_id=INBOUND_DATASET_ID,
    snapshot_uuid="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    path=f"/{INBOUND_DATASET_ID}/v1/uddi:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    publication_date="2026-05-31",
    summary="fixture",
)
_FEE_SNAP = SnapshotRef(
    dataset_id=FEE_DATASET_ID,
    snapshot_uuid="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    path=f"/{FEE_DATASET_ID}/v1/uddi:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    publication_date="2026-05-31",
    summary="fixture",
)


def _inbound(month: str, origin: str, waste: str, qty: int) -> dict:
    return {"마감년월": month, "소재지": origin, "폐기물명": waste, "반입량": qty}


def _fee(month: str, origin: str, waste: str, fee: int) -> dict:
    return {"마감년월": month, "광역지자체명": origin, "폐기물명": waste, "반입수수료": fee}


def _joined(waste: str = "생활", qty: str = "1000", fee: str = "50000") -> LandfillInboundJoined:
    return LandfillInboundJoined(
        reference_month="2025-01",
        reference_year=2025,
        origin_source_name="서울시",
        origin_region_code="KR-SGIS-11",
        waste_name=waste,
        quantity_kg=Decimal(qty),
        inbound_fee_krw=Decimal(fee),
    )


@pytest.fixture
def session_factory() -> Iterator[sessionmaker[Session]]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            DataSource.__table__,
            IngestionRun.__table__,
            DatasetFreshness.__table__,
            RawApiResponse.__table__,
            LandfillInboundMonthly.__table__,
        ],
    )
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as seed:
        for source_id in (INBOUND_DATASET_ID, FEE_DATASET_ID):
            seed.add(
                DataSource(
                    source_id=source_id,
                    source_name="Sudokwon fixture",
                    dataset_name="fixture",
                    endpoint="https://example.test",
                    publication_frequency="MONTHLY",
                    enabled=True,
                    documentation_url=None,
                )
            )
        seed.commit()
    yield factory
    engine.dispose()


@pytest.fixture
def session(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    with session_factory() as db_session:
        yield db_session


def _new_run(session: Session) -> IngestionRun:
    run = IngestionRun(
        source_id=INBOUND_DATASET_ID,
        started_at=NOW,
        status="RUNNING",
        rows_received=0,
        rows_inserted=0,
        rows_updated=0,
        rows_rejected=0,
        reference_period="2025-01",
        transformation_version="landfill-inbound-v1",
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def test_upsert_is_idempotent_and_detects_change(session: Session) -> None:
    run = _new_run(session)
    created, changed = li._upsert_landfill_row(
        session,
        joined=_joined(),
        inbound_snapshot=_INBOUND_SNAP,
        fee_snapshot=_FEE_SNAP,
        quantity_raw_response_id=None,
        fee_raw_response_id=None,
        run_id=run.run_id,
        now=NOW,
    )
    session.commit()
    assert (created, changed) == (True, True)

    # Second identical upsert: no change.
    created, changed = li._upsert_landfill_row(
        session,
        joined=_joined(),
        inbound_snapshot=_INBOUND_SNAP,
        fee_snapshot=_FEE_SNAP,
        quantity_raw_response_id=None,
        fee_raw_response_id=None,
        run_id=run.run_id,
        now=NOW,
    )
    session.commit()
    assert (created, changed) == (False, False)

    # Changed fee: update detected.
    created, changed = li._upsert_landfill_row(
        session,
        joined=_joined(fee="60000"),
        inbound_snapshot=_INBOUND_SNAP,
        fee_snapshot=_FEE_SNAP,
        quantity_raw_response_id=None,
        fee_raw_response_id=None,
        run_id=run.run_id,
        now=NOW,
    )
    session.commit()
    assert (created, changed) == (False, True)

    row = session.scalar(select(LandfillInboundMonthly))
    assert row is not None
    assert row.inbound_fee_krw == Decimal("60000")
    assert row.destination_code == "SUDOKWON_LANDFILL"
    assert row.accounting_basis == "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW"
    assert row.quantity_evidence_status == "OFFICIAL_REPORTED_VALUE"
    assert session.scalar(select(func.count()).select_from(LandfillInboundMonthly)) == 1


def test_raw_response_dedup(session: Session) -> None:
    run = _new_run(session)
    rows = [_inbound("2025-01", "서울시", "생활", 1000)]
    first = li._get_or_create_raw_response(
        session,
        dataset_id=INBOUND_DATASET_ID,
        snapshot=_INBOUND_SNAP,
        rows=rows,
        request_metadata={"total_count": 1},
        run_id=run.run_id,
        now=NOW,
    )
    session.commit()
    second = li._get_or_create_raw_response(
        session,
        dataset_id=INBOUND_DATASET_ID,
        snapshot=_INBOUND_SNAP,
        rows=rows,
        request_metadata={"total_count": 1},
        run_id=run.run_id,
        now=NOW,
    )
    session.commit()
    assert first == second
    assert session.scalar(select(func.count()).select_from(RawApiResponse)) == 1


def _patch_fetch(monkeypatch: pytest.MonkeyPatch, inbound: list[dict], fees: list[dict]) -> None:
    monkeypatch.setattr(
        li, "discover_snapshot", lambda ds: _INBOUND_SNAP if ds == INBOUND_DATASET_ID else _FEE_SNAP
    )

    def fake_fetch(settings: ProbeSettings, snapshot: SnapshotRef) -> tuple[list[dict], dict]:
        data = inbound if snapshot.dataset_id == INBOUND_DATASET_ID else fees
        return data, {"total_count": len(data)}

    monkeypatch.setattr(li, "fetch_all_rows", fake_fetch)


def test_run_write_then_idempotent(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    inbound = [
        _inbound("2025-01", "서울시", "생활", 1000),
        _inbound("2025-01", "경기도", "생활", 2000),
    ]
    fees = [
        _fee("2025-01", "서울시", "생활", 50000),
        _fee("2025-01", "경기도", "생활", 90000),
    ]
    _patch_fetch(monkeypatch, inbound, fees)
    monkeypatch.setattr(li, "get_sessionmaker", lambda: session_factory)
    settings = ProbeSettings.from_env()

    report = li.run_landfill_inbound(settings, scope="capital-region", write=True)
    assert report.status == "SUCCEEDED"
    assert report.joined_rows == 2
    assert report.rows_inserted == 2 and report.rows_unchanged == 0
    with session_factory() as check:
        assert check.scalar(select(func.count()).select_from(LandfillInboundMonthly)) == 2

    # Repeated apply → no new rows, all unchanged.
    report2 = li.run_landfill_inbound(settings, scope="capital-region", write=True)
    assert report2.rows_inserted == 0 and report2.rows_unchanged == 2
    with session_factory() as check:
        assert check.scalar(select(func.count()).select_from(LandfillInboundMonthly)) == 2
        assert check.scalar(select(func.count()).select_from(RawApiResponse)) == 2


def test_dry_run_writes_nothing(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    inbound = [_inbound("2025-01", "서울시", "생활", 1000)]
    fees = [_fee("2025-01", "서울시", "생활", 50000)]
    _patch_fetch(monkeypatch, inbound, fees)
    monkeypatch.setattr(li, "get_sessionmaker", lambda: session_factory)
    settings = ProbeSettings.from_env()

    report = li.run_landfill_inbound(settings, scope="capital-region", write=False)
    assert report.status == "VALIDATED"
    assert report.joined_rows == 1
    with session_factory() as check:
        assert check.scalar(select(func.count()).select_from(LandfillInboundMonthly)) == 0
        assert check.scalar(select(func.count()).select_from(IngestionRun)) == 0


def test_run_rejects_non_one_to_one(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    inbound = [_inbound("2025-01", "서울시", "생활", 1000)]
    fees = [_fee("2025-01", "경기도", "생활", 90000)]  # different key → fee-only + inbound-only
    _patch_fetch(monkeypatch, inbound, fees)
    monkeypatch.setattr(li, "get_sessionmaker", lambda: session_factory)
    settings = ProbeSettings.from_env()

    with pytest.raises(IngestionError):
        li.run_landfill_inbound(settings, scope="capital-region", write=False)


def test_run_rejects_unsupported_origin(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    inbound = [_inbound("2025-01", "수원시", "생활", 1000)]  # sub-metropolitan → rejected
    fees = [_fee("2025-01", "수원시", "생활", 50000)]
    _patch_fetch(monkeypatch, inbound, fees)
    monkeypatch.setattr(li, "get_sessionmaker", lambda: session_factory)
    settings = ProbeSettings.from_env()

    with pytest.raises(IngestionError):
        li.run_landfill_inbound(settings, scope="capital-region", write=False)
