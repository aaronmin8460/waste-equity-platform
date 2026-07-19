import type { Page, Route } from "@playwright/test";

/**
 * Network stub for the layout-only responsive e2e spec.
 *
 * The dashboard blocks on a live backend before rendering, so a spec that only
 * cares about *layout* (dimensions, overflow, stacking) still needs a well-formed
 * response for each request to get the app past its loading state. Every value
 * here is a SYNTHETIC LAYOUT FIXTURE — never real, never official public data. It
 * exists purely so there is a rendered tree to measure, and the spec asserts only
 * on layout, never on these values. Every backend and tile request is intercepted,
 * so the spec touches no network, no tile server, and no government API. (The live
 * smoke specs, by contrast, use the real backend.)
 *
 * The map-mode envelopes are genuinely EMPTY (count: 0, no items/features) — an
 * empty collection is not fabricated data and carries no official evidence label.
 *
 * The 수도권매립지 (landfill) endpoints are deliberately NOT stubbed with an
 * empty-but-"official" summary: the real backend labels every landfill value with
 * OFFICIAL_REPORTED_VALUE / OFFICIAL_INPUTS_DERIVED_VALUE evidence, so a synthetic
 * summary of zeros would render fabricated quantities and fees under official
 * labels — exactly what the repo-root AGENTS.md forbids. Instead this reproduces
 * the backend's genuine "no official data" path: `_resolve_period` returns a 404
 * NO_DATA_AVAILABLE (backend .../routes/landfill.py), so the dashboard renders its
 * real, explicitly-unavailable state with no fabricated official values at all.
 *
 * Not a spec file (no `.spec.`/`.test.` suffix), so Playwright never runs it.
 */

const EMPTY_FC = { type: "FeatureCollection", reference_year: 2024, count: 0, features: [] };
const EMPTY_ENVELOPE = { reference_year: 2024, count: 0, items: [] };

/**
 * The exact 404 body the real backend returns when no landfill rows have been
 * ingested (FastAPI serializes `HTTPException(detail=UnavailableDataError(...))`
 * as `{ detail: {...} }`; `fetchJson`/`parseStructuredDetail` consume that shape).
 * This carries no `evidence` object, so nothing synthetic is labeled official.
 */
const LANDFILL_NO_DATA = {
  detail: {
    error: "NO_DATA_AVAILABLE",
    detail: "No landfill inbound data has been ingested.",
    requested_year: null,
    available_years: [],
  },
};
const LANDFILL_PATHS = new Set([
  "/api/v1/landfill/summary",
  "/api/v1/landfill/trends",
  "/api/v1/landfill/composition",
]);

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
  // The landfill endpoints are intentionally absent here: they are served the real
  // 404 NO_DATA_AVAILABLE response by the route handler below (see LANDFILL_PATHS),
  // never a synthetic "official" summary of zeros.
};

/** Intercept all backend + tile traffic so the app renders with no network. */
export async function mockBackend(page: Page): Promise<void> {
  await page.route("**/api/v1/**", (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    // Vector tiles are nothing to draw in a layout-only run.
    if (pathname.endsWith(".mvt")) return route.abort();
    // Reproduce the backend's genuine "no official landfill data" response rather
    // than fabricating an official-labeled empty summary.
    if (LANDFILL_PATHS.has(pathname)) {
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify(LANDFILL_NO_DATA),
      });
    }
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
