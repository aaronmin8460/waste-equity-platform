// @vitest-environment jsdom

/**
 * MapView vector-tile tests.
 *
 * MapLibre needs WebGL (which jsdom has no business providing), so `maplibre-gl`
 * is replaced with a fake `Map` that records the source/layer/filter/paint calls
 * MapView makes. These assert the suitability grid is wired as a PostGIS vector
 * source (not the old limited GeoJSON fetch): a `type: "vector"` source, tiles
 * pointing at the run+profile `.mvt` template, the `candidates` source-layer,
 * status-driven MapLibre filters, stable score breaks, profile-switch reloads,
 * and click → candidate-detail.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CandidateDetail, RegionBoundaryCollection } from "../lib/api";
import type { ClassLevel } from "../lib/landCover";
import {
  LAND_COVER_COVERAGE_COLORS,
  type LandCoverAvailableClasses,
  type LandCoverVisualizationMode,
  defaultCoverageVisibility,
  landCoverClassColor,
} from "../lib/landCoverLayer";
import type { MapMode, StatusVisibility } from "./MapView";

// Shared recorder for the fake map instances, created before the module mock so
// the (hoisted) factory can push into it.
const h = vi.hoisted(() => ({
  instances: [] as FakeMapLike[],
  popups: [] as { html: string; added: boolean }[],
}));

interface FakeMapLike {
  sources: Record<string, unknown>;
  layerById: Record<string, { id: string; source: string; paint?: Record<string, unknown> } & Record<string, unknown>>;
  layers: string[];
  filters: Record<string, unknown>;
  paint: Record<string, Record<string, unknown>>;
  layout: Record<string, Record<string, unknown>>;
  removedSources: string[];
  removedLayers: string[];
  fire: (event: string, payload?: unknown) => void;
  emitLayer: (event: string, layerId: string, payload: unknown) => void;
  getSource: (id: string) => unknown;
  getLayer: (id: string) => (Record<string, unknown> & { id: string; source: string }) | undefined;
  getCanvas: () => { style: { cursor: string } };
  flyToCalls: unknown[][];
  fitBoundsCalls: unknown[][];
  sourceFeatures: Record<string, { properties?: Record<string, unknown> | null }[]>;
  /**
   * What `queryRenderedFeatures` reports per layer id. Since Phase 1 the region and
   * facility click handling is ONE map-level handler that queries the layers in
   * priority order (see MapView), so a test stages the hit here and fires a plain
   * map click rather than emitting a layer-scoped event.
   */
  renderedFeatures: Record<string, { properties: Record<string, unknown> }[]>;
}

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    sources: Record<string, unknown> = {};
    layerById: Record<string, { id: string; source: string; paint?: Record<string, unknown> }> = {};
    layers: string[] = [];
    filters: Record<string, unknown> = {};
    paint: Record<string, Record<string, unknown>> = {};
    layout: Record<string, Record<string, unknown>> = {};
    removedSources: string[] = [];
    removedLayers: string[] = [];
    handlers: Record<string, Array<(payload?: unknown) => void>> = {};
    layerHandlers: Record<string, Array<(payload?: unknown) => void>> = {};
    canvas = { style: { cursor: "" } };
    renderedFeatures: Record<string, { properties: Record<string, unknown> }[]> = {};

    constructor() {
      h.instances.push(this as unknown as FakeMapLike);
    }
    addControl() {}
    on(event: string, a: unknown, b?: unknown) {
      if (typeof a === "function") {
        (this.handlers[event] ||= []).push(a as (p?: unknown) => void);
      } else {
        (this.layerHandlers[`${event}:${String(a)}`] ||= []).push(b as (p?: unknown) => void);
      }
      return this;
    }
    off() {
      return this;
    }
    fire(event: string, payload?: unknown) {
      (this.handlers[event] || []).forEach((fn) => fn(payload));
    }
    emitLayer(event: string, layerId: string, payload: unknown) {
      (this.layerHandlers[`${event}:${layerId}`] || []).forEach((fn) => fn(payload));
    }
    addSource(id: string, spec: Record<string, unknown>) {
      // Real MapLibre getSource() returns a Source object with setData (used by
      // the GeoJSON region/facility sources on re-render); preserve the spec
      // fields (type, tiles, …) the tests read.
      this.sources[id] = { ...spec, setData: () => {} };
    }
    removeSource(id: string) {
      delete this.sources[id];
      this.removedSources.push(id);
    }
    getSource(id: string) {
      return this.sources[id];
    }
    // Mirrors MapLibre's `addLayer(layer, beforeId)`: with a beforeId the layer is
    // INSERTED before that layer rather than pushed on top, so `layers` really is the
    // paint order and the land-cover stacking assertions are meaningful.
    addLayer(layer: { id: string; source: string }, beforeId?: string) {
      this.layerById[layer.id] = layer;
      const index = beforeId ? this.layers.indexOf(beforeId) : -1;
      if (index >= 0) this.layers.splice(index, 0, layer.id);
      else this.layers.push(layer.id);
    }
    removeLayer(id: string) {
      delete this.layerById[id];
      this.removedLayers.push(id);
      this.layers = this.layers.filter((l) => l !== id);
    }
    getLayer(id: string) {
      return this.layerById[id];
    }
    // Only reports features for layers that EXIST, mirroring MapLibre, so the
    // priority handler's `getLayer` guard is exercised rather than bypassed.
    queryRenderedFeatures(_point: unknown, options?: { layers?: string[] }) {
      const ids = options?.layers ?? Object.keys(this.renderedFeatures);
      return ids.flatMap((id) => (this.getLayer(id) ? (this.renderedFeatures[id] ?? []) : []));
    }
    setFilter(id: string, filter: unknown) {
      this.filters[id] = filter;
    }
    setPaintProperty(id: string, prop: string, value: unknown) {
      (this.paint[id] ||= {})[prop] = value;
    }
    setLayoutProperty(id: string, prop: string, value: unknown) {
      (this.layout[id] ||= {})[prop] = value;
    }
    getBounds() {
      return {
        getWest: () => 125,
        getSouth: () => 36,
        getEast: () => 128,
        getNorth: () => 39,
      };
    }
    getCenter() {
      return { lng: 126.9, lat: 37.5 };
    }
    getZoom() {
      return 8;
    }
    getCanvas() {
      return this.canvas;
    }
    // Tile features MapView reads to discover the official class vocabulary. Tests
    // set this to a synthetic feature list; the default is an empty tile set.
    sourceFeatures: Record<string, { properties?: Record<string, unknown> | null }[]> = {};
    querySourceFeatures(sourceId: string) {
      return this.sourceFeatures[sourceId] ?? [];
    }
    flyToCalls: unknown[][] = [];
    fitBoundsCalls: unknown[][] = [];
    flyTo(...args: unknown[]) {
      this.flyToCalls.push(args);
    }
    fitBounds(...args: unknown[]) {
      this.fitBoundsCalls.push(args);
    }
    remove() {}
  }
  class FakePopup {
    html = "";
    added = false;
    // Accepts the real Popup's options arg (ignored); an implicit constructor
    // already tolerates it, so no explicit parameter is needed.
    setLngLat() {
      return this;
    }
    setHTML(html: string) {
      this.html = html;
      return this;
    }
    addTo() {
      this.added = true;
      h.popups.push(this as unknown as { html: string; added: boolean });
      return this;
    }
    remove() {
      this.added = false;
      return this;
    }
  }
  class FakeNavigationControl {}
  return { default: { Map: FakeMap, Popup: FakePopup, NavigationControl: FakeNavigationControl } };
});

