"use client";

/**
 * 지표 순위 전체보기 — the complete ranking for the ACTIVE metric, in a modal.
 *
 * The compact card beside the map answers "who is at the top and the bottom?" with a
 * top-N cut. This answers "where does every region stand?" without one. It replaces
 * the 지역 비교 card the correction pass removed: the reader who wanted to line
 * regions up against each other now gets all of them at once, ordered, instead of
 * hand-picking three.
 *
 * ── NO NEW DATA, NO NEW METHOD ───────────────────────────────────────────────────
 * It is derived entirely from the region rows Page 1 has ALREADY loaded for the
 * active metric, through `rankAllRegions` — the same scope filter, exclusion rule,
 * comparator, and tie-break as the compact card, with the top-N cut removed. No
 * endpoint was added for it, no value is recomputed, and every displayed number is
 * the served display string verbatim.
 *
 * ── MISSING IS NOT ZERO ──────────────────────────────────────────────────────────
 * A region with no served value is NOT ranked last, NOT ranked at 0, and NOT quietly
 * dropped: it is listed by name below the table under its own heading, with the count
 * and an explicit "0으로 채우지 않았습니다". That is the same rule the card's
 * excluded-count line states, shown in more detail because there is room for it.
 *
 * ── ACCESSIBILITY ────────────────────────────────────────────────────────────────
 * The shared `ui/Dialog` primitive owns dialog semantics, the accessible name, focus
 * entry, Tab/Shift+Tab containment, Escape, the close control, backdrop click, the
 * body scroll lock, and focus restoration to the opener. Nothing is re-implemented
 * here, and nothing about that primitive was changed to accommodate this second
 * consumer — it is used exactly as 데이터·출처 uses it.
 */

import Dialog from "./ui/Dialog";
import { formatCount } from "../lib/metrics";
import {
  SCOPE_LABELS,
  rankAllRegions,
  type RankableRegion,
  type ScopeSelection,
} from "../lib/ranking";

export interface FullRankingDialogProps {
  open: boolean;
  onClose: () => void;
  /** The rankable rows for the ACTIVE metric — already loaded by the page. */
  regions: RankableRegion[];
  /** The active metric's citizen label, e.g. 생활계 폐기물 발생량. */
  metricLabel: string;
  /** How the active metric is counted right now (총량 / 1인당). */
  modeLabel?: string;
  unit: string;
  /** The active metric's served reference period; omitted when none was served. */
  referencePeriod?: string;
  /** The scope the compact ranking is filtered to — this dialog follows it. */
  scope: ScopeSelection;
  selectedRegionCode: string | null;
  onSelectRegion: (code: string) => void;
}

export default function FullRankingDialog({
  open,
  onClose,
  regions,
  metricLabel,
  modeLabel,
  unit,
  referencePeriod,
  scope,
  selectedRegionCode,
  onSelectRegion,
}: FullRankingDialogProps) {
  // Cheap enough to derive on render (a few hundred rows, one sort) and derived
  // state cannot go stale against the metric the way a cached copy could.
  const result = rankAllRegions(regions, scope);

  // What this ranking IS, in one line: which metric, counted how, in what unit, over
  // which regions, from when. Every clause is served or selected — none is inferred.
  const basis = [
    metricLabel,
    modeLabel,
    SCOPE_LABELS[scope],
    unit ? `단위 ${unit}` : null,
    referencePeriod ? `자료 기준 ${referencePeriod}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog
      open={open}
      title="지표 순위 전체보기"
      description={basis}
      testId="full-ranking-dialog"
      onClose={onClose}
    >
      <div className="p-4 sm:p-5">
        <p className="text-xs text-ink-subtle" data-testid="full-ranking-basis">
          값이 높은 지역부터 순서대로, 순위에 오른 {formatCount(result.rankedCount)}개 지역을 모두
          표시합니다. 지역을 누르면 지도와 요약이 함께 움직입니다.
        </p>

        {result.rows.length === 0 ? (
          // Explicitly empty — never padded with sample rows.
          <p className="mt-4 text-sm text-ink-muted" data-testid="full-ranking-empty">
            이 지표로 순위를 매길 수 있는 지역이 없습니다.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[20rem] border-collapse text-sm" data-testid="full-ranking-table">
              <caption className="sr-only">{`${metricLabel} 전체 순위`}</caption>
              <thead>
                <tr className="border-b border-hairline-strong text-xs text-ink-subtle">
                  <th scope="col" className="w-14 py-2 pr-2 text-left font-semibold">
                    순위
                  </th>
                  <th scope="col" className="py-2 pr-2 text-left font-semibold">
                    지역
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    값{unit ? ` (${unit})` : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => {
                  const isSelected = row.code === selectedRegionCode;
                  return (
                    <tr
                      key={row.code}
                      data-testid="full-ranking-row"
                      // Selection carries aria-current, a ✓ glyph, and a weight
                      // change as well as the tint — never colour alone.
                      aria-current={isSelected ? "true" : undefined}
                      className={`border-b border-hairline ${
                        isSelected ? "bg-primary-soft font-semibold text-ink" : "text-ink-muted"
                      }`}
                    >
                      <td className="py-1.5 pr-2 tabular-nums">{row.rank}</td>
                      <td className="py-1.5 pr-2">
                        <button
                          type="button"
                          onClick={() => onSelectRegion(row.code)}
                          className="min-h-[1.75rem] w-full rounded-control px-1 text-left hover:bg-surface-muted"
                        >
                          {isSelected && <span className="mr-1 text-primary">✓</span>}
                          {row.name}
                        </button>
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-ink">{row.display}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* The regions that could NOT be ranked, stated rather than dropped. */}
        <div className="mt-4 border-t border-hairline pt-3" data-testid="full-ranking-unranked">
          <h3 className="text-xs font-semibold text-ink">
            값이 없어 순위에서 제외한 지역 {formatCount(result.unranked.length)}개
          </h3>
          <p className="mt-1 text-xs text-ink-subtle">
            공식 값이 제공되지 않은 지역입니다. 값이 0이라는 뜻이 아니며, 0으로 채우지 않았습니다.
          </p>
          {result.unranked.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
              {result.unranked.map((region) => (
                <li key={region.code}>{region.name}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
