/**
 * The Page-5C selected-candidate model.
 *
 * What these assertions defend, in order of how badly a regression would mislead a
 * reader: that a contribution is the SERVER's product and never a client-side
 * multiplication; that a missing rank stays missing; that the 주요 영향 요인 is a
 * plain argmax with a deterministic tie-break; and that a delta of two fixed-point
 * decimals is exact rather than floating.
 *
 * Every fixture is synthetic and carries no official label.
 */

import { describe, expect, it } from "vitest";

import type {
  UserScenarioCandidateDetail,
  UserScenarioPreview,
  UserScenarioTopCandidate,
  UserScenarioWeights,
} from "./api";
import {
  candidateChoices,
  candidateContributionRows,
  candidateIdentityConflict,
  findChoice,
  formatContributionDelta,
  majorImpactFactor,
  majorImpactSentence,
  previewPlacement,
  resolvedCandidateKey,
  totalScoreDelta,
  type CandidateSideResult,
} from "./scenarioCandidateComparison";

const WEIGHTS_A: UserScenarioWeights = {
  zoning: "0.25000000",
  road: "0.25000000",
  equity: "0.25000000",
  demand: "0.25000000",
};
const WEIGHTS_B: UserScenarioWeights = {
  zoning: "0.10000000",
  road: "0.20000000",
  equity: "0.30000000",
  demand: "0.40000000",
};

function topCandidate(overrides: Partial<UserScenarioTopCandidate> = {}): UserScenarioTopCandidate {
  return {
    candidate_id: 11,
    candidate_key: "CELL-0011",
    sido_region_code: "KR-SGIS-31",
    sido_region_name: "경기도",
    sigungu_region_code: "KR-SGIS-31-390",
    sigungu_region_name: "시흥시",
    custom_score: "76.2500",
    custom_rank: 1,
    comparison_profile: "baseline",
    comparison_score: "70.0000",
    comparison_rank: 3,
    rank_delta: 2,
    rank_change_direction: "up",
    zoning_score: "55.0000",
    road_score: "100.0000",
    equity_score: "100.0000",
    demand_score: "50.0000",
    stable_count: 3,
    stability_class: "STABLE",
    centroid_lon: 126.8,
    centroid_lat: 37.4,
    ...overrides,
  };
}

function preview(overrides: Partial<UserScenarioPreview> = {}): UserScenarioPreview {
  return {
    scenario_hash: "hash-a",
    scenario_hash_short: "hasha",
    method_version: "scenario-v1",
    run_id: 47,
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    canonical_weights: WEIGHTS_A,
    compare_profile: "baseline",
    candidate_count_total: 100,
    candidate_count_eligible: 10,
    candidate_count_review: 40,
    candidate_count_excluded: 50,
    ranking_population: 10,
    top_candidates: [topCandidate()],
    selected_candidate: null,
    tile_url: "/tiles",
    assumptions: [],
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "임시 비교 결과입니다.",
    screening_disclaimer: "광역 분석 스크리닝",
    ...overrides,
  };
}

/**
 * A candidate detail whose contributions are the SERVER's own products.
 *
 * The numbers mirror the backend integration fixture
 * (`test_detail_eligible_with_contributions`): 55×0.25, 100×0.25, 100×0.25, 50×0.25,
 * summing to the served `custom_score` of 76.2500.
 */
function detail(overrides: Partial<UserScenarioCandidateDetail> = {}): UserScenarioCandidateDetail {
  return {
    candidate_id: 11,
    run_id: 47,
    candidate_key: "CELL-0011",
    status: "ELIGIBLE",
    is_excluded: false,
    method_version: "scenario-v1",
    scenario_hash: "hash-a",
    scenario_hash_short: "hasha",
    canonical_weights: WEIGHTS_A,
    compare_profile: "baseline",
    custom_score: "76.2500",
    custom_provisional_score: null,
    custom_rank: 1,
    comparison_score: "70.0000",
    comparison_rank: 3,
    rank_delta: 2,
    rank_change_direction: "up",
    zoning_score: "55.0000",
    road_score: "100.0000",
    equity_score: "100.0000",
    demand_score: "50.0000",
    contributions: [
      { component: "zoning", component_score: "55.0000", weight: "0.25000000", weighted_contribution: "13.7500" },
      { component: "road", component_score: "100.0000", weight: "0.25000000", weighted_contribution: "25.0000" },
      { component: "equity", component_score: "100.0000", weight: "0.25000000", weighted_contribution: "25.0000" },
      { component: "demand", component_score: "50.0000", weight: "0.25000000", weighted_contribution: "12.5000" },
    ],
    stable_count: 3,
    stability_class: "STABLE",
    stability_membership: {},
    profile_totals: {},
    profile_ranks: {},
    sido_region_code: "KR-SGIS-31",
    sido_region_name: "경기도",
    sigungu_region_code: "KR-SGIS-31-390",
    sigungu_region_name: "시흥시",
    exclusion_reasons: [],
    review_reasons: [],
    penalties: [],
    raw_components: {},
    nearest_road_distance_m: "120.0",
    nearest_road_provenance: {},
    component_provenance: {},
    centroid_lon: 126.8,
    centroid_lat: 37.4,
    geometry: { type: "Point", coordinates: [126.8, 37.4] },
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "임시 비교 결과입니다.",
    screening_disclaimer: "광역 분석 스크리닝",
    ...overrides,
  };
}

