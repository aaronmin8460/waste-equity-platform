"use client";

/**
 * 순위 변동 분포 — the frame's Row4-right card (167:10554 `SensitivityScatter`).
 *
 * ── THE FORM IS THE FRAME'S; THE CLAIM IS NOT ────────────────────────────────────
 * The frame titles this card 가중치 민감도 (결과 안정성). A sensitivity analysis is a
 * SWEEP: many weight vectors, and a spread per candidate. This product runs no sweep
 * — the backend previews exactly the two vectors the reader saved — so a card called
 * 민감도 would name an analysis that never ran.
 *
 * The page-5 기술 참고사항 SANCTIONS the two-point form directly. `167-11229` gives
 * `순위 변화 = B안 순위 − A안 순위` for the "단순 A안→B안 비교만 할 경우", and
 * `167-11235` gives `순위 변동성 = |A안 순위 − B안 순위|` for "A/B 두 안만 비교한다면",
 * with `X축 = 평균 순위 또는 B안 기준 순위`. This card is exactly that branch of the
 * spec: X is B안 기준 순위, Y is |A − B|, and the honest title 순위 변동 분포 is kept
 * so the card never claims the sweep it is the documented fallback for.
 *
 * ── 시·군·구 IS THE GROUPING KEY; THE CANDIDATE IS THE OBSERVATION ───────────────
 * `359:1384` asks for "군 단위로 합치기" and complains about a flat list
 * ("네모칸 안에 쫘르륵 리스트업 되어 있는 형식 말고"), and the owner requires the same:
 * the 시·군·구 name is stated ONCE as a group heading rather than reprinted on every
 * chip.
 *
 * ⛔ WHAT IS DELIBERATELY NOT DONE. `167-11235` illustrates the roll-up with
 * "안산시: 평균 순위 2위 / 변동폭 2" — a per-시·군·구 AVERAGE RANK. The owner has
 * explicitly forbidden a 시·군·구 average, median or synthetic group rank, and by the
 * standing priority order (owner's explicit requirement > Figma annotation > Figma
 * visual) the owner's rule wins. So a group heading carries its NAME and a COUNT OF
 * ROWS and nothing else: no group score, no group rank, no group 변동폭. Each chip
 * keeps its own A안 rank, B안 rank and movement, and the same sheet's own words back
 * this up — "각 점 = 후보지역 1개". `lib/scenarioSigunguGroups.ts` enforces it.
 *
 * ── MAGNITUDE BANDS ──────────────────────────────────────────────────────────────
 * The three-colour marker beside each name is `lib/rankVariability.ts`, whose
 * thresholds and palette come from `167-11232` (±4 초록 / ±5~9 노랑 / ±10 이상 빨강,
 * `STABLE_THRESHOLD = 4`, `MEDIUM_THRESHOLD = 9`). That sheet states plainly that
 * these are UI constants rather than official policy thresholds, and the card says so
 * too. They describe a MEASURED two-point movement, not a modelled volatility, and
 * they are not the run's own frozen `stability_class`.
 *
 * ── ONLY MEASURED MOVEMENTS ARE PLOTTED ──────────────────────────────────────────
 * A point requires an EXACT rank on BOTH sides (`comparableRows`). A candidate served
 * by only one side has no movement to plot, and placing it at a guessed position — at
 * the axis floor, at `top_n + 1` — would put a fabricated point on a chart about
 * movement. Those candidates are named in the comparison table below, with their
 * state stated.
 */

import {
  RANKING_COMPARISON_TOP_N,
  formatRankMovement,
  type RankedCandidateRow,
  type ScenarioRankingComparison,
} from "../../../lib/scenarioRankingComparison";
import {
  RANK_VARIABILITY_META,
  RANK_VARIABILITY_ORDER,
  RANK_VARIABILITY_SOURCE_NOTE,
  rankVariabilityLevel,
  type RankVariabilityLevel,
} from "../../../lib/rankVariability";
import {
  SIGUNGU_GROUPING_NOTE,
  groupRowsBySigungu,
} from "../../../lib/scenarioSigunguGroups";

export interface ScenarioRankMovementScatterProps {
  model: ScenarioRankingComparison;
}

