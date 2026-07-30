"""Versioned 500 m candidate-cell land-cover statistics (Phase 1B-LC3).

Derives, per **canonical** 500 m candidate-grid cell, the land-cover composition of
the already-loaded 세분류 [2025] 토지피복지도 release and persists it as a versioned,
reproducible derived release. It reads only the local PostGIS tables — the raw
source root, the external drive, and the contract/ingestion CLIs are never touched.

Nothing here computes, reads, or influences a suitability score, weight, exclusion
rule, rank, candidate status, policy version, or derivation version, and no
``suitability_*`` row is ever written.

Design
------

* **Canonical grid, not runs.** ``suitability_candidates`` repeats the same grid
  cell once per analysis run. The derivation first canonicalizes to one row per
  ``(candidate_grid_version, candidate_key)`` — the occurrence with the lowest
  ``(analysis_run_id, id)`` — and verifies every other occurrence is the *same
  geometry*. Identity is topological (``ST_Equals``), so a byte-differing but
  provably identical vertex representation is recorded as a
  ``representation_variant`` rather than mistaken for a conflict; a genuinely
  different geometry is a hard failure. The statistics belong to the versioned
  grid cell and the versioned land-cover release — never to one analysis run.

* **Indexed 4326 prefilter, EPSG:5186 measurement.** Candidate cells and features
  are matched with ``&&`` + ``ST_Intersects`` in the stored EPSG:4326 CRS so the
  existing GiST index on ``environmental_land_cover_features.geometry`` does the
  work; only the matched features are transformed to EPSG:5186, where every
  intersection and every area is computed. Areas are never measured in degrees, and
  no second persistent 5186 copy of the 6.9 M features is created.

* **Union before area.** Evaluated area is the area of the *union* of the polygonal
  intersections, so overlapping source features are counted once. The pre-union sum
  is kept beside it, making the exact source overlap auditable instead of silently
  normalized away. Class areas are likewise per-class unions, rolled up L3 → L2 → L1
  along the source's own (verified consistent) class hierarchy.

* **Exact coverage semantics, no invented tolerance.** ``COMPLETE_EXACT`` means the
  evaluated union topologically covers the whole cell (``ST_Covers``). A cell at
  99.999 % stays ``PARTIAL``. The only numerical guard is a non-negativity clamp
  documented in :data:`GUARD_DESCRIPTION`, and every application of it is counted.

* **Bounded memory, SQL-side computation.** Cells are processed in deterministic
  key-ordered batches; all geometry work happens inside PostgreSQL against
  ``ON COMMIT DROP``-free session-temporary tables that are truncated each batch, so
  neither Python memory nor transient disk grows with the cell count.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import EnvironmentalDatasetVersion, IngestionRun

from .errors import IngestionError

SOURCE_ID = "egis_land_cover"
LAYER_NAME = "land_cover"

#: Deterministic derivation version for this derived product. Deliberately distinct
#: from the suitability ``derivation_version``/``policy_version``, which this phase
#: never reads, writes, or bumps.
DERIVATION_VERSION = "land-cover-cell-stats-v1"

#: Projected metre CRS every area and intersection is measured in. Stored geometry
#: (candidates and land-cover features alike) is EPSG:4326; degrees are never used
#: as an area unit.
AREA_EPSG = 5186
AREA_CRS = f"EPSG:{AREA_EPSG}"
#: CRS the spatial prefilter runs in — the CRS the GiST indexes are actually built on.
PREFILTER_CRS = "EPSG:4326"

#: Coverage statuses. ``COMPLETE_EXACT`` is an exact topological statement
#: (``ST_Covers``), never a percentage threshold.
#: Deterministic dominant-class selection. Greatest class area first, then the
#: ASCENDING official class code — never database row order, so an exact tie always
#: resolves the same way on any machine and any re-run.
DOMINANT_ORDER_BY = "candidate_key, class_level, class_area_m2 DESC, class_code ASC"

STATUS_NO_COVERAGE = "NO_COVERAGE"
STATUS_COMPLETE_EXACT = "COMPLETE_EXACT"
STATUS_PARTIAL = "PARTIAL"

#: Version lifecycle.
VERSION_RUNNING = "RUNNING"
VERSION_SUCCEEDED = "SUCCEEDED"
VERSION_FAILED = "FAILED"

DEFAULT_BATCH_SIZE = 250
#: Refresh planner statistics on the growing target tables every N written batches.
#: The per-batch joins are planned against those statistics, and psycopg3 caches
#: prepared plans; without a periodic ANALYZE a plan chosen when the tables held a
#: few hundred rows would still be in use at ~48,000. ANALYZE also invalidates the
#: cached plans, so each refresh re-plans against reality. It costs ~50 ms.
_ANALYZE_EVERY_BATCHES = 20
_MAX_REPORTED_WARNINGS = 40
_MAX_REPORTED_SAMPLES = 24

#: The one numerical guard, stated exactly. It exists only so a floating-point
#: overlay artifact cannot emit a physically impossible negative area; it is not a
#: coverage, completeness, or overlap tolerance, and every application is counted in
#: ``guard_applied_cell_count`` / ``max_guard_adjustment_m2``.
GUARD_DESCRIPTION = (
    "Non-negativity clamp only: uncovered_area_m2 = GREATEST(cell_area_m2 - "
    "evaluated_area_m2, 0); overlap_area_m2 = GREATEST(intersection_area_sum_m2 - "
    "evaluated_area_m2, 0); coverage_ratio = LEAST(evaluated_area_m2 / cell_area_m2, "
    "1.0). No completeness, coverage, or overlap tolerance is applied anywhere; "
    "COMPLETE_EXACT is decided by ST_Covers alone."
)

COVERAGE_SEMANTICS = (
    "NO_COVERAGE = no polygonal land-cover intersection with the cell; "
    "COMPLETE_EXACT = the polygonal residual ST_CollectionExtract("
    "ST_Difference(cell, evaluated union), 3) is EMPTY in EPSG:5186; "
    "PARTIAL = some polygonal intersection exists but that residual is non-empty. "
    "The rule is exact set-theoretic emptiness — not an area threshold — so PARTIAL "
    "is never promoted to COMPLETE_EXACT for being close to 100%. The raw "
    "ST_Covers(evaluated union, cell) predicate is stored separately as evidence "
    "because GEOS returns false for it on high-vertex clipped unions even when the "
    "residual is provably empty and zero-area; neither result is hidden."
)

#: Region selector aliases, mapped to the official SIDO codes already stored on the
#: candidate rows. Dry-run pilot selector only.
REGION_ALIASES: dict[str, str] = {
    "seoul": "KR-SGIS-11",
    "incheon": "KR-SGIS-23",
    "gyeonggi": "KR-SGIS-31",
}


class LandCoverCellStatisticsError(IngestionError):
    """Raised when the candidate-cell statistics derivation cannot safely proceed."""


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #


@dataclass
class CellStatisticsReport:
    """Structured, sanitized result of one derivation run (no paths, no geometry)."""

    mode: str  # "dry-run" | "write"
    status: str = "SUCCEEDED"  # SUCCEEDED | FAILED
    derivation_version: str = DERIVATION_VERSION
    area_crs: str = AREA_CRS
    prefilter_crs: str = PREFILTER_CRS
    # Inputs.
    land_cover_dataset_version_id: int | None = None
    land_cover_reference_period: str | None = None
    land_cover_source_checksum: str | None = None
    land_cover_license_note: str | None = None
    land_cover_feature_count: int = 0
    land_cover_map_sheet_count: int = 0
    candidate_grid_version: str | None = None
    candidate_grid_fingerprint: str | None = None
    input_signature: str | None = None
    # Canonicalization (Part 2).
    candidate_row_count: int = 0
    distinct_analysis_runs: int = 0
    distinct_candidate_grid_versions: list[str] = field(default_factory=list)
    canonical_cell_count: int = 0
    duplicate_candidate_occurrence_count: int = 0
    geometry_conflict_count: int = 0
    representation_variant_cell_count: int = 0
    null_geometry_count: int = 0
    empty_geometry_count: int = 0
    invalid_canonical_geometry_count: int = 0
    invalid_occurrence_geometry_count: int = 0
    scope_conflict_count: int = 0
    cell_area_min_m2: float | None = None
    cell_area_max_m2: float | None = None
    cell_area_mean_m2: float | None = None
    cell_area_below_full_count: int = 0
    # Selection.
    selectors: dict[str, Any] = field(default_factory=dict)
    selected_cell_count: int = 0
    # Results.
    processed_cell_count: int = 0
    complete_exact_count: int = 0
    partial_count: int = 0
    no_coverage_count: int = 0
    failed_cell_count: int = 0
    cells_by_region: dict[str, int] = field(default_factory=dict)
    total_cell_area_m2: float = 0.0
    total_evaluated_area_m2: float = 0.0
    total_uncovered_area_m2: float = 0.0
    aggregate_coverage_ratio: float | None = None
    total_intersection_area_m2: float = 0.0
    total_overlap_area_m2: float = 0.0
    cells_with_source_overlap: int = 0
    max_overlap_area_m2: float = 0.0
    max_overlap_ratio: float = 0.0
    total_uncovered_residual_area_m2: float = 0.0
    cover_predicate_true_count: int = 0
    guard_applied_cell_count: int = 0
    max_guard_adjustment_m2: float = 0.0
    matched_feature_total: int = 0
    class_row_count: int = 0
    class_rows_by_level: dict[str, int] = field(default_factory=dict)
    dominant_l1_distribution: dict[str, int] = field(default_factory=dict)
    l1_class_area_totals: dict[str, float] = field(default_factory=dict)
    l2_class_area_totals: dict[str, float] = field(default_factory=dict)
    l3_class_area_totals: dict[str, float] = field(default_factory=dict)
    # Persistence.
    statistics_version_id: int | None = None
    statistics_version_created: bool = False
    statistics_version_activated: bool = False
    ingestion_run_id: int | None = None
    inserted_cell_rows: int = 0
    inserted_class_rows: int = 0
    reused_cell_rows: int = 0
    reused_class_rows: int = 0
    materially_changed_rows: int = 0
    max_recomputation_delta_m2: float = 0.0
    # Performance.
    batch_size: int = DEFAULT_BATCH_SIZE
    batch_count: int = 0
    elapsed_seconds: float = 0.0
    cells_per_second: float = 0.0
    peak_rss_mb: float | None = None
    # Diagnostics.
    query_plan: list[str] = field(default_factory=list)
    plan_uses_index_prefilter: bool | None = None
    cell_samples: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def add_warning(self, message: str) -> None:
        if len(self.warnings) < _MAX_REPORTED_WARNINGS and message not in self.warnings:
            self.warnings.append(message)

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "job": "land-cover-cell-stats",
            "layer_name": LAYER_NAME,
            "mode": self.mode,
            "status": self.status,
            "derivation_version": self.derivation_version,
            "area_crs": self.area_crs,
            "prefilter_crs": self.prefilter_crs,
            "coverage_semantics": COVERAGE_SEMANTICS,
            "numerical_guard": GUARD_DESCRIPTION,
            "source": {
                "land_cover_dataset_version_id": self.land_cover_dataset_version_id,
                "reference_period": self.land_cover_reference_period,
                "source_checksum": self.land_cover_source_checksum,
                "license_note": self.land_cover_license_note,
                "feature_count": self.land_cover_feature_count,
                "map_sheet_count": self.land_cover_map_sheet_count,
            },
            "candidate_grid": {
                "candidate_grid_version": self.candidate_grid_version,
                "candidate_grid_fingerprint": self.candidate_grid_fingerprint,
                "candidate_row_count": self.candidate_row_count,
                "distinct_analysis_runs": self.distinct_analysis_runs,
                "distinct_candidate_grid_versions": list(self.distinct_candidate_grid_versions),
                "canonical_cell_count": self.canonical_cell_count,
                "duplicate_candidate_occurrence_count": self.duplicate_candidate_occurrence_count,
                "geometry_conflict_count": self.geometry_conflict_count,
                "representation_variant_cell_count": self.representation_variant_cell_count,
                "null_geometry_count": self.null_geometry_count,
                "empty_geometry_count": self.empty_geometry_count,
                "invalid_canonical_geometry_count": self.invalid_canonical_geometry_count,
                "invalid_occurrence_geometry_count": self.invalid_occurrence_geometry_count,
                "scope_conflict_count": self.scope_conflict_count,
                "cell_area_min_m2": self.cell_area_min_m2,
                "cell_area_max_m2": self.cell_area_max_m2,
                "cell_area_mean_m2": self.cell_area_mean_m2,
                "cell_area_below_full_count": self.cell_area_below_full_count,
            },
            "input_signature": self.input_signature,
            "selectors": self.selectors,
            "selected_cell_count": self.selected_cell_count,
            "results": {
                "processed_cell_count": self.processed_cell_count,
                "complete_exact_count": self.complete_exact_count,
                "partial_count": self.partial_count,
                "no_coverage_count": self.no_coverage_count,
                "failed_cell_count": self.failed_cell_count,
                "cells_by_region": self.cells_by_region,
                "total_cell_area_m2": self.total_cell_area_m2,
                "total_evaluated_area_m2": self.total_evaluated_area_m2,
                "total_uncovered_area_m2": self.total_uncovered_area_m2,
                "aggregate_coverage_ratio": self.aggregate_coverage_ratio,
                "total_intersection_area_m2": self.total_intersection_area_m2,
                "total_overlap_area_m2": self.total_overlap_area_m2,
                "cells_with_source_overlap": self.cells_with_source_overlap,
                "max_overlap_area_m2": self.max_overlap_area_m2,
                "max_overlap_ratio": self.max_overlap_ratio,
                "total_uncovered_residual_area_m2": self.total_uncovered_residual_area_m2,
                "cover_predicate_true_count": self.cover_predicate_true_count,
                "guard_applied_cell_count": self.guard_applied_cell_count,
                "max_guard_adjustment_m2": self.max_guard_adjustment_m2,
                "matched_feature_total": self.matched_feature_total,
                "class_row_count": self.class_row_count,
                "class_rows_by_level": self.class_rows_by_level,
                "dominant_l1_distribution": self.dominant_l1_distribution,
                "l1_class_area_totals": self.l1_class_area_totals,
                "l2_class_area_totals": self.l2_class_area_totals,
                "l3_class_area_totals": self.l3_class_area_totals,
            },
            "persistence": {
                "statistics_version_id": self.statistics_version_id,
                "statistics_version_created": self.statistics_version_created,
                "statistics_version_activated": self.statistics_version_activated,
                "ingestion_run_id": self.ingestion_run_id,
                "inserted_cell_rows": self.inserted_cell_rows,
                "inserted_class_rows": self.inserted_class_rows,
                "reused_cell_rows": self.reused_cell_rows,
                "reused_class_rows": self.reused_class_rows,
                "materially_changed_rows": self.materially_changed_rows,
                "max_recomputation_delta_m2": self.max_recomputation_delta_m2,
            },
            "performance": {
                "batch_size": self.batch_size,
                "batch_count": self.batch_count,
                "elapsed_seconds": round(self.elapsed_seconds, 3),
                "cells_per_second": round(self.cells_per_second, 3),
                "peak_rss_mb": None if self.peak_rss_mb is None else round(self.peak_rss_mb, 1),
            },
            "query_plan": list(self.query_plan),
            "plan_uses_index_prefilter": self.plan_uses_index_prefilter,
            "cell_samples": list(self.cell_samples),
            "warnings": list(self.warnings),
        }


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


def _peak_rss_mb() -> float | None:
    try:
        import resource
        import sys

        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    except Exception:  # noqa: BLE001 - resource unavailable on some platforms
        return None
    divisor = 1024 * 1024 if sys.platform == "darwin" else 1024
    return rss / divisor


def _progress(message: str, *, enabled: bool) -> None:
    if not enabled:
        return
    import sys

    print(message, file=sys.stderr, flush=True)


def compute_input_signature(
    *,
    land_cover_dataset_version_id: int,
    land_cover_source_checksum: str,
    candidate_grid_version: str,
    candidate_grid_fingerprint: str,
    derivation_version: str,
    area_crs: str,
    expected_cell_count: int,
) -> str:
    """Deterministic sha-256 identity of one derived statistics release.

    Depends only on the versioned inputs and the derivation contract — never on a
    surrogate row id, a timestamp, an analysis run, or a scoring profile. Re-running
    the same derivation over the same inputs therefore reproduces the same
    signature, which is the idempotency key.
    """

    payload = {
        "layer_name": LAYER_NAME,
        "land_cover_dataset_version_id": land_cover_dataset_version_id,
        "land_cover_source_checksum": land_cover_source_checksum,
        "candidate_grid_version": candidate_grid_version,
        "candidate_grid_fingerprint": candidate_grid_fingerprint,
        "derivation_version": derivation_version,
        "area_crs": area_crs,
        "expected_cell_count": expected_cell_count,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


# --------------------------------------------------------------------------- #
# Input resolution
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class LandCoverRelease:
    """The resolved active ``land_cover`` release the statistics are derived from."""

    dataset_version_id: int
    reference_period: str
    source_checksum: str
    license_note: str | None
    feature_count: int
    map_sheet_count: int


def resolve_land_cover_release(
    session: Session, *, dataset_version_id: int | None = None
) -> LandCoverRelease:
    """Resolve the intended ``land_cover`` release from database metadata.

    With no explicit id, the *active* release is required to be unambiguous: zero
    or several active ``land_cover`` releases is a visible hard failure, never a
    silent "most recent wins". An explicit id must itself be a ``land_cover``
    release. The surrogate id is never hard-coded anywhere in this module.
    """

    if dataset_version_id is not None:
        row = session.execute(
            select(
                EnvironmentalDatasetVersion.id,
                EnvironmentalDatasetVersion.layer_name,
                EnvironmentalDatasetVersion.reference_period,
                EnvironmentalDatasetVersion.source_checksum,
                EnvironmentalDatasetVersion.license_note,
            ).where(EnvironmentalDatasetVersion.id == dataset_version_id)
        ).first()
        if row is None:
            raise LandCoverCellStatisticsError(
                f"environmental_dataset_versions id {dataset_version_id} does not exist."
            )
        if row.layer_name != LAYER_NAME:
            raise LandCoverCellStatisticsError(
                f"environmental_dataset_versions id {dataset_version_id} is a "
                f"{row.layer_name!r} release, not a {LAYER_NAME!r} release. Refusing to "
                "derive land-cover statistics from a different layer."
            )
        resolved = row
    else:
        rows = session.execute(
            select(
                EnvironmentalDatasetVersion.id,
                EnvironmentalDatasetVersion.layer_name,
                EnvironmentalDatasetVersion.reference_period,
                EnvironmentalDatasetVersion.source_checksum,
                EnvironmentalDatasetVersion.license_note,
            )
            .where(
                EnvironmentalDatasetVersion.layer_name == LAYER_NAME,
                EnvironmentalDatasetVersion.is_active.is_(True),
            )
            .order_by(EnvironmentalDatasetVersion.id)
        ).all()
        if not rows:
            raise LandCoverCellStatisticsError(
                "No active land_cover release found in environmental_dataset_versions. "
                "Load the land-cover dataset before deriving candidate-cell statistics."
            )
        if len(rows) > 1:
            ids = ", ".join(str(r.id) for r in rows)
            raise LandCoverCellStatisticsError(
                f"Active land_cover release is ambiguous: {len(rows)} active releases "
                f"({ids}). Resolve the active-release state, or pass an explicit "
                "--dataset-version-id; the derivation refuses to guess."
            )
        resolved = rows[0]

    counts = session.execute(
        text(
            """
            SELECT
              (SELECT count(*) FROM environmental_land_cover_features
                WHERE dataset_version_id = :v) AS features,
              (SELECT count(*) FROM environmental_land_cover_map_sheets
                WHERE dataset_version_id = :v) AS sheets
            """
        ),
        {"v": resolved.id},
    ).one()
    if counts.features == 0:
        raise LandCoverCellStatisticsError(
            f"land_cover release {resolved.id} has no stored features; nothing to derive."
        )
    return LandCoverRelease(
        dataset_version_id=int(resolved.id),
        reference_period=str(resolved.reference_period),
        source_checksum=str(resolved.source_checksum),
        license_note=resolved.license_note,
        feature_count=int(counts.features),
        map_sheet_count=int(counts.sheets),
    )


def resolve_candidate_grid_version(
    session: Session, *, candidate_grid_version: str | None
) -> tuple[str, list[str]]:
    """Resolve the candidate-grid version, refusing to guess when ambiguous.

    Returns ``(selected, all_present)``. The grid version is read from
    ``suitability_analysis_runs`` — the repository's authoritative field — not from
    a policy constant, so a database that contradicts the expected value is visible
    rather than silently overridden.
    """

    present = [
        str(row.candidate_grid_version)
        for row in session.execute(
            text(
                """
                SELECT DISTINCT candidate_grid_version
                FROM suitability_analysis_runs
                ORDER BY candidate_grid_version
                """
            )
        ).all()
    ]
    if not present:
        raise LandCoverCellStatisticsError(
            "No suitability_analysis_runs rows exist, so no candidate-grid version can be "
            "resolved. A candidate grid must be built before its cells can be described."
        )
    if candidate_grid_version is not None:
        if candidate_grid_version not in present:
            raise LandCoverCellStatisticsError(
                f"Candidate-grid version {candidate_grid_version!r} is not present in "
                f"suitability_analysis_runs (found: {', '.join(present)})."
            )
        return candidate_grid_version, present
    if len(present) > 1:
        raise LandCoverCellStatisticsError(
            "Candidate-grid version is ambiguous: "
            f"{len(present)} versions present ({', '.join(present)}). Pass "
            "--candidate-grid-version explicitly; the derivation refuses to guess."
        )
    return present[0], present


# --------------------------------------------------------------------------- #
# Canonical candidate grid (Part 2)
# --------------------------------------------------------------------------- #

_CANON_TABLE = "_lc_cell_canon"

_CREATE_CANON = f"""
CREATE TEMP TABLE {_CANON_TABLE} AS
WITH occurrence AS (
    SELECT c.candidate_key,
           c.geometry,
           c.sido_region_code, c.sido_region_name,
           c.sigungu_region_code, c.sigungu_region_name,
           c.analysis_run_id, c.id
    FROM suitability_candidates c
    JOIN suitability_analysis_runs r ON r.id = c.analysis_run_id
    WHERE r.candidate_grid_version = :grid
), canonical AS (
    -- Deterministic canonical occurrence: lowest (analysis_run_id, id).
    SELECT DISTINCT ON (candidate_key) *
    FROM occurrence
    ORDER BY candidate_key, analysis_run_id, id
), audit AS (
    SELECT candidate_key,
           count(*) AS occurrence_count,
           count(DISTINCT md5(ST_AsEWKB(geometry))) AS distinct_representations,
           count(*) FILTER (WHERE geometry IS NULL) AS null_occurrences,
           count(*) FILTER (WHERE geometry IS NOT NULL AND ST_IsEmpty(geometry))
               AS empty_occurrences,
           count(*) FILTER (WHERE geometry IS NOT NULL AND NOT ST_IsValid(geometry))
               AS invalid_occurrences,
           count(DISTINCT coalesce(sido_region_code, '~') || '|'
                          || coalesce(sigungu_region_code, '~')) AS distinct_scopes
    FROM occurrence
    GROUP BY candidate_key
)
SELECT k.candidate_key,
       k.geometry AS geometry_4326,
       ST_Transform(k.geometry, {AREA_EPSG}) AS geometry_area_crs,
       ST_Area(ST_Transform(k.geometry, {AREA_EPSG})) AS cell_area_m2,
       encode(
           sha256(ST_AsEWKB(k.geometry)
                  || convert_to(:grid || ':' || k.candidate_key, 'UTF8')),
           'hex'
       ) AS candidate_geometry_fingerprint,
       k.sido_region_code, k.sido_region_name,
       k.sigungu_region_code, k.sigungu_region_name,
       a.occurrence_count,
       (a.distinct_representations - 1) AS representation_variant_count,
       a.null_occurrences, a.empty_occurrences, a.invalid_occurrences, a.distinct_scopes,
       (k.geometry IS NULL) AS canonical_null,
       (k.geometry IS NOT NULL AND ST_IsEmpty(k.geometry)) AS canonical_empty,
       (k.geometry IS NOT NULL AND ST_IsValid(k.geometry)) AS canonical_valid,
       GeometryType(k.geometry) AS canonical_geometry_type,
       ST_SRID(k.geometry) AS canonical_srid,
       row_number() OVER (ORDER BY k.candidate_key) AS seq
