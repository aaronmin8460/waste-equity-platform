// @vitest-environment jsdom

/**
 * Facility cost lens tests (full-width dashboard).
 *
 * The api client is mocked with CONTROLLED CONTRACT FIXTURES (clearly a test
 * environment) so the dashboard renders without a backend.
 *
 * Phase 2 changed the SETUP interaction: the native `<select multiple>` is gone and
 * regions are chosen through SearchableRegionPicker, so `selectRegion` below drives
 * the combobox.
 *
 * Phase 3 splits setup from results. Two consequences run through this file:
 *
 *  1. A result is no longer visible beside the form — `calculate()` now navigates to
 *     the results view, and `openSection()` expands the collapsed accordion a value
 *     lives in. The setup assertions are deliberately unchanged.
 *  2. Primary surfaces show APPROXIMATIONS ("약 121억원"). The exact-value
 *     assertions are not weakened, they are re-pointed at the "정밀값과 계산 기준"
 *     section, which must still carry the untouched backend decimal strings. The
 *     same applies to the raw reason codes: they must be absent from the primary
 *     surface and still present in the diagnostic disclosure.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CandidateDetail, FacilityCostCalculate } from "../lib/api";
import { FORBIDDEN_PRIMARY_TOKENS } from "../lib/glossary";

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

/** Select a region, submit, and wait for the results view to replace the setup. */
async function calculateToResults(code = "KR-SGIS-11110"): Promise<void> {
  selectRegion(code);
  fireEvent.click(screen.getByTestId("facility-cost-calculate"));
  await waitFor(() => expect(screen.getByTestId("facility-cost-results-view")).toBeDefined());
}

/** Expand one collapsed results accordion by its testId. */
function openSection(testId: string): HTMLElement {
  const details = screen.getByTestId(testId) as HTMLDetailsElement;
  details.open = true;
  return details;
}

/**
 * The text a citizen can reach on the results screen WITHOUT opening a diagnostic
 * disclosure. Diagnostic subtrees are removed rather than excluded by selector, so
 * a code that moves into a new diagnostic block is still covered.
 *
 * Note this is stricter than what is visually rendered: jsdom's `textContent`
 * includes the bodies of collapsed `<details>`, so an accordion cannot hide a leak
 * from this check.
 */
