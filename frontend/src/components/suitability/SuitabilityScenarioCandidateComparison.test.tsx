// @vitest-environment jsdom

/**
 * Page 5C — the selected candidate, its A/B contributions, the A/B map, and the export.
 *
 * These assertions pin the behaviours a reader would be misled by if they broke:
 * that no candidate is chosen on their behalf, that a rank the bounded preview did not
 * carry is never printed as a number, that toggling A/B keeps ONE map instance and the
 * SAME cell, that a map failure does not take the contribution table with it, and that
 * the screening legend is not reinterpreted as an A/B pass/fail.
 *
 * Every fixture is synthetic and carries no official label.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The map is client-only via `next/dynamic`; the stub reports the tile URL and the
// selected candidate it was given, so the A/B toggle can be shown to re-point the
// SOURCE on the same DOM node rather than remount a second map.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub(props: {
      candidateTileUrl: string | null;
      selectedCandidate: { candidate_id: number } | null;
      ariaLabel: string;
    }) {
      return (
        <div
          data-testid="map-container"
          data-tile-url={props.candidateTileUrl ?? ""}
          data-selected={props.selectedCandidate?.candidate_id ?? ""}
          aria-label={props.ariaLabel}
        />
      );
    },
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, fetchUserScenarioCandidateDetail: vi.fn() };
});

const downloadSpy = vi.fn(async () => "file.xlsx");
vi.mock("../../lib/xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/xlsx")>();
  return { ...actual, downloadXlsx: (...args: unknown[]) => downloadSpy(...(args as [])) };
});

import * as api from "../../lib/api";
import type {
  UserScenarioCandidateDetail,
  UserScenarioPreview,
  UserScenarioTopCandidate,
  UserScenarioWeights,
} from "../../lib/api";
import type { ComparisonSide, ScenarioComparison } from "../../lib/scenarioComparison";
import SuitabilityScenarioCandidateComparison from "./SuitabilityScenarioCandidateComparison";

const WEIGHTS_A: UserScenarioWeights = {
  zoning: "0.25000000",
  road: "0.25000000",
  equity: "0.25000000",
  demand: "0.25000000",
};
const WEIGHTS_B: UserScenarioWeights = {
  zoning: "0.10000000",
  road: "0.20000000",
  equity: "0.30000000",
  demand: "0.40000000",
};

function topCandidate(overrides: Partial<UserScenarioTopCandidate> = {}): UserScenarioTopCandidate {
  return {
    candidate_id: 11,
    candidate_key: "CELL-0011",
    sido_region_code: "KR-SGIS-31",
    sido_region_name: "경기도",
    sigungu_region_code: "KR-SGIS-31-390",
    sigungu_region_name: "시흥시",
    custom_score: "76.2500",
    custom_rank: 1,
    comparison_profile: "baseline",
    comparison_score: "70.0000",
    comparison_rank: 3,
    rank_delta: 2,
    rank_change_direction: "up",
    zoning_score: "55.0000",
    road_score: "100.0000",
    equity_score: "100.0000",
    demand_score: "50.0000",
    component_scores: {},
    stable_count: 3,
    stability_class: "STABLE",
    centroid_lon: 126.8,
    centroid_lat: 37.4,
    ...overrides,
  };
}

function preview(
  weights: UserScenarioWeights,
  hash: string,
  rows: UserScenarioTopCandidate[],
): UserScenarioPreview {
  return {
    scenario_hash: `${hash}-full`,
    scenario_hash_short: hash,
    method_version: "scenario-v1",
    run_id: 47,
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    component_model_version: "suitability-components-zred-v1",
    component_order: ["zoning", "road", "equity", "demand"],
    canonical_weights: weights,
    compare_profile: "baseline",
    candidate_count_total: 100,
    candidate_count_eligible: 10,
    candidate_count_review: 40,
    candidate_count_excluded: 50,
    ranking_population: 9212,
    top_candidates: rows,
    selected_candidate: null,
    tile_url: "/tiles",
    assumptions: [],
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "임시 비교 결과입니다.",
    screening_disclaimer: "광역 분석 스크리닝",
  };
}

function side(
  slot: "A" | "B",
  name: string,
  weights: UserScenarioWeights,
  hash: string,
  rows: UserScenarioTopCandidate[],
  overrides: Partial<ComparisonSide> = {},
): ComparisonSide {
  return {
    slot,
    scenarioId: `sc-${slot.toLowerCase()}`,
    scenarioName: name,
    savedScenario: null,
    canonicalWeights: weights,
    runId: 47,
    preview: preview(weights, hash, rows),
    state: "READY",
    errorMessage: null,
    ...overrides,
  };
}

function comparison(overrides: Partial<ScenarioComparison> = {}): ScenarioComparison {
  return {
    runId: 47,
    sideA: side("A", "균형안", WEIGHTS_A, "hasha", [topCandidate()]),
    sideB: side("B", "형평성안", WEIGHTS_B, "hashb", [topCandidate({ custom_rank: 2, custom_score: "75.5000" })]),
    status: "READY",
    loading: false,
    ...overrides,
  };
}

function detail(
  weights: UserScenarioWeights,
  score: string,
  contributions: UserScenarioCandidateDetail["contributions"],
  overrides: Partial<UserScenarioCandidateDetail> = {},
): UserScenarioCandidateDetail {
  return {
    candidate_id: 11,
    run_id: 47,
    candidate_key: "CELL-0011",
    status: "ELIGIBLE",
    is_excluded: false,
    method_version: "scenario-v1",
    scenario_hash: "hash",
    scenario_hash_short: "hash",
    canonical_weights: weights,
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
    contributions,
    component_scores: {},
    stable_count: 3,
    stability_class: "STABLE",
    stability_membership: {},
    profile_totals: {},
    profile_ranks: {},
    sido_region_code: "KR-SGIS-31",
    sido_region_name: "경기도",
    sigungu_region_code: "KR-SGIS-31-390",
    sigungu_region_name: "시흥시",
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
    component_model_version: "suitability-components-zred-v1",
    component_order: ["zoning", "road", "equity", "demand"],
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "임시 비교 결과입니다.",
    screening_disclaimer: "광역 분석 스크리닝",
    ...overrides,
  };
}

const DETAIL_A = detail(WEIGHTS_A, "76.2500", [
  { component: "zoning", component_score: "55.0000", weight: "0.25000000", weighted_contribution: "13.7500" },
  { component: "road", component_score: "100.0000", weight: "0.25000000", weighted_contribution: "25.0000" },
  { component: "equity", component_score: "100.0000", weight: "0.25000000", weighted_contribution: "25.0000" },
  { component: "demand", component_score: "50.0000", weight: "0.25000000", weighted_contribution: "12.5000" },
]);
const DETAIL_B = detail(WEIGHTS_B, "75.5000", [
  { component: "zoning", component_score: "55.0000", weight: "0.10000000", weighted_contribution: "5.5000" },
  { component: "road", component_score: "100.0000", weight: "0.20000000", weighted_contribution: "20.0000" },
  { component: "equity", component_score: "100.0000", weight: "0.30000000", weighted_contribution: "30.0000" },
  { component: "demand", component_score: "50.0000", weight: "0.40000000", weighted_contribution: "20.0000" },
]);

/** Answer each side's request with the detail matching the weights it sent. */
function respondPerSide() {
  vi.mocked(api.fetchUserScenarioCandidateDetail).mockImplementation(
    async (_id, request) => (request.weights.zoning === WEIGHTS_A.zoning ? DETAIL_A : DETAIL_B),
  );
}

