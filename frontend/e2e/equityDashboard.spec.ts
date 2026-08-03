import { expect, test, type Page } from "@playwright/test";
import { mockEquityBackend } from "./phase4Fixtures";

/**
 * 지역 부담 dashboard refresh — desktop acceptance for the equity milestone.
 *
 * Complements the existing equity coverage rather than repeating it:
 * `phase4EquityMap.spec.ts` owns the selection flow and the legend geometry;
 * `civicShell.spec.ts` owns the shell. This file owns what the restructured
 * screen newly promises — the sidebar as the single scroll container, the map
 * still reaching the viewport bottom BENEATH the new insight strip, the strip
 * never colliding with the legend or collapsing the map, and the current-selection
 * summary carrying region · metric · value · reference period · source.
 *
 * Self-mocked through `phase4Fixtures.mockEquityBackend`: no backend, no database,
 * no tile server, no government API. Structure, geometry, and behaviour only —
 * never a fixture value. Deliberately NO pixel snapshots: the repository has no
 * visual-regression infrastructure (docs/ui-refresh/baseline.md §7).
 */

const VIEWPORTS = [
  { name: "1024×768 (minimum supported)", width: 1024, height: 768 },
  { name: "1280×800", width: 1280, height: 800 },
  { name: "1440×900", width: 1440, height: 900 },
  { name: "1920×1080", width: 1920, height: 1080 },
];