/** The same cell under B안's weights: 55×0.10, 100×0.20, 100×0.30, 50×0.40. */
const DETAIL_B = detail({
  scenario_hash: "hash-b",
  scenario_hash_short: "hashb",
  canonical_weights: WEIGHTS_B,
  custom_score: "75.5000",
  custom_rank: 2,
  contributions: [
    { component: "zoning", component_score: "55.0000", weight: "0.10000000", weighted_contribution: "5.5000" },
    { component: "road", component_score: "100.0000", weight: "0.20000000", weighted_contribution: "20.0000" },
    { component: "equity", component_score: "100.0000", weight: "0.30000000", weighted_contribution: "30.0000" },
    { component: "demand", component_score: "50.0000", weight: "0.40000000", weighted_contribution: "20.0000" },
  ],
});

function sideResult(
  slot: "A" | "B",
  value: UserScenarioCandidateDetail | null,
  state: CandidateSideResult["state"] = value ? "READY" : "BLOCKED",
): CandidateSideResult {
  return { slot, state, detail: value, errorMessage: null };
}

// --------------------------------------------------------------------------- //

describe("candidateChoices", () => {
  it("offers the UNION of both sides' previews, marking which side listed each", () => {
    const a = preview({ top_candidates: [topCandidate({ candidate_id: 11, custom_rank: 1 })] });
    const b = preview({
      top_candidates: [
        topCandidate({ candidate_id: 11, custom_rank: 2 }),
        topCandidate({ candidate_id: 22, candidate_key: "CELL-0022", custom_rank: 1 }),
      ],
    });
    const choices = candidateChoices(a, b);
    // Cell 11 is rank 1 in A and rank 2 in B, so its best rank is 1 — the same as
    // cell 22's. The tie falls to the stable candidate_key, which is the point.
    expect(choices.map((c) => c.candidateId)).toEqual([11, 22]);
    expect(choices.find((c) => c.candidateId === 22)).toMatchObject({ inA: false, inB: true });
    expect(choices.find((c) => c.candidateId === 11)).toMatchObject({ inA: true, inB: true });
  });

  it("orders by best served rank, then by the stable candidate_key", () => {
    const a = preview({
      top_candidates: [
        topCandidate({ candidate_id: 3, candidate_key: "CELL-C", custom_rank: 5 }),
        topCandidate({ candidate_id: 1, candidate_key: "CELL-A", custom_rank: 5 }),
        topCandidate({ candidate_id: 2, candidate_key: "CELL-B", custom_rank: 2 }),
      ],
    });
    expect(candidateChoices(a, null).map((c) => c.candidateKey)).toEqual([
      "CELL-B",
      "CELL-A",
      "CELL-C",
    ]);
  });

  it("is empty when neither side has a preview, and never throws", () => {
    expect(candidateChoices(null, null)).toEqual([]);
  });

  it("finds a choice by id and returns null for one no side listed", () => {
    const choices = candidateChoices(preview(), null);
    expect(findChoice(choices, 11)?.candidateKey).toBe("CELL-0011");
    expect(findChoice(choices, 999)).toBeNull();
    expect(findChoice(choices, null)).toBeNull();
  });
});

describe("previewPlacement — a missing rank is never invented", () => {
  it("returns the served rank and score for a listed candidate", () => {
    expect(previewPlacement(preview(), 11)).toEqual({
      rank: 1,
      score: "76.2500",
      inPreview: true,
    });
  });

  it("reports NOT-in-preview rather than a number when the cell is outside top-N", () => {
    const placement = previewPlacement(preview(), 999);
    expect(placement.inPreview).toBe(false);
    expect(placement.rank).toBeNull();
    expect(placement.score).toBeNull();
  });

  it("never borrows the other side's rank: an absent preview yields nothing", () => {
    expect(previewPlacement(null, 11)).toEqual({ rank: null, score: null, inPreview: false });
  });
});

