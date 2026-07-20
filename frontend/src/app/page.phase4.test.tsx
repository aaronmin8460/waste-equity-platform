// @vitest-environment jsdom

/**
 * Phase 4 — regional burden map desktop improvements.
 *
 * These lock the contracts Phase 4 deliberately KEPT while changing the visual
 * hierarchy of the equity control column, the loading experience, and the floating
 * legend. The point of the file is that a future "simplification" of the metric
 * controls, the region <select>, or the legend has to break an explicit assertion
 * rather than quietly regress an accessibility or analytical guarantee.
 *
 * MapLibre (WebGL) is stubbed and the backend is mocked, exactly as in the sibling
 * page tests. The stub surfaces a region-click trigger so the map-click path and the
 * <select> path can be shown to drive ONE canonical selection state. Every fixture
 * value is synthetic layout data, never official public data.
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
import { FORBIDDEN_PRIMARY_TOKENS } from "../lib/glossary";

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
// Metric controls — structure preserved, presentation changed
// --------------------------------------------------------------------------- //

describe("metric control structure is unchanged by the Phase 4 restyle", () => {
  it("keeps exactly three fieldsets, three legends, and eleven radios in one group", async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll("fieldset")).toHaveLength(3);
    expect(container.querySelectorAll("legend")).toHaveLength(3);

    const radios = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"][name="metric"]'),
    );
    expect(radios).toHaveLength(11);
    // One logical radio group: every radio shares the name, so native arrow-key
    // traversal still moves across all eleven options. No custom key handler and no
    // select/combobox/segmented-control replacement.
    for (const radio of radios) {
      expect(radio.getAttribute("name")).toBe("metric");
      expect(radio.tagName).toBe("INPUT");
    }
    // Exactly one radio is checked at a time — there is no second metric state.
    expect(radios.filter((r) => r.checked)).toHaveLength(1);
  });

  it("keeps the three metric group test IDs", async () => {
    await renderLoaded();
    expect(screen.getByTestId("metric-group-total")).toBeDefined();
    expect(screen.getByTestId("metric-group-per_capita")).toBeDefined();
    expect(screen.getByTestId("metric-group-burden")).toBeDefined();
  });

  it("uses Korean-only primary text for the group legends", async () => {
    const { container } = await renderLoaded();
    const legends = Array.from(container.querySelectorAll("legend")).map(
      (l) => l.textContent ?? "",
    );
    expect(legends).toEqual(["총량 지표", "1인당 형평성 지표", "시설 부담 지표"]);
    // No English parenthetical survives in the primary group labels.
    for (const legend of legends) {
      expect(legend).not.toMatch(/[A-Za-z]/);
    }
  });

  it("does not hide any metric family behind a closed disclosure", async () => {
    const { container } = await renderLoaded();
    // No fieldset sits inside a collapsed <details>: all eleven options stay
    // reachable without opening anything on desktop.
    for (const fieldset of Array.from(container.querySelectorAll("fieldset"))) {
      const details = fieldset.closest("details");
      expect(details === null || details.hasAttribute("open")).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------- //
// Active-metric summary
// --------------------------------------------------------------------------- //

describe("active-metric summary", () => {
  it("announces the metric name and unit through one role=status region", async () => {
    await renderLoaded();
    const summary = screen.getByTestId("selected-metric-summary");
    expect(summary.getAttribute("role")).toBe("status");
    expect(summary.textContent).toContain("인구");
    expect(summary.textContent).toContain("persons");
    // Plain Korean only — no raw API identifier or English metric name.
    expect(summary.textContent).not.toContain("(Population)");
    expect(summary.textContent).not.toContain("population");
  });

  it("gives the metric name stronger typography than the unit", async () => {
    await renderLoaded();
    const summary = screen.getByTestId("selected-metric-summary");
    const name = within(summary).getByText("인구");
    expect(name.className).toContain("text-base");
    expect(name.className).toContain("font-semibold");
    // The unit is muted secondary text, not the dominant element.
    const unit = within(summary).getByText(/단위/);
    expect(unit.className).toContain("text-xs");
  });

  it("updates immediately when a metric radio changes", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("radio", { name: /생활계 폐기물 발생량/ }));
    await waitFor(() =>
      expect(screen.getByTestId("selected-metric-summary").textContent).toContain(
        "생활계 폐기물 발생량",
      ),
    );
    expect(screen.getByTestId("selected-metric-summary").textContent).not.toContain("인구");
  });
});

// --------------------------------------------------------------------------- //
// One canonical selectedRegionCode
// --------------------------------------------------------------------------- //

describe("selected region stays one canonical state", () => {
  it("keeps a native <select> as the accessible selection control", async () => {
    await renderLoaded();
    const select = screen.getByTestId("region-select") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("combobox", { name: /지역 선택/ })).toBeDefined();
  });

  it("mirrors a map click into the <select> and the selected-region panel", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("stub-map-click-jongno"));
    await waitFor(() =>
      expect(screen.getByTestId("selected-region-name").textContent).toBe("종로구"),
    );
    // The same state drives the native select — no second selection store.
    expect((screen.getByTestId("region-select") as HTMLSelectElement).value).toBe(
      "KR-SGIS-11110",
    );
  });

  it("mirrors a <select> change into the selected-region panel", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByTestId("region-select"), {
      target: { value: "KR-SGIS-11110" },
    });
    expect(screen.getByTestId("selected-region-name").textContent).toBe("종로구");
    expect(screen.getByTestId("selected-region-value").textContent).toContain("persons");
    // The displayed analytical value still carries its metric source + period.
    const sources = screen
      .getAllByTestId("selected-region-metric-source")
      .map((el) => el.textContent)
      .join(" ");
    expect(sources).toContain("지표 출처");
  });

  it("clears a selection the new geography no longer contains", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByTestId("region-select"), {
      target: { value: "KR-SGIS-11110" },
    });
    expect(screen.getByTestId("selected-region-name")).toBeDefined();
    // A waste metric renders on the RCIS reporting geometry, which is empty in this
    // fixture and does not contain the SGIS code — the summary clears rather than
    // showing a stale snapshot.
    fireEvent.click(screen.getByRole("radio", { name: /생활계 폐기물 발생량/ }));
    await waitFor(() => expect(screen.queryByTestId("selected-region-name")).toBeNull());
    expect(screen.getByTestId("selected-region-empty")).toBeDefined();
    // The empty prompt never implies the region produces no waste, and never shows 0.
    expect(screen.getByTestId("selected-region-empty").textContent).not.toMatch(/(^|\D)0(\D|$)/);
  });

  it("never renders a missing value as zero", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByTestId("region-select"), {
      target: { value: "KR-SGIS-11110" },
    });
    // 종로구 has population but no facility-burden value in the fixture.
    fireEvent.click(screen.getByRole("radio", { name: /소재 시설 처리량/ }));
    await waitFor(() =>
      expect(screen.getByTestId("selected-region-value").textContent).toContain("데이터 없음"),
    );
    const value = screen.getByTestId("selected-region-value");
    expect(value.textContent).not.toMatch(/(^|\D)0(\D|$)/);
    // Availability is carried by the text, not by color alone.
    expect(value.className).toContain("text-warn");
  });
});

// --------------------------------------------------------------------------- //
// Legend
// --------------------------------------------------------------------------- //

describe("floating legend keeps every analytical element", () => {
  it("uses a Korean-only heading with no English duplication", async () => {
    await renderLoaded();
    const legend = screen.getByTestId("legend");
    const heading = within(legend).getByRole("heading", { level: 2 });
    expect(heading.textContent).toContain("범례");
    expect(heading.textContent).not.toContain("(Legend)");
    // The unit still rides on the heading.
    expect(heading.textContent).toContain("persons");
    expect(screen.getByTestId("map-legend-summary").textContent).not.toContain("(Legend)");
  });

  it("preserves the class rows, class numbers, unit, method note, and no-data row", async () => {
    await renderLoaded();
    const rows = screen.getAllByTestId("choropleth-legend-row");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) {
      expect(row.textContent).toContain("급");
      expect(row.textContent).toContain("persons");
    }
    // The classification method note is still rendered verbatim from lib/metrics.ts.
    expect(screen.getByTestId("choropleth-scale-method").textContent).toBeTruthy();
    expect(screen.getByTestId("legend-metric-label").textContent).toContain("인구");
    // An explicit no-data category, never rendered as a 0 class.
    expect(screen.getByTestId("choropleth-legend-nodata").textContent).toContain("데이터 없음");
  });

  it("renders exactly one legend, floating over the map rather than in the sidebar", async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll("details.map-legend")).toHaveLength(1);
    expect(
      container.querySelector("details.mobile-collapsible [data-testid='legend']"),
    ).toBeNull();
  });
});

// --------------------------------------------------------------------------- //
// Loading, error, and structure
// --------------------------------------------------------------------------- //

describe("loading and error presentation", () => {
  it("keeps one concise role=status announcement and marks the skeleton decorative", () => {
    const { container } = render(<Home />);
    const loading = screen.getByTestId("loading");
    expect(loading.getAttribute("role")).toBe("status");
    expect(loading.textContent).toContain("공공자료를 불러오는 중");

    // The structural skeletons are decorative: aria-hidden, so they announce nothing
    // and never compete with the status region.
    const sidebar = screen.getByTestId("loading-skeleton-sidebar");
    const map = screen.getByTestId("loading-skeleton-map");
    expect(sidebar.getAttribute("aria-hidden")).toBe("true");
    expect(map.getAttribute("aria-hidden")).toBe("true");
    // The status announcement is NOT inside an aria-hidden subtree.
    expect(loading.closest("[aria-hidden='true']")).toBeNull();

    // No fabricated content: the skeleton renders neutral bars only — no digits, no
    // region names, no legend classes that could be mistaken for official data.
    expect(sidebar.textContent).toBe("");
    expect(map.textContent).toBe("");
    expect(container.querySelectorAll(".wep-skeleton").length).toBeGreaterThan(0);
    cleanup();
  });

  it("keeps exactly one h1 and exactly one map in the equity view", async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="map-container"]')).toHaveLength(1);
  });

  it("keeps the equity control column an <aside> free of raw technical tokens", async () => {
    const { container } = await renderLoaded();
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    const text = aside?.textContent ?? "";
    for (const token of FORBIDDEN_PRIMARY_TOKENS) {
      expect(text).not.toContain(token);
    }
    expect(text).not.toContain("(Population)");
    expect(text).not.toContain("(Equity)");
  });

  it("keeps the map wrapper sized by .map-pane with the map as its direct child", async () => {
    await renderLoaded();
    const wrapper = screen.getByTestId("map-container").parentElement;
    const tokens = (wrapper?.getAttribute("class") ?? "").split(/\s+/);
    expect(tokens).toContain("map-pane");
    expect(tokens).toContain("min-w-0");
  });
});
