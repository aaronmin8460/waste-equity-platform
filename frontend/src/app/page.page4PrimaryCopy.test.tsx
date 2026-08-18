// @vitest-environment jsdom

/**
 * PAGE 4 — the PRIMARY copy budget of ② 계산 모델 가중치 설정 (Figma 136:8684).
 *
 * Figma draws card ② as a heading, a segmented weight bar, four factor cards and
 * the 안정 후보 row. Every explanation in the frame sits behind a per-card
 * "가중치 설명 펼치기" disclosure — the frame has NO standing prose between the bar
 * and the factor cards. Production had drifted into four standing explanatory
 * blocks there, so a reader met several methodology paragraphs before reaching the
 * factor cards that are the card's subject.
 *
 * This file pins the cleanup from BOTH sides, which is the only way it holds:
 *
 *   1. the removed lines must not come back to the PRIMARY surface, and
 *   2. every one of them must still be reachable in the card's disclosures.
 *
 * (2) is what stops this file from being read as licence to delete the analytical
 * content: none of it left the product, so a change that deletes rather than demotes
 * fails here just as loudly as a change that restores the standing prose.
 *
 * "PRIMARY" is defined mechanically as the ② card with every `<details>` subtree
 * removed — no Korean page snapshot, so re-wording a retained line does not fail
 * this file. Only the presence or absence of a line on a surface does.
 *
 * Every fixture is SYNTHETIC and carries no official evidence label.
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
  return { ...homeApiMock(actual), fetchSuitabilityCandidateDetail: vi.fn() };
});

const computeGradeDistribution = vi.fn();
vi.mock("../lib/relativeGrade", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/relativeGrade")>();
  return {
    ...actual,
    computeGradeDistribution: (...args: unknown[]) => computeGradeDistribution(...args),
  };
});

import { COMPONENT_ORDER, PROFILE_META, codeWithName } from "../lib/glossary";
import Home from "./page";

/**
 * The weight a factor card is showing.
 *
 * The card renders `가중치 설정 [ NN ] %` — Figma 356:582's own control — which is a
 * live `<input>` in the Page-4 workspace and a read-out `<span>` in the single-column
 * shape. Both carry the same testid and the same number; only where the number lives
 * differs, so the assertions read whichever the element is.
 */
function factorWeightText(testId: string): string {
  const el = screen.getByTestId(testId);
  return el instanceof HTMLInputElement ? `${el.value}%` : (el.textContent ?? "");
}