/** Select the only offered candidate. */
function pickCandidate() {
  fireEvent.change(screen.getByTestId("scenario-candidate-picker"), { target: { value: "11" } });
}

beforeEach(() => {
  downloadSpy.mockClear();
  vi.mocked(api.fetchUserScenarioCandidateDetail).mockReset();
});

// Vitest globals are off in this repo, so RTL's auto-cleanup never registers.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------- //

describe("candidate selection", () => {
  it("chooses NO candidate on the reader's behalf and prompts instead", () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    expect(screen.getByTestId("scenario-candidate-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-candidate-contribution")).not.toBeInTheDocument();
    // A Figma mock names 시흥시; nothing may be requested before a choice is made.
    expect(api.fetchUserScenarioCandidateDetail).not.toHaveBeenCalled();
  });

  it("offers the served candidates and requests ONE detail per side once picked", async () => {
    respondPerSide();
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    pickCandidate();
    await waitFor(() => expect(api.fetchUserScenarioCandidateDetail).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(api.fetchUserScenarioCandidateDetail).mock.calls;
    // Each side sends its OWN canonical weights, against the ACTIVE run, with one
    // shared compare_profile so both responses describe the same baseline.
    expect(calls.map((c) => c[0])).toEqual([11, 11]);
    expect(calls.map((c) => c[1].weights)).toEqual([WEIGHTS_A, WEIGHTS_B]);
    expect(calls.every((c) => c[1].run_id === 47)).toBe(true);
    expect(new Set(calls.map((c) => c[1].compare_profile))).toEqual(new Set(["baseline"]));
  });

  it("seeds from a legacy ?cand= id without writing anything back", async () => {
    respondPerSide();
    render(
      <SuitabilityScenarioCandidateComparison comparison={comparison()} initialCandidateId={11} />,
    );
    await waitFor(() => expect(api.fetchUserScenarioCandidateDetail).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("scenario-candidate-empty")).not.toBeInTheDocument();
  });

  it("keeps candidate_key as the identity shown for the cell", async () => {
    respondPerSide();
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    pickCandidate();
    await waitFor(() =>
      expect(within(screen.getByTestId("scenario-candidate-side-a")).getByTestId("scenario-candidate-side-key")).toHaveTextContent(
        "CELL-0011",
      ),
    );
  });
});

