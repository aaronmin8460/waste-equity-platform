// @vitest-environment jsdom

/**
 * Rendering tests for 시·군·구별 생활폐기물 수집·운반 계약 지급액.
 *
 * The fixtures below are SYNTHETIC LAYOUT FIXTURES shaped like the real
 * `GET /api/v1/landfill/municipal-costs` payload — never official data. No
 * assertion claims a value is correct; every one is a behaviour or an
 * internal-consistency check. The scope counts in `meta` are the SERVED ones and
 * the tests assert the UI reads them from there rather than counting rendered rows,
 * which is exactly the property that keeps the summary honest under a filter.
 *
 * What this file owns, in the order the section is read:
 *   - the section renders, and its distinction from the official landfill dataset
 *     is visible without expanding anything;
 *   - the served scope metadata (66 / 20 / 5 / 41) is presented, not recomputed;
 *   - the three filters and the sort control call back with backend enum values;
 *   - AVAILABLE / PARTIAL / UNAVAILABLE are each presented distinctly, and an
 *     unavailable municipality shows 자료 없음 rather than ₩0 while keeping its row;
 *   - the seven derived Gyeonggi populations are labelled as computed ward sums;
 *   - loading, error, and empty-filter states are distinct from one another and
 *     from a municipality's own missing value;
 *   - the mobile card list and the desktop table disclose the same fields;
 *   - accessibility: table semantics, labelled controls, native disclosures.
 *
 * The desktop table and the mobile card list are BOTH in the DOM (Tailwind swaps
 * them with `display: none`, which jsdom does not compute), so assertions are
 * scoped with `within()` to one or the other rather than using bare `getByText`.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type {
  MunicipalCostMeta,
  MunicipalCostResponse,
  MunicipalCostRow,
} from "../../lib/api";
import { FORBIDDEN_PRIMARY_TOKENS } from "../../lib/glossary";
import MunicipalCostSection from "./MunicipalCostSection";
import {
  MUNICIPAL_COST_DISTINCTION_TITLE,
  MUNICIPAL_COST_NO_MATCH_TITLE,
  MUNICIPAL_COST_SECTION_TITLE,
  MUNICIPAL_COST_UNAVAILABLE_LABEL,
} from "./municipalCostShared";

afterEach(cleanup);

const noop = () => {};

/**
 * The backend's served difference sentence, as this fixture serves it.
 *
 * It used to end "두 값은 합산·차감·비율 계산 대상이 아닙니다" — a flat prohibition on
 * the addition. Page 2 now publishes exactly that addition as 주민 1인당 총 관리비용,
 * so the served wording was revised AT ITS SOURCE
 * (`backend/.../models/municipal_cost.py`, text only — no schema, no migration, no
 * logic). The distinction itself is unchanged and still asserted; what the sentence
 * now requires is that the basis difference be STATED when the two are combined,
 * which is what the combined column's own note does.
 */
const DIFFERENCE_SENTENCE =
  "이 지표는 수도권매립지 공식 반입수수료(LANDFILL_INBOUND_FEE_PER_CAPITA)와 다른 회계 기준입니다. " +
  "두 값을 함께 제시할 때에는 회계 기준·제공기관·공간 단위와 인구 기준이 서로 다르다는 점을 " +
  "반드시 함께 밝혀야 합니다.";

function row(overrides: Partial<MunicipalCostRow> = {}): MunicipalCostRow {
  return {
    municipality_key: "41-이천시",
    display_name: "이천시",
    metropolitan_code: "41",
    metropolitan_name: "경기도",
    direct_region_code: "KR-SGIS-31210",
    boundary_vintage: "2024",
    population: 230189,
    population_method: "DIRECT_REGION_POPULATION",
    population_definition: "SGIS_TOTAL_POPULATION",
    population_components: [],
    total_eligible_payment_krw: "49238756000.00",
    eligible_contract_count: 5,
    payment_per_capita_krw: "213905.7731",
    status: "AVAILABLE",
    evidence_status: "LOCAL_GOVERNMENT_SOURCE_INPUTS_DERIVED_VALUE",
    reason_codes: [],
    limitations: [],
    source_files: [
      {
        filename: "이천시.xlsx",
        dataset_role: "DATA_A",
        layout_family: "DATA_A_CONTRACT_QUANTITY_PAIRS",
        primary_classification: "DATA_A_PAYMENT_AND_QUANTITY",
        resolution_basis: "WORKBOOK_ORGANISATION_NAME",
        sha256: "f3f8fc30",
      },
    ],
    has_data_a: true,
    has_data_b: false,
    quantity_coverage: {
      observation_count: 88,
      measured_count: 75,
      measured_zero_count: 0,
      missing_count: 13,
      repeated_municipal_block_count: 36,
      months_covered: 12,
      waste_categories: ["COMBINED", "GENERAL"],
    },
    ...overrides,
  };
}

/** A PARTIAL row: a value WAS served, with a served scope limitation. */
const PARTIAL_ROW = row({
  municipality_key: "28-부평구",
  display_name: "부평구",
  metropolitan_code: "28",
  metropolitan_name: "인천광역시",
  direct_region_code: "KR-SGIS-23050",
  population: 486000,
  total_eligible_payment_krw: "9653500000.00",
  payment_per_capita_krw: "19863.0342",
  status: "PARTIAL",
  reason_codes: ["PARTIAL_WASTE_SCOPE"],
  limitations: ["계약이 생활폐기물 전체가 아닌 일부 품목만 포함합니다."],
});

/** An UNAVAILABLE row: no payment was disclosed. Population still exists. */
const UNAVAILABLE_ROW = row({
  municipality_key: "11-강남구",
  display_name: "강남구",
  metropolitan_code: "11",
  metropolitan_name: "서울특별시",
  direct_region_code: "KR-SGIS-11230",
  population: 528194,
  total_eligible_payment_krw: null,
  eligible_contract_count: 0,
  payment_per_capita_krw: null,
  status: "UNAVAILABLE",
  reason_codes: ["MISSING_PAYMENT"],
  limitations: ["지급액 자료가 없습니다(수량 자료만 있거나 금액 칸이 비어 있음)."],
  source_files: [],
});

