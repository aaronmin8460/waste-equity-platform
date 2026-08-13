// @vitest-environment jsdom

/**
 * 후보지 심층 분석 — the three-column collapsible workspace (Phase 3).
 *
 * What these pin:
 *   - left panel + central map + right panel, each collapsible independently;
 *   - collapsing NEVER remounts or unmounts the map (identity, not presence);
 *   - the four real scored factors are Z/R/E/D and nothing else is presented as
 *     a scored component;
 *   - official status stays separate from the A/B/C relative band;
 *   - the band is disabled honestly when the population cannot be established.
 *
 * MapView is stubbed and the API mocked, exactly as the other page tests do.
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

// The grade distribution is a network read; each test decides what it answers.
const computeGradeDistribution = vi.fn();
vi.mock("../lib/relativeGrade", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/relativeGrade")>();
  return { ...actual, computeGradeDistribution: (...args: unknown[]) => computeGradeDistribution(...args) };
});

import { COMPONENT_META, COMPONENT_ORDER } from "../lib/glossary";
import Home from "./page";

const DISTRIBUTION = {
  runId: 48,
  profile: "baseline" as const,
  scope: { kind: "all" as const },
  population: 17501,
  p25: 47.6779,
  p75: 57.811,
  countA: 4914,
  countB: 8403,
  countC: 4184,
};

beforeEach(() => {
  vi.clearAllMocks();
  computeGradeDistribution.mockResolvedValue(DISTRIBUTION);
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

/** Open 후보지 심층 분석 and wait for its results panel. */
async function enterDeepAnalysis() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  fireEvent.click(screen.getByTestId("mode-suitability"));
  await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
  return utils;
}

const left = () => screen.getByTestId("deep-left-panel");
const right = () => screen.getByTestId("deep-right-panel");

describe("the three-column workspace", () => {
  it("renders a left panel, one map, and a right panel — in that order", async () => {
    const { container } = await enterDeepAnalysis();
    expect(left()).toBeDefined();
    expect(right()).toBeDefined();
    expect(screen.getAllByTestId("map-container")).toHaveLength(1);

    // Document order is left → map → right, which is also the reading order for
    // a screen reader walking the landmarks.
    const nodes = Array.from(
      container.querySelectorAll(
        '[data-testid="deep-left-panel"], [data-testid="map-container"], [data-testid="deep-right-panel"]',
      ),
    ).map((n) => n.getAttribute("data-testid"));
    expect(nodes).toEqual(["deep-left-panel", "map-container", "deep-right-panel"]);
  });

  it("puts the analysis CONTROLS on the left and the RESULTS on the right", async () => {
    await enterDeepAnalysis();
    // Left: what you ask.
    expect(within(left()).getByTestId("suitability-active-basis")).toBeDefined();
    expect(within(left()).getByTestId("suitability-screening-disclaimer")).toBeDefined();
    // Right: what you get.
    expect(within(right()).getByTestId("candidate-rank-framing")).toBeDefined();
    // …and neither column duplicates the other's content.
    expect(within(left()).queryByTestId("candidate-rank-framing")).toBeNull();
    expect(within(right()).queryByTestId("suitability-active-basis")).toBeNull();
  });

  it("keeps exactly one h1 and one main across the whole workspace", async () => {
    const { container } = await enterDeepAnalysis();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")!.textContent).toBe("후보지 심층 분석");
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });
});

