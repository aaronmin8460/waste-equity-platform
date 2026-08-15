/**
 * PRODUCTION-SAFE public release smoke QA (Phase 1B-LC8).
 *
 * Verifies, from OUTSIDE the server, that the deployed public origin serves the
 * complete LC3–LC6 land-cover feature set together with its authorization disclosure
 * and mandatory source attribution, and that no raw source surface is reachable.
 *
 * Read-only by construction: navigation, clicks, and GETs only. It never writes,
 * never posts, and never intercepts or rewrites a response — the failure-injection
 * specs stay local (`landCoverIntegratedQa.spec.ts`) and are never pointed at
 * production.
 *
 * Following the repo's live-spec convention, this SKIPS ITSELF unless
 * `PUBLIC_BASE_URL` names the deployed origin, so no default run ever touches a
 * public server:
 *
 *   PUBLIC_BASE_URL=https://<host> npx playwright test e2e/publicRelease.spec.ts
 *
 * Playwright-managed Chromium is not installed in this environment, so it runs on
 * the installed Chrome channel.
 */

import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.PUBLIC_BASE_URL ?? "";

test.skip(!BASE, "PUBLIC_BASE_URL is not configured (public release verification only)");

const SUITABILITY = `${BASE}/?v=1&mode=suitability&view=score`;
const LC = "/api/v1/environment/land-cover/cell-statistics";

test.use({ channel: "chrome" });
test.describe.configure({ mode: "serial" });

async function openControl(page: Page) {
  const control = page.getByTestId("land-cover-layer-control");
  await expect(control).toBeVisible({ timeout: 45_000 });
  await page.getByTestId("land-cover-layer-summary").click();
  await expect(page.getByTestId("land-cover-layer-toggle")).toBeVisible();
  return control;
}

async function gotoSuitability(page: Page) {
  await page.goto(SUITABILITY);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 45_000 });
}

test("2/3/4: the frontend serves, equity mode works, suitability mode works", async ({ page }) => {
  await page.goto(`${BASE}/?v=1`);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("h1")).toBeVisible();

  await page.getByTestId("mode-equity").click();
  await expect(page.getByTestId("map-container")).toBeVisible();

  await page.getByTestId("mode-suitability").click();
  await expect(page.getByTestId("suitability-summary")).toBeVisible({ timeout: 45_000 });
});

test("14/20: the land-cover layer defaults OFF and its legend appears once enabled", async ({
  page,
}) => {
  await gotoSuitability(page);
  await openControl(page);
  const toggle = page.getByTestId("land-cover-layer-toggle");
  await expect(toggle).not.toBeChecked();

  await toggle.check();
  await expect(toggle).toBeChecked();
  await expect(page.getByTestId("land-cover-legend")).toBeVisible();
  await expect(page.getByTestId("land-cover-legend-rows")).toHaveCount(1);
});

test("15/16/17/18/19: coverage mode, dominant L1/L2/L3, and the class filters render", async ({
  page,
}) => {
  await gotoSuitability(page);
  await openControl(page);
  await page.getByTestId("land-cover-layer-toggle").check();

  // Coverage mode: three states, each a working filter.
  await page.getByTestId("land-cover-mode-coverage").check();
  await expect(page.getByTestId("land-cover-legend")).toContainText("평가 범위");
  for (const s of ["COMPLETE_EXACT", "PARTIAL", "NO_COVERAGE"]) {
    await expect(page.getByTestId(`land-cover-coverage-toggle-${s}`)).toBeVisible();
  }

  // Dominant class at each of the three official levels.
  await page.getByTestId("land-cover-mode-dominant").check();
  for (const level of [1, 2, 3] as const) {
    await page.getByTestId(`land-cover-level-${level}`).check();
    await expect(page.getByTestId("land-cover-legend")).toContainText(`L${level}`);
    await expect
      .poll(async () => page.getByTestId("land-cover-legend-row").count(), { timeout: 45_000 })
      .toBeGreaterThan(0);
  }

  // A class filter actually removes its row's checkbox state.
  const first = page.getByTestId("land-cover-legend-row").first();
  const box = first.locator("input[type=checkbox]");
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(box).not.toBeChecked();
});

test("22/23: the layer control carries the authorization disclosure and the attribution", async ({
  page,
}) => {
  await gotoSuitability(page);
  const control = await openControl(page);

  await expect(page.getByTestId("land-cover-layer-disclaimer")).toContainText("협력 정부기관");
  await expect(page.getByTestId("land-cover-layer-disclaimer")).toContainText("원본 SHP 파일");
  await expect(page.getByTestId("land-cover-layer-attribution")).toContainText(
    "출처: 기후에너지환경부 환경공간정보서비스(EGIS)",
  );
  await expect(page.getByTestId("land-cover-layer-source-link")).toHaveAttribute(
    "href",
    /^https:\/\//,
  );
  // No EGIS licence / KOGL claim anywhere in the control.
  expect(await control.innerText()).not.toMatch(/KOGL|공공누리|제1유형|서면 승인/);
});

