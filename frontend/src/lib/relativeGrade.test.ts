/**
 * 상대 점수 구간 (A/B/C) — the analytically sensitive part of Phase 3.
 *
 * These tests exist to make three specific mistakes impossible:
 *   1. grading a candidate that has no official ELIGIBLE status;
 *   2. computing thresholds from anything other than the COMPLETE authoritative
 *      population (a viewport, a filter, a top-N slice);
 *   3. inventing a threshold when the population cannot be established.
 *
 * The real production distribution is pinned at the bottom as a regression
 * fixture: run 48 / baseline, verified against the live API.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import * as api from "./api";
import {
  GRADE_LABELS,
  RELATIVE_GRADE_EXPLANATION,
  ascendingIndexToDescendingRank,
  __resetGradeCache,
  computeGradeDistribution,
  gradeFor,
  nearestRankIndex,
  relativeGradeBasis,
} from "./relativeGrade";

// --------------------------------------------------------------------------- //
// The percentile arithmetic — pinned independently of any network call.
// --------------------------------------------------------------------------- //

describe("nearest-rank percentile arithmetic", () => {
  it("uses ceil(p/100 × N) on the ASCENDING order", () => {
    expect(nearestRankIndex(25, 17501)).toBe(4376); // ceil(4375.25)
    expect(nearestRankIndex(75, 17501)).toBe(13126); // ceil(13125.75)
    expect(nearestRankIndex(25, 100)).toBe(25);
    expect(nearestRankIndex(75, 100)).toBe(75);
    // An exact boundary must not round up an extra place.
    expect(nearestRankIndex(25, 4)).toBe(1);
    expect(nearestRankIndex(75, 4)).toBe(3);
  });

  it("maps an ascending index to the descending rank the API uses", () => {
    // The API ranks 1 = highest score, so the two orders are mirror images.
    expect(ascendingIndexToDescendingRank(4376, 17501)).toBe(13126);
    expect(ascendingIndexToDescendingRank(13126, 17501)).toBe(4376);
    // The extremes map to each other.
    expect(ascendingIndexToDescendingRank(1, 17501)).toBe(17501);
    expect(ascendingIndexToDescendingRank(17501, 17501)).toBe(1);
  });

  it("round-trips: mapping twice returns the original index", () => {
    for (const n of [4, 7, 100, 999, 17501]) {
      for (const i of [1, 2, Math.ceil(n / 2), n]) {
        expect(ascendingIndexToDescendingRank(ascendingIndexToDescendingRank(i, n), n)).toBe(i);
      }
    }
  });
});

// --------------------------------------------------------------------------- //
// Band assignment — the status gate is the important half.
// --------------------------------------------------------------------------- //

const T = { p25: 47.6779, p75: 57.811 };

describe("gradeFor", () => {
  it("assigns the three bands at the documented boundaries", () => {
    expect(gradeFor("ELIGIBLE", 90, T)).toBe("A");
    expect(gradeFor("ELIGIBLE", 57.811, T)).toBe("A"); // >= P75 is inclusive
    expect(gradeFor("ELIGIBLE", 57.8109, T)).toBe("B"); // just below P75
    expect(gradeFor("ELIGIBLE", 50, T)).toBe("B");
    expect(gradeFor("ELIGIBLE", 47.6779, T)).toBe("B"); // >= P25 is inclusive
    expect(gradeFor("ELIGIBLE", 47.6778, T)).toBe("C"); // just below P25
    expect(gradeFor("ELIGIBLE", 0, T)).toBe("C");
  });

  it("accepts the served decimal STRING score, as the API returns it", () => {
    expect(gradeFor("ELIGIBLE", "57.811", T)).toBe("A");
    expect(gradeFor("ELIGIBLE", "47.6779", T)).toBe("B");
    expect(gradeFor("ELIGIBLE", "10.0", T)).toBe("C");
  });

  it("NEVER grades a candidate whose official status is not ELIGIBLE", () => {
    // This is the whole point of the status gate: A/B/C is a relative division of
    // the eligible population, so a review/excluded cell is not in it at all.
    // Giving one a "C" would read as an official verdict, which it is not.
    for (const score of [0, 50, 99]) {
      expect(gradeFor("REVIEW_REQUIRED", score, T), `review ${score}`).toBeNull();
      expect(gradeFor("EXCLUDED", score, T), `excluded ${score}`).toBeNull();
    }
  });

  it("treats a missing score as ungraded, NEVER as a low score", () => {
    // Absence is not zero (repo AGENTS.md). A null score must not fall into C.
    expect(gradeFor("ELIGIBLE", null, T)).toBeNull();
    expect(gradeFor("ELIGIBLE", undefined, T)).toBeNull();
    expect(gradeFor("ELIGIBLE", "", T)).toBeNull();
    expect(gradeFor("ELIGIBLE", "n/a", T)).toBeNull();
    expect(gradeFor("ELIGIBLE", Number.NaN, T)).toBeNull();
  });

  it("returns null for every candidate when thresholds are unavailable", () => {
    // The disabled state must be total — no partial grading.
    expect(gradeFor("ELIGIBLE", 99, null)).toBeNull();
    expect(gradeFor("ELIGIBLE", 0, null)).toBeNull();
  });
});

describe("citizen-facing wording", () => {
  it("never lets a BAND LABEL borrow official status vocabulary", () => {
    // The labels are what could masquerade as a verdict — they appear on chips,
    // in the legend, and beside a candidate, usually with no sentence next to
    // them. So the status words are banned there specifically.
    for (const label of Object.values(GRADE_LABELS)) {
      for (const forbidden of ["적격", "부적격", "제외", "통과", "탈락"]) {
        expect(label, `${label} must not say "${forbidden}"`).not.toContain(forbidden);
      }
      // Each label names the band and nothing more.
      expect(label).toContain("구간");
    }
  });

  it("states the two false readings and denies them explicitly", () => {
    // The explanation DOES use 적격/제외 — in a negation, which is the point.
    // A grade shown with no disclaimer is what the spec forbids, not the words.
    expect(RELATIVE_GRADE_EXPLANATION).toContain("법적 적합·부적합 판정이 아닙니다");
    expect(RELATIVE_GRADE_EXPLANATION).toContain("A가 적격을 의미하지 않고");
    expect(RELATIVE_GRADE_EXPLANATION).toContain("C가 제외를 의미하지 않습니다");
    // And it says what the bands actually are.
    expect(RELATIVE_GRADE_EXPLANATION).toContain("상대");
  });

  it("names the population the bands came from", () => {
    const basis = relativeGradeBasis({
      runId: 48,
      profile: "baseline",
      scope: { kind: "all" },
      population: 17501,
      p25: 47.6779,
      p75: 57.811,
      countA: 4914,
      countB: 8403,
      countC: 4184,
    });
    // A reader must never have to guess whether this was the whole set or the
    // part currently on screen.
    expect(basis).toContain("17,501");
    expect(basis).toContain("전체");
    expect(basis).toContain("47.6779");
    expect(basis).toContain("57.811");
  });
});

// --------------------------------------------------------------------------- //
// The distribution read.
// --------------------------------------------------------------------------- //

type Coll = Awaited<ReturnType<typeof api.fetchSuitabilityCandidates>>;

/** A minimal candidate collection carrying one score and a total_matched. */
function coll(totalMatched: number, score: string | null = null): Coll {
  return {
    total_matched: totalMatched,
    features: score === null ? [] : [{ properties: { total_score: score } }],
  } as unknown as Coll;
}

