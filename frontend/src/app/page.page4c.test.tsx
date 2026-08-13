// @vitest-environment jsdom

/**
 * PAGE 4C — 순위 전체보기 and 순위 CSV 내보내기.
 *
 * Integration contracts over the REAL page. The dialog's whole risk is that it
 * looks right while describing a different population from the card that opened
 * it, so what is pinned here is inheritance and honesty rather than markup:
 *
 *   - the modal opens on the ACTIVE run / profile / scope / direction, and a
 *     scope changed outside it is reflected when it is reopened;
 *   - paging is the BACKEND's (limit + offset over `total_matched`), never a
 *     client-side slice, and the total shown is the backend's count;
 *   - 낮은 순 inside the modal is a new request, not the loaded page reversed;
 *   - every row stays a 500 m candidate cell, with its own key;
 *   - A/B/C is the scoped relative band, and no 60/62-point pass threshold
 *     appears anywhere on screen;
 *   - the CSV covers the whole ACTIVE filtered population, in the active order,
 *     and names the scope it came from;
 *   - a zero-result scope produces an honest empty state and no export.
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

/** Capture the export instead of touching the DOM's download machinery. */
const downloadCsv = vi.fn();
vi.mock("../lib/csv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/csv")>();
  return { ...actual, downloadCsv: (...args: unknown[]) => downloadCsv(...args) };
});

import Home from "./page";
import * as api from "../lib/api";
import { toCsv, type CsvValue } from "../lib/csv";
import { RANKING_PAGE_SIZE, RANKING_TOP_FILTER_SENTINEL } from "../lib/suitabilityRanking";

const BOUNDARY_FEATURES = [
  ["KR-SGIS-11010", "서울특별시 종로구", "KR-SGIS-11"],
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

/**
 * The synthetic ranked population the fake backend holds. Ranks are DENSE and the
 * score falls with the rank, so a `sort=score_asc` answer is visibly a different
 * set of rows rather than the same page reversed.
 */
const POPULATION = 130;

function candidateFeature(rank: number) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [126.5, 37.7] },
    properties: {
      candidate_id: 7000 + rank,
      candidate_key: `cap500-${String(rank).padStart(6, "0")}`,
      status: "ELIGIBLE",
      profile: "baseline",
      is_excluded: false,
      rank,
      total_score: (100 - rank * 0.1).toFixed(4),
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
      stable_count: 3,
      stability_class: "STABLE",
      stability_membership: {},
      exclusion_reasons: [],
      review_reasons: [],
    },
  };
}

/** How many cells the fake backend reports for the CURRENT scope. */
let servedTotal = POPULATION;

/**
 * A fake `/suitability/candidates` that honours `limit`, `offset` and `sort` the
 * way the real route does, so paging and direction are genuinely exercised rather
 * than stubbed to a fixed page.
 */
function installBackend(): void {
  vi.mocked(api.fetchSuitabilityCandidates).mockImplementation(async (query) => {
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 500;
    const ranks = Array.from({ length: servedTotal }, (_, i) => i + 1);
    // score_asc is served by the BACKEND as the other end of the same ordering.
    const ordered = query.sort === "score_asc" ? ranks.slice().reverse() : ranks;
    const slice = ordered.slice(offset, offset + limit);
    return {
      type: "FeatureCollection",
      indicator: "SUITABILITY_SCREENING",
      derivation_version: "suitability-screening-v3",
      policy_version: "suitability-policy-v2",
      candidate_grid_version: "capital-grid-500m-v1",
      weight_profile: query.profile,
      reference_year: 2024,
      run_id: 47,
      count: slice.length,
      total_matched: servedTotal,
      limit,
      offset,
      sido: query.sido ?? null,
      sigungu: query.sigungu ?? [],
      sort: query.sort ?? "score_desc",
      features: slice.map(candidateFeature),
      assumptions: [],
      disclaimer: "Analytical screening only — not a legal determination.",
    } as unknown as api.SuitabilityCandidateCollection;
  });
}

