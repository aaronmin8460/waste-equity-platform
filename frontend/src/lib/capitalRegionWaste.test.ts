/**
 * The capital-region municipal join and the two derived totals.
 *
 * These are the assertions that keep the Page-2 headline figures honest. They are
 * written against the SHAPE of the deployed payloads (verified read-only against
 * the OCI backend during the Page-2 remediation), not against a convenient fixture:
 * the seven Gyeonggi cities really do arrive with a null `direct_region_code`, the
 * facility inventory really is keyed on 일반구, and 인천 really does arrive as SGIS
 * 23 while the landfill filter calls it 28.
 */

import { describe, expect, it } from "vitest";

import type {
  FacilityBurdenEnvelope,
  FacilityBurdenItem,
  MunicipalCostResponse,
  MunicipalCostRow,
  ReportingPerCapitaEnvelope,
  ReportingPerCapitaItem,
  ReportingWasteStatisticsEnvelope,
  ReportingWasteStatisticsItem,
} from "./api";
import {
  buildCapitalRegionWaste,
  coverageSentence,
  formatPerCapitaKg,
  perCapitaKgPerYear,
  scopeOfLandfillOrigin,
  sumExactDecimals,
} from "./capitalRegionWaste";

// --------------------------------------------------------------------------- //
// Fixtures
// --------------------------------------------------------------------------- //

function statsItem(
  code: string,
  name: string,
  stream: string,
  generation: string,
  children: string[] | null = null,
): ReportingWasteStatisticsItem {
  return {
    reporting_region_code: code,
    reporting_region_name: name,
    reporting_geography_type: children ? "DERIVED_CITY_UNION" : "NATIVE_SGIS",
    geometry_kind: children ? "DERIVED" : "NATIVE",
    source_reporting_level: children ? "CITY" : "SIGUNGU",
    waste_stream: stream,
    waste_category_name: "총계",
    generation_quantity: generation,
    recycling_quantity: "0.000000",
    incineration_quantity: "0.000000",
    landfill_quantity: "0.000000",
    other_treatment_quantity: "0.000000",
    total_treatment_quantity: generation,
    total_treatment_is_derived: true,
    quantity_unit: "톤/년",
    accounting_basis: "ORIGIN_BASED_TREATMENT_OUTCOME",
    source_id: "waste_statistics",
    source_pid: "NTN007",
    official_dataset_name: "생활(가정)폐기물 발생량",
    reference_year: 2024,
    reference_period: "2024",
    child_region_codes: children,
  };
}

function perCapitaItem(code: string, name: string, population: number): ReportingPerCapitaItem {
  return {
    reporting_region_code: code,
    reporting_region_name: name,
    reporting_geography_type: "NATIVE_SGIS",
    source_reporting_level: "SIGUNGU",
    waste_stream: "HOUSEHOLD",
    per_capita_kg_per_year: "0",
    per_capita_unit: "kg/인/년",
    generation_quantity: "0",
    quantity_unit: "톤/년",
    accounting_basis: "ORIGIN_BASED_TREATMENT_OUTCOME",
    numerator_reporting_level: "SIGUNGU",
    waste_source_id: "waste_statistics",
    waste_source_pid: "NTN007",
    waste_official_dataset_name: "생활(가정)폐기물 발생량",
    waste_reference_period: "2024",
    population,
    population_definition: "SGIS_TOTAL_POPULATION",
    population_source_id: "sgis",
    population_reference_period: "2024",
    population_is_derived: false,
    population_derivation: null,
    child_region_codes: null,
    reference_year: 2024,
  };
}

function burdenItem(
  code: string,
  name: string,
  tons: string,
  population: number,
  overrides: Partial<FacilityBurdenItem> = {},
): FacilityBurdenItem {
  return {
    region_code: code,
    region_name: name,
    region_level: "SIGUNGU",
    facility_count_located: 3,
    throughput_located_tons_per_year: tons,
    throughput_located_kg_per_capita: "0",
    located_missing_throughput_count: 0,
    located_throughput_is_partial: false,
    facility_count_within_buffer: 0,
    throughput_within_buffer_tons_per_year: "0",
    throughput_within_buffer_kg_per_capita: "0",
    buffer_missing_throughput_count: 0,
    buffer_throughput_is_partial: false,
    quantity_unit: "톤/년",
    accounting_basis: "FACILITY_LOCATION_BASED_THROUGHPUT",
    facility_source_id: "waste_statistics",
    facility_reference_period: "2024",
    population,
    population_definition: "SGIS_TOTAL_POPULATION",
    population_source_id: "sgis",
    population_reference_period: "2024",
    reference_year: 2024,
    ...overrides,
  };
}

