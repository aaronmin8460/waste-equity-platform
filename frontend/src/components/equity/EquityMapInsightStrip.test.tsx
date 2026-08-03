// @vitest-environment jsdom

/**
 * 지역 부담 map insight — collapsed-by-default disclosure.
 *
 * The card used to be permanently expanded over the map. It is now a native
 * `<details>`; these tests hold the two halves of that change together:
 *
 *   1. the COMPACT half — one summary, the exact frozen label, closed on first
 *      paint, and the whole panel gated behind it;
 *   2. the PRESERVED half — opening reveals the same three groups, the same served
 *      reference period and source lines, and the same 출처 자세히 보기 action, with
 *      no second copy of any of it anywhere in the tree.
 *
 * jsdom applies no UA style to `<details>`, so "hidden" is asserted the way the
 * platform actually enforces it — the `open` state plus the content's containment
 * inside the disclosure. Real rendered visibility is asserted in Chromium by
 * `e2e/equityDashboard.spec.ts`.
 *
 * Pure presentation: the component computes nothing, so every string below is
 * either passed in by this test or a standing limitation the app already documents.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import EquityMapInsightStrip from "./EquityMapInsightStrip";
import { MAP_INSIGHT_SUMMARY_LABEL } from "../../lib/glossary";

afterEach(cleanup);

/** Served-looking props — the exact shape `page.tsx` passes. */
const PROVENANCE = [
  { label: "지표 출처", value: "행정안전부 주민등록 인구통계 · 기준 2024-12" },
  { label: "경계 출처", value: "통계청 SGIS 행정경계 2024" },
];

function renderStrip(overrides: Partial<Parameters<typeof EquityMapInsightStrip>[0]> = {}) {
  const onOpenSources = vi.fn();
  const result = render(
    <EquityMapInsightStrip
      metricLabel="인구"
      unit="persons"
      metricStatus="reported"
      referencePeriod="2024-12"
      metricProvenance={PROVENANCE}
      onOpenSources={onOpenSources}
      {...overrides}
    />,
  );
  return { ...result, onOpenSources };
}

function disclosure(): HTMLDetailsElement {
  return screen.getByTestId("equity-insight-strip") as HTMLDetailsElement;
}

describe("EquityMapInsightStrip — the compact collapsed bar", () => {
  it("renders exactly one native disclosure, never a clickable div", () => {
    const { container } = renderStrip();
    const details = container.querySelectorAll("details");
    expect(details).toHaveLength(1);
    expect(details[0].tagName).toBe("DETAILS");
    expect(container.querySelectorAll("summary")).toHaveLength(1);
    // The native element is what supplies Enter/Space, focus, and expanded state,
    // so there must be no hand-rolled toggle standing in for it.
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(0);
  });

  it("prints the exact frozen summary label and announces the same string", () => {
    renderStrip();
    const summary = screen.getByTestId("equity-insight-summary");
    expect(MAP_INSIGHT_SUMMARY_LABEL).toBe("해석 · 주의 · 출처 보기");
    // The chevron is aria-hidden, so the accessible name is the printed label —
    // no aria-label may override the visible text.
    expect(summary.hasAttribute("aria-label")).toBe(false);
    expect(summary.querySelector("span:not([aria-hidden])")?.textContent).toBe(
      "해석 · 주의 · 출처 보기",
    );
    const chevron = summary.querySelector("[aria-hidden]");
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
    expect(chevron?.className).toContain("map-insight-chevron");
  });

  it("is closed on first paint, with the whole panel gated behind the summary", () => {
    renderStrip();
    const details = disclosure();
    expect(details.open).toBe(false);
    expect(details.hasAttribute("open")).toBe(false);
    // Its class must be the genuinely-collapsing one, not a force-open-at-md+ class.
    expect(details.className).toContain("map-insight");
    expect(details.className).not.toContain("map-legend");
    expect(details.className).not.toContain("mobile-collapsible");
    // Every group, and the source action, live INSIDE the closed disclosure — that
    // containment is what keeps them out of the tab order and off the map.
    for (const testId of [
      "insight-interpretation",
      "insight-caution",
      "insight-reference-period",
      "insight-provenance",
      "insight-open-sources",
    ]) {
      expect(details.contains(screen.getByTestId(testId))).toBe(true);
    }
  });

  it("keeps the overlay wrapper click-through so it cannot swallow map drags", () => {
    renderStrip();
    const wrapper = screen.getByTestId("equity-insight-strip-wrapper");
    expect(wrapper.className).toContain("pointer-events-none");
    expect(disclosure().className).toContain("pointer-events-auto");
    // Unchanged: it participates only at the 1024px minimum supported width and up.
    expect(wrapper.className).toContain("hidden");
    expect(wrapper.className).toContain("lg:flex");
    // Right-aligned within the map's full-width bottom overlay band.
    expect(wrapper.className).toContain("justify-end");
  });
});

