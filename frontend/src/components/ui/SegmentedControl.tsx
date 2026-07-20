"use client";

/**
 * SegmentedControl — a restrained pill switcher for 2–4 mutually exclusive views.
 *
 * Immediate consumer (Phase 1): the 후보지 분석 sub-view switch — 후보지 점수 /
 * 가중치 바꿔보기 / 비용 살펴보기 — rendered once by `DashboardShell` so it sits in the
 * same place for all three sub-views instead of being duplicated inside the equity
 * sidebar and above the full-width cost dashboard. Planned later consumer: the
 * landfill 월/연간 switch (Phase 5, see docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §7).
 *
 * Semantics: native `<button aria-pressed>` inside a labelled `role="group"`.
 * Deliberately NOT `role="radiogroup"`/`role="tablist"` — those promise roving
 * arrow-key focus, which is not implemented here; plain Tab order is the honest and
 * sufficient behaviour for a handful of buttons (see docs/ACCESSIBILITY.md). It is
 * also deliberately not a `<fieldset>`: `e2e/accessibility.spec.ts` asserts the page
 * has exactly three fieldsets (the equity metric groups).
 *
 * The selected segment is marked by a raised white pill + card shadow + heavier
 * weight in addition to the accent color, so state is never conveyed by color alone.
 */

export interface SegmentedControlOption<T extends string> {
  /** Stable value reported back through `onChange`. */
  key: T;
  /** Visible label. Rendered verbatim as the button's only content. */
  label: string;
  /** Optional `data-testid` for the individual segment. */
  testId?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[];
  /** The currently selected option key. */
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group — required, since the track has no visible label. */
  ariaLabel: string;
  /** Optional `data-testid` for the group element. */
  testId?: string;
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  testId,
}: SegmentedControlProps<T>) {
  return (
    <div className="wep-segment-track" role="group" aria-label={ariaLabel} data-testid={testId}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className="wep-segment"
          data-testid={option.testId}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
