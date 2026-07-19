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
import MapView, { regionPopupHtml } from "./MapView";

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
    metricReferencePeriod: "2024",
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

  it("reports the clicked region's CODE (page state derives the summary, no value snapshot)", () => {
    const onRegionClick = vi.fn();
    const { map } = renderAndLoad(baseProps({ mode: "equity", onRegionClick }));
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
    // Only the stable region identity crosses the boundary — the metric label and
    // value are NOT passed, so a later metric change re-derives them in page state
    // instead of leaving a stale snapshot on the callback.
    expect(onRegionClick).toHaveBeenCalledTimes(1);
    expect(onRegionClick).toHaveBeenCalledWith("KR-SGIS-11110");
  });

  it("pins a popup carrying the served value on a region click (mobile tap path)", () => {
    const { map } = renderAndLoad(baseProps({ mode: "equity", onRegionClick: vi.fn() }));
    map.emitLayer("click", "regions-fill", {
      features: [
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
      lngLat: { lng: 126.8, lat: 37.65 },
    });
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
    expect(html).toContain("지표 기준 기간: 2024");
    expect(html).toContain("경계 출처: sgis (2024)");
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
    expect(html).toContain("통계 보고 단위: 시");
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
    expect(popup.html).toContain("지표 기준 기간: 2024");
    // Leaving the region resets the cursor and removes the tooltip.
    map.emitLayer("mouseleave", "regions-fill", {});
    expect(map.getCanvas().style.cursor).toBe("");
    expect(popup.added).toBe(false);
  });

  it("includes the reference period in the tap/click popup too (mobile path)", () => {
    const { map } = renderAndLoad(baseProps({ mode: "equity", onRegionClick: vi.fn() }));
    map.emitLayer("click", "regions-fill", {
      features: [{ properties: SERVED_REGION_PROPS }],
      lngLat: { lng: 126.98, lat: 37.57 },
    });
    const popup = h.popups[h.popups.length - 1];
    expect(popup.html).toContain("종로구");
    expect(popup.html).toContain("지표 기준 기간: 2024");
  });

  it("rebuilds the hover tooltip when the metric changes while hovering one region", () => {
    const props = baseProps({ mode: "equity", candidateTileUrl: null, metricReferencePeriod: "2022" });
    const { map, rerender } = renderAndLoad(props);
    map.emitLayer("mousemove", "regions-fill", {
      features: [{ properties: { ...SERVED_REGION_PROPS, metric_reference_period: "2022" } }],
      lngLat: { lng: 126.98, lat: 37.57 },
    });
    expect(h.popups[h.popups.length - 1].html).toContain("지표 기준 기간: 2022");

    // The metric changes (a new reference period) → a refresh re-stamps the source
    // AND resets the hover cache, so the next mousemove over the SAME region shows
    // the new value rather than the cached one.
    rerender(<MapView {...props} metricReferencePeriod="2024" />);
    map.emitLayer("mousemove", "regions-fill", {
      features: [{ properties: { ...SERVED_REGION_PROPS, metric_reference_period: "2024" } }],
      lngLat: { lng: 126.98, lat: 37.57 },
    });
    expect(h.popups[h.popups.length - 1].html).toContain("지표 기준 기간: 2024");
    expect(h.popups[h.popups.length - 1].html).not.toContain("지표 기준 기간: 2022");
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
    map.emitLayer("click", "regions-fill", {
      features: [{ properties: SERVED_REGION_PROPS }],
      lngLat: { lng: 126.98, lat: 37.57 },
    });

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
    const pinned = h.popups.find((p) => p.html.includes("경계 출처") && p.added);
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

  it("opens a facility popup when a facility point is clicked", () => {
    const { map } = renderAndLoad(
      baseProps({ mode: "equity", candidateTileUrl: null, showFacilities: true, facilities: [FACILITY] }),
    );
    map.emitLayer("click", "facilities-points", {
      features: [
        {
          properties: {
            facility_name: "종로 소각장",
            category_label: "소각",
            throughput: "1,234.5 톤/년",
            address: "서울 종로구 1-1",
            source_id: "waste_statistics",
            reference_period: "2022",
          },
        },
      ],
      lngLat: { lng: 126.98, lat: 37.57 },
    });
    const popup = h.popups[h.popups.length - 1];
    expect(popup.added).toBe(true);
    expect(popup.html).toContain("종로 소각장");
    expect(popup.html).toContain("연간 처리량: 1,234.5 톤/년");
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
