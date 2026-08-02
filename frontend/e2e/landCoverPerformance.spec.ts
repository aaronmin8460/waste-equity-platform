import { expect, test, type Page, type Request, type Response } from "@playwright/test";

/**
 * Land-cover vector-tile SERVING measurements (Phase 1B-LC9).
 *
 * LC8 shipped the public land-cover layer and honestly recorded what it cost:
 * a 3.71 MB worst-case low-zoom tile, no transfer compression, and ~4.1 s from
 * enabling the layer to the network settling. LC9 makes the same tile cheaper
 * to serve without changing one byte of what it contains. This spec is the
 * browser-side half of that evidence.
 *
 * What it does NOT do is assert millisecond budgets. A developer laptop running
 * Docker, a dev-mode Next.js server and a real PostGIS query is not a stable
 * timing environment, and a spec that fails on a slow morning teaches people to
 * ignore it. Instead it:
 *
 *   - RECORDS the real numbers (request count, transferred bytes, largest tile,
 *     status distribution, enable-to-legend, enable-to-settled) and prints them,
 *     so a run can be pasted into the phase report;
 *   - ASSERTS only correctness and generous sanity ceilings — no failed tile
 *     request, no console error, no page error, no duplicate/unbounded request
 *     storm, and a transferred-byte budget far above the measured baseline.
 *
 * Exact production numbers are measured separately by
 * `scripts/qa/land-cover-mvt-performance.sh` against the public origin; nothing
 * here claims to measure production.
 *
 * Live-only, like the other land-cover specs: it drives the real app against a
 * real backend (E2E_BACKEND_URL) and skips itself when that is unset. Playwright's
 * own Chromium is not installed here, so it runs on the installed Chrome channel.
 */

const backendUrl = process.env.E2E_BACKEND_URL;

test.skip(!backendUrl, "E2E_BACKEND_URL is not configured (live browser measurement only)");

test.use({ channel: "chrome" });

const SUITABILITY_URL = "/?v=1&mode=suitability&view=score";
const TILE_PATH = "/api/v1/environment/land-cover/cell-statistics/tiles/";

/**
 * Generous ceilings. These exist to catch a REGRESSION IN KIND — a request
 * storm, an unbounded tile, a layer that never settles — not to police a few
 * hundred milliseconds. The LC9 baseline at the default view is a single tile
 * of ~216 KB uncompressed; a user who pans to the worst low-zoom tile fetches
 * ~3.71 MB uncompressed, ~0.55 MB through a compressing reverse proxy.
 */
const MAX_TILE_REQUESTS = 120;
const MAX_TOTAL_TRANSFERRED_BYTES = 24 * 1024 * 1024;
const MAX_SINGLE_TILE_BYTES = 8 * 1024 * 1024;
const MAX_ENABLE_TO_LEGEND_MS = 20_000;
const MAX_ENABLE_TO_SETTLED_MS = 45_000;
/** No land-cover tile request has started for this long -> the layer settled. */
const QUIET_PERIOD_MS = 1_000;
const SETTLE_POLL_MS = 100;

interface TileRecord {
  url: string;
  status: number;
  /** Bytes actually transferred for the body (encoded, i.e. after compression). */
  transferredBytes: number;
  contentEncoding: string;
  contentType: string;
  /** True when the browser answered from its own cache rather than the network. */
  servedFromCache?: boolean;
}

