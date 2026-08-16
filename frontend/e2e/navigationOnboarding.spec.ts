import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * First-visit navigation guide (ui/NavigationOnboarding) — the e2e contract.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────
 * `playwright.config.ts` seeds the RETURNING-visitor state for the whole suite, so
 * that every other spec exercises the surface it owns rather than the guide sitting
 * on top of it. That default would otherwise leave the guide with no e2e coverage at
 * all, which is the one thing it must not have: the guide is the first thing a new
 * reader meets, and it covers the entire viewport until they dismiss it.
 *
 * This file opts back out — an empty `storageState` is a browser that has never seen
 * the app — and owns what the guide promises on that first load. The component's own
 * unit tests own the measurement/geometry logic; what is asserted HERE is only what
 * needs a real browser: that it actually appears over the real shell, that each
 * documented dismissal really closes it, and that the dismissal is remembered across
 * a reload so a reader meets it exactly once.
 *
 * The backend comes from `mockBackend`, as in the sibling shell specs — the shell
 * does not mount at all while the public-data fetch is failing, so the guide has no
 * navigation to measure. No real backend, database, or tile server is required.
 */

/** A browser with nothing remembered — i.e. a genuine first visit. */
test.use({
  storageState: { cookies: [], origins: [] },
  // The desktop floor the guide itself gates on (ui/NarrowScreenGate).
  viewport: { width: 1440, height: 900 },
});

/** Land on the shell as a first-time reader, with the guide already measured. */
async function gotoFirstVisit(page: Page): Promise<void> {
  await mockBackend(page);
  await page.goto("/");
  await expect(page.getByTestId("mode-switch")).toBeVisible();
}

/**
 * Wait until the guide is not merely rendered but OPEN and listening.
 *
 * The effect that opens it is also the one that moves focus into the panel and
 * attaches the document-level key listener, and effects run after paint — so a key
 * press sent the instant the element becomes visible can land before anything is
 * listening. Focus on the panel is the observable proof that effect has run, so
 * waiting for it removes the race instead of papering over it with a sleep.
 */
async function expectGuideListening(page: Page): Promise<void> {
  await expect(page.getByTestId("nav-onboarding")).toBeVisible();
  await expect(page.getByTestId("nav-onboarding-card")).toBeFocused();
}

test.describe("first-visit navigation guide", () => {
  test("greets a first-time reader over the real shell", async ({ page }) => {
    await gotoFirstVisit(page);

    await expect(page.getByTestId("nav-onboarding")).toBeVisible();
    // It is anchored to the REAL navigation rather than to a hard-coded 1440 canvas
    // coordinate, so the track it measures has to be on screen alongside it.
    await expect(page.getByTestId("nav-onboarding-card")).toBeVisible();
    await expect(page.getByTestId("mode-switch")).toBeVisible();
  });

  test("closes on the confirm button and stays closed across a reload", async ({ page }) => {
    await gotoFirstVisit(page);
    await expect(page.getByTestId("nav-onboarding")).toBeVisible();

    await page.getByTestId("nav-onboarding-confirm").click();
    await expect(page.getByTestId("nav-onboarding")).toHaveCount(0);

    // Remembered once per browser — a reader meets the guide exactly once.
    await page.reload();
    await expect(page.getByTestId("mode-switch")).toBeVisible();
    await expect(page.getByTestId("nav-onboarding")).toHaveCount(0);
  });

  test("closes on the close button", async ({ page }) => {
    await gotoFirstVisit(page);
    await page.getByTestId("nav-onboarding-close").click();
    await expect(page.getByTestId("nav-onboarding")).toHaveCount(0);
  });

  test("closes on Escape", async ({ page }) => {
    await gotoFirstVisit(page);
    await expectGuideListening(page);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("nav-onboarding")).toHaveCount(0);
  });

  test("closes on Space", async ({ page }) => {
    await gotoFirstVisit(page);
    await expectGuideListening(page);

    await page.keyboard.press(" ");
    await expect(page.getByTestId("nav-onboarding")).toHaveCount(0);
  });

  test("closes on a backdrop click", async ({ page }) => {
    await gotoFirstVisit(page);
    await expect(page.getByTestId("nav-onboarding")).toBeVisible();

    // The dismissal is on the ROOT, which fires only when the click lands on the root
    // ITSELF — everything outside the card is pointer-transparent, so a far corner
    // reaches it while a click inside the card still does not.
    await page.getByTestId("nav-onboarding").click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("nav-onboarding")).toHaveCount(0);
  });

  test("hands the application back once dismissed", async ({ page }) => {
    await gotoFirstVisit(page);
    await page.getByTestId("nav-onboarding-confirm").click();
    await expect(page.getByTestId("nav-onboarding")).toHaveCount(0);

    // The click the guide used to intercept now reaches the navigation, which is the
    // whole reason the rest of the suite runs as a returning visitor.
    await page.getByRole("button", { name: "지역별 폐기물 처리 현황", exact: true }).click();
    await expect(page.getByTestId("landfill-dashboard")).toBeVisible();
  });
});
