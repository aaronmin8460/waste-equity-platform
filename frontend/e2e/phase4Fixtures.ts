import type { Page, Route } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Populated equity fixtures for the Phase 4 specs.
 *
 * The base `mockBackend` serves genuinely EMPTY map envelopes, which is correct for
 * layout-only assertions but leaves the ranking, comparison, and selected-region
 * surfaces with nothing to render. Phase 4 needs those populated to exercise the
 * selection flow, so this layers a small synthetic region set on top — registered
 * AFTER mockBackend, since Playwright matches the most recently registered route
 * first.
 *
 * Every value here is a SYNTHETIC LAYOUT FIXTURE, never real or official public
 * data. The specs assert structure, geometry, and behaviour — never these numbers.
 * Nothing is labelled with an official evidence marker, and no zero is substituted
 * for a missing value.
 *
 * Not a spec file (no `.spec.`/`.test.` suffix), so Playwright never runs it.
 */

export const REGIONS = [
  { code: "KR-SGIS-11110", name: "종로구", pop: 300000 },
  { code: "KR-SGIS-11140", name: "중구", pop: 100000 },
  { code: "KR-SGIS-11680", name: "강남구", pop: 561000 },
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
      parent_region_code: `KR-SGIS-${r.code.slice(8, 10)}`,
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

/**
 * Contract-complete EMPTY derived envelopes.
 *
 * The shared `mockBackend` serves the derived endpoints as a bare
 * `{...EMPTY_ENVELOPE, unit, excluded_regions}`, which omits the `indicator`,
 * `derivation_version`, `derivation_formula`, and `assumptions` fields the real
 * backend always returns (see `ReportingPerCapitaEnvelope` in src/lib/api.ts). No
 * existing spec selected a per-capita or facility-burden metric, so the gap was
 * never exercised; Phase 4 does select them, and the missing `assumptions` array
 * crashes the derivation panel. These overrides restore the full envelope SHAPE
 * while keeping the data genuinely empty — an empty collection is not fabricated
 * data and carries no official evidence label.
 */
const EMPTY_DERIVED = {
  reference_year: 2024,
  count: 0,
  items: [],
  excluded_regions: [],
  unit: "kg/인/년",
  derivation_formula: "분석용 합성 픽스처",
  assumptions: ["분석용 합성 픽스처 — 공식 값 아님"],
};

const PER_CAPITA = {
  ...EMPTY_DERIVED,
  indicator: "WASTE_GENERATION_PER_CAPITA",
  derivation_version: "waste-per-capita-v1",
};

const FACILITY_BURDEN = {
  ...EMPTY_DERIVED,
  indicator: "FACILITY_LOCATION_BASED_THROUGHPUT_PER_CAPITA",
  derivation_version: "facility-burden-v1",
  buffer_meters: 5000,
  facilities_without_coordinates: 0,
  facilities_without_region: 0,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Install the base mock plus the populated equity overrides. */
export async function mockEquityBackend(page: Page): Promise<void> {
  await mockBackend(page);
  await page.route("**/api/v1/regions/boundaries**", (r) => json(r, BOUNDARIES));
  await page.route("**/api/v1/population**", (r) => json(r, POPULATION));
  await page.route("**/api/v1/equity/waste-per-capita**", (r) => json(r, PER_CAPITA));
  await page.route("**/api/v1/waste-reporting/per-capita**", (r) => json(r, PER_CAPITA));
  await page.route("**/api/v1/equity/facility-burden**", (r) => json(r, FACILITY_BURDEN));
}