// Import AFTER the mock is registered.
import MapView, { regionPopupHtml, wetlandPopupHtml } from "./MapView";

const EMPTY_BOUNDARIES: RegionBoundaryCollection = {
  type: "FeatureCollection",
  reference_year: 2024,
  count: 0,
  features: [],
};

const DEFAULT_VISIBILITY: StatusVisibility = {
  ELIGIBLE: true,
  REVIEW_REQUIRED: true,
  EXCLUDED: false,
};

const BASELINE_TILE_URL =
  "http://localhost:8000/api/v1/suitability/tiles/47/baseline/{z}/{x}/{y}.mvt";

const WETLAND_TILE_URL =
  "http://localhost:8000/api/v1/environment/wetlands/tiles/{z}/{x}/{y}.mvt";

/**
 * Version-pinned land-cover tile template. `/tiles/1/` is the immutable LC3 statistics
 * version — the whole point of the URL contract.
 */
const LAND_COVER_TILE_URL =
  "http://localhost:8000/api/v1/environment/land-cover/cell-statistics/tiles/1/{z}/{x}/{y}.mvt";

/**
 * SYNTHETIC TEST FIXTURE — not official data. Three cells covering the three coverage
 * states, with dominant classes at all three official levels for the covered ones and
 * none at all for the uncovered one.
 */
const LAND_COVER_TILE_FEATURES = [
  {
    properties: {
      candidate_key: "capital-grid-500m-v1:1_1",
      coverage_status: "COMPLETE_EXACT",
      coverage_ratio: 1,
      dominant_l1_code: "300",
      dominant_l1_name: "산림지역",
      dominant_l2_code: "310",
      dominant_l2_name: "활엽수림",
      dominant_l3_code: "311",
      dominant_l3_name: "활엽수림",
    },
  },
  {
    properties: {
      candidate_key: "capital-grid-500m-v1:1_2",
      coverage_status: "PARTIAL",
      coverage_ratio: 0.5,
      dominant_l1_code: "100",
      dominant_l1_name: "시가화건조지역",
      dominant_l2_code: "150",
      dominant_l2_name: "교통지역",
      dominant_l3_code: "154",
      dominant_l3_name: "도로",
    },
  },
  {
    // A NO_COVERAGE cell genuinely carries NO dominant-class property at any level:
    // ST_AsMVT omits NULL properties, exactly as the backend tile does.
    properties: {
      candidate_key: "capital-grid-500m-v1:1_3",
      coverage_status: "NO_COVERAGE",
      coverage_ratio: 0,
    },
  },
];

const LAND_COVER_CLASSES = {
  1: [
    { code: "100", name: "시가화건조지역" },
    { code: "300", name: "산림지역" },
  ],
  2: [
    { code: "150", name: "교통지역" },
    { code: "310", name: "활엽수림" },
  ],
  3: [
    { code: "154", name: "도로" },
    { code: "311", name: "활엽수림" },
  ],
};

function baseProps(overrides: Partial<React.ComponentProps<typeof MapView>> = {}) {
  return {
    boundaries: EMPTY_BOUNDARIES,
    regionValues: new Map(),
    breaks: [] as number[],
    palette: ["#ffffff"] as readonly string[],
    metricLabel: "지표",
    metricUnit: "u",
    metricReferencePeriod: "2024",
    facilities: [],
    showFacilities: false,
    mode: "suitability" as MapMode,
    showWetlands: false,
    wetlandTileUrl: WETLAND_TILE_URL,
    wetlandTypeVisibility: {
      하천습지: true,
      호수습지: true,
      산지습지: true,
      인공습지: true,
    },
    wetlandDesignationOnly: false,
    // The land-cover layer is OFF by default, exactly as the page mounts it.
    showLandCover: false,
    landCoverTileUrl: LAND_COVER_TILE_URL,
    landCoverMode: "coverage" as LandCoverVisualizationMode,
    landCoverClassLevel: 1 as ClassLevel,
    landCoverCoverage: defaultCoverageVisibility(),
    landCoverHiddenClassCodes: [] as readonly string[],
    landCoverClasses: LAND_COVER_CLASSES as LandCoverAvailableClasses,
    onLandCoverClassesChange: undefined as
      | ((classes: LandCoverAvailableClasses) => void)
      | undefined,
    candidateTileUrl: BASELINE_TILE_URL,
    candidateBreaks: [20, 40, 60, 80] as readonly number[],
    statusVisibility: DEFAULT_VISIBILITY,
    stableOnly: false,
    selectedCandidate: null as CandidateDetail | null,
    onCandidateClick: vi.fn(),
    ariaLabel: "지도",
    ariaDescription: "인터랙티브 지도",
    ...overrides,
  };
}

/** Render, then fire the map "load" event so the refresh builds the layers. */
function renderAndLoad(props: React.ComponentProps<typeof MapView>) {
  const utils = render(<MapView {...props} />);
  const map = h.instances[h.instances.length - 1];
  act(() => map.fire("load"));
  return { ...utils, map };
}

afterEach(() => {
  cleanup();
  h.instances.length = 0;
  h.popups.length = 0;
});

