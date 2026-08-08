"use client";

/**
 * The three non-success states of the 수집·운반 계약 지급액 section.
 *
 *   loading      — a request is in flight. Decorative skeleton + a separate
 *                  `role="status"` line. No digit, no zero-filled cell.
 *   error        — a genuine request/network/server failure. The only
 *                  `role="alert"` this section renders.
 *   no-match     — the request SUCCEEDED and the selected filter combination
 *                  simply contains no municipality.
 *
 * The third is kept rigorously apart from a municipality's own 자료 없음 state.
 * "No row matches these filters" is a statement about the reader's selection;
 * "this municipality has no calculable payment" is a statement about the data. The
 * endpoint has no 404 "no record" path at all — it always returns all 66 rows for
 * the published year — so an unavailable municipality can never reach the error
 * branch here (repo AGENTS.md; Step 2 report §9 rule 2).
 */

import type { MunicipalCostErrorState } from "../../lib/municipalCost";
import EmptyState from "../ui/EmptyState";
import InfoBanner from "../ui/InfoBanner";
import Skeleton from "../ui/Skeleton";
import {
  MUNICIPAL_COST_NO_MATCH_DESCRIPTION,
  MUNICIPAL_COST_NO_MATCH_TITLE,
} from "./municipalCostShared";

/**
 * Initial load and every filter transition.
 *
 * The skeleton is `aria-hidden` (components/ui/Skeleton.tsx contract), so the
 * meaningful announcement stays in the separate `role="status"` line. It renders
 * neutral bars only — never a placeholder digit that could read as a payment.
 */
export function MunicipalCostLoading() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted" role="status" data-testid="municipal-cost-loading">
        시·군·구별 수집·운반 계약 지급액 자료를 불러오는 중입니다.
      </p>
      <div aria-hidden className="wep-card" data-testid="municipal-cost-loading-skeleton">
        <Skeleton lines={6} />
      </div>
    </div>
  );
}

/** A genuine request/network/server failure. Actionable, so `role="alert"`. */
export function MunicipalCostError({ state }: { state: MunicipalCostErrorState }) {
  return (
    <InfoBanner
      tone="error"
      role="alert"
      title="지급액 자료를 불러오지 못했습니다"
      testId="municipal-cost-error"
    >
      <p className="font-medium text-ink">{state.message}</p>
      <p className="mt-1 text-xs">
        자료를 불러오지 못하면 값을 표시하지 않습니다. 이전 조건의 값을 그대로 두거나 대체 데이터를
        사용하지 않습니다. 잠시 후 다시 시도해 주세요.
      </p>
      {state.detail && (
        <p
          className="mt-1 text-xs text-ink-subtle"
          data-diagnostic
          data-testid="municipal-cost-error-detail"
        >
          기술 정보: {state.detail}
        </p>
      )}
    </InfoBanner>
  );
}

/**
 * The response arrived and no municipality matches the selected filters.
 *
 * NOT an alert and NOT a claim about any municipality's data — the copy says so
 * explicitly so it is never read as "these places spent nothing".
 */
export function MunicipalCostNoMatch() {
  return (
    <>
      {/* Politely announced: without a live region a screen-reader user who filters
          a populated selection down to an empty one hears nothing at all as the
          whole table is replaced. `role="status"` waits for a pause rather than
          interrupting, which is the right register for "there is nothing here". */}
      <p role="status" className="sr-only" data-testid="municipal-cost-no-match-live">
        {MUNICIPAL_COST_NO_MATCH_TITLE}
      </p>
      <EmptyState
        testId="municipal-cost-no-match"
        title={MUNICIPAL_COST_NO_MATCH_TITLE}
        description={MUNICIPAL_COST_NO_MATCH_DESCRIPTION}
      />
    </>
  );
}
