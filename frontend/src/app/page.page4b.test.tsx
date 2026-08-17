// @vitest-environment jsdom

/**
 * PAGE 4B — ① 분석 범위 and ③ 순위 방향, wired to the scope/sort API.
 *
 * These are integration contracts over the REAL page: what it SENDS, and what it
 * renders when the answer comes back. They exist because every failure mode here is
 * silent — a plausible ranking computed over a population nobody asked for.
 *
 * The analytical invariants pinned below:
 *
 *   - a request NEVER carries both `sido` and `sigungu` (they come from independent
 *     ST_Covers lookups against non-coincident layers, so combining them intersects
 *     two different populations);
 *   - region codes are SGIS (`KR-SGIS-11/23/31`), never the landfill/MOIS `11/28/41`;
 *   - one citizen-facing city expands into EVERY stored code it is split into;
 *   - `total_matched` is the backend's count, never the page length;
 *   - a scoped result of ZERO is rendered honestly and is NEVER back-filled with the
 *     unscoped list;
 *   - 낮은 순 is served by the backend, not by reversing the rows on screen;
 *   - the scope filters WHICH CELLS are ranked — it never aggregates a 시·군·구.
 *
 * Every fixture is SYNTHETIC and carries no official evidence label.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub() {
      return <div data-testid="map-container" />;
    },
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const { homeApiMock } = await import("./homeApiMock");
  return { ...homeApiMock(actual), fetchSuitabilityCandidateDetail: vi.fn() };
});

const computeGradeDistribution = vi.fn();
vi.mock("../lib/relativeGrade", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/relativeGrade")>();
  return {
    ...actual,
    computeGradeDistribution: (...args: unknown[]) => computeGradeDistribution(...args),
  };
});

import Home from "./page";
import * as api from "../lib/api";
import { rankingCollection } from "./homeApiMock";

/**
 * The served SIGUNGU registry, verbatim SGIS codes and names. 안산시 is stored as
 * its two 일반구 — the multi-code case the whole expansion rule exists for.
 */
const BOUNDARY_FEATURES = [
  ["KR-SGIS-11010", "서울특별시 종로구", "KR-SGIS-11"],
  ["KR-SGIS-11020", "서울특별시 중구", "KR-SGIS-11"],
  ["KR-SGIS-23010", "인천광역시 중구", "KR-SGIS-23"],
  ["KR-SGIS-23510", "인천광역시 강화군", "KR-SGIS-23"],
  ["KR-SGIS-31091", "경기도 안산시 상록구", "KR-SGIS-31"],
  ["KR-SGIS-31092", "경기도 안산시 단원구", "KR-SGIS-31"],
  ["KR-SGIS-31150", "경기도 시흥시", "KR-SGIS-31"],
].map(([region_code, region_name, parent_region_code]) => ({
  type: "Feature" as const,
  geometry: { type: "Polygon" as const, coordinates: [] },
  properties: {
    region_code,
    region_name,
    region_level: "SIGUNGU",
    parent_region_code,
    source_id: "sgis",
    boundary_reference_period: "2024",
  },
}));

const ROWS = [
  {
    candidate_id: 701,
    rank: 1,
    sigungu: "인천광역시 강화군",
    total_score: "69.2500",
    stability_class: "STABLE",
    stable_count: 3,
  },
  {
    candidate_id: 702,
    rank: 2,
    sigungu: "인천광역시 강화군",
    total_score: "68.1000",
    stability_class: "WEIGHT_SENSITIVE",
    stable_count: 1,
  },
];

