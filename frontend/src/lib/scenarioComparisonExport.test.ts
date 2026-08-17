/**
 * The Page-5C comparison workbook.
 *
 * A spreadsheet is where a fabricated number does the most damage: the reader will
 * sum it, chart it, and re-send it with no page around it. So these assertions are
 * mostly about what the file must NOT contain — an invented rank, a screening change,
 * a threshold — and about the scope sentence that has to travel with the data.
 */

import { describe, expect, it } from "vitest";

import type {
  UserScenarioCandidateDetail,
  UserScenarioPreview,
  UserScenarioWeights,
} from "./api";
import type { ComparisonSide, ScenarioComparison } from "./scenarioComparison";
import {
  candidateContributionRows,
  majorImpactFactor,
  type PreviewPlacement,
} from "./scenarioCandidateComparison";
import {
  NOT_SERVED,
  buildContributionSheet,
  buildMetadataSheet,
  buildScenarioComparisonWorkbook,
  buildSelectedCandidateSheet,
  comparisonExportFilenameBase,
  comparisonExportScopeNote,
  type ScenarioComparisonExportInput,
} from "./scenarioComparisonExport";
import { sealSheet, type XlsxColumn, type XlsxSheet } from "./xlsx";

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

function preview(weights: UserScenarioWeights, hash: string): UserScenarioPreview {
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
    top_candidates: [],
    selected_candidate: null,
    tile_url: "/tiles",
    assumptions: [],
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "사용자가 입력한 가중치로 만든 임시 비교 결과입니다.",
    screening_disclaimer: "광역 분석 스크리닝이며 법적 적합 판정이 아닙니다.",
  };
}

function side(slot: "A" | "B", name: string, weights: UserScenarioWeights, hash: string): ComparisonSide {
  return {
    slot,
    scenarioId: `sc-${slot.toLowerCase()}`,
    scenarioName: name,
    savedScenario: null,
    canonicalWeights: weights,
    runId: 47,
    preview: preview(weights, hash),
    state: "READY",
    errorMessage: null,
  };
}

const COMPARISON: ScenarioComparison = {
  runId: 47,
  sideA: side("A", "균형안", WEIGHTS_A, "hasha"),
  sideB: side("B", "형평성안", WEIGHTS_B, "hashb"),
  status: "READY",
  loading: false,
};

