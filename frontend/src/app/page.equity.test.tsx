// @vitest-environment jsdom

/**
 * 지역 지표 (equity) feature tests: regional ranking, 지표 순위 전체보기, and the
 * share/export bar, plus shared-URL restore. MapView is stubbed; the API is mocked
 * with a small set of real-format SGIS regions so the ranking has values to rank.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub() {
      return <div data-testid="map-container" />;
    },
}));

function boundaryFeature(code: string, name: string) {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [126.97, 37.57],
          [126.99, 37.57],
          [126.99, 37.59],
          [126.97, 37.59],
          [126.97, 37.57],
        ],
      ],
    },
    properties: {
      region_code: code,
      region_name: name,
      region_level: "SIGUNGU",
      parent_region_code: null,
      source_id: "sgis",
      boundary_reference_period: "2024",
    },
  };
}

function populationItem(code: string, name: string, population: number) {
  return {
    region_code: code,
    region_name: name,
    region_level: "SIGUNGU",
    population,
    unit: "persons",
    population_definition: "SGIS 총인구",
    source_id: "sgis",
    reference_year: 2024,
    reference_period: "2024",
  };
}

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const { homeApiMock } = await import("./homeApiMock");
  const base = homeApiMock(actual);
  return {
    ...base,
    fetchBoundaries: vi.fn().mockResolvedValue({
      type: "FeatureCollection",
      reference_year: 2024,
      count: 5,
      features: [
        boundaryFeature("KR-SGIS-11110", "종로구"),
        boundaryFeature("KR-SGIS-11140", "중구"),
        boundaryFeature("KR-SGIS-23320", "옹진군"),
        boundaryFeature("KR-SGIS-31011", "수원시 장안구"),
        boundaryFeature("KR-SGIS-11170", "용산구"), // no population → unavailable
      ],
    }),
    fetchPopulation: vi.fn().mockResolvedValue({
      reference_year: 2024,
      count: 4,
      items: [
        populationItem("KR-SGIS-11110", "종로구", 300000),
        populationItem("KR-SGIS-11140", "중구", 100000),
        populationItem("KR-SGIS-23320", "옹진군", 0), // official measured zero
        populationItem("KR-SGIS-31011", "수원시 장안구", 500000),
      ],
    }),
  };
});

import { RANKING_FULL_VIEW_LABEL } from "../lib/ranking";
import Home from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  // Provide object-URL + clipboard shims jsdom lacks, so export/copy paths run.
  if (!("createObjectURL" in URL)) {
    // @ts-expect-error jsdom shim
    URL.createObjectURL = vi.fn(() => "blob:mock");
    // @ts-expect-error jsdom shim
    URL.revokeObjectURL = vi.fn();
  }
});
afterEach(cleanup);

async function renderEquity() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  return utils;
}

describe("regional ranking", () => {
  it("ranks by the served value, highest and lowest, with an official 0 ranked", async () => {
    await renderEquity();
    // Since Phase 1 the card shows ONE list at a time with a ↑/↓ direction toggle
    // (Figma frame 74:2025) instead of the two side-by-side columns. Both orderings
    // are still `rankRegions`' own `high`/`low`; the toggle only chooses which is
    // rendered, and the list keeps the `rank-high`/`rank-low` test id of the end it
    // is showing.
    const high = screen.getByTestId("rank-high");
    // Highest value first (수원시 장안구 500,000).
    expect(within(high).getAllByTestId("rank-row")[0].textContent).toContain("수원시 장안구");
    expect(within(high).getAllByTestId("rank-row")[0].textContent).toContain("500,000");

    fireEvent.click(screen.getByTestId("rank-direction-low"));
    const low = screen.getByTestId("rank-low");
    // Lowest first is the official 0 (옹진군) — a measured 0 is ranked, not excluded.
    expect(within(low).getAllByTestId("rank-row")[0].textContent).toContain("옹진군");
    expect(within(low).getAllByTestId("rank-row")[0].textContent).toContain("0");
    // The two ends are the same ranking seen from opposite directions, so only one
    // list is on screen at a time.
    expect(screen.queryByTestId("rank-high")).toBeNull();
  });

  it("reports how many regions were excluded because the value was unavailable", async () => {
    await renderEquity();
    // 용산구 has no population → excluded, never zero-filled.
    expect(screen.getByTestId("rank-excluded").textContent).toContain("1개");
    expect(screen.getByTestId("rank-excluded").textContent).toContain("0으로 채우지 않음");
  });

  it("selecting a ranked region drives the shared selected-region summary (map sync)", async () => {
    await renderEquity();
    const high = screen.getByTestId("rank-high");
    fireEvent.click(within(high).getAllByTestId("rank-row")[0]);
    expect(screen.getByTestId("selected-region-name").textContent).toBe("수원시 장안구");
    expect(screen.getByTestId("selected-region-value").textContent).toContain("500,000");
  });

  it("filters by scope and re-ranks within it", async () => {
    await renderEquity();
    fireEvent.click(screen.getByTestId("rank-scope-11")); // 서울
    await waitFor(() => {
      const high = screen.getByTestId("rank-high");
      const names = within(high)
        .getAllByTestId("rank-row")
        .map((r) => r.textContent);
      // Only Seoul (11) regions remain; Gyeonggi/Incheon are gone.
      expect(names.join(" ")).toContain("종로구");
      expect(names.join(" ")).not.toContain("수원시 장안구");
      expect(names.join(" ")).not.toContain("옹진군");
    });
  });
});

/**
 * 지표 순위 전체보기 — what replaced the 지역 비교 card (correction pass).
 *
 * The old card let a reader hand-pick up to three regions and put their values side
 * by side. This shows EVERY region for the active metric in one ordered list, from
 * the rows the page already loaded, so the coverage the comparison suite used to give
 * lives on here: an official 0 is ranked, and a region with no served value is stated
 * as missing rather than shown as a 0.
 */
