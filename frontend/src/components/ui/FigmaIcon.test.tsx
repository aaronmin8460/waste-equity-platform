// @vitest-environment jsdom

/**
 * Tests for FigmaIcon — the single renderer for the exact Figma vectors.
 *
 * These cover the contracts in the component's docblock: the geometry rendered is
 * the geometry Figma exported, a decorative icon adds no duplicate screen-reader
 * text, a titled icon is a named image, and `size` never distorts a non-square
 * glyph. The "no substitutes" client requirement is enforced by the closed registry
 * (a bad name is a type error) plus the asset-integrity checks in
 * figmaIcons.generated.test.ts.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import FigmaIcon from "./FigmaIcon";
import { FIGMA_ICONS } from "./figmaIcons.generated";

afterEach(cleanup);

function renderIcon(ui: React.ReactElement) {
  const { container } = render(ui);
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("no <svg> rendered");
  return svg;
}

describe("FigmaIcon", () => {
  /**
   * Round-trip the registry markup through the same DOM serializer the rendered
   * icon went through. Comparing raw strings would fail on nothing but formatting:
   * Figma writes `<path … />`, jsdom re-serializes it as `<path …></path>`.
   */
  function serialize(body: string): string {
    const holder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    holder.innerHTML = body;
    return holder.innerHTML;
  }

  it("renders the exact geometry Figma exported, not an approximation", () => {
    const svg = renderIcon(<FigmaIcon name="nav-region-marker-02" />);
    const spec = FIGMA_ICONS["nav-region-marker-02"];

    expect(svg.getAttribute("viewBox")).toBe(spec.viewBox);
    expect(svg.innerHTML).toBe(serialize(spec.body));
  });

  it("renders every registered icon with its own registered geometry", () => {
    for (const [name, spec] of Object.entries(FIGMA_ICONS)) {
      const svg = renderIcon(<FigmaIcon name={name as keyof typeof FIGMA_ICONS} />);
      expect(svg.innerHTML, `${name} did not render its Figma geometry`).toBe(
        serialize(spec.body),
      );
      cleanup();
    }
  });

  it("preserves the Figma stroke behaviour, linecap and linejoin", () => {
    const svg = renderIcon(<FigmaIcon name="nav-analysis-audio-settings-01" />);
    const path = svg.querySelector("path");

    expect(path?.getAttribute("stroke-width")).toBe("2");
    expect(path?.getAttribute("stroke-linecap")).toBe("round");
    expect(path?.getAttribute("stroke-linejoin")).toBe("round");
  });

  it("inherits colour so one glyph can render active and inactive", () => {
    const svg = renderIcon(<FigmaIcon name="nav-data-server-02" />);

    expect(svg.innerHTML).toContain("currentColor");
    // A baked hex could not be re-coloured for the active nav state.
    expect(svg.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("uses the intrinsic Figma dimensions by default", () => {
    const svg = renderIcon(<FigmaIcon name="nav-candidate-file-02" />);

    expect(svg.getAttribute("width")).toBe("17");
    expect(svg.getAttribute("height")).toBe("20");
  });

  it("scales both axes equally so a non-square glyph is never distorted", () => {
    // file-02 is 17x20. Fitting it to a 20px box must keep the 17:20 ratio.
    const svg = renderIcon(<FigmaIcon name="nav-candidate-file-02" size={20} />);
    const width = Number(svg.getAttribute("width"));
    const height = Number(svg.getAttribute("height"));

    expect(height).toBe(20);
    expect(width / height).toBeCloseTo(17 / 20, 5);
  });

  it("is decorative by default so a labelled nav tab is not announced twice", () => {
    const svg = renderIcon(<FigmaIcon name="nav-region-marker-02" />);

    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  it("becomes a named image when the icon is the only carrier of meaning", () => {
    render(<FigmaIcon name="logo-target-01" title="여기다" />);
    const img = screen.getByRole("img", { name: "여기다" });

    expect(img.getAttribute("aria-hidden")).toBeNull();
    expect(img.querySelector("title")?.textContent).toBe("여기다");
  });

  it("escapes the title instead of injecting it as markup", () => {
    const svg = renderIcon(<FigmaIcon name="logo-target-01" title={'<script>"x"'} />);

    expect(svg.querySelector("script")).toBeNull();
    expect(svg.querySelector("title")?.textContent).toBe('<script>"x"');
  });

  it("never references an external URL", () => {
    for (const name of Object.keys(FIGMA_ICONS) as (keyof typeof FIGMA_ICONS)[]) {
      const svg = renderIcon(<FigmaIcon name={name} />);
      expect(svg.innerHTML).not.toMatch(/https?:|url\(|<image\b|xlink:href/i);
      cleanup();
    }
  });
});
