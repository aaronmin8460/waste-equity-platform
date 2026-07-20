// @vitest-environment jsdom

/**
 * 데이터와 출처 (transparency) dashboard tests.
 *
 * Two jobs:
 *   1. The Phase 6 catalog behaviour — search, filters, the polite result count, and
 *      the five distinct outcomes (loading / catalog / registry served nothing /
 *      search matched nothing / a genuine failure).
 *   2. The data-integrity contracts that predate Phase 6 and must survive it: an
 *      unavailable value never becomes zero, an official zero stays distinct from
 *      an absent one, a missing map location shows its RECORDED reason (or
 *      "실패 사유 기록 없음", never a fabricated one), a URL is never guessed, and
 *      the raw version identifiers stay reachable but leave the primary surface.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FORBIDDEN_PRIMARY_TOKENS } from "../lib/glossary";
import type { LoadedData } from "../app/page";

const mapping = vi.hoisted(() => ({
  reference_year: 2024,
  reference_period: "2024",
  total: 120,
  with_map_location: 90,
  without_map_location: 30,
  // An OFFICIAL measured zero — the registry counted, and the answer was none.
  without_address: 0,
  category_breakdown: [
    {
      category: "PUBLIC_INCINERATION",
      total: 40,
      with_map_location: 35,
      without_map_location: 5,
    },
  ],
  ownership_breakdown: [{ ownership: "PUBLIC", total: 80 }],
  region_mapping_breakdown: [{ region_mapping_status: "UNMATCHED", total: 30 }],
  source_breakdown: [
    {
      source_id: "waste_statistics",
      official_dataset_name: "시설현황",
      total: 120,
    },
  ],
  unmapped: {
    page: 1,
    page_size: 25,
    total: 2,
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
      {
        id: 2,
        facility_name: "다라 매립장",
        facility_category: "PUBLIC_LANDFILL",
        ownership: "PUBLIC",
        rcis_sido_name: "인천광역시",
        rcis_sigungu_name: "옹진군",
        region_code: null,
        region_name: null,
        region_mapping_status: "UNMATCHED",
        geocode_status: null,
        missing_location_reason: null, // → "실패 사유 기록 없음"
      },
    ],
  },
  disclaimer: "지도 위치가 없는 시설은 주소를 좌표로 변환하지 못한 경우입니다.",
}));

const api = vi.hoisted(() => ({
  fetchDataFreshness: vi.fn(),
  fetchSuitabilityPolicy: vi.fn(),
  fetchSuitabilityLatestRun: vi.fn(),
  fetchFacilityCostOptions: vi.fn(),
  fetchFacilityMappingTransparency: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, ...api };
});

import { ApiError } from "../lib/api";
import TransparencyDashboard from "./TransparencyDashboard";

/**
 * The served registry, exercising every branch the display layer has:
 * a translated row, an unknown row, a valid link, an absent link, and an invalid
 * link. `endpoint` values are non-resolving placeholders — nothing here is fetched.
 */
const SOURCES = [
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
    source_id: "waste_statistics",
    source_name: "Korea Environment Corporation Resource Circulation Information System",
    dataset_name: "전국폐기물발생및처리현황 (waste statistics OpenAPI)",
    endpoint: "https://www.recycling-info.or.kr/sds/JsonApi.do",
    publication_frequency: "ANNUAL",
    enabled: true,
    documentation_url: "https://www.recycling-info.or.kr/rrs/viewPage.do?menuNo=M130401",
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
  {
    source_id: "kma",
    source_name: "Korea Meteorological Administration",
    dataset_name: "Ultra-short-term observations and short-term forecasts",
    endpoint: "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0",
    publication_frequency: "REAL_TIME",
    enabled: true,
    // No served documentation URL → must render as unavailable, never guessed.
    documentation_url: null,
  },
  {
    source_id: "some_future_source_with_a_very_long_identifier",
    source_name: "Future Agency",
    dataset_name: "Future Dataset",
    endpoint: "https://example.invalid/future",
    publication_frequency: "WEEKLY",
    enabled: false,
    // Not an absolute http(s) URL → must not become a link.
    documentation_url: "not-a-url",
  },
];

const FRESHNESS = [
  {
    source_id: "sgis",
    source_name: "Statistics Korea SGIS",
    publication_frequency: "MONTHLY",
    latest_reference_period: "2024",
    last_checked_at: null,
    last_changed_at: null,
    last_success_at: "2026-07-15T23:45:00+00:00",
    next_scheduled_at: null,
    freshness_status: "FRESH",
  },
];

