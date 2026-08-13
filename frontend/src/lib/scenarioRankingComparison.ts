/**
 * 후보지 순위 비교 — the ONE analytics model for Page 5B (Figma frame 167:10554).
 *
 * Page 5A resolves the pair, validates the run and re-previews both sides
 * (docs/figma-redesign/PAGE_5_SCENARIO_CONTRACT.md §9). This module takes those two
 * settled `UserScenarioPreview` responses and derives every rank figure Page 5B
 * shows: the 1위 comparison, TOP-10 retention, per-candidate rank movement, the
 * slope rows and the comparison table. Each Page-5B component reads THIS object;
 * none of them recomputes a rank, so the KPI row and the table can never print two
 * different answers to the same question.
 *
 * React-free on purpose — `lib/` is the pure, directly-testable layer.
 *
 * ── WHAT THIS MODULE MAY NOT DO ──────────────────────────────────────────────────
 * It does not read `localStorage`, parse `cmpA`/`cmpB`, call the preview API, or
 * canonicalise weights. All four belong to Page 5A and happen exactly once.
 *
 * ── A vs B IS NOT THE PREVIEW'S OWN COMPARISON COLUMN ─────────────────────────────
 * Each preview already carries `comparison_score` / `comparison_rank` / `rank_delta`
 * / `rank_change_direction`. Those describe THAT SIDE against the official
 * `compare_profile` (pinned to `baseline` by the foundation) — they are "A안 vs
 * 공식 기준", not "A안 vs B안". Reading them here would produce a number that looks
 * like an A/B movement and is not one, so this module reads ONLY `custom_rank` and
 * `custom_score` from each side and never touches the four comparison fields.
 *
 *   A's value comes from A's CUSTOM output. B's value comes from B's CUSTOM output.
 *
 * ── SIGN CONVENTION (deliberately the OPPOSITE of the backend's) ──────────────────
 * `rankDelta = rankB − rankA`. A rank NUMBER that got smaller means the candidate
 * moved UP, so a NEGATIVE delta is 순위 상승. The backend's own `rank_delta`
 * (`analysis/suitability/scenario.py`) is `comparison_rank − custom_rank`, where
 * POSITIVE is up — the opposite. The two never meet because this module does not
 * read that field, but every consumer must key off {@link RankMovementDirection}
 * rather than the sign of the number, and `movement` is exported as an already-
 * signed magnitude so nothing downstream has to know the convention at all.
 *
 * ── WHY AN ABSENT RANK IS NEVER INVENTED ─────────────────────────────────────────
 * The preview is bounded: `top_n` rows of a ranking whose population is
 * `ranking_population`. A candidate in A's list may be absent from B's. The backend
 * ranks the COMPLETE eligible population before it cuts
 * (`api/routes/suitability_scenarios.py` `_PREVIEW_SQL`: `row_number() OVER (...)`
 * then `ORDER BY custom_rank ASC LIMIT :top_n`), so a served list of k rows is
 * exactly ranks 1..k — which is the only reason "그 후보는 B안 상위 k 밖" can be
 * stated at all. {@link rankBoundary} re-derives that fact from the response
 * instead of assuming it, and downgrades to "순위 미제공" the moment the served
 * rows do not actually form 1..k. Nothing here ever substitutes `top_n + 1`,
 * `ranking_population`, or any other stand-in for a rank the server did not send.
 *
 * ── NO SCREENING ANALYTICS ───────────────────────────────────────────────────────
 * The Figma frame's 통과 지역 수 변화 / 신규 통과 / 통과 → 제외 / 60점 기준 KPIs are
 * mock. Screening is rule-based and does not move when a scenario is reweighted, so
 * a "newly passed" count would be a fabricated finding. This module derives no
 * status, no threshold and no pass/fail, and the preview's own
 * `candidate_count_eligible` family is deliberately not read here.
 */

import type { UserScenarioPreview, UserScenarioTopCandidate } from "./api";
import type { ComparisonSide, ScenarioComparison } from "./scenarioComparison";

