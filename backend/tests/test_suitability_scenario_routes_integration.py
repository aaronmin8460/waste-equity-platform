"""User-weight scenario API integration tests against real PostGIS (Phase 6).

Runs only when TEST_DATABASE_URL is set. Seeds a synthetic run + candidates in a
rolled-back outer transaction (remote-ocean geometry), so no real analysis data is
touched. Verifies preview ranking/scoring/rank-deltas, candidate scenario detail
(eligible/review/excluded/mismatch/missing), custom MVT scoring + hash gating +
cache/ETag semantics, cross-path scoring consistency, and that stored profiles /
migration head are unchanged.
"""

from __future__ import annotations

import datetime
import math
import os
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from geoalchemy2 import WKTElement
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from waste_equity_backend.analysis.suitability import scenario
from waste_equity_backend.api.app import create_app
from waste_equity_backend.db import get_session
from waste_equity_backend.models import SuitabilityAnalysisRun, SuitabilityCandidate

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

NOW = datetime.datetime(1999, 1, 1, tzinfo=datetime.UTC)
STATIC_PROFILES = ["baseline", "equal", "equity_focused", "access_focused"]
ALL_PROFILES = [*STATIC_PROFILES, "critic"]
CRITIC_WEIGHTS = {
    "zoning": "0.30000000",
    "road": "0.20000000",
    "equity": "0.35000000",
    "demand": "0.15000000",
}
RUN_WEIGHT_PROFILES = {
    "baseline": {"zoning": "0.35", "road": "0.25", "equity": "0.25", "demand": "0.15"},
    "equal": {"zoning": "0.25", "road": "0.25", "equity": "0.25", "demand": "0.25"},
    "equity_focused": {"zoning": "0.30", "road": "0.15", "equity": "0.40", "demand": "0.15"},
    "access_focused": {"zoning": "0.25", "road": "0.40", "equity": "0.20", "demand": "0.15"},
    "critic": CRITIC_WEIGHTS,
}
BASELINE_BODY = {
    "zoning": "0.35000000",
    "road": "0.25000000",
    "equity": "0.25000000",
    "demand": "0.15000000",
}
EQUAL_BODY = {c: "0.25000000" for c in ("zoning", "road", "equity", "demand")}


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


def _eligible(
    run_id: int, key: str, x: float, z: str, r: str, e: str, d: str, **over: Any
) -> SuitabilityCandidate:
    return _candidate(
        run_id,
        key,
        x,
        status="ELIGIBLE",
        rank=over.pop("rank", 1),
        total_score=Decimal("0"),
        zoning_score=Decimal(z),
        road_score=Decimal(r),
        equity_score=Decimal(e),
        demand_score=Decimal(d),
        profile_totals=over.pop("profile_totals", dict.fromkeys(ALL_PROFILES, "0")),
        profile_ranks=over.pop("profile_ranks", dict.fromkeys(ALL_PROFILES, 1)),
        **over,
    )


def _make_run(pg_session: Session, **over: Any) -> int:
    run = SuitabilityAnalysisRun(
        derivation_version=over.pop("derivation_version", "suitability-screening-v3"),
        policy_version=over.pop("policy_version", "suitability-policy-v2"),
        candidate_grid_version="capital-grid-500m-v1",
        reference_year=1999,
        boundary_vintage="1999",
        weight_profile="baseline",
        analysis_signature=over.pop("sig", "scenario-int-sig"),
        status="SUCCEEDED",
        candidate_count_total=over.pop("total", 3),
        candidate_count_eligible=over.pop("eligible", 3),
        candidate_count_review=over.pop("review", 0),
        candidate_count_excluded=over.pop("excluded", 0),
        input_dataset_version_ids=[1, 2],
        input_provenance={},
        policy_snapshot={},
        weight_profiles=over.pop("weight_profiles", RUN_WEIGHT_PROFILES),
        weight_derivation={},
        stability_definition={},
        started_at=NOW,
        completed_at=NOW,
        created_at=NOW,
        **over,
    )
    pg_session.add(run)
    pg_session.flush()
    return run.id


