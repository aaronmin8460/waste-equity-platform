import { expect, test, type Page } from "@playwright/test";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * PAGE 5B — 순위 비교 분석, in a real browser.
 *
 * The unit tests pin the arithmetic against jsdom. What only a real browser shows
 * is that the analytics are driven by the SAME two preview responses Page 5A already
 * loaded — that sorting the table issues no new request, that a rank the endpoint
 * did not send is still not a number after a real render, and that the block simply
 * is not there when the foundation is not READY.
 *
 * Self-mocked: `mockSuitabilityBackend` plus the scenario-preview route below. No
 * backend, no database, no government API. Every fixture is SYNTHETIC.
 *
 * Playwright's own Chromium is not installed in this environment, so this runs on
 * the installed Chrome channel (matching page4dScenarios/page5aComparison).
 */

test.use({ channel: "chrome" });

const STORAGE_KEY = "waste-equity:suitability-saved-scenarios:v1";

/** A안's stored weights — zoning-led. */
const WEIGHTS_A = {
  zoning: "0.40000000",
  road: "0.30000000",
  equity: "0.20000000",
  demand: "0.10000000",
};
/** B안's stored weights — equity-led, so the two sides genuinely differ. */
const WEIGHTS_B = {
  zoning: "0.20000000",
  road: "0.20000000",
  equity: "0.40000000",
  demand: "0.20000000",
};

/**
 * A's ranking: c1..c12 at ranks 1..12.
 * B's ranking: c4..c13 at 1..10, then c1 and c2 at 11 and 12.
 *
 * Chosen so every case Page 5B has to render is present at once:
 *   - the top candidate CHANGES (c1 → c4);
 *   - TOP-10 retention is a partial 7/10 (c4..c10 survive);
 *   - c4..c12 rise, c1 and c2 fall by 10;
 *   - c3 is served by A only and c13 by B only — the "상위 12 밖" case, which is a
 *     sound conclusion here because each list is a contiguous 1..12 out of 1099.
 */
const KEYS_A = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12"];
const KEYS_B = ["c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12", "c13", "c1", "c2"];

function candidates(keys: string[], base: number) {
  return keys.map((key, index) => ({
    candidate_id: Number(key.slice(1)),
    candidate_key: key,
    sido_region_code: "KR-SGIS-23",
    sido_region_name: "인천광역시",
    // Already fully qualified, exactly as the real endpoint serves it.
    sigungu_region_code: "KR-SGIS-23710",
    sigungu_region_name: "인천광역시 강화군",
    custom_score: (base - index).toFixed(4),
    custom_rank: index + 1,
    comparison_profile: "baseline",
    // Deliberately wrong-looking: these describe the OFFICIAL profile, not A vs B.
    // If any of them reached the screen as an A/B figure, 999 would be visible.
    comparison_score: "0.1111",
    comparison_rank: 999,
    rank_delta: 900,
    rank_change_direction: "up",
    zoning_score: null,
    road_score: null,
    equity_score: null,
    demand_score: null,
    stable_count: null,
    stability_class: null,
    centroid_lon: 126.5,
    centroid_lat: 37.7,
  }));
}

/** Counts requests so "sorting issues no new preview" is observable, not assumed. */
interface PreviewCounter {
  count: number;
}

