import { expect, test } from "@playwright/test";

/**
 * Live smoke test for the capital-region Sudokwon Landfill dashboard against the
 * real backend (E2E_BACKEND_URL).
 *
 * Verifies that 수도권매립지 mode renders a full-width, filter-driven dashboard
 * with NO map (the source declares metropolitan totals only — no municipal route
 * exists to draw), that the four filters and four KPI cards drive real official
 * values, that the per-capita fee either shows a value or an explicit unavailable
 * reason, that Equity/Suitability still render their maps, and that no request
 * ever leaves for a Korean government API host.
 */

const backendUrl = process.env.E2E_BACKEND_URL;

test.skip(!backendUrl, "E2E_BACKEND_URL is not configured (live smoke only)");

const ALLOWED_HOST_SUFFIXES = ["localhost", "127.0.0.1", "tile.openstreetmap.org"];
// The population source must be reached only by the backend ingestion, never by
// the browser. Listed explicitly so a regression names the culprit.
const FORBIDDEN_HOSTS = ["jumin.mois.go.kr", "mois.go.kr", "data.go.kr", "odcloud.kr"];

/** Attach the external-request guard. Unchanged in strictness from the map-era spec. */
function guardExternalRequests(page: import("@playwright/test").Page): string[] {
  const disallowedRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "blob:" || url.protocol === "data:") return;
    const host = url.hostname;
    if (FORBIDDEN_HOSTS.some((banned) => host === banned || host.endsWith(`.${banned}`))) {
      disallowedRequests.push(`GOVERNMENT_API:${request.url()}`);
      return;
    }
    if (!ALLOWED_HOST_SUFFIXES.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      disallowedRequests.push(request.url());
    }
  });
  return disallowedRequests;
}

async function openLandfillDashboard(page: import("@playwright/test").Page) {
  await page.goto("/");
  // The app boots in equity mode with a map.
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("mode-flow").click();
  await expect(page.getByTestId("landfill-dashboard")).toBeVisible({ timeout: 20_000 });
}

