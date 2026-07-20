import { describe, expect, it } from "vitest";

import {
  ACCOUNTING_BASIS_LABELS,
  COMPONENT_META,
  COMPONENT_ORDER,
  GLOSSARY,
  MISSING_COMPONENT_META,
  MISSING_REASON_EXPLANATIONS,
  MODE_LABELS,
  MODE_ORIENTATION,
  PER_CAPITA_UNAVAILABLE_EXPLANATIONS,
  PROFILE_META,
  STABILITY_META,
  STATUS_META,
  SUBVIEW_LABELS,
  UNKNOWN_REASON_EXPLANATION,
  accountingBasisLabel,
  codeWithName,
  hasForbiddenPrimaryToken,
  missingComponentLabel,
  missingReasonExplanation,
  perCapitaUnavailableExplanation,
  plainError,
  profileLabel,
  stabilitySentence,
  statusLabel,
} from "./glossary";

// Every registry's `primary` string plus every raw nav/orientation label is
// citizen-primary text; none of them may carry an unexplained technical token.
function allPrimaryStrings(): string[] {
  const out: string[] = [];
  out.push(...Object.values(MODE_LABELS));
  out.push(...Object.values(MODE_ORIENTATION));
  out.push(...Object.values(SUBVIEW_LABELS));
  for (const m of Object.values(STATUS_META)) out.push(m.primary);
  for (const m of Object.values(PROFILE_META)) out.push(m.primary);
  for (const m of Object.values(COMPONENT_META)) out.push(m.primary);
  for (const m of Object.values(STABILITY_META)) out.push(m.primary);
  for (const m of Object.values(GLOSSARY)) out.push(m.primary);
  out.push(...Object.values(ACCOUNTING_BASIS_LABELS));
  // Facility-cost reason mappings: the component names, the short parentheticals,
  // and every plain explanation are all rendered as primary text.
  for (const m of Object.values(MISSING_COMPONENT_META)) out.push(m.primary, m.short, m.explanation);
  out.push(...Object.values(MISSING_REASON_EXPLANATIONS));
  out.push(...Object.values(PER_CAPITA_UNAVAILABLE_EXPLANATIONS));
  out.push(UNKNOWN_REASON_EXPLANATION);
  return out;
}

describe("glossary — plain-Korean primary labels", () => {
  it("uses the exact citizen navigation labels the deploy gate checks for", () => {
    expect(MODE_LABELS.equity).toBe("지역 부담");
    expect(MODE_LABELS.suitability).toBe("후보지 분석");
    expect(MODE_LABELS.flow).toBe("매립지 현황");
    expect(MODE_LABELS.transparency).toBe("데이터·출처");
    expect(SUBVIEW_LABELS.score).toBe("후보지 점수");
    expect(SUBVIEW_LABELS.scenario).toBe("가중치 바꿔보기");
    expect(SUBVIEW_LABELS.cost).toBe("비용 살펴보기");
  });

  it("uses the exact plain status labels", () => {
    expect(statusLabel("ELIGIBLE")).toBe("1차 분석 통과");
    expect(statusLabel("REVIEW_REQUIRED")).toBe("추가 확인 필요");
    expect(statusLabel("EXCLUDED")).toBe("현재 기준에서 제외");
  });

  it("keeps the raw status code only in the detail layer", () => {
    expect(STATUS_META.ELIGIBLE.code).toBe("ELIGIBLE");
    // The primary label must not itself be the raw code.
    expect(STATUS_META.ELIGIBLE.primary).not.toContain("ELIGIBLE");
  });

  it("no primary label contains a forbidden technical token", () => {
    for (const text of allPrimaryStrings()) {
      const hit = hasForbiddenPrimaryToken(text);
      expect(hit, `"${text}" contains forbidden token ${hit}`).toBeNull();
    }
  });
});

