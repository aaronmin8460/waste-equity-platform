// @vitest-environment jsdom

/**
 * SegmentedControl tests. The 후보지 분석 sub-view labels and testids are frozen
 * contracts (terminology.audit.test.tsx compares textContent with `.toBe`, and the
 * Playwright specs drive these buttons by both testid and accessible name), so the
 * fixture below uses the real sub-view options.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type SuitabilitySubview } from "../../lib/glossary";
import SegmentedControl from "./SegmentedControl";

afterEach(cleanup);

/**
 * A local fixture, deliberately NOT the glossary's `SUBVIEW_LABELS`.
 *
 * This is a GENERIC primitive (RegionRanking and LandCoverCellPanel are its real
 * consumers); it used to borrow the suitability sub-view labels, which coupled a
 * primitive's tests to product vocabulary that has since been promoted into the
 * top-level navigation. The keys stay `SuitabilitySubview` only to keep exercising
 * the generic type parameter.
 */
const OPTIONS = [
  { key: "score", label: "첫 번째", testId: "suitability-view-score" },
  { key: "scenario", label: "두 번째", testId: "suitability-view-scenario" },
  { key: "cost", label: "세 번째", testId: "suitability-view-cost" },
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
    expect([
      screen.getByTestId("suitability-view-score").textContent,
      screen.getByTestId("suitability-view-scenario").textContent,
      screen.getByTestId("suitability-view-cost").textContent,
    ]).toEqual(OPTIONS.map((o) => o.label));
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
