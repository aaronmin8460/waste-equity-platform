/**
 * The canonical Page-5 comparison model — the contract Page 5B and Page 5C consume.
 *
 * These assertions are what stop the two later lanes from disagreeing with each
 * other: which side is which, which weights are authoritative, and what each
 * failure is CALLED. Every fixture is synthetic and carries no official label.
 */

import { describe, expect, it } from "vitest";

import type { UserScenarioPreview, UserScenarioWeights } from "./api";
import {
  PREVIEW_FAILED_MESSAGE,
  SCENARIO_COMPARISON_COMPARE_PROFILE,
  SCENARIO_COMPARISON_TOP_N,
  buildScenarioComparison,
  comparisonSideBlock,
  comparisonWeightRows,
  formatWeightDelta,
  hasComparisonIntent,
} from "./scenarioComparison";
import {
  SAVED_SCENARIO_SCHEMA_VERSION,
  resolveComparisonPair,
  type SavedScenario,
} from "./savedScenarios";
import { COMPONENT_MODEL_HISTORICAL } from "./componentModelWeights";

const WEIGHTS_A: UserScenarioWeights = {
  zoning: "0.40000000",
  road: "0.30000000",
  equity: "0.20000000",
  demand: "0.10000000",
};
const WEIGHTS_B: UserScenarioWeights = {
  zoning: "0.25000000",
  road: "0.25000000",
  equity: "0.40000000",
  demand: "0.10000000",
};

function scenario(overrides: Partial<SavedScenario> = {}): SavedScenario {
  return {
    schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION,
    id: "sc-a",
    name: "균형안",
    weights: WEIGHTS_A,
    componentModelVersion: COMPONENT_MODEL_HISTORICAL,
    runId: 47,
    profileSource: "baseline",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function preview(overrides: Partial<UserScenarioPreview> = {}): UserScenarioPreview {
  return {
    scenario_hash: "hash-a",
    scenario_hash_short: "hash",
    method_version: "scenario-v1",
    run_id: 47,
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    component_model_version: "suitability-components-zred-v1",
    component_order: ["zoning", "road", "equity", "demand"],
    canonical_weights: WEIGHTS_A,
    compare_profile: "baseline",
    candidate_count_total: 100,
    candidate_count_eligible: 10,
    candidate_count_review: 40,
    candidate_count_excluded: 50,
    ranking_population: 10,
    top_candidates: [],
    selected_candidate: null,
    tile_url: "/tiles",
    assumptions: [],
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "임시 비교 결과입니다.",
    screening_disclaimer: "광역 분석 스크리닝",
    ...overrides,
  };
}

const A = scenario();
const B = scenario({ id: "sc-b", name: "형평성안", weights: WEIGHTS_B });

/** Resolve a pair against a saved list, exactly as the page does. */
function pair(aId: string | null, bId: string | null, saved: SavedScenario[] = [A, B]) {
  return resolveComparisonPair(saved, aId, bId);
}

/** The run on screen, resolved. */
const RUN_47 = { state: "RESOLVED", runId: 47 } as const;
/** The run failed to load — not "your scenario is from another run". */
const RUN_NONE = { state: "ERROR" } as const;
/** The run request has not come back yet. */
const RUN_PENDING = { state: "LOADING" } as const;

const OK_A = { preview: preview(), errorMessage: null };
const OK_B = { preview: preview({ canonical_weights: WEIGHTS_B, scenario_hash: "hash-b" }), errorMessage: null };
const FAILED = { preview: null, errorMessage: "가중치 값이 올바르지 않습니다." };

describe("frozen request parameters", () => {
  it("previews both sides against the same comparison profile", () => {
    expect(SCENARIO_COMPARISON_COMPARE_PROFILE).toBe("baseline");
  });

  it("requests a top_n the endpoint accepts (1..50)", () => {
    expect(SCENARIO_COMPARISON_TOP_N).toBeGreaterThanOrEqual(1);
    expect(SCENARIO_COMPARISON_TOP_N).toBeLessThanOrEqual(50);
  });
});

describe("hasComparisonIntent", () => {
  it("is false for a link with neither slot — the legacy Page-5 flow keeps it", () => {
    expect(hasComparisonIntent(null, null)).toBe(false);
  });

  it("is true for a lone A, and for a lone B", () => {
    expect(hasComparisonIntent("sc-a", null)).toBe(true);
    expect(hasComparisonIntent(null, "sc-b")).toBe(true);
  });

  it("is true for a full pair", () => {
    expect(hasComparisonIntent("sc-a", "sc-b")).toBe(true);
  });
});

describe("comparisonSideBlock — steps 1 and 2, before any request", () => {
  it("blocks an unrequested slot as EMPTY", () => {
    expect(comparisonSideBlock(null, null, 47)).toBe("EMPTY");
  });

  it("blocks a requested id this browser does not hold as MISSING", () => {
    expect(comparisonSideBlock(null, "sc-gone", 47)).toBe("MISSING");
  });

  it("blocks a scenario saved against another run", () => {
    expect(comparisonSideBlock(scenario({ runId: 46 }), "sc-a", 47)).toBe("OTHER_RUN");
  });

  it("treats an UNKNOWN active run as OTHER_RUN, never as a match", () => {
    expect(comparisonSideBlock(A, "sc-a", null)).toBe("OTHER_RUN");
  });

  it("clears a current-run scenario for preview", () => {
    expect(comparisonSideBlock(A, "sc-a", 47)).toBeNull();
  });
});

describe("buildScenarioComparison — resolution and order", () => {
  it("keeps A in A and B in B", () => {
    const c = buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, { a: OK_A, b: OK_B });
    expect(c.sideA.slot).toBe("A");
    expect(c.sideA.scenarioId).toBe("sc-a");
    expect(c.sideA.scenarioName).toBe("균형안");
    expect(c.sideB.slot).toBe("B");
    expect(c.sideB.scenarioId).toBe("sc-b");
    expect(c.sideB.scenarioName).toBe("형평성안");
    expect(c.status).toBe("READY");
  });

  it("does not swap the sides when the ids are given in the other order", () => {
    const c = buildScenarioComparison(pair("sc-b", "sc-a"), RUN_47, { a: OK_B, b: OK_A });
    expect(c.sideA.scenarioId).toBe("sc-b");
    expect(c.sideB.scenarioId).toBe("sc-a");
  });

  it("reports the ACTIVE run, not either scenario's stored run", () => {
    const c = buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, { a: OK_A, b: OK_B });
    expect(c.runId).toBe(47);
  });
});

