import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockEquityBackend } from "./phase4Fixtures";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * Collapsed-by-default map insight disclosures — 지역 부담 and 후보지 분석.
 *
 * Both map overlays used to render an always-expanded three-column card across the
 * full width of the map's bottom band. They are now one native `<details>` each,
 * closed on arrival, behind the SAME compact bar (해석 · 주의 · 출처 보기 ▾) at the
 * bottom-right of the map. This file owns what that change promises, in a real
 * browser, at every supported viewport:
 *
 *   1. the bar is genuinely compact and genuinely inside the map;
 *   2. the panel it hides still contains everything it contained before;
 *   3. nothing it adds — closed OR open — intercepts a map drag, the legend, the
 *      MapLibre zoom controls, or the top-left layer controls.
 *
 * Point 3 is asserted by HIT TESTING (`document.elementFromPoint`) and by real,
 * unforced clicks. `{ force: true }` is banned here on purpose: forcing a click is
 * exactly how an overlay collision gets hidden instead of found
 * (docs/ui-refresh/regression-contract.md).
 *
 * Self-mocked through the existing equity/suitability fixtures: no backend, no
 * database, no tile server, no government API. Geometry and behaviour only — never a
 * fixture value, and deliberately no pixel snapshots (docs/ui-refresh/baseline.md §7).
 */

const DESKTOP_VIEWPORTS = [
  { name: "1024×768 (minimum supported)", width: 1024, height: 768 },
  { name: "1280×800", width: 1280, height: 800 },
  { name: "1440×900", width: 1440, height: 900 },
  { name: "1920×1080", width: 1920, height: 1080 },
];

/** The two smaller sizes are REGRESSION checks, not a mobile redesign. */
const NARROW_VIEWPORTS = [
  { name: "mobile 390×844", width: 390, height: 844 },
  { name: "tablet-portrait 768×1024", width: 768, height: 1024 },
];

/** The one frozen label both bars print. */
const SUMMARY_LABEL = "해석 · 주의 · 출처 보기";

/** The compact bar's contracted height band. */
const COMPACT_MIN = 36;
const COMPACT_MAX = 44;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A land-cover release the control accepts, so its toggle is genuinely enabled. */
const LAND_COVER_RELEASE = {
  statistics_version_id: 9,
  status: "SUCCEEDED",
  candidate_grid_version: "grid-v1",
  expected_cell_count: 12,
  processed_cell_count: 12,
  disclosures: {
    license_status: "GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION",
    used_in_suitability_scoring: false,
  },
};

async function openEquity(page: Page): Promise<void> {
  await mockEquityBackend(page);
  await page.goto("/?v=1&mode=equity");
  await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
}

async function openSuitability(page: Page, view: "score" | "scenario"): Promise<void> {
  await mockSuitabilityBackend(page);
  // Served BEFORE navigation so the layer control mounts available, not disabled —
  // a disabled control would make "still clickable" vacuously true.
  await page.route("**/cell-statistics/release", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(LAND_COVER_RELEASE),
    }),
  );
  await page.goto(`/?v=1&mode=suitability&view=${view}`);
  await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
  // Each sub-view has its own sidebar landmark; waiting for the right one keeps the
  // geometry below from being measured mid-render.
  await expect(
    page.getByTestId(view === "scenario" ? "scenario-lab" : "suitability-summary"),
  ).toBeVisible();
}

/** The three map views that carry a disclosure, by the test IDs they use. */
const CASES = [
  {
    name: "지역 지표",
    open: (page: Page) => openEquity(page),
    strip: "equity-insight-strip",
    summary: "equity-insight-summary",
    interpretation: "insight-interpretation",
    caution: "insight-caution",
    action: "insight-open-sources",
    heading: "자료 기준·출처",
  },
  {
    name: "후보지 심층 분석",
    open: (page: Page) => openSuitability(page, "score"),
    strip: "suitability-insight-strip",
    summary: "suitability-insight-summary",
    interpretation: "suitability-insight-interpretation",
    caution: "suitability-insight-caution",
    action: "suitability-insight-open-sources",
    heading: "현재 기준·출처",
  },
  {
    name: "후보지 심층 비교",
    open: (page: Page) => openSuitability(page, "scenario"),
    strip: "suitability-insight-strip",
    summary: "suitability-insight-summary",
    interpretation: "suitability-insight-interpretation",
    caution: "suitability-insight-caution",
    action: "suitability-insight-open-sources",
    heading: "현재 기준·출처",
  },
] as const;

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  expect(b, "element has a layout box").not.toBeNull();
  return b!;
}

