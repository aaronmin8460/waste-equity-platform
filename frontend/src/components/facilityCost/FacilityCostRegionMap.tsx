"use client";

/**
 * 처리 대상 행정구역 선택 — a SELECTION map, and nothing else.
 *
 * ── Why this is not `MapView` ────────────────────────────────────────────────────
 * `MapView` is a choropleth: it takes a palette, class breaks, and a per-region
 * value, and paints a graduated surface. That is exactly the thing this map must
 * never be. A shaded map beside a cost figure reads as "cost varies across this
 * area" — a per-location land-price or per-candidate-cell claim the facility-cost
 * model does not make and the data cannot support
 * (docs/YEOGIDA_UI_REDESIGN_SPEC.md §5).
 *
 * So the fill here is CATEGORICAL, never graduated: a region is selected, or
 * selectable-but-unselected, or has no official waste data for the chosen stream.
 * Three fixed colours bound to two BOOLEAN feature-states, with no ramp, no value
 * in the tooltip, and no numeric property bound to any paint expression. There is
 * no code path through which a value could tint a region, which makes the
 * guarantee structural rather than a promise in a comment.
 *
 * ── The third state, and why it exists ───────────────────────────────────────────
 * The waste statistics do not cover every reporting region for every stream, so a
 * region can be on this map and still be uncalculable. Before the Figma alignment
 * such a region looked exactly like an unselected one and a click on it did
 * nothing at all — silent, unexplained inertness. It now has its own fill, its own
 * legend row (rendered as DOM beside the canvas, in `FacilityCostMapPanel`), and a
 * click reports back through `onUnavailableRegion` so the panel can say, in words,
 * why the region cannot be chosen. No region is invented and no value is faked:
 * a region with no data is shown AS having no data.
 *
 * What it does otherwise is unchanged: click a region to add or remove it from the
 * service-region selection. The `SearchableRegionPicker` beside it stays the
 * primary, fully-accessible control — this map is a second way to do the same
 * thing, never the only way, so a keyboard or screen-reader user loses nothing by
 * ignoring it (the panel repeats the no-data explanation in text for them).
 */

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

import type { RegionBoundaryCollection } from "../../lib/api";

const SOURCE_ID = "service-regions";
const FILL_LAYER = "service-regions-fill";
const LINE_LAYER = "service-regions-line";

/**
 * The three selection states, from Figma 129:5709's own legend swatches.
 * Deliberately not a scale, and deliberately exported: the legend beside the map
 * reads these exact constants, so a swatch can never drift from the polygon it
 * claims to describe.
 */
export const SELECTED_FILL = "#111a56";
export const UNSELECTED_FILL = "#d7dcee";
export const NO_DATA_FILL = "#f2f3f8";
const OUTLINE = "#ffffff";

export interface FacilityCostRegionMapProps {
  /** Region geometry, in the same code space as the picker's options. */
  boundaries: RegionBoundaryCollection;
  /** Codes the picker currently has selected — the single source of truth. */
  selectedCodes: string[];
  /** Toggle one region. The picker and the map write the SAME state. */
  onToggleRegion: (regionCode: string) => void;
  /** Only regions the cost model can actually calculate are selectable. */
  selectableCodes: string[];
  /**
   * A click on a region with no official waste data for the current stream.
   * Receives the region's served name so the caller can name it in the feedback —
   * the map itself renders no text, because its canvas is hidden from assistive
   * technology.
   */
  onUnavailableRegion?: (regionName: string, regionCode: string) => void;
}

