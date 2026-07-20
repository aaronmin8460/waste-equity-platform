// @vitest-environment jsdom

/**
 * Shared application chrome (Phase 1 — global navigation foundation).
 *
 * The Phase 0 audit found the mode switch rendered in two structurally different
 * places (inside the 384px equity sidebar for the map modes, as a full-width row
 * above the three map-free dashboards), and the sub-view switch duplicated between
 * the sidebar and the cost page. These tests pin the post-refactor contract:
 *
 *   - exactly ONE top navigation, in every mode;
 *   - exactly ONE 후보지 분석 segmented control, only inside 후보지 분석, in the same
 *     place for the score, scenario, and cost sub-views;
 *   - exactly ONE `id="main-content"` skip-link target and one `<h1>` per view;
 *   - the visible "무엇을 볼까요?" label is gone while its accessible-name job is not;
 *   - which branches mount a MapView is unchanged (nothing is hidden with CSS);
 *   - mode and sub-view still restore from the URL.
 *
 * MapView is stubbed and the API is mocked, exactly as the other shell tests do.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

async function renderLoaded() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  return utils;
}

/** Enter 후보지 분석 and wait for its score panel. */
async function enterSuitability() {
  fireEvent.click(screen.getByTestId("mode-suitability"));
  await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
}

const MODE_TEST_IDS = ["mode-equity", "mode-suitability", "mode-flow", "mode-transparency"];

describe("one global navigation per view", () => {
  it("renders exactly one top navigation in every mode", async () => {
    const { container } = await renderLoaded();

    async function expectSingleNav(label: string) {
      // `getByTestId` would already throw on a duplicate; assert counts explicitly
      // so the failure message names the defect.
      expect(container.querySelectorAll('[data-testid="mode-switch"]')).toHaveLength(1);
      expect(container.querySelectorAll('[data-testid="top-navigation"]')).toHaveLength(1);
      for (const testId of MODE_TEST_IDS) {
        expect(
          container.querySelectorAll(`[data-testid="${testId}"]`),
          `${label}: ${testId}`,
        ).toHaveLength(1);
      }
    }

    await expectSingleNav("지역 부담");

    await enterSuitability();
    await expectSingleNav("후보지 점수");

    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());
    await expectSingleNav("비용 살펴보기");

    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());
    await expectSingleNav("매립지 현황");

    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("mode-transparency").getAttribute("aria-pressed")).toBe("true"));
    await expectSingleNav("데이터·출처");
  });

  it("keeps the navigation outside the equity sidebar, in shared chrome", async () => {
    const { container } = await renderLoaded();
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    // The sidebar-embedded nav (which wrapped onto two lines at 384px) is gone.
    expect(aside?.querySelector('[data-testid="mode-switch"]')).toBeNull();
    // It lives in the shell's header instead, above <main>.
    const nav = screen.getByTestId("top-navigation");
    expect(nav.tagName).toBe("HEADER");
    expect(nav.contains(screen.getByTestId("mode-switch"))).toBe(true);
    expect(nav.closest("main")).toBeNull();
  });
});

describe('the visible "무엇을 볼까요?" label is gone', () => {
  it("no longer renders that text anywhere, in any mode", async () => {
    await renderLoaded();
    expect(screen.queryByText("무엇을 볼까요?")).toBeNull();
    expect(document.body.textContent).not.toContain("무엇을 볼까요");

    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());
    expect(document.body.textContent).not.toContain("무엇을 볼까요");
  });

  it("keeps the group's accessible name in the a11y tree, visually hidden", async () => {
    await renderLoaded();
    const group = screen.getByTestId("mode-switch");
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-labelledby")).toBe("mode-switch-label");

    const label = document.getElementById("mode-switch-label");
    expect(label).not.toBeNull();
    expect(label?.textContent?.trim()).not.toBe("");
    expect(label?.className).toContain("sr-only");
    // It must not become a heading — the nav renders above every view's own <h1>.
    expect(label?.tagName).not.toMatch(/^H[1-6]$/);
  });
});

