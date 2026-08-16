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
 *
 * Two SEPARATE optional environmental layers can be overlaid, each read-only and
 * neither carrying any score, rank, exclusion, or legal effect: the inland-wetland
 * inventory (Phase 1B-2) and the land-cover candidate-cell statistics (Phase 1B-LC5B).
 * The land-cover layer draws the same 500 m grid from a VERSION-PINNED MVT endpoint —
 * raw land-cover polygons are never requested and never rendered.
 */

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type {
  FacilityItem,
  RegionBoundaryCollection,
  SuitabilityStatus,
  WetlandFeatureDetail,
} from "../lib/api";
import {
  LAND_COVER_CELL_TILE_SOURCE_LAYER,
  SUITABILITY_TILE_SOURCE_LAYER,
  WETLAND_TILE_SOURCE_LAYER,
  fetchWetlandDetail,
} from "../lib/api";
import type { ClassLevel } from "../lib/landCover";
import {
  LAND_COVER_COVERAGE_OUTLINE_COLORS,
  type LandCoverAvailableClasses,
  type LandCoverCoverageVisibility,
  type LandCoverVisualizationMode,
  collectAvailableClasses,
  landCoverFillColor,
  landCoverFillOpacity,
  landCoverFilter,
  landCoverStatusOutlineFilter,
} from "../lib/landCoverLayer";
import {
  CANDIDATE_EXCLUDED_COLOR,
  CANDIDATE_REVIEW_COLOR,
  CANDIDATE_SCORE_PALETTE_5,
  CANDIDATE_STABLE_OUTLINE_COLOR,
  FACILITY_CATEGORY_COLORS,
  FACILITY_CATEGORY_GLYPHS,
  FACILITY_CATEGORY_LABELS,
  NO_DATA_COLOR,
  formatQuantity,
  markerGlyphInk,
} from "../lib/metrics";
import { formatRegionMetricDisplay } from "../lib/regionDisplay";
import { geometryBounds, isDegenerateBounds, stabilityBadgeLabel } from "../lib/suitability";
import { statusLabel } from "../lib/glossary";
import type { WetlandType } from "../lib/wetland";
import {
  WETLAND_DESIGNATION_NOTE_LABEL,
  WETLAND_DETAIL_WARNING,
  WETLAND_OUTLINE_COLOR,
  WETLAND_PROVIDER,
  WETLAND_REFERENCE_DATE,
  WETLAND_TYPES,
  WETLAND_TYPE_COLORS,
  WETLAND_UM901_DISTINCTION,
  formatWetlandArea,
} from "../lib/wetland";

/**
 * The modes that actually render a map. The 수도권매립지 dashboard mode is not
 * one of them: its source declares metropolitan totals only, with no municipal
 * origin and no route, so there is nothing map-shaped to draw honestly.
 */
export type MapMode = "equity" | "suitability";

/**
 * Whether the suitability candidate tiles are a stored official/analytical profile
 * or a temporary user-weight scenario. Only affects popup labelling + legend text;
 * the tile properties (score/status/stable_count) are identical, so the fill,
 * outline, and highlight expressions are shared across both contexts.
 */
export type MapCandidateContext = "stored" | "scenario";

/**
 * The minimum a selected candidate needs for highlight + fly-to: its id and
 * geometry. Both the stored `CandidateDetail` and the scenario candidate detail
 * satisfy this, so scenario selection reuses the same single map highlight path.
 */
export interface SelectedCandidate {
  candidate_id: number;
  geometry: GeoJSON.Geometry;
}

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

const CANDIDATE_LAYER_IDS = [
  "candidates-fill",
  "candidates-review-outline",
  "candidates-stable-outline",
];

// The land-cover candidate-cell source draws the SAME 500 m grid as the candidate
// source, so it uses the same zoom bound: MapLibre overzooms above it rather than
// requesting a swarm of sub-cell tiles.
const LAND_COVER_TILE_MAX_ZOOM = CANDIDATE_TILE_MAX_ZOOM;

const LAND_COVER_SOURCE_ID = "land-cover-cells";
const LAND_COVER_FILL_LAYER_ID = "land-cover-cells-fill";
// Per-status line layers, so coverage state is carried by LINE TREATMENT as well as
// by fill color: a solid hairline for a fully-evaluated cell, a dashed outline for a
// partly-evaluated one, and a dotted outline for an unevaluated one.
const LAND_COVER_OUTLINE_LAYER_IDS = [
  "land-cover-cells-complete-outline",
  "land-cover-cells-partial-outline",
  "land-cover-cells-nocoverage-outline",
] as const;
const LAND_COVER_LAYER_IDS = [LAND_COVER_FILL_LAYER_ID, ...LAND_COVER_OUTLINE_LAYER_IDS];

// The inland-wetland vector source stops generating tiles at this zoom; MapLibre
// overzooms it above. Wetland polygons are surveyed features (not a 500 m grid),
// so a modest cap keeps a zoomed-in viewport from requesting a tile swarm.
const WETLAND_TILE_MAX_ZOOM = 12;
// Semi-transparent so the layer reads as background context beneath the
// candidate grid and never as an authoritative overlay.
const WETLAND_FILL_OPACITY = 0.5;

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

// --------------------------------------------------------------------------- //
// Facility markers — a colour-coded disc carrying its category's Korean initial
// --------------------------------------------------------------------------- //

/**
 * The marker used to be a flat 4.5px circle at every zoom: too small to carry any
 * information beyond its colour, and identical whether the reader was looking at
 * the whole capital region or one 동. Figma frame 222:439 draws glyph-bearing
 * markers (소 · 매 · 기 · 재), which is what this builds.
 *
 * ── THE DISC AND THE GLYPH ARE TWO LAYERS, ON PURPOSE ────────────────────────────
 * `facilities-points` stays a CIRCLE layer and keeps its id, so the map-level click
 * priority handler, the hover-cursor suppression, and the land-cover `before:`
 * anchor all keep addressing exactly what they addressed before. The glyph is a
 * SEPARATE symbol layer painted over it from runtime-generated images.
 *
 * That split is what makes the glyph a progressive enhancement rather than a
 * dependency. MapLibre can only draw `text-field` from a glyph server, and this
 * style is a bare OSM raster with no `glyphs` URL — adding one would put a
 * third-party font CDN in the request path of every map load for a decorative
 * character. Canvas-rendered `addImage` icons need no font server at all, and where
 * a 2D canvas context is unavailable (SSR, jsdom) `ensureFacilityMarkerImages`
 * reports failure, the symbol layer is simply never added, and the markers degrade
 * to the discs — never to nothing.
 *
 * ── LEGIBILITY ACROSS ZOOM ───────────────────────────────────────────────────────
 * The disc radius now ramps with zoom, so the mark is a readable target when zoomed
 * in without burying the choropleth at a capital-region view. The glyph layer is
 * gated at `FACILITY_GLYPH_MIN_ZOOM`, below which a disc is physically too small to
 * hold a Hangul syllable at a readable size: printing one there would be decoration
 * pretending to be information. From that zoom up the glyph scales with the disc and
 * stays legible. MapLibre's own collision detection thins the glyphs in a dense
 * cluster (the discs are all still drawn), so the layer never becomes a solid mat of
 * overlapping characters.
 *
 * Colour remains the primary carrier and the popup names the category in words, so
 * a thinned or absent glyph never removes the only signal.
 */
