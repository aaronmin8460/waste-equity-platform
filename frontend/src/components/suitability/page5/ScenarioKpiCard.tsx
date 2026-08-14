"use client";

/**
 * One card of the Page-5 KPI row (Figma 167:10554 `ResultKPIRow`, 267.2×117).
 *
 * ── WHY NOT `ui/KpiCard` ─────────────────────────────────────────────────────────
 * The shared primitive is the six-dashboard KPI: 12px label above a 20px value, on a
 * bordered `.wep-card`. The frame's Page-5 tile is a different object — a shadowed
 * r18 card whose label sits BESIDE a glyph chip at 16px, with a 19px navy figure and
 * an 11.5px caption. Re-pointing `ui/KpiCard` would restyle the facility-cost and
 * landfill rows at the same time, which is not this lane's to change, so the frame's
 * variant lives here and the shared one is left alone.
 *
 * ── THE DATA CONTRACT IS THE SHARED ONE ──────────────────────────────────────────
 * `value` and `unavailableReason` behave exactly as in `ui/KpiCard`: a reason WINS,
 * so an unavailable figure can never be rendered as `0` or as a stand-in number, and
 * `value` is printed verbatim — never parsed, rounded or reformatted here. The
 * `<dt>`/`<dd>` pair and the caller-owned `<dl>` are also unchanged, so the row still
 * reads as a description list to assistive technology.
 */

import type { ReactNode } from "react";

export interface ScenarioKpiCardProps {
  /** Metric name — rendered beside the glyph, never inside it. */
  label: string;
  /** Already-formatted value string. Rendered verbatim. */
  value?: string;
  /** Served reason the value is unavailable. When set, it REPLACES the value. */
  unavailableReason?: string;
  /** Supporting caption: the population the figure is measured over. */
  caption?: ReactNode;
  /**
   * A single decorative glyph for the chip. Purely ornamental (`aria-hidden`) — the
   * label carries the meaning, so a reader who cannot see the chip loses nothing.
   */
  glyph?: string;
  testId?: string;
  valueTestId?: string;
}

export default function ScenarioKpiCard({
  label,
  value,
  unavailableReason,
  caption,
  glyph = "•",
  testId,
  valueTestId,
}: ScenarioKpiCardProps) {
  const unavailable = unavailableReason !== undefined;
  return (
    <div
      className="wep-card wep-figma-card flex min-w-0 flex-col gap-2.5"
      data-testid={testId}
    >
      <dt className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <span
          className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary-soft text-[12px] font-bold text-primary"
          aria-hidden="true"
        >
          {glyph}
        </span>
        <span className="min-w-0 leading-snug">{label}</span>
      </dt>
      <dd
        className={
          unavailable
            ? "text-[12.5px] leading-snug text-ink-muted"
            : "text-[19px] font-bold leading-tight tabular-nums text-primary"
        }
        data-testid={valueTestId}
      >
        {unavailable ? unavailableReason : value}
      </dd>
      {caption ? (
        <p className="text-[11.5px] leading-snug text-ink-subtle">{caption}</p>
      ) : null}
    </div>
  );
}
