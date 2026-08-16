import { expect, test, type Page } from "@playwright/test";

import {
  mockLandfillBackend,
  mockLandfillNoData,
  mockLandfillServerError,
} from "./phase5Fixtures";

/**
 * 매립지 현황 dashboard refresh — desktop acceptance for the landfill milestone.
 *
 * Complements the existing landfill coverage rather than repeating it:
 * `phase5LandfillDashboard.spec.ts` owns the Phase 5 hierarchy contracts (KPI
 * dominance, the single banner, state separation, keyboard order, the filter row's
 * geometry) and `landfill.spec.ts` is the live-backend smoke test. This file owns
 * what the REFRESHED screen newly promises at the four desktop targets — the six
 * titled sections being reachable by ordinary document scrolling, the current-
 * selection summary reporting what was asked and what is held, per-card provenance,
 * chart and table agreeing, the exact-value table being the only bounded horizontal
 * fallback, and the cross-view map contract surviving a round trip.
 *
 * The landfill payloads come from `phase5Fixtures.ts` and are SYNTHETIC LAYOUT
 * FIXTURES — not official data (that file documents the reasoning and the marker
 * text they carry). No assertion here claims a value is correct; every numeric
 * assertion is an INTERNAL-CONSISTENCY check between two surfaces that must agree.
 *
 * Deliberately NO pixel snapshots: the repository has no visual-regression
 * infrastructure (docs/ui-refresh/baseline.md §7).
 */

const FLOW_URL = "/?v=1&mode=flow";

const VIEWPORTS = [
  { name: "1024×768 (minimum supported)", width: 1024, height: 768 },
  { name: "1280×800", width: 1280, height: 800 },
  { name: "1440×900", width: 1440, height: 900 },
  { name: "1920×1080", width: 1920, height: 1080 },
];

