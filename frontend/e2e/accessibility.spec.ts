import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Accessibility-foundation e2e coverage (Phase 2).
 *
 * Like responsive.spec.ts this intercepts every backend request (see mockBackend)
 * and drives the real application UI — no backend, tile server, or official data.
 * It asserts only on accessibility structure and behaviour (document language,
 * the skip link, keyboard focus, the map region label, fieldset grouping, live
 * regions), never on data values.
 *
 * ── Which viewports run which tests ─────────────────────────────────────────────
 * The dashboard a11y tests below run at DESKTOP widths only, because 여기다 is
 * desktop-required: below 1024px the shell renders `ui/NarrowScreenGate` instead of
 * any dashboard, so there is no map region, no metric fieldset, and no mode switch
 * there to assert on (frontend/RESPONSIVE_LAYOUT.md). This block used to include
 * `mobile 390×844` and assert the full analytical UI at that width — the retired
 * contract, when the dashboard stacked itself into a phone column.
 *
 * The a11y guarantees that must hold at EVERY width — the document language and the
 * skip link — are not desktop-scoped: the skip link is asserted in the narrow block
 * at the bottom of this file as well, because the gate has to keep a valid
 * `#main-content` target or the WCAG 2.4.1 bypass block breaks on the screens least
 * able to absorb it.
 */

const DESKTOP_VIEWPORTS = [
  { name: "desktop floor 1024×768", width: 1024, height: 768 },
  { name: "desktop 1440×900", width: 1440, height: 900 },
];

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test("declares the document language as Korean", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});

for (const vp of DESKTOP_VIEWPORTS) {
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
      // The map mounts only once the view's initial requests resolve, so this raced
      // Playwright's default 5s expect budget under a loaded dev server. Same
      // mechanism, and same correction, as the `civicShell.spec.ts` map wait
      // (docs/ui-refresh/final-integration-regression.md): give it the 15s budget the
      // rest of the repository already uses for exactly this. Every assertion below
      // is unchanged — this only changes how long the test is willing to wait.
      await expect(map).toBeVisible({ timeout: 15000 });
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
      // The correction pass re-cut the metrics into three SUBJECT sections; the
      // three-fieldset structure and the plain-Korean legends are unchanged.
      await expect(page.getByText("지역별 인구", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("폐기물 발생량", { exact: true })).toBeVisible();
      await expect(page.getByText("1인당 시설 처리 수준", { exact: true })).toBeVisible();
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
 * Below the desktop floor the application is replaced by `ui/NarrowScreenGate`, but
 * the a11y foundation the whole document depends on must survive that swap: the skip
 * link in app/layout.tsx is rendered at every width, so its target has to exist here
 * too. This is the width at which a broken bypass block would hurt most.
 */
test.describe("narrow screen 390×844 (below the desktop floor)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the skip link working, with one heading and no dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("narrow-screen-gate")).toBeVisible();

    const skip = page.locator("a.skip-link");
    await expect(skip).toHaveText("본문으로 바로가기");
    // Off-screen until focused, then the first Tab reaches it.
    const before = await skip.boundingBox();
    expect(before).not.toBeNull();
    expect(before!.y).toBeLessThan(0);
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();

    // Activating it moves keyboard focus into the gate's <main>.
    await skip.press("Enter");
    const activeId = await page.evaluate(() => document.activeElement?.id);
    expect(activeId).toBe("main-content");

    // One <h1>, the same rule every dashboard view follows, and no analytical UI
    // left behind for a screen reader to walk into.
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByTestId("map-container")).toHaveCount(0);
    await expect(page.getByTestId("mode-switch")).toHaveCount(0);
  });
});

/**
 * A pure-keyboard walk from the skip link into the sidebar controls, proving no
 * keyboard trap and reachable native controls. Desktop only — it walks into the
 * sidebar's metric radios, which exist only in the desktop composition.
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
