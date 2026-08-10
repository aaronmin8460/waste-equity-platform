import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * FINAL UI INTEGRATION — the six refreshed areas verified TOGETHER.
 *
 * The six civic-dashboard milestones each shipped with a deep per-area spec, and
 * `phase7FinalRegression.spec.ts` already owns the four-area shell tour, the
 * byte-for-byte nav labels, the map-presence rule, and the landfill URL round trip.
 * This file deliberately does NOT repeat those. It owns the things that can only be
 * wrong once all six are merged into one application:
 *
 *   1. the six USER-FACING views (four areas, three suitability sub-views) enumerated
 *      as one table, so a contract is stated once for all of them rather than six
 *      times in six files;
 *   2. duplication — after navigating the whole app, no view may leave a second copy
 *      of ANY element behind. `expectNoDuplicateTestIds` compares every
 *      `data-testid` in the live document, which catches a retained map, a second
 *      cost form, a second source catalog, a second navigation, a second sub-view
 *      selector, and a stale panel from the previous view in one assertion instead
 *      of an ever-growing list of named absences;
 *   3. staleness — the previous view's owned components are gone from the DOM, not
 *      merely hidden, including across browser back/forward;
 *   4. the repaired 비용 살펴보기 first-screen action, asserted here as a CROSS-VIEW
 *      fact (it must survive arriving at the cost view by clicking through the app,
 *      not only by deep link — `facilityCostDashboard.spec.ts` owns the deep-linked
 *      geometry in full detail);
 *   5. the 데이터·출처 heading/label distinction, which is a whole-app fact: the two
 *      strings are deliberately different and both must be present at once;
 *   6. that a representative MISSING-DATA response still renders as missing after
 *      integration — never as a fabricated 0.
 *
 * Self-mocked through `mockBackend`, so no backend, database, tile server, or
 * government API is touched. Structure, geometry, and behaviour only — never a data
 * value. Deliberately NO pixel snapshots (docs/ui-refresh/baseline.md §7).
 */

const DESKTOP_VIEWPORTS = [
  { name: "1024×768", width: 1024, height: 768 },
  { name: "1280×800", width: 1280, height: 800 },
  { name: "1440×900", width: 1440, height: 900 },
  { name: "1920×1080", width: 1920, height: 1080 },
];

/** The two smaller viewports are REGRESSION checks, not a mobile redesign. */
const RESPONSIVE_VIEWPORTS = [
  { name: "768×1024", width: 768, height: 1024 },
  { name: "390×844", width: 390, height: 844 },
];

/**
 * Every user-facing view, with the contract that identifies it.
 *
 * `h1` and `navLabel` are compared EXACTLY. For 데이터·출처 they are deliberately
 * different strings (regression-contract §20) and this table is where that is
 * visible at a glance.
 */
interface View {
  name: string;
  url: string;
  /** Present once the view has finished mounting. */
  ready: string;
  /** Exact `<h1>` text. */
  h1: string;
  /** Exact primary-navigation label of the area this view belongs to. */
  navLabel: string;
  /** The nav button test id that must read `aria-pressed="true"`. */
  navTestId: string;
  /** Exactly how many `MapView`s this view mounts. */
  maps: number;
  /** True when this destination renders as a dialog over the previous one. */
  dialog?: boolean;
}

const VIEWS: View[] = [
  {
    name: "지역 지표",
    url: "/?v=1&mode=equity",
    ready: "region-select",
    h1: "지역 지표",
    navLabel: "지역 지표",
    navTestId: "mode-equity",
    maps: 1,
  },
  {
    name: "후보지 심층 분석",
    url: "/?v=1&mode=suitability&view=score",
    ready: "suitability-summary",
    h1: "후보지 심층 분석",
    navLabel: "후보지 심층 분석",
    navTestId: "mode-suitability",
    maps: 1,
  },
  {
    name: "후보지 심층 비교",
    url: "/?v=1&mode=suitability&view=scenario",
    ready: "scenario-lab",
    h1: "후보지 심층 비교",
    navLabel: "후보지 심층 비교",
    navTestId: "suitability-view-scenario",
    maps: 1,
  },
  {
    name: "후보지 분석",
    url: "/?v=1&mode=suitability&view=cost",
    ready: "facility-cost-dashboard",
    h1: "후보지 분석",
    navLabel: "후보지 분석",
    navTestId: "suitability-view-cost",
    maps: 0,
  },
  {
    name: "폐기물 처리 현황",
    url: "/?v=1&mode=flow",
    ready: "landfill-dashboard",
    h1: "폐기물 처리 현황",
    navLabel: "폐기물 처리 현황",
    navTestId: "mode-flow",
    maps: 0,
  },
  {
    name: "데이터·출처",
    url: "/?v=1&mode=transparency",
    ready: "transparency-dashboard",
    // The dialog is layered over 지역 지표 when opened cold, so the page's single
    // h1 is that destination's and one map stays mounted behind it (spec §8).
    // The dialog's own title is an h2, asserted in app/page.dataDialog.test.tsx.
    h1: "지역 지표",
    dialog: true,
    navLabel: "데이터·출처",
    navTestId: "mode-transparency",
    maps: 1,
  },
];

