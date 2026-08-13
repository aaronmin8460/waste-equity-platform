/**
 * 순위 전체보기 — the paging contract behind the full candidate ranking.
 *
 * ③ 종합 점수와 후보 순위 shows a top-N cut of the scoped ranking. 전체보기 opens
 * the SAME ranking with no cut. This module is the one place that ranking is
 * addressed from, so the card, the dialog's pages, and the CSV export cannot
 * drift into three slightly different populations.
 *
 * ── THE RANKED OBJECT IS A 500 m CANDIDATE CELL ──────────────────────────────────
 * Not a 시·군·구. Every row this module returns is one cell, carrying its own
 * `candidate_key` and `candidate_id`; the 시·군·구 name is only WHERE that cell
 * lies. Nothing here groups, averages, area-weights, or takes a best-per-city —
 * the Figma modal (138:415) lists bare city names as though the municipality were
 * the scored object, and that is the one thing this implementation must not copy.
 *
 * ── WHY EVERY REQUEST CARRIES `top` ──────────────────────────────────────────────
 * `/suitability/candidates` has two different orderings
 * (docs/SUITABILITY_SCOPE_FILTER_API.md §2):
 *
 *   - with `top`, the WHERE clause becomes `status = 'ELIGIBLE' AND the REQUESTED
 *     profile has a rank`, and rows order by THAT profile's rank;
 *   - without it, rows order by the indexed first-class `rank` column, which is
 *     the run's ACTIVE profile — a different ranking whenever the reader has
 *     switched ② 점수 반영 기준.
 *
 * So `top` is not a page size here, it is the *filter selector*. The server takes
 * `effective_limit = min(top, limit)` and applies `offset` independently, so
 * `top=5000` + a real `limit`/`offset` pages the whole eligible population while
 * keeping the profile-correct ordering. `total_matched` is counted over the same
 * WHERE clause before any limit, so it stays the authoritative scoped total no
 * matter which page is being read.
 *
 * That also makes the dialog's first page start with exactly the rows the card is
 * already showing: same WHERE, same ORDER BY, offset 0.
 *
 * ── WHAT IS *NOT* INHERITED, AND WHY ─────────────────────────────────────────────
 * The map's 상태 표시 (statusVisibility) and 안정 후보만 보기 (stableOnly) toggles
 * are DISPLAY state for the map layer; the card's ranking request has never
 * carried them, and neither does this one. Narrowing the dialog by them would make
 * 전체보기 disagree with the card it was opened from — the dialog says plainly that
 * the ranking is 스크리닝 통과(ELIGIBLE) cells only.
 */

import type {
  CandidateFeature,
  CandidateQuery,
  SuitabilityCandidateCollection,
  SuitabilityProfile,
  SuitabilitySort,
} from "./api";
import { fetchSuitabilityCandidates } from "./api";
import { scopeToQuery, type SuitabilityScope } from "./suitabilityScope";

/**
 * The API's `top` ceiling. Passed as the ELIGIBLE-with-rank filter selector, NOT
 * as a page size — `effective_limit = min(top, limit)`, so the real bound is
 * always `limit`. Mirrors `relativeGrade.ts::TOP_FILTER_SENTINEL`.
 */
export const RANKING_TOP_FILTER_SENTINEL = 5000;

/**
 * Rows per dialog page.
 *
 * The API's own default page is 500 and its ceiling 5000; both are sized for bulk
 * reads, not for a table a person scrolls. 50 is one comfortable screen of the
 * Figma row rhythm and keeps each page a small request, so paging feels immediate.
 */
export const RANKING_PAGE_SIZE = 50;

/**
 * Rows per request while collecting the WHOLE ranking for the CSV.
 *
 * Larger than a display page because nobody is looking at it: 1,000 turns the
 * capital-region eligible population (~17.5k cells) into ~18 sequential requests
 * instead of ~350. Kept under the 5,000 ceiling so a single page can never be
 * rejected, and requests are issued IN ORDER so the exported file is byte-stable
 * for the same scope+sort.
 */
export const RANKING_EXPORT_PAGE_SIZE = 1000;

/**
 * The most rows one export will collect.
 *
 * A backstop, not a product limit: the largest real population here is the whole
 * capital region's eligible set, comfortably inside it. It exists so a future run
 * with an unexpectedly large grid degrades into a STATED partial export rather
 * than an unbounded fetch loop. When it bites, {@link RankingExportResult.truncated}
 * is set and the caller must say so in the file — a short export labelled "full"
 * is the exact dishonesty this whole feature is meant to avoid.
 */
export const RANKING_EXPORT_MAX_ROWS = 25_000;

