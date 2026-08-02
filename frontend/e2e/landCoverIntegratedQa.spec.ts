import { expect, test, type Page, type Request, type Route } from "@playwright/test";

/**
 * Integrated local QA for the complete land-cover subsystem (Phase 1B-LC6).
 *
 * `landCoverLayer.spec.ts` already proves the LC5B layer contract itself (off by
 * default, version-pinned source, three coverage states, L1/L2/L3, class filters,
 * candidate click). This spec deliberately does NOT repeat any of that. It covers only
 * what that suite leaves unproven for an END-TO-END LC3→LC5B review:
 *
 *  1. **Source/layer lifecycle.** Repeated enable/disable, mode/level/filter churn and
 *     leaving and re-entering suitability mode must leave exactly one control and one
 *     legend behind, and must never re-request the release metadata for an ordinary
 *     control change.
 *  2. **Low-zoom cost, measured rather than assumed.** The tile count, bytes and
 *     wall-clock the browser actually pays when the layer is switched on at the default
 *     capital-region view — the evidence behind the LC6 low-zoom decision. Reported via
 *     `console.log`, never asserted as a machine-dependent latency threshold.
 *  3. **Failure injection.** Release malformed, tile 500, an EMPTY-but-valid tile,
 *     candidate detail 404 and the class endpoint failing. In every case the base map
 *     must survive, the suitability candidate detail must survive, no zero may be
 *     fabricated, and no SQL/stack trace/local path/connection string may reach the UI.
 *  4. **Candidate-detail edge cases** that only real data exposes: a PARTIAL cell whose
 *     coverage ratio rounds to 100% (1,479 such cells exist in the active release), and
 *     a NO_COVERAGE cell that must stay explicitly unevaluated and classless.
 *
 * Everything is read-only: the spec issues GETs and drives the UI. It never writes to
 * the database and never mutates official data.
 *
 * Playwright-managed Chromium is not installed in this environment, so every test runs
 * on the installed Chrome channel.
 */

const backendUrl = process.env.E2E_BACKEND_URL;

test.skip(!backendUrl, "E2E_BACKEND_URL is not configured (live browser verification only)");

test.use({ channel: "chrome" });

const SUITABILITY_URL = "/?v=1&mode=suitability&view=score";
const CELL_STATS_PATH = "/api/v1/environment/land-cover/cell-statistics";
const TILE_PATH = `${CELL_STATS_PATH}/tiles/`;
const RELEASE_PATH = `${CELL_STATS_PATH}/release`;

/**
 * A bbox over Ganghwa/north-west Incheon, which is where the release's unevaluated and
 * near-fully-evaluated cells actually are. Used only to DISCOVER real candidates.
 */
const DISCOVERY_BBOX = "126.3,37.55,126.7,37.85";

/**
 * Internals that must never surface in the UI, whatever fails. Kept as literals rather
 * than a loose regex so the assertion cannot quietly stop matching.
 *
 * Deliberately NOT paired with a "must not say there is no land cover" substring scan:
 * the layer's own honest disclaimers legitimately contain those phrases in NEGATED form
 * ("…이용되지 않는 땅이라는 뜻이 아니며…"), so a substring scan would flag the very text
 * that prevents the misreading. That property is asserted positively instead, on the
 * specific NO_COVERAGE surfaces below.
 */
const LEAK_MARKERS = [
  "Traceback",
  "psycopg",
  "sqlalchemy",
  "SELECT ",
  "FROM environmental_",
  "postgresql://",
  "postgresql+psycopg",
  "/Users/",
  "/app/src",
  "ST_AsMVT",
];

async function gotoSuitability(page: Page) {
  await page.goto(SUITABILITY_URL);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
}

async function openControl(page: Page) {
  const control = page.getByTestId("land-cover-layer-control");
  await expect(control).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("land-cover-layer-summary").click();
  await expect(page.getByTestId("land-cover-layer-toggle")).toBeVisible();
  return control;
}

async function enableLayer(page: Page) {
  const toggle = page.getByTestId("land-cover-layer-toggle");
  await toggle.check();
  await expect(toggle).toBeChecked();
}

/** Assert the visible page text carries no internal implementation detail. */
async function assertNoLeakedInternals(page: Page) {
  const body = (await page.locator("body").innerText()).trim();
  for (const marker of LEAK_MARKERS) {
    expect(body, `UI must not leak ${marker}`).not.toContain(marker);
  }
}

