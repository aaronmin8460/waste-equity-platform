import { frequencyLabelKo, UNKNOWN_FREQUENCY_LABEL } from "./dataSources";

/**
 * Choropleth metric definitions, legend breaks, and display formatting.
 *
 * Metrics are served values only — regional population and per-stream RCIS
 * waste generation as stored — never client-side derived aggregates. Numeric
 * coercion of the exact decimal strings happens only for color scaling;
 * displayed values are formatted from the original strings.
 */

export type MetricKey =
  | "population"
  | "HOUSEHOLD"
  | "BUSINESS_NON_FACILITY"
  | "INDUSTRIAL_FACILITY"
  | "CONSTRUCTION"
  | "PER_CAPITA_HOUSEHOLD"
  | "PER_CAPITA_BUSINESS_NON_FACILITY"
  | "PER_CAPITA_INDUSTRIAL_FACILITY"
  | "PER_CAPITA_CONSTRUCTION"
  | "FACILITY_BURDEN_LOCATED"
  | "FACILITY_BURDEN_5KM";

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  // "waste-per-capita" and "facility-burden" metrics are BACKEND-derived
  // (Phase 5.1/5.2); the client still renders served values only.
  dataset: "population" | "waste-statistics" | "waste-per-capita" | "facility-burden";
  // Which map geometry this metric renders on. "native" = SGIS regions
  // (population, facility burden, native browsing). "reporting" = RCIS
  // source-compatible geometry where the seven Gyeonggi cities RCIS reports at
  // city level appear once each (waste generation and per-capita waste).
  geography: "native" | "reporting";
  wasteStream?: string;
  /** Which served facility-burden measure this metric displays. */
  burdenMeasure?: "located" | "buffer";
  /** Extra interpretation caveat rendered with the metric metadata. */
  caveat?: string;
}

const NON_RESIDENTIAL_CAVEAT =
  "사업장·건설 폐기물은 지역 내 사업장/현장 활동으로 발생하므로 주민 1인당 값 해석에 주의가 필요합니다.";

const FACILITY_BURDEN_CAVEAT =
  "시설 소재지 기준 처리량(시설이 처리한 양)이므로, 발생지 기준(지역에서 배출된 양) " +
  "폐기물 통계와 합산하거나 비교할 수 없습니다.";

// Metric labels are PRIMARY citizen UI: plain Korean, no English parenthetical.
// The technical stream/measure name stays in the source/method provenance panels.
export const METRICS: MetricDefinition[] = [
  {
    key: "population",
    label: "인구",
    dataset: "population",
    geography: "native",
  },
  {
    key: "HOUSEHOLD",
    label: "생활계 폐기물 발생량",
    dataset: "waste-statistics",
    geography: "reporting",
    wasteStream: "HOUSEHOLD",
  },
  {
    key: "BUSINESS_NON_FACILITY",
    label: "사업장(비배출시설계) 발생량",
    dataset: "waste-statistics",
    geography: "reporting",
    wasteStream: "BUSINESS_NON_FACILITY",
  },
  {
    key: "INDUSTRIAL_FACILITY",
    label: "사업장(배출시설계) 발생량",
    dataset: "waste-statistics",
    geography: "reporting",
    wasteStream: "INDUSTRIAL_FACILITY",
  },
  {
    key: "CONSTRUCTION",
    label: "건설 폐기물 발생량",
    dataset: "waste-statistics",
    geography: "reporting",
    wasteStream: "CONSTRUCTION",
  },
  {
    key: "PER_CAPITA_HOUSEHOLD",
    label: "1인당 생활계 발생량",
    dataset: "waste-per-capita",
    geography: "reporting",
    wasteStream: "HOUSEHOLD",
  },
  {
    key: "PER_CAPITA_BUSINESS_NON_FACILITY",
    label: "1인당 사업장(비배출시설계)",
    dataset: "waste-per-capita",
    geography: "reporting",
    wasteStream: "BUSINESS_NON_FACILITY",
    caveat: NON_RESIDENTIAL_CAVEAT,
  },
  {
    key: "PER_CAPITA_INDUSTRIAL_FACILITY",
    label: "1인당 사업장(배출시설계)",
    dataset: "waste-per-capita",
    geography: "reporting",
    wasteStream: "INDUSTRIAL_FACILITY",
    caveat: NON_RESIDENTIAL_CAVEAT,
  },
  {
    key: "PER_CAPITA_CONSTRUCTION",
    label: "1인당 건설 폐기물",
    dataset: "waste-per-capita",
    geography: "reporting",
    wasteStream: "CONSTRUCTION",
    caveat: NON_RESIDENTIAL_CAVEAT,
  },
  {
    key: "FACILITY_BURDEN_LOCATED",
    label: "1인당 소재 시설 처리량",
    dataset: "facility-burden",
    geography: "native",
    burdenMeasure: "located",
    caveat: FACILITY_BURDEN_CAVEAT,
  },
  {
    key: "FACILITY_BURDEN_5KM",
    label: "1인당 인근 5km 시설 처리량",
    dataset: "facility-burden",
    geography: "native",
    burdenMeasure: "buffer",
    caveat: FACILITY_BURDEN_CAVEAT,
  },
];

