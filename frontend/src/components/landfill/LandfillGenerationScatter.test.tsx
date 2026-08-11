// @vitest-environment jsdom

/**
 * 지역별 폐기물 발생과 처리 비교 — the plot's rendering contract.
 *
 * The join itself is covered by `lib/landfillScatter.test.ts`. What matters here is
 * that the plot never becomes the only representation of a value, that a point is
 * operable from the keyboard, and that the comparability caveat cannot be hidden.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import type {
  FacilityBurdenEnvelope,
  FacilityBurdenItem,
  ReportingPerCapitaEnvelope,
  ReportingPerCapitaItem,
} from "../../lib/api";
import LandfillGenerationScatter from "./LandfillGenerationScatter";

afterEach(cleanup);

function perCapitaItem(
  code: string,
  name: string,
  value: string,
  overrides: Partial<ReportingPerCapitaItem> = {},
): ReportingPerCapitaItem {
  return {
    reporting_region_code: code,
    reporting_region_name: name,
    reporting_geography_type: "NATIVE_SGIS",
    source_reporting_level: "SIGUNGU",
    waste_stream: "HOUSEHOLD",
    per_capita_kg_per_year: value,
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

function burdenItem(code: string, name: string, value: string): FacilityBurdenItem {
  return {
    region_code: code,
    region_name: name,
    region_level: "SIGUNGU",
    facility_count_located: 2,
    throughput_located_tons_per_year: "12000.000000",
    throughput_located_kg_per_capita: value,
    located_missing_throughput_count: 0,
    located_throughput_is_partial: false,
    facility_count_within_buffer: 5,
    throughput_within_buffer_tons_per_year: "30000.000000",
    throughput_within_buffer_kg_per_capita: "200.0",
    buffer_missing_throughput_count: 0,
    buffer_throughput_is_partial: false,
    quantity_unit: "톤",
    accounting_basis: "FACILITY_LOCATION_THROUGHPUT",
    facility_source_id: "rcis_facilities",
    facility_reference_period: "2023",
    population: 150000,
    population_definition: "SGIS_TOTAL",
    population_source_id: "sgis_population",
    population_reference_period: "2023",
    reference_year: 2023,
  };
}

const perCapita: ReportingPerCapitaEnvelope = {
  indicator: "WASTE_PER_CAPITA",
  derivation_version: "v1",
  derivation_formula: "generation ÷ population",
  unit: "kg/인·년",
  assumptions: [],
  reference_year: 2023,
  count: 2,
  items: [
    perCapitaItem("KR-SGIS-11110", "종로구", "220.5"),
    perCapitaItem("KR-SGIS-11170", "용산구", "310.25"),
  ],
  excluded_regions: [],
};

const burden: FacilityBurdenEnvelope = {
  indicator: "FACILITY_BURDEN",
  derivation_version: "v1",
  derivation_formula: "throughput ÷ population",
  buffer_meters: 5000,
  unit: "kg/인·년",
  assumptions: [],
  reference_year: 2023,
  count: 2,
  items: [
    burdenItem("KR-SGIS-11110", "종로구", "80.0"),
    burdenItem("KR-SGIS-11170", "용산구", "150.5"),
  ],
  excluded_regions: [],
  facilities_without_coordinates: 0,
  facilities_without_region: 0,
};

describe("LandfillGenerationScatter", () => {
  it("renders one operable point per joined region", () => {
    render(<LandfillGenerationScatter perCapita={perCapita} burden={burden} />);
    const points = screen.getAllByTestId("landfill-scatter-point");
    expect(points).toHaveLength(2);
    // Focusable and named with both exact values, so the plot is not mouse-only.
    expect(points[0].getAttribute("tabindex")).toBe("0");
    expect(points[0].getAttribute("aria-label")).toContain("종로구");
    expect(points[0].getAttribute("aria-label")).toContain("220.5");
    expect(points[0].getAttribute("aria-label")).toContain("80");
  });

  it("selects a point from the keyboard and shows its exact served values", () => {
    render(<LandfillGenerationScatter perCapita={perCapita} burden={burden} />);
    const point = screen.getAllByTestId("landfill-scatter-point")[1];
    fireEvent.keyDown(point, { key: "Enter" });
    const detail = screen.getByTestId("landfill-scatter-selection");
    expect(detail.textContent).toContain("용산구");
    expect(detail.textContent).toContain("310.25");
    expect(detail.textContent).toContain("150.5");
    expect(point.getAttribute("aria-pressed")).toBe("true");
    // Pressing again clears the selection rather than trapping the reader in it.
    fireEvent.keyDown(point, { key: "Enter" });
    expect(screen.getByTestId("landfill-scatter-selection").textContent).toContain(
      "점을 선택하면",
    );
  });

  it("states the two accounting bases are not comparable, outside any disclosure", () => {
    render(<LandfillGenerationScatter perCapita={perCapita} burden={burden} />);
    const caveat = screen.getByTestId("landfill-scatter-caveat");
    expect(caveat.textContent).toContain("발생지 기준");
    expect(caveat.textContent).toContain("시설 소재지 기준");
    expect(caveat.textContent).toContain("처리 부족분이나 잉여로 읽을 수 없습니다");
    // It must not be behind a <details> a reader can leave closed.
    expect(caveat.closest("details")).toBeNull();
  });

  it("keeps every plotted value reachable as text", () => {
    render(<LandfillGenerationScatter perCapita={perCapita} burden={burden} />);
    const table = screen.getByTestId("landfill-scatter-table");
    expect(within(table).getByText("310.25")).toBeDefined();
    expect(within(table).getByText("80")).toBeDefined();
  });

  it("reads the 인근 5km measure from the served indicator when switched", () => {
    render(<LandfillGenerationScatter perCapita={perCapita} burden={burden} />);
    fireEvent.click(screen.getByTestId("landfill-scatter-mode-buffer"));
    const table = screen.getByTestId("landfill-scatter-table");
    expect(within(table).getAllByText("200")).toHaveLength(2);
    // The buffer distance shown is the backend's served value.
    expect(screen.getByTestId("landfill-scatter-coverage").textContent).toContain("5,000m");
  });

  it("names the regions it could not plot instead of implying full coverage", () => {
    const withCity: ReportingPerCapitaEnvelope = {
      ...perCapita,
      items: [
        ...perCapita.items,
        perCapitaItem("KR-RCIS-CITY-41110", "수원시", "400", {
          reporting_geography_type: "DERIVED_CITY_UNION",
        }),
      ],
    };
    render(<LandfillGenerationScatter perCapita={withCity} burden={burden} />);
    const excluded = screen.getByTestId("landfill-scatter-excluded");
    expect(excluded.textContent).toContain("수원시");
    expect(excluded.textContent).toContain("지역 단위가 다름");
    expect(screen.getByTestId("landfill-scatter-count").textContent).toBe("2곳");
  });

  it("shows an honest empty state rather than an empty plot", () => {
    render(<LandfillGenerationScatter perCapita={null} burden={null} />);
    expect(screen.getByTestId("landfill-scatter-empty")).toBeDefined();
    expect(screen.queryByTestId("landfill-scatter-plot")).toBeNull();
  });
});