describe("EquityMapInsightStrip — opening preserves every group", () => {
  it("reveals 해석, 주의, and 자료 기준·출처 when opened, and hides them again when closed", () => {
    renderStrip();
    const details = disclosure();
    const body = screen.getByRole("region", { name: "지도 해석 안내", hidden: true });

    fireEvent.click(screen.getByTestId("equity-insight-summary"));
    expect(details.open).toBe(true);

    expect(body.textContent).toContain("해석");
    expect(screen.getByTestId("insight-interpretation").textContent).toContain("상대적 차이");
    expect(body.textContent).toContain("주의");
    expect(screen.getByTestId("insight-caution").textContent).toContain("0이 아니");
    expect(body.textContent).toContain("자료 기준·출처");

    // Closing returns to the compact bar with the panel gated again.
    fireEvent.click(screen.getByTestId("equity-insight-summary"));
    expect(details.open).toBe(false);
    expect(details.contains(body)).toBe(true);
  });

  it("keeps the source action available and still routed to the data-source area", () => {
    const { onOpenSources } = renderStrip();
    fireEvent.click(screen.getByTestId("equity-insight-summary"));

    const action = screen.getByTestId("insight-open-sources");
    expect(action.tagName).toBe("BUTTON");
    expect(action.textContent).toBe("출처 자세히 보기");
    // It must not repeat the frozen 데이터·출처 nav label (regression-contract §13).
    expect(action.textContent).not.toContain("데이터·출처");
    fireEvent.click(action);
    expect(onOpenSources).toHaveBeenCalledTimes(1);
  });

  it("prints the served reference period and source lines verbatim", () => {
    renderStrip();
    fireEvent.click(screen.getByTestId("equity-insight-summary"));

    expect(screen.getByTestId("insight-reference-period").textContent).toBe("자료 기준 2024-12");
    const provenance = screen.getByTestId("insight-provenance");
    for (const entry of PROVENANCE) {
      expect(provenance.textContent).toContain(entry.label);
      expect(provenance.textContent).toContain(entry.value);
    }
    // Provenance is stated once — the disclosure did not fork a second copy.
    expect(screen.getAllByTestId("insight-provenance")).toHaveLength(1);
    expect(screen.getAllByTestId("insight-reference-period")).toHaveLength(1);
  });

  it("omits the reference-period cell entirely when nothing was served", () => {
    renderStrip({ referencePeriod: "", metricProvenance: [] });
    fireEvent.click(screen.getByTestId("equity-insight-summary"));
    // Never padded with a placeholder, a dash, or a zero.
    expect(screen.queryByTestId("insight-reference-period")).toBeNull();
    expect(screen.queryByTestId("insight-provenance")).toBeNull();
  });

  it("renders one copy of each group and carries no live region", () => {
    const { container } = renderStrip();
    fireEvent.click(screen.getByTestId("equity-insight-summary"));

    for (const testId of [
      "equity-insight-strip",
      "equity-insight-summary",
      "insight-interpretation",
      "insight-caution",
      "insight-open-sources",
    ]) {
      expect(screen.getAllByTestId(testId)).toHaveLength(1);
    }
    // Standing explanatory content is never an alert, and a collapsed <details>
    // must not be the home of a live region that would silently stop announcing.
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
  });
});
