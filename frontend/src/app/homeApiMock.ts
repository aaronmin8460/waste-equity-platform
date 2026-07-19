/**
 * Shared backend-API stub for the responsive-layout structure test (page.tsx).
 *
 * The dashboard blocks on a live backend before it renders any layout, so the
 * layout test needs a minimal, well-formed response for each request to get past
 * the loading state. Every value here is a SYNTHETIC LAYOUT FIXTURE — never real,
 * never official public data — and the test asserts only on responsive structure,
 * never on these values. No network is touched.
 *
 * The map-mode envelopes are genuinely EMPTY (count: 0, no items) — an empty
 * collection is not fabricated data and carries no official evidence label.
 *
 * The 수도권매립지 (landfill) fetchers are NOT stubbed with an empty-but-"official"
 * summary: the real backend labels every landfill value with OFFICIAL_REPORTED_VALUE
 * / OFFICIAL_INPUTS_DERIVED_VALUE evidence, so a synthetic summary of zeros would
 * fabricate quantities and fees under official labels — which repo-root AGENTS.md
 * forbids. Instead they reject with the real backend's "no official data" error
 * (404 NO_DATA_AVAILABLE), the same shape `fetchJson` throws, so flow mode would
 * render its explicitly-unavailable state with no fabricated official values.
 *
 * Not a test file itself (no `.test.` suffix), so vitest does not collect it.
 */

import { vi } from "vitest";

import type * as ApiModule from "../lib/api";

type Api = typeof ApiModule;

/** Overrides object for `vi.mock("../lib/api", …)`; spread over the real module. */
export function homeApiMock(actual: Api): Api {
  const emptyEnvelope = { reference_year: 2024, count: 0, items: [] };
  // The real backend returns 404 NO_DATA_AVAILABLE when no landfill rows exist;
  // fetchJson throws exactly this ApiError. Rejecting with it keeps the landfill
  // fixture explicitly unavailable and non-official instead of a fabricated zero
  // summary carrying OFFICIAL_* evidence labels.
  const landfillUnavailable = () =>
    new actual.ApiError(
      404,
      {
        error: "NO_DATA_AVAILABLE",
        detail: "No landfill inbound data has been ingested.",
        requested_year: null,
        available_years: [],
      },
      "NO_DATA_AVAILABLE: No landfill inbound data has been ingested.",
    );
  return {
    ...actual,
    fetchBoundaries: vi.fn().mockResolvedValue({
      type: "FeatureCollection",
      reference_year: 2024,
      count: 0,
      features: [],
    }),
    fetchPopulation: vi.fn().mockResolvedValue(emptyEnvelope),
    fetchWasteStatistics: vi.fn().mockResolvedValue(emptyEnvelope),
    fetchFacilities: vi.fn().mockResolvedValue(emptyEnvelope),
    fetchWastePerCapita: vi
      .fn()
      .mockResolvedValue({ ...emptyEnvelope, unit: "kg/인/년", excluded_regions: [] }),
    fetchFacilityBurden: vi
      .fn()
      .mockResolvedValue({ ...emptyEnvelope, unit: "kg/인/년", excluded_regions: [] }),
    fetchReportingBoundaries: vi.fn().mockResolvedValue({
      type: "FeatureCollection",
      reference_year: 2024,
      count: 0,
      features: [],
    }),
    fetchReportingStatistics: vi
      .fn()
      .mockResolvedValue({ ...emptyEnvelope, unavailable_regions: [] }),
    fetchReportingPerCapita: vi
      .fn()
      .mockResolvedValue({ ...emptyEnvelope, unit: "kg/인/년", excluded_regions: [] }),
    fetchDataSources: vi.fn().mockResolvedValue([]),
    fetchSuitabilityPolicy: vi.fn().mockResolvedValue({
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
    }),
    fetchSuitabilityLatestRun: vi.fn().mockResolvedValue({
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
    }),
    fetchSuitabilitySummary: vi.fn().mockResolvedValue({
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
    }),
    // Explicitly unavailable (non-official) landfill state — see the header note.
    fetchLandfillSummary: vi.fn().mockRejectedValue(landfillUnavailable()),
    fetchLandfillTrends: vi.fn().mockRejectedValue(landfillUnavailable()),
    fetchLandfillComposition: vi.fn().mockRejectedValue(landfillUnavailable()),
  };
}