/** B안 rank groups — the frame's 상위권 / 중위권 / 하위권 columns (`167-11235`). */
const COLUMNS = [
  { label: "상위권", detail: "1~10위", test: (rank: number) => rank <= 10 },
  { label: "중위권", detail: "11~30위", test: (rank: number) => rank > 10 && rank <= 30 },
  { label: "하위권", detail: "31위~", test: (rank: number) => rank > 30 },
] as const;

/** Plot rows, top (변동성 높음) to bottom (안정성 높음) — the frame's own y order. */
const ROWS: readonly RankVariabilityLevel[] = ["VOLATILE", "MEDIUM", "STABLE"];

/** A row that can actually be placed: an exact rank on both sides. */
type PlottableRow = RankedCandidateRow & { bRank: number; movement: number };

export default function ScenarioRankMovementScatter({ model }: ScenarioRankMovementScatterProps) {
  // Only rows with an exact rank on both sides can be placed at all.
  const points = model.comparableRows.filter(
    (row): row is PlottableRow => row.bRank !== null && row.movement !== null,
  );

  if (points.length === 0) {
    // No axes, no empty grid. A blank plot under 순위 변동 분포 reads as
    // "every candidate held its rank", which is a finding this data cannot support.
    return (
      <p className="text-[13px] leading-snug text-ink-muted" data-testid="scenario-ranking-scatter-empty">
        {model.comparableRows.length === 0
          ? `A안과 B안의 상위 ${RANKING_COMPARISON_TOP_N * 5}개 목록에 함께 나타난 후보 구역이 없어 순위 변화 폭을 그릴 수 없습니다. 두 시나리오가 서로 다른 후보 구역을 상위로 올렸다는 뜻입니다.`
          : "양쪽에서 순위가 확인된 후보 구역이 있으나 순위 변화 폭을 계산할 수 없습니다."}
      </p>
    );
  }

  /**
   * THE PLOT IS A GRID OF COORDINATES; THE 시·군·구 IS THE LABEL INSIDE A CELL.
   *
   * Two requirements meet here and both are satisfiable at once:
   *   - `359:1384` asks for "지역명이 좌표로 찍히도록. 네모칸 안에 쫘르륵 리스트업 되어
   *     있는 형식 말고" — a coordinate plot, not a list;
   *   - the owner requires the 시·군·구 to be the visual GROUPING KEY, stated once
   *     rather than reprinted on every candidate.
   *
   * So the axes stay (x = B안 순위권, y = 순위 변화 폭, exactly the two `167-11235`
   * names) and the GROUPING happens INSIDE each cell: a cell's candidates are grouped
   * under their 시·군·구 name, printed once. What the owner objected to — a column of
   * identical "인천광역시 옹진군" chips — is gone, and the plot the annotation asked
   * for is not traded away for a flat list.
   */
  const cellGroups = (bandKey: RankVariabilityLevel, columnIndex: number) =>
    groupRowsBySigungu(
      points.filter(
        (row) =>
          rankVariabilityLevel(row.movement) === bandKey && COLUMNS[columnIndex].test(row.bRank),
      ),
    );

  return (
    <div data-testid="scenario-ranking-scatter">
      <div className="flex gap-3">
        {/* ── the plot ─────────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <div className="flex">
            {/* y-axis captions, top (변동성 높음) to bottom (안정성 높음) */}
            <div className="flex w-14 flex-none flex-col">
              {ROWS.map((row) => (
                <div
                  key={row}
                  className="flex flex-1 items-center justify-end pr-2 text-right text-[11px] leading-tight text-ink-subtle"
                >
                  {RANK_VARIABILITY_META[row].label}
                </div>
              ))}
            </div>

            <div className="min-w-0 flex-1 rounded-card border border-[var(--figma-rule)]">
              {ROWS.map((band, rowIndex) => (
                <div
                  key={band}
                  className={`grid min-h-[74px] grid-cols-3 ${
                    rowIndex < ROWS.length - 1 ? "border-b border-[var(--figma-rule)]" : ""
                  }`}
                >
                  {COLUMNS.map((column, columnIndex) => (
                    <div
                      key={column.label}
                      className={`flex flex-col gap-1 p-1.5 ${
                        columnIndex < COLUMNS.length - 1
                          ? "border-r border-[var(--figma-rule)]"
                          : ""
                      }`}
                    >
                      {cellGroups(band, columnIndex).map((group) => (
                        <div
                          key={group.key}
                          data-testid="scenario-ranking-scatter-group"
                          data-sigungu={group.key}
                        >
                          {/* THE 시·군·구, ONCE. Its 시·도 rides alongside as quiet
                              context, and the only group-level number is a COUNT of
                              rows — never an average rank, median or group score. */}
                          <p className="flex flex-wrap items-baseline gap-x-1 text-[10.5px] leading-tight">
                            <span
                              className="font-bold text-ink"
                              data-testid="scenario-ranking-scatter-group-name"
                            >
                              {group.label}
                            </span>
                            {group.sidoLabel !== null && (
                              <span className="text-ink-subtle">{group.sidoLabel}</span>
                            )}
                            <span
                              className="tabular-nums text-ink-subtle"
                              data-testid="scenario-ranking-scatter-group-count"
                            >
                              {group.size.toLocaleString("ko-KR")}곳
                            </span>
                          </p>
                          <ul className="mt-0.5 flex flex-wrap gap-1">
                            {group.rows.map((point) => {
                              const level = rankVariabilityLevel(point.movement);
                              const meta = level === null ? null : RANK_VARIABILITY_META[level];
                              return (
                                <li key={point.candidateKey}>
                                  <span
                                    className="inline-flex max-w-full items-center gap-1 rounded-pill bg-surface-muted px-1.5 py-0.5 text-[10.5px] leading-tight text-ink"
                                    // The whole identity, since the chip shows only
                                    // the cell key and its movement.
                                    title={`${point.locationLabel ?? "위치 정보 없음"} · ${point.candidateKey} · A안 ${point.aRank}위 → B안 ${point.bRank}위${
                                      meta === null ? "" : ` · ${meta.label}`
                                    }`}
                                    data-testid="scenario-ranking-scatter-point"
                                    data-variability={level ?? undefined}
                                  >
                                    {/* 지역명 옆 동그라미 아이콘 — the annotation's own
                                        shape. The band name rides in the title and in
                                        the legend, so colour is never the only
                                        carrier. */}
                                    {meta !== null && (
                                      <span
                                        className="relative h-2 w-2 flex-none rounded-full"
                                        style={{ backgroundColor: meta.dot }}
                                        aria-hidden="true"
                                      />
                                    )}
                                    <span className="truncate">{point.candidateKey}</span>
                                    <span className="flex-none tabular-nums text-ink-subtle">
                                      {formatRankMovement(point)}
                                    </span>
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* x-axis captions — the sheet's own 상위권 / 중위권 / 하위권 bands. */}
          <div className="ml-14 grid grid-cols-3 pt-1.5">
            {COLUMNS.map((column) => (
              <div key={column.label} className="text-center">
                <span className="block text-[11.5px] font-bold text-ink">{column.label}</span>
                <span className="block text-[10.5px] tabular-nums text-ink-subtle">
                  ({column.detail})
                </span>
              </div>
            ))}
          </div>
          <p className="ml-14 pt-1 text-center text-[11px] text-ink-subtle">B안 순위</p>
        </div>

        {/* ── the 3-colour key ─────────────────────────────────────────────── */}
        <dl
          className="w-[112px] flex-none self-start rounded-card bg-surface-muted p-2.5"
          data-testid="scenario-ranking-variability-legend"
        >
          <dt className="text-[11.5px] font-bold text-ink">순위 변화 폭</dt>
          {RANK_VARIABILITY_ORDER.map((level) => {
            const meta = RANK_VARIABILITY_META[level];
            return (
              <dd key={level} className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-ink-muted">
                <span
                  className="relative h-2 w-2 flex-none rounded-full"
                  style={{ backgroundColor: meta.dot }}
                  aria-hidden="true"
                />
                <span>
                  {meta.label}
                  <span className="block tabular-nums text-ink-subtle">({meta.detail})</span>
                </span>
              </dd>
            );
          })}
        </dl>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-ink-subtle">
        · 후보 구역별 A안 순위와 B안 순위, 그리고 그 차이입니다. 양쪽 상위 목록에서 순위가 모두 확인된{" "}
        {points.length.toLocaleString("ko-KR")}개 후보 구역만 표시합니다.
      </p>
      <p className="mt-1 text-[11px] leading-snug text-ink-subtle" data-testid="scenario-ranking-grouping-note">
        · {SIGUNGU_GROUPING_NOTE}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-ink-subtle" data-testid="scenario-ranking-variability-note">
        · {RANK_VARIABILITY_SOURCE_NOTE}
      </p>
    </div>
  );
}
