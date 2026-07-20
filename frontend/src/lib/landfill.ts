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

import { ApiError } from "./api";
import { plainError } from "./glossary";

/**
 * Why the dashboard has no data to show.
 *
 * `"no-data"` means the request REACHED the backend and the backend answered that
 * it holds no official record for these filters (its 404 `NO_DATA_AVAILABLE` /
 * `NO_DATA_FOR_PERIOD` path). That is an answer, not a failure, and it must never
 * be presented as a broken system — nor as zero quantities.
 *
 * `"error"` is a genuine request/network/server failure the reader may retry.
 *
 * `message` is always plain Korean resolved through `plainError`; the raw backend
 * code survives in `detail` for the diagnostic line (redesign plan §5 rule 12).
 */
export interface LandfillUnavailableState {
  kind: "no-data" | "error";
  message: string;
  detail: string | null;
  /** Years the backend reports it does hold, when it serves them. Never invented. */
  availableYears: number[];
}

/** Backend codes that mean "asked and answered: no official record", not "broken". */
const NO_DATA_CODES = new Set(["NO_DATA_AVAILABLE", "NO_DATA_FOR_PERIOD"]);

/**
 * Classify a failed landfill request.
 *
 * Phase 5 AC4 (redesign plan §9): the flow path used to render `cause.message`
 * directly, so a citizen read the raw
 * `NO_DATA_AVAILABLE: No landfill inbound data has been ingested.` This routes every
 * case through `plainError` like the equity and suitability paths already did.
 */
export function landfillUnavailableFrom(cause: unknown): LandfillUnavailableState {
  if (cause instanceof ApiError) {
    const plain = plainError(cause.message);
    const code = cause.detail?.error ?? plain.code;
    return {
      kind: cause.status === 404 && NO_DATA_CODES.has(code) ? "no-data" : "error",
      message: plain.primary,
      // The BARE technical string. `plainError`'s own `detail` already carries a
      // `기술 정보:` / `기술 코드:` prefix, and the components add that prefix
      // themselves — reusing it here produced `기술 정보: 기술 정보: …` on any
      // response without a structured JSON body (a proxy 502, say).
      detail: cause.detail ? `${cause.detail.error}: ${cause.detail.detail}` : cause.message,
      availableYears: cause.detail?.available_years ?? [],
    };
  }
  return {
    kind: "error",
    message: "수도권매립지 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    detail: null,
    availableYears: [],
  };
}

/**
 * Classify a set of failures from the three parallel landfill requests.
 *
 * Severity wins over arrival order. `Promise.all` surfaces whichever request
 * rejected FIRST, which is not necessarily the most serious: if `/summary` fails
 * with a 500 while `/composition` returns a fast 404 `NO_DATA_AVAILABLE`, treating
 * the dashboard as "no official record" would tell the reader the data does not
 * exist when in fact the server is broken. So a genuine error anywhere outranks any
 * number of no-data answers, and only an all-no-data set is reported as no-data.
 *
 * Among no-data answers the one that actually carries `available_years` is
 * preferred, so the reader is offered the periods the backend does hold.
 *
 * A PARTIAL failure — some endpoints served data, others did not — is reported as an
 * error too, never as absence: the backend clearly holds records for these filters,
 * so the honest statement is that the request did not complete.
 */
export function landfillUnavailableFromAll(
  causes: unknown[],
  /** How many requests were made. Defaults to "every one of them failed". */
  requestCount: number = causes.length,
): LandfillUnavailableState {
  const states = causes.map(landfillUnavailableFrom);
  const firstError = states.find((state) => state.kind === "error");
  if (firstError) return firstError;
  if (states.length === 0) {
    // Defensive: no caller reaches this today (the success branch returns first),
    // but the return type promises a state, so never hand back `undefined`.
    return {
      kind: "error",
      message: "수도권매립지 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      detail: null,
      availableYears: [],
    };
  }
  // A PARTIAL failure is not an answer of absence. If some endpoints served data and
  // others 404'd, the backend demonstrably HAS records for these filters — saying
  // "선택한 조건의 공식 반입 자료가 없습니다" would be a false claim about the data
  // rather than about the request. Only an all-no-data set is an answer of absence.
  if (states.length < requestCount) {
    return {
      kind: "error",
      message: "수도권매립지 자료의 일부를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      detail: states.map((state) => state.detail).filter(Boolean).join(" · ") || null,
      availableYears: [],
    };
  }
  return states.find((state) => state.availableYears.length > 0) ?? states[0];
}

export function kgToTons(kg: string | number): number {
  const value = typeof kg === "string" ? Number(kg) : kg;
  return value / 1000;
}

export function formatTons(kg: string | number): string {
  return `${Math.round(kgToTons(kg)).toLocaleString("en-US")} t`;
}

/**
 * Group an exact decimal string with thousands separators, trimming trailing
 * fractional zeros — LOSSLESS (no rounding). For the accessible "exact monthly
 * values" table, where the served backend precision must be preserved rather than
 * shown through the chart's rounding formatters. "90000.123456" → "90,000.123456";
 * "9000000000.00" → "9,000,000,000".
 */
export function formatDecimalExact(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const [, sign, integerPart, fractionPart] = match;
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (fractionPart ?? "").replace(/0+$/, "");
  return `${sign}${grouped}${fraction ? `.${fraction}` : ""}`;
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
 * The vocabulary is defined by the backend derivation (landfill-fee-per-capita-v2);
 * an unrecognised code degrades to an honest "계산 불가" rather than being hidden or
 * shown as a number. The raw code is not lost — it moves to
 * {@link perCapitaUnavailableCode}, which callers render in a diagnostic line.
 */
const PER_CAPITA_REASON_LABELS: Record<string, string> = {
  // v2 is month-aligned: a missing denominator is a missing *period*, not a year.
  NO_MATCHING_POPULATION_PERIOD: "동일 기간 인구 데이터 없음",
  NO_METROPOLITAN_POPULATION: "해당 광역지자체 인구 데이터 없음",
  ZERO_POPULATION: "인구 데이터 확인 필요 (인구 0)",
  AMBIGUOUS_POPULATION_DEFINITION: "인구 데이터 확인 필요 (정의 모호)",
  INCOMPLETE_POPULATION_COVERAGE: "일부 지역의 동일 기간 인구가 없어 합계를 계산할 수 없습니다",
};

export function perCapitaUnavailableLabel(reason: string | null): string {
  if (reason == null) return "계산 불가";
  // Phase 5 (redesign plan §4 defect X6): an unrecognised code used to be printed
  // verbatim — `계산 불가 (SOMETHING_NEW)` — which put a raw backend enum into
  // primary citizen text. The code is NOT discarded: callers render it through
  // {@link perCapitaUnavailableCode} in a `data-diagnostic` detail line, so the
  // reason code stays in the system (redesign plan §5 rule 12) without becoming
  // the citizen-facing explanation.
  return PER_CAPITA_REASON_LABELS[reason] ?? "계산 불가";
}

/**
 * The raw served reason code, for a DIAGNOSTIC detail line only.
 *
 * Returns the code only when {@link perCapitaUnavailableLabel} could not translate
 * it — a known reason is already fully described in plain Korean, so repeating its
 * code beside the label would be the English/enum duplication Phase 5 removes.
 */
export function perCapitaUnavailableCode(reason: string | null): string | null {
  if (reason == null) return null;
  return reason in PER_CAPITA_REASON_LABELS ? null : reason;
}
