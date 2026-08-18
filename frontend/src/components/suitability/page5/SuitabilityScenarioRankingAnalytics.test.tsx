// @vitest-environment jsdom

/**
 * 순위 비교 분석 (Page 5B) — what the reader is actually shown.
 *
 * The load-bearing assertions are about restraint: that nothing renders unless the
 * foundation is READY, that a rank the server did not send is never printed as a
 * number, that every scoped figure carries its scope, and that none of the Figma
 * frame's screening vocabulary (통과 / 신규 통과 / 60점) reaches the page.
 */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  UserScenarioPreview,
  UserScenarioTopCandidate,
  UserScenarioWeights,
} from "../../../lib/api";
import type { ComparisonSide, ScenarioComparison } from "../../../lib/scenarioComparison";
import { COMPONENT_MODEL_SUCCESSOR } from "../../../lib/componentModelWeights";
import SuitabilityScenarioRankingAnalytics from "./SuitabilityScenarioRankingAnalytics";

afterEach(cleanup);

const WEIGHTS: UserScenarioWeights = {
  zoning: "0.40000000",
  road: "0.30000000",
  equity: "0.20000000",
  demand: "0.10000000",
};

function candidate(
  key: string,
  rank: number,
  score: string,
  // Already fully qualified by the backend, as a real run-47 preview serves it.
  sigungu = "인천광역시 강화군",
): UserScenarioTopCandidate {
  return {
    candidate_id: rank,
    candidate_key: key,
    sido_region_code: "KR-SGIS-23",
    sido_region_name: "인천광역시",
    sigungu_region_code: "KR-SGIS-23510",
    sigungu_region_name: sigungu,
    custom_score: score,
    custom_rank: rank,
    comparison_profile: "baseline",
    // Deliberately misleading: if the UI ever showed the preview's own
    // official-profile comparison columns as the A/B comparison, 999 would appear.
    comparison_score: "0.1111",
    comparison_rank: 999,
    rank_delta: 900,
    rank_change_direction: "up",
    zoning_score: "0.8000",
    road_score: "0.7000",
    equity_score: "0.6000",
    demand_score: "0.5000",
    component_scores: {},
    stable_count: 3,
    stability_class: "STABLE",
    centroid_lon: 126.8,
    centroid_lat: 37.4,
  };
}

function preview(
  rows: UserScenarioTopCandidate[],
  overrides: Partial<UserScenarioPreview> = {},
): UserScenarioPreview {
  return {
    scenario_hash: "hash",
    scenario_hash_short: "hash",
    method_version: "scenario-v1",
    run_id: 47,
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    component_model_version: "suitability-components-zred-v1",
    component_order: ["zoning", "road", "equity", "demand"],
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
    ...overrides,
  };
}

function side(
  slot: "A" | "B",
  value: UserScenarioPreview | null,
  state: ComparisonSide["state"] = value === null ? "PREVIEW_ERROR" : "READY",
): ComparisonSide {
  return {
    slot,
    scenarioId: `sc-${slot.toLowerCase()}`,
    scenarioName: slot === "A" ? "균형안" : "형평성안",
    savedScenario: null,
    canonicalWeights: value?.canonical_weights ?? null,
    runId: value?.run_id ?? null,
    preview: value,
    state,
    errorMessage: null,
  };
}

function comparison(
  a: UserScenarioPreview | null,
  b: UserScenarioPreview | null,
  overrides: Partial<ScenarioComparison> = {},
): ScenarioComparison {
  return {
    runId: 47,
    componentModelVersion: COMPONENT_MODEL_SUCCESSOR,
    sideA: side("A", a),
    sideB: side("B", b),
    status: a !== null && b !== null ? "READY" : "PREVIEW_ERROR_BOTH",
    loading: false,
    ...overrides,
  };
}

/**
 * Keys `c1..cN` ranked 1..N with descending scores — the served shape.
 *
 * `overrides` is applied to EVERY row, which is what the run-level fields want: a
 * frozen stability class is a property of the run, so a fixture that sets it on one
 * row and not the next would be a shape the backend never serves.
 */
function ranked(
  keys: string[],
  overrides: Partial<UserScenarioTopCandidate> = {},
): UserScenarioTopCandidate[] {
  return keys.map((key, index) => ({
    ...candidate(key, index + 1, (1 - index * 0.01).toFixed(4)),
    ...overrides,
  }));
}

