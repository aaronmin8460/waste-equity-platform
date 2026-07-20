import { expect, test, type Page, type Route } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Facility cost RESULTS workflow e2e (desktop redesign Phase 3).
 *
 * Phase 2 redesigned setup; Phase 3 splits setup from results and leads with one
 * answer. This spec asserts that split end to end: the transition, the hero + three
 * secondary KPIs, the collapsed detail accordions and the exact values inside them,
 * the absence of raw backend codes and raw region codes from the primary surface,
 * and the return-to-setup path preserving every input.
 *
 * Fixtures are SYNTHETIC (mockBackend's controlled contract fixture plus a
 * multi-region waste-statistics set so the picker has something to choose). This
 * spec asserts interaction, layout, and the presentation contract — never that any
 * quantity is a real official value.
 *
 * Verified at the two desktop redesign targets (1440×900 primary, 1280×800
 * secondary) plus the existing mobile viewport, so desktop-first work here cannot
 * silently regress the mobile layout.
 */

const PICKER_REGIONS = [
  { code: "KR-SGIS-11110", name: "종로구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-11140", name: "중구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-23010", name: "중구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-23510", name: "강화군", stream: "HOUSEHOLD" },
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

/** Backend reason codes that must never reach the primary results surface. */
const RAW_REASON_CODES = [
  "OFFICIAL_SOURCE_NOT_INTEGRATED",
  "ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE",
  "PARCEL_SPECIFIC_COST_UNAVAILABLE",
  "FACILITY_MASS_BALANCE_NOT_ESTABLISHED",
  "OPERATING_COST",
  "ACTUAL_TRANSPORT_COST",
];

/** The collapsed detail sections, in the order Phase 3 fixes them in. */
const RESULT_SECTIONS = [
  "facility-cost-funding-section",
  "facility-cost-region-section",
  "facility-cost-assumptions",
  "facility-cost-exclusions",
  "facility-cost-methodology-section",
  "facility-cost-exact-values",
];

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "no page-level horizontal overflow").toBeLessThanOrEqual(clientWidth + 1);
}

/** Open the cost lens directly by URL, as a shared link would. */
async function gotoCost(page: Page): Promise<void> {
  await page.goto("/?v=1&mode=suitability&view=cost");
  await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible();
  await expect(page.getByTestId("facility-cost-form")).toBeVisible();
}

/** Choose one region by its visible plain name and submit. */
async function calculate(page: Page, regionName = "서울 종로구"): Promise<void> {
  await page.getByTestId("facility-cost-region-search").click();
  await page.getByTestId("facility-cost-region-option").filter({ hasText: regionName }).click();
  await page.getByTestId("facility-cost-calculate").click();
  await expect(page.getByTestId("facility-cost-results-view")).toBeVisible();
}

/** Expand one accordion through its summary, as a citizen would. */
async function openSection(page: Page, testId: string): Promise<void> {
  await page.getByTestId(`${testId}-summary`).click();
  await expect(page.getByTestId(testId)).toHaveAttribute("open", "");
}

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