describe("collapsing a panel", () => {
  it("collapses and reopens each column independently", async () => {
    await enterDeepAnalysis();
    expect(left().getAttribute("data-collapsed")).toBe("false");
    expect(right().getAttribute("data-collapsed")).toBe("false");

    fireEvent.click(screen.getByTestId("deep-left-panel-toggle"));
    expect(left().getAttribute("data-collapsed")).toBe("true");
    // Independent: closing one must not close the other.
    expect(right().getAttribute("data-collapsed")).toBe("false");

    fireEvent.click(screen.getByTestId("deep-right-panel-toggle"));
    expect(right().getAttribute("data-collapsed")).toBe("true");

    fireEvent.click(screen.getByTestId("deep-left-panel-toggle"));
    expect(left().getAttribute("data-collapsed")).toBe("false");
    expect(right().getAttribute("data-collapsed")).toBe("true");
  });

  it("exposes the state through aria-expanded and keeps a reopen control", async () => {
    await enterDeepAnalysis();
    const toggle = screen.getByTestId("deep-left-panel-toggle");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe("deep-analysis-left");

    fireEvent.click(toggle);
    // Still present and still named, so a keyboard user can always reopen it.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toContain("열기");
  });

  it("NEVER remounts or unmounts the map while collapsing", async () => {
    await enterDeepAnalysis();
    // Identity, not presence: a remount would replace the node and drop the
    // MapLibre viewport, sources, and ResizeObserver.
    const mapNode = screen.getByTestId("map-container");

    fireEvent.click(screen.getByTestId("deep-left-panel-toggle"));
    expect(screen.getByTestId("map-container")).toBe(mapNode);
    fireEvent.click(screen.getByTestId("deep-right-panel-toggle"));
    expect(screen.getByTestId("map-container")).toBe(mapNode);
    fireEvent.click(screen.getByTestId("deep-left-panel-toggle"));
    fireEvent.click(screen.getByTestId("deep-right-panel-toggle"));
    expect(screen.getByTestId("map-container")).toBe(mapNode);
    expect(screen.getAllByTestId("map-container")).toHaveLength(1);
  });

  it("keeps a collapsed panel's children MOUNTED so reopening restores them", async () => {
    await enterDeepAnalysis();
    const listNode = within(right()).getByTestId("candidate-rank-framing");
    fireEvent.click(screen.getByTestId("deep-right-panel-toggle"));
    // Hidden by CSS (which jsdom does not apply), but the SAME node — not torn
    // down and rebuilt, so no state inside it is lost.
    expect(within(right()).getByTestId("candidate-rank-framing")).toBe(listNode);
  });
});

describe("the real scored factors", () => {
  it("names Z / R / E / D with the repository's own terminology", async () => {
    await enterDeepAnalysis();
    const text = left().textContent ?? "";
    for (const component of COMPONENT_ORDER) {
      expect(text, component).toContain(COMPONENT_META[component].primary);
    }
    expect(text).toContain("용도지역 호환성");
    expect(text).toContain("도로 근접성 대리지표");
    expect(text).toContain("기존 지역 부담");
    expect(text).toContain("폐기물 처리 수요");
  });

  it("presents NO invented scored factor", async () => {
    await enterDeepAnalysis();
    const workspace = `${left().textContent ?? ""} ${right().textContent ?? ""}`;
    // Neither of these is a scored component in this backend, so presenting one
    // would be a fabricated analytical claim (spec §6.1).
    expect(workspace).not.toContain("주민 반응");
    expect(workspace).not.toContain("토지피복 기반 적합도");
    // The misleading earlier names must not come back either.
    expect(workspace).not.toContain("토지이용 적합성");
    expect(workspace).not.toContain("도로 접근성");
  });

  it("keeps land cover and wetland out of the scored-factor vocabulary", async () => {
    await enterDeepAnalysis();
    // They may exist as contextual map layers, but the scoring basis panel must
    // not list them among the things that produce the composite score.
    const basis = within(left()).getByTestId("suitability-active-basis").textContent ?? "";
    expect(basis).not.toContain("토지피복");
    expect(basis).not.toContain("습지");
  });
});

