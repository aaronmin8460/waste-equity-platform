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
  // ③ 종합 점수와 후보 순위 reads the SCOPED ranking from the candidates COLLECTION,
  // not from `summary.top_candidates` — the summary has no scope parameters, so it
  // could only ever describe the whole run. This fixture predates that move and
  // mocked only the summary and the per-candidate DETAIL route, which left the
  // ranking list genuinely empty and `top-candidate-item` absent.
  //
  // Registered BEFORE the detail route on purpose: Playwright matches the most
  // recently registered route first, so the narrower `/candidates/{id}` regex below
  // must come last or it would never win against this glob.
  await page.route("**/api/v1/suitability/candidates**", (r) =>
    json(r, {
      type: "FeatureCollection",
      indicator: "SUITABILITY_SCREENING",
      derivation_version: "suitability-screening-v3",
      policy_version: "suitability-policy-v2",
      candidate_grid_version: "capital-grid-500m-v1",
      weight_profile: "baseline",
      reference_year: 2024,
      run_id: 47,
      count: 1,
      total_matched: 1,
      limit: 10,
      offset: 0,
      sido: null,
      sigungu: [],
      sort: "score_desc",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [126.4, 37.7] },
          properties: {
            ...TOP_CANDIDATE,
            // The summary spells the location `sigungu`; a candidate feature spells
            // it `sigungu_region_name`.
            sigungu_region_name: TOP_CANDIDATE.sigungu,
            status: "ELIGIBLE",
          },
        },
      ],
      assumptions: [],
      disclaimer: "Analytical screening only — not a legal determination.",
    }),
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
  test("high/low ranking, the full ranking, and map-synced selection via visible Korean labels", async ({
    page,
  }) => {
    await setup(page);
    // The plain-Korean navigation is present.
    await expect(page.getByRole("button", { name: "지역 지표" })).toBeVisible();
    await expect(page.getByRole("button", { name: "후보지 분석", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "데이터·출처" })).toBeVisible();

    // The highest-value region leads the "값이 높은 지역" list.
    const high = page.getByTestId("rank-high");
    await expect(high).toContainText("수원시 장안구");
    await expect(high).toContainText("500,000");

    // See every region at once through 지표 순위 전체보기 — the citizen path that
    // replaced hand-picking up to three regions in 지역 비교 (correction pass).
    await page.getByTestId("open-full-ranking").click();
    const fullRanking = page.getByTestId("full-ranking-dialog");
    await expect(fullRanking).toBeVisible();
    await expect(fullRanking.getByTestId("full-ranking-table")).toContainText("종로구");
    await expect(fullRanking.getByTestId("full-ranking-table")).toContainText("300,000");
    await fullRanking.getByTestId("full-ranking-dialog-close").click();
    await expect(fullRanking).toHaveCount(0);

    // Selecting a ranked region drives the shared summary (map sync).
    await page.getByTestId("rank-high").getByTestId("rank-row").first().click();
    await expect(page.getByTestId("selected-region-name")).toHaveText("수원시 장안구");
  });
});

