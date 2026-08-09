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

/**
 * The six visible destinations, in nav order. These are the PRE-EXISTING testids
 * (see lib/glossary.ts): `mode-suitability` is 후보지 심층 분석 and
 * `suitability-view-cost` / `-scenario` are 후보지 분석 / 후보지 심층 비교.
 */
const DESTINATION_TEST_IDS = [
  "mode-equity",
  "mode-flow",
  "suitability-view-cost",
  "mode-suitability",
  "suitability-view-scenario",
  "mode-transparency",
];
const MODE_TEST_IDS = DESTINATION_TEST_IDS;

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

describe("the six destinations replace the sub-view segmented control", () => {
  it("renders no sub-view bar in any area", async () => {
    const { container } = await renderLoaded();
    const subviews = () => container.querySelectorAll('[data-testid="suitability-subviews"]');

    // The 여기다 redesign promoted the three suitability sub-views to top-level
    // destinations. The old segmented control would now be a SECOND control writing
    // the same `view` state (docs/YEOGIDA_UI_REDESIGN_SPEC.md §2.1), so it is gone —
    // in every area, including the three suitability ones.
    expect(subviews()).toHaveLength(0);

    await enterSuitability();
    expect(subviews()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());
    expect(subviews()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());
    expect(subviews()).toHaveLength(0);
  });

  it("keeps all six destinations in the one nav group, in every area", async () => {
    const { container } = await renderLoaded();

    function expectSixInOneGroup(label: string) {
      const groups = container.querySelectorAll('[data-testid="mode-switch"]');
      expect(groups, `${label}: nav group`).toHaveLength(1);
      const group = groups[0] as HTMLElement;
      expect(group.querySelectorAll("button"), `${label}: destinations`).toHaveLength(6);
      for (const testId of DESTINATION_TEST_IDS) {
        // Exactly once in the document…
        expect(container.querySelectorAll(`[data-testid="${testId}"]`), `${label}: ${testId}`)
          .toHaveLength(1);
        // …and inside the one nav group, never duplicated into a sidebar copy.
        expect(within(group).getByTestId(testId)).toBeDefined();
      }
      // It is shared chrome, above <main> — not inside any view's content.
      expect(container.querySelector("main")?.contains(group) ?? false).toBe(false);
    }

    expectSixInOneGroup("지역 지표");

    await enterSuitability();
    expectSixInOneGroup("후보지 심층 분석");

    fireEvent.click(screen.getByTestId("suitability-view-scenario"));
    await waitFor(() => expect(screen.getByTestId("scenario-lab")).toBeDefined());
    expectSixInOneGroup("후보지 심층 비교");

    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());
    expectSixInOneGroup("후보지 분석");
  });

  it("marks exactly one destination pressed, and the three suitability ones apart", async () => {
    await renderLoaded();

    /** The testid of the single pressed destination. */
    function pressed() {
      const on = DESTINATION_TEST_IDS.filter(
        (id) => screen.getByTestId(id).getAttribute("aria-pressed") === "true",
      );
      expect(on).toHaveLength(1);
      return on[0];
    }

    expect(pressed()).toBe("mode-equity");

    await enterSuitability();
    // The three suitability destinations share `mode`, so only a per-DESTINATION
    // comparison keeps them apart — a mode-only one would press all three.
    expect(pressed()).toBe("mode-suitability");

    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());
    expect(pressed()).toBe("suitability-view-cost");

    fireEvent.click(screen.getByTestId("suitability-view-scenario"));
    await waitFor(() => expect(screen.getByTestId("scenario-lab")).toBeDefined());
    expect(pressed()).toBe("suitability-view-scenario");
  });

  it("navigates straight between suitability sub-views without passing through score", async () => {
    // The old flow needed two clicks (enter 후보지 분석, then pick a sub-view). The
    // six destinations address `(mode, view)` in ONE click, from anywhere.
    await renderLoaded();

    fireEvent.click(screen.getByTestId("suitability-view-scenario"));
    await waitFor(() => expect(screen.getByTestId("scenario-lab")).toBeDefined());

    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());

    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());
    expect(screen.queryByTestId("scenario-lab")).toBeNull();
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

  it("restores the suitability sub-view from the URL as its own destination", async () => {
    // `v=1` compatibility is unchanged: the same link resolves to the same screen,
    // it is simply named 후보지 분석 in the navigation now.
    window.history.replaceState(null, "", "/?v=1&mode=suitability&view=cost");
    await renderLoaded();
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());
    expect(screen.getByTestId("suitability-view-cost").getAttribute("aria-pressed")).toBe("true");
    // 후보지 심층 분석 shares the mode but is a DIFFERENT destination, so it is not pressed.
    expect(screen.getByTestId("mode-suitability").getAttribute("aria-pressed")).toBe("false");
    // No sub-view bar is reintroduced for a restored link.
    expect(screen.queryByTestId("suitability-subviews")).toBeNull();
  });

  it("restores a bare mode=suitability link to 후보지 심층 분석", async () => {
    // The decoder's `view` default is "score", so an older link with no `view`
    // lands where it always did.
    window.history.replaceState(null, "", "/?v=1&mode=suitability");
    await renderLoaded();
    await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
    expect(screen.getByTestId("mode-suitability").getAttribute("aria-pressed")).toBe("true");
  });
});
