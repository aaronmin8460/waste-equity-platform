import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { mockBackend } from "./mockBackend";
import { mockEquityBackend } from "./phase4Fixtures";
import { mockLandfillBackend } from "./phase5Fixtures";
import { mockTransparencyBackend } from "./phase6Fixtures";

/**
 * Phase 7 final review capture — OPT-IN screenshots of the completed desktop
 * redesign, for human design review only.
 *
 * It makes no CORRECTNESS assertions: the `expect`s exist purely to wait for the
 * state a screenshot is meant to depict, so a capture cannot silently photograph a
 * half-rendered page. Behaviour is covered by `phase7FinalRegression.spec.ts`.
 *
 * Run with:
 *   CAPTURE_PHASE7_REVIEW=1 npx playwright test e2e/phase7FinalReview.spec.ts
 *
 * Output goes to `frontend/test-results/phase-7-final-review/`, which is gitignored
 * (frontend/.gitignore `test-results/`). These captures are NOT committed.
 *
 * ── The Phase 0 baseline is NOT touched ─────────────────────────────────────────
 * `docs/ui-baseline/desktop/` holds the before-redesign evidence the whole redesign
 * is measured against. This spec never writes there. The redesign plan's Phase 7
 * AC4 originally proposed REPLACING that baseline; that was overridden for this
 * phase — the before-images are preserved and the after-images live here instead,
 * so both sides of the comparison still exist.
 *
 * ── Every image carries a visible synthetic marker ──────────────────────────────
 * All payloads are SYNTHETIC LAYOUT FIXTURES (see phase4/5/6Fixtures.ts). Because a
 * screenshot can be separated from its README, each capture has a review-only
 * watermark burned into the image itself by `stampSynthetic()` below — not a code
 * comment, not hidden metadata, not an accessible-only label, and not inside a
 * closed <details>. It is injected from THIS SPEC and never added to a production
 * component. No image may be published as example output.
 */

const OUT_DIR = join(process.cwd(), "test-results", "phase-7-final-review");

const SYNTHETIC_MARKER = "분석용 합성 픽스처 — 공식 자료 아님";

test.skip(
  process.env.CAPTURE_PHASE7_REVIEW !== "1",
  "Phase 7 review capture is opt-in: set CAPTURE_PHASE7_REVIEW=1.",
);

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

/**
 * Burn a visible review-only watermark into the page, then verify it is really on
 * screen before anything is captured. A marker that silently failed to render would
 * produce official-looking images of invented values — the exact failure this
 * guards against — so its visibility is asserted, not assumed.
 */
async function stampSynthetic(page: Page): Promise<void> {
  await page.evaluate((marker) => {
    document.getElementById("phase7-review-watermark")?.remove();
    const el = document.createElement("div");
    el.id = "phase7-review-watermark";
    el.textContent = marker;
    el.setAttribute(
      "style",
      [
        "position:fixed",
        // Anchored to the BOTTOM: at the top it covered the persistent navigation,
        // which is one of the things this capture set exists to let a reviewer check.
        "bottom:0",
        "left:0",
        "right:0",
        "z-index:2147483647",
        "background:#b91c1c",
        "color:#ffffff",
        "font:700 13px/1.6 system-ui,sans-serif",
        "text-align:center",
        "letter-spacing:0.02em",
        "padding:3px 8px",
        "pointer-events:none",
      ].join(";"),
    );
    document.body.appendChild(el);
  }, SYNTHETIC_MARKER);

  const stamp = page.locator("#phase7-review-watermark");
  await expect(stamp, "the synthetic marker must be visible in the capture").toBeVisible();
  await expect(stamp).toHaveText(SYNTHETIC_MARKER);
}

