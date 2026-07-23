/**
 * Citizen-facing terminology registry — the single source of truth for the plain
 * Korean the public sees in PRIMARY UI, paired with the technical term/code/version
 * that belongs only in a "자세히 보기" (see details) layer.
 *
 * Design rules this module encodes (see docs/CITIZEN_LANGUAGE_AND_UX.md):
 *  - A primary label must be understandable without GIS, statistics, waste-policy,
 *    or software knowledge. It never contains a bare English word, a raw enum
 *    (ELIGIBLE, ORIGIN_BASED_TREATMENT_OUTCOME), a version string
 *    (suitability-policy-v2), or an un-named single-letter code (Z/R/E/D).
 *  - The technical vocabulary is preserved, but demoted to a `detail` string that
 *    components render behind a disclosure. When a code genuinely helps (Z/R/E/D),
 *    it is shown WITH its Korean name via {@link codeWithName} — "용도지역 호환성(Z)",
 *    never a bare "Z".
 *  - Analytical honesty is unchanged: this module only renames, it never converts a
 *    missing value to zero, softens a disclaimer, or claims legal/final status.
 *
 * The exported registries are consumed by components AND asserted by
 * `glossary.test.ts` / the terminology-audit tests, so a single edit here keeps the
 * whole UI consistent and the audit green.
 */

import type { SuitabilityProfile, SuitabilityStatus, StabilityClass } from "./api";

export interface Described {
  /** Plain-Korean primary label — safe to show a first-time citizen. */
  primary: string;
  /** Technical term / definition for the "자세히 보기" layer (optional). */
  detail?: string;
}

// --------------------------------------------------------------------------- //
// Top-level navigation (modes) and the one-line orientation for each.
// --------------------------------------------------------------------------- //

/** The four citizen-facing top-level areas. `transparency` is the new data mode. */
export type DashboardArea = "equity" | "suitability" | "flow" | "transparency";

export const MODE_LABELS: Record<DashboardArea, string> = {
  equity: "지역 부담",
  suitability: "후보지 분석",
  flow: "매립지 현황",
  transparency: "데이터·출처",
};

/** Short, task-oriented explanation shown at the top of each area. */
export const MODE_ORIENTATION: Record<DashboardArea, string> = {
  equity: "지역별 폐기물 발생량과 처리시설 부담을 비교합니다.",
  suitability: "현재 확보된 공공자료로 500m 구역을 1차 비교합니다.",
  flow: "수도권매립지 반입량과 지역별 흐름을 확인합니다.",
  transparency: "어떤 자료를 사용했고 무엇이 부족한지 확인합니다.",
};

// --------------------------------------------------------------------------- //
// Suitability sub-views.
// --------------------------------------------------------------------------- //

export type SuitabilitySubview = "score" | "scenario" | "cost";

export const SUBVIEW_LABELS: Record<SuitabilitySubview, string> = {
  score: "후보지 점수",
  scenario: "가중치 바꿔보기",
  cost: "비용 살펴보기",
};

// --------------------------------------------------------------------------- //
// Suitability screening disclaimers (Phase 0 transparency).
//
// The suitability screen is a REGIONAL analytical screening built from official
// spatial data (zoning compatibility, road-proximity proxy, existing-burden
// avoidance, waste demand, and the existing protected/restricted screening layers).
// It does NOT evaluate terrain slope, geology, groundwater, land cover, buildings,
// flood risk, continuous usable area, parcel ownership, truck-route feasibility,
// field investigation, engineering constructability, EIA, or legal permitting.
//
// These strings are the ONE citizen-facing wording for that limitation, reused by
// every suitability subview banner, the map legend, and the exports, so the whole
// app can never drift into two different disclaimers. Phase 0 only renames and
// discloses — it never changes a score, weight, rank, status, or spatial rule.
// --------------------------------------------------------------------------- //

/** Full analytical-screening disclaimer shown near the top of every suitability subview. */
export const SUITABILITY_SCREENING_DISCLAIMER =
  "본 화면은 공식 공간데이터를 이용한 광역 후보지 스크리닝입니다. 결과는 법적 허가, 환경영향평가, " +
  "토질·지질 조사, 토지 확보 가능성 또는 최종 입지 선정을 의미하지 않습니다.";

