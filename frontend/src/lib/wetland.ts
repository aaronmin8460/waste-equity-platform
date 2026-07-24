/**
 * Inland-wetland inventory (내륙습지 목록) — frontend layer constants (Phase 1B-2).
 *
 * The surveyed 국립생태원 inland-wetland inventory, exposed read-only as a SEPARATE
 * optional map layer. It is NOT a statutory protection area: the statutory
 * 습지보호지역 layer is `UM901`, a different dataset with different legal effect and
 * scope. These constants (the Korean labels, the type→color legend, and the three
 * load-bearing disclosures) mirror the backend schema constants so the two never
 * drift. Nothing here scores, ranks, or excludes anything.
 */

/** The four Korean wetland types the inventory publishes (source `TYPE` values). */
export const WETLAND_TYPES = ["하천습지", "호수습지", "산지습지", "인공습지"] as const;
export type WetlandType = (typeof WETLAND_TYPES)[number];

/**
 * Categorical legend palette — a neutral water/nature hue set, deliberately NOT a
 * red danger/exclusion treatment: the inventory implies no legal effect. Distinct
 * from the candidate score palette (blues) and the facility category colors.
 */
export const WETLAND_TYPE_COLORS: Record<WetlandType, string> = {
  하천습지: "#2b8cbe", // river — blue
  호수습지: "#1c9099", // lake — teal
  산지습지: "#41ab5d", // mountain — green
  인공습지: "#807dba", // artificial — muted purple
};

/** Neutral outline for the wetland polygons (a hairline, not a warning color). */
export const WETLAND_OUTLINE_COLOR = "#38618c";

/** Canonical layer label, matching the backend `korean_label`. */
export const WETLAND_LAYER_LABEL = "내륙습지 목록";

// The three load-bearing disclosures — identical text to the backend schema so the
// map, the API, and the tests all assert the same strings.
export const WETLAND_INVENTORY_DISCLAIMER =
  "내륙습지 목록은 국립생태원의 조사·목록 데이터이며, 모든 습지가 법정 습지보호지역을 의미하지 않습니다.";
export const WETLAND_UM901_DISTINCTION =
  "법정 습지보호지역은 기존 UM901 보호구역 레이어에서 별도로 확인할 수 있습니다.";
export const WETLAND_DETAIL_WARNING =
  "이 레이어는 조사된 내륙습지 목록입니다. 모든 항목이 법정 습지보호지역을 뜻하지 않습니다.";

/** Label the source note (`EXP`) must always carry — it is raw source text, never legal status. */
export const WETLAND_DESIGNATION_NOTE_LABEL = "원자료 지정 메모";

// Source disclosure facts (constant for the served release).
export const WETLAND_PROVIDER = "국립생태원";
export const WETLAND_SOURCE_DATASET = "내륙습지 공간데이터 및 속성정보";
export const WETLAND_REFERENCE_DATE = "2022-07-20";
export const WETLAND_SOURCE_CRS = "EPSG:5186";
export const WETLAND_STORAGE_CRS = "EPSG:4326";

/** Default per-type visibility — all four types shown when the layer is on. */
export function defaultWetlandTypeVisibility(): Record<WetlandType, boolean> {
  return { 하천습지: true, 호수습지: true, 산지습지: true, 인공습지: true };
}

/** Format a reported area in m² as a grouped Korean string, or a dash when absent. */
export function formatWetlandArea(areaM2: number | null | undefined): string {
  if (areaM2 == null || Number.isNaN(areaM2)) return "면적 정보 없음";
  return `${Math.round(areaM2).toLocaleString("ko-KR")} m²`;
}
