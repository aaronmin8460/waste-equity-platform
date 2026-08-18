/**
 * The Page-5B analytics model — what every rank figure on the page MEANS.
 *
 * The assertions that matter most here are the negative ones: that a rank the server
 * did not send is never invented, that the preview's own official-profile comparison
 * columns are never mistaken for the A/B comparison, and that no screening or
 * threshold finding is derived from a reweighting. Every fixture is synthetic.
 */

import { describe, expect, it } from "vitest";

import type {
  UserScenarioPreview,
  UserScenarioTopCandidate,
  UserScenarioWeights,
} from "./api";
import type { ComparisonSide, ScenarioComparison } from "./scenarioComparison";
import {
  RANKING_COMPARISON_TOP_N,
  buildScenarioRankingComparison,
  formatRankMovement,
  formatUnavailableRank,
  rankBoundary,
  scoreChange,
  sortRankingComparisonRows,
  topRankMovements,
} from "./scenarioRankingComparison";

const WEIGHTS: UserScenarioWeights = {
  zoning: "0.40000000",
  road: "0.30000000",
  equity: "0.20000000",
  demand: "0.10000000",
};

/**
 * A served top-candidate row.
 *
 * The four official-profile comparison fields carry DELIBERATELY MISLEADING values
 * (`comparison_rank: 999`, a large `rank_delta`) so that any code path which read
 * them instead of `custom_rank` would produce an obviously wrong number here.
 */
function candidate(
  key: string,
  rank: number,
  score: string,
  overrides: Partial<UserScenarioTopCandidate> = {},
): UserScenarioTopCandidate {
  return {
    candidate_id: Number(key.replace(/\D/g, "")) || 1,
    candidate_key: key,
    sido_region_code: "KR-SGIS-23",
    sido_region_name: "인천광역시",
    // The backend serves an ALREADY-QUALIFIED 시·군·구 name, verified against a real
    // run-47 preview. A fixture saying "강화군" would hide a "인천광역시 인천광역시
    // 강화군" duplication in the label.
    sigungu_region_name: "인천광역시 강화군",
    sigungu_region_code: "KR-SGIS-23510",
    custom_score: score,
    custom_rank: rank,
    comparison_profile: "baseline",
    comparison_score: "0.9999",
    comparison_rank: 999,
    rank_delta: 900,
    rank_change_direction: "up",
    zoning_score: "0.8000",
    road_score: "0.7000",
    equity_score: "0.6000",
    demand_score: "0.5000",
    component_scores: {},
    stable_count: 3,
    stability_class: "STABLE",
    centroid_lon: 126.8,
    centroid_lat: 37.4,
    ...overrides,
  };
}

function preview(
  rows: UserScenarioTopCandidate[],
  overrides: Partial<UserScenarioPreview> = {},
): UserScenarioPreview {
  return {
    scenario_hash: "hash",
    scenario_hash_short: "hash",
    method_version: "scenario-v1",
    run_id: 47,
    reference_year: 2024,
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
    component_model_version: "suitability-components-zred-v1",
    component_order: ["zoning", "road", "equity", "demand"],
    canonical_weights: WEIGHTS,
    compare_profile: "baseline",
    candidate_count_total: 1000,
    candidate_count_eligible: 500,
    candidate_count_review: 300,
    candidate_count_excluded: 200,
    ranking_population: 500,
    top_candidates: rows,
    selected_candidate: null,
    tile_url: "/tiles",
    assumptions: [],
    scenario_label: "사용자 가정 기반 시나리오",
    scenario_disclaimer: "임시 비교 결과입니다.",
    screening_disclaimer: "광역 분석 스크리닝",
    ...overrides,
  };
}

function side(slot: "A" | "B", value: UserScenarioPreview | null): ComparisonSide {
  return {
    slot,
    scenarioId: `sc-${slot.toLowerCase()}`,
    scenarioName: slot === "A" ? "균형안" : "형평성안",
    savedScenario: null,
    canonicalWeights: value?.canonical_weights ?? null,
    runId: value?.run_id ?? null,
    preview: value,
    state: value === null ? "PREVIEW_ERROR" : "READY",
    errorMessage: value === null ? "실패" : null,
  };
}

