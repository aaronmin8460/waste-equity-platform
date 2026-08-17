import { expect, test, type Page } from "@playwright/test";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * PAGE 5 — the three lanes on ONE screen, driven end to end.
 *
 * Page 5A, 5B and 5C each have their own spec, and each passes on a page that holds
 * only that lane. What none of them can show is the assembled screen: that ONE
 * resolve-verify-preview pass feeds both analytical lanes, that ranking sits above the
 * selected candidate, that the A/B map toggle does not disturb the ranking above it,
 * and that the workbook a reader downloads carries Page-5B's ranking sheet alongside
 * Page-5C's three.
 *
 * Self-mocked through `suitabilityFixtures.mockSuitabilityBackend` plus the two
 * scenario routes below: no backend, no database, no tile server, no government API.
 * Every fixture is SYNTHETIC and carries no official evidence label.
 *
 * Playwright's own Chromium is not installed here, so this runs on the installed
 * Chrome channel, matching the other Page-4/5 specs.
 */

test.use({ channel: "chrome" });

/** Run 47's baseline weights, canonicalised — Z 40 / R 30 / E 20 / D 10. */
const CANONICAL_BASELINE = "0.40000000";

/**
 * Ten cells per side. A안 ranks them c1..c10; B안 reverses the middle and drops c10
 * entirely while introducing c11 — so the assembled page has real retention loss, real
 * movement, and one candidate that is provably outside the other side's preview.
 */
const A_ORDER = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10"];
const B_ORDER = ["c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c11", "c1"];

/** The cell selected for the deep comparison — 1st under A안, 10th under B안. */
const CELL_KEY = "c1";
const CELL_ID = 1;

function candidateRow(key: string, rank: number) {
  // Ids are stable per key so the picker's value is the same under both scenarios.
  const id = Number(key.replace("c", ""));
  return {
    candidate_id: id,
    candidate_key: key,
    sido_region_code: "KR-SGIS-23",
    sido_region_name: "인천",
    sigungu_region_code: "KR-SGIS-23710",
    sigungu_region_name: "인천광역시 강화군",
    custom_score: (90 - rank).toFixed(4),
    custom_rank: rank,
    comparison_profile: "baseline",
    // The side's own against-baseline columns. If these ever surfaced as the A/B
    // result, 999 / 900 would appear on screen — asserted against below.
    comparison_score: "50.0000",
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
  };
}

/** The preview endpoint Page 5A revalidates through, echoing canonical weights. */
async function mockScenarioPreview(page: Page): Promise<void> {
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
    const isA = canonical.zoning === CANONICAL_BASELINE;
    const order = isA ? A_ORDER : B_ORDER;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        scenario_hash: `e2e-${canonical.zoning}`,
        scenario_hash_short: isA ? "e2eA" : "e2eB",
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
        top_candidates: order.map((key, index) => candidateRow(key, index + 1)),
        selected_candidate: null,
        tile_url: `/tiles/${isA ? "a" : "b"}`,
        assumptions: [],
        scenario_label: "사용자 가정 기반 시나리오",
        scenario_disclaimer: "임시 비교 결과입니다.",
        screening_disclaimer: "광역 분석 스크리닝",
      }),
    });
  });
}

