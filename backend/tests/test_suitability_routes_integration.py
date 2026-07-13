"""Suitability data-path integration tests against real PostGIS (Phase 5.4).

Runs only when TEST_DATABASE_URL is set. A synthetic run + three candidates are
seeded with remote-ocean geometry inside a rolled-back outer transaction, so the
real analysis data is never touched.
"""

from __future__ import annotations

import datetime
import json
import os
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from geoalchemy2 import WKTElement
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from waste_equity_backend.api.app import create_app
from waste_equity_backend.db import get_session
from waste_equity_backend.models import SuitabilityAnalysisRun, SuitabilityCandidate

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

NOW = datetime.datetime(1999, 1, 1, tzinfo=datetime.UTC)
ALL_PROFILES = ["baseline", "equal", "equity_focused", "access_focused"]


@pytest.fixture
def pg_session() -> Iterator[Session]:
    engine = create_engine(str(TEST_DATABASE_URL))
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
        autoflush=False,
        expire_on_commit=False,
    )
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        engine.dispose()


@pytest.fixture
def pg_client(pg_session: Session) -> Iterator[TestClient]:
    app = create_app()

    def override() -> Iterator[Session]:
        yield pg_session

    app.dependency_overrides[get_session] = override
    with TestClient(app) as test_client:
        yield test_client


def _poly(x: float) -> WKTElement:
    return WKTElement(
        f"MULTIPOLYGON((({x} 20, {x + 0.1} 20, {x + 0.1} 20.1, {x} 20.1, {x} 20)))", srid=4326
    )


def _pt(x: float) -> WKTElement:
    return WKTElement(f"POINT({x + 0.05} 20.05)", srid=4326)


def _candidate(run_id: int, key: str, x: float, **over: Any) -> SuitabilityCandidate:
    base: dict[str, Any] = {
        "analysis_run_id": run_id,
        "candidate_key": key,
        "sido_region_code": "28",
        "sido_region_name": "인천광역시",
        "sigungu_region_code": "28710",
        "sigungu_region_name": "강화군",
        "status": "ELIGIBLE",
        "rank": None,
        "provisional_score": None,
        "total_score": None,
        "zoning_score": None,
        "road_score": None,
        "equity_score": None,
        "demand_score": None,
        "profile_totals": {},
        "profile_ranks": {},
        "raw_components": {},
        "exclusion_reasons": [],
        "review_reasons": [],
        "penalties": [],
        "nearest_road_distance_m": None,
        "nearest_road_provenance": {},
        "component_provenance": {},
        "original_area_m2": Decimal("250000.00"),
        "clipped_area_m2": Decimal("250000.00"),
        "clipped_area_ratio": Decimal("1.00000"),
        "centroid": _pt(x),
        "geometry": _poly(x),
        "created_at": NOW,
    }
    base.update(over)
    return SuitabilityCandidate(**base)


@pytest.fixture
def seeded(pg_session: Session) -> dict[str, int]:
    run = SuitabilityAnalysisRun(
        derivation_version="suitability-screening-v1",
        policy_version="suitability-policy-v1",
        candidate_grid_version="capital-grid-500m-v1",
        reference_year=1999,
        boundary_vintage="1999",
        weight_profile="baseline",
        analysis_signature="integration-test-sig",
        status="SUCCEEDED",
        candidate_count_total=3,
        candidate_count_eligible=1,
        candidate_count_review=1,
        candidate_count_excluded=1,
        input_dataset_version_ids=[1, 2],
        input_provenance={"waste_reference_period": "1999"},
        policy_snapshot={},
        weight_profiles={},
        started_at=NOW,
        completed_at=NOW,
        created_at=NOW,
    )
    pg_session.add(run)
    pg_session.flush()
    profile_totals = {p: "80.0000" if p == "baseline" else "75.0000" for p in ALL_PROFILES}
    profile_ranks = dict.fromkeys(ALL_PROFILES, 1)
    c1 = _candidate(
        run.id,
        "capital-grid-500m-v1:1_1",
        20.0,
        status="ELIGIBLE",
        rank=1,
        total_score=Decimal("80.0000"),
        zoning_score=Decimal("55.0000"),
        road_score=Decimal("100.0000"),
        equity_score=Decimal("100.0000"),
        demand_score=Decimal("50.0000"),
        profile_totals=profile_totals,
        profile_ranks=profile_ranks,
        raw_components={
            "equity": {"accounting_basis": "FACILITY_LOCATION_BASED_THROUGHPUT"},
            "demand": {"accounting_basis": "ORIGIN_BASED_TREATMENT_OUTCOME"},
        },
        nearest_road_distance_m=Decimal("54.544"),
        nearest_road_provenance={"official_layer_code": "STDLINK"},
    )
    c2 = _candidate(
        run.id,
        "capital-grid-500m-v1:2_2",
        20.3,
        status="REVIEW_REQUIRED",
        provisional_score=Decimal("50.0000"),
        zoning_score=Decimal("55.0000"),
        road_score=Decimal("100.0000"),
        equity_score=Decimal("100.0000"),
        profile_totals=dict.fromkeys(ALL_PROFILES, "50.0000"),
        review_reasons=["MISSING_DEMAND_COMPONENT"],
    )
    c3 = _candidate(
        run.id,
        "capital-grid-500m-v1:3_3",
        20.6,
        status="EXCLUDED",
        exclusion_reasons=["PROJECT_SCREENING_EXCLUSION:UD801"],
    )
    pg_session.add_all([c1, c2, c3])
    pg_session.flush()
    return {"run": run.id, "c1": c1.id, "c2": c2.id, "c3": c3.id}


