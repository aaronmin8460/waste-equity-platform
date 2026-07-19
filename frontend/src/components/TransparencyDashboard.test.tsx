// @vitest-environment jsdom

/**
 * 데이터·출처 (transparency) dashboard tests: sources, dataset counts, and the
 * facility mapping transparency panel — including that a missing map location shows
 * its recorded reason, or "실패 사유 기록 없음" when none was recorded (never a
 * fabricated reason).
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadedData } from "../app/page";

const mapping = vi.hoisted(() => ({
  reference_year: 2024,
  reference_period: "2024",
  total: 120,
  with_map_location: 90,
  without_map_location: 30,
  without_address: 0,
  category_breakdown: [
    { category: "PUBLIC_INCINERATION", total: 40, with_map_location: 35, without_map_location: 5 },
  ],
  ownership_breakdown: [{ ownership: "PUBLIC", total: 80 }],
  region_mapping_breakdown: [{ region_mapping_status: "UNMATCHED", total: 30 }],
  source_breakdown: [{ source_id: "waste_statistics", official_dataset_name: "시설현황", total: 120 }],
  unmapped: {
    page: 1,
    page_size: 25,
    total: 2,
    items: [
      {
        id: 1,
        facility_name: "가나 소각장",
        facility_category: "PUBLIC_INCINERATION",
        ownership: "PUBLIC",
        rcis_sido_name: "서울특별시",
        rcis_sigungu_name: "강남구",
        region_code: null,
        region_name: null,
        region_mapping_status: "UNMATCHED",
        geocode_status: "FAILED",
        missing_location_reason: "주소 정제 실패",
      },
      {
        id: 2,
        facility_name: "다라 매립장",
        facility_category: "PUBLIC_LANDFILL",
        ownership: "PUBLIC",
        rcis_sido_name: "인천광역시",
        rcis_sigungu_name: "옹진군",
        region_code: null,
        region_name: null,
        region_mapping_status: "UNMATCHED",
        geocode_status: null,
        missing_location_reason: null, // → "실패 사유 기록 없음"
      },
    ],
  },
  disclaimer: "지도 위치가 없는 시설은 주소를 좌표로 변환하지 못한 경우입니다.",
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    fetchDataFreshness: vi.fn().mockResolvedValue([
      {
        source_id: "sgis",
        source_name: "통계청 SGIS",
        publication_frequency: "ANNUAL",
        latest_reference_period: "2024",
        last_checked_at: null,
        last_changed_at: null,
        last_success_at: null,
        next_scheduled_at: null,
        freshness_status: "FRESH",
      },
    ]),
    fetchSuitabilityPolicy: vi.fn().mockResolvedValue({
      policy_version: "suitability-policy-v2",
      derivation_version: "suitability-screening-v3",
      candidate_grid_version: "capital-grid-500m-v1",
    }),
    fetchSuitabilityLatestRun: vi
      .fn()
      .mockResolvedValue({ id: 48, reference_year: 2024, candidate_count_total: 47893 }),
    fetchFacilityCostOptions: vi
      .fn()
      .mockResolvedValue({ active_cost_version: "capex-standard-v2022dec" }),
    fetchFacilityMappingTransparency: vi.fn().mockResolvedValue(mapping),
  };
});

import TransparencyDashboard from "./TransparencyDashboard";

const data = {
  sources: [
    {
      source_id: "sgis",
      source_name: "통계청 SGIS",
      dataset_name: "인구 통계",
      endpoint: "/x",
      publication_frequency: "ANNUAL",
      enabled: true,
      documentation_url: null,
    },
  ],
  population: { reference_year: 2024, count: 66, items: [{ reference_period: "2024" }] },
  reportingStats: { reference_year: 2024, count: 40, items: [{ reference_period: "2022" }] },
  reportingPerCapita: { reference_year: 2022, count: 40, items: [] },
  facilities: { reference_year: 2024, count: 120, items: [{ reference_period: "2024" }] },
} as unknown as LoadedData;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("TransparencyDashboard", () => {
  it("lists the public data sources", async () => {
    render(<TransparencyDashboard data={data} />);
    expect(await screen.findByTestId("transparency-sources")).toBeDefined();
    expect(screen.getByTestId("transparency-sources").textContent).toContain("인구 통계");
    expect(screen.getByTestId("transparency-sources").textContent).toContain("통계청 SGIS");
  });

  it("shows dataset reference periods and served record counts", async () => {
    render(<TransparencyDashboard data={data} />);
    const datasets = await screen.findByTestId("transparency-datasets");
    expect(datasets.textContent).toContain("인구 (SGIS)");
    expect(datasets.textContent).toContain("66"); // served population count
  });

  it("shows facility mapping counts and the recorded / missing reasons", async () => {
    render(<TransparencyDashboard data={data} />);
    await waitFor(() => expect(screen.getByTestId("facility-mapping-counts")).toBeDefined());
    expect(screen.getByTestId("facility-mapping-counts").textContent).toContain("120"); // total
    expect(screen.getByTestId("facility-mapping-counts").textContent).toContain("30"); // without

    const table = screen.getByTestId("unmapped-facility-table");
    // Recorded reason surfaced verbatim...
    expect(table.textContent).toContain("주소 정제 실패");
    // ...and the honest placeholder when none was recorded (never fabricated).
    expect(table.textContent).toContain("실패 사유 기록 없음");
  });

  it("states the scenario results are temporary and not persisted", async () => {
    render(<TransparencyDashboard data={data} />);
    expect((await screen.findByTestId("transparency-scenario")).textContent).toContain(
      "저장되지 않습니다",
    );
  });
});