// --------------------------------------------------------------------------- //
// 지표 선택 — the citizen-facing presentation of the eleven metrics above
// --------------------------------------------------------------------------- //

/**
 * PRESENTATION ONLY. Nothing below adds, merges, renames, or derives a metric: every
 * `MetricKey` here is one of the eleven served metrics declared above, and each is
 * reachable through exactly one (row, mode) pair. Removing this block would change
 * how the selector looks and nothing about what any map, ranking, or export shows.
 *
 * The correction pass replaced a flat eleven-radio list grouped by STATISTICAL FAMILY
 * (총량 / 1인당 / 시설 부담) with the citizen question the redesign asked for: pick a
 * SUBJECT first (population · waste generated · facility throughput), then — where
 * both exist — pick how it is counted (총량 or 1인당). That is the same eleven
 * metrics re-cut, which is why a category row carries its two keys explicitly rather
 * than deriving one from the other by string surgery.
 *
 * ── WHY 생활계 AND 사업장 ARE FOUR ROWS, NOT TWO ─────────────────────────────────
 * The reference design showed three waste rows, with 생활계 annotated "생활 +
 * 비배출계". Korean waste statistics do define 생활계폐기물 that way — but this
 * platform ingests the two components as SEPARATE official series (RCIS `NTN007`
 * 생활(가정)폐기물 → `HOUSEHOLD`, `NTN008` 사업장비배출시설계폐기물 →
 * `BUSINESS_NON_FACILITY`; docs/API_CONTRACTS/waste_statistics.md), and the backend
 * serves no combined figure. Adding the two in the browser would manufacture a
 * statistic no source published — the one thing `AGENTS.md` and the redesign spec
 * §11 forbid outright — and dropping either row would hide a real official series.
 * So both are offered, each labelled with the stream it actually is.
 */
export type MetricSectionKey = "population" | "generation" | "facility";

/** How a category is counted. Both keys must be real served metrics. */
export type MetricMode = "total" | "perCapita";

/**
 * The 총량/1인당 switch labels.
 *
 * "총량", not "총 인구": the reference design's segment read 총 인구 (= total
 * POPULATION), which is the subject of the first section, not the measure of a waste
 * tonnage. Printing it over 생활계 폐기물 발생량 would name the metric something it is
 * not, so the honest word for "the absolute served quantity" is used instead. The
 * behaviour is exactly what the design asked for: the left segment selects the
 * category's absolute metric, the right one its per-capita metric.
 */
export const METRIC_MODE_LABELS: Record<MetricMode, string> = {
  total: "총량",
  perCapita: "1인당",
};

export interface MetricRow {
  /** Stable row identity — the radio's value. NOT a metric key. */
  key: string;
  /** Citizen-facing row label. */
  label: string;
  /** One supporting line, or nothing. Never a claim the data does not support. */
  description?: string;
  /** The served metric this row shows in 총량 mode (and its only metric when
   *  `perCapita` is absent). */
  total: MetricKey;
  /** The served per-capita counterpart, when one exists. Absent ⇒ no mode switch. */
  perCapita?: MetricKey;
}

export interface MetricSection {
  key: MetricSectionKey;
  /** The `<legend>` of this section's `<fieldset>`. */
  title: string;
  description?: string;
  rows: readonly MetricRow[];
}