// --------------------------------------------------------------------------- //
// Frozen analytical bounds
// --------------------------------------------------------------------------- //

/**
 * The N of the TOP-N retention KPI and of the slope chart's two ranked columns.
 *
 * 10 is the Figma frame's own N ("TOP 10 유지 후보", "후보지 순위 변화 TOP 10") and
 * is well inside the foundation's `SCENARIO_COMPARISON_TOP_N` (50), so a candidate
 * in either side's top 10 almost always has an exact rank on the other side too.
 */
export const RANKING_COMPARISON_TOP_N = 10;

/** How many rows the 순위 변화가 큰 후보 list shows. */
export const RANKING_MOVEMENT_LIST_SIZE = 10;

// --------------------------------------------------------------------------- //
// Rank availability — the honest three-state answer
// --------------------------------------------------------------------------- //

/**
 * Whether one side has a usable rank for one candidate, and if not, WHY not.
 *
 * `OUTSIDE_PREVIEW` is a real, defensible finding: the served list is provably
 * ranks 1..k, so an absent candidate ranks worse than k. `UNKNOWN` is the answer
 * whenever that proof does not hold — it says "the server did not tell us", which
 * is the only other thing we are entitled to say.
 */
export type RankAvailability = "EXACT" | "OUTSIDE_PREVIEW" | "UNKNOWN";

/** Direction of an A→B rank movement. Never inferred from a delta's sign downstream. */
export type RankMovementDirection = "UP" | "DOWN" | "SAME";

/**
 * What one side's preview proves about the ranks it did NOT send.
 *
 * `servedCount` rows that carry exactly ranks 1..servedCount are `contiguous`, and
 * only then may an absent candidate be called "상위 servedCount 밖". `complete`
 * means the whole ranked population fitted inside the cut, in which case an absent
 * candidate is not "outside the preview" at all — it is a candidate the two sides
 * disagree about the existence of, which is `UNKNOWN`, not a rank.
 */
export interface RankBoundary {
  servedCount: number;
  rankingPopulation: number | null;
  contiguous: boolean;
  complete: boolean;
}

/** Derive what a served top-N list proves, from the response itself. */
export function rankBoundary(preview: UserScenarioPreview | null): RankBoundary {
  const rows = preview?.top_candidates ?? [];
  const servedCount = rows.length;
  const population =
    preview != null && Number.isFinite(preview.ranking_population)
      ? preview.ranking_population
      : null;

  // Exactly the set {1..servedCount}: sorted, gapless, starting at 1. Checked rather
  // than assumed, because everything the "상위 N 밖" wording claims rests on it.
  const seen = new Set<number>();
  let contiguous = servedCount > 0;
  for (const row of rows) {
    const rank = row.custom_rank;
    if (!Number.isInteger(rank) || rank < 1 || rank > servedCount || seen.has(rank)) {
      contiguous = false;
      break;
    }
    seen.add(rank);
  }

  return {
    servedCount,
    rankingPopulation: population,
    contiguous,
    complete: population !== null && servedCount >= population,
  };
}

/**
 * The availability of a rank this side did not serve.
 *
 * Only ever called for a candidate ABSENT from this side's list — a present
 * candidate is `EXACT` by construction.
 */
function absentRankAvailability(boundary: RankBoundary): RankAvailability {
  if (!boundary.contiguous) return "UNKNOWN";
  // The cut held the entire population, so "outside the cut" describes nothing.
  if (boundary.complete) return "UNKNOWN";
  return "OUTSIDE_PREVIEW";
}

// --------------------------------------------------------------------------- //
// Candidate identity
// --------------------------------------------------------------------------- //

/**
 * One 500 m candidate cell, joined across the two sides.
 *
 * ── THE JOIN KEY IS `candidate_key` ──────────────────────────────────────────────
 * Never the display name, never the 시·군·구, never the row position and never the
 * rank. A 시·군·구 holds many candidate cells, so joining on a location label would
 * silently merge distinct cells and invent movements between them; joining on
 * position or rank would pair A's 3rd row with B's 3rd row, which is the one thing
 * an A/B rank comparison exists to tell apart.
 */
