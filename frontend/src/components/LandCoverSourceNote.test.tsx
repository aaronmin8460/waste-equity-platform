// @vitest-environment jsdom

/**
 * LandCoverSourceNote tests — the data-sources (데이터·출처) public disclosure for the
 * land-cover candidate-cell statistics (Phase 1B-LC8).
 *
 * The load-bearing properties:
 *  - the mandatory source attribution renders in EVERY state, including a failed
 *    request, because attribution is project policy rather than a nice-to-have;
 *  - the public-deployment status and the PROJECT-level basis it rests on are shown
 *    as two separate facts, and neither is presented as an EGIS licence confirmation
 *    or a KOGL type;
 *  - the raw-data non-redistribution, scoring non-use, and coverage limitations
 *    survive publication;
 *  - a failed request produces an honest error state, never fabricated counts.
 */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LandCoverSourceNote from "./LandCoverSourceNote";

const RELEASE = {
  statistics_version_id: 1,
  status: "SUCCEEDED",
  is_active: true,
  derivation_version: "land-cover-cell-stats-v1",
  candidate_grid_version: "capital-grid-500m-v1",
  expected_cell_count: 47893,
  processed_cell_count: 47893,
  coverage_status_counts: { COMPLETE_EXACT: 35902, PARTIAL: 4604, NO_COVERAGE: 7387 },
  source_release: {
    dataset_version_id: 212,
    provider: "기후에너지환경부 환경공간정보서비스(EGIS)",
    official_dataset_name: "세분류 [2025] 전국 토지피복지도",
    official_source_url: "https://aid.mcee.go.kr/intro/land.do",
    reference_period: "2025",
    transformation_version: "land-cover-v1",
  },
  disclosures: {
    reference_period: "2025",
    license_status: "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER",
    authorization_basis: "GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION",
    public_statement_ko:
      "본 플랫폼은 협력 정부기관이 확인한 프로젝트 차원의 공공데이터 활용 범위에 따라 공개 운영됩니다. 원본 SHP 파일, 원본 토지피복 도형 및 원본 개별 피처 레코드는 제공하지 않습니다.",
    used_in_suitability_scoring: false,
    attribution: {
      provider: "기후에너지환경부 환경공간정보서비스(EGIS)",
      official_dataset_name: "세분류 [2025] 전국 토지피복지도",
      reference_period: "2025",
      official_source_url: "https://aid.mcee.go.kr/intro/land.do",
      transformation_version: "land-cover-v1",
      candidate_grid_version: "capital-grid-500m-v1",
      statistics_derivation_version: "land-cover-cell-stats-v1",
      statistics_version_id: 1,
      attribution_ko:
        "출처: 기후에너지환경부 환경공간정보서비스(EGIS), 「세분류 [2025] 전국 토지피복지도」. Waste Equity Platform이 서울·인천·경기 500 m 후보격자 단위로 가공한 파생 통계입니다.",
      raw_source_not_returned_ko:
        "원본 SHP 파일, 원본 토지피복 도형 및 원본 개별 피처 레코드는 제공하지 않습니다.",
      authorization_status: "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER",
      authorization_basis: "GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION",
    },
  },
};

function stubFetch(ok: boolean, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LandCoverSourceNote", () => {
  it("shows the attribution, the public status, its basis, and the served release", async () => {
    stubFetch(true, RELEASE);
    render(<LandCoverSourceNote />);
    await waitFor(() =>
      expect(screen.getByTestId("land-cover-source-note-body")).toBeInTheDocument(),
    );

    expect(screen.getByTestId("land-cover-source-note-attribution")).toHaveTextContent(
      "출처: 기후에너지환경부 환경공간정보서비스(EGIS)",
    );
    expect(screen.getByTestId("land-cover-source-note-status")).toHaveTextContent(
      "PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER",
    );
    const basis = screen.getByTestId("land-cover-source-note-basis");
    expect(basis).toHaveTextContent("GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION");
    // The basis explicitly denies being a dataset-specific EGIS/KOGL determination.
    expect(basis).toHaveTextContent("EGIS의 자료별 서면 회신이나 공공누리(KOGL) 유형 지정이 아닙니다");
    expect(screen.getByTestId("land-cover-source-note-cells")).toHaveTextContent("47,893개");
    expect(screen.getByTestId("land-cover-source-note-link")).toHaveAttribute(
      "href",
      "https://aid.mcee.go.kr/intro/land.do",
    );
  });

  it("keeps the raw-data, scoring and coverage limitations after publication", async () => {
    stubFetch(true, RELEASE);
    render(<LandCoverSourceNote />);
    await waitFor(() =>
      expect(screen.getByTestId("land-cover-source-note-body")).toBeInTheDocument(),
    );

    expect(screen.getByTestId("land-cover-source-note-raw")).toHaveTextContent("제공하지 않음");
    expect(screen.getByTestId("land-cover-source-note-raw")).toHaveTextContent("원본 SHP 파일");
    const scoring = screen.getByTestId("land-cover-source-note-scoring");
    expect(scoring).toHaveTextContent("미반영");
    expect(scoring).toHaveTextContent("used_in_suitability_scoring: false");
    const limits = screen.getByTestId("land-cover-source-note-limits");
    expect(limits).toHaveTextContent("해안·도서");
    expect(limits).toHaveTextContent("실제로 토지피복이 없다는 의미가 아닙니다");
    expect(limits).toHaveTextContent("각 단계별로 따로 계산");
  });

  it("still shows the mandatory attribution when the request fails", async () => {
    stubFetch(false, {});
    render(<LandCoverSourceNote />);
    await waitFor(() =>
      expect(screen.getByTestId("land-cover-source-note-error")).toBeInTheDocument(),
    );

    // Attribution is mandatory and survives the failure...
    expect(screen.getByTestId("land-cover-source-note-attribution")).toHaveTextContent(
      "출처: 기후에너지환경부 환경공간정보서비스(EGIS)",
    );
    // ...but nothing about the release is invented.
    expect(screen.queryByTestId("land-cover-source-note-cells")).not.toBeInTheDocument();
    expect(screen.queryByTestId("land-cover-source-note-status")).not.toBeInTheDocument();
  });

  it("treats an incomplete release as unavailable rather than describing it", async () => {
    stubFetch(true, { ...RELEASE, processed_cell_count: 47000 });
    render(<LandCoverSourceNote />);
    await waitFor(() =>
      expect(screen.getByTestId("land-cover-source-note-error")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("land-cover-source-note-cells")).not.toBeInTheDocument();
  });
});
