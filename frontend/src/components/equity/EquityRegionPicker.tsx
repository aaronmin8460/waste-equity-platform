"use client";

/**
 * 지역 선택 — the keyboard/screen-reader path to selecting a region.
 *
 * The MapLibre canvas cannot be reached by keyboard or a screen reader, so this
 * native `<select>` populates exactly the same selection a map click does.
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
 *
 * ── PHASE 1 (Figma frame 74:2011) ────────────────────────────────────────────────
 * The card is now titled 지역 선택 rather than 지역 조회, and the design carries no
 * supporting paragraph, so the two explanatory lines are gone. The `<label>` still
 * says 지역 선택 — that string is the select's contracted accessible name — but is
 * visually hidden, because printing it directly under an identical heading would say
 * the same words twice. Nothing about the control, its options, or its callback
 * changed.
 *
 * The one Figma value NOT adopted is the field's 1.5px #F9F9F9 border: on a white
 * surface that is a 1.02:1 edge, i.e. no visible boundary at all, which fails the
 * 3:1 WCAG 1.4.11 minimum for a control's own outline. `--color-hairline-strong`
 * is kept instead.
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
      className="wep-card wep-figma-card"
      data-testid="equity-region-picker"
    >
      <h2 className="text-xl font-bold leading-6 text-brand">지역 선택</h2>
      <label className="mt-3 block">
        <span className="sr-only">지역 선택</span>
        <select
          className="min-h-9 w-full rounded-control border border-hairline-strong bg-surface px-3 py-2 text-[13px] text-ink"
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
