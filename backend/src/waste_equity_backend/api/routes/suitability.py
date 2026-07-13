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

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...analysis.suitability import policy
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

Profile = Literal["baseline", "equal", "equity_focused", "access_focused"]
Status = Literal["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"]

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


def _resolve_run_id(session: Session, run_id: int | None) -> int:
    if run_id is not None:
        found = session.execute(
            text(
                "SELECT id FROM suitability_analysis_runs WHERE id = :id AND status = 'SUCCEEDED'"
            ),
            {"id": run_id},
        ).scalar()
        if found is None:
            raise _not_found("RUN_NOT_FOUND", f"No succeeded suitability run with id {run_id}.")
        return int(found)
    latest = session.execute(
        text(
            "SELECT id FROM suitability_analysis_runs WHERE status = 'SUCCEEDED' "
            "ORDER BY completed_at DESC NULLS LAST, id DESC LIMIT 1"
        )
    ).scalar()
    if latest is None:
        raise _not_found("NO_ANALYSIS_AVAILABLE", "No succeeded suitability analysis run exists.")
    return int(latest)


def _run_out(row: Any) -> SuitabilityRunOut:
    return SuitabilityRunOut(
        id=row["id"],
        derivation_version=row["derivation_version"],
        policy_version=row["policy_version"],
        candidate_grid_version=row["candidate_grid_version"],
        reference_year=row["reference_year"],
        boundary_vintage=row["boundary_vintage"],
        weight_profile=row["weight_profile"],
        analysis_signature=row["analysis_signature"],
        status=row["status"],
        candidate_count_total=row["candidate_count_total"],
        candidate_count_eligible=row["candidate_count_eligible"],
        candidate_count_review=row["candidate_count_review"],
        candidate_count_excluded=row["candidate_count_excluded"],
        input_dataset_version_ids=row["input_dataset_version_ids"] or [],
        input_provenance=row["input_provenance"] or {},
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        created_at=row["created_at"],
    )


_RUN_COLUMNS = (
    "id, derivation_version, policy_version, candidate_grid_version, reference_year, "
    "boundary_vintage, weight_profile, analysis_signature, status, candidate_count_total, "
    "candidate_count_eligible, candidate_count_review, candidate_count_excluded, "
    "input_dataset_version_ids, input_provenance, started_at, completed_at, created_at"
)


@router.get("/policies", response_model=SuitabilityPolicyOut)
def get_policy() -> SuitabilityPolicyOut:
    snap = policy.policy_snapshot()
    return SuitabilityPolicyOut(
        policy_version=snap["policy_version"],
        derivation_version=snap["derivation_version"],
        candidate_grid_version=snap["candidate_grid_version"],
        statuses=[policy.STATUS_ELIGIBLE, policy.STATUS_REVIEW, policy.STATUS_EXCLUDED],
        weight_profiles=snap["weight_profiles"],
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
) -> SuitabilityRunListEnvelope:
    rows = (
        session.execute(
            text(
                f"SELECT {_RUN_COLUMNS} FROM suitability_analysis_runs "
                f"ORDER BY id DESC LIMIT :limit"
            ),
            {"limit": limit},
        )
        .mappings()
        .all()
    )
    return SuitabilityRunListEnvelope(count=len(rows), runs=[_run_out(r) for r in rows])


