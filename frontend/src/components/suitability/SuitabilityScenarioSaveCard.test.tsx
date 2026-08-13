// @vitest-environment jsdom

/**
 * ④ 시나리오 저장 + 저장목록 (Page 4D).
 *
 * The card is pure presentation over props, so these tests pin the two things
 * that make it honest rather than merely functional:
 *
 *   - it renders ONLY what the reader saved (no Figma mock rows, no invented
 *     weights, no fabricated "0%" for a weight the run never served);
 *   - it states every reason a save cannot proceed, and every limit that applies
 *     to what it stores (browser-only, cap, name length, other-run).
 */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SuitabilityScenarioSaveCard from "./SuitabilityScenarioSaveCard";
import {
  SAVED_SCENARIO_CAP,
  SAVED_SCENARIO_NAME_MAX_LENGTH,
  SAVED_SCENARIO_SCHEMA_VERSION,
  resolveComparisonPair,
  type SavedScenario,
} from "../../lib/savedScenarios";

const WEIGHTS = { zoning: "0.40000000", road: "0.30000000", equity: "0.20000000", demand: "0.10000000" };

function scenario(overrides: Partial<SavedScenario> = {}): SavedScenario {
  return {
    schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION,
    id: "s1",
    name: "형평성 우선안",
    weights: WEIGHTS,
    runId: 47,
    profileSource: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseProps(
  overrides: Partial<React.ComponentProps<typeof SuitabilityScenarioSaveCard>> = {},
): React.ComponentProps<typeof SuitabilityScenarioSaveCard> {
  const scenarios = overrides.scenarios ?? [];
  return {
    weights: WEIGHTS,
    weightsSourceLabel: "기본 가정",
    activeRunId: 47,
    scenarios,
    storageWarnings: [],
    saving: false,
    error: null,
    notice: null,
    onSave: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    selection: resolveComparisonPair(scenarios, null, null),
    onAssignSlot: vi.fn(),
    onClearSlot: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

/** Open the `저장목록 보기` disclosure (jsdom does not open `<details>` on click). */
function openList(): void {
  const details = screen.getByTestId("scenario-saved-list-disclosure") as HTMLDetailsElement;
  details.open = true;
}

describe("empty state", () => {
  it("shows an explicit empty saved list and renders no mock rows", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps()} />);
    openList();

    expect(screen.getByTestId("scenario-saved-empty")).toBeInTheDocument();
    expect(screen.queryAllByTestId("scenario-saved-item")).toHaveLength(0);
    // The Figma mock names must not survive into the product.
    expect(screen.queryByText(/시나리오 03/)).toBeNull();
    expect(screen.queryByText(/균형 중심안/)).toBeNull();
  });

  it("counts the saved list in the disclosure label", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps()} />);
    expect(screen.getByText("저장목록 보기 (0개)")).toBeInTheDocument();
  });
});

describe("browser-only disclosure", () => {
  it("states that scenarios live in this browser only", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps()} />);
    const notice = screen.getByTestId("scenario-storage-notice");
    expect(notice).toHaveTextContent("이 브라우저에만 저장됩니다");
    expect(notice).toHaveTextContent("다른 기기나 브라우저에서는 보이지 않으며");
  });
});

