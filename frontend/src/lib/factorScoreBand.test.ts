/**
 * 지수 점수 라벨 — the absolute per-factor band table from Figma image `352:1255`.
 *
 * The cut points are pinned to the source table, and the "a missing score is not a
 * low score" rule is asserted, because banding an absent value as 부적합 would turn a
 * data gap into an adverse finding about a candidate.
 */

import { describe, expect, it } from "vitest";

import {
  FACTOR_SCORE_BANDS,
  FACTOR_SCORE_BAND_SOURCE_NOTE,
  factorScoreBand,
  factorScoreBandLabel,
} from "./factorScoreBand";

describe("the band table", () => {
  it("is the five bands the design source lists, highest first", () => {
    expect(FACTOR_SCORE_BANDS.map((b) => b.label)).toEqual([
      "우수",
      "양호",
      "보통",
      "미흡",
      "부적합",
    ]);
    expect(FACTOR_SCORE_BANDS.map((b) => b.range)).toEqual([
      "80~100",
      "60~79",
      "40~59",
      "20~39",
      "0~19",
    ]);
  });
});

describe("factorScoreBand", () => {
  it("labels each band's boundary exactly as the integer table reads", () => {
    expect(factorScoreBandLabel(100)).toBe("우수");
    expect(factorScoreBandLabel(80)).toBe("우수");
    expect(factorScoreBandLabel(79)).toBe("양호");
    expect(factorScoreBandLabel(60)).toBe("양호");
    expect(factorScoreBandLabel(59)).toBe("보통");
    expect(factorScoreBandLabel(40)).toBe("보통");
    expect(factorScoreBandLabel(39)).toBe("미흡");
    expect(factorScoreBandLabel(20)).toBe("미흡");
    expect(factorScoreBandLabel(19)).toBe("부적합");
    expect(factorScoreBandLabel(0)).toBe("부적합");
  });

  it("reads the served DECIMAL string a candidate detail actually carries", () => {
    // Component scores arrive as exact decimal strings, never as numbers.
    expect(factorScoreBandLabel("90.0000")).toBe("우수");
    expect(factorScoreBandLabel("79.9999")).toBe("양호");
    expect(factorScoreBandLabel("20.0000")).toBe("미흡");
  });

  it("returns null for a missing score — a data gap is never 부적합", () => {
    expect(factorScoreBand(null)).toBeNull();
    expect(factorScoreBand(undefined)).toBeNull();
    expect(factorScoreBand("")).toBeNull();
    expect(factorScoreBand("not-a-number")).toBeNull();
  });

  it("refuses an out-of-range value rather than clamping it", () => {
    // Outside 0–100 the score is not the normalised quantity this table describes;
    // clamping would hide that rather than surface it.
    expect(factorScoreBand(101)).toBeNull();
    expect(factorScoreBand(-1)).toBeNull();
  });
});

describe("the source note", () => {
  it("says the labels are a screen convention, not a 적합·부적합 determination", () => {
    expect(FACTOR_SCORE_BAND_SOURCE_NOTE).toContain("화면 표기 기준");
    expect(FACTOR_SCORE_BAND_SOURCE_NOTE).toContain("법적 적합·부적합 판정");
    expect(FACTOR_SCORE_BAND_SOURCE_NOTE).toContain("스크리닝");
  });
});
