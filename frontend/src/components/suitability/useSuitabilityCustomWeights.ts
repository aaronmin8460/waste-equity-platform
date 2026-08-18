"use client";

/**
 * ② 계산 모델 가중치 설정 — the 사용자 지정 (Custom) weight editor's state machine.
 *
 * Figma authority: `356:582` "계산 모델 가중치 설정 (펼침 예시)", which draws, per
 * factor, `가중치 설정 [ __ ] %` over a four-segment weight bar; and `231:442`, whose
 * saved-scenario list shows NON-preset vectors (`… 30% · 20% · 30% · 20%`), which can
 * only exist if the reader authors them.
 *
 * ── THE EDITOR IS NOT COSMETIC ───────────────────────────────────────────────────
 * An applied vector goes to `POST /suitability/scenarios/preview`, the SAME endpoint
 * 후보지 심층 비교 and ④ 시나리오 저장 already use. The response then drives, on
 * Page 4: ③'s ranking rows and their scores, the map's vector-tile source
 * (`userScenarioTileUrl`, whose canonical weights are in the URL), and the vector ④
 * saves for an A/B comparison. Nothing is recomputed in the browser — see
 * `lib/customWeightRanking.ts`.
 *
 * ── PERCENTS IN, EXACT DECIMALS OUT ──────────────────────────────────────────────
 * The editor works in INTEGER percents, which is what makes the backend's rule
 * satisfiable by construction. `analysis/suitability/scenario.py` requires the
 * canonical 8-dp sum to equal exactly `Decimal("1.00000000")` and states that invalid
 * weights are *"never silently normalized, replaced with equal weights, or have a
 * remainder redistributed"*. Each integer p maps to `(p/100).toFixed(8)`, which is
 * exact at two decimal places, so four integers totalling exactly 100 always produce
 * four 8-dp strings totalling exactly 1.00000000 — no float drift can occur, because
 * no fractional percent is ever representable in the editor.
 *
 * That is why {@link SuitabilityCustomWeights.canApply} gates on
 * `isDraftValid` (every value an integer in 0–100 AND the total exactly 100) and why
 * `percentsToCanonical` THROWS rather than repairing: this module refuses an invalid
 * total in exactly the way the backend refuses it, instead of quietly making one up
 * and sending a vector the reader did not choose.
 *
 * All four helpers are the ones `lib/scenario.ts` already owns for 후보지 심층 비교's
 * editor. There is deliberately no second copy of the weight maths in this product.
 *
 * ── PRESET → CUSTOM IS DETECTED, NOT DECLARED ────────────────────────────────────
 * `source` starts as the active 점수 반영 기준 (a preset). Any edit to any factor
 * moves it to `custom` — the reader does not have to select a mode first. Selecting a
 * preset again (the profile radios, or the 사용자 지정 pill's sibling) reloads that
 * preset's served vector and returns `source` to `preset`. A vector that happens to
 * equal a preset is still `custom` if the reader typed it: the state records where the
 * numbers CAME FROM, which is what the ④ save card labels them with.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  previewUserWeightScenario,
  type SuitabilityProfile,
  type SuitabilityRun,
  type UserScenarioPreview,
  type UserScenarioWeights,
} from "../../lib/api";
import { CUSTOM_SCENARIO_TOP_N } from "../../lib/customWeightRanking";
import {
  SCOPE_ALL,
  scopeKey,
  scopeToQuery,
  type SuitabilityScope,
} from "../../lib/suitabilityScope";
import {
  SCENARIO_COMPONENTS,
  decimalWeightsToPercents,
  draftTotal,
  isDraftValid,
  percentsToCanonical,
  totalDifference,
  type ScenarioComponent,
  type ScenarioPercents,
} from "../../lib/scenario";

/** Where the numbers currently in the editor came from. */
export type WeightSource =
  | { kind: "preset"; profile: SuitabilityProfile }
  | { kind: "custom" };

/** A vector the backend has accepted and canonicalised for this run. */
export interface AppliedCustomWeights {
  runId: number;
  /** The backend's OWN canonical 8-dp echo — never the client's copy. */
  weights: UserScenarioWeights;
  scenarioHash: string;
  scenarioHashShort: string;
  /** The percents the reader typed, kept so the editor can show what is applied. */
  percents: ScenarioPercents;
  /** The 범위 this vector was ranked within, carried so the map tiles match it. */
  scope: SuitabilityScope;
}

