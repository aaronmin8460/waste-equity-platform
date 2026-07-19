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

/** SGIS sido scope codes: Seoul / Incheon / Gyeonggi. */
export type RegionScope = "11" | "28" | "41";

/** Selectable scope, including the metropolitan-wide default. */
export type ScopeSelection = RegionScope | "all";

export const SCOPE_LABELS: Record<ScopeSelection, string> = {
  all: "수도권 전체",
  "11": "서울",
  "28": "인천",
  "41": "경기",
};

export const SCOPE_ORDER: readonly ScopeSelection[] = ["all", "11", "28", "41"];

/** Top-N choices offered by the ranking UI. */
export const TOP_N_OPTIONS: readonly number[] = [5, 10, 20];

/**
 * Classify a region code into its sido scope.
 *  - Numeric SGIS codes ("11", "28710", "41135") → leading two digits.
 *  - The RCIS reporting derived-city codes ("KR-RCISRG-…") are the seven Gyeonggi
 *    cities only (고양·부천·성남·수원·안산·안양·용인 report at city level), so they
 *    map to Gyeonggi (41). Any other non-numeric code is left unclassified (null),
 *    so it appears only under "수도권 전체".
 */
export function regionScope(code: string): RegionScope | null {
  const m = /^(\d{2})/.exec(code);
  if (m) {
    const sido = m[1];
    if (sido === "11" || sido === "28" || sido === "41") return sido;
    return null;
  }
  if (code.includes("RCISRG")) return "41";
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
  const inScope =
    scope === "all" ? regions : regions.filter((r) => regionScope(r.code) === scope);

  const ranked: Omit<RankedRow, "rank">[] = [];
  let excludedCount = 0;
  for (const region of inScope) {
    if (region.value === undefined || !Number.isFinite(region.value.numeric)) {
      excludedCount += 1;
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

  // Value descending for "값이 높은 지역"; ties by region code ascending.
  const highSorted = [...ranked].sort((a, b) =>
    b.numeric !== a.numeric ? b.numeric - a.numeric : a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );
  // Value ascending for "값이 낮은 지역".
  const lowSorted = [...ranked].sort((a, b) =>
    a.numeric !== b.numeric ? a.numeric - b.numeric : a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );

  const high = assignRanks(highSorted).slice(0, topN);
  const low = assignRanks(lowSorted).slice(0, topN);

  return {
    high,
    low,
    rankedCount: ranked.length,
    excludedCount,
    scope,
    topN,
  };
}
