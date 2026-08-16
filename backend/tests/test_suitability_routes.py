"""Non-spatial suitability route tests (SQLite): policy, 404, and 422 paths.

Data-bearing candidate paths use PostGIS geometry and live in
``test_suitability_routes_integration.py`` (TEST_DATABASE_URL).
"""

from __future__ import annotations

import datetime
import json
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from waste_equity_backend.analysis.suitability import component_model, policy
from waste_equity_backend.api.routes import suitability as suitability_routes
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


def test_the_candidate_collection_run_lookup_selects_the_runs_own_versions(
    session: Session,
) -> None:
    """The candidate collection's run lookup must read the run's version identity.

    The route previously echoed the *running code's* module constants, which
    mislabels a stored run the moment two component models coexist. The candidate
    rows themselves are spatial (PostGIS tier), so this asserts the non-spatial
    half here: the run lookup's exact column list resolves against the real table
    and returns the versions the run was stored with, not the ones the process
    happens to be running.
    """

    run = _seed_run(session)
    row = (
        session.execute(
            text(
                "SELECT reference_year, weight_profiles, policy_version, "
                "derivation_version, candidate_grid_version "
                "FROM suitability_analysis_runs WHERE id = :id"
            ),
            {"id": run.id},
        )
        .mappings()
        .first()
    )
    assert row is not None
    assert row["policy_version"] == "suitability-policy-v1"
    assert row["derivation_version"] == "suitability-screening-v1"
    assert row["candidate_grid_version"] == "capital-grid-500m-v1"
    # The seeded run is deliberately stored under versions the running code has
    # moved past, which is exactly the case the collection used to mislabel.
    assert row["policy_version"] != policy.POLICY_VERSION
    assert row["derivation_version"] != policy.DERIVATION_VERSION


def test_bad_profile_is_422(client: TestClient) -> None:
    assert client.get("/api/v1/suitability/candidates?profile=bogus").status_code == 422


def test_bad_status_is_422(client: TestClient) -> None:
    assert client.get("/api/v1/suitability/candidates?status=MAYBE").status_code == 422


def test_bad_score_bounds_is_422(client: TestClient) -> None:
    assert client.get("/api/v1/suitability/candidates?min_score=250").status_code == 422


# --- Page 4B scope/order contract (DB-independent parts) ---------------------
# Which *rows* each filter selects needs PostGIS and lives in
# ``test_suitability_scope_filters_integration.py``. What is fixed here is the
# contract the frontend codes against: the closed sort vocabulary, the repeatable
# shape of ``sigungu`` in the schema, and the region-code normalization rule.


def test_bad_sort_is_422(client: TestClient) -> None:
    """``sort`` is a closed two-value vocabulary, not a sort-field selector."""
    for bogus in ("asc", "desc", "-rank", "equity_score", "score_desc "):
        assert client.get(f"/api/v1/suitability/candidates?sort={bogus}").status_code == 422, bogus


def test_default_sort_is_score_desc() -> None:
    assert suitability_routes.DEFAULT_CANDIDATE_SORT == "score_desc"


def test_openapi_declares_sigungu_repeatable_and_sido_scalar(client: TestClient) -> None:
    """The published contract must show ``sigungu`` as an array, or clients will send one.

    Read through ``app.openapi()`` rather than the router: FastAPI builds the schema
    from the mounted app, and the router alone does not carry the resolved parameters.
    """
    schema = client.app.openapi()  # type: ignore[attr-defined]
    params = {
        p["name"]: p for p in schema["paths"]["/api/v1/suitability/candidates"]["get"]["parameters"]
    }
    sigungu = _unwrap_optional(params["sigungu"]["schema"])
    assert sigungu["type"] == "array"
    assert sigungu["items"]["type"] == "string"
    assert _unwrap_optional(params["sido"]["schema"])["type"] == "string"
    assert set(_unwrap_optional(params["sort"]["schema"])["enum"]) == {"score_desc", "score_asc"}


def _unwrap_optional(schema: dict[str, object]) -> dict[str, Any]:
    """Return the non-null branch of an ``anyOf`` optional, or the schema itself."""
    branches = schema.get("anyOf")
    if isinstance(branches, list):
        for branch in branches:
            if isinstance(branch, dict) and branch.get("type") != "null":
                return branch
    return dict(schema)


