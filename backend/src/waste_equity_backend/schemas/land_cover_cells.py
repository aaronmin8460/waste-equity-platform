"""Read-only response schemas for candidate-cell land-cover statistics (Phase 1B-LC4).

Serves the derived statistics that Phase 1B-LC3 persisted: for every canonical 500 m
candidate-grid cell, the land-cover composition of the acquired 세분류 [2025]
토지피복지도 release. These schemas expose **descriptive** measurements only.

Three invariants are structural here, not merely documented in prose:

1. **Coverage status is never flattened into a completeness claim.** Every response
   that carries land-cover composition also carries ``coverage_status`` and
   ``coverage_ratio``, so a consumer cannot render partial data as complete.
   ``NO_COVERAGE`` means the acquired land-cover extent does not evaluate that cell —
   it never means the land is empty, unused, vacant, safe, or suitable.
2. **Uncovered area is never a land-cover class.** ``uncovered_area_m2`` lives on the
   cell, never in a class distribution. No ``UNKNOWN``/``UNCLASSIFIED`` pseudo-class
   is synthesized, and a ``NO_COVERAGE`` cell simply has no class rows.
3. **Undefined ratios are ``null``, never ``0``.** A zero share and an undefined
   share are different facts and are serialized differently.

Nothing here is a score, weight, exclusion, rank, or candidate status, and no
suitability result reads it: every response states
``used_in_suitability_scoring: false``. See ``docs/LAND_COVER_CELL_STATISTICS_API.md``.
"""

from __future__ import annotations

import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# --- Canonical layer identity ------------------------------------------------
LAND_COVER_LAYER_NAME = "land_cover"
LAND_COVER_KOREAN_LABEL = "토지피복"
#: Machine name of the derived product this router serves (distinct from the raw
#: land-cover layer above, which LC2 ingested and this API never exposes per-feature).
CELL_STATISTICS_PRODUCT_NAME = "land_cover_candidate_cell_statistics"

# --- Coverage vocabulary -----------------------------------------------------
CoverageStatus = Literal["COMPLETE_EXACT", "PARTIAL", "NO_COVERAGE"]

#: The exact LC3 meaning of each status, restated verbatim by the API so a consumer
#: never has to infer it. These are set-theoretic statements about the *acquired
#: release*, not statements about the land.
COVERAGE_STATUS_SEMANTICS: dict[str, str] = {
    "COMPLETE_EXACT": (
        "The polygonal residual of (candidate cell − evaluated land-cover union) is "
        "EMPTY under the LC3 exact topology rule. This is exact set-theoretic "
        "emptiness, not an area threshold: a cell is never promoted to "
        "COMPLETE_EXACT for being close to 100% covered."
    ),
    "PARTIAL": (
        "Some polygonal land-cover intersection exists, but the candidate cell has a "
        "non-empty uncovered residual. The class distribution therefore describes "
        "only the evaluated part of the cell."
    ),
    "NO_COVERAGE": (
        "No polygonal land-cover feature from the acquired release intersects the "
        "candidate cell. This means ONLY that the acquired land-cover extent does not "
        "evaluate this cell. It does NOT mean that no land cover exists, that the land "
        "is empty, unused, or vacant, or that the cell is safe or suitable. Such a "
        "cell has no class rows at all."
    ),
}