describe("후보지 분석 segmented control", () => {
  it("appears only inside 후보지 분석", async () => {
    const { container } = await renderLoaded();
    const subviews = () => container.querySelectorAll('[data-testid="suitability-subviews"]');

    // 지역 부담: absent.
    expect(subviews()).toHaveLength(0);

    await enterSuitability();
    expect(subviews()).toHaveLength(1);

    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());
    expect(subviews()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() =>
      expect(screen.getByTestId("mode-transparency").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(subviews()).toHaveLength(0);
  });

  it("renders exactly one control, in the same place, across score / scenario / cost", async () => {
    const { container } = await renderLoaded();
    await enterSuitability();

    /** The chrome position of the segmented control, as a DOM path signature. */
    function chromeSignature() {
      const groups = container.querySelectorAll('[data-testid="suitability-subviews"]');
      expect(groups).toHaveLength(1);
      const group = groups[0];
      // Every sub-view button exists exactly once…
      for (const testId of [
        "suitability-view-score",
        "suitability-view-scenario",
        "suitability-view-cost",
      ]) {
        expect(container.querySelectorAll(`[data-testid="${testId}"]`), testId).toHaveLength(1);
        // …and inside this one control, never duplicated into a sidebar copy.
        expect(within(group as HTMLElement).getByTestId(testId)).toBeDefined();
      }
      const shell = container.querySelector('[data-testid="app-shell"]');
      const main = container.querySelector("main");
      return {
        // It is shared chrome: a direct child of the shell, above <main> — not
        // inside the sidebar for two sub-views and above a full-width page for the
        // third (the Phase 0 "two unrelated rows" defect).
        parentIsShell: group.parentElement === shell,
        insideMain: main?.contains(group) ?? false,
        indexInShell: Array.from(shell?.children ?? []).indexOf(group),
      };
    }

    const atScore = chromeSignature();
    expect(atScore.parentIsShell).toBe(true);
    expect(atScore.insideMain).toBe(false);

    fireEvent.click(screen.getByTestId("suitability-view-scenario"));
    await waitFor(() => expect(screen.getByTestId("scenario-lab")).toBeDefined());
    expect(chromeSignature()).toEqual(atScore);

    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());
    expect(chromeSignature()).toEqual(atScore);
  });

  it("marks the active sub-view with aria-pressed", async () => {
    await renderLoaded();
    await enterSuitability();
    expect(screen.getByTestId("suitability-view-score").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());
    expect(screen.getByTestId("suitability-view-cost").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("suitability-view-score").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("map mounting is unchanged by the shared chrome", () => {
  it("mounts exactly one map in 지역 부담, 후보지 점수, and 가중치 바꿔보기", async () => {
    await renderLoaded();
    expect(screen.getAllByTestId("map-container")).toHaveLength(1);

    await enterSuitability();
    expect(screen.getAllByTestId("map-container")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("suitability-view-scenario"));
    await waitFor(() => expect(screen.getByTestId("scenario-lab")).toBeDefined());
    expect(screen.getAllByTestId("map-container")).toHaveLength(1);
  });

  it("does not remount the map when navigating equity ↔ suitability", async () => {
    await renderLoaded();
    // Identity, not mere presence: the shared chrome inserts the sub-view bar as a
    // conditional SIBLING before <main>, so React keeps <main> in the same child
    // slot and the map subtree is reconciled rather than torn down and rebuilt. A
    // remount would drop MapLibre state (viewport, sources, ResizeObserver).
    const initial = screen.getByTestId("map-container");

    await enterSuitability();
    expect(screen.getByTestId("map-container")).toBe(initial);

    fireEvent.click(screen.getByTestId("suitability-view-scenario"));
    await waitFor(() => expect(screen.getByTestId("scenario-lab")).toBeDefined());
    expect(screen.getByTestId("map-container")).toBe(initial);

    fireEvent.click(screen.getByTestId("mode-equity"));
    await waitFor(() =>
      expect(screen.getByTestId("mode-equity").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByTestId("map-container")).toBe(initial);
  });

  it("mounts no map in 비용 살펴보기, 매립지 현황, or 데이터·출처", async () => {
    await renderLoaded();
    await enterSuitability();

    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());
    // Gone, not merely hidden with CSS.
    expect(screen.queryByTestId("map-container")).toBeNull();

    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());
    expect(screen.queryByTestId("map-container")).toBeNull();

    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() =>
      expect(screen.getByTestId("mode-transparency").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.queryByTestId("map-container")).toBeNull();
  });
});

describe("one main-content target and one h1 per view", () => {
  it("holds in every mode, including the two that previously had no skip target", async () => {
    const { container } = await renderLoaded();

    async function expectSingleLandmarks(label: string) {
      const targets = container.querySelectorAll("#main-content");
      expect(targets, `${label}: #main-content`).toHaveLength(1);
      expect(targets[0].getAttribute("tabindex")).toBe("-1");
      expect(container.querySelectorAll("main"), `${label}: <main>`).toHaveLength(1);
      expect(container.querySelectorAll("h1"), `${label}: <h1>`).toHaveLength(1);
      // The navigation itself contributes no heading.
      expect(screen.getByTestId("top-navigation").querySelectorAll("h1")).toHaveLength(0);
    }

    await expectSingleLandmarks("지역 부담");

    await enterSuitability();
    await expectSingleLandmarks("후보지 점수");

    // 비용 살펴보기 and 데이터·출처 had NO id="main-content" before Phase 1 — the skip
    // link had nothing to move focus to. The shared shell fixes both.
    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());
    await expectSingleLandmarks("비용 살펴보기");

    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());
    await expectSingleLandmarks("매립지 현황");

    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() =>
      expect(screen.getByTestId("mode-transparency").getAttribute("aria-pressed")).toBe("true"),
    );
    await expectSingleLandmarks("데이터·출처");
  });
});

describe("mode orientation stays supporting text, not a second nav row", () => {
  it("renders inside the view's content area, below the shared chrome", async () => {
    const { container } = await renderLoaded();
    const orientation = screen.getByTestId("mode-orientation");
    // Plain-language text preserved (the citizen-language guarantee).
    expect(orientation.textContent).toContain("지역별 폐기물 발생량");
    // Inside <main>, not in the nav chrome.
    expect(container.querySelector("main")?.contains(orientation)).toBe(true);
    expect(screen.getByTestId("top-navigation").contains(orientation)).toBe(false);
    // Muted supporting text, not a filled strip that reads as a nav row.
    expect(orientation.className).toContain("wep-orient");
    expect(orientation.className).not.toContain("bg-slate-50");
  });

  it("follows the view's h1 in every area that shows it", async () => {
    const { container } = await renderLoaded();

    /** True when the orientation appears after the <h1> in document order. */
    function orientationFollowsHeading(label: string) {
      const h1 = container.querySelector("h1");
      const orientation = screen.getByTestId("mode-orientation");
      expect(h1, `${label}: h1`).not.toBeNull();
      // Node.DOCUMENT_POSITION_FOLLOWING === 4
      const position = h1!.compareDocumentPosition(orientation);
      expect(
        Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING),
        `${label}: orientation must follow the h1 it supports, not precede it`,
      ).toBe(true);
    }

    orientationFollowsHeading("지역 부담");

    await enterSuitability();
    orientationFollowsHeading("후보지 점수");

    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());
    orientationFollowsHeading("매립지 현황");

    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() =>
      expect(screen.getByTestId("mode-transparency").getAttribute("aria-pressed")).toBe("true"),
    );
    orientationFollowsHeading("데이터·출처");
  });
});

describe("URL restore still drives the shared chrome", () => {
  it("restores the mode from the URL", async () => {
    window.history.replaceState(null, "", "/?v=1&mode=flow");
    await renderLoaded();
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());
    expect(screen.getByTestId("mode-flow").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("mode-equity").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("map-container")).toBeNull();
  });

  it("restores the suitability sub-view from the URL", async () => {
    window.history.replaceState(null, "", "/?v=1&mode=suitability&view=cost");
    await renderLoaded();
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());
    expect(screen.getByTestId("mode-suitability").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("suitability-view-cost").getAttribute("aria-pressed")).toBe("true");
    // The segmented control is present for the restored sub-view too.
    expect(screen.getByTestId("suitability-subviews")).toBeDefined();
  });
});
