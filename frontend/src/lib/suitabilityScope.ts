/**
 * ① 분석 범위 — the Page-4 analysis scope, and the citizen-facing region registry
 * it is chosen from.
 *
 * This module is the ONE place the Page-4B scope contract
 * (docs/SUITABILITY_SCOPE_FILTER_API.md) is expressed in the frontend. It exists
 * because three separate facts about the stored geography are easy to get wrong,
 * and each wrong answer is silent — a plausible ranking over the wrong cells.
 *
 * ── 1. `sido` and `sigungu` MUST NOT be sent together ────────────────────────────
 * The engine assigns the two codes with two INDEPENDENT `ST_Covers` lookups, one
 * against the SIDO boundary layer and one against the SIGUNGU layer. Those layers
 * are not coincident, so in run 47: 553 cells have a NULL `sigungu_region_code`,
 * and 137 carry a SIDO/SIGUNGU pair whose prefixes disagree. "서울" therefore has
 * three different totals depending on how it is expressed — 2,470 by `sido`, 2,424
 * by the union of its SIGUNGU codes, 2,392 with both (they AND).
 *
 * {@link SuitabilityScope} is a discriminated union precisely so the two cannot be
 * combined: there is no representable value carrying both a `sido` and a `sigungu`
 * list, so the illegal request cannot be built, not even by accident.
 *
 * ── 2. One citizen-facing city can be SEVERAL SGIS codes ─────────────────────────
 * The big Gyeonggi cities are stored at 일반구 granularity: 안산시 is `KR-SGIS-31091`
 * 상록구 + `KR-SGIS-31092` 단원구, 고양시 is three codes, 수원시 four. A reader picks
 * "안산시"; the request must carry BOTH of its codes. The relationship is read from
 * the served region registry (a three-token `region_name` is 시·도 + 시 + 구), never
 * hardcoded — see {@link buildScopeRegionOptions}.
 *
 * ── 3. This is the SGIS code space, not the MOIS one ─────────────────────────────
 * Suitability keys on `KR-SGIS-11 / 23 / 31` (서울 / 인천 / 경기). The landfill and
 * 수집·운반 계약 endpoints use the administrative space `11 / 28 / 41`, where Incheon
 * and Gyeonggi differ. Sending `28` here matches zero rows rather than returning
 * Incheon, so the two spaces must never be mixed. Only canonical `KR-SGIS-…` values
 * are produced by this module: the API also accepts the bare form, but a canonical
 * value cannot be misread as a MOIS code by a human or a log.
 */

import type { RegionBoundaryProperties } from "./api";
import { regionScope, SCOPE_LABELS, type RegionScope } from "./ranking";

/** The canonical stored SIDO codes of the three capital-region 시·도. */
export type SuitabilitySidoCode = "KR-SGIS-11" | "KR-SGIS-23" | "KR-SGIS-31";

/** Canonical prefix. The API accepts a bare code too; we always send the full one. */
export const SGIS_PREFIX = "KR-SGIS-";

/**
 * The three 시·도 pills, in the order the Figma frame lays them out after
 * 수도권 전체. Bare digits appear ONLY as the key of the existing `RegionScope`
 * classification (lib/ranking.ts) — never in a request.
 */
export const SUITABILITY_SIDO_OPTIONS: readonly {
  code: SuitabilitySidoCode;
  scope: RegionScope;
  label: string;
}[] = [
  { code: "KR-SGIS-11", scope: "11", label: SCOPE_LABELS["11"] },
  { code: "KR-SGIS-23", scope: "23", label: SCOPE_LABELS["23"] },
  { code: "KR-SGIS-31", scope: "31", label: SCOPE_LABELS["31"] },
];

const SIDO_CODES: readonly string[] = SUITABILITY_SIDO_OPTIONS.map((o) => o.code);

export function isSuitabilitySidoCode(value: string): value is SuitabilitySidoCode {
  return SIDO_CODES.includes(value);
}

