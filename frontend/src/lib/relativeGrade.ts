/**
 * 상대 점수 구간 (A/B/C) — a PRESENTATION grade, never an analytical verdict.
 *
 * ── What this is, and what it is emphatically not ────────────────────────────────
 * A/B/C divides the CURRENTLY SCORED ELIGIBLE candidates into three relative bands
 * so a reader can see where one candidate sits in that distribution. It does NOT:
 *
 *   - change, override, or re-derive the official screening status
 *     (ELIGIBLE / REVIEW_REQUIRED / EXCLUDED stay backend-authoritative);
 *   - change a rank, a score, a stability class, or any stored run;
 *   - apply to REVIEW_REQUIRED or EXCLUDED candidates at all — they have no
 *     comparable score in this population and are never given a grade;
 *   - mean "A is legally suitable" or "C is excluded". Both statements are false
 *     and the citizen-facing copy says so explicitly.
 *
 * ── Where the population comes from ──────────────────────────────────────────────
 * The thresholds MUST come from the complete authoritative ELIGIBLE population for
 * the active run and profile — never from the viewport, the current filters, the
 * top-N list, or the selected subset (docs/YEOGIDA_UI_REDESIGN_SPEC.md §6.4).
 *
 * Downloading all ~17.5k eligible candidates to compute two numbers would be a
 * multi-megabyte transfer of geometry the grade does not need. Instead this module
 * reads the two ORDER STATISTICS directly, which the existing
 * `/suitability/candidates` endpoint already supports and which is both exact and
 * cheap (four ~1 KB requests, no new endpoint and no backend change):
 *
 *   - `top=…` makes the endpoint filter to `status = ELIGIBLE` with a rank for the
 *     requested profile, and order by that rank ASCENDING (rank 1 = best score).
 *     `total_matched` on that query is therefore N, the complete population size.
 *   - `limit=1&offset=k-1` returns exactly the k-th ranked candidate, so its
 *     `total_score` IS the order statistic at that rank.
 *   - `min_score=` + `limit=1` returns a `total_matched` count, giving the exact
 *     band sizes without listing anything.
 *
 * `top` is capped at 5000 by the API, but it only bounds `effective_limit`
 * (`min(top, limit)`), never the offset — so `top=5000&limit=1&offset=k-1` reaches
 * any rank. That is a real dependency on the endpoint's semantics, so
 * {@link EXPECTED_ORDERING_NOTE} records it for whoever changes that route next.
 *
 * ── The percentile method (deterministic, documented) ────────────────────────────
 * NEAREST-RANK on the ASCENDING score order, the unambiguous textbook definition:
 *
 *     ascendingIndex(p) = ceil(p / 100 × N)          (1-based)
 *
 * The API ranks DESCENDING (rank 1 = highest score), so the ascending index i maps
 * to descending rank `N - i + 1`. No interpolation, no averaging: every threshold
 * is a score a real candidate actually has.
 *
 * Ties are not smoothed away. Because the bands are defined by VALUE
 * (`score >= P75`) rather than by position, a cluster of equal scores at a
 * threshold makes that band larger than a nominal quarter — which is the truth
 * about the distribution, not an error. {@link GradeDistribution} therefore
 * reports the real counts rather than assuming 25/50/25.
 */

import type { SuitabilityProfile, SuitabilityStatus } from "./api";
import { fetchSuitabilityCandidates } from "./api";

/** The three relative bands. Deliberately not named after any official status. */
export type RelativeGrade = "A" | "B" | "C";

/**
 * The endpoint behaviour this module relies on. Asserted by
 * `relativeGrade.test.ts` so a backend change that breaks it fails loudly here
 * rather than silently producing a wrong threshold.
 */
export const EXPECTED_ORDERING_NOTE =
  "GET /suitability/candidates?top=…&status=ELIGIBLE orders by the requested profile's rank " +
  "ASCENDING (rank 1 = highest score); `top` caps only the page size, not the offset.";

/** The API's hard cap on `top`. Used purely to switch on the eligible+ranked filter. */
const TOP_FILTER_SENTINEL = 5000;

export interface GradeThresholds {
  /** The run these thresholds were computed for. */
  runId: number;
  /** The weight profile these thresholds were computed for. */
  profile: SuitabilityProfile;
  /** N — the COMPLETE authoritative ELIGIBLE-with-rank population size. */
  population: number;
  /** 25th percentile score (nearest-rank). */
  p25: number;
  /** 75th percentile score (nearest-rank). */
  p75: number;
}

export interface GradeDistribution extends GradeThresholds {
  /** Exact band sizes, counted by the backend — never assumed to be N/4, N/2, N/4. */
  countA: number;
  countB: number;
  countC: number;
}

/**
 * The 1-based ASCENDING index of the nearest-rank percentile, and the DESCENDING
 * rank that addresses it through the API. Exported for the tests, which pin the
 * arithmetic independently of any network call.
 */
export function nearestRankIndex(percentile: number, population: number): number {
  return Math.ceil((percentile / 100) * population);
}

export function ascendingIndexToDescendingRank(index: number, population: number): number {
  return population - index + 1;
}

/**
 * Assign a band to a score. `null` for anything that must not be graded.
 *
 * The status gate is inside this function ON PURPOSE: it is the one place a
 * caller could accidentally grade a REVIEW_REQUIRED or EXCLUDED candidate, and
 * making every call site pass the status makes that impossible to forget.
 */