/** The six titled regions the refreshed workflow is built from, in reading order. */
const SECTIONS = [
  "landfill-filters",
  "landfill-headline",
  "landfill-trends",
  "landfill-composition",
  "landfill-region-table",
  "landfill-evidence",
];

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: no page-level horizontal overflow`).toBeLessThanOrEqual(
    clientWidth + 1,
  );
}

/** Deep-link straight into the landfill area and wait for its populated body. */
async function gotoLandfill(page: Page): Promise<void> {
  await page.goto(FLOW_URL);
  await expect(page.getByTestId("landfill-dashboard")).toBeVisible();
  await expect(page.getByTestId("landfill-kpis")).toBeVisible();
}

/** The tonnage inside a rendered string, e.g. "600,000 t · 54.5%" → 600000. */
function parseTons(text: string): number {
  const match = /([\d,]+(?:\.\d+)?)\s*t\b/.exec(text);
  expect(match, `no tonnage found in ${JSON.stringify(text)}`).not.toBeNull();
  return Number(match![1].replace(/,/g, ""));
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("renders one map-free workspace with the six titled sections", async ({ page }) => {
      await mockLandfillBackend(page);
      await gotoLandfill(page);

      // Global chrome, exactly once each.
      await expect(page.getByTestId("top-navigation")).toHaveCount(1);
      await expect(page.getByTestId("mode-switch")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("#main-content")).toHaveCount(1);
      await expect(page.locator("main")).toHaveCount(1);
      // No map, and no suitability sub-view control leaking into this area.
      await expect(page.getByTestId("map-container")).toHaveCount(0);
      await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
      await expect(page.getByTestId("suitability-subviews")).toHaveCount(0);

      // Every section is reachable by ordinary page scrolling — nothing is hidden
      // behind a tab, a drawer, or an independently scrolling pane.
      for (const testId of SECTIONS) {
        const section = page.getByTestId(testId);
        await section.scrollIntoViewIfNeeded();
        await expect(section, `${testId} must be reachable`).toBeVisible();
      }

      await expectNoHorizontalOverflow(page, "populated");
    });

    test("scrolls the document, not a pane, and keeps overflow local to the table", async ({
      page,
    }) => {
      await mockLandfillBackend(page);
      await gotoLandfill(page);

      // A long report scrolls the DOCUMENT. (A short viewport is not required to
      // fit the whole dashboard — only to reach all of it.)
      const scrolls = await page.evaluate(
        () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
      );
      expect(scrolls, "the landfill report scrolls the document").toBe(true);

      // The exact-value table owns the only bounded horizontal fallback, and it is
      // the container that scrolls — never the page.
      const overflowing = await page.evaluate(() => {
        const root = document.querySelector("[data-testid='landfill-dashboard']")!;
        return Array.from(root.querySelectorAll("*"))
          .filter((el) => {
            const style = getComputedStyle(el);
            return (
              (style.overflowX === "auto" || style.overflowX === "scroll") &&
              el.scrollWidth > el.clientWidth + 1
            );
          })
          .map((el) => el.closest("[data-testid]")?.getAttribute("data-testid") ?? "unknown");
      });
      for (const owner of overflowing) {
        expect(owner, "only the exact-value table may scroll sideways").toBe(
          "landfill-region-table",
        );
      }

      await expectNoHorizontalOverflow(page, "scrolled report");
    });

    test("shows the headline result and its per-card provenance after data loads", async ({
      page,
    }) => {
      await mockLandfillBackend(page);
      await gotoLandfill(page);

      const hero = page.getByTestId("landfill-kpi-quantity");
      await expect(hero).toBeVisible();
      await expect(hero.locator("dd").first()).toContainText(" t");
      // The headline is bigger than every other value on the screen. Measured on
      // each card's PRIMARY value — the 수수료 card carries two further <dd>s for the
      // conversions derived from it (Figma 234:441), which are deliberately smaller
      // still and are not what the hero is being compared against.
      const sizeOf = async (testId: string) =>
        page
          .getByTestId(testId)
          .locator("dd")
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      const heroSize = await sizeOf("landfill-kpi-quantity");
      expect(heroSize).toBeGreaterThan(await sizeOf("landfill-kpi-fee"));

      // Reported values and derived values are labelled apart, in text. The 수수료
      // card holds BOTH kinds (Figma 234:441): its own reported amount, and the two
      // conversions derived from it.
      await expect(hero.locator("dt [data-status='reported']")).toHaveText("공식 값");
      await expect(
        page.getByTestId("landfill-kpi-fee").locator("[data-status='derived']").first(),
      ).toHaveText("계산값");
      // The served period travels with the result.
      await expect(page.getByTestId("landfill-headline")).toContainText("기준 기간");
    });

    test("the exact-value table and the composition report the same quantities", async ({
      page,
    }) => {
      await mockLandfillBackend(page);
      await gotoLandfill(page);

      const rows = page.getByTestId("landfill-region-row");
      await expect(rows).toHaveCount(3);
      const tableTons = await Promise.all(
        // By test id, not by column index: the row now leads with the municipal
        // generation and throughput columns, so `td` index 0 is a different dataset.
        [0, 1, 2].map(async (index) =>
          parseTons(
            await rows.nth(index).getByTestId("landfill-region-quantity").innerText(),
          ),
        ),
      );
      const barTons = await Promise.all(
        [0, 1, 2].map(async (index) =>
          parseTons(
            await page
              .getByTestId("landfill-flow-structure")
              .locator("li")
              .nth(index)
              .innerText(),
          ),
        ),
      );
      // Same values, same order — the chart is a second encoding, not a second
      // calculation.
      expect(barTons).toEqual(tableTons);

      // And the monthly chart agrees with its own accessible table: one bar per
      // served month, one row per served month, never a zero-filled twelve.
      await page.getByTestId("landfill-trend-exact-summary").click();
      const bars = await page.getByTestId("landfill-trend-chart").locator("rect").count();
      const trendRows = await page
        .getByTestId("landfill-trend-table")
        .locator("tbody tr")
        .count();
      expect(trendRows).toBe(bars);

      await expectNoHorizontalOverflow(page, "table open");
    });
  });
}

test.describe("1440×900 — the refreshed workflow", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the selection summary restates what was asked and what is held", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);

    const selection = page.getByTestId("landfill-selection");
    await expect(selection).toBeVisible();
    // Defaults are named, never left blank or invented.
    await expect(selection).toContainText("최신 완결연도");
    await expect(selection).toContainText("연간");
    // The outcome is stated as official provenance plus the served period.
    await expect(page.getByTestId("landfill-selection-badge")).toHaveAttribute(
      "data-status",
      "reported",
    );
    await expect(page.getByTestId("landfill-selection-status")).toContainText("기준 기간");

    // Changing a filter updates the summary and the values together.
    await page.getByTestId("landfill-origin-select").selectOption("11");
    await expect(selection).toContainText("서울시");
    await expect(page.getByTestId("landfill-region-row")).toHaveCount(1);

    await page.getByTestId("landfill-waste-select").selectOption("생활폐기물");
    await expect(selection).toContainText("생활폐기물");

    // The summary is a report, not a second set of controls.
    await expect(selection.locator("select, input, button")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "filtered");
  });

  test("a partial year is stated beside the values it qualifies", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);
    await page.getByTestId("landfill-year-select").selectOption("2026");

    const partial = page.getByTestId("landfill-partial-year");
    await expect(partial).toBeVisible();
    await expect(partial).toContainText("2026-05");
    await expect(partial).toContainText("연간 합계가 아닙니다");
    // It sits inside the headline section, above the numbers it qualifies.
    const headline = page.getByTestId("landfill-headline");
    expect(await headline.locator("[data-testid='landfill-partial-year']").count()).toBe(1);
    const partialBox = (await partial.boundingBox())!;
    const kpiBox = (await page.getByTestId("landfill-kpis").boundingBox())!;
    expect(partialBox.y).toBeLessThan(kpiBox.y);
  });

  test("methodology and provenance stay reachable and openable", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);

    const evidence = page.getByTestId("landfill-evidence");
    await evidence.scrollIntoViewIfNeeded();
    await expect(evidence).toBeVisible();
    // The section says what it holds before anything is opened.
    await expect(evidence).toContainText("어느 자료의 어느 기간에서 왔는지");

    await page.getByTestId("landfill-evidence-sources-summary").click();
    await expect(page.getByTestId("landfill-population-source")).toContainText(
      "행정안전부 주민등록 인구통계",
    );
    await expect(page.getByTestId("landfill-fee-period")).not.toBeEmpty();
    await expect(page.getByTestId("reference-period").first()).not.toBeEmpty();

    await page.getByTestId("landfill-evidence-method-summary").click();
    await expect(page.getByTestId("landfill-derivation-version")).toBeVisible();

    await expectNoHorizontalOverflow(page, "evidence open");
  });

  test("no-data, failure, and populated are three visibly different screens", async ({ page }) => {
    // Populated.
    await mockLandfillBackend(page);
    await gotoLandfill(page);
    await expect(page.getByTestId("landfill-no-data")).toHaveCount(0);
    await expect(page.getByTestId("landfill-error")).toHaveCount(0);

    // No official record: an answer, not a fault. Neutral badge, no zeros, no
    // alert, and the evidence section is absent rather than rendered empty.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockLandfillNoData(page);
    await page.goto(FLOW_URL);
    await expect(page.getByTestId("landfill-no-data")).toBeVisible();
    await expect(page.getByTestId("landfill-error")).toHaveCount(0);
    await expect(page.getByTestId("landfill-kpis")).toHaveCount(0);
    await expect(page.getByTestId("landfill-evidence")).toHaveCount(0);
    await expect(page.getByTestId("landfill-selection-badge")).toHaveAttribute(
      "data-status",
      "missing",
    );
    await expect(page.getByTestId("landfill-selection-status")).toContainText(
      "값이 0이라는 뜻이 아닙니다",
    );
    await expect(page.getByTestId("landfill-no-data")).not.toContainText("0 t");
    await expectNoHorizontalOverflow(page, "no data");

    // A genuine failure: the only alert, and it claims nothing about the data.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockLandfillServerError(page);
    await page.goto(FLOW_URL);
    const error = page.getByTestId("landfill-error");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("landfill-no-data")).toHaveCount(0);
    await expect(page.getByTestId("landfill-kpis")).toHaveCount(0);
    await expect(page.getByTestId("landfill-selection-badge")).toHaveCount(0);
    await expect(page.getByTestId("landfill-selection-status")).toContainText(
      "자료를 불러오지 못해",
    );
    // Page-2 remediation: there is no standing scope panel in ANY state. The one
    // banner a failure may show is the retryable alert asserted above it.
    await expect(page.getByTestId("landfill-limitation")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "error");
  });

  test("the cross-view map contract survives a round trip through 매립지 현황", async ({
    page,
  }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);
    await expect(page.getByTestId("map-container")).toHaveCount(0);

    // 지역 부담 — one map.
    await page.getByTestId("mode-equity").click();
    await expect(page.getByTestId("map-container")).toHaveCount(1);

    // 후보지 분석 → 후보지 점수 and 가중치 바꿔보기 — one map each.
    await page.getByTestId("mode-suitability").click();
    await expect(page.getByTestId("map-container")).toHaveCount(1);
    await page.getByTestId("suitability-view-scenario").click();
    await expect(page.getByTestId("map-container")).toHaveCount(1);

    // 비용 살펴보기 — none.
    await page.getByTestId("suitability-view-cost").click();
    await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible();
    await expect(page.getByTestId("map-container")).toHaveCount(0);

    // Back to 매립지 현황 — still none, and the chrome never doubled.
    await page.getByTestId("mode-flow").click();
    await expect(page.getByTestId("landfill-dashboard")).toBeVisible();
    await expect(page.getByTestId("map-container")).toHaveCount(0);
    await expect(page.getByTestId("suitability-subviews")).toHaveCount(0);
    await expect(page.getByTestId("top-navigation")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByTestId("mode-flow")).toHaveText("지역별 폐기물 처리 현황");
    await expect(page.getByTestId("mode-flow")).toHaveAttribute("aria-pressed", "true");
    await expectNoHorizontalOverflow(page, "returned to landfill");
  });

  test("a shared landfill link restores its filters and its summary", async ({ page }) => {
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=flow&year=2024&month=3&origin=11&waste=생활폐기물");
    await expect(page.getByTestId("landfill-dashboard")).toBeVisible();

    await expect(page.getByTestId("landfill-year-select")).toHaveValue("2024");
    await expect(page.getByTestId("landfill-month-select")).toHaveValue("3");
    await expect(page.getByTestId("landfill-origin-select")).toHaveValue("11");
    await expect(page.getByTestId("landfill-waste-select")).toHaveValue("생활폐기물");

    // The summary reports the restored selection back, in words.
    const selection = page.getByTestId("landfill-selection");
    await expect(selection).toContainText("2024");
    await expect(selection).toContainText("3월");
    await expect(selection).toContainText("서울시");
    await expect(selection).toContainText("생활폐기물");
    await expectNoHorizontalOverflow(page, "restored link");
  });
});
