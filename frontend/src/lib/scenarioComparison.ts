/**
 * 후보지 심층 비교 — THE canonical A/B comparison model for Page 5.
 *
 * Page 4D produces a *question* (two named weight vectors and the run they were
 * verified against, docs/figma-redesign/PAGE_5_SCENARIO_CONTRACT.md). This module
 * is the one place that turns that question into an *answer shape*, so every Page-5
 * section reads the same resolved pair instead of re-parsing storage, re-reading
 * `cmpA`/`cmpB`, or issuing its own preview request.
 *
 * ── THE RULE EVERYTHING FOLLOWS FROM ─────────────────────────────────────────────
 * Storage is a bookmark, not evidence. A `SavedScenario` carries weights, a name
 * and the run they were verified against — never a score, a rank or a band. So the
 * required order is fixed and each arrow can fail with its own nameable state:
 *
 *   resolve cmpA/cmpB  →  verify the run  →  re-preview through the API  →  display
 *
 * The values shown to a reader come from step 3's response. `SavedScenario.weights`
 * is what is *sent*; `UserScenarioPreview.canonical_weights` is what is *shown*.
 * The two are usually equal — Page 4D already stored the server's echo — but the
 * client never gets to decide that, because canonicalisation is the backend's.
 *
 * ── NOTHING DERIVED HERE IS PERSISTED ────────────────────────────────────────────
 * A {@link ScenarioComparison} is runtime state: localStorage metadata + the run on
 * screen + two preview responses. It is never written to localStorage, never folded
 * back into a `SavedScenario`, and never encoded into the URL. A reload recomputes
 * it — which is the entire reason the run id is the thing that gets stored.
 *
 * ── PAGE 5 IS A HISTORICAL-MODEL PAGE, AND THAT IS THE CONTRACT ──────────────────
 * User-weight scenarios exist for the historical Z/R/E/D component model ONLY. The
 * Successor-V3 model scores runs but serves no scenario: it has no approved weight
 * vector or normalization strategy for recombination, so the backend refuses with
 * `COMPONENT_MODEL_SCENARIOS_UNAVAILABLE` rather than returning a fabricated
 * result (`SUITABILITY_V3_FINAL_POLICY.md`; `api/routes/suitability_scenarios.py`
 * `_assert_scenario_model_supported`). Z/R/E/D here is therefore CORRECT, not
 * legacy — it is the only component set this page can ever be asked about.
 *
 * ── NO NEW ANALYTICS ─────────────────────────────────────────────────────────────
 * This module derives no score, no rank, no band, no threshold and no pass/fail. It
 * resolves, it validates, it labels states, and it formats two already-served weight
 * vectors side by side. Screening remains rule-based and independent of scenario
 * reweighting; A/B/C remains relative presentation grading.
 *
 * React-free on purpose: `lib/` is the pure, directly-testable layer. The hook that
 * performs the two requests lives in
 * `components/suitability/useScenarioComparison.ts`.
 */

import type { SuitabilityProfile, UserScenarioPreview, UserScenarioWeights } from "./api";
import { COMPONENT_META, COMPONENT_ORDER, plainError, type ScoreComponent } from "./glossary";
import type { ComparisonResolution, ComparisonSlot, SavedScenario } from "./savedScenarios";
import {
  COMPONENT_MODEL_HISTORICAL,
  COMPONENT_MODEL_SUCCESSOR,
  SUCCESSOR_COMPONENT_ORDER,
  type ComponentModelVersion,
} from "./componentModelWeights";
import { V3_COMPONENT_META, type V3Component } from "./suitabilityV3";
import { scenarioRunState } from "./savedScenarios";

// --------------------------------------------------------------------------- //
// Frozen request parameters — the same for BOTH sides, always
// --------------------------------------------------------------------------- //

/**
 * The comparison profile both sides are previewed against.
 *
 * Page 5 compares A against B, not against a profile, so this only determines the
 * `comparison_score` / `rank_delta` fields the response carries alongside the
 * scenario's own numbers. It is pinned to the official reference basis and is
 * IDENTICAL for A and B — a differing `compare_profile` between the two sides would
 * silently make the two responses' comparison columns describe different baselines,
 * which is precisely the kind of asymmetry an A/B screen must not have.
 */
