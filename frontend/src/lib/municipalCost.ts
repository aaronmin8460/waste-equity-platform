/**
 * Pure helpers for the 2024 municipal collection/transport contract-payment view.
 *
 * This dataset is NOT the official Sudokwon Landfill inbound fee. It has a
 * different accounting basis, different providers, and a different spatial grain,
 * and the two indicators may never be summed or compared as costs. Everything in
 * this module exists to keep that distinction — and the "absence is not zero" rule
 * — mechanical rather than a matter of each call site remembering.
 *
 * Three rules this module enforces:
 *
 *   1. A `null` money field is NEVER formatted as a number. {@link formatPayment}
 *      and {@link formatPaymentPerCapita} return `null` for it, so a caller
 *      physically cannot render `₩0` from an unavailable value — it has to branch
 *      and show the served reason instead.
 *   2. The three status values get plain-Korean labels; the raw enum stays
 *      available for a `[data-diagnostic]` line but is never citizen-facing text.
 *   3. The reason vocabulary is the BACKEND'S. Each row carries `limitations`,
 *      one plain-Korean sentence per `reason_codes` entry, so this module never
 *      invents an explanation — it only picks the served one and, for a code the
 *      backend served without a sentence, degrades to an honest fallback.
 *
 * Money formatting reuses `lib/landfill.ts`'s `formatKrwEok` / `formatKrwPerPerson`.
 * Those two are pure numeric formatters with no landfill semantics, and a second
 * copy here would be exactly the kind of drift that lets two screens round the same
 * won amount differently.
 */

import { ApiError } from "./api";
import type { MunicipalCostRow, MunicipalCostSort, MunicipalCostStatus } from "./api";
import { plainError } from "./glossary";
import type { DataStatus } from "./glossary";
import { formatKrwEok, formatKrwPerPerson } from "./landfill";

// --------------------------------------------------------------------------- //
// Status
// --------------------------------------------------------------------------- //

/**
 * Plain-Korean name and provenance badge for each served status.
 *
 * `badge` maps onto the shared {@link DataStatus} vocabulary so the section reuses
 * the project's one badge component and its colour rules:
 *
 *   - AVAILABLE → `derived`: the value exists but is this platform's arithmetic
 *     over local-government inputs, never a figure any authority published;
 *   - PARTIAL → `caveat`: a value WAS served, and the caution is about how to read
 *     it (amber is correct here — it qualifies a number that exists);
 *   - UNAVAILABLE → `missing`: no value was served. Neutral gray, never amber and
 *     never a pale step of an analytical ramp
 *     (docs/ui-refresh/design-tokens.md §"Missing data").
 *
 * The label is always TEXT, so status never depends on colour alone.
 */
export const MUNICIPAL_COST_STATUS_META: Record<
  MunicipalCostStatus,
  { label: string; badge: DataStatus; detail: string }
> = {
  AVAILABLE: {
    label: "계산 가능",
    badge: "derived",
    detail: "확인된 지급액과 인구가 모두 있어 1인당 값을 계산했습니다.",
  },
  PARTIAL: {
    label: "일부 제한",
    badge: "caveat",
    detail: "값은 계산했으나 대상 범위·기간이 제한적이어서 그대로 비교할 수 없습니다.",
  },
  UNAVAILABLE: {
    label: "자료 없음",
    badge: "missing",
    detail: "지급액 자료가 없어 계산할 수 없습니다. 값이 0이라는 뜻이 아닙니다.",
  },
};

/** The three statuses in the order the filter and the summary present them. */
export const MUNICIPAL_COST_STATUSES: readonly MunicipalCostStatus[] = [
  "AVAILABLE",
  "PARTIAL",
  "UNAVAILABLE",
];

export function statusLabel(status: MunicipalCostStatus): string {
  return MUNICIPAL_COST_STATUS_META[status].label;
}

export function statusBadge(status: MunicipalCostStatus): DataStatus {
  return MUNICIPAL_COST_STATUS_META[status].badge;
}

// --------------------------------------------------------------------------- //
// Metropolitan filter
// --------------------------------------------------------------------------- //

/** The three capital-region metropolitan units, matching the backend `sido` enum. */
export const MUNICIPAL_COST_SIDO_OPTIONS: readonly { code: "11" | "28" | "41"; label: string }[] = [
  { code: "11", label: "서울" },
  { code: "28", label: "인천" },
  { code: "41", label: "경기" },
];

// --------------------------------------------------------------------------- //
// Sorting
// --------------------------------------------------------------------------- //

/**
 * The three orderings the BACKEND implements, with the wording the control shows.
 *
 * Sorting is a backend parameter, not a client-side re-sort: the server places
 * nulls last on both value sorts, so an unavailable municipality is never ordered
 * as if it were the cheapest. Re-sorting the served array here would silently lose
 * that rule.
 */
export const MUNICIPAL_COST_SORT_OPTIONS: readonly { value: MunicipalCostSort; label: string }[] = [
  { value: "payment_per_capita_desc", label: "1인당 지급액 많은 순" },
  { value: "total_payment_desc", label: "총 지급액 많은 순" },
  { value: "region_name_asc", label: "지역 이름순" },
];