function primaryResultsText(): string {
  const view = screen.getByTestId("facility-cost-results-view").cloneNode(true) as HTMLElement;
  for (const node of Array.from(view.querySelectorAll("[data-diagnostic]"))) node.remove();
  return view.textContent ?? "";
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

describe("setup → results transition", () => {
  it("switches from the setup view to the results view on a successful calculation", async () => {
    await renderPanel();
    // Before calculating, setup is the screen and there is no results view.
    expect(screen.getByTestId("facility-cost-setup-view")).toBeDefined();
    expect(screen.queryByTestId("facility-cost-results-view")).toBeNull();

    await calculateToResults();

    // After calculating, the results view replaces it — the setup form is no
    // longer the main screen sitting above a result.
    expect(screen.queryByTestId("facility-cost-setup-view")).toBeNull();
    expect(screen.queryByTestId("facility-cost-form")).toBeNull();
    expect(screen.queryByTestId("facility-cost-calculate")).toBeNull();
  });

  it("keeps the results announcement region on the KPI block", async () => {
    await renderPanel();
    await calculateToResults();
    // The live region holds the answer, NOT the collapsed accordions — a
    // collapsed <details> must never be the only home for a role="status".
    const results = screen.getByTestId("facility-cost-results");
    expect(results.getAttribute("role")).toBe("status");
    expect(within(results).getByTestId("facility-cost-hero")).toBeDefined();
    expect(within(results).queryByTestId("facility-cost-exclusions")).toBeNull();
  });

  it("returns to setup via 설정 바꾸기, preserving every input and issuing no request", async () => {
    await renderPanel();
    // A non-default scenario, so "preserved" means something.
    fireEvent.change(screen.getByTestId("facility-cost-processing-share"), {
      target: { value: "60" },
    });
    fireEvent.change(screen.getByTestId("facility-cost-operating-days"), {
      target: { value: "320" },
    });
    selectRegion("KR-SGIS-11140");
    selectRegion("KR-SGIS-23010");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-results-view")).toBeDefined());
    const callsAfterCalculate = h.calc.mock.calls.length;

    fireEvent.click(screen.getByTestId("facility-cost-edit-settings"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-setup-view")).toBeDefined());

    // Every selection survived the round trip.
    expect(selectedChipLabels()).toEqual(["서울 중구", "인천 중구"]);
    expect((screen.getByTestId("facility-cost-processing-share") as HTMLInputElement).value).toBe(
      "60",
    );
    expect((screen.getByTestId("facility-cost-operating-days") as HTMLInputElement).value).toBe(
      "320",
    );
    expect((screen.getByTestId("facility-cost-waste-stream") as HTMLSelectElement).value).toBe(
      "HOUSEHOLD",
    );
    // Returning is pure view state: it must not re-submit the scenario.
    expect(h.calc.mock.calls.length).toBe(callsAfterCalculate);
    // …and it must not silently discard the result either.
    expect(screen.queryByTestId("facility-cost-stale")).toBeNull();
  });

  it("moves focus to the setup heading when returning", async () => {
    await renderPanel();
    await calculateToResults();
    fireEvent.click(screen.getByTestId("facility-cost-edit-settings"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-setup-view")).toBeDefined());
    expect(document.activeElement?.id).toBe("fc-step-regions");
  });

  it("recalculates with the CHANGED inputs after returning to setup", async () => {
    await renderPanel();
    await calculateToResults();
    fireEvent.click(screen.getByTestId("facility-cost-edit-settings"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-setup-view")).toBeDefined());

    fireEvent.change(screen.getByTestId("facility-cost-processing-share"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-results-view")).toBeDefined());

    const last = h.calc.mock.calls[h.calc.mock.calls.length - 1][0];
    expect(last.processingSharePercent).toBe("50");
  });

  it("stays on setup when the calculation fails, keeping the settings and allowing retry", async () => {
    h.calc.mockRejectedValueOnce(new Error("boom"));
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-error")).toBeDefined());

    // No results view opened, and the form is still there with its selection.
    expect(screen.queryByTestId("facility-cost-results-view")).toBeNull();
    expect(screen.getByTestId("facility-cost-setup-view")).toBeDefined();
    expect(selectedChipLabels()).toEqual(["서울 종로구"]);
    // The error is a genuine, actionable one.
    expect(screen.getByTestId("facility-cost-error").getAttribute("role")).toBe("alert");

    // Retry succeeds and now navigates.
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-results-view")).toBeDefined());
  });

  it("announces progress and shows a skeleton while calculating, without leaving setup", async () => {
    let resolve: (v: FacilityCostCalculate) => void = () => undefined;
    h.calc.mockImplementationOnce(
      () => new Promise<FacilityCostCalculate>((res) => (resolve = res)),
    );
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));

    await waitFor(() => expect(screen.getByTestId("facility-cost-calculating")).toBeDefined());
    expect(screen.getByTestId("facility-cost-setup-view")).toBeDefined();
    expect(screen.queryByTestId("facility-cost-results-view")).toBeNull();
    expect(
      screen.getByTestId("facility-cost-calculating-status").getAttribute("role"),
    ).toBe("status");
    // Duplicate submission is prevented while in flight.
    expect((screen.getByTestId("facility-cost-calculate") as HTMLButtonElement).disabled).toBe(
      true,
    );

    resolve(calcFixture());
    await waitFor(() => expect(screen.getByTestId("facility-cost-results-view")).toBeDefined());
  });

  it("cannot be switched to results by a late response from superseded inputs", async () => {
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
    // The pending request resolves, but its inputs are now stale → it must neither
    // render nor navigate.
    resolveFirst(calcFixture());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("facility-cost-results-view")).toBeNull();
    expect(screen.queryByTestId("facility-cost-results")).toBeNull();
    expect(screen.getByTestId("facility-cost-setup-view")).toBeDefined();
  });

  it("drops back to setup with the recalculate notice if the inputs change under a result", async () => {
    await renderPanel();
    await calculateToResults();
    fireEvent.click(screen.getByTestId("facility-cost-edit-settings"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-setup-view")).toBeDefined());
    // Change a control → the result no longer matches the live inputs, so it hides.
    fireEvent.change(screen.getByTestId("facility-cost-processing-share"), {
      target: { value: "50" },
    });
    await waitFor(() => expect(screen.getByTestId("facility-cost-stale")).toBeDefined());
    expect(screen.queryByTestId("facility-cost-results")).toBeNull();
  });
});

describe("results — hero and secondary KPIs", () => {
  it("leads with ONE hero KPI: the per-capita local share, approximated", async () => {
    await renderPanel();
    await calculateToResults();
    const hero = screen.getByTestId("facility-cost-hero");
    expect(hero.textContent).toContain("주민 1인당 환산 지방비");
    // 42,262.50원 → 4.226250만원 → 약 4만원.
    expect(screen.getByTestId("fc-per-capita").textContent).toBe("약 4만원");
    // Exactly one hero on the screen.
    expect(screen.getAllByTestId("facility-cost-hero")).toHaveLength(1);
  });

  it("keeps the hero's not-a-bill caveat and never relabels it as a charge", async () => {
    await renderPanel();
    await calculateToResults();
    const card = screen.getByTestId("facility-cost-hero");
    const hero = card.textContent ?? "";
    expect(hero).toContain("개인에게 실제로 청구되는 세금이나 부담금이 아닙니다");
    expect(hero).toContain("개인의 실제 세금 청구액이 아닙니다");
    // The prohibited terms are prohibited as AFFIRMATIVE LABELS. The honest caveats
    // legitimately contain "…이 아닙니다" negations (which is why the served caveat
    // above reads "실제 세금 청구액이 아닙니다"), so the label itself is what is
    // checked here — it must stay the served term, never a relabelled charge.
    const label = card.querySelector("dt")?.textContent ?? "";
    expect(label).toBe("주민 1인당 환산 지방비");
    for (const banned of ["주민 부담 청구액", "개인 부담금", "확정 주민 부담"]) {
      expect(hero).not.toContain(banned);
    }
  });

  it("shows exactly three secondary KPIs, all as approximations", async () => {
    await renderPanel();
    await calculateToResults();
    // 120.750000 억원 → 약 121억원
    expect(screen.getByTestId("fc-standard-cost").textContent).toBe("약 121억원");
    // 35.000000 톤/일 is exact at this precision, so it carries no "약"
    expect(screen.getByTestId("fc-capacity").textContent).toBe("35톤/일");
    // 8.050000 억원/년 → 약 8억원/년
    expect(screen.getByTestId("fc-annualized").textContent).toBe("약 8억원/년");
    // The two funding figures are no longer top-level KPIs — they moved into the
    // 국비·지방비 구성 accordion, so the secondary row holds exactly three cards.
    const secondary = screen.getByTestId("facility-cost-results").querySelectorAll("dl");
    // One <dl> for the hero, one for the three secondary cards.
    expect(secondary).toHaveLength(2);
    expect(secondary[1].querySelectorAll("dt")).toHaveLength(3);
  });

  it("keeps the honest concept names and never an affirmative total-cost label", async () => {
    await renderPanel();
    await calculateToResults();
    const results = screen.getByTestId("facility-cost-results").textContent ?? "";
    expect(results).toContain("표준공사비 기반 설치비 산정액");
    expect(results).toContain("연간 환산 설치비");
    expect(document.body.textContent).not.toContain("총비용");
    for (const banned of ["총사업비 산정", "확정 사업비", "최종 사업비", "확정 보조금"]) {
      expect(document.body.textContent).not.toContain(banned);
    }
  });

  it("shows an unavailable per-capita as its plain reason, never 0원", async () => {
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
    await calculateToResults();
    // The hero keeps its position and states why, in Korean.
    const cell = screen.getByTestId("fc-per-capita-unavailable").textContent ?? "";
    expect(cell).toContain("계산 불가");
    expect(cell).toContain("집계 정의가 달라");
    expect(cell).not.toContain("0원");
    // The raw code is NOT on the primary surface…
    expect(primaryResultsText()).not.toContain("INCOMPATIBLE_POPULATION_DEFINITION");
    // …but it is still reachable diagnostically, never discarded.
    openSection("facility-cost-exact-values");
    expect(screen.getByTestId("facility-cost-diagnostics").textContent).toContain(
      "INCOMPATIBLE_POPULATION_DEFINITION",
    );
    // And the exact-value section does not invent a number for it either.
    const exact = screen.getByTestId("fc-exact-per-capita-unavailable").textContent ?? "";
    expect(exact).toContain("계산 불가");
    expect(exact).not.toContain("0원");
  });
});

describe("results — exact values are preserved unchanged", () => {
  it("carries every exact backend decimal string in 정밀값과 계산 기준", async () => {
    await renderPanel();
    await calculateToResults();
    openSection("facility-cost-exact-values");
    // These are the same literal strings the pre-Phase-3 KPI grid asserted; they
    // moved to the exact-value section, they were not weakened.
    expect(screen.getByTestId("fc-official-quantity").textContent).toContain("10,500 톤/년");
    expect(screen.getByTestId("fc-scenario-quantity").textContent).toContain("10,500 톤/년");
    expect(screen.getByTestId("fc-exact-capacity").textContent).toContain("35 톤/일");
    expect(screen.getByTestId("fc-exact-standard-cost").textContent).toContain("120.75 억원");
    expect(screen.getByTestId("fc-exact-annualized").textContent).toContain("8.05 억원/년");
    expect(screen.getByTestId("fc-exact-subsidy").textContent).toContain("36.225 억원");
    expect(screen.getByTestId("fc-exact-local-share").textContent).toContain("84.525 억원");
    expect(screen.getByTestId("fc-exact-per-capita").textContent).toContain("42,262.5원");
  });

  it("never reconstructs an exact value from the approximation", async () => {
    await renderPanel();
    await calculateToResults();
    openSection("facility-cost-exact-values");
    // The approximate and exact renderings of the same field are different strings,
    // and the exact one is the untouched backend value.
    expect(screen.getByTestId("fc-standard-cost").textContent).toBe("약 121억원");
    expect(screen.getByTestId("fc-exact-standard-cost").textContent).toBe("120.75 억원");
    // 121 (the rounded display) must not appear as an exact figure.
    expect(screen.getByTestId("fc-exact-standard-cost").textContent).not.toBe("121 억원");
  });

  it("labels the approximations as approximations", async () => {
    await renderPanel();
    await calculateToResults();
    openSection("facility-cost-exact-values");
    expect(screen.getByTestId("facility-cost-exact-values").textContent).toContain(
      "반올림한 표시용 근삿값",
    );
  });
});

describe("results — detail accordions", () => {
  it("collapses every detail section by default", async () => {
    await renderPanel();
    await calculateToResults();
    for (const testId of [
      "facility-cost-funding-section",
      "facility-cost-region-section",
      "facility-cost-assumptions",
      "facility-cost-exclusions",
      "facility-cost-methodology-section",
      "facility-cost-exact-values",
    ]) {
      expect((screen.getByTestId(testId) as HTMLDetailsElement).open).toBe(false);
    }
  });

  it("keeps the funding amounts exact and still refuses to imply approval", async () => {
    await renderPanel();
    await calculateToResults();
    const funding = openSection("facility-cost-funding-section");
    expect(screen.getByTestId("fc-funding-subsidy").textContent).toContain("36.225 억원");
    expect(screen.getByTestId("fc-funding-local").textContent).toContain("84.525 억원");
    expect(screen.getByTestId("fc-funding-total").textContent).toContain("120.75 억원");
    // Conceptually subsidy + local == total (36.225 + 84.525 == 120.75).
    expect(36.225 + 84.525).toBeCloseTo(120.75, 3);
    expect(funding.textContent).toContain("승인을 의미하지 않");
    // The rate and its basis travel with the amounts.
    expect(screen.getByTestId("fc-funding-scheme").textContent).toContain("0.30");
    expect(screen.getByTestId("fc-funding-rate-basis").textContent).toContain(
      "실제 승인된 국고보조금이 아님",
    );
  });

  it("keeps the official-input region rows unchanged and invents no allocation", async () => {
    await renderPanel();
    await calculateToResults();
    openSection("facility-cost-region-section");
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

  it("shows an unavailable official population as text, never 0명", async () => {
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
    await renderPanel();
    await calculateToResults();
    openSection("facility-cost-region-section");
    const cell = screen.getByTestId("fc-region-population-unavailable").textContent ?? "";
    expect(cell).toContain("공식 인구 미확정");
    const table = screen.getByTestId("facility-cost-region-table").textContent ?? "";
    expect(table).not.toContain("0명");
  });

  it("carries the calculation assumptions with Korean-first labels", async () => {
    await renderPanel();
    await calculateToResults();
    const assumptions = openSection("facility-cost-assumptions");
    const text = assumptions.textContent ?? "";
    for (const label of [
      "폐기물 종류",
      "시설 종류",
      "지역 처리 비율",
      "연간 가동일수",
      "지하화 배수",
      "보조 시나리오",
      "적용 표준공사비 구간",
      "연간 환산 기준",
    ]) {
      expect(text, `계산 가정 is missing ${label}`).toContain(label);
    }
    // The served assumption sentences are all still rendered.
    expect(within(assumptions).getByTestId("fc-assumption-list").children).toHaveLength(2);
  });

  it("reflects the matched band's inclusivity flags, not a bare min–max", async () => {
    await renderPanel();
    await calculateToResults();
    openSection("facility-cost-assumptions");
    const band = screen.getByTestId("fc-matched-band").textContent ?? "";
    // The (30, 40] band excludes exactly 30 → shown as "30 … 초과", "40 … 이하".
    expect(band).toContain("초과");
    expect(band).toContain("이하");
    expect(band).not.toMatch(/30[–-]40/);
  });

  it("keeps the sources and reference periods reachable", async () => {
    await renderPanel();
    await calculateToResults();
    openSection("facility-cost-methodology-section");
    expect(screen.getByTestId("fc-source").textContent).toContain("p.211");
    expect(screen.getByTestId("fc-source").textContent).toContain("2022-12-01");
    const waste = screen.getByTestId("fc-waste-source").textContent ?? "";
    expect(waste).toContain("RCIS 생활계");
    expect(waste).toContain("waste_statistics");
    expect(waste).toContain("2022");
    // The accounting basis is named in plain Korean, not left as a raw enum.
    expect(waste).toContain("발생지 기준");
    const pop = screen.getByTestId("fc-population-source").textContent ?? "";
    expect(pop).toContain("sgis");
  });
});

describe("results — excluded cost components", () => {
  it("moves the missing components into the exclusions accordion, counted in its summary", async () => {
    await renderPanel();
    await calculateToResults();
    // The summary states how many items it holds, before anything is expanded.
    expect(screen.getByTestId("facility-cost-exclusions-summary").textContent).toContain(
      "포함되지 않은 비용 5개",
    );
    openSection("facility-cost-exclusions");
    const missing = screen.getByTestId("facility-cost-missing");
    const rows = within(missing).getAllByTestId("facility-cost-missing-row");
    expect(rows).toHaveLength(5);
    const text = missing.textContent ?? "";
    for (const label of [
      "운영비",
      "실제 운송비",
      "토지·보상비",
      "잔여 매립비용",
      "후보지별 토목조건",
    ]) {
      expect(text, `exclusions is missing ${label}`).toContain(label);
    }
    // Missing is never rendered as a zero cost.
    expect(text).not.toContain("0 억원");
    expect(text).toContain("비용이 0이라는 뜻이");
  });

  it("states each exclusion in plain Korean, not as a backend code", async () => {
    await renderPanel();
    await calculateToResults();
    openSection("facility-cost-exclusions");
    const text = screen.getByTestId("facility-cost-missing").textContent ?? "";
    expect(text).toContain("공식 자료가 아직 이 분석에 연결되지 않았습니다");
    expect(text).toContain("실제 수집·운반 경로와 계약 단가 자료가 없어");
  });

  it("retains the raw served codes in the diagnostic disclosure", async () => {
    await renderPanel();
    await calculateToResults();
    openSection("facility-cost-exclusions");
    // The fixture serves OPERATING_COST + ACTUAL_TRANSPORT_COST; both codes and
    // both reasons survive, they are only demoted out of the primary surface.
    const diagnostic = screen.getByTestId("facility-cost-missing-diagnostic").textContent ?? "";
    expect(diagnostic).toContain("OPERATING_COST");
    expect(diagnostic).toContain("OFFICIAL_SOURCE_NOT_INTEGRATED");
    expect(diagnostic).toContain("ACTUAL_TRANSPORT_COST");
    expect(diagnostic).toContain("ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE");
  });

  it("appends an unrecognised component instead of swallowing it", async () => {
    h.calc.mockResolvedValue(
      calcFixture({
        completeness: {
          is_partial: true,
          included_components: ["STANDARD_CONSTRUCTION_COST"],
          missing_components: [{ component: "SOME_FUTURE_COST", reason: "A_BRAND_NEW_REASON" }],
        },
      }),
    );
    await renderPanel();
    await calculateToResults();
    openSection("facility-cost-exclusions");
    const rows = within(screen.getByTestId("facility-cost-missing")).getAllByTestId(
      "facility-cost-missing-row",
    );
    // 4 standing components + the unknown one + 후보지별 토목조건.
    expect(rows).toHaveLength(6);
    const text = screen.getByTestId("facility-cost-missing").textContent ?? "";
    // An unknown code gets the SAFE generic sentence, never an invented dataset.
    expect(text).toContain("현재 공식 계산 자료가 제공되지 않습니다");
    // The raw unknown code is still preserved diagnostically.
    expect(screen.getByTestId("facility-cost-missing-diagnostic").textContent).toContain(
      "A_BRAND_NEW_REASON",
    );
  });
});

describe("results — no raw codes on the primary surface", () => {
  it("keeps every forbidden technical token out of the primary results surface", async () => {
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
        completeness: {
          is_partial: true,
          included_components: ["STANDARD_CONSTRUCTION_COST"],
          missing_components: [
            { component: "OPERATING_COST", reason: "OFFICIAL_SOURCE_NOT_INTEGRATED" },
            {
              component: "ACTUAL_TRANSPORT_COST",
              reason: "ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE",
            },
            { component: "LAND_AND_COMPENSATION", reason: "PARCEL_SPECIFIC_COST_UNAVAILABLE" },
            {
              component: "REMAINING_LANDFILL_COST",
              reason: "FACILITY_MASS_BALANCE_NOT_ESTABLISHED",
            },
          ],
        },
      }),
    );
    await renderPanel(CANDIDATE);
    await calculateToResults();
    const text = primaryResultsText();
    for (const token of FORBIDDEN_PRIMARY_TOKENS) {
      expect(text.includes(token), `cost results leak "${token}"`).toBe(false);
    }
  });

  it("names the four documented reason codes in plain Korean instead", async () => {
    h.calc.mockResolvedValue(
      calcFixture({
        completeness: {
          is_partial: true,
          included_components: ["STANDARD_CONSTRUCTION_COST"],
          missing_components: [
            { component: "OPERATING_COST", reason: "OFFICIAL_SOURCE_NOT_INTEGRATED" },
            {
              component: "ACTUAL_TRANSPORT_COST",
              reason: "ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE",
            },
            { component: "LAND_AND_COMPENSATION", reason: "PARCEL_SPECIFIC_COST_UNAVAILABLE" },
            {
              component: "REMAINING_LANDFILL_COST",
              reason: "FACILITY_MASS_BALANCE_NOT_ESTABLISHED",
            },
          ],
        },
      }),
    );
    await renderPanel();
    await calculateToResults();
    const primary = primaryResultsText();
    for (const code of [
      "OFFICIAL_SOURCE_NOT_INTEGRATED",
      "ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE",
      "PARCEL_SPECIFIC_COST_UNAVAILABLE",
      "FACILITY_MASS_BALANCE_NOT_ESTABLISHED",
    ]) {
      expect(primary.includes(code), `primary surface shows raw code ${code}`).toBe(false);
      // …and each is still reachable in the diagnostic layer.
      expect(screen.getByTestId("facility-cost-missing-diagnostic").textContent).toContain(code);
    }
    // The plain sentences that replaced them.
    expect(primary).toContain("필지별 비용 자료가 없어");
    expect(primary).toContain("남는 물질의 양이 확정되지 않아");
  });
});

describe("results — scenario summary and page structure", () => {
  it("summarises the scenario without listing every region or showing a code", async () => {
    await renderPanel();
    h.calc.mockResolvedValue(
      calcFixture({
        official_input: {
          ...calcFixture().official_input,
          regions: [
            {
              region_code: "KR-SGIS-11110",
              region_name: "종로구",
              generation_quantity_ton: "3500.000000",
              population: 100000,
            },
            {
              region_code: "KR-SGIS-11140",
              region_name: "중구",
              generation_quantity_ton: "3500.000000",
              population: 50000,
            },
            {
              region_code: "KR-SGIS-23010",
              region_name: "중구",
              generation_quantity_ton: "3500.000000",
              population: 50000,
            },
          ],
        },
      }),
    );
    await calculateToResults();
    const context = screen.getByTestId("facility-cost-results-context").textContent ?? "";
    expect(context).toContain("선택한 3개 지역");
    // A short summary, not the full list.
    expect(context).toContain("외 1개");
    expect(context).toContain("생활계 폐기물");
    expect(context).toContain("처리 비율 100%");
    expect(context).toContain("자동선별 재활용시설");
    // Never a raw region code.
    expect(context).not.toContain("KR-SGIS");
  });

  it("renders exactly one h1 on BOTH views, and mounts no map", async () => {
    const { container } = await renderPanel();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector('[data-testid="map-container"]')).toBeNull();

    await calculateToResults();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("h1")[0].textContent).toContain("시설 비용 살펴보기");
    expect(container.querySelector('[data-testid="map-container"]')).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("uses no <aside> in the cost view, on either screen", async () => {
    // e2e/desktopNavigation.spec.ts asserts the map-free pages have none, and
    // terminology.audit.test.tsx identifies the equity sidebar by that landmark.
    const { container } = await renderPanel();
    expect(container.querySelector("aside")).toBeNull();
    await calculateToResults();
    expect(container.querySelector("aside")).toBeNull();
  });

  it("carries one compact standing disclaimer, never as an alert", async () => {
    await renderPanel();
    await calculateToResults();
    const notice = screen.getByTestId("facility-cost-results-notice");
    expect(notice.getAttribute("role")).toBeNull();
    const text = notice.textContent ?? "";
    expect(text).toContain("표준공사비");
    expect(text).toContain("실제 총사업비가 아니며");
    expect(text).toContain("승인되었다는 뜻도 아니고");
    expect(text).toContain("주민 개인에게 청구되는 금액이 아닙니다");
    // Exactly one banner above the numbers.
    expect(screen.queryAllByTestId("facility-cost-notice")).toHaveLength(0);
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
  async function withCandidate(): Promise<void> {
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
    await calculateToResults();
    openSection("facility-cost-candidate-section");
  }

  it("shows the candidate context + provenance and never claims cheapest/approved", async () => {
    await withCandidate();
    const text = screen.getByTestId("facility-cost-candidate").textContent ?? "";
    expect(text).toContain("강화군");
    expect(text).toContain("후보 셀별로 크게 달라지지 않습니다");
    expect(text).toContain("법적 결정이 아닙니다");
    expect(text).not.toContain("최저 비용");
    expect(text).not.toContain("승인된");
    // The screening outcome reads as plain Korean, not as the raw enum.
    expect(text).toContain("1차 분석 통과");
    // The analytical status carries its reference year + derivation/policy version,
    // now in the diagnostic disclosure rather than the primary line.
    const prov = screen.getByTestId("fc-candidate-provenance").textContent ?? "";
    expect(prov).toContain("2024");
    expect(prov).toContain("suitability-screening-v1");
    expect(prov).toContain("suitability-policy-v1");
    expect(prov).toContain("capital-grid-500m-v1:10_20");
    expect(prov).toContain("ELIGIBLE");
  });

  it("omits the candidate accordion entirely when no candidate was carried in", async () => {
    // The base fixture has candidate_context: null — an empty accordion would
    // imply there is something to open.
    await renderPanel();
    await calculateToResults();
    expect(screen.queryByTestId("facility-cost-candidate-section")).toBeNull();
    expect(screen.queryByTestId("facility-cost-candidate")).toBeNull();
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
    // The primary card shows the approximation; the exact served string is
    // unchanged in the exact-value section.
    expect(screen.getByTestId("fc-standard-cost").textContent).toBe("약 121억원");
    openSection("facility-cost-exact-values");
    expect(screen.getByTestId("fc-exact-standard-cost").textContent).toContain("120.75 억원");
  });
});
