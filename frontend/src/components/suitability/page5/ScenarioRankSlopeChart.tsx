"use client";

/**
 * A → B 순위 이동 — the slope visualization (Figma 167:10554 `SlopeChart`).
 *
 * Two ranked columns, one line per candidate cell. The frame draws exactly this,
 * with 10 municipalities per side; the departures from it are all about what a line
 * is allowed to CLAIM.
 *
 * ── THE POPULATION IS A NAMED, BOUNDED UNION ─────────────────────────────────────
 * The union of A's top-N and B's top-N (`RANKING_COMPARISON_TOP_N`), so a candidate
 * that left the top N and one that entered it are both drawn — they are the most
 * informative lines on the chart and an intersection-only view would drop exactly
 * them. This is NOT a population-wide slope chart: the preview serves a top-N cut,
 * so a line for every ranked candidate is not available and is not implied.
 *
 * ── A NUMERIC ENDPOINT ONLY WHERE AN EXACT RANK EXISTS ───────────────────────────
 * Three endpoint kinds, and they look different:
 *   1. an exact rank inside the top N   → a numbered node in its slot;
 *   2. an exact rank outside the top N  → a node in the 상위 N 밖 band, labelled
 *      with the REAL rank the server sent (e.g. "27위") and reached by a dashed line;
 *   3. no served rank at all            → a node in the same band labelled with the
 *      honest unavailability wording, never a number.
 * Nothing is ever placed at a guessed rank, and no line is drawn to a fabricated
 * position at the bottom of the axis.
 *
 * ── DIRECTION IS TEXT, NEVER COLOUR ALONE ────────────────────────────────────────
 * Every line's meaning is also written out in the accompanying table, and the
 * per-line `<title>` states it in words. The stroke uses the project's navy/blue and
 * grey — an upward move is not "good" and a downward move is not "bad", so the
 * red/green reading a semantic palette would invite is deliberately avoided.
 *
 * ── ACCESSIBILITY ────────────────────────────────────────────────────────────────
 * The SVG is decorative-by-duplication: it is `aria-hidden`, and the same rows are
 * rendered as a real `<table>` that is visually hidden. A screen-reader user gets
 * the complete data, not a chart summary.
 */

import {
  RANKING_COMPARISON_TOP_N,
  formatRankMovement,
  formatUnavailableRank,
  type RankBoundary,
  type ScenarioSlopeRow,
} from "../../../lib/scenarioRankingComparison";

export interface ScenarioRankSlopeChartProps {
  rows: ScenarioSlopeRow[];
  boundaryA: RankBoundary;
  boundaryB: RankBoundary;
}

// Geometry, matching the frame's `SlopeChart` (700×340, lane pitch 34). The frame
// labels a lane with one short line — "1  안산시" — and hangs the score change off the
// B column. The previous two-line label carried the full `capital-grid-500m-v1:…` key
// on every node, which at 1440 is wider than the column it sits in: the labels
// collided and the chart grew past 700px tall. The key is still reachable, in the
// node's `<title>` and in the screen-reader table below, where it is not competing
// for horizontal space with nine other rows.
const LANE_HEIGHT = 34;
/**
 * The 상위 N 밖 band packs tighter than the numbered slots. Its nodes carry one short
 * label and no rank numeral, and there can be up to 2N of them when the two cuts are
 * disjoint — at the full 34px pitch that alone was ~680px of chart.
 */
const BAND_LANE_HEIGHT = 20;
const TOP_PAD = 16;
const BOTTOM_PAD = 14;
const VIEW_WIDTH = 700;
const NODE_A_X = 250;
const NODE_B_X = 430;
const LABEL_A_X = NODE_A_X - 12;
const LABEL_B_X = NODE_B_X + 12;
/** Where the "84.2 → 94.1" score-change string sits, right of the B labels. */
const SCORE_X = VIEW_WIDTH - 4;
/** Gap between the last rank slot and the 상위 N 밖 band, in lanes. */
const BAND_GAP = 0.7;

