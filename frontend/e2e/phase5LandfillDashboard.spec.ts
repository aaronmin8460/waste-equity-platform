import { expect, test, type Page } from "@playwright/test";

import {
  mockLandfillBackend,
  mockLandfillNoData,
  mockLandfillServerError,
} from "./phase5Fixtures";

/**
 * Phase 5 acceptance — 매립지 현황 desktop information hierarchy.
 *
 * Structure and behaviour only: heading/landmark counts, the desktop filter row,
 * KPI hierarchy, the separation of loading / data / no-data / partial / error, the
 * comparison bars as a redundant encoding, overflow, and keyboard operability.
 *
 * The landfill payloads come from `phase5Fixtures.ts` and are SYNTHETIC LAYOUT
 * FIXTURES — not official data (that file documents the reasoning and the marker
 * text they carry). No assertion here claims a value is correct; the live
 * `landfill.spec.ts` remains the only spec that asserts against real official data,
 * and its `E2E_BACKEND_URL` skip guard is untouched.
 *
 * Deliberately NO pixel-snapshot assertions (repository convention).
 *
 * Primary target 1440×900, secondary 1280×800 (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §8).
 */

const FLOW_URL = "/?v=1&mode=flow";

const VIEWPORTS = [
  { name: "mobile 390×844", width: 390, height: 844, desktop: false },
  { name: "tablet 768×1024", width: 768, height: 1024, desktop: false },
  { name: "small desktop 1024×768", width: 1024, height: 768, desktop: false },
  { name: "desktop 1280×800", width: 1280, height: 800, desktop: true },
  { name: "desktop 1440×900", width: 1440, height: 900, desktop: true },
];

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "no page-level horizontal overflow").toBeLessThanOrEqual(clientWidth + 1);
}

