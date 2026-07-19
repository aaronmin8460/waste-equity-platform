"use client";

/**
 * MapLibre GL map: SIGUNGU equity choropleth + facility points (Equity mode) and
 * the 500 m suitability candidate grid (Suitability mode). These are the only
 * two modes that render a map; the 수도권매립지 mode is a dashboard and does not
 * mount this component at all.
 *
 * Regions/candidates with no served value render in the explicit no-data color;
 * facilities without backend-served coordinates are never drawn. The suitability
 * candidate grid is served in full as PostGIS Mapbox Vector Tiles (MVT): the map
 * requests only the tiles its current viewport/zoom needs, so every candidate
 * cell of the selected run is reachable without ever loading a bbox-limited slice
 * of the ~48k grid. The basemap is OpenStreetMap raster tiles (public,
 * non-government) with attribution. The map talks only to the backend.
 */

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type {
  CandidateDetail,
  FacilityItem,
  RegionBoundaryCollection,
  SuitabilityStatus,
} from "../lib/api";
import { SUITABILITY_TILE_SOURCE_LAYER } from "../lib/api";
import {
  CANDIDATE_SCORE_PALETTE_5,
  FACILITY_CATEGORY_COLORS,
  FACILITY_CATEGORY_LABELS,
  NO_DATA_COLOR,
  formatQuantity,
} from "../lib/metrics";
import { formatRegionMetricDisplay } from "../lib/regionDisplay";
import { geometryBounds, isDegenerateBounds } from "../lib/suitability";

/**
 * The modes that actually render a map. The 수도권매립지 dashboard mode is not
 * one of them: its source declares metropolitan totals only, with no municipal
 * origin and no route, so there is nothing map-shaped to draw honestly.
 */
export type MapMode = "equity" | "suitability";

// OpenStreetMap standard raster tiles are only published to zoom 19; requesting
// z20+ returns HTTP 400 (verified against tile.openstreetmap.org). Cap the raster
// source (so MapLibre overzooms z19 tiles instead of requesting unpublished ones)
// and the interactive map so the zoom control stops at the supported maximum and
// the basemap never goes blank. See docs / OSM tile usage policy.
const OSM_MAX_ZOOM = 19;

// The candidate vector source stops generating tiles at this zoom; MapLibre
// overzooms it for higher interactive zooms. Bounding it keeps a zoomed-in
// viewport from requesting a swarm of sub-cell tiles while still cutting the
// dataset into viewport-sized pieces (a z14 tile ≈ 2–3 km, tens of 500 m cells).
const CANDIDATE_TILE_MAX_ZOOM = 14;

const CANDIDATE_LAYER_IDS = ["candidates-fill", "candidates-review-outline"];

const BASE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: OSM_MAX_ZOOM,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

// Seoul + Incheon + Gyeonggi-do extent.
const SMA_BOUNDS: [[number, number], [number, number]] = [
  [125.8, 36.8],
  [127.9, 38.4],
];

const EXCLUDED_COLOR = "#9aa2ad";
const REVIEW_COLOR = "#e8a33d";
const SELECTED_FILL_COLOR = "#2563eb";
const SELECTED_OUTLINE_COLOR = "#1d4ed8";

export interface RegionDisplayValue {
  /** Numeric value used only for the color scale. */
  numeric: number;
  /** Exact display string formatted from the served value. */
  display: string;
}

/**
 * The region information a map click surfaces, mirrored into an accessible DOM
 * summary in the sidebar. The MapLibre canvas itself is not reachable by keyboard
 * or screen readers, so the click also drives a text alternative (page.tsx). No
 * value here is fabricated: `hasValue`/`metricDisplay` come straight from the
 * served choropleth feature, and a region with no served value carries its
 * availability reason instead of a number.
 */
export interface RegionSelection {
  regionCode: string;
  regionName: string;
  metricLabel: string;
  metricDisplay: string;
  hasValue: boolean;
  geometryKind: string | null;
  childRegionNames: string[];
  sourceId: string;
  boundaryReferencePeriod: string;
}