const FACILITY_ICON_PREFIX = "facility-glyph-";

/** Below this zoom the disc cannot hold a readable Hangul syllable. */
const FACILITY_GLYPH_MIN_ZOOM = 9.5;

/** Rendered at 2× so the glyph stays crisp on a HiDPI display. */
const FACILITY_ICON_PIXEL_RATIO = 2;
/** CSS-pixel box of one glyph image; the character is drawn centred inside it. */
const FACILITY_ICON_BOX = 20;

/** Disc radius by zoom: readable when zoomed in, unobtrusive at region scale. */
const FACILITY_CIRCLE_RADIUS: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  7,
  5,
  9.5,
  7.5,
  12,
  10.5,
  15,
  13,
];

/** Glyph size, tracking the disc so the character always sits inside its mark. */
const FACILITY_ICON_SIZE: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  9.5,
  0.62,
  12,
  0.88,
  15,
  1.1,
];

/**
 * One category's glyph as an `addImage`-ready bitmap, or null when this environment
 * has no 2D canvas (SSR, jsdom) — callers fall back to the plain disc.
 */
function facilityGlyphImage(
  glyph: string,
  ink: string,
): { width: number; height: number; data: Uint8ClampedArray } | null {
  if (typeof document === "undefined") return null;
  const size = FACILITY_ICON_BOX * FACILITY_ICON_PIXEL_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${13 * FACILITY_ICON_PIXEL_RATIO}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.fillText(glyph, size / 2, size / 2 + FACILITY_ICON_PIXEL_RATIO);
  try {
    const image = ctx.getImageData(0, 0, size, size);
    return { width: size, height: size, data: image.data };
  } catch {
    // A tainted or unsupported canvas: fall back to discs rather than throwing
    // inside the map's data effect.
    return null;
  }
}

/**
 * Latched once the environment has proved it cannot rasterise a glyph, so an
 * environment without a 2D canvas is asked exactly once instead of on every map
 * instance and every data refresh.
 */
let facilityGlyphsUnavailable = false;

/**
 * Register one glyph image per REAL served category. Returns false if any could not
 * be produced, in which case the caller skips the symbol layer entirely rather than
 * drawing a partial alphabet where some categories have a character and others do
 * not.
 */
function ensureFacilityMarkerImages(map: maplibregl.Map): boolean {
  if (facilityGlyphsUnavailable) return false;
  for (const [category, glyph] of Object.entries(FACILITY_CATEGORY_GLYPHS)) {
    const id = `${FACILITY_ICON_PREFIX}${category}`;
    if (map.hasImage?.(id)) continue;
    const image = facilityGlyphImage(glyph, markerGlyphInk(FACILITY_CATEGORY_COLORS[category]));
    if (!image) {
      facilityGlyphsUnavailable = true;
      return false;
    }
    map.addImage(id, image, { pixelRatio: FACILITY_ICON_PIXEL_RATIO });
  }
  return true;
}

/** Test seam: lets a spec re-probe the canvas after installing/removing a stub. */
export function __resetFacilityGlyphProbe(): void {
  facilityGlyphsUnavailable = false;
}

// Seoul + Incheon + Gyeonggi-do extent.
const SMA_BOUNDS: [[number, number], [number, number]] = [
  [125.8, 36.8],
  [127.9, 38.4],
];

// Status colors sourced from metrics.ts so the map fill and the floating legend
// (MapLegendOverlay) can never diverge.
const EXCLUDED_COLOR = CANDIDATE_EXCLUDED_COLOR;
const REVIEW_COLOR = CANDIDATE_REVIEW_COLOR;
const STABLE_OUTLINE_COLOR = CANDIDATE_STABLE_OUTLINE_COLOR;
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
   * Inland-wetland inventory (내륙습지 목록) — a SEPARATE optional environmental
   * layer, rendered below the candidate/selection layers. Read-only context: it
   * carries no score, no exclusion, and is distinct from the statutory UM901
   * layer. `wetlandTileUrl` is the constant MVT template; null disables the layer.
   */
  showWetlands: boolean;
  wetlandTileUrl: string | null;
  /** Per-type visibility (하천/호수/산지/인공) — doubles as the legend selection. */
  wetlandTypeVisibility: Record<WetlandType, boolean>;
  /** Restrict to features carrying a source designation note (EXP). */
  wetlandDesignationOnly: boolean;
  /**
   * Land-cover candidate-cell statistics (토지피복 격자 통계) — a SEPARATE optional
   * layer over the SAME 500 m candidate grid, available only in suitability mode.
   * `landCoverTileUrl` is the VERSION-PINNED MVT template (it embeds the immutable
   * LC3 statistics version); null when no active release resolved, which disables the
   * layer entirely. Read-only and descriptive: it carries no score, rank, status,
   * exclusion, or legal effect, and it never changes the suitability tiles.
   */
  showLandCover: boolean;
  landCoverTileUrl: string | null;
  /** "coverage" (평가 범위) or "dominant" (우세 분류). Paint-only; never reloads tiles. */
  landCoverMode: LandCoverVisualizationMode;
  /** Active official hierarchy level for dominant-class mode (1 대 / 2 중 / 3 세분류). */
  landCoverClassLevel: ClassLevel;
  /** Per-status visibility — doubles as the coverage legend selection. */
  landCoverCoverage: LandCoverCoverageVisibility;
  /** Explicitly-unchecked official class codes at the ACTIVE level. */
  landCoverHiddenClassCodes: readonly string[];
  /**
   * The official classes the legend currently offers, per level. The fill's `match`
   * arms are built from this same list, so the legend swatch and the painted cell can
   * never disagree.
   */
  landCoverClasses: LandCoverAvailableClasses;
  /**
   * Reports the official classes present in the loaded tiles, so the control can offer
   * a filter list built from what the release actually served rather than a hardcoded
   * vocabulary. Called only when the observed set grows.
   */
  onLandCoverClassesChange?: (classes: LandCoverAvailableClasses) => void;
  /**
   * MVT tile-URL template ("…/{z}/{x}/{y}.mvt") for the active run + profile, or
   * null when there is no suitability run to render (e.g. equity mode). Changing
   * it (profile switch) re-points the vector source at the new immutable tiles.
   */
  candidateTileUrl: string | null;
  /** Stable interior score thresholds for the candidate palette (never per-viewport). */
  candidateBreaks: readonly number[];
  statusVisibility: StatusVisibility;
  /**
   * When true, ELIGIBLE cells are restricted to weight-stable ones (stable_count
   * = 3); REVIEW_REQUIRED/EXCLUDED remain governed by statusVisibility. Independent
   * of the canonical status filter — never reclassifies review/excluded as
   * unstable. STABLE eligible cells always receive a distinct outline regardless.
   */
  stableOnly: boolean;
  /**
   * ① 분석 범위, as the exact SIGUNGU codes the ranking request carried, or null
   * when the scope is 수도권 전체 / a 시·도 (see `candidateScopeFilter`). Applied
   * with `setFilter` on the existing source — the vector tiles are immutable and
   * scope-independent, so narrowing the scope never re-points, reloads, or remounts
   * the map.
   */
  candidateScopeCodes?: readonly string[] | null;
  /** Currently-selected candidate (list or map). Drives highlight + map movement. */
  selectedCandidate: SelectedCandidate | null;
  onCandidateClick: (candidateId: number) => void;
  /**
   * "stored" (default) or "scenario" — labels the candidate popup/score line so a
   * user-weight scenario tile reads as 사용자 가정 기반 점수, not an official score.
   */
  candidateContext?: MapCandidateContext;
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

