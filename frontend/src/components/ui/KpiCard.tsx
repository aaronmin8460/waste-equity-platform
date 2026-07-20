"use client";

/**
 * KpiCard — one labelled metric: label, value, optional caption.
 *
 * Planned consumers (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §7, §9 Phases 3/5): the
 * facility-cost KPI grid (where `size="hero"` gives the headline result the
 * dominance the Phase 0 audit found missing — today the hero differs from the other
 * seven cards by 2px) and the landfill KPI row.
 *
 * Markup: renders a `<div>` holding a `<dt>`/`<dd>` pair. The CONSUMER must provide
 * the wrapping `<dl>` (a `<div>` between `<dl>` and `<dt>` is valid HTML and is what
 * lets the grid own its own layout).
 *
 * DATA-INTEGRITY CONTRACT (repo AGENTS.md; redesign plan §5 rules 1–3):
 * an unavailable value is NEVER rendered as `0`. Pass `unavailableReason` and the
 * card renders that served reason text instead of a value. `value` and
 * `unavailableReason` are mutually exclusive in practice: when a reason is present it
 * wins, so a caller that accidentally passes a zero-ish placeholder alongside a
 * reason still cannot display a fabricated number. Values use `tabular-nums` so
 * digits align, and are rendered as the exact string handed in — this component
 * never parses, rounds, or reformats a number (display rounding is Phase 3's
 * `lib/displayNumber.ts`, applied by the caller).
 */

import type { ReactNode } from "react";

export interface KpiCardProps {
  /** Metric name. */
  label: string;
  /**
   * The already-formatted value string. Rendered verbatim — never re-parsed, so an
   * exact backend decimal string is preserved.
   */
  value?: string;
  /** Served reason the value is unavailable. When set, it replaces the value. */
  unavailableReason?: string;
  /** Optional supporting caption (source, reference period, caveat). */
  caption?: ReactNode;
  /** `hero` is the single dominant result on a screen. */
  size?: "hero" | "default";
  testId?: string;
  valueTestId?: string;
}

export default function KpiCard({
  label,
  value,
  unavailableReason,
  caption,
  size = "default",
  testId,
  valueTestId,
}: KpiCardProps) {
  const unavailable = unavailableReason !== undefined;
  return (
    <div className={`wep-card ${size === "hero" ? "p-5" : ""}`.trim()} data-testid={testId}>
      <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
      <dd
        className={
          unavailable
            ? "mt-1 text-sm text-ink-muted"
            : size === "hero"
              ? "mt-1 text-3xl font-bold tabular-nums text-ink"
              : "mt-1 text-xl font-semibold tabular-nums text-ink"
        }
        data-testid={valueTestId}
      >
        {unavailable ? unavailableReason : value}
      </dd>
      {caption ? <p className="mt-1 text-xs text-ink-subtle">{caption}</p> : null}
    </div>
  );
}
