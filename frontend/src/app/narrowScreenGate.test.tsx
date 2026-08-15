// @vitest-environment jsdom

/**
 * The desktop floor: what the application does BELOW 1024px.
 *
 * This is the half of the responsive contract that `responsive.test.tsx` cannot
 * cover, because jsdom's default viewport (1024px, no `matchMedia`) is exactly the
 * desktop floor and every other test therefore renders the real dashboards. Here
 * `window.matchMedia` is stubbed so the shell takes its narrow branch, and the
 * assertions are the ones that make the gate a REPLACEMENT rather than a CSS hide:
 * no dashboard subtree, no map, no nav — and still a valid skip target and a single
 * <h1>.
 *
 * Widening back is asserted too, because the gate must not be a dead end: the shell
 * subscribes to the media query, so the dashboard returns without a reload.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
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
import { DESKTOP_MIN_WIDTH } from "../components/ui/NarrowScreenGate";

/**
 * A minimal `matchMedia` whose result the test controls.
 *
 * jsdom implements no media-query evaluation at all, so this stands in for it. It
 * records listeners so a width change can be delivered the way a real browser
 * delivers one — which is what proves the shell re-renders instead of latching the
 * value it read on mount.
 */
function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<() => void>();
  let matches = initialMatches;

  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener: (_: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: () => void) => {
      listeners.delete(listener);
    },
    // Legacy aliases, present so nothing that feature-detects them throws.
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => true,
    onchange: null,
  })) as unknown as typeof window.matchMedia;

  return {
    setMatches(next: boolean) {
      matches = next;
      act(() => {
        listeners.forEach((listener) => listener());
      });
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  // Put jsdom back the way it was: `matchMedia` is normally absent, and the other
  // suites depend on that (it is how they land on the desktop branch).
  Reflect.deleteProperty(window, "matchMedia");
});

describe("narrow-screen gate (below the desktop floor)", () => {
  it("replaces the analytical application instead of hiding it", async () => {
    installMatchMedia(false);
    render(<Home />);

    const gate = await screen.findByTestId("narrow-screen-gate");
    expect(gate).toBeDefined();

    // The dashboards are not merely invisible — they are not in the DOM at all, so
    // no MapView is mounted, no MapLibre canvas exists, and no WebGL context or tile
    // request is created on a device that cannot use them.
    expect(screen.queryByTestId("map-container")).toBeNull();
    expect(screen.queryByTestId("app-shell")).toBeNull();
    expect(screen.queryByTestId("top-navigation")).toBeNull();
    expect(screen.queryByTestId("mode-switch")).toBeNull();
    expect(screen.queryByTestId("legend")).toBeNull();
  });

  it("keeps the skip-link target and exactly one heading", async () => {
    installMatchMedia(false);
    const { container } = render(<Home />);
    await screen.findByTestId("narrow-screen-gate");

    // app/layout.tsx renders a permanent `href="#main-content"` skip link, so this
    // target must exist at EVERY width or the WCAG 2.4.1 bypass block breaks on
    // exactly the screens least able to absorb it.
    const targets = container.querySelectorAll("#main-content");
    expect(targets).toHaveLength(1);
    expect(targets[0].tagName).toBe("MAIN");
    expect(targets[0].getAttribute("tabindex")).toBe("-1");

    // One <h1>, the same rule every dashboard view follows.
    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
  });

  it("states the requirement in Korean, naming the width", async () => {
    installMatchMedia(false);
    render(<Home />);
    const gate = await screen.findByTestId("narrow-screen-gate");

    // Concise and citizen-facing: what to do, and the number that decides it. The
    // width is interpolated from the same constant the CSS and the shell read, so
    // the message cannot drift from the actual floor.
    expect(gate.textContent).toContain("넓은 화면에 최적화되어 있습니다");
    expect(gate.textContent).toContain(`${DESKTOP_MIN_WIDTH}px 이상의 데스크톱`);
    // 여기다 identity is retained, so the reader knows this is the product and not
    // an error page.
    expect(gate.textContent).toContain("여기다");
  });

  it("is not a dead end — widening past the floor restores the dashboard", async () => {
    const media = installMatchMedia(false);
    render(<Home />);
    await screen.findByTestId("narrow-screen-gate");

    media.setMatches(true);

    // The shell subscribes to the media query rather than reading it once on mount,
    // so the application returns without a reload. `app/page.tsx` owns the analytical
    // state and never unmounted, so mode, metric, and URL state are the same ones.
    await waitFor(() => expect(screen.getByTestId("app-shell")).toBeDefined());
    expect(screen.queryByTestId("narrow-screen-gate")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("map-container")).toBeDefined());
  });

  it("renders the application when the viewport is at or above the floor", async () => {
    installMatchMedia(true);
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("app-shell")).toBeDefined());
    expect(screen.queryByTestId("narrow-screen-gate")).toBeNull();
  });
});
