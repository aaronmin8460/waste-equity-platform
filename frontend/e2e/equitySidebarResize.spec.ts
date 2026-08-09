import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { mockEquityBackend } from "./phase4Fixtures";

/**
 * 지역 지표 resizable control column — the real-browser half of the contract
 * (docs/YEOGIDA_UI_REDESIGN_SPEC.md §3).
 *
 * `src/components/ui/ResizableSidebar.test.tsx` covers the arithmetic, the
 * corrupted-storage paths, and the keyboard contract in jsdom. What can only be
 * asserted here is everything that needs layout and a real pointer: that a drag
 * actually moves the divider, that the map keeps up with it, and that the map is
 * neither remounted nor left with a stale canvas.
 *
 * Self-mocked through `mockBackend`, so no backend, database, or tile server is
 * required. No assertion depends on a served value.
 */

const MIN = 300;
const DEFAULT = 360;
const MAX = 520;

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

/** Open 지역 지표 and wait for the map, not merely for the shell. */
async function gotoEquity(page: Page): Promise<void> {
  await page.goto("/?v=1&mode=equity");
  await expect(page.getByTestId("mode-switch")).toBeVisible();
  await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
}

async function sidebarWidth(page: Page): Promise<number> {
  return Math.round((await page.getByTestId("equity-sidebar").boundingBox())!.width);
}

/** Drag the divider to an absolute viewport x, in a few steps like a real cursor. */
async function dragTo(page: Page, x: number): Promise<void> {
  const handle = page.getByTestId("sidebar-resizer");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe("desktop 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("opens at 360px and offers a comfortable hit target", async ({ page }) => {
    await gotoEquity(page);
    expect(await sidebarWidth(page)).toBeGreaterThanOrEqual(DEFAULT - 2);
    expect(await sidebarWidth(page)).toBeLessThanOrEqual(DEFAULT + 2);

    // The visible seam may be a hairline, but the grabbable band must not be.
    const handleBox = (await page.getByTestId("sidebar-resizer").boundingBox())!;
    expect(handleBox.width).toBeGreaterThanOrEqual(8);
    expect(handleBox.width).toBeLessThanOrEqual(12);
    // And the cursor says "resize horizontally".
    await expect(page.getByTestId("sidebar-resizer")).toHaveCSS("cursor", "col-resize");
  });

  test("a pointer drag resizes the column and the map follows it", async ({ page }) => {
    await gotoEquity(page);
    const mapBefore = (await page.getByTestId("map-container").boundingBox())!;

    await dragTo(page, 480);
    const widened = await sidebarWidth(page);
    expect(widened).toBeGreaterThan(DEFAULT + 40);
    expect(widened).toBeLessThanOrEqual(MAX);

    // The map gave up exactly the width the column took, and still starts right
    // after the divider — no gap opened between them.
    const mapAfter = (await page.getByTestId("map-container").boundingBox())!;
    expect(mapAfter.width).toBeLessThan(mapBefore.width - 40);
    const asideBox = (await page.getByTestId("equity-sidebar").boundingBox())!;
    const handleBox = (await page.getByTestId("sidebar-resizer").boundingBox())!;
    expect(mapAfter.x).toBeGreaterThanOrEqual(asideBox.x + asideBox.width - 2);
    expect(mapAfter.x).toBeLessThanOrEqual(handleBox.x + handleBox.width + 2);
  });

  test("clamps a drag past either bound", async ({ page }) => {
    await gotoEquity(page);
    // Far past the maximum…
    await dragTo(page, 1200);
    expect(await sidebarWidth(page)).toBeLessThanOrEqual(MAX + 2);
    expect(await sidebarWidth(page)).toBeGreaterThanOrEqual(MAX - 2);
    // …and far past the minimum.
    await dragTo(page, 40);
    expect(await sidebarWidth(page)).toBeGreaterThanOrEqual(MIN - 2);
    expect(await sidebarWidth(page)).toBeLessThanOrEqual(MIN + 2);
  });

  test("keeps the MapLibre canvas exactly the size of its pane after a resize", async ({
    page,
  }) => {
    await gotoEquity(page);
    await dragTo(page, 500);
    // Give MapView's existing rAF-coalesced ResizeObserver a frame to run.
    await page.waitForTimeout(400);

    // A stale canvas is the classic symptom: the pane shrinks but the CSS canvas
    // keeps its old width, leaving a stretched map and a blank strip.
    const drift = await page.evaluate(() => {
      const pane = document.querySelector(".map-pane") as HTMLElement | null;
      const canvas = document.querySelector(".maplibregl-canvas") as HTMLElement | null;
      if (!pane || !canvas) return null;
      const p = pane.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      return { dw: Math.abs(p.width - c.width), dh: Math.abs(p.height - c.height) };
    });
    // The mocked run has no tile server, so a canvas may legitimately be absent;
    // when it exists it must track its pane.
    if (drift !== null) {
      expect(drift.dw, "canvas width tracks the pane").toBeLessThanOrEqual(2);
      expect(drift.dh, "canvas height tracks the pane").toBeLessThanOrEqual(2);
    }

    // And the pane still reaches the viewport bottom — no strip below the map.
    const mapBox = (await page.getByTestId("map-container").boundingBox())!;
    expect(mapBox.y + mapBox.height).toBeGreaterThanOrEqual(900 - 6);
  });

  test("never remounts the map while resizing", async ({ page }) => {
    await gotoEquity(page);
    // Tag the live node. A remount replaces the element, so the tag disappears.
    await page.evaluate(() => {
      document.querySelector('[data-testid="map-container"]')!.setAttribute("data-drag-tag", "1");
    });

    await dragTo(page, 470);
    await dragTo(page, 320);
    await page.getByTestId("sidebar-resizer").focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Home");

    await expect(page.locator('[data-testid="map-container"][data-drag-tag="1"]')).toHaveCount(1);
    await expect(page.getByTestId("map-container")).toHaveCount(1);
  });

  test("is fully operable from the keyboard", async ({ page }) => {
    await gotoEquity(page);
    const handle = page.getByTestId("sidebar-resizer");
    await handle.focus();
    await expect(handle).toBeFocused();
    // Focus is visible, not silent.
    const outline = await handle.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth));
    expect(outline).toBeGreaterThanOrEqual(2);

    await page.keyboard.press("End");
    expect(await sidebarWidth(page)).toBeGreaterThanOrEqual(MAX - 2);
    await expect(handle).toHaveAttribute("aria-valuenow", String(MAX));

    await page.keyboard.press("Home");
    expect(await sidebarWidth(page)).toBeLessThanOrEqual(MIN + 2);
    await expect(handle).toHaveAttribute("aria-valuenow", String(MIN));

    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", String(MIN + 16));
  });

  test("double-click restores the 360px default", async ({ page }) => {
    await gotoEquity(page);
    await dragTo(page, 500);
    expect(await sidebarWidth(page)).toBeGreaterThan(DEFAULT + 40);

    await page.getByTestId("sidebar-resizer").dblclick();
    expect(await sidebarWidth(page)).toBeGreaterThanOrEqual(DEFAULT - 2);
    expect(await sidebarWidth(page)).toBeLessThanOrEqual(DEFAULT + 2);
  });

  test("remembers the width across a reload, and repairs a corrupted one", async ({ page }) => {
    await gotoEquity(page);
    await page.getByTestId("sidebar-resizer").focus();
    await page.keyboard.press("End");
    expect(await sidebarWidth(page)).toBeGreaterThanOrEqual(MAX - 2);

    await page.reload();
    await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
    expect(await sidebarWidth(page), "restored from localStorage").toBeGreaterThanOrEqual(MAX - 2);

    // A hand-edited / corrupted store must not produce a broken column.
    await page.evaluate(() =>
      window.localStorage.setItem("yeogida.equity.sidebarWidth", "not-a-number"),
    );
    await page.reload();
    await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
    expect(await sidebarWidth(page), "falls back to the default").toBeGreaterThanOrEqual(
      DEFAULT - 2,
    );
    expect(await sidebarWidth(page)).toBeLessThanOrEqual(DEFAULT + 2);

    // An out-of-range store is clamped, not obeyed.
    await page.evaluate(() => window.localStorage.setItem("yeogida.equity.sidebarWidth", "9000"));
    await page.reload();
    await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
    expect(await sidebarWidth(page)).toBeLessThanOrEqual(MAX + 2);
  });

  test("resizing keeps the page free of horizontal scrolling", async ({ page }) => {
    await gotoEquity(page);
    for (const x of [520, 300, 480]) {
      await dragTo(page, x);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `no page overflow at drag ${x}`).toBeLessThanOrEqual(clientWidth + 1);
    }
  });

  test("preserves the selected region across a resize", async ({ page }) => {
    // `mockBackend` deliberately serves EMPTY map envelopes, so it has no regions
    // to select. The populated equity fixture is the one that does — this is the
    // only test in the file that needs served values, and it asserts only that
    // the selection SURVIVES, never what the value is.
    await mockEquityBackend(page);
    await page.goto("/?v=1&mode=equity");
    await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });

    // Pick a region through the keyboard path. `region-select` IS the <select>.
    await page.getByTestId("region-select").selectOption("KR-SGIS-11680");
    await expect(page.getByTestId("selected-region-name")).toHaveText("강남구");

    await dragTo(page, 470);
    await page.getByTestId("sidebar-resizer").dblclick();

    // Resizing is a layout gesture: it must not disturb analytical state.
    await expect(page.getByTestId("selected-region-name")).toHaveText("강남구");
    await expect(page.getByTestId("region-select")).toHaveValue("KR-SGIS-11680");
  });
});

