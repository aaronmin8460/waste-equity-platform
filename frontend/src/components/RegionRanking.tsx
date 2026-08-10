"use client";

/**
 * 값이 높은·낮은 지역 — regional ranking for the 지역 부담 (equity) view.
 *
 * Ranks the regions by the SAME served value the active map metric renders (via
 * lib/ranking). Two lists (highest / lowest), a Seoul·Incheon·Gyeonggi scope
 * filter, and a top-5/10/20 selector. Clicking a row selects that region — the
 * one canonical selected-region state — so the map, the selected-region summary,
 * and this list stay in sync. Changing the metric re-derives the values, so the
 * ranking follows the active metric automatically.
 *
 * NO SECOND RANKING EXISTS HERE. `rankRegions` (lib/ranking.ts) is the one
 * implementation; this component calls it and renders the result. Ordering, tie
 * behaviour, the top-N cut, and the "regions with no value are EXCLUDED, never
 * zero-filled" rule all live there and are covered by `lib/ranking.test.ts`.
 *
 * Analytical honesty: only regions with an official value are ranked; an official
 * measured 0 IS ranked, an unavailable region is excluded and its count reported;
 * no "best/worst/good/bad" language is used.
 *
 * This milestone changed presentation only: the scope filter is now the shared
 * `SegmentedControl` (same `aria-pressed` semantics, same test IDs), the basis line
 * carries the reference period alongside the metric and unit, and the rows use the
 * token palette. The rank number, the region name, the formatted value, the
 * selected-row treatment, and the excluded-count line are unchanged.
 */

import {
  SCOPE_LABELS,
  SCOPE_ORDER,
  TOP_N_OPTIONS,
  rankRegions,
  type RankableRegion,
  type RankedRow,
  type ScopeSelection,
} from "../lib/ranking";
import { formatCount } from "../lib/metrics";
import SegmentedControl from "./ui/SegmentedControl";
import type { SegmentedControlOption } from "./ui/SegmentedControl";

interface RegionRankingProps {
  regions: RankableRegion[];
  metricLabel: string;
  unit: string;
  /** The active metric's served reference period; omitted when none was served. */
  referencePeriod?: string;
  scope: ScopeSelection;
  setScope: (scope: ScopeSelection) => void;
  topN: number;
  setTopN: (n: number) => void;
  selectedRegionCode: string | null;
  onSelectRegion: (code: string) => void;
  /**
   * Opens 지표 순위 전체보기 — the same ranking without the top-N cut, in a modal
   * (components/FullRankingDialog.tsx). The card stays the compact answer; this is
   * the way out of it when top-N is not enough.
   */
  onOpenFullRanking: () => void;
}

/** The scope filter options — the same order and labels lib/ranking defines. */
const SCOPE_OPTIONS: readonly SegmentedControlOption<ScopeSelection>[] = SCOPE_ORDER.map(
  (scope) => ({ key: scope, label: SCOPE_LABELS[scope], testId: `rank-scope-${scope}` }),
);