/** The active ranking, as the page holds it. The dialog and the export share it. */
export interface RankingRequest {
  runId: number;
  profile: SuitabilityProfile;
  scope: SuitabilityScope;
  sort: SuitabilitySort;
}

/**
 * THE ONE QUERY BUILDER for the scoped ranking.
 *
 * Every read of the full ranking — a dialog page, an export page — is built here,
 * so the filter, the ordering and the scope serialization are defined once.
 * `scopeToQuery` is the only thing that writes `sido`/`sigungu`, which is what
 * makes the illegal `sido` + `sigungu` pair unrepresentable (see
 * lib/suitabilityScope.ts).
 */
export function rankingPageQuery(
  request: RankingRequest,
  limit: number,
  offset: number,
): CandidateQuery {
  return {
    runId: request.runId,
    profile: request.profile,
    // `status` is deliberately absent: with `top` set the server ignores it and
    // applies `status = 'ELIGIBLE'` itself. Sending both would imply this module
    // chooses the status filter, when in fact the ordering choice fixes it.
    top: RANKING_TOP_FILTER_SENTINEL,
    limit,
    offset,
    sort: request.sort,
    ...scopeToQuery(request.scope),
  };
}

/** Read one page of the ranking. `page` is 0-based. */
export function fetchRankingPage(
  request: RankingRequest,
  page: number,
  signal?: AbortSignal,
  pageSize: number = RANKING_PAGE_SIZE,
): Promise<SuitabilityCandidateCollection> {
  return fetchSuitabilityCandidates(
    rankingPageQuery(request, pageSize, page * pageSize),
    signal,
  );
}

/** Total page count for an authoritative total. Zero rows ⇒ zero pages. */
export function pageCount(totalMatched: number, pageSize: number = RANKING_PAGE_SIZE): number {
  if (!Number.isFinite(totalMatched) || totalMatched <= 0) return 0;
  return Math.ceil(totalMatched / pageSize);
}

/** 1-based display range of a page, clamped to the authoritative total. */
export function pageRange(
  page: number,
  totalMatched: number,
  pageSize: number = RANKING_PAGE_SIZE,
): { first: number; last: number } {
  if (totalMatched <= 0) return { first: 0, last: 0 };
  const first = page * pageSize + 1;
  const last = Math.min(totalMatched, (page + 1) * pageSize);
  return { first: Math.min(first, last), last };
}

export interface RankingExportResult {
  /** Every collected row, in the served order — never re-sorted client-side. */
  features: CandidateFeature[];
  /** The backend's authoritative count for this scope, from the FIRST page. */
  totalMatched: number;
  /** True when {@link RANKING_EXPORT_MAX_ROWS} stopped collection short. */
  truncated: boolean;
  /** Run-level provenance, echoed by the server on the first page. */
  collection: SuitabilityCandidateCollection | null;
}

/**
 * Collect the COMPLETE ranking for the active scope, by paging the same query the
 * dialog reads.
 *
 * Sequential on purpose. Concurrent pages would interleave unpredictably and make
 * the exported file's order depend on network timing; issuing them in order means
 * the same scope + sort always produces the same file. The loop stops when the
 * server returns a short page or an empty one, so it terminates even if
 * `total_matched` disagrees with what is actually paged.
 *
 * Ordering is the SERVER's throughout — this never sorts, re-ranks, or reverses
 * anything. A 낮은 순 export is `sort=score_asc` asked of the backend, never the
 * 높은 순 rows turned around.
 */
export async function fetchEntireRanking(
  request: RankingRequest,
  signal?: AbortSignal,
  pageSize: number = RANKING_EXPORT_PAGE_SIZE,
  maxRows: number = RANKING_EXPORT_MAX_ROWS,
): Promise<RankingExportResult> {
  const features: CandidateFeature[] = [];
  let totalMatched = 0;
  let first: SuitabilityCandidateCollection | null = null;
  let truncated = false;

  for (let offset = 0; ; offset += pageSize) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const remaining = maxRows - features.length;
    if (remaining <= 0) {
      // Only a real truncation: `remaining <= 0` with rows still unread.
      truncated = features.length < totalMatched;
      break;
    }
    const collection = await fetchSuitabilityCandidates(
      rankingPageQuery(request, Math.min(pageSize, remaining), offset),
      signal,
    );
    if (first === null) {
      first = collection;
      totalMatched = collection.total_matched;
    }
    features.push(...collection.features);
    // A short page is the end of the data. Checked against the limit ACTUALLY
    // requested (which `remaining` may have shrunk), not the nominal page size.
    if (collection.features.length < Math.min(pageSize, remaining)) break;
    if (features.length >= totalMatched) break;
  }

  return { features, totalMatched, truncated, collection: first };
}
