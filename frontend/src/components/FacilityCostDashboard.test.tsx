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
 * Primary surfaces show APPROXIMATIONS ("약 121억원"). The exact-value assertions are
 * not weakened, they are re-pointed at the "정밀값과 계산 기준" section, which must
 * still carry the untouched backend decimal strings. The same applies to the raw
 * reason codes: they must be absent from the primary surface and still present in
 * the diagnostic disclosure.
 *
 * FIGMA ALIGNMENT (frame 129:5709). The setup ⇄ results view switch is gone: the
 * three steps and the five result figures share one screen, so `calculateToResults`
 * no longer navigates anywhere — it waits for the figures to appear inside card ③.
 * The report sections moved behind 계산 방법과 한계, so a test that reads one opens
 * that surface first (`openDetails`) and then its accordion (`openSection`). No
 * assertion about a VALUE, a unit, a reason code, or a non-claim was relaxed in the
 * move; only where the text is found changed.
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

/**
 * The selection map is a real part of the workflow now (three states, and a click
 * on a no-data region must be ANSWERED), so it is mounted here. jsdom has no WebGL,
 * so `maplibre-gl` is stubbed exactly as `FacilityCostRegionMap.test.tsx` does it —
 * the stub captures the layer's click handler, which is what `clickMapRegion`
 * fires.
 */
const mapHandlers = vi.hoisted(() => new Map<string, (event: unknown) => void>());

vi.mock("maplibre-gl", () => {
  class FakeMap {
    addControl() {}
    addSource() {}
    addLayer() {}
    on(event: string, second?: unknown, third?: unknown) {
      const cb = (typeof second === "function" ? second : third) as (e: unknown) => void;
      mapHandlers.set(typeof second === "string" ? `${event}:${second}` : event, cb);
      if (event === "load") cb(undefined);
    }
    once(event: string, cb: () => void) {
      if (event === "load") cb();
    }
    setFeatureState() {}
    getSource() {
      return { setData: () => {} };
    }
    getCanvas() {
      return { style: {} } as unknown as HTMLCanvasElement;
    }
    resize() {}
    remove() {}
  }
  return {
    default: { Map: FakeMap, NavigationControl: class {} },
    Map: FakeMap,
    NavigationControl: class {},
  };
});

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    fetchFacilityCostOptions: h.options,
    fetchFacilityCostCalculate: h.calc,
  };
});

import FacilityCostDashboard from "./FacilityCostDashboard";

// Calculable regions tagged with their waste stream, shaped like the served RCIS
// reporting coverage. HOUSEHOLD spans all three metropolitan areas and includes:
//   - the two 중구 that share a name and differ only by code (Seoul KR-SGIS-11140
//     vs Incheon KR-SGIS-23010 — the real SGIS sido digits, 11/23/31, that
//     lib/ranking.ts classifies);
//   - 경기도 수원시 under its RCIS CITY-level reporting code (KR-RCISRG-3101).
//     RCIS reports the seven Gyeonggi cities at city level and SGIS has no SIGUNGU
//     row for the city, so the CITY code — not a 일반구 code — is what the picker
//     offers and what the calculate payload carries. Its 일반구 children appear
//     nowhere, exactly as in production, because they have no waste row and the
//     reporting boundary endpoint excludes them.
// CONSTRUCTION has one region, which is what makes stream-change behaviour testable.
const WASTE_REGIONS = [
  { code: "KR-SGIS-11110", name: "종로구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-11140", name: "중구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-23010", name: "중구", stream: "HOUSEHOLD" },
  { code: "KR-RCISRG-3101", name: "경기도 수원시", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-11110", name: "종로구", stream: "CONSTRUCTION" },
];

/**
 * Reporting geometry, in the SAME code space as the waste statistics. It carries
 * one region MORE than HOUSEHOLD covers — 인천 강화군 — which is what makes the
 * third map state (자료 없음) and the coverage statement testable against real
 * derived state rather than a hardcoded flag.
 */
const BOUNDARY_CODES: [string, string][] = [
  ["KR-SGIS-11110", "종로구"],
  ["KR-SGIS-11140", "중구"],
  ["KR-SGIS-23010", "중구"],
  ["KR-RCISRG-3101", "경기도 수원시"],
  ["KR-SGIS-23310", "강화군"],
];

const BOUNDARIES = {
  type: "FeatureCollection",
  reference_year: 2024,
  count: BOUNDARY_CODES.length,
  features: BOUNDARY_CODES.map(([code, name]) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [] },
    properties: { region_code: code, region_name: name, region_level: "SIGUNGU" },
  })),
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mapHandlers.clear();
  h.options.mockResolvedValue(OPTIONS);
  h.calc.mockResolvedValue(calcFixture());
});
/** The <h1>, supplied by the page as the visible destination name (spec §2.2). */
const TITLE = "후보지 분석";

afterEach(cleanup);