test.describe("small desktop 1024×800 — the minimum supported width", () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test("still allows the full 300–520 range without crowding the map out", async ({ page }) => {
    await gotoEquity(page);
    await dragTo(page, 900);
    const widest = await sidebarWidth(page);
    expect(widest).toBeLessThanOrEqual(MAX + 2);
    // Even at the widest setting the map keeps a usable share of the row.
    const mapBox = (await page.getByTestId("map-container").boundingBox())!;
    expect(mapBox.width).toBeGreaterThan(1024 - MAX - 40);
    expect(mapBox.y + mapBox.height).toBeGreaterThanOrEqual(800 - 6);
  });
});

test.describe("mobile 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("has no resize handle and no desktop width", async ({ page }) => {
    await gotoEquity(page);
    // Hidden by CSS below md, so there is nothing to drag and nothing to focus.
    await expect(page.getByTestId("sidebar-resizer")).toBeHidden();

    const asideBox = (await page.getByTestId("equity-sidebar").boundingBox())!;
    expect(asideBox.width).toBeGreaterThan(390 - 4);

    // A stored DESKTOP preference must not leak into the phone column.
    await page.evaluate(() => window.localStorage.setItem("yeogida.equity.sidebarWidth", "300"));
    await page.reload();
    await expect(page.getByTestId("equity-sidebar")).toBeVisible();
    const after = (await page.getByTestId("equity-sidebar").boundingBox())!;
    expect(after.width, "phone column stays full-width").toBeGreaterThan(390 - 4);
  });
});
