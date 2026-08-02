/**
 * Land-cover presentation/validation helper tests (Phase 1B-LC5A).
 *
 * These pin the three honesty rules that a naive formatter would break:
 *  - a real non-zero quantity never renders as "0";
 *  - a PARTIAL cell never renders as 100% covered (LC3 decides coverage by exact
 *    residual emptiness, so a PARTIAL ratio really can be 0.9999999999999876);
 *  - uncovered area never becomes a class, and a NO_COVERAGE response arriving with
 *    class rows is rejected rather than rendered.
 *
 * Every numeric fixture here is a synthetic value chosen to exercise a boundary, not
 * official public data.
 */

import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  COVERAGE_STATUS_CAVEATS,
  COVERAGE_STATUS_TONES,
  classCountForLevel,
  classRowsForLevel,
  formatAreaKm2,
  formatAreaM2,
  formatCoverageRatioPercent,
  formatDominantClass,
  formatSharePercent,
  formatUncoveredRatioPercent,
  landCoverErrorKind,
  validateActiveRelease,
  validateCellStatistics,
  validateClassDistribution,
} from "./landCover";

const KEY = "capital-grid-500m-v1:1807_3923";

/** Minimal well-formed cell-statistics body for the validator tests. */
function cellBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidate_key: KEY,
    coverage_status: "PARTIAL",
    coverage_ratio: 0.5336,
    cell_area_m2: 162927.88,
    evaluated_area_m2: 86946.4,
    uncovered_area_m2: 75981.48,
    coverage_status_meaning: "부분 평가",
    used_in_suitability_scoring: false,
    dominant_class: { l1_code: "200", l1_name: "농업지역", l2_code: null, l2_name: null, l3_code: null, l3_name: null },
    class_counts: {
      l1_class_count: 6,
      l2_class_count: 14,
      l3_class_count: 15,
      l1_class_area_sum_m2: 86946.4,
      l2_class_area_sum_m2: 86946.4,
      l3_class_area_sum_m2: 86946.4,
    },
    release: { statistics_version_id: 1 },
    disclosures: { license_status: "LOCAL_USE_ONLY_PENDING_CLARIFICATION" },
    ...overrides,
  };
}

/** Minimal well-formed class-distribution body for the validator tests. */
function classesBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidate_key: KEY,
    coverage_status: "PARTIAL",
    total: 1,
    items: [
      {
        class_level: 1,
        class_code: "200",
        class_name: "농업지역",
        class_area_m2: 60000,
        share_of_evaluated_area: 0.69,
        share_of_cell_area: 0.368,
      },
    ],
    ...overrides,
  };
}

describe("formatAreaM2 / formatAreaKm2", () => {
  it("groups whole m² and keeps an exact measured zero as zero", () => {
    expect(formatAreaM2(162927.88768969654)).toBe("162,928 m²");
    expect(formatAreaM2(0)).toBe("0 m²");
  });

  it("never renders a real non-zero area as 0 m²", () => {
    // A 0.3 m² class sliver is real; "0 m²" would read as "this class is absent".
    expect(formatAreaM2(0.3)).toBe("1 m² 미만");
    expect(formatAreaM2(0.0001)).toBe("1 m² 미만");
  });

  it("returns an em dash — never zero — for an absent or non-finite area", () => {
    expect(formatAreaM2(null)).toBe("—");
    expect(formatAreaM2(undefined)).toBe("—");
    expect(formatAreaM2(Number.NaN)).toBe("—");
  });

  it("formats km² to three decimals and never zeroes a real area", () => {
    expect(formatAreaKm2(247457.8)).toBe("0.247 km²");
    expect(formatAreaKm2(0)).toBe("0 km²");
    expect(formatAreaKm2(12)).toBe("0.001 km² 미만");
    expect(formatAreaKm2(null)).toBe("—");
  });
});

describe("formatSharePercent", () => {
  it("renders one decimal and keeps a measured zero", () => {
    expect(formatSharePercent(0.6457453223110434)).toBe("64.6%");
    expect(formatSharePercent(1)).toBe("100%");
    expect(formatSharePercent(0)).toBe("0%");
  });

  it("never renders a real non-zero share as 0%", () => {
    expect(formatSharePercent(0.00012868292724526806)).toBe("0.1% 미만");
  });

  it("renders a null share (undefined denominator) as an em dash, never 0%", () => {
    // The API serves null for share_of_evaluated_area when there is no evaluated
    // area. Coercing that to 0% would assert a measurement that does not exist.
    expect(formatSharePercent(null)).toBe("—");
  });
});

