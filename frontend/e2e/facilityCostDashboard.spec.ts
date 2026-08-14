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
  await expect(page.getByTestId("facility-cost-workflow")).toBeVisible();
}

async function calculate(page: Page, regionName = "서울 종로구"): Promise<void> {
  await page.getByTestId("facility-cost-region-search").click();
  await page.getByTestId("facility-cost-region-option").filter({ hasText: regionName }).click();
  await page.getByTestId("facility-cost-calculate").click();
  // The result appears IN card ③, beside the inputs — no view switch.
  await expect(page.getByTestId("facility-cost-results")).toBeVisible();
}

/** Open 계산 방법과 한계, the one door to everything the workflow no longer shows inline. */
async function openDetails(page: Page): Promise<void> {
  await page.getByTestId("facility-cost-open-details").click();
  await expect(page.getByTestId("facility-cost-details")).toBeVisible();
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
 * Put the page at the very top and PROVE it got there before anything is measured.
 *
 * The first-screen assertion below used to return to the top with
 * `page.mouse.wheel(0, -2000)`, which is a race: a wheel event is dispatched, not
 * awaited, so the bounding box could be read while the scroll was still settling —
 * and against a partially-scrolled page a clipped button measures as if it fitted.
 * That nondeterminism is why the real 1024×768 defect (button bottom 838 of 768)
 * survived several full-suite runs. `scrollTo` + a polled `scrollY === 0` removes
 * the race entirely: nothing is measured until the document is provably at offset 0.
 */
async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { message: "document settled at the top" })
    .toBe(0);
}

/**
 * The full first-screen contract for the primary action, at `viewportHeight`.
 *
 * Asserts the action is at offset 0 of the document, entirely inside the viewport,
 * actually hit-testable at its own centre (so no sticky element, overlay, or
 * neighbouring card covers it), that the context explaining its state is on the same
 * screen, and that the page has not started scrolling sideways.
 */