describe("MapView suitability vector source", () => {
  it("creates a vector source whose tiles are the run+profile .mvt template", () => {
    const { map } = renderAndLoad(baseProps());
    const source = map.getSource("candidates") as {
      type: string;
      tiles: string[];
      minzoom: number;
      maxzoom: number;
    };
    expect(source).toBeDefined();
    expect(source.type).toBe("vector");
    expect(source.tiles).toEqual([BASELINE_TILE_URL]);
    // Immutable run + profile in the URL, and the XYZ .mvt template.
    expect(source.tiles[0]).toContain("/api/v1/suitability/tiles/47/baseline/");
    expect(source.tiles[0]).toContain("{z}/{x}/{y}.mvt");
    // Never the old limited GeoJSON candidate fetch.
    expect(source.tiles[0]).not.toContain("limit=2000");
    expect(source.tiles[0]).not.toContain("/candidates?");
  });

  it("binds candidate layers to the `candidates` source-layer", () => {
    const { map } = renderAndLoad(baseProps());
    const fill = map.getLayer("candidates-fill");
    const outline = map.getLayer("candidates-review-outline");
    expect(fill).toBeDefined();
    expect(outline).toBeDefined();
    expect(fill!.source).toBe("candidates");
    expect(fill!["source-layer"]).toBe("candidates");
    expect(outline!["source-layer"]).toBe("candidates");
  });

  it("colors eligible cells with the stable [20,40,60,80] score breaks", () => {
    const { map } = renderAndLoad(baseProps());
    const fillColor = JSON.stringify(map.paint["candidates-fill"]["fill-color"]);
    // The step reads the tile `score` attribute against the fixed thresholds.
    expect(fillColor).toContain('"score"');
    for (const threshold of [20, 40, 60, 80]) {
      expect(fillColor).toContain(String(threshold));
    }
  });

  it("filters the layer by status, hiding EXCLUDED by default", () => {
    const { map } = renderAndLoad(baseProps());
    const filter = JSON.stringify(map.filters["candidates-fill"]);
    expect(filter).toContain("ELIGIBLE");
    expect(filter).toContain("REVIEW_REQUIRED");
    expect(filter).not.toContain("EXCLUDED");
  });

  it("updates the MapLibre filter when a status checkbox changes", () => {
    const props = baseProps();
    const { map, rerender } = renderAndLoad(props);
    expect(JSON.stringify(map.filters["candidates-fill"])).not.toContain("EXCLUDED");
    // Enable EXCLUDED (as the sidebar checkbox would).
    rerender(
      <MapView
        {...props}
        statusVisibility={{ ELIGIBLE: true, REVIEW_REQUIRED: true, EXCLUDED: true }}
      />,
    );
    expect(JSON.stringify(map.filters["candidates-fill"])).toContain("EXCLUDED");
  });

  it("reloads the vector source when the profile (tile URL) changes", () => {
    const props = baseProps();
    const { map, rerender } = renderAndLoad(props);
    const accessUrl =
      "http://localhost:8000/api/v1/suitability/tiles/47/access_focused/{z}/{x}/{y}.mvt";
    rerender(<MapView {...props} candidateTileUrl={accessUrl} />);
    // The old source is torn down and a new one added at the new immutable URL.
    expect(map.removedSources).toContain("candidates");
    const source = map.getSource("candidates") as { tiles: string[] };
    expect(source.tiles).toEqual([accessUrl]);
    expect(source.tiles[0]).toContain("access_focused");
  });

  it("requests candidate detail when a tile feature is clicked", () => {
    const onCandidateClick = vi.fn();
    const { map } = renderAndLoad(baseProps({ onCandidateClick }));
    map.emitLayer("click", "candidates-fill", {
      features: [
        {
          properties: {
            candidate_id: 4242,
            candidate_key: "capital-grid-500m-v1:1_1",
            status: "ELIGIBLE",
            score: 80,
            rank: 1,
            sigungu_region_name: "강화군",
          },
        },
      ],
      lngLat: { lng: 126.2, lat: 37.7 },
    });
    expect(onCandidateClick).toHaveBeenCalledWith(4242);
  });

  it("does not create a candidate source in equity mode (no run URL)", () => {
    const { map } = renderAndLoad(baseProps({ mode: "equity", candidateTileUrl: null }));
    expect(map.getSource("candidates")).toBeUndefined();
    expect(map.getLayer("candidates-fill")).toBeUndefined();
  });

  it("adds a distinct stable-outline layer filtered to stable ELIGIBLE cells", () => {
    const { map } = renderAndLoad(baseProps());
    const stable = map.getLayer("candidates-stable-outline");
    expect(stable).toBeDefined();
    expect(stable!["source-layer"]).toBe("candidates");
    const filter = JSON.stringify(map.filters["candidates-stable-outline"]);
    expect(filter).toContain("ELIGIBLE");
    expect(filter).toContain("stable_count");
    // The selected-candidate highlight is layered above the stable outline.
    // (candidates-stable-outline is added with the candidate layers; the
    //  selected-candidate layers are added later, so they stay on top.)
  });

  it("restricts ELIGIBLE cells to stable ones when stableOnly is enabled", () => {
    const props = baseProps();
    const { map, rerender } = renderAndLoad(props);
    // Off: the fill filter is just the status filter (no stable_count restriction).
    expect(JSON.stringify(map.filters["candidates-fill"])).not.toContain("stable_count");
    rerender(<MapView {...props} stableOnly={true} />);
    const filter = JSON.stringify(map.filters["candidates-fill"]);
    // On: eligible cells now require stable_count == 3, while other statuses are
    // still governed by the status filter (never reclassified as unstable).
    expect(filter).toContain("stable_count");
    expect(filter).toContain("ELIGIBLE");
    expect(filter).toContain("REVIEW_REQUIRED");
  });
});

/**
 * Stage what is under the pointer and fire ONE map click, which is how the app now
 * routes region/facility clicks: a single map-level handler queries the layers in
 * priority order (facility > wetland > region) so a marker drawn over the region
 * fill can no longer trigger both. Emitting a layer-scoped event, as these tests
 * used to, would bypass exactly the code the priority rule lives in.
 */
function clickMap(
  map: FakeMapLike,
  hits: Record<string, { properties: Record<string, unknown> }[]>,
  lngLat: { lng: number; lat: number } = { lng: 126.98, lat: 37.57 },
) {
  map.renderedFeatures = hits;
  map.fire("click", { point: { x: 12, y: 34 }, lngLat });
}

describe("MapView accessibility", () => {
  it("labels the map container as a region with a linked textual description", () => {
    renderAndLoad(
      baseProps({
        ariaLabel: "지역 지표 지도 — 인구",
        ariaDescription: "지역을 클릭하면 좌측 '선택한 지역' 요약에 값이 표시됩니다.",
      }),
    );
    const container = screen.getByTestId("map-container");
    // A named landmark, not a bare canvas — screen readers announce it and can
    // navigate to it.
    expect(container.getAttribute("role")).toBe("region");
    expect(container.getAttribute("aria-label")).toBe("지역 지표 지도 — 인구");
    // The description is a real element referenced by aria-describedby.
    expect(container.getAttribute("aria-describedby")).toBe("map-accessible-description");
    const description = document.getElementById("map-accessible-description");
    expect(description).not.toBeNull();
    expect(description!.textContent).toContain("선택한 지역");
  });

  it("reports the clicked region's CODE (page state derives the summary, no value snapshot)", () => {
    const onRegionClick = vi.fn();
    const { map } = renderAndLoad(baseProps({ mode: "equity", onRegionClick }));
    clickMap(map, {
      "regions-fill": [
        {
          properties: {
            region_code: "KR-SGIS-11110",
            region_name: "종로구",
            metric_label: "인구 (Population)",
            metric_display: "142,000 persons",
            has_value: "true",
            geometry_kind: "NATIVE",
            child_region_names: "[]",
            source_id: "sgis",
            boundary_reference_period: "2024",
          },
        },
      ],
    });
    // Only the stable region identity crosses the boundary — the metric label and
    // value are NOT passed, so a later metric change re-derives them in page state
    // instead of leaving a stale snapshot on the callback.
    expect(onRegionClick).toHaveBeenCalledTimes(1);
    expect(onRegionClick).toHaveBeenCalledWith("KR-SGIS-11110");
  });

  it("pins a popup carrying the served value on a region click (mobile tap path)", () => {
    const { map } = renderAndLoad(baseProps({ mode: "equity", onRegionClick: vi.fn() }));
    clickMap(map, {
      "regions-fill": [
        {
          properties: {
            region_code: "KR-RCIS-CITY-GOYANG",
            region_name: "고양시",
            metric_label: "생활계 폐기물 발생량",
            // The choropleth builds this text for a region with no served value;
            // the pinned popup forwards it verbatim, never a fabricated 0.
            metric_display: "데이터 없음 — 출처에서 해당 지역·항목을 보고하지 않음",
            has_value: "false",
            geometry_kind: "DERIVED",
            child_region_names: JSON.stringify(["덕양구", "일산동구", "일산서구"]),
            source_id: "rcis",
            boundary_reference_period: "2024",
          },
        },
      ],
    }, { lng: 126.8, lat: 37.65 });
    const popup = h.popups[h.popups.length - 1];
    expect(popup.added).toBe(true);
    expect(popup.html).toContain("고양시");
    expect(popup.html).toContain("데이터 없음");
    expect(popup.html).toContain("덕양구·일산동구·일산서구");
  });
});

