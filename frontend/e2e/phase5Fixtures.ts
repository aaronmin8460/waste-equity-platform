import type { Page, Route } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Populated landfill fixtures for the Phase 5 specs.
 *
 * ── THESE ARE NOT OFFICIAL DATA ─────────────────────────────────────────────────
 * Every number below is a SYNTHETIC LAYOUT FIXTURE invented for this spec. None of
 * it comes from 수도권매립지관리공사, 행정안전부, or any public dataset, and none of
 * it may be quoted as a real inbound quantity, fee, or population. The specs assert
 * STRUCTURE and BEHAVIOUR — hierarchy, state separation, overflow, keyboard order —
 * and never assert that a value is correct.
 *
 * To make that unmistakable at runtime as well as in review, every free-text field
 * the UI actually renders says so: the dataset names and the served `caveats` both
 * carry `분석용 합성 픽스처 — 공식 자료 아님`. This follows the Phase 4 precedent in
 * `phase4Fixtures.ts`, which put the same marker in `derivation_formula` /
 * `assumptions` rather than passing synthetic numbers off as official values.
 *
 * ── Why this file exists rather than a change to `mockBackend.ts` ───────────────
 * The shared mock deliberately serves the backend's genuine 404 `NO_DATA_AVAILABLE`
 * for all three landfill endpoints, because a zeros-filled "official" summary would
 * render fabricated quantities under `OFFICIAL_REPORTED_VALUE` labels — which the
 * repo-root AGENTS.md forbids. The redesign plan (§12 O3) states that 404 is
 * deliberate and must not be replaced to make the live spec run offline.
 *
 * Nothing here touches that. `mockBackend` is installed first and keeps its 404;
 * these overrides are registered afterwards and apply ONLY to the Phase 5 specs, so
 * `landfill.spec.ts` (live-only), `integration.spec.ts`, and `responsive.spec.ts`
 * all still exercise the real no-data path. `mockLandfillNoData` re-exposes that
 * path explicitly for the Phase 5 no-data case.
 *
 * Not a spec file (no `.spec.`/`.test.` suffix), so Playwright never runs it.
 */

const SYNTHETIC = "분석용 합성 픽스처 — 공식 자료 아님";

const CAVEATS = [
  `${SYNTHETIC}. 화면 배치 확인용이며 공식 반입 자료가 아닙니다.`,
  "수도권매립지관리공사가 서울시·경기도·인천시 단위로 보고한 반입 자료입니다. 시·군·구별 반입량을 의미하지 않습니다.",
  "광역지자체 단위 자료이며 시·군·구별 이동 경로나 실제 운송 경로를 의미하지 않습니다.",
  "반입수수료는 공식 보고된 금액이며 순수 운송비 또는 전체 폐기물 관리비가 아닙니다.",
];

const PER_CAPITA_CAVEAT =
  "선택 기간의 공식 반입수수료를 동일 기간 기준의 해당 지역 인구로 나눈 분석용 환산값입니다. " +
  "개인의 실제 납부액이 아닙니다.";

const EVIDENCE = {
  quantity_status: "OFFICIAL_REPORTED_VALUE",
  fee_status: "OFFICIAL_REPORTED_VALUE",
  derived_status: "OFFICIAL_INPUTS_DERIVED_VALUE",
  notes: [],
};

const SOURCES = [
  {
    dataset_id: "15064381",
    official_dataset_name: `반입량 (${SYNTHETIC})`,
    snapshot_uuid: "synthetic-q",
    snapshot_date: "2026-05-31",
  },
  {
    dataset_id: "15064394",
    official_dataset_name: `반입수수료 (${SYNTHETIC})`,
    snapshot_uuid: "synthetic-f",
    snapshot_date: "2026-05-31",
  },
];

/** A complete-year period. `available_years` mirrors what a real backend serves. */
function period(overrides: Record<string, unknown> = {}) {
  return {
    year: 2024,
    month: null,
    is_complete_year: true,
    available_through_month: "2024-12",
    latest_available_month: "2026-05",
    available_years: [2022, 2023, 2024, 2025, 2026],
    ...overrides,
  };
}

