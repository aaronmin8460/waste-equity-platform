// @vitest-environment jsdom

/**
 * SearchableRegionPicker — the ARIA combobox that replaced the cost lens's native
 * `<select multiple>` in Phase 2 of the desktop redesign.
 *
 * The two things worth guarding hardest are (1) that no raw region code is ever
 * VISIBLE — the old picker printed "중구 (KR-SGIS-11140)" and made a citizen decode
 * an internal identifier — while the two 중구 stay unambiguously distinguishable,
 * and (2) that bulk selection offers only what the caller says is calculable, since
 * the caller has already filtered its list to regions with official waste data.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SearchableRegionPicker, { type PickerRegion } from "./SearchableRegionPicker";

// Deliberately supplied OUT of display order, so the component's own deterministic
// ordering is what the assertions observe. Codes are the real SGIS sido digits
// (Seoul 11 / Incheon 23 / Gyeonggi 31) that lib/ranking.ts classifies.
const REGIONS: PickerRegion[] = [
  { code: "KR-SGIS-31011", name: "수원시 장안구" },
  { code: "KR-SGIS-23010", name: "중구" },
  { code: "KR-SGIS-11140", name: "중구" },
  { code: "KR-SGIS-23510", name: "강화군" },
  { code: "KR-SGIS-11110", name: "종로구" },
];

const ORDERED_LABELS = [
  "서울 종로구",
  "서울 중구",
  "인천 강화군",
  "인천 중구",
  "경기 수원시 장안구",
];

function Harness({
  regions = REGIONS,
  initial = [] as string[],
  onChange,
}: {
  regions?: PickerRegion[];
  initial?: string[];
  onChange?: (codes: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <SearchableRegionPicker
      label="지역 이름 검색"
      regions={regions}
      selectedCodes={selected}
      onChange={(codes) => {
        setSelected(codes);
        onChange?.(codes);
      }}
    />
  );
}

function renderPicker(props: Parameters<typeof Harness>[0] = {}) {
  const utils = render(<Harness {...props} />);
  return { ...utils, input: screen.getByTestId("facility-cost-region-search") };
}

/** Open the popup the way a user does — by focusing the input. */
function open(input: HTMLElement): void {
  fireEvent.focus(input);
}

function optionLabels(): string[] {
  return screen.queryAllByTestId("facility-cost-region-option").map((o) => o.textContent ?? "");
}

function chipLabels(): string[] {
  return screen
    .queryAllByTestId("facility-cost-region-chip")
    .map((chip) => chip.querySelector("span")?.textContent ?? "");
}

function activeOptionLabel(input: HTMLElement): string {
  const id = input.getAttribute("aria-activedescendant");
  if (!id) return "";
  return document.getElementById(id)?.textContent ?? "";
}

afterEach(cleanup);

