/**
 * 지역별 폐기물 발생과 처리 비교 — the scatter's pure data layer.
 *
 * ── What this joins, and what it refuses to ────────────────────────────────────
 * Both axes are SERVED per-capita values that already exist on this platform. This
 * module reads them; it computes no tonnage, sums nothing across regions, and adds
 * nothing across waste streams.
 *
 *   X — `ReportingPerCapitaItem.per_capita_kg_per_year` for ONE waste stream
 *       (`/api/v1/equity/reporting/waste-per-capita`, RCIS reporting geography).
 *   Y — `FacilityBurdenItem.throughput_{located,within_buffer}_kg_per_capita`
 *       (`/api/v1/equity/facility-burden`, native SGIS geography).
 *
 * Both are kg per resident per year, which is why they can share a plot at all. The
 * 인근 5km mode is NOT invented for this screen: `throughput_within_buffer_kg_per_capita`
 * is a backend-derived indicator with a served buffer distance, already rendered by
 * the 지역 지표 map. No proximity, buffer, or intersection is computed in the browser.
 *
 * ── The join, and why regions drop out of it ──────────────────────────────────
 * The two datasets are published on DIFFERENT geographies. Waste generation is served
 * on the RCIS reporting geography, where the seven Gyeonggi cities RCIS reports at
 * city level appear once each as a `DERIVED_CITY_UNION`; facility burden is served on
 * native SGIS regions. A city union has no single native counterpart, and adding its
 * children's burden here would manufacture a figure no source published.
 *
 * So the join is exact-code only, over `NATIVE_SGIS` reporting regions. Every region
 * that cannot be joined is RETURNED with its reason rather than silently dropped, so
 * the view can state its own coverage instead of implying it plotted everything.
 *
 * ── The comparability caveat is not optional ──────────────────────────────────
 * The Y axis is measured at the facility's LOCATION (what plants in the area
 * processed); the X axis is measured at the point of GENERATION (what the area put
 * out). They are not two views of one quantity and their difference is not a deficit.
 * {@link SCATTER_COMPARABILITY_CAVEAT} is exported here, beside the join, so no caller
 * can render the plot without it.
 */

import type { FacilityBurdenEnvelope, ReportingPerCapitaEnvelope } from "./api";

/** Which served facility-burden measure the Y axis shows. */
export type BurdenMode = "located" | "buffer";

/** One plotted region: two served values and the identity they were joined on. */
export interface ScatterPoint {
  /** Native SGIS region code — the key both datasets agreed on. */
  regionCode: string;
  regionName: string;
  /** Served per-capita generation, kg/인·년. Exact served string kept alongside. */
  generation: number;
  generationExact: string;
  /** Served per-capita facility throughput, kg/인·년. */
  burden: number;
  burdenExact: string;
  /**
   * True when the served burden is flagged partial — some facilities in scope
   * reported no throughput, so the value is an UNDER-count, not a measurement of a
   * smaller burden. Carried per point so the view can mark it rather than average
   * it away.
   */
  burdenIsPartial: boolean;
  /** Facilities counted into the served burden, for the point's detail. */
  facilityCount: number;
  population: number;
}

/** A region that could not be plotted, and why. Never silently discarded. */
export interface ScatterExclusion {
  regionCode: string;
  regionName: string;
  reason: "NO_MATCHING_BURDEN_REGION" | "DERIVED_CITY_GEOGRAPHY" | "UNPARSEABLE_VALUE";
}

export interface ScatterDataset {
  points: ScatterPoint[];
  excluded: ScatterExclusion[];
  /** Median of the plotted X values, or null below two points. */
  generationMedian: number | null;
  /** Median of the plotted Y values, or null below two points. */
  burdenMedian: number | null;
  /** The waste stream the X axis shows, as served. */
  wasteStream: string;
  /** Served reference years of each side, so the view can state them separately. */
  generationReferenceYear: number | null;
  burdenReferenceYear: number | null;
  /** The served buffer distance, for the 인근 mode's label. Never assumed. */
  bufferMeters: number | null;
}

export const SCATTER_COMPARABILITY_CAVEAT =
  "가로축은 발생지 기준(지역에서 배출된 양), 세로축은 시설 소재지 기준(그 지역 시설이 처리한 양)입니다. " +
  "서로 다른 집계 기준이므로 두 값의 차이를 처리 부족분이나 잉여로 읽을 수 없습니다.";

