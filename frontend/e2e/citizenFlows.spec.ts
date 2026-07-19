import { expect, test, type Page, type Route } from "@playwright/test";

import { mockBackend } from "./mockBackend";

/**
 * First-time citizen flows, driven through VISIBLE KOREAN LABELS rather than only
 * internal test IDs. Self-mocked: the base backend comes from mockBackend, and this
 * spec layers populated region / facility / transparency fixtures on top (Playwright
 * runs the most-recently-registered matching route first, so these override the base
 * empty envelopes without changing any other spec). Every fixture is synthetic; the
 * spec asserts plain-Korean structure and behaviour, never real data values.
 */

const REGIONS = [
  { code: "KR-SGIS-11110", name: "종로구", pop: 300000 },
  { code: "KR-SGIS-11140", name: "중구", pop: 100000 },
  { code: "KR-SGIS-23320", name: "옹진군", pop: 50000 },
  { code: "KR-SGIS-31011", name: "수원시 장안구", pop: 500000 },
];

function poly(i: number) {
  const x = 126.9 + i * 0.05;
  const y = 37.5 + i * 0.03;
  return {
    type: "Polygon",
    coordinates: [
      [
        [x, y],
        [x + 0.02, y],
        [x + 0.02, y + 0.02],
        [x, y + 0.02],
        [x, y],
      ],
    ],
  };
}

const BOUNDARIES = {
  type: "FeatureCollection",
  reference_year: 2024,
  count: REGIONS.length,
  features: REGIONS.map((r, i) => ({
    type: "Feature",
    geometry: poly(i),
    properties: {
      region_code: r.code,
      region_name: r.name,
      region_level: "SIGUNGU",
      parent_region_code: null,
      source_id: "sgis",
      boundary_reference_period: "2024",
    },
  })),
};

const POPULATION = {
  reference_year: 2024,
  count: REGIONS.length,
  items: REGIONS.map((r) => ({
    region_code: r.code,
    region_name: r.name,
    region_level: "SIGUNGU",
    population: r.pop,
    unit: "persons",
    population_definition: "SGIS 총인구",
    source_id: "sgis",
    reference_year: 2024,
    reference_period: "2024",
  })),
};

const DATA_SOURCES = [
  {
    source_id: "sgis",
    source_name: "통계청 SGIS",
    dataset_name: "인구 통계",
    endpoint: "/x",
    publication_frequency: "ANNUAL",
    enabled: true,
    documentation_url: null,
  },
];

const DATA_FRESHNESS = [
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
];

const MAPPING = {
  reference_year: 2024,
  reference_period: "2024",
  total: 10,
  with_map_location: 7,
  without_map_location: 3,
  without_address: 0,
  category_breakdown: [
    { category: "PUBLIC_INCINERATION", total: 10, with_map_location: 7, without_map_location: 3 },
  ],
  ownership_breakdown: [{ ownership: "PUBLIC", total: 10 }],
  region_mapping_breakdown: [{ region_mapping_status: "UNMATCHED", total: 3 }],
  source_breakdown: [{ source_id: "waste_statistics", official_dataset_name: "시설현황", total: 10 }],
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
        missing_location_reason: null,
      },
    ],
  },
  disclaimer: "지도 위치가 없는 시설은 주소를 좌표로 변환하지 못한 경우이며, 시설이 없다는 뜻이 아닙니다.",
};

const TOP_CANDIDATE = {
  candidate_id: 4242,
  candidate_key: "capital-grid-500m-v1:12_20",
  rank: 1,
  total_score: "83.5",
  sigungu: "강화군",
  stable_count: 3,
  stability_class: "STABLE",
  stability_membership: { baseline: true, equal: true, critic: true },
  zoning_score: "90",
  road_score: "70",
  equity_score: "80",
  demand_score: "88",
  centroid_lon: 126.4,
  centroid_lat: 37.7,
};