function feePerCapita(overrides: Record<string, unknown> = {}) {
  return {
    indicator: "LANDFILL_INBOUND_FEE_PER_CAPITA",
    fee_per_capita_krw: "4153.03",
    unit: "KRW/인",
    derivation_version: "landfill-fee-per-capita-v2",
    derivation_formula: "inbound_fee_krw ÷ population",
    evidence_status: "OFFICIAL_INPUTS_DERIVED_VALUE",
    inbound_fee_krw: "108176043070.00",
    fee_reference_year: 2024,
    fee_reference_period: "2024",
    fee_period_complete: true,
    required_population_month: "2024-12",
    population: 26047159,
    population_reference_month: "2024-12",
    population_reference_year: 2024,
    population_reference_period: "2024-12",
    population_temporal_granularity: "MONTHLY",
    population_definition: "MOIS_RESIDENT_REGISTRATION_TOTAL",
    population_definition_version: "MOIS_TOTAL_WITH_UNREGISTERED_RESIDENT_AND_OVERSEAS_NATIONALS",
    population_comparability_note: `${SYNTHETIC}.`,
    population_source_id: "mois_resident_population",
    population_source_dataset_id: "mois_resident_population",
    population_source_administrative_code: "1100000000",
    population_region_level: "SIDO",
    population_unit: "persons",
    included_origin_region_codes: ["KR-SGIS-11", "KR-SGIS-28", "KR-SGIS-41"],
    unavailable_reason: null,
    interpretation_caveat: PER_CAPITA_CAVEAT,
    caveat: PER_CAPITA_CAVEAT,
    ...overrides,
  };
}

/**
 * Three metropolitan origins with DELIBERATELY UNEQUAL quantities, so the
 * comparison bars have distinguishable widths to assert against. The third row
 * carries an unavailable per-capita value, which must render its reason and never
 * a `0원` — the invariant the bars must not quietly break.
 */
const ORIGIN_SHARES = [
  {
    origin_region_code: "KR-SGIS-11",
    origin_sgis_code: "11",
    origin_name: "서울시",
    origin_name_en: "Seoul",
    quantity_kg: "600000000",
    quantity_tons: "600000.000000",
    inbound_fee_krw: "60000000000.00",
    quantity_share: "0.545",
    effective_fee_per_ton: "100000.00",
    fee_per_capita: feePerCapita({
      fee_per_capita_krw: "6400.00",
      population: 9375000,
      included_origin_region_codes: ["KR-SGIS-11"],
    }),
  },
  {
    origin_region_code: "KR-SGIS-28",
    origin_sgis_code: "28",
    origin_name: "인천시",
    origin_name_en: "Incheon",
    quantity_kg: "300000000",
    quantity_tons: "300000.000000",
    inbound_fee_krw: "30000000000.00",
    quantity_share: "0.273",
    effective_fee_per_ton: "100000.00",
    fee_per_capita: feePerCapita({
      fee_per_capita_krw: "10100.00",
      population: 2970000,
      included_origin_region_codes: ["KR-SGIS-28"],
    }),
  },
  {
    origin_region_code: "KR-SGIS-41",
    origin_sgis_code: "41",
    origin_name: "경기도",
    origin_name_en: "Gyeonggi",
    quantity_kg: "200000000",
    quantity_tons: "200000.000000",
    inbound_fee_krw: "20000000000.00",
    quantity_share: "0.182",
    effective_fee_per_ton: "100000.00",
    // An absent denominator — must show its served reason, never 0원.
    fee_per_capita: feePerCapita({
      fee_per_capita_krw: null,
      population: null,
      population_reference_month: null,
      population_reference_period: null,
      unavailable_reason: "NO_MATCHING_POPULATION_PERIOD",
      required_population_month: "2024-12",
      included_origin_region_codes: ["KR-SGIS-41"],
    }),
  },
];

