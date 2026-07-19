// @vitest-environment jsdom

/**
 * Facility cost lens tests (Phase 5).
 *
 * The api client is mocked with CONTROLLED CONTRACT FIXTURES (clearly a test
 * environment) so the panel renders without a backend. Asserts the scenario
 * controls, validation (calculate disabled until a region is chosen), exact values
 * from the fixture, completeness rendered as explicitly unavailable (never 0), the
 * null per-capita path, candidate integration, the citizen guide/disclaimer, the
 * client-only conditions section, and the aria-live result announcement.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CandidateDetail, FacilityCostCalculate } from "../lib/api";

const OPTIONS = {
  derivation_version: "facility-cost-v1",
  facility_types: [
    { value: "sorting_auto", label: "자동선별 재활용시설 (automated sorting/recycling)" },
    { value: "incineration_new", label: "신규 소각시설 (new incineration)" },
  ],
  subsidy_schemes: [
    { value: "city_or_county", label: "시·군 (30%)", rate: "0.30" },
    { value: "metropolitan_city", label: "광역시 (40%)", rate: "0.40" },
  ],
  underground_multiplier: { min: "1.00", max: "1.40", default: "1.00", note: "지상형 기준 …" },
  default_operating_days: 300,
  cost_versions: ["capex-standard-v2022dec"],
  active_cost_version: "capex-standard-v2022dec",
  disclaimer: "표준공사비 기반 설치비 분석입니다.",
};

function calcFixture(overrides: Partial<FacilityCostCalculate> = {}): FacilityCostCalculate {
  return {
    scenario: {
      facility_type: "sorting_auto",
      facility_type_label: "자동선별 재활용시설",
      processing_share: "1",
      processing_share_percent: "100",
      operating_days_per_year: 300,
      underground_multiplier: "1.00",
      underground_multiplier_note: "지상형 기준 …",
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
      lifetime_basis: "분석용 내용연수 가정 …",
      annualized_construction_cost_bn: "8.050000",
      unit: "억원/년",
      method: "STRAIGHT_LINE_ANALYTICAL",
    },
    subsidy: {
      subsidy_scheme: "city_or_county",
      subsidy_scheme_label: "시·군 (30%)",
      subsidy_rate: "0.30",
      rate_source: "2025년 …",
      rate_reference_period: "2025",
      rate_basis: "명목 국고보조율(분석용 가정) — 실제 승인된 국고보조금이 아님",
      estimated_national_subsidy_bn: "36.225000",
      simplified_local_government_share_bn: "84.525000",
      unit: "억원",
      note: "명목 보조율에 따른 분석용 추정치…",
    },
    per_capita: {
      term_ko: "주민 1인당 환산 지방비",
      per_capita_local_share_won: "42262.50",
      official_service_population: 200000,
      unavailable_reason: null,
      unit: "원",
      caveat: "동일 연도의 공식 인구로 나눈 환산값이며 개인의 실제 세금 청구액이 아닙니다.",
    },
    candidate_context: null,
    completeness: {
      is_partial: true,
      included_components: ["STANDARD_CONSTRUCTION_COST"],
      missing_components: [
        { component: "OPERATING_COST", reason: "OFFICIAL_SOURCE_NOT_INTEGRATED" },
        { component: "ACTUAL_TRANSPORT_COST", reason: "ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE" },
      ],
    },
    provenance: {
      derivation_version: "facility-cost-v1",
      cost_version: "capex-standard-v2022dec",
      price_base_date: "2022-12-01",
      source_document: "2025년 폐기물처리시설 국고보조금 업무처리지침 붙임2",
      source_page: "p.211",
      subsidy_rate_source: "2025년 …",
      subsidy_rate_reference_period: "2025",
    },
    assumptions: ["표준공사비 단가는 …", "연간 환산에 쓰는 시설 내용연수는 분석용 가정…"],
    disclaimer: "표준공사비 기반 설치비 분석입니다. 실제 총사업비가 아닙니다.",
    ...overrides,
  };
}

const h = vi.hoisted(() => ({
  options: vi.fn(),
  calc: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    fetchFacilityCostOptions: h.options,
    fetchFacilityCostCalculate: h.calc,
  };
});

import FacilityCostPanel from "./FacilityCostPanel";

const REGIONS = [
  { code: "KR-SGIS-11110", name: "종로구" },
  { code: "KR-SGIS-11140", name: "중구" },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.options.mockResolvedValue(OPTIONS);
  h.calc.mockResolvedValue(calcFixture());
});
afterEach(cleanup);

async function renderPanel(candidate: CandidateDetail | null = null) {
  const utils = render(<FacilityCostPanel regions={REGIONS} selectedCandidate={candidate} />);
  await waitFor(() => expect(screen.getByTestId("facility-cost-panel")).toBeDefined());
  return utils;
}

function selectRegion(code: string): void {
  const select = screen.getByTestId("facility-cost-regions") as HTMLSelectElement;
  for (const option of Array.from(select.options)) {
    if (option.value === code) option.selected = true;
  }
  fireEvent.change(select);
}

describe("citizen framing", () => {
  it("shows the neutral title and the decision-support disclaimer", async () => {
    await renderPanel();
    expect(screen.getByText("우리 지역에 시설이 생긴다면")).toBeDefined();
    const disclaimer = screen.getByTestId("facility-cost-disclaimer").textContent ?? "";
    expect(disclaimer).toContain("권고하거나 반대를 설득하기 위한 페이지가 아닙니다");
    expect(disclaimer).toContain("시민 의사결정 지원 도구");
  });
});

describe("scenario form", () => {
  it("renders the accessible scenario controls", async () => {
    await renderPanel();
    for (const testId of [
      "facility-cost-facility-type",
      "facility-cost-waste-stream",
      "facility-cost-regions",
      "facility-cost-processing-share",
      "facility-cost-operating-days",
      "facility-cost-underground",
      "facility-cost-subsidy-scheme",
    ]) {
      expect(screen.getByTestId(testId)).toBeDefined();
    }
    // Default operating days come from the options.
    expect((screen.getByTestId("facility-cost-operating-days") as HTMLInputElement).value).toBe(
      "300",
    );
  });

  it("disables calculate until at least one region is selected", async () => {
    await renderPanel();
    const button = screen.getByTestId("facility-cost-calculate") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    selectRegion("KR-SGIS-11110");
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});

describe("results", () => {
  it("shows the exact served values with an aria-live region", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-results")).toBeDefined());
    // aria-live announcement.
    expect(screen.getByTestId("facility-cost-results").getAttribute("role")).toBe("status");
    expect(screen.getByTestId("fc-capacity").textContent).toContain("35 톤/일");
    expect(screen.getByTestId("fc-standard-cost").textContent).toContain("120.75 억원");
    expect(screen.getByTestId("fc-annualized").textContent).toContain("8.05");
    expect(screen.getByTestId("fc-subsidy").textContent).toContain("36.225 억원");
    expect(screen.getByTestId("fc-local-share").textContent).toContain("84.525 억원");
    expect(screen.getByTestId("fc-per-capita").textContent).toContain("42,262.5원");
    // Source + version are shown.
    expect(screen.getByTestId("fc-source").textContent).toContain("p.211");
    expect(screen.getByTestId("fc-source").textContent).toContain("2022-12-01");
  });

  it("renders completeness as explicitly unavailable, never a total or a 0", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-completeness")).toBeDefined());
    const completeness = screen.getByTestId("facility-cost-completeness").textContent ?? "";
    for (const notice of [
      "운영비 미포함",
      "실제 운송비 미포함",
      "토지·보상비 미포함",
      "실제 총사업비가 아님",
      "실제 승인된 국고보조금이 아님",
      "주민 개인의 실제 세금 청구액이 아님",
    ]) {
      expect(completeness).toContain(notice);
    }
    // Never a misleading total.
    expect(document.body.textContent).not.toContain("총비용");
  });

  it("shows the null per-capita as its served reason, never 0원", async () => {
    h.calc.mockResolvedValue(
      calcFixture({
        per_capita: {
          term_ko: "주민 1인당 환산 지방비",
          per_capita_local_share_won: null,
          official_service_population: null,
          unavailable_reason: "INCOMPATIBLE_POPULATION_DEFINITION",
          unit: "원",
          caveat: "동일 연도의 공식 인구로 나눈 환산값…",
        },
      }),
    );
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-results")).toBeDefined());
    const cell = screen.getByTestId("fc-per-capita-unavailable").textContent ?? "";
    expect(cell).toContain("계산 불가");
    expect(cell).toContain("INCOMPATIBLE_POPULATION_DEFINITION");
    expect(cell).not.toContain("0원");
  });

  it("shows the official waste and population sources, not just periods", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("fc-waste-source")).toBeDefined());
    const waste = screen.getByTestId("fc-waste-source").textContent ?? "";
    expect(waste).toContain("RCIS 생활계");
    expect(waste).toContain("waste_statistics");
    expect(waste).toContain("2022");
    const pop = screen.getByTestId("fc-population-source").textContent ?? "";
    expect(pop).toContain("sgis");
    expect(pop).toContain("SGIS_TOTAL_POPULATION");
  });

  it("hides a stale result when a scenario input changes", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-results")).toBeDefined());
    // Change a control → the result no longer matches the live inputs, so it hides.
    fireEvent.change(screen.getByTestId("facility-cost-processing-share"), {
      target: { value: "50" },
    });
    await waitFor(() => expect(screen.queryByTestId("facility-cost-results")).toBeNull());
    expect(screen.getByTestId("facility-cost-stale")).toBeDefined();
  });

  it("hides a late response whose inputs changed while it was pending", async () => {
    let resolveFirst: (v: FacilityCostCalculate) => void = () => undefined;
    // Only the first calculate is queued; the controls stay editable while pending.
    h.calc.mockImplementationOnce(
      () => new Promise<FacilityCostCalculate>((res) => (resolveFirst = res)),
    );
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate")); // pending
    // Add another service region while the request is in flight.
    selectRegion("KR-SGIS-11140");
    // The pending request resolves, but its inputs are now stale → it must not show.
    resolveFirst(calcFixture());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("facility-cost-results")).toBeNull();
    expect(screen.getByTestId("facility-cost-stale")).toBeDefined();
  });

  it("shows an error state (no stale values) when the calculation fails", async () => {
    h.calc.mockRejectedValue(new Error("boom"));
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-error")).toBeDefined());
    expect(screen.queryByTestId("facility-cost-results")).toBeNull();
  });
});

describe("candidate integration", () => {
  it("shows the candidate context and never claims cheapest/approved", async () => {
    h.calc.mockResolvedValue(
      calcFixture({
        candidate_context: {
          candidate_id: 4242,
          candidate_key: "capital-grid-500m-v1:10_20",
          sido_region_name: "인천광역시",
          sigungu_region_name: "강화군",
          suitability_status: "ELIGIBLE",
          run_id: 47,
          profile: "baseline",
          note: "현재 표준 설치비는 동일한 시설 규모라면 후보 셀별로 크게 달라지지 않습니다.",
          suitability_disclaimer: "적합성 상태는 분석용 스크리닝 결과이며 법적 결정이 아닙니다.",
        },
      }),
    );
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-candidate")).toBeDefined());
    const text = screen.getByTestId("facility-cost-candidate").textContent ?? "";
    expect(text).toContain("강화군");
    expect(text).toContain("후보 셀별로 크게 달라지지 않습니다");
    expect(text).not.toContain("최저 비용");
    expect(text).not.toContain("승인된");
  });
});

describe("citizen conditions (client-only)", () => {
  it("renders a non-persistent deliberation section with conditions and a stance", async () => {
    await renderPanel();
    const section = screen.getByTestId("facility-cost-conditions");
    expect(section.textContent).toContain("서버로 전송되거나 집계되지 않습니다");
    const conditions = within(section).getAllByTestId("facility-cost-condition");
    expect(conditions.length).toBeGreaterThanOrEqual(11);
    const stances = within(section).getAllByTestId("facility-cost-response");
    expect(stances).toHaveLength(4);
    // Selecting is local state only (no api call).
    fireEvent.click(conditions[0]);
    expect((conditions[0] as HTMLInputElement).checked).toBe(true);
    expect(h.calc).not.toHaveBeenCalled();
  });
});
