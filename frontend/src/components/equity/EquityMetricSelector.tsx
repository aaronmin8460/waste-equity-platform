"use client";

/**
 * 지역 지표 선택 — the eleven equity metric radios, in their three labelled groups.
 *
 * STRUCTURE IS FROZEN (docs/ui-refresh/regression-contract.md §5): exactly three
 * `<fieldset>`/`<legend>` groups — 총량 지표 / 1인당 형평성 지표 / 시설 부담 지표 —
 * holding exactly eleven `input[type=radio][name="metric"]` in ONE logical radio
 * group, with the same keys, labels, and onChange. They are NOT a `<select>`, tabs,
 * chips, or a disclosure: every option stays directly selectable on desktop, and
 * native arrow-key traversal still crosses all eleven because they share a name.
 * The legends render their `MetricGroup.legend` text and nothing else — the
 * terminology audit compares the three strings with `toEqual`, so a count badge or
 * an icon inside a legend breaks it.
 *
 * What this milestone changes is density and emphasis only: each family is a
 * recessed panel inside the card instead of a bare list, and the selected row is
 * marked by FOUR independent signals — the native checked radio, a stronger
 * border, a heavier label, and the action-blue tint — so selection never depends on
 * color alone.
 */

import type { MetricDefinition, MetricGroup, MetricKey } from "../../lib/metrics";

export interface EquityMetricSelectorProps {
  /** The three groups, in display order (lib/metrics.ts). */
  groups: readonly MetricGroup[];
  /** All eleven metric definitions; filtered per group here, never re-ordered. */
  metrics: readonly MetricDefinition[];
  /** The canonical active metric key. */
  metricKey: MetricKey;
  onSelectMetric: (key: MetricKey) => void;
}

export default function EquityMetricSelector({
  groups,
  metrics,
  metricKey,
  onSelectMetric,
}: EquityMetricSelectorProps) {
  return (
    <section aria-label="지표 목록" className="wep-card p-4" data-testid="equity-metric-selector">
      <h2 className="text-sm font-semibold text-ink">지역 지표 선택</h2>
      <p className="mt-0.5 text-xs text-ink-subtle">
        지표를 바꾸면 지도·순위·비교가 모두 같은 값을 따라갑니다.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {groups.map((group) => (
          <fieldset
            key={group.key}
            className="m-0 rounded-card border border-hairline bg-surface-muted px-3 pb-2 pt-1.5"
            data-testid={`metric-group-${group.key}`}
          >
            <legend className="px-1 text-xs font-semibold text-ink-muted">{group.legend}</legend>
            <div className="mt-1 flex flex-col gap-0.5">
              {metrics
                .filter((candidate) => candidate.group === group.key)
                .map((candidate) => {
                  const isActive = metricKey === candidate.key;
                  return (
                    <label
                      key={candidate.key}
                      className={`flex min-h-[2rem] items-center gap-2 rounded-control border px-2 py-1 text-sm ${
                        isActive
                          ? "border-primary-border bg-primary-soft font-semibold text-ink"
                          : "border-transparent text-ink-muted hover:border-hairline hover:bg-surface"
                      }`}
                    >
                      <input
                        type="radio"
                        name="metric"
                        className="shrink-0"
                        checked={isActive}
                        onChange={() => onSelectMetric(candidate.key)}
                      />
                      <span>{candidate.label}</span>
                    </label>
                  );
                })}
            </div>
          </fieldset>
        ))}
      </div>
    </section>
  );
}
