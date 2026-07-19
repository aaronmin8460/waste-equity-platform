import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Accessibility-foundation e2e coverage (Phase 2).
 *
 * Like responsive.spec.ts this intercepts every backend request (see mockBackend)
 * and drives the real application UI — no backend, tile server, or official data.
 * It asserts only on accessibility structure and behaviour (document language,
 * the skip link, keyboard focus, the map region label, fieldset grouping, live
 * regions), never on data values, at both a mobile and a desktop viewport so the
 * a11y foundation is verified against the merged responsive layout.
 */

const VIEWPORTS = [
  { name: "mobile 390×844", width: 390, height: 844 },
  { name: "desktop 1440×900", width: 1440, height: 900 },
];

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test("declares the document language as Korean", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("provides a skip link that is hidden until focus and moves focus to main", async ({
      page,
    }) => {
      await page.goto("/");
      const skip = page.locator("a.skip-link");
      await expect(skip).toHaveText("본문으로 바로가기");

      // Off-screen (negative top) until it receives focus…
      const before = await skip.boundingBox();
      expect(before).not.toBeNull();
      expect(before!.y).toBeLessThan(0);

      // The very first Tab from a fresh load reaches it (first focusable element).
      await page.keyboard.press("Tab");
      await expect(skip).toBeFocused();
      // The link animates into view (transition: top 0.15s). Use a retrying
      // assertion so we observe the settled on-screen position rather than
      // sampling a single mid-transition frame (deterministic, no fixed sleep).
      await expect(skip).toBeInViewport();

      // Keyboard focus draws the shared focus-visible ring (status never by color).
      const outlineWidth = await skip.evaluate(
        (el) => parseFloat(getComputedStyle(el).outlineWidth) || 0,
      );
      expect(outlineWidth).toBeGreaterThanOrEqual(2);

      // Activating it moves keyboard focus into the primary <main> content region.
      await skip.press("Enter");
      const activeId = await page.evaluate(() => document.activeElement?.id);
      expect(activeId).toBe("main-content");
    });

    test("labels the map as a region with a linked textual description", async ({ page }) => {
      await page.goto("/");
      const map = page.getByTestId("map-container");
      await expect(map).toHaveAttribute("role", "region");
      await expect(map).toHaveAttribute("aria-label", /지도/);
      await expect(map).toHaveAttribute("aria-describedby", "map-accessible-description");
      // The description exists and points users at the accessible DOM alternatives.
      await expect(page.locator("#map-accessible-description")).toContainText("선택한 지역");
      // Keyboard region-selection path exists and is labelled (the map click is
      // pointer-only), so region info is reachable without the canvas.
      await expect(page.getByTestId("region-select")).toBeVisible();
      await expect(page.getByRole("combobox", { name: /지역 선택/ })).toBeVisible();
    });

    test("groups the metric radios into labelled fieldsets and announces the selection", async ({
      page,
    }) => {
      await page.goto("/");
      // Three semantic groups, each with a <legend>, both on mobile and desktop.
      // Plain-Korean legends (Phase 7 — no English parenthetical in primary UI).
      await expect(page.locator("fieldset")).toHaveCount(3);
      await expect(page.getByText("총량 지표", { exact: true })).toBeVisible();
      await expect(page.getByText("1인당 형평성 지표", { exact: true })).toBeVisible();
      await expect(page.getByText("시설 부담 지표", { exact: true })).toBeVisible();
      // The selected-metric status region reflects the active metric.
      const summary = page.getByTestId("selected-metric-summary");
      await expect(summary).toHaveAttribute("role", "status");
      await expect(summary).toContainText("인구");
    });

    test("keeps the mode toggle group operable with preserved aria-pressed", async ({ page }) => {
      await page.goto("/");
      const group = page.getByTestId("mode-switch");
      await expect(group).toHaveAttribute("role", "group");
      await expect(page.getByTestId("mode-equity")).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("mode-suitability").click();
      await expect(page.getByTestId("mode-suitability")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("mode-equity")).toHaveAttribute("aria-pressed", "false");
      // The suitability status live region is present once its summary loads.
      await expect(page.getByTestId("suitability-summary")).toBeVisible();
      await expect(page.getByTestId("suitability-live")).toHaveAttribute("role", "status");
    });
  });
}

/**
 * A pure-keyboard walk from the skip link into the sidebar controls, proving no
 * keyboard trap and reachable native controls. Desktop only (mobile focus order
 * is identical; this avoids duplicate flake surface).
 */
test.describe("keyboard navigation", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function focusedTag(page: Page): Promise<string> {
    return page.evaluate(() => document.activeElement?.tagName ?? "");
  }

  test("tabs from the skip link through the mode buttons to the metric radios", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.locator("a.skip-link")).toBeFocused();

    // Walk forward; focus must keep landing on real interactive controls (no trap)
    // and reach a metric radio within a bounded number of steps.
    let reachedRadio = false;
    for (let i = 0; i < 25 && !reachedRadio; i += 1) {
      await page.keyboard.press("Tab");
      const isRadio = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.tagName === "INPUT" && (el as HTMLInputElement).type === "radio";
      });
      reachedRadio = isRadio;
    }
    expect(reachedRadio).toBe(true);
    // The focused element is a genuine control, never the body (no trap/void).
    expect(await focusedTag(page)).not.toBe("BODY");
  });
});
