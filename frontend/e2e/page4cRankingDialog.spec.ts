import { expect, test, type Page, type Route } from "@playwright/test";
import { mockSuitabilityBackend } from "./suitabilityFixtures";

/**
 * PAGE 4C — 순위 전체보기 and 순위 CSV 내보내기, in a real browser.
 *
 * The Vitest integration file owns the request contract (what the page SENDS).
 * This owns what only a browser can show: that the dialog is genuinely modal and
 * keyboard-operable, that paging and the direction toggle move real rows, that
 * the footer actions sit where Figma 138:415 puts them, and that a downloaded CSV
 * really does contain the whole ACTIVE scope rather than the visible page.
 *
 * SELF-MOCKED. `suitabilityFixtures.rankingCollection` holds three rows and
 * ignores `limit`/`offset`, which is right for the layout specs that use it but
 * cannot exercise paging. Rather than change that shared fixture (and disturb the
 * specs that depend on its exact three rows), this file registers its OWN
 * paging-aware `/candidates` route afterwards — Playwright matches the most
 * recently registered route first.
 *
 * Structure and behaviour only, never a fixture value. No backend, no database.
 */

/** The synthetic ranked population. Large enough to need several pages. */
const POPULATION = 130;
const PAGE_SIZE = 50;

/** One 500 m candidate cell. Rank drives the score, so an order change is visible. */
function cell(rank: number) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [126.5, 37.7] },
    properties: {
      candidate_id: 7000 + rank,
      candidate_key: `cap500-${String(rank).padStart(6, "0")}`,
      status: "ELIGIBLE",
      profile: "baseline",
      is_excluded: false,
      rank,
      total_score: (100 - rank * 0.1).toFixed(4),
      provisional_score: null,
      zoning_score: "55.0000",
      road_score: "100.0000",
      equity_score: "100.0000",
      demand_score: "50.0000",
      sido_region_code: "KR-SGIS-23",
      sido_region_name: "인천광역시",
      sigungu_region_code: "KR-SGIS-23510",
      sigungu_region_name: "인천광역시 강화군",
      nearest_road_distance_m: "120.0",
      stable_count: 3,
      stability_class: "STABLE",
      stability_membership: {},
      exclusion_reasons: [],
      review_reasons: [],
    },
  };
}

/**
 * A `/suitability/candidates` that honours `limit`, `offset` and `sort` the way
 * the real route does — including `total_matched` being the count over the WHOLE
 * filter, independent of the page being read.
 */
function pagedRanking(url: URL, total: number) {
  const sort = url.searchParams.get("sort") ?? "score_desc";
  const limit = Number(url.searchParams.get("limit") ?? 500);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const ranks = Array.from({ length: total }, (_, i) => i + 1);
  // The BACKEND serves the other end of the ordering; the page never reverses.
  const ordered = sort === "score_asc" ? ranks.slice().reverse() : ranks;
  const slice = ordered.slice(offset, offset + limit);
  return {
    type: "FeatureCollection",
    indicator: "SUITABILITY_SCREENING",
    derivation_version: "suitability-screening-v3",
    policy_version: "suitability-policy-v2",
    candidate_grid_version: "capital-grid-500m-v1",
    weight_profile: url.searchParams.get("profile") ?? "baseline",
    reference_year: 2024,
    run_id: 47,
    count: slice.length,
    total_matched: total,
    limit,
    offset,
    sido: url.searchParams.get("sido"),
    sigungu: url.searchParams.getAll("sigungu").filter((code) => code !== ""),
    sort,
    features: slice.map(cell),
    assumptions: [],
    disclaimer: "Analytical screening only — not a legal determination.",
  };
}

async function openScoreView(page: Page, total = POPULATION): Promise<void> {
  await mockSuitabilityBackend(page);
  // Registered AFTER the shared fixture so this paging-aware handler wins.
  await page.route("**/api/v1/suitability/candidates?*", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pagedRanking(new URL(route.request().url()), total)),
    }),
  );
  await page.goto("/?v=1&mode=suitability&view=score");
  await expect(page.getByTestId("map-container")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("suitability-summary")).toBeVisible();
  await expect(page.getByTestId("candidate-ranking-counts")).toBeVisible();
}

async function openDialog(page: Page): Promise<void> {
  await page.getByTestId("open-full-ranking").click();
  await expect(page.getByTestId("suitability-ranking-dialog")).toBeVisible();
  await expect(page.getByTestId("ranking-dialog-table")).toBeVisible();
}

test.use({ viewport: { width: 1440, height: 900 } });

// --------------------------------------------------------------------------- //
// Dialog behaviour and accessibility
// --------------------------------------------------------------------------- //

