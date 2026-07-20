import { expect, test, type Page, type Route } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Facility cost lens e2e — the setup workflow redesigned in Phase 2 of the desktop
 * redesign, plus the unchanged result values below it.
 *
 * Uses mockBackend (the cost result is a CONTROLLED CONTRACT FIXTURE — analytical
 * standard-cost data shown only with its disclaimer + completeness, never labelled
 * as official metric data), then overrides the waste statistics with a SYNTHETIC
 * multi-region set so the redesigned picker has something to search, bulk-select,
 * and narrow. Those rows exist only to give the picker options; this spec asserts
 * interaction and layout on them, never their quantities.
 *
 * Verified at the two desktop redesign targets (1440×900 primary, 1280×800
 * secondary) and at the existing mobile viewport, so the desktop-first work cannot
 * silently regress the mobile layout.
 */

const ONE_REGION = {
  type: "FeatureCollection",
  reference_year: 2024,
  count: 1,
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [126.97, 37.57],
            [126.99, 37.57],
            [126.99, 37.59],
            [126.97, 37.59],
            [126.97, 37.57],
          ],
        ],
      },
      properties: {
        region_code: "KR-SGIS-11110",
        region_name: "종로구",
        region_level: "SIGUNGU",
        parent_region_code: "KR-SGIS-11",
        source_id: "sgis",
        boundary_reference_period: "2024",
      },
    },
  ],
};

/**
 * Calculable regions across all three metropolitan areas, including the two 중구
 * (Seoul KR-SGIS-11140 / Incheon KR-SGIS-23010) that share a name — the case the
 * redesigned picker must disambiguate WITHOUT showing a code. The single
 * CONSTRUCTION row makes the stream change narrow the offered set to one region.
 */
const PICKER_REGIONS = [
  { code: "KR-SGIS-11110", name: "종로구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-11140", name: "중구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-23010", name: "중구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-23510", name: "강화군", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-31011", name: "수원시 장안구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-11110", name: "종로구", stream: "CONSTRUCTION" },
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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

/** Open the cost lens directly by URL, as a shared link would. */
async function gotoCost(page: Page): Promise<void> {
  await page.goto("/?v=1&mode=suitability&view=cost");
  await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible();
}

function optionByName(page: Page, name: string) {
  return page.getByTestId("facility-cost-region-option").filter({ hasText: name });
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
  // Registered after mockBackend, so these handlers win for their paths.
  await page.route("**/api/v1/regions/boundaries**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ONE_REGION),
    }),
  );
  await page.route("**/api/v1/waste-statistics**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(WASTE_STATISTICS),
    }),
  );
});

