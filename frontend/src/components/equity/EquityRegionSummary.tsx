"use client";

/**
 * 지역 부담 — the current-selection summary that heads the equity control column.
 *
 * BEFORE (this milestone's before-state, docs/ui-refresh/equity-dashboard.md): the
 * same information was split across TWO adjacent cards — an "선택한 지표" card and a
 * "선택한 지역" card — and each rendered its own copy of `metricProvenance`, so the
 * source line appeared twice within 200px of itself while the reference period had
 * no distinct slot at all. This merges them into one answer-first summary: which
 * region, what it measures, what the value is, and when the data is from.
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
 *    and the provenance caption is not re-read on every change. The name stays
 *    `text-base font-semibold` and the unit `text-xs`, i.e. visibly dominant.
 *  - `selected-region-summary` keeps its test id, its `선택한 지역` heading, the
 *    `selected-region-{name,value,empty,clear,metric-source,derived-note}` ids, and
 *    the served metric label inside its subtree.
 *  - MISSING IS NEVER ZERO: with no served value the card renders the served
 *    availability text (`selection.metricDisplay`, e.g. `데이터 없음 — …`) and a
 *    `missing` DataStatusBadge. It never prints 0, `-`, or a placeholder figure.
 *    Availability is carried by that TEXT; the warn tone is redundant emphasis.
 */

import type { RegionSelection } from "../MapView";
import type { DataStatus } from "../../lib/glossary";
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
}

export default function EquityRegionSummary({
  metricLabel,
  unit,
  referencePeriod,
  metricStatus,
  metricProvenance,
  selected,
  onClear,
}: EquityRegionSummaryProps) {
  // A selected region with no served value is `missing` — NOT the metric's own
  // provenance, which would imply a value exists. With nothing selected the badge
  // describes the metric itself, which is what the card is showing.
  const status: DataStatus = selected === null ? metricStatus : selected.hasValue ? metricStatus : "missing";

  return (
    <section
      aria-label="선택한 지역 요약"
      className="wep-card p-4"
      data-testid="selected-region-summary"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">선택한 지역</h2>
        <div className="flex flex-none items-center gap-2">
          <DataStatusBadge status={status} testId="equity-summary-status" />
          {selected && (
            <button
              type="button"
              onClick={onClear}
              className="wep-btn-quiet"
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
        <p className="mt-2 text-xs text-ink-subtle" data-testid="selected-region-empty">
          지도에서 지역을 누르거나 아래 지역 조회에서 지역을 선택하면 이름과 값이 여기에 표시됩니다.
        </p>
      ) : (
        <div role="status" className="mt-2">
          <p
            className="text-base font-semibold leading-tight text-ink"
            data-testid="selected-region-name"
          >
            {selected.regionName}
          </p>
          {/* hasValue ⇒ the served value with its unit; otherwise the SERVED
              availability text carried on the feature. Never a fabricated 0. */}
          <p
            className={
              selected.hasValue
                ? "mt-0.5 text-2xl font-semibold tabular-nums leading-tight text-ink"
                : "mt-0.5 text-sm font-medium text-warn"
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
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-hairline pt-3">
        <div className="min-w-0" role="status" data-testid="selected-metric-summary">
          <dt className="text-xs font-medium text-ink-subtle">현재 지표</dt>
          <dd>
            <span className="block text-base font-semibold leading-tight text-ink">
              {metricLabel}
            </span>
            {unit ? <span className="mt-0.5 block text-xs text-ink-subtle">단위 {unit}</span> : null}
          </dd>
        </div>
        {referencePeriod ? (
          <div className="min-w-0">
            <dt className="text-xs font-medium text-ink-subtle">자료 기준</dt>
            <dd
              className="text-base font-semibold tabular-nums leading-tight text-ink"
              data-testid="equity-summary-reference-period"
            >
              {referencePeriod}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* Source + reference period for the displayed value (repo AGENTS.md). This
          is now rendered ONCE for the card, instead of once per former sub-card. */}
      {(metricProvenance.length > 0 || selected) && (
        <dl className="mt-3 space-y-0.5 border-t border-hairline pt-3 text-xs text-ink-subtle">
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
        <p className="mt-2 text-xs text-ink-subtle" data-testid="selected-region-derived-note">
          통계 보고 단위: 시 · 경계는 {selected.childRegionNames.join("·")} 자치구 경계의 파생
          합집합입니다. 구별 공식 폐기물 값은 제공되지 않습니다.
        </p>
      )}
    </section>
  );
}
