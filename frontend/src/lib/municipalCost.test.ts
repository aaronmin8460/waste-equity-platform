/**
 * Pure-helper tests for the 2024 municipal contract-payment view.
 *
 * The load-bearing assertions here are the ones that make "absence is not zero"
 * mechanical: a null money field must not be formattable into a number at all, so a
 * call site physically cannot render ₩0 from it.
 */

import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import type { MunicipalCostRow } from "./api";
import {
  formatPayment,
  formatPaymentPerCapita,
  formatPopulation,
  hasDerivedPopulation,
  municipalCostErrorFrom,
  MUNICIPAL_COST_SORT_OPTIONS,
  MUNICIPAL_COST_STATUS_META,
  populationMethodCode,
  populationMethodLabel,
  primaryLimitation,
  reasonEntries,
  statusBadge,
  statusLabel,
} from "./municipalCost";

/**
 * A minimal row. Every field is a SYNTHETIC layout fixture, not official data; the
 * tests assert behaviour, never that a value is correct.
 */
function row(overrides: Partial<MunicipalCostRow> = {}): MunicipalCostRow {
  return {
    municipality_key: "41-이천시",
    display_name: "이천시",
    metropolitan_code: "41",
    metropolitan_name: "경기도",
    direct_region_code: "KR-SGIS-31210",
    boundary_vintage: "2024",
    population: 230189,
    population_method: "DIRECT_REGION_POPULATION",
    population_definition: "SGIS_TOTAL_POPULATION",
    population_components: [],
    total_eligible_payment_krw: "49238756000.00",
    eligible_contract_count: 5,
    payment_per_capita_krw: "213905.7731",
    status: "AVAILABLE",
    evidence_status: "LOCAL_GOVERNMENT_SOURCE_INPUTS_DERIVED_VALUE",
    reason_codes: [],
    limitations: [],
    source_files: [],
    has_data_a: true,
    has_data_b: true,
    quantity_coverage: {
      observation_count: 0,
      measured_count: 0,
      measured_zero_count: 0,
      missing_count: 0,
      repeated_municipal_block_count: 0,
      months_covered: 0,
      waste_categories: [],
    },
    ...overrides,
  };
}

describe("money formatting never turns absence into zero", () => {
  it("returns null — not a formatted number — for an unavailable payment", () => {
    // The whole point: a caller cannot accidentally print ₩0, because there is no
    // number to print. It has to branch and show the served reason instead.
    expect(formatPayment(null)).toBeNull();
    expect(formatPaymentPerCapita(null)).toBeNull();
    expect(formatPopulation(null)).toBeNull();
  });

  it("formats a served payment as 억원 and a per-capita value as 원/인", () => {
    expect(formatPayment("49238756000.00")).toBe("492.4억원");
    expect(formatPaymentPerCapita("213905.7731")).toBe("213,906원/인");
    expect(formatPopulation(230189)).toBe("230,189명");
  });

  it("still formats a MEASURED zero as zero", () => {
    // A measured 0 is a real value and a different claim from absence. The backend's
    // CHECK constraints make it impossible for an UNAVAILABLE row, but the formatter
    // must not conflate the two on its own.
    expect(formatPayment("0.00")).toBe("0억원");
    expect(formatPaymentPerCapita("0")).toBe("0원/인");
  });
});

describe("status vocabulary", () => {
  it("gives every status a Korean label and a text-carrying badge", () => {
    expect(statusLabel("AVAILABLE")).toBe("계산 가능");
    expect(statusLabel("PARTIAL")).toBe("일부 제한");
    expect(statusLabel("UNAVAILABLE")).toBe("자료 없음");
    // No label is the raw enum, so a status can never reach citizen text as one.
    for (const [code, meta] of Object.entries(MUNICIPAL_COST_STATUS_META)) {
      expect(meta.label).not.toBe(code);
      expect(meta.label.length).toBeGreaterThan(1);
    }
  });

  it("maps PARTIAL to caveat and UNAVAILABLE to the neutral missing badge", () => {
    // PARTIAL qualifies a value that EXISTS → amber is correct.
    expect(statusBadge("PARTIAL")).toBe("caveat");
    // UNAVAILABLE is absence → neutral gray, never amber and never a ramp step.
    expect(statusBadge("UNAVAILABLE")).toBe("missing");
    // AVAILABLE is this platform's arithmetic, not a published official figure.
    expect(statusBadge("AVAILABLE")).toBe("derived");
  });
});

