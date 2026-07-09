import { describe, expect, it } from "vitest";

import {
  CHOROPLETH_PALETTE,
  colorFor,
  computeBreaks,
  formatQuantity,
  frequencyLabel,
} from "./metrics";

describe("computeBreaks", () => {
  it("returns quantile thresholds for evenly spread values", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    const breaks = computeBreaks(values, 5);
    expect(breaks).toHaveLength(4);
    expect(breaks[0]).toBeGreaterThan(1);
    expect(breaks[3]).toBeLessThan(100);
    expect([...breaks]).toEqual([...breaks].sort((a, b) => a - b));
  });

  it("deduplicates thresholds for degenerate distributions", () => {
    const breaks = computeBreaks([5, 5, 5, 5, 5], 5);
    expect(new Set(breaks).size).toBe(breaks.length);
  });

  it("returns no thresholds for empty input", () => {
    expect(computeBreaks([], 5)).toEqual([]);
  });
});

describe("colorFor", () => {
  it("maps values into palette classes by threshold", () => {
    const breaks = [10, 20, 30, 40];
    expect(colorFor(5, breaks)).toBe(CHOROPLETH_PALETTE[0]);
    expect(colorFor(10, breaks)).toBe(CHOROPLETH_PALETTE[1]);
    expect(colorFor(35, breaks)).toBe(CHOROPLETH_PALETTE[3]);
    expect(colorFor(1000, breaks)).toBe(CHOROPLETH_PALETTE[4]);
  });

  it("never exceeds the palette for short break lists", () => {
    expect(colorFor(99, [1])).toBe(CHOROPLETH_PALETTE[1]);
  });
});

describe("formatQuantity", () => {
  it("keeps the exact value while trimming padded zeros", () => {
    expect(formatQuantity("83721.300000")).toBe("83,721.3");
    expect(formatQuantity("1000.000000")).toBe("1,000");
    expect(formatQuantity("0.000001")).toBe("0.000001");
    expect(formatQuantity("-120.500000")).toBe("-120.5");
  });

  it("returns unparseable input unchanged rather than guessing", () => {
    expect(formatQuantity("N/A")).toBe("N/A");
  });
});

describe("frequencyLabel", () => {
  it("labels the documented publication frequencies", () => {
    expect(frequencyLabel("ANNUAL")).toContain("Annual");
    expect(frequencyLabel("MONTHLY")).toContain("Monthly");
    expect(frequencyLabel("REAL_TIME")).toContain("Real-time");
    expect(frequencyLabel("STRUCTURAL")).toContain("Periodically");
  });

  it("passes through unknown values instead of mislabeling them", () => {
    expect(frequencyLabel("WEEKLY")).toBe("WEEKLY");
  });
});