/** Deep-link straight into the landfill area and wait for its populated body. */
async function gotoLandfill(page: Page): Promise<void> {
  await page.goto(FLOW_URL);
  await expect(page.getByTestId("landfill-dashboard")).toBeVisible();
  await expect(page.getByTestId("landfill-kpis")).toBeVisible();
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("renders one map-free dashboard with a single heading and nav", async ({ page }) => {
      await mockLandfillBackend(page);
      await gotoLandfill(page);

      // Exactly one of each piece of global chrome.
      await expect(page.getByTestId("top-navigation")).toHaveCount(1);
      await expect(page.getByTestId("mode-switch")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText("수도권매립지 반입 현황");
      await expect(page.locator("#main-content")).toHaveCount(1);
      await expect(page.locator("main")).toHaveCount(1);

      // The source supports no map, so none is mounted — not merely hidden.
      await expect(page.getByTestId("map-container")).toHaveCount(0);
      await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
      // Nor an equity-style sidebar or a second segmented control.
      await expect(page.locator("aside")).toHaveCount(0);
      await expect(page.getByTestId("suitability-subviews")).toHaveCount(0);

      // Full-width: the dashboard spans essentially the whole viewport.
      const box = (await page.getByTestId("landfill-dashboard").boundingBox())!;
      expect(box.width).toBeGreaterThan(vp.width * 0.9);

      await expectNoHorizontalOverflow(page);
    });

    test("shows the four filters and the KPI row without overflow", async ({ page }) => {
      await mockLandfillBackend(page);
      await gotoLandfill(page);

      for (const testId of [
        "landfill-year-select",
        "landfill-month-select",
        "landfill-origin-select",
        "landfill-waste-select",
      ]) {
        await expect(page.getByTestId(testId)).toBeVisible();
      }
      // Native selects: the platform keyboard behaviour is unchanged.
      await expect(page.getByTestId("landfill-filters").locator("select")).toHaveCount(4);

      for (const testId of [
        "landfill-kpi-quantity",
        "landfill-kpi-fee",
        "landfill-kpi-effective-fee",
        "landfill-kpi-per-capita",
      ]) {
        await expect(page.getByTestId(testId)).toBeVisible();
      }

      await expect(page.getByTestId("landfill-region-table")).toBeVisible();
      await expect(page.getByTestId("landfill-origin-comparison")).toBeVisible();
      await expect(page.getByTestId("landfill-waste-composition")).toBeVisible();
      await expect(page.getByTestId("landfill-trend-quantity")).toBeVisible();
      await expect(page.getByTestId("landfill-trend-fee")).toBeVisible();

      await expectNoHorizontalOverflow(page);
    });

    test("keeps the regional table's overflow local to the table", async ({ page }) => {
      await mockLandfillBackend(page);
      await gotoLandfill(page);
      const table = page.getByTestId("landfill-region-table");
      await table.scrollIntoViewIfNeeded();
      await expect(table).toBeVisible();
      // Four columns and one row per served origin, at every width.
      await expect(table.locator("thead th")).toHaveCount(4);
      await expect(page.getByTestId("landfill-region-row")).toHaveCount(3);
      // The page itself still never scrolls sideways.
      await expectNoHorizontalOverflow(page);
    });

    if (vp.desktop) {
      test("lays the four filters out on one row", async ({ page }) => {
        await mockLandfillBackend(page);
        await gotoLandfill(page);
        const boxes = await Promise.all(
          [
            "landfill-year-select",
            "landfill-month-select",
            "landfill-origin-select",
            "landfill-waste-select",
          ].map(async (testId) => (await page.getByTestId(testId).boundingBox())!),
        );
        // Same row: every control shares the first one's vertical position.
        const top = boxes[0].y;
        for (const box of boxes) {
          expect(Math.abs(box.y - top), "filters share one desktop row").toBeLessThanOrEqual(2);
        }
        // And they are laid out left-to-right in the documented order.
        for (let i = 1; i < boxes.length; i += 1) {
          expect(boxes[i].x).toBeGreaterThan(boxes[i - 1].x);
        }
      });

      test("puts the heading, banner, filters and KPI values in the first viewport", async ({
        page,
      }) => {
        await mockLandfillBackend(page);
        await gotoLandfill(page);
        // The four things a reader needs first must be above the fold at the desktop
        // targets — the Phase 0 complaint was that a warning block pushed the values
        // down. Asserted with `toBeInViewport`, which is about intersection rather
        // than exact pixel geometry, so a different font on another machine cannot
        // flip the result over a one-line wrap.
        for (const testId of [
          "landfill-limitation",
          "landfill-filters",
          "landfill-kpi-quantity",
        ]) {
          await expect(
            page.getByTestId(testId),
            `${testId} is fully within the first viewport`,
          ).toBeInViewport({ ratio: 1 });
        }
      });
    } else {
      test("stacks cleanly without clipping the filters", async ({ page }) => {
        await mockLandfillBackend(page);
        await gotoLandfill(page);
        await expect(page.getByTestId("landfill-filters")).toBeVisible();
        const filters = (await page.getByTestId("landfill-filters").boundingBox())!;
        expect(filters.width).toBeLessThanOrEqual(vp.width);
        await expectNoHorizontalOverflow(page);
      });
    }
  });
}

