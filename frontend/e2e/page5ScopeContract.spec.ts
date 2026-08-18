import { expect, test, type Page, type Route } from "@playwright/test";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * PAGE 4 → PAGE 5 — THE ANALYSIS SCOPE CONTRACT.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────────────
 * 후보지 심층 분석 lets a reader narrow the analysis to 서울 / 인천 / 경기 or to a set
 * of 시·군·구. 후보지 심층 비교 used to ignore that entirely: the scenario preview
 * endpoint had no scope parameter, so BOTH sides were previewed over the whole
 * capital region. A reader who had scoped to 경기 was shown a comparison whose
 * ranking population was the full ~17.5k and whose rows included 인천 강화군/옹진군 —
 * the page silently answered a different question from the one it was set up to ask.
 *
 * ── THE CONTRACT ─────────────────────────────────────────────────────────────────
 * A and B compare WEIGHT VECTORS. They must never compare different geographic
 * universes. The candidate universe is fixed by the Page-4 scope and every Page-5
 * surface consumes that ONE scope:
 *
 *   the A preview · the B preview · the ranking population · TOP candidates ·
 *   the rank-movement plot · the comparison table · the map tiles ·
 *   the candidate detail selector · the exported scope sentence.
 *
 * ── WHY THE MOCK FILTERS ─────────────────────────────────────────────────────────
 * The preview route below behaves like the real backend: it reads the scope OFF THE
 * REQUEST and filters the candidate pool by it. That is what makes these assertions
 * end-to-end rather than cosmetic — if the frontend ever stops sending the scope, the
 * route receives none, returns the whole capital region, and the "no 인천 candidates"
 * assertions fail. `seenRequests` additionally records every request so the test can
 * state plainly that the scope reached the wire.
 *
 * Playwright's own Chromium is not installed in this environment, so this runs on the
 * installed Chrome channel (matching page4dScenarios / page5aComparison).
 *
 * Every fixture is SYNTHETIC and carries no official evidence label.
 */

test.use({ channel: "chrome" });

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

/** SGIS codes, the space `suitability_candidates` actually stores. */
const SEOUL = "KR-SGIS-11";
const INCHEON = "KR-SGIS-23";
const GYEONGGI = "KR-SGIS-31";

interface PoolRow {
  key: string;
  sido: string;
  sidoName: string;
  sigungu: string;
  sigunguName: string;
}

/**
 * A candidate pool spanning all three 시·도, so every scope case has both rows to
 * include and rows it must exclude. Two 시·군·구 per 시·도 so a 시·군·구 subset is
 * distinguishable from its 시·도.
 */
const POOL: PoolRow[] = [
  { key: "s1", sido: SEOUL, sidoName: "서울특별시", sigungu: "KR-SGIS-11010", sigunguName: "서울특별시 종로구" },
  { key: "s2", sido: SEOUL, sidoName: "서울특별시", sigungu: "KR-SGIS-11110", sigunguName: "서울특별시 노원구" },
  { key: "i1", sido: INCHEON, sidoName: "인천광역시", sigungu: "KR-SGIS-23510", sigunguName: "인천광역시 강화군" },
  { key: "i2", sido: INCHEON, sidoName: "인천광역시", sigungu: "KR-SGIS-23520", sigunguName: "인천광역시 옹진군" },
  { key: "g1", sido: GYEONGGI, sidoName: "경기도", sigungu: "KR-SGIS-31011", sigunguName: "경기도 수원시 장안구" },
  { key: "g2", sido: GYEONGGI, sidoName: "경기도", sigungu: "KR-SGIS-31190", sigunguName: "경기도 안산시 단원구" },
];

interface ScopeRequest {
  sido: string | null;
  sigungu: string[];
}

/** Every scope this run's preview endpoint was asked for. */
interface Recorder {
  previews: ScopeRequest[];
  details: ScopeRequest[];
  tileUrls: string[];
}

function scopeOf(posted: Record<string, unknown>): ScopeRequest {
  const sido = typeof posted.sido === "string" && posted.sido !== "" ? posted.sido : null;
  const sigungu = Array.isArray(posted.sigungu) ? (posted.sigungu as string[]) : [];
  return { sido, sigungu };
}

