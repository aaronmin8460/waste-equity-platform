// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SuitabilityProfile, SuitabilityRun } from "./api";
import {
  SCENARIO_STORAGE_KEY,
  clearScenarioSession,
  decimalWeightsToPercents,
  draftTotal,
  isDraftValid,
  loadScenarioSession,
  normalizePercents,
  percentsToCanonical,
  rankMovementText,
  saveScenarioSession,
  scenarioPresets,
  totalDifference,
  type ScenarioPercents,
  type ScenarioSessionState,
} from "./scenario";

const BASELINE: ScenarioPercents = { zoning: 35, road: 25, equity: 25, demand: 15 };

function runWith(weightProfiles: Record<string, Record<string, string>>): SuitabilityRun {
  return {
    id: 48,
    derivation_version: "suitability-screening-v3",
    policy_version: "suitability-policy-v2",
    candidate_grid_version: "capital-grid-500m-v1",
    reference_year: 2022,
    boundary_vintage: "2022",
    weight_profile: "baseline",
    analysis_signature: "sig",
    status: "SUCCEEDED",
    candidate_count_total: 3,
    candidate_count_eligible: 3,
    candidate_count_review: 0,
    candidate_count_excluded: 0,
    input_dataset_version_ids: [],
    input_provenance: {},
    weight_profiles: weightProfiles,
    weight_derivation: {},
    stability_definition: {},
    started_at: "",
    completed_at: null,
    created_at: "",
  };
}

describe("draft validation", () => {
  it("valid at exactly 100", () => {
    expect(draftTotal(BASELINE)).toBe(100);
    expect(isDraftValid(BASELINE)).toBe(true);
    expect(totalDifference(BASELINE)).toBe(0);
  });

  it("invalid when total is not 100", () => {
    const over = { zoning: 40, road: 25, equity: 25, demand: 15 };
    expect(isDraftValid(over)).toBe(false);
    expect(totalDifference(over)).toBe(5);
    const under = { zoning: 30, road: 25, equity: 25, demand: 15 };
    expect(isDraftValid(under)).toBe(false);
    expect(totalDifference(under)).toBe(-5);
  });

  it("invalid when a value is out of [0,100]", () => {
    expect(isDraftValid({ zoning: -1, road: 51, equity: 25, demand: 25 })).toBe(false);
  });
});

describe("percentsToCanonical", () => {
  it("maps a valid 100-total draft to 8dp strings summing to 1", () => {
    expect(percentsToCanonical(BASELINE)).toEqual({
      zoning: "0.35000000",
      road: "0.25000000",
      equity: "0.25000000",
      demand: "0.15000000",
    });
  });

  it("throws on an invalid total (never silently normalizes)", () => {
    expect(() => percentsToCanonical({ zoning: 40, road: 25, equity: 25, demand: 15 })).toThrow();
  });
});

describe("normalizePercents", () => {
  it("rescales to exactly 100 deterministically", () => {
    const result = normalizePercents({ zoning: 40, road: 20, equity: 20, demand: 20 });
    expect(result).not.toBeNull();
    expect(draftTotal(result!.percents)).toBe(100);
  });

  it("distributes the rounding remainder to sum exactly 100", () => {
    // 10/10/10/1 → proportional to 100 gives non-integers; result still sums to 100
    const result = normalizePercents({ zoning: 10, road: 10, equity: 10, demand: 1 });
    expect(result).not.toBeNull();
    expect(draftTotal(result!.percents)).toBe(100);
  });

  it("reports whether values changed", () => {
    expect(normalizePercents(BASELINE)!.changed).toBe(false);
    expect(normalizePercents({ zoning: 50, road: 50, equity: 50, demand: 50 })!.changed).toBe(true);
  });

  it("returns null when all values are zero", () => {
    expect(normalizePercents({ zoning: 0, road: 0, equity: 0, demand: 0 })).toBeNull();
  });
});

