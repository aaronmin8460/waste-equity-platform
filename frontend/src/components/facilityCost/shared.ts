/**
 * Shared constants, types, and pure helpers for the 비용 살펴보기 presentation layer.
 *
 * These moved out of `components/FacilityCostDashboard.tsx` when the cost view was
 * split into the components in this folder. They are PRESENTATION ONLY: label
 * lists, fixed copy, formatting wrappers around the already-tested
 * `lib/displayNumber.ts` / `lib/metrics.ts` helpers, and the existing input
 * validation — moved verbatim, not rewritten.
 *
 * NOTHING HERE COMPUTES A COST. No formula, no unit conversion, no rounding rule,
 * and no aggregation was reimplemented: every money figure on the screen is the
 * backend's own served string, formatted by `formatQuantity` (comma grouping,
 * value-preserving) or approximated by `lib/displayNumber.ts` for a primary
 * surface. `Number()` appears only where it already did — the decorative funding
 * bar's proportions and the labelled derived display share in the region table.
 */

import type { FacilityCostBand, FacilityCostOptions } from "../../lib/api";
import { MISSING_COMPONENT_META, missingComponentLabel, missingReasonExplanation } from "../../lib/glossary";
import type { ApproximateValue } from "../../lib/displayNumber";
import { formatQuantity } from "../../lib/metrics";

// --------------------------------------------------------------------------- //
// Scenario state (owned by FacilityCostDashboard — declared here so the
// presentational components can type their props without importing the page).
// --------------------------------------------------------------------------- //

export interface ScenarioState {
  facilityType: string;
  wasteStream: string;
  subsidyScheme: string;
  regionCodes: string[];
  processingSharePercent: string;
  operatingDays: number;
  undergroundMultiplier: string;
  costVersion: string;
}

/** The advanced inputs only, used to tell the summary whether defaults still hold. */
export type AdvancedDefaults = Pick<
  ScenarioState,
  "subsidyScheme" | "operatingDays" | "undergroundMultiplier" | "costVersion"
>;

export function advancedChanged(s: ScenarioState, defaults: AdvancedDefaults): boolean {
  return (
    s.subsidyScheme !== defaults.subsidyScheme ||
    s.operatingDays !== defaults.operatingDays ||
    s.undergroundMultiplier !== defaults.undergroundMultiplier ||
    s.costVersion !== defaults.costVersion
  );
}

/**
 * Validate the numeric scenario inputs; returns an actionable message or null.
 *
 * MOVED VERBATIM. The bounds (0–100 %, 1–366 days, the API-served underground
 * multiplier range) and the messages are unchanged — this milestone introduced no
 * validation rule and relaxed none.
 */
export function validateScenario(s: ScenarioState, options: FacilityCostOptions): string | null {
  const share = Number(s.processingSharePercent);
  if (s.processingSharePercent === "" || Number.isNaN(share) || share < 0 || share > 100) {
    return "지역 처리 비율은 0–100(%) 사이여야 합니다.";
  }
  if (!Number.isInteger(s.operatingDays) || s.operatingDays < 1 || s.operatingDays > 366) {
    return "연간 가동일수는 1–366 사이여야 합니다.";
  }
  const min = Number(options.underground_multiplier.min);
  const max = Number(options.underground_multiplier.max);
  const um = Number(s.undergroundMultiplier);
  if (s.undergroundMultiplier === "" || Number.isNaN(um) || um < min || um > max) {
    return `지하화 배수는 ${options.underground_multiplier.min}–${options.underground_multiplier.max} 사이여야 합니다.`;
  }
  return null;
}

// --------------------------------------------------------------------------- //
// Waste streams
// --------------------------------------------------------------------------- //

// Primary labels are plain Korean only — the parenthesised English that used to
// follow each one ("생활계 폐기물 (Household)") is the G3 duplication the redesign
// plan removes from primary labels. The backend enum is unchanged; it is still the
// option VALUE and still what the calculation payload carries.
export const WASTE_STREAMS: { value: string; label: string }[] = [
  { value: "HOUSEHOLD", label: "생활계 폐기물" },
  { value: "BUSINESS_NON_FACILITY", label: "사업장 비배출시설계" },
  { value: "INDUSTRIAL_FACILITY", label: "사업장 배출시설계" },
  { value: "CONSTRUCTION", label: "건설 폐기물" },
];

export function wasteStreamLabel(value: string): string {
  return WASTE_STREAMS.find((s) => s.value === value)?.label ?? value;
}