async function expectActionOnFirstScreen(page: Page, viewportHeight: number): Promise<void> {
  await scrollToTop(page);

  const calculate = page.getByTestId("facility-cost-calculate");
  await expect(calculate).toBeVisible();

  const geometry = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="facility-cost-calculate"]')!;
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      scrollY: window.scrollY,
      top: box.top,
      bottom: box.bottom,
      height: box.height,
      // The action must be the thing at its own centre — `el.contains(hit)` also
      // accepts the button's own text node wrapper, and nothing else.
      coveredBy: hit === null ? "(nothing)" : el.contains(hit) ? null : describe(hit),
    };

    function describe(node: Element): string {
      return node.getAttribute("data-testid") ?? node.tagName.toLowerCase();
    }
  });

  expect(geometry.scrollY, "measured at the top of the document").toBe(0);
  expect(geometry.top, "calculate button starts on screen").toBeGreaterThanOrEqual(0);
  expect(geometry.bottom, "calculate button is not clipped by the fold").toBeLessThanOrEqual(
    viewportHeight,
  );
  // The pre-existing 44px target is a floor, not a value to shrink to fit.
  expect(geometry.height, "calculate button keeps its target size").toBeGreaterThanOrEqual(44);
  expect(geometry.coveredBy, "calculate button is not overlapped").toBeNull();

  // The context that explains why the action is enabled or disabled is on the same
  // screen as the action — a reachable-by-scrolling explanation is not equivalent.
  // The 준비 상태 checklist is retired: every row restated something already on
  // screen, so this single blocked-reason line now carries that whole contract.
  await expect(page.getByTestId("facility-cost-calculate-status")).toBeInViewport();

  await expectNoHorizontalOverflow(page, "cost setup first screen");
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
      // The sub-view bar is retired — the six destinations select `view` (spec §2.1).
    await expect(page.getByTestId("suitability-subviews")).toHaveCount(0);
      await expect(page.locator("#main-content")).toHaveCount(1);

      // The primary action is inside the first viewport with the page at offset 0,
      // BEFORE anything has scrolled. This is the contract the summary rail exists
      // for, and it is measured on the as-loaded page, not on a page that has been
      // scrolled and sent back up.
      await expectActionOnFirstScreen(page, vp.height);

      // …and the status line beside it explains why it is disabled.
      await expect(page.getByTestId("facility-cost-calculate-status")).toContainText(
        "한 곳 이상 선택하면",
      );
      await expect(page.getByTestId("facility-cost-calculate")).toBeDisabled();

      // The three workflow cards of the Figma single screen exist and are
      // individually reachable. 계산 가정 is no longer a fourth setup stage — it is
      // an advanced disclosure inside card ②, and its full text lives in the
      // 계산 방법과 한계 dialog.
      for (const heading of ["① 비용 계산 희망 지역 선택", "② 계산 조건", "③ 비용 계산 결과"]) {
        const step = page.getByRole("heading", { name: heading });
        await step.scrollIntoViewIfNeeded();
        await expect(step, heading).toBeVisible();
      }

      // Returning to the top restores the same first-screen state — the rail is not
      // a one-shot initial-paint effect.
      await expectActionOnFirstScreen(page, vp.height);
    });

    test("states that nothing has been calculated yet, and never shows a placeholder cost", async ({
      page,
    }) => {
      await openCost(page);
      const empty = page.getByTestId("facility-cost-no-result");
      await empty.scrollIntoViewIfNeeded();
      await expect(empty).toBeVisible();
      await expect(empty).toContainText("아직 계산한 결과가 없습니다");
      // The empty state shows no number at all — the guarantee that mattered. Its
      // "not a zero" restatement moved to 계산 방법과 한계 with the other caveats.
      await expect(empty).not.toContainText(/\d/);
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

      // The selection is visible in the picker AND restated in card ③'s condition
      // summary, which is what the retired 준비 상태 row used to duplicate.
      await expect(page.getByTestId("facility-cost-selected-regions")).toContainText("인천 강화군");
      await expect(page.getByTestId("facility-cost-summary-regions")).toContainText("인천 강화군");
      await expect(page.getByTestId("facility-cost-summary-regions")).toContainText("1개");

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

    test("answers on the same screen as the inputs, with no nested scroll trap", async ({ page }) => {
      await openCost(page);
      await calculate(page);

      // The headline answer is on the first screen, WITHOUT scrolling: that is the
      // point of the single-screen workflow, where the old design put the report
      // below a view switch.
      await scrollToTop(page);
      const hero = page.getByTestId("facility-cost-hero");
      await expect(hero).toBeVisible();
      const heroBox = (await hero.boundingBox())!;
      expect(heroBox.y + heroBox.height, "hero fits the first viewport").toBeLessThanOrEqual(
        vp.height,
      );

      // The inputs that produced it are still on screen beside it — there is no
      // longer a results screen the citizen has to leave in order to change one.
      await expect(page.getByTestId("facility-cost-step-regions")).toBeVisible();
      await expect(page.getByTestId("facility-cost-step-conditions")).toBeVisible();
      await expect(page.getByTestId("facility-cost-region-search")).toBeVisible();

      // The workflow is an ordinary document, not a set of independently scrolling
      // panels. Measured with the details dialog CLOSED — a dialog body legitimately
      // scrolls within itself.
      expect(await nestedScrollContainers(page), "no nested vertical scroll panes").toEqual([]);

      await expectNoHorizontalOverflow(page, "cost results");
    });

    test("keeps every detail section behind one door, and the composition inside it", async ({
      page,
    }) => {
      await openCost(page);
      await calculate(page);
      await openDetails(page);

      // Everything the primary workflow no longer shows inline is reachable here,
      // and nowhere else. `포함되지 않은 비용` carries a live count, so it is matched
      // by prefix rather than exactly.
      for (const label of [
        "이 계산의 범위",
        "지역 자료 범위",
        "비용 구성",
        "지역별 공식 투입 데이터",
        "계산 가정",
        "출처와 계산 방법",
        "정밀값과 계산 기준",
      ]) {
        await expect(
          page.getByTestId("facility-cost-details").getByText(label, { exact: false }).first(),
          label,
        ).toBeVisible();
      }

      // The cost composition lives under 비용 구성 and reads in full once opened.
      await page.getByTestId("facility-cost-breakdown-section-summary").click();
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

      await expectNoHorizontalOverflow(page, "cost details open");
    });

    test("keeps a wide table's overflow inside the table, and edits without a return trip", async ({
      page,
    }) => {
      await openCost(page);
      await calculate(page);
      await openDetails(page);

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

      // Closing the one door returns to the workflow with the selection intact —
      // there is no 설정 바꾸기 return trip any more, because the setup was never
      // left. Changing an input marks the standing answer stale rather than
      // displaying it beside inputs that no longer produced it.
      await page.getByTestId("facility-cost-details-close").click();
      await expect(page.getByTestId("facility-cost-details")).toHaveCount(0);
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(1);

      await page.getByTestId("facility-cost-processing-share").fill("60");
      await expect(page.getByTestId("facility-cost-stale")).toBeVisible();
      await expect(page.getByTestId("facility-cost-results")).toHaveCount(0);
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
    // The sub-view bar is retired — the six destinations select `view` (spec §2.1).
    await expect(page.getByTestId("suitability-subviews")).toHaveCount(0);

    // cost → score restores the score workspace and its single map.
    await page.getByTestId("mode-suitability").click();
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
    // The sub-view bar is retired — the six destinations select `view` (spec §2.1).
    await expect(page.getByTestId("suitability-subviews")).toHaveCount(0);
    await expect(page.getByTestId("suitability-view-cost")).toHaveAttribute("aria-pressed", "true");
  });

  test("restores a shared cost link directly, with the screening disclaimer intact", async ({
    page,
  }) => {
    await openCost(page);
    await expect(page.getByTestId("suitability-view-cost")).toHaveAttribute("aria-pressed", "true");
    // The primary workflow carries no disclaimer block at all — only the frame's
    // own compact footnote (Figma 129:5709). The screening sentence is INTACT but
    // lives in 계산 방법과 한계 (docs/SUITABILITY_PHASE_0_TRANSPARENCY.md, the
    // 비용 살펴보기 exception), together with the longer "does not advocate" notice.
    await expect(page.getByTestId("facility-cost-result-footnote")).toBeVisible();
    await expect(page.getByTestId("suitability-screening-disclaimer")).toHaveCount(0);
    await openDetails(page);
    await expect(page.getByTestId("facility-cost-notice")).toContainText("광역 후보지 스크리닝");
    await expect(page.getByTestId("facility-cost-disclaimer")).toContainText(
      "권고하거나 반대를 설득하기 위한 페이지가 아닙니다",
    );
    await page.getByTestId("facility-cost-details-close").click();
    await expect(page.getByTestId("map-container")).toHaveCount(0);
  });
});
