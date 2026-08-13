import { expect, test, type Page } from "@playwright/test";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * 후보지 심층 분석 — the collapsible workspace's ONE promise: the width a panel
 * gives up goes to the map.
 *
 * Why this file exists. `docs/YEOGIDA_UI_REDESIGN_SPEC.md` §6 says both columns
 * "collapse independently, reopen easily, and give freed space to the map — with
 * correct MapLibre resize and no remount". Nothing measured that. The visual review
 * after the production release found the second half broken at wide desktop widths:
 * both columns collapsed (their bodies disappeared) while the columns themselves
 * kept their open width, so the map never grew. The cause was a pure CSS cascade
 * accident — `.wep-panel { width: 21rem }` in the ≥1280px block came AFTER
 * `.wep-panel-collapsed { width: 3rem }` in the ≥768px block at equal specificity,
 * so above 1280px the collapsed rail lost. Class names alone could never have caught
 * that: the element had the right class the whole time.
 *
 * So every assertion here MEASURES BOUNDING BOXES. `expect(...).toHaveClass` is
 * deliberately absent.
 *
 * Self-mocked through `suitabilityFixtures.mockSuitabilityBackend` — no backend, no
 * database, no tile server, no government API. Structure and geometry only; never a
 * fixture value.
 */

/** The collapsed rail is 3rem; allow a hairline border and sub-pixel rounding. */
const RAIL_WIDTH = 48;

async function openDeepAnalysis(page: Page): Promise<void> {
  await mockSuitabilityBackend(page);
  await page.goto("/?v=1&mode=suitability&view=score");
  await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("deep-left-panel")).toBeVisible();
  await expect(page.getByTestId("deep-right-panel")).toBeVisible();
}

async function mapWidth(page: Page): Promise<number> {
  return (await page.getByTestId("map-container").boundingBox())!.width;
}

async function panelWidth(page: Page, testId: string): Promise<number> {
  return (await page.getByTestId(testId).boundingBox())!.width;
}

