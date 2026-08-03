import { expect, test, type Page } from "@playwright/test";

import {
  mockTransparencyBackend,
  mockTransparencyFreshnessError,
  mockTransparencyMappingError,
  mockTransparencyNoSources,
  SYNTHETIC_MAPPING,
} from "./phase6Fixtures";

/**
 * 데이터·출처 dashboard refresh — desktop acceptance for the transparency milestone.
 *
 * Complements the existing coverage rather than repeating it:
 * `phase6DataSourcesDashboard.spec.ts` owns the Phase 6 contracts (the catalog's
 * search/filter behaviour, the five outcomes, the control row's geometry, keyboard
 * reach) and still runs unmodified. This file owns what the REFRESHED screen newly
 * promises at the four desktop targets — the five titled regions reachable by
 * ordinary document scrolling, the 현재 조건 summary reporting what is filtered, the
 * provenance badges, the three kinds of gap, table semantics, and the cross-view map
 * contract surviving a round trip.
 *
 * The registry payloads come from `phase6Fixtures.ts` and are SYNTHETIC LAYOUT
 * FIXTURES — not official data (that file documents the reasoning and the marker
 * text they carry). No assertion here claims a served value is correct; the numeric
 * assertions are INTERNAL-CONSISTENCY checks between two surfaces that must agree.
 *
 * Deliberately NO pixel snapshots: the repository has no visual-regression
 * infrastructure (docs/ui-refresh/baseline.md §7).
 */

const URL = "/?v=1&mode=transparency";

/** Records in `SYNTHETIC_SOURCES`. Asserted, not assumed — see phase6Fixtures.ts. */
const SOURCE_COUNT = 11;

const VIEWPORTS = [
  { name: "1024×768 (minimum supported)", width: 1024, height: 768 },
  { name: "1280×800", width: 1280, height: 800 },
  { name: "1440×900", width: 1440, height: 900 },
  { name: "1920×1080", width: 1920, height: 1080 },
];