/**
 * The active analysis scope.
 *
 * Three mutually exclusive shapes, by construction (see the header): 수도권 전체
 * sends neither parameter, a 시·도 sends only `sido`, and a 시·군·구 multi-select
 * sends only `sigungu`. `codes` is always non-empty, de-duplicated and sorted — an
 * empty selection is the `all` scope, never a "match nothing" request.
 */
export type SuitabilityScope =
  | { kind: "all" }
  | { kind: "sido"; sido: SuitabilitySidoCode }
  | { kind: "sigungu"; codes: string[] };

export const SCOPE_ALL: SuitabilityScope = { kind: "all" };

/** 수도권 전체 — the default, and what an emptied selection returns to. */
export const SUITABILITY_SCOPE_ALL_LABEL = "수도권 전체";

/** Normalize, de-duplicate and sort a set of SIGUNGU codes into a scope. */
export function sigunguScope(codes: readonly string[]): SuitabilityScope {
  const canonical = Array.from(new Set(codes.map(canonicalRegionCode).filter(Boolean))).sort();
  return canonical.length === 0 ? SCOPE_ALL : { kind: "sigungu", codes: canonical };
}

/**
 * The canonical spelling of a region code.
 *
 * Mirrors the backend's `_canonical_region_code`: an all-digit value gets the
 * `KR-SGIS-` prefix, anything else is passed through untouched so an unrecognized
 * code STAYS unrecognized (and matches nothing) rather than being coerced into
 * something plausible.
 */
export function canonicalRegionCode(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return /^\d+$/.test(trimmed) ? `${SGIS_PREFIX}${trimmed}` : trimmed;
}

/**
 * The scope as `/suitability/candidates` query fields.
 *
 * THE ONE SERIALIZER. Every scoped read — the ranking, the A/B/C order statistics,
 * any future page of the list — goes through it, so no call site can invent a
 * `sido` + `sigungu` pair of its own.
 */
export interface ScopeQuery {
  sido?: string;
  sigungu?: string[];
}

export function scopeToQuery(scope: SuitabilityScope): ScopeQuery {
  switch (scope.kind) {
    case "all":
      return {};
    case "sido":
      return { sido: scope.sido };
    case "sigungu":
      return { sigungu: scope.codes };
  }
}

/**
 * A stable key for the scope, for effect dependencies and cache keys. Two scopes
 * that produce the same request must produce the same key.
 */
export function scopeKey(scope: SuitabilityScope): string {
  switch (scope.kind) {
    case "all":
      return "all";
    case "sido":
      return `sido:${scope.sido}`;
    case "sigungu":
      return `sigungu:${scope.codes.join(",")}`;
  }
}

export function scopesEqual(a: SuitabilityScope, b: SuitabilityScope): boolean {
  return scopeKey(a) === scopeKey(b);
}

// --------------------------------------------------------------------------- //
// The citizen-facing region registry
// --------------------------------------------------------------------------- //

/**
 * One selectable region in ① — what a reader picks, and the codes it sends.
 *
 * A "region" here is a CITY as a citizen names it. For 25 서울 자치구, 10 인천
 * 군·구 and 24 경기 시·군 that is exactly one stored code; for the seven large
 * Gyeonggi cities stored at 일반구 granularity it is several, and picking the city
 * sends all of them (`codes`).
 */
export interface ScopeRegionOption {
  /** Stable identity: the lowest constituent code. */
  id: string;
  /** What the reader sees, e.g. "경기 안산시", "서울 중구", "인천 중구". */
  label: string;
  /** Every constituent SGIS SIGUNGU code, canonical, sorted, non-empty. */
  codes: string[];
  /** Which 시·도 this city belongs to, from the served `parent_region_code`. */
  sido: SuitabilitySidoCode;
  /** The 일반구 names this city expands into; empty for a single-code region. */
  districtNames: string[];
}

/** A city stored as several 일반구 — the multi-code case Rule #2 is about. */
export function isCompositeOption(option: ScopeRegionOption): boolean {
  return option.codes.length > 1;
}

