/**
 * 결과 안정성 등급 — the three-bucket band from the page-5 기술 참고사항 (`167-11232`).
 *
 * The thresholds are pinned to the exact values the design source names, and the
 * "no movement is NOT stable" rule is asserted separately, because a green dot on an
 * unknown movement is the one failure that would make this band actively misleading.
 */

import { describe, expect, it } from "vitest";

import {
  MEDIUM_THRESHOLD,
  RANK_VARIABILITY_META,
  RANK_VARIABILITY_ORDER,
  RANK_VARIABILITY_SOURCE_NOTE,
  STABLE_THRESHOLD,
  rankVariabilityLevel,
  rankVariabilityMeta,
} from "./rankVariability";

describe("the constants the design source names", () => {
  it("uses STABLE_THRESHOLD = 4 and MEDIUM_THRESHOLD = 9", () => {
    expect(STABLE_THRESHOLD).toBe(4);
    expect(MEDIUM_THRESHOLD).toBe(9);
  });
});

describe("rankVariabilityLevel", () => {
  it("bands ±4 이하 as 안정성 높음", () => {
    for (const movement of [0, 1, 4, -4]) {
      expect(rankVariabilityLevel(movement), String(movement)).toBe("STABLE");
    }
  });

  it("bands ±5~9 as 보통", () => {
    for (const movement of [5, 7, 9, -9]) {
      expect(rankVariabilityLevel(movement), String(movement)).toBe("MEDIUM");
    }
  });

  it("bands ±10 이상 as 변동성 높음", () => {
    for (const movement of [10, 17, 300, -10]) {
      expect(rankVariabilityLevel(movement), String(movement)).toBe("VOLATILE");
    }
  });

  it("reads the MAGNITUDE, so a rise and a fall of the same size band alike", () => {
    expect(rankVariabilityLevel(7)).toBe(rankVariabilityLevel(-7));
  });

  it("returns null — never STABLE — when there is no exact movement", () => {
    // The load-bearing case: "we do not know" must not render as a green dot.
    expect(rankVariabilityLevel(null)).toBeNull();
    expect(rankVariabilityLevel(undefined)).toBeNull();
    expect(rankVariabilityLevel(Number.NaN)).toBeNull();
    expect(rankVariabilityMeta(null)).toBeNull();
  });
});

describe("the band metadata", () => {
  it("uses 초록 / 노랑 / 빨강 in the order the sheet gives them", () => {
    expect(RANK_VARIABILITY_ORDER).toEqual(["STABLE", "MEDIUM", "VOLATILE"]);
    expect(RANK_VARIABILITY_META.STABLE.dot).toContain("success");
    expect(RANK_VARIABILITY_META.MEDIUM.dot).toContain("warn");
    expect(RANK_VARIABILITY_META.VOLATILE.dot).toContain("danger");
  });

  it("carries the sheet's own band names, so colour is never the only signal", () => {
    expect(RANK_VARIABILITY_META.STABLE.label).toBe("안정성 높음");
    expect(RANK_VARIABILITY_META.MEDIUM.label).toBe("보통");
    expect(RANK_VARIABILITY_META.VOLATILE.label).toBe("변동성 높음");
  });

  it("derives each band's printed range from the two constants", () => {
    expect(RANK_VARIABILITY_META.STABLE.detail).toBe("4계단 이하");
    expect(RANK_VARIABILITY_META.MEDIUM.detail).toBe("5~9계단");
    expect(RANK_VARIABILITY_META.VOLATILE.detail).toBe("10계단 이상");
  });
});

describe("the source note", () => {
  it("says these are screen thresholds, not an official policy threshold", () => {
    // The design sheet insists on exactly this qualification.
    expect(RANK_VARIABILITY_SOURCE_NOTE).toContain("화면 표시 기준");
    expect(RANK_VARIABILITY_SOURCE_NOTE).toContain("공식 기준이 아닙니다");
    // …and distinguishes the band from the run's own frozen stability class.
    expect(RANK_VARIABILITY_SOURCE_NOTE).toContain("실행 안정성");
  });
});