const SERVED_REGION_PROPS = {
  region_code: "KR-SGIS-11110",
  region_name: "종로구",
  metric_label: "인구 (Population)",
  metric_display: "142,000 persons",
  has_value: "true",
  metric_reference_period: "2024",
  source_id: "sgis",
  boundary_reference_period: "2024",
  geometry_kind: "NATIVE",
};

describe("region tooltip content (Phase 3)", () => {
  it("builds a popup with name, metric label, exact value, unit, and reference period", () => {
    const html = regionPopupHtml(SERVED_REGION_PROPS);
    expect(html).toContain("종로구");
    expect(html).toContain("인구 (Population)");
    expect(html).toContain("142,000 persons");
    // Since Phase 1 provenance renders as a labelled ROW (two spans), so the old
    // "label: value" text run no longer exists. Both halves must still be present.
    expect(html).toContain("지표 기준 기간");
    expect(html).toContain("경계 기준");
    expect(html).toContain("sgis (2024)");
    // A served value carries no "no served value" availability line.
    expect(html).not.toContain("데이터 없음");
  });

  it("shows the no-data availability status (never a fabricated value) with the derived note", () => {
    const html = regionPopupHtml({
      region_name: "고양시",
      metric_label: "생활계 폐기물 발생량",
      metric_display: "데이터 없음 — 출처에서 해당 지역·항목을 보고하지 않음",
      has_value: "false",
      metric_reference_period: "2022",
      source_id: "rcis",
      boundary_reference_period: "2024",
      geometry_kind: "DERIVED",
      child_region_names: JSON.stringify(["덕양구", "일산동구"]),
    });
    // metric_display already conveys the no-data availability (never a 0).
    expect(html).toContain("데이터 없음 — 출처에서 해당 지역·항목을 보고하지 않음");
    expect(html).toContain("통계 보고 단위");
    expect(html).toContain("시 (city)");
    expect(html).toContain("덕양구·일산동구");
  });
});

describe("region hover tooltip interaction (Phase 3)", () => {
  it("opens a hover tooltip on mousemove and removes it on mouseleave", () => {
    const { map } = renderAndLoad(baseProps({ mode: "equity", candidateTileUrl: null }));
    map.emitLayer("mousemove", "regions-fill", {
      features: [{ properties: SERVED_REGION_PROPS }],
      lngLat: { lng: 126.98, lat: 37.57 },
    });
    // Cursor becomes a pointer and a tooltip popup is added with the same content.
    expect(map.getCanvas().style.cursor).toBe("pointer");
    const popup = h.popups[h.popups.length - 1];
    expect(popup.added).toBe(true);
    expect(popup.html).toContain("종로구");
    expect(popup.html).toContain("지표 기준 기간");
    expect(popup.html).toContain("2024");
    // Leaving the region resets the cursor and removes the tooltip.
    map.emitLayer("mouseleave", "regions-fill", {});
    expect(map.getCanvas().style.cursor).toBe("");
    expect(popup.added).toBe(false);
  });

  it("includes the reference period in the tap/click popup too (mobile path)", () => {
    const { map } = renderAndLoad(baseProps({ mode: "equity", onRegionClick: vi.fn() }));
    clickMap(map, { "regions-fill": [{ properties: SERVED_REGION_PROPS }] });
    const popup = h.popups[h.popups.length - 1];
    expect(popup.html).toContain("종로구");
    expect(popup.html).toContain("지표 기준 기간");
    expect(popup.html).toContain("2024");
  });

  it("rebuilds the hover tooltip when the metric changes while hovering one region", () => {
    const props = baseProps({ mode: "equity", candidateTileUrl: null, metricReferencePeriod: "2022" });
    const { map, rerender } = renderAndLoad(props);
    map.emitLayer("mousemove", "regions-fill", {
      features: [{ properties: { ...SERVED_REGION_PROPS, metric_reference_period: "2022" } }],
      lngLat: { lng: 126.98, lat: 37.57 },
    });
    expect(h.popups[h.popups.length - 1].html).toContain("2022");

    // The metric changes (a new reference period) → a refresh re-stamps the source
    // AND resets the hover cache, so the next mousemove over the SAME region shows
    // the new value rather than the cached one.
    rerender(<MapView {...props} metricReferencePeriod="2024" />);
    map.emitLayer("mousemove", "regions-fill", {
      features: [{ properties: { ...SERVED_REGION_PROPS, metric_reference_period: "2024" } }],
      lngLat: { lng: 126.98, lat: 37.57 },
    });
    expect(h.popups[h.popups.length - 1].html).toContain("지표 기준 기간");
    expect(h.popups[h.popups.length - 1].html).toContain("2024");
    expect(h.popups[h.popups.length - 1].html).not.toContain("2022");
  });
});

describe("map loading + candidate refresh feedback", () => {
  it("shows an initial map-loading status until the map's load event fires", () => {
    render(<MapView {...baseProps()} />);
    // Before load: an accessible status overlay communicates initialization.
    const loading = screen.getByTestId("map-loading");
    expect(loading.getAttribute("role")).toBe("status");
    expect(loading.textContent).toContain("지도를 불러오는 중");
    // After the map loads it is removed (never blocks interaction afterwards).
    const map = h.instances[h.instances.length - 1];
    act(() => map.fire("load"));
    expect(screen.queryByTestId("map-loading")).toBeNull();
  });

  it("shows the candidate tile-refresh status until the source loads, and again on a profile switch", () => {
    const props = baseProps();
    const { map, rerender } = renderAndLoad(props);
    // Entering suitability adds the candidate source → the refresh status appears.
    expect(screen.getByTestId("candidate-loading")).toBeDefined();
    expect(screen.getByTestId("candidate-loading").textContent).toContain("후보지 타일");
    // The source finishes loading its viewport tiles → the indicator clears.
    act(() => map.fire("sourcedata", { sourceId: "candidates", isSourceLoaded: true }));
    expect(screen.queryByTestId("candidate-loading")).toBeNull();
    // Switching profile re-points the source → the indicator returns…
    const accessUrl =
      "http://localhost:8000/api/v1/suitability/tiles/47/access_focused/{z}/{x}/{y}.mvt";
    rerender(<MapView {...props} candidateTileUrl={accessUrl} />);
    expect(screen.getByTestId("candidate-loading")).toBeDefined();
    // …and the map reaching idle clears it even if the viewport holds no tiles.
    act(() => map.fire("idle"));
    expect(screen.queryByTestId("candidate-loading")).toBeNull();
  });

  it("never shows the candidate refresh status in equity mode (no run tiles)", () => {
    renderAndLoad(baseProps({ mode: "equity", candidateTileUrl: null }));
    expect(screen.queryByTestId("candidate-loading")).toBeNull();
  });
});

