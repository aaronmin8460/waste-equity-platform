import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { mockEquityBackend } from "./phase4Fixtures";

/**
 * Phase 4 review capture — OPT-IN screenshots of the redesigned 지역 부담 map, for
 * human design review only. It asserts nothing.
 *
 * Run with:
 *   CAPTURE_PHASE4_REVIEW=1 npx playwright test e2e/phase4Review.spec.ts
 *
 * Output goes to `frontend/test-results/phase-4-equity-map/`, which is gitignored.
 * These captures are NOT committed.
 *
 * It deliberately does NOT touch `docs/ui-baseline/desktop/` — that directory holds
 * the Phase 0 before-redesign baseline, and `e2e/desktopBaseline.spec.ts`
 * (CAPTURE_UI_BASELINE=1) is the only thing that may write there. Overwriting it
 * would destroy the comparison the whole redesign is measured against.
 */

const OUT_DIR = join(process.cwd(), "test-results", "phase-4-equity-map");

test.skip(
  process.env.CAPTURE_PHASE4_REVIEW !== "1",
  "Phase 4 review capture is opt-in: set CAPTURE_PHASE4_REVIEW=1.",
);

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.describe("1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("captures the equity map review set", async ({ page }) => {
    await mockEquityBackend(page);
    await page.goto("/?v=1&mode=equity");
    await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: join(OUT_DIR, "equity-default-1440x900.png") });

    await page.getByRole("radio", { name: "1인당 생활계 발생량" }).check();
    await page.screenshot({ path: join(OUT_DIR, "equity-metric-selected-1440x900.png") });

    await page.getByRole("radio", { name: "인구" }).check();
    await page.getByTestId("region-select").selectOption("KR-SGIS-11680");
    await expect(page.getByTestId("selected-region-name")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "equity-region-selected-1440x900.png") });

    await page.getByTestId("region-ranking").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT_DIR, "equity-ranking-1440x900.png") });

    await page.getByTestId("comparison-search").fill("종로");
    await page.getByTestId("comparison-options").getByRole("option").first().click();
    await page.getByTestId("region-comparison").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT_DIR, "equity-comparison-1440x900.png") });
  });
});

test.describe("1280×800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("captures the secondary desktop target", async ({ page }) => {
    await mockEquityBackend(page);
    await page.goto("/?v=1&mode=equity");
    await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: join(OUT_DIR, "equity-default-1280x800.png") });
  });
});
