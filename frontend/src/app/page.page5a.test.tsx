// @vitest-environment jsdom

/**
 * PAGE 5A — the 후보지 심층 비교 A/B comparison FOUNDATION, wired to the REAL page.
 *
 * The pure model has its own unit tests (`lib/scenarioComparison.test.ts`); these
 * are the contracts only the page can hold, and each one is a silent failure mode:
 *
 *   - `cmpA`/`cmpB` resolve two saved scenarios, in that order, and both are
 *     re-previewed against the run on screen;
 *   - a scenario saved against ANOTHER run is never previewed and never called
 *     current;
 *   - the SERVER's `canonical_weights` are what the reader sees — the stored copy
 *     is what gets sent, and nothing more;
 *   - one side failing leaves the other side readable, not a blank page;
 *   - Page 5 writes NOTHING to localStorage;
 *   - a legacy `wz`/`wr`/`we`/`wd`/`cmpProfile` Page-5 link still lands in the
 *     weight lab, and Page 4's own route is untouched.
 *
 * Every fixture is SYNTHETIC and carries no official evidence label.
 */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub() {
      return <div data-testid="map-container" />;
    },
}));

const previewUserWeightScenario = vi.fn();

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const { homeApiMock } = await import("./homeApiMock");
  return {
    ...homeApiMock(actual),
    fetchSuitabilityCandidateDetail: vi.fn(),
    previewUserWeightScenario: (...args: unknown[]) => previewUserWeightScenario(...args),
  };
});

vi.mock("../lib/relativeGrade", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/relativeGrade")>();
  return { ...actual, computeGradeDistribution: vi.fn().mockResolvedValue(null) };
});

import Home from "./page";
import { ApiError, type UserScenarioWeights } from "../lib/api";
import {
  SAVED_SCENARIOS_STORAGE_KEY,
  SAVED_SCENARIO_SCHEMA_VERSION,
  type SavedScenario,
} from "../lib/savedScenarios";

/** The run `homeApiMock` serves. */
const RUN_ID = 47;

/** A's stored weights — Z 40 / R 30 / E 20 / D 10. */
const A_WEIGHTS: UserScenarioWeights = {
  zoning: "0.40000000",
  road: "0.30000000",
  equity: "0.20000000",
  demand: "0.10000000",
};
/** B's stored weights — Z 25 / R 25 / E 40 / D 10. */
const B_WEIGHTS: UserScenarioWeights = {
  zoning: "0.25000000",
  road: "0.25000000",
  equity: "0.40000000",
  demand: "0.10000000",
};

function previewResponse(weights: UserScenarioWeights, overrides: Record<string, unknown> = {}) {
  return {
    scenario_hash: `hash-${weights.zoning}`,
    scenario_hash_short: "hash",
    method_version: "scenario-v1",
    run_id: RUN_ID,
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    canonical_weights: weights,
    compare_profile: "baseline",
    candidate_count_total: 47893,
    candidate_count_eligible: 1099,
    candidate_count_review: 34534,
    candidate_count_excluded: 12260,
    ranking_population: 1099,
    top_candidates: [],
    selected_candidate: null,
    tile_url: "/tiles",
    assumptions: [],
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "임시 비교 결과입니다.",
    screening_disclaimer: "광역 분석 스크리닝",
    ...overrides,
  };
}

/**
 * Echo the canonical weights back for whatever was sent — the real endpoint's
 * behaviour, and what makes "the SERVER is authoritative" testable: a request
 * carrying the stored vector comes back with the canonical one.
 */
function echoingPreview() {
  return vi.fn(async (request: { weights: UserScenarioWeights }) => {
    const sent = request.weights;
    // The backend canonicalises to 8 dp. A stored 1-dp value comes back widened.
    const canonical: UserScenarioWeights = {
      zoning: Number(sent.zoning).toFixed(8),
      road: Number(sent.road).toFixed(8),
      equity: Number(sent.equity).toFixed(8),
      demand: Number(sent.demand).toFixed(8),
    };
    return previewResponse(canonical);
  });
}

