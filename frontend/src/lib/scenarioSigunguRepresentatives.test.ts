/**
 * 시·군·구 대표 후보 선택 — the contract Page 5's visible TOP list rests on.
 *
 * ── WHAT THIS FILE EXISTS TO PIN ─────────────────────────────────────────────────
 * The owner's decision is that Page 5 shows each 시·군·구 AT MOST ONCE in the
 * visible comparison, because the real V3 run is so concentrated that a plain
 * "best 10 candidates" list is ten cells of one municipality (양평군, capital
 * region, baseline weights — the top FORTY-ONE candidates are all 양평군).
 *
 * The decision came with a hard analytical boundary, and these tests are what keeps
 * it: the representative is a REAL CANDIDATE, chosen by the ranking that already
 * exists. Nothing here averages, takes a median, computes a 시·군·구 score, or
 * assigns a 시·군·구 rank. The only new quantity in the whole feature is a DISPLAY
 * POSITION, and a display position is not a rank — on real data the tenth
 * representative is the candidate ranked 2,190th of 13,734.
 *
 * Tests A–H below are the eight cases the product decision named.
 */

import { describe, expect, it } from "vitest";

import {
  UNASSIGNED_SIGUNGU_KEY,
  groupRowsBySigungu,
  selectSigunguRepresentatives,
  sigunguGroupKeyOf,
} from "./scenarioSigunguGroups";

interface Row {
  candidateKey: string;
  sigunguName: string | null;
  sidoName: string | null;
  /** The candidate's REAL scenario rank. Never rewritten by the selection. */
  rank: number;
  score: string;
}

/** Rows in the order a scenario ranked them — which is the order the selector trusts. */
const row = (
  candidateKey: string,
  sigunguName: string | null,
  rank: number,
  score = "50.0000",
  sidoName: string | null = null,
): Row => ({ candidateKey, sigunguName, sidoName, rank, score });

const keysOf = (rows: readonly Row[]) => rows.map((r) => r.candidateKey);
const groupsOf = (rows: readonly Row[]) => rows.map((r) => sigunguGroupKeyOf(r));

// --------------------------------------------------------------------------- //
// TEST A — one row per 시·군·구
// --------------------------------------------------------------------------- //

describe("A — collapses repeated 시·군·구 to one row each", () => {
  const REAL_SHAPE: Row[] = [
    row("yp-1", "경기도 양평군", 1),
    row("yp-2", "경기도 양평군", 2),
    row("yp-3", "경기도 양평군", 3),
    row("as-1", "경기도 안성시", 4),
    row("as-2", "경기도 안성시", 5),
    row("yj-1", "경기도 여주시", 6),
  ];

  it("returns exactly the three distinct 시·군·구, in rank order", () => {
    const picked = selectSigunguRepresentatives(REAL_SHAPE, 10);
    expect(groupsOf(picked)).toEqual(["경기도 양평군", "경기도 안성시", "경기도 여주시"]);
  });

  it("returns no duplicate group key at all", () => {
    const groups = groupsOf(selectSigunguRepresentatives(REAL_SHAPE, 10));
    expect(new Set(groups).size).toBe(groups.length);
  });
});

// --------------------------------------------------------------------------- //
// TEST B — the representative is the HIGHEST-RANKED candidate of its 시·군·구
// --------------------------------------------------------------------------- //

describe("B — keeps each 시·군·구's best-ranked candidate", () => {
  it("takes the first row of each group, never a later or an averaged one", () => {
    const picked = selectSigunguRepresentatives(
      [
        row("yp-1", "경기도 양평군", 1),
        row("yp-2", "경기도 양평군", 2),
        row("as-1", "경기도 안성시", 42),
        row("as-2", "경기도 안성시", 43),
      ],
      10,
    );
    expect(keysOf(picked)).toEqual(["yp-1", "as-1"]);
    expect(picked.map((r) => r.rank)).toEqual([1, 42]);
  });

  it("follows the incoming ranking for ties rather than inventing a tie-break", () => {
    // Two cells of one 시·군·구 on the same score: whichever the ranking put first
    // wins, so the selector adds no ordering rule of its own.
    const tied = [
      row("b-cell", "경기도 양평군", 7, "61.0558"),
      row("a-cell", "경기도 양평군", 8, "61.0558"),
    ];
    expect(keysOf(selectSigunguRepresentatives(tied, 10))).toEqual(["b-cell"]);
    expect(keysOf(selectSigunguRepresentatives([...tied].reverse(), 10))).toEqual(["a-cell"]);
  });
});

// --------------------------------------------------------------------------- //
// TEST C — ten distinct groups available → exactly ten shown
// --------------------------------------------------------------------------- //

