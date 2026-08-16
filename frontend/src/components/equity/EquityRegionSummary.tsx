"use client";

/**
 * 선택한 지역 — the current-selection summary of the 지역 지표 (equity) column.
 *
 * ── What this component does NOT own ────────────────────────────────────────────
 * Nothing analytical. Every value is passed in already resolved by `page.tsx`
 * (the one owner of `selectedRegionCode`, the active metric, and the served
 * provenance). It computes no value, formats no number, and holds no state — the
 * region `<select>` lives in its own section (`EquityRegionPicker`) and drives the
 * same single `selectedRegionCode`.
 *
 * ── Contracts preserved verbatim (docs/ui-refresh/regression-contract.md) ───────
 *  - `selected-metric-summary` stays a `role="status"` live region wrapping ONLY
 *    the metric name + unit, so a metric change is announced as one short phrase
 *    and the provenance caption is not re-read on every change.
 *  - `selected-region-summary` keeps its test id, its `선택한 지역` heading, the
 *    `selected-region-{name,value,empty,clear,metric-source,derived-note}` ids, and
 *    the served metric label inside its subtree.
 *  - MISSING IS NEVER ZERO: with no served value the card renders the served
 *    availability text (`selection.metricDisplay`, e.g. `데이터 없음 — …`) and a
 *    `missing` DataStatusBadge. It never prints 0, `-`, or a placeholder figure.
 *    Availability is carried by that TEXT; the warn tone is redundant emphasis.
 *
 * ── PHASE 1 (Figma frame 220:439) ────────────────────────────────────────────────
 * Presentation, plus one relocation.
 *
 *   - The region name is a filled chip and the value is the card's largest type, so
 *     the answer reads before the labels around it.
 *   - The provenance status badge and 선택 지우기 move up beside the heading.
 *   - 현재 지표 / 자료 기준 stay the two-column pair under a rule, unchanged.
 *
 *   - RELOCATED IN: 출처와 계산 방법. It used to be its own card further down the
 *     column; the `page-1 기술요청` annotation asks for that entry to be removed from
 *     the panel, and the Figma aside has five cards with no slot for it. It is NOT
 *     deleted — deleting it would drop the derivation method, the numerator/
 *     denominator sources, the boundary provenance, and the metric caveat, all of
 *     which this repository requires a displayed value to be able to justify. It
 *     becomes a closed `<details>` at the foot of THIS card, which is the card the
 *     provenance belongs to: same content, same components, one interaction away.
 */

import type { ReactNode } from "react";

import type { RegionSelection } from "../MapView";
import type { DataStatus } from "../../lib/glossary";
import { unitLabel } from "../../lib/units";
import DataStatusBadge from "../ui/DataStatusBadge";

export interface EquityRegionSummaryProps {
  /** Active metric's plain-Korean label (lib/metrics.ts). */
  metricLabel: string;
  /** Active metric's unit as served (may be ""). */
  unit: string;
  /** Active metric's reference period as served (may be "" when none was served). */
  referencePeriod: string;
  /** How the active metric's values came to be — `reported` or `derived`. */
  metricStatus: DataStatus;
  /** Served source + reference period line(s) for the active metric. */
  metricProvenance: { label: string; value: string }[];
  /** The one canonical selection, already derived for the active metric. */
  selected: RegionSelection | null;
  /** Clears the canonical `selectedRegionCode`. */
  onClear: () => void;
  /**
   * The 출처와 계산 방법 panels (derivation method + source + boundaries), rendered
   * by the page. Passed in rather than built here so this component keeps owning no
   * analytical knowledge; omitted when the active metric has neither.
   */
  methodAndSources?: ReactNode;
}

