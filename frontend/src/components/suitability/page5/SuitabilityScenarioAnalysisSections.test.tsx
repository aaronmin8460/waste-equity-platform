// @vitest-environment jsdom

/**
 * Page-5 integration — the two analytical lanes composed under ONE foundation.
 *
 * Page 5B and Page 5C were built independently from the same base, so nothing in
 * either lane's own suite can prove what happens when they share a page. These
 * assertions pin exactly that: that both render from a single {@link ScenarioComparison},
 * that composing them issues NO scenario preview request of its own, that the ranking
 * model is derived once and reaches the XLSX export, and that the workbook stops
 * claiming to be single-candidate the moment the ranking sheet is in it.
 */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub(props: { candidateTileUrl: string | null; ariaLabel: string }) {
      return <div data-testid="map-container" data-tile-url={props.candidateTileUrl ?? ""} aria-label={props.ariaLabel} />;
    },
}));

// Both preview and candidate-detail are spied: the preview spy is the one that must
// never fire, because Page 5A already made those two calls.
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    previewUserWeightScenario: vi.fn(),
    fetchUserScenarioCandidateDetail: vi.fn(),
  };
});

const downloadSpy = vi.fn(async () => "file.xlsx");
vi.mock("../../../lib/xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/xlsx")>();
  return { ...actual, downloadXlsx: (...args: unknown[]) => downloadSpy(...(args as [])) };
});

import * as api from "../../../lib/api";
import type {
  UserScenarioCandidateDetail,
  UserScenarioPreview,
  UserScenarioTopCandidate,
  UserScenarioWeights,
} from "../../../lib/api";
import type { ComparisonSide, ScenarioComparison } from "../../../lib/scenarioComparison";
import SuitabilityScenarioAnalysisSections from "./SuitabilityScenarioAnalysisSections";

/**
 * A sealed sheet as this test reads it. `AnyXlsxSheet` erases the row type (that is
 * what lets one workbook hold differently-shaped sheets), so inspection goes through
 * a local structural type — the same approach Page 5C's own export test takes.
 */
