"use client";

/**
 * MapLibre GL map: SIGUNGU equity choropleth + facility points (Equity mode) and
 * the 500 m suitability candidate grid (Suitability mode).
 *
 * Regions/candidates with no served value render in the explicit no-data color;
 * facilities without backend-served coordinates are never drawn. Candidate cells
 * are fetched from the backend by viewport bbox with a controlled limit (never the
 * whole capital-region grid at once). The basemap is OpenStreetMap raster tiles
 * (public, non-government) with attribution. The map talks only to the backend.
 */

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type {
  FacilityItem,
  RegionBoundaryCollection,
  SuitabilityCandidateCollection,
  SuitabilityStatus,
} from "../lib/api";
import {
  CHOROPLETH_PALETTE,
  FACILITY_CATEGORY_COLORS,
  FACILITY_CATEGORY_LABELS,
  NO_DATA_COLOR,
  formatQuantity,
} from "../lib/metrics";

const BASE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
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

export interface RegionDisplayValue {
  /** Numeric value used only for the color scale. */
  numeric: number;
  /** Exact display string formatted from the served value. */
  display: string;
}

export type StatusVisibility = Record<SuitabilityStatus, boolean>;

interface MapViewProps {
  boundaries: RegionBoundaryCollection;
  regionValues: Map<string, RegionDisplayValue>;
  breaks: number[];
  metricLabel: string;
  metricUnit: string;
  facilities: FacilityItem[];
  showFacilities: boolean;
  mode: "equity" | "suitability";
  candidates: SuitabilityCandidateCollection | null;
  candidateBreaks: number[];
  statusVisibility: StatusVisibility;
  onViewportChange: (bbox: string) => void;
  onCandidateClick: (candidateId: number) => void;
}

function fillColorExpression(breaks: number[]): maplibregl.ExpressionSpecification {
  const step: unknown[] = ["step", ["get", "metric_value"], CHOROPLETH_PALETTE[0]];
  breaks.forEach((threshold, index) => {
    step.push(threshold, CHOROPLETH_PALETTE[Math.min(index + 1, CHOROPLETH_PALETTE.length - 1)]);
  });
  return [
    "case",
    ["==", ["get", "has_value"], true],
    step as unknown as maplibregl.ExpressionSpecification,
    NO_DATA_COLOR,
  ] as unknown as maplibregl.ExpressionSpecification;
}

