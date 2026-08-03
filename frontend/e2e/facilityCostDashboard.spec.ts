import { expect, test, type Page, type Route } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * 비용 살펴보기 dashboard refresh — desktop acceptance for the facility-cost
 * milestone.
 *
 * Complements the existing cost coverage rather than repeating it:
 * `facilityCost.spec.ts` owns the setup interaction (search, bulk select, chips,
 * stream change) and `phase3CostResults.spec.ts` owns the setup↔results transition
 * and the exact-value contract. This file owns what the REFRESHED screen newly
 * promises at the four desktop targets — the setup stages and the readiness summary
 * being reachable without clipping, the pre-calculation instruction existing at all,
 * the result reading as titled sections with the cost composition visible in place,
 * and the long report scrolling as an ordinary document with no nested scroll traps
 * and no horizontal overflow.
 *
 * Self-mocked through `mockBackend` plus a synthetic multi-region waste-statistics
 * set so the picker has something to choose. The cost result is a CONTROLLED
 * CONTRACT FIXTURE — analytical standard-cost data shown only with its disclaimer
 * and completeness, never labelled as official metric data. This spec asserts
 * structure, geometry, and behaviour, never that a quantity is a real value.
 *
 * Deliberately NO pixel snapshots: the repository has no visual-regression
 * infrastructure (docs/ui-refresh/baseline.md §7).
 */

const VIEWPORTS = [
  { name: "1024×768 (minimum supported)", width: 1024, height: 768 },
  { name: "1280×800", width: 1280, height: 800 },
  { name: "1440×900", width: 1440, height: 900 },
  { name: "1920×1080", width: 1920, height: 1080 },
];

const PICKER_REGIONS = [
  { code: "KR-SGIS-11110", name: "종로구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-11140", name: "중구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-23010", name: "중구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-23510", name: "강화군", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-31011", name: "수원시 장안구", stream: "HOUSEHOLD" },
];

const WASTE_STATISTICS = {
  reference_year: 2022,
  count: PICKER_REGIONS.length,
  items: PICKER_REGIONS.map((r) => ({
    region_code: r.code,
    region_name: r.name,
    waste_stream: r.stream,
    waste_category_name: "총계",
    generation_quantity: "10500.000000",
    recycling_quantity: "0",
    incineration_quantity: "0",
    landfill_quantity: "0",
    other_treatment_quantity: "10500.000000",
    total_treatment_quantity: "10500.000000",
    total_treatment_is_derived: true,
    quantity_unit: "톤/년",
    accounting_basis: "ORIGIN_BASED_TREATMENT_OUTCOME",
    source_id: "waste_statistics",
    source_pid: "NTN007",
    official_dataset_name: "RCIS 생활계",
    reference_year: 2022,
    reference_period: "2022",
  })),
};

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
  // Registered after mockBackend, so this handler wins for its path.
  await page.route("**/api/v1/waste-statistics**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(WASTE_STATISTICS),
    }),
  );
});

async function openCost(page: Page): Promise<void> {
  await page.goto("/?v=1&mode=suitability&view=cost");
  await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible();
  await expect(page.getByTestId("facility-cost-form")).toBeVisible();
}

async function calculate(page: Page, regionName = "서울 종로구"): Promise<void> {
  await page.getByTestId("facility-cost-region-search").click();
  await page.getByTestId("facility-cost-region-option").filter({ hasText: regionName }).click();
  await page.getByTestId("facility-cost-calculate").click();
  await expect(page.getByTestId("facility-cost-results-view")).toBeVisible();
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

/** Every element that scrolls vertically inside the dashboard subtree. */
async function nestedScrollContainers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="facility-cost-dashboard"]');
    if (!root) return ["(dashboard missing)"];
    return Array.from(root.querySelectorAll<HTMLElement>("*"))
      .filter((el) => {
        const style = getComputedStyle(el);
        const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
        return scrolls && el.scrollHeight > el.clientHeight + 1;
      })
      .map((el) => el.getAttribute("data-testid") ?? el.tagName.toLowerCase());
  });
}

// --------------------------------------------------------------------------- //
// Geometry and reachability, at every supported desktop viewport
// --------------------------------------------------------------------------- //

