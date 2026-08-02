// @vitest-environment jsdom

/**
 * LandCoverCellPanel tests (Phase 1B-LC5A) — the 토지피복 section of the suitability
 * candidate-detail panel.
 *
 * The network is stubbed at `fetch`, not at the API module, so these also prove the
 * REQUEST side of the contract: that the panel asks for the selected candidate's own
 * stable key (percent-encoded), asks for nothing until it has one, and never asks for
 * raw land-cover features or geometry.
 *
 * Every fixture value is a SYNTHETIC test fixture — never official public data. The
 * assertions are about behaviour and honesty rules, never about the numbers as facts.
 */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LandCoverCellPanel from "./LandCoverCellPanel";
import type {
  LandCoverCellClassDistribution,
  LandCoverCellStatistics,
  LandCoverClassShare,
  LandCoverCoverageStatus,
} from "../lib/api";

const COMPLETE_KEY = "capital-grid-500m-v1:1750_3832";
const PARTIAL_KEY = "capital-grid-500m-v1:1807_3923";
const NO_COVERAGE_KEY = "capital-grid-500m-v1:1492_4000";

const LICENSE_STATEMENT =
  "Public deployment of the derived land-cover services is authorized for the Waste Equity Platform under project-level authorization from its cooperating government institution. This operational authorization does not assert a dataset-specific EGIS KOGL type. Original SHP files, raw source polygons, and raw per-feature source records are not redistributed.";
const PUBLIC_STATEMENT_KO =
  "본 플랫폼은 협력 정부기관이 확인한 프로젝트 차원의 공공데이터 활용 범위에 따라 공개 운영됩니다. 토지피복 정보는 EGIS 「세분류 [2025] 전국 토지피복지도」를 Waste Equity Platform의 500 m 후보격자 단위로 가공한 파생 통계입니다. 원본 SHP 파일, 원본 토지피복 도형 및 원본 개별 피처 레코드는 제공하지 않습니다.";
const ATTRIBUTION_KO =
  "출처: 기후에너지환경부 환경공간정보서비스(EGIS), 「세분류 [2025] 전국 토지피복지도」. Waste Equity Platform이 서울·인천·경기 500 m 후보격자 단위로 가공한 파생 통계입니다.";
const NO_COVERAGE_WARNING_KO =
  "‘미평가(NO_COVERAGE)’는 확보된 토지피복 자료의 범위가 해당 후보 격자를 평가하지 않았다는 뜻입니다. 토지피복이 없거나 비어 있거나 이용되지 않는 토지라는 의미가 아니며, 적합하거나 안전하다는 의미도 아닙니다.";

const COVERAGE_MEANINGS: Record<LandCoverCoverageStatus, string> = {
  COMPLETE_EXACT:
    "The polygonal residual of (candidate cell − evaluated land-cover union) is EMPTY under the LC3 exact topology rule.",
  PARTIAL:
    "Some polygonal land-cover intersection exists, but the candidate cell has a non-empty uncovered residual.",
  NO_COVERAGE:
    "No polygonal land-cover feature from the acquired release intersects the candidate cell.",
};

function disclosures() {
  return {
    reference_period: "2025",
    license_status: "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER",
    license_statement: LICENSE_STATEMENT,
    authorization_basis: "GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION",
    public_statement_ko: PUBLIC_STATEMENT_KO,
    attribution: {
      provider: "기후에너지환경부 환경공간정보서비스(EGIS)",
      official_dataset_name: "세분류 [2025] 전국 토지피복지도",
      reference_period: "2025",
      official_source_url: "https://aid.mcee.go.kr/intro/land.do",
      transformation_version: "land-cover-v1",
      candidate_grid_version: "capital-grid-500m-v1",
      statistics_derivation_version: "land-cover-cell-stats-v1",
      statistics_version_id: 1,
      attribution_ko: ATTRIBUTION_KO,
      raw_source_not_returned_ko:
        "원본 SHP 파일, 원본 토지피복 도형 및 원본 개별 피처 레코드는 제공하지 않습니다.",
      authorization_status: "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER",
      authorization_basis: "GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION",
    },
    license_note: "EGIS/KOGL 벡터 토지피복지도 다운로드 약관 — 서면 재확인 필요",
    used_in_suitability_scoring: false,
    scoring_statement:
      "These statistics are descriptive and are not used in suitability scoring.",
    coverage_status_semantics: COVERAGE_MEANINGS,
    no_coverage_warning_ko: NO_COVERAGE_WARNING_KO,
    uncovered_area_statement:
      "uncovered_area_m2 is a coverage measurement on the cell, never a land-cover class.",
    class_label_statement:
      "Official source class codes and Korean names are preserved verbatim as stored by LC3.",
    raw_feature_exposure_statement:
      "This API exposes only aggregated per-cell statistics.",
    availability_statement:
      "Publicly deployed and verified against the production database (Phase 1B-LC8). Only derived 500 m candidate-cell statistics are served; the raw source-feature tables are not deployed to production.",
    lifecycle: {
      source_contract_validation: "LIVE_VERIFIED",
      database_ingestion: "DERIVED_STATISTICS_DEPLOYED_RAW_SOURCE_LOCAL_ONLY",
      cell_statistics_derivation: "IMPLEMENTED_AND_VERIFIED",
      api_exposure: "PUBLIC_DEPLOYED_AND_VERIFIED",
      frontend_exposure: "PUBLIC_DEPLOYED_AND_VERIFIED",
      vector_tiles: "PUBLIC_DEPLOYED_AND_VERIFIED",
      scoring_integration: "NOT_IMPLEMENTED",
      production_deployment: "PUBLIC_DEPLOYED",
    },
  };
}

