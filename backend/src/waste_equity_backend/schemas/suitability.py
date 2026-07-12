"""Response schemas for the Phase 5.4 suitability screening API.

Every response labels the output as analytical screening only and never emits a
legal-eligibility boolean. Scores are served as exact decimal strings; geometry
is GeoJSON (EPSG:4326). See ``docs/SUITABILITY_POLICY_V1.md``.
"""

from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel

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
    statuses: list[str]
    weight_profiles: dict[str, dict[str, str]]
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
    weight_profile: str
    candidate_count_total: int
    candidate_count_eligible: int
    candidate_count_review: int
    candidate_count_excluded: int
    exclusion_reason_counts: dict[str, int]
    review_reason_counts: dict[str, int]
    sido_distribution: dict[str, dict[str, int]]
    top_candidates: list[dict[str, Any]]
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
    zoning_score: str | None
    road_score: str | None
    equity_score: str | None
    demand_score: str | None
    sido_region_code: str | None
    sido_region_name: str | None
    sigungu_region_code: str | None
    sigungu_region_name: str | None
    nearest_road_distance_m: str | None
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
    weight_profile: str
    reference_year: int
    run_id: int
    count: int
    total_matched: int
    limit: int
    offset: int
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
    zoning_score: Decimal | None
    road_score: Decimal | None
    equity_score: Decimal | None
    demand_score: Decimal | None
    profile_totals: dict[str, Any]
    profile_ranks: dict[str, Any]
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
    weights: dict[str, str]
    disclaimer: str
