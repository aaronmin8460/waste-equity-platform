/**
 * Map-wide land-cover candidate-cell layer — pure styling, filtering and legend
 * helpers (Phase 1B-LC5B).
 *
 * Everything here is a pure function of its arguments so the load-bearing honesty
 * rules can be unit-tested without a WebGL context:
 *
 *  1. **A class code always renders in the same color.** {@link landCoverClassColor}
 *     is a pure function of the official code STRING — never of array position, of
 *     which tiles happen to be loaded, or of how many classes are on screen. Panning
 *     the map can add classes to the legend; it can never recolor one.
 *  2. **`NO_COVERAGE` is never a class.** It has no dominant class at any level, so it
 *     is painted with an explicit unevaluated treatment, is excluded from the class
 *     legend, and is never folded into an invented "기타"/"Unknown" category.
 *  3. **The legend is the filter.** One list drives both the swatches shown to the
 *     reader and the MapLibre filter applied to the map, so a legend row can never
 *     describe styling the map is not doing.
 *
 * Official class codes and Korean names are passed through verbatim — never
 * translated, renamed, re-grouped, or merged. Nothing here is a score, weight,
 * exclusion, or legal determination: color communicates category only.
 */

import type { LandCoverCoverageStatus } from "./api";
import { CLASS_LEVELS, type ClassLevel, type LandCoverErrorKind } from "./landCover";

// --------------------------------------------------------------------------- //
// Bounded failure messages
// --------------------------------------------------------------------------- //

/**
 * User-facing messages when the MAP LAYER cannot be shown.
 *
 * Distinct from the candidate-detail messages (LC5A) because the situation differs: a
 * layer that cannot resolve its release is not a candidate whose statistics are
 * missing. None of them implies land cover is absent, and none exposes a stack trace,
 * SQL, path, connection string, or raw backend error.
 *
 * EVERY message states explicitly that the failure does not mean land cover is absent.
 * That clause is load-bearing, not boilerplate: a reader who sees the layer refuse to
 * draw must not conclude the area has no land cover. Phase 1B-LC6 found `MALFORMED`
 * was the one message missing it and added it.
 */
export const LAND_COVER_LAYER_ERRORS: Record<LandCoverErrorKind, string> = {
  NOT_FOUND:
    "표시할 수 있는 토지피복 통계 릴리스가 없어 이 레이어를 켤 수 없습니다. 토지피복이 없다는 뜻은 아닙니다.",
  UNAVAILABLE:
    "토지피복 통계 레이어를 불러오지 못했습니다. 토지피복이 없다는 뜻은 아니며, 나머지 지도 기능은 그대로 사용할 수 있습니다.",
  MALFORMED:
    "토지피복 통계 릴리스 응답을 해석할 수 없어 레이어를 표시하지 않습니다. 토지피복이 없다는 뜻은 아니며, 불완전한 값을 대신 표시하지 않습니다.",
};

// --------------------------------------------------------------------------- //
// Modes and defaults
// --------------------------------------------------------------------------- //

/** The two ways the candidate cells can be visualized. */
export const LAND_COVER_VISUALIZATION_MODES = ["coverage", "dominant"] as const;
export type LandCoverVisualizationMode = (typeof LAND_COVER_VISUALIZATION_MODES)[number];

/** Korean labels for the visualization-mode control. */
export const LAND_COVER_MODE_LABELS: Record<LandCoverVisualizationMode, string> = {
  coverage: "평가 범위",
  dominant: "우세 분류",
};

/** Coverage-status visibility, one flag per status. */
export type LandCoverCoverageVisibility = Record<LandCoverCoverageStatus, boolean>;

/** The three statuses in their canonical order (most to least evaluated). */
export const LAND_COVER_COVERAGE_STATUSES: readonly LandCoverCoverageStatus[] = [
  "COMPLETE_EXACT",
  "PARTIAL",
  "NO_COVERAGE",
];

/** All three coverage statuses enabled — the layer's documented default. */
export function defaultCoverageVisibility(): LandCoverCoverageVisibility {
  return { COMPLETE_EXACT: true, PARTIAL: true, NO_COVERAGE: true };
}

/**
 * Explicitly-hidden dominant-class codes, per hierarchy level.
 *
 * Stored as HIDDEN rather than visible so a class first seen after a pan defaults to
 * visible: the map never silently drops a class the reader has not decided about.
 */