/** Reason labels in plain Korean. The raw enum stays in a diagnostic line. */
export const SCATTER_EXCLUSION_LABELS: Record<ScatterExclusion["reason"], string> = {
  NO_MATCHING_BURDEN_REGION: "동일 지역의 시설 처리 자료 없음",
  DERIVED_CITY_GEOGRAPHY: "폐기물 통계가 시 단위로만 보고되어 시설 자료와 지역 단위가 다름",
  UNPARSEABLE_VALUE: "제공된 값을 숫자로 읽을 수 없음",
};

/** The exact median of a sorted-able numeric sample; null below two values. */
export function median(values: number[]): number | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[Math.floor(mid)];
}

function finite(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Join the two served envelopes into plottable points for one waste stream.
 *
 * Deterministic: points come out ordered by region code, so the same inputs always
 * produce the same plot and the same tab order.
 */
export function buildScatterDataset(
  perCapita: ReportingPerCapitaEnvelope | null,
  burden: FacilityBurdenEnvelope | null,
  wasteStream: string,
  mode: BurdenMode,
): ScatterDataset {
  const empty: ScatterDataset = {
    points: [],
    excluded: [],
    generationMedian: null,
    burdenMedian: null,
    wasteStream,
    generationReferenceYear: perCapita?.reference_year ?? null,
    burdenReferenceYear: burden?.reference_year ?? null,
    bufferMeters: burden?.buffer_meters ?? null,
  };
  if (!perCapita || !burden) return empty;

  const burdenByRegion = new Map(burden.items.map((item) => [item.region_code, item]));
  const points: ScatterPoint[] = [];
  const excluded: ScatterExclusion[] = [];

  for (const item of perCapita.items) {
    if (item.waste_stream !== wasteStream) continue;
    const identity = {
      regionCode: item.reporting_region_code,
      regionName: item.reporting_region_name,
    };
    // A city-union row has no single native counterpart. Adding its children's
    // burden would be a client-side aggregate of an official indicator — refused.
    if (item.reporting_geography_type !== "NATIVE_SGIS") {
      excluded.push({ ...identity, reason: "DERIVED_CITY_GEOGRAPHY" });
      continue;
    }
    const match = burdenByRegion.get(item.reporting_region_code);
    if (!match) {
      excluded.push({ ...identity, reason: "NO_MATCHING_BURDEN_REGION" });
      continue;
    }
    const generationExact = item.per_capita_kg_per_year;
    const burdenExact =
      mode === "buffer"
        ? match.throughput_within_buffer_kg_per_capita
        : match.throughput_located_kg_per_capita;
    const generation = finite(generationExact);
    const burdenValue = finite(burdenExact);
    if (generation === null || burdenValue === null) {
      excluded.push({ ...identity, reason: "UNPARSEABLE_VALUE" });
      continue;
    }
    points.push({
      ...identity,
      generation,
      generationExact,
      burden: burdenValue,
      burdenExact,
      burdenIsPartial:
        mode === "buffer" ? match.buffer_throughput_is_partial : match.located_throughput_is_partial,
      facilityCount:
        mode === "buffer" ? match.facility_count_within_buffer : match.facility_count_located,
      population: match.population,
    });
  }

  points.sort((a, b) => a.regionCode.localeCompare(b.regionCode));
  return {
    ...empty,
    points,
    excluded,
    generationMedian: median(points.map((point) => point.generation)),
    burdenMedian: median(points.map((point) => point.burden)),
  };
}

/**
 * The quadrant a point falls in, relative to the two medians — or `null` when the
 * medians do not exist (fewer than two points), in which case no quadrant claim is
 * made at all.
 *
 * The labels describe POSITION relative to the other regions on screen, nothing more:
 * they are not a ranking, a target, or a judgement about a region's performance, and
 * the two axes are not comparable to each other (see {@link SCATTER_COMPARABILITY_CAVEAT}).
 */
export type Quadrant = "high-high" | "high-generation" | "high-burden" | "low-low";

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  "high-high": "발생·처리 모두 중앙값 이상",
  "high-generation": "발생 중앙값 이상 · 처리 중앙값 미만",
  "high-burden": "처리 중앙값 이상 · 발생 중앙값 미만",
  "low-low": "발생·처리 모두 중앙값 미만",
};

export function quadrantOf(point: ScatterPoint, dataset: ScatterDataset): Quadrant | null {
  const { generationMedian, burdenMedian } = dataset;
  if (generationMedian === null || burdenMedian === null) return null;
  const highGeneration = point.generation >= generationMedian;
  const highBurden = point.burden >= burdenMedian;
  if (highGeneration && highBurden) return "high-high";
  if (highGeneration) return "high-generation";
  if (highBurden) return "high-burden";
  return "low-low";
}