const VIEWPORTS = [
  { name: "desktop 1440x900", width: 1440, height: 900, desktop: true },
  { name: "desktop 1280x800", width: 1280, height: 800, desktop: true },
  { name: "mobile 390x844", width: 390, height: 844, desktop: false },
];

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("moves from setup to a results view that answers first", async ({ page }) => {
      await gotoCost(page);

      // ── Setup is the entry state ─────────────────────────────────────────
      await expect(page.getByTestId("facility-cost-setup-view")).toBeVisible();
      await expect(page.getByTestId("facility-cost-results-view")).toHaveCount(0);
      await expect(page.getByTestId("map-container")).toHaveCount(0);

      await calculate(page);

      // ── Results replace setup ────────────────────────────────────────────
      await expect(page.getByTestId("facility-cost-setup-view")).toHaveCount(0);
      await expect(page.getByTestId("facility-cost-calculate")).toHaveCount(0);

      // Shared chrome is not duplicated by the second view.
      await expect(page.getByTestId("top-navigation")).toHaveCount(1);
      await expect(page.getByTestId("suitability-subviews")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("#main-content")).toHaveCount(1);
      // The cost branch stays map-free on the results screen too.
      await expect(page.getByTestId("map-container")).toHaveCount(0);

      // ── One hero, three secondary KPIs ───────────────────────────────────
      await expect(page.getByTestId("facility-cost-hero")).toHaveCount(1);
      await expect(page.getByTestId("facility-cost-hero")).toContainText("주민 1인당 환산 지방비");
      await expect(page.getByTestId("fc-per-capita")).toHaveText("약 4만원");
      // The three supporting numbers, all approximations.
      await expect(page.getByTestId("fc-standard-cost")).toHaveText("약 121억원");
      await expect(page.getByTestId("fc-capacity")).toHaveText("35톤/일");
      await expect(page.getByTestId("fc-annualized")).toHaveText("약 8억원/년");

      // The hero is the largest number on the screen.
      if (vp.desktop) {
        const heroSize = await page
          .getByTestId("fc-per-capita")
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        const secondarySize = await page
          .getByTestId("fc-standard-cost")
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(heroSize).toBeGreaterThan(secondarySize);
      }

      // One compact standing disclaimer, and never a total-cost claim.
      await expect(page.getByTestId("facility-cost-results-notice")).toBeVisible();
      await expect(page.getByText("총비용")).toHaveCount(0);

      await expectNoHorizontalOverflow(page);
    });

    test("collapses every detail section, then reveals the exact values", async ({ page }) => {
      await gotoCost(page);
      await calculate(page);

      // Everything after the KPIs starts collapsed.
      for (const section of RESULT_SECTIONS) {
        await expect(page.getByTestId(section)).not.toHaveAttribute("open", "");
      }

      // The exclusions summary states how many items it holds before opening.
      await expect(page.getByTestId("facility-cost-exclusions-summary")).toContainText(
        "포함되지 않은 비용 5개",
      );

      // Funding: exact served strings, and no implication of approval.
      await openSection(page, "facility-cost-funding-section");
      await expect(page.getByTestId("fc-funding-subsidy")).toContainText("36.225 억원");
      await expect(page.getByTestId("fc-funding-local")).toContainText("84.525 억원");
      await expect(page.getByTestId("fc-funding-total")).toContainText("120.75 억원");
      await expect(page.getByTestId("facility-cost-funding")).toContainText("승인을 의미하지 않");

      // Exclusions: plain Korean, five items, never a zero cost.
      await openSection(page, "facility-cost-exclusions");
      await expect(page.getByTestId("facility-cost-missing-row")).toHaveCount(5);
      await expect(page.getByTestId("facility-cost-missing")).toContainText("운영비");
      await expect(page.getByTestId("facility-cost-missing")).toContainText("비용이 0이라는 뜻이");

      // Exact values: the untouched backend decimal strings.
      await openSection(page, "facility-cost-exact-values");
      await expect(page.getByTestId("fc-exact-standard-cost")).toContainText("120.75 억원");
      await expect(page.getByTestId("fc-exact-capacity")).toContainText("35 톤/일");
      await expect(page.getByTestId("fc-exact-annualized")).toContainText("8.05 억원/년");
      await expect(page.getByTestId("fc-exact-per-capita")).toContainText("42,262.5원");
      await expect(page.getByTestId("fc-official-quantity")).toContainText("10,500 톤/년");

      // The region table keeps its own horizontal scroll container.
      await openSection(page, "facility-cost-region-section");
      await expect(page.getByTestId("fc-region-row")).toHaveCount(1);

      // Opening every section must not break the page layout.
      await openSection(page, "facility-cost-assumptions");
      await openSection(page, "facility-cost-methodology-section");
      await expectNoHorizontalOverflow(page);
    });

    test("shows no raw region code and no raw reason code on the primary surface", async ({
      page,
    }) => {
      await gotoCost(page);
      await calculate(page);

      // innerText is the VISIBLE text, so a collapsed <details> body — including
      // every diagnostic disclosure — is correctly excluded from this check.
      const visible = await page.getByTestId("facility-cost-results-view").innerText();
      expect(visible, "results surface leaks a raw region code").not.toContain("KR-SGIS");
      for (const code of RAW_REASON_CODES) {
        expect(visible, `results surface leaks raw code ${code}`).not.toContain(code);
      }

      // With every section expanded, the plain-Korean explanations are present and
      // the codes are still only inside their diagnostic disclosures.
      for (const section of RESULT_SECTIONS) {
        await openSection(page, section);
      }
      const expanded = await page.getByTestId("facility-cost-results-view").innerText();
      expect(expanded).toContain("공식 자료가 아직 이 분석에 연결되지 않았습니다");
      for (const code of RAW_REASON_CODES) {
        expect(expanded, `expanded surface leaks raw code ${code}`).not.toContain(code);
      }

      // The codes are NOT deleted: opening the diagnostic disclosure reveals them.
      await page.getByTestId("facility-cost-missing-diagnostic").locator("summary").click();
      await expect(page.getByTestId("facility-cost-missing-diagnostic")).toContainText(
        "OFFICIAL_SOURCE_NOT_INTEGRATED",
      );
    });

    test("returns to setup with every selection preserved, then recalculates", async ({ page }) => {
      // Spy on the calculate requests without changing the served body: registered
      // after mockBackend so it runs first, then hands off with route.fallback().
      const calls: string[] = [];
      await page.route("**/api/v1/facility-cost/calculate**", async (route: Route) => {
        calls.push(route.request().url());
        await route.fallback();
      });

      await gotoCost(page);

      // A non-default scenario, so "preserved" is meaningful.
      await page.getByTestId("facility-cost-processing-share").fill("60");
      await page.getByTestId("facility-cost-region-search").click();
      await page
        .getByTestId("facility-cost-region-option")
        .filter({ hasText: "서울 종로구" })
        .click();
      await page.getByTestId("facility-cost-region-search").click();
      await page.getByTestId("facility-cost-region-option").filter({ hasText: "인천 강화군" }).click();
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(2);

      await page.getByTestId("facility-cost-calculate").click();
      await expect(page.getByTestId("facility-cost-results-view")).toBeVisible();

      // The request carried the citizen's actual inputs.
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("processing_share_percent=60");
      expect(decodeURIComponent(calls[0])).toContain("KR-SGIS-11110,KR-SGIS-23510");

      // The scenario summary describes what the backend CALCULATED (the shared mock
      // always returns its one-region fixture), and names regions in plain Korean —
      // never a raw region code.
      const context = await page.getByTestId("facility-cost-results-context").innerText();
      expect(context).toContain("선택한 1개 지역");
      expect(context).toContain("서울 종로구");
      expect(context).toContain("생활계 폐기물");
      expect(context).toContain("자동선별 재활용시설");
      expect(context).not.toContain("KR-SGIS");

      // ── Back to setup ────────────────────────────────────────────────────
      await page.getByTestId("facility-cost-edit-settings").click();
      await expect(page.getByTestId("facility-cost-setup-view")).toBeVisible();
      await expect(page.getByTestId("facility-cost-results-view")).toHaveCount(0);

      // Chips and inputs survived.
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(2);
      await expect(page.getByTestId("facility-cost-processing-share")).toHaveValue("60");
      // No stale-result warning: returning did not invalidate anything.
      await expect(page.getByTestId("facility-cost-stale")).toHaveCount(0);
      // Returning is pure view state — it must not re-submit the scenario.
      expect(calls).toHaveLength(1);

      // ── Change an input and recalculate ──────────────────────────────────
      await page.getByTestId("facility-cost-processing-share").fill("40");
      // Changing an input under a held result marks it stale rather than showing it.
      await expect(page.getByTestId("facility-cost-stale")).toBeVisible();
      await page.getByTestId("facility-cost-calculate").click();
      await expect(page.getByTestId("facility-cost-results-view")).toBeVisible();

      // The recalculation used the CHANGED value, not the one the first result held.
      expect(calls).toHaveLength(2);
      expect(calls[1]).toContain("processing_share_percent=40");

      await expectNoHorizontalOverflow(page);
    });

    test("stays on setup when the calculation fails", async ({ page }) => {
      // Registered last, so it wins over mockBackend for this path.
      await page.route("**/api/v1/facility-cost/calculate**", (route: Route) =>
        route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            detail: { error: "OFFICIAL_WASTE_UNAVAILABLE", detail: "no official waste data" },
          }),
        }),
      );
      await gotoCost(page);
      await page.getByTestId("facility-cost-region-search").click();
      await page
        .getByTestId("facility-cost-region-option")
        .filter({ hasText: "서울 종로구" })
        .click();
      await page.getByTestId("facility-cost-calculate").click();

      // A genuine, actionable error — and no navigation.
      await expect(page.getByTestId("facility-cost-error")).toBeVisible();
      await expect(page.getByTestId("facility-cost-error")).toHaveAttribute("role", "alert");
      await expect(page.getByTestId("facility-cost-results-view")).toHaveCount(0);
      await expect(page.getByTestId("facility-cost-setup-view")).toBeVisible();
      // The selection is kept so the citizen can retry.
      await expect(page.getByTestId("facility-cost-region-chip")).toHaveCount(1);
      await expect(page.getByTestId("facility-cost-calculate")).toBeEnabled();

      await expectNoHorizontalOverflow(page);
    });
  });
}