function release() {
  return {
    statistics_version_id: 1,
    status: "SUCCEEDED",
    derivation_version: "land-cover-cell-stats-v1",
    area_crs: "EPSG:5186",
    candidate_grid_version: "capital-grid-500m-v1",
    candidate_grid_fingerprint: "dd327d5a",
    land_cover_dataset_version_id: 212,
    reference_period: "2025",
    expected_cell_count: 47893,
    processed_cell_count: 47893,
  };
}

function counts(l1: number, l2: number, l3: number, sum: number) {
  return {
    l1_class_count: l1,
    l2_class_count: l2,
    l3_class_count: l3,
    l1_class_area_sum_m2: sum,
    l2_class_area_sum_m2: sum,
    l3_class_area_sum_m2: sum,
  };
}

function cellStats(
  candidateKey: string,
  status: LandCoverCoverageStatus,
  overrides: Partial<LandCoverCellStatistics> = {},
): LandCoverCellStatistics {
  return {
    candidate_grid_version: "capital-grid-500m-v1",
    candidate_key: candidateKey,
    candidate_geometry_fingerprint: "2be0abff",
    sido_region_code: "KR-SGIS-23",
    sido_region_name: "인천광역시",
    sigungu_region_code: "KR-SGIS-23520",
    sigungu_region_name: "인천광역시 옹진군",
    cell_area_m2: 247457.80333858193,
    evaluated_area_m2: 247457.80333858574,
    uncovered_area_m2: 0,
    uncovered_residual_area_m2: 0,
    coverage_ratio: 1,
    coverage_status: status,
    coverage_status_meaning: COVERAGE_MEANINGS[status],
    topological_cover_predicate: false,
    intersection_area_sum_m2: 247457.80333858577,
    overlap_area_m2: 0,
    matched_feature_count: 16,
    dominant_class: {
      l1_code: "300",
      l1_name: "산림지역",
      l2_code: "320",
      l2_name: "침엽수림",
      l3_code: "321",
      l3_name: "침엽수림",
    },
    class_counts: counts(5, 6, 7, 247457.80333858597),
    candidate_occurrence_count: 2,
    representation_variant_count: 0,
    guard_applied: true,
    derivation_version: "land-cover-cell-stats-v1",
    area_crs: "EPSG:5186",
    used_in_suitability_scoring: false,
    release: release(),
    disclosures: disclosures(),
    ...overrides,
  };
}

function classRow(
  level: 1 | 2 | 3,
  code: string,
  name: string,
  area: number,
  evaluated: number | null,
  cell: number | null,
): LandCoverClassShare {
  return {
    class_level: level,
    class_code: code,
    class_name: name,
    class_area_m2: area,
    share_of_evaluated_area: evaluated,
    share_of_cell_area: cell,
  };
}

function classDistribution(
  candidateKey: string,
  status: LandCoverCoverageStatus,
  items: LandCoverClassShare[],
  overrides: Partial<LandCoverCellClassDistribution> = {},
): LandCoverCellClassDistribution {
  return {
    candidate_grid_version: "capital-grid-500m-v1",
    candidate_key: candidateKey,
    coverage_status: status,
    coverage_status_meaning: COVERAGE_MEANINGS[status],
    cell_area_m2: 247457.80333858193,
    evaluated_area_m2: 247457.80333858574,
    uncovered_area_m2: 0,
    coverage_ratio: 1,
    class_level_filter: null,
    class_counts: counts(5, 6, 7, 247457.80333858597),
    total: items.length,
    items,
    used_in_suitability_scoring: false,
    release: release(),
    disclosures: disclosures(),
    ...overrides,
  };
}

// A COMPLETE_EXACT cell: two L1 rows (one a real sub-1% sliver), two L2, two L3.
const COMPLETE_ITEMS: LandCoverClassShare[] = [
  classRow(1, "300", "산림지역", 159794.71897525786, 0.6457453223110434, 0.6457453223110534),
  classRow(1, "100", "시가화건조지역", 31.84359450329308, 0.00012868292724526806, 0.00012868292724527),
  classRow(2, "320", "침엽수림", 130690.45215390285, 0.5281322730206442, 0.5281322730206524),
  classRow(2, "150", "교통지역", 31.84359450329308, 0.00012868292724526806, 0.00012868292724527),
  classRow(3, "321", "침엽수림", 130690.45215390304, 0.528132273020645, 0.5281322730206531),
  classRow(3, "613", "암벽·바위", 19260.446153251003, 0.07783325437063617, 0.07783325437063736),
];

const COMPLETE_STATS = cellStats(COMPLETE_KEY, "COMPLETE_EXACT");
const COMPLETE_CLASSES = classDistribution(COMPLETE_KEY, "COMPLETE_EXACT", COMPLETE_ITEMS);

// A PARTIAL cell: 53.4% evaluated, so the two share denominators visibly diverge.
const PARTIAL_STATS = cellStats(PARTIAL_KEY, "PARTIAL", {
  candidate_key: PARTIAL_KEY,
  cell_area_m2: 162927.88768969654,
  evaluated_area_m2: 86946.40348911782,
  uncovered_area_m2: 75981.48420057872,
  uncovered_residual_area_m2: 75981.48420057392,
  coverage_ratio: 0.5336496085600222,
  dominant_class: {
    l1_code: "200",
    l1_name: "농업지역",
    l2_code: "210",
    l2_name: "논",
    l3_code: "211",
    l3_name: "경지정리가 된 논",
  },
  class_counts: counts(6, 14, 15, 86946.40348911782),
});
const PARTIAL_CLASSES = classDistribution(
  PARTIAL_KEY,
  "PARTIAL",
  [classRow(1, "200", "농업지역", 60000, 0.69008, 0.36827)],
  {
    candidate_key: PARTIAL_KEY,
    cell_area_m2: 162927.88768969654,
    evaluated_area_m2: 86946.40348911782,
    uncovered_area_m2: 75981.48420057872,
    coverage_ratio: 0.5336496085600222,
    class_counts: counts(6, 14, 15, 86946.40348911782),
  },
);

