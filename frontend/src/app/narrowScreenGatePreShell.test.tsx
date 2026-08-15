// @vitest-environment jsdom

/**
 * The desktop floor on the branches that DO NOT pass through `DashboardShell`.
 *
 * `narrowScreenGate.test.tsx` covers the settled case: data has loaded, `Home`
 * renders a dashboard through `DashboardShell`, and the shell swaps in the gate below
 * the floor. But `Home` has two branches that return their own `<main>` BEFORE any
 * shell exists:
 *
 *   1. the cold-start skeleton (`data === null`), and
 *   2. the load-failure page (`error !== null`).
 *
 * Both mattered in practice rather than in theory. `page.tsx` fetches in an effect, so
 * `data` is null on the FIRST client render of EVERY visit — a phone therefore hit the
 * skeleton branch on every single load. That skeleton is an analytical composition (a
 * sidebar column stacked above a map pane, the `md:flex-row` phone stack this cleanup
 * retired), so without a floor on these branches the narrow-screen experience was
 * "brief phone dashboard, then the gate" — or, if the backend was down, an error page
 * that was never part of the narrow-screen contract at all.
 *
 * These tests pin the fix: below the floor the reader gets the gate CONSISTENTLY, on
 * every branch, regardless of fetch state. Above the floor both branches are untouched
 * — the skeleton and the error page must still work exactly as before, which the last
 * two cases assert so the guard cannot be "fixed" by deleting those branches.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MapViewStub() {
      return <div data-testid="map-container" />;
    },
}));

/**
 * The initial load is `Promise.all` over ten fetchers, and its outcome is what selects
 * the branch under test. Rather than stub all ten per case, this mock points every one
 * of them at a single controllable promise:
 *
 *   - never settled  → `data` stays null       → the cold-start skeleton branch
 *   - rejected       → `error` becomes non-null → the load-failure branch
 *
 * Nothing here is a data fixture: no case asserts on a value, only on WHICH branch
 * renders, so there is no synthetic public data in this file at all.
 */
const pending = { current: null as Promise<never> | null };

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  const load = () => pending.current ?? new Promise<never>(() => {});
  return new Proxy(actual, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      // Every `fetch*` entry point resolves through the controllable promise; the
      // module's non-fetch exports (`ApiError`, helpers) pass through untouched so the
      // component's own error handling is the real one.
      if (typeof property === "string" && property.startsWith("fetch")) return load;
      return value;
    },
  });
});

import Home from "./page";

function installMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  pending.current = null;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  // jsdom normally has no `matchMedia`, and the other suites rely on that absence to
  // land on the desktop branch. Restore it.
  Reflect.deleteProperty(window, "matchMedia");
});

describe("desktop floor on the pre-shell branches", () => {
  it("shows the gate instead of the cold-start skeleton below the floor", async () => {
    installMatchMedia(false);
    render(<Home />);

    await screen.findByTestId("narrow-screen-gate");

    // The regression this exists for: the loading branch is an analytical layout
    // preview. Below the floor none of it may render, not even for the moment before
    // the requests settle.
    expect(screen.queryByTestId("loading")).toBeNull();
    expect(screen.queryByTestId("loading-skeleton-sidebar")).toBeNull();
    expect(screen.queryByTestId("loading-skeleton-map")).toBeNull();
    expect(screen.queryByTestId("map-container")).toBeNull();
  });

  it("shows the gate instead of the load-failure page below the floor", async () => {
    pending.current = Promise.reject(new Error("backend unreachable"));
    installMatchMedia(false);
    render(<Home />);

    await screen.findByTestId("narrow-screen-gate");

    // A failed load must not replace the narrow-screen answer with an error page: the
    // reader on a phone cannot act on a backend error, and "use a wider screen" is
    // still the accurate and more useful statement.
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    expect(screen.queryByText("자료를 불러오지 못했습니다")).toBeNull();
  });

  it("still renders the cold-start skeleton at or above the floor", async () => {
    installMatchMedia(true);
    render(<Home />);

    // The guard must gate the branch, not delete it: on desktop the structured
    // skeleton is still what a visitor sees while the ten requests are in flight.
    await screen.findByTestId("loading");
    expect(screen.getByTestId("loading-skeleton-sidebar")).toBeDefined();
    expect(screen.getByTestId("loading-skeleton-map")).toBeDefined();
    expect(screen.queryByTestId("narrow-screen-gate")).toBeNull();
  });

  it("still renders the load-failure page at or above the floor", async () => {
    pending.current = Promise.reject(new Error("backend unreachable"));
    installMatchMedia(true);
    render(<Home />);

    // Same reasoning for the error branch: desktop keeps its actionable retry page.
    await screen.findByRole("alert");
    expect(screen.getByText("자료를 불러오지 못했습니다")).toBeDefined();
    expect(screen.queryByTestId("narrow-screen-gate")).toBeNull();
  });
});