function scenario(overrides: Partial<SavedScenario> = {}): SavedScenario {
  return {
    schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION,
    id: "sc-a",
    name: "균형안",
    weights: A_WEIGHTS,
    runId: RUN_ID,
    profileSource: "baseline",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const SAVED_A = scenario();
const SAVED_B = scenario({ id: "sc-b", name: "형평성안", weights: B_WEIGHTS });

function seed(scenarios: unknown[]): void {
  localStorage.setItem(
    SAVED_SCENARIOS_STORAGE_KEY,
    JSON.stringify({ schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION, scenarios }),
  );
}

/**
 * Land on 후보지 심층 비교 with an A/B pair, and wait for the RUN to arrive.
 *
 * The run is what every state below is judged against, so a test that asserted
 * before it landed would be asserting on the loading frame. The page deliberately
 * says nothing about run compatibility until it knows the run.
 */
async function renderPage5(search: string): Promise<void> {
  window.history.replaceState(null, "", search);
  render(<Home />);
  await screen.findByTestId("scenario-comparison-identity", {}, { timeout: 8000 });
  await waitFor(
    () =>
      expect(screen.getByTestId("scenario-comparison-run-meta").textContent).toContain(
        `#${RUN_ID}`,
      ),
    { timeout: 8000 },
  );
}

function sideA(): HTMLElement {
  return screen.getByTestId("scenario-comparison-side-a");
}
function sideB(): HTMLElement {
  return screen.getByTestId("scenario-comparison-side-b");
}

/** The weight row for one Z/R/E/D component. */
function weightRow(component: string): HTMLElement {
  return screen.getByTestId(`scenario-comparison-weight-row-${component}`);
}

const PAIR_URL = `?v=1&mode=suitability&view=scenario&cmpA=sc-a&cmpB=sc-b`;

beforeEach(() => {
  localStorage.clear();
  previewUserWeightScenario.mockReset();
  previewUserWeightScenario.mockImplementation(echoingPreview());
});

afterEach(cleanup);

describe("dispatch — comparison intent vs the legacy Page-5 flow", () => {
  it("renders the comparison foundation for a link carrying a pair", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);
    expect(screen.getByTestId("scenario-comparison-identity")).toBeTruthy();
    // The weight lab is NOT mounted beside it.
    expect(screen.queryByTestId("scenario-lab")).toBeNull();
  });

  it("keeps the LEGACY Page-5 weight lab for a wz/wr/we/wd/cmpProfile link", async () => {
    seed([SAVED_A, SAVED_B]);
    window.history.replaceState(
      null,
      "",
      "?v=1&mode=suitability&view=scenario&wz=0.4&wr=0.3&we=0.2&wd=0.1&cmpProfile=equal",
    );
    render(<Home />);
    await screen.findByTestId("scenario-lab", {}, { timeout: 8000 });
    expect(screen.queryByTestId("scenario-comparison-identity")).toBeNull();
    // The legacy keys keep their meaning in the URL.
    const params = new URLSearchParams(window.location.search.slice(1));
    expect(params.get("wz")).toBe("0.4");
    expect(params.get("cmpProfile")).toBe("equal");
  });

  it("takes the comparison branch for a LONE cmpA rather than silently dropping it", async () => {
    seed([SAVED_A]);
    await renderPage5("?v=1&mode=suitability&view=scenario&cmpA=sc-a");
    // Wait for A's revalidation to settle — until then the honest state is LOADING.
    const body = await screen.findByTestId("scenario-comparison-status-body", {}, { timeout: 8000 });
    expect(body.textContent).toContain("A안과 B안을 각각 선택");
    expect(screen.queryByTestId("scenario-lab")).toBeNull();
  });

  it("leaves PAGE 4's route semantics unchanged — a pair on view=score is still Page 4", async () => {
    seed([SAVED_A, SAVED_B]);
    window.history.replaceState(null, "", "?v=1&mode=suitability&cmpA=sc-a&cmpB=sc-b");
    render(<Home />);
    // ⑤ 비교할 시나리오 선택 — Page 4's own card, not Page 5's foundation.
    await screen.findByTestId("scenario-compare-picker", {}, { timeout: 8000 });
    expect(screen.queryByTestId("scenario-comparison-identity")).toBeNull();
  });
});