test.describe("Task B — 후보지 심층 분석 (suitability score)", () => {
  test("shows the three plain statuses, a scoring basis, and a candidate detail", async ({
    page,
  }) => {
    await setup(page);
    await page.getByRole("button", { name: "후보지 심층 분석" }).click();
    // MIGRATED to the final Page-4 contract (36cdb33). 후보 상태 요약
    // (`candidate-counts`) is STRUCK from the 후보지 심층 분석 workspace per the Figma
    // 기술 참고사항 ("좌측 패널에 [후보 상태 요약] … 삭제"); its status breakdown moved to
    // the map's own 스크리닝 내역 legend. Verified by enumerating every rendered testid
    // across all three suitability destinations — it renders in none of them.
    //
    // The contract audited here is that a reader never sees a RAW BACKEND ENUM where a
    // status belongs, and that each plain status name is present. Asserted over the
    // whole rendered view, which is strictly broader than the old element-scoped read.
    const view = page.locator("body");
    await expect(view).toContainText("스크리닝 통과");
    await expect(view).toContainText("추가 검토 필요");
    await expect(view).toContainText("프로젝트 스크리닝 제외");
    await expect(view).not.toContainText("REVIEW_REQUIRED");
    // The analytical-screening limitation is stated on the MAP, not as a standing
    // banner above the controls.
    //
    // Phase 0 put a full `suitability-screening-disclaimer` banner at the head of the
    // suitability sidebar. 후보지 심층 분석 no longer has that sidebar: Figma 136:8684
    // opens the left column with ① and nothing above it, so `app/page.tsx` renders the
    // collapsible workspace instead and deliberately carries no standing banner there
    // ("NO standing disclaimer BANNER here" — the limitation is not dropped, it is
    // printed on the map's own legend as SUITABILITY_SCREENING_SHORT_LABEL, in the
    // map's aria-description, and in 계산 방법과 가정).
    //
    // The other two suitability sub-views, which have no map legend of their own,
    // still render the full banner — `suitabilityDashboard.spec.ts` owns that. Here
    // the correct assertion is the legend note, which is where a citizen on THIS
    // screen actually meets the limitation.
    await expect(page.getByTestId("suitability-legend-note")).toContainText(
      "법적·공학적 적합 판정 아님",
    );
    // Choose a scoring basis (점수 반영 기준) — plain labels.
    await expect(page.getByText("점수 반영 기준", { exact: true })).toBeVisible();
    // Inspect a candidate.
    await page.getByTestId("top-candidate-item").first().click();
    await expect(page.getByTestId("candidate-detail")).toBeVisible();
  });
});

test.describe("Task C — 후보지 심층 비교 (scenario)", () => {
  test("apply a preset and see rank movement and the temporary-result note", async ({ page }) => {
    await setup(page);
    // One click: the scenario sub-view is a top-level destination now.
    await page.getByRole("button", { name: "후보지 심층 비교" }).click();
    await expect(page.getByTestId("scenario-lab")).toBeVisible();
    await expect(page.getByTestId("scenario-warning")).toBeVisible();
  });

  test("a shared scenario URL seeds the weights, preserves the link, and applies via the preview API", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.route("**/api/v1/regions/boundaries**", (r) => json(r, BOUNDARIES));
    await page.route("**/api/v1/population**", (r) => json(r, POPULATION));
    await page.route("**/api/v1/suitability/summary**", (r) =>
      json(r, { ...SUMMARY, top_candidates: [TOP_CANDIDATE] }),
    );
    // Open a shared scenario link directly (weights sum to 100%).
    await page.goto("/?v=1&mode=suitability&view=scenario&wz=0.40000000&wr=0.20000000&we=0.20000000&wd=0.20000000");
    await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("scenario-lab")).toBeVisible();
    // The shared weights seeded the editor (40/20/20/20) and the link is preserved
    // in the address bar (not self-stripped).
    await expect(page.getByRole("spinbutton", { name: /용도지역/ })).toHaveValue("40");
    expect(page.url()).toContain("wz=0.4");
    // One click applies, re-validated through the preview API → results appear.
    await page.getByTestId("scenario-apply").click();
    await expect(page.getByTestId("scenario-top-candidates")).toBeVisible();
  });
});

test.describe("Task D — 후보지 분석 (facility cost)", () => {
  test("opens the full-width cost view with no map", async ({ page }) => {
    await setup(page);
    await page.getByRole("button", { name: "후보지 분석", exact: true }).click();
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
    // The catalogue itself carries no map. 데이터·출처 is a dialog now, so the
    // destination behind it may legitimately have one — the assertion is scoped
    // to the dialog rather than to the whole page.
    await expect(page.getByTestId("data-sources-dialog").getByTestId("map-container"))
      .toHaveCount(0);
  });
});
