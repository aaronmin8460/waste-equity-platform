import { describe, expect, it } from "vitest";

import {
  formatRegionMetricDisplay,
  regionUnavailableReasonLabel,
} from "./regionDisplay";

describe("formatRegionMetricDisplay", () => {
  it("appends the unit to a served value", () => {
    expect(formatRegionMetricDisplay("142,000", "persons", null)).toBe("142,000 persons");
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
    expect(formatRegionMetricDisplay(undefined, "persons", null)).toBe(
      "데이터 없음 (no served value)",
    );
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

  it("maps a known reason code to its bilingual label", () => {
    expect(regionUnavailableReasonLabel("COARSER_REPORTING_GEOGRAPHY")).toContain(
      "상위 보고 단위로 보고됨",
    );
  });
});
