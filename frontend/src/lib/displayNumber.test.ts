import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  approximateAnnualBillionWon,
  approximateBillionWon,
  approximatePercent,
  approximateTonPerDay,
  approximateWonAsManwon,
} from "./displayNumber";

/**
 * displayNumber — presentation-only approximation of exact backend decimal strings.
 *
 * The module's whole reason to exist is that the citizen-facing surface must be
 * readable WITHOUT the exact value ever being altered or reconstructed. These tests
 * therefore assert three separate things: the documented per-unit precision, the
 * data-integrity guarantees (no fabricated zero, no fabricated value from malformed
 * input, exact input untouched), and — structurally — that no floating-point path
 * exists in the module at all.
 */

describe("displayNumber — the redesign plan's required examples", () => {
  it("renders 억원 to a grouped integer", () => {
    expect(approximateBillionWon("1277.222078")?.text).toBe("약 1,277억원");
  });

  it("renders 원 as 만원", () => {
    expect(approximateWonAsManwon("439553.13")?.text).toBe("약 44만원");
  });

  it("renders 톤/일 keeping at least two significant digits", () => {
    expect(approximateTonPerDay("279.479667")?.text).toBe("약 280톤/일");
  });
});

describe("displayNumber — documented precision per unit", () => {
  it("억원 rounds at the 1억원 place", () => {
    expect(approximateBillionWon("120.750000")?.text).toBe("약 121억원");
    expect(approximateBillionWon("8.05")?.text).toBe("약 8억원");
    expect(approximateAnnualBillionWon("43.4")?.text).toBe("약 43억원/년");
  });

  it("만원 divides 원 by 10,000 and rounds at the 1만원 place", () => {
    expect(approximateWonAsManwon("42262.50")?.text).toBe("약 4만원");
    expect(approximateWonAsManwon("125000")?.text).toBe("약 13만원");
  });

  it("톤/일 uses whole tonnes below 100 and tens at and above 100", () => {
    // Below 100: the integer is already legible, so nothing coarser is applied.
    expect(approximateTonPerDay("35.000000")?.text).toBe("35톤/일");
    expect(approximateTonPerDay("35.4")?.text).toBe("약 35톤/일");
    expect(approximateTonPerDay("99.9")?.text).toBe("약 100톤/일");
    // At and above 100 the tens place keeps the number readable.
    expect(approximateTonPerDay("279.479667")?.text).toBe("약 280톤/일");
    expect(approximateTonPerDay("1277.2")?.text).toBe("약 1,280톤/일");
  });

  it("percent rounds at the 1% place", () => {
    expect(approximatePercent("100")?.text).toBe("100%");
    expect(approximatePercent("62.5")?.text).toBe("약 63%");
  });
});

describe("displayNumber — half-up rounding boundaries", () => {
  it("rounds a trailing 5 up, away from zero", () => {
    expect(approximateBillionWon("0.5")?.text).toBe("약 1억원");
    expect(approximateBillionWon("1.5")?.text).toBe("약 2억원");
    expect(approximateBillionWon("2.5")?.text).toBe("약 3억원");
    // Not banker's rounding: 2.5 must not become 2.
    expect(approximateBillionWon("2.5")?.text).not.toBe("약 2억원");
  });

  it("rounds just below the boundary down", () => {
    expect(approximateBillionWon("1.4999999999999999999")?.text).toBe("약 1억원");
    expect(approximateBillionWon("1.5000000000000000001")?.text).toBe("약 2억원");
  });

  it("carries across every digit when rounding up", () => {
    expect(approximateBillionWon("999.5")?.text).toBe("약 1,000억원");
    expect(approximateTonPerDay("999.6")?.text).toBe("약 1,000톤/일");
  });
});

describe("displayNumber — comma formatting", () => {
  it("groups thousands, and only thousands", () => {
    expect(approximateBillionWon("999")?.text).toBe("999억원");
    expect(approximateBillionWon("1000")?.text).toBe("1,000억원");
    expect(approximateBillionWon("1234567")?.text).toBe("1,234,567억원");
  });

  it("strips leading zeros rather than grouping them", () => {
    expect(approximateBillionWon("0012")?.text).toBe("12억원");
  });
});

describe("displayNumber — zero, sub-unit values, and the never-fabricate-zero rule", () => {
  it("shows an exact zero as an unqualified zero, with no 약", () => {
    const zero = approximateBillionWon("0");
    expect(zero?.text).toBe("0억원");
    expect(zero?.approximate).toBe(false);
    expect(approximateBillionWon("0.000000")?.text).toBe("0억원");
    expect(approximateWonAsManwon("0")?.text).toBe("0만원");
  });

  it("never renders a real value as 0 — sub-unit values say '미만'", () => {
    // 0.4억원 is a real cost. Rounding it to "약 0억원" would read as free.
    expect(approximateBillionWon("0.4")?.text).toBe("1억원 미만");
    expect(approximateBillionWon("0.000001")?.text).toBe("1억원 미만");
    // Below the half (5,000원 = 0.5만원), so it cannot round up to 1만원.
    expect(approximateWonAsManwon("4999")?.text).toBe("1만원 미만");
    expect(approximateTonPerDay("0.2")?.text).toBe("1톤/일 미만");
    // And it is flagged as an approximation, not as an exact reading.
    expect(approximateBillionWon("0.4")?.approximate).toBe(true);
  });

  it("still rounds a sub-unit value UP when it is at or past the half", () => {
    expect(approximateBillionWon("0.5")?.text).toBe("약 1억원");
    // Exactly on the half rounds up (away from zero), so 5,000원 → 1만원.
    expect(approximateWonAsManwon("5000")?.text).toBe("약 1만원");
    expect(approximateWonAsManwon("5000.01")?.text).toBe("약 1만원");
  });
});

