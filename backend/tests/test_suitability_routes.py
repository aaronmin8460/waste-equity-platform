"""Non-spatial suitability route tests (SQLite): policy, 404, and 422 paths.

Data-bearing candidate paths use PostGIS geometry and live in
``test_suitability_routes_integration.py`` (TEST_DATABASE_URL).
"""

from __future__ import annotations

import datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from waste_equity_backend.models import SuitabilityAnalysisRun


def _seed_run(session: Session) -> SuitabilityAnalysisRun:
    now = datetime.datetime(1999, 1, 1, tzinfo=datetime.UTC)
    run = SuitabilityAnalysisRun(
        derivation_version="suitability-screening-v1",
        policy_version="suitability-policy-v1",
        candidate_grid_version="capital-grid-500m-v1",
        reference_year=1999,
        boundary_vintage="1999",
        weight_profile="baseline",
        analysis_signature="unit-test-signature",
        status="SUCCEEDED",
        candidate_count_total=0,
        candidate_count_eligible=0,
        candidate_count_review=0,
        candidate_count_excluded=0,
        input_dataset_version_ids=[1],
        input_provenance={},
        policy_snapshot={},
        weight_profiles={},
        started_at=now,
        completed_at=now,
        created_at=now,
    )
    session.add(run)
    session.commit()
    return run


def test_policies_ok(client: TestClient) -> None:
    response = client.get("/api/v1/suitability/policies")
    assert response.status_code == 200
    body = response.json()
    assert body["policy_version"] == "suitability-policy-v1"
    assert body["statuses"] == ["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"]
    assert "UD801" in body["hard_exclusion_codes"]
    assert set(body["weight_profiles"]) == {
        "baseline",
        "equal",
        "equity_focused",
        "access_focused",
    }
    assert "not legal eligibility" in body["disclaimer"]


def test_runs_empty(client: TestClient) -> None:
    response = client.get("/api/v1/suitability/runs")
    assert response.status_code == 200
    assert response.json() == {"count": 0, "runs": []}


def test_no_run_returns_structured_404(client: TestClient) -> None:
    for path in (
        "/api/v1/suitability/runs/latest",
        "/api/v1/suitability/summary",
        "/api/v1/suitability/candidates",
    ):
        response = client.get(path)
        assert response.status_code == 404, path
        assert response.json()["detail"]["error"] == "NO_ANALYSIS_AVAILABLE"


def test_unknown_run_404(client: TestClient) -> None:
    response = client.get("/api/v1/suitability/summary?run_id=987654")
    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "RUN_NOT_FOUND"


def test_bad_profile_is_422(client: TestClient) -> None:
    assert client.get("/api/v1/suitability/candidates?profile=bogus").status_code == 422


def test_bad_status_is_422(client: TestClient) -> None:
    assert client.get("/api/v1/suitability/candidates?status=MAYBE").status_code == 422


def test_bad_score_bounds_is_422(client: TestClient) -> None:
    assert client.get("/api/v1/suitability/candidates?min_score=250").status_code == 422


def test_bad_bbox_is_422(client: TestClient, session: Session) -> None:
    _seed_run(session)
    response = client.get("/api/v1/suitability/candidates?bbox=1,2,3")
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "INVALID_BBOX"
    response = client.get("/api/v1/suitability/candidates?bbox=10,10,1,1")
    assert response.status_code == 422
