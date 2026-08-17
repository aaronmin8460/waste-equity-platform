// @vitest-environment jsdom

/**
 * 후보지 분석 dashboard refresh — desktop contracts for the suitability milestone.
 *
 * These drive the REAL page with MapLibre stubbed and the backend mocked, and cover
 * what the restructured 후보지 점수 and 가중치 바꿔보기 screens newly promise, plus the
 * analytical behaviour they must NOT have changed:
 *
 *   - one h1 / one map / one sub-view control on both sub-views;
 *   - the screening disclaimer readable without opening any disclosure;
 *   - the active scoring basis, its plain-Korean method sentence, and its weights;
 *   - candidate-status totals as text with the map's own swatch colors, plus the
 *     current display state of each status;
 *   - the status filter and the stable-only toggle still driving ONE canonical
 *     state, reported (never duplicated) by the sidebar;
 *   - the candidate list, the map click, and the URL all driving ONE selection;
 *   - a missing component rendering `-` and a review candidate its provisional
 *     score — never a fabricated 0;
 *   - exclusion / review reasons, and the run + version context, on screen;
 *   - no raw screening enum in the primary surface;
 *   - the scenario editor's controls, validation, apply/reset, result summary,
 *     baseline comparison, and URL serialisation.
 *
 * Every fixture below is SYNTHETIC and carries no official evidence label; the
 * assertions are about structure and behaviour, never about a fixture's value.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FORBIDDEN_PRIMARY_TOKENS,
  PROFILE_META,
  SUITABILITY_SCREENING_SHORT_LABEL,
} from "../lib/glossary";

// A stubbed MapView that surfaces a candidate-click trigger, so the map path and
// the list path can be shown to drive the SAME single selection state.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub(props: { onCandidateClick?: (id: number) => void }) {
      return (
        <div data-testid="map-container">
          <button
            type="button"
            data-testid="stub-map-click-candidate"
            onClick={() => props.onCandidateClick?.(702)}
          >
            map click candidate 702
          </button>
        </div>
      );
    },
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const { homeApiMock } = await import("./homeApiMock");
  return {
    ...homeApiMock(actual),
    fetchSuitabilityCandidateDetail: vi.fn(),
    previewUserWeightScenario: vi.fn(),
    fetchUserScenarioCandidateDetail: vi.fn(),
  };
});

import Home from "./page";
import * as api from "../lib/api";
import { rankingCollection } from "./homeApiMock";

// --------------------------------------------------------------------------- //
// Fixtures
// --------------------------------------------------------------------------- //

const TOP_CANDIDATES = [
  {
    candidate_id: 701,
    rank: 1,
    sigungu: "강화군",
    total_score: "88.1234",
    stability_class: "STABLE",
    stable_count: 3,
  },
  {
    candidate_id: 702,
    rank: 2,
    sigungu: "옹진군",
    total_score: "81.5000",
    stability_class: "WEIGHT_SENSITIVE",
    stable_count: 1,
  },
];

/** An ELIGIBLE candidate with every component served. */
const ELIGIBLE_DETAIL: api.CandidateDetail = {
  candidate_id: 701,
  candidate_key: "cap500-000701",
  status: "ELIGIBLE",
  profile: "baseline",
  is_excluded: false,
  rank: 1,
  total_score: "88.1234",
  provisional_score: null,
  zoning_score: "90.0000",
  road_score: "70.0000",
  equity_score: "95.0000",
  demand_score: "80.0000",
  sido_region_code: "28",
  sido_region_name: "인천광역시",
  sigungu_region_code: "28710",
  sigungu_region_name: "강화군",
  nearest_road_distance_m: "120.0",
  stable_count: 3,
  stability_class: "STABLE",
  stability_membership: { baseline: true, equal: true, critic: true },
  exclusion_reasons: [],
  review_reasons: [],
  run_id: 47,
  profile_totals: { baseline: "88.1234", critic: "86.0000" },
  profile_ranks: { baseline: 1, critic: 2 },
  penalties: [],
  raw_components: {},
  nearest_road_provenance: { official_layer_code: "UD801" },
  component_provenance: {},
  original_area_m2: "250000",
  clipped_area_m2: "250000",
  clipped_area_ratio: "1.0",
  geometry: { type: "Point", coordinates: [126.5, 37.7] },
  reference_year: 2024,
  policy_version: "suitability-policy-v2",
  derivation_version: "suitability-screening-v3",
  candidate_grid_version: "capital-grid-500m-v1",
  weights: { zoning: "0.4", road: "0.3", equity: "0.2", demand: "0.1" },
  disclaimer: "Analytical screening only — not a legal determination.",
};

/** A REVIEW_REQUIRED candidate: one component MISSING, a provisional score, no rank. */
const REVIEW_DETAIL: api.CandidateDetail = {
  ...ELIGIBLE_DETAIL,
  candidate_id: 702,
  candidate_key: "cap500-000702",
  status: "REVIEW_REQUIRED",
  rank: null,
  total_score: null,
  provisional_score: "64.2500",
  equity_score: null, // no served value — must render "-", never 0
  sigungu_region_name: "옹진군",
  stable_count: null,
  stability_class: null,
  stability_membership: {},
  review_reasons: ["MISSING_EQUITY_COMPONENT"],
};

