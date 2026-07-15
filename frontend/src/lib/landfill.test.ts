import { describe, expect, it } from "vitest";

import {
  formatEffectiveFee,
  formatKrwEok,
  formatKrwPerPerson,
  formatShare,
  formatTons,
  kgToTons,
  perCapitaUnavailableLabel,
} from "./landfill";

describe("formatting", () => {
  it("formats tonnes from kilograms", () => {
    expect(kgToTons("1000000")).toBe(1000);
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

describe("formatKrwPerPerson", () => {
  it("formats a served per-capita fee in 원/인", () => {
    // The real 2024 Seoul value: 41,647,362,920 KRW / 9,335,444 residents.
    expect(formatKrwPerPerson("4461.21")).toBe("4,461원/인");
    expect(formatKrwPerPerson("33.89")).toBe("34원/인");
  });

  it("keeps decimals for sub-1원 values so they never read as zero", () => {
    expect(formatKrwPerPerson("0.42")).toBe("0.42원/인");
  });

  it("renders a genuine zero as zero, but null as a dash — never 0원", () => {
    // A zero fee with a valid denominator is a real measured value...
    expect(formatKrwPerPerson("0")).toBe("0원/인");
    // ...whereas an unavailable value must never be formatted as a number.
    expect(formatKrwPerPerson(null)).toBe("—");
    expect(formatKrwPerPerson(null)).not.toContain("0");
  });
});

describe("perCapitaUnavailableLabel", () => {
  it("explains the same-reference-year rule", () => {
    expect(perCapitaUnavailableLabel("NO_MATCHING_POPULATION_YEAR")).toBe(
      "동일 연도 인구 데이터 없음",
    );
  });

  it("maps every reason the backend can serve", () => {
    for (const reason of [
      "NO_METROPOLITAN_POPULATION",
      "ZERO_POPULATION",
      "AMBIGUOUS_POPULATION_DEFINITION",
      "INCOMPLETE_POPULATION_COVERAGE",
    ]) {
      const label = perCapitaUnavailableLabel(reason);
      expect(label).not.toBe("");
      // The raw code is never shown for a known reason.
      expect(label).not.toContain(reason);
    }
  });

  it("degrades honestly for an unknown or absent reason", () => {
    expect(perCapitaUnavailableLabel(null)).toBe("계산 불가");
    expect(perCapitaUnavailableLabel("SOMETHING_NEW")).toBe("계산 불가 (SOMETHING_NEW)");
  });
});
