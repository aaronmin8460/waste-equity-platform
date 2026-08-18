// @vitest-environment jsdom

/**
 * Land-cover layer control + dynamic legend tests (Phase 1B-LC5B).
 *
 * Asserts the control surfaces exactly what the map is doing: the legend rows match
 * the active mode/level, official Korean names and codes are shown verbatim, the
 * `NO_COVERAGE` warning is present, an empty filter selection is reported rather than
 * silently reverted, and every control is a labelled, keyboard-operable native input.
 *
 * All class codes and names below are SYNTHETIC TEST FIXTURES shaped like the official
 * 세분류 vocabulary; they are not a copy of official data.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LAND_COVER_COVERAGE_COLORS,
  type LandCoverAvailableClasses,
  defaultCoverageVisibility,
  landCoverClassColor,
} from "../lib/landCoverLayer";
import LandCoverLayerControl, {
  LAND_COVER_LAYER_DISCLAIMER,
  LAND_COVER_LAYER_LABEL,
} from "./LandCoverLayerControl";

const CLASSES: LandCoverAvailableClasses = {
  1: [
    { code: "100", name: "시가화건조지역" },
    { code: "300", name: "산림지역" },
  ],
  2: [
    { code: "150", name: "교통지역" },
    { code: "310", name: "활엽수림" },
  ],
  3: [
    { code: "111", name: "주거지역" },
    { code: "154", name: "도로" },
    { code: "311", name: "활엽수림" },
  ],
};

function baseProps(overrides: Partial<React.ComponentProps<typeof LandCoverLayerControl>> = {}) {
  return {
    show: true,
    onToggleShow: vi.fn(),
    available: true,
    unavailableMessage: null,
    mode: "coverage" as const,
    onModeChange: vi.fn(),
    classLevel: 1 as const,
    onClassLevelChange: vi.fn(),
    coverage: defaultCoverageVisibility(),
    onToggleCoverage: vi.fn(),
    availableClasses: CLASSES,
    hiddenClassCodes: [] as readonly string[],
    onToggleClass: vi.fn(),
    onSetAllClasses: vi.fn(),
    statisticsVersionId: 1,
    ...overrides,
  };
}

/** Render with the <details> disclosure open, as a user reading the legend has it. */
function renderOpen(props: React.ComponentProps<typeof LandCoverLayerControl>) {
  const utils = render(<LandCoverLayerControl {...props} />);
  const details = screen.getByTestId("land-cover-layer-control") as HTMLDetailsElement;
  details.open = true;
  return utils;
}

afterEach(cleanup);

