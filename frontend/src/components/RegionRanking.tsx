"use client";

/**
 * 지역 순위 — regional ranking for the 지역 지표 (equity) view.
 *
 * Ranks the regions by the SAME served value the active map metric renders (via
 * lib/ranking). Clicking a row selects that region — the one canonical
 * selected-region state — so the map, the selected-region summary, and this list
 * stay in sync. Changing the metric re-derives the values, so the ranking follows
 * the active metric automatically.
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
 * ── WHAT PHASE 1 CHANGED (Figma frame 74:2025) ───────────────────────────────────
 * Presentation, plus ONE piece of view state. The card used to show the highest and
 * the lowest list side by side in two ~130px columns; the design shows ONE list with
 * a direction toggle above it, which gives each row the full card width and lets a
 * Korean region name and its value sit on one line without truncating.
 *
 *   - The heading is 지역 순위 (the `page-1 기술요청` annotation renames it from
 *     값이 높은·낮은 지역; the frame's own label reads 지표 순위 — see
 *     docs/figma-redesign/PAGE_1_REGIONAL_INDICATORS.md for that discrepancy).
 *   - Scope is a row of radio chips rather than a segmented control.
 *   - Direction is `↑ 높은 순으로` / `↓ 낮은 순으로`, a new local choice between the
 *     two lists `rankRegions` ALREADY returns. It selects which of `result.high` /
 *     `result.low` is displayed; it does not re-sort, re-rank, or re-filter
 *     anything, and neither comparator changed.
 *   - 표시 개수 (top-N) is NOT in the design but is kept: it is working behaviour,
 *     and the design's own "전체보기" is the escape from the cut rather than a
 *     replacement for choosing it.
 *
 * The list keeps `rank-high` / `rank-low` as its test id (whichever direction is
 * shown), so the ~dozen existing assertions that address `rank-high` still address
 * the visible list in the default state.
 */

import {
  RANKING_SECTION_LABEL,
  SCOPE_LABELS,
  SCOPE_ORDER,
  TOP_N_OPTIONS,
  rankRegions,
  type RankableRegion,
  type RankDirection,
  type RankedRow,
  type ScopeSelection,
} from "../lib/ranking";
import { formatCount } from "../lib/metrics";
import { unitLabel } from "../lib/units";

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
  /** Which end of the ranking the list shows. Owned by the page, so the full-ranking
   *  dialog opens on the same end the reader was looking at. */
  direction: RankDirection;
  setDirection: (direction: RankDirection) => void;
  selectedRegionCode: string | null;
  onSelectRegion: (code: string) => void;
  /**
   * Opens 지역 순위 전체보기 — the same ranking without the top-N cut, in a modal
   * (components/FullRankingDialog.tsx). The card stays the compact answer; this is
   * the way out of it when top-N is not enough.
   */
  onOpenFullRanking: () => void;
}

/** The two directions, in the order Figma lays them out. */
const DIRECTION_OPTIONS: readonly { key: RankDirection; label: string }[] = [
  { key: "high", label: "↑ 높은 순으로" },
  { key: "low", label: "↓ 낮은 순으로" },
];

/**
 * The scope filter, drawn as Figma's chips.
 *
 * Still `aria-pressed` BUTTONS in a labelled `role="group"` — the exact semantics
 * and the exact `rank-scope-*` test ids the shared `SegmentedControl` gave them, so
 * every existing assertion keeps addressing the same controls. It is deliberately
 * NOT a `<fieldset>` of native radios: the page is contracted to exactly three
 * fieldsets (e2e/accessibility.spec.ts) and the three belong to 지표 선택.
 *
 * The ring-and-dot Figma draws is therefore a decorative `aria-hidden` mark. It is
 * a redundant SHAPE signal on top of `aria-pressed` and the weight change, never the
 * only carrier of state.
 */
