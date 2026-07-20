// @vitest-environment jsdom

/**
 * Report preview modal tests (Phase 7 — Phase 0 defects X7 and X8).
 *
 * The modal had NO component test before this file; `page.equity.test.tsx` only
 * opened and closed it. These cover the two defects this phase fixes and lock the
 * behaviour that must NOT change around them:
 *
 *   X7 — the panel was capped at `max-w-2xl` (672px) while holding 3- and 4-column
 *        tables. It is now `max-w-5xl` with a viewport-bounded height and a locally
 *        scrolling body.
 *   X8 — the amber disclaimer was the `switch` FALLBACK, so an unrecognised block
 *        kind silently rendered as a warning. Only a real `disclaimer` block is
 *        styled as one now.
 *
 * jsdom performs no layout, so the width/height CONTRACT is asserted here as the
 * classes that own it, and the real bounding boxes are asserted in a browser by
 * `e2e/phase7FinalRegression.spec.ts` (panel wider than the old cap, inside the
 * viewport, no page-level horizontal overflow). Neither test alone is sufficient.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import ReportPreview from "./ReportPreview";
import { MAP_EXCLUSION_NOTE, type ReportModel } from "../lib/report";

afterEach(cleanup);

/**
 * A model shaped like the real ones (`buildRankingReport` / `buildComparisonReport`):
 * a title, a two-column section, a multi-column table, a note and a disclaimer.
 * Values are synthetic and no assertion below claims any of them is correct.
 */
const MODEL: ReportModel = {
  blocks: [
    { kind: "title", text: "지역 부담 순위 보고서" },
    { kind: "subtitle", text: "인구" },
    {
      kind: "section",
      heading: "분석 조건",
      rows: [
        ["범위", "수도권 전체"],
        ["표시 개수", "10"],
      ],
    },
    {
      kind: "table",
      caption: "값이 높은 지역",
      headers: ["순위", "지역", "값"],
      rows: [
        ["1", "예시구 · 서울", "1,234"],
        ["2", "예시군 · 경기", "자료 없음"],
      ],
    },
    { kind: "note", text: "값이 없는 지역은 순위에서 제외했습니다." },
    { kind: "disclaimer", text: "이 결과는 공공자료를 이용한 1차 비교입니다." },
  ],
  generatedAt: "2026-07-20 23:00",
  mapExclusionNote: MAP_EXCLUSION_NOTE,
};

function open(onClose = vi.fn()) {
  render(<ReportPreview model={MODEL} filenameBase="테스트보고서" onClose={onClose} />);
  return { onClose, dialog: screen.getByRole("dialog") };
}

describe("ReportPreview — dialog semantics", () => {
  it("is a modal dialog named by the report title", () => {
    const { dialog } = open();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "report-title");
    // The accessible name resolves to real text, not a dangling id.
    expect(document.getElementById("report-title")?.textContent).toBe("지역 부담 순위 보고서");
  });

  it("moves focus into the dialog on open", () => {
    const { dialog } = open();
    expect(document.activeElement).toBe(dialog);
  });

  it("gives the close control a meaningful accessible name, not a bare glyph", () => {
    open();
    expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();
  });
});

describe("ReportPreview — X7 width and viewport containment", () => {
  it("no longer caps the panel at the narrow max-w-2xl", () => {
    const { dialog } = open();
    expect(dialog.className).not.toContain("max-w-2xl");
  });

  it("uses a materially wider desktop cap while staying viewport-relative", () => {
    const { dialog } = open();
    // Wider cap...
    expect(dialog.className).toContain("max-w-5xl");
    // ...but still `w-full` inside the overlay's padding, so the panel can never
    // exceed the viewport width and cannot push the page sideways.
    expect(dialog.className).toContain("w-full");
    expect(screen.getByTestId("report-preview").className).toContain("p-4");
  });

  it("bounds the panel height and scrolls the report body locally", () => {
    const { dialog } = open();
    // `.wep-modal-panel` owns max-height (vh fallback before dvh) in globals.css.
    expect(dialog.className).toContain("wep-modal-panel");
    expect(dialog.className).toContain("flex-col");
    const body = dialog.querySelector(".wep-print") as HTMLElement;
    expect(body.className).toContain("overflow-y-auto");
    // `min-h-0` is load-bearing: without it the content pushes the panel past its
    // max-height instead of scrolling inside it.
    expect(body.className).toContain("min-h-0");
  });

  it("keeps the overlay from chaining its scroll to the page behind", () => {
    open();
    expect(screen.getByTestId("report-preview").className).toContain("overscroll-contain");
  });
});

describe("ReportPreview — X8 block rendering", () => {
  it("styles ONLY a real disclaimer block as a warning", () => {
    const { dialog } = open();
    const warnings = dialog.querySelectorAll(".bg-amber-50");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].textContent).toBe("이 결과는 공공자료를 이용한 1차 비교입니다.");
  });

  it("does not render a note as a warning", () => {
    const { dialog } = open();
    // The note is present as plain text and is NOT inside the amber panel.
    expect(dialog.textContent).toContain("값이 없는 지역은 순위에서 제외했습니다.");
    const warning = dialog.querySelector(".bg-amber-50") as HTMLElement;
    expect(warning.textContent).not.toContain("순위에서 제외했습니다");
  });
});

describe("ReportPreview — content and export surface unchanged", () => {
  it("renders every block's text, in model order, with the table intact", () => {
    const { dialog } = open();
    const table = dialog.querySelector("table")!;
    expect(table.querySelector("caption")?.textContent).toBe("값이 높은 지역");
    expect([...table.querySelectorAll("th")].map((th) => th.textContent)).toEqual([
      "순위",
      "지역",
      "값",
    ]);
    // An unavailable cell keeps its served text — never a fabricated 0.
    expect(table.textContent).toContain("자료 없음");
    expect(table.textContent).not.toContain("0원");
  });

  it("keeps both export actions and the map-exclusion note", () => {
    const { dialog } = open();
    expect(screen.getByTestId("report-print")).toBeInTheDocument();
    expect(screen.getByTestId("report-png")).toBeInTheDocument();
    expect(dialog.textContent).toContain(MAP_EXCLUSION_NOTE);
    expect(dialog.textContent).toContain("2026-07-20 23:00");
  });

  it("keeps the printable region marked so print CSS can isolate it", () => {
    const { dialog } = open();
    expect(dialog.querySelector(".wep-print")).not.toBeNull();
    // The toolbar stays out of the printout.
    expect(dialog.querySelectorAll(".wep-no-print").length).toBeGreaterThan(0);
  });
});

describe("ReportPreview — close behaviour", () => {
  it("closes on Escape", () => {
    const { onClose } = open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the 닫기 button and on a backdrop click", () => {
    const onClose = vi.fn();
    open(onClose);
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("report-preview"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not close when the panel itself is clicked", () => {
    const { onClose, dialog } = open();
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });
});
