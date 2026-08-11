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
/** The <h1>, supplied by the page as the visible destination name (spec §2.2). */
const TITLE = "데이터·출처";

afterEach(cleanup);

/** Render and wait until the freshness join has resolved (either way). */
async function renderDashboard(overrides?: Partial<LoadedData>) {
  const result = render(<TransparencyDashboard title={TITLE} data={{ ...data, ...overrides }} />);
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
    expect(container.querySelector("h1")!.textContent).toBe(TITLE);
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
        title={TITLE}
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
    // Nothing resembling a grade or a percentage. The section's own supporting
    // line (Figma frame 156:470) NAMES 완성도 점수 and 품질 등급 in order to
    // disclaim them, so the two words are excluded from the values rather than
    // from the whole section — the disclaimer is the opposite of the defect.
    expect(overview.textContent).not.toMatch(/%/);
    const values = [...overview.querySelectorAll("dd")].map((node) => node.textContent).join(" ");
    expect(values).not.toContain("점수");
    expect(values).not.toContain("등급");
    expect(
      within(overview).getByText(
        "모두 등록된 기록의 개수입니다. 완성도 점수나 품질 등급이 아닙니다.",
      ),
    ).toBeDefined();
  });

  it("computes every counter from the served records rather than a fixed design value", async () => {
    // Figma frame 156:470 draws 9 / 6 / 5 / 2 in these four tiles. This registry is
    // a different size on every axis, so a tile that reproduced the design would
    // fail here — which is the point of asserting it explicitly.
    await renderDashboard();
    const overview = screen.getByTestId("transparency-overview");
    const figures = ["9건", "6개", "5건", "2건"];
    for (const figure of figures) {
      expect(within(overview).queryByText(figure), figure).toBeNull();
    }
    // …and the counters that ARE shown are this registry's.
    const shown = [...overview.querySelectorAll("dd")].map((node) => node.textContent);
    expect(shown).toEqual(["5건", "4개", "1건", "3건"]);
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

  it("restores the catalog from the permanent clear-all control", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), {
      target: { value: "존재하지않는자료명" },
    });
    fireEvent.click(screen.getByTestId("transparency-clear-filters"));
    expect(screen.getAllByTestId("transparency-source-card")).toHaveLength(5);
  });

  it("returns focus to the search field after either clear control", async () => {
    // 검색어 지우기 unmounts itself on activation, and 검색 조건 지우기 disables
    // itself, so without an explicit move focus falls to <body> and a keyboard user
    // is dropped to the top of the document mid-task.
    await renderDashboard();

    fireEvent.change(searchInput(), { target: { value: "기상청" } });
    screen.getByTestId("transparency-search-clear").focus();
    fireEvent.click(screen.getByTestId("transparency-search-clear"));
    expect(document.activeElement).toBe(searchInput());
    expect(document.activeElement).not.toBe(document.body);

    fireEvent.change(searchInput(), {
      target: { value: "존재하지않는자료명" },
    });
    const clearAll = screen.getByTestId("transparency-clear-filters");
    clearAll.focus();
    fireEvent.click(clearAll);
    expect(document.activeElement).toBe(searchInput());
  });
});

// --------------------------------------------------------------------------- //
// Catalog: the permanent clear-all control (Figma frame 156:470)
// --------------------------------------------------------------------------- //

