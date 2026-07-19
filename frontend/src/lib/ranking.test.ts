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
  it("classifies SGIS codes by their sido digits (Seoul 11 / Incheon 23 / Gyeonggi 31)", () => {
    expect(regionScope("KR-SGIS-11")).toBe("11");
    expect(regionScope("KR-SGIS-11110")).toBe("11");
    expect(regionScope("KR-SGIS-23510")).toBe("23");
    expect(regionScope("KR-SGIS-31011")).toBe("31");
    // Bare numeric codes work too.
    expect(regionScope("11110")).toBe("11");
  });

  it("maps RCIS derived-city codes to Gyeonggi (the seven cities are all 경기)", () => {
    expect(regionScope("KR-RCISRG-GOYANG")).toBe("31");
  });

  it("returns null for codes outside the metropolitan sido set", () => {
    expect(regionScope("KR-SGIS-99")).toBeNull();
    expect(regionScope("UNKNOWN")).toBeNull();
  });
});

describe("rankRegions", () => {
  const regions: RankableRegion[] = [
    region("KR-SGIS-11110", "종로구", 300),
    region("KR-SGIS-11140", "중구", 100),
    region("KR-SGIS-23510", "강화군", 200),
    region("KR-SGIS-31011", "수원시 장안구", 500),
    region("KR-SGIS-31013", "수원시 권선구", 0, "0"), // official measured zero — a real value
    region("KR-SGIS-11170", "용산구", undefined), // unavailable — must NOT become 0
  ];

  it("ranks only regions with an available value; excludes unavailable ones", () => {
    const result = rankRegions(regions, "all", 20);
    expect(result.rankedCount).toBe(5); // includes the official 0, excludes the undefined
    expect(result.excludedCount).toBe(1);
    const codes = result.high.map((r) => r.code);
    expect(codes).not.toContain("KR-SGIS-11170");
  });

  it("keeps an official zero distinct from unavailable (ranked, lowest)", () => {
    const result = rankRegions(regions, "all", 20);
    const lowest = result.low[0];
    expect(lowest.code).toBe("KR-SGIS-31013");
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
      region("KR-SGIS-31013", "B", 100),
      region("KR-SGIS-31011", "A", 100),
      region("KR-SGIS-11110", "C", 100),
    ];
    const result = rankRegions(tied, "all", 20);
    // Equal values → ascending code order, in BOTH lists.
    expect(result.high.map((r) => r.code)).toEqual([
      "KR-SGIS-11110",
      "KR-SGIS-31011",
      "KR-SGIS-31013",
    ]);
    expect(result.low.map((r) => r.code)).toEqual([
      "KR-SGIS-11110",
      "KR-SGIS-31011",
      "KR-SGIS-31013",
    ]);
  });

  it("filters by scope and re-ranks within the scope", () => {
    const result = rankRegions(regions, "31", 20);
    // Only the two Gyeonggi regions (500 and 0) are in scope.
    expect(result.high.map((r) => r.code)).toEqual(["KR-SGIS-31011", "KR-SGIS-31013"]);
    expect(result.rankedCount).toBe(2);
    expect(result.excludedCount).toBe(0);
  });

  it("limits each list to topN", () => {
    const many: RankableRegion[] = Array.from({ length: 30 }, (_, i) =>
      region(`KR-SGIS-111${String(i).padStart(2, "0")}`, `구${i}`, i),
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
    expect(SCOPE_LABELS["23"]).toBe("인천");
    expect(SCOPE_LABELS["31"]).toBe("경기");
  });

  it("treats a non-finite numeric as unavailable, never zero", () => {
    const bad: RankableRegion[] = [
      { code: "KR-SGIS-11110", name: "종로구", value: { numeric: NaN, display: "-" } },
      region("KR-SGIS-11140", "중구", 5),
    ];
    const result = rankRegions(bad, "all", 20);
    expect(result.rankedCount).toBe(1);
    expect(result.excludedCount).toBe(1);
  });
});
