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

import type { NavDestinationKey } from "../../lib/glossary";
import { NAV_DESTINATIONS } from "../../lib/glossary";
import { FIGMA_ICONS, type FigmaIconName } from "./figmaIcons.generated";
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
      // Renamed by the Figma forensic audit: the frame names this destination
      // 지역별 폐기물 처리 현황, and the screen genuinely is a per-region breakdown
      // rather than a nationwide total. `mode-flow` and the URL are unchanged.
      "지역별 폐기물 처리 현황",
      // NOT renamed: the Figma file names this 후보지 분석 in the nav and
      // 시설 비용 살펴보기 in the frame title. A source that disagrees with itself
      // does not settle a citizen-facing name — the shipped contract stands until
      // the owner decides (see lib/glossary.ts).
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

  /**
   * The committed SVG text and the rendered DOM differ only in serialization —
   * `<path … />` in the file, `<path …></path>` once parsed. Round-tripping the
   * expected markup through the SAME parser normalises that away, so the comparison
   * is about geometry rather than about which serializer wrote the string.
   */
  function asRenderedMarkup(body: string): string {
    const host = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    host.innerHTML = body;
    return host.innerHTML;
  }

  /**
   * The six nav glyphs and the brand mark are the EXACT vectors exported from the
   * Figma file, not approximations of them. Each assertion below compares against
   * `figmaIcons.generated.ts`, which is itself re-checked against the committed
   * SVGs by `figmaIcons.generated.test.ts` — so a hand-drawn substitute, a
   * third-party icon, or a silently edited path fails here.
   *
   * The mapping is the one Phase 0 read from layer visibility inside each Figma
   * `Nav Button` instance (docs/figma-redesign/FIGMA_ASSET_INVENTORY.md), NOT one
   * inferred from the Korean labels.
   */
  const FIGMA_NAV_ICONS: Record<NavDestinationKey, FigmaIconName> = {
    "regional-indicators": "nav-region-marker-02",
    "waste-treatment": "nav-waste-barchart",
    "candidate-analysis": "nav-candidate-file-02",
    "candidate-deep-analysis": "nav-analysis-audio-settings-01",
    "candidate-deep-comparison": "nav-compare-column-vertical-01",
    "data-sources": "nav-data-server-02",
  };

  it("renders the exact Figma vector each destination was designed with", () => {
    renderNav();
    for (const destination of NAV_DESTINATIONS) {
      const icon = screen.getByTestId(destination.testId).querySelector("svg")!;
      const expected = FIGMA_NAV_ICONS[destination.key];
      expect(icon.getAttribute("data-figma-icon"), destination.key).toBe(expected);
      // Geometry, not just the name: the rendered markup IS the committed export.
      expect(icon.innerHTML, destination.key).toBe(asRenderedMarkup(FIGMA_ICONS[expected].body));
      expect(icon.getAttribute("viewBox"), destination.key).toBe(FIGMA_ICONS[expected].viewBox);
    }
  });

  it("draws the brand mark from the Figma target-01 export", () => {
    const { container } = renderNav();
    const mark = container.querySelector(".wep-brand-mark svg")!;
    expect(mark.getAttribute("data-figma-icon")).toBe("logo-target-01");
    expect(mark.innerHTML).toBe(asRenderedMarkup(FIGMA_ICONS["logo-target-01"].body));
  });

  it("separates 데이터·출처 with a decorative rule that joins no button", () => {
    renderNav();
    // The Figma header (and the page-1 기술요청 annotation) puts a vertical bar
    // before 데이터·출처. It must not become a seventh control, and must not land
    // inside a button, whose textContent is compared exactly.
    const divider = screen.getByTestId("nav-divider");
    expect(divider.tagName).toBe("SPAN");
    expect(divider.getAttribute("aria-hidden")).toBe("true");
    expect(divider.textContent).toBe("");
    expect(divider.closest("button")).toBeNull();
    expect(screen.getByTestId("mode-switch").contains(divider)).toBe(true);
    expect(screen.getByTestId("mode-switch").querySelectorAll("button")).toHaveLength(6);
    // It sits immediately before the 데이터·출처 tab, not anywhere in the track.
    expect(divider.nextElementSibling).toBe(screen.getByTestId("mode-transparency"));
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
    // 매립지 named ONE disposal route while the six destinations analyse
    // 소각·재활용·매립 facilities alike, so the audit replaced it with the term that
    // covers what the product actually does.
    expect(BRAND_SUBTITLE).toBe("폐기물 처리시설 입지 추천 플랫폼");

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
    // The target/crosshair motif (spec §1). It used to be asserted as ">= 3
    // <circle> elements", which pinned the SHAPE of the hand-drawn approximation;
    // the real Figma export draws the same motif as one filled <path>, so the
    // assertion now pins the ASSET instead (see the exact-vector test above).
    expect(mark?.querySelector("svg")?.getAttribute("data-figma-icon")).toBe("logo-target-01");
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
