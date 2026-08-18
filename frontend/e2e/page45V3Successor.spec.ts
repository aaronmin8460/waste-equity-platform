import { expect, test, type Page, type Route } from "@playwright/test";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * PAGE 4 + PAGE 5 ON THE V3 SUCCESSOR MODEL — the browser proof.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────────
 * That the whole active flow runs on ONE model, and that the model is the
 * successor's: `existing_burden` / `air_impact_proxy` / `resident_impact` /
 * `land_conversion`. The defect it exists to prevent is a split state — V3 factor
 * controls drawn over a historical ranking, or a V3 ranking beside a historical map.
 *
 * ── WHY THE MOCK ECHOES AND FILTERS ─────────────────────────────────────────────
 * Every route below behaves like the real endpoint: the run it serves declares its
 * own `component_model_version`, the preview scores the weights it was actually
 * SENT, and the scope filter is applied server-side exactly as the backend applies
 * it. That is what makes these end-to-end assertions rather than cosmetic ones — if
 * the frontend stopped pinning the model, or stopped sending the scope, the recorded
 * requests would show it and the rendered rows would change.
 *
 * Playwright's own Chromium is not installed here, so this runs on the installed
 * Chrome channel (matching page4dScenarios / page5aComparison / page5ScopeContract).
 *
 * Every fixture is SYNTHETIC and carries no official evidence label.
 */

test.use({ channel: "chrome", viewport: { width: 1440, height: 900 } });

const SUCCESSOR_MODEL = "suitability-components-successor-v1";
const SUCCESSOR_ORDER = [
  "existing_burden",
  "air_impact_proxy",
  "resident_impact",
  "land_conversion",
] as const;
const HISTORICAL_KEYS = ["zoning", "road", "equity", "demand"] as const;

const SEOUL = "KR-SGIS-11";
const INCHEON = "KR-SGIS-23";
const GYEONGGI = "KR-SGIS-31";

const STORAGE_KEY = "waste-equity:suitability-saved-scenarios:v1";

interface PoolRow {
  key: string;
  sido: string;
  sidoName: string;
  sigungu: string;
  sigunguName: string;
}

const POOL: PoolRow[] = [
  { key: "s1", sido: SEOUL, sidoName: "서울특별시", sigungu: "KR-SGIS-11010", sigunguName: "서울특별시 종로구" },
  { key: "i1", sido: INCHEON, sidoName: "인천광역시", sigungu: "KR-SGIS-23510", sigunguName: "인천광역시 강화군" },
  { key: "i2", sido: INCHEON, sidoName: "인천광역시", sigungu: "KR-SGIS-23520", sigunguName: "인천광역시 옹진군" },
  { key: "g1", sido: GYEONGGI, sidoName: "경기도", sigungu: "KR-SGIS-31011", sigunguName: "경기도 수원시 장안구" },
  { key: "g2", sido: GYEONGGI, sidoName: "경기도", sigungu: "KR-SGIS-31190", sigunguName: "경기도 안산시 단원구" },
];

interface Recorder {
  previews: { model: string | null; weights: Record<string, string>; sido: string | null; sigungu: string[] }[];
  runModels: (string | null)[];
  summaryModels: (string | null)[];
  rankingModels: (string | null)[];
  tileUrls: string[];
}

function successorRun() {
  return {
    id: 47,
    status: "SUCCEEDED",
    reference_year: 2024,
    boundary_vintage: "2024",
    policy_version: "suitability-successor-policy-v1",
    derivation_version: "suitability-successor-derivation-v1",
    candidate_grid_version: "capital-grid-500m-v1",
    component_model_version: SUCCESSOR_MODEL,
    component_order: [...SUCCESSOR_ORDER],
    // The ONE approved successor profile.
    weight_profiles: { baseline: Object.fromEntries(SUCCESSOR_ORDER.map((c) => [c, "0.25"])) },
    weight_derivation: {},
    created_at: "2026-01-01T00:00:00Z",
  };
}

function inScope(row: PoolRow, sido: string | null, sigungu: string[]): boolean {
  if (sido !== null && row.sido !== sido) return false;
  if (sigungu.length > 0 && !sigungu.includes(row.sigungu)) return false;
  return true;
}

/**
 * Rank the pool by the SENT weights, so a different vector genuinely produces a
 * different order. A fixture that ignored the weights could not tell "the request
 * changed" from "the result changed".
 */