describe("검색 조건 지우기", () => {
  it("is present but disabled before anything is filtered", async () => {
    await renderDashboard();
    const clear = screen.getByTestId("transparency-clear-filters") as HTMLButtonElement;
    // Disabled rather than absent: a control that appears and vanishes shifts the
    // row under the pointer, and its unavailability would otherwise be inferable
    // only by sighted readers.
    expect(clear.disabled).toBe(true);
    expect(clear.textContent).toBe("검색 조건 지우기");
  });

  it("enables as soon as ANY one of the three controls leaves its default", async () => {
    await renderDashboard();
    const clear = () => screen.getByTestId("transparency-clear-filters") as HTMLButtonElement;

    fireEvent.change(searchInput(), { target: { value: "기상청" } });
    expect(clear().disabled).toBe(false);
    fireEvent.click(clear());
    expect(clear().disabled).toBe(true);

    fireEvent.change(screen.getByTestId("transparency-filter-category"), {
      target: { value: "landfill" },
    });
    expect(clear().disabled).toBe(false);
    fireEvent.click(clear());
    expect(clear().disabled).toBe(true);

    fireEvent.change(screen.getByTestId("transparency-filter-frequency"), {
      target: { value: "MONTHLY" },
    });
    expect(clear().disabled).toBe(false);
  });

  it("clears the search term and BOTH filters in one activation", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "반입" } });
    fireEvent.change(screen.getByTestId("transparency-filter-category"), {
      target: { value: "landfill" },
    });
    fireEvent.change(screen.getByTestId("transparency-filter-frequency"), {
      target: { value: "MONTHLY" },
    });
    expect(screen.getByTestId("transparency-filter-summary").textContent).toContain("검색어 · 반입");

    fireEvent.click(screen.getByTestId("transparency-clear-filters"));

    expect((searchInput() as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("transparency-filter-category") as HTMLSelectElement).value).toBe(
      "all",
    );
    expect((screen.getByTestId("transparency-filter-frequency") as HTMLSelectElement).value).toBe(
      "all",
    );
    expect(screen.getAllByTestId("transparency-source-card")).toHaveLength(5);
    expect(screen.getByTestId("transparency-filter-summary").textContent).toContain(
      "검색어와 필터를 적용하지 않았습니다",
    );
  });

  it("is the ONLY control carrying that name, so the accessible name stays unambiguous", async () => {
    await renderDashboard();
    // The no-match empty state used to render a second button with the same label,
    // which made getByRole("button", { name }) ambiguous for the suites and gave a
    // screen-reader user two identically-named controls.
    fireEvent.change(searchInput(), { target: { value: "존재하지않는자료명" } });
    expect(screen.getByTestId("transparency-empty-results")).toBeDefined();
    expect(screen.getAllByRole("button", { name: "검색 조건 지우기" })).toHaveLength(1);
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
      // Figma's wording for the default option: a collapsed select still says what
      // it is showing everything OF.
      "모든 분야",
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
    // Figma prints the same three words on every card. The VISIBLE text is that,
    // but the ACCESSIBLE name still names the dataset and states the new-window
    // behaviour, so a screen-reader link list is not a dozen identical entries.
    expect(linked.textContent).toBe("공식 안내 페이지");
    expect(linked.getAttribute("aria-label")).toBe("수도권 폐기물 반입량 기관 안내 페이지 (새 창)");

    // No served URL → an explicit unavailable label, not a constructed link. A
    // served `documentation_url` of null is valid registry data (production's
    // `municipal_waste_cost_disclosure` is exactly that), never an error state.
    fireEvent.change(searchInput(), { target: { value: "기상청" } });
    const noLink = screen.getAllByTestId("transparency-source-card")[0];
    expect(within(noLink).queryByTestId("transparency-source-link")).toBeNull();
    expect(within(noLink).getByTestId("transparency-source-nolink").textContent).toBe("링크 없음");
    // Not announced as a failure, and no href anywhere on the card.
    expect(noLink.querySelector('[role="alert"]')).toBeNull();
    expect(noLink.querySelectorAll("a")).toHaveLength(0);

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
    render(<TransparencyDashboard title={TITLE} data={data} />);

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
    render(
      <TransparencyDashboard title={TITLE} data={{ ...data, sources: [] } as unknown as LoadedData} />,
    );
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
    render(<TransparencyDashboard title={TITLE} data={data} />);
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
    render(<TransparencyDashboard title={TITLE} data={data} />);
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
    render(<TransparencyDashboard title={TITLE} data={data} />);
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
    const { rerender } = render(<TransparencyDashboard title={TITLE} data={data} />);
    const live = screen.getByTestId("transparency-freshness-status");
    expect(live.getAttribute("role")).toBe("status");
    expect(live.textContent).toContain("불러오는 중");
    rerender(<TransparencyDashboard title={TITLE} data={data} />);
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

  it("explains what each state label on this screen means, without claiming currency", async () => {
    await renderDashboard();
    const guide = screen.getByTestId("transparency-status-guide");
    expect(guide.tagName).toBe("DETAILS");
    for (const term of [
      "직접 보고값",
      "공식 자료 기반 계산값",
      "기준 기간 정보 없음",
      "수집 시점",
      "사용 안 함",
    ]) {
      expect(guide.textContent).toContain(term);
    }
    // An absent period and a failed lookup are named as DIFFERENT states.
    expect(guide.textContent).toContain("기준 기간을 불러오지 못했습니다");
    expect(guide.textContent).toContain("값이 0이라는");
    // `freshness_status` is written FRESH on ingestion success and never demoted, so
    // the guide must not describe a collection time as a currency claim.
    expect(guide.textContent).not.toContain("최신");
  });
});

// --------------------------------------------------------------------------- //
// Civic-dashboard refresh — the structural contracts this milestone added.
// --------------------------------------------------------------------------- //

