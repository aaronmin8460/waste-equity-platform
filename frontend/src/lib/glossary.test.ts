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
  NAV_DESTINATIONS,
  destinationFor,
  destinationLabel,
  PER_CAPITA_UNAVAILABLE_EXPLANATIONS,
  PROFILE_META,
  STABILITY_META,
  STATUS_META,
  SUBVIEW_LABELS,
  SUITABILITY_SCOPE_STATEMENTS,
  SUITABILITY_SCREENING_DISCLAIMER,
  SUITABILITY_SCREENING_SHORT_LABEL,
  UNKNOWN_REASON_EXPLANATION,
  UNMODELED_SUITABILITY_FACTORS,
  UNMODELED_SUITABILITY_NOTE,
  UNMODELED_SUITABILITY_TITLE,
  accountingBasisLabel,
  codeWithName,
  componentExplanation,
  hasForbiddenPrimaryToken,
  missingComponentLabel,
  missingReasonExplanation,
  perCapitaUnavailableExplanation,
  plainError,
  profileLabel,
  stabilitySentence,
  statusExplanation,
  statusLabel,
} from "./glossary";

// Every registry's `primary` string plus every raw nav/orientation label is
// citizen-primary text; none of them may carry an unexplained technical token.
function allPrimaryStrings(): string[] {
  const out: string[] = [];
  out.push(...Object.values(MODE_LABELS));
  out.push(...Object.values(MODE_ORIENTATION));
  out.push(...NAV_DESTINATIONS.map((d) => d.label));
  out.push(...NAV_DESTINATIONS.map((d) => d.orientation));
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
    // The SIX visible destinations, in nav order (docs/YEOGIDA_UI_REDESIGN_SPEC.md §2).
    expect(NAV_DESTINATIONS.map((d) => d.label)).toEqual([
      "지역 지표",
      // Renamed by the Figma forensic audit — the frame names it 지역별 폐기물 처리
      // 현황 and the screen is a per-region breakdown, not a nationwide total. The
      // label is also this view's <h1>, so the tab and the page title moved together.
      "지역별 폐기물 처리 현황",
      // Deliberately NOT renamed: the Figma file names this destination 후보지 분석
      // in the nav and 시설 비용 살펴보기 in the frame title. The shipped contract
      // stands until the owner resolves that conflict (see lib/glossary.ts).
      "후보지 분석",
      "후보지 심층 분석",
      "후보지 심층 비교",
      "데이터·출처",
    ]);
    // The area-level vocabulary behind them.
    expect(MODE_LABELS.equity).toBe("지역 지표");
    expect(MODE_LABELS.suitability).toBe("후보지 분석");
    // `flow` is a 1:1 area↔destination match, so the area name tracks the rename.
    expect(MODE_LABELS.flow).toBe("지역별 폐기물 처리 현황");
    expect(MODE_LABELS.transparency).toBe("데이터·출처");
    // Sub-view names now equal the destination they were promoted to, so the two
    // registries can never print two different names for one screen.
    expect(SUBVIEW_LABELS.score).toBe("후보지 심층 분석");
    expect(SUBVIEW_LABELS.scenario).toBe("후보지 심층 비교");
    expect(SUBVIEW_LABELS.cost).toBe("후보지 분석");
  });

  it("projects the six destinations onto the four modes without a new mode", () => {
    // The whole point of the projection: no new backend mode, no new URL version.
    expect(new Set(NAV_DESTINATIONS.map((d) => d.mode))).toEqual(
      new Set(["equity", "flow", "suitability", "transparency"]),
    );
    // Three destinations share the suitability mode and differ ONLY by sub-view.
    const suitability = NAV_DESTINATIONS.filter((d) => d.mode === "suitability");
    expect(suitability.map((d) => d.view).sort()).toEqual(["cost", "scenario", "score"]);
    // The other three carry no sub-view, so entering them cannot rewrite `view`.
    for (const d of NAV_DESTINATIONS.filter((d) => d.mode !== "suitability")) {
      expect(d.view, d.key).toBeNull();
    }
    // Every testId is unique — they are the automation contract.
    expect(new Set(NAV_DESTINATIONS.map((d) => d.testId)).size).toBe(NAV_DESTINATIONS.length);
  });

  it("resolves an analytical state to exactly one destination", () => {
    expect(destinationFor("equity", "score").label).toBe("지역 지표");
    expect(destinationFor("flow", "scenario").label).toBe("지역별 폐기물 처리 현황");
    expect(destinationFor("transparency", "cost").label).toBe("데이터·출처");
    // A stale sub-view carried by a NON-suitability mode never selects a
    // suitability destination — `view` is only consulted for that mode.
    expect(destinationFor("equity", "cost").mode).toBe("equity");
    // Inside suitability the sub-view decides.
    expect(destinationFor("suitability", "score").label).toBe("후보지 심층 분석");
    expect(destinationFor("suitability", "scenario").label).toBe("후보지 심층 비교");
    expect(destinationFor("suitability", "cost").label).toBe("후보지 분석");
  });

  it("labels each destination the same way the view titles itself", () => {
    // Spec §2.2 — the nav label and the view's <h1> are one string, so a reader
    // never sees the place they clicked named differently once they arrive.
    for (const d of NAV_DESTINATIONS) {
      expect(destinationLabel(d.mode, d.view ?? "score"), d.key).toBe(d.label);
    }
  });

  it("uses the exact plain status labels (Phase 0 screening terminology)", () => {
    expect(statusLabel("ELIGIBLE")).toBe("스크리닝 통과");
    expect(statusLabel("REVIEW_REQUIRED")).toBe("추가 검토 필요");
    expect(statusLabel("EXCLUDED")).toBe("프로젝트 스크리닝 제외");
  });

  it("explains each screening status in plain Korean without claiming legal status", () => {
    expect(statusExplanation("ELIGIBLE")).toContain("다음 단계 검토 대상");
    expect(statusExplanation("ELIGIBLE")).toContain("법적 허가 또는 실제 건설 가능성을 의미하지 않습니다");
    expect(statusExplanation("REVIEW_REQUIRED")).toContain("자동 판정할 수 없습니다");
    expect(statusExplanation("EXCLUDED")).toContain("법률상 최종 금지 판정을 의미하지 않습니다");
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
  it("always shows a code with its Korean name, never bare (Phase 0 terminology)", () => {
    expect(codeWithName("zoning")).toBe("용도지역 호환성(Z)");
    expect(codeWithName("road")).toBe("도로 근접성 대리지표(R)");
    expect(codeWithName("equity")).toBe("기존 지역 부담(E)");
    expect(codeWithName("demand")).toBe("폐기물 처리 수요(D)");
  });

  it("orders the four components Z·R·E·D", () => {
    expect(COMPONENT_ORDER).toEqual(["zoning", "road", "equity", "demand"]);
  });

  it("explains what each component measures and, for Z/R, what it does NOT", () => {
    // Zoning is an administrative land-use context, not physical suitability.
    expect(componentExplanation("zoning")).toContain("행정적 토지이용 맥락");
    expect(componentExplanation("zoning")).toContain("토지 소유권을 의미하지 않습니다");
    // Road is a proximity proxy, not guaranteed vehicle access.
    expect(componentExplanation("road")).toContain("대형차량 진입");
    expect(componentExplanation("road")).toContain("보장하지 않습니다");
    // Equity/demand carry their accurate meaning + a "not by itself suitability" note.
    expect(componentExplanation("equity")).toContain("환경적 입지 적합성");
    expect(componentExplanation("demand")).toContain("물리적 입지 조건이 아닙니다");
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

describe("glossary — Phase 0 suitability transparency constants", () => {
  it("carries the exact citizen-facing screening disclaimer and short label", () => {
    expect(SUITABILITY_SCREENING_DISCLAIMER).toContain("공식 공간데이터를 이용한 광역 후보지 스크리닝");
    expect(SUITABILITY_SCREENING_DISCLAIMER).toContain("법적 허가");
    expect(SUITABILITY_SCREENING_DISCLAIMER).toContain("환경영향평가");
    expect(SUITABILITY_SCREENING_DISCLAIMER).toContain("최종 입지 선정을 의미하지 않습니다");
    expect(SUITABILITY_SCREENING_SHORT_LABEL).toBe("광역 분석 스크리닝 · 법적·공학적 적합 판정 아님");
  });

  it("lists exactly the ten not-yet-modelled factors with the non-zero note", () => {
    expect(UNMODELED_SUITABILITY_TITLE).toBe("현재 분석에 포함되지 않은 항목");
    expect(UNMODELED_SUITABILITY_FACTORS).toEqual([
      "경사 및 정밀 지형",
      "상세 지질 및 단층",
      "지하수위 및 수문지질",
      "토지피복과 실제 토지 이용 상태",
      "건축물 점유와 철거 필요성",
      "홍수·침수 위험",
      "연속 사용 가능 부지 규모",
      "필지 소유권과 취득 가능성",
      "대형차량의 실제 진입 가능성",
      "현장조사 및 환경영향평가",
    ]);
    // A missing value is never treated as 0 or as a safe condition.
    expect(UNMODELED_SUITABILITY_NOTE).toContain("0점 또는 안전한 조건으로 간주하지 않습니다");
  });

  it("states the three export scope statements (grid≠parcel, road proxy, ownership)", () => {
    expect(SUITABILITY_SCOPE_STATEMENTS.join(" ")).toContain("500m 후보 격자는 하나의 필지가 아닙니다");
    expect(SUITABILITY_SCOPE_STATEMENTS.join(" ")).toContain("근접성 대리지표");
    expect(SUITABILITY_SCOPE_STATEMENTS.join(" ")).toContain("토지 소유권과 실제 이용 가능 면적은 평가하지 않습니다");
  });

  it("keeps the new primary labels free of forbidden technical tokens", () => {
    for (const text of [
      SUITABILITY_SCREENING_DISCLAIMER,
      SUITABILITY_SCREENING_SHORT_LABEL,
      UNMODELED_SUITABILITY_TITLE,
      UNMODELED_SUITABILITY_NOTE,
      ...UNMODELED_SUITABILITY_FACTORS,
      ...SUITABILITY_SCOPE_STATEMENTS,
      STATUS_META.ELIGIBLE.primary,
      STATUS_META.REVIEW_REQUIRED.primary,
      STATUS_META.EXCLUDED.primary,
    ]) {
      expect(hasForbiddenPrimaryToken(text)).toBeNull();
    }
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
