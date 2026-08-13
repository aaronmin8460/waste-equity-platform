/**
 * ① 분석 범위 — the scope model and the citizen-facing region registry.
 *
 * These are the invariants that make a scoped ranking trustworthy. Each one exists
 * because breaking it produces a WRONG ANSWER THAT LOOKS RIGHT: a plausible list of
 * candidates over a population nobody asked for.
 *
 *   - `sido` and `sigungu` are never sent together (independent boundary layers);
 *   - a citizen-facing city expands into EVERY stored code it is split into;
 *   - the codes are SGIS (11/23/31), never the landfill/MOIS space (11/28/41);
 *   - an emptied selection widens to 수도권 전체, it never means "match none".
 *
 * The region fixtures below are real SGIS codes and names, because the parsing rule
 * under test is a fact about that registry's shape, not an invented convention.
 */

import { describe, expect, it } from "vitest";

import type { RegionBoundaryProperties } from "./api";
import {
  SCOPE_ALL,
  buildScopeRegionOptions,
  canonicalRegionCode,
  filterScopeOptions,
  indexOptionsByCode,
  isCandidateInScope,
  isCompositeOption,
  isOptionSelected,
  isSuitabilitySidoCode,
  scopeKey,
  scopeLabel,
  scopeToQuery,
  scopesEqual,
  selectedOptions,
  sigunguScope,
  withOptionCleared,
  withOptionSelected,
} from "./suitabilityScope";

function region(code: string, name: string, parent: string): { properties: RegionBoundaryProperties } {
  return {
    properties: {
      region_code: code,
      region_name: name,
      region_level: "SIGUNGU",
      parent_region_code: parent,
      source_id: "sgis",
      boundary_reference_period: "2024",
    } as RegionBoundaryProperties,
  };
}

/** A slice of the served registry covering every shape the parser must handle. */
const REGIONS = [
  region("KR-SGIS-11010", "서울특별시 종로구", "KR-SGIS-11"),
  region("KR-SGIS-11020", "서울특별시 중구", "KR-SGIS-11"),
  region("KR-SGIS-23010", "인천광역시 중구", "KR-SGIS-23"),
  region("KR-SGIS-23060", "인천광역시 부평구", "KR-SGIS-23"),
  region("KR-SGIS-23510", "인천광역시 강화군", "KR-SGIS-23"),
  // The multi-code case: one citizen-facing city, two stored 일반구.
  region("KR-SGIS-31091", "경기도 안산시 상록구", "KR-SGIS-31"),
  region("KR-SGIS-31092", "경기도 안산시 단원구", "KR-SGIS-31"),
  // Three codes.
  region("KR-SGIS-31101", "경기도 고양시 덕양구", "KR-SGIS-31"),
  region("KR-SGIS-31103", "경기도 고양시 일산동구", "KR-SGIS-31"),
  region("KR-SGIS-31104", "경기도 고양시 일산서구", "KR-SGIS-31"),
  // A single-code Gyeonggi city.
  region("KR-SGIS-31150", "경기도 시흥시", "KR-SGIS-31"),
];

const OPTIONS = buildScopeRegionOptions(REGIONS);
const ansan = () => OPTIONS.find((o) => o.label === "경기 안산시")!;
const goyang = () => OPTIONS.find((o) => o.label === "경기 고양시")!;
const siheung = () => OPTIONS.find((o) => o.label === "경기 시흥시")!;