describe("buildScenarioComparison — the server is authoritative", () => {
  it("shows the SERVER's canonical weights, not the stored copy", () => {
    // A hand-edited store whose weights differ from what the backend canonicalises.
    const drifted = scenario({ weights: { ...WEIGHTS_A, zoning: "0.5", road: "0.2" } });
    const c = buildScenarioComparison(pair("sc-a", "sc-b", [drifted, B]), RUN_47, {
      a: OK_A,
      b: OK_B,
    });
    expect(c.sideA.canonicalWeights).toEqual(WEIGHTS_A);
    expect(c.sideA.canonicalWeights).not.toEqual(drifted.weights);
  });

  it("shows the SERVER's run id, not the stored one", () => {
    const c = buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, {
      a: { preview: preview({ run_id: 47 }), errorMessage: null },
      b: OK_B,
    });
    expect(c.sideA.runId).toBe(47);
  });

  it("carries the whole preview through for the later Page-5 sections", () => {
    const c = buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, { a: OK_A, b: OK_B });
    expect(c.sideA.preview?.scenario_hash).toBe("hash-a");
    expect(c.sideB.preview?.scenario_hash).toBe("hash-b");
  });

  it("exposes no weights, run or preview on a side that is not READY", () => {
    const c = buildScenarioComparison(pair("sc-a", "sc-gone"), RUN_47, { a: OK_A, b: null });
    expect(c.sideB.canonicalWeights).toBeNull();
    expect(c.sideB.runId).toBeNull();
    expect(c.sideB.preview).toBeNull();
  });

  /**
   * The V3 component-model contract. `canonical_weights` is keyed by the RUN's own
   * components, so a preview from another component model would make every Z/R/E/D
   * lookup on this page read `undefined` — printing one model's numbers under
   * another model's labels instead of failing. The backend refuses such a request
   * outright (`COMPONENT_MODEL_SCENARIOS_UNAVAILABLE`), so this is the second line.
   */
  it("refuses a preview from another component model instead of mislabelling it", () => {
    const successor = preview({
      component_model_version: "suitability-components-successor-v1",
      component_order: [
        "existing_burden",
        "air_impact_proxy",
        "resident_impact",
        "land_conversion",
      ],
    });
    const c = buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, {
      a: { preview: successor, errorMessage: null },
      b: OK_B,
    });
    expect(c.sideA.state).toBe("PREVIEW_ERROR");
    expect(c.sideA.canonicalWeights).toBeNull();
    expect(c.sideA.preview).toBeNull();
    expect(c.sideA.errorMessage).toContain("가중치를 바꿔 보는 기능을 제공하지 않습니다");
  });

  it("accepts the historical model, which is the only one scenarios exist for", () => {
    const c = buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, { a: OK_A, b: OK_B });
    expect(c.sideA.preview?.component_model_version).toBe("suitability-components-zred-v1");
    expect(c.status).toBe("READY");
  });
});

