// @vitest-environment jsdom

/**
 * Facility cost lens tests (full-width dashboard; setup workflow redesigned in the
 * desktop redesign's Phase 2).
 *
 * The api client is mocked with CONTROLLED CONTRACT FIXTURES (clearly a test
 * environment) so the dashboard renders without a backend. Asserts the setup
 * controls, validation (calculate disabled until a region is chosen), exact values
 * from the fixture (KPI grid), completeness rendered as explicitly unavailable
 * (never 0), the funding breakdown, the official-input region table, the missing
 * components (never a 0 cost line), the null per-capita path, candidate integration,
 * the citizen framing/disclaimer, and the aria-live result announcement.
 *
 * Phase 2 changed the SETUP interaction only: the native `<select multiple>` is gone
 * and regions are chosen through SearchableRegionPicker, so `selectRegion` below
 * drives the combobox. Every result assertion is deliberately unchanged — the served
 * values, their exact decimal strings, and the unavailable paths must survive the
 * setup redesign untouched.
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

import FacilityCostDashboard from "./FacilityCostDashboard";

// Calculable regions tagged with their waste stream. HOUSEHOLD spans all three
// metropolitan areas and includes the two 중구 that share a name and differ only by
// code (Seoul KR-SGIS-11140 vs Incheon KR-SGIS-23010 — the real SGIS sido digits,
// 11/23/31, that lib/ranking.ts classifies); CONSTRUCTION has one.
const WASTE_REGIONS = [
  { code: "KR-SGIS-11110", name: "종로구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-11140", name: "중구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-23010", name: "중구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-31011", name: "수원시 장안구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-11110", name: "종로구", stream: "CONSTRUCTION" },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.options.mockResolvedValue(OPTIONS);
  h.calc.mockResolvedValue(calcFixture());
});
afterEach(cleanup);

async function renderPanel(candidate: CandidateDetail | null = null) {
  const utils = render(
    <FacilityCostDashboard wasteRegions={WASTE_REGIONS} selectedCandidate={candidate} />,
  );
  // The dashboard shell renders immediately; wait for the scenario form, which
  // only mounts once the (mocked) options have resolved.
  await waitFor(() => expect(screen.getByTestId("facility-cost-form")).toBeDefined());
  return utils;
}

/**
 * Choose a service region through the redesigned picker. The visible option text is
 * a plain name ("서울 중구"), so the option is located by its `data-region-code`
 * TEST hook — the code is intentionally not visible text any more.
 */
function selectRegion(code: string): void {
  fireEvent.focus(screen.getByTestId("facility-cost-region-search"));
  const option = screen
    .getAllByTestId("facility-cost-region-option")
    .find((o) => o.getAttribute("data-region-code") === code);
  if (!option) throw new Error(`no region option offered for ${code}`);
  fireEvent.click(option);
}

function selectedChipLabels(): string[] {
  return screen
    .queryAllByTestId("facility-cost-region-chip")
    .map((chip) => chip.querySelector("span")?.textContent ?? "");
}

describe("citizen framing", () => {
  it("shows the neutral title and the decision-support disclaimer", async () => {
    await renderPanel();
    expect(screen.getByText("시설 비용 살펴보기")).toBeDefined();
    const disclaimer = screen.getByTestId("facility-cost-disclaimer").textContent ?? "";
    expect(disclaimer).toContain("권고하거나 반대를 설득하기 위한 페이지가 아닙니다");
    expect(disclaimer).toContain("시민 의사결정 지원 도구");
  });

  it("keeps the non-claims readable without expanding anything", async () => {
    await renderPanel();
    // The compact banner carries the three claims a citizen must not misread…
    const banner = screen.getByTestId("facility-cost-notice").textContent ?? "";
    expect(banner).toContain("표준공사비");
    expect(banner).toContain("실제 총사업비가 아니며");
    expect(banner).toContain("세금 고지액도 아닙니다");
    // …and the full eight-item exclusion list is still present, in an accordion
    // whose summary states how many items it holds.
    const summary = screen.getByTestId("facility-cost-completeness-summary").textContent ?? "";
    expect(summary).toContain("8가지");
  });
});