function comparison(
  a: UserScenarioPreview | null,
  b: UserScenarioPreview | null,
): ScenarioComparison {
  return {
    runId: 47,
    sideA: side("A", a),
    sideB: side("B", b),
    status: a !== null && b !== null ? "READY" : "PREVIEW_ERROR_BOTH",
    loading: false,
  };
}

/** N ranked rows keyed `c1..cN`, ranks 1..N — the shape the endpoint actually serves. */
function ranked(keys: string[]): UserScenarioTopCandidate[] {
  return keys.map((key, index) => candidate(key, index + 1, (1 - index * 0.01).toFixed(4)));
}

function build(a: UserScenarioPreview, b: UserScenarioPreview, scopeName?: string) {
  const model = buildScenarioRankingComparison(comparison(a, b), scopeName);
  if (model === null) throw new Error("expected a model");
  return model;
}

function row(model: ReturnType<typeof build>, key: string) {
  const found = model.candidateRows.find((r) => r.candidateKey === key);
  if (found === undefined) throw new Error(`no row for ${key}`);
  return found;
}

// --------------------------------------------------------------------------- //

describe("readiness gate", () => {
  it("builds nothing when a side is not READY — Page 5A owns that state", () => {
    expect(buildScenarioRankingComparison(comparison(preview(ranked(["c1"])), null))).toBeNull();
    expect(buildScenarioRankingComparison(comparison(null, preview(ranked(["c1"]))))).toBeNull();
    expect(buildScenarioRankingComparison(comparison(null, null))).toBeNull();
  });

  it("builds nothing when a side is READY in name but carries no preview", () => {
    const broken = comparison(preview(ranked(["c1"])), preview(ranked(["c1"])));
    broken.sideB = { ...broken.sideB, preview: null };
    expect(buildScenarioRankingComparison(broken)).toBeNull();
  });

  it("carries the ACTIVE run, not either scenario's stored one", () => {
    expect(build(preview(ranked(["c1"])), preview(ranked(["c1"]))).runId).toBe(47);
  });
});

describe("candidate join", () => {
  it("joins on candidate_key, never on row position", () => {
    // Same two cells, opposite order. A positional join would pair c1 with c2.
    const model = build(preview(ranked(["c1", "c2"])), preview(ranked(["c2", "c1"])));
    expect(row(model, "c1").aRank).toBe(1);
    expect(row(model, "c1").bRank).toBe(2);
    expect(row(model, "c2").aRank).toBe(2);
    expect(row(model, "c2").bRank).toBe(1);
  });

  it("does not join on the location label — two cells in one 시·군·구 stay two rows", () => {
    const a = preview([
      candidate("c1", 1, "0.9000", { sigungu_region_name: "인천광역시 강화군" }),
      candidate("c2", 2, "0.8000", { sigungu_region_name: "인천광역시 강화군" }),
    ]);
    const model = build(a, a);
    expect(model.candidateRows).toHaveLength(2);
    expect(model.candidateRows.map((r) => r.candidateKey)).toEqual(["c1", "c2"]);
  });

  it("keeps the candidate cell's own identity — key, id and centroid", () => {
    const model = build(preview(ranked(["c7"])), preview(ranked(["c7"])));
    const only = row(model, "c7");
    expect(only.candidateKey).toBe("c7");
    expect(only.candidateId).toBe(7);
    expect(only.centroidLat).toBe(37.4);
    // The served 시·군·구 name verbatim — the 시·도 is NOT prepended to it.
    expect(only.locationLabel).toBe("인천광역시 강화군");
  });

  it("does not print the 시·도 twice — the served 시·군·구 is already qualified", () => {
    const model = build(preview(ranked(["c1"])), preview(ranked(["c1"])));
    expect(row(model, "c1").locationLabel).not.toContain("인천광역시 인천광역시");
  });

  it("falls back to the 시·도 for a cell with no 시·군·구 assigned", () => {
    const orphan = preview([candidate("c1", 1, "0.9000", { sigungu_region_name: null })]);
    expect(row(build(orphan, orphan), "c1").locationLabel).toBe("인천광역시");
  });

  it("has no location label at all when neither name was served", () => {
    const nowhere = preview([
      candidate("c1", 1, "0.9000", { sigungu_region_name: null, sido_region_name: null }),
    ]);
    expect(row(build(nowhere, nowhere), "c1").locationLabel).toBeNull();
  });

  it("takes both sides' scores from their OWN custom_score", () => {
    const a = preview([candidate("c1", 1, "0.9100")]);
    const b = preview([candidate("c1", 1, "0.7300")]);
    const only = row(build(a, b), "c1");
    expect(only.aScore).toBe("0.9100");
    expect(only.bScore).toBe("0.7300");
  });

  it("never reads the preview's official-profile comparison columns for A vs B", () => {
    // Every fixture row carries comparison_rank 999 / rank_delta 900. If any of them
    // leaked into the A/B model these would not be 1, 1, 0.
    const model = build(preview(ranked(["c1"])), preview(ranked(["c1"])));
    const only = row(model, "c1");
    expect(only.aRank).toBe(1);
    expect(only.bRank).toBe(1);
    expect(only.rankDelta).toBe(0);
    expect(JSON.stringify(model)).not.toContain("999");
  });

  it("takes the first occurrence of a duplicated key rather than the last", () => {
    const a = preview([candidate("c1", 1, "0.9000"), candidate("c1", 2, "0.8000")]);
    const model = build(a, preview(ranked(["c1"])));
    expect(model.candidateRows).toHaveLength(1);
    expect(row(model, "c1").aRank).toBe(1);
  });
});