FROM canonical k
JOIN audit a USING (candidate_key)
"""

#: Conflict test. A repeated key whose stored bytes differ is only a *conflict* when
#: the geometries are not topologically the same region; ``ST_Equals`` is the exact
#: PostGIS predicate for that and needs no invented tolerance.
_CONFLICT_SQL = f"""
SELECT count(*) AS conflicts
FROM suitability_candidates c
JOIN suitability_analysis_runs r
  ON r.id = c.analysis_run_id AND r.candidate_grid_version = :grid
JOIN {_CANON_TABLE} k ON k.candidate_key = c.candidate_key
WHERE md5(ST_AsEWKB(c.geometry)) IS DISTINCT FROM md5(ST_AsEWKB(k.geometry_4326))
  AND (c.geometry IS NULL OR NOT ST_Equals(c.geometry, k.geometry_4326))
"""

_GRID_FINGERPRINT_SQL = f"""
SELECT encode(
         sha256(convert_to(
           string_agg(candidate_key || '=' || candidate_geometry_fingerprint,
                      E'\\n' ORDER BY candidate_key),
           'UTF8')),
         'hex') AS fingerprint
FROM {_CANON_TABLE}
"""


@dataclass(frozen=True)
class CanonicalGrid:
    """Observed properties of the canonicalized candidate grid."""

    candidate_grid_version: str
    fingerprint: str
    canonical_cell_count: int
    candidate_row_count: int
    distinct_analysis_runs: int
    duplicate_candidate_occurrence_count: int
    representation_variant_cell_count: int
    invalid_occurrence_geometry_count: int
    cell_area_min_m2: float
    cell_area_max_m2: float
    cell_area_mean_m2: float
    cell_area_below_full_count: int


def build_canonical_grid(
    session: Session, *, candidate_grid_version: str, full_grid_cell_area_m2: float = 250_000.0
) -> CanonicalGrid:
    """Materialize and verify the canonical one-row-per-cell candidate grid.

    Creates the session-temporary canonical table, then enforces the Part 2 gates:
    every repeated occurrence must be the same geometry (``ST_Equals``), the
    canonical geometry must be non-null, non-empty, valid, MULTIPOLYGON/4326, and no
    key may carry conflicting region/scope identity. Any violation raises rather
    than being repaired, dropped, or averaged — a candidate geometry is never
    modified by this phase.
    """

    session.execute(text(f"DROP TABLE IF EXISTS {_CANON_TABLE}"))
    session.execute(text(_CREATE_CANON), {"grid": candidate_grid_version})
    session.execute(text(f"CREATE INDEX ON {_CANON_TABLE} USING GIST (geometry_4326)"))
    session.execute(text(f"CREATE INDEX ON {_CANON_TABLE} (seq)"))
    session.execute(text(f"CREATE INDEX ON {_CANON_TABLE} (candidate_key)"))
    session.execute(text(f"ANALYZE {_CANON_TABLE}"))

    stats = session.execute(
        text(
            f"""
            SELECT count(*) AS cells,
                   coalesce(sum(occurrence_count), 0) AS occurrences,
                   coalesce(sum(representation_variant_count), 0) AS variants,
                   coalesce(sum(invalid_occurrences), 0) AS invalid_occurrences,
                   count(*) FILTER (WHERE canonical_null) AS canonical_null,
                   count(*) FILTER (WHERE canonical_empty) AS canonical_empty,
                   count(*) FILTER (WHERE NOT canonical_valid) AS canonical_invalid,
                   count(*) FILTER (WHERE canonical_geometry_type <> 'MULTIPOLYGON')
                       AS wrong_type,
                   count(*) FILTER (WHERE canonical_srid <> 4326) AS wrong_srid,
                   count(*) FILTER (WHERE distinct_scopes > 1) AS scope_conflicts,
                   min(cell_area_m2) AS min_area,
                   max(cell_area_m2) AS max_area,
                   avg(cell_area_m2) AS mean_area,
                   count(*) FILTER (WHERE cell_area_m2 <= 0) AS nonpositive_area,
                   count(*) FILTER (WHERE cell_area_m2 < :full) AS below_full
            FROM {_CANON_TABLE}
            """
        ),
        {"full": full_grid_cell_area_m2},
    ).one()

    if stats.cells == 0:
        raise LandCoverCellStatisticsError(
            f"Candidate-grid version {candidate_grid_version!r} yielded 0 canonical cells."
        )
    problems: list[str] = []
    if stats.canonical_null:
        problems.append(f"{stats.canonical_null} canonical cell(s) have NULL geometry")
    if stats.canonical_empty:
        problems.append(f"{stats.canonical_empty} canonical cell(s) have EMPTY geometry")
    if stats.canonical_invalid:
        problems.append(f"{stats.canonical_invalid} canonical cell(s) have INVALID geometry")
    if stats.wrong_type:
        problems.append(f"{stats.wrong_type} canonical cell(s) are not MULTIPOLYGON")
    if stats.wrong_srid:
        problems.append(f"{stats.wrong_srid} canonical cell(s) are not SRID 4326")
    if stats.nonpositive_area:
        problems.append(f"{stats.nonpositive_area} canonical cell(s) have area <= 0 m²")
    if stats.scope_conflicts:
        problems.append(
            f"{stats.scope_conflicts} candidate key(s) carry conflicting region/scope identity"
        )
    if problems:
        raise LandCoverCellStatisticsError(
            "Canonical candidate grid failed verification: "
            + "; ".join(problems)
            + ". The derivation refuses to measure land cover against unusable candidate "
            "geometry, and never repairs or drops a candidate row."
        )

    conflicts = int(
        session.execute(text(_CONFLICT_SQL), {"grid": candidate_grid_version}).scalar_one()
    )
    if conflicts:
        raise LandCoverCellStatisticsError(
            f"{conflicts} repeated candidate occurrence(s) of grid version "
            f"{candidate_grid_version!r} carry a geometry that is NOT topologically equal "
            "(ST_Equals) to the canonical occurrence. A candidate key with conflicting "
            "geometry is a hard failure: it must be resolved by a human, never merged, "
            "averaged, or auto-selected."
        )

    fingerprint = str(session.execute(text(_GRID_FINGERPRINT_SQL)).scalar_one())
    runs = int(
        session.execute(
            text(
                """
                SELECT count(*) FROM suitability_analysis_runs
                WHERE candidate_grid_version = :grid
                """
            ),
            {"grid": candidate_grid_version},
        ).scalar_one()
    )
    return CanonicalGrid(
        candidate_grid_version=candidate_grid_version,
        fingerprint=fingerprint,
        canonical_cell_count=int(stats.cells),
        candidate_row_count=int(stats.occurrences),
        distinct_analysis_runs=runs,
        duplicate_candidate_occurrence_count=int(stats.occurrences) - int(stats.cells),
        representation_variant_cell_count=int(
            session.execute(
                text(f"SELECT count(*) FROM {_CANON_TABLE} WHERE representation_variant_count > 0")
            ).scalar_one()
        ),
        invalid_occurrence_geometry_count=int(stats.invalid_occurrences),
        cell_area_min_m2=float(stats.min_area),
        cell_area_max_m2=float(stats.max_area),
        cell_area_mean_m2=float(stats.mean_area),
        cell_area_below_full_count=int(stats.below_full),
    )


def apply_cell_selectors(
    session: Session,
    *,
    candidate_keys: Sequence[str] | None,
    region: str | None,
    max_cells: int | None,
) -> int:
    """Restrict the canonical temp table to a deterministic pilot subset.

    Dry-run only (the caller enforces that). Deletes the unselected rows from the
    session-temporary table — never from any persistent table — and re-numbers
    ``seq`` so batching stays deterministic. Returns the selected cell count.
    """

    if candidate_keys:
        session.execute(
            text(f"DELETE FROM {_CANON_TABLE} WHERE NOT (candidate_key = ANY(:keys))"),
            {"keys": list(candidate_keys)},
        )
    if region:
        code = REGION_ALIASES.get(region.strip().lower(), region.strip())
        session.execute(
            text(f"DELETE FROM {_CANON_TABLE} WHERE sido_region_code IS DISTINCT FROM :code"),
            {"code": code},
        )
    if max_cells is not None:
        session.execute(
            text(
                f"DELETE FROM {_CANON_TABLE} WHERE candidate_key NOT IN ("
                f"SELECT candidate_key FROM {_CANON_TABLE} "
                "ORDER BY candidate_key LIMIT :n)"
            ),
            {"n": max(0, max_cells)},
        )
    session.execute(
        text(
            f"UPDATE {_CANON_TABLE} c SET seq = t.rn "
            f"FROM (SELECT candidate_key, row_number() OVER (ORDER BY candidate_key) AS rn "
            f"FROM {_CANON_TABLE}) t WHERE t.candidate_key = c.candidate_key"
        )
    )
    session.execute(text(f"ANALYZE {_CANON_TABLE}"))
    return int(session.execute(text(f"SELECT count(*) FROM {_CANON_TABLE}")).scalar_one())


# --------------------------------------------------------------------------- #
# Batch computation (Part 5)
# --------------------------------------------------------------------------- #

_STAGE_DDL: tuple[str, ...] = (
    """
    CREATE TEMP TABLE IF NOT EXISTS _lc_stage_l3 (
        candidate_key text,
        l1_code text, l1_name text, l2_code text, l2_name text, l3_code text, l3_name text,
        g geometry,
        raw_area double precision,
        feature_count integer
    )
    """,
    """
    CREATE TEMP TABLE IF NOT EXISTS _lc_stage_l2 (
        candidate_key text, l1_code text, l1_name text, l2_code text, l2_name text, g geometry
    )
    """,
    """
    CREATE TEMP TABLE IF NOT EXISTS _lc_stage_l1 (
        candidate_key text, l1_code text, l1_name text, g geometry
    )
    """,
    """
    CREATE TEMP TABLE IF NOT EXISTS _lc_stage_ev (candidate_key text, g geometry)
    """,
    """
    CREATE TEMP TABLE IF NOT EXISTS _lc_stage_classes (
        candidate_key text,
        class_level smallint, class_code text, class_name text, class_area_m2 double precision
    )
    """,
    """
    CREATE TEMP TABLE IF NOT EXISTS _lc_stage_cells (
        candidate_key text,
        candidate_geometry_fingerprint text,
        sido_region_code text, sido_region_name text,
        sigungu_region_code text, sigungu_region_name text,
        cell_area_m2 double precision,
        evaluated_area_m2 double precision,
        uncovered_area_m2 double precision,
        coverage_ratio double precision,
        intersection_area_sum_m2 double precision,
        overlap_area_m2 double precision,
        coverage_status text,
        uncovered_residual_area_m2 double precision,
        topological_cover_predicate boolean,
        matched_feature_count integer,
        dominant_l1_code text, dominant_l1_name text,
        dominant_l2_code text, dominant_l2_name text,
        dominant_l3_code text, dominant_l3_name text,
        l1_class_count integer, l2_class_count integer, l3_class_count integer,
        l1_class_area_sum_m2 double precision,
        l2_class_area_sum_m2 double precision,
        l3_class_area_sum_m2 double precision,
        candidate_occurrence_count integer,
        representation_variant_count integer,
        guard_applied boolean,
        guard_adjustment_m2 double precision
    )
    """,
)

_STAGE_TABLES = (
    "_lc_stage_l3",
    "_lc_stage_l2",
    "_lc_stage_l1",
    "_lc_stage_ev",
    "_lc_stage_classes",
    "_lc_stage_cells",
)

#: The heavy step, and the only one that touches the 6.9 M-row feature table.
#: ``f.geometry && b.geometry_4326`` plus ``ST_Intersects`` in EPSG:4326 is what lets
#: the existing GiST index prefilter; ``ST_Transform`` to the metre CRS is applied
#: only to the surviving matches, and the intersection/area work happens there.
_STEP_L3 = f"""
INSERT INTO _lc_stage_l3 (candidate_key, l1_code, l1_name, l2_code, l2_name,
                          l3_code, l3_name, g, raw_area, feature_count)
