// @vitest-environment jsdom

/**
 * Mode-routing tests for the dashboard shell.
 *
 * The load-bearing assertion: 수도권매립지 mode renders NO map, while 형평성 and
 * 적합성 still do. MapView is stubbed (MapLibre needs WebGL, which jsdom has no
 * business providing) and the backend fetchers are stubbed with minimal
 * envelopes — this test is about which mode mounts a map, not about rendering.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `dynamic(() => import("../components/MapView"))` would pull in maplibre-gl.
// Replace it with a synchronous stub that stands in for "a map is on screen".
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub() {
      return <div data-testid="map-container" />;
    },
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const emptyEnvelope = { reference_year: 2024, count: 0, items: [] };
  const period = {
    year: 2024,
    month: null,
    is_complete_year: true,
    available_through_month: "2024-12",
    latest_available_month: "2026-05",
    available_years: [2024],
  };
  const evidence = {
    quantity_status: "OFFICIAL_REPORTED_VALUE",
    fee_status: "OFFICIAL_REPORTED_VALUE",
    derived_status: "OFFICIAL_INPUTS_DERIVED_VALUE",
    notes: [],
  };
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
    // Must NOT be called for map rendering anymore (the map uses vector tiles).
    fetchSuitabilityCandidates: vi.fn().mockRejectedValue(new Error("should not be called")),
    fetchLandfillSummary: vi.fn().mockResolvedValue({
      period,
      origin_filter: null,
      waste_filter: null,
      accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
      destination_code: "SUDOKWON_LANDFILL",
      destination_name: "수도권매립지",
      total_quantity_kg: "0",
      total_quantity_tons: "0.000000",
      total_inbound_fee_krw: "0.00",
      effective_fee_per_ton: null,
      fee_per_capita: {
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
      },
      largest_origin_share: null,
      largest_waste_share: null,
      origin_shares: [],
      top_waste_types: [],
      row_count: 0,
      evidence,
      sources: [],
      derivation_version: "landfill-effective-fee-v1",
      caveats: ["광역지자체 단위 자료이며 시·군·구별 이동 경로나 실제 운송 경로를 의미하지 않습니다."],
    }),
    fetchLandfillTrends: vi.fn().mockResolvedValue({
      start_month: "2024-01",
      end_month: "2024-12",
      origin_filter: null,
      waste_filter: null,
      accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
      points: [],
      evidence,
      sources: [],
      derivation_version: "landfill-effective-fee-v1",
      caveats: [],
    }),
    fetchLandfillComposition: vi.fn().mockResolvedValue({
      period,
      origin_filter: null,
      accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
      total_quantity_kg: "0",
      total_quantity_tons: "0.000000",
      total_inbound_fee_krw: "0.00",
      waste_types: [],
      evidence,
      sources: [],
      derivation_version: "landfill-effective-fee-v1",
      caveats: [],
    }),
  };
});

import Home from "./page";
import { fetchSuitabilityCandidates } from "./../lib/api";

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

async function renderHome() {
  const utils = render(<Home />);
  // Wait past the initial loading state.
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  return utils;
}

describe("dashboard mode routing", () => {
  it("renders the map in 형평성 (equity) mode", async () => {
    await renderHome();
    expect(screen.getByTestId("map-container")).toBeDefined();
  });

  it("renders the map in 적합성 (suitability) mode", async () => {
    await renderHome();
    fireEvent.click(screen.getByTestId("mode-suitability"));
    await waitFor(() =>
      expect(screen.getByTestId("mode-suitability").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByTestId("map-container")).toBeDefined();
  });

  it("renders NO map in 수도권매립지 (flow) mode", async () => {
    await renderHome();
    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());
    // The load-bearing assertion: the map is gone, not merely hidden.
    expect(screen.queryByTestId("map-container")).toBeNull();
  });

  it("keeps the mode selector reachable from the landfill dashboard", async () => {
    await renderHome();
    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());
    expect(screen.getByTestId("mode-switch")).toBeDefined();
    // Returning to equity restores the map.
    fireEvent.click(screen.getByTestId("mode-equity"));
    await waitFor(() => expect(screen.getByTestId("map-container")).toBeDefined());
    expect(screen.queryByTestId("landfill-dashboard")).toBeNull();
  });
});

describe("suitability map uses vector tiles, not a limited GeoJSON slice", () => {
  it("shows accurate vector-tile wording and drops the '2,000 / total viewport-limit' copy", async () => {
    await renderHome();
    fireEvent.click(screen.getByTestId("mode-suitability"));

    // The analysis summary loads (policy + latest run + summary), so the panel
    // renders its real content rather than the loading/error state.
    await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());

    // New, accurate wording: the whole grid is available, only needed tiles ship.
    const note = await screen.findByTestId("candidate-vector-note");
    expect(note.textContent).toContain("벡터 타일");
    expect(note.textContent).toContain("전체 데이터");

    // The old misleading "지도 영역 내 2,000 / …개 표시 (뷰포트 제한)" copy is gone.
    expect(screen.queryByTestId("candidate-viewport-count")).toBeNull();
    expect(document.body.textContent).not.toContain("뷰포트 제한");

    // The complete latest-run totals (from the summary) are shown.
    expect(screen.getByTestId("candidate-counts").textContent).toContain("47,893");
  });

  it("never calls the limited candidate GeoJSON endpoint for map rendering", async () => {
    await renderHome();
    fireEvent.click(screen.getByTestId("mode-suitability"));
    await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
    // The map renders from /tiles/{run}/{profile}/{z}/{x}/{y}.mvt; the old
    // bbox+limit=2000 candidate fetch is never invoked.
    expect(vi.mocked(fetchSuitabilityCandidates)).not.toHaveBeenCalled();
  });
});