test.describe("desktop 1440×900 — states and interaction", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("KPI values are visually dominant over their explanations", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);

    for (const testId of ["landfill-kpi-quantity", "landfill-kpi-fee"]) {
      const card = page.getByTestId(testId);
      const valueSize = await card.locator("dd").evaluate((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      );
      const captionSize = await card.locator("p").first().evaluate((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      );
      expect(valueSize, `${testId} value must outrank its explanation`).toBeGreaterThan(
        captionSize,
      );
      const labelSize = await card.locator("dt").evaluate((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      );
      expect(valueSize).toBeGreaterThan(labelSize);
    }
  });

  test("the standing limitation is one compact info banner, not an alert", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);
    const banner = page.getByTestId("landfill-limitation");
    await expect(banner).toBeVisible();
    // Severity is carried by a text word, never by colour alone.
    await expect(page.getByTestId("landfill-limitation-tone")).toContainText("알림");
    // A permanent disclaimer must not be an alert.
    await expect(banner).not.toHaveAttribute("role", "alert");
    await expect(banner).toContainText("시·군·구별 이동 경로나 실제 운송 경로를 의미하지 않습니다");

    // It is subordinate to the values: it sits ABOVE the KPI row and does not
    // overlap it, and it occupies a small share of the viewport rather than
    // dominating the screen the way the Phase 0 amber block did. Both are ordering
    // and proportion checks rather than exact text metrics, so a font substitution
    // that adds a wrapped line cannot flip them.
    const bannerBox = (await banner.boundingBox())!;
    const kpiBox = (await page.getByTestId("landfill-kpis").boundingBox())!;
    expect(bannerBox.y + bannerBox.height, "banner precedes and clears the KPI row")
      .toBeLessThanOrEqual(kpiBox.y);
    expect(bannerBox.height, "banner does not dominate the viewport").toBeLessThan(900 * 0.25);

    // Exactly one banner on the screen.
    await expect(page.locator(".wep-banner")).toHaveCount(1);
  });

  test("filters drive a load and never leave stale values on screen", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);
    await expect(page.getByTestId("landfill-dashboard")).toContainText("2024년");

    // Selecting the partial year re-scopes every surface together.
    await page.getByTestId("landfill-year-select").selectOption("2026");
    await expect(page.getByTestId("landfill-dashboard")).toContainText("2026년");
    // Partial-period state names the exact covered period and denies an annual total.
    const partial = page.getByTestId("landfill-partial-year");
    await expect(partial).toBeVisible();
    await expect(partial).toContainText("2026-05");
    await expect(partial).toContainText("연간 합계가 아닙니다");
    // Gaps stay gaps: only the five served months are drawn, never twelve.
    await expect(page.getByTestId("landfill-trend-quantity").locator("rect")).toHaveCount(5);

    // A month selection narrows the period label.
    await page.getByTestId("landfill-month-select").selectOption("3");
    await expect(page.getByTestId("landfill-dashboard")).toContainText("3월");

    await expectNoHorizontalOverflow(page);
  });

  test("comparison bars re-encode values that remain readable as text", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);

    const comparison = page.getByTestId("landfill-origin-comparison");
    await comparison.scrollIntoViewIfNeeded();
    // Region names and exact values with units stay present as text.
    for (const name of ["서울시", "인천시", "경기도"]) {
      await expect(comparison).toContainText(name);
    }
    await expect(comparison).toContainText("t");
    await expect(comparison).toContainText("기준 기간");

    // The bars are proportional to the displayed set and ordered as served.
    const widths = await comparison
      .locator("[aria-hidden] > span")
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).getBoundingClientRect().width));
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);

    // An absent per-capita denominator is still a reason, never 0원.
    const rows = page.getByTestId("landfill-region-row");
    await expect(rows.nth(2)).toContainText("동일 기간 인구 데이터 없음");
    await expect(rows.nth(2)).not.toContainText("0원/인");

    await expect(page.getByTestId("landfill-waste-composition")).toContainText("생활폐기물");
  });

  test("evidence and limitations stay reachable behind disclosures", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);

    const evidence = page.getByTestId("landfill-evidence");
    await evidence.scrollIntoViewIfNeeded();
    for (const testId of [
      "landfill-evidence-sources",
      "landfill-evidence-comparability",
      "landfill-evidence-method",
      "landfill-limitation-details",
    ]) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }

    // Opening a disclosure reveals the provenance it holds.
    await page.getByTestId("landfill-evidence-sources-summary").click();
    await expect(page.getByTestId("landfill-population-source")).toBeVisible();
    await expect(page.getByTestId("landfill-population-source")).toContainText(
      "행정안전부 주민등록 인구통계",
    );
    await expect(page.getByTestId("reference-period").first()).not.toBeEmpty();

    await page.getByTestId("landfill-limitation-details-summary").click();
    await expect(page.getByTestId("landfill-caveats")).toContainText("시·군·구별 반입량");

    await page.getByTestId("landfill-evidence-comparability-summary").click();
    await expect(page.getByTestId("landfill-comparability-note")).toContainText("2015-01");
    // The accounting basis is named in Korean; its enum is demoted to diagnostics.
    await expect(page.getByTestId("landfill-evidence-comparability")).toContainText(
      "수도권 반입 기준(매립지로 들어온 양)",
    );

    await expectNoHorizontalOverflow(page);
  });

  test("no raw backend enum surfaces as a primary label", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);
    // Strip the diagnostic layer, where codes are legal by design.
    const primaryText = await page.evaluate(() => {
      const root = document.querySelector("[data-testid='landfill-dashboard']")!.cloneNode(
        true,
      ) as HTMLElement;
      root.querySelectorAll("[data-diagnostic]").forEach((node) => node.remove());
      return root.textContent ?? "";
    });
    for (const token of [
      "OFFICIAL_INPUTS_DERIVED_VALUE",
      "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
      "NO_MATCHING_POPULATION_PERIOD",
      "landfill-fee-per-capita-v2",
      "NO_DATA_AVAILABLE",
    ]) {
      expect(primaryText, `primary surface leaks "${token}"`).not.toContain(token);
    }
    // Nor the English parentheticals Phase 5 removed from the filter row.
    for (const english of ["(Year)", "(Origin)", "(Waste type)", "(all)"]) {
      expect(primaryText).not.toContain(english);
    }
  });

  test("separates the no-data answer from a genuine error", async ({ page }) => {
    await mockLandfillNoData(page);
    await page.goto(FLOW_URL);
    await expect(page.getByTestId("landfill-dashboard")).toBeVisible();

    const empty = page.getByTestId("landfill-no-data");
    await expect(empty).toBeVisible();
    // Not a fault: no alert panel, and no fabricated zeros.
    await expect(page.getByTestId("landfill-error")).toHaveCount(0);
    await expect(page.getByTestId("landfill-kpis")).toHaveCount(0);
    await expect(empty).not.toContainText("0 t");
    // Plain Korean, with the served years offered as a way forward.
    await expect(empty).toContainText("현재 조건에 맞는 공식 자료가 없습니다.");
    await expect(page.getByTestId("landfill-available-years")).toContainText("2023, 2024");
    // The filters remain operable so another period can be chosen.
    await expect(page.getByTestId("landfill-filters")).toBeVisible();
    await expect(page.getByTestId("landfill-year-select")).toBeEnabled();

    await expectNoHorizontalOverflow(page);
  });

  test("renders a genuine server failure as an actionable alert", async ({ page }) => {
    await mockLandfillServerError(page);
    await page.goto(FLOW_URL);
    await expect(page.getByTestId("landfill-dashboard")).toBeVisible();

    const error = page.getByTestId("landfill-error");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("landfill-no-data")).toHaveCount(0);
    // No value from any previous state may remain on screen.
    await expect(page.getByTestId("landfill-kpis")).toHaveCount(0);
    await expect(page.getByTestId("landfill-region-table")).toHaveCount(0);
    // The raw code is kept, but only as a diagnostic line.
    await expect(page.getByTestId("landfill-error-detail")).toContainText("INTERNAL_ERROR");
    await expect(page.getByTestId("landfill-filters")).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });

  test("keeps the global navigation in the same place as the other areas", async ({ page }) => {
    await mockLandfillBackend(page);
    await page.goto("/?v=1&mode=transparency");
    await expect(page.getByTestId("mode-switch")).toBeVisible();
    const before = (await page.getByTestId("top-navigation").boundingBox())!;

    await page.getByTestId("mode-flow").click();
    await expect(page.getByTestId("landfill-dashboard")).toBeVisible();
    const after = (await page.getByTestId("top-navigation").boundingBox())!;

    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    // The frozen navigation labels are unchanged.
    await expect(page.getByTestId("mode-flow")).toHaveText("매립지 현황");
    await expect(page.getByTestId("mode-flow")).toHaveAttribute("aria-pressed", "true");
  });

  test("is keyboard operable with visible focus and no trap", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);

    // Tab forward through the filter row: focus must land on each native select
    // in order and must never get stuck.
    await page.getByTestId("landfill-year-select").focus();
    for (const expected of [
      "landfill-month-select",
      "landfill-origin-select",
      "landfill-waste-select",
    ]) {
      await page.keyboard.press("Tab");
      await expect(page.getByTestId(expected)).toBeFocused();
    }
    // Focus escapes the filter row rather than cycling within it.
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("landfill-waste-select")).not.toBeFocused();

    // Focus is visible, not conveyed by colour alone being removed.
    const outline = await page
      .getByTestId("landfill-origin-select")
      .evaluate((el) => {
        el.focus();
        return getComputedStyle(el).outlineStyle;
      });
    expect(outline).not.toBe("none");

    // A select is operable from the keyboard and genuinely re-scopes the dashboard:
    // three origin rows before, one after. Asserting a count that differs across the
    // change is what makes this a real test of the filter rather than of the fixture.
    await expect(page.getByTestId("landfill-region-row")).toHaveCount(3);
    await page.getByTestId("landfill-origin-select").selectOption("11");
    await expect(page.getByTestId("landfill-region-row")).toHaveCount(1);
    await expect(page.getByTestId("landfill-region-row")).toContainText("서울시");
  });

  test("the origin and waste filters re-scope the served results", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);
    const rows = page.getByTestId("landfill-region-row");
    const table = page.getByTestId("landfill-region-table");
    await expect(rows).toHaveCount(3);

    // Seoul only.
    await page.getByTestId("landfill-origin-select").selectOption("11");
    await expect(rows).toHaveCount(1);
    await expect(table).toContainText("서울시");
    await expect(table).not.toContainText("인천시");

    // A different origin swaps the row rather than adding to it.
    await page.getByTestId("landfill-origin-select").selectOption("28");
    await expect(rows).toHaveCount(1);
    await expect(table).toContainText("인천시");
    await expect(table).not.toContainText("서울시");

    // Back to all three.
    await page.getByTestId("landfill-origin-select").selectOption("");
    await expect(rows).toHaveCount(3);

    // The waste filter narrows the composition to the selected category.
    const composition = page.getByTestId("landfill-waste-composition");
    await expect(composition).toContainText("건설폐기물");
    await page.getByTestId("landfill-waste-select").selectOption("생활폐기물");
    await expect(composition).toContainText("생활폐기물");
    await expect(composition).not.toContainText("건설폐기물");
  });

  test("the scoped fixture stays internally coherent", async ({ page }) => {
    // Not a check of the VALUES — they are synthetic — but of the fixture's own
    // consistency, so a future spec cannot read a contradictory screen as truth.
    // Scoping to one origin previously left the shares and totals unscoped, so the
    // sole row read "54.5%" of a total it was 100% of, and a waste category could
    // exceed the total it belonged to.
    await mockLandfillBackend(page);
    await gotoLandfill(page);
    await page.getByTestId("landfill-origin-select").selectOption("11");
    await expect(page.getByTestId("landfill-region-row")).toHaveCount(1);

    // The single remaining origin is the whole of the scoped total.
    await expect(page.getByTestId("landfill-origin-comparison")).toContainText("100%");

    // Read the VALUE elements specifically — a whole-card `innerText` would also
    // sweep in the caption's reference year — and match the tonnage itself rather
    // than every digit, since a row also carries its share as a percentage.
    const parseTons = (text: string) => {
      const match = /([\d,]+(?:\.\d+)?)\s*t\b/.exec(text);
      expect(match, `no tonnage found in ${JSON.stringify(text)}`).not.toBeNull();
      return Number(match![1].replace(/,/g, ""));
    };
    const totalOf = async () =>
      parseTons(await page.getByTestId("landfill-kpi-quantity").locator("dd").innerText());

    // The single remaining origin row accounts for the whole scoped total.
    const total = await totalOf();
    const rowQuantity = parseTons(
      await page.getByTestId("landfill-region-row").locator("td").first().innerText(),
    );
    expect(rowQuantity).toBeCloseTo(total, 0);

    // And no waste category may exceed the total it is part of.
    await page.getByTestId("landfill-waste-select").selectOption("생활폐기물");
    await expect(page.getByTestId("landfill-waste-composition")).toContainText("생활폐기물");
    const scopedTotal = await totalOf();
    const category = parseTons(
      await page.getByTestId("landfill-waste-composition").locator("li").first().innerText(),
    );
    expect(category).toBeLessThanOrEqual(scopedTotal + 1);
  });

  test("clears the previous filter's values before the new ones arrive", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);
    // The complete-year fixture reports twelve trend months.
    await expect(page.getByTestId("landfill-trend-quantity").locator("rect")).toHaveCount(12);
    await expect(page.getByTestId("landfill-dashboard")).toContainText("2024년");

    // Hold the next summary open so the transition itself is observable.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/landfill/summary**", async (route) => {
      await gate;
      await route.fallback();
    });

    await page.getByTestId("landfill-year-select").selectOption("2026");

    // Mid-flight: the previous period's values are GONE, not left standing under the
    // new filter, and the loading state appears on a transition — not only on first
    // load. No zero-filled placeholder stands in for the pending values.
    await expect(page.getByTestId("landfill-loading")).toBeVisible();
    await expect(page.getByTestId("landfill-kpis")).toHaveCount(0);
    await expect(page.getByTestId("landfill-region-table")).toHaveCount(0);
    await expect(page.getByTestId("landfill-dashboard")).not.toContainText("2024년");
    // The filter controls keep their context throughout.
    await expect(page.getByTestId("landfill-filters")).toBeVisible();

    release!();
    await expect(page.getByTestId("landfill-kpis")).toBeVisible();
    await expect(page.getByTestId("landfill-dashboard")).toContainText("2026년");
  });

  test("keeps the advertised years selectable after a no-data answer", async ({ page }) => {
    await mockLandfillBackend(page);
    await gotoLandfill(page);

    // Now make every landfill request answer "no official record", with a served
    // year list, and pick a year that is NOT in it.
    await page.route("**/api/v1/landfill/**", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            error: "NO_DATA_FOR_PERIOD",
            detail: "No rows for the requested period.",
            requested_year: 2022,
            available_years: [2023, 2024],
          },
        }),
      }),
    );
    await page.getByTestId("landfill-year-select").selectOption("2022");
    await expect(page.getByTestId("landfill-no-data")).toBeVisible();

    // Every year the panel advertises must actually be selectable — the panel says
    // "다른 연도를 선택해 주세요", so the control has to offer them.
    await expect(page.getByTestId("landfill-available-years")).toContainText("2023, 2024");
    const options = await page
      .getByTestId("landfill-year-select")
      .locator("option")
      .allInnerTexts();
    expect(options).toContain("2023");
    expect(options).toContain("2024");
    // …and the select must not render blank: the year the reader chose is still shown.
    expect(options).toContain("2022");
    await expect(page.getByTestId("landfill-year-select")).toHaveValue("2022");

    // Choosing an advertised year issues a real request for it.
    const request = page.waitForRequest((r) => r.url().includes("year=2024"));
    await page.getByTestId("landfill-year-select").selectOption("2024");
    await request;
  });

  test("announces loading through a status region with a decorative skeleton", async ({
    page,
  }) => {
    // Hold the summary open so the transition state is observable.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockLandfillBackend(page);
    await page.route("**/api/v1/landfill/summary**", async (route) => {
      await gate;
      await route.fallback();
    });

    await page.goto(FLOW_URL);
    const loading = page.getByTestId("landfill-loading");
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute("role", "status");
    // The skeleton announces nothing and shows no fabricated number.
    const skeleton = page.getByTestId("landfill-loading-skeleton");
    await expect(skeleton).toHaveAttribute("aria-hidden", "true");
    await expect(skeleton).toHaveText("");
    // Filter context is retained while loading.
    await expect(page.getByTestId("landfill-filters")).toBeVisible();
    // No zero-filled KPI stands in for the pending values.
    await expect(page.getByTestId("landfill-kpis")).toHaveCount(0);

    release!();
    await expect(page.getByTestId("landfill-kpis")).toBeVisible();
    await expect(page.getByTestId("landfill-loading")).toHaveCount(0);
  });
});
