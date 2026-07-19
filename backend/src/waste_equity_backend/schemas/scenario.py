"""Request/response schemas for the user-weight scenario lab (Phase 6).

A user-weight scenario recombines the frozen Z/R/E/D component scores of ONE
fixed succeeded run under user-supplied weights, on read. Nothing here is a
stored profile, an analytical run, a CRITIC/stability result, or a legal /
permitting / final-siting determination. Scores and weights are exact decimal
strings. See ``docs/SUITABILITY_USER_WEIGHT_SCENARIOS.md``.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# The comparison profile is a *stored* official/analytical profile. A user
# scenario is never one of these — it is compared against one of them.
CompareProfile = Literal["baseline", "equal", "equity_focused", "access_focused", "critic"]


class UserWeightScenarioRequest(BaseModel):
    """Preview request. ``run_id`` omitted → latest succeeded run.

    ``weights`` is an open ``{component: decimal-string}`` map so unknown/missing
    components and out-of-range/NaN values surface as the structured
    ``INVALID_SCENARIO_WEIGHTS`` 422 (validated in the scenario domain layer),
    not a generic pydantic error.
    """

    run_id: int | None = None
    weights: dict[str, str]
    compare_profile: CompareProfile = "baseline"
    top_n: int = Field(default=10, ge=1, le=50)
    selected_candidate_id: int | None = None


class UserScenarioCandidateDetailRequest(BaseModel):
    """Candidate-detail request for a single candidate under a scenario."""

    run_id: int | None = None
    weights: dict[str, str]
    compare_profile: CompareProfile = "baseline"


class ScenarioContribution(BaseModel):
    """One component's contribution to the custom score (all exact strings)."""

    component: str
    component_score: str | None
    weight: str
    weighted_contribution: str | None


class UserScenarioTopCandidate(BaseModel):
    candidate_id: int
    candidate_key: str
    sido_region_code: str | None
    sido_region_name: str | None
    sigungu_region_code: str | None
    sigungu_region_name: str | None
    custom_score: str
    custom_rank: int
    comparison_profile: str
    comparison_score: str | None
    comparison_rank: int | None
    rank_delta: int | None
    rank_change_direction: str | None
    zoning_score: str | None
    road_score: str | None
    equity_score: str | None
    demand_score: str | None
    stable_count: int | None
    stability_class: str | None
    centroid_lon: float | None
    centroid_lat: float | None


class UserScenarioCandidateDetailOut(BaseModel):
    candidate_id: int
    run_id: int
    candidate_key: str
    status: str
    is_excluded: bool
    method_version: str
    scenario_hash: str
    scenario_hash_short: str
    canonical_weights: dict[str, str]
    compare_profile: str
    # Custom scenario results. ELIGIBLE → custom_score + custom_rank; REVIEW →
    # custom_provisional_score only (no final score, no rank); EXCLUDED → none.
    custom_score: str | None
    custom_provisional_score: str | None
    custom_rank: int | None
    comparison_score: str | None
    comparison_rank: int | None
    rank_delta: int | None
    rank_change_direction: str | None
    zoning_score: str | None
    road_score: str | None
    equity_score: str | None
    demand_score: str | None
    # component_score · scenario weight per component (sums to custom_score within
    # the documented 4-dp quantization).
    contributions: list[ScenarioContribution]
    # Stored-run weight-sensitivity stability (NOT recomputed under the scenario).
    stable_count: int | None
    stability_class: str | None
    stability_membership: dict[str, bool]
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
    nearest_road_distance_m: str | None
    nearest_road_provenance: dict[str, Any]
    component_provenance: dict[str, Any]
    centroid_lon: float | None
    centroid_lat: float | None
    geometry: dict[str, Any]
    reference_year: int
    policy_version: str
    derivation_version: str
    candidate_grid_version: str
    scenario_label: str
    scenario_disclaimer: str
    screening_disclaimer: str


class UserWeightScenarioPreviewOut(BaseModel):
    scenario_hash: str
    scenario_hash_short: str
    method_version: str
    run_id: int
    reference_year: int
    policy_version: str
    derivation_version: str
    candidate_grid_version: str
    canonical_weights: dict[str, str]
    compare_profile: str
    candidate_count_total: int
    candidate_count_eligible: int
    candidate_count_review: int
    candidate_count_excluded: int
    # Number of ELIGIBLE candidates ranked (full population before LIMIT).
    ranking_population: int
    top_candidates: list[UserScenarioTopCandidate]
    selected_candidate: UserScenarioCandidateDetailOut | None
    # Relative MVT template (client resolves against the page origin). Includes the
    # canonical weights + scenario_hash so a tile is fully determined by the URL.
    tile_url: str
    assumptions: list[str]
    scenario_label: str
    scenario_disclaimer: str
    screening_disclaimer: str