const data = {
  sources: SOURCES,
  population: {
    reference_year: 2024,
    count: 66,
    items: [{ reference_period: "2024", source_id: "sgis" }],
  },
  reportingStats: {
    reference_year: 2024,
    count: 40,
    items: [{ reference_period: "2022", source_id: "waste_statistics" }],
  },
  reportingPerCapita: {
    reference_year: 2022,
    count: 40,
    // A derived metric names BOTH official inputs.
    items: [{ waste_source_id: "waste_statistics", population_source_id: "sgis" }],
  },
  facilities: {
    reference_year: 2024,
    count: 120,
    items: [{ reference_period: "2024", source_id: "waste_statistics" }],
  },
} as unknown as LoadedData;

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchDataFreshness.mockResolvedValue(FRESHNESS);
  api.fetchSuitabilityPolicy.mockResolvedValue({
    policy_version: "suitability-policy-v2",
    derivation_version: "suitability-screening-v3",
    candidate_grid_version: "capital-grid-500m-v1",
  });
  api.fetchSuitabilityLatestRun.mockResolvedValue({
    id: 48,
    reference_year: 2024,
    candidate_count_total: 47893,
  });
  api.fetchFacilityCostOptions.mockResolvedValue({
    active_cost_version: "capex-standard-v2022dec",
  });
  api.fetchFacilityMappingTransparency.mockResolvedValue(mapping);
});
afterEach(cleanup);

/** Render and wait until the freshness join has resolved (either way). */
async function renderDashboard(overrides?: Partial<LoadedData>) {
  const result = render(<TransparencyDashboard data={{ ...data, ...overrides }} />);
  await screen.findByTestId("transparency-sources");
  await waitFor(() =>
    expect(screen.getByTestId("transparency-freshness-status").textContent).not.toContain(
      "불러오는 중",
    ),
  );
  return result;
}

function searchInput(): HTMLInputElement {
  return screen.getByTestId("transparency-search") as HTMLInputElement;
}

function cardTitles(): string[] {
  return screen
    .getAllByTestId("transparency-source-card")
    .map((card) => card.querySelector("p")!.textContent!.trim());
}

// --------------------------------------------------------------------------- //
// Structure and landmarks
// --------------------------------------------------------------------------- //