export const SCENARIO_COMPARISON_COMPARE_PROFILE: SuitabilityProfile = "baseline";

/**
 * How many ranked candidates each side's preview returns.
 *
 * 50 is the endpoint's documented maximum (`schemas/scenario.py`: `ge=1, le=50`).
 * It is requested once per side by the foundation so the later Page-5 sections
 * (rank-change, comparison table) read ONE loaded response instead of re-requesting
 * with a wider `top_n`: a rank *change* needs a candidate to appear in both sides'
 * lists, and two top-10 lists of a reweighted ranking intersect poorly. Page 5A
 * itself displays none of these rows.
 */
export const SCENARIO_COMPARISON_TOP_N = 50;

// --------------------------------------------------------------------------- //
// The model
// --------------------------------------------------------------------------- //

/**
 * Why one side of the comparison is, or is not, usable.
 *
 * `EMPTY` and `MISSING` are deliberately NOT merged. "You have not chosen a B안"
 * and "the B안 in this link is not in this browser" are different facts about the
 * reader's situation and have different recoveries, and collapsing them would make
 * a shared link look like an unfinished selection.
 *
 * `OTHER_RUN` is not an error: the weights are the reader's and are shown. It is
 * the *comparison* that is withheld, because a scenario verified against a
 * different frozen run is not measuring the same thing as the run on screen.
 */
export type ComparisonSideState =
  | "READY"
  | "LOADING"
  | "EMPTY"
  | "MISSING"
  | "OTHER_RUN"
  | "PREVIEW_ERROR"
  /** The run on screen could not be loaded, so this side could not be checked. */
  | "RUN_UNKNOWN"
  /**
   * The scenario was authored over a DIFFERENT component model from the one this
   * comparison runs on.
   *
   * A legacy Z/R/E/D scenario opened on a successor comparison lands here. It is not
   * an error and not a missing scenario — the saved vector is perfectly valid, just
   * over a namespace whose four components are different measurements. Recombining
   * it here would rename `road` to `resident_impact` by position, which is the one
   * translation the component-model contract forbids outright. So it is surfaced as
   * incompatible and the reader is asked to save a new one.
   */
  | "OTHER_MODEL";

/**
 * The run the comparison is validated against, and whether it is known YET.
 *
 * The distinction is load-bearing. `scenarioRunState` treats an unknown run as
 * `OTHER_RUN` — correctly, because an unknown run must never be assumed to match —
 * but "we do not know the run yet" is NOT "your scenario is from a different run".
 * Collapsing the two would make every reader see, for the first frame of every
 * visit, a warning that both of their scenarios were saved against the wrong run.
 */
export type ActiveRunResolution =
  | { state: "LOADING" }
  | { state: "ERROR" }
  | { state: "RESOLVED"; runId: number };

/** The run resolution from the page's `run` / `runError` pair. */
export function activeRunResolution(
  runId: number | null,
  runError: string | null,
): ActiveRunResolution {
  if (runId !== null) return { state: "RESOLVED", runId };
  return runError !== null ? { state: "ERROR" } : { state: "LOADING" };
}

/**
 * One side of the comparison — the shape Page 5B and Page 5C consume.
 *
 * `canonicalWeights`, `runId` and `preview` are the SERVER's, and are non-null only
 * when `state === "READY"`. `savedScenario` is the stored bookmark and is non-null
 * whenever the id resolved in this browser, including in the `OTHER_RUN` and
 * `PREVIEW_ERROR` states — a reader whose preview failed should still see which
 * scenario failed.
 */
