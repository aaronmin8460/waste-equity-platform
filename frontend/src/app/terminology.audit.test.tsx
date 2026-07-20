// @vitest-environment jsdom

/**
 * Terminology audit — the machine-readable guard that PRIMARY citizen UI stays in
 * plain Korean. Renders the app and asserts the navigation, sub-views, and status
 * labels are the plain-Korean ones, and that the default 지역 부담 view carries no
 * unexplained technical enum / version / English-parenthetical token.
 *
 * Technical terms are still allowed inside "자세히 보기" disclosures and methodology
 * notes (e.g. the CRITIC methodology note, the MVT detail) — this audit scans the
 * default primary surface, not the opened detail layers.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FORBIDDEN_PRIMARY_TOKENS, MODE_LABELS, STATUS_META, SUBVIEW_LABELS } from "../lib/glossary";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub() {
      return <div data-testid="map-container" />;
    },
}));

/**
 * The transparency endpoints are overridden on top of `homeApiMock` so the Phase 6
 * 데이터와 출처 surface is audited POPULATED. The shared mock serves an empty source
 * registry, which would have left this audit scanning an empty-state card — the one
 * surface that cannot leak a technical token.
 *
 * The registry rows below are the ones this repository actually seeds (alembic 0001
 * / 0013), with their real English `source_name` / `dataset_name`, so the audit
 * proves those served strings do not reach the primary surface untranslated.
 */
const transparencyApi = vi.hoisted(() => ({
  fetchDataSources: vi.fn().mockResolvedValue([
    {
      source_id: "sgis",
      source_name: "Statistics Korea SGIS",
      dataset_name: "Population statistics and administrative boundaries",
      endpoint: "https://sgisapi.kostat.go.kr/OpenAPI3",
      publication_frequency: "MONTHLY",
      enabled: true,
      documentation_url: "https://sgis.kostat.go.kr/developer/html/openApi/api/data.html",
    },
    {
      source_id: "15064381",
      source_name: "수도권매립지관리공사 (Sudokwon Landfill Site Management Corp.)",
      dataset_name: "통합반입관리_수도권폐기물 반입량 (landfill inbound quantity)",
      endpoint: "https://api.odcloud.kr/api/15064381/v1",
      publication_frequency: "MONTHLY",
      enabled: true,
      documentation_url: "https://www.data.go.kr/data/15064381/fileData.do",
    },
  ]),
  fetchDataFreshness: vi.fn().mockResolvedValue([
    {
      source_id: "sgis",
      source_name: "Statistics Korea SGIS",
      publication_frequency: "MONTHLY",
      latest_reference_period: "2024",
      last_checked_at: null,
      last_changed_at: null,
      last_success_at: "2026-07-15T09:00:00+00:00",
      next_scheduled_at: null,
      freshness_status: "FRESH",
    },
  ]),
  fetchFacilityMappingTransparency: vi.fn().mockResolvedValue({
    reference_year: 2024,
    reference_period: "2024",
    total: 10,
    with_map_location: 7,
    without_map_location: 3,
    without_address: 0,
    category_breakdown: [
      { category: "PUBLIC_INCINERATION", total: 10, with_map_location: 7, without_map_location: 3 },
    ],
    ownership_breakdown: [{ ownership: "PUBLIC", total: 10 }],
    region_mapping_breakdown: [{ region_mapping_status: "UNMATCHED", total: 3 }],
    source_breakdown: [],
    unmapped: {
      page: 1,
      page_size: 25,
      total: 1,
      items: [
        {
          id: 1,
          facility_name: "가나 소각장",
          facility_category: "PUBLIC_INCINERATION",
          ownership: "PUBLIC",
          rcis_sido_name: "서울특별시",
          rcis_sigungu_name: "강남구",
          region_code: null,
          region_name: null,
          region_mapping_status: "UNMATCHED",
          geocode_status: "FAILED",
          missing_location_reason: "주소 정제 실패",
        },
      ],
    },
    disclaimer: "지도 위치가 없는 시설은 주소를 좌표로 변환하지 못한 경우입니다.",
  }),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const { homeApiMock } = await import("./homeApiMock");
  return { ...homeApiMock(actual), ...transparencyApi };
});

import Home from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

async function renderLoaded() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  return utils;
}

describe("primary navigation uses plain Korean", () => {
  it("labels the four areas 지역 부담 / 후보지 분석 / 매립지 현황 / 데이터·출처", async () => {
    await renderLoaded();
    expect(screen.getByTestId("mode-equity").textContent).toBe(MODE_LABELS.equity);
    expect(screen.getByTestId("mode-suitability").textContent).toBe(MODE_LABELS.suitability);
    expect(screen.getByTestId("mode-flow").textContent).toBe(MODE_LABELS.flow);
    expect(screen.getByTestId("mode-transparency").textContent).toBe(MODE_LABELS.transparency);
  });

  it("shows a plain-language orientation for the active area", async () => {
    await renderLoaded();
    expect(screen.getByTestId("mode-orientation").textContent).toContain("지역별 폐기물 발생량");
  });
});

