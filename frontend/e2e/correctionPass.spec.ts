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

/**
 * The widths this checklist is re-checked at.
 *
 * The review originally named a 390×844 phone as its third width. 여기다 is now
 * desktop-required below 1024px (frontend/RESPONSIVE_LAYOUT.md): below the floor the
 * dashboards are not laid out differently, they are NOT MOUNTED, and the reader gets
 * `NarrowScreenGate` instead. Every statement in this file is about the analytical
 * workspace — where the intro block sits, how the panels give width to the map, how
 * the cost workflow reads — so at 390 there is simply no subject left to check.
 *
 * The phone width is therefore not "dropped coverage": it moved to the file that owns
 * the narrow contract. `responsive.spec.ts` asserts the gate at 390×844, 430×932,
 * 768×1024 and 1023×800, and `accessibility.spec.ts` keeps the skip link working
 * there. What remains here is the desktop floor and the review width, which is where
 * these four regressions can actually recur.
 */
const WIDTHS = [
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

      // The first meaningful thing in the column starts directly under the app bar
      // rather than a screenful down. WHICH control that is changed in Phase 1:
      // Figma frame 74:2010 opens the panel with 지표 선택 and moves 지역 선택 lower,
      // directly above the 선택한 지역 card it fills ("좌측 패널 순서 조정: 지역 선택 >
      // 선택한 지역", page-1 기술요청). The reclaimed-space guarantee is unchanged.
      const navBox = (await page.getByTestId("top-navigation").boundingBox())!;
      const firstControlBox = (await page.getByTestId("equity-metric-selector").boundingBox())!;
      expect(
        firstControlBox.y - (navBox.y + navBox.height),
        "the first control sits close under the app bar",
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
    // 3. 지역 비교 gone; the full-ranking escape present and usable
    // ─────────────────────────────────────────────────────────────────────────
    test("지역 비교 is gone and 전체보기 opens the complete ranking", async ({
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
      // Figma frame 74:2025 labels the escape from the top-N cut 전체보기 ↗, inside a
      // card already titled 지역 순위; the dialog it opens keeps the full name.
      await expect(trigger).toHaveText("전체보기 ↗");

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
    test("후보지 분석 opens with the workflow and keeps the warnings in full", async ({ page }) => {
      await mockBackend(page);
      await page.goto("/?v=1&mode=suitability&view=cost");
      await expect(page.getByTestId("facility-cost-workflow")).toBeVisible({ timeout: 15000 });

      // The Figma redesign moved the warnings off the end of the page and behind
      // the one 계산 방법과 한계 door. What this test protects is unchanged — they
      // must not have been DELETED by that move, and the screen must open on the
      // workflow rather than on a wall of caveats.
      await expect(page.getByTestId("facility-cost-notice")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "① 비용 계산 희망 지역 선택" })).toBeVisible();

      // ONE compact caveat stays readable WITHOUT opening anything — the frame's
      // own footnote — so the move did not leave the figures unqualified. The
      // paragraph forms (screening sentence, long 표준공사비 non-claim) are behind
      // the door, in full, and are asserted there below.
      await expect(page.getByTestId("facility-cost-result-footnote")).toBeVisible();
      await expect(page.getByTestId("suitability-screening-disclaimer")).toHaveCount(0);
      await expect(page.getByTestId("facility-cost-standing-non-claims")).toHaveCount(0);

      // …and the full eight-item list is still there, in full, behind the door.
      await page.getByTestId("facility-cost-open-details").click();
      const dialog = page.getByTestId("facility-cost-details");
      await expect(dialog).toBeVisible();
      const notice = page.getByTestId("facility-cost-notice");
      const completeness = page.getByTestId("facility-cost-completeness");
      await expect(notice).toHaveCount(1);
      // Both paragraph forms are here, unchanged — nothing was softened by moving
      // them off the primary screen.
      await expect(notice).toContainText("광역 후보지 스크리닝");
      await expect(notice).toContainText("주민 개인에게 청구되는");
      await expect(completeness).toHaveCount(1);
      await expect(completeness).toContainText("8가지");

      // Usable at this width: the panel fits and never scrolls the page sideways.
      const panelBox = (await dialog.boundingBox())!;
      expect(panelBox.width).toBeLessThanOrEqual(vp.width + 1);
      await expectNoHorizontalOverflow(page, `${vp.name} cost details open`);

      await page.getByTestId("facility-cost-details-close").click();
      await expect(dialog).toHaveCount(0);
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