describe("region popup lifecycle (no stale metric values)", () => {
  const clickRegion = (map: FakeMapLike) =>
    clickMap(map, { "regions-fill": [{ properties: SERVED_REGION_PROPS }] });

  it("removes the pinned popup when the metric changes (sidebar selection is unaffected)", () => {
    const props = baseProps({ mode: "equity", candidateTileUrl: null, metricLabel: "인구 (Population)" });
    const { map, rerender } = renderAndLoad(props);
    clickRegion(map);
    const pinned = h.popups[h.popups.length - 1];
    expect(pinned.added).toBe(true);
    // A metric change closes the on-map pin so it cannot show the old label/value.
    rerender(<MapView {...props} metricLabel="생활계 폐기물 발생량" />);
    expect(pinned.added).toBe(false);
  });

  it("replaces the previous pin on a second click (no abandoned popups accumulate)", () => {
    const { map } = renderAndLoad(baseProps({ mode: "equity", candidateTileUrl: null }));
    clickRegion(map);
    const first = h.popups[h.popups.length - 1];
    clickRegion(map);
    const second = h.popups[h.popups.length - 1];
    expect(first).not.toBe(second);
    expect(first.added).toBe(false); // the earlier pin was removed
    expect(second.added).toBe(true);
  });

  it("closes a visible hover tooltip immediately when the metric changes", () => {
    const props = baseProps({ mode: "equity", candidateTileUrl: null });
    const { map, rerender } = renderAndLoad(props);
    map.emitLayer("mousemove", "regions-fill", {
      features: [{ properties: SERVED_REGION_PROPS }],
      lngLat: { lng: 126.98, lat: 37.57 },
    });
    const hover = h.popups[h.popups.length - 1];
    expect(hover.added).toBe(true);
    rerender(<MapView {...props} metricLabel="생활계 폐기물 발생량" metricReferencePeriod="2022" />);
    // The stale tooltip is closed (recreated on the next mousemove).
    expect(hover.added).toBe(false);
  });

  it("removes both popups on unmount", () => {
    const { map, unmount } = renderAndLoad(baseProps({ mode: "equity", candidateTileUrl: null }));
    clickRegion(map);
    map.emitLayer("mousemove", "regions-fill", {
      features: [{ properties: SERVED_REGION_PROPS }],
      lngLat: { lng: 126.98, lat: 37.57 },
    });
    const pinned = h.popups.find((p) => p.html.includes("경계 기준") && p.added);
    expect(pinned).toBeDefined();
    unmount();
    expect(h.popups.every((p) => p.added === false)).toBe(true);
  });
});

describe("candidate + facility interactions still work", () => {
  const FACILITY = {
    facility_name: "종로 소각장",
    facility_category: "INCINERATION",
    address: "서울 종로구 1-1",
    longitude: 126.98,
    latitude: 37.57,
    throughput_quantity: "1234.5",
    throughput_unit: "톤/년",
    source_id: "waste_statistics",
    reference_period: "2022",
  } as unknown as import("../lib/api").FacilityItem;

  const FACILITY_HIT = {
    properties: {
      facility_name: "종로 소각장",
      category_label: "공공 소각시설",
      throughput: "1,234.5 톤/년",
      address: "서울 종로구 1-1",
      source_id: "waste_statistics",
      reference_period: "2022",
    },
  };

  const facilityProps = () =>
    baseProps({ mode: "equity", candidateTileUrl: null, showFacilities: true, facilities: [FACILITY] });

  it("opens a facility popup when a facility point is clicked", () => {
    const { map } = renderAndLoad(facilityProps());
    clickMap(map, { "facilities-points": [FACILITY_HIT] });
    const popup = h.popups[h.popups.length - 1];
    expect(popup.added).toBe(true);
    expect(popup.html).toContain("종로 소각장");
    expect(popup.html).toContain("연간 처리량: 1,234.5 톤/년");
  });

  /**
   * REGRESSION — the facility marker click-through defect.
   *
   * A marker is drawn ON TOP of the region fill, so a click used to reach both
   * layer handlers: the facility opened its popup, the region opened a SECOND one
   * over it, and the region selection changed even though the reader had aimed at
   * a 4.5px dot. The three tests below pin each half of the fix.
   */
  describe("a facility marker does not fall through to the region beneath it", () => {
    it("does not select the underlying region", () => {
      const onRegionClick = vi.fn();
      const { map } = renderAndLoad({ ...facilityProps(), onRegionClick });
      clickMap(map, {
        "facilities-points": [FACILITY_HIT],
        "regions-fill": [{ properties: SERVED_REGION_PROPS }],
      });
      expect(onRegionClick).not.toHaveBeenCalled();
    });

    it("opens ONE popup carrying both the region's value and the facility", () => {
      const before = h.popups.length;
      const { map } = renderAndLoad({ ...facilityProps(), onRegionClick: vi.fn() });
      clickMap(map, {
        "facilities-points": [FACILITY_HIT],
        "regions-fill": [{ properties: SERVED_REGION_PROPS }],
      });
      // Exactly one popup was constructed for the click, not one per layer.
      const opened = h.popups.slice(before).filter((p) => p.added);
      expect(opened).toHaveLength(1);
      // …and it is the COMBINED popup the design specifies: the region's active
      // indicator value AND the facility's own details, in one card.
      expect(opened[0].html).toContain("종로구");
      expect(opened[0].html).toContain("142,000 persons");
      expect(opened[0].html).toContain("종로 소각장");
      expect(opened[0].html).toContain("공공 소각시설");
    });

    it("still selects the region when the region itself is clicked", () => {
      const onRegionClick = vi.fn();
      const { map } = renderAndLoad({ ...facilityProps(), onRegionClick });
      clickMap(map, { "regions-fill": [{ properties: SERVED_REGION_PROPS }] });
      expect(onRegionClick).toHaveBeenCalledWith("KR-SGIS-11110");
      const popup = h.popups[h.popups.length - 1];
      expect(popup.html).toContain("종로구");
      // No facility was the target, so the popup carries no facility block.
      expect(popup.html).not.toContain("종로 소각장");
    });

    it("leaves a wetland click to the wetland handler alone", () => {
      const onRegionClick = vi.fn();
      const { map } = renderAndLoad({
        ...facilityProps(),
        onRegionClick,
        showWetlands: true,
        wetlandTileUrl: "http://localhost:8000/api/v1/environment/wetlands/tiles/{z}/{x}/{y}.mvt",
      });
      clickMap(map, {
        "wetlands-fill": [{ properties: { wetland_name: "밤섬" } }],
        "regions-fill": [{ properties: SERVED_REGION_PROPS }],
      });
      // The wetland layer owns its own popup; the region path must not add a second
      // one, nor change the canonical selection.
      expect(onRegionClick).not.toHaveBeenCalled();
    });
  });

  it("highlights and moves the map to a selected candidate (list/map selection)", () => {
    const props = baseProps();
    const { map, rerender } = renderAndLoad(props);
    const selectedCandidate = {
      candidate_id: 4242,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [126.4, 37.7],
            [126.41, 37.7],
            [126.41, 37.71],
            [126.4, 37.71],
            [126.4, 37.7],
          ],
        ],
      },
    } as unknown as import("../lib/api").CandidateDetail;
    rerender(<MapView {...props} selectedCandidate={selectedCandidate} />);
    // The highlight source + layers are wired…
    expect(map.getSource("selected-candidate")).toBeDefined();
    expect(map.getLayer("selected-candidate-fill")).toBeDefined();
    expect(map.getLayer("selected-candidate-outline")).toBeDefined();
    // …and the map is moved to bring the (polygon) candidate into view.
    expect(map.fitBoundsCalls.length).toBeGreaterThan(0);
  });
});