/** Every visible destination label, compared exactly, present on every screen. */
const NAV_LABELS = VIEWS.map((v) => v.navLabel);

/** The components each view OWNS — they must not survive into another view. */
const VIEW_OWNED_TESTIDS: Record<string, string[]> = {
  "지역 지표": ["region-select", "region-ranking", "open-full-ranking", "share-export"],
  "후보지 심층 분석": ["suitability-summary"],
  "후보지 심층 비교": ["scenario-lab"],
  "후보지 분석": ["facility-cost-dashboard", "facility-cost-form"],
  "폐기물 처리 현황": ["landfill-dashboard", "landfill-filters"],
  "데이터·출처": ["transparency-dashboard", "transparency-sources"],
};

async function openView(page: Page, view: View): Promise<void> {
  await page.goto(view.url);
  await expect(page.getByTestId(view.ready), `${view.name} mounted`).toBeVisible({
    timeout: 15000,
  });
}

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${where}: no page-level horizontal overflow`).toBeLessThanOrEqual(
    clientWidth + 1,
  );
}

/**
 * The elements that must exist AT MOST ONCE in the whole document.
 *
 * Deliberately a curated list rather than "no `data-testid` repeats": several ids
 * legitimately mark repeated rows (`score-class-row`, `land-cover-legend-row`,
 * `facility-cost-facility-type-card`, region chips, catalog items), so a blanket
 * uniqueness rule would report list rendering as a defect. Every id below is a
 * SINGLETON by contract — the shell chrome, the one map, and each area's owned
 * top-level surfaces — so a second occurrence means a duplicated control or a stale
 * view left mounted underneath the new one.
 */
const SINGLETON_TESTIDS = [
  "app-shell",
  "top-navigation",
  "app-brand",
  "mode-switch",
  "mode-equity",
  "mode-suitability",
  "mode-flow",
  "mode-transparency",
  "suitability-view-scenario",
  "suitability-view-cost",
  "map-container",
  "region-select",
  "region-ranking",
  "open-full-ranking",
  "share-export",
  "suitability-summary",
  "scenario-lab",
  "facility-cost-dashboard",
  "facility-cost-form",
  "facility-cost-setup-summary",
  "facility-cost-calculate",
  "landfill-dashboard",
  "landfill-filters",
  "transparency-dashboard",
  "transparency-sources",
  "transparency-overview",
];

/**
 * No contracted singleton appears twice in the live document.
 *
 * This is the integration assertion the per-area suites structurally cannot make:
 * each of them only ever renders its own area. A retained map, a second cost form, a
 * second source catalog, a duplicated navigation, a doubled sub-view selector, and a
 * stale panel from the previously-visited view all show up here as one failure with
 * the offending id named.
 */
async function expectNoDuplicateTestIds(page: Page, where: string): Promise<void> {
  const duplicates = await page.evaluate((ids: string[]) => {
    return ids
      .map((id) => ({ id, n: document.querySelectorAll(`[data-testid="${id}"]`).length }))
      .filter((entry) => entry.n > 1)
      .map((entry) => `${entry.id}×${entry.n}`);
  }, SINGLETON_TESTIDS);
  expect(duplicates, `${where}: no contracted singleton is rendered twice`).toEqual([]);
}

/** The shell invariants every view shares, stated once. */
async function expectViewContract(page: Page, view: View): Promise<void> {
  await expect(page.getByTestId("top-navigation"), `${view.name}: one app bar`).toHaveCount(1);
  await expect(page.getByTestId("mode-switch"), `${view.name}: one nav group`).toHaveCount(1);
  await expect(page.locator("#main-content"), `${view.name}: one main target`).toHaveCount(1);
  await expect(page.locator("h1"), `${view.name}: one page-level h1`).toHaveCount(1);
  if (view.dialog) {
    // The dialog layers over WHICHEVER destination the reader was on, so the
    // page's single h1 is that one — not a fixed string. What is pinned instead
    // is the pair that actually matters: the h1 belongs to a real destination,
    // and the dialog's own title is 데이터·출처 (an h2, never a second h1).
    const heading = (await page.locator("h1").textContent())?.trim();
    expect(NAV_LABELS, `${view.name}: h1 is a real destination`).toContain(heading);
    const dialog = page.getByTestId("data-sources-dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByRole("heading", { name: "데이터·출처" })).toBeVisible();
    await expect(dialog.locator("h1")).toHaveCount(0);
  } else {
    await expect(page.locator("h1"), `${view.name}: exact h1`).toHaveText(view.h1);
  }

  // The six frozen destination labels, all six present at once, compared exactly.
  for (const other of NAV_LABELS) {
    await expect(
      page.getByRole("button", { name: other, exact: true }),
      `${view.name}: nav label ${other}`,
    ).toHaveCount(1);
  }
  await expect(page.getByTestId(view.navTestId)).toHaveAttribute("aria-pressed", "true");

  if (view.dialog) {
    // A dialog's map count is whatever the destination BEHIND it mounts, which
    // varies with where the reader came from — so an absolute number is not a
    // property of this view. What is: the catalogue itself is map-free, and the
    // app never ends up with two maps.
    await expect(page.getByTestId("data-sources-dialog").getByTestId("map-container"))
      .toHaveCount(0);
    expect(await page.getByTestId("map-container").count()).toBeLessThanOrEqual(1);
  } else {
    await expect(page.getByTestId("map-container"), `${view.name}: map count`).toHaveCount(
      view.maps,
    );
  }
  // The sub-view segmented bar is retired — the six destinations select `view`
  // directly (docs/YEOGIDA_UI_REDESIGN_SPEC.md §2.1).
  await expect(
    page.getByTestId("suitability-subviews"),
    `${view.name}: no retired sub-view selector`,
  ).toHaveCount(0);
  // Exactly ONE destination is pressed — the three suitability destinations share
  // a mode, so a mode-only active rule would press all three.
  const pressed = await page.evaluate(
    (ids) =>
      ids.filter(
        (id) =>
          document.querySelector(`[data-testid="${id}"]`)?.getAttribute("aria-pressed") === "true",
      ),
    VIEWS.map((v) => v.navTestId),
  );
  expect(pressed, `${view.name}: exactly one pressed destination`).toEqual([view.navTestId]);

  // Nothing another view owns is left behind — except under a DIALOG, where the
  // destination behind it is supposed to still be there. That underlay is the
  // feature, not a leak (spec §8), so the sweep is skipped for the dialog view
  // and its own suite asserts what it layers over instead.
  if (view.dialog) return;
  for (const [owner, ids] of Object.entries(VIEW_OWNED_TESTIDS)) {
    if (owner === view.name) continue;
    for (const id of ids) {
      await expect(page.getByTestId(id), `${view.name}: no stale ${id} from ${owner}`).toHaveCount(
        0,
      );
    }
  }

  await expectNoDuplicateTestIds(page, view.name);
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

// --------------------------------------------------------------------------- //
// 1. Every view, at every desktop target
// --------------------------------------------------------------------------- //

for (const vp of DESKTOP_VIEWPORTS) {
  test.describe(`integrated app at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("holds the shell, heading, map, and sub-view contract in all six views", async ({
      page,
    }) => {
      for (const view of VIEWS) {
        await openView(page, view);
        await expectViewContract(page, view);
        await expectNoHorizontalOverflow(page, `${view.name} @ ${vp.name}`);
      }
    });

    test("keeps 비용 계산하기 on the first screen when reached by navigating", async ({ page }) => {
      // Arrive the way a citizen does — through the app, not by deep link — because
      // the sub-view switch keeps <main> mounted and only swaps its subtree.
      await openView(page, VIEWS[1]); // 후보지 심층 분석
      await page.getByTestId("suitability-view-cost").click();
      await expect(page.getByTestId("facility-cost-form")).toBeVisible();

      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

      const geometry = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('[data-testid="facility-cost-calculate"]')!;
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          scrollY: window.scrollY,
          top: box.top,
          bottom: box.bottom,
          covered: hit !== null && !el.contains(hit),
        };
      });
      expect(geometry.scrollY, "measured at the top of the document").toBe(0);
      expect(geometry.top, "action starts on screen").toBeGreaterThanOrEqual(0);
      expect(geometry.bottom, `action fits ${vp.height}px`).toBeLessThanOrEqual(vp.height);
      expect(geometry.covered, "action is not overlapped").toBe(false);
      // The context explaining the action's state is on the same screen.
      await expect(page.getByTestId("facility-cost-readiness")).toBeInViewport();
      await expect(page.getByTestId("facility-cost-calculate-status")).toBeInViewport();
    });
  });
}