describe("structure", () => {
  it("renders exactly one h1 and mounts no map", async () => {
    const { container } = await renderDashboard();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")!.textContent).toBe("데이터와 출처");
    // Map-free: not merely hidden — nothing map-shaped exists in the subtree.
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.queryByTestId("map-container")).toBeNull();
    expect(screen.queryByTestId("map-legend")).toBeNull();
  });

  it("adds no navigation, main landmark, or sidebar of its own", async () => {
    const { container } = await renderDashboard();
    // The shared DashboardShell owns the nav and the single #main-content target;
    // a second one here would make the skip link ambiguous.
    expect(container.querySelectorAll("nav")).toHaveLength(0);
    expect(container.querySelectorAll("main")).toHaveLength(0);
    expect(container.querySelectorAll("#main-content")).toHaveLength(0);
    expect(container.querySelectorAll("aside")).toHaveLength(0);
  });

  it("renders the orientation strip after the heading when the page supplies one", async () => {
    const { container } = render(
      <TransparencyDashboard
        data={data}
        orientation={<p data-testid="mode-orientation">안내</p>}
      />,
    );
    await screen.findByTestId("transparency-sources");
    const h1 = container.querySelector("h1")!;
    const orientation = screen.getByTestId("mode-orientation");
    expect(h1.compareDocumentPosition(orientation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the standing information banner out of the alert role", async () => {
    await renderDashboard();
    const banner = screen.getByTestId("transparency-notice");
    // A standing explanation must never interrupt a screen reader on every render.
    expect(banner.getAttribute("role")).toBeNull();
    expect(banner.textContent).toContain("기준 기간");
    expect(banner.textContent).toContain("0이 아니라");
  });
});

// --------------------------------------------------------------------------- //
// Overview
// --------------------------------------------------------------------------- //

describe("source overview", () => {
  it("counts served records only, with no completeness or freshness score", async () => {
    await renderDashboard();
    const overview = screen.getByTestId("transparency-overview");
    expect(within(overview).getByTestId("transparency-overview-total").textContent).toContain(
      "5건",
    );
    // population, waste, landfill, weather = 4 NAMED subjects. The unknown record's
    // `분야 정보 없음` is the absence of a subject and is deliberately not counted.
    expect(within(overview).getByTestId("transparency-overview-areas").textContent).toContain(
      "4개",
    );
    // Only sgis has a served reference period.
    expect(within(overview).getByTestId("transparency-overview-period").textContent).toContain(
      "1건",
    );
    // sgis + waste_statistics + 15064381 served a usable URL; kma and the unknown did not.
    expect(within(overview).getByTestId("transparency-overview-link").textContent).toContain("3건");
    // Nothing resembling a grade or a percentage.
    expect(overview.textContent).not.toMatch(/%/);
    expect(overview.textContent).not.toContain("점수");
    expect(overview.textContent).not.toContain("등급");
  });
});

// --------------------------------------------------------------------------- //
// Catalog: search
// --------------------------------------------------------------------------- //

describe("source search", () => {
  it("gives the search field a visible associated label", async () => {
    await renderDashboard();
    const input = searchInput();
    const label = document.querySelector(`label[for="${input.id}"]`)!;
    expect(label.textContent).toBe("출처 검색");
    // Visible, not sr-only: this is a primary control.
    expect(label.className).not.toContain("sr-only");
    // Native input — no combobox library, no custom keyboard handling to trap focus.
    expect(input.tagName).toBe("INPUT");
  });

  it("matches a Korean dataset name and actually narrows the rendered list", async () => {
    await renderDashboard();
    expect(screen.getAllByTestId("transparency-source-card")).toHaveLength(5);
    fireEvent.change(searchInput(), { target: { value: "반입량" } });
    expect(cardTitles()).toEqual(["수도권 폐기물 반입량"]);
  });

  it("matches a source organisation name", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "기상청" } });
    expect(cardTitles()).toEqual(["초단기 실황과 단기 예보"]);
  });

  it("finds a record by its dataset identifier without titling the card with it", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "15064381" } });
    const cards = screen.getAllByTestId("transparency-source-card");
    expect(cards).toHaveLength(1);
    // The identifier is reachable, but the heading stays plain Korean.
    expect(cards[0].querySelector("p")!.textContent).toBe("수도권 폐기물 반입량");
    expect(cards[0].textContent).toContain("15064381");
  });

  it("clears via the clear control and restores the whole catalog", async () => {
    await renderDashboard();
    const before = cardTitles();
    fireEvent.change(searchInput(), { target: { value: "기상청" } });
    expect(screen.getAllByTestId("transparency-source-card")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("transparency-search-clear"));
    expect(cardTitles()).toEqual(before);
    expect(searchInput().value).toBe("");
  });

  it("hides the clear control while the query is empty", async () => {
    await renderDashboard();
    expect(screen.queryByTestId("transparency-search-clear")).toBeNull();
    fireEvent.change(searchInput(), { target: { value: "a" } });
    expect(screen.getByTestId("transparency-search-clear")).toBeDefined();
  });

  it("shows a no-match state that fabricates no source and is not an alert", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), {
      target: { value: "존재하지않는자료명" },
    });
    const empty = screen.getByTestId("transparency-empty-results");
    expect(screen.queryAllByTestId("transparency-source-card")).toHaveLength(0);
    expect(screen.queryByTestId("transparency-source-list")).toBeNull();
    // A local search miss is not an error and must not be announced as one.
    expect(empty.getAttribute("role")).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(empty.textContent).toContain("자료가 없는 것은 아닙니다");
  });

  it("restores the catalog from the no-match state's clear action", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), {
      target: { value: "존재하지않는자료명" },
    });
    fireEvent.click(screen.getByText("검색 조건 지우기"));
    expect(screen.getAllByTestId("transparency-source-card")).toHaveLength(5);
  });

  it("returns focus to the search field after either clear control", async () => {
    // Both clear controls unmount themselves on activation, so without an explicit
    // move, focus falls to <body> and a keyboard user is dropped to the top of the
    // document mid-task.
    await renderDashboard();

    fireEvent.change(searchInput(), { target: { value: "기상청" } });
    screen.getByTestId("transparency-search-clear").focus();
    fireEvent.click(screen.getByTestId("transparency-search-clear"));
    expect(document.activeElement).toBe(searchInput());
    expect(document.activeElement).not.toBe(document.body);

    fireEvent.change(searchInput(), {
      target: { value: "존재하지않는자료명" },
    });
    const emptyAction = screen.getByText("검색 조건 지우기");
    emptyAction.focus();
    fireEvent.click(emptyAction);
    expect(document.activeElement).toBe(searchInput());
  });
});

// --------------------------------------------------------------------------- //
// Catalog: filters and result count
// --------------------------------------------------------------------------- //

