"use client";

/**
 * 후보지 상세 비교표 — the Page-5 ranking comparison table (Figma 167:10554).
 *
 * ── THE POPULATION IS THE TWO PREVIEWS' TOP-N UNION, AND IT SAYS SO ──────────────
 * Every row is a candidate cell that appeared in A's served list, B's, or both. That
 * bound is printed above the table, because a table captioned "후보지 상세 비교표"
 * with no stated scope reads as the complete ranking.
 *
 * ── COLUMNS THE FRAME HAS THAT THIS DOES NOT ─────────────────────────────────────
 * The frame's table carries A안 결과 / B안 결과 (both "통과") and 주요 변화 요인
 * ("지역부담 가중치 증가로 순위 상승"). Neither is available:
 *   - a screening result cannot differ between A and B. Screening is rule-based and
 *     is not recomputed when a scenario is reweighted, so two status columns would
 *     be two copies of one value dressed up as a comparison;
 *   - 주요 변화 요인 is a causal attribution. Per-factor contribution belongs to the
 *     candidate-detail lane, and a sentence naming ONE cause for a four-factor
 *     reweighting would be an invented explanation either way.
 * The frame's footnote "통과 기준은 종합 점수 60점 이상" describes a threshold this
 * analysis does not have.
 *
 * ── SORTING REORDERS; IT NEVER RE-POPULATES ──────────────────────────────────────
 * Every option sorts the rows already derived from the two loaded previews. No sort
 * issues a request, widens the top-N cut, or changes which candidates are compared —
 * and the caption says so, so a reader does not read "순위 변화 순" as "the biggest
 * movers in the whole ranking".
 */

import { useMemo, useState } from "react";

import {
  formatRankMovement,
  formatUnavailableRank,
  scoreChange,
  sortRankingComparisonRows,
  type RankedCandidateRow,
  type RankingComparisonSort,
  type ScenarioRankingComparison,
} from "../../../lib/scenarioRankingComparison";

export interface ScenarioRankingTableProps {
  model: ScenarioRankingComparison;
}

const SORT_OPTIONS: readonly { value: RankingComparisonSort; label: string }[] = [
  { value: "movement_desc", label: "순위 변화가 큰 순" },
  { value: "rank_a_asc", label: "A안 순위 순" },
  { value: "rank_b_asc", label: "B안 순위 순" },
  { value: "score_change_desc", label: "점수 상승이 큰 순" },
];

const MOVEMENT_CLASS: Record<"UP" | "DOWN" | "SAME", string> = {
  UP: "text-primary",
  DOWN: "text-ink-secondary",
  SAME: "text-ink-subtle",
};

/** `+0.0420` / `−0.0180`; `null` when a side did not serve a score. */
function formatScoreChange(row: RankedCandidateRow): string | null {
  const change = scoreChange(row);
  if (change === null) return null;
  if (change === 0) return "변화 없음";
  // Four decimals, the precision the endpoint itself rounds scores to.
  return `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(4)}`;
}

export default function ScenarioRankingTable({ model }: ScenarioRankingTableProps) {
  const [sort, setSort] = useState<RankingComparisonSort>("movement_desc");
  const rows = useMemo(
    () => sortRankingComparisonRows(model.candidateRows, sort),
    [model.candidateRows, sort],
  );

  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-ink-muted" data-testid="scenario-ranking-table-empty">
        두 시나리오의 상위 후보 목록이 비어 있어 비교할 후보 구역이 없습니다.
      </p>
    );
  }

  return (
    <div data-testid="scenario-ranking-table">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] leading-snug text-ink-subtle" data-testid="scenario-ranking-table-scope">
          {model.scopeDescription} 정렬을 바꿔도 비교 대상 후보 구역은 달라지지 않습니다.
        </p>
        <label className="flex flex-none items-center gap-2 text-[11px] text-ink-muted">
          정렬 기준
          <select
            className="rounded-input border border-hairline-strong bg-surface px-2 py-1 text-[12px] text-ink"
            value={sort}
            onChange={(event) => setSort(event.target.value as RankingComparisonSort)}
            data-testid="scenario-ranking-table-sort"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* The row count is VISIBLE, not only in the caption: the body scrolls, so a
          reader has to be told how many rows the scroll contains. Nothing is
          truncated — every row of the compared population is present and reachable. */}
      <p className="mb-1 text-[11px] text-ink-muted" data-testid="scenario-ranking-table-count">
        비교 대상 {model.candidateRows.length.toLocaleString("ko-KR")}개 후보 구역 · 표 안에서 스크롤해
        모두 볼 수 있습니다.
      </p>

      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <caption className="sr-only">
            A안과 B안의 상위 후보 구역 순위·점수 비교. {model.candidateRows.length}개 후보 구역.
          </caption>
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-hairline text-[11px] font-semibold text-ink-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">
                후보 구역
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                A안 순위
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                B안 순위
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                순위 변화
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                A안 점수
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                B안 점수
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                점수 변화
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.candidateKey}
                className="border-b border-hairline last:border-b-0"
                data-testid="scenario-ranking-table-row"
                data-candidate-key={row.candidateKey}
              >
                <th scope="row" className="py-2.5 pr-3 text-[13px] font-normal text-ink">
                  <span className="block">{row.locationLabel ?? "위치 정보 없음"}</span>
                  <span className="block text-[11px] text-ink-subtle">
                    500m 후보 구역 · {row.candidateKey}
                  </span>
                </th>
                <RankCell
                  rank={row.aRank}
                  fallback={formatUnavailableRank(row.aRankState, "A", model.boundaryA)}
                />
                <RankCell
                  rank={row.bRank}
                  fallback={formatUnavailableRank(row.bRankState, "B", model.boundaryB)}
                />
                <td
                  className={`py-2.5 pr-3 text-right text-[13px] font-semibold tabular-nums ${
                    MOVEMENT_CLASS[row.direction ?? "SAME"]
                  }`}
                  data-testid="scenario-ranking-table-movement"
                >
                  {/* An em dash, never 0: an uncomputable movement is not "유지". */}
                  {formatRankMovement(row) ?? "—"}
                </td>
                <ScoreCell score={row.aScore} />
                <ScoreCell score={row.bScore} />
                <td className="py-2.5 text-right text-[13px] tabular-nums text-ink">
                  {formatScoreChange(row) ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-snug text-ink-subtle">
        · 점수는 분석 실행이 계산한 값을 그대로 표기합니다. 순위는 스크리닝을 통과한 후보 구역 전체를
        대상으로 매겨지며, 표에는 두 시나리오의 상위 목록에 포함된 구역만 나옵니다.
      </p>
    </div>
  );
}

/** A served rank, or the reason there is none — never a substitute number. */
function RankCell({ rank, fallback }: { rank: number | null; fallback: string }) {
  if (rank === null) {
    return (
      <td className="py-2.5 pr-3 text-right text-[11px] leading-snug text-ink-subtle">
        {fallback}
      </td>
    );
  }
  return <td className="py-2.5 pr-3 text-right text-[13px] tabular-nums text-ink">{rank}위</td>;
}

function ScoreCell({ score }: { score: string | null }) {
  if (score === null) {
    return <td className="py-2.5 pr-3 text-right text-[11px] text-ink-subtle">자료 없음</td>;
  }
  return <td className="py-2.5 pr-3 text-right text-[13px] tabular-nums text-ink">{score}점</td>;
}
