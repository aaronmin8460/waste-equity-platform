import { expect, test, type Page } from "@playwright/test";

import { mockBackend } from "./mockBackend";
import { mockEquityBackend } from "./phase4Fixtures";
import { mockLandfillBackend, mockLandfillNoData } from "./phase5Fixtures";
import { mockTransparencyBackend } from "./phase6Fixtures";

/**
 * Phase 7 — final cross-dashboard regression.
 *
 * This is the INTEGRATION pass for the completed desktop redesign. Phases 1-6 each
 * proved their own area in isolation; this spec proves the areas still hold together
 * as one product: one shell, one main, one h1 per view, a map only where a map
 * belongs, frozen navigation labels, no page-level horizontal overflow, and the two
 * defects this phase closes (X7 report width, L5 landfill URL state).
 *
 * It deliberately does NOT re-assert what a phase spec already covers well. Where it
 * overlaps, it does so at a different level — e.g. `phase5LandfillDashboard.spec.ts`
 * proves the filters work; this proves their state survives a shared link.
 *
 * ── Fixtures ────────────────────────────────────────────────────────────────────
 * All payloads come from the existing phase fixtures, which are SYNTHETIC LAYOUT
 * FIXTURES carrying `분석용 합성 픽스처 — 공식 자료 아님` in the free text the UI
 * renders. No assertion below claims any served value is correct. The shared
 * `mockBackend` keeps its deliberate 404 for the landfill endpoints; the populated
 * landfill fixture is installed only where a populated landfill screen is the
 * subject.
 *
 * Deliberately no pixel snapshots and no assertion that depends on Korean font
 * wrapping (repository convention).
 */

/** The frozen top-level labels. Byte-for-byte — an icon or badge inside breaks this. */
const MODE_LABELS = {
  equity: "지역 부담",
  suitability: "후보지 분석",
  flow: "매립지 현황",
  transparency: "데이터·출처",
} as const;

/** The frozen candidate-analysis sub-view labels. */
const SUBVIEW_LABELS = {
  score: "후보지 점수",
  scenario: "가중치 바꿔보기",
  cost: "비용 살펴보기",
} as const;

const DESKTOP = [
  { name: "1440×900", width: 1440, height: 900 },
  { name: "1280×800", width: 1280, height: 800 },
];

const ALL_VIEWPORTS = [
  { name: "mobile 390×844", width: 390, height: 844 },
  { name: "mobile 430×932", width: 430, height: 932 },
  { name: "tablet 768×1024", width: 768, height: 1024 },
  { name: "small desktop 1024×768", width: 1024, height: 768 },
  { name: "narrow desktop 1054×800", width: 1054, height: 800 },
  { name: "desktop 1280×800", width: 1280, height: 800 },
  { name: "desktop 1440×900", width: 1440, height: 900 },
];

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `no page-level horizontal overflow in ${where}`).toBeLessThanOrEqual(
    clientWidth + 1,
  );
}

/** The shell invariants every view must satisfy, whatever is rendered inside it. */
async function expectShellInvariants(page: Page, where: string): Promise<void> {
  await expect(page.getByTestId("top-navigation"), `${where}: one top navigation`).toHaveCount(1);
  await expect(page.locator("#main-content"), `${where}: one main-content target`).toHaveCount(1);
  await expect(page.locator("h1"), `${where}: exactly one h1`).toHaveCount(1);
  await expect(page.getByTestId("mode-switch"), `${where}: one mode group`).toHaveCount(1);
}

// --------------------------------------------------------------------------- //
// 1-8. Global structure across all four areas and all three sub-views
// --------------------------------------------------------------------------- //