/** Stamp, then capture the viewport frame (what a desktop reader sees first). */
async function capture(page: Page, name: string): Promise<void> {
  await stampSynthetic(page);
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`) });
}

test.describe("1440×900 — primary desktop target", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("지역 부담 — default and with a region selected", async ({ page }) => {
    await mockEquityBackend(page);
    await page.goto("/?v=1&mode=equity");
    await expect(page.getByTestId("region-ranking")).toBeVisible();
    await capture(page, "equity-default-1440x900");

    await page.getByTestId("rank-high").getByTestId("rank-row").first().click();
    await expect(page.getByTestId("selected-region-summary")).toBeVisible();
    await capture(page, "equity-region-selected-1440x900");
  });

  test("후보지 분석 — 후보지 점수 and 가중치 바꿔보기", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/?v=1&mode=suitability&view=score");
    await expect(page.getByTestId("suitability-summary")).toBeVisible();
    await capture(page, "suitability-score-1440x900");

    await page.getByTestId("suitability-view-scenario").click();
    await expect(page.getByTestId("scenario-apply")).toBeVisible();
    await capture(page, "suitability-scenario-1440x900");
  });

  test("후보지 분석 — 비용 살펴보기 setup and results", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/?v=1&mode=suitability&view=cost");
    await expect(page.getByTestId("facility-cost-form")).toBeVisible();
    await capture(page, "cost-setup-1440x900");

    // Drive the real Phase 2 combobox (the pre-Phase-2 multi-select is gone), then
    // calculate, so the results capture depicts an actual calculated state.
    const search = page.getByTestId("facility-cost-region-search");
    if (await search.isVisible()) {
      await search.click();
      const first = page.getByTestId("facility-cost-region-option").first();
      if (await first.isVisible()) await first.click();
    }
    const calculate = page.getByTestId("facility-cost-calculate");
    if (await calculate.isEnabled()) {
      await calculate.click();
      await expect(page.getByTestId("facility-cost-results")).toBeVisible();
    }
    await capture(page, "cost-results-1440x900");
  });

  test("매립지 현황 — populated", async ({ page }) => {
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=flow");
    await expect(page.getByTestId("landfill-kpis")).toBeVisible();
    await capture(page, "landfill-default-1440x900");
  });

  test("데이터·출처 — source catalog", async ({ page }) => {
    await mockTransparencyBackend(page);
    await page.goto("/?v=1&mode=transparency");
    await expect(page.getByTestId("transparency-source-list")).toBeVisible();
    await capture(page, "data-sources-default-1440x900");
  });

  test("보고서 미리보기 — the widened report modal (X7)", async ({ page }) => {
    await mockEquityBackend(page);
    await page.goto("/?v=1&mode=equity");
    await page.getByTestId("open-report").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture(page, "report-preview-1440x900");
  });
});

test.describe("1280×800 — secondary desktop target", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("지역 부담 — default", async ({ page }) => {
    await mockEquityBackend(page);
    await page.goto("/?v=1&mode=equity");
    await expect(page.getByTestId("region-ranking")).toBeVisible();
    await capture(page, "equity-default-1280x800");
  });

  test("비용 살펴보기 — results", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/?v=1&mode=suitability&view=cost");
    await expect(page.getByTestId("facility-cost-form")).toBeVisible();
    const search = page.getByTestId("facility-cost-region-search");
    if (await search.isVisible()) {
      await search.click();
      const first = page.getByTestId("facility-cost-region-option").first();
      if (await first.isVisible()) await first.click();
    }
    const calculate = page.getByTestId("facility-cost-calculate");
    if (await calculate.isEnabled()) {
      await calculate.click();
      await expect(page.getByTestId("facility-cost-results")).toBeVisible();
    }
    await capture(page, "cost-results-1280x800");
  });

  test("매립지 현황 — populated", async ({ page }) => {
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=flow");
    await expect(page.getByTestId("landfill-kpis")).toBeVisible();
    await capture(page, "landfill-default-1280x800");
  });

  test("데이터·출처 — source catalog", async ({ page }) => {
    await mockTransparencyBackend(page);
    await page.goto("/?v=1&mode=transparency");
    await expect(page.getByTestId("transparency-source-list")).toBeVisible();
    await capture(page, "data-sources-default-1280x800");
  });
});