/** Only the queries the DIALOG issued — it is the one caller sending `top=5000`. */
function dialogQueries(): api.CandidateQuery[] {
  return vi
    .mocked(api.fetchSuitabilityCandidates)
    .mock.calls.map(([query]) => query)
    .filter((query) => query.top === RANKING_TOP_FILTER_SENTINEL);
}

function lastDialogQuery(): api.CandidateQuery {
  const queries = dialogQueries();
  return queries[queries.length - 1];
}

/** The rows handed to the CSV writer by the most recent export. */
function exportedRows(): CsvValue[][] {
  const calls = downloadCsv.mock.calls;
  return calls[calls.length - 1][1] as CsvValue[][];
}

function exportedFilename(): string {
  const calls = downloadCsv.mock.calls;
  return calls[calls.length - 1][0] as string;
}

/** Just the data rows — the preamble rows never start with a numeric rank. */
function exportedDataRows(): CsvValue[][] {
  return exportedRows().filter((row) => typeof row[0] === "number");
}

beforeEach(async () => {
  vi.clearAllMocks();
  servedTotal = POPULATION;
  computeGradeDistribution.mockResolvedValue({
    runId: 47,
    profile: "baseline",
    scope: { kind: "all" },
    population: POPULATION,
    p25: 88,
    p75: 95,
    countA: 30,
    countB: 70,
    countC: 30,
  });
  vi.mocked(api.fetchBoundaries).mockResolvedValue({
    type: "FeatureCollection",
    reference_year: 2024,
    count: BOUNDARY_FEATURES.length,
    features: BOUNDARY_FEATURES,
  } as unknown as api.RegionBoundaryCollection);
  vi.mocked(api.fetchSuitabilityCandidateDetail).mockResolvedValue({
    ...candidateFeature(1).properties,
    run_id: 47,
    profile_totals: { baseline: "99.9000" },
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
  } as unknown as api.CandidateDetail);
  installBackend();
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

async function enterDeepAnalysis() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  fireEvent.click(screen.getByTestId("mode-suitability"));
  await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
  await waitFor(() => expect(screen.getByTestId("candidate-ranking-counts")).toBeDefined());
  return utils;
}

const trigger = () => screen.getByTestId("open-full-ranking");
const dialog = () => screen.getByTestId("suitability-ranking-dialog");
const scopeCard = () => screen.getByTestId("suitability-scope");

async function openDialog() {
  fireEvent.click(trigger());
  await waitFor(() => expect(screen.getByTestId("ranking-dialog-table")).toBeDefined());
}

/** Pick a city through the search box, the way a reader does. */
async function pickCity(term: string, label: string) {
  fireEvent.change(within(scopeCard()).getByTestId("suitability-scope-search"), {
    target: { value: term },
  });
  const match = within(scopeCard())
    .getAllByTestId("suitability-scope-match")
    .find((node) => node.textContent?.includes(label))!;
  fireEvent.click(match);
}

// --------------------------------------------------------------------------- //
// 1. Opening, closing, focus
// --------------------------------------------------------------------------- //

describe("the dialog opens and closes", () => {
  it("renders nothing until 전체보기 is pressed", async () => {
    await enterDeepAnalysis();
    expect(screen.queryByTestId("suitability-ranking-dialog")).toBeNull();
    // …and costs nothing: no dialog-shaped request has been made.
    expect(dialogQueries()).toHaveLength(0);
  });

  it("opens as a modal dialog with an accessible name", async () => {
    await enterDeepAnalysis();
    await openDialog();
    const panel = dialog();
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    const labelledBy = panel.getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelledBy)?.textContent).toContain("순위 전체보기");
  });

  it("closes on Escape and restores focus to the 전체보기 trigger", async () => {
    await enterDeepAnalysis();
    trigger().focus();
    await openDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("suitability-ranking-dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger());
  });

  it("closes from the header close control", async () => {
    await enterDeepAnalysis();
    await openDialog();
    fireEvent.click(screen.getByTestId("suitability-ranking-dialog-close"));
    await waitFor(() => expect(screen.queryByTestId("suitability-ranking-dialog")).toBeNull());
  });

  it("closes from the footer 닫기 action", async () => {
    await enterDeepAnalysis();
    await openDialog();
    fireEvent.click(screen.getByTestId("ranking-dialog-close-action"));
    await waitFor(() => expect(screen.queryByTestId("suitability-ranking-dialog")).toBeNull());
  });

  it("renders a real table with a caption and column headers", async () => {
    await enterDeepAnalysis();
    await openDialog();
    const table = screen.getByTestId("ranking-dialog-table");
    expect(table.tagName).toBe("TABLE");
    expect(table.querySelector("caption")).not.toBeNull();
    for (const header of table.querySelectorAll("th")) {
      expect(header.getAttribute("scope")).toBe("col");
    }
  });
});

