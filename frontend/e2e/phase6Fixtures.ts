import type { Page, Route } from "@playwright/test";

import { mockBackend } from "./mockBackend";

/**
 * Source-registry fixtures for the Phase 6 데이터와 출처 specs.
 *
 * ── THESE RECORDS ARE SYNTHETIC — THEY ARE NOT OFFICIAL DATA ────────────────────
 * Every record below is a SYNTHETIC LAYOUT FIXTURE invented for this spec. They
 * exist ONLY so the catalog, its search, its filters, and its five states have a
 * rendered tree to measure at each viewport. None of it is a real source registry
 * entry, a real reference period, a real collection timestamp, or a real count, and
 * NONE OF IT MAY BE PUBLISHED OR QUOTED AS PLATFORM OUTPUT. The specs assert
 * STRUCTURE and BEHAVIOUR — ordering, overflow, state separation, keyboard reach —
 * and never assert that a value is correct.
 *
 * ── WHERE THE SYNTHETIC MARKER IS, AND IS NOT, VISIBLE ─────────────────────────
 * Every record carries `분석용 합성 픽스처 — 공식 자료 아님` in its `source_name` and
 * `dataset_name`. For a record whose `source_id` this repository seeds, those two
 * strings are REPLACED on screen by the Korean rendering from `lib/dataSources.ts`,
 * so the marker survives only in the card's `기술 정보 보기` disclosure — which is
 * closed by default. A screenshot of this fixture therefore shows a REAL agency
 * name and a REAL dataset name beside an INVENTED reference period and collection
 * timestamp, with no visible marker.
 *
 * That is why the review captures are opt-in, written only to gitignored
 * `test-results/`, and must never be published or quoted as platform output. It is
 * also why the two fields most likely to be mistaken for fact — `documentation_url`
 * and the endpoint — carry the REAL seeded values (see below) rather than invented
 * ones: the fixture must not contradict the registry in a field a reader could
 * check. Only the freshness periods, the collection timestamps, and the facility
 * counts are invented, and those are what the specs assert STRUCTURE on.
 *
 * ── Why the real source ids are reused ──────────────────────────────────────────
 * `source_id` values that the repository genuinely seeds are reused so the fixture
 * exercises the real translation path in `lib/dataSources.ts` (a record whose id is
 * unknown takes the untranslated fallback branch instead, which is a different code
 * path). The NAMES attached to them here are still synthetic: the marker text is
 * appended to `source_name`, and the reference periods and timestamps are invented.
 * Two deliberately unknown ids cover the fallback branch, the long-identifier
 * wrapping case, and both link edge cases — so a real agency is never shown with a
 * missing or malformed institutional link.
 *
 * ── Why this file exists rather than a change to `mockBackend.ts` ───────────────
 * The shared mock deliberately serves an EMPTY source registry and no freshness or
 * mapping route, so `integration.spec.ts`, `responsive.spec.ts`, and
 * `desktopNavigation.spec.ts` all keep exercising the genuine empty/unavailable
 * paths. Nothing here changes that: `mockBackend` is installed first and these
 * overrides are registered afterwards, so they apply ONLY to the Phase 6 specs.
 *
 * Not a spec file (no `.spec.`/`.test.` suffix), so Playwright never runs it.
 */

const SYNTHETIC = "분석용 합성 픽스처 — 공식 자료 아님";

/**
 * Eleven records: six subject areas, four cadences, two unknown ids (covering the
 * untranslated fallback, the absent-link branch, and the invalid-link branch), and
 * every seeded row present. Enough breadth that search and both filters are
 * meaningful, and no real agency is depicted as lacking or malforming a link.
 */
