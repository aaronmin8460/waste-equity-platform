"use client";

/**
 * 점수가 높은 후보 구역 — the ranked candidate list, and the stability short-list.
 *
 * Split out of the former `SuitabilityPanel`. The order, the membership, the ranks,
 * the scores, and the top-N are exactly what `SuitabilitySummary.top_candidates` /
 * `top_stable_candidates` served: this component sorts nothing, filters nothing, and
 * recomputes nothing. Clicking a row calls the page's ONE `onSelect`, which fetches
 * the candidate detail and moves the map — the same single selection state a map
 * click drives.
 *
 * NEUTRAL LANGUAGE. The heading is "점수가 높은 후보 구역", never 최적 / 최고 / 추천 /
 * 건설 권고: a high screening score is a position in this comparison under the
 * active weights, not a siting recommendation. `SCORE_RANK_FRAMING` says so directly
 * under the heading, so the framing travels with the list rather than living only in
 * a disclaimer at the bottom of the column.
 *
 * Selection is signalled by `aria-current`, a "✓ 선택됨" text marker, a heavier
 * weight, and a border — never by the tint alone.
 */

import type { CandidateDetail, SuitabilityProfile, SuitabilitySummary } from "../../lib/api";
import { profileLabel, statusLabel } from "../../lib/glossary";
import { formatCount } from "../../lib/metrics";
import EmptyState from "../ui/EmptyState";
import SectionCard from "../ui/SectionCard";
import StabilityBadge from "./StabilityBadge";
import { SCORE_RANK_FRAMING } from "./shared";

export interface SuitabilityCandidateListProps {
  summary: SuitabilitySummary;
  profile: SuitabilityProfile;
  /** The one selected candidate (score view), or null. */
  selected: CandidateDetail | null;
  onSelect: (candidateId: number) => void;
  /** Whether the run carries stability results (gates the stable short-list). */
  stabilityAvailable: boolean;
}

/** One ranked row. Values are rendered exactly as served — never re-formatted. */
function CandidateRow({
  rank,
  sigungu,
  score,
  stabilityClass,
  stableCount,
  isSelected,
  onSelect,
  testId,
  selectedTestId,
}: {
  rank: string;
  sigungu: string;
  score: string;
  stabilityClass: string | null;
  stableCount: number | null;
  isSelected: boolean;
  onSelect: () => void;
  testId: string;
  selectedTestId?: string;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={isSelected ? "true" : undefined}
        onClick={onSelect}
        className={`w-full rounded-card border px-2 py-1.5 text-left text-xs ${
          isSelected
            ? "border-primary-border bg-primary-soft font-semibold text-ink"
            : "border-hairline bg-surface text-ink-muted hover:bg-surface-muted"
        }`}
        data-testid={testId}
      >
        <span className="flex items-baseline gap-2">
          <span className="flex-none font-semibold tabular-nums text-ink">{rank}위</span>
          <span className="min-w-0 flex-1 truncate">{sigungu}</span>
          <span className="flex-none font-semibold tabular-nums text-ink">{score}점</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          {isSelected && (
            <span className="font-semibold text-primary-hover" data-testid={selectedTestId}>
              ✓ 선택됨
            </span>
          )}
          {stabilityClass != null && stableCount != null && (
            <StabilityBadge stabilityClass={stabilityClass} stableCount={stableCount} />
          )}
        </span>
      </button>
    </li>
  );
}

export default function SuitabilityCandidateList({
  summary,
  profile,
  selected,
  onSelect,
  stabilityAvailable,
}: SuitabilityCandidateListProps) {
  const stableCandidates = stabilityAvailable ? summary.top_stable_candidates : [];
  return (
    <>
      <SectionCard
        title="점수가 높은 후보 구역"
        description={`${profileLabel(profile)} 기준 순위`}
        testId="top-candidates"
      >
        <p className="mb-2 text-[11px] text-ink-subtle" data-testid="candidate-rank-framing">
          {SCORE_RANK_FRAMING}
        </p>
        {summary.top_candidates.length === 0 ? (
          <EmptyState
            title="이 기준의 순위 후보가 없습니다."
            description="다른 점수 반영 기준을 선택하면 결과가 있을 수 있습니다. 값이 없는 항목은 0으로 채우지 않습니다."
            testId="top-candidates-empty"
          />
        ) : (
          <ol className="flex flex-col gap-1">
            {summary.top_candidates.map((c) => (
              <CandidateRow
                key={String(c.candidate_id)}
                rank={String(c.rank)}
                sigungu={String(c.sigungu ?? "(지역 미배정)")}
                score={String(c.total_score)}
                stabilityClass={c.stability_class != null ? String(c.stability_class) : null}
                stableCount={c.stable_count != null ? Number(c.stable_count) : null}
                isSelected={selected?.candidate_id === Number(c.candidate_id)}
                onSelect={() => onSelect(Number(c.candidate_id))}
                testId="top-candidate-item"
                selectedTestId="top-candidate-selected"
              />
            ))}
          </ol>
        )}
        <div className="mt-2 text-[11px] text-ink-subtle" data-testid="candidate-vector-note">
          <p>
            전체 후보 구역 {formatCount(summary.candidate_count_total)}개가 모두 지도에 표시됩니다. 표시
            개수 제한 없이 전체 자료를 볼 수 있고, 화면에 보이는 부분만 빠르게 불러옵니다.
          </p>
          <p className="mt-0.5">
            {statusLabel("ELIGIBLE")} {formatCount(summary.candidate_count_eligible)} ·{" "}
            {statusLabel("REVIEW_REQUIRED")} {formatCount(summary.candidate_count_review)} ·{" "}
            {statusLabel("EXCLUDED")} {formatCount(summary.candidate_count_excluded)} — 상태 필터는
            지도에 함께 적용됩니다. 공공자료 기반 1차 비교이며 실제 입지 결정이 아닙니다.
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-ink-subtle">자세히 보기</summary>
            <p className="mt-1 text-[11px] text-ink-subtle">
              지도는 화면에 필요한 부분만 벡터 타일(MVT)로 전송해 빠르게 표시합니다.
            </p>
          </details>
        </div>
      </SectionCard>

      {stableCandidates.length > 0 && (
        <SectionCard
          title="기준을 바꿔도 상위권인 후보지"
          description="세 비교 방식 모두에서 상위 10%에 포함된 구역"
          testId="stable-candidates"
        >
          <ol className="flex flex-col gap-1">
            {stableCandidates.map((c) => (
              <CandidateRow
                key={String(c.candidate_id)}
                rank={String(c.rank)}
                sigungu={String(c.sigungu ?? "(지역 미배정)")}
                score={String(c.total_score)}
                stabilityClass={String(c.stability_class)}
                stableCount={Number(c.stable_count)}
                isSelected={selected?.candidate_id === Number(c.candidate_id)}
                onSelect={() => onSelect(Number(c.candidate_id))}
                testId="stable-candidate-item"
              />
            ))}
          </ol>
        </SectionCard>
      )}
    </>
  );
}
