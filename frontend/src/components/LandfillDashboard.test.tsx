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
import type { LandfillUnavailableState } from "../lib/landfill";
import { FORBIDDEN_PRIMARY_TOKENS } from "../lib/glossary";

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

/** The backend's real 404 "no official record for these filters" answer. */
function noDataState(
  overrides: Partial<LandfillUnavailableState> = {},
): LandfillUnavailableState {
  return {
    kind: "no-data",
    message: "현재 조건에 맞는 공식 자료가 없습니다.",
    detail: "NO_DATA_AVAILABLE: No landfill inbound data has been ingested.",
    availableYears: [],
    ...overrides,
  };
}

/** A genuine request/server failure — the only case that may be an alert. */
function genuineError(
  overrides: Partial<LandfillUnavailableState> = {},
): LandfillUnavailableState {
  return {
    kind: "error",
    message: "잠시 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    // BARE, exactly as `landfillUnavailableFrom` produces it — the component owns the
    // `기술 정보: ` prefix. Baking the prefix in here would have made every error
    // render `기술 정보: 기술 정보: …` while the suite stayed green.
    detail: "INTERNAL_ERROR: upstream failure",
    availableYears: [],
    ...overrides,
  };
}

function renderDashboard(props: Partial<Parameters<typeof LandfillDashboard>[0]> = {}) {
  return render(
    <LandfillDashboard
      data={data()}
      unavailable={null}
      year={null}
      setYear={noop}
      month={null}
      setMonth={noop}
      origin={null}
      setOrigin={noop}
      waste={null}
      setWaste={noop}
      // Owned by the page in production so they survive an empty or failed
      // response; the fixture mirrors what a successful load would have supplied.
      availableYears={[2023, 2024, 2025]}
      wasteOptions={["생활"]}
      maxMonth={12}
      {...props}
    />,
  );
}

