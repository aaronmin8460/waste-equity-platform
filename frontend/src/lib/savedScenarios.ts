/**
 * 저장한 시나리오 — browser-scoped persistence for the Page-4 ④/⑤ sections
 * (Figma 136:8684, 231:442, 231:475; the page-4 기술요청 note 225:443 asks for
 * "local storage").
 *
 * ── WHAT IS PERSISTED, AND WHAT IS DELIBERATELY NOT ──────────────────────────────
 * A saved scenario is a NAMED SET OF WEIGHTS plus the run they were verified
 * against. It is NOT a saved result: no score, no rank, no candidate list, no
 * A/B/C band and no tile hash is written here. Those are analytical outputs of one
 * fixed run, they change whenever the run changes, and a stored copy would go stale
 * silently while still looking authoritative. Page 5 re-derives every number from
 * `POST /api/v1/suitability/scenarios/preview`; this module only remembers what to
 * ask for. Storage is a bookmark, never evidence.
 *
 * ── WHY localStorage AND NOT THE BACKEND ─────────────────────────────────────────
 * There is no user-account or ownership model in this product, so a server-side
 * scenario row would have no owner, no access rule, and no deletion story. The
 * browser is the honest scope for a personal decision-support draft — and it is
 * stated to the reader in the UI (`SAVED_SCENARIO_STORAGE_NOTICE`) rather than
 * implied, because a citizen who saves work deserves to know it lives on one
 * device and dies with the browser's storage.
 *
 * ── WHY A NEW KEY ────────────────────────────────────────────────────────────────
 * `waste-equity:suitability-scenario:v1` (lib/scenario.ts) is a SINGLE in-progress
 * draft in sessionStorage for the existing 후보지 심층 비교 editor. It has a
 * different shape, a different lifetime, and a live consumer. This is a separate,
 * separately-versioned LIST under its own key; neither reads or writes the other.
 *
 * ── WEIGHTS ARE THE REPOSITORY'S CANONICAL ONES ──────────────────────────────────
 * `UserScenarioWeights` — exact Z/R/E/D decimal strings, the same type the preview
 * API takes and returns, the same type `lib/urlState.ts` carries. There is no
 * second weight model here: percents belong to the editor (lib/scenario.ts), and
 * `percentsToCanonical` is the one bridge between them.
 *
 * ── EVERY READ IS DEFENSIVE ──────────────────────────────────────────────────────
 * localStorage is user-writable, survives deploys, and is shared with every other
 * tab. So this module never trusts it: a malformed blob, a wrong schema version, a
 * duplicated id, an out-of-range weight, or a missing run id is DROPPED with a
 * plain-Korean warning, and the page renders the surviving scenarios. Bad stored
 * data must never take Page 4 down — which is exactly what an unguarded
 * `JSON.parse` in a render path would do.
 */

import type { UserScenarioWeights } from "./api";

/** Versioned list key. Deliberately distinct from the sessionStorage draft key. */
export const SAVED_SCENARIOS_STORAGE_KEY = "waste-equity:suitability-saved-scenarios:v1";

/** Bumped only for a shape change that old readers could misread. */
export const SAVED_SCENARIO_SCHEMA_VERSION = 1;

/** Figma 136:8684 shows a `9/15` counter on the name field. */
export const SAVED_SCENARIO_NAME_MAX_LENGTH = 15;

/**
 * How many scenarios one browser may hold. A bound, not a queue: reaching it
 * REFUSES the save and says so. Silently evicting the oldest would delete work a
 * citizen chose to keep, to make room for work they had not yet confirmed.
 */
export const SAVED_SCENARIO_CAP = 20;

/**
 * Id shape. URL-safe by construction, because an id travels in `cmpA`/`cmpB`
 * (lib/urlState.ts imports this). `:` is deliberately excluded so a future
 * official-profile comparison side can use a reserved `profile:` prefix without
 * colliding with any id this module has ever minted (see
 * docs/figma-redesign/PAGE_5_SCENARIO_CONTRACT.md §7).
 */