describe("region code space", () => {
  it("recognises exactly the three capital-region SGIS sido codes", () => {
    expect(isSuitabilitySidoCode("KR-SGIS-11")).toBe(true);
    expect(isSuitabilitySidoCode("KR-SGIS-23")).toBe(true);
    expect(isSuitabilitySidoCode("KR-SGIS-31")).toBe(true);
    // The landfill / MOIS administrative space is a DIFFERENT set: 28 is Incheon
    // and 41 is Gyeonggi there. Neither is a suitability sido code.
    expect(isSuitabilitySidoCode("KR-SGIS-28")).toBe(false);
    expect(isSuitabilitySidoCode("KR-SGIS-41")).toBe(false);
    expect(isSuitabilitySidoCode("11")).toBe(false);
  });

  it("canonicalises a bare numeric code and leaves anything else untouched", () => {
    expect(canonicalRegionCode("31091")).toBe("KR-SGIS-31091");
    expect(canonicalRegionCode("KR-SGIS-31091")).toBe("KR-SGIS-31091");
    // An unrecognised value STAYS unrecognised rather than being coerced into
    // something plausible — it must match nothing, not a different region.
    expect(canonicalRegionCode("KR-RCISRG-0001")).toBe("KR-RCISRG-0001");
    expect(canonicalRegionCode("  ")).toBe("");
  });
});

describe("the scope is a sum type, so sido + sigungu is unrepresentable", () => {
  it("serialises 수도권 전체 as NO region parameter at all", () => {
    // Not "all", not an empty sigungu list — the absence of a restriction.
    expect(scopeToQuery(SCOPE_ALL)).toEqual({});
  });

  it("serialises a 시·도 scope as sido alone, in canonical form", () => {
    expect(scopeToQuery({ kind: "sido", sido: "KR-SGIS-11" })).toEqual({ sido: "KR-SGIS-11" });
    expect(scopeToQuery({ kind: "sido", sido: "KR-SGIS-23" })).toEqual({ sido: "KR-SGIS-23" });
    expect(scopeToQuery({ kind: "sido", sido: "KR-SGIS-31" })).toEqual({ sido: "KR-SGIS-31" });
  });

  it("serialises a 시·군·구 scope as sigungu alone", () => {
    const query = scopeToQuery(sigunguScope(["KR-SGIS-31091", "KR-SGIS-31092"]));
    expect(query.sigungu).toEqual(["KR-SGIS-31091", "KR-SGIS-31092"]);
    expect(query.sido).toBeUndefined();
  });

  it("NEVER produces both keys, for any scope", () => {
    const scopes = [
      SCOPE_ALL,
      { kind: "sido" as const, sido: "KR-SGIS-31" as const },
      sigunguScope(["KR-SGIS-31150"]),
      sigunguScope(["KR-SGIS-11010", "KR-SGIS-23510"]),
    ];
    for (const scope of scopes) {
      const query = scopeToQuery(scope);
      const hasSido = query.sido !== undefined;
      const hasSigungu = (query.sigungu?.length ?? 0) > 0;
      expect(hasSido && hasSigungu, `${scopeKey(scope)} sent both`).toBe(false);
    }
  });

  it("de-duplicates and normalises mixed spellings of one region", () => {
    const scope = sigunguScope(["31091", "KR-SGIS-31091", "KR-SGIS-31091"]);
    expect(scopeToQuery(scope).sigungu).toEqual(["KR-SGIS-31091"]);
  });

  it("treats an emptied selection as 수도권 전체, never as 'match none'", () => {
    expect(sigunguScope([])).toEqual(SCOPE_ALL);
    expect(sigunguScope(["", "  "])).toEqual(SCOPE_ALL);
    // Clearing the last chip widens the scope rather than blanking the ranking.
    expect(withOptionCleared(sigunguScope(siheung().codes), siheung())).toEqual(SCOPE_ALL);
  });

  it("gives equal scopes an equal key regardless of input order", () => {
    expect(
      scopesEqual(
        sigunguScope(["KR-SGIS-31092", "KR-SGIS-31091"]),
        sigunguScope(["KR-SGIS-31091", "KR-SGIS-31092"]),
      ),
    ).toBe(true);
  });
});

