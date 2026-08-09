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
