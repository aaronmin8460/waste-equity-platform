"use client";

/**
 * 지역 조회 — the keyboard/screen-reader path to selecting a region.
 *
 * The MapLibre canvas cannot be reached by keyboard or a screen reader, so this
 * native `<select>` populates exactly the same selection a map click does. It was
 * previously wedged inside the selected-region summary card, between the card's
 * heading and its value, which made the summary read as a form rather than as an
 * answer; this milestone gives it its own labelled section directly beneath the
 * summary, and changes nothing else about it.
 *
 * DELIBERATELY STILL A NATIVE `<select>` — it is NOT replaced by the searchable
 * combobox in `components/ui/SearchableRegionPicker.tsx`. That component is the
 * established picker for the facility-cost setup flow, not for this one, and the
 * region control here is contracted as a native select with the accessible name
 * `지역 선택` (docs/ui-refresh/regression-contract.md; `e2e/accessibility.spec.ts`,
 * `e2e/phase4EquityMap.spec.ts`, `app/page.phase4.test.tsx`). Swapping a working
 * native control for a custom div-based one would trade platform keyboard
 * behaviour for styling.
 *
 * It owns no state: `value` is the canonical `selectedRegionCode` and every change
 * is reported straight back to the page.
 */

export interface EquityRegionPickerProps {
  /** Every region on the ACTIVE geometry, already sorted by the page. */
  regionOptions: { code: string; name: string }[];
  /** The canonical selected region code (`null` = nothing selected). */
  selectedRegionCode: string | null;
  onSelectRegion: (code: string | null) => void;
}

export default function EquityRegionPicker({
  regionOptions,
  selectedRegionCode,
  onSelectRegion,
}: EquityRegionPickerProps) {
  return (
    <section
      aria-label="지역 조회"
      className="wep-card p-4"
      data-testid="equity-region-picker"
    >
      <h2 className="text-sm font-semibold text-ink">지역 조회</h2>
      <p className="mt-0.5 text-xs text-ink-subtle">
        지도를 누르지 않고도 지역을 고를 수 있습니다. 선택한 지역은 지도·순위와 함께 움직입니다.
      </p>
      <label className="mt-2 block text-xs font-medium text-ink-muted">
        지역 선택
        <select
          className="mt-1 min-h-[2.25rem] w-full rounded-control border border-hairline-strong bg-surface px-2 py-1.5 text-sm text-ink"
          data-testid="region-select"
          value={selectedRegionCode ?? ""}
          onChange={(event) => onSelectRegion(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">지역을 선택하세요…</option>
          {regionOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
