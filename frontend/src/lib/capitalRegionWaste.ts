/**
 * The capital region's waste picture at TWO grains, assembled from the official
 * series this platform already serves.
 *
 * ── Why this module exists ────────────────────────────────────────────────────
 * Page 2 has to answer two questions the served endpoints do not answer directly:
 *
 *   1. "총 폐기물 발생량 / 총 시설 처리량" — headline totals for the capital region.
 *      No publisher issues a single capital-region total for either. Both ARE
 *      published as complete per-municipality official series, so the total is
 *      built here as a DETERMINISTIC SUM of those official rows and is labelled a
 *      계산값 with its coverage stated. It is never presented as a reported figure.
 *
 *   2. "지역별 상세 현황" below 서울/인천/경기 — the Figma design says clicking a
 *      metropolitan row reveals 시/군/구 detail. The municipal grain exists in the
 *      data (66 units), it is simply spread across four endpoints keyed three
 *      different ways. This module performs that join ONCE, on canonical region
 *      codes, so no call site has to re-derive it.
 *
 * ── The four inputs and how they key ──────────────────────────────────────────
 *   waste-reporting/statistics   66 reporting regions × up to 4 streams, 톤/년
 *                                59 NATIVE_SGIS (KR-SGIS-…) + 7 DERIVED_CITY_UNION
 *                                (KR-RCISRG-…, the Gyeonggi cities RCIS reports at
 *                                city level). Origin-based generation.
 *   waste-reporting/per-capita   the SAME 66 regions; used ONLY for its `population`
 *                                (SGIS annual), which is identical across streams.
 *   equity/facility-burden       79 SGIS SIGUNGU rows. The extra 20 are the 일반구
 *                                that compose those 7 cities, so they are rolled up
 *                                via the reporting region's `child_region_codes`.
 *                                Facility-location-based throughput.
 *   landfill/municipal-costs     the same 66 units, keyed by `direct_region_code`
 *                                for 59 of them and by `population_components[]`
 *                                (the 일반구 set) for the 7 composite cities, which
 *                                carry no city polygon and therefore no direct code.
 *
 * All four agree exactly: 0 unmatched records in either direction (the audit is in
 * the lane log). Anything that does NOT match is reported in `unmatched` rather
 * than dropped in silence.
 *
 * ── What this module refuses to do ────────────────────────────────────────────
 *   - It never adds generation to throughput, divides one by the other, or derives
 *     a "처리율". They are ORIGIN_BASED_TREATMENT_OUTCOME and
 *     FACILITY_LOCATION_BASED_THROUGHPUT respectively, and the facility-burden
 *     envelope states in its own `assumptions` that the two may not be combined.
 *   - It never adds the municipal collection/transport contract payment to the
 *     official landfill inbound fee, and never rolls the payment up to a
 *     metropolitan total: only 46 of 66 municipalities have a payment, so a
 *     metropolitan "total" would be a partial sum wearing a complete label. The
 *     metropolitan row carries a COVERAGE COUNT instead.
 *   - It never substitutes 0 for an absent value. A missing stream, a missing
 *     population, and a missing payment each produce `null` plus the served reason.
 *
 * Sums are exact: {@link sumExactDecimals} adds the served decimal STRINGS through
 * BigInt at a common scale, so a total never inherits binary floating-point drift
 * from the values it is made of. Division (per-capita) is the only place a Number
 * appears, and its result is explicitly a 계산값.
 */

import type {
  FacilityBurdenEnvelope,
  FacilityBurdenItem,
  LandfillOrigin,
  MunicipalCostResponse,
  MunicipalCostRow,
  MunicipalCostStatus,
  ReportingPerCapitaEnvelope,
  ReportingWasteStatisticsEnvelope,
  ReportingWasteStatisticsItem,
} from "./api";
import { regionScope, SCOPE_LABELS, type RegionScope } from "./ranking";

// --------------------------------------------------------------------------- //
// Exact decimal arithmetic
// --------------------------------------------------------------------------- //

/**
 * Sum exact decimal strings without going through `Number`.
 *
 * The served quantities are `Numeric(20, 6)` decimals rendered as strings. Adding
 * 262 of them as doubles is enough to move the last digits of a 59-million-tonne
 * total, and this platform publishes the total as a figure derived from official
 * values — so the derivation has to be exact, not approximately exact.
 *
 * Returns `null` when the list is empty (there is nothing to assert) or when any
 * entry is not a plain decimal. A malformed entry is NEVER skipped silently: a sum
 * over an unreadable set would understate the total while looking complete.
 */
