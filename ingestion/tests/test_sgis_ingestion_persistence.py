"""Synthetic persistence tests for SGIS ingestion helpers.

These tests use SQLite for non-spatial provenance tables only. Full geometry
writes are covered by opt-in Docker/PostGIS integration tests.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from waste_equity_backend.models import (
    Base,
    DatasetFreshness,
    DataSource,
    IngestionRun,
    RawApiResponse,
)

from waste_equity_ingestion.errors import IngestionError
from waste_equity_ingestion.sgis_ingestion import (
    RawSgisResponse,
    _get_or_create_raw_response,
    _mark_run_failed,
    _update_freshness,
)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(
        engine,
        tables=[
            DataSource.__table__,
            IngestionRun.__table__,
            DatasetFreshness.__table__,
            RawApiResponse.__table__,
        ],
    )
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as db_session:
        db_session.add(
            DataSource(
                source_id="sgis",
                source_name="SGIS fixture",
                dataset_name="Fixture",
                endpoint="https://example.test",
                publication_frequency="STRUCTURAL",
                enabled=True,
                documentation_url=None,
            )
        )
        db_session.commit()
        yield db_session
    engine.dispose()


def _run(session: Session) -> IngestionRun:
    run = IngestionRun(
        source_id="sgis",
        started_at=datetime.datetime(2026, 7, 8, tzinfo=datetime.UTC),
        status="RUNNING",
        rows_received=0,
        rows_inserted=0,
        rows_updated=0,
        rows_rejected=0,
        reference_period="2024",
        transformation_version="sgis-capital-region-v1",
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def _raw_response() -> RawSgisResponse:
    return RawSgisResponse(
        endpoint_identifier="OpenAPI3/stats/population.json:year=2024:adm_cd=11:low_search=0",
        endpoint="OpenAPI3/stats/population.json",
        request_metadata={"year": "2024", "adm_cd": "11", "low_search": "0"},
        payload={"errCd": 0, "result": [{"adm_cd": "11", "accessToken": "fixture-token"}]},
        retrieved_at=datetime.datetime(2026, 7, 8, tzinfo=datetime.UTC),
        parsed_count=1,
    )


def test_raw_response_is_sanitized_and_deduplicated(session: Session) -> None:
    run = _run(session)

    first, first_inserted = _get_or_create_raw_response(session, _raw_response(), run.run_id)
    second, second_inserted = _get_or_create_raw_response(session, _raw_response(), run.run_id)

    assert first_inserted is True
    assert second_inserted is False
    assert first.id == second.id
    assert first.sanitized_response["payload"]["result"][0]["accessToken"] == "[REDACTED]"


def test_freshness_updates_only_on_success(session: Session) -> None:
    now = datetime.datetime(2026, 7, 8, tzinfo=datetime.UTC)

    _update_freshness(session, year=2024, now=now)
    session.commit()
    freshness = session.get(DatasetFreshness, "sgis")

    assert freshness is not None
    assert freshness.latest_reference_period == "2024"
    assert freshness.freshness_status == "FRESH"


def test_failed_run_does_not_update_freshness(session: Session) -> None:
    run = _run(session)

    _mark_run_failed(session, run.run_id, 2024, IngestionError("fixture failure"))

    failed = session.get(IngestionRun, run.run_id)
    assert failed is not None
    assert failed.status == "FAILED"
    assert session.get(DatasetFreshness, "sgis") is None
