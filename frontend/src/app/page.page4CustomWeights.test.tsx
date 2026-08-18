// @vitest-environment jsdom

/**
 * PAGE 4 — ② 사용자 지정 가중치 (Figma 356:582 "계산 모델 가중치 설정 (펼침 예시)").
 *
 * ── WHAT THIS FILE EXISTS TO PROVE ───────────────────────────────────────────────
 * That the four `가중치 설정 [ __ ] %` inputs are NOT cosmetic form state. The owner's
 * requirement is explicit that a UI input which changes without affecting the
 * calculation is a failure, so the load-bearing assertions here follow the value from
 * the input all the way to:
 *
 *   1. the REQUEST — `previewUserWeightScenario` receives the reader's vector as exact
 *      8-dp decimal strings summing to exactly 1.00000000;
 *   2. the RANKING — ③'s rows become the preview's own `custom_rank` / `custom_score`,
 *      not the profile ranking's;
 *   3. the MAP — `candidateTileUrl` becomes the custom-scenario tile URL carrying
 *      those same canonical weights.
 *
 * Plus the state rules the requirement names: presets load their values, editing a
 * preset-loaded value transitions to 사용자 지정, an invalid total blocks the
 * calculation with visible validation, and nothing is ever silently normalised.
 *
 * Every fixture is SYNTHETIC and carries no official evidence label.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The map stub PUBLISHES the tile URL it was given.
 *
 * That URL is the only observable proof that a custom vector reached the map, and it
 * is a prop rather than a DOM effect, so the stub renders it into an attribute the
 * assertions can read. Nothing else about MapView is exercised here.
 */
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub(props: { candidateTileUrl?: string | null }) {
      return <div data-testid="map-container" data-tile-url={props.candidateTileUrl ?? ""} />;
    },
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const { homeApiMock } = await import("./homeApiMock");
  return {
    ...homeApiMock(actual),
    fetchSuitabilityCandidateDetail: vi.fn(),
    previewUserWeightScenario: vi.fn(),
  };
});

const computeGradeDistribution = vi.fn();
vi.mock("../lib/relativeGrade", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/relativeGrade")>();
  return {
    ...actual,
    computeGradeDistribution: (...args: unknown[]) => computeGradeDistribution(...args),
  };
});

import Home from "./page";
import * as api from "../lib/api";

const DISTRIBUTION = {
  runId: 47,
  profile: "baseline" as const,
  scope: { kind: "all" as const },
  population: 17501,
  p25: 47.6779,
  p75: 57.811,
  countA: 4914,
  countB: 8403,
  countC: 4184,
};

/** The profile ranking ③ shows BEFORE any custom vector is applied. */
const PROFILE_ROWS = [
  { candidate_id: 701, rank: 1, sigungu: "인천광역시 강화군", total_score: "88.1234" },
  { candidate_id: 702, rank: 2, sigungu: "인천광역시 옹진군", total_score: "81.5000" },
];

/**
 * The scenario preview's own rows — DELIBERATELY a different order, different ranks
 * and different scores from the profile ranking above.
 *
 * That difference is what makes assertion (2) meaningful: if ③ kept showing 88.1234
 * at rank 1 after an apply, the input would be cosmetic and this fixture would catch
 * it. A fixture that echoed the profile ranking could not.
 */
const SCENARIO_ROWS = [
  {
    candidate_id: 702,
    candidate_key: "cap500-000702",
    sido_region_code: "28",
    sido_region_name: "인천광역시",
    sigungu_region_code: "28720",
    sigungu_region_name: "인천광역시 옹진군",
    custom_score: "93.7777",
    custom_rank: 1,
    comparison_profile: "baseline",
    comparison_score: "81.5000",
    comparison_rank: 2,
    rank_delta: 1,
    rank_change_direction: "up" as const,
    zoning_score: "90.0000",
    road_score: "70.0000",
    equity_score: "95.0000",
    demand_score: "80.0000",
    component_scores: {},
    stable_count: 1,
    stability_class: "WEIGHT_SENSITIVE" as const,
    centroid_lon: 126.4,
    centroid_lat: 37.4,
  },
  {
    candidate_id: 701,
    candidate_key: "cap500-000701",
    sido_region_code: "28",
    sido_region_name: "인천광역시",
    sigungu_region_code: "28710",
    sigungu_region_name: "인천광역시 강화군",
    custom_score: "70.1111",
    custom_rank: 2,
    comparison_profile: "baseline",
    comparison_score: "88.1234",
    comparison_rank: 1,
    rank_delta: -1,
    rank_change_direction: "down" as const,
    zoning_score: "90.0000",
    road_score: "70.0000",
    equity_score: "95.0000",
    demand_score: "80.0000",
    component_scores: {},
    stable_count: 3,
    stability_class: "STABLE" as const,
    centroid_lon: 126.5,
    centroid_lat: 37.7,
  },
];