describe("refresh: sections, headings, and shared primitives", () => {
  /** The page's titled regions, in the order the reader meets them. */
  const SECTIONS = [
    "transparency-sources",
    "transparency-datasets",
    "transparency-gaps",
    "transparency-facility-mapping",
    "transparency-methodology",
  ];

  it("names every card section as a region, so the outline is walkable", async () => {
    await renderDashboard();
    for (const testId of SECTIONS) {
      const section = screen.getByTestId(testId);
      // The shared SectionCard primitive, not this file's former private copy:
      // a titled card is a <section> whose accessible name comes from its heading.
      expect(section.tagName, testId).toBe("SECTION");
      const labelledBy = section.getAttribute("aria-labelledby");
      expect(labelledBy, `${testId} names itself`).not.toBeNull();
      const heading = document.getElementById(labelledBy!)!;
      expect(heading.tagName, `${testId} heading level`).toBe("H2");
      expect(heading.textContent!.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives the overview a visible, non-sr-only heading of its own", async () => {
    await renderDashboard();
    const overview = screen.getByTestId("transparency-overview");
    expect(overview.tagName).toBe("SECTION");
    const heading = document.getElementById(overview.getAttribute("aria-labelledby")!)!;
    expect(heading.textContent).toBe("한눈에 보기");
    // Before the refresh this was the one block on the page a sighted reader could
    // not name — its only heading was sr-only.
    expect(heading.className).not.toContain("sr-only");
  });

  it("keeps the sections in their documented reading order", async () => {
    const { container } = await renderDashboard();
    const order = ["transparency-notice", "transparency-overview", ...SECTIONS];
    const nodes = order.map((testId) => screen.getByTestId(testId));
    for (let index = 1; index < nodes.length; index += 1) {
      const position = nodes[index - 1].compareDocumentPosition(nodes[index]);
      expect(
        Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING),
        `${order[index]} follows ${order[index - 1]}`,
      ).toBe(true);
    }
    // The h1 precedes all of them and there is still exactly one.
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("adds no second h1, fieldset, or live region duplicate", async () => {
    const { container } = await renderDashboard();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("fieldset")).toHaveLength(0);
    // Exactly one result count and one freshness announcement — never two copies of
    // the same fact racing to be announced.
    expect(screen.getAllByTestId("transparency-result-count")).toHaveLength(1);
    expect(screen.getAllByTestId("transparency-freshness-status")).toHaveLength(1);
  });
});

describe("refresh: the current-condition summary", () => {
  it("says plainly that nothing is filtered before the reader touches a control", async () => {
    await renderDashboard();
    const summary = screen.getByTestId("transparency-filter-summary");
    expect(summary.textContent).toContain("현재 조건");
    expect(summary.textContent).toContain("검색어와 필터를 적용하지 않았습니다");
    // No fabricated condition, and no claim that the catalog is complete.
    expect(summary.textContent).not.toContain("전부");
  });

  it("names the active search term and both filters, not merely that filtering is on", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "반입량" } });
    fireEvent.change(screen.getByTestId("transparency-filter-category"), {
      target: { value: "landfill" },
    });
    fireEvent.change(screen.getByTestId("transparency-filter-frequency"), {
      target: { value: "MONTHLY" },
    });
    const summary = screen.getByTestId("transparency-filter-summary");
    expect(summary.textContent).toContain("검색어 · 반입량");
    expect(summary.textContent).toContain("자료 분야 · 수도권매립지");
    expect(summary.textContent).toContain("갱신 주기 · 월간");
  });

  it("reports state and is never a second way to change it", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "반입량" } });
    const summary = screen.getByTestId("transparency-filter-summary");
    // A FilterChip is a <button aria-pressed>; this summary must not become one.
    expect(summary.querySelectorAll("button")).toHaveLength(0);
    expect(summary.querySelectorAll("input")).toHaveLength(0);
    expect(summary.querySelectorAll("select")).toHaveLength(0);
  });

  it("clears back to the unfiltered statement", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "기상청" } });
    expect(screen.getByTestId("transparency-filter-summary").textContent).toContain(
      "검색어 · 기상청",
    );
    fireEvent.click(screen.getByTestId("transparency-search-clear"));
    expect(screen.getByTestId("transparency-filter-summary").textContent).toContain(
      "검색어와 필터를 적용하지 않았습니다",
    );
  });

  it("holds the polite result count, still outside every disclosure", async () => {
    await renderDashboard();
    const count = screen.getByTestId("transparency-result-count");
    expect(count.getAttribute("role")).toBe("status");
    expect(count.closest("details")).toBeNull();
    expect(screen.getByTestId("transparency-filter-summary").contains(count)).toBe(true);
  });

  it("is not rendered at all for an empty registry, so no condition is implied", async () => {
    render(
      <TransparencyDashboard title={TITLE} data={{ ...data, sources: [] } as unknown as LoadedData} />,
    );
    await screen.findByTestId("transparency-sources-empty");
    expect(screen.queryByTestId("transparency-filter-summary")).toBeNull();
    expect(screen.queryByTestId("transparency-result-count")).toBeNull();
  });
});

