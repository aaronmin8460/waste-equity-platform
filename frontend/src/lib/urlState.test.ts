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
  landfillYear: null,
  landfillMonth: null,
  landfillOrigin: null,
  landfillWaste: null,
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

  it("round-trips the all-hidden status set via the 'none' sentinel", () => {
    const q = encodeUrlState({ ...BASE, mode: "suitability", statusOn: [] });
    expect(q).toContain("status=none");
    expect(decodeUrlState(q).state.statusOn).toEqual([]);
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
      landfillYear: null,
      landfillMonth: null,
      landfillOrigin: null,
      landfillWaste: null,
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

// --------------------------------------------------------------------------- //
// 매립지 현황 filters (Phase 7 — defect L5)
//
// `null` is a MEANINGFUL value for all four (최신 완결연도 / 연간 / 전체 / 전체) and
// is also the product default, so it is omitted from the link and an absent
// parameter decodes back to the default. None of these tests asserts that any
// period, origin, or category actually exists in the dataset — availability is the
// backend's answer, not this module's.
// --------------------------------------------------------------------------- //

const FLOW: AppUrlState = { ...BASE, mode: "flow" };

describe("landfill filters — decode", () => {
  it("accepts all four valid filters", () => {
    const { state, warnings } = decodeUrlState("?v=1&mode=flow&year=2023&month=7&origin=11&waste=생활폐기물");
    expect(state.landfillYear).toBe(2023);
    expect(state.landfillMonth).toBe(7);
    expect(state.landfillOrigin).toBe("11");
    expect(state.landfillWaste).toBe("생활폐기물");
    expect(warnings).toEqual([]);
  });

  it("drops an out-of-range year and month with warnings", () => {
    const { state, warnings } = decodeUrlState("?v=1&mode=flow&year=99&month=13");
    expect(state.landfillYear).toBeUndefined();
    expect(state.landfillMonth).toBeUndefined();
    expect(warnings.length).toBe(2);
  });

  it("rejects a non-integer or padded year and month rather than coercing", () => {
    expect(decodeUrlState("?v=1&mode=flow&year=2023.0").state.landfillYear).toBeUndefined();
    expect(decodeUrlState("?v=1&mode=flow&month=0").state.landfillMonth).toBeUndefined();
    expect(decodeUrlState("?v=1&mode=flow&month=07").state.landfillMonth).toBeUndefined();
  });

  it("whitelists the origin against the three capital-region codes", () => {
    expect(decodeUrlState("?v=1&mode=flow&origin=41").state.landfillOrigin).toBe("41");
    const { state, warnings } = decodeUrlState("?v=1&mode=flow&origin=99");
    expect(state.landfillOrigin).toBeUndefined();
    expect(warnings.length).toBe(1);
  });

  it("shape-screens the free-text waste name without whitelisting a value set", () => {
    // Korean text is accepted (a closed enum would be wrong — the backend serves
    // these names as free text).
    expect(decodeUrlState("?v=1&mode=flow&waste=건설폐기물").state.landfillWaste).toBe("건설폐기물");
    // Control characters and over-long values are rejected.
    const { state, warnings } = decodeUrlState(
      `?v=1&mode=flow&waste=${encodeURIComponent("a\u0000b")}`,
    );
    expect(state.landfillWaste).toBeUndefined();
    expect(warnings.length).toBe(1);
    expect(decodeUrlState(`?v=1&mode=flow&waste=${"가".repeat(61)}`).state.landfillWaste).toBeUndefined();
  });

  it("is ignored wholesale under an unknown version, like every other field", () => {
    expect(decodeUrlState("?v=99&mode=flow&year=2023").state.landfillYear).toBeUndefined();
  });
});

describe("landfill filters — encode", () => {
  it("omits every default so a default landfill link carries no filter", () => {
    const q = encodeUrlState(FLOW);
    expect(q).toContain("mode=flow");
    expect(q).not.toContain("year=");
    expect(q).not.toContain("month=");
    expect(q).not.toContain("origin=");
    expect(q).not.toContain("waste=");
  });

  it("serialises all four when set", () => {
    const q = encodeUrlState({
      ...FLOW,
      landfillYear: 2023,
      landfillMonth: 7,
      landfillOrigin: "28",
      landfillWaste: "생활폐기물",
    });
    expect(q).toContain("year=2023");
    expect(q).toContain("month=7");
    expect(q).toContain("origin=28");
    expect(q).toContain(`waste=${encodeURIComponent("생활폐기물")}`);
  });

  it("omits landfill-only fields outside the landfill area", () => {
    const q = encodeUrlState({
      ...BASE,
      mode: "equity",
      landfillYear: 2023,
      landfillMonth: 7,
      landfillOrigin: "11",
      landfillWaste: "생활폐기물",
    });
    expect(q).not.toContain("year=");
    expect(q).not.toContain("month=");
    expect(q).not.toContain("origin=");
    expect(q).not.toContain("waste=");
  });

  it("does not disturb existing non-landfill state", () => {
    const q = encodeUrlState({
      ...BASE,
      mode: "suitability",
      view: "scenario",
      profile: "critic",
      candidate: 7,
      landfillYear: 2023,
    });
    expect(q).toContain("view=scenario");
    expect(q).toContain("profile=critic");
    expect(q).toContain("cand=7");
    expect(q).not.toContain("year=");
  });
});

describe("landfill filters — round trip", () => {
  it("restores all four filters through encode → decode", () => {
    const full: AppUrlState = {
      ...FLOW,
      landfillYear: 2024,
      landfillMonth: 12,
      landfillOrigin: "41",
      landfillWaste: "사업장배출시설계폐기물",
    };
    const { state, warnings } = decodeUrlState(encodeUrlState(full));
    expect(warnings).toEqual([]);
    expect(state.mode).toBe("flow");
    expect(state.landfillYear).toBe(2024);
    expect(state.landfillMonth).toBe(12);
    expect(state.landfillOrigin).toBe("41");
    expect(state.landfillWaste).toBe("사업장배출시설계폐기물");
  });

  it("round-trips a waste name containing a separator character", () => {
    // The name is free backend text, so a comma or ampersand inside it must survive
    // URLSearchParams encoding rather than splitting the value.
    const full: AppUrlState = { ...FLOW, landfillWaste: "생활계, 사업장&기타" };
    const { state } = decodeUrlState(encodeUrlState(full));
    expect(state.landfillWaste).toBe("생활계, 사업장&기타");
  });

  it("leaves a link written before landfill filters existed fully valid", () => {
    // Backward compatibility: a Phase 5-era landfill link has no filter params.
    const { state, warnings } = decodeUrlState("?v=1&mode=flow");
    expect(state.mode).toBe("flow");
    expect(state.landfillYear).toBeUndefined();
    expect(state.landfillMonth).toBeUndefined();
    expect(state.landfillOrigin).toBeUndefined();
    expect(state.landfillWaste).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});