const SIDO_SORT_RANK: Record<SuitabilitySidoCode, number> = {
  "KR-SGIS-11": 0,
  "KR-SGIS-23": 1,
  "KR-SGIS-31": 2,
};

/**
 * Resolve a SIGUNGU region's 시·도 from the registry's OWN `parent_region_code`,
 * falling back to the shared `regionScope` classification of its code. A region
 * outside the three capital-region 시·도 is not selectable here and returns null.
 */
function optionSido(properties: {
  region_code: string;
  parent_region_code: string | null;
}): SuitabilitySidoCode | null {
  const parent = properties.parent_region_code;
  if (parent !== null && isSuitabilitySidoCode(parent)) return parent;
  const scope = regionScope(properties.region_code);
  if (scope === null) return null;
  const canonical = `${SGIS_PREFIX}${scope}`;
  return isSuitabilitySidoCode(canonical) ? canonical : null;
}

/**
 * Build the selectable city list from the SERVED region registry.
 *
 * The parent-city relationship is READ, not hardcoded. `regions.region_name` is
 * `시·도 시 구` for a city stored at 일반구 granularity and `시·도 시·군·구`
 * otherwise, so the second token is the citizen-facing city in BOTH shapes:
 *
 *   "경기도 안산시 상록구"  → 안산시 · 상록구      ┐ one option, two codes
 *   "경기도 안산시 단원구"  → 안산시 · 단원구      ┘
 *   "경기도 시흥시"        → 시흥시               → one option, one code
 *   "서울특별시 종로구"     → 종로구               → one option, one code
 *
 * Grouping is keyed by (시·도, city), so 서울 중구 and 인천 중구 stay two distinct
 * options despite sharing a name — and the metropolitan prefix in `label` is what
 * a reader tells them apart by, exactly as `regionDisplayName` does elsewhere.
 *
 * A region the registry does not place in one of the three capital-region 시·도 is
 * omitted rather than given an invented parent.
 */
export function buildScopeRegionOptions(
  regions: readonly { properties: RegionBoundaryProperties }[],
): ScopeRegionOption[] {
  const groups = new Map<
    string,
    { sido: SuitabilitySidoCode; city: string; codes: string[]; districts: string[] }
  >();

  for (const feature of regions) {
    const properties = feature.properties;
    if (properties.region_level !== "SIGUNGU") continue;
    const sido = optionSido(properties);
    if (sido === null) continue;

    const tokens = (properties.region_name ?? "").trim().split(/\s+/).filter(Boolean);
    // Token 0 is the 시·도 name. Token 1 is the citizen-facing city in both the
    // two-token and three-token shapes; anything after it is the 일반구.
    const city = tokens[1];
    if (city === undefined) continue;
    const district = tokens.slice(2).join(" ");

    const key = `${sido}|${city}`;
    const group = groups.get(key) ?? { sido, city, codes: [], districts: [] };
    group.codes.push(canonicalRegionCode(properties.region_code));
    if (district !== "") group.districts.push(district);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => {
      const codes = Array.from(new Set(group.codes)).sort();
      const scope = regionScope(group.sido);
      return {
        id: codes[0],
        // The metropolitan prefix is what disambiguates two 중구. It is the same
        // wording the 시·도 pills use, so a chip and a pill read as one vocabulary.
        label: scope === null ? group.city : `${SCOPE_LABELS[scope]} ${group.city}`,
        codes,
        sido: group.sido,
        districtNames: group.districts.slice().sort((a, b) => a.localeCompare(b, "ko")),
      };
    })
    .sort((a, b) => {
      const rank = SIDO_SORT_RANK[a.sido] - SIDO_SORT_RANK[b.sido];
      if (rank !== 0) return rank;
      const byLabel = a.label.localeCompare(b.label, "ko");
      return byLabel !== 0 ? byLabel : a.id.localeCompare(b.id);
    });
}

/** Index every constituent code → its option, for chip rendering and lookups. */
export function indexOptionsByCode(
  options: readonly ScopeRegionOption[],
): Map<string, ScopeRegionOption> {
  const index = new Map<string, ScopeRegionOption>();
  for (const option of options) {
    for (const code of option.codes) index.set(code, option);
  }
  return index;
}