function scenarioPreview(): api.UserScenarioPreview {
  return {
    scenario_hash: "abc123def456",
    scenario_hash_short: "abc123de",
    method_version: "user-weight-scenario-v1",
    run_id: 47,
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    component_model_version: "suitability-components-successor-v1",
    component_order: [
      "existing_burden",
      "air_impact_proxy",
      "resident_impact",
      "land_conversion",
    ],
    // The BACKEND's canonical echo. The page must store and transmit THIS, not the
    // client's own copy of what it typed.
    canonical_weights: {
      existing_burden: "0.40000000",
      air_impact_proxy: "0.20000000",
      resident_impact: "0.25000000",
      land_conversion: "0.15000000",
    },
    compare_profile: "baseline",
    candidate_count_total: 20000,
    candidate_count_eligible: 17501,
    candidate_count_review: 1200,
    candidate_count_excluded: 1299,
    ranking_population: 17501,
    top_candidates: SCENARIO_ROWS,
    selected_candidate: null,
    tile_url: "/api/v1/suitability/scenarios/tiles/47/{z}/{x}/{y}.mvt",
    assumptions: ["500m 후보 격자는 하나의 필지가 아닙니다."],
    scenario_label: "사용자 가정 시나리오",
    scenario_disclaimer: "저장된 분석 실행이 아닙니다.",
    screening_disclaimer: "분석용 선별 결과이며 법적 판정이 아닙니다.",
  };
}

const CANDIDATE_PROPERTIES = {
  candidate_key: "cap500-000701",
  status: "ELIGIBLE" as const,
  profile: "baseline",
  is_excluded: false,
  provisional_score: null,
  zoning_score: "90.0000",
  road_score: "70.0000",
  equity_score: "95.0000",
  demand_score: "80.0000",
  sido_region_code: "28",
  sido_region_name: "인천광역시",
  sigungu_region_code: "28710",
  nearest_road_distance_m: "120.0",
  stable_count: 3,
  stability_class: "STABLE" as const,
  stability_membership: {},
  exclusion_reasons: [],
  review_reasons: [],
};

function serveRanking(): void {
  vi.mocked(api.fetchSuitabilityCandidates).mockResolvedValue({
    type: "FeatureCollection",
    indicator: "SUITABILITY_SCREENING",
    derivation_version: "suitability-screening-v3",
    policy_version: "suitability-policy-v2",
    candidate_grid_version: "capital-grid-500m-v1",
    weight_profile: "baseline",
    reference_year: 2024,
    run_id: 47,
    count: PROFILE_ROWS.length,
    total_matched: 60,
    limit: 5,
    offset: 0,
    sido: null,
    sigungu: [],
    sort: "score_desc",
    features: PROFILE_ROWS.map((row) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [126.5, 37.7] },
      properties: {
        ...CANDIDATE_PROPERTIES,
        candidate_id: row.candidate_id,
        candidate_key: `cap500-00${row.candidate_id}`,
        rank: row.rank,
        total_score: row.total_score,
        sigungu_region_name: row.sigungu,
      },
    })),
    assumptions: [],
    disclaimer: "분석용 선별 결과이며 법적 판정이 아닙니다.",
  });
}