const WASTE_TYPES = [
  {
    waste_name: "생활폐기물",
    quantity_kg: "700000000",
    quantity_tons: "700000.000000",
    inbound_fee_krw: "70000000000.00",
    quantity_share: "0.636",
    effective_fee_per_ton: "100000.00",
  },
  {
    waste_name: "건설폐기물",
    quantity_kg: "250000000",
    quantity_tons: "250000.000000",
    inbound_fee_krw: "25000000000.00",
    quantity_share: "0.227",
    effective_fee_per_ton: "100000.00",
  },
  {
    waste_name: "사업장폐기물",
    quantity_kg: "150000000",
    quantity_tons: "150000.000000",
    inbound_fee_krw: "15000000000.00",
    quantity_share: "0.136",
    effective_fee_per_ton: "100000.00",
  },
];

/**
 * A partial year: only five months are served. The trend must therefore draw FIVE
 * bars — the unserved months stay absent rather than becoming zero bars.
 */
const PARTIAL_MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];

/** `factor` scales every month to the origin/waste scope the request asked for. */
function trendPoints(months: string[], factor = 1) {
  return months.map((month, index) => ({
    reference_month: month,
    reference_year: Number(month.slice(0, 4)),
    quantity_kg: ((80000000 + index * 5000000) * factor).toFixed(0),
    quantity_tons: ((80000.5 + index * 5000) * factor).toFixed(6),
    inbound_fee_krw: ((8000000000.25 + index * 500000000) * factor).toFixed(2),
    effective_fee_per_ton: "100000.00",
  }));
}

