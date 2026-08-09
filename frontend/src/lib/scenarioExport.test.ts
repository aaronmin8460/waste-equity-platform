/**
 * 후보지 심층 비교 XLSX export — the data-integrity contract of the workbook.
 *
 * A spreadsheet is where a fabricated value does the most damage: the reader
 * will sum, sort, average, and chart the column, long after the page that
 * produced it is gone. So these tests pin three things:
 *   1. a missing value is an EMPTY CELL, never 0;
 *   2. the file states its own TOP-N scope, not just the UI around it;
 *   3. no column claims a status change a weight scenario cannot cause.
 */

import { describe, expect, it } from "vitest";

import type { UserScenarioPreview, UserScenarioTopCandidate } from "./api";
import {
  buildScenarioSheet,
  rankDirectionLabel,
  scenarioFilenameBase,
  scenarioScopeNote,
  stabilityLabel,
} from "./scenarioExport";
import { safeFilename, safeSheetName } from "./xlsx";

function candidate(over: Partial<UserScenarioTopCandidate> = {}): UserScenarioTopCandidate {
  return {
    candidate_id: 1001,
    candidate_key: "capital-grid-500m:1001",
    sido_region_code: "11",
    sido_region_name: "서울특별시",
    sigungu_region_code: "11680",
    sigungu_region_name: "강남구",
    custom_score: "72.5",
    custom_rank: 1,
    comparison_profile: "baseline",
    comparison_score: "68.25",
    comparison_rank: 4,
    rank_delta: 3,
    rank_change_direction: "up",
    zoning_score: "80",
    road_score: "60.5",
    equity_score: "70",
    demand_score: "55",
    stable_count: 3,
    stability_class: "STABLE",
    centroid_lon: 127.0,
    centroid_lat: 37.5,
    ...over,
  } as UserScenarioTopCandidate;
}

function preview(over: Partial<UserScenarioPreview> = {}): UserScenarioPreview {
  return {
    scenario_hash: "abcdef0123456789",
    scenario_hash_short: "abcdef01",
    method_version: "user-weight-scenario-v1",
    run_id: 48,
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m",
    canonical_weights: { zoning: "0.30", road: "0.30", equity: "0.20", demand: "0.20" },
    compare_profile: "baseline",
    candidate_count_total: 47893,
    candidate_count_eligible: 17501,
    candidate_count_review: 18132,
    candidate_count_excluded: 12260,
    ranking_population: 17501,
    top_candidates: [candidate()],
    selected_candidate: null,
    tile_url: "/tiles/x.mvt",
    assumptions: [],
    scenario_label: "사용자 가중치 시나리오",
    scenario_disclaimer: "이 결과는 임시 계산이며 공식 분석 실행이 아닙니다.",
    screening_disclaimer: "광역 스크리닝이며 법적 판정이 아닙니다.",
    ...over,
  } as UserScenarioPreview;
}

/** The value a column produces for one row. */
function cell(header: string, row: UserScenarioTopCandidate, p = preview()) {
  const column = buildScenarioSheet(p).columns.find((c) => c.header === header);
  expect(column, `column "${header}" exists`).toBeDefined();
  return column!.value(row);
}

describe("missing stays missing", () => {
  it("returns null — never 0 — for every unserved numeric field", () => {
    const empty = candidate({
      comparison_score: null,
      comparison_rank: null,
      rank_delta: null,
      rank_change_direction: null,
      zoning_score: null,
      road_score: null,
      equity_score: null,
      demand_score: null,
      stable_count: null,
      stability_class: null,
      sido_region_name: null,
      sigungu_region_name: null,
    });
    const sheet = buildScenarioSheet(preview({ top_candidates: [empty] }));
    for (const column of sheet.columns) {
      const value = column.value(empty);
      // The served-always fields (rank, key, id) legitimately have values; every
      // other column must be null rather than a stand-in zero.
      if (value !== null) continue;
      expect(value, `${column.header} must be null, not 0`).toBeNull();
    }
    // The specific traps: a 0 here would read as "scored zero" / "rank unchanged".
    expect(cell("용도지역 호환성(Z)", empty)).toBeNull();
    expect(cell("순위 변화(A안→B안)", empty)).toBeNull();
    expect(cell("가중치 민감도", empty)).toBeNull();
  });

  it("keeps a GENUINE zero as zero", () => {
    // Absence and a measured zero are different facts and must stay different.
    const zeroed = candidate({ zoning_score: "0", rank_delta: 0, rank_change_direction: "same" });
    expect(cell("용도지역 호환성(Z)", zeroed)).toBe(0);
    expect(cell("순위 변화(A안→B안)", zeroed)).toBe(0);
    expect(cell("순위 변화 방향", zeroed)).toBe("변화 없음");
  });

  it("never invents a stability class or a direction label", () => {
    expect(stabilityLabel(null, null)).toBeNull();
    expect(stabilityLabel("SOMETHING_NEW", 2)).toBeNull();
    expect(rankDirectionLabel(null, 3)).toBeNull();
    expect(rankDirectionLabel("SIDEWAYS", 3)).toBeNull();
    // The served enum is lowercase — an uppercase compare would null everything.
    expect(rankDirectionLabel("up", 3)).toContain("상승");
    expect(rankDirectionLabel("down", -2)).toContain("하락");
    expect(rankDirectionLabel("same", 0)).toBe("변화 없음");
    expect(stabilityLabel("STABLE", 3)).toContain("3/3");
  });
});

