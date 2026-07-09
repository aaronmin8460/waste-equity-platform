import { expect, test } from "@playwright/test";

/**
 * Live smoke test against the real backend (E2E_BACKEND_URL) and database.
 * Verifies the map loads, layers and legend render, source/reference-period
 * metadata is visible, and no request ever leaves for a Korean government
 * API host — the frontend must talk only to the platform backend and the
 * public basemap tile service.
 */

const backendUrl = process.env.E2E_BACKEND_URL;

test.skip(!backendUrl, "E2E_BACKEND_URL is not configured (live smoke only)");

const ALLOWED_HOST_SUFFIXES = ["localhost", "127.0.0.1", "tile.openstreetmap.org"];

test("map loads with official data, metadata, and no government API calls", async ({ page }) => {
  const disallowedRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    // blob:/data: URLs are in-page resources (e.g. MapLibre workers), not
    // network egress.
    if (url.protocol === "blob:" || url.protocol === "data:") return;
    const host = url.hostname;
    if (!ALLOWED_HOST_SUFFIXES.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      disallowedRequests.push(request.url());
    }
  });

  await page.goto("/");

  // Map canvas renders (MapLibre initialized with backend boundaries).
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });

  // Metric metadata panel shows source and reference period.
  const metadata = page.getByTestId("metric-metadata");
  await expect(metadata).toBeVisible();
  await expect(metadata).toContainText("sgis");
  await expect(page.getByTestId("reference-period")).not.toBeEmpty();

  // Legend renders with the explicit no-data class.
  await expect(page.getByTestId("legend")).toContainText("데이터 없음");

  // Facility layer metadata reports served vs. unmappable facilities.
  await expect(page.getByTestId("facility-metadata")).toContainText("좌표 보유 시설");

  // Switching to a waste metric shows the RCIS accounting basis.
  await page.getByRole("radio").nth(1).check();
  await expect(page.getByTestId("metric-metadata")).toContainText(
    "ORIGIN_BASED_TREATMENT_OUTCOME",
    { timeout: 15_000 },
  );

  // Facility toggle keeps the map alive.
  await page.getByTestId("facilities-toggle").uncheck();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  expect(disallowedRequests).toEqual([]);
});
