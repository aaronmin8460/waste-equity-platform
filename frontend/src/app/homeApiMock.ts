/**
 * Shared backend-API stub for Home (page.tsx) rendering tests.
 *
 * The dashboard blocks on a live backend before it renders any layout, so every
 * component/layout test needs the same minimal, well-formed envelopes to get
 * past the loading state. This is NOT a fixture of official data — it exists only
 * so the responsive-layout assertions have a rendered tree to measure, exactly as
 * the mode-routing test in page.test.tsx does with an inline copy. No network is
 * touched and no value is presented to a user.
 *
 * Not a test file itself (no `.test.` suffix), so vitest does not collect it.
 */

import { vi } from "vitest";

import type * as ApiModule from "../lib/api";

type Api = typeof ApiModule;

/** Overrides object for `vi.mock("../lib/api", …)`; spread over the real module. */
export function homeApiMock(actual: Api): Api {
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
}