export interface ComparisonSide {
  slot: ComparisonSlot;
  /** The requested id, exactly as it appeared in `cmpA`/`cmpB`. */
  scenarioId: string | null;
  /** The stored name. Never derived from the preview — the API does not name it. */
  scenarioName: string | null;
  savedScenario: SavedScenario | null;
  /** `preview.canonical_weights`, never `savedScenario.weights`. */
  canonicalWeights: UserScenarioWeights | null;
  /** `preview.run_id`, never `savedScenario.runId`. */
  runId: number | null;
  preview: UserScenarioPreview | null;
  state: ComparisonSideState;
  /** Citizen-facing Korean, present only when `state === "PREVIEW_ERROR"`. */
  errorMessage: string | null;
}

/**
 * The overall state of the foundation.
 *
 * The per-side `state` is the primary truth; this is the derived summary the shell
 * and the tests switch on. `MIXED` exists so two sides failing for DIFFERENT reasons
 * are never flattened into one vague error — the reader is still told, per side,
 * exactly which of the four problems they have.
 */
export type ScenarioComparisonStatus =
  | "LOADING"
  | "READY"
  /** The run on screen is not known yet, so nothing can be validated against it. */
  | "NO_RUN"
  /** At least one slot carries no id at all. */
  | "INCOMPLETE_SELECTION"
  /** Both slots name the same scenario. A scenario compared with itself is not a comparison. */
  | "DUPLICATE_SELECTION"
  | "MISSING_A"
  | "MISSING_B"
  | "MISSING_BOTH"
  | "OTHER_RUN_A"
  | "OTHER_RUN_B"
  | "OTHER_RUN_BOTH"
  | "PREVIEW_ERROR_A"
  | "PREVIEW_ERROR_B"
  | "PREVIEW_ERROR_BOTH"
  /** A and B are each blocked, for different reasons. Both are still named per side. */
  | "MIXED";

/**
 * The canonical Page-5 comparison. `runId` is the ACTIVE run both sides were
 * validated and previewed against — not either scenario's stored run id, which is
 * exactly the value the `OTHER_RUN` check compares against.
 */
export interface ScenarioComparison {
  /**
   * The component model this comparison ran on.
   *
   * Carried on the result, not only used to build it, because a detached artifact —
   * an exported workbook — has no screen around it to say which four measurements
   * its columns are.
   */
  componentModelVersion: ComponentModelVersion;
  runId: number | null;
  sideA: ComparisonSide;
  sideB: ComparisonSide;
  status: ScenarioComparisonStatus;
  /** True while either side's preview is in flight. */
  loading: boolean;
}

/** What the loader reports back for one side once its request has settled. */
export interface ComparisonSideOutcome {
  preview: UserScenarioPreview | null;
  /** Set instead of `preview` when the request was refused or failed. */
  errorMessage: string | null;
}

// --------------------------------------------------------------------------- //
// Intent
// --------------------------------------------------------------------------- //

/**
 * Whether this URL is asking for an A/B comparison at all.
 *
 * ONE id is enough. A lone `cmpA` is a real, legal state (the encoder writes the two
 * slots independently), and answering it with the legacy weight editor would silently
 * drop the reader's half-made selection instead of telling them B안 is still needed.
 *
 * With NO id in either slot there is no comparison intent, and Page 5 keeps its
 * pre-existing 시나리오 실험실 behaviour — including every legacy
 * `wz`/`wr`/`we`/`wd`/`cmpProfile`/`cand` link, none of which carries a `cmp` id.
 */
export function hasComparisonIntent(cmpA: string | null, cmpB: string | null): boolean {
  return cmpA !== null || cmpB !== null;
}

// --------------------------------------------------------------------------- //
// Step 1–2: what a side needs before a preview may even be attempted
// --------------------------------------------------------------------------- //

/**
 * The blocking state of one slot BEFORE any request, or `null` when the side is
 * cleared to be previewed. This is steps 1 and 2 of the required flow, and it is
 * what the loader keys on: a blocked side is never sent to the API.
 */