describe("buildScenarioComparison — states", () => {
  it("is LOADING while a cleared side has not settled", () => {
    const c = buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, { a: null, b: null });
    expect(c.status).toBe("LOADING");
    expect(c.loading).toBe(true);
    expect(c.sideA.state).toBe("LOADING");
  });

  it("is still LOADING when only one side has settled", () => {
    const c = buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, { a: OK_A, b: null });
    expect(c.status).toBe("LOADING");
  });

  it("names an incomplete selection separately from a missing scenario", () => {
    expect(buildScenarioComparison(pair("sc-a", null), RUN_47, { a: OK_A, b: null }).status).toBe(
      "INCOMPLETE_SELECTION",
    );
    expect(buildScenarioComparison(pair(null, "sc-b"), RUN_47, { a: null, b: OK_B }).status).toBe(
      "INCOMPLETE_SELECTION",
    );
  });

  it("names MISSING_A, MISSING_B and MISSING_BOTH distinctly", () => {
    expect(buildScenarioComparison(pair("gone", "sc-b"), RUN_47, { a: null, b: OK_B }).status).toBe(
      "MISSING_A",
    );
    expect(buildScenarioComparison(pair("sc-a", "gone"), RUN_47, { a: OK_A, b: null }).status).toBe(
      "MISSING_B",
    );
    expect(buildScenarioComparison(pair("gone1", "gone2"), RUN_47, { a: null, b: null }).status).toBe(
      "MISSING_BOTH",
    );
  });

  it("names OTHER_RUN_A, OTHER_RUN_B and OTHER_RUN_BOTH distinctly", () => {
    const oldA = scenario({ runId: 46 });
    const oldB = scenario({ id: "sc-b", name: "형평성안", weights: WEIGHTS_B, runId: 46 });
    expect(
      buildScenarioComparison(pair("sc-a", "sc-b", [oldA, B]), RUN_47, { a: null, b: OK_B }).status,
    ).toBe("OTHER_RUN_A");
    expect(
      buildScenarioComparison(pair("sc-a", "sc-b", [A, oldB]), RUN_47, { a: OK_A, b: null }).status,
    ).toBe("OTHER_RUN_B");
    expect(
      buildScenarioComparison(pair("sc-a", "sc-b", [oldA, oldB]), RUN_47, { a: null, b: null }).status,
    ).toBe("OTHER_RUN_BOTH");
  });

  it("never calls an OTHER_RUN scenario current", () => {
    const oldA = scenario({ runId: 46 });
    const c = buildScenarioComparison(pair("sc-a", "sc-b", [oldA, B]), RUN_47, { a: null, b: OK_B });
    expect(c.sideA.state).toBe("OTHER_RUN");
    expect(c.sideA.runId).toBeNull();
    expect(c.sideA.preview).toBeNull();
    // …and the scenario itself is still there to be shown. It is the comparison
    // that is withheld, not the record.
    expect(c.sideA.savedScenario).toEqual(oldA);
  });

  it("names PREVIEW_ERROR_A, PREVIEW_ERROR_B and PREVIEW_ERROR_BOTH distinctly", () => {
    expect(buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, { a: FAILED, b: OK_B }).status).toBe(
      "PREVIEW_ERROR_A",
    );
    expect(buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, { a: OK_A, b: FAILED }).status).toBe(
      "PREVIEW_ERROR_B",
    );
    expect(
      buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, { a: FAILED, b: FAILED }).status,
    ).toBe("PREVIEW_ERROR_BOTH");
  });

  it("keeps the succeeding side fully usable when the other fails", () => {
    const c = buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, { a: OK_A, b: FAILED });
    expect(c.sideA.state).toBe("READY");
    expect(c.sideA.canonicalWeights).toEqual(WEIGHTS_A);
    expect(c.sideB.state).toBe("PREVIEW_ERROR");
    expect(c.sideB.errorMessage).toBe("가중치 값이 올바르지 않습니다.");
  });

  it("falls back to a plain message when a rejection carried no backend detail", () => {
    const c = buildScenarioComparison(pair("sc-a", "sc-b"), RUN_47, {
      a: { preview: null, errorMessage: null },
      b: OK_B,
    });
    expect(c.sideA.errorMessage).toBe(PREVIEW_FAILED_MESSAGE);
  });

  it("refuses a scenario compared with itself", () => {
    // The URL decoder drops an equal `cmpB`, so this is the hand-built case.
    const c = buildScenarioComparison(pair("sc-a", "sc-a"), RUN_47, { a: OK_A, b: OK_A });
    expect(c.status).toBe("DUPLICATE_SELECTION");
  });

  it("says the RUN failed rather than blaming the reader's scenarios", () => {
    const c = buildScenarioComparison(pair("sc-a", "sc-b"), RUN_NONE, { a: null, b: null });
    expect(c.status).toBe("NO_RUN");
    // NOT "OTHER_RUN": a run that failed to load is not a run these scenarios
    // disagree with — it is a run nobody has seen.
    expect(c.sideA.state).toBe("RUN_UNKNOWN");
    expect(c.sideB.state).toBe("RUN_UNKNOWN");
    expect(c.runId).toBeNull();
  });

  it("does not accuse either side of being from another run while the run is still loading", () => {
    const c = buildScenarioComparison(pair("sc-a", "sc-b"), RUN_PENDING, { a: null, b: null });
    expect(c.status).toBe("LOADING");
    expect(c.sideA.state).toBe("LOADING");
    expect(c.sideB.state).toBe("LOADING");
  });

  it("answers EMPTY and MISSING without waiting for the run", () => {
    // Neither question needs a run, so neither is held behind one.
    const c = buildScenarioComparison(pair("gone", null), RUN_PENDING, { a: null, b: null });
    expect(c.sideA.state).toBe("MISSING");
    expect(c.sideB.state).toBe("EMPTY");
  });

  it("reports MIXED rather than hiding one of two different problems", () => {
    const oldB = scenario({ id: "sc-b", weights: WEIGHTS_B, runId: 46 });
    const c = buildScenarioComparison(pair("gone", "sc-b", [A, oldB]), RUN_47, { a: null, b: null });
    expect(c.status).toBe("MIXED");
    // Both causes survive on their own side — nothing is collapsed.
    expect(c.sideA.state).toBe("MISSING");
    expect(c.sideB.state).toBe("OTHER_RUN");
  });
});