function ScopeChips({
  scope,
  setScope,
}: {
  scope: ScopeSelection;
  setScope: (scope: ScopeSelection) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="지역 범위">
      {SCOPE_ORDER.map((option) => {
        const active = option === scope;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => setScope(option)}
            className={`flex min-h-8 items-center gap-1.5 rounded-control py-1 pr-2 text-xs ${
              active ? "font-bold text-brand" : "font-normal text-ink-muted hover:text-ink"
            }`}
            data-testid={`rank-scope-${option}`}
          >
            <span
              aria-hidden
              className={`size-[13px] shrink-0 rounded-full border-[1.5px] ${
                active ? "border-ink-faint bg-brand" : "border-ink-faint bg-surface"
              }`}
            />
            {SCOPE_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}

function RankList({
  rows,
  selectedRegionCode,
  onSelectRegion,
  testId,
}: {
  rows: RankedRow[];
  selectedRegionCode: string | null;
  onSelectRegion: (code: string) => void;
  testId: string;
}) {
  if (rows.length === 0) {
    // An empty list stays explicitly empty — never padded with sample rows.
    return <p className="text-xs text-ink-subtle">표시할 지역이 없습니다.</p>;
  }
  return (
    <ol className="flex flex-col gap-1" data-testid={testId}>
      {rows.map((row) => {
        const isSelected = row.code === selectedRegionCode;
        return (
          <li key={row.code}>
            <button
              type="button"
              onClick={() => onSelectRegion(row.code)}
              aria-current={isSelected ? "true" : undefined}
              className={`flex min-h-[35px] w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-xs ${
                // Selection is conveyed by aria-current, the ✓ glyph, and the
                // border/weight change — never by the tint alone.
                isSelected
                  ? "border border-primary-border bg-primary-soft font-semibold text-ink"
                  : "border border-transparent hover:border-[var(--figma-rule)] hover:bg-surface-muted"
              }`}
              data-testid="rank-row"
            >
              <span className="w-5 shrink-0 tabular-nums text-ink-subtle">{row.rank}.</span>
              <span className="min-w-0 flex-1 truncate text-ink">
                {isSelected && <span className="mr-1 font-semibold text-primary">✓</span>}
                {row.name}
              </span>
              <span className="shrink-0 tabular-nums text-ink-subtle">{row.display}</span>
            </button>
          </li>
        );
      })}
    </ol>
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
  direction,
  setDirection,
  selectedRegionCode,
  onSelectRegion,
  onOpenFullRanking,
}: RegionRankingProps) {
  const result = rankRegions(regions, scope, topN);
  const rows = direction === "high" ? result.high : result.low;

  return (
    <section
      aria-label={RANKING_SECTION_LABEL}
      data-testid="region-ranking"
      className="wep-card wep-figma-card text-xs text-ink-muted"
    >
      <h2 className="text-xl font-bold leading-6 text-brand">{RANKING_SECTION_LABEL}</h2>
      {/* The ranking basis: which metric, in what unit, from when. */}
      <p className="mt-1.5 text-xs text-ink-subtle" data-testid="rank-basis">
        {metricLabel} 기준{unit ? ` · 단위 ${unitLabel(unit)}` : ""}
        {referencePeriod ? ` · 자료 기준 ${referencePeriod}` : ""}
      </p>
      {/* The "지역을 누르면 지도와 요약이 함께 움직입니다" line is gone: Figma's 지표
          순위 card (74:2025) carries no such line, the rows are visibly buttons, and
          the sentence is still stated once — in 전체보기, where the list is long
          enough for the connection to the map to be worth saying. `rank-basis` above
          stays: it is the ranking's own metric/unit/period, not orientation. */}

      <div className="mt-3">
        <ScopeChips scope={scope} setScope={setScope} />
      </div>

      {/* Direction — which end of the SAME ranking is shown. `aria-pressed` buttons
          rather than a second radio group: the page already carries three fieldsets
          and exactly three is an asserted contract (e2e/accessibility.spec.ts). */}
      <div
        className="mt-3 flex items-center gap-2"
        role="group"
        aria-label="정렬 방향"
        data-testid="rank-direction"
      >
        {DIRECTION_OPTIONS.map((option) => {
          const active = option.key === direction;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={active}
              onClick={() => setDirection(option.key)}
              className={`min-h-8 rounded-control px-3 py-1.5 text-[13px] ${
                active
                  ? "border-[0.5px] border-brand bg-canvas font-bold text-brand"
                  : "border-[0.5px] border-transparent font-medium text-ink-muted hover:bg-surface-muted"
              }`}
              data-testid={`rank-direction-${option.key}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Top-N selector. Not in the Figma frame, kept because it is real behaviour
          the redesign never asked to remove — but now capped at 10 (TOP_N_OPTIONS),
          so this compact card can never grow into a 20-row table. 전체보기 below is
          the way to every region, so the cap removes a setting, not access. */}
      <div className="mt-3 flex items-center gap-2">
        <label className="text-xs text-ink-subtle" htmlFor="rank-topn">
          표시 개수
        </label>
        <select
          id="rank-topn"
          className="min-h-8 rounded-control border border-hairline-strong bg-surface px-2 py-1 text-xs text-ink"
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

      <div className="mt-3">
        <RankList
          rows={rows}
          selectedRegionCode={selectedRegionCode}
          onSelectRegion={onSelectRegion}
          // The test id follows the direction, so `rank-high` addresses the visible
          // list in the default state exactly as it did when both lists rendered.
          testId={direction === "high" ? "rank-high" : "rank-low"}
        />
      </div>

      {/* Figma prints only the count ("순위 32개 지역"), which is now what this reads:
          "순위 대상 …개 지역." was a label sentence where a count label does, and the
          full stop after a fragment was doing nothing.

          THE EXCLUSION CLAUSE IS NOT BOILERPLATE and is not touched — it is the
          missing-data indicator this repo requires, so it still appears verbatim
          whenever something was actually excluded, still names the count, and still
          says 0으로 채우지 않음. With nothing excluded it stays absent rather than
          standing there reporting 0 of a thing that did not happen; the underlying
          rule is stated in full in 전체보기. */}
      <p className="mt-3 text-[11px] text-ink-subtle" data-testid="rank-excluded">
        순위 {formatCount(result.rankedCount)}개 지역
        {result.excludedCount > 0 && (
          <> · 값이 없어 제외한 지역 {formatCount(result.excludedCount)}개(0으로 채우지 않음)</>
        )}
      </p>

      {/* The way out of the top-N cut. A native button, labelled with the exact
          words the redesign asked for, and placed directly under the list it
          extends rather than in a corner of the header. */}
      <button
        type="button"
        onClick={onOpenFullRanking}
        className="wep-btn-quiet mt-3 w-full border-[var(--figma-rule)] font-bold text-brand"
        data-testid="open-full-ranking"
      >
        전체보기 ↗
      </button>
    </section>
  );
}
