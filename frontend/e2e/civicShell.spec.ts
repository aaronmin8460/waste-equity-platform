import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Civic dashboard shell — desktop acceptance for the visual-foundation milestone.
 *
 * Complements `desktopNavigation.spec.ts` (which owns the "one nav, same position,
 * no wrapping" contract) by covering what the refresh newly promises: the brand
 * block, the app-bar height budget, the full-height layout at all three desktop
 * targets, sidebar-not-page scrolling, and no clipping at the 1024px minimum.
 *
 * Structure and geometry only — never a data value — driven by the deterministic
 * `mockBackend`, so no backend, database, or tile server is required. Deliberately
 * NO pixel snapshots: the repository has no visual-regression convention, and a
 * pixel baseline would fail on the first intentional style change
 * (docs/ui-refresh/baseline.md §7).
 */

const DESKTOP_VIEWPORTS = [
  { name: "1280×800", width: 1280, height: 800 },
  { name: "1440×900", width: 1440, height: 900 },
  { name: "1920×1080", width: 1920, height: 1080 },
];

const MODE_LABELS = ["지역 부담", "후보지 분석", "매립지 현황", "데이터·출처"];
const BRAND_NAME = "우리 동네 폐기물 지도";

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${where}: no page-level horizontal overflow`).toBeLessThanOrEqual(
    clientWidth + 1,
  );
}

async function gotoView(page: Page, query: string): Promise<void> {
  await page.goto(query);
  await expect(page.getByTestId("mode-switch")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

for (const vp of DESKTOP_VIEWPORTS) {
  test.describe(`desktop ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("shows the brand beside the navigation, outside its group", async ({ page }) => {
      await gotoView(page, "/");

      const brand = page.getByTestId("app-brand");
      await expect(brand).toBeVisible();
      await expect(brand).toContainText(BRAND_NAME);
      await expect(brand).toContainText("Waste Equity Platform");

      // Brand and navigation share the bar's single row…
      const brandBox = (await brand.boundingBox())!;
      const navGroup = (await page.getByTestId("mode-switch").boundingBox())!;
      expect(Math.abs(brandBox.y - navGroup.y), "same row").toBeLessThan(24);
      // …with the brand on the left of the navigation.
      expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(navGroup.x + 1);

      // The brand is not one of the navigation's controls.
      expect(
        await page
          .getByTestId("mode-switch")
          .evaluate((group, name) => group.textContent?.includes(name) ?? false, BRAND_NAME),
      ).toBe(false);
      await expect(page.getByTestId("mode-switch").locator("button")).toHaveCount(4);

      await expectNoHorizontalOverflow(page, `brand at ${vp.name}`);
    });

    test("keeps the app bar within the desktop height budget", async ({ page }) => {
      await gotoView(page, "/");
      const nav = (await page.getByTestId("top-navigation").boundingBox())!;

      // ~60–64px plus the 1px bottom border. A taller bar eats the map's height;
      // a shorter one cannot hold a 44px control with breathing room.
      expect(nav.height, "app bar height").toBeGreaterThanOrEqual(56);
      expect(nav.height, "app bar height").toBeLessThanOrEqual(72);
      expect(nav.y, "flush with the viewport top").toBeLessThanOrEqual(1);

      // The active tab is as tall as the bar, so its 2px indicator lands directly
      // on top of the bar's own bottom border rather than floating mid-bar.
      const activeTab = (await page.getByTestId("mode-equity").boundingBox())!;
      const barBorder = await page
        .getByTestId("top-navigation")
        .evaluate((el) => parseFloat(getComputedStyle(el).borderBottomWidth));
      expect(activeTab.y + activeTab.height).toBeCloseTo(nav.y + nav.height - barBorder, 0);
      expect(activeTab.height, "tab fills the bar height").toBeGreaterThanOrEqual(
        nav.height - barBorder - 1,
      );
    });

    test("preserves the exact navigation labels and one page-level h1", async ({ page }) => {
      for (const [query, expectedH1] of [
        ["/?v=1&mode=equity", "지역 부담"],
        ["/?v=1&mode=suitability&view=score", "후보지 분석"],
        ["/?v=1&mode=flow", "수도권매립지 반입 현황"],
        ["/?v=1&mode=transparency", "데이터와 출처"],
      ] as const) {
        await gotoView(page, query);

        for (const label of MODE_LABELS) {
          await expect(
            page.getByRole("button", { name: label, exact: true }),
            `${query}: ${label}`,
          ).toHaveCount(1);
        }

        // Exactly one h1, and it titles the AREA — the product name lives in the
        // app bar, so it is never both the brand and the heading on one screen.
        await expect(page.locator("h1"), `${query}: one h1`).toHaveCount(1);
        await expect(page.locator("h1")).toHaveText(expectedH1);
        await expect(page.getByTestId("app-brand")).toBeVisible();

        // One navigation landmark and one main-content target per view.
        await expect(page.getByTestId("top-navigation")).toHaveCount(1);
        await expect(page.locator("#main-content")).toHaveCount(1);
      }
    });

    test("fills the viewport height and scrolls the sidebar, not the page", async ({ page }) => {
      await gotoView(page, "/?v=1&mode=equity");

      // The shell is a full-height desktop tool: the document itself does not scroll.
      const documentScrolls = await page.evaluate(
        () => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      );
      expect(documentScrolls, "no page-level vertical scroll at desktop").toBe(false);

      // The control column is its own scroll container…
      const sidebar = page.locator("aside");
      await expect(sidebar).toBeVisible();
      const overflowY = await sidebar.evaluate((el) => getComputedStyle(el).overflowY);
      expect(overflowY).toBe("auto");
      // …and it ends at the viewport bottom rather than pushing the page taller.
      const sidebarBox = (await sidebar.boundingBox())!;
      expect(sidebarBox.y + sidebarBox.height).toBeLessThanOrEqual(vp.height + 2);

      // The map fills the rest of the row: no strip below it.
      const mapBox = (await page.getByTestId("map-container").boundingBox())!;
      expect(mapBox.y + mapBox.height, "map reaches the viewport bottom").toBeGreaterThanOrEqual(
        vp.height - 6,
      );
      expect(mapBox.height, "map is the dominant surface").toBeGreaterThan(vp.height * 0.75);

      await expectNoHorizontalOverflow(page, `equity at ${vp.name}`);
    });

    test("mounts exactly one map, and none on the map-free areas", async ({ page }) => {
      await gotoView(page, "/?v=1&mode=equity");
      await expect(page.getByTestId("map-container")).toHaveCount(1);

      await gotoView(page, "/?v=1&mode=suitability&view=score");
      await expect(page.getByTestId("map-container")).toHaveCount(1);

      for (const query of [
        "/?v=1&mode=suitability&view=cost",
        "/?v=1&mode=flow",
        "/?v=1&mode=transparency",
      ]) {
        await gotoView(page, query);
        // Gone from the DOM, not hidden with CSS.
        await expect(page.getByTestId("map-container"), query).toHaveCount(0);
      }
    });
  });
}

