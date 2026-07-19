import { describe, expect, it } from "vitest";

import {
  type RankableRegion,
  SCOPE_LABELS,
  rankRegions,
  regionScope,
} from "./ranking";

function region(code: string, name: string, numeric?: number, display?: string): RankableRegion {
  return {
    code,
    name,
    value: numeric === undefined ? undefined : { numeric, display: display ?? String(numeric) },
  };
}

describe("regionScope", () => {
  it("classifies SGIS numeric codes by leading sido digits", () => {
    expect(regionScope("11")).toBe("11");
    expect(regionScope("11110")).toBe("11");
    expect(regionScope("28710")).toBe("28");
    expect(regionScope("41135")).toBe("41");
  });

  it("maps RCIS derived-city codes to Gyeonggi (the seven cities are all 경기)", () => {
    expect(regionScope("KR-RCISRG-GOYANG")).toBe("41");
  });

  it("returns null for codes outside the metropolitan sido set", () => {
    expect(regionScope("50110")).toBeNull();
    expect(regionScope("UNKNOWN")).toBeNull();
  });
});

describe("rankRegions", () => {
  const regions: RankableRegion[] = [
    region("11110", "종로구", 300),
    region("11140", "중구", 100),
    region("28710", "강화군", 200),
    region("41135", "성남시", 500),
    region("41111", "수원시", 0, "0"), // official measured zero — a real value
    region("11170", "용산구", undefined), // unavailable — must NOT become 0
  ];

  it("ranks only regions with an available value; excludes unavailable ones", () => {
    const result = rankRegions(regions, "all", 20);
    expect(result.rankedCount).toBe(5); // includes the official 0, excludes the undefined
    expect(result.excludedCount).toBe(1);
    const codes = result.high.map((r) => r.code);
    expect(codes).not.toContain("11170");
  });

  it("keeps an official zero distinct from unavailable (ranked, lowest)", () => {
    const result = rankRegions(regions, "all", 20);
    const lowest = result.low[0];
    expect(lowest.code).toBe("41111");
    expect(lowest.numeric).toBe(0);
    expect(lowest.display).toBe("0");
  });

  it("sorts high value descending and low value ascending with sequential ranks", () => {
    const result = rankRegions(regions, "all", 20);
    expect(result.high.map((r) => r.numeric)).toEqual([500, 300, 200, 100, 0]);
    expect(result.high.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(result.low.map((r) => r.numeric)).toEqual([0, 100, 200, 300, 500]);
    expect(result.low.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("breaks ties deterministically by region code ascending", () => {
    const tied: RankableRegion[] = [
      region("41135", "B시", 100),
      region("41111", "A시", 100),
      region("11110", "C구", 100),
    ];
    const result = rankRegions(tied, "all", 20);
    // Equal values → ascending code order, in BOTH lists.
    expect(result.high.map((r) => r.code)).toEqual(["11110", "41111", "41135"]);
    expect(result.low.map((r) => r.code)).toEqual(["11110", "41111", "41135"]);
  });

  it("filters by scope and re-ranks within the scope", () => {
    const result = rankRegions(regions, "41", 20);
    // Only the two Gyeonggi regions (500 and 0) are in scope.
    expect(result.high.map((r) => r.code)).toEqual(["41135", "41111"]);
    expect(result.rankedCount).toBe(2);
    expect(result.excludedCount).toBe(0);
  });

  it("limits each list to topN", () => {
    const many: RankableRegion[] = Array.from({ length: 30 }, (_, i) =>
      region(`111${String(i).padStart(2, "0")}`, `구${i}`, i),
    );
    const result = rankRegions(many, "all", 5);
    expect(result.high).toHaveLength(5);
    expect(result.low).toHaveLength(5);
    expect(result.high[0].numeric).toBe(29);
    expect(result.low[0].numeric).toBe(0);
  });

  it("exposes plain Korean scope labels without English", () => {
    expect(SCOPE_LABELS.all).toBe("수도권 전체");
    expect(SCOPE_LABELS["11"]).toBe("서울");
    expect(SCOPE_LABELS["28"]).toBe("인천");
    expect(SCOPE_LABELS["41"]).toBe("경기");
  });

  it("treats a non-finite numeric as unavailable, never zero", () => {
    const bad: RankableRegion[] = [
      { code: "11110", name: "종로구", value: { numeric: NaN, display: "-" } },
      region("11140", "중구", 5),
    ];
    const result = rankRegions(bad, "all", 20);
    expect(result.rankedCount).toBe(1);
    expect(result.excludedCount).toBe(1);
  });
});
