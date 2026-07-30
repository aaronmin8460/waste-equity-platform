/**
 * Land-cover candidate-cell statistics — presentation and validation helpers
 * (Phase 1B-LC5A).
 *
 * Pure functions only, so the honesty rules that matter can be unit-tested without
 * rendering anything. Three of them are load-bearing:
 *
 *  1. A real, non-zero quantity NEVER displays as "0". A 0.3 m² class or a 0.02%
 *     share renders as "1 m² 미만" / "0.1% 미만", because "0 m²" would read as
 *     "this class is absent" — the fabricated-zero failure repo AGENTS.md forbids.
 *  2. A PARTIAL cell NEVER displays as 100%. LC3 decides coverage by exact
 *     set-theoretic residual emptiness, not by an area threshold, so a PARTIAL cell
 *     can carry a coverage ratio of 0.9999999999999876 — which naive rounding would
 *     show as "100%", contradicting the very status beside it. Such a value renders
 *     as "100% 미만".
 *  3. Uncovered area is never a class. Nothing here derives an
 *     UNKNOWN/UNCLASSIFIED/기타 row from `uncovered_area_m2`; the validator below
 *     actively REJECTS a NO_COVERAGE response that arrives carrying class rows
 *     rather than rendering them.
 *
 * Official source class codes and Korean names are passed through verbatim — never
 * translated, normalized, renamed, re-grouped, or merged.
 */

import {
  ApiError,
  type LandCoverCellClassDistribution,
  type LandCoverCellStatistics,
  type LandCoverClassShare,
  type LandCoverCoverageStatus,
} from "./api";

/** Canonical Korean source label for the layer, matching the backend `korean_label`. */
export const LAND_COVER_SOURCE_LABEL = "토지피복";

/** The official dataset's own name for each hierarchy level. */
export const CLASS_LEVEL_LABELS: Record<1 | 2 | 3, string> = {
  1: "대분류",
  2: "중분류",
  3: "세분류",
};

/** Class hierarchy levels in official order. */
export const CLASS_LEVELS = [1, 2, 3] as const;
export type ClassLevel = (typeof CLASS_LEVELS)[number];

/**
 * Short Korean label for each coverage state, always carrying the machine status in
 * parentheses so the API's own vocabulary stays visible and greppable.
 */
export const COVERAGE_STATUS_LABELS: Record<LandCoverCoverageStatus, string> = {
  COMPLETE_EXACT: "격자 전체 평가 (COMPLETE_EXACT)",
  PARTIAL: "격자 일부만 평가 (PARTIAL)",
  NO_COVERAGE: "격자 미평가 (NO_COVERAGE)",
};

/**
 * Visual tone per coverage state — three distinct treatments, never color alone
 * (each state also carries its own label and explanatory sentence).
 *
 * PARTIAL and NO_COVERAGE are deliberately NOT the same tone: PARTIAL is a
 * qualified reading of real data, NO_COVERAGE is the absence of any reading.
 */
export type CoverageTone = "informational" | "warning" | "unevaluated";

export const COVERAGE_STATUS_TONES: Record<LandCoverCoverageStatus, CoverageTone> = {
  COMPLETE_EXACT: "informational",
  PARTIAL: "warning",
  NO_COVERAGE: "unevaluated",
};

/**
 * The one thing a reader must not conclude from each state, in the platform's own
 * voice. These sit BESIDE the backend's served `coverage_status_meaning` (which is
 * always rendered verbatim); they never replace it.
 */
export const COVERAGE_STATUS_CAVEATS: Record<LandCoverCoverageStatus, string> = {
  COMPLETE_EXACT:
    "확보된 토지피복 자료가 이 격자를 빈 곳 없이 평가했다는 뜻입니다(LC3 잔여영역 공집합 기준). 법적으로 완전하다거나, 이 격자의 모든 토지 상태를 알고 있다는 뜻은 아닙니다.",
  PARTIAL:
    "확보된 토지피복 자료가 이 격자의 일부만 평가했습니다. 아래 분류 구성은 평가된 부분만 설명하며, 격자 전체의 구성이 아닙니다.",
  NO_COVERAGE:
    "확보된 토지피복 자료의 범위가 이 격자를 평가하지 않았습니다. 토지피복이 없거나, 비어 있거나, 이용되지 않는 땅이라는 뜻이 아니며, 적합하거나 안전하다는 뜻도 아닙니다.",
};

/** Bounded, user-facing failure kinds. Backend internals are never surfaced. */
export type LandCoverErrorKind = "NOT_FOUND" | "UNAVAILABLE" | "MALFORMED";

