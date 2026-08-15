import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

/**
 * Responsive-layout e2e coverage — the single source of truth for the viewport
 * contract, in its executable form.
 *
 * Unlike the live smoke specs, this one intercepts every backend request itself
 * (see mockBackend), so it drives the real application UI — the desktop shell, the
 * MapLibre map container, the floating overlays — at real viewport sizes without any
 * backend, tile server, or official data. It only ever asserts on *layout*
 * (dimensions, overflow, stacking), never on data values. The 수도권매립지 (flow)
 * dashboard is driven to its explicitly-unavailable state (the mock serves the
 * backend's real 404 NO_DATA response) and is guarded against ever displaying a
 * synthetic fixture as official public data.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────────
 * 여기다 is a DESKTOP-FIRST, DESKTOP-REQUIRED analytical product. Every full-page
 * frame in the canonical Figma file is 1440px wide and the file contains no phone
 * composition for any of the six destinations, so there are exactly two states:
 *
 *   ≥ 1024px  the analytical application, in its one desktop composition
 *              1440 canonical · 1280 normal · 1024 compressed but fully functional
 *   < 1024px  ui/NarrowScreenGate, INSTEAD OF the application — the dashboards are
 *              not mounted at all, so there is no map, no WebGL context, no tiles
 *
 * The previous contract treated 390×844 and 430×932 as primary ANALYTICAL targets
 * and stacked the whole dashboard into a phone column below 768px (sidebar above a
 * 60vh map; the 후보지 심층 분석 workspace as left panel → map → right panel down a
 * multi-screen scroll). That layout was never in Figma. It is gone, and so are the
 * assertions that required it — a `<768` viewport is now asserted to show the gate,
 * not a working phone dashboard.
 */

/** The desktop floor. Must equal DESKTOP_MIN_WIDTH in ui/NarrowScreenGate.tsx. */
const DESKTOP_MIN_WIDTH = 1024;

/** Widths the analytical application is specified to work at. */
const DESKTOP_VIEWPORTS = [
  { name: "desktop floor 1024×768", width: 1024, height: 768 },
  { name: "narrow desktop 1280×800", width: 1280, height: 800 },
  { name: "canonical desktop 1440×900", width: 1440, height: 900 },
];

/**
 * Widths below the floor. 1023×800 is the boundary case — one CSS pixel under — and
 * is the assertion that actually pins the number down; 768×1024 (tablet portrait)
 * used to be the width at which the side-by-side layout began, so it is kept as the
 * explicit record that it no longer is.
 */
const NARROW_VIEWPORTS = [
  { name: "phone 390×844", width: 390, height: 844 },
  { name: "large phone 430×932", width: 430, height: 932 },
  { name: "tablet portrait 768×1024", width: 768, height: 1024 },
  { name: "one pixel under the floor 1023×800", width: 1023, height: 800 },
];

/**
 * The document must never scroll horizontally. Compare the root's scroll width
 * against its client width, allowing a 1px rounding tolerance.
 */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "no page-level horizontal overflow").toBeLessThanOrEqual(clientWidth + 1);
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

