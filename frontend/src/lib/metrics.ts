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
  { key: "population", label: "인구 (Population)", dataset: "population" },
  {
    key: "HOUSEHOLD",
    label: "생활계 폐기물 발생량 (Household waste generation)",
    dataset: "waste-statistics",
    wasteStream: "HOUSEHOLD",
  },
  {
    key: "BUSINESS_NON_FACILITY",
    label: "사업장 비배출시설계 발생량 (Business non-facility)",
    dataset: "waste-statistics",
    wasteStream: "BUSINESS_NON_FACILITY",
  },
  {
    key: "INDUSTRIAL_FACILITY",
    label: "사업장 배출시설계 발생량 (Industrial facility)",
    dataset: "waste-statistics",
    wasteStream: "INDUSTRIAL_FACILITY",
  },
  {
    key: "CONSTRUCTION",
    label: "건설 폐기물 발생량 (Construction waste)",
    dataset: "waste-statistics",
    wasteStream: "CONSTRUCTION",
  },
  {
    key: "PER_CAPITA_HOUSEHOLD",
    label: "1인당 생활계 발생량 (Household per capita) — 형평성 지표",
    dataset: "waste-per-capita",
    wasteStream: "HOUSEHOLD",
  },
  {
    key: "PER_CAPITA_BUSINESS_NON_FACILITY",
    label: "1인당 사업장 비배출시설계 (Business non-facility per capita)",
    dataset: "waste-per-capita",
    wasteStream: "BUSINESS_NON_FACILITY",
    caveat: NON_RESIDENTIAL_CAVEAT,
  },
  {
    key: "PER_CAPITA_INDUSTRIAL_FACILITY",
    label: "1인당 사업장 배출시설계 (Industrial facility per capita)",
    dataset: "waste-per-capita",
    wasteStream: "INDUSTRIAL_FACILITY",
    caveat: NON_RESIDENTIAL_CAVEAT,
  },
  {
    key: "PER_CAPITA_CONSTRUCTION",
    label: "1인당 건설 폐기물 (Construction per capita)",
    dataset: "waste-per-capita",
    wasteStream: "CONSTRUCTION",
    caveat: NON_RESIDENTIAL_CAVEAT,
  },
  {
    key: "FACILITY_BURDEN_LOCATED",
    label: "1인당 소재 시설 처리량 (Facility throughput per capita, located) — 부담 지표",
    dataset: "facility-burden",
    burdenMeasure: "located",
    caveat: FACILITY_BURDEN_CAVEAT,
  },
  {
    key: "FACILITY_BURDEN_5KM",
    label: "1인당 인근 5km 시설 처리량 (Facility throughput per capita, within 5 km)",
    dataset: "facility-burden",
    burdenMeasure: "buffer",
    caveat: FACILITY_BURDEN_CAVEAT,
  },
];

/** Colorblind-safe sequential palette (light to dark). */
export const CHOROPLETH_PALETTE = ["#f1eef6", "#bdc9e1", "#74a9cf", "#2b8cbe", "#045a8d"];

export const NO_DATA_COLOR = "#d9d9d9";

/**
 * Quantile breaks splitting the observed values into as many classes as the
 * palette has colors. Returns the interior thresholds (length = classes - 1),
 * deduplicated for degenerate distributions.
 */
export function computeBreaks(values: number[], classes: number = CHOROPLETH_PALETTE.length): number[] {
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

/** Color for a value given interior thresholds (values >= threshold move up a class). */
export function colorFor(value: number, breaks: number[], palette: string[] = CHOROPLETH_PALETTE): string {
  let index = 0;
  for (const threshold of breaks) {
    if (value >= threshold) index += 1;
  }
  return palette[Math.min(index, palette.length - 1)];
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
