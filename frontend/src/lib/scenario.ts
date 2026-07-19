/**
 * Pure helpers for the user-weight scenario lab (가중치 실험실), extracted so the
 * weight math, normalization, rank-movement text, and session persistence are
 * unit-testable independently of the React tree (which Playwright exercises).
 *
 * The editor works in an integer 0–100 percent scale; the API receives canonical
 * 8-dp decimal strings. Integer percents that total exactly 100 map to canonical
 * weights that sum to exactly 1.00000000, so a valid editor total always yields a
 * valid canonical vector. Nothing here silently repairs an invalid total — only
 * the explicit "100%로 비율 정규화" action changes values, and it reports that it did.
 */

import type { SuitabilityProfile, SuitabilityRun, UserScenarioWeights } from "./api";

export const SCENARIO_COMPONENTS = ["zoning", "road", "equity", "demand"] as const;
export type ScenarioComponent = (typeof SCENARIO_COMPONENTS)[number];
export type ScenarioPercents = Record<ScenarioComponent, number>;

/** Citizen-facing labels + component code for each weight control. */
export const SCENARIO_COMPONENT_META: Record<
  ScenarioComponent,
  { label: string; code: "Z" | "R" | "E" | "D"; explanation: string }
> = {
  zoning: { label: "토지이용", code: "Z", explanation: "용도지역 적합도 (land-use context)" },
  road: { label: "도로 접근성", code: "R", explanation: "도로 근접 대리지표 (access proxy)" },
  equity: { label: "형평성", code: "E", explanation: "기존 시설 부담 회피 (burden avoidance)" },
  demand: { label: "처리 수요", code: "D", explanation: "1인당 처리 수요 (per-capita demand)" },
};

/** Preset weight sources available in a run, with citizen-facing labels. */
export const SCENARIO_PRESET_LABELS: Record<string, string> = {
  baseline: "기본 가정",
  equal: "균등",
  equity_focused: "형평성 중심",
  access_focused: "접근성 중심",
  critic: "CRITIC 데이터 기반",
};

export const SCENARIO_STORAGE_KEY = "waste-equity:suitability-scenario:v1";
export const SCENARIO_SESSION_SCHEMA = 1;

/** Sum of the four percents (may be ≠ 100 while the user is editing). */
export function draftTotal(percents: ScenarioPercents): number {
  return SCENARIO_COMPONENTS.reduce((acc, c) => acc + percents[c], 0);
}

/** A draft is applicable only when every value is in [0,100] and the total is exactly 100. */
export function isDraftValid(percents: ScenarioPercents): boolean {
  return (
    SCENARIO_COMPONENTS.every(
      (c) => Number.isInteger(percents[c]) && percents[c] >= 0 && percents[c] <= 100,
    ) && draftTotal(percents) === 100
  );
}

/** Difference from 100 (positive = over, negative = under). */
export function totalDifference(percents: ScenarioPercents): number {
  return draftTotal(percents) - 100;
}

/**
 * Canonical 8-dp weight strings from integer percents. Requires a valid total of
 * exactly 100 (each p/100 is exact to 2 dp, so the sum is exactly 1.00000000).
 * Throws on an invalid total rather than silently normalizing.
 */
export function percentsToCanonical(percents: ScenarioPercents): UserScenarioWeights {
  if (!isDraftValid(percents)) {
    throw new Error("percentsToCanonical requires integer percents summing to exactly 100");
  }
  const toStr = (p: number): string => (p / 100).toFixed(8);
  return {
    zoning: toStr(percents.zoning),
    road: toStr(percents.road),
    equity: toStr(percents.equity),
    demand: toStr(percents.demand),
  };
}

/**
 * Deterministic largest-remainder allocation of `total` across the four components
 * proportional to `raw`, producing integers that sum exactly to `total`. Ties in
 * the fractional part break by fixed Z/R/E/D order. Returns null when every raw
 * value is zero (nothing to allocate).
 */
function largestRemainder(raw: number[], total: number): number[] | null {
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  const scaled = raw.map((v) => (v / sum) * total);
  const floored = scaled.map(Math.floor);
  let remainder = total - floored.reduce((a, b) => a + b, 0);
  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floored];
  for (let k = 0; k < remainder && k < order.length; k++) out[order[k].i] += 1;
  // Any residual (only possible from float underflow) goes to the first slot.
  remainder = total - out.reduce((a, b) => a + b, 0);
  if (remainder !== 0) out[0] += remainder;
  return out;
}

/**
 * Explicit "100%로 비율 정규화": rescale the current draft to sum exactly 100.
 * Returns the new percents and whether any value changed, or null when all values
 * are zero (normalization is undefined — the caller must inform the user).
 */