/** The real backend's own predicate: 시·도 equality AND a 시·군·구 IN list. */
function inScope(row: PoolRow, scope: ScopeRequest): boolean {
  if (scope.sido !== null && row.sido !== scope.sido) return false;
  if (scope.sigungu.length > 0 && !scope.sigungu.includes(row.sigungu)) return false;
  return true;
}

function candidates(rows: PoolRow[], base: number, order: readonly string[]) {
  const ordered = order
    .map((key) => rows.find((row) => row.key === key))
    .filter((row): row is PoolRow => row !== undefined);
  return ordered.map((row, index) => ({
    candidate_id: 100 + POOL.findIndex((p) => p.key === row.key),
    candidate_key: row.key,
    sido_region_code: row.sido,
    sido_region_name: row.sidoName,
    sigungu_region_code: row.sigungu,
    sigungu_region_name: row.sigunguName,
    custom_score: (base - index).toFixed(4),
    // Ranks are 1..N WITHIN the returned (scoped) set, exactly as the scoped
    // `row_number()` produces them.
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
    centroid_lon: 126.9,
    centroid_lat: 37.5,
  }));
}

/** A's order, and B's — different enough that movement exists in every scope. */
const ORDER_A = ["s1", "i1", "g1", "s2", "i2", "g2"];
const ORDER_B = ["g2", "g1", "i2", "i1", "s2", "s1"];

