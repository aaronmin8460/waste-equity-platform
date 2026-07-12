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

  // Switching to the derived per-capita metric (Phase 5.1) shows the
  // derived-indicator panel with dual-source provenance and unit.
  await page
    .getByRole("radio", { name: /1인당 생활계|Household per capita/ })
    .check();
  const derived = page.getByTestId("derived-metric-metadata");
  await expect(derived).toBeVisible({ timeout: 15_000 });
  await expect(derived).toContainText("kg/인/년");
  await expect(derived).toContainText("ORIGIN_BASED_TREATMENT_OUTCOME");
  await expect(derived).toContainText("인구 출처");
  await expect(page.getByTestId("legend")).toContainText("kg/인/년");

  // Switching to the facility-burden metric (Phase 5.2) shows the
  // facility-location accounting basis and the coverage note.
  await page.getByRole("radio", { name: /1인당 소재 시설 처리량/ }).check();
  await expect(derived).toBeVisible({ timeout: 15_000 });
  await expect(derived).toContainText("FACILITY_LOCATION_BASED_THROUGHPUT");
  await expect(page.getByTestId("coverage-note")).toContainText("좌표 없는 시설");

  // Facility toggle keeps the map alive.
  await page.getByTestId("facilities-toggle").uncheck();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  expect(disallowedRequests).toEqual([]);
});

test("suitability mode screens candidates with provenance and no government API calls", async ({
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

  // Enter suitability mode.
  await page.getByTestId("mode-suitability").click();

  // Analysis summary + counts render.
  const summary = page.getByTestId("suitability-summary");
  await expect(summary).toBeVisible({ timeout: 20_000 });
  await expect(summary).toContainText("suitability-policy-v1");
  await expect(page.getByTestId("candidate-counts")).toContainText("적합");

  // The analytical-screening disclaimer is prominent (never a legal claim).
  await expect(page.getByTestId("suitability-disclaimer")).toContainText("legal");

  // Candidate cells load into the viewport (controlled, bbox-limited).
  await expect(page.getByTestId("candidate-viewport-count")).toContainText("표시", {
    timeout: 20_000,
  });

  // Exclusion + review reasons are shown (never fabricated).
  await expect(page.getByText("제외 사유 (Exclusion reasons)")).toBeVisible();
  await expect(page.getByText("PROJECT_SCREENING_EXCLUSION:UD801")).toBeVisible();
  await expect(page.getByText("검토 사유 (Review reasons)")).toBeVisible();

  // Coverage warnings surface OFFICIAL_SOURCE_UNAVAILABLE gaps.
  await expect(page.getByTestId("coverage-warnings")).toContainText("COVERAGE_GAP");

  // Profile switching re-weights (updates the top-candidate list).
  await page.getByRole("radio", { name: /접근성 중심/ }).check();
  await expect(page.getByTestId("top-candidates")).toBeVisible();

  // Clicking a top candidate opens the evidence panel with component scores and
  // accounting-basis provenance.
  await page.getByTestId("top-candidate-item").first().click();
  const detail = page.getByTestId("candidate-detail");
  await expect(detail).toBeVisible({ timeout: 15_000 });
  await expect(detail).toContainText("토지이용 Zoning");
  await expect(detail).toContainText("FACILITY_LOCATION_BASED_THROUGHPUT");
  await expect(detail).toContainText("ORIGIN_BASED_TREATMENT_OUTCOME");
  await expect(page.getByTestId("candidate-sensitivity")).toBeVisible();

  expect(disallowedRequests).toEqual([]);
});