/** The base map and the existing suitability UI are both still alive. */
async function assertMapAndSuitabilitySurvive(page: Page) {
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.getByTestId("suitability-summary")).toBeVisible({ timeout: 30_000 });
}

/**
 * The numeric candidate id of a real cell matching a land-cover filter.
 *
 * The deep-link parameter is the suitability candidate ID, while land-cover is keyed by
 * `candidate_key`, so the two are joined here the only way a client can: over the SAME
 * bbox, which both endpoints support and which is backed by the shared candidate
 * geometry index. Discovered from live data rather than hardcoded.
 */
async function discoverCandidateId(page: Page, landCoverQuery: string): Promise<number> {
  const cells = await page.request.get(
    `${backendUrl}${CELL_STATS_PATH}/cells?bbox=${DISCOVERY_BBOX}&limit=500&${landCoverQuery}`,
  );
  expect(cells.status()).toBe(200);
  const cellBody = (await cells.json()) as { items: { candidate_key: string }[] };
  const wanted = new Set(cellBody.items.map((item) => item.candidate_key));
  expect(wanted.size, `no cell matched ${landCoverQuery}`).toBeGreaterThan(0);

  const candidates = await page.request.get(
    `${backendUrl}/api/v1/suitability/candidates?bbox=${DISCOVERY_BBOX}&limit=500`,
  );
  expect(candidates.status()).toBe(200);
  const candidateBody = (await candidates.json()) as {
    features: { properties: { candidate_key: string; candidate_id: number } }[];
  };
  for (const feature of candidateBody.features) {
    if (wanted.has(feature.properties.candidate_key)) return feature.properties.candidate_id;
  }
  throw new Error(`no suitability candidate in the discovery bbox matched ${landCoverQuery}`);
}

// --------------------------------------------------------------------------- //
// 1. Source and layer lifecycle
// --------------------------------------------------------------------------- //

test.describe("LC6 — source and layer lifecycle", () => {
  test("repeated enable/disable and mode churn leave exactly one control and one legend", async ({
    page,
  }) => {
    await gotoSuitability(page);
    await openControl(page);

    const releaseRequests: string[] = [];
    page.on("request", (request: Request) => {
      if (request.url().includes(RELEASE_PATH)) releaseRequests.push(request.url());
    });

    const toggle = page.getByTestId("land-cover-layer-toggle");
    for (let round = 0; round < 3; round += 1) {
      await toggle.check();
      await expect(page.getByTestId("land-cover-legend")).toBeVisible();
      await toggle.uncheck();
      await expect(toggle).not.toBeChecked();
    }
    await toggle.check();
    await expect(toggle).toBeChecked();

    // Mode/level/filter churn — none of it may re-resolve the release.
    const releasesAfterEnable = releaseRequests.length;
    await page.getByTestId("land-cover-mode-group").getByRole("radio", { name: /우세 분류/ }).check();
    await page.getByTestId("land-cover-level-group").getByRole("radio", { name: /중분류/ }).check();
    await page.getByTestId("land-cover-level-group").getByRole("radio", { name: /세분류/ }).check();
    await page.getByTestId("land-cover-mode-group").getByRole("radio", { name: /평가 범위/ }).check();
    await page.waitForTimeout(500);
    expect(
      releaseRequests.length,
      "ordinary control changes must not re-request the release metadata",
    ).toBe(releasesAfterEnable);

    // The map exposes no debug handle, so lifecycle is asserted on the DOM the control
    // owns: exactly one control, one legend and one legend-row list — never a second set
    // stacked on top after repeated toggling.
    await expect(page.getByTestId("land-cover-layer-control")).toHaveCount(1);
    await expect(page.getByTestId("land-cover-legend")).toHaveCount(1);
    await expect(page.getByTestId("land-cover-legend-rows")).toHaveCount(1);

    // Leave suitability and come back: the control must be rebuilt exactly once.
    await page.getByTestId("mode-equity").click();
    await expect(page.getByTestId("land-cover-layer-control")).toHaveCount(0);
    await page.getByTestId("mode-suitability").click();
    await expect(page.getByTestId("land-cover-layer-control")).toHaveCount(1);

    await assertMapAndSuitabilitySurvive(page);
    await assertNoLeakedInternals(page);
  });

  test("turning every coverage status off states the empty selection instead of showing everything", async ({
    page,
  }) => {
    await gotoSuitability(page);
    await openControl(page);
    await enableLayer(page);

    // The legend must be mounted before the filters are driven: each uncheck re-renders
    // the legend, and clicking before the first render settles can drop an event.
    await expect(page.getByTestId("land-cover-legend")).toBeVisible();
    const boxes = page.getByTestId("land-cover-coverage-filters").getByRole("checkbox");
    expect(await boxes.count()).toBe(3);
    for (let index = 0; index < 3; index += 1) {
      const box = boxes.nth(index);
      await box.uncheck();
      // Settle this toggle before the next, so a re-render cannot swallow a click.
      await expect(box).not.toBeChecked();
    }

    const empty = page.getByTestId("land-cover-selection-empty");
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty).toContainText("선택된 격자가 없습니다");

    // Re-enabling one status clears the explicit empty state.
    await boxes.nth(0).check();
    await expect(page.getByTestId("land-cover-selection-empty")).toHaveCount(0);
    await assertNoLeakedInternals(page);
  });
});

