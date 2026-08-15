"use client";

/**
 * 지표 선택 — the eleven equity metrics, presented as the question a citizen
 * actually asks.
 *
 * ── WHAT PHASE 1 CHANGED (Figma frame 123:333, inside page-1 74:1992) ────────────
 * Presentation only. The three subject sections, the eleven served metrics, the one
 * radio group, and the 총량/1인당 switch are all unchanged; what moved is how they
 * are drawn:
 *   - 지역별 인구 is a single row on its own tinted plate, above a rule, because it
 *     is one metric rather than a family — its `<legend>` would only repeat the row
 *     label, so it is kept for the accessibility tree and hidden visually.
 *   - 폐기물 발생량 and 1인당 시설 처리 수준 keep a visible group heading with its
 *     supporting line, and their rows sit inside ONE hairlined container divided by
 *     rules, instead of each row being its own bordered card.
 *   - The 총량/1인당 switch is inside the active row, as before.
 *
 * `lib/metrics.ts` (METRIC_SECTIONS) owns the mapping and explains why the two
 * 사업장 series stay two rows; this file only draws it.
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
 *  - The `metric-row-*`, `metric-mode-*`, and `metric-section-*` test ids.
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
  type MetricSection,
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

/**
 * A section whose only row IS the section — its `<legend>` would say exactly what
 * the row's own label says. The group still needs a name for assistive technology,
 * so the legend stays in the tree and is hidden visually rather than dropped.
 */
function legendIsRedundant(section: MetricSection): boolean {
  return section.rows.length === 1 && section.rows[0].label === section.title;
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
      className={active ? "bg-primary-soft" : "bg-surface"}
    >
      {/* The supporting line sits OUTSIDE the <label> and is attached with
          aria-describedby instead. Inside it, it would become part of the radio's
          accessible NAME, so a screen reader would read a whole sentence of caveat
          where a name belongs. Name = the label; description = the description. */}
      <label
        className={`flex min-h-[2.75rem] cursor-pointer items-start gap-3 px-[18px] pt-[14px] text-[15px] ${
          active ? "font-bold text-ink" : "font-medium text-ink-muted"
        } ${row.description || showModes ? "" : "pb-[14px]"}`}
      >
        <input
          type="radio"
          name="metric"
          className="mt-0.5 size-[18px] shrink-0 accent-[var(--color-brand)]"
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
        <p
          id={descriptionId}
          className={`px-[18px] pl-[48px] text-xs font-normal leading-[15px] text-ink-subtle ${
            showModes ? "" : "pb-[14px]"
          }`}
        >
          {row.description}
        </p>
      )}

      {showModes && (
        <div className="px-[18px] pb-[14px] pl-[48px] pt-2.5">
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
    <section
      aria-label="지표 목록"
      className="wep-card wep-figma-card"
      data-testid="equity-metric-selector"
    >
      {/* No supporting line under the heading. Figma's 지표 선택 card (74:1992) has
          none, and "지표를 바꾸면 지도와 순위가 모두 같은 값을 따라갑니다" described
          what the reader observes the moment they touch a radio — orientation copy
          for a control that demonstrates itself. The three section descriptions
          below ARE in the design and stay: they say what each family measures,
          which is not observable from the row labels. */}
      <h2 className="text-xl font-bold leading-6 text-brand">지표 선택</h2>

      <div className="mt-4 flex flex-col gap-4">
        {METRIC_SECTIONS.map((section, index) => {
          const quietLegend = legendIsRedundant(section);
          return (
            <fieldset
              key={section.key}
              className={`m-0 border-0 p-0 ${
                // Figma rules OFF the first (single-row) plate from the grouped
                // sections beneath it; the grouped sections are separated by their
                // own containers, so only this one boundary is drawn.
                index === 1 ? "border-t border-[var(--figma-rule)] pt-4" : ""
              }`}
              data-testid={`metric-section-${section.key}`}
            >
              <legend
                className={
                  quietLegend ? "sr-only" : "p-0 text-base font-bold leading-[19px] text-brand"
                }
              >
                {section.title}
              </legend>
              {section.description && (
                <p className="mt-[3px] text-xs leading-[15px] text-ink-subtle">
                  {section.description}
                </p>
              )}
              <div
                className={
                  quietLegend
                    ? // The single row sits on its own tinted plate (Figma's #F9F9F9
                      // frame), with no group container around it.
                      "mt-0 overflow-hidden rounded-2xl bg-canvas"
                    : // Grouped rows share ONE hairlined container, divided by rules.
                      "mt-3 divide-y divide-[var(--figma-rule)] overflow-hidden rounded-[18px] border border-[var(--figma-rule)]"
                }
              >
                {section.rows.map((row) => (
                  <MetricRowCard
                    key={row.key}
                    row={row}
                    // A row is active when the served metric it resolves to in EITHER
                    // mode is the active one — so 생활계 stays selected when the reader
                    // flips it to 1인당.
                    active={
                      metricKeyFor(row, "total") === metricKey || row.perCapita === metricKey
                    }
                    mode={mode}
                    onSelectRow={onSelectRow}
                    onSelectMode={onSelectMode}
                  />
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