test.describe("순위 전체보기 dialog", () => {
  test("opens from ③, traps focus, and Escape returns focus to the trigger", async ({ page }) => {
    await openScoreView(page);
    const trigger = page.getByTestId("open-full-ranking");
    await trigger.focus();
    await openDialog(page);

    const panel = page.getByTestId("suitability-ranking-dialog");
    await expect(panel).toHaveAttribute("aria-modal", "true");
    await expect(panel).toHaveAttribute("role", "dialog");

    // Focus is INSIDE the panel, and stays there across a Tab cycle.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await panel.evaluate((el) => el.contains(document.activeElement));
      expect(inside, `focus stays inside the dialog after ${i + 1} tabs`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the page behind cannot scroll while the dialog is open", async ({ page }) => {
    await openScoreView(page);
    await openDialog(page);
    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).toBe("hidden");
  });

  test("closes from both the header ✕ and the footer 닫기", async ({ page }) => {
    await openScoreView(page);
    await openDialog(page);
    await page.getByTestId("suitability-ranking-dialog-close").click();
    await expect(page.getByTestId("suitability-ranking-dialog")).toBeHidden();

    await openDialog(page);
    await page.getByTestId("ranking-dialog-close-action").click();
    await expect(page.getByTestId("suitability-ranking-dialog")).toBeHidden();
  });
});

// --------------------------------------------------------------------------- //
// Visual parity with Figma 138:415 — semantics, not pixels
// --------------------------------------------------------------------------- //

test.describe("Figma 138:415 parity", () => {
  test("lays out title, subtitle, table, count line and the two footer actions", async ({
    page,
  }) => {
    await openScoreView(page);
    await openDialog(page);
    const panel = page.getByTestId("suitability-ranking-dialog");

    await expect(panel.locator(".wep-dialog-title")).toHaveText("순위 전체보기");
    await expect(panel.locator(".wep-dialog-desc")).toBeVisible();
    await expect(page.getByTestId("ranking-dialog-counts")).toBeVisible();

    // The count line sits LEFT of the actions, as in the Figma footer.
    const counts = (await page.getByTestId("ranking-dialog-counts").boundingBox())!;
    const csv = (await page.getByTestId("ranking-dialog-export").boundingBox())!;
    const close = (await page.getByTestId("ranking-dialog-close-action").boundingBox())!;
    expect(counts.x).toBeLessThan(csv.x);
    // 순위 CSV 내보내기 (outline) precedes 닫기 (primary).
    expect(csv.x).toBeLessThan(close.x);

    // The panel is a wide modal, not a narrow drawer.
    const box = (await panel.boundingBox())!;
    expect(box.width).toBeGreaterThan(900);
    expect(box.height).toBeLessThanOrEqual(900);
  });

  test("carries NO 62-point pass wording and no mock candidates", async ({ page }) => {
    await openScoreView(page);
    await openDialog(page);
    const text = (await page.getByTestId("suitability-ranking-dialog").innerText()) ?? "";
    // Phrases, not bare numbers: a served score is rendered with four decimals,
    // so a legitimate 33.0062점 contains "62점" as a substring. What must be gone
    // is the Figma subtitle's THRESHOLD RULE.
    expect(text).not.toContain("스크리닝 통과 62점 기준");
    expect(text).not.toMatch(/\d+(\.\d+)?점\s*(이상|미만|기준)/);
    expect(text).not.toContain("합격");
    // The Figma subtitle's replacement states what is actually true.
    expect(text).toContain("스크리닝 통과");
  });

  test("every row stays a 500m candidate cell, never a city", async ({ page }) => {
    await openScoreView(page);
    await openDialog(page);
    const rows = page.getByTestId("ranking-dialog-row");
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(rows.first()).toContainText("500m 후보 구역");
    await expect(rows.first()).toContainText("cap500-000001");
    // Distinct cell keys, even though all rows share one 시·군·구.
    const keys = await page.getByTestId("ranking-dialog-candidate-key").allInnerTexts();
    expect(new Set(keys).size).toBe(PAGE_SIZE);
  });
});

// --------------------------------------------------------------------------- //
// Paging and direction
// --------------------------------------------------------------------------- //

