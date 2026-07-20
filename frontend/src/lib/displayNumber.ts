/**
 * Presentation-only approximation of an EXACT backend decimal string.
 *
 * Why this module exists (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §9 Phase 3): the cost
 * results screen leads with one answer a citizen can read at a glance — "약 44만원",
 * not "439,553.13원". The exact served value is never lost: it stays in the
 * "정밀값과 계산 기준" detail section, rendered from the ORIGINAL API string.
 *
 * HARD CONTRACTS
 *  1. Input is the exact decimal string as served. It is never mutated, and this
 *     module never returns a value that claims to be exact.
 *  2. No floating point. Every rounding step is a string/BigInt operation, so a
 *     value beyond `Number.MAX_SAFE_INTEGER` (or with more fractional digits than a
 *     double can hold) is still rounded correctly. Nothing here can be used to
 *     RECONSTRUCT an exact value — the output is explicitly labelled approximate.
 *  3. A non-zero value NEVER displays as "0". A value smaller than one display unit
 *     renders as "1억원 미만" (less than one unit), because showing "약 0억원" for a
 *     real cost would read as "free" — the same fabricated-zero failure the repo
 *     AGENTS.md forbids for missing data.
 *  4. Malformed input returns `null`. Callers fall back to the unchanged exact
 *     string (an "unchanged-safe" state); they must never substitute zero.
 *  5. When rounding discards nothing, the "약" (approximately) prefix is omitted —
 *     claiming approximation for an exact value is its own small dishonesty.
 *
 * DISPLAY PRECISION (documented per unit; see the redesign plan §9 Phase 3):
 *  - 억원        → 1억원 단위 (integer 억원).            "1277.222078" → "약 1,277억원"
 *  - 억원/년     → 1억원 단위, same rule, "/년" appended.
 *  - 원 → 만원   → 1만원 단위 (원 ÷ 10,000, integer).    "439553.13"   → "약 44만원"
 *  - 원/인       → identical to 원 → 만원 (the per-capita hero uses it).
 *  - 톤/일       → 100톤/일 미만은 1톤/일 단위,
 *                  100톤/일 이상은 10톤/일 단위.          "279.479667"  → "약 280톤/일"
 *  - %           → 1% 단위 (integer percent).
 *
 * Rounding is HALF-UP on the magnitude (ties away from zero), applied once, to the
 * unit's documented step.
 */

/** A decimal split into sign / integer digits / fractional digits. */
interface DecimalParts {
  negative: boolean;
  int: string;
  frac: string;
}

/** Result of approximating one value for display. */
export interface ApproximateValue {
  /** Ready-to-render text, e.g. "약 1,277억원" / "1억원 미만" / "0억원". */
  text: string;
  /** True when the shown number is rounded (i.e. the text carries "약"). */
  approximate: boolean;
}

/**
 * How one unit is displayed.
 *
 * `decimals` is the rounding position and MAY be negative: `-1` rounds to the
 * nearest 10, which is how 톤/일 keeps at least two significant digits for
 * three-digit capacities.
 */
interface UnitSpec {
  /** Suffix appended directly to the number, e.g. "억원". */
  unit: string;
  /** Rounding position; negative rounds above the decimal point. */
  decimals: number | ((parts: DecimalParts) => number);
  /** Divide by 10^shiftLeft first (원 → 만원 uses 4). Pure decimal-point move. */
  shiftLeft?: number;
}

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/** Parse an exact decimal string. Returns null for anything else — never zero. */
function parseDecimalString(raw: string): DecimalParts | null {
  if (typeof raw !== "string") return null;
  const match = DECIMAL_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, sign, int, frac] = match;
  return { negative: sign === "-", int, frac: frac ?? "" };
}

/** True when every digit is zero (an exact zero, not a missing value). */
function isZero(parts: DecimalParts): boolean {
  return !/[1-9]/.test(parts.int) && !/[1-9]/.test(parts.frac);
}

/** Divide by 10^places by moving the decimal point left. No arithmetic. */
function shiftDecimalLeft(parts: DecimalParts, places: number): DecimalParts {
  if (places <= 0) return parts;
  const digits = parts.int + parts.frac;
  const pointAt = parts.int.length - places;
  if (pointAt <= 0) {
    return { negative: parts.negative, int: "0", frac: "0".repeat(-pointAt) + digits };
  }
  return {
    negative: parts.negative,
    int: digits.slice(0, pointAt),
    frac: digits.slice(pointAt),
  };
}

/**
 * Round the magnitude half-up at `decimals` (which may be negative). Returns the
 * rounded parts plus whether anything was actually discarded.
 */
