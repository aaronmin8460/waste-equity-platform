// @vitest-environment jsdom

/**
 * Tests for the shared dashboard primitives added by the civic-dashboard refresh:
 * SectionCard, PageHeader, FilterChip, DataStatusBadge, and the KpiCard unit slot.
 *
 * They cover the two contract families each primitive's docblock states:
 *   - accessibility (heading semantics, accessible names, state carried by more
 *     than color, no stray landmarks/headings), and
 *   - data integrity (a missing value is never rendered as 0, a derived figure is
 *     never presented as an official one, no served string is reformatted).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DATA_STATUS_META } from "../../lib/glossary";
import DataStatusBadge from "./DataStatusBadge";
import FilterChip from "./FilterChip";
import KpiCard from "./KpiCard";
import PageHeader from "./PageHeader";
import SectionCard from "./SectionCard";

afterEach(cleanup);

describe("SectionCard", () => {
  it("names a titled card via its heading, as a labelled section", () => {
    render(
      <SectionCard title="지역 부담 순위" testId="card">
        <p>본문</p>
      </SectionCard>,
    );
    const card = screen.getByTestId("card");
    expect(card.tagName).toBe("SECTION");

    // The accessible name comes FROM the visible heading — not a duplicated
    // aria-label that could drift away from what is on screen.
    const headingId = card.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    const heading = document.getElementById(headingId!);
    expect(heading?.textContent).toBe("지역 부담 순위");
    expect(screen.getByRole("region", { name: "지역 부담 순위" })).toBe(card);
  });

  it("defaults to h2 and honours an explicit level", () => {
    const { rerender } = render(
      <SectionCard title="제목" testId="card">
        <p>본문</p>
      </SectionCard>,
    );
    expect(screen.getByTestId("card").querySelector("h2")).not.toBeNull();

    rerender(
      <SectionCard title="제목" headingLevel={3} testId="card">
        <p>본문</p>
      </SectionCard>,
    );
    const card = screen.getByTestId("card");
    expect(card.querySelector("h3")).not.toBeNull();
    // Never an h1: the view's single h1 belongs to PageHeader.
    expect(card.querySelector("h1")).toBeNull();
  });

  it("renders an untitled card as a plain div, not a nameless landmark", () => {
    render(
      <SectionCard testId="card">
        <p>본문</p>
      </SectionCard>,
    );
    const card = screen.getByTestId("card");
    expect(card.tagName).toBe("DIV");
    // A nameless region would add a landmark with nothing to announce.
    expect(screen.queryByRole("region")).toBeNull();
    expect(card.getAttribute("aria-labelledby")).toBeNull();
  });

  it("keeps the header aside out of the accessible name", () => {
    render(
      <SectionCard title="반입량" headerAside={<span>2024년</span>} testId="card">
        <p>본문</p>
      </SectionCard>,
    );
    // The metadata is visible…
    expect(screen.getByTestId("card").textContent).toContain("2024년");
    // …but the region is still named by the title alone.
    expect(screen.getByRole("region", { name: "반입량" })).toBeDefined();
  });

  it("accepts a fixed heading id and keeps it as the accessible name source", () => {
    // Added for the facility-cost setup step the results view returns focus to
    // (docs/ui-refresh/facility-cost-dashboard.md).
    render(
      <SectionCard title="1. 처리할 지역" headingId="fc-step-regions" testId="card">
        <p>본문</p>
      </SectionCard>,
    );
    const card = screen.getByTestId("card");
    expect(card.getAttribute("aria-labelledby")).toBe("fc-step-regions");
    expect(document.getElementById("fc-step-regions")?.textContent).toBe("1. 처리할 지역");
    // No ref was handed in, so the heading is not made focusable.
    expect(document.getElementById("fc-step-regions")?.getAttribute("tabindex")).toBeNull();
  });

  it("makes a ref'd heading a programmatic focus target, never a Tab stop", () => {
    function Host() {
      const ref = useRef<HTMLHeadingElement | null>(null);
      return (
        <>
          <button type="button" onClick={() => ref.current?.focus()}>
            이동
          </button>
          <SectionCard title="제목" headingRef={ref} testId="card">
            <p>본문</p>
          </SectionCard>
        </>
      );
    }
    render(<Host />);
    const heading = screen.getByRole("heading", { name: "제목" });
    expect(heading.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(screen.getByRole("button", { name: "이동" }));
    expect(document.activeElement).toBe(heading);
  });

  it("is a bordered surface with no shadow utility", () => {
    render(
      <SectionCard title="제목" testId="card">
        <p>본문</p>
      </SectionCard>,
    );
    const className = screen.getByTestId("card").className;
    expect(className).toContain("wep-card");
    // Cards are separated by a hairline border; shadows mean "floating".
    expect(className).not.toContain("shadow");
  });
});

describe("PageHeader", () => {
  it("renders the view's single h1 with its description", () => {
    const { container } = render(
      <PageHeader title="지역 부담" description="서울 · 인천 · 경기 공공자료" testId="ph" />,
    );
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("지역 부담");
    expect(screen.getByTestId("ph").textContent).toContain("서울 · 인천 · 경기 공공자료");
  });

  it("renders nothing page-specific when only a title is given", () => {
    render(<PageHeader title="제목" testId="ph" />);
    // No invented description, metadata, count, or status.
    expect(screen.getByTestId("ph").textContent).toBe("제목");
  });

  it("renders the optional metadata slot and keeps children after the heading", () => {
    const { container } = render(
      <PageHeader title="제목" meta={<span>2024년 기준</span>} testId="ph">
        <p data-testid="orientation">안내 문구</p>
      </PageHeader>,
    );
    expect(screen.getByTestId("ph").textContent).toContain("2024년 기준");

    // Document order: the h1 precedes the supporting content it heads.
    const h1 = container.querySelector("h1")!;
    const orientation = screen.getByTestId("orientation");
    expect(h1.compareDocumentPosition(orientation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("FilterChip", () => {
  it("is a native button carrying its state in aria-pressed", () => {
    render(<FilterChip label="2024년" selected={false} onToggle={() => {}} testId="chip" />);
    const chip = screen.getByTestId("chip");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.getAttribute("type")).toBe("button");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
  });

  it("signals selection with a shape as well as color", () => {
    const { rerender } = render(
      <FilterChip label="2024년" selected={false} onToggle={() => {}} testId="chip" />,
    );
    expect(screen.getByTestId("chip").querySelector(".wep-filter-chip-check")).toBeNull();

    rerender(<FilterChip label="2024년" selected onToggle={() => {}} testId="chip" />);
    const chip = screen.getByTestId("chip");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    // A check mark: present vs absent survives grayscale and color deficiency.
    const check = chip.querySelector(".wep-filter-chip-check");
    expect(check).not.toBeNull();
    // Hidden from AT — aria-pressed already states the fact; both would double it.
    expect(check?.getAttribute("aria-hidden")).toBe("true");
    // The check must not pollute the accessible name.
    expect(screen.getByRole("button", { name: "2024년" })).toBe(chip);
  });

  it("reports the NEXT state through onToggle", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <FilterChip label="2024년" selected={false} onToggle={onToggle} testId="chip" />,
    );
    fireEvent.click(screen.getByTestId("chip"));
    expect(onToggle).toHaveBeenCalledWith(true);

    rerender(<FilterChip label="2024년" selected onToggle={onToggle} testId="chip" />);
    fireEvent.click(screen.getByTestId("chip"));
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it("does not fire while disabled and takes an explicit accessible name", () => {
    const onToggle = vi.fn();
    render(
      <FilterChip
        label="2024년"
        ariaLabel="자료 기준 시점 2024년"
        selected={false}
        onToggle={onToggle}
        disabled
        testId="chip"
      />,
    );
    fireEvent.click(screen.getByTestId("chip"));
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "자료 기준 시점 2024년" })).toBeDefined();
  });
});

describe("DataStatusBadge", () => {
  it("labels every provenance with text, never color alone", () => {
    for (const status of ["reported", "derived", "caveat", "missing", "excluded"] as const) {
      cleanup();
      render(<DataStatusBadge status={status} testId="badge" />);
      const badge = screen.getByTestId("badge");
      expect(badge.textContent).toBe(DATA_STATUS_META[status].primary);
      expect(badge.className).toContain(`wep-badge-${status}`);
      expect(badge.getAttribute("data-status")).toBe(status);
    }
  });

  it("distinguishes a missing value from a reported one — and never renders 0", () => {
    const { rerender } = render(<DataStatusBadge status="missing" testId="badge" />);
    const missing = screen.getByTestId("badge");
    expect(missing.textContent).toBe("자료 없음");
    // "no value was served" is not "the measured value is 0".
    expect(missing.textContent).not.toContain("0");
    // The missing tone is its own class, so it can never be styled as the
    // lightest step of an analytical ramp (which would read as a low value).
    expect(missing.className).toContain("wep-badge-missing");
    expect(missing.className).not.toContain("wep-badge-caveat");

    rerender(<DataStatusBadge status="reported" testId="badge" />);
    expect(screen.getByTestId("badge").className).not.toContain("wep-badge-missing");
  });

  it("marks a derived value so it is not read as an official published figure", () => {
    render(<DataStatusBadge status="derived" testId="badge" />);
    expect(screen.getByTestId("badge").textContent).toBe("계산값");
    expect(DATA_STATUS_META.derived.detail).toContain("공식 발표 수치가 아님");
  });

  it("shows the SERVED reason as the badge's title when one is given", () => {
    render(<DataStatusBadge status="missing" reason="공식 인구 미확정" testId="badge" />);
    expect(screen.getByTestId("badge").getAttribute("title")).toBe("공식 인구 미확정");
  });

  it("renders a served override label verbatim", () => {
    render(<DataStatusBadge status="missing" label="공식 인구 미확정" testId="badge" />);
    expect(screen.getByTestId("badge").textContent).toBe("공식 인구 미확정");
  });
});

describe("KpiCard unit and status slots", () => {
  it("renders the unit beside the value without altering the value string", () => {
    render(
      <dl>
        <KpiCard label="설치비" value="1,277.222078" unit="억원" valueTestId="v" />
      </dl>,
    );
    const value = screen.getByTestId("v");
    // The exact served decimal is preserved and the unit is appended visually only.
    expect(value.textContent).toBe("1,277.222078억원");
    expect(value.className).toContain("tabular-nums");
  });

  it("drops the unit entirely when the value is unavailable", () => {
    render(
      <dl>
        <KpiCard
          label="주민 1인당 환산 지방비"
          unit="억원"
          unavailableReason="공식 인구 미확정"
          valueTestId="v"
        />
      </dl>,
    );
    // A bare unit beside a reason would imply a quantity that was never served.
    const value = screen.getByTestId("v");
    expect(value.textContent).toBe("공식 인구 미확정");
    expect(value.textContent).not.toContain("억원");
  });

  it("accepts a provenance badge without disturbing the label", () => {
    render(
      <dl>
        <KpiCard
          label="설치비"
          value="120.75"
          unit="억원"
          status={<DataStatusBadge status="derived" testId="badge" />}
          testId="kpi"
        />
      </dl>,
    );
    expect(screen.getByTestId("badge").textContent).toBe("계산값");
    expect(screen.getByTestId("kpi").querySelector("dt")?.textContent).toContain("설치비");
  });
});