/** An EXCLUDED candidate: exclusion reasons, and no score or rank at all. */
const EXCLUDED_DETAIL: api.CandidateDetail = {
  ...ELIGIBLE_DETAIL,
  candidate_id: 703,
  candidate_key: "cap500-000703",
  status: "EXCLUDED",
  rank: null,
  total_score: null,
  provisional_score: null,
  sigungu_region_name: "중구",
  exclusion_reasons: ["PROTECTED_AREA_OVERLAP"],
  stable_count: null,
  stability_class: null,
  stability_membership: {},
};

function scenarioPreview(
  over: Partial<api.UserScenarioPreview> = {},
): api.UserScenarioPreview {
  return {
    scenario_hash: "hash-scenario",
    scenario_hash_short: "hash-scena",
    method_version: "user-weight-scenario-v1",
    run_id: 47,
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    canonical_weights: {
      zoning: "0.40000000",
      road: "0.30000000",
      equity: "0.20000000",
      demand: "0.10000000",
    },
    compare_profile: "baseline",
    candidate_count_total: 47893,
    candidate_count_eligible: 1099,
    candidate_count_review: 34534,
    candidate_count_excluded: 12260,
    ranking_population: 1099,
    top_candidates: [
      {
        candidate_id: 701,
        candidate_key: "cap500-000701",
        sido_region_code: "28",
        sido_region_name: "인천광역시",
        sigungu_region_code: "28710",
        sigungu_region_name: "강화군",
        custom_score: "76.2500",
        custom_rank: 1,
        comparison_profile: "baseline",
        comparison_score: "80.0000",
        comparison_rank: 4,
        rank_delta: 3,
        rank_change_direction: "up",
        zoning_score: "55.0000",
        road_score: "100.0000",
        equity_score: "100.0000",
        demand_score: "50.0000",
        stable_count: 3,
        stability_class: "STABLE",
        centroid_lon: 126.5,
        centroid_lat: 37.7,
      },
    ],
    selected_candidate: null,
    tile_url: "/api/v1/suitability/scenarios/tiles/47/{z}/{x}/{y}.mvt",
    assumptions: [],
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "사용자가 입력한 가중치로 재결합한 임시 비교 결과입니다.",
    screening_disclaimer: "Analytical screening only — not a legal determination.",
    ...over,
  };
}

const SCENARIO_CANDIDATE: api.UserScenarioCandidateDetail = {
  candidate_id: 701,
  run_id: 47,
  candidate_key: "cap500-000701",
  status: "ELIGIBLE",
  is_excluded: false,
  method_version: "user-weight-scenario-v1",
  scenario_hash: "hash-scenario",
  scenario_hash_short: "hash-scena",
  canonical_weights: {
    zoning: "0.40000000",
    road: "0.30000000",
    equity: "0.20000000",
    demand: "0.10000000",
  },
  compare_profile: "baseline",
  custom_score: "76.2500",
  custom_provisional_score: null,
  custom_rank: 1,
  comparison_score: "80.0000",
  comparison_rank: 4,
  rank_delta: 3,
  rank_change_direction: "up",
  zoning_score: "55.0000",
  road_score: "100.0000",
  equity_score: "100.0000",
  demand_score: "50.0000",
  contributions: [
    { component: "zoning", component_score: "55.0000", weight: "0.40000000", weighted_contribution: "22.0000" },
    { component: "road", component_score: "100.0000", weight: "0.30000000", weighted_contribution: "30.0000" },
    { component: "equity", component_score: "100.0000", weight: "0.20000000", weighted_contribution: "20.0000" },
    { component: "demand", component_score: "50.0000", weight: "0.10000000", weighted_contribution: "5.0000" },
  ],
  stable_count: 3,
  stability_class: "STABLE",
  stability_membership: { baseline: true, equal: true, critic: true },
  profile_totals: {},
  profile_ranks: {},
  sido_region_code: "28",
  sido_region_name: "인천광역시",
  sigungu_region_code: "28710",
  sigungu_region_name: "강화군",
  exclusion_reasons: [],
  review_reasons: [],
  penalties: [],
  raw_components: {},
  nearest_road_distance_m: "120.0",
  nearest_road_provenance: {},
  component_provenance: {},
  centroid_lon: 126.5,
  centroid_lat: 37.7,
  geometry: { type: "Point", coordinates: [126.5, 37.7] },
  reference_year: 2024,
  policy_version: "suitability-policy-v2",
  derivation_version: "suitability-screening-v3",
  candidate_grid_version: "capital-grid-500m-v1",
  scenario_label: "사용자 가정 기반 시나리오",
  scenario_disclaimer: "사용자가 입력한 가중치로 재결합한 임시 비교 결과입니다.",
  screening_disclaimer: "Analytical screening only — not a legal determination.",
};

// --------------------------------------------------------------------------- //
// Harness
// --------------------------------------------------------------------------- //

function setUrl(query: string) {
  window.history.replaceState(null, "", `/${query}`);
}

/** Serve a populated summary on top of the shared mock. */
async function serveSummary(): Promise<void> {
  // ③ reads the scoped ranking from `/suitability/candidates`; the SAME rows the
  // summary declares below, so every existing row assertion is unchanged.
  vi.mocked(api.fetchSuitabilityCandidates).mockResolvedValue(
    rankingCollection(TOP_CANDIDATES) as unknown as api.SuitabilityCandidateCollection,
  );
  const base = await api.fetchSuitabilitySummary("baseline");
  vi.mocked(api.fetchSuitabilitySummary).mockResolvedValue({
    ...base,
    top_candidates: TOP_CANDIDATES,
    top_stable_candidates: [TOP_CANDIDATES[0]],
    exclusion_reason_counts: { PROTECTED_AREA_OVERLAP: 4200 },
    review_reason_counts: { MISSING_EQUITY_COMPONENT: 33000 },
    coverage_notes: ["일부 시군의 시설 처리량 자료가 없습니다."],
    assumptions: ["500m 후보 격자는 하나의 필지가 아닙니다."],
  });
}

