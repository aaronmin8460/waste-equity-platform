import { expect, test, type Page } from "@playwright/test";
import { mockEquityBackend } from "./phase4Fixtures";

/**
 * Phase 4 — regional burden map desktop improvements.
 *
 * Self-mocked (see phase4Fixtures): the app is driven at real viewport sizes with a
 * synthetic region set, so the selection flow and the ranking have
 * something to render. It touches no network, no tile server, and no government
 * API, and asserts only on structure, geometry, and behaviour — never on the
 * fixture's values.
 *
 * Verified viewports:
 *   390 × 844   — phone regression check
 *   768 × 1024  — tablet-portrait regression check (md breakpoint)
 *   1054 × 800  — narrow-desktop regression check (map-height fill)
 *   1280 × 800  — secondary desktop target
 *   1440 × 900  — primary desktop target
 */

const DESKTOP = [
  { name: "desktop 1280×800", width: 1280, height: 800 },
  { name: "desktop 1440×900", width: 1440, height: 900 },
];

/**
 * The narrow END of the supported desktop range — not sub-desktop widths.
 *
 * 390×844 and 768×1024 used to live here and asserted the retired phone stack (a
 * sidebar above a map with a definite ~30vh minimum height). 여기다 is desktop-required
 * below 1024px (frontend/RESPONSIVE_LAYOUT.md): the equity map is not mounted there,
 * so neither the geometry nor the map-height branch below has a subject. The gate is
 * asserted in `responsive.spec.ts`; what stays here is the tightest width the map
 * layout genuinely has to survive.
 */
const REGRESSION = [
  { name: "desktop floor 1024×768", width: 1024, height: 768 },
  { name: "narrow-desktop 1054×800", width: 1054, height: 800 },
];

/** The document must never scroll horizontally (1px rounding tolerance). */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function openEquity(page: Page): Promise<void> {
  await mockEquityBackend(page);
  // Direct entry to the equity map through the shared, versioned URL state.
  await page.goto("/?v=1&mode=equity");
  await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
}

// --------------------------------------------------------------------------- //
// Structure — asserted once, at the primary desktop target
// --------------------------------------------------------------------------- //

