// @vitest-environment jsdom

/**
 * Phase 7 — 매립지 현황 filter URL state (Phase 5 defect L5).
 *
 * The four landfill filters (연도 / 기간 / 출발 지역 / 폐기물 종류) were the last
 * primary controls with no representation in the versioned shareable URL. These
 * tests drive the REAL page: a link is placed on `window.location`, the page is
 * rendered, and the four native `<select>`s are read back.
 *
 * The shared `homeApiMock` rejects all three landfill endpoints with the backend's
 * genuine 404 NO_DATA_AVAILABLE and serves NO available years. That is deliberately
 * the hardest case for restoration: nothing in the response can supply an option,
 * so a restored value that still appears in its select proves the "never blank a
 * native select" rule holds on its own, rather than being propped up by fixture
 * data. No test here asserts that any period, origin, or category actually exists
 * in the dataset — availability is the backend's answer, not the URL's.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub() {
      return <div data-testid="map-container" />;
    },
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const { homeApiMock } = await import("./homeApiMock");
  return homeApiMock(actual);
});

import Home from "./page";
import * as api from "../lib/api";

function setUrl(query: string) {
  window.history.replaceState(null, "", `/${query}`);
}

/** Render and wait for the landfill filter row to exist. */
async function renderLandfill(query: string) {
  setUrl(query);
  render(<Home />);
  await waitFor(() => expect(screen.getByTestId("landfill-year-select")).toBeDefined());
}

const sel = (id: string) => screen.getByTestId(id) as HTMLSelectElement;

