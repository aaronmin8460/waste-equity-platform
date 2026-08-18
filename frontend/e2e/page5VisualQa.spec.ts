import { test, type Page } from "@playwright/test";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * PAGE 5 — Figma fidelity capture harness (후보지 심층 비교, Figma 167:10554).
 *
 * NOT an assertion spec. It renders the real Page-5 comparison against the shared
 * mock backend and writes PNGs so the render can be held against the Figma frame
 * during the visual comparison passes. Every Page-5 contract lives in
 * `page5aComparison.spec.ts`, `page5bRankingAnalytics.spec.ts`,
 * `page5cCandidateComparison.spec.ts` and the unit tests; nothing here is a contract,
 * so it can never fail the suite on a layout change.
 *
 * Output goes OUTSIDE the repository (PAGE5_QA_OUT), so captures are never committed
 * and never collide with another lane's run.
 *
 * ── WHY THIS FIXTURE SPANS THREE 시·군·구 ───────────────────────────────────────
 * The existing Page-5B spec puts every fixture candidate in ONE 시·군·구, which is
 * enough for its arithmetic but renders a single group — so it could not show whether
 * the grouping requirement is met. These rows are spread over 옹진군 / 강화군 /
 * 수원시 장안구 precisely so the capture shows the heading-per-시·군·구 hierarchy the
 * owner asked for instead of the flat repeated list it replaced.
 *
 * Playwright's own Chromium is not installed in this environment, so this runs on the
 * installed Chrome channel (matching page4dScenarios / page5aComparison).
 */

test.use({ channel: "chrome" });

const OUT = process.env.PAGE5_QA_OUT ?? "/tmp/page5-qa";
const STORAGE_KEY = "waste-equity:suitability-saved-scenarios:v1";

const WEIGHTS_A = {
  zoning: "0.40000000",
  road: "0.30000000",
  equity: "0.20000000",
  demand: "0.10000000",
};
const WEIGHTS_B = {
  zoning: "0.20000000",
  road: "0.20000000",
  equity: "0.40000000",
  demand: "0.20000000",
};

/**
 * Three 시·군·구, and movements deliberately chosen to land in all three variability
 * bands (±4 초록 / ±5~9 노랑 / ±10 이상 빨강) so the capture shows the whole key.
 */
const PLACES: Record<string, { sigungu: string; code: string; sido: string; sidoCode: string }> = {
  c1: { sigungu: "인천광역시 옹진군", code: "KR-SGIS-23520", sido: "인천광역시", sidoCode: "KR-SGIS-23" },
  c2: { sigungu: "인천광역시 옹진군", code: "KR-SGIS-23520", sido: "인천광역시", sidoCode: "KR-SGIS-23" },
  c3: { sigungu: "인천광역시 옹진군", code: "KR-SGIS-23520", sido: "인천광역시", sidoCode: "KR-SGIS-23" },
  c4: { sigungu: "인천광역시 강화군", code: "KR-SGIS-23510", sido: "인천광역시", sidoCode: "KR-SGIS-23" },
  c5: { sigungu: "인천광역시 강화군", code: "KR-SGIS-23510", sido: "인천광역시", sidoCode: "KR-SGIS-23" },
  c6: { sigungu: "경기도 수원시 장안구", code: "KR-SGIS-31011", sido: "경기도", sidoCode: "KR-SGIS-31" },
  c7: { sigungu: "경기도 수원시 장안구", code: "KR-SGIS-31011", sido: "경기도", sidoCode: "KR-SGIS-31" },
  c8: { sigungu: "경기도 수원시 장안구", code: "KR-SGIS-31011", sido: "경기도", sidoCode: "KR-SGIS-31" },
  c9: { sigungu: "인천광역시 강화군", code: "KR-SGIS-23510", sido: "인천광역시", sidoCode: "KR-SGIS-23" },
  c10: { sigungu: "인천광역시 옹진군", code: "KR-SGIS-23520", sido: "인천광역시", sidoCode: "KR-SGIS-23" },
  c11: { sigungu: "경기도 수원시 장안구", code: "KR-SGIS-31011", sido: "경기도", sidoCode: "KR-SGIS-31" },
  c12: { sigungu: "인천광역시 강화군", code: "KR-SGIS-23510", sido: "인천광역시", sidoCode: "KR-SGIS-23" },
};

const KEYS_A = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12"];
/** B moves c12 up eleven places, c6/c7 a little, and pushes c1/c2 down ten. */
const KEYS_B = ["c12", "c4", "c5", "c3", "c6", "c7", "c8", "c9", "c10", "c11", "c1", "c2"];