describe("save form", () => {
  it("shows the real active weights it is about to save", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps()} />);
    const line = screen.getByTestId("scenario-save-weights");
    expect(line).toHaveTextContent("기본 가정");
    expect(line).toHaveTextContent("40%");
    expect(line).toHaveTextContent("30%");
  });

  it("keeps the save button unavailable until a name is typed", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps()} />);
    expect(screen.getByTestId("scenario-save-submit")).toBeDisabled();

    fireEvent.change(screen.getByTestId("scenario-name-input"), { target: { value: "형평성안" } });
    expect(screen.getByTestId("scenario-save-submit")).toBeEnabled();
  });

  it("treats a whitespace-only name as no name", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps()} />);
    fireEvent.change(screen.getByTestId("scenario-name-input"), { target: { value: "    " } });
    expect(screen.getByTestId("scenario-save-submit")).toBeDisabled();
  });

  it("calls onSave with the typed name and clears the field", () => {
    const onSave = vi.fn();
    render(<SuitabilityScenarioSaveCard {...baseProps({ onSave })} />);

    const input = screen.getByTestId("scenario-name-input");
    fireEvent.change(input, { target: { value: "형평성 우선안" } });
    fireEvent.click(screen.getByTestId("scenario-save-submit"));

    expect(onSave).toHaveBeenCalledWith("형평성 우선안");
    expect(input).toHaveValue("");
  });

  it("resets the field on 취소 without saving", () => {
    const onSave = vi.fn();
    render(<SuitabilityScenarioSaveCard {...baseProps({ onSave })} />);

    fireEvent.change(screen.getByTestId("scenario-name-input"), { target: { value: "버릴 이름" } });
    fireEvent.click(screen.getByTestId("scenario-save-cancel"));

    expect(screen.getByTestId("scenario-name-input")).toHaveValue("");
    expect(onSave).not.toHaveBeenCalled();
  });

  it(`counts characters against ${SAVED_SCENARIO_NAME_MAX_LENGTH} and refuses an over-long name`, () => {
    render(<SuitabilityScenarioSaveCard {...baseProps()} />);
    const input = screen.getByTestId("scenario-name-input");

    fireEvent.change(input, { target: { value: "가".repeat(SAVED_SCENARIO_NAME_MAX_LENGTH) } });
    expect(screen.getByTestId("scenario-name-counter")).toHaveTextContent(
      `${SAVED_SCENARIO_NAME_MAX_LENGTH}/${SAVED_SCENARIO_NAME_MAX_LENGTH}`,
    );
    expect(screen.getByTestId("scenario-save-submit")).toBeEnabled();

    fireEvent.change(input, { target: { value: "가".repeat(SAVED_SCENARIO_NAME_MAX_LENGTH + 1) } });
    expect(screen.getByTestId("scenario-save-submit")).toBeDisabled();
    expect(screen.getByTestId("scenario-name-too-long")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("cannot save when the run served no weights for the active basis", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps({ weights: null })} />);
    fireEvent.change(screen.getByTestId("scenario-name-input"), { target: { value: "이름" } });

    expect(screen.getByTestId("scenario-save-no-weights")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-save-submit")).toBeDisabled();
    // …and no fabricated weight line stands in for the missing one.
    expect(screen.queryByTestId("scenario-save-weights")).toBeNull();
  });

  it("cannot save before the run is known", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps({ activeRunId: null })} />);
    fireEvent.change(screen.getByTestId("scenario-name-input"), { target: { value: "이름" } });
    expect(screen.getByTestId("scenario-save-submit")).toBeDisabled();
  });

  it("refuses a save at the cap and says how to make room", () => {
    const scenarios = Array.from({ length: SAVED_SCENARIO_CAP }, (_, i) =>
      scenario({ id: `s${i}`, name: `안 ${i}` }),
    );
    render(<SuitabilityScenarioSaveCard {...baseProps({ scenarios })} />);
    fireEvent.change(screen.getByTestId("scenario-name-input"), { target: { value: "하나 더" } });

    expect(screen.getByTestId("scenario-save-submit")).toBeDisabled();
    expect(screen.getByTestId("scenario-save-cap")).toHaveTextContent(`최대 ${SAVED_SCENARIO_CAP}개`);
  });

  it("shows the in-flight state while the weights are being validated", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps({ saving: true })} />);
    fireEvent.change(screen.getByTestId("scenario-name-input"), { target: { value: "이름" } });
    expect(screen.getByTestId("scenario-save-submit")).toBeDisabled();
    expect(screen.getByTestId("scenario-save-submit")).toHaveTextContent("확인 중…");
  });

  it("surfaces a write failure as an actionable error", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps({ error: "브라우저 저장 공간이 부족합니다." })} />);
    const banner = screen.getByTestId("scenario-save-error");
    expect(banner).toHaveTextContent("브라우저 저장 공간이 부족합니다.");
    expect(banner).toHaveTextContent("오류");
  });

  it("surfaces unreadable stored entries instead of hiding them", () => {
    render(
      <SuitabilityScenarioSaveCard
        {...baseProps({ storageWarnings: ["저장된 시나리오 2개는 형식이 올바르지 않아 표시하지 않았습니다."] })}
      />,
    );
    expect(screen.getByTestId("scenario-storage-warnings")).toHaveTextContent("2개");
  });
});