describe("top-1 comparison", () => {
  it("reports 변화 없음 when both sides rank the same cell first", () => {
    const model = build(preview(ranked(["c1", "c2"])), preview(ranked(["c1", "c2"])));
    expect(model.topCandidate.state).toBe("UNCHANGED");
    expect(model.topCandidate.a?.candidateKey).toBe("c1");
    expect(model.topCandidate.b?.candidateKey).toBe("c1");
  });

  it("reports both identities when the top candidate changed", () => {
    const model = build(preview(ranked(["c1", "c2"])), preview(ranked(["c2", "c1"])));
    expect(model.topCandidate.state).toBe("CHANGED");
    expect(model.topCandidate.a?.candidateKey).toBe("c1");
    expect(model.topCandidate.b?.candidateKey).toBe("c2");
  });

  it("is UNAVAILABLE — not 변화 없음 — when a side served no rank-1 row", () => {
    const model = build(preview(ranked(["c1"])), preview([]));
    expect(model.topCandidate.state).toBe("UNAVAILABLE");
    expect(model.topCandidate.b).toBeNull();
  });
});

describe("TOP-N retention — an exact set overlap, and nothing wider", () => {
  const twelve = (offset: number) =>
    ranked(Array.from({ length: 12 }, (_, i) => `c${i + 1 + offset}`));

  it("counts the exact intersection of the two top-10 key sets", () => {
    // A top 10 = c1..c10; B top 10 = c4..c13 → 7 shared.
    const model = build(preview(twelve(0)), preview(twelve(3)));
    expect(model.topNRetention.retained).toBe(7);
    expect(model.topNRetention.denominator).toBe(10);
    expect(model.topNRetention.percent).toBe(70);
    expect(model.topNRetention.reduced).toBe(false);
  });

  it("is 10/10 for two identical rankings", () => {
    const model = build(preview(twelve(0)), preview(twelve(0)));
    expect(model.topNRetention.retained).toBe(10);
    expect(model.topNRetention.percent).toBe(100);
  });

  it("is 0/10 for two disjoint top-10 sets", () => {
    const model = build(preview(ranked(["a1", "a2"])), preview(ranked(["b1", "b2"])));
    expect(model.topNRetention.retained).toBe(0);
    expect(model.topNRetention.percent).toBe(0);
  });

  it("uses the ACTUAL denominator when a side served fewer than N", () => {
    const short = preview(ranked(["c1", "c2", "c3"]), { ranking_population: 3 });
    const model = build(short, short);
    expect(model.topNRetention.denominator).toBe(3);
    expect(model.topNRetention.n).toBe(RANKING_COMPARISON_TOP_N);
    expect(model.topNRetention.reduced).toBe(true);
    expect(model.topNRetention.percent).toBe(100);
  });

  it("has no percent at all when neither side served a candidate", () => {
    const model = build(preview([]), preview([]));
    expect(model.topNRetention.denominator).toBe(0);
    expect(model.topNRetention.percent).toBeNull();
  });

  it("counts only the top N — an 11th-ranked shared candidate does not raise it", () => {
    const a = preview(ranked(Array.from({ length: 11 }, (_, i) => `c${i + 1}`)));
    // B pushes c1 out of the top 10 to rank 11 and promotes c11.
    const bKeys = ["c11", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c1"];
    const model = build(a, preview(ranked(bKeys)));
    expect(model.topNRetention.retained).toBe(9);
    expect(row(model, "c1").bRank).toBe(11);
  });
});

describe("rank movement — direction, and the sign that must not invert", () => {
  it("calls a SMALLER B rank number 순위 상승", () => {
    const a = preview(ranked(["x", "y", "z"]));
    const b = preview(ranked(["z", "x", "y"]));
    const moved = row(build(a, b), "z");
    expect(moved.aRank).toBe(3);
    expect(moved.bRank).toBe(1);
    expect(moved.rankDelta).toBe(-2);
    expect(moved.movement).toBe(2);
    expect(moved.direction).toBe("UP");
  });

  it("calls a LARGER B rank number 순위 하락", () => {
    const a = preview(ranked(["x", "y", "z"]));
    const b = preview(ranked(["y", "z", "x"]));
    const moved = row(build(a, b), "x");
    expect(moved.aRank).toBe(1);
    expect(moved.bRank).toBe(3);
    expect(moved.rankDelta).toBe(2);
    expect(moved.direction).toBe("DOWN");
  });

  it("calls an unchanged rank 유지, with a zero delta", () => {
    const same = row(build(preview(ranked(["x"])), preview(ranked(["x"]))), "x");
    expect(same.rankDelta).toBe(0);
    expect(same.direction).toBe("SAME");
    expect(formatRankMovement(same)).toBe("유지");
  });

  it("formats movement with a direction word, never colour or sign alone", () => {
    const a = preview(ranked(["x", "y", "z"]));
    const b = preview(ranked(["z", "x", "y"]));
    const model = build(a, b);
    expect(formatRankMovement(row(model, "z"))).toBe("↑ 2계단");
    expect(formatRankMovement(row(model, "x"))).toBe("↓ 1계단");
  });

  it("counts risers, fallers and holders over the COMMON candidates only", () => {
    const a = preview(ranked(["x", "y", "z"]));
    const b = preview(ranked(["z", "x", "y"]));
    const model = build(a, b);
    expect(model.roseCount).toBe(1); // z: 3 → 1
    expect(model.fellCount).toBe(2); // x: 1 → 2, y: 2 → 3
    expect(model.heldCount).toBe(0);
    expect(model.comparableRows).toHaveLength(3);
  });
});

describe("missing ranks are never invented", () => {
  /** A served 3 of a 500-strong population; B served 3 different ones. */
  const disjoint = () =>
    build(preview(ranked(["a1", "a2", "a3"])), preview(ranked(["b1", "b2", "b3"])));

  it("states OUTSIDE_PREVIEW rather than a number when the cut provably excludes it", () => {
    const only = row(disjoint(), "a1");
    expect(only.aRankState).toBe("EXACT");
    expect(only.bRankState).toBe("OUTSIDE_PREVIEW");
    expect(only.bRank).toBeNull();
  });

  it("never substitutes top_n + 1, the population, or any other stand-in", () => {
    const only = row(disjoint(), "a1");
    expect(only.bRank).toBeNull();
    expect(only.rankDelta).toBeNull();
    expect(only.movement).toBeNull();
    expect(only.direction).toBeNull();
    expect(only.bScore).toBeNull();
  });

  it("applies the same rule in the opposite direction", () => {
    const only = row(disjoint(), "b1");
    expect(only.bRankState).toBe("EXACT");
    expect(only.aRankState).toBe("OUTSIDE_PREVIEW");
    expect(only.aRank).toBeNull();
  });

  it("excludes a one-sided candidate from every movement count", () => {
    const model = disjoint();
    expect(model.comparableRows).toHaveLength(0);
    expect(model.roseCount + model.fellCount + model.heldCount).toBe(0);
  });

  it("downgrades to UNKNOWN when the served ranks are not provably 1..k", () => {
    // A hand-built response whose ranks start at 5: nothing can be concluded about
    // the ranks it omitted, so "상위 3 밖" would be an unearned claim.
    const odd = preview([
      candidate("b1", 5, "0.5000"),
      candidate("b2", 6, "0.4000"),
      candidate("b3", 7, "0.3000"),
    ]);
    const only = row(build(preview(ranked(["a1"])), odd), "a1");
    expect(only.bRankState).toBe("UNKNOWN");
    expect(only.bRank).toBeNull();
  });

  it("downgrades to UNKNOWN when the cut already held the whole population", () => {
    // ranking_population 3 with 3 rows served: there is no "outside" to be outside of,
    // so an absent candidate is a disagreement about the population, not a rank.
    const whole = preview(ranked(["b1", "b2", "b3"]), { ranking_population: 3 });
    const only = row(build(preview(ranked(["a1"])), whole), "a1");
    expect(only.bRankState).toBe("UNKNOWN");
  });

  it("words the two unavailable states differently and never as a number", () => {
    const boundary = rankBoundary(preview(ranked(["b1", "b2", "b3"])));
    expect(formatUnavailableRank("OUTSIDE_PREVIEW", "B", boundary)).toBe("B안 상위 3 밖");
    expect(formatUnavailableRank("UNKNOWN", "B", boundary)).toBe("B안 순위 미제공");
  });

  it("has no movement text for a row with no exact movement", () => {
    expect(formatRankMovement(row(disjoint(), "a1"))).toBeNull();
  });
});

describe("rankBoundary", () => {
  it("recognises a served 1..k list as contiguous", () => {
    const boundary = rankBoundary(preview(ranked(["c1", "c2", "c3"])));
    expect(boundary.servedCount).toBe(3);
    expect(boundary.contiguous).toBe(true);
    expect(boundary.complete).toBe(false);
    expect(boundary.rankingPopulation).toBe(500);
  });

  it("rejects a gapped list", () => {
    const gapped = preview([candidate("c1", 1, "0.9"), candidate("c3", 3, "0.7")]);
    expect(rankBoundary(gapped).contiguous).toBe(false);
  });

  it("marks a cut that held the whole population complete", () => {
    expect(rankBoundary(preview(ranked(["c1"]), { ranking_population: 1 })).complete).toBe(true);
  });

  it("treats an empty or absent preview as proving nothing", () => {
    expect(rankBoundary(preview([])).contiguous).toBe(false);
    expect(rankBoundary(null).servedCount).toBe(0);
    expect(rankBoundary(null).rankingPopulation).toBeNull();
  });
});

describe("bounded population labelling", () => {
  it("names the per-side cut and the full ranked population", () => {
    const model = build(preview(ranked(["c1", "c2"])), preview(ranked(["c1", "c2"])));
    expect(model.scopeDescription).toContain("각각 상위 2개");
    expect(model.scopeDescription).toContain("500개");
    expect(model.rankingPopulation).toBe(500);
  });

  it("names both cuts separately when the two sides served different counts", () => {
    const model = build(preview(ranked(["c1", "c2"])), preview(ranked(["c1"])));
    expect(model.scopeDescription).toContain("A안 상위 2개");
    expect(model.scopeDescription).toContain("B안 상위 1개");
  });

  it("omits the population sentence when the two sides disagree about it", () => {
    const a = preview(ranked(["c1"]), { ranking_population: 500 });
    const b = preview(ranked(["c1"]), { ranking_population: 480 });
    const model = build(a, b);
    expect(model.rankingPopulation).toBeNull();
    expect(model.scopeDescription).not.toContain("순위 대상");
  });

  it("never describes the comparison as covering the whole ranking", () => {
    const model = build(preview(ranked(["c1"])), preview(ranked(["c1"])));
    expect(model.scopeDescription).not.toContain("전체 후보");
    expect(model.scopeDescription).not.toContain("전체 순위");
  });

  it("names the ANALYSIS SCOPE, so a scoped population is not read as a shrunken one", () => {
    // The backend ranks within ① 분석 범위, so `ranking_population` is that 범위's
    // size. Unlabelled, "순위 대상 후보 구역은 500개" looks like a capital-region
    // figure that inexplicably shrank; naming the 범위 is what makes it readable.
    const model = build(preview(ranked(["c1", "c2"])), preview(ranked(["c1", "c2"])), "경기");
    expect(model.scopeDescription).toContain("분석 범위 경기");
    expect(model.scopeDescription).toContain("경기 범위의 순위 대상 후보 구역은 500개");
  });

  it("says nothing about a 범위 when the comparison covers 수도권 전체", () => {
    const model = build(preview(ranked(["c1"])), preview(ranked(["c1"])));
    expect(model.scopeDescription).not.toContain("분석 범위");
    expect(model.scopeDescription).toContain("현재 분석 실행의");
  });
});

describe("slope rows — the A/B top-N union", () => {
  const eleven = (keys: string[]) => preview(ranked(keys));
  const KEYS_A = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11"];
  const KEYS_B = ["c11", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c1"];

  it("is the UNION of both top-N sets, not the intersection", () => {
    const model = build(eleven(KEYS_A), eleven(KEYS_B));
    // c1 (A top 10, B rank 11) and c11 (B top 10, A rank 11) are both present.
    const keys = model.slopeRows.map((r) => r.candidateKey);
    expect(keys).toContain("c1");
    expect(keys).toContain("c11");
    expect(model.slopeRows).toHaveLength(11);
  });

  it("gives a slot only on the side where the candidate is in the top N", () => {
    const model = build(eleven(KEYS_A), eleven(KEYS_B));
    const leaving = model.slopeRows.find((r) => r.candidateKey === "c1");
    expect(leaving?.aSlot).toBe(1);
    expect(leaving?.bSlot).toBeNull();
    // Its real B rank is still served and exact — the endpoint is missing from the
    // COLUMN, not from the data.
    expect(leaving?.bRank).toBe(11);
    expect(leaving?.bRankState).toBe("EXACT");
  });

  it("draws no numeric endpoint where the rank is not exact", () => {
    const model = build(preview(ranked(["a1"])), preview(ranked(["b1"])));
    const entering = model.slopeRows.find((r) => r.candidateKey === "b1");
    expect(entering?.aSlot).toBeNull();
    expect(entering?.aRank).toBeNull();
    expect(entering?.aRankState).toBe("OUTSIDE_PREVIEW");
  });

  it("orders by A slot first so the left column reads 1..N downwards", () => {
    const model = build(eleven(KEYS_A), eleven(KEYS_B));
    const slots = model.slopeRows.map((r) => r.aSlot);
    expect(slots.slice(0, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(slots[10]).toBeNull();
  });

  it("excludes candidates outside both top-N sets", () => {
    const long = Array.from({ length: 20 }, (_, i) => `c${i + 1}`);
    const model = build(preview(ranked(long)), preview(ranked(long)));
    expect(model.slopeRows).toHaveLength(RANKING_COMPARISON_TOP_N);
    expect(model.candidateRows).toHaveLength(20);
  });
});

describe("ranking movement list", () => {
  it("ranks by absolute exact movement, largest first", () => {
    const a = preview(ranked(["c1", "c2", "c3", "c4"]));
    const b = preview(ranked(["c4", "c1", "c3", "c2"]));
    const list = topRankMovements(build(a, b));
    // c4: 4→1 (3), c2: 2→4 (2), c1: 1→2 (1). c3 held and is excluded.
    expect(list.map((r) => r.candidateKey)).toEqual(["c4", "c2", "c1"]);
    expect(list.map((r) => r.movement)).toEqual([3, 2, 1]);
  });

  it("excludes rows without an exact rank on BOTH sides", () => {
    const a = preview(ranked(["c1", "c2", "only-a"]));
    const b = preview(ranked(["c2", "c1", "only-b"]));
    const keys = topRankMovements(build(a, b)).map((r) => r.candidateKey);
    expect(keys).not.toContain("only-a");
    expect(keys).not.toContain("only-b");
  });

  it("excludes candidates that did not move at all", () => {
    const same = preview(ranked(["c1", "c2"]));
    expect(topRankMovements(build(same, same))).toHaveLength(0);
  });

  it("caps the list and is deterministic for tied movements", () => {
    const a = preview(ranked(["c1", "c2", "c3", "c4"]));
    const b = preview(ranked(["c2", "c1", "c4", "c3"]));
    const list = topRankMovements(build(a, b), 2);
    expect(list).toHaveLength(2);
    // All four moved by 1; the tie breaks on the A rank, so c1 then c2.
    expect(list.map((r) => r.candidateKey)).toEqual(["c1", "c2"]);
  });
});

describe("local sorting — reorders, never re-populates", () => {
  const a = preview(ranked(["c1", "c2", "c3", "only-a"]));
  const b = preview(ranked(["c3", "c1", "c2", "only-b"]));

  it("keeps exactly the same rows under every sort", () => {
    const model = build(a, b);
    const baseline = [...model.candidateRows.map((r) => r.candidateKey)].sort();
    for (const sort of [
      "movement_desc",
      "rank_a_asc",
      "rank_b_asc",
      "score_change_desc",
    ] as const) {
      const sorted = sortRankingComparisonRows(model.candidateRows, sort);
      expect(sorted).toHaveLength(model.candidateRows.length);
      expect(sorted.map((r) => r.candidateKey).sort()).toEqual(baseline);
    }
  });

  it("does not mutate the model's own row order", () => {
    const model = build(a, b);
    const before = model.candidateRows.map((r) => r.candidateKey);
    sortRankingComparisonRows(model.candidateRows, "movement_desc");
    expect(model.candidateRows.map((r) => r.candidateKey)).toEqual(before);
  });

  it("sorts by absolute movement, with unmovable rows last", () => {
    const sorted = sortRankingComparisonRows(build(a, b).candidateRows, "movement_desc");
    expect(sorted[0].candidateKey).toBe("c3"); // 3 → 1
    const tail = sorted.slice(-2).map((r) => r.candidateKey).sort();
    expect(tail).toEqual(["only-a", "only-b"]);
  });

  it("sorts by A rank and by B rank with absent ranks last in BOTH", () => {
    const rows = build(a, b).candidateRows;
    expect(sortRankingComparisonRows(rows, "rank_a_asc")[0].candidateKey).toBe("c1");
    expect(sortRankingComparisonRows(rows, "rank_a_asc").at(-1)?.candidateKey).toBe("only-b");
    expect(sortRankingComparisonRows(rows, "rank_b_asc")[0].candidateKey).toBe("c3");
    expect(sortRankingComparisonRows(rows, "rank_b_asc").at(-1)?.candidateKey).toBe("only-a");
  });

  it("sorts by score change, largest gain first", () => {
    const low = preview([candidate("c1", 1, "0.5000"), candidate("c2", 2, "0.4000")]);
    const high = preview([candidate("c2", 1, "0.9000"), candidate("c1", 2, "0.5100")]);
    const sorted = sortRankingComparisonRows(build(low, high).candidateRows, "score_change_desc");
    expect(sorted[0].candidateKey).toBe("c2"); // +0.5
    expect(scoreChange(sorted[0])).toBeCloseTo(0.5, 4);
  });

  it("has no score change for a one-sided row", () => {
    expect(scoreChange(row(build(a, b), "only-a"))).toBeNull();
  });
});

describe("comparison table population", () => {
  it("is the union of the two served lists", () => {
    const model = build(preview(ranked(["c1", "only-a"])), preview(ranked(["c1", "only-b"])));
    expect(model.candidateRows.map((r) => r.candidateKey).sort()).toEqual([
      "c1",
      "only-a",
      "only-b",
    ]);
  });

  it("orders naturally by A rank, then B rank, then key", () => {
    const model = build(preview(ranked(["c1", "c2"])), preview(ranked(["c2", "zz"])));
    expect(model.candidateRows.map((r) => r.candidateKey)).toEqual(["c1", "c2", "zz"]);
  });

  it("is empty, not fabricated, when neither side served a candidate", () => {
    const model = build(preview([]), preview([]));
    expect(model.candidateRows).toEqual([]);
    expect(model.slopeRows).toEqual([]);
    expect(model.topCandidate.state).toBe("UNAVAILABLE");
  });
});

describe("no screening or threshold analytics", () => {
  it("derives no status, pass count, or newly-passed figure", () => {
    const model = build(preview(ranked(["c1", "c2"])), preview(ranked(["c2", "c1"])));
    const serialised = JSON.stringify(model);
    for (const forbidden of ["통과", "제외", "screening", "status", "eligible", "excluded"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("does not read the preview's candidate_count_* family", () => {
    const a = preview(ranked(["c1"]), { candidate_count_eligible: 4321 });
    const model = build(a, preview(ranked(["c1"])));
    expect(JSON.stringify(model)).not.toContain("4321");
  });

  it("derives no 60/62-point threshold", () => {
    const model = build(preview(ranked(["c1"])), preview(ranked(["c1"])));
    const serialised = JSON.stringify(model);
    expect(serialised).not.toContain("60점");
    expect(serialised).not.toContain("62");
  });
});
