"use client";

/**
 * The segmented Z/R/E/D weight-distribution bar of ② 계산 모델 가중치 설정
 * (Figma 136:8684, the strip directly under the card title).
 *
 * IT DRAWS THE SERVED WEIGHTS AND NOTHING ELSE. The rows come from
 * `namedWeightRows`, which formats the ACTIVE profile's weight vector exactly as
 * the run served it. This component:
 *   - never hard-codes a percentage (the Figma frame's own segment widths are a
 *     mock and are not reproduced),
 *   - never re-normalises: if the served weights do not fill the bar, the gap is
 *     left visible rather than stretched to 100%,
 *   - never renders a missing weight as 0%. `weightPercent` returns "-" for an
 *     absent value; that segment is omitted and the absence is stated in text.
 *
 * The bar is `aria-hidden`: it is a second, redundant encoding of the labelled
 * `<dl>` that sits directly beneath it in the card, so announcing it again would
 * duplicate every value for a screen-reader user. Colour is therefore never the
 * only carrier of a weight — the number is always beside its Korean factor name.
 */

import type { ScoreComponent } from "../../lib/glossary";
import { COMPONENT_ACCENT } from "./factorAccents";

export interface WeightBarRow {
  component: ScoreComponent;
  label: string;
  /** Already-formatted percent string, or "-" when the weight was not served. */
  percent: string;
}

/** A "38%" string as a number, or null when the weight is absent ("-"). */
function widthOf(percent: string): number | null {
  if (!percent.endsWith("%")) return null;
  const n = Number(percent.slice(0, -1));
  return Number.isFinite(n) ? n : null;
}

export default function SuitabilityWeightBar({ rows }: { rows: WeightBarRow[] }) {
  const segments = rows
    .map((row) => ({ row, width: widthOf(row.percent) }))
    .filter((entry): entry is { row: WeightBarRow; width: number } => entry.width !== null);
  const missing = rows.filter((row) => widthOf(row.percent) === null);

  return (
    <div data-testid="weight-distribution-bar">
      <span
        aria-hidden
        className="flex h-2 w-full overflow-hidden rounded-pill bg-surface-sunken"
      >
        {segments.map(({ row, width }) => (
          <span
            key={row.component}
            className="block h-full"
            style={{ width: `${width}%`, backgroundColor: COMPONENT_ACCENT[row.component] }}
            data-testid={`weight-segment-${row.component}`}
          />
        ))}
      </span>
      {missing.length > 0 && (
        <p className="mt-1 text-[11px] text-ink-subtle" data-testid="weight-bar-missing">
          {missing.map((row) => row.label).join(" · ")} 항목은 이 기준의 가중치가 제공되지 않아 막대에
          표시하지 않았습니다. 값이 없는 항목은 0%로 채우지 않습니다.
        </p>
      )}
    </div>
  );
}
