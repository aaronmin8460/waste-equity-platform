import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * User-weight scenario lab (가중치 바꿔보기) e2e — Phase 6.
 *
 * Like the responsive spec, this intercepts every backend request (see
 * mockBackend), so it drives the REAL application UI — the scenario editor, the
 * apply workflow, the single MapView — without a real backend, tiles, or official
 * data. It asserts the workflow + the canonical weight payload, never data values
 * from a fabricated official source. The scenario preview/candidate mocks are
 * test-only fixtures in mockBackend.ts, never shipped app data.
 */

async function enterScenario(page: Page): Promise<void> {
  await mockBackend(page);
  await page.goto("/");
  await expect(page.getByTestId("mode-switch")).toBeVisible();
  await page.getByTestId("mode-suitability").click();
  await expect(page.getByTestId("suitability-summary")).toBeVisible();
  await page.getByTestId("suitability-view-scenario").click();
  await expect(page.getByTestId("scenario-lab")).toBeVisible();
}

async function setPercent(page: Page, component: string, value: number): Promise<void> {
  const input = page.getByTestId(`scenario-input-${component}`);
  await input.fill(String(value));
  await input.dispatchEvent("change");
}

test.describe("weight scenario lab workflow", () => {
  test("edit → normalize → apply → select → navigate away", async ({ page }) => {
    await enterScenario(page);

    // 1. No scenario applied initially; warning always visible.
    await expect(page.getByTestId("scenario-no-applied")).toBeVisible();
    await expect(page.getByTestId("scenario-warning")).toBeVisible();
    // exactly one MapView is mounted for the whole app.
    await expect(page.getByTestId("map-container")).toHaveCount(1);

    // 2. Load the baseline preset (loads values, does not apply). The mock run's
    //    baseline profile is 40/30/20/10.
    await page.getByTestId("scenario-preset-baseline").click();
    await expect(page.getByTestId("scenario-value-zoning")).toHaveText("40%");

    // 3. Make the total invalid → Apply disabled.
    await setPercent(page, "zoning", 55); // total 115
    await expect(page.getByTestId("scenario-apply")).toBeDisabled();

    // 4. Normalize back to exactly 100 → Apply enabled.
    await page.getByTestId("scenario-normalize").click();
    await expect(page.getByTestId("scenario-total")).toContainText("100%");
    await expect(page.getByTestId("scenario-apply")).toBeEnabled();

    // 5. Apply → the preview POST carries canonical 8-dp decimal-string weights.
    const previewRequest = page.waitForRequest(
      (req) =>
        req.url().includes("/api/v1/suitability/scenarios/preview") && req.method() === "POST",
    );
    await page.getByTestId("scenario-apply").click();
    const req = await previewRequest;
    const payload = req.postDataJSON() as { weights: Record<string, string> };
    for (const c of ["zoning", "road", "equity", "demand"]) {
      expect(payload.weights[c]).toMatch(/^\d\.\d{8}$/);
    }

    // 6. Successful result: warning + summary + top candidates + rank movement.
    await expect(page.getByTestId("scenario-summary")).toBeVisible();
    await expect(page.getByTestId("scenario-top-candidates")).toBeVisible();
    await expect(page.getByTestId("scenario-rank-move").first()).toContainText("5위 → 1위");

    // 7. Select a top candidate → the scenario candidate detail loads.
    await page.getByTestId("scenario-top-row").first().click();
    await expect(page.getByTestId("scenario-candidate-detail")).toBeVisible();
    await expect(page.getByTestId("scenario-detail-score")).toContainText("78.5000");

    // 8. Edit a weight after applying → stale-result notice.
    await setPercent(page, "zoning", 34);
    await setPercent(page, "road", 26); // keep total 100 but differ from applied
    await expect(page.getByTestId("scenario-stale-notice")).toBeVisible();

    // 9. Back to stored score view: the map still works, scenario reset.
    await page.getByTestId("suitability-view-score").click();
    await expect(page.getByTestId("map-container")).toHaveCount(1);
    await expect(page.getByTestId("suitability-summary")).toBeVisible();

    // 10. Cost view: no map at all.
    await page.getByTestId("suitability-view-cost").click();
    await expect(page.getByTestId("map-container")).toHaveCount(0);

    // 11. Landfill dashboard remains functional (its explicit no-data state).
    await page.getByTestId("mode-flow").click();
    await expect(page.getByTestId("landfill-dashboard")).toBeVisible();
  });

  test("scenario lab has no horizontal overflow and usable controls on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterScenario(page);
    await page.getByTestId("scenario-preset-equal").click();
    await expect(page.getByTestId("scenario-apply")).toBeVisible();
    // controls remain within the viewport (no page-level horizontal scroll).
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    // the four sliders + numeric inputs are all reachable.
    for (const c of ["zoning", "road", "equity", "demand"]) {
      await expect(page.getByTestId(`scenario-slider-${c}`)).toBeVisible();
      await expect(page.getByTestId(`scenario-input-${c}`)).toBeVisible();
    }
  });

  test("accessible names + text-first rank movement", async ({ page }) => {
    await enterScenario(page);
    // sliders + numeric inputs carry accessible names.
    await expect(page.getByRole("slider", { name: /Z · 토지이용/ })).toBeVisible();
    await expect(page.getByLabel(/토지이용 가중치 퍼센트 입력/)).toBeVisible();
    // comparison selector is labelled.
    await expect(page.getByLabel("비교 대상 저장 프로파일")).toBeVisible();
    // total status is a polite live region.
    await expect(page.getByTestId("scenario-total-status")).toHaveAttribute("role", "status");
  });
});