/** The five titled card regions, in reading order. */
const SECTIONS = [
  "transparency-sources",
  "transparency-datasets",
  "transparency-gaps",
  "transparency-facility-mapping",
  "transparency-methodology",
];

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: no page-level horizontal overflow`).toBeLessThanOrEqual(
    clientWidth + 1,
  );
}

/** Deep-link straight into the area and wait for the populated catalog. */
async function gotoTransparency(page: Page): Promise<void> {
  await page.goto(URL);
  await expect(page.getByTestId("transparency-dashboard")).toBeVisible();
  await expect(page.getByTestId("transparency-source-list")).toBeVisible();
}

/** An unmapped list the backend answers as genuinely empty (not a failure). */
async function mockEmptyUnmapped(page: Page): Promise<void> {
  await mockTransparencyBackend(page);
  // Registered last, so it wins for this path only.
  await page.route("**/api/v1/facilities/mapping-transparency**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...SYNTHETIC_MAPPING,
        without_map_location: 0,
        unmapped: { page: 1, page_size: 25, total: 0, items: [] },
      }),
    }),
  );
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("renders one map-free workspace with five titled, named regions", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText("데이터와 출처");
      await expect(page.getByTestId("top-navigation")).toHaveCount(1);
      await expect(page.getByTestId("mode-switch")).toHaveCount(1);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.locator("#main-content")).toHaveCount(1);
      // Map-free, sidebar-free, and no 후보지 분석 sub-view selector.
      await expect(page.getByTestId("map-container")).toHaveCount(0);
      await expect(page.locator("canvas")).toHaveCount(0);
      await expect(page.locator("aside")).toHaveCount(0);
      await expect(page.getByTestId("suitability-subviews")).toHaveCount(0);
      // The equity metric fieldsets belong to 지역 부담 only.
      await expect(page.locator("fieldset")).toHaveCount(0);

      // Every card section names itself, so the region list is walkable.
      for (const testId of SECTIONS) {
        const section = page.getByTestId(testId);
        await section.scrollIntoViewIfNeeded();
        await expect(section, testId).toBeVisible();
        const labelled = await section.getAttribute("aria-labelledby");
        expect(labelled, `${testId} has an accessible name`).toBeTruthy();
        await expect(page.locator(`#${labelled}`)).toHaveCount(1);
      }
      // The overview names itself too, and its heading is no longer sr-only.
      const overview = page.getByTestId("transparency-overview");
      const overviewLabel = await overview.getAttribute("aria-labelledby");
      await expect(page.locator(`#${overviewLabel}`)).toHaveText("자료 현황 요약");

      await expectNoHorizontalOverflow(page, "populated");
    });

    test("scrolls the document, and nothing but the document", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      // The page is a long report: the document itself scrolls.
      const scrolled = await page.evaluate(() => {
        window.scrollTo(0, 400);
        return window.scrollY;
      });
      expect(scrolled, "the document scrolls vertically").toBeGreaterThan(0);
      await page.evaluate(() => window.scrollTo(0, 0));

      // No nested vertical scroll container anywhere in the dashboard subtree — a
      // pane that scrolls inside the page hides content from an ordinary scroll.
      const nestedVertical = await page.evaluate(() => {
        const root = document.querySelector("[data-testid='transparency-dashboard']")!;
        return [...root.querySelectorAll("*")]
          .filter((node) => {
            const element = node as HTMLElement;
            const style = getComputedStyle(element);
            return (
              (style.overflowY === "auto" || style.overflowY === "scroll") &&
              element.scrollHeight > element.clientHeight + 1
            );
          })
          .map((node) => (node as HTMLElement).className.toString());
      });
      expect(nestedVertical, "no nested vertical scroll pane").toEqual([]);

      // And the only sideways scroll ever offered is a table's own wrapper.
      const sideways = await page.evaluate(() => {
        const root = document.querySelector("[data-testid='transparency-dashboard']")!;
        return [...root.querySelectorAll("*")]
          .filter((node) => {
            const element = node as HTMLElement;
            const style = getComputedStyle(element);
            return style.overflowX === "auto" || style.overflowX === "scroll";
          })
          .map((node) => ((node as HTMLElement).querySelector("table") ? "table" : "other"));
      });
      expect(sideways.length, "the tables keep their overflow fallback").toBeGreaterThan(0);
      expect(new Set(sideways), "only tables own a horizontal scroll container").toEqual(
        new Set(["table"]),
      );

      await expectNoHorizontalOverflow(page, "scrolled");
    });

    test("uses the desktop width for the catalog instead of one narrow column", async ({
      page,
    }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      const tops = await page.evaluate(() =>
        [...document.querySelectorAll("[data-testid='transparency-source-card']")].map((card) =>
          Math.round(card.getBoundingClientRect().top),
        ),
      );
      const columns = tops.filter((top) => top === tops[0]).length;
      // Two at the minimum supported width, more as the viewport grows.
      expect(columns, `${vp.width}px: catalog columns`).toBeGreaterThanOrEqual(
        vp.width >= 1280 ? 3 : 2,
      );

      // The catalog section spans the whole content column rather than a half-width
      // rail. Measured against a sibling in the same column, because the column is
      // capped at `max-w-screen-2xl` and would otherwise fail this at 1920.
      const section = (await page.getByTestId("transparency-sources").boundingBox())!;
      const column = (await page.getByTestId("transparency-notice").boundingBox())!;
      expect(Math.abs(section.width - column.width)).toBeLessThanOrEqual(1);
      expect(section.width).toBeGreaterThanOrEqual(Math.min(vp.width * 0.85, 1536));

      // Every card is wide enough that its metadata is not clipped.
      const card = (await page.getByTestId("transparency-source-card").first().boundingBox())!;
      expect(card.width, "cards stay readable").toBeGreaterThan(300);

      await expectNoHorizontalOverflow(page, "catalog");
    });

    test("states the active conditions and reports, never controls, them", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      const summary = page.getByTestId("transparency-filter-summary");
      await expect(summary).toBeVisible();
      await expect(summary).toContainText("검색어와 필터를 적용하지 않았습니다");

      await page.getByTestId("transparency-search").fill("반입수수료");
      await page.getByTestId("transparency-filter-category").selectOption("landfill");
      await expect(summary).toContainText("검색어 · 반입수수료");
      await expect(summary).toContainText("자료 분야 · 수도권매립지");
      await expect(page.getByTestId("transparency-result-count")).toContainText("1건 표시");
      await expect(page.getByTestId("transparency-source-card")).toHaveCount(1);

      // It reports state; it is never a second way to change it.
      await expect(summary.locator("button")).toHaveCount(0);
      await expect(summary.locator("select")).toHaveCount(0);
      await expect(summary.locator("input")).toHaveCount(0);

      // Clearing both controls returns it to the unfiltered statement.
      await page.getByTestId("transparency-filter-category").selectOption("all");
      await page.getByTestId("transparency-search-clear").click();
      await expect(summary).toContainText("검색어와 필터를 적용하지 않았습니다");
      await expect(page.getByTestId("transparency-source-card")).toHaveCount(SOURCE_COUNT);

      await expectNoHorizontalOverflow(page, "filtered");
    });

    test("keeps an official zero, an absent period, and a failed lookup apart", async ({
      page,
    }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      // A served period is a value and carries no status badge.
      await page.getByTestId("transparency-search").fill("반입량");
      const served = page.getByTestId("transparency-source-card");
      await expect(served).toContainText("2026-05");
      await expect(served.getByTestId("transparency-source-noperiod")).toHaveCount(0);

      // An unserved period is the neutral missing badge — never amber, never a date.
      await page.getByTestId("transparency-search").fill("기상청");
      const badge = page.getByTestId("transparency-source-noperiod");
      await expect(badge).toBeVisible();
      await expect(badge).toHaveAttribute("data-status", "missing");
      await expect(badge).toHaveText("기준 기간 정보 없음");

      await page.getByTestId("transparency-search-clear").click();

      // An OFFICIAL zero stays a rendered 0 and gets no missing badge.
      const counts = page.getByTestId("facility-mapping-counts");
      await counts.scrollIntoViewIfNeeded();
      const addressCard = counts
        .locator("div")
        .filter({ has: page.getByText("주소 없음", { exact: true }) });
      await expect(addressCard.locator("dd")).toHaveText("0");
      await expect(addressCard.locator(".wep-badge")).toHaveCount(0);
      await expect(counts).not.toContainText("자료 없음");

      await expectNoHorizontalOverflow(page, "zero vs missing");
    });

    test("distinguishes a failed freshness request from a source with no period", async ({
      page,
    }) => {
      await mockTransparencyFreshnessError(page);
      await page.goto(URL);
      await expect(page.getByTestId("transparency-freshness-error")).toBeVisible();
      // A failed lookup is not an error the reader must act on…
      await expect(
        page.getByTestId("transparency-dashboard").locator("[role='alert']"),
      ).toHaveCount(0);
      // …and it must not borrow the badge that means "no value was served".
      await page.getByTestId("transparency-search").fill("반입량");
      await expect(page.getByTestId("transparency-source-card")).toContainText(
        "기준 기간을 불러오지 못했습니다",
      );
      await expect(page.getByTestId("transparency-source-noperiod")).toHaveCount(0);

      // The gap section says the count is unknown rather than reporting a zero.
      const gap = page.getByTestId("transparency-gap-period");
      await gap.scrollIntoViewIfNeeded();
      await expect(gap).toContainText("0건이라는 뜻이 아닙니다");

      await expectNoHorizontalOverflow(page, "freshness failure");
    });

    test("separates the three kinds of gap, and none of them is an error", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      const gaps = page.getByTestId("transparency-gaps");
      await gaps.scrollIntoViewIfNeeded();
      await expect(gaps.getByTestId("transparency-cost")).toBeVisible();
      await expect(gaps.getByTestId("transparency-gap-unmapped")).toBeVisible();
      await expect(gaps.getByTestId("transparency-gap-period")).toBeVisible();
      await expect(gaps.locator("[role='alert']")).toHaveCount(0);

      // The unmapped gap and the mapping panel report the SAME served count.
      await expect(gaps.getByTestId("transparency-gap-unmapped")).toContainText("30개");
      const withoutLocation = page
        .getByTestId("facility-mapping-counts")
        .locator("div")
        .filter({ has: page.getByText("지도 위치 없음", { exact: true }) })
        .locator("dd");
      await expect(withoutLocation).toHaveText("30");

      // 11 registered sources, 4 with a served period → 7 without.
      await expect(gaps.getByTestId("transparency-gap-period")).toContainText("등록된 출처 11건");
      await expect(gaps.getByTestId("transparency-gap-period")).toContainText("7건");
      await expect(page.getByTestId("transparency-overview-period")).toContainText("4건");

      await expectNoHorizontalOverflow(page, "gaps");
    });

    test("publishes every unmapped record with proper table semantics", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      const table = page.getByTestId("unmapped-facility-table");
      await table.scrollIntoViewIfNeeded();
      await expect(table.locator("caption")).toHaveCount(1);
      await expect(table.locator("thead th[scope='col']")).toHaveCount(5);
      // Both served facilities are listed, each led by its own row header.
      await expect(table.locator("tbody tr")).toHaveCount(2);
      await expect(table.locator("tbody th[scope='row']")).toHaveCount(2);
      // The recorded reason verbatim, and the honest placeholder where none exists.
      await expect(table).toContainText("주소 정제 실패");
      await expect(table).toContainText("실패 사유 기록 없음");

      // The pager is reachable and states its boundary rather than hiding it.
      const pager = page.getByTestId("transparency-unmapped-pagination");
      await expect(pager).toContainText("1 / 2 페이지");
      await expect(page.getByRole("button", { name: "이전 페이지" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "다음 페이지" })).toBeEnabled();

      await expectNoHorizontalOverflow(page, "unmapped table");
    });

    test("keeps an empty unmapped list distinct from a failed page request", async ({ page }) => {
      // 1. A genuinely empty list — an answer, not a failure.
      await mockEmptyUnmapped(page);
      await page.goto(URL);
      const empty = page.getByTestId("transparency-unmapped-empty");
      await empty.scrollIntoViewIfNeeded();
      await expect(empty).toBeVisible();
      await expect(empty).not.toHaveAttribute("role", "alert");
      await expect(page.getByTestId("transparency-mapping-error")).toHaveCount(0);
      // No pager for a single page, and no fabricated rows.
      await expect(page.getByTestId("unmapped-facility-table")).toHaveCount(0);
      await expect(page.getByTestId("transparency-unmapped-pagination")).toHaveCount(0);

      // 2. A genuine failure — the one alert on this screen.
      await mockTransparencyMappingError(page);
      await page.goto(URL);
      const error = page.getByTestId("transparency-mapping-error");
      await error.scrollIntoViewIfNeeded();
      await expect(error).toHaveAttribute("role", "alert");
      // The raw backend code is preserved, but as a diagnostic line rather than as
      // the citizen's explanation.
      const detail = error.getByTestId("transparency-mapping-error-detail");
      await expect(detail).toHaveAttribute("data-diagnostic");
      await expect(error).toContainText("잠시 문제가 발생했습니다");
      await expect(page.getByTestId("transparency-unmapped-empty")).toHaveCount(0);
      // No stale counts survive it, and the catalog is unaffected.
      await expect(page.getByTestId("facility-mapping-counts")).toHaveCount(0);
      await expect(page.getByTestId("transparency-source-card")).toHaveCount(SOURCE_COUNT);

      await expectNoHorizontalOverflow(page, "unmapped states");
    });

    test("keeps an empty registry distinct from a failed request", async ({ page }) => {
      await mockTransparencyNoSources(page);
      await page.goto(URL);
      const empty = page.getByTestId("transparency-sources-empty");
      await expect(empty).toBeVisible();
      await expect(empty).not.toHaveAttribute("role", "alert");
      // No controls, no condition summary, and no count over an empty registry.
      await expect(page.getByTestId("transparency-search")).toHaveCount(0);
      await expect(page.getByTestId("transparency-filter-summary")).toHaveCount(0);
      await expect(page.getByTestId("transparency-result-count")).toHaveCount(0);
      // The rest of the page still works — one panel's emptiness is not a page error.
      await expect(page.getByTestId("transparency-datasets")).toBeVisible();
      await expectNoHorizontalOverflow(page, "empty registry");
    });

    test("keeps source links real, and technical detail reachable from the keyboard", async ({
      page,
    }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      await page.getByTestId("transparency-search").fill("반입량");
      const link = page.getByTestId("transparency-source-link");
      await expect(link).toHaveJSProperty("tagName", "A");
      await expect(link).toHaveAttribute(
        "href",
        "https://www.data.go.kr/data/15064381/fileData.do",
      );
      await expect(link).toHaveAttribute("rel", /noopener/);
      await expect(link).toHaveAttribute("rel", /noreferrer/);
      await expect(link).toContainText("새 창");

      // The card's diagnostic disclosure opens from the keyboard alone.
      const disclosure = page.getByTestId("transparency-source-card").locator("details");
      await expect(disclosure).not.toHaveAttribute("open", "");
      await disclosure.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(disclosure).toHaveAttribute("open", "");
      await expect(disclosure).toContainText("15064381");

      // So does the page-level 기술 정보 accordion, where the version strings live.
      const technical = page.getByTestId("transparency-technical");
      await technical.scrollIntoViewIfNeeded();
      await page.getByTestId("transparency-technical-summary").focus();
      await page.keyboard.press("Enter");
      await expect(technical).toHaveAttribute("open", "");
      await expect(technical.getByText("suitability-policy-v2")).toBeVisible();

      await expectNoHorizontalOverflow(page, "links and disclosures");
    });

    test("states reported and derived provenance with the shared badge", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);
      const datasets = page.getByTestId("transparency-datasets");
      await datasets.scrollIntoViewIfNeeded();

      const reported = datasets.locator(".wep-badge[data-status='reported']");
      const derived = datasets.locator(".wep-badge[data-status='derived']");
      await expect(reported).toHaveCount(3);
      await expect(derived).toHaveCount(1);
      // Never colour alone: each badge carries its own text.
      await expect(reported.first()).toHaveText("직접 보고값");
      await expect(derived).toHaveText("공식 자료 기반 계산값");
      await expect(datasets).toContainText("값이 없는 지역은 빈 칸으로 두며 0으로 채우지 않습니다.");

      await expectNoHorizontalOverflow(page, "provenance");
    });
  });
}

