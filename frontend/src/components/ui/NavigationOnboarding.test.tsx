// @vitest-environment jsdom

/**
 * NavigationOnboarding — the first-visit guide's contract.
 *
 * Two properties carry the whole component and both are easy to lose in a refactor,
 * so both are pinned here rather than left to a visual check:
 *
 *   1. It is placed from LIVE DOM GEOMETRY. Every test below stubs
 *      `getBoundingClientRect` and asserts the rendered inline styles change with it.
 *      A hard-coded 1440px layout would pass a screenshot at one width and be wrong
 *      at every other, which is exactly what the Figma request forbids.
 *   2. It only appears when it should. Three separate gates — desktop confirmed by
 *      `matchMedia`, working storage, no prior dismissal — and each one is asserted
 *      on its own, because a modal that opens when it should not is far worse than
 *      one that stays shut.
 *
 * jsdom implements neither `matchMedia` nor `ResizeObserver` and reports every box as
 * 0×0, so each test installs exactly the environment it is about. That is also why
 * the overlay is invisible to the rest of the jsdom suite: without a positive
 * `matchMedia` answer it never opens, so no other test has a dialog dropped on it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NAV_DESTINATIONS } from "../../lib/glossary";
import NavigationOnboarding, {
  NAV_ONBOARDING_STORAGE_KEY,
  measureNavigation,
  shouldOfferNavOnboarding,
} from "./NavigationOnboarding";
import TopNavigation from "./TopNavigation";

/** Install a `matchMedia` that answers `matches` for every query. */
function stubMatchMedia(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function removeMatchMedia(): void {
  Reflect.deleteProperty(window, "matchMedia");
}

/**
 * Give the nav track and its six buttons real boxes.
 *
 * jsdom computes no layout, so the component would otherwise measure 0×0 and skip
 * the spotlight. Stubbing the ONE method the component calls is what makes "reads
 * the DOM" a testable claim: change the numbers here and the rendered styles move.
 */
interface StubRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function stubNavGeometry(track: StubRect, buttonWidth: number): void {
  const trackEl = screen.getByTestId("mode-switch");
  trackEl.getBoundingClientRect = () => asDomRect(track);
  const buttons = trackEl.querySelectorAll<HTMLElement>("button[data-destination]");
  buttons.forEach((button, index) => {
    // The six tabs laid out inside the track: 6px of track padding, then a 2px gap
    // between tabs — the shape `.wep-nav-track` actually produces.
    const rect: StubRect = {
      top: track.top + 6,
      left: track.left + 6 + index * (buttonWidth + 2),
      width: buttonWidth,
      height: track.height - 12,
    };
    button.getBoundingClientRect = () => asDomRect(rect);
  });
}

function asDomRect({ top, left, width, height }: StubRect): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Render the real navigation plus the overlay, exactly as the shell does. */
function renderShell() {
  return render(
    <>
      <TopNavigation active={NAV_DESTINATIONS[0]} onNavigate={() => {}} />
      <NavigationOnboarding />
    </>,
  );
}

/** Numeric value of an inline pixel style, e.g. "618px" -> 618. */
function px(element: Element, property: "top" | "left" | "width" | "height"): number {
  return Number.parseFloat((element as HTMLElement).style[property]);
}

beforeEach(() => {
  window.localStorage.clear();
  stubMatchMedia(true);
});

afterEach(() => {
  cleanup();
  removeMatchMedia();
  window.localStorage.clear();
});

describe("when the guide is offered at all", () => {
  it("opens on a first visit at a confirmed desktop viewport", () => {
    renderShell();
    expect(screen.getByTestId("nav-onboarding-card")).toBeDefined();
  });

  it("stays shut on every visit after the first", () => {
    window.localStorage.setItem(NAV_ONBOARDING_STORAGE_KEY, "1");
    renderShell();
    expect(screen.queryByTestId("nav-onboarding")).toBeNull();
  });

  it("stays shut below the desktop floor", () => {
    stubMatchMedia(false);
    renderShell();
    expect(screen.queryByTestId("nav-onboarding")).toBeNull();
  });

  it("stays shut when the viewport cannot be positively confirmed", () => {
    // No `matchMedia` at all. The overlay is a progressive enhancement and never
    // guesses — this is also what keeps it out of every other jsdom suite.
    removeMatchMedia();
    renderShell();
    expect(screen.queryByTestId("nav-onboarding")).toBeNull();
  });

  it("stays shut when storage cannot remember the dismissal", () => {
    // Private-browsing modes read fine and throw on write. A guide that cannot be
    // remembered would reappear on every page load, which is worse than never
    // appearing, so the write is PROBED before anything is shown.
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });
    renderShell();
    expect(screen.queryByTestId("nav-onboarding")).toBeNull();
    setItem.mockRestore();
  });

  it("leaves no probe value behind when it decides to open", () => {
    renderShell();
    // The write probe must not itself count as "already seen" — the reader would
    // get exactly one silent visit and never the guide.
    expect(window.localStorage.getItem(NAV_ONBOARDING_STORAGE_KEY)).toBeNull();
  });

  it("reads the decision from the window it is given, without a DOM", () => {
    expect(shouldOfferNavOnboarding(undefined)).toBe(false);
    expect(shouldOfferNavOnboarding(window)).toBe(true);
  });
});

