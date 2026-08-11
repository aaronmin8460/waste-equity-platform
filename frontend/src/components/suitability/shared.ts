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
import { PROFILE_META, statusLabel, type ScoreComponent } from "../../lib/glossary";

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

/**
 * WHICH WAY EACH COMPONENT SCORE POINTS — one sentence per factor, for the factor
 * cards in ② 계산 모델 가중치 설정.
 *
 * This is PRESENTATION of the existing model, not a new one. Every sentence states
 * the direction of the SAME Z/R/E/D scores the backend already computes; nothing
 * here changes, re-weights, or re-derives a score.
 *
 * Two of them exist specifically to stop a misreading:
 *   - `equity` — a HIGH E score means the area carries LESS existing facility
 *     burden. Naming the factor after the burden alone ("시설 부담 정도") would
 *     invert it, so the direction is spelled out instead.
 *   - `demand` — D is PRESENT-DAY served demand for the run's reference year. There
 *     is no future-generation forecast in this model, so the sentence says so
 *     rather than letting 장래 발생량 be inferred.
 */
export const COMPONENT_DIRECTION: Record<ScoreComponent, string> = {
  zoning: "점수가 높을수록 법정 용도지역 대분류상 상충이 적은 행정적 맥락입니다.",
  road: "점수가 높을수록 후보 격자 중심점에서 가장 가까운 도로까지의 거리가 가깝습니다.",
  equity: "점수가 높을수록 이미 지고 있는 폐기물 처리시설 부담이 적은 지역입니다.",
  demand: "점수가 높을수록 기준연도 자료에서 폐기물 처리 수요가 큽니다. 장래 발생량 예측이 아닙니다.",
};

/**
 * The stability rule in one citizen-facing sentence, and the three profiles it is
 * computed over. THREE, not four: the production definition compares baseline,
 * equal, and the data-distribution (CRITIC) basis only.
 */
export const STABILITY_RULE_SHORT =
  "세 계산식 모두에서 상위 10%에 드는 후보를 안정 후보로 표시합니다.";