export function sumExactDecimals(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  // `BigInt(0)` rather than the `0n` literal: this package targets ES2017, where
  // BigInt literal SYNTAX is rejected by the compiler even though the runtime type
  // is available through the `esnext` lib. The constructor form is equivalent and
  // does not require moving a shared compiler target for one module.
  const ZERO = BigInt(0);
  const ONE = BigInt(1);
  const MINUS_ONE = BigInt(-1);
  let scale = 0;
  const parsed: { sign: bigint; digits: string; fraction: string }[] = [];
  for (const raw of values) {
    const match = /^\s*(-?)(\d+)(?:\.(\d*))?\s*$/.exec(raw);
    if (!match) return null;
    const [, sign, digits, fraction = ""] = match;
    scale = Math.max(scale, fraction.length);
    parsed.push({ sign: sign === "-" ? MINUS_ONE : ONE, digits, fraction });
  }
  let total = ZERO;
  for (const { sign, digits, fraction } of parsed) {
    total += sign * BigInt(digits + fraction.padEnd(scale, "0"));
  }
  return formatScaled(total, scale);
}

/** Render a BigInt scaled by `scale` decimal places back to a decimal string. */
function formatScaled(total: bigint, scale: number): string {
  const negative = total < BigInt(0);
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const integerPart = digits.slice(0, digits.length - scale);
  const fractionPart = scale > 0 ? digits.slice(digits.length - scale) : "";
  const sign = negative ? "-" : "";
  return fractionPart ? `${sign}${integerPart}.${fractionPart}` : `${sign}${integerPart}`;
}

/**
 * tonnes → kg per resident, or `null`.
 *
 * The SAME formula the two served per-capita endpoints publish in their own
 * `derivation_formula` (`quantity[톤/년] × 1000 ÷ population[persons]`), so a
 * value computed here for a metropolitan group is the same quantity the backend
 * computes for a single region — not a second, differently-defined indicator.
 *
 * `null` for a missing or zero denominator: a region with no population is not a
 * region with an infinite or zero per-resident value.
 */
export function perCapitaKgPerYear(tons: string | null, population: number | null): number | null {
  if (tons == null || population == null || population <= 0) return null;
  const value = Number(tons);
  if (!Number.isFinite(value)) return null;
  return (value * 1000) / population;
}

// --------------------------------------------------------------------------- //
// Scope vocabulary
// --------------------------------------------------------------------------- //

/**
 * The landfill 출발 지역 filter speaks ADMINISTRATIVE sido codes (11 서울 / 28 인천 /
 * 41 경기); every analytical region code on this platform speaks SGIS (11 / 23 /
 * 31). They agree only for Seoul.
 *
 * This is the one crosswalk between them on Page 2. Joining on the raw digits
 * instead — which reads plausible, because two of the three look like codes of the
 * same kind — silently yields an empty 인천 and an empty 경기.
 */
export function scopeOfLandfillOrigin(origin: LandfillOrigin | null): RegionScope | null {
  switch (origin) {
    case "11":
      return "11";
    case "28":
      return "23";
    case "41":
      return "31";
    default:
      return null;
  }
}

/** The reverse crosswalk, so a metropolitan group can name its landfill origin row. */
export const LANDFILL_ORIGIN_OF_SCOPE: Record<RegionScope, LandfillOrigin> = {
  "11": "11",
  "23": "28",
  "31": "41",
};

/**
 * The tier of 기초자치단체 each metropolitan is actually made of.
 *
 * NOT interchangeable: 서울 has 자치구, 인천 has 군·구, 경기 has 시·군. Calling all 66
 * rows 시·군·구 is only correct in aggregate; labelling one 인천 군 a 자치구 is a
 * factual error about Korean local government. Same vocabulary as the backend's
 * served `geography_policy` sentence and as `lib/municipalCost.ts`.
 */
export const MUNICIPAL_TIER_LABELS: Record<RegionScope, string> = {
  "11": "자치구",
  "23": "군·구",
  "31": "시·군",
};

/** Reading order of the three metropolitan groups. */
export const SCOPE_ORDER: readonly RegionScope[] = ["11", "23", "31"];