test("21/22/23/24: a candidate opens the land-cover detail with status, basis and attribution", async ({
  page,
}) => {
  const cells = await page.request.get(
    `${BASE}${LC}/cells?bbox=126.8,37.4,127.2,37.7&limit=500&coverage_status=COMPLETE_EXACT`,
  );
  expect(cells.status()).toBe(200);
  const keys = new Set(
    ((await cells.json()) as { items: { candidate_key: string }[] }).items.map(
      (i) => i.candidate_key,
    ),
  );
  expect(keys.size).toBeGreaterThan(0);

  const cands = await page.request.get(
    `${BASE}/api/v1/suitability/candidates?bbox=126.8,37.4,127.2,37.7&limit=500`,
  );
  expect(cands.status()).toBe(200);
  const body = (await cands.json()) as {
    features: { properties: { candidate_key: string; candidate_id: number } }[];
  };
  const match = body.features.find((f) => keys.has(f.properties.candidate_key));
  expect(match, "no public candidate matched a land-cover cell").toBeTruthy();

  await page.goto(`${SUITABILITY}&cand=${match!.properties.candidate_id}`);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("land-cover-cell-panel")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("land-cover-body")).toBeVisible({ timeout: 45_000 });

  await expect(page.getByTestId("land-cover-license-disclosure")).toContainText(
    "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER",
  );
  await expect(page.getByTestId("land-cover-authorization-basis")).toContainText(
    "GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION",
  );
  await expect(page.getByTestId("land-cover-attribution")).toContainText(
    "출처: 기후에너지환경부 환경공간정보서비스(EGIS)",
  );
  await expect(page.getByTestId("land-cover-scoring-disclosure")).toContainText(
    "used_in_suitability_scoring: false",
  );
});

test("16/23: the data/source page carries the attribution, basis, and the limitations", async ({
  page,
}) => {
  await page.goto(`${BASE}/?v=1`);
  await expect(page.getByTestId("top-navigation")).toBeVisible({ timeout: 45_000 });
  await page.getByTestId("mode-transparency").click();
  const note = page.getByTestId("land-cover-source-note");
  await expect(note).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("land-cover-source-note-body")).toBeVisible({ timeout: 45_000 });

  await expect(page.getByTestId("land-cover-source-note-attribution")).toContainText(
    "출처: 기후에너지환경부 환경공간정보서비스(EGIS)",
  );
  await expect(page.getByTestId("land-cover-source-note-status")).toContainText(
    "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER",
  );
  await expect(page.getByTestId("land-cover-source-note-basis")).toContainText(
    "GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION",
  );
  await expect(page.getByTestId("land-cover-source-note-raw")).toContainText("제공하지 않음");
  await expect(page.getByTestId("land-cover-source-note-scoring")).toContainText("미반영");
  // Publication did NOT erase the recorded limitations.
  const limits = page.getByTestId("land-cover-source-note-limits");
  await expect(limits).toContainText("해안·도서");
  await expect(limits).toContainText("실제로 토지피복이 없다는 의미가 아닙니다");
  await expect(limits).toContainText("각 단계별로 따로 계산");
});

test("25: the browser never requests a raw land-cover feature or geometry endpoint", async ({
  page,
}) => {
  const forbidden: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/land-cover\/(features|map-sheets|download|shapefile)/.test(u)) forbidden.push(u);
    if (/\.(shp|dbf|zip|csv)(\?|$)/i.test(u) && u.includes("land-cover")) forbidden.push(u);
  });
  await gotoSuitability(page);
  await openControl(page);
  await page.getByTestId("land-cover-layer-toggle").check();
  await expect(page.getByTestId("land-cover-legend")).toBeVisible();
  await page.waitForTimeout(4000);
  expect(forbidden, `raw land-cover requests: ${forbidden.join(", ")}`).toHaveLength(0);
});

// Was a 390×844 "mobile" check. 여기다 is desktop-required below 1024px
// (frontend/RESPONSIVE_LAYOUT.md), so the suitability map — and with it the
// land-cover layer control and legend this test is about — is not mounted at that
// width. 1024×768 is the narrowest viewport where the control actually exists, and is
// therefore the real worst case for "does it fit without side scroll".
test("desktop floor: the layer control and legend are usable with no horizontal overflow", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  await gotoSuitability(page);
  await openControl(page);
  await page.getByTestId("land-cover-layer-toggle").check();
  await expect(page.getByTestId("land-cover-legend")).toBeVisible();
  await expect(page.getByTestId("land-cover-layer-attribution")).toContainText("출처:");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page body must not scroll horizontally").toBeLessThanOrEqual(1);
  await context.close();
});