function contractRow(overrides: Partial<MunicipalCostRow> = {}): MunicipalCostRow {
  return {
    municipality_key: "11-종로구",
    display_name: "종로구",
    metropolitan_code: "11",
    metropolitan_name: "서울특별시",
    direct_region_code: "KR-SGIS-11010",
    boundary_vintage: "2024",
    population: 144486,
    population_method: "DIRECT_REGION_POPULATION",
    population_definition: "SGIS_TOTAL_POPULATION",
    population_components: [],
    total_eligible_payment_krw: "12345678900.00",
    eligible_contract_count: 4,
    payment_per_capita_krw: "85445.1200",
    status: "AVAILABLE",
    evidence_status: "LOCAL_GOVERNMENT_SOURCE_INPUTS_DERIVED_VALUE",
    reason_codes: [],
    limitations: [],
    source_files: [],
    has_data_a: true,
    has_data_b: false,
    quantity_coverage: {
      observation_count: 0,
      measured_count: 0,
      measured_zero_count: 0,
      missing_count: 0,
      repeated_municipal_block_count: 0,
      months_covered: 0,
      waste_categories: [],
    },
    ...overrides,
  };
}

/**
 * A miniature but structurally faithful capital region:
 *   서울 종로구        native, contract AVAILABLE
 *   인천 옹진군        native (SGIS 23!), one stream UNREPORTED, contract UNAVAILABLE
 *   경기 수원시        DERIVED_CITY_UNION over two 일반구, contract via components
 */
const SEOUL = "KR-SGIS-11010";
const ONGJIN = "KR-SGIS-23520";
const SUWON = "KR-RCISRG-3101";
const SUWON_CHILDREN = ["KR-SGIS-31011", "KR-SGIS-31012"];