describe("resolution and order", () => {
  it("resolves cmpA and cmpB to the two saved scenarios, A first", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(2));
    expect(within(sideA()).getByTestId("scenario-comparison-side-name").textContent).toBe("균형안");
    expect(within(sideB()).getByTestId("scenario-comparison-side-name").textContent).toBe("형평성안");
  });

  it("preserves A/B ORDER when the link names them the other way round", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5("?v=1&mode=suitability&view=scenario&cmpA=sc-b&cmpB=sc-a");
    expect(within(sideA()).getByTestId("scenario-comparison-side-name").textContent).toBe("형평성안");
    expect(within(sideB()).getByTestId("scenario-comparison-side-name").textContent).toBe("균형안");
  });

  it("names the run the comparison was validated against", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);
    expect(screen.getByTestId("scenario-comparison-run-meta").textContent).toContain(`#${RUN_ID}`);
  });

  it("does not accuse either scenario of belonging to another run before the run lands", async () => {
    seed([SAVED_A, SAVED_B]);
    window.history.replaceState(null, "", PAIR_URL);
    render(<Home />);
    await screen.findByTestId("scenario-comparison-identity", {}, { timeout: 8000 });
    // The very first paint must not warn about a mismatch it cannot yet know about.
    expect(screen.queryByTestId("scenario-comparison-side-other-run")).toBeNull();
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(2));
  });
});

describe("preview revalidation", () => {
  it("previews BOTH sides, each with its own stored weights, against the active run", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(2));

    const requests = previewUserWeightScenario.mock.calls.map(
      (call) => call[0] as Record<string, unknown>,
    );
    expect(requests.every((request) => request.run_id === RUN_ID)).toBe(true);
    expect(requests.map((request) => request.weights)).toEqual(
      expect.arrayContaining([A_WEIGHTS, B_WEIGHTS]),
    );
    // The same comparison basis on both sides — a differing one would make the two
    // responses' comparison columns describe different baselines.
    expect(new Set(requests.map((request) => request.compare_profile))).toEqual(
      new Set(["baseline"]),
    );
  });

  it("issues exactly one request per side — no duplicate loads across sections", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(2));
    // Let any further effect passes settle; the count must not climb.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(previewUserWeightScenario).toHaveBeenCalledTimes(2);
  });

  it("shows the SERVER's canonical weights, not the stored copy", async () => {
    // Stored at 1 dp; the backend canonicalises and the page must show the echo.
    seed([
      scenario({ weights: { zoning: "0.4", road: "0.3", equity: "0.2", demand: "0.1" } }),
      SAVED_B,
    ]);
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(2));

    // What was SENT is the stored 1-dp vector…
    const sent = previewUserWeightScenario.mock.calls.map(
      (call) => (call[0] as { weights: UserScenarioWeights }).weights,
    );
    expect(sent).toEqual(
      expect.arrayContaining([{ zoning: "0.4", road: "0.3", equity: "0.2", demand: "0.1" }]),
    );

    // …and what is DISPLAYED is the server's canonicalisation.
    await waitFor(() =>
      expect(screen.getByTestId("scenario-comparison-weights")).toBeTruthy(),
    );
    const precise = screen.getByTestId("scenario-comparison-weight-precise").textContent ?? "";
    expect(precise).toContain("0.40000000");
    expect(precise).not.toContain("A안 0.4 ");
  });

  it("renders the four MODEL factors, never the Figma mock names", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);
    await screen.findByTestId("scenario-comparison-weights");

    for (const component of ["zoning", "road", "equity", "demand"]) {
      expect(weightRow(component)).toBeTruthy();
    }
    const table = screen.getByTestId("scenario-comparison-weights").textContent ?? "";
    expect(table).toContain("용도지역 호환성");
    expect(table).toContain("기존 지역 부담");
    expect(table).toContain("폐기물 처리 수요");
    for (const invented of ["시설 부담 정도", "토지피복 기반 적합도", "장래 역내 쓰레기 발생량", "주민 반응"]) {
      expect(table).not.toContain(invented);
    }
  });

  it("shows each side's weight and the A→B delta", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);
    await screen.findByTestId("scenario-comparison-weights");

    const zoning = weightRow("zoning");
    expect(within(zoning).getByTestId("scenario-comparison-weight-a").textContent).toContain("40%");
    expect(within(zoning).getByTestId("scenario-comparison-weight-b").textContent).toContain("25%");
    expect(within(zoning).getByTestId("scenario-comparison-weight-delta").textContent).toBe("−15%p");

    // D is 10% on both sides — stated in words, never as a bare 0.
    expect(
      within(weightRow("demand")).getByTestId("scenario-comparison-weight-delta").textContent,
    ).toBe("변화 없음");
  });
});

