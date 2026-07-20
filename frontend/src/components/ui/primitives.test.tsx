// @vitest-environment jsdom

/**
 * Tests for the remaining shared UI primitives introduced in Phase 1:
 * InfoBanner, Accordion, KpiCard, Chip, Skeleton, EmptyState.
 *
 * These cover the accessibility contracts and the data-integrity contracts stated in
 * each component's docblock — in particular that a KpiCard with no value renders its
 * served unavailability reason and never a fabricated `0` (repo AGENTS.md).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Accordion from "./Accordion";
import Chip from "./Chip";
import EmptyState from "./EmptyState";
import InfoBanner from "./InfoBanner";
import KpiCard from "./KpiCard";
import Skeleton from "./Skeleton";

afterEach(cleanup);

describe("InfoBanner", () => {
  it("conveys severity with a text label, not color alone", () => {
    render(
      <InfoBanner tone="warning" testId="b">
        표준공사비 기반 산정액입니다.
      </InfoBanner>,
    );
    expect(screen.getByTestId("b-tone").textContent).toContain("주의");
    expect(screen.getByTestId("b").className).toContain("wep-banner-warning");
  });

  it("supports exactly the four semantic tones", () => {
    for (const [tone, word] of [
      ["info", "알림"],
      ["warning", "주의"],
      ["error", "오류"],
      ["success", "완료"],
    ] as const) {
      cleanup();
      render(
        <InfoBanner tone={tone} testId="b">
          본문
        </InfoBanner>,
      );
      expect(screen.getByTestId("b").className).toContain(`wep-banner-${tone}`);
      expect(screen.getByTestId("b-tone").textContent).toContain(word);
    }
  });

  it("renders an optional title alongside the tone word", () => {
    render(
      <InfoBanner tone="info" title="자료 한계" testId="b">
        본문
      </InfoBanner>,
    );
    expect(screen.getByTestId("b-tone").textContent).toBe("알림 · 자료 한계");
  });

  it("is not a live region unless a role is explicitly requested", () => {
    const { rerender } = render(
      <InfoBanner tone="warning" testId="b">
        상시 안내
      </InfoBanner>,
    );
    // A standing disclaimer must not interrupt a screen reader on every render.
    expect(screen.getByTestId("b").getAttribute("role")).toBeNull();

    rerender(
      <InfoBanner tone="error" role="alert" testId="b">
        계산에 실패했습니다.
      </InfoBanner>,
    );
    expect(screen.getByTestId("b").getAttribute("role")).toBe("alert");
  });
});

describe("Accordion", () => {
  it("uses a native details/summary disclosure", () => {
    const { container } = render(
      <Accordion label="출처와 계산 방법" testId="acc">
        <p>본문</p>
      </Accordion>,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.tagName).toBe("DETAILS");
    expect(container.querySelector("summary")).not.toBeNull();
    expect(screen.getByTestId("acc-summary").textContent).toContain("출처와 계산 방법");
  });

  it("is collapsed by default and honours defaultOpen", () => {
    const { container, rerender } = render(
      <Accordion label="자세히" testId="acc">
        <p>본문</p>
      </Accordion>,
    );
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);

    rerender(
      <Accordion label="자세히" defaultOpen testId="acc">
        <p>본문</p>
      </Accordion>,
    );
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(true);
  });

  it("does NOT reuse .mobile-collapsible, which force-opens at desktop widths", () => {
    const { container } = render(
      <Accordion label="자세히">
        <p>본문</p>
      </Accordion>,
    );
    const details = container.querySelector("details");
    expect(details?.className).toContain("wep-accordion");
    // Sharing that class would make every accordion permanently open on desktop —
    // the opposite of this component's contract.
    expect(details?.className).not.toContain("mobile-collapsible");
  });

  it("hides the decorative chevron from assistive tech", () => {
    const { container } = render(
      <Accordion label="자세히">
        <p>본문</p>
      </Accordion>,
    );
    const chevron = container.querySelector(".wep-accordion-chevron");
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("KpiCard", () => {
  it("renders the label and the value verbatim as a dt/dd pair", () => {
    const { container } = render(
      <dl>
        <KpiCard label="표준공사비 기반 설치비 산정액" value="1,277.222078 억원" valueTestId="v" />
      </dl>,
    );
    expect(container.querySelector("dt")?.textContent).toBe("표준공사비 기반 설치비 산정액");
    // The exact backend decimal string is preserved — never re-parsed or rounded.
    expect(screen.getByTestId("v").textContent).toBe("1,277.222078 억원");
  });

  it("renders the served reason instead of a value when unavailable — never 0", () => {
    render(
      <dl>
        <KpiCard label="주민 1인당 환산 지방비" unavailableReason="공식 인구 미확정" valueTestId="v" />
      </dl>,
    );
    const value = screen.getByTestId("v");
    expect(value.textContent).toBe("공식 인구 미확정");
    expect(value.textContent).not.toContain("0");
  });

  it("lets the unavailability reason win over any value passed alongside it", () => {
    // Defensive: a caller that passes both must still not display a number.
    render(
      <dl>
        <KpiCard label="지표" value="0" unavailableReason="자료 없음" valueTestId="v" />
      </dl>,
    );
    expect(screen.getByTestId("v").textContent).toBe("자료 없음");
  });

  it("gives the hero size a visually dominant value", () => {
    const { rerender } = render(
      <dl>
        <KpiCard label="지표" value="120.75 억원" size="hero" valueTestId="v" />
      </dl>,
    );
    expect(screen.getByTestId("v").className).toContain("text-3xl");

    rerender(
      <dl>
        <KpiCard label="지표" value="120.75 억원" valueTestId="v" />
      </dl>,
    );
    expect(screen.getByTestId("v").className).toContain("text-xl");
  });

  it("aligns digits with tabular numerals", () => {
    render(
      <dl>
        <KpiCard label="지표" value="42,262.5원" valueTestId="v" />
      </dl>,
    );
    expect(screen.getByTestId("v").className).toContain("tabular-nums");
  });
});

describe("Chip", () => {
  it("renders its label and no remove control by default", () => {
    render(<Chip label="서울 중구" testId="chip" />);
    expect(screen.getByTestId("chip").textContent).toContain("서울 중구");
    expect(screen.queryByTestId("chip-remove")).toBeNull();
  });

  it("gives the remove button an accessible name that includes the chip label", () => {
    const onRemove = vi.fn();
    render(<Chip label="서울 중구" onRemove={onRemove} testId="chip" />);
    const remove = screen.getByTestId("chip-remove");
    // Never a bare "✕": the name says WHAT is removed.
    expect(remove.getAttribute("aria-label")).toBe("서울 중구 제거");
    expect(screen.getByRole("button", { name: "서울 중구 제거" })).toBe(remove);

    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe("Skeleton", () => {
  it("is decorative and hidden from assistive tech", () => {
    render(<Skeleton testId="sk" />);
    // The meaningful loading announcement must live in a separate role="status".
    expect(screen.getByTestId("sk").getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the requested number of placeholder bars and no text", () => {
    render(<Skeleton lines={3} testId="sk" />);
    const root = screen.getByTestId("sk");
    expect(root.querySelectorAll(".wep-skeleton")).toHaveLength(3);
    // No fabricated content that could be mistaken for official data.
    expect(root.textContent).toBe("");
  });
});

describe("EmptyState", () => {
  it("renders the title, the reason, and an optional action", () => {
    render(
      <EmptyState
        title="표시할 자료가 없습니다"
        description="현재 조건에 맞는 공식 자료가 없습니다."
        action={<button type="button">다시 시도</button>}
        testId="empty"
      />,
    );
    const root = screen.getByTestId("empty");
    expect(root.textContent).toContain("표시할 자료가 없습니다");
    expect(root.textContent).toContain("현재 조건에 맞는 공식 자료가 없습니다.");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeDefined();
  });

  it("renders no fabricated zero when only a title is given", () => {
    render(<EmptyState title="자료 없음" testId="empty" />);
    // "no data served" is not "the measured value is 0".
    expect(screen.getByTestId("empty").textContent).toBe("자료 없음");
  });
});