export interface SuitabilityCustomWeights {
  /** The editor's current values, always integers in 0–100. */
  percents: ScenarioPercents;
  setPercent: (component: ScenarioComponent, percent: number) => void;
  source: WeightSource;
  isCustom: boolean;
  /** Sum of the four values; 100 exactly when applicable. */
  total: number;
  /** `total − 100`; 0 when valid. Positive = over, negative = under. */
  difference: number;
  /** Every value an integer in 0–100 AND the total exactly 100. */
  valid: boolean;
  /** Valid, a run is known, and the vector is not already the applied one. */
  canApply: boolean;
  applying: boolean;
  /** The backend's own refusal message, or a plain one. Never a silent repair. */
  error: string | null;
  applied: AppliedCustomWeights | null;
  preview: UserScenarioPreview | null;
  apply: () => void;
  /** Return to the active 점수 반영 기준's served vector and drop the applied scenario. */
  reset: () => void;
  /** Mark the current values as 사용자 지정 without changing them. */
  selectCustom: () => void;
}

/** The served weights for one profile on THIS run — the same resolution card ② uses. */
function servedPercents(
  run: SuitabilityRun | null,
  policyProfiles: Record<string, Record<string, string>> | undefined,
  profile: SuitabilityProfile,
): ScenarioPercents {
  const served = (run?.weight_profiles ?? {})[profile] ?? policyProfiles?.[profile];
  // No served vector for this profile on this run: an equal split is the only
  // neutral starting point, and it is never presented as the run's own weights —
  // the editor opens on `preset` and the card prints the profile's served weights
  // separately, so a fabricated vector cannot be mistaken for a served one.
  if (served === undefined) return { zoning: 25, road: 25, equity: 25, demand: 25 };
  return decimalWeightsToPercents(served);
}

function samePercents(a: ScenarioPercents, b: ScenarioPercents): boolean {
  return SCENARIO_COMPONENTS.every((component) => a[component] === b[component]);
}