// --------------------------------------------------------------------------- //
// 2. Low-zoom cost, measured
// --------------------------------------------------------------------------- //

/**
 * Phase 1B-LC8 — the public authorization disclosure and the mandatory source
 * attribution must be VISIBLE in the browser, not merely present in the JSON.
 *
 * The two facts are asserted separately on purpose: the public-deployment status and
 * the PROJECT-level basis it rests on. No surface may assert an EGIS written approval
 * or a KOGL type, and none may offer raw SHP/source geometry.
 */
test.describe("LC8 — public authorization and attribution", () => {
  test("the layer control shows the attribution, the basis, and no KOGL/raw-data claim", async ({
    page,
  }) => {
    await gotoSuitability(page);
    const control = await openControl(page);

    const attribution = page.getByTestId("land-cover-layer-attribution");
    await expect(attribution).toBeVisible();
    await expect(attribution).toContainText("출처: 기후에너지환경부 환경공간정보서비스(EGIS)");
    await expect(attribution).toContainText("세분류 [2025] 전국 토지피복지도");
    await expect(attribution).toContainText("500 m 후보격자");
    await expect(page.getByTestId("land-cover-layer-source-link")).toHaveAttribute(
      "href",
      /^https:\/\//,
    );

    const disclaimer = page.getByTestId("land-cover-layer-disclaimer");
    await expect(disclaimer).toBeVisible();
    await expect(disclaimer).toContainText("협력 정부기관");
    await expect(disclaimer).toContainText("원본 SHP 파일");
    await expect(disclaimer).toContainText("적합성 점수");

    // No claim of an EGIS licence, a KOGL type, or a raw-data download anywhere in
    // the control — publication rests on project authorization, nothing more.
    const text = await control.innerText();
    expect(text).not.toMatch(/KOGL|공공누리|제1유형|서면 승인|SHP 다운로드|원본 내려받기/);

    await assertNoLeakedInternals(page);
  });

  test("the candidate-detail land-cover section shows the public status, its basis and the attribution", async ({
    page,
  }) => {
    const candidateId = await discoverCandidateId(page, "coverage_status=COMPLETE_EXACT");
    await page.goto(`${SUITABILITY_URL}&cand=${candidateId}`);
    // Same settle order the other deep-link specs use: the map must mount before the
    // candidate selection resolves and the land-cover section is requested at all.
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("land-cover-cell-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("land-cover-body")).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId("land-cover-license-disclosure")).toContainText(
      "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER",
    );
    await expect(page.getByTestId("land-cover-authorization-basis")).toContainText(
      "GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION",
    );
    await expect(page.getByTestId("land-cover-public-statement")).toContainText("협력 정부기관");
    await expect(page.getByTestId("land-cover-attribution")).toContainText(
      "출처: 기후에너지환경부 환경공간정보서비스(EGIS)",
    );
    // Publication never changes the scoring status.
    await expect(page.getByTestId("land-cover-scoring-disclosure")).toContainText(
      "used_in_suitability_scoring: false",
    );

    await assertNoLeakedInternals(page);
  });
});

