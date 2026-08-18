/**
 * 시·군·구 grouping — a PRESENTATION grouping and, critically, nothing more.
 *
 * The load-bearing test in this file is "produces no aggregate of any kind": the
 * owner explicitly rejected a per-시·군·구 average / median / synthetic group rank
 * even though the Figma sheet `167-11235` illustrates one ("안산시: 평균 순위 2위").
 * That refusal is only durable if it is asserted, so the shape of a group is pinned
 * key by key here.
 */

import { describe, expect, it } from "vitest";

import {
  SIGUNGU_GROUPING_NOTE,
  UNASSIGNED_SIGUNGU_LABEL,
  groupRowsBySigungu,
  splitQualifiedRegionName,
} from "./scenarioSigunguGroups";

interface Row {
  candidateKey: string;
  sigunguName: string | null;
  sidoName: string | null;
  rank: number;
}

const row = (
  candidateKey: string,
  sigunguName: string | null,
  rank: number,
  sidoName: string | null = null,
): Row => ({ candidateKey, sigunguName, sidoName, rank });

describe("splitQualifiedRegionName", () => {
  it("splits the backend's already-qualified name into 시·도 and 시·군·구", () => {
    expect(splitQualifiedRegionName("인천광역시 옹진군")).toEqual({
      sido: "인천광역시",
      sigungu: "옹진군",
    });
    expect(splitQualifiedRegionName("경기도 안산시 단원구")).toEqual({
      sido: "경기도",
      sigungu: "안산시 단원구",
    });
  });

  it("returns an unrecognised name whole rather than guessing a prefix", () => {
    expect(splitQualifiedRegionName("강화군")).toEqual({ sido: null, sigungu: "강화군" });
  });

  it("keeps a bare 시·도 as its own label instead of producing an empty 시·군·구", () => {
    expect(splitQualifiedRegionName("서울특별시")).toEqual({
      sido: null,
      sigungu: "서울특별시",
    });
  });
});

describe("groupRowsBySigungu", () => {
  it("states the 시·군·구 once and keeps every candidate as its own row", () => {
    const groups = groupRowsBySigungu([
      row("a", "인천광역시 옹진군", 1),
      row("b", "인천광역시 옹진군", 2),
      row("c", "인천광역시 강화군", 3),
      row("d", "인천광역시 옹진군", 4),
    ]);

    expect(groups.map((g) => g.label)).toEqual(["옹진군", "강화군"]);
    expect(groups[0].sidoLabel).toBe("인천광역시");
    // Three candidates, three rows — the grouping merges nothing.
    expect(groups[0].rows.map((r) => r.candidateKey)).toEqual(["a", "b", "d"]);
    expect(groups[1].rows.map((r) => r.candidateKey)).toEqual(["c"]);
    // Each row still carries its own rank, untouched.
    expect(groups[0].rows.map((r) => r.rank)).toEqual([1, 2, 4]);
  });

  it("orders groups by where their FIRST member appeared, never by an aggregate", () => {
    // 강화군 leads because its best candidate is the first row, not because any
    // number was computed over the group.
    const groups = groupRowsBySigungu([
      row("c", "인천광역시 강화군", 1),
      row("a", "인천광역시 옹진군", 2),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["강화군", "옹진군"]);
  });

  it("⛔ produces NO group score, rank, average, median or 변동폭", () => {
    const groups = groupRowsBySigungu([
      row("a", "인천광역시 옹진군", 3),
      row("b", "인천광역시 옹진군", 9),
    ]);
    const group = groups[0];

    // The complete shape of a group, pinned. A future edit that adds `averageRank`,
    // `medianRank`, `groupScore` or `variability` fails HERE, which is the point.
    expect(Object.keys(group).sort()).toEqual(["key", "label", "rows", "sidoLabel", "size"]);

    // `size` is the ONLY number, and it is a count of rows — not a measurement of
    // the 시·군·구. It is neither the mean (6) nor the sum (12) of the members' ranks.
    expect(group.size).toBe(2);
    expect(group.size).not.toBe(6);
    expect(group.size).not.toBe(12);
  });

  it("falls back to the 시·도 for a cell with no 시·군·구, and never fabricates a place", () => {
    const groups = groupRowsBySigungu([
      row("a", null, 1, "경기도"),
      row("b", null, 2, null),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["경기도", UNASSIGNED_SIGUNGU_LABEL]);
  });

  it("sorts the unassigned bucket last, so an absence never leads a real place", () => {
    const groups = groupRowsBySigungu([
      row("b", null, 1, null),
      row("a", "인천광역시 강화군", 2),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["강화군", UNASSIGNED_SIGUNGU_LABEL]);
  });

  it("treats a blank served name as absent rather than as a place called ''", () => {
    const groups = groupRowsBySigungu([row("a", "   ", 1, "  ")]);
    expect(groups[0].label).toBe(UNASSIGNED_SIGUNGU_LABEL);
  });

  it("returns nothing for no rows", () => {
    expect(groupRowsBySigungu([])).toEqual([]);
  });
});

describe("the grouping note", () => {
  it("says the heading is a label and that no 시·군·구 average or rank is made", () => {
    expect(SIGUNGU_GROUPING_NOTE).toContain("이름표");
    expect(SIGUNGU_GROUPING_NOTE).toContain("평균");
    expect(SIGUNGU_GROUPING_NOTE).toContain("따로 순위를 매기지 않습니다");
  });
});
