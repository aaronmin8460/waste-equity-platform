"""User-defined weight *scenario* API (Phase 6) — temporary decision support.

Three read-only endpoints recombine ONE fixed succeeded run's frozen Z/R/E/D
component scores under user-supplied weights, entirely on read:

* ``POST /api/v1/suitability/scenarios/preview`` — rank the complete ELIGIBLE
  population under the custom weights and return the top N with comparison-profile
  rank deltas.
* ``POST /api/v1/suitability/scenarios/candidates/{candidate_id}`` — one
  candidate's full scenario result (custom score/rank, weighted contributions,
  stored stability, fixed reasons/provenance).
* ``GET  /api/v1/suitability/scenarios/tiles/{run_id}/{z}/{x}/{y}.mvt`` — custom
  MVT: ELIGIBLE cells styled by the recomputed ``score``, review cells by
  ``provisional_score``. No global ranking inside a tile.

Nothing here writes to the database, adds a migration, mutates any stored run,
touches CRITIC/stability, or is a legal/permitting/final-siting determination.
Every user value is a **bound** parameter; the only interpolated SQL is a static,
trusted banker's-rounding fragment. See ``docs/SUITABILITY_USER_WEIGHT_SCENARIOS.md``.
"""

from __future__ import annotations

import json
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...analysis.suitability import policy, scenario
from ...db import get_session
from ...schemas.scenario import (
    ScenarioContribution,
    UserScenarioCandidateDetailOut,
    UserScenarioCandidateDetailRequest,
    UserScenarioTopCandidate,
    UserWeightScenarioPreviewOut,
    UserWeightScenarioRequest,
)
from ...schemas.suitability import SCREENING_DISCLAIMER
from .suitability import (
    ASSUMPTIONS,
    MVT_CONTENT_TYPE,
    MVT_MAX_ZOOM,
    MVT_MIN_ZOOM,
    TILE_SOURCE_LAYER,
    _ensure_profile_available,
    _not_found,
    _resolve_run_id,
)

router = APIRouter(prefix="/api/v1/suitability/scenarios", tags=["suitability-scenarios"])
SessionDep = Annotated[Session, Depends(get_session)]

# A user scenario tile is fully determined by its URL (run + canonical weights +
# scenario_hash). It is a temporary experiment, NOT a stored immutable official
# profile, so it uses a *bounded* one-day browser cache rather than the year-long
# ``immutable`` policy of stored-profile tiles.
SCENARIO_TILE_CACHE_CONTROL = "public, max-age=86400, immutable"

SCENARIO_ASSUMPTIONS = [
    "사용자 시나리오는 고정된 한 개 분석 실행의 저장된 Z/R/E/D 구성점수만 재결합합니다 "
    "(a user scenario only recombines one fixed run's stored component scores).",
    "상태(ELIGIBLE/REVIEW_REQUIRED/EXCLUDED), 배제/검토 사유, 안정성(stable_count·"
    "stability_class)은 재계산되지 않고 저장된 값을 그대로 사용합니다.",
    "순위는 해당 실행의 완전한 ELIGIBLE 후보에 대해서만, custom_score 내림차순·"
    "candidate_key 오름차순으로 산정됩니다.",
    *ASSUMPTIONS,
]


# --------------------------------------------------------------------------- #
# Trusted static SQL fragments (never any user text) — one shared scoring formula
# --------------------------------------------------------------------------- #

# Weighted sum of the four frozen component scores under the bound weights
# (:wz/:wr/:we/:wd). Non-negative convex combination of [0,100] scores.
_RAW_SCORE_SQL = (
    "(c.zoning_score * :wz + c.road_score * :wr + c.equity_score * :we + c.demand_score * :wd)"
)

# Provisional numerator/denominator over the components actually present (a missing
# component contributes to neither — never zero-filled).
_PROV_NUM_SQL = (
    "(coalesce(c.zoning_score * :wz, 0) + coalesce(c.road_score * :wr, 0) "
    "+ coalesce(c.equity_score * :we, 0) + coalesce(c.demand_score * :wd, 0))"
)
_PROV_DEN_SQL = (
    "((CASE WHEN c.zoning_score IS NOT NULL THEN :wz ELSE 0 END) "
    "+ (CASE WHEN c.road_score IS NOT NULL THEN :wr ELSE 0 END) "
    "+ (CASE WHEN c.equity_score IS NOT NULL THEN :we ELSE 0 END) "
    "+ (CASE WHEN c.demand_score IS NOT NULL THEN :wd ELSE 0 END))"
)