// --------------------------------------------------------------------------- //
// The fixed non-claims list
// --------------------------------------------------------------------------- //

/**
 * The eight non-claims are one documented list (docs/FACILITY_COST_LENS_UI.md) and
 * their wording is frozen. They are, however, TWO different kinds of statement:
 * five name a cost this analysis does not include, three name something the number
 * is not. The refresh groups them under those two headings instead of running them
 * together as one undifferentiated bullet list — the strings and their order are
 * unchanged, and `COMPLETENESS_NOTICES` is still the concatenation, so the count in
 * the disclosure summary cannot drift from the items inside it.
 */
export const EXCLUDED_ITEM_NOTICES = [
  "운영비 미포함",
  "실제 운송비 미포함",
  "토지·보상비 미포함",
  "잔여 매립비용 미포함",
  "후보지별 토목조건 미포함",
];

export const NON_CLAIM_NOTICES = [
  "실제 총사업비가 아님",
  "실제 승인된 국고보조금이 아님",
  "주민 개인의 실제 세금 청구액이 아님",
];

export const COMPLETENESS_NOTICES = [...EXCLUDED_ITEM_NOTICES, ...NON_CLAIM_NOTICES];

// --------------------------------------------------------------------------- //
// Excluded cost components
// --------------------------------------------------------------------------- //

/**
 * The cost components this analysis excludes, in a fixed display order. The first
 * four are the components the endpoint itself enumerates in `missing_components`;
 * the fifth is a standing project-level exclusion the endpoint does not enumerate,
 * so it carries its own wording rather than a served reason.
 */
export const EXCLUDED_COMPONENT_ORDER = [
  "OPERATING_COST",
  "ACTUAL_TRANSPORT_COST",
  "LAND_AND_COMPENSATION",
  "REMAINING_LANDFILL_COST",
];

export const SITE_WORKS_EXCLUSION = {
  label: "후보지별 토목조건",
  explanation: "후보지마다 다른 지형·기반시설 조건에 따른 공사비 차이는 반영하지 않았습니다.",
};

export interface ExcludedRow {
  label: string;
  explanation: string;
  /** The raw served reason code, when the backend reported this component. */
  servedReason: string | null;
  /** The raw component code, when this row corresponds to a backend component. */
  code: string | null;
}

/**
 * Merge the served `missing_components` with the standing exclusion list.
 *
 * Nothing is dropped: a component the backend reports uses ITS served reason, a
 * component it does not report still appears with the registry explanation, and a
 * component this build has never seen is appended rather than swallowed.
 */
export function excludedCostRows(missing: { component: string; reason: string }[]): ExcludedRow[] {
  const served = new Map(missing.map((m) => [m.component, m]));
  const rows: ExcludedRow[] = EXCLUDED_COMPONENT_ORDER.map((code) => {
    const hit = served.get(code);
    served.delete(code);
    return {
      label: missingComponentLabel(code),
      explanation: hit
        ? missingReasonExplanation(hit.reason)
        : MISSING_COMPONENT_META[code].explanation,
      servedReason: hit?.reason ?? null,
      code,
    };
  });
  for (const [code, m] of served) {
    rows.push({
      label: missingComponentLabel(code),
      explanation: missingReasonExplanation(m.reason),
      servedReason: m.reason,
      code,
    });
  }
  rows.push({
    label: SITE_WORKS_EXCLUSION.label,
    explanation: SITE_WORKS_EXCLUSION.explanation,
    servedReason: null,
    code: null,
  });
  return rows;
}

// --------------------------------------------------------------------------- //
// Fixed copy
// --------------------------------------------------------------------------- //

export const PAGE_DISCLAIMER =
  "이 페이지는 시설 설치를 권고하거나 반대를 설득하기 위한 페이지가 아닙니다. 공식 데이터로 필요성, " +
  "비용, 입지 조건과 불확실성을 함께 검토하기 위한 시민 의사결정 지원 도구입니다.";

export const HEADER_SUBTITLE =
  "선택한 지역의 공식 폐기물 자료를 기준으로 필요한 시설 규모와 표준공사비 기반 설치비를 계산합니다.";

// The three non-claims that must be readable BEFORE anything is expanded, on both
// views. The full eight-item exclusion list stays in the collapsed setup disclosure,
// and the results view carries its own "포함되지 않은 비용" accordion. Nothing is
// deleted — this is a change of prominence, not of content.
export const SETUP_NON_CLAIMS =
  "표준공사비를 기준으로 한 참고용 추정치입니다. 실제 총사업비가 아니며, 주민 개인에게 청구되는 " +
  "금액이나 세금 고지액도 아닙니다.";

