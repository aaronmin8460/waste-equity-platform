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
    fetchSuitabilityPolicy: vi.fn().mockRejectedValue(new Error("not needed")),
    fetchSuitabilityLatestRun: vi.fn().mockRejectedValue(new Error("not needed")),
    fetchSuitabilitySummary: vi.fn().mockRejectedValue(new Error("not needed")),
    fetchSuitabilityCandidates: vi.fn().mockRejectedValue(new Error("not needed")),
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
