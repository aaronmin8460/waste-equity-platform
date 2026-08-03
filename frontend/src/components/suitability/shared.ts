/**
 * Shared constants for the 후보지 분석 (suitability) presentation layer.
 *
 * These moved out of `app/page.tsx` when the score workspace was split into the
 * components in this folder. They are PRESENTATION ONLY — a label list, a status
 * label map, and one standing message. Nothing here computes, re-orders, or
 * re-weights an analytical value; the weights shown next to a profile are the
 * ones the run served (see `lib/suitability.ts` `namedWeights`).
 */

import type { SuitabilityProfile, SuitabilityStatus } from "../../lib/api";
import { PROFILE_META, statusLabel } from "../../lib/glossary";

/**
 * Plain-Korean score-basis (weight-profile) options in their fixed display order.
 * The primary label is the citizen phrasing; `method` is the short detail line
 * shown under it. Both come from the central glossary so wording stays consistent
 * across the app — this list adds no profile of its own, and the page renders only
 * the subset the active run actually supports (`availableProfiles`).
 */
export const PROFILE_OPTIONS: {
  key: SuitabilityProfile;
  label: string;
  method: string;
}[] = [
  { key: "baseline", label: PROFILE_META.baseline.primary, method: PROFILE_META.baseline.detail ?? "" },
  { key: "equal", label: PROFILE_META.equal.primary, method: PROFILE_META.equal.detail ?? "" },
  {
    key: "equity_focused",
    label: PROFILE_META.equity_focused.primary,
    method: PROFILE_META.equity_focused.detail ?? "",
  },
  {
    key: "access_focused",
    label: PROFILE_META.access_focused.primary,
    method: PROFILE_META.access_focused.detail ?? "",
  },
  { key: "critic", label: PROFILE_META.critic.primary, method: PROFILE_META.critic.detail ?? "" },
];

/**
 * Plain-Korean primary status labels for the legend, the sidebar summary, and the
 * popup. The raw code stays in the detail layer (`STATUS_META[...].code`), where a
 * diagnostic genuinely needs it.
 */
export const STATUS_LABELS: Record<SuitabilityStatus, string> = {
  ELIGIBLE: statusLabel("ELIGIBLE"),
  REVIEW_REQUIRED: statusLabel("REVIEW_REQUIRED"),
  EXCLUDED: statusLabel("EXCLUDED"),
};

/** The three statuses in their fixed display order (best-classified first). */
export const STATUS_ORDER: readonly SuitabilityStatus[] = [
  "ELIGIBLE",
  "REVIEW_REQUIRED",
  "EXCLUDED",
];

/** Old runs that predate CRITIC/stability carry no such results. */
export const OLD_RUN_NO_CRITIC_MESSAGE =
  "이 분석 실행에는 데이터 분포 기준·안정성 결과가 없습니다. 새 버전의 분석 실행이 필요합니다.";

/**
 * The one neutral sentence the map insight strip and the candidate list use to
 * frame a high score. A high screening score is a position in this comparison, not
 * a recommendation — so the wording never says 최적 / 추천 / 건설 권고.
 */
export const SCORE_RANK_FRAMING =
  "현재 점수 반영 기준에서 점수가 높은 순서이며, 최적지·추천지 판정이 아닙니다.";