// A NO_COVERAGE cell: all-null dominant classes, zero counts, and NO class rows.
const NO_COVERAGE_STATS = cellStats(NO_COVERAGE_KEY, "NO_COVERAGE", {
  candidate_key: NO_COVERAGE_KEY,
  sigungu_region_code: null,
  sigungu_region_name: null,
  cell_area_m2: 149861.5029076008,
  evaluated_area_m2: 0,
  uncovered_area_m2: 149861.5029076008,
  uncovered_residual_area_m2: 149861.5029076008,
  coverage_ratio: 0,
  intersection_area_sum_m2: 0,
  matched_feature_count: 0,
  dominant_class: {
    l1_code: null,
    l1_name: null,
    l2_code: null,
    l2_name: null,
    l3_code: null,
    l3_name: null,
  },
  class_counts: counts(0, 0, 0, 0),
  guard_applied: false,
});
const NO_COVERAGE_CLASSES = classDistribution(NO_COVERAGE_KEY, "NO_COVERAGE", [], {
  candidate_key: NO_COVERAGE_KEY,
  cell_area_m2: 149861.5029076008,
  evaluated_area_m2: 0,
  uncovered_area_m2: 149861.5029076008,
  coverage_ratio: 0,
  class_counts: counts(0, 0, 0, 0),
});

/** Every URL the stub was asked for, in order. */
let requested: string[] = [];

/**
 * Stub `fetch` with a per-candidate fixture table. Any key not in the table 404s
 * with the LC4 error body, so an unexpected request is visible rather than silently
 * satisfied.
 */
function stubFetch(
  table: Record<string, { stats: LandCoverCellStatistics; classes: LandCoverCellClassDistribution }>,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      const entry = Object.entries(table).find(([key]) => url.includes(encodeURIComponent(key)));
      if (!entry) {
        return {
          ok: false,
          status: 404,
          json: async () => ({
            detail: {
              error: "CANDIDATE_CELL_NOT_FOUND",
              detail: "No candidate-cell land-cover statistics exist for the requested candidate key.",
            },
          }),
        };
      }
      const [, fixture] = entry;
      const body = url.endsWith("/classes") ? fixture.classes : fixture.stats;
      return { ok: true, status: 200, json: async () => body };
    }) as unknown as typeof fetch,
  );
}

const ALL_FIXTURES = {
  [COMPLETE_KEY]: { stats: COMPLETE_STATS, classes: COMPLETE_CLASSES },
  [PARTIAL_KEY]: { stats: PARTIAL_STATS, classes: PARTIAL_CLASSES },
  [NO_COVERAGE_KEY]: { stats: NO_COVERAGE_STATS, classes: NO_COVERAGE_CLASSES },
};

beforeEach(() => {
  requested = [];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("request construction", () => {
  it("requests the candidate's own key, percent-encoded, on both endpoints", async () => {
    stubFetch(ALL_FIXTURES);
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    const encoded = encodeURIComponent(COMPLETE_KEY);
    expect(encoded).toContain("%3A"); // the canonical key's colon really is encoded
    expect(requested).toHaveLength(2);
    expect(requested[0]).toBe(
      `http://localhost:8000/api/v1/environment/land-cover/cell-statistics/cells/${encoded}`,
    );
    expect(requested[1]).toBe(
      `http://localhost:8000/api/v1/environment/land-cover/cell-statistics/cells/${encoded}/classes`,
    );
  });

  it("issues NO request until a candidate key is available", () => {
    stubFetch(ALL_FIXTURES);
    render(<LandCoverCellPanel candidateKey={null} />);
    expect(requested).toEqual([]);
    expect(screen.getByTestId("land-cover-idle")).toBeInTheDocument();
    expect(screen.queryByTestId("land-cover-body")).not.toBeInTheDocument();
  });

  it("never requests raw land-cover features, geometry, or tiles", async () => {
    stubFetch(ALL_FIXTURES);
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());
    for (const url of requested) {
      expect(url).toContain("/cell-statistics/cells/");
      expect(url).not.toMatch(/features|geometry|\.mvt|tiles/);
    }
  });
});

describe("loading state", () => {
  it("shows a loading state while the requests are in flight, with no fabricated values", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        await gate;
        const url = String(input);
        return {
          ok: true,
          status: 200,
          json: async () => (url.endsWith("/classes") ? COMPLETE_CLASSES : COMPLETE_STATS),
        };
      }) as unknown as typeof fetch,
    );

    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    expect(screen.getByTestId("land-cover-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("land-cover-body")).not.toBeInTheDocument();
    expect(screen.queryByTestId("land-cover-class-table")).not.toBeInTheDocument();

    release();
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());
    expect(screen.queryByTestId("land-cover-loading")).not.toBeInTheDocument();
  });
});

