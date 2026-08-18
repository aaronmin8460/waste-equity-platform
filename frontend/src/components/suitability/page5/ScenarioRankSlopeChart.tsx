"use client";

/**
 * A → B 순위 이동 — the slope visualization (Figma 167:10554 `SlopeChart`).
 *
 * Two columns, ONE LINE PER 시·군·구 — which is what the frame draws too ("10
 * municipalities per side"). The departures from it are all about what a line is
 * allowed to CLAIM.
 *
 * ── THE LINE IS A MUNICIPALITY, THE NODE IS A REAL CELL ──────────────────────────
 * Each side lists a 시·군·구 at most once, standing for it with the highest-ranked
 * real candidate cell that side has. The two sides may pick DIFFERENT cells for one
 * municipality — reweighting can promote a different 양평군 cell — so a line per
 * candidate would split 양평군 into a departure and an arrival it never made. The
 * line is therefore the municipality, and each endpoint carries that side's own
 * representative cell with its own real rank and score.
 *
 * ── THE SLOT IS A POSITION; THE LABEL IS A RANK ──────────────────────────────────
 * A node's vertical slot is a DISPLAY POSITION (1..N). What is printed beside it is
 * the representative's REAL `custom_rank`, because on the live V3 run position 10
 * belongs to the candidate ranked 2,190th of 13,734 — so the numeral and the rank
 * must never be read as the same thing. Three endpoint kinds, and they look
 * different:
 *   1. shown by this side          → a numbered node in its slot, labelled with the
 *      representative's real rank;
 *   2. not shown, but still ranked → a node in the 한쪽 목록에만 있음 band, labelled
 *      "목록 밖 · 11위" with the REAL rank the server sent, reached by a dashed line;
 *   3. no served rank at all       → a node in the same band labelled with the
 *      honest unavailability wording, never a number.
 * Nothing is ever placed at a guessed position, and no line is drawn to a fabricated
 * one at the bottom of the axis.
 *
 ── DIRECTION IS TEXT AS WELL AS COLOUR ─────────────────────────────────────────
 * Every line's meaning is written out in the accompanying table, and the per-line
 * `<title>` states it in words, so the stroke is never the only carrier.
 *
 * THE PALETTE IS THE ANNOTATION'S. Page-5's 수정 요청 (`359:1384`) asks for
 * "[후보지 순위 변화 TOP 10] … 순위 상승 = 빨간색 / 하락 = 파란색". An earlier pass
 * used navy-for-up / grey-for-down, reasoning that an upward move is not "good" and a
 * red/green reading should be avoided; the requested pair is red/BLUE rather than
 * red/green, which carries no good-bad valence in the first place, and the owner has
 * asked for it explicitly. So 상승 is red and 하락 is blue, and a hold stays faint.
 *
 * ⚠️ This is the OPPOSITE polarity from Page 2's monthly-trend requirement
 * (최저 = 빨강 / 최고 = 파랑). The two are different annotations about different
 * quantities and must NOT be unified into one "semantic" scale — a change to either
 * palette is a change to that page only.
 *
 * ── ACCESSIBILITY ────────────────────────────────────────────────────────────────
 * The SVG is decorative-by-duplication: it is `aria-hidden`, and the same rows are
 * rendered as a real `<table>` that is visually hidden. A screen-reader user gets
 * the complete data, not a chart summary.
 */

import {
  RANKING_COMPARISON_TOP_N,
  type RankedCandidateRow,
  type ScenarioRepresentativeRow,
} from "../../../lib/scenarioRankingComparison";

export interface ScenarioRankSlopeChartProps {
  rows: ScenarioRepresentativeRow[];
}

/** One side's rank for one cell — "1,058위" — or nothing. Never guessed or padded. */
function rankOf(candidate: RankedCandidateRow | null, side: "a" | "b"): string | null {
  if (candidate === null) return null;
  const rank = side === "a" ? candidate.aRank : candidate.bRank;
  return rank === null ? null : `${rank.toLocaleString("ko-KR")}위`;
}

