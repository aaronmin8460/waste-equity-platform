/**
 * PAGE 4C — 순위 CSV 내보내기.
 *
 * Its own file rather than more of `exports.test.ts`, because what it pins is a
 * different kind of claim: not "the columns are right" but "the file cannot
 * misrepresent what it contains". The four properties asserted below are exactly
 * the ways a scoped export goes wrong silently:
 *
 *   1. the ACTIVE scope, direction and profile are printed in the file, so a
 *      서울-scoped export can never be read as the capital region;
 *   2. the row order is the SERVED order — a 낮은 순 file is what the backend
 *      returned for `sort=score_asc`, never 높은 순 rows turned around;
 *   3. every row is a CANDIDATE CELL, carrying its own key, with no per-시군구
 *      aggregate anywhere;
 *   4. A/B/C is stated as a RELATIVE band, and no 60/62-point pass threshold
 *      appears in any cell.
 */

import { describe, expect, it } from "vitest";

import type { CandidateFeature, SuitabilityStatus } from "./api";
import { toCsv } from "./csv";
import { buildSuitabilityRankingCsv, suitabilityRankingFilenameBase } from "./exports";

const WHEN = new Date(2026, 7, 13, 9, 30, 0);

function row(
  rank: number,
  score: string,
  overrides: Partial<CandidateFeature["properties"]> = {},
): CandidateFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [126.5, 37.7] },
    properties: {
      candidate_id: 7000 + rank,
      candidate_key: `cap500-${String(rank).padStart(6, "0")}`,
      status: "ELIGIBLE" as SuitabilityStatus,
      profile: "baseline",
      is_excluded: false,
      rank,
      total_score: score,
      provisional_score: null,
      zoning_score: null,
      road_score: null,
      equity_score: null,
      demand_score: null,
      sido_region_code: "KR-SGIS-31",
      sido_region_name: "경기도",
      sigungu_region_code: "KR-SGIS-31150",
      sigungu_region_name: "경기도 시흥시",
      nearest_road_distance_m: null,
      stable_count: 3,
      stability_class: "STABLE",
      stability_membership: {},
      exclusion_reasons: [],
      review_reasons: [],
      ...overrides,
    },
  };
}

const FEATURES = [row(1, "94.8000"), row(2, "94.6000"), row(3, "62.0000")];

function build(overrides: Partial<Parameters<typeof buildSuitabilityRankingCsv>[0]> = {}) {
  return buildSuitabilityRankingCsv({
    runId: 47,
    profile: "baseline",
    scopeName: "수도권 전체",
    sort: "score_desc",
    totalMatched: FEATURES.length,
    features: FEATURES,
    truncated: false,
    thresholds: { p25: 60, p75: 90 },
    referenceYear: 2024,
    policyVersion: "suitability-policy-v2",
    derivationVersion: "suitability-screening-v3",
    candidateGridVersion: "capital-grid-500m-v1",
    when: WHEN,
    ...overrides,
  });
}

const flat = (rows: ReturnType<typeof build>) => toCsv(rows);

// --------------------------------------------------------------------------- //
// 1. Scope honesty
// --------------------------------------------------------------------------- //

describe("the export states the ACTIVE scope", () => {
  it("names the scope, direction and profile in the preamble", () => {
    const text = flat(build({ scopeName: "인천", sort: "score_asc" }));
    expect(text).toContain("분석 범위,인천");
    expect(text).toContain("순위 방향,낮은 순");
    expect(text).toContain("분석 실행,#47");
    expect(text).toContain("점수 반영 기준");
  });

  it("prints the AUTHORITATIVE total beside the row count it actually holds", () => {
    const text = flat(build({ totalMatched: 1297 }));
    expect(text).toContain("범위 내 총 후보 구역 수,1297");
    expect(text).toContain("이 파일에 포함된 행 수,3");
  });

  it("declares itself the complete ranking only when it IS complete", () => {
    expect(flat(build())).toContain("내보내기 범위,현재 범위의 전체 순위");
  });

  it("says so IN THE FILE when a safety cap truncated the collection", () => {
    const text = flat(build({ truncated: true, totalMatched: 40_000 }));
    expect(text).toContain("일부만 포함");
    expect(text).not.toContain("내보내기 범위,현재 범위의 전체 순위");
  });

  it("names the scope and direction in the file name", () => {
    const base = suitabilityRankingFilenameBase({
      runId: 47,
      profile: "baseline",
      scopeName: "경기 시흥시",
      sort: "score_asc",
    });
    expect(base).toContain("경기 시흥시");
    expect(base).toContain("낮은 순");
    expect(base).toContain("run47");
  });
});

// --------------------------------------------------------------------------- //
// 2. Ordering follows the active sort — never reversed here
// --------------------------------------------------------------------------- //

describe("row order is the served order", () => {
  it("writes rows in the order they were handed in, for either direction", () => {
    const ascending = [row(1, "10.0000"), row(2, "11.0000"), row(3, "12.0000")];
    const rows = build({ sort: "score_asc", features: ascending, totalMatched: 3 });
    const data = rows.filter((r) => r[0] === 1 || r[0] === 2 || r[0] === 3);
    expect(data.map((r) => r[0])).toEqual([1, 2, 3]);
    expect(data.map((r) => r[6])).toEqual(["10.0000", "11.0000", "12.0000"]);
  });

  it("writes the exact served decimal string, losing no precision", () => {
    expect(flat(build())).toContain("94.8000");
  });
});