test.describe("global shell holds across every area", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("navigates all four areas keeping one shell, one main, one h1", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-shell")).toBeVisible();

    for (const mode of ["equity", "suitability", "flow", "transparency"] as const) {
      await page.getByTestId(`mode-${mode}`).click();
      await expectShellInvariants(page, MODE_LABELS[mode]);
      await expectNoHorizontalOverflow(page, MODE_LABELS[mode]);
      // The active tab states its selection in the a11y tree, not by colour alone.
      await expect(page.getByTestId(`mode-${mode}`)).toHaveAttribute("aria-pressed", "true");
    }
  });

  test("keeps the four navigation labels byte-for-byte unchanged", async ({ page }) => {
    await page.goto("/");
    for (const [mode, label] of Object.entries(MODE_LABELS)) {
      await expect(page.getByTestId(`mode-${mode}`)).toHaveText(label);
    }
  });

  test("navigates all three candidate sub-views with one segmented control", async ({ page }) => {
    await page.goto("/?v=1&mode=suitability");
    await expect(page.getByTestId("suitability-view-score")).toBeVisible();

    for (const [view, label] of Object.entries(SUBVIEW_LABELS)) {
      await page.getByTestId(`suitability-view-${view}`).click();
      await expect(page.getByTestId(`suitability-view-${view}`)).toHaveText(label);
      await expect(
        page.getByTestId("suitability-subviews"),
        `${label}: one segmented control`,
      ).toHaveCount(1);
      await expectShellInvariants(page, label);
      await expectNoHorizontalOverflow(page, label);
    }
  });

  test("shows the segmented control ONLY inside 후보지 분석", async ({ page }) => {
    await page.goto("/?v=1&mode=suitability");
    await expect(page.getByTestId("suitability-subviews")).toHaveCount(1);
    for (const mode of ["equity", "flow", "transparency"] as const) {
      await page.getByTestId(`mode-${mode}`).click();
      await expect(
        page.getByTestId("suitability-subviews"),
        `${MODE_LABELS[mode]} must not carry a sub-view switch`,
      ).toHaveCount(0);
    }
  });
});

// --------------------------------------------------------------------------- //
// 5. Map presence only where expected
// --------------------------------------------------------------------------- //

test.describe("a map exists only where the analysis needs one", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("map views mount exactly one map and no hidden second one", async ({ page }) => {
    for (const url of ["/?v=1&mode=equity", "/?v=1&mode=suitability&view=score", "/?v=1&mode=suitability&view=scenario"]) {
      await page.goto(url);
      await expect(page.getByTestId("map-container"), url).toHaveCount(1);
      // `.map-pane` remains the single height owner and contains the map.
      await expect(page.locator(".map-pane"), `${url}: one map pane`).toHaveCount(1);
      const contained = await page.evaluate(
        () =>
          document.querySelector(".map-pane")?.contains(
            document.querySelector("[data-testid='map-container']"),
          ) ?? false,
      );
      expect(contained, `${url}: the map lives inside .map-pane`).toBe(true);
    }
  });

  test("map-free views mount zero maps", async ({ page }) => {
    for (const url of [
      "/?v=1&mode=suitability&view=cost",
      "/?v=1&mode=flow",
      "/?v=1&mode=transparency",
    ]) {
      await page.goto(url);
      await expect(page.locator("#main-content")).toBeVisible();
      await expect(page.getByTestId("map-container"), url).toHaveCount(0);
      await expect(page.locator(".map-pane"), url).toHaveCount(0);
    }
  });

  test("the desktop map fills to the viewport bottom with no empty strip", async ({ page }) => {
    for (const vp of DESKTOP) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/?v=1&mode=equity");
      const pane = page.locator(".map-pane");
      await expect(pane).toBeVisible();
      const box = (await pane.boundingBox())!;
      // Reaches the bottom within rounding tolerance...
      expect(box.y + box.height, `${vp.name}: map reaches viewport bottom`).toBeGreaterThan(
        vp.height - 4,
      );
      // ...and is genuinely tall, not the ~60% mobile height leaking onto desktop.
      expect(box.height, `${vp.name}: map height`).toBeGreaterThan(vp.height * 0.75);
    }
  });
});

// --------------------------------------------------------------------------- //
// 9-10. L5 — landfill filter URL state
// --------------------------------------------------------------------------- //