describe("saved list", () => {
  it("renders a real saved scenario with its own weights and no fabricated values", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps({ scenarios: [scenario()] })} />);
    openList();

    const items = screen.getAllByTestId("scenario-saved-item");
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByTestId("scenario-saved-name")).toHaveTextContent("형평성 우선안");
    // Repository components, never the Figma mock four.
    const weights = within(items[0]).getByTestId("scenario-saved-weights");
    expect(weights).toHaveTextContent("용도지역 호환성(Z) 40%");
    expect(weights).not.toHaveTextContent("주민 반응");
  });

  it("names the profile the weights came from when one is recorded", () => {
    render(
      <SuitabilityScenarioSaveCard {...baseProps({ scenarios: [scenario({ profileSource: "critic" })] })} />,
    );
    openList();
    expect(screen.getByTestId("scenario-saved-source")).toHaveTextContent("critic");
  });

  it("flags a scenario saved against a different run and blocks its A/B selection", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps({ scenarios: [scenario({ runId: 46 })] })} />);
    openList();

    expect(screen.getByTestId("scenario-saved-other-run")).toHaveTextContent(
      "다른 분석 실행에서 저장된 시나리오입니다",
    );
    expect(screen.getByTestId("scenario-slot-a")).toBeDisabled();
    expect(screen.getByTestId("scenario-slot-b")).toBeDisabled();
  });
});

describe("rename", () => {
  it("opens the rename form from the ⋮ menu and submits the new name for the same id", () => {
    const onRename = vi.fn();
    render(<SuitabilityScenarioSaveCard {...baseProps({ scenarios: [scenario()], onRename })} />);
    openList();

    fireEvent.click(screen.getByTestId("scenario-saved-menu-toggle"));
    fireEvent.click(screen.getByTestId("scenario-rename-open"));
    fireEvent.change(screen.getByTestId("scenario-rename-input"), { target: { value: "새 이름" } });
    fireEvent.click(screen.getByTestId("scenario-rename-confirm"));

    expect(onRename).toHaveBeenCalledWith("s1", "새 이름");
  });

  it("pre-fills the rename field with the current name", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps({ scenarios: [scenario()] })} />);
    openList();
    fireEvent.click(screen.getByTestId("scenario-saved-menu-toggle"));
    fireEvent.click(screen.getByTestId("scenario-rename-open"));

    expect(screen.getByTestId("scenario-rename-input")).toHaveValue("형평성 우선안");
  });

  it("refuses an empty or over-long rename and does not call onRename", () => {
    const onRename = vi.fn();
    render(<SuitabilityScenarioSaveCard {...baseProps({ scenarios: [scenario()], onRename })} />);
    openList();
    fireEvent.click(screen.getByTestId("scenario-saved-menu-toggle"));
    fireEvent.click(screen.getByTestId("scenario-rename-open"));

    fireEvent.change(screen.getByTestId("scenario-rename-input"), { target: { value: "   " } });
    expect(screen.getByTestId("scenario-rename-confirm")).toBeDisabled();
    expect(screen.getByTestId("scenario-rename-problem")).toHaveTextContent("이름을 입력해 주세요");

    fireEvent.change(screen.getByTestId("scenario-rename-input"), {
      target: { value: "가".repeat(SAVED_SCENARIO_NAME_MAX_LENGTH + 1) },
    });
    expect(screen.getByTestId("scenario-rename-confirm")).toBeDisabled();

    fireEvent.click(screen.getByTestId("scenario-rename-confirm"));
    expect(onRename).not.toHaveBeenCalled();
  });

  it("abandons the rename on 취소", () => {
    const onRename = vi.fn();
    render(<SuitabilityScenarioSaveCard {...baseProps({ scenarios: [scenario()], onRename })} />);
    openList();
    fireEvent.click(screen.getByTestId("scenario-saved-menu-toggle"));
    fireEvent.click(screen.getByTestId("scenario-rename-open"));
    fireEvent.change(screen.getByTestId("scenario-rename-input"), { target: { value: "버림" } });
    fireEvent.click(screen.getByTestId("scenario-rename-cancel"));

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByTestId("scenario-saved-name")).toHaveTextContent("형평성 우선안");
  });
});