describe("run compatibility", () => {
  it("does NOT preview a scenario saved against another run, and says so", async () => {
    seed([scenario({ runId: 46 }), SAVED_B]);
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(1));

    // Only B's weights were sent.
    const sent = (previewUserWeightScenario.mock.calls[0][0] as { weights: UserScenarioWeights })
      .weights;
    expect(sent).toEqual(B_WEIGHTS);

    expect(within(sideA()).getByTestId("scenario-comparison-side-other-run")).toBeTruthy();
    expect(screen.getByTestId("scenario-comparison-status").textContent).toContain(
      "다른 분석 실행에서 저장된 시나리오입니다",
    );
    // The OTHER_RUN side is never presented as current.
    expect(within(sideA()).queryByTestId("scenario-comparison-side-ready")).toBeNull();
  });

  it("does not silently update the stored scenario's run id", async () => {
    seed([scenario({ runId: 46 }), SAVED_B]);
    const before = localStorage.getItem(SAVED_SCENARIOS_STORAGE_KEY);
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(SAVED_SCENARIOS_STORAGE_KEY)).toBe(before);
  });

  it("reports the B side's other-run state on the B side", async () => {
    seed([SAVED_A, scenario({ id: "sc-b", name: "형평성안", weights: B_WEIGHTS, runId: 46 })]);
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(1));
    expect(within(sideB()).getByTestId("scenario-comparison-side-other-run")).toBeTruthy();
    expect(within(sideA()).queryByTestId("scenario-comparison-side-other-run")).toBeNull();
  });
});