for (const vp of VIEWPORTS) {
  test.describe(`cost dashboard at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("keeps the whole setup workflow reachable, with the action on the first screen", async ({
      page,
    }) => {
      await openCost(page);

      // The cost view is map-free and does not duplicate the shared chrome.
      await expect(page.getByTestId("map-container")).toHaveCount(0);
      await expect(page.locator("h1")).toHaveCount(1);
      // The shell's one navigation region (a labelled `role="group"`, not a <nav> —
      // see docs/ui-refresh/regression-contract.md §1) is located the way
      // civicShell.spec.ts locates it.
      await expect(page.getByTestId("top-navigation")).toHaveCount(1);
      await expect(page.getByTestId("mode-switch")).toHaveCount(1);
      await expect(page.getByTestId("suitability-subviews")).toHaveCount(1);
      await expect(page.locator("#main-content")).toHaveCount(1);

      // The three setup stages exist and are individually reachable.
      for (const heading of ["1. 처리할 지역", "2. 처리 조건", "3. 계산 가정"]) {
        const step = page.getByRole("heading", { name: heading });
        await step.scrollIntoViewIfNeeded();
        await expect(step, heading).toBeVisible();
      }
      await page.mouse.wheel(0, -2000);

      // The primary action is inside the first viewport before any scrolling —
      // that is what the sticky summary rail exists for.
      const calculate = page.getByTestId("facility-cost-calculate");
      const box = (await calculate.boundingBox())!;
      expect(box.y, "calculate button starts on screen").toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, "calculate button is not clipped").toBeLessThanOrEqual(vp.height);

      // …and the readiness summary beside it explains why it is disabled.
      await expect(page.getByTestId("facility-cost-readiness")).toContainText("한 곳 이상 선택하세요");
      await expect(calculate).toBeDisabled();

      await expectNoHorizontalOverflow(page, "cost setup");
    });

    test("states that nothing has been calculated yet, and never shows a placeholder cost", async ({
      page,
    }) => {
      await openCost(page);
      const empty = page.getByTestId("facility-cost-no-result");
      await empty.scrollIntoViewIfNeeded();
      await expect(empty).toBeVisible();
      await expect(empty).toContainText("비용이 0이라는 뜻이 아니며");
      // No result-shaped surface exists before a calculation.
      await expect(page.getByTestId("facility-cost-results")).toHaveCount(0);
      await expect(page.getByTestId("facility-cost-hero")).toHaveCount(0);
      await expect(page.getByTestId("facility-cost-funding")).toHaveCount(0);
    });

    test("shows the selected region and the validation message without clipping either", async ({
      page,
    }) => {
      await openCost(page);
      await page.getByTestId("facility-cost-region-search").click();
      await page.getByTestId("facility-cost-region-option").filter({ hasText: "인천 강화군" }).click();

      // The selection is visible in the picker AND restated in the summary rail.
      await expect(page.getByTestId("facility-cost-selected-regions")).toContainText("인천 강화군");
      await expect(page.getByTestId("facility-cost-summary-regions")).toContainText("인천 강화군");
      await expect(page.getByTestId("facility-cost-readiness")).toContainText("1개 선택됨");

      // An out-of-range value blocks the action and is visible in both places.
      await page.getByTestId("facility-cost-processing-share").fill("150");
      await expect(page.getByTestId("facility-cost-calculate")).toBeDisabled();
      const status = page.getByTestId("facility-cost-calculate-status");
      await expect(status).toContainText("0–100");
      await expect(status).toBeVisible();
      // The accordion opens itself so the invalid field is never hidden.
      await expect(page.getByTestId("facility-cost-validation")).toBeVisible();

      await expectNoHorizontalOverflow(page, "cost validation");
    });

    test("lays the result out as titled sections that scroll as one document", async ({ page }) => {
      await openCost(page);
      await calculate(page);

      // The headline answer is on the first screen of the result.
      const hero = page.getByTestId("facility-cost-hero");
      await expect(hero).toBeVisible();
      const heroBox = (await hero.boundingBox())!;
      expect(heroBox.y + heroBox.height, "hero fits the first viewport").toBeLessThanOrEqual(
        vp.height,
      );

      // Every result section is present and reachable by ordinary page scrolling.
      for (const title of [
        "핵심 결과",
        "비용 구성",
        "빠진 항목과 주의사항",
        "분석에 사용한 공식 자료",
        "계산 기준·출처·버전",
      ]) {
        const section = page.getByRole("heading", { name: title });
        await section.scrollIntoViewIfNeeded();
        await expect(section, title).toBeVisible();
      }

      // The report is a normally-scrolling document, not a set of independently
      // scrolling panels.
      const scrolled = await page.evaluate(() => window.scrollY);
      expect(scrolled, "the document itself scrolls").toBeGreaterThan(0);
      expect(await nestedScrollContainers(page), "no nested vertical scroll panes").toEqual([]);

      await expectNoHorizontalOverflow(page, "cost results");
    });

    test("shows the cost composition and the KPI row in place, within the content width", async ({
      page,
    }) => {
      await openCost(page);
      await calculate(page);

      // The cost composition is readable without opening a disclosure.
      const funding = page.getByTestId("facility-cost-funding");
      await funding.scrollIntoViewIfNeeded();
      await expect(funding).toBeVisible();
      await expect(page.getByTestId("fc-funding-subsidy")).toBeVisible();
      await expect(page.getByTestId("fc-funding-local")).toBeVisible();
      await expect(page.getByTestId("fc-funding-total")).toBeVisible();

      // Neither the KPI row nor the composition row overflows its own container.
      const overflow = await page.evaluate(() => {
        const ids = ["facility-cost-results", "facility-cost-funding"];
        return ids.map((id) => {
          const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
          return { id, over: el ? el.scrollWidth - el.clientWidth : 0 };
        });
      });
      for (const { id, over } of overflow) {
        expect(over, `${id} does not overflow horizontally`).toBeLessThanOrEqual(1);
      }
    });

    test("keeps a wide table's overflow inside the table, and the result actions reachable", async ({
      page,
    }) => {
      await openCost(page);
      await calculate(page);

      await page.getByTestId("facility-cost-region-section-summary").click();
      await expect(page.getByTestId("facility-cost-region-table")).toBeVisible();
      // The table's own container is the bounded fallback, not the page.
      const bounded = await page.evaluate(() => {
        const table = document.querySelector('[data-testid="facility-cost-region-table"] table');
        const holder = table?.parentElement;
        return holder ? getComputedStyle(holder).overflowX : null;
      });
      expect(bounded).toBe("auto");
      await expectNoHorizontalOverflow(page, "cost region table open");

      // The result actions area is reachable and its one real action works.
      const actions = page.getByTestId("facility-cost-result-actions");
      await actions.scrollIntoViewIfNeeded();
      await expect(actions).toBeVisible();
      await page.getByTestId("facility-cost-edit-settings").click();
      await expect(page.getByTestId("facility-cost-setup-view")).toBeVisible();
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(1);
    });
  });
}

// --------------------------------------------------------------------------- //
// Cross-view regression — the cost refresh must not touch the map sub-views
// --------------------------------------------------------------------------- //

test.describe("suitability sub-view regression at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("switches cost ↔ score ↔ scenario with one map on each map sub-view", async ({ page }) => {
    await openCost(page);
    await expect(page.getByTestId("map-container")).toHaveCount(0);
    await expect(page.getByTestId("suitability-subviews")).toHaveCount(1);

    // cost → score restores the score workspace and its single map.
    await page.getByTestId("suitability-view-score").click();
    await expect(page.getByTestId("suitability-summary")).toBeVisible();
    await expect(page.getByTestId("map-container")).toHaveCount(1);
    await expect(page.getByTestId("facility-cost-dashboard")).toHaveCount(0);
    await expect(page.locator("h1")).toHaveCount(1);

    // score → cost, then cost → scenario, which also keeps exactly one map.
    await page.getByTestId("suitability-view-cost").click();
    await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible();
    await page.getByTestId("suitability-view-scenario").click();
    await expect(page.getByTestId("scenario-lab")).toBeVisible();
    await expect(page.getByTestId("map-container")).toHaveCount(1);

    // scenario → cost is still map-free, and the sub-view control never doubles.
    await page.getByTestId("suitability-view-cost").click();
    await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible();
    await expect(page.getByTestId("map-container")).toHaveCount(0);
    await expect(page.getByTestId("suitability-subviews")).toHaveCount(1);
    await expect(page.getByTestId("suitability-view-cost")).toHaveAttribute("aria-pressed", "true");
  });

  test("restores a shared cost link directly, with the screening disclaimer intact", async ({
    page,
  }) => {
    await openCost(page);
    await expect(page.getByTestId("suitability-view-cost")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("suitability-screening-disclaimer")).toBeVisible();
    await expect(page.getByTestId("facility-cost-disclaimer")).toContainText(
      "권고하거나 반대를 설득하기 위한 페이지가 아닙니다",
    );
    await expect(page.getByTestId("map-container")).toHaveCount(0);
  });
});
