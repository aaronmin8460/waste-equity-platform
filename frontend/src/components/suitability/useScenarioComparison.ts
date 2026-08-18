"use client";

/**
 * useScenarioComparison — the ONE place Page 5 revalidates an A/B pair.
 *
 * It implements steps 2–3 of the required flow in
 * docs/figma-redesign/PAGE_5_SCENARIO_CONTRACT.md §6: given an already-resolved pair
 * (step 1, `resolveComparisonPair`) and the run on screen, it re-previews each side
 * that belongs to that run and assembles the canonical {@link ScenarioComparison}.
 *
 * ── WHY A HOOK, AND WHY EXACTLY ONE ──────────────────────────────────────────────
 * Every Page-5 section needs the same two preview responses. If each section fetched
 * its own, the page would issue 2×N identical POSTs, and two sections could end up
 * rendering different responses of the same request — an A/B screen disagreeing with
 * itself. So the foundation loads once and hands the result down; Page 5B and Page 5C
 * consume `comparison.sideA` / `comparison.sideB` and never call the API themselves.
 *
 * ── CONCURRENT, BUT NOT SHARED-FATE ──────────────────────────────────────────────
 * Neither side depends on the other, so both requests go out together. Each one
 * catches its OWN rejection into that side's outcome, so `Promise.all` can never
 * reject and "A succeeded, B failed" stays a two-sided screen with one explicit
 * error — not a blank page.
 *
 * ── A BLOCKED SIDE IS NEVER SENT ─────────────────────────────────────────────────
 * `EMPTY`, `MISSING` and `OTHER_RUN` are decided before any request. Previewing an
 * `OTHER_RUN` scenario would succeed — the endpoint happily applies any weights to
 * the run it is given — and would produce a result that looks current while the
 * reader's scenario was verified against something else. The check is the point.
 *
 * ── NOTHING IS WRITTEN ───────────────────────────────────────────────────────────
 * No localStorage write, no `SavedScenario` mutation, no URL write. This hook reads
 * the pair and the run, and returns derived runtime state.
 */

import { useEffect, useMemo, useState } from "react";

import { ApiError, previewUserWeightScenario } from "../../lib/api";
import type { UserScenarioWeights } from "../../lib/api";
import { plainError } from "../../lib/glossary";
import {
  PREVIEW_FAILED_MESSAGE,
  SCENARIO_COMPARISON_COMPARE_PROFILE,
  SCENARIO_COMPARISON_TOP_N,
  buildScenarioComparison,
  comparisonSideBlock,
  type ActiveRunResolution,
  type ComparisonSideOutcome,
  type ScenarioComparison,
} from "../../lib/scenarioComparison";
import type { ComparisonResolution } from "../../lib/savedScenarios";
import {
  SCOPE_ALL,
  scopeKey,
  scopeToQuery,
  type SuitabilityScope,
} from "../../lib/suitabilityScope";

interface Outcomes {
  /** Which request set these outcomes belong to. */
  key: string;
  a: ComparisonSideOutcome | null;
  b: ComparisonSideOutcome | null;
}

const NOTHING_LOADED: Outcomes = { key: "", a: null, b: null };

/**
 * The citizen-facing reason one side could not be previewed.
 *
 * ── A KNOWN CODE OUTRANKS THE BACKEND'S PROSE ────────────────────────────────────
 * `detail.detail` is written for an API consumer and is English
 * ("User-weight scenarios are not available for component model …"). It is still
 * preferred where it names the offending value the reader can act on — a bad weight
 * sum — but the component-model refusals must not reach the screen that way.
 *
 * Those two in particular have to stay distinguishable. The backend raises
 * COMPONENT_MODEL_MISMATCH about the reader's OWN scenario, which remains valid
 * against a run of its own model, and COMPONENT_MODEL_SCENARIOS_UNAVAILABLE about
 * the RUN on screen, whose model has no approved weight vector. `plainError` holds
 * one Korean sentence for each; falling through to the shared English detail would
 * merge two different situations into one unactionable line.
 */
const MODEL_REFUSALS = new Set([
  "COMPONENT_MODEL_MISMATCH",
  "COMPONENT_MODEL_SCENARIOS_UNAVAILABLE",
]);

function messageFor(cause: unknown): string {
  if (!(cause instanceof ApiError) || cause.detail === null) return PREVIEW_FAILED_MESSAGE;
  // ONLY the two model refusals are overridden. Everything else keeps the backend's
  // own sentence, which names the offending value — "가중치 합이 1이 아닙니다: 1.05"
  // tells a reader what to fix; the glossary's generic line does not.
  if (MODEL_REFUSALS.has(cause.detail.error)) return plainError(cause.detail.error).primary;
  return cause.detail.detail;
}

/**
 * Identity of the request pair. Includes the weights, not just the ids, so that a
 * scenario which somehow changed weights under the same id (a hand-edited store,
 * another tab) re-previews instead of showing the previous side's numbers.
 */
