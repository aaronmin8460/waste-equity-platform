// @vitest-environment jsdom

/**
 * WetlandLayerControl tests — the inland-wetland layer toggle, type filter/legend,
 * designation filter, disclaimers, and source disclosure (Phase 1B-2).
 */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import WetlandLayerControl from "./WetlandLayerControl";
import { WETLAND_TYPES } from "../lib/wetland";

function baseProps(overrides: Partial<React.ComponentProps<typeof WetlandLayerControl>> = {}) {
  return {
    show: false,
    onToggleShow: vi.fn(),
    typeVisibility: { 하천습지: true, 호수습지: true, 산지습지: true, 인공습지: true },
    onToggleType: vi.fn(),
    designationOnly: false,
    onToggleDesignationOnly: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("WetlandLayerControl", () => {
  it("renders the layer toggle OFF by default and fires onToggleShow", () => {
    const onToggleShow = vi.fn();
    render(<WetlandLayerControl {...baseProps({ onToggleShow })} />);
    const toggle = screen.getByTestId("wetland-layer-toggle") as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(onToggleShow).toHaveBeenCalledTimes(1);
  });

  it("uses the canonical Korean layer label", () => {
    render(<WetlandLayerControl {...baseProps()} />);
    expect(screen.getByTestId("wetland-layer-summary")).toHaveTextContent("내륙습지 목록");
  });

  it("renders a legend/filter row for every wetland type", () => {
    render(<WetlandLayerControl {...baseProps({ show: true })} />);
    for (const type of WETLAND_TYPES) {
      const box = screen.getByTestId(`wetland-type-toggle-${type}`) as HTMLInputElement;
      expect(box).toBeInTheDocument();
      expect(box.checked).toBe(true);
    }
    // The four suggested categories are all present.
    expect(screen.getByText("하천습지")).toBeInTheDocument();
    expect(screen.getByText("호수습지")).toBeInTheDocument();
    expect(screen.getByText("산지습지")).toBeInTheDocument();
    expect(screen.getByText("인공습지")).toBeInTheDocument();
  });

  it("disables the type/designation filters while the layer is off", () => {
    render(<WetlandLayerControl {...baseProps({ show: false })} />);
    expect((screen.getByTestId("wetland-type-toggle-하천습지") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId("wetland-designation-toggle") as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it("fires onToggleType and onToggleDesignationOnly", () => {
    const onToggleType = vi.fn();
    const onToggleDesignationOnly = vi.fn();
    render(
      <WetlandLayerControl
        {...baseProps({ show: true, onToggleType, onToggleDesignationOnly })}
      />,
    );
    fireEvent.click(screen.getByTestId("wetland-type-toggle-호수습지"));
    expect(onToggleType).toHaveBeenCalledWith("호수습지");
    fireEvent.click(screen.getByTestId("wetland-designation-toggle"));
    expect(onToggleDesignationOnly).toHaveBeenCalledTimes(1);
  });

  it("shows the statutory-status disclaimer and the UM901 distinction", () => {
    render(<WetlandLayerControl {...baseProps()} />);
    expect(screen.getByTestId("wetland-disclaimer")).toHaveTextContent(
      "모든 습지가 법정 습지보호지역을 의미하지 않습니다",
    );
    expect(screen.getByTestId("wetland-um901-distinction")).toHaveTextContent(
      "UM901 보호구역 레이어에서 별도로 확인",
    );
  });

  it("discloses provider, reference date, and both CRS, plus the legal separation", () => {
    render(<WetlandLayerControl {...baseProps()} />);
    const disclosure = screen.getByTestId("wetland-source-disclosure");
    expect(disclosure).toHaveTextContent("국립생태원");
    expect(disclosure).toHaveTextContent("2022-07-20");
    expect(disclosure).toHaveTextContent("EPSG:5186");
    expect(disclosure).toHaveTextContent("EPSG:4326");
    expect(disclosure).toHaveTextContent("법정 보호지역과 별도");
  });

  it("uses no score/exclusion/legal-determination language", () => {
    const { container } = render(<WetlandLayerControl {...baseProps({ show: true })} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("점수");
    expect(text).not.toContain("제외지역");
    expect(text).not.toContain("입지 불가");
    expect(text).not.toContain("규제지역");
  });
});
