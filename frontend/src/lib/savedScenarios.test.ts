// @vitest-environment jsdom

/**
 * The saved-scenario storage contract (Page 4D).
 *
 * This is the layer Page 5 will trust, so the tests pin the properties that make
 * it trustworthy rather than the happy path alone:
 *
 *   - identity survives a rename (a shared `cmpA` link must not rot);
 *   - a rename never becomes a delete-then-create;
 *   - nothing is ever evicted to make room;
 *   - bad stored data degrades to "fewer rows + a warning", never to an exception;
 *   - a refused write leaves the store exactly as it was.
 *
 * jsdom, because `localStorage` is the subject. Every weight vector below is a
 * synthetic fixture and carries no official evidence label.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SAVED_SCENARIOS_STORAGE_KEY,
  SAVED_SCENARIO_CAP,
  SAVED_SCENARIO_ID_RE,
  SAVED_SCENARIO_NAME_MAX_LENGTH,
  SAVED_SCENARIO_SCHEMA_VERSION,
  clearSavedScenarios,
  deleteSavedScenario,
  isCanonicalWeights,
  readSavedScenarios,
  renameSavedScenario,
  resolveComparisonPair,
  saveScenario,
  scenarioNameLength,
  scenarioNameProblem,
  scenarioRunState,
  type SavedScenario,
} from "./savedScenarios";

const WEIGHTS = {
  zoning: "0.40000000",
  road: "0.30000000",
  equity: "0.20000000",
  demand: "0.10000000",
};

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-02-02T00:00:00.000Z";

/** Write an arbitrary blob under the real key, to exercise the read guards. */
function seedRaw(value: string): void {
  localStorage.setItem(SAVED_SCENARIOS_STORAGE_KEY, value);
}

function seedEnvelope(scenarios: unknown[], schemaVersion = SAVED_SCENARIO_SCHEMA_VERSION): void {
  seedRaw(JSON.stringify({ schemaVersion, scenarios }));
}