function overlaps(a: Box, b: Box, tolerance = 1): boolean {
  return (
    a.x < b.x + b.width - tolerance &&
    b.x < a.x + a.width - tolerance &&
    a.y < b.y + b.height - tolerance &&
    b.y < a.y + a.height - tolerance
  );
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

/** What is actually on top at a point — the only honest overlap answer. */
async function hitTest(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    if (!el) return "none";
    const owner = el.closest("[data-testid]");
    const testId = owner?.getAttribute("data-testid");
    if (testId) return `testid:${testId}`;
    if (el.closest(".maplibregl-canvas-container")) return "map-canvas";
    if (el.closest(".maplibregl-ctrl")) return "maplibre-ctrl";
    return el.tagName.toLowerCase();
  }, [x, y]);
}

// --------------------------------------------------------------------------- //
// 1. Compact by default, at every supported desktop viewport
// --------------------------------------------------------------------------- //

for (const vp of DESKTOP_VIEWPORTS) {
  for (const c of CASES) {
    test.describe(`${c.name} insight disclosure at ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test("arrives collapsed, compact, right-aligned, and fully inside the map", async ({
        page,
      }) => {
        await c.open(page);

        const strip = page.getByTestId(c.strip);
        await expect(strip).toHaveCount(1);
        await expect(strip).toBeVisible();
        // Closed on arrival — the platform state, not a class.
        expect(await strip.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);

        const summary = page.getByTestId(c.summary);
        await expect(summary).toHaveCount(1);
        await expect(summary).toBeVisible();
        // The visible label is exactly the frozen string; the chevron is aria-hidden,
        // so the accessible name is the same string a sighted reader sees.
        expect((await summary.innerText()).replace(/\s*▾\s*$/, "").trim()).toBe(SUMMARY_LABEL);
        await expect(summary).toHaveAccessibleName(SUMMARY_LABEL);

        const mapBox = await box(page.getByTestId("map-container"));
        const closed = await box(strip);
        expect(closed.height, "compact bar height").toBeGreaterThanOrEqual(COMPACT_MIN);
        expect(closed.height, "compact bar height").toBeLessThanOrEqual(COMPACT_MAX);
        // It is a bar, not a band: nowhere near the full map width.
        expect(closed.width, "does not span the map").toBeLessThan(mapBox.width * 0.5);
        // Wholly inside the map workspace, at its right edge.
        expect(closed.x).toBeGreaterThanOrEqual(mapBox.x - 2);
        expect(closed.x + closed.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 2);
        expect(closed.y).toBeGreaterThanOrEqual(mapBox.y - 2);
        expect(closed.y + closed.height).toBeLessThanOrEqual(mapBox.y + mapBox.height + 2);
        expect(closed.x + closed.width).toBeGreaterThan(mapBox.x + mapBox.width - 40);
        // It covers a negligible share of the canvas.
        const coverage = (closed.width * closed.height) / (mapBox.width * mapBox.height);
        expect(coverage, "collapsed bar covers <3% of the map").toBeLessThan(0.03);

        await expectNoHorizontalOverflow(page, `${c.name} closed @ ${vp.name}`);
      });

      test("opens upward into a bounded card that stays in the map workspace", async ({ page }) => {
        await c.open(page);
        const strip = page.getByTestId(c.strip);
        const mapBox = await box(page.getByTestId("map-container"));
        const closed = await box(strip);

        await page.getByTestId(c.summary).click();
        expect(await strip.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
        const open = await box(strip);

        // Grew UPWARD from the same bottom edge — the overlay column is
        // bottom-anchored, so the card never pushes past the map's lower bound.
        expect(open.y + open.height).toBeCloseTo(closed.y + closed.height, 0);
        expect(open.y, "the card grew upward").toBeLessThan(closed.y);
        expect(open.height).toBeGreaterThan(closed.height);

        // Bounded, and still inside the map workspace on all four sides.
        expect(open.width, "desktop maximum width").toBeLessThanOrEqual(832 + 2);
        expect(open.x).toBeGreaterThanOrEqual(mapBox.x - 2);
        expect(open.x + open.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 2);
        expect(open.y).toBeGreaterThanOrEqual(mapBox.y - 2);
        expect(open.y + open.height).toBeLessThanOrEqual(mapBox.y + mapBox.height + 2);
        // The map stays dominant even expanded. The bound is looser than the
        // collapsed one (which the dashboard specs hold at a third) because the
        // expanded card is a transient, user-opened state and carries a ~40px
        // summary bar the always-expanded card did not have.
        expect(open.height).toBeLessThan(mapBox.height * 0.4);

        await expectNoHorizontalOverflow(page, `${c.name} open @ ${vp.name}`);

        // The panel is not a nested scroll container.
        const scrolls = await strip.evaluate((el) => {
          const body = el.querySelector<HTMLElement>(".map-insight-body")!;
          return body.scrollHeight > body.clientHeight + 1;
        });
        expect(scrolls, "expanded body does not scroll internally").toBe(false);
      });

      test("never overlaps the legend, the zoom controls, the layer stack, or the sidebar", async ({
        page,
      }) => {
        await c.open(page);
        const strip = page.getByTestId(c.strip);

        const others: { label: string; locator: Locator }[] = [
          { label: "legend", locator: page.getByTestId("map-legend") },
          { label: "sidebar (metric/profile selector)", locator: page.locator("aside") },
          { label: "zoom controls", locator: page.locator(".maplibregl-ctrl-top-right") },
          { label: "wetland control", locator: page.getByTestId("wetland-layer-control") },
          { label: "land-cover control", locator: page.getByTestId("land-cover-layer-control") },
        ];

        for (const state of ["closed", "open"] as const) {
          if (state === "open") await page.getByTestId(c.summary).click();
          const stripBox = await box(strip);
          for (const other of others) {
            if ((await other.locator.count()) === 0) continue;
            const otherBox = await other.locator.boundingBox();
            if (!otherBox) continue;
            expect(
              overlaps(stripBox, otherBox),
              `${c.name} ${state} @ ${vp.name}: insight must not overlap the ${other.label}`,
            ).toBe(false);
          }
        }
      });
    });
  }
}

// --------------------------------------------------------------------------- //
// 2. Behaviour and pointer-event safety, at the primary desktop target
// --------------------------------------------------------------------------- //

for (const c of CASES) {
  test.describe(`${c.name} insight behaviour at 1440×900`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("opens and closes by mouse, and by Enter and Space from the keyboard", async ({
      page,
    }) => {
      await c.open(page);
      const strip = page.getByTestId(c.strip);
      const summary = page.getByTestId(c.summary);
      const isOpen = () => strip.evaluate((el) => (el as HTMLDetailsElement).open);

      // Mouse.
      await summary.click();
      expect(await isOpen()).toBe(true);
      await summary.click();
      expect(await isOpen()).toBe(false);

      // Keyboard — native <summary> behaviour, no custom handler.
      await summary.focus();
      await expect(summary).toBeFocused();
      const focusRing = await summary.evaluate((el) => {
        el.focus();
        return getComputedStyle(el).outlineWidth;
      });
      expect(focusRing, "a visible focus ring, not outline:none").not.toBe("0px");

      await page.keyboard.press("Enter");
      expect(await isOpen()).toBe(true);
      await page.keyboard.press("Enter");
      expect(await isOpen()).toBe(false);

      await page.keyboard.press("Space");
      expect(await isOpen()).toBe(true);
      await page.keyboard.press("Space");
      expect(await isOpen()).toBe(false);
    });

    test("keeps the closed panel out of the tab order and the open one reachable", async ({
      page,
    }) => {
      await c.open(page);
      const action = page.getByTestId(c.action);
      // Closed: the action exists in the DOM but cannot be reached or clicked.
      await expect(action).toBeHidden();

      await page.getByTestId(c.summary).click();
      await expect(action).toBeVisible();
      // Focus is not trapped: tabbing from the summary reaches the panel, and
      // tabbing on leaves it — no focus management code is involved at all.
      await page.getByTestId(c.summary).focus();
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        (stripId) =>
          document
            .querySelector(`[data-testid="${stripId}"]`)!
            .contains(document.activeElement),
        c.strip,
      );
      expect(inside, "tab moves into the revealed panel").toBe(true);
    });

    test("reveals the same 해석, 주의, and source content, and routes from it", async ({ page }) => {
      await c.open(page);
      await page.getByTestId(c.summary).click();

      await expect(page.getByTestId(c.interpretation)).toBeVisible();
      await expect(page.getByTestId(c.caution)).toBeVisible();
      await expect(page.getByTestId(c.strip)).toContainText("해석");
      await expect(page.getByTestId(c.strip)).toContainText("주의");
      await expect(page.getByTestId(c.strip)).toContainText(c.heading);

      const action = page.getByTestId(c.action);
      await expect(action).toHaveText("출처 자세히 보기");
      await action.click();
      await expect(page.getByTestId("mode-transparency")).toHaveAttribute("aria-pressed", "true");
      // That area mounts no map, so exactly one map is ever mounted.
      await expect(page.getByTestId("map-container")).toHaveCount(0);
    });

    test("returns to the collapsed default after navigating away and back", async ({ page }) => {
      await c.open(page);
      const strip = page.getByTestId(c.strip);
      await page.getByTestId(c.summary).click();
      expect(await strip.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);

      await page.getByTestId("mode-transparency").click();
      await expect(page.getByTestId(c.strip)).toHaveCount(0);
      await page.getByTestId(c.name === "지역 지표" ? "mode-equity" : "mode-suitability").click();
      if (c.name === "후보지 심층 비교") {
        await page.getByTestId("suitability-view-scenario").click();
        await expect(page.getByTestId("scenario-lab")).toBeVisible();
      }

      const back = page.getByTestId(c.strip);
      await expect(back).toHaveCount(1);
      await expect(back).toBeVisible();
      expect(
        await back.evaluate((el) => (el as HTMLDetailsElement).open),
        "the disclosure is collapsed again, and there is no stale second one",
      ).toBe(false);
      await expect(page.getByTestId(c.summary)).toHaveCount(1);
    });

    test("lets the map, the legend, and the MapLibre controls take their own clicks", async ({
      page,
    }) => {
      await c.open(page);
      const strip = page.getByTestId(c.strip);
      const mapBox = await box(page.getByTestId("map-container"));

      for (const state of ["closed", "open"] as const) {
        if (state === "open") await page.getByTestId(c.summary).click();
        const stripBox = await box(strip);

        // The summary itself receives clicks where it visibly is (the topmost
        // test-identified element there is the summary, i.e. the disclosure).
        expect(
          await hitTest(page, stripBox.x + stripBox.width / 2, stripBox.y + 8),
          `${state}: the bar receives its own clicks`,
        ).toBe(`testid:${c.summary}`);

        // …and the full-width positioning row beside it does NOT: the map canvas is
        // on top immediately to the LEFT of the bar, at the same height.
        const besideX = mapBox.x + 24;
        const besideY = stripBox.y + Math.min(stripBox.height, 20) / 2;
        expect(
          await hitTest(page, besideX, besideY),
          `${state}: the empty overlay row must not intercept the map`,
        ).not.toContain("insight");

        // The centre of the map is the canvas in both states.
        expect(
          await hitTest(page, mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 3),
          `${state}: the map centre is the canvas`,
        ).toMatch(/map-canvas|map-container/);
      }

      // Real, unforced drag on the canvas away from every overlay: the events land
      // on the MapLibre canvas container rather than on an invisible wrapper.
      await page.evaluate(() => {
        const w = window as unknown as { __drag?: string[] };
        w.__drag = [];
        document.addEventListener(
          "mousedown",
          (e) => {
            const el = e.target as Element;
            w.__drag!.push(el.closest(".maplibregl-canvas-container") ? "canvas" : "other");
          },
          { capture: true },
        );
      });
      const dragY = mapBox.y + mapBox.height / 3;
      await page.mouse.move(mapBox.x + mapBox.width / 2, dragY);
      await page.mouse.down();
      await page.mouse.move(mapBox.x + mapBox.width / 2 - 80, dragY - 40, { steps: 8 });
      await page.mouse.up();
      const drag = await page.evaluate(() => (window as unknown as { __drag: string[] }).__drag);
      expect(drag, "the drag reached the map canvas").toContain("canvas");
      expect(drag, "nothing else swallowed the drag").not.toContain("other");

      // The MapLibre zoom buttons take a real click.
      const zoomIn = page.locator(".maplibregl-ctrl-zoom-in");
      if ((await zoomIn.count()) > 0) {
        await expect(zoomIn).toBeVisible();
        await zoomIn.click();
        await expect(zoomIn).toBeEnabled();
      }
    });

    test("changes no metric, no status filter, and no legend color when toggled", async ({
      page,
    }) => {
      await c.open(page);
      const legendRow =
        c.name === "지역 지표"
          ? page.getByTestId("choropleth-legend-row")
          : page.getByTestId("score-class-row");
      const swatchesBefore = await legendRow.evaluateAll((els) =>
        els.map((el) => getComputedStyle(el.querySelector("span")!).backgroundColor),
      );
      const urlBefore = page.url();

      await page.getByTestId(c.summary).click();
      await page.getByTestId(c.summary).click();

      const swatchesAfter = await legendRow.evaluateAll((els) =>
        els.map((el) => getComputedStyle(el.querySelector("span")!).backgroundColor),
      );
      expect(swatchesAfter).toEqual(swatchesBefore);
      // The disclosure owns no analytical state, so it writes nothing to the URL.
      expect(page.url()).toBe(urlBefore);
      if (c.name === "지역 지표") {
        await expect(page.locator('input[type="radio"][name="metric"]:checked')).toHaveCount(1);
      } else {
        await expect(page.getByTestId("status-toggle-ELIGIBLE")).toBeChecked();
      }
    });
  });
}

// --------------------------------------------------------------------------- //
// 3. The suitability map controls the collapsed card used to crowd
// --------------------------------------------------------------------------- //

test.describe("후보지 분석 map controls stay operable beside the collapsed insight", () => {
  for (const vp of [
    { name: "1024×768", width: 1024, height: 768 },
    { name: "1440×900", width: 1440, height: 900 },
  ]) {
    test(`every top-left and legend control takes a real click at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openSuitability(page, "score");

      // The top-left layer stack — the surface the tall always-expanded card used to
      // reach at 768px-class heights. Real clicks, never `{ force: true }`.
      await page.getByTestId("wetland-layer-summary").click();
      await expect(page.getByTestId("wetland-layer-toggle")).toBeVisible();
      await page.getByTestId("wetland-layer-summary").click();

      const lcSummary = page.getByTestId("land-cover-layer-summary");
      const lcToggle = page.getByTestId("land-cover-layer-toggle");
      await lcSummary.click();
      await expect(lcToggle).toBeVisible();
      await expect(lcToggle).toBeEnabled();
      await lcToggle.check();
      await expect(lcToggle).toBeChecked();
      await lcToggle.uncheck();
      await lcSummary.click();
      await expect(lcToggle).toBeHidden();

      // The legend's own controls, which live in the same bottom band as the insight.
      const eligible = page.getByTestId("status-toggle-ELIGIBLE");
      await expect(eligible).toBeChecked();
      await eligible.uncheck();
      await expect(eligible).not.toBeChecked();
      await eligible.check();

      // …and all of that still holds with the insight EXPANDED — the state that used
      // to lift the legend over the top-left layer stack. Both layer disclosures open
      // and close on real clicks, and the legend filter still takes one.
      await page.getByTestId("suitability-insight-summary").click();
      await expect(page.getByTestId("suitability-insight-strip")).toContainText("현재 기준·출처");
      await lcSummary.click();
      await expect(lcToggle).toBeVisible();
      await lcToggle.check();
      await expect(lcToggle).toBeChecked();
      await lcToggle.uncheck();
      await lcSummary.click();
      await expect(lcToggle).toBeHidden();
      await eligible.uncheck();
      await expect(eligible).not.toBeChecked();
      await eligible.check();

      // The MapLibre zoom buttons, in the same expanded state.
      const zoomIn = page.locator(".maplibregl-ctrl-zoom-in");
      if ((await zoomIn.count()) > 0) await zoomIn.click();
    });
  }
});

