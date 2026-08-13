/**
 * Versioned, validated, shareable URL state.
 *
 * Only a fixed WHITELIST of enums, bounded numbers, region codes, and canonical
 * scenario weights is ever (de)serialised — never credentials, tokens, cookies,
 * filesystem paths, whole API responses, or arbitrary free text. Every field is
 * bounds/enum checked on decode; an invalid field is dropped (not fatal) and
 * recorded as a warning so the UI can show a brief, accessible notice. A link
 * carrying an unknown `v` is ignored wholesale rather than mis-restored.
 *
 * Region codes are format-screened here but their EXISTENCE is validated by the
 * caller against the regions actually loaded (they depend on the active metric's
 * geometry). Restored scenario weights are format-screened here and then
 * RE-VALIDATED by the preview API before anything is shown — this module never
 * decides a scenario is analytically valid.
 *
 * The module is pure (no window/history access), so it is unit-testable; the page
 * reads `window.location.search` once on mount and writes via `history.replaceState`
 * (a one-way state→URL sync, so there is no update loop and no hydration mismatch).
 */

import type { MetricKey } from "./metrics";
import { METRICS } from "./metrics";
import type { DashboardArea, SuitabilitySubview } from "./glossary";
import type { ScopeSelection } from "./ranking";
import type {
  LandfillOrigin,
  MunicipalCostSido,
  MunicipalCostSort,
  MunicipalCostStatus,
  SuitabilityProfile,
  SuitabilitySort,
  SuitabilityStatus,
} from "./api";
import { SUITABILITY_DEFAULT_SORT } from "./api";
import { SAVED_SCENARIO_ID_RE } from "./savedScenarios";
import { isSuitabilitySidoCode, sigunguScope, type SuitabilityScope } from "./suitabilityScope";

export const URL_STATE_VERSION = "1";

const MODES: readonly DashboardArea[] = ["equity", "suitability", "flow", "transparency"];
const SUBVIEWS: readonly SuitabilitySubview[] = ["score", "scenario", "cost"];
const PROFILES: readonly SuitabilityProfile[] = [
  "baseline",
  "equal",
  "equity_focused",
  "access_focused",
  "critic",
];
const STATUSES: readonly SuitabilityStatus[] = ["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"];
const SCOPES: readonly ScopeSelection[] = ["all", "11", "23", "31"];
const TOP_NS: readonly number[] = [5, 10, 20];
const METRIC_KEYS = new Set<string>(METRICS.map((m) => m.key));
/** 매립지 현황 origin: the three capital-region SGIS sido codes (see api.ts). */
const LANDFILL_ORIGINS: readonly LandfillOrigin[] = ["11", "28", "41"];
/**
 * 수집·운반 계약 지급액 filters. The three closed sets the BACKEND accepts — a value
 * outside them is a 422 there, so it is dropped with a warning here rather than
 * being sent.
 */
const MUNICIPAL_COST_SIDOS: readonly MunicipalCostSido[] = ["11", "28", "41"];
const MUNICIPAL_COST_STATUSES: readonly MunicipalCostStatus[] = [
  "AVAILABLE",
  "PARTIAL",
  "UNAVAILABLE",
];
/** 후보지 심층 분석 ranking direction. Two values; the default writes no key. */
const SUITABILITY_SORTS: readonly SuitabilitySort[] = ["score_desc", "score_asc"];
/**
 * A canonical SGIS region code, the ONLY spelling this key accepts. The bare form
 * is deliberately rejected: `11` is 서울 in the SGIS space but 서울 in the MOIS
 * space too, while `28`/`41` are Incheon/Gyeonggi ONLY in MOIS — accepting bare
 * digits would let a landfill-space link silently scope the suitability ranking to
 * nothing. `KR-SGIS-` cannot be misread.
 */
const SGIS_SIGUNGU_CODE_RE = /^KR-SGIS-\d{5}$/;
/**
 * Upper bound on a shared 시·군·구 selection. The registry holds 79 SIGUNGU codes,
 * so this cannot truncate a real selection; it only bounds a hostile URL.
 */
