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
 * NEUTRAL LANGUAGE. The heading is "순위 보기" over "…점수가 높은 후보 구역", never
 * 최적 / 최고 / 추천 / 건설 권고: a high screening score is a position in this
 * comparison under the active weights, not a siting recommendation.
 * `SCORE_RANK_FRAMING` says so directly under the heading, so the framing travels
 * with the list rather than living only in a disclaimer at the bottom of the column.
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
  /**
   * Render the ranking WITHOUT its own card chrome, as the second block of
   * ③ 종합 점수와 후보 순위 (Figma 136:8684).
   */
  nested?: boolean;
  /**
   * Which list to render. The stability short-list is a DIFFERENT population, not a
   * second page of the ranking, so when the ranking is nested inside card ③ the
   * caller renders `"stable"` separately rather than putting a card inside a card.
   */
  section?: "ranking" | "stable" | "both";
}

/**
 * The row's location label: the 시·군·구 the candidate CELL lies in, said as such.
 * `sigungu` is served per candidate; an unassigned cell keeps its explicit fallback
 * rather than borrowing a neighbouring name.
 */
function cellLocationLabel(sigungu: unknown): string {
  return sigungu == null ? "(지역 미배정)" : String(sigungu);
}

/**
 * One ranked row. Values are rendered exactly as served — never re-formatted.
 *
 * THE ROW IS A CANDIDATE CELL, NOT A 시·군·구. The Figma ranking lists city names
 * ("안산시", "시흥시") as if the municipality itself were the scored object; it is
 * not. Every row here is one 500 m grid cell, and the 시·군·구 is only where that
 * cell lies — which is why the label is prefixed and why the cell's own key and
 * centroid stay available in the selected-candidate panel. Dropping the prefix would
 * turn a cell score into a claim about a whole city.
 */
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
        className={`flex w-full items-center gap-2 rounded-card border px-2 py-2 text-left text-xs ${
          isSelected
            ? "border-primary-border bg-primary-soft font-semibold text-ink"
            : "border-hairline bg-surface text-ink-muted hover:bg-surface-muted"
        }`}
        data-testid={testId}
      >
        {/* Rank in its own leading column, the way the Figma row reads. */}
        <span className="flex-none text-sm font-bold tabular-nums text-ink">{rank}위</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ink">{sigungu}</span>
          {/* The scored object, on its own line so it survives a narrow column:
              the row is one 500 m grid cell, not the 시·군·구 named above it. */}
          <span className="block text-[11px] text-ink-subtle">500m 후보 구역</span>
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
        </span>
        <span className="flex-none text-sm font-bold tabular-nums text-ink">{score}점</span>
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
  nested = false,
  section = "both",
}: SuitabilityCandidateListProps) {
  const stableCandidates =
    stabilityAvailable && section !== "ranking" ? summary.top_stable_candidates : [];
  const showRanking = section !== "stable";
  const rankingBody = (
    <>
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
                sigungu={cellLocationLabel(c.sigungu)}
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
        {summary.top_candidates.length > 0 && (
          <p className="mt-1.5 text-[11px] text-ink-subtle" data-testid="candidate-list-map-hint">
            각 행은 시·군·구 자체가 아니라 그 안에 있는 500m 후보 구역 한 곳입니다. 목록에서 후보를
            누르면 지도에서 해당 구역이 선택됩니다.
          </p>
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
    </>
  );

  const rankingTitle = "순위 보기";
  const rankingDescription = `${profileLabel(profile)} 기준 · 점수가 높은 후보 구역`;

  return (
    <>
      {showRanking &&
        (nested ? (
          <section aria-label={rankingTitle} data-testid="top-candidates">
            <h3 className="text-xs font-semibold text-ink">{rankingTitle}</h3>
            <p className="mb-1.5 mt-0.5 text-[11px] text-ink-subtle">{rankingDescription}</p>
            {rankingBody}
          </section>
        ) : (
          <SectionCard title={rankingTitle} description={rankingDescription} testId="top-candidates">
            {rankingBody}
          </SectionCard>
        ))}

      {stableCandidates.length > 0 && (
        <SectionCard
          title="기준을 바꿔도 상위권인 후보지"
          description="세 비교 방식 모두에서 상위 10%에 포함된 구역"
          testId="stable-candidates"
          className={nested ? "wep-figma-card" : undefined}
        >
          <ol className="flex flex-col gap-1">
            {stableCandidates.map((c) => (
              <CandidateRow
                key={String(c.candidate_id)}
                rank={String(c.rank)}
                sigungu={cellLocationLabel(c.sigungu)}
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