/**
 * The options fully contained in the scope's selection, in registry order, plus
 * any selected code the registry does not know.
 *
 * A city counts as selected only when EVERY one of its codes is selected — a
 * partially selected 안산시 would otherwise render as a chip claiming the whole
 * city while the request carried one 구.
 */
export function selectedOptions(
  scope: SuitabilityScope,
  options: readonly ScopeRegionOption[],
): { selected: ScopeRegionOption[]; unknownCodes: string[] } {
  if (scope.kind !== "sigungu") return { selected: [], unknownCodes: [] };
  const wanted = new Set(scope.codes);
  const selected = options.filter((option) => option.codes.every((code) => wanted.has(code)));
  const covered = new Set(selected.flatMap((option) => option.codes));
  return {
    selected,
    unknownCodes: scope.codes.filter((code) => !covered.has(code)),
  };
}

/** Add every code of a city to the selection, replacing any 시·도 scope. */
export function withOptionSelected(
  scope: SuitabilityScope,
  option: ScopeRegionOption,
): SuitabilityScope {
  const current = scope.kind === "sigungu" ? scope.codes : [];
  return sigunguScope([...current, ...option.codes]);
}

/** Remove every code of a city; emptying the selection returns to 수도권 전체. */
export function withOptionCleared(
  scope: SuitabilityScope,
  option: ScopeRegionOption,
): SuitabilityScope {
  if (scope.kind !== "sigungu") return scope;
  const drop = new Set(option.codes);
  return sigunguScope(scope.codes.filter((code) => !drop.has(code)));
}

export function isOptionSelected(scope: SuitabilityScope, option: ScopeRegionOption): boolean {
  if (scope.kind !== "sigungu") return false;
  const selected = new Set(scope.codes);
  return option.codes.every((code) => selected.has(code));
}

/** Case-insensitive substring search over the visible label and the 일반구 names. */
export function filterScopeOptions(
  options: readonly ScopeRegionOption[],
  query: string,
): ScopeRegionOption[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...options];
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(needle) ||
      option.districtNames.some((name) => name.toLowerCase().includes(needle)),
  );
}

// --------------------------------------------------------------------------- //
// Scope membership
// --------------------------------------------------------------------------- //

/**
 * Whether a served candidate is inside the active scope.
 *
 * Tests the SAME attribute the request filters on — `sido_region_code` for a 시·도
 * scope, `sigungu_region_code` for a 시·군·구 scope — and never infers one from the
 * other. That is the whole point: a boundary cell whose two codes disagree must be
 * judged by the code the backend actually filtered on, or the page would keep a
 * selected candidate the scoped ranking no longer contains.
 */
export function isCandidateInScope(
  scope: SuitabilityScope,
  candidate: { sido_region_code?: string | null; sigungu_region_code?: string | null },
): boolean {
  switch (scope.kind) {
    case "all":
      return true;
    case "sido":
      return candidate.sido_region_code === scope.sido;
    case "sigungu": {
      const code = candidate.sigungu_region_code;
      return code != null && scope.codes.includes(code);
    }
  }
}

/** The scope's name, for headings, counts and the screen-reader summary. */
export function scopeLabel(
  scope: SuitabilityScope,
  options: readonly ScopeRegionOption[],
): string {
  switch (scope.kind) {
    case "all":
      return SUITABILITY_SCOPE_ALL_LABEL;
    case "sido": {
      const match = SUITABILITY_SIDO_OPTIONS.find((option) => option.code === scope.sido);
      return match?.label ?? scope.sido;
    }
    case "sigungu": {
      const { selected, unknownCodes } = selectedOptions(scope, options);
      const names = [...selected.map((option) => option.label), ...unknownCodes];
      if (names.length === 0) return SUITABILITY_SCOPE_ALL_LABEL;
      if (names.length <= 2) return names.join(" · ");
      return `${names[0]} 외 ${names.length - 1}곳`;
    }
  }
}