test.describe("LC6 — low-zoom cost", () => {
  test("records what the browser actually pays to enable the layer at the default view", async ({
    page,
  }) => {
    await gotoSuitability(page);
    await openControl(page);

    const tiles: { zoom: string; bytes: number }[] = [];
    page.on("response", async (response) => {
      if (!response.url().includes(TILE_PATH)) return;
      try {
        const body = await response.body();
        const zoom = response.url().match(/tiles\/\d+\/(\d+)\//)?.[1] ?? "?";
        tiles.push({ zoom, bytes: body.length });
      } catch {
        /* body already discarded — not a measurement failure */
      }
    });

    const startedAt = Date.now();
    await enableLayer(page);
    await expect(page.getByTestId("land-cover-legend")).toBeVisible();
    const legendAt = Date.now() - startedAt;
    await page.waitForTimeout(8000); // let the viewport's tiles settle
    const settledAt = Date.now() - startedAt;

    const totalBytes = tiles.reduce((sum, tile) => sum + tile.bytes, 0);
    const largest = tiles.reduce((max, tile) => Math.max(max, tile.bytes), 0);
    const zooms = [...new Set(tiles.map((tile) => tile.zoom))].sort();

    // Reported, not asserted: this is the evidence behind the LC6 low-zoom decision, and
    // a machine-dependent latency must never fail the suite.
    console.log(
      `[LC6 low-zoom] tiles=${tiles.length} zooms=[${zooms.join(",")}] ` +
        `totalBytes=${totalBytes} largestTile=${largest} ` +
        `enable→legend=${legendAt}ms enable→settled=${settledAt}ms`,
    );

    // What IS asserted: the layer really loaded tiles and nothing died.
    expect(tiles.length).toBeGreaterThan(0);
    await expect(page.getByTestId("land-cover-legend")).toBeVisible();
    await assertMapAndSuitabilitySurvive(page);

    // The control is still responsive after the low-zoom load (no wedged main thread).
    const modeGroup = page.getByTestId("land-cover-mode-group");
    await modeGroup.getByRole("radio", { name: /우세 분류/ }).check();
    await expect(modeGroup.getByRole("radio", { name: /우세 분류/ })).toBeChecked({
      timeout: 15_000,
    });
    await assertNoLeakedInternals(page);
  });
});

// --------------------------------------------------------------------------- //
// 3. Failure injection
// --------------------------------------------------------------------------- //

test.describe("LC6 — failure injection", () => {
  test("a malformed release response disables only the layer, and says it is not absent land cover", async ({
    page,
  }) => {
    await page.route(`**${RELEASE_PATH}`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ nonsense: true }),
      }),
    );
    await gotoSuitability(page);
    await openControl(page);

    const unavailable = page.getByTestId("land-cover-layer-unavailable");
    await expect(unavailable).toBeVisible({ timeout: 30_000 });
    // A layer failure must never be readable as "this area has no land cover". Only the
    // shared stem is asserted: the three messages negate differently ("…뜻은 아닙니다"
    // vs "…뜻은 아니며").
    await expect(unavailable).toContainText("토지피복이 없다는 뜻은");
    await expect(page.getByTestId("land-cover-layer-toggle")).toBeDisabled();

    await assertMapAndSuitabilitySurvive(page);
    await assertNoLeakedInternals(page);
  });

  test("a 500 from the tile endpoint leaves the map, the legend and suitability intact", async ({
    page,
  }) => {
    await gotoSuitability(page);
    await openControl(page);
    await page.route(`**${TILE_PATH}**`, (route: Route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: { error: "INTERNAL", detail: "injected" } }),
      }),
    );
    await enableLayer(page);
    await page.waitForTimeout(3000);

    await expect(page.getByTestId("land-cover-legend")).toBeVisible();
    await assertMapAndSuitabilitySurvive(page);
    await assertNoLeakedInternals(page);
  });

  test("an EMPTY but valid tile is not reported as an error", async ({ page }) => {
    await gotoSuitability(page);
    await openControl(page);
    await page.route(`**${TILE_PATH}**`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/vnd.mapbox-vector-tile",
        body: Buffer.alloc(0),
      }),
    );
    await enableLayer(page);
    await page.waitForTimeout(3000);

    // The layer is ON and the legend still explains the coverage states; an empty
    // viewport is not a broken layer.
    await expect(page.getByTestId("land-cover-legend")).toBeVisible();
    await expect(page.getByTestId("land-cover-layer-unavailable")).toHaveCount(0);
    await assertMapAndSuitabilitySurvive(page);
    await assertNoLeakedInternals(page);
  });

  test("a 404 from the candidate-detail statistics affects only the land-cover section", async ({
    page,
  }) => {
    await page.route(`**${CELL_STATS_PATH}/cells/**`, (route: Route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            error: "CANDIDATE_CELL_NOT_FOUND",
            detail: "No candidate-cell land-cover statistics exist for the requested candidate key.",
          },
        }),
      }),
    );
    await gotoSuitability(page);

    const item = page.getByTestId("top-candidate-item").first();
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.click();

    // The existing suitability candidate detail still opens — a land-cover failure must
    // never hide it.
    await expect(page.getByTestId("candidate-detail")).toBeVisible({ timeout: 30_000 });

    // No fabricated zero areas in the land-cover section.
    const panel = page.getByTestId("land-cover-cell-panel");
    if (await panel.count()) {
      expect(await panel.innerText()).not.toMatch(/평가 면적\s*0(\.0+)?\s*(m²|㎡|km²)/);
    }
    await assertMapAndSuitabilitySurvive(page);
    await assertNoLeakedInternals(page);
  });

  test("the class-distribution endpoint failing does not break the rest of the detail", async ({
    page,
  }) => {
    await page.route(`**${CELL_STATS_PATH}/cells/*/classes**`, (route: Route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await gotoSuitability(page);

    const item = page.getByTestId("top-candidate-item").first();
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.click();
    await expect(page.getByTestId("candidate-detail")).toBeVisible({ timeout: 30_000 });

    await assertMapAndSuitabilitySurvive(page);
    await assertNoLeakedInternals(page);
  });
});