/** Toggle a column and wait for the 0.16s width transition to settle. */
async function toggle(page: Page, testId: string): Promise<void> {
  await page.getByTestId(`${testId}-toggle`).click();
  await page.waitForTimeout(400);
}

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${where}: no page-level horizontal overflow`).toBeLessThanOrEqual(
    clientWidth + 1,
  );
}

/**
 * Stamp the live map container and its MapLibre canvas with a property that only
 * survives if the very same DOM nodes stay mounted. A remount (a `key` change, a
 * conditional unmount, a re-created MapView) produces fresh nodes with no stamp.
 * An attribute would be reproduced by React on re-render; an expando property on
 * the element object cannot be.
 */
async function stampMapNodes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const container = document.querySelector('[data-testid="map-container"]');
    const canvas = document.querySelector(".maplibregl-canvas");
    if (container) (container as unknown as Record<string, unknown>).__wepMapStamp = "container";
    if (canvas) (canvas as unknown as Record<string, unknown>).__wepMapStamp = "canvas";
  });
}

async function readMapStamps(page: Page): Promise<{ container: unknown; canvas: unknown }> {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="map-container"]');
    const canvas = document.querySelector(".maplibregl-canvas");
    return {
      container: container
        ? (container as unknown as Record<string, unknown>).__wepMapStamp ?? null
        : "MISSING",
      canvas: canvas ? (canvas as unknown as Record<string, unknown>).__wepMapStamp ?? null : null,
    };
  });
}

// --------------------------------------------------------------------------- //
// 1440×900 — the width the visual review was done at
// --------------------------------------------------------------------------- //

test.describe("후보지 심층 분석 panel collapse at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("hands every collapsed column's width to the map", async ({ page }) => {
    await openDeepAnalysis(page);

    const bothOpen = await mapWidth(page);
    await expectNoHorizontalOverflow(page, "both open");

    // LEFT collapsed — the rail really shrinks, and the map really grows.
    await toggle(page, "deep-left-panel");
    const leftRail = await panelWidth(page, "deep-left-panel");
    expect(leftRail, "collapsed left column is a rail, not a full column").toBeLessThanOrEqual(
      RAIL_WIDTH + 2,
    );
    const leftClosed = await mapWidth(page);
    expect(
      leftClosed - bothOpen,
      "the map takes the width the left column gave up",
    ).toBeGreaterThan(200);
    await expectNoHorizontalOverflow(page, "left collapsed");

    // Reopening gives it back.
    await toggle(page, "deep-left-panel");
    const reopened = await mapWidth(page);
    expect(Math.abs(reopened - bothOpen), "reopening restores the original map width").toBeLessThan(
      2,
    );

    // RIGHT collapsed — the mirror image.
    await toggle(page, "deep-right-panel");
    const rightRail = await panelWidth(page, "deep-right-panel");
    expect(rightRail, "collapsed right column is a rail").toBeLessThanOrEqual(RAIL_WIDTH + 2);
    const rightClosed = await mapWidth(page);
    expect(
      rightClosed - bothOpen,
      "the map takes the width the right column gave up",
    ).toBeGreaterThan(200);
    await expectNoHorizontalOverflow(page, "right collapsed");

    // BOTH collapsed — the widest state of all, and wider than either alone.
    await toggle(page, "deep-left-panel");
    const bothClosed = await mapWidth(page);
    expect(bothClosed, "both collapsed is wider than left-only").toBeGreaterThan(leftClosed);
    expect(bothClosed, "both collapsed is wider than right-only").toBeGreaterThan(rightClosed);
    expect(bothClosed - bothOpen, "both columns' width is now the map's").toBeGreaterThan(400);
    await expectNoHorizontalOverflow(page, "both collapsed");

    // The panels are still there as rails, so the reader can reopen them.
    await expect(page.getByTestId("deep-left-panel-toggle")).toBeVisible();
    await expect(page.getByTestId("deep-right-panel-toggle")).toBeVisible();
  });

  test("never remounts the map while panels collapse and reopen", async ({ page }) => {
    await openDeepAnalysis(page);
    await stampMapNodes(page);
    const before = await readMapStamps(page);
    expect(before.container, "the stamp was applied").toBe("container");

    await toggle(page, "deep-left-panel");
    await toggle(page, "deep-right-panel");
    await toggle(page, "deep-left-panel");
    await toggle(page, "deep-right-panel");

    const after = await readMapStamps(page);
    expect(after.container, "the SAME map container node stayed mounted").toBe("container");
    if (before.canvas === "canvas") {
      expect(after.canvas, "the SAME MapLibre canvas stayed mounted").toBe("canvas");
    }
    // And exactly one map exists — a remount that left the old node behind would
    // show up here even if the stamp somehow survived.
    await expect(page.getByTestId("map-container")).toHaveCount(1);
  });

  test("keeps the map controls and the legend operable in every collapse state", async ({
    page,
  }) => {
    await openDeepAnalysis(page);

    for (const state of ["both open", "left collapsed", "both collapsed"] as const) {
      if (state === "left collapsed") await toggle(page, "deep-left-panel");
      if (state === "both collapsed") await toggle(page, "deep-right-panel");

      const mapBox = (await page.getByTestId("map-container").boundingBox())!;
      const legend = page.getByTestId("map-legend");
      await expect(legend, `${state}: legend visible`).toBeVisible();
      const legendBox = (await legend.boundingBox())!;
      // The legend rides with the map rather than being clipped outside it.
      expect(legendBox.x, `${state}: legend inside the map`).toBeGreaterThanOrEqual(mapBox.x - 2);
      expect(
        legendBox.x + legendBox.width,
        `${state}: legend inside the map`,
      ).toBeLessThanOrEqual(mapBox.x + mapBox.width + 2);

      const nav = page.locator(".maplibregl-ctrl-top-right");
      if ((await nav.count()) > 0) {
        const navBox = (await nav.boundingBox())!;
        expect(navBox.x, `${state}: map controls inside the map`).toBeGreaterThanOrEqual(
          mapBox.x - 2,
        );
        expect(
          navBox.x + navBox.width,
          `${state}: map controls inside the map`,
        ).toBeLessThanOrEqual(mapBox.x + mapBox.width + 2);
      }
    }
  });
});

// --------------------------------------------------------------------------- //
// 1024×768 — the minimum supported desktop
// --------------------------------------------------------------------------- //

test.describe("후보지 심층 분석 panel collapse at 1024×768", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("still hands both columns' width to the map, with nothing clipped", async ({ page }) => {
    await openDeepAnalysis(page);
    const bothOpen = await mapWidth(page);
    await expectNoHorizontalOverflow(page, "1024 both open");

    await toggle(page, "deep-left-panel");
    await toggle(page, "deep-right-panel");

    expect(await panelWidth(page, "deep-left-panel")).toBeLessThanOrEqual(RAIL_WIDTH + 2);
    expect(await panelWidth(page, "deep-right-panel")).toBeLessThanOrEqual(RAIL_WIDTH + 2);

    const bothClosed = await mapWidth(page);
    expect(bothClosed - bothOpen, "the map grows by both columns' width").toBeGreaterThan(300);
    await expectNoHorizontalOverflow(page, "1024 both collapsed");

    // The overlays still stack inside the widened map instead of colliding: the
    // legend sits above the insight card, both within the map's bounds.
    const mapBox = (await page.getByTestId("map-container").boundingBox())!;
    const legendBox = (await page.getByTestId("map-legend").boundingBox())!;
    const stripBox = (await page.getByTestId("suitability-insight-strip").boundingBox())!;
    expect(legendBox.y + legendBox.height, "legend clears the insight strip").toBeLessThanOrEqual(
      stripBox.y + 1,
    );
    expect(stripBox.x + stripBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 2);
    expect(legendBox.x).toBeGreaterThanOrEqual(mapBox.x - 2);
  });
});