describe("formatCoverageRatioPercent", () => {
  it("never shows a PARTIAL cell as 100% covered", () => {
    // Real LC3 value: the residual is non-empty but its area is ~1e-13 m².
    expect(formatCoverageRatioPercent(0.9999999999999876, "PARTIAL")).toBe("100% 미만");
    expect(formatCoverageRatioPercent(1, "PARTIAL")).toBe("100% 미만");
  });

  it("never shows a PARTIAL cell with a real sliver of coverage as 0%", () => {
    expect(formatCoverageRatioPercent(0.000001, "PARTIAL")).toBe("0.1% 미만");
  });

  it("reports COMPLETE_EXACT as 100% and NO_COVERAGE as 0% from the status", () => {
    // A COMPLETE_EXACT cell's stored ratio can be a float hair under 1.0; the status
    // is the authority, because it is decided by exact residual emptiness.
    expect(formatCoverageRatioPercent(0.9999999999999931, "COMPLETE_EXACT")).toBe("100%");
    expect(formatCoverageRatioPercent(0, "NO_COVERAGE")).toBe("0%");
  });

  it("formats an ordinary partial ratio to one decimal", () => {
    expect(formatCoverageRatioPercent(0.5336496085600222, "PARTIAL")).toBe("53.4%");
  });
});

describe("formatUncoveredRatioPercent", () => {
  it("never shows a PARTIAL cell as 0% uncovered", () => {
    expect(formatUncoveredRatioPercent(0.9999999999999876, "PARTIAL")).toBe("0.1% 미만");
  });

  it("is the complement of coverage for an ordinary partial cell", () => {
    expect(formatUncoveredRatioPercent(0.5336496085600222, "PARTIAL")).toBe("46.6%");
  });

  it("reports the full cell as uncovered for NO_COVERAGE and none for COMPLETE_EXACT", () => {
    expect(formatUncoveredRatioPercent(0, "NO_COVERAGE")).toBe("100%");
    expect(formatUncoveredRatioPercent(1, "COMPLETE_EXACT")).toBe("0%");
  });
});

describe("formatDominantClass", () => {
  it("renders code and official Korean name verbatim", () => {
    expect(formatDominantClass("321", "침엽수림")).toBe("321 · 침엽수림");
    // A middle-dot in the official name is part of the name; nothing is rewritten.
    expect(formatDominantClass("613", "암벽·바위")).toBe("613 · 암벽·바위");
  });

  it("states an absent dominant class explicitly, never as '' or a zero code", () => {
    const absent = formatDominantClass(null, null);
    expect(absent).toBe("해당 없음 (미평가)");
    expect(absent).not.toBe("");
    expect(absent).not.toContain("0");
    // And never a synthesized pseudo-class.
    expect(absent).not.toMatch(/Unknown|Unclassified|미분류|기타/);
  });
});

describe("coverage state vocabulary", () => {
  it("gives the three states three distinct tones", () => {
    const tones = new Set(Object.values(COVERAGE_STATUS_TONES));
    expect(tones.size).toBe(3);
  });

  it("never describes NO_COVERAGE as empty, unused, vacant, safe, or suitable land", () => {
    const caveat = COVERAGE_STATUS_CAVEATS.NO_COVERAGE;
    expect(caveat).toContain("평가하지 않았습니다");
    expect(caveat).toContain("토지피복이 없거나, 비어 있거나, 이용되지 않는 땅이라는 뜻이 아니며");
    expect(caveat).toContain("적합하거나 안전하다는 뜻도 아닙니다");
  });

  it("does not claim COMPLETE_EXACT is legally or universally complete", () => {
    const caveat = COVERAGE_STATUS_CAVEATS.COMPLETE_EXACT;
    expect(caveat).toContain("법적으로 완전하다거나");
    expect(caveat).toContain("모든 토지 상태를 알고 있다는 뜻은 아닙니다");
  });
});

describe("landCoverErrorKind", () => {
  it("maps a 404 to NOT_FOUND and everything else to UNAVAILABLE", () => {
    const notFound = new ApiError(
      404,
      { error: "CANDIDATE_CELL_NOT_FOUND", detail: "…", requested_year: null, available_years: [] },
      "CANDIDATE_CELL_NOT_FOUND",
    );
    expect(landCoverErrorKind(notFound)).toBe("NOT_FOUND");
    expect(landCoverErrorKind(new ApiError(500, null, "boom"))).toBe("UNAVAILABLE");
    expect(landCoverErrorKind(new TypeError("Failed to fetch"))).toBe("UNAVAILABLE");
    expect(landCoverErrorKind("weird")).toBe("UNAVAILABLE");
  });
});