const DETAIL = {
  candidate_id: 701,
  candidate_key: "cap500-000701",
  status: "ELIGIBLE",
  profile: "baseline",
  is_excluded: false,
  rank: 1,
  total_score: "69.2500",
  provisional_score: null,
  zoning_score: "55.0000",
  road_score: "100.0000",
  equity_score: "100.0000",
  demand_score: "50.0000",
  sido_region_code: "KR-SGIS-23",
  sido_region_name: "인천광역시",
  sigungu_region_code: "KR-SGIS-23510",
  sigungu_region_name: "인천광역시 강화군",
  nearest_road_distance_m: "120.0",
  stable_count: 3,
  stability_class: "STABLE",
  stability_membership: { baseline: true, equal: true, critic: true },
  exclusion_reasons: [],
  review_reasons: [],
  run_id: 47,
  profile_totals: { baseline: "69.2500" },
  profile_ranks: { baseline: 1 },
  penalties: [],
  raw_components: {},
  nearest_road_provenance: {},
  component_provenance: {},
  original_area_m2: "250000",
  clipped_area_m2: "250000",
  clipped_area_ratio: "1.0",
  geometry: { type: "Polygon", coordinates: [] },
  reference_year: 2024,
  policy_version: "suitability-policy-v2",
  derivation_version: "suitability-screening-v3",
  candidate_grid_version: "capital-grid-500m-v1",
  weights: { zoning: "0.35", road: "0.25", equity: "0.20", demand: "0.20" },
  disclaimer: "Analytical screening only — not a legal determination.",
} as unknown as api.CandidateDetail;

/** The queries the page has sent to `/suitability/candidates` so far. */
function rankingQueries(): api.CandidateQuery[] {
  return vi
    .mocked(api.fetchSuitabilityCandidates)
    .mock.calls.map(([query]) => query)
    .filter((query) => query.limit !== 1 && query.minScore === undefined);
}

function lastRankingQuery(): api.CandidateQuery {
  const queries = rankingQueries();
  return queries[queries.length - 1];
}