test.describe("paging and direction", () => {
  test("pages through the ranking with keyboard-operable controls", async ({ page }) => {
    await openScoreView(page);
    await openDialog(page);

    await expect(page.getByTestId("ranking-dialog-page-label")).toContainText("1 / 3");
    await expect(page.getByTestId("ranking-dialog-counts")).toContainText(String(POPULATION));
    await expect(page.getByTestId("ranking-dialog-prev")).toBeDisabled();

    // Driven by the keyboard, not a click — the pager must be reachable.
    await page.getByTestId("ranking-dialog-next").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ranking-dialog-row").first()).toContainText(
      `${PAGE_SIZE + 1}위`,
    );
    await expect(page.getByTestId("ranking-dialog-page-label")).toContainText("2 / 3");

    await page.getByTestId("ranking-dialog-prev").click();
    await expect(page.getByTestId("ranking-dialog-row").first()).toContainText("1위");

    // The last page is short and its 다음 is disabled.
    await page.getByTestId("ranking-dialog-next").click();
    await page.getByTestId("ranking-dialog-next").click();
    await expect(page.getByTestId("ranking-dialog-next")).toBeDisabled();
    await expect(page.getByTestId("ranking-dialog-row")).toHaveCount(POPULATION - 2 * PAGE_SIZE);
  });

  test("낮은 순 re-requests from the backend rather than reversing the page", async ({ page }) => {
    await openScoreView(page);
    await openDialog(page);
    await expect(page.getByTestId("ranking-dialog-row").first()).toContainText("1위");

    const request = page.waitForRequest(
      (r) => r.url().includes("/suitability/candidates?") && r.url().includes("sort=score_asc"),
    );
    await page.getByTestId("ranking-dialog-sort-score_asc").click();
    await request;

    await expect(page.getByTestId("ranking-dialog-row").first()).toContainText(`${POPULATION}위`);
    // The card behind moved with it.
    await expect(page.getByTestId("candidate-sort-score_asc")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("a zero-result scope shows an honest empty state and disables the export", async ({
    page,
  }) => {
    await openScoreView(page, 0);
    await page.getByTestId("open-full-ranking").click();
    await expect(page.getByTestId("ranking-dialog-empty")).toBeVisible();
    await expect(page.getByTestId("ranking-dialog-table")).toHaveCount(0);
    await expect(page.getByTestId("ranking-dialog-error")).toHaveCount(0);
    await expect(page.getByTestId("ranking-dialog-counts")).toContainText("0");
    await expect(page.getByTestId("ranking-dialog-export")).toBeDisabled();
    await expect(page.getByTestId("ranking-dialog-pager")).toHaveCount(0);
  });
});

// --------------------------------------------------------------------------- //
// CSV export — a real download, read back
// --------------------------------------------------------------------------- //

test.describe("순위 CSV 내보내기", () => {
  test("downloads the WHOLE active ranking, not the visible page", async ({ page }) => {
    await openScoreView(page);
    // Narrow the scope first, so the file must prove it followed it.
    await page.getByTestId("suitability-scope-pill-23").click();
    await openDialog(page);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("ranking-dialog-export").click();
    const download = await downloadPromise;

    const filename = download.suggestedFilename();
    expect(filename).toContain("인천");
    expect(filename.endsWith(".csv")).toBe(true);

    const path = await download.path();
    const body = await (await import("node:fs/promises")).readFile(path!, "utf8");

    // The provenance the file must carry about its own scope.
    expect(body).toContain("분석 범위,인천");
    expect(body).toContain("순위 방향,높은 순");
    expect(body).toContain(`범위 내 총 후보 구역 수,${POPULATION}`);
    expect(body).toContain("내보내기 범위,현재 범위의 전체 순위");

    // Every matched cell, not the 50 that were on screen.
    expect(body).toContain("cap500-000001");
    expect(body).toContain(`cap500-${String(POPULATION).padStart(6, "0")}`);
    const dataLines = body.split("\r\n").filter((line) => /^\d+,500m 후보 구역,/.test(line));
    expect(dataLines).toHaveLength(POPULATION);

    // …and no invented pass threshold anywhere in it.
    expect(body).not.toContain("스크리닝 통과 62점 기준");
    expect(body).not.toMatch(/\d+(\.\d+)?점\s*(이상|미만|기준)/);
  });

  test("exports in score_asc order when 낮은 순 is active", async ({ page }) => {
    await openScoreView(page);
    await openDialog(page);
    await page.getByTestId("ranking-dialog-sort-score_asc").click();
    await expect(page.getByTestId("ranking-dialog-row").first()).toContainText(`${POPULATION}위`);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("ranking-dialog-export").click();
    const download = await downloadPromise;
    const body = await (await import("node:fs/promises")).readFile((await download.path())!, "utf8");

    expect(body).toContain("순위 방향,낮은 순");
    expect(download.suggestedFilename()).toContain("낮은_순");
    const dataLines = body.split("\r\n").filter((line) => /^\d+,500m 후보 구역,/.test(line));
    // The served order, verbatim: worst rank first, best last.
    expect(dataLines[0].startsWith(`${POPULATION},`)).toBe(true);
    expect(dataLines[dataLines.length - 1].startsWith("1,")).toBe(true);
  });
});