describe("filters", () => {
  it("offers only categories present in the served records", async () => {
    await renderDashboard();
    const select = screen.getByTestId("transparency-filter-category") as HTMLSelectElement;
    const labels = [...select.options].map((option) => option.textContent);
    expect(labels).toEqual([
      "전체",
      "인구",
      "폐기물 발생·처리",
      "수도권매립지",
      "기상 관측",
      "분야 정보 없음",
    ]);
    // No category the records cannot fill.
    expect(labels).not.toContain("공간정보");
    expect(labels).not.toContain("대기질 관측");
  });

  it("offers only the frequencies present in the served records", async () => {
    await renderDashboard();
    const select = screen.getByTestId("transparency-filter-frequency") as HTMLSelectElement;
    const labels = [...select.options].map((option) => option.textContent);
    expect(labels).toContain("월간");
    expect(labels).toContain("연간");
    expect(labels).toContain("실시간");
    // The unknown WEEKLY code is offered under a neutral label, never invented.
    expect(labels).toContain("갱신 주기 정보 없음");
    expect(labels).not.toContain("수시 갱신");
  });

  it("narrows the list by category and restores it when cleared", async () => {
    await renderDashboard();
    const select = screen.getByTestId("transparency-filter-category");
    fireEvent.change(select, { target: { value: "landfill" } });
    expect(cardTitles()).toEqual(["수도권 폐기물 반입량"]);
    fireEvent.change(select, { target: { value: "all" } });
    expect(screen.getAllByTestId("transparency-source-card")).toHaveLength(5);
  });

  it("combines the query and both filters", async () => {
    await renderDashboard();
    fireEvent.change(screen.getByTestId("transparency-filter-frequency"), {
      target: { value: "MONTHLY" },
    });
    expect(cardTitles()).toHaveLength(2);
    fireEvent.change(searchInput(), { target: { value: "인구" } });
    expect(cardTitles()).toEqual(["인구 통계와 행정경계"]);
  });

  it("keeps the catalog ordering stable when a filter is applied", async () => {
    await renderDashboard();
    // The full catalog is ordered by subject (population → waste → landfill →
    // weather → unclassified), then Korean name. Pinned exactly, so a reordering
    // regression fails here rather than being absorbed by a subset relation.
    expect(cardTitles()).toEqual([
      "인구 통계와 행정경계",
      "전국 폐기물 발생 및 처리 현황",
      "수도권 폐기물 반입량",
      "초단기 실황과 단기 예보",
      "Future Dataset",
    ]);
    fireEvent.change(screen.getByTestId("transparency-filter-frequency"), {
      target: { value: "MONTHLY" },
    });
    // A filter removes records; it never reorders the survivors.
    expect(cardTitles()).toEqual(["인구 통계와 행정경계", "수도권 폐기물 반입량"]);
  });

  it("announces the result count politely, outside any disclosure", async () => {
    await renderDashboard();
    const count = screen.getByTestId("transparency-result-count");
    expect(count.getAttribute("role")).toBe("status");
    expect(count.closest("details")).toBeNull();
    expect(count.textContent).toContain("전체 5건 중 5건 표시");

    fireEvent.change(searchInput(), { target: { value: "기상청" } });
    expect(screen.getByTestId("transparency-result-count").textContent).toContain(
      "전체 5건 중 1건 표시",
    );
    expect(screen.getByTestId("transparency-result-count").textContent).toContain("검색·필터 적용");
  });
});

// --------------------------------------------------------------------------- //
// Source cards
// --------------------------------------------------------------------------- //

describe("source cards", () => {
  it("leads with Korean names while keeping the served strings in the disclosure", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "sgis" } });
    const card = screen.getAllByTestId("transparency-source-card")[0];
    expect(card.querySelector("p")!.textContent).toBe("인구 통계와 행정경계");
    expect(card.textContent).toContain("통계청 SGIS");
    // Nothing is deleted: the served English text stays reachable.
    const disclosure = card.querySelector("details")!;
    expect(disclosure.hasAttribute("data-diagnostic")).toBe(true);
    expect(disclosure.textContent).toContain("Statistics Korea SGIS");
    expect(disclosure.textContent).toContain("Population statistics and administrative boundaries");
    expect(disclosure.textContent).toContain("MONTHLY");
    expect(disclosure.textContent).toContain("FRESH");
  });

  it("shows the served reference period and never relabels it as '최신'", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "sgis" } });
    const card = screen.getAllByTestId("transparency-source-card")[0];
    expect(card.textContent).toContain("기준 기간");
    expect(card.textContent).toContain("2024");
    // `freshness_status: FRESH` is written on ingestion success and never demoted,
    // so it must not be presented to a citizen as "this data is current".
    const primary = card.cloneNode(true) as HTMLElement;
    primary.querySelectorAll("[data-diagnostic]").forEach((node) => node.remove());
    expect(primary.textContent).not.toContain("최신");
  });

  it("renders the collection date from the served timestamp without shifting the day", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "sgis" } });
    // 2026-07-15T23:45Z must stay 2026-07-15 regardless of the runner's timezone…
    const card = screen.getAllByTestId("transparency-source-card")[0];
    expect(card.textContent).toContain("2026-07-15");
    // …and must carry the Korean timezone qualifier, because that instant is
    // 2026-07-16 08:45 in KST — without it the date is ambiguous by a day.
    expect(card.textContent).toContain("2026-07-15 (세계표준시)");
  });

  it("marks an unserved reference period as unavailable, never as zero or a date", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "기상청" } });
    const card = screen.getAllByTestId("transparency-source-card")[0];
    expect(card.textContent).toContain("기준 기간 정보 없음");
    expect(card.textContent).toContain("수집 기록 없음");
    expect(card.textContent).not.toContain("기준 기간0");
  });

  it("keeps an unknown source's served text and claims no subject for it", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "Future" } });
    const card = screen.getAllByTestId("transparency-source-card")[0];
    expect(card.querySelector("p")!.textContent).toBe("Future Dataset");
    expect(card.textContent).toContain("Future Agency");
    expect(card.textContent).toContain("분야 정보 없음");
    expect(card.textContent).toContain("갱신 주기 정보 없음");
    expect(card.textContent).toContain("사용 안 함");
    // The raw code stays available diagnostically rather than being interpreted.
    expect(card.querySelector("details")!.textContent).toContain("WEEKLY");
  });

  it("links only to a served, valid URL and never guesses one", async () => {
    await renderDashboard();

    fireEvent.change(searchInput(), { target: { value: "반입량" } });
    const linked = within(screen.getAllByTestId("transparency-source-card")[0]).getByTestId(
      "transparency-source-link",
    ) as HTMLAnchorElement;
    expect(linked.tagName).toBe("A");
    expect(linked.getAttribute("href")).toBe("https://www.data.go.kr/data/15064381/fileData.do");
    expect(linked.getAttribute("rel")).toContain("noreferrer");
    expect(linked.getAttribute("rel")).toContain("noopener");
    expect(linked.getAttribute("target")).toBe("_blank");
    // The accessible name names the dataset and states the new-window behaviour.
    expect(linked.textContent).toBe("수도권 폐기물 반입량 기관 안내 페이지 (새 창)");

    // No served URL → an explicit unavailable label, not a constructed link.
    fireEvent.change(searchInput(), { target: { value: "기상청" } });
    const noLink = screen.getAllByTestId("transparency-source-card")[0];
    expect(within(noLink).queryByTestId("transparency-source-link")).toBeNull();
    expect(within(noLink).getByTestId("transparency-source-nolink").textContent).toBe(
      "기관 안내 주소 없음",
    );

    // An invalid served value is treated the same way — never repaired into a link.
    fireEvent.change(searchInput(), { target: { value: "Future" } });
    const invalid = screen.getAllByTestId("transparency-source-card")[0];
    expect(within(invalid).queryByTestId("transparency-source-link")).toBeNull();
    expect(invalid.querySelectorAll("a")).toHaveLength(0);
  });

  it("lets a long identifier wrap instead of forcing the layout wider", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "Future" } });
    const card = screen.getAllByTestId("transparency-source-card")[0];
    const idCell = card.querySelector("details dd")!;
    expect(idCell.textContent).toBe("some_future_source_with_a_very_long_identifier");
    expect(idCell.className).toContain("break-all");
    // Every identifier cell in the disclosure wraps, not just the first.
    for (const cell of card.querySelectorAll("details dd")) {
      expect(cell.className).toContain("break-all");
    }
  });
});