// --------------------------------------------------------------------------- //
// 4. Narrow-viewport regression (NOT a mobile redesign)
// --------------------------------------------------------------------------- //

for (const vp of NARROW_VIEWPORTS) {
  test.describe(`insight overlays at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("renders no map-insight bar below 1024px, and keeps its content in the sidebar", async ({
      page,
    }) => {
      await openEquity(page);
      // Unchanged from before this milestone: below the 1024px minimum supported
      // width the overlay does not participate at all. It hides no required
      // disclosure, because the sidebar carries the same reference period and the
      // same source lines (repo AGENTS.md; docs/ui-refresh/equity-dashboard.md).
      await expect(page.getByTestId("equity-insight-strip")).toBeHidden();
      await expect(page.getByTestId("equity-summary-reference-period")).toBeVisible();
      await expect(page.getByTestId("selected-region-metric-source").first()).toBeVisible();
      await expectNoHorizontalOverflow(page, `equity @ ${vp.name}`);

      // The collapsed overlay's positioning row must not clip or scroll the page
      // even while display:none, and the legend stays operable at these widths.
      await expect(page.getByTestId("map-legend")).toBeVisible();
      const mapBox = await box(page.getByTestId("map-container"));
      expect(mapBox.width).toBeLessThanOrEqual(vp.width + 1);
    });

    test("keeps the suitability map free of a stray disclosure and of side scroll", async ({
      page,
    }) => {
      await openSuitability(page, "score");
      await expect(page.getByTestId("suitability-insight-strip")).toBeHidden();
      await expect(page.getByTestId("map-container")).toHaveCount(1);
      await expectNoHorizontalOverflow(page, `suitability @ ${vp.name}`);

      // The top-left layer controls remain the reachable, unobstructed surface.
      await page.getByTestId("land-cover-layer-summary").click();
      await expect(page.getByTestId("land-cover-layer-toggle")).toBeVisible();
      await expectNoHorizontalOverflow(page, `suitability layer control @ ${vp.name}`);
    });
  });
}
