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
from collections.abc import Sequence
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...analysis.suitability import component_model, policy, scenario
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
    # The region-code space is defined ONCE, in the candidates route, together with
    # the long comment explaining which of the three neighbouring code spaces is
    # stored on ``suitability_candidates``. These are imported rather than
    # re-implemented so a scope can never mean one set of rows on
    # ``/suitability/candidates`` and a different set here.
    _canonical_region_code,
    _distinct_region_codes,
    _ensure_profile_available,
    _json_field,
    _not_found,
    _resolve_run_id,
    _run_model_identity,
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


def _scope_predicate(
    sido: str | None, sigungu: list[str] | None, *, alias: str = "c"
) -> tuple[str, dict[str, Any]]:
    """SQL AND-clauses restricting a scenario query to the analysis scope, + params.

    THE SAME COMPOSITION ``/suitability/candidates`` USES, deliberately: a 시·도
    equality and a 시·군·구 ``IN`` list, ANDed, over the canonical SGIS codes stored
    on the candidate row. Returning ``("", {})`` for an empty scope is what keeps
    수도권 전체 exactly the query it has always been.

    Every code is a BOUND parameter — the only thing interpolated into the SQL is a
    generated placeholder NAME (``:sigungu_0``…), never a value.

    A 시·군·구 list that is empty after normalization applies NO restriction rather
    than matching nothing: a cleared multi-select must return to 수도권 전체, not
    silently blank the comparison.
    """

    clauses: list[str] = []
    params: dict[str, Any] = {}
    if sido is not None and sido.strip() != "":
        clauses.append(f"AND {alias}.sido_region_code = :scope_sido")
        params["scope_sido"] = _canonical_region_code(sido)
    codes = _distinct_region_codes(list(sigungu) if sigungu else None)
    if codes:
        placeholders = ", ".join(f":scope_sigungu_{i}" for i in range(len(codes)))
        clauses.append(f"AND {alias}.sigungu_region_code IN ({placeholders})")
        params.update({f"scope_sigungu_{i}": code for i, code in enumerate(codes)})
    return ("\n      ".join(clauses), params)


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
_PREVIEW_SQL_TEMPLATE = f"""
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
        c.component_scores AS component_scores,
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
      {{scope}}
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


def _preview_sql(scope_sql: str) -> str:
    """The ranking query, restricted to the analysis scope.

    THE SCOPE IS INSIDE ``raw``, i.e. BEFORE ``row_number()`` and before
    ``count(*) OVER ()``. That is the whole point: ``custom_rank`` becomes the
    candidate's rank WITHIN the selected 범위 and ``ranking_population`` becomes that
    범위's size. Filtering after the window would have produced capital-region ranks
    wearing a regional label — the exact defect this fixes.
    """

    return _PREVIEW_SQL_TEMPLATE.format(scope=scope_sql)

# Sequential custom rank of ONE ELIGIBLE candidate without ranking twice: 1 + the
# number of ELIGIBLE candidates that strictly outrank it (higher custom_score, or
# equal custom_score with a smaller candidate_key). Matches ``row_number`` exactly
# because Python and SQL round the score identically (banker's, 4 dp).
_CANDIDATE_RANK_SQL_TEMPLATE = f"""
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
      {{scope}}
),
scored AS (
    SELECT candidate_key, {_round_half_even_4("raw.raw_score")} AS cs FROM raw
)
SELECT count(*) + 1
FROM scored
WHERE cs > :this_score
   OR (cs = :this_score AND candidate_key < :this_key)
"""


def _candidate_rank_sql(scope_sql: str) -> str:
    """One candidate's custom rank, counted WITHIN the analysis scope.

    Same scope as the preview, applied in the same place, so the rank a candidate's
    detail reports is the rank its row shows in the ranking it came from.
    """

    return _CANDIDATE_RANK_SQL_TEMPLATE.format(scope=scope_sql)

# Custom MVT: recompute the ELIGIBLE ``score`` and REVIEW ``provisional_score`` on
# the geometries intersecting the tile only (filter-before-transform: the
# ``geometry &&`` predicate hits the 4326 GiST index, then only matched geometries
# are transformed for ST_AsMVTGeom). Same source-layer + property names as the
# stored tiles so the map reuses its fill/outline expressions. NO global ranking.
_TILE_SQL_TEMPLATE = f"""
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
      {{scope}}
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


