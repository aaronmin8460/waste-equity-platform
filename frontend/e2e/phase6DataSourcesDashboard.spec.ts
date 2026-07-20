import { expect, test, type Page } from "@playwright/test";

import {
  mockTransparencyBackend,
  mockTransparencyFreshnessError,
  mockTransparencyMappingError,
  mockTransparencyNoSources,
  mockTransparencySlowMapping,
} from "./phase6Fixtures";

/**
 * Phase 6 acceptance — 데이터와 출처 desktop information hierarchy.
 *
 * Structure and behaviour only: landmark counts, the desktop control row, the
 * source catalog, search and filter behaviour, the separation of loading / catalog /
 * registry-empty / search-empty / error, overflow, and keyboard operability.
 *
 * The registry payloads come from `phase6Fixtures.ts` and are SYNTHETIC LAYOUT
 * FIXTURES — not official data (that file documents the reasoning and the marker
 * text they carry). No assertion here claims a served value is correct.
 *
 * Deliberately NO pixel-snapshot assertions, and no assertion that depends on exact
 * Korean font wrapping (repository convention).
 *
 * Primary target 1440×900, secondary 1280×800 (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §8).
 */

const URL = "/?v=1&mode=transparency";

/** Records in `SYNTHETIC_SOURCES`. Asserted, not assumed — see phase6Fixtures.ts. */
const SOURCE_COUNT = 11;

