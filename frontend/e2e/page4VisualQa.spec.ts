import { test, type Page } from "@playwright/test";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * PAGE 4 — Figma fidelity capture harness (후보지 심층 분석, Figma 136:8684).
 *
 * NOT an assertion spec. It renders the real Page-4 workspace against the shared
 * mock backend and writes PNGs so the render can be held against the Figma frame
 * during the visual comparison passes. Every assertion about Page 4 lives in
 * `suitabilityDashboard.spec.ts`, `page4cRankingDialog.spec.ts` and the unit tests;
 * nothing here is a contract, so it can never fail the suite on a layout change.
 *
 * Output goes OUTSIDE the repository (PAGE4_QA_OUT), so captures are never committed
 * and never collide with another lane's run.
 *
 * The frame is 1440×1366, so the fold shot uses the mandated 1440×900 and the full
 * shot captures the whole column stack for the card-order comparison.
 */

const OUT = process.env.PAGE4_QA_OUT ?? "/tmp/page4-qa";

async function openScore(page: Page): Promise<void> {
  await mockSuitabilityBackend(page);
  await page.goto("/?v=1&mode=suitability&view=score");
  // The same two gates suitabilityDashboard.spec.ts waits on: the map has mounted
  // and the summary read has resolved, so nothing below is mid-skeleton.
  await page.getByTestId("map-container").waitFor({ state: "visible", timeout: 30000 });
  await page.getByTestId("suitability-summary").waitFor({ state: "visible", timeout: 30000 });
  // MapLibre paints asynchronously after mount; without this the map area captures
  // as an empty panel and every comparison pass reads it as a missing map.
  await page.waitForTimeout(2500);
}

test.describe("Page 4 visual QA capture", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("captures the 1440 workspace", async ({ page }, testInfo) => {
    await openScore(page);
    const tag = process.env.PAGE4_QA_TAG ?? "pass";
    await page.screenshot({ path: `${OUT}/${tag}-fold-1440x900.png` });
    await page.screenshot({ path: `${OUT}/${tag}-full-1440.png`, fullPage: true });
    testInfo.annotations.push({ type: "out", description: OUT });
  });

  /**
   * The 사용자 지정 state — Figma 356:582's expanded panel, which is a DIFFERENT
   * screen state from the closed card above and therefore needs its own capture:
   * the four weight inputs carry edited values, the 사용자 지정 pill is current, and
   * ③ plus the map are showing the applied scenario's result rather than the
   * profile's.
   */
  test("captures the 사용자 지정 weight state", async ({ page }, testInfo) => {
    await openScore(page);
    // 40/30/20/10 → 50/30/10/10, which totals exactly 100 and is therefore appliable.
    await page.getByTestId("factor-weight-zoning").fill("50");
    await page.getByTestId("factor-weight-equity").fill("10");
    await page.getByTestId("custom-weight-apply").click();
    await page.getByTestId("custom-weight-applied").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(1500);
    const tag = process.env.PAGE4_QA_TAG ?? "pass";
    await page.screenshot({ path: `${OUT}/${tag}-custom-fold-1440x900.png` });
    await page.screenshot({ path: `${OUT}/${tag}-custom-full-1440.png`, fullPage: true });
    testInfo.annotations.push({ type: "out", description: OUT });
  });

  /**
   * The two map-overlay controls, both EXPANDED.
   *
   * The page-4 기술 참고사항 asks that expanding 내륙습지 목록 push 토지피복 격자 통계
   * down instead of overlapping it. They share a page-owned flex column, so this
   * capture is the check that the column is actually doing that at 1440×900.
   */
  test("captures both map overlays expanded", async ({ page }, testInfo) => {
    await openScore(page);
    for (const testId of ["wetland-layer-summary", "land-cover-layer-summary"]) {
      const summary = page.getByTestId(testId);
      if ((await summary.count()) === 0) continue;
      await summary.first().click();
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(600);
    const tag = process.env.PAGE4_QA_TAG ?? "pass";
    await page.screenshot({ path: `${OUT}/${tag}-overlays-1440x900.png` });
    testInfo.annotations.push({ type: "out", description: OUT });
  });
});