// --------------------------------------------------------------------------- //
// 4. Candidate-detail edge cases on real data
// --------------------------------------------------------------------------- //

test.describe("LC6 — candidate-detail edge cases", () => {
  test("a PARTIAL cell whose ratio rounds to 100% never displays a flat 100%", async ({ page }) => {
    const candidateId = await discoverCandidateId(
      page,
      "coverage_status=PARTIAL&min_coverage_ratio=0.9999",
    );
    await page.goto(`${SUITABILITY_URL}&cand=${candidateId}`);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId("land-cover-cell-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("land-cover-coverage-label")).toContainText("PARTIAL");

    // The load-bearing rule: the status says PARTIAL, so the ratio must not read 100%.
    await expect(page.getByTestId("land-cover-coverage")).toContainText("100% 미만");
    await expect(page.getByTestId("land-cover-partial-warning")).toBeVisible();
    await assertNoLeakedInternals(page);
  });

  test("a NO_COVERAGE cell stays explicitly unevaluated, classless and never 'empty land'", async ({
    page,
  }) => {
    const candidateId = await discoverCandidateId(page, "coverage_status=NO_COVERAGE");
    await page.goto(`${SUITABILITY_URL}&cand=${candidateId}`);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId("land-cover-cell-panel")).toBeVisible({ timeout: 30_000 });
    const warning = page.getByTestId("land-cover-no-coverage-warning");
    await expect(warning).toBeVisible();
    await expect(page.getByTestId("land-cover-coverage-label")).toContainText("NO_COVERAGE");

    // Positively assert the warning states what the status does NOT mean. This is the
    // backend's own served `no_coverage_warning_ko`, so the exact wording is asserted.
    const warningText = await warning.innerText();
    expect(warningText).toContain("의미가 아니며");
    expect(warningText).toContain("적합하거나 안전하다는 의미도 아닙니다");

    // No dominant class at any level and no synthetic class rows.
    await expect(page.getByTestId("land-cover-no-classes")).toBeVisible();
    await expect(page.getByTestId("land-cover-class-row")).toHaveCount(0);
    const dominant = await page.getByTestId("land-cover-dominant").innerText();
    for (const invented of ["미분류", "Unknown", "Unclassified", "Other"]) {
      expect(dominant, `NO_COVERAGE must not invent a ${invented} class`).not.toContain(invented);
    }
    await assertNoLeakedInternals(page);
  });

  test("rapid candidate switching never leaves a stuck loading state", async ({ page }) => {
    await gotoSuitability(page);
    const items = page.getByTestId("top-candidate-item");
    await expect(items.first()).toBeVisible({ timeout: 30_000 });
    expect(await items.count()).toBeGreaterThanOrEqual(2);

    // Switch fast enough that earlier requests are still in flight.
    await items.nth(0).click();
    await items.nth(1).click();
    await items.nth(0).click();
    await items.nth(1).click();

    await expect(page.getByTestId("land-cover-cell-panel")).toBeVisible({ timeout: 30_000 });
    // Whatever it settles on must resolve — never a loading state that never ends.
    await expect(page.getByTestId("land-cover-loading")).toHaveCount(0, { timeout: 30_000 });
    await assertMapAndSuitabilitySurvive(page);
    await assertNoLeakedInternals(page);
  });
});