export const METRIC_SECTIONS: readonly MetricSection[] = [
  {
    key: "population",
    title: "지역별 인구",
    rows: [
      {
        key: "population",
        label: "지역별 인구",
        // No description. "선택 지역의 총 인구를 확인합니다." restated the label as a
        // sentence — the row is already named 지역별 인구, inside a section named
        // 지역별 인구, and the unit and reference year are stated by the selected-metric
        // summary. A helper line that adds no fact is a line the reader learns to skip.
        total: "population",
      },
    ],
  },
  {
    key: "generation",
    title: "폐기물 발생량",
    // No group description. It restated the heading in a sentence ("선택 지역에서
    // 발생하는 폐기물의 양을 확인합니다.") and carried no distinction the four row
    // labels below do not already make. The ROW descriptions stay: they say which
    // official series each row is, which is not readable from the label alone.
    rows: [
      {
        key: "household",
        // This row is the 생활(가정) series ALONE — the 비배출시설계 component is the
        // next row, as its own official series. That distinction is carried by the two
        // row labels standing next to each other, so the sentence that used to spell it
        // out ("생활(가정) 폐기물. 사업장 비배출시설계는 아래에서 따로 봅니다.") is gone.
        // The Figma frame agrees: it labels this row without a helper line.
        label: "생활계 폐기물 발생량",
        total: "HOUSEHOLD",
        perCapita: "PER_CAPITA_HOUSEHOLD",
      },
      {
        key: "business_non_facility",
        label: "사업장 폐기물 발생량 (비배출시설계)",
        total: "BUSINESS_NON_FACILITY",
        perCapita: "PER_CAPITA_BUSINESS_NON_FACILITY",
      },
      {
        key: "industrial_facility",
        label: "사업장 폐기물 발생량 (배출시설계)",
        total: "INDUSTRIAL_FACILITY",
        perCapita: "PER_CAPITA_INDUSTRIAL_FACILITY",
      },
      {
        key: "construction",
        label: "건설 폐기물 발생량",
        total: "CONSTRUCTION",
        perCapita: "PER_CAPITA_CONSTRUCTION",
      },
    ],
  },
  {
    key: "facility",
    title: "1인당 시설 처리 수준",
    // No descriptions on either row. "선택 지역 내 시설의 처리량" and "선택 지역 5km
    // 이내 시설의 처리량" only re-spelled the labels 소재 시설 / 인근 5km — the two
    // labels already carry the one distinction that decides which row a reader wants,
    // and the selected-metric summary states the scope in full.
    rows: [
      {
        key: "facility_located",
        label: "소재 시설 처리량",
        // Both facility-burden metrics are ALREADY per-capita as served (their
        // labels say 1인당), which is why this section carries no mode switch —
        // there is no absolute counterpart to switch to.
        total: "FACILITY_BURDEN_LOCATED",
      },
      {
        key: "facility_5km",
        label: "인근 5km 시설 처리량",
        total: "FACILITY_BURDEN_5KM",
      },
    ],
  },
] as const;

/** Every row, flattened — used for lookups, never for display order decisions. */
const ALL_ROWS: readonly MetricRow[] = METRIC_SECTIONS.flatMap((section) => section.rows);

/** The row a metric belongs to, and the mode it is shown in. */
export function findMetricRow(key: MetricKey): { row: MetricRow; mode: MetricMode } | null {
  for (const row of ALL_ROWS) {
    if (row.total === key) return { row, mode: "total" };
    if (row.perCapita === key) return { row, mode: "perCapita" };
  }
  return null;
}

/**
 * The served metric for a row in a mode, falling back to the row's absolute metric
 * when it has no per-capita counterpart. Never returns a key that is not served.
 */
export function metricKeyFor(row: MetricRow, mode: MetricMode): MetricKey {
  return mode === "perCapita" && row.perCapita ? row.perCapita : row.total;
}

// --------------------------------------------------------------------------- //
// Choropleth scale configuration (metric-aware classification + palette)
// --------------------------------------------------------------------------- //

/**
 * How a metric's values are split into color classes.
 *  - "quantile": equal-count breaks; good for roughly-uniform equity metrics.
 *  - "log-equal-interval": equal intervals in log1p space; needed for the
 *    strongly right-skewed facility-burden metrics, where plain quantiles
 *    collapse very different upper-tail magnitudes into one class.
 */
export type ChoroplethScaleMethod = "quantile" | "log-equal-interval";

/** Explicit, per-metric classification policy — never inferred from a palette. */
export interface ChoroplethScaleConfig {
  method: ChoroplethScaleMethod;
  /** Requested number of color classes (palette must have at least this many). */
  classes: number;
  palette: readonly string[];
}

// Colorblind-safe sequential blue palettes (light -> dark), no duplicate stops.
// DEFAULT_EQUITY_PALETTE_7 / FACILITY_BURDEN_PALETTE_9 are ColorBrewer "Blues".