afterEach(() => {
  cleanup();
  setUrl("");
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("landfill filters restore from a shared link", () => {
  it("restores all four filters and lands on the landfill area", async () => {
    await renderLandfill("?v=1&mode=flow&year=2023&month=7&origin=41&waste=생활폐기물");
    expect(sel("landfill-year-select").value).toBe("2023");
    expect(sel("landfill-month-select").value).toBe("7");
    expect(sel("landfill-origin-select").value).toBe("41");
    expect(sel("landfill-waste-select").value).toBe("생활폐기물");
  });

  it("leaves no restored control blank even though the backend served no options", async () => {
    await renderLandfill("?v=1&mode=flow&year=2023&month=7&origin=11&waste=건설폐기물");
    // A native <select> whose value matches no <option> renders BLANK. Every one of
    // these therefore proves its own option was synthesised from the selection.
    for (const id of [
      "landfill-year-select",
      "landfill-month-select",
      "landfill-origin-select",
      "landfill-waste-select",
    ]) {
      const select = sel(id);
      expect(select.value, `${id} is blank`).not.toBe("");
      expect(
        [...select.options].some((o) => o.value === select.value),
        `${id} has no matching option`,
      ).toBe(true);
    }
  });

  it("falls back to the product default for each invalid value, never a blank control", async () => {
    await renderLandfill("?v=1&mode=flow&year=99&month=13&origin=99&waste=");
    // All four were rejected by the decoder, so all four sit at their default —
    // which is the empty-string option (최신 완결연도 / 연간 / 전체 / 전체), a real
    // selectable option rather than an unmatched value.
    for (const id of [
      "landfill-year-select",
      "landfill-month-select",
      "landfill-origin-select",
      "landfill-waste-select",
    ]) {
      const select = sel(id);
      expect(select.value).toBe("");
      expect([...select.options].some((o) => o.value === "")).toBe(true);
    }
    // The link is CANONICALISED: the mirror re-encodes the state that actually
    // survived, so the rejected parameters are removed from the address bar rather
    // than lingering as a claim the app never honoured.
    await waitFor(() => expect(window.location.search).toContain("mode=flow"));
    expect(window.location.search).not.toContain("year=");
    expect(window.location.search).not.toContain("month=");
    expect(window.location.search).not.toContain("origin=");
    expect(window.location.search).not.toContain("waste=");
  });

  it("offers no year the dataset did not serve", async () => {
    // The fixture serves NO available_years, so the 연도 control offers only its
    // 최신 완결연도 default. A URL cannot conjure a selectable year into the list —
    // a restored year appears because it is the current SELECTION (previous test),
    // never as a new option a reader could pick for a period that does not exist.
    await renderLandfill("?v=1&mode=flow");
    const years = [...sel("landfill-year-select").options].map((o) => o.value);
    expect(years).toEqual([""]);
  });

  it("restores a partial link and leaves the unspecified filters at their defaults", async () => {
    await renderLandfill("?v=1&mode=flow&origin=28");
    expect(sel("landfill-origin-select").value).toBe("28");
    expect(sel("landfill-year-select").value).toBe("");
    expect(sel("landfill-month-select").value).toBe("");
    expect(sel("landfill-waste-select").value).toBe("");
  });

  it("still restores a Phase 5-era landfill link that carries no filters", async () => {
    await renderLandfill("?v=1&mode=flow");
    expect(screen.getByTestId("landfill-year-select")).toBeDefined();
    expect(sel("landfill-year-select").value).toBe("");
    expect(screen.queryByTestId("url-warnings")).toBeNull();
  });
});

describe("landfill filters reach the request and the URL", () => {
  it("requests the RESTORED filters, not the defaults, and does so once", async () => {
    await renderLandfill("?v=1&mode=flow&year=2023&month=7&origin=41");
    const summary = vi.mocked(api.fetchLandfillSummary);
    await waitFor(() => expect(summary).toHaveBeenCalled());
    // Exactly one summary request: `mode` and the filters are restored in the same
    // batch, so the effect never runs once for the default state and again for the
    // restored one.
    expect(summary).toHaveBeenCalledTimes(1);
    expect(summary).toHaveBeenCalledWith(
      expect.objectContaining({ year: 2023, month: 7, origin: "41" }),
    );
  });

  it("writes a filter change into the URL through replaceState, never pushState", async () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const pushSpy = vi.spyOn(window.history, "pushState");
    await renderLandfill("?v=1&mode=flow");
    replaceSpy.mockClear();

    fireEvent.change(sel("landfill-origin-select"), { target: { value: "11" } });

    await waitFor(() => expect(window.location.search).toContain("origin=11"));
    expect(replaceSpy).toHaveBeenCalled();
    // No history entry is created, so the browser Back button still leaves the app
    // rather than walking back through every filter the reader tried.
    expect(pushSpy).not.toHaveBeenCalled();
    replaceSpy.mockRestore();
    pushSpy.mockRestore();
  });

  it("keeps the encoded link round-tripping back to the same visible filters", async () => {
    // 출발 지역 and 기간 are driven by fixed option lists, so they are changeable
    // even against this deliberately empty fixture; 연도 is intentionally NOT —
    // its options come only from what the backend served (see the test above).
    await renderLandfill("?v=1&mode=flow");
    fireEvent.change(sel("landfill-origin-select"), { target: { value: "28" } });
    fireEvent.change(sel("landfill-month-select"), { target: { value: "9" } });
    await waitFor(() => expect(window.location.search).toContain("month=9"));
    const shared = window.location.search;
    expect(shared).toContain("origin=28");

    cleanup();
    await renderLandfill(shared);
    expect(sel("landfill-origin-select").value).toBe("28");
    expect(sel("landfill-month-select").value).toBe("9");
  });

  it("drops the landfill parameters when the reader leaves the area", async () => {
    await renderLandfill("?v=1&mode=flow&year=2023&origin=41");
    await waitFor(() => expect(window.location.search).toContain("year=2023"));
    fireEvent.click(screen.getByTestId("mode-equity"));
    await waitFor(() => expect(window.location.search).toContain("mode=equity"));
    // Same rule the suitability-only fields follow: a field is written only in the
    // area where it means anything.
    expect(window.location.search).not.toContain("year=");
    expect(window.location.search).not.toContain("origin=");
  });

  it("does not disturb the existing equity URL state", async () => {
    await renderLandfill("?v=1&mode=flow&year=2023&scope=11&top=5");
    fireEvent.click(screen.getByTestId("mode-equity"));
    await waitFor(() => expect(window.location.search).toContain("mode=equity"));
    expect(window.location.search).toContain("scope=11");
    expect(window.location.search).toContain("top=5");
  });
});
