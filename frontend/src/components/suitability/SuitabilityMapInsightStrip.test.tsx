// @vitest-environment jsdom

/**
 * 후보지 분석 map insight — collapsed-by-default disclosure, both variants.
 *
 * The suitability counterpart of `equity/EquityMapInsightStrip.test.tsx`, and it
 * holds the same two halves together — the COMPACT one (one disclosure, the same
 * shared label, closed on first paint) and the PRESERVED one (opening reveals the
 * same 해석 / 주의 / 현재 기준·출처 groups, the same served basis, visibility,
 * stable-only note, reference year, and version strings, in BOTH the score and the
 * scenario variant).
 *
 * The nested 기술 정보 `<details>` is deliberately kept: these tests assert there is
 * exactly ONE outer `.map-insight` disclosure and that the technical one is inside
 * it, so "one disclosure" never quietly comes to mean "the version strings moved".
 *
 * jsdom applies no UA style to `<details>`, so "hidden" is asserted the way the
 * platform enforces it — the `open` state plus containment. Real rendered
 * visibility, real keyboard activation, and real geometry are asserted in Chromium
 * by `e2e/suitabilityDashboard.spec.ts`.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SuitabilityMapInsightStrip from "./SuitabilityMapInsightStrip";
import type { SuitabilityMapInsightStripProps } from "./SuitabilityMapInsightStrip";
import { MAP_INSIGHT_SUMMARY_LABEL } from "../../lib/glossary";

afterEach(cleanup);

const SCENARIO_WEIGHTS = [
  { label: "용도지역 호환성", percent: "40%" },
  { label: "도로 근접성", percent: "20%" },
  { label: "지역 부담", percent: "20%" },
  { label: "수요 근접성", percent: "20%" },
];

function renderStrip(overrides: Partial<SuitabilityMapInsightStripProps> = {}) {
  const onOpenSources = vi.fn();
  const result = render(
    <SuitabilityMapInsightStrip
      variant="score"
      profile="baseline"
      scenarioWeights={null}
      visibleStatuses={["ELIGIBLE"]}
      stableOnly={false}
      runId={48}
      referenceYear={2024}
      policyVersion="suitability-policy-v2"
      derivationVersion="screening-v3"
      candidateGridVersion="grid-v1"
      onOpenSources={onOpenSources}
      {...overrides}
    />,
  );
  return { ...result, onOpenSources };
}

function disclosure(): HTMLDetailsElement {
  return screen.getByTestId("suitability-insight-strip") as HTMLDetailsElement;
}

function open(): void {
  fireEvent.click(screen.getByTestId("suitability-insight-summary"));
}

describe("SuitabilityMapInsightStrip — the compact collapsed bar", () => {
  it.each(["score", "scenario"] as const)(
    "starts collapsed in the %s view, behind one shared compact bar",
    (variant) => {
      const { container } = renderStrip({
        variant,
        scenarioWeights: variant === "scenario" ? SCENARIO_WEIGHTS : null,
      });
      const details = disclosure();
      expect(details.tagName).toBe("DETAILS");
      expect(details.open).toBe(false);
      expect(details.className).toContain("map-insight");
      // The legend force-opens at md+; this must never share that class.
      expect(details.className).not.toContain("map-legend");
      expect(details.className).not.toContain("mobile-collapsible");

      const summary = screen.getByTestId("suitability-insight-summary");
      expect(MAP_INSIGHT_SUMMARY_LABEL).toBe("해석 · 주의 · 출처 보기");
      expect(summary.querySelector("span:not([aria-hidden])")?.textContent).toBe(
        "해석 · 주의 · 출처 보기",
      );
      // The accessible name is the printed label — no aria-label may replace it.
      expect(summary.hasAttribute("aria-label")).toBe(false);

      // ONE outer disclosure; the 기술 정보 one is a preserved child of it, not a
      // second map-insight bar.
      expect(container.querySelectorAll("details.map-insight")).toHaveLength(1);
      const technical = screen.getByTestId("suitability-insight-technical");
      expect(details.contains(technical)).toBe(true);
      expect(technical.className).not.toContain("map-insight");
      // …and nothing hand-rolled stands in for the native element.
      expect(container.querySelectorAll('[role="button"]')).toHaveLength(0);
    },
  );

  it("gates every group and the source action behind the closed summary", () => {
    renderStrip();
    const details = disclosure();
    for (const testId of [
      "suitability-insight-interpretation",
      "suitability-insight-caution",
      "suitability-insight-basis",
      "suitability-insight-visibility",
      "suitability-insight-technical",
      "suitability-insight-open-sources",
    ]) {
      expect(details.contains(screen.getByTestId(testId))).toBe(true);
    }
  });

  it("keeps the overlay wrapper click-through so it cannot swallow map drags", () => {
    renderStrip();
    const wrapper = screen.getByTestId("suitability-insight-strip-wrapper");
    expect(wrapper.className).toContain("pointer-events-none");
    expect(disclosure().className).toContain("pointer-events-auto");
    // Unchanged: it participates only at the 1024px minimum supported width and up.
    expect(wrapper.className).toContain("hidden");
    expect(wrapper.className).toContain("lg:flex");
    // Right-aligned within the map's full-width bottom overlay band.
    expect(wrapper.className).toContain("justify-end");
  });
});

describe("SuitabilityMapInsightStrip — opening preserves the score variant", () => {
  it("reveals the stored-run interpretation, the standing caution, and the basis", () => {
    renderStrip();
    open();
    expect(disclosure().open).toBe(true);

    expect(screen.getByTestId("suitability-insight-interpretation").textContent).toContain(
      "상대적 스크리닝 점수",
    );
    expect(screen.getByTestId("suitability-insight-interpretation").textContent).toContain(
      "기본 기준",
    );
    expect(screen.getByTestId("suitability-insight-caution").textContent).toContain(
      "법적·공학적 적합 판정이 아닙니다",
    );

    const basis = screen.getByTestId("suitability-insight-basis").textContent ?? "";
    expect(basis).toContain("점수 반영 기준");
    expect(basis).toContain("기본 기준");
    expect(basis).toContain("2024");
    expect(screen.getByTestId("suitability-insight-visibility").textContent).toContain(
      "스크리닝 통과",
    );
    // Version strings stay in the technical disclosure, not in primary text.
    expect(basis).not.toContain("suitability-policy-v2");
    const technical = screen.getByTestId("suitability-insight-technical").textContent ?? "";
    expect(technical).toContain("48");
    expect(technical).toContain("suitability-policy-v2");
    expect(technical).toContain("screening-v3");
    expect(technical).toContain("grid-v1");
  });

  it("states the stable-only restriction when it is active", () => {
    renderStrip({ stableOnly: true, visibleStatuses: ["ELIGIBLE", "REVIEW_REQUIRED"] });
    open();
    const visibility = screen.getByTestId("suitability-insight-visibility").textContent ?? "";
    expect(visibility).toContain("안정 후보만");
    expect(visibility).toContain("검토 필요");
  });

  it("says so explicitly when no status is drawn — never an invented count", () => {
    renderStrip({ visibleStatuses: [] });
    open();
    expect(screen.getByTestId("suitability-insight-visibility").textContent).toContain(
      "표시 중인 상태 없음",
    );
  });
});

describe("SuitabilityMapInsightStrip — opening preserves the scenario variant", () => {
  it("reveals the applied-weight interpretation, the scenario caveat, and the weights", () => {
    renderStrip({ variant: "scenario", scenarioWeights: SCENARIO_WEIGHTS });
    open();

    expect(screen.getByTestId("suitability-insight-interpretation").textContent).toContain(
      "사용자가 조정한 가중치",
    );
    expect(screen.getByTestId("suitability-insight-caution").textContent).toContain(
      "공식 분석 실행이 아닙니다",
    );
    const basis = screen.getByTestId("suitability-insight-basis").textContent ?? "";
    expect(basis).toContain("비교 기준");
    expect(basis).toContain("적용 가중치");
    for (const weight of SCENARIO_WEIGHTS) {
      expect(basis).toContain(weight.label);
      expect(basis).toContain(weight.percent);
    }
  });

  it("keeps the not-yet-applied wording when no scenario has been applied", () => {
    renderStrip({ variant: "scenario", scenarioWeights: null });
    open();
    expect(screen.getByTestId("suitability-insight-interpretation").textContent).toContain(
      "아직 시나리오를 적용하지 않아",
    );
    // No 적용 가중치 row is invented before one is applied.
    expect(screen.getByTestId("suitability-insight-basis").textContent).not.toContain(
      "적용 가중치",
    );
  });
});

describe("SuitabilityMapInsightStrip — closing, routing, and duplication", () => {
  it("closes again and re-gates the expanded body", () => {
    renderStrip();
    const details = disclosure();
    const body = screen.getByTestId("suitability-insight-body");
    open();
    expect(details.open).toBe(true);
    open();
    expect(details.open).toBe(false);
    expect(details.contains(body)).toBe(true);
  });

  it("keeps the source action available and routed, without repeating a nav label", () => {
    const { onOpenSources } = renderStrip();
    open();
    const action = screen.getByTestId("suitability-insight-open-sources");
    expect(action.tagName).toBe("BUTTON");
    expect(action.textContent).toBe("출처 자세히 보기");
    expect(action.textContent).not.toContain("데이터·출처");
    fireEvent.click(action);
    expect(onOpenSources).toHaveBeenCalledTimes(1);
  });

  it("renders one copy of each group and carries no live region", () => {
    const { container } = renderStrip();
    open();
    for (const testId of [
      "suitability-insight-strip",
      "suitability-insight-summary",
      "suitability-insight-body",
      "suitability-insight-interpretation",
      "suitability-insight-caution",
      "suitability-insight-basis",
      "suitability-insight-open-sources",
    ]) {
      expect(screen.getAllByTestId(testId)).toHaveLength(1);
    }
    // Standing explanatory content is never an alert, and a collapsed <details>
    // must not be the home of a live region that would silently stop announcing.
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
  });
});
