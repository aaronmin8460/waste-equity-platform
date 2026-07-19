// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import MapLegendOverlay from "./MapLegendOverlay";

afterEach(cleanup);

function renderScenarioLegend(scenarioActive: boolean) {
  render(
    <MapLegendOverlay
      mode="suitability"
      scoreClasses={[
        { color: "#eee", range: "< 20" },
        { color: "#ccc", range: "20 – 40" },
      ]}
      eligibleColor="#0a0"
      reviewColor="#b45309"
      excludedColor="#888"
      statusVisibility={{ ELIGIBLE: true, REVIEW_REQUIRED: true, EXCLUDED: false }}
      onToggleStatus={vi.fn()}
      statusLabels={{
        ELIGIBLE: "적합",
        REVIEW_REQUIRED: "검토",
        EXCLUDED: "제외",
      }}
      stabilityAvailable
      stableOnly={false}
      onToggleStableOnly={vi.fn()}
      stableOutlineColor="#d0f"
      disclaimer="분석용"
      scenarioActive={scenarioActive}
      scenarioWeights={
        scenarioActive
          ? { zoning: "0.35000000", road: "0.25000000", equity: "0.25000000", demand: "0.15000000" }
          : null
      }
    />,
  );
}

describe("MapLegendOverlay scenario context", () => {
  it("shows the user-scenario header with applied weights when active", () => {
    renderScenarioLegend(true);
    const header = screen.getByTestId("scenario-legend-header");
    expect(header.textContent).toContain("사용자 가정 기반 점수");
    // applied Z/R/E/D percentages
    expect(header.textContent).toContain("35%");
    expect(header.textContent).toContain("15%");
  });

  it("clarifies stability is the stored run's, not the scenario's", () => {
    renderScenarioLegend(true);
    expect(screen.getByTestId("scenario-stability-note").textContent).toContain(
      "사용자 시나리오의 안정성 평가가 아닙니다",
    );
  });

  it("hides the scenario header for stored-profile legends", () => {
    renderScenarioLegend(false);
    expect(screen.queryByTestId("scenario-legend-header")).toBeNull();
    expect(screen.queryByTestId("scenario-stability-note")).toBeNull();
  });
});