const MAX_SUITABILITY_SIGUNGU = 100;

const MUNICIPAL_COST_SORTS: readonly MunicipalCostSort[] = [
  "payment_per_capita_desc",
  "total_payment_desc",
  "region_name_asc",
];
/** The served default ordering; a link carrying it adds no parameter. */
export const MUNICIPAL_COST_DEFAULT_SORT: MunicipalCostSort = "payment_per_capita_desc";
/**
 * The default 자료 상태 scope: the municipalities whose per-capita value is actually
 * calculable.
 *
 * A comparison whose default view is "all 66" opens on a list that is mostly 자료 없음
 * rows, which buries the comparable ones and reads as though the platform simply has
 * nothing. Defaulting to 계산 가능 puts the comparable set first WITHOUT hiding
 * anything: the served scope counts (`expected` / `available` / `partial` /
 * `unavailable`) are computed before the status filter and stay on the control, so
 * the size of what is being excluded is visible at all times and one click restores
 * it. It is a scope selection sent to the backend as `status`, never a curated
 * municipality list.
 */
export const MUNICIPAL_COST_DEFAULT_STATUS: MunicipalCostStatus | null = "AVAILABLE";
/**
 * The 전체 (unfiltered) selection's URL token.
 *
 * `null` is no longer the default, so it can no longer be encoded by omission — an
 * absent `mcStatus` now restores 계산 가능. It needs a token of its own, exactly as the
 * suitability status filter's all-hidden case needs its `none` sentinel. The token is
 * never sent to the backend: 전체 means the `status` parameter is omitted there.
 */
const MUNICIPAL_COST_STATUS_ALL = "all";

/** Max comparison regions (a hard product bound, mirrored by the UI). */
export const MAX_COMPARE = 3;

/** Region-code shape: SGIS numeric or the RCIS `KR-RCISRG-…` codes. Bounds length. */
const REGION_CODE_RE = /^[A-Za-z0-9-]{1,30}$/;
/** A weight component: a plain decimal in [0,1], up to 8 fractional digits. */
const WEIGHT_RE = /^(0(\.\d{1,8})?|1(\.0{1,8})?)$/;
/** A four-digit calendar year. Availability is decided by the backend, not here. */
const LANDFILL_YEAR_RE = /^(19|20|21)\d{2}$/;
/** A calendar month, 1–12, unpadded (matching the `<select>` option values). */
const LANDFILL_MONTH_RE = /^([1-9]|1[0-2])$/;
/**
 * A served waste-category name. Unlike every other field this is NOT a closed set:
 * `waste_name` is free Korean text served by the backend (`api.ts`), so it can only
 * be shape-screened — a length bound and a rejection of control characters. An
 * unavailable name is not fabricated into the dataset: it is passed to the backend
 * exactly as any picked value is, and answered with the ordinary no-data state.
 */
const WASTE_NAME_RE = /^[^\u0000-\u001F\u007F]{1,60}$/;

export interface ScenarioWeights {
  zoning: string;
  road: string;
  equity: string;
  demand: string;
}