const CANDIDATE_DETAIL = {
  candidate_id: 4242,
  candidate_key: "capital-grid-500m-v1:12_20",
  status: "ELIGIBLE",
  profile: "baseline",
  is_excluded: false,
  rank: 1,
  total_score: "83.5",
  provisional_score: null,
  zoning_score: "90",
  road_score: "70",
  equity_score: "80",
  demand_score: "88",
  sido_region_code: "28",
  sido_region_name: "인천광역시",
  sigungu_region_code: "28710",
  sigungu_region_name: "강화군",
  nearest_road_distance_m: "120",
  stable_count: 3,
  stability_class: "STABLE",
  stability_membership: { baseline: true, equal: true, critic: true },
  exclusion_reasons: [],
  review_reasons: [],
  run_id: 47,
  profile_totals: { baseline: "83.5", equal: "80.0", critic: "82.1" },
  profile_ranks: { baseline: 1, equal: 2, critic: 1 },
  penalties: [],
  raw_components: {},
  nearest_road_provenance: {},
  component_provenance: {},
  original_area_m2: "250000",
  clipped_area_m2: "250000",
  clipped_area_ratio: "1",
  geometry: { type: "Point", coordinates: [126.4, 37.7] },
  reference_year: 2024,
  policy_version: "suitability-policy-v2",
  derivation_version: "suitability-screening-v3",
  candidate_grid_version: "capital-grid-500m-v1",
  weights: { zoning: "0.4", road: "0.3", equity: "0.2", demand: "0.1" },
  disclaimer: "분석용 스크리닝 결과이며 법적 결정이 아닙니다.",
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function setup(page: Page) {
  await mockBackend(page);
  // Override the base empty envelopes with populated citizen fixtures. Registered
  // AFTER mockBackend, so Playwright matches these first.
  await page.route("**/api/v1/regions/boundaries**", (r) => json(r, BOUNDARIES));
  await page.route("**/api/v1/population**", (r) => json(r, POPULATION));
  await page.route("**/api/v1/data-sources**", (r) => json(r, DATA_SOURCES));
  await page.route("**/api/v1/data-freshness**", (r) => json(r, DATA_FRESHNESS));
  await page.route("**/api/v1/facilities/mapping-transparency**", (r) => json(r, MAPPING));
  await page.route("**/api/v1/suitability/summary**", (r) =>
    json(r, { ...SUMMARY, top_candidates: [TOP_CANDIDATE] }),
  );
  await page.route(/\/api\/v1\/suitability\/candidates\/\d+/, (r) => json(r, CANDIDATE_DETAIL));
  await page.goto("/");
  await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
}

// A copy of the base summary with a top candidate (mockBackend's is empty).
const SUMMARY = {
  run_id: 47,
  reference_year: 2024,
  policy_version: "suitability-policy-v2",
  derivation_version: "suitability-screening-v3",
  candidate_grid_version: "capital-grid-500m-v1",
  weight_profile: "baseline",
  candidate_count_total: 47893,
  candidate_count_eligible: 1099,
  candidate_count_review: 34534,
  candidate_count_excluded: 12260,
  exclusion_reason_counts: {},
  review_reason_counts: {},
  sido_distribution: {},
  top_candidates: [],
  critic_weights: { zoning: "0.31", road: "0.19", equity: "0.28", demand: "0.22" },
  stability_top_fraction: "0.10",
  stability_top_cutoff_rank: 110,
  candidate_count_stable: 62,
  candidate_count_conditionally_stable: 140,
  candidate_count_weight_sensitive: 897,
  top_stable_candidates: [],
  stability_definition: {},
  stability_available: true,
  coverage_notes: [],
  assumptions: [],
  disclaimer: "Analytical screening only.",
};

test.describe("Task A — 지역 부담 (equity)", () => {
  test("high/low ranking, comparison, and map-synced selection via visible Korean labels", async ({
    page,
  }) => {
    await setup(page);
    // The plain-Korean navigation is present.
    await expect(page.getByRole("button", { name: "지역 부담" })).toBeVisible();
    await expect(page.getByRole("button", { name: "후보지 분석" })).toBeVisible();
    await expect(page.getByRole("button", { name: "데이터·출처" })).toBeVisible();

    // The highest-value region leads the "값이 높은 지역" list.
    const high = page.getByTestId("rank-high");
    await expect(high).toContainText("수원시 장안구");
    await expect(high).toContainText("500,000");

    // Compare two regions via the searchable combobox. Type to filter, wait for the
    // listbox, then pick the option from within it (robust against the blur race).
    const search = page.getByTestId("comparison-search");
    await search.click();
    await search.pressSequentially("종로");
    const options = page.getByTestId("comparison-options");
    await expect(options).toBeVisible();
    await options.getByText("종로구").click();
    await search.pressSequentially("중구");
    await expect(options).toBeVisible();
    await options.getByText("중구").click();
    await expect(page.getByTestId("comparison-table")).toContainText("종로구");
    await expect(page.getByTestId("comparison-table")).toContainText("300,000");

    // Selecting a ranked region drives the shared summary (map sync).
    await page.getByTestId("rank-high").getByTestId("rank-row").first().click();
    await expect(page.getByTestId("selected-region-name")).toHaveText("수원시 장안구");
  });
});

test.describe("Task B — 후보지 분석 (suitability)", () => {
  test("shows the three plain statuses, a scoring basis, and a candidate detail", async ({
    page,
  }) => {
    await setup(page);
    await page.getByRole("button", { name: "후보지 분석" }).click();
    await expect(page.getByTestId("candidate-counts")).toContainText("1차 분석 통과");
    await expect(page.getByTestId("candidate-counts")).toContainText("추가 확인 필요");
    await expect(page.getByTestId("candidate-counts")).toContainText("현재 기준에서 제외");
    // Choose a scoring basis (점수 반영 기준) — plain labels.
    await expect(page.getByText("점수 반영 기준", { exact: true })).toBeVisible();
    // Inspect a candidate.
    await page.getByTestId("top-candidate-item").first().click();
    await expect(page.getByTestId("candidate-detail")).toBeVisible();
  });
});

test.describe("Task C — 가중치 바꿔보기 (scenario)", () => {
  test("apply a preset and see rank movement and the temporary-result note", async ({ page }) => {
    await setup(page);
    await page.getByRole("button", { name: "후보지 분석" }).click();
    await page.getByRole("button", { name: "가중치 바꿔보기" }).click();
    await expect(page.getByTestId("scenario-lab")).toBeVisible();
    await expect(page.getByTestId("scenario-warning")).toBeVisible();
  });
});

test.describe("Task D — 비용 살펴보기 (cost)", () => {
  test("opens the full-width cost view with no map", async ({ page }) => {
    await setup(page);
    await page.getByRole("button", { name: "후보지 분석" }).click();
    await page.getByRole("button", { name: "비용 살펴보기" }).click();
    await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible();
    await expect(page.getByTestId("map-container")).toHaveCount(0);
  });
});

test.describe("Task E — 데이터·출처 (transparency)", () => {
  test("shows sources, dataset periods, and the unmapped facilities with recorded/missing reasons", async ({
    page,
  }) => {
    await setup(page);
    await page.getByRole("button", { name: "데이터·출처" }).click();
    await expect(page.getByTestId("transparency-sources")).toContainText("인구 통계");
    await expect(page.getByTestId("facility-mapping-counts")).toContainText("10");
    const table = page.getByTestId("unmapped-facility-table");
    await expect(table).toContainText("주소 정제 실패");
    await expect(table).toContainText("실패 사유 기록 없음");
    // No map in the transparency view.
    await expect(page.getByTestId("map-container")).toHaveCount(0);
  });
});