export default function EquityRegionSummary({
  metricLabel,
  unit,
  referencePeriod,
  metricStatus,
  metricProvenance,
  selected,
  onClear,
  methodAndSources,
}: EquityRegionSummaryProps) {
  // A selected region with no served value is `missing` — NOT the metric's own
  // provenance, which would imply a value exists. With nothing selected the badge
  // describes the metric itself, which is what the card is showing.
  const status: DataStatus =
    selected === null ? metricStatus : selected.hasValue ? metricStatus : "missing";

  return (
    <section
      aria-label="선택한 지역 요약"
      className="wep-card wep-figma-card"
      data-testid="selected-region-summary"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-xl font-bold leading-6 text-brand">선택한 지역</h2>
        <div className="flex flex-none items-center gap-1.5">
          <DataStatusBadge status={status} testId="equity-summary-status" />
          {selected && (
            <button
              type="button"
              onClick={onClear}
              className="min-h-6 rounded-full border border-brand px-3 text-[11px] font-bold text-brand hover:bg-primary-soft"
              data-testid="selected-region-clear"
            >
              선택 지우기
            </button>
          )}
        </div>
      </div>

      {/* Region + value: the answer-first pair. Before any selection the card says
          how to make one — never a zero and never a sample region. */}
      {selected === null ? (
        <p className="mt-3 text-xs text-ink-subtle" data-testid="selected-region-empty">
          지도에서 지역을 누르거나 위 지역 선택에서 지역을 고르면 이름과 값이 여기에 표시됩니다.
        </p>
      ) : (
        <div role="status" className="mt-3">
          <p data-testid="selected-region-name">
            <span className="inline-block rounded-full bg-primary-soft px-2.5 py-1 text-[15px] font-bold leading-[18px] text-brand">
              {selected.regionName}
            </span>
          </p>
          {/* hasValue ⇒ the served value with its unit; otherwise the SERVED
              availability text carried on the feature. Never a fabricated 0. */}
          <p
            className={
              selected.hasValue
                ? "mt-3 text-[25px] font-bold leading-[30px] tabular-nums text-brand"
                : "mt-3 text-sm font-medium text-warn"
            }
            data-testid="selected-region-value"
          >
            {selected.metricDisplay}
          </p>
        </div>
      )}

      {/* The compact KPI pair: what is being measured, and when the data is from.
          Only genuinely served items are rendered — an absent reference period
          leaves ONE cell rather than inventing a second (repo AGENTS.md). */}
      <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3 border-t border-[var(--figma-rule)] pt-4">
        <div className="min-w-0" role="status" data-testid="selected-metric-summary">
          <dt className="text-xs text-ink-subtle">현재 지표</dt>
          <dd>
            <span className="block text-[15px] font-bold leading-[18px] text-brand">
              {metricLabel}
            </span>
            {/* The PRINTED unit (lib/units.ts), so this reads 단위 명 rather than the
                served English `persons` the value above it is already rendered with. */}
            {unit ? (
              <span className="mt-0.5 block text-xs text-ink-subtle">단위 {unitLabel(unit)}</span>
            ) : null}
          </dd>
        </div>
        {referencePeriod ? (
          <div className="min-w-0">
            <dt className="text-xs text-ink-subtle">자료 기준</dt>
            <dd
              className="text-[15px] font-bold leading-[18px] tabular-nums text-brand"
              data-testid="equity-summary-reference-period"
            >
              {referencePeriod}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* Source + reference period for the displayed value (repo AGENTS.md). */}
      {(metricProvenance.length > 0 || selected) && (
        <dl className="mt-3 space-y-0.5 border-t border-[var(--figma-rule)] pt-3 text-[11px] text-ink-subtle">
          {metricProvenance.map((entry) => (
            <div key={entry.label} data-testid="selected-region-metric-source">
              <dt className="inline font-medium">{entry.label}: </dt>
              <dd className="inline">{entry.value}</dd>
            </div>
          ))}
          {selected && (
            <div>
              <dt className="inline font-medium">경계 출처: </dt>
              <dd className="inline">
                {selected.sourceId} ({selected.boundaryReferencePeriod})
              </dd>
            </div>
          )}
        </dl>
      )}

      {selected?.geometryKind === "DERIVED" && selected.childRegionNames.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-subtle" data-testid="selected-region-derived-note">
          통계 보고 단위: 시 · 경계는 {selected.childRegionNames.join("·")} 자치구 경계의 파생
          합집합입니다. 구별 공식 폐기물 값은 제공되지 않습니다.
        </p>
      )}

      {/* The relocated 출처와 계산 방법. A native disclosure — the browser supplies
          Enter/Space, the focus ring, and the expanded state, and it keeps the closed
          body out of the tab order without any JavaScript. */}
      {methodAndSources && (
        <details
          className="mt-3 border-t border-[var(--figma-rule)] pt-3"
          data-testid="equity-method-sources"
        >
          <summary
            className="cursor-pointer text-xs font-medium text-ink-muted"
            data-testid="equity-method-sources-summary"
          >
            출처와 계산 방법
          </summary>
          <div className="mt-2">{methodAndSources}</div>
        </details>
      )}
    </section>
  );
}
