import { expect, test, type Page } from "@playwright/test";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * PAGE 5A — the 후보지 심층 비교 A/B comparison foundation, in a real browser.
 *
 * The unit tests cover resolution, revalidation and every state against jsdom.
 * What only a real browser can demonstrate is the property the whole design rests
 * on: the pair travels in the URL, the scenarios live in ONE browser's
 * localStorage, and the comparison is REBUILT from the two on every load. So this
 * spec saves scenarios through the real Page-4 flow, walks to Page 5, reloads, and
 * checks that what comes back was recomputed rather than remembered.
 *
 * It also pins the two states a shared link actually produces in the wild — a
 * scenario this browser does not hold, and one saved against a different run — and
 * the legacy Page-5 link that must keep working beside them.
 *
 * Self-mocked through `suitabilityFixtures.mockSuitabilityBackend` plus the
 * scenario-preview route below: no backend, no database, no tile server, no
 * government API. Every fixture is SYNTHETIC and carries no official evidence label.
 *
 * Playwright's own Chromium is not installed in this environment, so this runs on
 * the installed Chrome channel (matching page4dScenarios.spec.ts).
 */

test.use({ channel: "chrome" });

const STORAGE_KEY = "waste-equity:suitability-saved-scenarios:v1";

/** Run 47's baseline weights, canonicalised — Z 40 / R 30 / E 20 / D 10. */
const CANONICAL_BASELINE = {
  zoning: "0.40000000",
  road: "0.30000000",
  equity: "0.20000000",
  demand: "0.10000000",
};
/** The 형평성 중심 basis, as the fixture run serves it — Z 20 / R 20 / E 40 / D 20. */
const CANONICAL_EQUITY = {
  zoning: "0.20000000",
  road: "0.20000000",
  equity: "0.40000000",
  demand: "0.20000000",
};

/**
 * The preview endpoint BOTH pages revalidate through. It echoes back a canonical
 * 8-dp version of whatever weights it is sent — the real endpoint's behaviour, and
 * what makes "the server is authoritative" observable. It also returns a scored
 * candidate, so the persistence assertion has something that must NOT be stored.
 */
async function mockScenarioPreview(page: Page, options: { fail?: "A" | "B" } = {}): Promise<void> {
  await page.route("**/api/v1/suitability/scenarios/preview", async (route) => {
    const body = route.request().postDataJSON() as {
      weights: { zoning: string; road: string; equity: string; demand: string };
    };
    const canonical = {
      zoning: Number(body.weights.zoning).toFixed(8),
      road: Number(body.weights.road).toFixed(8),
      equity: Number(body.weights.equity).toFixed(8),
      demand: Number(body.weights.demand).toFixed(8),
    };
    const failing =
      (options.fail === "A" && canonical.zoning === CANONICAL_BASELINE.zoning) ||
      (options.fail === "B" && canonical.zoning === CANONICAL_EQUITY.zoning);
    if (failing) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            error: "INVALID_SCENARIO_WEIGHTS",
            detail: "가중치 합이 1이 아닙니다.",
            requested_year: null,
            available_years: [],
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        scenario_hash: `e2e-${canonical.zoning}`,
        scenario_hash_short: "e2e",
        method_version: "scenario-v1",
        run_id: 47,
        reference_year: 2024,
        policy_version: "suitability-policy-v2",
        derivation_version: "suitability-screening-v3",
        candidate_grid_version: "capital-grid-500m-v1",
        component_model_version: "suitability-components-zred-v1",
        component_order: ["zoning", "road", "equity", "demand"],
        canonical_weights: canonical,
        compare_profile: "baseline",
        candidate_count_total: 47893,
        candidate_count_eligible: 1099,
        candidate_count_review: 34534,
        candidate_count_excluded: 12260,
        ranking_population: 1099,
        top_candidates: [
          {
            candidate_id: 701,
            candidate_key: "c-701",
            sido_region_code: "KR-SGIS-23",
            sido_region_name: "인천",
            sigungu_region_code: "KR-SGIS-23710",
            sigungu_region_name: "강화군",
            custom_score: "88.1234",
            custom_rank: 1,
            comparison_profile: "baseline",
            comparison_score: "88.1234",
            comparison_rank: 1,
            rank_delta: 0,
            rank_change_direction: "same",
            zoning_score: null,
            road_score: null,
            equity_score: null,
            demand_score: null,
            stable_count: null,
            stability_class: null,
            centroid_lon: 126.5,
            centroid_lat: 37.7,
          },
        ],
        selected_candidate: null,
        tile_url: "/tiles",
        assumptions: [],
        scenario_label: "사용자 가정 기반 시나리오",
        scenario_disclaimer: "임시 비교 결과입니다.",
        screening_disclaimer: "광역 분석 스크리닝",
      }),
    });
  });
}

async function openPage4(page: Page, search = "?v=1&mode=suitability&view=score"): Promise<void> {
  await page.goto(`/${search}`);
  await expect(page.getByTestId("scenario-save")).toBeVisible({ timeout: 20000 });
}

async function openSavedList(page: Page): Promise<void> {
  const details = page.getByTestId("scenario-saved-list-disclosure");
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveJSProperty("open", true);
}