let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The module memoises successful distributions, so each test starts from a
  // cold cache or it would observe the previous test's reads.
  __resetGradeCache();
  spy = vi.spyOn(api, "fetchSuitabilityCandidates");
});
afterEach(() => vi.restoreAllMocks());

/** Wire the four reads the happy path makes, in call order. */
function wireHappyPath(n: number, p25: string, p75: string, countA: number, geP25: number) {
  spy.mockImplementation(((query: api.CandidateQuery) => {
    if (query.minScore !== undefined) {
      return Promise.resolve(coll(query.minScore === Number(p75) ? countA : geP25));
    }
    if (query.offset === undefined) return Promise.resolve(coll(n));
    // Offset reads: the two order statistics.
    const rank25 = ascendingIndexToDescendingRank(nearestRankIndex(25, n), n);
    return Promise.resolve(coll(n, query.offset === rank25 - 1 ? p25 : p75));
  }) as typeof api.fetchSuitabilityCandidates);
}

describe("computeGradeDistribution", () => {
  it("reads the COMPLETE population, never a viewport or a filtered slice", async () => {
    wireHappyPath(17501, "47.6779", "57.811", 4914, 13317);
    const d = await computeGradeDistribution(48, "baseline");
    expect(d).not.toBeNull();

    for (const [, call] of spy.mock.calls.entries()) {
      const q = call[0] as api.CandidateQuery;
      // Only officially eligible candidates are in the population…
      expect(q.status).toBe("ELIGIBLE");
      // …for the run and profile the map is showing…
      expect(q.runId).toBe(48);
      expect(q.profile).toBe("baseline");
      // …and NEVER narrowed by anything that depends on what is on screen.
      expect(q.bbox, "bbox would make the thresholds viewport-dependent").toBeUndefined();
      expect(q.sido, "a region filter would not be the whole population").toBeUndefined();
      expect(q.stability_class).toBeUndefined();
    }
  });

  it("addresses the two order statistics by descending rank", async () => {
    wireHappyPath(17501, "47.6779", "57.811", 4914, 13317);
    await computeGradeDistribution(48, "baseline");
    const offsets = (spy.mock.calls as unknown as [api.CandidateQuery][])
      .map(([query]) => query.offset)
      .filter((offset): offset is number => offset !== undefined)
      .sort((a, b) => a - b);
    // rank 4376 and rank 13126, as 0-based offsets.
    expect(offsets).toEqual([4375, 13125]);
  });

  it("reports the EXACT band counts rather than assuming 25/50/25", async () => {
    // Ties at a threshold legitimately make a band bigger than a nominal quarter.
    wireHappyPath(17501, "47.6779", "57.811", 4914, 13317);
    const d = (await computeGradeDistribution(48, "baseline"))!;
    expect(d.countA).toBe(4914);
    expect(d.countC).toBe(17501 - 13317);
    expect(d.countB).toBe(17501 - 4914 - (17501 - 13317));
    expect(d.countA + d.countB + d.countC).toBe(d.population);
    // Not the naive quarter — the point of counting rather than assuming.
    expect(d.countA).not.toBe(Math.round(17501 / 4));
  });

  it("refuses rather than guesses when the population is too small", async () => {
    spy.mockResolvedValue(coll(3));
    expect(await computeGradeDistribution(48, "baseline")).toBeNull();
  });

  it("refuses when a threshold candidate carries no score", async () => {
    spy.mockImplementation(((query: api.CandidateQuery) =>
      Promise.resolve(
        query.offset === undefined ? coll(1000) : coll(1000, null),
      )) as typeof api.fetchSuitabilityCandidates);
    expect(await computeGradeDistribution(48, "baseline")).toBeNull();
  });

  it("refuses a degenerate distribution where P75 < P25", async () => {
    wireHappyPath(1000, "80", "20", 10, 900);
    expect(await computeGradeDistribution(48, "baseline")).toBeNull();
  });

  it("refuses when the bands do not partition the population", async () => {
    // Simulates the population shifting mid-read (a new run published).
    wireHappyPath(1000, "40", "60", 900, 200);
    expect(await computeGradeDistribution(48, "baseline")).toBeNull();
  });

  it("degrades to null — never to a fabricated threshold — on a request failure", async () => {
    spy.mockRejectedValue(new Error("network"));
    expect(await computeGradeDistribution(48, "baseline")).toBeNull();
  });

  it("memoises a success, so revisiting the same run+profile costs nothing", async () => {
    // A stored run is immutable, so its thresholds are a constant.
    wireHappyPath(17501, "47.6779", "57.811", 4914, 13317);
    const first = await computeGradeDistribution(48, "baseline");
    const callsAfterFirst = spy.mock.calls.length;
    const second = await computeGradeDistribution(48, "baseline");
    expect(second).toEqual(first);
    expect(spy.mock.calls.length, "no second read").toBe(callsAfterFirst);
  });

  it("does NOT memoise a failure, so a dropped request can be retried", async () => {
    // Caching null would disable the bands for the whole session over one blip.
    spy.mockRejectedValue(new Error("network"));
    expect(await computeGradeDistribution(48, "baseline")).toBeNull();
    wireHappyPath(17501, "47.6779", "57.811", 4914, 13317);
    expect(await computeGradeDistribution(48, "baseline")).not.toBeNull();
  });

  it("keys the cache by profile, so a different profile is read afresh", async () => {
    wireHappyPath(17501, "47.6779", "57.811", 4914, 13317);
    await computeGradeDistribution(48, "baseline");
    const after = spy.mock.calls.length;
    await computeGradeDistribution(48, "equal");
    expect(spy.mock.calls.length, "a different distribution").toBeGreaterThan(after);
  });
});

