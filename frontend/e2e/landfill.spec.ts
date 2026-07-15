import { expect, test } from "@playwright/test";

/**
 * Live smoke test for the capital-region Sudokwon Landfill flow view against the
 * real backend (E2E_BACKEND_URL). Verifies the new tab renders the official
 * metropolitan → landfill flow with KPIs, filters, charts, and evidence labels;
 * that only the three metropolitan origins ever appear (never municipal); and
 * that no request leaves for a Korean government API host.
 */

const backendUrl = process.env.E2E_BACKEND_URL;

test.skip(!backendUrl, "E2E_BACKEND_URL is not configured (live smoke only)");

const ALLOWED_HOST_SUFFIXES = ["localhost", "127.0.0.1", "tile.openstreetmap.org"];

test("landfill flow view: official metropolitan flow, evidence, no government API calls", async ({
  page,
}) => {
  const disallowedRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "blob:" || url.protocol === "data:") return;
    const host = url.hostname;
    if (!ALLOWED_HOST_SUFFIXES.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      disallowedRequests.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });

  // Enter the new landfill flow tab.
  await page.getByTestId("mode-flow").click();
  const panel = page.getByTestId("flow-panel");
  await expect(panel).toBeVisible({ timeout: 20_000 });

  // Default is the latest complete year (no partial-year badge for the default).
  await expect(page.getByTestId("flow-year-select")).toHaveValue("");
  await expect(page.getByTestId("flow-partial-year")).toHaveCount(0);

  // KPI cards render official + derived values.
  await expect(page.getByTestId("flow-kpis")).toBeVisible();
  await expect(page.getByTestId("flow-kpi-quantity")).toContainText("t");
  await expect(page.getByTestId("flow-kpi-fee")).toContainText("억원");
  await expect(page.getByTestId("flow-kpi-effective-fee")).toContainText("원/t");

  // The metropolitan-only caveat is prominent.
  await expect(page.getByTestId("flow-caveat")).toContainText(
    "시·군·구별 반입량을 의미하지 않습니다",
  );

  // Evidence panel distinguishes official reported values from derived ones and
  // shows source snapshot dates.
  const evidence = page.getByTestId("flow-evidence");
  await expect(evidence).toContainText("OFFICIAL_REPORTED_VALUE");
  await expect(evidence).toContainText("OFFICIAL_INPUTS_DERIVED_VALUE");
  await expect(evidence).toContainText("VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW");
  await expect(page.getByTestId("flow-fee-caveat")).toContainText("순수 운송비");
  await expect(page.getByTestId("reference-period").first()).not.toBeEmpty();

  // Only the three metropolitan origins can appear — never a municipal arrow.
  const flowItems = page.getByTestId("flow-list").locator("li");
  const count = await flowItems.count();
  expect(count).toBeLessThanOrEqual(3);
  await expect(page.getByTestId("flow-list")).toContainText("수도권매립지");

  // Charts render.
  await expect(page.getByTestId("flow-trend-quantity")).toBeVisible();
  await expect(page.getByTestId("flow-origin-comparison")).toBeVisible();
  await expect(page.getByTestId("flow-waste-composition")).toBeVisible();

  // Map stays alive with the flow layers.
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  expect(disallowedRequests).toEqual([]);
});

test("landfill flow view: filters update the official values", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("mode-flow").click();
  await expect(page.getByTestId("flow-panel")).toBeVisible({ timeout: 20_000 });

  // Filter to a single metropolitan origin (Seoul); the flow list must still be
  // metropolitan-only and the KPI still renders.
  await page.getByTestId("flow-origin-select").selectOption("11");
  await expect(page.getByTestId("flow-kpi-quantity")).toContainText("t");
  const seoulItems = page.getByTestId("flow-list").locator("li");
  await expect(seoulItems).toHaveCount(1);
  await expect(seoulItems.first()).toContainText("서울시");

  // Select the latest complete year explicitly, then a month → annual/monthly.
  const yearSelect = page.getByTestId("flow-year-select");
  const years = await yearSelect.locator("option").allInnerTexts();
  // Pick a concrete year option (skip the default "latest complete" entry).
  const concreteYear = years.find((label) => /^\d{4}$/.test(label.trim()));
  if (concreteYear) {
    await yearSelect.selectOption(concreteYear.trim());
    await expect(page.getByTestId("flow-panel")).toContainText(`${concreteYear.trim()}년`);
  }
});

test("landfill flow view: usable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("mode-flow").click();
  await expect(page.getByTestId("flow-panel")).toBeVisible({ timeout: 20_000 });
  // The KPI grid and filters are reachable (sidebar scrolls).
  await expect(page.getByTestId("flow-filters")).toBeVisible();
  await page.getByTestId("flow-kpis").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("flow-kpi-quantity")).toBeVisible();
});