/** Short persistent label for space-constrained surfaces (map legend, badges). */
export const SUITABILITY_SCREENING_SHORT_LABEL = "광역 분석 스크리닝 · 법적·공학적 적합 판정 아님";

/** Title for the standing disclaimer banner. */
export const SUITABILITY_SCREENING_DISCLAIMER_TITLE = "광역 분석 스크리닝";

// --------------------------------------------------------------------------- //
// Candidate status — the three screening outcomes.
// --------------------------------------------------------------------------- //

export interface StatusMeta extends Described {
  /** The raw analytical status code, shown only in the detail layer. */
  code: SuitabilityStatus;
  /** One plain-Korean sentence: what this screening outcome means to a citizen. */
  explanation: string;
}

export const STATUS_META: Record<SuitabilityStatus, StatusMeta> = {
  ELIGIBLE: {
    primary: "스크리닝 통과",
    code: "ELIGIBLE",
    detail: "현재 분석 규칙에서 자동 제외·추가 검토 사유가 없는 구역",
    explanation:
      "현재 분석정책과 확보된 데이터 기준으로 다음 단계 검토 대상으로 분류되었습니다. " +
      "법적 허가 또는 실제 건설 가능성을 의미하지 않습니다.",
  },
  REVIEW_REQUIRED: {
    primary: "추가 검토 필요",
    code: "REVIEW_REQUIRED",
    detail: "자료 부족 또는 세부 확인이 필요한 구역",
    explanation:
      "자료 누락, 분류 불확실성 또는 정책상 민감한 조건으로 인해 자동 판정할 수 없습니다.",
  },
  EXCLUDED: {
    primary: "프로젝트 스크리닝 제외",
    code: "EXCLUDED",
    detail: "프로젝트의 분석상 제외 규칙에 해당하는 구역",
    explanation:
      "프로젝트에서 정한 분석상 배제 조건과 교차합니다. 법률상 최종 금지 판정을 의미하지 않습니다.",
  },
};

/** Plain status label alone (primary). */
export function statusLabel(status: SuitabilityStatus): string {
  return STATUS_META[status]?.primary ?? status;
}

/** One plain-Korean sentence explaining what a screening status means (citizen-facing). */
export function statusExplanation(status: SuitabilityStatus): string {
  return STATUS_META[status]?.explanation ?? "";
}

// --------------------------------------------------------------------------- //
// Weight profiles (점수 반영 기준) — the scoring bases.
// --------------------------------------------------------------------------- //

export const PROFILE_META: Record<SuitabilityProfile, Described> = {
  baseline: {
    primary: "기본 기준",
    detail: "운영 기본 가정이며 전문가 AHP 결과가 아닙니다.",
  },
  equal: {
    primary: "모두 똑같이 반영",
    detail: "네 항목을 각각 25% 반영합니다.",
  },
  equity_focused: {
    primary: "지역 부담을 더 크게 반영",
    detail: "기존 지역 부담 항목의 가중치를 높인 민감도 비교 가정입니다.",
  },
  access_focused: {
    primary: "도로 근접성을 더 크게 반영",
    detail: "도로 근접성 대리지표 항목의 가중치를 높인 민감도 비교 가정입니다.",
  },
  critic: {
    primary: "데이터 분포 기준",
    detail:
      "값의 차이와 중복 정도로 자동 계산된 가중치(CRITIC)이며, 항목의 중요도 판단이 아닙니다.",
  },
};

/** Plain profile label alone (primary). */
export function profileLabel(profile: SuitabilityProfile): string {
  return PROFILE_META[profile]?.primary ?? profile;
}

// --------------------------------------------------------------------------- //
// Score components (Z/R/E/D). Codes are only ever shown WITH their Korean name.
// --------------------------------------------------------------------------- //

export type ScoreComponent = "zoning" | "road" | "equity" | "demand";

export interface ComponentMeta extends Described {
  /** Single-letter analytical code — only rendered via {@link codeWithName}. */
  code: "Z" | "R" | "E" | "D";
  /**
   * One plain-Korean sentence: what the component actually measures AND what it does
   * NOT (Phase 0). The wording is deliberately explicit that the score is an
   * administrative/proxy context, not a physical or legal siting condition.
   */
  explanation: string;
}