describe("A안 / B안 semantics", () => {
  it("labels A as the official comparison profile and B as the user scenario", () => {
    const headers = buildScenarioSheet(preview()).columns.map((c) => c.header);
    expect(headers.some((h) => h.startsWith("A안") && h.includes("기본 기준"))).toBe(true);
    expect(headers).toContain("B안 사용자 가중치 점수");
    expect(headers).toContain("B안 순위");
  });

  it("carries the backend's own disclaimers verbatim", () => {
    const p = preview();
    const preamble = buildScenarioSheet(p).preamble.join("\n");
    // Paraphrasing a disclaimer is how it loses its meaning.
    expect(preamble).toContain(p.scenario_disclaimer);
    expect(preamble).toContain(p.screening_disclaimer);
    // And the reader is told what an empty cell means.
    expect(preamble).toContain("0이 아닙니다");
  });

  it("records the exact weights and the scenario identifier", () => {
    const preamble = buildScenarioSheet(preview()).preamble.join("\n");
    expect(preamble).toContain("0.30");
    expect(preamble).toContain("abcdef01");
    expect(preamble).toContain("user-weight-scenario-v1");
    expect(preamble).toContain("48");
  });

  it("exports the four REAL scored components and no invented one", () => {
    const headers = buildScenarioSheet(preview())
      .columns.map((c) => c.header)
      .join(" ");
    expect(headers).toContain("용도지역 호환성(Z)");
    expect(headers).toContain("도로 근접성 대리지표(R)");
    expect(headers).toContain("기존 지역 부담(E)");
    expect(headers).toContain("폐기물 처리 수요(D)");
    expect(headers).not.toContain("주민");
    expect(headers).not.toContain("토지피복");
  });
});

describe("forbidden status-change metrics", () => {
  it("has no 신규 통과 or 통과→제외 column, and no zero standing in for one", () => {
    const sheet = buildScenarioSheet(preview());
    const surface = [...sheet.columns.map((c) => c.header), ...sheet.preamble].join(" ");
    // A weight scenario cannot change ELIGIBLE/REVIEW_REQUIRED/EXCLUDED, so these
    // counts do not exist. Printing 0 would imply the question was answered.
    expect(surface).not.toContain("신규 통과");
    expect(surface).not.toContain("통과 → 제외");
    expect(surface).not.toContain("통과→제외");
  });
});

describe("TOP-N scoping", () => {
  it("states BOTH the exported row count and the full population", () => {
    const p = preview({ top_candidates: [candidate(), candidate({ candidate_id: 2 })] });
    const note = scenarioScopeNote(p);
    expect(note).toContain("2");
    expect(note).toContain("17,501");
    expect(note).toContain("전체 후보에 대한 통계가 아닙니다");
    // …and the note is IN the file, not only on the button.
    expect(buildScenarioSheet(p).preamble).toContain(note);
  });

  it("says TOP-N in the sheet tab and the filename too", () => {
    const p = preview({ top_candidates: [candidate(), candidate({ candidate_id: 2 })] });
    expect(buildScenarioSheet(p).name).toContain("상위 2");
    const base = scenarioFilenameBase(p);
    expect(base).toContain("상위2");
    expect(base).toContain("run48");
    expect(base).toContain("abcdef01");
  });
});

describe("file and sheet naming", () => {
  it("produces a safe .xlsx filename while keeping Korean", () => {
    const name = safeFilename(scenarioFilenameBase(preview()));
    expect(name.endsWith(".xlsx")).toBe(true);
    expect(name).toContain("후보지_심층비교");
    // Nothing a filesystem or a Content-Disposition header would choke on.
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("strips path separators and control characters from a hostile base", () => {
    const name = safeFilename('../../etc/pa*ss"wd ');
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
    expect(name).not.toContain(" ");
    expect(name.endsWith(".xlsx")).toBe(true);
  });

  it("keeps the sheet tab inside Excel's own limits", () => {
    expect(safeSheetName("a".repeat(60)).length).toBeLessThanOrEqual(31);
    expect(safeSheetName("A/B[비교]:1")).not.toMatch(/[:\\/?*[\]]/);
    expect(safeSheetName("")).toBe("Sheet1");
  });
});
