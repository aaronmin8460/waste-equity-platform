import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Responsive-layout e2e coverage.
 *
 * Unlike the live smoke specs, this one intercepts every backend request itself
 * (see mockBackend), so it drives the real application UI — the responsive
 * shell, the MapLibre map container, the collapsible controls — at real viewport
 * sizes without any backend, tile server, or official data. It only ever asserts
 * on *layout* (dimensions, overflow, stacking), never on data values. The
 * 수도권매립지 (flow) dashboard is driven to its explicitly-unavailable state (the
 * mock serves the backend's real 404 NO_DATA response) and is guarded against
 * ever displaying a synthetic fixture as official public data.
 *
 * Verified viewports:
 *   390 × 844  — iPhone-class phone (primary mobile target)
 *   430 × 932  — large phone
 *   768 × 1024 — tablet portrait (md breakpoint → side-by-side begins here)
 *   1440 × 900 — desktop
 */

const MD_BREAKPOINT = 768;

const VIEWPORTS = [
  { name: "mobile 390×844", width: 390, height: 844 },
  { name: "large-mobile 430×932", width: 430, height: 932 },
  { name: "tablet-portrait 768×1024", width: 768, height: 1024 },
  { name: "desktop 1440×900", width: 1440, height: 900 },
];

/**
 * The document must never scroll horizontally. Compare the root's scroll width
 * against its client width, allowing a 1px rounding tolerance.
 */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "no page-level horizontal overflow").toBeLessThanOrEqual(clientWidth + 1);
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

for (const vp of VIEWPORTS) {
  const isDesktop = vp.width >= MD_BREAKPOINT;

  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("loads, keeps the map visibly sized, and never overflows horizontally", async ({
      page,
    }) => {
      await page.goto("/");

      // Equity mode mounts the map. The container itself is what we measure (it
      // renders regardless of WebGL/tile availability).
      const map = page.getByTestId("map-container");
      await expect(map).toBeVisible();
      const box = await map.boundingBox();
      expect(box).not.toBeNull();
      // Meaningful width and height — never squeezed to a sliver or collapsed.
      expect(box!.width).toBeGreaterThan(200);
      expect(box!.height).toBeGreaterThan(240);
      // Not pushed entirely outside the viewport.
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x).toBeLessThan(vp.width);
      expect(box!.x + box!.width).toBeGreaterThan(vp.width / 2);

      await expectNoHorizontalOverflow(page);
    });

    test("exposes the mode switcher and lets every mode be selected", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByTestId("mode-switch")).toBeVisible();

      // Suitability (still a map mode).
      await page.getByTestId("mode-suitability").click();
      await expect(page.getByTestId("mode-suitability")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("map-container")).toBeVisible();
      await expect(page.getByTestId("suitability-summary")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // 수도권매립지 (full-width dashboard, no map). The mock serves the backend's
      // real "no official data" response (404 NO_DATA_AVAILABLE), so the dashboard
      // renders its explicitly-unavailable state — never a fabricated official
      // summary of zeros.
      await page.getByTestId("mode-flow").click();
      await expect(page.getByTestId("landfill-dashboard")).toBeVisible();
      await expect(page.getByTestId("map-container")).toHaveCount(0);
      // The unavailable state shows its notice; the filter controls stay usable.
      await expect(page.getByTestId("landfill-error")).toBeVisible();
      await expect(page.getByTestId("landfill-filters")).toBeVisible();
      // Regression guard: this synthetic layout fixture is NOT displayed as
      // official public data. The KPI and evidence blocks (which carry the
      // OFFICIAL_REPORTED_VALUE / OFFICIAL_INPUTS_DERIVED_VALUE labels) never
      // mount, and no official-evidence label text appears anywhere on the page.
      await expect(page.getByTestId("landfill-kpis")).toHaveCount(0);
      await expect(page.getByTestId("landfill-evidence")).toHaveCount(0);
      await expect(page.getByText("OFFICIAL_REPORTED_VALUE")).toHaveCount(0);
      await expect(page.getByText("OFFICIAL_INPUTS_DERIVED_VALUE")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);

      // Back to equity restores the map.
      await page.getByTestId("mode-equity").click();
      await expect(page.getByTestId("map-container")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test(`uses a ${isDesktop ? "side-by-side" : "stacked"} shell layout`, async ({ page }) => {
      await page.goto("/");
      const aside = page.locator("aside");
      const map = page.getByTestId("map-container");
      await expect(aside).toBeVisible();
      await expect(map).toBeVisible();
      const asideBox = (await aside.boundingBox())!;
      const mapBox = (await map.boundingBox())!;

      if (isDesktop) {
        // Sidebar stays ~its fixed desktop width (md:w-96 = 384px) and the map
        // sits to its right on the same row.
        expect(asideBox.width).toBeGreaterThan(340);
        expect(asideBox.width).toBeLessThan(420);
        expect(mapBox.x).toBeGreaterThanOrEqual(asideBox.x + asideBox.width - 2);
        expect(Math.abs(mapBox.y - asideBox.y)).toBeLessThan(4);
      } else {
        // Sidebar spans (nearly) the full width and the map is stacked below it.
        expect(asideBox.width).toBeGreaterThan(vp.width - 4);
        expect(mapBox.y).toBeGreaterThanOrEqual(asideBox.y + asideBox.height - 2);
      }
    });

    if (isDesktop) {
      test("force-expands the control panels (no collapse toggles on desktop)", async ({
        page,
      }) => {
        await page.goto("/");
        // The mobile disclosure summaries are hidden and their bodies are shown,
        // so every panel is reachable without interaction — the desktop sidebar
        // is unchanged from before this feature.
        await expect(page.getByText("지도 범례 (Legend)")).toBeHidden();
        await expect(page.getByTestId("choropleth-legend-row").first()).toBeVisible();
        await expect(page.getByTestId("facilities-toggle")).toBeVisible();
      });
    }

    if (!isDesktop) {
      test("collapses verbose controls but keeps them reachable, radios included", async ({
        page,
      }) => {
        await page.goto("/");

        // The metric radios are a primary control — reachable without expanding.
        const firstRadio = page.getByRole("radio").first();
        await expect(firstRadio).toBeVisible();

        // The legend is collapsed by default on mobile; its rows are not visible…
        const legendRow = page.getByTestId("choropleth-legend-row").first();
        await expect(legendRow).toBeHidden();

        // …until its labelled disclosure is opened.
        await page.getByText("지도 범례 (Legend)").click();
        await expect(legendRow).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    }
  });
}