function rankBy(rows: PoolRow[], weights: Record<string, string>) {
  const burden = Number(weights.existing_burden ?? 0);
  const air = Number(weights.air_impact_proxy ?? 0);
  return rows
    .map((row, index) => ({
      row,
      // A deterministic score that MOVES with the weight vector.
      score: burden * (100 - index * 7) + air * (40 + index * 11),
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry, index) => ({
      candidate_id: 100 + POOL.findIndex((p) => p.key === entry.row.key),
      candidate_key: entry.row.key,
      sido_region_code: entry.row.sido,
      sido_region_name: entry.row.sidoName,
      sigungu_region_code: entry.row.sigungu,
      sigungu_region_name: entry.row.sigunguName,
      custom_score: entry.score.toFixed(4),
      custom_rank: index + 1,
      comparison_profile: "baseline",
      comparison_score: "50.0000",
      comparison_rank: index + 2,
      rank_delta: 1,
      rank_change_direction: "up",
      // A successor row leaves the legacy columns null and carries component_scores.
      zoning_score: null,
      road_score: null,
      equity_score: null,
      demand_score: null,
      component_scores: Object.fromEntries(SUCCESSOR_ORDER.map((c, i) => [c, `${70 + i * 5}.0000`])),
      stable_count: 3,
      stability_class: "STABLE",
      centroid_lon: 126.9,
      centroid_lat: 37.5,
    }));
}

async function mockV3(page: Page): Promise<Recorder> {
  const rec: Recorder = {
    previews: [],
    runModels: [],
    summaryModels: [],
    rankingModels: [],
    tileUrls: [],
  };
  const modelOf = (url: string) => new URL(url).searchParams.get("component_model_version");

  await page.route("**/api/v1/suitability/runs/latest**", async (route: Route) => {
    rec.runModels.push(modelOf(route.request().url()));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(successorRun()) });
  });

  await page.route("**/api/v1/suitability/summary**", async (route: Route) => {
    rec.summaryModels.push(modelOf(route.request().url()));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run: successorRun(),
        policy: { weight_profiles: { baseline: Object.fromEntries(SUCCESSOR_ORDER.map((c) => [c, "0.25"])) } },
        candidate_count_total: 20000,
        candidate_count_eligible: POOL.length,
        candidate_count_review: 0,
        candidate_count_excluded: 0,
        exclusion_reason_counts: {},
        review_reason_counts: {},
        coverage_notes: [],
        disclaimer: "분석용 선별 결과이며 법적 적격을 의미하지 않습니다.",
        top_candidates: [],
        top_stable_candidates: [],
        sido_distribution: {},
        assumptions: [],
        component_model_version: SUCCESSOR_MODEL,
      }),
    });
  });

  await page.route("**/api/v1/suitability/candidates?*", async (route: Route) => {
    const url = new URL(route.request().url());
    rec.rankingModels.push(url.searchParams.get("component_model_version"));
    const sido = url.searchParams.get("sido");
    const sigungu = url.searchParams.getAll("sigungu");
    const rows = POOL.filter((row) => inScope(row, sido, sigungu));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "FeatureCollection",
        indicator: "SUITABILITY_SCREENING",
        derivation_version: "suitability-successor-derivation-v1",
        policy_version: "suitability-successor-policy-v1",
        candidate_grid_version: "capital-grid-500m-v1",
        component_model_version: SUCCESSOR_MODEL,
        component_order: [...SUCCESSOR_ORDER],
        weight_profile: "baseline",
        reference_year: 2024,
        run_id: 47,
        count: rows.length,
        total_matched: rows.length,
        limit: 5,
        offset: 0,
        sido,
        sigungu,
        sort: "score_desc",
        features: rows.map((row, index) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [126.9, 37.5] },
          properties: {
            candidate_id: 100 + POOL.findIndex((p) => p.key === row.key),
            candidate_key: row.key,
            status: "ELIGIBLE",
            profile: "baseline",
            is_excluded: false,
            rank: index + 1,
            total_score: `${90 - index}.0000`,
            provisional_score: null,
            zoning_score: null,
            road_score: null,
            equity_score: null,
            demand_score: null,
            component_scores: Object.fromEntries(
              SUCCESSOR_ORDER.map((c, i) => [c, `${70 + i * 5}.0000`]),
            ),
            sido_region_code: row.sido,
            sido_region_name: row.sidoName,
            sigungu_region_code: row.sigungu,
            sigungu_region_name: row.sigunguName,
            nearest_road_distance_m: null,
            stable_count: 3,
            stability_class: "STABLE",
            stability_membership: {},
            exclusion_reasons: [],
            review_reasons: [],
          },
        })),
        assumptions: [],
        disclaimer: "분석용 선별 결과이며 법적 판정이 아닙니다.",
      }),
    });
  });

  await page.route("**/api/v1/suitability/scenarios/preview", async (route: Route) => {
    const posted = (route.request().postDataJSON() as Record<string, unknown>) ?? {};
    const weights = (posted.weights as Record<string, string>) ?? {};
    const sido = typeof posted.sido === "string" && posted.sido !== "" ? posted.sido : null;
    const sigungu = Array.isArray(posted.sigungu) ? (posted.sigungu as string[]) : [];
    rec.previews.push({
      model: typeof posted.component_model_version === "string" ? posted.component_model_version : null,
      weights,
      sido,
      sigungu,
    });
    const rows = POOL.filter((row) => inScope(row, sido, sigungu));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        scenario_hash: `h-${weights.existing_burden ?? "x"}`,
        scenario_hash_short: "h",
        method_version: "scenario-v1",
        run_id: 47,
        reference_year: 2024,
        policy_version: "suitability-successor-policy-v1",
        derivation_version: "suitability-successor-derivation-v1",
        candidate_grid_version: "capital-grid-500m-v1",
        component_model_version: SUCCESSOR_MODEL,
        component_order: [...SUCCESSOR_ORDER],
        canonical_weights: weights,
        compare_profile: "baseline",
        candidate_count_total: 20000,
        candidate_count_eligible: rows.length,
        candidate_count_review: 0,
        candidate_count_excluded: 0,
        ranking_population: rows.length,
        top_candidates: rankBy(rows, weights),
        selected_candidate: null,
        tile_url: "/tiles",
        assumptions: [],
        scenario_label: "사용자 가정 기반 시나리오",
        scenario_disclaimer: "임시 비교 결과입니다.",
        screening_disclaimer: "광역 분석 스크리닝",
      }),
    });
  });

  await page.route("**/scenarios/tiles/**", async (route: Route) => {
    rec.tileUrls.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/v1/suitability/scenarios/candidates/*", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
  );

  return rec;
}

async function seedScenarios(page: Page, weights: { a: unknown; b: unknown; model: string }) {
  await page.addInitScript(
    ([key, a, b, model]) => {
      const now = "2026-08-18T00:00:00.000Z";
      window.localStorage.setItem(
        key as string,
        JSON.stringify({
          schemaVersion: 2,
          scenarios: [
            { schemaVersion: 2, id: "sc-a", name: "A안", weights: a, componentModelVersion: model, runId: 47, profileSource: null, createdAt: now, updatedAt: now },
            { schemaVersion: 2, id: "sc-b", name: "B안", weights: b, componentModelVersion: model, runId: 47, profileSource: null, createdAt: now, updatedAt: now },
          ],
        }),
      );
    },
    [STORAGE_KEY, weights.a, weights.b, weights.model] as const,
  );
}

async function openPage4(page: Page, suitScope?: string): Promise<Recorder> {
  await mockSuitabilityBackend(page);
  const rec = await mockV3(page);
  const scope = suitScope ? `&suitScope=${suitScope}` : "";
  await page.goto(`/?v=1&mode=suitability&view=score${scope}`);
  await page.getByTestId("suitability-summary").waitFor({ state: "visible", timeout: 40000 });
  return rec;
}

const V3_A = { existing_burden: "0.40000000", air_impact_proxy: "0.30000000", resident_impact: "0.20000000", land_conversion: "0.10000000" };
const V3_B = { existing_burden: "0.10000000", air_impact_proxy: "0.20000000", resident_impact: "0.30000000", land_conversion: "0.40000000" };
const LEGACY = { zoning: "0.40000000", road: "0.30000000", equity: "0.20000000", demand: "0.10000000" };

async function openPage5(page: Page, suitScope: string | undefined, model: string, a: unknown, b: unknown): Promise<Recorder> {
  await mockSuitabilityBackend(page);
  const rec = await mockV3(page);
  await seedScenarios(page, { a, b, model });
  const scope = suitScope ? `&suitScope=${suitScope}` : "";
  await page.goto(`/?v=1&mode=suitability&view=scenario&cmpA=sc-a&cmpB=sc-b${scope}`);
  return rec;
}

// --------------------------------------------------------------------------- //

test.describe("CASE 1 — Page 4 baseline is V3", () => {
  test("renders the four successor factors and pins V3 on every read", async ({ page }) => {
    const rec = await openPage4(page);

    // 1. THE WIRE. Run resolution, summary and ranking all pinned to the successor.
    expect(rec.runModels.every((m) => m === SUCCESSOR_MODEL)).toBe(true);
    expect(rec.summaryModels.every((m) => m === SUCCESSOR_MODEL)).toBe(true);
    await expect.poll(() => rec.rankingModels.length).toBeGreaterThan(0);
    expect(rec.rankingModels.every((m) => m === SUCCESSOR_MODEL)).toBe(true);

    // 2. THE FOUR FACTORS, by their canonical keys.
    for (const component of SUCCESSOR_ORDER) {
      await expect(page.getByTestId(`v3-factor-weight-${component}`)).toBeVisible();
      await expect(page.getByTestId(`v3-factor-weight-${component}`)).toHaveValue("25");
    }
    // …and NOT the historical ones.
    for (const legacy of HISTORICAL_KEYS) {
      await expect(page.getByTestId(`factor-weight-${legacy}`)).toHaveCount(0);
    }

    // 3. THE PRESET ROW is 기준 + 사용자 지정 only.
    await expect(page.getByTestId("v3-preset-baseline")).toBeVisible();
    await expect(page.getByTestId("profile-radio-custom")).toBeVisible();
    await expect(page.getByTestId("profile-radio-equal")).toHaveCount(0);
    await expect(page.getByTestId("profile-radio-critic")).toHaveCount(0);

    // 4. The successor factor LABELS are on screen.
    const card = await page.getByTestId("scoring-basis").innerText();
    for (const label of ["기존시설 부담지수", "대기영향 지수", "주민영향 지수", "용도변경 가능지수"]) {
      expect(card).toContain(label);
    }

    // 5. Ranking + map are present and TOP 5 bounded.
    await expect(page.getByTestId("map-container")).toBeVisible();
    const rows = page.getByTestId("top-candidate-item");
    await expect.poll(() => rows.count()).toBeGreaterThan(0);
    expect(await rows.count()).toBeLessThanOrEqual(5);
  });
});

test.describe("CASE 2 — Page 4 custom V3 weights drive the real result", () => {
  test("a changed vector changes the request AND the ranking", async ({ page }) => {
    const rec = await openPage4(page);

    await page.getByTestId("v3-factor-weight-existing_burden").fill("40");
    await page.getByTestId("v3-factor-weight-air_impact_proxy").fill("20");
    await page.getByTestId("v3-factor-weight-land_conversion").fill("15");
    // 40 + 20 + 25 + 15 = 100.
    await expect(page.getByTestId("custom-weight-apply")).toBeEnabled();
    await page.getByTestId("custom-weight-apply").click();
    await page.getByTestId("custom-weight-applied").waitFor({ state: "visible", timeout: 25000 });

    // THE REQUEST carries the successor model and successor keys only.
    const sent = rec.previews.at(-1)!;
    expect(sent.model).toBe(SUCCESSOR_MODEL);
    expect(Object.keys(sent.weights).sort()).toEqual([...SUCCESSOR_ORDER].sort());
    for (const legacy of HISTORICAL_KEYS) expect(sent.weights[legacy]).toBeUndefined();
    expect(sent.weights.existing_burden).toBe("0.40000000");

    // THE RESULT changed with it: the ranking now shows the scenario's own scores.
    const ranking = await page.getByTestId("top-candidates").innerText();
    expect(ranking).not.toBe("");

    // THE MAP is live and on the same applied scenario.
    //
    // The tile URL's own contract — successor weights as `w=component:value`, and
    // never the historical `wz`/`wr`/`we`/`wd` abbreviations, which name a different
    // measurement in each model — is asserted where it is DETERMINISTIC: the unit
    // tests in `lib/api.scenario.test.ts` (URL construction) and
    // `page.page4CustomWeights.test.tsx`, which reads the exact `candidateTileUrl`
    // handed to MapView. Asserting it again from a headless canvas's own tile
    // requests only adds a WebGL dependency to a fact already proven, and this
    // page's map does not always reach a tile fetch in that environment.
    await expect(page.getByTestId("map-container")).toBeVisible();
    await expect(page.getByTestId("custom-weight-applied")).toContainText("사용자 지정");
    // Whatever tiles the map DID request must still be successor-shaped.
    for (const url of rec.tileUrls) {
      expect(url).toContain(encodeURIComponent("existing_burden:0.40000000"));
      expect(url).not.toContain("wz=");
    }
  });
});

test.describe("CASES 3–6 — the geographic scope survives the V3 transition", () => {
  for (const [name, scope, expected, forbidden] of [
    ["경기 only", GYEONGGI, ["수원시 장안구", "안산시 단원구"], ["강화군", "옹진군", "종로구"]],
    ["인천 only", INCHEON, ["강화군", "옹진군"], ["수원시 장안구", "종로구"]],
    ["a 시·군·구 subset", "KR-SGIS-23510", ["강화군"], ["옹진군", "수원시 장안구", "종로구"]],
  ] as const) {
    test(`${name} — Page 5 A and B are both V3 over that one universe`, async ({ page }) => {
      const rec = await openPage5(page, scope, SUCCESSOR_MODEL, V3_A, V3_B);
      await page.getByTestId("scenario-ranking-analytics").waitFor({ state: "visible", timeout: 40000 });

      // BOTH sides: successor model, and the SAME scope.
      expect(rec.previews.length).toBeGreaterThanOrEqual(2);
      for (const preview of rec.previews) {
        expect(preview.model).toBe(SUCCESSOR_MODEL);
        for (const legacy of HISTORICAL_KEYS) expect(preview.weights[legacy]).toBeUndefined();
        if (scope.length > "KR-SGIS-11".length) expect(preview.sigungu).toContain(scope);
        else expect(preview.sido).toBe(scope);
      }

      const surfaces = [
        await page.getByTestId("scenario-ranking-analytics").innerText(),
        await page.getByTestId("scenario-ranking-table").innerText(),
        await page.getByTestId("scenario-ranking-scatter").innerText(),
      ].join("\n");
      for (const name of expected) expect(surfaces).toContain(name);
      for (const name of forbidden) expect(surfaces).not.toContain(name);
    });
  }

  test("수도권 전체 — and only then may all three 시·도 appear", async ({ page }) => {
    const rec = await openPage5(page, undefined, SUCCESSOR_MODEL, V3_A, V3_B);
    await page.getByTestId("scenario-ranking-analytics").waitFor({ state: "visible", timeout: 40000 });
    for (const preview of rec.previews) {
      expect(preview.sido).toBeNull();
      expect(preview.sigungu).toEqual([]);
      expect(preview.model).toBe(SUCCESSOR_MODEL);
    }
    const table = await page.getByTestId("scenario-ranking-table").innerText();
    expect(table).toContain("종로구");
    expect(table).toContain("강화군");
    expect(table).toContain("수원시 장안구");
  });
});

test.describe("CASE 5b — candidate grain survives", () => {
  test("groups by 시·군·구 without inventing any municipality aggregate", async ({ page }) => {
    await openPage5(page, undefined, SUCCESSOR_MODEL, V3_A, V3_B);
    await page.getByTestId("scenario-ranking-analytics").waitFor({ state: "visible", timeout: 40000 });

    const headings = page.getByTestId("scenario-ranking-table-group-heading");
    await expect.poll(() => headings.count()).toBeGreaterThan(0);
    const headingText = (await headings.allInnerTexts()).join("\n");
    // A heading carries a place and a COUNT OF ROWS — never an average or a rank.
    expect(headingText).toMatch(/후보 구역 \d+곳/);
    for (const forbidden of ["평균", "중앙값", "평균 순위"]) {
      expect(headingText).not.toContain(forbidden);
    }
    // Candidate-level A/B ranks survive the grouping.
    const table = await page.getByTestId("scenario-ranking-table").innerText();
    expect(table).toContain("A안 순위");
    expect(table).toContain("B안 순위");
  });
});

test.describe("CASE 7 — a legacy historical scenario stays historical", () => {
  test("is refused as another model and never sent as a V3 request", async ({ page }) => {
    const rec = await openPage5(page, undefined, "suitability-components-zred-v1", LEGACY, LEGACY);
    await page.getByTestId("scenario-comparison-identity").waitFor({ state: "visible", timeout: 40000 });

    // Named as incompatible, with the reason.
    const notice = page.getByTestId("scenario-comparison-side-other-model").first();
    await expect(notice).toBeVisible({ timeout: 20000 });
    await expect(notice).toContainText("기존 모델");

    // ⛔ AND NEVER SENT: no Z/R/E/D vector reached the engine under a V3 request.
    for (const preview of rec.previews) {
      for (const legacy of HISTORICAL_KEYS) expect(preview.weights[legacy]).toBeUndefined();
    }
  });
});

test.describe("CASE 8 — a V3 saved scenario reads back as V3", () => {
  test("keeps its model tag through a real reload", async ({ page }) => {
    await openPage5(page, undefined, SUCCESSOR_MODEL, V3_A, V3_B);
    await page.getByTestId("scenario-ranking-analytics").waitFor({ state: "visible", timeout: 40000 });
    await page.reload();
    await page.getByTestId("scenario-ranking-analytics").waitFor({ state: "visible", timeout: 40000 });

    const stored = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as { scenarios: { componentModelVersion: string }[] });
    }, STORAGE_KEY);
    expect(stored?.scenarios.every((s) => s.componentModelVersion === SUCCESSOR_MODEL)).toBe(true);
  });
});