// --------------------------------------------------------------------------- //
// Model
// --------------------------------------------------------------------------- //

/** A stream this region's source did not report. Never counted as zero. */
export interface MissingStream {
  stream: string;
  reason: string;
}

/** The municipal contract-payment facts for one municipality — a SEPARATE dataset. */
export interface MunicipalContractPayment {
  status: MunicipalCostStatus;
  /** Exact served amount in KRW, or null. `null` is NOT 0. */
  totalPaymentKrw: string | null;
  /** Exact served per-resident amount in KRW, or null. */
  perCapitaKrw: string | null;
  contractCount: number;
  /** The backend's own plain-Korean sentence for the determining reason, if any. */
  limitation: string | null;
  referenceYear: number;
}

export interface MunicipalityRow {
  /** The reporting-geography code — the row's stable identity. */
  code: string;
  /** Short name as a citizen reads it in a metropolitan's list (종로구, 수원시). */
  name: string;
  /** The full served name (서울특별시 종로구), for captions and screen readers. */
  fullName: string;
  scope: RegionScope;
  /** 자치구 / 군·구 / 시·군 — this municipality's real tier. */
  tierLabel: string;
  /** True for the seven Gyeonggi cities RCIS reports at city level. */
  isCityUnion: boolean;
  population: number | null;
  /** Exact sum of the served official generation across the streams present. */
  generationTons: string | null;
  generationStreamCount: number;
  /** Streams the source did not report for this region. Never zero-filled. */
  missingStreams: MissingStream[];
  generationPerCapitaKg: number | null;
  /** Exact sum of facility-location throughput (rolled up for a city union). */
  throughputTons: string | null;
  throughputFacilityCount: number;
  /** True when a counted facility had no throughput figure — the sum understates. */
  throughputIsPartial: boolean;
  throughputPerCapitaKg: number | null;
  /** The 2024 contract payment, or `null` when the dataset served no row for it. */
  contract: MunicipalContractPayment | null;
}

export interface MetropolitanGroup {
  scope: RegionScope;
  /** 서울 / 인천 / 경기 — the same short labels the rest of the app uses. */
  label: string;
  /** The landfill 출발 지역 code for this metropolitan (11 / 28 / 41). */
  landfillOrigin: LandfillOrigin;
  tierLabel: string;
  population: number | null;
  generationTons: string | null;
  generationPerCapitaKg: number | null;
  throughputTons: string | null;
  throughputFacilityCount: number;
  throughputIsPartial: boolean;
  throughputPerCapitaKg: number | null;
  municipalities: MunicipalityRow[];
  /**
   * How many of this metropolitan's municipalities have a contract-payment amount.
   *
   * A COUNT, deliberately not a sum. 20 of the 66 municipalities published no
   * payment at all, so a metropolitan "total" would be a partial sum presented as a
   * complete one — the exact misreading the whole dataset is fenced against.
   */
  contractCoverage: { withAmount: number; total: number } | null;
}

/** A capital-region total built from official rows, with its coverage attached. */
export interface DerivedTotal {
  /** Exact sum of the served values, or `null` when nothing could be summed. */
  tons: string | null;
  /** The unit the source publishes, carried through verbatim. */
  unit: string;
  /** The reference year of the underlying official rows. */
  referenceYear: number | null;
  /** Municipalities that contributed at least one value. */
  regionCount: number;
  /** Municipalities expected in scope. Equal to `regionCount` when complete. */
  expectedRegionCount: number;
  /** The accounting basis, so it can never be read against the other total. */
  accountingBasis: string | null;
  /** Region×stream cells the source did not report. Never zero-filled. */
  missingCells: MissingStream[];
  /**
   * Officially known facilities that belong to NO region and are therefore in no
   * regional row and in no total. A disclosed under-count, not an estimate.
   */
  unassignedFacilityCount: number;
}

export interface CapitalRegionWaste {
  /** The scope this build is limited to, or `null` for the whole capital region. */
  scope: RegionScope | null;
  generation: DerivedTotal;
  throughput: DerivedTotal;
  groups: MetropolitanGroup[];
  /** Records that could not be joined. Empty on the released data; never hidden. */
  unmatched: {
    /** Contract-payment rows with no matching reporting region. */
    contractRows: string[];
    /** Facility-burden rows outside the reporting universe. */
    facilityRegions: string[];
  };
}

