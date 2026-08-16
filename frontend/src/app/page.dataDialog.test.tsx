// @vitest-environment jsdom

/**
 * 데이터·출처 as a dialog (Phase 5C, spec §8).
 *
 * The contracts that matter here are the ones a reader would notice if they
 * broke: the legacy deep link still lands somewhere sensible, closing returns to
 * where they were rather than dumping them on a default page, and the dialog is
 * operable and escapable from the keyboard.
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
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

async function renderLoaded() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  return utils;
}

const dialog = () => screen.getByTestId("data-sources-dialog");

describe("opening from the navigation", () => {
  it("opens a modal dialog rather than navigating to a page", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());

    expect(dialog().getAttribute("role")).toBe("dialog");
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    // The accessible name is the same string the reader sees.
    const labelledBy = dialog().getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelledBy)?.textContent).toBe("데이터·출처");
    // The nav still marks the destination active.
    expect(screen.getByTestId("mode-transparency").getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the previous destination rendered underneath", async () => {
    const { container } = await renderLoaded();
    // 지역 지표's map is up before opening…
    const mapNode = screen.getByTestId("map-container");
    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());
    // …and is the SAME node behind the dialog, not a remount.
    expect(screen.getByTestId("map-container")).toBe(mapNode);
    // The page keeps exactly one h1 — the dialog's title is an h2.
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(within(dialog()).queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("carries the full source catalogue inside the dialog", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());
    // The existing dashboard is reused wholesale, not reimplemented.
    expect(within(dialog()).getByTestId("transparency-dashboard")).toBeDefined();
  });
});

describe("the legacy transparency URL", () => {
  it("still opens the dialog from ?v=1&mode=transparency", async () => {
    window.history.replaceState(null, "", "/?v=1&mode=transparency");
    await renderLoaded();
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());
    expect(screen.getByTestId("mode-transparency").getAttribute("aria-pressed")).toBe("true");
  });

  it("puts a real destination behind a cold deep link, not a blank frame", async () => {
    window.history.replaceState(null, "", "/?v=1&mode=transparency");
    await renderLoaded();
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());
    // Defaults to 지역 지표 when there is no prior area to return to.
    expect(screen.getByTestId("map-container")).toBeDefined();

    fireEvent.click(screen.getByTestId("data-sources-dialog-close"));
    await waitFor(() => expect(screen.queryByTestId("data-sources-dialog")).toBeNull());
    expect(screen.getByTestId("mode-equity").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("closing returns to the prior destination", () => {
  it("returns to 지역별 폐기물 처리 현황 when that is where the reader was", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());

    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());
    // The landfill dashboard is still behind it.
    expect(screen.getByTestId("landfill-dashboard")).toBeDefined();

    fireEvent.click(screen.getByTestId("data-sources-dialog-close"));
    await waitFor(() => expect(screen.queryByTestId("data-sources-dialog")).toBeNull());
    expect(screen.getByTestId("mode-flow").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("landfill-dashboard")).toBeDefined();
  });

  it("returns to the exact suitability SUB-VIEW, not just the area", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("suitability-view-cost"));
    await waitFor(() => expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined());

    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());
    fireEvent.click(screen.getByTestId("data-sources-dialog-close"));
    await waitFor(() => expect(screen.queryByTestId("data-sources-dialog")).toBeNull());

    // 후보지 분석 (cost), not 후보지 심층 분석 (score).
    expect(screen.getByTestId("suitability-view-cost").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("facility-cost-dashboard")).toBeDefined();
  });

  it("never loops: reopening and closing repeatedly stays stable", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());

    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByTestId("mode-transparency"));
      await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());
      fireEvent.click(screen.getByTestId("data-sources-dialog-close"));
      await waitFor(() => expect(screen.queryByTestId("data-sources-dialog")).toBeNull());
      // Always back to flow — the dialog can never become its own "prior area".
      expect(screen.getByTestId("mode-flow").getAttribute("aria-pressed"), `round ${i}`).toBe(
        "true",
      );
    }
  });
});

describe("keyboard and focus", () => {
  it("moves focus into the dialog when it opens", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());
    // The panel itself, so a screen reader announces the dialog before a control.
    expect(document.activeElement).toBe(dialog());
  });

  it("closes on Escape", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("data-sources-dialog")).toBeNull());
    expect(screen.getByTestId("mode-equity").getAttribute("aria-pressed")).toBe("true");
  });

  it("restores focus to the control that opened it", async () => {
    await renderLoaded();
    const trigger = screen.getByTestId("mode-transparency");
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("data-sources-dialog")).toBeNull());
    // Back on the nav button, not stranded on <body>.
    expect(document.activeElement).toBe(screen.getByTestId("mode-transparency"));
  });

  it("closes from the footer 닫기 button at the end of the long body", async () => {
    // Figma frame 156:470 ends the modal with a closing note and a primary 닫기.
    // Without it, a reader who has scrolled to the bottom of a long catalogue has
    // to scroll all the way back up to reach the ✕.
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-flow"));
    await waitFor(() => expect(screen.getByTestId("landfill-dashboard")).toBeDefined());
    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());

    const footerClose = within(dialog()).getByTestId("transparency-close");
    expect(footerClose.tagName).toBe("BUTTON");
    expect(footerClose.textContent).toBe("닫기");
    // It states the preservation rule the source cards implement.
    expect(dialog().textContent).toContain("등록된 원문 이름과 식별자는 삭제하지 않고");

    fireEvent.click(footerClose);
    await waitFor(() => expect(screen.queryByTestId("data-sources-dialog")).toBeNull());
    // The same return-to-prior-destination behaviour as the ✕, not a default page.
    expect(screen.getByTestId("mode-flow").getAttribute("aria-pressed")).toBe("true");
  });

  it("states the screen's purpose exactly once, not twice", async () => {
    // The dialog head already carries a title and a supporting line. The embedded
    // dashboard used to add HEADER_SUMMARY underneath, so the reader met two
    // consecutive descriptions of the same screen before any content.
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());
    expect(dialog().textContent).not.toContain(
      "이 서비스가 사용하는 공식 자료와 제공 기관, 자료의 기준 기간",
    );
    // Exactly one heading names the dialog, and it is still an h2.
    expect(within(dialog()).getAllByRole("heading", { level: 2 })[0].textContent).toBe(
      "데이터·출처",
    );
  });

  it("offers an explicit, named close control", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());
    const close = screen.getByTestId("data-sources-dialog-close");
    expect(close.tagName).toBe("BUTTON");
    // Icon-only, so the accessible name has to come from the label.
    expect(close.getAttribute("aria-label")).toContain("데이터·출처");
  });

  it("scrolls the dialog body, not the page behind it", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-transparency"));
    await waitFor(() => expect(screen.getByTestId("data-sources-dialog")).toBeDefined());
    expect(screen.getByTestId("data-sources-dialog-body")).toBeDefined();
    // The page behind must not scroll while a modal is up.
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByTestId("data-sources-dialog-close"));
    await waitFor(() => expect(screen.queryByTestId("data-sources-dialog")).toBeNull());
    // …and it is given back afterwards.
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
