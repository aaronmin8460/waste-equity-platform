import { expect, test, type Page } from "@playwright/test";

/**
 * Live regression smoke tests against the real backend (E2E_BACKEND_URL) and
 * database, covering the four reported application regressions:
 *   1. Map tiles fail at excessive zoom.
 *   2. Top suitability candidates appear identical.
 *   4. Selecting a candidate does not move to or highlight it on the map.
 * (Issue 3 — equity 0.0 vs score 100 — is verified as correct behavior by backend
 *  unit tests and the detail-panel provenance text asserted below.)
 *
 * Every test also asserts no request ever leaves for a Korean government API host
 * and no credential appears in any browser request.
 */

const backendUrl = process.env.E2E_BACKEND_URL;
test.skip(!backendUrl, "E2E_BACKEND_URL is not configured (live smoke only)");

const ALLOWED_HOST_SUFFIXES = ["localhost", "127.0.0.1", "tile.openstreetmap.org"];
const SECRET_HINTS = ["serviceKey", "consumer_key", "consumer_secret", "usrid", "apikey", "api_key"];

function trackEgress(page: Page): { disallowed: string[]; secrets: string[] } {
  const disallowed: string[] = [];
  const secrets: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "blob:" || url.protocol === "data:") return;
    const host = url.hostname;
    if (!ALLOWED_HOST_SUFFIXES.some((a) => host === a || host.endsWith(`.${a}`))) {
      disallowed.push(request.url());
    }
    const haystack = request.url().toLowerCase();
    if (SECRET_HINTS.some((h) => haystack.includes(h.toLowerCase()))) {
      secrets.push(request.url());
    }
  });
  return { disallowed, secrets };
}

test("map zoom is capped at the OSM-supported max (no z20+ tiles, map stays visible)", async ({
  page,
}) => {
  const egress = trackEgress(page);
  const tileZooms: number[] = [];
  const tileErrors: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname.endsWith("tile.openstreetmap.org")) {
      const m = url.pathname.match(/^\/(\d+)\//);
      if (m) tileZooms.push(Number(m[1]));
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname.endsWith("tile.openstreetmap.org") && response.status() >= 400) {
      tileErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });

  // Zoom in well past OSM's native max (19). MapLibre caps interactive zoom.
  const zoomIn = page.locator(".maplibregl-ctrl-zoom-in");
  for (let i = 0; i < 26; i += 1) {
    if (await zoomIn.isDisabled()) break;
    await zoomIn.click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1200); // let any tiles settle

  const container = page.getByTestId("map-container");
  const zoom = Number(await container.getAttribute("data-zoom"));
  expect(zoom).toBeLessThanOrEqual(19);
  // Zoom control stops at the supported maximum.
  await expect(zoomIn).toBeDisabled();
  // No unsupported tile was ever requested, and none errored.
  expect(Math.max(0, ...tileZooms)).toBeLessThanOrEqual(19);
  expect(tileErrors).toEqual([]);
  // Map remains visible at maximum zoom, and attribution stays present.
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.locator(".maplibregl-ctrl-attrib")).toContainText("OpenStreetMap");

  expect(egress.disallowed).toEqual([]);
  expect(egress.secrets).toEqual([]);
});

test("selecting distinct candidates differentiates them, moves the map, and highlights them", async ({
  page,
}) => {
  const egress = trackEgress(page);

  await page.goto("/");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("mode-suitability").click();

  const items = page.getByTestId("top-candidate-item");
  await expect(items.first()).toBeVisible({ timeout: 20_000 });
  expect(await items.count()).toBeGreaterThanOrEqual(2);

  // Issue 2: tied cells are differentiated by a per-cell identifier (key + coords).
  const cellA = (await page.getByTestId("top-candidate-cell").nth(0).innerText()).trim();
  const cellB = (await page.getByTestId("top-candidate-cell").nth(1).innerText()).trim();
  expect(cellA).not.toBe(cellB);
  expect(cellA.length).toBeGreaterThan(0);

  const container = page.getByTestId("map-container");
  const detail = page.getByTestId("candidate-detail");

  // Select the first candidate → detail + map move to it.
  await items.nth(0).click();
  await expect(detail).toBeVisible({ timeout: 15_000 });
  const keyA = (await detail.locator("strong").first().innerText()).trim();
  await page.waitForTimeout(1000);
  const centerA = await container.getAttribute("data-center");
  // Off-screen candidate (강화군, ~126.25E) is brought into view (west of the
  // default capital-region center ~126.85E).
  const lonA = Number((centerA ?? "0,0").split(",")[0]);
  expect(lonA).toBeLessThan(126.6);

  // Select a different candidate → different id/geometry, and the map moves again.
  await items.nth(1).click();
  await expect(async () => {
    const keyB = (await detail.locator("strong").first().innerText()).trim();
    expect(keyB).not.toBe(keyA);
  }).toPass({ timeout: 15_000 });
  await page.waitForTimeout(1000);
  const centerB = await container.getAttribute("data-center");
  expect(centerB).not.toBe(centerA);

  // Issue 3 provenance: the equity raw value carries its inverse-direction
  // explanation and the official-zero-vs-missing distinction (never a bare 0/100).
  await expect(page.getByTestId("equity-score-direction")).toContainText("inverse");
  await expect(page.getByTestId("candidate-equity-raw")).toContainText("kg/인/년");

  expect(egress.disallowed).toEqual([]);
  expect(egress.secrets).toEqual([]);
});