function roundHalfUp(
  parts: DecimalParts,
  decimals: number,
): { value: DecimalParts; discarded: boolean } {
  let digits = parts.int + parts.frac;
  let pointAt = parts.int.length;
  let keep = pointAt + decimals;

  // Left-pad so the kept-digit count is never negative (rounding 6 to the nearest
  // 100 must consider the leading implicit zeros, otherwise it would yield 100).
  if (keep < 0) {
    const pad = -keep;
    digits = "0".repeat(pad) + digits;
    pointAt += pad;
    keep = 0;
  }

  if (keep >= digits.length) {
    // Nothing to drop: the value already fits the requested precision.
    const frac = decimals > 0 ? parts.frac.padEnd(decimals, "0") : parts.frac;
    return { value: { ...parts, frac: decimals > 0 ? frac : "" }, discarded: false };
  }

  const kept = digits.slice(0, keep);
  const dropped = digits.slice(keep);
  const discarded = /[1-9]/.test(dropped);

  // `BigInt(...)` rather than a `0n` literal: tsconfig targets ES2017, where BigInt
  // literals are a syntax error even though the BigInt type is available via `lib`.
  let scaled = kept === "" ? BigInt(0) : BigInt(kept);
  if (dropped.charCodeAt(0) >= 53 /* '5' */) scaled += BigInt(1);

  const scaledText = scaled.toString();
  if (decimals >= 0) {
    const padded = scaledText.padStart(decimals + 1, "0");
    return {
      value: {
        negative: parts.negative,
        int: decimals === 0 ? padded : padded.slice(0, padded.length - decimals),
        frac: decimals === 0 ? "" : padded.slice(padded.length - decimals),
      },
      discarded,
    };
  }
  return {
    value: {
      negative: parts.negative,
      // Restore the magnitude the negative `decimals` rounded away (28 → 280).
      int: scaledText === "0" ? "0" : scaledText + "0".repeat(-decimals),
      frac: "",
    },
    discarded,
  };
}

/** Strip leading zeros (keeping one) and group the integer digits by thousands. */
function groupInteger(int: string): string {
  const trimmed = int.replace(/^0+(?=\d)/, "");
  return trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Render rounded parts as a plain number string (no unit, no "약"). */
function renderParts(parts: DecimalParts): string {
  const frac = parts.frac.replace(/0+$/, "");
  const sign = parts.negative && /[1-9]/.test(parts.int + parts.frac) ? "-" : "";
  return `${sign}${groupInteger(parts.int)}${frac ? `.${frac}` : ""}`;
}

/** The smallest value this precision can show, as text ("1", "0.1", "10"). */
function smallestStep(decimals: number): string {
  if (decimals > 0) return `0.${"0".repeat(decimals - 1)}1`;
  if (decimals === 0) return "1";
  return `1${"0".repeat(-decimals)}`;
}

/** Core: approximate an exact decimal string for one unit. */
function approximateFor(exact: string, spec: UnitSpec): ApproximateValue | null {
  const parsed = parseDecimalString(exact);
  if (parsed === null) return null;

  const scaled = shiftDecimalLeft(parsed, spec.shiftLeft ?? 0);
  const decimals = typeof spec.decimals === "function" ? spec.decimals(scaled) : spec.decimals;
  const { value, discarded } = roundHalfUp(scaled, decimals);

  // An exact zero stays a plain, unqualified zero — it is a real measured value.
  if (isZero(scaled)) return { text: `0${spec.unit}`, approximate: false };

  // A real value that rounds to nothing must not read as zero.
  if (isZero(value)) {
    return { text: `${groupInteger(smallestStep(decimals))}${spec.unit} 미만`, approximate: true };
  }

  return {
    text: `${discarded ? "약 " : ""}${renderParts(value)}${spec.unit}`,
    approximate: discarded,
  };
}

// --------------------------------------------------------------------------- //
// Per-unit entry points. Each returns null for malformed input so the caller can
// fall back to the unchanged exact string — never to a fabricated zero.
// --------------------------------------------------------------------------- //

/** 억원 → "약 1,277억원" (1억원 단위). */
export function approximateBillionWon(exact: string): ApproximateValue | null {
  return approximateFor(exact, { unit: "억원", decimals: 0 });
}

/** 억원/년 → "약 43억원/년" (1억원 단위). */
export function approximateAnnualBillionWon(exact: string): ApproximateValue | null {
  return approximateFor(exact, { unit: "억원/년", decimals: 0 });
}

/** 원 → "약 44만원" (원 ÷ 10,000, 1만원 단위). Also used for 원/인. */
export function approximateWonAsManwon(exact: string): ApproximateValue | null {
  return approximateFor(exact, { unit: "만원", decimals: 0, shiftLeft: 4 });
}

/**
 * 톤/일 → "약 280톤/일".
 *
 * Under 100톤/일 the integer is already readable (35 → "35톤/일"); at and above
 * 100톤/일 the tens place keeps the number legible without implying a precision the
 * standard-cost band does not have (279.479667 → "약 280톤/일").
 */
export function approximateTonPerDay(exact: string): ApproximateValue | null {
  return approximateFor(exact, {
    unit: "톤/일",
    decimals: (parts) => (parts.int.replace(/^0+(?=\d)/, "").length >= 3 ? -1 : 0),
  });
}

/** percent → "약 63%" (1% 단위). */
export function approximatePercent(exact: string): ApproximateValue | null {
  return approximateFor(exact, { unit: "%", decimals: 0 });
}