const FULL_YEAR_MONTHS = Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, "0")}`);

function summaryBody(overrides: Record<string, unknown> = {}) {
  return {
    period: period(),
    origin_filter: null,
    waste_filter: null,
    accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
    destination_code: "SUDOKWON_LANDFILL",
    destination_name: "수도권매립지",
    total_quantity_kg: "1100000000",
    total_quantity_tons: "1100000.000000",
    total_inbound_fee_krw: "110000000000.00",
    effective_fee_per_ton: "100000.00",
    fee_per_capita: feePerCapita(),
    largest_origin_share: null,
    largest_waste_share: null,
    origin_shares: ORIGIN_SHARES,
    top_waste_types: WASTE_TYPES,
    row_count: 3,
    evidence: EVIDENCE,
    sources: SOURCES,
    derivation_version: "landfill-effective-fee-v1",
    caveats: CAVEATS,
    ...overrides,
  };
}

function trendsBody(months: string[], factor = 1) {
  return {
    start_month: months[0],
    end_month: months[months.length - 1],
    origin_filter: null,
    waste_filter: null,
    accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
    points: trendPoints(months, factor),
    evidence: EVIDENCE,
    sources: SOURCES,
    derivation_version: "landfill-effective-fee-v1",
    caveats: CAVEATS,
  };
}

/**
 * Scoped by year + origin only — NOT by the waste filter, so the dropdown it
 * populates never narrows itself out of the other categories (the real endpoint has
 * the same deliberate scope; see the request-scoping note in page.tsx).
 */
function compositionBody(origin: string | null) {
  const scoped = scopeFixture(origin, null);
  return {
    period: period(),
    origin_filter: origin,
    accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
    total_quantity_kg: scoped.totalKg,
    total_quantity_tons: scoped.totalTons,
    total_inbound_fee_krw: scoped.totalFee,
    waste_types: scoped.wastes,
    evidence: EVIDENCE,
    sources: SOURCES,
    derivation_version: "landfill-effective-fee-v1",
    caveats: CAVEATS,
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/**
 * Scope the fixture to a filter combination the way the real backend does.
 *
 * ── Why this is not just an array `filter` ──────────────────────────────────────
 * The origin rows and the waste rows are two cross-cuts of the SAME quantity, so
 * narrowing one dimension has to narrow the other's magnitudes too. Filtering the
 * lists independently produced screens that contradicted themselves: with
 * `origin=11` the sole Seoul row read "600,000 t · 54.5%" beside a KPI total of
 * 600,000 t (54.5% of a total it *is*), and adding `waste_name=생활폐기물` showed a
 * 700,000 t category against a 600,000 t total — a part larger than the whole.
 *
 * So each dimension is scaled by the other's retained fraction, which is what a
 * cross-tab does and what the backend's `WHERE` clause achieves in SQL. Shares are
 * then recomputed against the scoped total, and the summary's per-capita figure is
 * taken from the origins actually in scope (for a single origin the backend's
 * Σ fee ÷ Σ population reduces to exactly that origin's own value).
 *
 * Fixture arithmetic only. No assertion checks these numbers for correctness — they
 * exist so the rendered screen is internally coherent while layout is measured.
 */
function tons(row: { quantity_tons: string }): number {
  return Number(row.quantity_tons);
}

function totalTons(rows: { quantity_tons: string }[]): number {
  return rows.reduce((sum, row) => sum + tons(row), 0);
}

/** Scale every quantity/fee on a row by `factor`, keeping the decimal-string shape. */
function scaleRow<T extends { quantity_kg: string; quantity_tons: string; inbound_fee_krw: string }>(
  row: T,
  factor: number,
): T {
  if (factor === 1) return row;
  return {
    ...row,
    quantity_kg: (Number(row.quantity_kg) * factor).toFixed(0),
    quantity_tons: (Number(row.quantity_tons) * factor).toFixed(6),
    inbound_fee_krw: (Number(row.inbound_fee_krw) * factor).toFixed(2),
  };
}

interface ScopedFixture {
  // `quantity_share` widens to `string | null` because a scoped total of zero has no
  // meaningful share — and `null` is the shape the real API uses for that, never 0.
  origins: (Omit<(typeof ORIGIN_SHARES)[number], "quantity_share"> & {
    quantity_share: string | null;
  })[];
  wastes: (Omit<(typeof WASTE_TYPES)[number], "quantity_share"> & {
    quantity_share: string | null;
  })[];
  totalKg: string;
  totalTons: string;
  totalFee: string;
  feePerCapita: ReturnType<typeof feePerCapita>;
}

function scopeFixture(origin: string | null, wasteName: string | null): ScopedFixture {
  const originRows = origin
    ? ORIGIN_SHARES.filter((share) => share.origin_sgis_code === origin)
    : ORIGIN_SHARES;
  const wasteRows = wasteName
    ? WASTE_TYPES.filter((waste) => waste.waste_name === wasteName)
    : WASTE_TYPES;

  // Each dimension keeps the other's retained fraction of the whole.
  const originFraction = totalTons(originRows) / totalTons(ORIGIN_SHARES);
  const wasteFraction = totalTons(wasteRows) / totalTons(WASTE_TYPES);

  const scaledOrigins = originRows.map((row) => scaleRow(row, wasteFraction));
  const scaledWastes = wasteRows.map((row) => scaleRow(row, originFraction));
  const scopedTons = totalTons(scaledOrigins);

  // Shares are recomputed against the scoped total, so a single row reads 100%.
  const withShares = scaledOrigins.map((row) => ({
    ...row,
    quantity_share: scopedTons > 0 ? (tons(row) / scopedTons).toFixed(3) : null,
  }));
  const wastesWithShares = scaledWastes.map((row) => ({
    ...row,
    quantity_share: scopedTons > 0 ? (tons(row) / scopedTons).toFixed(3) : null,
  }));

  const totalKg = withShares.reduce((sum, row) => sum + Number(row.quantity_kg), 0);
  const totalFee = withShares.reduce((sum, row) => sum + Number(row.inbound_fee_krw), 0);
  const population = originRows.reduce(
    (sum, row) => sum + (row.fee_per_capita.population ?? 0),
    0,
  );
  // Σ fee ÷ Σ population over the origins in scope — never the mean of the rows.
  const anyUnavailable = originRows.some((row) => row.fee_per_capita.fee_per_capita_krw === null);

  return {
    origins: withShares,
    wastes: wastesWithShares,
    totalKg: totalKg.toFixed(0),
    totalTons: scopedTons.toFixed(6),
    totalFee: totalFee.toFixed(2),
    feePerCapita: feePerCapita({
      inbound_fee_krw: totalFee.toFixed(2),
      population: anyUnavailable || population === 0 ? null : population,
      fee_per_capita_krw:
        anyUnavailable || population === 0 ? null : (totalFee / population).toFixed(2),
      unavailable_reason:
        anyUnavailable || population === 0 ? "INCOMPLETE_POPULATION_COVERAGE" : null,
      included_origin_region_codes: originRows.map((row) => row.origin_region_code),
    }),
  };
}

/**
 * Install the base mock plus a POPULATED landfill dashboard.
 *
 * Selecting year 2026 switches the summary and trends to the partial-year shape, so
 * one spec can exercise both the complete and partial presentations through the
 * real filter control rather than a second fixture install.
 */
export async function mockLandfillBackend(page: Page): Promise<void> {
  await mockBackend(page);
  await page.route("**/api/v1/landfill/summary**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const partial = params.get("year") === "2026";
    // Honour `origin` and `waste_name` the way the real backend does. Without this
    // the fixture returned all three origins whatever was selected, so a spec could
    // "verify" the origin filter with an assertion that held before and after the
    // change — it would have passed with the select entirely inert.
    const scoped = scopeFixture(params.get("origin"), params.get("waste_name"));
    return json(
      route,
      summaryBody({
        origin_filter: params.get("origin"),
        waste_filter: params.get("waste_name"),
        origin_shares: scoped.origins,
        top_waste_types: scoped.wastes,
        row_count: scoped.origins.length,
        total_quantity_kg: scoped.totalKg,
        total_quantity_tons: scoped.totalTons,
        total_inbound_fee_krw: scoped.totalFee,
        fee_per_capita: scoped.feePerCapita,
        // The partial year re-dates the period and the per-capita reference months.
        // It spreads AFTER the scoped values but rebuilds `fee_per_capita` from the
        // scoped one, so re-dating never discards the origin/waste scoping.
        ...(partial
          ? {
              period: period({
                year: 2026,
                is_complete_year: false,
                available_through_month: "2026-05",
              }),
              fee_per_capita: {
                ...scoped.feePerCapita,
                fee_reference_year: 2026,
                fee_reference_period: "2026",
                fee_period_complete: false,
                required_population_month: "2026-05",
                population_reference_month: "2026-05",
                population_reference_period: "2026-05",
                population_reference_year: 2026,
              },
            }
          : {}),
      }),
    );
  });
  // Trends and composition are scoped too: the real backend narrows trends by
  // origin + waste (docs/CAPITAL_REGION_LANDFILL_FLOW_IMPLEMENTATION.md §5), and
  // composition by year + origin. Leaving them unscoped drew an all-origin monthly
  // series beside a single-origin KPI total.
  await page.route("**/api/v1/landfill/trends**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const partial = (params.get("start_month") ?? "").startsWith("2026");
    const scoped = scopeFixture(params.get("origin"), params.get("waste_name"));
    const factor = Number(scoped.totalTons) / totalTons(ORIGIN_SHARES);
    return json(route, trendsBody(partial ? PARTIAL_MONTHS : FULL_YEAR_MONTHS, factor));
  });
  await page.route("**/api/v1/landfill/composition**", (route) =>
    json(route, compositionBody(new URL(route.request().url()).searchParams.get("origin"))),
  );
}

/**
 * The backend's genuine "no official record" answer, with the year list it serves.
 * Not an error: the request succeeded and the backend reported what it holds.
 */
export async function mockLandfillNoData(page: Page): Promise<void> {
  await mockBackend(page);
  await page.route("**/api/v1/landfill/**", (route) =>
    json(
      route,
      {
        detail: {
          error: "NO_DATA_AVAILABLE",
          detail: "No landfill inbound data has been ingested.",
          requested_year: null,
          available_years: [2023, 2024],
        },
      },
      404,
    ),
  );
}

/** A genuine server failure — the only case that may render as an alert. */
export async function mockLandfillServerError(page: Page): Promise<void> {
  await mockBackend(page);
  await page.route("**/api/v1/landfill/**", (route) =>
    json(route, { detail: { error: "INTERNAL_ERROR", detail: "upstream failure" } }, 500),
  );
}