describe("missing scenarios", () => {
  it("states that A is not in THIS browser, without previewing it", async () => {
    seed([SAVED_B]);
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(1));
    expect(within(sideA()).getByTestId("scenario-comparison-side-missing").textContent).toContain(
      "이 브라우저에서 찾을 수 없습니다",
    );
    expect(within(sideB()).getByTestId("scenario-comparison-side-name").textContent).toBe("형평성안");
  });

  it("states that B is not in this browser", async () => {
    seed([SAVED_A]);
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(1));
    expect(within(sideB()).getByTestId("scenario-comparison-side-missing")).toBeTruthy();
  });

  it("states that BOTH are missing, and previews nothing", async () => {
    seed([]);
    await renderPage5(PAIR_URL);
    expect(within(sideA()).getByTestId("scenario-comparison-side-missing")).toBeTruthy();
    expect(within(sideB()).getByTestId("scenario-comparison-side-missing")).toBeTruthy();
    expect(previewUserWeightScenario).not.toHaveBeenCalled();
    // No comparison is fabricated from nothing.
    expect(screen.queryByTestId("scenario-comparison-weights")).toBeNull();
  });

  it("does not substitute another saved scenario for a missing one", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5("?v=1&mode=suitability&view=scenario&cmpA=sc-none&cmpB=sc-b");
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(1));
    expect(within(sideA()).getByTestId("scenario-comparison-side-missing")).toBeTruthy();
    // NOT "선택 없음": an id WAS chosen, and calling that an empty selection would
    // contradict the sentence right beneath it.
    expect(within(sideA()).getByTestId("scenario-comparison-side-name").textContent).toBe(
      "찾을 수 없는 시나리오",
    );
  });

  it("says 선택 없음 only for a slot that carries no id at all", async () => {
    seed([SAVED_A]);
    await renderPage5("?v=1&mode=suitability&view=scenario&cmpA=sc-a");
    expect(within(sideB()).getByTestId("scenario-comparison-side-name").textContent).toBe("선택 없음");
    expect(within(sideB()).getByTestId("scenario-comparison-side-empty")).toBeTruthy();
  });
});

describe("same id", () => {
  it("never renders a scenario compared with itself", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5("?v=1&mode=suitability&view=scenario&cmpA=sc-a&cmpB=sc-a");
    // The URL decoder keeps A and drops the equal B (urlState.ts), so the page
    // asks for the missing half rather than comparing 균형안 with 균형안.
    expect(within(sideA()).getByTestId("scenario-comparison-side-name").textContent).toBe("균형안");
    expect(within(sideB()).getByTestId("scenario-comparison-side-empty")).toBeTruthy();
    const body = await screen.findByTestId("scenario-comparison-status-body", {}, { timeout: 8000 });
    expect(body.textContent).toContain("A안과 B안을 각각 선택");
  });
});

describe("preview failures", () => {
  /** Fail only the side whose zoning weight matches. */
  function failWhenZoningIs(zoning: string) {
    const echo = echoingPreview();
    return vi.fn(async (request: { weights: UserScenarioWeights }) => {
      if (request.weights.zoning === zoning) {
        throw new ApiError(
          422,
          {
            error: "INVALID_SCENARIO_WEIGHTS",
            detail: "가중치 합이 1이 아닙니다.",
            requested_year: null,
            available_years: [],
          },
          "422",
        );
      }
      return echo(request);
    });
  }

  it("keeps B readable when A's preview fails", async () => {
    previewUserWeightScenario.mockImplementation(failWhenZoningIs(A_WEIGHTS.zoning));
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);

    await waitFor(() =>
      expect(within(sideA()).getByTestId("scenario-comparison-side-error")).toBeTruthy(),
    );
    // The backend's own message, which names the offending value.
    expect(within(sideA()).getByTestId("scenario-comparison-side-error").textContent).toContain(
      "가중치 합이 1이 아닙니다",
    );
    // B is unaffected and still shows its served weights.
    expect(within(sideB()).getByTestId("scenario-comparison-side-ready")).toBeTruthy();
    expect(
      within(weightRow("equity")).getByTestId("scenario-comparison-weight-b").textContent,
    ).toContain("40%");
    // A's column is unavailable, never a fabricated 0%.
    expect(
      within(weightRow("equity")).getByTestId("scenario-comparison-weight-a").textContent,
    ).toBe("자료 없음");
  });

  it("keeps A readable when B's preview fails", async () => {
    previewUserWeightScenario.mockImplementation(failWhenZoningIs(B_WEIGHTS.zoning));
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);

    await waitFor(() =>
      expect(within(sideB()).getByTestId("scenario-comparison-side-error")).toBeTruthy(),
    );
    expect(within(sideA()).getByTestId("scenario-comparison-side-ready")).toBeTruthy();
  });

  it("reports both failures without a blank page", async () => {
    previewUserWeightScenario.mockRejectedValue(new Error("network"));
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);

    await waitFor(() =>
      expect(within(sideA()).getByTestId("scenario-comparison-side-error")).toBeTruthy(),
    );
    expect(within(sideB()).getByTestId("scenario-comparison-side-error")).toBeTruthy();
    expect(screen.getByTestId("scenario-comparison-status").textContent).toContain(
      "가중치를 다시 적용하지 못했습니다",
    );
    // Both sides are named, and no weight table is drawn from nothing.
    expect(screen.getByTestId("scenario-comparison-status-sides").textContent).toContain("A안");
    expect(screen.getByTestId("scenario-comparison-status-sides").textContent).toContain("B안");
    expect(screen.queryByTestId("scenario-comparison-weights")).toBeNull();
  });
});