#: Korean-language disclosure for UI surfaces, so the API and the future frontend
#: assert the same text rather than drifting apart.
NO_COVERAGE_KOREAN_WARNING = (
    "‘미평가(NO_COVERAGE)’는 확보된 토지피복 자료의 범위가 해당 후보 격자를 "
    "평가하지 않았다는 뜻입니다. 토지피복이 없거나 비어 있거나 이용되지 않는 "
    "토지라는 의미가 아니며, 적합하거나 안전하다는 의미도 아닙니다."
)
UNCOVERED_AREA_STATEMENT = (
    "uncovered_area_m2 is a coverage measurement on the cell, never a land-cover "
    "class. No UNKNOWN or UNCLASSIFIED class is synthesized from uncovered area."
)
CLASS_LABEL_STATEMENT = (
    "Official source class codes and Korean names are preserved verbatim as stored by "
    "LC3 — never translated, normalized, renamed, re-grouped, or merged."
)
#: Public-use status. LC2 recorded the licence as pending written clarification; LC4
#: only preserves that status and must not upgrade it.
LICENSE_STATUS = "LOCAL_USE_ONLY_PENDING_CLARIFICATION"
LICENSE_STATEMENT = (
    "Public-use/licence clarification for the acquired 토지피복지도 release is still "
    "pending written confirmation from the provider. KOGL Type 1 is NOT claimed and "
    "commercial-use permission is NOT claimed. Local analytical use only."
)
SCORING_STATEMENT = (
    "These statistics are descriptive and are not used in suitability scoring: no "
    "score, rank, status, exclusion, review reason, weight, policy version, or "
    "suitability derivation version reads them."
)
RAW_FEATURE_STATEMENT = (
    "This API exposes only aggregated per-cell statistics. Raw land-cover feature "
    "geometry and per-feature records are never returned."
)
AVAILABILITY_STATEMENT = (
    "Implemented and verified against a local development database only. Production/OCI "
    "availability has not been established by this phase."
)

# --- Pagination bounds ------------------------------------------------------
#: Project convention: the wetland list uses 50/200, the suitability candidate list
#: 50/500 and 500/5000. The active release holds 47,893 cells, so a 50-row default
#: with a hard 500-row ceiling keeps every page bounded and small.
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 500
#: A cell's complete class distribution is bounded by the source class vocabulary
#: (L1 7 + L2 22 + L3 41 = 70 codes at most), so it is returned whole, unpaginated.
MAX_CLASS_ROWS_PER_CELL = 70


class LandCoverCellStatisticsLifecycle(BaseModel):
    """Per-aspect lifecycle of the candidate-cell land-cover statistics product.

    These are documented phase states, not live health checks. ``scoring_integration``
    is ``NOT_IMPLEMENTED`` by contract and ``production_deployment`` is ``NOT_RUN``:
    this phase is a local, read-only API over already-derived statistics.
    """

    source_contract_validation: str
    database_ingestion: str
    cell_statistics_derivation: str
    api_exposure: str
    frontend_exposure: str
    vector_tiles: str
    scoring_integration: str
    production_deployment: str


class LandCoverCellStatisticsDisclosures(BaseModel):
    """Structured disclosures carried by every response envelope.

    Deliberately structured rather than prose-only, so a consumer cannot render the
    statistics while dropping the qualifications that make them honest.
    """

    reference_period: str | None
    license_status: str = LICENSE_STATUS
    license_statement: str = LICENSE_STATEMENT
    license_note: str | None = None
    used_in_suitability_scoring: bool = False
    scoring_statement: str = SCORING_STATEMENT
    coverage_status_semantics: dict[str, str] = Field(
        default_factory=lambda: dict(COVERAGE_STATUS_SEMANTICS)
    )
    no_coverage_warning_ko: str = NO_COVERAGE_KOREAN_WARNING
    uncovered_area_statement: str = UNCOVERED_AREA_STATEMENT
    class_label_statement: str = CLASS_LABEL_STATEMENT
    raw_feature_exposure_statement: str = RAW_FEATURE_STATEMENT
    availability_statement: str = AVAILABILITY_STATEMENT
    lifecycle: LandCoverCellStatisticsLifecycle


class LandCoverSourceReleaseOut(BaseModel):
    """Provenance of the acquired land-cover release the statistics derive from."""

    dataset_version_id: int
    layer_name: str = LAND_COVER_LAYER_NAME
    korean_label: str = LAND_COVER_KOREAN_LABEL
    provider: str
    official_dataset_name: str
    provider_dataset_identifier: str
    official_source_url: str | None
    #: Year-only reference period (LC2 stores ``reference_period``, not a date).
    reference_period: str | None
    source_crs: str
    storage_crs: str
    source_encoding: str | None
    transformation_version: str
    declared_feature_count: int | None
    #: sha-256 identifier of the acquired source set. Safe to publish: it identifies
    #: the release without revealing any local path or raw file.
    source_checksum: str | None
    license_note: str | None


