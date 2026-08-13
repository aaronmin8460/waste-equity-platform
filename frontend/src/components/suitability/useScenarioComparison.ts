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

interface Outcomes {
  /** Which request set these outcomes belong to. */
  key: string;
  a: ComparisonSideOutcome | null;
  b: ComparisonSideOutcome | null;
}

const NOTHING_LOADED: Outcomes = { key: "", a: null, b: null };

/** Prefer the backend's own message: it names the offending value. */
function messageFor(cause: unknown): string {
  return cause instanceof ApiError && cause.detail ? cause.detail.detail : PREVIEW_FAILED_MESSAGE;
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

  const key = requestKey(activeRunId, plan.a, plan.b);
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
    // `key` already encodes the run and both sides' ids and weights, so it is the
    // complete identity of this request pair.
  }, [key, activeRunId, needsA, needsB, weightsA, weightsB]);

  return useMemo(
    () => buildScenarioComparison(resolution, run, { a: settled.a, b: settled.b }),
    [resolution, run, settled.a, settled.b],
  );
}