// --------------------------------------------------------------------------- //
// 3. The row is a candidate CELL
// --------------------------------------------------------------------------- //

describe("candidate-cell identity survives the export", () => {
  it("carries each cell's own key and id, and names the analysis unit", () => {
    const text = flat(build());
    expect(text).toContain("cap500-000001");
    expect(text).toContain("7001");
    expect(text).toContain("500m 후보 구역");
    expect(text).toContain("분석 단위,500m 후보 구역");
  });

  it("keeps one row per cell even when several share a 시·군·구", () => {
    const rows = build();
    const dataRows = rows.filter((r) => typeof r[0] === "number");
    expect(dataRows).toHaveLength(3);
    // All three lie in the same city and all three survive as distinct rows —
    // nothing is collapsed to a best-per-시군구 or a city mean.
    expect(new Set(dataRows.map((r) => r[5]))).toEqual(new Set(["경기도 시흥시"]));
    expect(new Set(dataRows.map((r) => r[2])).size).toBe(3);
  });

  it("keeps 시도 and 시군구 as separate columns", () => {
    const text = flat(build());
    expect(text).toContain("경기도,경기도 시흥시");
  });
});

// --------------------------------------------------------------------------- //
// 4. A/B/C is relative, and there is no point threshold anywhere
// --------------------------------------------------------------------------- //

describe("A/B/C semantics", () => {
  it("assigns bands from the SCOPED thresholds", () => {
    const rows = build();
    const dataRows = rows.filter((r) => typeof r[0] === "number");
    // 94.8 ≥ p75 → A; 94.6 ≥ p75 → A; 62.0 ≥ p25 but < p75 → B.
    expect(dataRows.map((r) => r[7])).toEqual(["상위 구간(A)", "상위 구간(A)", "중간 구간(B)"]);
  });

  it("leaves the band EMPTY when the population could not be established", () => {
    const rows = build({ thresholds: null });
    const dataRows = rows.filter((r) => typeof r[0] === "number");
    expect(dataRows.map((r) => r[7])).toEqual([null, null, null]);
  });

  it("never grades a non-ELIGIBLE cell", () => {
    const rows = build({
      features: [row(1, "94.8000", { status: "REVIEW_REQUIRED" as SuitabilityStatus })],
      totalMatched: 1,
    });
    const dataRows = rows.filter((r) => typeof r[0] === "number");
    expect(dataRows[0][7]).toBeNull();
  });

  it("explains A/B/C as a relative band, not a pass mark", () => {
    const text = flat(build());
    expect(text).toContain("상대");
    expect(text).toContain("A가 적격을, C가 제외를 뜻하지 않습니다");
  });

  it("contains NO 60/62-point pass-threshold wording", () => {
    // The fixture deliberately includes a candidate scoring exactly 62.0000, so a
    // naive "does the text contain 62" check would fire on a legitimate served
    // score. What must be absent is the THRESHOLD PHRASING the Figma subtitle
    // used — "스크리닝 통과 62점 기준" and its ≥ / < relatives.
    const text = flat(build());
    expect(text).toContain("62.0000"); // the real score is still there…
    expect(text).not.toContain("스크리닝 통과 62점 기준"); // …but never as a rule.
    expect(text).not.toMatch(/\d+(\.\d+)?점\s*(이상|미만|기준)/);
    expect(text).not.toMatch(/기준\s*점수/);
    // 합격 appears exactly once, inside the sentence that DENIES a pass mark.
    // Forbidding the word outright would forbid saying the true thing, so what
    // is asserted is that the only occurrence is that denial.
    expect(text.match(/합격/g)).toHaveLength(1);
    expect(text).toContain("고정 합격 점수가 아니며");
  });
});

// --------------------------------------------------------------------------- //
// Provenance and safety
// --------------------------------------------------------------------------- //

describe("provenance and safety", () => {
  it("carries the run version fields the other suitability exports carry", () => {
    const text = flat(build());
    expect(text).toContain("suitability-policy-v2");
    expect(text).toContain("suitability-screening-v3");
    expect(text).toContain("capital-grid-500m-v1");
    expect(text).toContain("자료 기준 연도,2024");
  });

  it("carries the screening disclaimer and the 분석 범위와 한계 block", () => {
    const text = flat(build());
    expect(text).toContain("법적");
    expect(text).toContain("분석 범위와 한계");
  });

  it("neutralises a formula lead-in in a served name", () => {
    const text = flat(
      build({
        features: [row(1, "94.8000", { sigungu_region_name: "=HYPERLINK(1)" })],
        totalMatched: 1,
      }),
    );
    expect(text).toContain("'=HYPERLINK(1)");
  });

  it("leaves an unserved value as an EMPTY cell, never 0", () => {
    const rows = build({
      features: [row(1, "94.8000", { sido_region_name: null, stability_class: null })],
      totalMatched: 1,
    });
    const dataRow = rows.filter((r) => typeof r[0] === "number")[0];
    expect(dataRow[4]).toBeNull();
    expect(toCsv([dataRow])).not.toContain(",0,");
  });
});