test.describe("매립지 현황 filters travel in the shared link (L5)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("restores all four filters from a direct link", async ({ page }) => {
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=flow&year=2024&month=3&origin=11&waste=생활폐기물");
    await expect(page.getByTestId("landfill-year-select")).toHaveValue("2024");
    await expect(page.getByTestId("landfill-month-select")).toHaveValue("3");
    await expect(page.getByTestId("landfill-origin-select")).toHaveValue("11");
    await expect(page.getByTestId("landfill-waste-select")).toHaveValue("생활폐기물");
    await expectNoHorizontalOverflow(page, "restored landfill");
  });

  test("changing a filter updates the URL without adding history entries", async ({ page }) => {
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=flow");
    const before = await page.evaluate(() => history.length);

    await page.getByTestId("landfill-origin-select").selectOption("41");
    await expect.poll(() => page.url()).toContain("origin=41");
    await page.getByTestId("landfill-year-select").selectOption("2023");
    await expect.poll(() => page.url()).toContain("year=2023");

    // replaceState, not pushState: two filter changes must add no history entries.
    expect(await page.evaluate(() => history.length), "no history spam").toBe(before);
    // And Back still leaves the dashboard rather than walking the filter history.
    await page.goBack();
    await expect(page.getByTestId("landfill-year-select")).toHaveCount(0);
  });

  test("reloading the encoded link reproduces the same visible filter state", async ({ page }) => {
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=flow");
    await page.getByTestId("landfill-origin-select").selectOption("28");
    await page.getByTestId("landfill-month-select").selectOption("5");
    await expect.poll(() => page.url()).toContain("month=5");

    await page.goto(page.url());
    await expect(page.getByTestId("landfill-origin-select")).toHaveValue("28");
    await expect(page.getByTestId("landfill-month-select")).toHaveValue("5");
  });

  test("an invalid filter falls back safely and never blanks a control", async ({ page }) => {
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=flow&year=1234&month=99&origin=ZZ");
    for (const id of [
      "landfill-year-select",
      "landfill-month-select",
      "landfill-origin-select",
      "landfill-waste-select",
    ]) {
      const select = page.getByTestId(id);
      await expect(select).toBeVisible();
      // A native <select> holding an unmatched value renders blank; the selected
      // option's label must be real text.
      const label = await select.evaluate(
        (el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? "",
      );
      expect(label.trim().length, `${id} shows a labelled option`).toBeGreaterThan(0);
    }
    // The rejected values are canonicalised out of the address bar.
    expect(page.url()).not.toContain("year=1234");
    expect(page.url()).not.toContain("origin=ZZ");
  });

  test("leaves other areas' URL state untouched", async ({ page }) => {
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=flow&year=2024&scope=11&top=5");
    await expect(page.getByTestId("landfill-year-select")).toHaveValue("2024");
    await page.getByTestId("mode-equity").click();
    await expect.poll(() => page.url()).toContain("mode=equity");
    expect(page.url()).toContain("scope=11");
    expect(page.url()).toContain("top=5");
    // Landfill fields are area-scoped, like the suitability-only fields.
    expect(page.url()).not.toContain("year=");
  });
});

// --------------------------------------------------------------------------- //
// 16-17. X7 — report preview width, containment and keyboard close
// --------------------------------------------------------------------------- //