@router.get("/runs/latest", response_model=SuitabilityRunOut)
def latest_run(session: SessionDep) -> SuitabilityRunOut:
    run_id = _resolve_run_id(session, None)
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
) -> SuitabilitySummaryOut:
    resolved = _resolve_run_id(session, run_id)
    run = (
        session.execute(
            text(f"SELECT {_RUN_COLUMNS} FROM suitability_analysis_runs WHERE id = :id"),
            {"id": resolved},
        )
        .mappings()
        .first()
    )
    assert run is not None

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
        {
            "rank": r["rank"],
            "candidate_id": r["id"],
            "candidate_key": r["candidate_key"],
            "sigungu": r["sigungu_region_name"],
            "total_score": r["total"],
            "zoning_score": (str(r["zoning_score"]) if r["zoning_score"] is not None else None),
            "road_score": (str(r["road_score"]) if r["road_score"] is not None else None),
            "equity_score": (str(r["equity_score"]) if r["equity_score"] is not None else None),
            "demand_score": (str(r["demand_score"]) if r["demand_score"] is not None else None),
            "centroid_lon": (
                round(r["centroid_lon"], 6) if r["centroid_lon"] is not None else None
            ),
            "centroid_lat": (
                round(r["centroid_lat"], 6) if r["centroid_lat"] is not None else None
            ),
        }
        for r in session.execute(
            text(
                "SELECT id, candidate_key, sigungu_region_name, zoning_score, road_score, "
                "equity_score, demand_score, "
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

    return SuitabilitySummaryOut(
        run_id=resolved,
        reference_year=run["reference_year"],
        policy_version=run["policy_version"],
        derivation_version=run["derivation_version"],
        candidate_grid_version=run["candidate_grid_version"],
        weight_profile=profile,
        candidate_count_total=run["candidate_count_total"],
        candidate_count_eligible=run["candidate_count_eligible"],
        candidate_count_review=run["candidate_count_review"],
        candidate_count_excluded=run["candidate_count_excluded"],
        exclusion_reason_counts=exclusion_counts,
        review_reason_counts=review_counts,
        sido_distribution=sido_distribution,
        top_candidates=top,
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
    sido: str | None = None,
    sigungu: str | None = None,
    status: Status | None = None,
    min_score: float | None = Query(default=None, ge=0, le=100),
    max_score: float | None = Query(default=None, ge=0, le=100),
    top: int | None = Query(default=None, ge=1, le=5000),
    limit: int = Query(default=500, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
) -> SuitabilityCandidateCollection:
    resolved = _resolve_run_id(session, run_id)
    run = (
        session.execute(
            text("SELECT reference_year FROM suitability_analysis_runs WHERE id = :id"),
            {"id": resolved},
        )
        .mappings()
        .first()
    )
    assert run is not None
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
        params["sido"] = sido
    if sigungu is not None:
        conditions.append("sigungu_region_code = :sigungu")
        params["sigungu"] = sigungu
    if top is not None:
        conditions.append("status = 'ELIGIBLE' AND (profile_ranks->>:profile) IS NOT NULL")
    elif status is not None:
        conditions.append("status = :status")
        params["status"] = status
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
    order = (
        "ORDER BY (profile_ranks->>:profile)::int ASC"
        if top is not None
        else "ORDER BY rank ASC NULLS LAST, candidate_key ASC"
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
                    zoning_score=(
                        str(r["zoning_score"]) if r["zoning_score"] is not None else None
                    ),
                    road_score=(str(r["road_score"]) if r["road_score"] is not None else None),
                    equity_score=(
                        str(r["equity_score"]) if r["equity_score"] is not None else None
                    ),
                    demand_score=(
                        str(r["demand_score"]) if r["demand_score"] is not None else None
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
                    exclusion_reasons=r["exclusion_reasons"] or [],
                    review_reasons=r["review_reasons"] or [],
                ),
            )
        )

    return SuitabilityCandidateCollection(
        indicator="SUITABILITY_SCREENING",
        derivation_version=policy.DERIVATION_VERSION,
        policy_version=policy.POLICY_VERSION,
        candidate_grid_version=policy.CANDIDATE_GRID_VERSION,
        weight_profile=profile,
        reference_year=run["reference_year"],
        run_id=resolved,
        count=len(features),
        total_matched=total_matched,
        limit=effective_limit,
        offset=offset,
        features=features,
        assumptions=ASSUMPTIONS,
        disclaimer=SCREENING_DISCLAIMER,
    )


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
                       r.candidate_grid_version, ST_AsGeoJSON(c.geometry) AS geojson
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
    is_excluded = row["status"] == "EXCLUDED"
    is_review = row["status"] == "REVIEW_REQUIRED"
    profile_totals = row["profile_totals"] or {}
    profile_ranks = row["profile_ranks"] or {}
    value = profile_totals.get(profile)
    total = None if is_review or is_excluded else value
    provisional = value if is_review else None
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
        zoning_score=row["zoning_score"],
        road_score=row["road_score"],
        equity_score=row["equity_score"],
        demand_score=row["demand_score"],
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
        weights={c: str(w) for c, w in policy.WEIGHT_PROFILES[profile].items()},
        disclaimer=SCREENING_DISCLAIMER,
    )