interface InspectedSheet {
  name: string;
  preamble: string[];
  columns: { header: string; value: (row: unknown) => unknown }[];
  rows: unknown[];
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

const WEIGHTS: UserScenarioWeights = {
  zoning: "0.40000000",
  road: "0.30000000",
  equity: "0.20000000",
  demand: "0.10000000",
};

function candidate(key: string, rank: number, score: string): UserScenarioTopCandidate {
  return {
    candidate_id: rank,
    candidate_key: key,
    sido_region_code: "KR-SGIS-23",
    sido_region_name: "인천광역시",
    sigungu_region_code: "KR-SGIS-23510",
    sigungu_region_name: "인천광역시 강화군",
    custom_score: score,
    custom_rank: rank,
    comparison_profile: "baseline",
    // The side's own against-baseline columns. If any of these ever surfaced as the
    // A/B result, 999 / 900 would show up in the assertions below.
    comparison_score: "0.1111",
    comparison_rank: 999,
    rank_delta: 900,
    rank_change_direction: "up",
    zoning_score: "0.8000",
    road_score: "0.7000",
    equity_score: "0.6000",
    demand_score: "0.5000",
    stable_count: 3,
    stability_class: "STABLE",
    centroid_lon: 126.8,
    centroid_lat: 37.4,
  };
}

function preview(rows: UserScenarioTopCandidate[]): UserScenarioPreview {
  return {
    scenario_hash: "hash",
    scenario_hash_short: "hash",
    method_version: "scenario-v1",
    run_id: 47,
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    canonical_weights: WEIGHTS,
    compare_profile: "baseline",
    candidate_count_total: 1000,
    candidate_count_eligible: 500,
    candidate_count_review: 300,
    candidate_count_excluded: 200,
    ranking_population: 500,
    top_candidates: rows,
    selected_candidate: null,
    tile_url: "/tiles",
    assumptions: [],
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "임시 비교 결과입니다.",
    screening_disclaimer: "광역 분석 스크리닝",
  };
}

function side(slot: "A" | "B", value: UserScenarioPreview | null): ComparisonSide {
  return {
    slot,
    scenarioId: `sc-${slot.toLowerCase()}`,
    scenarioName: slot === "A" ? "균형안" : "형평성안",
    savedScenario: null,
    canonicalWeights: value?.canonical_weights ?? null,
    runId: value?.run_id ?? null,
    preview: value,
    state: value === null ? "PREVIEW_ERROR" : "READY",
    errorMessage: null,
  };
}

function comparison(
  a: UserScenarioPreview | null,
  b: UserScenarioPreview | null,
): ScenarioComparison {
  return {
    runId: 47,
    sideA: side("A", a),
    sideB: side("B", b),
    status: a !== null && b !== null ? "READY" : "PREVIEW_ERROR_BOTH",
    loading: false,
  };
}

function ranked(keys: string[]): UserScenarioTopCandidate[] {
  return keys.map((key, index) => candidate(key, index + 1, (1 - index * 0.01).toFixed(4)));
}

const A_ROWS = ranked(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10"]);
// c1 falls to 10th, c11 enters, c10 drops out of B's list entirely.
const B_ROWS = ranked(["c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c11", "c1"]);

const READY = comparison(preview(A_ROWS), preview(B_ROWS));

/** A served candidate detail for `c1` — the cell the export tests select. */
function detail(score: string, weight: string): UserScenarioCandidateDetail {
  return {
    candidate_id: 1,
    run_id: 47,
    candidate_key: "c1",
    status: "ELIGIBLE",
    is_excluded: false,
    method_version: "scenario-v1",
    scenario_hash: "hash",
    scenario_hash_short: "hash",
    canonical_weights: WEIGHTS,
    compare_profile: "baseline",
    custom_score: score,
    custom_provisional_score: null,
    custom_rank: 1,
    comparison_score: "70.0000",
    comparison_rank: 3,
    rank_delta: 2,
    rank_change_direction: "up",
    zoning_score: "55.0000",
    road_score: "100.0000",
    equity_score: "100.0000",
    demand_score: "50.0000",
    contributions: [
      { component: "zoning", component_score: "55.0000", weight, weighted_contribution: "13.7500" },
      { component: "road", component_score: "100.0000", weight, weighted_contribution: "25.0000" },
      { component: "equity", component_score: "100.0000", weight, weighted_contribution: "25.0000" },
      { component: "demand", component_score: "50.0000", weight, weighted_contribution: "12.5000" },
    ],
    stable_count: 3,
    stability_class: "STABLE",
    stability_membership: {},
    profile_totals: {},
    profile_ranks: {},
    sido_region_code: "KR-SGIS-23",
    sido_region_name: "인천광역시",
    sigungu_region_code: "KR-SGIS-23510",
    sigungu_region_name: "인천광역시 강화군",
    exclusion_reasons: [],
    review_reasons: [],
    penalties: [],
    raw_components: {},
    nearest_road_distance_m: "120.0",
    nearest_road_provenance: {},
    component_provenance: {},
    centroid_lon: 126.8,
    centroid_lat: 37.4,
    geometry: { type: "Point", coordinates: [126.8, 37.4] },
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "임시 비교 결과입니다.",
    screening_disclaimer: "광역 분석 스크리닝",
  };
}

/** Serve both sides, then select `c1` (candidate_id 1) and wait for the export. */
async function pickC1() {
  vi.mocked(api.fetchUserScenarioCandidateDetail).mockImplementation(async () =>
    detail("76.2500", "0.25000000"),
  );
  fireEvent.change(screen.getByTestId("scenario-candidate-picker"), { target: { value: "1" } });
  await waitFor(() => expect(screen.getByTestId("scenario-candidate-export")).toBeEnabled());
}

// --------------------------------------------------------------------------- //
// Both lanes, one comparison
// --------------------------------------------------------------------------- //

describe("Page-5 composition", () => {
  it("renders the Page-5B ranking sections and the Page-5C candidate section together", () => {
    render(<SuitabilityScenarioAnalysisSections comparison={READY} />);

    // Page 5B
    expect(screen.getByTestId("scenario-ranking-analytics")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-ranking-slope-card")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-ranking-movement-card")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-ranking-table-card")).toBeInTheDocument();

    // Page 5C
    expect(screen.getByTestId("scenario-candidate-comparison")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-candidate-detail")).toBeInTheDocument();
  });

  it("draws the ranking analytics ABOVE the candidate section", () => {
    render(<SuitabilityScenarioAnalysisSections comparison={READY} />);
    const ranking = screen.getByTestId("scenario-ranking-analytics");
    const candidateSection = screen.getByTestId("scenario-candidate-comparison");
    // Node.DOCUMENT_POSITION_FOLLOWING — the candidate section comes after.
    expect(ranking.compareDocumentPosition(candidateSection) & 4).toBeTruthy();
  });

  it("issues NO scenario preview request — Page 5A already made both", () => {
    render(<SuitabilityScenarioAnalysisSections comparison={READY} />);
    expect(api.previewUserWeightScenario).not.toHaveBeenCalled();
  });

  it("renders no ranking sections when the comparison has no truthful model", () => {
    render(<SuitabilityScenarioAnalysisSections comparison={comparison(preview(A_ROWS), null)} />);
    expect(screen.queryByTestId("scenario-ranking-analytics")).not.toBeInTheDocument();
  });

  it("keeps the frame's screening vocabulary off the composed page", () => {
    render(<SuitabilityScenarioAnalysisSections comparison={READY} />);
    const text = document.body.textContent ?? "";
    for (const banned of ["통과 지역", "신규 통과", "통과 → 제외", "62점", "60점 이상", "주민 반응"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("never prints either side's against-baseline columns as the A/B result", () => {
    render(<SuitabilityScenarioAnalysisSections comparison={READY} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("999");
    expect(text).not.toContain("900계단");
  });
});

// --------------------------------------------------------------------------- //
// The export seam
// --------------------------------------------------------------------------- //

/** Trigger the workbook download and return the sheets handed to `downloadXlsx`. */
async function exportedSheets(): Promise<InspectedSheet[]> {
  await pickC1();
  fireEvent.click(screen.getByTestId("scenario-candidate-export"));
  await waitFor(() => expect(downloadSpy).toHaveBeenCalled());
  const [, sheets] = downloadSpy.mock.calls[0] as unknown as [string, InspectedSheet[]];
  return sheets;
}

/** The filename handed to `downloadXlsx` by the most recent export. */
function exportedFilename(): string {
  const [filename] = downloadSpy.mock.calls[0] as unknown as [string, InspectedSheet[]];
  return filename;
}

describe("Page-5B ranking data in the Page-5C workbook", () => {
  it("appends the ranking sheet after Page 5C's three sheets", async () => {
    render(<SuitabilityScenarioAnalysisSections comparison={READY} />);
    const sheets = await exportedSheets();

    expect(sheets.map((sheet) => sheet.name)).toEqual([
      "비교 조건",
      "선택 후보 구역",
      "평가 요소별 기여도",
      "시나리오 순위 비교",
    ]);
  });

  it("writes the ranking rows from the SAME model the table shows", async () => {
    render(<SuitabilityScenarioAnalysisSections comparison={READY} />);
    const sheets = await exportedSheets();
    const ranking = sheets[3];

    const keys = ranking.rows.map((row) => ranking.columns[0].value(row));
    // The union of both served lists — c11 is in B only, c10 in A only.
    expect(keys).toContain("c1");
    expect(keys).toContain("c10");
    expect(keys).toContain("c11");

    // c1: rank 1 under A, rank 10 under B.
    const c1 = ranking.rows.find((row) => ranking.columns[0].value(row) === "c1");
    expect(ranking.columns[2].value(c1)).toBe(1);
    expect(ranking.columns[3].value(c1)).toBe(10);
    expect(ranking.columns[4].value(c1)).toBe("↓ 9계단");
  });

  it("marks a candidate outside the other side's preview instead of inventing a rank", async () => {
    render(<SuitabilityScenarioAnalysisSections comparison={READY} />);
    const sheets = await exportedSheets();
    const ranking = sheets[3];

    // c10 is 10th under A and absent from B's served list.
    const c10 = ranking.rows.find((row) => ranking.columns[0].value(row) === "c10");
    const bRank = ranking.columns[3].value(c10);
    expect(typeof bRank).toBe("string");
    expect(bRank).toContain("밖");
    // Never a number standing in for the absence.
    expect(bRank).not.toBe(11);
    expect(bRank).not.toBe(500);
    expect(ranking.columns[4].value(c10)).toBe("미제공");
  });

  it("carries no screening column and no invented threshold", async () => {
    render(<SuitabilityScenarioAnalysisSections comparison={READY} />);
    const sheets = await exportedSheets();
    const ranking = sheets[3];

    const headers = ranking.columns.map((column) => column.header).join(" ");
    for (const banned of ["통과", "제외", "스크리닝", "판정"]) {
      expect(headers).not.toContain(banned);
    }
    const preamble = ranking.preamble.join(" ");
    expect(preamble).toContain("스크리닝");
    // ...only as the standing limit, never as a changed count.
    expect(preamble).toContain("가중치를 바꿔도 달라지지 않습니다");
    expect(preamble).not.toContain("신규 통과");
  });

  it("states the widened scope once the ranking sheet is attached", async () => {
    render(<SuitabilityScenarioAnalysisSections comparison={READY} />);
    const sheets = await exportedSheets();

    for (const sheet of sheets.slice(0, 3)) {
      const preamble = sheet.preamble.join(" ");
      // The single-candidate claim would now be false for the assembled workbook.
      expect(preamble).not.toContain("비교만 포함합니다");
      expect(preamble).not.toContain("전체 후보 구역에 대한 비교나 순위 분석이 아닙니다");
      expect(preamble).toContain("순위 비교");
    }
  });

  it("names the ranking sheet in the filename, without dropping the candidate scope", async () => {
    render(<SuitabilityScenarioAnalysisSections comparison={READY} />);
    await exportedSheets();

    const filename = exportedFilename();
    // Still built around one cell, and now says the ranking sheet is in there too.
    expect(filename).toContain("단일후보");
    expect(filename).toContain("순위비교");
    expect(filename).toContain("run47");
  });

  it("prints the same widened scope next to the button the reader presses", async () => {
    render(<SuitabilityScenarioAnalysisSections comparison={READY} />);
    await pickC1();
    const scope = screen.getByTestId("scenario-candidate-export-scope");
    expect(scope).toHaveTextContent("후보 구역 1곳");
    expect(scope).toHaveTextContent("순위 비교");
    expect(scope).not.toHaveTextContent("전체 후보 구역에 대한 비교나 순위 분석이 아닙니다");
  });
});