async function renderLoaded() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  return utils;
}

/** Enter 후보지 분석 → 후보지 점수 with a populated summary. */
async function enterScore() {
  await serveSummary();
  vi.mocked(api.fetchSuitabilityCandidateDetail).mockImplementation(async (id: number) => {
    if (id === 702) return REVIEW_DETAIL;
    if (id === 703) return EXCLUDED_DETAIL;
    return ELIGIBLE_DETAIL;
  });
  const utils = await renderLoaded();
  fireEvent.click(screen.getByTestId("mode-suitability"));
  await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
  // ③ reads the scoped ranking one tick after the summary, so waiting for its
  // count line keeps row assertions from racing that read.
  await waitFor(() => expect(screen.getByTestId("candidate-ranking-counts")).toBeDefined());
  return utils;
}

/** Enter 후보지 분석 → 가중치 바꿔보기. */
async function enterScenario() {
  const utils = await enterScore();
  fireEvent.click(screen.getByTestId("suitability-view-scenario"));
  await waitFor(() => expect(screen.getByTestId("scenario-lab")).toBeDefined());
  return utils;
}

function setPercent(component: string, value: number) {
  fireEvent.change(screen.getByTestId(`scenario-input-${component}`), {
    target: { value: String(value) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  setUrl("");
});

// --------------------------------------------------------------------------- //
// 후보지 점수 — shell + orientation
// --------------------------------------------------------------------------- //

describe("후보지 점수 — shell contracts", () => {
  it("keeps one h1, one map, no sub-view bar, one main and one aside", async () => {
    const { container } = await enterScore();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    // The view titles itself with its destination name (spec §2.2); "후보지 분석"
    // is now the SEPARATE cost destination, so a stale literal here would name two
    // different screens the same thing.
    expect(container.querySelector("h1")!.textContent).toBe("후보지 심층 분석");
    expect(screen.getAllByTestId("map-container")).toHaveLength(1);
    // The segmented sub-view bar is retired — the six destinations select `view`.
    expect(container.querySelectorAll('[data-testid="suitability-subviews"]')).toHaveLength(0);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    // TWO complementary columns now flank the map — the collapsible 분석 조건 and
    // 후보지 결과 panels of the three-column workspace (spec §6). Before the
    // redesign this view had a single resizable column, hence the old count of 1.
    expect(container.querySelectorAll("aside")).toHaveLength(2);
    expect(screen.getByTestId("deep-left-panel")).toBeDefined();
    expect(screen.getByTestId("deep-right-panel")).toBeDefined();
    // One global navigation (the app bar's `mode-switch` group), not one per branch.
    expect(container.querySelectorAll('[data-testid="top-navigation"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="mode-switch"]')).toHaveLength(1);
  });

  it("carries the screening limitation without a banner, and never as an alert", async () => {
    await enterScore();
    // THE BANNER IS GONE. Figma 136:8684 opens the left column with ① and nothing
    // above it, and a three-line notice card ahead of the controls was the wall of
    // text the Page-4 remediation removed. Deleting the LIMITATION would be a
    // different change, so the two surfaces that still carry it are pinned here.
    expect(screen.queryByTestId("suitability-screening-notice")).toBeNull();
    expect(screen.queryByTestId("suitability-screening-disclaimer")).toBeNull();

    // 1. The map's own legend, permanently, beside the candidates it qualifies.
    expect(screen.getByTestId("suitability-legend-note").textContent).toContain(
      SUITABILITY_SCREENING_SHORT_LABEL,
    );
    // 2. The run's served disclaimer in 계산 방법과 가정 — not inside a <details>, so
    //    it is readable with no user interaction, and never role="alert" (standing
    //    explanatory content must not interrupt a screen reader).
    const served = screen.getByTestId("score-basis-disclaimer");
    expect(served.closest("details")).toBeNull();
    expect(served.getAttribute("role")).not.toBe("alert");
  });
});

// --------------------------------------------------------------------------- //
// Active scoring basis
// --------------------------------------------------------------------------- //

describe("후보지 점수 — the active scoring basis", () => {
  it("names the active profile, and carries its weights on the factor cards", async () => {
    await enterScore();
    const basis = screen.getByTestId("suitability-active-basis");
    expect(within(basis).getByTestId("active-basis-name").textContent).toBe(
      PROFILE_META.baseline.primary,
    );
    // The four component weights, each with its Korean name AND a numeric value.
    // These live on the factor cards, not in a separate one-line sentence beside
    // the bar: the sentence was a third copy of the same four numbers and was
    // removed from the primary card (see page.page4PrimaryCopy.test.tsx).
    const cards = screen.getByTestId("factor-cards").textContent ?? "";
    expect(cards).toContain("용도지역 호환성(Z)");
    expect(cards).toContain("도로 근접성 대리지표(R)");
    expect(cards).toContain("기존 지역 부담(E)");
    expect(cards).toContain("폐기물 처리 수요(D)");
    expect(screen.getByTestId("factor-weight-zoning").textContent).toContain("40%");
  });

  it("follows the profile radio and describes CRITIC as data-derived, never importance", async () => {
    await enterScore();
    fireEvent.click(screen.getByTestId("profile-radio-critic"));
    await waitFor(() =>
      expect(screen.getByTestId("active-basis-name").textContent).toBe(PROFILE_META.critic.primary),
    );
    // The active profile's method sentence moved into the 가중치 계산 방법
    // disclosure; it still follows the radio, and it still says what CRITIC is NOT.
    expect(screen.getByTestId("active-basis-method-detail").textContent).toContain(
      "항목의 중요도 판단이 아닙니다",
    );
    // The run's own CRITIC weights, with their Korean names, plus the caveat.
    const note = screen.getByTestId("critic-method-note").textContent ?? "";
    expect(note).toContain("용도지역 호환성(Z) 31%");
    expect(note).toContain("규범적 중요도가 아닌");
  });

  it("announces the active basis in the existing live region", async () => {
    await enterScore();
    const live = screen.getByTestId("suitability-live");
    expect(live.getAttribute("role")).toBe("status");
    expect(live.textContent).toContain(`점수 반영 기준 ${PROFILE_META.baseline.primary}`);
  });
});

// --------------------------------------------------------------------------- //
// Candidate-status summary + the map display state it reports
// --------------------------------------------------------------------------- //

describe("후보지 점수 — candidate-status summary", () => {
  // 후보 상태 요약 is struck from the workspace (Figma 225:440), on the stated
  // grounds that the map legend already carries the status breakdown. This asserts
  // that it genuinely does — the same semantics, on the surviving surface.
  it("shows every status as text with its served count, in the map legend", async () => {
    await enterScore();
    const filters = screen.getByTestId("status-filters").textContent ?? "";
    expect(filters).toContain("스크리닝 통과");
    expect(filters).toContain("추가 검토 필요");
    expect(filters).toContain("프로젝트 스크리닝 제외");
    expect(screen.getByTestId("status-filter-count-ELIGIBLE").textContent).toContain("1,099");
    expect(screen.getByTestId("status-filter-count-REVIEW_REQUIRED").textContent).toContain("34,534");
    expect(screen.getByTestId("status-filter-count-EXCLUDED").textContent).toContain("12,260");
    // Status is never conveyed by colour alone: every row carries its name as text.
    for (const status of ["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"]) {
      expect(screen.getByTestId(`status-toggle-${status}`)).toBeDefined();
    }
  });

  // With the sidebar's mirror struck, the legend checkbox is not a second report of
  // the display state — it IS the state. One control, one truth.
  it("carries the map display state on the one status control, and updates it", async () => {
    await enterScore();
    // Default: eligible + review shown, excluded hidden.
    expect((screen.getByTestId("status-toggle-ELIGIBLE") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("status-toggle-EXCLUDED") as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByTestId("status-toggle-EXCLUDED"));
    await waitFor(() =>
      expect((screen.getByTestId("status-toggle-EXCLUDED") as HTMLInputElement).checked).toBe(true),
    );
  });

  it("keeps exactly ONE status control and ONE stable-only control on the screen", async () => {
    const { container } = await enterScore();
    for (const status of ["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"]) {
      expect(container.querySelectorAll(`[data-testid="status-toggle-${status}"]`)).toHaveLength(1);
    }
    expect(container.querySelectorAll('[data-testid="stable-only-toggle"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="map-legend"]')).toHaveLength(1);
  });

  it("carries the stable-only restriction on its one control, and states its scope", async () => {
    await enterScore();
    const toggle = () => screen.getByTestId("stable-only-toggle") as HTMLInputElement;
    expect(toggle().checked).toBe(false);
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle().checked).toBe(true));
    // The restriction only ever narrows ELIGIBLE cells, and the legend says so.
    expect(screen.getByTestId("stability-legend-note").textContent).toContain(
      "검토/제외 셀은 안정성 평가 대상이 아닙니다",
    );
  });

  // Both moved into card ②'s 점수 기준 자세히 보기 when 후보 상태 요약 and
  // 자료 공백 안내 were struck. Neither left the product: a score without its run is
  // not reproducible, and a coverage gap is never a confirmed zero.
  it("shows the run and version context, and the served coverage gap", async () => {
    await enterScore();
    const runContext = screen.getByTestId("suitability-run-context").textContent ?? "";
    expect(runContext).toContain("#47");
    expect(runContext).toContain("기준연도 2024");
    expect(runContext).toContain("suitability-policy-v2");
    const coverage = screen.getByTestId("score-basis-coverage").textContent ?? "";
    expect(coverage).toContain("일부 시군의 시설 처리량 자료가 없습니다.");
    // A gap is a BLANK, never a confirmed "해당 없음".
    expect(coverage).toContain("\"해당 없음\"을 확인한 것이 아닙니다");
  });
});

// --------------------------------------------------------------------------- //
// Stability
// --------------------------------------------------------------------------- //

describe("후보지 점수 — stability presentation", () => {
  it("states stability in words and never as legal or engineering certainty", async () => {
    await enterScore();
    const summary = screen.getByTestId("score-basis-stability-meaning").textContent ?? "";
    expect(summary).toContain("안정 후보");
    expect(summary).toContain("최종 입지, 허가 가능성 또는 법적 적격성을 의미하지 않습니다");
    for (const forbidden of ["안전성", "시공 가능성", "법적 안정성", "정책 확정성"]) {
      expect(summary).not.toContain(forbidden);
    }
    // A text stability badge accompanies the ranked rows (never outline color alone).
    expect(screen.getAllByTestId("stability-badge")[0].textContent).toContain("안정 후보 3/3");
  });
});

// --------------------------------------------------------------------------- //
// Candidate list + selection
// --------------------------------------------------------------------------- //

describe("후보지 점수 — candidate list and selection", () => {
  it("renders the served order with neutral language, never 최적 / 추천 / 건설 권고", async () => {
    await enterScore();
    const list = screen.getByTestId("top-candidates");
    const rows = within(list).getAllByTestId("top-candidate-item");
    expect(rows).toHaveLength(2);
    // The served order and values, verbatim.
    expect(rows[0].textContent).toContain("1위");
    expect(rows[0].textContent).toContain("강화군");
    expect(rows[0].textContent).toContain("88.1234점");
    expect(rows[1].textContent).toContain("2위");
    const text = list.textContent ?? "";
    expect(text).toContain("최적지·추천지 판정이 아닙니다");
    for (const forbidden of ["최적 후보", "최고 후보", "추천 후보", "건설 권고"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("selects from the list, marks the row by text and aria-current, and fills the summary", async () => {
    await enterScore();
    // 선택한 후보 구역 moved INSIDE ③ when its own card was struck, and nested it
    // renders nothing at all until a row is selected — the standing empty-state card
    // would put back exactly the always-on block the strike removes. What matters is
    // preserved: with nothing selected there is no candidate detail and no sample
    // score anywhere on the screen.
    expect(screen.queryByTestId("candidate-detail")).toBeNull();
    expect(screen.queryByTestId("candidate-detail-empty")).toBeNull();

    fireEvent.click(within(screen.getByTestId("top-candidates")).getAllByTestId("top-candidate-item")[0]);
    const detail = await screen.findByTestId("candidate-detail");
    expect(detail.textContent).toContain("강화군");
    expect(detail.textContent).toContain("88.1234");
    expect(screen.getByTestId("top-candidate-selected")).toBeDefined();
    expect(
      within(screen.getByTestId("top-candidates")).getAllByTestId("top-candidate-item")[0].getAttribute(
        "aria-current",
      ),
    ).toBe("true");
    // Still exactly one summary, and still no empty prompt.
    expect(screen.queryByTestId("candidate-detail-empty")).toBeNull();
  });

  it("shares ONE selection between the map click and the list", async () => {
    await enterScore();
    fireEvent.click(screen.getByTestId("stub-map-click-candidate"));
    const detail = await screen.findByTestId("candidate-detail");
    // 702 is the second ranked row — selecting it on the map marks that row.
    expect(detail.textContent).toContain("옹진군");
    await waitFor(() =>
      expect(
        within(screen.getByTestId("top-candidates"))
          .getAllByTestId("top-candidate-item")[1]
          .getAttribute("aria-current"),
      ).toBe("true"),
    );
    expect(screen.getAllByTestId("candidate-detail")).toHaveLength(1);
  });

  it("restores a candidate from the versioned URL", async () => {
    setUrl("?v=1&mode=suitability&view=score&cand=701");
    await serveSummary();
    vi.mocked(api.fetchSuitabilityCandidateDetail).mockResolvedValue(ELIGIBLE_DETAIL);
    await renderLoaded();
    const detail = await screen.findByTestId("candidate-detail");
    expect(detail.textContent).toContain("강화군");
    expect(vi.mocked(api.fetchSuitabilityCandidateDetail)).toHaveBeenCalledWith(701, "baseline");
  });
});

// --------------------------------------------------------------------------- //
// Selected-candidate summary: components, missing data, exclusion, provenance
// --------------------------------------------------------------------------- //

describe("후보지 점수 — selected-candidate summary", () => {
  it("names every component in citizen terms and shows its score and weight as text", async () => {
    await enterScore();
    fireEvent.click(within(screen.getByTestId("top-candidates")).getAllByTestId("top-candidate-item")[0]);
    await screen.findByTestId("candidate-detail");
    const table = screen.getByTestId("candidate-components");
    for (const label of [
      "용도지역 호환성",
      "도로 근접성 대리지표",
      "기존 지역 부담",
      "폐기물 처리 수요",
    ]) {
      expect(table.textContent).toContain(label);
    }
    expect(screen.getByTestId("candidate-component-zoning").textContent).toContain("90.0000");
    expect(screen.getByTestId("candidate-component-zoning").textContent).toContain("40%");
  });

  it("shows a review candidate's provisional score and a missing component as '-', never 0", async () => {
    await enterScore();
    fireEvent.click(screen.getByTestId("stub-map-click-candidate")); // 702 = review
    const detail = await screen.findByTestId("candidate-detail");
    expect(detail.textContent).toContain("참고용 임시 점수");
    expect(detail.textContent).toContain("64.2500");
    expect(detail.textContent).toContain("순위 없음");
    // The missing equity component renders "-", and the panel says so in words.
    expect(screen.getByTestId("candidate-component-equity").textContent).toContain("-");
    expect(screen.getByTestId("candidate-component-equity").textContent).not.toContain("0.0000");
    expect(detail.textContent).toContain("자료가 없다는 뜻이며 0점이 아닙니다");
    // Its review reason is shown, not swallowed.
    expect(screen.getByTestId("candidate-review-reasons").textContent).toContain(
      "MISSING_EQUITY_COMPONENT",
    );
    // Stability is not claimed for a non-eligible cell.
    expect(screen.getByTestId("candidate-stability-na")).toBeDefined();
  });

  it("shows an excluded candidate's reasons as an analytical outcome, not a system error", async () => {
    await enterScore();
    fireEvent.click(
      within(screen.getByTestId("top-candidates")).getAllByTestId("top-candidate-item")[0],
    );
    await screen.findByTestId("candidate-detail");
    // Swap in the excluded fixture through the same single selection path.
    vi.mocked(api.fetchSuitabilityCandidateDetail).mockResolvedValue(EXCLUDED_DETAIL);
    fireEvent.click(screen.getByTestId("stub-map-click-candidate"));
    await waitFor(() =>
      expect(screen.getByTestId("candidate-exclusion-reasons")).toBeDefined(),
    );
    const detail = screen.getByTestId("candidate-detail");
    expect(detail.textContent).toContain("PROTECTED_AREA_OVERLAP");
    expect(detail.textContent).toContain("분석 규칙에 따른 제외이며 자료 오류가 아닙니다");
    // An exclusion is not an error region.
    expect(detail.getAttribute("role")).not.toBe("alert");
    // No score or rank is invented for it.
    expect(detail.textContent).not.toContain("88.1234");
  });

  it("carries the candidate's reference period, run, and version context", async () => {
    await enterScore();
    fireEvent.click(within(screen.getByTestId("top-candidates")).getAllByTestId("top-candidate-item")[0]);
    await screen.findByTestId("candidate-detail");
    const provenance = screen.getByTestId("candidate-provenance").textContent ?? "";
    expect(provenance).toContain("2024");
    expect(provenance).toContain("#47");
    expect(provenance).toContain("capital-grid-500m-v1");
  });
});

// --------------------------------------------------------------------------- //
// Terminology
// --------------------------------------------------------------------------- //

describe("후보지 점수 — no raw enum on the primary surface", () => {
  it("keeps forbidden technical tokens out of BOTH panels once diagnostics are stripped", async () => {
    const { container } = await enterScore();
    // The controls and the results are two columns now, so the audit has to scan
    // both — checking only the first would leave the whole results panel
    // (ranking, relative bands, selected candidate) unaudited.
    const asides = Array.from(container.querySelectorAll("aside"));
    expect(asides.length).toBe(2);
    const text = asides
      .map((aside) => {
        const clone = aside.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("[data-diagnostic]").forEach((node) => node.remove());
        // Detail disclosures are the sanctioned home for a version string.
        clone.querySelectorAll("details").forEach((node) => node.remove());
        return clone.textContent ?? "";
      })
      .join(" ");
    for (const token of FORBIDDEN_PRIMARY_TOKENS) {
      // The served reason strings are the backend's own text, shown verbatim in the
      // reason breakdowns; they are not this milestone's labels.
      if (token === "EXCLUDED" || token === "CRITIC") continue;
      expect(text.includes(token), `suitability sidebar leaks "${token}"`).toBe(false);
    }
    // The plain status names ARE still present — but no longer on the panels'
    // PRIMARY surface, because 후보 상태 요약 is struck. They now live on the map
    // legend and in card ②'s 점수 기준 자세히 보기, both of which this scan strips.
    // So the positive check reads the workspace as a whole; the strict no-raw-enum
    // audit above is unchanged and still primary-surface-only.
    const whole = container.textContent ?? "";
    expect(whole).toContain("스크리닝 통과");
    expect(whole).toContain("프로젝트 스크리닝 제외");
  });
});

// --------------------------------------------------------------------------- //
// Map workspace
// --------------------------------------------------------------------------- //

describe("후보지 점수 — map workspace", () => {
  it("puts the legend and the insight strip in ONE bottom overlay column inside .map-pane", async () => {
    const { container } = await enterScore();
    const pane = container.querySelector(".map-pane")!;
    // MapView stays the direct child of the pane; overlays are its siblings.
    expect(screen.getByTestId("map-container").parentElement).toBe(pane);
    const legend = screen.getByTestId("map-legend");
    const strip = screen.getByTestId("suitability-insight-strip");
    expect(legend.closest(".map-pane")).toBe(pane);
    expect(strip.closest(".map-pane")).toBe(pane);
    // Same overlay column → they stack instead of colliding.
    expect(legend.parentElement!.parentElement).toBe(strip.parentElement!.parentElement);
  });

  it("mounts the insight as ONE disclosure, collapsed, so the map starts unobstructed", async () => {
    const { container } = await enterScore();
    const strip = screen.getByTestId("suitability-insight-strip") as HTMLDetailsElement;
    expect(strip.tagName).toBe("DETAILS");
    expect(strip.open).toBe(false);
    expect(screen.getByTestId("suitability-insight-summary").textContent).toContain(
      "해석 · 주의 · 출처 보기",
    );
    // Exactly one bar over the map — the 기술 정보 disclosure is nested inside it,
    // and the legend keeps its own, separate (force-open-at-md+) class.
    expect(container.querySelectorAll("details.map-insight")).toHaveLength(1);
    expect(container.querySelectorAll("details.map-legend.map-insight")).toHaveLength(0);
  });

  it("states a neutral interpretation, a standing caution, and the current basis", async () => {
    await enterScore();
    const strip = screen.getByTestId("suitability-insight-strip");
    // Opened the way a reader opens it — the content below is what the disclosure
    // reveals, unchanged from when the card was permanently expanded.
    fireEvent.click(screen.getByTestId("suitability-insight-summary"));
    expect((strip as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByTestId("suitability-insight-interpretation").textContent).toContain(
      "상대적 스크리닝 점수",
    );
    expect(screen.getByTestId("suitability-insight-caution").textContent).toContain(
      "법적·공학적 적합 판정이 아닙니다",
    );
    // Standing content, never an alert.
    expect(strip.querySelector('[role="alert"]')).toBeNull();
    const basis = screen.getByTestId("suitability-insight-basis").textContent ?? "";
    expect(basis).toContain(PROFILE_META.baseline.primary);
    expect(basis).toContain("2024");
    expect(screen.getByTestId("suitability-insight-visibility").textContent).toContain(
      "스크리닝 통과",
    );
    // Version strings stay in the technical disclosure, not in primary text.
    expect(basis).not.toContain("suitability-policy-v2");
    expect(screen.getByTestId("suitability-insight-technical").textContent).toContain(
      "suitability-policy-v2",
    );
  });

  it("opens 데이터·출처 as a DIALOG over this view, and closing returns here", async () => {
    // 데이터·출처 is a dialog now, not a page (spec §8). The old contract was
    // "mounts no map", which held only while it navigated away to a map-free
    // page. Layering is the point: the reader must be able to check a source
    // without losing the analysis they were reading, so the map behind STAYS —
    // and stays the same node, not a remount.
    await enterScore();
    const mapNode = screen.getByTestId("map-container");

    fireEvent.click(screen.getByTestId("suitability-insight-summary"));
    fireEvent.click(screen.getByTestId("suitability-insight-open-sources"));
    await waitFor(() =>
      expect(screen.getByTestId("mode-transparency").getAttribute("aria-pressed")).toBe("true"),
    );

    const dialog = screen.getByTestId("data-sources-dialog");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // The analysis is still mounted underneath, untouched.
    expect(screen.getByTestId("map-container")).toBe(mapNode);

    // Closing returns to the destination it was layered over.
    fireEvent.click(screen.getByTestId("data-sources-dialog-close"));
    await waitFor(() => expect(screen.queryByTestId("data-sources-dialog")).toBeNull());
    expect(screen.getByTestId("mode-suitability").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("map-container")).toBe(mapNode);
  });
});

// --------------------------------------------------------------------------- //
// 가중치 바꿔보기
// --------------------------------------------------------------------------- //

describe("가중치 바꿔보기 — shell and controls", () => {
  it("keeps one h1, one map, and no sub-view bar", async () => {
    const { container } = await enterScenario();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")!.textContent).toBe("후보지 심층 비교");
    expect(screen.getAllByTestId("map-container")).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="suitability-subviews"]')).toHaveLength(0);
    // The screening disclaimer follows into this sub-view.
    expect(screen.getByTestId("suitability-screening-disclaimer")).toBeDefined();
  });

  it("keeps all four weight controls, named in citizen terms, with their percentage", async () => {
    await enterScenario();
    for (const component of ["zoning", "road", "equity", "demand"]) {
      expect(screen.getByTestId(`scenario-slider-${component}`)).toBeDefined();
      expect(screen.getByTestId(`scenario-input-${component}`)).toBeDefined();
      expect(screen.getByTestId(`scenario-value-${component}`)).toBeDefined();
    }
    const editor = screen.getByTestId("scenario-editor").textContent ?? "";
    for (const label of [
      "용도지역 호환성",
      "도로 근접성 대리지표",
      "기존 지역 부담",
      "폐기물 처리 수요",
    ]) {
      expect(editor).toContain(label);
    }
    // The stored operating basis is named apart from the user's setting.
    const overview = screen.getByTestId("scenario-overview").textContent ?? "";
    expect(overview).toContain("현재 운영 기준");
    expect(overview).toContain("사용자 설정");
    for (const forbidden of ["새 공식 기준", "확정 기준", "정책 가중치"]) {
      expect(overview).not.toContain(forbidden);
    }
  });

  it("blocks apply on an invalid total and enables it at exactly 100%", async () => {
    await enterScenario();
    setPercent("zoning", 55); // total ≠ 100
    const apply = screen.getByTestId("scenario-apply") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    const status = screen.getByTestId("scenario-total-status");
    // Validation is a polite status, never an alert, and states the rule in words.
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toContain("합계가 정확히 100%여야 적용할 수 있습니다");
    expect(vi.mocked(api.previewUserWeightScenario)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("scenario-normalize"));
    expect(screen.getByTestId("scenario-total").textContent).toContain("100%");
    expect((screen.getByTestId("scenario-apply") as HTMLButtonElement).disabled).toBe(false);
  });

  it("loads a preset into the editor without applying it", async () => {
    await enterScenario();
    fireEvent.click(screen.getByTestId("scenario-preset-equal"));
    expect(screen.getByTestId("scenario-value-zoning").textContent).toBe("25%");
    expect(vi.mocked(api.previewUserWeightScenario)).not.toHaveBeenCalled();
    expect(screen.getByTestId("scenario-no-applied")).toBeDefined();
  });

  it("restores the stored profile values with the reset control", async () => {
    await enterScenario();
    setPercent("zoning", 10);
    expect(screen.getByTestId("scenario-value-zoning").textContent).toBe("10%");
    fireEvent.click(screen.getByTestId("scenario-reset-stored"));
    // The mocked run's baseline profile is 40/30/20/10.
    expect(screen.getByTestId("scenario-value-zoning").textContent).toBe("40%");
    expect(screen.getByTestId("scenario-value-demand").textContent).toBe("10%");
  });
});

describe("가중치 바꿔보기 — applying a scenario", () => {
  it("summarises the applied result against the comparison basis, without claiming improvement", async () => {
    vi.mocked(api.previewUserWeightScenario).mockResolvedValue(scenarioPreview());
    await enterScenario();
    fireEvent.click(screen.getByTestId("scenario-preset-baseline"));
    fireEvent.click(screen.getByTestId("scenario-apply"));

    const summary = await screen.findByTestId("scenario-summary");
    expect(vi.mocked(api.previewUserWeightScenario)).toHaveBeenCalledTimes(1);
    // The applied user weights, named, and the comparison basis.
    const applied = screen.getByTestId("scenario-applied-weights").textContent ?? "";
    expect(applied).toContain("용도지역 호환성 40%");
    expect(summary.textContent).toContain("비교 기준");
    expect(summary.textContent).toContain("순위 산정 대상");
    // The result list carries the served rank movement.
    expect(screen.getByTestId("scenario-rank-move").textContent).toContain("4위 → 1위");
    // No "better site" claim anywhere in the applied result.
    for (const forbidden of ["더 좋은 입지", "최적 입지", "건설 권고"]) {
      expect(summary.textContent).not.toContain(forbidden);
    }
  });

  it("compares the selected scenario candidate with the baseline and states the movement neutrally", async () => {
    vi.mocked(api.previewUserWeightScenario).mockResolvedValue(scenarioPreview());
    vi.mocked(api.fetchUserScenarioCandidateDetail).mockResolvedValue(SCENARIO_CANDIDATE);
    await enterScenario();
    fireEvent.click(screen.getByTestId("scenario-apply"));
    await screen.findByTestId("scenario-summary");

    fireEvent.click(screen.getByTestId("scenario-top-row"));
    const detail = await screen.findByTestId("scenario-candidate-detail");
    expect(detail.textContent).toContain("76.2500");
    // Component names, never a bare Z/R/E/D column.
    expect(detail.textContent).toContain("용도지역 호환성(Z)");

    const comparison = screen.getByTestId("scenario-selected-comparison");
    expect(comparison.textContent).toContain("76.2500");
    expect(comparison.textContent).toContain("80.0000");
    expect(screen.getByTestId("scenario-selected-movement").textContent).toContain(
      "현재 사용자 설정에서는 순위가 상승했습니다",
    );
    expect(comparison.textContent).toContain("더 좋은 입지라는 뜻이 아닙니다");
  });

  it("mirrors the applied weights into the versioned URL and into the map insight strip", async () => {
    vi.mocked(api.previewUserWeightScenario).mockResolvedValue(scenarioPreview());
    await enterScenario();
    fireEvent.click(screen.getByTestId("scenario-apply"));
    await screen.findByTestId("scenario-summary");

    await waitFor(() => expect(window.location.search).toContain("wz=0.40000000"));
    expect(window.location.search).toContain("view=scenario");
    expect(window.location.search).toContain("v=1");

    const strip = screen.getByTestId("suitability-insight-strip") as HTMLDetailsElement;
    // The scenario view's disclosure also starts collapsed; its content is the same.
    expect(strip.open).toBe(false);
    fireEvent.click(screen.getByTestId("suitability-insight-summary"));
    expect(strip.textContent).toContain("사용자가 조정한 가중치");
    expect(screen.getByTestId("suitability-insight-caution").textContent).toContain(
      "공식 분석 실행이 아닙니다",
    );
  });

  it("restores a shared scenario URL into the editor without showing a result until applied", async () => {
    setUrl("?v=1&mode=suitability&view=scenario&wz=0.50000000&wr=0.20000000&we=0.20000000&wd=0.10000000");
    await serveSummary();
    await renderLoaded();
    await waitFor(() => expect(screen.getByTestId("scenario-lab")).toBeDefined());
    // The lab seeds its editor from the shared link in a post-mount effect.
    await waitFor(() =>
      expect(screen.getByTestId("scenario-value-zoning").textContent).toBe("50%"),
    );
    // A restored draft is never shown as a current result.
    expect(screen.getByTestId("scenario-no-applied")).toBeDefined();
    expect(vi.mocked(api.previewUserWeightScenario)).not.toHaveBeenCalled();
    // The shared link is not self-stripped before it can be honoured.
    expect(window.location.search).toContain("wz=0.5");
  });

  it("keeps exactly one editor, one apply control, and one result list", async () => {
    vi.mocked(api.previewUserWeightScenario).mockResolvedValue(scenarioPreview());
    const { container } = await enterScenario();
    fireEvent.click(screen.getByTestId("scenario-apply"));
    await screen.findByTestId("scenario-summary");
    expect(container.querySelectorAll('[data-testid="scenario-lab"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="scenario-apply"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="scenario-top-candidates"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="scenario-compare-select"]')).toHaveLength(1);
    for (const component of ["zoning", "road", "equity", "demand"]) {
      expect(container.querySelectorAll(`[data-testid="scenario-input-${component}"]`)).toHaveLength(
        1,
      );
    }
  });
});

// --------------------------------------------------------------------------- //
// 비용 살펴보기 regression guard (not redesigned in this milestone)
// --------------------------------------------------------------------------- //

describe("비용 살펴보기 — untouched by this milestone", () => {
  it("still mounts the cost dashboard with no map, one h1, and the shared chrome", async () => {
    const { container } = await enterScore();
    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());
    expect(screen.queryByTestId("map-container")).toBeNull();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")!.textContent).toBe("후보지 분석");
    expect(container.querySelectorAll('[data-testid="suitability-subviews"]')).toHaveLength(0);
    expect(screen.getByTestId("mode-switch")).toBeDefined();
    // The score sidebar is gone, and returning to it brings the workspace back.
    expect(screen.queryByTestId("suitability-summary")).toBeNull();
    fireEvent.click(screen.getByTestId("mode-suitability"));
    await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
    expect(screen.getByTestId("map-container")).toBeDefined();
  });
});
