// @vitest-environment jsdom

/**
 * Phase 0 — suitability screening transparency, terminology, and disclosure.
 *
 * These drive the REAL page (the shared `homeApiMock` serves a suitability run +
 * summary) and assert the presentation-only Phase 0 guarantees:
 *
 *   1. the analytical-screening disclaimer is visible near the top of EVERY 후보지
 *      분석 sub-view (후보지 점수 / 가중치 바꿔보기 / 비용 살펴보기), without opening
 *      any disclosure;
 *   2. it is NOT shown as a claim about the equity map's calculations (it is absent
 *      in the default 지역 부담 view);
 *   3. the revised citizen-facing status labels and component terminology are used;
 *   4. the status meanings and the "현재 분석에 포함되지 않은 항목" disclosure are
 *      present, including inside the candidate detail panel.
 *
 * Nothing here asserts a score, weight, rank, or count value changed — Phase 0 only
 * renames and discloses. The counts the mock serves are read back verbatim.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STATUS_META,
  SUITABILITY_SCREENING_DISCLAIMER,
  SUITABILITY_SCREENING_SHORT_LABEL,
  UNMODELED_SUITABILITY_TITLE,
} from "../lib/glossary";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub() {
      return <div data-testid="map-container" />;
    },
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const { homeApiMock } = await import("./homeApiMock");
  // `homeApiMock` does not stub the candidate-detail fetch (its summary serves an
  // empty top-candidate list). This suite serves one clickable candidate, so it
  // needs the detail fetch to be a spy it can resolve with a fixture.
  return { ...homeApiMock(actual), fetchSuitabilityCandidateDetail: vi.fn() };
});

import Home from "./page";
import * as api from "../lib/api";
import { rankingCollection } from "./homeApiMock";

function setUrl(query: string) {
  window.history.replaceState(null, "", `/${query}`);
}

async function renderLoaded() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  return utils;
}

async function enterSuitability() {
  await renderLoaded();
  fireEvent.click(screen.getByTestId("mode-suitability"));
  await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
}

afterEach(() => {
  cleanup();
  setUrl("");
});

beforeEach(() => {
  vi.clearAllMocks();
});

// INTEGRATED CONTRACT. Every suitability sub-view still carries the screening
// limitation, but no longer all by the same surface: 가중치 바꿔보기 and 후보지
// 심층 비교 keep the full standing banner, 후보지 점수 carries it on the map legend
// plus the run's own served disclaimer (Page-4 remediation), and 비용 살펴보기
// carries it inside 계산 방법과 한계 (Page-3 remediation). The limitation is never
// dropped — only the surface differs, per sub-view, for the reason each test states.
describe("Phase 0 — the screening limitation is carried in every suitability sub-view", () => {
  it("carries the screening limitation in 후보지 점수 without a banner", async () => {
    await enterSuitability();
    // THE BANNER IS GONE from 후보지 점수 (Figma 136:8684 opens the left column with
    // ① and nothing above it; the full-width notice was the wall of text the Page-4
    // remediation removed). The LIMITATION is not gone: this sub-view is the only
    // one with a map legend, and the legend prints the short form permanently,
    // beside the candidates it qualifies.
    expect(screen.queryByTestId("suitability-screening-disclaimer")).toBeNull();
    // The map legend carries the short form beside the candidates it qualifies…
    expect(screen.getByTestId("suitability-legend-note").textContent).toContain(
      SUITABILITY_SCREENING_SHORT_LABEL,
    );
    // …and the run's OWN served disclaimer stays in 계산 방법과 가정, visible with no
    // interaction at all — not behind a <details>.
    const served = screen.getByTestId("suitability-disclaimer");
    expect(served.closest("details")).toBeNull();
    expect(served.textContent).not.toBe("");
  });

  it("keeps the full disclaimer visible in 가중치 바꿔보기", async () => {
    await enterSuitability();
    fireEvent.click(screen.getByTestId("suitability-view-scenario"));
    await waitFor(() =>
      expect(screen.getByTestId("suitability-screening-disclaimer")).toBeDefined(),
    );
    expect(screen.getByTestId("suitability-screening-disclaimer").textContent).toContain(
      "광역 후보지 스크리닝",
    );
  });

  it("moves the disclaimer into 계산 방법과 한계 in 비용 살펴보기, without dropping it", async () => {
    // 비용 살펴보기 is the documented EXCEPTION to "visible in every suitability
    // sub-view" (docs/SUITABILITY_PHASE_0_TRANSPARENCY.md §"비용 살펴보기"). That
    // sub-view presents a COST estimate rather than a candidate-suitability claim,
    // and its redesign (Figma 129:5709) requires a primary workflow free of
    // disclaimer blocks. The sentence is unchanged and one click away; its own
    // 표준공사비 caveat stays on the screen in its place.
    await enterSuitability();
    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-workflow")).toBeDefined());
    expect(screen.queryByTestId("suitability-screening-disclaimer")).toBeNull();
    expect(screen.getByTestId("facility-cost-result-footnote").textContent).toContain(
      "표준공사비 기준 참고용 추정치",
    );

    fireEvent.click(screen.getByTestId("facility-cost-open-details"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-notice")).toBeDefined());
    expect(screen.getByTestId("facility-cost-notice").textContent).toContain(
      "광역 후보지 스크리닝",
    );
  });

  it("is a neutral informational notice, not an alert, and labels its severity by text", async () => {
    await enterSuitability();
    // 후보지 점수 no longer carries the banner (see above), so this contract is
    // exercised where the banner still lives: 후보지 심층 비교.
    fireEvent.click(screen.getByTestId("suitability-view-scenario"));
    await waitFor(() =>
      expect(screen.getByTestId("suitability-screening-disclaimer")).toBeDefined(),
    );
    const notice = screen.getByTestId("suitability-screening-disclaimer");
    // Not role="alert" (a standing disclaimer must not interrupt a screen reader).
    expect(notice.getAttribute("role")).not.toBe("alert");
    // Severity is carried by a text label, never color/icon alone.
    expect(screen.getByTestId("suitability-screening-disclaimer-tone").textContent).toContain(
      "알림",
    );
    // Reachable inside a screen-reader landmark.
    expect(screen.getByRole("region", { name: "후보지 분석 안내" })).toBeDefined();
  });

  it("does NOT show the screening disclaimer over the equity map (not an equity claim)", async () => {
    await renderLoaded();
    // Default 지역 부담 view.
    expect(screen.queryByTestId("suitability-screening-disclaimer")).toBeNull();
    expect(screen.queryByTestId("suitability-screening-notice")).toBeNull();
  });
});

describe("Phase 0 — revised terminology and status meanings", () => {
  it("uses the revised status labels in the candidate counts", async () => {
    await enterSuitability();
    const counts = screen.getByTestId("candidate-counts").textContent ?? "";
    expect(counts).toContain("스크리닝 통과");
    expect(counts).toContain("추가 검토 필요");
    expect(counts).toContain("프로젝트 스크리닝 제외");
    // The raw enum never leaks.
    expect(counts).not.toContain("ELIGIBLE");
    expect(counts).not.toContain("EXCLUDED");
  });

  it("explains each status from the shared source of truth", async () => {
    await enterSuitability();
    const el = screen.getByTestId("status-explanation-ELIGIBLE").textContent ?? "";
    expect(el).toContain(STATUS_META.ELIGIBLE.primary);
    expect(el).toContain("법적 허가 또는 실제 건설 가능성을 의미하지 않습니다");
    expect(screen.getByTestId("status-explanation-EXCLUDED").textContent).toContain(
      "법률상 최종 금지 판정을 의미하지 않습니다",
    );
  });

  it("uses '용도지역 호환성' and '도로 근접성 대리지표' (not the misleading terms)", async () => {
    await enterSuitability();
    const aside = document.querySelector("aside");
    const text = aside?.textContent ?? "";
    expect(text).toContain("용도지역 호환성");
    expect(text).toContain("도로 근접성 대리지표");
    // The misleading originals are gone from the suitability sidebar.
    expect(text).not.toContain("토지이용 적합성");
    expect(text).not.toContain("도로 접근성");
  });

  it("discloses the not-yet-included items in the score-view methodology", async () => {
    await enterSuitability();
    const disclosure = screen.getByTestId("suitability-unmodeled-factors");
    expect(within(disclosure).getByText(UNMODELED_SUITABILITY_TITLE)).toBeDefined();
    const items = within(disclosure).getByTestId("suitability-unmodeled-factors-list").textContent ?? "";
    expect(items).toContain("경사 및 정밀 지형");
    expect(items).toContain("필지 소유권과 취득 가능성");
    // Never fabricates a value or a completion percentage.
    expect(disclosure.textContent).toContain("0점 또는 안전한 조건으로 간주하지 않습니다");
    expect(disclosure.textContent).not.toMatch(/\d+%/);
  });
});

describe("Phase 0 — candidate detail carries the meaning + limitations", () => {
  /** A minimal ELIGIBLE candidate the mock will serve when clicked. */
  const CANDIDATE_DETAIL: api.CandidateDetail = {
    candidate_id: 501,
    candidate_key: "cap500-000501",
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
    run_id: 48,
    profile_totals: { baseline: "88.1234" },
    profile_ranks: { baseline: 1 },
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
    weights: { zoning: "0.35", road: "0.25", equity: "0.25", demand: "0.15" },
    disclaimer: "Analytical screening only — not a legal determination.",
  };

  it("shows the status meaning, the '현재 분석에 포함되지 않은 항목' disclosure, and revised component labels", async () => {
    // Serve one clickable top candidate and its detail, on top of the shared mock.
    const TOP = [
      {
        candidate_id: 501,
        rank: 1,
        sigungu: "강화군",
        total_score: "88.1234",
        stability_class: "STABLE",
        stable_count: 3,
      },
    ];
    const baseSummary = await api.fetchSuitabilitySummary("baseline");
    vi.mocked(api.fetchSuitabilitySummary).mockResolvedValue({
      ...baseSummary,
      top_candidates: TOP,
    });
    // ③ renders the SCOPED ranking from `/suitability/candidates` — the same row.
    vi.mocked(api.fetchSuitabilityCandidates).mockResolvedValue(
      rankingCollection(TOP) as unknown as api.SuitabilityCandidateCollection,
    );
    vi.mocked(api.fetchSuitabilityCandidateDetail).mockResolvedValue(CANDIDATE_DETAIL);

    await enterSuitability();
    await waitFor(() => expect(screen.getByTestId("candidate-ranking-counts")).toBeDefined());
    fireEvent.click(screen.getByTestId("top-candidate-item"));
    const detail = await screen.findByTestId("candidate-detail");

    // Status meaning is shown, not left to inference.
    expect(within(detail).getByTestId("candidate-status-explanation").textContent).toContain(
      "다음 단계 검토 대상",
    );
    // Component labels use the Phase 0 citizen terms.
    expect(detail.textContent).toContain("용도지역 호환성");
    expect(detail.textContent).toContain("도로 근접성 대리지표");
    // The not-yet-included disclosure is inside the candidate detail.
    const disclosure = within(detail).getByTestId("candidate-unmodeled-factors");
    expect(within(disclosure).getByText(UNMODELED_SUITABILITY_TITLE)).toBeDefined();
  });
});