describe("everything is positioned from the live navigation", () => {
  it("sizes the spotlight from the measured track, not from a constant", () => {
    renderShell();
    stubNavGeometry({ left: 502, top: 14, width: 910, height: 50 }, 118);
    // A resize is the component's cue to re-measure; the stub above only takes
    // effect once it does.
    fireEvent(window, new Event("resize"));

    const scrim = screen.getByTestId("nav-onboarding-scrim");
    // 6px of breathing room on every side of the measured box.
    expect(px(scrim, "left")).toBe(502 - 6);
    expect(px(scrim, "top")).toBe(14 - 6);
    expect(px(scrim, "width")).toBe(910 + 12);
    expect(px(scrim, "height")).toBe(50 + 12);
  });

  it("moves with the navigation when the bar changes size", () => {
    renderShell();
    stubNavGeometry({ left: 502, top: 14, width: 910, height: 50 }, 118);
    fireEvent(window, new Event("resize"));
    const wide = px(screen.getByTestId("nav-onboarding-scrim"), "left");

    // The compact metrics the bar uses below 1280 put the track somewhere else
    // entirely. Nothing about the overlay may be pinned to the 1440 canvas.
    stubNavGeometry({ left: 300, top: 10, width: 700, height: 44 }, 90);
    fireEvent(window, new Event("resize"));
    const narrow = px(screen.getByTestId("nav-onboarding-scrim"), "left");

    expect(wide).toBe(496);
    expect(narrow).toBe(294);
  });

  it("marks each of the six REAL buttons at that button's own box", () => {
    renderShell();
    stubNavGeometry({ left: 502, top: 14, width: 910, height: 50 }, 118);
    fireEvent(window, new Event("resize"));

    const markers = screen.getAllByTestId("nav-onboarding-marker");
    expect(markers).toHaveLength(NAV_DESTINATIONS.length);
    // Each marker names the destination it covers and sits on its measured box.
    markers.forEach((marker, index) => {
      expect(marker.getAttribute("data-destination")).toBe(NAV_DESTINATIONS[index].key);
      expect(px(marker, "left")).toBe(502 + 6 + index * 120);
      expect(px(marker, "width")).toBe(118);
    });
    // The markers are numbered 1..6, the same numbers the card's list carries.
    expect(markers.map((m) => m.textContent)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("hangs the pointer and the card off the bottom of the measured track", () => {
    renderShell();
    stubNavGeometry({ left: 502, top: 14, width: 910, height: 50 }, 118);
    fireEvent(window, new Event("resize"));

    const pointer = screen.getByTestId("nav-onboarding-pointer");
    // Below the track (14 + 50), centred on it (502 + 910/2).
    expect(px(pointer, "top")).toBe(64 + 22);
    expect(px(pointer, "left")).toBe(957);

    const card = screen.getByTestId("nav-onboarding-card");
    expect(px(card, "top")).toBe(64 + 42);
  });

  it("keeps the card inside the viewport when the nav sits near an edge", () => {
    renderShell();
    // A track hard against the right edge would centre a 380px card off-screen.
    stubNavGeometry({ left: 900, top: 14, width: 120, height: 50 }, 18);
    fireEvent(window, new Event("resize"));

    const card = screen.getByTestId("nav-onboarding-card");
    // jsdom's window is 1024 wide: 1024 - 380 - 16.
    expect(px(card, "left")).toBe(628);
    expect(px(card, "left") + 380).toBeLessThanOrEqual(window.innerWidth);
  });

  it("still shows a scrim and a card when the navigation cannot be measured", () => {
    // Every box is 0×0 (jsdom's default). There is nothing to ring, but the reader
    // must still get an unambiguous modal rather than a card over a live app.
    renderShell();
    expect(measureNavigation(document)).toBeNull();
    expect(screen.getByTestId("nav-onboarding-card")).toBeDefined();
    expect(screen.getByTestId("nav-onboarding-scrim").className).toContain(
      "wep-nav-onboarding-spotlight--flat",
    );
    expect(screen.queryAllByTestId("nav-onboarding-marker")).toHaveLength(0);
  });
});

describe("dismissal", () => {
  it("closes on Space, as the written request asks", () => {
    renderShell();
    fireEvent.keyDown(document, { key: " " });
    expect(screen.queryByTestId("nav-onboarding")).toBeNull();
    expect(window.localStorage.getItem(NAV_ONBOARDING_STORAGE_KEY)).toBe("1");
  });

  it("closes on Escape too", () => {
    renderShell();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("nav-onboarding")).toBeNull();
    expect(window.localStorage.getItem(NAV_ONBOARDING_STORAGE_KEY)).toBe("1");
  });

  it("closes from a VISIBLE affordance, not only from the keyboard", () => {
    renderShell();
    const close = screen.getByTestId("nav-onboarding-close");
    // A labelled control, so it is announced as more than "button".
    expect(close.getAttribute("aria-label")).toBe("안내 닫기");
    fireEvent.click(close);
    expect(screen.queryByTestId("nav-onboarding")).toBeNull();
  });

  it("closes from the confirming button", () => {
    renderShell();
    fireEvent.click(screen.getByTestId("nav-onboarding-confirm"));
    expect(screen.queryByTestId("nav-onboarding")).toBeNull();
    expect(window.localStorage.getItem(NAV_ONBOARDING_STORAGE_KEY)).toBe("1");
  });

  it("closes on a click outside the card", () => {
    renderShell();
    fireEvent.click(screen.getByTestId("nav-onboarding"));
    expect(screen.queryByTestId("nav-onboarding")).toBeNull();
  });

  it("does not close on a click inside the card", () => {
    renderShell();
    fireEvent.click(screen.getByTestId("nav-onboarding-card"));
    expect(screen.getByTestId("nav-onboarding-card")).toBeDefined();
  });

  it("remembers the dismissal, so the next visit is uninterrupted", () => {
    const first = renderShell();
    fireEvent.keyDown(document, { key: " " });
    first.unmount();

    renderShell();
    expect(screen.queryByTestId("nav-onboarding")).toBeNull();
  });
});

describe("accessibility", () => {
  it("is a modal dialog named by its own visible title", () => {
    renderShell();
    const card = screen.getByTestId("nav-onboarding-card");
    expect(card.getAttribute("role")).toBe("dialog");
    expect(card.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(card.getAttribute("aria-labelledby")!);
    expect(title?.textContent).toBe("상단 메뉴 여섯 곳을 안내합니다");
    // The accessible name is the string the reader sees, not a second wording.
    expect(title?.tagName).toBe("H2");
  });

  it("renders no h1, so every view keeps exactly one", () => {
    const { container } = renderShell();
    expect(container.querySelectorAll("h1")).toHaveLength(0);
  });

  it("moves focus into the panel and gives it back on dismissal", () => {
    render(<TopNavigation active={NAV_DESTINATIONS[0]} onNavigate={() => {}} />);
    const opener = screen.getByTestId("mode-equity");
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const overlay = render(<NavigationOnboarding />);
    expect(document.activeElement).toBe(screen.getByTestId("nav-onboarding-card"));

    fireEvent.keyDown(document, { key: "Escape" });
    // Exactly where the reader was, not "somewhere sensible".
    expect(document.activeElement).toBe(opener);
    overlay.unmount();
  });

  it("contains Tab inside the panel", () => {
    renderShell();
    const card = screen.getByTestId("nav-onboarding-card");
    const close = screen.getByTestId("nav-onboarding-close");
    const confirm = screen.getByTestId("nav-onboarding-confirm");

    // From the panel itself, Tab lands on the first control…
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    // …and from the last control it wraps rather than escaping to the page behind.
    confirm.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    // Shift+Tab from the first control wraps backwards to the last.
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    expect(card.contains(document.activeElement)).toBe(true);
  });

  it("stops the page behind from scrolling, and restores it on dismissal", () => {
    renderShell();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.style.overflow).toBe("");
  });

  it("names the six destinations with the registry's own labels", () => {
    renderShell();
    const card = screen.getByTestId("nav-onboarding-card");
    for (const destination of NAV_DESTINATIONS) {
      // Read from lib/glossary, so a renamed destination renames itself here and
      // the guide can never teach a label the bar no longer shows.
      expect(card.textContent, destination.key).toContain(destination.label);
      expect(card.textContent, destination.key).toContain(destination.orientation);
    }
  });
});