class LandCoverOverlapAuditOut(BaseModel):
    """Source-overlap audit for a release.

    LC3 unions before measuring area, so overlapping source features are counted once;
    the pre-union sum is kept beside the union area so overlap is auditable rather than
    normalized away. On the observed release the overlap is numerically negligible, but
    it is reported rather than suppressed.
    """

    total_intersection_area_m2: float
    total_overlap_area_m2: float
    cells_with_source_overlap: int
    max_overlap_area_m2: float
    max_overlap_ratio: float


class LandCoverNumericalGuardAuditOut(BaseModel):
    """Audit of LC3's only numerical guard (a documented non-negativity clamp)."""

    guard_applied_cell_count: int
    max_guard_adjustment_m2: float
    definition: str = (
        "Non-negativity clamp only: uncovered_area_m2 = GREATEST(cell − evaluated, 0); "
        "overlap_area_m2 = GREATEST(intersection sum − evaluated, 0); coverage_ratio = "
        "LEAST(evaluated / cell, 1.0). No completeness, coverage, or overlap tolerance "
        "is applied anywhere."
    )


class LandCoverCanonicalizationAuditOut(BaseModel):
    """How LC3 collapsed run-scoped candidate rows to one row per grid cell.

    The canonical occurrence of a cell is the lowest ``(analysis_run_id, id)``; every
    other occurrence of the same key was proven ``ST_Equals`` to it. Repeated
    occurrences and byte-differing-but-identical representations are counted, never
    silently absorbed.
    """

    candidate_row_count: int
    duplicate_candidate_occurrence_count: int
    representation_variant_cell_count: int
    rule: str = (
        "One row per (candidate_grid_version, candidate_key); canonical occurrence = "
        "lowest (analysis_run_id, id); every other occurrence verified ST_Equals."
    )


class LandCoverStatisticsReleaseOut(BaseModel):
    """The active derived statistics release, with full identity and provenance."""

    statistics_version_id: int
    status: str
    is_active: bool
    derivation_version: str
    area_crs: str
    #: sha-256 idempotency key over the release's versioned inputs.
    input_signature: str
    candidate_grid_version: str
    #: sha-256 over every canonical cell's (key, geometry fingerprint) in key order:
    #: proves which grid the release was computed against, independent of run ids.
    candidate_grid_fingerprint: str
    expected_cell_count: int
    processed_cell_count: int
    failed_cell_count: int
    coverage_status_counts: dict[str, int]
    class_row_count: int
    total_cell_area_m2: float
    total_evaluated_area_m2: float
    total_uncovered_area_m2: float
    #: total_evaluated_area_m2 / total_cell_area_m2 — area-weighted, never a mean of
    #: per-cell ratios. ``null`` when the total cell area is zero.
    aggregate_coverage_ratio: float | None
    overlap_audit: LandCoverOverlapAuditOut
    numerical_guard_audit: LandCoverNumericalGuardAuditOut
    canonicalization_audit: LandCoverCanonicalizationAuditOut
    started_at: datetime.datetime
    completed_at: datetime.datetime | None
    source_release: LandCoverSourceReleaseOut
    #: LC3's recorded derivation metadata, verbatim. Sanitized at write time: method
    #: description only, no local path, geometry, or per-feature payload.
    derivation_metadata: dict[str, object] | None
    disclosures: LandCoverCellStatisticsDisclosures


class LandCoverStatisticsReleaseRef(BaseModel):
    """Compact release identity for list/detail/summary envelopes.

    Kept small on purpose: the full release document is served by its own endpoint, so
    a paginated page never repeats heavyweight provenance per row.
    """

    statistics_version_id: int
    status: str
    derivation_version: str
    area_crs: str
    candidate_grid_version: str
    candidate_grid_fingerprint: str
    land_cover_dataset_version_id: int
    reference_period: str | None
    expected_cell_count: int
    processed_cell_count: int