describe("contribution comparison", () => {
  beforeEach(() => respondPerSide());

  it("shows the four model factors with the SERVED contributions and exact deltas", async () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    pickCandidate();
    await screen.findByTestId("scenario-candidate-contribution");

    const zoning = screen.getByTestId("scenario-candidate-contribution-row-zoning");
    expect(zoning).toHaveTextContent("용도지역 호환성");
    expect(within(zoning).getByTestId("scenario-candidate-contribution-a")).toHaveTextContent("13.7500");
    expect(within(zoning).getByTestId("scenario-candidate-contribution-b")).toHaveTextContent("5.5000");
    expect(within(zoning).getByTestId("scenario-candidate-contribution-delta")).toHaveTextContent("−8.2500");
    // Each side's weight is shown beside its own contribution.
    expect(within(zoning).getByTestId("scenario-candidate-contribution-a")).toHaveTextContent("25%");
    expect(within(zoning).getByTestId("scenario-candidate-contribution-b")).toHaveTextContent("10%");
  });

  it("totals the two served scores and their difference", async () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    pickCandidate();
    const total = await screen.findByTestId("scenario-candidate-contribution-total");
    expect(total).toHaveTextContent("76.2500");
    expect(total).toHaveTextContent("75.5000");
    expect(total).toHaveTextContent("−0.7500");
  });

  it("names the largest contribution change DESCRIPTIVELY, with no causal claim", async () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    pickCandidate();
    const impact = await screen.findByTestId("scenario-candidate-major-impact");
    expect(impact).toHaveTextContent("가중 기여도 변화가 가장 큰 요소");
    expect(impact).toHaveTextContent("용도지역 호환성");
    expect(impact).not.toHaveTextContent("때문에");
    expect(impact).not.toHaveTextContent("통과");
  });

  it("uses the model's factor names, never the Figma mock labels", async () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    pickCandidate();
    const table = await screen.findByTestId("scenario-candidate-contribution");
    for (const mock of ["시설부담 정도", "토지피복 기반 적합도", "장래 쓰레기 발생량", "주민 반응"]) {
      expect(table).not.toHaveTextContent(mock);
    }
  });

  it("withholds the table when one side's detail failed, and names the failure", async () => {
    vi.mocked(api.fetchUserScenarioCandidateDetail).mockImplementation(async (_id, request) => {
      if (request.weights.zoning === WEIGHTS_A.zoning) return DETAIL_A;
      throw new Error("boom");
    });
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    pickCandidate();
    await waitFor(() =>
      expect(within(screen.getByTestId("scenario-candidate-side-b")).getByTestId("scenario-candidate-side-error")).toBeInTheDocument(),
    );
    // A half-drawn contribution table would read as a comparison; it is not one.
    expect(screen.queryByTestId("scenario-candidate-contribution")).not.toBeInTheDocument();
    // The side that DID load is still shown.
    expect(screen.getByTestId("scenario-candidate-side-a")).toHaveAttribute("data-state", "READY");
  });

  it("refuses the comparison when the two details name different cells", async () => {
    vi.mocked(api.fetchUserScenarioCandidateDetail).mockImplementation(async (_id, request) =>
      request.weights.zoning === WEIGHTS_A.zoning
        ? DETAIL_A
        : detail(WEIGHTS_B, "75.5000", DETAIL_B.contributions, { candidate_key: "CELL-9999" }),
    );
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    pickCandidate();
    await screen.findByTestId("scenario-candidate-conflict");
    expect(screen.queryByTestId("scenario-candidate-contribution")).not.toBeInTheDocument();
  });
});