export function comparisonSideBlock(
  scenario: SavedScenario | null,
  requestedId: string | null,
  activeRunId: number | null,
  /**
   * The component model this comparison runs on. A scenario authored over another
   * model is blocked rather than recombined — see `OTHER_MODEL`. Omitted keeps the
   * previous behaviour for any caller that has not been migrated.
   */
  componentModelVersion?: ComponentModelVersion,
): Extract<ComparisonSideState, "EMPTY" | "MISSING" | "OTHER_RUN" | "OTHER_MODEL"> | null {
  if (requestedId === null) return "EMPTY";
  if (scenario === null) return "MISSING";
  // `activeRunId === null` resolves to OTHER_RUN inside `scenarioRunState`: an
  // unknown run is not a matching run, and must never be assumed to be one.
  if (scenarioRunState(scenario, activeRunId) === "OTHER_RUN") return "OTHER_RUN";
  if (
    componentModelVersion !== undefined &&
    scenario.componentModelVersion !== componentModelVersion
  ) {
    return "OTHER_MODEL";
  }
  return null;
}

// --------------------------------------------------------------------------- //
// Assembly
// --------------------------------------------------------------------------- //

function buildSide(
  slot: ComparisonSlot,
  requestedId: string | null,
  scenario: SavedScenario | null,
  run: ActiveRunResolution,
  outcome: ComparisonSideOutcome | null,
  componentModelVersion: ComponentModelVersion = COMPONENT_MODEL_HISTORICAL,
): ComparisonSide {
  const base = {
    slot,
    scenarioId: requestedId,
    scenarioName: scenario?.name ?? null,
    savedScenario: scenario,
    canonicalWeights: null,
    runId: null,
    preview: null,
    errorMessage: null,
  } as const;

  // Both are knowable WITHOUT the run, so they are answered immediately rather
  // than being held behind a run request they do not depend on.
  if (requestedId === null) return { ...base, state: "EMPTY" };
  if (scenario === null) return { ...base, state: "MISSING" };

  // Beyond this point the run is required: whether this scenario belongs to the run
  // on screen is the next question, and it has no answer until the run has one.
  if (run.state === "LOADING") return { ...base, state: "LOADING" };
  if (run.state === "ERROR") return { ...base, state: "RUN_UNKNOWN" };

  const block = comparisonSideBlock(scenario, requestedId, run.runId, componentModelVersion);
  if (block !== null) return { ...base, state: block };

  // Cleared for preview but nothing has come back yet.
  if (outcome === null) return { ...base, state: "LOADING" };

  if (outcome.preview === null) {
    return {
      ...base,
      state: "PREVIEW_ERROR",
      errorMessage: outcome.errorMessage ?? PREVIEW_FAILED_MESSAGE,
    };
  }

  // ── The component model must be the one these weights are DEFINED OVER ──────
  // The backend refuses a scenario on any non-historical model before it computes
  // anything (`COMPONENT_MODEL_SCENARIOS_UNAVAILABLE`), so this should be
  // unreachable. It is checked anyway because the failure it prevents is silent
  // and total: `canonical_weights` is keyed by the RUN's own components, so a
  // successor preview would carry existing_burden / air_impact_proxy /
  // resident_impact / land_conversion, and every Z/R/E/D lookup on this page would
  // read `undefined` — printing one model's numbers under another model's four
  // labels rather than failing. A wrong-model comparison is not a comparison.
  // …and the model it must match is the one this comparison RUNS ON, not a fixed
  // historical constant. The guard's purpose is unchanged — a preview from another
  // model would carry another namespace's components, and every lookup on this page
  // would read `undefined`, printing one model's numbers under another's labels.
  if (outcome.preview.component_model_version !== componentModelVersion) {
    return {
      ...base,
      state: "PREVIEW_ERROR",
      errorMessage: plainError("COMPONENT_MODEL_SCENARIOS_UNAVAILABLE").primary,
    };
  }

  return {
    ...base,
    // The SERVER's canonicalisation and the SERVER's run id. The stored copies are
    // not read here even though they are usually identical — the whole point of the
    // revalidation step is that the client does not get to decide.
    canonicalWeights: outcome.preview.canonical_weights,
    runId: outcome.preview.run_id,
    preview: outcome.preview,
    state: "READY",
  };
}

/** Fallback when a rejection carried no usable backend detail. */
export const PREVIEW_FAILED_MESSAGE =
  "이 시나리오를 현재 분석 실행에 다시 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.";