describe("validateCellStatistics", () => {
  it("accepts a coherent response for the requested key", () => {
    expect(validateCellStatistics(cellBody(), KEY)).not.toBeNull();
  });

  it("rejects a response for a DIFFERENT candidate key", () => {
    // Last line of defence against a previous candidate's body being painted here.
    expect(validateCellStatistics(cellBody(), "capital-grid-500m-v1:1_1")).toBeNull();
  });

  it("rejects unknown coverage statuses and non-finite measurements", () => {
    expect(validateCellStatistics(cellBody({ coverage_status: "MOSTLY" }), KEY)).toBeNull();
    expect(validateCellStatistics(cellBody({ coverage_ratio: "0.5" }), KEY)).toBeNull();
    expect(validateCellStatistics(cellBody({ cell_area_m2: null }), KEY)).toBeNull();
    expect(validateCellStatistics(cellBody({ evaluated_area_m2: Number.NaN }), KEY)).toBeNull();
  });

  it("rejects a NO_COVERAGE cell that claims evaluated area", () => {
    const inconsistent = cellBody({ coverage_status: "NO_COVERAGE", evaluated_area_m2: 500 });
    expect(validateCellStatistics(inconsistent, KEY)).toBeNull();
  });

  it("accepts a NO_COVERAGE cell with all-null dominant classes", () => {
    const noCoverage = cellBody({
      coverage_status: "NO_COVERAGE",
      coverage_ratio: 0,
      evaluated_area_m2: 0,
      uncovered_area_m2: 149861.5,
      dominant_class: {
        l1_code: null,
        l1_name: null,
        l2_code: null,
        l2_name: null,
        l3_code: null,
        l3_name: null,
      },
    });
    const validated = validateCellStatistics(noCoverage, KEY);
    expect(validated).not.toBeNull();
    // Nulls survive validation as nulls — never defaulted to "" or a zero code.
    expect(validated?.dominant_class.l1_code).toBeNull();
  });

  it("rejects non-objects and a missing licence status", () => {
    expect(validateCellStatistics(null, KEY)).toBeNull();
    expect(validateCellStatistics("nope", KEY)).toBeNull();
    expect(validateCellStatistics(cellBody({ disclosures: {} }), KEY)).toBeNull();
  });
});

describe("validateClassDistribution", () => {
  it("accepts a coherent distribution and preserves both share denominators", () => {
    const validated = validateClassDistribution(classesBody(), KEY);
    expect(validated?.items[0].share_of_evaluated_area).toBe(0.69);
    expect(validated?.items[0].share_of_cell_area).toBe(0.368);
  });

  it("accepts an empty distribution for a NO_COVERAGE cell", () => {
    const empty = classesBody({ coverage_status: "NO_COVERAGE", total: 0, items: [] });
    expect(validateClassDistribution(empty, KEY)?.items).toEqual([]);
  });

  it("REJECTS a NO_COVERAGE distribution that arrives carrying class rows", () => {
    // The invariant that gives NO_COVERAGE its meaning. If a contract regression
    // ever sent rows for an unevaluated cell, they must not be rendered.
    const contradictory = classesBody({ coverage_status: "NO_COVERAGE", total: 1 });
    expect(validateClassDistribution(contradictory, KEY)).toBeNull();
  });

  it("rejects rows with an out-of-range level, blank code/name, or bad area", () => {
    const badLevel = classesBody({
      items: [
        {
          class_level: 4,
          class_code: "200",
          class_name: "농업지역",
          class_area_m2: 60000,
          share_of_evaluated_area: 0.69,
          share_of_cell_area: 0.368,
        },
      ],
    });
    expect(validateClassDistribution(badLevel, KEY)).toBeNull();
    const blankName = classesBody({
      items: [{ class_level: 1, class_code: "200", class_name: "", class_area_m2: 1 }],
    });
    expect(validateClassDistribution(blankName, KEY)).toBeNull();
    const badArea = classesBody({
      items: [{ class_level: 1, class_code: "200", class_name: "농업지역", class_area_m2: "60000" }],
    });
    expect(validateClassDistribution(badArea, KEY)).toBeNull();
  });

  it("accepts a null share_of_evaluated_area (undefined denominator)", () => {
    const nullShare = classesBody({
      items: [
        {
          class_level: 1,
          class_code: "200",
          class_name: "농업지역",
          class_area_m2: 60000,
          share_of_evaluated_area: null,
          share_of_cell_area: null,
        },
      ],
    });
    expect(validateClassDistribution(nullShare, KEY)?.items[0].share_of_evaluated_area).toBeNull();
  });

  it("rejects a distribution for a different key or a negative total", () => {
    expect(validateClassDistribution(classesBody(), "other:1_1")).toBeNull();
    expect(validateClassDistribution(classesBody({ total: -1 }), KEY)).toBeNull();
  });
});