// The results-screen equivalent: the same four non-claims, stated compactly beside
// the numbers they qualify. One neutral banner, never role="alert" — a standing
// disclaimer must not interrupt a screen reader on every render.
export const RESULTS_NON_CLAIMS =
  "정부 표준공사비 기준으로 계산한 참고용 추정치입니다. 실제 총사업비가 아니며, 국비 보조금이 " +
  "승인되었다는 뜻도 아니고, 1인당 금액은 주민 개인에게 청구되는 금액이 아닙니다.";

export const PER_CAPITA_NON_CLAIM = "개인에게 실제로 청구되는 세금이나 부담금이 아닙니다.";

// Source + reference period for the subsidy rates, kept as two parts so the setup
// summary can state the provenance compactly while the control keeps the full
// sentence. `SUBSIDY_RATE_FORM_NOTE` is the exact string it always was.
export const SUBSIDY_RATE_SOURCE_NOTE =
  "명목 국고보조율(분석용 가정) · 출처: 폐기물처리시설 국고보조금 업무처리지침 · 기준 2025 지침";

export const SUBSIDY_RATE_NON_CLAIM = "실제 승인된 국고보조금이 아닙니다.";

export const SUBSIDY_RATE_FORM_NOTE = `${SUBSIDY_RATE_SOURCE_NOTE} · ${SUBSIDY_RATE_NON_CLAIM}`;

/**
 * The one neutral framing sentence for the derived, decision-support result.
 *
 * The wording is deliberately negative-only about what the figure is not: it never
 * asserts 확정 / 승인 / 최종 in any form, which is the terminology rule the audit
 * tests enforce across this surface.
 */
export const RESULT_FRAMING =
  "현재 입력과 분석 가정에 따른 비교용 추정 비용입니다. 의사결정 지원용 정보이며, 예산이나 계약 " +
  "금액을 뜻하지 않습니다.";

// --------------------------------------------------------------------------- //
// Formatting (wrappers only — no value is changed)
// --------------------------------------------------------------------------- //

/** Format an 억원 decimal string without changing its value. */
export function formatBn(value: string): string {
  return `${formatQuantity(value)} 억원`;
}

/** Format a 원 decimal string, keeping small values visible. */
export function formatWon(value: string): string {
  return `${formatQuantity(value)}원`;
}

/**
 * The approximate text for a primary surface, with a safe fallback.
 *
 * A malformed decimal string makes `displayNumber` return null; the caller then
 * shows the UNCHANGED exact string rather than substituting a fabricated zero.
 */
export function approxOrExact(
  approx: ApproximateValue | null,
  exact: string,
  unit: string,
): string {
  return approx?.text ?? `${formatQuantity(exact)} ${unit}`.trim();
}

/**
 * The matched band's capacity range with its true endpoint semantics: bounded
 * middle bands are lower-exclusive / upper-inclusive, so the label reflects the
 * inclusivity flags (e.g. "30 톤/일 초과 ~ 40 톤/일 이하") rather than a bare "30–40".
 */
export function matchedBandLabel(band: FacilityCostBand): string {
  const lo = band.capacity_min_ton_per_day;
  const hi = band.capacity_max_ton_per_day;
  const loPart =
    lo !== null ? `${formatQuantity(lo)} 톤/일 ${band.capacity_min_inclusive ? "이상" : "초과"}` : null;
  const hiPart =
    hi !== null ? `${formatQuantity(hi)} 톤/일 ${band.capacity_max_inclusive ? "이하" : "미만"}` : null;
  if (loPart && hiPart) return `${loPart} ~ ${hiPart}`;
  return loPart ?? hiPart ?? "전체 규모";
}

/** "서울 중구, 인천 중구 외 8개" — never the full list, and never a region code. */
export function summariseRegions(labels: string[], head = 2): string {
  if (labels.length === 0) return "선택 안 함";
  if (labels.length <= head) return labels.join(", ");
  return `${labels.slice(0, head).join(", ")} 외 ${labels.length - head}개`;
}

// --------------------------------------------------------------------------- //
// Form field classes, shared by the setup sections
// --------------------------------------------------------------------------- //

export const fieldClass =
  "mt-1 w-full rounded-control border border-hairline-strong bg-surface px-2 py-1.5 text-sm text-ink";
export const labelClass = "block text-sm font-medium text-ink";
export const captionClass = "mt-1 block text-xs font-normal text-ink-subtle";
