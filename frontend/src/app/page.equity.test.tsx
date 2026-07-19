// @vitest-environment jsdom

/**
 * 지역 부담 (equity) feature tests: regional ranking, region comparison, and the
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
    const high = screen.getByTestId("rank-high");
    const low = screen.getByTestId("rank-low");
    // Highest value first (수원시 장안구 500,000); lowest first is the official 0 (옹진군).
    expect(within(high).getAllByTestId("rank-row")[0].textContent).toContain("수원시 장안구");
    expect(within(high).getAllByTestId("rank-row")[0].textContent).toContain("500,000");
    expect(within(low).getAllByTestId("rank-row")[0].textContent).toContain("옹진군");
    expect(within(low).getAllByTestId("rank-row")[0].textContent).toContain("0");
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

describe("region comparison", () => {
  it("searches, adds up to three regions, and shows exact values with official 0 distinct", async () => {
    await renderEquity();
    const search = screen.getByTestId("comparison-search");
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "종로" } });
    const options = await screen.findByTestId("comparison-options");
    fireEvent.mouseDown(within(options).getByText(/종로구/));

    fireEvent.change(search, { target: { value: "옹진" } });
    fireEvent.mouseDown(within(await screen.findByTestId("comparison-options")).getByText(/옹진군/));

    const table = screen.getByTestId("comparison-table");
    expect(table.textContent).toContain("종로구");
    expect(table.textContent).toContain("300,000");
    expect(table.textContent).toContain("옹진군");
    expect(table.textContent).toContain("0"); // official zero, not 자료 없음
    expect(table.textContent).not.toContain("자료 없음");
  });

  it("shows 자료 없음 for a region with no served value (never a fabricated 0)", async () => {
    await renderEquity();
    const search = screen.getByTestId("comparison-search");
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "용산" } });
    fireEvent.mouseDown(within(await screen.findByTestId("comparison-options")).getByText(/용산구/));
    expect(screen.getByTestId("comparison-table").textContent).toContain("자료 없음");
  });

  it("removes a compared region via its chip", async () => {
    await renderEquity();
    const search = screen.getByTestId("comparison-search");
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "종로" } });
    fireEvent.mouseDown(within(await screen.findByTestId("comparison-options")).getByText(/종로구/));
    expect(screen.getByTestId("comparison-chips").textContent).toContain("종로구");
    fireEvent.click(screen.getByTestId("comparison-chip-remove"));
    expect(screen.queryByTestId("comparison-table")).toBeNull();
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