export function useSuitabilityCustomWeights({
  run,
  policyProfiles,
  profile,
  scope = SCOPE_ALL,
  enabled,
}: {
  run: SuitabilityRun | null;
  /** The policy's static profiles, the fallback for a run that stored none. */
  policyProfiles?: Record<string, Record<string, string>>;
  /** The active 점수 반영 기준. Changing it reloads that preset. */
  profile: SuitabilityProfile;
  /**
   * The active ① 분석 범위. The preview is ranked WITHIN it, exactly as the profile
   * ranking is, so ③'s rows are this 범위's top N under the reader's own weights —
   * not the capital region's top N filtered down to whatever happened to be in range.
   * Changing the 범위 invalidates an applied vector for the same reason changing the
   * 기준 does: it is a different population, and therefore a different ranking.
   */
  scope?: SuitabilityScope;
  /**
   * Whether 후보지 심층 분석 is the open view. A scenario applied here describes THIS
   * screen's map and ranking, so leaving the screen drops it rather than leaving a
   * custom tile source behind a view that does not explain it.
   */
  enabled: boolean;
}): SuitabilityCustomWeights {
  const runId = run?.id ?? null;
  const presetPercents = useMemo(
    () => servedPercents(run, policyProfiles, profile),
    [run, policyProfiles, profile],
  );

  /**
   * THE DRAFT IS ONLY THE READER'S OWN EDITS.
   *
   * While the editor is on a PRESET the displayed values are DERIVED from the served
   * vector, not copied into state — so they are correct on the very first render the
   * run is available on, with no effect to fire and no frame of the wrong numbers.
   *
   * Seeding state from props in an effect is what this replaces, and it was wrong:
   * the run arrives asynchronously, so the editor briefly held the neutral 25/25/25/25
   * fallback and only corrected itself once an effect ran. Any consumer that read the
   * weights in between — a test, or a reader who typed immediately — saw a vector the
   * run never served.
   */
  const [draft, setDraft] = useState<ScenarioPercents>(presetPercents);
  const [source, setSource] = useState<WeightSource>({ kind: "preset", profile });
  // On a preset, the SERVED vector is the answer; on 사용자 지정, the reader's draft.
  const percents = source.kind === "preset" ? presetPercents : draft;
  const [applied, setApplied] = useState<AppliedCustomWeights | null>(null);
  const [preview, setPreview] = useState<UserScenarioPreview | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);


  /**
   * A NEW PRESET, A NEW RUN, OR LEAVING THE SCREEN CLEARS THE SCENARIO.
   *
   * Each of the three genuinely invalidates an applied vector: a different 기준 is a
   * different starting point the reader just chose, a different run means the frozen
   * component scores the scenario recombines are different ones, and leaving the view
   * takes away the surface that explains what the custom tiles are. Keeping the
   * scenario across any of them would leave ③ and the map showing a weighting that
   * nothing on screen still names.
   */
  const presetKey = `${runId}:${profile}:${scopeKey(scope)}:${enabled ? "on" : "off"}`;
  const lastPresetKey = useRef(presetKey);
  useEffect(() => {
    if (lastPresetKey.current === presetKey) return;
    lastPresetKey.current = presetKey;
    abortRef.current?.abort();
    // Returning the editor to the newly-selected preset is exactly this effect's
    // job: it is a RESET keyed on an identity change, not a value derived from
    // props, which is why it is guarded by `lastPresetKey` and does not run on
    // every render.
    setDraft(presetPercents);
    setSource({ kind: "preset", profile });
    setApplied(null);
    setPreview(null);
    setApplying(false);
    setError(null);
  }, [presetKey, presetPercents, profile]);

  const setPercent = useCallback((component: ScenarioComponent, percent: number) => {
    // Clamped to the 0–100 the requirement states, and floored to an integer so the
    // exact-decimal mapping can never be handed a fractional percent. A blank or
    // unparseable field arrives as NaN and is read as 0, which keeps the total
    // honest (and therefore invalid) rather than silently holding the old value.
    const safe = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
    // The first edit forks the draft OFF the preset that was on screen, so the other
    // three values are the ones the reader could actually see when they typed.
    const base = source.kind === "preset" ? presetPercents : draft;
    setDraft({ ...base, [component]: safe });
    // ANY edit is what makes the vector the reader's own — see the header.
    setSource({ kind: "custom" });
    setError(null);
  }, [source, presetPercents, draft]);

  const selectCustom = useCallback(() => {
    // Adopt whatever is on screen as the reader's own, without changing a value.
    setDraft(percents);
    setSource({ kind: "custom" });
  }, [percents]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setDraft(presetPercents);
    setSource({ kind: "preset", profile });
    setApplied(null);
    setPreview(null);
    setApplying(false);
    setError(null);
  }, [presetPercents, profile]);

  const valid = isDraftValid(percents);
  const total = draftTotal(percents);
  const difference = totalDifference(percents);
  const canApply =
    valid &&
    runId !== null &&
    !applying &&
    (applied === null || !samePercents(applied.percents, percents));

  const apply = useCallback(() => {
    if (!valid || runId === null) return;
    // Throws on an invalid total by contract; `valid` above is the guard, and the
    // try/catch is the belt so a future edit cannot turn a refusal into a crash.
    let weights: UserScenarioWeights;
    try {
      weights = percentsToCanonical(percents);
    } catch {
      setError("가중치 합계가 정확히 100%일 때만 계산할 수 있습니다.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setApplying(true);
    setError(null);
    const requested = percents;
    const requestedScope = scope;
    previewUserWeightScenario(
      {
        run_id: runId,
        weights,
        // The stored profile the preview reports each candidate's movement against.
        // `baseline` is the same anchor ④ 시나리오 저장 and Page 5 use, so a rank
        // movement means the same thing wherever it is printed.
        compare_profile: "baseline",
        top_n: CUSTOM_SCENARIO_TOP_N,
        // THE ANALYSIS SCOPE, so the custom ranking is this 범위's own top N. The
        // same serializer the profile ranking uses, so both mean the same rows.
        ...scopeToQuery(scope),
      },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setPreview(result);
        setApplied({
          runId: result.run_id,
          // The BACKEND's canonical echo, not the client's copy: what is stored and
          // put in the tile URL is the vector the analysis engine actually applied.
          weights: result.canonical_weights,
          scenarioHash: result.scenario_hash,
          scenarioHashShort: result.scenario_hash_short,
          percents: requested,
          scope: requestedScope,
        });
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        // A refusal names the offending value where the backend named it. The
        // previous scenario is dropped rather than left on screen beside an error
        // that would read as though the new weights were in force.
        setPreview(null);
        setApplied(null);
        setError(
          cause instanceof ApiError && cause.detail
            ? cause.detail.detail
            : "가중치를 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setApplying(false);
      });
  }, [valid, runId, percents, scope]);

  return {
    percents,
    setPercent,
    source,
    isCustom: source.kind === "custom",
    total,
    difference,
    valid,
    canApply,
    applying,
    error,
    applied,
    preview,
    apply,
    reset,
    selectCustom,
  };
}
