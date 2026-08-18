/**
 * The MODEL-AWARE weight contract, and the one translation it never performs.
 *
 * The historical and successor component namespaces are disjoint, and a weight
 * vector only means something over the namespace it was authored for. The failure
 * this file exists to make impossible is a POSITIONAL remap: reading a saved
 * `{zoning, road, equity, demand}` as `{existing_burden, air_impact_proxy,
 * resident_impact, land_conversion}` would rename `road` to `resident_impact` — a
 * different measurement wearing the reader's own number.
 */

import { describe, expect, it } from "vitest";

import {
  COMPONENT_MODEL_HISTORICAL,
  COMPONENT_MODEL_SUCCESSOR,
  HISTORICAL_COMPONENT_ORDER,
  LEGACY_MODEL_NOTICE,
  SUCCESSOR_COMPONENT_ORDER,
  componentModelLabel,
  componentsFor,
  inferUntaggedModel,
  isCanonicalWeightsFor,
  isComponentModelVersion,
  isHistoricalWeights,
  isSuccessorWeights,
  modelWeightsFrom,
} from "./componentModelWeights";

const HISTORICAL = {
  zoning: "0.40000000",
  road: "0.30000000",
  equity: "0.20000000",
  demand: "0.10000000",
};
const SUCCESSOR = {
  existing_burden: "0.25000000",
  air_impact_proxy: "0.25000000",
  resident_impact: "0.25000000",
  land_conversion: "0.25000000",
};

describe("the two namespaces", () => {
  it("are disjoint, which is what makes an untagged vector unambiguous", () => {
    expect(
      HISTORICAL_COMPONENT_ORDER.some((c) => (SUCCESSOR_COMPONENT_ORDER as readonly string[]).includes(c)),
    ).toBe(false);
  });

  it("uses the canonical successor component names and order", () => {
    expect(SUCCESSOR_COMPONENT_ORDER).toEqual([
      "existing_burden",
      "air_impact_proxy",
      "resident_impact",
      "land_conversion",
    ]);
  });

  it("resolves each model to its own components", () => {
    expect(componentsFor(COMPONENT_MODEL_HISTORICAL)).toEqual(HISTORICAL_COMPONENT_ORDER);
    expect(componentsFor(COMPONENT_MODEL_SUCCESSOR)).toEqual(SUCCESSOR_COMPONENT_ORDER);
  });
});

describe("validation is model-relative", () => {
  it("accepts each vector for its OWN model", () => {
    expect(isHistoricalWeights(HISTORICAL)).toBe(true);
    expect(isSuccessorWeights(SUCCESSOR)).toBe(true);
  });

  it("⛔ refuses each vector for the OTHER model", () => {
    // The load-bearing assertion of this whole file.
    expect(isSuccessorWeights(HISTORICAL)).toBe(false);
    expect(isHistoricalWeights(SUCCESSOR)).toBe(false);
  });

  it("refuses a record carrying BOTH namespaces, as either model", () => {
    const ambiguous = { ...HISTORICAL, ...SUCCESSOR };
    expect(isHistoricalWeights(ambiguous)).toBe(false);
    expect(isSuccessorWeights(ambiguous)).toBe(false);
  });

  it("refuses a vector missing one of its model's components", () => {
    const short = { ...SUCCESSOR } as Partial<typeof SUCCESSOR>;
    delete short.land_conversion;
    expect(isSuccessorWeights(short)).toBe(false);
  });

  it("refuses a vector whose weights do not sum to 1", () => {
    expect(
      isSuccessorWeights({ ...SUCCESSOR, land_conversion: "0.50000000" }),
    ).toBe(false);
  });

  it("tolerates a stray key but strips it on rebuild", () => {
    // Dropping the row entirely would cost a reader their saved scenario over one
    // junk property; the rebuild is what guarantees nothing extra reaches a request.
    const withJunk = { ...SUCCESSOR, injected: "1.0" };
    expect(isSuccessorWeights(withJunk)).toBe(true);
    const rebuilt = modelWeightsFrom(COMPONENT_MODEL_SUCCESSOR, withJunk);
    expect(Object.keys(rebuilt!.weights).sort()).toEqual([...SUCCESSOR_COMPONENT_ORDER].sort());
  });
});

