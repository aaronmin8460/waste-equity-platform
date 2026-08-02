"use client";

/**
 * FilterChip — a toggleable filter token (selected / not selected).
 *
 * Distinct from `Chip`, which is a static, optionally-removable token showing an
 * already-made selection. This one IS the control: it toggles.
 *
 * ACCESSIBILITY: a native `<button aria-pressed>`, so keyboard activation and state
 * announcement come from the platform. Deliberately NOT `role="checkbox"` or a
 * `<fieldset>` of inputs — `e2e/accessibility.spec.ts` asserts the page has exactly
 * three fieldsets (the equity metric groups), and the equity metric radios must
 * stay radios (docs/ui-refresh/regression-contract.md §5). A chip row is for
 * supplementary filtering, never for the analytical metric selection.
 *
 * NOT COLOR ALONE: selection is carried by four independent signals — `aria-pressed`
 * for AT, a rendered check mark (a shape: present vs absent), a heavier font weight,
 * and a stronger border — with the action-blue tint as the fourth, supporting one.
 * The check mark is `aria-hidden` because `aria-pressed` already states the fact;
 * announcing both would double it.
 */

export interface FilterChipProps {
  /** Visible label. Rendered verbatim as the chip's text. */
  label: string;
  selected: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
  /**
   * Extra context for the accessible name when the visible label alone is
   * ambiguous out of context (e.g. "2024" → "자료 기준 시점 2024").
   */
  ariaLabel?: string;
  testId?: string;
}

export default function FilterChip({
  label,
  selected,
  onToggle,
  disabled = false,
  ariaLabel,
  testId,
}: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onToggle(!selected)}
      className="wep-filter-chip"
      data-testid={testId}
    >
      {selected ? (
        <span aria-hidden className="wep-filter-chip-check">
          ✓
        </span>
      ) : null}
      <span>{label}</span>
    </button>
  );
}
