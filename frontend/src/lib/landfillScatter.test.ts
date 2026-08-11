import { describe, expect, it } from "vitest";

import type {
  FacilityBurdenEnvelope,
  FacilityBurdenItem,
  ReportingPerCapitaEnvelope,
  ReportingPerCapitaItem,
} from "./api";
import { buildScatterDataset, median, quadrantOf } from "./landfillScatter";

function perCapitaItem(overrides: Partial<ReportingPerCapitaItem> = {}): ReportingPerCapitaItem {
  return {
    reporting_region_code: "KR-SGIS-11110",
    reporting_region_name: "종로구",
    reporting_geography_type: "NATIVE_SGIS",
    source_reporting_level: "SIGUNGU",
    waste_stream: "HOUSEHOLD",
    per_capita_kg_per_year: "220.5",
    per_capita_unit: "kg/인·년",
    generation_quantity: "33000.000000",
    quantity_unit: "톤",
    accounting_basis: "GENERATION_ORIGIN",
    numerator_reporting_level: "SIGUNGU",
    waste_source_id: "rcis_waste",
    waste_source_pid: "NTN007",
    waste_official_dataset_name: "생활폐기물",
    waste_reference_period: "2023",
    population: 150000,
    population_definition: "SGIS_TOTAL",
    population_source_id: "sgis_population",
    population_reference_period: "2023",
    population_is_derived: false,
    population_derivation: null,
    child_region_codes: null,
    reference_year: 2023,
    ...overrides,
  };
}

function burdenItem(overrides: Partial<FacilityBurdenItem> = {}): FacilityBurdenItem {
  return {
    region_code: "KR-SGIS-11110",
    region_name: "종로구",
    region_level: "SIGUNGU",
    facility_count_located: 2,
    throughput_located_tons_per_year: "12000.000000",
    throughput_located_kg_per_capita: "80.0",
    located_missing_throughput_count: 0,
    located_throughput_is_partial: false,
    facility_count_within_buffer: 5,
    throughput_within_buffer_tons_per_year: "30000.000000",
    throughput_within_buffer_kg_per_capita: "200.0",
    buffer_missing_throughput_count: 1,
    buffer_throughput_is_partial: true,
    quantity_unit: "톤",
    accounting_basis: "FACILITY_LOCATION_THROUGHPUT",
    facility_source_id: "rcis_facilities",
    facility_reference_period: "2023",
    population: 150000,
    population_definition: "SGIS_TOTAL",
    population_source_id: "sgis_population",
    population_reference_period: "2023",
    reference_year: 2023,
    ...overrides,
  };
}

function envelopes(
  items: ReportingPerCapitaItem[],
  burdens: FacilityBurdenItem[],
): [ReportingPerCapitaEnvelope, FacilityBurdenEnvelope] {
  return [
    {
      indicator: "WASTE_PER_CAPITA",
      derivation_version: "v1",
      derivation_formula: "generation ÷ population",
      unit: "kg/인·년",
      assumptions: [],
      reference_year: 2023,
      count: items.length,
      items,
      excluded_regions: [],
    },
    {
      indicator: "FACILITY_BURDEN",
      derivation_version: "v1",
      derivation_formula: "throughput ÷ population",
      buffer_meters: 5000,
      unit: "kg/인·년",
      assumptions: [],
      reference_year: 2023,
      count: burdens.length,
      items: burdens,
      excluded_regions: [],
      facilities_without_coordinates: 0,
      facilities_without_region: 0,
    },
  ];
}

