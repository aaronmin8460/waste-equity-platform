import { describe, expect, it } from "vitest";

import {
  type AppUrlState,
  decodeUrlState,
  encodeUrlState,
  MAX_COMPARE,
  MUNICIPAL_COST_DEFAULT_STATUS,
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
  municipalCostSido: null,
  // The released default scope, not `null`: `null` is the 전체 selection and now
  // encodes to an explicit `mcStatus=all` token.
  municipalCostStatus: MUNICIPAL_COST_DEFAULT_STATUS,
  municipalCostSort: "payment_per_capita_desc",
  suitScope: { kind: "all" },
  suitSort: "score_desc",
  cmpA: null,
  cmpB: null,
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
      municipalCostSido: null,
      municipalCostStatus: null,
      municipalCostSort: "payment_per_capita_desc",
  suitScope: { kind: "all" },
  suitSort: "score_desc",
      cmpA: null,
      cmpB: null,
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

describe("municipal-payment filters", () => {
  it("omits every default so a default 매립지 현황 link carries no mc parameter", () => {
    const q = encodeUrlState(FLOW);
    expect(q).not.toContain("mcSido=");
    expect(q).not.toContain("mcStatus=");
    // `payment_per_capita_desc` is the served default ordering.
    expect(q).not.toContain("mcSort=");
  });

  it("serialises the three when they differ from the default", () => {
    const q = encodeUrlState({
      ...FLOW,
      municipalCostSido: "41",
      municipalCostStatus: "PARTIAL",
      municipalCostSort: "region_name_asc",
    });
    expect(q).toContain("mcSido=41");
    expect(q).toContain("mcStatus=PARTIAL");
    expect(q).toContain("mcSort=region_name_asc");
  });

  it("restores the released 계산 가능 default when no mcStatus is present", () => {
    // The default is a SCOPE, so a link that carries no status must reopen on the
    // same scope the app opens on — not on 전체.
    const { state } = decodeUrlState("?v=1&mode=flow");
    expect(state.municipalCostStatus).toBeUndefined();
    expect(MUNICIPAL_COST_DEFAULT_STATUS).toBe("AVAILABLE");
  });

  it("round-trips the 전체 selection through an explicit token", () => {
    // 전체 can no longer be encoded by omission: an absent parameter now restores
    // 계산 가능, so sharing a widened view would silently re-narrow it.
    const q = encodeUrlState({ ...FLOW, municipalCostStatus: null });
    expect(q).toContain("mcStatus=all");
    const { state, warnings } = decodeUrlState(q);
    expect(state.municipalCostStatus).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("never sends the 전체 token to the backend enum set", () => {
    // `all` is a URL-layer sentinel only; the backend's `status` parameter takes the
    // three enum members or nothing at all.
    const { state } = decodeUrlState("?v=1&mode=flow&mcStatus=all");
    expect(state.municipalCostStatus).toBeNull();
  });

  it("keeps the mc keys out of every other area", () => {
    const q = encodeUrlState({
      ...BASE,
      mode: "equity",
      municipalCostSido: "41",
      municipalCostStatus: "PARTIAL",
      municipalCostSort: "region_name_asc",
    });
    expect(q).not.toContain("mcSido=");
    expect(q).not.toContain("mcStatus=");
    expect(q).not.toContain("mcSort=");
  });

  it("does not collide with the landfill origin key", () => {
    // Both datasets share the area and both use SGIS sido codes; a shared link must
    // carry the two selections independently.
    const q = encodeUrlState({ ...FLOW, landfillOrigin: "11", municipalCostSido: "41" });
    const { state } = decodeUrlState(q);
    expect(state.landfillOrigin).toBe("11");
    expect(state.municipalCostSido).toBe("41");
  });

  it("round-trips a full municipal-payment selection", () => {
    const { state, warnings } = decodeUrlState(
      encodeUrlState({
        ...FLOW,
        municipalCostSido: "28",
        municipalCostStatus: "UNAVAILABLE",
        municipalCostSort: "total_payment_desc",
      }),
    );
    expect(warnings).toEqual([]);
    expect(state.municipalCostSido).toBe("28");
    expect(state.municipalCostStatus).toBe("UNAVAILABLE");
    expect(state.municipalCostSort).toBe("total_payment_desc");
  });

  it("drops an out-of-set value with a warning rather than forwarding a 422", () => {
    const sido = decodeUrlState("?v=1&mode=flow&mcSido=99");
    expect(sido.state.municipalCostSido).toBeUndefined();
    expect(sido.warnings.length).toBe(1);

    const status = decodeUrlState("?v=1&mode=flow&mcStatus=MAYBE");
    expect(status.state.municipalCostStatus).toBeUndefined();
    expect(status.warnings.length).toBe(1);

    const sort = decodeUrlState("?v=1&mode=flow&mcSort=bogus");
    expect(sort.state.municipalCostSort).toBeUndefined();
    expect(sort.warnings.length).toBe(1);
  });

  it("leaves a link written before the municipal filters existed fully valid", () => {
    const { state, warnings } = decodeUrlState("?v=1&mode=flow&year=2024");
    expect(state.landfillYear).toBe(2024);
    expect(state.municipalCostSido).toBeUndefined();
    expect(state.municipalCostStatus).toBeUndefined();
    expect(state.municipalCostSort).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});

describe("후보지 심층 분석 ① 분석 범위 / ③ 순위 방향 in the URL", () => {
  const suit = (extra: Partial<AppUrlState> = {}): AppUrlState => ({
    ...BASE,
    mode: "suitability",
    ...extra,
  });

  it("writes nothing for the defaults (수도권 전체 · 높은 순)", () => {
    const encoded = encodeUrlState(suit());
    expect(encoded).not.toContain("suitScope=");
    expect(encoded).not.toContain("suitSort=");
  });

  it("round-trips each 시·도 scope in canonical form", () => {
    for (const sido of ["KR-SGIS-11", "KR-SGIS-23", "KR-SGIS-31"] as const) {
      const encoded = encodeUrlState(suit({ suitScope: { kind: "sido", sido } }));
      expect(encoded).toContain(`suitScope=KR-SGIS-${sido.slice(-2)}`);
      expect(decodeUrlState(encoded).state.suitScope).toEqual({ kind: "sido", sido });
    }
  });

  it("round-trips a multi-code city selection", () => {
    const scope = { kind: "sigungu" as const, codes: ["KR-SGIS-31091", "KR-SGIS-31092"] };
    const encoded = encodeUrlState(suit({ suitScope: scope }));
    expect(decodeUrlState(encoded).state.suitScope).toEqual(scope);
  });

  it("round-trips 낮은 순", () => {
    const encoded = encodeUrlState(suit({ suitSort: "score_asc" }));
    expect(encoded).toContain("suitSort=score_asc");
    expect(decodeUrlState(encoded).state.suitSort).toBe("score_asc");
  });

  it("cannot express a sido AND a sigungu selection at once", () => {
    // One key holds the whole scope, so the pair the API forbids has no spelling.
    const encoded = encodeUrlState(
      suit({ suitScope: { kind: "sigungu", codes: ["KR-SGIS-31150"] } }),
    );
    const params = new URLSearchParams(encoded.slice(1));
    expect(params.getAll("suitScope")).toHaveLength(1);
    const restored = decodeUrlState(encoded).state.suitScope!;
    expect(restored.kind).toBe("sigungu");
  });

  it("drops a malformed region code with a warning and keeps the valid ones", () => {
    const { state, warnings } = decodeUrlState(
      "?v=1&mode=suitability&suitScope=KR-SGIS-31091,notacode,KR-SGIS-31092",
    );
    expect(state.suitScope).toEqual({
      kind: "sigungu",
      codes: ["KR-SGIS-31091", "KR-SGIS-31092"],
    });
    expect(warnings).toHaveLength(1);
  });

  it("refuses the BARE code spelling, so a MOIS code can never scope this ranking", () => {
    // `28`/`41` are Incheon/Gyeonggi in the landfill space but mean nothing here.
    // Accepting bare digits would let such a link silently scope to zero rows.
    const { state, warnings } = decodeUrlState("?v=1&mode=suitability&suitScope=28");
    expect(state.suitScope).toBeUndefined();
    expect(warnings).toHaveLength(1);

    const bare = decodeUrlState("?v=1&mode=suitability&suitScope=31091");
    expect(bare.state.suitScope).toBeUndefined();
  });

  it("widens to 수도권 전체 when every code in the link is invalid", () => {
    // Never a blank ranking: an unusable scope drops to no restriction.
    const { state } = decodeUrlState("?v=1&mode=suitability&suitScope=bad,worse");
    expect(state.suitScope).toBeUndefined();
  });

  it("drops an unknown sort with a warning", () => {
    const { state, warnings } = decodeUrlState("?v=1&mode=suitability&suitSort=name_asc");
    expect(state.suitSort).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("does not change Page-1 scope/top semantics", () => {
    // The 지역 부담 ranking keeps its own keys and its own bare vocabulary.
    const { state } = decodeUrlState("?v=1&mode=equity&scope=31&top=20");
    expect(state.scope).toBe("31");
    expect(state.top).toBe(20);
    expect(state.suitScope).toBeUndefined();
  });

  it("writes no suitability scope outside 후보지 분석", () => {
    const encoded = encodeUrlState({
      ...BASE,
      mode: "equity",
      suitScope: { kind: "sido", sido: "KR-SGIS-11" },
      suitSort: "score_asc",
    });
    expect(encoded).not.toContain("suitScope=");
    expect(encoded).not.toContain("suitSort=");
  });

  it("leaves a link written before the scope filters existed fully valid", () => {
    const { state, warnings } = decodeUrlState("?v=1&mode=suitability&profile=critic");
    expect(state.profile).toBe("critic");
    expect(state.suitScope).toBeUndefined();
    expect(state.suitSort).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});

/**
 * PAGE 4D — ⑤ 비교할 시나리오 선택 (`cmpA` / `cmpB`).
 *
 * The pair names two SAVED SCENARIOS by id. The ids live in the reader's own
 * browser, so this module can only screen their SHAPE; the page resolves them
 * against `lib/savedScenarios.ts` and renders an explicit state for one it cannot
 * find. The tests below therefore pin exactly that division of labour, plus the
 * one rule the URL layer does own: A and B must differ.
 */
describe("decode/encode — cmpA / cmpB (Page 4D)", () => {
  const suit = (extra: Partial<AppUrlState> = {}): AppUrlState => ({
    ...BASE,
    mode: "suitability",
    ...extra,
  });

  it("round-trips a well-formed pair and preserves A/B order", () => {
    const encoded = encodeUrlState(suit({ cmpA: "aaa-111", cmpB: "bbb-222" }));
    expect(encoded).toContain("cmpA=aaa-111");
    expect(encoded).toContain("cmpB=bbb-222");

    const { state, warnings } = decodeUrlState(encoded);
    expect(state.cmpA).toBe("aaa-111");
    expect(state.cmpB).toBe("bbb-222");
    expect(warnings).toEqual([]);
  });

  it("round-trips a real UUID id, the shape the storage layer mints", () => {
    const id = "0b8f7a1e-4c3d-4f2a-9b6e-1d2c3e4f5a6b";
    const { state } = decodeUrlState(encodeUrlState(suit({ cmpA: id })));
    expect(state.cmpA).toBe(id);
  });

  it("writes nothing when no scenario is selected", () => {
    const encoded = encodeUrlState(suit());
    expect(encoded).not.toContain("cmpA=");
    expect(encoded).not.toContain("cmpB=");
  });

  it("writes the pair in view=score too — the selection is MADE on Page 4", () => {
    // Restricting it to `view=scenario` would drop the pair from a link shared
    // from the very screen the reader chose it on.
    const encoded = encodeUrlState(suit({ view: "score", cmpA: "a1", cmpB: "b2" }));
    expect(encoded).toContain("cmpA=a1");
    expect(encoded).toContain("cmpB=b2");
  });

  it("writes a lone B, because clearing A is a state the reader can be in", () => {
    // Suppressing it would make the link disagree with the screen: B would still
    // show as selected while a reload silently dropped it.
    const encoded = encodeUrlState(suit({ cmpA: null, cmpB: "only-b" }));
    expect(encoded).toContain("cmpB=only-b");
    expect(encoded).not.toContain("cmpA=");

    const { state } = decodeUrlState(encoded);
    expect(state.cmpA).toBeUndefined();
    expect(state.cmpB).toBe("only-b");
  });

  it("never writes B when it equals A", () => {
    const encoded = encodeUrlState(suit({ cmpA: "same", cmpB: "same" }));
    const params = new URLSearchParams(encoded.slice(1));
    expect(params.get("cmpA")).toBe("same");
    expect(params.get("cmpB")).toBeNull();
  });

  it("drops an equal pair on decode, keeping A and warning", () => {
    const { state, warnings } = decodeUrlState("?v=1&mode=suitability&cmpA=dup&cmpB=dup");
    expect(state.cmpA).toBe("dup");
    expect(state.cmpB).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it.each([
    ["a path traversal", "..%2F..%2Fetc"],
    ["a reserved profile prefix", "profile%3Acritic"],
    ["an over-long id", "a".repeat(65)],
    ["an empty value", ""],
  ])("drops %s with a warning", (_label, raw) => {
    const { state, warnings } = decodeUrlState(`?v=1&mode=suitability&cmpA=${raw}`);
    expect(state.cmpA).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("keeps a valid B when A is malformed, rather than failing the whole link", () => {
    const { state, warnings } = decodeUrlState("?v=1&mode=suitability&cmpA=bad%20id&cmpB=good");
    expect(state.cmpA).toBeUndefined();
    expect(state.cmpB).toBe("good");
    expect(warnings).toHaveLength(1);
  });

  it("KEEPS a well-formed id this browser may not hold — existence is not decided here", () => {
    // A link shared from another device is not malformed. The page resolves it and
    // says "이 브라우저에 없습니다"; silently dropping it here would look like the
    // reader had simply not chosen anything.
    const { state, warnings } = decodeUrlState("?v=1&mode=suitability&cmpA=from-another-device");
    expect(state.cmpA).toBe("from-another-device");
    expect(warnings).toEqual([]);
  });

  it("writes no comparison pair outside 후보지 분석", () => {
    const encoded = encodeUrlState({ ...BASE, mode: "equity", cmpA: "a1", cmpB: "b2" });
    expect(encoded).not.toContain("cmpA=");
    expect(encoded).not.toContain("cmpB=");
  });

  it("does not disturb the legacy Page-5 scenario link", () => {
    // wz/wr/we/wd + cmpProfile are ONE ad-hoc scenario's weights; cmpA/cmpB name
    // two stored scenarios. A pre-4D link must decode exactly as it always did.
    const legacy =
      "?v=1&mode=suitability&view=scenario&wz=0.4&wr=0.2&we=0.2&wd=0.2&cmpProfile=equal&cand=4242";
    const { state, warnings } = decodeUrlState(legacy);

    expect(state.weights).toEqual({ zoning: "0.4", road: "0.2", equity: "0.2", demand: "0.2" });
    expect(state.cmpProfile).toBe("equal");
    expect(state.candidate).toBe(4242);
    expect(state.cmpA).toBeUndefined();
    expect(state.cmpB).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("carries the legacy weights and the new pair in one link without either changing", () => {
    const encoded = encodeUrlState(
      suit({
        view: "scenario",
        weights: { zoning: "0.4", road: "0.2", equity: "0.2", demand: "0.2" },
        cmpProfile: "equal",
        cmpA: "a1",
        cmpB: "b2",
      }),
    );
    const { state, warnings } = decodeUrlState(encoded);
    expect(state.weights).toEqual({ zoning: "0.4", road: "0.2", equity: "0.2", demand: "0.2" });
    expect(state.cmpProfile).toBe("equal");
    expect(state.cmpA).toBe("a1");
    expect(state.cmpB).toBe("b2");
    expect(warnings).toEqual([]);
  });

  it("leaves the Page-4 scope and sort keys working alongside the pair", () => {
    const encoded = encodeUrlState(
      suit({ suitScope: { kind: "sido", sido: "KR-SGIS-11" }, suitSort: "score_asc", cmpA: "a1" }),
    );
    const { state } = decodeUrlState(encoded);
    expect(state.suitScope).toEqual({ kind: "sido", sido: "KR-SGIS-11" });
    expect(state.suitSort).toBe("score_asc");
    expect(state.cmpA).toBe("a1");
  });

  it("leaves Page 1/2/3 semantics untouched", () => {
    const { state } = decodeUrlState(
      "?v=1&mode=equity&metric=population&region=KR-SGIS-11&scope=31&top=20&cmpA=a1",
    );
    expect(state.metric).toBe("population");
    expect(state.region).toBe("KR-SGIS-11");
    expect(state.scope).toBe("31");
    expect(state.top).toBe(20);
    // Decoding is mode-agnostic (the mode may itself be restored from the link);
    // the ENCODER is what confines the pair to 후보지 분석.
    expect(state.cmpA).toBe("a1");
  });
});