describe("sorting options match the backend contract", () => {
  it("offers exactly the three orderings the endpoint implements", () => {
    expect(MUNICIPAL_COST_SORT_OPTIONS.map((option) => option.value)).toEqual([
      "payment_per_capita_desc",
      "total_payment_desc",
      "region_name_asc",
    ]);
  });
});

describe("population provenance", () => {
  it("flags the derived ward-sum denominator and names it in Korean", () => {
    const derived = row({ population_method: "DERIVED_SUM_OF_CONSTITUENT_WARDS" });
    expect(hasDerivedPopulation(derived)).toBe(true);
    expect(populationMethodLabel(derived.population_method)).toBe("구성 일반구 인구 합산");
    // A known method is fully described in Korean, so its enum is not repeated.
    expect(populationMethodCode(derived.population_method)).toBeNull();
  });

  it("does not flag a directly reported city population", () => {
    expect(hasDerivedPopulation(row())).toBe(false);
    expect(populationMethodLabel("DIRECT_REGION_POPULATION")).toBe("해당 행정구역 인구");
  });

  it("degrades an unknown method honestly and keeps its code for diagnostics", () => {
    expect(populationMethodLabel("SOMETHING_NEW")).toBe("인구 산출 방식 확인 필요");
    expect(populationMethodCode("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("reason codes use the served explanation", () => {
  it("pairs each code with the backend's own sentence", () => {
    const partial = row({
      status: "PARTIAL",
      reason_codes: ["PARTIAL_WASTE_SCOPE", "MISSING_QUANTITY"],
      limitations: [
        "계약이 생활폐기물 전체가 아닌 일부 품목만 포함합니다.",
        "반출량(톤) 자료가 없습니다. 지급액 지표 계산에는 영향이 없습니다.",
      ],
    });
    expect(reasonEntries(partial)).toEqual([
      {
        code: "PARTIAL_WASTE_SCOPE",
        text: "계약이 생활폐기물 전체가 아닌 일부 품목만 포함합니다.",
      },
      {
        code: "MISSING_QUANTITY",
        text: "반출량(톤) 자료가 없습니다. 지급액 지표 계산에는 영향이 없습니다.",
      },
    ]);
    expect(primaryLimitation(partial)).toBe("계약이 생활폐기물 전체가 아닌 일부 품목만 포함합니다.");
  });

  it("invents no text for a code the backend served without one", () => {
    const odd = row({ reason_codes: ["BRAND_NEW_CODE"], limitations: [] });
    expect(reasonEntries(odd)).toEqual([{ code: "BRAND_NEW_CODE", text: null }]);
    expect(primaryLimitation(odd)).toBeNull();
  });

  it("returns no limitation for an unqualified available row", () => {
    expect(primaryLimitation(row())).toBeNull();
  });
});

describe("request failure classification", () => {
  it("routes a structured backend error through plain Korean and keeps the code", () => {
    const state = municipalCostErrorFrom(
      new ApiError(
        500,
        {
          error: "INTERNAL_ERROR",
          detail: "upstream failure",
          requested_year: null,
          available_years: [],
        },
        "INTERNAL_ERROR: upstream failure",
      ),
    );
    expect(state.message).toBe("잠시 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    // BARE: the component owns the `기술 정보: ` prefix, so it must not be doubled.
    expect(state.detail).toBe("INTERNAL_ERROR: upstream failure");
  });

  it("falls back to a plain sentence for a non-API failure", () => {
    const state = municipalCostErrorFrom(new TypeError("Failed to fetch"));
    expect(state.message).toContain("수집·운반 계약 지급액");
    expect(state.detail).toBeNull();
  });
});
