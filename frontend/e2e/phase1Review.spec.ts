import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 1 manual-review screenshot capture (desktop UI/UX redesign).
 *
 * This spec CAPTURES images for human review and asserts nothing — the automated
 * acceptance criteria live in `e2e/desktopNavigation.spec.ts`, and this repository
 * deliberately has no pixel-snapshot convention.
 *
 * It writes to `frontend/test-results/phase-1-desktop/`, which is gitignored. It
 * must NOT write to `docs/ui-baseline/desktop/` — those are the Phase 0 "before"
 * images that this phase is reviewed against, and `e2e/desktopBaseline.spec.ts`
 * (which does own that directory) is left untouched.
 *
 * Like the Phase 0 capture, it drives the deterministic `mockBackend`, so no
 * backend, database, or tile server is needed. The 매립지 현황 view therefore renders
 * its genuine 404 NO_DATA state and 후보지 점수 has empty candidate lists — the
 * fixture never fabricates official-looking values to make a screenshot look fuller.
 *
 * Opt-in, so the normal e2e run is unaffected:
 *   CAPTURE_PHASE1_REVIEW=1 npx playwright test e2e/phase1Review.spec.ts
 */

const OUT_DIR = join(process.cwd(), "test-results", "phase-1-desktop");

/** Primary redesign target, and the secondary desktop size that must also hold. */
const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "1280x800", width: 1280, height: 800 },
];

/** Views captured at the primary viewport. */
const PRIMARY_VIEWS = [
  { name: "equity", query: "/?v=1&mode=equity&metric=population" },
  { name: "suitability-score", query: "/?v=1&mode=suitability&view=score&metric=population" },
  { name: "suitability-scenario", query: "/?v=1&mode=suitability&view=scenario&metric=population" },
  { name: "suitability-cost", query: "/?v=1&mode=suitability&view=cost&metric=population" },
  { name: "landfill", query: "/?v=1&mode=flow&metric=population" },
  { name: "transparency", query: "/?v=1&mode=transparency&metric=population" },
];

/** The secondary viewport gets the map layout and the widest map-free page. */
const SECONDARY_VIEWS = [
  { name: "equity", query: "/?v=1&mode=equity&metric=population" },
  { name: "suitability-cost", query: "/?v=1&mode=suitability&view=cost&metric=population" },
];

async function gotoLoaded(page: Page, query: string): Promise<void> {
  await page.goto(query);
  await page.getByTestId("mode-switch").waitFor({ state: "visible" });
  // The map modes mount MapLibre; give the canvas a beat to paint its chrome.
  await page.waitForTimeout(1200);
}

test.describe(() => {
  test.skip(
    process.env.CAPTURE_PHASE1_REVIEW !== "1",
    "Phase 1 review capture is opt-in: set CAPTURE_PHASE1_REVIEW=1.",
  );

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    const { mockBackend } = await import("./mockBackend");
    await mockBackend(page);
  });

  for (const vp of VIEWPORTS) {
    const views = vp.label === "1440x900" ? PRIMARY_VIEWS : SECONDARY_VIEWS;

    test.describe(vp.label, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      for (const view of views) {
        test(`${view.name} @ ${vp.label}`, async ({ page }) => {
          await gotoLoaded(page, view.query);
          // The viewport frame is what matters for the navigation review: it shows
          // what a desktop user sees above the fold.
          await page.screenshot({ path: join(OUT_DIR, `${view.name}-${vp.label}.png`) });
        });
      }
    });
  }
});