for (const vp of DESKTOP_VIEWPORTS) {
  test.describe(`${vp.name} — the analytical application`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("loads, keeps the map visibly sized, and never overflows horizontally", async ({
      page,
    }) => {
      await page.goto("/");

      // Equity mode mounts the map. The container itself is what we measure (it
      // renders regardless of WebGL/tile availability).
      const map = page.getByTestId("map-container");
      await expect(map).toBeVisible();
      const box = await map.boundingBox();
      expect(box).not.toBeNull();
      // Meaningful width and height — never squeezed to a sliver or collapsed.
      expect(box!.width).toBeGreaterThan(200);
      expect(box!.height).toBeGreaterThan(240);
      // Not pushed entirely outside the viewport.
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x).toBeLessThan(vp.width);
      expect(box!.x + box!.width).toBeGreaterThan(vp.width / 2);

      // The gate belongs to narrow widths only.
      await expect(page.getByTestId("narrow-screen-gate")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });

    test("exposes the mode switcher and lets every mode be selected", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByTestId("mode-switch")).toBeVisible();

      // Suitability (still a map mode).
      await page.getByTestId("mode-suitability").click();
      await expect(page.getByTestId("mode-suitability")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("map-container")).toBeVisible();
      await expect(page.getByTestId("suitability-summary")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // 수도권매립지 (full-width dashboard, no map). The mock serves the backend's
      // real "no official data" response (404 NO_DATA_AVAILABLE), so the dashboard
      // renders its explicitly-unavailable state — never a fabricated official
      // summary of zeros.
      await page.getByTestId("mode-flow").click();
      await expect(page.getByTestId("landfill-dashboard")).toBeVisible();
      await expect(page.getByTestId("map-container")).toHaveCount(0);
      // Phase 5: that 404 is the backend ANSWERING "no official record", so it
      // renders the no-data state — not the red `role="alert"` error panel that
      // used to absorb both cases. The filter controls stay usable either way.
      await expect(page.getByTestId("landfill-no-data")).toBeVisible();
      await expect(page.getByTestId("landfill-error")).toHaveCount(0);
      await expect(page.getByTestId("landfill-filters")).toBeVisible();
      // Regression guard: this synthetic layout fixture is NOT displayed as
      // official public data. The KPI and evidence blocks (which carry the
      // OFFICIAL_REPORTED_VALUE / OFFICIAL_INPUTS_DERIVED_VALUE labels) never
      // mount, and no official-evidence label text appears anywhere on the page.
      await expect(page.getByTestId("landfill-kpis")).toHaveCount(0);
      await expect(page.getByTestId("landfill-evidence")).toHaveCount(0);
      await expect(page.getByText("OFFICIAL_REPORTED_VALUE")).toHaveCount(0);
      await expect(page.getByText("OFFICIAL_INPUTS_DERIVED_VALUE")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);

      // Back to equity restores the map.
      await page.getByTestId("mode-equity").click();
      await expect(page.getByTestId("map-container")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test("keeps all six navigation destinations on ONE row", async ({ page }) => {
      await page.goto("/");
      const nav = page.getByTestId("top-navigation");
      await expect(nav).toBeVisible();

      const buttons = page.getByTestId("mode-switch").locator("button");
      await expect(buttons).toHaveCount(6);

      // The invariant is that the six tabs share a row — a wrapped nav is the "ugly
      // second row" the desktop contract forbids, and it also eats the map's height
      // budget. Compare every tab's vertical position against the first.
      const boxes = await buttons.all();
      const tops: number[] = [];
      for (const button of boxes) {
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        tops.push(box!.y);
      }
      for (const top of tops) {
        expect(Math.abs(top - tops[0]), "all six nav tabs share one row").toBeLessThan(4);
      }

      // …and the bar itself stays compact, which is the same invariant measured from
      // the outside: two rows of 44px tabs could not fit in this budget.
      const navBox = (await nav.boundingBox())!;
      expect(navBox.height).toBeLessThanOrEqual(vp.height * 0.12);
      await expectNoHorizontalOverflow(page);
    });

    test("lays the sidebar and the map out side by side", async ({ page }) => {
      await page.goto("/");
      const aside = page.locator("aside");
      const map = page.getByTestId("map-container");
      await expect(aside).toBeVisible();
      await expect(map).toBeVisible();
      const asideBox = (await aside.boundingBox())!;
      const mapBox = (await map.boundingBox())!;

      // The sidebar opens at its 360px default — it replaced the fixed md:w-96
      // (384px) in spec §3 — and the map sits to its right on the same row, after
      // the 10px drag handle.
      expect(asideBox.width).toBeGreaterThan(350);
      expect(asideBox.width).toBeLessThan(372);
      expect(mapBox.x).toBeGreaterThanOrEqual(asideBox.x + asideBox.width - 2);
      expect(Math.abs(mapBox.y - asideBox.y)).toBeLessThan(4);
      // The handle exists and sits BETWEEN the column and the map. It is no longer
      // hidden at any width — there is no stacked layout for it to be meaningless in.
      const handle = page.getByTestId("sidebar-resizer");
      await expect(handle).toBeVisible();
      const handleBox = (await handle.boundingBox())!;
      expect(handleBox.x).toBeGreaterThanOrEqual(asideBox.x + asideBox.width - 2);
      expect(handleBox.x + handleBox.width).toBeLessThanOrEqual(mapBox.x + 2);
    });

    test("force-expands the control panels (no collapse toggles)", async ({ page }) => {
      await page.goto("/");
      // The disclosure summaries are hidden and their bodies shown, so every panel is
      // reachable without interaction. This used to be a `md+` behaviour with a
      // collapsed phone counterpart; it is now unconditional, because the widths that
      // collapsed them no longer render the application at all.
      await expect(page.getByTestId("map-legend-summary")).toBeHidden();
      await expect(page.getByTestId("choropleth-legend-row").first()).toBeVisible();
      await expect(page.getByTestId("facilities-toggle")).toBeVisible();
    });

    test("floats the equity legend inside the map, clear of the attribution", async ({ page }) => {
      await page.goto("/");
      const mapBox = (await page.getByTestId("map-container").boundingBox())!;
      const legend = page.getByTestId("map-legend");
      await expect(legend).toBeVisible();
      const legendBox = (await legend.boundingBox())!;
      // The floating legend sits within the map bounds (small rounding tolerance).
      expect(legendBox.x).toBeGreaterThanOrEqual(mapBox.x - 2);
      expect(legendBox.y).toBeGreaterThanOrEqual(mapBox.y - 2);
      expect(legendBox.x + legendBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 2);
      expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height + 2);
      // It is anchored to the LEFT edge of the map.
      expect(legendBox.x).toBeLessThan(mapBox.x + 24);
      // It clears the bottom-right OpenStreetMap attribution: the legend's bottom
      // edge sits above the attribution's top, so the two never overlap even when
      // the map (and thus the legend's share of it) is narrow.
      const attrib = page.locator(".maplibregl-ctrl-attrib");
      const attribBox = await attrib.boundingBox();
      if (attribBox) {
        expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(attribBox.y + 2);
      }
      await expectNoHorizontalOverflow(page);
    });

    test("fills the row to the viewport bottom — no empty/black strip below the map", async ({
      page,
    }) => {
      await page.goto("/");
      const map = page.getByTestId("map-container");
      await expect(map).toBeVisible();
      const box = (await map.boundingBox())!;
      expect(box).not.toBeNull();
      // The map begins immediately BELOW the chrome, with no gap between them.
      const nav = page.getByTestId("top-navigation");
      await expect(nav).toBeVisible();
      const navBox = (await nav.boundingBox())!;
      const chromeBottom = navBox.y + navBox.height;
      expect(box.y).toBeGreaterThanOrEqual(chromeBottom - 2);
      expect(box.y).toBeLessThanOrEqual(chromeBottom + 2);
      // The chrome itself stays compact, so it never eats the map's height budget.
      expect(chromeBottom).toBeLessThanOrEqual(vp.height * 0.12);
      // …and the map reaches the bottom of the viewport within a small rounding
      // tolerance, so no empty (previously black) strip is left below the canvas.
      expect(box.y + box.height).toBeGreaterThanOrEqual(vp.height - 6);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 6);
      // It is NOT the ~60% height the retired mobile `.map-pane` rule used to force
      // (the empty-strip bug, when a broadly-scoped @supports rule leaked it here).
      expect(box.height).toBeGreaterThan(vp.height * 0.8);
      // Meaningful width beside the sidebar.
      expect(box.width).toBeGreaterThan(200);
      await expectNoHorizontalOverflow(page);
    });
  });
}