beforeEach(async () => {
  vi.clearAllMocks();
  computeGradeDistribution.mockResolvedValue(null);
  vi.mocked(api.fetchBoundaries).mockResolvedValue({
    type: "FeatureCollection",
    reference_year: 2024,
    count: BOUNDARY_FEATURES.length,
    features: BOUNDARY_FEATURES,
  } as unknown as api.RegionBoundaryCollection);
  vi.mocked(api.fetchSuitabilityCandidateDetail).mockResolvedValue(DETAIL);
  serveRanking(ROWS, 1297);
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

function serveRanking(rows: typeof ROWS, totalMatched = rows.length): void {
  vi.mocked(api.fetchSuitabilityCandidates).mockResolvedValue(
    rankingCollection(rows, totalMatched) as unknown as api.SuitabilityCandidateCollection,
  );
}

async function enterDeepAnalysis() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  fireEvent.click(screen.getByTestId("mode-suitability"));
  await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
  await waitFor(() => expect(screen.getByTestId("candidate-ranking-counts")).toBeDefined());
  return utils;
}

const scopeCard = () => screen.getByTestId("suitability-scope");

/** Pick a city through the search box, the way a reader does. */
async function pickCity(term: string, label: string) {
  fireEvent.change(within(scopeCard()).getByTestId("suitability-scope-search"), {
    target: { value: term },
  });
  const match = within(scopeCard())
    .getAllByTestId("suitability-scope-match")
    .find((node) => node.textContent?.includes(label))!;
  fireEvent.click(match);
  await waitFor(() => expect(lastRankingQuery().sigungu).toBeDefined());
}

// --------------------------------------------------------------------------- //
// ① Scope — the four top-level scopes
// --------------------------------------------------------------------------- //

describe("① 분석 범위 — the four scopes", () => {
  it("sends NO region parameter for 수도권 전체", async () => {
    await enterDeepAnalysis();
    const query = lastRankingQuery();
    expect(query.sido).toBeUndefined();
    expect(query.sigungu ?? []).toEqual([]);
  });

  it.each([
    ["11", "KR-SGIS-11", "서울"],
    ["23", "KR-SGIS-23", "인천"],
    ["31", "KR-SGIS-31", "경기"],
  ])("sends ONLY sido=%s for the %s pill", async (pill, code) => {
    await enterDeepAnalysis();
    fireEvent.click(within(scopeCard()).getByTestId(`suitability-scope-pill-${pill}`));
    await waitFor(() => expect(lastRankingQuery().sido).toBe(code));
    // The canonical spelling, and never a sigungu list beside it.
    expect(lastRankingQuery().sigungu ?? []).toEqual([]);
  });

  it("returns to 수도권 전체 with no region parameter", async () => {
    await enterDeepAnalysis();
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-11"));
    await waitFor(() => expect(lastRankingQuery().sido).toBe("KR-SGIS-11"));
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-all"));
    await waitFor(() => expect(lastRankingQuery().sido).toBeUndefined());
  });
});

// --------------------------------------------------------------------------- //
// The exclusivity rule
// --------------------------------------------------------------------------- //

describe("sido and sigungu are never combined", () => {
  it("clears the 시·군·구 selection when a 시·도 pill is chosen", async () => {
    await enterDeepAnalysis();
    await pickCity("안산", "경기 안산시");
    expect(lastRankingQuery().sigungu).toEqual(["KR-SGIS-31091", "KR-SGIS-31092"]);

    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-31"));
    await waitFor(() => expect(lastRankingQuery().sido).toBe("KR-SGIS-31"));
    expect(lastRankingQuery().sigungu ?? []).toEqual([]);
    // And the chips follow: no stale 안산시 chip beside a 경기 scope.
    expect(within(scopeCard()).getAllByTestId("suitability-scope-chip")).toHaveLength(1);
  });

  it("clears the 시·도 scope when a city is chosen", async () => {
    await enterDeepAnalysis();
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-31"));
    await waitFor(() => expect(lastRankingQuery().sido).toBe("KR-SGIS-31"));

    await pickCity("시흥", "경기 시흥시");
    expect(lastRankingQuery().sido).toBeUndefined();
    expect(lastRankingQuery().sigungu).toEqual(["KR-SGIS-31150"]);
  });

  it("NEVER sends both, across a whole session of scope changes", async () => {
    await enterDeepAnalysis();
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-11"));
    await waitFor(() => expect(lastRankingQuery().sido).toBe("KR-SGIS-11"));
    await pickCity("안산", "경기 안산시");
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-23"));
    await waitFor(() => expect(lastRankingQuery().sido).toBe("KR-SGIS-23"));
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-reset"));
    await waitFor(() => expect(lastRankingQuery().sido).toBeUndefined());

    for (const query of vi.mocked(api.fetchSuitabilityCandidates).mock.calls.map(([q]) => q)) {
      const both = query.sido !== undefined && (query.sigungu?.length ?? 0) > 0;
      expect(both, "a sido+sigungu request intersects two populations").toBe(false);
    }
  });

  it("never sends a landfill/MOIS region code to the suitability API", async () => {
    await enterDeepAnalysis();
    for (const pill of ["11", "23", "31"]) {
      fireEvent.click(within(scopeCard()).getByTestId(`suitability-scope-pill-${pill}`));
      await waitFor(() => expect(lastRankingQuery().sido).toContain("KR-SGIS-"));
    }
    const codes = vi
      .mocked(api.fetchSuitabilityCandidates)
      .mock.calls.flatMap(([q]) => [q.sido, ...(q.sigungu ?? [])])
      .filter((code): code is string => code !== undefined);
    for (const code of codes) {
      expect(code.startsWith("KR-SGIS-"), `${code} is not a canonical SGIS code`).toBe(true);
      // 28 / 41 are Incheon / Gyeonggi in the MOIS space and nothing here.
      expect(code).not.toBe("KR-SGIS-28");
      expect(code).not.toBe("KR-SGIS-41");
    }
  });
});

// --------------------------------------------------------------------------- //
// Multi-code cities
// --------------------------------------------------------------------------- //

describe("a citizen-facing city expands into every stored code", () => {
  it("sends BOTH 안산시 일반구 as repeated sigungu values", async () => {
    await enterDeepAnalysis();
    await pickCity("안산", "경기 안산시");
    // Repeatable OR semantics — not a comma-joined single value, which the backend
    // would read as one unknown code and answer with an empty result.
    expect(lastRankingQuery().sigungu).toEqual(["KR-SGIS-31091", "KR-SGIS-31092"]);
  });

  it("names the constituent 구 on the chip, so nothing is silently narrowed", async () => {
    await enterDeepAnalysis();
    await pickCity("안산", "경기 안산시");
    const chip = within(scopeCard()).getAllByTestId("suitability-scope-chip")[0];
    expect(chip.textContent).toContain("경기 안산시");
    expect(chip.textContent).toContain("단원구");
    expect(chip.textContent).toContain("상록구");
  });

  it("accumulates a multi-city selection", async () => {
    await enterDeepAnalysis();
    await pickCity("안산", "경기 안산시");
    await pickCity("시흥", "경기 시흥시");
    expect(lastRankingQuery().sigungu).toEqual([
      "KR-SGIS-31091",
      "KR-SGIS-31092",
      "KR-SGIS-31150",
    ]);
  });

  it("removes every code of a city when its chip is dismissed", async () => {
    await enterDeepAnalysis();
    await pickCity("안산", "경기 안산시");
    await pickCity("시흥", "경기 시흥시");
    const chips = within(scopeCard()).getAllByTestId("suitability-scope-chip");
    fireEvent.click(chips.find((c) => c.textContent?.includes("안산"))!);
    await waitFor(() => expect(lastRankingQuery().sigungu).toEqual(["KR-SGIS-31150"]));
  });
});

// --------------------------------------------------------------------------- //
// ③ Sort
// --------------------------------------------------------------------------- //

describe("③ 순위 방향", () => {
  it("defaults to 높은 순 and sends sort=score_desc", async () => {
    await enterDeepAnalysis();
    expect(lastRankingQuery().sort).toBe("score_desc");
    expect(
      screen.getByTestId("candidate-sort-score_desc").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("asks the BACKEND for 낮은 순 instead of reversing the loaded rows", async () => {
    await enterDeepAnalysis();
    const before = rankingQueries().length;
    fireEvent.click(screen.getByTestId("candidate-sort-score_asc"));
    await waitFor(() => expect(lastRankingQuery().sort).toBe("score_asc"));
    // A new request — the ten lowest of the WHOLE scoped population, not the ten
    // highest turned upside down.
    expect(rankingQueries().length).toBeGreaterThan(before);
  });

  it("keeps the scope when only the direction changes", async () => {
    await enterDeepAnalysis();
    await pickCity("안산", "경기 안산시");
    fireEvent.click(screen.getByTestId("candidate-sort-score_asc"));
    await waitFor(() => expect(lastRankingQuery().sort).toBe("score_asc"));
    expect(lastRankingQuery().sigungu).toEqual(["KR-SGIS-31091", "KR-SGIS-31092"]);
  });

  it("relabels the list so a 낮은 순 list is not called 점수가 높은 후보 구역", async () => {
    await enterDeepAnalysis();
    fireEvent.click(screen.getByTestId("candidate-sort-score_asc"));
    await waitFor(() =>
      expect(screen.getByTestId("top-candidates").textContent).toContain("점수가 낮은 후보 구역"),
    );
  });
});

// --------------------------------------------------------------------------- //
// Counts and the zero state
// --------------------------------------------------------------------------- //

describe("authoritative counts", () => {
  it("shows the page length and the backend's total_matched, not the page length twice", async () => {
    await enterDeepAnalysis();
    const counts = screen.getByTestId("candidate-ranking-counts").textContent ?? "";
    // Two rows served, 1,297 matching the filter.
    expect(counts).toContain("표시 2개");
    expect(counts).toContain("1,297");
    expect(within(screen.getByTestId("top-candidates")).getAllByTestId("top-candidate-item"))
      .toHaveLength(2);
  });

  it("renders a real zero honestly and does NOT fall back to the unscoped list", async () => {
    await enterDeepAnalysis();
    // 안산 + ELIGIBLE genuinely matches nothing in run 47: every Ansan cell is
    // REVIEW_REQUIRED or EXCLUDED under the documented v1 zoning assumption.
    serveRanking([], 0);
    await pickCity("안산", "경기 안산시");
    await waitFor(() =>
      expect(screen.getByTestId("top-candidates-empty")).toBeDefined(),
    );
    expect(screen.getByTestId("candidate-ranking-counts").textContent).toContain("범위 내 0");
    expect(screen.getByTestId("top-candidates-empty").textContent).toContain("0개");
    // No rows, and nothing borrowed from the capital-region answer.
    expect(
      within(screen.getByTestId("top-candidates")).queryAllByTestId("top-candidate-item"),
    ).toHaveLength(0);
    // A real zero is NOT an error.
    expect(screen.queryByTestId("candidate-ranking-error")).toBeNull();
  });

  it("says the A/B/C bands are absent because the RANGE is empty, not because a read failed", async () => {
    await enterDeepAnalysis();
    serveRanking([], 0);
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-11"));
    await waitFor(() => expect(screen.getByTestId("relative-grade-empty-scope")).toBeDefined());
    const copy = screen.getByTestId("relative-grade-empty-scope").textContent ?? "";
    expect(copy).toContain("서울");
    // The pre-scope wording reported a failed read; under a scope that would report
    // a real analytical answer as a malfunction.
    expect(copy).toContain("자료를 불러오지 못한 것이 아니라");
    expect(copy).not.toContain("불러오지 못해 상대 점수 구간");
  });

  it("keeps a genuine failure distinguishable from a real zero", async () => {
    await enterDeepAnalysis();
    vi.mocked(api.fetchSuitabilityCandidates).mockRejectedValue(
      new api.ApiError(500, null, "Backend request failed with status 500"),
    );
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-11"));
    await waitFor(() => expect(screen.getByTestId("candidate-ranking-error")).toBeDefined());
    // The honest-zero copy must NOT appear for a failed request.
    expect(screen.queryByTestId("top-candidates-empty")).toBeNull();
  });
});

// --------------------------------------------------------------------------- //
// Cross-surface consistency
// --------------------------------------------------------------------------- //

describe("the scope reaches every surface that reports on it", () => {
  it("recomputes the A/B/C bands for the scoped population", async () => {
    await enterDeepAnalysis();
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-23"));
    await waitFor(() =>
      expect(
        computeGradeDistribution.mock.calls.some(
          ([, , scope]) => scope?.kind === "sido" && scope.sido === "KR-SGIS-23",
        ),
      ).toBe(true),
    );
  });

  it("drops a selected candidate the new scope excludes", async () => {
    await enterDeepAnalysis();
    fireEvent.click(
      within(screen.getByTestId("top-candidates")).getAllByTestId("top-candidate-item")[0],
    );
    await waitFor(() => expect(screen.getByTestId("candidate-detail")).toBeDefined());
    // The selected cell is in 인천 강화군; scoping to 서울 removes it from the
    // ranking, so it must not remain presented as though it were still in it.
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-11"));
    await waitFor(() => expect(screen.queryByTestId("candidate-detail")).toBeNull());
  });

  it("KEEPS a selected candidate the new scope still contains", async () => {
    await enterDeepAnalysis();
    fireEvent.click(
      within(screen.getByTestId("top-candidates")).getAllByTestId("top-candidate-item")[0],
    );
    await waitFor(() => expect(screen.getByTestId("candidate-detail")).toBeDefined());
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-23"));
    await waitFor(() => expect(lastRankingQuery().sido).toBe("KR-SGIS-23"));
    expect(screen.getByTestId("candidate-detail")).toBeDefined();
  });

  it("says plainly when the map cannot follow a 시·도 scope", async () => {
    await enterDeepAnalysis();
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-23"));
    await waitFor(() => expect(screen.getByTestId("candidate-map-scope-note")).toBeDefined());
    // The tile carries no sido_region_code, so the map keeps the whole grid — and
    // the disagreement is stated rather than left for a reader to notice.
    expect(screen.getByTestId("candidate-map-scope-note").textContent).toContain(
      "수도권 전체 후보 구역이 그대로",
    );
  });

  it("says the map DOES follow a 시·군·구 scope", async () => {
    await enterDeepAnalysis();
    await pickCity("시흥", "경기 시흥시");
    expect(screen.getByTestId("candidate-map-scope-note").textContent).toContain(
      "지도에도",
    );
  });
});

// --------------------------------------------------------------------------- //
// URL state
// --------------------------------------------------------------------------- //

describe("shareable scope", () => {
  it("restores a 시·도 scope from a direct link", async () => {
    window.history.replaceState(null, "", "/?v=1&mode=suitability&suitScope=KR-SGIS-23");
    await enterDeepAnalysis();
    expect(lastRankingQuery().sido).toBe("KR-SGIS-23");
    expect(lastRankingQuery().sigungu ?? []).toEqual([]);
    expect(
      within(scopeCard()).getByTestId("suitability-scope-pill-23").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("restores a multi-code city selection and its chip", async () => {
    window.history.replaceState(
      null,
      "",
      "/?v=1&mode=suitability&suitScope=KR-SGIS-31091,KR-SGIS-31092",
    );
    await enterDeepAnalysis();
    expect(lastRankingQuery().sigungu).toEqual(["KR-SGIS-31091", "KR-SGIS-31092"]);
    expect(lastRankingQuery().sido).toBeUndefined();
    expect(
      within(scopeCard())
        .getAllByTestId("suitability-scope-chip")
        .some((chip) => chip.textContent?.includes("경기 안산시")),
    ).toBe(true);
  });

  it("restores 낮은 순", async () => {
    window.history.replaceState(null, "", "/?v=1&mode=suitability&suitSort=score_asc");
    await enterDeepAnalysis();
    expect(lastRankingQuery().sort).toBe("score_asc");
  });

  it("writes the scope back into the URL so the link is shareable", async () => {
    await enterDeepAnalysis();
    await pickCity("시흥", "경기 시흥시");
    await waitFor(() =>
      expect(window.location.search).toContain("suitScope=KR-SGIS-31150"),
    );
  });
});

// --------------------------------------------------------------------------- //
// What the scope must NOT become
// --------------------------------------------------------------------------- //

describe("the ranked object stays a 500m candidate cell", () => {
  it("keeps the per-cell disambiguation under a scope", async () => {
    await enterDeepAnalysis();
    await pickCity("시흥", "경기 시흥시");
    serveRanking(ROWS, 777);
    const list = screen.getByTestId("top-candidates");
    expect(within(list).getByTestId("candidate-list-row-meaning").textContent).toContain(
      "시·군·구 자체가 아니라",
    );
    expect(within(list).getAllByTestId("top-candidate-item")[0].textContent).toContain(
      "500m 후보 구역",
    );
  });

  it("shows the RUN-WIDE rank, not a rank re-numbered inside the scope", async () => {
    await enterDeepAnalysis();
    serveRanking(
      [{ ...ROWS[0], rank: 406 }, { ...ROWS[1], rank: 407 }],
      16402,
    );
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-31"));
    await waitFor(() => expect(lastRankingQuery().sido).toBe("KR-SGIS-31"));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("top-candidates")).getAllByTestId("top-candidate-item")[0]
          .textContent,
      ).toContain("406위"),
    );
    // Re-ranking 1..N inside the scope would be a client-side re-derivation of the
    // stored screening rank — a new methodology, not a filter.
    expect(within(screen.getByTestId("top-candidates")).getByTestId("candidate-list-row-meaning")
      .textContent).toContain("분석 실행 전체에서의 순위");
  });

  it("never asks the API to aggregate a 시·군·구", async () => {
    await enterDeepAnalysis();
    await pickCity("안산", "경기 안산시");
    for (const query of vi.mocked(api.fetchSuitabilityCandidates).mock.calls.map(([q]) => q)) {
      // The ranking is a page of CELLS. There is no group-by, no aggregate, and the
      // bounded limit proves it is a readable list, never a rolled-up entity list.
      expect(query.limit).toBeLessThanOrEqual(10);
      expect(Object.keys(query)).not.toContain("groupBy");
    }
    expect(scopeCard().textContent).toContain("시·군·구 자체를 점수로 매기거나 하나로 합치지 않습니다");
  });
});