async function saveScenario(page: Page, name: string): Promise<void> {
  await page.getByTestId("scenario-name-input").fill(name);
  await page.getByTestId("scenario-save-submit").click();
  await expect(page.getByTestId("scenario-save-notice")).toBeVisible();
}

function row(page: Page, name: string) {
  return page.getByTestId("scenario-saved-item").filter({ hasText: name });
}

/**
 * Save two scenarios through the REAL ④ flow, under two different 점수 반영 기준 so
 * the two weight vectors genuinely differ, and select them into A and B.
 * Returns their stored ids.
 */
async function saveAndSelectPair(page: Page): Promise<{ a: string; b: string }> {
  await openPage4(page);

  // A — the default 기본 기준 (baseline) weights.
  await saveScenario(page, "균형안");

  // B — switch ② to the 형평성 중심 basis, so B's stored weights genuinely differ
  // from A's. `.check()` rather than a row click: the control is a radio input.
  await page.getByTestId("profile-radio-equity_focused").check();
  await expect(page.getByTestId("scenario-save-weights")).toContainText("기존 지역 부담(E) 40%");
  await saveScenario(page, "형평성안");

  await openSavedList(page);
  const a = await row(page, "균형안").getAttribute("data-scenario-id");
  const b = await row(page, "형평성안").getAttribute("data-scenario-id");
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();

  await row(page, "균형안").getByTestId("scenario-slot-a").click();
  await row(page, "형평성안").getByTestId("scenario-slot-b").click();
  await expect(page.getByTestId("scenario-compare-count")).toContainText("2/2");

  return { a: a as string, b: b as string };
}

function sideA(page: Page) {
  return page.getByTestId("scenario-comparison-side-a");
}
function sideB(page: Page) {
  return page.getByTestId("scenario-comparison-side-b");
}

test.beforeEach(async ({ page }) => {
  await mockSuitabilityBackend(page);
  await mockScenarioPreview(page);
});

test.describe("the comparison is rebuilt, not remembered", () => {
  test("save two scenarios, compare, reload — the same comparison is recomputed", async ({
    page,
  }) => {
    await saveAndSelectPair(page);

    // 두 시나리오 비교하기 → moves to 후보지 심층 비교 carrying the pair.
    await page.getByTestId("scenario-compare-cta").click();
    await expect(page.getByTestId("scenario-comparison-identity")).toBeVisible({ timeout: 20000 });

    await expect(sideA(page).getByTestId("scenario-comparison-side-name")).toHaveText("균형안");
    await expect(sideB(page).getByTestId("scenario-comparison-side-name")).toHaveText("형평성안");

    // The SERVER's canonical weights, laid out per factor.
    const weights = page.getByTestId("scenario-comparison-weights");
    await expect(weights).toBeVisible();
    const zoning = page.getByTestId("scenario-comparison-weight-row-zoning");
    await expect(zoning.getByTestId("scenario-comparison-weight-a")).toContainText("40%");
    await expect(zoning.getByTestId("scenario-comparison-weight-b")).toContainText("20%");
    await expect(zoning.getByTestId("scenario-comparison-weight-delta")).toHaveText("−20%p");

    // The model's own factor names, never the Figma mock's.
    await expect(weights).toContainText("용도지역 호환성");
    await expect(weights).toContainText("기존 지역 부담");
    await expect(weights).not.toContainText("주민 반응");

    // A REAL reload: new document, new heap, new React tree. The comparison comes
    // back because it is recomputed from the stored weights + the run + the API —
    // nothing about this screen was persisted.
    await page.reload();
    await expect(page.getByTestId("scenario-comparison-identity")).toBeVisible({ timeout: 20000 });
    await expect(sideA(page).getByTestId("scenario-comparison-side-name")).toHaveText("균형안");
    await expect(sideB(page).getByTestId("scenario-comparison-side-name")).toHaveText("형평성안");
    await expect(
      page
        .getByTestId("scenario-comparison-weight-row-zoning")
        .getByTestId("scenario-comparison-weight-a"),
    ).toContainText("40%");

    // Storage still holds ONLY weights and metadata. The previews returned a rank-1
    // candidate scoring 88.1234; Page 5 wrote none of it.
    const blob = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(blob).toContain("0.40000000");
    expect(blob).not.toContain("88.1234");
    expect(blob).not.toContain("custom_rank");
    expect(blob).not.toContain("scenario_hash");
  });

  test("Page 5 does not write to localStorage at all", async ({ page }) => {
    await saveAndSelectPair(page);
    await page.getByTestId("scenario-compare-cta").click();
    await expect(page.getByTestId("scenario-comparison-weights")).toBeVisible({ timeout: 20000 });

    const before = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    await page.reload();
    await expect(page.getByTestId("scenario-comparison-weights")).toBeVisible({ timeout: 20000 });
    const after = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(after).toBe(before);
  });
});

