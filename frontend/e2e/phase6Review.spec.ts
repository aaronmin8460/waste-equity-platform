import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  mockTransparencyBackend,
  mockTransparencyMappingError,
  mockTransparencyNoSources,
} from "./phase6Fixtures";

/**
 * Phase 6 review capture — OPT-IN screenshots of the redesigned 데이터와 출처
 * dashboard, for human design review only.
 *
 * It makes no CORRECTNESS assertions: the handful of `expect`s below exist purely to
 * wait for the state a screenshot is meant to depict (so a capture cannot silently
 * photograph a half-rendered page). Behavioural coverage lives in
 * `phase6DataSourcesDashboard.spec.ts`.
 *
 * Run with:
 *   CAPTURE_PHASE6_REVIEW=1 npx playwright test e2e/phase6Review.spec.ts
 *
 * Output goes to `frontend/test-results/phase-6-data-sources-dashboard/`, which is
 * gitignored. These captures are NOT committed.
 *
 * The registry payloads are SYNTHETIC LAYOUT FIXTURES (see `phase6Fixtures.ts`) —
 * every record in these images is invented for layout review and is not official
 * data. That is also why they must never be published as example output.
 *
 * It deliberately does NOT touch `docs/ui-baseline/desktop/` — that directory holds
 * the Phase 0 before-redesign baseline, and `e2e/desktopBaseline.spec.ts`
 * (CAPTURE_UI_BASELINE=1) is the only thing that may write there. Overwriting it
 * would destroy the comparison the whole redesign is measured against.
 */

const OUT_DIR = join(process.cwd(), "test-results", "phase-6-data-sources-dashboard");
const URL = "/?v=1&mode=transparency";

test.skip(
  process.env.CAPTURE_PHASE6_REVIEW !== "1",
  "Phase 6 review capture is opt-in: set CAPTURE_PHASE6_REVIEW=1.",
);

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test.describe("1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("captures the data-and-sources review set", async ({ page }) => {
    await mockTransparencyBackend(page);
    await page.goto(URL);
    await expect(page.getByTestId("transparency-source-list")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "data-sources-default-1440x900.png") });
    await page.screenshot({
      path: join(OUT_DIR, "data-sources-default-full-1440x900.png"),
      fullPage: true,
    });

    // Search.
    await page.getByTestId("transparency-search").fill("반입");
    await expect(page.getByTestId("transparency-source-card")).toHaveCount(2);
    await page.screenshot({ path: join(OUT_DIR, "data-sources-search-1440x900.png") });

    // Empty search result.
    await page.getByTestId("transparency-search").fill("존재하지않는자료명");
    await expect(page.getByTestId("transparency-empty-results")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "data-sources-empty-search-1440x900.png") });

    // Category filter.
    await page.getByTestId("transparency-search-clear").click();
    await page.getByTestId("transparency-filter-category").selectOption("population");
    await page.screenshot({ path: join(OUT_DIR, "data-sources-filtered-1440x900.png") });

    // Technical disclosure open.
    await page.getByTestId("transparency-filter-category").selectOption("all");
    await page.getByTestId("transparency-technical").scrollIntoViewIfNeeded();
    await page.getByTestId("transparency-technical-summary").click();
    await expect(page.getByTestId("transparency-technical")).toContainText("분석 규칙 버전");
    await page.screenshot({ path: join(OUT_DIR, "data-sources-technical-open-1440x900.png") });

    // The facility-mapping panel, further down the page.
    await page.getByTestId("transparency-facility-mapping").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT_DIR, "data-sources-facility-mapping-1440x900.png") });
  });

  test("captures the no-source and error states", async ({ page }) => {
    await mockTransparencyNoSources(page);
    await page.goto(URL);
    await expect(page.getByTestId("transparency-sources-empty")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "data-sources-no-data-1440x900.png") });
  });

  test("captures the genuine-error state", async ({ page }) => {
    await mockTransparencyMappingError(page);
    await page.goto(URL);
    await page.getByTestId("transparency-mapping-error").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("transparency-mapping-error")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "data-sources-error-1440x900.png") });
  });
});

test.describe("1280×800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("captures the secondary desktop width", async ({ page }) => {
    await mockTransparencyBackend(page);
    await page.goto(URL);
    await expect(page.getByTestId("transparency-source-list")).toBeVisible();
    await page.screenshot({ path: join(OUT_DIR, "data-sources-default-1280x800.png") });
    await page.screenshot({
      path: join(OUT_DIR, "data-sources-default-full-1280x800.png"),
      fullPage: true,
    });
  });
});

test.describe("390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("captures the mobile stacking", async ({ page }) => {
    await mockTransparencyBackend(page);
    await page.goto(URL);
    await expect(page.getByTestId("transparency-source-list")).toBeVisible();
    await page.screenshot({
      path: join(OUT_DIR, "data-sources-default-full-390x844.png"),
      fullPage: true,
    });
  });
});