describe("classRowsForLevel / classCountForLevel", () => {
  const items = [
    { class_level: 1 as const, class_code: "300", class_name: "산림지역", class_area_m2: 3, share_of_evaluated_area: 0.6, share_of_cell_area: 0.6 },
    { class_level: 1 as const, class_code: "700", class_name: "수역", class_area_m2: 2, share_of_evaluated_area: 0.3, share_of_cell_area: 0.3 },
    { class_level: 2 as const, class_code: "320", class_name: "침엽수림", class_area_m2: 1, share_of_evaluated_area: 0.5, share_of_cell_area: 0.5 },
    { class_level: 3 as const, class_code: "321", class_name: "침엽수림", class_area_m2: 1, share_of_evaluated_area: 0.5, share_of_cell_area: 0.5 },
  ];

  it("filters to one level, preserving the served order exactly", () => {
    expect(classRowsForLevel(items, 1).map((r) => r.class_code)).toEqual(["300", "700"]);
    expect(classRowsForLevel(items, 2).map((r) => r.class_code)).toEqual(["320"]);
    expect(classRowsForLevel(items, 3).map((r) => r.class_code)).toEqual(["321"]);
  });

  it("reads the distinct class count from the served counts", () => {
    const counts = {
      l1_class_count: 5,
      l2_class_count: 6,
      l3_class_count: 7,
      l1_class_area_sum_m2: 1,
      l2_class_area_sum_m2: 1,
      l3_class_area_sum_m2: 1,
    };
    expect(classCountForLevel(counts, 1)).toBe(5);
    expect(classCountForLevel(counts, 3)).toBe(7);
    expect(classCountForLevel(null, 1)).toBeNull();
  });
});

/**
 * Active-release validation (Phase 1B-LC5B). The map's whole immutability claim rests
 * on `statistics_version_id`, so a body that cannot supply a trustworthy one is
 * rejected rather than used to build a tile URL.
 */
describe("validateActiveRelease", () => {
  function releaseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      statistics_version_id: 1,
      status: "SUCCEEDED",
      candidate_grid_version: "capital-grid-500m-v1",
      expected_cell_count: 47893,
      processed_cell_count: 47893,
      coverage_status_counts: { COMPLETE_EXACT: 1, PARTIAL: 1, NO_COVERAGE: 1 },
      disclosures: {
        license_status: "LOCAL_USE_ONLY_PENDING_CLARIFICATION",
        used_in_suitability_scoring: false,
      },
      ...overrides,
    };
  }

  it("accepts a complete, succeeded release", () => {
    const release = validateActiveRelease(releaseBody());
    expect(release?.statistics_version_id).toBe(1);
    expect(release?.candidate_grid_version).toBe("capital-grid-500m-v1");
  });

  it.each([
    ["a non-object body", "not-an-object"],
    ["null", null],
  ])("rejects %s", (_label, raw) => {
    expect(validateActiveRelease(raw)).toBeNull();
  });

  it.each([
    ["a missing version id", { statistics_version_id: undefined }],
    ["a non-integer version id", { statistics_version_id: 1.5 }],
    ["a zero version id", { statistics_version_id: 0 }],
    ["a string version id", { statistics_version_id: "1" }],
  ])("rejects %s, so no tile URL is ever built from it", (_label, overrides) => {
    expect(validateActiveRelease(releaseBody(overrides))).toBeNull();
  });

  it("rejects a release that is not SUCCEEDED", () => {
    expect(validateActiveRelease(releaseBody({ status: "FAILED" }))).toBeNull();
    expect(validateActiveRelease(releaseBody({ status: "RUNNING" }))).toBeNull();
  });

  it("rejects a release whose processed count does not match its expected count", () => {
    // A partially-derived release must never be drawn as if it were complete.
    expect(validateActiveRelease(releaseBody({ processed_cell_count: 47000 }))).toBeNull();
  });

  it("rejects a body with no disclosures block", () => {
    expect(validateActiveRelease(releaseBody({ disclosures: undefined }))).toBeNull();
    expect(
      validateActiveRelease(releaseBody({ disclosures: { license_status: 1 } })),
    ).toBeNull();
  });

  it("preserves the served licence status rather than assuming one", () => {
    const release = validateActiveRelease(releaseBody());
    expect(release?.disclosures.license_status).toBe("LOCAL_USE_ONLY_PENDING_CLARIFICATION");
    expect(release?.disclosures.used_in_suitability_scoring).toBe(false);
  });
});