WITH batch AS (
    SELECT candidate_key, geometry_4326, geometry_area_crs
    FROM {_CANON_TABLE}
    WHERE seq > :lo AND seq <= :hi
), inter AS (
    SELECT b.candidate_key,
           f.l1_code, f.l1_name, f.l2_code, f.l2_name, f.l3_code, f.l3_name,
           ST_CollectionExtract(
               ST_Intersection(ST_Transform(f.geometry, {AREA_EPSG}), b.geometry_area_crs),
               3
           ) AS g
    FROM batch b
    JOIN environmental_land_cover_features f
      ON f.dataset_version_id = :version
     AND f.geometry && b.geometry_4326
     AND ST_Intersects(f.geometry, b.geometry_4326)
)
SELECT candidate_key, l1_code, l1_name, l2_code, l2_name, l3_code, l3_name,
       ST_Union(g) AS g,
       sum(ST_Area(g)) AS raw_area,
       count(*) AS feature_count
FROM inter
WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)
GROUP BY candidate_key, l1_code, l1_name, l2_code, l2_name, l3_code, l3_name
"""

_STEP_L2 = """
INSERT INTO _lc_stage_l2 (candidate_key, l1_code, l1_name, l2_code, l2_name, g)
SELECT candidate_key, l1_code, l1_name, l2_code, l2_name, ST_Union(g)
FROM _lc_stage_l3
GROUP BY candidate_key, l1_code, l1_name, l2_code, l2_name
"""

_STEP_L1 = """
INSERT INTO _lc_stage_l1 (candidate_key, l1_code, l1_name, g)
SELECT candidate_key, l1_code, l1_name, ST_Union(g)
FROM _lc_stage_l2
GROUP BY candidate_key, l1_code, l1_name
"""

_STEP_EV = """
INSERT INTO _lc_stage_ev (candidate_key, g)
SELECT candidate_key, ST_Union(g) FROM _lc_stage_l1 GROUP BY candidate_key
"""

_STEP_CLASSES = """
INSERT INTO _lc_stage_classes (candidate_key, class_level, class_code, class_name, class_area_m2)
SELECT candidate_key, 1, l1_code, l1_name, ST_Area(g) FROM _lc_stage_l1
UNION ALL
SELECT candidate_key, 2, l2_code, l2_name, ST_Area(g) FROM _lc_stage_l2
UNION ALL
SELECT candidate_key, 3, l3_code, l3_name, ST_Area(g) FROM _lc_stage_l3
"""

_STEP_CELLS = f"""
INSERT INTO _lc_stage_cells (
    candidate_key, candidate_geometry_fingerprint,
    sido_region_code, sido_region_name, sigungu_region_code, sigungu_region_name,
    cell_area_m2, evaluated_area_m2, uncovered_area_m2, coverage_ratio,
    intersection_area_sum_m2, overlap_area_m2, coverage_status,
    uncovered_residual_area_m2, topological_cover_predicate, matched_feature_count,
    dominant_l1_code, dominant_l1_name, dominant_l2_code, dominant_l2_name,
    dominant_l3_code, dominant_l3_name,
    l1_class_count, l2_class_count, l3_class_count,
    l1_class_area_sum_m2, l2_class_area_sum_m2, l3_class_area_sum_m2,
    candidate_occurrence_count, representation_variant_count,
    guard_applied, guard_adjustment_m2
)
WITH batch AS (
    SELECT * FROM {_CANON_TABLE} WHERE seq > :lo AND seq <= :hi
), raw_totals AS (
    SELECT candidate_key,
           sum(raw_area) AS intersection_area_sum,
           sum(feature_count) AS matched_feature_count
    FROM _lc_stage_l3 GROUP BY candidate_key
), level_stats AS (
    SELECT candidate_key, class_level, count(*) AS n, sum(class_area_m2) AS s
    FROM _lc_stage_classes GROUP BY candidate_key, class_level
), dominant AS (
    SELECT DISTINCT ON (candidate_key, class_level)
           candidate_key, class_level, class_code, class_name
    FROM _lc_stage_classes
    -- Deterministic tie-break: greatest area, then ascending official class code.
    ORDER BY {DOMINANT_ORDER_BY}
), evaluated AS (
    SELECT candidate_key,
           CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN 0.0 ELSE ST_Area(g) END AS area,
           (g IS NOT NULL AND NOT ST_IsEmpty(g)) AS has_coverage,
           g
    FROM _lc_stage_ev
), residual AS (
    -- The part of the cell the evaluated union does NOT cover, built constructively.
    -- Emptiness of this polygonal residual is the exact COMPLETE_EXACT rule; its
    -- area is stored as a second, geometry-derived uncovered measure.
    SELECT b.candidate_key,
           ST_CollectionExtract(ST_Difference(b.geometry_area_crs, e.g), 3) AS g,
           ST_Covers(e.g, b.geometry_area_crs) AS covers
    FROM batch b
    JOIN evaluated e ON e.candidate_key = b.candidate_key AND e.has_coverage
)
SELECT b.candidate_key,
       b.candidate_geometry_fingerprint,
       b.sido_region_code, b.sido_region_name,
       b.sigungu_region_code, b.sigungu_region_name,
       b.cell_area_m2,
       coalesce(e.area, 0.0) AS evaluated_area_m2,
       GREATEST(b.cell_area_m2 - coalesce(e.area, 0.0), 0.0) AS uncovered_area_m2,
       LEAST(coalesce(e.area, 0.0) / b.cell_area_m2, 1.0) AS coverage_ratio,
       coalesce(rt.intersection_area_sum, 0.0) AS intersection_area_sum_m2,
       GREATEST(coalesce(rt.intersection_area_sum, 0.0) - coalesce(e.area, 0.0), 0.0)
           AS overlap_area_m2,
       CASE
           WHEN e.has_coverage IS NOT TRUE THEN '{STATUS_NO_COVERAGE}'
           WHEN res.g IS NULL OR ST_IsEmpty(res.g) THEN '{STATUS_COMPLETE_EXACT}'
           ELSE '{STATUS_PARTIAL}'
       END AS coverage_status,
       CASE
           WHEN e.has_coverage IS NOT TRUE THEN b.cell_area_m2
           WHEN res.g IS NULL THEN 0.0
           ELSE ST_Area(res.g)
       END AS uncovered_residual_area_m2,
       coalesce(res.covers, false) AS topological_cover_predicate,
       coalesce(rt.matched_feature_count, 0)::int AS matched_feature_count,
       d1.class_code, d1.class_name, d2.class_code, d2.class_name,
       d3.class_code, d3.class_name,
       coalesce(s1.n, 0)::int, coalesce(s2.n, 0)::int, coalesce(s3.n, 0)::int,
       coalesce(s1.s, 0.0), coalesce(s2.s, 0.0), coalesce(s3.s, 0.0),
       b.occurrence_count::int,
       b.representation_variant_count::int,
       (coalesce(e.area, 0.0) > b.cell_area_m2
        OR coalesce(rt.intersection_area_sum, 0.0) < coalesce(e.area, 0.0)) AS guard_applied,
       GREATEST(coalesce(e.area, 0.0) - b.cell_area_m2, 0.0)
         + GREATEST(coalesce(e.area, 0.0) - coalesce(rt.intersection_area_sum, 0.0), 0.0)
           AS guard_adjustment_m2
