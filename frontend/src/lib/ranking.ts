/**
 * Pure regional-ranking logic for the 지역 부담 (equity) view.
 *
 * Ranks regions by the SAME served value the active map metric renders — never a
 * client-derived aggregate. The rules mirror the analytical-honesty invariants used
 * everywhere else in this app:
 *   - Only regions with an available official numeric value are ranked.
 *   - An official measured 0 is a real value and IS ranked; an UNAVAILABLE region
 *     (no served value) is never converted to 0 — it is excluded and counted.
 *   - "값이 높은 지역" sorts value descending; "값이 낮은 지역" value ascending.
 *   - Ties break deterministically by region code ascending.
 *   - Ranks are sequential (1..N) within the filtered, sorted set.
 *   - The number of regions excluded because the value was unavailable is reported.
 *
 * No "best"/"worst"/"good"/"bad" language is produced here — callers label the two
 * lists 값이 높은 지역 / 값이 낮은 지역 only.
 */

/**
 * SGIS sido scope codes actually used by the region rows: Seoul 11 / Incheon 23 /
 * Gyeonggi 31. (These are SGIS codes, not the administrative 11/28/41 — the region
 * boundaries, population, and waste all key on the SGIS values.)
 */
export type RegionScope = "11" | "23" | "31";

/** Selectable scope, including the metropolitan-wide default. */
export type ScopeSelection = RegionScope | "all";

export const SCOPE_LABELS: Record<ScopeSelection, string> = {
  all: "수도권 전체",
  "11": "서울",
  "23": "인천",
  "31": "경기",
};

export const SCOPE_ORDER: readonly ScopeSelection[] = ["all", "11", "23", "31"];

/** Top-N choices offered by the ranking UI. */
export const TOP_N_OPTIONS: readonly number[] = [5, 10, 20];

/**
 * Which end of the ranking a surface is showing. It selects between the two lists
 * `rankRegions` already returns; it is NOT a third ordering, and neither comparator
 * below depends on it.
 */
export type RankDirection = "high" | "low";

/** The two directions in the order the design lays them out, with its wording. */
export const RANK_DIRECTION_LABELS: Record<RankDirection, string> = {
  high: "높은 순",
  low: "낮은 순",
};

/**
 * The ranking surface's own name, and the name of its full-view modal.
 *
 * TERMINOLOGY NOTE — the Figma file disagrees with itself here. The rendered
 * page-1 frame labels this card 지표 순위 (74:2025) and its modal 지표 순위 전체보기
 * (74:3253), but the `page-1 기술요청` annotation beside the frame asks in writing
 * for "[값이 높은·낮은 지역]을 [지역 순위]로 명칭 변경" — 지역, not 지표. 지역 순위 is
 * used because the annotation is the written instruction, it agrees with the
 * section's long-standing `aria-label`, and it is the accurate description: the card
 * ranks REGIONS by the selected indicator, it does not rank indicators. Flipping to
 * the frame's wording is a change to these two constants and nothing else.
 */
export const RANKING_SECTION_LABEL = "지역 순위";
export const RANKING_FULL_VIEW_LABEL = "지역 순위 전체보기";

/**
 * Classify a region code into its sido scope.
 *  - SGIS codes ("KR-SGIS-11110", or a bare "11110") → the first two digits after
 *    stripping the non-numeric prefix: 11 Seoul, 23 Incheon, 31 Gyeonggi.
 *  - The RCIS reporting derived-city codes ("KR-RCISRG-…") are the seven Gyeonggi
 *    cities only (고양·부천·성남·수원·안산·안양·용인 report at city level), so they
 *    map to Gyeonggi (31). Any other code is left unclassified (null), so it appears
 *    only under "수도권 전체".
 */
export function regionScope(code: string): RegionScope | null {
  if (code.includes("RCISRG")) return "31";
  const digits = code.replace(/\D/g, "");
  const sido = digits.slice(0, 2);
  if (sido === "11" || sido === "23" || sido === "31") return sido;
  return null;
}

/** A served value (or its absence) for a region under the active metric. */
export interface RegionValue {
  numeric: number;
  display: string;
}

export interface RankableRegion {
  code: string;
  name: string;
  /** The served value, or undefined when the region has no official value. */
  value: RegionValue | undefined;
}

export interface RankedRow {
  rank: number;
  code: string;
  name: string;
  numeric: number;
  /** Exact display string (never re-formatted from numeric). */
  display: string;
  scope: RegionScope | null;
}

