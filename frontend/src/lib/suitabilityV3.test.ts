import { describe, expect, it } from "vitest";
import {
  COMPONENT_MODEL_HISTORICAL,
  COMPONENT_MODEL_SUCCESSOR,
  V3_COMPONENT_ORDER,
  isSuccessorRun,
  pendingV3Factors,
  v3FactorViews,
} from "./suitabilityV3";

/**
 * The Successor-V3 adapter boundary.
 *
 * These are TRUTHFULNESS contracts, not layout ones: they pin the rules that stop
 * one model's numbers being rendered under another model's labels, and stop a
 * missing value being shown as a confident zero.
 */

describe("model detection is positive and exact", () => {
  it("recognises only the successor identifier", () => {
    expect(isSuccessorRun(COMPONENT_MODEL_SUCCESSOR)).toBe(true);
  });

  // The whole point of the boundary: everything that is NOT provably the successor
  // model falls through, so the UI keeps rendering Z/R/E/D truthfully instead of
  // relabelling four legacy scores with four V3 names.
  it("treats historical, unknown and absent models as NOT successor", () => {
    expect(isSuccessorRun(COMPONENT_MODEL_HISTORICAL)).toBe(false);
    expect(isSuccessorRun("suitability-components-some-future-v9")).toBe(false);
    expect(isSuccessorRun(undefined)).toBe(false);
    expect(isSuccessorRun(null)).toBe(false);
  });
});

describe("factor views are built from served values only", () => {
  it("passes served scores and weights through, converting weight to whole percent", () => {
    // Ordered by the BACKEND's own enumeration (resident_impact third), which is
    // what a real run serves — and deliberately not this module's frame fallback.
    const views = v3FactorViews({
      componentScores: {
        existing_burden: "87.5",
        air_impact_proxy: "20",
        resident_impact: "41.25",
        land_conversion: "90",
      },
      weights: {
        existing_burden: "0.25",
        air_impact_proxy: "0.25",
        resident_impact: "0.25",
        land_conversion: "0.25",
      },
      componentOrder: [
        "existing_burden",
        "air_impact_proxy",
        "resident_impact",
        "land_conversion",
      ],
    });
    expect(views.map((v) => v.score)).toEqual([87.5, 20, 41.25, 90]);
    // The approved Successor-V3 baseline is equal weighting, 0.25 each.
    expect(views.map((v) => v.weightPercent)).toEqual([25, 25, 25, 25]);
  });

  // A served null is a MEASURED ABSENCE. Rendering it as 0 would turn "we do not
  // know" into "we measured none", which is the single rule this file exists for.
  it("keeps a served null score missing, never zero", () => {
    const [view] = v3FactorViews({
      componentScores: { existing_burden: null },
      componentOrder: ["existing_burden"],
    });
    expect(view.score).toBeNull();
    expect(view.score).not.toBe(0);
  });

  it("keeps an unserved component missing rather than defaulting it", () => {
    const [view] = v3FactorViews({ componentScores: {}, componentOrder: ["existing_burden"] });
    expect(view.score).toBeNull();
    expect(view.weightPercent).toBeNull();
  });

  // The run's own order wins: a UI that reorders a policy's components is
  // misreporting the policy. The backend enumerates resident_impact THIRD, which is
  // not the order the Figma frame draws.
  it("follows the run's served component_order over the frame order", () => {
    const served = [
      "existing_burden",
      "air_impact_proxy",
      "resident_impact",
      "land_conversion",
    ];
    const views = v3FactorViews({ componentScores: {}, componentOrder: served });
    expect(views.map((v) => v.component)).toEqual(served);
    // ...and that genuinely differs from this module's fallback frame order.
    expect(served).not.toEqual([...V3_COMPONENT_ORDER]);
  });

  it("ignores component keys outside the V3 namespace", () => {
    const views = v3FactorViews({
      componentScores: { zoning: "50" } as Record<string, string | null>,
      componentOrder: ["zoning", "existing_burden"],
    });
    expect(views.map((v) => v.component)).toEqual(["existing_burden"]);
  });

  // The qualitative word (우수 / 미흡) is policy-owned and the backend serves none,
  // so it must never be derived from a threshold this layer invented.
  it("never derives a grade label", () => {
    const views = v3FactorViews({ componentScores: { existing_burden: "99" } });
    expect(views.every((v) => v.gradeLabel === null)).toBe(true);
  });
});

describe("the pre-handoff state", () => {
  it("yields four correctly-ordered components with no values", () => {
    const views = pendingV3Factors();
    expect(views.map((v) => v.component)).toEqual([...V3_COMPONENT_ORDER]);
    expect(views.every((v) => v.score === null && v.weightPercent === null)).toBe(true);
  });
});