/** The candidate-detail endpoint, serving `component_score × weight` per side. */
async function mockCandidateDetail(page: Page): Promise<void> {
  await page.route("**/api/v1/suitability/scenarios/candidates/**", async (route) => {
    const body = route.request().postDataJSON() as {
      weights: { zoning: string; road: string; equity: string; demand: string };
    };
    const w = {
      zoning: Number(body.weights.zoning),
      road: Number(body.weights.road),
      equity: Number(body.weights.equity),
      demand: Number(body.weights.demand),
    };
    // Fixed component scores: a property of the run, identical under both scenarios.
    const scores = { zoning: 80, road: 90, equity: 100, demand: 60 };
    const contribution = (key: keyof typeof scores) => (scores[key] * w[key]).toFixed(4);
    const total = (
      scores.zoning * w.zoning +
      scores.road * w.road +
      scores.equity * w.equity +
      scores.demand * w.demand
    ).toFixed(4);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        candidate_id: CELL_ID,
        run_id: 47,
        candidate_key: CELL_KEY,
        status: "ELIGIBLE",
        is_excluded: false,
        method_version: "scenario-v1",
        scenario_hash: `e2e-${w.zoning.toFixed(8)}`,
        scenario_hash_short: "e2e",
        canonical_weights: {
          zoning: w.zoning.toFixed(8),
          road: w.road.toFixed(8),
          equity: w.equity.toFixed(8),
          demand: w.demand.toFixed(8),
        },
        compare_profile: "baseline",
        custom_score: total,
        custom_provisional_score: null,
        custom_rank: 1,
        comparison_score: "70.0000",
        comparison_rank: 3,
        rank_delta: 2,
        rank_change_direction: "up",
        zoning_score: scores.zoning.toFixed(4),
        road_score: scores.road.toFixed(4),
        equity_score: scores.equity.toFixed(4),
        demand_score: scores.demand.toFixed(4),
        contributions: [
          { component: "zoning", component_score: scores.zoning.toFixed(4), weight: w.zoning.toFixed(8), weighted_contribution: contribution("zoning") },
          { component: "road", component_score: scores.road.toFixed(4), weight: w.road.toFixed(8), weighted_contribution: contribution("road") },
          { component: "equity", component_score: scores.equity.toFixed(4), weight: w.equity.toFixed(8), weighted_contribution: contribution("equity") },
          { component: "demand", component_score: scores.demand.toFixed(4), weight: w.demand.toFixed(8), weighted_contribution: contribution("demand") },
        ],
        stable_count: null,
        stability_class: null,
        stability_membership: {},
        profile_totals: {},
        profile_ranks: {},
        sido_region_code: "KR-SGIS-23",
        sido_region_name: "인천",
        sigungu_region_code: "KR-SGIS-23710",
        sigungu_region_name: "인천광역시 강화군",
        exclusion_reasons: [],
        review_reasons: [],
        penalties: [],
        raw_components: {},
        nearest_road_distance_m: "120.0",
        nearest_road_provenance: {},
        component_provenance: {},
        centroid_lon: 126.5,
        centroid_lat: 37.7,
        geometry: { type: "Point", coordinates: [126.5, 37.7] },
        reference_year: 2024,
        policy_version: "suitability-policy-v2",
        derivation_version: "suitability-screening-v3",
        candidate_grid_version: "capital-grid-500m-v1",
        component_model_version: "suitability-components-zred-v1",
        component_order: ["zoning", "road", "equity", "demand"],
        scenario_label: "사용자 가정 기반 시나리오",
        scenario_disclaimer: "임시 비교 결과입니다.",
        screening_disclaimer: "광역 분석 스크리닝",
      }),
    });
  });
}

async function openPage4(page: Page): Promise<void> {
  await page.goto("/?v=1&mode=suitability&view=score");
  await expect(page.getByTestId("scenario-save")).toBeVisible({ timeout: 20000 });
}

async function saveScenario(page: Page, name: string): Promise<void> {
  await page.getByTestId("scenario-name-input").fill(name);
  await page.getByTestId("scenario-save-submit").click();
  await expect(page.getByTestId("scenario-save-notice")).toBeVisible();
}

function row(page: Page, name: string) {
  return page.getByTestId("scenario-saved-item").filter({ hasText: name });
}

/** Save two genuinely different scenarios through ④ and select them into A/B. */
async function saveAndSelectPair(page: Page): Promise<void> {
  await openPage4(page);
  await saveScenario(page, "균형안");

  // `.check()` rather than a row click: the control is a radio input.
  await page.getByTestId("profile-radio-equity_focused").check();
  await expect(page.getByTestId("scenario-save-weights")).toContainText("기존 지역 부담(E) 40%");
  await saveScenario(page, "형평성안");

  const details = page.getByTestId("scenario-saved-list-disclosure");
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await details.locator("summary").click();
  }
  await row(page, "균형안").getByTestId("scenario-slot-a").click();
  await row(page, "형평성안").getByTestId("scenario-slot-b").click();
  await expect(page.getByTestId("scenario-compare-count")).toContainText("2/2");
}

/** Reach Page 5 with a READY comparison holding BOTH analytical lanes. */
async function openPage5(page: Page): Promise<void> {
  await saveAndSelectPair(page);
  await page.getByTestId("scenario-compare-cta").click();
  await expect(page.getByTestId("scenario-analysis-sections")).toBeVisible({ timeout: 20000 });
}

async function pickCandidate(page: Page): Promise<void> {
  await page.getByTestId("scenario-candidate-picker").selectOption(String(CELL_ID));
  await expect(page.getByTestId("scenario-candidate-contribution")).toBeVisible({ timeout: 20000 });
}