describe("C — caps the visible list at the requested count", () => {
  /** Twelve 시·군·구, two cells each, interleaved as a real ranking would be. */
  const TWELVE: Row[] = Array.from({ length: 24 }, (_, i) =>
    row(`c${i + 1}`, `경기도 g${(i % 12) + 1}군`, i + 1),
  );

  it("shows exactly 10 groups when 12 are available", () => {
    const picked = selectSigunguRepresentatives(TWELVE, 10);
    expect(picked).toHaveLength(10);
    expect(new Set(groupsOf(picked)).size).toBe(10);
  });

  it("keeps the ten best-ranked groups, dropping the 11th and 12th", () => {
    const picked = selectSigunguRepresentatives(TWELVE, 10);
    expect(groupsOf(picked)).toEqual(
      Array.from({ length: 10 }, (_, i) => `경기도 g${i + 1}군`),
    );
  });

  it("returns nothing for a non-positive limit rather than everything", () => {
    expect(selectSigunguRepresentatives(TWELVE, 0)).toEqual([]);
    expect(selectSigunguRepresentatives(TWELVE, -1)).toEqual([]);
  });
});

// --------------------------------------------------------------------------- //
// TEST D — fewer than ten groups → the actual number, never padded
// --------------------------------------------------------------------------- //

describe("D — shows only the 시·군·구 that genuinely exist", () => {
  it("returns two for 인천's real shape, not ten", () => {
    // The loaded V3 run really does hold just TWO rankable 시·군·구 in 인천.
    const incheon = [
      row("gh-1", "인천광역시 강화군", 1),
      row("gh-2", "인천광역시 강화군", 2),
      row("sg-1", "인천광역시 서구", 3),
    ];
    const picked = selectSigunguRepresentatives(incheon, 10);
    expect(picked).toHaveLength(2);
    expect(groupsOf(picked)).toEqual(["인천광역시 강화군", "인천광역시 서구"]);
  });

  it("returns ONE for a list that is entirely one 시·군·구", () => {
    const allYangpyeong = Array.from({ length: 41 }, (_, i) =>
      row(`yp-${i + 1}`, "경기도 양평군", i + 1),
    );
    expect(selectSigunguRepresentatives(allYangpyeong, 10)).toHaveLength(1);
  });

  it("returns an empty list for no rows, never a placeholder group", () => {
    expect(selectSigunguRepresentatives([], 10)).toEqual([]);
  });
});

// --------------------------------------------------------------------------- //
// TEST E — A and B may represent one 시·군·구 with DIFFERENT cells
// --------------------------------------------------------------------------- //

describe("E — each scenario chooses its own representative independently", () => {
  it("lets a reweighting promote a different cell of the same 시·군·구", () => {
    const scenarioA = [
      row("yp-1", "경기도 양평군", 1, "61.0558"),
      row("yp-2", "경기도 양평군", 2, "60.9000"),
    ];
    // B's weights make yp-2 the better cell — a real, expected outcome.
    const scenarioB = [
      row("yp-2", "경기도 양평군", 1, "64.2000"),
      row("yp-1", "경기도 양평군", 2, "63.1000"),
    ];

    const a = selectSigunguRepresentatives(scenarioA, 10);
    const b = selectSigunguRepresentatives(scenarioB, 10);

    expect(keysOf(a)).toEqual(["yp-1"]);
    expect(keysOf(b)).toEqual(["yp-2"]);
    // The MUNICIPALITY is the same on both sides — which is why membership must be
    // compared by group key and never by candidate key.
    expect(sigunguGroupKeyOf(a[0])).toBe(sigunguGroupKeyOf(b[0]));
    // Each side keeps its OWN representative's real score. Neither is blended.
    expect(a[0].score).toBe("61.0558");
    expect(b[0].score).toBe("64.2000");
  });
});

// --------------------------------------------------------------------------- //
// TEST F — entrants/exits are 시·군·구 membership, not candidate membership
// --------------------------------------------------------------------------- //

describe("F — membership turnover is measured on group keys", () => {
  const entrantsExits = (a: readonly Row[], b: readonly Row[]) => {
    const setA = new Set(groupsOf(selectSigunguRepresentatives(a, 10)));
    const setB = new Set(groupsOf(selectSigunguRepresentatives(b, 10)));
    return {
      entered: [...setB].filter((key) => !setA.has(key)).length,
      exited: [...setA].filter((key) => !setB.has(key)).length,
    };
  };

  it("reports NO turnover when only the representative cell changed", () => {
    const a = [row("yp-1", "경기도 양평군", 1), row("as-1", "경기도 안성시", 2)];
    const b = [row("yp-2", "경기도 양평군", 1), row("as-2", "경기도 안성시", 2)];
    // Every candidate key differs; not one municipality moved in or out.
    expect(keysOf(selectSigunguRepresentatives(a, 10))).not.toEqual(
      keysOf(selectSigunguRepresentatives(b, 10)),
    );
    expect(entrantsExits(a, b)).toEqual({ entered: 0, exited: 0 });
  });

  it("reports turnover when a 시·군·구 genuinely replaces another", () => {
    const a = [row("yp-1", "경기도 양평군", 1), row("as-1", "경기도 안성시", 2)];
    const b = [row("yp-1", "경기도 양평군", 1), row("yj-1", "경기도 여주시", 2)];
    expect(entrantsExits(a, b)).toEqual({ entered: 1, exited: 1 });
  });
});

