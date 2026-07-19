// @vitest-environment jsdom

/**
 * Terminology audit — the machine-readable guard that PRIMARY citizen UI stays in
 * plain Korean. Renders the app and asserts the navigation, sub-views, and status
 * labels are the plain-Korean ones, and that the default 지역 부담 view carries no
 * unexplained technical enum / version / English-parenthetical token.
 *
 * Technical terms are still allowed inside "자세히 보기" disclosures and methodology
 * notes (e.g. the CRITIC methodology note, the MVT detail) — this audit scans the
 * default primary surface, not the opened detail layers.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FORBIDDEN_PRIMARY_TOKENS, MODE_LABELS, STATUS_META, SUBVIEW_LABELS } from "../lib/glossary";

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

describe("primary navigation uses plain Korean", () => {
  it("labels the four areas 지역 부담 / 후보지 분석 / 매립지 현황 / 데이터·출처", async () => {
    await renderLoaded();
    expect(screen.getByTestId("mode-equity").textContent).toBe(MODE_LABELS.equity);
    expect(screen.getByTestId("mode-suitability").textContent).toBe(MODE_LABELS.suitability);
    expect(screen.getByTestId("mode-flow").textContent).toBe(MODE_LABELS.flow);
    expect(screen.getByTestId("mode-transparency").textContent).toBe(MODE_LABELS.transparency);
  });

  it("shows a plain-language orientation for the active area", async () => {
    await renderLoaded();
    expect(screen.getByTestId("mode-orientation").textContent).toContain("지역별 폐기물 발생량");
  });
});

describe("default 지역 부담 view carries no unexplained technical token", () => {
  it("the equity sidebar has no raw status/accounting enum, MVT, or English metric parenthetical", async () => {
    await renderLoaded();
    const aside = document.querySelector("aside");
    expect(aside).not.toBeNull();
    const text = aside?.textContent ?? "";
    for (const token of FORBIDDEN_PRIMARY_TOKENS) {
      expect(text.includes(token), `equity sidebar leaks "${token}"`).toBe(false);
    }
    // Nor a bare English metric parenthetical.
    expect(text).not.toContain("(Population)");
    expect(text).not.toContain("(Equity)");
  });
});

describe("후보지 분석 uses plain status and sub-view labels", () => {
  it("names the three sub-views in plain Korean", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-suitability"));
    await waitFor(() => expect(screen.getByTestId("suitability-summary")).toBeDefined());
    expect(screen.getByTestId("suitability-view-score").textContent).toBe(SUBVIEW_LABELS.score);
    expect(screen.getByTestId("suitability-view-scenario").textContent).toBe(SUBVIEW_LABELS.scenario);
    expect(screen.getByTestId("suitability-view-cost").textContent).toBe(SUBVIEW_LABELS.cost);
  });

  it("shows candidate counts with plain status names, not raw enums", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("mode-suitability"));
    await waitFor(() => expect(screen.getByTestId("candidate-counts")).toBeDefined());
    const counts = screen.getByTestId("candidate-counts").textContent ?? "";
    expect(counts).toContain(STATUS_META.ELIGIBLE.primary); // 1차 분석 통과
    expect(counts).toContain(STATUS_META.REVIEW_REQUIRED.primary); // 추가 확인 필요
    expect(counts).toContain(STATUS_META.EXCLUDED.primary); // 현재 기준에서 제외
    expect(counts).not.toContain("ELIGIBLE");
    expect(counts).not.toContain("EXCLUDED");
  });
});