FROM batch b
LEFT JOIN evaluated e ON e.candidate_key = b.candidate_key
LEFT JOIN residual res ON res.candidate_key = b.candidate_key
LEFT JOIN raw_totals rt ON rt.candidate_key = b.candidate_key
LEFT JOIN dominant d1 ON d1.candidate_key = b.candidate_key AND d1.class_level = 1
LEFT JOIN dominant d2 ON d2.candidate_key = b.candidate_key AND d2.class_level = 2
LEFT JOIN dominant d3 ON d3.candidate_key = b.candidate_key AND d3.class_level = 3
LEFT JOIN level_stats s1 ON s1.candidate_key = b.candidate_key AND s1.class_level = 1
LEFT JOIN level_stats s2 ON s2.candidate_key = b.candidate_key AND s2.class_level = 2
LEFT JOIN level_stats s3 ON s3.candidate_key = b.candidate_key AND s3.class_level = 3
"""

_INSERT_CELLS = """
INSERT INTO environmental_land_cover_cell_statistics (
    statistics_version_id, land_cover_dataset_version_id, candidate_grid_version,
    candidate_key, candidate_geometry_fingerprint,
    sido_region_code, sido_region_name, sigungu_region_code, sigungu_region_name,
    cell_area_m2, evaluated_area_m2, uncovered_area_m2, coverage_ratio,
    intersection_area_sum_m2, overlap_area_m2, coverage_status,
    uncovered_residual_area_m2, topological_cover_predicate, matched_feature_count,
    dominant_l1_code, dominant_l1_name, dominant_l2_code, dominant_l2_name,
    dominant_l3_code, dominant_l3_name,
    l1_class_count, l2_class_count, l3_class_count,
    l1_class_area_sum_m2, l2_class_area_sum_m2, l3_class_area_sum_m2,
    candidate_occurrence_count, representation_variant_count, guard_applied,
    derivation_version, area_crs, created_at
)
SELECT :sv, :lcv, :grid,
       s.candidate_key, s.candidate_geometry_fingerprint,
       s.sido_region_code, s.sido_region_name, s.sigungu_region_code, s.sigungu_region_name,
       s.cell_area_m2, s.evaluated_area_m2, s.uncovered_area_m2, s.coverage_ratio,
       s.intersection_area_sum_m2, s.overlap_area_m2, s.coverage_status,
       s.uncovered_residual_area_m2, s.topological_cover_predicate, s.matched_feature_count,
       s.dominant_l1_code, s.dominant_l1_name, s.dominant_l2_code, s.dominant_l2_name,
       s.dominant_l3_code, s.dominant_l3_name,
       s.l1_class_count, s.l2_class_count, s.l3_class_count,
       s.l1_class_area_sum_m2, s.l2_class_area_sum_m2, s.l3_class_area_sum_m2,
       s.candidate_occurrence_count, s.representation_variant_count, s.guard_applied,
       :dv, :crs, :now