describe("rank availability", () => {
  beforeEach(() => respondPerSide());

  it("prints the served rank when the cell is in that side's preview", async () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    pickCandidate();
    await waitFor(() =>
      expect(within(screen.getByTestId("scenario-candidate-side-a")).getByTestId("scenario-candidate-side-placement")).toHaveTextContent(
        "1위",
      ),
    );
  });

  it("NEVER invents a rank the bounded preview did not carry", async () => {
    // B안's preview does not list the cell; its detail is still served.
    const outOfPreview = comparison({
      sideB: side("B", "형평성안", WEIGHTS_B, "hashb", [
        topCandidate({ candidate_id: 77, candidate_key: "CELL-0077" }),
      ]),
    });
    render(<SuitabilityScenarioCandidateComparison comparison={outOfPreview} />);
    pickCandidate();
    const b = await screen.findByTestId("scenario-candidate-side-b");
    await waitFor(() => expect(within(b).getByTestId("scenario-candidate-side-placement")).toBeInTheDocument());
    expect(within(b).getByTestId("scenario-candidate-side-placement")).toHaveTextContent("순위 미제공");
    expect(within(b).getByTestId("scenario-candidate-side-rank-note")).toHaveTextContent(
      "순위가 낮다는 뜻이 아닙니다",
    );
    // Detail availability is distinct from preview-rank availability: the score IS shown.
    expect(within(b).getByTestId("scenario-candidate-side-score")).toHaveTextContent("75.5000");
  });
});

