import { describe, expect, it } from "vitest";

import {
  classifyEquityRaw,
  geometryBounds,
  isDegenerateBounds,
  topCandidateCellLabel,
} from "./suitability";

describe("geometryBounds (map movement to a selected candidate)", () => {
  it("returns lon/lat bounds for a polygon", () => {
    const geometry: GeoJSON.Geometry = {
      type: "Polygon",
      coordinates: [
        [
          [126.25, 37.77],
          [126.26, 37.77],
          [126.26, 37.78],
          [126.25, 37.78],
          [126.25, 37.77],
        ],
      ],
    };
    expect(geometryBounds(geometry)).toEqual([
      [126.25, 37.77],
      [126.26, 37.78],
    ]);
  });

  it("handles MultiPolygon (candidate grid cells are MultiPolygons)", () => {
    const geometry: GeoJSON.Geometry = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [126.3, 37.7],
            [126.31, 37.7],
            [126.31, 37.71],
            [126.3, 37.7],
          ],
        ],
      ],
    };
    expect(geometryBounds(geometry)).toEqual([
      [126.3, 37.7],
      [126.31, 37.71],
    ]);
  });

  it("returns degenerate bounds for a Point (centroid fallback)", () => {
    const bounds = geometryBounds({ type: "Point", coordinates: [126.5, 37.5] });
    expect(bounds).toEqual([
      [126.5, 37.5],
      [126.5, 37.5],
    ]);
    expect(bounds && isDegenerateBounds(bounds)).toBe(true);
  });

  it("returns null when no coordinate is present", () => {
    expect(geometryBounds({ type: "Polygon", coordinates: [] })).toBeNull();
  });

  it("flags a real polygon bounds as non-degenerate", () => {
    expect(
      isDegenerateBounds([
        [126.25, 37.77],
        [126.26, 37.78],
      ]),
    ).toBe(false);
  });
});

describe("topCandidateCellLabel (tied-candidate differentiation)", () => {
  it("gives two tied cells DIFFERENT labels via key + centroid", () => {
    // Same scores, different grid cells — the regression was that these rendered
    // identically. The label must differ so a user (and a test) can tell them apart.
    const a = { candidate_key: "capital-grid-500m-v1:1780_3951", centroid_lat: 37.774843, centroid_lon: 126.253787 };
    const b = { candidate_key: "capital-grid-500m-v1:1781_3958", centroid_lat: 37.806441, centroid_lon: 126.258936 };
    const la = topCandidateCellLabel(a);
    const lb = topCandidateCellLabel(b);
    expect(la).not.toBe(lb);
    expect(la).toContain("1780_3951");
    expect(la).toContain("37.7748");
    expect(la).toContain("126.2538");
  });

  it("falls back to the grid key when coordinates are absent", () => {
    expect(topCandidateCellLabel({ candidate_key: "capital-grid-500m-v1:9_9" })).toBe(
      "capital-grid-500m-v1:9_9",
    );
  });

  it("never throws on missing fields", () => {
    expect(topCandidateCellLabel({})).toBe("");
  });
});

describe("classifyEquityRaw (official zero vs missing)", () => {
  it("classifies an official measured zero (facilities located, none missing)", () => {
    expect(
      classifyEquityRaw({
        located_burden_kg_per_capita: "0.000000",
        is_partial: false,
        facility_count_located: 1,
        missing_throughput_count: 0,
      }),
    ).toBe("OFFICIAL_ZERO");
  });

  it("classifies a partial (missing throughput) component distinctly, never as zero", () => {
    expect(
      classifyEquityRaw({
        located_burden_kg_per_capita: "0.000000",
        is_partial: true,
        missing_throughput_count: 2,
      }),
    ).toBe("PARTIAL");
  });

  it("classifies a non-zero measured value", () => {
    expect(
      classifyEquityRaw({ located_burden_kg_per_capita: "12.5", is_partial: false }),
    ).toBe("MEASURED_VALUE");
  });

  it("returns null for an absent component (shown as unavailable, never scored)", () => {
    expect(classifyEquityRaw(undefined)).toBeNull();
    expect(classifyEquityRaw(null)).toBeNull();
    expect(classifyEquityRaw({ is_partial: false })).toBeNull();
  });
});