// Candidate fill: eligible -> score step; review -> distinct amber; excluded -> muted.
function candidateColorExpression(breaks: number[]): maplibregl.ExpressionSpecification {
  const step: unknown[] = ["step", ["get", "metric_value"], CHOROPLETH_PALETTE[0]];
  breaks.forEach((threshold, index) => {
    step.push(threshold, CHOROPLETH_PALETTE[Math.min(index + 1, CHOROPLETH_PALETTE.length - 1)]);
  });
  return [
    "case",
    ["==", ["get", "status"], "EXCLUDED"],
    EXCLUDED_COLOR,
    ["==", ["get", "status"], "REVIEW_REQUIRED"],
    REVIEW_COLOR,
    step as unknown as maplibregl.ExpressionSpecification,
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

export default function MapView({
  boundaries,
  regionValues,
  breaks,
  metricLabel,
  metricUnit,
  facilities,
  showFacilities,
  mode,
  candidates,
  candidateBreaks,
  statusVisibility,
  onViewportChange,
  onCandidateClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const onViewportChangeRef = useRef(onViewportChange);
  const onCandidateClickRef = useRef(onCandidateClick);
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
    onCandidateClickRef.current = onCandidateClick;
  });

  function emitViewport(map: maplibregl.Map) {
    const b = map.getBounds();
    onViewportChangeRef.current(
      `${b.getWest().toFixed(5)},${b.getSouth().toFixed(5)},${b.getEast().toFixed(5)},${b.getNorth().toFixed(5)}`,
    );
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      bounds: SMA_BOUNDS,
      fitBoundsOptions: { padding: 16 },
      attributionControl: { compact: false },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      loadedRef.current = true;
      map.fire("wep:refresh");
      emitViewport(map);
    });
    map.on("moveend", () => emitViewport(map));
    mapRef.current = map;
    return () => {
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const refresh = () => {
      const regionsData: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: boundaries.features.map((feature) => {
          const value = regionValues.get(feature.properties.region_code);
          return {
            type: "Feature" as const,
            geometry: feature.geometry,
            properties: {
              ...feature.properties,
              has_value: value !== undefined,
              metric_value: value?.numeric ?? 0,
              metric_label: metricLabel,
              metric_display: value
                ? `${value.display} ${metricUnit}`
                : "데이터 없음 (no served value)",
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
      const candidatesData: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: (candidates?.features ?? []).map((cell) => ({
          type: "Feature" as const,
          geometry: cell.geometry,
          properties: {
            candidate_id: cell.properties.candidate_id,
            candidate_key: cell.properties.candidate_key,
            status: cell.properties.status,
            has_value: !cell.properties.is_excluded,
            metric_value:
              cell.properties.total_score !== null
                ? Number(cell.properties.total_score)
                : cell.properties.provisional_score !== null
                  ? Number(cell.properties.provisional_score)
                  : 0,
            score_display: cell.properties.is_excluded
              ? "제외 (excluded)"
              : cell.properties.total_score !== null
                ? `${cell.properties.total_score} (rank ${cell.properties.rank ?? "-"})`
                : `${cell.properties.provisional_score ?? "-"} (provisional)`,
            sigungu: cell.properties.sigungu_region_name ?? "",
            reasons: cell.properties.is_excluded
              ? cell.properties.exclusion_reasons.join(", ")
              : cell.properties.review_reasons.join(", "),
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
          paint: { "fill-color": fillColorExpression(breaks), "fill-opacity": 0.72 },
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
          new maplibregl.Popup()
            .setLngLat(event.lngLat)
            .setHTML(
              `<strong>${props.region_name}</strong><br/>${props.metric_label}<br/>` +
                `${props.metric_display}<br/>` +
                `<small>경계 출처: ${props.source_id} (${props.boundary_reference_period}) · 지표 출처는 좌측 패널 참조</small>`,
            )
            .addTo(map);
        });
      }
      map.setPaintProperty("regions-fill", "fill-color", fillColorExpression(breaks));

      // --- Candidate grid (suitability) ---
      const candidatesSource = map.getSource("candidates") as maplibregl.GeoJSONSource | undefined;
      if (candidatesSource) {
        candidatesSource.setData(candidatesData);
      } else {
        map.addSource("candidates", { type: "geojson", data: candidatesData });
        map.addLayer({
          id: "candidates-fill",
          type: "fill",
          source: "candidates",
          paint: {
            "fill-color": candidateColorExpression(candidateBreaks),
            "fill-opacity": CANDIDATE_OPACITY,
          },
        });
        map.addLayer({
          id: "candidates-review-outline",
          type: "line",
          source: "candidates",
          filter: ["==", ["get", "status"], "REVIEW_REQUIRED"],
          paint: { "line-color": "#b45309", "line-width": 0.9, "line-dasharray": [2, 1.5] },
        });
        map.on("click", "candidates-fill", (event) => {
          const feature = event.features?.[0];
          if (!feature) return;
          const props = feature.properties as Record<string, string>;
          new maplibregl.Popup()
            .setLngLat(event.lngLat)
            .setHTML(
              `<strong>후보지 ${props.candidate_key}</strong><br/>` +
                `상태(status): ${props.status}<br/>적합성 점수: ${props.score_display}<br/>` +
                `시군구: ${props.sigungu}<br/>` +
                `${props.reasons ? `사유: ${props.reasons}<br/>` : ""}` +
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
      }
      map.setPaintProperty(
        "candidates-fill",
        "fill-color",
        candidateColorExpression(candidateBreaks),
      );
      map.setFilter("candidates-fill", statusFilter(statusVisibility));

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

      // --- Mode + visibility toggles (never conditionally skip addLayer) ---
      const equity = mode === "equity";
      map.setLayoutProperty("regions-fill", "visibility", equity ? "visible" : "none");
      map.setLayoutProperty("regions-outline", "visibility", equity ? "visible" : "none");
      map.setLayoutProperty("candidates-fill", "visibility", equity ? "none" : "visible");
      map.setLayoutProperty(
        "candidates-review-outline",
        "visibility",
        equity ? "none" : "visible",
      );
      map.setLayoutProperty("facilities-points", "visibility", showFacilities ? "visible" : "none");
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
    metricLabel,
    metricUnit,
    facilities,
    showFacilities,
    mode,
    candidates,
    candidateBreaks,
    statusVisibility,
  ]);

  return <div ref={containerRef} className="h-full w-full" data-testid="map-container" />;
}