async function renderPanel(candidate: CandidateDetail | null = null) {
  const utils = render(
    <FacilityCostDashboard
      title={TITLE}
      wasteRegions={WASTE_REGIONS}
      selectedCandidate={candidate}
      regionBoundaries={BOUNDARIES}
    />,
  );
  // The dashboard shell renders immediately; wait for the three-column workflow,
  // which only mounts once the (mocked) options have resolved.
  await waitFor(() => expect(screen.getByTestId("facility-cost-workflow")).toBeDefined());
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

/** Click one region on the selection map, through the captured layer handler. */
function clickMapRegion(code: string, name: string): void {
  const handler = mapHandlers.get("click:service-regions-fill");
  if (!handler) throw new Error("the selection map never registered its click handler");
  handler({ features: [{ properties: { region_code: code, region_name: name } }] });
}

function selectedChipLabels(): string[] {
  return screen
    .queryAllByTestId("facility-cost-region-chip")
    .map((chip) => chip.querySelector("span")?.textContent ?? "");
}

/** Select a region, submit, and wait for the five result figures to appear. */
async function calculateToResults(code = "KR-SGIS-11110"): Promise<void> {
  selectRegion(code);
  fireEvent.click(screen.getByTestId("facility-cost-calculate"));
  await waitFor(() => expect(screen.getByTestId("facility-cost-results")).toBeDefined());
}

/** Open 계산 방법과 한계 — the one surface the report sections now live behind. */
async function openDetails(): Promise<void> {
  fireEvent.click(screen.getByTestId("facility-cost-open-details"));
  await waitFor(() => expect(screen.getByTestId("facility-cost-details")).toBeDefined());
}

/** Expand one collapsed detail accordion by its testId. */
function openSection(testId: string): HTMLElement {
  const details = screen.getByTestId(testId) as HTMLDetailsElement;
  details.open = true;
  return details;
}

/**
 * The text a citizen can reach on the PRIMARY workflow WITHOUT opening 계산 방법과
 * 한계 or a diagnostic disclosure. Diagnostic subtrees are removed rather than
 * excluded by selector, so a code that moves into a new diagnostic block is still
 * covered.
 *
 * Note this is stricter than what is visually rendered: jsdom's `textContent`
 * includes the bodies of collapsed `<details>`, so an accordion cannot hide a leak
 * from this check.
 */
function primaryResultsText(): string {
  const view = screen.getByTestId("facility-cost-workflow").cloneNode(true) as HTMLElement;
  for (const node of Array.from(view.querySelectorAll("[data-diagnostic]"))) node.remove();
  return view.textContent ?? "";
}


const CANDIDATE = {
  candidate_id: 4242,
  candidate_key: "capital-grid-500m-v1:10_20",
  reference_year: 2024,
  derivation_version: "suitability-screening-v1",
  policy_version: "suitability-policy-v1",
  candidate_grid_version: "capital-grid-500m-v1",
} as unknown as CandidateDetail;

describe("citizen framing", () => {
  it("shows the neutral title and the decision-support disclaimer", async () => {
    await renderPanel();
    expect(screen.getByText(TITLE)).toBeDefined();
    // The disclaimer left the primary workflow (Figma note 221:3443) and is
    // preserved verbatim one click away.
    await openDetails();
    const disclaimer = screen.getByTestId("facility-cost-disclaimer").textContent ?? "";
    expect(disclaimer).toContain("권고하거나 반대를 설득하기 위한 페이지가 아닙니다");
    expect(disclaimer).toContain("시민 의사결정 지원 도구");
  });

  it("keeps ONE compact caveat readable without expanding anything", async () => {
    await renderPanel();
    // The screen's whole standing disclaimer is now the Figma footnote, present
    // before any calculation and with nothing opened.
    const footnote = screen.getByTestId("facility-cost-result-footnote").textContent ?? "";
    expect(footnote).toContain("표준공사비 기준 참고용 추정치");
    expect(footnote).toContain("실제 총사업비");
    expect(footnote).toContain("청구 금액은 아님");
    // …and it is said ONCE. A caveat repeated on every surface stops being read.
    expect(screen.getAllByTestId("facility-cost-result-footnote")).toHaveLength(1);
    // The long paragraph forms are not deleted — they are in 계산 방법과 한계, in
    // full, together with the eight-item list and its stated count.
    await openDetails();
    const scope = screen.getByTestId("facility-cost-notice").textContent ?? "";
    expect(scope).toContain("실제 총사업비가 아니며");
    expect(scope).toContain("세금 고지액도 아닙니다");
    const completeness = screen.getByTestId("facility-cost-completeness").textContent ?? "";
    expect(completeness).toContain("8가지");
  });

  it("shows no large disclaimer paragraph in the primary workflow", async () => {
    await renderPanel();
    // The two paragraphs the redesign removed from the screen: the regional
    // screening sentence and the long 표준공사비 non-claim. Both must be absent
    // from the workflow columns while nothing is expanded.
    const workflow = screen.getByTestId("facility-cost-workflow").textContent ?? "";
    expect(workflow).not.toContain("광역 후보지 스크리닝");
    expect(workflow).not.toContain("환경영향평가");
    expect(workflow).not.toContain("주민 개인에게 청구되는");
    expect(screen.queryByTestId("facility-cost-standing-non-claims")).toBeNull();
    expect(screen.queryByTestId("suitability-screening-disclaimer")).toBeNull();
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
      "facility-cost-share-presets",
      "facility-cost-operating-days",
      "facility-cost-underground",
      "facility-cost-subsidy-scheme",
      "facility-cost-step-result",
      "facility-cost-advanced-settings",
    ]) {
      expect(screen.getByTestId(testId)).toBeDefined();
    }
    // Default operating days come from the options — the redesign moved this
    // control, it did not re-seed it.
    expect((screen.getByTestId("facility-cost-operating-days") as HTMLInputElement).value).toBe(
      "300",
    );
  });

  it("presents the three numbered Figma steps, in order, as one screen", async () => {
    const { container } = await renderPanel();
    for (const heading of [
      "① 비용 계산 희망 지역 선택",
      "② 계산 조건",
      "③ 비용 계산 결과",
    ]) {
      expect(screen.getByRole("heading", { name: heading }), heading).toBeDefined();
    }
    // Step ① stays the programmatic focus target.
    expect(screen.getByRole("heading", { name: "① 비용 계산 희망 지역 선택" }).id).toBe(
      "fc-step-regions",
    );
    // The result lives WITH the setup, not on a screen the citizen has to leave
    // the controls to reach.
    const workflow = screen.getByTestId("facility-cost-workflow");
    for (const testId of [
      "facility-cost-step-regions",
      "facility-cost-step-conditions",
      "facility-cost-step-result",
    ]) {
      expect(workflow.contains(screen.getByTestId(testId))).toBe(true);
    }
    expect(container.querySelectorAll("h1")).toHaveLength(1);
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
    // 서울 → 인천 → 경기, then by name. The RCIS city code classifies as 경기
    // (lib/ranking.ts) and keeps its own served name, which already leads with
    // its metropolitan word, so it is not given a second "경기" prefix.
    expect(labels).toEqual(["서울 종로구", "서울 중구", "인천 중구", "경기도 수원시"]);
    // The two 중구 are distinguishable WITHOUT any raw region code being visible.
    const optionText = screen.getByTestId("facility-cost-region-options").textContent ?? "";
    expect(optionText).not.toContain("KR-SGIS");
    expect(optionText).not.toContain("KR-RCISRG");
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

  it("selects across metropolitan areas — one area never locks the others out", async () => {
    // The Figma note claims choosing 서울/인천/경기 blocks the rest. It does not:
    // a bulk button MERGES into the current selection, and individual picks from
    // different areas coexist. This is the regression guard for that claim.
    await renderPanel();
    fireEvent.click(screen.getByTestId("facility-cost-regions-seoul"));
    await waitFor(() => expect(selectedChipLabels()).toEqual(["서울 종로구", "서울 중구"]));
    fireEvent.click(screen.getByTestId("facility-cost-regions-incheon"));
    await waitFor(() =>
      expect(selectedChipLabels()).toEqual(["서울 종로구", "서울 중구", "인천 중구"]),
    );
    // A fourth, from a third metropolitan area, added individually.
    selectRegion("KR-RCISRG-3101");
    await waitFor(() =>
      expect(selectedChipLabels()).toEqual([
        "서울 종로구",
        "서울 중구",
        "인천 중구",
        "경기도 수원시",
      ]),
    );
    // All four reach the payload, in the same order — including the RCIS CITY
    // code, undecorated and unconverted.
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(h.calc).toHaveBeenCalled());
    expect(h.calc.mock.calls[0][0].regionCodes).toEqual([
      "KR-SGIS-11110",
      "KR-SGIS-11140",
      "KR-SGIS-23010",
      "KR-RCISRG-3101",
    ]);
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

  it("offers one facility-type option per API option and never invents one", async () => {
    await renderPanel();
    const select = screen.getByTestId("facility-cost-facility-type") as HTMLSelectElement;
    // Driven by the options fixture, not by a hardcoded list.
    expect(Array.from(select.options).map((o) => o.value)).toEqual(
      OPTIONS.facility_types.map((f) => f.value),
    );
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(
      OPTIONS.facility_types.map((f) => f.label),
    );
    expect(select.value).toBe(OPTIONS.facility_types[0].value);
    // Choosing another type updates the scenario and the ③ summary…
    fireEvent.change(select, { target: { value: "incineration_new" } });
    await waitFor(() =>
      expect(screen.getByTestId("facility-cost-step-result").textContent).toContain(
        OPTIONS.facility_types[1].label,
      ),
    );
    // …and reaches the request unchanged.
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(h.calc).toHaveBeenCalled());
    expect(h.calc.mock.calls[0][0].facilityType).toBe("incineration_new");
  });

  it("states an unavailable facility-type list instead of showing an empty dropdown", async () => {
    h.options.mockResolvedValue({ ...OPTIONS, facility_types: [] });
    await renderPanel();
    expect(screen.getByTestId("facility-cost-facility-type-empty")).toBeDefined();
    expect(screen.queryByTestId("facility-cost-facility-type")).toBeNull();
    expect((screen.getByTestId("facility-cost-calculate") as HTMLButtonElement).disabled).toBe(true);
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
    // The accordion label states the same thing, so a closed 고급 설정 never hides
    // the fact that an assumption has moved.
    expect(screen.getByTestId("facility-cost-advanced-settings-summary").textContent).toContain(
      "기본값에서 변경됨",
    );
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

describe("processing share — shortcuts without losing free entry", () => {
  it("offers the three Figma shortcuts plus a direct-entry path", async () => {
    await renderPanel();
    const group = screen.getByTestId("facility-cost-share-presets");
    expect(group.getAttribute("role")).toBe("group");
    expect(
      Array.from(group.querySelectorAll("button")).map((b) => b.textContent),
    ).toEqual(["50%", "80%", "100%", "직접 입력"]);
    // The default (100) is the pressed pill, so the control and the value agree.
    expect(screen.getByTestId("facility-cost-share-100").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("facility-cost-share-50").getAttribute("aria-pressed")).toBe("false");
  });

  it("writes the same value a typed share writes, and sends it unchanged", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-share-50"));
    await waitFor(() =>
      expect((screen.getByTestId("facility-cost-processing-share") as HTMLInputElement).value).toBe(
        "50",
      ),
    );
    expect(screen.getByTestId("facility-cost-summary-share").textContent).toBe("50%");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(h.calc).toHaveBeenCalled());
    expect(h.calc.mock.calls[0][0].processingSharePercent).toBe("50");
  });

  it("keeps free numeric entry, and lights the matching pill when it lands on one", async () => {
    await renderPanel();
    // A value no pill offers is accepted — the shortcuts did not replace the field.
    fireEvent.change(screen.getByTestId("facility-cost-processing-share"), {
      target: { value: "63" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("facility-cost-summary-share").textContent).toBe("63%"),
    );
    // No preset claims a value it does not hold; 직접 입력 is what is pressed.
    for (const preset of ["50", "80", "100"]) {
      expect(
        screen.getByTestId(`facility-cost-share-${preset}`).getAttribute("aria-pressed"),
      ).toBe("false");
    }
    expect(screen.getByTestId("facility-cost-share-direct").getAttribute("aria-pressed")).toBe(
      "true",
    );
    // Typing a preset value lights that pill, so the two can never disagree.
    fireEvent.change(screen.getByTestId("facility-cost-processing-share"), {
      target: { value: "80" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("facility-cost-share-80").getAttribute("aria-pressed")).toBe("true"),
    );
  });

  it("validates numeric inputs, disabling calculate with an announced message", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    const button = screen.getByTestId("facility-cost-calculate") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    // Out-of-range processing share → disabled + accessible message. The bound is
    // unchanged by the pills: 150 is still rejected.
    fireEvent.change(screen.getByTestId("facility-cost-processing-share"), {
      target: { value: "150" },
    });
    await waitFor(() => expect(button.disabled).toBe(true));
    expect(screen.getByTestId("facility-cost-validation").textContent).toContain("0–100");
    expect(screen.getByTestId("facility-cost-validation").getAttribute("role")).toBe("alert");
    // The blocked reason is repeated beside the button, so a closed accordion is
    // never the only home for the active error.
    expect(screen.getByTestId("facility-cost-calculate-status").textContent).toContain("0–100");
    // …and no request was issued for the invalid value.
    expect(h.calc).not.toHaveBeenCalled();
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
});

describe("region selection survives the calculation conditions", () => {
  // THE BUG THIS GUARDS. `update()` used to special-case `wasteStream` and set
  // `regionCodes: []`, so a citizen who had picked a dozen regions and then
  // touched the 폐기물 종류 select lost all of them — including every region the
  // new stream could calculate perfectly well.

  const setWasteStream = (value: string) =>
    fireEvent.change(screen.getByTestId("facility-cost-waste-stream"), { target: { value } });

  it("keeps regions the new waste stream can still calculate, and drops only the rest", async () => {
    await renderPanel();
    // 종로구 has both HOUSEHOLD and CONSTRUCTION; 서울 중구 has HOUSEHOLD only.
    selectRegion("KR-SGIS-11110");
    selectRegion("KR-SGIS-11140");
    await waitFor(() => expect(selectedChipLabels()).toEqual(["서울 종로구", "서울 중구"]));

    setWasteStream("CONSTRUCTION");

    // The survivor is KEPT — not cleared and not re-added by the citizen.
    await waitFor(() => expect(selectedChipLabels()).toEqual(["서울 종로구"]));
    // …and the one the new stream genuinely cannot calculate is named, compactly,
    // as a polite status rather than a banner.
    const dropped = screen.getByTestId("facility-cost-dropped-regions");
    expect(dropped.getAttribute("role")).toBe("status");
    expect(dropped.textContent).toContain("서울 중구");
    expect(dropped.textContent).not.toContain("서울 종로구");
    // The payload follows the surviving selection exactly.
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(h.calc).toHaveBeenCalled());
    expect(h.calc.mock.calls[0][0].regionCodes).toEqual(["KR-SGIS-11110"]);
    expect(h.calc.mock.calls[0][0].wasteStream).toBe("CONSTRUCTION");
  });

  it("says nothing when a stream change costs the citizen nothing", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11110"); // calculable under both streams
    await waitFor(() => expect(selectedChipLabels()).toEqual(["서울 종로구"]));

    setWasteStream("CONSTRUCTION");

    await waitFor(() => expect(selectedChipLabels()).toEqual(["서울 종로구"]));
    // No note, because nothing was dropped — the message is information, not decor.
    expect(screen.queryByTestId("facility-cost-dropped-regions")).toBeNull();
  });

  it("restores a region when the stream that lost it is chosen again", async () => {
    // The selection is one authoritative list, so a round trip is not lossy for
    // the regions that survive; the one genuinely dropped stays dropped rather
    // than being resurrected from a shadow copy.
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    selectRegion("KR-SGIS-11140");
    await waitFor(() => expect(selectedChipLabels()).toHaveLength(2));

    setWasteStream("CONSTRUCTION");
    await waitFor(() => expect(selectedChipLabels()).toEqual(["서울 종로구"]));
    setWasteStream("HOUSEHOLD");

    await waitFor(() => expect(selectedChipLabels()).toEqual(["서울 종로구"]));
    expect(screen.queryByTestId("facility-cost-dropped-regions")).toBeNull();
  });

  it.each([
    ["facility type", () => fireEvent.change(screen.getByTestId("facility-cost-facility-type"), {
      target: { value: "incineration_new" },
    })],
    ["processing share", () => fireEvent.change(screen.getByTestId("facility-cost-processing-share"), {
      target: { value: "50" },
    })],
    ["a share preset", () => fireEvent.click(screen.getByTestId("facility-cost-share-50"))],
    ["operating days", () => fireEvent.change(screen.getByTestId("facility-cost-operating-days"), {
      target: { value: "330" },
    })],
    ["the underground multiplier", () => fireEvent.change(screen.getByTestId("facility-cost-underground"), {
      target: { value: "1.20" },
    })],
    ["the subsidy scheme", () => fireEvent.change(screen.getByTestId("facility-cost-subsidy-scheme"), {
      target: { value: "metropolitan_city" },
    })],
  ])("never clears the selection when %s changes", async (_label, change) => {
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    selectRegion("KR-SGIS-11140");
    selectRegion("KR-RCISRG-3101");
    const before = selectedChipLabels();
    expect(before).toHaveLength(3);

    // The advanced controls live inside a collapsed <details>; expand it so the
    // interaction is the one a citizen actually performs.
    openSection("facility-cost-advanced-settings");
    change();

    await waitFor(() => expect(selectedChipLabels()).toEqual(before));
    expect(screen.queryByTestId("facility-cost-dropped-regions")).toBeNull();
  });

  it("clears the dropped-region note once the citizen touches the selection again", async () => {
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    selectRegion("KR-SGIS-11140");
    await waitFor(() => expect(selectedChipLabels()).toHaveLength(2));
    setWasteStream("CONSTRUCTION");
    await waitFor(() => expect(screen.getByTestId("facility-cost-dropped-regions")).toBeDefined());

    clickMapRegion("KR-SGIS-11110", "종로구");

    await waitFor(() => expect(screen.queryByTestId("facility-cost-dropped-regions")).toBeNull());
  });
});

describe("the seven RCIS city-level regions are selectable", () => {
  // 고양·부천·성남·수원·안산·안양·용인 are reported by RCIS at CITY level. They were
  // drawn on the selection map and rejected by the picker, because the picker read
  // /waste-statistics (native SGIS only) while the map read the reporting
  // geography. They now come from the same served collection.

  it("offers the city under its RCIS reporting code and sends that code unchanged", async () => {
    await renderPanel();
    selectRegion("KR-RCISRG-3101");
    await waitFor(() => expect(selectedChipLabels()).toEqual(["경기도 수원시"]));
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(h.calc).toHaveBeenCalled());
    // Not translated to a 일반구 code, and not decorated.
    expect(h.calc.mock.calls[0][0].regionCodes).toEqual(["KR-RCISRG-3101"]);
  });

  it("treats the city as selectable on the map, not as a no-data region", async () => {
    await renderPanel();
    // The map registers its click handler once the (faked) map has loaded, which
    // is a tick after the workflow mounts.
    await waitFor(() => expect(mapHandlers.get("click:service-regions-fill")).toBeDefined());
    clickMapRegion("KR-RCISRG-3101", "경기도 수원시");
    await waitFor(() => expect(selectedChipLabels()).toEqual(["경기도 수원시"]));
    // The click was honoured, so no "자료가 없어 선택할 수 없습니다" answer was given.
    expect(screen.getByTestId("facility-cost-map-unavailable").textContent).toBe("");
    // …and it is not listed among the regions that cannot be calculated.
    const unavailable = screen.getByTestId("facility-cost-unavailable-regions").textContent ?? "";
    expect(unavailable).not.toContain("수원시");
  });
});

describe("coverage honesty", () => {
  it("states how many regions the chosen stream can and cannot be calculated for", async () => {
    await renderPanel();
    const coverage = () => screen.getByTestId("facility-cost-coverage").textContent ?? "";
    // Four calculable for HOUSEHOLD; the fifth boundary region has no HOUSEHOLD row.
    // The counts are now stated compactly — the sentence form crowded the card and
    // its reason is said once, in 계산 방법과 한계, instead of on every screen.
    expect(coverage()).toContain("계산 가능 4곳");
    expect(coverage()).toContain("자료 없음 1곳");
    // The excluded region is still NAMED.
    const list = screen.getByTestId("facility-cost-unavailable-regions").textContent ?? "";
    expect(list).toContain("인천 강화군");
    // Narrowing the stream widens the excluded set — the statement follows the data.
    fireEvent.change(screen.getByTestId("facility-cost-waste-stream"), {
      target: { value: "CONSTRUCTION" },
    });
    await waitFor(() => expect(coverage()).toContain("계산 가능 1곳"));
    expect(coverage()).toContain("자료 없음 4곳");
  });

  it("still says an absent region is not a zero, in the detail surface", async () => {
    // The statement was not deleted when the card's prose was compressed — it
    // keeps one home, where the coverage is explained in full.
    await renderPanel();
    await openDetails();
    openSection("facility-cost-coverage-section");
    const text = screen.getByTestId("facility-cost-coverage-section").textContent ?? "";
    expect(text).toContain("0이라는 뜻이 아닙니다");
  });

  it("names the general-gu limitation without inventing lower-level data", async () => {
    await renderPanel();
    await openDetails();
    openSection("facility-cost-coverage-section");
    const text = screen.getByTestId("facility-cost-coverage-section").textContent ?? "";
    expect(text).toContain("일반구");
    expect(text).toContain("만들어 내지 않습니다");
  });

  it("shows an empty state, not an empty picker, when nothing is calculable", async () => {
    render(
      <FacilityCostDashboard title={TITLE} wasteRegions={[]} selectedCandidate={null} />,
    );
    await waitFor(() => expect(screen.getByTestId("facility-cost-workflow")).toBeDefined());
    expect(screen.getByTestId("facility-cost-regions-empty")).toBeDefined();
    expect(screen.queryByTestId("facility-cost-region-search")).toBeNull();
  });
});

describe("selection map — three states and no silent click", () => {
  it("draws a legend naming all three states, including no data", async () => {
    await renderPanel();
    const legend = screen.getByTestId("facility-cost-map-legend").textContent ?? "";
    expect(legend).toContain("선택한 지역");
    expect(legend).toContain("선택 안 함");
    // The third state names the STREAM it is missing, and says it is not a zero.
    expect(legend).toContain("생활계 폐기물 자료 없음");
    expect(legend).toContain("0이 아님");
    // It follows the stream.
    fireEvent.change(screen.getByTestId("facility-cost-waste-stream"), {
      target: { value: "CONSTRUCTION" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("facility-cost-map-legend").textContent).toContain(
        "건설 폐기물 자료 없음",
      ),
    );
  });

  it("answers a click on a no-data region instead of doing nothing", async () => {
    await renderPanel();
    const feedback = screen.getByTestId("facility-cost-map-unavailable");
    // The live region exists before it has anything to say, and is polite.
    expect(feedback.getAttribute("role")).toBe("status");
    expect(feedback.textContent).toBe("");

    clickMapRegion("KR-SGIS-23310", "강화군");
    await waitFor(() =>
      expect(screen.getByTestId("facility-cost-map-unavailable").textContent).toContain("강화군"),
    );
    const text = screen.getByTestId("facility-cost-map-unavailable").textContent ?? "";
    expect(text).toContain("선택할 수 없습니다");
    expect(text).toContain("0이라는 뜻이 아닙니다");
    // It never becomes a selection.
    expect(selectedChipLabels()).toEqual([]);
    expect((screen.getByTestId("facility-cost-calculate") as HTMLButtonElement).disabled).toBe(true);
  });

  it("toggles a calculable region from the map into the same shared selection", async () => {
    await renderPanel();
    clickMapRegion("KR-SGIS-11110", "종로구");
    await waitFor(() => expect(selectedChipLabels()).toEqual(["서울 종로구"]));
    // Clicking again removes it — the map and the picker write one state.
    clickMapRegion("KR-SGIS-11110", "종로구");
    await waitFor(() => expect(selectedChipLabels()).toEqual([]));
  });

  it("clears a standing no-data message once the citizen acts again", async () => {
    await renderPanel();
    clickMapRegion("KR-SGIS-23310", "강화군");
    await waitFor(() =>
      expect(screen.getByTestId("facility-cost-map-unavailable").textContent).not.toBe(""),
    );
    // A message naming a region under the OLD stream must not survive a change of
    // stream, when that region's availability may be different.
    fireEvent.change(screen.getByTestId("facility-cost-waste-stream"), {
      target: { value: "CONSTRUCTION" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("facility-cost-map-unavailable").textContent).toBe(""),
    );
  });
});

describe("calculation lifecycle on one screen", () => {
  it("shows the result beside the controls that produced it, with no view switch", async () => {
    await renderPanel();
    // Before calculating: the explicit "nothing yet" state, never a zero.
    expect(screen.queryByTestId("facility-cost-results")).toBeNull();
    const empty = screen.getByTestId("facility-cost-no-result").textContent ?? "";
    expect(empty).toContain("아직 계산한 결과가 없습니다");
    // It shows no number at all, which is the guarantee that mattered; the
    // "not a zero" restatement moved to 계산 방법과 한계 rather than repeating here.
    expect(empty).not.toMatch(/\d/);

    await calculateToResults();

    // The controls are still there — changing an input needs no navigation.
    expect(screen.getByTestId("facility-cost-step-regions")).toBeDefined();
    expect(screen.getByTestId("facility-cost-calculate")).toBeDefined();
    expect(screen.getByTestId("facility-cost-processing-share")).toBeDefined();
    expect(screen.queryByTestId("facility-cost-no-result")).toBeNull();
    // And the old two-view affordances are gone rather than left dangling.
    expect(screen.queryByTestId("facility-cost-edit-settings")).toBeNull();
    expect(screen.queryByTestId("facility-cost-results-view")).toBeNull();
  });

  it("keeps the announcement region on the result figures only", async () => {
    await renderPanel();
    await calculateToResults();
    // The live region holds the answer, NOT the collapsed disclosures — a
    // collapsed <details> must never be the only home for a role="status".
    const results = screen.getByTestId("facility-cost-results");
    expect(results.getAttribute("role")).toBe("status");
    expect(within(results).getByTestId("facility-cost-hero")).toBeDefined();
    expect(within(results).queryByTestId("facility-cost-exclusions")).toBeNull();
  });

  it("preserves every input across a calculation and recalculates the changed one", async () => {
    await renderPanel();
    fireEvent.change(screen.getByTestId("facility-cost-processing-share"), {
      target: { value: "60" },
    });
    fireEvent.change(screen.getByTestId("facility-cost-operating-days"), {
      target: { value: "320" },
    });
    selectRegion("KR-SGIS-11140");
    selectRegion("KR-SGIS-23010");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-results")).toBeDefined());

    // Every selection survived, in place.
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

    // Changing an input hides the now-stale answer…
    fireEvent.change(screen.getByTestId("facility-cost-processing-share"), {
      target: { value: "50" },
    });
    await waitFor(() => expect(screen.getByTestId("facility-cost-stale")).toBeDefined());
    expect(screen.queryByTestId("facility-cost-results")).toBeNull();
    // …and recalculating sends the CHANGED value.
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-results")).toBeDefined());
    const last = h.calc.mock.calls[h.calc.mock.calls.length - 1][0];
    expect(last.processingSharePercent).toBe("50");
  });

  it("keeps the settings and allows retry when the calculation fails", async () => {
    h.calc.mockRejectedValueOnce(new Error("boom"));
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-error")).toBeDefined());

    // No figures were rendered, and the form kept its selection.
    expect(screen.queryByTestId("facility-cost-results")).toBeNull();
    expect(selectedChipLabels()).toEqual(["서울 종로구"]);
    // The error is a genuine, actionable one.
    expect(screen.getByTestId("facility-cost-error").getAttribute("role")).toBe("alert");
    // The "nothing yet" instruction does not also claim the slot.
    expect(screen.queryByTestId("facility-cost-no-result")).toBeNull();

    // Retry succeeds.
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-results")).toBeDefined());
  });

  it("announces progress and shows a skeleton while calculating", async () => {
    let resolve: (v: FacilityCostCalculate) => void = () => undefined;
    h.calc.mockImplementationOnce(
      () => new Promise<FacilityCostCalculate>((res) => (resolve = res)),
    );
    await renderPanel();
    selectRegion("KR-SGIS-11110");
    fireEvent.click(screen.getByTestId("facility-cost-calculate"));

    await waitFor(() => expect(screen.getByTestId("facility-cost-calculating")).toBeDefined());
    expect(screen.queryByTestId("facility-cost-no-result")).toBeNull();
    expect(screen.getByTestId("facility-cost-calculating-status").getAttribute("role")).toBe(
      "status",
    );
    // Duplicate submission is prevented while in flight.
    expect((screen.getByTestId("facility-cost-calculate") as HTMLButtonElement).disabled).toBe(true);

    resolve(calcFixture());
    await waitFor(() => expect(screen.getByTestId("facility-cost-results")).toBeDefined());
  });

  it("never renders a late response from superseded inputs", async () => {
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
    // The pending request resolves, but its inputs are now stale → its figures
    // must not render; the citizen is told to recalculate instead.
    resolveFirst(calcFixture());
    await waitFor(() => expect(screen.getByTestId("facility-cost-stale")).toBeDefined());
    expect(screen.queryByTestId("facility-cost-results")).toBeNull();
    expect(screen.queryByTestId("fc-standard-cost")).toBeNull();
  });
});

describe("results — the five Figma figures", () => {
  it("leads with the installation cost and supports it with exactly four figures", async () => {
    await renderPanel();
    await calculateToResults();
    // The hero: 120.750000 억원 → 약 121억원.
    const hero = screen.getByTestId("facility-cost-hero");
    expect(hero.textContent).toContain("표준공사비 기반 설치비 산정액");
    expect(screen.getByTestId("fc-standard-cost").textContent).toBe("약 121억원");
    expect(screen.getAllByTestId("facility-cost-hero")).toHaveLength(1);
    // Four supporting tiles, all served values.
    expect(screen.getByTestId("fc-service-population").textContent).toBe("200,000명");
    expect(screen.getByTestId("fc-annual-quantity").textContent).toBe("10,500 톤/년");
    // 35.000000 톤/일 is exact at this precision, so it carries no "약".
    expect(screen.getByTestId("fc-capacity").textContent).toBe("35톤/일");
    // 42,262.50원 → 4.226250만원 → 약 4만원.
    expect(screen.getByTestId("fc-per-capita").textContent).toBe("약 4만원");
    // One hero + four tiles, and nothing else claiming to be a figure.
    const figures = screen.getByTestId("facility-cost-result-figures");
    expect(figures.querySelectorAll("dt")).toHaveLength(5);
  });

  it("keeps the per-capita's not-a-bill caveat and never relabels it as a charge", async () => {
    await renderPanel();
    await calculateToResults();
    const caveat = screen.getByTestId("facility-cost-per-capita-caveat").textContent ?? "";
    // The SERVED caveat, alone: it already carries both the derivation and the
    // not-a-bill claim, so the static duplicate that used to precede it in bold
    // is gone. `PER_CAPITA_NON_CLAIM` itself is unchanged and still listed in
    // 계산 방법과 한계 (asserted below).
    expect(caveat).toContain("개인의 실제 세금 청구액이 아닙니다");
    expect(caveat).toContain("동일 연도의 공식 인구로 나눈 환산값");
    expect(caveat).not.toContain("개인에게 실제로 청구되는 세금이나 부담금이 아닙니다");
    await openDetails();
    expect(screen.getByTestId("facility-cost-completeness").textContent).toContain(
      "주민 개인의 실제 세금 청구액이 아님",
    );
    // The label itself stays the served term.
    const figures = screen.getByTestId("facility-cost-result-figures");
    expect(within(figures).getByText("주민 1인당 환산 지방비")).toBeDefined();
    const text = figures.textContent ?? "";
    for (const banned of ["주민 부담 청구액", "개인 부담금", "확정 주민 부담"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("names the population and waste basis in 출처와 계산 방법", async () => {
    // The two provenance lines moved off the result tiles (they crowded the card
    // and are not caveats) into the detail surface, which states them in FULL —
    // source id, definition, dataset, accounting basis, and reference period.
    await renderPanel();
    await calculateToResults();
    await openDetails();
    openSection("facility-cost-methodology-section");
    const text = screen.getByTestId("facility-cost-methodology-section").textContent ?? "";
    // Page 3's own denominator — the cost model's SGIS population, not Page 2's.
    expect(text).toContain("sgis");
    expect(text).toContain("SGIS_TOTAL_POPULATION");
    expect(text).toContain("RCIS 생활계");
    expect(text).toContain("2022");
  });

  it("carries the compact non-claim footnote beside the numbers", async () => {
    await renderPanel();
    await calculateToResults();
    const footnote = screen.getByTestId("facility-cost-result-footnote").textContent ?? "";
    expect(footnote).toContain("표준공사비 기준 참고용 추정치");
    expect(footnote).toContain("실제 총사업비");
  });

  it("keeps the honest concept names and never an affirmative total-cost label", async () => {
    await renderPanel();
    await calculateToResults();
    const results = screen.getByTestId("facility-cost-results").textContent ?? "";
    expect(results).toContain("표준공사비 기반 설치비 산정액");
    expect(document.body.textContent).not.toContain("총비용");
    for (const banned of ["총사업비 산정", "확정 사업비", "최종 사업비", "확정 보조금"]) {
      expect(document.body.textContent).not.toContain(banned);
    }
  });

  it("preserves the annualized cost, with its lifetime basis, in 계산 방법과 한계", async () => {
    // It is no longer one of the five figures; it was moved, not dropped, and it
    // is still never added to the composition as if it were an extra cost.
    await renderPanel();
    await calculateToResults();
    await openDetails();
    openSection("facility-cost-breakdown-section");
    const text = screen.getByTestId("facility-cost-annualized").textContent ?? "";
    expect(text).toContain("연간 환산 설치비");
    expect(text).toContain("8.05 억원/년");
    expect(text).toContain("내용연수 15년 가정");
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
    // The tile keeps its position and states why, in Korean.
    const cell = screen.getByTestId("fc-per-capita-unavailable").textContent ?? "";
    expect(cell).toContain("계산 불가");
    expect(cell).toContain("집계 정의가 달라");
    expect(cell).not.toContain("0원");
    // The raw code is NOT on the primary surface…
    expect(primaryResultsText()).not.toContain("INCOMPATIBLE_POPULATION_DEFINITION");
    // …but it is still reachable diagnostically, never discarded.
    await openDetails();
    openSection("facility-cost-exact-values");
    expect(screen.getByTestId("facility-cost-diagnostics").textContent).toContain(
      "INCOMPATIBLE_POPULATION_DEFINITION",
    );
    // And the exact-value section does not invent a number for it either.
    const exact = screen.getByTestId("fc-exact-per-capita-unavailable").textContent ?? "";
    expect(exact).toContain("계산 불가");
    expect(exact).not.toContain("0원");
  });

  it("shows an unavailable service population as text, never 0명", async () => {
    h.calc.mockResolvedValue(
      calcFixture({
        official_input: {
          ...calcFixture().official_input,
          official_service_population: null,
        },
      }),
    );
    await renderPanel();
    await calculateToResults();
    const cell = screen.getByTestId("fc-service-population").textContent ?? "";
    expect(cell).toContain("공식 인구 미확정");
    expect(cell).not.toContain("0명");
  });
});

describe("results — exact values are preserved unchanged", () => {
  it("carries every exact backend decimal string in 정밀값과 계산 기준", async () => {
    await renderPanel();
    await calculateToResults();
    await openDetails();
    openSection("facility-cost-exact-values");
    // The same literal strings the KPI grid used to assert; they live in the
    // exact-value section, they were not weakened.
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
    await openDetails();
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
    await openDetails();
    openSection("facility-cost-exact-values");
    expect(screen.getByTestId("facility-cost-exact-values").textContent).toContain(
      "반올림한 표시용 근삿값",
    );
  });
});

describe("계산 방법과 한계 — the progressive-disclosure surface", () => {
  it("is one click from the workflow and holds the sections the screen no longer shows", async () => {
    await renderPanel();
    await calculateToResults();
    // Nothing is open on the screen itself.
    expect(screen.queryByTestId("facility-cost-details")).toBeNull();
    await openDetails();
    const dialog = screen.getByTestId("facility-cost-details");
    expect(dialog.getAttribute("role")).toBe("dialog");
    for (const testId of [
      "facility-cost-scope-section",
      "facility-cost-coverage-section",
      "facility-cost-breakdown-section",
      "facility-cost-exclusions",
      "facility-cost-region-section",
      "facility-cost-assumptions",
      "facility-cost-methodology-section",
      "facility-cost-exact-values",
    ]) {
      expect(screen.getByTestId(testId), testId).toBeDefined();
    }
  });

  it("opens before any calculation, with the scope and coverage it does not need one for", async () => {
    await renderPanel();
    await openDetails();
    expect(screen.getByTestId("facility-cost-completeness")).toBeDefined();
    expect(screen.getByTestId("facility-cost-coverage-section")).toBeDefined();
    // The result-dependent sections are omitted rather than shown empty.
    expect(screen.queryByTestId("facility-cost-exclusions")).toBeNull();
    expect(screen.getByTestId("facility-cost-details-no-result").textContent).toContain(
      "비용을 계산하면",
    );
  });

  it("collapses every result section by default", async () => {
    await renderPanel();
    await calculateToResults();
    await openDetails();
    for (const testId of [
      "facility-cost-breakdown-section",
      "facility-cost-region-section",
      "facility-cost-assumptions",
      "facility-cost-exclusions",
      "facility-cost-methodology-section",
      "facility-cost-exact-values",
    ]) {
      expect((screen.getByTestId(testId) as HTMLDetailsElement).open, testId).toBe(false);
    }
  });

  it("groups the eight non-claims by kind without dropping or softening one", async () => {
    await renderPanel();
    await openDetails();
    const completeness = screen.getByTestId("facility-cost-completeness");
    const text = completeness.textContent ?? "";
    // The two headings the flat list was split into…
    expect(text).toContain("이 계산에 포함되지 않은 비용");
    expect(text).toContain("이 값이 아닌 것");
    // …and every one of the eight original strings, verbatim.
    for (const notice of [
      "운영비 미포함",
      "실제 운송비 미포함",
      "토지·보상비 미포함",
      "잔여 매립비용 미포함",
      "후보지별 토목조건 미포함",
      "실제 총사업비가 아님",
      "실제 승인된 국고보조금이 아님",
      "주민 개인의 실제 세금 청구액이 아님",
    ]) {
      expect(text, `non-claim missing: ${notice}`).toContain(notice);
    }
    expect(within(completeness).getAllByRole("listitem")).toHaveLength(8);
    // The count in the heading still matches what the list holds.
    expect(text).toContain("8가지");
  });

  it("keeps the regional-screening disclaimer, in this surface rather than on the screen", async () => {
    // The 비용 살펴보기 exception to docs/SUITABILITY_PHASE_0_TRANSPARENCY.md: this
    // sub-view shows no standing screening paragraph, because it presents a COST
    // estimate rather than a candidate-suitability claim, and the redesign
    // required the primary workflow to be free of disclaimer blocks. The sentence
    // itself is unchanged and one click away, in 이 계산의 범위. The other two
    // suitability sub-views (후보지 점수 / 가중치 바꿔보기) still show it inline.
    await renderPanel();
    expect(screen.queryByTestId("suitability-screening-disclaimer")).toBeNull();
    await openDetails();
    const scope = screen.getByTestId("facility-cost-notice").textContent ?? "";
    expect(scope).toContain("광역 후보지 스크리닝");
    expect(scope).toContain("환경영향평가");
  });

  it("lists the analytical assumptions in force, beside the controls that set them", async () => {
    await renderPanel();
    const current = screen.getByTestId("facility-cost-current-assumptions");
    const text = current.textContent ?? "";
    expect(text).toContain("300일");
    expect(text).toContain("1.00");
    expect(text).toContain("시·군 (30%)");
    expect(text).toContain("capex-standard-v2022dec");
    // Provenance travels with the subsidy rate wherever it is shown.
    expect(current.parentElement?.textContent).toContain("국고보조금 업무처리지침");
    fireEvent.change(screen.getByTestId("facility-cost-operating-days"), {
      target: { value: "320" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("facility-cost-current-assumptions").textContent).toContain("320일"),
    );
  });

  it("shows the cost composition, exact and without implying approval", async () => {
    await renderPanel();
    await calculateToResults();
    await openDetails();
    openSection("facility-cost-breakdown-section");
    const funding = screen.getByTestId("facility-cost-funding");
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
    await openDetails();
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
    await openDetails();
    openSection("facility-cost-region-section");
    const cell = screen.getByTestId("fc-region-population-unavailable").textContent ?? "";
    expect(cell).toContain("공식 인구 미확정");
    const table = screen.getByTestId("facility-cost-region-table").textContent ?? "";
    expect(table).not.toContain("0명");
  });

  it("carries the calculation assumptions with Korean-first labels", async () => {
    await renderPanel();
    await calculateToResults();
    await openDetails();
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
    await openDetails();
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
    await openDetails();
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

  it("carries one compact standing disclaimer, never as an alert", async () => {
    await renderPanel();
    await calculateToResults();
    await openDetails();
    const notice = screen.getByTestId("facility-cost-results-notice");
    expect(notice.getAttribute("role")).toBeNull();
    const text = notice.textContent ?? "";
    expect(text).toContain("표준공사비");
    expect(text).toContain("실제 총사업비가 아니며");
    expect(text).toContain("승인되었다는 뜻도 아니고");
    expect(text).toContain("주민 개인에게 청구되는 금액이 아닙니다");
  });
});

describe("results — excluded cost components", () => {
  it("moves the missing components into the exclusions accordion, counted in its summary", async () => {
    await renderPanel();
    await calculateToResults();
    await openDetails();
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
    // The count + the "this is not zero" sentence live OUTSIDE the collapsed
    // disclosure, so the mandatory caveat is never hidden behind a second click.
    const outside = screen.getByTestId("facility-cost-exclusions").parentElement?.textContent ?? "";
    expect(outside).toContain("포함되지 않은 항목은 5개");
    expect(outside).toContain("비용이 0이라는 뜻이 아닙니다");
  });

  it("states each exclusion in plain Korean, not as a backend code", async () => {
    await renderPanel();
    await calculateToResults();
    await openDetails();
    openSection("facility-cost-exclusions");
    const text = screen.getByTestId("facility-cost-missing").textContent ?? "";
    expect(text).toContain("공식 자료가 아직 이 분석에 연결되지 않았습니다");
    expect(text).toContain("실제 수집·운반 경로와 계약 단가 자료가 없어");
  });

  it("retains the raw served codes in the diagnostic disclosure", async () => {
    await renderPanel();
    await calculateToResults();
    await openDetails();
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
    await openDetails();
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

  it("states a partial result in plain Korean, as standing content", async () => {
    await renderPanel();
    await calculateToResults();
    const partial = screen.getByTestId("facility-cost-partial");
    const text = partial.textContent ?? "";
    expect(text).toContain("일부 비용 항목은 자료가 없어 빠졌습니다");
    expect(text).toContain("0이 아님");
    // It points at the surface that holds the itemised list.
    expect(text).toContain("계산 방법과 한계");
    // A standing caveat must not interrupt a screen reader on every render.
    expect(partial.getAttribute("role")).toBeNull();
  });

  it("does not claim partial when the response does not", async () => {
    h.calc.mockResolvedValue(
      calcFixture({
        completeness: {
          is_partial: false,
          included_components: ["STANDARD_CONSTRUCTION_COST"],
          missing_components: [],
        },
      }),
    );
    await renderPanel();
    await calculateToResults();
    expect(screen.queryByTestId("facility-cost-partial")).toBeNull();
    // …and it does not claim the result is COMPLETE either: the standing
    // exclusions are still listed, because they are exclusions by rule.
    await openDetails();
    expect(screen.getByTestId("facility-cost-exclusions-summary").textContent).toContain(
      "포함되지 않은 비용 5개",
    );
  });

  it("marks an excluded term as excluded and a missing value as missing, never as a warning", async () => {
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
    await openDetails();

    openSection("facility-cost-exclusions");
    const missing = screen.getByTestId("facility-cost-missing");
    const rows = within(missing).getAllByTestId("facility-cost-missing-row");
    // Every excluded term carries the excluded STATUS with its text label — an
    // analytical exclusion is not a caution about a value that exists.
    expect(missing.querySelectorAll('[data-status="excluded"]')).toHaveLength(rows.length);
    expect(missing.textContent).toContain("미포함");

    openSection("facility-cost-region-section");
    const population = screen.getByTestId("fc-region-population-unavailable");
    expect(population.getAttribute("data-status")).toBe("missing");
    expect(population.textContent).toBe("공식 인구 미확정");
    // Still never a fabricated zero, anywhere in the table.
    expect(screen.getByTestId("facility-cost-region-table").textContent).not.toContain("0명");
  });
});

describe("results — no raw codes on the primary surface", () => {
  it("keeps every forbidden technical token out of the primary workflow", async () => {
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
    await openDetails();
    openSection("facility-cost-exclusions");
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
    const missing = screen.getByTestId("facility-cost-missing").textContent ?? "";
    expect(missing).toContain("필지별 비용 자료가 없어");
    expect(missing).toContain("남는 물질의 양이 확정되지 않아");
  });
});

describe("page structure", () => {
  it("renders exactly one h1 and mounts no choropleth map container", async () => {
    const { container } = await renderPanel();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector('[data-testid="map-container"]')).toBeNull();

    await calculateToResults();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("h1")[0].textContent).toContain(TITLE);
    expect(container.querySelector('[data-testid="map-container"]')).toBeNull();
  });

  it("uses no <aside> in the cost view", async () => {
    // e2e/desktopNavigation.spec.ts asserts the map-free pages have none, and
    // terminology.audit.test.tsx identifies the equity sidebar by that landmark.
    const { container } = await renderPanel();
    expect(container.querySelector("aside")).toBeNull();
    await calculateToResults();
    expect(container.querySelector("aside")).toBeNull();
  });

  it("adds no action the workflow does not already have", async () => {
    await renderPanel();
    await calculateToResults();
    // The result card has exactly two buttons: calculate, and the one door to
    // 계산 방법과 한계. No export, report, or share action was invented.
    const buttons = screen.getByTestId("facility-cost-step-result").querySelectorAll("button");
    expect(Array.from(buttons).map((b) => b.getAttribute("data-testid"))).toEqual([
      "facility-cost-calculate",
      "facility-cost-open-details",
    ]);
  });
});

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
    await openDetails();
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
    expect(text).toContain("스크리닝 통과");
    // The analytical status carries its reference year + derivation/policy version,
    // in the diagnostic disclosure rather than the primary line.
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
    await openDetails();
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
    await openDetails();
    openSection("facility-cost-exact-values");
    expect(screen.getByTestId("fc-exact-standard-cost").textContent).toContain("120.75 억원");
  });
});
