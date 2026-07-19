import { expect, test, type Page, type Route } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Facility cost lens e2e (Phase 5).
 *
 * Uses mockBackend (the cost result is a CONTROLLED CONTRACT FIXTURE — analytical
 * standard-cost data shown only with its disclaimer + completeness, never labelled
 * as official metric data), then overrides the boundaries with a single SIGUNGU
 * region so the service-region picker has an option to drive the full calculate
 * flow. Verified at a mobile and a desktop viewport for single-column usability and
 * no horizontal overflow.
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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
  // Override the (empty) boundaries with one SIGUNGU region — registered after
  // mockBackend, so this handler wins for the boundaries path.
  await page.route("**/api/v1/regions/boundaries**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ONE_REGION),
    }),
  );
});

const VIEWPORTS = [
  { name: "mobile 390×844", width: 390, height: 844 },
  { name: "desktop 1440×900", width: 1440, height: 900 },
];

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("drives the cost lens from scenario to results", async ({ page }) => {
      await page.goto("/");
      await page.getByTestId("mode-suitability").click();
      await expect(page.getByTestId("suitability-summary")).toBeVisible();

      // Switch to the cost lens.
      await page.getByTestId("suitability-view-cost").click();
      await expect(page.getByTestId("facility-cost-panel")).toBeVisible();
      await expect(page.getByTestId("facility-cost-disclaimer")).toContainText(
        "권고하거나 반대를 설득하기 위한 페이지가 아닙니다",
      );

      // Calculate is disabled until a service region is chosen.
      await expect(page.getByTestId("facility-cost-calculate")).toBeDisabled();
      await page.getByTestId("facility-cost-regions").selectOption("KR-SGIS-11110");
      await expect(page.getByTestId("facility-cost-calculate")).toBeEnabled();

      await page.getByTestId("facility-cost-calculate").click();

      // Results with the exact fixture values.
      await expect(page.getByTestId("facility-cost-results")).toBeVisible();
      await expect(page.getByTestId("fc-standard-cost")).toContainText("120.75 억원");
      await expect(page.getByTestId("fc-per-capita")).toContainText("42,262.5원");

      // Completeness is shown as explicitly unavailable, never a total.
      await expect(page.getByTestId("facility-cost-completeness")).toContainText("운영비 미포함");
      await expect(page.getByText("총비용")).toHaveCount(0);

      // Client-only deliberation section is present.
      await expect(page.getByTestId("facility-cost-conditions")).toContainText(
        "서버로 전송되거나 집계되지 않습니다",
      );

      await expectNoHorizontalOverflow(page);

      // Back to the score view restores the screening panel.
      await page.getByTestId("suitability-view-score").click();
      await expect(page.getByTestId("suitability-summary")).toBeVisible();
      await expect(page.getByTestId("facility-cost-panel")).toHaveCount(0);
    });
  });
}