export const SAVED_SCENARIO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * One canonical weight: a decimal in [0,1] with up to 8 fractional digits — the
 * same screen `lib/urlState.ts` applies to `wz`/`wr`/`we`/`wd`.
 */
const CANONICAL_WEIGHT_RE = /^(0(\.\d{1,8})?|1(\.0{1,8})?)$/;

/** The four components, in the shared Z/R/E/D order. */
const WEIGHT_KEYS = ["zoning", "road", "equity", "demand"] as const;

/**
 * Tolerance on the weight sum. The canonical strings are exact decimals, but they
 * are summed here as binary floats (0.4 + 0.3 + 0.2 + 0.1 = 0.9999999999999999),
 * so an exact `=== 1` test would reject a perfectly valid served profile. This is
 * a SHAPE screen only — the backend's `Decimal` arithmetic is the authority on
 * whether a weight vector is analytically acceptable.
 */
const WEIGHT_SUM_TOLERANCE = 1e-6;

/** Stated to the reader wherever saved scenarios are shown. Not a footnote. */
export const SAVED_SCENARIO_STORAGE_NOTICE =
  "저장한 시나리오는 이 브라우저에만 저장됩니다. 다른 기기나 브라우저에서는 보이지 않으며, " +
  "브라우저 저장 공간을 지우면 사라집니다.";

/** Shown when a scenario was saved against a different analysis run. */
export const SAVED_SCENARIO_OTHER_RUN_NOTICE =
  "다른 분석 실행에서 저장된 시나리오입니다. 현재 실행 기준으로 다시 확인해야 합니다.";

// --------------------------------------------------------------------------- //
// The contract
// --------------------------------------------------------------------------- //

/**
 * One saved scenario.
 *
 * `id` is minted once and NEVER changes — not on rename, not on reselect. It is
 * the identity `cmpA`/`cmpB` point at, so a rename must not invalidate a link a
 * reader already shared.
 *
 * `runId` is the run the weights were verified against by the preview API. It is
 * the whole reason a stored scenario can be checked rather than assumed: a
 * scenario whose `runId` is not the active run is shown, but is not treated as a
 * current result (see {@link scenarioRunState}).
 *
 * `profileSource` records WHICH stored profile the weights were taken from
 * (`"baseline"`, `"critic"`, …) when they came from one, so the saved row can say
 * where its numbers originated. `null` means the weights were not taken from a
 * stored profile. It is provenance only — never a claim that the saved scenario IS
 * that official profile.
 */
export interface SavedScenario {
  schemaVersion: number;
  id: string;
  name: string;
  weights: UserScenarioWeights;
  runId: number;
  profileSource: string | null;
  /** ISO 8601 instants. `createdAt` is frozen; `updatedAt` moves on rename. */
  createdAt: string;
  updatedAt: string;
}

/** What a caller hands in to create one. Id and timestamps are minted here. */
export interface SaveScenarioInput {
  name: string;
  /** Canonical weights, ideally the preview API's own `canonical_weights` echo. */
  weights: UserScenarioWeights;
  /** The run the weights were verified against — the API response's `run_id`. */
  runId: number;
  profileSource?: string | null;
}

/** Why a write was refused. Every one of these is reported, never swallowed. */
export type SavedScenarioWriteFailure =
  | "STORAGE_UNAVAILABLE"
  | "QUOTA_EXCEEDED"
  | "INVALID_NAME_EMPTY"
  | "INVALID_NAME_TOO_LONG"
  | "INVALID_WEIGHTS"
  | "INVALID_RUN"
  | "CAP_REACHED"
  | "NOT_FOUND";

export interface SavedScenarioReadResult {
  scenarios: SavedScenario[];
  /** Plain-Korean notes about entries that were dropped on read. */
  warnings: string[];
}

export type SavedScenarioWriteResult =
  | ({ ok: true; scenario: SavedScenario } & SavedScenarioReadResult)
  | ({ ok: false; reason: SavedScenarioWriteFailure; message: string } & SavedScenarioReadResult);

