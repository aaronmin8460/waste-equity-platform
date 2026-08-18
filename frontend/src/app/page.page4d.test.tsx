// @vitest-environment jsdom

/**
 * PAGE 4D — ④ 시나리오 저장 and ⑤ 비교할 시나리오 선택, wired to the REAL page.
 *
 * The storage layer and the two cards have their own unit tests; these are the
 * integration contracts that only the page can hold, and every one of them is a
 * silent failure mode if it breaks:
 *
 *   - a save is REVALIDATED by the preview API and persists the SERVER's canonical
 *     weights and run id, never the client's copy;
 *   - no score, rank or candidate from that preview is ever persisted;
 *   - deleting a scenario clears any A/B slot pointing at it, so `cmpA`/`cmpB`
 *     can never carry a dangling id into Page 5;
 *   - a rename keeps the id, so a link shared before the rename still resolves;
 *   - the A/B pair reaches the URL, and a shared pair is restored from it;
 *   - a legacy Page-5 scenario link keeps working untouched;
 *   - corrupt localStorage does not take the page down.
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
import {
  SAVED_SCENARIOS_STORAGE_KEY,
  SAVED_SCENARIO_SCHEMA_VERSION,
  readSavedScenarios,
  type SavedScenario,
} from "../lib/savedScenarios";
import { COMPONENT_MODEL_HISTORICAL } from "../lib/componentModelWeights";

/** Run 47's served baseline weights, as `homeApiMock` declares them. */
const BASELINE = { zoning: "0.4", road: "0.3", equity: "0.2", demand: "0.1" };
/** What the backend echoes back — canonical 8-dp, which is what must be stored. */
const CANONICAL = {
  zoning: "0.40000000",
  road: "0.30000000",
  equity: "0.20000000",
  demand: "0.10000000",
};

function previewResponse(overrides: Record<string, unknown> = {}) {
  return {
    scenario_hash: "hash",
    scenario_hash_short: "hash",
    method_version: "scenario-v1",
    run_id: 47,
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    canonical_weights: CANONICAL,
    compare_profile: "baseline",
    candidate_count_total: 47893,
    candidate_count_eligible: 1099,
    candidate_count_review: 34534,
    candidate_count_excluded: 12260,
    ranking_population: 1099,
    // A top candidate IS returned by the real endpoint — the point of the
    // persistence assertions below is that none of it is written to storage.
    top_candidates: [
      {
        candidate_id: 701,
        candidate_key: "c-701",
        sido_region_code: "KR-SGIS-31",
        sido_region_name: "경기",
        sigungu_region_code: "KR-SGIS-31150",
        sigungu_region_name: "시흥시",
        custom_score: "94.6000",
        custom_rank: 1,
        comparison_profile: "baseline",
        comparison_score: "94.6000",
        comparison_rank: 1,
        rank_delta: 0,
        rank_change_direction: "same",
        zoning_score: null,
        road_score: null,
        equity_score: null,
        demand_score: null,
        stable_count: null,
        stability_class: null,
        centroid_lon: 126.8,
        centroid_lat: 37.4,
      },
    ],
    selected_candidate: null,
    tile_url: "/tiles",
    assumptions: [],
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "임시 비교 결과입니다.",
    screening_disclaimer: "광역 분석 스크리닝",
    ...overrides,
  };
}

