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

/**
 * The SIX visible destinations, in nav/DOM order. These are the pre-existing
 * testids (see lib/glossary.ts): `mode-suitability` is 후보지 심층 분석, and
 * `suitability-view-cost` / `-scenario` are 후보지 분석 / 후보지 심층 비교.
 */
const MODE_TEST_IDS = [
  "mode-equity",
  "mode-flow",
  "suitability-view-cost",
  "mode-suitability",
  "suitability-view-scenario",
  "mode-transparency",
];
const MODE_LABELS = [
  "지역 지표",
  "폐기물 처리 현황",
  "후보지 분석",
  "후보지 심층 분석",
  "후보지 심층 비교",
  "데이터·출처",
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

    test("shows all six navigation buttons on a single unwrapped line", async ({ page }) => {
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
      // The nav TRACK is one line tall — its height is one button's height plus the
      // track's own padding. (The assertion used to compare against the whole app
      // bar; since the Figma redesign the bar is 78px around a 50px track holding
      // 38px pills, so the bar/button ratio no longer measures wrapping. The track
      // is what would grow if the six labels wrapped.)
      const track = (await page.getByTestId("mode-switch").boundingBox())!;
      expect(track.height).toBeLessThan(boxes[0].height * 1.8);

      await expectNoHorizontalOverflow(page);
    });

    test("renders exactly one navigation, in the same position, in every mode", async ({
      page,
    }) => {
      await gotoView(page, "/");
      const reference = await navBox(page);

      const views = [
        { query: "/?v=1&mode=equity", label: "지역 지표" },
        { query: "/?v=1&mode=suitability&view=score", label: "후보지 심층 분석" },
        { query: "/?v=1&mode=suitability&view=scenario", label: "후보지 심층 비교" },
        { query: "/?v=1&mode=suitability&view=cost", label: "후보지 분석" },
        { query: "/?v=1&mode=flow", label: "폐기물 처리 현황" },
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

    /**
     * The active-state IDIOM changed with the Figma redesign: a 2px bottom
     * indicator became a white pill on the grey nav track (frame 74:2000). The
     * requirement it was written for did not change — state must carry more than
     * colour — so the assertions now measure the pill and the weight rather than a
     * border that the design no longer draws.
     */
    test("marks the active mode with a pill and a weight, not color alone", async ({ page }) => {
      await gotoView(page, "/?v=1&mode=flow");

      const active = page.getByTestId("mode-flow");
      const inactive = page.getByTestId("mode-equity");

      await expect(active).toHaveAttribute("aria-pressed", "true");
      await expect(inactive).toHaveAttribute("aria-pressed", "false");

      const styles = async (locator: ReturnType<Page["getByTestId"]>) =>
        locator.evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            backgroundColor: s.backgroundColor,
            boxShadow: s.boxShadow,
            fontWeight: Number(s.fontWeight),
            borderRadius: parseFloat(s.borderTopLeftRadius),
          };
        });

      const activeStyle = await styles(active);
      const inactiveStyle = await styles(inactive);

      // A real, filled pill under the active tab — a SHAPE, present vs absent…
      expect(activeStyle.backgroundColor).not.toBe(inactiveStyle.backgroundColor);
      expect(activeStyle.backgroundColor).not.toMatch(/rgba\(.*,\s*0\)$/);
      expect(activeStyle.borderRadius).toBeGreaterThanOrEqual(inactiveStyle.borderRadius);
      // …carrying a visible edge, because white on the #F9F9F9 track alone is not a
      // dependable boundary…
      expect(activeStyle.boxShadow).not.toBe("none");
      // …and a second, non-colour signal: a heavier weight.
      expect(activeStyle.fontWeight).toBeGreaterThan(inactiveStyle.fontWeight);
      // It is NOT the old large dark filled rectangle.
      expect(activeStyle.backgroundColor).not.toBe("rgb(30, 41, 59)");
    });

    test("renders no sub-view bar anywhere — the six destinations replace it", async ({
      page,
    }) => {
      // The three suitability sub-views are top-level destinations now, so the old
      // segmented control would be a SECOND control writing the same `view` state
      // (docs/YEOGIDA_UI_REDESIGN_SPEC.md §2.1). It is gone in every area.
      for (const query of [
        "/?v=1&mode=equity",
        "/?v=1&mode=flow",
        "/?v=1&mode=transparency",
        "/?v=1&mode=suitability&view=score",
        "/?v=1&mode=suitability&view=scenario",
        "/?v=1&mode=suitability&view=cost",
      ]) {
        await gotoView(page, query);
        await expect(page.getByTestId("suitability-subviews"), query).toHaveCount(0);
        // The nav is the only place the six destinations live.
        const group = page.getByTestId("mode-switch");
        await expect(group.locator("button"), query).toHaveCount(6);
        for (const testId of MODE_TEST_IDS) {
          await expect(group.getByTestId(testId), `${query}: ${testId}`).toHaveCount(1);
        }
      }
    });

    test("reaches each suitability destination in ONE click, and presses only it", async ({
      page,
    }) => {
      await gotoView(page, "/?v=1&mode=equity");

      for (const [testId, expected] of [
        ["suitability-view-cost", "facility-cost-dashboard"],
        ["suitability-view-scenario", "scenario-lab"],
        ["mode-suitability", "suitability-summary"],
      ] as const) {
        // One click from wherever we are — no "enter the area, then pick a sub-view".
        await page.getByTestId(testId).click();
        await expect(page.getByTestId(expected)).toBeVisible({ timeout: 15000 });

        // Exactly one destination is pressed. The three suitability destinations
        // share `mode=suitability`, so a mode-only active rule would press all three.
        const pressed: string[] = [];
        for (const id of MODE_TEST_IDS) {
          if ((await page.getByTestId(id).getAttribute("aria-pressed")) === "true") pressed.push(id);
        }
        expect(pressed, `${testId}: exactly one pressed`).toEqual([testId]);

        await expectNoHorizontalOverflow(page);
      }
    });

    test("fills the remaining viewport height with the map — no strip below it", async ({
      page,
    }) => {
      /**
       * The two map modes, with the top inset each one is DRAWN with.
       *
       * This assertion used to demand `mapBox.y === chromeBottom` for both, and
       * failed on 후보지 심층 분석 at 1440 (99 observed against 81 allowed). Checked
       * against the canonical Figma file, the product is right and the assertion was
       * wrong — the two frames genuinely differ:
       *
       *   - 지역 지표 (74:1992): Header h=78, a 1px Divider, then Body at y=79, and
       *     "Main / Map Area" is a child of Body at y=79 — full-bleed, flush with the
       *     chrome. Inset 0.
       *   - 후보지 심층 분석 (136:8684): Header h=78, 1px rule, Body at y=79 — but the
       *     workspace "Grid" inside it starts at y=99. The map there is a rounded
       *     surface SET INTO the canvas, not a full-bleed rectangle, so it carries a
       *     20px top inset. That is exactly `.wep-workspace-map { padding-top: 1.25rem }`
       *     in globals.css, deliberately scoped to `min-width: 1440px` (the same block
       *     that sets the 396/376 panel widths) because at 1280 the 20px of lost height
       *     would push the expanded insight card past its map-dominance bound.
       *
       * So the inset is 20 only for the deep-analysis workspace at ≥1440, and 0
       * everywhere else. Asserting one flush number for both was the stale part.
       */
      const MAPS = [
        { query: "/?v=1&mode=equity", topInset: 0 },
        {
          query: "/?v=1&mode=suitability&view=score",
          topInset: vp.width >= 1440 ? 20 : 0,
        },
      ];

      // Both map modes: the global header must not break the `.map-pane` height chain.
      for (const { query, topInset } of MAPS) {
        await gotoView(page, query);

        const map = page.getByTestId("map-container");
        await expect(map).toBeVisible();
        const mapBox = (await map.boundingBox())!;

        // Starts immediately below the shared chrome, plus only the inset that frame
        // is drawn with. Since the sub-view bar was retired the nav is the ONLY chrome
        // above the map, in every area — which is also why the map is taller than it
        // used to be.
        await expect(page.getByTestId("suitability-subviews")).toHaveCount(0);
        const chromeBox = await navBox(page);
        const expectedTop = chromeBox.y + chromeBox.height + topInset;
        expect(mapBox.y, `${query}: no gap below chrome`).toBeGreaterThanOrEqual(expectedTop - 2);
        expect(mapBox.y, `${query}: starts at chrome bottom`).toBeLessThanOrEqual(expectedTop + 2);

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
      // 데이터·출처 is deliberately absent: it is a DIALOG over the previous
      // destination now (spec §8), so it is neither a page nor map-free, and it
      // is covered by its own suites. These two remain genuine full-width pages.
      for (const [query, testId] of [
        ["/?v=1&mode=suitability&view=cost", "facility-cost-dashboard"],
        ["/?v=1&mode=flow", "landfill-dashboard"],
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

      // From the skip link, Tab reaches all six navigation buttons in order.
      await page.locator("a.skip-link").focus();
      const reached: string[] = [];
      for (let i = 0; i < 12 && reached.length < MODE_TEST_IDS.length; i += 1) {
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
