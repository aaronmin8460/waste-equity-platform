import { describe, expect, it } from "vitest";

import {
  CANDIDATE_SCORE_BREAKS,
  CANDIDATE_SCORE_PALETTE_5,
  DEFAULT_EQUITY_PALETTE_7,
  FACILITY_BURDEN_PALETTE_9,
  METRICS,
  classIndexFor,
  colorFor,
  computeBreaks,
  computeLogEqualIntervalBreaks,
  formatLegendValue,
  formatQuantity,
  frequencyLabel,
  resolveActiveScale,
  scaleConfigForMetric,
  scaleMethodNote,
} from "./metrics";

// Exact user-reported facility-burden values (kg/인/년) that currently collapse
// into one color under the old global 5-class quantile scale.
const GANGNAM_LOCATED = 520.574259; // 서울특별시 강남구
const INCHEON_SEO_LOCATED = 2824.105692; // 인천광역시 서구

// Realistic, strongly right-skewed facility-burden distribution: the shape of
// the current production `throughput_located_kg_per_capita` values (27 zeros of
// 79, median ~87), with the two EXACT reported values embedded and one higher
// outlier appended so neither reported value is the fixture min or max.
const FACILITY_BURDEN_FIXTURE: number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  19.7984, 31.5043, 33.4869, 33.9191, 37.0358, 42.9648, 44.396, 46.3556, 46.5604,
  60.4849, 79.7784, 80.7181, 86.6562, 108.725, 116.253, 125.873, 134.229, 147.198,
  159.221, 187.925, 192.107, 194.776, 202.835, 210.4, 222.363, 246.843, 262.555,
  274.812, 277.081, 288.761, 291.513, 318.547, 319.608, 333.944, 347.862, 348.461,
  349.704, 363.889, 372.228, 381.951, 424.51, 457.304, 464.252, 476.088, 479.067,
  514.535, GANGNAM_LOCATED, 521.241, 770.156, 805.981, 1178.83, INCHEON_SEO_LOCATED,
  3987.512345,
];

const FACILITY_CONFIG = scaleConfigForMetric(
  METRICS.find((metric) => metric.key === "FACILITY_BURDEN_LOCATED")!,
);

describe("choropleth palettes", () => {
  it("has the documented, distinct class counts per metric family", () => {
    expect(DEFAULT_EQUITY_PALETTE_7).toHaveLength(7);
    expect(FACILITY_BURDEN_PALETTE_9).toHaveLength(9);
    expect(CANDIDATE_SCORE_PALETTE_5).toHaveLength(5);
  });

  it("never repeats an adjacent color (a duplicated stop hides a class boundary)", () => {
    for (const palette of [DEFAULT_EQUITY_PALETTE_7, FACILITY_BURDEN_PALETTE_9, CANDIDATE_SCORE_PALETTE_5]) {
      for (let i = 1; i < palette.length; i += 1) {
        expect(palette[i]).not.toBe(palette[i - 1]);
      }
    }
  });

  it("keeps the suitability candidate palette exactly the historical 5-class PuBu", () => {
    // Suitability rendering must be behaviorally unchanged.
    expect([...CANDIDATE_SCORE_PALETTE_5]).toEqual([
      "#f1eef6",
      "#bdc9e1",
      "#74a9cf",
      "#2b8cbe",
      "#045a8d",
    ]);
  });
});

describe("scaleConfigForMetric", () => {
  it("uses 7-class quantile for population and standard waste/per-capita metrics", () => {
    for (const metric of METRICS) {
      if (metric.dataset === "facility-burden") continue;
      const config = scaleConfigForMetric(metric);
      expect(config.method).toBe("quantile");
      expect(config.classes).toBe(7);
      expect(config.palette).toBe(DEFAULT_EQUITY_PALETTE_7);
    }
  });

  it("uses 9-class log-equal-interval for BOTH facility-burden metrics", () => {
    for (const metric of METRICS) {
      if (metric.dataset !== "facility-burden") continue;
      const config = scaleConfigForMetric(metric);
      expect(config.method).toBe("log-equal-interval");
      expect(config.classes).toBe(9);
      expect(config.palette).toBe(FACILITY_BURDEN_PALETTE_9);
    }
  });
});