function envelopes() {
  const reportingStats: ReportingWasteStatisticsEnvelope = {
    reference_year: 2024,
    count: 7,
    items: [
      statsItem(SEOUL, "서울특별시 종로구", "HOUSEHOLD", "83721.300000"),
      statsItem(SEOUL, "서울특별시 종로구", "CONSTRUCTION", "10000.000001"),
      statsItem(ONGJIN, "인천광역시 옹진군", "HOUSEHOLD", "5000.500000"),
      statsItem(ONGJIN, "인천광역시 옹진군", "CONSTRUCTION", "2500.250000"),
      statsItem(SUWON, "경기도 수원시", "HOUSEHOLD", "200000.000000", SUWON_CHILDREN),
      statsItem(SUWON, "경기도 수원시", "CONSTRUCTION", "100000.000000", SUWON_CHILDREN),
    ],
    unavailable_regions: [
      {
        reporting_region_code: ONGJIN,
        reporting_region_name: "인천광역시 옹진군",
        waste_stream: "INDUSTRIAL_FACILITY",
        reason: "SOURCE_NOT_REPORTED",
      },
    ],
  };
  const reportingPerCapita: ReportingPerCapitaEnvelope = {
    indicator: "PER_CAPITA_WASTE_GENERATION_REPORTING",
    derivation_version: "per-capita-v1",
    derivation_formula: "generation_quantity[톤/년] × 1000 ÷ population[persons]",
    unit: "kg/인/년",
    assumptions: [],
    reference_year: 2024,
    count: 3,
    items: [
      perCapitaItem(SEOUL, "서울특별시 종로구", 144486),
      perCapitaItem(ONGJIN, "인천광역시 옹진군", 20000),
      perCapitaItem(SUWON, "경기도 수원시", 1000000),
    ],
    excluded_regions: [],
  };
  const facilityBurden: FacilityBurdenEnvelope = {
    indicator: "FACILITY_BURDEN",
    derivation_version: "facility-burden-v1",
    derivation_formula: "sum(throughput_quantity[톤/년]) × 1000 ÷ population[persons]",
    buffer_meters: 5000,
    unit: "kg/인/년",
    assumptions: [],
    reference_year: 2024,
    count: 4,
    items: [
      burdenItem(SEOUL, "서울특별시 종로구", "1000.000000", 144486),
      burdenItem(ONGJIN, "인천광역시 옹진군", "2000.500000", 20000),
      burdenItem(SUWON_CHILDREN[0], "경기도 수원시 장안구", "3000.000000", 400000),
      burdenItem(SUWON_CHILDREN[1], "경기도 수원시 권선구", "4000.000000", 600000),
    ],
    excluded_regions: [],
    facilities_without_coordinates: 104,
    facilities_without_region: 99,
  };
  const municipalCost: MunicipalCostResponse = {
    meta: {
      indicator_code: "MUNICIPAL_WASTE_COLLECTION_TRANSPORT_PAYMENT_PER_CAPITA",
      display_name: "주민 1인당 생활폐기물 수집·운반 계약 지급액",
      description: "",
      reference_year: 2024,
      unit: "KRW/인",
      accounting_basis: "MUNICIPAL_CONTRACTED_COLLECTION_TRANSPORT_PAYMENT",
      methodology_version: "municipal-collection-transport-payment-per-capita-v1",
      geography_policy: "서울 25개 자치구, 인천 10개 군·구, 경기 31개 시·군",
      population_policy: "",
      numerator_definition: "",
      difference_from_official_landfill_fee: "다른 회계 기준입니다",
      is_official_landfill_fee: false,
      expected_count: 3,
      available_count: 2,
      partial_count: 0,
      unavailable_count: 1,
      returned_count: 3,
      rejected_source_file_count: 0,
      rejected_source_files: [],
      source_coverage: {
        discovered_file_count: 2,
        accepted_file_count: 2,
        rejected_file_count: 0,
        data_a_file_count: 2,
        data_b_file_count: 0,
        municipalities_with_data_a: 2,
        municipalities_with_data_b: 0,
        municipalities_with_no_source_file: 1,
      },
      caveats: [],
    },
    sido_filter: null,
    status_filter: null,
    sort: "region_name_asc",
    municipalities: [
      contractRow(),
      contractRow({
        municipality_key: "28-옹진군",
        display_name: "옹진군",
        metropolitan_code: "28",
        metropolitan_name: "인천광역시",
        direct_region_code: ONGJIN,
        population: 20000,
        // The absence case: no amount, no per-capita value, a served reason.
        total_eligible_payment_krw: null,
        payment_per_capita_krw: null,
        eligible_contract_count: 0,
        status: "UNAVAILABLE",
        reason_codes: ["NO_SOURCE_FILE"],
        limitations: ["공개된 계약 자료를 찾지 못했습니다."],
      }),
      contractRow({
        municipality_key: "41-수원시",
        display_name: "수원시",
        metropolitan_code: "41",
        metropolitan_name: "경기도",
        // The composite case: no direct code at all — it joins on its components.
        direct_region_code: null,
        population: 1000000,
        population_method: "DERIVED_SUM_OF_CONSTITUENT_WARDS",
        population_components: [
          { region_code: SUWON_CHILDREN[1], region_name: "권선구", population: 600000 },
          { region_code: SUWON_CHILDREN[0], region_name: "장안구", population: 400000 },
        ],
        total_eligible_payment_krw: "99000000000.00",
        payment_per_capita_krw: "99000.0000",
      }),
    ],
  };
  return { reportingStats, reportingPerCapita, facilityBurden, municipalCost };
}

// --------------------------------------------------------------------------- //
// Exact arithmetic
// --------------------------------------------------------------------------- //

describe("sumExactDecimals", () => {
  it("adds served decimal strings without floating-point drift", () => {
    // 0.1 + 0.2 is the canonical double-precision failure; as strings it must be
    // exactly 0.3, because this sum is published as a figure derived from official
    // values and has to be reproducible from them.
    expect(sumExactDecimals(["0.1", "0.2"])).toBe("0.3");
    expect(Number(sumExactDecimals(["0.1", "0.2"]))).not.toBe(0.1 + 0.2 + 1e-18);
  });

  it("preserves the source scale and aligns mixed scales", () => {
    expect(sumExactDecimals(["83721.300000", "10000.000001"])).toBe("93721.300001");
    expect(sumExactDecimals(["1", "2.5", "0.25"])).toBe("3.75");
  });

  it("returns null for an empty list rather than asserting a zero total", () => {
    // Nothing to add is not a total of zero — a caller must show absence.
    expect(sumExactDecimals([])).toBeNull();
  });

  it("returns null when ANY entry is unreadable, never a silent partial sum", () => {
    expect(sumExactDecimals(["1.0", "not-a-number", "2.0"])).toBeNull();
  });
});

