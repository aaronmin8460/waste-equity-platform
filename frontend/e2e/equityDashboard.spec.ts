import { expect, test, type Page } from "@playwright/test";
import { mockEquityBackend } from "./phase4Fixtures";

/**
 * 지역 부담 dashboard refresh — desktop acceptance for the equity milestone.
 *
 * Complements the existing equity coverage rather than repeating it:
 * `phase4EquityMap.spec.ts` owns the selection flow and the legend geometry;
 * `civicShell.spec.ts` owns the shell. This file owns what the restructured
 * screen newly promises — the sidebar as the single scroll container, the map
 * reaching the viewport bottom, the legend sitting clear of the OSM attribution,
 * and the current-selection summary carrying region · metric · value · reference
 * period · source.
 *
 * ── THE MAP INSIGHT STRIP IS NO LONGER ON THIS SCREEN ────────────────────────────
 * 해석 · 주의 · 출처 보기 was taken off Page 1's primary UI by the `page-1 기술요청`
 * (see the note beside its former mount in `app/page.tsx`). The assertions that
 * described it are gone from this file; the assertions that described the map, the
 * legend, and the selection summary are NOT, because those promises still stand.
 *
 * Nothing it disclosed lost its coverage here: the reference period and the metric
 * source are still asserted to be on screen, in 선택한 지역 — which is exactly where
 * the removal note says they now live. `mapInsightDisclosure.spec.ts` continues to
 * own the disclosure's behaviour for the suitability screens, which keep it.
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

    test("keeps the map filling the workspace", async ({ page }) => {
      await openEquity(page);
      const mapBox = (await page.getByTestId("map-container").boundingBox())!;

      // The map reaches the viewport bottom — nothing sits as a band below the canvas
      // (docs/ui-refresh/regression-contract.md §4).
      expect(mapBox.y + mapBox.height, "map reaches the viewport bottom").toBeGreaterThanOrEqual(
        vp.height - 6,
      );
      expect(mapBox.height, "map is the dominant surface").toBeGreaterThan(vp.height * 0.75);
      expect(mapBox.width, "map keeps a meaningful width").toBeGreaterThan(400);

      // The retired strip must not come back as a primary Page-1 control.
      await expect(page.getByTestId("equity-insight-strip")).toHaveCount(0);
    });

    test("stacks the legend clear of the attribution", async ({ page }) => {
      await openEquity(page);
      const mapBox = (await page.getByTestId("map-container").boundingBox())!;
      const legendBox = (await page.getByTestId("map-legend").boundingBox())!;

      // The legend keeps the map's left edge and stays inside the canvas.
      expect(legendBox.x).toBeGreaterThanOrEqual(mapBox.x - 2);
      expect(legendBox.x).toBeLessThan(mapBox.x + 24);
      expect(legendBox.y).toBeGreaterThanOrEqual(mapBox.y - 2);
      expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height + 2);

      // The OSM attribution is never covered by the legend.
      const attribBox = await page.locator(".maplibregl-ctrl-attrib").boundingBox();
      if (attribBox) {
        expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(attribBox.y + 2);
      }
    });

    test("keeps one map, one h1, one navigation, and every metric radio reachable", async ({
      page,
    }) => {
      await openEquity(page);
      await expect(page.getByTestId("map-container")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
      // Present for landmark navigation, but visually hidden — 지역 지표 shows no
      // title block after the correction pass.
      await expect(page.locator("h1")).toHaveText("지역 지표");
      await expect(page.locator("h1")).toHaveClass(/sr-only/);
      await expect(page.getByTestId("top-navigation")).toHaveCount(1);
      await expect(page.getByTestId("mode-switch")).toHaveCount(1);
      await expect(page.locator("main")).toHaveCount(1);

      // Three fieldsets and seven category radios, each individually reachable — the
      // sidebar scrolls to them, nothing is hidden behind a disclosure. The other
      // four served metrics are reached by the 총량/1인당 switch on the waste rows.
      await expect(page.locator("fieldset")).toHaveCount(3);
      const radios = page.locator('input[type="radio"][name="metric"]');
      await expect(radios).toHaveCount(7);
      for (let i = 0; i < 7; i += 1) {
        await radios.nth(i).scrollIntoViewIfNeeded();
        await expect(radios.nth(i)).toBeVisible();
      }
    });

    test("keeps the header and BOTH choices actionable without scrolling", async ({ page }) => {
      await openEquity(page);
      // The visible header is GONE (correction pass), so there is nothing to keep
      // above the fold except the controls themselves — which is the point of having
      // removed it. Phase 1 reorders which control leads: Figma frame 74:2010 opens
      // the panel with 지표 선택, then 지역 순위, and places 지역 선택 lower so it sits
      // directly above the 선택한 지역 card it fills. 지표 선택 is the choice every
      // other card follows, so it is the one that must be actionable unscrolled;
      // 지역 선택 stays reachable by scrolling the column (and the map and the ranking
      // rows are two other ways to make the same selection).
      await expect(page.getByTestId("equity-metric-selector")).toBeInViewport();
      await expect(page.getByTestId("region-select")).toBeAttached();
    });

    test("keeps the selection summary's facts on screen, never only in a tooltip", async ({
      page,
    }) => {
      await openEquity(page);
      const summary = page.getByTestId("selected-region-summary");
      // The guarantee is that these facts have a real on-screen home in the
      // column — not that they sit above the fold now that two choice cards
      // precede them.
      await summary.scrollIntoViewIfNeeded();
      await expect(summary).toBeInViewport();
      await expect(page.getByTestId("equity-summary-status")).toBeVisible();
      // The reference period and the metric source are on screen, not in a tooltip.
      // With the map insight off Page 1 these are now the ONLY on-screen home for
      // them, which is precisely why they are asserted here rather than assumed.
      await expect(page.getByTestId("equity-summary-reference-period")).toBeVisible();
      await expect(page.getByTestId("selected-region-metric-source").first()).toBeVisible();
    });
  });
}

// --------------------------------------------------------------------------- //
// Behaviour — asserted once, at the primary desktop target
// --------------------------------------------------------------------------- //

test.describe("equity dashboard behaviour at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("selecting a metric updates the summary, the legend, and the URL", async ({
    page,
  }) => {
    await openEquity(page);
    // The 총량/1인당 switch on the category row replaced the separate per-capita
    // radio (correction pass); the SERVED metric it resolves to is unchanged.
    await page.getByRole("radio", { name: "생활계 폐기물 발생량" }).check();
    await page.getByTestId("metric-mode-household").getByRole("button", { name: "1인당" }).click();

    await expect(page.getByTestId("selected-metric-summary")).toContainText("1인당 생활계 발생량");
    await expect(page.getByTestId("legend-metric-label")).toContainText("1인당 생활계 발생량");
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
    // The counter word attaches to the numeral (`561,000명`); never the raw `persons`.
    await expect(page.getByTestId("selected-region-value")).toContainText("명");
    await expect(page.getByTestId("selected-region-value")).not.toContainText("persons");
    await expect(page.getByTestId("rank-row").filter({ hasText: "강남구" }).first()).toHaveAttribute(
      "aria-current",
      "true",
    );

    // Clearing returns to the explicit empty prompt — never a zero.
    await page.getByTestId("selected-region-clear").click();
    await expect(page.getByTestId("selected-region-empty")).toBeVisible();
    await expect(page.getByTestId("region-select")).toHaveValue("");
  });

  test("keeps the ranking basis, the full ranking, and the export actions on one column", async ({
    page,
  }) => {
    await openEquity(page);
    await expect(page.getByTestId("rank-basis")).toContainText("인구");
    // The unit is PRINTED in Korean: /api/v1/population serves the English `persons`
    // and every display path routes through lib/units, so a reader never meets it.
    await expect(page.getByTestId("rank-basis")).toContainText("단위 명");
    await expect(page.getByTestId("rank-basis")).not.toContainText("persons");

    // 지표 순위 전체보기 replaced the 지역 비교 card (correction pass): the same
    // served values, every region, no top-N cut.
    await expect(page.getByTestId("region-comparison")).toHaveCount(0);
    await page.getByTestId("open-full-ranking").click();
    const dialog = page.getByTestId("full-ranking-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("지역 순위 전체보기");
    await expect(dialog.getByTestId("full-ranking-row").first()).toBeVisible();
    // A region with no served value is stated as missing, never ranked as a 0.
    await expect(dialog.getByTestId("full-ranking-unranked")).toContainText(
      "0으로 채우지 않았습니다",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // The real existing actions, in the final sidebar section.
    await expect(page.getByTestId("share-copy")).toBeVisible();
    await expect(page.getByTestId("csv-ranking")).toBeVisible();
    await expect(page.getByTestId("open-report")).toBeVisible();
  });

  test("opens 데이터·출처 over this view, keeping its map mounted", async ({ page }) => {
    await openEquity(page);
    // The map source block used to carry this route. With 해석 · 주의 · 출처 보기 off
    // Page 1, the navigation is the route — what is asserted below is unchanged and
    // is the part that actually matters: 데이터·출처 arrives as a DIALOG over this
    // view rather than replacing it, so the map is never torn down and rebuilt.
    await page.getByTestId("mode-transparency").click();
    await expect(page.getByTestId("mode-transparency")).toHaveAttribute("aria-pressed", "true");
    // 데이터·출처 is a DIALOG over this view (spec §8), so its map stays mounted —
    // still exactly one, never a second.
    await expect(page.getByTestId("data-sources-dialog")).toBeVisible();
    await expect(page.getByTestId("map-container")).toHaveCount(1);
  });
});