// --------------------------------------------------------------------------- //
// Reference periods and value classification
// --------------------------------------------------------------------------- //

describe("dataset reference periods", () => {
  it("shows the served reference periods and record counts unchanged", async () => {
    await renderDashboard();
    const datasets = screen.getByTestId("transparency-datasets");
    expect(datasets.textContent).toContain("인구");
    expect(datasets.textContent).toContain("66"); // served population count
    expect(datasets.textContent).toContain("2024"); // population reference period
    expect(datasets.textContent).toContain("2022"); // waste reference period
    expect(datasets.textContent).toContain("서울·인천·경기 시군구");
    expect(datasets.textContent).toContain(
      "값이 없는 지역은 빈 칸으로 두며 0으로 채우지 않습니다.",
    );
  });

  it("distinguishes a directly reported value from a calculated one in plain Korean", async () => {
    await renderDashboard();
    const rows = screen.getByTestId("transparency-datasets").querySelectorAll("tbody tr");
    const perCapita = [...rows].find((row) => row.textContent!.includes("1인당 발생량"))!;
    const population = [...rows].find((row) => row.textContent!.startsWith("인구"))!;
    expect(perCapita.textContent).toContain("공식 자료 기반 계산값");
    expect(perCapita.textContent).toContain("기관이 직접 보고한 수치가 아닙니다");
    expect(population.textContent).toContain("직접 보고값");
    expect(population.textContent).not.toContain("공식 자료 기반 계산값");
  });

  it("attributes every displayed dataset to its served source", async () => {
    // repo AGENTS.md + redesign plan §5 rule 9: a displayed metric keeps its source.
    // Read off each response's own `source_id`, so attribution cannot drift from the
    // data — the two population series in this schema are NOT interchangeable.
    await renderDashboard();
    const rows = screen.getByTestId("transparency-datasets").querySelectorAll("tbody tr");
    const population = [...rows].find((row) => row.textContent!.startsWith("인구"))!;
    const facilities = [...rows].find((row) => row.textContent!.startsWith("처리시설"))!;
    expect(population.textContent).toContain("통계청 SGIS");
    expect(facilities.textContent).toContain("한국환경공단 자원순환정보시스템");
  });

  it("names BOTH official inputs for a derived dataset", async () => {
    await renderDashboard();
    const rows = screen.getByTestId("transparency-datasets").querySelectorAll("tbody tr");
    const perCapita = [...rows].find((row) => row.textContent!.includes("1인당 발생량"))!;
    expect(perCapita.textContent).toContain("한국환경공단 자원순환정보시스템"); // numerator
    expect(perCapita.textContent).toContain("통계청 SGIS"); // denominator
  });

  it("says so plainly when a response carried no source id — never guessing one", async () => {
    await renderDashboard({
      population: {
        reference_year: 2024,
        count: 3,
        items: [{ reference_period: "2024" }],
      },
    } as unknown as Partial<LoadedData>);
    const rows = screen.getByTestId("transparency-datasets").querySelectorAll("tbody tr");
    const population = [...rows].find((row) => row.textContent!.startsWith("인구"))!;
    expect(population.textContent).toContain("자료 출처 미표기");
  });

  it("falls back to the served reference year when no item period is present", async () => {
    await renderDashboard({
      population: { reference_year: 2019, count: 3, items: [] },
    } as unknown as Partial<LoadedData>);
    expect(screen.getByTestId("transparency-datasets").textContent).toContain("2019");
  });
});

