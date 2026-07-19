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
 *    it is shown WITH its Korean name via {@link codeWithName} — "토지이용 조건(Z)",
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
// Candidate status — the three screening outcomes.
// --------------------------------------------------------------------------- //

export interface StatusMeta extends Described {
  /** The raw analytical status code, shown only in the detail layer. */
  code: SuitabilityStatus;
}

export const STATUS_META: Record<SuitabilityStatus, StatusMeta> = {
  ELIGIBLE: {
    primary: "1차 분석 통과",
    code: "ELIGIBLE",
    detail: "현재 분석 규칙에서 자동 제외·추가 검토 사유가 없는 구역",
  },
  REVIEW_REQUIRED: {
    primary: "추가 확인 필요",
    code: "REVIEW_REQUIRED",
    detail: "자료 부족 또는 세부 확인이 필요한 구역",
  },
  EXCLUDED: {
    primary: "현재 기준에서 제외",
    code: "EXCLUDED",
    detail: "프로젝트의 1차 분석 제외 규칙에 해당하는 구역",
  },
};

/** Plain status label alone (primary). */
export function statusLabel(status: SuitabilityStatus): string {
  return STATUS_META[status]?.primary ?? status;
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
    primary: "도로 접근성을 더 크게 반영",
    detail: "도로 접근성 항목의 가중치를 높인 민감도 비교 가정입니다.",
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
}

export const COMPONENT_META: Record<ScoreComponent, ComponentMeta> = {
  zoning: { primary: "토지이용 조건", code: "Z", detail: "용도지역 등 토지이용 적합도" },
  road: { primary: "도로 접근성", code: "R", detail: "가까운 도로까지의 거리 기반 접근성" },
  equity: { primary: "기존 지역 부담", code: "E", detail: "이미 지고 있는 시설 부담(형평성)" },
  demand: { primary: "폐기물 처리 수요", code: "D", detail: "1인당 폐기물 발생량 기반 수요" },
};

/** Order the four components are displayed in (matches Z·R·E·D). */
export const COMPONENT_ORDER: readonly ScoreComponent[] = ["zoning", "road", "equity", "demand"];

/**
 * A code shown together with its Korean name, per the citizen-language rule:
 * `codeWithName("zoning")` → `"토지이용 조건(Z)"`. Never expose a bare code.
 */
export function codeWithName(component: ScoreComponent): string {
  const meta = COMPONENT_META[component];
  return `${meta.primary}(${meta.code})`;
}

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
  zoning: { primary: "토지이용 조건", detail: "용도지역 등 토지이용(zoning)" },
  road: { primary: "도로 접근성", detail: "가까운 도로까지의 거리(road access)" },
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
