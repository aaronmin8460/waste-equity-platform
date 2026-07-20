import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type Route } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Phase 3 review capture — OPT-IN screenshots of the redesigned cost RESULTS
 * workflow, for human design review only. It asserts nothing.
 *
 * Run with:
 *   CAPTURE_PHASE3_REVIEW=1 npx playwright test e2e/phase3Review.spec.ts
 *
 * Output goes to `frontend/test-results/phase-3-cost-results/`, which is gitignored.
 * These captures are NOT committed.
 *
 * It deliberately does NOT touch `docs/ui-baseline/desktop/` — that directory holds
 * the Phase 0 before-redesign baseline, and `e2e/desktopBaseline.spec.ts`
 * (CAPTURE_UI_BASELINE=1) is the only thing that may write there. Overwriting it
 * would destroy the comparison the whole redesign is measured against.
 */

const OUT_DIR = join(process.cwd(), "test-results", "phase-3-cost-results");

const PICKER_REGIONS = [
  { code: "KR-SGIS-11110", name: "종로구", stream: "HOUSEHOLD" },
  { code: "KR-SGIS-11140", name: "중구", stream: "HOUSEHOLD" },
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

test.skip(
  process.env.CAPTURE_PHASE3_REVIEW !== "1",
  "Phase 3 review capture is opt-in: set CAPTURE_PHASE3_REVIEW=1.",
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

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: false });
}

/**
 * Open one accordion, scroll its body into view, capture, then collapse it again —
 * so each capture actually shows the section it is named after rather than the
 * unchanged top of the page.
 */
async function openAndCapture(
  page: Page,
  sectionTestId: string,
  bodyTestId: string,
  { name }: { name: string },
): Promise<void> {
  await page.getByTestId(`${sectionTestId}-summary`).click();
  const body = page.getByTestId(bodyTestId);
  await expect(body).toBeVisible();
  await body.scrollIntoViewIfNeeded();
  await capture(page, name);
  await page.getByTestId(`${sectionTestId}-summary`).click();
  await page.getByTestId("facility-cost-results-view").scrollIntoViewIfNeeded();
}

async function calculate(page: Page): Promise<void> {
  await page.goto("/?v=1&mode=suitability&view=cost");
  await expect(page.getByTestId("facility-cost-form")).toBeVisible();
  await page.getByTestId("facility-cost-region-search").click();
  await page.getByTestId("facility-cost-region-option").filter({ hasText: "서울 종로구" }).click();
  await page.getByTestId("facility-cost-calculate").click();
  await expect(page.getByTestId("facility-cost-results-view")).toBeVisible();
}

const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "1280x800", width: 1280, height: 800 },
];

for (const vp of VIEWPORTS) {
  test.describe(vp.label, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("captures the results workflow states", async ({ page }) => {
      await calculate(page);
      await capture(page, `cost-results-hero-${vp.label}`);

      await openAndCapture(page, "facility-cost-funding-section", "facility-cost-funding", {
        name: `cost-results-funding-open-${vp.label}`,
      });
      await openAndCapture(page, "facility-cost-exclusions", "facility-cost-missing", {
        name: `cost-results-exclusions-open-${vp.label}`,
      });
      await openAndCapture(page, "facility-cost-exact-values", "fc-exact-standard-cost", {
        name: `cost-results-exact-values-open-${vp.label}`,
      });

      // Returning to setup, with the selection intact.
      await page.getByTestId("facility-cost-edit-settings").click();
      await expect(page.getByTestId("facility-cost-setup-view")).toBeVisible();
      await capture(page, `cost-returned-setup-${vp.label}`);
    });
  });
}
