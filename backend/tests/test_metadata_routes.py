"""Data-operations endpoint behavior."""

import datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from waste_equity_backend.models import DatasetFreshness, DataSource, IngestionRun

UTC = datetime.UTC


def _seed_source(session: Session, source_id: str = "waste_statistics") -> DataSource:
    source = DataSource(
        source_id=source_id,
        source_name="Test Source",
        dataset_name="Test Dataset",
        endpoint="https://example.org/api",
        publication_frequency="ANNUAL",
        enabled=True,
        documentation_url="https://example.org/docs",
    )
    session.add(source)
    session.commit()
    return source


def test_data_sources_empty(client: TestClient) -> None:
    response = client.get("/api/v1/data-sources")
    assert response.status_code == 200
    assert response.json() == []


def test_data_sources_returns_registry(client: TestClient, session: Session) -> None:
    _seed_source(session)
    response = client.get("/api/v1/data-sources")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["source_id"] == "waste_statistics"
    assert body[0]["endpoint"] == "https://example.org/api"


def test_data_freshness_defaults_to_unknown_without_record(
    client: TestClient, session: Session
) -> None:
    _seed_source(session)
    response = client.get("/api/v1/data-freshness")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["freshness_status"] == "UNKNOWN"
    assert body[0]["latest_reference_period"] is None


def test_data_freshness_returns_stored_status(client: TestClient, session: Session) -> None:
    _seed_source(session)
    session.add(
        DatasetFreshness(
            source_id="waste_statistics",
            latest_reference_period="2024",
            last_checked_at=datetime.datetime(2026, 7, 8, 1, 0, tzinfo=UTC),
            last_success_at=datetime.datetime(2026, 7, 8, 1, 0, tzinfo=UTC),
            freshness_status="FRESH",
        )
    )
    session.commit()
    response = client.get("/api/v1/data-freshness")
    body = response.json()
    assert body[0]["freshness_status"] == "FRESH"
    assert body[0]["latest_reference_period"] == "2024"


def test_ingestion_runs_filter_and_order(client: TestClient, session: Session) -> None:
    _seed_source(session, "waste_statistics")
    _seed_source(session, "sgis")
    session.add_all(
        [
            IngestionRun(
                source_id="waste_statistics",
                started_at=datetime.datetime(2026, 7, 8, 1, 0, tzinfo=UTC),
                status="SUCCEEDED",
                rows_received=10,
                rows_inserted=10,
                rows_updated=0,
                rows_rejected=0,
            ),
            IngestionRun(
                source_id="sgis",
                started_at=datetime.datetime(2026, 7, 8, 2, 0, tzinfo=UTC),
                status="FAILED",
                rows_received=0,
                rows_inserted=0,
                rows_updated=0,
                rows_rejected=0,
                error_category="LIVE_FAILED",
                error_message="timeout",
            ),
        ]
    )
    session.commit()

    all_runs = client.get("/api/v1/ingestion-runs").json()
    assert [run["source_id"] for run in all_runs] == ["sgis", "waste_statistics"]

    filtered = client.get("/api/v1/ingestion-runs", params={"source_id": "sgis"}).json()
    assert len(filtered) == 1
    assert filtered[0]["status"] == "FAILED"
    assert filtered[0]["error_category"] == "LIVE_FAILED"


def test_ingestion_runs_limit_bounds(client: TestClient) -> None:
    assert client.get("/api/v1/ingestion-runs", params={"limit": 0}).status_code == 422
    assert client.get("/api/v1/ingestion-runs", params={"limit": 501}).status_code == 422
    assert client.get("/api/v1/ingestion-runs", params={"limit": 500}).status_code == 200
