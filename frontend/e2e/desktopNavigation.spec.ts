import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Desktop global-navigation acceptance (Phase 1 of the desktop UI/UX redesign).
 *
 * Phase 0 measured the navigation defect this spec guards against: the mode switch
 * rendered in two structurally different places — inside the 384px equity sidebar
 * (where its four Korean labels WRAPPED onto two lines) and as a full-width row
 * above the three map-free dashboards — while the 후보지 분석 sub-view switch was
 * styled identically to it, so the two read as unrelated peer rows.
 *
 * Everything here is layout/structure only — never a data value — and runs against
 * the deterministic `mockBackend`, so no backend, database, or tile server is
 * required. Deliberately NO pixel-snapshot assertions: the repository has no such
 * convention, and a pixel baseline would fail on the first redesign commit.
 *
 * Primary target 1440×900, secondary 1280×800 (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §8).
 */

const DESKTOP_VIEWPORTS = [
  { name: "desktop 1440×900", width: 1440, height: 900 },
  { name: "desktop 1280×800", width: 1280, height: 800 },
];

const MODE_TEST_IDS = ["mode-equity", "mode-suitability", "mode-flow", "mode-transparency"];
const MODE_LABELS = ["지역 부담", "후보지 분석", "매립지 현황", "데이터·출처"];
const SUBVIEW_TEST_IDS = [
  "suitability-view-score",
  "suitability-view-scenario",
  "suitability-view-cost",
];

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "no page-level horizontal overflow").toBeLessThanOrEqual(clientWidth + 1);
}

/** Load a deep-linked view and wait for the shared chrome to be present. */
async function gotoView(page: Page, query: string): Promise<void> {
  await page.goto(query);
  await expect(page.getByTestId("mode-switch")).toBeVisible();
}