describe("LandCoverLayerControl basics", () => {
  it("labels the layer and its on/off checkbox", () => {
    renderOpen(baseProps());
    expect(screen.getByText(LAND_COVER_LAYER_LABEL)).toBeInTheDocument();
    const toggle = screen.getByTestId("land-cover-layer-toggle");
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute("type", "checkbox");
    expect(toggle.closest("label")).toHaveTextContent("지도에 토지피복 격자 통계 표시");
  });

  it("renders the layer toggle unchecked when the layer is off", () => {
    renderOpen(baseProps({ show: false }));
    expect(screen.getByTestId("land-cover-layer-toggle")).not.toBeChecked();
  });

  it("carries the public-operation + non-scoring disclosure and the pinned version", () => {
    renderOpen(baseProps());
    expect(screen.getByTestId("land-cover-layer-disclaimer")).toHaveTextContent(
      LAND_COVER_LAYER_DISCLAIMER,
    );
    // Phase 1B-LC8: publication rests on a PROJECT-level authorization, states the
    // raw-data non-redistribution, and keeps the scoring non-use sentence.
    expect(LAND_COVER_LAYER_DISCLAIMER).toContain("협력 정부기관");
    expect(LAND_COVER_LAYER_DISCLAIMER).toContain("원본 SHP 파일");
    expect(LAND_COVER_LAYER_DISCLAIMER).toContain("적합성 점수");
    // No EGIS licence confirmation or KOGL type may be asserted here.
    expect(LAND_COVER_LAYER_DISCLAIMER).not.toMatch(/KOGL|공공누리|제1유형|서면 승인/);
    expect(screen.getByTestId("land-cover-layer-version")).toHaveTextContent("통계 릴리스 버전 1");
    expect(screen.getByTestId("land-cover-layer-version")).toHaveTextContent("기준 시점 2025");
  });

  it("always shows the mandatory source attribution, served or fallback", () => {
    // No disclosures prop at all: the canonical project attribution still renders,
    // because attribution is mandatory on every public surface.
    renderOpen(baseProps());
    expect(screen.getByTestId("land-cover-layer-attribution")).toHaveTextContent(
      "출처: 기후에너지환경부 환경공간정보서비스(EGIS)",
    );
    expect(screen.getByTestId("land-cover-layer-source-link")).toHaveAttribute(
      "href",
      "https://aid.mcee.go.kr/intro/land.do",
    );
  });

  it("prefers the attribution the API served over the local constant", () => {
    renderOpen(
      baseProps({
        disclosures: {
          attribution: {
            attribution_ko: "출처: 서버가 보낸 문구",
            official_source_url: "https://example.invalid/served",
          },
        },
      }),
    );
    expect(screen.getByTestId("land-cover-layer-attribution")).toHaveTextContent(
      "출처: 서버가 보낸 문구",
    );
    expect(screen.getByTestId("land-cover-layer-source-link")).toHaveAttribute(
      "href",
      "https://example.invalid/served",
    );
  });

  it("disables the layer and shows a bounded message when no release resolved", () => {
    renderOpen(
      baseProps({
        available: false,
        unavailableMessage: "토지피복 통계 레이어를 불러오지 못했습니다.",
      }),
    );
    expect(screen.getByTestId("land-cover-layer-toggle")).toBeDisabled();
    const message = screen.getByTestId("land-cover-layer-unavailable");
    expect(message).toHaveTextContent("불러오지 못했습니다");
    // Never a stack trace, SQL, path, or raw backend error.
    expect(message.textContent).not.toContain("SELECT");
    expect(message.textContent).not.toContain("Traceback");
  });

  it("disables the filters while the layer is off, without discarding their state", () => {
    renderOpen(baseProps({ show: false }));
    expect(screen.getByTestId("land-cover-coverage-toggle-PARTIAL")).toBeDisabled();
    // The state is still rendered: turning the layer back on restores exactly it.
    expect(screen.getByTestId("land-cover-coverage-toggle-PARTIAL")).toBeChecked();
  });
});

describe("visualization mode and level controls", () => {
  it("is a labelled radio group with coverage selected by default", () => {
    renderOpen(baseProps());
    const group = screen.getByTestId("land-cover-mode-group");
    expect(group).toHaveAttribute("role", "radiogroup");
    expect(group).toHaveAccessibleName("표시 방식");
    expect(screen.getByTestId("land-cover-mode-coverage")).toBeChecked();
    expect(screen.getByTestId("land-cover-mode-dominant")).not.toBeChecked();
  });

  it("offers the L1/L2/L3 selector only in dominant-class mode", () => {
    const { rerender } = renderOpen(baseProps());
    expect(screen.queryByTestId("land-cover-level-group")).not.toBeInTheDocument();
    rerender(<LandCoverLayerControl {...baseProps({ mode: "dominant" })} />);
    const group = screen.getByTestId("land-cover-level-group");
    expect(group).toHaveAttribute("role", "radiogroup");
    expect(group).toHaveAccessibleName("분류 단계");
    for (const level of [1, 2, 3]) {
      expect(screen.getByTestId(`land-cover-level-${level}`)).toHaveAttribute("type", "radio");
    }
    expect(screen.getByTestId("land-cover-level-1")).toBeChecked();
  });

  it("uses the official level names", () => {
    renderOpen(baseProps({ mode: "dominant" }));
    expect(screen.getByTestId("land-cover-level-group")).toHaveTextContent("L1 대분류");
    expect(screen.getByTestId("land-cover-level-group")).toHaveTextContent("L2 중분류");
    expect(screen.getByTestId("land-cover-level-group")).toHaveTextContent("L3 세분류");
  });

  it("reports a mode change and a level change to the parent", () => {
    const onModeChange = vi.fn();
    const onClassLevelChange = vi.fn();
    renderOpen(baseProps({ onModeChange }));
    fireEvent.click(screen.getByTestId("land-cover-mode-dominant"));
    expect(onModeChange).toHaveBeenCalledWith("dominant");

    cleanup();
    renderOpen(baseProps({ mode: "dominant", onClassLevelChange }));
    fireEvent.click(screen.getByTestId("land-cover-level-3"));
    expect(onClassLevelChange).toHaveBeenCalledWith(3);
  });
});

