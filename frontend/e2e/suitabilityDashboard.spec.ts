import { expect, test, type Page } from "@playwright/test";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * 후보지 분석 dashboard refresh — desktop acceptance for the suitability milestone.
 *
 * Complements the existing coverage rather than repeating it: `scenario.spec.ts`
 * owns the weight-lab request contract, `desktopNavigation.spec.ts` owns the shell,
 * and `landCoverLayer.spec.ts` (live) owns the optional map layers. This file owns
 * what the restructured 후보지 점수 and 가중치 바꿔보기 screens newly promise — the
 * sidebar as the single scroll container, the map still reaching the viewport bottom
 * BENEATH the new insight strip, the strip never colliding with the legend or the
 * MapLibre controls, and the analysis sections being reachable and operable.
 *
 * Self-mocked through `suitabilityFixtures.mockSuitabilityBackend`: no backend, no
 * database, no tile server, no government API. Structure, geometry, and behaviour
 * only — never a fixture value. Deliberately NO pixel snapshots: the repository has
 * no visual-regression infrastructure (docs/ui-refresh/baseline.md §7).
 */

const VIEWPORTS = [
  { name: "1024×768 (minimum supported)", width: 1024, height: 768 },
  { name: "1280×800", width: 1280, height: 800 },
  { name: "1440×900", width: 1440, height: 900 },
  { name: "1920×1080", width: 1920, height: 1080 },
];

async function openScore(page: Page): Promise<void> {
  await mockSuitabilityBackend(page);
  await page.goto("/?v=1&mode=suitability&view=score");
  await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("suitability-summary")).toBeVisible();
}