export const SYNTHETIC_SOURCES = [
  {
    source_id: "sgis",
    source_name: `Statistics Korea SGIS (${SYNTHETIC})`,
    dataset_name: `Population statistics and administrative boundaries (${SYNTHETIC})`,
    endpoint: "https://sgisapi.kostat.go.kr/OpenAPI3",
    publication_frequency: "MONTHLY",
    enabled: true,
    documentation_url: "https://sgis.kostat.go.kr/developer/html/openApi/api/data.html",
  },
  {
    source_id: "mois_resident_population",
    source_name: `행정안전부 주민등록 인구통계 (${SYNTHETIC})`,
    dataset_name: `행정동별 주민등록 인구 및 세대현황 (${SYNTHETIC})`,
    endpoint: "https://jumin.mois.go.kr/downloadCsv.do",
    publication_frequency: "MONTHLY",
    enabled: true,
    documentation_url: "https://jumin.mois.go.kr/statMonth.do",
  },
  {
    source_id: "waste_statistics",
    source_name: `Korea Environment Corporation Resource Circulation Information System (${SYNTHETIC})`,
    dataset_name: `전국폐기물발생및처리현황 (waste statistics OpenAPI) (${SYNTHETIC})`,
    endpoint: "https://www.recycling-info.or.kr/sds/JsonApi.do",
    publication_frequency: "ANNUAL",
    enabled: true,
    documentation_url: "https://www.recycling-info.or.kr/rrs/viewPage.do?menuNo=M130401",
  },
  {
    source_id: "15064381",
    source_name: `수도권매립지관리공사 (${SYNTHETIC})`,
    dataset_name: `통합반입관리_수도권폐기물 반입량 (${SYNTHETIC})`,
    endpoint: "https://api.odcloud.kr/api/15064381/v1",
    publication_frequency: "MONTHLY",
    enabled: true,
    documentation_url: "https://www.data.go.kr/data/15064381/fileData.do",
  },
  {
    source_id: "15064394",
    source_name: `수도권매립지관리공사 (${SYNTHETIC})`,
    dataset_name: `통합반입관리_폐기물반입수수료 (${SYNTHETIC})`,
    endpoint: "https://api.odcloud.kr/api/15064394/v1",
    publication_frequency: "MONTHLY",
    enabled: true,
    documentation_url: "https://www.data.go.kr/data/15064394/fileData.do",
  },
  {
    source_id: "vworld",
    source_name: `VWorld National Spatial Data Infrastructure (${SYNTHETIC})`,
    dataset_name: `Cadastral, zoning, and structural spatial layers (${SYNTHETIC})`,
    endpoint: "https://api.vworld.kr/req/data",
    publication_frequency: "STRUCTURAL",
    enabled: true,
    documentation_url: "https://www.vworld.kr/dev/v4dv_2ddataguide2_s002.do?svcIde=cadastral",
  },
  {
    source_id: "kma",
    source_name: `Korea Meteorological Administration (${SYNTHETIC})`,
    dataset_name: `Ultra-short-term observations and short-term forecasts (${SYNTHETIC})`,
    endpoint: "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0",
    publication_frequency: "REAL_TIME",
    enabled: true,
    // The REAL seeded value (alembic 0001). The fixture must not contradict the
    // registry in a field a reader could check against data.go.kr.
    documentation_url: "https://www.data.go.kr/data/15084084/openapi.do",
  },
  {
    source_id: "airkorea",
    source_name: `Korea Environment Corporation AirKorea (${SYNTHETIC})`,
    dataset_name: `Real-time air-quality observations and stations (${SYNTHETIC})`,
    endpoint: "http://apis.data.go.kr/B552584/ArpltnInforInqireSvc",
    publication_frequency: "REAL_TIME",
    enabled: true,
    // The REAL seeded value (alembic 0001).
    documentation_url: "https://www.data.go.kr/data/15073861/openapi.do",
  },
  {
    source_id: "vworld_structural",
    source_name: `VWorld National Spatial Data Infrastructure (structural layers) (${SYNTHETIC})`,
    dataset_name: `용도지역지구도 및 구조적 공간레이어 (${SYNTHETIC})`,
    endpoint: "https://www.vworld.kr/dtmk/dtmk_ntads_s001.do",
    publication_frequency: "STRUCTURAL",
    enabled: true,
    documentation_url: "https://www.vworld.kr/dtmk/dtmk_ntads_s001.do",
  },
  {
    // Unknown id: exercises the untranslated fallback (so the marker IS visible on
    // this card), the long-identifier wrap, and the ABSENT-link branch.
    source_id: "synthetic_unknown_source_with_a_long_identifier",
    source_name: `Synthetic Unknown Agency (${SYNTHETIC})`,
    dataset_name: `Synthetic Unknown Dataset (${SYNTHETIC})`,
    endpoint: "https://example.invalid/synthetic",
    publication_frequency: "WEEKLY",
    enabled: false,
    // No served documentation URL — the UI must say so, never construct one.
    documentation_url: null,
  },
  {
    // Second unknown id, covering the INVALID-link branch. Kept on a synthetic id so
    // no real agency is depicted as having a malformed registry entry.
    source_id: "synthetic_unknown_source_with_a_bad_link",
    source_name: `Synthetic Malformed-Link Agency (${SYNTHETIC})`,
    dataset_name: `Synthetic Malformed-Link Dataset (${SYNTHETIC})`,
    endpoint: "https://example.invalid/synthetic-bad-link",
    publication_frequency: "WEEKLY",
    enabled: true,
    // Not an absolute http(s) URL — must not be repaired into a link.
    documentation_url: "example.invalid/not-absolute",
  },
];