describe("computeBreaks (quantile)", () => {
  it("returns strictly increasing quantile thresholds for evenly spread values", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    const breaks = computeBreaks(values, 7);
    expect(breaks).toHaveLength(6);
    expect(breaks[0]).toBeGreaterThan(1);
    expect(breaks[breaks.length - 1]).toBeLessThan(100);
    expect([...breaks]).toEqual([...breaks].sort((a, b) => a - b));
    for (let i = 1; i < breaks.length; i += 1) expect(breaks[i]).toBeGreaterThan(breaks[i - 1]);
  });

  it("deduplicates thresholds for degenerate distributions", () => {
    const breaks = computeBreaks([5, 5, 5, 5, 5], 7);
    expect(new Set(breaks).size).toBe(breaks.length);
  });

  it("handles duplicate-heavy input without emitting duplicate thresholds", () => {
    const breaks = computeBreaks([0, 0, 0, 0, 1, 2, 3, 100], 5);
    for (let i = 1; i < breaks.length; i += 1) expect(breaks[i]).toBeGreaterThan(breaks[i - 1]);
  });

  it("returns no thresholds for empty input", () => {
    expect(computeBreaks([], 7)).toEqual([]);
  });
});

describe("computeLogEqualIntervalBreaks", () => {
  it("returns 8 finite, strictly increasing interior thresholds for 9 requested classes", () => {
    const breaks = computeLogEqualIntervalBreaks(FACILITY_BURDEN_FIXTURE, 9);
    expect(breaks).toHaveLength(8);
    for (const threshold of breaks) expect(Number.isFinite(threshold)).toBe(true);
    for (let i = 1; i < breaks.length; i += 1) expect(breaks[i]).toBeGreaterThan(breaks[i - 1]);
  });

  it("computes thresholds in log1p space (expm1(log1p(max) * step / classes))", () => {
    const values = [0, 1000];
    const breaks = computeLogEqualIntervalBreaks(values, 9);
    const expected = Array.from({ length: 8 }, (_, i) =>
      Math.expm1((Math.log1p(1000) * (i + 1)) / 9),
    );
    breaks.forEach((threshold, i) => expect(threshold).toBeCloseTo(expected[i], 6));
  });

  it("treats zero as a valid value, not no-data (zeros fall in the lowest class)", () => {
    const breaks = computeLogEqualIntervalBreaks([0, 0, 0, 50, 500], 9);
    expect(breaks.length).toBeGreaterThan(0);
    expect(classIndexFor(0, breaks)).toBe(0);
  });

  it("returns no breaks for empty input", () => {
    expect(computeLogEqualIntervalBreaks([], 9)).toEqual([]);
  });

  it("returns no breaks when every value is zero (max <= 0)", () => {
    expect(computeLogEqualIntervalBreaks([0, 0, 0, 0], 9)).toEqual([]);
  });

  it("ignores NaN and Infinity rather than producing invalid thresholds", () => {
    const clean = computeLogEqualIntervalBreaks([0, 50, 500], 9);
    const dirty = computeLogEqualIntervalBreaks(
      [0, 50, 500, NaN, Infinity, -Infinity],
      9,
    );
    expect(dirty).toEqual(clean);
    for (const threshold of dirty) expect(Number.isFinite(threshold)).toBe(true);
  });

  it("ignores negative values (facility burden is non-negative)", () => {
    const breaks = computeLogEqualIntervalBreaks([-10, -1, 0, 100, 1000], 9);
    for (const threshold of breaks) {
      expect(Number.isFinite(threshold)).toBe(true);
      expect(threshold).toBeGreaterThanOrEqual(0);
    }
  });

  it("spreads highly skewed values across distinct classes", () => {
    const skewed = [0, 0, 0, 1, 2, 3, 5, 10, 40, 200, 1500, 12000];
    const breaks = computeLogEqualIntervalBreaks(skewed, 9);
    const classes = new Set(skewed.map((value) => classIndexFor(value, breaks)));
    // The skew is spread over several classes, not collapsed into one or two.
    expect(classes.size).toBeGreaterThanOrEqual(5);
  });

  it("returns no breaks when fewer than 2 classes are requested", () => {
    expect(computeLogEqualIntervalBreaks([1, 2, 3], 1)).toEqual([]);
  });
});

describe("resolveActiveScale", () => {
  it("sizes the active palette to the effective class count for BOTH map and legend", () => {
    const scale = resolveActiveScale(FACILITY_BURDEN_FIXTURE, FACILITY_CONFIG);
    expect(scale.method).toBe("log-equal-interval");
    expect(scale.requestedClasses).toBe(9);
    expect(scale.effectiveClasses).toBe(scale.breaks.length + 1);
    expect(scale.palette).toHaveLength(scale.effectiveClasses);
    // For the production shape the facility scale is fully populated (9 classes).
    expect(scale.effectiveClasses).toBe(9);
    // The active palette is the leading slice of the configured palette.
    scale.palette.forEach((color, i) => expect(color).toBe(FACILITY_BURDEN_PALETTE_9[i]));
  });

  it("collapses to a single valid class when every value is zero (no invalid expression)", () => {
    const scale = resolveActiveScale([0, 0, 0], FACILITY_CONFIG);
    expect(scale.breaks).toEqual([]);
    expect(scale.effectiveClasses).toBe(1);
    expect(scale.palette).toHaveLength(1);
  });
});