export interface RankedCandidateRow {
  candidateKey: string;
  candidateId: number;
  /** "경기도 시흥시", or the part of it that was served. Never a fabricated place. */
  locationLabel: string | null;
  sidoName: string | null;
  sigunguName: string | null;
  centroidLat: number | null;
  centroidLon: number | null;

  /** Exact population-wide rank under A's own custom weights; `null` unless EXACT. */
  aRank: number | null;
  bRank: number | null;
  aRankState: RankAvailability;
  bRankState: RankAvailability;

  /** The side's own `custom_score` string, verbatim. Never re-rounded here. */
  aScore: string | null;
  bScore: string | null;

  /** `bRank − aRank`; `null` unless BOTH ranks are EXACT. See the sign note above. */
  rankDelta: number | null;
  /** Places moved, unsigned. `null` unless both ranks are EXACT. */
  movement: number | null;
  /** `null` unless both ranks are EXACT — an unknown movement is not "유지". */
  direction: RankMovementDirection | null;

  /** Within this side's `RANKING_COMPARISON_TOP_N`. False when the rank is not EXACT. */
  inTopA: boolean;
  inTopB: boolean;
}

/**
 * The location line for a candidate cell — never invented, never a bare code.
 *
 * `sigungu_region_name` is ALREADY fully qualified by the backend ("인천광역시 강화군",
 * not "강화군"), so the 시·도 name must NOT be prepended: doing so prints
 * "인천광역시 인천광역시 강화군". This is the same one-field rule
 * `SuitabilityRankingDialog`/`SuitabilityCandidateList` use (`cellLocationLabel`).
 * The 시·도 is the fallback only for a cell with no 시·군·구 assigned, so a partly
 * located cell still says where it is instead of saying nothing.
 */
function locationLabelOf(candidate: UserScenarioTopCandidate): string | null {
  const named = (value: string | null): string | null =>
    typeof value === "string" && value.trim() !== "" ? value : null;
  return named(candidate.sigungu_region_name) ?? named(candidate.sido_region_name);
}

function indexByKey(preview: UserScenarioPreview | null): Map<string, UserScenarioTopCandidate> {
  const index = new Map<string, UserScenarioTopCandidate>();
  for (const candidate of preview?.top_candidates ?? []) {
    // First occurrence wins, matching the storage module's duplicate rule. A
    // duplicated key in one response would otherwise make the join order-dependent.
    if (!index.has(candidate.candidate_key)) index.set(candidate.candidate_key, candidate);
  }
  return index;
}

function directionOf(delta: number): RankMovementDirection {
  // A SMALLER rank number is a BETTER rank, so a negative delta is 순위 상승.
  if (delta < 0) return "UP";
  if (delta > 0) return "DOWN";
  return "SAME";
}

// --------------------------------------------------------------------------- //
// Top-1
// --------------------------------------------------------------------------- //

/**
 * The rank-1 candidate of one side, and whether the two sides agree.
 *
 * `state` is `UNAVAILABLE` when either side served no rank-1 row: a comparison with
 * one endpoint missing is not "변화 없음", and printing the one side that does have
 * a top candidate as though it were the answer would be a one-sided claim.
 */
export interface TopCandidateComparison {
  state: "UNCHANGED" | "CHANGED" | "UNAVAILABLE";
  a: RankedCandidateRow | null;
  b: RankedCandidateRow | null;
}

// --------------------------------------------------------------------------- //
// TOP-N retention
// --------------------------------------------------------------------------- //

