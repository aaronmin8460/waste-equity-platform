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
 * A PARTIAL failure is an error ONLY when one of the failures is a genuine error.
 *
 * ── Why a partial NO-DATA set is still an answer of absence (Page-2 defect F1) ───
 * The three landfill requests are deliberately scoped DIFFERENTLY: `/summary` honours
 * all four filters, `/trends` ignores the month, and `/composition` ignores both the
 * month and the waste type. So "some endpoints answered, the narrowest one 404'd" is
 * the NORMAL shape of a period the dataset does not cover — asking for 1999년 3월 in a
 * year whose records begin in August makes `/summary` answer NO_DATA_FOR_PERIOD while
 * the two year-scoped requests legitimately succeed.
 *
 * This used to be classified as a request failure, so a perfectly deterministic
 * "no record for that month" rendered as a red `role="alert"` with a retry button —
 * inviting the reader to retry their way into data that does not exist. The success
 * of a BROADER request cannot contradict the absence a NARROWER one reported, so an
 * all-no-data rejection set is now reported as no-data regardless of how many
 * requests succeeded. A genuine error anywhere still outranks every no-data answer.
 */
export function landfillUnavailableFromAll(
  causes: unknown[],
  /**
   * How many requests were made. Retained so callers keep describing the whole set
   * (and so an empty rejection list is still distinguishable from a total failure);
   * it no longer promotes a no-data answer to an error.
   */
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
  // Every rejection is a no-data answer. Whether the OTHER requests succeeded is not
  // evidence against it: they are scoped more broadly (see the doc comment), so their
  // success says nothing about the narrower period that was actually asked for.
  void requestCount;
  return states.find((state) => state.availableYears.length > 0) ?? states[0];
}

/**
 * The period a served answer actually covers, as a citizen reads it.
 *
 * A complete year is just the year. A PARTIAL year is stated as the range between the
 * first and last month the dataset holds — `1999-08 ~ 1999-12`, never "1999-12까지",
 * which reads as January-through-December and is false for a year whose records begin
 * in August (Page-2 defect F2).
 *
 * Returns `null` when the served period is complete or when the backend did not serve
 * both bounds (an older build serves only the upper one). A half-known range is not
 * printed as if it were known: the caller falls back to the single bound it does have.
 */
export function partialYearRange(period: {
  year: number;
  is_complete_year: boolean;
  available_from_month?: string | null;
  available_through_month: string | null;
}): string | null {
  if (period.is_complete_year) return null;
  const from = period.available_from_month ?? null;
  const through = period.available_through_month ?? null;
  if (!from || !through) return null;
  return from === through ? from : `${from} ~ ${through}`;
}

/**
 * Percentage change from a previous period to the current one, or `null`.
 *
 * `null` — meaning "no comparison exists" — whenever the previous period was not
 * served, either value is unparseable, or the previous value is zero. NONE of those
 * is a 0% change, and this platform never renders a missing comparison as one
 * (repo AGENTS.md). The caller must show an explicit "비교 자료 없음" instead.
 */
export function percentChange(current: string | null, previous: string | null): number | null {
  if (current == null || previous == null) return null;
  const now = Number(current);
  const before = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null;
  return ((now - before) / before) * 100;
}

/**
 * One row of the waste-composition breakdown.
 *
 * `derived` marks the 그 외 항목 합계 roll-up, which is the only row here that is not
 * a served category — see {@link compositionRows}.
 */
export interface CompositionRow {
  name: string;
  /** Exact served tonnage, or the exact residual for the roll-up. */
  quantityTons: string;
  /** Exact served share (0–1), or the residual's computed share. */
  share: string | null;
  derived: boolean;
}

/**
 * The composition list, descending, with a 그 외 항목 합계 roll-up when — and only
 * when — the roll-up is mathematically valid.
 *
 * The backend serves the ten largest categories plus the period's total. The residual
 * is `total − Σ(served rows)`, which is a subtraction of two official quantities at
 * the same scope, not a re-aggregation of anything: it is exactly "everything the top
 * list does not name". It is emitted ONLY when it comes out strictly positive — a
 * zero residual means the list is already complete and a row saying so would invent a
 * category, and a negative one would mean the two served figures disagree, in which
 * case nothing is asserted at all.
 *
 * The served `waste_name` values are printed VERBATIM. This platform does not remap
 * official categories onto friendlier words: a citizen-facing rename with no approved
 * crosswalk would make the screen disagree with the source it cites.
 */
export function compositionRows(
  served: { waste_name: string; quantity_tons: string; quantity_share: string | null }[],
  totalTons: string,
): CompositionRow[] {
  const rows: CompositionRow[] = served
    .map((item) => ({
      name: item.waste_name,
      quantityTons: item.quantity_tons,
      share: item.quantity_share,
      derived: false,
    }))
    .sort((a, b) => Number(b.quantityTons) - Number(a.quantityTons));

  const total = Number(totalTons);
  const named = rows.reduce((sum, row) => sum + Number(row.quantityTons), 0);
  if (!Number.isFinite(total) || !Number.isFinite(named)) return rows;
  const residual = total - named;
  // A residual under half a tonne is rounding noise between the served total and the
  // served parts, not a category. Asserting it as one would put a phantom row on a
  // list whose whole purpose is to account for the total exactly.
  if (residual <= 0.5) return rows;
  rows.push({
    name: "그 외 항목 합계",
    quantityTons: String(residual),
    share: total > 0 ? String(residual / total) : null,
    derived: true,
  });
  return rows;
}

/** A signed percentage change, one decimal: `+2.8%` / `-1.7%` / `0%`. */
export function formatPercentChange(change: number): string {
  const rounded = Math.round(change * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

export function kgToTons(kg: string | number): number {
  const value = typeof kg === "string" ? Number(kg) : kg;
  return value / 1000;
}

export function formatTons(kg: string | number): string {
  return `${Math.round(kgToTons(kg)).toLocaleString("en-US")} t`;
}

/**
 * Format a value that is ALREADY in tonnes — the served `quantity_tons`, or the
 * composition roll-up's residual. Separate from {@link formatTons} so a tonne figure
 * never has to be multiplied back into kilograms just to be printed.
 */
export function formatTonQuantity(tons: string | number): string {
  const value = typeof tons === "string" ? Number(tons) : tons;
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value).toLocaleString("en-US")} t`;
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