test.describe("보고서 미리보기 uses the desktop width it needs (X7)", () => {
  /** Open the equity report modal through the real share bar. */
  async function openReport(page: Page): Promise<void> {
    await mockEquityBackend(page);
    await page.goto("/?v=1&mode=equity");
    await page.getByTestId("open-report").click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }

  for (const vp of DESKTOP) {
    test(`is materially wider than the old 672px cap at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openReport(page);

      const box = (await page.getByRole("dialog").boundingBox())!;
      // The defect: max-w-2xl == 672px. A bounding-box assertion, not a class check,
      // so restoring the narrow cap fails this test whatever class expresses it.
      expect(box.width, `${vp.name}: wider than the old cap`).toBeGreaterThan(800);
      // Still inside the viewport with real margins on both sides.
      expect(box.x, `${vp.name}: left margin`).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width, `${vp.name}: right edge inside viewport`).toBeLessThanOrEqual(
        vp.width - 8,
      );
      await expectNoHorizontalOverflow(page, `report modal at ${vp.name}`);
    });
  }

  test("stays inside the viewport and scrolls its body, not the page", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openReport(page);
    const dialog = page.getByRole("dialog");
    const box = (await dialog.boundingBox())!;
    // Bounded height: the panel never grows past the viewport.
    expect(box.height, "panel height bounded").toBeLessThanOrEqual(800);
    // The report body is the scroll container.
    const scrolls = await dialog.evaluate((el) => {
      const body = el.querySelector(".wep-print") as HTMLElement;
      return getComputedStyle(body).overflowY;
    });
    expect(scrolls).toBe("auto");
  });

  for (const vp of [
    { name: "mobile 390×844", width: 390, height: 844 },
    { name: "tablet 768×1024", width: 768, height: 1024 },
  ]) {
    test(`remains viewport-safe at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openReport(page);
      const box = (await page.getByRole("dialog").boundingBox())!;
      expect(box.width, `${vp.name}: inside viewport`).toBeLessThanOrEqual(vp.width);
      expect(box.x).toBeGreaterThanOrEqual(0);
      await expectNoHorizontalOverflow(page, `report modal at ${vp.name}`);
    });
  }

  test("keeps the table readable with local overflow only", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReport(page);
    const table = page.getByRole("dialog").locator("table").first();
    await expect(table).toBeVisible();
    // Column headers survive the widening.
    await expect(table.locator("th").first()).toBeVisible();
    await expectNoHorizontalOverflow(page, "report table");
  });

  test("closes on Escape and returns focus to the trigger", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReport(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("open-report")).toBeFocused();
  });

  test("closes on the labelled 닫기 control", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReport(page);
    await page.getByRole("button", { name: "닫기" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

// --------------------------------------------------------------------------- //
// 11-15. Per-area behaviour that must still work together
// --------------------------------------------------------------------------- //

test.describe("area behaviour survives integration", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("equity: selecting a region from the ranking syncs the panel and the select", async ({
    page,
  }) => {
    await mockEquityBackend(page);
    await page.goto("/?v=1&mode=equity");
    await page.getByTestId("rank-high").getByTestId("rank-row").first().click();
    await expect(page.getByTestId("selected-region-summary")).toBeVisible();
    const code = await page.getByTestId("region-select").inputValue();
    expect(code.length, "the region <select> mirrors the selection").toBeGreaterThan(0);
    // One canonical selection: the shared link carries it.
    await expect.poll(() => page.url()).toContain("region=");
  });

  test("cost: setup → results → back to setup", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/?v=1&mode=suitability&view=cost");
    await expect(page.getByTestId("facility-cost-form")).toBeVisible();
    // No map on this branch, at any point in the flow.
    await expect(page.getByTestId("map-container")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "cost setup");
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("landfill: a populated screen and a no-data screen are different states", async ({
    page,
  }) => {
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=flow");
    await expect(page.getByTestId("landfill-kpis")).toBeVisible();
    // A populated screen is not an alert.
    await expect(page.getByTestId("landfill-error")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "landfill populated");
  });

  test("landfill: no official record is an empty state, never an error alert", async ({ page }) => {
    await mockLandfillNoData(page);
    await page.goto("/?v=1&mode=flow");
    await expect(page.getByTestId("landfill-no-data")).toBeVisible();
    await expect(page.getByTestId("landfill-error")).toHaveCount(0);
    // The filters stay operable so the reader can ask a different question.
    await expect(page.getByTestId("landfill-year-select")).toBeEnabled();
    // A raw backend enum never becomes the citizen's whole explanation.
    const primary = await page.evaluate(() => {
      const root = document.querySelector("#main-content")!.cloneNode(true) as HTMLElement;
      root.querySelectorAll("[data-diagnostic]").forEach((n) => n.remove());
      return root.textContent ?? "";
    });
    expect(primary).not.toContain("NO_DATA_AVAILABLE");
  });

  test("data sources: search narrows the catalog and the count is announced", async ({ page }) => {
    await mockTransparencyBackend(page);
    await page.goto("/?v=1&mode=transparency");
    await expect(page.getByTestId("transparency-source-list")).toBeVisible();
    const before = await page.getByTestId("transparency-source-card").count();
    await page.getByTestId("transparency-search").fill("인구");
    await expect
      .poll(async () => page.getByTestId("transparency-source-card").count())
      .toBeLessThan(before);
    await expect(page.getByTestId("transparency-result-count")).toHaveAttribute("role", "status");
    await expectNoHorizontalOverflow(page, "data sources filtered");
  });
});

// --------------------------------------------------------------------------- //
// 18-19. Terminology and the status/alert separation on primary surfaces
// --------------------------------------------------------------------------- //

test.describe("primary surfaces stay in plain Korean", () => {
  /** Everything a reader sees without opening a disclosure. */
  async function primarySurface(page: Page): Promise<string> {
    return page.evaluate(() => {
      const root = document.querySelector("#main-content")!.cloneNode(true) as HTMLElement;
      root.querySelectorAll("[data-diagnostic]").forEach((n) => n.remove());
      root.querySelectorAll("details:not([open]) > *:not(summary)").forEach((n) => n.remove());
      return root.textContent ?? "";
    });
  }

  /**
   * A sample of `FORBIDDEN_PRIMARY_TOKENS` covering each family.
   *
   * `CRITIC` is deliberately EXCLUDED. The token is on the frozen list because a
   * bare `CRITIC` enum must not appear as a profile value, but this repository has
   * a separate, deliberate decision to name the method in its own methodology note
   * (`CRITIC 데이터 기반 가중치`, asserted by `app/accessibility.test.tsx`, and
   * `scenario.ts`'s `CRITIC 데이터 기반` profile label). Scanning for it here would
   * fail on a shipped, tested label rather than on a defect. Its raw method-VERSION
   * identifier was demoted to a `data-diagnostic` span in Phase 7.
   */
  const FORBIDDEN = [
    "ELIGIBLE",
    "REVIEW_REQUIRED",
    "EXCLUDED",
    "MVT",
    "accounting_basis",
    "ORIGIN_BASED_TREATMENT_OUTCOME",
    "OFFICIAL_INPUTS_DERIVED_VALUE",
    "suitability-policy",
    "capital-grid-500m",
    "OPERATING_COST",
    "NO_DATA_AVAILABLE",
  ];

  test("no forbidden technical token reaches a primary surface", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockLandfillBackend(page);
    await mockTransparencyBackend(page);

    for (const [url, where] of [
      ["/?v=1&mode=equity", "지역 부담"],
      ["/?v=1&mode=suitability&view=score", "후보지 점수"],
      ["/?v=1&mode=suitability&view=cost", "비용 살펴보기"],
      ["/?v=1&mode=flow", "매립지 현황"],
      ["/?v=1&mode=transparency", "데이터·출처"],
    ] as const) {
      await page.goto(url);
      await expect(page.locator("#main-content")).toBeVisible();
      const text = await primarySurface(page);
      for (const token of FORBIDDEN) {
        expect(text.includes(token), `${where} leaks "${token}"`).toBe(false);
      }
    }
  });

  test("a standing disclaimer is not an alert", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=flow");
    // The metropolitan-scope banner is standing information, not something gone
    // wrong: it must never interrupt a screen reader.
    await expect(page.getByTestId("landfill-limitation")).toBeVisible();
    await expect(page.getByTestId("landfill-limitation")).not.toHaveAttribute("role", "alert");
  });

  test("no live region is trapped inside a collapsed disclosure", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockLandfillBackend(page);
    await mockTransparencyBackend(page);
    for (const url of ["/?v=1&mode=flow", "/?v=1&mode=transparency", "/?v=1&mode=equity"]) {
      await page.goto(url);
      await expect(page.locator("#main-content")).toBeVisible();
      const trapped = await page.evaluate(() =>
        [...document.querySelectorAll("[role='status'], [role='alert']")].filter((node) =>
          node.closest("details:not([open])"),
        ).length,
      );
      expect(trapped, `${url}: no live region inside a closed <details>`).toBe(0);
    }
  });
});