export interface CapitalRegionWasteInput {
  reportingStats: ReportingWasteStatisticsEnvelope | null;
  reportingPerCapita: ReportingPerCapitaEnvelope | null;
  facilityBurden: FacilityBurdenEnvelope | null;
  municipalCost: MunicipalCostResponse | null;
  /** Limit to one metropolitan, mirroring the landfill 출발 지역 filter. */
  scope?: RegionScope | null;
}

// --------------------------------------------------------------------------- //
// Build
// --------------------------------------------------------------------------- //

/**
 * A municipality's short name.
 *
 * The reporting endpoints serve `서울특별시 종로구` / `경기도 수원시`. Inside a
 * metropolitan's own expanded list the metropolitan prefix is noise, so the last
 * whitespace-separated token is used — with the FULL name kept alongside for the
 * accessible caption. The prefix is only ever dropped, never rewritten, so an
 * unexpected shape degrades to the served string rather than a mangled one.
 */
function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : fullName;
}

/**
 * NFC-normalize a key before comparing it.
 *
 * macOS hands Korean text back in NFD, and the contract-payment keys travel
 * through the filesystem. An unnormalized comparison fails to match every Korean
 * key — which would blank the whole municipal column rather than one row of it.
 */
function nfc(value: string): string {
  return value.normalize("NFC");
}

/**
 * Join the four envelopes into the two-level capital-region model.
 *
 * Pure: it reads only the envelopes handed to it and issues no request. A `null`
 * envelope simply removes what it contributes — the model still builds, so a slow
 * or failed municipal-cost request never blanks the generation and throughput
 * columns (and vice versa).
 */