describe("selecting a 시·도 clears 시·군·구, and vice versa", () => {
  it("replaces a 시·군·구 selection when a 시·도 is chosen", () => {
    const withCities = withOptionSelected(SCOPE_ALL, ansan());
    expect(withCities.kind).toBe("sigungu");
    // The pill hands back a whole new scope value; there is no path that keeps the
    // old codes alongside it.
    const sido = { kind: "sido" as const, sido: "KR-SGIS-31" as const };
    expect(scopeToQuery(sido).sigungu).toBeUndefined();
  });

  it("replaces a 시·도 scope when a city is chosen", () => {
    const fromSido = withOptionSelected({ kind: "sido", sido: "KR-SGIS-31" }, siheung());
    expect(fromSido).toEqual(sigunguScope(siheung().codes));
    expect(scopeToQuery(fromSido).sido).toBeUndefined();
  });

  it("clearing a city off a 시·도 scope is a no-op (there is nothing to clear)", () => {
    const sido = { kind: "sido" as const, sido: "KR-SGIS-11" as const };
    expect(withOptionCleared(sido, ansan())).toEqual(sido);
  });
});

describe("one citizen-facing city can be several stored codes", () => {
  it("expands 안산시 into BOTH of its 일반구", () => {
    expect(ansan().codes).toEqual(["KR-SGIS-31091", "KR-SGIS-31092"]);
    expect(ansan().districtNames).toEqual(["단원구", "상록구"]);
    expect(isCompositeOption(ansan())).toBe(true);
  });

  it("expands 고양시 into all three", () => {
    expect(goyang().codes).toEqual(["KR-SGIS-31101", "KR-SGIS-31103", "KR-SGIS-31104"]);
  });

  it("keeps a single-code city single", () => {
    expect(siheung().codes).toEqual(["KR-SGIS-31150"]);
    expect(isCompositeOption(siheung())).toBe(false);
  });

  it("sends every constituent code when the city is picked", () => {
    const query = scopeToQuery(withOptionSelected(SCOPE_ALL, ansan()));
    expect(query.sigungu).toEqual(["KR-SGIS-31091", "KR-SGIS-31092"]);
  });

  it("counts a city as selected only when ALL of its codes are", () => {
    const partial = sigunguScope(["KR-SGIS-31091"]);
    // A half-selected 안산시 must not render as a chip claiming the whole city.
    expect(isOptionSelected(partial, ansan())).toBe(false);
    expect(selectedOptions(partial, OPTIONS).selected).toEqual([]);
    expect(selectedOptions(partial, OPTIONS).unknownCodes).toEqual(["KR-SGIS-31091"]);
    const full = sigunguScope(ansan().codes);
    expect(isOptionSelected(full, ansan())).toBe(true);
    expect(selectedOptions(full, OPTIONS).selected.map((o) => o.label)).toEqual(["경기 안산시"]);
  });

  it("derives the relationship from the REGISTRY, not a hardcoded list", () => {
    // A registry that splits a different city produces a different expansion with
    // no code change — proving nothing is baked in.
    const invented = buildScopeRegionOptions([
      region("KR-SGIS-31241", "경기도 화성시 동부구", "KR-SGIS-31"),
      region("KR-SGIS-31242", "경기도 화성시 서부구", "KR-SGIS-31"),
    ]);
    expect(invented).toHaveLength(1);
    expect(invented[0].label).toBe("경기 화성시");
    expect(invented[0].codes).toEqual(["KR-SGIS-31241", "KR-SGIS-31242"]);
  });
});