describe("decimalWeightsToPercents / presets", () => {
  it("converts a stored decimal profile to integer percents summing to 100", () => {
    const p = decimalWeightsToPercents({
      zoning: "0.35",
      road: "0.25",
      equity: "0.25",
      demand: "0.15",
    });
    expect(p).toEqual({ zoning: 35, road: 25, equity: 25, demand: 15 });
    expect(draftTotal(p)).toBe(100);
  });

  it("offers CRITIC preset only when the run computed it", () => {
    const withCritic = scenarioPresets(
      runWith({
        baseline: { zoning: "0.35", road: "0.25", equity: "0.25", demand: "0.15" },
        equal: { zoning: "0.25", road: "0.25", equity: "0.25", demand: "0.25" },
        critic: { zoning: "0.31", road: "0.19", equity: "0.28", demand: "0.22" },
      }),
    );
    expect(withCritic.map((p) => p.key)).toContain("critic");

    const withoutCritic = scenarioPresets(
      runWith({
        baseline: { zoning: "0.35", road: "0.25", equity: "0.25", demand: "0.15" },
        equal: { zoning: "0.25", road: "0.25", equity: "0.25", demand: "0.25" },
      }),
    );
    expect(withoutCritic.map((p) => p.key)).not.toContain("critic");
    // CRITIC is never fabricated for an old run.
    expect(withoutCritic.every((p) => p.key !== "critic")).toBe(true);
  });
});

describe("rankMovementText", () => {
  it("describes upward movement in text (not color only)", () => {
    expect(rankMovementText(42, 18)).toBe("42위 → 18위, 24계단 상승");
  });
  it("describes downward movement", () => {
    expect(rankMovementText(18, 42)).toBe("18위 → 42위, 24계단 하락");
  });
  it("reports no change", () => {
    expect(rankMovementText(10, 10)).toBe("순위 변화 없음");
  });
  it("handles missing ranks", () => {
    expect(rankMovementText(5, null)).toBe("순위 없음");
    expect(rankMovementText(null, 5)).toBe("5위 (비교 순위 없음)");
  });
});

describe("session persistence", () => {
  const PROFILES: SuitabilityProfile[] = ["baseline", "equal", "critic"];
  const base: ScenarioSessionState = {
    schemaVersion: 1,
    runId: 48,
    draftPercents: BASELINE,
    appliedPercents: BASELINE,
    compareProfile: "baseline",
    scenarioHash: "abc123",
    selectedCandidateId: 7,
  };

  afterEach(() => {
    clearScenarioSession();
    vi.unstubAllGlobals();
  });

  it("round-trips valid state for the same run", () => {
    saveScenarioSession(base);
    expect(loadScenarioSession(48, PROFILES)).toEqual(base);
  });

  it("discards state when the run id changed", () => {
    saveScenarioSession(base);
    expect(loadScenarioSession(99, PROFILES)).toBeNull();
  });

  it("discards state when the comparison profile is unavailable", () => {
    saveScenarioSession({ ...base, compareProfile: "critic" });
    expect(loadScenarioSession(48, ["baseline", "equal"])).toBeNull();
  });

  it("discards a wrong schema version", () => {
    sessionStorage.setItem(
      SCENARIO_STORAGE_KEY,
      JSON.stringify({ ...base, schemaVersion: 999 }),
    );
    expect(loadScenarioSession(48, PROFILES)).toBeNull();
  });

  it("discards malformed weights", () => {
    sessionStorage.setItem(
      SCENARIO_STORAGE_KEY,
      JSON.stringify({ ...base, draftPercents: { zoning: "x" } }),
    );
    expect(loadScenarioSession(48, PROFILES)).toBeNull();
  });

  it("discards non-JSON safely", () => {
    sessionStorage.setItem(SCENARIO_STORAGE_KEY, "not json");
    expect(loadScenarioSession(48, PROFILES)).toBeNull();
  });
});