async function mockScopedBackend(page: Page): Promise<Recorder> {
  const rec: Recorder = { previews: [], details: [], tileUrls: [] };

  await page.route("**/api/v1/suitability/scenarios/preview", async (route: Route) => {
    const posted = (route.request().postDataJSON() as Record<string, unknown>) ?? {};
    const scope = scopeOf(posted);
    rec.previews.push(scope);
    const isB = Number((posted.weights as Record<string, string>).equity) > 0.3;
    const rows = POOL.filter((row) => inScope(row, scope));
    const order = (isB ? ORDER_B : ORDER_A).filter((key) =>
      rows.some((row) => row.key === key),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        scenario_hash: isB ? "scope-b" : "scope-a",
        scenario_hash_short: "scope",
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
        candidate_count_eligible: rows.length,
        candidate_count_review: 0,
        candidate_count_excluded: 0,
        // THE SCOPED population — the whole point. A capital-region number here
        // beside scoped rows would be the same lie in a different place.
        ranking_population: rows.length,
        top_candidates: candidates(rows, 95, order),
        selected_candidate: null,
        tile_url: "/tiles",
        assumptions: [],
        scenario_label: "사용자 가정 기반 시나리오",
        scenario_disclaimer: "임시 비교 결과입니다.",
        screening_disclaimer: "광역 분석 스크리닝",
      }),
    });
  });

  await page.route("**/api/v1/suitability/scenarios/candidates/*", async (route: Route) => {
    const posted = (route.request().postDataJSON() as Record<string, unknown>) ?? {};
    rec.details.push(scopeOf(posted));
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  await page.route("**/scenarios/tiles/**", async (route: Route) => {
    rec.tileUrls.push(route.request().url());
    await route.abort();
  });

  return rec;
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
              id: "sc-a",
              name: "균형안",
              weights: weightsA,
              runId: 47,
              profileSource: null,
              createdAt: now,
              updatedAt: now,
            },
            {
              schemaVersion: 1,
              id: "sc-b",
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

/** Open 후보지 심층 비교 at a given ① 분석 범위, exactly as a shared link would. */
async function openComparison(page: Page, suitScope?: string): Promise<Recorder> {
  await mockSuitabilityBackend(page);
  const rec = await mockScopedBackend(page);
  await seedScenarios(page);
  const scopeParam = suitScope === undefined ? "" : `&suitScope=${suitScope}`;
  await page.goto(`/?v=1&mode=suitability&view=scenario&cmpA=sc-a&cmpB=sc-b${scopeParam}`);
  await page
    .getByTestId("scenario-ranking-analytics")
    .waitFor({ state: "visible", timeout: 40000 });
  return rec;
}

/**
 * The 시·군·구 names the candidate picker offers.
 *
 * They are `<optgroup>` LABELS, not option text — the picker groups by 시·군·구 and
 * each option carries only the cell key beneath its heading — and an optgroup label
 * is an attribute, so it never appears in `innerText`. Read explicitly, or a scoped
 * picker and an unscoped one would look identical to this test.
 */
async function pickerRegions(page: Page): Promise<string> {
  const labels = await page
    .getByTestId("scenario-candidate-picker")
    .locator("optgroup")
    .evaluateAll((groups) => groups.map((g) => (g as HTMLOptGroupElement).label));
  return labels.join("\n");
}

/** Every Page-5 surface that names candidates or their region, as one string. */
async function surfaceText(page: Page): Promise<string> {
  const parts = await Promise.all([
    page.getByTestId("scenario-ranking-analytics").innerText(),
    page.getByTestId("scenario-ranking-table").innerText(),
    page.getByTestId("scenario-ranking-scatter").innerText(),
    pickerRegions(page),
  ]);
  return parts.join("\n");
}

// --------------------------------------------------------------------------- //

test.describe("the Page-4 scope reaches every Page-5 surface", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("경기 전체 — 경기 candidates only, no 서울, no 인천", async ({ page }) => {
    const rec = await openComparison(page, GYEONGGI);

    // 1. THE WIRE. Both sides asked for the scope; neither was population-wide.
    expect(rec.previews.length).toBeGreaterThanOrEqual(2);
    for (const scope of rec.previews) {
      expect(scope.sido, "every preview carries the 시·도 scope").toBe(GYEONGGI);
    }

    // 2. THE SURFACES. Every candidate-naming surface is 경기-only.
    const text = await surfaceText(page);
    expect(text).toContain("수원시 장안구");
    expect(text).toContain("안산시 단원구");
    expect(text).not.toContain("서울특별시");
    expect(text).not.toContain("인천광역시");
    expect(text).not.toContain("강화군");
    expect(text).not.toContain("옹진군");

    // 3. THE POPULATION. The ranking population is the SCOPED count (2), never the
    // capital-region universe.
    await expect(page.getByTestId("scenario-ranking-scope")).toContainText("2개");

    // 4. THE SCOPE IS NAMED, so a reader can tell a 경기 A/B from a capital-region one.
    await expect(page.getByTestId("scenario-comparison-scope")).toContainText("경기");

    // 5. THE MAP. Scenario tiles carry the same scope as the ranking.
    // MapLibre fetches asynchronously; give it a moment, then hold every tile it
    // asked for to the same scope. A run that produced no tile at all (headless
    // canvas) is not treated as a pass — the assertion below states which happened.
    await page.waitForTimeout(3000);
    expect(rec.tileUrls.length, "the scenario map requested at least one tile").toBeGreaterThan(0);
    for (const url of rec.tileUrls) {
      expect(url, "every scenario tile carries the scope").toContain(
        `sido=${encodeURIComponent(GYEONGGI)}`,
      );
    }
  });

  test("인천 전체 — 인천 candidates only", async ({ page }) => {
    const rec = await openComparison(page, INCHEON);
    for (const scope of rec.previews) expect(scope.sido).toBe(INCHEON);

    const text = await surfaceText(page);
    expect(text).toContain("강화군");
    expect(text).toContain("옹진군");
    expect(text).not.toContain("서울특별시");
    expect(text).not.toContain("경기도");
    await expect(page.getByTestId("scenario-ranking-scope")).toContainText("2개");
  });

  test("서울 전체 — 서울 candidates only", async ({ page }) => {
    const rec = await openComparison(page, SEOUL);
    for (const scope of rec.previews) expect(scope.sido).toBe(SEOUL);

    const text = await surfaceText(page);
    expect(text).toContain("종로구");
    expect(text).toContain("노원구");
    expect(text).not.toContain("인천광역시");
    expect(text).not.toContain("경기도");
  });

  test("a 시·군·구 subset — only those 시·군·구, not their whole 시·도", async ({ page }) => {
    // 강화군 only. 옹진군 is in the SAME 시·도 and must NOT appear: that is what
    // separates a 시·군·구 scope from a 시·도 one.
    const rec = await openComparison(page, "KR-SGIS-23510");
    for (const scope of rec.previews) {
      expect(scope.sigungu, "every preview carries the 시·군·구 list").toContain("KR-SGIS-23510");
      expect(scope.sido).toBeNull();
    }

    const text = await surfaceText(page);
    expect(text).toContain("강화군");
    expect(text).not.toContain("옹진군");
    expect(text).not.toContain("경기도");
    expect(text).not.toContain("서울특별시");
    await expect(page.getByTestId("scenario-ranking-scope")).toContainText("1개");
  });

  test("수도권 전체 — and ONLY then may all three 시·도 appear", async ({ page }) => {
    const rec = await openComparison(page);
    for (const scope of rec.previews) {
      expect(scope.sido, "no scope is sent for 수도권 전체").toBeNull();
      expect(scope.sigungu).toEqual([]);
    }

    const text = await surfaceText(page);
    expect(text).toContain("종로구");
    expect(text).toContain("강화군");
    expect(text).toContain("수원시 장안구");
    await expect(page.getByTestId("scenario-ranking-scope")).toContainText("6개");
    // No 범위 line: 수도권 전체 needs no qualification.
    await expect(page.getByTestId("scenario-comparison-scope")).toHaveCount(0);
  });

  test("the candidate DETAIL request carries the same scope as the ranking", async ({ page }) => {
    const rec = await openComparison(page, GYEONGGI);
    // The selector lists only in-scope cells (they came from the scoped previews).
    const picker = page.getByTestId("scenario-candidate-picker");
    // The picker's 시·군·구 headings are 경기 only — the choices come from the two
    // SCOPED previews, so an out-of-scope cell is not offerable in the first place.
    const regions = await pickerRegions(page);
    expect(regions).toContain("수원시 장안구");
    expect(regions).not.toContain("강화군");

    await picker.selectOption({ index: 1 });
    await expect
      .poll(() => rec.details.length, { timeout: 20000 })
      .toBeGreaterThan(0);
    for (const scope of rec.details) {
      // A rank counted capital-region-wide would contradict the row it was opened
      // from, so the detail must be scoped identically.
      expect(scope.sido).toBe(GYEONGGI);
    }
  });

  test("narrowing the scope on a shared link re-previews rather than reusing 수도권", async ({
    page,
  }) => {
    const rec = await openComparison(page, GYEONGGI);
    const afterGyeonggi = rec.previews.length;
    expect(afterGyeonggi).toBeGreaterThanOrEqual(2);

    // Same pair, different 범위: the request identity includes the scope, so both
    // sides are previewed again instead of a cached capital-region result surviving.
    await page.goto(`/?v=1&mode=suitability&view=scenario&cmpA=sc-a&cmpB=sc-b&suitScope=${INCHEON}`);
    await page
      .getByTestId("scenario-ranking-analytics")
      .waitFor({ state: "visible", timeout: 40000 });
    await expect.poll(() => rec.previews.filter((s) => s.sido === INCHEON).length).toBeGreaterThanOrEqual(2);

    const text = await surfaceText(page);
    expect(text).toContain("강화군");
    expect(text).not.toContain("경기도");
  });
});

// --------------------------------------------------------------------------- //
// The Page-4 half: the scope a reader sets there is what Page 5 inherits.
// --------------------------------------------------------------------------- //

test.describe("the scope survives the Page-4 → Page-5 navigation", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("selecting 경기 on Page 4 and comparing carries 경기 into Page 5", async ({ page }) => {
    await mockSuitabilityBackend(page);
    const rec = await mockScopedBackend(page);
    await seedScenarios(page);

    // Start on 후보지 심층 분석 with the pair already chosen, so the only thing this
    // test drives is ① 지역 선택 and the 두 시나리오 비교하기 hand-off.
    await page.goto("/?v=1&mode=suitability&view=score&cmpA=sc-a&cmpB=sc-b");
    await page.getByTestId("suitability-summary").waitFor({ state: "visible", timeout: 30000 });

    // ① 지역 선택 → 경기.
    await page.getByTestId("suitability-scope-pill-31").click();
    await expect
      .poll(async () => new URL(page.url()).searchParams.get("suitScope"), { timeout: 15000 })
      .toBe(GYEONGGI);

    // ⑤ 두 시나리오 비교하기 — the in-app hand-off, not a fresh link.
    await page.getByTestId("scenario-compare-cta").click();
    await page
      .getByTestId("scenario-ranking-analytics")
      .waitFor({ state: "visible", timeout: 40000 });

    // The comparison inherited the scope: on the wire and on the screen.
    expect(rec.previews.length).toBeGreaterThanOrEqual(2);
    for (const scope of rec.previews) expect(scope.sido).toBe(GYEONGGI);
    const text = await surfaceText(page);
    expect(text).toContain("수원시 장안구");
    expect(text).not.toContain("인천광역시");
  });
});