describe("glossary — score components", () => {
  it("always shows a code with its Korean name, never bare", () => {
    expect(codeWithName("zoning")).toBe("토지이용 조건(Z)");
    expect(codeWithName("road")).toBe("도로 접근성(R)");
    expect(codeWithName("equity")).toBe("기존 지역 부담(E)");
    expect(codeWithName("demand")).toBe("폐기물 처리 수요(D)");
  });

  it("orders the four components Z·R·E·D", () => {
    expect(COMPONENT_ORDER).toEqual(["zoning", "road", "equity", "demand"]);
  });
});

describe("glossary — profiles and stability", () => {
  it("maps profiles to plain bases", () => {
    expect(profileLabel("baseline")).toBe("기본 기준");
    expect(profileLabel("equal")).toBe("모두 똑같이 반영");
    expect(profileLabel("critic")).toBe("데이터 분포 기준");
  });

  it("summarises stability in one plain sentence", () => {
    expect(stabilitySentence("STABLE")).toBe("세 기준 모두 상위권");
    expect(stabilitySentence("CONDITIONALLY_STABLE")).toBe("두 기준에서 상위권");
    expect(stabilitySentence("WEIGHT_SENSITIVE")).toBe("기준에 따라 순위 변화 큼");
    expect(stabilitySentence(null)).toBeNull();
    expect(stabilitySentence(undefined)).toBeNull();
  });
});

