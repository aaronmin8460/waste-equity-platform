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
  // Phase 1 moved the viewport-height ownership one level up: the shell root
  // (components/DashboardShell.tsx) is now the fixed-height flex COLUMN that holds
  // the global navigation plus <main>, and <main> is the row that holds the sidebar
  // and the map. The invariants below are the same ones as before — the
  // fallback-before-dvh ordering and the column→row switch — asserted on whichever
  // element now owns each.
  it("gives the shell root a definite viewport height with the vh fallback first", async () => {
    const { container } = await renderLoaded();
    const shell = container.querySelector('[data-testid="app-shell"]');
    expect(shell).not.toBeNull();
    const tokens = classes(shell);
    // A flex column: the nav is an auto-height first child and <main> flexes into
    // the remaining height, so `.map-pane`'s `height: 100%` still has a definite
    // parent to resolve against.
    expect(tokens).toContain("flex");
    expect(tokens).toContain("flex-col");
    // Dynamic-viewport height so mobile browser chrome never crops the app, and a
    // fixed viewport height on desktop (no unintended document scroll).
    expect(tokens).toContain("min-h-dvh");
    expect(tokens).toContain("md:h-dvh");
    // Each dvh utility is preceded by its static-viewport fallback, so an engine
    // without `dvh` support keeps a valid full-viewport height instead of dropping
    // the declaration entirely (which would leave the desktop column — and the map
    // pane inside it — with no definite height).
    expect(tokens).toContain("min-h-screen");
    expect(tokens).toContain("md:h-screen");
    // Ordering matters: the fallback must come BEFORE the dvh class so a
    // dvh-supporting engine applies dvh (later rule, equal specificity). This is
    // also what the `@supports` two-class overrides in globals.css key on.
    expect(tokens.indexOf("min-h-screen")).toBeLessThan(tokens.indexOf("min-h-dvh"));
    expect(tokens.indexOf("md:h-screen")).toBeLessThan(tokens.indexOf("md:h-dvh"));
    // No bare, unconditional static `h-screen` (the pre-responsive full-height
    // row) remains — the fallbacks above are the min-h-/md:h- prefixed forms.
    expect(tokens).not.toContain("h-screen");
  });

  it("stacks vertically on mobile and switches to a row at the md breakpoint", async () => {
    const { container } = await renderLoaded();
    const main = container.querySelector("main");
    const tokens = classes(main);
    // Mobile-first: a vertical column that becomes a row only at md+.
    expect(tokens).toContain("flex");
    expect(tokens).toContain("flex-col");
    expect(tokens).toContain("md:flex-row");
    // At md+ <main> fills the shell column's remaining height. `min-h-0` is
    // load-bearing: without it the default `min-height: auto` would let the content
    // push the row past the viewport bottom, and the map would no longer end exactly
    // at the viewport edge.
    expect(tokens).toContain("md:flex-1");
    expect(tokens).toContain("md:min-h-0");
    // The height chain itself lives on the shell root, not here.
    expect(tokens).not.toContain("min-h-dvh");
  });

  it("exposes exactly one skip-link target, owned by the shared shell", async () => {
    const { container } = await renderLoaded();
    const targets = container.querySelectorAll("#main-content");
    expect(targets).toHaveLength(1);
    expect(targets[0].tagName).toBe("MAIN");
    // Focusable so the skip link can move focus into it.
    expect(targets[0].getAttribute("tabindex")).toBe("-1");
    // And exactly one <main> in the document.
    expect(container.querySelectorAll("main")).toHaveLength(1);
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

  it("sizes the map wrapper via the dedicated .map-pane class (definite mobile height, flex fill at md+)", async () => {
    await renderLoaded();
    const wrapper = screen.getByTestId("map-container").parentElement;
    const tokens = classes(wrapper);
    // A single dedicated class owns the responsive sizing (globals.css): a definite
    // 60vh/60dvh with a minimum on mobile so the MapLibre child (h-full) never
    // collapses, and `height:100% / flex:1 1 0%` at md+ so it fills the full row —
    // no broadly-scoped @supports rule can force the mobile 60dvh onto the desktop
    // map (the old ambiguous `h-[60vh] h-[60dvh] md:h-auto md:min-h-0 md:flex-1`
    // stack is replaced). Actual pixel behaviour is asserted in e2e/responsive.spec.ts.
    expect(tokens).toContain("map-pane");
    // min-w-0 keeps the flex child shrinkable so long content never overflows.
    expect(tokens).toContain("min-w-0");
    // The ambiguous height utilities that previously forced 60dvh at desktop are gone.
    expect(tokens).not.toContain("h-[60dvh]");
    expect(tokens).not.toContain("md:h-auto");
    expect(tokens).not.toContain("md:flex-1");
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
    // The legend has moved out of the sidebar to a floating map overlay, so the
    // remaining sidebar disclosures are sources & method and facility layer.
    expect(details.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("출처와 계산 방법")).toBeDefined();
    expect(screen.getByText("시설 위치 표시")).toBeDefined();
    // The facility toggle still lives inside the DOM (never permanently hidden),
    // so desktop CSS can force it open and screen readers can reach it.
    expect(screen.getByTestId("facilities-toggle")).toBeDefined();
  });

  it("renders the equity legend as a single floating overlay, not in the sidebar", async () => {
    const { container } = await renderLoaded();
    // The legend is now a floating <details> over the map (its own class), and there
    // is exactly one legend section (single source of truth — no sidebar duplicate).
    const floating = container.querySelectorAll("details.map-legend");
    expect(floating.length).toBe(1);
    expect(screen.getByTestId("legend")).toBeDefined();
    // Its collapse control is labelled text ("범례 (Legend)"), not icon-only.
    expect(screen.getByTestId("map-legend-summary").textContent).toContain("범례 (Legend)");
    // The legend is NOT one of the sidebar mobile-collapsible disclosures.
    const sidebarLegend = container.querySelector(
      "details.mobile-collapsible [data-testid='legend']",
    );
    expect(sidebarLegend).toBeNull();
  });

  it("uses flex-wrap on the mode switcher so it never overflows narrow widths", async () => {
    const { container } = await renderLoaded();
    const group = container.querySelector('[data-testid="mode-switch"]');
    expect(classes(group)).toContain("flex-wrap");
  });
});