def _tile_sql(scope_sql: str) -> str:
    """The custom-scenario MVT, restricted to the analysis scope.

    The map must show the SAME population the ranking beside it describes. Without
    this a 경기-scoped comparison drew 인천 cells the ranking had excluded, which is
    the map half of the same defect.
    """

    return _TILE_SQL_TEMPLATE.format(scope=scope_sql)


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #

_RUN_META_SQL = (
    "SELECT reference_year, policy_version, derivation_version, candidate_grid_version, "
    "component_model_version, component_order, "
    "weight_profiles, candidate_count_total, candidate_count_eligible, "
    "candidate_count_review, candidate_count_excluded "
    "FROM suitability_analysis_runs WHERE id = :id"
)

# Successor scenario creation is deliberately disabled. The recombination SQL below
# is defined over the historical four component columns, and a successor scenario
# would additionally need an approved successor weight vector and normalization
# strategy — neither of which exists (see
# ``analysis.suitability.successor.policy.ACTIVATION_BLOCKERS``). Refusing is the
# only honest answer: renormalizing over whichever components happen to be present,
# or scoring with an invented weight vector, would present a fabricated analytical
# result as a user's scenario.
COMPONENT_MODEL_SCENARIOS_UNAVAILABLE = "COMPONENT_MODEL_SCENARIOS_UNAVAILABLE"


def _validate_weights(
    raw: dict[str, str], component_order: Sequence[str]
) -> dict[str, Decimal]:
    """Validate + canonicalize against the RUN's components; error → structured 422.

    Weight validation is run-model-relative, not relative to a module constant, so a
    scenario saved against one component model cannot be recombined against a run of
    another. Well-formed weights for a different model surface as
    ``COMPONENT_MODEL_MISMATCH``; malformed weights stay
    ``INVALID_SCENARIO_WEIGHTS``. Neither is ever repaired, renormalized, or
    positionally remapped.
    """

    try:
        return scenario.parse_and_validate_weights(raw, component_order)
    except scenario.ScenarioWeightError as exc:
        raise HTTPException(status_code=422, detail=exc.as_envelope()) from exc


def _resolve_scenario_run(session: Session, run_id: int | None, requested_model: str | None) -> Any:
    """Resolve the run and return ``(run_id, run_meta, model_version, component_order)``.

    Deliberately does **not** refuse a run whose component model has no scenario
    contract. That refusal belongs after the weights have been validated against
    this run's components — see :func:`_assert_scenario_model_supported`.
    """

    resolved = _resolve_run_id(session, run_id, requested_model)
    run_meta = _load_run_meta(session, resolved)
    model_version, order = _run_model_identity(run_meta)
    return resolved, run_meta, model_version, order


def _assert_scenario_model_supported(resolved: int, model_version: str) -> None:
    """Refuse a run whose component model has no scenario contract yet.

    **Called after weight validation, not before.** The two refusals answer
    different questions and the more specific one has to win:

    * weights defined over *another* model's components → ``COMPONENT_MODEL_MISMATCH``.
      That is a statement about the caller's own artifact — a saved scenario that is
      still perfectly valid against a run of its own model — and the UI has to render
      it as "belongs to a different model", never as "unsupported".
    * weights that *do* match this run's components, on a model with no approved
      weight vector or normalization strategy → ``COMPONENT_MODEL_SCENARIOS_UNAVAILABLE``.

    Checking availability first collapsed both into the second answer and threw away
    the only signal that distinguishes them.
    """

    if model_version != component_model.COMPONENT_MODEL_HISTORICAL:
        raise HTTPException(
            status_code=422,
            detail={
                "error": COMPONENT_MODEL_SCENARIOS_UNAVAILABLE,
                "detail": (
                    f"User-weight scenarios are not available for component model "
                    f"{model_version!r}: no approved weight vector or normalization "
                    "strategy exists for it, so any recombination would be a "
                    "fabricated result rather than the user's scenario."
                ),
                "fields": {
                    "run_id": resolved,
                    "run_component_model_version": model_version,
                    "supported_component_model_version": (
                        component_model.COMPONENT_MODEL_HISTORICAL
                    ),
                },
            },
        )


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