// --------------------------------------------------------------------------- //
// TEST G — scope contamination is impossible
// --------------------------------------------------------------------------- //

describe("G — the selector cannot import a 시·군·구 the caller did not pass", () => {
  it("returns only groups present in the input", () => {
    const gyeonggiOnly = [
      row("yp-1", "경기도 양평군", 1),
      row("as-1", "경기도 안성시", 2),
    ];
    const picked = selectSigunguRepresentatives(gyeonggiOnly, 10);
    expect(groupsOf(picked).every((key) => key.startsWith("경기도"))).toBe(true);
    expect(groupsOf(picked)).not.toContain("인천광역시 강화군");
  });

  it("keeps two identically-named 시·군·구 in different 시·도 apart", () => {
    // The group key is the ALREADY-QUALIFIED served name, so the 시·도 travels with
    // it and no second identity system is needed to tell these two apart.
    const picked = selectSigunguRepresentatives(
      [row("a", "경기도 광주시", 1), row("b", "광주광역시 광주시", 2)],
      10,
    );
    expect(picked).toHaveLength(2);
  });

  it("files a row with no 시·군·구 under its 시·도, and one with neither apart", () => {
    const picked = selectSigunguRepresentatives(
      [row("a", null, 1, "50.0000", "경기도"), row("b", null, 2, "49.0000", null)],
      10,
    );
    expect(groupsOf(picked)).toEqual(["경기도", UNASSIGNED_SIGUNGU_KEY]);
  });

  it("uses the SAME identity the visual grouping uses", () => {
    // If these two ever disagreed, a 시·군·구 could be deduplicated by one and split
    // by the other — the exact drift `sigunguGroupKeyOf` was extracted to prevent.
    const rows = [
      row("a", "경기도 양평군", 1),
      row("b", "경기도 양평군", 2),
      row("c", null, 3, "48.0000", "경기도"),
      row("d", null, 4, "47.0000", null),
    ];
    expect(groupsOf(selectSigunguRepresentatives(rows, 10))).toEqual(
      groupRowsBySigungu(rows).map((group) => group.key),
    );
  });
});

// --------------------------------------------------------------------------- //
// TEST H — no candidate score or rank is mutated, and no aggregate is created
// --------------------------------------------------------------------------- //

describe("H — the selection never rewrites what it selects", () => {
  const source = (): Row[] => [
    row("yp-1", "경기도 양평군", 1, "61.0558"),
    row("yp-2", "경기도 양평군", 2, "60.9000"),
    row("hs-1", "경기도 화성시", 2190, "41.0831"),
  ];

  it("returns the very same row objects, untouched", () => {
    const rows = source();
    const picked = selectSigunguRepresentatives(rows, 10);
    expect(picked[0]).toBe(rows[0]);
    expect(picked[1]).toBe(rows[2]);
  });

  it("preserves each representative's REAL rank and REAL score", () => {
    const picked = selectSigunguRepresentatives(source(), 10);
    expect(picked.map((r) => r.rank)).toEqual([1, 2190]);
    expect(picked.map((r) => r.score)).toEqual(["61.0558", "41.0831"]);
    // The tenth-ish representative keeps a rank in the thousands: the display
    // position it will be drawn at is NOT written back over it.
    expect(picked[1].rank).not.toBe(2);
  });

  it("does not mutate the input array or reorder it", () => {
    const rows = source();
    const before = keysOf(rows);
    selectSigunguRepresentatives(rows, 1);
    expect(rows).toHaveLength(3);
    expect(keysOf(rows)).toEqual(before);
  });

  it("adds no aggregate field of any kind to a returned row", () => {
    const picked = selectSigunguRepresentatives(source(), 10);
    // Exactly the keys the caller's row already had — no average, median, group
    // score, group rank or 변동폭 has appeared alongside them.
    expect(Object.keys(picked[0]).sort()).toEqual(
      ["candidateKey", "rank", "score", "sidoName", "sigunguName"].sort(),
    );
  });
});