function summarise(
  sideA: ComparisonSide,
  sideB: ComparisonSide,
  run: ActiveRunResolution,
  duplicate: boolean,
): ScenarioComparisonStatus {
  if (sideA.state === "LOADING" || sideB.state === "LOADING") return "LOADING";

  // BEFORE the READY check, not after: one scenario in both slots previews
  // perfectly well — twice, identically — so a duplicate that reached this far
  // would otherwise be reported as a valid comparison of a thing with itself.
  if (duplicate) return "DUPLICATE_SELECTION";

  if (sideA.state === "READY" && sideB.state === "READY") return "READY";

  // Nothing can be validated against a run that failed to load, and blaming the
  // reader's scenarios for it would be a false diagnosis.
  if (run.state === "ERROR") return "NO_RUN";

  const states = [sideA.state, sideB.state];
  if (states.includes("EMPTY")) return "INCOMPLETE_SELECTION";

  const both = sideA.state === sideB.state;
  if (both && sideA.state === "MISSING") return "MISSING_BOTH";
  if (both && sideA.state === "OTHER_RUN") return "OTHER_RUN_BOTH";
  if (both && sideA.state === "PREVIEW_ERROR") return "PREVIEW_ERROR_BOTH";

  // Exactly one side is blocked (the other is READY): name the side and the reason.
  if (sideB.state === "READY") {
    if (sideA.state === "MISSING") return "MISSING_A";
    if (sideA.state === "OTHER_RUN") return "OTHER_RUN_A";
    if (sideA.state === "PREVIEW_ERROR") return "PREVIEW_ERROR_A";
  }
  if (sideA.state === "READY") {
    if (sideB.state === "MISSING") return "MISSING_B";
    if (sideB.state === "OTHER_RUN") return "OTHER_RUN_B";
    if (sideB.state === "PREVIEW_ERROR") return "PREVIEW_ERROR_B";
  }

  // Both blocked, for different reasons. Each side still carries its own state, so
  // nothing is lost — this only says "there is no single sentence for both".
  return "MIXED";
}

/**
 * Assemble the canonical comparison from the resolved pair, the active run, and the
 * two settled (or not-yet-settled) preview outcomes.
 *
 * Pure: it performs no request, touches no storage, and reads no clock. `outcomes.a`
 * / `outcomes.b` are `null` while that side's request is in flight, which is what
 * makes a per-side loading state observable rather than a single page-wide spinner.
 */
export function buildScenarioComparison(
  resolution: ComparisonResolution,
  run: ActiveRunResolution,
  outcomes: { a: ComparisonSideOutcome | null; b: ComparisonSideOutcome | null },
  /** The component model this comparison runs on. Both sides are held to it. */
  componentModelVersion: ComponentModelVersion = COMPONENT_MODEL_HISTORICAL,
): ScenarioComparison {
  const sideA = buildSide("A", resolution.a.id, resolution.a.scenario, run, outcomes.a, componentModelVersion);
  const sideB = buildSide("B", resolution.b.id, resolution.b.scenario, run, outcomes.b, componentModelVersion);
  // The URL decoder already drops a `cmpB` equal to `cmpA`, and Page 4D refuses to
  // assign one scenario to both slots. This is the third guard, on the value that
  // actually reaches the screen, because neither of those two runs on a hand-typed
  // URL that reached this component through some other path.
  const duplicate =
    resolution.a.id !== null && resolution.b.id !== null && resolution.a.id === resolution.b.id;

  return {
    runId: run.state === "RESOLVED" ? run.runId : null,
    componentModelVersion,
    sideA,
    sideB,
    status: summarise(sideA, sideB, run, duplicate),
    loading: sideA.state === "LOADING" || sideB.state === "LOADING",
  };
}

// --------------------------------------------------------------------------- //
// Weight comparison rows — over whichever model's components
// --------------------------------------------------------------------------- //

