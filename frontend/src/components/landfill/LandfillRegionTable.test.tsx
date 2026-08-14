// @vitest-environment jsdom

/**
 * 지역별 상세 현황 — the two-grain table.
 *
 * The Figma frame states the behaviour in writing beneath the card ("지역명을
 * 클릭하면 시/군/구 단위 상세 데이터를 확인할 수 있습니다"), and the whole point of
 * the drill-down is that four datasets published on three geographies coexist in one
 * grid without any of them borrowing another's grain. These tests assert exactly
 * that boundary, plus the two absence rules the platform lives by.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import LandfillRegionTable from "./LandfillRegionTable";
import type { LandfillFeePerCapita, LandfillOriginShare, LandfillSummary } from "../../lib/api";
import type { CapitalRegionWaste, MunicipalityRow } from "../../lib/capitalRegionWaste";

afterEach(cleanup);

function perCapita(overrides: Partial<LandfillFeePerCapita> = {}): LandfillFeePerCapita {
  return {
    indicator: "LANDFILL_INBOUND_FEE_PER_CAPITA",
    fee_per_capita_krw: "4461.21",
    unit: "KRW/인",
    derivation_version: "landfill-fee-per-capita-v2",
    derivation_formula: "inbound_fee_krw ÷ population",
    evidence_status: "OFFICIAL_INPUTS_DERIVED_VALUE",
    inbound_fee_krw: "41647362920.00",
    fee_reference_year: 2025,
    fee_reference_period: "2025",
    fee_period_complete: true,
    required_population_month: "2025-12",
    population: 9335444,
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
    included_origin_region_codes: ["KR-SGIS-11"],
    unavailable_reason: null,
    interpretation_caveat: "분석용 환산값입니다.",
    caveat: "분석용 환산값입니다.",
    ...overrides,
  };
}

function originShare(sgis: string, name: string): LandfillOriginShare {
  return {
    origin_region_code: `KR-SGIS-${sgis}`,
    origin_sgis_code: sgis,
    origin_name: name,
    origin_name_en: name,
    quantity_kg: "420404150",
    quantity_tons: "420404.150000",
    inbound_fee_krw: "41647362920.00",
    quantity_share: "0.397016",
    effective_fee_per_ton: "99065.00",
    fee_per_capita: perCapita(),
  };
}

function summary(): LandfillSummary {
  return {
    period: {
      year: 2025,
      month: null,
      is_complete_year: true,
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
    origin_shares: [originShare("11", "서울시"), originShare("28", "인천시")],
    top_waste_types: [],
    row_count: 2,
    evidence: { quantity_status: "OFFICIAL_REPORTED", derived_status: "DERIVED" },
    sources: [],
    derivation_version: "landfill-summary-v1",
    caveats: [],
  } as unknown as LandfillSummary;
}

function municipality(overrides: Partial<MunicipalityRow> = {}): MunicipalityRow {
  return {
    code: "KR-SGIS-11010",
    name: "종로구",
    fullName: "서울특별시 종로구",
    scope: "11",
    tierLabel: "자치구",
    isCityUnion: false,
    population: 144486,
    generationTons: "93721.300001",
    generationStreamCount: 4,
    missingStreams: [],
    generationPerCapitaKg: 648.66,
    throughputTons: "1000.000000",
    throughputFacilityCount: 3,
    throughputIsPartial: false,
    throughputPerCapitaKg: 6.92,
    contract: {
      status: "AVAILABLE",
      totalPaymentKrw: "12345678900.00",
      perCapitaKrw: "85445.1200",
      contractCount: 4,
      limitation: null,
      referenceYear: 2024,
    },
    ...overrides,
  };
}

function capitalRegion(overrides: Partial<CapitalRegionWaste> = {}): CapitalRegionWaste {
  return {
    scope: null,
    generation: {
      tons: "101222.050001",
      unit: "톤/년",
      referenceYear: 2024,
      regionCount: 2,
      expectedRegionCount: 2,
      accountingBasis: "ORIGIN_BASED_TREATMENT_OUTCOME",
      missingCells: [],
      unassignedFacilityCount: 0,
    },
    throughput: {
      tons: "3000.500000",
      unit: "톤/년",
      referenceYear: 2024,
      regionCount: 2,
      expectedRegionCount: 2,
      accountingBasis: "FACILITY_LOCATION_BASED_THROUGHPUT",
      missingCells: [],
      unassignedFacilityCount: 99,
    },
    groups: [
      {
        scope: "11",
        label: "서울",
        landfillOrigin: "11",
        tierLabel: "자치구",
        population: 144486,
        generationTons: "93721.300001",
        generationPerCapitaKg: 648.66,
        throughputTons: "1000.000000",
        throughputFacilityCount: 3,
        throughputIsPartial: false,
        throughputPerCapitaKg: 6.92,
        municipalities: [municipality()],
        contractCoverage: { withAmount: 1, total: 1 },
      },
      {
        scope: "23",
        label: "인천",
        landfillOrigin: "28",
        tierLabel: "군·구",
        population: 20000,
        generationTons: "7500.750000",
        generationPerCapitaKg: 375.04,
        throughputTons: "2000.500000",
        throughputFacilityCount: 3,
        throughputIsPartial: false,
        throughputPerCapitaKg: 100.03,
        municipalities: [
          municipality({
            code: "KR-SGIS-23520",
            name: "옹진군",
            fullName: "인천광역시 옹진군",
            scope: "23",
            tierLabel: "군·구",
            population: 20000,
            generationTons: "7500.750000",
            generationStreamCount: 3,
            missingStreams: [{ stream: "INDUSTRIAL_FACILITY", reason: "SOURCE_NOT_REPORTED" }],
            generationPerCapitaKg: 375.04,
            throughputTons: "2000.500000",
            throughputPerCapitaKg: 100.03,
            contract: {
              status: "UNAVAILABLE",
              totalPaymentKrw: null,
              perCapitaKrw: null,
              contractCount: 0,
              limitation: "공개된 계약 자료를 찾지 못했습니다.",
              referenceYear: 2024,
            },
          }),
        ],
        contractCoverage: { withAmount: 0, total: 1 },
      },
    ],
    unmatched: { contractRows: [], facilityRegions: [] },
    ...overrides,
  };
}

function renderTable(overrides: Partial<Parameters<typeof LandfillRegionTable>[0]> = {}) {
  return render(
    <LandfillRegionTable
      summary={summary()}
      originMax={420404.15}
      periodLabel="2025년 연간"
      capitalRegion={capitalRegion()}
      municipalReferenceYear={2024}
      contractReferenceYear={2024}
      contractDistinction="다른 회계 기준입니다"
      {...overrides}
    />,
  );
}

const expandSeoul = () =>
  screen.getAllByTestId("landfill-region-expand").find((b) => b.textContent?.includes("서울시"))!;

describe("LandfillRegionTable — metropolitan grain", () => {
  it("shows the metropolitan generation and throughput beside the landfill values", () => {
    renderTable();
    const rows = screen.getAllByTestId("landfill-region-row");
    expect(rows).toHaveLength(2);
    const seoul = rows.find((row) => row.textContent?.includes("서울시"))!;
    // The derived sums, formatted as tonnes.
    expect(seoul).toHaveTextContent("93,721 t");
    expect(seoul).toHaveTextContent("1,000 t");
    // The per-resident conversions.
    expect(seoul).toHaveTextContent("648.7");
    // The served landfill values are untouched.
    expect(seoul).toHaveTextContent("420,404 t");
    expect(seoul).toHaveTextContent("39.7%");
  });

  it("names the period of every column group in the card's unit line", () => {
    renderTable();
    const card = screen.getByTestId("landfill-region-table");
    // Three datasets, three periods, stated rather than merged into one.
    expect(card).toHaveTextContent("발생량·처리량 2024년");
    expect(card).toHaveTextContent("계약 지급액 2024년");
    expect(card).toHaveTextContent("반입 2025년 연간");
  });

  it("reports contract-payment COVERAGE at metropolitan grain, never a total", () => {
    renderTable();
    const coverage = screen.getAllByTestId("landfill-region-contract-coverage");
    expect(coverage[0]).toHaveTextContent("1곳 중 1곳 공개");
    // The rule that makes the whole column safe: only 46 of 66 municipalities
    // published an amount, so a metropolitan sum would be a partial sum wearing a
    // complete label.
    expect(coverage[0]).toHaveTextContent("합계는 표시하지 않습니다");
  });

  it("renders the served contract-vs-inbound-fee distinction verbatim at the point of use", () => {
    renderTable();
    expect(screen.getByTestId("landfill-region-contract-distinction")).toHaveTextContent(
      "다른 회계 기준입니다",
    );
  });
});

describe("LandfillRegionTable — municipal drill-down", () => {
  it("is collapsed on arrival and expands the metropolitan's own tier", () => {
    renderTable();
    expect(screen.queryAllByTestId("landfill-municipality-row")).toHaveLength(0);
    const trigger = expandSeoul();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // The accessible name names the REAL tier, not a generic 시·군·구.
    expect(trigger).toHaveTextContent("자치구 상세 펼치기");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const municipal = screen.getAllByTestId("landfill-municipality-row");
    expect(municipal).toHaveLength(1);
    expect(municipal[0]).toHaveTextContent("종로구");
    expect(municipal[0]).toHaveTextContent("자치구");
  });

  it("labels 인천 as 군·구 — the tiers are not interchangeable", () => {
    renderTable();
    const incheon = screen
      .getAllByTestId("landfill-region-expand")
      .find((b) => b.textContent?.includes("인천시"))!;
    expect(incheon).toHaveTextContent("군·구 상세 펼치기");
    fireEvent.click(incheon);
    expect(screen.getByTestId("landfill-municipality-row")).toHaveTextContent("군·구");
  });

  it("shows the municipal contract payment on the municipality row", () => {
    renderTable();
    fireEvent.click(expandSeoul());
    const row = screen.getByTestId("landfill-municipality-row");
    expect(within(row).getByTestId("landfill-municipality-contract-total")).toHaveTextContent(
      "123.5억원",
    );
    expect(within(row).getByTestId("landfill-municipality-contract-per-capita")).toHaveTextContent(
      "85,445원/인",
    );
  });

  it("never renders an unavailable contract payment as ₩0", () => {
    renderTable();
    const incheon = screen
      .getAllByTestId("landfill-region-expand")
      .find((b) => b.textContent?.includes("인천시"))!;
    fireEvent.click(incheon);
    const row = screen.getByTestId("landfill-municipality-row");
    expect(within(row).queryByTestId("landfill-municipality-contract-total")).toBeNull();
    expect(
      within(row).getByTestId("landfill-municipality-contract-unavailable"),
    ).toHaveTextContent("자료 없음");
    // The backend's own reason, not an invented one.
    expect(row).toHaveTextContent("공개된 계약 자료를 찾지 못했습니다.");
    expect(row.textContent).not.toContain("0원");
    expect(row.textContent).not.toContain("₩0");
  });

  it("states that landfill inbound is not reported at municipal grain", () => {
    renderTable();
    fireEvent.click(expandSeoul());
    const cell = screen.getByTestId("landfill-municipality-no-landfill");
    // Deliberately NOT "자료 없음": the value was not measured and withheld, the
    // concept does not exist at this grain. Apportioning a sido total down would
    // fabricate the municipal origin the source explicitly declines to publish.
    expect(cell).toHaveTextContent("시·도 단위 보고");
    expect(cell.textContent).not.toContain("자료 없음");
  });

  it("marks a municipality whose source did not report every stream", () => {
    renderTable();
    const incheon = screen
      .getAllByTestId("landfill-region-expand")
      .find((b) => b.textContent?.includes("인천시"))!;
    fireEvent.click(incheon);
    expect(screen.getByTestId("landfill-municipality-missing-stream")).toHaveTextContent(
      "미보고 1개 계열 제외",
    );
  });

  it("marks a composite Gyeonggi city's figures as a roll-up of its 일반구", () => {
    renderTable({
      capitalRegion: capitalRegion({
        groups: [
          {
            scope: "11",
            label: "서울",
            landfillOrigin: "11",
            tierLabel: "자치구",
            population: 1000000,
            generationTons: "1.000000",
            generationPerCapitaKg: 1,
            throughputTons: "1.000000",
            throughputFacilityCount: 1,
            throughputIsPartial: false,
            throughputPerCapitaKg: 1,
            municipalities: [municipality({ isCityUnion: true })],
            contractCoverage: { withAmount: 1, total: 1 },
          },
        ],
      }),
    });
    fireEvent.click(expandSeoul());
    expect(screen.getByTestId("landfill-municipality-derived")).toHaveTextContent(
      "구성 일반구 합산",
    );
  });

  it("renders the landfill columns unchanged when the municipal series is absent", () => {
    // The two datasets fail independently; a missing municipal join must not blank
    // the official landfill values, and must not print zeros in its own columns.
    renderTable({ capitalRegion: null, municipalReferenceYear: null, contractReferenceYear: null });
    const rows = screen.getAllByTestId("landfill-region-row");
    // The served landfill value is untouched…
    expect(within(rows[0]).getByTestId("landfill-region-quantity")).toHaveTextContent("420,404 t");
    // …and the municipal columns state absence rather than a zero tonnage.
    expect(rows[0]).toHaveTextContent("자료 없음");
    expect(screen.queryAllByTestId("landfill-region-expand")).toHaveLength(0);
    const municipalCells = Array.from(rows[0].querySelectorAll("td")).slice(0, 4);
    for (const cell of municipalCells) {
      expect(cell.textContent).toBe("자료 없음");
    }
  });
});