def _round_half_even_4(col: str) -> str:
    """Trusted SQL: round a NON-NEGATIVE numeric expression to 4 dp, banker's rounding.

    PostgreSQL ``round(numeric, 4)`` rounds half *away from zero*, but the stored
    composites (and :func:`policy.quantize_score`) use ROUND_HALF_EVEN. This
    fragment reproduces ROUND_HALF_EVEN so the Python helper, preview SQL,
    candidate-detail SQL, and MVT SQL agree byte-for-byte. ``col`` is a trusted
    internal column/expression reference (never user text); ``NULL`` propagates to
    ``NULL``. Scenario scores are non-negative, so ``floor`` == truncation.
    """

    scaled = f"(({col}) * 10000)"
    fl = f"floor({scaled})"
    return (
        f"(CASE WHEN {scaled} - {fl} = 0.5 "
        f"THEN (CASE WHEN ({fl})::bigint % 2 = 0 THEN {fl} ELSE {fl} + 1 END) / 10000.0 "
        f"ELSE round(({col})::numeric, 4) END)"
    )


# Full-population ranking of ELIGIBLE candidates under the custom weights. Every
# user value (run, weights, top_n) is a bound parameter; the window covers the
# COMPLETE ELIGIBLE population before LIMIT (sequential 1..N, score DESC then
# candidate_key ASC — the same deterministic behavior as the stored engine).
_PREVIEW_SQL = f"""
WITH raw AS (
    SELECT
        c.id AS candidate_id,
        c.candidate_key AS candidate_key,
        c.sido_region_code AS sido_region_code,
        c.sido_region_name AS sido_region_name,
        c.sigungu_region_code AS sigungu_region_code,
        c.sigungu_region_name AS sigungu_region_name,
        c.zoning_score AS zoning_score,
        c.road_score AS road_score,
        c.equity_score AS equity_score,
        c.demand_score AS demand_score,
        c.stable_count AS stable_count,
        c.stability_class AS stability_class,
        (c.profile_totals ->> :profile) AS comparison_score,
        (c.profile_ranks ->> :profile)::int AS comparison_rank,
        ST_X(c.centroid) AS centroid_lon,
        ST_Y(c.centroid) AS centroid_lat,
        {_RAW_SCORE_SQL} AS raw_score
    FROM suitability_candidates c
    WHERE c.analysis_run_id = :run_id
      AND c.status = 'ELIGIBLE'
      AND c.zoning_score IS NOT NULL
      AND c.road_score IS NOT NULL
      AND c.equity_score IS NOT NULL
      AND c.demand_score IS NOT NULL
),
scored AS (
    SELECT raw.*, {_round_half_even_4("raw.raw_score")} AS custom_score
    FROM raw
),
ranked AS (
    SELECT
        scored.*,
        row_number() OVER (ORDER BY custom_score DESC, candidate_key ASC) AS custom_rank,
        count(*) OVER () AS ranking_population
    FROM scored
)
SELECT * FROM ranked ORDER BY custom_rank ASC LIMIT :top_n
"""

# Sequential custom rank of ONE ELIGIBLE candidate without ranking twice: 1 + the
# number of ELIGIBLE candidates that strictly outrank it (higher custom_score, or
# equal custom_score with a smaller candidate_key). Matches ``row_number`` exactly
# because Python and SQL round the score identically (banker's, 4 dp).
_CANDIDATE_RANK_SQL = f"""
WITH raw AS (
    SELECT
        c.candidate_key AS candidate_key,
        {_RAW_SCORE_SQL} AS raw_score
    FROM suitability_candidates c
    WHERE c.analysis_run_id = :run_id
      AND c.status = 'ELIGIBLE'
      AND c.zoning_score IS NOT NULL
      AND c.road_score IS NOT NULL
      AND c.equity_score IS NOT NULL
      AND c.demand_score IS NOT NULL
),
scored AS (
    SELECT candidate_key, {_round_half_even_4("raw.raw_score")} AS cs FROM raw
)
SELECT count(*) + 1
FROM scored
WHERE cs > :this_score
   OR (cs = :this_score AND candidate_key < :this_key)
"""