function detail(
  weights: UserScenarioWeights,
  score: string,
  contributions: UserScenarioCandidateDetail["contributions"],
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
    scenario_disclaimer: "사용자가 입력한 가중치로 만든 임시 비교 결과입니다.",
    screening_disclaimer: "광역 분석 스크리닝이며 법적 적합 판정이 아닙니다.",
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

const IN_PREVIEW: PreviewPlacement = { rank: 1, score: "76.2500", inPreview: true };
const OUT_OF_PREVIEW: PreviewPlacement = { rank: null, score: null, inPreview: false };

function input(overrides: Partial<ScenarioComparisonExportInput> = {}): ScenarioComparisonExportInput {
  const rows = candidateContributionRows(DETAIL_A, DETAIL_B);
  return {
    comparison: COMPARISON,
    candidateKey: "CELL-0011",
    candidateId: 11,
    detailA: DETAIL_A,
    detailB: DETAIL_B,
    placementA: IN_PREVIEW,
    placementB: { rank: 2, score: "75.5000", inPreview: true },
    rows,
    majorImpact: majorImpactFactor(rows),
    previewTopN: 50,
    ...overrides,
  };
}

/** Read one column's value out of one row — how the writer will read it. */
function cell<Row>(sheet: XlsxSheet<Row>, header: string, row: Row) {
  const column = sheet.columns.find((c: XlsxColumn<Row>) => c.header === header);
  if (!column) throw new Error(`no column ${header}`);
  return column.value(row);
}

function findRow<Row extends { item: string }>(sheet: XlsxSheet<Row>, item: string): Row {
  const row = sheet.rows.find((r) => r.item.startsWith(item));
  if (!row) throw new Error(`no row ${item}`);
  return row;
}

// --------------------------------------------------------------------------- //

describe("scope honesty", () => {
  it("says the file is ONE candidate — never 전체 후보 비교", () => {
    const note = comparisonExportScopeNote(input());
    expect(note).toContain("후보 구역 1곳");
    expect(note).toContain("CELL-0011");
    expect(note).toContain("전체 후보 구역에 대한 비교나 순위 분석이 아닙니다");
    expect(note).not.toContain("전체 후보 비교");
  });

  it("repeats the scope in EVERY sheet, so a detached sheet still states it", () => {
    const i = input();
    for (const sheet of [
      buildMetadataSheet(i),
      buildSelectedCandidateSheet(i),
      buildContributionSheet(i),
    ]) {
      expect(sheet.preamble.join("\n")).toContain("후보 구역 1곳");
    }
  });

  it("names the run, the reference year and both scenarios in the preamble", () => {
    const preamble = buildMetadataSheet(input()).preamble.join("\n");
    expect(preamble).toContain("분석 실행 47");
    expect(preamble).toContain("자료 기준 2024");
    expect(preamble).toContain("A안: 균형안");
    expect(preamble).toContain("B안: 형평성안");
    expect(preamble).toContain("0.25000000");
    expect(preamble).toContain("0.40000000");
  });

  it("carries the backend's own disclaimers verbatim", () => {
    const preamble = buildMetadataSheet(input()).preamble.join("\n");
    expect(preamble).toContain("사용자가 입력한 가중치로 만든 임시 비교 결과입니다.");
    expect(preamble).toContain("광역 분석 스크리닝이며 법적 적합 판정이 아닙니다.");
  });

  it("states that a saved scenario is not an official basis", () => {
    expect(buildMetadataSheet(input()).preamble.join("\n")).toContain("공식 계산 기준이 아닙니다");
  });
});

describe("metadata sheet — canonical weights, per side", () => {
  it("writes the SERVER's canonical weights for both sides", () => {
    const sheet = buildMetadataSheet(input());
    const zoning = findRow(sheet, "가중치 — 용도지역 호환성");
    expect(cell(sheet, "A안", zoning)).toBe("0.25000000");
    expect(cell(sheet, "B안", zoning)).toBe("0.10000000");
    const demand = findRow(sheet, "가중치 — 폐기물 처리 수요");
    expect(cell(sheet, "B안", demand)).toBe("0.40000000");
  });

  it("marks a non-READY side's weights 미제공 instead of leaving a blank", () => {
    const blocked: ComparisonSide = {
      ...COMPARISON.sideB,
      state: "OTHER_RUN",
      canonicalWeights: null,
      runId: null,
      preview: null,
    };
    const sheet = buildMetadataSheet(
      input({ comparison: { ...COMPARISON, sideB: blocked, status: "OTHER_RUN_B" } }),
    );
    expect(cell(sheet, "B안", findRow(sheet, "가중치 — 용도지역 호환성"))).toBe(NOT_SERVED);
    expect(sheet.preamble.join("\n")).toContain("검증되지 않아");
  });
});

describe("selected-candidate sheet", () => {
  it("carries the stable candidate_key and the location", () => {
    const sheet = buildSelectedCandidateSheet(input());
    expect(cell(sheet, "A안", findRow(sheet, "후보 구역 코드"))).toBe("CELL-0011");
    expect(cell(sheet, "A안", findRow(sheet, "시·군·구"))).toBe("시흥시");
  });

  it("writes both sides' served scores and their exact difference", () => {
    const sheet = buildSelectedCandidateSheet(input());
    const total = findRow(sheet, "종합 점수 차이");
    expect(cell(sheet, "A안", findRow(sheet, "종합 점수"))).toBe(76.25);
    expect(cell(sheet, "B안", findRow(sheet, "종합 점수"))).toBe(75.5);
    expect(cell(sheet, "B안", total)).toBe(-0.75);
  });

  it("writes an EXPLICIT 미제공 marker — never a number — for a rank outside top-N", () => {
    const sheet = buildSelectedCandidateSheet(
      input({ placementA: IN_PREVIEW, placementB: OUT_OF_PREVIEW }),
    );
    const rank = findRow(sheet, "순위");
    expect(cell(sheet, "A안", rank)).toBe(1);
    expect(cell(sheet, "B안", rank)).toBe(NOT_SERVED);
    // And it says WHY, so 미제공 is not read as a bad placement.
    expect(String(cell(sheet, "설명", rank))).toContain("순위가 낮다는 뜻이 아닙니다");
    expect(String(cell(sheet, "설명", rank))).toContain("50");
  });

  it("states that the screening status does not move with the weights", () => {
    const sheet = buildSelectedCandidateSheet(input());
    const status = findRow(sheet, "판정");
    expect(cell(sheet, "A안", status)).toBe(cell(sheet, "B안", status));
    expect(String(cell(sheet, "설명", status))).toContain("가중치와 무관하게 동일");
  });
});

describe("contribution sheet", () => {
  it("writes component score, both weights, both contributions and the delta", () => {
    const sheet = buildContributionSheet(input());
    const zoning = sheet.rows[0];
    expect(cell(sheet, "평가 요소", zoning)).toBe("용도지역 호환성(Z)");
    expect(cell(sheet, "요소 점수", zoning)).toBe(55);
    expect(cell(sheet, "A안 가중치", zoning)).toBe(0.25);
    expect(cell(sheet, "B안 가중치", zoning)).toBe(0.1);
    expect(cell(sheet, "A안 가중 기여도", zoning)).toBe(13.75);
    expect(cell(sheet, "B안 가중 기여도", zoning)).toBe(5.5);
    expect(cell(sheet, "기여도 차이 (B안 − A안)", zoning)).toBe(-8.25);
  });

  it("has exactly the four model factors, in Z/R/E/D order", () => {
    const sheet = buildContributionSheet(input());
    expect(sheet.rows.map((r) => r.code)).toEqual(["Z", "R", "E", "D"]);
  });

  it("marks the major-impact factor on its row only", () => {
    const sheet = buildContributionSheet(input());
    const marked = sheet.rows.filter((r) => cell(sheet, "가중 기여도 변화가 가장 큰 요소", r) !== null);
    expect(marked.map((r) => r.component)).toEqual(["zoning"]);
    expect(cell(sheet, "가중 기여도 변화가 가장 큰 요소", marked[0])).toBe("해당");
  });

  it("marks EVERY co-equal factor when the maximum is tied", () => {
    const rows = candidateContributionRows(DETAIL_A, DETAIL_A).map((row, index) =>
      // Force Z and R to a shared peak, leaving E and D unchanged.
      index < 2
        ? { ...row, aContribution: "10.0000", bContribution: "20.0000", deltaContribution: "10.0000", deltaUnits: 100_000 }
        : row,
    );
    const sheet = buildContributionSheet(input({ rows, majorImpact: majorImpactFactor(rows) }));
    const marked = sheet.rows.filter((r) => cell(sheet, "가중 기여도 변화가 가장 큰 요소", r) !== null);
    expect(marked.map((r) => r.component)).toEqual(["zoning", "road"]);
    expect(cell(sheet, "가중 기여도 변화가 가장 큰 요소", marked[0])).toBe("해당 (동률)");
  });

  it("states the formula and the descriptive major-impact sentence in the preamble", () => {
    const preamble = buildContributionSheet(input()).preamble.join("\n");
    expect(preamble).toContain("가중 기여도 = 요소 점수 × 가중치");
    expect(preamble).toContain("가중 기여도 변화가 가장 큰 요소");
    expect(preamble).not.toContain("때문에");
  });

  it("leaves an unavailable side's contribution empty rather than zero", () => {
    const rows = candidateContributionRows(DETAIL_A, null);
    const sheet = buildContributionSheet(input({ rows, detailB: null, majorImpact: null }));
    expect(cell(sheet, "B안 가중 기여도", sheet.rows[0])).toBeNull();
    expect(cell(sheet, "기여도 차이 (B안 − A안)", sheet.rows[0])).toBeNull();
  });
});

describe("no fabricated analytics", () => {
  it("contains no threshold, no pass/fail change, and no unmodelled factor", () => {
    const text = buildScenarioComparisonWorkbook(input())
      .flatMap((sheet) => [
        sheet.name,
        ...sheet.preamble,
        ...sheet.columns.map((column) => column.header),
      ])
      .join("\n");
    for (const forbidden of [
      "60점",
      "62점",
      "신규 통과",
      "통과 → 제외",
      "주민 반응",
      "장래 쓰레기",
      "민감도",
      "토지피복 기반 적합도",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("workbook + Page-5B extension point", () => {
  it("builds three sheets and is complete with NO extension", () => {
    const sheets = buildScenarioComparisonWorkbook(input());
    expect(sheets.map((s) => s.name)).toEqual(["비교 조건", "선택 후보 구역", "평가 요소별 기여도"]);
  });

  it("appends an optional extension sheet AFTER this lane's, unchanged", () => {
    const extra: XlsxSheet<{ region: string }> = {
      name: "순위 분석",
      preamble: ["(future Page-5B sheet)"],
      columns: [{ header: "지역", value: (r) => r.region }],
      rows: [{ region: "시흥시" }],
    };
    const sheets = buildScenarioComparisonWorkbook(input(), {
      sheets: [sealSheet(extra)],
      metadataNotes: ["순위 분석 시트가 함께 포함되어 있습니다."],
    });
    expect(sheets.map((s) => s.name)).toEqual([
      "비교 조건",
      "선택 후보 구역",
      "평가 요소별 기여도",
      "순위 분석",
    ]);
    expect(sheets[0].preamble.join("\n")).toContain("순위 분석 시트가 함께 포함");
  });

  it("names the file with the run, the cell, and the single-candidate scope", () => {
    expect(comparisonExportFilenameBase(input())).toBe(
      "후보지_심층비교_run47_CELL-0011_단일후보",
    );
  });
});
