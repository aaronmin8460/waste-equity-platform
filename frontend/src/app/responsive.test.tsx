// @vitest-environment jsdom

/**
 * Responsive-layout structure tests for the dashboard shell.
 *
 * jsdom does not compute CSS layout, so these assert the responsive contract at the
 * class/DOM level. The contract itself changed: 여기다 is desktop-required, so there
 * is now ONE layout — the desktop one — and a gate below 1024px, instead of a
 * mobile-first column that became a row at `md`. What is asserted here is that the
 * shell describes exactly that one layout, that the height chain the map depends on
 * is intact, and that the gate replaces (never merely hides) the dashboards.
 * Actual pixel behaviour at real viewports is verified by e2e/responsive.spec.ts.
 *
 * jsdom reports `window.innerWidth === 1024` and does not implement `matchMedia`, so
 * the default environment here is exactly the desktop floor — every test below
 * renders the real application, and only `narrowScreenGate.test.tsx`, which stubs
 * `matchMedia`, exercises the gate.
 *
 * The map (MapLibre/WebGL) is stubbed and the backend is mocked, exactly as the
 * mode-routing test does — this is about layout, not rendering or data.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("desktop application shell", () => {
  // The shell root (components/DashboardShell.tsx) is the fixed-height flex COLUMN
  // that holds the global navigation plus <main>, and <main> is the row that holds
  // the sidebar and the map. Both used to carry `md:`-prefixed variants in front of
  // a phone branch; the phone branch is gone with the desktop floor, so the classes
  // are unconditional.
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
    // A fixed viewport height (no unintended document scroll), dynamic-viewport so
    // browser chrome never crops the app.
    expect(tokens).toContain("h-screen");
    expect(tokens).toContain("h-dvh");
    // The dvh utility is preceded by its static-viewport fallback, so an engine
    // without `dvh` support keeps a valid full-viewport height instead of dropping
    // the declaration entirely (which would leave the column — and the map pane
    // inside it — with no definite height).
    // Ordering matters: the fallback must come BEFORE the dvh class so a
    // dvh-supporting engine applies dvh (later rule, equal specificity). This is
    // also what the `@supports` two-class override in globals.css keys on.
    expect(tokens.indexOf("h-screen")).toBeLessThan(tokens.indexOf("h-dvh"));
    // The `md:`-scoped height variants are gone: there is no second layout for them
    // to switch between, and leaving them would be a second source of truth.
    expect(tokens).not.toContain("md:h-screen");
    expect(tokens).not.toContain("md:h-dvh");
    // A fixed height, not a minimum — a `min-h` alone leaves the height indefinite
    // and the percentage-height map child collapses.
    expect(tokens).not.toContain("min-h-dvh");
  });

  it("lays <main> out as the full-height row that holds the sidebar and the map", async () => {
    const { container } = await renderLoaded();
    const main = container.querySelector("main");
    const tokens = classes(main);
    expect(tokens).toContain("flex");
    // A row at every width the app renders at. The `flex-col` + `md:flex-row` pair
    // that stacked the sidebar above the map on a phone is gone.
    expect(tokens).toContain("flex-row");
    expect(tokens).not.toContain("flex-col");
    expect(tokens).not.toContain("md:flex-row");
    // <main> fills the shell column's remaining height. `min-h-0` is load-bearing:
    // without it the default `min-height: auto` would let the content push the row
    // past the viewport bottom, and the map would no longer end exactly at the
    // viewport edge.
    expect(tokens).toContain("flex-1");
    expect(tokens).toContain("min-h-0");
    // The height chain itself lives on the shell root, not here.
    expect(tokens).not.toContain("min-h-dvh");
    expect(tokens).not.toContain("h-dvh");
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

  it("renders the sidebar as the resizable desktop column", async () => {
    const { container } = await renderLoaded();
    const aside = container.querySelector("aside");
    const tokens = classes(aside);
    // The fixed 384px desktop column is gone: the width is reader-controlled
    // (300–520, default 360) and carried by `.wep-sidebar` reading the custom
    // property below — see components/ui/ResizableSidebar.tsx and spec §3.
    expect(tokens).toContain("wep-sidebar");
    expect(tokens).not.toContain("md:w-96");
    expect(tokens).not.toContain("w-96");
    // The width must be a custom property, never an inline `width`, or it would
    // beat the stylesheet and pin the column to one size.
    expect((aside as HTMLElement).style.width).toBe("");
    expect((aside as HTMLElement).style.getPropertyValue("--wep-sidebar-width")).toBe("360px");
  });

  it("always offers the resize handle (there is no width at which it is hidden)", async () => {
    await renderLoaded();
    // `.wep-sidebar-resizer` used to be `display: none` until 768px so a phone got no
    // handle. With no phone layout the rule is unconditional (globals.css). jsdom
    // loads no stylesheet, so the contract asserted here is the class that owns it.
    const resizer = screen.getByTestId("sidebar-resizer");
    expect(resizer.className).toContain("wep-sidebar-resizer");
    expect(resizer.getAttribute("role")).toBe("separator");
  });

  it("sizes the map wrapper via the dedicated .map-pane class, with no viewport-relative height", async () => {
    await renderLoaded();
    const wrapper = screen.getByTestId("map-container").parentElement;
    const tokens = classes(wrapper);
    // A single dedicated class owns the sizing (globals.css): `height: 100%` of the
    // fixed-height shell row plus `flex: 1 1 0%`, so the pane fills both the
    // remaining width and the full row height and nothing is left below the canvas.
    expect(tokens).toContain("map-pane");
    // min-w-0 keeps the flex child shrinkable so long content never overflows.
    expect(tokens).toContain("min-w-0");
    // Neither retired height may come back as a utility: the ambiguous stack that
    // forced 60dvh at desktop, nor the mobile 60vh the class itself used to carry.
    expect(tokens).not.toContain("h-[60dvh]");
    expect(tokens).not.toContain("h-[60vh]");
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

describe("disclosures on the desktop-only shell", () => {
  it("keeps the verbose equity panels as native <details> beside what they explain", async () => {
    const { container } = await renderLoaded();
    // Phase 1 moved both of the sidebar's disclosures to where their subject is:
    // 출처와 계산 방법 into the 선택한 지역 card whose value it justifies, and the
    // facility layer control onto the map beside its own markers (Figma frames
    // 220:439 and 222:439). They are still native <details>, so the browser supplies
    // the toggling, the focus ring, and the expanded state — but they are no longer
    // the sidebar-wide `.mobile-collapsible` wrapper, which now has no consumer.
    expect(container.querySelectorAll("details.mobile-collapsible")).toHaveLength(0);
    const sources = screen.getByTestId("equity-method-sources");
    expect(sources.tagName).toBe("DETAILS");
    expect(within(sources).getByText("출처와 계산 방법")).toBeDefined();
    // The facility toggle still lives inside the DOM (never permanently hidden) and
    // is directly visible rather than behind a disclosure.
    expect(screen.getByTestId("facilities-toggle")).toBeDefined();
    expect(screen.getByTestId("facility-type-legend")).toBeDefined();
  });

  it("renders the equity legend as a single always-open floating overlay", async () => {
    const { container } = await renderLoaded();
    // The legend is a floating <details> over the map (its own class), and there is
    // exactly one legend section (single source of truth — no sidebar duplicate).
    // `.map-legend` is now force-open at every width: its collapsed-on-mobile branch
    // existed only for the stacked phone map, which no longer renders.
    const floating = container.querySelectorAll("details.map-legend");
    expect(floating.length).toBe(1);
    expect(screen.getByTestId("legend")).toBeDefined();
    // Its summary is still labelled text ("범례"), not icon-only — the element stays
    // in the DOM and is hidden by CSS, so nothing about the markup contract changed.
    expect(screen.getByTestId("map-legend-summary").textContent).toContain("범례");
    expect(screen.getByTestId("map-legend-summary").textContent).not.toContain("(Legend)");
    // The legend is NOT one of the sidebar mobile-collapsible disclosures.
    const sidebarLegend = container.querySelector(
      "details.mobile-collapsible [data-testid='legend']",
    );
    expect(sidebarLegend).toBeNull();
  });

  it("keeps the six-destination nav on one unwrapped row", async () => {
    const { container } = await renderLoaded();
    const group = container.querySelector('[data-testid="mode-switch"]');
    // Six Korean destination labels cannot wrap gracefully, and one unwrapped row is
    // a desktop invariant from the 1024 floor up. `.wep-nav-track` owns that
    // (`flex-wrap` is never set on it; `overflow-x: auto` + `min-width: 0` in
    // globals.css contain any overflow inside the nav rather than on the page).
    // jsdom never loads that stylesheet, so the contract asserted here is that the
    // track still carries the class that owns the behaviour — and that nothing
    // re-introduced `flex-wrap`, which would put the nav on two rows at 1024px.
    expect(classes(group)).toContain("wep-nav-track");
    expect(classes(group)).not.toContain("flex-wrap");
    // All six destinations are present and reachable.
    expect(group?.querySelectorAll("button")).toHaveLength(6);
  });
});
