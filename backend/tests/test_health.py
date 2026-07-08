"""Health endpoint behavior."""

from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from waste_equity_backend.api.app import create_app
from waste_equity_backend.db import get_session


def test_health_ok_with_reachable_database(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert "checked_at" in body


def test_health_degraded_when_database_unreachable() -> None:
    # Point the session at a database that does not exist.
    engine = create_engine(
        "postgresql+psycopg://nobody:nobody@127.0.0.1:1/none",
        connect_args={"connect_timeout": 1},
    )
    factory = sessionmaker(bind=engine)
    app = create_app()

    def broken_session() -> Iterator[Session]:
        db_session = factory()
        try:
            yield db_session
        finally:
            db_session.close()

    app.dependency_overrides[get_session] = broken_session
    with TestClient(app) as test_client:
        response = test_client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["database"] == "unavailable"
