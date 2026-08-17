"""Read-only suitability screening API (Phase 5.4).

Serves stored suitability analysis runs and candidate scores with full provenance
and an analytical-screening disclaimer. No value is computed on read beyond
selecting a stored weight profile's total/rank; nothing is fabricated. Unknown
run/candidate -> structured 404; invalid bbox/profile/status -> 422; a row missing
required provenance fails visibly (500). No legal-eligibility boolean is emitted.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...analysis.suitability import component_model, policy
from ...db import get_session
from ...schemas import (
    CandidateDetailOut,
    CandidateFeature,
    CandidateProperties,
    SuitabilityCandidateCollection,
    SuitabilityPolicyOut,
    SuitabilityRunListEnvelope,
    SuitabilityRunOut,
    SuitabilitySummaryOut,
)
from ...schemas.suitability import SCREENING_DISCLAIMER

router = APIRouter(prefix="/api/v1/suitability", tags=["suitability"])
SessionDep = Annotated[Session, Depends(get_session)]

Profile = Literal["baseline", "equal", "equity_focused", "access_focused", "critic"]
Status = Literal["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"]
StabilityClass = Literal["STABLE", "CONDITIONALLY_STABLE", "WEIGHT_SENSITIVE"]
# Ranking direction over the *stored* score of the selected weight profile. This is
# a direction, not a sort-field selector: no other column is orderable, so no caller
# can reorder the screening by anything the methodology did not rank on.
CandidateSort = Literal["score_desc", "score_asc"]
DEFAULT_CANDIDATE_SORT: CandidateSort = "score_desc"

# --- Region code space -------------------------------------------------------
# ``suitability_candidates.sido_region_code`` / ``sigungu_region_code`` are copied
# verbatim from ``regions.region_code`` by the engine's centroid assignment, and
# ``regions.region_code`` is derived as ``KR-SGIS-{adm_cd}`` (see
# docs/REGION_CODE_STRATEGY.md). So the stored values are, exactly:
#
#   SIDO    KR-SGIS-11 서울 / KR-SGIS-23 인천 / KR-SGIS-31 경기
#   SIGUNGU KR-SGIS-<5 digits>, e.g. KR-SGIS-11010 종로구, KR-SGIS-31011 수원시 장안구
#
# SGIS numbers SIGUNGU with its own sequence, NOT 행정표준코드: 종로구 is 11010 here,
# and 11110 is 노원구. Read these codes from the data; never derive them.
#
# Two neighbouring code spaces are NOT what is stored here and must never be sent:
#   * the landfill/MOIS administrative sido space 11 / 28 / 41 (Incheon and Gyeonggi
#     differ from SGIS), and
#   * the frontend ``ScopeSelection`` space, which is the bare 2-digit SGIS code
#     "11" / "23" / "31".
# Because the canonical code is a pure prefix of the source code, the bare SGIS form
# is unambiguous and is accepted as an alias: it is normalized to the canonical form
# below. Nothing else is rewritten — a code from the wrong space (e.g. sido=28)
# normalizes to a canonical code that simply does not exist, and therefore matches
# no rows rather than silently returning a different region's candidates.
_CANONICAL_REGION_PREFIX = "KR-SGIS-"


def _distinct_region_codes(values: list[str] | None) -> list[str]:
    """Normalize, drop blanks, and de-duplicate a repeated region-code parameter.

    Order-preserving de-duplication keeps the emitted SQL stable for a given request
    so an identical query always produces an identical plan and page.
    """

    if not values:
        return []
    seen: dict[str, None] = {}
    for raw in values:
        if not raw or not raw.strip():
            continue
        seen.setdefault(_canonical_region_code(raw), None)
    return list(seen)


def _canonical_region_code(value: str) -> str:
    """Accept either the canonical ``KR-SGIS-<adm_cd>`` code or the bare ``<adm_cd>``.

    Only a purely numeric value is treated as a bare SGIS code; every other value is
    passed through untouched so an unrecognized code stays unrecognized (and matches
    nothing) instead of being coerced into something that looks valid.
    """

    stripped = value.strip()
    if stripped.isdigit():
        return f"{_CANONICAL_REGION_PREFIX}{stripped}"
    return stripped


# Static profiles are policy constants available for every run; the data-derived
# ``critic`` profile is only available for runs that actually computed it.
_STATIC_PROFILE_NAMES = frozenset(policy.STATIC_WEIGHT_PROFILES)


def _ensure_profile_available(run_weight_profiles: Any, profile: str, run_id: int) -> None:
    """Reject a data-derived profile the selected run does not carry (structured 4xx).

    Static profiles are always available. ``critic`` requires the run's stored
    ``weight_profiles`` to include it, so an old run without CRITIC data returns a
    clear PROFILE_NOT_AVAILABLE_FOR_RUN rather than a KeyError or a fabricated value.
    """

    if profile in _STATIC_PROFILE_NAMES:
        return
    if isinstance(run_weight_profiles, dict) and profile in run_weight_profiles:
        return
    raise HTTPException(
        status_code=400,
        detail={
            "error": "PROFILE_NOT_AVAILABLE_FOR_RUN",
            "detail": f"Profile {profile} is not available for suitability run {run_id}.",
        },
    )


# --- Vector-tile (MVT) constants ---------------------------------------------
# The map serves the *complete* suitability grid as Mapbox Vector Tiles generated
# by PostGIS, so the viewport transfers only the tiles it needs instead of a
# limited GeoJSON slice (which previously capped the map at 2,000 of ~48k cells).
MVT_CONTENT_TYPE = "application/vnd.mapbox-vector-tile"
# Web-Mercator tile pyramid: z 0..22 is the standard safe range (2^22 tiles/side).
MVT_MIN_ZOOM = 0
MVT_MAX_ZOOM = 22
# Vector-tile source-layer name the frontend binds its candidate layers to.
TILE_SOURCE_LAYER = "candidates"
# The URL embeds an immutable analysis run + weight profile, so a served tile
# never changes; cache it aggressively (one year, immutable).
TILE_CACHE_CONTROL = "public, max-age=31536000, immutable"

# Parameterized MVT query. The tile envelope is built in EPSG:3857
# (``ST_TileEnvelope``) and transformed to EPSG:4326 for the candidate filter, so
# the ``geometry && <bounds>`` predicate hits the existing 4326 GiST index and
# only the *matched* geometries are transformed to 3857 for ``ST_AsMVTGeom``
# (filter-before-transform). Scoring mirrors the read API exactly: a final
# ``score`` is emitted only for ELIGIBLE cells, a ``provisional_score`` only for
# REVIEW_REQUIRED cells, and ``rank`` is the selected profile's stored rank.
# Every user-controlled value (run, profile, z, x, y) is a bound parameter.
def _tile_sql(component_model_version: str) -> str:
    """The MVT query for a run of this component model.

    Everything except the component properties is identical across models. For the
    historical model the component fragment is the four legacy columns under their
    existing property names, so a historical tile is **byte-identical** to what the
    map already caches; any other model expands its ``component_scores`` map into
    properties named after its own components, so a legacy property name can never
    carry a successor meaning.

    Safe to vary per run: the tile URL already embeds an immutable run, and a run
    belongs to exactly one component model, so cache semantics are unchanged. The
    map styles only on ``score`` / ``status`` / ``stable_count`` /
    ``sigungu_region_code``, never on a component score, so component properties are
    inspection payload and adding model-specific ones cannot change rendering.
    """

    return f"""