test.describe("states a shared link actually produces", () => {
  test("an id this browser does not hold is named as missing, not left blank", async ({ page }) => {
    const { a } = await saveAndSelectPair(page);

    // A link whose B안 was saved on someone else's device.
    await page.goto(`/?v=1&mode=suitability&view=scenario&cmpA=${a}&cmpB=not-in-this-browser`);
    await expect(page.getByTestId("scenario-comparison-identity")).toBeVisible({ timeout: 20000 });

    await expect(sideA(page).getByTestId("scenario-comparison-side-name")).toHaveText("균형안");
    await expect(sideB(page).getByTestId("scenario-comparison-side-missing")).toContainText(
      "이 브라우저에서 찾을 수 없습니다",
    );
    // No comparison is fabricated from one side.
    await expect(
      page
        .getByTestId("scenario-comparison-weight-row-zoning")
        .getByTestId("scenario-comparison-weight-b"),
    ).toHaveText("자료 없음");
    // …and there is a way back to where the pair is chosen.
    await expect(page.getByTestId("scenario-comparison-back")).toBeVisible();
  });

  test("a scenario saved against another run is refused, and is not silently updated", async ({
    page,
  }) => {
    const { a, b } = await saveAndSelectPair(page);

    // Rewrite A's stored run id — exactly what a re-run of the analysis produces.
    await page.evaluate(
      ({ key, id }) => {
        const parsed = JSON.parse(window.localStorage.getItem(key) as string);
        for (const scenario of parsed.scenarios) {
          if (scenario.id === id) scenario.runId = 46;
        }
        window.localStorage.setItem(key, JSON.stringify(parsed));
      },
      { key: STORAGE_KEY, id: a },
    );

    await page.goto(`/?v=1&mode=suitability&view=scenario&cmpA=${a}&cmpB=${b}`);
    await expect(page.getByTestId("scenario-comparison-identity")).toBeVisible({ timeout: 20000 });

    await expect(sideA(page).getByTestId("scenario-comparison-side-other-run")).toContainText(
      "다른 분석 실행에서 저장된 시나리오입니다",
    );
    // The OTHER_RUN side is never called current.
    await expect(sideA(page).getByTestId("scenario-comparison-side-ready")).toHaveCount(0);
    // B is unaffected and still shows its served weights.
    await expect(
      page
        .getByTestId("scenario-comparison-weight-row-equity")
        .getByTestId("scenario-comparison-weight-b"),
    ).toContainText("40%");

    // The stored run id is NOT quietly corrected to the run on screen.
    const storedRun = await page.evaluate(
      ({ key, id }) => {
        const parsed = JSON.parse(window.localStorage.getItem(key) as string);
        return parsed.scenarios.find((s: { id: string }) => s.id === id).runId;
      },
      { key: STORAGE_KEY, id: a },
    );
    expect(storedRun).toBe(46);
  });

  test("one side failing leaves the other readable", async ({ page }) => {
    const { a, b } = await saveAndSelectPair(page);

    // Re-route so only A's weight vector is refused.
    await page.unroute("**/api/v1/suitability/scenarios/preview");
    await mockScenarioPreview(page, { fail: "A" });

    await page.goto(`/?v=1&mode=suitability&view=scenario&cmpA=${a}&cmpB=${b}`);
    await expect(page.getByTestId("scenario-comparison-identity")).toBeVisible({ timeout: 20000 });

    // The backend's own message, which names the offending value.
    await expect(sideA(page).getByTestId("scenario-comparison-side-error")).toContainText(
      "가중치 합이 1이 아닙니다",
    );
    // B is unaffected — this is not a blank page.
    await expect(sideB(page).getByTestId("scenario-comparison-side-ready")).toBeVisible();
    await expect(
      page
        .getByTestId("scenario-comparison-weight-row-equity")
        .getByTestId("scenario-comparison-weight-b"),
    ).toContainText("40%");
  });
});

test.describe("legacy compatibility", () => {
  test("a legacy wz/wr/we/wd/cmpProfile Page-5 link still opens the weight lab", async ({
    page,
  }) => {
    await page.goto(
      "/?v=1&mode=suitability&view=scenario&wz=0.4&wr=0.3&we=0.2&wd=0.1&cmpProfile=equal",
    );
    await expect(page.getByTestId("scenario-lab")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("scenario-comparison-identity")).toHaveCount(0);

    // The legacy keys keep their meaning in the URL.
    const params = new URLSearchParams(new URL(page.url()).search);
    expect(params.get("wz")).toBe("0.4");
    expect(params.get("cmpProfile")).toBe("equal");
  });

  test("the recovery link returns to 후보지 심층 분석 with the selection intact", async ({
    page,
  }) => {
    const { a } = await saveAndSelectPair(page);
    await page.goto(`/?v=1&mode=suitability&view=scenario&cmpA=${a}&cmpB=gone-from-here`);
    await expect(page.getByTestId("scenario-comparison-back")).toBeVisible({ timeout: 20000 });

    const before = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    await page.getByTestId("scenario-comparison-back").click();

    await expect(page.getByTestId("scenario-compare-picker")).toBeVisible({ timeout: 20000 });
    const params = new URLSearchParams(new URL(page.url()).search);
    expect(params.get("cmpA")).toBe(a);
    // Recovery NAVIGATES. It does not create, edit or delete a scenario.
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBe(before);
  });
});