/** The full whitelisted state. Every field optional on decode. */
export interface AppUrlState {
  mode: DashboardArea;
  metric: MetricKey;
  region: string | null;
  cmp: string[];
  scope: ScopeSelection;
  top: number;
  view: SuitabilitySubview;
  profile: SuitabilityProfile;
  statusOn: SuitabilityStatus[];
  stableOnly: boolean;
  weights: ScenarioWeights | null;
  cmpProfile: SuitabilityProfile;
  candidate: number | null;
  /**
   * 매립지 현황 filters. `null` is a MEANINGFUL served value in each case — 최신
   * 완결연도 / 연간 / 전체 출발 지역 / 전체 폐기물 종류 — and is also the product
   * default, so a default filter writes no parameter (the existing "defaults are
   * omitted" rule). Decoding an absent parameter therefore restores the default.
   */
  landfillYear: number | null;
  landfillMonth: number | null;
  landfillOrigin: LandfillOrigin | null;
  landfillWaste: string | null;
  /**
   * 시·군·구 수집·운반 계약 지급액 filters — a SEPARATE dataset that shares the 매립지
   * 현황 area, so its keys are prefixed `mc` and never collide with the four above.
   *
   * `null` means 전체. For `sido` that is also the product default, so it writes no
   * parameter; for `status` the default is 계산 가능
   * ({@link MUNICIPAL_COST_DEFAULT_STATUS}), so 전체 writes the explicit `all` token
   * instead. `sort` likewise has a non-null default (`payment_per_capita_desc`) and is
   * written only when it differs. The reference year is deliberately NOT part of the
   * URL: the release publishes exactly one year and the backend rejects any other
   * with a 422.
   */
  municipalCostSido: MunicipalCostSido | null;
  municipalCostStatus: MunicipalCostStatus | null;
  municipalCostSort: MunicipalCostSort;
  /**
   * ① 분석 범위 and ③ 순위 방향 for 후보지 심층 분석 (Page 4).
   *
   * DELIBERATELY NOT the existing `scope` / `top` keys. Those belong to the 지역
   * 부담 ranking on Page 1, carry the bare `"11" | "23" | "31" | "all"` vocabulary,
   * and are read in a different mode; reusing them would make one shared link mean
   * two different things and change Page-1 semantics. These three keys are new,
   * suitability-only, and written only in `mode=suitability`.
   *
   * `suitScope` is the whole scope in ONE key, because the scope is a sum type and
   * two independent keys could express the illegal `sido`+`sigungu` pair that
   * docs/SUITABILITY_SCOPE_FILTER_API.md forbids:
   *
   *   (absent)                              → 수도권 전체
   *   `KR-SGIS-11`                          → the 서울 시·도 scope
   *   `KR-SGIS-31091,KR-SGIS-31092`         → a 시·군·구 multi-select (안산시)
   *
   * A single 시·도 code and a list of 시·군·구 codes are distinguishable by length
   * (a SIDO code has 2 digits, a SIGUNGU code 5), so one key round-trips both
   * without a discriminator — and a link can never carry both scopes at once.
   */
  suitScope: SuitabilityScope;
  suitSort: SuitabilitySort;
  /**
   * ⑤ 비교할 시나리오 선택 — the A/B pair Page 5 compares, as SAVED-SCENARIO IDS.
   *
   * An id, not a weight vector. The four `wz`/`wr`/`we`/`wd` keys still carry ONE
   * ad-hoc scenario's weights and are untouched by this pair; these two name two
   * *stored* scenarios, each of which carries its own weights, its own run and its
   * own name in `lib/savedScenarios.ts`. Both spellings therefore coexist in one
   * link without either changing the other's meaning, and every Page-5 URL shared
   * before this phase keeps working exactly as it did.
   *
   * Only the id shape is checked here — `SAVED_SCENARIO_ID_RE`, the same pattern
   * the storage layer mints against. Whether the id EXISTS is deliberately not
   * this module's call: saved scenarios live in the reader's own browser, so a
   * perfectly well-formed link from another device resolves to nothing here and
   * must render an explicit "이 브라우저에 없습니다" state rather than being
   * dropped as malformed. `resolveComparisonPair` draws that distinction.
   *
   * The two ids must DIFFER: comparing a scenario against itself is not a
   * comparison, so a link carrying `cmpA === cmpB` keeps A and drops B with a
   * warning rather than opening a degenerate comparison.
   */
  cmpA: string | null;
  cmpB: string | null;
}

export interface DecodedUrlState {
  state: Partial<AppUrlState>;
  /** Human-readable, plain-Korean notes about dropped/invalid fields. */
  warnings: string[];
}

function isMode(v: string): v is DashboardArea {
  return (MODES as readonly string[]).includes(v);
}

