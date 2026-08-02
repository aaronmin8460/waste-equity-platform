/**
 * Land-cover map-layer helper tests (Phase 1B-LC5B).
 *
 * The load-bearing properties here are the ones a reader's conclusions rest on:
 * a class code's color never depends on load order, an unevaluated cell is never
 * turned into a class, the legend always matches the filter, and an empty filter
 * selection is reported rather than silently reverted.
 *
 * Every code/name below is a SYNTHETIC TEST FIXTURE shaped like the official 세분류
 * vocabulary; it is not a copy of official data.
 */

import { describe, expect, it } from "vitest";

import {
  LAND_COVER_COVERAGE_COLORS,
  LAND_COVER_COVERAGE_LEGEND_NOTES,
  LAND_COVER_COVERAGE_STATUSES,
  LAND_COVER_LAYER_ERRORS,
  LAND_COVER_NO_CLASS_COLOR,
  type LandCoverAvailableClasses,
  collectAvailableClasses,
  defaultCoverageVisibility,
  defaultHiddenClasses,
  emptyAvailableClasses,
  hslToHex,
  landCoverClassColor,
  landCoverFillColor,
  landCoverFillOpacity,
  landCoverFilter,
  landCoverLegendEntries,
  landCoverSelectionEmpty,
  landCoverStatusOutlineFilter,
  mergeAvailableClasses,
  visibleCoverageStatuses,
} from "./landCoverLayer";

const L1_CODES = ["100", "200", "300", "400", "500", "600", "700"];
const L2_CODES = ["110", "120", "150", "210", "310", "320", "410", "510", "610", "710"];
const L3_CODES = ["111", "112", "154", "211", "311", "312", "411", "511", "611", "711"];

const CLASSES: LandCoverAvailableClasses = {
  1: [
    { code: "100", name: "시가화건조지역" },
    { code: "300", name: "산림지역" },
  ],
  2: [
    { code: "150", name: "교통지역" },
    { code: "310", name: "활엽수림" },
  ],
  3: [
    { code: "154", name: "도로" },
    { code: "311", name: "활엽수림" },
  ],
};

// --------------------------------------------------------------------------- //
// Deterministic palette
// --------------------------------------------------------------------------- //

