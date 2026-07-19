import { describe, expect, it } from "vitest";

import { rankRegions, type RankableRegion } from "./ranking";
import {
  type Ctx2D,
  MAP_EXCLUSION_NOTE,
  buildComparisonReport,
  buildEquityReport,
  buildScenarioReport,
  drawReport,
} from "./report";

const WHEN = new Date(2026, 6, 20, 3, 7, 9);

/** A stub 2D context that records every fillText and measures monospace-ish. */
function stubCtx(): Ctx2D & { texts: string[] } {
  const texts: string[] = [];
  return {
    font: "",
    fillStyle: "#000",
    textBaseline: "alphabetic" as CanvasTextBaseline,
    texts,
    fillRect() {},
    fillText(text: string) {
      texts.push(text);
    },
    measureText(text: string) {
      return { width: text.length * 7 };
    },
  };
}

describe("buildEquityReport", () => {
  const regions: RankableRegion[] = [
    { code: "41135", name: "성남시", value: { numeric: 500, display: "500" } },
    { code: "11110", name: "종로구", value: { numeric: 300, display: "300" } },
  ];
  const model = buildEquityReport({
    metricLabel: "인구",
    unit: "persons",
    source: "SGIS (sgis)",
    referencePeriod: "2024",
    accountingBasis: null,
    scope: "all",
    result: rankRegions(regions, "all", 10),
    when: WHEN,
  });

  it("builds a titled, dated model that names the map exclusion", () => {
    expect(model.blocks[0]).toEqual({ kind: "title", text: "지역 부담 순위" });
    expect(model.generatedAt).toBe("2026-07-20 03:07");
    expect(model.mapExclusionNote).toBe(MAP_EXCLUSION_NOTE);
  });

  it("includes both high and low tables and a disclaimer", () => {
    const kinds = model.blocks.map((b) => b.kind);
    expect(kinds.filter((k) => k === "table")).toHaveLength(2);
    expect(kinds).toContain("disclaimer");
  });

  it("renders every text block onto the canvas including the map-exclusion note", () => {
    const ctx = stubCtx();
    const height = drawReport(ctx, model, { width: 720 });
    expect(height).toBeGreaterThan(0);
    const joined = ctx.texts.join("\n");
    expect(joined).toContain("지역 부담 순위");
    expect(joined).toContain("성남시");
    expect(joined).toContain("생성 시각: 2026-07-20 03:07");
    expect(joined).toContain("지도를 제외한 요약");
  });
});

describe("buildComparisonReport", () => {
  it("keeps 자료 없음 distinct from a value in the table", () => {
    const model = buildComparisonReport({
      metricLabel: "1인당 생활계 발생량",
      unit: "kg/인/년",
      source: "RCIS",
      referencePeriod: "2022",
      accountingBasis: "ORIGIN_BASED_TREATMENT_OUTCOME",
      regions: [
        { code: "11110", name: "종로구", display: "83,721.3", hasValue: true },
        { code: "28710", name: "강화군", display: "자료 없음", hasValue: false },
      ],
      when: WHEN,
    });
    const table = model.blocks.find((b) => b.kind === "table");
    expect(table).toBeDefined();
    if (table && table.kind === "table") {
      expect(table.rows[0]).toEqual(["종로구", "83,721.3", "공식 값"]);
      expect(table.rows[1]).toEqual(["강화군", "", "자료 없음"]); // missing → empty cell
    }
  });
});

describe("buildScenarioReport", () => {
  const model = buildScenarioReport({
    runId: 48,
    policyVersion: "suitability-policy-v2",
    derivationVersion: "suitability-screening-v3",
    candidateGridVersion: "capital-grid-500m-v1",
    methodVersion: "user-weight-scenario-v1",
    scenarioHashShort: "abc123",
    weights: { zoning: "0.25", road: "0.25", equity: "0.25", demand: "0.25" },
    compareProfile: "baseline",
    candidates: [
      {
        custom_rank: 1,
        custom_score: "88.1234",
        sido_region_name: "인천광역시",
        sigungu_region_name: "강화군",
        candidate_key: "cap500-000123",
        comparison_rank: 3,
        rank_delta: 2,
        rank_change_direction: "up",
        zoning_score: "90",
        road_score: "70",
        equity_score: "95",
        demand_score: "80",
        stability_class: "STABLE",
        stable_count: 3,
      },
    ],
    when: WHEN,
  });

  it("labels the temporary, non-official nature and uses named component codes", () => {
    const disclaimer = model.blocks.find((b) => b.kind === "disclaimer");
    expect(disclaimer && disclaimer.kind === "disclaimer" && disclaimer.text).toContain(
      "임시 비교",
    );
    const section = model.blocks.find((b) => b.kind === "section");
    if (section && section.kind === "section") {
      expect(section.rows.map((r) => r[0])).toContain("토지이용 조건(Z)");
    }
  });

  it("draws without throwing using a stub context", () => {
    const ctx = stubCtx();
    expect(() => drawReport(ctx, model, { width: 720 })).not.toThrow();
    expect(ctx.texts.join("\n")).toContain("강화군");
  });
});