for (const vp of NARROW_VIEWPORTS) {
  test.describe(`${vp.name} — the narrow-screen gate`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("shows the gate INSTEAD OF the analytical application", async ({ page }) => {
      await page.goto("/");

      const gate = page.getByTestId("narrow-screen-gate");
      await expect(gate).toBeVisible();

      // Not mounted, not merely hidden: there is no map container, no MapLibre
      // canvas, no navigation, and no dashboard anywhere in the document. A
      // `display: none` fix would leave every one of these present.
      await expect(page.getByTestId("map-container")).toHaveCount(0);
      await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
      await expect(page.getByTestId("app-shell")).toHaveCount(0);
      await expect(page.getByTestId("top-navigation")).toHaveCount(0);
      await expect(page.getByTestId("mode-switch")).toHaveCount(0);
      await expect(page.getByTestId("landfill-dashboard")).toHaveCount(0);
      await expect(page.getByTestId("transparency-sources")).toHaveCount(0);
    });

    test("states the requirement concisely, in Korean, and never overflows", async ({ page }) => {
      await page.goto("/");
      const gate = page.getByTestId("narrow-screen-gate");
      await expect(gate).toContainText("넓은 화면에 최적화되어 있습니다");
      await expect(gate).toContainText(`${DESKTOP_MIN_WIDTH}px 이상의 데스크톱`);
      // 여기다 identity is retained, so this reads as the product rather than an
      // error page.
      await expect(gate).toContainText("여기다");

      // The gate is held to the same overflow rule as every dashboard — it is the
      // one thing a phone actually sees, so it must be clean at 390px.
      await expectNoHorizontalOverflow(page);
      const gateBox = (await gate.boundingBox())!;
      expect(gateBox.x).toBeGreaterThanOrEqual(-1);
      expect(gateBox.width).toBeLessThanOrEqual(vp.width + 1);
    });

    test("keeps the skip-link target and exactly one heading", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByTestId("narrow-screen-gate")).toBeVisible();

      // app/layout.tsx renders a permanent skip link to #main-content, so the target
      // must exist here too or the WCAG 2.4.1 bypass block breaks at exactly these
      // widths.
      const target = page.locator("#main-content");
      await expect(target).toHaveCount(1);
      expect(await target.evaluate((el) => el.tagName)).toBe("MAIN");
      await expect(target).toHaveAttribute("tabindex", "-1");
      // One <h1>, the same rule every dashboard view follows.
      await expect(page.locator("h1")).toHaveCount(1);
    });

    test("logs no console error", async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));

      await page.goto("/");
      await expect(page.getByTestId("narrow-screen-gate")).toBeVisible();

      // Network failures are the mock's business, not the gate's; anything else is a
      // real crash on the narrow path.
      const real = errors.filter((text) => !/Failed to load resource|net::ERR_/i.test(text));
      expect(real, `unexpected console errors: ${real.join(" | ")}`).toHaveLength(0);
    });
  });
}

test.describe("crossing the desktop floor", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("swaps between the application and the gate as the viewport is resized", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("map-container")).toBeVisible();

    // Narrowing past the floor replaces the application with the gate…
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(page.getByTestId("narrow-screen-gate")).toBeVisible();
    await expect(page.getByTestId("map-container")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // …and widening back restores it. The gate is a state, not a dead end: the shell
    // subscribes to the media query rather than reading it once on load, and
    // app/page.tsx never unmounted, so the analytical and URL state are unchanged.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("map-container")).toBeVisible();
    await expect(page.getByTestId("narrow-screen-gate")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
});