export type LandCoverHiddenClasses = Record<ClassLevel, string[]>;

/** Nothing hidden at any level — the layer's documented default. */
export function defaultHiddenClasses(): LandCoverHiddenClasses {
  return { 1: [], 2: [], 3: [] };
}

/** One official class as offered by the legend/filter list. */
export interface LandCoverClassOption {
  /** Official source class code, verbatim. */
  code: string;
  /** Official source Korean class name, verbatim. */
  name: string;
}

/** The classes actually observed in the loaded tiles, per level. */
export type LandCoverAvailableClasses = Record<ClassLevel, LandCoverClassOption[]>;

export function emptyAvailableClasses(): LandCoverAvailableClasses {
  return { 1: [], 2: [], 3: [] };
}

/** Tile property names carrying the dominant class at each level. */
export const DOMINANT_CODE_PROPERTY: Record<ClassLevel, string> = {
  1: "dominant_l1_code",
  2: "dominant_l2_code",
  3: "dominant_l3_code",
};
export const DOMINANT_NAME_PROPERTY: Record<ClassLevel, string> = {
  1: "dominant_l1_name",
  2: "dominant_l2_name",
  3: "dominant_l3_name",
};

// --------------------------------------------------------------------------- //
// Coverage-status treatment
// --------------------------------------------------------------------------- //

/**
 * Coverage-mode fill colors. Three visually distinct treatments, and color is never
 * the only distinction: each status also carries its own legend label, its machine
 * status in secondary text, a different outline treatment, and a different opacity.
 *
 * `NO_COVERAGE` is a NEUTRAL desaturated grey — deliberately not green, not white,
 * and not a "clear" treatment — because it must never read as empty, available,
 * safe, low-risk, or suitable land. It only means the acquired release did not
 * evaluate that cell.
 */
export const LAND_COVER_COVERAGE_COLORS: Record<LandCoverCoverageStatus, string> = {
  COMPLETE_EXACT: "#2a7f62", // evaluated end to end — a solid, saturated teal-green
  PARTIAL: "#a4552b", // partly evaluated — a distinctly darker/browner tone than the
  //                     suitability review amber (#e8a33d), so the two never blur
  NO_COVERAGE: "#8d93a0", // not evaluated — neutral grey, no availability meaning
};

/** Outline color per status, matching the per-status line layers. */
export const LAND_COVER_COVERAGE_OUTLINE_COLORS: Record<LandCoverCoverageStatus, string> = {
  COMPLETE_EXACT: "#1d5a46",
  PARTIAL: "#7a3d1f",
  NO_COVERAGE: "#6b7280",
};

/** Korean legend label per status, always carrying the machine status separately. */
export const LAND_COVER_COVERAGE_LEGEND_LABELS: Record<LandCoverCoverageStatus, string> = {
  COMPLETE_EXACT: "격자 전체 평가",
  PARTIAL: "격자 일부만 평가",
  NO_COVERAGE: "격자 미평가",
};

/**
 * The one-line meaning shown beneath each legend row. The `NO_COVERAGE` line is the
 * required semantic warning: it states what the status does NOT mean, so a grey cell
 * can never be read as empty or suitable land.
 */
export const LAND_COVER_COVERAGE_LEGEND_NOTES: Record<LandCoverCoverageStatus, string> = {
  COMPLETE_EXACT: "확보된 자료가 이 격자를 빈 곳 없이 평가했습니다.",
  PARTIAL: "확보된 자료가 이 격자의 일부만 평가했습니다. 우세 분류는 평가된 부분만 설명합니다.",
  NO_COVERAGE:
    "확보된 자료의 범위가 이 격자를 평가하지 않았습니다. 토지피복이 없거나, 비어 있거나, 이용되지 않는 땅이라는 뜻이 아니며, 적합하거나 안전하다는 뜻도 아닙니다.",
};

/** Fill color for a cell that has no dominant class at the active level. */
export const LAND_COVER_NO_CLASS_COLOR = LAND_COVER_COVERAGE_COLORS.NO_COVERAGE;

/**
 * Fallback fill for a served class code the palette rule cannot parse. It is a real
 * served class rendered in a neutral tone — NOT an invented "unknown" category, and
 * the legend still shows the official code and name beside it.
 */
export const LAND_COVER_UNPARSED_CLASS_COLOR = "#7c8593";