/**
 * Exact set overlap of the two sides' top-N candidate keys.
 *
 * ── IT IS A TOP-N STATEMENT AND NOTHING WIDER ────────────────────────────────────
 * `denominator` is `min(N, served A, served B)`, not always N: a run whose ranked
 * population is smaller than N has no tenth candidate to retain, and dividing by a
 * denominator the data does not support would understate retention. `n` reports
 * the nominal N so a caller can say "요청한 상위 10" and "실제 비교한 8" apart.
 *
 * This metric may NOT be captioned 전체 순위 안정성 or 전체 후보 유지율. It describes
 * the top `denominator` rows and says nothing whatever about the rest of the
 * ranked population.
 */
export interface TopNRetention {
  /** The nominal N asked for (`RANKING_COMPARISON_TOP_N`). */
  n: number;
  /** The N actually available on BOTH sides — the honest denominator. */
  denominator: number;
  /** |A top-N keys ∩ B top-N keys|. */
  retained: number;
  /** `retained / denominator` as whole percent; `null` when the denominator is 0. */
  percent: number | null;
  /** True when `denominator < n`, so the caller can label the shortfall. */
  reduced: boolean;
}

// --------------------------------------------------------------------------- //
// Slope rows
// --------------------------------------------------------------------------- //

/**
 * One line of the A→B movement visualization.
 *
 * The population is the UNION of the two sides' top-N sets — the same two ranked
 * columns the Figma frame draws, plus the honest edge cases it does not have:
 * a candidate in A's top 10 but not B's still gets a line, ending at its real B
 * rank when one was served and at an explicit out-of-preview marker when it was
 * not. A numeric endpoint is drawn ONLY where `aRankState`/`bRankState` is `EXACT`.
 */
export interface ScenarioSlopeRow extends RankedCandidateRow {
  /** Slot 1..N in A's ranked column; `null` when this candidate is not in A's top N. */
  aSlot: number | null;
  bSlot: number | null;
}

// --------------------------------------------------------------------------- //
// The model
// --------------------------------------------------------------------------- //

/** Local sort keys for the comparison table. All operate on already-derived rows. */
export type RankingComparisonSort =
  | "movement_desc"
  | "rank_a_asc"
  | "rank_b_asc"
  | "score_change_desc";

/**
 * Everything Page 5B renders, derived once.
 *
 * `candidateRows` is the UNION of the two served lists: a candidate that appears in
 * either side's preview gets a row, with the other side's state named honestly. The
 * union is the informative population — an intersection-only table would silently
 * drop exactly the candidates whose ranking changed the most.
 */
export interface ScenarioRankingComparison {
  runId: number | null;
  /** The N both served lists were cut at, per side. */
  boundaryA: RankBoundary;
  boundaryB: RankBoundary;
  /** The full ranked population, when both sides report the same one; else `null`. */
  rankingPopulation: number | null;

  topCandidate: TopCandidateComparison;
  topNRetention: TopNRetention;

  /** Union of both served lists, sorted by A rank then B rank then key. */
  candidateRows: RankedCandidateRow[];
  /** The subset with an EXACT rank on BOTH sides — the only rows a delta exists for. */
  comparableRows: RankedCandidateRow[];

  /** Common candidates that moved up / down / held, within `comparableRows`. */
  roseCount: number;
  fellCount: number;
  heldCount: number;

  slopeRows: ScenarioSlopeRow[];

  /** One sentence naming the bounded population every figure above describes. */
  scopeDescription: string;
}

/**
 * Build the model, or `null` when there is nothing truthful to build.
 *
 * `null` when either side is not `READY`. Page 5A owns every not-ready state and its
 * recovery; Page 5B's answer to "the comparison is not ready" is to render nothing,
 * because an empty card captioned 순위 변동 reads as "no candidate moved".
 */