test.describe("equity map structure at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("renders exactly one navigation, main target, map, and h1", async ({ page }) => {
    await openEquity(page);
    await expect(page.getByTestId("top-navigation")).toHaveCount(1);
    await expect(page.locator("#main-content")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByTestId("map-container")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
    // Exactly one floating legend — the single source of truth over the map.
    await expect(page.getByTestId("map-legend")).toHaveCount(1);
  });

  test("keeps three metric sections and seven radios in one logical group", async ({ page }) => {
    await openEquity(page);
    await expect(page.locator("fieldset")).toHaveCount(3);
    await expect(page.locator("legend")).toHaveCount(3);
    // Seven CATEGORY rows after the correction pass; the four per-capita metrics are
    // reached by each waste row's 총량/1인당 switch, so all eleven stay reachable.
    await expect(page.locator('input[type="radio"][name="metric"]')).toHaveCount(7);
    await expect(page.getByTestId("metric-section-population")).toBeVisible();
    await expect(page.getByTestId("metric-section-generation")).toBeVisible();
    await expect(page.getByTestId("metric-section-facility")).toBeVisible();
    // Every option is reachable on desktop without opening a disclosure — no metric
    // is hidden behind a closed accordion.
    const radios = page.locator('input[type="radio"][name="metric"]');
    for (let i = 0; i < 7; i += 1) {
      await expect(radios.nth(i)).toBeVisible();
    }
  });

  test("uses Korean-only primary headings for the metric sections and the legend", async ({
    page,
  }) => {
    await openEquity(page);
    await expect(page.getByText("지역별 인구", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("폐기물 발생량", { exact: true })).toBeVisible();
    await expect(page.getByText("1인당 시설 처리 수준", { exact: true })).toBeVisible();
    // The legend heading lost its English duplication but kept the unit.
    const legendHeading = page.getByTestId("legend").getByRole("heading", { level: 2 });
    await expect(legendHeading).toContainText("범례");
    await expect(legendHeading).not.toContainText("(Legend)");
  });

  test("makes the active metric prominent and announces it as a status region", async ({
    page,
  }) => {
    await openEquity(page);
    const summary = page.getByTestId("selected-metric-summary");
    await expect(summary).toHaveAttribute("role", "status");
    await expect(summary).toContainText("인구");
    await expect(summary).toContainText("persons");

    // The metric name is visually dominant over the unit within the summary.
    const nameSize = await summary
      .getByText("인구", { exact: true })
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const unitSize = await summary
      .getByText(/단위/)
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(nameSize).toBeGreaterThan(unitSize);

    // Selecting another metric updates the summary immediately.
    await page.getByRole("radio", { name: "생활계 폐기물 발생량" }).check();
    await page.getByTestId("metric-mode-household").getByRole("button", { name: "1인당" }).click();
    await expect(summary).toContainText("1인당 생활계 발생량");
  });

  test("preserves every legend class row, the unit, the method note, and no-data", async ({
    page,
  }) => {
    await openEquity(page);
    const rows = page.getByTestId("choropleth-legend-row");
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i)).toContainText("급");
      // The legend prints the unit in KOREAN. It used to echo the backend's raw
      // `persons`, which is an English API token rather than something a citizen
      // reads; the production hotfix that replaced it with 명 is in this branch's
      // history, and this assertion is the last place still expecting the old token.
      // The point of the check is unchanged — every class row still carries its unit,
      // so a number is never shown without one.
      await expect(rows.nth(i)).toContainText("명");
    }
    await expect(page.getByTestId("choropleth-scale-method")).not.toBeEmpty();
    await expect(page.getByTestId("choropleth-legend-nodata")).toContainText("데이터 없음");
  });
});

// --------------------------------------------------------------------------- //
// Selection flow — one canonical selectedRegionCode
// --------------------------------------------------------------------------- //

test.describe("selected-region flow at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("keeps the region control a keyboard-operable native select", async ({ page }) => {
    await openEquity(page);
    const select = page.getByTestId("region-select");
    await expect(select).toBeVisible();
    await expect(select).toHaveJSProperty("tagName", "SELECT");
    await expect(page.getByRole("combobox", { name: /지역 선택/ })).toBeVisible();
    // Reachable and operable from the keyboard, with a visible focus indicator.
    await select.focus();
    await expect(select).toBeFocused();
    const outlineWidth = await select.evaluate(
      (el) => getComputedStyle(el).outlineWidth || "0px",
    );
    expect(outlineWidth).not.toBe("");
  });

  test("synchronises the select, the panel, and the ranking through one state", async ({
    page,
  }) => {
    await openEquity(page);
    // Ranking selection drives the ONE canonical state, so the native select and the
    // panel both follow it — there is no second selection store.
    const rankRow = page.getByTestId("rank-high").getByTestId("rank-row").first();
    const rankRowText = await rankRow.innerText();
    await rankRow.click();
    await expect(page.getByTestId("selected-region-name")).toBeVisible();
    const rankedName = await page.getByTestId("selected-region-name").innerText();
    expect(rankRowText).toContain(rankedName);
    await expect(page.getByTestId("region-select")).not.toHaveValue("");

    // Changing the select drives the same state in the other direction.
    await page.getByTestId("region-select").selectOption("KR-SGIS-11680");
    await expect(page.getByTestId("selected-region-name")).toHaveText("강남구");
    await expect(page.getByTestId("selected-region-value")).toContainText("persons");

    // Clearing returns to the explicit empty prompt — never a zero.
    await page.getByTestId("selected-region-clear").click();
    await expect(page.getByTestId("selected-region-empty")).toBeVisible();
    await expect(page.getByTestId("region-select")).toHaveValue("");
  });

  test("keeps the full ranking and share working, and the URL state versioned", async ({ page }) => {
    await openEquity(page);
    // 지표 순위 전체보기 replaced the 지역 비교 card (correction pass).
    await page.getByTestId("open-full-ranking").click();
    await expect(page.getByTestId("full-ranking-dialog")).toBeVisible();
    await page.getByTestId("full-ranking-dialog-close").click();

    // Selecting a metric writes the canonical, versioned URL state (replaceState —
    // no history spam), which is what the share link encodes.
    await page.getByRole("radio", { name: "생활계 폐기물 발생량" }).check();
    await page.getByTestId("metric-mode-household").getByRole("button", { name: "1인당" }).click();
    await expect(page).toHaveURL(/[?&]v=1(&|$)/);
    await expect(page).toHaveURL(/mode=equity/);
    await expect(page.getByTestId("share-copy")).toBeVisible();
  });
});

