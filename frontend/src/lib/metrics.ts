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
  | "CONSTRUCTION";

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  dataset: "population" | "waste-statistics";
  wasteStream?: string;
}

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