describe("LandfillDashboard", () => {
  it("renders the heading and the metropolitan-only limitation notice", () => {
    renderDashboard();
    expect(screen.getByText("수도권매립지 반입 현황")).toBeDefined();
    // Phase 5: the supporting sentence states the scope without claiming a
    // real-time figure, a resident bill, or any flow outside the inbound dataset.
    const orientation = screen.getByText(/수도권매립지로 반입된 공식 반입량과 반입수수료/);
    expect(orientation.textContent).toContain("선택한 기간과 조건");
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
        unavailable={null}
        availableYears={[2024]}
        wasteOptions={[]}
        maxMonth={12}
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
    renderDashboard({ data: null, unavailable: genuineError() });
    expect(screen.getByTestId("landfill-error")).toBeDefined();
    // No KPI or table may render from a previous selection.
    expect(screen.queryByTestId("landfill-kpis")).toBeNull();
    expect(screen.queryByTestId("landfill-region-table")).toBeNull();
    // The default error fixture must also prefix its diagnostic exactly once, so a
    // regression cannot hide behind the one test that supplies its own detail.
    expect(screen.getByTestId("landfill-error-detail").textContent).toBe(
      "기술 정보: INTERNAL_ERROR: upstream failure",
    );
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

  it("announces loaded results via a status region and claims no skip-link target", () => {
    renderDashboard();
    // Phase 1: the shared chrome (components/DashboardShell.tsx) owns the single
    // <main id="main-content" tabIndex={-1}> for EVERY view, so this dashboard must
    // no longer declare one — two targets would make the skip link ambiguous and two
    // <main> elements would be invalid. The flow view's skip-link target is asserted
    // at the page level (src/app/page.test.tsx) and in e2e/accessibility.spec.ts.
    const root = screen.getByTestId("landfill-dashboard");
    expect(root.getAttribute("id")).toBeNull();
    expect(root.tagName).not.toBe("MAIN");
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

/**
 * Phase 5 — desktop redesign contracts (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §9).
 *
 * These assert PRESENTATION invariants: the information hierarchy, the separation
 * of the five non-success states, and that every visual addition is redundant with
 * text that was already there. No served value, unit, period rule, denominator, or
 * comparability rule is asserted differently from the suite above — Phase 5 changed
 * none of them.
 */
describe("LandfillDashboard — Phase 5 desktop hierarchy", () => {
  it("mounts exactly one h1, no map, and no second navigation", () => {
    const { container } = renderDashboard();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("수도권매립지 반입 현황");
    // The source declares metropolitan totals only — there is nothing map-shaped
    // it can honestly support, so this view mounts no map at any width.
    expect(container.querySelector("[data-testid='map-container']")).toBeNull();
    expect(container.querySelector(".maplibregl-canvas")).toBeNull();
    expect(container.querySelector("nav")).toBeNull();
    // Nor may it grow an equity-style sidebar.
    expect(container.querySelector("aside")).toBeNull();
    // The shared shell owns the single skip-link target; this block declares none.
    expect(container.querySelector("#main-content")).toBeNull();
    expect(container.querySelector("main")).toBeNull();
  });

  it("shows the limitation as one compact info banner, not a standing alert", () => {
    renderDashboard();
    const banner = screen.getByTestId("landfill-limitation");
    // tone="info", and the severity word is TEXT so it never depends on color.
    expect(banner.className).toContain("wep-banner-info");
    expect(screen.getByTestId("landfill-limitation-tone").textContent).toContain("알림");
    // A permanent disclaimer must not interrupt a screen reader on every render.
    expect(banner.getAttribute("role")).toBeNull();
    // It still carries the four things a reader must know before any number.
    const text = banner.textContent ?? "";
    expect(text).toContain("공식 자료가 있는 기간만 표시");
    expect(text).toContain("부분 자료");
    expect(text).toContain("0이 아니라 자료 없음");
    // Exactly one banner: the caveat is not repeated in a second coloured panel.
    expect(document.querySelectorAll(".wep-banner")).toHaveLength(1);
  });

  it("keeps the four native selects, each with an accessible label", () => {
    const { container } = renderDashboard();
    const selects = container.querySelectorAll("select");
    expect(selects).toHaveLength(4);
    for (const testId of [
      "landfill-year-select",
      "landfill-month-select",
      "landfill-origin-select",
      "landfill-waste-select",
    ]) {
      const select = screen.getByTestId(testId);
      // Native, so keyboard behaviour and the platform picker are unchanged.
      expect(select.tagName).toBe("SELECT");
      // Wrapped by its <label>, so the accessible name is the visible Korean text.
      expect(select.closest("label")).not.toBeNull();
      expect((select.closest("label")?.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
    // The filter group is one addressable row.
    expect(screen.getByTestId("landfill-filters")).toBeDefined();
  });

  it("uses Korean-only primary labels in the filter row", () => {
    renderDashboard();
    const filters = screen.getByTestId("landfill-filters");
    const text = filters.textContent ?? "";
    // The Phase 0 G3 duplications are gone…
    for (const english of ["(Year)", "(Month / annual)", "(Origin)", "(Waste type)", "(all)", "(Seoul)"]) {
      expect(text, `filter row still shows "${english}"`).not.toContain(english);
    }
    // …and the plain Korean labels and options remain.
    for (const korean of ["연도", "기간", "출발 지역", "폐기물 종류", "최신 완결연도", "연간", "전체"]) {
      expect(text).toContain(korean);
    }
  });

  it("renders a decorative skeleton beside the announced loading status", () => {
    renderDashboard({ data: null });
    const status = screen.getByTestId("landfill-loading");
    expect(status.getAttribute("role")).toBe("status");
    // The skeleton is decorative and announces nothing.
    const skeleton = screen.getByTestId("landfill-loading-skeleton");
    expect(skeleton.getAttribute("aria-hidden")).toBe("true");
    // The status text is NOT inside the aria-hidden subtree.
    expect(skeleton.contains(status)).toBe(false);
    // No fabricated placeholder number and no zero-filled KPI while loading.
    expect(skeleton.textContent).toBe("");
    expect(screen.queryByTestId("landfill-kpis")).toBeNull();
    // The filter context is retained so the reader keeps their bearings.
    expect(screen.getByTestId("landfill-filters")).toBeDefined();
  });

  it("separates a no-data answer from a genuine error", () => {
    renderDashboard({ data: null, unavailable: noDataState({ availableYears: [2023, 2024] }) });
    const empty = screen.getByTestId("landfill-no-data");
    // "No official record" is an answer, not a fault: never an alert.
    expect(empty.getAttribute("role")).toBeNull();
    expect(screen.queryByTestId("landfill-error")).toBeNull();
    // It never fabricates a zero to fill the space.
    expect(empty.textContent).not.toContain("0 t");
    expect(empty.textContent).not.toContain("0원");
    expect(screen.queryByTestId("landfill-kpis")).toBeNull();
    // Available periods are shown only because the backend served them.
    expect(screen.getByTestId("landfill-available-years").textContent).toContain("2023, 2024");
    // The filters stay operable so the reader can pick a period that exists.
    expect(screen.getByTestId("landfill-filters")).toBeDefined();
  });

  it("omits the available-year line when the backend serves no year list", () => {
    renderDashboard({ data: null, unavailable: noDataState({ availableYears: [] }) });
    // Never invented: an empty list means the dashboard says nothing about years.
    expect(screen.queryByTestId("landfill-available-years")).toBeNull();
  });

  it("keeps a genuine error an alert, in plain Korean, with the code demoted", () => {
    renderDashboard({
      data: null,
      unavailable: genuineError({ detail: "SOMETHING_BROKE: upstream timeout" }),
    });
    const error = screen.getByTestId("landfill-error");
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain("잠시 문제가 발생했습니다");
    // The raw backend text is retained, but only as a diagnostic detail line —
    // never as the citizen's sole explanation.
    const detail = screen.getByTestId("landfill-error-detail");
    expect(detail.hasAttribute("data-diagnostic")).toBe(true);
    expect(detail.textContent).toContain("SOMETHING_BROKE");
  });

  it("never shows the raw NO_DATA_AVAILABLE sentence as the citizen explanation", () => {
    renderDashboard({ data: null, unavailable: noDataState() });
    const empty = screen.getByTestId("landfill-no-data");
    expect(empty.textContent).toContain("현재 조건에 맞는 공식 자료가 없습니다.");
    // The English backend sentence may survive only inside the diagnostic line.
    const diagnostic = screen.getByTestId("landfill-no-data-detail");
    expect(diagnostic.hasAttribute("data-diagnostic")).toBe(true);
    const withoutDiagnostics = (empty.textContent ?? "").replace(diagnostic.textContent ?? "", "");
    expect(withoutDiagnostics).not.toContain("NO_DATA_AVAILABLE");
    expect(withoutDiagnostics).not.toContain("No landfill inbound data");
  });

  it("makes each KPI value more prominent than its explanation", () => {
    renderDashboard();
    for (const testId of [
      "landfill-kpi-quantity",
      "landfill-kpi-fee",
      "landfill-kpi-effective-fee",
    ]) {
      const card = screen.getByTestId(testId);
      const value = card.querySelector("dd");
      const caption = card.querySelector("p");
      expect(value, `${testId} has no value element`).not.toBeNull();
      expect(caption, `${testId} has no caption`).not.toBeNull();
      // Value: at least text-xl and semibold, with aligned digits.
      expect(value?.className).toMatch(/text-(xl|3xl)/);
      expect(value?.className).toMatch(/font-(semibold|bold)/);
      expect(value?.className).toContain("tabular-nums");
      // Explanation: strictly smaller, and never bolder than the value.
      expect(caption?.className).toContain("text-xs");
      expect(caption?.className).not.toMatch(/font-(semibold|bold)/);
    }
  });

  it("keeps an unavailable KPI unavailable — a reason, never a zero", () => {
    const unavailable = perCapita({
      fee_per_capita_krw: null,
      population: null,
      unavailable_reason: "NO_METROPOLITAN_POPULATION",
    });
    renderDashboard({ data: data({ fee_per_capita: unavailable }) });
    const kpi = screen.getByTestId("landfill-kpi-per-capita");
    expect(screen.getByTestId("landfill-per-capita-unavailable").textContent).toBe(
      "해당 광역지자체 인구 데이터 없음",
    );
    expect(kpi.textContent).not.toContain("0원");
    // A known reason is fully described in Korean, so no code is echoed beside it.
    expect(screen.queryByTestId("landfill-per-capita-code")).toBeNull();
  });

  it("translates an unknown reason code instead of printing it as the label", () => {
    // Redesign plan §4 defect X6: the label used to read `계산 불가 (SOMETHING_NEW)`.
    const unavailable = perCapita({
      fee_per_capita_krw: null,
      population: null,
      unavailable_reason: "SOMETHING_NEW",
    });
    renderDashboard({ data: data({ fee_per_capita: unavailable }) });
    expect(screen.getByTestId("landfill-per-capita-unavailable").textContent).toBe("계산 불가");
    // The code is not deleted from the system — it is demoted to a diagnostic line.
    const code = screen.getByTestId("landfill-per-capita-code");
    expect(code.hasAttribute("data-diagnostic")).toBe(true);
    expect(code.textContent).toContain("SOMETHING_NEW");
  });

  it("keeps the exact text value beside every comparison bar", () => {
    renderDashboard();
    for (const testId of ["landfill-origin-comparison", "landfill-waste-composition"]) {
      const section = screen.getByTestId(testId);
      const rows = section.querySelectorAll("li");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of Array.from(rows)) {
        // The value is text, with its unit — the bar is never the only encoding.
        expect(row.textContent).toMatch(/\d/);
        expect(row.textContent).toContain("t");
        // Every bar is decorative; assistive technology reads the number instead.
        const bar = row.querySelector("[aria-hidden]");
        if (bar) expect(bar.getAttribute("aria-hidden")).toBe("true");
      }
      // The reference period stays attached to the comparison.
      expect(section.textContent).toContain("기준 기간");
    }
  });

  it("normalises comparison bars only within the rows on screen", () => {
    renderDashboard();
    const bars = screen
      .getByTestId("landfill-origin-comparison")
      .querySelectorAll<HTMLElement>("[aria-hidden] > span");
    expect(bars.length).toBe(3);
    // Three equal fixture quantities → three equal, full-width bars. The scale is
    // the displayed set's own maximum, not an external reference.
    for (const bar of Array.from(bars)) {
      expect(bar.style.width).toBe("100%");
    }
  });

  it("draws no bar at all when a row has no proportion to show", () => {
    // Every quantity zero → no positive maximum → no bar may be drawn, because a
    // full-width or zero-width track would both assert something the data does not.
    renderDashboard({
      data: data({
        origin_shares: [
          originShare("KR-SGIS-11", "11", "서울시", { quantity_tons: "0", quantity_kg: "0" }),
        ],
      }),
    });
    const section = screen.getByTestId("landfill-origin-comparison");
    expect(section.querySelectorAll("[aria-hidden] > span")).toHaveLength(0);
    expect(section.textContent).toContain("비율 표시 불가");
    // The official reported figure itself is still shown as text.
    expect(section.textContent).toContain("0 t");
  });

  it("keeps the regional table semantic and locally scrollable", () => {
    renderDashboard();
    const section = screen.getByTestId("landfill-region-table");
    const table = section.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelector("caption")).not.toBeNull();
    expect(section.querySelectorAll("th[scope='col']")).toHaveLength(4);
    expect(section.querySelectorAll("th[scope='row']").length).toBeGreaterThan(0);
    // The table — not the page — owns its horizontal overflow.
    expect(table?.parentElement?.className).toContain("overflow-x-auto");
  });

  it("keeps trend gaps as gaps and never as zero bars", () => {
    // A year with only two served months must draw two bars, not twelve.
    renderDashboard({
      data: {
        ...data(),
        trends: {
          ...data().trends,
          points: [
            {
              reference_month: "2024-01",
              reference_year: 2024,
              quantity_kg: "90000000",
              quantity_tons: "90000.000000",
              inbound_fee_krw: "9000000000.00",
              effective_fee_per_ton: "100000.00",
            },
            {
              reference_month: "2024-05",
              reference_year: 2024,
              quantity_kg: "80000000",
              quantity_tons: "80000.000000",
              inbound_fee_krw: "8000000000.00",
              effective_fee_per_ton: "100000.00",
            },
          ],
        },
      },
    });
    const chart = screen.getByTestId("landfill-trend-quantity");
    expect(chart.querySelectorAll("rect")).toHaveLength(2);
    // The unserved months are absent from the exact table too — not zero rows.
    const rows = screen.getByTestId("landfill-trend-quantity-table").querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(chart.textContent).toContain("자료가 없는 달은 막대를 그리지 않으며 0으로 채우지 않습니다");
    // Quantity and fee units stay distinct.
    expect(screen.getByTestId("landfill-trend-quantity-axis").textContent).toContain("톤 (t)");
    expect(screen.getByTestId("landfill-trend-fee-axis").textContent).not.toContain("톤 (t)");
  });

  it("keeps evidence, methodology, and limitations reachable in disclosures", () => {
    renderDashboard();
    const evidence = screen.getByTestId("landfill-evidence");
    for (const testId of [
      "landfill-evidence-sources",
      "landfill-evidence-comparability",
      "landfill-evidence-method",
      "landfill-limitation-details",
    ]) {
      const section = screen.getByTestId(testId);
      expect(section.tagName).toBe("DETAILS");
      // Always a real label, never icon-only.
      expect((screen.getByTestId(`${testId}-summary`).textContent ?? "").trim().length)
        .toBeGreaterThan(1);
    }
    // Nothing that must announce is buried in a collapsed disclosure.
    const live = screen.getByTestId("landfill-live");
    expect(live.closest("details")).toBeNull();
    // Provenance and caveats are all still present.
    expect(evidence.textContent).toContain("행정안전부 주민등록 인구통계");
    expect(screen.getByTestId("landfill-caveats").textContent).toContain("시·군·구별 반입량");
    expect(screen.getByTestId("landfill-comparability-note").textContent).toContain("2015-01");
  });

  it("names the accounting basis in Korean and demotes its enum", () => {
    renderDashboard();
    const comparability = screen.getByTestId("landfill-evidence-comparability");
    expect(comparability.textContent).toContain("수도권 반입 기준(매립지로 들어온 양)");
    // The raw basis is retained for diagnostics — the three bases stay segregated
    // and identifiable — but it is no longer the only explanation offered.
    const code = screen.getByTestId("landfill-accounting-basis-code");
    expect(code.hasAttribute("data-diagnostic")).toBe(true);
    expect(code.textContent).toContain("VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW");
  });

  it("leaks no forbidden technical token into the primary surface", () => {
    const { container } = renderDashboard();
    // Strip the diagnostic layer: codes are legal there by design (§5 rule 12).
    const clone = container.cloneNode(true) as HTMLElement;
    for (const node of Array.from(clone.querySelectorAll("[data-diagnostic]"))) {
      node.remove();
    }
    const primary = clone.textContent ?? "";
    for (const token of FORBIDDEN_PRIMARY_TOKENS) {
      expect(primary.includes(token), `landfill primary surface leaks "${token}"`).toBe(false);
    }
    // Nor a bare English parenthetical on a primary label.
    for (const english of ["(Evidence)", "(Origin)", "(Year)", "(by metropolitan origin)"]) {
      expect(primary).not.toContain(english);
    }
  });

  it("keeps the advertised years selectable in the no-data state", () => {
    // The panel tells the reader to pick a different year, so every year it names
    // must actually be an option — otherwise the advice is a dead end.
    renderDashboard({
      data: null,
      availableYears: [2023, 2024],
      unavailable: noDataState({ availableYears: [2023, 2024] }),
    });
    expect(screen.getByTestId("landfill-available-years").textContent).toContain("2023, 2024");
    const options = Array.from(
      screen.getByTestId("landfill-year-select").querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(options).toContain("2023");
    expect(options).toContain("2024");
  });

  it("never leaves the year select blank when the selection has no data", () => {
    // A native <select> whose value matches no <option> renders EMPTY. Selecting a
    // year the backend then reports as empty must not erase the control's own state.
    renderDashboard({
      data: null,
      year: 2022,
      availableYears: [2023, 2024],
      unavailable: noDataState({ availableYears: [2023, 2024] }),
    });
    const select = screen.getByTestId("landfill-year-select") as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("2022");
    expect(select.value).toBe("2022");
    // Years are still newest-first, with the reader's own selection folded in.
    const years = options.filter((value) => value !== "").map(Number);
    expect(years).toEqual([...years].sort((a, b) => b - a));
  });

  it("keeps the month options bounded by the period, and never blanks them", () => {
    // A partial year covers only five months, so the 기간 control must offer 1–5…
    renderDashboard({ maxMonth: 5 });
    let options = Array.from(
      screen.getByTestId("landfill-month-select").querySelectorAll("option"),
    ).map((o) => o.value);
    expect(options).toEqual(["", "1", "2", "3", "4", "5"]);

    // …but if a narrower bound arrives while a wider month is selected, the control
    // still shows the reader's own selection rather than rendering blank.
    cleanup();
    renderDashboard({ maxMonth: 5, month: 12 });
    const select = screen.getByTestId("landfill-month-select") as HTMLSelectElement;
    options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("12");
    expect(select.value).toBe("12");
  });

  it("keeps a selected waste type visible when the served options omit it", () => {
    renderDashboard({ waste: "생활", wasteOptions: [] });
    const select = screen.getByTestId("landfill-waste-select") as HTMLSelectElement;
    expect(select.value).toBe("생활");
  });

  it("keeps the filter controls populated while a request is in flight", () => {
    // Options are owned by the page, so a null `data` (the cleared transition state)
    // does not strip the controls the reader needs to correct their selection.
    renderDashboard({ data: null, unavailable: null, availableYears: [2023, 2024] });
    expect(screen.getByTestId("landfill-loading")).toBeDefined();
    expect(
      screen.getByTestId("landfill-year-select").querySelectorAll("option").length,
    ).toBeGreaterThan(1);
  });

  it("announces the no-data state politely without becoming an alert", () => {
    renderDashboard({ data: null, unavailable: noDataState() });
    const live = screen.getByTestId("landfill-no-data-live");
    // Polite: it waits for a pause rather than interrupting, which is the right
    // register for "there is nothing here" — but silence would be wrong too, since
    // the whole results region is replaced when a filter empties it.
    expect(live.getAttribute("role")).toBe("status");
    expect(live.closest("details")).toBeNull();
    // The visible panel itself is still not an alert.
    expect(screen.getByTestId("landfill-no-data").getAttribute("role")).toBeNull();
  });

  it("prefixes a diagnostic line exactly once", () => {
    renderDashboard({
      data: null,
      // The bare technical string a helper now returns for an unstructured failure.
      unavailable: genuineError({ detail: "Backend request failed with status 502" }),
    });
    const detail = screen.getByTestId("landfill-error-detail").textContent ?? "";
    expect(detail).toBe("기술 정보: Backend request failed with status 502");
    expect(detail).not.toContain("기술 정보: 기술 정보");
    expect(detail).not.toContain("기술 정보: 기술 코드");
  });

  it("keeps an unknown row-level reason code recoverable from the table", () => {
    const unknown = perCapita({
      fee_per_capita_krw: null,
      population: null,
      unavailable_reason: "SOMETHING_NEW",
    });
    renderDashboard({
      data: data({
        origin_shares: [originShare("KR-SGIS-11", "11", "서울시", { fee_per_capita: unknown })],
      }),
    });
    const row = screen.getAllByTestId("landfill-region-row")[0];
    // Primary cell: safe Korean, never the raw enum and never a zero.
    expect(within(row).getByTestId("landfill-row-unavailable").textContent).toBe("계산 불가");
    expect(row.textContent).not.toContain("0원/인");
    // The code is demoted, not deleted (redesign plan §5 rule 12).
    const diagnostic = row.querySelector("[data-diagnostic]");
    expect(diagnostic?.textContent).toContain("SOMETHING_NEW");
  });

  it("omits the row diagnostic when the reason is already translated", () => {
    const known = perCapita({
      fee_per_capita_krw: null,
      population: null,
      unavailable_reason: "NO_MATCHING_POPULATION_PERIOD",
    });
    renderDashboard({
      data: data({
        origin_shares: [originShare("KR-SGIS-11", "11", "서울시", { fee_per_capita: known })],
      }),
    });
    const row = screen.getAllByTestId("landfill-region-row")[0];
    expect(within(row).getByTestId("landfill-row-unavailable").textContent).toBe(
      "동일 기간 인구 데이터 없음",
    );
    // Echoing the code beside its own translation is the duplication Phase 5 removes.
    expect(row.querySelector("[data-diagnostic]")).toBeNull();
  });

  it("draws no bar when a malformed value makes the maximum non-finite", () => {
    // `Math.max(...)` over a non-numeric string is NaN, and `NaN <= 0` is false — an
    // unguarded ratio would emit `width: NaN%`, which the CSSOM drops, leaving every
    // bar at its `auto` width and painting all rows as if they were the maximum.
    renderDashboard({
      data: data({
        origin_shares: [
          originShare("KR-SGIS-11", "11", "서울시", { quantity_tons: "not-a-number" }),
          originShare("KR-SGIS-28", "28", "인천시"),
        ],
      }),
    });
    const section = screen.getByTestId("landfill-origin-comparison");
    for (const bar of Array.from(section.querySelectorAll<HTMLElement>("[aria-hidden] > span"))) {
      expect(bar.style.width).not.toContain("NaN");
      expect(bar.style.width).not.toContain("Infinity");
    }
    // The served text is still shown for every row — the bar is the redundant part.
    expect(section.textContent).toContain("비율 표시 불가");
  });

  it("preserves the partial-year covered period and never calls it an annual total", () => {
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
    const partial = screen.getByTestId("landfill-partial-year");
    expect(partial.textContent).toContain("2026-05");
    expect(partial.textContent).toContain("연간 합계가 아닙니다");
  });
});