// --------------------------------------------------------------------------- //
// Layout geometry across every required viewport
// --------------------------------------------------------------------------- //

for (const vp of [...REGRESSION, ...DESKTOP]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("never scrolls horizontally", async ({ page }) => {
      await openEquity(page);
      await expectNoHorizontalOverflow(page);
    });

    test("leaves no empty strip below the map", async ({ page }) => {
      await openEquity(page);
      const box = (await page.getByTestId("map-container").boundingBox())!;
      // The map fills the row to the viewport bottom (rounding tolerance), so no
      // empty or black strip can appear beneath it.
      //
      // This used to branch on `vp.width >= 768`, with a sub-768 arm allowing a
      // ~30vh stacked map. Every viewport in this loop is now at or above the 1024px
      // desktop floor — the only widths that mount a map at all — so that arm was
      // unreachable and is gone rather than left as a dead alternative contract.
      expect(box.y + box.height).toBeGreaterThanOrEqual(vp.height - 6);
      expect(box.height).toBeGreaterThan(vp.height * 0.75);
    });

    test("floats the legend inside the map, clear of the attribution", async ({ page }) => {
      await openEquity(page);
      const mapBox = (await page.getByTestId("map-container").boundingBox())!;
      const legend = page.getByTestId("map-legend");
      await expect(legend).toBeVisible();
      const legendBox = (await legend.boundingBox())!;
      expect(legendBox.x).toBeGreaterThanOrEqual(mapBox.x - 2);
      expect(legendBox.y).toBeGreaterThanOrEqual(mapBox.y - 2);
      expect(legendBox.x + legendBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 2);
      expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height + 2);
      const attribBox = await page.locator(".maplibregl-ctrl-attrib").boundingBox();
      if (attribBox) {
        expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(attribBox.y + 2);
      }
    });

    test("keeps every metric radio reachable without a disclosure", async ({ page }) => {
      await openEquity(page);
      await expect(page.getByTestId("map-legend-summary")).toBeHidden();
      // Seven category rows; the four per-capita metrics are on the row switch.
      await expect(page.locator('input[type="radio"][name="metric"]')).toHaveCount(7);
      await expect(page.getByTestId("choropleth-legend-row").first()).toBeVisible();
    });

    test("walks the keyboard from the skip link into the controls with no trap", async ({
      page,
    }) => {
      await openEquity(page);
      await page.keyboard.press("Tab");
      // The skip link is the first focusable element.
      await expect(page.locator("a[href='#main-content']")).toBeFocused();
      // Focus keeps moving — a trap would keep returning the same element.
      const seen = new Set<string>();
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press("Tab");
        seen.add(
          await page.evaluate(() => {
            const el = document.activeElement;
            return el ? `${el.tagName}:${el.getAttribute("data-testid") ?? ""}:${el.className}` : "";
          }),
        );
      }
      expect(seen.size).toBeGreaterThan(3);
    });
  });
}