WITH tile AS (
    SELECT
        ST_AsMVTGeom(
            ST_Transform(c.geometry, 3857),
            ST_TileEnvelope(:z, :x, :y),
            4096, 64, true
        ) AS geom,
        c.id AS candidate_id,
        c.candidate_key AS candidate_key,
        c.status AS status,
        (c.profile_ranks ->> :profile)::int AS rank,
        CASE WHEN c.status = 'ELIGIBLE'
             THEN (c.profile_totals ->> :profile)::double precision END AS score,
        CASE WHEN c.status = 'REVIEW_REQUIRED'
             THEN (c.profile_totals ->> :profile)::double precision END AS provisional_score,
{component_model.tile_component_columns_sql(component_model_version)},
        c.stable_count AS stable_count,
        c.stability_class AS stability_class,
        c.sigungu_region_code AS sigungu_region_code,
        c.sigungu_region_name AS sigungu_region_name
    FROM suitability_candidates c
    WHERE c.analysis_run_id = :run_id
      AND c.geometry && ST_Transform(ST_TileEnvelope(:z, :x, :y), 4326)
)
SELECT ST_AsMVT(tile.*, '{TILE_SOURCE_LAYER}', 4096, 'geom')
FROM tile
WHERE tile.geom IS NOT NULL
"""


# The historical tile query, kept as a module constant so its byte-identity with the
# pre-component-model contract is pinned by test.
_TILE_SQL = _tile_sql(component_model.COMPONENT_MODEL_HISTORICAL)

ASSUMPTIONS = [
    "Regional 500 m screening grid (EPSG:5179 origin); not parcel-level.",
    "Zoning is top-level 용도지역 only; no residential/industrial subclass, so urban land "
    "is REVIEW_REQUIRED and no industrial high-compatibility score exists in v1.",
    "OFFICIAL_SOURCE_UNAVAILABLE hard-layer coverage -> REVIEW_REQUIRED (never a confirmed clear).",
    "Equity reuses facility-burden-v1 (FACILITY_LOCATION_BASED_THROUGHPUT); demand reuses "
    "per-capita-v1 (ORIGIN_BASED_TREATMENT_OUTCOME); only normalized scores combine.",
    "Road distance is an access proxy, not proof of truck accessibility.",
]


def _not_found(error: str, detail: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"error": error, "detail": detail})


# --- Component-model awareness ------------------------------------------------
# Every run-scoped response reports the *stored run's own* component model, never
# the running code's constants. An optional ``component_model`` selector lets a
# caller scope a request to one model explicitly; omitting it preserves today's
# behaviour exactly (see component_model.DEFAULT_COMPONENT_MODEL).

ComponentModelQuery = Annotated[
    str | None,
    Query(
        description=(
            "Component-model selector. Omit for the default model, which preserves "
            "existing behaviour. When a run_id is also given, the run must belong to "
            "this model or the request fails with COMPONENT_MODEL_MISMATCH."
        )
    ),
]


def _component_model_error(exc: Exception) -> HTTPException:
    """Map a component-model domain error to its structured 422 envelope."""

    envelope = exc.as_envelope()  # type: ignore[attr-defined]
    return HTTPException(status_code=422, detail=envelope)


def _run_model_identity(row: Any) -> tuple[str, list[str]]:
    """The stored run's validated ``(component_model_version, component_order)``.

    A stored row whose identity is internally inconsistent — an unknown model, or a
    component order that is not that model's — is a data-integrity failure, not a
    caller error, and fails visibly (500) rather than being served under whatever
    label happens to look plausible. This is the same discipline the route already
    applies to a candidate row with no geometry.
    """

    try:
        return component_model.run_model_identity(row)
    except (
        component_model.UnknownComponentModelError,
        component_model.ComponentModelMismatchError,
    ) as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "error": component_model.COMPONENT_MODEL_INCONSISTENT_RUN,
                "detail": exc.detail,
                "fields": exc.fields,
            },
        ) from exc


def _resolve_run_id(
    session: Session, run_id: int | None, requested_model: str | None = None
) -> int:
    """Resolve the run a request applies to, scoped by component model.

    An explicitly pinned ``run_id`` resolves to that run whatever model it belongs
    to, so any stored run stays inspectable; naming a ``component_model`` as well
    asserts which model the caller believes it is, and a disagreement is refused
    rather than silently served.

    An **unpinned** request resolves to the latest succeeded run *of one component
    model* — by default the historical one. Before this scoping existed the query
    took the latest succeeded run regardless of model, so the first successful run
    of a second model would silently redefine every default view and every un-pinned
    shared link. Scoping keeps today's answer identical while making the switchover
    an explicit, reviewable decision rather than a consequence of ORDER BY.
    """

    if run_id is not None:
        found = (
            session.execute(
                text(
                    "SELECT id, component_model_version FROM suitability_analysis_runs "
                    "WHERE id = :id AND status = 'SUCCEEDED'"
                ),
                {"id": run_id},
            )
            .mappings()
            .first()
        )
        if found is None:
            raise _not_found("RUN_NOT_FOUND", f"No succeeded suitability run with id {run_id}.")
        if requested_model is not None:
            try:
                requested = component_model.resolve_requested_component_model(requested_model)
            except component_model.UnknownComponentModelError as exc:
                raise _component_model_error(exc) from exc
            if found["component_model_version"] != requested:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": component_model.COMPONENT_MODEL_MISMATCH,
                        "detail": (
                            f"Suitability run {run_id} was produced by component model "
                            f"{found['component_model_version']!r}, not the requested "
                            f"{requested!r}."
                        ),
                        "fields": {
                            "run_id": run_id,
                            "run_component_model_version": found["component_model_version"],
                            "requested_component_model_version": requested,
                        },
                    },
                )
        return int(found["id"])
    try:
        model = component_model.resolve_requested_component_model(requested_model)
    except component_model.UnknownComponentModelError as exc:
        raise _component_model_error(exc) from exc
    latest = session.execute(
        text(
            "SELECT id FROM suitability_analysis_runs WHERE status = 'SUCCEEDED' "
            "AND component_model_version = :component_model "
            "ORDER BY completed_at DESC NULLS LAST, id DESC LIMIT 1"
        ),
        {"component_model": model},
    ).scalar()
    if latest is None:
        raise _not_found(
            "NO_ANALYSIS_AVAILABLE",
            f"No succeeded suitability analysis run exists for component model {model}.",
        )
    return int(latest)


def _integrity_error(exc: Any, run_id: int | None = None) -> HTTPException:
    """A stored run whose model-scoped artifacts disagree fails visibly (500).

    This is not a caller error and must never be repaired on read: quietly serving a
    CRITIC vector or stability definition derived over one component matrix beside
    scores computed over another would present one model's finding as another's,
    which is exactly what the model boundary exists to prevent.
    """

    fields = dict(exc.fields)
    if run_id is not None:
        fields.setdefault("run_id", run_id)
    return HTTPException(
        status_code=500,
        detail={
            "error": component_model.COMPONENT_MODEL_INCONSISTENT_RUN,
            "detail": exc.detail,
            "fields": fields,
        },
    )


def _assert_run_weight_vector(model_version: str, weights: Any, context: str) -> None:
    """Refuse to serve a weight vector whose components are not the run's."""

    try:
        component_model.assert_weight_vector_matches_model(
            model_version, weights, context=context
        )
    except component_model.ComponentModelMismatchError as exc:
        raise _integrity_error(exc) from exc