describe("A/B map", () => {
  beforeEach(() => respondPerSide());

  it("draws A안's real scenario tiles — run, canonical weights, and scenario hash", () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    const url = screen.getByTestId("map-container").getAttribute("data-tile-url") ?? "";
    expect(url).toContain("/api/v1/suitability/scenarios/tiles/47/");
    expect(url).toContain("wz=0.25000000");
    expect(url).toContain("scenario_hash=hasha-full");
  });

  it("re-points the SAME map at B안's tiles on toggle — one instance, no remount", () => {
    const { container } = render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    const before = screen.getByTestId("map-container");
    fireEvent.click(screen.getByTestId("scenario-map-toggle-b"));
    const after = screen.getByTestId("map-container");
    // The very same DOM node: the source prop changed, the map did not remount.
    expect(after).toBe(before);
    expect(container.querySelectorAll('[data-testid="map-container"]')).toHaveLength(1);
    const url = after.getAttribute("data-tile-url") ?? "";
    expect(url).toContain("wz=0.10000000");
    expect(url).toContain("wd=0.40000000");
    expect(url).toContain("scenario_hash=hashb-full");
  });

  it("marks the active side with aria-pressed, not colour alone", () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    expect(screen.getByTestId("scenario-map-toggle-a")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("scenario-map-toggle-b")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByTestId("scenario-map-toggle-b"));
    expect(screen.getByTestId("scenario-map-toggle-b")).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the selected candidate across the toggle", async () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    pickCandidate();
    await waitFor(() =>
      expect(screen.getByTestId("map-container")).toHaveAttribute("data-selected", "11"),
    );
    fireEvent.click(screen.getByTestId("scenario-map-toggle-b"));
    expect(screen.getByTestId("map-container")).toHaveAttribute("data-selected", "11");
    // And the detail section still describes the same cell.
    expect(screen.getByTestId("scenario-candidate-picker")).toHaveValue("11");
  });

  it("does NOT re-request the candidate detail when only the map side toggles", async () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    pickCandidate();
    await waitFor(() => expect(api.fetchUserScenarioCandidateDetail).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTestId("scenario-map-toggle-b"));
    fireEvent.click(screen.getByTestId("scenario-map-toggle-a"));
    expect(api.fetchUserScenarioCandidateDetail).toHaveBeenCalledTimes(2);
  });

  it("states that screening does not move with the weights, and adds no A/B categories", () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    const note = screen.getByTestId("scenario-map-note");
    expect(note).toHaveTextContent("규칙 기반이며 A안과 B안에서 달라지지 않습니다");
    const card = screen.getByTestId("scenario-map");
    for (const invented of ["신규 통과", "통과 유지", "통과 → 제외", "양쪽 제외"]) {
      expect(card).not.toHaveTextContent(invented);
    }
  });

  it("isolates a map failure: an explicit message, with the detail section intact", async () => {
    // A side that served no preview has no scenario hash, so no tile URL exists.
    const noTiles = comparison({
      sideB: side("B", "형평성안", WEIGHTS_B, "hashb", [topCandidate()], { preview: null }),
    });
    render(<SuitabilityScenarioCandidateComparison comparison={noTiles} />);
    pickCandidate();
    fireEvent.click(screen.getByTestId("scenario-map-toggle-b"));

    expect(screen.getByTestId("scenario-map-unavailable")).toHaveTextContent(
      "지도 비교를 불러올 수 없습니다.",
    );
    expect(screen.queryByTestId("map-container")).not.toBeInTheDocument();
    // The rest of Page 5C keeps working — the map failure did not blank the page.
    expect(await screen.findByTestId("scenario-candidate-side-a")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-candidate-export")).toBeInTheDocument();
  });
});

describe("export", () => {
  beforeEach(() => respondPerSide());

  it("is disabled until a candidate with a served result is selected", async () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    expect(screen.getByTestId("scenario-candidate-export")).toBeDisabled();
    pickCandidate();
    await waitFor(() => expect(screen.getByTestId("scenario-candidate-export")).toBeEnabled());
  });

  it("writes the real comparison — metadata, weights, candidate, contributions", async () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} />);
    pickCandidate();
    await waitFor(() => expect(screen.getByTestId("scenario-candidate-export")).toBeEnabled());
    fireEvent.click(screen.getByTestId("scenario-candidate-export"));
    await waitFor(() => expect(downloadSpy).toHaveBeenCalledTimes(1));

    const [filename, sheets] = downloadSpy.mock.calls[0] as unknown as [
      string,
      { name: string; preamble: string[]; columns: { header: string }[]; rows: unknown[] }[],
    ];
    expect(filename).toContain("run47");
    expect(filename).toContain("CELL-0011");
    expect(sheets.map((s) => s.name)).toEqual(["비교 조건", "선택 후보 구역", "평가 요소별 기여도"]);
    // The contribution sheet carries the four real factors and the delta column.
    const contribution = sheets[2];
    expect(contribution.rows).toHaveLength(4);
    expect(contribution.columns.map((c) => c.header)).toContain("기여도 차이 (B안 − A안)");
    // Both scenarios are named from storage, and the weights are the server's.
    expect(sheets[0].preamble.join("\n")).toContain("균형안");
    expect(sheets[0].preamble.join("\n")).toContain("형평성안");
  });

  it("prints the same scope sentence next to the button as the file will carry", () => {
    render(<SuitabilityScenarioCandidateComparison comparison={comparison()} initialCandidateId={11} />);
    expect(screen.getByTestId("scenario-candidate-export-scope")).toHaveTextContent("후보 구역 1곳");
    expect(screen.getByTestId("scenario-candidate-export-scope")).not.toHaveTextContent("전체 후보 비교");
  });
});
