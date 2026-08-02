"use client";

/**
 * 지역 부담 map insight strip — 해석 · 주의 · 자료 기준·출처, over the map.
 *
 * WHY IT FLOATS INSTEAD OF SITTING BELOW THE MAP. The map pane is contracted to
 * reach the viewport bottom with nothing beneath it at desktop
 * (docs/ui-refresh/regression-contract.md §4; `e2e/responsive.spec.ts`,
 * `e2e/civicShell.spec.ts`, `e2e/phase4EquityMap.spec.ts` all assert
 * `map.bottom ≈ viewport.bottom`). An in-flow strip under the map would shorten the
 * canvas and break every one of those. So this is an overlay INSIDE the map
 * workspace — the same pattern the legend already uses — and the map keeps its full
 * height.
 *
 * It is the second child of the map's bottom-anchored overlay COLUMN (page.tsx),
 * directly under the floating legend, so the two can never collide however tall
 * either becomes — non-collision is structural, not a hand-tuned offset. Below the
 * 1024px minimum supported width it is not rendered at all: nothing here is
 * mandatory-only-here — the reference period, the source lines, and the no-data
 * wording all still appear in the sidebar — so hiding it narrow removes no
 * required disclosure (repo AGENTS.md).
 *
 * ── Content rules ───────────────────────────────────────────────────────────────
 * Every string is either passed in from already-served state (the metric label, the
 * unit, the reference period, the provenance lines) or is a standing limitation this
 * application and its documentation already state. The classification method note is
 * deliberately NOT repeated here — the floating legend directly above already
 * carries it, verbatim from `scaleMethodNote`. It makes
 * no claim about environmental justice, siting, safety, or responsibility, and it
 * never renders a value — so it cannot show a missing value as a zero.
 *
 * `role` is deliberately absent: this is standing explanatory content, not an
 * actionable error, so it must not be `role="alert"` (components/ui/InfoBanner.tsx).
 */

import type { DataStatus } from "../../lib/glossary";
import DataStatusBadge from "../ui/DataStatusBadge";
import InfoBanner from "../ui/InfoBanner";

export interface EquityMapInsightStripProps {
  /** Active metric's plain-Korean label. */
  metricLabel: string;
  /** Active metric's unit as served (may be ""). */
  unit: string;
  /** How the active metric's values came to be — `reported` or `derived`. */
  metricStatus: DataStatus;
  /** Active metric's reference period as served (may be ""). */
  referencePeriod: string;
  /** Served source + reference period line(s) for the active metric. */
  metricProvenance: { label: string; value: string }[];
  /** Opens the existing 데이터·출처 area. */
  onOpenSources: () => void;
}

export default function EquityMapInsightStrip({
  metricLabel,
  unit,
  metricStatus,
  referencePeriod,
  metricProvenance,
  onOpenSources,
}: EquityMapInsightStripProps) {
  return (
    // Positioning belongs to the page's bottom overlay stack (see page.tsx); this
    // wrapper only decides at which widths the strip participates. Below the 1024px
    // minimum supported width it is not rendered — see the note above.
    <div className="pointer-events-none hidden w-full lg:block" data-testid="equity-insight-strip-wrapper">
      <section
        aria-label="지도 해석 안내"
        data-testid="equity-insight-strip"
        className="pointer-events-auto grid grid-cols-1 gap-x-4 gap-y-3 rounded-card border border-hairline bg-surface/95 p-3 text-xs text-ink-muted shadow-float backdrop-blur-sm lg:grid-cols-3"
      >
        {/* 해석 — what the active metric's colors mean. Neutral by design. */}
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            해석
          </h2>
          <p className="mt-1 leading-snug text-ink" data-testid="insight-interpretation">
            이 지도는 <span className="font-semibold">{metricLabel}</span>
            {unit ? ` (단위 ${unit})` : ""}의 지역 간 상대적 차이를 보여줍니다. 값이 클수록 색이
            진해집니다.
          </p>
        </div>

        {/* 주의 — standing limitations only. The banner supplies this column's own
            visible label ("주의 · …") as TEXT, so it deliberately carries no second
            heading of its own: a 주의 caption above a 주의-labelled banner says the
            same word twice. */}
        <div className="min-w-0">
          <InfoBanner tone="warning" title="자료 해석 한계" testId="insight-caution">
            <p className="leading-snug">
              지도 색은 지역 간 상대적 구간(급)이며 절대 기준이 아닙니다. 자료 없음은 0이 아니고,
              기준 시점이 다른 값은 직접 비교할 수 없습니다.
            </p>
          </InfoBanner>
        </div>

        {/* 자료 기준·출처 — served provenance, plus the existing route to the
            데이터·출처 area. Never a tooltip-only disclosure. */}
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            자료 기준·출처
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <DataStatusBadge status={metricStatus} />
            {referencePeriod ? (
              <span className="tabular-nums text-ink" data-testid="insight-reference-period">
                자료 기준 {referencePeriod}
              </span>
            ) : null}
          </div>
          {metricProvenance.length > 0 && (
            <dl className="mt-1 space-y-0.5 leading-snug" data-testid="insight-provenance">
              {metricProvenance.map((entry) => (
                <div key={entry.label}>
                  <dt className="inline font-medium">{entry.label}: </dt>
                  <dd className="inline">{entry.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {/* Deliberately NOT labelled "데이터·출처": that exact string is the
              navigation tab's frozen label (regression-contract §1), and several
              specs locate that tab by its accessible name without `exact`, so a
              second button CONTAINING it makes those locators ambiguous. This one
              names the action instead of the destination. */}
          <button
            type="button"
            className="wep-btn-quiet mt-2"
            onClick={onOpenSources}
            data-testid="insight-open-sources"
          >
            출처 자세히 보기
          </button>
        </div>
      </section>
    </div>
  );
}