export interface RankingResult {
  /** Value descending (highest first). */
  high: RankedRow[];
  /** Value ascending (lowest first). */
  low: RankedRow[];
  /** Regions in scope that had an official value and were ranked. */
  rankedCount: number;
  /** Regions in scope excluded because the value was UNAVAILABLE (never zero-filled). */
  excludedCount: number;
  scope: ScopeSelection;
  topN: number;
}

function assignRanks(rows: Omit<RankedRow, "rank">[]): RankedRow[] {
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

/** A region in scope that could not be ranked, because no value was served. */
export interface UnrankedRegion {
  code: string;
  name: string;
}

/**
 * THE one place scope filtering and the "no value ⇒ excluded, never 0" rule live.
 * Both `rankRegions` (the compact two-list card) and `rankAllRegions` (the full
 * ranking dialog) go through it, so the two surfaces can never disagree about which
 * regions are rankable or why one is missing.
 */
function partitionByScope(
  regions: RankableRegion[],
  scope: ScopeSelection,
): { ranked: Omit<RankedRow, "rank">[]; unranked: UnrankedRegion[] } {
  const inScope =
    scope === "all" ? regions : regions.filter((r) => regionScope(r.code) === scope);

  const ranked: Omit<RankedRow, "rank">[] = [];
  const unranked: UnrankedRegion[] = [];
  for (const region of inScope) {
    if (region.value === undefined || !Number.isFinite(region.value.numeric)) {
      unranked.push({ code: region.code, name: region.name });
      continue;
    }
    ranked.push({
      code: region.code,
      name: region.name,
      numeric: region.value.numeric,
      display: region.value.display,
      scope: regionScope(region.code),
    });
  }
  return { ranked, unranked };
}

/** Value descending ("값이 높은 지역"); ties by region code ascending. */
function sortDescending(rows: Omit<RankedRow, "rank">[]): Omit<RankedRow, "rank">[] {
  return [...rows].sort((a, b) =>
    b.numeric !== a.numeric ? b.numeric - a.numeric : a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );
}

/** Value ascending ("값이 낮은 지역"); the same deterministic tie-break. */
function sortAscending(rows: Omit<RankedRow, "rank">[]): Omit<RankedRow, "rank">[] {
  return [...rows].sort((a, b) =>
    a.numeric !== b.numeric ? a.numeric - b.numeric : a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );
}

/**
 * Rank the regions by their served numeric value, filtered to `scope` and limited
 * to `topN` per list. Regions without a value are excluded and counted, never
 * ranked as 0.
 */
export function rankRegions(
  regions: RankableRegion[],
  scope: ScopeSelection,
  topN: number,
): RankingResult {
  const { ranked, unranked } = partitionByScope(regions, scope);

  const high = assignRanks(sortDescending(ranked)).slice(0, topN);
  const low = assignRanks(sortAscending(ranked)).slice(0, topN);

  return {
    high,
    low,
    rankedCount: ranked.length,
    excludedCount: unranked.length,
    scope,
    topN,
  };
}

/** The complete ranking for one metric — every rankable region, no top-N cut. */
export interface FullRankingResult {
  /** Every region with a served value, highest first, ranks 1..N with no gaps. */
  rows: RankedRow[];
  rankedCount: number;
  /**
   * Regions in scope with NO served value. They are listed by name so a reader can
   * see the ranking is incomplete and why — never appended at rank N+1 with a 0.
   */
  unranked: UnrankedRegion[];
  scope: ScopeSelection;
}

/**
 * The whole ranking for the active metric, for the 지역 순위 전체보기 dialog.
 *
 * Deliberately the SAME derivation as the compact card — same scope filter, same
 * exclusion rule, same comparators, same sequential ranks — with the top-N cut
 * removed. It is a second VIEW of one ranking, not a second ranking; there is no
 * third sort order, no second tie-break, and no re-formatting of the served display
 * string. A region with no value is returned in `unranked`, never as a 0.
 *
 * `direction` selects between the two orderings the compact card already offers, and
 * defaults to `high` so every existing caller keeps the descending ranking it had.
 */
export function rankAllRegions(
  regions: RankableRegion[],
  scope: ScopeSelection,
  direction: RankDirection = "high",
): FullRankingResult {
  const { ranked, unranked } = partitionByScope(regions, scope);
  const sorted = direction === "high" ? sortDescending(ranked) : sortAscending(ranked);
  return {
    rows: assignRanks(sorted),
    rankedCount: ranked.length,
    unranked,
    scope,
  };
}
