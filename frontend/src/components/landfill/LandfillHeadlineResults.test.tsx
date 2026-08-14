// @vitest-environment jsdom

/**
 * 핵심 지표 — the two derived totals and the periods on the KPI row.
 *
 * The defect these tests pin down: the Figma mock puts "2025" on all four headline
 * cards, but 발생량 and 처리량 come from ANNUAL series that are currently a year
 * behind the monthly landfill series. A row that showed one period for all four
 * would be stating something false about two of them.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import LandfillHeadlineResults from "./LandfillHeadlineResults";
import type { LandfillFeePerCapita, LandfillSummary } from "../../lib/api";
import type { CapitalRegionWaste } from "../../lib/capitalRegionWaste";

afterEach(cleanup);

function perCapita(overrides: Partial<LandfillFeePerCapita> = {}): LandfillFeePerCapita {
  return {
    indicator: "LANDFILL_INBOUND_FEE_PER_CAPITA",
    fee_per_capita_krw: "4011.15",
    unit: "KRW/인",
    derivation_version: "landfill-fee-per-capita-v2",
    derivation_formula: "inbound_fee_krw ÷ population",
    evidence_status: "OFFICIAL_INPUTS_DERIVED_VALUE",
    inbound_fee_krw: "105524217420.00",
    fee_reference_year: 2025,
    fee_reference_period: "2025",
    fee_period_complete: true,
    required_population_month: "2025-12",
    population: 26307956,
    population_reference_month: "2025-12",
    population_reference_year: 2025,
    population_reference_period: "2025-12",
    population_temporal_granularity: "MONTHLY",
    population_definition: "MOIS_RESIDENT_REGISTRATION_TOTAL",
    population_definition_version: "MOIS_TOTAL",
    population_comparability_note: null,
    population_source_id: "mois_resident_population",
    population_source_dataset_id: "mois_resident_population",
    population_source_administrative_code: "1100000000",
    population_region_level: "SIDO",
    population_unit: "persons",
    included_origin_region_codes: ["KR-SGIS-11", "KR-SGIS-28", "KR-SGIS-41"],
    unavailable_reason: null,
    interpretation_caveat: "분석용 환산값입니다.",
    caveat: "분석용 환산값입니다.",
    ...overrides,
  };
}

function summary(): LandfillSummary {
  return {
    period: {
      year: 2025,
      month: null,
      is_complete_year: true,
      available_from_month: "2025-01",
      available_through_month: "2025-12",
      latest_available_month: "2026-05",
      available_years: [2024, 2025],
    },
    origin_filter: null,
    waste_filter: null,
    accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
    destination_code: "SUDOKWON_LANDFILL",
    destination_name: "수도권매립지",
    total_quantity_kg: "1058910570",
    total_quantity_tons: "1058910.570000",
    total_inbound_fee_krw: "105524217420.00",
    effective_fee_per_ton: "99653.00",
    fee_per_capita: perCapita(),
    largest_origin_share: null,
    largest_waste_share: null,
    origin_shares: [],
    top_waste_types: [],
    row_count: 3,
    evidence: { quantity_status: "OFFICIAL_REPORTED", derived_status: "DERIVED" },
    sources: [],
    derivation_version: "landfill-summary-v1",
    caveats: [],
  } as unknown as LandfillSummary;
}

/** The real 2024 capital-region shape, reduced to what this row reads. */
function capitalRegion(overrides: Partial<CapitalRegionWaste> = {}): CapitalRegionWaste {
  return {
    scope: null,
    generation: {
      tons: "59638312.502000",
      unit: "톤/년",
      referenceYear: 2024,
      regionCount: 66,
      expectedRegionCount: 66,
      accountingBasis: "ORIGIN_BASED_TREATMENT_OUTCOME",
      missingCells: [
        { stream: "인천광역시 옹진군 · INDUSTRIAL_FACILITY", reason: "SOURCE_NOT_REPORTED" },
        { stream: "경기도 연천군 · INDUSTRIAL_FACILITY", reason: "SOURCE_NOT_REPORTED" },
      ],
      unassignedFacilityCount: 0,
    },
    throughput: {
      tons: "6865073.300000",
      unit: "톤/년",
      referenceYear: 2024,
      regionCount: 66,
      expectedRegionCount: 66,
      accountingBasis: "FACILITY_LOCATION_BASED_THROUGHPUT",
      missingCells: [],
      unassignedFacilityCount: 99,
    },
    groups: [],
    unmatched: { contractRows: [], facilityRegions: [] },
    ...overrides,
  };
}