describe("glossary — accounting basis", () => {
  it("renders a plain label for each accounting basis", () => {
    expect(accountingBasisLabel("ORIGIN_BASED_TREATMENT_OUTCOME")).toContain("발생지");
    expect(accountingBasisLabel("FACILITY_LOCATION_BASED_THROUGHPUT")).toContain("시설 소재지");
    expect(accountingBasisLabel("VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW")).toContain(
      "수도권 반입",
    );
  });

  it("passes an unknown basis through and empty for null", () => {
    expect(accountingBasisLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(accountingBasisLabel(null)).toBe("");
    expect(accountingBasisLabel(undefined)).toBe("");
  });
});

describe("glossary — plain error messages", () => {
  it("maps known codes to a plain what-happened/what-to-do message", () => {
    expect(plainError("INVALID_SCENARIO_WEIGHTS").primary).toBe("가중치 합계를 100%로 맞춰 주세요.");
    expect(plainError("PROFILE_NOT_AVAILABLE_FOR_RUN").primary).toContain("선택한 점수 기준이 없습니다");
    expect(plainError("NO_ANALYSIS_AVAILABLE").primary).toContain("후보지 분석 결과가 없습니다");
    expect(plainError("NO_DATA_AVAILABLE").primary).toContain("공식 자료가 없습니다");
  });

  it("parses an ApiError-style 'CODE: detail' message", () => {
    const e = plainError("INVALID_SCENARIO_WEIGHTS: weights must sum to 1");
    expect(e.code).toBe("INVALID_SCENARIO_WEIGHTS");
    expect(e.primary).toBe("가중치 합계를 100%로 맞춰 주세요.");
  });

  it("falls back to a non-technical message and keeps the raw text as detail", () => {
    const e = plainError("some raw backend explosion");
    expect(e.primary).not.toContain("backend");
    expect(e.detail).toContain("some raw backend explosion");
  });

  it("never surfaces a raw backend exception as the primary message", () => {
    for (const code of [
      "INVALID_SCENARIO_WEIGHTS",
      "PROFILE_NOT_AVAILABLE_FOR_RUN",
      "NO_DATA_AVAILABLE",
      "NO_DATA_FOR_PERIOD",
      "totally unknown 500 traceback",
    ]) {
      expect(hasForbiddenPrimaryToken(plainError(code).primary)).toBeNull();
    }
  });
});

// --------------------------------------------------------------------------- //

describe("glossary — facility-cost reason codes", () => {
  it("covers every reason code the backend can emit for a missing component", () => {
    // Mirrors backend/src/waste_equity_backend/analysis/facility_cost.py
    // MISSING_COMPONENTS. A code added there without a mapping here would reach a
    // citizen as an ALL-CAPS enum.
    expect(Object.keys(MISSING_COMPONENT_META).sort()).toEqual([
      "ACTUAL_TRANSPORT_COST",
      "LAND_AND_COMPENSATION",
      "OPERATING_COST",
      "REMAINING_LANDFILL_COST",
    ]);
    expect(Object.keys(MISSING_REASON_EXPLANATIONS).sort()).toEqual([
      "ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE",
      "FACILITY_MASS_BALANCE_NOT_ESTABLISHED",
      "OFFICIAL_SOURCE_NOT_INTEGRATED",
      "PARCEL_SPECIFIC_COST_UNAVAILABLE",
    ]);
  });

  it("covers every per-capita unavailability reason the route can emit", () => {
    // api/routes/facility_cost.py sets the first two; the engine's
    // MissingServicePopulationError supplies the third.
    expect(Object.keys(PER_CAPITA_UNAVAILABLE_EXPLANATIONS).sort()).toEqual([
      "INCOMPATIBLE_POPULATION_DEFINITION",
      "NO_MATCHING_SAME_YEAR_POPULATION",
      "NO_OFFICIAL_SERVICE_POPULATION",
    ]);
  });

  it("never echoes the raw code back inside its own explanation", () => {
    for (const [code, text] of Object.entries(MISSING_REASON_EXPLANATIONS)) {
      expect(text, `${code} echoes its own code`).not.toContain(code);
    }
    for (const [code, text] of Object.entries(PER_CAPITA_UNAVAILABLE_EXPLANATIONS)) {
      expect(text, `${code} echoes its own code`).not.toContain(code);
    }
  });

  it("falls back to a safe generic sentence for an unknown code", () => {
    // Never an invented claim about which specific dataset is missing.
    expect(missingReasonExplanation("A_CODE_FROM_THE_FUTURE")).toBe(UNKNOWN_REASON_EXPLANATION);
    expect(missingReasonExplanation(null)).toBe(UNKNOWN_REASON_EXPLANATION);
    expect(missingReasonExplanation(undefined)).toBe(UNKNOWN_REASON_EXPLANATION);
    expect(perCapitaUnavailableExplanation("A_CODE_FROM_THE_FUTURE")).toBe(
      UNKNOWN_REASON_EXPLANATION,
    );
    expect(perCapitaUnavailableExplanation(null)).toBe(UNKNOWN_REASON_EXPLANATION);
  });

  it("keeps an unknown component code visible rather than blanking it", () => {
    // The code is not citizen-facing, but discarding it would lose information the
    // diagnostic layer needs.
    expect(missingComponentLabel("SOME_FUTURE_COST")).toBe("SOME_FUTURE_COST");
    expect(missingComponentLabel("OPERATING_COST")).toBe("운영비");
  });

  it("never says an unavailable component costs zero", () => {
    const texts = [
      ...Object.values(MISSING_REASON_EXPLANATIONS),
      ...Object.values(PER_CAPITA_UNAVAILABLE_EXPLANATIONS),
      UNKNOWN_REASON_EXPLANATION,
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/0원|영원|없음\s*\(0\)|비용이 0/);
    }
  });

  it("preserves the transparency centre's existing wording", () => {
    // docs/UI_UX_DESKTOP_REDESIGN_PLAN.md Phase 6 AC5 requires this text verbatim;
    // holding it here means the two surfaces cannot drift into two translations.
    const rendered = ["OPERATING_COST", "ACTUAL_TRANSPORT_COST", "LAND_AND_COMPENSATION"].map(
      (code) => `${MISSING_COMPONENT_META[code].primary} (${MISSING_COMPONENT_META[code].short})`,
    );
    expect(rendered).toEqual([
      "운영비 (공식 자료 미연계)",
      "실제 운송비 (실 경로·계약 단가 미확보)",
      "토지·보상비 (필지별 비용 미확보)",
    ]);
    expect(
      `${MISSING_COMPONENT_META.REMAINING_LANDFILL_COST.primary} (${MISSING_COMPONENT_META.REMAINING_LANDFILL_COST.short})`,
    ).toBe("잔여 매립비용 (시설 물질수지 미확립)");
  });
});
