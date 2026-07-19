// @vitest-environment jsdom

/**
 * Rendering tests for the full-width 수도권매립지 dashboard.
 *
 * Asserts the four KPI cards, the exactly-four-column regional table, that an
 * unavailable per-capita value shows its served reason (never 0원), that both
 * reference periods are visible, and that no schematic flow-map text survives.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LandfillDashboard, { type LandfillDashboardData } from "./LandfillDashboard";
import type {
  LandfillFeePerCapita,
  LandfillOriginShare,
  LandfillSummary,
} from "../lib/api";

afterEach(cleanup);

const CAVEAT =
  "선택 기간의 공식 반입수수료를 동일 기간 기준의 해당 지역 인구로 나눈 분석용 환산값입니다. " +
  "개인의 실제 납부액이 아닙니다.";

function perCapita(overrides: Partial<LandfillFeePerCapita> = {}): LandfillFeePerCapita {
  return {
    indicator: "LANDFILL_INBOUND_FEE_PER_CAPITA",
    fee_per_capita_krw: "4461.21",
    unit: "KRW/인",
    derivation_version: "landfill-fee-per-capita-v2",
    derivation_formula: "inbound_fee_krw ÷ population",
    evidence_status: "OFFICIAL_INPUTS_DERIVED_VALUE",
    inbound_fee_krw: "41647362920.00",
    fee_reference_year: 2024,
    fee_reference_period: "2024",
    fee_period_complete: true,
    // A complete year's denominator is that year's December month-end.
    required_population_month: "2024-12",
    population: 9331828,
    population_reference_month: "2024-12",
    population_reference_year: 2024,
    population_reference_period: "2024-12",
    population_temporal_granularity: "MONTHLY",
    population_definition: "MOIS_RESIDENT_REGISTRATION_TOTAL",
    population_definition_version: "MOIS_TOTAL_WITH_UNREGISTERED_RESIDENT_AND_OVERSEAS_NATIONALS",
    population_comparability_note: "2015-01 이후: 거주불명자와 재외국민이 포함된 주민등록 총인구입니다.",
    population_source_id: "mois_resident_population",
    population_source_dataset_id: "mois_resident_population",
    population_source_administrative_code: "1100000000",
    population_region_level: "SIDO",
    population_unit: "persons",
    included_origin_region_codes: ["KR-SGIS-11"],
    unavailable_reason: null,
    interpretation_caveat: CAVEAT,
    caveat: CAVEAT,
    ...overrides,
  };
}

function originShare(
  code: string,
  sgis: string,
  name: string,
  overrides: Partial<LandfillOriginShare> = {},
): LandfillOriginShare {
  return {
    origin_region_code: code,
    origin_sgis_code: sgis,
    origin_name: name,
    origin_name_en: name,
    quantity_kg: "408490610",
    quantity_tons: "408490.610000",
    inbound_fee_krw: "41647362920.00",
    quantity_share: "0.38",
    effective_fee_per_ton: "101954.00",
    fee_per_capita: perCapita({ included_origin_region_codes: [code] }),
    ...overrides,
  };
}

function summary(overrides: Partial<LandfillSummary> = {}): LandfillSummary {
  return {
    period: {
      year: 2024,
      month: null,
      is_complete_year: true,
      available_through_month: "2024-12",
      latest_available_month: "2026-05",
      available_years: [2023, 2024, 2025],
    },
    origin_filter: null,
    waste_filter: null,
    accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
    destination_code: "SUDOKWON_LANDFILL",
    destination_name: "수도권매립지",
    total_quantity_kg: "1071548250",
    total_quantity_tons: "1071548.250000",
    total_inbound_fee_krw: "108176043070.00",
    effective_fee_per_ton: "100952.00",
    fee_per_capita: perCapita({
      fee_per_capita_krw: "4153.03",
      population: 26047159,
      inbound_fee_krw: "108176043070.00",
      included_origin_region_codes: ["KR-SGIS-11", "KR-SGIS-28", "KR-SGIS-41"],
    }),
    largest_origin_share: null,
    largest_waste_share: null,
    origin_shares: [
      originShare("KR-SGIS-11", "11", "서울시"),
      originShare("KR-SGIS-28", "28", "인천시"),
      originShare("KR-SGIS-41", "41", "경기도"),
    ],
    top_waste_types: [
      {
        waste_name: "생활",
        quantity_kg: "500000000",
        quantity_tons: "500000.000000",
        inbound_fee_krw: "50000000000.00",
        quantity_share: "0.5",
        effective_fee_per_ton: "100000.00",
      },
    ],
    row_count: 3,
    evidence: {
      quantity_status: "OFFICIAL_REPORTED_VALUE",
      fee_status: "OFFICIAL_REPORTED_VALUE",
      derived_status: "OFFICIAL_INPUTS_DERIVED_VALUE",
      notes: [],
    },
    sources: [
      {
        dataset_id: "15064381",
        official_dataset_name: "반입량",
        snapshot_uuid: "uddi-q",
        snapshot_date: "2026-05-31",
      },
      {
        dataset_id: "15064394",
        official_dataset_name: "반입수수료",
        snapshot_uuid: "uddi-f",
        snapshot_date: "2026-05-31",
      },
    ],
    derivation_version: "landfill-effective-fee-v1",
    caveats: [
      "수도권매립지관리공사가 서울시·경기도·인천시 단위로 보고한 반입 자료입니다. 시·군·구별 반입량을 의미하지 않습니다.",
      "광역지자체 단위 자료이며 시·군·구별 이동 경로나 실제 운송 경로를 의미하지 않습니다.",
      "반입수수료는 공식 보고된 금액이며 순수 운송비 또는 전체 폐기물 관리비가 아닙니다.",
    ],
    ...overrides,
  };
}

function data(overrides: Partial<LandfillSummary> = {}): LandfillDashboardData {
  return {
    summary: summary(overrides),
    trends: {
      start_month: "2024-01",
      end_month: "2024-12",
      origin_filter: null,
      waste_filter: null,
      accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
      points: [
        {
          reference_month: "2024-01",
          reference_year: 2024,
          quantity_kg: "90000000",
          quantity_tons: "90000.000000",
          inbound_fee_krw: "9000000000.00",
          effective_fee_per_ton: "100000.00",
        },
      ],
      evidence: {
        quantity_status: "OFFICIAL_REPORTED_VALUE",
        fee_status: "OFFICIAL_REPORTED_VALUE",
        derived_status: "OFFICIAL_INPUTS_DERIVED_VALUE",
        notes: [],
      },
      sources: [],
      derivation_version: "landfill-effective-fee-v1",
      caveats: [],
    },
    composition: {
      period: summary().period,
      origin_filter: null,
      accounting_basis: "VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW",
      total_quantity_kg: "1071548250",
      total_quantity_tons: "1071548.250000",
      total_inbound_fee_krw: "108176043070.00",
      waste_types: [
        {
          waste_name: "생활",
          quantity_kg: "500000000",
          quantity_tons: "500000.000000",
          inbound_fee_krw: "50000000000.00",
          quantity_share: "0.5",
          effective_fee_per_ton: "100000.00",
        },
      ],
      evidence: {
        quantity_status: "OFFICIAL_REPORTED_VALUE",
        fee_status: "OFFICIAL_REPORTED_VALUE",
        derived_status: "OFFICIAL_INPUTS_DERIVED_VALUE",
        notes: [],
      },
      sources: [],
      derivation_version: "landfill-effective-fee-v1",
      caveats: [],
    },
  };
}

const noop = () => undefined;

function renderDashboard(props: Partial<Parameters<typeof LandfillDashboard>[0]> = {}) {
  return render(
    <LandfillDashboard
      data={data()}
      error={null}
      year={null}
      setYear={noop}
      month={null}
      setMonth={noop}
      origin={null}
      setOrigin={noop}
      waste={null}
      setWaste={noop}
      {...props}
    />,
  );
}

describe("LandfillDashboard", () => {
  it("renders the heading and the metropolitan-only limitation notice", () => {
    renderDashboard();
    expect(screen.getByText("수도권매립지 반입 현황")).toBeDefined();
    expect(screen.getByText("서울 · 인천 · 경기 공식 반입자료")).toBeDefined();
    expect(screen.getByTestId("landfill-limitation").textContent).toContain(
      "광역지자체 단위 자료이며 시·군·구별 이동 경로나 실제 운송 경로를 의미하지 않습니다.",
    );
  });

  it("renders exactly four primary KPI cards", () => {
    renderDashboard();
    for (const testId of [
      "landfill-kpi-quantity",
      "landfill-kpi-fee",
      "landfill-kpi-effective-fee",
      "landfill-kpi-per-capita",
    ]) {
      expect(screen.getByTestId(testId)).toBeDefined();
    }
    // The KPI grid holds four cards and no more.
    expect(screen.getByTestId("landfill-kpis").children).toHaveLength(4);
  });

  it("renders the four filters", () => {
    renderDashboard();
    for (const testId of [
      "landfill-year-select",
      "landfill-month-select",
      "landfill-origin-select",
      "landfill-waste-select",
    ]) {
      expect(screen.getByTestId(testId)).toBeDefined();
    }
  });

  it("uses the exact per-capita metric name and never implies an actual payment", () => {
    renderDashboard();
    const kpi = screen.getByTestId("landfill-kpi-per-capita");
    expect(kpi.textContent).toContain("주민 1인당 환산 반입수수료");
    expect(kpi.textContent).toContain("개인의 실제 납부액이 아닙니다");
    expect(kpi.textContent).not.toContain("세금");
    expect(kpi.textContent).not.toContain("납부액입니다");
  });

  it("renders a four-column regional table with three metropolitan rows for 전체", () => {
    renderDashboard();
    const table = screen.getByTestId("landfill-region-table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers).toHaveLength(4);
    expect(headers.map((h) => h.textContent)).toEqual([
      "지역",
      "반입량",
      "공식 반입수수료",
      "주민 1인당 환산 반입수수료",
    ]);
    const rows = screen.getAllByTestId("landfill-region-row");
    expect(rows).toHaveLength(3);
    const names = rows.map((row) => within(row).getAllByRole("rowheader")[0].textContent);
    expect(names).toEqual(["서울시", "인천시", "경기도"]);
  });

  it("renders only the selected origin's row when one origin is selected", () => {
    // The backend narrows origin_shares to the filtered origin.
    renderDashboard({
      data: data({ origin_filter: "11", origin_shares: [originShare("KR-SGIS-11", "11", "서울시")] }),
      origin: "11",
    });
    const rows = screen.getAllByTestId("landfill-region-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("서울시");
    expect(rows[0].textContent).not.toContain("인천시");
    expect(rows[0].textContent).not.toContain("경기도");
  });

  it("formats a valid per-capita fee and shows both reference periods", () => {
    renderDashboard();
    const kpi = screen.getByTestId("landfill-kpi-per-capita");
    expect(kpi.textContent).toContain("4,153원/인");
    const periods = screen.getByTestId("landfill-per-capita-periods").textContent ?? "";
    expect(periods).toContain("수수료 기준 2024");
    // A complete annual selection is denominated by that year's December month-end.
    expect(periods).toContain("인구 기준 2024-12");
    expect(periods).toContain("월말");
    expect(screen.getByTestId("landfill-population-month").textContent).toBe("2024-12");
    // The evidence panel names the population source and both periods too.
    expect(screen.getByTestId("landfill-population-period").textContent).toBe("2024-12");
    expect(screen.getByTestId("landfill-fee-period").textContent).toBe("2024");
  });

  it("shows the MOIS source, granularity, admin code and v2 derivation version", () => {
    renderDashboard();
    const source = screen.getByTestId("landfill-population-source").textContent ?? "";
    expect(source).toContain("행정안전부 주민등록 인구통계");
    expect(source).toContain("행정동별 주민등록 인구 및 세대현황");
    expect(source).toContain("mois_resident_population");
    expect(source).toContain("월간");
    expect(screen.getByTestId("landfill-population-admin-code").textContent).toBe("1100000000");
    expect(screen.getByTestId("landfill-derivation-version").textContent).toBe(
      "landfill-fee-per-capita-v2",
    );
    // No SGIS label may appear as the landfill denominator under v2.
    expect(source).not.toContain("SGIS");
  });

  it("discloses that the population definition changed during the series", () => {
    renderDashboard();
    const note = screen.getByTestId("landfill-comparability-note").textContent ?? "";
    expect(note).toContain("2010-10");
    expect(note).toContain("거주불명자");
    expect(note).toContain("2015-01");
    expect(note).toContain("재외국민");
    expect(note).toContain("외국인");
  });

  it("uses each year's December denominator for 2008 and 2025 annual selections", () => {
    for (const year of [2008, 2025] as const) {
      cleanup();
      renderDashboard({
        data: data({
          period: { ...summary().period, year },
          fee_per_capita: perCapita({
            fee_reference_year: year,
            fee_reference_period: String(year),
            required_population_month: `${year}-12`,
            population_reference_month: `${year}-12`,
            population_reference_period: `${year}-12`,
            population_reference_year: year,
          }),
        }),
      });
      expect(screen.getByTestId("landfill-population-month").textContent).toBe(`${year}-12`);
    }
  });

  it("uses the final landfill month as the denominator for a partial year", () => {
    // Landfill fees run through 2026-05 while MOIS has published 2026-06; the
    // denominator must be 2026-05 — the last month actually in the numerator.
    renderDashboard({
      data: data({
        period: {
          ...summary().period,
          year: 2026,
          is_complete_year: false,
          available_through_month: "2026-05",
        },
        fee_per_capita: perCapita({
          fee_reference_year: 2026,
          fee_reference_period: "2026",
          fee_period_complete: false,
          required_population_month: "2026-05",
          population_reference_month: "2026-05",
          population_reference_period: "2026-05",
          population_reference_year: 2026,
        }),
      }),
    });
    expect(screen.getByTestId("landfill-population-month").textContent).toBe("2026-05");
    expect(screen.getByTestId("landfill-population-month").textContent).not.toBe("2026-06");
  });

  it("uses the exact selected month as the denominator for a monthly selection", () => {
    renderDashboard({
      data: data({
        period: { ...summary().period, year: 2024, month: "2024-07" },
        fee_per_capita: perCapita({
          fee_reference_year: 2024,
          fee_reference_period: "2024-07",
          required_population_month: "2024-07",
          population_reference_month: "2024-07",
          population_reference_period: "2024-07",
        }),
      }),
    });
    expect(screen.getByTestId("landfill-population-month").textContent).toBe("2024-07");
    expect(screen.getByTestId("landfill-per-capita-periods").textContent).toContain(
      "수수료 기준 2024-07",
    );
  });

  it("renders an unavailable per-capita fee as its served reason, never 0원", () => {
    const unavailable = perCapita({
      fee_per_capita_krw: null,
      population: null,
      population_reference_month: null,
      population_reference_year: null,
      population_reference_period: null,
      population_definition: null,
      population_source_id: null,
      unavailable_reason: "NO_MATCHING_POPULATION_PERIOD",
      required_population_month: "2025-12",
    });
    renderDashboard({
      data: data({
        period: { ...summary().period, year: 2025 },
        fee_per_capita: unavailable,
        origin_shares: [
          originShare("KR-SGIS-11", "11", "서울시", { fee_per_capita: unavailable }),
        ],
      }),
    });
    const kpi = screen.getByTestId("landfill-kpi-per-capita");
    expect(kpi.textContent).toContain("동일 기간 인구 데이터 없음");
    expect(kpi.textContent).not.toContain("0원");
    expect(screen.getByTestId("landfill-per-capita-unavailable")).toBeDefined();
    // The table cell shows the reason too, not a zero.
    const row = screen.getAllByTestId("landfill-region-row")[0];
    expect(within(row).getByTestId("landfill-row-unavailable").textContent).toBe(
      "동일 기간 인구 데이터 없음",
    );
    // The month the period required is still disclosed, so the gap is specific.
    expect(screen.getByTestId("landfill-required-month").textContent).toContain("2025-12");
    expect(row.textContent).not.toContain("0원/인");
  });

  it("keeps the official fee caveat and the served caveats visible", () => {
    renderDashboard();
    expect(screen.getByTestId("landfill-fee-caveat").textContent).toContain(
      "순수 운송비 또는 전체 폐기물 관리비가 아닙니다",
    );
    const caveats = screen.getByTestId("landfill-caveats").textContent ?? "";
    expect(caveats).toContain("시·군·구별 반입량을 의미하지 않습니다");
  });

  it("renders the four charts", () => {
    renderDashboard();
    for (const testId of [
      "landfill-trend-quantity",
      "landfill-trend-fee",
      "landfill-origin-comparison",
      "landfill-waste-composition",
    ]) {
      expect(screen.getByTestId(testId)).toBeDefined();
    }
  });

  it("labels the monthly charts with their y-axis unit and reference period", () => {
    renderDashboard();
    const qtyAxis = screen.getByTestId("landfill-trend-quantity-axis").textContent ?? "";
    expect(qtyAxis).toContain("세로축 단위");
    expect(qtyAxis).toContain("톤 (t)");
    // The reference period comes from the trend points (2024-01 in the fixture).
    expect(qtyAxis).toContain("2024-01");
    const feeAxis = screen.getByTestId("landfill-trend-fee-axis").textContent ?? "";
    expect(feeAxis).toContain("억원");
    // Fee and quantity units must not be confused between the two charts.
    expect(feeAxis).not.toContain("톤 (t)");
  });

  it("offers an accessible table fallback with each month's exact (lossless) value", () => {
    renderDashboard();
    const table = screen.getByTestId("landfill-trend-quantity-table");
    // The hover-only <title> tooltips are unreachable by touch/AT; the table gives
    // every month's exact served value as text — no chart rounding.
    expect(within(table).getByText("2024-01")).toBeDefined();
    expect(within(table).getByText("90,000 t")).toBeDefined();
    // The fee table shows the exact served KRW fee (the chart's 억원 conversion
    // would round); 9,000,000,000.00 → "9,000,000,000원".
    const feeTable = screen.getByTestId("landfill-trend-fee-table");
    expect(within(feeTable).getByText("9,000,000,000원")).toBeDefined();
  });

  it("keeps fractional precision in the exact table (never chart-rounded)", () => {
    // A fractional-tonne month and a fee not divisible by ₩10,000,000: the chart
    // rounds, the table must not.
    renderDashboard({
      data: data({}),
    });
    // Re-render with a precise trend point via a targeted fixture.
    cleanup();
    render(
      <LandfillDashboard
        data={{
          ...data(),
          trends: {
            ...data().trends,
            points: [
              {
                reference_month: "2024-02",
                reference_year: 2024,
                quantity_kg: "90123456",
                quantity_tons: "90123.456000",
                inbound_fee_krw: "9000012345.67",
                effective_fee_per_ton: "99863.00",
              },
            ],
          },
        }}
        error={null}
        year={null}
        setYear={noop}
        month={null}
        setMonth={noop}
        origin={null}
        setOrigin={noop}
        waste={null}
        setWaste={noop}
      />,
    );
    const qtyTable = screen.getByTestId("landfill-trend-quantity-table");
    expect(within(qtyTable).getByText("90,123.456 t")).toBeDefined();
    const feeTable = screen.getByTestId("landfill-trend-fee-table");
    expect(within(feeTable).getByText("9,000,012,345.67원")).toBeDefined();
  });

  it("shows no schematic straight-line flow text and no arrow rows", () => {
    const { container } = renderDashboard();
    const text = container.textContent ?? "";
    expect(text).not.toContain("직선은 개략적 이동 방향");
    expect(text).not.toContain("▶");
    expect(text).not.toContain("서울시 ▶ 수도권매립지");
  });

  it("shows an explicit error state and no stale values when a request fails", () => {
    renderDashboard({ data: null, error: "수도권매립지 데이터를 불러올 수 없습니다" });
    expect(screen.getByTestId("landfill-error")).toBeDefined();
    // No KPI or table may render from a previous selection.
    expect(screen.queryByTestId("landfill-kpis")).toBeNull();
    expect(screen.queryByTestId("landfill-region-table")).toBeNull();
  });

  it("shows a loading state before data arrives", () => {
    renderDashboard({ data: null });
    expect(screen.getByTestId("landfill-loading")).toBeDefined();
  });

  it("labels a partial year honestly", () => {
    renderDashboard({
      data: data({
        period: {
          ...summary().period,
          year: 2026,
          is_complete_year: false,
          available_through_month: "2026-05",
        },
      }),
    });
    expect(screen.getByTestId("landfill-partial-year").textContent).toContain("2026-05");
  });

  it("renders an empty regional table state rather than fabricating rows", () => {
    renderDashboard({ data: data({ origin_shares: [] }) });
    expect(screen.getByTestId("landfill-region-empty")).toBeDefined();
    expect(screen.queryAllByTestId("landfill-region-row")).toHaveLength(0);
  });

  it("is the skip-link target and announces loaded results via a status region", () => {
    renderDashboard();
    // Skip-link target for the flow view.
    const main = screen.getByTestId("landfill-dashboard");
    expect(main.getAttribute("id")).toBe("main-content");
    expect(main.getAttribute("tabindex")).toBe("-1");
    // A concise status live region announces the loaded period + total quantity.
    const live = screen.getByTestId("landfill-live");
    expect(live.getAttribute("role")).toBe("status");
    expect(live.textContent).toContain("총 반입량");
  });

  it("marks the loading state as a status live region", () => {
    renderDashboard({ data: null });
    expect(screen.getByTestId("landfill-loading").getAttribute("role")).toBe("status");
  });

  it("calls the filter setters when a filter changes", () => {
    const setOrigin = vi.fn();
    const setWaste = vi.fn();
    const setYear = vi.fn();
    const setMonth = vi.fn();
    renderDashboard({ setOrigin, setWaste, setYear, setMonth });
    fireEvent.change(screen.getByTestId("landfill-origin-select"), { target: { value: "11" } });
    expect(setOrigin).toHaveBeenCalledWith("11");
    fireEvent.change(screen.getByTestId("landfill-waste-select"), { target: { value: "생활" } });
    expect(setWaste).toHaveBeenCalledWith("생활");
    fireEvent.change(screen.getByTestId("landfill-month-select"), { target: { value: "3" } });
    expect(setMonth).toHaveBeenCalledWith(3);
    // Changing the year clears the month: a month from the previous year may not
    // exist in the newly selected one.
    fireEvent.change(screen.getByTestId("landfill-year-select"), { target: { value: "2023" } });
    expect(setYear).toHaveBeenCalledWith(2023);
    expect(setMonth).toHaveBeenCalledWith(null);
  });
});
