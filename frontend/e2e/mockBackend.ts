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
  // Facility cost lens (Phase 5). The cost result is an ANALYTICAL standard-cost
  // scenario (a controlled contract fixture), not official metric data; the UI
  // shows it only with its disclaimer + completeness. Options let the form render.
  "/api/v1/facility-cost/options": {
    derivation_version: "facility-cost-v1",
    facility_types: [
      { value: "sorting_auto", label: "자동선별 재활용시설 (automated sorting/recycling)" },
      { value: "incineration_new", label: "신규 소각시설 (new incineration)" },
    ],
    subsidy_schemes: [{ value: "city_or_county", label: "시·군 (30%)", rate: "0.30" }],
    underground_multiplier: { min: "1.00", max: "1.40", default: "1.00", note: "지상형 기준" },
    default_operating_days: 300,
    cost_versions: ["capex-standard-v2022dec"],
    active_cost_version: "capex-standard-v2022dec",
    disclaimer: "표준공사비 기반 설치비 분석입니다.",
  },
  "/api/v1/facility-cost/calculate": {
    scenario: {
      facility_type: "sorting_auto",
      facility_type_label: "자동선별 재활용시설",
      processing_share: "1",
      processing_share_percent: "100",
      operating_days_per_year: 300,
      underground_multiplier: "1.00",
      underground_multiplier_note: "지상형 기준",
      subsidy_scheme: "city_or_county",
      subsidy_scheme_label: "시·군 (30%)",
      subsidy_rate: "0.30",
      cost_version: "capex-standard-v2022dec",
    },
    official_input: {
      waste_stream: "HOUSEHOLD",
      reference_year: 2022,
      waste_reference_period: "2022",
      accounting_basis: "ORIGIN_BASED_TREATMENT_OUTCOME",
      waste_source_id: "waste_statistics",
      waste_official_dataset_name: "RCIS 생활계",
      quantity_unit: "톤/년",
      official_annual_quantity_ton: "10500.000000",
      service_region_codes: ["KR-SGIS-11110"],
      regions: [
        {
          region_code: "KR-SGIS-11110",
          region_name: "종로구",
          generation_quantity_ton: "10500.000000",
          population: 200000,
        },
      ],
      population_source_id: "sgis",
      population_reference_period: "2022",
      population_definition: "SGIS_TOTAL_POPULATION",
      official_service_population: 200000,
    },
    capacity: {
      annual_service_quantity_ton: "10500.000000",
      operating_days_per_year: 300,
      facility_capacity_ton_per_day: "35.000000",
      capacity_unit: "톤/일",
    },
    standard_cost: {
      term_ko: "표준공사비 기반 설치비 산정액",
      matched_band: {
        facility_type: "sorting_auto",
        capacity_min_ton_per_day: "30.000000",
        capacity_min_inclusive: false,
        capacity_max_ton_per_day: "40.000000",
        capacity_max_inclusive: true,
        cost_per_capacity_bn: "3.450000",
        cost_per_capacity_unit: "억원/(톤·일)",
      },
      standard_unit_cost_bn_per_tpd: "3.450000",
      underground_multiplier: "1.00",
      standard_construction_cost_bn: "120.750000",
      unit: "억원",
    },
    annualization: {
      term_ko: "연간 환산 설치비",
      facility_lifetime_years: 15,
      lifetime_basis: "분석용 내용연수 가정",
      annualized_construction_cost_bn: "8.050000",
      unit: "억원/년",
      method: "STRAIGHT_LINE_ANALYTICAL",
    },
    subsidy: {
      subsidy_scheme: "city_or_county",
      subsidy_scheme_label: "시·군 (30%)",
      subsidy_rate: "0.30",
      rate_source: "2025년 국고보조금 업무처리지침",
      rate_reference_period: "2025",
      rate_basis: "명목 국고보조율(분석용 가정) — 실제 승인된 국고보조금이 아님",
      estimated_national_subsidy_bn: "36.225000",
      simplified_local_government_share_bn: "84.525000",
      unit: "억원",
      note: "명목 보조율에 따른 분석용 추정치",
    },
    per_capita: {
      term_ko: "주민 1인당 환산 지방비",
      per_capita_local_share_won: "42262.50",
      official_service_population: 200000,
      unavailable_reason: null,
      unit: "원",
      caveat: "개인의 실제 세금 청구액이 아닙니다.",
    },
    candidate_context: null,
    completeness: {
      is_partial: true,
      included_components: ["STANDARD_CONSTRUCTION_COST"],
      missing_components: [{ component: "OPERATING_COST", reason: "OFFICIAL_SOURCE_NOT_INTEGRATED" }],
    },
    provenance: {
      derivation_version: "facility-cost-v1",
      cost_version: "capex-standard-v2022dec",
      price_base_date: "2022-12-01",
      source_document: "2025년 폐기물처리시설 국고보조금 업무처리지침 붙임2",
      source_page: "p.211",
      subsidy_rate_source: "2025년 국고보조금 업무처리지침",
      subsidy_rate_reference_period: "2025",
    },
    assumptions: ["표준공사비 단가는 지침 표를 사용", "내용연수는 분석용 가정"],
    disclaimer: "표준공사비 기반 설치비 분석입니다. 실제 총사업비가 아닙니다.",
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
