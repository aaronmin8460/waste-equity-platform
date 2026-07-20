import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { mockBackend } from "./mockBackend";

/**
 * Desktop UI/UX baseline capture (Phase 0 of the desktop redesign).
 *
 * This spec CAPTURES screenshots; it asserts nothing about pixels. The repository
 * has no visual-snapshot convention (no `toHaveScreenshot`/`toMatchSnapshot`
 * anywhere in e2e/), and Phase 0 deliberately does not introduce one — a brittle
 * pixel baseline would fail on the very first redesign commit it is meant to
 * document. The output is documentation, reviewed by a human, stored under
 * docs/ui-baseline/desktop/.
 *
 * It reuses `mockBackend` (the same deterministic fixture the responsive spec
 * drives the real UI with), so the baseline is reproducible with NO backend, no
 * database, no tile server, and no official data. Two consequences are intentional
 * and documented in docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §"Baseline gaps":
 *   - 매립지 현황 renders its genuine 404 NO_DATA state, because the fixture
 *     deliberately serves the backend's real "no official landfill data" response
 *     instead of fabricating official-looking landfill values.
 *   - 후보지 점수 renders with empty candidate lists, because the fixture serves
 *     `top_candidates: []`.
 * Neither is worked around here: fabricating official-looking data to make a
 * screenshot look fuller is exactly what this project's data-integrity rules
 * forbid.
 *
 * Opt-in, so the normal e2e run is unaffected:
 *   CAPTURE_UI_BASELINE=1 npx playwright test e2e/desktopBaseline.spec.ts
 *
 * ── STATUS: FROZEN PHASE 0 ARTIFACT — NOT MAINTAINED (settled in Phase 7) ───────
 * This spec is kept for provenance only: it records HOW the before-redesign images
 * in docs/ui-baseline/desktop/ were produced. It is not part of the current review
 * workflow and is not expected to run green.
 *
 * It does not run today: its two cost captures still drive the `facility-cost-regions`
 * multi-select that Phase 2 replaced with a searchable combobox, so opting in fails
 * on those steps. That is left AS IS deliberately.
 *
 * Phase 7 considered the redesign plan's original §9 AC4 — "re-capture the baseline
 * and replace the old set" — and did NOT do it. Overwriting these images would
 * destroy the only before-state the whole redesign is measured against, leaving no
 * comparison at all. The after-images live in a separate, gitignored location
 * instead, so both sides still exist:
 *
 *   e2e/phase7FinalReview.spec.ts  (CAPTURE_PHASE7_REVIEW=1)
 *     → frontend/test-results/phase-7-final-review/
 *
 * Do NOT migrate this file to the combobox, and do NOT run it to refresh the
 * baseline. If a future phase genuinely needs a new before-state, capture it under a
 * NEW directory rather than overwriting this one.
 */

const OUT_DIR = join(process.cwd(), "..", "docs", "ui-baseline", "desktop");

// The primary redesign target viewport. 1280×800 is verified for usability by the
// existing responsive spec; the visual baseline is captured at the primary size.
const VIEWPORT = { width: 1440, height: 900 };

test.describe(() => {
  test.skip(
    process.env.CAPTURE_UI_BASELINE !== "1",
    "Baseline capture is opt-in: set CAPTURE_UI_BASELINE=1.",
  );

  test.use({ viewport: VIEWPORT });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  /**
   * Capture the viewport-clipped frame (what a 1440×900 desktop actually shows
   * above the fold — the hierarchy the audit is about) and, for pages that scroll,
   * the full page as a `-full` companion.
   */
  async function capture(page: Page, name: string, alsoFullPage = false): Promise<void> {
    await page.screenshot({ path: join(OUT_DIR, `${name}-1440x900.png`) });
    if (alsoFullPage) {
      await page.screenshot({ path: join(OUT_DIR, `${name}-1440x900-full.png`), fullPage: true });
    }
  }

  /** Wait for the initial parallel dataset load to resolve into the shell. */
  async function gotoLoaded(page: Page, query: string): Promise<void> {
    await page.goto(query);
    await page.getByTestId("mode-switch").waitFor({ state: "visible" });
    // The map modes mount MapLibre; give the canvas a beat to paint its chrome.
    await page.waitForTimeout(1200);
  }

  test("지역 부담 (regional burden)", async ({ page }) => {
    await gotoLoaded(page, "/?v=1&mode=equity&metric=population");
    await capture(page, "regional-burden");
  });

  test("후보지 분석 — 후보지 점수 (candidate score)", async ({ page }) => {
    await gotoLoaded(page, "/?v=1&mode=suitability&view=score&metric=population");
    await capture(page, "candidate-score");
  });

  test("후보지 분석 — 가중치 바꿔보기 (weight lab)", async ({ page }) => {
    await gotoLoaded(page, "/?v=1&mode=suitability&view=scenario&metric=population");
    await capture(page, "candidate-weights");
  });

  test("후보지 분석 — 비용 살펴보기, before calculation", async ({ page }) => {
    await gotoLoaded(page, "/?v=1&mode=suitability&view=cost&metric=population");
    await page.getByTestId("facility-cost-form").waitFor({ state: "visible" });
    await capture(page, "facility-cost-setup", true);
  });

  test("후보지 분석 — 비용 살펴보기, after a successful calculation", async ({ page }) => {
    await gotoLoaded(page, "/?v=1&mode=suitability&view=cost&metric=population");
    const regions = page.getByTestId("facility-cost-regions");
    await regions.waitFor({ state: "visible" });
    // Select the first calculable service region, then run the calculation.
    const firstValue = await regions.locator("option").first().getAttribute("value");
    if (firstValue) await regions.selectOption(firstValue);
    await page.getByTestId("facility-cost-calculate").click();
    await page.getByTestId("facility-cost-results").waitFor({ state: "visible" });
    await capture(page, "facility-cost-results", true);
  });

  test("매립지 현황 (landfill dashboard)", async ({ page }) => {
    await gotoLoaded(page, "/?v=1&mode=flow&metric=population");
    await capture(page, "landfill-dashboard", true);
  });

  test("데이터·출처 (data & sources)", async ({ page }) => {
    await gotoLoaded(page, "/?v=1&mode=transparency&metric=population");
    await capture(page, "data-sources", true);
  });
});