// Primary labels are the Phase 0 citizen-facing terms: "용도지역 호환성" (not the
// misleading "토지이용 적합성", which would imply the land is actually suitable) and
// "도로 근접성 대리지표" (not "도로 접근성", which would imply guaranteed vehicle
// access). The single-letter codes Z·R·E·D are unchanged; nothing about the scoring,
// weights, or formulas changes — only the words shown to a reader.
export const COMPONENT_META: Record<ScoreComponent, ComponentMeta> = {
  zoning: {
    primary: "용도지역 호환성",
    code: "Z",
    detail: "법정 용도지역 대분류 기반 행정적 토지이용 맥락",
    explanation:
      "법정 용도지역 대분류를 이용한 행정적 토지이용 맥락 점수입니다. 현재 토지피복, 경사, 지질, " +
      "지하수, 건축물 현황 또는 토지 소유권을 의미하지 않습니다.",
  },
  road: {
    primary: "도로 근접성 대리지표",
    code: "R",
    detail: "후보 격자 중심점과 가장 가까운 도로 사이의 거리 기반 대리지표",
    explanation:
      "후보 격자 중심점과 가장 가까운 도로 사이의 거리 기반 점수입니다. 대형차량 진입, 도로 폭, " +
      "중량 제한, 회전 가능성 또는 실제 운송 경로를 보장하지 않습니다.",
  },
  equity: {
    primary: "기존 지역 부담",
    code: "E",
    detail: "이미 지고 있는 시설 부담(형평성)",
    explanation:
      "이미 폐기물 처리시설 부담을 지고 있는 지역을 피하기 위한 형평성 점수입니다. 그 자체로 " +
      "환경적 입지 적합성을 의미하지는 않습니다.",
  },
  demand: {
    primary: "폐기물 처리 수요",
    code: "D",
    detail: "1인당 폐기물 발생량 기반 수요",
    explanation:
      "1인당 폐기물 발생량 기반의 서비스 수요 맥락 점수이며, 물리적 입지 조건이 아닙니다.",
  },
};

/** Order the four components are displayed in (matches Z·R·E·D). */
export const COMPONENT_ORDER: readonly ScoreComponent[] = ["zoning", "road", "equity", "demand"];

/** One plain sentence: what a score component measures and what it does not (citizen-facing). */
export function componentExplanation(component: ScoreComponent): string {
  return COMPONENT_META[component].explanation;
}

/**
 * A code shown together with its Korean name, per the citizen-language rule:
 * `codeWithName("zoning")` → `"용도지역 호환성(Z)"`. Never expose a bare code.
 */
export function codeWithName(component: ScoreComponent): string {
  const meta = COMPONENT_META[component];
  return `${meta.primary}(${meta.code})`;
}

// --------------------------------------------------------------------------- //
// "현재 분석에 포함되지 않은 항목" (not yet modelled) — Phase 0 disclosure.
//
// The physical / environmental / legal conditions the current regional screening
// does NOT evaluate. Held here (not scattered) so the score view, the candidate
// detail panel, and the exports list exactly the same items. This is a DISCLOSURE
// of absence — it never displays a fake value, placeholder score, or completion
// percentage, and the note is explicit that a missing value is NOT treated as 0 or
// as a safe condition.
// --------------------------------------------------------------------------- //

export const UNMODELED_SUITABILITY_TITLE = "현재 분석에 포함되지 않은 항목";

export const UNMODELED_SUITABILITY_FACTORS: readonly string[] = [
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
];

export const UNMODELED_SUITABILITY_NOTE =
  "위 항목은 후속 단계에서 공식 데이터와 검증된 분석 기준을 확보한 뒤 추가할 예정입니다. " +
  "현재 값이 없다는 이유로 0점 또는 안전한 조건으로 간주하지 않습니다.";

/**
 * Three plain statements the exports must carry (Phase 0 §8): the 500 m candidate
 * grid is not a parcel, road distance is only a proximity proxy, and ownership /
 * actual usable area are not evaluated.
 */
export const SUITABILITY_SCOPE_STATEMENTS: readonly string[] = [
  "500m 후보 격자는 하나의 필지가 아닙니다.",
  "도로까지의 거리는 근접성 대리지표일 뿐이며 실제 차량 진입을 보장하지 않습니다.",
  "토지 소유권과 실제 이용 가능 면적은 평가하지 않습니다.",
];

