// @vitest-environment jsdom

/**
 * ResizableSidebar — the 300 / 360 / 520 desktop width contract (spec §3).
 *
 * Pointer dragging is deliberately NOT tested here: jsdom has no
 * `setPointerCapture` and no layout, so a synthetic drag would assert against a
 * stub rather than against the behaviour. It is covered in
 * `e2e/responsive.spec.ts`, where a real browser reports real geometry.
 *
 * What IS pinned here is everything a real browser cannot easily show: the
 * clamping arithmetic, every corrupted-storage path, the keyboard contract, and
 * the fact that the desktop width is published as a custom property the phone
 * layout never reads.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ResizableSidebar, {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_KEY_STEP,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  readStoredSidebarWidth,
} from "./ResizableSidebar";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function renderSidebar() {
  const utils = render(
    <ResizableSidebar>
      <p>패널 내용</p>
    </ResizableSidebar>,
  );
  return { ...utils, resizer: screen.getByTestId("sidebar-resizer") };
}

/** The width the column is currently asking the stylesheet for. */
function currentWidth(): string | undefined {
  return screen.getByTestId("equity-sidebar").style.getPropertyValue("--wep-sidebar-width");
}

describe("the approved bounds", () => {
  it("uses 300 / 360 / 520", () => {
    expect([SIDEBAR_MIN_WIDTH, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH]).toEqual([300, 360, 520]);
  });

  it("clamps to the range and rounds to whole pixels", () => {
    expect(clampSidebarWidth(120)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(400.4)).toBe(400);
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("falls back to the DEFAULT — not a bound — for a nonsense number", () => {
    // 300 or 520 would be a silent claim that the reader once chose an extreme.
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});

describe("reading the stored preference", () => {
  it("returns a valid stored width", () => {
    expect(readStoredSidebarWidth({ getItem: () => "420" })).toBe(420);
  });

  it("clamps an out-of-range stored width instead of trusting it", () => {
    expect(readStoredSidebarWidth({ getItem: () => "40" })).toBe(SIDEBAR_MIN_WIDTH);
    expect(readStoredSidebarWidth({ getItem: () => "4000" })).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("defaults for every invalid or absent value", () => {
    for (const raw of [null, "", "   ", "abc", "NaN", "{}", "360px"]) {
      expect(readStoredSidebarWidth({ getItem: () => raw }), JSON.stringify(raw)).toBe(
        SIDEBAR_DEFAULT_WIDTH,
      );
    }
    expect(readStoredSidebarWidth(null)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it("defaults when storage itself throws (private mode, disabled storage)", () => {
    expect(
      readStoredSidebarWidth({
        getItem: () => {
          throw new Error("SecurityError");
        },
      }),
    ).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});

describe("mounting", () => {
  it("opens at the default when nothing is stored", () => {
    renderSidebar();
    expect(currentWidth()).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
  });

  it("restores a valid stored width", () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "480");
    renderSidebar();
    expect(currentWidth()).toBe("480px");
  });

  it("ignores a corrupted stored width and opens at the default", () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "not-a-width");
    renderSidebar();
    expect(currentWidth()).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
  });

  it("clamps a stored width that is outside the range", () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "2000");
    renderSidebar();
    expect(currentWidth()).toBe(`${SIDEBAR_MAX_WIDTH}px`);
  });
});

describe("the width never leaks into the phone layout", () => {
  it("publishes a custom property rather than an inline width", () => {
    renderSidebar();
    const aside = screen.getByTestId("equity-sidebar");
    // An inline `width` would beat every media query and pin the phone column to
    // the desktop size. The property is only READ inside the md+ block in
    // globals.css, so below 768px it is inert.
    expect(aside.style.width).toBe("");
    expect(aside.style.getPropertyValue("--wep-sidebar-width")).toBe(
      `${SIDEBAR_DEFAULT_WIDTH}px`,
    );
    // The class that consumes it, and the mobile full-width default.
    const tokens = (aside.getAttribute("class") ?? "").split(/\s+/);
    expect(tokens).toContain("wep-sidebar");
    expect(tokens).toContain("w-full");
    expect(tokens).toContain("md:flex-none");
    // The old fixed desktop width is gone.
    expect(tokens).not.toContain("md:w-96");
    expect(tokens).not.toContain("w-96");
  });

  it("marks the handle with the class that hides it below md", () => {
    const { resizer } = renderSidebar();
    // `.wep-sidebar-resizer` is `display: none` until 768px, so a phone has no
    // handle and receives no pointer handlers at all.
    expect(resizer.className).toContain("wep-sidebar-resizer");
  });
});

describe("separator semantics", () => {
  it("is a focusable vertical separator that reports its current width", () => {
    const { resizer } = renderSidebar();
    expect(resizer.getAttribute("role")).toBe("separator");
    expect(resizer.getAttribute("aria-orientation")).toBe("vertical");
    expect(resizer.getAttribute("tabindex")).toBe("0");
    expect(resizer.getAttribute("aria-label")).toBeTruthy();
    expect(resizer.getAttribute("aria-valuemin")).toBe(String(SIDEBAR_MIN_WIDTH));
    expect(resizer.getAttribute("aria-valuemax")).toBe(String(SIDEBAR_MAX_WIDTH));
    expect(resizer.getAttribute("aria-valuenow")).toBe(String(SIDEBAR_DEFAULT_WIDTH));
  });

  it("keeps aria-valuenow in step with the actual width", () => {
    const { resizer } = renderSidebar();
    fireEvent.keyDown(resizer, { key: "End" });
    expect(resizer.getAttribute("aria-valuenow")).toBe(String(SIDEBAR_MAX_WIDTH));
    expect(currentWidth()).toBe(`${SIDEBAR_MAX_WIDTH}px`);
  });
});

describe("keyboard resizing", () => {
  it("nudges left and right by one step", () => {
    const { resizer } = renderSidebar();
    fireEvent.keyDown(resizer, { key: "ArrowRight" });
    expect(currentWidth()).toBe(`${SIDEBAR_DEFAULT_WIDTH + SIDEBAR_KEY_STEP}px`);
    fireEvent.keyDown(resizer, { key: "ArrowLeft" });
    fireEvent.keyDown(resizer, { key: "ArrowLeft" });
    expect(currentWidth()).toBe(`${SIDEBAR_DEFAULT_WIDTH - SIDEBAR_KEY_STEP}px`);
  });

  it("jumps to the minimum with Home and the maximum with End", () => {
    const { resizer } = renderSidebar();
    fireEvent.keyDown(resizer, { key: "Home" });
    expect(currentWidth()).toBe(`${SIDEBAR_MIN_WIDTH}px`);
    fireEvent.keyDown(resizer, { key: "End" });
    expect(currentWidth()).toBe(`${SIDEBAR_MAX_WIDTH}px`);
  });

  it("cannot be driven past either bound", () => {
    const { resizer } = renderSidebar();
    fireEvent.keyDown(resizer, { key: "Home" });
    for (let i = 0; i < 5; i += 1) fireEvent.keyDown(resizer, { key: "ArrowLeft" });
    expect(currentWidth()).toBe(`${SIDEBAR_MIN_WIDTH}px`);

    fireEvent.keyDown(resizer, { key: "End" });
    for (let i = 0; i < 5; i += 1) fireEvent.keyDown(resizer, { key: "ArrowRight" });
    expect(currentWidth()).toBe(`${SIDEBAR_MAX_WIDTH}px`);
  });

  it("ignores keys it does not handle", () => {
    const { resizer } = renderSidebar();
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "a"]) {
      fireEvent.keyDown(resizer, { key });
    }
    expect(currentWidth()).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
  });

  it("prevents the column from scrolling instead of resizing", () => {
    const { resizer } = renderSidebar();
    // Without preventDefault, Home/End would jump the scroll container to its
    // top/bottom while the reader is trying to move the divider.
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      resizer.dispatchEvent(event);
      expect(event.defaultPrevented, key).toBe(true);
    }
  });
});

describe("double-click reset", () => {
  it("restores the 360px default from anywhere", () => {
    const { resizer } = renderSidebar();
    fireEvent.keyDown(resizer, { key: "End" });
    expect(currentWidth()).toBe(`${SIDEBAR_MAX_WIDTH}px`);

    fireEvent.doubleClick(resizer);
    expect(currentWidth()).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      String(SIDEBAR_DEFAULT_WIDTH),
    );
  });
});

describe("persistence", () => {
  it("writes each committed width, and only a valid one", () => {
    const { resizer } = renderSidebar();
    fireEvent.keyDown(resizer, { key: "ArrowRight" });
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      String(SIDEBAR_DEFAULT_WIDTH + SIDEBAR_KEY_STEP),
    );

    // A clamped value is stored clamped, so the store can never accumulate an
    // out-of-range number that a later visit would have to repair.
    fireEvent.keyDown(resizer, { key: "End" });
    fireEvent.keyDown(resizer, { key: "ArrowRight" });
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(SIDEBAR_MAX_WIDTH));
  });

  it("survives a remount", () => {
    const { resizer } = renderSidebar();
    fireEvent.keyDown(resizer, { key: "Home" });
    cleanup();

    renderSidebar();
    expect(currentWidth()).toBe(`${SIDEBAR_MIN_WIDTH}px`);
  });
});

describe("content", () => {
  it("renders its children inside the aside, not beside it", () => {
    renderSidebar();
    const aside = screen.getByTestId("equity-sidebar");
    expect(aside.tagName).toBe("ASIDE");
    expect(aside.textContent).toContain("패널 내용");
    // The handle is a SIBLING of the column, never inside its scroll container —
    // otherwise it would scroll away from the edge it is supposed to drag.
    expect(aside.contains(screen.getByTestId("sidebar-resizer"))).toBe(false);
  });
});
