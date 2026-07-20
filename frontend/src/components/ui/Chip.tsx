"use client";

/**
 * Chip — a selection token, optionally removable.
 *
 * Wraps the existing `.wep-chip` class (app/globals.css) rather than introducing a
 * second chip style. Planned consumers (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §7, §9):
 * the searchable service-region picker in Phase 2, the equity region comparison, and
 * the transparency dataset status badge in Phase 6. `RegionComparison` keeps its
 * current inline markup in Phase 1 — this phase converts only shared global chrome.
 *
 * Accessibility: the remove control is a native button whose accessible name
 * INCLUDES the chip label ("서울 중구 제거"), never a bare "✕", so a screen-reader
 * user knows what a given remove button removes.
 */

export interface ChipProps {
  /** Visible token text. */
  label: string;
  /** When provided, a remove button is rendered. */
  onRemove?: () => void;
  /**
   * Verb used to build the remove button's accessible name. The label is always
   * appended, so the name identifies the specific chip.
   */
  removeLabel?: string;
  testId?: string;
}

export default function Chip({ label, onRemove, removeLabel = "제거", testId }: ChipProps) {
  return (
    <span className="wep-chip" data-testid={testId}>
      <span>{label}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          // The accessible name names the chip, so it is never a bare icon.
          aria-label={`${label} ${removeLabel}`}
          className="text-primary-hover"
          data-testid={testId ? `${testId}-remove` : undefined}
        >
          <span aria-hidden>✕</span>
        </button>
      ) : null}
    </span>
  );
}
