import { describe, expect, it } from "vitest";

import {
  formatDecimalExact,
  formatEffectiveFee,
  formatKrwEok,
  formatKrwPerPerson,
  formatShare,
  formatTons,
  kgToTons,
  landfillUnavailableFrom,
  landfillUnavailableFromAll,
  perCapitaUnavailableCode,
  perCapitaUnavailableLabel,
} from "./landfill";
import { ApiError } from "./api";

describe("formatDecimalExact (lossless)", () => {
  it("groups integers and trims trailing fractional zeros without rounding", () => {
    expect(formatDecimalExact("90000.000000")).toBe("90,000");
    expect(formatDecimalExact("9000000000.00")).toBe("9,000,000,000");
  });

  it("preserves real fractional precision (never rounds)", () => {
    expect(formatDecimalExact("90123.456000")).toBe("90,123.456");
    expect(formatDecimalExact("9000012345.67")).toBe("9,000,012,345.67");
  });

  it("returns a non-numeric input unchanged", () => {
    expect(formatDecimalExact("n/a")).toBe("n/a");
  });
});

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
  it("describes a missing exact period, not a missing year (v2 is month-aligned)", () => {
    expect(perCapitaUnavailableLabel("NO_MATCHING_POPULATION_PERIOD")).toBe(
      "동일 기간 인구 데이터 없음",
    );
    expect(perCapitaUnavailableLabel("NO_MATCHING_POPULATION_PERIOD")).not.toContain("연도");
  });

  it("explains an incomplete all-origin aggregate", () => {
    expect(perCapitaUnavailableLabel("INCOMPLETE_POPULATION_COVERAGE")).toBe(
      "일부 지역의 동일 기간 인구가 없어 합계를 계산할 수 없습니다",
    );
  });

  it("maps every reason the backend can serve", () => {
    for (const reason of [
      "NO_MATCHING_POPULATION_PERIOD",
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
    // Phase 5 (redesign plan §4 defect X6): an unrecognised code no longer becomes
    // the citizen's explanation. It used to render as `계산 불가 (SOMETHING_NEW)`.
    expect(perCapitaUnavailableLabel("SOMETHING_NEW")).toBe("계산 불가");
    expect(perCapitaUnavailableLabel("SOMETHING_NEW")).not.toContain("SOMETHING_NEW");
  });
});

