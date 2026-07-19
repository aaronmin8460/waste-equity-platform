// @vitest-environment jsdom

/**
 * Responsive-layout structure tests for the dashboard shell.
 *
 * jsdom does not compute CSS layout, so these assert the responsive contract at
 * the class/DOM level: the root is a mobile-first vertical column that becomes a
 * side-by-side row at md+, the sidebar is full-width on mobile and a fixed column
 * on desktop, the map wrapper carries an explicit mobile minimum height (so the
 * flex column can never collapse it to zero), and the verbose control panels are
 * native <details> disclosures that keep the mobile sidebar short. Actual pixel
 * behaviour at real viewports is verified by e2e/responsive.spec.ts.
 *
 * The map (MapLibre/WebGL) is stubbed and the backend is mocked, exactly as the
 * mode-routing test does — this is about layout, not rendering or data.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/** Split a className string into individual utility tokens. */
function classes(el: Element | null): string[] {
  return (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

describe("responsive application shell", () => {
  it("stacks vertically on mobile and switches to a row at the md breakpoint", async () => {
    const { container } = await renderLoaded();
    const main = container.querySelector("main");
    const tokens = classes(main);
    // Mobile-first: a vertical column that becomes a row only at md+.
    expect(tokens).toContain("flex");
    expect(tokens).toContain("flex-col");
    expect(tokens).toContain("md:flex-row");
    // Dynamic-viewport height so mobile browser chrome never crops the app, and a
    // fixed viewport height on desktop (no unintended document scroll).
    expect(tokens).toContain("min-h-dvh");
    expect(tokens).toContain("md:h-dvh");
    // Each dvh utility is preceded by its static-viewport fallback, so an engine
    // without `dvh` support keeps a valid full-viewport height instead of dropping
    // the declaration entirely (which would leave the desktop row — and its
    // `md:flex-1` map — with no definite height).
    expect(tokens).toContain("min-h-screen");
    expect(tokens).toContain("md:h-screen");
    // Ordering matters: the fallback must come BEFORE the dvh class so a
    // dvh-supporting engine applies dvh (later rule, equal specificity).
    expect(tokens.indexOf("min-h-screen")).toBeLessThan(tokens.indexOf("min-h-dvh"));
    expect(tokens.indexOf("md:h-screen")).toBeLessThan(tokens.indexOf("md:h-dvh"));
    // No bare, unconditional static `h-screen` (the pre-responsive full-height
    // row) remains — the fallbacks above are the min-h-/md:h- prefixed forms.
    expect(tokens).not.toContain("h-screen");
  });

  it("makes the sidebar full-width on mobile and a fixed column on desktop", async () => {
    const { container } = await renderLoaded();
    const tokens = classes(container.querySelector("aside"));
    expect(tokens).toContain("w-full");
    expect(tokens).toContain("md:w-96");
    expect(tokens).toContain("md:flex-none");
    // No fixed 384px width forced on mobile.
    expect(tokens).not.toContain("w-96");
  });

  it("gives the map wrapper a definite mobile height that flexes to fill at md+", async () => {
    await renderLoaded();
    const wrapper = screen.getByTestId("map-container").parentElement;
    const tokens = classes(wrapper);
    // Definite height on mobile so the MapLibre child (h-full) never collapses.
    // A dvh-less engine drops the invalid `height:60dvh` and keeps the valid
    // `60vh`, so the box always has a definite height — the vh fallback MUST come
    // before the dvh class (equal specificity → later rule wins on dvh engines).
    expect(tokens).toContain("h-[60vh]");
    expect(tokens).toContain("h-[60dvh]");
    expect(tokens.indexOf("h-[60vh]")).toBeLessThan(tokens.indexOf("h-[60dvh]"));
    expect(tokens).toContain("min-w-0");
    // …and flexes to fill the row on desktop.
    expect(tokens).toContain("md:h-auto");
    expect(tokens).toContain("md:min-h-0");
    expect(tokens).toContain("md:flex-1");
  });

  it("keeps the map mounted when switching equity → suitability → equity", async () => {
    await renderLoaded();
    expect(screen.getByTestId("map-container")).toBeDefined();
    fireEvent.click(screen.getByTestId("mode-suitability"));
    await waitFor(() =>
      expect(screen.getByTestId("mode-suitability").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByTestId("map-container")).toBeDefined();
    fireEvent.click(screen.getByTestId("mode-equity"));
    await waitFor(() =>
      expect(screen.getByTestId("mode-equity").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByTestId("map-container")).toBeDefined();
  });
});

describe("mobile control collapsing", () => {
  it("wraps the verbose equity panels in native <details> with clear Korean labels", async () => {
    const { container } = await renderLoaded();
    const details = container.querySelectorAll("details.mobile-collapsible");
    // Legend, sources & method, and facility layer collapse on mobile.
    expect(details.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("지도 범례 (Legend)")).toBeDefined();
    expect(screen.getByText("출처 및 방법 (Sources & method)")).toBeDefined();
    expect(screen.getByText("시설 레이어 (Facility layer)")).toBeDefined();
    // The section content still lives inside the DOM (never permanently hidden),
    // so desktop CSS can force it open and screen readers can reach it.
    expect(screen.getByTestId("legend")).toBeDefined();
    expect(screen.getByTestId("facilities-toggle")).toBeDefined();
  });

  it("uses flex-wrap on the mode switcher so it never overflows narrow widths", async () => {
    const { container } = await renderLoaded();
    const group = container.querySelector('[data-testid="mode-switch"]');
    expect(classes(group)).toContain("flex-wrap");
  });
});