// --------------------------------------------------------------------------- //
// 2. Scope inheritance
// --------------------------------------------------------------------------- //

describe("the dialog inherits the ACTIVE scope", () => {
  it("sends no region parameter for 수도권 전체", async () => {
    await enterDeepAnalysis();
    await openDialog();
    const query = lastDialogQuery();
    expect(query.sido).toBeUndefined();
    expect(query.sigungu ?? []).toEqual([]);
  });

  it.each([
    ["11", "KR-SGIS-11"],
    ["23", "KR-SGIS-23"],
    ["31", "KR-SGIS-31"],
  ])("inherits the %s 시·도 scope", async (pill, code) => {
    await enterDeepAnalysis();
    fireEvent.click(within(scopeCard()).getByTestId(`suitability-scope-pill-${pill}`));
    await openDialog();
    expect(lastDialogQuery().sido).toBe(code);
    // …and never beside a sigungu list.
    expect(lastDialogQuery().sigungu ?? []).toEqual([]);
  });

  it("inherits a multi-code city selection, expanded to every stored code", async () => {
    await enterDeepAnalysis();
    await pickCity("안산", "경기 안산시");
    await openDialog();
    expect(lastDialogQuery().sigungu).toEqual(["KR-SGIS-31091", "KR-SGIS-31092"]);
    expect(lastDialogQuery().sido).toBeUndefined();
  });

  it("reflects a scope changed OUTSIDE the dialog when it is reopened", async () => {
    await enterDeepAnalysis();
    await openDialog();
    expect(lastDialogQuery().sido).toBeUndefined();

    fireEvent.click(screen.getByTestId("ranking-dialog-close-action"));
    await waitFor(() => expect(screen.queryByTestId("suitability-ranking-dialog")).toBeNull());

    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-23"));
    await openDialog();
    expect(lastDialogQuery().sido).toBe("KR-SGIS-23");
  });

  it("names the active scope in the heading area and the count line", async () => {
    await enterDeepAnalysis();
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-23"));
    await openDialog();
    expect(screen.getByTestId("ranking-dialog-counts").textContent).toContain("인천");
  });
});

// --------------------------------------------------------------------------- //
// 3. Sort inheritance
// --------------------------------------------------------------------------- //