export function buildScenarioRankingComparison(
  comparison: ScenarioComparison,
): ScenarioRankingComparison | null {
  const { sideA, sideB } = comparison;
  if (!isReady(sideA) || !isReady(sideB)) return null;

  const previewA = sideA.preview;
  const previewB = sideB.preview;

  const boundaryA = rankBoundary(previewA);
  const boundaryB = rankBoundary(previewB);

  const byKeyA = indexByKey(previewA);
  const byKeyB = indexByKey(previewB);

  // Union, A's order first so the table's natural order is A's ranking with B-only
  // candidates appended in B's order. Both maps preserve served (rank) order.
  const keys: string[] = [...byKeyA.keys()];
  for (const key of byKeyB.keys()) if (!byKeyA.has(key)) keys.push(key);

  const candidateRows = keys.map((key) =>
    joinCandidate(key, byKeyA.get(key) ?? null, byKeyB.get(key) ?? null, boundaryA, boundaryB),
  );
  candidateRows.sort(compareByNaturalOrder);

  const comparableRows = candidateRows.filter(
    (row) => row.aRankState === "EXACT" && row.bRankState === "EXACT",
  );

  const rankingPopulation =
    boundaryA.rankingPopulation !== null &&
    boundaryA.rankingPopulation === boundaryB.rankingPopulation
      ? boundaryA.rankingPopulation
      : null;

  return {
    runId: comparison.runId,
    boundaryA,
    boundaryB,
    rankingPopulation,
    topCandidate: topCandidateComparison(candidateRows),
    topNRetention: topNRetention(byKeyA, byKeyB, boundaryA, boundaryB),
    candidateRows,
    comparableRows,
    roseCount: comparableRows.filter((row) => row.direction === "UP").length,
    fellCount: comparableRows.filter((row) => row.direction === "DOWN").length,
    heldCount: comparableRows.filter((row) => row.direction === "SAME").length,
    slopeRows: slopeRows(candidateRows),
    scopeDescription: scopeDescription(boundaryA, boundaryB, rankingPopulation),
  };
}

function isReady(side: ComparisonSide): side is ComparisonSide & { preview: UserScenarioPreview } {
  return side.state === "READY" && side.preview !== null;
}

function joinCandidate(
  key: string,
  a: UserScenarioTopCandidate | null,
  b: UserScenarioTopCandidate | null,
  boundaryA: RankBoundary,
  boundaryB: RankBoundary,
): RankedCandidateRow {
  // Identity/location come from whichever side served the candidate; both sides
  // describe the same cell of the same run, so either is authoritative, and A is
  // preferred only for determinism.
  const identity = a ?? b;

  const aRankState: RankAvailability = a !== null ? "EXACT" : absentRankAvailability(boundaryA);
  const bRankState: RankAvailability = b !== null ? "EXACT" : absentRankAvailability(boundaryB);

  const aRank = a?.custom_rank ?? null;
  const bRank = b?.custom_rank ?? null;

  // A delta exists only when BOTH sides served a real rank. Every other combination
  // leaves it null rather than reaching for a stand-in.
  const rankDelta = aRank !== null && bRank !== null ? bRank - aRank : null;

  return {
    candidateKey: key,
    candidateId: identity?.candidate_id ?? -1,
    locationLabel: identity ? locationLabelOf(identity) : null,
    sidoName: identity?.sido_region_name ?? null,
    sigunguName: identity?.sigungu_region_name ?? null,
    centroidLat: identity?.centroid_lat ?? null,
    centroidLon: identity?.centroid_lon ?? null,
    aRank,
    bRank,
    aRankState,
    bRankState,
    aScore: a?.custom_score ?? null,
    bScore: b?.custom_score ?? null,
    rankDelta,
    movement: rankDelta === null ? null : Math.abs(rankDelta),
    direction: rankDelta === null ? null : directionOf(rankDelta),
    inTopA: aRank !== null && aRank <= RANKING_COMPARISON_TOP_N,
    inTopB: bRank !== null && bRank <= RANKING_COMPARISON_TOP_N,
  };
}

/** A rank, then B rank, then key — total and stable, so the table never reshuffles. */
function compareByNaturalOrder(x: RankedCandidateRow, y: RankedCandidateRow): number {
  const byA = compareNullableAsc(x.aRank, y.aRank);
  if (byA !== 0) return byA;
  const byB = compareNullableAsc(x.bRank, y.bRank);
  if (byB !== 0) return byB;
  return x.candidateKey < y.candidateKey ? -1 : x.candidateKey > y.candidateKey ? 1 : 0;
}

