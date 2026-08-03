"use client";

/**
 * The three non-success states of 매립지 현황, kept visibly and semantically apart.
 *
 *   loading  — a request is genuinely in flight. Decorative skeleton + a separate
 *              `role="status"` line. No digit, no zero-filled card.
 *   no-data  — the request REACHED the backend and the backend answered that it
 *              holds no official record for these filters. That is data, not a
 *              fault: no `role="alert"`, no zeros, and the served year list offered
 *              as a way forward when (and only when) the backend supplies one.
 *   error    — a genuine request/network/server failure the reader may retry. The
 *              only `role="alert"` on this screen.
 *
 * Nothing here invents a value, carries a previous selection's figure forward, or
 * turns an absence into a `0` (repo AGENTS.md).
 */

import type { LandfillUnavailableState } from "../../lib/landfill";
import EmptyState from "../ui/EmptyState";
import InfoBanner from "../ui/InfoBanner";
import Skeleton from "../ui/Skeleton";

/**
 * Initial load and every filter transition.
 *
 * The skeleton is decorative and `aria-hidden`; the meaningful announcement stays
 * in the separate `role="status"` line (components/ui/Skeleton.tsx contract). It
 * renders neutral bars only — never a placeholder digit that could be mistaken for
 * an official quantity, and never a zero-filled KPI.
 */
export function LandfillLoading() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted" data-testid="landfill-loading" role="status">
        공식 반입 데이터를 불러오는 중입니다.
      </p>
      <div aria-hidden data-testid="landfill-loading-skeleton" className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="wep-card">
              <Skeleton lines={3} />
            </div>
          ))}
        </div>
        <div className="wep-card">
          <Skeleton lines={5} />
        </div>
      </div>
    </div>
  );
}

/** A genuine request/network/server failure. Actionable, so `role="alert"`. */
export function LandfillError({ state }: { state: LandfillUnavailableState }) {
  return (
    <InfoBanner tone="error" role="alert" title="자료를 불러오지 못했습니다" testId="landfill-error">
      <p className="font-medium text-ink">{state.message}</p>
      <p className="mt-1 text-xs">
        공식 데이터를 불러오지 못하면 값을 표시하지 않습니다. 이전 조건의 값을 그대로 두거나 대체
        데이터를 사용하지 않습니다. 잠시 후 다시 시도하거나 다른 조건을 선택해 주세요.
      </p>
      {/* Diagnostic only. The backend code is retained (redesign plan §5 rule 12)
          but is never the citizen's explanation. */}
      {state.detail && (
        <p className="mt-1 text-xs text-ink-subtle" data-diagnostic data-testid="landfill-error-detail">
          기술 정보: {state.detail}
        </p>
      )}
    </InfoBanner>
  );
}

/**
 * The backend served a 404 "no official record" answer for these filters.
 *
 * Distinct from {@link LandfillError} on purpose: it is not a fault, it is not an
 * alert, and it must never be filled with zero quantities or zero fees — an absent
 * record is not a measured zero (repo AGENTS.md; redesign plan §5 rules 2–3).
 */
export function LandfillNoData({ state }: { state: LandfillUnavailableState }) {
  const years = state.availableYears;
  return (
    <>
      {/* Politely announced. The EmptyState itself carries no role — it is not an
          alert — but without SOME live region a screen-reader user who filters from
          a populated year to an empty one hears nothing at all as the whole results
          region is replaced. `role="status"` waits for a pause instead of
          interrupting, which is the right register for "there is nothing here". */}
      <p role="status" className="sr-only" data-testid="landfill-no-data-live">
        선택한 조건의 공식 반입 자료가 없습니다.
      </p>
      <EmptyState
        testId="landfill-no-data"
        title="선택한 조건의 공식 반입 자료가 없습니다."
        description={
          <>
            <span className="block">{state.message}</span>
            {/* Only rendered when the backend actually serves the list. Never
                invented — and the same list populates the 연도 control, so every
                year named here is one the reader can actually select. */}
            {years.length > 0 && (
              <span className="mt-1 block" data-testid="landfill-available-years">
                자료가 있는 연도: {years.join(", ")}
              </span>
            )}
            <span className="mt-1 block text-xs text-ink-subtle">
              값이 없는 기간은 0이 아니라 자료 없음으로 표시합니다. 다른 연도나 조건을 선택해
              주세요.
            </span>
            {state.detail && (
              <span
                className="mt-1 block text-xs text-ink-subtle"
                data-diagnostic
                data-testid="landfill-no-data-detail"
              >
                기술 정보: {state.detail}
              </span>
            )}
          </>
        }
      />
    </>
  );
}
