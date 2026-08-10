import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { mockEquityBackend } from "./phase4Fixtures";

/**
 * UI correction pass — acceptance for the four defects the post-production visual
 * review of the deployed 여기다 redesign reported, checked at the three widths the
 * review named.
 *
 * This file is the CHECKLIST, not the mechanism. The detailed contracts live with
 * the surfaces they belong to — `deepAnalysisPanels.spec.ts` measures the panel/map
 * geometry, `equityDashboard.spec.ts` owns the equity workspace, and
 * `facilityCost.spec.ts` owns the cost workflow. What is here is the set of
 * statements the reviewer will re-check by eye, written so they fail loudly if any
 * of the four regressions returns.
 *
 * Self-mocked (`mockBackend` / `phase4Fixtures`): no backend, no database, no tile
 * server, no government API. Structure and geometry only, never a fixture value.
 */

const WIDTHS = [
  { name: "390×844 (phone)", width: 390, height: 844 },
  { name: "1024×768 (minimum desktop)", width: 1024, height: 768 },
  { name: "1440×900 (review width)", width: 1440, height: 900 },
];

/** The six visible destinations must survive every change in this pass. */
const NAV_TEST_IDS = [
  "mode-equity",
  "mode-flow",
  "suitability-view-cost",
  "mode-suitability",
  "suitability-view-scenario",
  "mode-transparency",
];

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${where}: no page-level horizontal overflow`).toBeLessThanOrEqual(
    clientWidth + 1,
  );
}

for (const vp of WIDTHS) {
  test.describe(`correction pass at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    // ─────────────────────────────────────────────────────────────────────────
    // 1. 지역 지표 — the intro block is gone, and its space is reclaimed
    // ─────────────────────────────────────────────────────────────────────────
    test("지역 지표 opens on the controls, with no intro block above them", async ({ page }) => {
      await mockEquityBackend(page);
      await page.goto("/?v=1&mode=equity");
      await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });

      // The h1 survives for landmark navigation but takes NO layout space.
      const h1 = page.locator("h1");
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText("지역 지표");
      const h1Box = await h1.boundingBox();
      expect(h1Box, "sr-only h1 occupies no meaningful box").not.toBeNull();
      expect(h1Box!.height, "sr-only h1 height").toBeLessThanOrEqual(2);

      // The removed lines are absent from the DOM, not hidden with spacing intact.
      await expect(
        page.getByText("서울 · 인천 · 경기 공공자료로 보는 지역 부담과 후보지"),
      ).toHaveCount(0);
      await expect(page.getByTestId("mode-orientation")).toHaveCount(0);

      // The first meaningful thing in the column is the region control, and it
      // starts directly under the app bar rather than a screenful down.
      const navBox = (await page.getByTestId("top-navigation").boundingBox())!;
      const pickerBox = (await page.getByTestId("region-select").boundingBox())!;
      expect(
        pickerBox.y - (navBox.y + navBox.height),
        "region control sits close under the app bar",
      ).toBeLessThan(140);

      await expectNoHorizontalOverflow(page, `${vp.name} equity`);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. 지표 선택 — three subject sections, category rows, a counting switch
    // ─────────────────────────────────────────────────────────────────────────
    test("지표 선택 presents three subject sections and a working counting switch", async ({
      page,
    }) => {
      await mockEquityBackend(page);
      await page.goto("/?v=1&mode=equity");
      await expect(page.getByTestId("equity-metric-selector")).toBeVisible({ timeout: 15000 });

      const selector = page.getByTestId("equity-metric-selector");
      await expect(selector.getByText("지표 선택", { exact: true })).toBeVisible();
      for (const section of ["population", "generation", "facility"]) {
        await expect(page.getByTestId(`metric-section-${section}`)).toBeVisible();
      }
      // Not one flat list: the rows are cards, and every one is a real radio row.
      await expect(page.locator('input[type="radio"][name="metric"]')).toHaveCount(7);
      await expect(page.getByTestId("metric-row-household")).toBeVisible();

      // The counting switch belongs to the ACTIVE waste row, and moving it changes
      // the served metric while keeping the category selected.
      await expect(page.getByTestId("metric-mode-household")).toHaveCount(0);
      await page.getByRole("radio", { name: "생활계 폐기물 발생량" }).check();
      const modes = page.getByTestId("metric-mode-household");
      await expect(modes).toBeVisible();
      await expect(modes.getByRole("button", { name: "총량" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await modes.getByRole("button", { name: "1인당" }).click();
      await expect(page).toHaveURL(/metric=PER_CAPITA_HOUSEHOLD/);
      await expect(page.getByRole("radio", { name: "생활계 폐기물 발생량" })).toBeChecked();

      // Selection is not colour-only: the checked radio and a bolder label carry it.
      const selectedRow = page.getByTestId("metric-row-household");
      await expect(selectedRow).toHaveAttribute("data-selected", "true");

      // Keyboard reachable, and no row is clipped at any width.
      for (let i = 0; i < 7; i += 1) {
        const radio = page.locator('input[type="radio"][name="metric"]').nth(i);
        await radio.scrollIntoViewIfNeeded();
        await expect(radio).toBeVisible();
      }
      await expectNoHorizontalOverflow(page, `${vp.name} metric selector`);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 3. 지역 비교 gone; 지표 순위 전체보기 present and usable
    // ─────────────────────────────────────────────────────────────────────────
    test("지역 비교 is gone and 지표 순위 전체보기 opens the complete ranking", async ({
      page,
    }) => {
      await mockEquityBackend(page);
      await page.goto("/?v=1&mode=equity");
      await expect(page.getByTestId("region-ranking")).toBeVisible({ timeout: 15000 });

      // Gone, with none of its controls left reachable.
      await expect(page.getByTestId("region-comparison")).toHaveCount(0);
      await expect(page.getByTestId("comparison-search")).toHaveCount(0);
      await expect(page.getByTestId("comparison-chips")).toHaveCount(0);
      await expect(page.getByTestId("comparison-table")).toHaveCount(0);
      await expect(page.getByText("최대 3개 지역")).toHaveCount(0);

      const trigger = page.getByTestId("open-full-ranking");
      await trigger.scrollIntoViewIfNeeded();
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveText("지표 순위 전체보기");

      await trigger.click();
      const dialog = page.getByTestId("full-ranking-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      // It names the metric it is ranking, and it lists real rows.
      await expect(dialog).toContainText("인구");
      await expect(dialog.getByTestId("full-ranking-row").first()).toBeVisible();
      // Missing stays missing.
      await expect(dialog.getByTestId("full-ranking-unranked")).toContainText(
        "0으로 채우지 않았습니다",
      );
      // Usable at this width: the panel fits and only its body scrolls.
      const panelBox = (await dialog.boundingBox())!;
      expect(panelBox.width).toBeLessThanOrEqual(vp.width + 1);
      expect(panelBox.height).toBeLessThanOrEqual(vp.height + 1);
      await expectNoHorizontalOverflow(page, `${vp.name} full ranking open`);

      // Escape closes and focus returns to the opener.
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. 후보지 분석 — the warnings are the LAST thing on the page
    // ─────────────────────────────────────────────────────────────────────────
    test("후보지 분석 opens with the workflow and ends with the warnings", async ({ page }) => {
      await mockBackend(page);
      await page.goto("/?v=1&mode=suitability&view=cost");
      await expect(page.getByTestId("facility-cost-form")).toBeVisible({ timeout: 15000 });

      const form = page.getByTestId("facility-cost-form");
      const notice = page.getByTestId("facility-cost-notice");
      const completeness = page.getByTestId("facility-cost-completeness");

      // Both are still on the page, in full — the move must not have deleted them.
      await expect(notice).toHaveCount(1);
      await expect(completeness).toHaveCount(1);
      await expect(completeness).toContainText("8가지");

      // …and both sit BELOW the whole workflow.
      const formBox = (await form.boundingBox())!;
      const noticeBox = (await notice.boundingBox())!;
      const completenessBox = (await completeness.boundingBox())!;
      expect(noticeBox.y, "알림 sits below the workflow").toBeGreaterThan(
        formBox.y + formBox.height - 1,
      );
      expect(completenessBox.y, "the exclusion list sits below the workflow").toBeGreaterThan(
        formBox.y + formBox.height - 1,
      );

      // The first step is what opens the screen now.
      const stepBox = (await page.getByRole("heading", { name: "1. 처리할 지역" }).boundingBox())!;
      expect(stepBox.y, "step 1 precedes the warnings").toBeLessThan(noticeBox.y);

      await expectNoHorizontalOverflow(page, `${vp.name} cost`);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 5. The six-destination navigation is untouched by all of the above
    // ─────────────────────────────────────────────────────────────────────────
    test("keeps the six-item navigation intact", async ({ page }) => {
      await mockBackend(page);
      await page.goto("/?v=1&mode=equity");
      await expect(page.getByTestId("mode-switch")).toBeVisible({ timeout: 15000 });
      for (const testId of NAV_TEST_IDS) {
        await expect(page.getByTestId(testId), testId).toHaveCount(1);
      }
      await expect(page.getByTestId("mode-equity")).toHaveText("지역 지표");
    });
  });
}

// --------------------------------------------------------------------------- //
// 후보지 심층 분석 — desktop only: below md the three columns stack, so a width
// collapse has no meaning and the rail is deliberately not rendered.
// --------------------------------------------------------------------------- //

for (const vp of WIDTHS.filter((v) => v.width >= 1024)) {
  test.describe(`collapsed panels give width to the map at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("both columns' width becomes the map's", async ({ page }) => {
      await mockBackend(page);
      await page.goto("/?v=1&mode=suitability&view=score");
      await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });

      const mapWidth = async () =>
        (await page.getByTestId("map-container").boundingBox())!.width;

      const bothOpen = await mapWidth();
      await page.getByTestId("deep-left-panel-toggle").click();
      await page.getByTestId("deep-right-panel-toggle").click();
      await page.waitForTimeout(400);

      expect(await mapWidth(), "the map grows by both columns").toBeGreaterThan(bothOpen + 300);
      await expectNoHorizontalOverflow(page, `${vp.name} both collapsed`);

      // Reopening returns the space — the collapse is reversible, not one-way.
      await page.getByTestId("deep-left-panel-toggle").click();
      await page.getByTestId("deep-right-panel-toggle").click();
      await page.waitForTimeout(400);
      expect(Math.abs((await mapWidth()) - bothOpen)).toBeLessThan(2);
    });
  });
}