describe("default 지역 부담 view carries no unexplained technical token", () => {
  it("the equity sidebar has no raw status/accounting enum, MVT, or English metric parenthetical", async () => {
    await renderLoaded();
    const aside = document.querySelector("aside");
    expect(aside).not.toBeNull();
    const text = aside?.textContent ?? "";
    for (const token of FORBIDDEN_PRIMARY_TOKENS) {
      expect(text.includes(token), `equity sidebar leaks "${token}"`).toBe(false);
    }
    // Nor a bare English metric parenthetical.
    expect(text).not.toContain("(Population)");
    expect(text).not.toContain("(Equity)");
  });
});

describe("데이터와 출처 keeps its primary surface in plain Korean", () => {
  /** Enter the area and wait for the populated source catalog. */
  async function openTransparency() {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("transparency-source-list")).toBeDefined());
  }

  /**
   * The primary surface = everything a reader sees without opening anything.
   * `[data-diagnostic]` nodes and the 기술 정보 disclosure are the sanctioned homes
   * for a raw code (redesign plan §5 rule 12), so they are stripped before scanning.
   */
  function primarySurface(): string {
    const root = document.querySelector("[data-testid='transparency-dashboard']")!;
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-diagnostic]").forEach((node) => node.remove());
    clone
      .querySelectorAll("[data-testid='transparency-technical']")
      .forEach((node) => node.remove());
    return clone.textContent ?? "";
  }

  it("carries no forbidden technical token once the detail layers are stripped", async () => {
    await openTransparency();
    const text = primarySurface();
    for (const token of FORBIDDEN_PRIMARY_TOKENS) {
      expect(text.includes(token), `데이터와 출처 leaks "${token}"`).toBe(false);
    }
  });

  it("renders the registry's English strings only behind a disclosure", async () => {
    await openTransparency();
    const text = primarySurface();
    // The Korean rendering leads…
    expect(text).toContain("인구 통계와 행정경계");
    expect(text).toContain("통계청 SGIS");
    // …and the raw served English is not the citizen's label.
    expect(text).not.toContain("Population statistics and administrative boundaries");
    expect(text).not.toContain("landfill inbound quantity");
    // Nor the raw cadence enums or the ingestion status enum.
    expect(text).not.toContain("MONTHLY");
    expect(text).not.toContain("REAL_TIME");
    expect(text).not.toContain("STRUCTURAL");
    expect(text).not.toContain("FRESH");
  });

  it("does not claim any dataset is the latest", async () => {
    await openTransparency();
    // `freshness_status` is set to FRESH on ingestion success and never demoted, so
    // "최신" would assert a currency the served metadata does not establish.
    expect(primarySurface()).not.toContain("최신");
  });

  it("keeps one plain-Korean heading and the frozen navigation labels", async () => {
    await openTransparency();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")!.textContent).toBe("데이터와 출처");
    // The nav labels are frozen strings and must survive the area's own rename.
    expect(screen.getByTestId("mode-transparency").textContent).toBe(MODE_LABELS.transparency);
    expect(screen.getByTestId("mode-equity").textContent).toBe(MODE_LABELS.equity);
    expect(screen.getByTestId("mode-flow").textContent).toBe(MODE_LABELS.flow);
    expect(screen.getByTestId("mode-suitability").textContent).toBe(MODE_LABELS.suitability);
  });

  it("shows no Korean/English label duplication in its own controls", async () => {
    await openTransparency();
    const text = primarySurface();
    for (const english of ["(Source)", "(Reference period)", "(No data)", "(Annual)", "(Monthly)"]) {
      expect(text).not.toContain(english);
    }
  });
});

describe("후보지 분석 uses plain status and sub-view labels", () => {
  it("names the three sub-views in plain Korean", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-suitability"));
    await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
    expect(screen.getByTestId("suitability-view-score").textContent).toBe(SUBVIEW_LABELS.score);
    expect(screen.getByTestId("suitability-view-scenario").textContent).toBe(SUBVIEW_LABELS.scenario);
    expect(screen.getByTestId("suitability-view-cost").textContent).toBe(SUBVIEW_LABELS.cost);
  });

  it("shows candidate counts with plain status names, not raw enums", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-suitability"));
    await waitFor(() => expect(screen.getByTestId("candidate-counts")).toBeDefined());
    const counts = screen.getByTestId("candidate-counts").textContent ?? "";
    expect(counts).toContain(STATUS_META.ELIGIBLE.primary); // 1차 분석 통과
    expect(counts).toContain(STATUS_META.REVIEW_REQUIRED.primary); // 추가 확인 필요
    expect(counts).toContain(STATUS_META.EXCLUDED.primary); // 현재 기준에서 제외
    expect(counts).not.toContain("ELIGIBLE");
    expect(counts).not.toContain("EXCLUDED");
  });
});