describe("comparisonWeightRows", () => {
  it("returns the four model factors in Z/R/E/D order, with the glossary's names", () => {
    const rows = comparisonWeightRows(WEIGHTS_A, WEIGHTS_B);
    expect(rows.map((row) => row.component)).toEqual(["zoning", "road", "equity", "demand"]);
    expect(rows.map((row) => row.code)).toEqual(["Z", "R", "E", "D"]);
    expect(rows.map((row) => row.label)).toEqual([
      "용도지역 호환성",
      "도로 근접성 대리지표",
      "기존 지역 부담",
      "폐기물 처리 수요",
    ]);
  });

  it("does not use the Figma mock factor names", () => {
    const labels = comparisonWeightRows(WEIGHTS_A, WEIGHTS_B).map((row) => row.label);
    for (const invented of ["시설 부담 정도", "토지피복 기반 적합도", "장래 역내 쓰레기 발생량", "주민 반응"]) {
      expect(labels).not.toContain(invented);
    }
  });

  it("carries the exact served decimals through untouched", () => {
    const rows = comparisonWeightRows(WEIGHTS_A, WEIGHTS_B);
    expect(rows[0].aWeight).toBe("0.40000000");
    expect(rows[0].bWeight).toBe("0.25000000");
  });

  it("computes the delta as B minus A in percentage points", () => {
    const rows = comparisonWeightRows(WEIGHTS_A, WEIGHTS_B);
    expect(rows[0].deltaPercentPoints).toBe(-15); // zoning 40 → 25
    expect(rows[2].deltaPercentPoints).toBe(20); // equity 20 → 40
    expect(rows[3].deltaPercentPoints).toBe(0); // demand 10 → 10
  });

  it("subtracts to exactly the two DISPLAYED percentages", () => {
    for (const row of comparisonWeightRows(WEIGHTS_A, WEIGHTS_B)) {
      expect(row.deltaPercentPoints).toBe((row.bPercent ?? 0) - (row.aPercent ?? 0));
    }
  });

  it("renders an unavailable side as null, never as a fabricated 0%", () => {
    const rows = comparisonWeightRows(WEIGHTS_A, null);
    expect(rows[0].bPercent).toBeNull();
    expect(rows[0].bWeight).toBeNull();
    expect(rows[0].deltaPercentPoints).toBeNull();
  });
});

describe("formatWeightDelta", () => {
  it("signs a real change and marks a zero change in words", () => {
    expect(formatWeightDelta(15)).toBe("+15%p");
    expect(formatWeightDelta(-10)).toBe("−10%p");
    expect(formatWeightDelta(0)).toBe("변화 없음");
  });

  it("returns null when the delta is not computable", () => {
    expect(formatWeightDelta(null)).toBeNull();
  });
});
