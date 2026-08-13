import { expect, test, type Page } from "@playwright/test";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * PAGE 4D — ④ 시나리오 저장 and ⑤ 비교할 시나리오 선택, in a real browser.
 *
 * The unit tests run against jsdom's localStorage, which is a JavaScript object
 * that happens to implement the Storage interface. This spec exercises the ONE
 * property that only a real browser can demonstrate: that a saved scenario
 * survives a genuine page load — a fresh document, a fresh JS heap, a fresh React
 * tree — because it was written to real, persistent browser storage and read back
 * from it. A test that never reloads cannot tell localStorage from a module-level
 * variable.
 *
 * It also pins the two failure modes that are silent in production: a dangling
 * A/B reference surviving a delete, and a corrupt stored blob taking Page 4 down.
 *
 * Self-mocked through `suitabilityFixtures.mockSuitabilityBackend` plus the one
 * scenario-preview route below — no backend, no database, no tile server, no
 * government API. Every fixture is SYNTHETIC and carries no official evidence
 * label.
 *
 * Playwright's own Chromium is not installed in this environment, so this runs on
 * the installed Chrome channel (matching landCoverLayer.spec.ts and publicRelease
 * .spec.ts).
 */

test.use({ channel: "chrome" });

/** The canonical 8-dp echo the backend returns for run 47's baseline weights. */
const CANONICAL = {
  zoning: "0.40000000",
  road: "0.30000000",
  equity: "0.20000000",
  demand: "0.10000000",
};

/**
 * The preview endpoint ④ revalidates through before persisting anything. It
 * deliberately returns a scored top candidate: the point of the storage assertion
 * below is that NONE of it is written to localStorage.
 */
async function mockScenarioPreview(page: Page): Promise<void> {
  await page.route("**/api/v1/suitability/scenarios/preview", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        scenario_hash: "e2e-hash",
        scenario_hash_short: "e2e-hash",
        method_version: "scenario-v1",
        run_id: 47,
        reference_year: 2024,
        policy_version: "suitability-policy-v2",
        derivation_version: "suitability-screening-v3",
        candidate_grid_version: "capital-grid-500m-v1",
        canonical_weights: CANONICAL,
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
    }),
  );
}

async function openPage4(page: Page, search = "?v=1&mode=suitability&view=score"): Promise<void> {
  await mockSuitabilityBackend(page);
  await mockScenarioPreview(page);
  await page.goto(`/${search}`);
  await expect(page.getByTestId("scenario-save")).toBeVisible({ timeout: 20000 });
}

/** Open the `저장목록 보기` disclosure if it is not already open. */
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

/** The row for one saved scenario, addressed by its visible name. */
function row(page: Page, name: string) {
  return page.getByTestId("scenario-saved-item").filter({ hasText: name });
}

function params(page: Page): URLSearchParams {
  return new URLSearchParams(new URL(page.url()).search);
}