export function gradeFor(
  status: SuitabilityStatus,
  score: number | string | null | undefined,
  thresholds: Pick<GradeThresholds, "p25" | "p75"> | null,
): RelativeGrade | null {
  if (thresholds === null) return null;
  // Only officially ELIGIBLE candidates are part of the graded population.
  if (status !== "ELIGIBLE") return null;
  if (score === null || score === undefined || score === "") return null;
  const value = typeof score === "number" ? score : Number(score);
  // A missing or unparseable score is NOT a low score — it gets no grade at all.
  if (!Number.isFinite(value)) return null;
  if (value >= thresholds.p75) return "A";
  if (value >= thresholds.p25) return "B";
  return "C";
}

/** Citizen-facing wording. Never "적격"/"부적격" — those are status words. */
export const GRADE_LABELS: Record<RelativeGrade, string> = {
  A: "상위 구간(A)",
  B: "중간 구간(B)",
  C: "하위 구간(C)",
};

export const RELATIVE_GRADE_TITLE = "상대 점수 구간";

export const RELATIVE_GRADE_EXPLANATION =
  "현재 점수가 계산된 스크리닝 통과 구역 전체의 점수 분포를 상위 25% · 중간 50% · 하위 25%로 나눈 " +
  "상대 구간입니다. 구간은 서로 비교하기 위한 표시일 뿐이며, 법적 적합·부적합 판정이 아닙니다. " +
  "A가 적격을 의미하지 않고 C가 제외를 의미하지 않습니다.";

/**
 * The one sentence that must sit next to any A/B/C surface, naming the population
 * the bands were computed from so a reader is never left guessing whether it was
 * the whole set or just what is on screen.
 */
export function relativeGradeBasis(distribution: GradeDistribution): string {
  return (
    `분석 실행 ${distribution.runId} · 점수 반영 기준별 전체 스크리닝 통과 구역 ` +
    `${distribution.population.toLocaleString("ko-KR")}곳의 점수 분포 기준 ` +
    `(하위 25% 경계 ${distribution.p25}, 상위 25% 경계 ${distribution.p75})`
  );
}

/** Parse the served decimal-string score into a number, or null. */
function parseScore(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Compute the thresholds and the exact band sizes for one run + profile.
 *
 * Returns `null` — never a guess — when the complete population cannot be
 * established: an empty or too-small population, a candidate served without a
 * score, or any request failure. A null result disables A/B/C in the UI and is
 * recorded as a limitation rather than replaced with an approximation
 * (spec §6.4, "insufficient population rule").
 *
 * A population below 4 cannot produce meaningful quartiles, so it is refused.
 */
export async function computeGradeDistribution(
  runId: number,
  profile: SuitabilityProfile,
): Promise<GradeDistribution | null> {
  try {
    // 1. N, from the same filtered query the thresholds come from.
    const probe = await fetchSuitabilityCandidates({
      runId,
      profile,
      status: "ELIGIBLE",
      top: TOP_FILTER_SENTINEL,
      limit: 1,
    });
    const population = probe.total_matched;
    if (!Number.isFinite(population) || population < 4) return null;

    // 2. The two order statistics, addressed by descending rank.
    const rank25 = ascendingIndexToDescendingRank(nearestRankIndex(25, population), population);
    const rank75 = ascendingIndexToDescendingRank(nearestRankIndex(75, population), population);
    const [at25, at75] = await Promise.all([
      fetchSuitabilityCandidates({
        runId,
        profile,
        status: "ELIGIBLE",
        top: TOP_FILTER_SENTINEL,
        limit: 1,
        offset: rank25 - 1,
      }),
      fetchSuitabilityCandidates({
        runId,
        profile,
        status: "ELIGIBLE",
        top: TOP_FILTER_SENTINEL,
        limit: 1,
        offset: rank75 - 1,
      }),
    ]);
    const p25 = parseScore(at25.features[0]?.properties.total_score);
    const p75 = parseScore(at75.features[0]?.properties.total_score);
    if (p25 === null || p75 === null) return null;
    // A degenerate distribution (every score identical) cannot be split into
    // meaningful bands; refusing is honest, inventing a spread is not.
    if (!(p75 >= p25)) return null;

    // 3. Exact band sizes, counted by the backend under the SAME filter.
    const [aBand, from25] = await Promise.all([
      fetchSuitabilityCandidates({ runId, profile, status: "ELIGIBLE", minScore: p75, limit: 1 }),
      fetchSuitabilityCandidates({ runId, profile, status: "ELIGIBLE", minScore: p25, limit: 1 }),
    ]);
    const countA = aBand.total_matched;
    const countC = population - from25.total_matched;
    const countB = population - countA - countC;
    // The three bands must partition the population exactly. If they do not, the
    // population shifted mid-read (a new run published) — refuse rather than show
    // bands that do not add up.
    if (countA < 0 || countB < 0 || countC < 0) return null;
    if (countA + countB + countC !== population) return null;

    return { runId, profile, population, p25, p75, countA, countB, countC };
  } catch {
    // Any request failure disables the grade. It is decoration over an analytical
    // surface; degrading to "no grade" is always safe, guessing never is.
    return null;
  }
}