/** Injection points so tests are deterministic (no wall clock, no random id). */
export interface SaveScenarioOptions {
  now?: string;
  id?: string;
}

// --------------------------------------------------------------------------- //
// Validation — pure, exported, and used by both the storage layer and the UI
// --------------------------------------------------------------------------- //

/** Trim only. Inner spacing is the reader's choice; leading/trailing is noise. */
export function normalizeScenarioName(raw: string): string {
  return raw.trim();
}

/**
 * Name length in CODE POINTS, which is what the `n/15` counter must show: a
 * two-unit character (an emoji) is one character to the person typing it, and
 * `String.length` would charge them twice.
 */
export function scenarioNameLength(raw: string): number {
  return Array.from(raw).length;
}

/** `null` when acceptable. Whitespace-only is EMPTY — it names nothing. */
export function scenarioNameProblem(raw: string): "INVALID_NAME_EMPTY" | "INVALID_NAME_TOO_LONG" | null {
  const name = normalizeScenarioName(raw);
  if (name === "") return "INVALID_NAME_EMPTY";
  if (scenarioNameLength(name) > SAVED_SCENARIO_NAME_MAX_LENGTH) return "INVALID_NAME_TOO_LONG";
  return null;
}

/**
 * Shape screen for a canonical weight vector: exactly the four Z/R/E/D keys, each
 * a decimal string in [0,1] with ≤8 fractional digits, summing to 1 within
 * {@link WEIGHT_SUM_TOLERANCE}. It decides SHAPE, never analytical validity — the
 * preview API does that, and this module is only stopping obvious garbage from
 * reaching it or from being rendered as a weight.
 */
export function isCanonicalWeights(value: unknown): value is UserScenarioWeights {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  let sum = 0;
  for (const key of WEIGHT_KEYS) {
    const raw = record[key];
    if (typeof raw !== "string" || !CANONICAL_WEIGHT_RE.test(raw)) return false;
    sum += Number(raw);
  }
  return Math.abs(sum - 1) <= WEIGHT_SUM_TOLERANCE;
}

/** A run id is a positive integer. `0`, `null` and `NaN` are all "no run". */
function isRunId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Whether a stored scenario belongs to the run currently on screen.
 *
 * `"OTHER_RUN"` is not an error and not a reason to hide the scenario — the
 * weights are still the reader's — but it IS a reason never to present its
 * comparison as current. The caller shows {@link SAVED_SCENARIO_OTHER_RUN_NOTICE}
 * and withholds the A/B selection until the scenario is re-verified against the
 * active run.
 */
export function scenarioRunState(
  scenario: SavedScenario,
  activeRunId: number | null,
): "CURRENT_RUN" | "OTHER_RUN" {
  if (activeRunId === null) return "OTHER_RUN";
  return scenario.runId === activeRunId ? "CURRENT_RUN" : "OTHER_RUN";
}

// --------------------------------------------------------------------------- //
// Parsing — one entry at a time, so one bad row never costs the others
// --------------------------------------------------------------------------- //