/**
 * ① 분석 범위, as a tile-attribute predicate — or null when the scope cannot be
 * expressed exactly.
 *
 * The candidate tile carries `sigungu_region_code`, so a 시·군·구 scope filters the
 * map on THE SAME attribute the `/candidates` request filtered on, and the two
 * surfaces show exactly the same cells.
 *
 * A 시·도 scope returns null — deliberately. The tile does not carry
 * `sido_region_code`, and the two codes come from independent `ST_Covers` lookups
 * against non-coincident layers, so deriving a 시·도 from the 시·군·구 code would
 * filter a DIFFERENT population from the one the ranking counted (that inference is
 * exactly why "서울" has three different totals). Showing the unfiltered grid and
 * saying so is honest; showing a near-miss silently is not.
 */
function candidateScopeFilter(
  sigunguCodes: readonly string[] | null,
): maplibregl.ExpressionSpecification | null {
  if (sigunguCodes === null || sigunguCodes.length === 0) return null;
  return [
    "in",
    ["get", "sigungu_region_code"],
    ["literal", [...sigunguCodes]],
  ] as unknown as maplibregl.ExpressionSpecification;
}

// Candidate fill filter. The canonical statusVisibility state is always honored;
// `stableOnly` is an independent, additive restriction that limits ELIGIBLE cells
// to weight-stable ones (stable_count = 3) without touching how REVIEW_REQUIRED /
// EXCLUDED are governed — those never get reclassified as "unstable".
function candidateFillFilter(
  visibility: StatusVisibility,
  stableOnly: boolean,
  sigunguCodes: readonly string[] | null = null,
): maplibregl.FilterSpecification {
  const visible = (Object.keys(visibility) as SuitabilityStatus[]).filter((s) => visibility[s]);
  const statusIn = ["in", ["get", "status"], ["literal", visible]];
  const scope = candidateScopeFilter(sigunguCodes);
  const clauses: unknown[] = [statusIn];
  if (stableOnly) {
    clauses.push([
      "any",
      ["!=", ["get", "status"], "ELIGIBLE"],
      ["==", ["get", "stable_count"], 3],
    ]);
  }
  if (scope !== null) clauses.push(scope);
  if (clauses.length === 1) return statusIn as unknown as maplibregl.FilterSpecification;
  return ["all", ...clauses] as unknown as maplibregl.FilterSpecification;
}

// Dashed outline for REVIEW_REQUIRED cells, narrowed by the same scope predicate so
// it can never outline a cell the scoped fill has removed.
function reviewOutlineFilter(
  sigunguCodes: readonly string[] | null = null,
): maplibregl.FilterSpecification {
  const isReview = ["==", ["get", "status"], "REVIEW_REQUIRED"];
  const scope = candidateScopeFilter(sigunguCodes);
  if (scope === null) return isReview as unknown as maplibregl.FilterSpecification;
  return ["all", isReview, scope] as unknown as maplibregl.FilterSpecification;
}

// Distinct outline for STABLE eligible cells, shown whenever ELIGIBLE cells are
// visible (independent of stableOnly). Matches nothing when ELIGIBLE is hidden.
function stableOutlineFilter(
  visibility: StatusVisibility,
  sigunguCodes: readonly string[] | null = null,
): maplibregl.FilterSpecification {
  if (!visibility.ELIGIBLE) {
    return ["==", ["get", "status"], "__none__"] as unknown as maplibregl.FilterSpecification;
  }
  const scope = candidateScopeFilter(sigunguCodes);
  return [
    "all",
    ["==", ["get", "status"], "ELIGIBLE"],
    ["==", ["get", "stable_count"], 3],
    ...(scope !== null ? [scope] : []),
  ] as unknown as maplibregl.FilterSpecification;
}

// --- Inland-wetland inventory layer (Phase 1B-2) -----------------------------
// A SEPARATE optional environmental layer. Its fill is a flat categorical color
// by wetland type (never a score step) and it carries no legal/exclusion effect.

// Categorical fill by the source wetland type; an unknown type falls back to a
// neutral gray (never dropped, never a danger red).
function wetlandColorExpression(): maplibregl.ExpressionSpecification {
  return [
    "match",
    ["get", "wetland_type"],
    "하천습지",
    WETLAND_TYPE_COLORS["하천습지"],
    "호수습지",
    WETLAND_TYPE_COLORS["호수습지"],
    "산지습지",
    WETLAND_TYPE_COLORS["산지습지"],
    "인공습지",
    WETLAND_TYPE_COLORS["인공습지"],
    "#9aa2ad",
  ] as unknown as maplibregl.ExpressionSpecification;
}