@pytest.fixture
def seeded(pg_session: Session) -> dict[str, Any]:
    """Three ELIGIBLE (with a tie), one REVIEW (missing demand), one EXCLUDED."""
    run_id = _make_run(pg_session, total=5, eligible=3, review=1, excluded=1)
    # Under EQUAL weights: A=(55+100+100+50)/4=76.25, B=(60+40+90+80)/4=67.5,
    # C same components as B → tie 67.5 (candidate_key tie-break C after B).
    a = _eligible(
        run_id,
        "capital-grid-500m-v1:1_1",
        20.0,
        "55",
        "100",
        "100",
        "50",
        rank=1,
        profile_ranks={**dict.fromkeys(ALL_PROFILES, 1)},
        profile_totals={**dict.fromkeys(ALL_PROFILES, "80.0000")},
        stable_count=3,
        stability_class="STABLE",
        stability_membership={"baseline": True, "equal": True, "critic": True},
    )
    b = _eligible(
        run_id,
        "capital-grid-500m-v1:2_2",
        20.3,
        "60",
        "40",
        "90",
        "80",
        rank=2,
        profile_ranks={**dict.fromkeys(ALL_PROFILES, 2)},
        profile_totals={**dict.fromkeys(ALL_PROFILES, "70.0000")},
        stable_count=2,
        stability_class="CONDITIONALLY_STABLE",
    )
    c = _eligible(
        run_id,
        "capital-grid-500m-v1:3_3",
        20.6,
        "60",
        "40",
        "90",
        "80",
        rank=3,
        profile_ranks={**dict.fromkeys(ALL_PROFILES, 3)},
        profile_totals={**dict.fromkeys(ALL_PROFILES, "69.0000")},
        stable_count=0,
        stability_class="WEIGHT_SENSITIVE",
    )
    review = _candidate(
        run_id,
        "capital-grid-500m-v1:4_4",
        20.9,
        status="REVIEW_REQUIRED",
        zoning_score=Decimal("55"),
        road_score=Decimal("100"),
        equity_score=Decimal("100"),
        review_reasons=["MISSING_DEMAND_COMPONENT"],
        profile_totals=dict.fromkeys(ALL_PROFILES, "50.0000"),
    )
    excluded = _candidate(
        run_id,
        "capital-grid-500m-v1:5_5",
        21.2,
        status="EXCLUDED",
        exclusion_reasons=["PROJECT_SCREENING_EXCLUSION:UD801"],
    )
    pg_session.add_all([a, b, c, review, excluded])
    pg_session.flush()
    return {
        "run": run_id,
        "a": a.id,
        "b": b.id,
        "c": c.id,
        "review": review.id,
        "excluded": excluded.id,
    }


@pytest.fixture
def seeded_old(pg_session: Session) -> dict[str, int]:
    run_id = _make_run(
        pg_session,
        sig="scenario-int-old",
        total=1,
        eligible=1,
        weight_profiles={p: RUN_WEIGHT_PROFILES[p] for p in STATIC_PROFILES},
        derivation_version="suitability-screening-v2",
        policy_version="suitability-policy-v1",
    )
    a = _eligible(
        run_id,
        "capital-grid-500m-v1:9_9",
        22.0,
        "55",
        "100",
        "100",
        "50",
        profile_totals={p: "80.0000" for p in STATIC_PROFILES},
        profile_ranks=dict.fromkeys(STATIC_PROFILES, 1),
    )
    pg_session.add(a)
    pg_session.flush()
    return {"run": run_id, "a": a.id}


def _preview(client: TestClient, run: int, weights: dict[str, str], **body: Any) -> Any:
    payload = {"run_id": run, "weights": weights, **body}
    return client.post("/api/v1/suitability/scenarios/preview", json=payload)


# --- preview -----------------------------------------------------------------