describe("candidateContributionRows", () => {
  it("passes the SERVED weighted_contribution through untouched for both sides", () => {
    const rows = candidateContributionRows(detail(), DETAIL_B);
    const zoning = rows[0];
    expect(zoning.component).toBe("zoning");
    // The server's strings, byte for byte — not `55 * 0.25` computed here.
    expect(zoning.aContribution).toBe("13.7500");
    expect(zoning.bContribution).toBe("5.5000");
    expect(zoning.aWeight).toBe("0.25000000");
    expect(zoning.bWeight).toBe("0.10000000");
    expect(zoning.aWeightPercent).toBe(25);
    expect(zoning.bWeightPercent).toBe(10);
  });

  it("keeps the Z/R/E/D order and the glossary's own labels", () => {
    const rows = candidateContributionRows(detail(), DETAIL_B);
    expect(rows.map((r) => r.component)).toEqual(["zoning", "road", "equity", "demand"]);
    expect(rows.map((r) => r.code)).toEqual(["Z", "R", "E", "D"]);
    expect(rows[2].label).toBe("기존 지역 부담");
    // The Figma mock labels must never appear.
    const labels = rows.map((r) => r.label).join(" ");
    expect(labels).not.toContain("시설부담");
    expect(labels).not.toContain("장래");
    expect(labels).not.toContain("주민");
  });

  it("computes the delta exactly, with no floating-point residue", () => {
    const rows = candidateContributionRows(detail(), DETAIL_B);
    expect(rows[0].deltaContribution).toBe("-8.2500"); // 5.50 − 13.75
    expect(rows[1].deltaContribution).toBe("-5.0000");
    expect(rows[2].deltaContribution).toBe("5.0000");
    expect(rows[3].deltaContribution).toBe("7.5000");
  });

  it("carries the run-invariant component score, identical on both sides", () => {
    const rows = candidateContributionRows(detail(), DETAIL_B);
    expect(rows[0].componentScore).toBe("55.0000");
    expect(rows[0].aComponentScore).toBe("55.0000");
    expect(rows[0].bComponentScore).toBe("55.0000");
    expect(rows[0].componentScoreConflict).toBe(false);
  });

  it("flags a component-score disagreement instead of silently picking one", () => {
    const conflicting = detail({
      contributions: [
        { component: "zoning", component_score: "99.0000", weight: "0.25000000", weighted_contribution: "24.7500" },
      ],
    });
    const rows = candidateContributionRows(detail(), conflicting);
    expect(rows[0].componentScoreConflict).toBe(true);
  });

  it("renders a missing side as null, NEVER as a zero contribution", () => {
    const rows = candidateContributionRows(detail(), null);
    expect(rows[0].aContribution).toBe("13.7500");
    expect(rows[0].bContribution).toBeNull();
    expect(rows[0].bWeightPercent).toBeNull();
    expect(rows[0].deltaContribution).toBeNull();
    expect(rows[0].deltaUnits).toBeNull();
  });

  it("returns four rows even when neither side served a detail", () => {
    const rows = candidateContributionRows(null, null);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.deltaContribution === null)).toBe(true);
  });

  it("treats a component the server omitted as unavailable", () => {
    const partial = detail({
      contributions: [
        { component: "zoning", component_score: null, weight: "0.25000000", weighted_contribution: null },
      ],
    });
    const rows = candidateContributionRows(partial, partial);
    expect(rows[0].aContribution).toBeNull();
    expect(rows[1].aContribution).toBeNull();
  });
});

describe("totals", () => {
  it("differences the two served total scores exactly", () => {
    expect(totalScoreDelta("76.2500", "75.5000")).toBe("-0.7500");
  });

  it("refuses a total delta when either side is missing", () => {
    expect(totalScoreDelta("76.2500", null)).toBeNull();
    expect(totalScoreDelta(null, "75.5000")).toBeNull();
  });
});

describe("formatContributionDelta", () => {
  it("signs a change and names a true zero rather than printing 0", () => {
    expect(formatContributionDelta("7.5000")).toBe("+7.5000");
    expect(formatContributionDelta("-8.2500")).toBe("−8.2500");
    expect(formatContributionDelta("0.0000")).toBe("변화 없음");
  });

  it("returns null — not a zero — when the delta is not computable", () => {
    expect(formatContributionDelta(null)).toBeNull();
  });
});

