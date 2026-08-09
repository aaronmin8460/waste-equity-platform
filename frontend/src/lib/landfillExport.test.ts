/**
 * 폐기물 처리 현황 XLSX — the fee/payment separation, enforced in the workbook.
 *
 * The page holds two money figures on different accounting bases. A spreadsheet
 * is where conflating them does the most damage, because two adjacent columns
 * invite a third that adds them. These tests pin that the separation is
 * STRUCTURAL: the official-fee workbook simply has no municipal column to add.
 */

import { describe, expect, it } from "vitest";

import type { LandfillSummary, LandfillTrends } from "./api";
import {
  buildOriginSheet,
  buildTrendSheet,
  buildWasteSheet,
  landfillFilenameBase,
  periodLabel,
} from "./landfillExport";

function summary(over: Partial<LandfillSummary> = {}): LandfillSummary {
  return {
    period: { reference_year: 2024, reference_month: null },
    origin_filter: null,
    waste_filter: null,
    accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
    destination_code: "SL",
    destination_name: "수도권매립지",
    total_quantity_kg: "1000",
    total_quantity_tons: "1",
    total_inbound_fee_krw: "50000",
    effective_fee_per_ton: "50000",
    fee_per_capita: { value: null, unavailable_reason: "NO_MATCHING_POPULATION_PERIOD" },
    largest_origin_share: null,
    largest_waste_share: null,
    origin_shares: [
      {
        origin_region_code: "11",
        origin_sgis_code: "11",
        origin_name: "서울시",
        origin_name_en: "Seoul",
        quantity_kg: "600",
        quantity_tons: "0.6",
        inbound_fee_krw: "30000",
        quantity_share: "0.6",
        effective_fee_per_ton: "50000",
        fee_per_capita: { value: "12.5", unavailable_reason: null },
      },
      {
        origin_region_code: "28",
        origin_sgis_code: "28",
        origin_name: "인천시",
        origin_name_en: "Incheon",
        quantity_kg: "400",
        quantity_tons: "0.4",
        inbound_fee_krw: "20000",
        quantity_share: null,
        effective_fee_per_ton: null,
        fee_per_capita: { value: null, unavailable_reason: "ZERO_POPULATION" },
      },
    ],
    top_waste_types: [
      { waste_name: "생활폐기물", quantity_kg: "600", quantity_tons: "0.6", inbound_fee_krw: "30000", quantity_share: "0.6" },
    ],
    row_count: 2,
    evidence: {},
    sources: [],
    derivation_version: "landfill-flow-v1",
    caveats: ["광역지자체 단위 자료입니다."],
    ...over,
  } as unknown as LandfillSummary;
}

const trends = {
  start_month: "2024-01",
  end_month: "2024-03",
  origin_filter: null,
  waste_filter: null,
  accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
  points: [
    { reference_month: "2024-01", reference_year: 2024, quantity_kg: "100", quantity_tons: "0.1", inbound_fee_krw: "5000", effective_fee_per_ton: "50000" },
    { reference_month: "2024-02", reference_year: 2024, quantity_kg: "0", quantity_tons: "0", inbound_fee_krw: "0", effective_fee_per_ton: null },
  ],
  evidence: {},
  sources: [],
  derivation_version: "landfill-flow-v1",
  caveats: [],
} as unknown as LandfillTrends;

describe("the fee / payment separation", () => {
  it("writes NO municipal contract-payment column into any sheet", () => {
    const s = summary();
    for (const sheet of [buildOriginSheet(s), buildWasteSheet(s), buildTrendSheet(s, trends)]) {
      const headers = sheet.columns.map((c) => c.header).join(" ");
      // The municipal dataset is a different accounting basis. It has no column
      // here, so no workbook can put the two side by side in one row.
      expect(headers, sheet.name).not.toContain("지급액");
      expect(headers, sheet.name).not.toContain("수집·운반");
      expect(headers, sheet.name).not.toContain("계약");
      // And there is no combined figure of any kind.
      expect(headers, sheet.name).not.toContain("합계 비용");
      expect(headers, sheet.name).not.toContain("총 비용");
    }
  });

  it("names the fee as the OFFICIAL inbound fee and says it cannot be combined", () => {
    const preamble = buildOriginSheet(summary()).preamble.join("\n");
    expect(preamble).toContain("공식 반입수수료");
    expect(preamble).toContain("더하거나 같은 비용으로 비교할 수 없습니다");
    // The accounting basis is stated outright — the fact that makes them separate.
    expect(preamble).toContain("VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW");
  });
});

describe("missing stays missing", () => {
  it("leaves an unserved share, fee, or per-capita value blank rather than 0", () => {
    const incheon = summary().origin_shares[1];
    const columns = buildOriginSheet(summary()).columns;
    const by = (h: string) => columns.find((c) => c.header === h)!.value(incheon);
    expect(by("반입량 비중(%)")).toBeNull();
    expect(by("톤당 실효 수수료(원)")).toBeNull();
    expect(by("1인당 수수료(원)")).toBeNull();
    // …and the served REASON travels with the blank, so the gap is explained.
    expect(by("1인당 계산 불가 사유")).toBe("ZERO_POPULATION");
  });

  it("keeps a genuine measured zero as zero", () => {
    // February really reported 0 tons; that is a fact, not an absence.
    const feb = trends.points[1];
    const columns = buildTrendSheet(summary(), trends).columns;
    expect(columns.find((c) => c.header === "반입량(톤)")!.value(feb)).toBe(0);
    // But its uncomputed effective fee is still blank.
    expect(columns.find((c) => c.header === "톤당 실효 수수료(원)")!.value(feb)).toBeNull();
  });

  it("tells the reader what a blank cell means", () => {
    expect(buildOriginSheet(summary()).preamble.join(" ")).toContain("0이 아닙니다");
    expect(buildTrendSheet(summary(), trends).preamble.join(" ")).toContain("0이 아니라 자료 없음");
  });
});

describe("provenance and naming", () => {
  it("states the period, destination, filters, and derivation version", () => {
    const preamble = buildOriginSheet(summary()).preamble.join("\n");
    expect(preamble).toContain("2024년");
    expect(preamble).toContain("수도권매립지");
    expect(preamble).toContain("landfill-flow-v1");
    // Served caveats travel with the data.
    expect(preamble).toContain("광역지자체 단위 자료입니다.");
  });

  it("labels a monthly period distinctly from an annual one", () => {
    expect(periodLabel(summary())).toBe("2024년");
    expect(
      periodLabel(summary({ period: { reference_year: 2024, reference_month: "2024-05" } as never })),
    ).toContain("05월");
  });

  it("builds a filename carrying the dataset and the period", () => {
    expect(landfillFilenameBase(summary())).toContain("수도권매립지_반입현황");
    expect(landfillFilenameBase(summary())).toContain("2024년");
  });
});
