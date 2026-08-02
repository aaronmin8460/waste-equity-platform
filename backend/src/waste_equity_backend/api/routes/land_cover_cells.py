"""Read-only candidate-cell land-cover statistics API (Suitability Phase 1B-LC4).

Exposes the derived statistics Phase 1B-LC3 persisted: for every canonical 500 m
candidate-grid cell, the land-cover composition of the acquired 세분류 [2025]
토지피복지도 release. Five read-only JSON endpoints — the active release, an aggregate
summary, a bounded cell list, one cell's detail, and one cell's complete class
distribution — serve exactly what LC3 stored, and Phase 1B-LC5B adds a sixth,
read-only Mapbox Vector Tile endpoint so the whole 47,893-cell grid can be drawn on
the map without paging through JSON (see ``candidate_cell_tile`` below).

Boundaries this router keeps, by construction:

* **Read-only.** No handler issues INSERT/UPDATE/DELETE. Nothing here writes a
  statistics version, statistics row, class row, dataset version, ingestion run,
  suitability run, or suitability candidate.
* **No scoring.** Nothing here is a score, weight, exclusion, rank, candidate status,
  review reason, or policy input, and no suitability code path reads these statistics.
  Every response states ``used_in_suitability_scoring: false``.
* **No raw features.** ``environmental_land_cover_features`` (6.9 M rows) is never
  queried by any handler, and no land-cover feature geometry is ever returned. Only
  the three persisted LC3 tables — plus, for the bbox filter and the vector tiles, the
  existing candidate geometry index — are read.
* **No geometry duplication.** The candidate's geometry is already served by the
  suitability candidate endpoints; the JSON endpoints do not re-serve or re-store it,
  and the tile endpoint reads it in place from ``suitability_candidates`` rather than
  persisting a second copy.

Coverage semantics are preserved verbatim from LC3 and restated on every response, so
``NO_COVERAGE`` can never be presented as "no land cover exists" or as suitability.
See ``docs/LAND_COVER_CELL_STATISTICS_API.md``.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from sqlalchemy import ColumnElement, Select, func, select, text
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
    LandCoverSourceAttributionOut,
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
# scoring_integration stays NOT_IMPLEMENTED by contract: Phase 1B-LC8 authorized public
# *publication* of the derived services, never their use in scoring. LC8 deploys the
# already-implemented LC3–LC6 feature set to production under the project-level
# government-partner authorization recorded in docs/PUBLIC_DATA_PROJECT_AUTHORIZATION.md,
# so production_deployment becomes PUBLIC_DEPLOYED and the surfaces that were previously
# qualified as "locally verified" become PUBLIC_DEPLOYED_AND_VERIFIED. The raw
# source-feature tables are deliberately NOT part of that deployment.
LIFECYCLE = LandCoverCellStatisticsLifecycle(
    source_contract_validation="LIVE_VERIFIED",
    database_ingestion="DERIVED_STATISTICS_DEPLOYED_RAW_SOURCE_LOCAL_ONLY",
    cell_statistics_derivation="IMPLEMENTED_AND_VERIFIED",
    api_exposure="PUBLIC_DEPLOYED_AND_VERIFIED",
    frontend_exposure="PUBLIC_DEPLOYED_AND_VERIFIED",
    vector_tiles="PUBLIC_DEPLOYED_AND_VERIFIED",
    scoring_integration="NOT_IMPLEMENTED",
    production_deployment="PUBLIC_DEPLOYED",
)

# --- Vector-tile (MVT) constants (Phase 1B-LC5B) ------------------------------
# The map draws the COMPLETE candidate-cell statistics layer (47,893 cells on the
# active release) as PostGIS Mapbox Vector Tiles. The paginated ``/cells`` JSON
# endpoint is unusable for that by construction: it caps at 500 rows and carries no
# geometry at all. The tile joins the already-persisted LC3 statistics to the existing
# candidate geometry in place — it recomputes no intersection, stores no second copy of
# the grid, and never reads ``environmental_land_cover_features``.
MVT_CONTENT_TYPE = "application/vnd.mapbox-vector-tile"
#: Web-Mercator tile pyramid: z 0..22 is the standard safe range (2^22 tiles/side).
MVT_MIN_ZOOM = 0
MVT_MAX_ZOOM = 22
#: Source-layer name the frontend binds its land-cover layers to. Deliberately
#: distinct from the suitability ``candidates`` and the ``wetlands`` source-layers, so
#: the three optional map layers can never be confused for one another.
TILE_SOURCE_LAYER = "land_cover_cells"
#: The URL pins an immutable statistics version, so a served tile never changes;
#: cache it aggressively (one year, immutable), exactly like the suitability and
#: wetland tiles.
TILE_CACHE_CONTROL = "public, max-age=31536000, immutable"

# Phase 1B-LC9 — transaction-local JIT suppression for the tile query only.
#
# Measured root cause, not a guess. At low zoom the tile plan's estimated cost
# exceeds both ``jit_above_cost`` (100,000) and ``jit_inline_above_cost``
# (500,000), so PostgreSQL LLVM-compiles the expression tree with inlining and
# optimisation enabled — in every parallel worker — before executing it once.
# ``EXPLAIN (ANALYZE)`` on the production database for z=7/109/49 attributed
# 1.39–1.57 s of a 1.28 s wall-clock execution to JIT generation, inlining,
# optimisation and emission (the figure exceeds wall clock because it is summed
# across workers). The compiled expressions are almost entirely calls into
# PostGIS C functions, which JIT cannot speed up, so the compilation is pure
# overhead paid once per tile request.
#
# ``SET LOCAL`` scopes this to the request's own transaction: it is reset when
# the session's transaction ends, so a pooled connection never carries it into
# an unrelated request, and no server-wide or role-wide setting is touched. It
# changes plan *execution strategy* only — never the rows, the ordering, or the
# encoded bytes, which the LC9 tests assert directly.
_TILE_DISABLE_JIT = text("SET LOCAL jit = off")

# Parameterized MVT query, following the established project pattern: the tile
# envelope is built in EPSG:3857 (``ST_TileEnvelope``) and transformed to EPSG:4326 for
# the candidate predicate, so ``geometry && <bounds>`` hits the existing
# ``idx_suitability_candidates_geometry`` GiST index and only the *matched* geometries
# are transformed to 3857 for ``ST_AsMVTGeom`` (filter-before-transform). The complete
# candidate table is never transformed inside the predicate.
#
# Canonical geometry: the candidate rows are pinned to ONE analysis run (the canonical
# run resolved by ``_resolve_canonical_run``), and ``(analysis_run_id, candidate_key)``
# is UNIQUE, so no candidate key can appear twice in a tile and no ``DISTINCT ON`` over
# every occurrence is needed. The statistics join is pinned to one statistics version
# and one grid version, so a tile can never straddle two releases.
#
# Only the light attributes the map styles/filters/inspects with travel in the tile: no
# source feature id, no raw land-cover attribute, no land-cover geometry, no class
# distribution array, and no per-feature disclosure text. A NO_COVERAGE cell's dominant
# class columns are NULL in LC3 and ``ST_AsMVT`` omits NULL properties, so such a cell
# genuinely carries no dominant class rather than a fabricated "unknown" one.
#
# The aggregate is explicitly ordered by ``candidate_key``. Without it the planner is
# free to feed ``ST_AsMVT`` in whatever order the join produces — and at low zoom it
# chooses a PARALLEL hash join, whose row order varies between executions. Because MVT
# delta-encodes geometry against the previous feature, that made the *bytes* of a
# low-zoom tile differ slightly between regenerations of identical content, which would
# quietly contradict the content-independent ETag below. The sort is over the already
# tile-filtered rows (hundreds at typical zooms) and makes a tile byte-deterministic,
# so ``(version, run, z, x, y)`` really does identify one exact response body.
#
# ``tile`` is MATERIALIZED deliberately (Phase 1B-LC9). PostgreSQL inlines a
# single-reference CTE by default, which pushes ``WHERE tile.geom IS NOT NULL``
# down into the candidate scan as a filter — so ``ST_AsMVTGeom(ST_Transform(...))``
# is evaluated TWICE for every candidate row: once to test the filter and once to
# produce the output column. Materializing the CTE computes it exactly once. The
# fence changes evaluation count only: the same rows, in the same explicit
# ``ORDER BY candidate_key``, reach ``ST_AsMVT``, and the encoded tile is
# byte-identical (verified by SHA-256 against the pre-change query on the
# production database for z7/108/49, z7/109/49, z8/218/99, z9/436/198,
# z10/873/396, z13/6985/3174 and an empty tile).
#
# Every user-controlled value (version, z, x, y) is a bound parameter.
_TILE_SQL = f"""
WITH bounds AS (
    SELECT
        ST_TileEnvelope(:z, :x, :y) AS geom_3857,
        ST_Transform(ST_TileEnvelope(:z, :x, :y), 4326) AS geom_4326
),
tile AS MATERIALIZED (
    SELECT
        ST_AsMVTGeom(
            ST_Transform(c.geometry, 3857),
            bounds.geom_3857,
            4096, 64, true
        ) AS geom,
        s.candidate_key AS candidate_key,
        s.statistics_version_id AS statistics_version_id,
        s.coverage_status AS coverage_status,
        s.coverage_ratio AS coverage_ratio,
        s.dominant_l1_code AS dominant_l1_code,
        s.dominant_l1_name AS dominant_l1_name,
        s.dominant_l2_code AS dominant_l2_code,
        s.dominant_l2_name AS dominant_l2_name,
        s.dominant_l3_code AS dominant_l3_code,
        s.dominant_l3_name AS dominant_l3_name,
        s.sido_region_code AS sido_region_code,
        s.sigungu_region_code AS sigungu_region_code
    FROM bounds
    JOIN suitability_candidates c
      ON c.analysis_run_id = :run_id
     AND c.geometry && bounds.geom_4326
    JOIN environmental_land_cover_cell_statistics s
      ON s.statistics_version_id = :version_id
     AND s.candidate_grid_version = :grid_version
     AND s.candidate_key = c.candidate_key
)
SELECT ST_AsMVT(tile.*, '{TILE_SOURCE_LAYER}', 4096, 'geom' ORDER BY tile.candidate_key)
FROM tile
WHERE tile.geom IS NOT NULL
"""
_TILE_SQL_STMT = text(_TILE_SQL)

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
    _assert_servable(release)
    return release


def _assert_servable(release: StatVersion) -> None:
    """Refuse a release that is not verifiably complete, whatever selected it.

    Shared by the active-release resolution and the version-pinned tile endpoint, so a
    failed or half-derived release can never be served through either path.
    """

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


def _resolve_pinned_release(session: Session, statistics_version_id: int) -> StatVersion:
    """The statistics release named by an immutable URL, or an honest failure.

    Deliberately resolved **by id and never by fallback**: an unknown, failed, or
    incomplete version returns a structured error rather than quietly serving whichever
    release happens to be active, which would make a "version-pinned" tile a lie.

    ``is_active`` is intentionally NOT required. The id is in the URL and the release is
    immutable once written, so a tile URL keeps meaning exactly what it meant when it
    was minted even after a newer release is activated — which is the whole point of the
    one-year immutable cache contract. Completeness is still enforced.
    """

    release = session.get(StatVersion, statistics_version_id)
    if release is None:
        raise _error(
            404,
            "STATISTICS_VERSION_NOT_FOUND",
            f"No candidate-cell land-cover statistics version with id "
            f"{statistics_version_id} exists.",
        )
    _assert_servable(release)
    return release


def _resolve_canonical_run(session: Session, release: StatVersion) -> int:
    """The analysis run whose candidate rows are LC3's canonical geometry.

    LC3 canonicalized the grid by taking, per ``(candidate_grid_version,
    candidate_key)``, the occurrence with the lowest ``(analysis_run_id, id)`` — so the
    geometry every stored measurement was taken on is the **lowest analysis run** of the
    release's grid version. This resolves that same run rather than "the newest" or "any
    succeeded" one, so a tile draws the exact cells the statistics describe.

    Two conditions are refused instead of worked around:

    * no SUCCEEDED run exists for the grid version — there is no canonical geometry;
    * a run with a *lower* id exists for the grid version but is not SUCCEEDED — LC3's
      canonical occurrence would then come from that run, so serving the lowest
      *succeeded* run would silently draw different geometry than was measured.

    The cardinality guard compares the run's recorded ``candidate_count_total`` with the
    release's ``expected_cell_count``. It is an O(1) check on two stored scalars, not a
    per-request count of 47,893 rows; combined with the UNIQUE
    ``(analysis_run_id, candidate_key)`` constraint it establishes that the run holds
    exactly one geometry per expected cell. A run that never recorded the count cannot
    be verified, and is refused rather than assumed correct.
    """

    grid = release.candidate_grid_version
    lowest = session.execute(
        select(
            SuitabilityAnalysisRun.id,
            SuitabilityAnalysisRun.status,
            SuitabilityAnalysisRun.candidate_count_total,
        )
        .where(SuitabilityAnalysisRun.candidate_grid_version == grid)
        .order_by(SuitabilityAnalysisRun.id)
        .limit(1)
    ).first()
    if lowest is None:
        raise _error(
            409,
            "CANONICAL_RUN_NOT_FOUND",
            f"No suitability analysis run exists for candidate-grid version {grid!r}, so "
            "the canonical candidate geometry of the statistics release cannot be "
            "resolved.",
        )
    run_id, status, candidate_count_total = lowest
    if status != "SUCCEEDED":
        raise _error(
            409,
            "CANONICAL_RUN_NOT_FOUND",
            f"The lowest analysis run for candidate-grid version {grid!r} has status "
            f"{status!r}. LC3 canonicalized the grid on the lowest run, so no other run "
            "may be substituted for it.",
        )
    if candidate_count_total is None or candidate_count_total != release.expected_cell_count:
        raise _error(
            409,
            "CANDIDATE_GEOMETRY_CARDINALITY_MISMATCH",
            "The canonical suitability run does not hold exactly one candidate geometry "
            f"per expected statistics cell (run reports {candidate_count_total} "
            f"candidates, release expects {release.expected_cell_count}). Cells would be "
            "dropped from the tile, so it is refused.",
        )
    return int(run_id)


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
    license_note: str | None,
    reference_period: str | None,
    release: StatVersion | None = None,
) -> LandCoverCellStatisticsDisclosures:
    """Structured disclosures. ``license_note`` is the verbatim stored source note.

    The LC8 attribution block is filled in with the release being served, so the
    mandatory attribution a consumer must display names the exact derivation and
    statistics version behind the numbers rather than a generic dataset reference.
    """

    attribution = LandCoverSourceAttributionOut(
        statistics_derivation_version=release.derivation_version if release else None,
        statistics_version_id=release.id if release else None,
    )
    return LandCoverCellStatisticsDisclosures(
        reference_period=reference_period,
        license_note=license_note,
        attribution=attribution,
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
        _disclosures(source.license_note, source.reference_period, release),
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
        disclosures=_disclosures(source.license_note, source.reference_period, release),
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


# --------------------------------------------------------------------------- #
# 6. Candidate-cell vector tiles (Phase 1B-LC5B)
# --------------------------------------------------------------------------- #
@router.get("/tiles/{statistics_version_id}/{z}/{x}/{y}.mvt")
def candidate_cell_tile(
    session: SessionDep,
    request: Request,
    statistics_version_id: int,
    z: int = Path(..., ge=MVT_MIN_ZOOM, le=MVT_MAX_ZOOM),
    x: int = Path(..., ge=0),
    y: int = Path(..., ge=0),
) -> Response:
    """One Web-Mercator vector tile of a statistics version's candidate cells.

    The whole grid is reachable through this endpoint, so the map never pages the
    500-row ``/cells`` JSON list (which also carries no geometry). The URL pins an
    immutable statistics version, so the bytes of a given tile never change and it is
    cacheable for a year.

    Honest failure modes, none of which fall back to another release: an unknown version
    is a structured 404; a failed, incomplete, or geometrically unmatched one is a
    structured 409; an out-of-range x/y is a 422. A tile that simply overlaps no cell is
    a valid **empty** tile (200, zero bytes), never an error — an empty viewport and a
    broken layer must stay distinguishable.
    """

    # Validate x/y against the tile pyramid for this z before any DB work: at zoom z
    # there are 2^z tiles per axis, indices 0..2^z-1. (z itself is bounded by Path.)
    max_index = (1 << z) - 1
    if x > max_index or y > max_index:
        raise _invalid(
            "INVALID_TILE_COORDINATE",
            f"x and y must be in [0, {max_index}] at zoom {z}",
        )

    release = _resolve_pinned_release(session, statistics_version_id)
    run_id = _resolve_canonical_run(session, release)

    # Content-independent, immutable ETag: (statistics version, canonical run, z, x, y)
    # fully determines the bytes, because neither a statistics release nor an analysis
    # run is ever mutated in place. The run is part of the key so a tile can never be
    # revalidated against geometry it was not generated from.
    etag = f'"lc-cells-{release.id}-{run_id}-{z}-{x}-{y}"'
    cache_headers = {"Cache-Control": TILE_CACHE_CONTROL, "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=cache_headers)

    # Suppress JIT for this request's transaction only (see _TILE_DISABLE_JIT).
    # The two resolution queries above have already opened the transaction, so
    # ``SET LOCAL`` binds to it and is discarded when the session closes.
    session.execute(_TILE_DISABLE_JIT)
    raw = session.execute(
        _TILE_SQL_STMT,
        {
            "version_id": release.id,
            "grid_version": release.candidate_grid_version,
            "run_id": run_id,
            "z": z,
            "x": x,
            "y": y,
        },
    ).scalar()
    # ST_AsMVT over zero matched rows returns NULL: a tile outside the grid's extent is
    # a valid empty tile (0 bytes), never a server error.
    body = bytes(raw) if raw is not None else b""
    return Response(content=body, media_type=MVT_CONTENT_TYPE, headers=cache_headers)


__all__ = ["LAND_COVER_LAYER_NAME", "TILE_SOURCE_LAYER", "router"]