describe("지역 순위 전체보기", () => {
  /** Focus, then click — so the dialog records a real opener to restore focus to. */
  function openFullRanking(): HTMLElement {
    const trigger = screen.getByTestId("open-full-ranking");
    trigger.focus();
    fireEvent.click(trigger);
    return trigger;
  }

  it("opens the complete ranking for the CURRENT metric, with no top-N cut", async () => {
    await renderEquity();
    openFullRanking();

    const dialog = screen.getByTestId("full-ranking-dialog");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // The accessible name is the visible title.
    expect(within(dialog).getByText(RANKING_FULL_VIEW_LABEL)).toBeDefined();
    // …and the basis names the ACTIVE metric, not a fixed string.
    expect(dialog.textContent).toContain("인구");

    // All four regions WITH a value, highest first, ranks 1..4 — nothing truncated.
    const rows = within(dialog).getAllByTestId("full-ranking-row");
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain("수원시 장안구");
    expect(rows[0].textContent).toContain("500,000");
    expect(rows[3].textContent).toContain("옹진군");
    // The official measured 0 IS ranked, last — it is a value, not a gap.
    expect(rows[3].textContent).toContain("0");
  });

  it("states a region with no served value as missing, never as a 0", async () => {
    await renderEquity();
    openFullRanking();
    const dialog = screen.getByTestId("full-ranking-dialog");

    // 용산구 has no population in the fixture.
    const table = within(dialog).getByTestId("full-ranking-table");
    expect(table.textContent).not.toContain("용산구");

    const unranked = within(dialog).getByTestId("full-ranking-unranked");
    expect(unranked.textContent).toContain("용산구");
    expect(unranked.textContent).toContain("1개");
    expect(unranked.textContent).toContain("0으로 채우지 않았습니다");
  });

  it("selecting a region there drives the one canonical selected-region state", async () => {
    await renderEquity();
    openFullRanking();
    const dialog = screen.getByTestId("full-ranking-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /종로구/ }));
    expect(screen.getByTestId("selected-region-name").textContent).toBe("종로구");
    expect(screen.getByTestId("selected-region-value").textContent).toContain("300,000");
  });

  it("closes on Escape and gives focus back to the control that opened it", async () => {
    await renderEquity();
    const trigger = openFullRanking();
    expect(screen.getByTestId("full-ranking-dialog")).toBeDefined();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("full-ranking-dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on its close button", async () => {
    await renderEquity();
    openFullRanking();
    fireEvent.click(screen.getByTestId("full-ranking-dialog-close"));
    await waitFor(() => expect(screen.queryByTestId("full-ranking-dialog")).toBeNull());
  });

  it("follows a metric change rather than showing the previous metric's ranking", async () => {
    await renderEquity();
    openFullRanking();
    expect(screen.getByTestId("full-ranking-dialog").textContent).toContain("500,000");
    fireEvent.click(screen.getByTestId("full-ranking-dialog-close"));
    await waitFor(() => expect(screen.queryByTestId("full-ranking-dialog")).toBeNull());

    // Switch to a waste-generation metric. The fixture serves no waste statistics,
    // so the honest result is an EMPTY ranking with every region listed as missing —
    // never the previous metric's numbers, and never a column of zeros.
    fireEvent.click(screen.getByRole("radio", { name: /생활계 폐기물 발생량/ }));
    await waitFor(() =>
      expect(screen.getByTestId("selected-metric-summary").textContent).toContain(
        "생활계 폐기물 발생량",
      ),
    );

    openFullRanking();
    const dialog = screen.getByTestId("full-ranking-dialog");
    expect(dialog.textContent).toContain("생활계 폐기물 발생량");
    expect(dialog.textContent).not.toContain("500,000");
    expect(within(dialog).queryAllByTestId("full-ranking-row")).toHaveLength(0);
    expect(within(dialog).getByTestId("full-ranking-empty")).toBeDefined();
  });
});

describe("share & export", () => {
  it("copies a versioned share link with accessible feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await renderEquity();
    fireEvent.click(screen.getByTestId("share-copy"));
    await waitFor(() => expect(screen.getByTestId("copy-ok")).toBeDefined());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("v=1");
  });

  it("opens the print/PNG report preview with the ranking title", async () => {
    await renderEquity();
    fireEvent.click(screen.getByTestId("open-report"));
    await waitFor(() => expect(screen.getByTestId("report-preview")).toBeDefined());
    expect(screen.getByRole("dialog").textContent).toContain("지역 부담 순위");
    // The report explicitly states it excludes the interactive map.
    expect(screen.getByRole("dialog").textContent).toContain("지도를 제외한");
  });
});

describe("shared-URL restore", () => {
  it("restores scope and top-N from a validated URL and shows a warning for invalid fields", async () => {
    window.history.replaceState(null, "", "/?v=1&scope=11&top=5&mode=hacker");
    await renderEquity();
    // Scope 서울 restored (aria-pressed), top-N restored to 5.
    await waitFor(() =>
      expect(screen.getByTestId("rank-scope-11").getAttribute("aria-pressed")).toBe("true"),
    );
    expect((screen.getByTestId("rank-topn") as HTMLSelectElement).value).toBe("5");
    // The invalid mode was dropped and surfaced as a plain-Korean warning.
    expect(screen.getByTestId("url-warnings")).toBeDefined();
  });
});