const VIEWPORTS = [
  { name: "mobile 390×844", width: 390, height: 844, desktop: false },
  { name: "mobile 430×932", width: 430, height: 932, desktop: false },
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

/** Deep-link straight into the area and wait for the populated catalog. */
async function gotoTransparency(page: Page): Promise<void> {
  await page.goto(URL);
  await expect(page.getByTestId("transparency-dashboard")).toBeVisible();
  await expect(page.getByTestId("transparency-source-list")).toBeVisible();
}

/** Card titles in render order — the catalog's ordering contract. */
async function cardTitles(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-testid='transparency-source-card']")].map((card) =>
      card.querySelector("p")!.textContent!.trim(),
    ),
  );
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("renders one map-free dashboard with a single heading and one nav", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      // Exactly one of each piece of global chrome.
      await expect(page.getByTestId("top-navigation")).toHaveCount(1);
      await expect(page.getByTestId("mode-switch")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText("데이터와 출처");
      await expect(page.locator("#main-content")).toHaveCount(1);
      await expect(page.locator("main")).toHaveCount(1);

      // This view supports no map, so none is mounted — not merely hidden.
      await expect(page.getByTestId("map-container")).toHaveCount(0);
      await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
      await expect(page.locator("canvas")).toHaveCount(0);
      // Nor an equity-style sidebar, nor the 후보지 분석 segmented control.
      await expect(page.locator("aside")).toHaveCount(0);
      await expect(page.getByTestId("suitability-subviews")).toHaveCount(0);
      for (const view of ["score", "scenario", "cost"]) {
        await expect(page.getByTestId(`suitability-view-${view}`)).toHaveCount(0);
      }

      // Full-width: the dashboard spans essentially the whole viewport.
      const box = (await page.getByTestId("transparency-dashboard").boundingBox())!;
      expect(box.width).toBeGreaterThan(vp.width * 0.9);

      await expectNoHorizontalOverflow(page);
    });

    test("keeps the global navigation labels and position unchanged", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);
      for (const label of ["지역 부담", "후보지 분석", "매립지 현황", "데이터·출처"]) {
        await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(1);
      }
      // The nav sits above the dashboard content, as in every other area.
      const nav = (await page.getByTestId("top-navigation").boundingBox())!;
      const dashboard = (await page.getByTestId("transparency-dashboard").boundingBox())!;
      expect(nav.y + nav.height).toBeLessThanOrEqual(dashboard.y + 1);
      await expect(page.getByTestId("mode-transparency")).toHaveAttribute("aria-pressed", "true");
    });

    test("leads with the banner, the overview, and the catalog controls", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      const notice = page.getByTestId("transparency-notice");
      await expect(notice).toBeVisible();
      // A standing explanation, not an alert.
      await expect(notice).not.toHaveAttribute("role", "alert");

      await expect(page.getByTestId("transparency-overview")).toBeVisible();
      await expect(page.getByTestId("transparency-overview-total")).toBeVisible();
      await expect(page.getByTestId("transparency-search")).toBeVisible();
      await expect(page.getByTestId("transparency-filter-category")).toBeVisible();
      await expect(page.getByTestId("transparency-filter-frequency")).toBeVisible();
      await expect(page.getByTestId("transparency-result-count")).toBeVisible();

      // Document order: heading → banner → overview → catalog.
      const order = await page.evaluate(() => {
        const ids = [
          "transparency-notice",
          "transparency-overview",
          "transparency-sources",
          "transparency-datasets",
          "transparency-gaps",
        ];
        const tops = ids.map(
          (id) => document.querySelector(`[data-testid='${id}']`)!.getBoundingClientRect().top,
        );
        return tops;
      });
      for (let i = 1; i < order.length; i += 1) {
        expect(order[i], "sections stack in the documented order").toBeGreaterThan(order[i - 1]);
      }

      await expectNoHorizontalOverflow(page);
    });

    test("shows the source catalog with plain-Korean names and no raw enums", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      const cards = page.getByTestId("transparency-source-card");
      await expect(cards).toHaveCount(SOURCE_COUNT);
      const list = page.getByTestId("transparency-source-list");
      await expect(list).toContainText("인구 통계와 행정경계");
      await expect(list).toContainText("수도권 폐기물 반입량");
      await expect(list).toContainText("기준 기간");

      // The raw cadence / ingestion-status enums must not be the citizen's label.
      // Diagnostic disclosures are closed, so their text is not rendered.
      const primary = await page.evaluate(() => {
        const root = document.querySelector("[data-testid='transparency-dashboard']")!;
        const clone = root.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("[data-diagnostic]").forEach((node) => node.remove());
        clone
          .querySelectorAll("[data-testid='transparency-technical']")
          .forEach((node) => node.remove());
        return clone.textContent ?? "";
      });
      for (const token of [
        "MONTHLY",
        "REAL_TIME",
        "STRUCTURAL",
        "ANNUAL",
        "FRESH",
        "UNKNOWN",
        "suitability-policy",
        "capital-grid-500m",
        "OFFICIAL_INPUTS_DERIVED_VALUE",
      ]) {
        expect(primary, `primary surface leaks "${token}"`).not.toContain(token);
      }
      // Nor a claim of latestness the metadata cannot support.
      expect(primary).not.toContain("최신");

      await expectNoHorizontalOverflow(page);
    });

    test("searches, clears, and filters the catalog deterministically", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      const search = page.getByTestId("transparency-search");
      const cards = page.getByTestId("transparency-source-card");
      const before = await cardTitles(page);
      expect(before).toHaveLength(SOURCE_COUNT);

      // A Korean name narrows to one specific record — not merely "fewer".
      await search.fill("반입수수료");
      await expect(cards).toHaveCount(1);
      expect(await cardTitles(page)).toEqual(["폐기물 반입수수료"]);
      await expect(page.getByTestId("transparency-result-count")).toContainText("1건 표시");

      // Clearing restores the identical list, in the identical order.
      await page.getByTestId("transparency-search-clear").click();
      await expect(cards).toHaveCount(SOURCE_COUNT);
      expect(await cardTitles(page)).toEqual(before);

      // A dataset identifier finds the record without becoming its title.
      await search.fill("15064394");
      await expect(cards).toHaveCount(1);
      expect(await cardTitles(page)).toEqual(["폐기물 반입수수료"]);

      await page.getByTestId("transparency-search-clear").click();

      // Category filter: only the landfill records survive.
      await page.getByTestId("transparency-filter-category").selectOption("landfill");
      expect(await cardTitles(page)).toEqual(["수도권 폐기물 반입량", "폐기물 반입수수료"]);
      // Ordering is the catalog's, not the filter's.
      const filtered = await cardTitles(page);
      expect(filtered).toEqual(before.filter((title) => filtered.includes(title)));

      await page.getByTestId("transparency-filter-category").selectOption("all");
      await expect(cards).toHaveCount(SOURCE_COUNT);

      // Frequency filter is generated from the served records only.
      const options = await page
        .getByTestId("transparency-filter-frequency")
        .locator("option")
        .allTextContents();
      expect(options).toContain("월간");
      expect(options).toContain("연간");
      expect(options).toContain("실시간");
      expect(options).toContain("수시 갱신");
      // The unknown WEEKLY code is offered under a neutral label, never invented.
      expect(options).toContain("갱신 주기 정보 없음");

      await page.getByTestId("transparency-filter-frequency").selectOption("ANNUAL");
      await expect(cards).toHaveCount(1);

      await expectNoHorizontalOverflow(page);
    });

    test("shows a no-match state that is not an error and fabricates no source", async ({
      page,
    }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      await page.getByTestId("transparency-search").fill("존재하지않는자료명");
      await expect(page.getByTestId("transparency-empty-results")).toBeVisible();
      await expect(page.getByTestId("transparency-source-card")).toHaveCount(0);
      await expect(page.getByTestId("transparency-source-list")).toHaveCount(0);
      // A search miss is not an API error.
      await expect(
        page.getByTestId("transparency-dashboard").locator("[role='alert']"),
      ).toHaveCount(0);
      await expect(page.getByTestId("transparency-result-count")).toContainText("0건 표시");

      // The recovery action restores the full catalog.
      await page.getByRole("button", { name: "검색 조건 지우기" }).click();
      await expect(page.getByTestId("transparency-source-card")).toHaveCount(SOURCE_COUNT);

      await expectNoHorizontalOverflow(page);
    });

    test("keeps reference periods, official zeros, and unavailable values distinct", async ({
      page,
    }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      // A served reference period renders as itself…
      await page.getByTestId("transparency-search").fill("반입량");
      await expect(page.getByTestId("transparency-source-card")).toContainText("2026-05");
      // The collection date is a UTC calendar date; without the Korean qualifier it
      // is ambiguous by one day against KST.
      await expect(page.getByTestId("transparency-source-card")).toContainText(
        "2026-06-01 (세계표준시)",
      );

      // …and an unserved one is explicitly unavailable, never zero or a guess.
      // 기상청 is in the registry but has no freshness row.
      await page.getByTestId("transparency-search").fill("기상청");
      const card = page.getByTestId("transparency-source-card");
      await expect(card).toContainText("기준 기간 정보 없음");
      await expect(card).toContainText("수집 기록 없음");

      // A record whose registry row served no URL gets an explicit label, never a
      // constructed link. (Carried by a synthetic id, so the fixture never depicts a
      // real agency as lacking an institutional link — see phase6Fixtures.ts.)
      await page.getByTestId("transparency-search").fill("Synthetic Unknown");
      const noLink = page.getByTestId("transparency-source-card");
      await expect(noLink).toHaveCount(1);
      await expect(noLink.getByTestId("transparency-source-nolink")).toBeVisible();
      await expect(noLink.locator("a")).toHaveCount(0);

      await page.getByTestId("transparency-search-clear").click();

      // An OFFICIAL zero stays a rendered 0 rather than becoming "자료 없음".
      // Scoped to the 주소 없음 card's own value: asserting "0" against the whole
      // 120/90/30/0 grid would be satisfied by the "120" alone.
      const counts = page.getByTestId("facility-mapping-counts");
      await counts.scrollIntoViewIfNeeded();
      await expect(counts).toContainText("120");
      const addressValue = counts
        .locator("div")
        .filter({ has: page.getByText("주소 없음", { exact: true }) })
        .locator("dd");
      await expect(addressValue).toHaveText("0");
      await expect(counts).not.toContainText("자료 없음");

      // Direct-report vs derived, in plain Korean.
      const datasets = page.getByTestId("transparency-datasets");
      await expect(datasets).toContainText("직접 보고값");
      await expect(datasets).toContainText("공식 자료 기반 계산값");
      await expect(datasets).toContainText(
        "값이 없는 지역은 빈 칸으로 두며 0으로 채우지 않습니다.",
      );

      // The shared mock serves EMPTY dataset envelopes, so no row carries a
      // `source_id`. The 출처 column must say so rather than borrowing a plausible
      // agency from the source catalog rendered directly above it.
      await expect(datasets).toContainText("자료 출처 미표기");
      await expect(datasets).not.toContainText("통계청 SGIS");
      await expect(datasets).not.toContainText("한국환경공단");

      await expectNoHorizontalOverflow(page);
    });

    test("opens a source link as a real anchor to the served URL only", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      await page.getByTestId("transparency-search").fill("반입량");
      const link = page.getByTestId("transparency-source-link");
      await expect(link).toHaveAttribute(
        "href",
        "https://www.data.go.kr/data/15064381/fileData.do",
      );
      await expect(link).toHaveAttribute("rel", /noreferrer/);
      await expect(link).toContainText("새 창");

      // A record whose served URL is not an absolute http(s) URL must not be
      // repaired into a link. (Synthetic id, so no real agency is depicted as having
      // a malformed registry entry — see phase6Fixtures.ts.)
      await page.getByTestId("transparency-search").fill("Malformed-Link");
      await expect(page.getByTestId("transparency-source-card")).toHaveCount(1);
      await expect(page.getByTestId("transparency-source-link")).toHaveCount(0);
      await expect(page.getByTestId("transparency-source-nolink")).toBeVisible();
      await expect(page.getByTestId("transparency-source-card").locator("a")).toHaveCount(0);
    });

    test("keeps technical provenance reachable behind a disclosure", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      const technical = page.getByTestId("transparency-technical");
      await technical.scrollIntoViewIfNeeded();
      await expect(technical).not.toHaveAttribute("open", "");

      // `toContainText` reads `textContent`, which a CLOSED <details> still holds —
      // so a text assertion here would pass whether or not the disclosure opened.
      // Visibility is the load-bearing check: content inside a closed <details> has
      // no layout box, so this fails if the click does nothing.
      const version = technical.getByText("suitability-policy-v2");
      // `toBeHidden()` also passes for a locator that is not ATTACHED, so an
      // in-flight policy request would satisfy it for the wrong reason. Wait for the
      // node to exist first, then assert it is present-but-not-rendered.
      await expect(version).toBeAttached();
      await expect(
        version,
        "identifiers are hidden until the reader opens the disclosure",
      ).toBeHidden();

      await page.getByTestId("transparency-technical-summary").click();
      await expect(technical).toHaveAttribute("open", "");
      await expect(version, "identifiers are fully preserved once opened").toBeVisible();
      await expect(technical.getByText("suitability-screening-v3")).toBeVisible();
      await expect(technical.getByText("capital-grid-500m-v1")).toBeVisible();
      await expect(technical.getByText("분석 규칙 버전")).toBeVisible();

      // A long identifier wraps rather than widening the page.
      await expectNoHorizontalOverflow(page);
    });

    test("keeps every table's overflow local to the table", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);
      for (const testId of ["transparency-datasets", "unmapped-facility-table"]) {
        const element = page.getByTestId(testId);
        await element.scrollIntoViewIfNeeded();
        await expect(element).toBeVisible();
      }

      // The load-bearing part. A page-level overflow check alone cannot tell the
      // difference between "the table scrolls inside its wrapper" and "the table is
      // clipped and unreachable" — swapping `overflow-x-auto` for `overflow-hidden`
      // passes the page-level check while making the widest columns unreadable.
      const wrappers = await page.evaluate(() => {
        function measure(selector: string) {
          const table = document.querySelector(selector) as HTMLElement;
          const wrapper = table.closest("div") as HTMLElement;
          return {
            overflowX: getComputedStyle(wrapper).overflowX,
            wrapperWidth: wrapper.clientWidth,
            contentWidth: wrapper.scrollWidth,
          };
        }
        return {
          datasets: measure("[data-testid='transparency-datasets'] table"),
          unmapped: measure("[data-testid='unmapped-facility-table']"),
        };
      });

      for (const [name, box] of Object.entries(wrappers)) {
        expect(box.overflowX, `${name} scrolls inside its own wrapper`).toBe("auto");
      }

      // Below the tables' min-widths (560px / 680px) the content genuinely exceeds
      // its wrapper, so the scroll is real rather than nominal. Asserted only where
      // it must be true, instead of a `>= 0` comparison that holds for any element.
      if (vp.width < 680) {
        expect(
          wrappers.unmapped.contentWidth,
          "the 680px-wide unmapped table really does overflow its wrapper here",
        ).toBeGreaterThan(wrappers.unmapped.wrapperWidth);
      }
      if (vp.width < 560) {
        expect(wrappers.datasets.contentWidth).toBeGreaterThan(wrappers.datasets.wrapperWidth);
      }

      await expectNoHorizontalOverflow(page);
    });

    test("pages the unmapped list without showing another page's facilities", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      // 30 unmapped facilities at a page size of 25 → two pages.
      const pager = page.getByTestId("transparency-unmapped-pagination");
      await pager.scrollIntoViewIfNeeded();
      await expect(pager).toContainText("1 / 2 페이지");
      await expect(pager).toContainText("총 30개");

      const previous = page.getByTestId("transparency-unmapped-prev");
      const next = page.getByTestId("transparency-unmapped-next");
      await expect(previous).toBeDisabled();
      await expect(next).toBeEnabled();

      // The label and the rows must never disagree: the fixture serves page 1's
      // facilities for every request, so page 2 must show the paging status rather
      // than page 1's rows under a "2 / 2 페이지" label.
      await next.click();
      await expect(pager).toContainText("2 / 2 페이지");
      await expect(page.getByTestId("transparency-unmapped-paging")).toBeVisible();
      await expect(page.getByTestId("unmapped-facility-table")).toHaveCount(0);
      await expect(next).toBeDisabled();
      await expect(previous).toBeEnabled();

      // And back again, which restores the matching rows.
      await previous.click();
      await expect(pager).toContainText("1 / 2 페이지");
      await expect(page.getByTestId("unmapped-facility-table")).toBeVisible();

      await expectNoHorizontalOverflow(page);
    });

    test("keeps the pager operable when a page request fails", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);
      await page.getByTestId("transparency-unmapped-pagination").scrollIntoViewIfNeeded();

      // Fail every subsequent mapping request, then page forward.
      await page.route("**/api/v1/facilities/mapping-transparency**", (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
      );
      await page.getByTestId("transparency-unmapped-next").click();

      const error = page.getByTestId("transparency-mapping-error");
      await expect(error).toBeVisible();
      await expect(error).toHaveAttribute("role", "alert");
      // No stale rows survive the failure…
      await expect(page.getByTestId("unmapped-facility-table")).toHaveCount(0);
      await expect(page.getByTestId("facility-mapping-counts")).toHaveCount(0);
      // …but the reader is not stranded: the controls are still there to go back.
      await expect(page.getByTestId("transparency-unmapped-prev")).toBeEnabled();
    });

    test("separates loading, registry-empty, and a genuine failure", async ({ page }) => {
      // 1. Loading — announced politely, with a decorative skeleton.
      await mockTransparencySlowMapping(page);
      await page.goto(URL);
      const loading = page.getByTestId("transparency-mapping-loading");
      await expect(loading).toBeVisible();
      await expect(loading).toHaveAttribute("role", "status");
      await expect(page.getByTestId("transparency-mapping-skeleton")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      // No fabricated counts while loading, and no alert.
      await expect(page.getByTestId("facility-mapping-counts")).toHaveCount(0);
      await expect(
        page.getByTestId("transparency-dashboard").locator("[role='alert']"),
      ).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });

    test("treats an empty source registry as an answer, not an error", async ({ page }) => {
      await mockTransparencyNoSources(page);
      await page.goto(URL);
      const empty = page.getByTestId("transparency-sources-empty");
      await expect(empty).toBeVisible();
      await expect(empty).not.toHaveAttribute("role", "alert");
      await expect(empty).toContainText("임의로 만들어 표시하지 않습니다");
      // The controls are not offered for an empty registry, and no count lies.
      await expect(page.getByTestId("transparency-search")).toHaveCount(0);
      await expect(page.getByTestId("transparency-source-card")).toHaveCount(0);
      // The section still spans the page (the full-width contract is unchanged).
      const box = (await page.getByTestId("transparency-sources").boundingBox())!;
      expect(box.width).toBeGreaterThan(vp.width * 0.9);
      await expectNoHorizontalOverflow(page);
    });

    test("raises a genuine request failure as an alert with a diagnostic code", async ({
      page,
    }) => {
      await mockTransparencyMappingError(page);
      await page.goto(URL);
      const error = page.getByTestId("transparency-mapping-error");
      await error.scrollIntoViewIfNeeded();
      await expect(error).toBeVisible();
      await expect(error).toHaveAttribute("role", "alert");
      // No fabricated counts beside the failure.
      await expect(page.getByTestId("facility-mapping-counts")).toHaveCount(0);
      // The catalog itself is unaffected — one panel failing is not a page failure.
      await expect(page.getByTestId("transparency-source-card")).toHaveCount(SOURCE_COUNT);
      await expectNoHorizontalOverflow(page);
    });

    test("keeps a failed freshness request distinct from an absent period", async ({ page }) => {
      await mockTransparencyFreshnessError(page);
      await page.goto(URL);
      await expect(page.getByTestId("transparency-freshness-error")).toBeVisible();
      // Not an alert: the catalog rendered and nothing is wrong with the data.
      await expect(
        page.getByTestId("transparency-dashboard").locator("[role='alert']"),
      ).toHaveCount(0);
      await page.getByTestId("transparency-search").fill("반입량");
      await expect(page.getByTestId("transparency-source-card")).toContainText(
        "기준 기간을 불러오지 못했습니다",
      );
      await expectNoHorizontalOverflow(page);
    });

    test("is operable by keyboard with visible focus and no trap", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);

      // Focus the search field directly, then Tab forward through the controls.
      await page.getByTestId("transparency-search").focus();
      const outline = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement!);
        return parseFloat(style.outlineWidth || "0");
      });
      expect(outline, "focus is visibly indicated").toBeGreaterThanOrEqual(2);

      await page.keyboard.type("반입량");
      await expect(page.getByTestId("transparency-source-card")).toHaveCount(1);

      // Tab must keep moving — through clear, then both selects — and never trap.
      const reached: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press("Tab");
        reached.push(
          await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? ""),
        );
      }
      expect(reached).toContain("transparency-search-clear");
      expect(reached).toContain("transparency-filter-category");
      expect(reached).toContain("transparency-filter-frequency");

      // The clear control works from the keyboard.
      await page.getByTestId("transparency-search-clear").focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("transparency-source-card")).toHaveCount(SOURCE_COUNT);
    });
  });
}