describe("refresh: provenance badges", () => {
  it("states reported vs derived with the shared badge, keeping the exact wording", async () => {
    await renderDashboard();
    const rows = screen.getByTestId("transparency-datasets").querySelectorAll("tbody tr");
    const population = [...rows].find((row) => row.textContent!.startsWith("인구"))!;
    const perCapita = [...rows].find((row) => row.textContent!.includes("1인당 발생량"))!;

    const reported = population.querySelector(".wep-badge")!;
    expect(reported.getAttribute("data-status")).toBe("reported");
    expect(reported.textContent).toBe("직접 보고값");

    const derived = perCapita.querySelector(".wep-badge")!;
    expect(derived.getAttribute("data-status")).toBe("derived");
    expect(derived.textContent).toBe("공식 자료 기반 계산값");
  });

  it("marks an absent reference period as missing — neutral, never amber, never zero", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "기상청" } });
    const badge = screen.getByTestId("transparency-source-noperiod");
    expect(badge.getAttribute("data-status")).toBe("missing");
    // The state survives a grayscale render: the label is text.
    expect(badge.textContent).toBe("기준 기간 정보 없음");
    expect(badge.className).toContain("wep-badge-missing");
    // Amber is a caution about a value that EXISTS; absence is not a caution.
    expect(badge.className).not.toContain("wep-badge-caveat");
  });

  it("does not badge a period that WAS served — a value needs no status", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "sgis" } });
    const card = screen.getAllByTestId("transparency-source-card")[0];
    expect(card.textContent).toContain("2024");
    expect(within(card).queryByTestId("transparency-source-noperiod")).toBeNull();
  });

  it("keeps a failed freshness lookup out of the missing badge entirely", async () => {
    api.fetchDataFreshness.mockRejectedValue(new Error("network"));
    render(<TransparencyDashboard title={TITLE} data={data} />);
    await screen.findByTestId("transparency-freshness-error");
    fireEvent.change(searchInput(), { target: { value: "sgis" } });
    // A request that failed says nothing about whether a period exists, so it must
    // not borrow the badge that means "no value was served".
    expect(screen.queryByTestId("transparency-source-noperiod")).toBeNull();
    expect(screen.getAllByTestId("transparency-source-card")[0].textContent).toContain(
      "기준 기간을 불러오지 못했습니다",
    );
  });

  it("marks a switched-off registry row as excluded, with its served wording", async () => {
    await renderDashboard();
    fireEvent.change(searchInput(), { target: { value: "Future" } });
    const badge = screen.getByTestId("transparency-source-disabled");
    expect(badge.getAttribute("data-status")).toBe("excluded");
    expect(badge.textContent).toBe("사용 안 함");
    // An enabled source carries no badge — the marker is for the exceptional state.
    fireEvent.change(searchInput(), { target: { value: "sgis" } });
    expect(screen.queryByTestId("transparency-source-disabled")).toBeNull();
    expect(screen.getAllByTestId("transparency-source-card")[0].textContent).toContain("사용 중");
  });

  it("grades no source: no score, percentage, or ranking anywhere in the catalog", async () => {
    await renderDashboard();
    // `textContent` concatenates adjacent labels with no separator, which manufactures
    // Korean substrings that were never rendered — 수집 시점 followed by 수집 기록 없음
    // reads as "…시점수집…" and contains 점수. Joining element boundaries with a space
    // scans what a reader actually sees.
    const spaced = (node: Node): string =>
      node.nodeType === Node.TEXT_NODE
        ? (node.textContent ?? "")
        : [...node.childNodes].map(spaced).join(" ");
    const text = spaced(screen.getByTestId("transparency-source-list"));
    for (const token of ["점수", "등급", "순위", "신뢰도", "%"]) {
      expect(text, `catalog leaks "${token}"`).not.toContain(token);
    }
  });
});