/** Ascending, with an absent value always last — never treated as 0 or as ∞-equal. */
function compareNullableAsc(x: number | null, y: number | null): number {
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x - y;
}

function topCandidateComparison(rows: RankedCandidateRow[]): TopCandidateComparison {
  const a = rows.find((row) => row.aRank === 1) ?? null;
  const b = rows.find((row) => row.bRank === 1) ?? null;
  if (a === null || b === null) return { state: "UNAVAILABLE", a, b };
  return { state: a.candidateKey === b.candidateKey ? "UNCHANGED" : "CHANGED", a, b };
}

function topNRetention(
  byKeyA: Map<string, UserScenarioTopCandidate>,
  byKeyB: Map<string, UserScenarioTopCandidate>,
  boundaryA: RankBoundary,
  boundaryB: RankBoundary,
): TopNRetention {
  const topKeys = (index: Map<string, UserScenarioTopCandidate>): Set<string> => {
    const keys = new Set<string>();
    for (const [key, candidate] of index) {
      if (candidate.custom_rank <= RANKING_COMPARISON_TOP_N) keys.add(key);
    }
    return keys;
  };

  const setA = topKeys(byKeyA);
  const setB = topKeys(byKeyB);

  // The honest denominator: a side that served only 6 ranked candidates has no
  // seventh to retain, and N would overstate the shortfall as a loss.
  const denominator = Math.min(
    RANKING_COMPARISON_TOP_N,
    Math.min(boundaryA.servedCount, boundaryB.servedCount),
  );

  let retained = 0;
  for (const key of setA) if (setB.has(key)) retained += 1;

  return {
    n: RANKING_COMPARISON_TOP_N,
    denominator,
    retained,
    percent: denominator === 0 ? null : Math.round((retained / denominator) * 100),
    reduced: denominator < RANKING_COMPARISON_TOP_N,
  };
}

/**
 * The union of the two top-N sets, carrying each side's ranked-column slot.
 *
 * Ordered by A slot then B slot, so the left column reads 1..N downwards and a
 * candidate that only enters on the B side sorts after the ones that were already
 * there. `aSlot`/`bSlot` are just the ranks (both ≤ N by construction) but are
 * named separately because a renderer positions by column slot, not by rank.
 */
function slopeRows(rows: RankedCandidateRow[]): ScenarioSlopeRow[] {
  return rows
    .filter((row) => row.inTopA || row.inTopB)
    .map((row) => ({
      ...row,
      aSlot: row.inTopA ? row.aRank : null,
      bSlot: row.inTopB ? row.bRank : null,
    }))
    .sort((x, y) => {
      const bySlot = compareNullableAsc(x.aSlot, y.aSlot);
      if (bySlot !== 0) return bySlot;
      const byB = compareNullableAsc(x.bSlot, y.bSlot);
      if (byB !== 0) return byB;
      return x.candidateKey < y.candidateKey ? -1 : 1;
    });
}

/** The bounded population, stated in one sentence rather than left to be assumed. */
function scopeDescription(
  boundaryA: RankBoundary,
  boundaryB: RankBoundary,
  rankingPopulation: number | null,
): string {
  const served =
    boundaryA.servedCount === boundaryB.servedCount
      ? `각각 상위 ${boundaryA.servedCount.toLocaleString("ko-KR")}개`
      : `A안 상위 ${boundaryA.servedCount.toLocaleString("ko-KR")}개 · B안 상위 ${boundaryB.servedCount.toLocaleString("ko-KR")}개`;
  const population =
    rankingPopulation === null
      ? ""
      : ` 현재 분석 실행의 순위 대상 후보 구역은 ${rankingPopulation.toLocaleString("ko-KR")}개입니다.`;
  return `아래 수치는 A안과 B안의 ${served} 후보 구역만 비교한 결과입니다.${population}`;
}

