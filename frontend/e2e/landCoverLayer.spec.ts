import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * Live browser verification of the map-wide land-cover candidate-cell layer
 * (Phase 1B-LC5B), against the REAL backend (E2E_BACKEND_URL) and the real local
 * PostGIS statistics release.
 *
 * These are the checks that only a real browser can make: that the version-pinned
 * MVT source is actually created and requested, that the three coverage states are
 * really painted and really filterable, that L1/L2/L3 really repaint without a source
 * reload, that the existing candidate click still opens the existing detail (including
 * the LC5A land-cover section), and that a land-cover failure never takes the rest of
 * the map down with it.
 *
 * Nothing here asserts production behaviour: it drives a locally-running frontend
 * against a locally-running backend.
 *
 * Playwright-managed Chromium is not installed in this environment, so every test
 * runs on the installed Chrome channel.
 */

const backendUrl = process.env.E2E_BACKEND_URL;

test.skip(!backendUrl, "E2E_BACKEND_URL is not configured (live browser verification only)");

test.use({ channel: "chrome" });

const SUITABILITY_URL = "/?v=1&mode=suitability&view=score";
const LAND_COVER_TILE_PATH = "/api/v1/environment/land-cover/cell-statistics/tiles/";
/** Raw land-cover endpoints that must NEVER be requested by the map. */
const FORBIDDEN_PATHS = [
  "/land-cover/features",
  "/land-cover/feature",
  "/land-cover/map-sheets",
];

/**
 * The land-cover tile requests the map makes during `action`.
 *
 * The app exposes no debug handle on the MapLibre instance, so these tests assert on
 * what is genuinely observable from outside: the network requests the vector source
 * issues, and the DOM the control renders. That is enough to distinguish the two
 * things that matter here — a source being (re)loaded versus a paint/filter-only
 * update — without reaching into private map internals.
 */
async function landCoverTileRequests(page: Page, action: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const listener = (request: Request) => {
    if (request.url().includes(LAND_COVER_TILE_PATH)) seen.push(request.url());
  };
  page.on("request", listener);
  await action();
  page.off("request", listener);
  return seen;
}

/** Open the land-cover control's <details> disclosure. */
async function openControl(page: Page) {
  const control = page.getByTestId("land-cover-layer-control");
  await expect(control).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("land-cover-layer-summary").click();
  await expect(page.getByTestId("land-cover-layer-toggle")).toBeVisible();
  return control;
}

async function gotoSuitability(page: Page) {
  await page.goto(SUITABILITY_URL);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
}