/** Freshness for four of the nine, so "served" vs "not served" both render. */
export const SYNTHETIC_FRESHNESS = [
  {
    source_id: "sgis",
    source_name: `Statistics Korea SGIS (${SYNTHETIC})`,
    publication_frequency: "MONTHLY",
    latest_reference_period: "2024",
    last_checked_at: null,
    last_changed_at: null,
    last_success_at: "2026-07-15T09:00:00+00:00",
    next_scheduled_at: null,
    freshness_status: "FRESH",
  },
  {
    source_id: "mois_resident_population",
    source_name: `행정안전부 주민등록 인구통계 (${SYNTHETIC})`,
    publication_frequency: "MONTHLY",
    latest_reference_period: "2026-06",
    last_checked_at: null,
    last_changed_at: null,
    last_success_at: "2026-07-15T09:00:00+00:00",
    next_scheduled_at: null,
    freshness_status: "FRESH",
  },
  {
    source_id: "waste_statistics",
    source_name: `Korea Environment Corporation RCIS (${SYNTHETIC})`,
    publication_frequency: "ANNUAL",
    latest_reference_period: "2022",
    last_checked_at: null,
    last_changed_at: null,
    last_success_at: null,
    next_scheduled_at: null,
    freshness_status: "UNKNOWN",
  },
  {
    source_id: "15064381",
    source_name: `수도권매립지관리공사 (${SYNTHETIC})`,
    publication_frequency: "MONTHLY",
    latest_reference_period: "2026-05",
    last_checked_at: null,
    last_changed_at: null,
    last_success_at: "2026-06-01T00:30:00+00:00",
    next_scheduled_at: null,
    freshness_status: "FRESH",
  },
];

/**
 * Facility mapping transparency. `without_address: 0` is deliberate: it is the
 * OFFICIAL-ZERO case the specs assert stays a rendered `0` rather than becoming
 * "자료 없음".
 */
