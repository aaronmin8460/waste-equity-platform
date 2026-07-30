"""Read-only candidate-cell land-cover statistics API (Suitability Phase 1B-LC4).

Exposes the derived statistics Phase 1B-LC3 persisted: for every canonical 500 m
candidate-grid cell, the land-cover composition of the acquired 세분류 [2025]
토지피복지도 release. Five read-only endpoints — the active release, an aggregate
summary, a bounded cell list, one cell's detail, and one cell's complete class
distribution — serve exactly what LC3 stored.

Boundaries this router keeps, by construction:

* **Read-only.** No handler issues INSERT/UPDATE/DELETE. Nothing here writes a
  statistics version, statistics row, class row, dataset version, ingestion run,
  suitability run, or suitability candidate.
* **No scoring.** Nothing here is a score, weight, exclusion, rank, candidate status,
  review reason, or policy input, and no suitability code path reads these statistics.
  Every response states ``used_in_suitability_scoring: false``.
* **No raw features.** ``environmental_land_cover_features`` (6.9 M rows) is never
  queried by any handler, and no land-cover feature geometry is ever returned. Only
  the three persisted LC3 tables — plus, for the bbox filter alone, the existing
  candidate geometry index — are read.
* **No geometry duplication.** The candidate's geometry is already served by the
  suitability candidate endpoints; this API does not re-serve or re-store it.

Coverage semantics are preserved verbatim from LC3 and restated on every response, so
``NO_COVERAGE`` can never be presented as "no land cover exists" or as suitability.
See ``docs/LAND_COVER_CELL_STATISTICS_API.md``.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import ColumnElement, Select, func, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from ...db import get_session
from ...models import (
    EnvironmentalDatasetVersion,
    EnvironmentalLandCoverCellClassArea,
    EnvironmentalLandCoverCellStatistic,
    EnvironmentalLandCoverCellStatVersion,
    SuitabilityAnalysisRun,
    SuitabilityCandidate,
)
from ...schemas import (
    LandCoverAggregateSummaryOut,
    LandCoverCanonicalizationAuditOut,
    LandCoverCellClassCountsOut,
    LandCoverCellClassesResponse,
    LandCoverCellDetailOut,
    LandCoverCellListResponse,
    LandCoverCellStatisticsDisclosures,
    LandCoverCellStatisticsError,
    LandCoverCellStatisticsLifecycle,
    LandCoverCellSummaryOut,
    LandCoverClassAreaOut,
    LandCoverClassAreaTotalOut,
    LandCoverDominantClassCountOut,
    LandCoverDominantClassOut,
    LandCoverNumericalGuardAuditOut,
    LandCoverOverlapAuditOut,
    LandCoverSourceReleaseOut,
    LandCoverStatisticsReleaseOut,
    LandCoverStatisticsReleaseRef,
)
from ...schemas.land_cover_cells import (
    COVERAGE_STATUS_SEMANTICS,
    DEFAULT_PAGE_SIZE,
    LAND_COVER_LAYER_NAME,
    MAX_PAGE_SIZE,
)

router = APIRouter(
    prefix="/api/v1/environment/land-cover/cell-statistics",
    tags=["environment-land-cover"],
)
SessionDep = Annotated[Session, Depends(get_session)]

Stat = EnvironmentalLandCoverCellStatistic
ClassArea = EnvironmentalLandCoverCellClassArea
StatVersion = EnvironmentalLandCoverCellStatVersion

# --- Lifecycle (documented phase states, not live health checks) -------------
# scoring_integration is NOT_IMPLEMENTED by contract; frontend_exposure and
# vector_tiles are NOT_IMPLEMENTED because LC4 is backend-only; production_deployment
# is NOT_RUN because this phase was verified against a local database only.
LIFECYCLE = LandCoverCellStatisticsLifecycle(
    source_contract_validation="LIVE_VERIFIED",
    database_ingestion="IMPLEMENTED_AND_LOCALLY_VERIFIED",
    cell_statistics_derivation="IMPLEMENTED_AND_LOCALLY_VERIFIED",
    api_exposure="IMPLEMENTED",
    frontend_exposure="NOT_IMPLEMENTED",
    vector_tiles="NOT_IMPLEMENTED",
    scoring_integration="NOT_IMPLEMENTED",
    production_deployment="NOT_RUN",
)

CoverageStatusParam = Literal["COMPLETE_EXACT", "PARTIAL", "NO_COVERAGE"]

# Query aliases follow the project's ``Annotated`` parameter convention (see
# ``datasets.py``), which also keeps the ``Query(...)`` call out of a default value.
CoverageStatusQuery = Annotated[
    CoverageStatusParam | None,
    Query(description="COMPLETE_EXACT | PARTIAL | NO_COVERAGE."),
]
# A bounded ``int``, not ``Literal[1, 2, 3]``: query values always arrive as strings
# and Pydantic v2 does not coerce "1" into an integer literal, so a Literal here would
# reject every valid request. ``ge``/``le`` gives the same 422 on 0, 4, or "L1".
ClassLevelQuery = Annotated[
    int | None,
    Query(ge=1, le=3, description="1 = 대분류, 2 = 중분류, 3 = 세분류. Omit for all three."),
]

# Whitelisted sort keys → column. Every page also gets a deterministic tie-break on
# ``candidate_key``, which is unique within a statistics version, so paging is stable.
SortKey = Literal[
    "candidate_key",
    "-candidate_key",
    "coverage_ratio",
    "-coverage_ratio",
    "cell_area_m2",
    "-cell_area_m2",
    "evaluated_area_m2",
    "-evaluated_area_m2",
    "uncovered_area_m2",
    "-uncovered_area_m2",
]
_SORT_COLUMNS: dict[str, InstrumentedAttribute[Any]] = {
    "candidate_key": Stat.candidate_key,
    "coverage_ratio": Stat.coverage_ratio,
    "cell_area_m2": Stat.cell_area_m2,
    "evaluated_area_m2": Stat.evaluated_area_m2,
    "uncovered_area_m2": Stat.uncovered_area_m2,
}


# --------------------------------------------------------------------------- #
# Structured errors
# --------------------------------------------------------------------------- #
def _error(status_code: int, code: str, detail: str) -> HTTPException:
    """Structured HTTPException. Never carries SQL, a path, or a stack trace."""

    return HTTPException(
        status_code=status_code,
        detail=LandCoverCellStatisticsError(error=code, detail=detail).model_dump(),
    )


def _invalid(code: str, detail: str) -> HTTPException:
    return _error(422, code, detail)


# --------------------------------------------------------------------------- #
# Active-release resolution
# --------------------------------------------------------------------------- #
def _resolve_active_release(session: Session) -> StatVersion:
    """The single active LC3 statistics release, or an honest failure.

    Ambiguity is never resolved by guessing. LC3's partial unique index permits at
    most one active release per (source release, grid version, derivation version),
    but two releases derived from *different* source versions could both be active;
    that is a data-integrity condition the API surfaces as 409 rather than silently
    picking one. A release that is active but not verifiably complete is likewise
    refused, so a partial or failed derivation can never be served as complete.
    """

    releases = session.scalars(
        select(StatVersion).where(StatVersion.is_active.is_(True)).order_by(StatVersion.id)
    ).all()
    if not releases:
        raise _error(
            404,
            "NO_ACTIVE_STATISTICS_RELEASE",
            "No active candidate-cell land-cover statistics release is available.",
        )
    if len(releases) > 1:
        ids = ", ".join(str(r.id) for r in releases)
        raise _error(
            409,
            "MULTIPLE_ACTIVE_STATISTICS_RELEASES",
            f"{len(releases)} statistics releases are marked active ({ids}); the active "
            "release is ambiguous and this API refuses to choose one.",
        )
    release = releases[0]
    if release.status != "SUCCEEDED":
        raise _error(
            409,
            "INCOMPLETE_ACTIVE_STATISTICS_RELEASE",
            f"The active statistics release has status {release.status!r}; only a "
            "SUCCEEDED release may be served.",
        )
    if release.failed_cell_count or release.processed_cell_count != release.expected_cell_count:
        raise _error(
            409,
            "INCOMPLETE_ACTIVE_STATISTICS_RELEASE",
            "The active statistics release is internally inconsistent: it processed "
            f"{release.processed_cell_count} of {release.expected_cell_count} expected "
            f"cells with {release.failed_cell_count} failed. It will not be served.",
        )
    return release


def _source_version(session: Session, release: StatVersion) -> EnvironmentalDatasetVersion:
    version = session.get(EnvironmentalDatasetVersion, release.land_cover_dataset_version_id)
    if version is None:  # pragma: no cover - FK guarantees the row exists
        raise _error(
            500,
            "MISSING_SOURCE_RELEASE",
            "The active statistics release references a land-cover dataset version "
            "that no longer exists.",
        )
    return version


def _disclosures(
    license_note: str | None, reference_period: str | None
) -> LandCoverCellStatisticsDisclosures:
    """Structured disclosures. ``license_note`` is the verbatim stored source note."""

    return LandCoverCellStatisticsDisclosures(
        reference_period=reference_period,
        license_note=license_note,
        lifecycle=LIFECYCLE,
    )


def _release_ref(
    release: StatVersion, reference_period: str | None
) -> LandCoverStatisticsReleaseRef:
    return LandCoverStatisticsReleaseRef(
        statistics_version_id=release.id,
        status=release.status,
        derivation_version=release.derivation_version,
        area_crs=release.area_crs,
        candidate_grid_version=release.candidate_grid_version,
        candidate_grid_fingerprint=release.candidate_grid_fingerprint,
        land_cover_dataset_version_id=release.land_cover_dataset_version_id,
        reference_period=reference_period,
        expected_cell_count=release.expected_cell_count,
        processed_cell_count=release.processed_cell_count,
    )


def _resolve_context(
    session: Session,
) -> tuple[StatVersion, LandCoverStatisticsReleaseRef, LandCoverCellStatisticsDisclosures]:
    """Resolve the active release plus the envelope blocks every response carries."""

    release = _resolve_active_release(session)
    source = _source_version(session, release)
    return (
        release,
        _release_ref(release, source.reference_period),
        _disclosures(source.license_note, source.reference_period),
    )


def _status_counts(release: StatVersion) -> dict[str, int]:
    """Release-level coverage-status counts, as recorded by the derivation."""

    return {
        "COMPLETE_EXACT": release.complete_exact_count,
        "PARTIAL": release.partial_count,
        "NO_COVERAGE": release.no_coverage_count,
    }


# --------------------------------------------------------------------------- #
# bbox parsing
# --------------------------------------------------------------------------- #
def _parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    """Validate ``minLon,minLat,maxLon,maxLat`` and enforce WGS84 range.

    Mirrors the wetland/suitability convention so one malformed-bbox contract holds
    across the API. Values are in EPSG:4326 — the CRS candidate geometry is stored in
    — so the predicate never transforms the indexed column.
    """

    if bbox is None:
        return None
    parts = bbox.split(",")
    if len(parts) != 4:
        raise _invalid("INVALID_BBOX", "bbox must be minLon,minLat,maxLon,maxLat")
    try:
        min_lon, min_lat, max_lon, max_lat = (float(p) for p in parts)
    except ValueError as exc:
        raise _invalid("INVALID_BBOX", "bbox values must be numbers") from exc
    if not all(v == v and abs(v) != float("inf") for v in (min_lon, min_lat, max_lon, max_lat)):
        raise _invalid("INVALID_BBOX", "bbox values must be finite numbers")
    if min_lon >= max_lon or min_lat >= max_lat:
        raise _invalid("INVALID_BBOX", "bbox min must be less than max")
    if not (-180.0 <= min_lon <= 180.0 and -180.0 <= max_lon <= 180.0):
        raise _invalid("INVALID_BBOX", "longitude must be within [-180, 180]")
    if not (-90.0 <= min_lat <= 90.0 and -90.0 <= max_lat <= 90.0):
        raise _invalid("INVALID_BBOX", "latitude must be within [-90, 90]")
    return (min_lon, min_lat, max_lon, max_lat)


def _bbox_candidate_keys(
    grid_version: str, box: tuple[float, float, float, float]
) -> Select[tuple[str]]:
    """Candidate keys of the grid version whose cell geometry intersects ``box``.

    The LC3 statistics table intentionally stores no geometry, so a spatial filter has
    to reach the candidate geometry that the areas were measured on. This drives the
    query from the geometry side: the ``&&`` predicate is expressed in EPSG:4326 — the
    storage CRS — so PostGIS uses the existing ``idx_suitability_candidates_geometry``
    GiST index directly and no candidate row is transformed inside the predicate.

    ``DISTINCT candidate_key`` over every occurrence of the grid version is equivalent
    to testing the canonical occurrence alone: LC3 proved every repeated occurrence of
    a key ``ST_Equals`` the canonical one (0 conflicts on this grid), and topologically
    equal geometries have identical bounding boxes, so ``&&`` cannot disagree between
    occurrences. Restricting to the canonical occurrence instead would force a
    ``DISTINCT ON`` over all occurrences before any spatial filter could apply, which
    defeats the GiST index. The equivalence is asserted by the integration tests.
    """

    envelope = func.ST_MakeEnvelope(box[0], box[1], box[2], box[3], 4326)
    return (
        select(SuitabilityCandidate.candidate_key)
        .join(
            SuitabilityAnalysisRun,
            SuitabilityAnalysisRun.id == SuitabilityCandidate.analysis_run_id,
        )
        .where(
            SuitabilityAnalysisRun.candidate_grid_version == grid_version,
            SuitabilityCandidate.geometry.op("&&")(envelope),
        )
        .distinct()
    )


# --------------------------------------------------------------------------- #
# Shared cell-selection filters
# --------------------------------------------------------------------------- #
def _cell_conditions(
    release: StatVersion,
    *,
    coverage_status: str | None,
    sido_code: str | None,
    sigungu_code: str | None,
    dominant_l1_code: str | None,
    min_coverage_ratio: float | None,
    max_coverage_ratio: float | None,
    box: tuple[float, float, float, float] | None,
) -> list[ColumnElement[bool]]:
    """AND-composed filters over the active release's cells.

    Every filter is backed by an index on ``(statistics_version_id, …)`` or by the
    candidate GiST index (bbox). The statistics version and grid version are always
    pinned, so no query can straddle two releases.
    """

    conditions: list[ColumnElement[bool]] = [
        Stat.statistics_version_id == release.id,
        Stat.candidate_grid_version == release.candidate_grid_version,
    ]
    if coverage_status is not None:
        conditions.append(Stat.coverage_status == coverage_status)
    if sido_code is not None:
        conditions.append(Stat.sido_region_code == sido_code)
    if sigungu_code is not None:
        conditions.append(Stat.sigungu_region_code == sigungu_code)
    if dominant_l1_code is not None:
        conditions.append(Stat.dominant_l1_code == dominant_l1_code)
    if min_coverage_ratio is not None:
        conditions.append(Stat.coverage_ratio >= min_coverage_ratio)
    if max_coverage_ratio is not None:
        conditions.append(Stat.coverage_ratio <= max_coverage_ratio)
    if box is not None:
        conditions.append(
            Stat.candidate_key.in_(_bbox_candidate_keys(release.candidate_grid_version, box))
        )
    return conditions


def _ratio(numerator: float, denominator: float) -> float | None:
    """Area-weighted ratio, or ``None`` when the denominator makes it undefined.

    Undefined is deliberately ``None`` and never ``0.0``: a cell with no area and a
    cell with no coverage are different facts.
    """

    return numerator / denominator if denominator > 0 else None


# --------------------------------------------------------------------------- #
# 1. Active statistics release
# --------------------------------------------------------------------------- #
@router.get("/release", response_model=LandCoverStatisticsReleaseOut)
def active_release(session: SessionDep) -> LandCoverStatisticsReleaseOut:
    """The active derived statistics release, with full identity and provenance.

    Fails honestly (404/409) when the active release is missing, ambiguous, or not
    verifiably complete — it is never substituted with a partial one.
    """

    release = _resolve_active_release(session)
    source = _source_version(session, release)
    metadata = cast(dict[str, object] | None, release.derivation_metadata)
    return LandCoverStatisticsReleaseOut(
        statistics_version_id=release.id,
        status=release.status,
        is_active=release.is_active,
        derivation_version=release.derivation_version,
        area_crs=release.area_crs,
        input_signature=release.input_signature,
        candidate_grid_version=release.candidate_grid_version,
        candidate_grid_fingerprint=release.candidate_grid_fingerprint,
        expected_cell_count=release.expected_cell_count,
        processed_cell_count=release.processed_cell_count,
        failed_cell_count=release.failed_cell_count,
        coverage_status_counts=_status_counts(release),
        class_row_count=release.class_row_count,
        total_cell_area_m2=release.total_cell_area_m2,
        total_evaluated_area_m2=release.total_evaluated_area_m2,
        total_uncovered_area_m2=release.total_uncovered_area_m2,
        aggregate_coverage_ratio=release.aggregate_coverage_ratio,
        overlap_audit=LandCoverOverlapAuditOut(
            total_intersection_area_m2=release.total_intersection_area_m2,
            total_overlap_area_m2=release.total_overlap_area_m2,
            cells_with_source_overlap=release.cells_with_source_overlap,
            max_overlap_area_m2=release.max_overlap_area_m2,
            max_overlap_ratio=release.max_overlap_ratio,
        ),
        numerical_guard_audit=LandCoverNumericalGuardAuditOut(
            guard_applied_cell_count=release.guard_applied_cell_count,
            max_guard_adjustment_m2=release.max_guard_adjustment_m2,
        ),
        canonicalization_audit=LandCoverCanonicalizationAuditOut(
            candidate_row_count=release.candidate_row_count,
            duplicate_candidate_occurrence_count=release.duplicate_candidate_occurrence_count,
            representation_variant_cell_count=release.representation_variant_cell_count,
        ),
        started_at=release.started_at,
        completed_at=release.completed_at,
        source_release=LandCoverSourceReleaseOut(
            dataset_version_id=source.id,
            provider=source.provider,
            official_dataset_name=source.official_dataset_name,
            provider_dataset_identifier=source.provider_dataset_identifier,
            official_source_url=source.official_source_url,
            reference_period=source.reference_period,
            source_crs=source.source_crs,
            storage_crs=source.target_crs,
            source_encoding=source.source_encoding,
            transformation_version=source.transformation_version,
            declared_feature_count=source.declared_feature_count,
            source_checksum=source.source_checksum,
            license_note=source.license_note,
        ),
        derivation_metadata=metadata,
        disclosures=_disclosures(source.license_note, source.reference_period),
    )


# --------------------------------------------------------------------------- #
# 2. Aggregate summary
# --------------------------------------------------------------------------- #
@router.get("/summary", response_model=LandCoverAggregateSummaryOut)
def aggregate_summary(
    session: SessionDep,
    sido_code: str | None = Query(
        default=None, description="Normalized SIDO region code (e.g. KR-SGIS-11)."
    ),
    sigungu_code: str | None = Query(default=None, description="Normalized SIGUNGU region code."),
    coverage_status: CoverageStatusQuery = None,
) -> LandCoverAggregateSummaryOut:
    """Area-weighted aggregate over the selected cells of the active release.

    ``aggregate_coverage_ratio`` is ``total_evaluated_area_m2 / total_cell_area_m2``,
    never a mean of per-cell ratios: averaging ratios would weight a boundary-clipped
    edge cell the same as a full 250,000 m² cell. Cells with no dominant class (i.e.
    ``NO_COVERAGE``) are reported as their own count, so no pseudo-class is invented.
    """

    release, release_ref, disclosures = _resolve_context(session)
    conditions = _cell_conditions(
        release,
        coverage_status=coverage_status,
        sido_code=sido_code,
        sigungu_code=sigungu_code,
        dominant_l1_code=None,
        min_coverage_ratio=None,
        max_coverage_ratio=None,
        box=None,
    )

    totals = session.execute(
        select(
            func.count().label("cell_count"),
            func.coalesce(func.sum(Stat.cell_area_m2), 0.0).label("cell_area"),
            func.coalesce(func.sum(Stat.evaluated_area_m2), 0.0).label("evaluated_area"),
            func.coalesce(func.sum(Stat.uncovered_area_m2), 0.0).label("uncovered_area"),
            func.coalesce(func.sum(Stat.l1_class_area_sum_m2), 0.0).label("l1_area"),
            func.count().filter(Stat.dominant_l1_code.is_(None)).label("no_dominant"),
        ).where(*conditions)
    ).one()

    status_rows = session.execute(
        select(Stat.coverage_status, func.count()).where(*conditions).group_by(Stat.coverage_status)
    ).all()
    # Every status is present as an explicit key (0 when absent) so a consumer never
    # has to distinguish "absent" from "zero".
    status_counts = {status: 0 for status in COVERAGE_STATUS_SEMANTICS}
    for status, count in status_rows:
        status_counts[status] = count

    dominant_rows = session.execute(
        select(
            Stat.dominant_l1_code,
            func.min(Stat.dominant_l1_name).label("class_name"),
            func.count().label("cell_count"),
        )
        .where(*conditions, Stat.dominant_l1_code.is_not(None))
        .group_by(Stat.dominant_l1_code)
        .order_by(Stat.dominant_l1_code)
    ).all()

    # L1 total-area distribution. The class rows are reached through the same filtered
    # cell selection, so the SIDO/status scope applies identically to both aggregates.
    l1_rows = session.execute(
        select(
            ClassArea.class_code,
            func.min(ClassArea.class_name).label("class_name"),
            func.sum(ClassArea.class_area_m2).label("total_area"),
        )
        .join(Stat, Stat.id == ClassArea.cell_statistics_id)
        .where(
            *conditions,
            ClassArea.statistics_version_id == release.id,
            ClassArea.class_level == 1,
        )
        .group_by(ClassArea.class_code)
        .order_by(ClassArea.class_code)
    ).all()

    l1_denominator = float(totals.l1_area)
    return LandCoverAggregateSummaryOut(
        scope={
            "statistics_version_id": release.id,
            "candidate_grid_version": release.candidate_grid_version,
            "sido_code": sido_code,
            "sigungu_code": sigungu_code,
            "coverage_status": coverage_status,
        },
        cell_count=totals.cell_count,
        coverage_status_counts=status_counts,
        total_cell_area_m2=float(totals.cell_area),
        total_evaluated_area_m2=float(totals.evaluated_area),
        total_uncovered_area_m2=float(totals.uncovered_area),
        aggregate_coverage_ratio=_ratio(float(totals.evaluated_area), float(totals.cell_area)),
        cells_without_dominant_class=totals.no_dominant,
        dominant_l1_distribution=[
            LandCoverDominantClassCountOut(
                class_code=row.dominant_l1_code,
                class_name=row.class_name,
                cell_count=row.cell_count,
            )
            for row in dominant_rows
        ],
        l1_area_distribution=[
            LandCoverClassAreaTotalOut(
                class_code=row.class_code,
                class_name=row.class_name,
                total_area_m2=float(row.total_area),
                share_of_l1_class_area=_ratio(float(row.total_area), l1_denominator),
            )
            for row in l1_rows
        ],
        total_l1_class_area_m2=l1_denominator,
        release=release_ref,
        disclosures=disclosures,
    )


# --------------------------------------------------------------------------- #
# 3. Paginated cell listing
# --------------------------------------------------------------------------- #
@router.get("/cells", response_model=LandCoverCellListResponse)
def list_cells(
    session: SessionDep,
    coverage_status: CoverageStatusQuery = None,
    sido_code: str | None = Query(default=None, description="Normalized SIDO region code."),
    sigungu_code: str | None = Query(default=None, description="Normalized SIGUNGU region code."),
    dominant_l1_code: str | None = Query(
        default=None, description="Official L1 (대분류) class code of the dominant class."
    ),
    min_coverage_ratio: float | None = Query(default=None, ge=0.0, le=1.0),
    max_coverage_ratio: float | None = Query(default=None, ge=0.0, le=1.0),
    bbox: str | None = Query(
        default=None, description="Viewport filter minLon,minLat,maxLon,maxLat (EPSG:4326)."
    ),
    limit: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
    sort: SortKey = "candidate_key",
) -> LandCoverCellListResponse:
    """Bounded, deterministically-ordered page of cells in the active release.

    Filters compose with AND. Every row carries its coverage status and ratio beside
    its dominant class, so a table or map cannot show composition without coverage.
    Class rows are never fetched per row here (no N+1): the per-level *counts* are
    already stored on the cell, and the full distribution has its own endpoint.
    """

    release, release_ref, disclosures = _resolve_context(session)
    if (
        min_coverage_ratio is not None
        and max_coverage_ratio is not None
        and min_coverage_ratio > max_coverage_ratio
    ):
        raise _invalid(
            "INVALID_COVERAGE_RATIO_RANGE",
            "min_coverage_ratio must not exceed max_coverage_ratio",
        )
    box = _parse_bbox(bbox)
    conditions = _cell_conditions(
        release,
        coverage_status=coverage_status,
        sido_code=sido_code,
        sigungu_code=sigungu_code,
        dominant_l1_code=dominant_l1_code,
        min_coverage_ratio=min_coverage_ratio,
        max_coverage_ratio=max_coverage_ratio,
        box=box,
    )

    total = session.scalar(select(func.count()).select_from(Stat).where(*conditions)) or 0

    descending = sort.startswith("-")
    key = sort.lstrip("-")
    column = _SORT_COLUMNS[key]
    primary = column.desc() if descending else column.asc()
    # candidate_key is unique within a statistics version, so appending it makes every
    # ordering total and therefore paging stable across requests.
    order_by = [primary] if key == "candidate_key" else [primary, Stat.candidate_key.asc()]

    rows = session.scalars(
        select(Stat).where(*conditions).order_by(*order_by).limit(limit).offset(offset)
    ).all()
    items = [LandCoverCellSummaryOut.model_validate(row) for row in rows]
    return LandCoverCellListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < total,
        sort=sort,
        applied_filters={
            "coverage_status": coverage_status,
            "sido_code": sido_code,
            "sigungu_code": sigungu_code,
            "dominant_l1_code": dominant_l1_code,
            "min_coverage_ratio": min_coverage_ratio,
            "max_coverage_ratio": max_coverage_ratio,
            "bbox": list(box) if box is not None else None,
        },
        release=release_ref,
        disclosures=disclosures,
    )


# --------------------------------------------------------------------------- #
# Candidate lookup shared by the two per-cell endpoints
# --------------------------------------------------------------------------- #
def _load_cell(session: Session, release: StatVersion, candidate_key: str) -> Stat:
    """One cell of the active release, or a 404 that says which case applies.

    A key that exists only under a different grid version, or only in a superseded
    statistics release, gets its own error code rather than a bare "not found", so a
    caller can tell a stale identifier from a wrong one.
    """

    cell = session.scalars(
        select(Stat).where(
            Stat.statistics_version_id == release.id,
            Stat.candidate_grid_version == release.candidate_grid_version,
            Stat.candidate_key == candidate_key,
        )
    ).first()
    if cell is not None:
        return cell
    # Distinguish "wrong grid version / superseded release" from "unknown key". This
    # probe is a single indexed lookup on ``candidate_key``, never a scan.
    elsewhere = session.execute(
        select(Stat.candidate_grid_version, Stat.statistics_version_id)
        .where(Stat.candidate_key == candidate_key)
        .order_by(Stat.statistics_version_id)
        .limit(1)
    ).first()
    if elsewhere is not None:
        raise _error(
            404,
            "CANDIDATE_KEY_NOT_IN_ACTIVE_RELEASE",
            f"Candidate key exists for grid version {elsewhere[0]!r} in statistics "
            f"version {elsewhere[1]} but not in the active release "
            f"(grid version {release.candidate_grid_version!r}, statistics version "
            f"{release.id}).",
        )
    raise _error(
        404,
        "CANDIDATE_CELL_NOT_FOUND",
        "No candidate-cell land-cover statistics exist for the requested candidate key.",
    )


def _class_counts(cell: Stat) -> LandCoverCellClassCountsOut:
    return LandCoverCellClassCountsOut(
        l1_class_count=cell.l1_class_count,
        l2_class_count=cell.l2_class_count,
        l3_class_count=cell.l3_class_count,
        l1_class_area_sum_m2=cell.l1_class_area_sum_m2,
        l2_class_area_sum_m2=cell.l2_class_area_sum_m2,
        l3_class_area_sum_m2=cell.l3_class_area_sum_m2,
    )


CandidateKeyPath = Annotated[
    str,
    Path(
        min_length=1,
        max_length=50,
        description="Canonical candidate identity, '<grid version>:<i>_<j>'.",
    ),
]


# --------------------------------------------------------------------------- #
# 4. Candidate-cell detail
# --------------------------------------------------------------------------- #
@router.get("/cells/{candidate_key}", response_model=LandCoverCellDetailOut)
def cell_detail(session: SessionDep, candidate_key: CandidateKeyPath) -> LandCoverCellDetailOut:
    """Complete land-cover statistics for one canonical candidate cell.

    Returns no land-cover feature geometry and does not duplicate the candidate's own
    geometry, which the suitability candidate endpoints already serve.
    """

    release, release_ref, disclosures = _resolve_context(session)
    cell = _load_cell(session, release, candidate_key)
    return LandCoverCellDetailOut(
        candidate_grid_version=cell.candidate_grid_version,
        candidate_key=cell.candidate_key,
        candidate_geometry_fingerprint=cell.candidate_geometry_fingerprint,
        sido_region_code=cell.sido_region_code,
        sido_region_name=cell.sido_region_name,
        sigungu_region_code=cell.sigungu_region_code,
        sigungu_region_name=cell.sigungu_region_name,
        cell_area_m2=cell.cell_area_m2,
        evaluated_area_m2=cell.evaluated_area_m2,
        uncovered_area_m2=cell.uncovered_area_m2,
        uncovered_residual_area_m2=cell.uncovered_residual_area_m2,
        coverage_ratio=cell.coverage_ratio,
        coverage_status=cast(Any, cell.coverage_status),
        coverage_status_meaning=COVERAGE_STATUS_SEMANTICS.get(cell.coverage_status, ""),
        topological_cover_predicate=cell.topological_cover_predicate,
        intersection_area_sum_m2=cell.intersection_area_sum_m2,
        overlap_area_m2=cell.overlap_area_m2,
        matched_feature_count=cell.matched_feature_count,
        dominant_class=LandCoverDominantClassOut(
            l1_code=cell.dominant_l1_code,
            l1_name=cell.dominant_l1_name,
            l2_code=cell.dominant_l2_code,
            l2_name=cell.dominant_l2_name,
            l3_code=cell.dominant_l3_code,
            l3_name=cell.dominant_l3_name,
        ),
        class_counts=_class_counts(cell),
        candidate_occurrence_count=cell.candidate_occurrence_count,
        representation_variant_count=cell.representation_variant_count,
        guard_applied=cell.guard_applied,
        derivation_version=cell.derivation_version,
        area_crs=cell.area_crs,
        release=release_ref,
        disclosures=disclosures,
    )


# --------------------------------------------------------------------------- #
# 5. Candidate-cell class distribution
# --------------------------------------------------------------------------- #
@router.get("/cells/{candidate_key}/classes", response_model=LandCoverCellClassesResponse)
def cell_classes(
    session: SessionDep,
    candidate_key: CandidateKeyPath,
    class_level: ClassLevelQuery = None,
) -> LandCoverCellClassesResponse:
    """Complete official class distribution for one cell, with both denominators.

    Bounded by the source class vocabulary (at most 70 codes across the three levels),
    so it is returned whole rather than paginated. A ``NO_COVERAGE`` cell returns an
    empty list — never a synthetic uncovered or unknown class. Class codes and Korean
    names are the official source values, verbatim.
    """

    release, release_ref, disclosures = _resolve_context(session)
    cell = _load_cell(session, release, candidate_key)

    conditions: list[ColumnElement[bool]] = [
        ClassArea.statistics_version_id == release.id,
        ClassArea.cell_statistics_id == cell.id,
    ]
    if class_level is not None:
        conditions.append(ClassArea.class_level == class_level)
    rows = session.scalars(
        select(ClassArea)
        .where(*conditions)
        .order_by(
            ClassArea.class_level.asc(),
            ClassArea.class_area_m2.desc(),
            ClassArea.class_code.asc(),
        )
    ).all()
    items = [LandCoverClassAreaOut.model_validate(row) for row in rows]
    return LandCoverCellClassesResponse(
        candidate_grid_version=cell.candidate_grid_version,
        candidate_key=cell.candidate_key,
        coverage_status=cast(Any, cell.coverage_status),
        coverage_status_meaning=COVERAGE_STATUS_SEMANTICS.get(cell.coverage_status, ""),
        cell_area_m2=cell.cell_area_m2,
        evaluated_area_m2=cell.evaluated_area_m2,
        uncovered_area_m2=cell.uncovered_area_m2,
        coverage_ratio=cell.coverage_ratio,
        class_level_filter=class_level,
        items=items,
        total=len(items),
        class_counts=_class_counts(cell),
        release=release_ref,
        disclosures=disclosures,
    )


__all__ = ["LAND_COVER_LAYER_NAME", "router"]
