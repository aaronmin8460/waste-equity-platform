// @vitest-environment jsdom

/**
 * Floating map legend tests.
 *
 * MapLegendOverlay is a PURE PRESENTATION component: it renders exactly the rows /
 * score classes / status colors it is given, and never computes breaks or classes
 * itself. These assert the equity rows + no-data row + unit, the suitability status
 * checkboxes driving the passed-in canonical toggle handler (not a local copy), the
 * score classes, the accessible mobile collapse control, that no break math happens
 * inside the component (arbitrary passed-in rows render verbatim), and that the body
 * is a bounded, internally-scrollable container.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MapLegendOverlay from "./MapLegendOverlay";
import type { StatusVisibility } from "./MapView";
import type { SuitabilityStatus } from "../lib/api";

afterEach(cleanup);

const EQUITY_ROWS = [
  { color: "#eff3ff", range: "< 100", classNumber: 1 },
  { color: "#c6dbef", range: "100 – 200", classNumber: 2 },
  { color: "#084594", range: "≥ 200", classNumber: 3 },
];

function renderEquity() {
  return render(
    <MapLegendOverlay
      mode="equity"
      metricLabel="인구 (Population)"
      unit="persons"
      methodNote="분위수 7단계 (7-class quantiles)"
      rows={EQUITY_ROWS}
      noDataColor="#d9d9d9"
    />,
  );
}

const STATUS_LABELS: Record<SuitabilityStatus, string> = {
  ELIGIBLE: "적합 (eligible)",
  REVIEW_REQUIRED: "검토 필요 (review)",
  EXCLUDED: "제외 (excluded)",
};

const SCORE_CLASSES = [
  { color: "#f1eef6", range: "< 20" },
  { color: "#bdc9e1", range: "20 – 40" },
  { color: "#74a9cf", range: "40 – 60" },
  { color: "#2b8cbe", range: "60 – 80" },
  { color: "#045a8d", range: "≥ 80" },
];

function renderSuitability(
  statusVisibility: StatusVisibility,
  onToggleStatus: (s: SuitabilityStatus) => void,
) {
  return render(
    <MapLegendOverlay
      mode="suitability"
      scoreClasses={SCORE_CLASSES}
      eligibleColor="#2b8cbe"
      reviewColor="#e8a33d"
      excludedColor="#9aa2ad"
      statusVisibility={statusVisibility}
      onToggleStatus={onToggleStatus}
      statusLabels={STATUS_LABELS}
      disclaimer="분석용 스크리닝이며 법적 입지 결정이 아닙니다."
    />,
  );
}

describe("equity legend", () => {
  it("renders exactly the passed rows with the unit and a class number", () => {
    renderEquity();
    const rows = screen.getAllByTestId("choropleth-legend-row");
    expect(rows).toHaveLength(EQUITY_ROWS.length);
    for (const row of rows) {
      expect(row.textContent).toContain("급");
      expect(row.textContent).toContain("persons");
    }
    // The exact range labels are shown verbatim (no reclassification inside the
    // component — it renders what the page computed from the active scale).
    expect(rows[0].textContent).toContain("< 100");
    expect(rows[1].textContent).toContain("100 – 200");
    expect(rows[2].textContent).toContain("≥ 200");
  });

  it("always shows an explicit no-data row, never a 0 class", () => {
    renderEquity();
    const nodata = screen.getByTestId("choropleth-legend-nodata");
    expect(nodata.textContent).toContain("데이터 없음");
  });

  it("shows the classification-method note and the active metric label", () => {
    renderEquity();
    expect(screen.getByTestId("choropleth-scale-method").textContent).toContain("분위수 7단계");
    expect(screen.getByTestId("legend-metric-label").textContent).toContain("인구 (Population)");
  });

  it("renders arbitrary passed-in rows verbatim (no break math inside the component)", () => {
    render(
      <MapLegendOverlay
        mode="equity"
        metricLabel="테스트"
        unit="kg/인/년"
        methodNote="로그 간격 9단계"
        rows={[{ color: "#000000", range: "SENTINEL-RANGE", classNumber: 1 }]}
        noDataColor="#d9d9d9"
      />,
    );
    const rows = screen.getAllByTestId("choropleth-legend-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("SENTINEL-RANGE");
    expect(rows[0].textContent).toContain("kg/인/년");
  });
});

describe("suitability legend + status filter", () => {
  it("renders a native checkbox per status with an accessible text label", () => {
    renderSuitability({ ELIGIBLE: true, REVIEW_REQUIRED: true, EXCLUDED: false }, () => undefined);
    for (const st of ["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"] as SuitabilityStatus[]) {
      const box = screen.getByTestId(`status-toggle-${st}`) as HTMLInputElement;
      expect(box.tagName).toBe("INPUT");
      expect(box.getAttribute("type")).toBe("checkbox");
    }
    // Status is conveyed by text labels, not color alone.
    expect(screen.getByText("적합 (eligible)")).toBeDefined();
    expect(screen.getByText("검토 필요 (review)")).toBeDefined();
    expect(screen.getByText("제외 (excluded)")).toBeDefined();
    // Reflects the passed visibility (EXCLUDED off).
    expect((screen.getByTestId("status-toggle-EXCLUDED") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("status-toggle-ELIGIBLE") as HTMLInputElement).checked).toBe(true);
  });

  it("calls the canonical toggle handler with the status, not a local copy", () => {
    const onToggle = vi.fn();
    renderSuitability({ ELIGIBLE: true, REVIEW_REQUIRED: true, EXCLUDED: false }, onToggle);
    fireEvent.click(screen.getByTestId("status-toggle-EXCLUDED"));
    expect(onToggle).toHaveBeenCalledWith("EXCLUDED");
    fireEvent.click(screen.getByTestId("status-toggle-ELIGIBLE"));
    expect(onToggle).toHaveBeenCalledWith("ELIGIBLE");
  });

  it("renders the eligible score classes and the screening disclaimer", () => {
    renderSuitability({ ELIGIBLE: true, REVIEW_REQUIRED: true, EXCLUDED: false }, () => undefined);
    const classes = screen.getAllByTestId("score-class-row");
    expect(classes).toHaveLength(SCORE_CLASSES.length);
    expect(classes[0].textContent).toContain("< 20");
    expect(classes[4].textContent).toContain("≥ 80");
    expect(screen.getByTestId("suitability-legend-note").textContent).toContain(
      "법적 입지 결정이 아닙니다",
    );
  });
});

describe("floating control", () => {
  it("exposes an accessible, labelled collapse control (not icon-only)", () => {
    renderEquity();
    const summary = screen.getByTestId("map-legend-summary");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.textContent).toContain("범례 (Legend)");
  });

  it("keeps long content in a bounded, internally-scrollable container", () => {
    renderEquity();
    const details = screen.getByTestId("map-legend");
    const body = within(details).getByText("범례 (Legend) — persons").closest(".map-legend-body");
    expect(body).not.toBeNull();
    const cls = body?.getAttribute("class") ?? "";
    expect(cls).toContain("overflow-y-auto");
    expect(cls).toMatch(/max-h-/);
  });
});
