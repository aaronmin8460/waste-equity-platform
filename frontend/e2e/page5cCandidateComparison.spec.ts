import { expect, test, type Page } from "@playwright/test";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * PAGE 5C — the selected candidate, its A/B contributions, the A/B map, and the export.
 *
 * The unit tests cover the model and the states against jsdom. What only a real
 * browser can demonstrate is that the whole path holds end to end: two scenarios are
 * saved through the REAL Page-4 flow, selected into A/B, and the resulting Page-5
 * screen requests ONE candidate detail per side, renders the SERVED contributions,
 * switches the map between two real scenario tile URLs on ONE map instance, and
 * writes a workbook the browser actually downloads.
 *
 * Self-mocked through `suitabilityFixtures.mockSuitabilityBackend` plus the two
 * scenario routes below: no backend, no database, no tile server, no government API.
 * Every fixture is SYNTHETIC and carries no official evidence label.
 *
 * Playwright's own Chromium is not installed in this environment, so this runs on the
 * installed Chrome channel (matching page4dScenarios.spec.ts / page5aComparison.spec.ts).
 */

test.use({ channel: "chrome" });

/** Run 47's baseline weights, canonicalised — Z 40 / R 30 / E 20 / D 10. */
const CANONICAL_BASELINE = "0.40000000";
/** The 형평성 중심 basis — Z 20 / R 20 / E 40 / D 20. */
const CANONICAL_EQUITY = "0.20000000";

const CELL_KEY = "c-701";

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
            candidate_key: CELL_KEY,
            sido_region_code: "KR-SGIS-23",
            sido_region_name: "인천",
            sigungu_region_code: "KR-SGIS-23710",
            sigungu_region_name: "강화군",
            custom_score: isA ? "88.1234" : "84.5000",
            custom_rank: isA ? 1 : 2,
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

/**
 * The candidate-detail endpoint Page 5C reads its contributions from.
 *
 * It returns the SERVED product `component_score × weight` for whichever weights it
 * is given — the real backend's `_contributions` behaviour — so the screen's numbers
 * are the endpoint's, exactly as in production.
 */
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
        candidate_id: 701,
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
        comparison_score: "88.1234",
        comparison_rank: 1,
        rank_delta: 0,
        rank_change_direction: "same",
        zoning_score: "80.0000",
        road_score: "90.0000",
        equity_score: "100.0000",
        demand_score: "60.0000",
        contributions: [
          { component: "zoning", component_score: "80.0000", weight: w.zoning.toFixed(8), weighted_contribution: contribution("zoning") },
          { component: "road", component_score: "90.0000", weight: w.road.toFixed(8), weighted_contribution: contribution("road") },
          { component: "equity", component_score: "100.0000", weight: w.equity.toFixed(8), weighted_contribution: contribution("equity") },
          { component: "demand", component_score: "60.0000", weight: w.demand.toFixed(8), weighted_contribution: contribution("demand") },
        ],
        stable_count: null,
        stability_class: null,
        stability_membership: {},
        profile_totals: {},
        profile_ranks: {},
        sido_region_code: "KR-SGIS-23",
        sido_region_name: "인천",
        sigungu_region_code: "KR-SGIS-23710",
        sigungu_region_name: "강화군",
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

/** Reach Page 5 with a READY comparison and pick the served candidate. */
async function openPage5(page: Page): Promise<void> {
  await saveAndSelectPair(page);
  await page.getByTestId("scenario-compare-cta").click();
  await expect(page.getByTestId("scenario-candidate-comparison")).toBeVisible({ timeout: 20000 });
}

async function pickCandidate(page: Page): Promise<void> {
  await page.getByTestId("scenario-candidate-picker").selectOption({ index: 1 });
  await expect(page.getByTestId("scenario-candidate-contribution")).toBeVisible({ timeout: 20000 });
}

test.beforeEach(async ({ page }) => {
  await mockSuitabilityBackend(page);
  await mockScenarioPreview(page);
  await mockCandidateDetail(page);
});