// Wetland filter: only the enabled types, optionally restricted to features that
// carry a source designation note (`designation_note` is present in the tile only
// when non-null). When no type is enabled the layer matches nothing.
function wetlandFilter(
  typeVisibility: Record<WetlandType, boolean>,
  designationOnly: boolean,
): maplibregl.FilterSpecification {
  const visible = WETLAND_TYPES.filter((t) => typeVisibility[t]);
  const typeIn = ["in", ["get", "wetland_type"], ["literal", visible]];
  if (!designationOnly) {
    return typeIn as unknown as maplibregl.FilterSpecification;
  }
  return ["all", typeIn, ["has", "designation_note"]] as unknown as maplibregl.FilterSpecification;
}

/**
 * The inland-wetland click popup HTML. Built from the lightweight tile properties
 * (name, type, area, designation note) plus the constant provider/reference-date,
 * the statutory-status warning, and the UM901 distinction. When the feature detail
 * has been fetched it additionally shows the source 시도/시군구 and address (which
 * never travel in the tile). Exported so it can be asserted directly in tests.
 *
 * `designation_note` is rendered only as labelled source text (원자료 지정 메모) — it
 * is never presented as a legal determination.
 */
export function wetlandPopupHtml(
  props: Record<string, unknown>,
  detail?: WetlandFeatureDetail | null,
): string {
  const name = props.wetland_name ?? detail?.wetland_name ?? "내륙습지";
  const type = props.wetland_type ?? detail?.wetland_type ?? "";
  const areaRaw = props.reported_area_m2 ?? detail?.reported_area_m2 ?? null;
  const area = formatWetlandArea(areaRaw == null ? null : Number(areaRaw));
  const note = props.designation_note ?? detail?.designation_note ?? null;
  const noteLine = note ? `<br/>${WETLAND_DESIGNATION_NOTE_LABEL}: ${note}` : "";
  const regionText = detail
    ? [detail.source_sido_name, detail.source_sigungu_name].filter(Boolean).join(" ")
    : "";
  const regionLine = regionText ? `<br/>출처 시도/시군구: ${regionText}` : "";
  const addressLine = detail?.source_address ? `<br/>주소: ${detail.source_address}` : "";
  return (
    `<strong>${name}</strong><br/>` +
    `습지 유형: ${type}<br/>` +
    `면적: ${area}` +
    regionLine +
    addressLine +
    noteLine +
    `<br/><small>제공기관: ${WETLAND_PROVIDER} · 기준일: ${WETLAND_REFERENCE_DATE}</small>` +
    `<br/><small>${WETLAND_DETAIL_WARNING}</small>` +
    `<br/><small>${WETLAND_UM901_DISTINCTION}</small>`
  );
}

/** Minimal HTML escaping for served strings interpolated into popup markup. */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One `label  value` provenance row, in the popup's smallest type. */
function metaRow(label: string, value: string): string {
  return (
    `<div class="wep-popup-meta"><span class="wep-popup-meta-label">${esc(label)}</span>` +
    `<span>${esc(value)}</span></div>`
  );
}

/**
 * The facility half of the map popup: the served attributes of ONE facility.
 * Every line is a served value; a facility without a throughput simply omits that
 * line rather than printing a 0 or a dash.
 */
function facilitySectionHtml(props: Record<string, unknown>): string {
  const throughput = props.throughput
    ? `<div class="wep-popup-line">연간 처리량: ${esc(props.throughput)}</div>`
    : "";
  const address = props.address ? `<div class="wep-popup-line">${esc(props.address)}</div>` : "";
  return (
    `<div class="wep-popup-rule"></div>` +
    `<div class="wep-popup-subtitle">${esc(props.facility_name)}</div>` +
    `<div class="wep-popup-line">${esc(props.category_label)}</div>` +
    throughput +
    address +
    metaRow("시설 출처", `${esc(props.source_id)} · 기준 ${esc(props.reference_period)}`)
  );
}

/**
 * The popup for a facility clicked where no region polygon is rendered underneath
 * it (the suitability map, or a marker just outside the loaded boundaries). Same
 * facility block, without a region header it has no data for.
 */
export function facilityOnlyPopupHtml(props: Record<string, unknown>): string {
  return (
    `<div class="wep-popup-title">${esc(props.facility_name)}</div>` +
    `<div class="wep-popup-line">${esc(props.category_label)}</div>` +
    (props.throughput
      ? `<div class="wep-popup-line">연간 처리량: ${esc(props.throughput)}</div>`
      : "") +
    (props.address ? `<div class="wep-popup-line">${esc(props.address)}</div>` : "") +
    metaRow("시설 출처", `${esc(props.source_id)} · 기준 ${esc(props.reference_period)}`)
  );
}

/**
 * The region tooltip/popup HTML, shared by the desktop hover tooltip and the
 * click/tap popup so both show the same information: region name, selected metric
 * label, the exact served value with unit (or the availability text — never a
 * fabricated 0), the metric's reference period, and the boundary provenance.
 * `props` are the MapLibre-serialized feature properties (strings/booleans).
 *
 * ── PHASE 1: ONE POPUP, NOT TWO (Figma frame 223:449) ────────────────────────────
 * A facility marker sits ON TOP of the region fill, so a click used to reach BOTH
 * layer handlers: the facility opened its own popup, the region opened a second one
 * over it, and the region selection changed even though the reader had aimed at a
 * marker. The design shows a SINGLE popup carrying the region's indicator value and
 * the facility's details together ("지도에서 지역 선택 시, 폐기물 발생량과 매립장 정보
 * 한번에 뜨도록 수정"), which is what `facility` renders here. The click priority
 * that decides when it is passed lives in the map's own click handler below.
 */