function requestKey(
  runId: number | null,
  a: { id: string | null; weights: UserScenarioWeights | null },
  b: { id: string | null; weights: UserScenarioWeights | null },
): string {
  const side = (s: { id: string | null; weights: UserScenarioWeights | null }) =>
    s.id === null || s.weights === null
      ? "-"
      : `${s.id}:${s.weights.zoning},${s.weights.road},${s.weights.equity},${s.weights.demand}`;
  return `${runId ?? "-"}|${side(a)}|${side(b)}`;
}

export function useScenarioComparison(
  resolution: ComparisonResolution,
  run: ActiveRunResolution,
  /**
   * THE ANALYSIS SCOPE, carried over from 후보지 심층 분석's ① 지역 선택.
   *
   * A weight scenario compares two WEIGHT VECTORS over ONE fixed candidate universe.
   * Before this was threaded through, both sides were previewed population-wide, so
   * a reader who had narrowed the analysis to 경기 was shown a 수도권-wide A/B
   * comparison full of 인천 candidates — the comparison silently answered a
   * different question from the one the page was set up to ask.
   *
   * Both sides ALWAYS receive the same scope, so A and B can never differ by
   * geography; only their weights differ. Defaulted to 수도권 전체 so an existing
   * caller that does not pass one keeps the population it had.
   */
  scope: SuitabilityScope = SCOPE_ALL,
): ScenarioComparison {
  // Only a RESOLVED run may be validated against. While it is loading — or if it
  // failed — nothing is sent: previewing against an unknown run is impossible, and
  // previewing against a guessed one would produce a confidently wrong answer.
  const activeRunId = run.state === "RESOLVED" ? run.runId : null;

  // What each side would send, and whether it is allowed to send anything at all.
  const plan = useMemo(() => {
    const forSlot = (slot: ComparisonResolution["a"]) => {
      const blocked = comparisonSideBlock(slot.scenario, slot.id, activeRunId) !== null;
      return {
        id: slot.id,
        // The STORED weights are what gets sent. What comes back — the server's
        // `canonical_weights` — is what gets shown.
        weights: blocked ? null : (slot.scenario?.weights ?? null),
      };
    };
    return { a: forSlot(resolution.a), b: forSlot(resolution.b) };
  }, [resolution, activeRunId]);

  // The scope is part of the request identity: two previews that differ only by
  // 범위 are different results and must not share a cache slot.
  const scopeQueryKey = scopeKey(scope);
  const key = `${requestKey(activeRunId, plan.a, plan.b)}|${scopeQueryKey}`;
  const [outcomes, setOutcomes] = useState<Outcomes>(NOTHING_LOADED);

  // Outcomes from a SUPERSEDED key are not shown. Deriving this rather than
  // resetting state in an effect keeps the "in flight" state correct on the very
  // first render after a change, with no intermediate frame of stale numbers.
  const settled: Outcomes = outcomes.key === key ? outcomes : NOTHING_LOADED;

  const needsA = plan.a.weights !== null;
  const needsB = plan.b.weights !== null;
  const weightsA = plan.a.weights;
  const weightsB = plan.b.weights;

  useEffect(() => {
    if (activeRunId === null) return;
    if (!needsA && !needsB) return;

    const controller = new AbortController();
    let live = true;

    const preview = async (weights: UserScenarioWeights): Promise<ComparisonSideOutcome> => {
      try {
        const response = await previewUserWeightScenario(
          {
            run_id: activeRunId,
            weights,
            compare_profile: SCENARIO_COMPARISON_COMPARE_PROFILE,
            top_n: SCENARIO_COMPARISON_TOP_N,
            // THE ONE serializer both endpoints share, so a 범위 selects exactly the
            // same rows here as it does for the Page-4 ranking.
            ...scopeToQuery(scope),
          },
          controller.signal,
        );
        return { preview: response, errorMessage: null };
      } catch (cause) {
        return { preview: null, errorMessage: messageFor(cause) };
      }
    };

    // Both sides in flight together — neither depends on the other. Each has already
    // swallowed its own rejection, so this settles exactly once and never rejects.
    void Promise.all([
      weightsA === null ? Promise.resolve(null) : preview(weightsA),
      weightsB === null ? Promise.resolve(null) : preview(weightsB),
    ]).then(([a, b]) => {
      if (!live) return;
      // The resolution of an async request started by this effect, not a
      // render-derived value, so it cannot cascade. It is keyed, so a superseded
      // response can never overwrite a newer one.
      setOutcomes({ key, a, b });
    });

    return () => {
      live = false;
      controller.abort();
    };
    // `key` already encodes the run and both sides' ids and weights; the scope key
    // completes the identity of this request pair, so narrowing ① re-previews both
    // sides instead of leaving a capital-region comparison on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, activeRunId, needsA, needsB, weightsA, weightsB, scopeQueryKey]);

  return useMemo(
    () => buildScenarioComparison(resolution, run, { a: settled.a, b: settled.b }),
    [resolution, run, settled.a, settled.b],
  );
}