describe("the dialog inherits and drives the ACTIVE sort", () => {
  it("opens with the direction the card is showing", async () => {
    await enterDeepAnalysis();
    fireEvent.click(screen.getByTestId("candidate-sort-score_asc"));
    await waitFor(() => expect(screen.getByTestId("candidate-sort-score_asc")).toBeDefined());
    await openDialog();
    expect(lastDialogQuery().sort).toBe("score_asc");
  });

  it("re-requests from the BACKEND when the direction changes inside it", async () => {
    await enterDeepAnalysis();
    await openDialog();
    expect(lastDialogQuery().sort).toBe("score_desc");
    const before = screen.getAllByTestId("ranking-dialog-row")[0].textContent;

    fireEvent.click(screen.getByTestId("ranking-dialog-sort-score_asc"));
    await waitFor(() => expect(lastDialogQuery().sort).toBe("score_asc"));

    // A NEW request, and genuinely different rows — not the same page reversed.
    await waitFor(() => {
      expect(screen.getAllByTestId("ranking-dialog-row")[0].textContent).not.toBe(before);
    });
    expect(screen.getAllByTestId("ranking-dialog-row")[0].textContent).toContain(
      `${POPULATION}위`,
    );
  });

  it("keeps the card behind in step with the direction chosen inside", async () => {
    await enterDeepAnalysis();
    await openDialog();
    fireEvent.click(screen.getByTestId("ranking-dialog-sort-score_asc"));
    await waitFor(() =>
      expect(screen.getByTestId("candidate-sort-score_asc").getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
  });
});

// --------------------------------------------------------------------------- //
// 4. Paging — the backend's, over the authoritative total
// --------------------------------------------------------------------------- //

describe("paging uses the backend", () => {
  it("requests the first page with a real limit and offset 0", async () => {
    await enterDeepAnalysis();
    await openDialog();
    const query = lastDialogQuery();
    expect(query.limit).toBe(RANKING_PAGE_SIZE);
    expect(query.offset).toBe(0);
    // It never asks for the whole ~17.5k population just to render a page.
    expect(query.limit).toBeLessThan(POPULATION);
  });

  it("shows the AUTHORITATIVE total, not the page length", async () => {
    await enterDeepAnalysis();
    await openDialog();
    expect(screen.getAllByTestId("ranking-dialog-row")).toHaveLength(RANKING_PAGE_SIZE);
    expect(screen.getByTestId("ranking-dialog-counts").textContent).toContain(String(POPULATION));
  });

  it("moves to the next page by OFFSET, keeping scope and sort", async () => {
    await enterDeepAnalysis();
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-31"));
    await openDialog();

    fireEvent.click(screen.getByTestId("ranking-dialog-next"));
    await waitFor(() => expect(lastDialogQuery().offset).toBe(RANKING_PAGE_SIZE));
    const query = lastDialogQuery();
    expect(query.sido).toBe("KR-SGIS-31");
    expect(query.sort).toBe("score_desc");
    await waitFor(() =>
      expect(screen.getAllByTestId("ranking-dialog-row")[0].textContent).toContain(
        `${RANKING_PAGE_SIZE + 1}위`,
      ),
    );
  });

  it("goes back to the previous page", async () => {
    await enterDeepAnalysis();
    await openDialog();
    fireEvent.click(screen.getByTestId("ranking-dialog-next"));
    await waitFor(() => expect(lastDialogQuery().offset).toBe(RANKING_PAGE_SIZE));
    fireEvent.click(screen.getByTestId("ranking-dialog-prev"));
    await waitFor(() => expect(lastDialogQuery().offset).toBe(0));
  });

  it("derives the page count from total_matched and disables the ends", async () => {
    await enterDeepAnalysis();
    await openDialog();
    // 130 rows at 50 per page → 3 pages.
    expect(screen.getByTestId("ranking-dialog-page-label").textContent).toContain("1 / 3");
    expect(screen.getByTestId("ranking-dialog-prev")).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByTestId("ranking-dialog-next"));
    await waitFor(() => expect(lastDialogQuery().offset).toBe(RANKING_PAGE_SIZE));
    fireEvent.click(screen.getByTestId("ranking-dialog-next"));
    await waitFor(() => expect(lastDialogQuery().offset).toBe(2 * RANKING_PAGE_SIZE));
    await waitFor(() =>
      expect(screen.getByTestId("ranking-dialog-next")).toHaveProperty("disabled", true),
    );
  });

  it("returns to the first page when the scope changes", async () => {
    await enterDeepAnalysis();
    await openDialog();
    fireEvent.click(screen.getByTestId("ranking-dialog-next"));
    await waitFor(() => expect(lastDialogQuery().offset).toBe(RANKING_PAGE_SIZE));

    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-23"));
    await waitFor(() => expect(lastDialogQuery().sido).toBe("KR-SGIS-23"));
    expect(lastDialogQuery().offset).toBe(0);
  });

  it("uses keyboard-operable buttons for paging and sorting", async () => {
    await enterDeepAnalysis();
    await openDialog();
    for (const id of [
      "ranking-dialog-next",
      "ranking-dialog-prev",
      "ranking-dialog-sort-score_asc",
      "ranking-dialog-export",
    ]) {
      expect(screen.getByTestId(id).tagName).toBe("BUTTON");
    }
    expect(screen.getByTestId("ranking-dialog-pager").getAttribute("role")).toBe("group");
  });
});

// --------------------------------------------------------------------------- //
// 5. The ranked object stays a candidate CELL
// --------------------------------------------------------------------------- //

describe("rows remain candidate cells", () => {
  it("shows the cell's own key and the 500m unit beside the 시·군·구", async () => {
    await enterDeepAnalysis();
    await openDialog();
    const first = screen.getAllByTestId("ranking-dialog-row")[0];
    expect(first.textContent).toContain("경기도 시흥시");
    expect(first.textContent).toContain("500m 후보 구역");
    expect(within(first).getByTestId("ranking-dialog-candidate-key").textContent).toBe(
      "cap500-000001",
    );
  });

  it("keeps one row per cell when many cells share a 시·군·구", async () => {
    await enterDeepAnalysis();
    await openDialog();
    const rows = screen.getAllByTestId("ranking-dialog-row");
    // All 50 lie in 시흥시 and all 50 are present — nothing is collapsed into a
    // per-city row, a city mean, or a best-per-시군구.
    expect(rows).toHaveLength(RANKING_PAGE_SIZE);
    const keys = screen
      .getAllByTestId("ranking-dialog-candidate-key")
      .map((node) => node.textContent);
    expect(new Set(keys).size).toBe(RANKING_PAGE_SIZE);
  });

  it("says the ranking is over cells, and that map toggles do not narrow it", async () => {
    await enterDeepAnalysis();
    await openDialog();
    const framing = screen.getByTestId("ranking-dialog-framing").textContent ?? "";
    expect(framing).toContain("500m 후보 구역");
    expect(framing).toContain("지도 표시 설정");
  });

  it("selects the candidate cell the row names", async () => {
    await enterDeepAnalysis();
    await openDialog();
    const first = screen.getAllByTestId("ranking-dialog-row")[0];
    fireEvent.click(within(first).getByRole("button"));
    await waitFor(() =>
      expect(vi.mocked(api.fetchSuitabilityCandidateDetail)).toHaveBeenCalledWith(
        7001,
        "baseline",
      ),
    );
  });
});

// --------------------------------------------------------------------------- //
// 6. A/B/C, and the absence of a point threshold
// --------------------------------------------------------------------------- //

describe("A/B/C semantics", () => {
  it("shows the relative band from the SCOPED distribution", async () => {
    await enterDeepAnalysis();
    await openDialog();
    // rank 1 scores 99.9 (≥ p75 = 95) → A; rank 50 scores 95.0 → A; rank 130
    // would be 87.0 (< p25 = 88) → C, reachable on the last page.
    expect(screen.getAllByTestId("ranking-dialog-grade")[0].textContent).toContain("상위 구간(A)");
  });

  it("leaves the band EMPTY when the population could not be established", async () => {
    computeGradeDistribution.mockResolvedValue(null);
    await enterDeepAnalysis();
    await openDialog();
    for (const cell of screen.getAllByTestId("ranking-dialog-grade")) {
      expect(cell.textContent).toBe("—");
    }
  });

  it("never reintroduces A = 스크리닝 통과 / B = 추가 검토 / C = 제외", async () => {
    await enterDeepAnalysis();
    await openDialog();
    const text = dialog().textContent ?? "";
    expect(text).not.toContain("A = 스크리닝 통과");
    expect(text).not.toMatch(/A\s*[:=·]?\s*스크리닝 통과/);
    expect(text).not.toMatch(/C\s*[:=·]?\s*스크리닝 제외/);
    expect(text).not.toContain("추가 검토 필요");
  });

  it("displays NO 60/62-point pass threshold anywhere in the dialog", async () => {
    await enterDeepAnalysis();
    await openDialog();
    const text = dialog().textContent ?? "";
    // The Figma subtitle verbatim, and the THRESHOLD PHRASINGS it belongs to.
    //
    // Asserted as phrases rather than as the bare string "62점": a served score
    // is rendered with four decimals, so a legitimate 33.0062점 contains "62점"
    // as a substring. A bare-number assertion would fail on real data while
    // saying nothing about the wording, which is what actually has to be gone.
    expect(text).not.toContain("스크리닝 통과 62점 기준");
    expect(text).not.toMatch(/\d+(\.\d+)?점\s*(이상|미만|기준)/);
    expect(text).not.toMatch(/기준\s*점수/);
    expect(text).not.toContain("합격");
  });

  it("keeps the subtitle truthful: profile, scope, direction, eligible-only", async () => {
    await enterDeepAnalysis();
    await openDialog();
    const description = dialog().querySelector(".wep-dialog-desc")?.textContent ?? "";
    expect(description).toContain("수도권 전체");
    expect(description).toContain("높은 순");
    expect(description).toContain("스크리닝 통과");
    // No point threshold survives in the subtitle at all.
    expect(description).not.toMatch(/\d/);
  });
});

// --------------------------------------------------------------------------- //
// 7. Zero-result scope
// --------------------------------------------------------------------------- //

describe("a zero-result scope is honest", () => {
  it("shows an explicit empty state, not a table and not an error", async () => {
    await enterDeepAnalysis();
    servedTotal = 0;
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-11"));
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.getByTestId("ranking-dialog-empty")).toBeDefined());

    expect(screen.queryByTestId("ranking-dialog-table")).toBeNull();
    expect(screen.queryByTestId("ranking-dialog-error")).toBeNull();
    expect(screen.getByTestId("ranking-dialog-counts").textContent).toContain("0");
  });

  it("disables the export rather than writing an empty 'full ranking'", async () => {
    await enterDeepAnalysis();
    servedTotal = 0;
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-11"));
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.getByTestId("ranking-dialog-empty")).toBeDefined());

    expect(screen.getByTestId("ranking-dialog-export")).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByTestId("ranking-dialog-export"));
    expect(downloadCsv).not.toHaveBeenCalled();
  });

  it("shows no pager when there is a single page or none", async () => {
    await enterDeepAnalysis();
    servedTotal = 0;
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-11"));
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.getByTestId("ranking-dialog-empty")).toBeDefined());
    expect(screen.queryByTestId("ranking-dialog-pager")).toBeNull();
  });
});