def test_summary(pg_client: TestClient, seeded: dict[str, int]) -> None:
    body = pg_client.get(f"/api/v1/suitability/summary?run_id={seeded['run']}").json()
    assert body["candidate_count_total"] == 3
    assert body["candidate_count_eligible"] == 1
    assert body["candidate_count_review"] == 1
    assert body["candidate_count_excluded"] == 1
    assert body["exclusion_reason_counts"]["PROJECT_SCREENING_EXCLUSION:UD801"] == 1
    assert body["review_reason_counts"]["MISSING_DEMAND_COMPONENT"] == 1
    assert body["top_candidates"][0]["candidate_id"] == seeded["c1"]
    assert body["coverage_notes"] == ["MISSING_DEMAND_COMPONENT: 1"]
    assert "not a legal" in body["disclaimer"].lower()


def test_candidates_geojson_and_bbox(pg_client: TestClient, seeded: dict[str, int]) -> None:
    run = seeded["run"]
    body = pg_client.get(f"/api/v1/suitability/candidates?run_id={run}&bbox=19,19,22,22").json()
    assert body["type"] == "FeatureCollection"
    assert body["total_matched"] == 3
    assert body["features"][0]["geometry"]["type"] == "MultiPolygon"
    # bbox around c1 only
    narrow = pg_client.get(
        f"/api/v1/suitability/candidates?run_id={run}&bbox=19.9,19.9,20.2,20.2"
    ).json()
    assert narrow["total_matched"] == 1
    assert narrow["features"][0]["properties"]["candidate_id"] == seeded["c1"]


def test_candidates_status_and_top_filters(pg_client: TestClient, seeded: dict[str, int]) -> None:
    run = seeded["run"]
    excluded = pg_client.get(f"/api/v1/suitability/candidates?run_id={run}&status=EXCLUDED").json()
    assert excluded["total_matched"] == 1
    props = excluded["features"][0]["properties"]
    assert props["is_excluded"] is True
    assert props["total_score"] is None
    assert props["exclusion_reasons"] == ["PROJECT_SCREENING_EXCLUSION:UD801"]

    top = pg_client.get(f"/api/v1/suitability/candidates?run_id={run}&top=1").json()
    assert top["total_matched"] == 1
    assert top["features"][0]["properties"]["candidate_id"] == seeded["c1"]
    assert top["features"][0]["properties"]["rank"] == 1


def test_candidate_detail_and_profile_switch(pg_client: TestClient, seeded: dict[str, int]) -> None:
    body = pg_client.get(f"/api/v1/suitability/candidates/{seeded['c1']}?profile=baseline").json()
    assert body["status"] == "ELIGIBLE"
    assert body["total_score"] == "80.0000"
    assert body["rank"] == 1
    assert (
        body["raw_components"]["equity"]["accounting_basis"] == "FACILITY_LOCATION_BASED_THROUGHPUT"
    )
    assert body["raw_components"]["demand"]["accounting_basis"] == "ORIGIN_BASED_TREATMENT_OUTCOME"
    assert set(body["profile_totals"]) == set(ALL_PROFILES)
    assert body["geometry"]["type"] == "MultiPolygon"
    # profile switch re-selects the stored per-profile total
    equal = pg_client.get(f"/api/v1/suitability/candidates/{seeded['c1']}?profile=equal").json()
    assert equal["total_score"] == "75.0000"


def test_excluded_detail_has_no_score(pg_client: TestClient, seeded: dict[str, int]) -> None:
    body = pg_client.get(f"/api/v1/suitability/candidates/{seeded['c3']}").json()
    assert body["status"] == "EXCLUDED"
    assert body["is_excluded"] is True
    assert body["total_score"] is None and body["provisional_score"] is None
    assert body["rank"] is None
    assert body["exclusion_reasons"] == ["PROJECT_SCREENING_EXCLUSION:UD801"]