describe("majorImpactFactor — argmax |Δ contribution|", () => {
  it("names the factor with the largest absolute change, with its direction", () => {
    const rows = candidateContributionRows(detail(), DETAIL_B);
    const impact = majorImpactFactor(rows);
    // |−8.25| beats |−5|, |+5| and |+7.5|.
    expect(impact?.component).toBe("zoning");
    expect(impact?.direction).toBe("decrease");
    expect(impact?.deltaContribution).toBe("-8.2500");
    expect(impact?.tiedWith).toEqual([]);
  });

  it("prefers magnitude over sign — a large decrease outranks a smaller increase", () => {
    const impact = majorImpactFactor(candidateContributionRows(detail(), DETAIL_B));
    expect(impact?.component).not.toBe("demand");
  });

  it("breaks a tie by Z→R→E→D and DISCLOSES every co-equal factor", () => {
    // Z and R both move by exactly +10.
    const a = detail({
      contributions: [
        { component: "zoning", component_score: "50.0000", weight: "0.20000000", weighted_contribution: "10.0000" },
        { component: "road", component_score: "50.0000", weight: "0.20000000", weighted_contribution: "10.0000" },
        { component: "equity", component_score: "50.0000", weight: "0.20000000", weighted_contribution: "10.0000" },
        { component: "demand", component_score: "50.0000", weight: "0.20000000", weighted_contribution: "10.0000" },
      ],
    });
    const b = detail({
      contributions: [
        { component: "zoning", component_score: "50.0000", weight: "0.40000000", weighted_contribution: "20.0000" },
        { component: "road", component_score: "50.0000", weight: "0.40000000", weighted_contribution: "20.0000" },
        { component: "equity", component_score: "50.0000", weight: "0.20000000", weighted_contribution: "10.0000" },
        { component: "demand", component_score: "50.0000", weight: "0.20000000", weighted_contribution: "10.0000" },
      ],
    });
    const impact = majorImpactFactor(candidateContributionRows(a, b));
    expect(impact?.component).toBe("zoning");
    expect(impact?.tiedWith).toEqual(["road"]);
    expect(majorImpactSentence(impact)).toContain("같은 크기로 변화한 요소");
    expect(majorImpactSentence(impact)).toContain("도로 근접성 대리지표(R)");
  });

  it("returns null when nothing moved — 'the biggest change is no change' is not a finding", () => {
    const impact = majorImpactFactor(candidateContributionRows(detail(), detail()));
    expect(impact).toBeNull();
    expect(majorImpactSentence(null)).toContain("달라진 평가 요소가 없습니다");
  });

  it("returns null when no factor has both sides served", () => {
    expect(majorImpactFactor(candidateContributionRows(detail(), null))).toBeNull();
  });

  it("states the change descriptively and makes no causal or pass/fail claim", () => {
    const sentence = majorImpactSentence(majorImpactFactor(candidateContributionRows(detail(), DETAIL_B)));
    expect(sentence).toContain("가중 기여도 변화가 가장 큰 요소");
    expect(sentence).not.toContain("때문에");
    expect(sentence).not.toContain("통과");
    expect(sentence).not.toContain("제외");
  });
});

describe("candidate identity", () => {
  it("uses candidate_key — the stable identity — from whichever side served it", () => {
    expect(resolvedCandidateKey(sideResult("A", detail()), sideResult("B", null))).toBe("CELL-0011");
    expect(resolvedCandidateKey(sideResult("A", null), sideResult("B", DETAIL_B))).toBe("CELL-0011");
  });

  it("falls back to the picker's key only when neither side served one", () => {
    expect(resolvedCandidateKey(sideResult("A", null), sideResult("B", null), "CELL-X")).toBe("CELL-X");
    expect(resolvedCandidateKey(sideResult("A", null), sideResult("B", null))).toBeNull();
  });

  it("reports a two-sided key disagreement rather than picking a winner", () => {
    const other = detail({ candidate_key: "CELL-9999" });
    expect(candidateIdentityConflict(sideResult("A", detail()), sideResult("B", other))).toBe(true);
    expect(candidateIdentityConflict(sideResult("A", detail()), sideResult("B", DETAIL_B))).toBe(false);
    // One side missing is not a conflict — it is an absence.
    expect(candidateIdentityConflict(sideResult("A", detail()), sideResult("B", null))).toBe(false);
  });
});
