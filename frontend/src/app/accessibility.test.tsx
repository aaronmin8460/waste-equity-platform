// @vitest-environment jsdom

/**
 * Accessibility-foundation tests for the dashboard shell (Phase 2).
 *
 * These assert the semantic/ARIA contract at the DOM level: role="status"
 * loading, the metric radios grouped into <fieldset>/<legend>, the
 * selected-metric and suitability live regions, the accessible
 * selected-region alternative, a single logical <h1>, and the mode toggle
 * group's preserved aria-pressed state. The MapLibre map is stubbed (as in the
 * other page tests); the map's own region/label semantics and the region-click
 * → summary wiring are covered by MapView.test.tsx, and lang="ko" + the skip
 * link (which live in layout.tsx) are covered by e2e/accessibility.spec.ts.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub() {
      return <div data-testid="map-container" />;
    },
}));

// A top eligible candidate + its detail, so the suitability candidate-list
// alternative and its selected-state indicator can be exercised. Declared via
// vi.hoisted so they are available to the (hoisted) vi.mock factory below.
const fixtures = vi.hoisted(() => ({
  TOP_CANDIDATE: {
    candidate_id: 4242,
    candidate_key: "capital-grid-500m-v1:10_20",
    rank: 1,
    total_score: "83.5",
    sigungu: "강화군",
    zoning_score: "90",
    road_score: "70",
    equity_score: "80",
    demand_score: "88",
    centroid_lat: 37.7,
    centroid_lon: 126.4,
  },
  CANDIDATE_DETAIL: {
    candidate_id: 4242,
    candidate_key: "capital-grid-500m-v1:10_20",
    status: "ELIGIBLE",
    profile: "baseline",
    is_excluded: false,
    rank: 1,
    total_score: "83.5",
    provisional_score: null,
    zoning_score: "90",
    road_score: "70",
    equity_score: "80",
    demand_score: "88",
    sido_region_code: null,
    sido_region_name: null,
    sigungu_region_code: null,
    sigungu_region_name: "강화군",
    nearest_road_distance_m: "120",
    exclusion_reasons: [],
    review_reasons: [],
    run_id: 47,
    profile_totals: {},
    profile_ranks: {},
    penalties: [],
    raw_components: {},
    nearest_road_provenance: {},
    component_provenance: {},
    original_area_m2: "250000",
    clipped_area_m2: "250000",
    clipped_area_ratio: "1",
    geometry: { type: "Point", coordinates: [126.4, 37.7] },
    reference_year: 2024,
    policy_version: "suitability-policy-v1",
    derivation_version: "suitability-screening-v1",
    candidate_grid_version: "capital-grid-500m-v1",
    weights: {},
    disclaimer: "분석용 스크리닝 결과이며 법적 결정이 아닙니다.",
  },
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const { homeApiMock } = await import("./homeApiMock");
  const base = homeApiMock(actual);
  const baseSummary = await base.fetchSuitabilitySummary("baseline");
  return {
    ...base,
    // One SGIS region + its population, so the accessible region <select> has an
    // option to exercise (the map-mode envelopes in homeApiMock are otherwise empty).
    fetchBoundaries: vi.fn().mockResolvedValue({
      type: "FeatureCollection",
      reference_year: 2024,
      count: 1,
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [126.97, 37.57],
                [126.99, 37.57],
                [126.99, 37.59],
                [126.97, 37.59],
                [126.97, 37.57],
              ],
            ],
          },
          properties: {
            region_code: "KR-SGIS-11110",
            region_name: "종로구",
            region_level: "SIGUNGU",
            parent_region_code: "KR-SGIS-11",
            source_id: "sgis",
            boundary_reference_period: "2024",
          },
        },
      ],
    }),
    fetchPopulation: vi.fn().mockResolvedValue({
      reference_year: 2024,
      count: 1,
      items: [
        {
          region_code: "KR-SGIS-11110",
          region_name: "종로구",
          region_level: "SIGUNGU",
          population: 142000,
          unit: "persons",
          population_definition: "SGIS 총인구",
          source_id: "sgis",
          reference_year: 2024,
          reference_period: "2024",
        },
      ],
    }),
    fetchSuitabilitySummary: vi
      .fn()
      .mockResolvedValue({ ...baseSummary, top_candidates: [fixtures.TOP_CANDIDATE] }),
    fetchSuitabilityCandidateDetail: vi.fn().mockResolvedValue(fixtures.CANDIDATE_DETAIL),
  };
});

import Home from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

async function renderLoaded() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  return utils;
}

async function enterSuitability() {
  fireEvent.click(screen.getByTestId("mode-suitability"));
  await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
}

describe("loading announcement", () => {
  it("marks the initial loading state as a status live region", () => {
    render(<Home />);
    // Before the mocked fetches resolve, the loading text is a role="status".
    const loading = screen.getByTestId("loading");
    expect(loading.getAttribute("role")).toBe("status");
    cleanup();
  });
});

describe("metric fieldset groups + live summary", () => {
  it("groups the 11 metrics into three labelled fieldsets, all one radio group", async () => {
    const { container } = await renderLoaded();
    const fieldsets = container.querySelectorAll("fieldset");
    expect(fieldsets.length).toBe(3);
    const legends = Array.from(container.querySelectorAll("legend")).map((l) => l.textContent);
    expect(legends.some((t) => t?.includes("총량 지표"))).toBe(true);
    expect(legends.some((t) => t?.includes("1인당 형평성 지표"))).toBe(true);
    expect(legends.some((t) => t?.includes("시설 부담 지표"))).toBe(true);
    // All 11 metric radios remain a single logical group (shared name="metric").
    const radios = Array.from(container.querySelectorAll('input[type="radio"][name="metric"]'));
    expect(radios).toHaveLength(11);
  });

  it("announces the selected metric via role=status and updates on change", async () => {
    await renderLoaded();
    const summary = screen.getByTestId("selected-metric-summary");
    expect(summary.getAttribute("role")).toBe("status");
    expect(summary.textContent).toContain("인구 (Population)");
    // Switching the metric updates the announced summary text.
    fireEvent.click(screen.getByRole("radio", { name: /생활계 폐기물 발생량/ }));
    await waitFor(() =>
      expect(screen.getByTestId("selected-metric-summary").textContent).toContain(
        "생활계 폐기물 발생량",
      ),
    );
  });
});

describe("accessible selected-region alternative", () => {
  it("renders a selected-region summary with an empty prompt before any selection", async () => {
    await renderLoaded();
    const summary = screen.getByTestId("selected-region-summary");
    expect(within(summary).getByRole("heading", { name: /선택한 지역/ })).toBeDefined();
    expect(screen.getByTestId("selected-region-empty")).toBeDefined();
  });

  it("lets a keyboard user pick a region and shows its value with metric provenance", async () => {
    await renderLoaded();
    // A labelled, keyboard-operable <select> — no pointer/canvas interaction needed.
    const select = screen.getByTestId("region-select") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("combobox", { name: /지역 선택/ })).toBeDefined();

    fireEvent.change(select, { target: { value: "KR-SGIS-11110" } });

    // The summary now names the region and shows its served value with unit —
    // never a fabricated 0.
    expect(screen.getByTestId("selected-region-name").textContent).toBe("종로구");
    expect(screen.getByTestId("selected-region-value").textContent).toContain("142,000 persons");
    // The displayed analytical value carries its metric source + reference period
    // (repo AGENTS.md), distinct from the boundary provenance.
    const sources = screen
      .getAllByTestId("selected-region-metric-source")
      .map((el) => el.textContent)
      .join(" ");
    expect(sources).toContain("지표 출처");
    expect(sources).toContain("sgis");
    expect(sources).toContain("2024");
  });

  it("clears the selected region when the metric changes", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByTestId("region-select"), {
      target: { value: "KR-SGIS-11110" },
    });
    expect(screen.getByTestId("selected-region-name")).toBeDefined();
    // Switching metric drops the stale selection (its value belonged to the old metric).
    fireEvent.click(screen.getByRole("radio", { name: /생활계 폐기물 발생량/ }));
    await waitFor(() => expect(screen.queryByTestId("selected-region-name")).toBeNull());
    expect(screen.getByTestId("selected-region-empty")).toBeDefined();
  });
});

describe("mode toggle group", () => {
  it("is a labelled group of toggle buttons that preserves aria-pressed", async () => {
    await renderLoaded();
    const group = screen.getByTestId("mode-switch");
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-labelledby")).toBe("mode-switch-label");
    // Native buttons (keyboard-operable) with aria-pressed reflecting the mode.
    const equityBtn = screen.getByTestId("mode-equity");
    const suitBtn = screen.getByTestId("mode-suitability");
    expect(equityBtn.tagName).toBe("BUTTON");
    expect(equityBtn.getAttribute("aria-pressed")).toBe("true");
    expect(suitBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(suitBtn);
    await waitFor(() => expect(suitBtn.getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByTestId("mode-equity").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("map/dashboard readability (Phase 3)", () => {
  it("shows numbered legend classes with numeric ranges, the unit, and a no-data row", async () => {
    await renderLoaded();
    const rows = screen.getAllByTestId("choropleth-legend-row");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Each class row carries a class number (…급) and the metric unit, so a class
    // is identifiable without relying on color.
    for (const row of rows) {
      expect(row.textContent).toContain("급");
      expect(row.textContent).toContain("persons");
    }
    // An explicit no-data category, never rendered as a 0 class.
    const nodata = screen.getByTestId("choropleth-legend-nodata");
    expect(nodata.textContent).toContain("데이터 없음");
  });

  it("presents the metric families as three scannable group cards", async () => {
    await renderLoaded();
    expect(screen.getByTestId("metric-group-total")).toBeDefined();
    expect(screen.getByTestId("metric-group-per_capita")).toBeDefined();
    expect(screen.getByTestId("metric-group-burden")).toBeDefined();
  });
});

describe("single logical heading", () => {
  it("renders exactly one h1 in the equity view", async () => {
    const { container } = await renderLoaded();
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toContain("수도권 폐기물 형평성·적합성 지도");
  });
});

describe("suitability accessible alternatives", () => {
  it("exposes a status live region for profile/candidate updates", async () => {
    await renderLoaded();
    await enterSuitability();
    const live = screen.getByTestId("suitability-live");
    expect(live.getAttribute("role")).toBe("status");
    expect(live.textContent).toContain("가중치 프로파일 baseline");
  });

  it("offers the top candidates as keyboard-operable buttons with a selected marker", async () => {
    await renderLoaded();
    await enterSuitability();
    const item = screen.getByTestId("top-candidate-item");
    // A native button, so keyboard activation is built in.
    expect(item.tagName).toBe("BUTTON");
    // No selection marker before a candidate is chosen.
    expect(screen.queryByTestId("top-candidate-selected")).toBeNull();
    fireEvent.click(item);
    // Selecting it opens the accessible detail panel and marks the list item —
    // by text ("✓ 선택됨") and aria-current, never by color alone.
    await waitFor(() => expect(screen.getByTestId("candidate-detail")).toBeDefined());
    expect(screen.getByTestId("top-candidate-selected")).toBeDefined();
    expect(screen.getByTestId("top-candidate-item").getAttribute("aria-current")).toBe("true");
  });
});