// --------------------------------------------------------------------------- //
// Decode
// --------------------------------------------------------------------------- //

/**
 * Parse a query string into a partial, validated state. Invalid or unknown fields
 * are dropped with a warning; the version gate ignores everything on mismatch.
 */
export function decodeUrlState(search: string): DecodedUrlState {
  const warnings: string[] = [];
  const state: Partial<AppUrlState> = {};
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  const version = params.get("v");
  if (version === null) return { state, warnings }; // no shared state present
  if (version !== URL_STATE_VERSION) {
    return { state, warnings: ["공유 링크의 형식이 달라 일부 설정을 복원하지 못했습니다."] };
  }

  const mode = params.get("mode");
  if (mode !== null) {
    if (isMode(mode)) state.mode = mode;
    else warnings.push("알 수 없는 화면 설정은 무시했습니다.");
  }

  const metric = params.get("metric");
  if (metric !== null) {
    if (METRIC_KEYS.has(metric)) state.metric = metric as MetricKey;
    else warnings.push("알 수 없는 지표 설정은 무시했습니다.");
  }

  const region = params.get("region");
  if (region !== null) {
    if (REGION_CODE_RE.test(region)) state.region = region;
    else warnings.push("잘못된 지역 코드는 무시했습니다.");
  }

  const cmp = params.get("cmp");
  if (cmp !== null) {
    const codes = cmp.split(",").filter((c) => c.length > 0);
    const valid: string[] = [];
    let dropped = false;
    for (const c of codes) {
      if (REGION_CODE_RE.test(c) && !valid.includes(c) && valid.length < MAX_COMPARE) valid.push(c);
      else dropped = true;
    }
    if (valid.length) state.cmp = valid;
    if (dropped) warnings.push("비교 지역 중 일부가 잘못되어 제외했습니다.");
  }

  const scope = params.get("scope");
  if (scope !== null) {
    if ((SCOPES as readonly string[]).includes(scope)) state.scope = scope as ScopeSelection;
    else warnings.push("알 수 없는 범위 설정은 무시했습니다.");
  }

  const top = params.get("top");
  if (top !== null) {
    const n = Number(top);
    if (TOP_NS.includes(n)) state.top = n;
    else warnings.push("허용되지 않는 표시 개수는 무시했습니다.");
  }

  const view = params.get("view");
  if (view !== null) {
    if ((SUBVIEWS as readonly string[]).includes(view)) state.view = view as SuitabilitySubview;
    else warnings.push("알 수 없는 하위 화면 설정은 무시했습니다.");
  }

  const profile = params.get("profile");
  if (profile !== null) {
    if ((PROFILES as readonly string[]).includes(profile)) state.profile = profile as SuitabilityProfile;
    else warnings.push("알 수 없는 점수 기준은 무시했습니다.");
  }

  const cmpProfile = params.get("cmpProfile");
  if (cmpProfile !== null) {
    if ((PROFILES as readonly string[]).includes(cmpProfile))
      state.cmpProfile = cmpProfile as SuitabilityProfile;
    else warnings.push("알 수 없는 비교 기준은 무시했습니다.");
  }

  const status = params.get("status");
  if (status !== null) {
    if (status === "none") {
      // Explicit "all statuses hidden" — a valid, distinct state (round-trips).
      state.statusOn = [];
    } else {
      const items = status.split(",").filter((s) => s.length > 0);
      const valid = items.filter((s): s is SuitabilityStatus =>
        (STATUSES as readonly string[]).includes(s),
      );
      // Only accept if every provided token was valid (partial garbage → drop all + warn).
      if (valid.length === items.length && items.length > 0) {
        state.statusOn = Array.from(new Set(valid));
      } else if (items.length > 0) {
        warnings.push("알 수 없는 상태 필터는 무시했습니다.");
      }
    }
  }

  const stable = params.get("stable");
  if (stable !== null) {
    if (stable === "1") state.stableOnly = true;
    else if (stable === "0") state.stableOnly = false;
    else warnings.push("잘못된 안정 후보 설정은 무시했습니다.");
  }

  const weights = decodeWeights(params);
  if (weights.value) state.weights = weights.value;
  if (weights.warning) warnings.push(weights.warning);

  const cand = params.get("cand");
  if (cand !== null) {
    const id = Number(cand);
    if (Number.isInteger(id) && id > 0 && id < 1_000_000_000) state.candidate = id;
    else warnings.push("잘못된 후보 구역 설정은 무시했습니다.");
  }

  // 매립지 현황 filters. Each is shape-screened only; whether the dataset actually
  // holds the period/origin/category is the backend's answer, not this module's —
  // an unheld combination renders the ordinary "자료 없음" state, never a zero.
  const year = params.get("year");
  if (year !== null) {
    if (LANDFILL_YEAR_RE.test(year)) state.landfillYear = Number(year);
    else warnings.push("잘못된 연도 설정은 무시했습니다.");
  }

  const month = params.get("month");
  if (month !== null) {
    if (LANDFILL_MONTH_RE.test(month)) state.landfillMonth = Number(month);
    else warnings.push("잘못된 기간 설정은 무시했습니다.");
  }

  const origin = params.get("origin");
  if (origin !== null) {
    if ((LANDFILL_ORIGINS as readonly string[]).includes(origin))
      state.landfillOrigin = origin as LandfillOrigin;
    else warnings.push("알 수 없는 출발 지역 설정은 무시했습니다.");
  }

  const waste = params.get("waste");
  if (waste !== null) {
    if (WASTE_NAME_RE.test(waste)) state.landfillWaste = waste;
    else warnings.push("잘못된 폐기물 종류 설정은 무시했습니다.");
  }

  // 수집·운반 계약 지급액 filters. Closed sets, so an unknown token is dropped with a
  // warning rather than forwarded to the backend as a 422.
  const mcSido = params.get("mcSido");
  if (mcSido !== null) {
    if ((MUNICIPAL_COST_SIDOS as readonly string[]).includes(mcSido))
      state.municipalCostSido = mcSido as MunicipalCostSido;
    else warnings.push("알 수 없는 지급액 지역 설정은 무시했습니다.");
  }

  const mcStatus = params.get("mcStatus");
  if (mcStatus !== null) {
    // The sentinel first: 전체 is a real selection that has to round-trip now that the
    // default is 계산 가능, and it is not one of the backend's enum members.
    if (mcStatus === MUNICIPAL_COST_STATUS_ALL) state.municipalCostStatus = null;
    else if ((MUNICIPAL_COST_STATUSES as readonly string[]).includes(mcStatus))
      state.municipalCostStatus = mcStatus as MunicipalCostStatus;
    else warnings.push("알 수 없는 지급액 자료 상태 설정은 무시했습니다.");
  }

  const mcSort = params.get("mcSort");
  if (mcSort !== null) {
    if ((MUNICIPAL_COST_SORTS as readonly string[]).includes(mcSort))
      state.municipalCostSort = mcSort as MunicipalCostSort;
    else warnings.push("알 수 없는 지급액 정렬 설정은 무시했습니다.");
  }

  // 후보지 심층 분석 ① 분석 범위. One key, so a link can never carry the forbidden
  // sido+sigungu pair. A single SIDO code is the 시·도 scope; anything else is read
  // as a 시·군·구 list. Whether a code EXISTS is not decided here — an unknown but
  // well-formed code is forwarded and answered with an honest empty ranking, the
  // same way the region key elsewhere defers existence to the loaded data.
  const suitScope = params.get("suitScope");
  if (suitScope !== null) {
    const tokens = suitScope.split(",").filter((token) => token.length > 0);
    if (tokens.length === 1 && isSuitabilitySidoCode(tokens[0])) {
      state.suitScope = { kind: "sido", sido: tokens[0] };
    } else {
      const valid: string[] = [];
      let dropped = false;
      for (const token of tokens) {
        if (SGIS_SIGUNGU_CODE_RE.test(token) && valid.length < MAX_SUITABILITY_SIGUNGU) {
          valid.push(token);
        } else {
          dropped = true;
        }
      }
      // `sigunguScope` de-duplicates and sorts, and returns 수도권 전체 for an empty
      // list — an all-invalid link widens the scope rather than blanking the page.
      if (valid.length > 0) state.suitScope = sigunguScope(valid);
      if (dropped) warnings.push("잘못된 분석 범위 지역은 제외했습니다.");
    }
  }

  const suitSort = params.get("suitSort");
  if (suitSort !== null) {
    if ((SUITABILITY_SORTS as readonly string[]).includes(suitSort))
      state.suitSort = suitSort as SuitabilitySort;
    else warnings.push("알 수 없는 후보 순위 정렬은 무시했습니다.");
  }

  // ⑤ 비교할 시나리오 선택. Shape-screened only — see the `cmpA`/`cmpB` note on
  // `AppUrlState`. A malformed id is dropped with a warning; a well-formed id that
  // this browser has never stored is KEPT, so the page can say so explicitly.
  const cmpA = params.get("cmpA");
  if (cmpA !== null) {
    if (SAVED_SCENARIO_ID_RE.test(cmpA)) state.cmpA = cmpA;
    else warnings.push("잘못된 비교 시나리오 설정은 무시했습니다.");
  }

  const cmpB = params.get("cmpB");
  if (cmpB !== null) {
    if (!SAVED_SCENARIO_ID_RE.test(cmpB)) {
      warnings.push("잘못된 비교 시나리오 설정은 무시했습니다.");
    } else if (state.cmpA !== undefined && state.cmpA === cmpB) {
      // A안 wins the tie: the pair is ordered, and keeping A preserves the reader's
      // first choice rather than silently collapsing both slots onto one scenario.
      warnings.push("A안과 B안이 같아 B안 선택을 해제했습니다.");
    } else {
      state.cmpB = cmpB;
    }
  }

  return { state, warnings };
}