/**
 * What one endpoint says about a 시·군·구 on one side.
 *
 * When this side shows the municipality, its own representative's real rank. When it
 * does NOT, the OTHER side's representative cell may still carry a real, served rank
 * on this side — a fact worth printing rather than dropping, so the reader can see
 * how far out the municipality fell instead of only that it left. Only when neither
 * is available does this say so in words, never with a number.
 */
function endpointText(row: ScenarioRepresentativeRow, side: "a" | "b"): string {
  const own = rankOf(side === "a" ? row.a : row.b, side);
  if (own !== null) return own;
  const fromOther = rankOf(side === "a" ? row.b : row.a, side);
  return fromOther === null ? "목록에 없음" : `목록 밖 · ${fromOther}`;
}

/** The A→B movement of a 시·군·구's DISPLAY POSITION, in words. */
function slotMovementText(row: ScenarioRepresentativeRow): string {
  if (row.slotDirection === null || row.slotMovement === null) {
    // One side does not show this 시·군·구, so there are not two positions to
    // subtract. That is an absence, not a movement of zero.
    if (row.aSlot === null) return "B안에서만 표시";
    return "A안에서만 표시";
  }
  if (row.slotDirection === "SAME") return "표시 위치 유지";
  const verb = row.slotDirection === "UP" ? "위로" : "아래로";
  return `${verb} ${row.slotMovement}칸`;
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

/**
 * 상승 = 빨강, 하락 = 파랑, 유지 = 옅은 회색 — the `359:1384` annotation's own pair.
 * See the header for why red/blue is adopted where red/green was refused.
 */
const STROKE = {
  UP: "var(--color-danger)",
  DOWN: "#1d4ed8",
  SAME: "var(--color-hairline, #e3e5ec)",
} as const;

interface PlacedRow {
  row: ScenarioRepresentativeRow;
  yA: number;
  yB: number;
  /** True when that endpoint sits in the 밖 band rather than a numbered slot. */
  outA: boolean;
  outB: boolean;
}

export default function ScenarioRankSlopeChart({ rows }: ScenarioRankSlopeChartProps) {
  if (rows.length === 0) {
    // Nothing to draw and nothing to caption. An empty axis under the heading
    // "순위 이동" would read as "no candidate moved", which is a finding.
    return (
      <p className="text-[13px] text-ink-muted" data-testid="scenario-ranking-slope-empty">
        양쪽 시나리오에서 비교할 시·군·구가 확인되지 않아 순위 이동을 그릴 수 없습니다.
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
                {/* NOT "상위 N 밖": the band holds 시·군·구 the OTHER side did not
                    show in its visible list. Their candidates still have real ranks,
                    printed on the node, so calling the band a rank cut would be
                    a claim about the ranking that this list does not make. */}
                한쪽 목록에만 있음
              </text>
            </>
          ) : null}

          {placed.map(({ row, yA, yB, outA: isOutA, outB: isOutB }) => {
            const direction = row.slotDirection ?? "SAME";
            // A dashed line means one side does not show this 시·군·구 at all, so the
            // slope's steepness is not a like-for-like reading.
            const dashed = isOutA || isOutB;
            // The A-side score and the B-side score belong to that side's OWN
            // representative cell, which may be a different cell of the same 시·군·구.
            const aScore = row.a?.aScore ?? null;
            const bScore = row.b?.bScore ?? null;
            return (
              <g key={row.groupKey}>
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

                {/* The whole identity on hover/focus — including WHICH cell each side
                    chose to stand for this 시·군·구, which the one-line labels cannot
                    carry and which is the thing a reader is most likely to doubt. */}
                <title>
                  {`${row.sidoLabel !== null ? `${row.sidoLabel} ` : ""}${row.label} · ` +
                    `A안 ${row.a !== null ? `${row.a.candidateKey} ` : ""}${endpointText(row, "a")} → ` +
                    `B안 ${row.b !== null ? `${row.b.candidateKey} ` : ""}${endpointText(row, "b")} · ` +
                    slotMovementText(row)}
                </title>

                {/* The numeral is the DISPLAY POSITION (it is what makes the two
                    columns read as columns); the real candidate rank is printed
                    beside the place name, because position 10 can belong to a
                    candidate ranked 2,190th and the two must never be confused. */}
                <SideLabel
                  x={LABEL_A_X}
                  y={yA}
                  anchor="end"
                  position={row.aSlot}
                  text={`${row.label} · ${endpointText(row, "a")}`}
                />
                <SideLabel
                  x={LABEL_B_X}
                  y={yB}
                  anchor="start"
                  position={row.bSlot}
                  text={`${row.label} · ${endpointText(row, "b")}`}
                />

                {/* The frame's score-change string, right-aligned on the B row. Only
                    when BOTH sides served a score — "69.2500 → 자료 없음" is not a
                    change, and printing one side alone would read as one. */}
                {aScore !== null && bScore !== null ? (
                  <text
                    x={SCORE_X}
                    y={yB + 4}
                    textAnchor="end"
                    fontSize={11}
                    fill="var(--color-ink-subtle)"
                  >
                    {`${aScore} → ${bScore}`}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      {/* WHAT THE TWO STROKE COLOURS MEAN, in words. The annotation asks for the
          colours; this line is what keeps them from being the only carrier for a
          sighted reader who has not opened the table below. */}
      <ul
        className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted"
        data-testid="scenario-ranking-slope-legend"
      >
        {(
          [
            { key: "UP", label: "순위 상승" },
            { key: "DOWN", label: "순위 하락" },
            { key: "SAME", label: "순위 유지" },
          ] as const
        ).map((entry) => (
          <li key={entry.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-0.5 w-4 flex-none rounded-pill"
              style={{ backgroundColor: STROKE[entry.key] }}
            />
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>

      {/* The same rows, in full, for assistive technology and for anyone who needs
          the exact figures rather than the shape. */}
      <table className="sr-only" data-testid="scenario-ranking-slope-table">
        <caption>
          A안과 B안이 각각 상위 {RANKING_COMPARISON_TOP_N}개까지 보여 주는 시·군·구와, 각 시·군·구를
          대표하는 후보 구역의 실제 순위
        </caption>
        <thead>
          <tr>
            <th scope="col">시·군·구</th>
            <th scope="col">A안 표시 위치</th>
            <th scope="col">A안 대표 후보 구역</th>
            <th scope="col">A안 순위</th>
            <th scope="col">B안 표시 위치</th>
            <th scope="col">B안 대표 후보 구역</th>
            <th scope="col">B안 순위</th>
            <th scope="col">표시 위치 변화</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.groupKey}>
              <th scope="row">
                {row.sidoLabel !== null ? `${row.sidoLabel} ${row.label}` : row.label}
              </th>
              <td>{row.aSlot !== null ? `${row.aSlot}번째` : "목록에 없음"}</td>
              <td>{row.a?.candidateKey ?? "없음"}</td>
              <td>{endpointText(row, "a")}</td>
              <td>{row.bSlot !== null ? `${row.bSlot}번째` : "목록에 없음"}</td>
              <td>{row.b?.candidateKey ?? "없음"}</td>
              <td>{endpointText(row, "b")}</td>
              <td>{slotMovementText(row)}</td>
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
  position,
  text,
}: {
  x: number;
  y: number;
  anchor: "start" | "end";
  /** DISPLAY POSITION in this side's list — never the candidate's rank. */
  position: number | null;
  text: string;
}) {
  return (
    <text x={x} y={y + 4} textAnchor={anchor} fontSize={12} fill="var(--color-ink)">
      {position !== null ? (
        <>
          <tspan fontWeight={700}>{position}</tspan>
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