const TWELVE_A = ranked(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12"]);
const TWELVE_B = ranked(["c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12", "c13", "c1", "c2"]);

/**
 * The same shape, but each cell alone in its OWN 시·군·구.
 *
 * `ranked` files every row under 인천광역시 강화군, which is right for the
 * candidate-level assertions and collapses to ONE municipality under the
 * representative selection. Anything asserting on the visible 시·군·구 list has to
 * say which municipality each cell is in rather than inheriting one.
 */
function rankedPerSigungu(keys: string[]): UserScenarioTopCandidate[] {
  return keys.map((key, index) => ({
    ...candidate(key, index + 1, (1 - index * 0.01).toFixed(4)),
    sigungu_region_name: `경기도 ${key}군`,
    sido_region_name: "경기도",
    sido_region_code: "KR-SGIS-31",
  }));
}

const TWELVE_A_G = rankedPerSigungu([
  "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12",
]);
const TWELVE_B_G = rankedPerSigungu([
  "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12", "c13", "c1", "c2",
]);

function renderAnalytics(model: ScenarioComparison) {
  return render(<SuitabilityScenarioRankingAnalytics comparison={model} />);
}

// --------------------------------------------------------------------------- //

describe("readiness — Page 5A owns every not-ready state", () => {
  it("renders nothing when a side failed to preview", () => {
    renderAnalytics(comparison(preview(ranked(["c1"])), null));
    expect(screen.queryByTestId("scenario-ranking-analytics")).not.toBeInTheDocument();
  });

  it("renders nothing while a side is still loading", () => {
    const pending = comparison(preview(ranked(["c1"])), preview(ranked(["c1"])), {
      status: "LOADING",
      loading: true,
    });
    pending.sideB = side("B", null, "LOADING");
    renderAnalytics(pending);
    expect(screen.queryByTestId("scenario-ranking-analytics")).not.toBeInTheDocument();
  });

  it("renders nothing for a cross-run side rather than stale analytics", () => {
    const blocked = comparison(preview(ranked(["c1"])), preview(ranked(["c1"])));
    blocked.sideB = side("B", null, "OTHER_RUN");
    renderAnalytics(blocked);
    expect(screen.queryByTestId("scenario-ranking-analytics")).not.toBeInTheDocument();
  });

  it("duplicates none of Page 5A's recovery UI", () => {
    renderAnalytics(comparison(preview(ranked(["c1"])), null));
    expect(screen.queryByTestId("scenario-comparison-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scenario-comparison-back")).not.toBeInTheDocument();
  });
});

describe("KPI row", () => {
  it("names both 1위 candidate cells and calls the change a 순위 변경", () => {
    renderAnalytics(comparison(preview(TWELVE_A), preview(TWELVE_B)));
    const kpi = screen.getByTestId("scenario-ranking-kpi-top1");
    expect(within(kpi).getByTestId("scenario-ranking-kpi-top1-value")).toHaveTextContent("순위 변경");
    const caption = within(kpi).getByTestId("scenario-ranking-kpi-top1-caption");
    expect(caption).toHaveTextContent("A안 인천광역시 강화군 · c1");
    expect(caption).toHaveTextContent("B안 인천광역시 강화군 · c4");
  });

  it("says 변화 없음 when both scenarios rank the same cell first", () => {
    renderAnalytics(comparison(preview(TWELVE_A), preview(TWELVE_A)));
    expect(screen.getByTestId("scenario-ranking-kpi-top1-value")).toHaveTextContent("변화 없음");
  });

  it("shows the exact visible 시·군·구 overlap as a fraction and a percentage", () => {
    renderAnalytics(comparison(preview(TWELVE_A_G), preview(TWELVE_B_G)));
    // A shows c1..c10군; B shows c4..c13군 → 7 shared municipalities.
    expect(screen.getByTestId("scenario-ranking-kpi-retention-value")).toHaveTextContent(
      "7 / 10곳",
    );
    expect(screen.getByTestId("scenario-ranking-kpi-retention-caption")).toHaveTextContent(
      "70% 유지",
    );
  });

  it("counts 시·군·구 and not candidates — ten cells of one 시·군·구 retain as ONE", () => {
    // THE REAL V3 SHAPE. A candidate-key overlap would print 10 / 10.
    renderAnalytics(comparison(preview(TWELVE_A), preview(TWELVE_A)));
    expect(screen.getByTestId("scenario-ranking-kpi-retention-value")).toHaveTextContent(
      "1 / 1곳",
    );
  });

  it("never labels the TOP-10 metric as whole-ranking stability", () => {
    // Ten distinct 시·군·구 on both sides, so the tile shows its full-N label rather
    // than the reduced-denominator one.
    renderAnalytics(comparison(preview(TWELVE_A_G), preview(TWELVE_B_G)));
    const kpi = screen.getByTestId("scenario-ranking-kpi-retention");
    expect(kpi).not.toHaveTextContent("전체 순위 안정성");
    expect(kpi).not.toHaveTextContent("전체 후보 유지율");
    expect(kpi).toHaveTextContent("TOP 10 유지 시·군·구");
  });

  it("states the reduced denominator when the scope holds fewer than ten 시·군·구", () => {
    // The 인천 case on real V3 data: only a couple of rankable municipalities exist.
    const short = preview(rankedPerSigungu(["c1", "c2", "c3"]), { ranking_population: 3 });
    renderAnalytics(comparison(short, short));
    expect(screen.getByTestId("scenario-ranking-kpi-retention-value")).toHaveTextContent("3 / 3곳");
    expect(screen.getByTestId("scenario-ranking-kpi-retention-caption")).toHaveTextContent(
      "3곳뿐이라 그 기준으로 계산",
    );
  });

  it("scopes the rise and fall counts to the shared visible 시·군·구, not the population", () => {
    renderAnalytics(comparison(preview(TWELVE_A_G), preview(TWELVE_B_G)));
    const rose = screen.getByTestId("scenario-ranking-kpi-rose");
    expect(rose).toHaveTextContent("표시 위치가 올라간 시·군·구");
    // The tile names the bounded population; the strip below states it in full.
    expect(rose).toHaveTextContent("양쪽 공통");
    expect(rose).not.toHaveTextContent("전체 후보");
    // c4..c10군 are shown by both, each three places higher in B's list.
    expect(within(rose).getByTestId("scenario-ranking-kpi-rose-value")).toHaveTextContent("7곳");
    expect(screen.getByTestId("scenario-ranking-kpi-fell-value")).toHaveTextContent("0곳");
  });

  it("reports 시·군·구 entering and leaving the visible list, with no 통과 wording", () => {
    renderAnalytics(comparison(preview(TWELVE_A_G), preview(TWELVE_B_G)));
    const tile = screen.getByTestId("scenario-ranking-kpi-common");
    // c11군..c13군 appeared; c1군..c3군 dropped out.
    expect(within(tile).getByTestId("scenario-ranking-kpi-common-value")).toHaveTextContent(
      "+3 / −3곳",
    );
    for (const banned of ["통과", "탈락", "신규 통과"]) {
      expect(tile).not.toHaveTextContent(banned);
    }
  });

  it("reports the served ranked population beside the compared count", () => {
    renderAnalytics(comparison(preview(TWELVE_A), preview(TWELVE_B)));
    expect(screen.getByTestId("scenario-ranking-kpi-common")).toHaveTextContent("500개");
  });
});

describe("slope / movement visualization", () => {
  it("draws the A/B 시·군·구 union and heads each row with the municipality", () => {
    renderAnalytics(comparison(preview(TWELVE_A_G), preview(TWELVE_B_G)));
    const table = screen.getByTestId("scenario-ranking-slope-table");
    // c1군 is in A's visible ten and c13군 is in B's; both get a row.
    expect(within(table).getByRole("rowheader", { name: "경기도 c1군" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "경기도 c13군" })).toBeInTheDocument();
  });

  it("prints one row per 시·군·구 even when the two sides pick different cells", () => {
    // Ten cells of 강화군 on both sides — the real V3 shape. ONE line, not ten.
    renderAnalytics(comparison(preview(TWELVE_A), preview(TWELVE_B)));
    const table = screen.getByTestId("scenario-ranking-slope-table");
    expect(within(table).getAllByRole("rowheader")).toHaveLength(1);
    expect(within(table).getByRole("rowheader", { name: "인천광역시 강화군" })).toBeInTheDocument();
  });

  it("shows the real out-of-list rank rather than dropping the 시·군·구", () => {
    renderAnalytics(comparison(preview(TWELVE_A_G), preview(TWELVE_B_G)));
    const table = screen.getByTestId("scenario-ranking-slope-table");
    const row = within(table).getByRole("rowheader", { name: "경기도 c1군" }).closest("tr");
    expect(row).not.toBeNull();
    // c1군's cell is rank 1 for A and rank 11 for B — off B's visible list, but
    // served, so the REAL rank is printed rather than discarded.
    expect(within(row as HTMLElement).getByText("목록 밖 · 11위")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("A안에서만 표시")).toBeInTheDocument();
  });

  it("prints an unavailability phrase, never a number, for an unserved rank", () => {
    renderAnalytics(
      comparison(preview(rankedPerSigungu(["a1"])), preview(rankedPerSigungu(["b1"]))),
    );
    const table = screen.getByTestId("scenario-ranking-slope-table");
    // Neither side served the other's 시·군·구, so neither endpoint has a rank to
    // print — and no number is substituted for the absence.
    expect(within(table).getAllByText("목록에 없음")).toHaveLength(4);
    expect(within(table).getByText("A안에서만 표시")).toBeInTheDocument();
    expect(within(table).getByText("B안에서만 표시")).toBeInTheDocument();
  });

  it("says so plainly when there is no top-10 candidate to draw", () => {
    renderAnalytics(comparison(preview([]), preview([])));
    expect(screen.getByTestId("scenario-ranking-slope-empty")).toHaveTextContent(
      "순위 이동을 그릴 수 없습니다",
    );
    expect(screen.queryByTestId("scenario-ranking-slope")).not.toBeInTheDocument();
  });
});

describe("ranking movement card", () => {
  /**
   * The card holds the scatter and nothing else. It used to embed a
   * 순위 변화가 큰 후보 구역 list, which was the comparison table below it under a
   * different heading — the table's default sort IS "순위 변화가 큰 순" — and which
   * pushed this card to ~2.5× the height of the one the frame draws beside it.
   */
  it("holds the scatter alone, with no embedded row list", () => {
    renderAnalytics(comparison(preview(TWELVE_A), preview(TWELVE_B)));
    expect(screen.getByTestId("scenario-ranking-movement-card")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-ranking-scatter")).toBeInTheDocument();
    expect(screen.queryAllByTestId("scenario-ranking-movement-row")).toHaveLength(0);
  });

  it("does not call the A/B difference a sensitivity analysis", () => {
    renderAnalytics(comparison(preview(TWELVE_A), preview(TWELVE_B)));
    const card = screen.getByTestId("scenario-ranking-movement-card");
    expect(card).toHaveTextContent("민감도 분석이 아닙니다");
    // The card's own title never claims it either.
    expect(within(card).getByText("순위 변동 분포")).toBeInTheDocument();
  });
});

describe("run stability column", () => {
  /**
   * `stability_class` is the RUN's, not the comparison's: the backend computes it
   * once per run and serves the same value inside both previews. It is the only
   * robustness statement Page 5 is entitled to make, and it must never be dressed
   * up as an A/B movement.
   */
  it("prints the served class once per cell", () => {
    renderAnalytics(
      comparison(
        preview(ranked(["c1"], { stability_class: "STABLE", stable_count: 3 })),
        preview(ranked(["c1"], { stability_class: "STABLE", stable_count: 3 })),
      ),
    );
    const cells = screen.getAllByTestId("scenario-ranking-table-stability");
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveAttribute("data-stability-class", "STABLE");
    expect(cells[0]).toHaveTextContent("세 기준 모두 상위권");
  });

  it("prints 자료 없음 rather than defaulting an unserved class to stable", () => {
    const unserved = { stability_class: null, stable_count: null } as const;
    renderAnalytics(
      comparison(preview(ranked(["c1"], unserved)), preview(ranked(["c1"], unserved))),
    );
    expect(screen.getByTestId("scenario-ranking-table-stability")).toHaveTextContent("자료 없음");
  });

  it("withholds the class when the two sides contradict each other", () => {
    renderAnalytics(
      comparison(
        preview(ranked(["c1"], { stability_class: "STABLE", stable_count: 3 })),
        preview(ranked(["c1"], { stability_class: "WEIGHT_SENSITIVE", stable_count: 1 })),
      ),
    );
    expect(screen.getByTestId("scenario-ranking-table-stability")).toHaveTextContent("자료 없음");
  });
});

describe("comparison table", () => {
  it("renders the union of both served lists, with the cell key on every row", () => {
    renderAnalytics(comparison(preview(ranked(["c1", "c2"])), preview(ranked(["c2", "c3"]))));
    const rows = screen.getAllByTestId("scenario-ranking-table-row");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.getAttribute("data-candidate-key")).sort()).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
    // The row still names WHAT it is and WHICH cell it is. The 시·군·구 moved to the
    // group heading above the rows (the owner rejected reprinting it on every row),
    // so the row no longer joins the two with "·" — but the cell key, the thing that
    // makes a row identifiable, is still on it.
    expect(rows[0]).toHaveTextContent("500m 후보 구역");
    expect(rows[0]).toHaveTextContent("c2");
  });

  it("groups rows under a 시·군·구 heading instead of repeating the name on every row", () => {
    renderAnalytics(comparison(preview(ranked(["c1", "c2"])), preview(ranked(["c2", "c3"]))));
    const headings = screen.getAllByTestId("scenario-ranking-table-group-heading");
    expect(headings.length).toBeGreaterThan(0);
    // A heading states the place and HOW MANY rows sit under it — never an average
    // rank, a median or any other aggregate over the group.
    expect(headings[0].textContent ?? "").toMatch(/후보 구역 \d+곳/);
    expect(headings[0].textContent ?? "").not.toMatch(/평균|중앙값|합계/);
  });

  it("states the bounded population above the table", () => {
    renderAnalytics(comparison(preview(TWELVE_A), preview(TWELVE_B)));
    const scope = screen.getByTestId("scenario-ranking-table-scope");
    expect(scope).toHaveTextContent("각각 상위 12개");
    expect(scope).toHaveTextContent("정렬을 바꿔도 비교 대상 후보 구역은 달라지지 않습니다");
  });

  it("prints the unavailability phrase in a rank cell the server did not fill", () => {
    renderAnalytics(comparison(preview(ranked(["c1", "c2"])), preview(ranked(["c2", "c3"]))));
    const row = screen
      .getAllByTestId("scenario-ranking-table-row")
      .find((element) => element.getAttribute("data-candidate-key") === "c1");
    expect(row).toBeDefined();
    expect(row as HTMLElement).toHaveTextContent("B안 상위 2 밖");
    // An uncomputable movement is an em dash, never 0 and never "유지".
    expect(
      within(row as HTMLElement).getByTestId("scenario-ranking-table-movement"),
    ).toHaveTextContent("—");
  });

  it("shows each side's own custom score, never the official-profile column", () => {
    renderAnalytics(
      comparison(preview([candidate("c1", 1, "0.9100")]), preview([candidate("c1", 1, "0.7300")])),
    );
    const row = screen.getAllByTestId("scenario-ranking-table-row")[0];
    expect(row).toHaveTextContent("0.9100점");
    expect(row).toHaveTextContent("0.7300점");
    expect(row).not.toHaveTextContent("999");
    expect(row).not.toHaveTextContent("0.1111");
  });

  it("reorders on sort without changing which candidates are compared", () => {
    renderAnalytics(comparison(preview(TWELVE_A), preview(TWELVE_B)));
    const keysNow = () =>
      screen
        .getAllByTestId("scenario-ranking-table-row")
        .map((row) => row.getAttribute("data-candidate-key"));

    const before = keysNow();
    fireEvent.change(screen.getByTestId("scenario-ranking-table-sort"), {
      target: { value: "rank_a_asc" },
    });
    const after = keysNow();

    expect(after).not.toEqual(before);
    expect([...after].sort()).toEqual([...before].sort());
    expect(after[0]).toBe("c1"); // A rank 1
  });

  it("sorts absent ranks last rather than treating them as first", () => {
    renderAnalytics(comparison(preview(ranked(["c1", "c2"])), preview(ranked(["c2", "c3"]))));
    fireEvent.change(screen.getByTestId("scenario-ranking-table-sort"), {
      target: { value: "rank_a_asc" },
    });
    const keys = screen
      .getAllByTestId("scenario-ranking-table-row")
      .map((row) => row.getAttribute("data-candidate-key"));
    expect(keys.at(-1)).toBe("c3"); // served only by B
  });

  it("says the table is empty rather than drawing an empty ranking", () => {
    renderAnalytics(comparison(preview([]), preview([])));
    expect(screen.getByTestId("scenario-ranking-table-empty")).toHaveTextContent(
      "비교할 후보 구역이 없습니다",
    );
  });
});

describe("no screening, threshold, or forecast analytics", () => {
  const forbidden = [
    "통과 지역",
    "신규 통과",
    "새롭게 통과",
    "통과 → 제외",
    "60점",
    "62점",
    "주민 반응",
    "장래 쓰레기 발생량",
    "최적 지역",
  ];

  it("uses none of the Figma mock's screening vocabulary", () => {
    const { container } = renderAnalytics(comparison(preview(TWELVE_A), preview(TWELVE_B)));
    for (const phrase of forbidden) {
      expect(container.textContent ?? "").not.toContain(phrase);
    }
  });

  it("adds no A/B screening-status column to the comparison table", () => {
    renderAnalytics(comparison(preview(TWELVE_A), preview(TWELVE_B)));
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent?.trim() ?? "");
    expect(headers).not.toContain("A안 결과");
    expect(headers).not.toContain("B안 결과");
    expect(headers).toContain("순위 변화");
  });

  it("does not claim a scenario changed a screening result", () => {
    const { container } = renderAnalytics(comparison(preview(TWELVE_A), preview(TWELVE_B)));
    expect(container.textContent ?? "").toContain("스크리닝을 통과한 후보 구역 전체를 대상으로");
  });
});
