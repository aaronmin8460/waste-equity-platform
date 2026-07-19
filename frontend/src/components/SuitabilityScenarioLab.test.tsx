// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type {
  SuitabilityRun,
  UserScenarioCandidateDetail,
  UserScenarioPreview,
} from "../lib/api";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    previewUserWeightScenario: vi.fn(),
    fetchUserScenarioCandidateDetail: vi.fn(),
  };
});

import { previewUserWeightScenario } from "../lib/api";
import SuitabilityScenarioLab from "./SuitabilityScenarioLab";

const preview = previewUserWeightScenario as unknown as ReturnType<typeof vi.fn>;

const RUN: SuitabilityRun = {
  id: 48,
  derivation_version: "suitability-screening-v3",
  policy_version: "suitability-policy-v2",
  candidate_grid_version: "capital-grid-500m-v1",
  reference_year: 2022,
  boundary_vintage: "2022",
  weight_profile: "baseline",
  analysis_signature: "sig",
  status: "SUCCEEDED",
  candidate_count_total: 3,
  candidate_count_eligible: 3,
  candidate_count_review: 0,
  candidate_count_excluded: 0,
  input_dataset_version_ids: [],
  input_provenance: {},
  weight_profiles: {
    baseline: { zoning: "0.35", road: "0.25", equity: "0.25", demand: "0.15" },
    equal: { zoning: "0.25", road: "0.25", equity: "0.25", demand: "0.25" },
    equity_focused: { zoning: "0.30", road: "0.15", equity: "0.40", demand: "0.15" },
    access_focused: { zoning: "0.25", road: "0.40", equity: "0.20", demand: "0.15" },
    critic: { zoning: "0.31", road: "0.19", equity: "0.28", demand: "0.22" },
  },
  weight_derivation: {},
  stability_definition: {},
  started_at: "",
  completed_at: null,
  created_at: "",
};

const OLD_RUN: SuitabilityRun = {
  ...RUN,
  weight_profiles: {
    baseline: { zoning: "0.35", road: "0.25", equity: "0.25", demand: "0.15" },
    equal: { zoning: "0.25", road: "0.25", equity: "0.25", demand: "0.25" },
  },
};