/** The RUN the page resolves — pinned to the successor model, so it is one. */
function serveRun(): void {
  vi.mocked(api.fetchSuitabilityLatestRun).mockResolvedValue({
    id: 47,
    status: "SUCCEEDED",
    reference_year: 2024,
    boundary_vintage: "2024",
    policy_version: "suitability-successor-policy-v1",
    derivation_version: "suitability-successor-derivation-v1",
    candidate_grid_version: "capital-grid-500m-v1",
    component_model_version: "suitability-components-successor-v1",
    component_order: [
      "existing_burden",
      "air_impact_proxy",
      "resident_impact",
      "land_conversion",
    ],
    weight_profiles: {
      baseline: {
        existing_burden: "0.25",
        air_impact_proxy: "0.25",
        resident_impact: "0.25",
        land_conversion: "0.25",
      },
    },
    weight_derivation: {},
  } as unknown as api.SuitabilityRun);
}

async function serveSummary(): Promise<void> {
  serveRun();
  serveRanking();
  vi.mocked(api.fetchSuitabilitySummary).mockResolvedValue({
    run: {
      id: 47,
      status: "SUCCEEDED",
      reference_year: 2024,
      boundary_vintage: "2024",
      policy_version: "suitability-policy-v2",
      derivation_version: "suitability-screening-v3",
      candidate_grid_version: "capital-grid-500m-v1",
      // Page 4 now PINS the successor model, so the run it resolves is a successor
      // run: its scores live in `component_scores`, its four legacy columns are
      // null, and its only approved weight profile is the successor `baseline`.
      component_model_version: "suitability-components-successor-v1",
      component_order: [
        "existing_burden",
        "air_impact_proxy",
        "resident_impact",
        "land_conversion",
      ],
      weight_profiles: {
        baseline: {
          existing_burden: "0.25",
          air_impact_proxy: "0.25",
          resident_impact: "0.25",
          land_conversion: "0.25",
        },
      },
      weight_derivation: {},
    } as unknown as api.SuitabilityRun,
    policy: {
      weight_profiles: {
        baseline: { zoning: "0.40", road: "0.30", equity: "0.20", demand: "0.10" },
        equal: { zoning: "0.25", road: "0.25", equity: "0.25", demand: "0.25" },
      },
    } as unknown as api.SuitabilityPolicy,
    candidate_count_total: 20000,
    candidate_count_eligible: 17501,
    candidate_count_review: 1200,
    candidate_count_excluded: 1299,
    exclusion_reason_counts: {},
    review_reason_counts: {},
    coverage_notes: [],
    disclaimer: "분석용 선별 결과이며 법적 적격을 의미하지 않습니다.",
    top_candidates: PROFILE_ROWS,
    top_stable_candidates: [],
    sido_distribution: {},
    assumptions: ["500m 후보 격자는 하나의 필지가 아닙니다."],
  } as unknown as api.SuitabilitySummary);
}