describe("delete", () => {
  it("requires a confirmation step before deleting", () => {
    const onDelete = vi.fn();
    render(<SuitabilityScenarioSaveCard {...baseProps({ scenarios: [scenario()], onDelete })} />);
    openList();

    fireEvent.click(screen.getByTestId("scenario-saved-menu-toggle"));
    fireEvent.click(screen.getByTestId("scenario-delete-open"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId("scenario-delete-confirm-prompt")).toHaveTextContent("되돌릴 수 없습니다");

    fireEvent.click(screen.getByTestId("scenario-delete-confirm"));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });

  it("lets the confirmation be abandoned", () => {
    const onDelete = vi.fn();
    render(<SuitabilityScenarioSaveCard {...baseProps({ scenarios: [scenario()], onDelete })} />);
    openList();
    fireEvent.click(screen.getByTestId("scenario-saved-menu-toggle"));
    fireEvent.click(screen.getByTestId("scenario-delete-open"));
    fireEvent.click(screen.getByTestId("scenario-delete-cancel"));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId("scenario-delete-open")).toBeInTheDocument();
  });
});

describe("A/B assignment", () => {
  it("assigns a scenario to A and then to B", () => {
    const onAssignSlot = vi.fn();
    const scenarios = [scenario({ id: "a" }), scenario({ id: "b", name: "근접성안" })];
    render(<SuitabilityScenarioSaveCard {...baseProps({ scenarios, onAssignSlot })} />);
    openList();

    const rows = screen.getAllByTestId("scenario-saved-item");
    fireEvent.click(within(rows[0]).getByTestId("scenario-slot-a"));
    fireEvent.click(within(rows[1]).getByTestId("scenario-slot-b"));

    expect(onAssignSlot).toHaveBeenNthCalledWith(1, "A", "a");
    expect(onAssignSlot).toHaveBeenNthCalledWith(2, "B", "b");
  });

  it("marks the selected row as pressed and clears it on a second click", () => {
    const onClearSlot = vi.fn();
    const scenarios = [scenario({ id: "a" })];
    render(
      <SuitabilityScenarioSaveCard
        {...baseProps({
          scenarios,
          selection: resolveComparisonPair(scenarios, "a", null),
          onClearSlot,
        })}
      />,
    );
    openList();

    const slotA = screen.getByTestId("scenario-slot-a");
    expect(slotA).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(slotA);
    expect(onClearSlot).toHaveBeenCalledWith("A");
  });

  it("names the scenario in each slot button's accessible name", () => {
    render(<SuitabilityScenarioSaveCard {...baseProps({ scenarios: [scenario()] })} />);
    openList();
    expect(screen.getByTestId("scenario-slot-a")).toHaveAccessibleName(/형평성 우선안/);
  });
});