describe("perCapitaKgPerYear", () => {
  it("uses the same formula the served per-capita endpoints publish", () => {
    // 100 톤 over 1,000 residents = 100 kg/인·년.
    expect(perCapitaKgPerYear("100", 1000)).toBe(100);
  });

  it("is null — never 0 and never Infinity — without a usable denominator", () => {
    expect(perCapitaKgPerYear("100", null)).toBeNull();
    expect(perCapitaKgPerYear("100", 0)).toBeNull();
    expect(perCapitaKgPerYear(null, 1000)).toBeNull();
  });
});

describe("scopeOfLandfillOrigin", () => {
  it("crosswalks the administrative sido codes onto the SGIS ones", () => {
    // The trap this exists for: 인천 is 28 to the landfill filter and 23 to every
    // region row; 경기 is 41 and 31. Joining on raw digits empties both silently.
    expect(scopeOfLandfillOrigin("11")).toBe("11");
    expect(scopeOfLandfillOrigin("28")).toBe("23");
    expect(scopeOfLandfillOrigin("41")).toBe("31");
    expect(scopeOfLandfillOrigin(null)).toBeNull();
  });
});

// --------------------------------------------------------------------------- //
// The join
// --------------------------------------------------------------------------- //

describe("buildCapitalRegionWaste", () => {
  it("derives the capital-region totals as an exact sum of the official rows", () => {
    const model = buildCapitalRegionWaste(envelopes());
    // 83721.300000 + 10000.000001 + 5000.5 + 2500.25 + 200000 + 100000
    expect(model.generation.tons).toBe("401222.050001");
    expect(model.generation.referenceYear).toBe(2024);
    expect(model.generation.accountingBasis).toBe("ORIGIN_BASED_TREATMENT_OUTCOME");
    // 1000 + 2000.5 + 3000 + 4000 — the two 일반구 roll into 수원시.
    expect(model.throughput.tons).toBe("10000.500000");
    expect(model.throughput.referenceYear).toBe(2024);
    expect(model.throughput.accountingBasis).toBe("FACILITY_LOCATION_BASED_THROUGHPUT");
  });

  it("reports the source's unreported cells instead of zero-filling them", () => {
    const model = buildCapitalRegionWaste(envelopes());
    expect(model.generation.missingCells).toHaveLength(1);
    expect(model.generation.missingCells[0].stream).toContain("INDUSTRIAL_FACILITY");
    expect(model.generation.missingCells[0].reason).toBe("SOURCE_NOT_REPORTED");
    // 옹진군 still contributes the streams it DID report — an unreported stream
    // removes a cell from the sum, not the whole municipality.
    const ongjin = model.groups
      .flatMap((group) => group.municipalities)
      .find((row) => row.code === ONGJIN);
    expect(ongjin?.generationTons).toBe("7500.750000");
    expect(ongjin?.missingStreams).toHaveLength(1);
  });

  it("discloses the facilities that belong to no region as an under-count", () => {
    const model = buildCapitalRegionWaste(envelopes());
    expect(model.throughput.unassignedFacilityCount).toBe(99);
    // Scoped to one metropolitan it is NOT claimed: the envelope does not say which
    // metropolitan those facilities would have fallen in, so attributing them would
    // be a guess.
    const seoulOnly = buildCapitalRegionWaste({ ...envelopes(), scope: "11" });
    expect(seoulOnly.throughput.unassignedFacilityCount).toBe(0);
  });

  it("groups municipalities under their metropolitan with the correct tier noun", () => {
    const model = buildCapitalRegionWaste(envelopes());
    expect(model.groups.map((group) => group.scope)).toEqual(["11", "23", "31"]);
    expect(model.groups.map((group) => group.tierLabel)).toEqual(["자치구", "군·구", "시·군"]);
    // Each group knows the landfill origin code its metropolitan row is keyed by.
    expect(model.groups.map((group) => group.landfillOrigin)).toEqual(["11", "28", "41"]);
  });

  it("joins the seven composite Gyeonggi cities on their 일반구, not on a name", () => {
    const model = buildCapitalRegionWaste(envelopes());
    const suwon = model.groups
      .flatMap((group) => group.municipalities)
      .find((row) => row.code === SUWON);
    expect(suwon?.isCityUnion).toBe(true);
    // The contract row for 수원시 carries NO direct_region_code; it matched purely
    // through the component set, and the throughput rolled up from the same two.
    expect(suwon?.contract?.totalPaymentKrw).toBe("99000000000.00");
    expect(suwon?.throughputTons).toBe("7000.000000");
    expect(model.unmatched.contractRows).toEqual([]);
    expect(model.unmatched.facilityRegions).toEqual([]);
  });

  it("keeps an unavailable contract payment null — never zero", () => {
    const model = buildCapitalRegionWaste(envelopes());
    const ongjin = model.groups
      .flatMap((group) => group.municipalities)
      .find((row) => row.code === ONGJIN);
    expect(ongjin?.contract?.status).toBe("UNAVAILABLE");
    expect(ongjin?.contract?.totalPaymentKrw).toBeNull();
    expect(ongjin?.contract?.perCapitaKrw).toBeNull();
    // The served reason travels with the absence so the UI never invents one.
    expect(ongjin?.contract?.limitation).toBe("공개된 계약 자료를 찾지 못했습니다.");
  });

  it("never rolls contract payments up to a metropolitan total", () => {
    const model = buildCapitalRegionWaste(envelopes());
    const incheon = model.groups.find((group) => group.scope === "23");
    // A COUNT, not a sum: 1 municipality in scope, 0 of them with an amount.
    expect(incheon?.contractCoverage).toEqual({ withAmount: 0, total: 1 });
    // And the group carries no payment field at all, so no call site can print one.
    expect(incheon).not.toHaveProperty("totalPaymentKrw");
  });

  it("scopes to one metropolitan through the crosswalked code", () => {
    const incheonOnly = buildCapitalRegionWaste({
      ...envelopes(),
      scope: scopeOfLandfillOrigin("28"),
    });
    expect(incheonOnly.groups).toHaveLength(1);
    expect(incheonOnly.groups[0].scope).toBe("23");
    expect(incheonOnly.generation.tons).toBe("7500.750000");
    expect(incheonOnly.generation.expectedRegionCount).toBe(1);
  });

  it("builds without the contract dataset rather than blanking the other columns", () => {
    // The two datasets are fetched independently and fail independently; a municipal
    // request that has not landed must not take the generation column with it.
    const model = buildCapitalRegionWaste({ ...envelopes(), municipalCost: null });
    expect(model.generation.tons).toBe("401222.050001");
    const rows = model.groups.flatMap((group) => group.municipalities);
    expect(rows.every((row) => row.contract === null)).toBe(true);
    expect(model.groups.every((group) => group.contractCoverage === null)).toBe(true);
  });

  it("returns absence, not zeros, when no series have arrived", () => {
    const model = buildCapitalRegionWaste({
      reportingStats: null,
      reportingPerCapita: null,
      facilityBurden: null,
      municipalCost: null,
    });
    expect(model.generation.tons).toBeNull();
    expect(model.throughput.tons).toBeNull();
    expect(model.groups).toEqual([]);
  });

  it("computes per-resident values only where a complete denominator exists", () => {
    const model = buildCapitalRegionWaste(envelopes());
    const seoul = model.groups.find((group) => group.scope === "11");
    // 93721.300001 t × 1000 ÷ 144,486 residents
    expect(seoul?.generationPerCapitaKg).toBeCloseTo(648.66, 1);

    // Drop one municipality's population: the group total must go absent rather
    // than divide by a partial denominator, which would silently inflate the value.
    const base = envelopes();
    const model2 = buildCapitalRegionWaste({
      ...base,
      reportingPerCapita: {
        ...base.reportingPerCapita,
        items: base.reportingPerCapita.items.filter((i) => i.reporting_region_code !== SUWON),
      },
    });
    const gyeonggi = model2.groups.find((group) => group.scope === "31");
    expect(gyeonggi?.population).toBeNull();
    expect(gyeonggi?.generationPerCapitaKg).toBeNull();
    // The tonnage itself is still known and is still shown.
    expect(gyeonggi?.generationTons).toBe("300000.000000");
  });
});

