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
    assert body["policy_version"] == "suitability-policy-v2"
    assert body["critic_method_version"] == "critic-weights-v1"
    assert body["stability_method_version"] == "suitability-stability-v1"
    assert body["statuses"] == ["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"]
    assert "UD801" in body["hard_exclusion_codes"]
    # weight_profiles carries the four *static* policy-assumption profiles only;
    # critic is data-derived and must NOT appear as a fixed policy weight vector.
    assert set(body["weight_profiles"]) == {
        "baseline",
        "equal",
        "equity_focused",
        "access_focused",
    }
    assert "critic" not in body["weight_profiles"]
    assert set(body["static_weight_profiles"]) == set(body["weight_profiles"])
    # critic appears only in the data-derived catalog (method, no fixed weights).
    assert "critic" in body["data_derived_profiles"]
    assert "weights" not in body["data_derived_profiles"]["critic"]
    assert body["supported_profiles"] == [
        "baseline",
        "equal",
        "equity_focused",
        "access_focused",
        "critic",
    ]
    assert body["stability_profiles"] == ["baseline", "equal", "critic"]
    assert body["stability_top_fraction"] == "0.10"
    assert body["default_profile"] == "baseline"
    assert "not legal eligibility" in body["disclaimer"]


def test_critic_profile_unavailable_on_run_without_critic(
    client: TestClient, session: Session
) -> None:
    """An old run whose weight_profiles has no critic returns a structured 4xx for
    every read that requests the critic profile (never a KeyError or fake value)."""
    run = _seed_run(session)  # weight_profiles={} -> no critic
    for path in (
        f"/api/v1/suitability/summary?run_id={run.id}&profile=critic",
        f"/api/v1/suitability/candidates?run_id={run.id}&profile=critic",
        f"/api/v1/suitability/tiles/{run.id}/critic/9/436/201.mvt",
    ):
        resp = client.get(path)
        assert resp.status_code == 400, path
        assert resp.json()["detail"]["error"] == "PROFILE_NOT_AVAILABLE_FOR_RUN", path


def test_bad_stability_class_is_422(client: TestClient) -> None:
    assert client.get("/api/v1/suitability/candidates?stability_class=MAYBE").status_code == 422


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


# --- Vector-tile (MVT) endpoint: validation + 404 paths ----------------------
# These reach the route and its parameter/run validation but never execute the
# PostGIS tile SQL, so they run on the SQLite unit tier. Tile *bytes* (200 + a
# non-empty/empty PBF, cache headers) require PostGIS and live in
# ``test_suitability_routes_integration.py``.


def test_tile_route_matches_and_validates_profile(client: TestClient, session: Session) -> None:
    """A well-formed tile URL with a bad profile returns 422 (route matched,
    profile rejected) — not 404, which would mean the ``.mvt`` route never
    matched at all."""
    run = _seed_run(session)
    assert client.get(f"/api/v1/suitability/tiles/{run.id}/bogus/9/436/201.mvt").status_code == 422


def test_tile_unknown_run_404(client: TestClient) -> None:
    response = client.get("/api/v1/suitability/tiles/987654/baseline/9/436/201.mvt")
    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "RUN_NOT_FOUND"


def test_tile_bad_zoom_is_422(client: TestClient, session: Session) -> None:
    run = _seed_run(session)
    # z above the supported maximum (22) and a negative z both fail validation.
    assert client.get(f"/api/v1/suitability/tiles/{run.id}/baseline/23/0/0.mvt").status_code == 422
    assert client.get(f"/api/v1/suitability/tiles/{run.id}/baseline/-1/0/0.mvt").status_code == 422


def test_tile_out_of_range_xy_is_422(client: TestClient, session: Session) -> None:
    run = _seed_run(session)
    # At zoom 1 there are only 2 tiles per axis (indices 0..1); x=2 is invalid.
    response = client.get(f"/api/v1/suitability/tiles/{run.id}/baseline/1/2/0.mvt")
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "INVALID_TILE_COORDINATE"
    assert client.get(f"/api/v1/suitability/tiles/{run.id}/baseline/1/0/2.mvt").status_code == 422


def test_tile_non_integer_coordinate_is_422(client: TestClient, session: Session) -> None:
    """SQL-injection-style path segments never reach SQL: the int-typed path
    params reject them at the validation boundary."""
    run = _seed_run(session)
    non_int = client.get(f"/api/v1/suitability/tiles/{run.id}/baseline/9/436/abc.mvt")
    assert non_int.status_code == 422
    bad = client.get(f"/api/v1/suitability/tiles/{run.id}/baseline/9/4%3B36/201.mvt")
    assert bad.status_code == 422