export function buildCapitalRegionWaste({
  reportingStats,
  reportingPerCapita,
  facilityBurden,
  municipalCost,
  scope = null,
}: CapitalRegionWasteInput): CapitalRegionWaste {
  // ── population, from the per-capita envelope's own denominator ─────────────
  // Identical across all four streams of a region, and identical to the
  // facility-burden population for every native region, so one lookup is safe.
  const populationByCode = new Map<string, number>();
  for (const item of reportingPerCapita?.items ?? []) {
    populationByCode.set(nfc(item.reporting_region_code), item.population);
  }

  // ── generation, per reporting region ───────────────────────────────────────
  const generationByCode = new Map<string, ReportingWasteStatisticsItem[]>();
  const regionNames = new Map<string, string>();
  const childCodesByRegion = new Map<string, string[]>();
  for (const item of reportingStats?.items ?? []) {
    const code = nfc(item.reporting_region_code);
    regionNames.set(code, item.reporting_region_name);
    if (item.child_region_codes?.length) {
      childCodesByRegion.set(code, item.child_region_codes.map(nfc));
    }
    const bucket = generationByCode.get(code);
    if (bucket) bucket.push(item);
    else generationByCode.set(code, [item]);
  }

  const missingStreamsByCode = new Map<string, MissingStream[]>();
  for (const gap of reportingStats?.unavailable_regions ?? []) {
    const code = nfc(gap.reporting_region_code);
    regionNames.set(code, gap.reporting_region_name);
    const bucket = missingStreamsByCode.get(code) ?? [];
    bucket.push({ stream: gap.waste_stream, reason: gap.reason });
    missingStreamsByCode.set(code, bucket);
  }

  // ── throughput, per SGIS sigungu ───────────────────────────────────────────
  const burdenByCode = new Map<string, FacilityBurdenItem>();
  for (const item of facilityBurden?.items ?? []) {
    burdenByCode.set(nfc(item.region_code), item);
  }

  // ── contract payment, keyed onto the reporting universe ────────────────────
  // 59 municipalities join on `direct_region_code`. The 7 Gyeonggi city unions
  // carry no direct code at all (they exist canonically only as 일반구), so they
  // join on the SET of their 일반구 — which is exactly the reporting region's
  // `child_region_codes`. Both keys are canonical codes; neither is a name.
  const contractByDirectCode = new Map<string, MunicipalCostRow>();
  const contractByChildKey = new Map<string, MunicipalCostRow>();
  for (const row of municipalCost?.municipalities ?? []) {
    if (row.direct_region_code) {
      contractByDirectCode.set(nfc(row.direct_region_code), row);
    } else if (row.population_components.length > 0) {
      contractByChildKey.set(childKey(row.population_components.map((c) => c.region_code)), row);
    }
  }
  const matchedContractKeys = new Set<string>();

  const municipalCostYear = municipalCost?.meta.reference_year ?? null;

  // ── assemble one row per reporting region ──────────────────────────────────
  const allCodes = new Set<string>([...generationByCode.keys(), ...missingStreamsByCode.keys()]);
  const rows: MunicipalityRow[] = [];
  for (const code of allCodes) {
    const rowScope = regionScope(code);
    if (rowScope === null) continue;
    const stats = generationByCode.get(code) ?? [];
    const children = childCodesByRegion.get(code) ?? null;
    const burdenCodes = children ?? [code];
    const burdens = burdenCodes
      .map((child) => burdenByCode.get(child))
      .filter((item): item is FacilityBurdenItem => item !== undefined);

    const population = populationByCode.get(code) ?? null;
    const generationTons = sumExactDecimals(stats.map((item) => item.generation_quantity));
    const throughputTons = sumExactDecimals(
      burdens.map((item) => item.throughput_located_tons_per_year),
    );

    const contract =
      (children ? contractByChildKey.get(childKey(children)) : contractByDirectCode.get(code)) ??
      null;
    if (contract) matchedContractKeys.add(nfc(contract.municipality_key));

    const fullName = regionNames.get(code) ?? code;
    rows.push({
      code,
      name: shortName(fullName),
      fullName,
      scope: rowScope,
      tierLabel: MUNICIPAL_TIER_LABELS[rowScope],
      isCityUnion: children !== null,
      population,
      generationTons,
      generationStreamCount: stats.length,
      missingStreams: missingStreamsByCode.get(code) ?? [],
      generationPerCapitaKg: perCapitaKgPerYear(generationTons, population),
      throughputTons,
      throughputFacilityCount: burdens.reduce((sum, item) => sum + item.facility_count_located, 0),
      throughputIsPartial: burdens.some((item) => item.located_throughput_is_partial),
      throughputPerCapitaKg: perCapitaKgPerYear(throughputTons, population),
      contract:
        contract && municipalCostYear !== null
          ? {
              status: contract.status,
              totalPaymentKrw: contract.total_eligible_payment_krw,
              perCapitaKrw: contract.payment_per_capita_krw,
              contractCount: contract.eligible_contract_count,
              limitation: contract.limitations[0] ?? null,
              referenceYear: municipalCostYear,
            }
          : null,
    });
  }

  rows.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const inScope = scope === null ? rows : rows.filter((row) => row.scope === scope);

  // ── metropolitan groups ────────────────────────────────────────────────────
  const groups: MetropolitanGroup[] = [];
  for (const groupScope of SCOPE_ORDER) {
    if (scope !== null && groupScope !== scope) continue;
    const members = inScope.filter((row) => row.scope === groupScope);
    if (members.length === 0) continue;
    const population = sumPopulation(members);
    const generationTons = sumExactDecimals(
      members.map((row) => row.generationTons).filter((v): v is string => v !== null),
    );
    const throughputTons = sumExactDecimals(
      members.map((row) => row.throughputTons).filter((v): v is string => v !== null),
    );
    const withContract = members.filter((row) => row.contract !== null);
    groups.push({
      scope: groupScope,
      label: SCOPE_LABELS[groupScope],
      landfillOrigin: LANDFILL_ORIGIN_OF_SCOPE[groupScope],
      tierLabel: MUNICIPAL_TIER_LABELS[groupScope],
      population,
      generationTons,
      generationPerCapitaKg: perCapitaKgPerYear(generationTons, population),
      throughputTons,
      throughputFacilityCount: members.reduce((sum, row) => sum + row.throughputFacilityCount, 0),
      throughputIsPartial: members.some((row) => row.throughputIsPartial),
      throughputPerCapitaKg: perCapitaKgPerYear(throughputTons, population),
      municipalities: [...members].sort((a, b) =>
        a.name.localeCompare(b.name, "ko") || (a.code < b.code ? -1 : 1),
      ),
      contractCoverage:
        withContract.length === 0
          ? null
          : {
              withAmount: withContract.filter((row) => row.contract?.totalPaymentKrw != null).length,
              total: members.length,
            },
    });
  }

  // ── unmatched: reported, never swept up ────────────────────────────────────
  const unmatchedContracts = (municipalCost?.municipalities ?? [])
    .filter((row) => !matchedContractKeys.has(nfc(row.municipality_key)))
    .map((row) => row.municipality_key);
  const consumedBurdenCodes = new Set<string>();
  for (const row of rows) {
    for (const code of childCodesByRegion.get(row.code) ?? [row.code]) {
      consumedBurdenCodes.add(code);
    }
  }
  const unmatchedFacilityRegions = [...burdenByCode.keys()].filter(
    (code) => !consumedBurdenCodes.has(code),
  );

  return {
    scope,
    generation: {
      tons: sumExactDecimals(
        inScope.map((row) => row.generationTons).filter((v): v is string => v !== null),
      ),
      unit: reportingStats?.items[0]?.quantity_unit ?? "톤/년",
      referenceYear: reportingStats?.reference_year ?? null,
      regionCount: inScope.filter((row) => row.generationTons !== null).length,
      expectedRegionCount: inScope.length,
      accountingBasis: reportingStats?.items[0]?.accounting_basis ?? null,
      missingCells: inScope.flatMap((row) =>
        row.missingStreams.map((gap) => ({ ...gap, stream: `${row.fullName} · ${gap.stream}` })),
      ),
      unassignedFacilityCount: 0,
    },
    throughput: {
      tons: sumExactDecimals(
        inScope.map((row) => row.throughputTons).filter((v): v is string => v !== null),
      ),
      unit: facilityBurden?.items[0]?.quantity_unit ?? "톤/년",
      referenceYear: facilityBurden?.reference_year ?? null,
      regionCount: inScope.filter((row) => row.throughputTons !== null).length,
      expectedRegionCount: inScope.length,
      accountingBasis: facilityBurden?.items[0]?.accounting_basis ?? null,
      missingCells: [],
      // Only meaningful for the whole capital region: the envelope reports these
      // facilities without saying which metropolitan they would have fallen in, so
      // attributing them to a filtered scope would be a guess.
      unassignedFacilityCount:
        scope === null ? (facilityBurden?.facilities_without_region ?? 0) : 0,
    },
    groups,
    unmatched: { contractRows: unmatchedContracts, facilityRegions: unmatchedFacilityRegions },
  };
}