// --------------------------------------------------------------------------- //
// 2. Basic responsive regression (NOT a mobile redesign)
// --------------------------------------------------------------------------- //

for (const vp of RESPONSIVE_VIEWPORTS) {
  test.describe(`responsive regression at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("keeps every view single-h1, duplication-free, and free of page-level side scroll", async ({
      page,
    }) => {
      for (const view of VIEWS) {
        await openView(page, view);
        await expect(page.locator("h1"), `${view.name}: one h1`).toHaveCount(1);
        await expect(page.locator("#main-content")).toHaveCount(1);
        await expect(page.getByTestId("top-navigation")).toHaveCount(1);
        await expect(page.getByTestId("map-container")).toHaveCount(view.maps);
        await expectNoDuplicateTestIds(page, `${view.name} @ ${vp.name}`);
        await expectNoHorizontalOverflow(page, `${view.name} @ ${vp.name}`);
      }
    });
  });
}

// --------------------------------------------------------------------------- //
// 3. URL restoration and round trips across the whole app
// --------------------------------------------------------------------------- //

test.describe("URL state survives integration at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("restores every documented deep link directly", async ({ page }) => {
    for (const view of VIEWS) {
      await openView(page, view);
      await expect(page.getByTestId(view.navTestId)).toHaveAttribute("aria-pressed", "true");
    }
  });

  test("navigating away and back leaves no trace of the previous view", async ({ page }) => {
    // equity → cost → transparency, all through the UI. In-app mode changes mirror
    // state with `history.replaceState` (regression-contract §3), so they add no
    // history entries by design; what is asserted here is that each hop fully
    // replaces the previous view rather than layering on top of it.
    await openView(page, VIEWS[0]);
    await page.getByTestId("mode-suitability").click();
    await expect(page.getByTestId("suitability-summary")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("suitability-view-cost").click();
    await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible();
    await expectViewContract(page, VIEWS[3]);

    // 데이터·출처 is the one destination that LAYERS rather than replaces: opening
    // it deliberately keeps 후보지 분석 mounted behind so closing can return there.
    // That is the feature, so the "fully replaces" rule does not apply to it, and
    // `expectViewContract` skips the stale-content sweep for a dialog view.
    await page.getByTestId("mode-transparency").click();
    await expect(page.getByTestId("data-sources-dialog")).toBeVisible();
    await expectViewContract(page, VIEWS[5]);
    // Closing returns to the destination it was layered over — not to a default.
    await page.getByTestId("data-sources-dialog-close").click();
    await expect(page.getByTestId("data-sources-dialog")).toHaveCount(0);
    await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible();

    // …and back to where we started, with the equity workspace whole again.
    await page.getByTestId("mode-equity").click();
    await expect(page.getByTestId("region-select")).toBeVisible();
    await expectViewContract(page, VIEWS[0]);
  });

  test("browser back and forward restore the deep-linked view", async ({ page }) => {
    // Two real document navigations DO create history entries, so this exercises the
    // browser's own back/forward against the `?v=1&mode=…&view=…` restoration path.
    await openView(page, VIEWS[0]); // 지역 지표
    await openView(page, VIEWS[3]); // 후보지 분석

    await page.goBack();
    await expect(page.getByTestId("region-select")).toBeVisible({ timeout: 15000 });
    await expectViewContract(page, VIEWS[0]);

    await page.goForward();
    await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible({ timeout: 15000 });
    await expectViewContract(page, VIEWS[3]);
  });

  test("round-trips the three suitability destinations without doubling the map", async ({
    page,
  }) => {
    await openView(page, VIEWS[1]);
    // The sub-view keys still exist in the URL; what changed is that each is now
    // reached from the top-level navigation rather than a second bar.
    const BY_VIEW_KEY = {
      score: VIEWS[1], // 후보지 심층 분석
      scenario: VIEWS[2], // 후보지 심층 비교
      cost: VIEWS[3], // 후보지 분석
    } as const;
    for (const step of ["cost", "score", "scenario", "cost", "scenario", "score"] as const) {
      const expected = BY_VIEW_KEY[step];
      await page.getByTestId(expected.navTestId).click();
      await expect(page.getByTestId(expected.ready)).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("suitability-subviews")).toHaveCount(0);
      await expect(page.getByTestId("map-container")).toHaveCount(expected.maps);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText(expected.h1);
      await expectNoDuplicateTestIds(page, `destination ${step}`);
    }
  });
});

// --------------------------------------------------------------------------- //
// 4. Terminology, live regions, and missing data after integration
// --------------------------------------------------------------------------- //

test.describe("integrated semantics at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("titles every destination with the exact label its nav button carries", async ({
    page,
  }) => {
    // The redesign UNIFIED these deliberately (spec §2.2). The old contract kept
    // "데이터와 출처" as the heading beside a "데이터·출처" nav label — two names for
    // one place, which is what a reader had to reconcile on arrival.
    for (const view of VIEWS) {
      await openView(page, view);
      await expect(page.locator("h1"), `${view.name}: one h1`).toHaveCount(1);
      await expect(page.locator("h1"), `${view.name}: h1 = nav label`).toHaveText(view.navLabel);
      await expect(page.getByTestId(view.navTestId)).toHaveText(view.navLabel);
    }
  });

  test("never doubles a live region, in any view", async ({ page }) => {
    for (const view of VIEWS) {
      await openView(page, view);
      const live = await page.evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll('[role="status"], [role="alert"], [aria-live]'),
        );
        const counts = new Map<string, number>();
        for (const node of nodes) {
          const id = node.getAttribute("data-testid");
          if (!id) continue;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        return {
          duplicated: [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id),
          // A live region nested inside another live region is announced twice.
          nested: nodes
            .filter((n) => n.parentElement?.closest('[role="status"], [role="alert"]'))
            .map((n) => n.getAttribute("data-testid") ?? n.tagName.toLowerCase()),
        };
      });
      expect(live.duplicated, `${view.name}: no duplicated live region`).toEqual([]);
      expect(live.nested, `${view.name}: no nested live region`).toEqual([]);
    }
  });

  test("renders a served no-data answer as missing, never as a fabricated zero", async ({
    page,
  }) => {
    // `mockBackend` reproduces the backend's real 404 NO_DATA_AVAILABLE path for the
    // 수도권매립지 endpoints — the representative missing-data fixture in this repo,
    // because it carries no `evidence` object and so labels nothing as official.
    await openView(page, VIEWS[4]);

    const noData = page.getByTestId("landfill-no-data");
    await expect(noData).toBeVisible();
    // An unavailable official record is an empty state, not an error alert.
    await expect(noData).not.toHaveAttribute("role", "alert");
    // No headline number was invented to fill the screen.
    await expect(page.getByTestId("landfill-kpis")).toHaveCount(0);
    await expect(page.getByTestId("landfill-kpi-quantity")).toHaveCount(0);

    const invented = await page.evaluate(() => {
      const main = document.querySelector("#main-content")!;
      // Join across element boundaries with a space: Korean labels concatenate into
      // words that were never rendered (수집 시점 + 수집 기록 없음 → "…점수집…"), and a
      // naive textContent scan would report a phantom match.
      const text = Array.from(main.querySelectorAll<HTMLElement>("*"))
        .map((el) =>
          Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent ?? "")
            .join(" "),
        )
        .join(" ");
      return ["0 t", "0톤", "0원", "0 원", "0.0"].filter((token) => text.includes(token));
    });
    expect(invented, "no zero stands in for an unavailable official value").toEqual([]);
  });
});