// --------------------------------------------------------------------------- //
// Weight-sensitivity stability.
// --------------------------------------------------------------------------- //

export const STABILITY_META: Record<StabilityClass, Described> = {
  STABLE: {
    primary: "세 기준 모두 상위권",
    detail: "기본·균등·데이터 분포 기준 모두에서 상위 10%에 포함된 구역",
  },
  CONDITIONALLY_STABLE: {
    primary: "두 기준에서 상위권",
    detail: "세 기준 중 두 기준에서 상위 10%에 포함된 구역",
  },
  WEIGHT_SENSITIVE: {
    primary: "기준에 따라 순위 변화 큼",
    detail: "점수 반영 기준을 바꾸면 상위권 포함 여부가 크게 달라지는 구역",
  },
};

/** One short plain sentence describing a candidate's stability, or null. */
export function stabilitySentence(
  stabilityClass: string | null | undefined,
): string | null {
  if (stabilityClass == null) return null;
  return STABILITY_META[stabilityClass as StabilityClass]?.primary ?? null;
}

// --------------------------------------------------------------------------- //
// Error messages — every error answers: what happened / what to do. The raw
// backend code is preserved only in `detail` for diagnostics.
// --------------------------------------------------------------------------- //

export interface PlainError extends Described {
  /** The backend error code, for the diagnostic detail line. */
  code: string;
}

const ERROR_MESSAGES: Record<string, Omit<PlainError, "code">> = {
  PROFILE_NOT_AVAILABLE_FOR_RUN: {
    primary: "이 분석 결과에는 선택한 점수 기준이 없습니다.",
    detail: "다른 점수 기준을 선택하면 결과를 볼 수 있습니다.",
  },
  INVALID_SCENARIO_WEIGHTS: {
    primary: "가중치 합계를 100%로 맞춰 주세요.",
    detail: "네 항목의 비율을 더한 값이 정확히 100%가 되어야 합니다.",
  },
  SCENARIO_HASH_MISMATCH: {
    primary: "가중치 설정이 만료되었습니다. 다시 적용해 주세요.",
    detail: "브라우저에 저장된 가중치가 최신 계산과 일치하지 않습니다.",
  },
  NO_ANALYSIS_AVAILABLE: {
    primary: "아직 표시할 후보지 분석 결과가 없습니다.",
  },
  RUN_NOT_FOUND: {
    primary: "요청한 분석 결과를 찾을 수 없습니다.",
  },
  CANDIDATE_NOT_FOUND: {
    primary: "선택한 구역 정보를 찾을 수 없습니다.",
  },
  CANDIDATE_RUN_MISMATCH: {
    primary: "선택한 구역이 현재 분석 결과에 속하지 않습니다.",
  },
  NO_DATA_AVAILABLE: {
    primary: "현재 조건에 맞는 공식 자료가 없습니다.",
  },
  NO_DATA_FOR_PERIOD: {
    primary: "선택한 기간의 공식 자료가 없습니다.",
    detail: "자료가 있는 다른 기간을 선택해 주세요.",
  },
  REGION_NOT_FOUND: {
    primary: "선택한 지역의 자료를 찾을 수 없습니다.",
  },
  OFFICIAL_WASTE_UNAVAILABLE: {
    primary: "이 지역·품목의 공식 발생량 자료가 없어 계산할 수 없습니다.",
  },
};

/**
 * Resolve a backend error code (or an ApiError message like "CODE: detail") to a
 * plain-language message. Falls back to a generic, non-technical sentence and keeps
 * the raw text only in the diagnostic detail. Existing analytical data is never
 * changed by any error path, so callers may safely reassure the reader of that.
 */
export function plainError(codeOrMessage: string | null | undefined): PlainError {
  const raw = (codeOrMessage ?? "").trim();
  // ApiError messages are "CODE: detail" — pull the leading code token.
  const code = raw.split(":")[0]?.trim() ?? "";
  const hit = ERROR_MESSAGES[code];
  if (hit) {
    return { code, primary: hit.primary, detail: hit.detail ?? `기술 코드: ${code}` };
  }
  return {
    code: code || "UNKNOWN",
    primary: "잠시 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    detail: raw ? `기술 정보: ${raw}` : undefined,
  };
}