test.describe("minimum supported width 1024px", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("shows the whole app bar without clipping", async ({ page }) => {
    await gotoView(page, "/");

    // Every navigation button is inside the viewport, on one row with the brand.
    const brandBox = (await page.getByTestId("app-brand").boundingBox())!;
    const boxes = [];
    for (const testId of ["mode-equity", "mode-suitability", "mode-flow", "mode-transparency"]) {
      const box = (await page.getByTestId(testId).boundingBox())!;
      expect(box.x, `${testId}: left edge inside viewport`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${testId}: right edge inside viewport`).toBeLessThanOrEqual(1024);
      boxes.push(box);
    }
    // Still a single unwrapped row at the minimum supported width.
    for (const box of boxes) {
      expect(Math.abs(box.y - boxes[0].y)).toBeLessThan(4);
    }
    expect(Math.abs(brandBox.y - boxes[0].y), "brand shares the row").toBeLessThan(24);

    await expectNoHorizontalOverflow(page, "1024px app bar");
  });

  test("keeps the map layout usable with no horizontal clipping", async ({ page }) => {
    for (const query of ["/?v=1&mode=equity", "/?v=1&mode=flow", "/?v=1&mode=transparency"]) {
      await gotoView(page, query);
      await expectNoHorizontalOverflow(page, `${query} at 1024px`);
    }

    await gotoView(page, "/?v=1&mode=equity");
    const mapBox = (await page.getByTestId("map-container").boundingBox())!;
    // A usable map beside the fixed 384px control column.
    expect(mapBox.width).toBeGreaterThan(400);
    expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(1024 + 1);
  });
});