def test_preview_latest_run_resolution(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    resp = pg_client.post("/api/v1/suitability/scenarios/preview", json={"weights": EQUAL_BODY})
    assert resp.status_code == 200
    body = resp.json()
    assert body["run_id"] == seeded["run"]  # only succeeded run present
    assert body["method_version"] == "user-weight-scenario-v1"


def test_preview_explicit_run_and_ranking(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    body = _preview(pg_client, seeded["run"], EQUAL_BODY, compare_profile="equal", top_n=10).json()
    assert body["ranking_population"] == 3
    top = body["top_candidates"]
    assert [t["custom_rank"] for t in top] == [1, 2, 3]
    # A wins under equal weights; B and C tie at 67.5 → candidate_key tie-break (B before C)
    assert top[0]["candidate_id"] == seeded["a"]
    assert top[0]["custom_score"] == "76.2500"
    assert top[1]["candidate_id"] == seeded["b"]
    assert top[2]["candidate_id"] == seeded["c"]
    assert top[1]["custom_score"] == top[2]["custom_score"] == "67.5000"
    # exact decimal strings + canonical weights echoed
    assert body["canonical_weights"] == EQUAL_BODY


def test_preview_complete_population_before_limit(
    pg_client: TestClient, seeded: dict[str, Any]
) -> None:
    body = _preview(pg_client, seeded["run"], EQUAL_BODY, top_n=1).json()
    # only one row returned, but the ranking covered the full ELIGIBLE population
    assert len(body["top_candidates"]) == 1
    assert body["ranking_population"] == 3
    assert body["top_candidates"][0]["custom_rank"] == 1


def test_preview_rank_delta_direction(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    # Weight road=1: A road=100 → rank 1; B/C road=40 tie. Compare vs baseline ranks
    # (A=1,B=2,C=3). rank_delta = comparison_rank - custom_rank.
    body = _preview(
        pg_client,
        seeded["run"],
        {"zoning": "0", "road": "1", "equity": "0", "demand": "0"},
        compare_profile="baseline",
    ).json()
    by_id = {t["candidate_id"]: t for t in body["top_candidates"]}
    a = by_id[seeded["a"]]
    assert a["custom_rank"] == 1 and a["comparison_rank"] == 1
    assert a["rank_delta"] == 0 and a["rank_change_direction"] == "same"


def test_preview_stable_metadata_retained(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    body = _preview(pg_client, seeded["run"], EQUAL_BODY).json()
    a = body["top_candidates"][0]
    assert a["stable_count"] == 3
    assert a["stability_class"] == "STABLE"


def test_preview_invalid_run(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    resp = _preview(pg_client, 99999999, EQUAL_BODY)
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "RUN_NOT_FOUND"


def test_preview_invalid_weights(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    resp = _preview(
        pg_client,
        seeded["run"],
        {"zoning": "0.5", "road": "0.5", "equity": "0.5", "demand": "0.5"},
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["error"] == "INVALID_SCENARIO_WEIGHTS"
    assert detail["fields"]["sum"] == "2.00000000"


def test_preview_critic_unavailable_on_old_run(
    pg_client: TestClient, seeded_old: dict[str, int]
) -> None:
    resp = _preview(pg_client, seeded_old["run"], EQUAL_BODY, compare_profile="critic")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "PROFILE_NOT_AVAILABLE_FOR_RUN"


def test_preview_top_n_bounds(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    assert _preview(pg_client, seeded["run"], EQUAL_BODY, top_n=0).status_code == 422
    assert _preview(pg_client, seeded["run"], EQUAL_BODY, top_n=51).status_code == 422
    assert _preview(pg_client, seeded["run"], EQUAL_BODY, top_n=50).status_code == 200


def test_preview_is_deterministic_and_no_write(
    pg_client: TestClient, seeded: dict[str, Any], pg_session: Session
) -> None:
    before = pg_session.execute(
        text("SELECT count(*) FROM suitability_candidates WHERE analysis_run_id = :r"),
        {"r": seeded["run"]},
    ).scalar_one()
    a = _preview(pg_client, seeded["run"], EQUAL_BODY).json()
    b = _preview(pg_client, seeded["run"], EQUAL_BODY).json()
    assert a == b  # no timestamp fields → identical analytical response
    after = pg_session.execute(
        text("SELECT count(*) FROM suitability_candidates WHERE analysis_run_id = :r"),
        {"r": seeded["run"]},
    ).scalar_one()
    assert before == after  # nothing written


def test_preview_selected_candidate(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    body = _preview(pg_client, seeded["run"], EQUAL_BODY, selected_candidate_id=seeded["a"]).json()
    sel = body["selected_candidate"]
    assert sel is not None
    assert sel["candidate_id"] == seeded["a"]
    assert sel["custom_rank"] == 1
    assert sel["custom_score"] == "76.2500"


# --- candidate scenario detail -----------------------------------------------


def _detail(client: TestClient, run: int, cid: int, weights: dict[str, str], **body: Any) -> Any:
    return client.post(
        f"/api/v1/suitability/scenarios/candidates/{cid}",
        json={"run_id": run, "weights": weights, **body},
    )


def test_detail_eligible_with_contributions(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    body = _detail(pg_client, seeded["run"], seeded["a"], EQUAL_BODY).json()
    assert body["status"] == "ELIGIBLE"
    assert body["custom_score"] == "76.2500"
    assert body["custom_rank"] == 1
    contrib = {c["component"]: c for c in body["contributions"]}
    # 55*0.25, 100*0.25, 100*0.25, 50*0.25
    assert contrib["zoning"]["weighted_contribution"] == "13.7500"
    assert contrib["road"]["weighted_contribution"] == "25.0000"
    assert contrib["demand"]["weighted_contribution"] == "12.5000"
    total = sum(Decimal(c["weighted_contribution"]) for c in body["contributions"])
    assert total == Decimal("76.2500")
    # stored stability + provenance preserved
    assert body["stable_count"] == 3
    assert body["scenario_disclaimer"].startswith("사용자가 입력한")


def test_detail_review_provisional_and_no_rank(
    pg_client: TestClient, seeded: dict[str, Any]
) -> None:
    body = _detail(pg_client, seeded["run"], seeded["review"], EQUAL_BODY).json()
    assert body["status"] == "REVIEW_REQUIRED"
    assert body["custom_score"] is None
    assert body["custom_rank"] is None
    # (55+100+100)/3 = 85 (demand missing, renormalized, never zero-filled)
    assert body["custom_provisional_score"] == "85.0000"


def test_detail_review_provisional_unavailable(
    pg_client: TestClient, seeded: dict[str, Any]
) -> None:
    # weights put ALL present components (zoning/road/equity) at 0 → denom 0 → unavailable
    body = _detail(
        pg_client,
        seeded["run"],
        seeded["review"],
        {"zoning": "0", "road": "0", "equity": "0", "demand": "1"},
    ).json()
    assert body["status"] == "REVIEW_REQUIRED"
    assert body["custom_provisional_score"] is None
    assert body["custom_score"] is None


def test_detail_excluded_no_scores(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    body = _detail(pg_client, seeded["run"], seeded["excluded"], EQUAL_BODY).json()
    assert body["status"] == "EXCLUDED"
    assert body["is_excluded"] is True
    assert body["custom_score"] is None
    assert body["custom_provisional_score"] is None
    assert body["custom_rank"] is None
    assert body["exclusion_reasons"] == ["PROJECT_SCREENING_EXCLUSION:UD801"]


def test_detail_candidate_run_mismatch(
    pg_client: TestClient, seeded: dict[str, Any], seeded_old: dict[str, int]
) -> None:
    resp = _detail(pg_client, seeded["run"], seeded_old["a"], EQUAL_BODY)
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "CANDIDATE_RUN_MISMATCH"


def test_detail_missing_candidate(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    resp = _detail(pg_client, seeded["run"], 88888888, EQUAL_BODY)
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "CANDIDATE_NOT_FOUND"


def test_detail_rank_matches_preview(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    """Candidate-detail custom_rank equals the preview row_number for the same candidate."""
    preview = _preview(pg_client, seeded["run"], EQUAL_BODY, top_n=50).json()
    ranks = {t["candidate_id"]: t["custom_rank"] for t in preview["top_candidates"]}
    for cid in (seeded["a"], seeded["b"], seeded["c"]):
        detail = _detail(pg_client, seeded["run"], cid, EQUAL_BODY).json()
        assert detail["custom_rank"] == ranks[cid], cid


# --- custom MVT --------------------------------------------------------------

MVT_CONTENT_TYPE = "application/vnd.mapbox-vector-tile"


def _deg2tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


_CLUSTER_LON, _CLUSTER_LAT = 20.6, 20.05


def _tile_url(run: int, weights: dict[str, str], z: int, x: int, y: int, scenario_hash: str) -> str:
    return (
        f"/api/v1/suitability/scenarios/tiles/{run}/{z}/{x}/{y}.mvt"
        f"?wz={weights['zoning']}&wr={weights['road']}"
        f"&we={weights['equity']}&wd={weights['demand']}&scenario_hash={scenario_hash}"
    )


def _hash_for(run: int, body: dict[str, str]) -> str:
    return scenario.scenario_hash(run, scenario.parse_and_validate_weights(body))


def test_tile_valid_nonempty_with_cache_and_etag(
    pg_client: TestClient, seeded: dict[str, Any]
) -> None:
    z = 3
    x, y = _deg2tile(_CLUSTER_LON, _CLUSTER_LAT, z)
    h = _hash_for(seeded["run"], EQUAL_BODY)
    resp = pg_client.get(_tile_url(seeded["run"], EQUAL_BODY, z, x, y, h))
    assert resp.status_code == 200
    assert resp.headers["content-type"] == MVT_CONTENT_TYPE
    assert resp.headers["cache-control"] == "public, max-age=86400, immutable"
    assert resp.headers["etag"]
    assert len(resp.content) > 0


def test_tile_empty_outside_area(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    z = 3
    x, y = _deg2tile(-120.0, 10.0, z)
    h = _hash_for(seeded["run"], EQUAL_BODY)
    resp = pg_client.get(_tile_url(seeded["run"], EQUAL_BODY, z, x, y, h))
    assert resp.status_code == 200
    assert resp.content == b""


def test_tile_etag_deterministic_and_304(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    z = 3
    x, y = _deg2tile(_CLUSTER_LON, _CLUSTER_LAT, z)
    h = _hash_for(seeded["run"], EQUAL_BODY)
    url = _tile_url(seeded["run"], EQUAL_BODY, z, x, y, h)
    first = pg_client.get(url)
    etag = first.headers["etag"]
    assert pg_client.get(url).headers["etag"] == etag  # deterministic
    second = pg_client.get(url, headers={"If-None-Match": etag})
    assert second.status_code == 304


def test_tile_scores_and_status_properties(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    mvt = pytest.importorskip("mapbox_vector_tile")
    z = 3
    x, y = _deg2tile(20.35, 20.05, z)  # broad tile enveloping the cluster
    h = _hash_for(seeded["run"], EQUAL_BODY)
    resp = pg_client.get(_tile_url(seeded["run"], EQUAL_BODY, z, x, y, h))
    decoded = mvt.decode(resp.content)
    assert "candidates" in decoded
    by_status: dict[str, Any] = {}
    for f in decoded["candidates"]["features"]:
        by_status.setdefault(f["properties"]["status"], f["properties"])
    assert {"ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"} <= set(by_status)
    # ELIGIBLE carries the recomputed custom score; review carries provisional; excluded neither
    assert "score" in by_status["ELIGIBLE"]
    assert "provisional_score" not in by_status["ELIGIBLE"]
    assert by_status["REVIEW_REQUIRED"]["provisional_score"] == 85.0
    assert "score" not in by_status["REVIEW_REQUIRED"]
    assert "score" not in by_status["EXCLUDED"]
    assert "provisional_score" not in by_status["EXCLUDED"]
    # stability preserved from the stored run; no global rank in the tile
    assert by_status["ELIGIBLE"]["stable_count"] in (0, 2, 3)
    assert "rank" not in by_status["ELIGIBLE"]
    assert "custom_rank" not in by_status["ELIGIBLE"]


def test_tile_score_matches_preview(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    """Cross-path consistency: MVT ELIGIBLE score == preview custom_score."""
    mvt = pytest.importorskip("mapbox_vector_tile")
    z = 3
    x, y = _deg2tile(20.0, 20.05, z)  # tile around candidate A only-ish
    h = _hash_for(seeded["run"], EQUAL_BODY)
    resp = pg_client.get(_tile_url(seeded["run"], EQUAL_BODY, z, x, y, h))
    decoded = mvt.decode(resp.content)
    scores = {
        f["properties"]["candidate_key"]: f["properties"].get("score")
        for f in decoded["candidates"]["features"]
        if f["properties"]["status"] == "ELIGIBLE"
    }
    assert scores.get("capital-grid-500m-v1:1_1") == 76.25


def test_tile_scenario_hash_mismatch_rejected(
    pg_client: TestClient, seeded: dict[str, Any]
) -> None:
    z = 3
    x, y = _deg2tile(_CLUSTER_LON, _CLUSTER_LAT, z)
    resp = pg_client.get(_tile_url(seeded["run"], EQUAL_BODY, z, x, y, "deadbeef"))
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "SCENARIO_HASH_MISMATCH"


def test_tile_malformed_weights_rejected(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    z = 3
    x, y = _deg2tile(_CLUSTER_LON, _CLUSTER_LAT, z)
    bad = {"zoning": "0.5", "road": "0.5", "equity": "0.5", "demand": "0.5"}
    resp = pg_client.get(_tile_url(seeded["run"], bad, z, x, y, "whatever"))
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_SCENARIO_WEIGHTS"


def test_tile_zxy_validation(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    h = _hash_for(seeded["run"], EQUAL_BODY)
    # at z=1 there are only 2 tiles per axis (0..1); x=5 is invalid
    resp = pg_client.get(_tile_url(seeded["run"], EQUAL_BODY, 1, 5, 0, h))
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_TILE_COORDINATE"


# --- regression: stored profiles + migration head unchanged ------------------


def test_stored_profile_summary_unchanged(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    body = pg_client.get(
        f"/api/v1/suitability/summary?run_id={seeded['run']}&profile=baseline"
    ).json()
    assert body["candidate_count_eligible"] == 3
    # scenario endpoints never mutate stored profile totals
    assert body["top_candidates"][0]["total_score"] == "80.0000"


def test_migration_head_is_0016_and_no_new_migration(pg_session: Session) -> None:
    head = pg_session.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert head == "0016"


def test_no_scenario_tables_added(pg_session: Session) -> None:
    rows = (
        pg_session.execute(
            text(
                "SELECT tablename FROM pg_tables WHERE schemaname='public' "
                "AND (tablename LIKE '%scenario%' OR tablename LIKE '%custom%')"
            )
        )
        .scalars()
        .all()
    )
    assert rows == []
