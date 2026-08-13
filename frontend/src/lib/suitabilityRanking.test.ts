/**
 * PAGE 4C — the paging contract behind 순위 전체보기.
 *
 * These pin the facts that make a paged ranking honest rather than plausible:
 *
 *   - every request carries `top`, because that is what selects the ELIGIBLE
 *     filter AND the requested profile's ordering (without it the backend orders
 *     by the run's ACTIVE profile — a different ranking);
 *   - the scope is serialized by the ONE serializer, so `sido` and `sigungu` can
 *     never both appear;
 *   - a direction change is a NEW REQUEST, never a client-side reversal;
 *   - the export collects the WHOLE filtered population by paging that same
 *     query, in order, and reports truncation instead of silently shortening.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, fetchSuitabilityCandidates: vi.fn() };
});

import * as api from "./api";
import type { CandidateFeature, SuitabilityCandidateCollection } from "./api";
import {
  RANKING_EXPORT_PAGE_SIZE,
  RANKING_PAGE_SIZE,
  RANKING_TOP_FILTER_SENTINEL,
  fetchEntireRanking,
  fetchRankingPage,
  pageCount,
  pageRange,
  rankingPageQuery,
  type RankingRequest,
} from "./suitabilityRanking";
import { SCOPE_ALL, sigunguScope, type SuitabilityScope } from "./suitabilityScope";

const BASE: RankingRequest = {
  runId: 47,
  profile: "baseline",
  scope: SCOPE_ALL,
  sort: "score_desc",
};

function feature(rank: number): CandidateFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [126.5, 37.7] },
    properties: {
      candidate_id: 1000 + rank,
      candidate_key: `cap500-${String(rank).padStart(6, "0")}`,
      status: "ELIGIBLE",
      profile: "baseline",
      is_excluded: false,
      rank,
      total_score: String(100 - rank),
      provisional_score: null,
      zoning_score: null,
      road_score: null,
      equity_score: null,
      demand_score: null,
      sido_region_code: "KR-SGIS-31",
      sido_region_name: "경기도",
      sigungu_region_code: "KR-SGIS-31150",
      sigungu_region_name: "경기도 시흥시",
      nearest_road_distance_m: null,
      stable_count: null,
      stability_class: null,
      stability_membership: {},
      exclusion_reasons: [],
      review_reasons: [],
    },
  };
}

function collection(
  features: CandidateFeature[],
  totalMatched: number,
): SuitabilityCandidateCollection {
  return {
    type: "FeatureCollection",
    indicator: "SUITABILITY_SCREENING",
    derivation_version: "suitability-screening-v3",
    policy_version: "suitability-policy-v2",
    candidate_grid_version: "capital-grid-500m-v1",
    weight_profile: "baseline",
    reference_year: 2024,
    run_id: 47,
    count: features.length,
    total_matched: totalMatched,
    limit: features.length,
    offset: 0,
    sido: null,
    sigungu: [],
    sort: "score_desc",
    features,
    assumptions: [],
    disclaimer: "Analytical screening only — not a legal determination.",
  };
}

/** A server that holds `total` ranked cells and honours limit/offset. */
function serveRanking(total: number): void {
  vi.mocked(api.fetchSuitabilityCandidates).mockImplementation(async (query) => {
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 500;
    const slice = Array.from(
      { length: Math.max(0, Math.min(limit, total - offset)) },
      (_, i) => feature(offset + i + 1),
    );
    return collection(slice, total);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --------------------------------------------------------------------------- //
// The query contract
// --------------------------------------------------------------------------- //

describe("rankingPageQuery", () => {
  it("always sends `top`, which selects the ELIGIBLE + requested-profile ordering", () => {
    const query = rankingPageQuery(BASE, 50, 0);
    expect(query.top).toBe(RANKING_TOP_FILTER_SENTINEL);
    // `status` is NOT sent: with `top` the server ignores it and applies
    // status = 'ELIGIBLE' itself. Sending it would imply this module chose it.
    expect(query.status).toBeUndefined();
    expect(query.runId).toBe(47);
    expect(query.profile).toBe("baseline");
  });

  it("carries the requested limit and offset, independent of `top`", () => {
    // `effective_limit = min(top, limit)` and offset is applied separately, so a
    // 5000 sentinel never bounds which page can be reached.
    const query = rankingPageQuery(BASE, 50, 17_000);
    expect(query.limit).toBe(50);
    expect(query.offset).toBe(17_000);
  });

  it.each([
    ["score_desc" as const],
    ["score_asc" as const],
  ])("passes %s to the BACKEND rather than reversing rows", (sort) => {
    expect(rankingPageQuery({ ...BASE, sort }, 50, 0).sort).toBe(sort);
  });

  it("sends NO region parameter for 수도권 전체", () => {
    const query = rankingPageQuery(BASE, 50, 0);
    expect(query.sido).toBeUndefined();
    expect(query.sigungu ?? []).toEqual([]);
  });

  it("sends ONLY sido for a 시·도 scope", () => {
    const scope: SuitabilityScope = { kind: "sido", sido: "KR-SGIS-23" };
    const query = rankingPageQuery({ ...BASE, scope }, 50, 0);
    expect(query.sido).toBe("KR-SGIS-23");
    expect(query.sigungu ?? []).toEqual([]);
  });

  it("sends ONLY the repeatable sigungu list for a city scope", () => {
    const scope = sigunguScope(["KR-SGIS-31091", "KR-SGIS-31092"]);
    const query = rankingPageQuery({ ...BASE, scope }, 50, 0);
    expect(query.sigungu).toEqual(["KR-SGIS-31091", "KR-SGIS-31092"]);
    // The illegal pair is unrepresentable — proven at the serializer, not assumed.
    expect(query.sido).toBeUndefined();
  });
});

describe("fetchRankingPage", () => {
  it("translates a 0-based page into the right offset", async () => {
    serveRanking(500);
    await fetchRankingPage(BASE, 3);
    const query = vi.mocked(api.fetchSuitabilityCandidates).mock.calls[0][0];
    expect(query.limit).toBe(RANKING_PAGE_SIZE);
    expect(query.offset).toBe(3 * RANKING_PAGE_SIZE);
  });
});

// --------------------------------------------------------------------------- //
// Paging arithmetic over the AUTHORITATIVE total
// --------------------------------------------------------------------------- //

describe("pageCount / pageRange", () => {
  it("derives the page count from total_matched, not the rows on screen", () => {
    expect(pageCount(1297, 50)).toBe(26);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
  });

  it("has no pages at all for an empty scope", () => {
    expect(pageCount(0, 50)).toBe(0);
    expect(pageRange(0, 0, 50)).toEqual({ first: 0, last: 0 });
  });

  it("clamps the last page's range to the authoritative total", () => {
    expect(pageRange(0, 1297, 50)).toEqual({ first: 1, last: 50 });
    expect(pageRange(25, 1297, 50)).toEqual({ first: 1251, last: 1297 });
  });
});

// --------------------------------------------------------------------------- //
// The export collection — the WHOLE filtered population
// --------------------------------------------------------------------------- //

describe("fetchEntireRanking", () => {
  it("pages the SAME query until the whole scoped population is collected", async () => {
    serveRanking(2_350);
    const result = await fetchEntireRanking(BASE);

    expect(result.totalMatched).toBe(2_350);
    expect(result.features).toHaveLength(2_350);
    expect(result.truncated).toBe(false);

    const calls = vi.mocked(api.fetchSuitabilityCandidates).mock.calls;
    expect(calls).toHaveLength(3);
    // In order, so the same scope+sort always yields the same file.
    expect(calls.map(([q]) => q.offset)).toEqual([0, RANKING_EXPORT_PAGE_SIZE, 2 * RANKING_EXPORT_PAGE_SIZE]);
    // Every page carries the same filter and direction as the dialog's pages.
    for (const [query] of calls) {
      expect(query.top).toBe(RANKING_TOP_FILTER_SENTINEL);
      expect(query.sort).toBe("score_desc");
    }
    // The served order is preserved verbatim — nothing is re-sorted here.
    expect(result.features[0].properties.rank).toBe(1);
    expect(result.features[2_349].properties.rank).toBe(2_350);
  });

  it("preserves the scope on EVERY page, not just the first", async () => {
    serveRanking(2_100);
    const scope = sigunguScope(["KR-SGIS-31150"]);
    await fetchEntireRanking({ ...BASE, scope });
    for (const [query] of vi.mocked(api.fetchSuitabilityCandidates).mock.calls) {
      expect(query.sigungu).toEqual(["KR-SGIS-31150"]);
      expect(query.sido).toBeUndefined();
    }
  });

  it("asks the backend for 낮은 순 rather than reversing the collected rows", async () => {
    serveRanking(10);
    await fetchEntireRanking({ ...BASE, sort: "score_asc" });
    for (const [query] of vi.mocked(api.fetchSuitabilityCandidates).mock.calls) {
      expect(query.sort).toBe("score_asc");
    }
  });

  it("returns an empty, NON-truncated result for a zero-result scope", async () => {
    serveRanking(0);
    const result = await fetchEntireRanking(BASE);
    expect(result.features).toEqual([]);
    expect(result.totalMatched).toBe(0);
    // A real zero is not a truncation — the distinction is what keeps the export
    // state honest.
    expect(result.truncated).toBe(false);
    expect(vi.mocked(api.fetchSuitabilityCandidates)).toHaveBeenCalledTimes(1);
  });

  it("REPORTS truncation instead of silently shortening the file", async () => {
    serveRanking(5_000);
    const result = await fetchEntireRanking(BASE, undefined, 1_000, 2_000);
    expect(result.features).toHaveLength(2_000);
    expect(result.totalMatched).toBe(5_000);
    expect(result.truncated).toBe(true);
  });

  it("does not flag truncation when the cap exactly meets the population", async () => {
    serveRanking(2_000);
    const result = await fetchEntireRanking(BASE, undefined, 1_000, 2_000);
    expect(result.features).toHaveLength(2_000);
    expect(result.truncated).toBe(false);
  });

  it("stops on a short page even if total_matched disagrees", async () => {
    // A population that shrank mid-read must terminate the loop, not spin.
    vi.mocked(api.fetchSuitabilityCandidates).mockImplementation(async (query) => {
      const offset = query.offset ?? 0;
      return offset === 0
        ? collection([feature(1), feature(2)], 9_999)
        : collection([], 9_999);
    });
    const result = await fetchEntireRanking(BASE, undefined, 1_000, 25_000);
    expect(result.features).toHaveLength(2);
    expect(vi.mocked(api.fetchSuitabilityCandidates)).toHaveBeenCalledTimes(1);
  });
});