test("landfill dashboard: renders full-width with no map and official values", async ({ page }) => {
  const disallowedRequests = guardExternalRequests(page);
  await openLandfillDashboard(page);

  // The schematic flow map is gone in this mode — not merely hidden.
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
  await expect(page.getByTestId("map-container")).toHaveCount(0);

  // Heading + the mandated limitation notice.
  await expect(page.getByRole("heading", { name: "수도권매립지 반입 현황" })).toBeVisible();
  await expect(page.getByTestId("landfill-limitation")).toContainText(
    "시·군·구별 이동 경로나 실제 운송 경로를 의미하지 않습니다",
  );
  // The official fee caveat is retained.
  await expect(page.getByTestId("landfill-fee-caveat")).toContainText("순수 운송비");

  // Four filters.
  await expect(page.getByTestId("landfill-year-select")).toBeVisible();
  await expect(page.getByTestId("landfill-month-select")).toBeVisible();
  await expect(page.getByTestId("landfill-origin-select")).toBeVisible();
  await expect(page.getByTestId("landfill-waste-select")).toBeVisible();

  // Four primary KPI cards.
  await expect(page.getByTestId("landfill-kpis")).toBeVisible();
  await expect(page.getByTestId("landfill-kpi-quantity")).toContainText("t");
  await expect(page.getByTestId("landfill-kpi-fee")).toContainText("억원");
  await expect(page.getByTestId("landfill-kpi-effective-fee")).toContainText("원/t");
  const perCapitaKpi = page.getByTestId("landfill-kpi-per-capita");
  await expect(perCapitaKpi).toContainText("주민 1인당 환산 반입수수료");
  // Either a served value or an explicit unavailable reason — never a bare 0원.
  await expect(perCapitaKpi).toContainText(/원\/인|데이터 없음|확인 필요|계산 불가/);
  await expect(perCapitaKpi).toContainText("개인의 실제 납부액이 아닙니다");

  // Charts.
  await expect(page.getByTestId("landfill-trend-quantity")).toBeVisible();
  await expect(page.getByTestId("landfill-trend-fee")).toBeVisible();
  await expect(page.getByTestId("landfill-origin-comparison")).toBeVisible();
  await expect(page.getByTestId("landfill-waste-composition")).toBeVisible();

  // Evidence: official vs derived, with source snapshot dates.
  const evidence = page.getByTestId("landfill-evidence");
  await expect(evidence).toContainText("OFFICIAL_REPORTED_VALUE");
  await expect(evidence).toContainText("OFFICIAL_INPUTS_DERIVED_VALUE");
  await expect(evidence).toContainText("VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW");
  await expect(page.getByTestId("reference-period").first()).not.toBeEmpty();

  // The obsolete schematic flow list is gone.
  await expect(page.getByTestId("flow-list")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("서울시 ▶ 수도권매립지");
  await expect(page.locator("body")).not.toContainText("직선은 개략적 이동 방향");

  expect(disallowedRequests).toEqual([]);
});

test("landfill dashboard: four-column regional table narrows with the origin filter", async ({
  page,
}) => {
  await openLandfillDashboard(page);

  // All origins -> the three metropolitan rows, exactly four columns.
  const table = page.getByTestId("landfill-region-table");
  await expect(table).toBeVisible();
  await expect(table.locator("thead th")).toHaveCount(4);
  await expect(table.locator("thead th").nth(0)).toHaveText("지역");
  await expect(table.locator("thead th").nth(3)).toHaveText("주민 1인당 환산 반입수수료");

  const rows = page.getByTestId("landfill-region-row");
  await expect(rows).toHaveCount(3);
  await expect(table).toContainText("서울시");
  await expect(table).toContainText("인천시");
  await expect(table).toContainText("경기도");

  // Selecting Seoul leaves exactly one row.
  await page.getByTestId("landfill-origin-select").selectOption("11");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("서울시");
  await expect(table).not.toContainText("인천시");
});

test("landfill dashboard: year / month / waste filters change the served values", async ({
  page,
}) => {
  await openLandfillDashboard(page);
  const quantity = page.getByTestId("landfill-kpi-quantity");
  const annualText = await quantity.textContent();

  // Pick a concrete year (skipping the default "latest complete" option).
  const yearSelect = page.getByTestId("landfill-year-select");
  const years = await yearSelect.locator("option").allInnerTexts();
  const concreteYear = years.find((label) => /^\d{4}$/.test(label.trim()));
  expect(concreteYear).toBeTruthy();
  await yearSelect.selectOption(concreteYear!.trim());
  await expect(page.getByTestId("landfill-dashboard")).toContainText(`${concreteYear!.trim()}년`);

  // A single month must report less than the whole year.
  await page.getByTestId("landfill-month-select").selectOption("1");
  await expect(page.getByTestId("landfill-dashboard")).toContainText("1월");
  await expect(quantity).not.toHaveText(annualText ?? "");

  // A waste-type filter narrows the fee numerator too.
  await page.getByTestId("landfill-month-select").selectOption("");
  const wasteSelect = page.getByTestId("landfill-waste-select");
  const wasteOptions = await wasteSelect.locator("option").allInnerTexts();
  const concreteWaste = wasteOptions.find((label) => !label.includes("전체"));
  if (concreteWaste) {
    await wasteSelect.selectOption(concreteWaste.trim());
    await expect(quantity).not.toHaveText(annualText ?? "");
  }
});

test("landfill dashboard: year options include landfill years from 2008 onward", async ({
  page,
}) => {
  await openLandfillDashboard(page);
  const years = (await page.getByTestId("landfill-year-select").locator("option").allInnerTexts())
    .map((t) => t.trim())
    .filter((t) => /^\d{4}$/.test(t));
  expect(years).toContain("2008");
  expect(years).toContain("2024");
  expect(years).toContain("2025");
  expect(years).toContain("2026");
});

async function selectYear(page: import("@playwright/test").Page, year: string) {
  await page.getByTestId("landfill-year-select").selectOption(year);
  await expect(page.getByTestId("landfill-dashboard")).toContainText(`${year}년`);
}

test("landfill dashboard: complete years are denominated by that year's December", async ({
  page,
}) => {
  await openLandfillDashboard(page);
  // 2008 / 2024 / 2025 are complete landfill years -> December month-end MOIS.
  for (const year of ["2008", "2024", "2025"]) {
    await selectYear(page, year);
    await expect(page.getByTestId("landfill-per-capita-periods")).toBeVisible();
    await expect(page.getByTestId("landfill-population-month")).toHaveText(`${year}-12`);
    await expect(page.getByTestId("landfill-kpi-per-capita")).toContainText("원/인");
    // Never zero-filled.
    await expect(page.getByTestId("landfill-kpi-per-capita")).not.toContainText("0원/인");
  }
});

test("landfill dashboard: the partial 2026 year uses its final landfill month", async ({
  page,
}) => {
  await openLandfillDashboard(page);
  await selectYear(page, "2026");
  await expect(page.getByTestId("landfill-per-capita-periods")).toBeVisible();
  const month = await page.getByTestId("landfill-population-month").textContent();
  // The denominator month must be the last month IN the 2026 fee numerator, and
  // must never post-date it even though MOIS publishes a later month.
  expect(month).toMatch(/^2026-\d{2}$/);
  const partial = page.getByTestId("landfill-partial-year");
  if ((await partial.count()) > 0) {
    const through = (await partial.textContent()) ?? "";
    expect(through).toContain(month!.trim());
  }
});

test("landfill dashboard: a monthly selection uses that exact population month", async ({
  page,
}) => {
  await openLandfillDashboard(page);
  await selectYear(page, "2024");
  await expect(page.getByTestId("landfill-population-month")).toHaveText("2024-12");
  await page.getByTestId("landfill-month-select").selectOption("7");
  await expect(page.getByTestId("landfill-dashboard")).toContainText("7월");
  // Selecting a month changes the population reference month to that exact month.
  await expect(page.getByTestId("landfill-population-month")).toHaveText("2024-07");
  await expect(page.getByTestId("landfill-per-capita-periods")).toContainText("수수료 기준 2024-07");
});

test("landfill dashboard: shows the MOIS source, v2 version and comparability notice", async ({
  page,
}) => {
  await openLandfillDashboard(page);
  await selectYear(page, "2024");
  const source = page.getByTestId("landfill-population-source");
  await expect(source).toContainText("행정안전부 주민등록 인구통계");
  await expect(source).toContainText("mois_resident_population");
  await expect(source).toContainText("월간");
  // No SGIS fallback is ever used as the landfill denominator.
  await expect(source).not.toContainText("SGIS_TOTAL_POPULATION");
  await expect(page.getByTestId("landfill-derivation-version")).toHaveText(
    "landfill-fee-per-capita-v2",
  );
  const note = page.getByTestId("landfill-comparability-note");
  await expect(note).toContainText("2010-10");
  await expect(note).toContainText("2015-01");
  await expect(note).toContainText("외국인");
  // The value never implies an actual resident payment.
  await expect(page.getByTestId("landfill-kpi-per-capita")).toContainText(
    "개인의 실제 납부액이 아닙니다",
  );
});

test("landfill dashboard: usable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLandfillDashboard(page);
  await expect(page.getByTestId("landfill-filters")).toBeVisible();
  await page.getByTestId("landfill-kpis").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("landfill-kpi-quantity")).toBeVisible();
  // The regional table stays reachable via horizontal scroll, and the page body
  // itself must not scroll sideways.
  await page.getByTestId("landfill-region-table").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("landfill-region-table")).toBeVisible();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
});

test("landfill dashboard: switching back restores the Equity and Suitability maps", async ({
  page,
}) => {
  const disallowedRequests = guardExternalRequests(page);
  await openLandfillDashboard(page);
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);

  // Equity map returns.
  await page.getByTestId("mode-equity").click();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });

  // Suitability map renders too.
  await page.getByTestId("mode-suitability").click();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });

  expect(disallowedRequests).toEqual([]);
});
