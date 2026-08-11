// @vitest-environment jsdom

/**
 * PAGE 4A — 후보지 심층 분석, restyled to the Figma hierarchy (frame 136:8684).
 *
 * This file pins what the RESTYLE promises and, more importantly, what it must NOT
 * have quietly imported from the Figma mock. The frame is an illustration: its four
 * factors, its A/B/C-to-status arrows, its "60점 이상 통과" language, its 94.x scores
 * and its saved-scenario cards describe a model this backend does not have. The
 * layout is adopted; those claims are not.
 *
 * What is asserted here:
 *   - the numbered ① ② ③ hierarchy, in the right columns;
 *   - four factor cards for the REAL Z/R/E/D components, with their served weights;
 *   - no invented factor (토지피복 적합도 / 주민 반응 / 장래 발생량) anywhere;
 *   - no pass-mark rule (60점 / 62점 / 점 이상 → 스크리닝 통과);
 *   - A/B/C stays a relative band with percentile boundaries, never a status;
 *   - the stability copy says THREE comparison bases, never four, and is not a
 *     second control;
 *   - the map survives both panel collapses, and the candidate detail stays
 *     reachable from the restyled ranking.
 *
 * Every fixture is SYNTHETIC and carries no official evidence label.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub() {
      return <div data-testid="map-container" />;
    },
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const { homeApiMock } = await import("./homeApiMock");
  return { ...homeApiMock(actual), fetchSuitabilityCandidateDetail: vi.fn() };
});

const computeGradeDistribution = vi.fn();
vi.mock("../lib/relativeGrade", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/relativeGrade")>();
  return {
    ...actual,
    computeGradeDistribution: (...args: unknown[]) => computeGradeDistribution(...args),
  };
});

import { COMPONENT_META, COMPONENT_ORDER } from "../lib/glossary";
import Home from "./page";
import * as api from "../lib/api";

const DISTRIBUTION = {
  runId: 47,
  profile: "baseline" as const,
  population: 17501,
  p25: 47.6779,
  p75: 57.811,
  countA: 4914,
  countB: 8403,
  countC: 4184,
};

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

const DETAIL: api.CandidateDetail = {
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
  profile_totals: { baseline: "88.1234" },
  profile_ranks: { baseline: 1 },
  penalties: [],
  raw_components: {},
  nearest_road_provenance: {},
  component_provenance: {},
  original_area_m2: "250000",
  clipped_area_m2: "250000",
  clipped_area_ratio: "1.0",
  geometry: { type: "Point", coordinates: [126.5, 37.7] },
  weights: { zoning: "0.40", road: "0.20", equity: "0.20", demand: "0.20" },
  reference_year: 2024,
  policy_version: "suitability-policy-v2",
  derivation_version: "suitability-screening-v3",
  candidate_grid_version: "capital-grid-500m-v1",
  disclaimer: "Analytical screening only — not a legal determination.",
};

beforeEach(() => {
  vi.clearAllMocks();
  computeGradeDistribution.mockResolvedValue(DISTRIBUTION);
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

/** Serve a populated summary, including the 시·도 breakdown card ① reads. */
async function serveSummary(): Promise<void> {
  const base = await api.fetchSuitabilitySummary("baseline");
  vi.mocked(api.fetchSuitabilitySummary).mockResolvedValue({
    ...base,
    top_candidates: TOP_CANDIDATES,
    top_stable_candidates: [TOP_CANDIDATES[0]],
    sido_distribution: {
      인천광역시: { ELIGIBLE: 400, REVIEW_REQUIRED: 1200 },
      경기도: { ELIGIBLE: 699 },
    },
    assumptions: ["500m 후보 격자는 하나의 필지가 아닙니다."],
  });
}

async function enterDeepAnalysis() {
  await serveSummary();
  vi.mocked(api.fetchSuitabilityCandidateDetail).mockResolvedValue(DETAIL);
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  fireEvent.click(screen.getByTestId("mode-suitability"));
  await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
  return utils;
}

const left = () => screen.getByTestId("deep-left-panel");
const right = () => screen.getByTestId("deep-right-panel");