# Custom MVT: recompute the ELIGIBLE ``score`` and REVIEW ``provisional_score`` on
# the geometries intersecting the tile only (filter-before-transform: the
# ``geometry &&`` predicate hits the 4326 GiST index, then only matched geometries
# are transformed for ST_AsMVTGeom). Same source-layer + property names as the
# stored tiles so the map reuses its fill/outline expressions. NO global ranking.
_TILE_SQL = f"""
WITH base AS (
    SELECT
        ST_AsMVTGeom(
            ST_Transform(c.geometry, 3857),
            ST_TileEnvelope(:z, :x, :y),
            4096, 64, true
        ) AS geom,
        c.id AS candidate_id,
        c.candidate_key AS candidate_key,
        c.status AS status,
        c.zoning_score AS zoning_score,
        c.road_score AS road_score,
        c.equity_score AS equity_score,
        c.demand_score AS demand_score,
        c.stable_count AS stable_count,
        c.stability_class AS stability_class,
        c.sigungu_region_code AS sigungu_region_code,
        c.sigungu_region_name AS sigungu_region_name,
        CASE WHEN c.status = 'ELIGIBLE' THEN {_RAW_SCORE_SQL} END AS raw_score,
        CASE WHEN c.status = 'REVIEW_REQUIRED'
             THEN {_PROV_NUM_SQL} / nullif({_PROV_DEN_SQL}, 0) END AS raw_provisional
    FROM suitability_candidates c
    WHERE c.analysis_run_id = :run_id
      AND c.geometry && ST_Transform(ST_TileEnvelope(:z, :x, :y), 4326)
)
SELECT ST_AsMVT(t.*, '{TILE_SOURCE_LAYER}', 4096, 'geom')
FROM (
    SELECT
        geom,
        candidate_id,
        candidate_key,
        status,
        {_round_half_even_4("raw_score")}::double precision AS score,
        {_round_half_even_4("raw_provisional")}::double precision AS provisional_score,
        zoning_score::double precision AS zoning_score,
        road_score::double precision AS road_score,
        equity_score::double precision AS equity_score,
        demand_score::double precision AS demand_score,
        stable_count,
        stability_class,
        sigungu_region_code,
        sigungu_region_name
    FROM base
) t
WHERE t.geom IS NOT NULL
"""


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #

_RUN_META_SQL = (
    "SELECT reference_year, policy_version, derivation_version, candidate_grid_version, "
    "weight_profiles, candidate_count_total, candidate_count_eligible, "
    "candidate_count_review, candidate_count_excluded "
    "FROM suitability_analysis_runs WHERE id = :id"
)


def _validate_weights(raw: dict[str, str]) -> dict[str, Decimal]:
    """Validate + canonicalize; a scenario weight error → structured 422."""

    try:
        return scenario.parse_and_validate_weights(raw)
    except scenario.ScenarioWeightError as exc:
        raise HTTPException(status_code=422, detail=exc.as_envelope()) from exc


def _weight_params(weights: dict[str, Decimal]) -> dict[str, Decimal]:
    """Bound-parameter mapping for the shared scoring SQL."""

    return {
        "wz": weights["zoning"],
        "wr": weights["road"],
        "we": weights["equity"],
        "wd": weights["demand"],
    }


def _score_str(value: Any) -> str | None:
    if value is None:
        return None
    return format(Decimal(str(value)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_EVEN), "f")


def _component_decimals(row: Any) -> dict[str, Decimal]:
    """The present component scores as Decimals (missing components absent)."""

    present: dict[str, Decimal] = {}
    for c in policy.COMPONENTS:
        value = row[f"{c}_score"]
        if value is not None:
            present[c] = Decimal(str(value))
    return present


def _contributions(
    components: dict[str, Decimal], weights: dict[str, Decimal], canonical: dict[str, str]
) -> list[ScenarioContribution]:
    out: list[ScenarioContribution] = []
    for c in policy.COMPONENTS:
        score = components.get(c)
        contribution = (
            format((score * weights[c]).quantize(Decimal("0.0001"), rounding=ROUND_HALF_EVEN), "f")
            if score is not None
            else None
        )
        out.append(
            ScenarioContribution(
                component=c,
                component_score=(format(score, "f") if score is not None else None),
                weight=canonical[c],
                weighted_contribution=contribution,
            )
        )
    return out


