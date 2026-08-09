// @vitest-environment jsdom

/**
 * 지역 부담 dashboard refresh — the contracts this milestone's restructure keeps.
 *
 * The equity control column was rebuilt around four presentational components
 * (`components/equity/*`) while every piece of analytical state stayed in
 * `app/page.tsx`. These tests exist so a later "cleanup" of that column has to
 * break an explicit assertion rather than quietly regress an accessibility,
 * provenance, or data-integrity guarantee:
 *
 *   - one page-level <h1>, one <main>, one MapView, one of each selection control;
 *   - the eleven metric radios in three labelled fieldsets, one logical group;
 *   - the current-selection summary carries region, metric, value, unit, reference
 *     period, source, and a text data-status;
 *   - a missing value shows its SERVED reason and never a zero;
 *   - ranking and comparison still drive the ONE canonical selected region.
 *
 * MapLibre (WebGL) is stubbed and the backend is mocked, as in the sibling page
 * tests. The stub exposes a region-click trigger so the map path and the DOM path
 * can be shown to drive one state. Every fixture value is synthetic layout data,
 * never official public data.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub(props: { onRegionClick?: (code: string) => void }) {
      return (
        <div data-testid="map-container">
          <button
            type="button"
            data-testid="stub-map-click-jongno"
            onClick={() => props.onRegionClick?.("KR-SGIS-11110")}
          >
            map click 종로구
          </button>
        </div>
      );
    },
}));

// Two SGIS regions on the NATIVE geometry with population, and a facility-burden
// envelope that serves 강남구 only — so 종로구 exercises the explicit unavailable
// state on a metric change. Synthetic layout fixtures, never official data.
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const { homeApiMock } = await import("./homeApiMock");
  const base = homeApiMock(actual);
  const region = (code: string, name: string) => ({
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
      region_code: code,
      region_name: name,
      region_level: "SIGUNGU",
      parent_region_code: "KR-SGIS-11",
      source_id: "sgis",
      boundary_reference_period: "2024",
    },
  });
  const population = (code: string, name: string, value: number) => ({
    region_code: code,
    region_name: name,
    region_level: "SIGUNGU",
    population: value,
    unit: "persons",
    population_definition: "SGIS 총인구",
    source_id: "sgis",
    reference_year: 2024,
    reference_period: "2024",
  });
  return {
    ...base,
    fetchBoundaries: vi.fn().mockResolvedValue({
      type: "FeatureCollection",
      reference_year: 2024,
      count: 2,
      features: [region("KR-SGIS-11110", "종로구"), region("KR-SGIS-11680", "강남구")],
    }),
    fetchPopulation: vi.fn().mockResolvedValue({
      reference_year: 2024,
      count: 2,
      items: [
        population("KR-SGIS-11110", "종로구", 142000),
        population("KR-SGIS-11680", "강남구", 561000),
      ],
    }),
    fetchFacilityBurden: vi.fn().mockResolvedValue({
      indicator: "FACILITY_LOCATION_BASED_THROUGHPUT_PER_CAPITA",
      derivation_version: "facility-burden-v1",
      derivation_formula: "located throughput ÷ population",
      buffer_meters: 5000,
      unit: "kg/인/년",
      assumptions: ["분석용 가정"],
      reference_year: 2024,
      count: 1,
      items: [
        {
          region_code: "KR-SGIS-11680",
          region_name: "강남구",
          region_level: "SIGUNGU",
          facility_count_located: 2,
          throughput_located_tons_per_year: "10000.000000",
          throughput_located_kg_per_capita: "520.000000",
          located_missing_throughput_count: 0,
          located_throughput_is_partial: false,
          facility_count_within_buffer: 3,
          throughput_within_buffer_tons_per_year: "12000.000000",
          throughput_within_buffer_kg_per_capita: "640.000000",
          buffer_missing_throughput_count: 0,
          buffer_throughput_is_partial: false,
          quantity_unit: "kg/인/년",
          accounting_basis: "FACILITY_LOCATION_BASED_THROUGHPUT",
          facility_source_id: "waste_statistics",
          facility_reference_period: "2022",
          population: 561000,
          population_definition: "SGIS 총인구",
          population_source_id: "sgis",
          population_reference_period: "2024",
          reference_year: 2024,
        },
      ],
      excluded_regions: [],
      facilities_without_coordinates: 0,
      facilities_without_region: 0,
    }),
  };
});

import Home from "./page";
import { MODE_LABELS, MODE_ORIENTATION } from "../lib/glossary";

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

async function renderLoaded() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  return utils;
}

// --------------------------------------------------------------------------- //
// Page header
// --------------------------------------------------------------------------- //

describe("equity page header", () => {
  it("titles the view with the area label as the one page-level h1", async () => {
    const { container } = await renderLoaded();
    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe(MODE_LABELS.equity);
  });

  it("keeps the scope description and the task orientation, in that order", async () => {
    const { container } = await renderLoaded();
    // The approved scope tagline is preserved verbatim (regression-contract §10).
    expect(container.textContent).toContain("서울 · 인천 · 경기 공공자료로 보는 지역 부담과 후보지");
    const h1 = container.querySelector("h1")!;
    const orientation = screen.getByTestId("mode-orientation");
    expect(orientation.textContent).toBe(MODE_ORIENTATION.equity);
    // DOCUMENT_POSITION_FOLLOWING — the orientation supports the h1, never precedes it.
    expect(h1.compareDocumentPosition(orientation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// --------------------------------------------------------------------------- //
// Current-selection summary
// --------------------------------------------------------------------------- //

describe("current-region summary", () => {
  it("shows an explicit empty prompt, the active metric, its unit, and a data status", async () => {
    await renderLoaded();
    const summary = screen.getByTestId("selected-region-summary");
    expect(within(summary).getByRole("heading", { name: /선택한 지역/ })).toBeDefined();
    // Nothing selected yet: an instruction, never a sample region and never a 0.
    expect(screen.getByTestId("selected-region-empty")).toBeDefined();
    expect(screen.getByTestId("selected-region-empty").textContent).not.toMatch(/(^|\D)0(\D|$)/);
    // The metric KPI names what is being measured and in what unit.
    expect(summary.textContent).toContain("현재 지표");
    expect(summary.textContent).toContain("인구");
    expect(summary.textContent).toContain("단위 persons");
    // Provenance is stated as TEXT, never by color alone.
    expect(screen.getByTestId("equity-summary-status").textContent).toBeTruthy();
  });

  it("shows the region name and its served value once a region is selected", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByTestId("region-select"), { target: { value: "KR-SGIS-11680" } });
    expect(screen.getByTestId("selected-region-name").textContent).toBe("강남구");
    expect(screen.getByTestId("selected-region-value").textContent).toContain("561,000 persons");
    // The boundary provenance joins the metric provenance for the displayed value.
    expect(screen.getByTestId("selected-region-summary").textContent).toContain("경계 출처");
  });

  it("keeps the reference period visible as its own labelled item", async () => {
    await renderLoaded();
    expect(screen.getByTestId("equity-summary-reference-period").textContent).toBe("2024");
    expect(screen.getByTestId("selected-region-summary").textContent).toContain("자료 기준");
  });

  it("keeps the metric source and reference period on screen without opening a disclosure", async () => {
    await renderLoaded();
    const sources = screen
      .getAllByTestId("selected-region-metric-source")
      .map((el) => el.textContent)
      .join(" ");
    expect(sources).toContain("지표 출처");
    expect(sources).toContain("sgis");
    expect(sources).toContain("2024");
    // Not inside a collapsed <details>.
    for (const node of screen.getAllByTestId("selected-region-metric-source")) {
      const details = node.closest("details");
      expect(details === null || details.hasAttribute("open")).toBe(true);
    }
  });

  it("renders a missing value as its served reason with a 자료 없음 status, never as 0", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByTestId("region-select"), { target: { value: "KR-SGIS-11110" } });
    // 종로구 has population but no facility-burden value in this fixture.
    fireEvent.click(screen.getByRole("radio", { name: /소재 시설 처리량/ }));
    await waitFor(() =>
      expect(screen.getByTestId("selected-region-value").textContent).toContain("데이터 없음"),
    );
    const value = screen.getByTestId("selected-region-value");
    expect(value.textContent).not.toMatch(/(^|\D)0(\D|$)/);
    expect(value.textContent).not.toBe("-");
    // The status badge switches to the neutral missing state — text, not color.
    expect(screen.getByTestId("equity-summary-status").getAttribute("data-status")).toBe("missing");
    expect(screen.getByTestId("equity-summary-status").textContent).toContain("자료 없음");
  });

  it("labels a backend-derived metric as a calculated value, not an official one", async () => {
    await renderLoaded();
    // population is served as published…
    expect(screen.getByTestId("equity-summary-status").getAttribute("data-status")).toBe("reported");
    // …a facility-burden metric is computed from two official inputs.
    fireEvent.click(screen.getByRole("radio", { name: /소재 시설 처리량/ }));
    await waitFor(() =>
      expect(screen.getByTestId("equity-summary-status").getAttribute("data-status")).toBe("derived"),
    );
  });
});

// --------------------------------------------------------------------------- //
// Metric selection
// --------------------------------------------------------------------------- //

describe("metric selection", () => {
  it("keeps exactly eleven radios in exactly three labelled fieldsets", async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll("fieldset")).toHaveLength(3);
    expect(container.querySelectorAll("legend")).toHaveLength(3);
    const radios = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"][name="metric"]'),
    );
    expect(radios).toHaveLength(11);
    expect(radios.filter((radio) => radio.checked)).toHaveLength(1);
    expect(screen.getByTestId("metric-group-total")).toBeDefined();
    expect(screen.getByTestId("metric-group-per_capita")).toBeDefined();
    expect(screen.getByTestId("metric-group-burden")).toBeDefined();
  });

  it("does not replace the radios with a select, tabs, chips, or a disclosure", async () => {
    const { container } = await renderLoaded();
    const selector = screen.getByTestId("equity-metric-selector");
    expect(selector.querySelectorAll("select")).toHaveLength(0);
    expect(selector.querySelectorAll('[role="tab"], [role="tablist"]')).toHaveLength(0);
    for (const fieldset of Array.from(container.querySelectorAll("fieldset"))) {
      const details = fieldset.closest("details");
      expect(details === null || details.hasAttribute("open")).toBe(true);
    }
  });

  it("marks the selected metric by more than color and announces it once", async () => {
    await renderLoaded();
    const summary = screen.getByTestId("selected-metric-summary");
    expect(summary.getAttribute("role")).toBe("status");
    const checked = screen.getByRole("radio", { name: "인구" }) as HTMLInputElement;
    expect(checked.checked).toBe(true);
    // The row carries a heavier weight and a border in addition to the tint.
    const row = checked.closest("label")!;
    expect(row.className).toContain("font-semibold");
    expect(row.className).toContain("border-primary-border");
  });

  it("drives the map, the summary, and the strip from one metric change", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("radio", { name: "생활계 폐기물 발생량" }));
    await waitFor(() =>
      expect(screen.getByTestId("selected-metric-summary").textContent).toContain(
        "생활계 폐기물 발생량",
      ),
    );
    expect(screen.getByTestId("insight-interpretation").textContent).toContain(
      "생활계 폐기물 발생량",
    );
    expect(screen.getByTestId("legend-metric-label").textContent).toContain("생활계 폐기물 발생량");
  });
});

// --------------------------------------------------------------------------- //
// Ranking and comparison drive the ONE canonical selection
// --------------------------------------------------------------------------- //

describe("ranking and comparison interaction", () => {
  it("selects a region from the ranking and mirrors it into the summary and the picker", async () => {
    await renderLoaded();
    const high = screen.getByTestId("rank-high");
    const firstRow = within(high).getAllByTestId("rank-row")[0];
    fireEvent.click(firstRow);
    expect(screen.getByTestId("selected-region-name").textContent).toBe("강남구");
    expect((screen.getByTestId("region-select") as HTMLSelectElement).value).toBe("KR-SGIS-11680");
    expect(firstRow.getAttribute("aria-current")).toBe("true");
  });

  it("mirrors a map click into the same one selection", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("stub-map-click-jongno"));
    await waitFor(() =>
      expect(screen.getByTestId("selected-region-name").textContent).toBe("종로구"),
    );
    expect((screen.getByTestId("region-select") as HTMLSelectElement).value).toBe("KR-SGIS-11110");
  });

  it("states the ranking basis with the metric, the unit, and the reference period", async () => {
    await renderLoaded();
    const basis = screen.getByTestId("rank-basis").textContent ?? "";
    expect(basis).toContain("인구");
    expect(basis).toContain("persons");
    expect(basis).toContain("2024");
  });

  it("adds and removes a comparison region without touching the ranking", async () => {
    await renderLoaded();
    const search = screen.getByTestId("comparison-search");
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "종로" } });
    fireEvent.mouseDown(within(await screen.findByTestId("comparison-options")).getByText(/종로구/));
    expect(screen.getByTestId("comparison-table").textContent).toContain("종로구");
    expect(screen.getByTestId("comparison-count").textContent).toContain("1");

    fireEvent.click(screen.getByTestId("comparison-chip-remove"));
    expect(screen.queryByTestId("comparison-table")).toBeNull();
    // The ranking is unaffected by comparison membership.
    expect(within(screen.getByTestId("rank-high")).getAllByTestId("rank-row").length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------- //
// Map workspace and the insight strip
// --------------------------------------------------------------------------- //

describe("map workspace", () => {
  it("mounts exactly one map, one legend, and one insight strip", async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll('[data-testid="map-container"]')).toHaveLength(1);
    expect(container.querySelectorAll("details.map-legend")).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="equity-insight-strip"]')).toHaveLength(1);
    // The map is still the direct child of the .map-pane wrapper.
    const wrapper = screen.getByTestId("map-container").parentElement;
    expect((wrapper?.getAttribute("class") ?? "").split(/\s+/)).toContain("map-pane");
  });

  it("mounts the insight as ONE disclosure, collapsed, so the map starts unobstructed", async () => {
    const { container } = await renderLoaded();
    const strip = screen.getByTestId("equity-insight-strip") as HTMLDetailsElement;
    expect(strip.tagName).toBe("DETAILS");
    expect(strip.open).toBe(false);
    // The compact bar prints exactly the frozen label, and there is no second
    // disclosure or leftover always-expanded copy of the panel over the map.
    expect(screen.getByTestId("equity-insight-summary").textContent).toContain(
      "해석 · 주의 · 출처 보기",
    );
    expect(container.querySelectorAll("details.map-insight")).toHaveLength(1);
    // …and the legend keeps its own, separate disclosure class (it force-opens at
    // md+; this one must never share that behaviour).
    expect(container.querySelectorAll("details.map-legend.map-insight")).toHaveLength(0);
  });

  it("carries a neutral interpretation, a standing caution, and the served provenance", async () => {
    await renderLoaded();
    const strip = screen.getByTestId("equity-insight-strip");
    // Opened the way a reader opens it — the content below is what the disclosure
    // reveals, unchanged from when the card was permanently expanded.
    fireEvent.click(screen.getByTestId("equity-insight-summary"));
    expect((strip as HTMLDetailsElement).open).toBe(true);
    expect(strip.textContent).toContain("해석");
    expect(strip.textContent).toContain("주의");
    expect(strip.textContent).toContain("자료 기준·출처");
    // Neutral wording — no environmental-justice, siting, safety, or blame claim.
    expect(screen.getByTestId("insight-interpretation").textContent).toContain("상대적 차이");
    expect(screen.getByTestId("insight-caution").textContent).toContain("0이 아니");
    expect(screen.getByTestId("insight-reference-period").textContent).toContain("2024");
    expect(screen.getByTestId("insight-provenance").textContent).toContain("지표 출처");
    // Standing explanatory content is never role="alert".
    expect(strip.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it("routes to the existing 데이터·출처 area from the source block", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("equity-insight-summary"));
    fireEvent.click(screen.getByTestId("insight-open-sources"));
    await waitFor(() =>
      expect(screen.getByTestId("mode-transparency").getAttribute("aria-pressed")).toBe("true"),
    );
  });
});

// --------------------------------------------------------------------------- //
// No duplicated state controls
// --------------------------------------------------------------------------- //

describe("one source of truth per control", () => {
  it("renders exactly one of each selection control and one landmark set", async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll('[data-testid="region-select"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="comparison-search"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="rank-topn"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="region-ranking"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="region-comparison"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="share-export"]')).toHaveLength(1);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelectorAll("#main-content")).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="top-navigation"]')).toHaveLength(1);
    expect(container.querySelectorAll("aside")).toHaveLength(1);
  });

  it("keeps the sidebar the desktop scroll container, not the page", async () => {
    const { container } = await renderLoaded();
    const tokens = (container.querySelector("aside")?.getAttribute("class") ?? "").split(/\s+/);
    expect(tokens).toContain("md:overflow-y-auto");
    expect(tokens).toContain("md:flex-none");
    // The fixed `md:w-96` was replaced by the reader-controlled 300–520 width
    // (spec §3); independent scrolling is unchanged.
    expect(tokens).toContain("wep-sidebar");
    expect(tokens).not.toContain("md:w-96");
  });
});