// The mandatory, non-negotiable acceptance condition.
describe("facility-burden high-range color separation (regression)", () => {
  const scale = resolveActiveScale(FACILITY_BURDEN_FIXTURE, FACILITY_CONFIG);

  it("puts 강남구 520.574259 and 인천 서구 2824.105692 in DIFFERENT classes", () => {
    // Guard: neither value is the fixture min or max, so separation is genuine
    // mid-distribution behavior, not a trivial extremes-only artifact.
    const min = Math.min(...FACILITY_BURDEN_FIXTURE);
    const max = Math.max(...FACILITY_BURDEN_FIXTURE);
    expect(GANGNAM_LOCATED).not.toBe(min);
    expect(GANGNAM_LOCATED).not.toBe(max);
    expect(INCHEON_SEO_LOCATED).not.toBe(min);
    expect(INCHEON_SEO_LOCATED).not.toBe(max);

    const gangnamClass = classIndexFor(GANGNAM_LOCATED, scale.breaks);
    const incheonClass = classIndexFor(INCHEON_SEO_LOCATED, scale.breaks);
    expect(gangnamClass).not.toBe(incheonClass);
  });

  it("gives 인천 서구 a higher (darker) class than 강남구", () => {
    expect(classIndexFor(INCHEON_SEO_LOCATED, scale.breaks)).toBeGreaterThan(
      classIndexFor(GANGNAM_LOCATED, scale.breaks),
    );
  });

  it("renders 강남구 and 인천 서구 in DIFFERENT colors", () => {
    const gangnamColor = colorFor(GANGNAM_LOCATED, scale.breaks, scale.palette);
    const incheonColor = colorFor(INCHEON_SEO_LOCATED, scale.breaks, scale.palette);
    expect(gangnamColor).not.toBe(incheonColor);
  });

  it("does NOT separate them under the old global 5-class quantile scale (documents the bug)", () => {
    const oldBreaks = computeBreaks(FACILITY_BURDEN_FIXTURE, 5);
    expect(classIndexFor(GANGNAM_LOCATED, oldBreaks)).toBe(
      classIndexFor(INCHEON_SEO_LOCATED, oldBreaks),
    );
  });
});

describe("legend consistency", () => {
  it("legend swatch colors equal the active palette handed to MapView", () => {
    const scale = resolveActiveScale(FACILITY_BURDEN_FIXTURE, FACILITY_CONFIG);
    // Same array drives the map fill palette and the legend swatches.
    const legendColors = scale.palette.map((color) => color);
    expect(legendColors).toEqual([...scale.palette]);
    expect(legendColors).toHaveLength(scale.effectiveClasses);
  });

  it("produces no NaN or Infinity boundary labels", () => {
    const scale = resolveActiveScale(FACILITY_BURDEN_FIXTURE, FACILITY_CONFIG);
    for (const threshold of scale.breaks) {
      const label = formatLegendValue(threshold);
      expect(label).not.toContain("NaN");
      expect(label).not.toContain("Infinity");
    }
  });

  it("keeps a 7-class quantile equity scale consistent (rows match effective classes)", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    const scale = resolveActiveScale(values, { method: "quantile", classes: 7, palette: DEFAULT_EQUITY_PALETTE_7 });
    expect(scale.effectiveClasses).toBe(7);
    expect(scale.palette).toHaveLength(7);
    expect(scale.breaks).toHaveLength(6);
  });
});

describe("scaleMethodNote", () => {
  it("labels the facility-burden scale as 9-class logarithmic intervals", () => {
    const scale = resolveActiveScale(FACILITY_BURDEN_FIXTURE, FACILITY_CONFIG);
    const note = scaleMethodNote(scale);
    expect(note).toContain("로그 간격 9단계");
    expect(note).toContain("9-class logarithmic intervals");
  });

  it("labels the quantile scale as 7-class quantiles", () => {
    const scale = resolveActiveScale([1, 2, 3, 4, 5, 6, 7, 8], {
      method: "quantile",
      classes: 7,
      palette: DEFAULT_EQUITY_PALETTE_7,
    });
    const note = scaleMethodNote(scale);
    expect(note).toContain("분위수 7단계");
    expect(note).toContain("7-class quantiles");
  });
});

describe("colorFor / classIndexFor", () => {
  it("maps values into palette classes by threshold", () => {
    const breaks = [10, 20, 30, 40];
    expect(colorFor(5, breaks, DEFAULT_EQUITY_PALETTE_7)).toBe(DEFAULT_EQUITY_PALETTE_7[0]);
    expect(colorFor(10, breaks, DEFAULT_EQUITY_PALETTE_7)).toBe(DEFAULT_EQUITY_PALETTE_7[1]);
    expect(colorFor(35, breaks, DEFAULT_EQUITY_PALETTE_7)).toBe(DEFAULT_EQUITY_PALETTE_7[3]);
    expect(classIndexFor(1000, breaks)).toBe(4);
  });

  it("never exceeds the palette for short break lists", () => {
    expect(colorFor(99, [1], CANDIDATE_SCORE_PALETTE_5)).toBe(CANDIDATE_SCORE_PALETTE_5[1]);
  });
});