export function regionPopupHtml(
  props: Record<string, unknown>,
  facility?: Record<string, unknown> | null,
): string {
  // `metric_display` already conveys availability: a served value with its unit,
  // or "데이터 없음 — {reason}" for a region with no served value (never a 0).
  const period = props.metric_reference_period
    ? metaRow("지표 기준 기간", String(props.metric_reference_period))
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
      // The RCIS derived-city caveat, intact: the reporting unit, the source, the
      // constituent 구, and the "no per-구 official value" note all stay. Only the
      // English `(city)` gloss on 시 is gone.
      metaRow("통계 보고 단위", "시 · 수치 출처: RCIS") +
      (children ? metaRow("포함 구", `SGIS ${children} 경계의 파생 합집합`) : "") +
      `<div class="wep-popup-line wep-popup-note">구별 공식 폐기물 값은 제공되지 않습니다.</div>`;
  }
  return (
    `<div class="wep-popup-title">${esc(props.region_name)}</div>` +
    `<div class="wep-popup-line">${esc(props.metric_label)}</div>` +
    `<div class="wep-popup-value">${esc(props.metric_display)}</div>` +
    (facility ? facilitySectionHtml(facility) : "") +
    `<div class="wep-popup-rule"></div>` +
    period +
    metaRow(
      "경계 기준",
      `${String(props.source_id ?? "")} (${String(props.boundary_reference_period ?? "")})`,
    ) +
    reportingLines +
    `<div class="wep-popup-line wep-popup-note">지표 출처는 좌측 '선택한 지역' 패널을 참조하세요.</div>`
  );
}

// Popup score line built from the light tile attributes (full provenance is
// fetched separately into the detail panel). Excluded cells carry no score/rank.
// Scenario tiles carry NO global rank (ranking the full ELIGIBLE population per
// tile would be wasteful) — the exact custom rank is fetched into the sidebar
// detail on selection; here the score alone is shown.
function candidateScoreDisplay(props: Record<string, unknown>, scenario = false): string {
  if (props.status === "EXCLUDED") return statusLabel("EXCLUDED");
  if (props.score != null) {
    // Scenario tiles carry no global rank; the exact custom rank is in the sidebar.
    return scenario ? `점수 ${props.score}` : `점수 ${props.score} · 순위 ${props.rank ?? "-"}`;
  }
  if (props.provisional_score != null) return `참고용 임시 점수 ${props.provisional_score}`;
  return "-";
}