describe("landCoverClassColor", () => {
  it("is a pure function of the code — the same code always gives the same color", () => {
    for (const code of [...L1_CODES, ...L2_CODES, ...L3_CODES]) {
      const first = landCoverClassColor(code);
      expect(landCoverClassColor(code)).toBe(first);
      // ...and is unaffected by whichever other codes were asked about in between.
      landCoverClassColor("999");
      expect(landCoverClassColor(code)).toBe(first);
    }
  });

  it("returns a plain #rrggbb hex string", () => {
    for (const code of [...L1_CODES, ...L2_CODES, ...L3_CODES]) {
      expect(landCoverClassColor(code)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each([
    ["L1 대분류", L1_CODES],
    ["L2 중분류", L2_CODES],
    ["L3 세분류", L3_CODES],
  ])("gives every %s code a distinct color", (_label, codes) => {
    const colors = codes.map(landCoverClassColor);
    expect(new Set(colors).size).toBe(codes.length);
  });

  it("does not depend on array position — a reversed list yields the same colors", () => {
    const forward = L3_CODES.map(landCoverClassColor);
    const reversed = [...L3_CODES].reverse().map(landCoverClassColor).reverse();
    expect(reversed).toEqual(forward);
  });

  it("gives codes sharing a leading digit related hues (a readable long legend)", () => {
    // A grouping of the CODE SPACE, asserted structurally: same-family codes differ
    // only in lightness/saturation, so their channel ordering (which channel is
    // largest) is shared, while a different family differs in hue.
    const dominantChannel = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return r >= g && r >= b ? "r" : g >= b ? "g" : "b";
    };
    expect(dominantChannel(landCoverClassColor("310"))).toBe(
      dominantChannel(landCoverClassColor("311")),
    );
    expect(dominantChannel(landCoverClassColor("700"))).not.toBe(
      dominantChannel(landCoverClassColor("300")),
    );
  });

  it("still gives an unexpected code shape a stable color instead of dropping it", () => {
    const odd = landCoverClassColor("UM901-x");
    expect(odd).toMatch(/^#[0-9a-f]{6}$/);
    expect(landCoverClassColor("UM901-x")).toBe(odd);
    expect(landCoverClassColor("UM901-y")).not.toBe(odd);
  });
});

describe("hslToHex", () => {
  it.each([
    [0, 100, 50, "#ff0000"],
    [120, 100, 50, "#00ff00"],
    [240, 100, 50, "#0000ff"],
    [0, 0, 100, "#ffffff"],
    [0, 0, 0, "#000000"],
  ])("converts hsl(%i, %i%%, %i%%)", (h, s, l, expected) => {
    expect(hslToHex(h, s, l)).toBe(expected);
  });
});

// --------------------------------------------------------------------------- //
// Class collection from tiles
// --------------------------------------------------------------------------- //

describe("collectAvailableClasses", () => {
  const FEATURES = [
    {
      properties: {
        coverage_status: "COMPLETE_EXACT",
        dominant_l1_code: "300",
        dominant_l1_name: "산림지역",
        dominant_l2_code: "310",
        dominant_l2_name: "활엽수림",
        dominant_l3_code: "311",
        dominant_l3_name: "활엽수림",
      },
    },
    {
      properties: {
        coverage_status: "PARTIAL",
        dominant_l1_code: "100",
        dominant_l1_name: "시가화건조지역",
        dominant_l2_code: "150",
        dominant_l2_name: "교통지역",
        dominant_l3_code: "154",
        dominant_l3_name: "도로",
      },
    },
    // A NO_COVERAGE cell: no dominant-class property at any level.
    { properties: { coverage_status: "NO_COVERAGE" } },
  ];

  it("collects the official codes and names verbatim, ordered by code", () => {
    const result = collectAvailableClasses(FEATURES);
    expect(result[1]).toEqual([
      { code: "100", name: "시가화건조지역" },
      { code: "300", name: "산림지역" },
    ]);
    expect(result[3]).toEqual([
      { code: "154", name: "도로" },
      { code: "311", name: "활엽수림" },
    ]);
  });

  it("is order-independent — shuffling the tile features changes nothing", () => {
    const forward = collectAvailableClasses(FEATURES);
    const backward = collectAvailableClasses([...FEATURES].reverse());
    expect(backward).toEqual(forward);
  });

  it("contributes no class for a cell with no dominant class", () => {
    const result = collectAvailableClasses([{ properties: { coverage_status: "NO_COVERAGE" } }]);
    expect(result).toEqual(emptyAvailableClasses());
    // No synthesized 기타 / Unknown / 미분류 bucket anywhere.
    expect(JSON.stringify(result)).not.toContain("기타");
    expect(JSON.stringify(result)).not.toContain("Unknown");
  });

  it("ignores features with no properties at all", () => {
    expect(collectAvailableClasses([{ properties: null }, {}])).toEqual(emptyAvailableClasses());
  });
});

describe("mergeAvailableClasses", () => {
  it("adds newly-seen classes and keeps official code order", () => {
    const previous: LandCoverAvailableClasses = {
      1: [{ code: "300", name: "산림지역" }],
      2: [],
      3: [],
    };
    const merged = mergeAvailableClasses(previous, {
      1: [{ code: "100", name: "시가화건조지역" }],
      2: [],
      3: [],
    });
    expect(merged[1].map((option) => option.code)).toEqual(["100", "300"]);
  });

  it("never drops a class that panned out of the viewport", () => {
    const previous: LandCoverAvailableClasses = {
      1: [{ code: "300", name: "산림지역" }],
      2: [],
      3: [],
    };
    expect(mergeAvailableClasses(previous, emptyAvailableClasses())[1]).toEqual(previous[1]);
  });

  it("returns the SAME object when nothing was added (so no re-render is forced)", () => {
    const previous: LandCoverAvailableClasses = {
      1: [{ code: "300", name: "산림지역" }],
      2: [],
      3: [],
    };
    expect(mergeAvailableClasses(previous, { 1: [{ code: "300", name: "산림지역" }], 2: [], 3: [] })).toBe(
      previous,
    );
  });
});

// --------------------------------------------------------------------------- //
// Paint expressions
// --------------------------------------------------------------------------- //

describe("landCoverFillColor", () => {
  it("matches the three coverage statuses in coverage mode", () => {
    const expression = JSON.stringify(landCoverFillColor("coverage", 1, CLASSES[1]));
    for (const status of LAND_COVER_COVERAGE_STATUSES) {
      expect(expression).toContain(status);
      expect(expression).toContain(LAND_COVER_COVERAGE_COLORS[status]);
    }
  });

  it("gives NO_COVERAGE a neutral treatment distinct from both evaluated states", () => {
    expect(LAND_COVER_COVERAGE_COLORS.NO_COVERAGE).not.toBe(
      LAND_COVER_COVERAGE_COLORS.COMPLETE_EXACT,
    );
    expect(LAND_COVER_COVERAGE_COLORS.NO_COVERAGE).not.toBe(LAND_COVER_COVERAGE_COLORS.PARTIAL);
    // The same neutral tone is reused for "no dominant class", so the unevaluated
    // state reads identically in both visualization modes.
    expect(LAND_COVER_NO_CLASS_COLOR).toBe(LAND_COVER_COVERAGE_COLORS.NO_COVERAGE);
  });

  it.each([
    [1, "dominant_l1_code"],
    [2, "dominant_l2_code"],
    [3, "dominant_l3_code"],
  ] as const)("reads the level-%i dominant code in dominant mode", (level, property) => {
    const expression = JSON.stringify(landCoverFillColor("dominant", level, CLASSES[level]));
    expect(expression).toContain(property);
    for (const option of CLASSES[level]) {
      expect(expression).toContain(option.code);
      expect(expression).toContain(landCoverClassColor(option.code));
    }
  });

  it("keeps the unevaluated treatment for a cell with no dominant class", () => {
    const expression = JSON.stringify(landCoverFillColor("dominant", 1, CLASSES[1]));
    expect(expression).toContain('["!",["has","dominant_l1_code"]]');
    expect(expression).toContain(LAND_COVER_NO_CLASS_COLOR);
  });

  it("stays a valid expression before any class has been observed", () => {
    const expression = landCoverFillColor("dominant", 2, []);
    // MapLibre rejects a `match` with no label pairs, so this degrades to `case`.
    expect(expression[0]).toBe("case");
    expect(JSON.stringify(expression)).toContain(LAND_COVER_NO_CLASS_COLOR);
  });
});

describe("landCoverFillOpacity", () => {
  it("separates the three coverage states by opacity as well as by color", () => {
    const expression = JSON.stringify(landCoverFillOpacity());
    expect(expression).toContain("NO_COVERAGE");
    expect(expression).toContain("PARTIAL");
    // Never fully opaque: the suitability grid beneath stays perceptible.
    for (const value of [0.34, 0.6, 0.72]) expect(expression).toContain(String(value));
  });
});

// --------------------------------------------------------------------------- //
// Filters
// --------------------------------------------------------------------------- //

describe("landCoverFilter", () => {
  const ALL = defaultCoverageVisibility();

  it("keeps all three statuses by default", () => {
    expect(visibleCoverageStatuses(ALL)).toEqual([...LAND_COVER_COVERAGE_STATUSES]);
    expect(JSON.stringify(landCoverFilter("coverage", 1, ALL, []))).toContain("NO_COVERAGE");
  });

  it("ORs within the coverage group — a disabled status leaves the list", () => {
    const filter = landCoverFilter(
      "coverage",
      1,
      { COMPLETE_EXACT: true, PARTIAL: false, NO_COVERAGE: true },
      [],
    );
    expect(filter).toEqual([
      "in",
      ["get", "coverage_status"],
      ["literal", ["COMPLETE_EXACT", "NO_COVERAGE"]],
    ]);
  });

  it("selects nothing when every status is disabled (never reverts to all)", () => {
    const filter = landCoverFilter(
      "coverage",
      1,
      { COMPLETE_EXACT: false, PARTIAL: false, NO_COVERAGE: false },
      [],
    );
    expect(filter).toEqual(["in", ["get", "coverage_status"], ["literal", []]]);
  });

  it("ignores class filters outside dominant-class mode", () => {
    expect(landCoverFilter("coverage", 1, ALL, ["300"])).toEqual(
      landCoverFilter("coverage", 1, ALL, []),
    );
  });

  it("ANDs the coverage group with the class group in dominant mode", () => {
    const filter = landCoverFilter("dominant", 2, ALL, ["310"]);
    expect(filter[0]).toBe("all");
    expect(JSON.stringify(filter)).toContain("coverage_status");
    expect(JSON.stringify(filter)).toContain("dominant_l2_code");
    expect(JSON.stringify(filter)).toContain("310");
  });

  it("exempts a cell with no dominant class from the class group", () => {
    // Otherwise unchecking any class would delete every NO_COVERAGE cell from the
    // map — hiding a real state under the guise of filtering a class.
    expect(JSON.stringify(landCoverFilter("dominant", 3, ALL, ["311"]))).toContain(
      '["!",["has","dominant_l3_code"]]',
    );
  });

  it("uses the ACTIVE level's property when the level changes", () => {
    expect(JSON.stringify(landCoverFilter("dominant", 1, ALL, ["100"]))).toContain(
      "dominant_l1_code",
    );
    expect(JSON.stringify(landCoverFilter("dominant", 3, ALL, ["154"]))).toContain(
      "dominant_l3_code",
    );
  });
});

describe("landCoverStatusOutlineFilter", () => {
  it("ANDs the per-status outline with the layer-wide filter", () => {
    const base = landCoverFilter("coverage", 1, defaultCoverageVisibility(), []);
    const filter = landCoverStatusOutlineFilter("PARTIAL", base);
    expect(filter[0]).toBe("all");
    expect(filter[1]).toEqual(base);
    expect(filter[2]).toEqual(["==", ["get", "coverage_status"], "PARTIAL"]);
  });
});

describe("landCoverSelectionEmpty", () => {
  const ALL = defaultCoverageVisibility();

  it("is false with the default filters", () => {
    expect(landCoverSelectionEmpty("coverage", 1, ALL, CLASSES, [])).toBe(false);
    expect(landCoverSelectionEmpty("dominant", 1, ALL, CLASSES, [])).toBe(false);
  });

  it("is true when every coverage status is disabled", () => {
    const none = { COMPLETE_EXACT: false, PARTIAL: false, NO_COVERAGE: false };
    expect(landCoverSelectionEmpty("coverage", 1, none, CLASSES, [])).toBe(true);
  });

  it("is true when every available class at the active level is hidden", () => {
    const hidden = CLASSES[1].map((option) => option.code);
    const noUncovered = { COMPLETE_EXACT: true, PARTIAL: true, NO_COVERAGE: false };
    expect(landCoverSelectionEmpty("dominant", 1, noUncovered, CLASSES, hidden)).toBe(true);
  });

  it("is false when all classes are hidden but NO_COVERAGE stays visible", () => {
    // Those cells have no dominant class, so they are still legitimately drawn.
    const hidden = CLASSES[1].map((option) => option.code);
    expect(landCoverSelectionEmpty("dominant", 1, ALL, CLASSES, hidden)).toBe(false);
  });

  it("is false before any class has been observed (nothing has been excluded yet)", () => {
    expect(landCoverSelectionEmpty("dominant", 2, ALL, emptyAvailableClasses(), [])).toBe(false);
  });
});

// --------------------------------------------------------------------------- //
// Dynamic legend
// --------------------------------------------------------------------------- //

describe("landCoverLegendEntries", () => {
  const ALL = defaultCoverageVisibility();

  it("lists the three coverage states with their colors and machine statuses", () => {
    const entries = landCoverLegendEntries("coverage", 1, ALL, CLASSES, []);
    expect(entries.map((entry) => entry.key)).toEqual([...LAND_COVER_COVERAGE_STATUSES]);
    for (const entry of entries) {
      expect(entry.color).toBe(
        LAND_COVER_COVERAGE_COLORS[entry.key as keyof typeof LAND_COVER_COVERAGE_COLORS],
      );
      // The machine status is always carried in text, so status is never color-only.
      expect(entry.secondary).toBe(entry.key);
      expect(entry.label).not.toBe("");
    }
  });

  it("carries the required NO_COVERAGE semantic warning", () => {
    const entries = landCoverLegendEntries("coverage", 1, ALL, CLASSES, []);
    const note = entries.find((entry) => entry.key === "NO_COVERAGE")!.note!;
    expect(note).toBe(LAND_COVER_COVERAGE_NOTE);
    expect(note).toContain("평가하지 않았습니다");
    expect(note).toContain("적합하거나 안전하다는 뜻도 아닙니다");
  });

  it("reflects the coverage checkboxes", () => {
    const entries = landCoverLegendEntries(
      "coverage",
      1,
      { COMPLETE_EXACT: true, PARTIAL: false, NO_COVERAGE: true },
      CLASSES,
      [],
    );
    expect(entries.map((entry) => entry.visible)).toEqual([true, false, true]);
  });

  it.each([1, 2, 3] as const)("lists the level-%i classes with official code and name", (level) => {
    const entries = landCoverLegendEntries("dominant", level, ALL, CLASSES, []);
    expect(entries.map((entry) => entry.secondary)).toEqual(
      CLASSES[level].map((option) => option.code),
    );
    expect(entries.map((entry) => entry.label)).toEqual(
      CLASSES[level].map((option) => option.name),
    );
    expect(entries.map((entry) => entry.color)).toEqual(
      CLASSES[level].map((option) => landCoverClassColor(option.code)),
    );
  });

  it("never invents an Unknown / Other / 기타 class row", () => {
    const serialized = JSON.stringify(landCoverLegendEntries("dominant", 3, ALL, CLASSES, []));
    for (const invented of ["기타", "미분류", "Unknown", "UNKNOWN", "Other"]) {
      expect(serialized).not.toContain(invented);
    }
    expect(landCoverLegendEntries("dominant", 3, ALL, CLASSES, [])).toHaveLength(
      CLASSES[3].length,
    );
  });

  it("marks a hidden class as hidden rather than removing its row", () => {
    const entries = landCoverLegendEntries("dominant", 1, ALL, CLASSES, ["300"]);
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.key === "300")!.visible).toBe(false);
    expect(entries.find((entry) => entry.key === "100")!.visible).toBe(true);
  });

  it("is empty (not fabricated) before any class has been observed", () => {
    expect(landCoverLegendEntries("dominant", 2, ALL, emptyAvailableClasses(), [])).toEqual([]);
  });
});

describe("defaults", () => {
  it("enables all coverage statuses and hides no class", () => {
    expect(defaultCoverageVisibility()).toEqual({
      COMPLETE_EXACT: true,
      PARTIAL: true,
      NO_COVERAGE: true,
    });
    expect(defaultHiddenClasses()).toEqual({ 1: [], 2: [], 3: [] });
  });
});

describe("LAND_COVER_LAYER_ERRORS", () => {
  it("never implies land cover is absent and never leaks internals", () => {
    for (const message of Object.values(LAND_COVER_LAYER_ERRORS)) {
      expect(message).not.toContain("SELECT");
      expect(message).not.toContain("postgres");
      expect(message).not.toContain("Traceback");
      expect(message).not.toContain("/Users");
    }
    expect(LAND_COVER_LAYER_ERRORS.NOT_FOUND).toContain("토지피복이 없다는 뜻은 아닙니다");
    expect(LAND_COVER_LAYER_ERRORS.UNAVAILABLE).toContain("토지피복이 없다는 뜻은 아니며");
  });

  // Phase 1B-LC6: the "not absent land cover" clause is required of EVERY message, not
  // of the two that happened to be asserted individually. MALFORMED was missing it, so
  // a reader who hit an unparseable release response saw the layer refuse to draw with
  // no statement that land cover still exists there. Asserted over the whole record so
  // a future message cannot be added without it.
  it("states in EVERY message that the failure is not absent land cover", () => {
    // Only the shared stem: the messages negate differently ("…뜻은 아닙니다" vs
    // "…뜻은 아니며"), and "아닙니다" does not contain "아니" — 닙 follows 아, not 니.
    for (const [kind, message] of Object.entries(LAND_COVER_LAYER_ERRORS)) {
      expect(message, `${kind} must say the failure is not absent land cover`).toContain(
        "토지피복이 없다는 뜻은",
      );
    }
  });
});

const LAND_COVER_COVERAGE_NOTE = LAND_COVER_COVERAGE_LEGEND_NOTES.NO_COVERAGE;
