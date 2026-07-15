/**
 * Pure helpers for the capital-region Sudokwon Landfill dashboard.
 *
 * Formats the official reported values and the two derived indicators, and maps
 * the backend's per-capita unavailability vocabulary to user-facing Korean.
 *
 * No GeoJSON and no MapLibre access: the 수도권매립지 mode is a data dashboard,
 * not a map. The source reports metropolitan (시·도) totals only, so there is no
 * municipal origin-to-destination route to draw, and the previous schematic
 * straight-line flow has been removed rather than implying one exists.
 */

export function kgToTons(kg: string | number): number {
  const value = typeof kg === "string" ? Number(kg) : kg;
  return value / 1000;
}

export function formatTons(kg: string | number): string {
  return `${Math.round(kgToTons(kg)).toLocaleString("en-US")} t`;
}

/** Format KRW as 억원 (hundred-million won) for compact display. */
export function formatKrwEok(krw: string | number): string {
  const value = typeof krw === "string" ? Number(krw) : krw;
  const eok = value / 100_000_000;
  return `${eok.toLocaleString("en-US", { maximumFractionDigits: 1 })}억원`;
}

export function formatShare(share: string | null): string {
  if (share == null) return "—";
  const pct = Number(share) * 100;
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

export function formatEffectiveFee(fee: string | null): string {
  if (fee == null) return "—";
  return `${Math.round(Number(fee)).toLocaleString("en-US")} 원/t`;
}

/**
 * Format the derived inbound fee per resident (KRW/인).
 *
 * Never renders an unavailable value as `0원`: a missing denominator is not a
 * zero fee. Callers must show the served `unavailable_reason` instead — the em
 * dash here is only a defensive fallback.
 */
export function formatKrwPerPerson(fee: string | null): string {
  if (fee == null) return "—";
  const value = Number(fee);
  // A sub-1원 monthly value would otherwise collapse to "0원/인"; keep two
  // decimals below 1 so a real small value is never displayed as zero.
  const digits = value !== 0 && Math.abs(value) < 1 ? 2 : 0;
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}원/인`;
}

/**
 * User-facing Korean for a served per-capita unavailability reason.
 *
 * The vocabulary is defined by the backend derivation; an unrecognised code
 * degrades to an honest "계산 불가" that still surfaces the raw code, rather
 * than being hidden or shown as a number.
 */
const PER_CAPITA_REASON_LABELS: Record<string, string> = {
  NO_MATCHING_POPULATION_YEAR: "동일 연도 인구 데이터 없음",
  NO_METROPOLITAN_POPULATION: "해당 광역지자체 인구 데이터 없음",
  ZERO_POPULATION: "인구 데이터 확인 필요 (인구 0)",
  AMBIGUOUS_POPULATION_DEFINITION: "인구 정의가 모호하여 계산 불가",
  INCOMPLETE_POPULATION_COVERAGE: "일부 출발지의 동일 연도 인구 없음 — 합계 계산 불가",
};

export function perCapitaUnavailableLabel(reason: string | null): string {
  if (reason == null) return "계산 불가";
  return PER_CAPITA_REASON_LABELS[reason] ?? `계산 불가 (${reason})`;
}