/**
 * Desktop-only layout invariants. These are the Phase 6 targets from §8: the control
 * row is horizontal, the catalog is multi-column, and the first viewport carries the
 * orientation content rather than starting mid-table.
 */
for (const vp of VIEWPORTS.filter((viewport) => viewport.desktop)) {
  test.describe(`${vp.name} — desktop layout`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("puts the search and both filters on one row", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);
      const boxes = await Promise.all(
        [
          "transparency-search",
          "transparency-filter-category",
          "transparency-filter-frequency",
        ].map(async (testId) => (await page.getByTestId(testId).boundingBox())!),
      );
      const [search, category, frequency] = boxes;
      // Same row: vertical centres within a control height of each other.
      const centre = (box: { y: number; height: number }) => box.y + box.height / 2;
      expect(Math.abs(centre(search) - centre(category))).toBeLessThan(search.height);
      expect(Math.abs(centre(category) - centre(frequency))).toBeLessThan(category.height);
      // Left-to-right, non-overlapping.
      expect(search.x + search.width).toBeLessThanOrEqual(category.x + 1);
      expect(category.x + category.width).toBeLessThanOrEqual(frequency.x + 1);
    });

    test("lays the catalog out in more than one column", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);
      const tops = await page.evaluate(() =>
        [...document.querySelectorAll("[data-testid='transparency-source-card']")].map((card) =>
          Math.round(card.getBoundingClientRect().top),
        ),
      );
      // At least two cards share a row.
      const firstRow = tops.filter((top) => top === tops[0]);
      expect(firstRow.length).toBeGreaterThanOrEqual(2);
    });

    test("fits the orientation content into the first viewport", async ({ page }) => {
      await mockTransparencyBackend(page);
      await gotoTransparency(page);
      // Heading, banner, overview, and the catalog controls are all reachable without
      // scrolling; the catalog itself may continue below the fold.
      for (const testId of [
        "top-navigation",
        "transparency-notice",
        "transparency-overview",
        "transparency-search",
        "transparency-filter-category",
        "transparency-result-count",
      ]) {
        // ratio: 1 — fully inside the first viewport. The default (ratio 0) passes
        // on a 1px intersection, which is not what "fits above the fold" means.
        await expect(page.getByTestId(testId), `${testId} is above the fold`).toBeInViewport({
          ratio: 1,
        });
      }
      await expect(page.locator("h1")).toBeInViewport();
      // The catalog has started.
      await expect(page.getByTestId("transparency-source-card").first()).toBeInViewport();
    });
  });
}