FROM _lc_stage_cells s
ON CONFLICT DO NOTHING
RETURNING id
"""

#: ``share_of_evaluated_area`` is NULL — never 0 — when the cell has no evaluated
#: area, because the ratio is undefined rather than zero. (A NO_COVERAGE cell has no
#: class rows at all, so this is a defensive definition, not an expected path.)
_INSERT_CLASSES = """
INSERT INTO environmental_land_cover_cell_class_areas (
    statistics_version_id, cell_statistics_id, candidate_key,
    class_level, class_code, class_name, class_area_m2,
    share_of_evaluated_area, share_of_cell_area, created_at
)
SELECT :sv, cs.id, c.candidate_key,
       c.class_level, c.class_code, c.class_name, c.class_area_m2,
       CASE WHEN cs.evaluated_area_m2 > 0 THEN c.class_area_m2 / cs.evaluated_area_m2 END,
       c.class_area_m2 / cs.cell_area_m2,
       :now
FROM _lc_stage_classes c
JOIN environmental_land_cover_cell_statistics cs
  ON cs.statistics_version_id = :sv AND cs.candidate_key = c.candidate_key
ON CONFLICT DO NOTHING
RETURNING id
"""

#: Recomputation comparison for the idempotency proof: every freshly derived value
#: is compared against what is already stored, so a second identical write proves the
#: *computation* is stable, not merely that a unique index rejected a duplicate.
_COMPARE_CELLS = """
SELECT count(*) AS changed,
       coalesce(max(GREATEST(
           abs(s.cell_area_m2 - cs.cell_area_m2),
           abs(s.evaluated_area_m2 - cs.evaluated_area_m2),
           abs(s.uncovered_area_m2 - cs.uncovered_area_m2),
           abs(s.intersection_area_sum_m2 - cs.intersection_area_sum_m2),
           abs(s.overlap_area_m2 - cs.overlap_area_m2),
           abs(s.uncovered_residual_area_m2 - cs.uncovered_residual_area_m2))), 0) AS max_delta
FROM _lc_stage_cells s
JOIN environmental_land_cover_cell_statistics cs
  ON cs.statistics_version_id = :sv AND cs.candidate_key = s.candidate_key
WHERE s.cell_area_m2 IS DISTINCT FROM cs.cell_area_m2
   OR s.evaluated_area_m2 IS DISTINCT FROM cs.evaluated_area_m2
   OR s.uncovered_area_m2 IS DISTINCT FROM cs.uncovered_area_m2
   OR s.coverage_ratio IS DISTINCT FROM cs.coverage_ratio
   OR s.intersection_area_sum_m2 IS DISTINCT FROM cs.intersection_area_sum_m2
   OR s.overlap_area_m2 IS DISTINCT FROM cs.overlap_area_m2
   OR s.coverage_status IS DISTINCT FROM cs.coverage_status
   OR s.uncovered_residual_area_m2 IS DISTINCT FROM cs.uncovered_residual_area_m2
   OR s.topological_cover_predicate IS DISTINCT FROM cs.topological_cover_predicate
   OR s.dominant_l1_code IS DISTINCT FROM cs.dominant_l1_code
   OR s.dominant_l2_code IS DISTINCT FROM cs.dominant_l2_code
   OR s.dominant_l3_code IS DISTINCT FROM cs.dominant_l3_code
   OR s.l1_class_count IS DISTINCT FROM cs.l1_class_count
   OR s.l2_class_count IS DISTINCT FROM cs.l2_class_count
   OR s.l3_class_count IS DISTINCT FROM cs.l3_class_count
   OR s.candidate_geometry_fingerprint IS DISTINCT FROM cs.candidate_geometry_fingerprint
