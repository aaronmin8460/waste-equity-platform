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
 * Analytical honesty: only regions with an official value are ranked; an official
 * measured 0 IS ranked, an unavailable region is excluded and its count reported;
 * no "best/worst/good/bad" language is used.
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

interface RegionRankingProps {
  regions: RankableRegion[];
  metricLabel: string;
  unit: string;
  scope: ScopeSelection;
  setScope: (scope: ScopeSelection) => void;
  topN: number;
  setTopN: (n: number) => void;
  selectedRegionCode: string | null;
  onSelectRegion: (code: string) => void;
}

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
                  className={`flex min-h-[32px] w-full items-baseline justify-between gap-2 rounded-control px-2 py-1 text-left text-xs ${
                    // Selection is conveyed by aria-current, the ✓ glyph, and the
                    // border/weight change — never by the tint alone.
                    isSelected
                      ? "border border-primary bg-primary-soft font-semibold text-ink"
                      : "border border-transparent hover:bg-surface-muted"
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
  scope,
  setScope,
  topN,
  setTopN,
  selectedRegionCode,
  onSelectRegion,
}: RegionRankingProps) {
  const result = rankRegions(regions, scope, topN);

  return (
    // Phase 4: the same section in the Phase 1 shared card language (`.wep-card`,
    // standard padding, standard header scale). Ranking algorithm, scope grouping,
    // order, tie behaviour, and the excluded-count reporting are untouched.
    <section
      aria-label="지역 순위"
      data-testid="region-ranking"
      className="wep-card p-4 text-xs text-ink-muted"
    >
      <h2 className="mb-1 text-sm font-semibold text-ink">값이 높은·낮은 지역</h2>
      <p className="mb-2 text-[11px] text-ink-subtle">
        {metricLabel} 기준{unit ? ` · 단위 ${unit}` : ""}. 지역을 누르면 지도와 요약이 함께
        움직입니다.
      </p>

      {/* Scope filter */}
      <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="지역 범위">
        {SCOPE_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={scope === s}
            onClick={() => setScope(s)}
            className={`min-h-[32px] rounded-pill px-3 py-1 text-xs ${
              scope === s
                ? "bg-primary font-semibold text-primary-ink"
                : "bg-surface-sunken text-ink-muted hover:bg-surface-muted"
            }`}
            data-testid={`rank-scope-${s}`}
          >
            {SCOPE_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Top-N selector */}
      <div className="mb-2 flex items-center gap-2">
        <label className="text-[11px] text-ink-subtle" htmlFor="rank-topn">
          표시 개수
        </label>
        <select
          id="rank-topn"
          className="min-h-[32px] rounded-control border border-hairline-strong bg-surface px-2 py-1 text-xs"
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

      <div className="flex gap-3">
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

      <p className="mt-2 text-[11px] text-ink-subtle" data-testid="rank-excluded">
        순위 대상 {formatCount(result.rankedCount)}개 지역. 값이 없어 제외한 지역{" "}
        {formatCount(result.excludedCount)}개(0으로 채우지 않음).
      </p>
    </section>
  );
}
