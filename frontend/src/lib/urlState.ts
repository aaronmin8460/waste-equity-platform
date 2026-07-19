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
import type { SuitabilityProfile, SuitabilityStatus } from "./api";

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

/** Max comparison regions (a hard product bound, mirrored by the UI). */
export const MAX_COMPARE = 3;

/** Region-code shape: SGIS numeric or the RCIS `KR-RCISRG-…` codes. Bounds length. */
const REGION_CODE_RE = /^[A-Za-z0-9-]{1,30}$/;
/** A weight component: a plain decimal in [0,1], up to 8 fractional digits. */
const WEIGHT_RE = /^(0(\.\d{1,8})?|1(\.0{1,8})?)$/;

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
    if (!isDefault) params.set("status", state.statusOn.join(","));
    if (state.stableOnly) params.set("stable", "1");
    if (state.view === "scenario" && state.weights) {
      params.set("wz", state.weights.zoning);
      params.set("wr", state.weights.road);
      params.set("we", state.weights.equity);
      params.set("wd", state.weights.demand);
      if (state.cmpProfile !== "baseline") params.set("cmpProfile", state.cmpProfile);
    }
    if (state.candidate) params.set("cand", String(state.candidate));
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
