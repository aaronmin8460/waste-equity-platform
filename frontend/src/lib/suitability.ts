/**
 * Pure helpers for the suitability UI, extracted so they can be unit-tested
 * (the component tree is exercised end-to-end by Playwright).
 *
 * These helpers never deduplicate, re-score, or fabricate data. They only make
 * legitimately-distinct information visible:
 *  - `geometryBounds` moves the map to a selected candidate.
 *  - `topCandidateCellLabel` distinguishes grid cells with tied scores.
 *  - `classifyEquityRaw` keeps an official measured zero distinct from missing data.
 */

/**
 * Longitude/latitude bounds of any GeoJSON geometry (Point/Polygon/MultiPolygon).
 * Returns null when no coordinate is found. A single point yields a degenerate
 * (zero-area) bounds where min === max; callers fall back to a centroid flyTo.
 */
export function geometryBounds(
  geometry: GeoJSON.Geometry,
): [[number, number], [number, number]] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let found = false;
  const visit = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === "number" && typeof node[1] === "number") {
      const lng = node[0];
      const lat = node[1];
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      found = true;
      return;
    }
    if (Array.isArray(node)) node.forEach(visit);
  };
  if ("coordinates" in geometry) visit(geometry.coordinates);
  if (!found) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/** True when the bounds are a single point (zero area). */
export function isDegenerateBounds(bounds: [[number, number], [number, number]]): boolean {
  const [[minLng, minLat], [maxLng, maxLat]] = bounds;
  return minLng === maxLng && minLat === maxLat;
}

/**
 * Concise cell-level distinction for a top-candidate row: the grid key plus the
 * centroid, so legitimately tied cells (same scores, different location) never
 * render as identical text. Never alters or hides the score.
 */
export function topCandidateCellLabel(c: {
  candidate_key?: unknown;
  centroid_lat?: unknown;
  centroid_lon?: unknown;
}): string {
  const key = c.candidate_key != null ? String(c.candidate_key) : "";
  if (c.centroid_lat != null && c.centroid_lon != null) {
    const lat = Number(c.centroid_lat).toFixed(4);
    const lon = Number(c.centroid_lon).toFixed(4);
    return key ? `${key} · ${lat}, ${lon}` : `${lat}, ${lon}`;
  }
  return key;
}

/**
 * Classify a served equity raw component so the UI keeps an official measured
 * zero distinct from partially-missing throughput and from absent data.
 *  - null           → the equity component is absent (candidate under review); the
 *                     UI shows the MISSING_EQUITY_COMPONENT review reason, never a score.
 *  - "PARTIAL"      → some located facility throughput is missing (undercount, never estimated).
 *  - "OFFICIAL_ZERO"→ an official measured zero (facilities located, nothing missing).
 *  - "MEASURED_VALUE" → a non-zero official value.
 */
export type EquityValueKind = "PARTIAL" | "OFFICIAL_ZERO" | "MEASURED_VALUE";

export function classifyEquityRaw(
  eq: Record<string, unknown> | undefined | null,
): EquityValueKind | null {
  if (!eq) return null;
  if (eq.is_partial === true) return "PARTIAL";
  const raw = eq.located_burden_kg_per_capita;
  if (raw == null) return null;
  return Number(raw) === 0 ? "OFFICIAL_ZERO" : "MEASURED_VALUE";
}

/**
 * Text-first stability badge label for a candidate. Never communicates stability
 * by color alone — the returned string always carries the count and meaning.
 * Returns null for candidates that are not stability-classified (REVIEW_REQUIRED,
 * EXCLUDED, or a run without stability data), so the caller shows no badge.
 */
export type StabilityBadgeClass = "STABLE" | "CONDITIONALLY_STABLE" | "WEIGHT_SENSITIVE";

export function stabilityBadgeLabel(
  stabilityClass: string | null | undefined,
  stableCount: number | null | undefined,
): string | null {
  if (stabilityClass == null || stableCount == null) return null;
  switch (stabilityClass) {
    case "STABLE":
      return "안정 후보 3/3";
    case "CONDITIONALLY_STABLE":
      return "조건부 안정 2/3";
    case "WEIGHT_SENSITIVE":
      return "가중치 민감 0–1/3";
    default:
      return null;
  }
}