def _assert_static_profile_fallback_allowed(model_version: str, run_id: int) -> None:
    """Refuse the ``policy.STATIC_WEIGHT_PROFILES`` fallback for a foreign model.

    The fallback exists for pre-CRITIC runs whose ``weight_profiles`` were never
    populated — historical runs of the model the policy module implements. For a run
    of any other component model there is no stored vector and no policy constant
    that describes its components, and inventing one would attach a weighting
    justified for one set of quantities to a different set.
    """

    if model_version != component_model.COMPONENT_MODEL_HISTORICAL:
        raise _integrity_error(
            component_model.ComponentModelMismatchError(
                f"Run {run_id} was produced by component model {model_version!r} but "
                "stores no weight vector; the historical policy profiles cannot stand "
                "in for it.",
                {"run_component_model_version": model_version},
            ),
            run_id,
        )


def _assert_stability_definition_model(
    model_version: str, stability_definition: Any, run_id: int
) -> None:
    """Refuse a stability definition that describes a different component model.

    A stability class is top-fraction membership across ranks computed from a
    particular component vector, so a definition stamped with another model's
    identity cannot describe this run's classifications. Definitions written before
    the stamp existed carry no identity and are accepted unchanged — an unstamped
    historical definition is not a mismatch, it is a definition from before the
    field was added.
    """

    stamped = (
        stability_definition.get("component_model_version")
        if isinstance(stability_definition, dict)
        else None
    )
    if stamped is not None and stamped != model_version:
        raise _integrity_error(
            component_model.ComponentModelMismatchError(
                f"Run {run_id} stability definition describes component model "
                f"{stamped!r}, but the run was produced by {model_version!r}.",
                {
                    "stability_component_model_version": stamped,
                    "run_component_model": model_version,
                },
            ),
            run_id,
        )


# Component-score columns every summary top-candidate query selects. Both storage
# representations are selected unconditionally and the *run's* model decides which
# one is authoritative — selecting one extra always-empty column is cheaper than
# branching the SQL, and it keeps the historical query text otherwise unchanged.
_SUMMARY_SCORE_COLUMNS = (
    "zoning_score, road_score, equity_score, demand_score, component_scores"
)


def _summary_candidate(row: Any, model_version: str) -> dict[str, Any]:
    """One summary top-candidate entry, in this run's component-model shape.

    Legacy keys are populated for a historical run and explicitly ``None`` for any
    other model; ``component_scores`` is the mirror image. Neither is ever derived
    from the other.
    """

    entry: dict[str, Any] = {
        "rank": row["rank"],
        "candidate_id": row["id"],
        "candidate_key": row["candidate_key"],
        "sigungu": row["sigungu_region_name"],
        "total_score": row["total"],
        "stable_count": row["stable_count"],
        "stability_class": row["stability_class"],
        "stability_membership": row["stability_membership"] or {},
    }
    entry.update(component_model.legacy_score_fields(model_version, row))
    entry["component_scores"] = component_model.component_scores_field(model_version, row)
    entry["centroid_lon"] = (
        round(row["centroid_lon"], 6) if row["centroid_lon"] is not None else None
    )
    entry["centroid_lat"] = (
        round(row["centroid_lat"], 6) if row["centroid_lat"] is not None else None
    )
    return entry