def test_review_detail_has_provisional_no_rank(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    body = pg_client.get(f"/api/v1/suitability/candidates/{seeded['c2']}").json()
    assert body["status"] == "REVIEW_REQUIRED"
    assert body["provisional_score"] == "50.0000"
    assert body["total_score"] is None
    assert body["rank"] is None
    assert "MISSING_DEMAND_COMPONENT" in body["review_reasons"]


def test_no_legal_eligibility_field(pg_client: TestClient, seeded: dict[str, int]) -> None:
    body = pg_client.get(f"/api/v1/suitability/candidates/{seeded['c1']}").json()
    text = json.dumps(body).lower()
    # No legal-eligibility boolean is emitted; "legal" only appears in the disclaimer.
    assert "legally_eligible" not in text
    assert "legal_eligibility" not in text
    assert "not a legal" in body["disclaimer"].lower()


def test_candidate_pagination(pg_client: TestClient, seeded: dict[str, int]) -> None:
    run = seeded["run"]
    page1 = pg_client.get(
        f"/api/v1/suitability/candidates?run_id={run}&bbox=19,19,22,22&limit=1&offset=0"
    ).json()
    page2 = pg_client.get(
        f"/api/v1/suitability/candidates?run_id={run}&bbox=19,19,22,22&limit=1&offset=1"
    ).json()
    assert page1["count"] == 1 and page2["count"] == 1
    assert page1["total_matched"] == 3 and page2["total_matched"] == 3
    assert (
        page1["features"][0]["properties"]["candidate_id"]
        != page2["features"][0]["properties"]["candidate_id"]
    )


def test_unknown_candidate_404(pg_client: TestClient, seeded: dict[str, int]) -> None:
    response = pg_client.get("/api/v1/suitability/candidates/999999999")
    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "CANDIDATE_NOT_FOUND"


def test_top_candidates_distinguish_tied_cells(pg_session: Session, pg_client: TestClient) -> None:
    """Distinct grid cells with legitimately tied scores are each served with a
    distinct id, candidate_key, and centroid, so the UI can tell them apart without
    deduplicating them or altering any score (regression: top candidates looked
    identical). Mirrors run 47's rural 강화군 ties (all 69.25 / Z55 R100 E100 D0)."""
    run = SuitabilityAnalysisRun(
        derivation_version="suitability-screening-v2",
        policy_version="suitability-policy-v1",
        candidate_grid_version="capital-grid-500m-v1",
        reference_year=1999,
        boundary_vintage="1999",
        weight_profile="baseline",
        analysis_signature="tied-cells-sig",
        status="SUCCEEDED",
        candidate_count_total=2,
        candidate_count_eligible=2,
        candidate_count_review=0,
        candidate_count_excluded=0,
        input_dataset_version_ids=[1],
        input_provenance={},
        policy_snapshot={},
        weight_profiles={},
        started_at=NOW,
        completed_at=NOW,
        created_at=NOW,
    )
    pg_session.add(run)
    pg_session.flush()
    tied_totals = dict.fromkeys(ALL_PROFILES, "69.2500")
    tied_scores: dict[str, Any] = {
        "total_score": Decimal("69.2500"),
        "zoning_score": Decimal("55.0000"),
        "road_score": Decimal("100.0000"),
        "equity_score": Decimal("100.0000"),
        "demand_score": Decimal("0.0000"),
        "profile_totals": tied_totals,
    }
    a = _candidate(
        run.id,
        "capital-grid-500m-v1:10_20",
        20.0,
        status="ELIGIBLE",
        rank=1,
        profile_ranks=dict.fromkeys(ALL_PROFILES, 1),
        **tied_scores,
    )
    b = _candidate(
        run.id,
        "capital-grid-500m-v1:11_21",
        20.5,
        status="ELIGIBLE",
        rank=2,
        profile_ranks=dict.fromkeys(ALL_PROFILES, 2),
        **tied_scores,
    )
    pg_session.add_all([a, b])
    pg_session.flush()

    top = pg_client.get(f"/api/v1/suitability/summary?run_id={run.id}").json()["top_candidates"]
    assert len(top) == 2
    # Scores are legitimately tied...
    assert top[0]["total_score"] == top[1]["total_score"] == "69.2500"
    assert top[0]["equity_score"] == top[1]["equity_score"] == "100.0000"
    # ...but every cell is served with a distinct identity and location.
    assert top[0]["candidate_id"] != top[1]["candidate_id"]
    assert top[0]["candidate_key"] != top[1]["candidate_key"]
    coords = [(entry["centroid_lon"], entry["centroid_lat"]) for entry in top]
    assert coords[0] != coords[1]
    for entry in top:
        assert entry["centroid_lon"] is not None
        assert entry["centroid_lat"] is not None