function RankList({
  title,
  rows,
  selectedRegionCode,
  onSelectRegion,
  testId,
}: {
  title: string;
  rows: RankedRow[];
  selectedRegionCode: string | null;
  onSelectRegion: (code: string) => void;
  testId: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <h3 className="mb-1 text-xs font-semibold text-ink-muted">{title}</h3>
      {rows.length === 0 ? (
        // An empty list stays explicitly empty — never padded with sample rows.
        <p className="text-xs text-ink-subtle">표시할 지역이 없습니다.</p>
      ) : (
        <ol className="flex flex-col gap-0.5" data-testid={testId}>
          {rows.map((row) => {
            const isSelected = row.code === selectedRegionCode;
            return (
              <li key={row.code}>
                <button
                  type="button"
                  onClick={() => onSelectRegion(row.code)}
                  aria-current={isSelected ? "true" : undefined}
                  className={`flex min-h-[2rem] w-full items-baseline justify-between gap-2 rounded-control px-2 py-1 text-left text-xs ${
                    // Selection is conveyed by aria-current, the ✓ glyph, and the
                    // border/weight change — never by the tint alone.
                    isSelected
                      ? "border border-primary-border bg-primary-soft font-semibold text-ink"
                      : "border border-transparent hover:border-hairline hover:bg-surface-muted"
                  }`}
                  data-testid="rank-row"
                >
                  <span className="min-w-0 truncate">
                    <span className="mr-1 tabular-nums text-ink-subtle">{row.rank}.</span>
                    {isSelected && <span className="mr-1 font-semibold text-primary">✓</span>}
                    {row.name}
                  </span>
                  <span className="shrink-0 tabular-nums font-medium text-ink">{row.display}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default function RegionRanking({
  regions,
  metricLabel,
  unit,
  referencePeriod,
  scope,
  setScope,
  topN,
  setTopN,
  selectedRegionCode,
  onSelectRegion,
  onOpenFullRanking,
}: RegionRankingProps) {
  const result = rankRegions(regions, scope, topN);

  return (
    <section
      aria-label="지역 순위"
      data-testid="region-ranking"
      className="wep-card p-4 text-xs text-ink-muted"
    >
      <h2 className="text-sm font-semibold text-ink">값이 높은·낮은 지역</h2>
      {/* The ranking basis: which metric, in what unit, from when. */}
      <p className="mt-0.5 text-xs text-ink-subtle" data-testid="rank-basis">
        {metricLabel} 기준{unit ? ` · 단위 ${unit}` : ""}
        {referencePeriod ? ` · 자료 기준 ${referencePeriod}` : ""}
      </p>
      <p className="mt-0.5 text-xs text-ink-subtle">
        지역을 누르면 지도와 요약이 함께 움직입니다.
      </p>

      {/* Scope filter — exclusive selection, native buttons with aria-pressed. */}
      <div className="mt-2">
        <SegmentedControl
          options={SCOPE_OPTIONS}
          value={scope}
          onChange={setScope}
          ariaLabel="지역 범위"
        />
      </div>

      {/* Top-N selector */}
      <div className="mt-2 flex items-center gap-2">
        <label className="text-xs text-ink-subtle" htmlFor="rank-topn">
          표시 개수
        </label>
        <select
          id="rank-topn"
          className="min-h-[2rem] rounded-control border border-hairline-strong bg-surface px-2 py-1 text-xs text-ink"
          value={topN}
          onChange={(e) => setTopN(Number(e.target.value))}
          data-testid="rank-topn"
        >
          {TOP_N_OPTIONS.map((n) => (
            <option key={n} value={n}>
              상위 {n}개
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex gap-3">
        <RankList
          title="값이 높은 지역"
          rows={result.high}
          selectedRegionCode={selectedRegionCode}
          onSelectRegion={onSelectRegion}
          testId="rank-high"
        />
        <RankList
          title="값이 낮은 지역"
          rows={result.low}
          selectedRegionCode={selectedRegionCode}
          onSelectRegion={onSelectRegion}
          testId="rank-low"
        />
      </div>

      {/* The way out of the top-N cut. A native button, labelled with the exact
          words the redesign asked for, and placed directly under the two lists it
          extends rather than in a corner of the header. */}
      <button
        type="button"
        onClick={onOpenFullRanking}
        className="wep-btn-quiet mt-3 w-full"
        data-testid="open-full-ranking"
      >
        지표 순위 전체보기
      </button>

      <p className="mt-2 border-t border-hairline pt-2 text-xs text-ink-subtle" data-testid="rank-excluded">
        순위 대상 {formatCount(result.rankedCount)}개 지역. 값이 없어 제외한 지역{" "}
        {formatCount(result.excludedCount)}개(0으로 채우지 않음).
      </p>
    </section>
  );
}