beforeEach(() => {
  vi.clearAllMocks();
  computeGradeDistribution.mockResolvedValue(DISTRIBUTION);
  vi.mocked(api.previewUserWeightScenario).mockResolvedValue(scenarioPreview());
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

async function enterDeepAnalysis() {
  await serveSummary();
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  fireEvent.click(screen.getByTestId("mode-suitability"));
  await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
  await waitFor(() => expect(screen.getByTestId("candidate-ranking-counts")).toBeDefined());
  return utils;
}

/**
 * Page 4 renders the SUCCESSOR factor cards now, so its weight inputs carry the V3
 * testids. The historical cards (`factor-weight-*`) are still exercised by the
 * single-column comparison screen's own specs.
 */
const weightInput = (component: string) =>
  screen.getByTestId(`v3-factor-weight-${component}`) as HTMLInputElement;

/** Type a whole percent into one factor's input, the way a reader would. */
function setWeight(component: string, percent: number): void {
  fireEvent.change(weightInput(component), { target: { value: String(percent) } });
}

// --------------------------------------------------------------------------- //
// The control exists, and it opens on the SERVED preset
// --------------------------------------------------------------------------- //

describe("② the 가중치 설정 inputs", () => {
  it("renders one editable input per factor, loaded with the active preset", async () => {
    await enterDeepAnalysis();
    // The successor model's ONE approved profile: `baseline`, equal 0.25×4.
    expect(weightInput("existing_burden").value).toBe("25");
    expect(weightInput("air_impact_proxy").value).toBe("25");
    expect(weightInput("resident_impact").value).toBe("25");
    expect(weightInput("land_conversion").value).toBe("25");
    for (const component of [
      "existing_burden",
      "air_impact_proxy",
      "resident_impact",
      "land_conversion",
    ]) {
      expect(weightInput(component).disabled, component).toBe(false);
    }
    // The total is stated, and it starts valid because a served preset sums to 100.
    expect(screen.getByTestId("custom-weight-total").textContent).toContain("100%");
  });

  it("offers 사용자 지정 alongside the built-in presets, which are kept", async () => {
    await enterDeepAnalysis();
    // The V3 row is 기준 + 사용자 지정 and nothing else: the historical presets
    // (equal / equity_focused / access_focused / critic) have NO approved successor
    // equivalent, so offering them here would label a vector with a policy that was
    // never registered for it.
    expect(screen.getByTestId("v3-preset-baseline")).toBeDefined();
    expect(screen.getByTestId("profile-radio-custom")).toBeDefined();
    expect(screen.queryByTestId("profile-radio-equal")).toBeNull();
    expect(screen.queryByTestId("profile-radio-critic")).toBeNull();
    // Nothing is custom until the reader makes it so.
    expect((screen.getByTestId("profile-radio-custom") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("v3-preset-baseline") as HTMLInputElement).checked).toBe(true);
  });

  it("loads the approved baseline when 기준 is selected", async () => {
    await enterDeepAnalysis();
    setWeight("existing_burden", 70);
    await waitFor(() =>
      expect((screen.getByTestId("profile-radio-custom") as HTMLInputElement).checked).toBe(true),
    );
    fireEvent.click(screen.getByTestId("v3-preset-baseline"));
    await waitFor(() => expect(weightInput("existing_burden").value).toBe("25"));
    expect(weightInput("air_impact_proxy").value).toBe("25");
    expect(weightInput("resident_impact").value).toBe("25");
    expect(weightInput("land_conversion").value).toBe("25");
  });

  it("transitions to 사용자 지정 as soon as a preset-loaded value is edited", async () => {
    await enterDeepAnalysis();
    expect((screen.getByTestId("profile-radio-custom") as HTMLInputElement).checked).toBe(false);
    setWeight("existing_burden", 40);
    await waitFor(() =>
      expect((screen.getByTestId("profile-radio-custom") as HTMLInputElement).checked).toBe(true),
    );
    // …and the preset stops claiming to be the basis in force.
    expect((screen.getByTestId("v3-preset-baseline") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("active-basis-name").textContent).toContain("사용자 지정");
  });
});

// --------------------------------------------------------------------------- //
// Validation — the backend's exact-100 rule, expressed client-side
// --------------------------------------------------------------------------- //

describe("weight validation", () => {
  it("blocks the calculation and says by how much when the total is not 100%", async () => {
    await enterDeepAnalysis();
    setWeight("existing_burden", 55); // 55 + 25 + 25 + 25 = 130
    await waitFor(() =>
      expect((screen.getByTestId("custom-weight-apply") as HTMLButtonElement).disabled).toBe(true),
    );
    expect(screen.getByTestId("custom-weight-total").textContent).toContain("130%");
    const validation = screen.getByTestId("custom-weight-validation").textContent ?? "";
    expect(validation).toContain("100%");
    expect(validation).toContain("30%p 많습니다");
    // NEVER auto-corrected — the backend refuses rather than normalising, and so
    // does this editor.
    expect(validation).toContain("자동으로 맞추지 않습니다");
    expect(weightInput("air_impact_proxy").value).toBe("25");
    expect(api.previewUserWeightScenario).not.toHaveBeenCalled();
  });

  it("blocks an under-100 total too, and names the shortfall", async () => {
    await enterDeepAnalysis();
    setWeight("existing_burden", 10); // 10 + 25 + 25 + 25 = 85
    await waitFor(() =>
      expect((screen.getByTestId("custom-weight-apply") as HTMLButtonElement).disabled).toBe(true),
    );
    expect(screen.getByTestId("custom-weight-validation").textContent).toContain("15%p 모자랍니다");
  });

  it("clamps a value to 0–100 rather than accepting an out-of-range weight", async () => {
    await enterDeepAnalysis();
    setWeight("existing_burden", 250);
    await waitFor(() => expect(weightInput("existing_burden").value).toBe("100"));
    setWeight("air_impact_proxy", -40);
    await waitFor(() => expect(weightInput("air_impact_proxy").value).toBe("0"));
  });

  it("enables the calculation once the four values total exactly 100%", async () => {
    await enterDeepAnalysis();
    setWeight("existing_burden", 40);
    setWeight("air_impact_proxy", 20);
    setWeight("land_conversion", 15); // 40 / 20 / 25 / 15 = 100
    await waitFor(() =>
      expect((screen.getByTestId("custom-weight-apply") as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByTestId("custom-weight-validation").textContent).toContain(
      "계산을 적용할 수 있습니다",
    );
  });
});

// --------------------------------------------------------------------------- //
// ⭐ THE PROOF — the typed values reach the real calculation path
// --------------------------------------------------------------------------- //

describe("custom weights drive the REAL calculation", () => {
  async function applyCustomVector() {
    await enterDeepAnalysis();
    setWeight("existing_burden", 40);
    setWeight("air_impact_proxy", 20);
    setWeight("land_conversion", 15); // 40 / 20 / 25 / 15 = 100
    await waitFor(() =>
      expect((screen.getByTestId("custom-weight-apply") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId("custom-weight-apply"));
    await waitFor(() => expect(api.previewUserWeightScenario).toHaveBeenCalled());
  }

  it("1. sends the reader's own vector as exact 8-dp decimals summing to 1.00000000", async () => {
    await applyCustomVector();
    const [request] = vi.mocked(api.previewUserWeightScenario).mock.calls[0];
    expect(request.run_id).toBe(47);
    expect(request.weights).toEqual({
      existing_burden: "0.40000000",
      air_impact_proxy: "0.20000000",
      resident_impact: "0.25000000",
      land_conversion: "0.15000000",
    });
    // The backend's rule, restated as arithmetic: the four canonical strings sum to
    // exactly 1.00000000 at 8 decimal places, with no float drift.
    const sum = Object.values(request.weights).reduce(
      (total, w) => total + Math.round(Number(w) * 1e8),
      0,
    );
    expect(sum).toBe(100_000_000);
  });

  it("2. re-points ③'s ranking at the served scenario result", async () => {
    await applyCustomVector();
    // BEFORE the apply the top row was 강화군 at 88.1234 (the profile ranking).
    // AFTER it, ③ shows the preview's own custom_rank / custom_score.
    await waitFor(() => {
      const rows = within(screen.getByTestId("top-candidates")).getAllByTestId(
        "top-candidate-item",
      );
      expect(rows[0].textContent).toContain("옹진군");
    });
    const rows = within(screen.getByTestId("top-candidates")).getAllByTestId("top-candidate-item");
    expect(rows[0].textContent).toContain("93.7777");
    expect(rows[1].textContent).toContain("70.1111");
    // The scores the profile ranking served are gone from the list — the rows are
    // genuinely the recomputed ones, not the old ones relabelled.
    expect(screen.getByTestId("top-candidates").textContent).not.toContain("88.1234");
  });

  it("3. re-points the MAP at the custom-scenario tiles carrying those weights", async () => {
    await applyCustomVector();
    await waitFor(() => {
      const url = screen.getByTestId("map-container").getAttribute("data-tile-url") ?? "";
      expect(url).toContain("/suitability/scenarios/tiles/47/");
    });
    const url = screen.getByTestId("map-container").getAttribute("data-tile-url") ?? "";
    // The canonical weights the BACKEND echoed, in the tile URL — so the map and the
    // ranking are showing one and the same weighting.
    // Successor weights travel as explicit `w=component:value` pairs — never as the
    // historical wz/wr/we/wd abbreviations, which name different measurements.
    expect(url).toContain(encodeURIComponent("existing_burden:0.40000000"));
    expect(url).toContain(encodeURIComponent("air_impact_proxy:0.20000000"));
    expect(url).toContain(encodeURIComponent("resident_impact:0.25000000"));
    expect(url).toContain(encodeURIComponent("land_conversion:0.15000000"));
    expect(url).not.toContain("wz=");
    expect(url).toContain("scenario_hash=abc123def456");
  });

  it("4. tells the reader the ranking and the map are now the custom result", async () => {
    await applyCustomVector();
    await waitFor(() => expect(screen.getByTestId("custom-weight-applied")).toBeDefined());
    const applied = screen.getByTestId("custom-weight-applied").textContent ?? "";
    expect(applied).toContain("사용자 지정");
    // …and that screening is NOT re-decided by a weight change.
    expect(applied).toContain("스크리닝 통과·제외 판정은 가중치와 무관");
  });

  it("5. hands the applied vector to ④ 시나리오 저장, so it can enter an A/B comparison", async () => {
    await applyCustomVector();
    await waitFor(() => expect(screen.getByTestId("custom-weight-applied")).toBeDefined());
    // ④ saves `activeScenarioWeights`, which now follows the applied custom vector,
    // and LABELS it as 사용자 지정 rather than with the preset the reader left. The
    // save card re-verifies through the same preview endpoint before writing.
    const weights = screen.getByTestId("scenario-save-weights").textContent ?? "";
    expect(weights).toContain("사용자 지정");
    expect(weights).toContain("40%");
    expect(weights).not.toContain("기본 기준의 가중치를 저장합니다");
  });

  it("withholds A/B/C while a custom vector is applied, and says why", async () => {
    await applyCustomVector();
    await waitFor(() => expect(screen.getByTestId("relative-grade-unavailable")).toBeDefined());
    const text = screen.getByTestId("relative-grade-custom-weights").textContent ?? "";
    expect(text).toContain("사용자 지정");
    // Never reported as a failure — nothing failed.
    expect(text).not.toContain("불러오지 못해");
  });

  it("returning to a preset drops the scenario and restores the served ranking", async () => {
    await applyCustomVector();
    await waitFor(() => expect(screen.getByTestId("custom-weight-applied")).toBeDefined());
    fireEvent.click(screen.getByTestId("custom-weight-reset"));
    await waitFor(() => expect(screen.queryByTestId("custom-weight-applied")).toBeNull());
    // Back to the successor model's approved baseline, not a historical vector.
    expect(weightInput("existing_burden").value).toBe("25");
    // The map is back on the stored run's profile tiles.
    const url = screen.getByTestId("map-container").getAttribute("data-tile-url") ?? "";
    expect(url).not.toContain("/scenarios/tiles/");
  });

  it("reports a refused vector with the backend's own message and applies nothing", async () => {
    // The structured 422 the scenario domain layer raises, in its real shape:
    // `detail.detail` is the human-readable message the card must show VERBATIM,
    // because it is the one that names the offending value.
    vi.mocked(api.previewUserWeightScenario).mockRejectedValue(
      new api.ApiError(
        422,
        {
          error: "INVALID_SCENARIO_WEIGHTS",
          detail: "가중치 합계가 1.00000000이어야 합니다.",
        } as unknown as NonNullable<api.ApiError["detail"]>,
        "INVALID_SCENARIO_WEIGHTS",
      ),
    );
    await enterDeepAnalysis();
    setWeight("existing_burden", 40);
    setWeight("air_impact_proxy", 20);
    setWeight("land_conversion", 15); // 40 / 20 / 25 / 15 = 100
    await waitFor(() =>
      expect((screen.getByTestId("custom-weight-apply") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId("custom-weight-apply"));
    await waitFor(() => expect(screen.getByTestId("custom-weight-error")).toBeDefined());
    expect(screen.getByTestId("custom-weight-error").textContent).toContain("1.00000000");
    // Nothing applied: the map and the ranking still describe the stored profile.
    expect(screen.queryByTestId("custom-weight-applied")).toBeNull();
    const url = screen.getByTestId("map-container").getAttribute("data-tile-url") ?? "";
    expect(url).not.toContain("/scenarios/tiles/");
  });
});

// --------------------------------------------------------------------------- //
// TOP 5, and the per-factor label band
// --------------------------------------------------------------------------- //

describe("the rest of the ② / ③ requirements", () => {
  it("asks the ranking endpoint for FIVE rows, not ten", async () => {
    await enterDeepAnalysis();
    const [request] = vi.mocked(api.fetchSuitabilityCandidates).mock.calls[0];
    expect(request.top).toBe(5);
    expect(request.limit).toBe(5);
  });

  it("⭐ requests the V3 SUCCESSOR model explicitly, with successor component keys", async () => {
    // Page 4 pins the model rather than inheriting DEFAULT_COMPONENT_MODEL (still
    // historical). Without the pin the request silently resolved to a historical run
    // — V3 controls over historical numbers, the exact defect this transition fixes.
    await enterDeepAnalysis();
    setWeight("existing_burden", 40);
    setWeight("air_impact_proxy", 20);
    setWeight("land_conversion", 15); // 40 / 20 / 25 / 15 = 100
    await waitFor(() =>
      expect((screen.getByTestId("custom-weight-apply") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId("custom-weight-apply"));
    await waitFor(() => expect(api.previewUserWeightScenario).toHaveBeenCalled());

    const [request] = vi.mocked(api.previewUserWeightScenario).mock.calls[0];
    expect(request.component_model_version).toBe("suitability-components-successor-v1");
    // The weight keys are the SUCCESSOR's own components…
    expect(Object.keys(request.weights).sort()).toEqual(
      ["air_impact_proxy", "existing_burden", "land_conversion", "resident_impact"].sort(),
    );
    // …and NO historical key leaks into a V3 payload.
    for (const legacy of ["zoning", "road", "equity", "demand"]) {
      expect(request.weights[legacy]).toBeUndefined();
    }
  });

  it("sends the ACTIVE ① 분석 범위 with the custom vector, and carries it into the tiles", async () => {
    // The preview endpoint ranks WITHIN the scope, so a scoped ③ shows this 범위's
    // own top N under the reader's weights. Sending no scope would rank the whole
    // capital region and then show it under a regional heading — the defect the
    // Page-5 scope contract exists to prevent, in its Page-4 form.
    window.history.replaceState(null, "", "/?v=1&mode=suitability&view=score&suitScope=KR-SGIS-31");
    await enterDeepAnalysis();
    setWeight("existing_burden", 40);
    setWeight("air_impact_proxy", 20);
    setWeight("land_conversion", 15); // 40 / 20 / 25 / 15 = 100
    await waitFor(() =>
      expect((screen.getByTestId("custom-weight-apply") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId("custom-weight-apply"));
    await waitFor(() => expect(api.previewUserWeightScenario).toHaveBeenCalled());

    const [request] = vi.mocked(api.previewUserWeightScenario).mock.calls[0];
    expect(request.sido).toBe("KR-SGIS-31");

    // …and the map tiles are scoped to the same 범위, so the two agree.
    await waitFor(() => {
      const url = screen.getByTestId("map-container").getAttribute("data-tile-url") ?? "";
      expect(url).toContain("/suitability/scenarios/tiles/47/");
    });
    const url = screen.getByTestId("map-container").getAttribute("data-tile-url") ?? "";
    expect(url).toContain(`sido=${encodeURIComponent("KR-SGIS-31")}`);
  });

  it("sends NO scope for 수도권 전체, which is the whole-region ranking", async () => {
    await enterDeepAnalysis();
    setWeight("existing_burden", 40);
    setWeight("air_impact_proxy", 20);
    setWeight("land_conversion", 15); // 40 / 20 / 25 / 15 = 100
    await waitFor(() =>
      expect((screen.getByTestId("custom-weight-apply") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId("custom-weight-apply"));
    await waitFor(() => expect(api.previewUserWeightScenario).toHaveBeenCalled());
    const [request] = vi.mocked(api.previewUserWeightScenario).mock.calls[0];
    expect(request.sido).toBeUndefined();
    expect(request.sigungu ?? []).toEqual([]);
  });

  it("keeps the 점수 기준 자세히 보기 band table with the design's own five labels", async () => {
    await enterDeepAnalysis();
    const table = screen.getByTestId("factor-score-band-table").textContent ?? "";
    for (const label of ["우수", "양호", "보통", "미흡", "부적합"]) {
      expect(table, label).toContain(label);
    }
    for (const range of ["80~100", "60~79", "40~59", "20~39", "0~19"]) {
      expect(table, range).toContain(range);
    }
    // The band is a screen convention, and the card says so.
    expect(table).toContain("법적 적합·부적합 판정");
  });
});