/** One of the seven Gyeonggi cities whose denominator is a computed ward sum. */
const DERIVED_ROW = row({
  municipality_key: "41-부천시",
  display_name: "부천시",
  direct_region_code: null,
  population: 794082,
  population_method: "DERIVED_SUM_OF_CONSTITUENT_WARDS",
  population_components: [
    { region_code: "KR-SGIS-31051", region_name: "경기도 부천시 원미구", population: 401522 },
    { region_code: "KR-SGIS-31052", region_name: "경기도 부천시 소사구", population: 240865 },
    { region_code: "KR-SGIS-31053", region_name: "경기도 부천시 오정구", population: 151695 },
  ],
  total_eligible_payment_krw: "63893296000.00",
  payment_per_capita_krw: "80461.8364",
});

function meta(overrides: Partial<MunicipalCostMeta> = {}): MunicipalCostMeta {
  return {
    indicator_code: "MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA",
    display_name: "주민 1인당 생활폐기물 수집·운반 계약 지급액",
    description:
      "2024년 지자체 생활폐기물 수집·운반 계약의 확인된 실제 지급액을 동일 행정구역의 2024년 인구로 나눈 분석 지표",
    reference_year: 2024,
    unit: "KRW/인",
    accounting_basis: "MUNICIPAL_CONTRACTED_COLLECTION_TRANSPORT_PAYMENT",
    methodology_version: "municipal-collection-transport-payment-per-capita-v1",
    geography_policy: "2024년 행정구역 기준입니다. 서울 25개 자치구, 인천 10개 군·구, 경기 31개 시·군입니다.",
    population_policy:
      "분모는 2024년 SGIS 연간 인구입니다. 경기 7개 시는 구성 일반구의 인구를 합산해 산출합니다.",
    numerator_definition: "DATA_A 계약 헤더 행의 실제 지급액으로 확인된 값의 합계입니다.",
    difference_from_official_landfill_fee: DIFFERENCE_SENTENCE,
    is_official_landfill_fee: false,
    // The full published 2024 scope.
    expected_count: 66,
    available_count: 20,
    partial_count: 5,
    unavailable_count: 41,
    returned_count: 4,
    rejected_source_file_count: 2,
    rejected_source_files: [
      {
        filename: "양천구.xlsx",
        dataset_role: "DATA_B",
        reason_codes: ["AMBIGUOUS_REGION_MAPPING"],
        explanation: "양천구는 서울특별시 자치구이며 경기도에는 존재하지 않습니다.",
      },
      {
        filename: "서해구xlsx.xlsx",
        dataset_role: "DATA_B",
        reason_codes: ["BOUNDARY_MISMATCH", "ZERO_TOTAL_QUANTITY"],
        explanation: "2024년 행정구역으로 되돌릴 문서화된 근거가 없는 2026년 명칭 파일입니다.",
      },
    ],
    source_coverage: {
      discovered_file_count: 64,
      accepted_file_count: 62,
      rejected_file_count: 2,
      data_a_file_count: 29,
      data_b_file_count: 35,
      municipalities_with_data_a: 29,
      municipalities_with_data_b: 33,
      municipalities_with_no_source_file: 19,
    },
    caveats: [
      "이 지표는 개별 기초지자체가 공개한 2024년 수집·운반 대행 계약의 지급액입니다.",
      "값이 없는 지자체는 0이 아닙니다. 사유 코드를 함께 확인해야 합니다.",
    ],
    ...overrides,
  };
}

function response(overrides: Partial<MunicipalCostResponse> = {}): MunicipalCostResponse {
  return {
    meta: meta(),
    sido_filter: null,
    status_filter: null,
    sort: "payment_per_capita_desc",
    municipalities: [row(), DERIVED_ROW, PARTIAL_ROW, UNAVAILABLE_ROW],
    ...overrides,
  };
}

function renderSection(props: Partial<Parameters<typeof MunicipalCostSection>[0]> = {}) {
  return render(
    <MunicipalCostSection
      data={response()}
      error={null}
      sido={null}
      setSido={noop}
      status={null}
      setStatus={noop}
      sort="payment_per_capita_desc"
      setSort={noop}
      {...props}
    />,
  );
}

/**
 * Open the 시·군·구별 상세 modal.
 *
 * 기술요청 #8/#16 moved the 66-row comparison out of an inline `<details>` and behind
 * a 상세 보기 button, into the popup the Figma frame draws (`327:428`). The table's own
 * rules — served order, absence never rendered as ₩0, the derived-population caption,
 * the tier vocabulary — are UNCHANGED by that move, so these assertions are unchanged
 * too; they just have to open the surface the table now lives on first.
 *
 * Idempotent, so an accessor can call it without knowing whether it already ran.
 */
function openDetail(): void {
  if (screen.queryByTestId("municipal-cost-table")) return;
  const trigger = screen.queryByTestId("municipal-cost-detail-open");
  if (trigger) fireEvent.click(trigger);
}

/** The desktop table's row for one municipality. */
function tableRow(name: string): HTMLElement {
  openDetail();
  const table = screen.getByTestId("municipal-cost-table");
  const found = within(table)
    .getAllByTestId("municipal-cost-row")
    .find((element) => element.getAttribute("data-municipality") === name);
  if (!found) throw new Error(`no table row for ${name}`);
  return found;
}

// --------------------------------------------------------------------------- //
// 1 — the section renders
// --------------------------------------------------------------------------- //

