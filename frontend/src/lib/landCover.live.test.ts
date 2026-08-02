/**
 * LIVE land-cover integration test (Phase 1B-LC5A) — the real frontend client
 * against the real running backend, with no mocks anywhere.
 *
 * Mirrors the repo's existing live-test convention (the Playwright specs gated on
 * E2E_BACKEND_URL): this file SKIPS ITSELF unless `LC_LIVE_BACKEND_URL` points at a
 * platform backend, so the default `npm test` run stays hermetic. Run it with:
 *
 *   LC_LIVE_BACKEND_URL=http://localhost:8000 npx vitest run src/lib/landCover.live.test.ts
 *
 * What it proves that the mocked tests cannot: the TypeScript response types and the
 * validators accept what the LC4 API ACTUALLY serves, for all three coverage states,
 * on candidate keys DISCOVERED from the live release rather than remembered.
 *
 * Strictly read-only: every request is a GET against the read-only statistics
 * endpoints. Nothing is written, and no official data is modified.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  fetchLandCoverCellClasses,
  fetchLandCoverCellStatistics,
  fetchJson,
  type LandCoverCoverageStatus,
} from "./api";
import { classRowsForLevel, validateCellStatistics, validateClassDistribution } from "./landCover";

const liveBaseUrl = process.env.LC_LIVE_BACKEND_URL;
const BASE = "/api/v1/environment/land-cover/cell-statistics";

/** The bounded cell list, used only to DISCOVER a real key per coverage status. */
interface CellListResponse {
  total: number;
  items: Array<{ candidate_key: string; coverage_status: LandCoverCoverageStatus }>;
}

async function discoverKey(status: LandCoverCoverageStatus): Promise<string> {
  const listing = await fetchJson<CellListResponse>(
    `${BASE}/cells?coverage_status=${status}&limit=1&sort=candidate_key`,
  );
  expect(listing.total).toBeGreaterThan(0);
  expect(listing.items).toHaveLength(1);
  expect(listing.items[0].coverage_status).toBe(status);
  return listing.items[0].candidate_key;
}

