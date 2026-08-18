// @vitest-environment jsdom

/**
 * ⑤ 비교할 시나리오 선택 (Page 4D).
 *
 * The card's whole job is to be honest about a selection that is not yet a
 * comparison, so the tests pin the states rather than the happy path: nothing
 * pre-selected, an unresolvable slot named as such, a cross-run pair refused, and
 * a CTA that stays unavailable until exactly two distinct comparable scenarios
 * are chosen.
 */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SuitabilityScenarioComparePicker from "./SuitabilityScenarioComparePicker";
import {
  SAVED_SCENARIO_SCHEMA_VERSION,
  resolveComparisonPair,
  type SavedScenario,
} from "../../lib/savedScenarios";
import { COMPONENT_MODEL_HISTORICAL } from "../../lib/componentModelWeights";

const WEIGHTS = { zoning: "0.40000000", road: "0.30000000", equity: "0.20000000", demand: "0.10000000" };

function scenario(overrides: Partial<SavedScenario> = {}): SavedScenario {
  return {
    schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION,
    id: "s1",
    name: "형평성 우선안",
    weights: WEIGHTS,
    // These fixtures are HISTORICAL Z/R/E/D vectors, so they carry the historical
    // model tag. A successor scenario is a different namespace and is fixtured
    // separately where it is the subject.
    componentModelVersion: COMPONENT_MODEL_HISTORICAL,
    runId: 47,
    profileSource: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const SAVED = [scenario({ id: "a", name: "형평성 우선안" }), scenario({ id: "b", name: "근접성 우선안" })];

function props(
  overrides: Partial<React.ComponentProps<typeof SuitabilityScenarioComparePicker>> = {},
): React.ComponentProps<typeof SuitabilityScenarioComparePicker> {
  return {
    selection: resolveComparisonPair(SAVED, null, null),
    activeRunId: 47,
    savedCount: SAVED.length,
    onClearSlot: vi.fn(),
    onReset: vi.fn(),
    onCompare: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("no defaults", () => {
  it("starts with both slots empty and 0/2 selected", () => {
    render(<SuitabilityScenarioComparePicker {...props()} />);

    expect(screen.getByTestId("scenario-compare-count")).toHaveTextContent("(선택 0/2개)");
    const slotA = screen.getByTestId("scenario-compare-slot-a");
    expect(within(slotA).getByTestId("scenario-compare-slot-empty")).toBeInTheDocument();
    expect(within(slotA).getByTestId("scenario-compare-slot-name")).toHaveTextContent("");
  });

  it("keeps the CTA unavailable with nothing selected", () => {
    render(<SuitabilityScenarioComparePicker {...props()} />);
    expect(screen.getByTestId("scenario-compare-cta")).toBeDisabled();
    expect(screen.getByTestId("scenario-compare-hint")).toHaveTextContent("서로 다른 시나리오 2개");
  });

  it("points a reader with nothing saved back at ④", () => {
    render(<SuitabilityScenarioComparePicker {...props({ savedCount: 0 })} />);
    expect(screen.getByTestId("scenario-compare-no-saved")).toHaveTextContent("④ 시나리오 저장");
  });
});

describe("selection counter and CTA", () => {
  it("shows 1/2 and stays disabled with only A chosen", () => {
    render(<SuitabilityScenarioComparePicker {...props({ selection: resolveComparisonPair(SAVED, "a", null) })} />);

    expect(screen.getByTestId("scenario-compare-count")).toHaveTextContent("(선택 1/2개)");
    expect(screen.getByTestId("scenario-compare-cta")).toBeDisabled();
  });

  it("shows 2/2 and enables the CTA for two distinct scenarios", () => {
    render(<SuitabilityScenarioComparePicker {...props({ selection: resolveComparisonPair(SAVED, "a", "b") })} />);

    expect(screen.getByTestId("scenario-compare-count")).toHaveTextContent("(선택 2/2개)");
    expect(screen.getByTestId("scenario-compare-cta")).toBeEnabled();
    expect(screen.queryByTestId("scenario-compare-hint")).toBeNull();
  });

  it("never enables the CTA when both slots name the same scenario", () => {
    render(<SuitabilityScenarioComparePicker {...props({ selection: resolveComparisonPair(SAVED, "a", "a") })} />);
    expect(screen.getByTestId("scenario-compare-cta")).toBeDisabled();
  });

  it("calls onCompare when the enabled CTA is pressed", () => {
    const onCompare = vi.fn();
    render(
      <SuitabilityScenarioComparePicker
        {...props({ selection: resolveComparisonPair(SAVED, "a", "b"), onCompare })}
      />,
    );
    fireEvent.click(screen.getByTestId("scenario-compare-cta"));
    expect(onCompare).toHaveBeenCalledTimes(1);
  });

  it("preserves A/B order — the slots are not interchangeable", () => {
    render(<SuitabilityScenarioComparePicker {...props({ selection: resolveComparisonPair(SAVED, "b", "a") })} />);

    const slotA = screen.getByTestId("scenario-compare-slot-a");
    const slotB = screen.getByTestId("scenario-compare-slot-b");
    expect(within(slotA).getByTestId("scenario-compare-slot-name")).toHaveTextContent("근접성 우선안");
    expect(within(slotB).getByTestId("scenario-compare-slot-name")).toHaveTextContent("형평성 우선안");
  });
});

describe("slot content", () => {
  it("shows the selected scenario's own weights", () => {
    render(<SuitabilityScenarioComparePicker {...props({ selection: resolveComparisonPair(SAVED, "a", null) })} />);
    const slotA = screen.getByTestId("scenario-compare-slot-a");
    expect(within(slotA).getByTestId("scenario-compare-slot-weights")).toHaveTextContent(
      "용도지역 호환성(Z) 40%",
    );
  });

  it("removes a slot with ✕", () => {
    const onClearSlot = vi.fn();
    render(
      <SuitabilityScenarioComparePicker
        {...props({ selection: resolveComparisonPair(SAVED, "a", null), onClearSlot })}
      />,
    );
    const slotA = screen.getByTestId("scenario-compare-slot-a");
    fireEvent.click(within(slotA).getByTestId("scenario-compare-slot-clear"));
    expect(onClearSlot).toHaveBeenCalledWith("A");
  });

  it("offers no ✕ on an empty slot", () => {
    render(<SuitabilityScenarioComparePicker {...props()} />);
    const slotA = screen.getByTestId("scenario-compare-slot-a");
    expect(within(slotA).queryByTestId("scenario-compare-slot-clear")).toBeNull();
  });
});

describe("reset", () => {
  it("is unavailable with nothing selected and resets an existing selection", () => {
    const onReset = vi.fn();
    const { rerender } = render(<SuitabilityScenarioComparePicker {...props({ onReset })} />);
    expect(screen.getByTestId("scenario-compare-reset")).toBeDisabled();

    rerender(
      <SuitabilityScenarioComparePicker
        {...props({ selection: resolveComparisonPair(SAVED, "a", "b"), onReset })}
      />,
    );
    fireEvent.click(screen.getByTestId("scenario-compare-reset"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe("a slot that cannot be resolved", () => {
  it("names the missing scenario explicitly rather than showing an empty slot", () => {
    render(
      <SuitabilityScenarioComparePicker
        {...props({ selection: resolveComparisonPair(SAVED, "a", "from-another-device") })}
      />,
    );

    const slotB = screen.getByTestId("scenario-compare-slot-b");
    expect(within(slotB).getByTestId("scenario-compare-slot-missing")).toHaveTextContent(
      "이 브라우저에서 찾을 수 없습니다",
    );
    expect(within(slotB).queryByTestId("scenario-compare-slot-empty")).toBeNull();
    expect(screen.getByTestId("scenario-compare-count")).toHaveTextContent("(선택 1/2개)");
    expect(screen.getByTestId("scenario-compare-cta")).toBeDisabled();
  });

  it("still offers ✕ so a dangling selection can be cleared", () => {
    const onClearSlot = vi.fn();
    render(
      <SuitabilityScenarioComparePicker
        {...props({ selection: resolveComparisonPair(SAVED, "ghost", null), onClearSlot })}
      />,
    );
    const slotA = screen.getByTestId("scenario-compare-slot-a");
    fireEvent.click(within(slotA).getByTestId("scenario-compare-slot-clear"));
    expect(onClearSlot).toHaveBeenCalledWith("A");
  });
});

describe("run compatibility", () => {
  it("refuses to compare a pair whose scenario belongs to another run", () => {
    const mixed = [scenario({ id: "a" }), scenario({ id: "b", name: "옛 실행안", runId: 46 })];
    render(
      <SuitabilityScenarioComparePicker
        {...props({ selection: resolveComparisonPair(mixed, "a", "b"), savedCount: mixed.length })}
      />,
    );

    expect(screen.getByTestId("scenario-compare-count")).toHaveTextContent("(선택 2/2개)");
    expect(screen.getByTestId("scenario-compare-cta")).toBeDisabled();
    expect(screen.getByTestId("scenario-compare-incompatible")).toHaveTextContent(
      "다른 분석 실행에서 저장된 시나리오입니다",
    );
    expect(
      within(screen.getByTestId("scenario-compare-slot-b")).getByTestId(
        "scenario-compare-slot-other-run",
      ),
    ).toBeInTheDocument();
  });

  it("refuses to compare while the active run is still unknown", () => {
    render(
      <SuitabilityScenarioComparePicker
        {...props({ selection: resolveComparisonPair(SAVED, "a", "b"), activeRunId: null })}
      />,
    );
    expect(screen.getByTestId("scenario-compare-cta")).toBeDisabled();
  });
});

describe("what the comparison will be", () => {
  it("states that the result is recomputed, not replayed from storage", () => {
    render(<SuitabilityScenarioComparePicker {...props()} />);
    expect(screen.getByTestId("scenario-compare-method-note")).toHaveTextContent(
      "저장 당시의 점수나 순위를 그대로 보여주지 않습니다",
    );
  });

  it("shows no score, rank or winner of its own", () => {
    render(<SuitabilityScenarioComparePicker {...props({ selection: resolveComparisonPair(SAVED, "a", "b") })} />);
    expect(screen.queryByText(/위$/)).toBeNull();
    expect(screen.queryByText(/점$/)).toBeNull();
  });
});
