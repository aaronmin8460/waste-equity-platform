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
  "시설 소재지 기준 처리량(FACILITY_LOCATION_BASED_THROUGHPUT)으로, 발생지 기준 " +
  "폐기물 통계와 합산하거나 비교할 수 없습니다.";

export const METRICS: MetricDefinition[] = [
  { key: "population", label: "인구 (Population)", dataset: "population", geography: "native" },
  {
    key: "HOUSEHOLD",
    label: "생활계 폐기물 발생량 (Household waste generation)",
    dataset: "waste-statistics",
    geography: "reporting",
    wasteStream: "HOUSEHOLD",
  },
  {
    key: "BUSINESS_NON_FACILITY",
    label: "사업장 비배출시설계 발생량 (Business non-facility)",
    dataset: "waste-statistics",
    geography: "reporting",
    wasteStream: "BUSINESS_NON_FACILITY",
  },
  {
    key: "INDUSTRIAL_FACILITY",
    label: "사업장 배출시설계 발생량 (Industrial facility)",
    dataset: "waste-statistics",
    geography: "reporting",
    wasteStream: "INDUSTRIAL_FACILITY",
  },
  {
    key: "CONSTRUCTION",
    label: "건설 폐기물 발생량 (Construction waste)",
    dataset: "waste-statistics",
    geography: "reporting",
    wasteStream: "CONSTRUCTION",
  },
  {
    key: "PER_CAPITA_HOUSEHOLD",
    label: "1인당 생활계 발생량 (Household per capita) — 형평성 지표",
    dataset: "waste-per-capita",
    geography: "reporting",
    wasteStream: "HOUSEHOLD",
  },
  {
    key: "PER_CAPITA_BUSINESS_NON_FACILITY",
    label: "1인당 사업장 비배출시설계 (Business non-facility per capita)",
    dataset: "waste-per-capita",
    geography: "reporting",
    wasteStream: "BUSINESS_NON_FACILITY",
    caveat: NON_RESIDENTIAL_CAVEAT,
  },
  {
    key: "PER_CAPITA_INDUSTRIAL_FACILITY",
    label: "1인당 사업장 배출시설계 (Industrial facility per capita)",
    dataset: "waste-per-capita",
    geography: "reporting",
    wasteStream: "INDUSTRIAL_FACILITY",
    caveat: NON_RESIDENTIAL_CAVEAT,
  },
  {
    key: "PER_CAPITA_CONSTRUCTION",
    label: "1인당 건설 폐기물 (Construction per capita)",
    dataset: "waste-per-capita",
    geography: "reporting",
    wasteStream: "CONSTRUCTION",
    caveat: NON_RESIDENTIAL_CAVEAT,
  },
  {
    key: "FACILITY_BURDEN_LOCATED",
    label: "1인당 소재 시설 처리량 (Facility throughput per capita, located) — 부담 지표",
    dataset: "facility-burden",
    geography: "native",
    burdenMeasure: "located",
    caveat: FACILITY_BURDEN_CAVEAT,
  },
  {
    key: "FACILITY_BURDEN_5KM",
    label: "1인당 인근 5km 시설 처리량 (Facility throughput per capita, within 5 km)",
    dataset: "facility-burden",
    geography: "native",
    burdenMeasure: "buffer",
    caveat: FACILITY_BURDEN_CAVEAT,
  },
];

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

/** Short human note describing the active classification method for the legend. */
export function scaleMethodNote(scale: ActiveScale): string {
  if (scale.method === "log-equal-interval") {
    return `로그 간격 ${scale.requestedClasses}단계 (${scale.requestedClasses}-class logarithmic intervals)`;
  }
  return `분위수 ${scale.requestedClasses}단계 (${scale.requestedClasses}-class quantiles)`;
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

/** Human label for a source registry publication frequency. */
export function frequencyLabel(publicationFrequency: string): string {
  switch (publicationFrequency) {
    case "ANNUAL":
      return "연간 (Annual)";
    case "MONTHLY":
      return "월간 (Monthly)";
    case "REAL_TIME":
      return "실시간 (Real-time)";
    case "STRUCTURAL":
      return "수시 갱신 (Periodically updated)";
    default:
      return publicationFrequency;
  }
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