describe("MapView inland-wetland layer", () => {
  it("creates a `wetlands` vector source bound to the wetlands source-layer", () => {
    const { map } = renderAndLoad(baseProps());
    const source = map.getSource("wetlands") as { type: string; tiles: string[]; maxzoom: number };
    expect(source).toBeDefined();
    expect(source.type).toBe("vector");
    expect(source.tiles).toEqual([WETLAND_TILE_URL]);
    expect(source.tiles[0]).toContain("/api/v1/environment/wetlands/tiles/");
    const fill = map.getLayer("wetlands-fill");
    expect(fill!.source).toBe("wetlands");
    expect(fill!["source-layer"]).toBe("wetlands");
    expect(map.getLayer("wetlands-outline")).toBeDefined();
  });

  it("stacks the wetland layer BELOW the candidate layers", () => {
    const { map } = renderAndLoad(baseProps());
    expect(map.layers.indexOf("wetlands-fill")).toBeLessThan(map.layers.indexOf("candidates-fill"));
  });

  it("is OFF by default (visibility none) and turns on with showWetlands", () => {
    const { map, rerender } = renderAndLoad(baseProps());
    expect(map.layout["wetlands-fill"].visibility).toBe("none");
    expect(map.layout["wetlands-outline"].visibility).toBe("none");
    rerender(<MapView {...baseProps({ showWetlands: true })} />);
    expect(map.layout["wetlands-fill"].visibility).toBe("visible");
    expect(map.layout["wetlands-outline"].visibility).toBe("visible");
  });

  it("filters by wetland type (a disabled type is dropped from the filter)", () => {
    const { map } = renderAndLoad(
      baseProps({
        showWetlands: true,
        wetlandTypeVisibility: { 하천습지: true, 호수습지: false, 산지습지: true, 인공습지: true },
      }),
    );
    const filter = JSON.stringify(map.filters["wetlands-fill"]);
    expect(filter).toContain("하천습지");
    expect(filter).not.toContain("호수습지");
  });

  it("restricts to features with a designation note when designationOnly is set", () => {
    const { map } = renderAndLoad(baseProps({ showWetlands: true, wetlandDesignationOnly: true }));
    const filter = JSON.stringify(map.filters["wetlands-fill"]);
    expect(filter).toContain("has");
    expect(filter).toContain("designation_note");
  });

  it("wetlandPopupHtml carries type, area, provider, reference date, and both disclaimers", () => {
    const html = wetlandPopupHtml({
      wetland_name: "테스트 습지",
      wetland_type: "하천습지",
      reported_area_m2: 12345,
      designation_note: "습지보호지역(환경부지정)",
    });
    expect(html).toContain("테스트 습지");
    expect(html).toContain("습지 유형: 하천습지");
    expect(html).toContain("12,345 m²");
    // designation note appears only as labelled source text, never as legal status.
    expect(html).toContain("원자료 지정 메모: 습지보호지역(환경부지정)");
    expect(html).toContain("제공기관: 국립생태원");
    expect(html).toContain("기준일: 2022-07-20");
    expect(html).toContain("법정 습지보호지역을 뜻하지 않습니다");
    expect(html).toContain("UM901 보호구역 레이어에서 별도로 확인");
    // No score / exclusion / legal-eligibility language.
    expect(html).not.toContain("점수");
    expect(html).not.toContain("제외");
    expect(html).not.toContain("입지");
  });

  it("wetlandPopupHtml adds source 시도/시군구 and address once detail is known", () => {
    const detail = {
      id: 1,
      wetland_code: "X",
      wetland_name: "테스트 습지",
      wetland_type: "하천습지",
      reported_area_m2: 100,
      source_address: "서울특별시 종로구 청운동",
      source_sido_name: "서울특별시",
      source_sigungu_name: "종로구",
      source_eupmyeondong_name: "청운동",
      designation_note: null,
      designation_note_label: "원자료 지정 메모",
      source_reference_date: "2022-07-20",
      statutory_status_statement: "…",
      um901_distinction_statement: "…",
    } as import("../lib/api").WetlandFeatureDetail;
    const html = wetlandPopupHtml({ wetland_name: "테스트 습지" }, detail);
    expect(html).toContain("출처 시도/시군구: 서울특별시 종로구");
    expect(html).toContain("주소: 서울특별시 종로구 청운동");
  });

  it("clicking a wetland opens a popup built from the tile attributes", () => {
    const { map } = renderAndLoad(baseProps({ showWetlands: true }));
    // No `id` on the feature, so no detail fetch fires — the immediate popup only.
    map.emitLayer("click", "wetlands-fill", {
      features: [
        {
          properties: {
            wetland_name: "한강 밤섬",
            wetland_type: "하천습지",
            reported_area_m2: 273503,
          },
        },
      ],
      lngLat: { lng: 126.9, lat: 37.5 },
    });
    const popup = h.popups[h.popups.length - 1];
    expect(popup.added).toBe(true);
    expect(popup.html).toContain("한강 밤섬");
    expect(popup.html).toContain("습지 유형: 하천습지");
    expect(popup.html).toContain("법정 습지보호지역을 뜻하지 않습니다");
  });
});