export function normalizePercents(
  percents: ScenarioPercents,
): { percents: ScenarioPercents; changed: boolean } | null {
  const raw = SCENARIO_COMPONENTS.map((c) => percents[c]);
  const allocated = largestRemainder(raw, 100);
  if (allocated === null) return null;
  const next: ScenarioPercents = {
    zoning: allocated[0],
    road: allocated[1],
    equity: allocated[2],
    demand: allocated[3],
  };
  const changed = SCENARIO_COMPONENTS.some((c) => next[c] !== percents[c]);
  return { percents: next, changed };
}

/**
 * Integer percents from a stored decimal weight profile (e.g. {"zoning":"0.35"}),
 * normalized to sum exactly 100 by largest remainder so a preset is always a valid
 * loadable draft. Used only for preset buttons — never fabricates a missing profile.
 */
export function decimalWeightsToPercents(profile: Record<string, string>): ScenarioPercents {
  const raw = SCENARIO_COMPONENTS.map((c) => Number(profile[c] ?? "0") * 100);
  const allocated = largestRemainder(raw, 100) ?? [25, 25, 25, 25];
  return {
    zoning: allocated[0],
    road: allocated[1],
    equity: allocated[2],
    demand: allocated[3],
  };
}

/**
 * Preset weight sources actually available for a run, in a stable order, as
 * loadable integer percents. CRITIC appears only when the run computed it (present
 * in weight_profiles) — never fabricated for old runs.
 */
export function scenarioPresets(
  run: SuitabilityRun | null | undefined,
): { key: string; label: string; percents: ScenarioPercents }[] {
  const profiles = run?.weight_profiles ?? {};
  const order = ["baseline", "equal", "equity_focused", "access_focused", "critic"];
  const out: { key: string; label: string; percents: ScenarioPercents }[] = [];
  for (const key of order) {
    const profile = profiles[key];
    if (!profile) continue;
    out.push({
      key,
      label: SCENARIO_PRESET_LABELS[key] ?? key,
      percents: decimalWeightsToPercents(profile),
    });
  }
  return out;
}

/**
 * Text-first rank movement (never color-only). Examples:
 *   42위 → 18위, 24계단 상승 / 18위 → 42위, 24계단 하락 / 순위 변화 없음.
 * Returns a neutral string when a comparison rank is unavailable.
 */
export function rankMovementText(
  comparisonRank: number | null | undefined,
  customRank: number | null | undefined,
): string {
  if (customRank == null) return "순위 없음";
  if (comparisonRank == null) return `${customRank}위 (비교 순위 없음)`;
  const delta = comparisonRank - customRank;
  if (delta === 0) return "순위 변화 없음";
  const dir = delta > 0 ? "상승" : "하락";
  return `${comparisonRank}위 → ${customRank}위, ${Math.abs(delta)}계단 ${dir}`;
}

// --------------------------------------------------------------------------- //
// Session-only persistence (sessionStorage — never localStorage/cookies/URL).
// --------------------------------------------------------------------------- //

export interface ScenarioSessionState {
  schemaVersion: number;
  runId: number;
  draftPercents: ScenarioPercents;
  appliedPercents: ScenarioPercents | null;
  compareProfile: SuitabilityProfile;
  scenarioHash: string | null;
  selectedCandidateId: number | null;
}

function isPercents(value: unknown): value is ScenarioPercents {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return SCENARIO_COMPONENTS.every(
    (c) => typeof v[c] === "number" && Number.isFinite(v[c] as number),
  );
}

/** Persist scenario UI state for this browser tab only. No-op without sessionStorage. */
export function saveScenarioSession(state: ScenarioSessionState): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full / disabled — session restore is best-effort only */
  }
}

export function clearScenarioSession(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(SCENARIO_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Load + validate stored scenario state for the CURRENT run. Returns null (and the
 * caller ignores/clears it) when the schema is wrong, weights are invalid, the run
 * id changed, or the comparison profile is no longer available — the restored draft
 * is only ever shown after a fresh preview request re-verifies it.
 */
export function loadScenarioSession(
  runId: number,
  availableProfiles: readonly SuitabilityProfile[],
): ScenarioSessionState | null {
  if (typeof sessionStorage === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(SCENARIO_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const s = parsed as Record<string, unknown>;
  if (s.schemaVersion !== SCENARIO_SESSION_SCHEMA) return null;
  if (s.runId !== runId) return null; // active run changed → discard
  if (!isPercents(s.draftPercents)) return null;
  if (s.appliedPercents !== null && !isPercents(s.appliedPercents)) return null;
  if (
    typeof s.compareProfile !== "string" ||
    !availableProfiles.includes(s.compareProfile as SuitabilityProfile)
  ) {
    return null;
  }
  return {
    schemaVersion: SCENARIO_SESSION_SCHEMA,
    runId,
    draftPercents: s.draftPercents as ScenarioPercents,
    appliedPercents: (s.appliedPercents as ScenarioPercents | null) ?? null,
    compareProfile: s.compareProfile as SuitabilityProfile,
    scenarioHash: typeof s.scenarioHash === "string" ? s.scenarioHash : null,
    selectedCandidateId:
      typeof s.selectedCandidateId === "number" ? s.selectedCandidateId : null,
  };
}