test.describe("selected candidate + contributions", () => {
  test("prompts for a candidate rather than choosing one", async ({ page }) => {
    await openPage5(page);
    await expect(page.getByTestId("scenario-candidate-empty")).toBeVisible();
    await expect(page.getByTestId("scenario-candidate-contribution")).toHaveCount(0);
    await expect(page.getByTestId("scenario-candidate-export")).toBeDisabled();
  });

  test("renders the SERVED contributions for both sides, with an exact delta", async ({ page }) => {
    await openPage5(page);
    await pickCandidate(page);

    const equity = page.getByTestId("scenario-candidate-contribution-row-equity");
    // E: 100 × 0.20 = 20.0000 under A안, 100 × 0.40 = 40.0000 under B안.
    await expect(equity.getByTestId("scenario-candidate-contribution-a")).toContainText("20.0000");
    await expect(equity.getByTestId("scenario-candidate-contribution-b")).toContainText("40.0000");
    await expect(equity.getByTestId("scenario-candidate-contribution-delta")).toContainText("+20.0000");
    // The largest |Δ| is E's +20, so it is the named factor — descriptively.
    const impact = page.getByTestId("scenario-candidate-major-impact");
    await expect(impact).toContainText("기존 지역 부담");
    await expect(impact).not.toContainText("때문에");
  });

  test("keeps the candidate identity and the four model factors", async ({ page }) => {
    await openPage5(page);
    await pickCandidate(page);
    await expect(page.getByTestId("scenario-candidate-side-a").getByTestId("scenario-candidate-side-key")).toContainText(
      CELL_KEY,
    );
    const table = page.getByTestId("scenario-candidate-contribution");
    for (const mock of ["시설부담 정도", "장래 쓰레기 발생량", "주민 반응"]) {
      await expect(table).not.toContainText(mock);
    }
  });
});

test.describe("the A/B map", () => {
  test("switches between two REAL scenario tile URLs on ONE map instance", async ({ page }) => {
    await openPage5(page);
    await pickCandidate(page);

    // Every scenario tile request the browser actually makes, in order.
    const tileRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/suitability/scenarios/tiles/")) tileRequests.push(request.url());
    });

    await expect(page.getByTestId("scenario-map-toggle-a")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("scenario-map-toggle-b").click();
    await expect(page.getByTestId("scenario-map-toggle-b")).toHaveAttribute("aria-pressed", "true");

    // ONE map canvas throughout: the source is re-pointed, not remounted.
    await expect(page.getByTestId("scenario-map-canvas")).toHaveCount(1);
    await expect(page.locator(".maplibregl-canvas")).toHaveCount(1);

    await expect
      .poll(() => tileRequests.some((url) => url.includes(`wz=${CANONICAL_EQUITY}`)), { timeout: 15000 })
      .toBe(true);
    // The hash travels with the weights — the tile is fully determined by its URL.
    expect(tileRequests.every((url) => url.includes("scenario_hash="))).toBe(true);
  });

  test("preserves the selected candidate across the toggle", async ({ page }) => {
    await openPage5(page);
    await pickCandidate(page);
    await page.getByTestId("scenario-map-toggle-b").click();
    await expect(page.getByTestId("scenario-candidate-picker")).toHaveValue("701");
    await expect(page.getByTestId("scenario-candidate-contribution")).toBeVisible();
    await expect(page.getByTestId("scenario-candidate-side-a").getByTestId("scenario-candidate-side-key")).toContainText(
      CELL_KEY,
    );
  });

  test("keeps the screening legend, and invents no A/B pass/fail categories", async ({ page }) => {
    await openPage5(page);
    const card = page.getByTestId("scenario-map");
    await expect(page.getByTestId("scenario-map-note")).toContainText("규칙 기반");
    for (const invented of ["신규 통과", "통과 유지", "통과 → 제외", "양쪽 제외"]) {
      await expect(card).not.toContainText(invented);
    }
  });
});

test.describe("export", () => {
  test("downloads a single-candidate comparison workbook", async ({ page }) => {
    await openPage5(page);
    await pickCandidate(page);

    const download = page.waitForEvent("download");
    await page.getByTestId("scenario-candidate-export").click();
    const file = await download;
    // The filename states the run, the cell and the scope — no page around it needed.
    expect(file.suggestedFilename()).toContain("run47");
    expect(file.suggestedFilename()).toContain(CELL_KEY);
    expect(file.suggestedFilename()).toContain("단일후보");
    expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test("states the export scope on the page, not only in the file", async ({ page }) => {
    await openPage5(page);
    await pickCandidate(page);
    const scope = page.getByTestId("scenario-candidate-export-scope");
    await expect(scope).toContainText("후보 구역 1곳");
    await expect(scope).not.toContainText("전체 후보 비교");
  });
});

test.describe("Page 5A is undisturbed", () => {
  test("writes nothing to localStorage while Page 5C is on screen", async ({ page }) => {
    await openPage5(page);
    const before = await page.evaluate(() => JSON.stringify(window.localStorage));
    await pickCandidate(page);
    await page.getByTestId("scenario-map-toggle-b").click();
    const after = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(after).toBe(before);
    // And no derived result reached the URL either.
    expect(page.url()).not.toContain("score");
  });
});
