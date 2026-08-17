// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SuitabilityScoringBasis from "./SuitabilityScoringBasis";
import type { CandidateDetail, SuitabilityPolicy, SuitabilityRun } from "../../lib/api";

/**
 * Card ② renders THE MODEL THE RUN REPORTS.
 *
 * The shared e2e/unit fixtures all serve a HISTORICAL run, so without this file the
 * Successor-V3 branch would be wired but never exercised — and the two branches are
 * exactly where a model's numbers could end up under another model's labels.
 *
 * The fixtures below are local test doubles shaped to the served contract
 * (docs/SUITABILITY_COMPONENT_MODEL_CONTRACT.md); they are never production values
 * and never reach a production path.
 */

afterEach(cleanup);

const POLICY = {
  weight_profiles: { baseline: {} },
} as unknown as SuitabilityPolicy;

function run(overrides: Partial<SuitabilityRun>): SuitabilityRun {
  return {
    id: 48,
    reference_year: 2024,
    boundary_vintage: "2024",
    policy_version: "suitability-successor-policy-v1",
    derivation_version: "suitability-successor-derivation-v1",
    weight_profiles: {},
    weight_derivation: {},
    stability_definition: {},
    ...overrides,
  } as unknown as SuitabilityRun;
}

/** A successor run, exactly as the contract describes it. */
const SUCCESSOR_RUN = run({
  component_model_version: "suitability-components-successor-v1",
  component_order: ["existing_burden", "air_impact_proxy", "resident_impact", "land_conversion"],
  // The approved Successor-V3 baseline: equal weighting.
  weight_profiles: {
    baseline: {
      existing_burden: "0.25",
      air_impact_proxy: "0.25",
      resident_impact: "0.25",
      land_conversion: "0.25",
    },
  },
});

/**
 * A selected successor candidate. `component_scores` is authoritative and the four
 * legacy columns are explicit null — never reused to carry another quantity.
 */
const SUCCESSOR_CANDIDATE = {
  component_scores: {
    existing_burden: "87",
    air_impact_proxy: "20",
    // A SERVED NULL: measured absence, which must never render as 0.
    resident_impact: null,
    land_conversion: "90",
  },
  zoning_score: null,
  road_score: null,
  equity_score: null,
  demand_score: null,
} as unknown as CandidateDetail;

function renderBasis(props: { run: SuitabilityRun; selected: CandidateDetail | null }) {
  return render(
    <SuitabilityScoringBasis
      policy={POLICY}
      run={props.run}
      profile="baseline"
      onSelectProfile={() => {}}
      runProfiles={["baseline"]}
      stabilityAvailable={false}
      selected={props.selected}
      stableOnly={false}
    />,
  );
}

describe("card ② on a SUCCESSOR run", () => {
  it("renders the four V3 factor cards and no Z/R/E/D card", () => {
    renderBasis({ run: SUCCESSOR_RUN, selected: SUCCESSOR_CANDIDATE });
    expect(screen.getByTestId("v3-factor-cards")).toBeDefined();
    // The legacy card set must be absent — this is the substitution the whole
    // adapter exists to prevent, in the other direction.
    expect(screen.queryByTestId("factor-cards")).toBeNull();
    for (const c of ["existing_burden", "air_impact_proxy", "resident_impact", "land_conversion"]) {
      expect(screen.getByTestId(`v3-factor-card-${c}`)).toBeDefined();
    }
  });

  it("prints the served component scores, and a served null as missing — never 0", () => {
    renderBasis({ run: SUCCESSOR_RUN, selected: SUCCESSOR_CANDIDATE });
    expect(screen.getByTestId("v3-factor-score-existing_burden").textContent).toContain("87/100");
    expect(screen.getByTestId("v3-factor-score-land_conversion").textContent).toContain("90/100");
    const missing = screen.getByTestId("v3-factor-score-resident_impact").textContent ?? "";
    expect(missing).toContain("—/100");
    expect(missing).not.toContain("0/100");
  });

  it("shows the approved equal weights, and never lets the input imply a recompute", () => {
    renderBasis({ run: SUCCESSOR_RUN, selected: SUCCESSOR_CANDIDATE });
    const input = screen.getByTestId("v3-factor-weight-existing_burden") as HTMLInputElement;
    expect(input.value).toBe("25");
    // Page 4 shows a STORED run, so the frame's weight control is present but inert.
    expect(input.disabled).toBe(true);
  });

  it("reports the run's own model identity, not the client's constants", () => {
    renderBasis({ run: SUCCESSOR_RUN, selected: null });
    const identity = screen.getByTestId("scoring-basis-model-identity").textContent ?? "";
    expect(identity).toContain("suitability-components-successor-v1");
    expect(identity).toContain("suitability-successor-policy-v1");
  });

  it("shows no score before a candidate is selected, rather than a sample or a 0", () => {
    renderBasis({ run: SUCCESSOR_RUN, selected: null });
    const text = screen.getByTestId("v3-factor-score-existing_burden").textContent ?? "";
    expect(text).toContain("—/100");
    expect(text).not.toMatch(/\d+\/100/);
  });
});

describe("card ② on a HISTORICAL run", () => {
  const HISTORICAL_RUN = run({
    component_model_version: "suitability-components-zred-v1",
    policy_version: "suitability-policy-v2",
    weight_profiles: { baseline: { zoning: "0.4", road: "0.3", equity: "0.2", demand: "0.1" } },
  });

  // The mirror image of the fabrication the V3 cards prevent: rendering empty V3
  // cards over a zred-v1 run would HIDE the real component scores that run has.
  it("keeps the Z/R/E/D cards and renders no V3 card", () => {
    renderBasis({ run: HISTORICAL_RUN, selected: null });
    expect(screen.getByTestId("factor-cards")).toBeDefined();
    expect(screen.queryByTestId("v3-factor-cards")).toBeNull();
  });

  // A backend predating the component-model contract reports no model at all. That
  // is treated as historical, never as successor.
  it("treats a run with no reported model as historical", () => {
    renderBasis({ run: run({ weight_profiles: { baseline: {} } }), selected: null });
    expect(screen.getByTestId("factor-cards")).toBeDefined();
    expect(screen.queryByTestId("v3-factor-cards")).toBeNull();
  });
});
