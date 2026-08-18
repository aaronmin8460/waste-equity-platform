/**
 * 사용자 지정 가중치 순위 — the adapter, the scope filter and the two display rules.
 *
 * The assertions that matter here are the honesty ones: the served rank and score are
 * carried through UNCHANGED, the scope filter is applied client-side (because the
 * endpoint has no scope parameter) and SAID so, and the 시·군·구 cap only ever hides
 * rows from the list — it never renumbers a rank or invents a group figure.
 */

import { describe, expect, it } from "vitest";

import type { UserScenarioPreview, UserScenarioTopCandidate } from "./api";
import {
  CUSTOM_RANKING_DISPLAY_N,
  CUSTOM_SCENARIO_TOP_N,
  applyRankingDisplayRules,
  capRowsPerSigungu,
  customWeightRankingCollection,
  customWeightRankingRows,
  customWeightScopeNote,
} from "./customWeightRanking";
import { SCOPE_ALL, type SuitabilityScope } from "./suitabilityScope";

function row(
  id: number,
  rank: number,
  score: string,
  sigunguCode: string,
  sidoCode = "KR-SGIS-23",
): UserScenarioTopCandidate {
  return {
    candidate_id: id,
    candidate_key: `cap500-${String(id).padStart(6, "0")}`,
    sido_region_code: sidoCode,
    sido_region_name: sidoCode === "KR-SGIS-23" ? "인천광역시" : "경기도",
    sigungu_region_code: sigunguCode,
    sigungu_region_name: `${sidoCode === "KR-SGIS-23" ? "인천광역시" : "경기도"} 테스트군`,
    custom_score: score,
    custom_rank: rank,
    comparison_profile: "baseline",
    comparison_score: "1.0000",
    comparison_rank: 99,
    rank_delta: 1,
    rank_change_direction: "up",
    zoning_score: "90.0000",
    road_score: "70.0000",
    equity_score: "95.0000",
    demand_score: "80.0000",
    component_scores: {},
    stable_count: 3,
    stability_class: "STABLE",
    centroid_lon: 126.5,
    centroid_lat: 37.7,
  };
}

function preview(rows: UserScenarioTopCandidate[]): UserScenarioPreview {
  return {
    scenario_hash: "hash",
    scenario_hash_short: "hash8",
    method_version: "v1",
    run_id: 47,
    reference_year: 2024,
    policy_version: "p",
    derivation_version: "d",
    candidate_grid_version: "g",
    component_model_version: "suitability-components-zred-v1",
    component_order: ["zoning", "road", "equity", "demand"],
    canonical_weights: {
      zoning: "0.25000000",
      road: "0.25000000",
      equity: "0.25000000",
      demand: "0.25000000",
    },
    compare_profile: "baseline",
    candidate_count_total: 20000,
    candidate_count_eligible: 17501,
    candidate_count_review: 0,
    candidate_count_excluded: 0,
    ranking_population: 17501,
    top_candidates: rows,
    selected_candidate: null,
    tile_url: "/tiles",
    assumptions: ["가정"],
    scenario_label: "사용자 가정 시나리오",
    scenario_disclaimer: "저장된 분석 실행이 아닙니다.",
    screening_disclaimer: "법적 판정이 아닙니다.",
  };
}

const INCHEON: SuitabilityScope = { kind: "sigungu", codes: ["KR-SGIS-23510"] };

describe("the bounds", () => {
  it("asks the endpoint for its own maximum, and displays five", () => {
    // 50 is the endpoint's hard ceiling (`top_n … le=50`), not a choice.
    expect(CUSTOM_SCENARIO_TOP_N).toBe(50);
    // 5 is the page-4 기술 참고사항's TOP5 requirement.
    expect(CUSTOM_RANKING_DISPLAY_N).toBe(5);
  });
});

describe("customWeightRankingRows", () => {
  it("carries the served rank and score through unchanged", () => {
    const result = customWeightRankingRows(
      preview([row(1, 1, "93.7777", "KR-SGIS-23510"), row(2, 2, "70.1111", "KR-SGIS-23520")]),
      SCOPE_ALL,
      "기본 기준",
    );
    expect(result.features).toHaveLength(2);
    // `custom_rank` → `rank`, `custom_score` → `total_score`, as strings, verbatim.
    expect(result.features[0].properties.rank).toBe(1);
    expect(result.features[0].properties.total_score).toBe("93.7777");
    expect(result.features[1].properties.total_score).toBe("70.1111");
    // Every row the preview ranks is ELIGIBLE by the query's own precondition.
    expect(result.features[0].properties.status).toBe("ELIGIBLE");
  });

  it("uses the SERVED centroid as geometry, and an empty geometry when absent", () => {
    const withCentroid = customWeightRankingRows(
      preview([row(1, 1, "90.0000", "KR-SGIS-23510")]),
      SCOPE_ALL,
      "기본 기준",
    );
    expect(withCentroid.features[0].geometry).toEqual({
      type: "Point",
      coordinates: [126.5, 37.7],
    });

    const bare = row(2, 1, "90.0000", "KR-SGIS-23510");
    bare.centroid_lon = null;
    bare.centroid_lat = null;
    const withoutCentroid = customWeightRankingRows(preview([bare]), SCOPE_ALL, "기본 기준");
    // The GeoJSON spelling of "no geometry" — never a point at 0,0.
    expect(withoutCentroid.features[0].geometry).toEqual({
      type: "GeometryCollection",
      geometries: [],
    });
  });

  it("filters the SERVED rows to the scope, and reports all three totals", () => {
    const result = customWeightRankingRows(
      preview([
        row(1, 1, "93.0000", "KR-SGIS-23510"),
        row(2, 2, "92.0000", "KR-SGIS-23520"),
        row(3, 3, "91.0000", "KR-SGIS-23510"),
      ]),
      INCHEON,
      "기본 기준",
    );
    expect(result.features.map((f) => f.properties.candidate_id)).toEqual([1, 3]);
    expect(result.servedCount).toBe(3);
    expect(result.inScopeCount).toBe(2);
    expect(result.rankingPopulation).toBe(17501);
    // The POPULATION-WIDE ranks survive the filter — they are not renumbered 1..2
    // inside the scope, because the server did not rank them that way.
    expect(result.features.map((f) => f.properties.rank)).toEqual([1, 3]);
  });
});