export type StatusVisibility = Record<SuitabilityStatus, boolean>;

interface MapViewProps {
  boundaries: RegionBoundaryCollection;
  regionValues: Map<string, RegionDisplayValue>;
  breaks: number[];
  /** Active choropleth palette for the region fill (sized to the effective classes). */
  palette: readonly string[];
  metricLabel: string;
  metricUnit: string;
  /** The active metric's reference period, shown in the region tooltip/popup. */
  metricReferencePeriod: string;
  facilities: FacilityItem[];
  showFacilities: boolean;
  mode: MapMode;
  /**
   * MVT tile-URL template ("…/{z}/{x}/{y}.mvt") for the active run + profile, or
   * null when there is no suitability run to render (e.g. equity mode). Changing
   * it (profile switch) re-points the vector source at the new immutable tiles.
   */
  candidateTileUrl: string | null;
  /** Stable interior score thresholds for the candidate palette (never per-viewport). */
  candidateBreaks: readonly number[];
  statusVisibility: StatusVisibility;
  /** Currently-selected candidate (list or map). Drives highlight + map movement. */
  selectedCandidate: CandidateDetail | null;
  onCandidateClick: (candidateId: number) => void;
  /** Accessible name for the map region landmark (varies by mode). */
  ariaLabel: string;
  /** Longer textual explanation, referenced by the container's aria-describedby. */
  ariaDescription: string;
  /**
   * Fired with the clicked region's CODE, so the sidebar can derive and render an
   * accessible DOM summary of that region under the active metric. Only the code
   * is passed (not a value snapshot): page state owns the region identity and
   * re-derives the label/value, so the summary never goes stale on a metric change.
   * Optional: suitability mode has no region choropleth.
   */
  onRegionClick?: (regionCode: string) => void;
}

// A MapLibre "step" needs at least one stop; with no breaks (e.g. before data
// loads) fall back to a single constant color so the layer is always valid. The
// palette is passed in so the map uses the exact colors the legend shows.
function scoreStep(breaks: readonly number[], palette: readonly string[]): unknown {
  if (breaks.length === 0) return palette[palette.length - 1];
  const step: unknown[] = ["step", ["get", "metric_value"], palette[0]];
  breaks.forEach((threshold, index) => {
    step.push(threshold, palette[Math.min(index + 1, palette.length - 1)]);
  });
  return step;
}

function fillColorExpression(
  breaks: number[],
  palette: readonly string[],
): maplibregl.ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "has_value"], true],
    scoreStep(breaks, palette),
    NO_DATA_COLOR,
  ] as unknown as maplibregl.ExpressionSpecification;
}

// Candidate score step over the tile's `score` attribute (the eligible final
// score). Eligible cells always carry a numeric score; coalesce to 0 defensively
// so the step input is never null (which MapLibre would reject).
function candidateScoreStep(breaks: readonly number[]): unknown {
  const palette = CANDIDATE_SCORE_PALETTE_5;
  if (breaks.length === 0) return palette[palette.length - 1];
  const step: unknown[] = ["step", ["coalesce", ["get", "score"], 0], palette[0]];
  breaks.forEach((threshold, index) => {
    step.push(threshold, palette[Math.min(index + 1, palette.length - 1)]);
  });
  return step;
}

// Candidate fill: eligible -> score step (stable 0–100 classes); review ->
// distinct amber; excluded -> muted. Candidates always use their own 5-class
// palette (never the region one).
function candidateColorExpression(breaks: readonly number[]): maplibregl.ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "status"], "EXCLUDED"],
    EXCLUDED_COLOR,
    ["==", ["get", "status"], "REVIEW_REQUIRED"],
    REVIEW_COLOR,
    candidateScoreStep(breaks),
  ] as unknown as maplibregl.ExpressionSpecification;
}