// --------------------------------------------------------------------------- //
// Sorting — over the already-derived rows, never a new request
// --------------------------------------------------------------------------- //

/**
 * Sort a copy of the comparison rows.
 *
 * ── SORTING DOES NOT CHANGE THE POPULATION ───────────────────────────────────────
 * Every option reorders the SAME `candidateRows`. None of them widens the top-N cut,
 * none re-requests a preview, and none may be described to the reader as revealing
 * more candidates. Rows without the sorted quantity always sort LAST, whichever
 * direction is chosen — an absent rank is not a large one or a small one.
 */
export function sortRankingComparisonRows(
  rows: readonly RankedCandidateRow[],
  sort: RankingComparisonSort,
): RankedCandidateRow[] {
  const sorted = [...rows];
  switch (sort) {
    case "movement_desc":
      // Largest exact movement first. Rows with no exact movement keep their natural
      // order at the end rather than being ranked among the movers by a stand-in.
      sorted.sort(
        (x, y) =>
          compareNullableDesc(x.movement, y.movement) || compareByNaturalOrder(x, y),
      );
      break;
    case "rank_a_asc":
      sorted.sort(
        (x, y) => compareNullableAsc(x.aRank, y.aRank) || compareByNaturalOrder(x, y),
      );
      break;
    case "rank_b_asc":
      sorted.sort(
        (x, y) => compareNullableAsc(x.bRank, y.bRank) || compareByNaturalOrder(x, y),
      );
      break;
    case "score_change_desc":
      sorted.sort(
        (x, y) =>
          compareNullableDesc(scoreChange(x), scoreChange(y)) || compareByNaturalOrder(x, y),
      );
      break;
  }
  return sorted;
}

/** Descending, with an absent value always last. */
function compareNullableDesc(x: number | null, y: number | null): number {
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return y - x;
}

/**
 * `B 점수 − A 점수` as a number, or `null` unless both sides served a parseable score.
 *
 * The served strings stay the displayed values; this exists only to order rows.
 */
export function scoreChange(row: RankedCandidateRow): number | null {
  if (row.aScore === null || row.bScore === null) return null;
  const a = Number(row.aScore);
  const b = Number(row.bScore);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

/**
 * The rows of the 순위 변화가 큰 후보 list.
 *
 * Only rows with an EXACT rank on BOTH sides are eligible, so no row is ever ranked
 * by a movement that was inferred rather than served. Ties break on the A rank then
 * the key, so the list is deterministic for identical inputs.
 */
export function topRankMovements(
  model: ScenarioRankingComparison,
  size: number = RANKING_MOVEMENT_LIST_SIZE,
): RankedCandidateRow[] {
  return model.comparableRows
    .filter((row) => (row.movement ?? 0) > 0)
    .sort((x, y) => (y.movement ?? 0) - (x.movement ?? 0) || compareByNaturalOrder(x, y))
    .slice(0, size);
}

// --------------------------------------------------------------------------- //
// Presentation helpers (shared so the KPI row, slope and table agree word for word)
// --------------------------------------------------------------------------- //

/** `↑ 4계단` / `↓ 2계단` / `유지`. `null` when there is no exact movement to describe. */
export function formatRankMovement(row: RankedCandidateRow): string | null {
  if (row.direction === null || row.movement === null) return null;
  if (row.direction === "SAME") return "유지";
  return `${row.direction === "UP" ? "↑" : "↓"} ${row.movement}계단`;
}

/**
 * What to print in a rank cell that has no exact rank.
 *
 * `OUTSIDE_PREVIEW` names the boundary it is outside of, so the sentence is
 * checkable; `UNKNOWN` says only that the rank was not served. Neither is ever a
 * number.
 */
export function formatUnavailableRank(
  state: RankAvailability,
  slot: "A" | "B",
  boundary: RankBoundary,
): string {
  if (state === "OUTSIDE_PREVIEW") return `${slot}안 상위 ${boundary.servedCount} 밖`;
  return `${slot}안 순위 미제공`;
}