def _json_field(value: Any, empty: Any) -> Any:
    """A run row's JSON column, decoded consistently across dialects.

    These are read through ``text()``, which carries no type information: psycopg
    hands back decoded ``jsonb`` on PostgreSQL, while the generic ``JSON`` variant
    on SQLite comes back as raw text. Decoding here keeps the response identical on
    both supported test tiers rather than only on the production dialect.
    """

    decoded = component_model.decode_json_value(value)
    return empty if decoded is None else decoded


def _run_out(row: Any) -> SuitabilityRunOut:
    model_version, order = _run_model_identity(row)
    return SuitabilityRunOut(
        id=row["id"],
        derivation_version=row["derivation_version"],
        policy_version=row["policy_version"],
        candidate_grid_version=row["candidate_grid_version"],
        component_model_version=model_version,
        component_order=order,
        reference_year=row["reference_year"],
        boundary_vintage=row["boundary_vintage"],
        weight_profile=row["weight_profile"],
        analysis_signature=row["analysis_signature"],
        status=row["status"],
        candidate_count_total=row["candidate_count_total"],
        candidate_count_eligible=row["candidate_count_eligible"],
        candidate_count_review=row["candidate_count_review"],
        candidate_count_excluded=row["candidate_count_excluded"],
        input_dataset_version_ids=_json_field(row["input_dataset_version_ids"], []),
        input_provenance=_json_field(row["input_provenance"], {}),
        weight_profiles=_json_field(row["weight_profiles"], {}),
        weight_derivation=_json_field(row["weight_derivation"], {}),
        stability_definition=_json_field(row["stability_definition"], {}),
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        created_at=row["created_at"],
    )


_RUN_COLUMNS = (
    "id, derivation_version, policy_version, candidate_grid_version, "
    "component_model_version, component_order, reference_year, "
    "boundary_vintage, weight_profile, analysis_signature, status, candidate_count_total, "
    "candidate_count_eligible, candidate_count_review, candidate_count_excluded, "
    "input_dataset_version_ids, input_provenance, weight_profiles, weight_derivation, "
    "stability_definition, started_at, completed_at, created_at"
)


@router.get("/policies", response_model=SuitabilityPolicyOut)
def get_policy() -> SuitabilityPolicyOut:
    snap = policy.policy_snapshot()
    return SuitabilityPolicyOut(
        policy_version=snap["policy_version"],
        derivation_version=snap["derivation_version"],
        candidate_grid_version=snap["candidate_grid_version"],
        critic_method_version=snap["critic_method_version"],
        stability_method_version=snap["stability_method_version"],
        # /policies describes the currently implemented policy, not a stored run, so
        # unlike every run-scoped endpoint these ARE the module's own constants.
        component_model_version=component_model.COMPONENT_MODEL_HISTORICAL,
        component_order=list(component_model.COMPONENT_ORDER_HISTORICAL),
        statuses=[policy.STATUS_ELIGIBLE, policy.STATUS_REVIEW, policy.STATUS_EXCLUDED],
        weight_profiles=snap["weight_profiles"],
        static_weight_profiles=snap["static_weight_profiles"],
        data_derived_profiles=snap["data_derived_profiles"],
        supported_profiles=snap["supported_profiles"],
        stability_profiles=snap["stability_profiles"],
        stability_top_fraction=snap["stability_top_fraction"],
        profile_methodology=snap["profile_methodology"],
        default_profile=snap["default_profile"],
        weight_rationale=snap["weight_rationale"],
        hard_exclusion_codes=snap["hard_exclusion_codes"],
        review_codes=snap["review_codes"],
        zoning_registry=snap["zoning_registry"],
        road_distance_curve=snap["road_distance_curve"],
        grid=snap["grid"],
        disclaimer=snap["disclaimer"],
    )


@router.get("/runs", response_model=SuitabilityRunListEnvelope)
def list_runs(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=500),
    component_model_version: ComponentModelQuery = None,
) -> SuitabilityRunListEnvelope:
    """List stored runs, each labelled with its OWN component model.

    Unfiltered by default, so a mixed-model list is visible rather than hidden —
    the run list is exactly where two coexisting models should be apparent. The
    optional filter scopes it to one model.
    """

    params: dict[str, Any] = {"limit": limit}
    where = ""
    if component_model_version is not None:
        try:
            params["component_model"] = component_model.resolve_requested_component_model(
                component_model_version
            )
        except component_model.UnknownComponentModelError as exc:
            raise _component_model_error(exc) from exc
        where = "WHERE component_model_version = :component_model "
    rows = (
        session.execute(
            text(
                f"SELECT {_RUN_COLUMNS} FROM suitability_analysis_runs "
                f"{where}ORDER BY id DESC LIMIT :limit"
            ),
            params,
        )
        .mappings()
        .all()
    )
    return SuitabilityRunListEnvelope(count=len(rows), runs=[_run_out(r) for r in rows])


@router.get("/runs/latest", response_model=SuitabilityRunOut)
def latest_run(
    session: SessionDep, component_model_version: ComponentModelQuery = None
) -> SuitabilityRunOut:
    run_id = _resolve_run_id(session, None, component_model_version)
    row = (
        session.execute(
            text(f"SELECT {_RUN_COLUMNS} FROM suitability_analysis_runs WHERE id = :id"),
            {"id": run_id},
        )
        .mappings()
        .first()
    )
    assert row is not None
    return _run_out(row)