// --------------------------------------------------------------------------- //
// Accounting basis & other raw enums that leak into primary text.
// --------------------------------------------------------------------------- //

/** Plain names for the three strictly-segregated accounting bases (집계 기준). */
export const ACCOUNTING_BASIS_LABELS: Record<string, string> = {
  ORIGIN_BASED_TREATMENT_OUTCOME: "발생지 기준(지역에서 배출된 양)",
  FACILITY_LOCATION_BASED_THROUGHPUT: "시설 소재지 기준(시설이 처리한 양)",
  VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW: "수도권 반입 기준(매립지로 들어온 양)",
};

/** Plain name for an accounting-basis enum, with the raw code kept for the detail. */
export function accountingBasisLabel(basis: string | null | undefined): string {
  if (!basis) return "";
  return ACCOUNTING_BASIS_LABELS[basis] ?? basis;
}

// --------------------------------------------------------------------------- //
// Facility-cost reason codes.
//
// The cost endpoint states WHY a cost component, or the per-capita conversion, is
// unavailable — as an ALL-CAPS code (`OFFICIAL_SOURCE_NOT_INTEGRATED`). A code is
// not an explanation: it tells a citizen nothing, and reading one on the results
// screen is the "raw enum in primary UI" failure this module exists to prevent
// (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §9 Phase 3 AC6).
//
// The codes are NOT deleted. They stay in the API response, in the TypeScript
// types, in a diagnostic disclosure, and in tests (§5 rule 12) — only their
// PROMINENCE changes. Each explanation below is grounded in the code itself and in
// the backend that emits it (analysis/facility_cost.py `MISSING_COMPONENTS`,
// api/routes/facility_cost.py `population_reason`); nothing infers a specific
// missing dataset the code does not name.
// --------------------------------------------------------------------------- //

export interface MissingComponentMeta {
  /** Plain-Korean component name — safe as primary text. */
  primary: string;
  /**
   * Short parenthetical reason. This is the wording the transparency centre
   * already renders ("운영비 (공식 자료 미연계)"); it lives here so the two
   * surfaces can never drift into two different translations of one code.
   */
  short: string;
  /** One plain sentence explaining the absence — safe as primary text. */
  explanation: string;
  /** The backend component code. Diagnostic layer only. */
  code: string;
}

/** The four cost components the backend reports as not included, keyed by code. */
export const MISSING_COMPONENT_META: Record<string, MissingComponentMeta> = {
  OPERATING_COST: {
    primary: "운영비",
    short: "공식 자료 미연계",
    explanation: "시설을 운영하는 데 드는 비용의 공식 자료가 아직 이 분석에 연결되지 않았습니다.",
    code: "OPERATING_COST",
  },
  ACTUAL_TRANSPORT_COST: {
    primary: "실제 운송비",
    short: "실 경로·계약 단가 미확보",
    explanation: "실제 수집·운반 경로와 계약 단가 자료가 없어 계산할 수 없습니다.",
    code: "ACTUAL_TRANSPORT_COST",
  },
  LAND_AND_COMPENSATION: {
    primary: "토지·보상비",
    short: "필지별 비용 미확보",
    explanation: "부지가 정해져야 알 수 있는 필지별 토지·보상 비용 자료가 없습니다.",
    code: "LAND_AND_COMPENSATION",
  },
  REMAINING_LANDFILL_COST: {
    primary: "잔여 매립비용",
    short: "시설 물질수지 미확립",
    explanation: "시설에서 처리하고 남는 물질의 양이 확정되지 않아 계산할 수 없습니다.",
    code: "REMAINING_LANDFILL_COST",
  },
};

/** Plain component name for a backend component code (falls back to the code). */
export function missingComponentLabel(component: string): string {
  return MISSING_COMPONENT_META[component]?.primary ?? component;
}

/**
 * The safe generic explanation. Used for a code this registry does not know, so an
 * unrecognised code never becomes an invented claim about a specific dataset.
 */
export const UNKNOWN_REASON_EXPLANATION = "현재 공식 계산 자료가 제공되지 않습니다.";