/**
 * The identity of a composite city, as the SET of its 일반구.
 *
 * Sorted and joined, so the two sources may list the districts in any order — the
 * contract-payment endpoint orders by component code, the reporting endpoint by its
 * own member table, and an order-sensitive key would match neither reliably.
 */
function childKey(codes: readonly string[]): string {
  return [...codes].map(nfc).sort().join("|");
}

/**
 * Total population of a group, or `null` if ANY member is missing one.
 *
 * Not a partial sum: a per-resident value computed over an incomplete denominator
 * would be silently inflated, and the reader has no way to see that from the
 * result. Absent is absent.
 */
function sumPopulation(rows: readonly MunicipalityRow[]): number | null {
  let total = 0;
  for (const row of rows) {
    if (row.population === null) return null;
    total += row.population;
  }
  return rows.length > 0 ? total : null;
}

// --------------------------------------------------------------------------- //
// Presentation helpers
// --------------------------------------------------------------------------- //

/** `1,497.5` — a per-resident 계산값, one decimal. `null` stays absent. */
export function formatPerCapitaKg(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * The coverage sentence for a derived total.
 *
 * States what was counted and, when anything is missing, exactly what. It never
 * says "완전" — it says how many of how many, which the reader can check.
 */
export function coverageSentence(total: DerivedTotal, tierNoun: string): string {
  const counted = `${tierNoun} ${total.regionCount}곳`;
  const scopeText =
    total.regionCount === total.expectedRegionCount
      ? counted
      : `${counted} (대상 ${total.expectedRegionCount}곳)`;
  const parts = [`${scopeText}의 공식 보고값 합계`];
  if (total.missingCells.length > 0) {
    parts.push(`미보고 ${total.missingCells.length}건은 합계에서 제외했으며 0으로 채우지 않았습니다`);
  }
  if (total.unassignedFacilityCount > 0) {
    parts.push(`지역이 확인되지 않은 시설 ${total.unassignedFacilityCount}곳은 포함되지 않았습니다`);
  }
  return `${parts.join(" · ")}.`;
}