describe("persistence and recovery", () => {
  it("writes NOTHING to localStorage", async () => {
    seed([SAVED_A, SAVED_B]);
    const before = localStorage.getItem(SAVED_SCENARIOS_STORAGE_KEY);
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(2));
    await screen.findByTestId("scenario-comparison-weights");
    expect(localStorage.getItem(SAVED_SCENARIOS_STORAGE_KEY)).toBe(before);
  });

  it("persists no score, rank or candidate from the previews", async () => {
    seed([SAVED_A, SAVED_B]);
    previewUserWeightScenario.mockImplementation(async () =>
      previewResponse(A_WEIGHTS, {
        top_candidates: [{ candidate_id: 701, custom_score: "94.6000", custom_rank: 1 }],
      }),
    );
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(2));
    const blob = localStorage.getItem(SAVED_SCENARIOS_STORAGE_KEY) ?? "";
    expect(blob).not.toContain("94.6");
    expect(blob).not.toContain("custom_rank");
    expect(blob).not.toContain("701");
  });

  it("restores the comparison on a reload of the same link", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(2));
    cleanup();

    previewUserWeightScenario.mockClear();
    await renderPage5(PAIR_URL);
    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(2));
    expect(within(sideA()).getByTestId("scenario-comparison-side-name").textContent).toBe("균형안");
    expect(within(sideB()).getByTestId("scenario-comparison-side-name").textContent).toBe("형평성안");
  });

  it("offers a way back to 후보지 심층 분석 without creating or editing a scenario", async () => {
    seed([SAVED_A]);
    await renderPage5(PAIR_URL);
    const before = localStorage.getItem(SAVED_SCENARIOS_STORAGE_KEY);

    // B is missing, so the foundation offers the way back once A has settled.
    const back = await screen.findByTestId("scenario-comparison-back", {}, { timeout: 8000 });
    back.click();

    await screen.findByTestId("scenario-compare-picker", {}, { timeout: 8000 });
    // The pair survives the trip — the reader lands on ⑤ with their choice intact,
    // and Page 5 created nothing and edited nothing on their behalf.
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search.slice(1));
      expect(params.get("view")).toBeNull();
      expect(params.get("cmpA")).toBe("sc-a");
    });
    expect(localStorage.getItem(SAVED_SCENARIOS_STORAGE_KEY)).toBe(before);
  });
});

describe("no false analytics", () => {
  it("introduces no pass/fail threshold, forecast or resident-reaction claim", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);
    await screen.findByTestId("scenario-comparison-weights");
    const page = document.body.textContent ?? "";
    for (const forbidden of [
      "60점 이상",
      "62점",
      "통과 기준",
      "새롭게 통과",
      "주민 반응",
      "장래 역내 쓰레기 발생량",
      "민감도 구간",
    ]) {
      expect(page).not.toContain(forbidden);
    }
  });

  it("states that screening does not move with the weights", async () => {
    seed([SAVED_A, SAVED_B]);
    await renderPage5(PAIR_URL);
    expect(screen.getByTestId("scenario-comparison-method-note").textContent).toContain(
      "가중치를 바꿔도 달라지지 않습니다",
    );
  });
});
