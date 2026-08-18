"use client";

/**
 * useScenarioCandidateDetail — the selected cell's result under A안 and under B안.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────────
 * It is NOT a second comparison. It does not read localStorage, does not parse
 * `cmpA`/`cmpB`, does not resolve a saved scenario, and never calls
 * `POST /suitability/scenarios/preview`. Page 5A owns all of that and hands down a
 * finished {@link ScenarioComparison}; this hook only asks a DIFFERENT, existing
 * endpoint one further question about one cell:
 *
 *     POST /api/v1/suitability/scenarios/candidates/{candidate_id}
 *
 * That endpoint already serves per-scenario `contributions`
 * (`component` / `component_score` / `weight` / `weighted_contribution`), so nothing
 * is derived client-side and no new backend contract is invented.
 *
 * ── ONE REQUEST PER SIDE, AND ONLY FOR A READY SIDE ──────────────────────────────
 * The weights sent are that side's `canonicalWeights` — the SERVER's echo from the
 * foundation's preview, which is non-null only in the `READY` state. A side that is
 * EMPTY / MISSING / OTHER_RUN / PREVIEW_ERROR is never sent: asking for a candidate
 * detail under an unvalidated scenario would return a confident answer to a question
 * the foundation already refused.
 *
 * `compare_profile` is the foundation's frozen `SCENARIO_COMPARISON_COMPARE_PROFILE`,
 * identical on both sides, so the two responses' comparison columns describe ONE
 * baseline — the same reason the foundation pins it.
 *
 * ── NOT SHARED-FATE ──────────────────────────────────────────────────────────────
 * Both requests go out together and each catches its own rejection, so "A안 loaded /
 * B안 failed" stays a two-sided screen with one named error rather than a blank
 * section.
 *
 * Nothing is written: no storage, no URL, no mutation of the comparison.
 */

import { useEffect, useMemo, useState } from "react";

import { ApiError, fetchUserScenarioCandidateDetail } from "../../lib/api";
import type { UserScenarioCandidateDetail, UserScenarioWeights } from "../../lib/api";
import {
  SCENARIO_COMPARISON_COMPARE_PROFILE,
  type ScenarioComparison,
} from "../../lib/scenarioComparison";
import type { CandidateSideResult } from "../../lib/scenarioCandidateComparison";
import {
  SCOPE_ALL,
  scopeKey,
  scopeToQuery,
  type SuitabilityScope,
} from "../../lib/suitabilityScope";

/** Fallback when a rejection carried no usable backend detail. */
export const CANDIDATE_DETAIL_FAILED_MESSAGE =
  "이 후보 구역의 상세 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";

export interface ScenarioCandidateDetails {
  a: CandidateSideResult;
  b: CandidateSideResult;
  /** True while either side's request is in flight. */
  loading: boolean;
}

interface Settled {
  key: string;
  a: { detail: UserScenarioCandidateDetail | null; errorMessage: string | null } | null;
  b: { detail: UserScenarioCandidateDetail | null; errorMessage: string | null } | null;
}

const NOTHING_LOADED: Settled = { key: "", a: null, b: null };

/** Prefer the backend's own message: it names the offending value. */
function messageFor(cause: unknown): string {
  return cause instanceof ApiError && cause.detail
    ? cause.detail.detail
    : CANDIDATE_DETAIL_FAILED_MESSAGE;
}

/**
 * Identity of this request pair: the run, the cell, and BOTH sides' canonical weights.
 * Including the weights means a side whose scenario changed under the same id
 * re-requests instead of showing the previous weighting's contributions.
 */
function requestKey(
  runId: number | null,
  candidateId: number | null,
  a: UserScenarioWeights | null,
  b: UserScenarioWeights | null,
): string {
  const w = (weights: UserScenarioWeights | null) =>
    weights === null
      ? "-"
      : `${weights.zoning},${weights.road},${weights.equity},${weights.demand}`;
  return `${runId ?? "-"}|${candidateId ?? "-"}|${w(a)}|${w(b)}`;
}

export function useScenarioCandidateDetail(
  comparison: ScenarioComparison,
  candidateId: number | null,
  /**
   * The SAME analysis scope the comparison was previewed within.
   *
   * `custom_rank` on a candidate detail is a position in a population, so it is only
   * consistent with the row the reader clicked if it is counted over the same 범위.
   * Sending no scope here while the ranking was scoped would print a capital-region
   * rank beside a regional one.
   */
  scope: SuitabilityScope = SCOPE_ALL,
): ScenarioCandidateDetails {
  const runId = comparison.runId;
  // `canonicalWeights` is non-null ONLY when that side is READY, so this single
  // read is also the permission check — there is no separate gate to keep in step.
  const weightsA = comparison.sideA.canonicalWeights;
  const weightsB = comparison.sideB.canonicalWeights;

  const key = `${requestKey(runId, candidateId, weightsA, weightsB)}|${scopeKey(scope)}`;
  const [settled, setSettled] = useState<Settled>(NOTHING_LOADED);

  // Outcomes from a SUPERSEDED key are not shown. Derived rather than reset in an
  // effect, so the very first render after a change is already "in flight" with no
  // intermediate frame of the previous candidate's numbers.
  const current: Settled = settled.key === key ? settled : NOTHING_LOADED;

  useEffect(() => {
    if (runId === null || candidateId === null) return;
    if (weightsA === null && weightsB === null) return;

    const controller = new AbortController();
    let live = true;

    const load = async (weights: UserScenarioWeights) => {
      try {
        const detail = await fetchUserScenarioCandidateDetail(
          candidateId,
          {
            run_id: runId,
            weights,
            compare_profile: SCENARIO_COMPARISON_COMPARE_PROFILE,
            ...scopeToQuery(scope),
          },
          controller.signal,
        );
        return { detail, errorMessage: null };
      } catch (cause) {
        return { detail: null, errorMessage: messageFor(cause) };
      }
    };

    void Promise.all([
      weightsA === null ? Promise.resolve(null) : load(weightsA),
      weightsB === null ? Promise.resolve(null) : load(weightsB),
    ]).then(([a, b]) => {
      if (!live) return;
      setSettled({ key, a, b });
    });

    return () => {
      live = false;
      controller.abort();
    };
    // `key` already encodes the run, the candidate, both weight vectors AND the
    // scope, so it is the complete identity of this request pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, runId, candidateId, weightsA, weightsB]);

  return useMemo(() => {
    const side = (
      slot: "A" | "B",
      weights: UserScenarioWeights | null,
      outcome: Settled["a"],
    ): CandidateSideResult => {
      // The comparison side itself was never usable, so no request was made. Calling
      // that an error would blame a request that never happened.
      if (weights === null) return { slot, state: "BLOCKED", detail: null, errorMessage: null };
      if (candidateId === null || runId === null) {
        return { slot, state: "IDLE", detail: null, errorMessage: null };
      }
      if (outcome === null) return { slot, state: "LOADING", detail: null, errorMessage: null };
      if (outcome.detail === null) {
        return {
          slot,
          state: "ERROR",
          detail: null,
          errorMessage: outcome.errorMessage ?? CANDIDATE_DETAIL_FAILED_MESSAGE,
        };
      }
      return { slot, state: "READY", detail: outcome.detail, errorMessage: null };
    };

    const a = side("A", weightsA, current.a);
    const b = side("B", weightsB, current.b);
    return { a, b, loading: a.state === "LOADING" || b.state === "LOADING" };
  }, [weightsA, weightsB, current.a, current.b, candidateId, runId]);
}
