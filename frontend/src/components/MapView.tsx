"use client";

/**
 * MapLibre GL map: SIGUNGU choropleth + facility points.
 *
 * Regions with no served value for the selected metric render in the
 * explicit no-data color; facilities without backend-served coordinates are
 * never drawn. The basemap is OpenStreetMap raster tiles (public,
 * non-government) with attribution.
 */

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { FacilityItem, RegionBoundaryCollection } from "../lib/api";
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

export interface RegionDisplayValue {
  /** Numeric value used only for the color scale. */
  numeric: number;
  /** Exact display string formatted from the served value. */
  display: string;
}

interface MapViewProps {
  boundaries: RegionBoundaryCollection;
  regionValues: Map<string, RegionDisplayValue>;
  breaks: number[];
  metricLabel: string;
  metricUnit: string;
  facilities: FacilityItem[];
  showFacilities: boolean;
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

export default function MapView({
  boundaries,
  regionValues,
  breaks,
  metricLabel,
  metricUnit,
  facilities,
  showFacilities,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);

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
    });
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
              category: facility.facility_category,
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
              `<strong>${props.region_name}</strong><br/>${metricLabel}<br/>` +
                `${props.metric_display}<br/>` +
                `<small>출처: ${props.source_id} · 경계 기준연도: ${props.boundary_reference_period}</small>`,
            )
            .addTo(map);
        });
      }
      map.setPaintProperty("regions-fill", "fill-color", fillColorExpression(breaks));

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
  }, [boundaries, regionValues, breaks, metricLabel, metricUnit, facilities, showFacilities]);

  return <div ref={containerRef} className="h-full w-full" data-testid="map-container" />;
}