/** Korean message for each failure kind — none of them implies "no land cover". */
export const LAND_COVER_ERROR_MESSAGES: Record<LandCoverErrorKind, string> = {
  NOT_FOUND:
    "이 후보 격자는 현재 활성화된 토지피복 통계 릴리스에 포함되어 있지 않습니다. 토지피복이 없다는 뜻은 아닙니다.",
  UNAVAILABLE:
    "토지피복 통계를 불러오지 못했습니다. 토지피복이 없다는 뜻은 아니며, 잠시 후 다시 시도할 수 있습니다.",
  MALFORMED:
    "토지피복 통계 응답을 해석할 수 없어 표시하지 않습니다. 불완전한 값을 대신 표시하지 않습니다.",
};

/**
 * Classify a thrown fetch failure into a bounded kind.
 *
 * A 404 from the LC4 API means "this candidate key has no row in the active
 * statistics release" — a real, nameable state, distinct from the API being down.
 * Everything else (5xx, network failure, CORS, JSON parse) collapses to
 * UNAVAILABLE: the user learns the section could not load, never why in terms of
 * stack traces, SQL, paths, or connection strings.
 */
export function landCoverErrorKind(error: unknown): LandCoverErrorKind {
  if (error instanceof ApiError && error.status === 404) return "NOT_FOUND";
  return "UNAVAILABLE";
}

// --------------------------------------------------------------------------- //
// Number formatting
// --------------------------------------------------------------------------- //

/**
 * Format an area in m² as a grouped Korean string.
 *
 * Rounds to whole m², except that a real non-zero area smaller than the smallest
 * displayable unit renders as "1 m² 미만" instead of "0 m²". An exact zero renders
 * as "0 m²" — that is a measured zero, not a missing value. A non-finite or absent
 * value renders as an em dash, never as zero.
 */
export function formatAreaM2(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0 m²";
  const rounded = Math.round(value);
  if (rounded === 0) return "1 m² 미만";
  return `${rounded.toLocaleString("ko-KR")} m²`;
}

/**
 * Format an area in m² as km² to 3 decimals, for the cell-scale totals where km²
 * is easier to hold in mind than a six-digit m² figure. Same non-zero-never-zero
 * rule as {@link formatAreaM2}.
 */
export function formatAreaKm2(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0 km²";
  const km2 = value / 1_000_000;
  const rounded = Math.round(km2 * 1000) / 1000;
  if (rounded === 0) return "0.001 km² 미만";
  return `${rounded.toLocaleString("ko-KR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} km²`;
}

/**
 * Format a 0–1 ratio as a percentage to one decimal.
 *
 * A real non-zero share smaller than 0.1% renders as "0.1% 미만" rather than "0.0%".
 * `null` — which the API uses for a share whose denominator is zero — renders as an
 * em dash, never as 0%.
 */
export function formatSharePercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0%";
  const percent = value * 100;
  const rounded = Math.round(percent * 10) / 10;
  if (rounded === 0) return "0.1% 미만";
  return `${rounded.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
}

/**
 * Format a cell's coverage ratio, refusing to contradict its coverage status.
 *
 * LC3 decides COMPLETE_EXACT by exact residual emptiness rather than by an area
 * threshold, so a PARTIAL cell's ratio can round to 100% (0.9999999999999876) and a
 * COMPLETE_EXACT cell's can round to slightly under it (0.9999999999999931). The
 * status is authoritative in both directions:
 *  - PARTIAL that rounds to 100% or more → "100% 미만" (never a flat 100%);
 *  - PARTIAL that rounds to 0% but is non-zero → "0.1% 미만" (never a flat 0%);
 *  - COMPLETE_EXACT → "100%", the exact meaning of the status.
 */
export function formatCoverageRatioPercent(
  ratio: number | null | undefined,
  status: LandCoverCoverageStatus,
): string {
  if (status === "COMPLETE_EXACT") return "100%";
  if (status === "NO_COVERAGE") return "0%";
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  const percent = Math.round(ratio * 1000) / 10;
  if (percent >= 100) return "100% 미만";
  if (percent <= 0) return ratio > 0 ? "0.1% 미만" : "0%";
  return `${percent.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
}

/**
 * Format the uncovered share of a cell as a percentage, as the complement of the
 * coverage ratio and under the same status-first rule: a PARTIAL cell always has a
 * non-empty uncovered residual, so its uncovered share never renders as a flat 0%.
 */