const VIEWPORTS = [
  { name: "mobile 390×844", width: 390, height: 844, desktop: false },
  { name: "desktop 1280×800", width: 1280, height: 800, desktop: true },
  { name: "desktop 1440×900", width: 1440, height: 900, desktop: true },
];

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("drives the cost lens from the redesigned setup to results", async ({ page }) => {
      await gotoCost(page);

      // The cost lens is a full-width dashboard that mounts no map, and it reuses
      // the shared chrome rather than duplicating it.
      await expect(page.getByTestId("map-container")).toHaveCount(0);
      await expect(page.getByTestId("top-navigation")).toHaveCount(1);
      await expect(page.getByTestId("suitability-subviews")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("#main-content")).toHaveCount(1);
      await expect(page.getByTestId("facility-cost-disclaimer")).toContainText(
        "권고하거나 반대를 설득하기 위한 페이지가 아닙니다",
      );

      // Calculate is disabled until a service region is chosen, and says why.
      await expect(page.getByTestId("facility-cost-calculate")).toBeDisabled();
      await expect(page.getByTestId("facility-cost-calculate-status")).toContainText(
        "지역을 한 곳 이상 선택",
      );

      // ── Search, then select by KEYBOARD ────────────────────────────────────
      const search = page.getByTestId("facility-cost-region-search");
      await search.click();
      await search.fill("강화");
      await expect(page.getByTestId("facility-cost-region-option")).toHaveCount(1);
      await expect(optionByName(page, "인천 강화군")).toBeVisible();
      await search.press("ArrowDown");
      await search.press("Enter");
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(1);

      // ── Select another by CLICK, with no Ctrl/Cmd anywhere ────────────────
      await search.fill("중구");
      await expect(page.getByTestId("facility-cost-region-option")).toHaveCount(2);
      // The two 중구 are told apart by their metropolitan prefix, not by a code.
      await expect(optionByName(page, "서울 중구")).toBeVisible();
      await expect(optionByName(page, "인천 중구")).toBeVisible();
      await optionByName(page, "서울 중구").click();
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(2);
      await expect(page.getByTestId("facility-cost-selected-regions")).toContainText("서울 중구");
      await expect(page.getByTestId("facility-cost-calculate")).toBeEnabled();

      // ── Remove ONE chip ───────────────────────────────────────────────────
      await page.getByRole("button", { name: "서울 중구 제거" }).click();
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(1);
      await expect(page.getByTestId("facility-cost-selected-regions")).toContainText("인천 강화군");

      // ── Bulk-select Seoul, then clear everything ──────────────────────────
      await page.getByTestId("facility-cost-regions-seoul").click();
      // 종로구 + 중구 are the calculable Seoul regions; 강화군 stays selected.
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(3);
      await page.getByTestId("facility-cost-regions-clear").click();
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(0);
      await expect(page.getByTestId("facility-cost-calculate")).toBeDisabled();

      // ── Changing the waste stream clears the selection and re-derives the set ─
      await page.getByTestId("facility-cost-regions-seoul").click();
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(2);
      await page.getByTestId("facility-cost-waste-stream").selectOption("CONSTRUCTION");
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(0);
      await expect(page.getByTestId("facility-cost-calculate")).toBeDisabled();
      await search.click();
      // Only the one CONSTRUCTION region remains offered.
      await expect(page.getByTestId("facility-cost-region-option")).toHaveCount(1);
      await expect(optionByName(page, "서울 종로구")).toBeVisible();
      await page.getByTestId("facility-cost-waste-stream").selectOption("HOUSEHOLD");

      // ── Facility type through the card UI ─────────────────────────────────
      const cards = page.getByTestId("facility-cost-facility-type-card");
      await expect(cards).toHaveCount(2);
      await cards.nth(1).click();
      await expect(cards.nth(1)).toHaveAttribute("data-selected", "true");
      await expect(page.getByTestId("facility-cost-setup-summary")).toContainText("신규 소각시설");
      await cards.nth(0).click();

      // ── Advanced settings expand on demand ────────────────────────────────
      const advanced = page.getByTestId("facility-cost-advanced-settings");
      await expect(advanced).not.toHaveAttribute("open", "");
      await page.getByTestId("facility-cost-advanced-settings-summary").click();
      await expect(page.getByTestId("facility-cost-operating-days")).toBeVisible();
      await expect(page.getByTestId("facility-cost-subsidy-note")).toContainText(
        "승인된 국고보조금이 아",
      );

      // ── No raw region code is visible anywhere in the setup ───────────────
      const setupText = await page.getByTestId("facility-cost-form").innerText();
      expect(setupText).not.toContain("KR-SGIS");

      // ── No deliberation section survives ──────────────────────────────────
      await expect(page.getByTestId("facility-cost-conditions")).toHaveCount(0);
      await expect(page.getByText("시민 검토 조건")).toHaveCount(0);
      await expect(page.getByText("서버로 전송되거나 집계되지 않습니다")).toHaveCount(0);

      // ── Submit a valid calculation ────────────────────────────────────────
      // The popup closed when focus moved to the cards/accordion above; reopening
      // it is the ordinary way back in, and no selection was lost.
      await search.click();
      await optionByName(page, "서울 종로구").click();
      const calculate = page.getByTestId("facility-cost-calculate");
      await expect(calculate).toBeEnabled();
      await calculate.click();

      // Phase 3: a successful calculation REPLACES the setup with the results view.
      await expect(page.getByTestId("facility-cost-results-view")).toBeVisible();
      await expect(page.getByTestId("facility-cost-setup-view")).toHaveCount(0);
      await expect(page.getByTestId("facility-cost-results")).toBeVisible();

      // Primary surfaces show the APPROXIMATION; the exact fixture strings live in
      // the "정밀값과 계산 기준" section (asserted in phase3CostResults.spec.ts).
      await expect(page.getByTestId("fc-standard-cost")).toHaveText("약 121억원");
      await expect(page.getByTestId("fc-per-capita")).toHaveText("약 4만원");

      // Exclusions are still shown as explicitly unavailable, never a total.
      await expect(page.getByTestId("facility-cost-exclusions-summary")).toContainText(
        "포함되지 않은 비용 5개",
      );
      await expect(page.getByText("총비용")).toHaveCount(0);

      // Still exactly one h1 and one skip target on the results screen.
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("#main-content")).toHaveCount(1);

      // Returning to setup keeps the selection and issues no new calculation.
      await page.getByTestId("facility-cost-edit-settings").click();
      await expect(page.getByTestId("facility-cost-setup-view")).toBeVisible();
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(1);
      await expect(page.getByTestId("facility-cost-results-view")).toHaveCount(0);

      await expectNoHorizontalOverflow(page);

      // Back to the score view restores the screening panel and the map.
      await page.getByTestId("suitability-view-score").click();
      await expect(page.getByTestId("suitability-summary")).toBeVisible();
      await expect(page.getByTestId("map-container")).toBeVisible();
      await expect(page.getByTestId("facility-cost-dashboard")).toHaveCount(0);
    });

    test("keeps the primary action reachable without scrolling to the end of the form", async ({
      page,
    }) => {
      await gotoCost(page);
      const summary = page.getByTestId("facility-cost-setup-summary");
      const calculate = page.getByTestId("facility-cost-calculate");
      await expect(summary).toBeVisible();

      if (vp.desktop) {
        // Desktop: the summary is the sticky right rail, so the calculate button is
        // already inside the viewport before any scrolling.
        const box = (await calculate.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height);

        // It stays inside the viewport after scrolling down the long left column.
        await page.mouse.wheel(0, 1200);
        await page.waitForTimeout(150);
        const after = (await calculate.boundingBox())!;
        expect(after.y).toBeGreaterThanOrEqual(0);
        expect(after.y + after.height).toBeLessThanOrEqual(vp.height);
      } else {
        // Stacked widths: the summary returns to normal document flow (not stuck to
        // the viewport), and stays reachable by scrolling.
        await calculate.scrollIntoViewIfNeeded();
        await expect(calculate).toBeVisible();
      }

      await expectNoHorizontalOverflow(page);
    });
  });
}