async function openEquity(page: Page): Promise<void> {
  await mockEquityBackend(page);
  await page.goto("/?v=1&mode=equity");
  await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
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

for (const vp of VIEWPORTS) {
  test.describe(`equity dashboard at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("scrolls the sidebar, never the page, and never clips horizontally", async ({ page }) => {
      await openEquity(page);
      await expectNoHorizontalOverflow(page, vp.name);

      // The document itself is not a scroll container at desktop.
      const documentScrolls = await page.evaluate(
        () => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      );
      expect(documentScrolls, "no page-level vertical scroll").toBe(false);

      const sidebar = page.locator("aside");
      await expect(sidebar).toBeVisible();
      expect(await sidebar.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");

      // The control column ends at the viewport bottom rather than pushing the page.
      const sidebarBox = (await sidebar.boundingBox())!;
      expect(sidebarBox.y + sidebarBox.height).toBeLessThanOrEqual(vp.height + 2);

      // The column is long enough at every supported height that it must scroll
      // LOCALLY — and doing so moves only the sidebar, leaving the page still.
      const overflows = await sidebar.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
      expect(overflows, "sidebar content exceeds its height").toBe(true);
      await sidebar.evaluate((el) => el.scrollTo(0, 400));
      expect(await sidebar.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });

    test("keeps the map filling the workspace beneath the insight strip", async ({ page }) => {
      await openEquity(page);
      const mapBox = (await page.getByTestId("map-container").boundingBox())!;

      // The map still reaches the viewport bottom — the strip is an overlay, not a
      // band below the canvas (docs/ui-refresh/regression-contract.md §4).
      expect(mapBox.y + mapBox.height, "map reaches the viewport bottom").toBeGreaterThanOrEqual(
        vp.height - 6,
      );
      expect(mapBox.height, "map is the dominant surface").toBeGreaterThan(vp.height * 0.75);
      expect(mapBox.width, "map keeps a meaningful width").toBeGreaterThan(400);

      // Collapsed, the insight is a compact bar; opened, it is a bounded card. Both
      // states stay inside the map bounds and neither collapses the canvas.
      const strip = page.getByTestId("equity-insight-strip");
      await expect(strip).toBeVisible();
      const stripBox = (await strip.boundingBox())!;
      // Inside the map bounds…
      expect(stripBox.x).toBeGreaterThanOrEqual(mapBox.x - 2);
      expect(stripBox.x + stripBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 2);
      expect(stripBox.y).toBeGreaterThanOrEqual(mapBox.y - 2);
      expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height + 2);
      // …and it does not collapse the map: it covers at most a third of its height.
      expect(stripBox.height).toBeLessThan(mapBox.height / 3);

      await page.getByTestId("equity-insight-summary").click();
      const openBox = (await strip.boundingBox())!;
      expect(openBox.x).toBeGreaterThanOrEqual(mapBox.x - 2);
      expect(openBox.x + openBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 2);
      expect(openBox.y).toBeGreaterThanOrEqual(mapBox.y - 2);
      expect(openBox.y + openBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height + 2);
      // Looser than the collapsed bound above: the expanded card is a transient,
      // user-opened state and carries a summary bar the old always-open card lacked.
      expect(openBox.height, "the expanded card still leaves the map dominant").toBeLessThan(
        mapBox.height * 0.4,
      );
    });

    test("stacks the legend clear of the strip and of the attribution", async ({ page }) => {
      await openEquity(page);
      const mapBox = (await page.getByTestId("map-container").boundingBox())!;
      const legendBox = (await page.getByTestId("map-legend").boundingBox())!;
      const stripBox = (await page.getByTestId("equity-insight-strip").boundingBox())!;

      // One bottom overlay column: the legend sits directly above the insight and the
      // two never overlap, whatever either one's height turns out to be. The insight
      // is right-aligned in that band; the legend keeps the map's left edge.
      expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(stripBox.y + 1);
      expect(legendBox.x).toBeGreaterThanOrEqual(mapBox.x - 2);
      expect(legendBox.x).toBeLessThan(mapBox.x + 24);
      expect(legendBox.y).toBeGreaterThanOrEqual(mapBox.y - 2);
      expect(stripBox.x + stripBox.width, "insight sits at the map's right edge").toBeGreaterThan(
        mapBox.x + mapBox.width - 40,
      );

      // Opening it grows the card UPWARD and lifts the legend, so the disclosure can
      // never cover the legend in either state.
      await page.getByTestId("equity-insight-summary").click();
      const openLegendBox = (await page.getByTestId("map-legend").boundingBox())!;
      const openStripBox = (await page.getByTestId("equity-insight-strip").boundingBox())!;
      expect(openLegendBox.y + openLegendBox.height).toBeLessThanOrEqual(openStripBox.y + 1);
      expect(openLegendBox.y, "the legend rides above the expanded card").toBeGreaterThanOrEqual(
        mapBox.y - 2,
      );

      // The OSM attribution is never covered, open or closed.
      const attribBox = await page.locator(".maplibregl-ctrl-attrib").boundingBox();
      if (attribBox) {
        expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(attribBox.y + 2);
        expect(openStripBox.y + openStripBox.height).toBeLessThanOrEqual(attribBox.y + 2);
      }
    });

    test("keeps one map, one h1, one navigation, and every metric radio reachable", async ({
      page,
    }) => {
      await openEquity(page);
      await expect(page.getByTestId("map-container")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText("지역 부담");
      await expect(page.getByTestId("top-navigation")).toHaveCount(1);
      await expect(page.getByTestId("mode-switch")).toHaveCount(1);
      await expect(page.locator("main")).toHaveCount(1);

      // Three fieldsets and eleven radios, each individually reachable — the
      // sidebar scrolls to them, nothing is hidden behind a disclosure.
      await expect(page.locator("fieldset")).toHaveCount(3);
      const radios = page.locator('input[type="radio"][name="metric"]');
      await expect(radios).toHaveCount(11);
      for (let i = 0; i < 11; i += 1) {
        await radios.nth(i).scrollIntoViewIfNeeded();
        await expect(radios.nth(i)).toBeVisible();
      }
    });

    test("keeps the header and the current-selection summary visible without scrolling", async ({
      page,
    }) => {
      await openEquity(page);
      await expect(page.locator("h1")).toBeInViewport();
      await expect(page.getByTestId("selected-region-summary")).toBeInViewport();
      await expect(page.getByTestId("equity-summary-status")).toBeVisible();
      // The reference period and the metric source are on screen, not in a tooltip.
      await expect(page.getByTestId("equity-summary-reference-period")).toBeVisible();
      await expect(page.getByTestId("selected-region-metric-source").first()).toBeVisible();
      // The map insight is collapsed by default, so its copy of the same facts is
      // one click away — never a tooltip, and never the only home for them.
      await expect(page.getByTestId("insight-reference-period")).toBeHidden();
      await page.getByTestId("equity-insight-summary").click();
      await expect(page.getByTestId("insight-reference-period")).toBeVisible();
      await expect(page.getByTestId("insight-provenance")).toBeVisible();
    });
  });
}

// --------------------------------------------------------------------------- //
// Behaviour — asserted once, at the primary desktop target
// --------------------------------------------------------------------------- //

test.describe("equity dashboard behaviour at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("selecting a metric updates the summary, the legend, the strip, and the URL", async ({
    page,
  }) => {
    await openEquity(page);
    await page.getByRole("radio", { name: "1인당 생활계 발생량" }).check();

    await expect(page.getByTestId("selected-metric-summary")).toContainText("1인당 생활계 발생량");
    await expect(page.getByTestId("legend-metric-label")).toContainText("1인당 생활계 발생량");
    await expect(page.getByTestId("insight-interpretation")).toContainText("1인당 생활계 발생량");
    // One canonical metric state, mirrored into the versioned share URL.
    await expect(page).toHaveURL(/[?&]v=1(&|$|&)/);
    await expect(page).toHaveURL(/metric=PER_CAPITA_HOUSEHOLD/);
    await expect(page.locator('input[type="radio"][name="metric"]:checked')).toHaveCount(1);
  });

  test("selecting a region keeps the picker, the ranking, and the summary in sync", async ({
    page,
  }) => {
    await openEquity(page);
    // Ranking → the one canonical selection.
    const rankRow = page.getByTestId("rank-high").getByTestId("rank-row").first();
    const rankText = await rankRow.innerText();
    await rankRow.click();
    const name = await page.getByTestId("selected-region-name").innerText();
    expect(rankText).toContain(name);
    await expect(page.getByTestId("region-select")).not.toHaveValue("");

    // Picker → the same state, in the other direction.
    await page.getByTestId("region-select").selectOption("KR-SGIS-11680");
    await expect(page.getByTestId("selected-region-name")).toHaveText("강남구");
    await expect(page.getByTestId("selected-region-value")).toContainText("persons");
    await expect(page.getByTestId("rank-row").filter({ hasText: "강남구" }).first()).toHaveAttribute(
      "aria-current",
      "true",
    );

    // Clearing returns to the explicit empty prompt — never a zero.
    await page.getByTestId("selected-region-clear").click();
    await expect(page.getByTestId("selected-region-empty")).toBeVisible();
    await expect(page.getByTestId("region-select")).toHaveValue("");
  });

  test("keeps the ranking basis, the comparison, and the export actions on one column", async ({
    page,
  }) => {
    await openEquity(page);
    await expect(page.getByTestId("rank-basis")).toContainText("인구");
    await expect(page.getByTestId("rank-basis")).toContainText("persons");

    await page.getByTestId("comparison-search").fill("종로");
    await page.getByTestId("comparison-options").getByRole("option").first().click();
    await expect(page.getByTestId("comparison-table")).toBeVisible();
    await expect(page.getByTestId("comparison-count")).toContainText("1");
    await page.getByTestId("comparison-chip-remove").click();
    await expect(page.getByTestId("comparison-table")).toHaveCount(0);

    // The real existing actions, in the final sidebar section.
    await expect(page.getByTestId("share-copy")).toBeVisible();
    await expect(page.getByTestId("csv-ranking")).toBeVisible();
    await expect(page.getByTestId("open-report")).toBeVisible();
  });

  test("routes to the existing 데이터·출처 area from the map source block", async ({ page }) => {
    await openEquity(page);
    await page.getByTestId("equity-insight-summary").click();
    await page.getByTestId("insight-open-sources").click();
    await expect(page.getByTestId("mode-transparency")).toHaveAttribute("aria-pressed", "true");
    // The map is unmounted on that area, so exactly one map is ever mounted.
    await expect(page.getByTestId("map-container")).toHaveCount(0);
  });
});