describe("coverage filters and the coverage legend", () => {
  it("offers all three statuses, enabled by default, with the machine status in text", () => {
    renderOpen(baseProps());
    for (const status of ["COMPLETE_EXACT", "PARTIAL", "NO_COVERAGE"]) {
      const toggle = screen.getByTestId(`land-cover-coverage-toggle-${status}`);
      expect(toggle, status).toBeChecked();
      expect(toggle.closest("label"), status).toHaveTextContent(status);
    }
  });

  it("reports a coverage toggle to the parent", () => {
    const onToggleCoverage = vi.fn();
    renderOpen(baseProps({ onToggleCoverage }));
    fireEvent.click(screen.getByTestId("land-cover-coverage-toggle-NO_COVERAGE"));
    expect(onToggleCoverage).toHaveBeenCalledWith("NO_COVERAGE");
  });

  it("shows one legend row per coverage state, with its color and machine status", () => {
    renderOpen(baseProps());
    const rows = screen.getAllByTestId("land-cover-legend-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("격자 전체 평가");
    expect(rows[0]).toHaveTextContent("COMPLETE_EXACT");
    const swatch = rows[0].querySelector("span[style]") as HTMLElement;
    expect(swatch.style.backgroundColor).not.toBe("");
  });

  it("carries the NO_COVERAGE semantic warning in the legend", () => {
    renderOpen(baseProps());
    const rows = screen.getAllByTestId("land-cover-legend-row");
    const uncovered = rows.find((row) => row.textContent?.includes("NO_COVERAGE"))!;
    expect(uncovered).toHaveTextContent("평가하지 않았습니다");
    expect(uncovered).toHaveTextContent("적합하거나 안전하다는 뜻도 아닙니다");
  });

  it("states each coverage row's visibility in TEXT, not only by color", () => {
    renderOpen(
      baseProps({
        coverage: { COMPLETE_EXACT: true, PARTIAL: false, NO_COVERAGE: true },
      }),
    );
    expect(screen.getByTestId("land-cover-legend-state-COMPLETE_EXACT")).toHaveTextContent("표시 중");
    expect(screen.getByTestId("land-cover-legend-state-PARTIAL")).toHaveTextContent("숨김");
  });

  it("uses the same coverage colors the map fill uses", () => {
    renderOpen(baseProps());
    const rows = screen.getAllByTestId("land-cover-legend-row");
    const swatch = rows[0].querySelector("span[style]") as HTMLElement;
    // rgb() form of the shared constant — the map and the legend cannot diverge.
    const hex = LAND_COVER_COVERAGE_COLORS.COMPLETE_EXACT;
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
    expect(swatch.style.backgroundColor).toBe(`rgb(${rgb})`);
  });
});

describe("dominant-class legend and filters", () => {
  it("lists the official code and Korean name for every observed class", () => {
    renderOpen(baseProps({ mode: "dominant", classLevel: 1 }));
    const rows = screen.getAllByTestId("land-cover-legend-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("시가화건조지역");
    expect(rows[0]).toHaveTextContent("100");
    expect(rows[1]).toHaveTextContent("산림지역");
    expect(rows[1]).toHaveTextContent("300");
  });

  it("switches the legend to the classes of the selected level", () => {
    const { rerender } = renderOpen(baseProps({ mode: "dominant", classLevel: 2 }));
    expect(screen.getByTestId("land-cover-legend")).toHaveTextContent("교통지역");
    expect(screen.getByTestId("land-cover-legend")).toHaveTextContent("L2 중분류");
    rerender(<LandCoverLayerControl {...baseProps({ mode: "dominant", classLevel: 3 })} />);
    expect(screen.getAllByTestId("land-cover-legend-row")).toHaveLength(3);
    expect(screen.getByTestId("land-cover-legend")).toHaveTextContent("L3 세분류");
    expect(screen.getByTestId("land-cover-legend")).toHaveTextContent("도로");
  });

  it("uses the deterministic per-code color for each swatch", () => {
    renderOpen(baseProps({ mode: "dominant", classLevel: 1 }));
    const row = screen.getAllByTestId("land-cover-legend-row")[1];
    const swatch = row.querySelector("span[style]") as HTMLElement;
    const hex = landCoverClassColor("300");
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
    expect(swatch.style.backgroundColor).toBe(`rgb(${rgb})`);
  });

  it("never renders an invented Unknown / Other / 기타 class row", () => {
    renderOpen(baseProps({ mode: "dominant", classLevel: 3 }));
    const legend = screen.getByTestId("land-cover-legend");
    for (const invented of ["기타", "미분류", "Unknown", "Other"]) {
      expect(legend.textContent).not.toContain(invented);
    }
  });

  it("marks a hidden class as unchecked rather than removing its row", () => {
    renderOpen(baseProps({ mode: "dominant", classLevel: 1, hiddenClassCodes: ["300"] }));
    expect(screen.getAllByTestId("land-cover-legend-row")).toHaveLength(2);
    expect(screen.getByTestId("land-cover-legend-toggle-300")).not.toBeChecked();
    expect(screen.getByTestId("land-cover-legend-toggle-100")).toBeChecked();
  });

  it("reports a class toggle and the bulk show/hide actions", () => {
    const onToggleClass = vi.fn();
    const onSetAllClasses = vi.fn();
    renderOpen(baseProps({ mode: "dominant", onToggleClass, onSetAllClasses }));
    fireEvent.click(screen.getByTestId("land-cover-legend-toggle-300"));
    expect(onToggleClass).toHaveBeenCalledWith("300");
    fireEvent.click(screen.getByTestId("land-cover-class-hide-all"));
    expect(onSetAllClasses).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByTestId("land-cover-class-show-all"));
    expect(onSetAllClasses).toHaveBeenCalledWith(true);
  });

  it("keeps a long 세분류 legend usable: bounded scroll, a count, and a search box", () => {
    renderOpen(baseProps({ mode: "dominant", classLevel: 3 }));
    const rows = screen.getByTestId("land-cover-legend-rows");
    // A bounded scroll region, not an unbounded list that pushes the card off-screen.
    expect(rows.className).toContain("max-h-40");
    expect(rows.className).toContain("overflow-y-auto");
    expect(screen.getByTestId("land-cover-legend")).toHaveTextContent("3개");

    fireEvent.change(screen.getByTestId("land-cover-class-search"), {
      target: { value: "311" },
    });
    expect(screen.getAllByTestId("land-cover-legend-row")).toHaveLength(1);
    expect(screen.getByTestId("land-cover-legend-row")).toHaveTextContent("활엽수림");
  });

  it("searches by official Korean name as well as by code", () => {
    renderOpen(baseProps({ mode: "dominant", classLevel: 3 }));
    fireEvent.change(screen.getByTestId("land-cover-class-search"), { target: { value: "도로" } });
    const rows = screen.getAllByTestId("land-cover-legend-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("154");
  });

  it("says so when the search matches nothing, instead of showing an empty list", () => {
    renderOpen(baseProps({ mode: "dominant", classLevel: 3 }));
    fireEvent.change(screen.getByTestId("land-cover-class-search"), { target: { value: "없는분류" } });
    expect(screen.getByTestId("land-cover-legend-empty")).toHaveTextContent(
      "검색어와 일치하는 분류가 없습니다",
    );
  });

  it("explains that the class list comes from the loaded tiles", () => {
    renderOpen(baseProps({ mode: "dominant" }));
    expect(screen.getByTestId("land-cover-class-source-note")).toHaveTextContent(
      "현재 지도에 불러온 격자에서 실제로 제공된 공식 분류",
    );
  });

  it("says the list is not yet populated rather than inventing classes", () => {
    renderOpen(
      baseProps({ mode: "dominant", availableClasses: { 1: [], 2: [], 3: [] } }),
    );
    expect(screen.getByTestId("land-cover-legend-empty")).toHaveTextContent(
      "표시할 분류가 아직 없습니다",
    );
  });
});

describe("empty filter selection", () => {
  it("reports an empty selection when every coverage status is disabled", () => {
    renderOpen(
      baseProps({
        coverage: { COMPLETE_EXACT: false, PARTIAL: false, NO_COVERAGE: false },
      }),
    );
    expect(screen.getByTestId("land-cover-selection-empty")).toHaveTextContent(
      "현재 필터로 선택된 격자가 없습니다",
    );
  });

  it("reports an empty selection when every class is hidden and NO_COVERAGE is off", () => {
    renderOpen(
      baseProps({
        mode: "dominant",
        classLevel: 1,
        coverage: { COMPLETE_EXACT: true, PARTIAL: true, NO_COVERAGE: false },
        hiddenClassCodes: ["100", "300"],
      }),
    );
    expect(screen.getByTestId("land-cover-selection-empty")).toBeInTheDocument();
  });

  it("does NOT report empty while NO_COVERAGE cells are still drawn", () => {
    renderOpen(
      baseProps({ mode: "dominant", classLevel: 1, hiddenClassCodes: ["100", "300"] }),
    );
    expect(screen.queryByTestId("land-cover-selection-empty")).not.toBeInTheDocument();
  });

  it("is silent under the default filters", () => {
    renderOpen(baseProps());
    expect(screen.queryByTestId("land-cover-selection-empty")).not.toBeInTheDocument();
  });
});

describe("accessibility and layout", () => {
  it("adds no <fieldset>, so the page's metric fieldset count is unchanged", () => {
    const { container } = renderOpen(baseProps({ mode: "dominant" }));
    expect(container.querySelectorAll("fieldset")).toHaveLength(0);
  });

  it("uses native, focusable, keyboard-operable inputs throughout", () => {
    const onToggleShow = vi.fn();
    const onModeChange = vi.fn();
    renderOpen(baseProps({ onToggleShow, onModeChange }));
    // Native checkbox/radio elements: focusable without tabindex, and activated by
    // Space/Enter by the browser itself — no custom widget reimplements the behaviour.
    const toggle = screen.getByTestId("land-cover-layer-toggle");
    toggle.focus();
    expect(toggle).toHaveFocus();
    expect(toggle.tagName).toBe("INPUT");
    fireEvent.click(toggle);
    expect(onToggleShow).toHaveBeenCalled();

    const dominant = screen.getByTestId("land-cover-mode-dominant");
    dominant.focus();
    expect(dominant).toHaveFocus();
    expect(dominant).toHaveAttribute("type", "radio");
    fireEvent.click(dominant);
    expect(onModeChange).toHaveBeenCalledWith("dominant");
  });

  it("gives every legend swatch an accompanying text label", () => {
    renderOpen(baseProps({ mode: "dominant", classLevel: 3 }));
    for (const row of screen.getAllByTestId("land-cover-legend-row")) {
      const swatch = row.querySelector("span[style]") as HTMLElement;
      // Decorative: the meaning is in the adjacent text, so it is hidden from AT.
      expect(swatch).toHaveAttribute("aria-hidden");
      expect(row.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it("labels the class search box for screen readers", () => {
    renderOpen(baseProps({ mode: "dominant" }));
    expect(screen.getByTestId("land-cover-class-search")).toHaveAccessibleName(
      "분류 코드 또는 이름으로 범례 검색",
    );
  });

  it("bounds its own height and keeps long class names from overflowing", () => {
    const { container } = renderOpen(baseProps({ mode: "dominant", classLevel: 3 }));
    // 28vh, not 52vh: TWO of these controls stack in one page-owned column on the
    // suitability map, and at 52vh each an expanded control pushed the one below it
    // under the map legend, where it could not be clicked. The contract this test is
    // about is unchanged — the body is height-BOUNDED and scrolls internally.
    const body = container.querySelector(".max-h-\\[28vh\\]");
    expect(body).not.toBeNull();
    expect(body!.className).toContain("overflow-y-auto");
    // The card is width-constrained by its parent stack; rows wrap rather than
    // forcing horizontal overflow.
    const row = screen.getAllByTestId("land-cover-legend-row")[0];
    expect(within(row).getByText("주거지역").className).toContain("break-words");
  });
});