// --------------------------------------------------------------------------- //
// Production regression fixture.
// --------------------------------------------------------------------------- //

describe("the production distribution (run 48 / baseline)", () => {
  it("reproduces the values verified against the live API", async () => {
    // Captured from https://waste-161-33-2-143.sslip.io on 2026-08-10 and recorded
    // in docs/YEOGIDA_AUTONOMOUS_RUN.md. If the algorithm drifts, this fails.
    wireHappyPath(17501, "47.6779", "57.811", 4914, 13317);
    const d = (await computeGradeDistribution(48, "baseline"))!;
    expect(d).toMatchObject({
      runId: 48,
      profile: "baseline",
      population: 17501,
      p25: 47.6779,
      p75: 57.811,
      countA: 4914,
      countB: 8403,
      countC: 4184,
    });
  });
});

describe("scoped bands (① 분석 범위)", () => {
  it("applies the SAME scope to all four reads, so the bands are exact not approximate", async () => {
    wireHappyPath(1099, "44.1", "58.9", 300, 820);
    const d = await computeGradeDistribution(48, "baseline", {
      kind: "sido",
      sido: "KR-SGIS-23",
    });
    expect(d).not.toBeNull();
    // The population probe, both order statistics, and both band counts.
    expect(spy.mock.calls.length).toBe(5);
    for (const [query] of spy.mock.calls as unknown as [api.CandidateQuery][]) {
      // Every read — the population probe, both order statistics, and both band
      // counts — carries the scope. Mixing an unscoped N with scoped percentiles
      // would produce a threshold no candidate actually has.
      expect(query.sido).toBe("KR-SGIS-23");
      expect(query.sigungu).toBeUndefined();
      expect(query.status).toBe("ELIGIBLE");
    }
    // The population is the SCOPED one, so 상위 25% means 상위 25% of 인천.
    expect(d!.population).toBe(1099);
    expect(d!.scope).toEqual({ kind: "sido", sido: "KR-SGIS-23" });
  });

  it("sends a repeatable sigungu list, never a sido alongside it", async () => {
    wireHappyPath(777, "43.2", "55.0", 190, 580);
    const scope = { kind: "sigungu" as const, codes: ["KR-SGIS-31150", "KR-SGIS-23510"] };
    await computeGradeDistribution(48, "baseline", scope);
    for (const [query] of spy.mock.calls as unknown as [api.CandidateQuery][]) {
      expect(query.sigungu).toEqual(["KR-SGIS-31150", "KR-SGIS-23510"]);
      expect(query.sido, "sido + sigungu would intersect two populations").toBeUndefined();
    }
  });

  it("caches per scope, so one scope's bands never serve another's", async () => {
    wireHappyPath(17501, "47.6779", "57.811", 4914, 13317);
    await computeGradeDistribution(48, "baseline");
    const afterFirst = spy.mock.calls.length;
    // Same run+profile, DIFFERENT scope → a genuinely different distribution.
    await computeGradeDistribution(48, "baseline", { kind: "sido", sido: "KR-SGIS-31" });
    expect(spy.mock.calls.length).toBeGreaterThan(afterFirst);
    // Repeating the first scope is served from the memo.
    const afterSecond = spy.mock.calls.length;
    await computeGradeDistribution(48, "baseline");
    expect(spy.mock.calls.length).toBe(afterSecond);
  });

  it("refuses bands for a scope too small to have quartiles, rather than inventing them", async () => {
    // 서울 has ZERO eligible cells in run 47 — a real answer, not a failure.
    spy.mockImplementation((() => Promise.resolve(coll(0))) as typeof api.fetchSuitabilityCandidates);
    const d = await computeGradeDistribution(48, "baseline", {
      kind: "sido",
      sido: "KR-SGIS-11",
    });
    expect(d).toBeNull();
  });

  it("names the scoped population in the basis sentence", () => {
    const basis = relativeGradeBasis(
      {
        runId: 48,
        profile: "baseline",
        scope: { kind: "sido", sido: "KR-SGIS-23" },
        population: 1099,
        p25: 44.1,
        p75: 58.9,
        countA: 300,
        countB: 520,
        countC: 279,
      },
      "인천",
    );
    // A band without its population is unreadable — 상위 25% of WHAT.
    expect(basis).toContain("인천 안의 스크리닝 통과 구역");
    expect(basis).toContain("1,099");
    expect(basis).not.toContain("전체 스크리닝 통과 구역");
  });
});