// Concise stability line for the map popup. Only ELIGIBLE candidates carry a
// stable_count; review/excluded (and old runs) show nothing here.
function candidateStabilityDisplay(props: Record<string, unknown>): string {
  if (props.status !== "ELIGIBLE" || props.stable_count == null) return "";
  const label = stabilityBadgeLabel(
    props.stability_class == null ? null : String(props.stability_class),
    Number(props.stable_count),
  );
  return label ? `<br/>안정성: ${label}` : "";
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
  showWetlands,
  wetlandTileUrl,
  wetlandTypeVisibility,
  wetlandDesignationOnly,
  showLandCover,
  landCoverTileUrl,
  landCoverMode,
  landCoverClassLevel,
  landCoverCoverage,
  landCoverHiddenClassCodes,
  landCoverClasses,
  onLandCoverClassesChange,
  candidateTileUrl,
  candidateBreaks,
  statusVisibility,
  candidateScopeCodes = null,
  stableOnly,
  selectedCandidate,
  onCandidateClick,
  candidateContext = "stored",
  ariaLabel,
  ariaDescription,
  onRegionClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const onCandidateClickRef = useRef(onCandidateClick);
  const onRegionClickRef = useRef(onRegionClick);
  // Latest candidate context, read inside the once-bound click handler.
  const candidateContextRef = useRef<MapCandidateContext>(candidateContext);
  // The single candidate click/tap popup. Tracked so a scenario re-apply (new tile
  // URL / hash), a run change, or leaving scenario view can invalidate a stale
  // custom popup instead of leaving it pinned with outdated numbers.
  const candidatePopupRef = useRef<maplibregl.Popup | null>(null);
  // The single inland-wetland click popup. One at a time, like the candidate popup.
  const wetlandPopupRef = useRef<maplibregl.Popup | null>(null);
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
  // Same contract for the land-cover source: its tiles are pinned to an immutable
  // statistics version, so a version change means remove-and-re-add, not setData.
  const appliedLandCoverTileUrlRef = useRef<string | null>(null);
  // Latest class-discovery callback, read inside the once-bound map event handlers.
  const onLandCoverClassesChangeRef = useRef(onLandCoverClassesChange);
  useEffect(() => {
    onCandidateClickRef.current = onCandidateClick;
    onRegionClickRef.current = onRegionClick;
    candidateContextRef.current = candidateContext;
    onLandCoverClassesChangeRef.current = onLandCoverClassesChange;
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
        setMapError("지도를 초기화할 수 없습니다.");
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
      const scenario = candidateContextRef.current === "scenario";
      // Concise popup: region + plain status + main value + a short pointer to the
      // full detail. The long disclaimer, versions, and provenance stay in the
      // sidebar detail sheet — never crammed into the map popup.
      const status = String(props.status ?? "");
      const statusText =
        status === "ELIGIBLE" || status === "REVIEW_REQUIRED" || status === "EXCLUDED"
          ? statusLabel(status)
          : status;
      const footer = scenario
        ? "가중치 바꿔보기 임시 결과 · 법적 판정 아님 · 자세히는 왼쪽 상세"
        : "공공자료 1차 비교 · 법적 판정 아님 · 자세히는 왼쪽 목록";
      // Replace any prior pinned candidate popup rather than accumulate stale ones.
      candidatePopupRef.current?.remove();
      candidatePopupRef.current = new maplibregl.Popup()
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>${props.sigungu_region_name ?? "후보 구역"}</strong><br/>` +
            `${statusText}` +
            (candidateScoreDisplay(props, scenario) !== statusText
              ? ` · ${candidateScoreDisplay(props, scenario)}`
              : "") +
            candidateStabilityDisplay(props) +
            `<br/><small>${footer}</small>`,
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

    // Inland-wetland click: an immediate popup from the light tile attributes, then
    // (best-effort) enriched with the fetched detail's source 시도/시군구 + 주소.
    // Bound once, keyed by the stable layer id. This is a read-only disclosure —
    // it never changes any score, status, or selection.
    map.on("click", "wetlands-fill", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const props = feature.properties as Record<string, unknown>;
      wetlandPopupRef.current?.remove();
      const popup = new maplibregl.Popup()
        .setLngLat(event.lngLat)
        .setHTML(wetlandPopupHtml(props))
        .addTo(map);
      wetlandPopupRef.current = popup;
      const id = Number(props.id);
      if (!Number.isNaN(id)) {
        fetchWetlandDetail(id)
          .then((detail) => {
            // Only if this popup is still the current, still-open one.
            const open = typeof popup.isOpen === "function" ? popup.isOpen() : true;
            if (wetlandPopupRef.current === popup && open) {
              popup.setHTML(wetlandPopupHtml(props, detail));
            }
          })
          .catch(() => {
            // Enrichment is best-effort; the tile-based popup stays as shown.
          });
      }
    });
    map.on("mouseenter", "wetlands-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "wetlands-fill", () => {
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
    // The official land-cover classes actually present in the LOADED tiles. The
    // filter/legend vocabulary comes from the served data rather than a hardcoded
    // class list, so the UI can neither invent a class nor omit one the release has.
    // Read from the tile source (not from a second network request) and reported
    // upward; the page merges, so a class never disappears when it leaves the
    // viewport. Guarded for the non-WebGL test/jsdom map, which has no query method.
    const reportLandCoverClasses = () => {
      const report = onLandCoverClassesChangeRef.current;
      if (!report || !map.getSource(LAND_COVER_SOURCE_ID)) return;
      const query = map.querySourceFeatures?.bind(map);
      if (!query) return;
      try {
        const features = query(LAND_COVER_SOURCE_ID, {
          sourceLayer: LAND_COVER_CELL_TILE_SOURCE_LAYER,
        });
        report(collectAvailableClasses(features));
      } catch {
        // A source that is mid-reload has no queryable tiles yet; the next
        // sourcedata/idle event re-reads it. Never escalated to a visible error.
      }
    };

    map.on("sourcedata", (event) => {
      const e = event as unknown as { sourceId?: string; isSourceLoaded?: boolean };
      if (e && e.sourceId === "candidates" && e.isSourceLoaded) setCandidateLoading(false);
      if (e && e.sourceId === LAND_COVER_SOURCE_ID && e.isSourceLoaded) reportLandCoverClasses();
    });
    map.on("idle", () => {
      setCandidateLoading(false);
      reportLandCoverClasses();
    });

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
        setMapError("지도를 불러오지 못했습니다.");
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
      appliedLandCoverTileUrlRef.current = null;
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeObserver?.disconnect();
      hoverPopupRef.current?.remove();
      hoverPopupRef.current = null;
      hoveredRegionRef.current = null;
      pinnedPopupRef.current?.remove();
      pinnedPopupRef.current = null;
      candidatePopupRef.current?.remove();
      candidatePopupRef.current = null;
      wetlandPopupRef.current?.remove();
      wetlandPopupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Invalidate a pinned candidate popup whenever the candidate tiles change: a
  // scenario re-apply (new hash → new tile URL), a run/profile change, or leaving
  // scenario view all re-point `candidateTileUrl`, so a stale custom popup (old
  // score/weights) must not linger. The next click rebuilds it from the new tiles.
  useEffect(() => {
    candidatePopupRef.current?.remove();
    candidatePopupRef.current = null;
  }, [candidateTileUrl, candidateContext]);

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
              // The glyph image for this category, or "" for a served category the
              // platform does not recognise — an unknown category still gets its
              // (fallback-coloured) disc, and simply carries no invented initial.
              glyph_icon: FACILITY_CATEGORY_GLYPHS[facility.facility_category]
                ? `${FACILITY_ICON_PREFIX}${facility.facility_category}`
                : "",
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
        /**
         * ONE click handler for the region fill and the facility points, bound to
         * the MAP rather than to each layer.
         *
         * A per-layer binding is what produced the defect this replaces: MapLibre
         * delivers a click to EVERY layer under the pointer, so a facility marker
         * (drawn on top of the region fill) fired the facility handler AND the
         * region handler — two overlapping popups, plus a region selection the
         * reader never asked for. Stopping propagation is not available between
         * layer handlers, so the fix is to query the layers in PRIORITY ORDER once
         * and act on the winner:
         *
         *   1. a facility marker — the smallest, most deliberate target;
         *   2. an inland wetland — its own handler (bound above) already opened its
         *      popup, so the region path must not open a second one;
         *   3. the region fill — the default, and the only one that changes the
         *      canonical selected region.
         *
         * Hidden layers are excluded automatically: `queryRenderedFeatures` returns
         * nothing for a layer whose visibility is "none", which is exactly how the
         * facility toggle already works.
         */
        const layerHits = (point: maplibregl.Point, id: string) =>
          map.getLayer(id) ? map.queryRenderedFeatures(point, { layers: [id] }) : [];

        map.on("click", (event) => {
          const region = layerHits(event.point, "regions-fill")[0];
          const facility = layerHits(event.point, "facilities-points")[0];
          const wetland = layerHits(event.point, "wetlands-fill")[0];

          // A wetland click is answered by the wetland handler alone.
          if (!facility && wetland) return;
          if (!facility && !region) return;

          // Exactly one popup on screen at a time: replace any prior pin rather than
          // letting abandoned popups accumulate. Retained in a ref so a metric/mode
          // change can also close it before its label/value goes stale.
          pinnedPopupRef.current?.remove();
          pinnedPopupRef.current = null;
          // The hover tooltip would otherwise sit on top of the popup it duplicates.
          hoveredRegionRef.current = null;
          hoverPopupRef.current?.remove();

          if (facility) {
            // A marker was the target, so the region underneath is CONTEXT, not a
            // selection: `onRegionClick` is deliberately not called. The popup still
            // shows that region's active-metric value beside the facility, which is
            // the combined popup the design specifies.
            const regionProps = (region?.properties ?? null) as Record<string, unknown> | null;
            const facilityProps = facility.properties as Record<string, unknown>;
            pinnedPopupRef.current = new maplibregl.Popup()
              .setLngLat(event.lngLat)
              .setHTML(
                regionProps
                  ? regionPopupHtml(regionProps, facilityProps)
                  : facilityOnlyPopupHtml(facilityProps),
              )
              .addTo(map);
            return;
          }

          const props = region!.properties as Record<string, string>;
          // Store only the region CODE; page state derives the accessible summary
          // (name, label, value, provenance) under the currently-active metric, so
          // it never carries a value snapshot that could go stale on a metric change.
          onRegionClickRef.current?.(props.region_code);
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
          // Over a facility marker the click will open the COMBINED popup, so a
          // region-only tooltip hovering above it would preview the wrong thing.
          if (layerHits(event.point, "facilities-points").length > 0) {
            hoveredRegionRef.current = null;
            hoverPopupRef.current?.remove();
            return;
          }
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

      // --- Inland-wetland inventory (environmental context) as PostGIS vector tiles ---
      // Added BEFORE the candidate block so it stacks BELOW the candidate/selection
      // layers, and ABOVE the OSM basemap. The tile URL is constant (pinned to the
      // active release server-side), so the source is added once; only the type/
      // designation filter and on/off visibility change afterwards. A SEPARATE layer
      // from UM901 — never merged, never a hard exclusion, never scored.
      if (wetlandTileUrl) {
        if (!map.getSource("wetlands")) {
          map.addSource("wetlands", {
            type: "vector",
            tiles: [wetlandTileUrl],
            minzoom: 0,
            maxzoom: WETLAND_TILE_MAX_ZOOM,
          });
          map.addLayer({
            id: "wetlands-fill",
            type: "fill",
            source: "wetlands",
            "source-layer": WETLAND_TILE_SOURCE_LAYER,
            paint: {
              "fill-color": wetlandColorExpression(),
              "fill-opacity": WETLAND_FILL_OPACITY,
            },
          });
          map.addLayer({
            id: "wetlands-outline",
            type: "line",
            source: "wetlands",
            "source-layer": WETLAND_TILE_SOURCE_LAYER,
            paint: { "line-color": WETLAND_OUTLINE_COLOR, "line-width": 0.6 },
          });
        }
        const filter = wetlandFilter(wetlandTypeVisibility, wetlandDesignationOnly);
        map.setFilter("wetlands-fill", filter);
        map.setFilter("wetlands-outline", filter);
        // Gated on the SUITABILITY map, exactly like the land-cover layer below and
        // for the same reason: `WetlandLayerControl` now mounts only there (page-1
        // 기술요청 takes 내륙습지 목록 off Page 1's primary UI), so a reader who
        // enables the layer and then switches to 지역 지표 would otherwise be left
        // with wetland polygons and their click popups on a page carrying no control
        // to turn them off. Leaving the mode hides the layer WITHOUT discarding the
        // type filter, the designation-only setting, or the on/off state, so coming
        // back behaves exactly as it was left. Nothing about the source, the tiles,
        // or the served attributes changes.
        const wetlandVisibility = mode === "suitability" && showWetlands ? "visible" : "none";
        map.setLayoutProperty("wetlands-fill", "visibility", wetlandVisibility);
        map.setLayoutProperty("wetlands-outline", "visibility", wetlandVisibility);
      }

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
          filter: reviewOutlineFilter(candidateScopeCodes),
          paint: { "line-color": "#b45309", "line-width": 0.9, "line-dasharray": [2, 1.5] },
        });
        // Distinct solid outline for STABLE eligible cells (stable across
        // baseline/equal/critic). Strong, saturated, solid — distinguishable from
        // the dashed amber review outline and the blue selected highlight. The
        // selected-candidate highlight is added later, so it stays visually on top.
        map.addLayer({
          id: "candidates-stable-outline",
          type: "line",
          source: "candidates",
          "source-layer": SUITABILITY_TILE_SOURCE_LAYER,
          filter: stableOutlineFilter(statusVisibility, candidateScopeCodes),
          paint: { "line-color": STABLE_OUTLINE_COLOR, "line-width": 1.8 },
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
        map.setFilter(
          "candidates-fill",
          candidateFillFilter(statusVisibility, stableOnly, candidateScopeCodes),
        );
        if (map.getLayer("candidates-review-outline")) {
          map.setFilter("candidates-review-outline", reviewOutlineFilter(candidateScopeCodes));
        }
        if (map.getLayer("candidates-stable-outline")) {
          map.setFilter(
            "candidates-stable-outline",
            stableOutlineFilter(statusVisibility, candidateScopeCodes),
          );
        }
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
            // Zoom-ramped so the mark is a real target when zoomed in without
            // covering the choropleth at a capital-region view.
            "circle-radius": FACILITY_CIRCLE_RADIUS,
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.5,
          },
        });
        // The Korean initial, over the disc. Added only when every category's image
        // could be built (see ensureFacilityMarkerImages) so the map never shows a
        // half-lettered legend; without it the discs alone are exactly the previous
        // behaviour. `icon-allow-overlap` is left at its default so MapLibre thins
        // the glyphs in a dense cluster — every disc is still drawn underneath.
        if (ensureFacilityMarkerImages(map)) {
          map.addLayer({
            id: "facilities-glyphs",
            type: "symbol",
            source: "facilities",
            minzoom: FACILITY_GLYPH_MIN_ZOOM,
            filter: ["!=", ["get", "glyph_icon"], ""],
            layout: {
              "icon-image": ["get", "glyph_icon"],
              "icon-size": FACILITY_ICON_SIZE,
              "icon-anchor": "center",
            },
          });
        }
        // NO click handler is bound to either layer. Facility clicks are answered by
        // the map-level priority handler beside the region layers above — a second
        // handler here is exactly what produced the overlapping-popup defect. The
        // glyph layer is decorative on top of the disc that IS the hit target, so it
        // needs no handler and no separate hit test.
      }

      // --- Land-cover candidate-cell statistics (Phase 1B-LC5B) as PostGIS tiles ---
      // Added AFTER the facilities block and inserted `before` the facility symbols,
      // so the stack is: basemap → wetlands → candidates → LAND COVER → facilities →
      // selected-candidate highlight. Above the candidate fill (otherwise the layer it
      // exists to show would be invisible under it) but below the facility points and
      // the selected-candidate highlight, which must never be obscured.
      //
      // Candidate CLICKS are unaffected: the click handler is bound to the
      // `candidates-fill` LAYER, and MapLibre delivers layer-scoped events regardless
      // of which layers are painted above. No competing click handler is registered
      // here, so there is exactly one candidate-selection model.
      const addLandCoverSource = (url: string) => {
        map.addSource(LAND_COVER_SOURCE_ID, {
          type: "vector",
          tiles: [url],
          minzoom: 0,
          maxzoom: LAND_COVER_TILE_MAX_ZOOM,
        });
        const before = map.getLayer("facilities-points") ? "facilities-points" : undefined;
        map.addLayer(
          {
            id: LAND_COVER_FILL_LAYER_ID,
            type: "fill",
            source: LAND_COVER_SOURCE_ID,
            "source-layer": LAND_COVER_CELL_TILE_SOURCE_LAYER,
            paint: {
              "fill-color": landCoverFillColor(
                landCoverMode,
                landCoverClassLevel,
                landCoverClasses[landCoverClassLevel],
              ) as unknown as maplibregl.ExpressionSpecification,
              "fill-opacity": landCoverFillOpacity() as unknown as maplibregl.ExpressionSpecification,
            },
          },
          before,
        );
        // Distinct LINE treatment per coverage status, so the three states stay
        // distinguishable without relying on fill color alone (and in dominant-class
        // mode, where the fill encodes the class instead of the coverage state).
        const outlineSpec: Record<
          (typeof LAND_COVER_OUTLINE_LAYER_IDS)[number],
          { color: string; width: number; dash?: number[] }
        > = {
          "land-cover-cells-complete-outline": {
            color: LAND_COVER_COVERAGE_OUTLINE_COLORS.COMPLETE_EXACT,
            width: 0.5,
          },
          "land-cover-cells-partial-outline": {
            color: LAND_COVER_COVERAGE_OUTLINE_COLORS.PARTIAL,
            width: 1,
            dash: [2, 1.5],
          },
          "land-cover-cells-nocoverage-outline": {
            color: LAND_COVER_COVERAGE_OUTLINE_COLORS.NO_COVERAGE,
            width: 0.9,
            dash: [0.6, 1.6],
          },
        };
        const statusForLayer = {
          "land-cover-cells-complete-outline": "COMPLETE_EXACT",
          "land-cover-cells-partial-outline": "PARTIAL",
          "land-cover-cells-nocoverage-outline": "NO_COVERAGE",
        } as const;
        for (const id of LAND_COVER_OUTLINE_LAYER_IDS) {
          const spec = outlineSpec[id];
          map.addLayer(
            {
              id,
              type: "line",
              source: LAND_COVER_SOURCE_ID,
              "source-layer": LAND_COVER_CELL_TILE_SOURCE_LAYER,
              paint: {
                "line-color": spec.color,
                "line-width": spec.width,
                ...(spec.dash ? { "line-dasharray": spec.dash } : {}),
              },
            },
            before,
          );
          map.setFilter(
            id,
            landCoverStatusOutlineFilter(
              statusForLayer[id],
              landCoverFilter(
                landCoverMode,
                landCoverClassLevel,
                landCoverCoverage,
                landCoverHiddenClassCodes,
              ),
            ) as unknown as maplibregl.FilterSpecification,
          );
        }
      };
      const removeLandCoverSource = () => {
        for (const id of LAND_COVER_LAYER_IDS) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(LAND_COVER_SOURCE_ID)) map.removeSource(LAND_COVER_SOURCE_ID);
      };

      if (landCoverTileUrl) {
        if (!map.getSource(LAND_COVER_SOURCE_ID)) {
          addLandCoverSource(landCoverTileUrl);
          appliedLandCoverTileUrlRef.current = landCoverTileUrl;
        } else if (appliedLandCoverTileUrlRef.current !== landCoverTileUrl) {
          // The active statistics release changed: re-point at the new immutable
          // tiles (a vector source's tiles cannot be swapped in place).
          removeLandCoverSource();
          addLandCoverSource(landCoverTileUrl);
          appliedLandCoverTileUrlRef.current = landCoverTileUrl;
        }
        // Mode / level / filter changes are PAINT AND FILTER updates only — they never
        // reload the source, so switching 평가 범위 ↔ 우세 분류 or L1↔L2↔L3 costs no
        // network request and can leave no stale styling behind.
        const filter = landCoverFilter(
          landCoverMode,
          landCoverClassLevel,
          landCoverCoverage,
          landCoverHiddenClassCodes,
        ) as unknown as maplibregl.FilterSpecification;
        map.setPaintProperty(
          LAND_COVER_FILL_LAYER_ID,
          "fill-color",
          landCoverFillColor(
            landCoverMode,
            landCoverClassLevel,
            landCoverClasses[landCoverClassLevel],
          ) as unknown as maplibregl.ExpressionSpecification,
        );
        map.setFilter(LAND_COVER_FILL_LAYER_ID, filter);
        for (const id of LAND_COVER_OUTLINE_LAYER_IDS) {
          if (!map.getLayer(id)) continue;
          const status =
            id === "land-cover-cells-complete-outline"
              ? "COMPLETE_EXACT"
              : id === "land-cover-cells-partial-outline"
                ? "PARTIAL"
                : "NO_COVERAGE";
          map.setFilter(
            id,
            landCoverStatusOutlineFilter(
              status,
              filter as unknown as unknown[],
            ) as unknown as maplibregl.FilterSpecification,
          );
        }
      } else if (map.getSource(LAND_COVER_SOURCE_ID)) {
        // No active release (or the release could not be resolved): tear the layer
        // down completely rather than leave an empty source behind.
        removeLandCoverSource();
        appliedLandCoverTileUrlRef.current = null;
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
      if (map.getLayer("candidates-stable-outline")) {
        map.setLayoutProperty(
          "candidates-stable-outline",
          "visibility",
          suitability ? "visible" : "none",
        );
      }
      // The land-cover layer exists ONLY in the suitability map context and only when
      // the user has enabled it: leaving suitability mode hides it without discarding
      // the user's land-cover settings, so returning behaves predictably.
      const landCoverVisibility = suitability && showLandCover ? "visible" : "none";
      for (const id of LAND_COVER_LAYER_IDS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", landCoverVisibility);
      }
      // The disc and its glyph are one mark drawn as two layers, so they are shown
      // and hidden together — a glyph left visible over a hidden disc would be a
      // floating character with no facility under it. `facilities-glyphs` is guarded
      // because it is only added where marker images could be built.
      const facilityVisibility = showFacilities ? "visible" : "none";
      map.setLayoutProperty("facilities-points", "visibility", facilityVisibility);
      if (map.getLayer("facilities-glyphs")) {
        map.setLayoutProperty("facilities-glyphs", "visibility", facilityVisibility);
      }
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
    showWetlands,
    wetlandTileUrl,
    wetlandTypeVisibility,
    wetlandDesignationOnly,
    showLandCover,
    landCoverTileUrl,
    landCoverMode,
    landCoverClassLevel,
    landCoverCoverage,
    landCoverHiddenClassCodes,
    landCoverClasses,
    candidateTileUrl,
    candidateBreaks,
    statusVisibility,
    stableOnly,
    candidateScopeCodes,
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
            지도를 불러오는 중…
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