"""


def _truncate_stage(session: Session) -> None:
    session.execute(text("TRUNCATE " + ", ".join(_STAGE_TABLES)))


def _run_batch_computation(session: Session, *, lo: int, hi: int, version_id: int) -> None:
    """Compute one batch of cells entirely inside PostgreSQL."""

    _truncate_stage(session)
    session.execute(text(_STEP_L3), {"lo": lo, "hi": hi, "version": version_id})
    session.execute(text(_STEP_L2))
    session.execute(text(_STEP_L1))
    session.execute(text(_STEP_EV))
    session.execute(text(_STEP_CLASSES))
    session.execute(text(_STEP_CELLS), {"lo": lo, "hi": hi})


@dataclass
class _BatchTotals:
    """Running aggregates accumulated over batches (bounded, not per-cell state)."""

    processed: int = 0
    complete_exact: int = 0
    partial: int = 0
    no_coverage: int = 0
    cells_by_region: dict[str, int] = field(default_factory=dict)
    total_cell_area: float = 0.0
    total_evaluated: float = 0.0
    total_uncovered: float = 0.0
    total_intersection: float = 0.0
    total_overlap: float = 0.0
    cells_with_overlap: int = 0
    max_overlap_area: float = 0.0
    max_overlap_ratio: float = 0.0
    total_residual: float = 0.0
    cover_predicate_true: int = 0
    guard_cells: int = 0
    max_guard_adjustment: float = 0.0
    matched_features: int = 0
    class_rows: int = 0
    class_rows_by_level: dict[str, int] = field(default_factory=dict)
    dominant_l1: dict[str, int] = field(default_factory=dict)
    l1_areas: dict[str, float] = field(default_factory=dict)
    l2_areas: dict[str, float] = field(default_factory=dict)
    l3_areas: dict[str, float] = field(default_factory=dict)


def _accumulate_batch(session: Session, totals: _BatchTotals) -> None:
    """Fold this batch's staged results into the bounded running aggregates."""

    row = session.execute(
        text(
            f"""
            SELECT count(*) AS cells,
                   count(*) FILTER (WHERE coverage_status = '{STATUS_COMPLETE_EXACT}') AS complete,
                   count(*) FILTER (WHERE coverage_status = '{STATUS_PARTIAL}') AS partial,
                   count(*) FILTER (WHERE coverage_status = '{STATUS_NO_COVERAGE}') AS nocov,
                   coalesce(sum(cell_area_m2), 0) AS cell_area,
                   coalesce(sum(evaluated_area_m2), 0) AS evaluated,
                   coalesce(sum(uncovered_area_m2), 0) AS uncovered,
                   coalesce(sum(intersection_area_sum_m2), 0) AS intersection_sum,
                   coalesce(sum(overlap_area_m2), 0) AS overlap,
                   count(*) FILTER (WHERE overlap_area_m2 > 0) AS overlap_cells,
                   coalesce(max(overlap_area_m2), 0) AS max_overlap,
                   coalesce(max(overlap_area_m2 / NULLIF(cell_area_m2, 0)), 0) AS max_overlap_ratio,
                   coalesce(sum(uncovered_residual_area_m2), 0) AS residual,
                   count(*) FILTER (WHERE topological_cover_predicate) AS covers_true,
                   count(*) FILTER (WHERE guard_applied) AS guard_cells,
                   coalesce(max(guard_adjustment_m2), 0) AS max_guard,
                   coalesce(sum(matched_feature_count), 0) AS matched
            FROM _lc_stage_cells
            """
        )
    ).one()
    totals.processed += int(row.cells)
    totals.complete_exact += int(row.complete)
    totals.partial += int(row.partial)
    totals.no_coverage += int(row.nocov)
    totals.total_cell_area += float(row.cell_area)
    totals.total_evaluated += float(row.evaluated)
    totals.total_uncovered += float(row.uncovered)
    totals.total_intersection += float(row.intersection_sum)
    totals.total_overlap += float(row.overlap)
    totals.cells_with_overlap += int(row.overlap_cells)
    totals.max_overlap_area = max(totals.max_overlap_area, float(row.max_overlap))
    totals.max_overlap_ratio = max(totals.max_overlap_ratio, float(row.max_overlap_ratio))
    totals.total_residual += float(row.residual)
    totals.cover_predicate_true += int(row.covers_true)
    totals.guard_cells += int(row.guard_cells)
    totals.max_guard_adjustment = max(totals.max_guard_adjustment, float(row.max_guard))
    totals.matched_features += int(row.matched)

    for region_row in session.execute(
        text(
            "SELECT coalesce(sido_region_code, 'UNASSIGNED') AS code, count(*) AS n "
            "FROM _lc_stage_cells GROUP BY 1"
        )
    ).all():
        key = str(region_row.code)
        totals.cells_by_region[key] = totals.cells_by_region.get(key, 0) + int(region_row.n)

    for dom_row in session.execute(
        text(
            "SELECT coalesce(dominant_l1_code, 'NONE') AS code, count(*) AS n "
            "FROM _lc_stage_cells GROUP BY 1"
        )
    ).all():
        key = str(dom_row.code)
        totals.dominant_l1[key] = totals.dominant_l1.get(key, 0) + int(dom_row.n)

    buckets = {1: totals.l1_areas, 2: totals.l2_areas, 3: totals.l3_areas}
    for class_row in session.execute(
        text(
            "SELECT class_level, class_code, class_name, count(*) AS n, "
            "sum(class_area_m2) AS area FROM _lc_stage_classes "
            "GROUP BY class_level, class_code, class_name"
        )
    ).all():
        level = int(class_row.class_level)
        label = f"{class_row.class_code} {class_row.class_name}"
        bucket = buckets[level]
        bucket[label] = bucket.get(label, 0.0) + float(class_row.area)
        level_key = f"l{level}"
        totals.class_rows_by_level[level_key] = totals.class_rows_by_level.get(level_key, 0) + int(
            class_row.n
        )
        totals.class_rows += int(class_row.n)


def _collect_cell_samples(session: Session, limit: int) -> list[dict[str, Any]]:
    """Sanitized per-cell evidence for the pilot report (no geometry, no paths)."""

    rows = session.execute(
        text(
            """
            SELECT candidate_key, sido_region_code, coverage_status,
                   uncovered_residual_area_m2, topological_cover_predicate,
                   cell_area_m2, evaluated_area_m2, uncovered_area_m2, coverage_ratio,
                   intersection_area_sum_m2, overlap_area_m2, matched_feature_count,
                   dominant_l1_code, dominant_l1_name, dominant_l3_code, dominant_l3_name,
                   l1_class_count, l2_class_count, l3_class_count,
                   l1_class_area_sum_m2, guard_applied
            FROM _lc_stage_cells
            ORDER BY candidate_key
            LIMIT :n
            """
        ),
        {"n": limit},
    ).all()
    return [
        {
            "candidate_key": r.candidate_key,
            "sido_region_code": r.sido_region_code,
            "coverage_status": r.coverage_status,
            "cell_area_m2": round(float(r.cell_area_m2), 3),
            "evaluated_area_m2": round(float(r.evaluated_area_m2), 3),
            "uncovered_area_m2": round(float(r.uncovered_area_m2), 3),
            "uncovered_residual_area_m2": float(r.uncovered_residual_area_m2),
            "topological_cover_predicate": bool(r.topological_cover_predicate),
            "coverage_ratio": round(float(r.coverage_ratio), 9),
            "intersection_area_sum_m2": round(float(r.intersection_area_sum_m2), 3),
            "overlap_area_m2": round(float(r.overlap_area_m2), 6),
            "matched_feature_count": int(r.matched_feature_count),
            "dominant_l1": None
            if r.dominant_l1_code is None
            else f"{r.dominant_l1_code} {r.dominant_l1_name}",
            "dominant_l3": None
            if r.dominant_l3_code is None
            else f"{r.dominant_l3_code} {r.dominant_l3_name}",
            "class_counts": {
                "l1": int(r.l1_class_count),
                "l2": int(r.l2_class_count),
                "l3": int(r.l3_class_count),
            },
            "l1_class_area_sum_m2": round(float(r.l1_class_area_sum_m2), 3),
            "guard_applied": bool(r.guard_applied),
        }
        for r in rows
    ]


def explain_batch_plan(session: Session, *, lo: int, hi: int, version_id: int) -> list[str]:
    """``EXPLAIN`` the heavy intersection step so the index prefilter is provable."""

    rows = session.execute(
        text("EXPLAIN " + _STEP_L3), {"lo": lo, "hi": hi, "version": version_id}
    ).all()
    return [str(row[0]) for row in rows]


def plan_uses_index_prefilter(plan: Sequence[str]) -> bool:
    """True when the plan reaches the feature table through its GiST spatial index."""

    joined = "\n".join(plan)
    return "idx_environmental_land_cover_features_geometry" in joined and (
        "Index Scan" in joined or "Bitmap Index Scan" in joined
    )


# --------------------------------------------------------------------------- #
# Version lifecycle
# --------------------------------------------------------------------------- #


