"use client";

/**
 * Text-first weight-sensitivity stability badge.
 *
 * Moved verbatim out of `app/page.tsx` when the score workspace was split; the
 * label, the `stability-badge` test id, and the three class styles are unchanged.
 *
 * Stability is ALWAYS conveyed by the label text (the count and its meaning, from
 * `stabilityBadgeLabel`), with color only as a secondary cue — never color alone.
 * It describes how a candidate behaves across the three compared weight profiles;
 * it is not 안전성, 시공 가능성, 법적 안정성, or 정책 확정성.
 */

import { stabilityBadgeLabel } from "../../lib/suitability";

export interface StabilityBadgeProps {
  stabilityClass: string;
  stableCount: number;
  /**
   * How many comparisons the class was derived from — 3 for the historical model,
   * 4 for the successor model. Omitted means historical, which is what every run
   * stored before the successor model existed.
   */
  stabilityTotal?: number;
}

export default function StabilityBadge({
  stabilityClass,
  stableCount,
  stabilityTotal,
}: StabilityBadgeProps) {
  const label = stabilityBadgeLabel(stabilityClass, stableCount, stabilityTotal);
  if (label === null) return null;
  const styles: Record<string, string> = {
    STABLE: "border-pink-600 bg-pink-50 text-pink-800",
    CONDITIONALLY_STABLE: "border-amber-500 bg-amber-50 text-amber-800",
    WEIGHT_SENSITIVE: "border-slate-400 bg-slate-100 text-slate-600",
  };
  return (
    <span
      data-testid="stability-badge"
      className={`inline-block rounded border px-1 text-[10px] font-semibold ${
        styles[stabilityClass] ?? styles.WEIGHT_SENSITIVE
      }`}
    >
      {label}
    </span>
  );
}
