// @vitest-environment jsdom

/**
 * 처리 대상 행정구역 선택 map — the claim it must never make.
 *
 * The one thing that would be genuinely harmful here is a graduated fill: a
 * shaded map beside a cost figure reads as "cost varies across this area", which
 * is a per-location land-price claim the facility-cost model does not make
 * (docs/YEOGIDA_UI_REDESIGN_SPEC.md §5).
 *
 * These tests read the paint expressions the component actually hands MapLibre,
 * so the guarantee is checked against the real style rather than against a
 * comment. jsdom has no WebGL, so `maplibre-gl` is stubbed to capture the calls.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Layer = { id: string; type: string; paint?: Record<string, unknown> };
const added: { sources: Record<string, unknown>[]; layers: Layer[] } = { sources: [], layers: [] };
const handlers = new Map<string, (event: unknown) => void>();
const featureStates: { id: string; state: Record<string, unknown> }[] = [];

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor() {}
    addControl() {}
    addSource(_id: string, source: Record<string, unknown>) {
      added.sources.push(source);
    }
    addLayer(layer: Layer) {
      added.layers.push(layer);
    }
    on(event: string, second?: unknown, third?: unknown) {
      const cb = (typeof second === "function" ? second : third) as (e: unknown) => void;
      const key = typeof second === "string" ? `${event}:${second}` : event;
      handlers.set(key, cb);
      if (event === "load") cb(undefined);
    }
    once(event: string, cb: () => void) {
      if (event === "load") cb();
    }
    setFeatureState(target: { id: string }, state: Record<string, unknown>) {
      featureStates.push({ id: target.id, state });
    }
    getSource() {
      return { setData: () => {} };
    }
    getCanvas() {
      return { style: {} } as unknown as HTMLCanvasElement;
    }
    resize() {}
    remove() {}
  }
  return {
    default: { Map: FakeMap, NavigationControl: class {} },
    Map: FakeMap,
    NavigationControl: class {},
  };
});

import FacilityCostRegionMap, {
  NO_DATA_FILL,
  SELECTED_FILL,
  UNSELECTED_FILL,
} from "./FacilityCostRegionMap";

const boundaries = {
  type: "FeatureCollection",
  reference_year: 2024,
  count: 2,
  features: [
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [] },
      properties: { region_code: "R1", region_name: "가구", region_level: "sigungu" },
    },
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [] },
      properties: { region_code: "R2", region_name: "나구", region_level: "sigungu" },
    },
  ],
} as never;

beforeEach(() => {
  added.sources.length = 0;
  added.layers.length = 0;
  featureStates.length = 0;
  handlers.clear();
});
afterEach(cleanup);

function renderMap(
  selected: string[] = [],
  onToggle = vi.fn(),
  selectable = ["R1", "R2"],
  onUnavailable = vi.fn(),
) {
  render(
    <FacilityCostRegionMap
      boundaries={boundaries}
      selectedCodes={selected}
      onToggleRegion={onToggle}
      selectableCodes={selectable}
      onUnavailableRegion={onUnavailable}
    />,
  );
  return { onToggle, onUnavailable };
}

/** Every leaf of a paint expression, flattened. */
function leaves(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [value];
  return value.flatMap(leaves);
}

describe("the map makes no value claim", () => {
  it("paints from a BOOLEAN feature-state, never from a numeric value", () => {
    renderMap();
    const fill = added.layers.find((l) => l.type === "fill")!;
    const colour = fill.paint!["fill-color"];
    // A choropleth needs an interpolate/step over a numeric input. Neither may
    // appear, and no numeric literal may feed the colour at all.
    const flat = leaves(colour);
    expect(flat).not.toContain("interpolate");
    expect(flat).not.toContain("step");
    expect(flat).not.toContain("get");
    expect(flat.some((leaf) => typeof leaf === "number")).toBe(false);
    // What it DOES read is the boolean selection state.
    expect(flat).toContain("feature-state");
    expect(flat).toContain("selected");
    expect(flat).toContain("selectable");
    expect(flat).toContain("boolean");
  });

  it("uses exactly three CATEGORICAL fill colours — selected, unselected, no data", () => {
    renderMap();
    const fill = added.layers.find((l) => l.type === "fill")!;
    const colours = leaves(fill.paint!["fill-color"]).filter(
      (leaf) => typeof leaf === "string" && leaf.startsWith("#"),
    );
    // Three named states, not a ramp — and exactly the three the legend draws.
    expect(new Set(colours)).toEqual(new Set([SELECTED_FILL, UNSELECTED_FILL, NO_DATA_FILL]));
  });

  it("adds no legend, no symbol layer, and no basemap source", () => {
    renderMap();
    // Only the boundary source; a tile basemap would invite reading terrain into
    // a cost decision.
    expect(added.sources).toHaveLength(1);
    expect(added.sources[0]).toMatchObject({ type: "geojson" });
    // Fill + outline only.
    expect(added.layers.map((l) => l.type).sort()).toEqual(["fill", "line"]);
  });

  it("promotes the region code to the feature id so selection can repaint", () => {
    renderMap();
    expect(added.sources[0]).toMatchObject({ promoteId: "region_code" });
  });
});

describe("selection", () => {
  it("marks each region's selection AND data state", () => {
    renderMap(["R2"], vi.fn(), ["R2"]);
    expect(featureStates).toEqual([
      // R1 has no official data for this stream — it is neither selected nor
      // selectable, which is what gives it the third fill.
      { id: "R1", state: { selected: false, selectable: false } },
      { id: "R2", state: { selected: true, selectable: true } },
    ]);
  });

  it("toggles a region on click, reporting the code to the shared state", () => {
    const { onToggle } = renderMap([]);
    handlers.get("click:service-regions-fill")!({
      features: [{ properties: { region_code: "R1" } }],
    });
    expect(onToggle).toHaveBeenCalledWith("R1");
  });

  it("reports a no-data region instead of silently doing nothing", () => {
    // Selecting it would only produce OFFICIAL_WASTE_UNAVAILABLE later, so it is
    // still never toggled — but the click is ANSWERED rather than swallowed, which
    // is what lets the panel say why the region cannot be chosen.
    const { onToggle, onUnavailable } = renderMap([], vi.fn(), ["R2"]);
    handlers.get("click:service-regions-fill")!({
      features: [{ properties: { region_code: "R1", region_name: "가구" } }],
    });
    expect(onToggle).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith("가구", "R1");
  });

  it("ignores a click that carries no region code", () => {
    const { onToggle, onUnavailable } = renderMap();
    handlers.get("click:service-regions-fill")!({ features: [] });
    expect(onToggle).not.toHaveBeenCalled();
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});

describe("accessibility posture", () => {
  it("is aria-hidden, because the picker beside it is the accessible path", () => {
    const { container } = render(
      <FacilityCostRegionMap
        boundaries={boundaries}
        selectedCodes={[]}
        onToggleRegion={vi.fn()}
        selectableCodes={["R1"]}
      />,
    );
    const node = container.querySelector('[data-testid="facility-cost-region-map"]')!;
    // An unlabelled canvas a keyboard user cannot operate should not be announced
    // as interactive; the SearchableRegionPicker does the same job accessibly.
    expect(node.getAttribute("aria-hidden")).toBe("true");
  });
});