describe("displayNumber — the 약 prefix is claimed only when rounding happened", () => {
  it("omits 약 when nothing was discarded", () => {
    expect(approximateBillionWon("121")?.approximate).toBe(false);
    expect(approximateBillionWon("121")?.text).toBe("121억원");
    // Trailing zeros carry no information, so they are not "discarded".
    expect(approximateBillionWon("121.000")?.text).toBe("121억원");
    expect(approximateTonPerDay("35.000000")?.approximate).toBe(false);
  });

  it("adds 약 as soon as a non-zero digit is dropped", () => {
    expect(approximateBillionWon("121.000001")?.approximate).toBe(true);
    expect(approximateBillionWon("121.000001")?.text).toBe("약 121억원");
  });
});

describe("displayNumber — malformed input is unavailable, never zero", () => {
  it("returns null rather than inventing a value", () => {
    for (const bad of [
      "",
      "  ",
      "abc",
      "12abc",
      "1,277.22",
      "1e5",
      "NaN",
      "Infinity",
      "1.2.3",
      ".5",
      "12.",
    ]) {
      expect(approximateBillionWon(bad), `"${bad}" must not be displayable`).toBeNull();
    }
  });

  it("returns null for a null-ish value forced past the type boundary", () => {
    expect(approximateBillionWon(null as unknown as string)).toBeNull();
    expect(approximateBillionWon(undefined as unknown as string)).toBeNull();
  });

  it("never returns a zero-valued string for malformed input", () => {
    // The failure this guards against: a bad parse silently rendering "0억원".
    for (const bad of ["abc", "", "1e5"]) {
      expect(approximateBillionWon(bad)?.text).not.toBe("0억원");
    }
  });

  it("tolerates surrounding whitespace on an otherwise exact string", () => {
    expect(approximateBillionWon(" 1277.222078 ")?.text).toBe("약 1,277억원");
  });
});

describe("displayNumber — very large values and no floating-point path", () => {
  it("rounds values far beyond Number.MAX_SAFE_INTEGER exactly", () => {
    // 9007199254740993 is not representable as a double (it collapses to
    // ...992), so a Number()-based implementation cannot produce this answer.
    expect(approximateBillionWon("9007199254740993.4")?.text).toBe("약 9,007,199,254,740,993억원");
    expect(approximateBillionWon("9007199254740993.5")?.text).toBe("약 9,007,199,254,740,994억원");
  });

  it("keeps every digit of an absurdly long integer", () => {
    const huge = "1".repeat(80);
    const out = approximateBillionWon(`${huge}.9`)?.text ?? "";
    // Rounded up at the last digit → …112, and grouped, with no exponent notation.
    expect(out).toContain("112억원");
    expect(out).not.toContain("e+");
    expect(out.replace(/[^0-9]/g, "")).toHaveLength(80);
  });

  it("handles a fractional part longer than a double can hold", () => {
    expect(approximateWonAsManwon(`439553.${"1".repeat(60)}`)?.text).toBe("약 44만원");
  });

  it("contains no floating-point conversion at all", () => {
    // Structural guarantee for redesign plan §5 rule 10: an approximate display may
    // never be produced through a float, because the same helpers sit one refactor
    // away from a value someone describes as exact.
    const source = readFileSync(join(__dirname, "displayNumber.ts"), "utf8");
    for (const forbidden of ["Number(", "parseFloat", "parseInt", "toFixed", "Math."]) {
      expect(source, `displayNumber.ts must not use ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("displayNumber — the exact input is never mutated", () => {
  it("leaves the caller's string identical after formatting", () => {
    const exact = "1277.222078";
    const before = `${exact}`;
    approximateBillionWon(exact);
    approximateWonAsManwon(exact);
    approximateTonPerDay(exact);
    approximatePercent(exact);
    expect(exact).toBe(before);
    expect(exact).toBe("1277.222078");
  });

  it("is pure: the same input always yields the same output", () => {
    const first = approximateBillionWon("1277.222078")?.text;
    const second = approximateBillionWon("1277.222078")?.text;
    expect(first).toBe(second);
  });

  it("cannot be used to reconstruct the exact value", () => {
    // The output is lossy BY DESIGN and says so ("약"). This test documents that
    // the approximation is not a round-trippable encoding of the exact string.
    const approx = approximateBillionWon("1277.222078");
    expect(approx?.approximate).toBe(true);
    expect(approx?.text).not.toContain("1277.222078");
    expect(approx?.text).not.toContain(".222078");
  });
});

describe("displayNumber — negative values", () => {
  it("keeps the sign rather than dropping it", () => {
    // The cost endpoint does not serve negatives today; if it ever did, a dropped
    // minus sign would be a silent sign error rather than a formatting nicety.
    expect(approximateBillionWon("-12.4")?.text).toBe("약 -12억원");
    expect(approximateBillionWon("-0")?.text).toBe("0억원");
  });
});