describe("COMPLETE_EXACT display", () => {
  beforeEach(() => stubFetch(ALL_FIXTURES));

  it("renders the required fields with the exact-evaluation explanation", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    const panel = screen.getByTestId("land-cover-cell-panel");
    expect(panel).toHaveTextContent("토지피복");
    expect(screen.getByTestId("land-cover-reference-period")).toHaveTextContent("2025");
    expect(screen.getByTestId("land-cover-coverage")).toHaveAttribute(
      "data-coverage-status",
      "COMPLETE_EXACT",
    );
    expect(screen.getByTestId("land-cover-coverage-label")).toHaveTextContent("COMPLETE_EXACT");
    expect(screen.getByTestId("land-cover-coverage-label")).toHaveTextContent("100%");
    // The actual cell area, not a nominal 500 × 500 m = 250,000 m².
    expect(screen.getByTestId("land-cover-cell-area")).toHaveTextContent("247,458 m²");
    expect(screen.getByTestId("land-cover-evaluated-area")).toHaveTextContent("247,458 m²");
    expect(screen.getByTestId("land-cover-uncovered-area")).toHaveTextContent("0 m²");
    // Dominant class at all three levels, code + official Korean name.
    expect(screen.getByTestId("land-cover-dominant-l1")).toHaveTextContent("300 · 산림지역");
    expect(screen.getByTestId("land-cover-dominant-l2")).toHaveTextContent("320 · 침엽수림");
    expect(screen.getByTestId("land-cover-dominant-l3")).toHaveTextContent("321 · 침엽수림");
    expect(screen.getByTestId("land-cover-class-counts")).toHaveTextContent("대분류 5개");
    expect(screen.getByTestId("land-cover-class-counts")).toHaveTextContent("세분류 7개");
    // Compact provenance.
    expect(screen.getByTestId("land-cover-provenance")).toHaveTextContent("land-cover-cell-stats-v1");
    expect(screen.getByTestId("land-cover-provenance")).toHaveTextContent("#212");
    // No partial or no-coverage warning on a fully evaluated cell.
    expect(screen.queryByTestId("land-cover-partial-warning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("land-cover-no-coverage-warning")).not.toBeInTheDocument();
  });

  // Phase 1B-LC6. Each level's dominant class is computed independently, so the three
  // need not nest: 3,518 of the 47,893 cells in the active release carry a 중분류
  // outside their 대분류 (a 대분류 total is a SUM over its members, and the largest sum
  // need not contain the largest single member). Correct, but it reads as a data error
  // unless the panel says so.
  it("explains that the three dominant classes are computed per level and need not nest", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    const note = screen.getByTestId("land-cover-dominant-note");
    expect(note).toHaveTextContent("면적이 가장 큰 분류를 따로 계산한");
    expect(note).toHaveTextContent("속하지 않을 수 있습니다");
  });

  it("omits the per-level note for a NO_COVERAGE cell, which has no dominant class", async () => {
    render(<LandCoverCellPanel candidateKey={NO_COVERAGE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    expect(screen.queryByTestId("land-cover-dominant-note")).not.toBeInTheDocument();
  });

  it("does not describe exact evaluation as legal or universal completeness", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());
    const caveat = screen.getByTestId("land-cover-coverage-caveat");
    expect(caveat).toHaveTextContent("빈 곳 없이 평가했다는 뜻입니다");
    expect(caveat).toHaveTextContent("법적으로 완전하다거나");
    expect(caveat).toHaveTextContent("모든 토지 상태를 알고 있다는 뜻은 아닙니다");
  });

  it("preserves official Korean class names verbatim, including the middle dot", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-class-table")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("land-cover-level-3"));
    expect(screen.getByTestId("land-cover-class-table")).toHaveTextContent("암벽·바위");
    expect(screen.getByTestId("land-cover-class-table")).toHaveTextContent("침엽수림");
  });
});

