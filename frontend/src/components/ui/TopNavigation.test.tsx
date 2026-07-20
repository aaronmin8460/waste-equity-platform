// @vitest-environment jsdom

/**
 * TopNavigation tests — the contracts the terminology audit, the accessibility
 * suite, and the Playwright specs all depend on. These are intentional contracts,
 * not incidental implementation details: see the docblock in TopNavigation.tsx.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MODE_LABELS } from "../../lib/glossary";
import TopNavigation from "./TopNavigation";

afterEach(cleanup);

const TEST_IDS = {
  equity: "mode-equity",
  suitability: "mode-suitability",
  flow: "mode-flow",
  transparency: "mode-transparency",
} as const;

describe("TopNavigation", () => {
  it("renders the four areas with their exact plain-Korean labels", () => {
    render(<TopNavigation mode="equity" onChange={() => {}} />);
    // `.toBe`, not `.toContain` — the label must be the button's ENTIRE content.
    expect(screen.getByTestId("mode-equity").textContent).toBe(MODE_LABELS.equity);
    expect(screen.getByTestId("mode-suitability").textContent).toBe(MODE_LABELS.suitability);
    expect(screen.getByTestId("mode-flow").textContent).toBe(MODE_LABELS.flow);
    expect(screen.getByTestId("mode-transparency").textContent).toBe(MODE_LABELS.transparency);
    // The visible labels are the four Korean strings, in order.
    expect([
      screen.getByTestId("mode-equity").textContent,
      screen.getByTestId("mode-suitability").textContent,
      screen.getByTestId("mode-flow").textContent,
      screen.getByTestId("mode-transparency").textContent,
    ]).toEqual(["지역 부담", "후보지 분석", "매립지 현황", "데이터·출처"]);
  });

  it("adds no icon, badge, counter, or extra element inside a mode button", () => {
    render(<TopNavigation mode="equity" onChange={() => {}} />);
    for (const testId of Object.values(TEST_IDS)) {
      const button = screen.getByTestId(testId);
      // No child elements at all — the label text is the only content, so the
      // terminology audit's exact-textContent comparison can never be diluted.
      expect(button.children).toHaveLength(0);
      expect(button.textContent).toBe(button.textContent?.trim());
    }
  });

  it("uses native buttons so keyboard activation is built in", () => {
    render(<TopNavigation mode="equity" onChange={() => {}} />);
    for (const testId of Object.values(TEST_IDS)) {
      const button = screen.getByTestId(testId);
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("exposes the active area through aria-pressed, not color alone", () => {
    const { rerender } = render(<TopNavigation mode="equity" onChange={() => {}} />);
    expect(screen.getByTestId("mode-equity").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("mode-flow").getAttribute("aria-pressed")).toBe("false");

    rerender(<TopNavigation mode="flow" onChange={() => {}} />);
    expect(screen.getByTestId("mode-flow").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("mode-equity").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the labelled group relationship with a non-visible label", () => {
    render(<TopNavigation mode="equity" onChange={() => {}} />);
    const group = screen.getByTestId("mode-switch");
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-labelledby")).toBe("mode-switch-label");

    // The label element still exists and still carries an accessible name…
    const label = document.getElementById("mode-switch-label");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("분석 영역 선택");
    // …but it is visually hidden, so the old "무엇을 볼까요?" noise is gone.
    expect(label?.className).toContain("sr-only");
    // It must not be a heading: this nav renders above every view's own <h1>.
    expect(label?.tagName).not.toMatch(/^H[1-6]$/);
  });

  it("renders no heading of its own", () => {
    const { container } = render(<TopNavigation mode="equity" onChange={() => {}} />);
    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0);
  });

  it("reports the selected area through the change callback", () => {
    const onChange = vi.fn();
    render(<TopNavigation mode="equity" onChange={onChange} />);

    fireEvent.click(screen.getByTestId("mode-flow"));
    expect(onChange).toHaveBeenCalledWith("flow");

    fireEvent.click(screen.getByTestId("mode-transparency"));
    expect(onChange).toHaveBeenLastCalledWith("transparency");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