test.describe("saved scenarios survive a real page load", () => {
  test("save → reload → the scenario is still there, with its weights and no stored result", async ({
    page,
  }) => {
    await openPage4(page);
    await openSavedList(page);
    await expect(page.getByTestId("scenario-saved-empty")).toBeVisible();

    await saveScenario(page, "형평성 우선안");
    await openSavedList(page);
    await expect(row(page, "형평성 우선안")).toBeVisible();

    // A REAL reload: new document, new heap, new React tree.
    await page.reload();
    await expect(page.getByTestId("scenario-save")).toBeVisible({ timeout: 20000 });
    await openSavedList(page);

    const saved = row(page, "형평성 우선안");
    await expect(saved).toBeVisible();
    await expect(saved.getByTestId("scenario-saved-weights")).toContainText("용도지역 호환성(Z) 40%");

    // What crossed the reload is WEIGHTS AND METADATA. The preview response carried
    // a rank-1 candidate scoring 88.1234; none of it may be in storage, because a
    // stored result goes stale while still looking current.
    const blob = await page.evaluate(() =>
      window.localStorage.getItem("waste-equity:suitability-saved-scenarios:v1"),
    );
    expect(blob).toContain("0.40000000");
    expect(blob).not.toContain("88.1234");
    expect(blob).not.toContain("custom_rank");
  });

  test("rename → reload → the new name persists and the id is unchanged", async ({ page }) => {
    await openPage4(page);
    await saveScenario(page, "원래 이름");
    await openSavedList(page);

    const idBefore = await row(page, "원래 이름").getAttribute("data-scenario-id");
    expect(idBefore).toBeTruthy();

    await row(page, "원래 이름").getByTestId("scenario-saved-menu-toggle").click();
    await row(page, "원래 이름").getByTestId("scenario-rename-open").click();
    await page.getByTestId("scenario-rename-input").fill("바뀐 이름");
    await page.getByTestId("scenario-rename-confirm").click();
    await expect(row(page, "바뀐 이름")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("scenario-save")).toBeVisible({ timeout: 20000 });
    await openSavedList(page);

    await expect(row(page, "바뀐 이름")).toBeVisible();
    await expect(page.getByTestId("scenario-saved-item")).toHaveCount(1);
    // Identity survived the rename, so a link shared before it still resolves.
    expect(await row(page, "바뀐 이름").getAttribute("data-scenario-id")).toBe(idBefore);
  });
});

test.describe("⑤ A/B selection and the shared link", () => {
  test("select A, select B, the CTA enables, and both ids reach the URL", async ({ page }) => {
    await openPage4(page);
    await saveScenario(page, "가안");
    await saveScenario(page, "나안");
    await openSavedList(page);

    await expect(page.getByTestId("scenario-compare-cta")).toBeDisabled();
    await expect(page.getByTestId("scenario-compare-count")).toContainText("(선택 0/2개)");

    await row(page, "가안").getByTestId("scenario-slot-a").click();
    await expect(page.getByTestId("scenario-compare-count")).toContainText("(선택 1/2개)");
    await expect(page.getByTestId("scenario-compare-cta")).toBeDisabled();
    const idA = await row(page, "가안").getAttribute("data-scenario-id");
    await expect(() => expect(params(page).get("cmpA")).toBe(idA)).toPass();

    await row(page, "나안").getByTestId("scenario-slot-b").click();
    await expect(page.getByTestId("scenario-compare-count")).toContainText("(선택 2/2개)");
    await expect(page.getByTestId("scenario-compare-cta")).toBeEnabled();
    const idB = await row(page, "나안").getAttribute("data-scenario-id");
    await expect(() => expect(params(page).get("cmpB")).toBe(idB)).toPass();

    // The slots name the reader's own scenarios, in the order chosen.
    await expect(
      page.getByTestId("scenario-compare-slot-a").getByTestId("scenario-compare-slot-name"),
    ).toHaveText("가안");
    await expect(
      page.getByTestId("scenario-compare-slot-b").getByTestId("scenario-compare-slot-name"),
    ).toHaveText("나안");
  });

  test("deleting the A scenario leaves NO dangling selection", async ({ page }) => {
    await openPage4(page);
    await saveScenario(page, "지울안");
    await saveScenario(page, "남을안");
    await openSavedList(page);

    await row(page, "지울안").getByTestId("scenario-slot-a").click();
    await row(page, "남을안").getByTestId("scenario-slot-b").click();
    await expect(page.getByTestId("scenario-compare-count")).toContainText("(선택 2/2개)");

    await row(page, "지울안").getByTestId("scenario-saved-menu-toggle").click();
    await row(page, "지울안").getByTestId("scenario-delete-open").click();
    await row(page, "지울안").getByTestId("scenario-delete-confirm").click();

    await expect(row(page, "지울안")).toHaveCount(0);
    // The A slot is EMPTY, not "missing", and the deleted id is gone from the link.
    await expect(page.getByTestId("scenario-compare-count")).toContainText("(선택 1/2개)");
    await expect(
      page.getByTestId("scenario-compare-slot-a").getByTestId("scenario-compare-slot-empty"),
    ).toBeVisible();
    await expect(
      page.getByTestId("scenario-compare-slot-a").getByTestId("scenario-compare-slot-missing"),
    ).toHaveCount(0);
    await expect(page.getByTestId("scenario-compare-cta")).toBeDisabled();
    await expect(() => expect(params(page).get("cmpA")).toBeNull()).toPass();

    // …and it stays gone across a reload.
    await page.reload();
    await expect(page.getByTestId("scenario-save")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("scenario-compare-count")).toContainText("(선택 1/2개)");
  });

  test("두 시나리오 비교하기 moves to 후보지 심층 비교 carrying the pair", async ({ page }) => {
    await openPage4(page);
    await saveScenario(page, "가안");
    await saveScenario(page, "나안");
    await openSavedList(page);
    await row(page, "가안").getByTestId("scenario-slot-a").click();
    await row(page, "나안").getByTestId("scenario-slot-b").click();

    const idA = await row(page, "가안").getAttribute("data-scenario-id");
    const idB = await row(page, "나안").getAttribute("data-scenario-id");

    await page.getByTestId("scenario-compare-cta").click();

    await expect(() => {
      const current = params(page);
      expect(current.get("view")).toBe("scenario");
      expect(current.get("cmpA")).toBe(idA);
      expect(current.get("cmpB")).toBe(idB);
    }).toPass();
  });

  test("a shared pair from another browser is named as unresolvable, not shown as unselected", async ({
    page,
  }) => {
    await openPage4(page, "?v=1&mode=suitability&view=score&cmpA=from-another-device");

    await expect(
      page.getByTestId("scenario-compare-slot-a").getByTestId("scenario-compare-slot-missing"),
    ).toBeVisible();
    await expect(page.getByTestId("scenario-compare-cta")).toBeDisabled();
    // The reader's selection survives in the link rather than being silently dropped.
    expect(params(page).get("cmpA")).toBe("from-another-device");
  });
});