function scenarioFixture(overrides: Partial<SavedScenario> = {}): Record<string, unknown> {
  return {
    schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION,
    id: "fixture-a",
    name: "기준안",
    weights: WEIGHTS,
    runId: 47,
    profileSource: "baseline",
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("save / list", () => {
  it("saves a scenario and lists it back with the weights and run intact", () => {
    const result = saveScenario(
      { name: "균형안", weights: WEIGHTS, runId: 47, profileSource: "baseline" },
      { now: T0, id: "abc" },
    );

    expect(result.ok).toBe(true);
    expect(result.scenarios).toHaveLength(1);

    const { scenarios, warnings } = readSavedScenarios();
    expect(warnings).toEqual([]);
    expect(scenarios[0]).toEqual({
      schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION,
      id: "abc",
      name: "균형안",
      weights: WEIGHTS,
      runId: 47,
      profileSource: "baseline",
      createdAt: T0,
      updatedAt: T0,
    });
  });

  it("returns an empty list, not an error, when nothing has ever been saved", () => {
    expect(readSavedScenarios()).toEqual({ scenarios: [], warnings: [] });
  });

  it("mints a URL-safe id when the caller supplies none", () => {
    const result = saveScenario({ name: "자동", weights: WEIGHTS, runId: 47 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenario.id).toMatch(SAVED_SCENARIO_ID_RE);
  });

  it("never reuses an id already in the store", () => {
    saveScenario({ name: "첫째", weights: WEIGHTS, runId: 47 }, { id: "dup" });
    const second = saveScenario({ name: "둘째", weights: WEIGHTS, runId: 47 }, { id: "dup" });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.scenario.id).not.toBe("dup");
    expect(second.scenarios).toHaveLength(2);
    expect(new Set(second.scenarios.map((s) => s.id)).size).toBe(2);
  });

  it("trims the name and defaults profileSource to null", () => {
    const result = saveScenario({ name: "  여백  ", weights: WEIGHTS, runId: 47 }, { id: "t" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenario.name).toBe("여백");
    expect(result.scenario.profileSource).toBeNull();
  });
});

describe("name rules", () => {
  it("rejects an empty name", () => {
    const result = saveScenario({ name: "", weights: WEIGHTS, runId: 47 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INVALID_NAME_EMPTY");
    expect(readSavedScenarios().scenarios).toHaveLength(0);
  });

  it("rejects a whitespace-only name", () => {
    const result = saveScenario({ name: "   \t \n ", weights: WEIGHTS, runId: 47 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INVALID_NAME_EMPTY");
    expect(readSavedScenarios().scenarios).toHaveLength(0);
  });

  it(`accepts exactly ${SAVED_SCENARIO_NAME_MAX_LENGTH} characters and refuses one more`, () => {
    const atLimit = "가".repeat(SAVED_SCENARIO_NAME_MAX_LENGTH);
    const overLimit = "가".repeat(SAVED_SCENARIO_NAME_MAX_LENGTH + 1);

    expect(scenarioNameProblem(atLimit)).toBeNull();
    expect(scenarioNameProblem(overLimit)).toBe("INVALID_NAME_TOO_LONG");

    expect(saveScenario({ name: atLimit, weights: WEIGHTS, runId: 47 }, { id: "ok" }).ok).toBe(true);
    const tooLong = saveScenario({ name: overLimit, weights: WEIGHTS, runId: 47 });
    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) return;
    expect(tooLong.reason).toBe("INVALID_NAME_TOO_LONG");
  });

  it("counts code points, so a surrogate-pair character costs one, not two", () => {
    // Otherwise the `n/15` counter charges a reader twice for one character.
    expect(scenarioNameLength("🌱")).toBe(1);
    expect("🌱".length).toBe(2);
  });

  it("measures the length AFTER trimming, so trailing spaces cannot overflow it", () => {
    const padded = `${"가".repeat(SAVED_SCENARIO_NAME_MAX_LENGTH)}   `;
    expect(scenarioNameProblem(padded)).toBeNull();
  });
});

describe("weight rules", () => {
  it("accepts served profile weights that sum to one under float addition", () => {
    // 0.4 + 0.3 + 0.2 + 0.1 === 0.9999999999999999 in binary floating point.
    expect(isCanonicalWeights({ zoning: "0.4", road: "0.3", equity: "0.2", demand: "0.1" })).toBe(
      true,
    );
  });

  it.each([
    ["a missing component", { zoning: "0.5", road: "0.5", equity: "0.0" }],
    ["a sum that is not one", { zoning: "0.5", road: "0.5", equity: "0.5", demand: "0.5" }],
    ["a value above one", { zoning: "1.5", road: "0", equity: "0", demand: "-0.5" }],
    ["numbers instead of decimal strings", { zoning: 0.4, road: 0.3, equity: 0.2, demand: 0.1 }],
    ["NaN", { zoning: "NaN", road: "0.3", equity: "0.2", demand: "0.1" }],
    ["more than 8 fractional digits", { zoning: "0.400000001", road: "0.3", equity: "0.2", demand: "0.099999999" }],
    ["null", null],
  ])("rejects %s", (_label, weights) => {
    expect(isCanonicalWeights(weights)).toBe(false);
  });

  it("refuses to save invalid weights and writes nothing", () => {
    const result = saveScenario({
      name: "잘못된 가중치",
      weights: { zoning: "0.5", road: "0.5", equity: "0.5", demand: "0.5" },
      runId: 47,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INVALID_WEIGHTS");
    expect(localStorage.getItem(SAVED_SCENARIOS_STORAGE_KEY)).toBeNull();
  });

  it("refuses to save without a usable run id", () => {
    const result = saveScenario({ name: "실행 없음", weights: WEIGHTS, runId: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("INVALID_RUN");
  });
});

describe("rename", () => {
  it("preserves id, weights, run and createdAt, and moves only updatedAt", () => {
    saveScenario(
      { name: "옛 이름", weights: WEIGHTS, runId: 47, profileSource: "critic" },
      { now: T0, id: "keep-me" },
    );

    const renamed = renameSavedScenario("keep-me", "새 이름", { now: T1 });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;

    expect(renamed.scenario).toEqual({
      schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION,
      id: "keep-me",
      name: "새 이름",
      weights: WEIGHTS,
      runId: 47,
      profileSource: "critic",
      createdAt: T0,
      updatedAt: T1,
    });
    // …and it is a rename, not a replacement: still exactly one row.
    expect(readSavedScenarios().scenarios).toHaveLength(1);
  });

  it("keeps the scenario at its original position in the list", () => {
    saveScenario({ name: "첫째", weights: WEIGHTS, runId: 47 }, { id: "one" });
    saveScenario({ name: "둘째", weights: WEIGHTS, runId: 47 }, { id: "two" });
    saveScenario({ name: "셋째", weights: WEIGHTS, runId: 47 }, { id: "three" });

    renameSavedScenario("two", "가운데");
    expect(readSavedScenarios().scenarios.map((s) => s.id)).toEqual(["one", "two", "three"]);
  });

  it("enforces the same name rules as save, and changes nothing when it refuses", () => {
    saveScenario({ name: "원래", weights: WEIGHTS, runId: 47 }, { now: T0, id: "r" });

    const empty = renameSavedScenario("r", "   ");
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.reason).toBe("INVALID_NAME_EMPTY");

    const long = renameSavedScenario("r", "가".repeat(SAVED_SCENARIO_NAME_MAX_LENGTH + 1));
    expect(long.ok).toBe(false);
    if (long.ok) return;
    expect(long.reason).toBe("INVALID_NAME_TOO_LONG");

    const stored = readSavedScenarios().scenarios[0];
    expect(stored.name).toBe("원래");
    expect(stored.updatedAt).toBe(T0);
  });

  it("reports an unknown id rather than creating a scenario", () => {
    const result = renameSavedScenario("nope", "이름");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("NOT_FOUND");
    expect(readSavedScenarios().scenarios).toHaveLength(0);
  });
});

describe("delete", () => {
  it("removes only the named scenario", () => {
    saveScenario({ name: "첫째", weights: WEIGHTS, runId: 47 }, { id: "one" });
    saveScenario({ name: "둘째", weights: WEIGHTS, runId: 47 }, { id: "two" });

    const result = deleteSavedScenario("one");
    expect(result.ok).toBe(true);
    expect(readSavedScenarios().scenarios.map((s) => s.id)).toEqual(["two"]);
  });

  it("reports an unknown id", () => {
    const result = deleteSavedScenario("ghost");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("NOT_FOUND");
  });

  it("leaves a deleted scenario's A/B slot resolvably MISSING, never silently empty", () => {
    saveScenario({ name: "가", weights: WEIGHTS, runId: 47 }, { id: "aaa" });
    saveScenario({ name: "나", weights: WEIGHTS, runId: 47 }, { id: "bbb" });
    deleteSavedScenario("aaa");

    const { scenarios } = readSavedScenarios();
    const resolved = resolveComparisonPair(scenarios, "aaa", "bbb");
    expect(resolved.a.state).toBe("MISSING");
    expect(resolved.b.state).toBe("RESOLVED");
    expect(resolved.selectedCount).toBe(1);
    expect(resolved.complete).toBe(false);
  });
});

describe("cap", () => {
  it(`refuses the ${SAVED_SCENARIO_CAP + 1}th save and deletes nothing`, () => {
    for (let i = 0; i < SAVED_SCENARIO_CAP; i++) {
      expect(saveScenario({ name: `안 ${i}`, weights: WEIGHTS, runId: 47 }, { id: `s${i}` }).ok).toBe(
        true,
      );
    }

    const overflow = saveScenario({ name: "넘침", weights: WEIGHTS, runId: 47 }, { id: "over" });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.reason).toBe("CAP_REACHED");

    const { scenarios } = readSavedScenarios();
    expect(scenarios).toHaveLength(SAVED_SCENARIO_CAP);
    // The FIRST scenario is still there — nothing was evicted to make room.
    expect(scenarios[0].id).toBe("s0");
    expect(scenarios.some((s) => s.id === "over")).toBe(false);
  });

  it("displays an over-cap stored list in full rather than truncating saved work", () => {
    seedEnvelope(
      Array.from({ length: SAVED_SCENARIO_CAP + 3 }, (_, i) =>
        scenarioFixture({ id: `legacy-${i}`, name: `옛 ${i}` }),
      ),
    );
    expect(readSavedScenarios().scenarios).toHaveLength(SAVED_SCENARIO_CAP + 3);
  });
});

describe("corrupt / hostile stored data", () => {
  it("survives malformed JSON with a warning and an empty list", () => {
    seedRaw("{not json at all");
    const result = readSavedScenarios();
    expect(result.scenarios).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("survives a JSON scalar where an envelope was expected", () => {
    seedRaw('"just a string"');
    expect(readSavedScenarios().scenarios).toEqual([]);
  });

  it("ignores a wrong envelope schema version wholesale", () => {
    seedEnvelope([scenarioFixture()], 99);
    const result = readSavedScenarios();
    expect(result.scenarios).toEqual([]);
    expect(result.warnings[0]).toContain("형식");
  });

  it("drops individual entries with a wrong entry schema version", () => {
    seedEnvelope([scenarioFixture({ id: "good" }), { ...scenarioFixture({ id: "bad" }), schemaVersion: 2 }]);
    const result = readSavedScenarios();
    expect(result.scenarios.map((s) => s.id)).toEqual(["good"]);
    expect(result.warnings).toHaveLength(1);
  });

  it("drops entries with invalid weights, a missing run id, or a bad name", () => {
    seedEnvelope([
      scenarioFixture({ id: "good" }),
      { ...scenarioFixture({ id: "badweights" }), weights: { zoning: "2", road: "0", equity: "0", demand: "0" } },
      { ...scenarioFixture({ id: "norun" }), runId: undefined },
      { ...scenarioFixture({ id: "blank" }), name: "   " },
      { ...scenarioFixture({ id: "nodate" }), createdAt: 12345 },
    ]);
    const result = readSavedScenarios();
    expect(result.scenarios.map((s) => s.id)).toEqual(["good"]);
    expect(result.warnings.join(" ")).toContain("4개");
  });

  it("drops an id that could not survive a URL round-trip", () => {
    seedEnvelope([scenarioFixture({ id: "has spaces & ?" }), scenarioFixture({ id: "fine" })]);
    expect(readSavedScenarios().scenarios.map((s) => s.id)).toEqual(["fine"]);
  });

  it("keeps the first of a duplicated id and warns about the rest", () => {
    seedEnvelope([
      scenarioFixture({ id: "same", name: "첫째" }),
      scenarioFixture({ id: "same", name: "둘째" }),
    ]);
    const result = readSavedScenarios();
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].name).toBe("첫째");
    expect(result.warnings.join(" ")).toContain("같은 번호");
  });

  it("does not let extra stored properties ride along into the weights object", () => {
    seedEnvelope([
      scenarioFixture({ weights: { ...WEIGHTS, injected: "1.0" } as never }),
    ]);
    expect(Object.keys(readSavedScenarios().scenarios[0].weights).sort()).toEqual([
      "demand",
      "equity",
      "road",
      "zoning",
    ]);
  });

  it("saves cleanly over a corrupt blob instead of throwing", () => {
    seedRaw("💥 not json");
    const result = saveScenario({ name: "복구", weights: WEIGHTS, runId: 47 }, { id: "fresh" });
    expect(result.ok).toBe(true);
    expect(readSavedScenarios().scenarios.map((s) => s.id)).toEqual(["fresh"]);
  });
});

describe("quota and unavailable storage", () => {
  it("reports a quota rejection and leaves the previous list untouched", () => {
    saveScenario({ name: "기존", weights: WEIGHTS, runId: 47 }, { id: "kept" });

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("exceeded", "QuotaExceededError");
    });

    const result = saveScenario({ name: "넘침", weights: WEIGHTS, runId: 47 }, { id: "lost" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("QUOTA_EXCEEDED");
    expect(result.message).toContain("저장 공간");

    setItem.mockRestore();
    expect(readSavedScenarios().scenarios.map((s) => s.id)).toEqual(["kept"]);
  });

  it("reports a quota rejection on rename too, without losing the old name", () => {
    saveScenario({ name: "원래", weights: WEIGHTS, runId: 47 }, { id: "q" });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("exceeded", "QuotaExceededError");
    });

    const result = renameSavedScenario("q", "새 이름");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("QUOTA_EXCEEDED");

    setItem.mockRestore();
    expect(readSavedScenarios().scenarios[0].name).toBe("원래");
  });

  it("degrades to an empty list when reading storage throws", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const result = readSavedScenarios();
    expect(result.scenarios).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    getItem.mockRestore();
  });

  it("clears without throwing when storage is unavailable", () => {
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => clearSavedScenarios()).not.toThrow();
    removeItem.mockRestore();
  });
});

describe("run compatibility", () => {
  it("marks a scenario from the active run as current and any other run as OTHER_RUN", () => {
    saveScenario({ name: "실행 47", weights: WEIGHTS, runId: 47 }, { id: "r47" });
    const [scenario] = readSavedScenarios().scenarios;

    expect(scenarioRunState(scenario, 47)).toBe("CURRENT_RUN");
    expect(scenarioRunState(scenario, 48)).toBe("OTHER_RUN");
  });

  it("treats an unknown active run as OTHER_RUN — never as a match by default", () => {
    saveScenario({ name: "실행 47", weights: WEIGHTS, runId: 47 }, { id: "r47" });
    const [scenario] = readSavedScenarios().scenarios;
    expect(scenarioRunState(scenario, null)).toBe("OTHER_RUN");
  });
});

describe("A/B resolution", () => {
  function twoSaved(): SavedScenario[] {
    saveScenario({ name: "가", weights: WEIGHTS, runId: 47 }, { id: "aaa" });
    saveScenario({ name: "나", weights: WEIGHTS, runId: 47 }, { id: "bbb" });
    return readSavedScenarios().scenarios;
  }

  it("reports 0/2 with nothing selected", () => {
    const resolved = resolveComparisonPair(twoSaved(), null, null);
    expect(resolved.selectedCount).toBe(0);
    expect(resolved.a.state).toBe("EMPTY");
    expect(resolved.complete).toBe(false);
  });

  it("reports 1/2 with only A selected", () => {
    const resolved = resolveComparisonPair(twoSaved(), "aaa", null);
    expect(resolved.selectedCount).toBe(1);
    expect(resolved.a.scenario?.name).toBe("가");
    expect(resolved.complete).toBe(false);
  });

  it("reports 2/2 and complete with two distinct scenarios, preserving A/B order", () => {
    const resolved = resolveComparisonPair(twoSaved(), "bbb", "aaa");
    expect(resolved.selectedCount).toBe(2);
    expect(resolved.complete).toBe(true);
    expect(resolved.a.scenario?.id).toBe("bbb");
    expect(resolved.b.scenario?.id).toBe("aaa");
  });

  it("is never complete when both slots name the same scenario", () => {
    const resolved = resolveComparisonPair(twoSaved(), "aaa", "aaa");
    expect(resolved.complete).toBe(false);
  });

  it("is never complete when a slot points at a scenario this browser does not hold", () => {
    const resolved = resolveComparisonPair(twoSaved(), "aaa", "from-another-device");
    expect(resolved.b.state).toBe("MISSING");
    expect(resolved.b.id).toBe("from-another-device");
    expect(resolved.complete).toBe(false);
  });
});