// --------------------------------------------------------------------------- //
// Deterministic class palette
// --------------------------------------------------------------------------- //

/**
 * Hue per leading code character (digits 0–9), well separated around the wheel.
 *
 * This is a deterministic rendering of the CODE SPACE, not a claim about the official
 * hierarchy: codes sharing a leading digit simply receive related hues, which is what
 * keeps a 34-entry 세분류 legend readable. No hue asserts suitability, risk, legality,
 * or availability.
 */
const FAMILY_HUES = [180, 25, 50, 135, 95, 280, 330, 205, 310, 65] as const;

/**
 * Lightness/saturation lattices indexed by the code's remaining digits.
 *
 * Ordered so index 0 lands mid-lightness and vividly saturated: every 대분류 code ends
 * in "00", so the seven L1 classes get the most legible point of the lattice. Two
 * distinct codes in the same family always differ in at least one index, so they can
 * never collide on the same color.
 */
const LIGHTNESS_STEPS = [50, 38, 62, 44, 68, 32, 56, 72, 41, 65] as const;
const SATURATION_STEPS = [70, 52, 88, 60, 80, 45, 64, 92, 56, 76] as const;

/** FNV-1a over a string — only for codes that do not match the numeric shape. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** HSL → #rrggbb, so every produced color is a plain deterministic hex string. */
export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((hue % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  const channel = (v: number) =>
    Math.round(Math.min(255, Math.max(0, (v + m) * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r1)}${channel(g1)}${channel(b1)}`;
}

/**
 * The deterministic color of one official land-cover class code.
 *
 * A PURE function of the code string, which is the property the map depends on: the
 * same code renders identically for the whole session (and across sessions), whichever
 * tiles are loaded and whichever other classes are visible. Two distinct codes of the
 * standard three-digit shape can never share a color — the leading digit picks the
 * hue, and the remaining two digits index independent lightness/saturation lattices.
 *
 * A code that does not match that shape still gets a stable color, derived from a hash
 * of the whole string, rather than being dropped or merged into another class.
 */
export function landCoverClassColor(code: string): string {
  const trimmed = code.trim();
  if (/^\d{3}$/.test(trimmed)) {
    const hue = FAMILY_HUES[Number(trimmed[0])];
    const lightness = LIGHTNESS_STEPS[Number(trimmed[1])];
    const saturation = SATURATION_STEPS[Number(trimmed[2])];
    return hslToHex(hue, saturation, lightness);
  }
  if (trimmed === "") return LAND_COVER_UNPARSED_CLASS_COLOR;
  const hash = fnv1a(trimmed);
  return hslToHex(hash % 360, 45 + (hash % 5) * 10, 36 + ((hash >>> 8) % 5) * 8);
}

// --------------------------------------------------------------------------- //
// Class collection from loaded tiles
// --------------------------------------------------------------------------- //

/**
 * The distinct official classes present in a set of loaded tile features, per level.
 *
 * The filter/legend vocabulary is taken from what the ACTIVE RELEASE actually served
 * into the currently-loaded tiles — never from a hardcoded class list, so the UI can
 * neither invent a class the release does not contain nor omit one it does. Ordering
 * is by official class code ascending, so the list is deterministic and stable.
 *
 * A feature with no dominant class at a level (every `NO_COVERAGE` cell) contributes
 * nothing at that level: uncovered area is not a class.
 */
export function collectAvailableClasses(
  features: readonly { properties?: Record<string, unknown> | null }[],
): LandCoverAvailableClasses {
  const perLevel: Record<ClassLevel, Map<string, string>> = { 1: new Map(), 2: new Map(), 3: new Map() };
  for (const feature of features) {
    const props = feature.properties;
    if (!props) continue;
    for (const level of CLASS_LEVELS) {
      const code = props[DOMINANT_CODE_PROPERTY[level]];
      const name = props[DOMINANT_NAME_PROPERTY[level]];
      if (typeof code !== "string" || code === "") continue;
      if (perLevel[level].has(code)) continue;
      perLevel[level].set(code, typeof name === "string" && name !== "" ? name : code);
    }
  }
  const result = emptyAvailableClasses();
  for (const level of CLASS_LEVELS) {
    result[level] = [...perLevel[level].entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }
  return result;
}

/**
 * Merge newly-observed classes into the known set, preserving official code order.
 *
 * Panning loads more tiles, which can only ever ADD classes. Merging (rather than
 * replacing) means a class does not vanish from the legend the moment it scrolls out
 * of the viewport, and the merge is order-independent, so the list is deterministic.
 */
export function mergeAvailableClasses(
  previous: LandCoverAvailableClasses,
  next: LandCoverAvailableClasses,
): LandCoverAvailableClasses {
  const merged = emptyAvailableClasses();
  let changed = false;
  for (const level of CLASS_LEVELS) {
    const byCode = new Map(previous[level].map((option) => [option.code, option]));
    for (const option of next[level]) {
      if (!byCode.has(option.code)) {
        byCode.set(option.code, option);
        changed = true;
      }
    }
    merged[level] = [...byCode.values()].sort((a, b) =>
      a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
    );
  }
  // Identity is preserved when nothing was added, so a caller can skip a re-render.
  return changed ? merged : previous;
}

// --------------------------------------------------------------------------- //
// MapLibre paint expressions
// --------------------------------------------------------------------------- //

type Expression = unknown[];

/**
 * Fill color for the active visualization mode.
 *
 * Coverage mode matches the three statuses. Dominant-class mode matches the official
 * code at the active level, with an explicit prior branch for cells that carry no
 * dominant class — those keep the unevaluated treatment instead of being assigned to
 * an invented category.
 */
export function landCoverFillColor(
  mode: LandCoverVisualizationMode,
  level: ClassLevel,
  classes: readonly LandCoverClassOption[],
): Expression {
  if (mode === "coverage") {
    return [
      "match",
      ["get", "coverage_status"],
      "COMPLETE_EXACT",
      LAND_COVER_COVERAGE_COLORS.COMPLETE_EXACT,
      "PARTIAL",
      LAND_COVER_COVERAGE_COLORS.PARTIAL,
      "NO_COVERAGE",
      LAND_COVER_COVERAGE_COLORS.NO_COVERAGE,
      LAND_COVER_UNPARSED_CLASS_COLOR,
    ];
  }
  const property = DOMINANT_CODE_PROPERTY[level];
  // MapLibre's "match" requires at least one label/output pair, so with no class yet
  // observed the expression degrades to the two explicit branches.
  if (classes.length === 0) {
    return ["case", ["has", property], LAND_COVER_UNPARSED_CLASS_COLOR, LAND_COVER_NO_CLASS_COLOR];
  }
  const match: Expression = ["match", ["get", property]];
  for (const option of classes) {
    match.push(option.code, landCoverClassColor(option.code));
  }
  match.push(LAND_COVER_UNPARSED_CLASS_COLOR);
  return ["case", ["!", ["has", property]], LAND_COVER_NO_CLASS_COLOR, match];
}

/**
 * Fill opacity by coverage status, in BOTH modes.
 *
 * A second, non-color channel for the same distinction: an unevaluated cell is the
 * faintest, a partly-evaluated cell sits between, and a fully-evaluated cell is the
 * most solid. Kept below 1 so the suitability grid underneath stays perceptible.
 */
export function landCoverFillOpacity(): Expression {
  return [
    "case",
    ["==", ["get", "coverage_status"], "NO_COVERAGE"],
    0.34,
    ["==", ["get", "coverage_status"], "PARTIAL"],
    0.6,
    0.72,
  ];
}

// --------------------------------------------------------------------------- //
// MapLibre filters
// --------------------------------------------------------------------------- //

/** The enabled coverage statuses, in canonical order. */
export function visibleCoverageStatuses(
  coverage: LandCoverCoverageVisibility,
): LandCoverCoverageStatus[] {
  return LAND_COVER_COVERAGE_STATUSES.filter((status) => coverage[status]);
}

/**
 * The MapLibre filter for the land-cover layers.
 *
 * Filter semantics, stated once and asserted by the unit tests:
 *
 *  - **Within the coverage group: OR.** A cell is kept when its status is any of the
 *    enabled statuses.
 *  - **Within the dominant-class group: OR.** A cell is kept when its dominant class at
 *    the ACTIVE level is any of the not-hidden classes.
 *  - **Between the two groups: AND.** Both conditions must hold.
 *  - **A cell with no dominant class is governed by the coverage group alone.** Every
 *    `NO_COVERAGE` cell has no dominant class at any level; making the class group
 *    exclude it would delete it from the map the moment any class was unchecked, which
 *    would silently hide a real state rather than filter a class.
 *  - **Class filtering applies only in dominant-class mode**, which is the only mode
 *    that offers the class list — so the legend always describes what the map is doing.
 */
export function landCoverFilter(
  mode: LandCoverVisualizationMode,
  level: ClassLevel,
  coverage: LandCoverCoverageVisibility,
  hiddenClassCodes: readonly string[],
): Expression {
  const statusIn: Expression = [
    "in",
    ["get", "coverage_status"],
    ["literal", visibleCoverageStatuses(coverage)],
  ];
  if (mode !== "dominant" || hiddenClassCodes.length === 0) return statusIn;
  const property = DOMINANT_CODE_PROPERTY[level];
  const classClause: Expression = [
    "any",
    ["!", ["has", property]],
    ["!", ["in", ["get", property], ["literal", [...hiddenClassCodes]]]],
  ];
  return ["all", statusIn, classClause];
}

/** AND a per-status outline filter with the layer-wide filter. */
export function landCoverStatusOutlineFilter(
  status: LandCoverCoverageStatus,
  base: Expression,
): Expression {
  return ["all", base, ["==", ["get", "coverage_status"], status]];
}

/**
 * True when the current filters select no cell at all.
 *
 * Surfaced to the reader as an explicit "no cells selected" state rather than being
 * silently reverted to "show everything" — a reader must never be shown all cells
 * while believing a filter is applied.
 *
 * Two ways to select nothing, matching {@link landCoverFilter} exactly: no coverage
 * status enabled, or (in dominant-class mode) every class observed so far hidden AND
 * `NO_COVERAGE` disabled — because cells with no dominant class are exempt from the
 * class group, so a visible `NO_COVERAGE` keeps the map non-empty. "Observed so far"
 * is the honest basis: the vocabulary comes from loaded tiles, so this reports the
 * selection over what is actually known, never over an assumed full vocabulary.
 */
export function landCoverSelectionEmpty(
  mode: LandCoverVisualizationMode,
  level: ClassLevel,
  coverage: LandCoverCoverageVisibility,
  available: LandCoverAvailableClasses,
  hiddenClassCodes: readonly string[],
): boolean {
  if (visibleCoverageStatuses(coverage).length === 0) return true;
  if (mode !== "dominant") return false;
  const options = available[level];
  if (options.length === 0) return false;
  const hidden = new Set(hiddenClassCodes);
  if (!options.every((option) => hidden.has(option.code))) return false;
  return !coverage.NO_COVERAGE;
}

// --------------------------------------------------------------------------- //
// Dynamic legend
// --------------------------------------------------------------------------- //

/**
 * One legend row. `label` is the Korean user-facing text and `secondary` carries the
 * machine status or the official class code, so status/class is never conveyed by
 * color alone.
 */
export interface LandCoverLegendEntry {
  key: string;
  color: string;
  label: string;
  secondary: string;
  /** Longer explanation; the `NO_COVERAGE` row's is the required semantic warning. */
  note?: string;
  /** Whether this row is currently drawn on the map (drives the filter checkbox). */
  visible: boolean;
}

/**
 * The legend rows for the CURRENT mode, level and filters.
 *
 * Derived from the same values the map's paint and filter expressions are built from,
 * so the legend cannot describe styling the map is not applying. Class rows come only
 * from classes actually served into the loaded tiles — the frontend never adds a class
 * of its own, and never adds an "Unknown"/"기타" bucket for uncovered cells.
 */
export function landCoverLegendEntries(
  mode: LandCoverVisualizationMode,
  level: ClassLevel,
  coverage: LandCoverCoverageVisibility,
  available: LandCoverAvailableClasses,
  hiddenClassCodes: readonly string[],
): LandCoverLegendEntry[] {
  if (mode === "coverage") {
    return LAND_COVER_COVERAGE_STATUSES.map((status) => ({
      key: status,
      color: LAND_COVER_COVERAGE_COLORS[status],
      label: LAND_COVER_COVERAGE_LEGEND_LABELS[status],
      secondary: status,
      note: LAND_COVER_COVERAGE_LEGEND_NOTES[status],
      visible: coverage[status],
    }));
  }
  const hidden = new Set(hiddenClassCodes);
  return available[level].map((option) => ({
    key: option.code,
    color: landCoverClassColor(option.code),
    label: option.name,
    secondary: option.code,
    visible: !hidden.has(option.code),
  }));
}
