import { describe, expect, it } from "vitest";

import type { LandfillDestinationNode, LandfillFlow } from "./api";
import {
  MAX_LINE_WIDTH,
  MIN_LINE_WIDTH,
  buildFlowFeatures,
  buildNodeFeatures,
  formatEffectiveFee,
  formatKrwEok,
  formatShare,
  formatTons,
  lineWidthForQuantity,
} from "./flow";

function flow(overrides: Partial<LandfillFlow>): LandfillFlow {
  return {
    origin_region_code: "KR-SGIS-11",
    origin_sgis_code: "11",
    origin_name: "서울시",
    origin_name_en: "Seoul",
    origin_point: { lon: 126.978, lat: 37.5665 },
    destination_code: "SUDOKWON_LANDFILL",
    destination_name: "수도권매립지",
    destination_name_en: "Sudokwon Landfill",
    destination_point: { lon: 126.618, lat: 37.5776 },
    quantity_kg: "1000000",
    quantity_tons: "1000.000000",
    inbound_fee_krw: "50000000",
    quantity_share: "0.5",
    effective_fee_per_ton: "50000.00",
    evidence_status: "OFFICIAL_REPORTED_VALUE",
    ...overrides,
  };
}

const destination: LandfillDestinationNode = {
  code: "SUDOKWON_LANDFILL",
  name: "수도권매립지",
  name_en: "Sudokwon Landfill",
  point: { lon: 126.618, lat: 37.5776 },
  coordinate_provenance: "representative",
};

describe("formatting", () => {
  it("formats tonnes from kilograms", () => {
    expect(formatTons("1000000")).toBe("1,000 t");
  });

  it("formats KRW as 억원", () => {
    expect(formatKrwEok("11570000000")).toBe("115.7억원");
  });

  it("formats a share as a percent, and null as a dash", () => {
    expect(formatShare("0.397")).toBe("39.7%");
    expect(formatShare(null)).toBe("—");
  });

  it("formats an effective fee, and null as a dash", () => {
    expect(formatEffectiveFee("89483.00")).toBe("89,483 원/t");
    expect(formatEffectiveFee(null)).toBe("—");
  });
});

describe("lineWidthForQuantity", () => {
  it("scales between the min and max widths", () => {
    expect(lineWidthForQuantity(0, 100)).toBe(MIN_LINE_WIDTH);
    expect(lineWidthForQuantity(100, 100)).toBe(MAX_LINE_WIDTH);
    expect(lineWidthForQuantity(50, 100)).toBeCloseTo((MIN_LINE_WIDTH + MAX_LINE_WIDTH) / 2);
  });

  it("returns the min width when there is no maximum", () => {
    expect(lineWidthForQuantity(5, 0)).toBe(MIN_LINE_WIDTH);
  });
});

describe("buildFlowFeatures", () => {
  it("builds one straight LineString per flow, widest for the largest quantity", () => {
    const fc = buildFlowFeatures([
      flow({ origin_sgis_code: "11", quantity_kg: "2000000" }),
      flow({ origin_sgis_code: "41", quantity_kg: "1000000" }),
    ]);
    expect(fc.features).toHaveLength(2);
    const [seoul, gyeonggi] = fc.features;
    expect(seoul.geometry.type).toBe("LineString");
    expect(seoul.geometry.coordinates).toHaveLength(2);
    // The larger flow gets the maximum width.
    expect(seoul.properties.width).toBe(MAX_LINE_WIDTH);
    expect(gyeonggi.properties.width).toBeLessThan(seoul.properties.width);
  });

  it("never produces more than the flows given (metropolitan-only)", () => {
    const fc = buildFlowFeatures([flow({})]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features.every((f) => f.properties.origin_region_code.startsWith("KR-SGIS-"))).toBe(
      true,
    );
  });
});

describe("buildNodeFeatures", () => {
  it("emits one point per origin plus a single destination", () => {
    const fc = buildNodeFeatures(
      [flow({ origin_sgis_code: "11" }), flow({ origin_sgis_code: "28" })],
      destination,
    );
    expect(fc.features).toHaveLength(3);
    const kinds = fc.features.map((f) => f.properties.kind);
    expect(kinds.filter((k) => k === "origin")).toHaveLength(2);
    expect(kinds.filter((k) => k === "destination")).toHaveLength(1);
  });
});