// --------------------------------------------------------------------------- //
// Presentation helpers
// --------------------------------------------------------------------------- //

describe("coverageSentence", () => {
  it("states what was counted and what was left out", () => {
    const model = buildCapitalRegionWaste(envelopes());
    const sentence = coverageSentence(model.generation, "시·군·구");
    expect(sentence).toContain("시·군·구 3곳");
    expect(sentence).toContain("공식 보고값 합계");
    expect(sentence).toContain("0으로 채우지 않았습니다");
  });

  it("names the excluded facility count on the throughput total", () => {
    const model = buildCapitalRegionWaste(envelopes());
    expect(coverageSentence(model.throughput, "시·군·구")).toContain("시설 99곳");
  });
});

describe("formatPerCapitaKg", () => {
  it("is null for an absent value, so a caller cannot print 0.0", () => {
    expect(formatPerCapitaKg(null)).toBeNull();
    expect(formatPerCapitaKg(Number.NaN)).toBeNull();
    expect(formatPerCapitaKg(1497.53)).toBe("1,497.5");
  });
});

// --------------------------------------------------------------------------- //
// 주민 1인당 폐기물 관리비용
// --------------------------------------------------------------------------- //

describe("managementCostPerCapita", () => {
  const METRO_FEE = "4045.92";

  it("adds the two served per-resident figures on the exact decimal strings", () => {
    const model = buildCapitalRegionWaste({ ...envelopes(), metroLandfillFeePerCapitaKrw: METRO_FEE });
    const jongno = model.groups
      .flatMap((group) => group.municipalities)
      .find((row) => row.name === "종로구");
    expect(jongno?.managementCost.collectionTransportPerCapitaKrw).toBe("85445.1200");
    expect(jongno?.managementCost.metroLandfillFeePerCapitaKrw).toBe(METRO_FEE);
    // 85445.1200 + 4045.92 — exact, at the wider of the two scales. `Number()` would
    // land on 89491.03999999999 here.
    expect(jongno?.managementCost.totalPerCapitaKrw).toBe("89491.0400");
  });

  it("propagates a missing payment as null rather than treating it as 0", () => {
    const model = buildCapitalRegionWaste({ ...envelopes(), metroLandfillFeePerCapitaKrw: METRO_FEE });
    const ongjin = model.groups
      .flatMap((group) => group.municipalities)
      .find((row) => row.name === "옹진군");
    expect(ongjin?.managementCost.collectionTransportPerCapitaKrw).toBeNull();
    // NOT the landfill term alone, and emphatically not 0 + 4045.92.
    expect(ongjin?.managementCost.totalPerCapitaKrw).toBeNull();
  });

  it("propagates an absent metropolitan fee as null on every row", () => {
    const model = buildCapitalRegionWaste({ ...envelopes(), metroLandfillFeePerCapitaKrw: null });
    for (const row of model.groups.flatMap((group) => group.municipalities)) {
      expect(row.managementCost.metroLandfillFeePerCapitaKrw).toBeNull();
      expect(row.managementCost.totalPerCapitaKrw).toBeNull();
    }
  });

  it("applies ONE common metropolitan fee to every municipality, never apportioned", () => {
    const model = buildCapitalRegionWaste({ ...envelopes(), metroLandfillFeePerCapitaKrw: METRO_FEE });
    const rows = model.groups.flatMap((group) => group.municipalities);
    expect(rows.length).toBeGreaterThan(1);
    // Identical string on every row — across all three 시·도. A per-municipality
    // landfill share does not exist in any source and must never be invented.
    expect(new Set(rows.map((row) => row.managementCost.metroLandfillFeePerCapitaKrw))).toEqual(
      new Set([METRO_FEE]),
    );
  });

  it("does not change the common fee when the view is scoped to one 시·도", () => {
    const all = buildCapitalRegionWaste({ ...envelopes(), metroLandfillFeePerCapitaKrw: METRO_FEE });
    const seoulOnly = buildCapitalRegionWaste({
      ...envelopes(),
      scope: "11",
      metroLandfillFeePerCapitaKrw: METRO_FEE,
    });
    const feeOf = (model: ReturnType<typeof buildCapitalRegionWaste>) =>
      model.groups.flatMap((g) => g.municipalities).find((r) => r.name === "종로구")
        ?.managementCost;
    // Scoping the DISPLAY must not re-scope a value labelled 수도권 공통. The scoped
    // landfill summary would have served Seoul's own figure here.
    expect(feeOf(seoulOnly)?.metroLandfillFeePerCapitaKrw).toBe(
      feeOf(all)?.metroLandfillFeePerCapitaKrw,
    );
    expect(feeOf(seoulOnly)?.totalPerCapitaKrw).toBe(feeOf(all)?.totalPerCapitaKrw);
  });
});