export default function FacilityCostRegionMap({
  boundaries,
  selectedCodes,
  onToggleRegion,
  selectableCodes,
  onUnavailableRegion,
}: FacilityCostRegionMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  // Read inside the click handler so it always sees current values without the
  // handler being re-bound (and the map re-created) on every selection change.
  const toggleRef = useRef(onToggleRegion);
  const selectableRef = useRef(selectableCodes);
  const unavailableRef = useRef(onUnavailableRegion);

  useEffect(() => {
    toggleRef.current = onToggleRegion;
    selectableRef.current = selectableCodes;
    unavailableRef.current = onUnavailableRegion;
  }, [onToggleRegion, selectableCodes, onUnavailableRegion]);

  // Create the map ONCE. Selection changes only repaint (see the effect below),
  // so choosing a region never rebuilds the map or moves the viewport.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      // No basemap tiles: this is an administrative-boundary picker, and a
      // satellite or street backdrop would invite reading terrain into a cost
      // decision the model does not make.
      // No `glyphs` key at all — MapLibre validates the style and rejects an
      // explicit `undefined` ("glyphs: string expected"). There are no symbol
      // layers here, so no glyph source is needed.
      style: { version: 8, sources: {}, layers: [] },
      center: [127.0, 37.5],
      zoom: 7.2,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      loadedRef.current = true;
      // `promoteId` makes MapLibre use the region code AS the feature id, which is
      // what `setFeatureState` addresses below. Without it the features have no
      // id and every selection repaint would be silently dropped.
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: boundaries as never,
        promoteId: "region_code",
      });
      map.addLayer({
        id: FILL_LAYER,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          // Bound to two BOOLEAN feature-states, never to a value. There is no
          // numeric input to either expression at all.
          "fill-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            SELECTED_FILL,
            ["boolean", ["feature-state", "selectable"], false],
            UNSELECTED_FILL,
            NO_DATA_FILL,
          ],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            0.85,
            ["boolean", ["feature-state", "selectable"], false],
            0.8,
            // The no-data fill is the palest of the three AND the flattest, so it
            // reads as "nothing here to choose" rather than as a quieter choice.
            0.9,
          ],
        },
      });
      map.addLayer({
        id: LINE_LAYER,
        type: "line",
        source: SOURCE_ID,
        paint: { "line-color": OUTLINE, "line-width": 0.8 },
      });
      map.on("click", FILL_LAYER, (event) => {
        const feature = event.features?.[0];
        const code = feature?.properties?.region_code as string | undefined;
        if (!code) return;
        // A region the cost model cannot calculate is never silently toggled into
        // a selection the endpoint would reject. It reports itself instead, so the
        // panel can explain the state rather than leaving the click unanswered.
        if (!selectableRef.current.includes(code)) {
          const name = (feature?.properties?.region_name as string | undefined) ?? code;
          unavailableRef.current?.(name, code);
          return;
        }
        toggleRef.current(code);
      });
      map.on("mouseenter", FILL_LAYER, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", FILL_LAYER, () => {
        map.getCanvas().style.cursor = "";
      });
    });

    // Same rAF-coalesced container observer the rest of the app uses, so the
    // canvas follows its box when the layout reflows.
    let raf = 0;
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
              raf = 0;
              mapRef.current?.resize?.();
            });
          })
        : null;
    observer?.observe(containerRef.current);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // Boundaries are loaded once with the page; a later identity change is
    // handled by the data effect below rather than by rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the source in step if the boundary collection is replaced.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(boundaries as never);
  }, [boundaries]);

  // Repaint the three states. `setFeatureState` only changes paint — it does not
  // reload the source, move the viewport, or remount anything. `selectable` is
  // written here too, so changing the waste stream (which changes which regions
  // are calculable) recolours the map without touching the geometry.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const selected = new Set(selectedCodes);
      const selectable = new Set(selectableCodes);
      for (const feature of boundaries.features) {
        const code = feature.properties.region_code;
        map.setFeatureState(
          { source: SOURCE_ID, id: code },
          { selected: selected.has(code), selectable: selectable.has(code) },
        );
      }
    };
    if (loadedRef.current) apply();
    else map.once("load", apply);
  }, [selectedCodes, selectableCodes, boundaries]);

  return (
    <div
      ref={containerRef}
      // An EXPLICIT height, never `absolute inset-0`. MapLibre stamps
      // `.maplibregl-map` on this element, and that rule sets
      // `position: relative` — same specificity as Tailwind's `.absolute` but
      // later in source order, so it wins and the box collapses to height 0 with
      // no polygon ever painted. `h-full` inside the panel's definite height is
      // immune to that, because it does not depend on `position` at all.
      className="h-full w-full"
      data-testid="facility-cost-region-map"
      // The picker beside it is the accessible path; this canvas is a pointer
      // convenience, so it is hidden from assistive tech rather than presenting
      // an unlabelled interactive surface a keyboard user cannot operate. The
      // legend and the no-data feedback are rendered OUTSIDE it, as real DOM.
      aria-hidden
    />
  );
}