describe("refresh: known gaps", () => {
  it("separates the three kinds of gap instead of listing them as one failure", async () => {
    await renderDashboard();
    const gaps = await screen.findByTestId("transparency-gaps");
    expect(within(gaps).getByTestId("transparency-cost")).toBeDefined();
    expect(within(gaps).getByTestId("transparency-gap-unmapped")).toBeDefined();
    expect(within(gaps).getByTestId("transparency-gap-period")).toBeDefined();
    // None of them is an alert: a gap is a documented limitation, not an error.
    expect(gaps.querySelector('[role="alert"]')).toBeNull();
  });

  it("counts the sources with no served reference period from the served records", async () => {
    await renderDashboard();
    const gap = screen.getByTestId("transparency-gap-period");
    // 5 registered, 1 with a served period → 4 without.
    expect(gap.textContent).toContain("등록된 출처 5건");
    expect(gap.textContent).toContain("4건");
    // And it says explicitly what that does NOT mean.
    expect(gap.textContent).toContain("자료를 내지 않았다는 뜻이 아니라");
  });

  it("shows no count at all while the freshness join is unresolved", async () => {
    api.fetchDataFreshness.mockReturnValue(new Promise(() => {}));
    render(<TransparencyDashboard title={TITLE} data={data} />);
    const gap = await screen.findByTestId("transparency-gap-period");
    expect(gap.textContent).toContain("확인하는 중");
    expect(gap.textContent).not.toMatch(/\d건/);
  });

  it("never reports an unfetched gap count as a measured zero", async () => {
    api.fetchDataFreshness.mockRejectedValue(new Error("network"));
    render(<TransparencyDashboard title={TITLE} data={data} />);
    await screen.findByTestId("transparency-freshness-error");
    const gap = screen.getByTestId("transparency-gap-period");
    expect(gap.textContent).toContain("0건이라는 뜻이 아닙니다");
    expect(gap.textContent).not.toMatch(/[^0]\d*건 가운데/);
  });

  it("states the unmapped facilities exist rather than being absent", async () => {
    await renderDashboard();
    const gap = await screen.findByTestId("transparency-gap-unmapped");
    await waitFor(() => expect(gap.textContent).toContain("30개"));
    expect(gap.textContent).toContain("집계에는 그대로 포함됩니다");
  });
});

describe("refresh: table semantics and bounded overflow", () => {
  it("gives every table a caption, column scopes, and a row header", async () => {
    const { container } = await renderDashboard();
    await screen.findByTestId("unmapped-facility-table");
    const tables = container.querySelectorAll("table");
    expect(tables.length).toBeGreaterThanOrEqual(2);
    for (const table of tables) {
      expect(table.querySelector("caption"), "every table names itself").not.toBeNull();
      const headers = [...table.querySelectorAll("thead th")];
      expect(headers.length).toBeGreaterThan(0);
      for (const header of headers) {
        expect(header.getAttribute("scope")).toBe("col");
      }
      // Each body row leads with a row header, so a cell is announced with the
      // record it belongs to rather than as a bare number.
      for (const row of table.querySelectorAll("tbody tr")) {
        expect(row.querySelector("th")?.getAttribute("scope")).toBe("row");
      }
    }
  });

  it("keeps each table's horizontal scroll inside its own wrapper", async () => {
    await renderDashboard();
    const unmapped = await screen.findByTestId("unmapped-facility-table");
    const datasets = screen.getByTestId("transparency-datasets").querySelector("table")!;
    for (const table of [unmapped, datasets]) {
      const wrapper = table.closest("div")!;
      expect(wrapper.className).toContain("overflow-x-auto");
    }
  });

  it("drops no unmapped record and invents no reason for one", async () => {
    await renderDashboard();
    const table = await screen.findByTestId("unmapped-facility-table");
    const rows = table.querySelectorAll("tbody tr");
    // Both served facilities are listed, including the one with no recorded reason.
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector("th")!.textContent).toBe("가나 소각장");
    expect(rows[1].querySelector("th")!.textContent).toBe("다라 매립장");
    expect(table.textContent).toContain("주소 정제 실패");
    expect(table.textContent).toContain("실패 사유 기록 없음");
  });

  it("gives the pager buttons names that stand on their own", async () => {
    api.fetchFacilityMappingTransparency.mockResolvedValue({
      ...mapping,
      unmapped: { ...mapping.unmapped, total: 30 },
    });
    await renderDashboard();
    await screen.findByTestId("transparency-unmapped-pagination");
    const previous = screen.getByTestId("transparency-unmapped-prev");
    const next = screen.getByTestId("transparency-unmapped-next");
    expect(previous.getAttribute("aria-label")).toBe("이전 페이지");
    expect(next.getAttribute("aria-label")).toBe("다음 페이지");
    // Native buttons that expose their boundary rather than hiding it.
    expect(previous.tagName).toBe("BUTTON");
    expect((previous as HTMLButtonElement).disabled).toBe(true);
    expect((next as HTMLButtonElement).disabled).toBe(false);
  });
});