/**
 * One factor's A/B weights, ready to lay out.
 *
 * ── ROUNDING ─────────────────────────────────────────────────────────────────────
 * `aPercent`/`bPercent` are the served decimals rounded to whole percent — the
 * repo-wide presentation of a weight (`lib/suitability.ts` `weightPercent`). The
 * delta is then the difference of THOSE TWO DISPLAYED NUMBERS, not of the raw
 * decimals, so the column a reader can subtract by eye always subtracts to what is
 * printed. The exact served strings are carried through untouched in `aWeight` /
 * `bWeight` and are shown in the precise-value disclosure.
 *
 * ── THE FOUR FACTORS ARE THE MODEL'S ─────────────────────────────────────────────
 * `COMPONENT_ORDER` / `COMPONENT_META` — 용도지역 호환성(Z), 도로 근접성 대리지표(R),
 * 기존 지역 부담(E), 폐기물 처리 수요(D). Page 5 renames nothing: a weight table that
 * relabelled E as "시설 부담 정도" would invert its direction, and D is present-day
 * served demand, not a future-generation forecast.
 */
export interface ComparisonWeightRow {
  /** The component name in ITS OWN model's namespace — historical OR successor. */
  component: string;
  /** "용도지역 호환성", from the central glossary. */
  label: string;
  /** "Z" | "R" | "E" | "D" for the historical model; empty for the successor, whose
   *  components have no single-letter code. Only ever rendered next to `label`. */
  code: string;
  /** The exact served decimal strings, unrounded. `null` when that side is not READY. */
  aWeight: string | null;
  bWeight: string | null;
  /** Whole percent, or `null` when that side has no served weight. */
  aPercent: number | null;
  bPercent: number | null;
  /** `bPercent - aPercent` in percentage points; `null` unless BOTH sides are served. */
  deltaPercentPoints: number | null;
}

function percentOf(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * The four rows of the A/B weight table, in the shared Z/R/E/D order.
 *
 * Both arguments are the SERVER's `canonical_weights`; a side that is not `READY`
 * passes `null` and renders as unavailable rather than as `0%` — a missing weight is
 * never a fabricated zero.
 */
export function comparisonWeightRows(
  aWeights: UserScenarioWeights | null,
  bWeights: UserScenarioWeights | null,
  /**
   * The component model both vectors are defined over.
   *
   * Without it this walked the historical Z/R/E/D glossary unconditionally, so a
   * successor comparison printed four historical factor names with empty values —
   * the reader's own weights labelled as measurements they never chose. Defaulted to
   * historical so any unmigrated caller is unchanged.
   */
  componentModelVersion: ComponentModelVersion = COMPONENT_MODEL_HISTORICAL,
): ComparisonWeightRow[] {
  const successor = componentModelVersion === COMPONENT_MODEL_SUCCESSOR;
  const components = successor
    ? SUCCESSOR_COMPONENT_ORDER
    : (COMPONENT_ORDER as readonly string[]);
  return components.map((component) => {
    const meta = successor
      ? {
          // The successor components have no single-letter code; the label carries
          // the whole identity, so the code slot stays empty rather than borrowing
          // a Z/R/E/D letter that means something else.
          primary: V3_COMPONENT_META[component as V3Component].label,
          code: "",
        }
      : COMPONENT_META[component as ScoreComponent];
    const aWeight = aWeights?.[component] ?? null;
    const bWeight = bWeights?.[component] ?? null;
    const aPercent = percentOf(aWeight ?? undefined);
    const bPercent = percentOf(bWeight ?? undefined);
    return {
      component,
      label: meta.primary,
      code: meta.code,
      aWeight,
      bWeight,
      aPercent,
      bPercent,
      deltaPercentPoints:
        aPercent === null || bPercent === null ? null : bPercent - aPercent,
    };
  });
}

/** `+15%p` / `-10%p` / `변화 없음`. `null` when the delta is not computable. */
export function formatWeightDelta(deltaPercentPoints: number | null): string | null {
  if (deltaPercentPoints === null) return null;
  if (deltaPercentPoints === 0) return "변화 없음";
  return `${deltaPercentPoints > 0 ? "+" : "−"}${Math.abs(deltaPercentPoints)}%p`;
}
