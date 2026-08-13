"use client";

/**
 * 순위 변화가 큰 후보 구역 — the ranking-movement top list.
 *
 * ── ONLY EXACT-ON-BOTH-SIDES ROWS ARE RANKABLE ───────────────────────────────────
 * A row appears here only if the server sent a real `custom_rank` for it on BOTH
 * sides, so the ordering is by a movement that was measured rather than inferred. A
 * candidate present in one preview and absent from the other has no movement to be
 * "large", and admitting it with a stand-in rank would let a fabricated number take
 * the top row of a list captioned "가장 크게 움직인 후보". Those candidates are still
 * visible in the full comparison table below, with their state named.
 *
 * Rows that did not move at all are excluded too — a 0-place movement is not a
 * "ranking change", and padding the list with holds would misrepresent how much the
 * reweighting actually did.
 */

import {
  RANKING_MOVEMENT_LIST_SIZE,
  formatRankMovement,
  type RankedCandidateRow,
  type ScenarioRankingComparison,
} from "../../../lib/scenarioRankingComparison";

export interface ScenarioRankMovementListProps {
  rows: RankedCandidateRow[];
  model: ScenarioRankingComparison;
}

/** Navy for a rise, secondary ink for a fall. Direction is always also in words. */
const MOVEMENT_CLASS: Record<"UP" | "DOWN" | "SAME", string> = {
  UP: "text-primary",
  DOWN: "text-ink-secondary",
  SAME: "text-ink-subtle",
};

export default function ScenarioRankMovementList({
  rows,
  model,
}: ScenarioRankMovementListProps) {
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-ink-muted" data-testid="scenario-ranking-movement-empty">
        {model.comparableRows.length === 0
          ? "A안과 B안 상위 목록에 함께 나타난 후보 구역이 없어 순위 변화를 계산할 수 없습니다."
          : "양쪽 상위 목록에 함께 나타난 후보 구역의 순위가 모두 그대로입니다."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="scenario-ranking-movement">
      <table className="w-full min-w-[420px] border-collapse text-left">
        <caption className="sr-only">
          A안과 B안 양쪽에서 순위가 확인된 후보 구역 중 순위 변화가 큰 상위{" "}
          {RANKING_MOVEMENT_LIST_SIZE}개
        </caption>
        <thead>
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
            <th scope="col" className="py-2 text-right font-semibold">
              순위 변화
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.candidateKey}
              className="border-b border-hairline last:border-b-0"
              data-testid="scenario-ranking-movement-row"
              data-direction={row.direction ?? ""}
            >
              <th scope="row" className="py-2 pr-3 text-[13px] font-normal text-ink">
                {/* The scored object is a 500 m cell, so the 시·군·구 is stated as a
                    LOCATION and the cell's own key is always beside it. */}
                <span className="block">{row.locationLabel ?? "위치 정보 없음"}</span>
                <span className="block text-[11px] text-ink-subtle">
                  500m 후보 구역 · {row.candidateKey}
                </span>
              </th>
              <td className="py-2 pr-3 text-right text-[13px] tabular-nums text-ink">
                {row.aRank}위
                <span className="block text-[11px] text-ink-subtle">{row.aScore}점</span>
              </td>
              <td className="py-2 pr-3 text-right text-[13px] tabular-nums text-ink">
                {row.bRank}위
                <span className="block text-[11px] text-ink-subtle">{row.bScore}점</span>
              </td>
              <td
                className={`py-2 text-right text-[13px] font-semibold tabular-nums ${
                  MOVEMENT_CLASS[row.direction ?? "SAME"]
                }`}
                data-testid="scenario-ranking-movement-delta"
              >
                {formatRankMovement(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