export function formatUncoveredRatioPercent(
  ratio: number | null | undefined,
  status: LandCoverCoverageStatus,
): string {
  if (status === "COMPLETE_EXACT") return "0%";
  if (status === "NO_COVERAGE") return "100%";
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  const percent = Math.round((1 - ratio) * 1000) / 10;
  if (percent <= 0) return "0.1% 미만";
  if (percent >= 100) return "100% 미만";
  return `${percent.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
}

/**
 * Render a dominant class as "코드 · 공식명", or an explicit absence marker.
 *
 * A missing dominant class is the EXPECTED state for a NO_COVERAGE cell. It is
 * reported as "해당 없음 (미평가)" — never an empty string, never a zero class code,
 * and never a synthesized Unknown/기타 class.
 */
export function formatDominantClass(
  code: string | null | undefined,
  name: string | null | undefined,
): string {
  if (!code && !name) return "해당 없음 (미평가)";
  if (code && name) return `${code} · ${name}`;
  return code ?? name ?? "해당 없음 (미평가)";
}

// --------------------------------------------------------------------------- //
// Response validation
// --------------------------------------------------------------------------- //

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCoverageStatus(value: unknown): value is LandCoverCoverageStatus {
  return value === "COMPLETE_EXACT" || value === "PARTIAL" || value === "NO_COVERAGE";
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

/**
 * Verify a cell-statistics response is coherent enough to render, for the key that
 * was actually requested.
 *
 * The identity check is not ceremony: it is the last line of defence against a
 * response from a PREVIOUS candidate being painted under the current one. The
 * fetching component already cancels superseded requests, but a key mismatch here
 * is treated as malformed rather than displayed.
 *
 * Returns the response typed, or null — never a partially-defaulted object, because
 * defaulting a missing area or share to zero would fabricate a measurement.
 */
export function validateCellStatistics(
  raw: unknown,
  requestedKey: string,
): LandCoverCellStatistics | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Partial<LandCoverCellStatistics>;
  if (d.candidate_key !== requestedKey) return null;
  if (!isCoverageStatus(d.coverage_status)) return null;
  if (!isFiniteNumber(d.coverage_ratio)) return null;
  if (!isFiniteNumber(d.cell_area_m2)) return null;
  if (!isFiniteNumber(d.evaluated_area_m2)) return null;
  if (!isFiniteNumber(d.uncovered_area_m2)) return null;
  if (typeof d.coverage_status_meaning !== "string" || d.coverage_status_meaning === "") return null;
  if (typeof d.used_in_suitability_scoring !== "boolean") return null;
  if (typeof d.dominant_class !== "object" || d.dominant_class === null) return null;
  if (typeof d.class_counts !== "object" || d.class_counts === null) return null;
  if (typeof d.release !== "object" || d.release === null) return null;
  if (typeof d.disclosures !== "object" || d.disclosures === null) return null;
  if (typeof d.disclosures.license_status !== "string") return null;
  // A NO_COVERAGE cell has no evaluated area by definition; a positive one would
  // make the coverage status and the measurements disagree.
  if (d.coverage_status === "NO_COVERAGE" && d.evaluated_area_m2 > 0) return null;
  return d as LandCoverCellStatistics;
}

/**
 * Verify a class-distribution response is coherent enough to render.
 *
 * Beyond identity and per-row shape, this enforces the invariant that gives the
 * NO_COVERAGE state its meaning: such a cell has NO class rows. A NO_COVERAGE
 * response arriving with rows is rejected outright rather than rendered, so
 * uncovered area can never surface as a class through a contract regression.
 */
export function validateClassDistribution(
  raw: unknown,
  requestedKey: string,
): LandCoverCellClassDistribution | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Partial<LandCoverCellClassDistribution>;
  if (d.candidate_key !== requestedKey) return null;
  if (!isCoverageStatus(d.coverage_status)) return null;
  if (!Array.isArray(d.items)) return null;
  if (typeof d.total !== "number" || !Number.isInteger(d.total) || d.total < 0) return null;
  if (d.coverage_status === "NO_COVERAGE" && d.items.length > 0) return null;
  for (const item of d.items) {
    if (typeof item !== "object" || item === null) return null;
    const row = item as Partial<LandCoverClassShare>;
    if (row.class_level !== 1 && row.class_level !== 2 && row.class_level !== 3) return null;
    if (typeof row.class_code !== "string" || row.class_code === "") return null;
    if (typeof row.class_name !== "string" || row.class_name === "") return null;
    if (!isFiniteNumber(row.class_area_m2)) return null;
    if (!isNullableFiniteNumber(row.share_of_evaluated_area)) return null;
    if (!isNullableFiniteNumber(row.share_of_cell_area)) return null;
  }
  return d as LandCoverCellClassDistribution;
}

/**
 * The rows for one hierarchy level, in the order the API served them (level
 * ascending, then area descending). Filtering preserves that order exactly; nothing
 * is re-sorted, re-grouped, or merged client-side.
 */
export function classRowsForLevel(
  items: readonly LandCoverClassShare[],
  level: ClassLevel,
): LandCoverClassShare[] {
  return items.filter((item) => item.class_level === level);
}

/** Distinct class count for one level, read from the served counts (never recomputed). */
export function classCountForLevel(
  counts: LandCoverCellStatistics["class_counts"] | null | undefined,
  level: ClassLevel,
): number | null {
  if (!counts) return null;
  const value =
    level === 1 ? counts.l1_class_count : level === 2 ? counts.l2_class_count : counts.l3_class_count;
  return Number.isFinite(value) ? value : null;
}