function candidates(keys: readonly string[], base: number) {
  return keys.map((key, index) => {
    const place = PLACES[key];
    return {
      candidate_id: Number(key.slice(1)),
      candidate_key: key,
      sido_region_code: place.sidoCode,
      sido_region_name: place.sido,
      // Already fully qualified, exactly as the real endpoint serves it.
      sigungu_region_code: place.code,
      sigungu_region_name: place.sigungu,
      custom_score: (base - index).toFixed(4),
      custom_rank: index + 1,
      comparison_profile: "baseline",
      comparison_score: "0.1111",
      comparison_rank: 999,
      rank_delta: 900,
      rank_change_direction: "up",
      zoning_score: "90.0000",
      road_score: "70.0000",
      equity_score: "95.0000",
      demand_score: "80.0000",
      component_scores: {},
      stable_count: 3,
      stability_class: "STABLE",
      centroid_lon: 126.5,
      centroid_lat: 37.7,
    };
  });
}

async function mockScenarioPreview(page: Page): Promise<void> {
  await page.route("**/api/v1/suitability/scenarios/preview", async (route) => {
    const body = route.request().postDataJSON() as { weights: { equity: string } };
    const isB = Number(body.weights.equity) > 0.3;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        scenario_hash: isB ? "qa-b" : "qa-a",
        scenario_hash_short: "qa",
        method_version: "scenario-v1",
        run_id: 47,
        reference_year: 2024,
        policy_version: "suitability-policy-v2",
        derivation_version: "suitability-screening-v3",
        candidate_grid_version: "capital-grid-500m-v1",
        component_model_version: "suitability-components-zred-v1",
        component_order: ["zoning", "road", "equity", "demand"],
        canonical_weights: isB ? WEIGHTS_B : WEIGHTS_A,
        compare_profile: "baseline",
        candidate_count_total: 47893,
        candidate_count_eligible: 1099,
        candidate_count_review: 34534,
        candidate_count_excluded: 12260,
        ranking_population: 1099,
        top_candidates: isB ? candidates(KEYS_B, 90) : candidates(KEYS_A, 95),
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

async function seedScenarios(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, weightsA, weightsB]) => {
      const now = "2026-08-18T00:00:00.000Z";
      window.localStorage.setItem(
        key as string,
        JSON.stringify({
          schemaVersion: 1,
          scenarios: [
            {
              schemaVersion: 1,
              id: "qa-a",
              name: "균형안",
              weights: weightsA,
              runId: 47,
              profileSource: null,
              createdAt: now,
              updatedAt: now,
            },
            {
              schemaVersion: 1,
              id: "qa-b",
              name: "형평성안",
              weights: weightsB,
              runId: 47,
              profileSource: null,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
      );
    },
    [STORAGE_KEY, WEIGHTS_A, WEIGHTS_B] as const,
  );
}

test.describe("Page 5 visual QA capture", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("captures the 1440 comparison", async ({ page }, testInfo) => {
    await mockSuitabilityBackend(page);
    await mockScenarioPreview(page);
    await seedScenarios(page);
    await page.goto("/?v=1&mode=suitability&view=scenario&cmpA=qa-a&cmpB=qa-b");
    await page
      .getByTestId("scenario-ranking-analytics")
      .waitFor({ state: "visible", timeout: 40000 });
    // The comparison renders progressively as both previews settle; this lets the
    // scatter and the table finish before the full-page shot.
    await page.waitForTimeout(2000);
    const tag = process.env.PAGE5_QA_TAG ?? "pass";
    await page.screenshot({ path: `${OUT}/${tag}-fold-1440x900.png` });

    /**
     * ELEMENT shots for the two cards this lane changed.
     *
     * A `fullPage` shot resizes the viewport, which remounts the lazily-imported map
     * and re-fires both preview reads — so the tall capture lands mid-reload and shows
     * the loading state rather than the comparison. Scrolling each card into the
     * REAL 1440×900 viewport and shooting it in place captures what a reader at that
     * size actually sees.
     */
    for (const [name, testId] of [
      ["movement-scatter", "scenario-ranking-scatter"],
      ["comparison-table", "scenario-ranking-table"],
      ["slope-chart", "scenario-ranking-slope-legend"],
    ] as const) {
      const card = page.getByTestId(testId).first();
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${tag}-${name}-1440x900.png` });
    }
    testInfo.annotations.push({ type: "out", description: OUT });
  });
});