// --------------------------------------------------------------------------- //
// Money
// --------------------------------------------------------------------------- //

/**
 * The total eligible payment as 억원, or `null` when none was served.
 *
 * Returning `null` rather than a dash is deliberate: the caller must decide what to
 * show in place of an absent value, and the one thing it must never show is a zero
 * amount (repo AGENTS.md). A served exact `"0.00"` — which the backend's CHECK
 * constraints make impossible for an UNAVAILABLE row — would still format as 0억원,
 * because a MEASURED zero is a real value and is not the same claim as absence.
 */
export function formatPayment(krw: string | null): string | null {
  if (krw == null) return null;
  return formatKrwEok(krw);
}

/** The per-capita payment as 원/인, or `null` when none was served. */
export function formatPaymentPerCapita(krw: string | null): string | null {
  if (krw == null) return null;
  return formatKrwPerPerson(krw);
}

/** A served population count, or `null`. Never substitutes a neighbouring figure. */
export function formatPopulation(population: number | null): string | null {
  if (population == null) return null;
  return `${population.toLocaleString("en-US")}명`;
}

// --------------------------------------------------------------------------- //
// Population provenance
// --------------------------------------------------------------------------- //

export const DERIVED_POPULATION_METHOD = "DERIVED_SUM_OF_CONSTITUENT_WARDS";

/**
 * Whether this municipality's denominator was COMPUTED from its constituent 일반구
 * rather than reported at city level.
 *
 * True for exactly the seven Gyeonggi cities that exist in the canonical geography
 * only as 일반구 — 수원·성남·안양·부천·안산·고양·용인. The UI must say so wherever it
 * shows the population, so a reader never takes the figure for a source-reported
 * city-level observation.
 */
export function hasDerivedPopulation(row: MunicipalCostRow): boolean {
  return row.population_method === DERIVED_POPULATION_METHOD;
}

/** Plain-Korean name of the served population method. */
export function populationMethodLabel(method: string): string {
  if (method === DERIVED_POPULATION_METHOD) return "구성 일반구 인구 합산";
  if (method === "DIRECT_REGION_POPULATION") return "해당 행정구역 인구";
  // An unrecognised method degrades to an honest statement rather than printing a
  // raw enum as citizen text; the code survives in the diagnostic line.
  return "인구 산출 방식 확인 필요";
}

/**
 * The raw method code, for a DIAGNOSTIC line only — returned only when
 * {@link populationMethodLabel} could not translate it. A known method is already
 * fully described in Korean, so repeating its enum beside the label would be the
 * duplication the terminology audit exists to prevent.
 */
export function populationMethodCode(method: string): string | null {
  return method === DERIVED_POPULATION_METHOD || method === "DIRECT_REGION_POPULATION"
    ? null
    : method;
}

// --------------------------------------------------------------------------- //
// Reason codes and limitations
// --------------------------------------------------------------------------- //

/**
 * The served plain-Korean limitation sentences, positionally paired with
 * `reason_codes`.
 *
 * The backend serves one sentence per code, in the same order. This returns the
 * pairs so a row can show the SENTENCE as the citizen-facing explanation while
 * keeping the code recoverable in a `[data-diagnostic]` line (redesign plan §5
 * rule 12). A code the backend served without a matching sentence keeps the code
 * and gets no invented text.
 */
export function reasonEntries(row: MunicipalCostRow): { code: string; text: string | null }[] {
  return row.reason_codes.map((code, index) => ({
    code,
    text: row.limitations[index] ?? null,
  }));
}

/**
 * The one-line note shown in the comparison table's 데이터 참고 column.
 *
 * The FIRST served limitation, which the backend orders with the determining
 * reason first. `null` when the row carries none — an unlimited AVAILABLE row
 * should show nothing rather than a manufactured reassurance.
 */
export function primaryLimitation(row: MunicipalCostRow): string | null {
  return row.limitations[0] ?? null;
}

// --------------------------------------------------------------------------- //
// Request failure
// --------------------------------------------------------------------------- //

/**
 * Why the section has nothing to show.
 *
 * Unlike the official landfill endpoints there is no 404 "no record" path here:
 * the endpoint always returns all 66 municipalities for the published year, with
 * unavailable ones carried as null rows. So a failure here is always a genuine
 * request/network/server failure — which is exactly why an UNAVAILABLE row must
 * never be routed through this state (it is data, not a fault).
 */
export interface MunicipalCostErrorState {
  message: string;
  detail: string | null;
}

export function municipalCostErrorFrom(cause: unknown): MunicipalCostErrorState {
  if (cause instanceof ApiError) {
    const plain = plainError(cause.message);
    return {
      message: plain.primary,
      // The BARE technical string: the components add the `기술 정보:` prefix
      // themselves, and reusing `plain.detail` here would double it.
      detail: cause.detail ? `${cause.detail.error}: ${cause.detail.detail}` : cause.message,
    };
  }
  return {
    message: "수집·운반 계약 지급액 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    detail: null,
  };
}
