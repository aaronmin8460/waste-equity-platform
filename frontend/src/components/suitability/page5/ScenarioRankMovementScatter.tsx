"use client";

/**
 * 순위 변동 분포 — the frame's Row4-right card (167:10554 `SensitivityScatter`).
 *
 * ── THE FORM IS THE FRAME'S; THE CLAIM IS NOT ────────────────────────────────────
 * The frame titles this card 가중치 민감도 (결과 안정성) and plots a 변동성 axis with
 * bands 높음 (±10 이상) / 보통 (±5~9) / 낮음 (±4 이하). A sensitivity analysis is a
 * SWEEP: many weight vectors, and a spread per candidate. This product runs no sweep
 * — the backend previews exactly the two vectors the reader saved — so a card called
 * 민감도 would name an analysis that never ran, which is the one thing the Page-5
 * contract forbids most explicitly (PAGE_5B_RANKING_ANALYTICS.md §8).
 *
 * What IS measured is the rank difference between those two scenarios, per candidate.
 * That is a real, bounded, reproducible quantity, and it is exactly what the frame's
 * y-axis plots. So the scatter is kept and the LABEL is corrected: the card is
 * 순위 변동 분포, the axis is 순위 변화 폭, and the caption says in one line that this
 * is an A→B difference rather than a sensitivity band.
 *
 * ── ONLY MEASURED MOVEMENTS ARE PLOTTED ──────────────────────────────────────────
 * A point requires an EXACT rank on BOTH sides (`comparableRows`). A candidate served
 * by only one side has no movement to plot, and placing it at a guessed position — at
 * the axis floor, at `top_n + 1` — would put a fabricated point on a chart about
 * movement. Those candidates are named in the table below and in the full comparison
 * table, with their state stated (§6).
 *
 * ── MAGNITUDE, NOT MERIT ─────────────────────────────────────────────────────────
 * The frame colours its volatility bands red/amber/green. A candidate moving 12 places
 * is not "bad" and one holding its rank is not "good", so the bands use a single-hue
 * sequential ramp instead — the same reason the slope chart refuses red/green for
 * direction.
 */

import {
  RANKING_COMPARISON_TOP_N,
  formatRankMovement,
  type RankedCandidateRow,
  type ScenarioRankingComparison,
} from "../../../lib/scenarioRankingComparison";

export interface ScenarioRankMovementScatterProps {
  model: ScenarioRankingComparison;
}

/**
 * Movement bands. The frame's own thresholds (±10 / ±5~9 / ±4 이하), kept because they
 * are a reasonable reading of "how far did this move" and because matching them keeps
 * the card legible against the design. They describe a MEASURED movement, not a
 * modelled volatility.
 */
const BANDS = [
  { key: "LARGE", label: "큼", detail: "10계단 이상", min: 10, fill: "var(--color-primary)" },
  { key: "MEDIUM", label: "보통", detail: "5~9계단", min: 5, fill: "#5566a8" },
  { key: "SMALL", label: "작음", detail: "4계단 이하", min: 0, fill: "#aab2d0" },
] as const;

/** B안 rank groups — the frame's 상위권 / 중위권 / 하위권 columns. */
const COLUMNS = [
  { label: "상위권", detail: "1~10위", test: (rank: number) => rank <= 10 },
  { label: "중위권", detail: "11~30위", test: (rank: number) => rank > 10 && rank <= 30 },
  { label: "하위권", detail: "31위~", test: (rank: number) => rank > 30 },
] as const;

/** Rows are laid out by band (y) and B안 rank group (x). */
const ROWS = [
  { label: "변동", band: "LARGE" },
  { label: "보통", band: "MEDIUM" },
  { label: "안정적", band: "SMALL" },
] as const;

function bandOf(movement: number): (typeof BANDS)[number] {
  return BANDS.find((b) => movement >= b.min) ?? BANDS[BANDS.length - 1];
}

