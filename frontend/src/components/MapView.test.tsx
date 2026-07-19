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
import type { MapMode, StatusVisibility } from "./MapView";

// Shared recorder for the fake map instances, created before the module mock so
// the (hoisted) factory can push into it.
const h = vi.hoisted(() => ({ instances: [] as FakeMapLike[] }));

interface FakeMapLike {
  sources: Record<string, unknown>;
  layerById: Record<string, { id: string; source: string; paint?: Record<string, unknown> } & Record<string, unknown>>;
  layers: string[];
  filters: Record<string, unknown>;
  paint: Record<string, Record<string, unknown>>;
  layout: Record<string, Record<string, unknown>>;
  removedSources: string[];
  removedLayers: string[];
  fire: (event: string) => void;
  emitLayer: (event: string, layerId: string, payload: unknown) => void;
  getSource: (id: string) => unknown;
  getLayer: (id: string) => (Record<string, unknown> & { id: string; source: string }) | undefined;
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
    fire(event: string) {
      (this.handlers[event] || []).forEach((fn) => fn());
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
    addLayer(layer: { id: string; source: string }) {
      this.layerById[layer.id] = layer;
      this.layers.push(layer.id);
    }
    removeLayer(id: string) {
      delete this.layerById[id];
      this.removedLayers.push(id);
      this.layers = this.layers.filter((l) => l !== id);
    }
    getLayer(id: string) {
      return this.layerById[id];
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
    flyTo() {}
    fitBounds() {}
    remove() {}
  }
  class FakePopup {
    setLngLat() {
      return this;
    }
    setHTML() {
      return this;
    }
    addTo() {
      return this;
    }
  }
  class FakeNavigationControl {}
  return { default: { Map: FakeMap, Popup: FakePopup, NavigationControl: FakeNavigationControl } };
});

// Import AFTER the mock is registered.
import MapView from "./MapView";

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

function baseProps(overrides: Partial<React.ComponentProps<typeof MapView>> = {}) {
  return {
    boundaries: EMPTY_BOUNDARIES,
    regionValues: new Map(),
    breaks: [] as number[],
    palette: ["#ffffff"] as readonly string[],
    metricLabel: "지표",
    metricUnit: "u",
    facilities: [],
    showFacilities: false,
    mode: "suitability" as MapMode,
    candidateTileUrl: BASELINE_TILE_URL,
    candidateBreaks: [20, 40, 60, 80] as readonly number[],
    statusVisibility: DEFAULT_VISIBILITY,
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
});

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

  it("mirrors a region click into an accessible selection (never fabricating a value)", () => {
    const onRegionClick = vi.fn();
    const { map } = renderAndLoad(baseProps({ mode: "equity", onRegionClick }));
    // A served region: has_value arrives as the string "true" from MapLibre.
    map.emitLayer("click", "regions-fill", {
      features: [
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
      lngLat: { lng: 126.98, lat: 37.57 },
    });
    expect(onRegionClick).toHaveBeenCalledTimes(1);
    expect(onRegionClick).toHaveBeenCalledWith({
      regionCode: "KR-SGIS-11110",
      regionName: "종로구",
      metricLabel: "인구 (Population)",
      metricDisplay: "142,000 persons",
      hasValue: true,
      geometryKind: "NATIVE",
      childRegionNames: [],
      sourceId: "sgis",
      boundaryReferencePeriod: "2024",
    });
  });

  it("passes through the no-data availability text and parses derived child names", () => {
    const onRegionClick = vi.fn();
    const { map } = renderAndLoad(baseProps({ mode: "equity", onRegionClick }));
    map.emitLayer("click", "regions-fill", {
      features: [
        {
          properties: {
            region_code: "KR-RCIS-CITY-GOYANG",
            region_name: "고양시",
            metric_label: "생활계 폐기물 발생량",
            // The choropleth builds this text for a region with no served value;
            // MapView must forward it verbatim, never a 0.
            metric_display: "데이터 없음 — 출처에서 해당 지역·항목을 보고하지 않음",
            has_value: "false",
            geometry_kind: "DERIVED",
            child_region_names: JSON.stringify(["덕양구", "일산동구", "일산서구"]),
            source_id: "rcis",
            boundary_reference_period: "2024",
          },
        },
      ],
      lngLat: { lng: 126.8, lat: 37.65 },
    });
    const selection = onRegionClick.mock.calls[0][0];
    expect(selection.hasValue).toBe(false);
    expect(selection.metricDisplay).toContain("데이터 없음");
    expect(selection.metricDisplay).not.toContain("0");
    expect(selection.childRegionNames).toEqual(["덕양구", "일산동구", "일산서구"]);
  });
});