// --------------------------------------------------------------------------- //
// Gaps and facility mapping
// --------------------------------------------------------------------------- //

describe("unavailable data", () => {
  it("lists the cost components using the shared glossary wording", async () => {
    await renderDashboard();
    const gaps = screen.getByTestId("transparency-cost");
    expect(gaps.textContent).toContain("운영비 (공식 자료 미연계)");
    expect(gaps.textContent).toContain("실제 운송비 (실 경로·계약 단가 미확보)");
    expect(gaps.textContent).toContain("토지·보상비 (필지별 비용 미확보)");
    expect(gaps.textContent).toContain("잔여 매립비용 (시설 물질수지 미확립)");
    expect(gaps.textContent).toContain("실제 총사업비가 아닙니다");
  });

  it("states the unmapped facility count without implying the facilities are absent", async () => {
    await renderDashboard();
    const gaps = await screen.findByTestId("transparency-gaps");
    await waitFor(() => expect(gaps.textContent).toContain("30개"));
    expect(gaps.textContent).toContain("집계에는 그대로 포함됩니다");
  });

  it("keeps an official zero distinct from an unavailable value", async () => {
    await renderDashboard();
    await waitFor(() => expect(screen.getByTestId("facility-mapping-counts")).toBeDefined());
    const counts = screen.getByTestId("facility-mapping-counts");
    expect(counts.textContent).toContain("120"); // total
    expect(counts.textContent).toContain("30"); // without map location
    // `without_address: 0` is a counted, official zero and stays a rendered 0 —
    // it must NOT be turned into "자료 없음".
    const addressCard = [...counts.querySelectorAll("div")].find((node) =>
      node.textContent?.startsWith("주소 없음"),
    )!;
    expect(addressCard.textContent).toContain("0");
    expect(addressCard.textContent).not.toContain("자료 없음");
    // Meanwhile an unserved reference period on a card IS an unavailable label.
    fireEvent.change(searchInput(), { target: { value: "기상청" } });
    expect(screen.getAllByTestId("transparency-source-card")[0].textContent).toContain(
      "기준 기간 정보 없음",
    );
  });

  it("never shows one page's facilities under another page's label", async () => {
    // 30 unmapped facilities at a page size of 25 → two pages. `page` changes
    // synchronously on click while the refetch is in flight, so without a gate the
    // previous page's rows render beneath the new page's label.
    api.fetchFacilityMappingTransparency.mockResolvedValue({
      ...mapping,
      unmapped: { ...mapping.unmapped, total: 30 },
    });
    await renderDashboard();
    await screen.findByTestId("transparency-unmapped-pagination");
    expect(screen.getByTestId("transparency-unmapped-pagination").textContent).toContain(
      "1 / 2 페이지",
    );
    expect(screen.getByTestId("unmapped-facility-table")).toBeDefined();

    // The mock keeps answering with page 1, so page 2 must show nothing rather than
    // re-labelling page 1's rows.
    fireEvent.click(screen.getByTestId("transparency-unmapped-next"));
    await waitFor(() =>
      expect(screen.getByTestId("transparency-unmapped-pagination").textContent).toContain(
        "2 / 2 페이지",
      ),
    );
    expect(screen.queryByTestId("unmapped-facility-table")).toBeNull();
    expect(screen.getByTestId("transparency-unmapped-paging")).toBeDefined();
  });

  it("keeps the pager operable after a page request fails", async () => {
    api.fetchFacilityMappingTransparency.mockResolvedValueOnce({
      ...mapping,
      unmapped: { ...mapping.unmapped, total: 30 },
    });
    await renderDashboard();
    await screen.findByTestId("transparency-unmapped-pagination");

    // Every later request fails.
    api.fetchFacilityMappingTransparency.mockRejectedValue(new Error("boom"));
    fireEvent.click(screen.getByTestId("transparency-unmapped-next"));

    await waitFor(() => expect(screen.getByTestId("transparency-mapping-error")).toBeDefined());
    // No stale rows or counts survive the failure…
    expect(screen.queryByTestId("unmapped-facility-table")).toBeNull();
    expect(screen.queryByTestId("facility-mapping-counts")).toBeNull();
    // …but the reader can still navigate back rather than being stranded.
    expect(screen.getByTestId("transparency-unmapped-prev")).toBeDefined();
    expect((screen.getByTestId("transparency-unmapped-prev") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("shows the recorded missing-location reason, or the honest placeholder", async () => {
    await renderDashboard();
    const table = await screen.findByTestId("unmapped-facility-table");
    // Recorded reason surfaced verbatim...
    expect(table.textContent).toContain("주소 정제 실패");
    // ...and the honest placeholder when none was recorded (never fabricated).
    expect(table.textContent).toContain("실패 사유 기록 없음");
  });
});

// --------------------------------------------------------------------------- //
// Loading, empty, and error states — five distinct outcomes
// --------------------------------------------------------------------------- //

describe("loading, empty, and error states", () => {
  it("announces loading in a status region while the skeleton stays decorative", async () => {
    // Never resolves, so the loading state is observable.
    api.fetchFacilityMappingTransparency.mockReturnValue(new Promise(() => {}));
    render(<TransparencyDashboard data={data} />);

    const loading = await screen.findByTestId("transparency-mapping-loading");
    expect(loading.getAttribute("role")).toBe("status");
    expect(loading.textContent).toContain("불러오는 중");

    const skeleton = screen.getByTestId("transparency-mapping-skeleton");
    expect(skeleton.getAttribute("aria-hidden")).toBe("true");
    // A skeleton must never look like data: no digits, no source names.
    expect(skeleton.textContent).toBe("");
    expect(screen.queryByTestId("facility-mapping-counts")).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("treats a successful empty registry as an answer, not an error", async () => {
    render(<TransparencyDashboard data={{ ...data, sources: [] } as unknown as LoadedData} />);
    const empty = await screen.findByTestId("transparency-sources-empty");
    expect(empty.getAttribute("role")).toBeNull();
    expect(empty.textContent).toContain("등록된 출처 기록이 없습니다");
    expect(empty.textContent).toContain("임의로 만들어 표시하지 않습니다");
    // The controls are not rendered for an empty registry, and no result count lies.
    expect(screen.queryByTestId("transparency-search")).toBeNull();
    expect(screen.queryByTestId("transparency-empty-results")).toBeNull();
  });

  it("raises a genuine request failure as an alert and keeps the raw code diagnostic", async () => {
    api.fetchFacilityMappingTransparency.mockRejectedValue(
      new ApiError(
        500,
        {
          error: "INTERNAL_ERROR",
          detail: "boom",
          requested_year: null,
          available_years: [],
          fields: null,
        },
        "INTERNAL_ERROR: boom",
      ),
    );
    await renderDashboard();

    const error = await screen.findByTestId("transparency-mapping-error");
    expect(error.getAttribute("role")).toBe("alert");
    // Plain Korean for the citizen…
    expect(error.textContent).toContain("잠시 문제가 발생했습니다");
    // …with the backend code preserved in a diagnostic line, not as the explanation.
    const detail = screen.getByTestId("transparency-mapping-error-detail");
    expect(detail.hasAttribute("data-diagnostic")).toBe(true);
    expect(detail.textContent).toContain("INTERNAL_ERROR");
    // No fabricated counts alongside the failure.
    expect(screen.queryByTestId("facility-mapping-counts")).toBeNull();
  });

  it("keeps a failed freshness request distinct from 'no reference period exists'", async () => {
    api.fetchDataFreshness.mockRejectedValue(new Error("network"));
    render(<TransparencyDashboard data={data} />);
    const note = await screen.findByTestId("transparency-freshness-error");
    // Not an alert — the catalog still renders and nothing is wrong with the data.
    expect(note.getAttribute("role")).toBeNull();
    expect(note.textContent).toContain("확인하지 못한 상태");
    fireEvent.change(searchInput(), { target: { value: "sgis" } });
    const card = screen.getAllByTestId("transparency-source-card")[0];
    expect(card.textContent).toContain("기준 기간을 불러오지 못했습니다");
    expect(card.textContent).not.toContain("기준 기간 정보 없음");
  });

  it("never reports an unfetched reference-period count as a measured zero", async () => {
    api.fetchDataFreshness.mockRejectedValue(new Error("network"));
    render(<TransparencyDashboard data={data} />);
    await screen.findByTestId("transparency-freshness-error");
    const card = screen.getByTestId("transparency-overview-period");
    // The VALUE slot is what a reader reads as the figure. `0건` there would state
    // that none of the 5 official datasets has a reference period, when in fact the
    // count was never fetched — and it would never self-correct.
    const value = card.querySelector("dd")!;
    expect(value.textContent).not.toContain("0");
    expect(value.textContent).toBe("확인하지 못했습니다");
    // The caption says explicitly that this is not a zero.
    expect(card.textContent).toContain("0건이라는 뜻이 아닙니다");
  });

  it("shows the reference-period count as pending, not zero, while loading", async () => {
    api.fetchDataFreshness.mockReturnValue(new Promise(() => {}));
    render(<TransparencyDashboard data={data} />);
    const card = await screen.findByTestId("transparency-overview-period");
    const value = card.querySelector("dd")!;
    expect(value.textContent).not.toContain("0");
    expect(value.textContent).toBe("확인 중");
  });

  it("announces the freshness resolution, not just its start", async () => {
    // The region must stay MOUNTED and change its text: a live region that already
    // holds its content when inserted is generally not announced, and removing one
    // announces nothing — so a conditional "loading" message would leave the
    // resolution silent while every reference period on screen changed.
    const { rerender } = render(<TransparencyDashboard data={data} />);
    const live = screen.getByTestId("transparency-freshness-status");
    expect(live.getAttribute("role")).toBe("status");
    expect(live.textContent).toContain("불러오는 중");
    rerender(<TransparencyDashboard data={data} />);
    await waitFor(() =>
      expect(screen.getByTestId("transparency-freshness-status").textContent).toContain(
        "확인을 마쳤습니다",
      ),
    );
    // Same node, new text — that is what gets announced.
    expect(screen.getByTestId("transparency-freshness-status")).toBe(live);
    expect(live.textContent).toContain("1건");
  });

  it("keeps the search-empty state separate from the registry-empty state", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "없는자료" } });
    expect(screen.getByTestId("transparency-empty-results")).toBeDefined();
    expect(screen.queryByTestId("transparency-sources-empty")).toBeNull();
  });
});

// --------------------------------------------------------------------------- //
// Technical provenance and terminology
// --------------------------------------------------------------------------- //

describe("technical provenance", () => {
  it("keeps the analysis versions reachable but off the primary surface", async () => {
    await renderDashboard();
    const technical = await screen.findByTestId("transparency-technical");
    await waitFor(() => expect(technical.textContent).toContain("suitability-policy-v2"));
    expect(technical.textContent).toContain("suitability-screening-v3");
    expect(technical.textContent).toContain("capital-grid-500m-v1");
    expect(technical.textContent).toContain("capex-standard-v2022dec");
    // Each identifier is marked diagnostic, and each carries its plain Korean name.
    expect(technical.textContent).toContain("분석 규칙 버전");
    expect(technical.textContent).toContain("계산 방식 버전");
    expect(technical.textContent).toContain("분석 구역 버전");
    expect(screen.getByTestId("transparency-cost-version").hasAttribute("data-diagnostic")).toBe(
      true,
    );
    // They live inside a real disclosure, so they are not primary content.
    expect(technical.tagName).toBe("DETAILS");
  });

  it("surfaces no forbidden technical token on the primary surface", async () => {
    const { container } = await renderDashboard();
    await waitFor(() =>
      expect(screen.getByTestId("transparency-technical").textContent).toContain(
        "suitability-policy-v2",
      ),
    );
    const primary = container.cloneNode(true) as HTMLElement;
    // Diagnostic disclosures are legal homes for a raw code — strip them, then scan.
    primary.querySelectorAll("[data-diagnostic]").forEach((node) => node.remove());
    // The 기술 정보 accordion is itself a disclosure layer.
    primary.querySelectorAll("[data-testid='transparency-technical']").forEach((n) => n.remove());
    const text = primary.textContent ?? "";
    for (const token of FORBIDDEN_PRIMARY_TOKENS) {
      expect(text, `forbidden token on the primary surface: ${token}`).not.toContain(token);
    }
  });

  it("states the analysis is unavailable rather than inventing versions", async () => {
    api.fetchSuitabilityPolicy.mockRejectedValue(new Error("no policy"));
    api.fetchSuitabilityLatestRun.mockRejectedValue(new Error("no run"));
    api.fetchFacilityCostOptions.mockRejectedValue(new Error("no options"));
    await renderDashboard();
    const suitability = await screen.findByTestId("transparency-suitability");
    expect(suitability.textContent).toContain("아직 표시할 후보지 분석 결과가 없습니다");
    expect(screen.queryByTestId("transparency-cost-version")).toBeNull();
  });

  it("preserves the scenario non-persistence disclosure", async () => {
    await renderDashboard();
    expect(screen.getByTestId("transparency-scenario").textContent).toContain("저장되지 않습니다");
  });

  it("traps no live region inside a collapsed disclosure", async () => {
    const { container } = await renderDashboard();
    for (const region of container.querySelectorAll('[role="status"], [role="alert"]')) {
      const details = region.closest("details");
      // Either not in a disclosure at all, or in one that is open.
      expect(details === null || details.hasAttribute("open")).toBe(true);
    }
  });

  it("keeps every disclosure a native, keyboard-operable details element", async () => {
    const { container } = await renderDashboard();
    const disclosures = container.querySelectorAll("details");
    expect(disclosures.length).toBeGreaterThan(0);
    for (const disclosure of disclosures) {
      // A native <summary> gives Enter/Space and AT state for free — no JS needed.
      expect(disclosure.querySelector("summary")).not.toBeNull();
      expect(disclosure.querySelector("summary")!.textContent!.trim().length).toBeGreaterThan(0);
    }
  });
});