/** 7-step ColorBrewer Blues — standard equity metrics (population, waste, per-capita). */
export const DEFAULT_EQUITY_PALETTE_7 = [
  "#eff3ff",
  "#c6dbef",
  "#9ecae1",
  "#6baed6",
  "#4292c6",
  "#2171b5",
  "#084594",
] as const;

/** 9-step ColorBrewer Blues — facility-burden metrics (wide, skewed magnitudes). */
export const FACILITY_BURDEN_PALETTE_9 = [
  "#f7fbff",
  "#deebf7",
  "#c6dbef",
  "#9ecae1",
  "#6baed6",
  "#4292c6",
  "#2171b5",
  "#08519c",
  "#08306b",
] as const;

/**
 * 5-step ColorBrewer PuBu — suitability candidate scores ONLY. Kept identical to
 * the historical candidate palette so suitability rendering is unchanged; the
 * region choropleth must never inherit this palette.
 */
export const CANDIDATE_SCORE_PALETTE_5 = [
  "#f1eef6",
  "#bdc9e1",
  "#74a9cf",
  "#2b8cbe",
  "#045a8d",
] as const;

/**
 * Stable, deterministic interior thresholds for the suitability score domain
 * (a fixed 0–100 scale), splitting it into five equal 20-point classes
 * (0–20 · 20–40 · 40–60 · 60–80 · 80–100). These are intentionally NOT computed
 * from whichever candidates happen to be on screen: the map now serves the whole
 * grid as vector tiles, and per-viewport quantiles would recolor identical cells
 * as the user panned. Sized to CANDIDATE_SCORE_PALETTE_5 (five colors).
 */
export const CANDIDATE_SCORE_BREAKS: readonly number[] = [20, 40, 60, 80];

export const NO_DATA_COLOR = "#d9d9d9";

/**
 * Suitability candidate STATUS colors, shared by the MapLibre candidate fill
 * (MapView) and the floating suitability legend (MapLegendOverlay) so the map and
 * the legend can never show different colors for the same status. Eligible cells
 * are score-shaded with CANDIDATE_SCORE_PALETTE_5; these two are the non-score
 * statuses. Kept identical to the historical MapView values.
 */
export const CANDIDATE_REVIEW_COLOR = "#e8a33d";
export const CANDIDATE_EXCLUDED_COLOR = "#9aa2ad";

/**
 * Outline color for STABLE eligible candidates (stable across baseline/equal/
 * critic). A strong, saturated magenta that stays distinguishable from the amber
 * review dashed outline, the blue selected-candidate highlight, and the grey base
 * boundaries. Stability is always also labelled with text — never color alone.
 */
export const CANDIDATE_STABLE_OUTLINE_COLOR = "#d81b60";

/** Resolve the explicit classification policy for a metric. */
export function scaleConfigForMetric(metric: MetricDefinition): ChoroplethScaleConfig {
  if (metric.dataset === "facility-burden") {
    // FACILITY_BURDEN_LOCATED / FACILITY_BURDEN_5KM: right-skewed magnitudes.
    return { method: "log-equal-interval", classes: 9, palette: FACILITY_BURDEN_PALETTE_9 };
  }
  // population, waste-statistics, waste-per-capita.
  return { method: "quantile", classes: 7, palette: DEFAULT_EQUITY_PALETTE_7 };
}

/**
 * Quantile breaks splitting the observed values into `classes` equal-count
 * classes. Returns the interior thresholds (length = classes - 1), deduplicated
 * and kept strictly increasing for degenerate distributions.
 */
export function computeBreaks(values: number[], classes: number): number[] {
  if (values.length === 0 || classes < 2) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const thresholds: number[] = [];
  for (let step = 1; step < classes; step += 1) {
    const position = (step * (sorted.length - 1)) / classes;
    const value = sorted[Math.round(position)];
    if (thresholds.length === 0 || value > thresholds[thresholds.length - 1]) {
      thresholds.push(value);
    }
  }
  return thresholds;
}

/**
 * Equal-interval breaks computed in log1p space, for strongly right-skewed,
 * non-negative distributions (facility burden). Thresholds are
 * `expm1(log1p(max) * step / classes)` for step 1..classes-1.
 *
 * Robustness contract:
 *  - only finite, non-negative values are classified (NaN/Infinity/negatives
 *    are ignored rather than producing invalid MapLibre expressions);
 *  - zero is a valid value (0 kg/capita is a real measurement, not no-data);
 *  - no valid values, or max <= 0, yields no breaks;
 *  - thresholds are strictly increasing and finite (deduplicated only when a
 *    degenerate distribution or floating point would otherwise repeat one).
 */
