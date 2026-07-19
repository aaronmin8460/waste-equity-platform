// @vitest-environment jsdom

/**
 * Selected-region identity tests for the dashboard shell.
 *
 * The persistent selection is the region CODE; the summary (name + label + value +
 * provenance) is DERIVED from it under the active metric. These assert the two
 * consequences of that ownership:
 *  - changing the metric on the SAME geography keeps the region selected and
 *    re-derives its value (never a stale snapshot, never a fabricated 0), and
 *  - a metric that switches to a different geography (here the empty reporting
 *    geometry) safely clears the summary, and returning restores it.
 * The accessible <select> and a map region click funnel to the same state, proven
 * by a stubbed MapView that surfaces a region-click trigger.
 *
 * MapLibre (WebGL) is stubbed and the backend is mocked, as in the other page
 * tests. Every value is a synthetic layout/derivation fixture, never official data;
 * these tests assert only on selection behaviour.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the dynamically-imported MapView with a controllable region-click trigger,
// so the map-click path and the accessible <select> path can be shown to share ONE
// selection state.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub(props: { onRegionClick?: (code: string) => void }) {
      return (
        <div data-testid="map-container">
          <button
            type="button"
            data-testid="stub-map-click-gangnam"
            onClick={() => props.onRegionClick?.("KR-SGIS-11680")}
          >
            map click 강남구
          </button>
        </div>
      );
    },
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const { homeApiMock } = await import("./homeApiMock");
  const base = homeApiMock(actual);
  const region = (code: string, name: string) => ({
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [126.97, 37.57],
          [126.99, 37.57],
          [126.99, 37.59],
          [126.97, 37.59],
          [126.97, 37.57],
        ],
      ],
    },
    properties: {
      region_code: code,
      region_name: name,
      region_level: "SIGUNGU",
      parent_region_code: "KR-SGIS-11",
      source_id: "sgis",
      boundary_reference_period: "2024",
    },
  });
  const population = (code: string, name: string, value: number) => ({
    region_code: code,
    region_name: name,
    region_level: "SIGUNGU",
    population: value,
    unit: "persons",
    population_definition: "SGIS 총인구",
    source_id: "sgis",
    reference_year: 2024,
    reference_period: "2024",
  });
  // A complete facility-burden item (same NATIVE geography as population), served
  // for 강남구 only — so switching population → facility-burden keeps the region but
  // yields a value for 강남구 and the explicit unavailable state for 종로구.
  const burdenItem = (code: string, name: string, kgPerCapita: string) => ({
    region_code: code,
    region_name: name,
    region_level: "SIGUNGU",
    facility_count_located: 2,
    throughput_located_tons_per_year: "10000.000000",
    throughput_located_kg_per_capita: kgPerCapita,
    located_missing_throughput_count: 0,
    located_throughput_is_partial: false,
    facility_count_within_buffer: 3,
    throughput_within_buffer_tons_per_year: "12000.000000",
    throughput_within_buffer_kg_per_capita: "640.000000",
    buffer_missing_throughput_count: 0,
    buffer_throughput_is_partial: false,
    quantity_unit: "kg/인/년",
    accounting_basis: "FACILITY_LOCATION_BASED_THROUGHPUT",
    facility_source_id: "waste_statistics",
    facility_reference_period: "2022",
    population: 561000,
    population_definition: "SGIS 총인구",
    population_source_id: "sgis",
    population_reference_period: "2024",
    reference_year: 2024,
  });
  return {
    ...base,
    fetchBoundaries: vi.fn().mockResolvedValue({
      type: "FeatureCollection",
      reference_year: 2024,
      count: 2,
      features: [region("KR-SGIS-11110", "종로구"), region("KR-SGIS-11680", "강남구")],
    }),
    fetchPopulation: vi.fn().mockResolvedValue({
      reference_year: 2024,
      count: 2,
      items: [
        population("KR-SGIS-11110", "종로구", 142000),
        population("KR-SGIS-11680", "강남구", 561000),
      ],
    }),
    fetchFacilityBurden: vi.fn().mockResolvedValue({
      indicator: "FACILITY_LOCATION_BASED_THROUGHPUT_PER_CAPITA",
      derivation_version: "facility-burden-v1",
      derivation_formula: "located throughput ÷ population",
      buffer_meters: 5000,
      unit: "kg/인/년",
      assumptions: ["분석용 가정"],
      reference_year: 2024,
      count: 1,
      items: [burdenItem("KR-SGIS-11680", "강남구", "520.000000")],
      excluded_regions: [],
      facilities_without_coordinates: 0,
      facilities_without_region: 0,
    }),
  };
});

import Home from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

async function renderLoaded() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  return utils;
}

const facilityRadio = () => screen.getByRole("radio", { name: /소재 시설 처리량/ });

describe("selected-region identity across metric changes", () => {
  it("keeps the region selected and re-derives its value when the metric changes", async () => {
    await renderLoaded();
    // Pick 강남구 via the accessible region <select>.
    fireEvent.change(screen.getByTestId("region-select"), { target: { value: "KR-SGIS-11680" } });
    expect(screen.getByTestId("selected-region-name").textContent).toBe("강남구");
    expect(screen.getByTestId("selected-region-value").textContent).toContain("561,000");

    // Switch to a facility-burden metric on the SAME (native) geography.
    fireEvent.click(facilityRadio());

    // Same region stays selected; the label + value update to the new metric.
    await waitFor(() =>
      expect(screen.getByTestId("selected-region-value").textContent).toContain("520"),
    );
    expect(screen.getByTestId("selected-region-name").textContent).toBe("강남구");
    expect((screen.getByTestId("region-select") as HTMLSelectElement).value).toBe("KR-SGIS-11680");
    // The metric label rendered in the summary reflects the new metric.
    expect(screen.getByTestId("selected-region-summary").textContent).toContain("소재 시설 처리량");
  });

  it("shows an explicit unavailable state (never a fabricated 0) when the new metric serves no value", async () => {
    await renderLoaded();
    // 종로구 has population but NO facility-burden value in the fixture.
    fireEvent.change(screen.getByTestId("region-select"), { target: { value: "KR-SGIS-11110" } });
    expect(screen.getByTestId("selected-region-value").textContent).toContain("142,000");

    fireEvent.click(facilityRadio());
    await waitFor(() => expect(screen.getByTestId("selected-region-name").textContent).toBe("종로구"));

    const value = screen.getByTestId("selected-region-value");
    expect(value.textContent).toContain("데이터 없음");
    // Never a zero-filled value.
    expect(value.textContent).not.toMatch(/(^|\D)0(\D|$)/);
    // Unavailability is conveyed by the text itself (and amber), not by color alone.
    expect(value.className).toContain("text-amber-700");
  });

  it("shares one selection state between a map region click and the accessible dropdown", async () => {
    await renderLoaded();
    // The map-click path (stubbed) stores the region code…
    fireEvent.click(screen.getByTestId("stub-map-click-gangnam"));
    expect(screen.getByTestId("selected-region-name").textContent).toBe("강남구");
    // …and the SAME state is reflected by the accessible <select>.
    expect((screen.getByTestId("region-select") as HTMLSelectElement).value).toBe("KR-SGIS-11680");
  });

  it("safely clears when the metric switches to a geography lacking the region, and restores on return", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByTestId("region-select"), { target: { value: "KR-SGIS-11110" } });
    expect(screen.getByTestId("selected-region-name").textContent).toBe("종로구");

    // Household waste renders on the (empty) RCIS reporting geometry — the SGIS code
    // is not present there, so the summary clears without fabricating anything.
    fireEvent.click(screen.getByRole("radio", { name: /생활계 폐기물 발생량/ }));
    await waitFor(() => expect(screen.queryByTestId("selected-region-name")).toBeNull());
    expect(screen.getByTestId("selected-region-empty")).toBeDefined();

    // Returning to a native metric that DOES contain the region restores it (the
    // identity was preserved, only the derivation was empty on the other geography).
    fireEvent.click(screen.getByRole("radio", { name: /인구/ }));
    await waitFor(() =>
      expect(screen.getByTestId("selected-region-name").textContent).toBe("종로구"),
    );
  });

  it("exposes meaningful accessible names on the metric radios (via their wrapping labels)", async () => {
    await renderLoaded();
    // No aria-label added — the wrapping <label> text is the accessible name.
    expect(screen.getByRole("radio", { name: /인구/ })).toBeDefined();
    expect(screen.getByRole("radio", { name: /생활계 폐기물 발생량/ })).toBeDefined();
    expect(screen.getByRole("radio", { name: /소재 시설 처리량/ })).toBeDefined();
  });
});