describe("setup workflow", () => {
  it("renders the accessible setup controls", async () => {
    await renderPanel();
    for (const testId of [
      "facility-cost-facility-type",
      "facility-cost-waste-stream",
      "facility-cost-region-search",
      "facility-cost-processing-share",
      "facility-cost-operating-days",
      "facility-cost-underground",
      "facility-cost-subsidy-scheme",
      "facility-cost-setup-summary",
      "facility-cost-advanced-settings",
    ]) {
      expect(screen.getByTestId(testId)).toBeDefined();
    }
    // Default operating days come from the options — the redesign moved this
    // control into the accordion, it did not re-seed it.
    expect((screen.getByTestId("facility-cost-operating-days") as HTMLInputElement).value).toBe(
      "300",
    );
  });

  it("has no native multiple-select left in the setup", async () => {
    const { container } = await renderPanel();
    expect(container.querySelector("select[multiple]")).toBeNull();
    expect(screen.queryByTestId("facility-cost-regions")).toBeNull();
  });

  it("disables calculate until at least one region is selected, and says why", async () => {
    await renderPanel();
    const button = screen.getByTestId("facility-cost-calculate") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // The reason is stated politely, not as an alert.
    const status = screen.getByTestId("facility-cost-calculate-status");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toContain("지역을 한 곳 이상 선택");
    selectRegion("KR-SGIS-11110");
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it("offers only calculable regions, disambiguated by metro prefix and never by code", async () => {
    await renderPanel();
    fireEvent.focus(screen.getByTestId("facility-cost-region-search"));
    const labels = screen
      .getAllByTestId("facility-cost-region-option")
      .map((o) => o.textContent ?? "");
    // HOUSEHOLD (default) → four calculable regions, deterministically ordered
    // 서울 → 인천 → 경기, then by name.
    expect(labels).toEqual(["서울 종로구", "서울 중구", "인천 중구", "경기 수원시 장안구"]);
    // The two 중구 are distinguishable WITHOUT any raw region code being visible.
    expect(screen.getByTestId("facility-cost-region-options").textContent).not.toContain("KR-SGIS");
    // Switching to a stream with narrower coverage narrows the choices — a citizen
    // can never pick a region the endpoint cannot calculate.
    fireEvent.change(screen.getByTestId("facility-cost-waste-stream"), {
      target: { value: "CONSTRUCTION" },
    });
    await waitFor(() => {
      fireEvent.focus(screen.getByTestId("facility-cost-region-search"));
      expect(screen.getAllByTestId("facility-cost-region-option")).toHaveLength(1);
    });
    expect(screen.getByTestId("facility-cost-region-options").textContent).toContain("서울 종로구");
  });

  it("shows selected regions as chips and sends their codes unchanged", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11140");
    selectRegion("KR-SGIS-23010");
    await waitFor(() => expect(selectedChipLabels()).toEqual(["서울 중구", "인천 중구"]));
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(h.calc).toHaveBeenCalled());
    // The payload carries the internal codes, unchanged and undecorated.
    expect(h.calc.mock.calls[0][0].regionCodes).toEqual(["KR-SGIS-11140", "KR-SGIS-23010"]);
  });

  it("renders a facility-type card per API option, with native radio semantics", async () => {
    const { container } = await renderPanel();
    const cards = screen.getAllByTestId("facility-cost-facility-type-card");
    // Driven by the options fixture, not by a hardcoded count.
    expect(cards).toHaveLength(OPTIONS.facility_types.length);
    expect(cards.map((c) => c.textContent)).toEqual(OPTIONS.facility_types.map((f) => f.label));
    const radios = container.querySelectorAll<HTMLInputElement>(
      'input[type="radio"][name="facility-cost-facility-type"]',
    );
    expect(radios).toHaveLength(OPTIONS.facility_types.length);
    expect(radios[0].checked).toBe(true);
    // Selecting through the card updates the scenario and the summary.
    fireEvent.click(radios[1]);
    await waitFor(() => expect(radios[1].checked).toBe(true));
    expect(screen.getByTestId("facility-cost-setup-summary").textContent).toContain(
      OPTIONS.facility_types[1].label,
    );
    // Selection is not signalled by color alone.
    expect(cards[1].getAttribute("data-selected")).toBe("true");
  });

  it("keeps the advanced defaults and reports whether they were changed", async () => {
    await renderPanel();
    const summary = () => screen.getByTestId("facility-cost-summary-advanced").textContent;
    expect(summary()).toBe("기본값");
    expect((screen.getByTestId("facility-cost-underground") as HTMLInputElement).value).toBe("1.00");
    expect((screen.getByTestId("facility-cost-subsidy-scheme") as HTMLSelectElement).value).toBe(
      "city_or_county",
    );
    fireEvent.change(screen.getByTestId("facility-cost-operating-days"), {
      target: { value: "320" },
    });
    await waitFor(() => expect(summary()).toBe("기본값에서 변경됨"));
  });

  it("summarises many selected regions without listing them all or showing a code", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("facility-cost-regions-seoul"));
    fireEvent.click(screen.getByTestId("facility-cost-regions-incheon"));
    await waitFor(() =>
      expect(screen.getByTestId("facility-cost-summary-regions").textContent).toContain("3개"),
    );
    const text = screen.getByTestId("facility-cost-summary-regions").textContent ?? "";
    expect(text).toContain("외 1개");
    expect(text).not.toContain("KR-SGIS");
  });

  it("shows the subsidy-rate source in the form, before any calculation", async () => {
    await renderPanel();
    const note = screen.getByTestId("facility-cost-subsidy-note").textContent ?? "";
    expect(note).toContain("국고보조금 업무처리지침");
    expect(note).toContain("승인된 국고보조금이 아");
  });

  it("validates numeric inputs, disabling calculate with an announced message", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    const button = screen.getByTestId("facility-cost-calculate") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    // Out-of-range processing share → disabled + accessible message.
    fireEvent.change(screen.getByTestId("facility-cost-processing-share"), {
      target: { value: "150" },
    });
    await waitFor(() => expect(button.disabled).toBe(true));
    expect(screen.getByTestId("facility-cost-validation").textContent).toContain("0–100");
    expect(screen.getByTestId("facility-cost-validation").getAttribute("role")).toBe("alert");
    // A blank operating-days field (stored as 0) is also caught.
    fireEvent.change(screen.getByTestId("facility-cost-processing-share"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByTestId("facility-cost-operating-days"), { target: { value: "" } });
    await waitFor(() => expect(button.disabled).toBe(true));
    // Fixing the inputs re-enables calculate.
    fireEvent.change(screen.getByTestId("facility-cost-operating-days"), {
      target: { value: "300" },
    });
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it("clears the selected regions when the waste stream changes", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11140");
    expect((screen.getByTestId("facility-cost-calculate") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByTestId("facility-cost-waste-stream"), {
      target: { value: "CONSTRUCTION" },
    });
    // The 중구 selection is not valid for CONSTRUCTION, so it is cleared.
    await waitFor(() =>
      expect((screen.getByTestId("facility-cost-calculate") as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
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

describe("dashboard KPI grid, funding, region table, missing components", () => {
  async function calculate() {
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-kpi-grid")).toBeDefined());
  }

  it("renders the eight KPI concepts with their exact units and never a total-cost label", async () => {
    await calculate();
    // 1 official annual quantity, 2 scenario quantity, 3 required capacity, 4
    // standard construction cost, 5 annualized, 6 subsidy, 7 local share, 8 per-capita.
    expect(screen.getByTestId("fc-official-quantity").textContent).toContain("10,500 톤/년");
    expect(screen.getByTestId("fc-scenario-quantity").textContent).toContain("10,500 톤/년");
    expect(screen.getByTestId("fc-capacity").textContent).toContain("35 톤/일");
    expect(screen.getByTestId("fc-standard-cost").textContent).toContain("120.75 억원");
    expect(screen.getByTestId("fc-annualized").textContent).toContain("8.05 억원/년");
    expect(screen.getByTestId("fc-subsidy").textContent).toContain("36.225 억원");
    expect(screen.getByTestId("fc-local-share").textContent).toContain("84.525 억원");
    expect(screen.getByTestId("fc-per-capita").textContent).toContain("42,262.5원");
    // "총비용" never appears (the standard-cost value is not a total). The honest
    // caveats DO say "…이 아닙니다" (e.g. "실제 총사업비가 아님"), which is required
    // and must not be mistaken for a prohibited affirmative label — so only the
    // never-honest "총비용" is banned outright here.
    expect(document.body.textContent).not.toContain("총비용");
    // The KPI labels themselves use the honest concept names, not an overstated
    // "actual/approved/final" claim.
    const grid = screen.getByTestId("facility-cost-kpi-grid").textContent ?? "";
    expect(grid).toContain("표준공사비 기반 설치비 산정액");
    expect(grid).toContain("명목 국고보조 추정액");
    expect(grid).not.toContain("확정 보조금");
    expect(grid).not.toContain("확정 사업비");
  });

  it("shows a funding breakdown of subsidy + local share summing to the installation cost", async () => {
    await calculate();
    const funding = screen.getByTestId("facility-cost-funding");
    expect(funding).toBeDefined();
    // The exact served strings are shown as text (not reconstructed from floats).
    expect(screen.getByTestId("fc-funding-subsidy").textContent).toContain("36.225 억원");
    expect(screen.getByTestId("fc-funding-local").textContent).toContain("84.525 억원");
    expect(screen.getByTestId("fc-funding-total").textContent).toContain("120.75 억원");
    // Conceptually subsidy + local == total (36.225 + 84.525 == 120.75).
    expect(36.225 + 84.525).toBeCloseTo(120.75, 3);
    // Explicitly states it does NOT imply subsidy approval.
    expect(funding.textContent).toContain("승인을 의미하지 않");
  });

  it("uses the official input for the region table without inventing a cost allocation", async () => {
    await calculate();
    const table = screen.getByTestId("facility-cost-region-table");
    const rows = within(table).getAllByTestId("fc-region-row");
    expect(rows.length).toBe(1);
    const text = rows[0].textContent ?? "";
    expect(text).toContain("종로구");
    expect(text).toContain("10,500");
    // Population from the official input, never 0명.
    expect(text).toContain("200,000명");
    // The share is a labelled derived display; no per-region cost is shown.
    expect(table.textContent).toContain("표시용 파생값");
    expect(table.textContent).not.toContain("억원");
  });

  it("shows the official population as unavailable text, never 0명, when absent", async () => {
    h.calc.mockResolvedValue(
      calcFixture({
        official_input: {
          ...calcFixture().official_input,
          regions: [
            {
              region_code: "KR-SGIS-11110",
              region_name: "종로구",
              generation_quantity_ton: "10500.000000",
              population: null,
            },
          ],
        },
      }),
    );
    await calculate();
    const cell = screen.getByTestId("fc-region-population-unavailable").textContent ?? "";
    expect(cell).toContain("공식 인구 미확정");
    const table = screen.getByTestId("facility-cost-region-table").textContent ?? "";
    expect(table).not.toContain("0명");
  });

  it("lists backend missing components with Korean labels + reasons, never as a 0 cost", async () => {
    await calculate();
    const missing = screen.getByTestId("facility-cost-missing");
    const rows = within(missing).getAllByTestId("facility-cost-missing-row");
    // The fixture has OPERATING_COST + ACTUAL_TRANSPORT_COST.
    expect(rows.length).toBe(2);
    const text = missing.textContent ?? "";
    expect(text).toContain("운영비");
    expect(text).toContain("실제 운송비");
    // The backend reason codes are retained, never discarded.
    expect(text).toContain("OFFICIAL_SOURCE_NOT_INTEGRATED");
    expect(text).toContain("ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE");
    // Missing is never rendered as a zero cost.
    expect(text).not.toContain("0 억원");
  });

  it("renders exactly one h1 with the neutral heading", async () => {
    const { container } = await renderPanel();
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toContain("시설 비용 살펴보기");
  });
});

const CANDIDATE = {
  candidate_id: 4242,
  candidate_key: "capital-grid-500m-v1:10_20",
  reference_year: 2024,
  derivation_version: "suitability-screening-v1",
  policy_version: "suitability-policy-v1",
  candidate_grid_version: "capital-grid-500m-v1",
} as unknown as CandidateDetail;

describe("candidate integration", () => {
  it("shows the candidate context + provenance and never claims cheapest/approved", async () => {
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
    await renderPanel(CANDIDATE);
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-candidate")).toBeDefined());
    const text = screen.getByTestId("facility-cost-candidate").textContent ?? "";
    expect(text).toContain("강화군");
    expect(text).toContain("후보 셀별로 크게 달라지지 않습니다");
    expect(text).not.toContain("최저 비용");
    expect(text).not.toContain("승인된");
    // The analytical status carries its reference year + derivation/policy version.
    const prov = screen.getByTestId("fc-candidate-provenance").textContent ?? "";
    expect(prov).toContain("2024");
    expect(prov).toContain("suitability-screening-v1");
    expect(prov).toContain("suitability-policy-v1");
  });
});

describe("matched band endpoint semantics", () => {
  it("reflects the inclusivity flags, not a bare min–max", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("fc-matched-band")).toBeDefined());
    const band = screen.getByTestId("fc-matched-band").textContent ?? "";
    // The (30, 40] band excludes exactly 30 → shown as "30 … 초과", "40 … 이하".
    expect(band).toContain("초과");
    expect(band).toContain("이하");
    expect(band).not.toMatch(/30[–-]40/);
  });
});

describe("citizen deliberation removal", () => {
  it("no longer renders the client-only conditions/stance section at all", async () => {
    await renderPanel();
    for (const testId of [
      "facility-cost-conditions",
      "facility-cost-condition",
      "facility-cost-response",
    ]) {
      expect(screen.queryAllByTestId(testId)).toHaveLength(0);
    }
    // None of its copy reaches the page — neither the CITIZEN_CONDITIONS strings
    // nor the CITIZEN_RESPONSES stances nor the section's own framing.
    const text = document.body.textContent ?? "";
    for (const copy of [
      "시민 검토 조건",
      "서버로 전송되거나 집계되지 않습니다",
      "실시간 배출정보 공개",
      "주민 감시 또는 협의체",
      "기준 초과 시 가동중단 절차",
      "현재 정보만으로도 검토 가능",
      "시설 설치에 반대함",
    ]) {
      expect(text).not.toContain(copy);
    }
    expect(document.body.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("does not affect the calculation request or its result values", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-results")).toBeDefined());
    // The payload is exactly the scenario — the removed section contributed no field.
    expect(h.calc.mock.calls[0][0]).toEqual({
      facilityType: "sorting_auto",
      wasteStream: "HOUSEHOLD",
      subsidyScheme: "city_or_county",
      regionCodes: ["KR-SGIS-11110"],
      processingSharePercent: "100",
      operatingDays: 300,
      undergroundMultiplier: "1.00",
      costVersion: "capex-standard-v2022dec",
      candidateId: null,
    });
    expect(screen.getByTestId("fc-standard-cost").textContent).toContain("120.75 억원");
  });
});
