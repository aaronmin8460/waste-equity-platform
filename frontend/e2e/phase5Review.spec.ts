import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  mockLandfillBackend,
  mockLandfillNoData,
  mockLandfillServerError,
} from "./phase5Fixtures";

/**
 * Phase 5 review capture — OPT-IN screenshots of the redesigned 매립지 현황
 * dashboard, for human design review only. It asserts nothing.
 *
 * Run with:
 *   CAPTURE_PHASE5_REVIEW=1 npx playwright test e2e/phase5Review.spec.ts
 *
 * Output goes to `frontend/test-results/phase-5-landfill-dashboard/`, which is
 * gitignored. These captures are NOT committed.
 *
 * The landfill payloads are SYNTHETIC LAYOUT FIXTURES (see `phase5Fixtures.ts`) —
 * every number in these images is invented for layout review and is not official
 * data. That is also why they must never be published as example output.
 *
 * It deliberately does NOT touch `docs/ui-baseline/desktop/` — that directory holds
 * the Phase 0 before-redesign baseline, and `e2e/desktopBaseline.spec.ts`
 * (CAPTURE_UI_BASELINE=1) is the only thing that may write there. Overwriting it
 * would destroy the comparison the whole redesign is measured against.
 */

const OUT_DIR = join(process.cwd(), "test-results", "phase-5-landfill-dashboard");

test.skip(
  process.env.CAPTURE_PHASE5_REVIEW !== "1",
  "Phase 5 review capture is opt-in: set CAPTURE_PHASE5_REVIEW=1.",
);

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.describe("1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("captures the landfill review set", async ({ page }) => {
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=flow");
    await expect(page.getByTestId("landfill-kpis")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "landfill-default-1440x900.png") });

    // A filtered (partial-year) selection.
    await page.getByTestId("landfill-year-select").selectOption("2026");
    await expect(page.getByTestId("landfill-partial-year")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "landfill-filtered-1440x900.png") });

    await page.getByTestId("landfill-origin-comparison").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT_DIR, "landfill-comparison-1440x900.png") });

    await page.getByTestId("landfill-region-table").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT_DIR, "landfill-table-1440x900.png") });
  });

  test("captures the no-data state", async ({ page }) => {
    await mockLandfillNoData(page);
    await page.goto("/?v=1&mode=flow");
    await expect(page.getByTestId("landfill-no-data")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "landfill-no-data-1440x900.png") });
  });

  test("captures the genuine error state", async ({ page }) => {
    await mockLandfillServerError(page);
    await page.goto("/?v=1&mode=flow");
    await expect(page.getByTestId("landfill-error")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "landfill-error-1440x900.png") });
  });
});

test.describe("1280×800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("captures the secondary desktop target", async ({ page }) => {
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=flow");
    await expect(page.getByTestId("landfill-kpis")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "landfill-default-1280x800.png") });
  });
});
