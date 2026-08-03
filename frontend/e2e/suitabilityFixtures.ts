import type { Page, Route } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Populated suitability fixtures for the 후보지 분석 dashboard spec.
 *
 * The base `mockBackend` serves a suitability run + summary with an EMPTY
 * `top_candidates` list, which is correct for layout-only assertions but leaves the
 * candidate list, the selection flow, and the selected-candidate summary with
 * nothing to render. This layers a small synthetic candidate set on top —
 * registered AFTER `mockBackend`, since Playwright matches the most recently
 * registered route first.
 *
 * Every value here is a SYNTHETIC FIXTURE, never real or official public data, and
 * nothing carries an official evidence marker. The spec asserts structure,
 * geometry, and behaviour — never these numbers. One candidate is deliberately
 * REVIEW_REQUIRED with a missing component, so the "a missing value is not a zero"
 * rule is exercised rather than assumed.
 *
 * Not a spec file (no `.spec.`/`.test.` suffix), so Playwright never runs it.
 */

const TOP_CANDIDATES = [
  {
    candidate_id: 701,
    rank: 1,
    sigungu: "강화군",
    total_score: "88.1234",
    stability_class: "STABLE",
    stable_count: 3,
  },
  {
    candidate_id: 702,
    rank: 2,
    sigungu: "옹진군",
    total_score: "81.5000",
    stability_class: "CONDITIONALLY_STABLE",
    stable_count: 2,
  },
  {
    candidate_id: 703,
    rank: 3,
    sigungu: "수원시 장안구",
    total_score: "75.0000",
    stability_class: "WEIGHT_SENSITIVE",
    stable_count: 1,
  },
];

const SUMMARY = {
  run_id: 47,
  reference_year: 2024,
  policy_version: "suitability-policy-v2",
  derivation_version: "suitability-screening-v3",
  candidate_grid_version: "capital-grid-500m-v1",
  weight_profile: "baseline",
  candidate_count_total: 47893,
  candidate_count_eligible: 1099,
  candidate_count_review: 34534,
  candidate_count_excluded: 12260,
  exclusion_reason_counts: { PROTECTED_AREA_OVERLAP: 4200 },
  review_reason_counts: { MISSING_EQUITY_COMPONENT: 33000 },
  sido_distribution: {},
  top_candidates: TOP_CANDIDATES,
  critic_weights: { zoning: "0.31", road: "0.19", equity: "0.28", demand: "0.22" },
  stability_top_fraction: "0.10",
  stability_top_cutoff_rank: 110,
  candidate_count_stable: 62,
  candidate_count_conditionally_stable: 140,
  candidate_count_weight_sensitive: 897,
  top_stable_candidates: [TOP_CANDIDATES[0]],
  stability_definition: {
    compared_profiles: ["baseline", "equal", "critic"],
    top_fraction: "0.10",
    top_cutoff_rank: 110,
  },
  stability_available: true,
  coverage_notes: ["일부 시군의 시설 처리량 자료가 없습니다."],
  assumptions: ["500m 후보 격자는 하나의 필지가 아닙니다."],
  disclaimer: "Analytical screening only — not a legal determination.",
};

const CELL = {
  type: "Polygon",
  coordinates: [
    [
      [126.5, 37.7],
      [126.51, 37.7],
      [126.51, 37.71],
      [126.5, 37.71],
      [126.5, 37.7],
    ],
  ],
};

/**
 * One candidate's detail. `702` is REVIEW_REQUIRED with NO equity component and a
 * provisional score; `703` is EXCLUDED with a reason and no score at all.
 */
function candidateDetail(id: number): Record<string, unknown> {
  const review = id === 702;
  const excluded = id === 703;
  return {
    candidate_id: id,
    candidate_key: `cap500-000${id}`,
    status: excluded ? "EXCLUDED" : review ? "REVIEW_REQUIRED" : "ELIGIBLE",
    profile: "baseline",
    is_excluded: excluded,
    rank: excluded || review ? null : 1,
    total_score: excluded || review ? null : "88.1234",
    provisional_score: review ? "64.2500" : null,
    zoning_score: excluded ? null : "90.0000",
    road_score: excluded ? null : "70.0000",
    equity_score: review || excluded ? null : "95.0000",
    demand_score: excluded ? null : "80.0000",
    sido_region_code: "28",
    sido_region_name: "인천광역시",
    sigungu_region_code: "28710",
    sigungu_region_name: review ? "옹진군" : excluded ? "수원시 장안구" : "강화군",
    nearest_road_distance_m: "120.0",
    stable_count: excluded || review ? null : 3,
    stability_class: excluded || review ? null : "STABLE",
    stability_membership: excluded || review ? {} : { baseline: true, equal: true, critic: true },
    exclusion_reasons: excluded ? ["PROTECTED_AREA_OVERLAP"] : [],
    review_reasons: review ? ["MISSING_EQUITY_COMPONENT"] : [],
    run_id: 47,
    profile_totals: excluded ? {} : { baseline: "88.1234", critic: "86.0000" },
    profile_ranks: excluded ? {} : { baseline: 1, critic: 2 },
    penalties: [],
    raw_components: {},
    nearest_road_provenance: { official_layer_code: "UD801" },
    component_provenance: {},
    original_area_m2: "250000",
    clipped_area_m2: "250000",
    clipped_area_ratio: "1.0",
    geometry: CELL,
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    weights: { zoning: "0.4", road: "0.3", equity: "0.2", demand: "0.1" },
    disclaimer: "Analytical screening only — not a legal determination.",
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Install the base mock plus the populated suitability overrides. */
export async function mockSuitabilityBackend(page: Page): Promise<void> {
  await mockBackend(page);
  await page.route("**/api/v1/suitability/summary**", (r) => json(r, SUMMARY));
  await page.route("**/api/v1/suitability/candidates/*", (r) => {
    const match = new URL(r.request().url()).pathname.match(/\/candidates\/(\d+)$/);
    return json(r, candidateDetail(Number(match?.[1] ?? 701)));
  });
  // The LC5A land-cover section inside the candidate summary owns its own fetch; a
  // 404 is its normal "no statistics for this cell" path and never blocks the panel.
  await page.route("**/cell-statistics/**", (r) => json(r, { detail: "NO_DATA" }, 404));
}