function renderRow(overrides: Partial<Parameters<typeof LandfillHeadlineResults>[0]> = {}) {
  return render(
    <LandfillHeadlineResults
      summary={summary()}
      periodLabel="2025년 연간"
      priorSummary={null}
      priorSettled
      priorPeriodLabel="2024년"
      capitalRegion={capitalRegion()}
      tierNoun="시·군·구"
      {...overrides}
    />,
  );
}

describe("LandfillHeadlineResults — real periods", () => {
  it("shows each metric's OWN source period, not one period for the row", () => {
    renderRow();
    // The two annual series are 2024 …
    expect(screen.getByTestId("landfill-kpi-generation-period")).toHaveTextContent("기준 기간 2024년");
    expect(screen.getByTestId("landfill-kpi-treatment-period")).toHaveTextContent("기준 기간 2024년");
    // … while the monthly landfill series is 2025. Both are on screen at once, which
    // is the whole point: they genuinely differ.
    expect(screen.getByTestId("landfill-kpi-quantity")).toHaveTextContent("기준 기간 2025년 연간");
    expect(screen.getByTestId("landfill-fee-card-period")).toHaveTextContent("기준 기간 2025년 연간");
  });

  it("never shows the Figma mock's 2025 on the two annual cards", () => {
    renderRow();
    const generation = screen.getByTestId("landfill-kpi-generation");
    expect(generation.textContent).not.toContain("2025");
  });

  it("states the landfill period as the landfill's, not the row's", () => {
    renderRow();
    expect(screen.getByTestId("landfill-headline")).toHaveTextContent(
      "수도권매립지 기준 기간: 2025년 연간",
    );
  });
});

describe("LandfillHeadlineResults — derived totals", () => {
  it("renders the exact sums as values badged 계산값, not as reported figures", () => {
    renderRow();
    expect(screen.getByTestId("landfill-kpi-generation-value")).toHaveTextContent("59,638,313 t");
    expect(screen.getByTestId("landfill-kpi-treatment-value")).toHaveTextContent("6,865,073 t");
    const generation = screen.getByTestId("landfill-kpi-generation");
    // 계산값, never 공식 보고값 — no publisher issues this total.
    expect(generation.querySelector("[data-status='derived']")).not.toBeNull();
    expect(generation.querySelector("[data-status='reported']")).toBeNull();
  });

  it("states coverage, including what was excluded from the sum", () => {
    renderRow();
    expect(screen.getByTestId("landfill-kpi-generation-coverage")).toHaveTextContent(
      "시·군·구 66곳의 공식 보고값 합계",
    );
    // The two unreported INDUSTRIAL_FACILITY cells are declared, not zero-filled.
    expect(screen.getByTestId("landfill-kpi-generation-coverage")).toHaveTextContent(
      "미보고 2건은 합계에서 제외했으며 0으로 채우지 않았습니다",
    );
    // The region-less facilities are declared as an under-count of the throughput.
    expect(screen.getByTestId("landfill-kpi-treatment-coverage")).toHaveTextContent(
      "시설 99곳은 포함되지 않았습니다",
    );
  });

  it("carries each total's accounting basis and forbids reading a rate from them", () => {
    renderRow();
    expect(screen.getByTestId("landfill-kpi-generation-period")).toHaveTextContent("발생지 기준");
    expect(screen.getByTestId("landfill-kpi-treatment-period")).toHaveTextContent("시설 소재지 기준");
    expect(screen.getByTestId("landfill-kpi-basis-note")).toHaveTextContent(
      "서로 나누거나 빼서 처리율로 읽을 수 없습니다",
    );
  });

  it("states absence — never 0 t — when the underlying series has not arrived", () => {
    renderRow({ capitalRegion: null });
    const value = screen.getByTestId("landfill-kpi-generation-unavailable");
    expect(value).toHaveTextContent("지역별 공식 자료 없음");
    expect(value.textContent).not.toContain("0 t");
    expect(screen.getByTestId("landfill-kpi-generation")).toHaveTextContent(
      "값이 0이라는 뜻이 아닙니다",
    );
  });

  it("names the selected metropolitan's own tier when the view is scoped", () => {
    renderRow({ tierNoun: "군·구" });
    expect(screen.getByTestId("landfill-kpi-generation-coverage")).toHaveTextContent("군·구 66곳");
  });
});

describe("LandfillHeadlineResults — the 핵심 지표 label", () => {
  it("keeps the heading for assistive technology but takes it off the screen", () => {
    renderRow();
    const heading = screen.getByRole("heading", { name: "핵심 지표" });
    // Requirement G: the giant section label added nothing above four labelled
    // numbers and cost a line of the fold. The REGION still has to be named.
    expect(heading.className).toContain("sr-only");
  });
});