export const SYNTHETIC_MAPPING = {
  reference_year: 2024,
  reference_period: "2024",
  total: 120,
  with_map_location: 90,
  without_map_location: 30,
  without_address: 0,
  category_breakdown: [
    {
      category: "PUBLIC_INCINERATION",
      total: 40,
      with_map_location: 35,
      without_map_location: 5,
    },
    {
      category: "PUBLIC_LANDFILL",
      total: 80,
      with_map_location: 55,
      without_map_location: 25,
    },
  ],
  ownership_breakdown: [{ ownership: "PUBLIC", total: 120 }],
  region_mapping_breakdown: [{ region_mapping_status: "UNMATCHED", total: 30 }],
  source_breakdown: [
    {
      source_id: "waste_statistics",
      official_dataset_name: `시설현황 (${SYNTHETIC})`,
      total: 120,
    },
  ],
  // The backend serves `unmapped.total === without_map_location` (30), which is
  // greater than the component's page size of 25 — so the pagination branch is
  // reachable and can be exercised. Only the first page's rows are listed.
  unmapped: {
    page: 1,
    page_size: 25,
    total: 30,
    items: [
      {
        id: 1,
        facility_name: `가나 소각장 (${SYNTHETIC})`,
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
        facility_name: `다라 매립장 (${SYNTHETIC})`,
        facility_category: "PUBLIC_LANDFILL",
        ownership: "PUBLIC",
        rcis_sido_name: "인천광역시",
        rcis_sigungu_name: "옹진군",
        region_code: null,
        region_name: null,
        region_mapping_status: "UNMATCHED",
        geocode_status: null,
        // No recorded reason → the UI must show 실패 사유 기록 없음, never invent one.
        missing_location_reason: null,
      },
    ],
  },
  disclaimer: `지도 위치가 없는 시설은 주소를 좌표로 변환하지 못한 경우입니다. (${SYNTHETIC})`,
};

const SOURCES_PATH = "/api/v1/data-sources";
const FRESHNESS_PATH = "/api/v1/data-freshness";
const MAPPING_PATH = "/api/v1/facilities/mapping-transparency";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/**
 * Register transparency overrides on top of the shared mock.
 *
 * `overrides` selects the state under test; anything not overridden serves the
 * populated fixture. The routes are added AFTER `mockBackend`, so Playwright's
 * last-registered-wins ordering gives them precedence for these three paths only.
 */
async function installTransparency(
  page: Page,
  overrides: {
    sources?: unknown;
    freshness?: unknown;
    mapping?: unknown;
    mappingStatus?: number;
    freshnessStatus?: number;
  } = {},
): Promise<void> {
  await mockBackend(page);
  await page.route(`**${SOURCES_PATH}**`, (route) =>
    json(route, overrides.sources ?? SYNTHETIC_SOURCES),
  );
  await page.route(`**${FRESHNESS_PATH}**`, (route) =>
    overrides.freshnessStatus
      ? json(route, { detail: "unavailable" }, overrides.freshnessStatus)
      : json(route, overrides.freshness ?? SYNTHETIC_FRESHNESS),
  );
  await page.route(`**${MAPPING_PATH}**`, (route) =>
    overrides.mappingStatus
      ? json(route, { detail: "unavailable" }, overrides.mappingStatus)
      : json(route, overrides.mapping ?? SYNTHETIC_MAPPING),
  );
}

/** The populated catalog — the default state for most Phase 6 assertions. */
export async function mockTransparencyBackend(page: Page): Promise<void> {
  await installTransparency(page);
}

/** The registry answered successfully with no records. Not an error. */
export async function mockTransparencyNoSources(page: Page): Promise<void> {
  await installTransparency(page, { sources: [] });
}

/** A genuine server failure on the mapping endpoint — the one alert on this page. */
export async function mockTransparencyMappingError(page: Page): Promise<void> {
  await installTransparency(page, { mappingStatus: 500 });
}

/** A failed freshness request — reference periods are unknown, not absent. */
export async function mockTransparencyFreshnessError(page: Page): Promise<void> {
  await installTransparency(page, { freshnessStatus: 500 });
}

/**
 * Hold the mapping response open so the loading state can be observed.
 * The returned function releases it.
 */
export async function mockTransparencySlowMapping(page: Page): Promise<void> {
  await mockBackend(page);
  await page.route(`**${SOURCES_PATH}**`, (route) => json(route, SYNTHETIC_SOURCES));
  await page.route(`**${FRESHNESS_PATH}**`, (route) => json(route, SYNTHETIC_FRESHNESS));
  // Never fulfilled: the mapping panel stays in its loading state for the whole test.
  await page.route(`**${MAPPING_PATH}**`, () => {});
}
