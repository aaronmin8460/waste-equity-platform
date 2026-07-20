// @vitest-environment jsdom

/**
 * SegmentedControl tests. The 후보지 분석 sub-view labels and testids are frozen
 * contracts (terminology.audit.test.tsx compares textContent with `.toBe`, and the
 * Playwright specs drive these buttons by both testid and accessible name), so the
 * fixture below uses the real sub-view options.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SUBVIEW_LABELS, type SuitabilitySubview } from "../../lib/glossary";
import SegmentedControl from "./SegmentedControl";

afterEach(cleanup);

const OPTIONS = [
  { key: "score", label: SUBVIEW_LABELS.score, testId: "suitability-view-score" },
  { key: "scenario", label: SUBVIEW_LABELS.scenario, testId: "suitability-view-scenario" },
  { key: "cost", label: SUBVIEW_LABELS.cost, testId: "suitability-view-cost" },
] as const satisfies readonly { key: SuitabilitySubview; label: string; testId: string }[];

function renderControl(
  value: SuitabilitySubview = "score",
  onChange: (v: SuitabilitySubview) => void = () => {},
) {
  return render(
    <SegmentedControl
      options={OPTIONS}
      value={value}
      onChange={onChange}
      ariaLabel="후보지 분석 하위 보기"
      testId="suitability-subview-switch"
    />,
  );
}

describe("SegmentedControl", () => {
  it("renders every supplied option with its exact visible label", () => {
    renderControl();
    expect(screen.getByTestId("suitability-view-score").textContent).toBe(SUBVIEW_LABELS.score);
    expect(screen.getByTestId("suitability-view-scenario").textContent).toBe(
      SUBVIEW_LABELS.scenario,
    );
    expect(screen.getByTestId("suitability-view-cost").textContent).toBe(SUBVIEW_LABELS.cost);
    expect([
      screen.getByTestId("suitability-view-score").textContent,
      screen.getByTestId("suitability-view-scenario").textContent,
      screen.getByTestId("suitability-view-cost").textContent,
    ]).toEqual(["후보지 점수", "가중치 바꿔보기", "비용 살펴보기"]);
  });

  it("renders native buttons, reachable by accessible name", () => {
    renderControl();
    for (const option of OPTIONS) {
      const button = screen.getByTestId(option.testId);
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      // The e2e citizen flows click these by role+name.
      expect(screen.getByRole("button", { name: option.label })).toBe(button);
    }
  });

  it("marks the selected option with aria-pressed", () => {
    const { rerender } = renderControl("score");
    expect(screen.getByTestId("suitability-view-score").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("suitability-view-cost").getAttribute("aria-pressed")).toBe("false");

    rerender(
      <SegmentedControl
        options={OPTIONS}
        value="cost"
        onChange={() => {}}
        ariaLabel="후보지 분석 하위 보기"
        testId="suitability-subview-switch"
      />,
    );
    expect(screen.getByTestId("suitability-view-cost").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("suitability-view-score").getAttribute("aria-pressed")).toBe("false");
  });

  it("is a labelled group and NOT a fieldset or radiogroup", () => {
    const { container } = renderControl();
    const group = screen.getByTestId("suitability-subview-switch");
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("후보지 분석 하위 보기");
    // A fieldset here would break e2e/accessibility.spec.ts, which asserts the page
    // has exactly three fieldsets (the equity metric groups).
    expect(container.querySelectorAll("fieldset")).toHaveLength(0);
    // No radiogroup/tablist: roving arrow-key focus is not implemented, so claiming
    // it would be a false promise to assistive tech.
    expect(group.getAttribute("role")).not.toBe("radiogroup");
    expect(container.querySelector('[role="tablist"], [role="tab"]')).toBeNull();
  });

  it("reports the chosen option through the change callback", () => {
    const onChange = vi.fn();
    renderControl("score", onChange);

    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    expect(onChange).toHaveBeenCalledWith("cost");

    fireEvent.click(screen.getByTestId("suitability-view-scenario"));
    expect(onChange).toHaveBeenLastCalledWith("scenario");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("adds no extra content inside a segment", () => {
    renderControl();
    for (const option of OPTIONS) {
      expect(screen.getByTestId(option.testId).children).toHaveLength(0);
    }
  });
});