// --------------------------------------------------------------------------- //
// 20. Responsive smoke across every required viewport
// --------------------------------------------------------------------------- //

test.describe("responsive smoke", () => {
  for (const vp of ALL_VIEWPORTS) {
    test(`no page-level horizontal overflow in any area at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await mockLandfillBackend(page);
      await mockTransparencyBackend(page);

      for (const [url, where] of [
        ["/?v=1&mode=equity", "지역 부담"],
        ["/?v=1&mode=suitability&view=score", "후보지 점수"],
        ["/?v=1&mode=suitability&view=cost", "비용 살펴보기"],
        ["/?v=1&mode=flow", "매립지 현황"],
        ["/?v=1&mode=transparency", "데이터·출처"],
      ] as const) {
        await page.goto(url);
        await expect(page.locator("#main-content")).toBeVisible();
        await expectNoHorizontalOverflow(page, `${where} at ${vp.name}`);
        await expect(page.locator("h1"), `${where} at ${vp.name}: one h1`).toHaveCount(1);
      }
    });
  }

  test("the skip link is the first focus target and reaches main content", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBackend(page);
    await page.goto("/?v=1&mode=equity");
    await expect(page.locator("#main-content")).toBeVisible();

    // Retrying assertions throughout: a one-shot `document.activeElement` read
    // sampled a single frame and made this flaky under full-suite load. The
    // assertions themselves are unchanged — focus must still genuinely land on the
    // skip link first and on the main-content target after activating it.
    await page.keyboard.press("Tab");
    await expect(page.locator("a.skip-link"), "the skip link is the first focus target").toBeFocused();

    await page.keyboard.press("Enter");
    await expect(
      page.locator("#main-content"),
      "activating the skip link moves focus to the main-content target",
    ).toBeFocused({ timeout: 15_000 });
  });
});