export function computeLogEqualIntervalBreaks(values: number[], classes: number): number[] {
  if (classes < 2) return [];
  const finite = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (finite.length === 0) return [];
  const max = Math.max(...finite);
  if (!(max > 0)) return [];
  const logMax = Math.log1p(max);
  const thresholds: number[] = [];
  for (let step = 1; step < classes; step += 1) {
    const threshold = Math.expm1((logMax * step) / classes);
    if (
      Number.isFinite(threshold) &&
      (thresholds.length === 0 || threshold > thresholds[thresholds.length - 1])
    ) {
      thresholds.push(threshold);
    }
  }
  return thresholds;
}

/**
 * The single resolved scale that drives BOTH the map fill expression and the
 * legend. `palette` is sized to the effective number of classes so map colors,
 * legend swatches, and legend labels can never disagree.
 */
export interface ActiveScale {
  method: ChoroplethScaleMethod;
  /** Class count requested by the metric's policy. */
  requestedClasses: number;
  /** Class count actually rendered (breaks.length + 1 after dedup). */
  effectiveClasses: number;
  breaks: number[];
  palette: readonly string[];
}

/** Resolve the one active scale (breaks + palette) for the observed values. */
export function resolveActiveScale(values: number[], config: ChoroplethScaleConfig): ActiveScale {
  const breaks =
    config.method === "log-equal-interval"
      ? computeLogEqualIntervalBreaks(values, config.classes)
      : computeBreaks(values, config.classes);
  const effectiveClasses = breaks.length + 1;
  return {
    method: config.method,
    requestedClasses: config.classes,
    effectiveClasses,
    // One color per rendered class; degenerate distributions use the lighter end.
    palette: config.palette.slice(0, effectiveClasses),
    breaks,
  };
}

/** Class index for a value given interior thresholds (>= threshold moves up a class). */
export function classIndexFor(value: number, breaks: number[]): number {
  let index = 0;
  for (const threshold of breaks) {
    if (value >= threshold) index += 1;
  }
  return index;
}

/** Color for a value given interior thresholds and the active palette. */
export function colorFor(value: number, breaks: number[], palette: readonly string[]): string {
  return palette[Math.min(classIndexFor(value, breaks), palette.length - 1)];
}

/**
 * Short human note describing the active classification method for the legend.
 *
 * Korean only. The English restatements (`(7-class quantiles)`,
 * `(7-class logarithmic intervals)`) were a translation of the Korean beside them,
 * not an extra fact, and they are the copy-density the Page-1 audit is after. The
 * method itself is NOT dropped: this note still prints inside the 범례 disclosure,
 * which is where a reader asks what the colour classes mean, and the full
 * derivation lives in the methodology surface.
 */
export function scaleMethodNote(scale: ActiveScale): string {
  if (scale.method === "log-equal-interval") {
    return `로그 간격 ${scale.requestedClasses}단계`;
  }
  return `분위수 ${scale.requestedClasses}단계`;
}

/**
 * Format an exact decimal string for display without changing its value:
 * thousands separators, trailing fractional zeros removed ("83721.300000"
 * → "83,721.3", "1000.000000" → "1,000").
 */
