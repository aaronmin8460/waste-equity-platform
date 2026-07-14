/**
 * Pure helpers for the capital-region Sudokwon Landfill flow view.
 *
 * Builds schematic straight-line GeoJSON (metropolitan origin → single
 * destination) and formats official values. These are the only three
 * origins the source declares (Seoul/Incheon/Gyeonggi); no municipal or
 * district line is ever produced here. No network or MapLibre access.
 */

import type { LandfillDestinationNode, LandfillFlow } from "./api";

export const MIN_LINE_WIDTH = 3;
export const MAX_LINE_WIDTH = 18;

export function kgToTons(kg: string | number): number {
  const value = typeof kg === "string" ? Number(kg) : kg;
  return value / 1000;
}

export function formatTons(kg: string | number): string {
  return `${Math.round(kgToTons(kg)).toLocaleString("en-US")} t`;
}

/** Format KRW as 억원 (hundred-million won) for compact display. */
export function formatKrwEok(krw: string | number): string {
  const value = typeof krw === "string" ? Number(krw) : krw;
  const eok = value / 100_000_000;
  return `${eok.toLocaleString("en-US", { maximumFractionDigits: 1 })}억원`;
}

export function formatShare(share: string | null): string {
  if (share == null) return "—";
  const pct = Number(share) * 100;
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

export function formatEffectiveFee(fee: string | null): string {
  if (fee == null) return "—";
  return `${Math.round(Number(fee)).toLocaleString("en-US")} 원/t`;
}

/** Line width scaled linearly by official inbound quantity (never below MIN). */
export function lineWidthForQuantity(quantityKg: number, maxKg: number): number {
  if (maxKg <= 0) return MIN_LINE_WIDTH;
  const ratio = Math.max(0, Math.min(1, quantityKg / maxKg));
  return MIN_LINE_WIDTH + ratio * (MAX_LINE_WIDTH - MIN_LINE_WIDTH);
}

export interface FlowLineProperties {
  origin_region_code: string;
  origin_sgis_code: string;
  origin_name: string;
  quantity_kg: number;
  quantity_tons: number;
  inbound_fee_krw: number;
  quantity_share: number | null;
  width: number;
}

/** Schematic origin→destination LineString features, width by official quantity. */
export function buildFlowFeatures(
  flows: LandfillFlow[],
): GeoJSON.FeatureCollection<GeoJSON.LineString, FlowLineProperties> {
  const maxKg = flows.reduce((max, flow) => Math.max(max, Number(flow.quantity_kg)), 0);
  return {
    type: "FeatureCollection",
    features: flows.map((flow) => {
      const quantityKg = Number(flow.quantity_kg);
      return {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [flow.origin_point.lon, flow.origin_point.lat],
            [flow.destination_point.lon, flow.destination_point.lat],
          ],
        },
        properties: {
          origin_region_code: flow.origin_region_code,
          origin_sgis_code: flow.origin_sgis_code,
          origin_name: flow.origin_name,
          quantity_kg: quantityKg,
          quantity_tons: kgToTons(quantityKg),
          inbound_fee_krw: Number(flow.inbound_fee_krw),
          quantity_share: flow.quantity_share == null ? null : Number(flow.quantity_share),
          width: lineWidthForQuantity(quantityKg, maxKg),
        },
      };
    }),
  };
}

export interface FlowNodeProperties {
  kind: "origin" | "destination";
  code: string;
  name: string;
  quantity_kg: number | null;
}

/** Point features for the three metropolitan origin nodes + the destination. */
export function buildNodeFeatures(
  flows: LandfillFlow[],
  destination: LandfillDestinationNode,
): GeoJSON.FeatureCollection<GeoJSON.Point, FlowNodeProperties> {
  const originFeatures: GeoJSON.Feature<GeoJSON.Point, FlowNodeProperties>[] = flows.map((flow) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [flow.origin_point.lon, flow.origin_point.lat] },
    properties: {
      kind: "origin",
      code: flow.origin_region_code,
      name: flow.origin_name,
      quantity_kg: Number(flow.quantity_kg),
    },
  }));
  const destinationFeature: GeoJSON.Feature<GeoJSON.Point, FlowNodeProperties> = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [destination.point.lon, destination.point.lat] },
    properties: { kind: "destination", code: destination.code, name: destination.name, quantity_kg: null },
  };
  return { type: "FeatureCollection", features: [...originFeatures, destinationFeature] };
}