def _get_or_create_version(
    session: Session,
    *,
    release: LandCoverRelease,
    grid: CanonicalGrid,
    signature: str,
    batch_size: int,
    run_id: int,
    now: datetime.datetime,
) -> tuple[int, bool, bool]:
    """Return ``(statistics_version_id, created, previously_succeeded)``.

    An identical re-derivation reuses the existing release row rather than creating
    a second one, so a repeated run can never produce a false second active version.

    Two re-attempt cases are deliberately different:

    * The release is already **SUCCEEDED**. It was proven complete once, and this
      attempt is a verification/top-up. Its row is left untouched here — flipping a
      proven release to RUNNING would leave the database with no active release for
      the hours the re-derivation takes, and would rewrite the completion provenance
      of a release this attempt has not yet disproven.
    * The release is **RUNNING or FAILED** (an interrupted or failed earlier
      attempt). It is genuinely incomplete, so it is reset to RUNNING and inactive
      and takes this attempt's run id. Either way the earlier attempt's
      ``ingestion_runs`` row keeps its own status — attempts are never rewritten.
    """

    existing = session.execute(
        text(
            """
            SELECT id, status FROM environmental_land_cover_cell_stat_versions
            WHERE input_signature = :sig
            """
        ),
        {"sig": signature},
    ).first()
    if existing is not None:
        previously_succeeded = str(existing.status) == VERSION_SUCCEEDED
        if not previously_succeeded:
            session.execute(
                text(
                    """
                    UPDATE environmental_land_cover_cell_stat_versions
                    SET status = :running, is_active = false, ingestion_run_id = :run,
                        started_at = :now, completed_at = NULL, batch_size = :batch
                    WHERE id = :id
                    """
                ),
                {
                    "running": VERSION_RUNNING,
                    "run": run_id,
                    "now": now,
                    "batch": batch_size,
                    "id": existing.id,
                },
            )
        return int(existing.id), False, previously_succeeded

    metadata = {
        "coverage_semantics": COVERAGE_SEMANTICS,
        "numerical_guard": GUARD_DESCRIPTION,
        "prefilter_crs": PREFILTER_CRS,
        "area_crs": AREA_CRS,
        "canonicalization": (
            "one row per (candidate_grid_version, candidate_key); canonical occurrence = "
            "lowest (analysis_run_id, id); every other occurrence verified ST_Equals"
        ),
        "class_area_method": (
            "per-class union of polygonal intersections, rolled up L3 → L2 → L1 along the "
            "source class hierarchy; evaluated area = union of all L1 class geometries"
        ),
        "scoring_role": "none — this release is read by no scoring, ranking, or candidate code",
    }
    inserted = session.execute(
        text(
            """
            INSERT INTO environmental_land_cover_cell_stat_versions (
                land_cover_dataset_version_id, candidate_grid_version,
                candidate_grid_fingerprint, derivation_version, area_crs, input_signature,
                status, expected_cell_count, candidate_row_count,
                duplicate_candidate_occurrence_count, representation_variant_cell_count,
                batch_size, ingestion_run_id, derivation_metadata, is_active,
                started_at, created_at
            ) VALUES (
                :lcv, :grid, :fp, :dv, :crs, :sig,
                :running, :expected, :rows, :dupes, :variants,
                :batch, :run, CAST(:meta AS jsonb), false,
                :now, :now
            )
            RETURNING id
            """
        ),
        {
            "lcv": release.dataset_version_id,
            "grid": grid.candidate_grid_version,
            "fp": grid.fingerprint,
            "dv": DERIVATION_VERSION,
            "crs": AREA_CRS,
            "sig": signature,
            "running": VERSION_RUNNING,
            "expected": grid.canonical_cell_count,
            "rows": grid.candidate_row_count,
            "dupes": grid.duplicate_candidate_occurrence_count,
            "variants": grid.representation_variant_cell_count,
            "batch": batch_size,
            "run": run_id,
            "meta": json.dumps(metadata, ensure_ascii=False),
            "now": now,
        },
    ).scalar_one()
    return int(inserted), True, False


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def run_land_cover_cell_statistics(
    *,
    write: bool,
    candidate_grid_version: str | None = None,
    dataset_version_id: int | None = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
    candidate_keys: Sequence[str] | None = None,
    region: str | None = None,
    max_cells: int | None = None,
    explain: bool = True,
    sample_limit: int = _MAX_REPORTED_SAMPLES,
    session_factory: Any | None = None,
    progress: bool = False,
) -> CellStatisticsReport:
    """Derive candidate-cell land-cover statistics; persist them only when ``write``.

    ``write=False`` runs the identical spatial computation and reports what would be
    stored without inserting a single persistent row (the staging tables are
    session-temporary). A **filtered write is prohibited** — a pilot subset must
    never create or activate a partial derived release.
    """

    selectors = {
        "candidate_keys": list(candidate_keys) if candidate_keys else None,
        "region": region,
        "max_cells": max_cells,
    }
    has_selector = bool(candidate_keys or region or max_cells is not None)
    if write and has_selector:
        raise LandCoverCellStatisticsError(
            "A filtered/partial --write is prohibited: selectors (--candidate-key, --region, "
            "--max-cells) may only be used with --dry-run. A partial derivation must never "
            "create or activate a statistics release."
        )
    if batch_size < 1:
        raise LandCoverCellStatisticsError("--batch-size must be >= 1.")

    report = CellStatisticsReport(
        mode="write" if write else "dry-run", selectors=selectors, batch_size=batch_size
    )
    factory = session_factory or get_sessionmaker()
    session: Session = factory()
    started = time.perf_counter()
    run: IngestionRun | None = None
    previously_succeeded = False
    now = _utcnow()
    try:
        release = resolve_land_cover_release(session, dataset_version_id=dataset_version_id)
        report.land_cover_dataset_version_id = release.dataset_version_id
        report.land_cover_reference_period = release.reference_period
        report.land_cover_source_checksum = release.source_checksum
        report.land_cover_license_note = release.license_note
        report.land_cover_feature_count = release.feature_count
        report.land_cover_map_sheet_count = release.map_sheet_count

        grid_version, all_versions = resolve_candidate_grid_version(
            session, candidate_grid_version=candidate_grid_version
        )
        report.candidate_grid_version = grid_version
        report.distinct_candidate_grid_versions = all_versions

        _progress(f"  [canonicalize] grid {grid_version}", enabled=progress)
        grid = build_canonical_grid(session, candidate_grid_version=grid_version)
        report.candidate_grid_fingerprint = grid.fingerprint
        report.canonical_cell_count = grid.canonical_cell_count
        report.candidate_row_count = grid.candidate_row_count
        report.distinct_analysis_runs = grid.distinct_analysis_runs
        report.duplicate_candidate_occurrence_count = grid.duplicate_candidate_occurrence_count
        report.representation_variant_cell_count = grid.representation_variant_cell_count
        report.invalid_occurrence_geometry_count = grid.invalid_occurrence_geometry_count
        report.cell_area_min_m2 = grid.cell_area_min_m2
        report.cell_area_max_m2 = grid.cell_area_max_m2
        report.cell_area_mean_m2 = grid.cell_area_mean_m2
        report.cell_area_below_full_count = grid.cell_area_below_full_count
        if grid.representation_variant_cell_count:
            report.add_warning(
                f"{grid.representation_variant_cell_count} candidate key(s) are stored with more "
                "than one byte-distinct geometry representation across analysis runs; every "
                "variant was verified topologically identical (ST_Equals) to the canonical "
                "occurrence and is recorded, not hidden."
            )
        if grid.invalid_occurrence_geometry_count:
            report.add_warning(
                f"{grid.invalid_occurrence_geometry_count} non-canonical candidate occurrence(s) "
                "carry an invalid (self-intersecting) stored geometry. Every canonical geometry "
                "used for measurement is valid; the invalid occurrences are pre-existing "
                "suitability data and were neither modified nor repaired."
            )

        signature = compute_input_signature(
            land_cover_dataset_version_id=release.dataset_version_id,
            land_cover_source_checksum=release.source_checksum,
            candidate_grid_version=grid.candidate_grid_version,
            candidate_grid_fingerprint=grid.fingerprint,
            derivation_version=DERIVATION_VERSION,
            area_crs=AREA_CRS,
            expected_cell_count=grid.canonical_cell_count,
        )
        report.input_signature = signature

        selected = grid.canonical_cell_count
        if has_selector:
            selected = apply_cell_selectors(
                session, candidate_keys=candidate_keys, region=region, max_cells=max_cells
            )
            if selected == 0:
                raise LandCoverCellStatisticsError(
                    "The pilot selectors matched 0 canonical cells; nothing to compute."
                )
        report.selected_cell_count = selected

        for ddl in _STAGE_DDL:
            session.execute(text(ddl))

        version_id: int | None = None
        if write:
            run = IngestionRun(
                source_id=SOURCE_ID,
                started_at=now,
                status="RUNNING",
                rows_received=selected,
                rows_inserted=0,
                rows_updated=0,
                rows_rejected=0,
                reference_period=release.reference_period,
                transformation_version=DERIVATION_VERSION,
            )
            session.add(run)
            # Committed on its own so an attempt that fails later still leaves an
            # honest FAILED run row behind (a rollback would erase the attempt).
            session.commit()
            session.refresh(run)
            report.ingestion_run_id = run.run_id
            version_id, created, previously_succeeded = _get_or_create_version(
                session,
                release=release,
                grid=grid,
                signature=signature,
                batch_size=batch_size,
                run_id=run.run_id,
                now=now,
            )
            report.statistics_version_id = version_id
            report.statistics_version_created = created
            session.commit()

        if explain:
            report.query_plan = explain_batch_plan(
                session, lo=0, hi=min(batch_size, selected), version_id=release.dataset_version_id
            )
            report.plan_uses_index_prefilter = plan_uses_index_prefilter(report.query_plan)
            if report.plan_uses_index_prefilter is False:
                report.add_warning(
                    "The batch query plan does not show a GiST/bbox index prefilter on "
                    "environmental_land_cover_features.geometry; a sequential scan over 6.9 M "
                    "features would be unsafe at full scale."
                )

        totals = _BatchTotals()
        lo = 0
        while lo < selected:
            hi = min(lo + batch_size, selected)
            _run_batch_computation(session, lo=lo, hi=hi, version_id=release.dataset_version_id)
            _accumulate_batch(session, totals)
            if not report.cell_samples and sample_limit:
                report.cell_samples = _collect_cell_samples(session, sample_limit)
            if write:
                assert version_id is not None
                inserted_cells = sum(
                    1
                    for _ in session.execute(
                        text(_INSERT_CELLS),
                        {
                            "sv": version_id,
                            "lcv": release.dataset_version_id,
                            "grid": grid.candidate_grid_version,
                            "dv": DERIVATION_VERSION,
                            "crs": AREA_CRS,
                            "now": now,
                        },
                    )
                )
                inserted_classes = sum(
                    1
                    for _ in session.execute(text(_INSERT_CLASSES), {"sv": version_id, "now": now})
                )
                comparison = session.execute(text(_COMPARE_CELLS), {"sv": version_id}).one()
                report.inserted_cell_rows += inserted_cells
                report.inserted_class_rows += inserted_classes
                report.reused_cell_rows += (hi - lo) - inserted_cells
                report.materially_changed_rows += int(comparison.changed)
                report.max_recomputation_delta_m2 = max(
                    report.max_recomputation_delta_m2, float(comparison.max_delta)
                )
                if report.batch_count % _ANALYZE_EVERY_BATCHES == 0:
                    session.execute(
                        text(
                            "ANALYZE environmental_land_cover_cell_statistics, "
                            "environmental_land_cover_cell_class_areas"
                        )
                    )
                session.commit()
            report.batch_count += 1
            lo = hi
            _progress(
                f"  [{report.mode} {lo}/{selected}] cells "
                f"(complete {totals.complete_exact}, partial {totals.partial}, "
                f"no-coverage {totals.no_coverage})",
                enabled=progress,
            )

        report.processed_cell_count = totals.processed
        report.complete_exact_count = totals.complete_exact
        report.partial_count = totals.partial
        report.no_coverage_count = totals.no_coverage
        report.cells_by_region = dict(sorted(totals.cells_by_region.items()))
        report.total_cell_area_m2 = totals.total_cell_area
        report.total_evaluated_area_m2 = totals.total_evaluated
        report.total_uncovered_area_m2 = totals.total_uncovered
        report.aggregate_coverage_ratio = (
            totals.total_evaluated / totals.total_cell_area if totals.total_cell_area > 0 else None
        )
        report.total_intersection_area_m2 = totals.total_intersection
        report.total_overlap_area_m2 = totals.total_overlap
        report.cells_with_source_overlap = totals.cells_with_overlap
        report.max_overlap_area_m2 = totals.max_overlap_area
        report.max_overlap_ratio = totals.max_overlap_ratio
        report.total_uncovered_residual_area_m2 = totals.total_residual
        report.cover_predicate_true_count = totals.cover_predicate_true
        report.guard_applied_cell_count = totals.guard_cells
        report.max_guard_adjustment_m2 = totals.max_guard_adjustment
        report.matched_feature_total = totals.matched_features
        report.class_row_count = totals.class_rows
        report.class_rows_by_level = dict(sorted(totals.class_rows_by_level.items()))
        report.dominant_l1_distribution = dict(sorted(totals.dominant_l1.items()))
        report.l1_class_area_totals = dict(sorted(totals.l1_areas.items()))
        report.l2_class_area_totals = dict(sorted(totals.l2_areas.items()))
        report.l3_class_area_totals = dict(sorted(totals.l3_areas.items()))

        if totals.processed != selected:
            raise LandCoverCellStatisticsError(
                f"Processed {totals.processed} cell(s) but {selected} were selected; refusing to "
                "present an incomplete derivation as complete."
            )

        if write:
            assert version_id is not None and run is not None
            _finalize_version(
                session, version_id=version_id, report=report, grid=grid, now=_utcnow()
            )
            run.status = "SUCCEEDED"
            run.completed_at = _utcnow()
            run.rows_received = selected
            run.rows_inserted = report.inserted_cell_rows + report.inserted_class_rows
            session.commit()
    except Exception as exc:
        session.rollback()
        report.status = "FAILED"
        report.add_warning(f"Derivation failed and was rolled back: {exc}")
        if write and report.statistics_version_id is not None and not previously_succeeded:
            # An honest terminal state: a release this attempt created (or an
            # already-incomplete one it was retrying) stays FAILED and inactive.
            # A release that was ALREADY proven complete is deliberately left alone —
            # a failed re-verification does not unmake the earlier proof, and the
            # failure is recorded on this attempt's ingestion_runs row instead.
            session.execute(
                text(
                    """
                    UPDATE environmental_land_cover_cell_stat_versions
                    SET status = :failed, is_active = false, completed_at = :now
                    WHERE id = :id
                    """
                ),
                {"failed": VERSION_FAILED, "now": _utcnow(), "id": report.statistics_version_id},
            )
        elif write and previously_succeeded:
            report.add_warning(
                "This attempt failed while re-verifying an ALREADY SUCCEEDED statistics "
                "version; that release was proven complete by an earlier run and was left "
                "active and unchanged. The failure is recorded on this attempt's "
                "ingestion_runs row."
            )
        if run is not None:
            run.status = "FAILED"
            run.completed_at = _utcnow()
            run.error_category = type(exc).__name__
            run.error_message = str(exc)[:2000]
            session.add(run)
        session.commit()
        raise
    finally:
        report.elapsed_seconds = time.perf_counter() - started
        report.cells_per_second = (
            report.processed_cell_count / report.elapsed_seconds if report.elapsed_seconds else 0.0
        )
        report.peak_rss_mb = _peak_rss_mb()
        session.close()
    return report