export function formatQuantity(decimalString: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimalString.trim());
  if (!match) return decimalString;
  const [, sign, integerPart, fractionPart] = match;
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (fractionPart ?? "").replace(/0+$/, "");
  return `${sign}${grouped}${fraction ? `.${fraction}` : ""}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Format a legend boundary without collapsing classes: large values round to
 * grouped integers, small values (per-capita kg ranges) keep enough decimals
 * to stay distinguishable.
 */
export function formatLegendValue(value: number): string {
  const magnitude = Math.abs(value);
  const decimals = magnitude >= 1000 ? 0 : magnitude >= 10 ? 1 : 2;
  const [integerPart, fractionPart] = value.toFixed(decimals).split(".");
  const grouped = Number(integerPart).toLocaleString("en-US");
  const fraction = (fractionPart ?? "").replace(/0+$/, "");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/**
 * Human label for a source registry publication frequency.
 *
 * Phase 7: this held a SECOND, drifting copy of the mapping Phase 6 established in
 * `lib/dataSources.ts`. The old copy returned Korean/English pairs
 * (`연간 (Annual)`) — the G3 duplication every other surface dropped — and fell
 * through to the RAW SERVED CODE for anything it did not recognise, which is the
 * same failure `perCapitaUnavailableLabel` had as Phase 0 defect X6. It now
 * delegates to the single implementation, so the two can no longer disagree.
 *
 * The served code is demoted, never deleted: `frequencyCode` below returns it for a
 * diagnostic layer, and only when it could not be translated (so a known code is
 * never echoed beside its own translation).
 */
export function frequencyLabel(publicationFrequency: string): string {
  return frequencyLabelKo(publicationFrequency) ?? UNKNOWN_FREQUENCY_LABEL;
}

/**
 * Re-exported so the one caller that needs the "no registry row at all" wording
 * takes it from the same place as the label itself — a registry-less source has no
 * frequency to translate, and must not print a literal `UNKNOWN`.
 */
export { UNKNOWN_FREQUENCY_LABEL };

/** The raw served frequency code, but ONLY when no Korean rendering exists. */
export function frequencyCode(publicationFrequency: string): string | null {
  return frequencyLabelKo(publicationFrequency) === null ? publicationFrequency : null;
}

export const FACILITY_CATEGORY_LABELS: Record<string, string> = {
  PUBLIC_INCINERATION: "공공 소각시설",
  PUBLIC_OTHER: "공공 기타 처리시설",
  PUBLIC_LANDFILL: "공공 매립시설",
  PRIVATE_INTERMEDIATE_INCINERATION: "민간 중간처분(소각)",
  PRIVATE_FINAL_DISPOSAL: "민간 최종처분",
  PRIVATE_RECYCLING: "민간 재활용",
};

export const FACILITY_CATEGORY_COLORS: Record<string, string> = {
  PUBLIC_INCINERATION: "#d95f02",
  PUBLIC_OTHER: "#7570b3",
  PUBLIC_LANDFILL: "#1b9e77",
  PRIVATE_INTERMEDIATE_INCINERATION: "#e7298a",
  PRIVATE_FINAL_DISPOSAL: "#66a61e",
  PRIVATE_RECYCLING: "#e6ab02",
};

/**
 * The Korean initial each facility category's map marker carries (Figma frame
 * 222:439 draws glyph-bearing markers: 소 · 매 · 기 · 재).
 *
 * ── ONE GLYPH PER REAL CATEGORY, AND NO CATEGORY MERGED ──────────────────────────
 * Figma shows FOUR marks. Production serves SIX categories, and two of them are
 * incineration (공공 소각시설 and 민간 중간처분(소각)), so reusing 소 for both would
 * make two distinct served categories indistinguishable at a glance — the same
 * failure as merging them. Each glyph is therefore taken from the word that makes
 * its own category unique:
 *
 *   소 소각 · 매 매립 · 기 기타 · 중 중간처분 · 최 최종처분 · 재 재활용
 *
 * All four Figma glyphs are present; 중 and 최 are the two the design had no mark
 * for because it had no row for them. Nothing here adds, renames, merges, or hides
 * a category: the keys are exactly the keys of the two maps above, and colour
 * remains the primary carrier — the glyph is a redundant second signal, and the
 * marker's popup names the category in full words either way.
 */
export const FACILITY_CATEGORY_GLYPHS: Record<string, string> = {
  PUBLIC_INCINERATION: "소",
  PUBLIC_OTHER: "기",
  PUBLIC_LANDFILL: "매",
  PRIVATE_INTERMEDIATE_INCINERATION: "중",
  PRIVATE_FINAL_DISPOSAL: "최",
  PRIVATE_RECYCLING: "재",
};

/**
 * Whether a marker glyph printed on `background` should be drawn in white or in
 * near-black, chosen by WCAG relative luminance so the character is always the
 * more legible of the two rather than a fixed colour that happens to fail on the
 * lighter categories (white on #e6ab02 is 2.1:1).
 *
 * Kept as a computation rather than a hand-written table so it cannot go stale if
 * a category colour is ever retuned.
 */
export function markerGlyphInk(background: string): string {
  const hex = background.replace("#", "");
  const channel = (offset: number): number => {
    const srgb = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  const onWhite = 1.05 / (luminance + 0.05);
  const onBlack = (luminance + 0.05) / 0.05;
  return onBlack >= onWhite ? "#000000" : "#ffffff";
}