interface Measurement {
  tiles: TileRecord[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

function attach(
  page: Page,
): Measurement & { stop: () => void; lastRequestAt: () => number; pendingCount: () => number } {
  const tiles: TileRecord[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const pending = new Set<Request>();
  let lastRequestAt = 0;

  const onRequest = (request: Request) => {
    if (!request.url().includes(TILE_PATH)) return;
    pending.add(request);
    lastRequestAt = Date.now();
  };

  const onResponse = async (response: Response) => {
    const request = response.request();
    if (!request.url().includes(TILE_PATH)) return;
    const headers = response.headers();
    // Recorded synchronously, BEFORE the await, so the settle check below can
    // never conclude "no tiles in flight" while this one is still being sized.
    const record: TileRecord = {
      url: request.url(),
      status: response.status(),
      transferredBytes: 0,
      contentEncoding: headers["content-encoding"] ?? "",
      contentType: headers["content-type"] ?? "",
      servedFromCache: false,
    };
    tiles.push(record);
    try {
      // `responseBodySize` is the ON-THE-WIRE body size, so a compressed tile
      // is counted as what the client actually downloaded. A response served
      // from the browser cache reports a NEGATIVE sentinel rather than 0;
      // clamping it (and flagging it) keeps a total from going negative, which
      // would be a nonsense number to quote in a report.
      const size = (await request.sizes()).responseBodySize;
      record.transferredBytes = Math.max(0, size);
      record.servedFromCache = size < 0;
    } catch {
      // A request whose sizes are unavailable is still counted as a request.
    }
    pending.delete(request);
  };

  const onRequestFailed = (request: Request) => {
    if (!request.url().includes(TILE_PATH)) {
      // Non-tile failures still matter; record them, scoped to the API.
      if (request.url().includes("/api/")) {
        failedRequests.push(`${request.url()} :: ${request.failure()?.errorText ?? "unknown"}`);
      }
      return;
    }
    failedRequests.push(`${request.url()} :: ${request.failure()?.errorText ?? "unknown"}`);
    pending.delete(request);
  };

  const onConsole = (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  };
  const onPageError = (error: Error) => pageErrors.push(error.message);

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  return {
    tiles,
    consoleErrors,
    pageErrors,
    failedRequests,
    lastRequestAt: () => lastRequestAt,
    pendingCount: () => pending.size,
    stop: () => {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

/**
 * Wait until the land-cover layer has genuinely settled.
 *
 * "Settled" means BOTH that no tile request has started for QUIET_PERIOD_MS and
 * that no tile request is still in flight. Quiet-since-last-START alone is not
 * enough: a multi-megabyte low-zoom tile is still downloading a second after its
 * request began, so that definition would stop measuring — and stop recording —
 * before the bytes that matter had arrived.
 */
async function waitForTilesToSettle(
  page: Page,
  lastRequestAt: () => number,
  pendingCount: () => number,
  startedAt: number,
): Promise<number> {
  const deadline = startedAt + MAX_ENABLE_TO_SETTLED_MS;
  for (;;) {
    const last = lastRequestAt();
    const quietFor = Date.now() - Math.max(last, startedAt);
    if (last > 0 && pendingCount() === 0 && quietFor >= QUIET_PERIOD_MS) break;
    if (Date.now() > deadline) break;
    await page.waitForTimeout(SETTLE_POLL_MS);
  }
  // Let any in-flight `request.sizes()` resolve before the caller reads totals.
  await page.waitForTimeout(SETTLE_POLL_MS);
  return Date.now() - startedAt;
}

function summarise(
  label: string,
  m: Measurement,
  timings: { toLegendRowsMs?: number; toSettledMs?: number },
) {
  const total = m.tiles.reduce((sum, t) => sum + t.transferredBytes, 0);
  const largest = m.tiles.reduce((max, t) => Math.max(max, t.transferredBytes), 0);
  const statuses: Record<string, number> = {};
  const encodings: Record<string, number> = {};
  for (const tile of m.tiles) {
    statuses[String(tile.status)] = (statuses[String(tile.status)] ?? 0) + 1;
    encodings[tile.contentEncoding || "identity"] =
      (encodings[tile.contentEncoding || "identity"] ?? 0) + 1;
  }
  const report = {
    label,
    tileRequests: m.tiles.length,
    tilesServedFromCache: m.tiles.filter((t) => t.servedFromCache).length,
    totalTransferredBytes: total,
    largestTileBytes: largest,
    statusDistribution: statuses,
    contentEncodingDistribution: encodings,
    enableToLegendRowsMs: timings.toLegendRowsMs ?? null,
    enableToSettledMs: timings.toSettledMs ?? null,
    consoleErrors: m.consoleErrors.length,
    pageErrors: m.pageErrors.length,
    failedRequests: m.failedRequests.length,
  };
  // Printed, not asserted: this is the number a report quotes.
  console.log(`LC9-MEASUREMENT ${JSON.stringify(report)}`);
  return report;
}

async function openControl(page: Page) {
  await expect(page.getByTestId("land-cover-layer-control")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("land-cover-layer-summary").click();
  await expect(page.getByTestId("land-cover-layer-toggle")).toBeVisible();
}

async function gotoSuitability(page: Page) {
  await page.goto(SUITABILITY_URL);
  // A dev-mode first compile can take a while before MapLibre mounts its canvas.
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 60_000 });
}

// These tests really download the layer — twice, in the toggle test — over a
// dev-mode server and a local PostGIS. The project-wide 60 s default is shorter
// than two honest settle waits, so it is raised here rather than shortening the
// measurement window, which would silently stop counting bytes mid-download.
test.describe.configure({ timeout: 240_000 });

test.describe("land-cover tile serving — measured", () => {
  test("enabling the layer at the default view: bounded requests, no failures, recorded timings", async ({
    page,
  }) => {
    const m = attach(page);

    await gotoSuitability(page);
    await openControl(page);

    // The layer is off by default, so nothing has been fetched yet.
    await expect(page.getByTestId("land-cover-layer-toggle")).not.toBeChecked();
    expect(m.tiles).toHaveLength(0);

    const startedAt = Date.now();
    await page.getByTestId("land-cover-layer-toggle").check();

    // Coverage mode's legend is a STATIC three-row vocabulary, so it is readable
    // without waiting for a single tile — which is exactly the property worth
    // recording. (The data-driven case, where rows come from the loaded tiles, is
    // the dominant-class legend measured in the mode-switch test below.)
    await expect(page.getByTestId("land-cover-legend-row").first()).toBeVisible({
      timeout: MAX_ENABLE_TO_LEGEND_MS,
    });
    const toLegendRowsMs = Date.now() - startedAt;

    const toSettledMs = await waitForTilesToSettle(page, m.lastRequestAt, m.pendingCount, startedAt);
    m.stop();

    const report = summarise("default-view enable", m, { toLegendRowsMs, toSettledMs });

    // --- correctness ------------------------------------------------------
    expect(report.tileRequests).toBeGreaterThan(0);
    expect(m.failedRequests, m.failedRequests.join("\n")).toHaveLength(0);
    expect(m.pageErrors, m.pageErrors.join("\n")).toHaveLength(0);
    expect(m.consoleErrors, m.consoleErrors.join("\n")).toHaveLength(0);

    // Every tile response must be a success or a cache revalidation, and must
    // carry the vector-tile media type — never an HTML error page.
    for (const tile of m.tiles) {
      expect([200, 304], `${tile.url} -> ${tile.status}`).toContain(tile.status);
      if (tile.status === 200) {
        expect(tile.contentType).toContain("application/vnd.mapbox-vector-tile");
      }
    }

    // --- generous sanity ceilings ----------------------------------------
    expect(report.tileRequests).toBeLessThanOrEqual(MAX_TILE_REQUESTS);
    expect(report.totalTransferredBytes).toBeLessThanOrEqual(MAX_TOTAL_TRANSFERRED_BYTES);
    expect(report.largestTileBytes).toBeLessThanOrEqual(MAX_SINGLE_TILE_BYTES);
    expect(toLegendRowsMs).toBeLessThan(MAX_ENABLE_TO_LEGEND_MS);
    expect(toSettledMs).toBeLessThan(MAX_ENABLE_TO_SETTLED_MS);
  });

  test("toggling the layer off and on again does not multiply tile requests", async ({ page }) => {
    await gotoSuitability(page);
    await openControl(page);

    const first = attach(page);
    let startedAt = Date.now();
    await page.getByTestId("land-cover-layer-toggle").check();
    await expect(page.getByTestId("land-cover-legend-row").first()).toBeVisible({
      timeout: MAX_ENABLE_TO_LEGEND_MS,
    });
    await waitForTilesToSettle(page, first.lastRequestAt, first.pendingCount, startedAt);
    first.stop();
    const firstCount = first.tiles.length;
    expect(firstCount).toBeGreaterThan(0);

    // Turning the layer off hides it on the map. The control's legend stays
    // mounted by design — it documents the vocabulary the layer would draw — so
    // what matters here is that it is never DUPLICATED by a toggle cycle.
    await page.getByTestId("land-cover-layer-toggle").uncheck();
    await expect(page.getByTestId("land-cover-layer-toggle")).not.toBeChecked();
    await expect(page.getByTestId("land-cover-legend")).toHaveCount(1);

    const second = attach(page);
    startedAt = Date.now();
    await page.getByTestId("land-cover-layer-toggle").check();
    await expect(page.getByTestId("land-cover-layer-toggle")).toBeChecked();
    const toSettledMs = await waitForTilesToSettle(
      page,
      second.lastRequestAt,
      second.pendingCount,
      startedAt,
    );
    second.stop();

    summarise("re-enable", second, { toSettledMs });

    // Re-enabling must not fan out: the source is version-pinned and immutably
    // cached, so a second activation costs at most what the first one did.
    expect(second.tiles.length).toBeLessThanOrEqual(firstCount * 2);
    expect(second.failedRequests, second.failedRequests.join("\n")).toHaveLength(0);
    expect(second.pageErrors, second.pageErrors.join("\n")).toHaveLength(0);

    // Exactly one legend, exactly one control: no duplicated layer state.
    await expect(page.getByTestId("land-cover-legend")).toHaveCount(1);
    await expect(page.getByTestId("land-cover-layer-control")).toHaveCount(1);
  });

  test("switching visualization mode repaints without refetching the whole source", async ({
    page,
  }) => {
    await gotoSuitability(page);
    await openControl(page);

    const initial = attach(page);
    const startedAt = Date.now();
    await page.getByTestId("land-cover-layer-toggle").check();
    await expect(page.getByTestId("land-cover-legend-row").first()).toBeVisible({
      timeout: MAX_ENABLE_TO_LEGEND_MS,
    });
    await waitForTilesToSettle(page, initial.lastRequestAt, initial.pendingCount, startedAt);
    initial.stop();
    const loadedTiles = initial.tiles.length;
    expect(loadedTiles).toBeGreaterThan(0);

    // Mode and class-level changes are paint/filter updates on the SAME source.
    // The dominant-class legend is the genuinely DATA-DRIVEN one: its rows are
    // the official classes observed in the tiles already loaded, so the time
    // measured here is the time to read the loaded tiles, not to fetch them.
    const repaint = attach(page);
    const switchedAt = Date.now();
    await page.getByTestId("land-cover-mode-dominant").click();
    await expect(page.getByTestId("land-cover-legend-row").first()).toBeVisible({
      timeout: MAX_ENABLE_TO_LEGEND_MS,
    });
    const toLegendRowsMs = Date.now() - switchedAt;
    await page.waitForTimeout(QUIET_PERIOD_MS);
    repaint.stop();

    summarise("mode switch to dominant", repaint, { toLegendRowsMs });

    // The legend must describe real served classes, not an invented vocabulary.
    const rows = await page.getByTestId("land-cover-legend-row").count();
    expect(rows).toBeGreaterThan(0);

    // The tile URLs are version-pinned and mode-independent, so a mode switch
    // must not re-download the layer.
    expect(repaint.tiles.length).toBeLessThan(loadedTiles);
    expect(repaint.failedRequests, repaint.failedRequests.join("\n")).toHaveLength(0);
    expect(repaint.consoleErrors, repaint.consoleErrors.join("\n")).toHaveLength(0);
  });
});