describe("modelWeightsFrom", () => {
  it("tags the vector with the model it was rebuilt for", () => {
    const result = modelWeightsFrom(COMPONENT_MODEL_SUCCESSOR, SUCCESSOR);
    expect(result?.componentModelVersion).toBe(COMPONENT_MODEL_SUCCESSOR);
    expect(result?.weights).toEqual(SUCCESSOR);
  });

  it("⛔ returns null rather than remapping a historical vector by position", () => {
    expect(modelWeightsFrom(COMPONENT_MODEL_SUCCESSOR, HISTORICAL)).toBeNull();
    expect(modelWeightsFrom(COMPONENT_MODEL_HISTORICAL, SUCCESSOR)).toBeNull();
  });
});

describe("inferUntaggedModel — for state written before model tagging", () => {
  it("reads an untagged Z/R/E/D vector as HISTORICAL, always", () => {
    expect(inferUntaggedModel(HISTORICAL)).toBe(COMPONENT_MODEL_HISTORICAL);
  });

  it("never guesses when the vector is neither", () => {
    expect(inferUntaggedModel({ a: "1.0" })).toBeNull();
    expect(inferUntaggedModel(null)).toBeNull();
  });
});

describe("model identity", () => {
  it("recognises exactly the two known models", () => {
    expect(isComponentModelVersion(COMPONENT_MODEL_HISTORICAL)).toBe(true);
    expect(isComponentModelVersion(COMPONENT_MODEL_SUCCESSOR)).toBe(true);
    expect(isComponentModelVersion("suitability-components-v9")).toBe(false);
    expect(isComponentModelVersion(undefined)).toBe(false);
  });

  it("uses the canonical backend model-version strings", () => {
    expect(COMPONENT_MODEL_SUCCESSOR).toBe("suitability-components-successor-v1");
    expect(COMPONENT_MODEL_HISTORICAL).toBe("suitability-components-zred-v1");
  });

  it("names an unknown model as unknown rather than defaulting it", () => {
    expect(componentModelLabel("made-up")).toBe("알 수 없는 모델");
    expect(componentModelLabel(COMPONENT_MODEL_SUCCESSOR)).toBe("후속 모델");
  });
});

describe("the legacy notice", () => {
  it("explains why a historical scenario cannot be reused, without discarding it", () => {
    expect(LEGACY_MODEL_NOTICE).toContain("기존 모델");
    expect(LEGACY_MODEL_NOTICE).toContain("그대로 옮겨 쓸 수 없");
    expect(LEGACY_MODEL_NOTICE).toContain("새로 저장");
  });
});

describe("isCanonicalWeightsFor rejects non-objects", () => {
  it.each([null, undefined, "0.25", 42, []])("refuses %p", (value) => {
    expect(isCanonicalWeightsFor(COMPONENT_MODEL_SUCCESSOR, value)).toBe(false);
  });
});

describe("the re-weight note is model-neutral", () => {
  it("describes the mechanism without naming a component namespace", async () => {
    const { SCENARIO_REWEIGHT_NOTE } = await import("./componentModelWeights");
    // It used to say "이미 계산된 Z·R·E·D 점수를" — true of a historical comparison
    // and FALSE of a successor one, whose four re-weighted scores are different
    // measurements. The mechanism is identical in both, so the sentence states the
    // mechanism and the factor table names the components.
    expect(SCENARIO_REWEIGHT_NOTE).not.toContain("Z·R·E·D");
    expect(SCENARIO_REWEIGHT_NOTE).toContain("평가 요소 점수를 다시 가중해");
    // The screening-independence half is unchanged.
    expect(SCENARIO_REWEIGHT_NOTE).toContain("가중치를 바꿔도 달라지지 않습니다");
  });
});