describe("buildScatterDataset", () => {
  it("joins the two served indicators on an exact native region code", () => {
    const [perCapita, burden] = envelopes([perCapitaItem()], [burdenItem()]);
    const dataset = buildScatterDataset(perCapita, burden, "HOUSEHOLD", "located");
    expect(dataset.points).toHaveLength(1);
    // The EXACT served strings survive the join; nothing is recomputed.
    expect(dataset.points[0].generationExact).toBe("220.5");
    expect(dataset.points[0].burdenExact).toBe("80.0");
    expect(dataset.excluded).toHaveLength(0);
  });

  it("reads the 인근 5km measure from the served buffer field, computing no geometry", () => {
    const [perCapita, burden] = envelopes([perCapitaItem()], [burdenItem()]);
    const dataset = buildScatterDataset(perCapita, burden, "HOUSEHOLD", "buffer");
    expect(dataset.points[0].burdenExact).toBe("200.0");
    expect(dataset.points[0].facilityCount).toBe(5);
    // A served partial flag means the value is an UNDER-count, and it is carried
    // per point rather than averaged away.
    expect(dataset.points[0].burdenIsPartial).toBe(true);
    // The buffer distance is the backend's, never a constant in the browser.
    expect(dataset.bufferMeters).toBe(5000);
  });

  it("refuses to plot a derived city union rather than summing its children", () => {
    const [perCapita, burden] = envelopes(
      [
        perCapitaItem({
          reporting_region_code: "KR-RCIS-CITY-41110",
          reporting_region_name: "수원시",
          reporting_geography_type: "DERIVED_CITY_UNION",
          child_region_codes: ["KR-SGIS-41111", "KR-SGIS-41113"],
        }),
      ],
      [burdenItem({ region_code: "KR-SGIS-41111", region_name: "수원시 장안구" })],
    );
    const dataset = buildScatterDataset(perCapita, burden, "HOUSEHOLD", "located");
    expect(dataset.points).toHaveLength(0);
    expect(dataset.excluded).toEqual([
      {
        regionCode: "KR-RCIS-CITY-41110",
        regionName: "수원시",
        reason: "DERIVED_CITY_GEOGRAPHY",
      },
    ]);
  });

  it("names a region with no matching burden row instead of dropping it silently", () => {
    const [perCapita, burden] = envelopes([perCapitaItem()], []);
    const dataset = buildScatterDataset(perCapita, burden, "HOUSEHOLD", "located");
    expect(dataset.points).toHaveLength(0);
    expect(dataset.excluded[0].reason).toBe("NO_MATCHING_BURDEN_REGION");
    expect(dataset.excluded[0].regionName).toBe("종로구");
  });

  it("excludes an unparseable value rather than plotting it at the origin", () => {
    const [perCapita, burden] = envelopes(
      [perCapitaItem()],
      [burdenItem({ throughput_located_kg_per_capita: "" })],
    );
    const dataset = buildScatterDataset(perCapita, burden, "HOUSEHOLD", "located");
    expect(dataset.points).toHaveLength(0);
    expect(dataset.excluded[0].reason).toBe("UNPARSEABLE_VALUE");
  });

  it("plots only the requested waste stream", () => {
    const [perCapita, burden] = envelopes(
      [
        perCapitaItem(),
        perCapitaItem({ waste_stream: "CONSTRUCTION", per_capita_kg_per_year: "900" }),
      ],
      [burdenItem()],
    );
    const dataset = buildScatterDataset(perCapita, burden, "HOUSEHOLD", "located");
    expect(dataset.points).toHaveLength(1);
    expect(dataset.points[0].generationExact).toBe("220.5");
  });

  it("returns an empty dataset when either envelope has not loaded", () => {
    const [perCapita, burden] = envelopes([perCapitaItem()], [burdenItem()]);
    expect(buildScatterDataset(null, burden, "HOUSEHOLD", "located").points).toHaveLength(0);
    expect(buildScatterDataset(perCapita, null, "HOUSEHOLD", "located").points).toHaveLength(0);
  });

  it("orders points deterministically so the plot and the tab order are stable", () => {
    const [perCapita, burden] = envelopes(
      [
        perCapitaItem({ reporting_region_code: "KR-SGIS-11170", reporting_region_name: "용산구" }),
        perCapitaItem({ reporting_region_code: "KR-SGIS-11110", reporting_region_name: "종로구" }),
      ],
      [
        burdenItem({ region_code: "KR-SGIS-11170", region_name: "용산구" }),
        burdenItem({ region_code: "KR-SGIS-11110", region_name: "종로구" }),
      ],
    );
    const dataset = buildScatterDataset(perCapita, burden, "HOUSEHOLD", "located");
    expect(dataset.points.map((point) => point.regionCode)).toEqual([
      "KR-SGIS-11110",
      "KR-SGIS-11170",
    ]);
  });
});

describe("median and quadrants", () => {
  it("makes no median claim from a single value", () => {
    expect(median([5])).toBeNull();
    expect(median([])).toBeNull();
  });

  it("computes the exact median of an even and an odd sample", () => {
    expect(median([1, 3])).toBe(2);
    expect(median([5, 1, 3])).toBe(3);
  });

  it("makes no quadrant claim when the medians do not exist", () => {
    const [perCapita, burden] = envelopes([perCapitaItem()], [burdenItem()]);
    const dataset = buildScatterDataset(perCapita, burden, "HOUSEHOLD", "located");
    expect(dataset.generationMedian).toBeNull();
    expect(quadrantOf(dataset.points[0], dataset)).toBeNull();
  });

  it("places a point relative to the medians of the plotted set only", () => {
    const [perCapita, burden] = envelopes(
      [
        perCapitaItem({ reporting_region_code: "A", per_capita_kg_per_year: "100" }),
        perCapitaItem({ reporting_region_code: "B", per_capita_kg_per_year: "300" }),
      ],
      [
        burdenItem({ region_code: "A", throughput_located_kg_per_capita: "50" }),
        burdenItem({ region_code: "B", throughput_located_kg_per_capita: "150" }),
      ],
    );
    const dataset = buildScatterDataset(perCapita, burden, "HOUSEHOLD", "located");
    expect(dataset.generationMedian).toBe(200);
    expect(dataset.burdenMedian).toBe(100);
    expect(quadrantOf(dataset.points[0], dataset)).toBe("low-low");
    expect(quadrantOf(dataset.points[1], dataset)).toBe("high-high");
  });
});
