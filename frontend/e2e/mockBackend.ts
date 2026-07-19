import type { Page, Route } from "@playwright/test";

/**
 * Network stub for layout-only e2e specs.
 *
 * The dashboard blocks on a live backend before rendering, so a spec that only
 * cares about *layout* (dimensions, overflow, stacking) still needs well-formed
 * envelopes to get the app past its loading state. These are intentionally empty
 * and are never asserted on or shown to a user as official data — they exist
 * purely so there is a rendered tree to measure. Every backend and tile request
 * is intercepted, so these specs touch no network, no tile server, and no
 * government API. (The live smoke specs, by contrast, use the real backend.)
 *
 * Not a spec file (no `.spec.`/`.test.` suffix), so Playwright never runs it.
 */

const EMPTY_FC = { type: "FeatureCollection", reference_year: 2024, count: 0, features: [] };
const EMPTY_ENVELOPE = { reference_year: 2024, count: 0, items: [] };
const PERIOD = {
  year: 2024,
  month: null,
  is_complete_year: true,
  available_through_month: "2024-12",
  latest_available_month: "2026-05",
  available_years: [2024],
};
const EVIDENCE = {
  quantity_status: "OFFICIAL_REPORTED_VALUE",
  fee_status: "OFFICIAL_REPORTED_VALUE",
  derived_status: "OFFICIAL_INPUTS_DERIVED_VALUE",
  notes: [],
};
const FEE_PER_CAPITA = {
  indicator: "LANDFILL_INBOUND_FEE_PER_CAPITA",
  fee_per_capita_krw: null,
  unit: "KRW/인",
  derivation_version: "landfill-fee-per-capita-v1",
  derivation_formula: "inbound_fee_krw ÷ population",
  evidence_status: "OFFICIAL_INPUTS_DERIVED_VALUE",
  inbound_fee_krw: "0.00",
  fee_reference_year: 2024,
  fee_reference_period: "2024",
  population: null,
  population_reference_year: null,
  population_reference_period: null,
  population_definition: null,
  population_source_id: null,
  population_region_level: null,
  population_unit: null,
  included_origin_region_codes: [],
  unavailable_reason: "NO_METROPOLITAN_POPULATION",
  caveat: "개인의 실제 납부액이 아닙니다.",
};

export const RESPONSES: Record<string, unknown> = {
  "/api/v1/regions/boundaries": EMPTY_FC,
  "/api/v1/population": EMPTY_ENVELOPE,
  "/api/v1/waste-statistics": EMPTY_ENVELOPE,
  "/api/v1/facilities": EMPTY_ENVELOPE,
  "/api/v1/equity/waste-per-capita": { ...EMPTY_ENVELOPE, unit: "kg/인/년", excluded_regions: [] },
  "/api/v1/equity/facility-burden": { ...EMPTY_ENVELOPE, unit: "kg/인/년", excluded_regions: [] },
  "/api/v1/waste-reporting/boundaries": EMPTY_FC,
  "/api/v1/waste-reporting/statistics": { ...EMPTY_ENVELOPE, unavailable_regions: [] },
  "/api/v1/waste-reporting/per-capita": { ...EMPTY_ENVELOPE, unit: "kg/인/년", excluded_regions: [] },
  "/api/v1/data-sources": [],
  "/api/v1/suitability/policies": {
    policy_version: "suitability-policy-v1",
    derivation_version: "suitability-screening-v1",
    candidate_grid_version: "capital-grid-500m-v1",
    statuses: ["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"],
    weight_profiles: {
      baseline: { zoning: "0.4", road: "0.3", equity: "0.2", demand: "0.1" },
      equal: { zoning: "0.25", road: "0.25", equity: "0.25", demand: "0.25" },
      equity_focused: { zoning: "0.2", road: "0.2", equity: "0.4", demand: "0.2" },
      access_focused: { zoning: "0.2", road: "0.4", equity: "0.2", demand: "0.2" },
    },
    weight_rationale: {},
    hard_exclusion_codes: {},
    review_codes: {},
    zoning_registry: {},
    road_distance_curve: [],
    grid: {},
    disclaimer: "Analytical screening only — not a legal determination.",
  },
  "/api/v1/suitability/runs/latest": {
    id: 47,
    derivation_version: "suitability-screening-v1",
    policy_version: "suitability-policy-v1",
    candidate_grid_version: "capital-grid-500m-v1",
    reference_year: 2024,
    boundary_vintage: "2024",
    weight_profile: "baseline",
    analysis_signature: "sig",
    status: "SUCCEEDED",
    candidate_count_total: 47893,
    candidate_count_eligible: 1099,
    candidate_count_review: 34534,
    candidate_count_excluded: 12260,
    input_dataset_version_ids: [],
    input_provenance: {},
    started_at: "2024-01-01T00:00:00Z",
    completed_at: "2024-01-01T00:00:00Z",
    created_at: "2024-01-01T00:00:00Z",
  },
  "/api/v1/suitability/summary": {
    run_id: 47,
    reference_year: 2024,
    policy_version: "suitability-policy-v1",
    derivation_version: "suitability-screening-v1",
    candidate_grid_version: "capital-grid-500m-v1",
    weight_profile: "baseline",
    candidate_count_total: 47893,
    candidate_count_eligible: 1099,
    candidate_count_review: 34534,
    candidate_count_excluded: 12260,
    exclusion_reason_counts: {},
    review_reason_counts: {},
    sido_distribution: {},
    top_candidates: [],
    coverage_notes: [],
    assumptions: [],
    disclaimer: "Analytical screening only — not a legal determination.",
  },
  "/api/v1/landfill/summary": {
    period: PERIOD,
    origin_filter: null,
    waste_filter: null,
    accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
    destination_code: "SUDOKWON_LANDFILL",
    destination_name: "수도권매립지",
    total_quantity_kg: "0",
    total_quantity_tons: "0.000000",
    total_inbound_fee_krw: "0.00",
    effective_fee_per_ton: null,
    fee_per_capita: FEE_PER_CAPITA,
    largest_origin_share: null,
    largest_waste_share: null,
    origin_shares: [],
    top_waste_types: [],
    row_count: 0,
    evidence: EVIDENCE,
    sources: [],
    derivation_version: "landfill-effective-fee-v1",
    caveats: ["광역지자체 단위 자료입니다."],
  },
  "/api/v1/landfill/trends": {
    start_month: "2024-01",
    end_month: "2024-12",
    origin_filter: null,
    waste_filter: null,
    accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
    points: [],
    evidence: EVIDENCE,
    sources: [],
    derivation_version: "landfill-effective-fee-v1",
    caveats: [],
  },
  "/api/v1/landfill/composition": {
    period: PERIOD,
    origin_filter: null,
    accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
    total_quantity_kg: "0",
    total_quantity_tons: "0.000000",
    total_inbound_fee_krw: "0.00",
    waste_types: [],
    evidence: EVIDENCE,
    sources: [],
    derivation_version: "landfill-effective-fee-v1",
    caveats: [],
  },
};

/** Intercept all backend + tile traffic so the app renders with no network. */
export async function mockBackend(page: Page): Promise<void> {
  await page.route("**/api/v1/**", (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    // Vector tiles are nothing to draw in a layout-only run.
    if (pathname.endsWith(".mvt")) return route.abort();
    const body = RESPONSES[pathname];
    if (body === undefined) return route.fulfill({ status: 404, body: "{}" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  // Public basemap raster tiles are irrelevant to layout and would only add
  // latency; abort them (MapLibre logs the failed fetch and carries on).
  await page.route("**/tile.openstreetmap.org/**", (route: Route) => route.abort());
}