class LandCoverClassAreaOut(BaseModel):
    """One official land-cover class's area inside one candidate cell.

    ``class_code``/``class_name`` are the official source values, verbatim.
    ``share_of_evaluated_area`` is ``null`` — never ``0`` — when the cell has no
    evaluated area, because the ratio is undefined rather than zero.
    """

    model_config = ConfigDict(from_attributes=True)

    class_level: int
    class_code: str
    class_name: str
    class_area_m2: float
    #: class_area_m2 / evaluated_area_m2 (the covered part of the cell).
    share_of_evaluated_area: float | None
    #: class_area_m2 / cell_area_m2 (the whole cell, covered or not).
    share_of_cell_area: float


class LandCoverCellClassCountsOut(BaseModel):
    """Distinct classes observed per level, and the exact stored per-level area sums.

    The per-level sum is LC3's documented reconciliation denominator: it equals
    ``evaluated_area_m2`` when the source partitions the evaluated part of the cell.
    """

    l1_class_count: int
    l2_class_count: int
    l3_class_count: int
    l1_class_area_sum_m2: float
    l2_class_area_sum_m2: float
    l3_class_area_sum_m2: float


class LandCoverDominantClassOut(BaseModel):
    """Largest class by intersection area at each level.

    Ties break on the ascending official class code, never on database row order. All
    fields are ``null`` for a ``NO_COVERAGE`` cell, where a dominant class is undefined.
    """

    l1_code: str | None
    l1_name: str | None
    l2_code: str | None
    l2_name: str | None
    l3_code: str | None
    l3_name: str | None


class LandCoverCellSummaryOut(BaseModel):
    """One candidate cell as a lean list row.

    Carries the coverage fields alongside the dominant class so a list or map can
    never present a dominant class without its coverage qualification. The complete
    class distribution and the full audit fields live on the detail endpoints.
    """

    model_config = ConfigDict(from_attributes=True)

    candidate_grid_version: str
    candidate_key: str
    sido_region_code: str | None
    sido_region_name: str | None
    sigungu_region_code: str | None
    sigungu_region_name: str | None
    cell_area_m2: float
    evaluated_area_m2: float
    uncovered_area_m2: float
    coverage_ratio: float
    coverage_status: CoverageStatus
    dominant_l1_code: str | None
    dominant_l1_name: str | None
    l1_class_count: int
    l2_class_count: int
    l3_class_count: int


class LandCoverCellListResponse(BaseModel):
    """Bounded, deterministically-ordered page of candidate cells.

    Release identity and disclosures sit once on the envelope, never per row.
    """

    items: list[LandCoverCellSummaryOut]
    total: int
    limit: int
    offset: int
    has_more: bool
    sort: str
    applied_filters: dict[str, object]
    release: LandCoverStatisticsReleaseRef
    disclosures: LandCoverCellStatisticsDisclosures