def _component_decimals(row: Any, component_order: Sequence[str]) -> dict[str, Decimal]:
    """The present component scores as Decimals (missing components absent).

    Reads the run's own components in the run's own order. Only the historical
    model reaches here today — successor runs are refused before any weight is
    parsed — so the values come from the legacy columns; the accessor is used so
    the reader does not hard-code which storage owns them.
    """

    present: dict[str, Decimal] = {}
    for c in component_order:
        value = row[f"{c}_score"]
        if value is not None:
            present[c] = Decimal(str(value))
    return present


def _contributions(
    components: dict[str, Decimal],
    weights: dict[str, Decimal],
    canonical: dict[str, str],
    component_order: Sequence[str],
) -> list[ScenarioContribution]:
    """One contribution per component, in the RUN's component order.

    Order comes from the run rather than a module constant so a stored run's
    contribution sequence stays reproducible no matter which model the deployed
    code happens to implement.
    """

    out: list[ScenarioContribution] = []
    for c in component_order:
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
    run_model_version: str,
    run_component_order: list[str],
    scope_sql: str = "",
    scope_params: dict[str, Any] | None = None,
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
    components = _component_decimals(row, run_component_order)
    all_present = set(components) == set(run_component_order)

    custom_score: str | None = None
    custom_provisional: str | None = None
    custom_rank: int | None = None
    if status == policy.STATUS_ELIGIBLE and all_present:
        score_dec = scenario.scenario_score(components, weights)
        custom_score = format(score_dec, "f")
        # WITHIN THE SCOPE, not within the capital region: a detail opened from a
        # 경기-scoped ranking must report the rank that ranking showed.
        rank = session.execute(
            text(_candidate_rank_sql(scope_sql)),
            {
                "run_id": resolved_run,
                "this_score": score_dec,
                "this_key": row["candidate_key"],
                **_weight_params(weights),
                **(scope_params or {}),
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
        component_scores=component_model.component_scores_field(run_model_version, row),
        contributions=_contributions(components, weights, canonical, run_component_order),
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
        component_model_version=run_model_version,
        component_order=list(run_component_order),
        scenario_label=scenario.SCENARIO_LABEL_KO,
        scenario_disclaimer=scenario.SCENARIO_DISCLAIMER_KO,
        screening_disclaimer=SCREENING_DISCLAIMER,
    )


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.post("/preview", response_model=UserWeightScenarioPreviewOut)
def preview(session: SessionDep, req: UserWeightScenarioRequest) -> UserWeightScenarioPreviewOut:
    resolved, run_meta, run_model_version, run_component_order = _resolve_scenario_run(
        session, req.run_id, req.component_model_version
    )
    _ensure_profile_available(
        _json_field(run_meta["weight_profiles"], {}), req.compare_profile, resolved
    )

    weights = _validate_weights(req.weights, run_component_order)
    _assert_scenario_model_supported(resolved, run_model_version)
    canonical = scenario.canonical_weight_strings(weights, run_component_order)
    full_hash = scenario.scenario_hash(resolved, weights)

    # THE ANALYSIS SCOPE. Omitted → 수도권 전체, which is the query this endpoint has
    # always run. Given, the ranking, `ranking_population` and every rank below are
    # computed WITHIN that 범위, so an A/B comparison compares two weight vectors
    # over one fixed candidate universe rather than two different geographies.
    scope_sql, scope_params = _scope_predicate(req.sido, req.sigungu)

    rows = (
        session.execute(
            text(_preview_sql(scope_sql)),
            {
                "run_id": resolved,
                "profile": req.compare_profile,
                "top_n": req.top_n,
                **_weight_params(weights),
                **scope_params,
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
                component_scores=component_model.component_scores_field(run_model_version, r),
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
            run_model_version=run_model_version,
            run_component_order=run_component_order,
            # The SAME scope the ranking above used, so the embedded detail's
            # `custom_rank` matches the row the reader selected it from.
            scope_sql=scope_sql,
            scope_params=scope_params,
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
        component_model_version=run_model_version,
        component_order=list(run_component_order),
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
    resolved, run_meta, run_model_version, run_component_order = _resolve_scenario_run(
        session, req.run_id, req.component_model_version
    )
    _ensure_profile_available(
        _json_field(run_meta["weight_profiles"], {}), req.compare_profile, resolved
    )

    weights = _validate_weights(req.weights, run_component_order)
    _assert_scenario_model_supported(resolved, run_model_version)
    canonical = scenario.canonical_weight_strings(weights, run_component_order)
    full_hash = scenario.scenario_hash(resolved, weights)
    scope_sql, scope_params = _scope_predicate(req.sido, req.sigungu)
    return _build_candidate_detail(
        session,
        resolved_run=resolved,
        candidate_id=candidate_id,
        weights=weights,
        canonical=canonical,
        compare_profile=req.compare_profile,
        full_hash=full_hash,
        run_meta=run_meta,
        run_model_version=run_model_version,
        run_component_order=run_component_order,
        scope_sql=scope_sql,
        scope_params=scope_params,
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
    # The ANALYSIS SCOPE, so the map draws the same population the ranking beside it
    # describes. Both omitted → 수도권 전체, the tile this endpoint has always served.
    # They are part of the URL, so a scoped tile stays fully determined by its URL
    # and its ETag (which binds them below) can never serve one 범위's bytes for
    # another's.
    sido: str | None = Query(default=None),
    sigungu: list[str] | None = Query(default=None),
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
    # The run's component model is resolved before the weights are read, so a tile
    # request against a run this scenario contract does not cover is refused for the
    # right reason rather than failing later on a component the run does not have.
    # The wz/wr/we/wd parameter names are historical-model abbreviations and are
    # deliberately not extended to another model: 'we' would abbreviate the
    # successor's ``existing_burden`` just as naturally as it currently abbreviates
    # ``equity``, and a parameter name that can be reinterpreted is exactly how one
    # model's weight silently becomes another's.
    resolved, _run_meta, run_model_version, run_component_order = _resolve_scenario_run(
        session, run_id, None
    )
    weights = _validate_weights(
        {"zoning": wz, "road": wr, "equity": we, "demand": wd}, run_component_order
    )
    _assert_scenario_model_supported(resolved, run_model_version)
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

    # ETag binds run + canonical weights (via the hash prefix) + z/x/y; the URL
    # fully determines the bytes. Bounded one-day browser cache (a temporary
    # experiment, not a stored immutable official profile).
    scope_sql, scope_params = _scope_predicate(sido, sigungu)
    # The scope is IN the ETag: two tiles that differ only by 범위 are different
    # bytes, so a cached 수도권 전체 tile can never be replayed for a 경기 request.
    # `sorted` over the bound VALUES makes the key order-independent, matching the
    # query, which de-duplicates and does not care about the order codes arrived in.
    scope_key = "all" if not scope_params else "-".join(sorted(map(str, scope_params.values())))
    etag = (
        f'"suitscn-{resolved}-{scenario.short_scenario_hash(expected_hash)}'
        f'-{scope_key}-{z}-{x}-{y}"'
    )
    cache_headers = {"Cache-Control": SCENARIO_TILE_CACHE_CONTROL, "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=cache_headers)

    raw = session.execute(
        text(_tile_sql(scope_sql)),
        {
            "run_id": resolved,
            "z": z,
            "x": x,
            "y": y,
            **_weight_params(weights),
            **scope_params,
        },
    ).scalar()
    body = bytes(raw) if raw is not None else b""
    return Response(content=body, media_type=MVT_CONTENT_TYPE, headers=cache_headers)
