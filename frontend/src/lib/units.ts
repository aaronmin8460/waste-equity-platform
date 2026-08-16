/**
 * A SERVED unit → how it is PRINTED in this Korean-only UI.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────
 * `/api/v1/population` serves the English unit `persons`. One surface — the map
 * legend — already translated it to `명`, with the map private to that component;
 * every other surface that prints the same unit (the selected-region value, the map
 * popup, the ranking basis, the full-ranking column header) printed the raw English
 * instead, so the same population metric read `561,000 persons` in the sidebar and
 * `명` in the legend two hundred pixels away. The mapping is now in ONE place and
 * every display path goes through it, so those two can no longer disagree.
 *
 * ── THIS IS A DISPLAY LABEL, NOT A UNIT CONVERSION ───────────────────────────────
 * Nothing here changes a value, a scale break, a comparison, or a payload. The
 * served unit string stays exactly as served in the API types, in `lib/exports.ts`
 * (the CSV still writes `단위,persons`, which is the reproducible machine-readable
 * record of what the API returned), and in every request. Only the characters a
 * citizen reads are translated.
 *
 * `separator` is per-unit because Korean typography attaches a counter word
 * directly to the numeral (`151,306명`) but keeps a space before a compound symbol
 * unit (`12.3 kg/인/년`, the unit the per-capita metrics serve). A unit with no
 * entry keeps the pre-existing spaced rendering and its own served text, so an
 * unrecognised unit is passed through rather than dropped or guessed at.
 */

export interface UnitDisplay {
  /** What the reader sees in place of the served unit string. */
  label: string;
  /** What goes between a numeral and that label. */
  separator: string;
}

const UNIT_DISPLAY: Record<string, UnitDisplay> = {
  persons: { label: "명", separator: "" },
};

export function unitDisplay(unit: string): UnitDisplay {
  return UNIT_DISPLAY[unit] ?? { label: unit, separator: " " };
}

/**
 * The unit alone, for the places that print it beside a word rather than a numeral
 * (`단위 명`, `값 (명)`). Never returns "" for a served unit — an empty result means
 * the metric genuinely serves no unit, which callers already branch on.
 */
export function unitLabel(unit: string): string {
  return unit ? unitDisplay(unit).label : "";
}

/**
 * A formatted numeral and its unit, joined the way that unit is written.
 * `formatWithUnit("142,000", "persons")` → `142,000명`;
 * `formatWithUnit("12.3", "kg/인/년")` → `12.3 kg/인/년`.
 */
export function formatWithUnit(value: string, unit: string): string {
  if (!unit) return value;
  const { label, separator } = unitDisplay(unit);
  return `${value}${separator}${label}`;
}
