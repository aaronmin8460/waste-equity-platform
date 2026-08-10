import { describe, expect, it } from "vitest";

import { toCsv } from "./csv";
import { buildRankingCsv, buildScenarioCsv } from "./exports";
import { rankRegions, type RankableRegion } from "./ranking";

const WHEN = new Date(2026, 6, 20, 3, 7, 9);

function flat(rows: (string | number | null | undefined)[][]): string {
  return toCsv(rows);
}

describe("buildRankingCsv", () => {
  const regions: RankableRegion[] = [
    { code: "41135", name: "성남시", value: { numeric: 500, display: "500" } },
    { code: "11110", name: "종로구", value: { numeric: 300, display: "300" } },
    { code: "11140", name: "중구", value: undefined }, // unavailable
  ];
  const result = rankRegions(regions, "all", 10);

  const rows = buildRankingCsv({
    metricLabel: "인구",
    unit: "persons",
    source: "SGIS (sgis)",
    referencePeriod: "2024",
    accountingBasis: null,
    scope: "all",
    result,
    when: WHEN,
  });

  it("includes labelled metadata, disclaimer, and export time", () => {
    const csv = flat(rows);
    expect(csv).toContain("지역 부담 순위");
    expect(csv).toContain("지표,인구");
    expect(csv).toContain("단위,persons");
    expect(csv).toContain("범위,수도권 전체");
    expect(csv).toContain("값이 없어 제외한 지역 수,1");
    expect(csv).toContain("내보낸 시각,2026-07-20 03:07");
  });

  it("emits both high and low lists with exact display strings", () => {
    const csv = flat(rows);
    expect(csv).toContain("값이 높은 지역,1,41135,성남시,500,persons");
    expect(csv).toContain("값이 낮은 지역,1,11110,종로구,300,persons");
  });

  it("never lists the unavailable region", () => {
    expect(flat(rows)).not.toContain("중구");
  });

  it("is deterministic", () => {
    const again = buildRankingCsv({
      metricLabel: "인구",
      unit: "persons",
      source: "SGIS (sgis)",
      referencePeriod: "2024",
      accountingBasis: null,
      scope: "all",
      result,
      when: WHEN,
    });
    expect(flat(rows)).toBe(flat(again));
  });
});

// `buildComparisonCsv` was removed with the Page 1 지역 비교 card (correction pass).
// The two rules it covered are still covered against the LIVE ranking builder: an
// official 0 is exported as 0, and an unavailable region is never exported as one.
describe("buildRankingCsv — an official zero is a value, not a gap", () => {
  it("exports a measured 0 as 0 while the unavailable region stays absent", () => {
    const zeroRegions: RankableRegion[] = [
      { code: "11110", name: "종로구", value: { numeric: 300, display: "300" } },
      { code: "11140", name: "중구", value: { numeric: 0, display: "0" } }, // official zero
      { code: "28710", name: "강화군", value: undefined }, // unavailable
    ];
    const csv = flat(
      buildRankingCsv({
        metricLabel: "1인당 생활계 발생량",
        unit: "kg/인/년",
        source: "RCIS",
        referencePeriod: "2022",
        accountingBasis: "ORIGIN_BASED_TREATMENT_OUTCOME",
        scope: "all",
        result: rankRegions(zeroRegions, "all", 10),
        when: WHEN,
      }),
    );
    expect(csv).toContain("값이 낮은 지역,1,11140,중구,0,kg/인/년");
    expect(csv).not.toContain("강화군");
    expect(csv).toContain("값이 없어 제외한 지역 수,1");
  });
});

describe("buildScenarioCsv", () => {
  const rows = buildScenarioCsv({
    runId: 48,
    policyVersion: "suitability-policy-v2",
    derivationVersion: "suitability-screening-v3",
    candidateGridVersion: "capital-grid-500m-v1",
    methodVersion: "user-weight-scenario-v1",
    scenarioHashShort: "abc123def456",
    weights: {
      zoning: "0.25000000",
      road: "0.25000000",
      equity: "0.25000000",
      demand: "0.25000000",
    },
    compareProfile: "baseline",
    candidates: [
      {
        custom_rank: 1,
        custom_score: "88.1234",
        sido_region_name: "인천광역시",
        sigungu_region_name: "강화군",
        candidate_key: "cap500-000123",
        comparison_rank: 3,
        rank_delta: 2,
        rank_change_direction: "up",
        zoning_score: "90.0000",
        road_score: "70.0000",
        equity_score: "95.0000",
        demand_score: "80.0000",
        stability_class: "STABLE",
        stable_count: 3,
      },
    ],
    when: WHEN,
  });

  it("records run + versions + canonical weights + compare basis in the preamble", () => {
    const csv = flat(rows);
    expect(csv).toContain("분석 실행,#48");
    expect(csv).toContain("용도지역 호환성(Z),0.25000000");
    expect(csv).toContain("계산 방법,user-weight-scenario-v1");
    expect(csv).toContain("비교 기준,기본 기준");
    expect(csv).toContain("설정 식별값,abc123def456");
  });

  it("labels the export as a temporary, non-official comparison", () => {
    const csv = flat(rows);
    expect(csv).toContain("임시 비교");
    expect(csv).toContain("저장되지 않습니다");
  });

  it("carries the Phase 0 analytical scope & limitations block", () => {
    const csv = flat(rows);
    // The screening disclaimer travels with the export.
    expect(csv).toContain("광역 후보지 스크리닝");
    // Revised status labels + their explanations.
    expect(csv).toContain("상태 · 스크리닝 통과");
    expect(csv).toContain("상태 · 추가 검토 필요");
    expect(csv).toContain("상태 · 프로젝트 스크리닝 제외");
    // Component definitions.
    expect(csv).toContain("구성요소 · 용도지역 호환성");
    expect(csv).toContain("구성요소 · 도로 근접성 대리지표");
    // Not-yet-modelled factors + the three scope statements.
    expect(csv).toContain("현재 분석에 포함되지 않은 항목");
    expect(csv).toContain("경사 및 정밀 지형");
    expect(csv).toContain("500m 후보 격자는 하나의 필지가 아닙니다");
    expect(csv).toContain("토지 소유권과 실제 이용 가능 면적은 평가하지 않습니다");
  });

  it("emits exact score strings and a plain rank-movement label", () => {
    const csv = flat(rows);
    expect(csv).toContain("1,88.1234,인천광역시,강화군,cap500-000123,3,▲ 2칸 상승");
    expect(csv).toContain("세 기준 모두 상위권"); // stability plain sentence
  });
});

describe("formula-injection safety in exports", () => {
  it("guards a region name that begins with a formula lead-in", () => {
    // Moved off the removed comparison builder onto the ranking one. The guard being
    // tested lives in `csv.ts` and applies to every cell of every builder, so any
    // live builder proves it — but it must be proven against one that still ships.
    const rows = buildRankingCsv({
      metricLabel: "인구",
      unit: "persons",
      source: "SGIS",
      referencePeriod: "2024",
      accountingBasis: null,
      scope: "all",
      result: rankRegions(
        [{ code: "11110", name: "=HYPERLINK(1)", value: { numeric: 1, display: "1" } }],
        "all",
        10,
      ),
      when: WHEN,
    });
    // The malicious name is neutralised with a leading single quote.
    expect(flat(rows)).toContain("'=HYPERLINK(1)");
  });
});
