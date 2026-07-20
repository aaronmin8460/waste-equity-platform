import { expect, test, type Page, type Route } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Pre-deployment integration regression (Phase 6).
 *
 * A full tour of every mode/feature — 형평성 → 후보지 점수 → 비용 살펴보기 (with a real
 * calculate) → 수도권매립지 — at the five required viewports (adding the 1024×768
 * landscape-tablet case the responsive spec did not cover), asserting each mode
 * renders and the document never scrolls horizontally. Uses mockBackend (with the
 * boundaries overridden to one region so the equity map and the cost lens have
 * data); the landfill mode stays in its honest 404 "no official data" state.
 */

const ONE_REGION = {
  type: "FeatureCollection",
  reference_year: 2024,
  count: 1,
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [126.97, 37.57],
            [126.99, 37.57],
            [126.99, 37.59],
            [126.97, 37.59],
            [126.97, 37.57],
          ],
        ],
      },
      properties: {
        region_code: "KR-SGIS-11110",
        region_name: "종로구",
        region_level: "SIGUNGU",
        parent_region_code: "KR-SGIS-11",
        source_id: "sgis",
        boundary_reference_period: "2024",
      },
    },
  ],
};

const VIEWPORTS = [
  { name: "iPhone 390×844", width: 390, height: 844 },
  { name: "large phone 430×932", width: 430, height: 932 },
  { name: "tablet portrait 768×1024", width: 768, height: 1024 },
  { name: "tablet landscape 1024×768", width: 1024, height: 768 },
  { name: "desktop 1440×900", width: 1440, height: 900 },
];

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "no page-level horizontal overflow").toBeLessThanOrEqual(clientWidth + 1);
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
  await page.route("**/api/v1/regions/boundaries**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ONE_REGION),
    }),
  );
});

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("tours every mode without horizontal overflow", async ({ page }) => {
      await page.goto("/");

      // 형평성 (equity) — map + legend.
      await expect(page.getByTestId("map-container")).toBeVisible();
      await expect(page.getByRole("radio").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // 후보지 점수 (suitability score) — map + summary + CRITIC/stability.
      await page.getByTestId("mode-suitability").click();
      await expect(page.getByTestId("suitability-summary")).toBeVisible();
      await expect(page.getByTestId("map-container")).toBeVisible();
      // CRITIC data-derived profile is offered (the mocked run computed it) and
      // the weight-sensitivity stability summary + counts render.
      await expect(page.getByTestId("profile-radio-critic")).toBeVisible();
      await expect(page.getByTestId("stability-summary")).toBeVisible();
      await expect(page.getByTestId("stability-counts")).toContainText("62");
      // Selecting CRITIC is a profile round-trip (it re-points the map's immutable
      // critic vector tiles); the radio reflects the new selection.
      await page.getByTestId("profile-radio-critic").check();
      await expect(page.getByTestId("profile-radio-critic")).toBeChecked();
      await page.getByTestId("profile-radio-baseline").check();
      // The stable-only map toggle is an accessible native checkbox in the floating
      // legend (collapsed behind a summary on mobile, force-open at md+), so assert
      // it is present rather than visible across every viewport in this tour.
      await expect(page.getByTestId("stable-only-toggle")).toBeAttached();
      await expectNoHorizontalOverflow(page);

      // 비용 살펴보기 (cost lens) — a full-width dashboard, no map, calculate, results.
      await page.getByTestId("suitability-view-cost").click();
      await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible();
      await expect(page.getByTestId("map-container")).toHaveCount(0);
      // The region picker is the Phase 2 searchable combobox, not a multi-select.
      await page.getByTestId("facility-cost-region-search").click();
      await page
        .getByTestId("facility-cost-region-option")
        .filter({ hasText: "서울 종로구" })
        .click();
      await page.getByTestId("facility-cost-calculate").click();
      // Phase 3: the results view replaces the setup, leading with approximations.
      await expect(page.getByTestId("facility-cost-results-view")).toBeVisible();
      await expect(page.getByTestId("fc-standard-cost")).toHaveText("약 121억원");
      await expect(page.getByTestId("facility-cost-exclusions-summary")).toContainText(
        "포함되지 않은 비용",
      );
      await expect(page.getByText("총비용")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);

      // 수도권매립지 (landfill) — honest unavailable state, no map, filters usable.
      await page.getByTestId("mode-flow").click();
      await expect(page.getByTestId("landfill-dashboard")).toBeVisible();
      await expect(page.getByTestId("map-container")).toHaveCount(0);
      // Phase 5: the mock's 404 NO_DATA_AVAILABLE is an answer, not a fault, so it
      // renders the no-data state rather than the genuine-error alert.
      await expect(page.getByTestId("landfill-no-data")).toBeVisible();
      await expect(page.getByTestId("landfill-error")).toHaveCount(0);
      await expect(page.getByTestId("landfill-filters")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Back to 형평성 restores the map.
      await page.getByTestId("mode-equity").click();
      await expect(page.getByTestId("map-container")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });
}