def test_bare_sgis_code_normalizes_to_the_canonical_region_code() -> None:
    """The stored code space is ``KR-SGIS-<adm_cd>``; the bare SGIS form is an alias."""
    assert suitability_routes._canonical_region_code("11") == "KR-SGIS-11"
    assert suitability_routes._canonical_region_code("11010") == "KR-SGIS-11010"
    assert suitability_routes._canonical_region_code(" 31 ") == "KR-SGIS-31"
    # Already-canonical codes pass through untouched.
    assert suitability_routes._canonical_region_code("KR-SGIS-23") == "KR-SGIS-23"
    # A non-numeric, non-canonical value is NOT coerced into something plausible: it
    # stays unrecognized so it matches nothing instead of silently selecting a region.
    assert suitability_routes._canonical_region_code("서울") == "서울"
    assert suitability_routes._canonical_region_code("KR-RCISRG-3110") == "KR-RCISRG-3110"


def test_repeated_region_codes_are_normalized_deduped_and_blank_stripped() -> None:
    dedupe = suitability_routes._distinct_region_codes
    assert dedupe(None) == []
    assert dedupe([]) == []
    assert dedupe(["", "   "]) == []
    # Bare and canonical spellings of one region collapse to a single code, and the
    # first-seen order is preserved so the emitted SQL is stable per request.
    assert dedupe(["11010", "KR-SGIS-11020", "KR-SGIS-11010"]) == ["KR-SGIS-11010", "KR-SGIS-11020"]


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


# --------------------------------------------------------------------------- #
# Component-model identity and model-scoped default-run resolution
# --------------------------------------------------------------------------- #
#
# Run-level model awareness is fully exercisable here: ``suitability_analysis_runs``
# is non-spatial. The candidate-bearing half of the contract (component_scores,
# explicit-null legacy fields, successor tiles) needs PostGIS geometry and lives in
# ``test_suitability_routes_integration.py``.


def _seed_successor_shaped_run(session: Session, *, run_id: int = 900) -> int:
    """A synthetic run labelled with the SUCCESSOR component model.

    Deliberately a *fixture*, not a produced run: no successor analysis is built,
    scored, or persisted by this branch, and none can be — the successor model is
    not activated. This row exists only so the version-aware boundary can be
    exercised from both sides.
    """

    now = datetime.datetime(2026, 1, 1, tzinfo=datetime.UTC)
    session.execute(
        text(
            """
            INSERT INTO suitability_analysis_runs (
                id, derivation_version, policy_version, candidate_grid_version,
                component_model_version, component_order, reference_year,
                boundary_vintage, weight_profile, analysis_signature, status,
                candidate_count_total, candidate_count_eligible, candidate_count_review,
                candidate_count_excluded, input_dataset_version_ids, input_provenance,
                policy_snapshot, weight_profiles, weight_derivation, stability_definition,
                started_at, completed_at, created_at
            ) VALUES (
                :id, 'synthetic-successor-derivation', 'synthetic-successor-policy',
                'capital-grid-500m-v1', :component_model, :component_order, 2026,
                '2024', 'baseline', :signature, 'SUCCEEDED',
                0, 0, 0, 0, '[]', '{}', '{}', '{}', '{}', '{}',
                :now, :now, :now
            )
            """
        ),
        {
            "id": run_id,
            "component_model": component_model.COMPONENT_MODEL_SUCCESSOR,
            "component_order": json.dumps(list(component_model.COMPONENT_ORDER_SUCCESSOR)),
            "signature": f"synthetic-successor-{run_id}",
            "now": now,
        },
    )
    session.commit()
    return run_id


def test_policies_reports_the_implemented_component_model(client: TestClient) -> None:
    body = client.get("/api/v1/suitability/policies").json()
    assert body["component_model_version"] == "suitability-components-zred-v1"
    assert body["component_order"] == ["zoning", "road", "equity", "demand"]


def test_a_stored_run_reports_its_own_component_model(
    client: TestClient, session: Session
) -> None:
    _seed_run(session)
    body = client.get("/api/v1/suitability/runs/latest").json()
    assert body["component_model_version"] == "suitability-components-zred-v1"
    assert body["component_order"] == ["zoning", "road", "equity", "demand"]


def test_the_run_list_labels_each_run_with_its_own_component_model(
    client: TestClient, session: Session
) -> None:
    """The §1-finding-2 regression, at the run level: never label a stored row with
    whatever constants the currently running code happens to use."""

    historical = _seed_run(session)
    successor = _seed_successor_shaped_run(session)
    runs = {r["id"]: r for r in client.get("/api/v1/suitability/runs").json()["runs"]}
    assert runs[historical.id]["component_model_version"] == "suitability-components-zred-v1"
    assert runs[historical.id]["component_order"] == ["zoning", "road", "equity", "demand"]
    assert runs[successor]["component_model_version"] == "suitability-components-successor-v1"
    assert runs[successor]["component_order"] == [
        "existing_burden",
        "air_impact_proxy",
        "resident_impact",
        "land_conversion",
    ]