describe("official status stays separate from the relative band", () => {
  it("shows the three official statuses by their own names", async () => {
    await enterDeepAnalysis();
    const text = `${left().textContent ?? ""} ${right().textContent ?? ""}`;
    expect(text).toContain("스크리닝 통과");
    expect(text).toContain("추가 검토 필요");
    expect(text).toContain("프로젝트 스크리닝 제외");
  });

  it("labels the bands as a relative range and denies the status reading", async () => {
    await enterDeepAnalysis();
    await waitFor(() => expect(screen.getByTestId("relative-grade-panel")).toBeDefined());
    const panel = screen.getByTestId("relative-grade-panel");
    expect(panel.textContent).toContain("상대 점수 구간");
    // The disclaimer is visible, not behind a disclosure — it is a critical
    // analytical limitation (spec §9).
    const explanation = within(panel).getByTestId("relative-grade-explanation");
    expect(explanation.closest("details")).toBeNull();
    expect(explanation.textContent).toContain("법적 적합·부적합 판정이 아닙니다");
  });

  it("states the COMPLETE population the bands came from", async () => {
    await enterDeepAnalysis();
    await waitFor(() => expect(screen.getByTestId("relative-grade-basis")).toBeDefined());
    const basis = screen.getByTestId("relative-grade-basis").textContent ?? "";
    // 17,501 — the whole eligible set, not what happens to be on screen.
    expect(basis).toContain("17,501");
    expect(basis).toContain("전체");
  });

  it("prints each band's real count and range, not an assumed quarter", async () => {
    await enterDeepAnalysis();
    await waitFor(() => expect(screen.getByTestId("relative-grade-bands")).toBeDefined());
    const bands = screen.getByTestId("relative-grade-bands").textContent ?? "";
    expect(bands).toContain("4,914");
    expect(bands).toContain("8,403");
    expect(bands).toContain("4,184");
    expect(screen.getByTestId("relative-grade-range-A").textContent).toContain("57.811");
    expect(screen.getByTestId("relative-grade-range-C").textContent).toContain("47.6779");
  });

  it("reads the thresholds for the run and profile actually on the map", async () => {
    await enterDeepAnalysis();
    await waitFor(() => expect(computeGradeDistribution).toHaveBeenCalled());
    const [runId, profile] = computeGradeDistribution.mock.calls[0];
    expect(typeof runId).toBe("number");
    expect(profile).toBe("baseline");
  });
});

describe("when the population cannot be established", () => {
  it("disables the bands and says so, instead of approximating", async () => {
    computeGradeDistribution.mockResolvedValue(null);
    await enterDeepAnalysis();
    await waitFor(() => expect(screen.getByTestId("relative-grade-unavailable")).toBeDefined());
    // No bands, no thresholds, no chips — the honest empty state.
    expect(screen.queryByTestId("relative-grade-bands")).toBeNull();
    expect(screen.queryByTestId("relative-grade-chip")).toBeNull();
    expect(screen.getByTestId("relative-grade-unavailable").textContent).toContain(
      "추정값을 대신 표시하지 않습니다",
    );
  });

  it("shows nothing at all while the population is still being read", async () => {
    // A pending read must not render a placeholder band: an unresolved
    // distribution is not the same claim as "no distribution".
    computeGradeDistribution.mockReturnValue(new Promise(() => {}));
    await enterDeepAnalysis();
    expect(screen.queryByTestId("relative-grade-panel")).toBeNull();
    expect(screen.queryByTestId("relative-grade-unavailable")).toBeNull();
  });

  it("survives a rejected read without breaking the workspace", async () => {
    computeGradeDistribution.mockRejectedValue(new Error("network"));
    await enterDeepAnalysis();
    await waitFor(() => expect(screen.getByTestId("relative-grade-unavailable")).toBeDefined());
    // The rest of the analysis is unaffected.
    expect(screen.getByTestId("map-container")).toBeDefined();
    expect(within(right()).getByTestId("candidate-rank-framing")).toBeDefined();
  });
});

describe("other destinations are untouched", () => {
  it("keeps the resizable single column on 지역 지표", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
    expect(screen.getByTestId("equity-sidebar")).toBeDefined();
    expect(screen.queryByTestId("deep-left-panel")).toBeNull();
    expect(screen.queryByTestId("deep-right-panel")).toBeNull();
  });

  it("does not read the band thresholds outside 후보지 심층 분석", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
    // 지역 지표 shows no bands, so it must not pay for the four reads.
    expect(computeGradeDistribution).not.toHaveBeenCalled();
  });
});