async function mockScenarioPreview(
  page: Page,
  options: { failB?: boolean } = {},
): Promise<PreviewCounter> {
  const counter: PreviewCounter = { count: 0 };
  await page.route("**/api/v1/suitability/scenarios/preview", async (route) => {
    counter.count += 1;
    const body = route.request().postDataJSON() as { weights: { equity: string } };
    // The equity weight is what distinguishes the two saved scenarios.
    const isB = Number(body.weights.equity) > 0.3;

    if (isB && options.failB) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            error: "INVALID_SCENARIO_WEIGHTS",
            detail: "가중치 값이 올바르지 않습니다.",
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
        scenario_hash: isB ? "e2e-b" : "e2e-a",
        scenario_hash_short: "e2e",
        method_version: "scenario-v1",
        run_id: 47,
        reference_year: 2024,
        policy_version: "suitability-policy-v2",
        derivation_version: "suitability-screening-v3",
        candidate_grid_version: "capital-grid-500m-v1",
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
  return counter;
}

/** Seed the pair directly: Page 4D's save flow is Page 5A's spec, not this one. */
async function seedScenarios(page: Page, options: { runIdB?: number } = {}): Promise<void> {
  await page.addInitScript(
    ([key, weightsA, weightsB, runIdB]) => {
      const now = "2026-08-13T00:00:00.000Z";
      window.localStorage.setItem(
        key as string,
        JSON.stringify({
          schemaVersion: 1,
          scenarios: [
            {
              schemaVersion: 1,
              id: "e2e-a",
              name: "균형안",
              weights: weightsA,
              runId: 47,
              profileSource: null,
              createdAt: now,
              updatedAt: now,
            },
            {
              schemaVersion: 1,
              id: "e2e-b",
              name: "형평성안",
              weights: weightsB,
              runId: runIdB as number,
              profileSource: null,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
      );
    },
    [STORAGE_KEY, WEIGHTS_A, WEIGHTS_B, options.runIdB ?? 47] as const,
  );
}

async function openComparison(page: Page): Promise<void> {
  await page.goto("/?v=1&mode=suitability&view=scenario&cmpA=e2e-a&cmpB=e2e-b");
}

async function setup(
  page: Page,
  options: { failB?: boolean; runIdB?: number } = {},
): Promise<PreviewCounter> {
  await mockSuitabilityBackend(page);
  const counter = await mockScenarioPreview(page, options);
  await seedScenarios(page, options);
  await openComparison(page);
  return counter;
}

// --------------------------------------------------------------------------- //

test.describe("Page 5B — ranking analytics", () => {
  test("renders the KPI row from the two loaded previews", async ({ page }) => {
    await setup(page);
    const analytics = page.getByTestId("scenario-ranking-analytics");
    await expect(analytics).toBeVisible({ timeout: 20000 });

    // The top candidate changed: both cells are named, neither is a municipality.
    await expect(page.getByTestId("scenario-ranking-kpi-top1-value")).toHaveText("순위 변경");
    const caption = page.getByTestId("scenario-ranking-kpi-top1-caption");
    await expect(caption).toContainText("A안 인천광역시 강화군 · c1");
    await expect(caption).toContainText("B안 인천광역시 강화군 · c4");

    // Exact TOP-10 set overlap, and the scope it applies to.
    await expect(page.getByTestId("scenario-ranking-kpi-retention-value")).toHaveText("7 / 10개");
    await expect(page.getByTestId("scenario-ranking-kpi-retention-caption")).toContainText("70% 유지");

    // Rises and falls, scoped to the common candidates rather than the population.
    await expect(page.getByTestId("scenario-ranking-kpi-rose-value")).toHaveText("9개");
    await expect(page.getByTestId("scenario-ranking-kpi-fell-value")).toHaveText("2개");
    // The tile names the bounded population in the frame's one-line caption density;
    // the scope strip immediately below states the same denominator in full.
    await expect(page.getByTestId("scenario-ranking-kpi-rose")).toContainText(
      "양쪽 공통 11개 기준",
    );

    // The bounded population is stated, not implied.
    await expect(page.getByTestId("scenario-ranking-scope")).toContainText("각각 상위 12개");
    await expect(page.getByTestId("scenario-ranking-scope")).toContainText("1,099개");
  });

  test("states an out-of-preview rank in words, never as a number", async ({ page }) => {
    await setup(page);
    await expect(page.getByTestId("scenario-ranking-analytics")).toBeVisible({ timeout: 20000 });

    // c3 is in A's list only. Both lists are a contiguous 1..12 of 1099, so
    // "B안 상위 12 밖" is a conclusion the contract supports — and it is not a rank.
    const c3 = page.locator('[data-testid="scenario-ranking-table-row"][data-candidate-key="c3"]');
    await expect(c3).toContainText("B안 상위 12 밖");
    await expect(c3.getByTestId("scenario-ranking-table-movement")).toHaveText("—");

    // ...and symmetrically for the candidate only B served.
    const c13 = page.locator('[data-testid="scenario-ranking-table-row"][data-candidate-key="c13"]');
    await expect(c13).toContainText("A안 상위 12 밖");
  });

  test("keeps the movement card to the scatter, with the movement rows in the table", async ({
    page,
  }) => {
    await setup(page);
    const card = page.getByTestId("scenario-ranking-movement-card");
    await expect(card).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("scenario-ranking-scatter")).toBeVisible();

    // The embedded 순위 변화가 큰 후보 구역 list is gone: it restated the comparison
    // table, whose default sort is that same "순위 변화가 큰 순".
    await expect(page.getByTestId("scenario-ranking-movement-row")).toHaveCount(0);

    // The movement it ranked by is still on screen, in the table, in that order.
    const first = page.getByTestId("scenario-ranking-table-row").first();
    await expect(first).toHaveAttribute("data-candidate-key", "c1");
    await expect(first.getByTestId("scenario-ranking-table-movement")).toHaveText("↓ 10계단");
  });

  test("draws the A/B top-10 union, with a real rank for a candidate that left it", async ({
    page,
  }) => {
    await setup(page);
    await expect(page.getByTestId("scenario-ranking-slope")).toBeVisible({ timeout: 20000 });

    // A top 10 (c1..c10) ∪ B top 10 (c4..c13) = 13 cells.
    const slopeRows = page.locator('[data-testid="scenario-ranking-slope-table"] tbody tr');
    await expect(slopeRows).toHaveCount(13);

    // c1 left B's top-10 column but B still served its real rank, so 11위 is shown
    // rather than an out-of-band placeholder.
    const c1 = slopeRows.filter({ has: page.getByRole("rowheader", { name: "c1", exact: true }) });
    await expect(c1).toContainText("11위");
    await expect(c1).toContainText("↓ 10계단");
  });

  test("sorting reorders the same rows and issues no new preview request", async ({ page }) => {
    const counter = await setup(page);
    const table = page.getByTestId("scenario-ranking-table");
    await expect(table).toBeVisible({ timeout: 20000 });

    const keys = () =>
      page
        .getByTestId("scenario-ranking-table-row")
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-candidate-key")));

    const before = await keys();
    expect(before).toHaveLength(13);
    const requestsBefore = counter.count;

    await page.getByTestId("scenario-ranking-table-sort").selectOption("rank_a_asc");
    const after = await keys();

    // Same population, different order, and nothing was fetched to achieve it.
    expect(after).not.toEqual(before);
    expect([...after].sort()).toEqual([...before].sort());
    expect(after[0]).toBe("c1");
    expect(counter.count).toBe(requestsBefore);
    await expect(page.getByTestId("scenario-ranking-table-scope")).toContainText(
      "정렬을 바꿔도 비교 대상 후보 구역은 달라지지 않습니다",
    );
  });

  test("renders no analytics at all when a side is not READY", async ({ page }) => {
    await setup(page, { failB: true });
    // Page 5A's own error surface is present...
    await expect(page.getByTestId("scenario-comparison-status")).toBeVisible({ timeout: 20000 });
    // ...and Page 5B adds nothing beneath it. Stale numbers under a fresh error
    // would be worse than no numbers.
    await expect(page.getByTestId("scenario-ranking-analytics")).toHaveCount(0);
    await expect(page.getByTestId("scenario-ranking-kpis")).toHaveCount(0);
  });

  test("renders no analytics for a scenario saved against another run", async ({ page }) => {
    await setup(page, { runIdB: 46 });
    await expect(page.getByTestId("scenario-comparison-side-other-run")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByTestId("scenario-ranking-analytics")).toHaveCount(0);
  });

  test("uses none of the frame's screening or threshold vocabulary", async ({ page }) => {
    await setup(page);
    await expect(page.getByTestId("scenario-ranking-analytics")).toBeVisible({ timeout: 20000 });
    const text = (await page.getByTestId("scenario-ranking-analytics").textContent()) ?? "";
    for (const phrase of [
      "통과 지역",
      "신규 통과",
      "새롭게 통과",
      "60점",
      "62점",
      "주민 반응",
      "장래 쓰레기 발생량",
      "최적 지역",
      "999",
    ]) {
      expect(text).not.toContain(phrase);
    }
  });

  test("keeps the page free of horizontal overflow at 1440", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await setup(page);
    await expect(page.getByTestId("scenario-ranking-analytics")).toBeVisible({ timeout: 20000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
});