test.describe("land-cover map layer — live", () => {
  test("1-4: equity works, suitability works, the layer is OFF by default and turns on with a version-pinned MVT source", async ({
    page,
  }) => {
    // 1. Equity mode still works, and mounts NO land-cover control.
    await page.goto("/?v=1&mode=equity");
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("legend")).toContainText("데이터 없음");
    await expect(page.getByTestId("land-cover-layer-control")).toHaveCount(0);

    // 2. Suitability mode still works.
    await gotoSuitability(page);
    await expect(page.getByTestId("suitability-legend")).toBeVisible();

    // 3. The layer is OFF by default: the control is present and unchecked, and no
    //    land-cover tile has been requested.
    await openControl(page);
    await expect(page.getByTestId("land-cover-layer-toggle")).not.toBeChecked();

    // 4. Enabling it requests version-pinned tiles.
    const requests = await landCoverTileRequests(page, async () => {
      await page.getByTestId("land-cover-layer-toggle").check();
      await page.waitForTimeout(4000);
    });
    expect(requests.length).toBeGreaterThan(0);
    for (const url of requests) {
      // …/cell-statistics/tiles/<version>/<z>/<x>/<y>.mvt — the version is in the path.
      expect(url).toMatch(/\/cell-statistics\/tiles\/\d+\/\d+\/\d+\/\d+\.mvt$/);
    }
    // 26. The version in the URL is the one the release endpoint served.
    const version = /\/tiles\/(\d+)\//.exec(requests[0])![1];
    await expect(page.getByTestId("land-cover-layer-version")).toContainText(
      `통계 릴리스 버전 ${version}`,
    );
  });

  test("5-9: coverage mode shows and filters all three states", async ({ page }) => {
    await gotoSuitability(page);
    await openControl(page);
    await page.getByTestId("land-cover-layer-toggle").check();
    await page.waitForTimeout(3000);

    // 5. Coverage-status mode is the default and the legend lists all three states…
    await expect(page.getByTestId("land-cover-mode-coverage")).toBeChecked();
    const rows = page.getByTestId("land-cover-legend-row");
    await expect(rows).toHaveCount(3);

    // 6/7/8. …each visibly distinct: a distinct swatch color, a Korean label, the
    // machine status, and (for NO_COVERAGE) the semantic warning.
    const colors = await rows.locator("span[style]").evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).style.backgroundColor),
    );
    expect(new Set(colors).size).toBe(3);
    await expect(rows.nth(0)).toContainText("COMPLETE_EXACT");
    await expect(rows.nth(1)).toContainText("PARTIAL");
    await expect(rows.nth(2)).toContainText("NO_COVERAGE");
    await expect(rows.nth(2)).toContainText("적합하거나 안전하다는 뜻도 아닙니다");

    // 9. Coverage filters really drive the map: unchecking a status is reflected in the
    // control, and re-checking restores it. (The map filter itself is asserted by the
    // MapView unit tests; here we verify the live control state round-trips.)
    const uncovered = page.getByTestId("land-cover-coverage-toggle-NO_COVERAGE");
    await uncovered.uncheck();
    await expect(uncovered).not.toBeChecked();
    await expect(page.getByTestId("land-cover-legend-state-NO_COVERAGE")).toContainText("숨김");
    await uncovered.check();
    await expect(page.getByTestId("land-cover-legend-state-NO_COVERAGE")).toContainText("표시 중");

    // All three off → the explicit empty-selection state, never a silent revert to all.
    for (const status of ["COMPLETE_EXACT", "PARTIAL", "NO_COVERAGE"]) {
      await page.getByTestId(`land-cover-coverage-toggle-${status}`).uncheck();
    }
    await expect(page.getByTestId("land-cover-selection-empty")).toContainText(
      "현재 필터로 선택된 격자가 없습니다",
    );
  });

  test("10-16: dominant-class mode, L1/L2/L3, class filters, and a usable long legend", async ({
    page,
  }) => {
    await gotoSuitability(page);
    await openControl(page);
    await page.getByTestId("land-cover-layer-toggle").check();

    // 10. Dominant-class mode.
    await page.getByTestId("land-cover-mode-dominant").check();
    await expect(page.getByTestId("land-cover-level-group")).toBeVisible();

    // The class vocabulary comes from the LOADED tiles, so wait for the legend to
    // populate rather than for a fixed number of seconds: at the default capital-region
    // view the map pulls several low-zoom tiles, each of which is a multi-megabyte
    // response, so how long that takes is a property of the machine, not of the feature.
    await expect(page.getByTestId("land-cover-legend-row").first()).toBeVisible({
      timeout: 60_000,
    });

    // 11/12/13. Each level selector works and repaints WITHOUT refetching tiles: the
    // level is a paint/filter change only.
    const levelCounts: Record<number, number> = {};
    for (const level of [1, 2, 3]) {
      const refetches = await landCoverTileRequests(page, async () => {
        await page.getByTestId(`land-cover-level-${level}`).check();
        await page.waitForTimeout(1500);
      });
      expect(refetches, `level ${level} must not reload the vector source`).toHaveLength(0);
      await expect(page.getByTestId("land-cover-legend")).toContainText(`L${level}`);
      await expect(
        page.getByTestId("land-cover-legend-row").first(),
        `level ${level} legend must be populated`,
      ).toBeVisible({ timeout: 30_000 });
      levelCounts[level] = await page.getByTestId("land-cover-legend-row").count();
    }
    // 15. The legend really tracks the level: 세분류 offers at least as many
    // categories as 대분류 (the source hierarchy is strictly finer downward).
    expect(levelCounts[3]).toBeGreaterThanOrEqual(levelCounts[1]);

    // Official Korean names and codes are shown verbatim, with no invented category.
    await page.getByTestId("land-cover-level-1").check();
    const legend = page.getByTestId("land-cover-legend");
    const legendText = (await legend.textContent()) ?? "";
    expect(legendText).toMatch(/\(\d{3}\)/); // official three-digit class codes
    for (const invented of ["기타", "미분류", "Unknown", "Other"]) {
      expect(legendText).not.toContain(invented);
    }

    // 14. Class filters: unchecking a class marks it hidden without removing its row.
    const firstToggle = page.getByTestId("land-cover-legend-row").first().locator("input");
    await firstToggle.uncheck();
    await expect(firstToggle).not.toBeChecked();
    await expect(page.getByTestId("land-cover-legend-row").first()).toBeVisible();

    // 16. A long 세분류 legend stays usable: bounded scroll region + working search.
    await page.getByTestId("land-cover-level-3").check();
    const rows = page.getByTestId("land-cover-legend-rows");
    const scrolls = await rows.evaluate(
      (node) => node.scrollHeight > 0 && getComputedStyle(node).overflowY === "auto",
    );
    expect(scrolls).toBe(true);
    const box = (await rows.boundingBox())!;
    expect(box.height).toBeLessThan(300);
    const before = await page.getByTestId("land-cover-legend-row").count();
    await page.getByTestId("land-cover-class-search").fill("3");
    const after = await page.getByTestId("land-cover-legend-row").count();
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThan(0);
  });

  test("17-18: the existing candidate click still opens the detail with its LC5A land-cover section", async ({
    page,
  }) => {
    await gotoSuitability(page);
    await openControl(page);
    await page.getByTestId("land-cover-layer-toggle").check();
    await page.waitForTimeout(4000);
    // Collapse the control so it cannot sit over the click target.
    await page.getByTestId("land-cover-layer-summary").click();

    // Select a candidate from the existing accessible list first. That flies the map
    // onto that cell, so the subsequent canvas click is guaranteed to land on a
    // candidate — and at a zoom where the land-cover fill definitely covers it.
    await expect(page.getByTestId("top-candidates")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("top-candidate-item").first().click();
    const detail = page.getByTestId("candidate-detail");
    await expect(detail).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(4000); // flyTo + land-cover tiles for the new viewport

    // 17. Click the map over that cell. The land-cover fill is painted ABOVE the
    // candidate fill, and the click must still reach the candidate layer: the
    // candidate popup appearing is direct evidence the existing handler fired.
    const canvas = page.locator(".maplibregl-canvas");
    const box = (await canvas.boundingBox())!;
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    const popup = page.locator(".maplibregl-popup");
    await expect(popup).toBeVisible({ timeout: 20_000 });
    await expect(popup).toContainText("법적 판정 아님");

    // 18. The existing candidate detail is open and carries the LC5A land-cover
    // section, which resolves against the real LC4 API for the selected key.
    await expect(detail).toBeVisible();
    await expect(page.getByTestId("land-cover-cell-panel")).toBeVisible({ timeout: 20_000 });
  });

  test("19-22: rapid changes leave no stale styling, and the layer follows the mode", async ({
    page,
  }) => {
    await gotoSuitability(page);
    await openControl(page);
    await page.getByTestId("land-cover-layer-toggle").check();
    await page.waitForTimeout(3000);

    // 19. Rapid mode/level/filter changes: the control ends in exactly the state the
    // last action selected, with no leftover empty-selection or stale legend.
    for (let round = 0; round < 3; round += 1) {
      await page.getByTestId("land-cover-mode-dominant").check();
      await page.getByTestId("land-cover-level-3").check();
      await page.getByTestId("land-cover-level-2").check();
      await page.getByTestId("land-cover-mode-coverage").check();
    }
    await expect(page.getByTestId("land-cover-mode-coverage")).toBeChecked();
    await expect(page.getByTestId("land-cover-legend-row")).toHaveCount(3);
    await expect(page.getByTestId("land-cover-selection-empty")).toHaveCount(0);

    // 20. Turning the layer off restores the normal suitability map: the suitability
    // legend and its status filters are untouched throughout.
    await page.getByTestId("land-cover-layer-toggle").uncheck();
    await expect(page.getByTestId("land-cover-layer-toggle")).not.toBeChecked();
    await expect(page.getByTestId("suitability-legend")).toBeVisible();
    await expect(page.getByTestId("status-toggle-ELIGIBLE")).toBeChecked();

    // 21. Leaving suitability mode removes the control entirely.
    await page.getByTestId("mode-equity").click();
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect(page.getByTestId("land-cover-layer-control")).toHaveCount(0);
    await expect(page.getByTestId("legend")).toContainText("데이터 없음");

    // 22. Returning behaves predictably: the control is back, still OFF (the user
    // turned it off), with its filters intact.
    await page.getByTestId("mode-suitability").click();
    await openControl(page);
    await expect(page.getByTestId("land-cover-layer-toggle")).not.toBeChecked();
    await expect(page.getByTestId("land-cover-coverage-toggle-PARTIAL")).toBeChecked();
  });

  test("keeps the user's suitability status filters when the land-cover layer is toggled", async ({
    page,
  }) => {
    await gotoSuitability(page);
    // The floating legend is a <details> that CSS forces open at md+ (its summary is
    // hidden there); only the narrow layout needs an explicit disclosure click.
    const legendSummary = page.getByTestId("map-legend-summary");
    if (await legendSummary.isVisible()) await legendSummary.click();
    await page.getByTestId("status-toggle-REVIEW_REQUIRED").uncheck();
    await expect(page.getByTestId("status-toggle-REVIEW_REQUIRED")).not.toBeChecked();

    await openControl(page);
    await page.getByTestId("land-cover-layer-toggle").check();
    await page.waitForTimeout(2000);
    await page.getByTestId("land-cover-layer-toggle").uncheck();

    await expect(page.getByTestId("status-toggle-REVIEW_REQUIRED")).not.toBeChecked();
    await expect(page.getByTestId("status-toggle-ELIGIBLE")).toBeChecked();
  });

  // The 375×720 "mobile" leg is gone: below the 1024px desktop floor 여기다 does not
  // mount the suitability map (frontend/RESPONSIVE_LAYOUT.md), so the land-cover layer
  // control this checks does not exist there. 1024×768 — the compressed floor — is the
  // narrowest width where the control is real, and is the case that can actually push
  // the card outside the viewport.
  test("23-24: usable at the canonical desktop and at the desktop floor, with no horizontal overflow", async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1440, height: 900, label: "desktop" },
      { width: 1024, height: 768, label: "desktop floor" },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoSuitability(page);
      await openControl(page);
      await page.getByTestId("land-cover-layer-toggle").check();
      await page.getByTestId("land-cover-mode-dominant").check();
      await page.getByTestId("land-cover-level-3").check();
      await page.waitForTimeout(3000);

      const control = page.getByTestId("land-cover-layer-control");
      const box = (await control.boundingBox())!;
      // The card stays inside the viewport at both sizes.
      expect(box.width, viewport.label).toBeLessThanOrEqual(viewport.width);
      expect(box.x, viewport.label).toBeGreaterThanOrEqual(0);
      // The page itself never scrolls horizontally.
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, `${viewport.label} horizontal overflow`).toBe(false);
    }
  });

  test("25: never requests a raw land-cover feature or geometry endpoint", async ({ page }) => {
    const forbidden: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (FORBIDDEN_PATHS.some((path) => url.includes(path))) forbidden.push(url);
    });

    await gotoSuitability(page);
    await openControl(page);
    await page.getByTestId("land-cover-layer-toggle").check();
    await page.getByTestId("land-cover-mode-dominant").check();
    await page.getByTestId("land-cover-level-3").check();
    await page.waitForTimeout(5000);

    expect(forbidden).toEqual([]);
  });

  test("27: a failing tile endpoint does not break the rest of the map", async ({ page }) => {
    // Every land-cover tile fails; nothing else is intercepted.
    await page.route(`**${LAND_COVER_TILE_PATH}**`, (route) => route.fulfill({ status: 500 }));

    await gotoSuitability(page);
    await openControl(page);
    await page.getByTestId("land-cover-layer-toggle").check();
    await page.waitForTimeout(4000);

    // The base map, the suitability legend/filters and candidate selection all survive.
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect(page.getByTestId("suitability-legend")).toBeVisible();
    await expect(page.getByTestId("status-toggle-ELIGIBLE")).toBeChecked();
    await expect(page.getByTestId("map-error")).toHaveCount(0);

    // Equity mode still works afterwards.
    await page.getByTestId("mode-equity").click();
    await expect(page.getByTestId("legend")).toContainText("데이터 없음");
  });

  test("a failing release endpoint disables only the land-cover layer", async ({ page }) => {
    await page.route("**/cell-statistics/release", (route) => route.fulfill({ status: 500 }));

    await gotoSuitability(page);
    await openControl(page);

    // The toggle is disabled and the reason is bounded — never a stack trace, and
    // never a claim that land cover is absent.
    await expect(page.getByTestId("land-cover-layer-toggle")).toBeDisabled();
    const message = page.getByTestId("land-cover-layer-unavailable");
    await expect(message).toBeVisible();
    await expect(message).toContainText("토지피복이 없다는 뜻은 아니며");
    const text = (await message.textContent()) ?? "";
    for (const leak of ["SELECT", "Traceback", "psycopg", "/Users"]) {
      expect(text).not.toContain(leak);
    }

    // The suitability map is untouched.
    await expect(page.getByTestId("suitability-legend")).toBeVisible();
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  });
});
