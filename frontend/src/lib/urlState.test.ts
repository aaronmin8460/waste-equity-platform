import { describe, expect, it } from "vitest";

import {
  type AppUrlState,
  decodeUrlState,
  encodeUrlState,
  MAX_COMPARE,
} from "./urlState";

const BASE: AppUrlState = {
  mode: "equity",
  metric: "population",
  region: null,
  cmp: [],
  scope: "all",
  top: 10,
  view: "score",
  profile: "baseline",
  statusOn: ["ELIGIBLE", "REVIEW_REQUIRED"],
  stableOnly: false,
  weights: null,
  cmpProfile: "baseline",
  candidate: null,
};

describe("decodeUrlState — version gate", () => {
  it("returns empty state and no warning when no version present", () => {
    expect(decodeUrlState("?metric=population")).toEqual({ state: {}, warnings: [] });
  });

  it("ignores everything with a warning on an unknown version", () => {
    const { state, warnings } = decodeUrlState("?v=99&mode=equity");
    expect(state).toEqual({});
    expect(warnings.length).toBe(1);
  });
});

describe("decodeUrlState — whitelisting and bounds", () => {
  it("accepts valid enums and bounded numbers", () => {
    const { state, warnings } = decodeUrlState(
      "?v=1&mode=suitability&metric=HOUSEHOLD&scope=31&top=20&view=scenario&profile=critic",
    );
    expect(state.mode).toBe("suitability");
    expect(state.metric).toBe("HOUSEHOLD");
    expect(state.scope).toBe("31");
    expect(state.top).toBe(20);
    expect(state.view).toBe("scenario");
    expect(state.profile).toBe("critic");
    expect(warnings).toEqual([]);
  });

  it("drops an unknown mode/metric/scope with warnings, keeps the valid ones", () => {
    const { state, warnings } = decodeUrlState("?v=1&mode=hacker&metric=DROP_TABLE&scope=99");
    expect(state.mode).toBeUndefined();
    expect(state.metric).toBeUndefined();
    expect(state.scope).toBeUndefined();
    expect(warnings.length).toBe(3);
  });

  it("rejects an out-of-set top-N", () => {
    const { state, warnings } = decodeUrlState("?v=1&top=13");
    expect(state.top).toBeUndefined();
    expect(warnings.length).toBe(1);
  });

  it("format-screens region codes and rejects arbitrary text", () => {
    expect(decodeUrlState("?v=1&region=KR-SGIS-31011").state.region).toBe("KR-SGIS-31011");
    expect(decodeUrlState("?v=1&region=KR-RCISRG-GOYANG").state.region).toBe("KR-RCISRG-GOYANG");
    const bad = decodeUrlState("?v=1&region=<script>alert(1)</script>");
    expect(bad.state.region).toBeUndefined();
    expect(bad.warnings.length).toBe(1);
  });

  it("caps comparison codes at MAX_COMPARE and dedupes", () => {
    const { state } = decodeUrlState("?v=1&cmp=KR-SGIS-11110,KR-SGIS-11110,KR-SGIS-11140,KR-SGIS-23510,KR-SGIS-31011");
    expect(state.cmp).toHaveLength(MAX_COMPARE);
    expect(new Set(state.cmp).size).toBe(MAX_COMPARE);
  });

  it("only accepts a fully-valid status set", () => {
    expect(decodeUrlState("?v=1&status=ELIGIBLE,EXCLUDED").state.statusOn).toEqual([
      "ELIGIBLE",
      "EXCLUDED",
    ]);
    const bad = decodeUrlState("?v=1&status=ELIGIBLE,BOGUS");
    expect(bad.state.statusOn).toBeUndefined();
    expect(bad.warnings.length).toBe(1);
  });

  it("validates scenario weight format and requires all four", () => {
    const ok = decodeUrlState("?v=1&wz=0.25&wr=0.25&we=0.25&wd=0.25");
    expect(ok.state.weights).toEqual({
      zoning: "0.25",
      road: "0.25",
      equity: "0.25",
      demand: "0.25",
    });
    const partial = decodeUrlState("?v=1&wz=0.25&wr=0.25");
    expect(partial.state.weights).toBeUndefined();
    expect(partial.warnings.length).toBe(1);
    const bad = decodeUrlState("?v=1&wz=2&wr=0.25&we=0.25&wd=0.25");
    expect(bad.state.weights).toBeUndefined();
  });

  it("bounds the candidate id to a positive integer", () => {
    expect(decodeUrlState("?v=1&cand=123").state.candidate).toBe(123);
    expect(decodeUrlState("?v=1&cand=-5").state.candidate).toBeUndefined();
    expect(decodeUrlState("?v=1&cand=abc").state.candidate).toBeUndefined();
  });
});

describe("encodeUrlState", () => {
  it("always stamps the version and core fields, omits defaults", () => {
    const q = encodeUrlState(BASE);
    expect(q).toContain("v=1");
    expect(q).toContain("mode=equity");
    expect(q).toContain("metric=population");
    expect(q).not.toContain("scope=");
    expect(q).not.toContain("top=");
    expect(q).not.toContain("stable=");
  });

  it("omits suitability-only fields outside suitability mode", () => {
    const q = encodeUrlState({ ...BASE, mode: "equity", view: "scenario", profile: "critic" });
    expect(q).not.toContain("view=");
    expect(q).not.toContain("profile=");
  });

  it("serialises scenario weights only in the scenario sub-view", () => {
    const weights = { zoning: "0.25", road: "0.25", equity: "0.25", demand: "0.25" };
    const inScenario = encodeUrlState({
      ...BASE,
      mode: "suitability",
      view: "scenario",
      weights,
    });
    expect(inScenario).toContain("wz=0.25");
    const inScore = encodeUrlState({ ...BASE, mode: "suitability", view: "score", weights });
    expect(inScore).not.toContain("wz=");
  });
});

describe("encode → decode round trip", () => {
  it("restores a rich shared state", () => {
    const full: AppUrlState = {
      mode: "suitability",
      metric: "FACILITY_BURDEN_5KM",
      region: "KR-SGIS-31011",
      cmp: ["KR-SGIS-11110", "KR-SGIS-23510"],
      scope: "31",
      top: 20,
      view: "scenario",
      profile: "critic",
      statusOn: ["ELIGIBLE", "EXCLUDED"],
      stableOnly: true,
      weights: { zoning: "0.4", road: "0.2", equity: "0.2", demand: "0.2" },
      cmpProfile: "equal",
      candidate: 4242,
    };
    const { state, warnings } = decodeUrlState(encodeUrlState(full));
    expect(warnings).toEqual([]);
    expect(state.mode).toBe("suitability");
    expect(state.metric).toBe("FACILITY_BURDEN_5KM");
    expect(state.region).toBe("KR-SGIS-31011");
    expect(state.cmp).toEqual(["KR-SGIS-11110", "KR-SGIS-23510"]);
    expect(state.scope).toBe("31");
    expect(state.top).toBe(20);
    expect(state.view).toBe("scenario");
    expect(state.profile).toBe("critic");
    expect(state.statusOn).toEqual(["ELIGIBLE", "EXCLUDED"]);
    expect(state.stableOnly).toBe(true);
    expect(state.weights).toEqual(full.weights);
    expect(state.cmpProfile).toBe("equal");
    expect(state.candidate).toBe(4242);
  });
});
