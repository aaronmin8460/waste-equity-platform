import { describe, expect, it } from "vitest";

import {
  compareRegionsForDisplay,
  formatRegionMetricDisplay,
  regionDisplayName,
  regionUnavailableReasonLabel,
} from "./regionDisplay";

describe("formatRegionMetricDisplay", () => {
  it("renders a served person count in the readable 만 명 unit", () => {
    // The owner's readability override: a single region's headline value reads in
    // 만 명 rather than full digits. 142,000 / 10,000 is exactly 14.2, so nothing was
    // discarded and no 약 is claimed.
    expect(formatRegionMetricDisplay("142,000", "persons", null)).toBe("14.2만 명");
  });

  it("marks a person count as approximate when 만 명 rounding drops digits", () => {
    expect(formatRegionMetricDisplay("1,004,079", "persons", null)).toBe("약 100.4만 명");
  });

  it("never renders a real person count as zero", () => {
    expect(formatRegionMetricDisplay("400", "persons", null)).toBe("0.1만 명 미만");
  });

  it("falls back to the exact value with its printed unit when 만 명 cannot parse", () => {
    // Unparseable input must never become a fabricated figure — the served value is
    // printed unchanged, with the spacing Figma gives the counter word.
    expect(formatRegionMetricDisplay("n/a", "persons", null)).toBe("n/a 명");
  });

  it("keeps the space before a symbol unit it does not translate", () => {
    expect(formatRegionMetricDisplay("12.3", "kg/인/년", null)).toBe("12.3 kg/인/년");
  });

  it("omits a trailing space when there is no unit", () => {
    expect(formatRegionMetricDisplay("142,000", "", null)).toBe("142,000");
  });

  it("shows the availability reason (never a 0) when there is no served value", () => {
    const text = formatRegionMetricDisplay(undefined, "kg/인/년", "SOURCE_NOT_REPORTED");
    expect(text).toContain("데이터 없음");
    expect(text).toContain("출처에서 해당 지역·항목을 보고하지 않음");
    expect(text).not.toContain("0");
  });

  it("falls back to a generic no-data label when no reason is given", () => {
    expect(formatRegionMetricDisplay(undefined, "persons", null)).toBe("데이터 없음");
  });

  it("passes an unknown reason code through verbatim", () => {
    expect(formatRegionMetricDisplay(undefined, "u", "SOME_NEW_CODE")).toContain("SOME_NEW_CODE");
  });
});

describe("regionUnavailableReasonLabel", () => {
  it("returns an empty string for a null/empty reason", () => {
    expect(regionUnavailableReasonLabel(null)).toBe("");
    expect(regionUnavailableReasonLabel(undefined)).toBe("");
  });

  it("maps a known reason code to its Korean label", () => {
    expect(regionUnavailableReasonLabel("COARSER_REPORTING_GEOGRAPHY")).toBe(
      "상위 보고 단위로 보고됨",
    );
  });

  it("keeps every served reason, with no English restatement left in any of them", () => {
    // The REASONS are the missing-data disclosure and must all survive; only the
    // bracketed English translation beside each was dropped.
    for (const code of [
      "SOURCE_NOT_REPORTED",
      "COARSER_REPORTING_GEOGRAPHY",
      "SOURCE_ROW_REJECTED",
      "UNMATCHED_REGION_LABEL",
      "AMBIGUOUS_REGION_LABEL",
    ]) {
      const label = regionUnavailableReasonLabel(code);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/[A-Za-z]/);
    }
  });
});

describe("regionDisplayName", () => {
  it("prefixes a sigungu name with its metropolitan area", () => {
    expect(regionDisplayName("KR-SGIS-11110", "종로구")).toBe("서울 종로구");
    expect(regionDisplayName("KR-SGIS-23510", "강화군")).toBe("인천 강화군");
    expect(regionDisplayName("KR-SGIS-31011", "수원시 장안구")).toBe("경기 수원시 장안구");
  });

  it("distinguishes the two 중구 without showing either raw code", () => {
    const seoul = regionDisplayName("KR-SGIS-11140", "중구");
    const incheon = regionDisplayName("KR-SGIS-23010", "중구");
    expect(seoul).toBe("서울 중구");
    expect(incheon).toBe("인천 중구");
    expect(seoul).not.toBe(incheon);
    for (const label of [seoul, incheon]) {
      expect(label).not.toContain("KR-SGIS");
      expect(label).not.toMatch(/\d/);
    }
  });

  it("maps the RCIS derived-city codes to 경기, matching regionScope", () => {
    expect(regionDisplayName("KR-RCISRG-SUWON", "수원시")).toBe("경기 수원시");
  });

  it("does not double-prefix a name that already leads with its metro word", () => {
    expect(regionDisplayName("KR-SGIS-23010", "인천 중구")).toBe("인천 중구");
  });

  it("leaves a code outside the capital region unprefixed rather than inventing one", () => {
    expect(regionDisplayName("KR-SGIS-48170", "통영시")).toBe("통영시");
  });
});

describe("compareRegionsForDisplay", () => {
  const r = (code: string, name: string) => ({ code, name });

  it("orders 서울 → 인천 → 경기, then by name", () => {
    const sorted = [
      r("KR-SGIS-31011", "수원시 장안구"),
      r("KR-SGIS-23010", "중구"),
      r("KR-SGIS-11140", "중구"),
      r("KR-SGIS-11110", "종로구"),
    ].sort(compareRegionsForDisplay);
    expect(sorted.map((x) => regionDisplayName(x.code, x.name))).toEqual([
      "서울 종로구",
      "서울 중구",
      "인천 중구",
      "경기 수원시 장안구",
    ]);
  });

  it("sorts unclassified codes after every capital-region group", () => {
    const sorted = [r("KR-SGIS-48170", "통영시"), r("KR-SGIS-11110", "종로구")].sort(
      compareRegionsForDisplay,
    );
    expect(sorted.map((x) => x.code)).toEqual(["KR-SGIS-11110", "KR-SGIS-48170"]);
  });

  it("breaks a same-name, same-scope tie by code so the order is reproducible", () => {
    const a = r("KR-SGIS-11140", "중구");
    const b = r("KR-SGIS-11145", "중구");
    expect(compareRegionsForDisplay(a, b)).toBeLessThan(0);
    expect(compareRegionsForDisplay(b, a)).toBeGreaterThan(0);
    expect(compareRegionsForDisplay(a, a)).toBe(0);
  });
});