function makePreview(over: Partial<UserScenarioPreview> = {}): UserScenarioPreview {
  return {
    scenario_hash: "hash-baseline",
    scenario_hash_short: "hash-baseli",
    method_version: "user-weight-scenario-v1",
    run_id: 48,
    reference_year: 2022,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    canonical_weights: {
      zoning: "0.35000000",
      road: "0.25000000",
      equity: "0.25000000",
      demand: "0.15000000",
    },
    compare_profile: "baseline",
    candidate_count_total: 3,
    candidate_count_eligible: 3,
    candidate_count_review: 0,
    candidate_count_excluded: 0,
    ranking_population: 3,
    top_candidates: [
      {
        candidate_id: 101,
        candidate_key: "capital-grid-500m-v1:1_1",
        sido_region_code: "28",
        sido_region_name: "인천광역시",
        sigungu_region_code: "28710",
        sigungu_region_name: "강화군",
        custom_score: "76.2500",
        custom_rank: 1,
        comparison_profile: "baseline",
        comparison_score: "80.0000",
        comparison_rank: 3,
        rank_delta: 2,
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
    tile_url: "/api/v1/suitability/scenarios/tiles/48/{z}/{x}/{y}.mvt?wz=0.35000000",
    assumptions: [],
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "사용자가 입력한 가중치로 ...",
    screening_disclaimer: "Analytical screening only ...",
    ...over,
  };
}

function renderLab(run: SuitabilityRun = RUN) {
  const onApplied = vi.fn();
  const onSelectCandidate = vi.fn();
  const onClearSelected = vi.fn();
  const utils = render(
    <SuitabilityScenarioLab
      run={run}
      runProfiles={
        run === OLD_RUN
          ? ["baseline", "equal", "equity_focused", "access_focused"]
          : ["baseline", "equal", "equity_focused", "access_focused", "critic"]
      }
      onApplied={onApplied}
      scenarioSelected={null}
      onSelectCandidate={onSelectCandidate}
      onClearSelected={onClearSelected}
    />,
  );
  return { ...utils, onApplied, onSelectCandidate, onClearSelected };
}

function setPercent(component: string, value: number) {
  fireEvent.change(screen.getByTestId(`scenario-input-${component}`), {
    target: { value: String(value) },
  });
}

beforeEach(() => {
  preview.mockReset();
  sessionStorage.clear();
});
afterEach(cleanup);

describe("SuitabilityScenarioLab", () => {
  it("always shows the user-scenario warning", () => {
    renderLab();
    expect(screen.getByTestId("scenario-warning")).toHaveTextContent("사용자 가정 기반 시나리오");
  });

  it("offers the CRITIC preset for a run that computed it, and omits it for an old run", () => {
    const { unmount } = renderLab();
    expect(screen.getByTestId("scenario-preset-critic")).toBeInTheDocument();
    unmount();
    renderLab(OLD_RUN);
    expect(screen.queryByTestId("scenario-preset-critic")).toBeNull();
  });

  it("loads a preset into the editor without calling the API", () => {
    renderLab();
    fireEvent.click(screen.getByTestId("scenario-preset-equal"));
    expect(screen.getByTestId("scenario-value-zoning")).toHaveTextContent("25%");
    expect(preview).not.toHaveBeenCalled();
  });

  it("keeps slider and numeric input synchronized and fires no request on edit", () => {
    renderLab();
    setPercent("zoning", 40);
    expect((screen.getByTestId("scenario-slider-zoning") as HTMLInputElement).value).toBe("40");
    expect(screen.getByTestId("scenario-value-zoning")).toHaveTextContent("40%");
    expect(preview).not.toHaveBeenCalled();
  });

  it("disables Apply unless the total is exactly 100 and enables it at 100", () => {
    renderLab();
    setPercent("zoning", 40); // total now 105
    expect(screen.getByTestId("scenario-apply")).toBeDisabled();
    setPercent("zoning", 35); // back to 100
    expect(screen.getByTestId("scenario-apply")).not.toBeDisabled();
  });

  it("normalizes to exactly 100, and rejects all-zero normalization", () => {
    renderLab();
    for (const c of ["zoning", "road", "equity", "demand"]) setPercent(c, 50); // total 200
    fireEvent.click(screen.getByTestId("scenario-normalize"));
    expect(screen.getByTestId("scenario-total")).toHaveTextContent("100%");
    expect(screen.getByTestId("scenario-apply")).not.toBeDisabled();

    for (const c of ["zoning", "road", "equity", "demand"]) setPercent(c, 0);
    fireEvent.click(screen.getByTestId("scenario-normalize"));
    expect(screen.getByTestId("scenario-normalize-note")).toHaveTextContent("정규화할 수 없습니다");
  });

  it("sends canonical decimal strings on explicit apply (one request)", async () => {
    preview.mockResolvedValue(makePreview());
    const { onApplied } = renderLab();
    fireEvent.click(screen.getByTestId("scenario-apply"));
    await waitFor(() => expect(screen.getByTestId("scenario-summary")).toBeInTheDocument());
    expect(preview).toHaveBeenCalledTimes(1);
    const [req] = preview.mock.calls[0];
    expect(req.weights).toEqual({
      zoning: "0.35000000",
      road: "0.25000000",
      equity: "0.25000000",
      demand: "0.15000000",
    });
    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioHash: "hash-baseline", runId: 48 }),
    );
  });

  it("marks the result stale after the draft changes post-apply", async () => {
    preview.mockResolvedValue(makePreview());
    renderLab();
    fireEvent.click(screen.getByTestId("scenario-apply"));
    await waitFor(() => expect(screen.getByTestId("scenario-summary")).toBeInTheDocument());
    expect(screen.queryByTestId("scenario-stale-notice")).toBeNull();
    setPercent("zoning", 34);
    setPercent("road", 26); // keep total 100 but different from applied
    expect(screen.getByTestId("scenario-stale-notice")).toBeInTheDocument();
  });

  it("renders top candidates with rank-movement text and fires the selection callback", async () => {
    preview.mockResolvedValue(makePreview());
    const { onSelectCandidate } = renderLab();
    fireEvent.click(screen.getByTestId("scenario-apply"));
    await waitFor(() => expect(screen.getByTestId("scenario-top-candidates")).toBeInTheDocument());
    expect(screen.getByTestId("scenario-rank-move")).toHaveTextContent("3위 → 1위, 2계단 상승");
    fireEvent.click(screen.getByTestId("scenario-top-row"));
    expect(onSelectCandidate).toHaveBeenCalledWith(101);
  });

  it("re-previews when the comparison profile changes after an applied scenario", async () => {
    preview.mockResolvedValue(makePreview());
    renderLab();
    fireEvent.click(screen.getByTestId("scenario-apply"));
    await waitFor(() => expect(screen.getByTestId("scenario-summary")).toBeInTheDocument());
    expect(preview).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByTestId("scenario-compare-select"), { target: { value: "equal" } });
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(preview.mock.calls[1][0].compare_profile).toBe("equal");
  });

  it("shows the no-applied state before any scenario is applied", () => {
    renderLab();
    expect(screen.getByTestId("scenario-no-applied")).toBeInTheDocument();
  });

  it("renders a scenario candidate detail with a contribution table when selected", () => {
    const detail: UserScenarioCandidateDetail = {
      candidate_id: 101,
      run_id: 48,
      candidate_key: "capital-grid-500m-v1:1_1",
      status: "ELIGIBLE",
      is_excluded: false,
      method_version: "user-weight-scenario-v1",
      scenario_hash: "hash-baseline",
      scenario_hash_short: "hash-baseli",
      canonical_weights: {
        zoning: "0.35000000",
        road: "0.25000000",
        equity: "0.25000000",
        demand: "0.15000000",
      },
      compare_profile: "baseline",
      custom_score: "76.7500",
      custom_provisional_score: null,
      custom_rank: 1,
      comparison_score: "80.0000",
      comparison_rank: 3,
      rank_delta: 2,
      rank_change_direction: "up",
      zoning_score: "55.0000",
      road_score: "100.0000",
      equity_score: "100.0000",
      demand_score: "50.0000",
      contributions: [
        { component: "zoning", component_score: "55.0000", weight: "0.35000000", weighted_contribution: "19.2500" },
        { component: "road", component_score: "100.0000", weight: "0.25000000", weighted_contribution: "25.0000" },
        { component: "equity", component_score: "100.0000", weight: "0.25000000", weighted_contribution: "25.0000" },
        { component: "demand", component_score: "50.0000", weight: "0.15000000", weighted_contribution: "7.5000" },
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
      nearest_road_distance_m: "54.544",
      nearest_road_provenance: {},
      component_provenance: {},
      centroid_lon: 126.5,
      centroid_lat: 37.7,
      geometry: { type: "Point", coordinates: [126.5, 37.7] },
      reference_year: 2022,
      policy_version: "suitability-policy-v2",
      derivation_version: "suitability-screening-v3",
      candidate_grid_version: "capital-grid-500m-v1",
      scenario_label: "사용자 가정 기반 시나리오",
      scenario_disclaimer: "사용자가 입력한 ...",
      screening_disclaimer: "Analytical screening only ...",
    };
    render(
      <SuitabilityScenarioLab
        run={RUN}
        runProfiles={["baseline", "equal", "critic"]}
        onApplied={vi.fn()}
        scenarioSelected={detail}
        onSelectCandidate={vi.fn()}
        onClearSelected={vi.fn()}
      />,
    );
    const panel = screen.getByTestId("scenario-candidate-detail");
    expect(panel).toHaveTextContent("76.7500");
    // weighted contributions sum to the custom score
    const sum = detail.contributions.reduce((a, c) => a + Number(c.weighted_contribution), 0);
    expect(sum).toBeCloseTo(76.75, 4);
    expect(panel).toHaveTextContent("사용자 시나리오의 안정성 평가가 아닙니다");
  });
});