describe("PARTIAL warning", () => {
  beforeEach(() => stubFetch(ALL_FIXTURES));

  it("warns prominently and shows BOTH evaluated and uncovered area and percentage", async () => {
    render(<LandCoverCellPanel candidateKey={PARTIAL_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    const warning = screen.getByTestId("land-cover-partial-warning");
    expect(warning).toHaveTextContent("평가된 면적 86,946 m²");
    expect(warning).toHaveTextContent("53.4%");
    expect(warning).toHaveTextContent("미평가 면적 75,981 m²");
    expect(warning).toHaveTextContent("46.6%");
    // States that the distribution is not the whole cell.
    expect(warning).toHaveTextContent("격자 전체가 아니라 평가된 부분의 구성입니다");
    expect(screen.getByTestId("land-cover-coverage")).toHaveAttribute("data-coverage-tone", "warning");
  });

  it("distinguishes share_of_evaluated_area from share_of_cell_area and names both denominators", async () => {
    render(<LandCoverCellPanel candidateKey={PARTIAL_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-class-table")).toBeInTheDocument());

    // Same class, two different denominators — never conflated into one number.
    expect(screen.getByTestId("land-cover-share-evaluated")).toHaveTextContent("69%");
    expect(screen.getByTestId("land-cover-share-cell")).toHaveTextContent("36.8%");
    const table = screen.getByTestId("land-cover-class-table");
    expect(within(table).getByText("평가면적 대비")).toBeInTheDocument();
    expect(within(table).getByText("격자 전체 대비")).toBeInTheDocument();
    // Four columns, so both share columns fit the sidebar without scrolling.
    expect(table.querySelectorAll("th[scope='col']")).toHaveLength(4);

    const denominators = screen.getByTestId("land-cover-denominators");
    expect(denominators).toHaveTextContent("평가된 면적 86,946 m²");
    expect(denominators).toHaveTextContent("격자 실면적 162,928 m²");
    expect(denominators).toHaveTextContent("합계를 100%로 맞추지 않습니다");
  });

  it("never renders a PARTIAL cell as 100% covered even when the ratio rounds there", async () => {
    // LC3 decides coverage by exact residual emptiness, so this really occurs.
    const edgeKey = "capital-grid-500m-v1:1751_3836";
    stubFetch({
      [edgeKey]: {
        stats: cellStats(edgeKey, "PARTIAL", {
          candidate_key: edgeKey,
          coverage_ratio: 0.9999999999999876,
          evaluated_area_m2: 247457.8,
          uncovered_area_m2: 0.0000000031,
        }),
        classes: classDistribution(edgeKey, "PARTIAL", [
          classRow(1, "300", "산림지역", 247457.8, 1, 0.9999999999999876),
        ]),
      },
    });
    render(<LandCoverCellPanel candidateKey={edgeKey} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    expect(screen.getByTestId("land-cover-coverage-label")).toHaveTextContent("100% 미만");
    const warning = screen.getByTestId("land-cover-partial-warning");
    expect(warning).toHaveTextContent("100% 미만");
    // The uncovered residual is real but sub-m²; it must not read as zero.
    expect(warning).toHaveTextContent("1 m² 미만");
    expect(warning).toHaveTextContent("0.1% 미만");
  });
});

describe("NO_COVERAGE warning", () => {
  beforeEach(() => stubFetch(ALL_FIXTURES));

  it("shows the API's warning meaning and never implies empty, unused, or safe land", async () => {
    render(<LandCoverCellPanel candidateKey={NO_COVERAGE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    expect(screen.getByTestId("land-cover-coverage")).toHaveAttribute(
      "data-coverage-status",
      "NO_COVERAGE",
    );
    // Distinct tone from PARTIAL — the three states are visibly distinct.
    expect(screen.getByTestId("land-cover-coverage")).toHaveAttribute(
      "data-coverage-tone",
      "unevaluated",
    );
    expect(screen.getByTestId("land-cover-no-coverage-warning")).toHaveTextContent(
      "평가하지 않았다는 뜻입니다",
    );
    const caveat = screen.getByTestId("land-cover-coverage-caveat");
    expect(caveat).toHaveTextContent("확보된 토지피복 자료의 범위가 이 격자를 평가하지 않았습니다");
    expect(caveat).toHaveTextContent("적합하거나 안전하다는 뜻도 아닙니다");

    const panel = screen.getByTestId("land-cover-cell-panel");
    expect(panel).not.toHaveTextContent("토지피복 없음");
    expect(panel).not.toHaveTextContent("빈 땅");
    expect(panel).not.toHaveTextContent("미이용");
  });

  it("shows NO class rows and synthesizes no class from the uncovered area", async () => {
    render(<LandCoverCellPanel candidateKey={NO_COVERAGE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    expect(screen.queryByTestId("land-cover-class-table")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("land-cover-class-row")).toHaveLength(0);
    expect(screen.getByTestId("land-cover-no-classes")).toHaveTextContent(
      "대체 분류를 만들어 표시하지 않습니다",
    );
    // No synthesized pseudo-class anywhere in the section.
    const panel = screen.getByTestId("land-cover-cell-panel");
    expect(panel).not.toHaveTextContent("미분류");
    expect(panel).not.toHaveTextContent("Unknown");
    expect(panel).not.toHaveTextContent("Unclassified");
    expect(panel).not.toHaveTextContent("기타");
    // The uncovered area is labelled as a coverage measurement, not a class.
    expect(screen.getByTestId("land-cover-uncovered-area")).toHaveTextContent(
      "하나의 토지피복 분류가 아닙니다",
    );
  });

  it("reports absent dominant classes explicitly, never as '' or a zero code", async () => {
    render(<LandCoverCellPanel candidateKey={NO_COVERAGE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    for (const id of ["land-cover-dominant-l1", "land-cover-dominant-l2", "land-cover-dominant-l3"]) {
      expect(screen.getByTestId(id)).toHaveTextContent("해당 없음 (미평가)");
    }
    expect(screen.getByTestId("land-cover-class-counts")).toHaveTextContent("대분류 0개");
  });
});

describe("class distribution presentation", () => {
  beforeEach(() => stubFetch(ALL_FIXTURES));

  it("switches between L1/L2/L3, showing only that level's rows in served order", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-class-table")).toBeInTheDocument());

    const codes = () =>
      screen.getAllByTestId("land-cover-class-code").map((cell) => cell.textContent);

    expect(codes()).toEqual(["300", "100"]); // L1 by default, area-descending
    fireEvent.click(screen.getByTestId("land-cover-level-2"));
    expect(codes()).toEqual(["320", "150"]);
    fireEvent.click(screen.getByTestId("land-cover-level-3"));
    expect(codes()).toEqual(["321", "613"]);
    fireEvent.click(screen.getByTestId("land-cover-level-1"));
    expect(codes()).toEqual(["300", "100"]);
  });

  it("marks the selected level with aria-pressed rather than color alone", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-class-table")).toBeInTheDocument());

    expect(screen.getByTestId("land-cover-level-1")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("land-cover-level-3")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByTestId("land-cover-level-3"));
    expect(screen.getByTestId("land-cover-level-3")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("land-cover-level-1")).toHaveAttribute("aria-pressed", "false");
  });

  it("never renders a real sub-1% class share as 0%", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-class-table")).toBeInTheDocument());
    // The 31.84 m² 시가화건조지역 row is 0.0129% of the cell — real, not absent.
    const table = screen.getByTestId("land-cover-class-table");
    expect(table).toHaveTextContent("0.1% 미만");
    expect(table).toHaveTextContent("32 m²");
  });

  it("handles a one-class cell without an expansion control", async () => {
    render(<LandCoverCellPanel candidateKey={PARTIAL_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-class-table")).toBeInTheDocument());
    expect(screen.getAllByTestId("land-cover-class-row")).toHaveLength(1);
    expect(screen.queryByTestId("land-cover-expand-rows")).not.toBeInTheDocument();
  });

  it("keeps a many-class level usable: collapses to 8 rows and states the hidden count", async () => {
    const manyKey = "capital-grid-500m-v1:1900_3900";
    const many = Array.from({ length: 15 }, (_, i) =>
      classRow(3, `3${String(i).padStart(2, "0")}`, `세분류${i}`, 1000 - i, 0.05, 0.05),
    );
    stubFetch({
      [manyKey]: {
        stats: cellStats(manyKey, "COMPLETE_EXACT", { candidate_key: manyKey }),
        classes: classDistribution(manyKey, "COMPLETE_EXACT", many, { candidate_key: manyKey }),
      },
    });
    render(<LandCoverCellPanel candidateKey={manyKey} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("land-cover-level-3"));
    expect(screen.getAllByTestId("land-cover-class-row")).toHaveLength(8);
    const expand = screen.getByTestId("land-cover-expand-rows");
    expect(expand).toHaveTextContent("나머지 7개 분류 더 보기 (전체 15개)");

    fireEvent.click(expand);
    expect(screen.getAllByTestId("land-cover-class-row")).toHaveLength(15);
    fireEvent.click(screen.getByTestId("land-cover-collapse-rows"));
    expect(screen.getAllByTestId("land-cover-class-row")).toHaveLength(8);
  });

  it("reports an empty level without inventing rows", async () => {
    const l1OnlyKey = "capital-grid-500m-v1:1901_3901";
    stubFetch({
      [l1OnlyKey]: {
        stats: cellStats(l1OnlyKey, "COMPLETE_EXACT", { candidate_key: l1OnlyKey }),
        classes: classDistribution(
          l1OnlyKey,
          "COMPLETE_EXACT",
          [classRow(1, "300", "산림지역", 100, 1, 1)],
          { candidate_key: l1OnlyKey },
        ),
      },
    });
    render(<LandCoverCellPanel candidateKey={l1OnlyKey} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-class-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("land-cover-level-2"));
    expect(screen.getByTestId("land-cover-level-empty")).toBeInTheDocument();
    expect(screen.queryAllByTestId("land-cover-class-row")).toHaveLength(0);
  });

  it("puts the table in a horizontally scrollable container for narrow viewports", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-class-table")).toBeInTheDocument());
    const table = screen.getByTestId("land-cover-class-table");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
  });
});

describe("failure handling", () => {
  it("names the not-found case without implying that land cover is absent", async () => {
    stubFetch({}); // every key 404s
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-error")).toBeInTheDocument());

    const error = screen.getByTestId("land-cover-error");
    expect(error).toHaveTextContent("활성화된 토지피복 통계 릴리스에 포함되어 있지 않습니다");
    expect(error).toHaveTextContent("토지피복이 없다는 뜻은 아닙니다");
    expect(screen.queryByTestId("land-cover-body")).not.toBeInTheDocument();
  });

  it("contains an API outage inside this section and leaks no backend internals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    );
    // A sibling stands in for the surrounding suitability details: it must survive.
    render(
      <div>
        <p data-testid="sibling-suitability">점수 0.812 · 순위 3</p>
        <LandCoverCellPanel candidateKey={COMPLETE_KEY} />
      </div>,
    );
    await waitFor(() => expect(screen.getByTestId("land-cover-error")).toBeInTheDocument());

    expect(screen.getByTestId("sibling-suitability")).toHaveTextContent("점수 0.812 · 순위 3");
    const panel = screen.getByTestId("land-cover-cell-panel");
    expect(panel).toHaveTextContent("불러오지 못했습니다");
    // No stack traces, SQL, paths, connection strings, or raw error text.
    expect(panel).not.toHaveTextContent("Failed to fetch");
    expect(panel).not.toHaveTextContent("TypeError");
    expect(panel.textContent).not.toMatch(/SELECT|postgres|psycopg|localhost|Traceback|\/Users\//i);
  });

  it("refuses to render a malformed or inconsistent response", async () => {
    // Coverage status says NO_COVERAGE while a class row is present: incoherent.
    const key = "capital-grid-500m-v1:1902_3902";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(input).endsWith("/classes")
            ? {
                ...classDistribution(key, "NO_COVERAGE", [
                  classRow(1, "300", "산림지역", 100, 1, 1),
                ]),
              }
            : cellStats(key, "NO_COVERAGE", { candidate_key: key, evaluated_area_m2: 0 }),
      })) as unknown as typeof fetch,
    );
    render(<LandCoverCellPanel candidateKey={key} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-error")).toBeInTheDocument());
    expect(screen.getByTestId("land-cover-error")).toHaveTextContent(
      "불완전한 값을 대신 표시하지 않습니다",
    );
    expect(screen.queryByTestId("land-cover-class-table")).not.toBeInTheDocument();
  });

  it("refuses a response whose candidate key is not the one requested", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(input).endsWith("/classes") ? PARTIAL_CLASSES : PARTIAL_STATS,
      })) as unknown as typeof fetch,
    );
    // Asking for the COMPLETE key but served the PARTIAL cell's body.
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-error")).toBeInTheDocument());
    expect(screen.queryByTestId("land-cover-body")).not.toBeInTheDocument();
  });
});

describe("candidate selection changes", () => {
  it("replaces the section's contents when a different candidate is selected", async () => {
    stubFetch(ALL_FIXTURES);
    const { rerender } = render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() =>
      expect(screen.getByTestId("land-cover-coverage")).toHaveAttribute(
        "data-coverage-status",
        "COMPLETE_EXACT",
      ),
    );

    rerender(<LandCoverCellPanel candidateKey={PARTIAL_KEY} />);
    await waitFor(() =>
      expect(screen.getByTestId("land-cover-coverage")).toHaveAttribute(
        "data-coverage-status",
        "PARTIAL",
      ),
    );
    expect(screen.getByTestId("land-cover-partial-warning")).toBeInTheDocument();
    expect(screen.getByTestId("land-cover-cell-area")).toHaveTextContent("162,928 m²");

    rerender(<LandCoverCellPanel candidateKey={NO_COVERAGE_KEY} />);
    await waitFor(() =>
      expect(screen.getByTestId("land-cover-coverage")).toHaveAttribute(
        "data-coverage-status",
        "NO_COVERAGE",
      ),
    );
    expect(screen.queryByTestId("land-cover-partial-warning")).not.toBeInTheDocument();
  });

  it("returns to the idle state when the detail panel is closed, then reloads on reopen", async () => {
    stubFetch(ALL_FIXTURES);
    const { rerender } = render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    rerender(<LandCoverCellPanel candidateKey={null} />);
    expect(screen.getByTestId("land-cover-idle")).toBeInTheDocument();
    expect(screen.queryByTestId("land-cover-body")).not.toBeInTheDocument();

    rerender(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());
  });

  it("resets the class level to 대분류 when a new candidate is selected", async () => {
    stubFetch(ALL_FIXTURES);
    const { rerender } = render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-class-table")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("land-cover-level-3"));
    expect(screen.getByTestId("land-cover-level-3")).toHaveAttribute("aria-pressed", "true");

    rerender(<LandCoverCellPanel candidateKey={PARTIAL_KEY} />);
    await waitFor(() =>
      expect(screen.getByTestId("land-cover-coverage")).toHaveAttribute(
        "data-coverage-status",
        "PARTIAL",
      ),
    );
    expect(screen.getByTestId("land-cover-level-1")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("stale-request protection", () => {
  it("never paints a superseded candidate's response over the current one", async () => {
    // The FIRST candidate's requests resolve only after the selection has already
    // moved on; the late body must be discarded, not rendered.
    const gates: Record<string, () => void> = {};
    const pending: Record<string, Promise<void>> = {};
    for (const key of [COMPLETE_KEY, PARTIAL_KEY]) {
      pending[key] = new Promise<void>((resolve) => {
        gates[key] = resolve;
      });
    }
    const aborted: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const key = url.includes(encodeURIComponent(COMPLETE_KEY)) ? COMPLETE_KEY : PARTIAL_KEY;
        init?.signal?.addEventListener("abort", () => aborted.push(key));
        await pending[key];
        const fixture = ALL_FIXTURES[key];
        return {
          ok: true,
          status: 200,
          json: async () => (url.endsWith("/classes") ? fixture.classes : fixture.stats),
        };
      }) as unknown as typeof fetch,
    );

    const { rerender } = render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    expect(screen.getByTestId("land-cover-loading")).toBeInTheDocument();

    // Selection changes while the first pair is still in flight.
    rerender(<LandCoverCellPanel candidateKey={PARTIAL_KEY} />);
    expect(aborted).toContain(COMPLETE_KEY);

    // Now let the SUPERSEDED requests resolve first, then the current ones.
    gates[COMPLETE_KEY]();
    await Promise.resolve();
    gates[PARTIAL_KEY]();

    await waitFor(() =>
      expect(screen.getByTestId("land-cover-coverage")).toHaveAttribute(
        "data-coverage-status",
        "PARTIAL",
      ),
    );
    // The stale COMPLETE_EXACT body never appears.
    expect(screen.getByTestId("land-cover-cell-area")).toHaveTextContent("162,928 m²");
    expect(screen.getByTestId("land-cover-coverage-label")).not.toHaveTextContent("COMPLETE_EXACT");
  });

  it("shows loading — not the previous candidate's numbers — during rapid switching", async () => {
    let releaseAll!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    let servedKey = COMPLETE_KEY;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const key = url.includes(encodeURIComponent(COMPLETE_KEY)) ? COMPLETE_KEY : NO_COVERAGE_KEY;
        if (key === COMPLETE_KEY) await gate;
        servedKey = key;
        const fixture = ALL_FIXTURES[key];
        return {
          ok: true,
          status: 200,
          json: async () => (url.endsWith("/classes") ? fixture.classes : fixture.stats),
        };
      }) as unknown as typeof fetch,
    );

    const { rerender } = render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    rerender(<LandCoverCellPanel candidateKey={NO_COVERAGE_KEY} />);
    await waitFor(() =>
      expect(screen.getByTestId("land-cover-coverage")).toHaveAttribute(
        "data-coverage-status",
        "NO_COVERAGE",
      ),
    );

    // Switch back to the still-gated candidate: loading, never the NO_COVERAGE body.
    rerender(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    expect(screen.getByTestId("land-cover-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("land-cover-body")).not.toBeInTheDocument();

    releaseAll();
    await waitFor(() =>
      expect(screen.getByTestId("land-cover-coverage")).toHaveAttribute(
        "data-coverage-status",
        "COMPLETE_EXACT",
      ),
    );
    expect(servedKey).toBe(COMPLETE_KEY);
  });
});

describe("scoring and licence disclosures", () => {
  beforeEach(() => stubFetch(ALL_FIXTURES));

  it("states scoring non-use as visible body text, not only in a tooltip", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    const scoring = screen.getByTestId("land-cover-scoring-disclosure");
    expect(scoring).toHaveTextContent("점수 반영: 미반영");
    expect(scoring).toHaveTextContent("used_in_suitability_scoring: false");
    expect(screen.getByTestId("land-cover-scoring-statement")).toHaveTextContent(
      "적합성 점수·순위·적격 상태·제외 사유·검토 사유에 사용되지 않습니다",
    );
    // Not hidden behind a disclosure widget the reader may never open.
    expect(scoring.closest("details")).toBeNull();
    expect(screen.getByTestId("land-cover-scoring-badge")).toHaveTextContent("점수 미반영");
  });

  it("states the public authorization and its basis without claiming an EGIS/KOGL licence", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    expect(screen.getByTestId("land-cover-license-disclosure")).toHaveTextContent(
      "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER",
    );
    expect(screen.getByTestId("land-cover-license-disclosure").closest("details")).toBeNull();
    // The BASIS is project-level authorization — shown separately, never merged into
    // a claim about the dataset's own licence.
    expect(screen.getByTestId("land-cover-authorization-basis")).toHaveTextContent(
      "GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION",
    );
    expect(screen.getByTestId("land-cover-public-statement")).toHaveTextContent("협력 정부기관");
    expect(screen.getByTestId("land-cover-public-statement")).toHaveTextContent(
      "원본 SHP 파일",
    );
    expect(screen.getByTestId("land-cover-license-statement")).toHaveTextContent(
      "does not assert a dataset-specific EGIS KOGL type",
    );
    expect(screen.getByTestId("land-cover-license-statement")).toHaveTextContent(
      "are not redistributed",
    );

    // No positive claim of an EGIS licence grant, a KOGL type, commercial permission,
    // or raw-data redistribution appears anywhere in the section.
    const panel = screen.getByTestId("land-cover-cell-panel");
    expect(panel.textContent).not.toMatch(
      /KOGL 제1유형|KOGL Type 1 is claimed|공공누리 제1유형|EGIS 서면 승인|상업적 이용 가능|commercial use permitted|원본 SHP 제공|raw data redistribution/i,
    );
  });

  it("always shows the mandatory source attribution and the official source link", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    const attribution = screen.getByTestId("land-cover-attribution");
    expect(attribution).toHaveTextContent("출처: 기후에너지환경부 환경공간정보서비스(EGIS)");
    expect(attribution).toHaveTextContent("세분류 [2025] 전국 토지피복지도");
    expect(attribution).toHaveTextContent("500 m 후보격자");
    const link = screen.getByTestId("land-cover-source-link");
    expect(link).toHaveAttribute("href", "https://aid.mcee.go.kr/intro/land.do");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders the served uncovered-area and class-label statements verbatim", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());
    expect(screen.getByTestId("land-cover-uncovered-statement")).toHaveTextContent(
      "never a land-cover class",
    );
    expect(screen.getByTestId("land-cover-class-label-statement")).toHaveTextContent(
      "preserved verbatim",
    );
  });
});