/** The navigation's own bounding box, used to compare its position across modes. */
async function navBox(page: Page) {
  const box = (await page.getByTestId("top-navigation").boundingBox())!;
  expect(box).not.toBeNull();
  return box;
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

for (const vp of DESKTOP_VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("shows all four navigation buttons on a single unwrapped line", async ({ page }) => {
      await gotoView(page, "/");

      const boxes = [];
      for (const testId of MODE_TEST_IDS) {
        const button = page.getByTestId(testId);
        await expect(button).toBeVisible();
        boxes.push((await button.boundingBox())!);
      }

      // Same row: every button shares a top edge within a rounding tolerance. This
      // is the direct regression guard for the sidebar-width wrapping Phase 0 found.
      const firstTop = boxes[0].y;
      for (const [index, box] of boxes.entries()) {
        expect(Math.abs(box.y - firstTop), `${MODE_TEST_IDS[index]} is on the first row`).toBeLessThan(4);
      }
      // Left-to-right in declared order, never overlapping.
      for (let i = 1; i < boxes.length; i += 1) {
        expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 1);
      }
      // The whole nav is one line tall — its height is a single button's height.
      const nav = await navBox(page);
      expect(nav.height).toBeLessThan(boxes[0].height * 1.8);

      await expectNoHorizontalOverflow(page);
    });

    test("renders exactly one navigation, in the same position, in every mode", async ({
      page,
    }) => {
      await gotoView(page, "/");
      const reference = await navBox(page);

      const views = [
        { query: "/?v=1&mode=equity", label: "지역 부담" },
        { query: "/?v=1&mode=suitability&view=score", label: "후보지 점수" },
        { query: "/?v=1&mode=suitability&view=scenario", label: "가중치 바꿔보기" },
        { query: "/?v=1&mode=suitability&view=cost", label: "비용 살펴보기" },
        { query: "/?v=1&mode=flow", label: "매립지 현황" },
        { query: "/?v=1&mode=transparency", label: "데이터·출처" },
      ];

      for (const view of views) {
        await gotoView(page, view.query);

        // No duplicate navigation anywhere.
        await expect(page.getByTestId("top-navigation"), view.label).toHaveCount(1);
        await expect(page.getByTestId("mode-switch"), view.label).toHaveCount(1);
        for (const testId of MODE_TEST_IDS) {
          await expect(page.getByTestId(testId), `${view.label}: ${testId}`).toHaveCount(1);
        }
        // Each Korean label resolves to exactly one button.
        for (const label of MODE_LABELS) {
          await expect(
            page.getByRole("button", { name: label, exact: true }),
            `${view.label}: ${label}`,
          ).toHaveCount(1);
        }

        // Identical position and size in every area — the Phase 1 objective.
        const box = await navBox(page);
        expect(box.x, `${view.label}: nav x`).toBeCloseTo(reference.x, 0);
        expect(box.y, `${view.label}: nav y`).toBeCloseTo(reference.y, 0);
        expect(box.width, `${view.label}: nav width`).toBeCloseTo(reference.width, 0);
        expect(box.height, `${view.label}: nav height`).toBeCloseTo(reference.height, 0);

        await expectNoHorizontalOverflow(page);
      }
    });

    test("marks the active mode with a bottom indicator, not color alone", async ({ page }) => {
      await gotoView(page, "/?v=1&mode=flow");

      const active = page.getByTestId("mode-flow");
      const inactive = page.getByTestId("mode-equity");

      await expect(active).toHaveAttribute("aria-pressed", "true");
      await expect(inactive).toHaveAttribute("aria-pressed", "false");

      const styles = async (locator: ReturnType<Page["getByTestId"]>) =>
        locator.evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            borderBottomWidth: parseFloat(s.borderBottomWidth),
            borderBottomColor: s.borderBottomColor,
            fontWeight: Number(s.fontWeight),
          };
        });

      const activeStyle = await styles(active);
      const inactiveStyle = await styles(inactive);

      // A real, visible indicator line under the active tab…
      expect(activeStyle.borderBottomWidth).toBeGreaterThanOrEqual(2);
      expect(activeStyle.borderBottomColor).not.toBe(inactiveStyle.borderBottomColor);
      expect(activeStyle.borderBottomColor).not.toMatch(/rgba\(.*,\s*0\)$/);
      // …and a second, non-color signal: a heavier weight.
      expect(activeStyle.fontWeight).toBeGreaterThan(inactiveStyle.fontWeight);
      // It is NOT the old large dark filled rectangle.
      const activeBg = await active.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(activeBg).not.toBe("rgb(30, 41, 59)");
    });

    test("keeps the 후보지 분석 segmented control in one position across all three sub-views", async ({
      page,
    }) => {
      const positions: { label: string; box: { x: number; y: number; width: number } }[] = [];

      for (const [view, label] of [
        ["score", "후보지 점수"],
        ["scenario", "가중치 바꿔보기"],
        ["cost", "비용 살펴보기"],
      ] as const) {
        await gotoView(page, `/?v=1&mode=suitability&view=${view}`);

        // Exactly one control, and exactly one of each segment — never a sidebar
        // copy plus a full-width copy.
        await expect(page.getByTestId("suitability-subviews"), label).toHaveCount(1);
        for (const testId of SUBVIEW_TEST_IDS) {
          await expect(page.getByTestId(testId), `${label}: ${testId}`).toHaveCount(1);
        }
        await expect(page.getByTestId(`suitability-view-${view}`)).toHaveAttribute(
          "aria-pressed",
          "true",
        );

        const box = (await page.getByTestId("suitability-subviews").boundingBox())!;
        // It sits directly below the navigation, never above it.
        const nav = await navBox(page);
        expect(box.y, `${label}: below the nav`).toBeGreaterThanOrEqual(nav.y + nav.height - 2);
        positions.push({ label, box: { x: box.x, y: box.y, width: box.width } });

        await expectNoHorizontalOverflow(page);
      }

      // Identical placement in all three sub-views.
      for (const position of positions.slice(1)) {
        expect(position.box.x, `${position.label}: x`).toBeCloseTo(positions[0].box.x, 0);
        expect(position.box.y, `${position.label}: y`).toBeCloseTo(positions[0].box.y, 0);
        expect(position.box.width, `${position.label}: width`).toBeCloseTo(
          positions[0].box.width,
          0,
        );
      }
    });

    test("renders no segmented control outside 후보지 분석", async ({ page }) => {
      for (const query of ["/?v=1&mode=equity", "/?v=1&mode=flow", "/?v=1&mode=transparency"]) {
        await gotoView(page, query);
        await expect(page.getByTestId("suitability-subviews"), query).toHaveCount(0);
        for (const testId of SUBVIEW_TEST_IDS) {
          await expect(page.getByTestId(testId), `${query}: ${testId}`).toHaveCount(0);
        }
      }
    });

    test("fills the remaining viewport height with the map — no strip below it", async ({
      page,
    }) => {
      // Both map modes: the global header must not break the `.map-pane` height chain.
      for (const query of ["/?v=1&mode=equity", "/?v=1&mode=suitability&view=score"]) {
        await gotoView(page, query);

        const map = page.getByTestId("map-container");
        await expect(map).toBeVisible();
        const mapBox = (await map.boundingBox())!;

        // Starts immediately below the shared chrome (nav, plus the sub-view bar in
        // 후보지 분석) with no gap…
        const chrome = page.getByTestId("suitability-subviews");
        const chromeBox =
          (await chrome.count()) > 0 ? (await chrome.boundingBox())! : await navBox(page);
        const chromeBottom = chromeBox.y + chromeBox.height;
        expect(mapBox.y, `${query}: no gap below chrome`).toBeGreaterThanOrEqual(chromeBottom - 2);
        expect(mapBox.y, `${query}: starts at chrome bottom`).toBeLessThanOrEqual(chromeBottom + 2);

        // …and reaches the viewport bottom, leaving no empty/black strip.
        expect(mapBox.y + mapBox.height, `${query}: reaches bottom`).toBeGreaterThanOrEqual(
          vp.height - 6,
        );
        expect(mapBox.y + mapBox.height, `${query}: no overshoot`).toBeLessThanOrEqual(
          vp.height + 6,
        );
        // Still the dominant surface, not the ~60% mobile height.
        expect(mapBox.height, `${query}: dominant height`).toBeGreaterThan(vp.height * 0.75);

        // The floating legend stays inside the map bounds. `map-legend` is the
        // shared overlay container — the equity choropleth legend (`legend`) and the
        // suitability status legend (`suitability-legend`) render inside it.
        const legend = page.getByTestId("map-legend");
        await expect(legend).toBeVisible();
        const legendBox = (await legend.boundingBox())!;
        expect(legendBox.x).toBeGreaterThanOrEqual(mapBox.x - 2);
        expect(legendBox.y).toBeGreaterThanOrEqual(mapBox.y - 2);
        expect(legendBox.x + legendBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 2);
        expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height + 2);

        await expectNoHorizontalOverflow(page);
      }
    });

    test("keeps the map-free pages full-width and map-free", async ({ page }) => {
      for (const [query, testId] of [
        ["/?v=1&mode=suitability&view=cost", "facility-cost-dashboard"],
        ["/?v=1&mode=flow", "landfill-dashboard"],
        ["/?v=1&mode=transparency", "transparency-sources"],
      ] as const) {
        await gotoView(page, query);
        await expect(page.getByTestId("map-container"), query).toHaveCount(0);

        const content = page.getByTestId(testId);
        await expect(content).toBeVisible();
        const box = (await content.boundingBox())!;
        // Full-width: the content spans the viewport apart from its own gutters.
        expect(box.width, `${query}: full-width`).toBeGreaterThan(vp.width * 0.9);
        // And there is no sidebar beside it.
        await expect(page.locator("aside"), query).toHaveCount(0);

        await expectNoHorizontalOverflow(page);
      }
    });

    test("reaches every navigation button by keyboard, after the skip link", async ({ page }) => {
      await gotoView(page, "/");

      // The skip link is still the very first focusable element…
      await page.keyboard.press("Tab");
      await expect(page.locator("a.skip-link")).toBeFocused();

      // …and activating it still moves focus to the single main-content target.
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("main-content");

      // From the skip link, Tab reaches all four navigation buttons in order.
      await page.locator("a.skip-link").focus();
      const reached: string[] = [];
      for (let i = 0; i < 8 && reached.length < MODE_TEST_IDS.length; i += 1) {
        await page.keyboard.press("Tab");
        const testId = await page.evaluate(() =>
          document.activeElement?.getAttribute("data-testid"),
        );
        if (testId && MODE_TEST_IDS.includes(testId)) reached.push(testId);
      }
      expect(reached).toEqual(MODE_TEST_IDS);

      // The focused control shows a visible focus indicator.
      const outlineWidth = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? parseFloat(getComputedStyle(el).outlineWidth) : 0;
      });
      expect(outlineWidth).toBeGreaterThanOrEqual(2);
    });
  });
}