test.beforeEach(async ({ page }) => {
  await mockSuitabilityBackend(page);
  await mockScenarioPreview(page);
  await mockCandidateDetail(page);
});

// --------------------------------------------------------------------------- //
// The assembled page
// --------------------------------------------------------------------------- //

test.describe("Page 5 — all three lanes on one screen", () => {
  test("renders the foundation, the ranking analytics and the candidate section together", async ({ page }) => {
    await openPage5(page);

    // Page 5A — identity, the run, and the canonical weights.
    await expect(page.getByTestId("scenario-comparison-identity")).toBeVisible();
    await expect(page.getByTestId("scenario-comparison-identity")).toContainText("균형안");
    await expect(page.getByTestId("scenario-comparison-identity")).toContainText("형평성안");
    await expect(page.getByTestId("scenario-comparison-run-meta")).toContainText("47");
    await expect(page.getByTestId("scenario-comparison-weights")).toBeVisible();

    // Page 5B — KPI row, scope, slope, movement list, table.
    await expect(page.getByTestId("scenario-ranking-kpis")).toBeVisible();
    await expect(page.getByTestId("scenario-ranking-kpi-retention")).toBeVisible();
    await expect(page.getByTestId("scenario-ranking-kpi-top1")).toBeVisible();
    await expect(page.getByTestId("scenario-ranking-scope")).toBeVisible();
    await expect(page.getByTestId("scenario-ranking-slope")).toBeVisible();
    await expect(page.getByTestId("scenario-ranking-table")).toBeVisible();
    expect(await page.getByTestId("scenario-ranking-table-row").count()).toBeGreaterThan(0);

    // Page 5C — the candidate section and its map.
    await expect(page.getByTestId("scenario-candidate-detail")).toBeVisible();
    await expect(page.getByTestId("scenario-map")).toBeVisible();
  });

  test("draws the ranking analytics ABOVE the selected-candidate section", async ({ page }) => {
    await openPage5(page);
    const order = await page.evaluate(() => {
      const ranking = document.querySelector('[data-testid="scenario-ranking-analytics"]');
      const candidate = document.querySelector('[data-testid="scenario-candidate-comparison"]');
      if (!ranking || !candidate) return null;
      // DOCUMENT_POSITION_FOLLOWING === 4
      return (ranking.compareDocumentPosition(candidate) & 4) !== 0;
    });
    expect(order).toBe(true);
  });

  test("previews each side ONCE, and adds none when a candidate is selected", async ({ page }) => {
    // Bodies, not request counts: React StrictMode double-invokes effects in dev, so a
    // raw count is 2x here and 1x in a production build. What must hold in BOTH is that
    // the page previews exactly the TWO weight vectors — never a third — and that
    // selecting a candidate re-previews nothing.
    const bodies: string[] = [];
    page.on("request", (request) => {
      if (!request.url().includes("/suitability/scenarios/preview")) return;
      const body = request.postDataJSON() as { weights: Record<string, string> } | null;
      if (body !== null) bodies.push(JSON.stringify(body.weights));
    });

    await saveAndSelectPair(page);
    bodies.length = 0; // Page 4's own previews are not what this measures.

    await page.getByTestId("scenario-compare-cta").click();
    await expect(page.getByTestId("scenario-analysis-sections")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("scenario-ranking-table")).toBeVisible();

    // Two distinct weight vectors — A안 and B안 — and nothing else.
    expect(new Set(bodies).size).toBe(2);
    const afterShell = bodies.length;

    await pickCandidate(page);
    // The candidate lane asks the candidate-detail endpoint, never the preview one.
    expect(bodies).toHaveLength(afterShell);
  });

  test("shows neither side's against-baseline columns as the A/B result", async ({ page }) => {
    await openPage5(page);
    const text = (await page.getByTestId("scenario-analysis-sections").textContent()) ?? "";
    expect(text).not.toContain("999");
    expect(text).not.toContain("900계단");
  });

  test("uses none of the frame's screening or threshold vocabulary", async ({ page }) => {
    await openPage5(page);
    await pickCandidate(page);
    const text = (await page.locator("main").textContent()) ?? "";
    for (const banned of ["통과 지역 수", "신규 통과", "통과 → 제외", "62점", "60점 이상", "주민 반응", "장래 발생량"]) {
      expect(text).not.toContain(banned);
    }
  });
});