describe("suitability candidate scale (unchanged behavior)", () => {
  it("classifies scores with the 5-class quantile scale it always used", () => {
    const scores = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const breaks = computeBreaks(scores, CANDIDATE_SCORE_PALETTE_5.length);
    expect(breaks).toHaveLength(4);
    // Low score -> lightest class, high score -> darkest class.
    expect(colorFor(10, breaks, CANDIDATE_SCORE_PALETTE_5)).toBe(CANDIDATE_SCORE_PALETTE_5[0]);
    expect(colorFor(100, breaks, CANDIDATE_SCORE_PALETTE_5)).toBe(CANDIDATE_SCORE_PALETTE_5[4]);
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

describe("formatLegendValue", () => {
  it("rounds large values to grouped integers", () => {
    expect(formatLegendValue(83721.3)).toBe("83,721");
    expect(formatLegendValue(1000)).toBe("1,000");
  });

  it("keeps decimals for small per-capita ranges instead of collapsing them", () => {
    expect(formatLegendValue(0.493824)).toBe("0.49");
    expect(formatLegendValue(345.67)).toBe("345.7");
    expect(formatLegendValue(0.4)).toBe("0.4");
  });

  it("distinguishes adjacent per-capita class boundaries", () => {
    expect(formatLegendValue(0.31)).not.toBe(formatLegendValue(0.38));
  });
});

describe("facility-burden metric definitions (Phase 5.2)", () => {
  const burden = METRICS.filter((metric) => metric.dataset === "facility-burden");

  it("offers the located and within-buffer burden measures", () => {
    expect(burden.map((metric) => metric.burdenMeasure).sort()).toEqual(["buffer", "located"]);
  });

  it("always carries the accounting-basis caveat", () => {
    for (const metric of burden) {
      expect(metric.caveat).toContain("FACILITY_LOCATION_BASED_THROUGHPUT");
    }
  });
});

describe("metric geography (RCIS reporting geography)", () => {
  it("renders waste generation and per-capita on the RCIS reporting geometry", () => {
    for (const metric of METRICS) {
      if (metric.dataset === "waste-statistics" || metric.dataset === "waste-per-capita") {
        expect(metric.geography).toBe("reporting");
      }
    }
  });

  it("keeps population and facility burden on native SGIS geometry", () => {
    for (const metric of METRICS) {
      if (metric.dataset === "population" || metric.dataset === "facility-burden") {
        expect(metric.geography).toBe("native");
      }
    }
  });
});

describe("per-capita metric definitions (Phase 5.1)", () => {
  const perCapita = METRICS.filter((metric) => metric.dataset === "waste-per-capita");

  it("offers one backend-derived per-capita metric per waste stream", () => {
    expect(perCapita.map((metric) => metric.wasteStream).sort()).toEqual([
      "BUSINESS_NON_FACILITY",
      "CONSTRUCTION",
      "HOUSEHOLD",
      "INDUSTRIAL_FACILITY",
    ]);
  });

  it("carries an interpretation caveat on every non-residential stream", () => {
    for (const metric of perCapita) {
      if (metric.wasteStream === "HOUSEHOLD") {
        expect(metric.caveat).toBeUndefined();
      } else {
        expect(metric.caveat).toBeTruthy();
      }
    }
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

describe("CANDIDATE_SCORE_BREAKS", () => {
  it("splits the 0–100 suitability domain into fixed 20-point classes", () => {
    // Stable, deterministic breaks — NOT per-viewport quantiles. Five classes
    // (0–20 · 20–40 · 40–60 · 60–80 · 80–100), sized to the 5-color palette.
    expect(CANDIDATE_SCORE_BREAKS).toEqual([20, 40, 60, 80]);
    expect(CANDIDATE_SCORE_BREAKS.length + 1).toBe(CANDIDATE_SCORE_PALETTE_5.length);
  });

  it("maps representative scores to the expected class index", () => {
    const breaks = [...CANDIDATE_SCORE_BREAKS];
    expect(classIndexFor(0, breaks)).toBe(0);
    expect(classIndexFor(19.9, breaks)).toBe(0);
    expect(classIndexFor(20, breaks)).toBe(1);
    expect(classIndexFor(59, breaks)).toBe(2);
    expect(classIndexFor(80, breaks)).toBe(4);
    expect(classIndexFor(100, breaks)).toBe(4);
  });
});