// --------------------------------------------------------------------------- //
// ① ② ③ — the numbered hierarchy
// --------------------------------------------------------------------------- //

describe("the Figma numbered hierarchy", () => {
  it("puts ① 분석 범위 and ② 계산 모델 가중치 설정 in the controls column, in order", async () => {
    await enterDeepAnalysis();
    const scope = within(left()).getByTestId("suitability-scope");
    const basis = within(left()).getByTestId("scoring-basis");
    expect(within(scope).getByRole("heading", { name: "① 분석 범위" })).toBeDefined();
    expect(
      within(basis).getByRole("heading", { name: "② 계산 모델 가중치 설정" }),
    ).toBeDefined();
    // ① precedes ② in document order, as the numbering claims.
    expect(scope.compareDocumentPosition(basis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts ③ 종합 점수와 후보 순위 in the results column, holding BOTH the band and the ranking", async () => {
    await enterDeepAnalysis();
    const results = within(right()).getByTestId("suitability-results");
    expect(within(results).getByRole("heading", { name: "③ 종합 점수와 후보 순위" })).toBeDefined();
    await waitFor(() =>
      expect(within(results).getByTestId("relative-grade-panel")).toBeDefined(),
    );
    expect(within(results).getByTestId("top-candidates")).toBeDefined();
    // …and the numbered results card is not duplicated into the controls column.
    expect(within(left()).queryByTestId("suitability-results")).toBeNull();
  });

  it("states the analysis scope from SERVED counts and admits it cannot be narrowed", async () => {
    await enterDeepAnalysis();
    const scope = within(left()).getByTestId("suitability-scope");
    // The lead line names the served 시·도 without opening anything.
    const summary = within(scope).getByTestId("suitability-scope-summary").textContent ?? "";
    expect(summary).toContain("인천광역시");
    expect(summary).toContain("경기도");
    // The per-시·도 counts, verbatim from the served breakdown.
    const rows = within(scope).getAllByTestId("suitability-scope-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("인천광역시");
    expect(rows[0].textContent).toContain("400");
    // 경기도 served only an ELIGIBLE count — the statuses it did not serve are
    // absent, never printed as a 0 the UI invented.
    expect(rows[1].textContent).toContain("경기도");
    expect(rows[1].textContent).not.toContain("추가 검토 필요");
    expect(within(scope).getByTestId("suitability-scope-note").textContent).toContain(
      "시·군·구를 직접 골라 범위를 좁힐 수",
    );
  });

  it("renders NO ④ 시나리오 저장 or ⑤ 비교할 시나리오 선택 shell", async () => {
    await enterDeepAnalysis();
    // Their real storage/A-B behaviour is Page 4D. An inert shell would read as
    // broken, and a populated one would be fabricated (spec §10).
    const workspace = `${left().textContent ?? ""} ${right().textContent ?? ""}`;
    expect(workspace).not.toContain("시나리오 저장");
    expect(workspace).not.toContain("비교할 시나리오 선택");
    expect(workspace).not.toContain("A안");
    expect(workspace).not.toContain("B안");
  });
});

// --------------------------------------------------------------------------- //
// ② — the four factor cards
// --------------------------------------------------------------------------- //

describe("the four factor cards", () => {
  it("renders exactly one card per REAL component, named from the glossary", async () => {
    await enterDeepAnalysis();
    const cards = within(left()).getByTestId("factor-cards");
    expect(within(cards).getAllByRole("listitem")).toHaveLength(4);
    for (const component of COMPONENT_ORDER) {
      const card = within(cards).getByTestId(`factor-card-${component}`);
      expect(card.textContent, component).toContain(COMPONENT_META[component].primary);
      expect(card.textContent, component).toContain(COMPONENT_META[component].code);
    }
  });

  it("shows each card's SERVED weight, and the distribution bar drawn from the same rows", async () => {
    await enterDeepAnalysis();
    // The mocked run's baseline vector is 40/30/20/10 — the served numbers, not a
    // set this component chose.
    expect(screen.getByTestId("factor-weight-zoning").textContent).toContain("40%");
    expect(screen.getByTestId("factor-weight-road").textContent).toContain("30%");
    expect(screen.getByTestId("factor-weight-equity").textContent).toContain("20%");
    expect(screen.getByTestId("factor-weight-demand").textContent).toContain("10%");
    const bar = screen.getByTestId("weight-distribution-bar");
    expect(
      (within(bar).getByTestId("weight-segment-zoning") as HTMLElement).style.width,
    ).toBe("40%");
    // No Figma mock percentage is hard-coded anywhere in the bar.
    expect(bar.textContent).not.toContain("25%");
  });

  it("follows the profile radio rather than pinning one vector", async () => {
    await enterDeepAnalysis();
    fireEvent.click(screen.getByTestId("profile-radio-equal"));
    await waitFor(() =>
      expect(screen.getByTestId("factor-weight-zoning").textContent).toContain("25%"),
    );
  });

  it("shows the SELECTED candidate's component score, and no score before selection", async () => {
    await enterDeepAnalysis();
    expect(screen.getByTestId("factor-score-zoning").textContent).toContain("후보 미선택");
    fireEvent.click(within(screen.getByTestId("top-candidates")).getAllByTestId("top-candidate-item")[0]);
    await waitFor(() =>
      expect(screen.getByTestId("factor-score-zoning").textContent).toContain("90.0000"),
    );
    expect(screen.getByTestId("factor-score-equity").textContent).toContain("95.0000");
  });

  it("states the direction of each score, so 기존 지역 부담(E) cannot be read backwards", async () => {
    await enterDeepAnalysis();
    const equity = screen.getByTestId("factor-card-equity");
    expect(equity.textContent).toContain("점수가 높을수록 이미 지고 있는 폐기물 처리시설 부담이 적은");
    // The Figma label for this factor inverts it; it must not appear.
    expect(left().textContent).not.toContain("시설 부담 정도");
  });

  it("keeps D as PRESENT-DAY demand, never a future-generation forecast", async () => {
    await enterDeepAnalysis();
    const demand = screen.getByTestId("factor-card-demand");
    expect(demand.textContent).toContain("장래 발생량 예측이 아닙니다");
    const workspace = `${left().textContent ?? ""} ${right().textContent ?? ""}`;
    expect(workspace).not.toContain("장래 역내");
    expect(workspace).not.toContain("장래 발생량 :");
  });

  it("presents NO factor the model does not have", async () => {
    await enterDeepAnalysis();
    const workspace = `${left().textContent ?? ""} ${right().textContent ?? ""}`;
    for (const invented of [
      "주민 반응",
      "토지피복 기반 적합도",
      "토지이용 적합성",
      "도로 접근성",
    ]) {
      expect(workspace, invented).not.toContain(invented);
    }
  });
});

// --------------------------------------------------------------------------- //
// A/B/C — relative, never a screening outcome; and no pass mark anywhere
// --------------------------------------------------------------------------- //

describe("the A/B/C bands", () => {
  it("prints each band as a served percentile boundary, not a verdict", async () => {
    await enterDeepAnalysis();
    await waitFor(() => expect(screen.getByTestId("relative-grade-bands")).toBeDefined());
    const bands = screen.getByTestId("relative-grade-bands");
    expect(within(bands).getByTestId("relative-grade-row-A").textContent).toContain("상위 구간");
    expect(screen.getByTestId("relative-grade-range-A").textContent).toContain("57.811");
    expect(screen.getByTestId("relative-grade-range-B").textContent).toContain("47.6779");
    expect(screen.getByTestId("relative-grade-range-B").textContent).toContain("미만");
    expect(screen.getByTestId("relative-grade-range-C").textContent).toContain("미만");
    // The Figma frame maps the three bands onto the three screening statuses.
    // That mapping is false and must not appear inside the band rows.
    for (const verdict of ["스크리닝 통과", "추가 검토 필요", "스크리닝 제외"]) {
      expect(bands.textContent, verdict).not.toContain(verdict);
    }
  });

  it("keeps the official screening statuses on their OWN surface", async () => {
    await enterDeepAnalysis();
    // The statuses still exist — in the status summary, where they belong.
    expect(within(left()).getByTestId("candidate-counts").textContent).toContain("스크리닝 통과");
  });

  it("shows NO pass mark: there is no 60-point or 62-point rule in this model", async () => {
    await enterDeepAnalysis();
    const workspace = `${left().textContent ?? ""} ${right().textContent ?? ""}`;
    for (const claim of ["60점 이상", "62점", "점 이상 → ", "기준 점수 이상"]) {
      expect(workspace, claim).not.toContain(claim);
    }
  });

  it("carries no illustrative Figma value", async () => {
    await enterDeepAnalysis();
    const workspace = `${left().textContent ?? ""} ${right().textContent ?? ""}`;
    // The frame's mock winners and scores. The current model's theoretical maximum
    // is below 94, so these are not merely absent — they are impossible.
    for (const mock of ["94.8", "94.6", "89.3", "안산시", "시흥시", "고양시"]) {
      expect(workspace, mock).not.toContain(mock);
    }
  });
});

// --------------------------------------------------------------------------- //
// Stability
// --------------------------------------------------------------------------- //

describe("stability in card ②", () => {
  it("states the THREE-profile rule and reports the canonical state", async () => {
    await enterDeepAnalysis();
    const row = within(left()).getByTestId("scoring-basis-stability");
    expect(row.textContent).toContain("세 계산식 모두에서 상위 10%");
    expect(row.textContent).not.toContain("네 계산식");
    expect(row.textContent).toContain("꺼져 있습니다");
    // Flipping the ONE canonical control updates this report.
    fireEvent.click(screen.getByTestId("stable-only-toggle"));
    await waitFor(() =>
      expect(
        within(left()).getByTestId("scoring-basis-stability").textContent,
      ).toContain("켜져 있습니다"),
    );
  });

  it("does not add a second stable-only control", async () => {
    const { container } = await enterDeepAnalysis();
    expect(container.querySelectorAll('[data-testid="stable-only-toggle"]')).toHaveLength(1);
    // And card ② carries no checkbox of its own.
    expect(
      within(left()).getByTestId("scoring-basis").querySelectorAll('input[type="checkbox"]'),
    ).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------- //
// Ranking, map, candidate detail
// --------------------------------------------------------------------------- //

describe("the restyled ranking", () => {
  it("says a row is a candidate CELL located in a 시·군·구, not the 시·군·구 itself", async () => {
    await enterDeepAnalysis();
    const list = screen.getByTestId("top-candidates");
    const rows = within(list).getAllByTestId("top-candidate-item");
    expect(rows[0].textContent).toContain("강화군");
    expect(rows[0].textContent).toContain("500m 후보 구역");
    expect(rows[0].textContent).toContain("1위");
    expect(rows[0].textContent).toContain("88.1234점");
    // Said once, in words, so the row's own compact label cannot be read as a
    // score for the whole municipality.
    expect(within(list).getByTestId("candidate-list-map-hint").textContent).toContain(
      "시·군·구 자체가 아니라",
    );
  });

  it("keeps the candidate detail reachable from the ranking", async () => {
    await enterDeepAnalysis();
    fireEvent.click(within(screen.getByTestId("top-candidates")).getAllByTestId("top-candidate-item")[0]);
    const detail = await screen.findByTestId("candidate-detail");
    expect(detail.textContent).toContain("강화군");
    expect(detail.textContent).toContain("88.1234");
    expect(within(right()).getByTestId("candidate-detail")).toBe(detail);
  });

  it("keeps the map mounted, and the same node, across both panel collapses", async () => {
    await enterDeepAnalysis();
    const mapNode = screen.getByTestId("map-container");
    fireEvent.click(screen.getByTestId("deep-left-panel-toggle"));
    fireEvent.click(screen.getByTestId("deep-right-panel-toggle"));
    expect(screen.getByTestId("map-container")).toBe(mapNode);
    expect(screen.getAllByTestId("map-container")).toHaveLength(1);
    // The restyled sections survive reopening, still in their columns.
    fireEvent.click(screen.getByTestId("deep-left-panel-toggle"));
    expect(within(left()).getByTestId("factor-cards")).toBeDefined();
  });
});
