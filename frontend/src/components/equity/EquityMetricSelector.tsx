"use client";

/**
 * 지표 선택 — the eleven equity metrics, presented as the question a citizen
 * actually asks.
 *
 * ── WHAT THE CORRECTION PASS CHANGED ─────────────────────────────────────────────
 * This was one flat list of eleven radios grouped by STATISTICAL FAMILY (총량 지표 /
 * 1인당 형평성 지표 / 시설 부담 지표). Every option was a bare line of text, the same
 * weight as every other, and a reader had to already know the family taxonomy to find
 * anything. It is now three SUBJECT sections — 지역별 인구 · 폐기물 발생량 ·
 * 1인당 시설 처리 수준 — whose rows are selectable cards, and where a waste category
 * carries its own 총량/1인당 switch instead of appearing twice in two different
 * families.
 *
 * Same eleven metrics. `lib/metrics.ts` (METRIC_SECTIONS) owns the mapping and
 * explains why the two 사업장 series stay two rows; this file only draws it.
 *
 * ── WHAT DID NOT CHANGE, AND MUST NOT ────────────────────────────────────────────
 *  - Three `<fieldset>`/`<legend>` groups, and only three. `e2e/accessibility.spec.ts`
 *    asserts the whole page has exactly three fieldsets, which is why the mode switch
 *    is a `role="group"` of `aria-pressed` buttons (the shared `SegmentedControl`
 *    contract) and never a nested fieldset.
 *  - ONE logical radio group: every category radio keeps `name="metric"`, so native
 *    arrow keys still traverse all seven rows across the three sections.
 *  - Nothing is hidden behind a disclosure on desktop: every row and every switch is
 *    directly selectable, no accordion, no `<select>`, no tabs.
 *  - Selection is signalled FOUR ways — the native checked radio, a heavier label, a
 *    stronger border, and the primary tint — so it never depends on colour alone.
 *
 * ── THE MODE SWITCH IS DERIVED STATE ─────────────────────────────────────────────
 * There is no second piece of state here. The active mode is read from the active
 * `metricKey` (`findMetricRow`) and writing it just selects the other served key of
 * the same row. A row with no per-capita counterpart renders no switch rather than a
 * disabled one that suggests a metric exists.
 */

import {
  METRIC_MODE_LABELS,
  METRIC_SECTIONS,
  metricKeyFor,
  type MetricKey,
  type MetricMode,
  type MetricRow,
} from "../../lib/metrics";
import SegmentedControl from "../ui/SegmentedControl";
import type { SegmentedControlOption } from "../ui/SegmentedControl";

const MODE_OPTIONS: readonly SegmentedControlOption<MetricMode>[] = [
  { key: "total", label: METRIC_MODE_LABELS.total },
  { key: "perCapita", label: METRIC_MODE_LABELS.perCapita },
];

export interface EquityMetricSelectorProps {
  /** The canonical active metric key. */
  metricKey: MetricKey;
  /** Which counting mode the active metric represents. */
  mode: MetricMode;
  /** Select a category row, keeping the current mode where that row supports it. */
  onSelectRow: (row: MetricRow) => void;
  /** Switch the active row between its absolute and per-capita served metric. */
  onSelectMode: (mode: MetricMode) => void;
}

function MetricRowCard({
  row,
  active,
  mode,
  onSelectRow,
  onSelectMode,
}: {
  row: MetricRow;
  active: boolean;
  mode: MetricMode;
  onSelectRow: (row: MetricRow) => void;
  onSelectMode: (mode: MetricMode) => void;
}) {
  // The switch belongs to the row it sits in, so it is shown only while that row is
  // the active one — an inert switch under an unselected row would read as a second
  // selectable thing.
  const showModes = row.perCapita !== undefined && active;
  const descriptionId = row.description ? `metric-row-desc-${row.key}` : undefined;

  return (
    <div
      data-testid={`metric-row-${row.key}`}
      data-selected={active || undefined}
      className={`rounded-card border ${
        active ? "border-primary bg-primary-soft" : "border-hairline bg-surface"
      }`}
    >
      {/* The supporting line sits OUTSIDE the <label> and is attached with
          aria-describedby instead. Inside it, it would become part of the radio's
          accessible NAME, so a screen reader would read a whole sentence of caveat
          where a name belongs. Name = the label; description = the description. */}
      <label
        className={`flex min-h-[2.75rem] cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm ${
          active ? "font-semibold text-ink" : "text-ink-muted"
        }`}
      >
        <input
          type="radio"
          name="metric"
          className="shrink-0"
          value={row.key}
          checked={active}
          aria-describedby={descriptionId}
          onChange={() => onSelectRow(row)}
        />
        <span className="min-w-0">{row.label}</span>
      </label>
      {row.description && (
        // Supporting text keeps its own weight whichever row is selected, so the
        // bold label above it stays the thing that reads as chosen.
        <p id={descriptionId} className="-mt-1 px-3 pb-2 pl-9 text-xs font-normal text-ink-subtle">
          {row.description}
        </p>
      )}

      {showModes && (
        <div className="border-t border-primary-border/60 px-3 py-2">
          <SegmentedControl
            options={MODE_OPTIONS}
            value={mode}
            onChange={onSelectMode}
            ariaLabel={`${row.label} 집계 기준`}
            testId={`metric-mode-${row.key}`}
          />
        </div>
      )}
    </div>
  );
}

export default function EquityMetricSelector({
  metricKey,
  mode,
  onSelectRow,
  onSelectMode,
}: EquityMetricSelectorProps) {
  return (
    <section aria-label="지표 목록" className="wep-card p-4" data-testid="equity-metric-selector">
      <h2 className="text-sm font-semibold text-ink">지표 선택</h2>
      <p className="mt-0.5 text-xs text-ink-subtle">
        지표를 바꾸면 지도와 순위가 모두 같은 값을 따라갑니다.
      </p>

      <div className="mt-3 flex flex-col gap-4">
        {METRIC_SECTIONS.map((section) => (
          <fieldset
            key={section.key}
            className="m-0 border-0 p-0"
            data-testid={`metric-section-${section.key}`}
          >
            <legend className="p-0 text-sm font-semibold text-ink">{section.title}</legend>
            {section.description && (
              <p className="mt-0.5 text-xs text-ink-subtle">{section.description}</p>
            )}
            <div className="mt-2 flex flex-col gap-2">
              {section.rows.map((row) => (
                <MetricRowCard
                  key={row.key}
                  row={row}
                  // A row is active when the served metric it resolves to in EITHER
                  // mode is the active one — so 생활계 stays selected when the reader
                  // flips it to 1인당.
                  active={metricKeyFor(row, "total") === metricKey || row.perCapita === metricKey}
                  mode={mode}
                  onSelectRow={onSelectRow}
                  onSelectMode={onSelectMode}
                />
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </section>
  );
}
