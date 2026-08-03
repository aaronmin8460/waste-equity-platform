"use client";

/**
 * A decorative proportional rule. Purely a second encoding of the exact figure
 * printed beside it, hence `aria-hidden` — assistive technology reads the number.
 *
 * Unchanged from the pre-refresh implementation in `LandfillDashboard.tsx`; it
 * lives here only because the exact-value table and the composition rows both use
 * it, and a second copy is how two bars start disagreeing about what a full track
 * means.
 */

export interface LandfillProportionRuleProps {
  /** 0–1, produced by `barRatio`. A caller with `null` must render no rule at all. */
  ratio: number;
  align: "left" | "right";
}

export default function LandfillProportionRule({ ratio, align }: LandfillProportionRuleProps) {
  return (
    <span aria-hidden className="mt-1 block h-1 w-full rounded-pill bg-surface-sunken">
      <span
        className={`block h-1 rounded-pill bg-primary ${align === "right" ? "ml-auto" : ""}`}
        style={{ width: `${Math.min(100, ratio * 100)}%` }}
      />
    </span>
  );
}