const CANDIDATE_OPACITY: maplibregl.ExpressionSpecification = [
  "case",
  ["==", ["get", "status"], "EXCLUDED"],
  0.28,
  ["==", ["get", "status"], "REVIEW_REQUIRED"],
  0.45,
  0.8,
] as unknown as maplibregl.ExpressionSpecification;

function statusFilter(visibility: StatusVisibility): maplibregl.FilterSpecification {
  const visible = (Object.keys(visibility) as SuitabilityStatus[]).filter((s) => visibility[s]);
  return ["in", ["get", "status"], ["literal", visible]] as unknown as maplibregl.FilterSpecification;
}

/**
 * The region tooltip/popup HTML, shared by the desktop hover tooltip and the
 * click/tap popup so both show the same information: region name, selected metric
 * label, the exact served value with unit (or the availability text — never a
 * fabricated 0), the metric's reference period, and the boundary provenance.
 * `props` are the MapLibre-serialized feature properties (strings/booleans).
 */
export function regionPopupHtml(props: Record<string, unknown>): string {
  // `metric_display` already conveys availability: a served value with its unit,
  // or "데이터 없음 — {reason}" for a region with no served value (never a 0).
  const period = props.metric_reference_period
    ? `<br/><small>지표 기준 기간: ${props.metric_reference_period}</small>`
    : "";
  let reportingLines = "";
  if (props.geometry_kind === "DERIVED") {
    let children = "";
    try {
      children = (JSON.parse(String(props.child_region_names ?? "[]")) as string[]).join("·");
    } catch {
      children = "";
    }
    reportingLines =
      `<br/><small>통계 보고 단위: 시 (city) · 수치 출처: RCIS</small>` +
      (children ? `<br/><small>경계 표시: SGIS ${children} 경계의 파생 합집합</small>` : "") +
      `<br/><small>구별 공식 폐기물 값은 제공되지 않습니다.</small>`;
  }
  return (
    `<strong>${props.region_name}</strong><br/>${props.metric_label}<br/>` +
    `${props.metric_display}` +
    period +
    `<br/><small>경계 출처: ${props.source_id} (${props.boundary_reference_period}) · 지표 출처는 좌측 패널 참조</small>` +
    reportingLines
  );
}

// Popup score line built from the light tile attributes (full provenance is
// fetched separately into the detail panel). Excluded cells carry no score/rank.
function candidateScoreDisplay(props: Record<string, unknown>): string {
  if (props.status === "EXCLUDED") return "제외 (excluded)";
  if (props.score != null) return `${props.score} (rank ${props.rank ?? "-"})`;
  if (props.provisional_score != null) return `${props.provisional_score} (provisional)`;
  return "-";
}

