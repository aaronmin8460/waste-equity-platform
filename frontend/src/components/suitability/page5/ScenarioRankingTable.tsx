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
 * ── WHAT STANDS WHERE THE FRAME'S TWO RESULT COLUMNS WERE ────────────────────────
 * One 실행 안정성 column, carrying the backend's frozen `stability_class`. It is the
 * honest occupant of that space for the same reason the two result columns are not:
 * it is a property of the RUN, identical under A안 and B안, so it is printed ONCE
 * rather than as a pair pretending to differ. It is styled flat — no arrow, no
 * colour ramp — so it does not read as a third comparison next to the rank columns,
 * and an unserved class prints 자료 없음 rather than defaulting to "안정적".
 *
 * ── SORTING REORDERS; IT NEVER RE-POPULATES ──────────────────────────────────────
 * Every option sorts the rows already derived from the two loaded previews. No sort
 * issues a request, widens the top-N cut, or changes which candidates are compared —
 * and the caption says so, so a reader does not read "순위 변화 순" as "the biggest
 * movers in the whole ranking".
 */

import { useMemo, useState } from "react";

import { STABILITY_META } from "../../../lib/glossary";
import {
  RANK_VARIABILITY_META,
  rankVariabilityLevel,
} from "../../../lib/rankVariability";
import {
  SIGUNGU_GROUPING_NOTE,
  groupRowsBySigungu,
} from "../../../lib/scenarioSigunguGroups";
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
  /**
   * 시·군·구 GROUPS, in the order the active sort puts their first member.
   *
   * The sort still decides everything — no group is ordered by a quantity computed
   * over its members, because no such quantity exists here (see
   * `lib/scenarioSigunguGroups.ts`). Each group becomes its own `<tbody>` with one
   * heading row, so the 시·군·구 is said ONCE instead of on all N rows, and every
   * rank, score and movement stays on the candidate row that owns it.
   */
  const groups = useMemo(() => groupRowsBySigungu(rows), [rows]);

  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-ink-muted" data-testid="scenario-ranking-table-empty">
        두 시나리오의 상위 후보 목록이 비어 있어 비교할 후보 구역이 없습니다.
      </p>
    );
  }

  return (
    <div data-testid="scenario-ranking-table">
      {/* ONE strip, not three. The scope sentence, the row count and the sort control
          used to stack into three full-width lines above a table the frame gives a
          single caption. The count is kept VISIBLE rather than folded into the
          caption — the body scrolls, so a reader has to be told how many rows the
          scroll contains — but it now shares the strip with the scope it qualifies. */}
      <div className="mb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p className="text-[11px] leading-snug text-ink-subtle" data-testid="scenario-ranking-table-scope">
          <span data-testid="scenario-ranking-table-count">
            비교 대상 {model.candidateRows.length.toLocaleString("ko-KR")}개 후보 구역
          </span>
          {" · "}
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
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                점수 변화
              </th>
              {/* The frame's A안 결과 / B안 결과 pair, answered with the one column
                  that is actually available here. See the note below the table. */}
              <th scope="col" className="py-2 text-right font-semibold">
                실행 안정성
              </th>
            </tr>
          </thead>
          {/* ONE <tbody> PER 시·군·구, each opened by a heading row.
              The heading carries the place name and a COUNT OF ROWS — never an
              average rank, a median or a synthetic group score. The owner rejected
              that aggregation explicitly, and `groupRowsBySigungu` is written so it
              cannot be added by accident. */}
          {groups.map((group) => (
            <tbody key={group.key} data-testid="scenario-ranking-table-group" data-sigungu={group.key}>
              <tr className="border-b border-hairline bg-surface-muted">
                <th
                  scope="colgroup"
                  colSpan={8}
                  className="py-1.5 pr-3 text-left text-[12px] font-bold text-ink"
                  data-testid="scenario-ranking-table-group-heading"
                >
                  {group.label}
                  {group.sidoLabel !== null && (
                    <span className="ml-1.5 text-[10.5px] font-normal text-ink-subtle">
                      {group.sidoLabel}
                    </span>
                  )}
                  <span className="ml-1.5 text-[10.5px] font-normal tabular-nums text-ink-subtle">
                    후보 구역 {group.size.toLocaleString("ko-KR")}곳
                  </span>
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr
                  key={row.candidateKey}
                  className="border-b border-hairline"
                  data-testid="scenario-ranking-table-row"
                  data-candidate-key={row.candidateKey}
                >
                  {/* THE ROW IS THE CANDIDATE CELL. The 시·군·구 is the heading above,
                      so it is not reprinted here — which is exactly the flat
                      "인천광역시 옹진군 / 인천광역시 옹진군 / …" the owner rejected. */}
                  <th scope="row" className="py-2.5 pr-3 text-[13px] font-normal text-ink">
                    <span className="flex items-center gap-1.5">
                      {/* 지역명 옆 동그라미 — the same three-colour band the movement
                          scatter uses, so one candidate reads identically on both. */}
                      <VariabilityDot movement={row.movement} />
                      <span className="block">500m 후보 구역</span>
                    </span>
                    <span className="block text-[11px] text-ink-subtle">{row.candidateKey}</span>
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
                  <td className="py-2.5 pr-3 text-right text-[13px] tabular-nums text-ink">
                    {formatScoreChange(row) ?? "—"}
                  </td>
                  <StabilityCell row={row} />
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* The screening-independence clause is NOT repeated here. The page closes with
          it once (`scenario-comparison-method-note`), and this footnote sat ~100px
          above that line saying the same thing in different words. What is left is
          the part only this table can state: what its two unfamiliar columns are. */}
      <p className="mt-3 text-[11px] leading-snug text-ink-subtle">
        · 순위는 스크리닝을 통과한 후보 구역 전체를 대상으로 매겨집니다. 실행 안정성은 분석 실행이
        미리 계산해 둔 값으로 A안·B안에서 같습니다.
      </p>
      <p
        className="mt-1 text-[11px] leading-snug text-ink-subtle"
        data-testid="scenario-ranking-table-grouping-note"
      >
        · {SIGUNGU_GROUPING_NOTE}
      </p>
    </div>
  );
}

/**
 * The three-colour rank-variability marker (`lib/rankVariability.ts`).
 *
 * Renders nothing when there is no exact movement — an unknown movement is NOT
 * stable, and a green dot would say it was.
 */
function VariabilityDot({ movement }: { movement: number | null }) {
  const level = rankVariabilityLevel(movement);
  if (level === null) return null;
  const meta = RANK_VARIABILITY_META[level];
  return (
    <span
      className="h-2 w-2 flex-none rounded-full"
      style={{ backgroundColor: meta.dot }}
      title={meta.label}
      data-testid="scenario-ranking-table-variability"
      data-variability={level}
    >
      <span className="sr-only">{meta.label}</span>
    </span>
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

/**
 * The RUN's stability class for this cell — the same value under A안 and B안.
 *
 * Deliberately NOT styled as a movement: no arrow, no colour scale, no A/B pairing.
 * A reader scanning the two rank columns must not read this as a third comparison.
 * An unserved class prints as 자료 없음, never as "안정적".
 */
function StabilityCell({ row }: { row: RankedCandidateRow }) {
  if (row.stabilityClass === null) {
    return (
      <td
        className="py-2.5 text-right text-[11px] text-ink-subtle"
        data-testid="scenario-ranking-table-stability"
      >
        자료 없음
      </td>
    );
  }
  return (
    <td
      className="py-2.5 text-right text-[12px] leading-snug text-ink-secondary"
      data-testid="scenario-ranking-table-stability"
      data-stability-class={row.stabilityClass}
    >
      {STABILITY_META[row.stabilityClass].primary}
    </td>
  );
}