function storedScenario(overrides: Partial<SavedScenario> = {}): SavedScenario {
  return {
    schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION,
    id: "seeded-a",
    name: "기존안",
    weights: CANONICAL,
    // These fixtures are HISTORICAL Z/R/E/D vectors, so they carry the historical
    // model tag. A successor scenario is a different namespace and is fixtured
    // separately where it is the subject.
    componentModelVersion: COMPONENT_MODEL_HISTORICAL,
    runId: 47,
    profileSource: "baseline",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function seed(scenarios: unknown[]): void {
  localStorage.setItem(
    SAVED_SCENARIOS_STORAGE_KEY,
    JSON.stringify({ schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION, scenarios }),
  );
}

/** Land on 후보지 심층 분석 (Page 4), where ④ and ⑤ live. */
async function renderPage4(search = "?v=1&mode=suitability"): Promise<void> {
  window.history.replaceState(null, "", search);
  render(<Home />);
  // The whole dashboard mounts here (map stub, policy/run/summary/ranking reads),
  // and 27 full renders in one file leave the default 1s well short late in the
  // run. The wait is generous rather than tight so a slow render is not reported
  // as a missing section.
  await screen.findByTestId("scenario-save", {}, { timeout: 8000 });
}

/** Open the `저장목록 보기` disclosure (jsdom does not open `<details>` on click). */
function openList(): void {
  const details = screen.getByTestId("scenario-saved-list-disclosure") as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

function currentParams(): URLSearchParams {
  return new URLSearchParams(window.location.search.slice(1));
}

beforeEach(() => {
  localStorage.clear();
  previewUserWeightScenario.mockReset();
  previewUserWeightScenario.mockResolvedValue(previewResponse());
});

afterEach(cleanup);

describe("④ placement and disclosure", () => {
  it("renders ④ and ⑤ on 후보지 심층 분석", async () => {
    await renderPage4();
    expect(screen.getByTestId("scenario-save")).toBeTruthy();
    expect(screen.getByTestId("scenario-compare-picker")).toBeTruthy();
  });

  it("states the browser-only storage scope", async () => {
    await renderPage4();
    expect(screen.getByTestId("scenario-storage-notice").textContent).toContain(
      "이 브라우저에만 저장됩니다",
    );
  });

  it("offers the active basis' REAL served weights, not a placeholder", async () => {
    const { profileLabel } = await import("../lib/glossary");
    await renderPage4();
    const line = screen.getByTestId("scenario-save-weights").textContent ?? "";
    // The active 점수 반영 기준, named exactly as ② names it.
    expect(line).toContain(profileLabel("baseline"));
    // …and run 47's served baseline weights, not an assumed default.
    expect(line).toContain("용도지역 호환성(Z) 40%");
    expect(line).toContain("도로 근접성 대리지표(R) 30%");
  });

  it("shows an empty saved list on a browser that has never saved", async () => {
    await renderPage4();
    openList();
    expect(screen.getByTestId("scenario-saved-empty")).toBeTruthy();
    expect(screen.queryAllByTestId("scenario-saved-item")).toHaveLength(0);
  });
});

describe("saving", () => {
  it("revalidates through the preview API and stores the SERVER's canonical weights and run", async () => {
    await renderPage4();

    fireEvent.change(screen.getByTestId("scenario-name-input"), { target: { value: "형평성안" } });
    fireEvent.click(screen.getByTestId("scenario-save-submit"));

    await waitFor(() => expect(previewUserWeightScenario).toHaveBeenCalledTimes(1));
    const request = previewUserWeightScenario.mock.calls[0][0] as Record<string, unknown>;
    expect(request.run_id).toBe(47);
    expect(request.weights).toEqual(BASELINE);

    await waitFor(() => expect(readSavedScenarios().scenarios).toHaveLength(1));
    const [saved] = readSavedScenarios().scenarios;
    // The 8-dp canonical echo, not the 1-dp values the client sent.
    expect(saved.weights).toEqual(CANONICAL);
    expect(saved.runId).toBe(47);
    expect(saved.name).toBe("형평성안");
    expect(saved.profileSource).toBe("baseline");
  });

  it("persists WEIGHTS AND METADATA ONLY — never a score, rank or candidate", async () => {
    await renderPage4();
    fireEvent.change(screen.getByTestId("scenario-name-input"), { target: { value: "점수없음" } });
    fireEvent.click(screen.getByTestId("scenario-save-submit"));

    await waitFor(() => expect(readSavedScenarios().scenarios).toHaveLength(1));
    const blob = localStorage.getItem(SAVED_SCENARIOS_STORAGE_KEY) ?? "";
    // The preview response carried a rank-1 candidate scoring 94.6. None of it may
    // reach storage: a stored result would go stale while still looking current.
    expect(blob).not.toContain("94.6");
    expect(blob).not.toContain("custom_rank");
    expect(blob).not.toContain("701");
    expect(Object.keys(readSavedScenarios().scenarios[0]).sort()).toEqual([
      "createdAt",
      "id",
      "name",
      "profileSource",
      "runId",
      "schemaVersion",
      "updatedAt",
      "weights",
    ]);
  });

  it("shows the saved scenario in the list and confirms the save", async () => {
    await renderPage4();
    fireEvent.change(screen.getByTestId("scenario-name-input"), { target: { value: "형평성안" } });
    fireEvent.click(screen.getByTestId("scenario-save-submit"));

    await screen.findByTestId("scenario-save-notice");
    openList();
    expect(screen.getByTestId("scenario-saved-name").textContent).toBe("형평성안");
    expect(screen.getByText("저장목록 보기 (1개)")).toBeTruthy();
  });

  it("saves NOTHING and reports the backend's own reason when the preview refuses", async () => {
    const { ApiError } = await import("../lib/api");
    previewUserWeightScenario.mockRejectedValue(
      new ApiError(
        422,
        {
          error: "INVALID_SCENARIO_WEIGHTS",
          detail: "가중치 합계가 1이 아닙니다.",
          requested_year: null,
          available_years: [],
        },
        "422",
      ),
    );
    await renderPage4();

    fireEvent.change(screen.getByTestId("scenario-name-input"), { target: { value: "거부됨" } });
    fireEvent.click(screen.getByTestId("scenario-save-submit"));

    await screen.findByTestId("scenario-save-error");
    expect(screen.getByTestId("scenario-save-error").textContent).toContain(
      "가중치 합계가 1이 아닙니다.",
    );
    expect(readSavedScenarios().scenarios).toHaveLength(0);
  });

  it("does not call the preview API for an empty name", async () => {
    await renderPage4();
    fireEvent.change(screen.getByTestId("scenario-name-input"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("scenario-save-submit"));
    expect(previewUserWeightScenario).not.toHaveBeenCalled();
  });
});

describe("rename", () => {
  it("keeps the id, weights and run, so an already-shared cmpA still resolves", async () => {
    seed([storedScenario()]);
    await renderPage4("?v=1&mode=suitability&cmpA=seeded-a");
    openList();

    fireEvent.click(screen.getByTestId("scenario-saved-menu-toggle"));
    fireEvent.click(screen.getByTestId("scenario-rename-open"));
    fireEvent.change(screen.getByTestId("scenario-rename-input"), { target: { value: "새 이름" } });
    fireEvent.click(screen.getByTestId("scenario-rename-confirm"));

    await waitFor(() => expect(readSavedScenarios().scenarios[0].name).toBe("새 이름"));
    const [renamed] = readSavedScenarios().scenarios;
    expect(renamed.id).toBe("seeded-a");
    expect(renamed.weights).toEqual(CANONICAL);
    expect(renamed.runId).toBe(47);
    expect(renamed.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(renamed.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");

    // The A slot still resolves — the rename did not orphan the link.
    await waitFor(() =>
      expect(
        within(screen.getByTestId("scenario-compare-slot-a")).getByTestId(
          "scenario-compare-slot-name",
        ).textContent,
      ).toBe("새 이름"),
    );
    expect(currentParams().get("cmpA")).toBe("seeded-a");
  });

  it("never creates a second scenario", async () => {
    seed([storedScenario()]);
    await renderPage4();
    openList();
    fireEvent.click(screen.getByTestId("scenario-saved-menu-toggle"));
    fireEvent.click(screen.getByTestId("scenario-rename-open"));
    fireEvent.change(screen.getByTestId("scenario-rename-input"), { target: { value: "하나만" } });
    fireEvent.click(screen.getByTestId("scenario-rename-confirm"));

    await waitFor(() => expect(readSavedScenarios().scenarios[0].name).toBe("하나만"));
    expect(readSavedScenarios().scenarios).toHaveLength(1);
  });
});

describe("delete", () => {
  it("removes the scenario and CLEARS a slot that pointed at it, in the URL too", async () => {
    seed([storedScenario({ id: "aaa", name: "가" }), storedScenario({ id: "bbb", name: "나" })]);
    await renderPage4("?v=1&mode=suitability&cmpA=aaa&cmpB=bbb");

    await waitFor(() => expect(currentParams().get("cmpA")).toBe("aaa"));
    expect(screen.getByTestId("scenario-compare-count").textContent).toContain("2/2");

    openList();
    const rows = screen.getAllByTestId("scenario-saved-item");
    const rowA = rows.find((row) => row.getAttribute("data-scenario-id") === "aaa")!;
    fireEvent.click(within(rowA).getByTestId("scenario-saved-menu-toggle"));
    fireEvent.click(within(rowA).getByTestId("scenario-delete-open"));
    fireEvent.click(within(rowA).getByTestId("scenario-delete-confirm"));

    await waitFor(() => expect(readSavedScenarios().scenarios.map((s) => s.id)).toEqual(["bbb"]));
    // No dangling reference survives — the A slot is EMPTY, not "missing", and the
    // deleted id is gone from the link. B is untouched: it named a live scenario.
    await waitFor(() => expect(currentParams().get("cmpA")).toBeNull());
    expect(currentParams().get("cmpB")).toBe("bbb");
    expect(screen.getByTestId("scenario-compare-count").textContent).toContain("1/2");
    const slotA = screen.getByTestId("scenario-compare-slot-a");
    expect(within(slotA).queryByTestId("scenario-compare-slot-missing")).toBeNull();
    expect(within(slotA).getByTestId("scenario-compare-slot-empty")).toBeTruthy();
    expect(screen.getByTestId("scenario-compare-cta")).toHaveProperty("disabled", true);
  });

  it("leaves an unrelated selection alone", async () => {
    seed([storedScenario({ id: "aaa", name: "가" }), storedScenario({ id: "bbb", name: "나" })]);
    await renderPage4("?v=1&mode=suitability&cmpA=bbb");
    openList();

    const rowA = screen
      .getAllByTestId("scenario-saved-item")
      .find((row) => row.getAttribute("data-scenario-id") === "aaa")!;
    fireEvent.click(within(rowA).getByTestId("scenario-saved-menu-toggle"));
    fireEvent.click(within(rowA).getByTestId("scenario-delete-open"));
    fireEvent.click(within(rowA).getByTestId("scenario-delete-confirm"));

    await waitFor(() => expect(readSavedScenarios().scenarios).toHaveLength(1));
    expect(currentParams().get("cmpA")).toBe("bbb");
  });
});

describe("⑤ A/B selection and the URL", () => {
  it("writes cmpA then cmpB as the reader selects, and enables the CTA at 2/2", async () => {
    seed([storedScenario({ id: "aaa", name: "가" }), storedScenario({ id: "bbb", name: "나" })]);
    await renderPage4();
    openList();

    expect(screen.getByTestId("scenario-compare-cta")).toHaveProperty("disabled", true);

    const rows = screen.getAllByTestId("scenario-saved-item");
    const rowA = rows.find((row) => row.getAttribute("data-scenario-id") === "aaa")!;
    const rowB = rows.find((row) => row.getAttribute("data-scenario-id") === "bbb")!;

    fireEvent.click(within(rowA).getByTestId("scenario-slot-a"));
    await waitFor(() => expect(currentParams().get("cmpA")).toBe("aaa"));
    expect(screen.getByTestId("scenario-compare-count").textContent).toContain("1/2");
    expect(screen.getByTestId("scenario-compare-cta")).toHaveProperty("disabled", true);

    fireEvent.click(within(rowB).getByTestId("scenario-slot-b"));
    await waitFor(() => expect(currentParams().get("cmpB")).toBe("bbb"));
    expect(screen.getByTestId("scenario-compare-count").textContent).toContain("2/2");
    expect(screen.getByTestId("scenario-compare-cta")).toHaveProperty("disabled", false);
  });

  it("never lets one scenario occupy both slots", async () => {
    seed([storedScenario({ id: "aaa", name: "가" })]);
    await renderPage4();
    openList();

    const row = screen.getByTestId("scenario-saved-item");
    fireEvent.click(within(row).getByTestId("scenario-slot-a"));
    await waitFor(() => expect(currentParams().get("cmpA")).toBe("aaa"));

    fireEvent.click(within(row).getByTestId("scenario-slot-b"));
    await waitFor(() => expect(currentParams().get("cmpB")).toBe("aaa"));
    expect(currentParams().get("cmpA")).toBeNull();
    expect(screen.getByTestId("scenario-compare-count").textContent).toContain("1/2");
  });

  it("restores a shared pair from the URL, in order", async () => {
    seed([storedScenario({ id: "aaa", name: "가" }), storedScenario({ id: "bbb", name: "나" })]);
    await renderPage4("?v=1&mode=suitability&cmpA=bbb&cmpB=aaa");

    await waitFor(() =>
      expect(
        within(screen.getByTestId("scenario-compare-slot-a")).getByTestId(
          "scenario-compare-slot-name",
        ).textContent,
      ).toBe("나"),
    );
    expect(
      within(screen.getByTestId("scenario-compare-slot-b")).getByTestId("scenario-compare-slot-name")
        .textContent,
    ).toBe("가");
  });

  it("names a slot this browser cannot resolve rather than showing it as unselected", async () => {
    seed([storedScenario({ id: "aaa", name: "가" })]);
    await renderPage4("?v=1&mode=suitability&cmpA=aaa&cmpB=from-another-device");

    const slotB = screen.getByTestId("scenario-compare-slot-b");
    await waitFor(() =>
      expect(within(slotB).getByTestId("scenario-compare-slot-missing")).toBeTruthy(),
    );
    expect(screen.getByTestId("scenario-compare-cta")).toHaveProperty("disabled", true);
    // The unresolvable id SURVIVES in the link — the reader's selection is theirs.
    expect(currentParams().get("cmpB")).toBe("from-another-device");
  });

  it("drops a malformed id and warns", async () => {
    await renderPage4("?v=1&mode=suitability&cmpA=has%20a%20space");
    await waitFor(() => expect(currentParams().get("cmpA")).toBeNull());
    expect(screen.getByTestId("scenario-compare-count").textContent).toContain("0/2");
  });

  it("resets both slots with ↻", async () => {
    seed([storedScenario({ id: "aaa", name: "가" }), storedScenario({ id: "bbb", name: "나" })]);
    await renderPage4("?v=1&mode=suitability&cmpA=aaa&cmpB=bbb");
    await waitFor(() => expect(currentParams().get("cmpA")).toBe("aaa"));

    fireEvent.click(screen.getByTestId("scenario-compare-reset"));
    await waitFor(() => expect(currentParams().get("cmpA")).toBeNull());
    expect(currentParams().get("cmpB")).toBeNull();
  });

  it("refuses a pair whose scenario belongs to another run", async () => {
    seed([
      storedScenario({ id: "aaa", name: "가" }),
      storedScenario({ id: "old", name: "옛 실행안", runId: 46 }),
    ]);
    await renderPage4("?v=1&mode=suitability&cmpA=aaa&cmpB=old");

    await waitFor(() => expect(screen.getByTestId("scenario-compare-incompatible")).toBeTruthy());
    expect(screen.getByTestId("scenario-compare-cta")).toHaveProperty("disabled", true);
  });
});

describe("두 시나리오 비교하기 →", () => {
  it("moves to 후보지 심층 비교 carrying the pair", async () => {
    seed([storedScenario({ id: "aaa", name: "가" }), storedScenario({ id: "bbb", name: "나" })]);
    await renderPage4("?v=1&mode=suitability&cmpA=aaa&cmpB=bbb");

    fireEvent.click(screen.getByTestId("scenario-compare-cta"));

    await waitFor(() => expect(currentParams().get("view")).toBe("scenario"));
    expect(currentParams().get("mode")).toBe("suitability");
    expect(currentParams().get("cmpA")).toBe("aaa");
    expect(currentParams().get("cmpB")).toBe("bbb");
  });
});

describe("legacy Page-5 links", () => {
  it("keeps a pre-4D scenario link working and adds no comparison pair", async () => {
    window.history.replaceState(
      null,
      "",
      "?v=1&mode=suitability&view=scenario&wz=0.4&wr=0.2&we=0.2&wd=0.2&cmpProfile=equal",
    );
    render(<Home />);

    // The legacy weight lab is what renders — ④/⑤ belong to view=score.
    await waitFor(() => expect(currentParams().get("view")).toBe("scenario"));
    // The four weight keys survive the mirror untouched (the lab re-applies them
    // through the preview API, so the exact spelling may canonicalise; what must
    // not happen is any of them being dropped or replaced by the new pair).
    await waitFor(() => expect(currentParams().get("wz")).toBeTruthy());
    for (const key of ["wz", "wr", "we", "wd"]) {
      expect(Number(currentParams().get(key))).toBeGreaterThan(0);
    }
    expect(currentParams().get("cmpProfile")).toBe("equal");
    expect(currentParams().get("cmpA")).toBeNull();
    expect(currentParams().get("cmpB")).toBeNull();
  });

  it("carries the legacy weights and a saved pair in the same link", async () => {
    seed([storedScenario({ id: "aaa" }), storedScenario({ id: "bbb", name: "나" })]);
    window.history.replaceState(
      null,
      "",
      "?v=1&mode=suitability&view=scenario&wz=0.4&wr=0.2&we=0.2&wd=0.2&cmpA=aaa&cmpB=bbb",
    );
    render(<Home />);

    await waitFor(() => expect(currentParams().get("cmpA")).toBe("aaa"));
    expect(currentParams().get("cmpB")).toBe("bbb");
    expect(currentParams().get("wz")).toBeTruthy();
  });
});

describe("Page-4 state that must keep working", () => {
  it("leaves suitScope and suitSort untouched alongside the pair", async () => {
    seed([storedScenario({ id: "aaa" })]);
    await renderPage4(
      "?v=1&mode=suitability&suitScope=KR-SGIS-11&suitSort=score_asc&cmpA=aaa",
    );

    await waitFor(() => expect(currentParams().get("cmpA")).toBe("aaa"));
    expect(currentParams().get("suitScope")).toBe("KR-SGIS-11");
    expect(currentParams().get("suitSort")).toBe("score_asc");
  });
});

describe("hostile localStorage", () => {
  it("renders Page 4 with an empty list when the stored blob is not JSON", async () => {
    localStorage.setItem(SAVED_SCENARIOS_STORAGE_KEY, "{{{ not json");
    await renderPage4();

    openList();
    expect(screen.getByTestId("scenario-saved-empty")).toBeTruthy();
    expect(screen.getByTestId("scenario-storage-warnings")).toBeTruthy();
    // The rest of Page 4 is unaffected.
    expect(screen.getByTestId("suitability-scope")).toBeTruthy();
  });

  it("shows the readable scenarios and warns about the rest", async () => {
    seed([
      storedScenario({ id: "good", name: "정상" }),
      { ...storedScenario({ id: "bad" }), weights: { zoning: "9", road: "0", equity: "0", demand: "0" } },
    ]);
    await renderPage4();

    openList();
    expect(screen.getAllByTestId("scenario-saved-item")).toHaveLength(1);
    expect(screen.getByTestId("scenario-saved-name").textContent).toBe("정상");
    expect(screen.getByTestId("scenario-storage-warnings").textContent).toContain("1개");
  });

  it("renders Page 4 when the stored schema version is from another release", async () => {
    localStorage.setItem(
      SAVED_SCENARIOS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 99, scenarios: [storedScenario()] }),
    );
    await renderPage4();
    openList();
    expect(screen.getByTestId("scenario-saved-empty")).toBeTruthy();
  });
});