function decodeWeights(params: URLSearchParams): { value: ScenarioWeights | null; warning?: string } {
  const wz = params.get("wz");
  const wr = params.get("wr");
  const we = params.get("we");
  const wd = params.get("wd");
  if (wz === null && wr === null && we === null && wd === null) return { value: null };
  if (wz === null || wr === null || we === null || wd === null) {
    return { value: null, warning: "가중치 설정이 불완전하여 복원하지 못했습니다." };
  }
  if (![wz, wr, we, wd].every((w) => WEIGHT_RE.test(w))) {
    return { value: null, warning: "잘못된 가중치 형식은 무시했습니다." };
  }
  return { value: { zoning: wz, road: wr, equity: we, demand: wd } };
}

// --------------------------------------------------------------------------- //
// Encode
// --------------------------------------------------------------------------- //

/**
 * Serialise the current state to a query string (leading "?"), always stamped with
 * the schema version. Defaults are omitted to keep links short. Only whitelisted
 * fields are written; there is no path for arbitrary text.
 */
export function encodeUrlState(state: AppUrlState): string {
  const params = new URLSearchParams();
  params.set("v", URL_STATE_VERSION);
  params.set("mode", state.mode);
  params.set("metric", state.metric);
  if (state.region) params.set("region", state.region);
  if (state.cmp.length) params.set("cmp", state.cmp.slice(0, MAX_COMPARE).join(","));
  if (state.scope !== "all") params.set("scope", state.scope);
  if (state.top !== 10) params.set("top", String(state.top));

  // Suitability-only fields are only meaningful in that area.
  if (state.mode === "suitability") {
    if (state.view !== "score") params.set("view", state.view);
    if (state.profile !== "baseline") params.set("profile", state.profile);
    // Status filter: only serialise when it differs from the default {E, R}.
    const sortedOn = [...state.statusOn].sort();
    const isDefault =
      sortedOn.length === 2 &&
      sortedOn[0] === "ELIGIBLE" &&
      sortedOn[1] === "REVIEW_REQUIRED";
    // Encode the all-hidden case as an explicit "none" sentinel so it round-trips
    // (an empty join would be indistinguishable from "no status param").
    if (!isDefault) params.set("status", state.statusOn.length ? state.statusOn.join(",") : "none");
    if (state.stableOnly) params.set("stable", "1");
    if (state.view === "scenario" && state.weights) {
      params.set("wz", state.weights.zoning);
      params.set("wr", state.weights.road);
      params.set("we", state.weights.equity);
      params.set("wd", state.weights.demand);
      if (state.cmpProfile !== "baseline") params.set("cmpProfile", state.cmpProfile);
    }
    if (state.candidate) params.set("cand", String(state.candidate));
    // ① 분석 범위 — omitted for 수도권 전체, the default. The two non-default shapes
    // write the SAME key, so the sido/sigungu exclusivity survives sharing.
    if (state.suitScope.kind === "sido") params.set("suitScope", state.suitScope.sido);
    else if (state.suitScope.kind === "sigungu")
      params.set("suitScope", state.suitScope.codes.join(","));
    // ③ 순위 방향 — 높은 순 is the served default and adds no parameter.
    if (state.suitSort !== SUITABILITY_DEFAULT_SORT) params.set("suitSort", state.suitSort);
    // ⑤ 비교할 시나리오 선택. Written in BOTH suitability sub-views, not just
    // `view=scenario`: the pair is chosen on 후보지 심층 분석 (`view=score`) and
    // consumed on 후보지 심층 비교, so restricting it to the destination view would
    // make a half-made selection unshareable and would drop it the moment the
    // reader shared the screen they made it on.
    //
    // The two slots are written INDEPENDENTLY. A lone `cmpB` is a state the reader
    // can genuinely be in — pick both, then clear A — and suppressing it would make
    // the link disagree with the screen: B would still show as selected while a
    // reload silently dropped it. The only pair this refuses to write is A === B,
    // which is not a comparison.
    if (state.cmpA) params.set("cmpA", state.cmpA);
    if (state.cmpB && state.cmpB !== state.cmpA) params.set("cmpB", state.cmpB);
  }

  // Landfill-only fields, written only in that area — the same rule the suitability
  // block above follows. `null` is the product default for all four (최신 완결연도 /
  // 연간 / 전체 / 전체), so a default filter adds no parameter and a shared link
  // stays short.
  if (state.mode === "flow") {
    if (state.landfillYear !== null) params.set("year", String(state.landfillYear));
    if (state.landfillMonth !== null) params.set("month", String(state.landfillMonth));
    if (state.landfillOrigin !== null) params.set("origin", state.landfillOrigin);
    if (state.landfillWaste !== null) params.set("waste", state.landfillWaste);
    // The municipal-payment filters share the area but not the keys: `mc`-prefixed
    // so a shared 매립지 현황 link carries both datasets' selections unambiguously.
    if (state.municipalCostSido !== null) params.set("mcSido", state.municipalCostSido);
    // Written whenever it differs from the released default (계산 가능), including the
    // 전체 case — which is why that case needs an explicit token: omitting it would
    // encode 전체 as "restore the default" and quietly re-narrow a shared link.
    if (state.municipalCostStatus !== MUNICIPAL_COST_DEFAULT_STATUS)
      params.set("mcStatus", state.municipalCostStatus ?? MUNICIPAL_COST_STATUS_ALL);
    if (state.municipalCostSort !== MUNICIPAL_COST_DEFAULT_SORT)
      params.set("mcSort", state.municipalCostSort);
  }

  return `?${params.toString()}`;
}

/**
 * Absolute shareable link for the current state, resolved against the page origin.
 * Returns just the query string in non-browser environments.
 */
export function shareableUrl(state: AppUrlState): string {
  const query = encodeUrlState(state);
  if (typeof window === "undefined") return query;
  return `${window.location.origin}${window.location.pathname}${query}`;
}