describe("duplicate display names stay distinguishable", () => {
  it("keeps 서울 중구 and 인천 중구 as two options with a metropolitan prefix", () => {
    const jung = OPTIONS.filter((o) => o.label.endsWith("중구"));
    expect(jung.map((o) => o.label).sort()).toEqual(["서울 중구", "인천 중구"]);
    expect(jung.find((o) => o.label === "서울 중구")!.codes).toEqual(["KR-SGIS-11020"]);
    expect(jung.find((o) => o.label === "인천 중구")!.codes).toEqual(["KR-SGIS-23010"]);
  });

  it("orders 서울 → 인천 → 경기", () => {
    const sidos = OPTIONS.map((o) => o.sido);
    expect(sidos).toEqual([...sidos].sort((a, b) => {
      const rank = { "KR-SGIS-11": 0, "KR-SGIS-23": 1, "KR-SGIS-31": 2 } as const;
      return rank[a] - rank[b];
    }));
  });

  it("indexes every constituent code back to its city", () => {
    const index = indexOptionsByCode(OPTIONS);
    expect(index.get("KR-SGIS-31092")!.label).toBe("경기 안산시");
    expect(index.get("KR-SGIS-31104")!.label).toBe("경기 고양시");
  });

  it("searches the visible name and the 일반구 names", () => {
    expect(filterScopeOptions(OPTIONS, "안산").map((o) => o.label)).toEqual(["경기 안산시"]);
    // 상록구 is not the option's own label, but it IS what the city expands into.
    expect(filterScopeOptions(OPTIONS, "상록").map((o) => o.label)).toEqual(["경기 안산시"]);
    expect(filterScopeOptions(OPTIONS, "")).toHaveLength(OPTIONS.length);
    expect(filterScopeOptions(OPTIONS, "없는지역")).toEqual([]);
  });
});

describe("scope membership uses the attribute the request filtered on", () => {
  const boundaryCell = {
    // A real shape from run 47: 137 cells carry a SIDO/SIGUNGU pair whose prefixes
    // disagree, because the two codes come from independent ST_Covers lookups.
    sido_region_code: "KR-SGIS-11",
    sigungu_region_code: "KR-SGIS-31150",
  };

  it("judges a 시·도 scope by sido_region_code alone", () => {
    expect(isCandidateInScope({ kind: "sido", sido: "KR-SGIS-11" }, boundaryCell)).toBe(true);
    expect(isCandidateInScope({ kind: "sido", sido: "KR-SGIS-31" }, boundaryCell)).toBe(false);
  });

  it("judges a 시·군·구 scope by sigungu_region_code alone", () => {
    expect(isCandidateInScope(sigunguScope(["KR-SGIS-31150"]), boundaryCell)).toBe(true);
    expect(isCandidateInScope(sigunguScope(["KR-SGIS-11010"]), boundaryCell)).toBe(false);
  });

  it("never places a NULL-sigungu cell in a 시·군·구 scope", () => {
    // 553 cells in run 47 have no SIGUNGU at all; they can never satisfy the filter.
    const noSigungu = { sido_region_code: "KR-SGIS-31", sigungu_region_code: null };
    expect(isCandidateInScope(sigunguScope(["KR-SGIS-31150"]), noSigungu)).toBe(false);
    expect(isCandidateInScope({ kind: "sido", sido: "KR-SGIS-31" }, noSigungu)).toBe(true);
  });

  it("places everything in 수도권 전체", () => {
    expect(isCandidateInScope(SCOPE_ALL, boundaryCell)).toBe(true);
    expect(isCandidateInScope(SCOPE_ALL, { sigungu_region_code: null })).toBe(true);
  });
});

describe("scope labels", () => {
  it("names the four top-level scopes", () => {
    expect(scopeLabel(SCOPE_ALL, OPTIONS)).toBe("수도권 전체");
    expect(scopeLabel({ kind: "sido", sido: "KR-SGIS-11" }, OPTIONS)).toBe("서울");
    expect(scopeLabel({ kind: "sido", sido: "KR-SGIS-23" }, OPTIONS)).toBe("인천");
    expect(scopeLabel({ kind: "sido", sido: "KR-SGIS-31" }, OPTIONS)).toBe("경기");
  });

  it("names a small multi-select and summarises a large one", () => {
    expect(scopeLabel(sigunguScope(ansan().codes), OPTIONS)).toBe("경기 안산시");
    // Chips read in REGISTRY order (시·도, then Korean collation), not in the order
    // the reader happened to click — so the same selection always reads the same.
    expect(scopeLabel(sigunguScope([...ansan().codes, ...siheung().codes]), OPTIONS)).toBe(
      "경기 시흥시 · 경기 안산시",
    );
    expect(
      scopeLabel(sigunguScope([...ansan().codes, ...goyang().codes, ...siheung().codes]), OPTIONS),
    ).toBe("경기 고양시 외 2곳");
  });
});