class LandCoverCellDetailOut(BaseModel):
    """Complete land-cover statistics for one canonical candidate cell.

    No land-cover feature geometry is returned, and no candidate geometry is
    duplicated here: the candidate's own geometry is already served by the existing
    suitability candidate endpoints, which remain the single source for it.
    """

    candidate_grid_version: str
    candidate_key: str
    #: sha-256 over the canonical cell geometry (EWKB) + grid version + key. Ties this
    #: row to the exact geometry every area was measured on.
    candidate_geometry_fingerprint: str
    sido_region_code: str | None
    sido_region_name: str | None
    sigungu_region_code: str | None
    sigungu_region_name: str | None
    #: Measured clipped cell area — never assumed to be 250,000 m², because
    #: boundary-clipped edge cells are genuinely smaller.
    cell_area_m2: float
    #: Area of the UNION of all polygonal land-cover intersections with this cell.
    evaluated_area_m2: float
    #: Arithmetic uncovered area (cell − evaluated).
    uncovered_area_m2: float
    #: Geometry-derived uncovered area: ST_Area of the polygonal residual
    #: ST_Difference(cell, evaluated union). Kept beside the arithmetic value so the
    #: two independent measures can be compared rather than assumed equal.
    uncovered_residual_area_m2: float
    coverage_ratio: float
    coverage_status: CoverageStatus
    coverage_status_meaning: str
    #: Raw ``ST_Covers(evaluated union, cell)`` result, stored by LC3 as evidence only.
    #: It is NOT the status rule: GEOS returns false on high-vertex clipped unions even
    #: when the residual is provably empty, so both answers are kept auditable.
    topological_cover_predicate: bool
    #: Pre-union sum of per-feature intersection areas, beside the union area.
    intersection_area_sum_m2: float
    overlap_area_m2: float
    matched_feature_count: int
    dominant_class: LandCoverDominantClassOut
    class_counts: LandCoverCellClassCountsOut
    #: Occurrences of this key across all runs of the grid version, and byte-distinct
    #: geometry representations beyond the canonical one proven ST_Equals to it.
    candidate_occurrence_count: int
    representation_variant_count: int
    #: True when LC3's documented non-negativity guard changed a reported value here.
    guard_applied: bool
    derivation_version: str
    area_crs: str
    used_in_suitability_scoring: bool = False
    release: LandCoverStatisticsReleaseRef
    disclosures: LandCoverCellStatisticsDisclosures


class LandCoverCellClassesResponse(BaseModel):
    """Complete L1/L2/L3 class distribution for one candidate cell.

    Ordering is deterministic: ``class_level`` ascending, then ``class_area_m2``
    descending, then ``class_code`` ascending. A ``NO_COVERAGE`` cell returns an empty
    list — never a synthetic uncovered class.
    """

    candidate_grid_version: str
    candidate_key: str
    coverage_status: CoverageStatus
    coverage_status_meaning: str
    cell_area_m2: float
    evaluated_area_m2: float
    uncovered_area_m2: float
    coverage_ratio: float
    class_level_filter: int | None
    items: list[LandCoverClassAreaOut]
    total: int
    class_counts: LandCoverCellClassCountsOut
    used_in_suitability_scoring: bool = False
    release: LandCoverStatisticsReleaseRef
    disclosures: LandCoverCellStatisticsDisclosures


class LandCoverDominantClassCountOut(BaseModel):
    """How many cells have a given official L1 class as their dominant class."""

    class_code: str
    class_name: str
    cell_count: int


class LandCoverClassAreaTotalOut(BaseModel):
    """Total stored area of one official L1 class across the selected cells."""

    class_code: str
    class_name: str
    total_area_m2: float
    #: total_area_m2 / (sum of l1_class_area_sum_m2 over the selected cells), i.e. the
    #: share of measured L1 class area. ``null`` when that denominator is zero.
    share_of_l1_class_area: float | None


class LandCoverAggregateSummaryOut(BaseModel):
    """Aggregate statistics over the selected cells of the active release.

    Areas are summed and ``aggregate_coverage_ratio`` is the area-weighted
    ``total_evaluated_area_m2 / total_cell_area_m2`` — never a mean of per-cell ratios,
    which would weight a clipped edge cell the same as a full one.
    """

    scope: dict[str, object]
    cell_count: int
    coverage_status_counts: dict[str, int]
    total_cell_area_m2: float
    total_evaluated_area_m2: float
    total_uncovered_area_m2: float
    aggregate_coverage_ratio: float | None
    #: Cells with no dominant class because they have no coverage. Reported as its own
    #: count rather than as a null-coded class row, so no pseudo-class is invented.
    cells_without_dominant_class: int
    dominant_l1_distribution: list[LandCoverDominantClassCountOut]
    l1_area_distribution: list[LandCoverClassAreaTotalOut]
    total_l1_class_area_m2: float
    release: LandCoverStatisticsReleaseRef
    disclosures: LandCoverCellStatisticsDisclosures


class LandCoverCellStatisticsError(BaseModel):
    """Structured error detail. Never carries SQL, a path, or a stack trace."""

    error: str
    detail: str