/** Backend `missing_components[].reason` → plain sentence. */
export const MISSING_REASON_EXPLANATIONS: Record<string, string> = {
  OFFICIAL_SOURCE_NOT_INTEGRATED: "이 항목의 공식 자료가 아직 이 분석에 연결되지 않았습니다.",
  ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE:
    "실제 수집·운반 경로와 계약 단가 자료가 없어 계산할 수 없습니다.",
  PARCEL_SPECIFIC_COST_UNAVAILABLE:
    "부지가 정해져야 알 수 있는 필지별 비용 자료가 없어 계산할 수 없습니다.",
  FACILITY_MASS_BALANCE_NOT_ESTABLISHED:
    "시설에서 처리하고 남는 물질의 양이 확정되지 않아 계산할 수 없습니다.",
};

export function missingReasonExplanation(reason: string | null | undefined): string {
  if (!reason) return UNKNOWN_REASON_EXPLANATION;
  return MISSING_REASON_EXPLANATIONS[reason] ?? UNKNOWN_REASON_EXPLANATION;
}

/**
 * Backend `per_capita.unavailable_reason` → plain sentence.
 *
 * Each states only what the code states. None of them implies the value is zero:
 * an unavailable per-capita share stays unavailable (repo AGENTS.md; redesign plan
 * §5 rules 2–3).
 */
export const PER_CAPITA_UNAVAILABLE_EXPLANATIONS: Record<string, string> = {
  NO_OFFICIAL_SERVICE_POPULATION:
    "선택한 지역의 공식 인구가 제공되지 않아 1인당 값을 계산할 수 없습니다.",
  NO_MATCHING_SAME_YEAR_POPULATION:
    "폐기물 자료와 같은 연도의 공식 인구 자료가 없어 1인당 값을 계산할 수 없습니다.",
  INCOMPATIBLE_POPULATION_DEFINITION:
    "폐기물 자료와 인구 자료의 집계 정의가 달라 1인당 값을 계산할 수 없습니다.",
};

export function perCapitaUnavailableExplanation(reason: string | null | undefined): string {
  if (!reason) return UNKNOWN_REASON_EXPLANATION;
  return PER_CAPITA_UNAVAILABLE_EXPLANATIONS[reason] ?? UNKNOWN_REASON_EXPLANATION;
}

// --------------------------------------------------------------------------- //
// General term glossary — technical term → plain primary + detail. Used by the
// "자세히 보기" / methodology layers and the transparency center.
// --------------------------------------------------------------------------- //

export const GLOSSARY: Record<string, Described> = {
  equity: { primary: "지역 부담 비교", detail: "형평성(Equity)" },
  suitability: { primary: "후보지 분석", detail: "적합성 스크리닝(Suitability screening)" },
  candidate: { primary: "분석 후보 구역", detail: "500m 후보 격자" },
  weight_profile: { primary: "점수 반영 기준", detail: "항목별 가중치 조합(weight profile)" },
  critic: {
    primary: "데이터 분포 기준",
    detail: "값의 차이와 중복 정도로 자동 계산된 가중치(CRITIC)이며 중요도 판단이 아닙니다.",
  },
  stability: {
    primary: "기준을 바꿔도 상위권을 유지하는 정도",
    detail: "기본·균등·데이터 분포 기준의 상위 10% 포함 여부(weight-sensitivity stability)",
  },
  provisional_score: {
    primary: "참고용 임시 점수",
    detail:
      "일부 항목이 없어 현재 항목만으로 계산한 점수(provisional score)이며 최종 점수가 아닙니다.",
  },
  run: {
    primary: "분석 실행",
    detail: "같은 자료·규칙으로 한 번 계산한 결과 묶음(run)",
  },
  reference_period: { primary: "자료 기준 시점", detail: "reference period" },
  derivation_version: { primary: "계산 방식 버전", detail: "derivation version" },
  candidate_grid_version: { primary: "분석 구역 버전", detail: "candidate-grid version" },
  policy_version: { primary: "분석 규칙 버전", detail: "policy version" },
  vector_tile: {
    primary: "지도 표시 방식",
    detail: "지도를 빠르게 표시하기 위한 기술 방식(vector tile/MVT)",
  },
  accounting_basis: { primary: "집계 기준", detail: "accounting basis" },
  no_data: { primary: "자료 없음", detail: "no data — 값이 제공되지 않음" },
  official_zero: { primary: "공식 값 0", detail: "official zero — 실제 측정된 0이며 결측이 아님" },
  facility_burden: { primary: "현재 지역의 시설 부담", detail: "facility burden" },
  cost_lens: { primary: "비용 살펴보기", detail: "cost lens" },
  scenario_lab: { primary: "가중치 바꿔보기", detail: "weight scenario lab" },
  transparency: { primary: "데이터·출처", detail: "data & source transparency" },
  demand: { primary: "폐기물 처리 수요", detail: "1인당 발생량 기반 수요(demand)" },
  zoning: { primary: "용도지역 호환성", detail: "법정 용도지역 대분류 기반 토지이용 맥락(zoning)" },
  road: {
    primary: "도로 근접성 대리지표",
    detail: "가까운 도로까지의 거리 기반 대리지표(road proximity proxy)이며 차량 진입 보장이 아님",
  },
  baseline: { primary: "기본 기준", detail: "운영 기본 가정(baseline)이며 전문가 AHP 결과가 아님" },
};