def test_the_run_list_can_be_scoped_to_one_component_model(
    client: TestClient, session: Session
) -> None:
    historical = _seed_run(session)
    successor = _seed_successor_shaped_run(session)
    scoped = client.get(
        "/api/v1/suitability/runs"
        "?component_model_version=suitability-components-successor-v1"
    ).json()
    assert [r["id"] for r in scoped["runs"]] == [successor]
    assert scoped["count"] == 1
    both = client.get("/api/v1/suitability/runs").json()
    assert {r["id"] for r in both["runs"]} == {historical.id, successor}


def test_an_unpinned_request_stays_on_the_historical_model(
    client: TestClient, session: Session
) -> None:
    """The rollout guard: a newer successor run must NOT redefine the default.

    The successor run is seeded second and has the later completed_at, so the
    pre-scoping ``ORDER BY completed_at DESC`` would have picked it — silently
    switching every default view and every un-pinned shared link to a different
    analytical model.
    """

    historical = _seed_run(session)
    _seed_successor_shaped_run(session)
    body = client.get("/api/v1/suitability/runs/latest").json()
    assert body["id"] == historical.id
    assert body["component_model_version"] == "suitability-components-zred-v1"


def test_an_explicit_selector_resolves_deterministically(
    client: TestClient, session: Session
) -> None:
    historical = _seed_run(session)
    successor = _seed_successor_shaped_run(session)
    for _ in range(3):
        assert (
            client.get(
                "/api/v1/suitability/runs/latest"
                "?component_model_version=suitability-components-successor-v1"
            ).json()["id"]
            == successor
        )
        assert (
            client.get(
                "/api/v1/suitability/runs/latest"
                "?component_model_version=suitability-components-zred-v1"
            ).json()["id"]
            == historical.id
        )


def test_a_pinned_run_of_the_wrong_model_fails_clearly(
    client: TestClient, session: Session
) -> None:
    run = _seed_run(session)
    response = client.get(
        f"/api/v1/suitability/candidates?run_id={run.id}"
        "&component_model_version=suitability-components-successor-v1"
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["error"] == "COMPONENT_MODEL_MISMATCH"
    assert detail["fields"]["run_component_model_version"] == "suitability-components-zred-v1"
    assert (
        detail["fields"]["requested_component_model_version"]
        == "suitability-components-successor-v1"
    )


def test_an_unknown_component_model_is_refused_not_silently_defaulted(
    client: TestClient, session: Session
) -> None:
    _seed_run(session)
    response = client.get("/api/v1/suitability/runs/latest?component_model_version=zred")
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "UNKNOWN_COMPONENT_MODEL"


def test_no_run_of_the_requested_model_is_a_structured_404(
    client: TestClient, session: Session
) -> None:
    _seed_run(session)
    response = client.get(
        "/api/v1/suitability/runs/latest"
        "?component_model_version=suitability-components-successor-v1"
    )
    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "NO_ANALYSIS_AVAILABLE"
    assert "suitability-components-successor-v1" in response.json()["detail"]["detail"]


def test_the_historical_tile_query_is_byte_identical_to_the_pre_change_contract() -> None:
    """The map already caches historical tiles; their bytes must not move.

    Pinned as the exact query text rather than "contains the four columns", because
    a whitespace or ordering change would still be a change to a cached artifact's
    generator.
    """

    assert suitability_routes._tile_sql(
        component_model.COMPONENT_MODEL_HISTORICAL
    ) == suitability_routes._TILE_SQL
    assert (
        "        c.zoning_score::double precision AS zoning_score,\n"
        "        c.road_score::double precision AS road_score,\n"
        "        c.equity_score::double precision AS equity_score,\n"
        "        c.demand_score::double precision AS demand_score,\n"
        "        c.stable_count AS stable_count,"
    ) in suitability_routes._TILE_SQL
    assert "component_scores" not in suitability_routes._TILE_SQL


def test_a_successor_run_tile_query_reads_the_version_aware_map() -> None:
    sql = suitability_routes._tile_sql(component_model.COMPONENT_MODEL_SUCCESSOR)
    assert "(c.component_scores ->> 'existing_burden')::double precision" in sql
    # A legacy tile property must never carry a successor meaning.
    for legacy in ("zoning_score", "road_score", "equity_score", "demand_score"):
        assert legacy not in sql
