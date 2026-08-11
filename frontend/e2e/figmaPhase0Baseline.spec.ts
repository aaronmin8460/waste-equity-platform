import { expect, test } from "@playwright/test";

import { mockBackend } from "./mockBackend";

/**
 * Six-mode render baseline for the Figma redesign.
 *
 * The redesign rebuilds all six surfaces one phase at a time. This spec is the
 * guardrail that runs between phases: every destination must still deep-link, still
 * render its own body, and still leave the other five reachable. It asserts on
 * STRUCTURE only — which surface appeared, which nav tab is pressed — never on data
 * values, so it stays valid as each page's visuals are replaced.
 *
 * It uses the layout-only network stub (mockBackend.ts), so it needs no backend and
 * touches no government API. Every value behind it is a synthetic layout fixture and
 * nothing synthetic is labelled official; 수도권매립지 deliberately renders its real
 * "no official data" 404 path (see mockBackend.ts for the full rationale).
 *
 * The six destinations and their URL contract come from lib/glossary.NAV_DESTINATIONS.
 * The test ids are the pre-existing, deliberately counterintuitive ones —
 * `mode-suitability` is 후보지 심층 분석 and `suitability-view-cost` is 후보지 분석 —
 * kept so ~130 existing assertions keep addressing the same controls. Do not "fix"
 * them to match the labels.
 */

/** Deep-link URL -> the nav tab that owns it, and the body it must render. */
const DESTINATIONS = [
  {
    label: "지역 지표",
    url: "/?v=1&mode=equity",
    tab: "mode-equity",
    body: "map-container",
  },
  {
    label: "폐기물 처리 현황",
    url: "/?v=1&mode=flow",
    tab: "mode-flow",
    body: "landfill-dashboard",
  },
  {
    label: "후보지 분석",
    url: "/?v=1&mode=suitability&view=cost",
    tab: "suitability-view-cost",
    body: "facility-cost-dashboard",
  },
  {
    label: "후보지 심층 분석",
    url: "/?v=1&mode=suitability&view=score",
    tab: "mode-suitability",
    body: "map-container",
  },
  {
    label: "후보지 심층 비교",
    url: "/?v=1&mode=suitability&view=scenario",
    tab: "suitability-view-scenario",
    body: "scenario-lab",
  },
  {
    label: "데이터·출처",
    url: "/?v=1&mode=transparency",
    tab: "mode-transparency",
    // 데이터·출처 is intentionally a modal over the page behind it, in both
    // production and Figma — not a separate page.
    body: "data-sources-dialog",
  },
] as const;

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

for (const destination of DESTINATIONS) {
  test(`${destination.label} renders from its deep link`, async ({ page }) => {
    await page.goto(destination.url);

    await expect(page.getByTestId("top-navigation")).toBeVisible();
    await expect(page.getByTestId(destination.body)).toBeVisible();
    await expect(page.getByTestId(destination.tab)).toHaveAttribute("aria-pressed", "true");
  });
}

test("the shell offers exactly the six destinations", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("mode-switch")).toHaveCount(1);
  for (const destination of DESTINATIONS) {
    await expect(page.getByTestId(destination.tab)).toBeVisible();
  }
});

test("every destination stays reachable by clicking through the nav", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("map-container")).toBeVisible();

  for (const destination of DESTINATIONS) {
    await page.getByTestId(destination.tab).click();
    await expect(page.getByTestId(destination.body)).toBeVisible();
    await expect(page.getByTestId(destination.tab)).toHaveAttribute("aria-pressed", "true");

    // 데이터·출처 is a modal: dismiss it so the next click is not intercepted.
    if (destination.tab === "mode-transparency") {
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("data-sources-dialog")).toHaveCount(0);
    }
  }
});

test("the page keeps exactly one h1", async ({ page }) => {
  // A single h1 per view is the shell's heading contract; the dialog title is an h2.
  for (const destination of DESTINATIONS) {
    await page.goto(destination.url);
    await expect(page.getByTestId(destination.body)).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
  }
});
