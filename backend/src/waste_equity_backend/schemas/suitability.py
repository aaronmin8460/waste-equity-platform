"""Response schemas for the Phase 5.4 suitability screening API.

Every response labels the output as analytical screening only and never emits a
legal-eligibility boolean. Scores are served as exact decimal strings; geometry
is GeoJSON (EPSG:4326). See ``docs/SUITABILITY_POLICY_V1.md``.

**Component-model contract.** Every run-scoped and candidate-bearing response
carries the run's own ``component_model_version`` and ``component_order``, so a
client can never render one model's numbers under another model's labels held in
its own glossary. The per-candidate score representation mirrors storage exactly:

* historical (``suitability-components-zred-v1``) runs populate the four legacy
  ``zoning_score`` / ``road_score`` / ``equity_score`` / ``demand_score`` fields
  exactly as they always have, and emit ``component_scores`` as ``{}``;
* any other component model emits its scores in ``component_scores`` and the four
  legacy fields as explicit ``null`` — present, never omitted, never reused.

Nothing is dual-emitted: a second copy of an authoritative analytical value can
drift from the first. See ``docs/SUITABILITY_COMPONENT_MODEL_CONTRACT.md``.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

SCREENING_DISCLAIMER = (
    "Analytical screening only — decision support, not a legal permit, engineering "
    "certification, final facility decision, or statutory determination. ELIGIBLE means "
    "'passes the v1 analytical screening rules', not 'legally eligible'; EXCLUDED is a "
    "PROJECT_SCREENING_EXCLUSION, not a statutory prohibition; road distance is an access "
    "proxy, not proof of truck accessibility."
)


class SuitabilityPolicyOut(BaseModel):
    policy_version: str
    derivation_version: str
    candidate_grid_version: str
    critic_method_version: str
    stability_method_version: str
    # Which component model the *currently implemented* policy describes, and the
    # order its components are enumerated in. /policies describes live policy, not
    # a stored run, so these are the module's own identity — unlike every run-scoped
    # endpoint, which reports the stored run's own identity.
    component_model_version: str
    component_order: list[str]
    statuses: list[str]
    # Policy-assumption profiles with fixed weights (``critic`` is intentionally
    # absent — it is data-derived per run, never a policy constant).
    weight_profiles: dict[str, dict[str, str]]
    static_weight_profiles: dict[str, dict[str, str]]
    # Catalog of data-derived profiles (method + provenance, no fixed weights).
    data_derived_profiles: dict[str, Any]
    supported_profiles: list[str]
    stability_profiles: list[str]
    stability_top_fraction: str
    profile_methodology: dict[str, str]
    default_profile: str
    weight_rationale: dict[str, str]
    hard_exclusion_codes: dict[str, str]
    review_codes: dict[str, str]
    zoning_registry: dict[str, Any]
    road_distance_curve: list[list[str]]
    grid: dict[str, Any]
    disclaimer: str


class SuitabilityRunOut(BaseModel):
    id: int
    derivation_version: str
    policy_version: str
    candidate_grid_version: str
    # This run's OWN component-model identity, read from the run row — never the
    # running code's constants.
    component_model_version: str
    component_order: list[str]
    reference_year: int
    boundary_vintage: str
    weight_profile: str
    analysis_signature: str
    status: str
    candidate_count_total: int
    candidate_count_eligible: int
    candidate_count_review: int
    candidate_count_excluded: int
    input_dataset_version_ids: list[int]
    input_provenance: dict[str, Any]
    # Actual run weight profiles ({profile: {component: weight}}), including the
    # run-specific ``critic`` vector when the run computed it ({} on old runs).
    weight_profiles: dict[str, Any]
    # Transparent CRITIC derivation metadata ({} on historical/pre-CRITIC runs).
    weight_derivation: dict[str, Any]
    # Stability definition ({} on historical/pre-stability runs).
    stability_definition: dict[str, Any]
    started_at: datetime.datetime
    completed_at: datetime.datetime | None
    created_at: datetime.datetime


class SuitabilityRunListEnvelope(BaseModel):
    count: int
    runs: list[SuitabilityRunOut]


class SuitabilitySummaryOut(BaseModel):
    run_id: int
    reference_year: int
    policy_version: str
    derivation_version: str
    candidate_grid_version: str
    component_model_version: str
    component_order: list[str]
    weight_profile: str
    candidate_count_total: int
    candidate_count_eligible: int
    candidate_count_review: int
    candidate_count_excluded: int
    exclusion_reason_counts: dict[str, int]
    review_reason_counts: dict[str, int]
    sido_distribution: dict[str, dict[str, int]]
    top_candidates: list[dict[str, Any]]
    # Weight-sensitivity stability (baseline/equal/critic). Counts are 0 and the
    # actual weights / definition are empty for runs without CRITIC/stability data.
    critic_weights: dict[str, str] | None
    stability_top_fraction: str | None
    stability_top_cutoff_rank: int | None
    candidate_count_stable: int
    candidate_count_conditionally_stable: int
    candidate_count_weight_sensitive: int
    top_stable_candidates: list[dict[str, Any]]
    stability_definition: dict[str, Any]
    stability_available: bool
    coverage_notes: list[str]
    assumptions: list[str]
    disclaimer: str


class CandidateProperties(BaseModel):
    candidate_id: int
    candidate_key: str
    status: str
    profile: str
    is_excluded: bool
    rank: int | None
    total_score: str | None
    provisional_score: str | None
    # Legacy (zred-v1) component scores: populated for historical runs, explicit
    # null for every other component model. Never reused to carry another quantity.
    zoning_score: str | None
    road_score: str | None
    equity_score: str | None
    demand_score: str | None
    # Version-aware component scores keyed by the run's own component names: the
    # authoritative representation for non-historical models, {} for historical
    # runs (whose scores are the four fields above).
    component_scores: dict[str, str | None] = Field(default_factory=dict)
    sido_region_code: str | None
    sido_region_name: str | None
    sigungu_region_code: str | None
    sigungu_region_name: str | None
    nearest_road_distance_m: str | None
    # Weight-sensitivity stability (ELIGIBLE only; null/{} otherwise).
    stable_count: int | None
    stability_class: str | None
    stability_membership: dict[str, bool]
    exclusion_reasons: list[str]
    review_reasons: list[str]


class CandidateFeature(BaseModel):
    type: str = "Feature"
    geometry: dict[str, Any]
    properties: CandidateProperties


class SuitabilityCandidateCollection(BaseModel):
    type: str = "FeatureCollection"
    indicator: str
    derivation_version: str
    policy_version: str
    candidate_grid_version: str
    component_model_version: str
    component_order: list[str]
    weight_profile: str
    reference_year: int
    run_id: int
    count: int
    # Rows on this page vs. rows matching every filter. ``total_matched`` is counted
    # by the database over the same WHERE clause the page is drawn from — it is never
    # inferred from ``count`` — so "표시 N개 · 범위 내 M개" stays truthful under
    # pagination.
    total_matched: int
    limit: int
    offset: int
    # The scope and ordering actually applied, after region-code normalization and
    # de-duplication. Echoed so a caller can confirm the server read its scope the way
    # it meant it instead of inferring that from an empty result.
    sido: str | None = None
    sigungu: list[str] = Field(default_factory=list)
    sort: str = "score_desc"
    features: list[CandidateFeature]
    assumptions: list[str]
    disclaimer: str


class CandidateDetailOut(BaseModel):
    candidate_id: int
    run_id: int
    candidate_key: str
    profile: str
    status: str
    is_excluded: bool
    rank: int | None
    total_score: str | None
    provisional_score: str | None
    # Legacy (zred-v1) component scores: populated for historical runs, explicit
    # null for every other component model.
    zoning_score: Decimal | None
    road_score: Decimal | None
    equity_score: Decimal | None
    demand_score: Decimal | None
    # Version-aware component scores keyed by the run's own component names ({} for
    # historical runs).
    component_scores: dict[str, str | None] = Field(default_factory=dict)
    profile_totals: dict[str, Any]
    profile_ranks: dict[str, Any]
    # Weight-sensitivity stability (ELIGIBLE only; null/{} otherwise).
    stable_count: int | None
    stability_class: str | None
    stability_membership: dict[str, bool]
    sido_region_code: str | None
    sido_region_name: str | None
    sigungu_region_code: str | None
    sigungu_region_name: str | None
    exclusion_reasons: list[str]
    review_reasons: list[str]
    penalties: list[str]
    raw_components: dict[str, Any]
    nearest_road_distance_m: Decimal | None
    nearest_road_provenance: dict[str, Any]
    component_provenance: dict[str, Any]
    original_area_m2: Decimal
    clipped_area_m2: Decimal
    clipped_area_ratio: Decimal
    geometry: dict[str, Any]
    reference_year: int
    policy_version: str
    derivation_version: str
    candidate_grid_version: str
    component_model_version: str
    component_order: list[str]
    weights: dict[str, str]
    disclaimer: str