async function openScenario(page: Page): Promise<void> {
  await openScore(page);
  await page.getByTestId("suitability-view-scenario").click();
  await expect(page.getByTestId("scenario-lab")).toBeVisible();
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

// --------------------------------------------------------------------------- //
// Geometry, at every supported desktop viewport
// --------------------------------------------------------------------------- //

for (const vp of VIEWPORTS) {
  test.describe(`suitability dashboard at ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("scrolls the sidebar, never the page, and never clips horizontally", async ({ page }) => {
      await openScore(page);
      await expectNoHorizontalOverflow(page, vp.name);

      const documentScrolls = await page.evaluate(
        () => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      );
      expect(documentScrolls, "no page-level vertical scroll").toBe(false);

      const sidebar = page.locator("aside");
      await expect(sidebar).toBeVisible();
      expect(await sidebar.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");

      // The control column ends at the viewport bottom rather than pushing the page.
      const sidebarBox = (await sidebar.boundingBox())!;
      expect(sidebarBox.y + sidebarBox.height).toBeLessThanOrEqual(vp.height + 2);

      // It is long enough at every supported height that it must scroll LOCALLY —
      // and doing so moves only the sidebar, leaving the page still.
      const overflows = await sidebar.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
      expect(overflows, "sidebar content exceeds its height").toBe(true);
      await sidebar.evaluate((el) => el.scrollTo(0, 400));
      expect(await sidebar.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });

    test("keeps the map filling the workspace beneath the insight strip", async ({ page }) => {
      await openScore(page);
      const mapBox = (await page.getByTestId("map-container").boundingBox())!;

      // The map still reaches the viewport bottom — the strip is an overlay, not a
      // band below the canvas (docs/ui-refresh/regression-contract.md §4).
      expect(mapBox.y + mapBox.height, "map reaches the viewport bottom").toBeGreaterThanOrEqual(
        vp.height - 6,
      );
      expect(mapBox.height, "map is the dominant surface").toBeGreaterThan(vp.height * 0.75);
      expect(mapBox.width, "map keeps a meaningful width").toBeGreaterThan(400);

      const strip = page.getByTestId("suitability-insight-strip");
      await expect(strip).toBeVisible();
      const stripBox = (await strip.boundingBox())!;
      // Inside the map bounds…
      expect(stripBox.x).toBeGreaterThanOrEqual(mapBox.x - 2);
      expect(stripBox.x + stripBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 2);
      expect(stripBox.y).toBeGreaterThanOrEqual(mapBox.y - 2);
      expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height + 2);
      // …and it does not collapse the map: it covers at most a third of its height.
      expect(stripBox.height).toBeLessThan(mapBox.height / 3);
    });

    test("stacks the legend clear of the strip, the attribution, and the map controls", async ({
      page,
    }) => {
      await openScore(page);
      const mapBox = (await page.getByTestId("map-container").boundingBox())!;
      const legendBox = (await page.getByTestId("map-legend").boundingBox())!;
      const stripBox = (await page.getByTestId("suitability-insight-strip").boundingBox())!;

      // One bottom overlay column: the legend sits directly above the strip and the
      // two never overlap, whatever either one's height turns out to be.
      expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(stripBox.y + 1);
      expect(legendBox.x).toBeGreaterThanOrEqual(mapBox.x - 2);
      expect(legendBox.y).toBeGreaterThanOrEqual(mapBox.y - 2);

      // The OSM attribution is never covered.
      const attribBox = await page.locator(".maplibregl-ctrl-attrib").boundingBox();
      if (attribBox) {
        expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(attribBox.y + 2);
      }

      // The MapLibre navigation control (top-right) stays reachable: neither overlay
      // reaches it, and it is clickable.
      const nav = page.locator(".maplibregl-ctrl-top-right");
      if ((await nav.count()) > 0) {
        const navBox = (await nav.boundingBox())!;
        expect(navBox.y + navBox.height).toBeLessThanOrEqual(legendBox.y + 1);
        await expect(nav).toBeVisible();
      }
    });

    test("keeps one map, one h1, one navigation, and one sub-view switch", async ({ page }) => {
      await openScore(page);
      await expect(page.getByTestId("map-container")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText("후보지 분석");
      await expect(page.getByTestId("top-navigation")).toHaveCount(1);
      await expect(page.getByTestId("mode-switch")).toHaveCount(1);
      await expect(page.getByTestId("suitability-subviews")).toHaveCount(1);
      await expect(page.locator("main")).toHaveCount(1);
    });

    test("keeps the header, the disclaimer, and the analysis controls reachable", async ({
      page,
    }) => {
      await openScore(page);
      // Visible without scrolling the column.
      await expect(page.locator("h1")).toBeInViewport();
      await expect(page.getByTestId("suitability-screening-disclaimer")).toBeInViewport();
      await expect(page.getByTestId("suitability-active-basis")).toBeInViewport();

      // Every profile radio, the status filters, and the stable-only control are
      // individually reachable — nothing analytical is hidden behind a toggle.
      const radios = page.locator('input[type="radio"][name="profile"]');
      await expect(radios).toHaveCount(5);
      for (let i = 0; i < 5; i += 1) {
        await radios.nth(i).scrollIntoViewIfNeeded();
        await expect(radios.nth(i)).toBeVisible();
      }
      for (const status of ["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"]) {
        await expect(page.getByTestId(`status-toggle-${status}`)).toBeVisible();
      }
      await expect(page.getByTestId("stable-only-toggle")).toBeVisible();

      // Candidate rows are reachable by scrolling the sidebar, not the page.
      const rows = page.getByTestId("top-candidate-item");
      await expect(rows).toHaveCount(3);
      for (let i = 0; i < 3; i += 1) {
        await rows.nth(i).scrollIntoViewIfNeeded();
        await expect(rows.nth(i)).toBeVisible();
      }
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  });
}

// --------------------------------------------------------------------------- //
// Behaviour — asserted once, at the primary desktop target
// --------------------------------------------------------------------------- //

test.describe("suitability dashboard behaviour at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("shows the status totals, their map display state, and one filter control", async ({
    page,
  }) => {
    await openScore(page);
    const counts = page.getByTestId("candidate-counts");
    await expect(counts).toContainText("스크리닝 통과");
    await expect(counts).toContainText("추가 검토 필요");
    await expect(counts).toContainText("프로젝트 스크리닝 제외");
    await expect(page.getByTestId("status-summary-total")).toContainText("47,893개");

    // Exactly one control per status — the sidebar reports the state, it does not
    // duplicate the control.
    for (const status of ["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"]) {
      await expect(page.getByTestId(`status-toggle-${status}`)).toHaveCount(1);
    }
    await expect(page.getByTestId("status-display-state-EXCLUDED")).toHaveText("지도에서 숨김");
    await page.getByTestId("status-toggle-EXCLUDED").check();
    await expect(page.getByTestId("status-display-state-EXCLUDED")).toHaveText("지도 표시 중");
    await expect(page.getByTestId("suitability-insight-visibility")).toContainText(
      "프로젝트 스크리닝 제외",
    );
  });

  test("changes the scoring basis and carries it into the map insight strip", async ({ page }) => {
    await openScore(page);
    await expect(page.getByTestId("active-basis-name")).toHaveText("기본 기준");
    await page.getByTestId("profile-radio-critic").check();
    await expect(page.getByTestId("active-basis-name")).toHaveText("데이터 분포 기준");
    await expect(page.getByTestId("active-basis-explanation")).toContainText(
      "항목의 중요도 판단이 아닙니다",
    );
    await expect(page.getByTestId("suitability-insight-basis")).toContainText("데이터 분포 기준");
    await expect(page).toHaveURL(/profile=critic/);
  });

  test("selects a candidate from the list and fills the selected-candidate summary", async ({
    page,
  }) => {
    await openScore(page);
    // Nothing selected → an explicit instruction, never a sample candidate.
    await expect(page.getByTestId("candidate-detail-empty")).toBeVisible();

    await page.getByTestId("top-candidate-item").first().click();
    const detail = page.getByTestId("candidate-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("강화군");
    await expect(page.getByTestId("candidate-detail-empty")).toHaveCount(0);
    await expect(page.getByTestId("top-candidate-item").first()).toHaveAttribute(
      "aria-current",
      "true",
    );
    // Component names are the citizen-facing terms, with their score as text.
    await expect(page.getByTestId("candidate-components")).toContainText("용도지역 호환성");
    await expect(page.getByTestId("candidate-component-zoning")).toContainText("90.0000");
    // The selection is mirrored into the versioned URL.
    await expect(page).toHaveURL(/cand=701/);

    // Clearing returns to the explicit prompt — never a zero.
    await page.getByTestId("candidate-detail-clear").click();
    await expect(page.getByTestId("candidate-detail-empty")).toBeVisible();
  });

  test("shows a review candidate's provisional score and its missing component as '-'", async ({
    page,
  }) => {
    await openScore(page);
    await page.getByTestId("top-candidate-item").nth(1).click();
    const detail = page.getByTestId("candidate-detail");
    await expect(detail).toContainText("참고용 임시 점수");
    await expect(detail).toContainText("순위 없음");
    await expect(page.getByTestId("candidate-component-equity")).toContainText("-");
    await expect(detail).toContainText("자료가 없다는 뜻이며 0점이 아닙니다");
    await expect(page.getByTestId("candidate-review-reasons")).toBeVisible();
  });

  test("shows an excluded candidate's reasons without a score or a rank", async ({ page }) => {
    await openScore(page);
    await page.getByTestId("top-candidate-item").nth(2).click();
    await expect(page.getByTestId("candidate-exclusion-reasons")).toBeVisible();
    await expect(page.getByTestId("candidate-detail")).toContainText(
      "분석 규칙에 따른 제외이며 자료 오류가 아닙니다",
    );
    await expect(page.getByTestId("candidate-components")).toHaveCount(0);
  });

  test("restores a shared candidate link, and routes to 데이터·출처 from the strip", async ({
    page,
  }) => {
    await mockSuitabilityBackend(page);
    await page.goto("/?v=1&mode=suitability&view=score&cand=701");
    await expect(page.getByTestId("candidate-detail")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("candidate-detail")).toContainText("강화군");

    await page.getByTestId("suitability-insight-open-sources").click();
    await expect(page.getByTestId("mode-transparency")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("map-container")).toHaveCount(0);
  });
});

// --------------------------------------------------------------------------- //
// 가중치 바꿔보기
// --------------------------------------------------------------------------- //

test.describe("scenario workspace at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("keeps the map full height with the legend and the scenario strip stacked", async ({
    page,
  }) => {
    await openScenario(page);
    const mapBox = (await page.getByTestId("map-container").boundingBox())!;
    expect(mapBox.y + mapBox.height).toBeGreaterThanOrEqual(900 - 6);
    const legendBox = (await page.getByTestId("map-legend").boundingBox())!;
    const stripBox = (await page.getByTestId("suitability-insight-strip").boundingBox())!;
    expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(stripBox.y + 1);
    await expect(page.getByTestId("suitability-insight-interpretation")).toContainText(
      "아직 시나리오를 적용하지 않아",
    );
    await expect(page.getByTestId("map-container")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByTestId("suitability-subviews")).toHaveCount(1);
    await expectNoHorizontalOverflow(page, "scenario 1440×900");
  });

  test("blocks apply on an invalid total and applies at exactly 100%", async ({ page }) => {
    await openScenario(page);
    await expect(page.getByTestId("scenario-overview")).toContainText("현재 운영 기준");

    const input = page.getByTestId("scenario-input-zoning");
    await input.fill("55");
    await input.dispatchEvent("change");
    await expect(page.getByTestId("scenario-apply")).toBeDisabled();
    await expect(page.getByTestId("scenario-total-status")).toContainText(
      "합계가 정확히 100%여야 적용할 수 있습니다",
    );

    await page.getByTestId("scenario-normalize").click();
    await expect(page.getByTestId("scenario-total")).toContainText("100%");
    await expect(page.getByTestId("scenario-apply")).toBeEnabled();

    await page.getByTestId("scenario-apply").click();
    await expect(page.getByTestId("scenario-summary")).toBeVisible();
    await expect(page.getByTestId("scenario-applied-weights")).toContainText("용도지역 호환성");
    await expect(page.getByTestId("scenario-top-candidates")).toBeVisible();
    // The strip follows the applied scenario.
    await expect(page.getByTestId("suitability-insight-interpretation")).toContainText(
      "사용자가 조정한 가중치",
    );
    // …and the weights reach the versioned URL.
    await expect(page).toHaveURL(/wz=/);
  });

  test("compares the selected scenario candidate with the comparison basis", async ({ page }) => {
    await openScenario(page);
    await page.getByTestId("scenario-apply").click();
    await expect(page.getByTestId("scenario-summary")).toBeVisible();

    await page.getByTestId("scenario-top-row").first().click();
    await expect(page.getByTestId("scenario-candidate-detail")).toBeVisible();
    const comparison = page.getByTestId("scenario-selected-comparison");
    await expect(comparison).toBeVisible();
    await expect(comparison).toContainText("사용자 설정");
    await expect(comparison).toContainText("더 좋은 입지라는 뜻이 아닙니다");
  });

  test("restores the stored profile with the reset control", async ({ page }) => {
    await openScenario(page);
    const input = page.getByTestId("scenario-input-zoning");
    await input.fill("10");
    await input.dispatchEvent("change");
    await expect(page.getByTestId("scenario-value-zoning")).toHaveText("10%");
    await page.getByTestId("scenario-reset-stored").click();
    // The mocked run's baseline profile is 40/30/20/10.
    await expect(page.getByTestId("scenario-value-zoning")).toHaveText("40%");
    await expect(page.getByTestId("scenario-apply")).toBeEnabled();
  });
});

// --------------------------------------------------------------------------- //
// 비용 살펴보기 regression guard — not redesigned by this milestone
// --------------------------------------------------------------------------- //

test.describe("cost sub-view regression at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("still mounts the cost dashboard, with no map and the shared chrome intact", async ({
    page,
  }) => {
    await openScore(page);
    await page.getByTestId("suitability-view-cost").click();
    await expect(page.getByTestId("facility-cost-dashboard")).toBeVisible();
    await expect(page.getByTestId("map-container")).toHaveCount(0);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByTestId("suitability-subviews")).toHaveCount(1);
    await expect(page.getByTestId("mode-switch")).toHaveCount(1);
    // The screening disclaimer follows into the cost view's own notice.
    await expect(page.getByTestId("suitability-screening-disclaimer")).toBeVisible();
    await expectNoHorizontalOverflow(page, "cost 1440×900");

    // Returning restores the score workspace and its single map.
    await page.getByTestId("suitability-view-score").click();
    await expect(page.getByTestId("suitability-summary")).toBeVisible();
    await expect(page.getByTestId("map-container")).toHaveCount(1);
  });
});