def _relative_tile_url(run_id: int, canonical: dict[str, str], full_hash: str) -> str:
    """Relative MVT template (client resolves against the page origin)."""

    return (
        f"/api/v1/suitability/scenarios/tiles/{run_id}/{{z}}/{{x}}/{{y}}.mvt"
        f"?wz={canonical['zoning']}&wr={canonical['road']}"
        f"&we={canonical['equity']}&wd={canonical['demand']}"
        f"&scenario_hash={full_hash}"
    )


def _load_run_meta(session: Session, resolved: int) -> Any:
    row = session.execute(text(_RUN_META_SQL), {"id": resolved}).mappings().first()
    assert row is not None
    return row


def _build_candidate_detail(
    session: Session,
    *,
    resolved_run: int,
    candidate_id: int,
    weights: dict[str, Decimal],
    canonical: dict[str, str],
    compare_profile: str,
    full_hash: str,
    run_meta: Any,
) -> UserScenarioCandidateDetailOut:
    """One candidate's scenario result. Reuses the stored candidate row + provenance.

    A candidate from another run → structured CANDIDATE_RUN_MISMATCH (never silently
    resolved from a different run). Missing → CANDIDATE_NOT_FOUND.
    """

    row = (
        session.execute(
            text(
                """
                SELECT c.*, ST_AsGeoJSON(c.geometry) AS geojson,
                       ST_X(c.centroid) AS centroid_lon, ST_Y(c.centroid) AS centroid_lat
                FROM suitability_candidates c
                WHERE c.id = :id
                """
            ),
            {"id": candidate_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise _not_found("CANDIDATE_NOT_FOUND", f"No suitability candidate with id {candidate_id}.")
    if row["analysis_run_id"] != resolved_run:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "CANDIDATE_RUN_MISMATCH",
                "detail": (
                    f"Candidate {candidate_id} belongs to run {row['analysis_run_id']}, "
                    f"not the requested run {resolved_run}."
                ),
            },
        )
    status = row["status"]
    is_excluded = status == policy.STATUS_EXCLUDED
    is_review = status == policy.STATUS_REVIEW
    components = _component_decimals(row)
    all_present = set(components) == set(policy.COMPONENTS)

    custom_score: str | None = None
    custom_provisional: str | None = None
    custom_rank: int | None = None
    if status == policy.STATUS_ELIGIBLE and all_present:
        score_dec = scenario.scenario_score(components, weights)
        custom_score = format(score_dec, "f")
        rank = session.execute(
            text(_CANDIDATE_RANK_SQL),
            {
                "run_id": resolved_run,
                "this_score": score_dec,
                "this_key": row["candidate_key"],
                **_weight_params(weights),
            },
        ).scalar_one()
        custom_rank = int(rank)
    elif is_review:
        prov = scenario.scenario_provisional_score(components, weights)
        custom_provisional = format(prov, "f") if prov is not None else None

    profile_ranks = row["profile_ranks"] or {}
    profile_totals = row["profile_totals"] or {}
    comparison_rank = (
        int(profile_ranks[compare_profile])
        if profile_ranks.get(compare_profile) is not None
        else None
    )
    comparison_total = profile_totals.get(compare_profile)
    comparison_score = (
        comparison_total
        if (status == policy.STATUS_ELIGIBLE and comparison_total is not None)
        else None
    )
    delta = scenario.rank_delta(comparison_rank, custom_rank)

    return UserScenarioCandidateDetailOut(
        candidate_id=row["id"],
        run_id=row["analysis_run_id"],
        candidate_key=row["candidate_key"],
        status=status,
        is_excluded=is_excluded,
        method_version=scenario.USER_WEIGHT_SCENARIO_METHOD_VERSION,
        scenario_hash=full_hash,
        scenario_hash_short=scenario.short_scenario_hash(full_hash),
        canonical_weights=canonical,
        compare_profile=compare_profile,
        custom_score=custom_score,
        custom_provisional_score=custom_provisional,
        custom_rank=custom_rank,
        comparison_score=comparison_score,
        comparison_rank=comparison_rank,
        rank_delta=delta,
        rank_change_direction=scenario.rank_change_direction(delta),
        zoning_score=_score_str(row["zoning_score"]),
        road_score=_score_str(row["road_score"]),
        equity_score=_score_str(row["equity_score"]),
        demand_score=_score_str(row["demand_score"]),
        contributions=_contributions(components, weights, canonical),
        stable_count=row["stable_count"],
        stability_class=row["stability_class"],
        stability_membership=row["stability_membership"] or {},
        profile_totals=profile_totals,
        profile_ranks=profile_ranks,
        sido_region_code=row["sido_region_code"],
        sido_region_name=row["sido_region_name"],
        sigungu_region_code=row["sigungu_region_code"],
        sigungu_region_name=row["sigungu_region_name"],
        exclusion_reasons=row["exclusion_reasons"] or [],
        review_reasons=row["review_reasons"] or [],
        penalties=row["penalties"] or [],
        raw_components=row["raw_components"] or {},
        nearest_road_distance_m=(
            _score_str(row["nearest_road_distance_m"])
            if row["nearest_road_distance_m"] is not None
            else None
        ),
        nearest_road_provenance=row["nearest_road_provenance"] or {},
        component_provenance=row["component_provenance"] or {},
        centroid_lon=(round(row["centroid_lon"], 6) if row["centroid_lon"] is not None else None),
        centroid_lat=(round(row["centroid_lat"], 6) if row["centroid_lat"] is not None else None),
        geometry=json.loads(row["geojson"]) if row["geojson"] is not None else {},
        reference_year=run_meta["reference_year"],
        policy_version=run_meta["policy_version"],
        derivation_version=run_meta["derivation_version"],
        candidate_grid_version=run_meta["candidate_grid_version"],
        scenario_label=scenario.SCENARIO_LABEL_KO,
        scenario_disclaimer=scenario.SCENARIO_DISCLAIMER_KO,
        screening_disclaimer=SCREENING_DISCLAIMER,
    )


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.post("/preview", response_model=UserWeightScenarioPreviewOut)
def preview(session: SessionDep, req: UserWeightScenarioRequest) -> UserWeightScenarioPreviewOut:
    resolved = _resolve_run_id(session, req.run_id)
    run_meta = _load_run_meta(session, resolved)
    _ensure_profile_available(run_meta["weight_profiles"] or {}, req.compare_profile, resolved)

    weights = _validate_weights(req.weights)
    canonical = scenario.canonical_weight_strings(weights)
    full_hash = scenario.scenario_hash(resolved, weights)

    rows = (
        session.execute(
            text(_PREVIEW_SQL),
            {
                "run_id": resolved,
                "profile": req.compare_profile,
                "top_n": req.top_n,
                **_weight_params(weights),
            },
        )
        .mappings()
        .all()
    )

    ranking_population = int(rows[0]["ranking_population"]) if rows else 0
    top_candidates: list[UserScenarioTopCandidate] = []
    for r in rows:
        comparison_rank = r["comparison_rank"]
        custom_rank = int(r["custom_rank"])
        delta = scenario.rank_delta(comparison_rank, custom_rank)
        top_candidates.append(
            UserScenarioTopCandidate(
                candidate_id=r["candidate_id"],
                candidate_key=r["candidate_key"],
                sido_region_code=r["sido_region_code"],
                sido_region_name=r["sido_region_name"],
                sigungu_region_code=r["sigungu_region_code"],
                sigungu_region_name=r["sigungu_region_name"],
                custom_score=_score_str(r["custom_score"]) or "0.0000",
                custom_rank=custom_rank,
                comparison_profile=req.compare_profile,
                comparison_score=r["comparison_score"],
                comparison_rank=comparison_rank,
                rank_delta=delta,
                rank_change_direction=scenario.rank_change_direction(delta),
                zoning_score=_score_str(r["zoning_score"]),
                road_score=_score_str(r["road_score"]),
                equity_score=_score_str(r["equity_score"]),
                demand_score=_score_str(r["demand_score"]),
                stable_count=r["stable_count"],
                stability_class=r["stability_class"],
                centroid_lon=(
                    round(r["centroid_lon"], 6) if r["centroid_lon"] is not None else None
                ),
                centroid_lat=(
                    round(r["centroid_lat"], 6) if r["centroid_lat"] is not None else None
                ),
            )
        )

    selected_candidate = None
    if req.selected_candidate_id is not None:
        selected_candidate = _build_candidate_detail(
            session,
            resolved_run=resolved,
            candidate_id=req.selected_candidate_id,
            weights=weights,
            canonical=canonical,
            compare_profile=req.compare_profile,
            full_hash=full_hash,
            run_meta=run_meta,
        )

    return UserWeightScenarioPreviewOut(
        scenario_hash=full_hash,
        scenario_hash_short=scenario.short_scenario_hash(full_hash),
        method_version=scenario.USER_WEIGHT_SCENARIO_METHOD_VERSION,
        run_id=resolved,
        reference_year=run_meta["reference_year"],
        policy_version=run_meta["policy_version"],
        derivation_version=run_meta["derivation_version"],
        candidate_grid_version=run_meta["candidate_grid_version"],
        canonical_weights=canonical,
        compare_profile=req.compare_profile,
        candidate_count_total=run_meta["candidate_count_total"],
        candidate_count_eligible=run_meta["candidate_count_eligible"],
        candidate_count_review=run_meta["candidate_count_review"],
        candidate_count_excluded=run_meta["candidate_count_excluded"],
        ranking_population=ranking_population,
        top_candidates=top_candidates,
        selected_candidate=selected_candidate,
        tile_url=_relative_tile_url(resolved, canonical, full_hash),
        assumptions=SCENARIO_ASSUMPTIONS,
        scenario_label=scenario.SCENARIO_LABEL_KO,
        scenario_disclaimer=scenario.SCENARIO_DISCLAIMER_KO,
        screening_disclaimer=SCREENING_DISCLAIMER,
    )


@router.post("/candidates/{candidate_id}", response_model=UserScenarioCandidateDetailOut)
def candidate_detail(
    session: SessionDep, candidate_id: int, req: UserScenarioCandidateDetailRequest
) -> UserScenarioCandidateDetailOut:
    resolved = _resolve_run_id(session, req.run_id)
    run_meta = _load_run_meta(session, resolved)
    _ensure_profile_available(run_meta["weight_profiles"] or {}, req.compare_profile, resolved)

    weights = _validate_weights(req.weights)
    canonical = scenario.canonical_weight_strings(weights)
    full_hash = scenario.scenario_hash(resolved, weights)
    return _build_candidate_detail(
        session,
        resolved_run=resolved,
        candidate_id=candidate_id,
        weights=weights,
        canonical=canonical,
        compare_profile=req.compare_profile,
        full_hash=full_hash,
        run_meta=run_meta,
    )


@router.get("/tiles/{run_id}/{z}/{x}/{y}.mvt")
def scenario_tile(
    session: SessionDep,
    request: Request,
    run_id: int,
    wz: str = Query(...),
    wr: str = Query(...),
    we: str = Query(...),
    wd: str = Query(...),
    scenario_hash: str = Query(...),
    z: int = Path(..., ge=MVT_MIN_ZOOM, le=MVT_MAX_ZOOM),
    x: int = Path(..., ge=0),
    y: int = Path(..., ge=0),
) -> Response:
    """Serve one custom-scenario vector tile (no global ranking inside the tile)."""

    max_index = (1 << z) - 1
    if x > max_index or y > max_index:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "INVALID_TILE_COORDINATE",
                "detail": f"x and y must be in [0, {max_index}] at zoom {z}",
            },
        )
    weights = _validate_weights({"zoning": wz, "road": wr, "equity": we, "demand": wd})
    expected_hash = scenario.scenario_hash(run_id, weights)
    if scenario_hash != expected_hash:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "SCENARIO_HASH_MISMATCH",
                "detail": "scenario_hash does not match the run and canonical weights.",
                "fields": {"expected": expected_hash},
            },
        )
    resolved = _resolve_run_id(session, run_id)

    # ETag binds run + canonical weights (via the hash prefix) + z/x/y; the URL
    # fully determines the bytes. Bounded one-day browser cache (a temporary
    # experiment, not a stored immutable official profile).
    etag = f'"suitscn-{resolved}-{scenario.short_scenario_hash(expected_hash)}-{z}-{x}-{y}"'
    cache_headers = {"Cache-Control": SCENARIO_TILE_CACHE_CONTROL, "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=cache_headers)

    raw = session.execute(
        text(_TILE_SQL),
        {"run_id": resolved, "z": z, "x": x, "y": y, **_weight_params(weights)},
    ).scalar()
    body = bytes(raw) if raw is not None else b""
    return Response(content=body, media_type=MVT_CONTENT_TYPE, headers=cache_headers)