export default function MapView({
  boundaries,
  regionValues,
  breaks,
  palette,
  metricLabel,
  metricUnit,
  metricReferencePeriod,
  facilities,
  showFacilities,
  mode,
  candidateTileUrl,
  candidateBreaks,
  statusVisibility,
  selectedCandidate,
  onCandidateClick,
  ariaLabel,
  ariaDescription,
  onRegionClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const onCandidateClickRef = useRef(onCandidateClick);
  const onRegionClickRef = useRef(onRegionClick);
  // A single reusable tooltip popup for desktop region hover (no close button, so
  // it reads as a lightweight tooltip); the last-hovered region code so its HTML
  // is rebuilt only when the pointer crosses into a different region.
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null);
  const hoveredRegionRef = useRef<string | null>(null);
  // The single pinned (click/tap) region popup. Retained so a metric/mode change
  // can close it before its label/value goes stale, and so a new click replaces the
  // previous pin instead of accumulating abandoned popups. Removed on unmount.
  const pinnedPopupRef = useRef<maplibregl.Popup | null>(null);

  // User-visible map states, rendered as overlays inside the map wrapper:
  //  - mapLoading: MapLibre is initializing / before the first render (map "load").
  //  - candidateLoading: the suitability candidate vector source is (re)loading its
  //    tiles after entering suitability mode or switching profile/tile URL.
  //  - mapError: a concise, non-blocking message if the map cannot initialize or a
  //    source fails. Transient individual tile fetch failures are NOT escalated here.
  const [mapLoading, setMapLoading] = useState(true);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  // Tile URL currently applied to the vector source. A vector source's tiles are
  // immutable once added, so a profile change requires removing and re-adding the
  // source rather than a GeoJSON-style setData swap.
  const appliedTileUrlRef = useRef<string | null>(null);
  useEffect(() => {
    onCandidateClickRef.current = onCandidateClick;
    onRegionClickRef.current = onRegionClick;
  });

  // Reflect map state onto the container as read-only data attributes so tests
  // can assert zoom capping and selection-driven movement. No behavioral effect.
  function recordViewport(map: maplibregl.Map) {
    if (!containerRef.current) return;
    const c = map.getCenter();
    containerRef.current.dataset.center = `${c.lng.toFixed(5)},${c.lat.toFixed(5)}`;
    containerRef.current.dataset.zoom = map.getZoom().toFixed(2);
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: BASE_STYLE,
        bounds: SMA_BOUNDS,
        fitBoundsOptions: { padding: 16 },
        attributionControl: { compact: false },
        // Zoom control stops at the OSM basemap's supported maximum (no z20+ requests).
        maxZoom: OSM_MAX_ZOOM,
      });
    } catch {
      // The map genuinely cannot operate (e.g. WebGL unavailable). Surface a
      // concise state and stop; the application-level backend error handling and
      // the accessible DOM alternatives (region <select>, candidate list) remain.
      // Deferred out of the synchronous effect body (queueMicrotask) so it reads as
      // reacting to an external failure rather than a cascading in-effect setState.
      queueMicrotask(() => {
        setMapError("지도를 초기화할 수 없습니다 (map could not be initialized).");
        setMapLoading(false);
      });
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // Candidate click/hover are bound exactly once (not on every source re-add),
    // keyed by the stable layer id, so a profile switch never double-binds them.
    map.on("click", "candidates-fill", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const props = feature.properties as Record<string, unknown>;
      new maplibregl.Popup()
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>후보지 ${props.candidate_key}</strong><br/>` +
            `상태(status): ${props.status}<br/>적합성 점수: ${candidateScoreDisplay(props)}<br/>` +
            `시군구: ${props.sigungu_region_name ?? ""}<br/>` +
            `<small>분석 스크리닝 결과 — 법적 판정이 아님. 상세 근거는 좌측 패널 참조</small>`,
        )
        .addTo(map);
      const id = Number(props.candidate_id);
      if (!Number.isNaN(id)) onCandidateClickRef.current(id);
    });
    map.on("mouseenter", "candidates-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "candidates-fill", () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("load", () => {
      loadedRef.current = true;
      setMapLoading(false);
      recordViewport(map);
      map.fire("wep:refresh");
    });
    map.on("moveend", () => recordViewport(map));

    // Candidate tile-refresh feedback. The candidate vector source becomes
    // "loaded" once its viewport tiles arrive (or immediately, if the viewport
    // holds no tiles), and the map reaches "idle" when nothing more is pending —
    // either clears the refresh indicator, so it never sticks on permanently.
    map.on("sourcedata", (event) => {
      const e = event as unknown as { sourceId?: string; isSourceLoaded?: boolean };
      if (e && e.sourceId === "candidates" && e.isSourceLoaded) setCandidateLoading(false);
    });
    map.on("idle", () => setCandidateLoading(false));

    // MapLibre errors. A single raster/vector TILE fetch failing is transient and
    // must never become a permanent fatal state — MapLibre keeps operating and
    // overzooms/omits the missing tile. Only escalate to a visible (still
    // non-blocking) message when the map has not become usable at all (a
    // style/init-level failure, which carries no sourceId). A failing candidate
    // source additionally clears its refresh spinner so it does not hang.
    map.on("error", (event) => {
      const e = (event ?? {}) as { sourceId?: string };
      if (e.sourceId === "candidates") setCandidateLoading(false);
      if (!loadedRef.current && !e.sourceId) {
        setMapError("지도를 불러오지 못했습니다 (some map resources failed to load).");
        // The map never became usable; stop the loading overlay so the error is not
        // shown behind a permanent spinner.
        setMapLoading(false);
      }
    });
    mapRef.current = map;

    // Keep the MapLibre canvas in sync with its container when the layout
    // changes WITHOUT a window resize: the responsive shell flips its flex
    // direction at the md breakpoint (stacked ↔ sidebar), the device rotates,
    // or a mobile collapsible panel above the map expands/collapses. MapLibre's
    // built-in `trackResize` only listens to window `resize`, so a pure
    // container reflow would otherwise leave the canvas at its old size (a
    // stretched/letterboxed map). Coalesce bursts (orientation changes fire
    // many) into a single resize per animation frame — resizing inside rAF
    // rather than synchronously in the callback also avoids the "ResizeObserver
    // loop" warning. Guarded for non-DOM test environments (jsdom has no
    // ResizeObserver); the fake test map has no resize(), hence optional call.
    let resizeRaf = 0;
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (resizeRaf) return;
            resizeRaf = requestAnimationFrame(() => {
              resizeRaf = 0;
              mapRef.current?.resize?.();
            });
          })
        : null;
    resizeObserver?.observe(containerRef.current);

    return () => {
      loadedRef.current = false;
      appliedTileUrlRef.current = null;
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeObserver?.disconnect();
      hoverPopupRef.current?.remove();
      hoverPopupRef.current = null;
      hoveredRegionRef.current = null;
      pinnedPopupRef.current?.remove();
      pinnedPopupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const refresh = () => {
      // Invalidate the hover-tooltip cache: the region source is about to be
      // re-stamped with new metric/value/period, so the next mousemove over the
      // same region must rebuild the tooltip HTML rather than reuse the stale one
      // (the cache is keyed by region code, which does not change on a metric swap).
      // Also close any tooltip currently visible so a stale label/value is not left
      // on screen until the next pointer move; it is recreated on the next mousemove.
      hoveredRegionRef.current = null;
      hoverPopupRef.current?.remove();
      const regionsData: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: boundaries.features.map((feature) => {
          const value = regionValues.get(feature.properties.region_code);
          const reason = feature.properties.unavailable_reason;
          return {
            type: "Feature" as const,
            geometry: feature.geometry,
            properties: {
              ...feature.properties,
              has_value: value !== undefined,
              metric_value: value?.numeric ?? 0,
              metric_label: metricLabel,
              metric_reference_period: metricReferencePeriod,
              metric_display: formatRegionMetricDisplay(value?.display, metricUnit, reason),
            },
          };
        }),
      };
      const facilitiesData: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: facilities
          .filter((facility) => facility.longitude !== null && facility.latitude !== null)
          .map((facility) => ({
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [facility.longitude as number, facility.latitude as number],
            },
            properties: {
              facility_name: facility.facility_name,
              category_label:
                FACILITY_CATEGORY_LABELS[facility.facility_category] ?? facility.facility_category,
              color: FACILITY_CATEGORY_COLORS[facility.facility_category] ?? "#333333",
              throughput:
                facility.throughput_quantity !== null
                  ? `${formatQuantity(facility.throughput_quantity)} ${facility.throughput_unit ?? ""}`
                  : null,
              address: facility.address,
              source_id: facility.source_id,
              reference_period: facility.reference_period,
            },
          })),
      };

      // --- Regions (equity choropleth) ---
      const regionsSource = map.getSource("regions") as maplibregl.GeoJSONSource | undefined;
      if (regionsSource) {
        regionsSource.setData(regionsData);
      } else {
        map.addSource("regions", { type: "geojson", data: regionsData });
        map.addLayer({
          id: "regions-fill",
          type: "fill",
          source: "regions",
          paint: { "fill-color": fillColorExpression(breaks, palette), "fill-opacity": 0.72 },
        });
        map.addLayer({
          id: "regions-outline",
          type: "line",
          source: "regions",
          paint: { "line-color": "#4b5563", "line-width": 0.8 },
        });
        map.on("click", "regions-fill", (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          const props = feature.properties as Record<string, string>;
          // Store only the region CODE; page state derives the accessible summary
          // (name, label, value, provenance) under the currently-active metric, so
          // it never carries a value snapshot that could go stale on a metric change.
          onRegionClickRef.current?.(props.region_code);
          // Tap/click pins a popup (this is the mobile path — no hover there).
          // Retain it in a ref so a metric/mode change (or the next click) can close
          // it before its label/value goes stale; remove any prior pin first so
          // exactly one stays on screen instead of accumulating abandoned popups.
          pinnedPopupRef.current?.remove();
          pinnedPopupRef.current = new maplibregl.Popup()
            .setLngLat(event.lngLat)
            .setHTML(regionPopupHtml(props))
            .addTo(map);
        });

        // Desktop hover: a lightweight tooltip that follows the pointer, showing
        // the same information as the tap popup. Touch devices have no hover, so
        // the tap popup above is their path; a synthetic mouse event there is
        // cleared by mouseleave. The tooltip HTML is rebuilt only when the pointer
        // enters a different region (setLngLat still tracks every move).
        map.on("mousemove", "regions-fill", (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          map.getCanvas().style.cursor = "pointer";
          const props = feature.properties as Record<string, unknown>;
          if (!hoverPopupRef.current) {
            hoverPopupRef.current = new maplibregl.Popup({
              closeButton: false,
              closeOnClick: false,
              className: "wep-hover-tooltip",
            });
          }
          const code = String(props.region_code);
          if (hoveredRegionRef.current !== code) {
            hoveredRegionRef.current = code;
            hoverPopupRef.current.setHTML(regionPopupHtml(props));
          }
          hoverPopupRef.current.setLngLat(event.lngLat).addTo(map);
        });
        map.on("mouseleave", "regions-fill", () => {
          map.getCanvas().style.cursor = "";
          hoveredRegionRef.current = null;
          hoverPopupRef.current?.remove();
        });
      }
      map.setPaintProperty("regions-fill", "fill-color", fillColorExpression(breaks, palette));

      // --- Candidate grid (suitability) as PostGIS vector tiles ---
      // The whole grid is available as MVT; the viewport pulls only the tiles it
      // needs. On a profile switch the tile URL changes, so remove and re-add the
      // vector source (its tiles are immutable once added). Never a bbox slice.
      const addCandidateSource = (url: string) => {
        map.addSource("candidates", {
          type: "vector",
          tiles: [url],
          minzoom: 0,
          maxzoom: CANDIDATE_TILE_MAX_ZOOM,
        });
        map.addLayer({
          id: "candidates-fill",
          type: "fill",
          source: "candidates",
          "source-layer": SUITABILITY_TILE_SOURCE_LAYER,
          paint: {
            "fill-color": candidateColorExpression(candidateBreaks),
            "fill-opacity": CANDIDATE_OPACITY,
          },
        });
        map.addLayer({
          id: "candidates-review-outline",
          type: "line",
          source: "candidates",
          "source-layer": SUITABILITY_TILE_SOURCE_LAYER,
          filter: ["==", ["get", "status"], "REVIEW_REQUIRED"],
          paint: { "line-color": "#b45309", "line-width": 0.9, "line-dasharray": [2, 1.5] },
        });
      };
      const removeCandidateSource = () => {
        for (const id of CANDIDATE_LAYER_IDS) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource("candidates")) map.removeSource("candidates");
      };

      if (candidateTileUrl) {
        if (!map.getSource("candidates")) {
          // Entering suitability mode: the candidate tiles start loading.
          setCandidateLoading(true);
          addCandidateSource(candidateTileUrl);
          appliedTileUrlRef.current = candidateTileUrl;
        } else if (appliedTileUrlRef.current !== candidateTileUrl) {
          // Profile switch: re-point at the new immutable tiles (they reload).
          setCandidateLoading(true);
          removeCandidateSource();
          addCandidateSource(candidateTileUrl);
          appliedTileUrlRef.current = candidateTileUrl;
        }
        map.setPaintProperty(
          "candidates-fill",
          "fill-color",
          candidateColorExpression(candidateBreaks),
        );
        map.setFilter("candidates-fill", statusFilter(statusVisibility));
      } else {
        // No run to render (e.g. equity mode): ensure the refresh indicator can
        // never remain visible outside suitability.
        setCandidateLoading(false);
      }

      // --- Facilities ---
      const facilitiesSource = map.getSource("facilities") as maplibregl.GeoJSONSource | undefined;
      if (facilitiesSource) {
        facilitiesSource.setData(facilitiesData);
      } else {
        map.addSource("facilities", { type: "geojson", data: facilitiesData });
        map.addLayer({
          id: "facilities-points",
          type: "circle",
          source: "facilities",
          paint: {
            "circle-radius": 4.5,
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1,
          },
        });
        map.on("click", "facilities-points", (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          const props = feature.properties as Record<string, string | null>;
          new maplibregl.Popup()
            .setLngLat(event.lngLat)
            .setHTML(
              `<strong>${props.facility_name}</strong><br/>${props.category_label}<br/>` +
                `${props.throughput ? `연간 처리량: ${props.throughput}<br/>` : ""}` +
                `${props.address}<br/>` +
                `<small>출처: ${props.source_id} · 기준연도: ${props.reference_period}</small>`,
            )
            .addTo(map);
        });
      }

      // --- Mode + visibility toggles (guarded: candidate layers exist only once
      // a run's tile URL has been applied) ---
      const equity = mode === "equity";
      const suitability = mode === "suitability";
      map.setLayoutProperty("regions-fill", "visibility", equity ? "visible" : "none");
      map.setLayoutProperty("regions-outline", "visibility", equity ? "visible" : "none");
      if (map.getLayer("candidates-fill")) {
        map.setLayoutProperty("candidates-fill", "visibility", suitability ? "visible" : "none");
      }
      if (map.getLayer("candidates-review-outline")) {
        map.setLayoutProperty(
          "candidates-review-outline",
          "visibility",
          suitability ? "visible" : "none",
        );
      }
      map.setLayoutProperty(
        "facilities-points",
        "visibility",
        showFacilities ? "visible" : "none",
      );
    };

    if (loadedRef.current) {
      refresh();
      return;
    }
    map.on("wep:refresh", refresh);
    return () => {
      map.off("wep:refresh", refresh);
    };
  }, [
    boundaries,
    regionValues,
    breaks,
    palette,
    metricLabel,
    metricUnit,
    metricReferencePeriod,
    facilities,
    showFacilities,
    mode,
    candidateTileUrl,
    candidateBreaks,
    statusVisibility,
  ]);

  // Close any pinned region popup when the active metric (label/unit/reference
  // period) or the mode changes: its rendered content would otherwise show the
  // previous metric's label and value. The sidebar's selected-region summary is
  // derived from the region code in page state and updates independently, so the
  // selection stays active — only the on-map pin is dismissed; the next click
  // rebuilds it from the new metric. Runs on mount too (pin is null → no-op).
  // The deps are the change TRIGGER; the body itself only touches a ref, hence the
  // exhaustive-deps exception (as with the selected-candidate movement effect).
  useEffect(() => {
    pinnedPopupRef.current?.remove();
    pinnedPopupRef.current = null;
  }, [metricLabel, metricUnit, metricReferencePeriod, mode]);

  // --- Selected-candidate highlight + map movement (list or map selection) ---
  // Uses the full selected geometry (from the candidate detail endpoint) so an
  // off-viewport candidate is both highlighted and brought into view. Keyed on the
  // candidate id so it only moves on an actual selection change, not every render.
  const selectedId = selectedCandidate?.candidate_id ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    if (!map.getSource("selected-candidate")) {
      map.addSource("selected-candidate", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "selected-candidate-fill",
        type: "fill",
        source: "selected-candidate",
        paint: { "fill-color": SELECTED_FILL_COLOR, "fill-opacity": 0.3 },
      });
      map.addLayer({
        id: "selected-candidate-outline",
        type: "line",
        source: "selected-candidate",
        paint: { "line-color": SELECTED_OUTLINE_COLOR, "line-width": 3 },
      });
    }

    const source = map.getSource("selected-candidate") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (!selectedCandidate) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: selectedCandidate.geometry,
          properties: { candidate_id: selectedCandidate.candidate_id },
        },
      ],
    });

    const bounds = geometryBounds(selectedCandidate.geometry);
    if (!bounds) return;
    if (isDegenerateBounds(bounds)) {
      // Point geometry: centroid fallback.
      map.flyTo({ center: bounds[0], zoom: Math.min(15, OSM_MAX_ZOOM), duration: 700 });
    } else {
      map.fitBounds(bounds, { padding: 96, maxZoom: 16, duration: 700 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // The MapLibre canvas is not reachable by keyboard or screen readers, so the
  // container is a labelled `region` landmark with a textual description that
  // points AT users to the accessible DOM alternatives (selected-region summary,
  // top-candidate list, candidate detail) rendered in the sidebar. This is the
  // accessible-name/description pattern for a map, not a bare canvas role.
  return (
    <div className="relative h-full w-full">
      <p id="map-accessible-description" className="sr-only">
        {ariaDescription}
      </p>
      <div
        ref={containerRef}
        role="region"
        aria-label={ariaLabel}
        aria-describedby="map-accessible-description"
        className="h-full w-full"
        data-testid="map-container"
      />

      {/* Initial map-loading overlay. A polite live region so assistive tech
          announces the loading state and its resolution; `pointer-events-none` so
          it never blocks map interaction (and it unmounts once the map has loaded,
          so it can never trap pointer/keyboard focus afterwards). */}
      {mapLoading && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70"
          data-testid="map-loading"
          role="status"
          aria-live="polite"
        >
          <span className="rounded bg-slate-800/90 px-3 py-1.5 text-sm font-medium text-white shadow">
            지도를 불러오는 중… (Loading map…)
          </span>
        </div>
      )}

      {/* Suitability candidate tile-refresh indicator. Only while the map is
          already usable (not during initial load), and only a couple of times
          (entering suitability / switching profile), so it is not a noisy per-tile
          announcement. `pointer-events-none` keeps the map interactive. */}
      {candidateLoading && !mapLoading && (
        <div
          className="pointer-events-none absolute inset-x-0 top-3 flex justify-center"
          data-testid="candidate-loading"
          role="status"
          aria-live="polite"
        >
          <span className="rounded bg-slate-800/90 px-3 py-1 text-xs font-medium text-white shadow">
            후보지 타일을 갱신하는 중… (Refreshing candidate tiles…)
          </span>
        </div>
      )}

      {/* Concise, non-blocking map error. Never a full-screen fatal takeover for a
          transient tile failure (see the "error" handler), and it makes no claim
          about official data availability — the application-level backend error
          state and the accessible DOM alternatives remain in place. */}
      {mapError && (
        <div
          className="absolute inset-x-2 bottom-2 rounded border border-red-300 bg-white/95 px-3 py-2 text-xs text-red-700 shadow"
          data-testid="map-error"
          role="alert"
        >
          {mapError}
        </div>
      )}
    </div>
  );
}