describe("MapView land-cover candidate-cell layer (Phase 1B-LC5B)", () => {
  const FILL = "land-cover-cells-fill";
  const OUTLINES = [
    "land-cover-cells-complete-outline",
    "land-cover-cells-partial-outline",
    "land-cover-cells-nocoverage-outline",
  ];

  it("creates a vector source whose tiles are the VERSION-PINNED .mvt template", () => {
    const { map } = renderAndLoad(baseProps({ showLandCover: true }));
    const source = map.getSource("land-cover-cells") as {
      type: string;
      tiles: string[];
      maxzoom: number;
    };
    expect(source).toBeDefined();
    expect(source.type).toBe("vector");
    expect(source.tiles).toEqual([LAND_COVER_TILE_URL]);
    // The immutable statistics version is in the path, and the XYZ .mvt template.
    expect(source.tiles[0]).toContain("/cell-statistics/tiles/1/");
    expect(source.tiles[0]).toContain("{z}/{x}/{y}.mvt");
    // NEVER the paginated JSON cell list, and never a raw land-cover feature endpoint.
    expect(source.tiles[0]).not.toContain("/cells?");
    expect(source.tiles[0]).not.toContain("limit=");
    expect(source.tiles[0]).not.toContain("features");
  });

  it("binds every land-cover layer to the `land_cover_cells` source-layer", () => {
    const { map } = renderAndLoad(baseProps({ showLandCover: true }));
    for (const id of [FILL, ...OUTLINES]) {
      const layer = map.getLayer(id);
      expect(layer, id).toBeDefined();
      expect(layer!.source).toBe("land-cover-cells");
      expect(layer!["source-layer"]).toBe("land_cover_cells");
    }
  });

  it("is OFF by default (visibility none) and turns on with showLandCover", () => {
    const props = baseProps();
    const { map, rerender } = renderAndLoad(props);
    // The source is still created (so toggling is instant), but nothing is drawn.
    expect(map.getSource("land-cover-cells")).toBeDefined();
    for (const id of [FILL, ...OUTLINES]) {
      expect(map.layout[id]["visibility"], id).toBe("none");
    }
    rerender(<MapView {...props} showLandCover={true} />);
    for (const id of [FILL, ...OUTLINES]) {
      expect(map.layout[id]["visibility"], id).toBe("visible");
    }
  });

  it("does not create the source at all when no release resolved (null tile URL)", () => {
    const { map } = renderAndLoad(
      baseProps({ showLandCover: true, landCoverTileUrl: null }),
    );
    expect(map.getSource("land-cover-cells")).toBeUndefined();
    expect(map.getLayer(FILL)).toBeUndefined();
    // The suitability layer is untouched — a missing land-cover release is isolated.
    expect(map.getSource("candidates")).toBeDefined();
    expect(map.getLayer("candidates-fill")).toBeDefined();
  });

  it("does not re-create the source or layers on an unrelated re-render", () => {
    const props = baseProps({ showLandCover: true });
    const { map, rerender } = renderAndLoad(props);
    const layerCount = map.layers.filter((id) => id.startsWith("land-cover-cells")).length;
    rerender(<MapView {...props} showFacilities={true} />);
    rerender(<MapView {...props} showFacilities={false} />);
    expect(map.removedSources).not.toContain("land-cover-cells");
    expect(map.layers.filter((id) => id.startsWith("land-cover-cells"))).toHaveLength(layerCount);
  });

  it("stacks the land-cover fill ABOVE the candidate fill but BELOW facilities", () => {
    const { map } = renderAndLoad(baseProps({ showLandCover: true }));
    const order = map.layers;
    expect(order.indexOf(FILL)).toBeGreaterThan(order.indexOf("candidates-fill"));
    expect(order.indexOf(FILL)).toBeLessThan(order.indexOf("facilities-points"));
  });

  it("keeps the selected-candidate highlight ABOVE the land-cover fill", () => {
    const selected = {
      candidate_id: 7,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [126.9, 37.5],
            [126.91, 37.5],
            [126.91, 37.51],
            [126.9, 37.51],
            [126.9, 37.5],
          ],
        ],
      },
    } as unknown as CandidateDetail;
    const props = baseProps({ showLandCover: true });
    const { map, rerender } = renderAndLoad(props);
    // Selecting after the layer exists is the real order: the highlight layers are
    // added on top, and the land-cover fill was inserted below the facility symbols.
    rerender(<MapView {...props} selectedCandidate={selected} />);
    const order = map.layers;
    expect(order.indexOf("selected-candidate-fill")).toBeGreaterThan(order.indexOf(FILL));
    expect(order.indexOf("selected-candidate-outline")).toBeGreaterThan(order.indexOf(FILL));
  });

  it("keeps the highlight above land-cover when the layer is enabled AFTER selecting", () => {
    const selected = {
      candidate_id: 8,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [126.9, 37.5],
            [126.91, 37.5],
            [126.91, 37.51],
            [126.9, 37.51],
            [126.9, 37.5],
          ],
        ],
      },
    } as unknown as CandidateDetail;
    const props = baseProps({ showLandCover: false, landCoverTileUrl: null });
    const { map, rerender } = renderAndLoad(props);
    rerender(<MapView {...props} selectedCandidate={selected} />);
    rerender(
      <MapView
        {...props}
        selectedCandidate={selected}
        showLandCover={true}
        landCoverTileUrl={LAND_COVER_TILE_URL}
      />,
    );
    const order = map.layers;
    expect(order.indexOf(FILL)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("selected-candidate-fill")).toBeGreaterThan(order.indexOf(FILL));
  });

  it("restores the source and layers after a style reload (a fresh map instance)", () => {
    const props = baseProps({ showLandCover: true });
    const { unmount } = renderAndLoad(props);
    unmount();
    // A style reload tears the map down and rebuilds it; the layer must come back
    // with the same ids, source-layer and version-pinned tiles.
    const { map } = renderAndLoad(props);
    const source = map.getSource("land-cover-cells") as { tiles: string[] };
    expect(source.tiles).toEqual([LAND_COVER_TILE_URL]);
    for (const id of [FILL, ...OUTLINES]) expect(map.getLayer(id), id).toBeDefined();
  });

  it("paints coverage mode from the three coverage-status colors", () => {
    const { map } = renderAndLoad(baseProps({ showLandCover: true }));
    const fill = JSON.stringify(map.paint[FILL]["fill-color"]);
    expect(fill).toContain("coverage_status");
    expect(fill).toContain(LAND_COVER_COVERAGE_COLORS.COMPLETE_EXACT);
    expect(fill).toContain(LAND_COVER_COVERAGE_COLORS.PARTIAL);
    expect(fill).toContain(LAND_COVER_COVERAGE_COLORS.NO_COVERAGE);
    // Coverage mode never reads a class code.
    expect(fill).not.toContain("dominant_l1_code");
  });

  it.each([
    [1 as ClassLevel, "dominant_l1_code", ["100", "300"]],
    [2 as ClassLevel, "dominant_l2_code", ["150", "310"]],
    [3 as ClassLevel, "dominant_l3_code", ["154", "311"]],
  ])("paints dominant L%i from the official codes at that level", (level, property, codes) => {
    const { map } = renderAndLoad(
      baseProps({ showLandCover: true, landCoverMode: "dominant", landCoverClassLevel: level }),
    );
    const fill = JSON.stringify(map.paint[FILL]["fill-color"]);
    expect(fill).toContain(property);
    for (const code of codes) {
      expect(fill).toContain(code);
      // The swatch color is the deterministic per-code color, not a positional one.
      expect(fill).toContain(landCoverClassColor(code));
    }
  });

  it("gives a cell with no dominant class the neutral unevaluated treatment", () => {
    const { map } = renderAndLoad(
      baseProps({ showLandCover: true, landCoverMode: "dominant", landCoverClassLevel: 1 }),
    );
    const fill = JSON.stringify(map.paint[FILL]["fill-color"]);
    // An explicit `!has` branch → the neutral color; never an invented class code.
    expect(fill).toContain('["!",["has","dominant_l1_code"]]');
    expect(fill).toContain(LAND_COVER_COVERAGE_COLORS.NO_COVERAGE);
    expect(fill).not.toContain("기타");
    expect(fill).not.toContain("Unknown");
    expect(fill).not.toContain("UNKNOWN");
  });

  it("switches mode with a PAINT update, never a source reload", () => {
    const props = baseProps({ showLandCover: true });
    const { map, rerender } = renderAndLoad(props);
    rerender(<MapView {...props} landCoverMode="dominant" />);
    rerender(<MapView {...props} landCoverMode="dominant" landCoverClassLevel={3} />);
    expect(map.removedSources).not.toContain("land-cover-cells");
    expect(JSON.stringify(map.paint[FILL]["fill-color"])).toContain("dominant_l3_code");
  });

  it("filters by coverage status, dropping a disabled status from the filter", () => {
    const props = baseProps({ showLandCover: true });
    const { map, rerender } = renderAndLoad(props);
    expect(JSON.stringify(map.filters[FILL])).toContain("NO_COVERAGE");
    rerender(
      <MapView
        {...props}
        landCoverCoverage={{ COMPLETE_EXACT: true, PARTIAL: true, NO_COVERAGE: false }}
      />,
    );
    const filter = JSON.stringify(map.filters[FILL]);
    expect(filter).toContain("COMPLETE_EXACT");
    expect(filter).toContain("PARTIAL");
    expect(filter).not.toContain("NO_COVERAGE");
  });

  it("filters by dominant class only in dominant mode, sparing cells with no class", () => {
    const props = baseProps({ showLandCover: true, landCoverHiddenClassCodes: ["300"] });
    const { map, rerender } = renderAndLoad(props);
    // Coverage mode ignores the class filter entirely (the control does not offer it).
    expect(JSON.stringify(map.filters[FILL])).not.toContain("dominant_l1_code");
    rerender(<MapView {...props} landCoverMode="dominant" />);
    const filter = JSON.stringify(map.filters[FILL]);
    expect(filter).toContain("dominant_l1_code");
    expect(filter).toContain("300");
    // A cell with NO dominant class is exempt from the class clause, so hiding a
    // class never silently deletes the unevaluated cells from the map.
    expect(filter).toContain('["!",["has","dominant_l1_code"]]');
  });

  it("matches nothing when every coverage status is disabled", () => {
    const { map } = renderAndLoad(
      baseProps({
        showLandCover: true,
        landCoverCoverage: { COMPLETE_EXACT: false, PARTIAL: false, NO_COVERAGE: false },
      }),
    );
    expect(JSON.stringify(map.filters[FILL])).toBe('["in",["get","coverage_status"],["literal",[]]]');
  });

  it("applies the layer filter to every per-status outline layer too", () => {
    const { map } = renderAndLoad(
      baseProps({
        showLandCover: true,
        landCoverCoverage: { COMPLETE_EXACT: true, PARTIAL: true, NO_COVERAGE: false },
      }),
    );
    for (const id of OUTLINES) {
      const filter = JSON.stringify(map.filters[id]);
      expect(filter, id).toContain("coverage_status");
      // Each outline is its own status AND the layer-wide coverage filter.
      expect(filter, id).toContain("all");
    }
  });

  it("keeps land-cover filters intact while the layer is toggled off and on", () => {
    const props = baseProps({
      showLandCover: true,
      landCoverCoverage: { COMPLETE_EXACT: true, PARTIAL: false, NO_COVERAGE: true },
    });
    const { map, rerender } = renderAndLoad(props);
    rerender(<MapView {...props} showLandCover={false} />);
    rerender(<MapView {...props} showLandCover={true} />);
    const filter = JSON.stringify(map.filters[FILL]);
    expect(filter).toContain("COMPLETE_EXACT");
    expect(filter).toContain("NO_COVERAGE");
    expect(filter).not.toContain("PARTIAL");
  });

  it("hides the layer when leaving suitability mode and restores it on return", () => {
    const props = baseProps({ showLandCover: true });
    const { map, rerender } = renderAndLoad(props);
    expect(map.layout[FILL]["visibility"]).toBe("visible");
    rerender(<MapView {...props} mode="equity" candidateTileUrl={null} />);
    expect(map.layout[FILL]["visibility"]).toBe("none");
    rerender(<MapView {...props} mode="suitability" />);
    expect(map.layout[FILL]["visibility"]).toBe("visible");
  });

  it("still opens the existing candidate detail when a cell is clicked", () => {
    const onCandidateClick = vi.fn();
    const { map } = renderAndLoad(baseProps({ showLandCover: true, onCandidateClick }));
    // The land-cover fill registers NO click handler; the existing candidate handler
    // stays the single selection model even with the land-cover fill painted above.
    map.emitLayer("click", "candidates-fill", {
      features: [{ properties: { candidate_id: 99, status: "ELIGIBLE", score: 70 } }],
      lngLat: { lng: 126.9, lat: 37.5 },
    });
    expect(onCandidateClick).toHaveBeenCalledWith(99);
  });

  it("reports the official classes present in the loaded tiles, per level", () => {
    const onLandCoverClassesChange = vi.fn();
    const { map } = renderAndLoad(baseProps({ showLandCover: true, onLandCoverClassesChange }));
    map.sourceFeatures["land-cover-cells"] = LAND_COVER_TILE_FEATURES;
    act(() => map.fire("idle"));
    expect(onLandCoverClassesChange).toHaveBeenCalled();
    const reported = onLandCoverClassesChange.mock.calls.at(-1)![0];
    // Official codes and Korean names, verbatim, ordered by code ascending.
    expect(reported[1]).toEqual([
      { code: "100", name: "시가화건조지역" },
      { code: "300", name: "산림지역" },
    ]);
    expect(reported[2]).toEqual([
      { code: "150", name: "교통지역" },
      { code: "310", name: "활엽수림" },
    ]);
    expect(reported[3]).toEqual([
      { code: "154", name: "도로" },
      { code: "311", name: "활엽수림" },
    ]);
    // The NO_COVERAGE cell contributed no class at any level.
    expect(reported[1]).toHaveLength(2);
  });
});