@router.get("/summary", response_model=SuitabilitySummaryOut)
def summary(
    session: SessionDep,
    run_id: int | None = None,
    profile: Profile = "baseline",
    component_model_version: ComponentModelQuery = None,
) -> SuitabilitySummaryOut:
    resolved = _resolve_run_id(session, run_id, component_model_version)
    run = (
        session.execute(
            text(f"SELECT {_RUN_COLUMNS} FROM suitability_analysis_runs WHERE id = :id"),
            {"id": resolved},
        )
        .mappings()
        .first()
    )
    assert run is not None
    run_model_version, run_component_order = _run_model_identity(run)
    run_weight_profiles = _json_field(run["weight_profiles"], {})
    _ensure_profile_available(run_weight_profiles, profile, resolved)

    exclusion_counts: dict[str, int] = {}
    review_counts: dict[str, int] = {}
    for r in session.execute(
        text(
            "SELECT reason, count(*) AS c FROM suitability_candidates, "
            "jsonb_array_elements_text(exclusion_reasons) AS reason "
            "WHERE analysis_run_id = :id GROUP BY reason ORDER BY c DESC"
        ),
        {"id": resolved},
    ).mappings():
        exclusion_counts[r["reason"]] = r["c"]
    for r in session.execute(
        text(
            "SELECT reason, count(*) AS c FROM suitability_candidates, "
            "jsonb_array_elements_text(review_reasons) AS reason "
            "WHERE analysis_run_id = :id GROUP BY reason ORDER BY c DESC"
        ),
        {"id": resolved},
    ).mappings():
        review_counts[r["reason"]] = r["c"]

    sido_distribution: dict[str, dict[str, int]] = {}
    for r in session.execute(
        text(
            "SELECT coalesce(sido_region_name, 'UNKNOWN') AS sido, status, count(*) AS c "
            "FROM suitability_candidates WHERE analysis_run_id = :id "
            "GROUP BY 1, 2 ORDER BY 1, 2"
        ),
        {"id": resolved},
    ).mappings():
        sido_distribution.setdefault(r["sido"], {})[r["status"]] = r["c"]

    # Distinct grid cells can carry legitimately tied scores (e.g. rural SIGUNGU with
    # uniform zoning/road/equity). The centroid lets the UI give each tied cell a
    # concrete location distinction and move the map to it, without deduplicating or
    # altering any score.
    top = [
        _summary_candidate(r, run_model_version)
        for r in session.execute(
            text(
                f"SELECT id, candidate_key, sigungu_region_name, {_SUMMARY_SCORE_COLUMNS}, "
                "stable_count, stability_class, stability_membership, "
                "ST_X(centroid) AS centroid_lon, ST_Y(centroid) AS centroid_lat, "
                "(profile_ranks->>:profile)::int AS rank, profile_totals->>:profile AS total "
                "FROM suitability_candidates "
                "WHERE analysis_run_id = :id AND status = 'ELIGIBLE' "
                "AND (profile_ranks->>:profile) IS NOT NULL "
                "ORDER BY (profile_ranks->>:profile)::int ASC LIMIT 10"
            ),
            {"id": resolved, "profile": profile},
        ).mappings()
    ]

    coverage_notes = [
        f"{reason}: {count}"
        for reason, count in review_counts.items()
        if reason.startswith("COVERAGE_GAP_")
        or reason in ("MISSING_DEMAND_COMPONENT", "MISSING_EQUITY_COMPONENT")
    ]

    # --- Weight-sensitivity stability -------------------------------------------
    stability_definition = run["stability_definition"] or {}
    stability_available = bool(stability_definition)
    stability_counts: dict[str, int] = {}
    for r in session.execute(
        text(
            "SELECT stability_class, count(*) AS c FROM suitability_candidates "
            "WHERE analysis_run_id = :id AND stability_class IS NOT NULL "
            "GROUP BY stability_class"
        ),
        {"id": resolved},
    ).mappings():
        stability_counts[r["stability_class"]] = r["c"]

    # Top stable candidates: ELIGIBLE and classified STABLE, ordered by rank then
    # candidate_key (deterministic tie-break).
    #
    # Two things here are component-model-aware rather than hardcoded to the
    # historical shape:
    #
    # * **STABLE is tested by class, not by count.** ``stable_count = 3`` was the
    #   historical definition; the successor model derives its class from 4
    #   perturbations, so a count test silently excluded every genuinely stable
    #   successor candidate. The class means the same thing in both models.
    # * **Rank comes from the model's own storage.** Historical runs rank per weight
    #   profile in ``profile_ranks``; a successor run has one approved profile and
    #   stores its rank in the ``rank`` column, leaving ``profile_ranks`` empty. The
    #   historical branch is kept byte-identical so no stored historical answer
    #   moves.
    if component_model.uses_legacy_score_columns(run_model_version):
        top_stable_sql = (
            f"SELECT id, candidate_key, sigungu_region_name, {_SUMMARY_SCORE_COLUMNS}, "
            "stable_count, stability_class, stability_membership, "
            "ST_X(centroid) AS centroid_lon, ST_Y(centroid) AS centroid_lat, "
            "(profile_ranks->>:profile)::int AS rank, profile_totals->>:profile AS total "
            "FROM suitability_candidates "
            "WHERE analysis_run_id = :id AND status = 'ELIGIBLE' "
            "AND stability_class = 'STABLE' "
            "AND (profile_ranks->>:profile) IS NOT NULL "
            "ORDER BY (profile_ranks->>:profile)::int ASC, candidate_key ASC LIMIT 10"
        )
    else:
        top_stable_sql = (
            f"SELECT id, candidate_key, sigungu_region_name, {_SUMMARY_SCORE_COLUMNS}, "
            "stable_count, stability_class, stability_membership, "
            "ST_X(centroid) AS centroid_lon, ST_Y(centroid) AS centroid_lat, "
            "rank AS rank, total_score::text AS total "
            "FROM suitability_candidates "
            "WHERE analysis_run_id = :id AND status = 'ELIGIBLE' "
            "AND stability_class = 'STABLE' AND rank IS NOT NULL "
            "ORDER BY rank ASC, candidate_key ASC LIMIT 10"
        )
    top_stable = [
        _summary_candidate(r, run_model_version)
        for r in session.execute(
            text(top_stable_sql), {"id": resolved, "profile": profile}
        ).mappings()
    ]

    critic_weights_raw = run_weight_profiles.get("critic")
    critic_weights = (
        {c: str(v) for c, v in critic_weights_raw.items()}
        if isinstance(critic_weights_raw, dict)
        else None
    )
    if critic_weights is not None:
        # A CRITIC vector describes the variance and correlation of *this run's*
        # criteria. Serving one whose components are not this run's components would
        # present one component model's data-derived weighting as another's.
        _assert_run_weight_vector(
            run_model_version, critic_weights, f"run {resolved} CRITIC weights"
        )
    if stability_available:
        _assert_stability_definition_model(run_model_version, stability_definition, resolved)

    return SuitabilitySummaryOut(
        run_id=resolved,
        reference_year=run["reference_year"],
        policy_version=run["policy_version"],
        derivation_version=run["derivation_version"],
        candidate_grid_version=run["candidate_grid_version"],
        component_model_version=run_model_version,
        component_order=run_component_order,
        weight_profile=profile,
        candidate_count_total=run["candidate_count_total"],
        candidate_count_eligible=run["candidate_count_eligible"],
        candidate_count_review=run["candidate_count_review"],
        candidate_count_excluded=run["candidate_count_excluded"],
        exclusion_reason_counts=exclusion_counts,
        review_reason_counts=review_counts,
        sido_distribution=sido_distribution,
        top_candidates=top,
        critic_weights=critic_weights,
        stability_top_fraction=(
            stability_definition.get("top_fraction") if stability_available else None
        ),
        stability_top_cutoff_rank=(
            stability_definition.get("top_cutoff_rank") if stability_available else None
        ),
        candidate_count_stable=stability_counts.get("STABLE", 0),
        candidate_count_conditionally_stable=stability_counts.get("CONDITIONALLY_STABLE", 0),
        candidate_count_weight_sensitive=stability_counts.get("WEIGHT_SENSITIVE", 0),
        top_stable_candidates=top_stable,
        stability_definition=stability_definition,
        stability_available=stability_available,
        coverage_notes=coverage_notes,
        assumptions=ASSUMPTIONS,
        disclaimer=SCREENING_DISCLAIMER,
    )