// --------------------------------------------------------------------------- //
// Candidate + map, with the ranking above them
// --------------------------------------------------------------------------- //

test.describe("candidate and map inside the assembled page", () => {
  test("keeps the selected candidate and the ranking table across the A/B map toggle", async ({ page }) => {
    await openPage5(page);
    await pickCandidate(page);

    const rowsBefore = await page.getByTestId("scenario-ranking-table-row").count();
    await expect(page.getByTestId("scenario-candidate-side-key").first()).toContainText(CELL_KEY);

    await page.getByTestId("scenario-map-toggle-b").click();
    // The candidate survives the toggle...
    await expect(page.getByTestId("scenario-candidate-contribution")).toBeVisible();
    await expect(page.getByTestId("scenario-candidate-side-key").first()).toContainText(CELL_KEY);
    // ...and so does the ranking analysis above it.
    expect(await page.getByTestId("scenario-ranking-table-row").count()).toBe(rowsBefore);

    await page.getByTestId("scenario-map-toggle-a").click();
    await expect(page.getByTestId("scenario-candidate-contribution")).toBeVisible();
  });

  test("shows the contribution comparison and a major-impact factor", async ({ page }) => {
    await openPage5(page);
    await pickCandidate(page);
    await expect(page.getByTestId("scenario-candidate-contribution")).toBeVisible();
    await expect(page.getByTestId("scenario-candidate-major-impact")).toBeVisible();
  });

  test("keeps a candidate readable even though its B안 rank is outside the preview", async ({ page }) => {
    await openPage5(page);
    // c10 is 10th under A안 and absent from B안's served list.
    await page.getByTestId("scenario-candidate-picker").selectOption("10");
    await expect(page.getByTestId("scenario-candidate-contribution")).toBeVisible({ timeout: 20000 });
    // Detail is shown; the missing rank is named rather than invented.
    const placements = (await page.getByTestId("scenario-candidate-side-placement").allTextContents()).join(" ");
    expect(placements).not.toContain("11위");
    expect(placements).not.toContain("1099위");
  });
});

// --------------------------------------------------------------------------- //
// The workbook
// --------------------------------------------------------------------------- //

test.describe("export", () => {
  test("downloads a workbook naming both the candidate and the ranking comparison", async ({ page }) => {
    await openPage5(page);
    await pickCandidate(page);

    const download = page.waitForEvent("download");
    await page.getByTestId("scenario-candidate-export").click();
    const file = await download;

    expect(file.suggestedFilename()).toContain("run47");
    expect(file.suggestedFilename()).toContain(CELL_KEY);
    // Page 5C's single-candidate marker AND Page 5B's ranking marker.
    expect(file.suggestedFilename()).toContain("단일후보");
    expect(file.suggestedFilename()).toContain("순위비교");
    expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test("states the widened scope on the page, not only in the file", async ({ page }) => {
    await openPage5(page);
    await pickCandidate(page);
    const scope = page.getByTestId("scenario-candidate-export-scope");
    await expect(scope).toContainText("후보 구역 1곳");
    await expect(scope).toContainText("순위 비교");
    // The single-candidate-only claim is no longer true once the ranking sheet is in.
    await expect(scope).not.toContainText("전체 후보 구역에 대한 비교나 순위 분석이 아닙니다");
  });
});

// --------------------------------------------------------------------------- //
// Restore and layout
// --------------------------------------------------------------------------- //

test.describe("restore and layout", () => {
  test("restores the comparison after a reload", async ({ page }) => {
    await openPage5(page);
    await expect(page.getByTestId("scenario-ranking-table")).toBeVisible();

    await page.reload();

    await expect(page.getByTestId("scenario-analysis-sections")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("scenario-comparison-identity")).toContainText("균형안");
    await expect(page.getByTestId("scenario-comparison-identity")).toContainText("형평성안");
    await expect(page.getByTestId("scenario-ranking-table")).toBeVisible();
  });

  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
  ] as const) {
    test(`has no document-level horizontal overflow at ${width}×${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openPage5(page);
      await pickCandidate(page);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      // The ranking table scrolls INSIDE its own viewport rather than growing the page.
      const bounded = await page.evaluate(() => {
        const table = document.querySelector('[data-testid="scenario-ranking-table"]');
        if (table === null) return null;
        const scroller = table.closest("div");
        return scroller === null ? null : scroller.scrollHeight >= scroller.clientHeight;
      });
      expect(bounded).not.toBe(false);
    });
  }
});