describe("perCapitaUnavailableCode (diagnostic layer)", () => {
  it("surfaces an untranslatable code so it is demoted, never deleted", () => {
    // Redesign plan §5 rule 12: reason codes may be hidden from primary UI but
    // must stay recoverable from the page.
    expect(perCapitaUnavailableCode("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("stays silent for a reason already fully described in Korean", () => {
    for (const reason of [
      "NO_MATCHING_POPULATION_PERIOD",
      "NO_METROPOLITAN_POPULATION",
      "ZERO_POPULATION",
      "AMBIGUOUS_POPULATION_DEFINITION",
      "INCOMPLETE_POPULATION_COVERAGE",
    ]) {
      // Echoing the code beside its own translation would be exactly the
      // English/enum duplication Phase 5 removes.
      expect(perCapitaUnavailableCode(reason)).toBeNull();
    }
    expect(perCapitaUnavailableCode(null)).toBeNull();
  });
});

describe("landfillUnavailableFrom", () => {
  function apiError(status: number, error: string, detail: string, availableYears: number[] = []) {
    return new ApiError(
      status,
      { error, detail, requested_year: null, available_years: availableYears },
      `${error}: ${detail}`,
    );
  }

  it("classifies the backend's 404 no-data answer as no-data, not an error", () => {
    const state = landfillUnavailableFrom(
      apiError(404, "NO_DATA_AVAILABLE", "No landfill inbound data has been ingested.", [2023, 2024]),
    );
    expect(state.kind).toBe("no-data");
    // Phase 5 AC4: the raw code + English sentence never becomes the citizen text.
    expect(state.message).toBe("현재 조건에 맞는 공식 자료가 없습니다.");
    expect(state.message).not.toContain("NO_DATA_AVAILABLE");
    // …but it is retained for the diagnostic line.
    expect(state.detail).toContain("NO_DATA_AVAILABLE");
    expect(state.detail).toContain("No landfill inbound data has been ingested.");
    // Served years are passed through verbatim, never invented.
    expect(state.availableYears).toEqual([2023, 2024]);
  });

  it("treats a missing period the same honest way", () => {
    const state = landfillUnavailableFrom(
      apiError(404, "NO_DATA_FOR_PERIOD", "No rows for the requested period."),
    );
    expect(state.kind).toBe("no-data");
    expect(state.message).toBe("선택한 기간의 공식 자료가 없습니다.");
    expect(state.availableYears).toEqual([]);
  });

  it("classifies a server failure as a genuine error", () => {
    const state = landfillUnavailableFrom(apiError(500, "INTERNAL", "boom"));
    expect(state.kind).toBe("error");
    expect(state.message).not.toContain("INTERNAL");
    expect(state.detail).toContain("INTERNAL");
  });

  it("does not mistake a non-404 no-data-shaped code for a no-data answer", () => {
    // Only the backend's real 404 path means "asked and answered".
    expect(landfillUnavailableFrom(apiError(503, "NO_DATA_AVAILABLE", "unavailable")).kind).toBe(
      "error",
    );
  });

  it("degrades to a plain Korean error for a non-API failure", () => {
    const state = landfillUnavailableFrom(new TypeError("Failed to fetch"));
    expect(state.kind).toBe("error");
    expect(state.message).toContain("불러오지 못했습니다");
    // No raw JS error text is shown to the reader.
    expect(state.message).not.toContain("Failed to fetch");
    expect(state.detail).toBeNull();
    expect(state.availableYears).toEqual([]);
  });

  it("returns a BARE diagnostic string for an unstructured failure", () => {
    // A proxy 502 or gateway timeout has no `{detail:{error,detail}}` JSON body.
    // `detail` must not arrive pre-prefixed: the component adds `기술 정보: ` itself,
    // and reusing `plainError`'s already-prefixed text produced `기술 정보: 기술 정보: …`.
    const state = landfillUnavailableFrom(
      new ApiError(502, null, "Backend request failed with status 502"),
    );
    expect(state.kind).toBe("error");
    expect(state.detail).toBe("Backend request failed with status 502");
    expect(state.detail).not.toContain("기술 정보");
    expect(state.detail).not.toContain("기술 코드");
  });

  it("never pre-prefixes the structured diagnostic either", () => {
    const state = landfillUnavailableFrom(
      apiError(404, "NO_DATA_AVAILABLE", "No landfill inbound data has been ingested."),
    );
    expect(state.detail).toBe("NO_DATA_AVAILABLE: No landfill inbound data has been ingested.");
    expect(state.detail).not.toContain("기술 정보");
  });
});

describe("landfillUnavailableFromAll (severity across the three requests)", () => {
  function apiError(status: number, error: string, detail: string, availableYears: number[] = []) {
    return new ApiError(
      status,
      { error, detail, requested_year: null, available_years: availableYears },
      `${error}: ${detail}`,
    );
  }

  it("lets a genuine server error outrank a no-data answer that arrived first", () => {
    // The exact `Promise.all` hazard: /composition 404s quickly while /summary 500s
    // slowly. Reporting "no official record" here would tell the reader the data does
    // not exist when the server is in fact broken.
    const state = landfillUnavailableFromAll([
      apiError(404, "NO_DATA_AVAILABLE", "none ingested"),
      apiError(500, "INTERNAL", "boom"),
    ]);
    expect(state.kind).toBe("error");
    expect(state.detail).toContain("INTERNAL");
  });

  it("reports no-data only when every failure is a no-data answer", () => {
    const state = landfillUnavailableFromAll([
      apiError(404, "NO_DATA_AVAILABLE", "none ingested"),
      apiError(404, "NO_DATA_AVAILABLE", "none ingested"),
      apiError(404, "NO_DATA_AVAILABLE", "none ingested"),
    ]);
    expect(state.kind).toBe("no-data");
  });

  it("prefers the no-data answer that actually names available years", () => {
    // So the reader is offered the periods the backend does hold, whichever of the
    // three endpoints happened to carry them.
    const state = landfillUnavailableFromAll([
      apiError(404, "NO_DATA_AVAILABLE", "none ingested"),
      apiError(404, "NO_DATA_FOR_PERIOD", "no rows", [2023, 2024]),
    ]);
    expect(state.kind).toBe("no-data");
    expect(state.availableYears).toEqual([2023, 2024]);
  });

  it("treats a non-API rejection among no-data answers as an error", () => {
    const state = landfillUnavailableFromAll([
      apiError(404, "NO_DATA_AVAILABLE", "none ingested"),
      new TypeError("Failed to fetch"),
    ]);
    expect(state.kind).toBe("error");
  });

  it("does not call a PARTIAL failure an answer of absence", () => {
    // /summary served data while /trends 404'd: the backend demonstrably HAS records
    // for these filters, so "선택한 조건의 공식 반입 자료가 없습니다" would be a false
    // claim about the data rather than an honest one about the request.
    const state = landfillUnavailableFromAll(
      [apiError(404, "NO_DATA_FOR_PERIOD", "no rows for the requested period")],
      3,
    );
    expect(state.kind).toBe("error");
    expect(state.message).toContain("일부를 불러오지 못했습니다");
    // The code is still recoverable.
    expect(state.detail).toContain("NO_DATA_FOR_PERIOD");
    // A partial failure asserts nothing about which years exist.
    expect(state.availableYears).toEqual([]);
  });

  it("reports absence only when every request came back with no data", () => {
    const state = landfillUnavailableFromAll(
      [
        apiError(404, "NO_DATA_AVAILABLE", "none ingested"),
        apiError(404, "NO_DATA_AVAILABLE", "none ingested"),
        apiError(404, "NO_DATA_AVAILABLE", "none ingested"),
      ],
      3,
    );
    expect(state.kind).toBe("no-data");
  });

  it("never returns undefined for an empty set", () => {
    // Unreachable from the page today, but the return type promises a state.
    const state = landfillUnavailableFromAll([], 3);
    expect(state).toBeDefined();
    expect(state.kind).toBe("error");
    expect(state.availableYears).toEqual([]);
  });
});
