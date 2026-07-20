import { test, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { mockBackend } from "./mockBackend";

/**
 * Phase 2 review capture — screenshots of the redesigned facility-cost SETUP
 * workflow, for a human to review alongside the Phase 0 "before" baseline.
 *
 * It asserts nothing about pixels. As with e2e/desktopBaseline.spec.ts, this repo
 * has no visual-snapshot convention and Phase 2 does not introduce one: a pixel
 * baseline would fail on the first styling commit after it.
 *
 * It writes to frontend/test-results/phase-2-cost-setup/, which is GITIGNORED —
 * docs/ui-baseline/desktop/ holds the Phase 0 "before" images and this spec must
 * never touch them.
 *
 * Every value on screen comes from mockBackend plus the synthetic multi-region set
 * below. Nothing here is real or official public data; the images exist to review
 * layout, not to publish figures.
 *
 * Opt-in, so the normal e2e run is unaffected:
 *   CAPTURE_PHASE2_REVIEW=1 npx playwright test e2e/phase2CostSetup.spec.ts
 */

const OUT_DIR = join(process.cwd(), "test-results", "phase-2-cost-setup");

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

async function gotoCost(page: Page): Promise<void> {
  await page.goto("/?v=1&mode=suitability&view=cost");
  await page.getByTestId("facility-cost-form").waitFor({ state: "visible" });
}

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: false });
}

test.describe(() => {
  test.skip(
    process.env.CAPTURE_PHASE2_REVIEW !== "1",
    "Phase 2 review capture is opt-in: set CAPTURE_PHASE2_REVIEW=1.",
  );

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await page.route("**/api/v1/waste-statistics**", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(WASTE_STATISTICS),
      }),
    );
  });

  for (const vp of [
    { label: "1440x900", width: 1440, height: 900 },
    { label: "1280x800", width: 1280, height: 800 },
  ]) {
    test.describe(vp.label, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test("captures the setup workflow states", async ({ page }) => {
        await gotoCost(page);
        await capture(page, `cost-empty-${vp.label}`);

        const search = page.getByTestId("facility-cost-region-search");
        await search.click();
        await search.fill("중구");
        await page.getByTestId("facility-cost-region-options").waitFor({ state: "visible" });
        await capture(page, `cost-region-search-${vp.label}`);

        await page.getByTestId("facility-cost-region-option").first().click();
        // The popup overlays the metro buttons beneath it while it is open (ordinary
        // combobox behaviour), so dismiss it the way a user would before using them.
        await search.press("Escape");
        await page.getByTestId("facility-cost-regions-incheon").click();
        await page.getByTestId("facility-cost-setup-summary").waitFor({ state: "visible" });
        await capture(page, `cost-selected-regions-${vp.label}`);

        await page.getByTestId("facility-cost-advanced-settings-summary").click();
        await page.getByTestId("facility-cost-operating-days").waitFor({ state: "visible" });
        await capture(page, `cost-advanced-open-${vp.label}`);
      });
    });
  }
});