/** Navy for a rise, mid-grey for a fall, faint for a hold — never red/green. */
const STROKE = {
  UP: "var(--color-primary)",
  DOWN: "var(--color-ink-secondary)",
  SAME: "var(--color-hairline, #e3e5ec)",
} as const;

interface PlacedRow {
  row: ScenarioSlopeRow;
  yA: number;
  yB: number;
  /** True when that endpoint sits in the 밖 band rather than a numbered slot. */
  outA: boolean;
  outB: boolean;
}

export default function ScenarioRankSlopeChart({
  rows,
  boundaryA,
  boundaryB,
}: ScenarioRankSlopeChartProps) {
  if (rows.length === 0) {
    // Nothing to draw and nothing to caption. An empty axis under the heading
    // "순위 이동" would read as "no candidate moved", which is a finding.
    return (
      <p className="text-[13px] text-ink-muted" data-testid="scenario-ranking-slope-empty">
        양쪽 시나리오에서 상위 {RANKING_COMPARISON_TOP_N}위 후보 구역이 확인되지 않아 순위 이동을 그릴 수
        없습니다.
      </p>
    );
  }

  const slotY = (slot: number) => TOP_PAD + (slot - 1) * LANE_HEIGHT;

  // Out-of-band endpoints stack in the order the rows are already in (A slot, then
  // B slot, then key), so the picture is stable for identical inputs.
  let outA = 0;
  let outB = 0;
  const placed: PlacedRow[] = rows.map((row) => {
    const bandY = (index: number) =>
      TOP_PAD +
      (RANKING_COMPARISON_TOP_N - 1 + BAND_GAP) * LANE_HEIGHT +
      index * BAND_LANE_HEIGHT;
    const yA = row.aSlot !== null ? slotY(row.aSlot) : bandY(outA++);
    const yB = row.bSlot !== null ? slotY(row.bSlot) : bandY(outB++);
    return { row, yA, yB, outA: row.aSlot === null, outB: row.bSlot === null };
  });

  const bandLanes = Math.max(outA, outB);
  const height =
    TOP_PAD +
    (RANKING_COMPARISON_TOP_N - 1 + (bandLanes > 0 ? BAND_GAP : 0)) * LANE_HEIGHT +
    bandLanes * BAND_LANE_HEIGHT +
    BOTTOM_PAD;
  const bandTop = TOP_PAD + (RANKING_COMPARISON_TOP_N - 1 + BAND_GAP / 2) * LANE_HEIGHT + 6;

  return (
    <div data-testid="scenario-ranking-slope">
      <div className="flex items-center justify-between text-[11px] font-semibold text-ink-muted">
        <span>A안 순위</span>
        <span>B안 순위</span>
      </div>

      <div className="mt-1 overflow-x-auto">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
          className="h-auto w-full min-w-[560px]"
          aria-hidden="true"
          focusable="false"
        >
          {/* The 상위 N 밖 band: a labelled region, so a node below the rule is never
              mistaken for rank N+1. */}
          {bandLanes > 0 ? (
            <>
              <line
                x1={0}
                x2={VIEW_WIDTH}
                y1={bandTop}
                y2={bandTop}
                stroke="var(--color-hairline, #e3e5ec)"
                strokeDasharray="3 3"
              />
              <text
                x={VIEW_WIDTH / 2}
                y={bandTop - 5}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-ink-subtle)"
              >
                상위 {RANKING_COMPARISON_TOP_N} 밖
              </text>
            </>
          ) : null}

          {placed.map(({ row, yA, yB, outA: isOutA, outB: isOutB }) => {
            const direction = row.direction ?? "SAME";
            // A dashed line means at least one endpoint is not a top-N slot, so the
            // slope's steepness is not a like-for-like reading.
            const dashed = isOutA || isOutB;
            return (
              <g key={row.candidateKey}>
                <line
                  x1={NODE_A_X}
                  y1={yA}
                  x2={NODE_B_X}
                  y2={yB}
                  stroke={STROKE[direction]}
                  strokeWidth={direction === "SAME" ? 1.5 : 2}
                  strokeDasharray={dashed ? "4 3" : undefined}
                />
                <circle cx={NODE_A_X} cy={yA} r={3.5} fill={STROKE[direction]} />
                <circle cx={NODE_B_X} cy={yB} r={3.5} fill={STROKE[direction]} />

                {/* The whole identity — cell key included — on hover/focus, so
                    shortening the visible label loses no information. */}
                <title>
                  {`${row.locationLabel ?? "위치 정보 없음"} · ${row.candidateKey} · ` +
                    `A안 ${row.aRank !== null ? `${row.aRank}위` : formatUnavailableRank(row.aRankState, "A", boundaryA)} → ` +
                    `B안 ${row.bRank !== null ? `${row.bRank}위` : formatUnavailableRank(row.bRankState, "B", boundaryB)}`}
                </title>

                {/* A node in the 밖 band is labelled with the CELL, not with the band
                    it is in: the band already carries "상위 N 밖" on its divider, and
                    repeating it per node produced ten identical labels that named no
                    candidate at all. The precise state wording stays in the <title>
                    above and in the screen-reader table below. */}
                <SideLabel
                  x={LABEL_A_X}
                  y={yA}
                  anchor="end"
                  rank={row.aRank}
                  text={row.locationLabel ?? row.candidateKey}
                />
                <SideLabel
                  x={LABEL_B_X}
                  y={yB}
                  anchor="start"
                  rank={row.bRank}
                  text={row.locationLabel ?? row.candidateKey}
                />

                {/* The frame's score-change string, right-aligned on the B row. Only
                    when BOTH sides served a score — "69.2500 → 자료 없음" is not a
                    change, and printing one side alone would read as one. */}
                {row.aScore !== null && row.bScore !== null ? (
                  <text
                    x={SCORE_X}
                    y={yB + 4}
                    textAnchor="end"
                    fontSize={11}
                    fill="var(--color-ink-subtle)"
                  >
                    {`${row.aScore} → ${row.bScore}`}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      {/* The same rows, in full, for assistive technology and for anyone who needs
          the exact figures rather than the shape. */}
      <table className="sr-only" data-testid="scenario-ranking-slope-table">
        <caption>A안과 B안 상위 {RANKING_COMPARISON_TOP_N}위 후보 구역의 순위 이동</caption>
        <thead>
          <tr>
            <th scope="col">후보 구역</th>
            <th scope="col">위치</th>
            <th scope="col">A안 순위</th>
            <th scope="col">B안 순위</th>
            <th scope="col">순위 변화</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.candidateKey}>
              <th scope="row">{row.candidateKey}</th>
              <td>{row.locationLabel ?? "위치 정보 없음"}</td>
              <td>
                {row.aRank !== null
                  ? `${row.aRank}위`
                  : formatUnavailableRank(row.aRankState, "A", boundaryA)}
              </td>
              <td>
                {row.bRank !== null
                  ? `${row.bRank}위`
                  : formatUnavailableRank(row.bRankState, "B", boundaryB)}
              </td>
              <td>{formatRankMovement(row) ?? "비교할 수 없음"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One lane label, on ONE line — the frame's "1  안산시".
 *
 * The rank numeral is drawn as a separate, tabular run so the ten numerals line up in
 * a column instead of drifting with the place name's width, which is what makes the
 * frame's two ranked columns read as columns.
 */
function SideLabel({
  x,
  y,
  anchor,
  rank,
  text,
}: {
  x: number;
  y: number;
  anchor: "start" | "end";
  rank: number | null;
  text: string;
}) {
  return (
    <text x={x} y={y + 4} textAnchor={anchor} fontSize={12} fill="var(--color-ink)">
      {rank !== null ? (
        <>
          <tspan fontWeight={700}>{rank}</tspan>
          <tspan dx={6} fill="var(--color-ink-muted)">
            {text}
          </tspan>
        </>
      ) : (
        <tspan fill="var(--color-ink-subtle)">{text}</tspan>
      )}
    </text>
  );
}