function parseScenario(value: unknown): SavedScenario | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== SAVED_SCENARIO_SCHEMA_VERSION) return null;
  if (typeof raw.id !== "string" || !SAVED_SCENARIO_ID_RE.test(raw.id)) return null;
  if (typeof raw.name !== "string") return null;
  const name = normalizeScenarioName(raw.name);
  if (scenarioNameProblem(name) !== null) return null;
  if (!isCanonicalWeights(raw.weights)) return null;
  if (!isRunId(raw.runId)) return null;
  if (typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") return null;
  const weights = raw.weights as UserScenarioWeights;
  return {
    schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION,
    id: raw.id,
    name,
    // Rebuilt key by key so an attacker-supplied extra property on the stored
    // object cannot ride along into the request body sent to the backend.
    weights: {
      zoning: weights.zoning,
      road: weights.road,
      equity: weights.equity,
      demand: weights.demand,
    },
    runId: raw.runId,
    profileSource: typeof raw.profileSource === "string" ? raw.profileSource : null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function storage(): Storage | null {
  // Access itself can throw (Safari private mode, disabled site data), so the
  // read is inside the guard, not just the getItem below it.
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Read + validate the whole list. NEVER throws and never returns `null`: a caller
 * in a render path gets an empty list and a warning, not an exception.
 */
export function readSavedScenarios(): SavedScenarioReadResult {
  const store = storage();
  if (store === null) return { scenarios: [], warnings: [] };

  let raw: string | null;
  try {
    raw = store.getItem(SAVED_SCENARIOS_STORAGE_KEY);
  } catch {
    return { scenarios: [], warnings: ["브라우저 저장 공간을 읽지 못해 저장한 시나리오를 불러오지 못했습니다."] };
  }
  if (raw === null) return { scenarios: [], warnings: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      scenarios: [],
      warnings: ["저장된 시나리오 자료를 읽을 수 없어 표시하지 않았습니다."],
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { scenarios: [], warnings: ["저장된 시나리오 자료를 읽을 수 없어 표시하지 않았습니다."] };
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.schemaVersion !== SAVED_SCENARIO_SCHEMA_VERSION) {
    return {
      scenarios: [],
      warnings: ["저장된 시나리오의 형식이 달라 불러오지 못했습니다."],
    };
  }
  if (!Array.isArray(envelope.scenarios)) {
    return { scenarios: [], warnings: ["저장된 시나리오 자료를 읽을 수 없어 표시하지 않았습니다."] };
  }

  const scenarios: SavedScenario[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let duplicates = 0;
  for (const entry of envelope.scenarios) {
    const scenario = parseScenario(entry);
    if (scenario === null) {
      dropped += 1;
      continue;
    }
    // FIRST occurrence wins. A duplicate id would make rename and delete ambiguous
    // and would let one `cmpA` resolve to two different weight vectors.
    if (seen.has(scenario.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(scenario.id);
    scenarios.push(scenario);
  }

  const warnings: string[] = [];
  if (dropped > 0) warnings.push(`저장된 시나리오 ${dropped}개는 형식이 올바르지 않아 표시하지 않았습니다.`);
  if (duplicates > 0) warnings.push(`같은 번호를 가진 시나리오 ${duplicates}개는 표시하지 않았습니다.`);
  // A stored list longer than the cap (an older build, a hand-edited blob) is
  // SHOWN in full — refusing to display work a reader already saved would be the
  // silent deletion this cap exists to avoid. The cap gates new saves only.
  return { scenarios, warnings };
}

function persist(
  scenarios: SavedScenario[],
): { ok: true } | { ok: false; reason: "STORAGE_UNAVAILABLE" | "QUOTA_EXCEEDED" } {
  const store = storage();
  if (store === null) return { ok: false, reason: "STORAGE_UNAVAILABLE" };
  try {
    store.setItem(
      SAVED_SCENARIOS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION, scenarios }),
    );
    return { ok: true };
  } catch {
    // A write that throws is overwhelmingly a quota rejection. It is reported as
    // such rather than being retried after evicting something: the reader's other
    // scenarios are not this save's to spend.
    return { ok: false, reason: "QUOTA_EXCEEDED" };
  }
}

const FAILURE_MESSAGES: Record<SavedScenarioWriteFailure, string> = {
  STORAGE_UNAVAILABLE: "이 브라우저에서 저장 공간을 사용할 수 없어 시나리오를 저장하지 못했습니다.",
  QUOTA_EXCEEDED:
    "브라우저 저장 공간이 부족해 저장하지 못했습니다. 저장한 시나리오를 일부 삭제한 뒤 다시 시도해 주세요.",
  INVALID_NAME_EMPTY: "시나리오 이름을 입력해 주세요.",
  INVALID_NAME_TOO_LONG: `시나리오 이름은 ${SAVED_SCENARIO_NAME_MAX_LENGTH}자 이내로 입력해 주세요.`,
  INVALID_WEIGHTS: "가중치 값이 올바르지 않아 저장하지 못했습니다.",
  INVALID_RUN: "분석 실행을 확인할 수 없어 저장하지 못했습니다.",
  CAP_REACHED: `저장할 수 있는 시나리오는 최대 ${SAVED_SCENARIO_CAP}개입니다. 기존 시나리오를 삭제한 뒤 저장해 주세요.`,
  NOT_FOUND: "해당 시나리오를 찾을 수 없습니다.",
};

function failure(
  reason: SavedScenarioWriteFailure,
  current: SavedScenarioReadResult,
): SavedScenarioWriteResult {
  return { ok: false, reason, message: FAILURE_MESSAGES[reason], ...current };
}

/**
 * Mint an id. `crypto.randomUUID` where available (every browser this app
 * supports); the fallback is only for exotic/older environments and is still
 * collision-checked against the existing list by the caller below.
 */
function mintId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the non-crypto id below */
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// --------------------------------------------------------------------------- //
// Mutators. Each one re-reads, mutates, persists, and returns the NEW list, so a
// caller never has to guess what the store now holds (another tab may have
// written since the last read).
// --------------------------------------------------------------------------- //

/**
 * Append a scenario. Refuses — with a reason — on an empty/oversized name, a
 * weight vector that fails the shape screen, a missing run id, a full store, or a
 * quota rejection. Nothing is evicted to make room.
 */
export function saveScenario(
  input: SaveScenarioInput,
  options: SaveScenarioOptions = {},
): SavedScenarioWriteResult {
  const current = readSavedScenarios();
  const nameProblem = scenarioNameProblem(input.name);
  if (nameProblem !== null) return failure(nameProblem, current);
  if (!isCanonicalWeights(input.weights)) return failure("INVALID_WEIGHTS", current);
  if (!isRunId(input.runId)) return failure("INVALID_RUN", current);
  if (current.scenarios.length >= SAVED_SCENARIO_CAP) return failure("CAP_REACHED", current);

  const taken = new Set(current.scenarios.map((scenario) => scenario.id));
  let id = options.id ?? mintId();
  // A collision (or a caller-supplied id that is already in use) must not
  // overwrite an existing scenario, so a fresh id is minted until one is free.
  let attempts = 0;
  while ((taken.has(id) || !SAVED_SCENARIO_ID_RE.test(id)) && attempts < 8) {
    id = mintId();
    attempts += 1;
  }
  if (taken.has(id) || !SAVED_SCENARIO_ID_RE.test(id)) return failure("STORAGE_UNAVAILABLE", current);

  const now = options.now ?? new Date().toISOString();
  const scenario: SavedScenario = {
    schemaVersion: SAVED_SCENARIO_SCHEMA_VERSION,
    id,
    name: normalizeScenarioName(input.name),
    weights: {
      zoning: input.weights.zoning,
      road: input.weights.road,
      equity: input.weights.equity,
      demand: input.weights.demand,
    },
    runId: input.runId,
    profileSource: input.profileSource ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const next = [...current.scenarios, scenario];
  const written = persist(next);
  if (!written.ok) return failure(written.reason, current);
  return { ok: true, scenario, scenarios: next, warnings: current.warnings };
}

/**
 * Rename in place. The id, the weights, the run and `createdAt` are carried over
 * untouched — only `name` and `updatedAt` move. A rename is never implemented as
 * delete-then-create, because that would mint a new id and break every `cmpA`
 * /`cmpB` link already pointing at the scenario.
 */
export function renameSavedScenario(
  id: string,
  name: string,
  options: { now?: string } = {},
): SavedScenarioWriteResult {
  const current = readSavedScenarios();
  const nameProblem = scenarioNameProblem(name);
  if (nameProblem !== null) return failure(nameProblem, current);
  const index = current.scenarios.findIndex((scenario) => scenario.id === id);
  if (index === -1) return failure("NOT_FOUND", current);

  const renamed: SavedScenario = {
    ...current.scenarios[index],
    name: normalizeScenarioName(name),
    updatedAt: options.now ?? new Date().toISOString(),
  };
  const next = [...current.scenarios];
  next[index] = renamed;
  const written = persist(next);
  if (!written.ok) return failure(written.reason, current);
  return { ok: true, scenario: renamed, scenarios: next, warnings: current.warnings };
}

/**
 * Remove one scenario. The caller is responsible for clearing any A/B slot that
 * pointed at it — {@link resolveComparisonPair} reports such a slot as `MISSING`
 * so a dangling `cmpA`/`cmpB` can never render as a silent empty comparison.
 */
export function deleteSavedScenario(id: string): SavedScenarioWriteResult {
  const current = readSavedScenarios();
  const index = current.scenarios.findIndex((scenario) => scenario.id === id);
  if (index === -1) return failure("NOT_FOUND", current);
  const removed = current.scenarios[index];
  const next = current.scenarios.filter((scenario) => scenario.id !== id);
  const written = persist(next);
  if (!written.ok) return failure(written.reason, current);
  return { ok: true, scenario: removed, scenarios: next, warnings: current.warnings };
}

/** Remove every saved scenario. Used by tests and by an explicit reader action. */
export function clearSavedScenarios(): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(SAVED_SCENARIOS_STORAGE_KEY);
  } catch {
    /* nothing to do — the list is already unreadable */
  }
}

// --------------------------------------------------------------------------- //
// ⑤ 비교할 시나리오 선택 — A/B resolution
// --------------------------------------------------------------------------- //

export type ComparisonSlot = "A" | "B";

/**
 * `EMPTY`    — no id requested for this slot.
 * `RESOLVED` — the id names a scenario that is present in this browser.
 * `MISSING`  — an id WAS requested and nothing in storage matches it. This is an
 *              explicit state, never a silent empty slot: a shared `cmpA` link
 *              opened on another device lands here, and the reader is told so
 *              rather than shown an empty A안 that looks like their own doing.
 */
export type ComparisonSlotState = "EMPTY" | "RESOLVED" | "MISSING";

export interface ComparisonSlotResolution {
  slot: ComparisonSlot;
  id: string | null;
  scenario: SavedScenario | null;
  state: ComparisonSlotState;
}

export interface ComparisonResolution {
  a: ComparisonSlotResolution;
  b: ComparisonSlotResolution;
  /** How many slots hold a real scenario — the `(선택 N/2개)` counter. */
  selectedCount: number;
  /** Both slots resolved to two DISTINCT scenarios. */
  complete: boolean;
}

function resolveSlot(
  slot: ComparisonSlot,
  id: string | null,
  scenarios: readonly SavedScenario[],
): ComparisonSlotResolution {
  if (id === null) return { slot, id: null, scenario: null, state: "EMPTY" };
  const scenario = scenarios.find((candidate) => candidate.id === id) ?? null;
  return { slot, id, scenario, state: scenario === null ? "MISSING" : "RESOLVED" };
}

/**
 * Resolve the two selected ids against the saved list.
 *
 * `complete` requires two DIFFERENT resolved scenarios. Comparing a scenario with
 * itself is not a comparison, and the CTA that consumes this must stay disabled
 * for it — the distinctness rule is enforced here (and again by the URL decoder)
 * rather than being left to the button's own bookkeeping.
 */
export function resolveComparisonPair(
  scenarios: readonly SavedScenario[],
  aId: string | null,
  bId: string | null,
): ComparisonResolution {
  const a = resolveSlot("A", aId, scenarios);
  const b = resolveSlot("B", bId, scenarios);
  const selectedCount = (a.scenario ? 1 : 0) + (b.scenario ? 1 : 0);
  return {
    a,
    b,
    selectedCount,
    complete: a.scenario !== null && b.scenario !== null && a.scenario.id !== b.scenario.id,
  };
}