describe("customWeightRankingCollection", () => {
  it("names the scenario rather than borrowing a stored profile's identity", () => {
    const p = preview([row(1, 1, "93.0000", "KR-SGIS-23510")]);
    const collection = customWeightRankingCollection(
      p,
      customWeightRankingRows(p, SCOPE_ALL, "기본 기준"),
    );
    expect(collection.weight_profile).toBe("user-scenario:hash8");
    expect(collection.assumptions).toEqual(["가정"]);
    expect(collection.disclaimer).toBe("법적 판정이 아닙니다.");
    // No scope was applied by the SERVER, so its echo fields are honestly empty.
    expect(collection.sido).toBeNull();
    expect(collection.sigungu).toEqual([]);
  });
});

describe("capRowsPerSigungu", () => {
  it("keeps at most N per 시·군·구, in rank order, and counts what it held back", () => {
    const p = preview([
      row(1, 1, "95", "KR-SGIS-23510"),
      row(2, 2, "94", "KR-SGIS-23510"),
      row(3, 3, "93", "KR-SGIS-23510"),
      row(4, 4, "92", "KR-SGIS-23520"),
    ]);
    const { features } = customWeightRankingRows(p, SCOPE_ALL, "기본 기준");
    const capped = capRowsPerSigungu(features, 2);
    expect(capped.features.map((f) => f.properties.candidate_id)).toEqual([1, 2, 4]);
    expect(capped.heldBack).toBe(1);
    // NO rank was renumbered — the third row is still rank 4, not rank 3.
    expect(capped.features[2].properties.rank).toBe(4);
  });

  it("never caps unassigned cells against one another", () => {
    const p = preview([row(1, 1, "95", ""), row(2, 2, "94", ""), row(3, 3, "93", "")]);
    const { features } = customWeightRankingRows(p, SCOPE_ALL, "기본 기준");
    // An unassigned cell shares no place with any other, so none is held back.
    expect(capRowsPerSigungu(features, 1).heldBack).toBe(0);
  });

  it("is a no-op at a cap of zero or less", () => {
    const p = preview([row(1, 1, "95", "KR-SGIS-23510"), row(2, 2, "94", "KR-SGIS-23510")]);
    const { features } = customWeightRankingRows(p, SCOPE_ALL, "기본 기준");
    expect(capRowsPerSigungu(features, 0).features).toHaveLength(2);
  });
});

describe("applyRankingDisplayRules", () => {
  const p = preview([
    row(1, 1, "95", "KR-SGIS-23510"),
    row(2, 2, "94", "KR-SGIS-23510"),
    row(3, 3, "93", "KR-SGIS-23510"),
    row(4, 4, "92", "KR-SGIS-23520"),
    row(5, 5, "91", "KR-SGIS-23520"),
    row(6, 6, "90", "KR-SGIS-23530"),
  ]);
  const base = customWeightRankingCollection(
    p,
    customWeightRankingRows(p, SCOPE_ALL, "기본 기준"),
    99,
  );

  it("cuts to the display N without the cap", () => {
    const { collection, heldBack } = applyRankingDisplayRules(base, { cap: false, displayN: 5 });
    expect(collection.features).toHaveLength(5);
    expect(collection.count).toBe(5);
    expect(heldBack).toBe(0);
  });

  it("caps FIRST and cuts second, so the list keeps its stated size", () => {
    const { collection } = applyRankingDisplayRules(base, { cap: true, displayN: 5 });
    // 2 per 시·군·구 → ids 1,2,4,5,6 — five rows, not three.
    expect(collection.features.map((f) => f.properties.candidate_id)).toEqual([1, 2, 4, 5, 6]);
    expect(collection.count).toBe(5);
  });

  it("leaves the SERVED total_matched alone, whatever it displays", () => {
    // `total_matched` describes the filtered population, not this page of rows; a
    // display rule that edited it would make the count line claim a filter the
    // server never applied.
    const { collection } = applyRankingDisplayRules(base, { cap: true, displayN: 2 });
    expect(collection.total_matched).toBe(base.total_matched);
    expect(collection.features).toHaveLength(2);
  });
});

describe("customWeightScopeNote", () => {
  const p = preview([row(1, 1, "95", "KR-SGIS-23510"), row(2, 2, "94", "KR-SGIS-23520")]);

  it("names the ranked population and the served cut, unscoped", () => {
    const note = customWeightScopeNote(
      customWeightRankingRows(p, SCOPE_ALL, "기본 기준"),
      "수도권 전체",
      false,
    );
    expect(note).toContain("17,501곳");
    expect(note).toContain("상위 2개");
  });

  it("says the rows are the in-scope part of a POPULATION-WIDE ranking", () => {
    const note = customWeightScopeNote(
      customWeightRankingRows(p, INCHEON, "인천 강화군"),
      "인천 강화군",
      true,
    );
    // The distinction the endpoint's shape forces: these are the rows of the custom
    // top-N that lie in the 범위, NOT the top-N of that 범위.
    expect(note).toContain("다시 매긴 순위가 아니라 수도권 전체 순위");
    expect(note).toContain("상위 2개 밖에 있으면 여기에 나오지 않습니다");
  });
});