/**
 * Cross-view contracts. Run once at the primary desktop target — they are about the
 * shell, not about layout at a particular width.
 */
test.describe("cross-view regression — 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("holds the map contract through a full round trip", async ({ page }) => {
    await mockTransparencyBackend(page);
    await gotoTransparency(page);

    const steps: [string, string, number][] = [
      ["데이터·출처", "transparency-sources", 0],
      ["지역 부담", "region-select", 1],
      ["후보지 분석", "suitability-summary", 1],
      ["매립지 현황", "landfill-dashboard", 0],
      ["데이터·출처", "transparency-sources", 0],
    ];
    for (const [label, marker, maps] of steps) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page.getByTestId(marker), label).toBeVisible();
      await expect(page.getByTestId("map-container"), `${label}: maps`).toHaveCount(maps);
      // The shared chrome never doubles, and the labels stay frozen.
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByTestId("top-navigation")).toHaveCount(1);
      await expect(page.locator("main")).toHaveCount(1);
    }

    // 비용 살펴보기 is map-free too, and it is the only place the sub-view bar exists.
    await page.getByRole("button", { name: "후보지 분석", exact: true }).click();
    await expect(page.getByTestId("suitability-subviews")).toHaveCount(1);
    await page.getByTestId("suitability-view-cost").click();
    await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible();
    await expect(page.getByTestId("map-container")).toHaveCount(0);

    // Back in 데이터·출처 the sub-view bar is gone again, not merely hidden.
    await page.getByRole("button", { name: "데이터·출처", exact: true }).click();
    await expect(page.getByTestId("transparency-source-list")).toBeVisible();
    await expect(page.getByTestId("suitability-subviews")).toHaveCount(0);
    await expect(page.getByTestId("mode-transparency")).toHaveAttribute("aria-pressed", "true");
  });

  test("restores the area from the URL and leaves no transparency state behind", async ({
    page,
  }) => {
    await mockTransparencyBackend(page);
    await page.goto(URL);
    await expect(page.getByTestId("transparency-source-list")).toBeVisible();
    await page.getByTestId("transparency-search").fill("반입량");
    await expect(page.getByTestId("transparency-source-card")).toHaveCount(1);

    // Leaving and returning gives a fresh catalog — the filter state is view state,
    // never written to the URL, and never leaks into another area.
    await page.getByRole("button", { name: "매립지 현황", exact: true }).click();
    await expect(page.getByTestId("landfill-dashboard")).toBeVisible();
    await expect(page.getByTestId("transparency-search")).toHaveCount(0);
    await expect(page.getByTestId("transparency-source-card")).toHaveCount(0);
    expect(page.url()).not.toContain("mode=transparency");

    await page.getByRole("button", { name: "데이터·출처", exact: true }).click();
    await expect(page.getByTestId("transparency-source-card")).toHaveCount(SOURCE_COUNT);
    await expect(page.getByTestId("transparency-search")).toHaveValue("");
    expect(page.url()).toContain("mode=transparency");

    // And a cold deep link lands in the same place.
    await page.goto(URL);
    await expect(page.getByTestId("mode-transparency")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("h1")).toHaveText("데이터와 출처");
  });
});