// --------------------------------------------------------------------------- //
// 8. CSV export
// --------------------------------------------------------------------------- //

describe("순위 CSV 내보내기", () => {
  it("exports the WHOLE filtered population, not the visible page", async () => {
    await enterDeepAnalysis();
    await openDialog();
    fireEvent.click(screen.getByTestId("ranking-dialog-export"));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());

    const rows = exportedDataRows();
    // 130 rows — every matched cell, not the 50 on screen.
    expect(rows).toHaveLength(POPULATION);
    expect(rows.length).toBeGreaterThan(RANKING_PAGE_SIZE);
    expect(toCsv(exportedRows())).toContain(`범위 내 총 후보 구역 수,${POPULATION}`);
  });

  it("collects it by PAGING the same scoped query", async () => {
    await enterDeepAnalysis();
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-31"));
    await openDialog();
    fireEvent.click(screen.getByTestId("ranking-dialog-export"));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());

    // Every request the export made carried the active scope and direction.
    for (const query of dialogQueries()) {
      expect(query.sido).toBe("KR-SGIS-31");
      expect(query.sigungu ?? []).toEqual([]);
      expect(query.sort).toBe("score_desc");
    }
  });

  it("preserves a 시·군·구 scope in the exported population", async () => {
    await enterDeepAnalysis();
    await pickCity("안산", "경기 안산시");
    await openDialog();
    fireEvent.click(screen.getByTestId("ranking-dialog-export"));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());

    for (const query of dialogQueries()) {
      expect(query.sigungu).toEqual(["KR-SGIS-31091", "KR-SGIS-31092"]);
      expect(query.sido).toBeUndefined();
    }
    expect(toCsv(exportedRows())).toContain("분석 범위,경기 안산시");
  });

  it("exports in the ACTIVE order — score_asc is asked of the backend", async () => {
    await enterDeepAnalysis();
    await openDialog();
    fireEvent.click(screen.getByTestId("ranking-dialog-sort-score_asc"));
    await waitFor(() => expect(lastDialogQuery().sort).toBe("score_asc"));

    fireEvent.click(screen.getByTestId("ranking-dialog-export"));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());

    const ranks = exportedDataRows().map((row) => row[0]);
    // The served descending-rank order for 낮은 순, verbatim.
    expect(ranks[0]).toBe(POPULATION);
    expect(ranks[ranks.length - 1]).toBe(1);
    expect(toCsv(exportedRows())).toContain("순위 방향,낮은 순");
  });

  it("names the active scope, profile and direction in the file name", async () => {
    await enterDeepAnalysis();
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-23"));
    await openDialog();
    fireEvent.click(screen.getByTestId("ranking-dialog-export"));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());

    const filename = exportedFilename();
    expect(filename).toContain("인천");
    expect(filename).toContain("높은_순");
    expect(filename).toContain("run47");
    expect(filename.endsWith(".csv")).toBe(true);
  });

  it("keeps every exported row a candidate cell with its own key", async () => {
    await enterDeepAnalysis();
    await openDialog();
    fireEvent.click(screen.getByTestId("ranking-dialog-export"));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());

    const rows = exportedDataRows();
    const keys = rows.map((row) => row[2]);
    expect(new Set(keys).size).toBe(POPULATION);
    expect(keys[0]).toBe("cap500-000001");
    expect(rows.every((row) => row[1] === "500m 후보 구역")).toBe(true);
  });

  it("reports what it wrote, naming the scope", async () => {
    await enterDeepAnalysis();
    fireEvent.click(within(scopeCard()).getByTestId("suitability-scope-pill-23"));
    await openDialog();
    fireEvent.click(screen.getByTestId("ranking-dialog-export"));
    await waitFor(() => expect(screen.getByTestId("ranking-dialog-export-note")).toBeDefined());
    expect(screen.getByTestId("ranking-dialog-export-note").textContent).toContain("인천");
  });

  it("carries no 60/62-point pass wording into the file", async () => {
    await enterDeepAnalysis();
    await openDialog();
    fireEvent.click(screen.getByTestId("ranking-dialog-export"));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled());
    const text = toCsv(exportedRows());
    expect(text).not.toContain("스크리닝 통과 62점 기준");
    expect(text).not.toMatch(/\d+(\.\d+)?점\s*(이상|미만|기준)/);
    // The one 합격 in the file is the sentence DENYING a fixed pass mark.
    expect(text).toContain("고정 합격 점수가 아니며");
    expect(text.match(/합격/g)).toHaveLength(1);
  });
});