describe("accessibility", () => {
  beforeEach(() => stubFetch(ALL_FIXTURES));

  it("labels the section, the level control, and the table", async () => {
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-class-table")).toBeInTheDocument());

    expect(screen.getByRole("region", { name: "토지피복 격자 통계" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "토지피복 분류 단계 선택" })).toBeInTheDocument();
    // The table carries a caption naming BOTH denominators, and scoped headers.
    const table = screen.getByTestId("land-cover-class-table");
    expect(table.querySelector("caption")?.textContent).toContain("평가된 면적 기준과 격자");
    expect(table.querySelector("caption")?.textContent).toContain("공식 코드·공식 분류명");
    expect(table.querySelectorAll("th[scope='col']")).toHaveLength(4);
    // The heading is a heading, not styled text.
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("토지피복");
  });

  it("announces the loading state to assistive technology", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        await gate;
        return {
          ok: true,
          status: 200,
          json: async () =>
            String(input).endsWith("/classes") ? COMPLETE_CLASSES : COMPLETE_STATS,
        };
      }) as unknown as typeof fetch,
    );
    render(<LandCoverCellPanel candidateKey={COMPLETE_KEY} />);
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중입니다");
    release();
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());
  });

  it("operates the level control and the row expansion by keyboard", async () => {
    const manyKey = "capital-grid-500m-v1:1903_3903";
    const many = Array.from({ length: 12 }, (_, i) =>
      classRow(3, `3${String(i).padStart(2, "0")}`, `세분류${i}`, 1000 - i, 0.05, 0.05),
    );
    stubFetch({
      [manyKey]: {
        stats: cellStats(manyKey, "COMPLETE_EXACT", { candidate_key: manyKey }),
        classes: classDistribution(manyKey, "COMPLETE_EXACT", many, { candidate_key: manyKey }),
      },
    });
    render(<LandCoverCellPanel candidateKey={manyKey} />);
    await waitFor(() => expect(screen.getByTestId("land-cover-body")).toBeInTheDocument());

    // Every control is a real <button>: focusable and activated by Enter/Space.
    const level3 = screen.getByTestId("land-cover-level-3");
    level3.focus();
    expect(level3).toHaveFocus();
    fireEvent.keyDown(level3, { key: "Enter" });
    fireEvent.click(level3); // the browser's own Enter → click on a native button
    expect(level3).toHaveAttribute("aria-pressed", "true");

    const expand = screen.getByTestId("land-cover-expand-rows");
    expect(expand.tagName).toBe("BUTTON");
    expand.focus();
    expect(expand).toHaveFocus();
    fireEvent.click(expand);
    expect(screen.getAllByTestId("land-cover-class-row")).toHaveLength(12);
  });
});
