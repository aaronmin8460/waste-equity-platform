import { describe, expect, it } from "vitest";

import {
  CHOROPLETH_PALETTE,
  METRICS,
  colorFor,
  computeBreaks,
  formatLegendValue,
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