def _parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    if bbox is None:
        return None
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_BBOX", "detail": "bbox must be minLon,minLat,maxLon,maxLat"},
        )
    try:
        min_lon, min_lat, max_lon, max_lat = (float(p) for p in parts)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_BBOX", "detail": "bbox values must be numbers"},
        ) from exc
    if min_lon >= max_lon or min_lat >= max_lat:
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_BBOX", "detail": "bbox min must be less than max"},
        )
    return (min_lon, min_lat, max_lon, max_lat)


@router.get("/candidates", response_model=SuitabilityCandidateCollection)
def list_candidates(
    session: SessionDep,
    run_id: int | None = None,
    profile: Profile = "baseline",
    bbox: str | None = None,
    sido: Annotated[
        str | None,
        Query(
            description=(
                "SIDO scope. Canonical KR-SGIS-11 / KR-SGIS-23 / KR-SGIS-31; the bare "
                "SGIS form 11 / 23 / 31 is accepted and normalized."
            )
        ),
    ] = None,
    sigungu: Annotated[
        list[str] | None,
        Query(
            description=(
                "SIGUNGU scope, repeatable (sigungu=A&sigungu=B). Multiple values are "
                "OR-ed. Canonical KR-SGIS-<5 digits>; the bare 5-digit SGIS form is "
                "accepted and normalized. Omit for no SIGUNGU restriction."
            )
        ),
    ] = None,
    status: Status | None = None,
    stability_class: StabilityClass | None = None,
    min_score: float | None = Query(default=None, ge=0, le=100),
    max_score: float | None = Query(default=None, ge=0, le=100),
    top: int | None = Query(default=None, ge=1, le=5000),
    limit: int = Query(default=500, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    sort: Annotated[
        CandidateSort,
        Query(
            description=(
                "Ranking direction over the selected profile's stored score. "
                "score_desc (default) is highest-score-first, i.e. rank 1 first; "
                "score_asc is lowest-scored-first. Candidates with no score for the "
                "profile stay last in both directions."
            )
        ),
    ] = DEFAULT_CANDIDATE_SORT,
    component_model_version: ComponentModelQuery = None,
) -> SuitabilityCandidateCollection:
    resolved = _resolve_run_id(session, run_id, component_model_version)
    run = (
        session.execute(
            text(
                # The run's OWN version identity is selected here and echoed below.
                # Reporting the running code's module constants instead would label a
                # stored run with whatever version the server happens to be on — an
                # active mislabeling of a historical run as soon as two model versions
                # coexist. Every sibling endpoint (/summary, /candidates/{id}, /runs)
                # already reads these from the run row; this one now matches.
                "SELECT reference_year, weight_profiles, policy_version, "
                "derivation_version, candidate_grid_version, "
                "component_model_version, component_order "
                "FROM suitability_analysis_runs WHERE id = :id"
            ),
            {"id": resolved},
        )
        .mappings()
        .first()
    )
    assert run is not None
    run_model_version, run_component_order = _run_model_identity(run)
    _ensure_profile_available(_json_field(run["weight_profiles"], {}), profile, resolved)
    box = _parse_bbox(bbox)

    conditions = ["analysis_run_id = :id"]
    params: dict[str, Any] = {"id": resolved, "profile": profile}
    if box is not None:
        # Viewport filter: bounding-box overlap (index-only GiST, no per-row exact
        # recheck) — the right, fast predicate for "cells in view". Exact geometry
        # intersection would recheck tens of thousands of polygons for a
        # region-wide envelope.
        conditions.append("geometry && ST_MakeEnvelope(:x1,:y1,:x2,:y2,4326)")
        params.update({"x1": box[0], "y1": box[1], "x2": box[2], "y2": box[3]})
    if sido is not None:
        conditions.append("sido_region_code = :sido")
        params["sido"] = _canonical_region_code(sido)
    # Repeatable SIGUNGU scope. Zero values (parameter absent, or present only as
    # empty strings) means *no* SIGUNGU restriction — never "match nothing", so a
    # cleared multi-select in the UI cannot silently blank the ranking. Duplicates
    # are collapsed, so repeating a code cannot change the result set or the count.
    sigungu_codes = _distinct_region_codes(sigungu)
    if sigungu_codes:
        placeholders = ", ".join(f":sigungu_{i}" for i in range(len(sigungu_codes)))
        conditions.append(f"sigungu_region_code IN ({placeholders})")
        params.update({f"sigungu_{i}": code for i, code in enumerate(sigungu_codes)})
    if top is not None:
        conditions.append("status = 'ELIGIBLE' AND (profile_ranks->>:profile) IS NOT NULL")
    elif status is not None:
        conditions.append("status = :status")
        params["status"] = status
    if stability_class is not None:
        # Independent of the status filter: stability only applies to ELIGIBLE
        # candidates, so a stability_class filter implies status = ELIGIBLE.
        conditions.append("stability_class = :stability_class")
        params["stability_class"] = stability_class
    if min_score is not None:
        conditions.append("(profile_totals->>:profile)::numeric >= :min_score")
        params["min_score"] = min_score
    if max_score is not None:
        conditions.append("(profile_totals->>:profile)::numeric <= :max_score")
        params["max_score"] = max_score

    where = " AND ".join(conditions)
    total_matched = int(
        session.execute(
            text(f"SELECT count(*) FROM suitability_candidates WHERE {where}"), params
        ).scalar_one()
    )

    effective_limit = min(top, limit) if top is not None else limit
    # For `top`, order by the requested profile's rank over the (small) eligible
    # set. For the general list (which can match the whole ~48k grid), order by
    # the indexed first-class `rank` column (active-profile rank; NULL for
    # review/excluded) so eligible cells surface first without an expensive
    # per-row JSONB extract+cast over tens of thousands of rows.
    #
    # `sort` flips only the *direction* of that same rank ordering; it never changes
    # which column ranks the screening. A better score is a numerically *smaller*
    # rank, so score_desc is rank ASC and score_asc is rank DESC. NULLS LAST in both
    # directions: a candidate with no score for this profile (REVIEW_REQUIRED /
    # EXCLUDED) has no place in a score ranking and must not be presented as the
    # lowest-scoring one. candidate_key is the deterministic tie-break, so paging is
    # stable in both directions (ranks are already unique per profile, so this only
    # orders the unranked tail).
    rank_direction = "ASC" if sort == "score_desc" else "DESC"
    order = (
        f"ORDER BY (profile_ranks->>:profile)::int {rank_direction}, candidate_key ASC"
        if top is not None
        else f"ORDER BY rank {rank_direction} NULLS LAST, candidate_key ASC"
    )
    params.update({"limit": effective_limit, "offset": offset})
    rows = (
        session.execute(
            text(
                f"""
                SELECT id, candidate_key, status, rank,
                       (profile_ranks->>:profile)::int AS profile_rank,
                       profile_totals->>:profile AS profile_total,
                       zoning_score, road_score, equity_score, demand_score,
                       component_scores,
                       stable_count, stability_class, stability_membership,
                       sido_region_code, sido_region_name, sigungu_region_code, sigungu_region_name,
                       nearest_road_distance_m, exclusion_reasons, review_reasons,
                       ST_AsGeoJSON(geometry) AS geojson
                FROM suitability_candidates
                WHERE {where}
                {order}
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        )
        .mappings()
        .all()
    )

    features: list[CandidateFeature] = []
    for r in rows:
        if r["geojson"] is None:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "MISSING_GEOMETRY",
                    "detail": f"candidate {r['id']} has no geometry",
                },
            )
        is_excluded = r["status"] == "EXCLUDED"
        is_review = r["status"] == "REVIEW_REQUIRED"
        total = None if is_review or is_excluded else r["profile_total"]
        provisional = r["profile_total"] if is_review else None
        features.append(
            CandidateFeature(
                geometry=json.loads(r["geojson"]),
                properties=CandidateProperties(
                    candidate_id=r["id"],
                    candidate_key=r["candidate_key"],
                    status=r["status"],
                    profile=profile,
                    is_excluded=is_excluded,
                    rank=r["profile_rank"],
                    total_score=total,
                    provisional_score=provisional,
                    **component_model.legacy_score_fields(run_model_version, r),
                    component_scores=component_model.component_scores_field(
                        run_model_version, r
                    ),
                    sido_region_code=r["sido_region_code"],
                    sido_region_name=r["sido_region_name"],
                    sigungu_region_code=r["sigungu_region_code"],
                    sigungu_region_name=r["sigungu_region_name"],
                    nearest_road_distance_m=(
                        str(r["nearest_road_distance_m"])
                        if r["nearest_road_distance_m"] is not None
                        else None
                    ),
                    stable_count=r["stable_count"],
                    stability_class=r["stability_class"],
                    stability_membership=r["stability_membership"] or {},
                    exclusion_reasons=r["exclusion_reasons"] or [],
                    review_reasons=r["review_reasons"] or [],
                ),
            )
        )

    return SuitabilityCandidateCollection(
        indicator="SUITABILITY_SCREENING",
        derivation_version=run["derivation_version"],
        policy_version=run["policy_version"],
        candidate_grid_version=run["candidate_grid_version"],
        component_model_version=run_model_version,
        component_order=run_component_order,
        weight_profile=profile,
        reference_year=run["reference_year"],
        run_id=resolved,
        count=len(features),
        total_matched=total_matched,
        limit=effective_limit,
        offset=offset,
        sido=params.get("sido"),
        sigungu=sigungu_codes,
        sort=sort,
        features=features,
        assumptions=ASSUMPTIONS,
        disclaimer=SCREENING_DISCLAIMER,
    )


@router.get("/tiles/{run_id}/{profile}/{z}/{x}/{y}.mvt")
def candidate_tile(
    session: SessionDep,
    request: Request,
    run_id: int,
    profile: Profile,
    z: int = Path(..., ge=MVT_MIN_ZOOM, le=MVT_MAX_ZOOM),
    x: int = Path(..., ge=0),
    y: int = Path(..., ge=0),
) -> Response:
    """Serve one Web-Mercator vector tile of the run's suitability candidates.

    Every candidate cell of the selected run is available through this endpoint;
    the client requests only the tiles its viewport needs. The URL embeds an
    immutable run + profile, so each tile is cacheable forever. The tile carries
    only the lightweight attributes the map renders/inspects with — full
    provenance stays on ``GET /candidates/{candidate_id}``.
    """
    # Validate x/y against the tile pyramid for this z before any DB work: at
    # zoom z there are 2^z tiles per axis, indices 0..2^z-1.
    max_index = (1 << z) - 1
    if x > max_index or y > max_index:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "INVALID_TILE_COORDINATE",
                "detail": f"x and y must be in [0, {max_index}] at zoom {z}",
            },
        )
    # Unknown / non-succeeded run -> structured 404 (same semantics as the read API).
    resolved = _resolve_run_id(session, run_id)

    # A data-derived profile (critic) the run never computed -> structured 4xx, so
    # an old run without CRITIC data returns PROFILE_NOT_AVAILABLE_FOR_RUN rather
    # than an empty tile that would silently imply "no candidates here".
    run = (
        session.execute(
            text(
                "SELECT weight_profiles, component_model_version, component_order "
                "FROM suitability_analysis_runs WHERE id = :id"
            ),
            {"id": resolved},
        )
        .mappings()
        .first()
    )
    assert run is not None
    run_model_version, _ = _run_model_identity(run)
    _ensure_profile_available(_json_field(run["weight_profiles"], {}), profile, resolved)

    # Content-independent, immutable ETag: the (run, profile, z, x, y) tuple fully
    # determines the tile bytes because a run is never mutated in place, so we can
    # honor a conditional request without regenerating the tile.
    etag = f'"suit-{resolved}-{profile}-{z}-{x}-{y}"'
    cache_headers = {"Cache-Control": TILE_CACHE_CONTROL, "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=cache_headers)

    raw = session.execute(
        text(_tile_sql(run_model_version)),
        {"run_id": resolved, "profile": profile, "z": z, "x": x, "y": y},
    ).scalar()
    # ST_AsMVT over zero matched rows returns NULL: a tile outside the project
    # area is a valid *empty* tile (0 bytes), never a server error.
    body = bytes(raw) if raw is not None else b""
    return Response(content=body, media_type=MVT_CONTENT_TYPE, headers=cache_headers)


@router.get("/candidates/{candidate_id}", response_model=CandidateDetailOut)
def candidate_detail(
    session: SessionDep,
    candidate_id: int,
    profile: Profile = "baseline",
) -> CandidateDetailOut:
    row = (
        session.execute(
            text(
                """
                SELECT c.*, r.reference_year, r.policy_version, r.derivation_version,
                       r.candidate_grid_version, r.component_model_version,
                       r.component_order, r.weight_profiles AS run_weight_profiles,
                       ST_AsGeoJSON(c.geometry) AS geojson
                FROM suitability_candidates c
                JOIN suitability_analysis_runs r ON r.id = c.analysis_run_id
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
    if row["geojson"] is None:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "MISSING_GEOMETRY",
                "detail": f"candidate {candidate_id} has no geometry",
            },
        )
    run_model_version, run_component_order = _run_model_identity(row)
    run_weight_profiles = _json_field(row["run_weight_profiles"], {})
    _ensure_profile_available(run_weight_profiles, profile, row["analysis_run_id"])
    is_excluded = row["status"] == "EXCLUDED"
    is_review = row["status"] == "REVIEW_REQUIRED"
    profile_totals = row["profile_totals"] or {}
    profile_ranks = row["profile_ranks"] or {}
    value = profile_totals.get(profile)
    total = None if is_review or is_excluded else value
    provisional = value if is_review else None
    # Serve the *actual* run weights for the selected profile. Never use
    # policy.WEIGHT_PROFILES[profile] — that would fabricate weights for the
    # data-derived ``critic`` profile. Static profiles fall back to the policy
    # constant only for pre-CRITIC runs whose weight_profiles were never populated.
    run_weights = run_weight_profiles.get(profile)
    if isinstance(run_weights, dict):
        weights = {c: str(w) for c, w in run_weights.items()}
    elif profile in _STATIC_PROFILE_NAMES:
        # The policy constant is only a legitimate fallback for a run of the model
        # that constant describes. Falling back across models would serve one
        # model's weights beside another model's scores.
        _assert_static_profile_fallback_allowed(run_model_version, row["analysis_run_id"])
        weights = {c: str(w) for c, w in policy.STATIC_WEIGHT_PROFILES[profile].items()}
    else:  # pragma: no cover - unreachable: critic availability already enforced
        weights = {}
    if weights:
        _assert_run_weight_vector(
            run_model_version,
            weights,
            f"run {row['analysis_run_id']} profile {profile!r} weights",
        )
    legacy_scores = component_model.legacy_score_fields(run_model_version, row)
    return CandidateDetailOut(
        candidate_id=row["id"],
        run_id=row["analysis_run_id"],
        candidate_key=row["candidate_key"],
        profile=profile,
        status=row["status"],
        is_excluded=is_excluded,
        rank=(int(profile_ranks[profile]) if profile_ranks.get(profile) is not None else None),
        total_score=total,
        provisional_score=provisional,
        zoning_score=legacy_scores["zoning_score"],
        road_score=legacy_scores["road_score"],
        equity_score=legacy_scores["equity_score"],
        demand_score=legacy_scores["demand_score"],
        component_scores=component_model.component_scores_field(run_model_version, row),
        profile_totals=profile_totals,
        profile_ranks=profile_ranks,
        stable_count=row["stable_count"],
        stability_class=row["stability_class"],
        stability_membership=row["stability_membership"] or {},
        sido_region_code=row["sido_region_code"],
        sido_region_name=row["sido_region_name"],
        sigungu_region_code=row["sigungu_region_code"],
        sigungu_region_name=row["sigungu_region_name"],
        exclusion_reasons=row["exclusion_reasons"] or [],
        review_reasons=row["review_reasons"] or [],
        penalties=row["penalties"] or [],
        raw_components=row["raw_components"] or {},
        nearest_road_distance_m=row["nearest_road_distance_m"],
        nearest_road_provenance=row["nearest_road_provenance"] or {},
        component_provenance=row["component_provenance"] or {},
        original_area_m2=row["original_area_m2"],
        clipped_area_m2=row["clipped_area_m2"],
        clipped_area_ratio=row["clipped_area_ratio"],
        geometry=json.loads(row["geojson"]),
        reference_year=row["reference_year"],
        policy_version=row["policy_version"],
        derivation_version=row["derivation_version"],
        candidate_grid_version=row["candidate_grid_version"],
        component_model_version=run_model_version,
        component_order=run_component_order,
        weights=weights,
        disclaimer=SCREENING_DISCLAIMER,
    )