beforeEach(() => {
  vi.clearAllMocks();
  computeGradeDistribution.mockResolvedValue({
    runId: 47,
    profile: "baseline" as const,
    scope: { kind: "all" as const },
    population: 17501,
    p25: 47.6779,
    p75: 57.811,
    countA: 4914,
    countB: 8403,
    countC: 4184,
  });
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

async function enterDeepAnalysis() {
  const utils = render(<Home />);
  await waitFor(() => expect(screen.queryByTestId("loading")).toBeNull());
  fireEvent.click(screen.getByTestId("mode-suitability"));
  await waitFor(() => expect(screen.getByTestId("scoring-basis")).toBeDefined());
  return utils;
}

/** Card ② as a whole — primary surface AND its disclosures. */
const card = () => screen.getByTestId("scoring-basis");

/**
 * The PRIMARY surface of card ②: everything a reader sees without opening a single
 * disclosure. Built by cloning the card and dropping every `<details>` subtree, so
 * the definition follows the markup instead of a hand-listed set of test ids.
 */
function primaryText(): string {
  const clone = card().cloneNode(true) as HTMLElement;
  clone.querySelectorAll("details").forEach((node) => node.remove());
  return clone.textContent ?? "";
}

// --------------------------------------------------------------------------- //
// The lines that must NOT stand in the primary card
// --------------------------------------------------------------------------- //

describe("② 계산 모델 가중치 설정 — primary copy budget", () => {
  it("carries no standing active-profile method sentence", async () => {
    await enterDeepAnalysis();
    // The default basis, and then the one the prompt names explicitly. Neither
    // profile's "…민감도 비교 가정입니다." line belongs on the primary surface.
    expect(primaryText()).not.toContain(PROFILE_META.baseline.detail);
    fireEvent.click(screen.getByTestId("profile-radio-access_focused"));
    await waitFor(() =>
      expect(screen.getByTestId("active-basis-name").textContent).toBe(
        PROFILE_META.access_focused.primary,
      ),
    );
    expect(primaryText()).not.toContain(
      "도로 근접성 대리지표 항목의 가중치를 높인 민감도 비교 가정입니다.",
    );
    expect(primaryText()).not.toContain("가중치를 높인");
  });

  it("carries no standing stability prose — the 안정 후보 row is the one statement", async () => {
    await enterDeepAnalysis();
    expect(primaryText()).not.toContain(
      "이 분석 실행은 기준을 바꿔도 상위권을 유지하는 정도(안정성)를 함께 제공합니다.",
    );
    expect(primaryText()).not.toContain("기준을 바꿔도 상위권");
  });

  it("carries no standing methodology paragraph", async () => {
    await enterDeepAnalysis();
    // 운영 가정 / 전문가 AHP framing — required content, but not primary content.
    expect(primaryText()).not.toContain("전문가 AHP");
  });

  it("carries no standing CRITIC derivation prose", async () => {
    await enterDeepAnalysis();
    fireEvent.click(screen.getByTestId("profile-radio-critic"));
    await waitFor(() =>
      expect(screen.getByTestId("active-basis-name").textContent).toBe(PROFILE_META.critic.primary),
    );
    const primary = primaryText();
    for (const line of ["방법 버전", "자료가 완전한", "규범적 중요도", "분산 0(정보 없음)"]) {
      expect(primary, line).not.toContain(line);
    }
  });

  it("states each factor's full name exactly once — no one-line Z/R/E/D sentence", async () => {
    await enterDeepAnalysis();
    const primary = primaryText();
    // The removed sentence listed all four names WITH their percentages, which put
    // every factor name on the primary surface twice: once in that sentence and
    // once on its own factor card. One occurrence each means the sentence is gone
    // and the factor cards are the single text home for the weights.
    for (const component of COMPONENT_ORDER) {
      const name = codeWithName(component);
      const hits = primary.split(name).length - 1;
      expect(hits, name).toBe(1);
    }
  });
});

// --------------------------------------------------------------------------- //
// …and every removed line is still in the product
// --------------------------------------------------------------------------- //

describe("② 계산 모델 가중치 설정 — nothing left the product", () => {
  it("keeps the active profile's method sentence one keystroke away", async () => {
    await enterDeepAnalysis();
    fireEvent.click(screen.getByTestId("profile-radio-access_focused"));
    await waitFor(() =>
      expect(screen.getByTestId("active-basis-method-detail").textContent).toContain(
        PROFILE_META.access_focused.detail,
      ),
    );
    // It is INSIDE a disclosure, not merely present somewhere on the card.
    expect(screen.getByTestId("active-basis-method-detail").closest("details")).not.toBeNull();
  });

  it("keeps the 운영 가정 / 전문가 AHP framing in the method disclosure", async () => {
    await enterDeepAnalysis();
    const method = screen.getByTestId("scoring-basis-method").textContent ?? "";
    expect(method).toContain("운영 가정");
    expect(method).toContain("전문가 AHP 결과가 아닙니다");
    expect(method).toContain("자동 계산된 비율입니다");
  });

  it("keeps the whole CRITIC derivation, caveat included, in the method disclosure", async () => {
    await enterDeepAnalysis();
    fireEvent.click(screen.getByTestId("profile-radio-critic"));
    const note = await waitFor(() => screen.getByTestId("critic-method-note"));
    expect(note.closest("details")).not.toBeNull();
    const text = note.textContent ?? "";
    expect(text).toContain("방법 버전");
    expect(text).toContain("자료가 완전한");
    // The mandatory interpretation caveat never separates from the weights.
    expect(text).toContain("규범적 중요도가 아닌");
    expect(text).toContain("용도지역 호환성(Z)");
  });

  it("keeps every basis's weights and method comparable in one disclosure", async () => {
    await enterDeepAnalysis();
    const comparison = screen.getByTestId("profile-weight-comparison").textContent ?? "";
    for (const profile of ["baseline", "equal", "equity_focused", "access_focused"] as const) {
      expect(comparison, profile).toContain(PROFILE_META[profile].primary);
      expect(comparison, profile).toContain(PROFILE_META[profile].detail as string);
    }
  });

  it("puts the demoted methodology behind ONE disclosure, not a second card", async () => {
    await enterDeepAnalysis();
    // The demoted methodology has exactly one home. 기준별 가중치 비교 is the other
    // disclosure in this card and does a different job (comparing the five bases),
    // so it is not a second copy — but the 운영 가정 framing paragraph itself must
    // appear once and only once, in 가중치 계산 방법.
    expect(card().querySelectorAll('[data-testid="scoring-basis-method"]')).toHaveLength(1);
    const framing = (card().textContent ?? "").split("자동 계산된 비율입니다").length - 1;
    expect(framing).toBe(1);
    expect(screen.getByTestId("scoring-basis-method").textContent).toContain(
      "자동 계산된 비율입니다",
    );
  });
});

// --------------------------------------------------------------------------- //
// What the primary surface must still show
// --------------------------------------------------------------------------- //

describe("② 계산 모델 가중치 설정 — what stays primary", () => {
  it("keeps the heading, the bar, the four factor cards and their served weights", async () => {
    await enterDeepAnalysis();
    expect(within(card()).getByRole("heading", { name: "② 계산 모델 가중치 설정" })).toBeDefined();
    expect(within(card()).getByTestId("weight-distribution-bar")).toBeDefined();
    for (const component of COMPONENT_ORDER) {
      expect(within(card()).getByTestId(`factor-card-${component}`)).toBeDefined();
    }
    // The served baseline vector, on the cards rather than in a sentence.
    expect(factorWeightText("factor-weight-zoning")).toContain("40%");
    expect(factorWeightText("factor-weight-road")).toContain("30%");
    expect(factorWeightText("factor-weight-equity")).toContain("20%");
    expect(factorWeightText("factor-weight-demand")).toContain("10%");
  });

  it("keeps the basis selector and a clear selected state on the primary surface", async () => {
    await enterDeepAnalysis();
    const selector = within(card()).getByTestId("profile-selector");
    expect(selector.closest("details")).toBeNull();
    expect((screen.getByTestId("profile-radio-baseline") as HTMLInputElement).checked).toBe(true);
    // The name of the basis in force is stated, not left to be inferred from which
    // radio is checked.
    expect(primaryText()).toContain(PROFILE_META.baseline.primary);
  });

  // The 안정 후보 row is STRUCK from card ② (기술 참고사항 225:440: "지도 쪽에 있는
  // 것만으로도 충분함"). This now asserts the strike held AND that the rule survived
  // on the primary surface the annotation points at — the map legend, beside the
  // outline it describes. The rule itself is unchanged: three bases, never four.
  it("moves the stable-candidate rule to the map legend, and keeps it primary", async () => {
    await enterDeepAnalysis();
    expect(within(card()).queryByTestId("scoring-basis-stability")).toBeNull();
    // The map legend is itself a collapsible disclosure, so "primary" here means
    // "on the map, beside the outline it explains" — which is exactly what the
    // annotation asks for — not "outside every <details>".
    const legend = screen.getByTestId("stability-legend-note");
    expect(legend.textContent).toContain("baseline·equal·critic 상위 10%");
    expect(legend.textContent).not.toContain("네 계산식");
    // ...and the limit that no other surface carries stays with the definition.
    expect(screen.getByTestId("score-basis-stability-meaning").textContent).toContain(
      "최종 입지, 허가 가능성 또는 법적 적격성을 의미하지 않습니다",
    );
  });

  it("puts the factor cards ABOVE the methodology disclosure, not below it", async () => {
    await enterDeepAnalysis();
    const cards = within(card()).getByTestId("factor-cards");
    const method = within(card()).getByTestId("scoring-basis-method");
    // A reader reaches the four factors before any methodology surface.
    expect(cards.compareDocumentPosition(method) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("adopts no Figma mock factor while trimming the copy", async () => {
    await enterDeepAnalysis();
    const text = card().textContent ?? "";
    for (const mock of ["주민 반응", "토지피복 기반 적합도", "장래 역내 쓰레기 발생량"]) {
      expect(text, mock).not.toContain(mock);
    }
  });
});

// --------------------------------------------------------------------------- //
// The numbered workflow the trimmed card sits in
// --------------------------------------------------------------------------- //

describe("the ① ② → ③ ④ ⑤ workflow stays unbroken", () => {
  it("reads ① then ② down the controls column", async () => {
    await enterDeepAnalysis();
    const left = screen.getByTestId("deep-left-panel");
    const scope = within(left).getByTestId("suitability-scope");
    const basis = within(left).getByTestId("scoring-basis");
    expect(scope.compareDocumentPosition(basis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reads ③ then ④ then ⑤ down the results column, with nothing between them", async () => {
    await enterDeepAnalysis();
    const right = screen.getByTestId("deep-right-panel");
    const results = await waitFor(() => within(right).getByTestId("suitability-results"));
    const save = within(right).getByTestId("scenario-save");
    const compare = within(right).getByTestId("scenario-compare-picker");
    // The order the numbering promises…
    expect(results.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(save.compareDocumentPosition(compare) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // …and no supporting card wedged into it. ③④⑤ are the first three cards of the
    // column; the unnumbered supporting cards follow ⑤ (Figma 136:8684's right
    // column is 340×535, 340×230, 340×429 and nothing else). Before the Page 4
    // integration those cards sat between ③ and ④ and pushed ④⑤ off the fold.
    const numbered = [results, save, compare];
    const cards = Array.from(right.querySelectorAll("[data-testid]")).filter((node) =>
      numbered.includes(node as HTMLElement),
    );
    expect(cards).toEqual(numbered);
    const firstThree = Array.from(right.children).slice(0, 3);
    for (const node of numbered) {
      expect(firstThree.some((child) => child === node || child.contains(node))).toBe(true);
    }
  });
});
