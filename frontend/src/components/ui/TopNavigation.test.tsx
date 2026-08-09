// @vitest-environment jsdom

/**
 * TopNavigation tests — the contracts the terminology audit, the accessibility
 * suite, and the Playwright specs all depend on. These are intentional contracts,
 * not incidental implementation details: see the docblock in TopNavigation.tsx.
 *
 * Updated for the 여기다 redesign: SIX visible destinations projected onto the
 * unchanged four-mode / three-sub-view analytical state, each carrying an icon.
 * The exact-`textContent` rule survives the icons because they are text-free
 * `aria-hidden` SVGs — which is precisely what the icon tests below pin.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NAV_DESTINATIONS } from "../../lib/glossary";
import TopNavigation, { BRAND_NAME, BRAND_SUBTITLE } from "./TopNavigation";

afterEach(cleanup);

/** 후보지 심층 분석 — the suitability score destination, and the default landing. */
const DEEP_ANALYSIS = NAV_DESTINATIONS[3];
/** 지역 지표 — mode=equity. */
const REGIONAL = NAV_DESTINATIONS[0];

function renderNav(active = REGIONAL, onNavigate = () => {}) {
  return render(<TopNavigation active={active} onNavigate={onNavigate} />);
}

describe("TopNavigation", () => {
  it("renders the six destinations in order, with their exact plain-Korean labels", () => {
    renderNav();
    expect(NAV_DESTINATIONS.map((d) => screen.getByTestId(d.testId).textContent)).toEqual([
      "지역 지표",
      "폐기물 처리 현황",
      "후보지 분석",
      "후보지 심층 분석",
      "후보지 심층 비교",
      "데이터·출처",
    ]);
  });

  it("keeps each button's textContent EXACTLY its label, despite the icon", () => {
    renderNav();
    for (const destination of NAV_DESTINATIONS) {
      const button = screen.getByTestId(destination.testId);
      // `.toBe`, not `.toContain` — the terminology audit compares this way, so a
      // badge, counter, or any stray character inside a button would break it.
      expect(button.textContent).toBe(destination.label);
      expect(button.textContent).toBe(button.textContent?.trim());
    }
  });

  it("renders exactly one decorative, text-free icon inside each button", () => {
    renderNav();
    for (const destination of NAV_DESTINATIONS) {
      const button = screen.getByTestId(destination.testId);
      const icons = button.querySelectorAll("svg");
      expect(icons, destination.key).toHaveLength(1);
      // aria-hidden + no <title>: the visible Korean label stays the button's
      // entire accessible name, and the SVG contributes nothing to textContent.
      expect(icons[0].getAttribute("aria-hidden")).toBe("true");
      expect(icons[0].querySelector("title")).toBeNull();
      expect(icons[0].textContent).toBe("");
    }
  });

  it("gives every destination a DISTINCT icon", () => {
    renderNav();
    // A shared glyph would make the icons decoration rather than wayfinding.
    const shapes = NAV_DESTINATIONS.map(
      (d) => screen.getByTestId(d.testId).querySelector("svg")!.innerHTML,
    );
    expect(new Set(shapes).size).toBe(NAV_DESTINATIONS.length);
  });

  it("uses native buttons so keyboard activation is built in", () => {
    renderNav();
    for (const destination of NAV_DESTINATIONS) {
      const button = screen.getByTestId(destination.testId);
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
    }
  });

  it("exposes the active destination through aria-pressed, not colour alone", () => {
    const { rerender } = renderNav(REGIONAL);
    expect(screen.getByTestId(REGIONAL.testId).getAttribute("aria-pressed")).toBe("true");
    // Exactly ONE destination is pressed at a time.
    expect(
      NAV_DESTINATIONS.filter(
        (d) => screen.getByTestId(d.testId).getAttribute("aria-pressed") === "true",
      ),
    ).toHaveLength(1);

    rerender(<TopNavigation active={DEEP_ANALYSIS} onNavigate={() => {}} />);
    expect(screen.getByTestId(DEEP_ANALYSIS.testId).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId(REGIONAL.testId).getAttribute("aria-pressed")).toBe("false");
  });

  it("distinguishes the three suitability destinations from one another", () => {
    // They share `mode=suitability`, so a naive mode-only comparison would light
    // up all three at once. The active state is keyed on the DESTINATION.
    const scenario = NAV_DESTINATIONS.find((d) => d.view === "scenario")!;
    renderNav(scenario);
    expect(screen.getByTestId(scenario.testId).getAttribute("aria-pressed")).toBe("true");
    for (const other of NAV_DESTINATIONS.filter((d) => d.key !== scenario.key)) {
      expect(screen.getByTestId(other.testId).getAttribute("aria-pressed"), other.key).toBe(
        "false",
      );
    }
  });

  it("keeps the labelled group relationship with a non-visible label", () => {
    renderNav();
    const group = screen.getByTestId("mode-switch");
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-labelledby")).toBe("mode-switch-label");

    // The label element still exists and still carries an accessible name…
    const label = document.getElementById("mode-switch-label");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("분석 영역 선택");
    // …but it is visually hidden, so the old "무엇을 볼까요?" noise stays gone.
    expect(label?.className).toContain("sr-only");
    // It must not be a heading: this nav renders above every view's own <h1>.
    expect(label?.tagName).not.toMatch(/^H[1-6]$/);
  });

  it("renders no heading of its own", () => {
    const { container } = renderNav();
    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0);
  });

  it("renders the 여기다 brand OUTSIDE the mode-switch group", () => {
    renderNav();
    const brand = screen.getByTestId("app-brand");
    expect(brand.textContent).toContain(BRAND_NAME);
    expect(brand.textContent).toContain(BRAND_SUBTITLE);
    expect(BRAND_NAME).toBe("여기다");
    expect(BRAND_SUBTITLE).toBe("쓰레기 매립지 입지 추천 플랫폼");

    // Never inside the labelled navigation group: the group's six controls are the
    // six destinations, and nothing else may join that count or its accessible name.
    const group = screen.getByTestId("mode-switch");
    expect(group.contains(brand)).toBe(false);
    expect(group.querySelectorAll("button")).toHaveLength(6);
    // Nor inside any button — the terminology audit compares button textContent
    // with `.toBe`, so brand text inside one would break it.
    for (const destination of NAV_DESTINATIONS) {
      expect(screen.getByTestId(destination.testId).contains(brand)).toBe(false);
    }
  });

  it("keeps the brand non-interactive and its target mark decorative", () => {
    const { container } = renderNav();
    const brand = screen.getByTestId("app-brand");
    // No link/button: the brand is identity, not navigation. A "home" link here
    // would be a seventh navigation control competing with the six destinations.
    expect(brand.querySelectorAll("a, button")).toHaveLength(0);
    // The mark announces nothing — the product name beside it is the accessible text.
    const mark = container.querySelector(".wep-brand-mark");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.textContent).toBe("");
    // The target/crosshair motif (spec §1): concentric rings, not the old stack.
    expect(mark?.querySelectorAll("circle").length).toBeGreaterThanOrEqual(3);
  });

  it("still renders no heading once the brand is present", () => {
    // The brand must be a <span>: this bar renders above every view's own single
    // <h1>, so a heading here would become a second (and first-in-order) heading.
    const { container } = renderNav();
    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0);
    expect(screen.getByText(BRAND_NAME).tagName).toBe("SPAN");
  });

  it("reports the whole selected destination through the change callback", () => {
    const onNavigate = vi.fn();
    renderNav(REGIONAL, onNavigate);

    // The callback carries the (mode, view) pair, so the page never has to re-derive
    // routing from a label or a testid.
    fireEvent.click(screen.getByTestId("mode-flow"));
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ key: "waste-treatment", mode: "flow", view: null }),
    );

    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    expect(onNavigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "candidate-analysis", mode: "suitability", view: "cost" }),
    );
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });
});