describe.skipIf(!liveBaseUrl)("LC4 land-cover API — live backend", () => {
  beforeAll(() => {
    // `apiBaseUrl()` reads this lazily, so assigning it here is enough.
    process.env.NEXT_PUBLIC_API_BASE_URL = liveBaseUrl;
  });

  it("serves an active statistics release", async () => {
    const release = await fetchJson<{
      status: string;
      is_active: boolean;
      derivation_version: string;
      disclosures: {
        license_status: string;
        authorization_basis: string;
        public_statement_ko: string;
        used_in_suitability_scoring: boolean;
        attribution: {
          provider: string;
          official_dataset_name: string;
          reference_period: string;
          official_source_url: string;
          attribution_ko: string;
          statistics_version_id: number | null;
        };
      };
    }>(`${BASE}/release`);
    expect(release.status).toBe("SUCCEEDED");
    expect(release.is_active).toBe(true);
    // The disclosures the panel renders must really be served this way.
    expect(release.disclosures.used_in_suitability_scoring).toBe(false);
    expect(release.disclosures.license_status).toBe(
      "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER",
    );
    expect(release.disclosures.authorization_basis).toBe(
      "GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION",
    );
    // Mandatory attribution really travels with the response (Phase 1B-LC8).
    const attribution = release.disclosures.attribution;
    expect(attribution.provider).toContain("환경공간정보서비스");
    expect(attribution.official_dataset_name).toContain("세분류 [2025]");
    expect(attribution.reference_period).toBe("2025");
    expect(attribution.official_source_url).toMatch(/^https:\/\//);
    expect(attribution.attribution_ko).toContain("500 m 후보격자");
    expect(attribution.statistics_version_id).not.toBeNull();
    // No EGIS KOGL type may be asserted anywhere in the served disclosure text.
    expect(release.disclosures.public_statement_ko).not.toMatch(/KOGL|공공누리|제1유형/);
  });

  it("parses and validates a real COMPLETE_EXACT cell", async () => {
    const key = await discoverKey("COMPLETE_EXACT");
    const detail = validateCellStatistics(
      await fetchLandCoverCellStatistics(key, new AbortController().signal),
      key,
    );
    expect(detail).not.toBeNull();
    expect(detail?.coverage_status).toBe("COMPLETE_EXACT");
    expect(detail?.used_in_suitability_scoring).toBe(false);
    expect(detail?.disclosures.license_status).toBe(
      "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER",
    );
    // A fully evaluated cell has a real dominant class at every level.
    expect(detail?.dominant_class.l1_code).toBeTruthy();
    expect(detail?.dominant_class.l3_name).toBeTruthy();

    const classes = validateClassDistribution(
      await fetchLandCoverCellClasses(key, new AbortController().signal),
      key,
    );
    expect(classes).not.toBeNull();
    expect(classes?.items.length).toBeGreaterThan(0);
    // All three official levels are present and each level's rows are area-descending.
    for (const level of [1, 2, 3] as const) {
      const rows = classRowsForLevel(classes!.items, level);
      expect(rows.length).toBeGreaterThan(0);
      const areas = rows.map((row) => row.class_area_m2);
      expect(areas).toEqual([...areas].sort((a, b) => b - a));
    }
  });

  it("parses and validates a real PARTIAL cell, with both share denominators", async () => {
    const key = await discoverKey("PARTIAL");
    const detail = validateCellStatistics(
      await fetchLandCoverCellStatistics(key, new AbortController().signal),
      key,
    );
    expect(detail).not.toBeNull();
    expect(detail?.coverage_status).toBe("PARTIAL");
    // A PARTIAL cell always has a non-empty uncovered residual, by LC3's definition.
    expect(detail!.uncovered_residual_area_m2).toBeGreaterThan(0);
    expect(detail!.evaluated_area_m2).toBeGreaterThan(0);

    const classes = validateClassDistribution(
      await fetchLandCoverCellClasses(key, new AbortController().signal),
      key,
    );
    expect(classes).not.toBeNull();
    for (const row of classes!.items) {
      // Both denominators are always served for an evaluated cell.
      expect(row.share_of_evaluated_area).not.toBeNull();
      expect(row.share_of_cell_area).not.toBeNull();
      // The evaluated-area share is never smaller than the whole-cell share, up to
      // double precision: LC3's exact-residual rule admits PARTIAL cells whose
      // uncovered residual is non-empty but sub-nanometre in area, where the two
      // shares are equal to within float noise rather than visibly different.
      expect(row.share_of_evaluated_area!).toBeGreaterThanOrEqual(row.share_of_cell_area! - 1e-9);
    }
  });

  it("keeps the two share denominators genuinely distinct on a mid-coverage PARTIAL cell", async () => {
    // Discovered, not remembered: a cell in the 20–80% band, where the difference
    // between the two denominators is a real quantity a reader could misread.
    const listing = await fetchJson<CellListResponse>(
      `${BASE}/cells?coverage_status=PARTIAL&min_coverage_ratio=0.2&max_coverage_ratio=0.8&limit=1`,
    );
    expect(listing.total).toBeGreaterThan(0);
    const key = listing.items[0].candidate_key;

    const detail = await fetchLandCoverCellStatistics(key, new AbortController().signal);
    expect(detail.coverage_ratio).toBeGreaterThan(0.2);
    expect(detail.coverage_ratio).toBeLessThan(0.8);

    const classes = validateClassDistribution(
      await fetchLandCoverCellClasses(key, new AbortController().signal),
      key,
    );
    expect(classes!.items.length).toBeGreaterThan(0);
    for (const row of classes!.items) {
      // Strictly greater here, and related by exactly the coverage ratio — proving
      // the API really serves two different denominators rather than one number twice.
      expect(row.share_of_evaluated_area!).toBeGreaterThan(row.share_of_cell_area!);
      expect(row.share_of_cell_area! / row.share_of_evaluated_area!).toBeCloseTo(
        detail.coverage_ratio,
        6,
      );
    }
  });

  it("parses a real NO_COVERAGE cell: null dominant classes and NO class rows", async () => {
    const key = await discoverKey("NO_COVERAGE");
    const detail = validateCellStatistics(
      await fetchLandCoverCellStatistics(key, new AbortController().signal),
      key,
    );
    expect(detail).not.toBeNull();
    expect(detail?.coverage_status).toBe("NO_COVERAGE");
    expect(detail?.evaluated_area_m2).toBe(0);
    expect(detail!.uncovered_area_m2).toBeGreaterThan(0);
    // Nulls, not empty strings and not zero class codes.
    expect(detail?.dominant_class.l1_code).toBeNull();
    expect(detail?.dominant_class.l2_code).toBeNull();
    expect(detail?.dominant_class.l3_code).toBeNull();
    expect(detail?.class_counts.l1_class_count).toBe(0);
    // The Korean warning the panel renders is really served.
    expect(detail?.disclosures.no_coverage_warning_ko).toContain("평가하지 않았다는 뜻입니다");

    const classes = validateClassDistribution(
      await fetchLandCoverCellClasses(key, new AbortController().signal),
      key,
    );
    expect(classes).not.toBeNull();
    expect(classes?.total).toBe(0);
    expect(classes?.items).toEqual([]);
  });

  it("404s an unknown candidate key with the structured LC4 error", async () => {
    const unknown = "capital-grid-500m-v1:9999_9999";
    await expect(
      fetchLandCoverCellStatistics(unknown, new AbortController().signal),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("percent-encodes the canonical key so the colon round-trips", async () => {
    const key = await discoverKey("COMPLETE_EXACT");
    expect(key).toContain(":");
    const detail = await fetchLandCoverCellStatistics(key, new AbortController().signal);
    expect(detail.candidate_key).toBe(key);
  });
});