describe("section shell", () => {
  it("renders the full section under its own heading", () => {
    renderSection();
    const section = screen.getByTestId("municipal-cost-section");
    expect(section).toBeInTheDocument();
    // A titled SectionCard is a <section> named by its heading, so a screen-reader
    // user can enumerate it as its own region rather than as loose text inside the
    // official landfill dashboard.
    expect(section.tagName).toBe("SECTION");
    expect(screen.getByRole("heading", { name: MUNICIPAL_COST_SECTION_TITLE })).toBeInTheDocument();
  });

  it("names the unit and the year in the heading", () => {
    renderSection();
    // 시·군·구 (not 시·도) and 2024 are the two facts that stop this being read as
    // the metropolitan landfill dataset above it.
    expect(MUNICIPAL_COST_SECTION_TITLE).toContain("시·군·구");
    expect(MUNICIPAL_COST_SECTION_TITLE).toContain("2024년");
  });

  /**
   * 기술요청 #8/#16 changed this shape on purpose.
   *
   * The comparison is no longer a sub-card in the section's flow — it is the popup the
   * Figma frame draws (`327:428`), reached from a 상세 보기 button. What stays IN the
   * flow is everything that describes the dataset's coverage, so the reader can still
   * see what it covers without opening anything: the filters, the served scope, the row
   * count, the reference year and the methodology.
   */
  it("lays the section out as condition → 상세 보기 → methodology, with the comparison in a modal", () => {
    renderSection();
    const filters = screen.getByTestId("municipal-cost-filters");
    const trigger = screen.getByTestId("municipal-cost-detail-open");
    const methodology = screen.getByTestId("municipal-cost-methodology");
    for (const card of [filters, methodology]) {
      expect(card.tagName).toBe("SECTION");
    }
    expect(filters.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(trigger.compareDocumentPosition(methodology) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // The comparison is NOT in the flow until it is asked for.
    expect(screen.queryByTestId("municipal-cost-comparison")).toBeNull();
    openDetail();
    expect(screen.getByTestId("municipal-cost-comparison")).toBeInTheDocument();
  });

  it("states the comparison's units in its card header", () => {
    renderSection();
    openDetail();
    const comparison = screen.getByTestId("municipal-cost-comparison");
    expect(within(comparison).getByRole("heading", { level: 3 })).toHaveTextContent(
      "지자체별 상세 비교",
    );
    expect(comparison).toHaveTextContent("단위: 원/인, 억원");
  });
});

// --------------------------------------------------------------------------- //
// 2 — the official-landfill distinction
// --------------------------------------------------------------------------- //

describe("distinction from the official landfill dataset", () => {
  it("shows the served difference statement without expanding anything", () => {
    renderSection();
    const banner = screen.getByTestId("municipal-cost-distinction");
    // Not inside a <details>: the sentence that tells a reader these two figures rest
    // on different bases must be visible on arrival.
    expect(banner.closest("details")).toBeNull();
    // Served VERBATIM, not paraphrased.
    expect(screen.getByTestId("municipal-cost-distinction-served")).toHaveTextContent(
      DIFFERENCE_SENTENCE,
    );
    expect(banner).toHaveTextContent("회계 기준·제공기관·공간 단위와 인구 기준이 서로 달라");
  });

  it("states the distinction in words, never as a colour or a severity chip", () => {
    renderSection();
    // Page-2 remediation: this is no longer a coloured `tone="warning"` banner. It
    // is a compact note — so there is no severity chip to assert, and the whole
    // statement has to survive in TEXT. That is the stronger contract: a caution
    // carried by a chip and a background is a caution a grayscale render loses.
    const note = screen.getByTestId("municipal-cost-distinction");
    expect(note.className).not.toContain("wep-banner");
    expect(note).toHaveTextContent(MUNICIPAL_COST_DISTINCTION_TITLE);
    // The DISTINCTION survives in text (which is the point of this test — a caution
    // carried only by a chip and a background is lost in a grayscale render). What it
    // no longer does is forbid the sum the page now publishes.
    expect(note).toHaveTextContent("회계 기준·제공기관·공간 단위와 인구 기준이 서로 달라");
    expect(note.textContent).not.toContain("비교할 수 없습니다");
  });

  it("is not an alert — a standing caveat must not interrupt on every render", () => {
    renderSection();
    expect(screen.getByTestId("municipal-cost-distinction")).not.toHaveAttribute("role", "alert");
  });

  it("never labels the section as the official landfill fee or a total waste cost", () => {
    const { container } = renderSection();
    const text = container.textContent ?? "";
    for (const forbidden of ["반입수수료 현황", "공식 매립지 수수료", "폐기물 총관리비", "처리비"]) {
      expect(text).not.toContain(forbidden);
    }
    // The one place 반입수수료 legitimately appears is the served sentence that says
    // this is NOT that dataset.
    expect(screen.getByTestId("municipal-cost-distinction-served")).toHaveTextContent(
      "다른 회계 기준입니다",
    );
  });

  it("does not expose the deferred landfill-associated estimate", () => {
    const { container } = renderSection();
    expect(container.textContent ?? "").not.toContain(
      "MUNICIPAL_LANDFILL_ASSOCIATED_COST_PER_CAPITA_ESTIMATE",
    );
  });
});

// --------------------------------------------------------------------------- //
// 3 — served scope metadata
// --------------------------------------------------------------------------- //

describe("scope summary", () => {
  it("presents the served 66 / 20 / 5 / 41 counts", () => {
    renderSection();
    expect(screen.getByTestId("municipal-cost-count-expected")).toHaveTextContent("66");
    expect(screen.getByTestId("municipal-cost-count-available")).toHaveTextContent("20");
    expect(screen.getByTestId("municipal-cost-count-partial")).toHaveTextContent("5");
    expect(screen.getByTestId("municipal-cost-count-unavailable")).toHaveTextContent("41");
  });

  it("reads the counts from metadata rather than counting the rendered rows", () => {
    // Only four rows are rendered, but the served scope is 66. A UI that counted its
    // own rows would print 4 — and would silently under-report the moment a filter
    // narrowed the list.
    renderSection();
    openDetail();
    expect(screen.getAllByTestId("municipal-cost-row")).toHaveLength(4);
    expect(screen.getByTestId("municipal-cost-count-expected")).toHaveTextContent("66");
    // A different served scope must move the summary, proving it is not hard-coded.
    cleanup();
    renderSection({
      data: response({
        meta: meta({ expected_count: 25, available_count: 0, partial_count: 0, unavailable_count: 25 }),
      }),
    });
    expect(screen.getByTestId("municipal-cost-count-expected")).toHaveTextContent("25");
  });

  it("states how many rows the applied filters returned, separately from the scope", () => {
    renderSection();
    expect(screen.getByTestId("municipal-cost-returned")).toHaveTextContent("4곳");
    // The "unavailable municipalities are not dropped" rule is stated ONCE, under the
    // table it governs (MUNICIPAL_COST_TABLE_FOOTNOTES) rather than a second time in
    // this summary — and that one statement also carries the "0이 아니다" half.
    expect(screen.getByTestId("municipal-cost-returned")).not.toHaveTextContent(
      "목록에서 빼지 않고",
    );
    openDetail();
    expect(screen.getByTestId("municipal-cost-table-notes")).toHaveTextContent(
      "목록에서 빼지 않고",
    );
    openDetail();
    expect(screen.getByTestId("municipal-cost-table-notes")).toHaveTextContent(
      "0이라는 뜻이 아닙니다",
    );
  });

  it("shows no counts at all before a response — never zeros", () => {
    renderSection({ data: null });
    expect(screen.getByTestId("municipal-cost-summary-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("municipal-cost-count-expected")).toBeNull();
  });

  it("puts the source coverage in the methodology layer, not the comparison view", () => {
    renderSection();
    expect(screen.getByTestId("municipal-cost-files-discovered")).toHaveTextContent("64");
    expect(screen.getByTestId("municipal-cost-files-accepted")).toHaveTextContent("62");
    expect(screen.getByTestId("municipal-cost-files-rejected")).toHaveTextContent("2");
    // It lives inside a collapsed disclosure so it does not occupy the main view.
    expect(screen.getByTestId("municipal-cost-files-discovered").closest("details")).not.toBeNull();
  });

  it("names the two rejected workbooks with their served reasons", () => {
    renderSection();
    const rejected = screen.getByTestId("municipal-cost-rejected-files");
    expect(rejected).toHaveTextContent("양천구.xlsx");
    expect(rejected).toHaveTextContent("서해구xlsx.xlsx");
    expect(rejected).toHaveTextContent("경기도에는 존재하지 않습니다");
  });
});

// --------------------------------------------------------------------------- //
// 4/5/6 — filters and sorting
// --------------------------------------------------------------------------- //

describe("filters and sorting", () => {
  it("offers the metropolitan filter in Korean and reports the backend sido code", () => {
    const setSido = vi.fn();
    renderSection({ setSido });
    const select = screen.getByLabelText("지역") as HTMLSelectElement;
    // Each metropolitan is named with the tier of 기초자치단체 it is made of. The three
    // tiers are different kinds of local government and are not interchangeable.
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "전체",
      "서울 자치구",
      "인천 군·구",
      "경기 시·군",
    ]);
    fireEvent.change(select, { target: { value: "41" } });
    expect(setSido).toHaveBeenCalledWith("41");
    // 전체 clears the parameter rather than sending a sentinel.
    fireEvent.change(select, { target: { value: "" } });
    expect(setSido).toHaveBeenLastCalledWith(null);
  });

  it("offers the four status scopes as chips with Korean labels and no enum text", () => {
    const setStatus = vi.fn();
    renderSection({ setStatus });
    const group = screen.getByRole("group", { name: "자료 상태" });
    expect(
      within(group)
        .getAllByRole("button")
        // The served count rides inside the chip, so compare the leading label only.
        .map((button) => button.textContent?.replace(/\d+$/, "").trim()),
    ).toEqual(["계산 가능", "일부 제한", "자료 없음", "전체"]);
    // The backend enum never becomes citizen-facing text.
    expect(group.textContent ?? "").not.toContain("AVAILABLE");
    expect(group.textContent ?? "").not.toContain("UNAVAILABLE");
    fireEvent.click(within(group).getByTestId("municipal-cost-status-PARTIAL"));
    expect(setStatus).toHaveBeenCalledWith("PARTIAL");
  });

  it("reports 전체 as null — the backend's 'no status parameter', not a sentinel", () => {
    const setStatus = vi.fn();
    renderSection({ status: "AVAILABLE", setStatus });
    fireEvent.click(screen.getByTestId("municipal-cost-status-ALL"));
    expect(setStatus).toHaveBeenCalledWith(null);
  });

  it("switches between every status scope from the chips", () => {
    const setStatus = vi.fn();
    renderSection({ setStatus });
    for (const [testId, expected] of [
      ["municipal-cost-status-AVAILABLE", "AVAILABLE"],
      ["municipal-cost-status-PARTIAL", "PARTIAL"],
      ["municipal-cost-status-UNAVAILABLE", "UNAVAILABLE"],
      ["municipal-cost-status-ALL", null],
    ] as const) {
      fireEvent.click(screen.getByTestId(testId));
      expect(setStatus).toHaveBeenLastCalledWith(expected);
    }
  });

  it("offers exactly the three backend sort orders and reports their enum values", () => {
    const setSort = vi.fn();
    renderSection({ setSort });
    const select = screen.getByLabelText("정렬") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "payment_per_capita_desc",
      "total_payment_desc",
      "region_name_asc",
    ]);
    fireEvent.change(select, { target: { value: "region_name_asc" } });
    expect(setSort).toHaveBeenCalledWith("region_name_asc");
  });

  it("reflects the applied filters back into the controls", () => {
    renderSection({ sido: "28", status: "UNAVAILABLE", sort: "total_payment_desc" });
    expect(screen.getByLabelText("지역")).toHaveValue("28");
    expect(screen.getByLabelText("정렬")).toHaveValue("total_payment_desc");
    // Chip state is `aria-pressed`, so it is announced rather than only coloured.
    expect(screen.getByTestId("municipal-cost-status-UNAVAILABLE")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const other of ["AVAILABLE", "PARTIAL", "ALL"]) {
      expect(screen.getByTestId(`municipal-cost-status-${other}`)).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  });

  it("restates the applied selection, including the tier of the chosen metropolitan", () => {
    renderSection({ sido: "28", status: "PARTIAL", sort: "region_name_asc" });
    const summary = screen.getByTestId("municipal-cost-summary");
    expect(summary).toHaveTextContent("인천 군·구");
    expect(summary).toHaveTextContent("일부 제한");
    expect(summary).toHaveTextContent("지역 이름순");
  });

  it("renders rows in the SERVED order and never re-sorts them", () => {
    // The backend places nulls last; a client-side re-sort would lose that rule and
    // could order an unavailable municipality as if it were the cheapest.
    renderSection();
    openDetail();
    const names = within(screen.getByTestId("municipal-cost-table"))
      .getAllByTestId("municipal-cost-row")
      .map((element) => element.getAttribute("data-municipality"));
    expect(names).toEqual(["이천시", "부천시", "부평구", "강남구"]);
  });

  it("re-renders the served order a different sort returned, without reordering it", () => {
    // Sorting is a BACKEND parameter: the component renders whatever order arrived.
    const byName = [UNAVAILABLE_ROW, DERIVED_ROW, PARTIAL_ROW, row()];
    renderSection({
      sort: "region_name_asc",
      data: response({ sort: "region_name_asc", municipalities: byName }),
    });
    openDetail();
    expect(
      within(screen.getByTestId("municipal-cost-table"))
        .getAllByTestId("municipal-cost-row")
        .map((element) => element.getAttribute("data-municipality")),
    ).toEqual(["강남구", "부천시", "부평구", "이천시"]);
  });
});

// --------------------------------------------------------------------------- //
// 6b — the demo default scope
// --------------------------------------------------------------------------- //

describe("default comparison scope", () => {
  it("marks the released 계산 가능 default as the pressed chip", () => {
    // `app/page.tsx` opens on MUNICIPAL_COST_DEFAULT_STATUS; the section renders
    // whatever scope it is handed, and this is that scope.
    renderSection({ status: "AVAILABLE" });
    expect(screen.getByTestId("municipal-cost-status-AVAILABLE")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("municipal-cost-status-ALL")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("says the view is narrowed and names the full scope it can be widened to", () => {
    renderSection({ status: "AVAILABLE" });
    const note = screen.getByTestId("municipal-cost-scope-note");
    expect(note).toHaveTextContent("‘계산 가능’ 지자체만 표시합니다");
    // The number is the SERVED expected_count, so widening is an honest offer.
    expect(note).toHaveTextContent("66곳");
  });

  it("keeps every scope's served size on the control while one scope is applied", () => {
    // The default hides nothing: the size of what it excludes is on screen.
    renderSection({ status: "AVAILABLE" });
    expect(screen.getByTestId("municipal-cost-count-available")).toHaveTextContent("20");
    expect(screen.getByTestId("municipal-cost-count-partial")).toHaveTextContent("5");
    expect(screen.getByTestId("municipal-cost-count-unavailable")).toHaveTextContent("41");
    expect(screen.getByTestId("municipal-cost-count-expected")).toHaveTextContent("66");
  });

  it("drops the narrowed-view note when the reader has selected 전체", () => {
    renderSection({ status: null });
    expect(screen.queryByTestId("municipal-cost-scope-note")).toBeNull();
    expect(screen.getByTestId("municipal-cost-status-ALL")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

// --------------------------------------------------------------------------- //
// 7/8/9 — status presentation
// --------------------------------------------------------------------------- //

describe("status presentation", () => {
  it("shows an AVAILABLE municipality's values with a 계산 가능 badge", () => {
    renderSection();
    const cells = tableRow("이천시");
    expect(within(cells).getByTestId("municipal-cost-status-badge")).toHaveTextContent("계산 가능");
    expect(cells).toHaveTextContent("213,906원/인");
    expect(cells).toHaveTextContent("492.4억원");
  });

  it("distinguishes PARTIAL from AVAILABLE and states why it is partial", () => {
    renderSection();
    const partial = tableRow("부평구");
    const badge = within(partial).getByTestId("municipal-cost-status-badge");
    expect(badge).toHaveTextContent("일부 제한");
    // A DIFFERENT badge kind from AVAILABLE, so the two are not merely differently
    // worded — and the state is carried by text, not colour alone.
    expect(badge).toHaveAttribute("data-status", "caveat");
    expect(
      within(tableRow("이천시")).getByTestId("municipal-cost-status-badge"),
    ).toHaveAttribute("data-status", "derived");
    // The reason is in the ROW, not only behind the disclosure: a partial value that
    // looks ordinary until expanded is a value shown without its qualifier.
    expect(within(partial).getByTestId("municipal-cost-row-limitation")).toHaveTextContent(
      "계약이 생활폐기물 전체가 아닌 일부 품목만 포함합니다.",
    );
  });

  it("shows an UNAVAILABLE municipality as 자료 없음 — never ₩0", () => {
    renderSection();
    const unavailable = tableRow("강남구");
    expect(within(unavailable).getByTestId("municipal-cost-status-badge")).toHaveTextContent(
      MUNICIPAL_COST_UNAVAILABLE_LABEL,
    );
    expect(
      within(unavailable).getByTestId("municipal-cost-per-capita-unavailable"),
    ).toHaveTextContent(MUNICIPAL_COST_UNAVAILABLE_LABEL);
    expect(within(unavailable).getByTestId("municipal-cost-total-unavailable")).toHaveTextContent(
      MUNICIPAL_COST_UNAVAILABLE_LABEL,
    );
    // The load-bearing negative: no zero-shaped money anywhere in the row.
    const text = unavailable.textContent ?? "";
    for (const zero of ["₩0", "0원/인", "0억원", "0 원"]) {
      expect(text).not.toContain(zero);
    }
    // And the served reason is present.
    expect(within(unavailable).getByTestId("municipal-cost-row-limitation")).toHaveTextContent(
      "지급액 자료가 없습니다",
    );
  });

  it("keeps unavailable municipalities in the list rather than hiding them", () => {
    // Whatever scope is applied, a row the backend RETURNED is always rendered — the
    // section never drops a served row for having no value.
    renderSection({ status: null });
    expect(tableRow("강남구")).toBeInTheDocument();
    expect(screen.getByTestId("municipal-cost-status-ALL")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("marks a PARTIAL value on the value itself, not only in the status column", () => {
    renderSection();
    const partial = tableRow("부평구");
    const marker = within(partial).getByTestId("municipal-cost-partial-marker");
    expect(marker).toHaveTextContent("제한 있음");
    // And the value points at the served limitation, so a screen-reader user hears
    // the qualification at the number rather than a column away.
    const limitation = within(partial).getByTestId("municipal-cost-row-limitation");
    expect(limitation.id).not.toBe("");
    const describedValue = partial.querySelector(`[aria-describedby='${limitation.id}']`);
    expect(describedValue).not.toBeNull();
    expect(describedValue?.textContent).toContain("19,863원/인");
  });

  it("puts no 제한 있음 marker on an unlimited available row", () => {
    renderSection();
    expect(
      within(tableRow("이천시")).queryByTestId("municipal-cost-partial-marker"),
    ).toBeNull();
  });

  it("does not describe an unavailable value by its reason — the cell already says it", () => {
    // 자료 없음 is in the cell itself; pointing at the reason as well would announce
    // absence twice.
    renderSection();
    const unavailable = tableRow("강남구");
    expect(
      within(unavailable).queryByTestId("municipal-cost-partial-marker"),
    ).toBeNull();
    expect(unavailable.querySelector("[aria-describedby]")).toBeNull();
  });

  it("uses the neutral missing badge for absence, not the amber caveat one", () => {
    renderSection();
    // Amber cautions about a value that EXISTS; absence is a different state.
    expect(
      within(tableRow("강남구")).getByTestId("municipal-cost-status-badge"),
    ).toHaveAttribute("data-status", "missing");
  });

  it("does not downgrade a municipality for missing quantity data alone", () => {
    // MISSING_QUANTITY is reported but never feeds the payment indicator.
    renderSection({
      data: response({
        municipalities: [
          row({
            reason_codes: ["MISSING_QUANTITY"],
            limitations: ["반출량(톤) 자료가 없습니다. 지급액 지표 계산에는 영향이 없습니다."],
          }),
        ],
      }),
    });
    const only = tableRow("이천시");
    expect(within(only).getByTestId("municipal-cost-status-badge")).toHaveTextContent("계산 가능");
    expect(only).toHaveTextContent("213,906원/인");
  });
});

// --------------------------------------------------------------------------- //
// 10 — derived populations
// --------------------------------------------------------------------------- //

describe("derived Gyeonggi populations", () => {
  it("labels a derived denominator as a computed ward sum in the row itself", () => {
    renderSection();
    const derived = tableRow("부천시");
    expect(within(derived).getByTestId("municipal-cost-derived-marker")).toHaveTextContent(
      "구성 일반구 인구 합산",
    );
  });

  it("itemises the constituent 일반구 in the disclosure", () => {
    renderSection();
    const derived = tableRow("부천시");
    expect(within(derived).getByTestId("municipal-cost-population-components")).toHaveTextContent(
      "경기도 부천시 원미구 401,522명",
    );
    expect(within(derived).getByTestId("municipal-cost-derived-population")).toHaveTextContent(
      "구성 일반구 인구 합산",
    );
  });

  it("does not mark a directly reported population as derived", () => {
    renderSection();
    expect(
      within(tableRow("이천시")).queryByTestId("municipal-cost-derived-marker"),
    ).toBeNull();
    expect(within(tableRow("이천시")).getByTestId("municipal-cost-detail-population")).toHaveTextContent(
      "해당 행정구역 인구",
    );
  });

  it("draws no map and fabricates no geometry for the aggregate city rows", () => {
    const { container } = renderSection();
    expect(container.querySelector("[data-testid='map-container']")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });
});

// --------------------------------------------------------------------------- //
// 10b — local-government terminology
// --------------------------------------------------------------------------- //

describe("geographic terminology", () => {
  it("names each municipality's metropolitan and its tier of local government", () => {
    renderSection();
    // 서울 자치구 / 인천 군·구 / 경기 시·군 — three different kinds of 기초자치단체, so a
    // single "시·군·구" label would be right only in aggregate and wrong per row.
    expect(
      within(tableRow("강남구")).getByTestId("municipal-cost-scope-caption"),
    ).toHaveTextContent("서울특별시 · 자치구");
    expect(
      within(tableRow("부평구")).getByTestId("municipal-cost-scope-caption"),
    ).toHaveTextContent("인천광역시 · 군·구");
    expect(
      within(tableRow("이천시")).getByTestId("municipal-cost-scope-caption"),
    ).toHaveTextContent("경기도 · 시·군");
  });

  it("carries the caption exactly once per municipality", () => {
    renderSection();
    // It used to be asserted twice — once on the table row, once on the phone card
    // list that shipped beside it. That duplicate is gone (see the responsive
    // describe below), so the caption now has one home per row and cannot drift.
    openDetail();
    openDetail();
    expect(screen.getAllByTestId("municipal-cost-scope-caption")).toHaveLength(
      screen.getAllByTestId("municipal-cost-row").length,
    );
  });

  it("omits the tier rather than guessing one for an unrecognised metropolitan", () => {
    // A row from outside the three published metropolitans has a tier this UI does
    // not know; printing a plausible one would be a fabricated fact about it.
    renderSection({
      data: response({
        municipalities: [row({ metropolitan_code: "99", metropolitan_name: "다른광역시" })],
      }),
    });
    const caption = within(tableRow("이천시")).getByTestId("municipal-cost-scope-caption");
    expect(caption).toHaveTextContent("다른광역시");
    expect(caption.textContent).not.toContain("시·군");
  });

  it("explains the caption under the table rather than leaving it to be inferred", () => {
    renderSection();
    openDetail();
    expect(screen.getByTestId("municipal-cost-table-notes")).toHaveTextContent(
      "서울 자치구 · 인천 군·구 · 경기 시·군",
    );
  });
});

// --------------------------------------------------------------------------- //
// 10c — the 2024 reference year
// --------------------------------------------------------------------------- //

describe("reference-year semantics", () => {
  it("shows the SERVED reference year as a chip on the condition card", () => {
    renderSection();
    expect(screen.getByTestId("municipal-cost-reference-year")).toHaveTextContent("2024년 자료");
  });

  it("takes the year from the response, never from a frontend constant", () => {
    renderSection({ data: response({ meta: meta({ reference_year: 2023 }) }) });
    expect(screen.getByTestId("municipal-cost-reference-year")).toHaveTextContent("2023년 자료");
  });

  it("says the year does not follow the landfill view's own year control", () => {
    // The screen above defaults to the latest complete landfill year. Without this
    // sentence a reader who set that control to 2025 reads these as 2025 payments.
    renderSection();
    expect(screen.getByTestId("municipal-cost-year-note")).toHaveTextContent(
      "위 반입 현황에서 고른 연도와 상관없이",
    );
    expect(screen.getByTestId("municipal-cost-year-note")).toHaveTextContent("2024년 자료만");
  });

  it("keeps the year in the section heading too, where it needs no expansion", () => {
    renderSection();
    expect(MUNICIPAL_COST_SECTION_TITLE).toContain("2024년");
    expect(screen.getByTestId("municipal-cost-year-note").closest("details")).toBeNull();
  });

  it("shows no year chip before a response — the year is served, not assumed", () => {
    renderSection({ data: null });
    expect(screen.queryByTestId("municipal-cost-reference-year")).toBeNull();
  });
});

// --------------------------------------------------------------------------- //
// 10d — nothing is hard-coded
// --------------------------------------------------------------------------- //

describe("no frontend fallback data", () => {
  it("moves every scope count when the served metadata changes", () => {
    renderSection({
      data: response({
        meta: meta({
          expected_count: 31,
          available_count: 7,
          partial_count: 2,
          unavailable_count: 22,
        }),
      }),
    });
    expect(screen.getByTestId("municipal-cost-count-expected")).toHaveTextContent("31");
    expect(screen.getByTestId("municipal-cost-count-available")).toHaveTextContent("7");
    expect(screen.getByTestId("municipal-cost-count-partial")).toHaveTextContent("2");
    expect(screen.getByTestId("municipal-cost-count-unavailable")).toHaveTextContent("22");
  });

  it("renders whichever municipalities were served, with no whitelist of its own", () => {
    renderSection({
      data: response({
        municipalities: [row({ municipality_key: "41-포천시", display_name: "포천시" })],
      }),
    });
    expect(tableRow("포천시")).toBeInTheDocument();
    openDetail();
    expect(screen.getAllByTestId("municipal-cost-row")).toHaveLength(1);
    // And no municipality from the section's own fixtures leaked into the render.
    expect(screen.queryByTestId("municipal-cost-table")?.textContent).not.toContain("강남구");
  });

  it("shows no scope figure at all when a request failed", () => {
    // A failure means the platform knows nothing about the scope, so it says nothing
    // rather than falling back to the released 66 / 20 / 5 / 41.
    renderSection({ data: null, error: { message: "실패했습니다.", detail: null } });
    for (const testId of [
      "municipal-cost-count-expected",
      "municipal-cost-count-available",
      "municipal-cost-count-partial",
      "municipal-cost-count-unavailable",
    ]) {
      expect(screen.queryByTestId(testId)).toBeNull();
    }
    expect(screen.queryByTestId("municipal-cost-scope-note")).toBeNull();
  });
});

// --------------------------------------------------------------------------- //
// 11/12/13 — loading, error, empty-filter states
// --------------------------------------------------------------------------- //

describe("loading, error, and empty states", () => {
  it("announces loading in a live region and shows no digits", () => {
    renderSection({ data: null });
    const loading = screen.getByTestId("municipal-cost-loading");
    expect(loading).toHaveAttribute("role", "status");
    // The skeleton is decorative only.
    expect(screen.getByTestId("municipal-cost-loading-skeleton")).toHaveAttribute("aria-hidden");
    expect(screen.queryByTestId("municipal-cost-table")).toBeNull();
    openDetail();
    expect(screen.queryByTestId("municipal-cost-row")).toBeNull();
  });

  it("shows an actionable alert on a genuine failure and no stale rows", () => {
    renderSection({
      data: null,
      error: { message: "잠시 문제가 발생했습니다.", detail: "INTERNAL_ERROR: upstream failure" },
    });
    const error = screen.getByTestId("municipal-cost-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent("잠시 문제가 발생했습니다.");
    openDetail();
    expect(screen.queryByTestId("municipal-cost-row")).toBeNull();
    // The backend code is kept as a diagnostic, prefixed exactly once.
    const detail = screen.getByTestId("municipal-cost-error-detail");
    expect(detail).toHaveAttribute("data-diagnostic");
    expect(detail.textContent).toBe("기술 정보: INTERNAL_ERROR: upstream failure");
  });

  it("distinguishes an empty FILTER result from a municipality's missing value", () => {
    renderSection({ data: response({ municipalities: [] }) });
    const empty = screen.getByTestId("municipal-cost-no-match");
    expect(empty).toHaveTextContent(MUNICIPAL_COST_NO_MATCH_TITLE);
    // Explicitly says this is about the filter, not about anyone's payment being 0.
    expect(empty).toHaveTextContent("지급액이 0이라는 뜻이 아닙니다");
    // It is NOT an error and NOT an alert.
    expect(screen.queryByTestId("municipal-cost-error")).toBeNull();
    expect(empty.closest("[role='alert']")).toBeNull();
    // A polite live region still announces the change.
    expect(screen.getByTestId("municipal-cost-no-match-live")).toHaveAttribute("role", "status");
  });

  it("never routes an unavailable municipality through the error state", () => {
    renderSection({ data: response({ municipalities: [UNAVAILABLE_ROW] }) });
    expect(screen.queryByTestId("municipal-cost-error")).toBeNull();
    expect(screen.queryByTestId("municipal-cost-no-match")).toBeNull();
    expect(tableRow("강남구")).toBeInTheDocument();
  });

  it("keeps the filters operable while a request is in flight", () => {
    renderSection({ data: null });
    expect(screen.getByLabelText("지역")).toBeEnabled();
    expect(screen.getByLabelText("자료 상태")).toBeEnabled();
    expect(screen.getByLabelText("정렬")).toBeEnabled();
  });
});

// --------------------------------------------------------------------------- //
// 14 — methodology
// --------------------------------------------------------------------------- //

describe("methodology and transparency", () => {
  it("states the indicator, its unit, and its evidence class", () => {
    renderSection();
    expect(screen.getByTestId("municipal-cost-indicator-name")).toHaveTextContent(
      "주민 1인당 생활폐기물 수집·운반 계약 지급액",
    );
    expect(screen.getByTestId("municipal-cost-unit")).toHaveTextContent("KRW/인");
    expect(screen.getByTestId("municipal-cost-indicator-code")).toHaveTextContent(
      "MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA",
    );
    expect(screen.getByTestId("municipal-cost-evidence-class")).toHaveTextContent(
      "LOCAL_GOVERNMENT_SOURCE_INPUTS_DERIVED_VALUE",
    );
  });

  it("keeps every technical identifier inside a diagnostic line", () => {
    renderSection();
    for (const testId of [
      "municipal-cost-indicator-code",
      "municipal-cost-evidence-class",
      "municipal-cost-method-version",
    ]) {
      expect(screen.getByTestId(testId)).toHaveAttribute("data-diagnostic");
    }
  });

  it("shows the served geography, population, and numerator policies", () => {
    renderSection();
    expect(screen.getByTestId("municipal-cost-geography-policy")).toHaveTextContent(
      "2024년 행정구역 기준",
    );
    expect(screen.getByTestId("municipal-cost-population-policy")).toHaveTextContent(
      "구성 일반구의 인구를 합산",
    );
    expect(screen.getByTestId("municipal-cost-numerator")).toHaveTextContent("실제 지급액");
    expect(screen.getByTestId("municipal-cost-caveats")).toHaveTextContent("0이 아닙니다");
  });

  it("leaks no forbidden technical token into the primary surface", () => {
    const { container } = renderSection();
    // Strip the diagnostic layer: codes are legal there by design.
    const clone = container.cloneNode(true) as HTMLElement;
    for (const node of Array.from(clone.querySelectorAll("[data-diagnostic]"))) {
      node.remove();
    }
    const primary = clone.textContent ?? "";
    for (const token of FORBIDDEN_PRIMARY_TOKENS) {
      expect(primary.includes(token), `municipal-cost primary surface leaks "${token}"`).toBe(
        false,
      );
    }
  });
});

// --------------------------------------------------------------------------- //
// 15 — responsive behaviour
// --------------------------------------------------------------------------- //

describe("responsive presentation", () => {
  it("renders ONE form of the comparison — the unreachable phone duplicate is gone", () => {
    renderSection();
    // The comparison used to ship twice: `hidden md:block` for the table and a
    // `md:hidden` <ul> of cards beside it. That second tree could never be seen —
    // `DashboardShell` returns `NarrowScreenGate` INSTEAD OF its children below
    // DESKTOP_MIN_WIDTH (1024), while `md:hidden` only reveals cards under 768 — so
    // it was 66 duplicate rows of markup no viewport could reach, and every rule
    // below had to be implemented and asserted twice to stay true of both.
    openDetail();
    expect(screen.getByTestId("municipal-cost-table")).toBeInTheDocument();
    expect(screen.queryByTestId("municipal-cost-cards")).toBeNull();
    expect(screen.queryAllByTestId("municipal-cost-card")).toHaveLength(0);
    // And the surviving table is no longer gated behind a breakpoint of its own.
    openDetail();
    expect(screen.getByTestId("municipal-cost-table").closest("div.hidden")).toBeNull();
  });

  it("preserves every primary field on a row", () => {
    renderSection();
    // The fields the removed card list carried — 지자체 / 상태 / 1인당 / 총액 / 한계 —
    // asserted where they actually render.
    const row = tableRow("부평구");
    expect(row).toHaveTextContent("부평구");
    expect(within(row).getByTestId("municipal-cost-status-badge")).toHaveTextContent("일부 제한");
    expect(row).toHaveTextContent("19,863원/인");
    expect(row).toHaveTextContent("96.5억원");
    expect(within(row).getByTestId("municipal-cost-row-limitation")).toHaveTextContent(
      "일부 품목만 포함합니다",
    );
  });

  it("shows 자료 없음 rather than a zero for an unavailable municipality", () => {
    renderSection();
    const row = tableRow("강남구");
    expect(within(row).getByTestId("municipal-cost-per-capita-unavailable")).toHaveTextContent(
      MUNICIPAL_COST_UNAVAILABLE_LABEL,
    );
    expect(row.textContent ?? "").not.toContain("0원/인");
  });

  it("keeps the table's own horizontal scrolling off the page body", () => {
    renderSection();
    openDetail();
    const scroller = screen.getByTestId("municipal-cost-table").parentElement;
    expect(scroller?.className).toContain("overflow-x-auto");
  });
});

// --------------------------------------------------------------------------- //
// 16 — accessibility-sensitive markup
// --------------------------------------------------------------------------- //

describe("accessibility", () => {
  it("uses real table markup with a caption and column headers", () => {
    renderSection();
    openDetail();
    const table = screen.getByTestId("municipal-cost-table");
    expect(table.tagName).toBe("TABLE");
    expect(table.querySelector("caption")?.textContent).toContain("자료 없음으로 표시");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((element) => element.textContent?.trim());
    // The former standalone 광역 column is now a caption under the municipality's
    // name, where it can also carry the tier the column could not.
    expect(headers).toEqual([
      "지자체",
      "주민 1인당 지급액",
      "총 지급액",
      "자료 상태",
      "데이터 참고",
    ]);
    // The municipality is the ROW header, so each cell is announced with its place.
    expect(within(table).getAllByRole("rowheader").length).toBe(4);
  });

  it("gives every control a real visible label", () => {
    renderSection();
    for (const label of ["지역", "자료 상태", "정렬"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("uses native disclosures, so the expanded state is correct for free", () => {
    renderSection();
    const detail = within(tableRow("이천시")).getByTestId("municipal-cost-detail");
    expect(detail.tagName).toBe("DETAILS");
    // Never icon-only: the summary always carries a real label.
    const summary = within(tableRow("이천시")).getByTestId("municipal-cost-detail-summary");
    expect((summary.textContent ?? "").trim().length).toBeGreaterThan(1);
    expect(summary).toHaveTextContent("이천시 산출 근거와 출처");
  });

  it("keeps the live region outside every collapsed disclosure", () => {
    renderSection();
    // A collapsed <details> is hidden from the accessibility tree, so it must not
    // be the only home for something that has to announce.
    const live = screen.getByTestId("municipal-cost-live");
    expect(live.closest("details")).toBeNull();
    expect(live).toHaveAttribute("role", "status");
  });

  it("carries the section's own heading hierarchy under the dashboard h1", () => {
    renderSection();
    // The section heading is an h2; the methodology card nests as an h3.
    expect(screen.getByRole("heading", { level: 2, name: MUNICIPAL_COST_SECTION_TITLE }));
    expect(screen.getByRole("heading", { level: 3, name: "산출 방법과 한계" }));
  });
});