test.describe("hostile stored data", () => {
  test("a corrupt blob does not take Page 4 down", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("waste-equity:suitability-saved-scenarios:v1", "{{{ not json");
    });
    await openPage4(page);

    // The rest of the page is fully alive.
    await expect(page.getByTestId("suitability-scope")).toBeVisible();
    await expect(page.getByTestId("suitability-results")).toBeVisible();
    // …and the unreadable data is reported rather than hidden.
    await expect(page.getByTestId("scenario-storage-warnings")).toBeVisible();
    await openSavedList(page);
    await expect(page.getByTestId("scenario-saved-empty")).toBeVisible();

    // Saving over the corrupt blob works.
    await saveScenario(page, "복구안");
    await openSavedList(page);
    await expect(row(page, "복구안")).toBeVisible();
  });

  test("an entry with impossible weights is dropped while the rest still show", async ({ page }) => {
    await page.addInitScript(() => {
      const base = {
        schemaVersion: 1,
        weights: { zoning: "0.4", road: "0.3", equity: "0.2", demand: "0.1" },
        runId: 47,
        profileSource: "baseline",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      window.localStorage.setItem(
        "waste-equity:suitability-saved-scenarios:v1",
        JSON.stringify({
          schemaVersion: 1,
          scenarios: [
            { ...base, id: "good", name: "정상안" },
            {
              ...base,
              id: "broken",
              name: "깨진안",
              weights: { zoning: "9", road: "0", equity: "0", demand: "0" },
            },
          ],
        }),
      );
    });
    await openPage4(page);
    await openSavedList(page);

    await expect(row(page, "정상안")).toBeVisible();
    await expect(row(page, "깨진안")).toHaveCount(0);
    await expect(page.getByTestId("scenario-storage-warnings")).toContainText("1개");
  });
});