describe("ARIA combobox contract", () => {
  it("renders a labelled combobox wired to its listbox", () => {
    const { input } = renderPicker();
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    // The visible <label> names it, so it is reachable by its accessible name.
    expect(screen.getByLabelText("지역 이름 검색")).toBe(input);

    open(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const listbox = screen.getByTestId("facility-cost-region-options");
    expect(listbox.getAttribute("role")).toBe("listbox");
    // aria-controls points at the listbox that is actually rendered.
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    for (const option of screen.getAllByTestId("facility-cost-region-option")) {
      expect(option.getAttribute("role")).toBe("option");
      expect(option.getAttribute("aria-selected")).toBe("false");
    }
  });

  it("marks a selected option with aria-selected and a text indicator, not color alone", async () => {
    const { input } = renderPicker({ initial: ["KR-SGIS-11140"] });
    open(input);
    const option = screen
      .getAllByTestId("facility-cost-region-option")
      .find((o) => o.getAttribute("data-region-code") === "KR-SGIS-11140")!;
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(option.textContent).toContain("선택됨");
  });
});

describe("search", () => {
  it("filters by Korean region name", () => {
    const { input } = renderPicker();
    open(input);
    expect(optionLabels()).toHaveLength(5);
    fireEvent.change(input, { target: { value: "강화" } });
    expect(optionLabels()).toEqual(["인천 강화군"]);
  });

  it("matches on the metropolitan prefix too", () => {
    const { input } = renderPicker();
    open(input);
    fireEvent.change(input, { target: { value: "인천" } });
    expect(optionLabels()).toEqual(["인천 강화군", "인천 중구"]);
  });

  it("shows a meaningful empty state when nothing matches", () => {
    const { input } = renderPicker();
    open(input);
    fireEvent.change(input, { target: { value: "없는지역" } });
    expect(optionLabels()).toHaveLength(0);
    const empty = screen.getByTestId("facility-cost-region-empty").textContent ?? "";
    expect(empty).toContain("없는지역");
    expect(empty).toContain("일치하는 지역이 없습니다");
  });

  it("explains an empty offered set as uncalculable, not as a failed search", () => {
    const { input } = renderPicker({ regions: [] });
    open(input);
    expect(screen.getByTestId("facility-cost-region-empty").textContent).toContain(
      "계산할 수 있는 지역이 없습니다",
    );
  });
});

describe("region labels", () => {
  it("never renders a raw region code as visible text", () => {
    const { input, container } = renderPicker({ initial: ["KR-SGIS-11140"] });
    open(input);
    const text = container.textContent ?? "";
    expect(text).not.toContain("KR-SGIS");
    expect(text).not.toContain("11140");
    // The code survives where it belongs: as a machine-readable attribute.
    expect(
      screen
        .getAllByTestId("facility-cost-region-option")
        .map((o) => o.getAttribute("data-region-code")),
    ).toContain("KR-SGIS-11140");
  });

  it("distinguishes 서울 중구 from 인천 중구", () => {
    const { input } = renderPicker();
    open(input);
    fireEvent.change(input, { target: { value: "중구" } });
    expect(optionLabels()).toEqual(["서울 중구", "인천 중구"]);
  });

  it("orders options deterministically: 서울 → 인천 → 경기, then by name", () => {
    const { input } = renderPicker();
    open(input);
    expect(optionLabels()).toEqual(ORDERED_LABELS);
  });

  it("orders selected chips the same way, regardless of the order they were picked", async () => {
    const { input } = renderPicker();
    open(input);
    for (const code of ["KR-SGIS-31011", "KR-SGIS-11110", "KR-SGIS-23010"]) {
      fireEvent.click(
        screen
          .getAllByTestId("facility-cost-region-option")
          .find((o) => o.getAttribute("data-region-code") === code)!,
      );
    }
    await waitFor(() =>
      expect(chipLabels()).toEqual(["서울 종로구", "인천 중구", "경기 수원시 장안구"]),
    );
  });
});

describe("keyboard", () => {
  it("moves the active option with ArrowDown / ArrowUp", () => {
    const { input } = renderPicker();
    open(input);
    // Nothing is active until the user starts navigating from the first option.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeOptionLabel(input)).toContain("서울 중구");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeOptionLabel(input)).toContain("인천 강화군");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(activeOptionLabel(input)).toContain("서울 중구");
    // Wraps rather than dead-ending at the top.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(activeOptionLabel(input)).toContain("경기 수원시 장안구");
  });

  it("selects the active option with Enter", async () => {
    const { input } = renderPicker();
    open(input);
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 서울 중구
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(chipLabels()).toEqual(["서울 중구"]));
  });

  it("closes the list with Escape without losing the selection", async () => {
    const { input } = renderPicker({ initial: ["KR-SGIS-11110"] });
    open(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByTestId("facility-cost-region-option")).toHaveLength(0);
    expect(chipLabels()).toEqual(["서울 종로구"]);
  });
});

describe("selection", () => {
  it("selects an option on click", async () => {
    const onChange = vi.fn();
    const { input } = renderPicker({ onChange });
    open(input);
    fireEvent.click(screen.getAllByTestId("facility-cost-region-option")[0]);
    await waitFor(() => expect(chipLabels()).toEqual(["서울 종로구"]));
    expect(onChange).toHaveBeenCalledWith(["KR-SGIS-11110"]);
  });

  it("does not duplicate a region that is already selected", async () => {
    const { input } = renderPicker();
    open(input);
    const option = () =>
      screen
        .getAllByTestId("facility-cost-region-option")
        .find((o) => o.getAttribute("data-region-code") === "KR-SGIS-11110")!;
    fireEvent.click(option());
    await waitFor(() => expect(chipLabels()).toEqual(["서울 종로구"]));
    fireEvent.click(option());
    fireEvent.click(option());
    await waitFor(() =>
      expect(screen.getByTestId("facility-cost-region-status").textContent).toContain(
        "이미 선택되어 있습니다",
      ),
    );
    expect(chipLabels()).toEqual(["서울 종로구"]);
  });

  it("removes only the chip that was dismissed", async () => {
    const { input } = renderPicker({ initial: ["KR-SGIS-11110", "KR-SGIS-11140", "KR-SGIS-23010"] });
    expect(chipLabels()).toEqual(["서울 종로구", "서울 중구", "인천 중구"]);
    const chip = screen
      .getAllByTestId("facility-cost-region-chip")
      .find((c) => c.textContent?.includes("서울 중구"))!;
    fireEvent.click(within(chip).getByTestId("facility-cost-region-chip-remove"));
    await waitFor(() => expect(chipLabels()).toEqual(["서울 종로구", "인천 중구"]));
    // The removed region is still offered, so removal is reversible.
    open(input);
    expect(optionLabels()).toContain("서울 중구");
  });

  it("names each remove button after the region it removes", () => {
    renderPicker({ initial: ["KR-SGIS-11140", "KR-SGIS-23010"] });
    expect(screen.getByRole("button", { name: "서울 중구 제거" })).toBeDefined();
    expect(screen.getByRole("button", { name: "인천 중구 제거" })).toBeDefined();
  });
});