/** Look up a glossary entry by key; returns the key itself if unknown. */
export function glossary(key: string): Described {
  return GLOSSARY[key] ?? { primary: key };
}

// --------------------------------------------------------------------------- //
// Audit surface — the technical tokens that must NOT appear un-explained in
// PRIMARY citizen UI. `glossary.test.ts` and the terminology-audit tests assert
// that the primary label registries above are free of these.
// --------------------------------------------------------------------------- //

/**
 * Tokens forbidden in a primary (non-detail) citizen label. A component may still
 * render these inside a "자세히 보기" disclosure or a diagnostic detail line — the
 * audit only scans primary text.
 */
export const FORBIDDEN_PRIMARY_TOKENS: readonly string[] = [
  "ELIGIBLE",
  "REVIEW_REQUIRED",
  "EXCLUDED",
  "CRITIC",
  "MVT",
  "derivation_version",
  "candidate_grid_version",
  "policy_version",
  "accounting_basis",
  "ORIGIN_BASED_TREATMENT_OUTCOME",
  "FACILITY_LOCATION_BASED_THROUGHPUT",
  "OFFICIAL_INPUTS_DERIVED_VALUE",
  "provisional score",
  "provisional_score",
  "suitability-policy",
  "suitability-screening",
  "capital-grid-500m",
  // Facility-cost components and reason codes (redesign plan §9 Phase 3 AC7). They
  // remain legal inside a diagnostic disclosure — the audit scans primary text.
  "OPERATING_COST",
  "ACTUAL_TRANSPORT_COST",
  "LAND_AND_COMPENSATION",
  "REMAINING_LANDFILL_COST",
  "OFFICIAL_SOURCE_NOT_INTEGRATED",
  "ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE",
  "PARCEL_SPECIFIC_COST_UNAVAILABLE",
  "FACILITY_MASS_BALANCE_NOT_ESTABLISHED",
  "NO_OFFICIAL_SERVICE_POPULATION",
  "NO_MATCHING_SAME_YEAR_POPULATION",
  "INCOMPATIBLE_POPULATION_DEFINITION",
  // Landfill per-capita unavailability codes (redesign plan §9 Phase 5; §4 defect
  // X6). `lib/landfill.ts` translates all five into plain Korean and no longer
  // falls through to `계산 불가 (RAW_CODE)`. As with the cost codes above they stay
  // legal inside a `data-diagnostic` detail line — the audit scans primary text.
  "NO_MATCHING_POPULATION_PERIOD",
  "NO_METROPOLITAN_POPULATION",
  "ZERO_POPULATION",
  "AMBIGUOUS_POPULATION_DEFINITION",
  "INCOMPLETE_POPULATION_COVERAGE",
];

/**
 * True when `text` contains a forbidden technical token. Case-sensitive for the
 * ALL-CAPS enums (so ordinary Korean prose is never flagged) and also catches the
 * bare English words that must carry a Korean gloss.
 */
export function hasForbiddenPrimaryToken(text: string): string | null {
  for (const token of FORBIDDEN_PRIMARY_TOKENS) {
    if (text.includes(token)) return token;
  }
  return null;
}