export default function ScenarioRankMovementScatter({ model }: ScenarioRankMovementScatterProps) {
  // Only rows with an exact rank on both sides can be placed at all.
  const points = model.comparableRows.filter(
    (row): row is RankedCandidateRow & { bRank: number; movement: number } =>
      row.bRank !== null && row.movement !== null,
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

  const cell = (bandKey: string, columnIndex: number) =>
    points.filter(
      (row) => bandOf(row.movement).key === bandKey && COLUMNS[columnIndex].test(row.bRank),
    );

  return (
    <div data-testid="scenario-ranking-scatter">
      <div className="flex gap-3">
        {/* ── the plot ─────────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <div className="flex">
            {/* y-axis captions, top (변동) to bottom (안정적) */}
            <div className="flex w-12 flex-none flex-col">
              {ROWS.map((row) => (
                <div
                  key={row.band}
                  className="flex flex-1 items-center justify-end pr-2 text-[11px] text-ink-subtle"
                >
                  {row.label}
                </div>
              ))}
            </div>

            <div className="min-w-0 flex-1 rounded-card border border-[var(--figma-rule)]">
              {ROWS.map((row, rowIndex) => (
                <div
                  key={row.band}
                  className={`grid min-h-[74px] grid-cols-3 ${
                    rowIndex < ROWS.length - 1 ? "border-b border-[var(--figma-rule)]" : ""
                  }`}
                >
                  {COLUMNS.map((column, columnIndex) => (
                    <div
                      key={column.label}
                      className={`flex flex-wrap content-start gap-1 p-1.5 ${
                        columnIndex < COLUMNS.length - 1
                          ? "border-r border-[var(--figma-rule)]"
                          : ""
                      }`}
                    >
                      {cell(row.band, columnIndex).map((point) => (
                        <span
                          key={point.candidateKey}
                          className="inline-flex max-w-full items-center gap-1 rounded-pill bg-surface-muted px-1.5 py-0.5 text-[10.5px] leading-tight text-ink"
                          // The whole identity, since the chip can only show the place.
                          title={`${point.locationLabel ?? "위치 정보 없음"} · ${point.candidateKey} · A안 ${point.aRank}위 → B안 ${point.bRank}위`}
                        >
                          <span
                            className="h-2 w-2 flex-none rounded-full"
                            style={{ backgroundColor: bandOf(point.movement).fill }}
                            aria-hidden="true"
                          />
                          <span className="truncate">
                            {point.locationLabel ?? point.candidateKey}
                          </span>
                          <span className="flex-none tabular-nums text-ink-subtle">
                            {formatRankMovement(point)}
                          </span>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* x-axis captions */}
          <div className="ml-12 grid grid-cols-3 pt-1.5">
            {COLUMNS.map((column) => (
              <div key={column.label} className="text-center">
                <span className="block text-[11.5px] font-bold text-ink">{column.label}</span>
                <span className="block text-[10.5px] tabular-nums text-ink-subtle">
                  ({column.detail})
                </span>
              </div>
            ))}
          </div>
          <p className="ml-12 pt-1 text-center text-[11px] text-ink-subtle">B안 순위</p>
        </div>

        {/* ── legend ───────────────────────────────────────────────────────── */}
        <dl className="w-[104px] flex-none self-start rounded-card bg-surface-muted p-2.5">
          <dt className="text-[11.5px] font-bold text-ink">순위 변화 폭</dt>
          {BANDS.map((band) => (
            <dd key={band.key} className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-ink-muted">
              <span
                className="h-2 w-2 flex-none rounded-full"
                style={{ backgroundColor: band.fill }}
                aria-hidden="true"
              />
              <span>
                {band.label}
                <span className="block tabular-nums text-ink-subtle">({band.detail})</span>
              </span>
            </dd>
          ))}
        </dl>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-ink-subtle">
        · 가로축은 B안에서의 순위, 세로축은 A안 대비 순위가 움직인 계단 수입니다. 양쪽 상위 목록에서
        순위가 모두 확인된 {points.length.toLocaleString("ko-KR")}개 후보 구역만 표시합니다.
      </p>
    </div>
  );
}