describe("bulk actions", () => {
  it("selects only the calculable Seoul regions", async () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("facility-cost-regions-seoul"));
    await waitFor(() => expect(chipLabels()).toEqual(["서울 종로구", "서울 중구"]));
  });

  it("selects only the calculable Incheon regions", async () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("facility-cost-regions-incheon"));
    await waitFor(() => expect(chipLabels()).toEqual(["인천 강화군", "인천 중구"]));
  });

  it("selects only the calculable Gyeonggi regions", async () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("facility-cost-regions-gyeonggi"));
    await waitFor(() => expect(chipLabels()).toEqual(["경기 수원시 장안구"]));
  });

  it("never adds a region the caller did not offer, nor a duplicate", async () => {
    // Only ONE Seoul region is calculable here, so 서울 전체 must add exactly it —
    // not every Seoul district that exists in the country.
    const onChange = vi.fn();
    renderPicker({
      regions: [
        { code: "KR-SGIS-11110", name: "종로구" },
        { code: "KR-SGIS-23010", name: "중구" },
      ],
      initial: ["KR-SGIS-11110"],
      onChange,
    });
    fireEvent.click(screen.getByTestId("facility-cost-regions-seoul"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["KR-SGIS-11110"]));
    expect(chipLabels()).toEqual(["서울 종로구"]);
  });

  it("merges a bulk selection with what is already selected", async () => {
    renderPicker({ initial: ["KR-SGIS-31011"] });
    fireEvent.click(screen.getByTestId("facility-cost-regions-seoul"));
    await waitFor(() =>
      expect(chipLabels()).toEqual(["서울 종로구", "서울 중구", "경기 수원시 장안구"]),
    );
  });

  it("disables a metropolitan button with no calculable region", () => {
    renderPicker({ regions: [{ code: "KR-SGIS-11110", name: "종로구" }] });
    expect((screen.getByTestId("facility-cost-regions-incheon") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId("facility-cost-regions-seoul") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("clears every selection", async () => {
    renderPicker({ initial: ["KR-SGIS-11110", "KR-SGIS-23010"] });
    const clear = screen.getByTestId("facility-cost-regions-clear") as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    fireEvent.click(clear);
    await waitFor(() => expect(chipLabels()).toHaveLength(0));
    expect(screen.getByTestId("facility-cost-selected-regions").textContent).toContain(
      "아직 선택한 지역이 없습니다",
    );
    expect(clear.disabled).toBe(true);
  });
});

describe("announcements", () => {
  it("announces selection changes politely, never as an alert", async () => {
    const { input } = renderPicker();
    const status = screen.getByTestId("facility-cost-region-status");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("role")).not.toBe("alert");

    open(input);
    fireEvent.click(screen.getAllByTestId("facility-cost-region-option")[0]);
    await waitFor(() => expect(status.textContent).toContain("서울 종로구 선택됨"));
    expect(status.textContent).toContain("선택한 지역 1개");

    fireEvent.click(screen.getByTestId("facility-cost-regions-clear"));
    await waitFor(() => expect(status.textContent).toContain("모두 해제"));
  });

  it("announces a bulk selection with its count", async () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("facility-cost-regions-incheon"));
    await waitFor(() =>
      expect(screen.getByTestId("facility-cost-region-status").textContent).toContain(
        "인천 지역 2개를 선택했습니다",
      ),
    );
  });
});

describe("changing the offered set", () => {
  it("resets a stale query and closes when the caller swaps the region list", async () => {
    const { rerender } = render(<Harness regions={REGIONS} />);
    const input = screen.getByTestId("facility-cost-region-search");
    open(input);
    fireEvent.change(input, { target: { value: "강화" } });
    expect(optionLabels()).toEqual(["인천 강화군"]);
    // The caller changed the waste stream: a different calculable set arrives.
    rerender(<Harness regions={[{ code: "KR-SGIS-11110", name: "종로구" }]} />);
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});