def _finalize_version(
    session: Session,
    *,
    version_id: int,
    report: CellStatisticsReport,
    grid: CanonicalGrid,
    now: datetime.datetime,
) -> None:
    """Activate the release only after every expected canonical cell has a valid row.

    ``now`` is the *completion* instant, deliberately taken at call time rather than
    reusing the run-start timestamp the written rows share as ``created_at``. A
    multi-hour derivation must not report ``completed_at == started_at``.

    The completeness proof is read back from the *persisted* rows, not from the
    in-process counters, so a resumed or partially-written derivation cannot activate
    itself on the strength of a stale tally.
    """

    stored = session.execute(
        text(
            f"""
            SELECT count(*) AS cells,
                   count(*) FILTER (WHERE coverage_status = '{STATUS_COMPLETE_EXACT}') AS complete,
                   count(*) FILTER (WHERE coverage_status = '{STATUS_PARTIAL}') AS partial,
                   count(*) FILTER (WHERE coverage_status = '{STATUS_NO_COVERAGE}') AS nocov,
                   count(*) FILTER (WHERE cell_area_m2 <= 0
                                       OR evaluated_area_m2 < 0
                                       OR uncovered_area_m2 < 0
                                       OR coverage_ratio < 0 OR coverage_ratio > 1
                                       OR overlap_area_m2 < 0) AS impossible,
                   coalesce(sum(cell_area_m2), 0) AS cell_area,
                   coalesce(sum(evaluated_area_m2), 0) AS evaluated,
                   coalesce(sum(uncovered_area_m2), 0) AS uncovered,
                   coalesce(sum(intersection_area_sum_m2), 0) AS intersection_sum,
                   coalesce(sum(overlap_area_m2), 0) AS overlap,
                   count(*) FILTER (WHERE overlap_area_m2 > 0) AS overlap_cells,
                   coalesce(max(overlap_area_m2), 0) AS max_overlap,
                   coalesce(max(overlap_area_m2 / NULLIF(cell_area_m2, 0)), 0) AS max_overlap_ratio,
                   count(*) FILTER (WHERE guard_applied) AS guard_cells
            FROM environmental_land_cover_cell_statistics
            WHERE statistics_version_id = :sv
            """
        ),
        {"sv": version_id},
    ).one()
    missing = int(
        session.execute(
            text(
                f"""
                SELECT count(*) FROM {_CANON_TABLE} c
                WHERE NOT EXISTS (
                    SELECT 1 FROM environmental_land_cover_cell_statistics s
                    WHERE s.statistics_version_id = :sv AND s.candidate_key = c.candidate_key
                )
                """
            ),
            {"sv": version_id},
        ).scalar_one()
    )
    class_rows = int(
        session.execute(
            text(
                "SELECT count(*) FROM environmental_land_cover_cell_class_areas "
                "WHERE statistics_version_id = :sv"
            ),
            {"sv": version_id},
        ).scalar_one()
    )
    if missing or int(stored.cells) != grid.canonical_cell_count:
        raise LandCoverCellStatisticsError(
            f"Refusing to activate statistics version {version_id}: {stored.cells} stored cell "
            f"row(s) for {grid.canonical_cell_count} expected canonical cell(s), {missing} "
            "missing. An incomplete derivation must never become an active release."
        )
    if stored.impossible:
        raise LandCoverCellStatisticsError(
            f"Refusing to activate statistics version {version_id}: {stored.impossible} stored "
            "row(s) carry impossible area/ratio values."
        )

    report.reused_class_rows = class_rows - report.inserted_class_rows
    # Standard is_active supersession: a *different* release of the same (source
    # release, grid version, derivation version) is deactivated, never deleted, and
    # the supersession is reported rather than performed silently. Re-running the
    # identical derivation matches no other row, so nothing is superseded.
    superseded = session.execute(
        text(
            """
            UPDATE environmental_land_cover_cell_stat_versions SET is_active = false
            WHERE is_active
              AND id <> :id
              AND land_cover_dataset_version_id = (
                    SELECT land_cover_dataset_version_id
                    FROM environmental_land_cover_cell_stat_versions WHERE id = :id)
              AND candidate_grid_version = (
                    SELECT candidate_grid_version
                    FROM environmental_land_cover_cell_stat_versions WHERE id = :id)
              AND derivation_version = (
                    SELECT derivation_version
                    FROM environmental_land_cover_cell_stat_versions WHERE id = :id)
            RETURNING id
            """
        ),
        {"id": version_id},
    ).all()
    if superseded:
        report.add_warning(
            "Superseded "
            + ", ".join(str(row.id) for row in superseded)
            + " (previously active statistics version(s) for the same land-cover release, "
            "candidate-grid version, and derivation version). The rows are preserved, only "
            "is_active was cleared."
        )
    session.execute(
        text(
            """
            UPDATE environmental_land_cover_cell_stat_versions SET
                status = :ok, is_active = true, completed_at = :now,
                processed_cell_count = :cells,
                complete_exact_count = :complete, partial_count = :partial,
                no_coverage_count = :nocov, failed_cell_count = 0,
                total_cell_area_m2 = :cell_area, total_evaluated_area_m2 = :evaluated,
                total_uncovered_area_m2 = :uncovered,
                aggregate_coverage_ratio = :ratio,
                total_intersection_area_m2 = :intersection_sum,
                total_overlap_area_m2 = :overlap,
                cells_with_source_overlap = :overlap_cells,
                max_overlap_area_m2 = :max_overlap, max_overlap_ratio = :max_overlap_ratio,
                guard_applied_cell_count = :guard_cells,
                max_guard_adjustment_m2 = :max_guard,
                class_row_count = :class_rows
            WHERE id = :id
            """
        ),
        {
            "ok": VERSION_SUCCEEDED,
            "now": now,
            "cells": int(stored.cells),
            "complete": int(stored.complete),
            "partial": int(stored.partial),
            "nocov": int(stored.nocov),
            "cell_area": float(stored.cell_area),
            "evaluated": float(stored.evaluated),
            "uncovered": float(stored.uncovered),
            "ratio": (
                float(stored.evaluated) / float(stored.cell_area)
                if float(stored.cell_area) > 0
                else None
            ),
            "intersection_sum": float(stored.intersection_sum),
            "overlap": float(stored.overlap),
            "overlap_cells": int(stored.overlap_cells),
            "max_overlap": float(stored.max_overlap),
            "max_overlap_ratio": float(stored.max_overlap_ratio),
            "guard_cells": int(stored.guard_cells),
            "max_guard": report.max_guard_adjustment_m2,
            "class_rows": class_rows,
            "id": version_id,
        },
    )
    report.statistics_version_activated = True
    report.class_row_count = class_rows
