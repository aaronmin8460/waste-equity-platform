"use client";

/**
 * 월별 반입 추이 — Figma 125:5303.
 *
 * ONE chart with a metric switch (반입량 / 반입수수료), replacing the previous pair of
 * side-by-side mini charts. What it encodes is unchanged: the same served points, the
 * same order, the same units, the same lossless values.
 *
 * A month with no served value draws NO bar and gets NO row. It is never plotted at
 * the zero baseline and never interpolated from its neighbours — an absent month is
 * not a month with zero inbound waste (repo AGENTS.md).
 *
 * ── Reading an exact value off the chart ──────────────────────────────────────
 * The technical-request frame (271:426) asks for "월별 추이에 커서 올리면, n월 + 정확한
 * 수치". That is implemented as a READOUT LINE under the chart rather than a floating
 * tooltip: every bar is focusable, and hovering OR focusing one prints
 * `n월 · <exact served value>` in a fixed slot. Focus makes it keyboard-reachable and
 * the bar's `aria-label` carries the same string, so the figure is announced rather
 * than merely painted.
 *
 * It is still not the ONLY way to read a value. A readout needs a pointer or a focus
 * ring; every month's exact served figure therefore also stays as text in the table,
 * and the highest and lowest months are called out in words. Colour is applied on TOP
 * of those text callouts, never instead of them.
 *
 * ── ⚠️ THE EXTREME COLOURS: 최저 = RED, 최고 = BLUE ───────────────────────────
 * Annotation `271:430` reads:
 *
 *   "단, 최저/최고는 각각 빨간색, 파란색으로 표현하고, 그외는 #F9F9F9로 표현"
 *
 * Order-matched, that is 최저 → 빨간색 and 최고 → 파란색, and the rendered reference
 * (`271-443.png`) confirms it visually: 최저(7월) is red-on-pale-red and 최고(11월) is
 * blue-on-pale-lavender. An earlier audit recorded this the other way round; it was
 * wrong and this file follows the annotation and the render.
 *
 * Note this is the OPPOSITE polarity to Page 5's slope chart (순위 상승 = 빨강). The two
 * are different claims about different quantities and must NOT be unified into one
 * "semantic" colour scale.
 *
 * ── What `#F9F9F9` turned out to be ──────────────────────────────────────────
 * It is the CHIP fill for an ordinary month, not a marker colour. Read as a marker it
 * is the page canvas colour and would be invisible on a white card, which is why it
 * previously looked unresolvable; `271-443.png` settles it — the extremes are labelled
 * with tinted CHIPS (pale red / pale lavender), so `그외는 #F9F9F9` is the neutral
 * version of that same chip. The hover readout chip therefore uses it, and the
 * ordinary month markers keep the navy the frame draws the series in.
 */

import { useMemo, useState } from "react";

import type { LandfillTrendPoint, LandfillTrends } from "../../lib/api";
import { formatDecimalExact } from "../../lib/landfill";
import DataStatusBadge from "../ui/DataStatusBadge";
import Dialog from "../ui/Dialog";
import SectionCard from "../ui/SectionCard";
import SegmentedControl from "../ui/SegmentedControl";
import { PAGE2_CARD_CLASS } from "./shared";

type TrendMetric = "quantity" | "fee";

const METRIC_OPTIONS = [
  { key: "quantity" as const, label: "반입량", testId: "landfill-trend-metric-quantity" },
  { key: "fee" as const, label: "반입수수료", testId: "landfill-trend-metric-fee" },
];

interface MetricSpec {
  title: string;
  yUnit: string;
  /** Chart-scale value. Rounding here only sizes a bar; it never becomes text. */
  pick: (point: LandfillTrendPoint) => number;
  /** Axis/callout formatter for the chart-scale value. */
  format: (value: number) => string;
  /** The LOSSLESS served value with its unit, for the tooltip and the table. */
  exact: (point: LandfillTrendPoint) => string;
}

const METRICS: Record<TrendMetric, MetricSpec> = {
  quantity: {
    title: "월별 반입량",
    yUnit: "톤 (t)",
    pick: (point) => Number(point.quantity_tons),
    format: (value) => `${Math.round(value).toLocaleString("en-US")}t`,
    exact: (point) => `${formatDecimalExact(point.quantity_tons)} t`,
  },
  fee: {
    title: "월별 공식 반입수수료",
    yUnit: "억원 (0.1B KRW)",
    pick: (point) => Number(point.inbound_fee_krw) / 100_000_000,
    format: (value) => `${value.toFixed(1)}억원`,
    exact: (point) => `${formatDecimalExact(point.inbound_fee_krw)}원`,
  },
};

/**
 * 최저 RED / 최고 BLUE — annotation `271:430`, order-matched. See the file header;
 * do not "correct" these back.
 */
const MARK_MIN = "#b91c1c";
const MARK_MAX = "#1d4ed8";
/** The tinted chips those callouts sit on, and the neutral one for every other month. */
const CHIP_MIN = "#FDECEC";
const CHIP_MAX = "#ECEEFB";
/** `그외는 #F9F9F9` — the ordinary month's readout chip. */
const CHIP_NEUTRAL = "#F9F9F9";
/** The connecting line and its ordinary month markers (Figma draws this series navy). */
const LINE_STROKE = "#111a56";
const POINT_DEFAULT = "#111a56";

export interface LandfillTrendSectionProps {
  trends: LandfillTrends;
}

export default function LandfillTrendSection({ trends }: LandfillTrendSectionProps) {
  const [metric, setMetric] = useState<TrendMetric>("quantity");
  /**
   * The month the pointer is over and the month that holds focus, kept apart so a
   * keyboard reader's position is never stolen by a stray mouse move across the
   * chart. Focus wins when both are set.
   */
  // 표로 보기 (기술요청 #16) — presentation state only.
  const [tableOpen, setTableOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const activeMonth = focused ?? hovered;
  const spec = METRICS[metric];
  const points = trends.points;
  const activePoint = points.find((point) => point.reference_month === activeMonth) ?? null;

  // The extremes, by the CURRENT metric. Ties keep the earliest month so the callout
  // names one specific month rather than silently picking the last match.
  const extremes = useMemo(() => {
    if (points.length === 0) return null;
    let max = points[0];
    let min = points[0];
    for (const point of points) {
      if (spec.pick(point) > spec.pick(max)) max = point;
      if (spec.pick(point) < spec.pick(min)) min = point;
    }
    // A single point, or a flat series, is not a high AND a low — claiming both
    // would put two contradictory callouts on the same bar.
    return spec.pick(max) === spec.pick(min) ? null : { max, min };
  }, [points, spec]);

  return (
    <SectionCard
      title="월별 반입 추이"
      // The Figma sentence, plus the one clause it cannot drop: this chart ignores
      // the 기간 filter and always draws the whole selected year, so a reader who
      // asked for 3월 must not read it as three months of data.
      description="선택한 조건의 월별 반입량과 공식 반입수수료 변화 · 선택 연도 전체 (월 필터와 무관)"
      headerAside={
        <SegmentedControl
          options={METRIC_OPTIONS}
          value={metric}
          onChange={setMetric}
          ariaLabel="월별 추이에 표시할 지표"
          testId="landfill-trend-metric"
        />
      }
      className={PAGE2_CARD_CLASS}
      testId="landfill-trends"
    >
      {points.length === 0 ? (
        <p className="text-xs text-ink-subtle" data-testid="landfill-trend-empty">
          해당 기간의 자료가 없습니다.
        </p>
      ) : (
        <>
          <p className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-subtle">
            <DataStatusBadge status="reported" />
            세로축 단위: <span className="font-medium">{spec.yUnit}</span> · 기준 기간{" "}
            {points[0].reference_month} – {points[points.length - 1].reference_month}
          </p>

          <TrendChart
            points={points}
            spec={spec}
            extremes={extremes}
            activeMonth={activeMonth}
            onHover={setHovered}
            onFocusMonth={setFocused}
          />

          {/* `n월 · 정확한 값`, for the bar under the pointer or holding focus. The
              slot keeps its height when nothing is active, so moving across the
              chart never reflows the card. It is `aria-live="polite"` rather than
              `role="status"`: it echoes what the focused bar's own `aria-label`
              already announced, so it must never interrupt. */}
          {/* Figma spec sheet 8 (271-442): "Tooltip에는 해당 월의 반입량 + 공식
              반입수수료를 함께 표시." BOTH figures, whichever metric the chart is
              drawing — switching the series changes what is plotted, not what a month
              is worth. The chip is tinted when the active month IS an extreme and
              #F9F9F9 otherwise (그외는 #F9F9F9). */}
          <p
            className="mt-2 flex min-h-[1.5rem] flex-wrap items-center gap-x-2 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums text-ink"
            style={{
              backgroundColor: activePoint
                ? activePoint.reference_month === extremes?.min.reference_month
                  ? CHIP_MIN
                  : activePoint.reference_month === extremes?.max.reference_month
                    ? CHIP_MAX
                    : CHIP_NEUTRAL
                : "transparent",
            }}
            aria-live="polite"
            data-testid="landfill-trend-readout"
          >
            {activePoint ? (
              <>
                <span className="font-bold">{monthLabel(activePoint.reference_month)}</span>
                <span data-testid="landfill-trend-readout-quantity">
                  반입량 {METRICS.quantity.exact(activePoint)}
                </span>
                <span data-testid="landfill-trend-readout-fee">
                  공식 반입수수료 {METRICS.fee.exact(activePoint)}
                </span>
              </>
            ) : (
              <span className="font-normal text-ink-subtle">
                점에 커서를 올리거나 키보드로 이동하면 그 달의 반입량과 공식 반입수수료가 함께 표시됩니다.
              </span>
            )}
          </p>

          {/* The extremes in words. These stay the PRIMARY, reachable statement; the
              red/blue markers and their on-chart annotations are a redundant echo. */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {extremes ? (
              <>
                {/* 최고 BLUE, 최저 RED — annotation 271:430. The chips echo the
                    rendered reference (271-443.png), where the callouts sit on a pale
                    tint of their own colour. */}
                <span
                  data-testid="landfill-trend-max"
                  className="rounded-full px-2 py-0.5 font-semibold"
                  style={{ color: MARK_MAX, backgroundColor: CHIP_MAX }}
                >
                  최고 {monthLabel(extremes.max.reference_month)} ·{" "}
                  {spec.format(spec.pick(extremes.max))}
                </span>
                <span
                  data-testid="landfill-trend-min"
                  className="rounded-full px-2 py-0.5 font-semibold"
                  style={{ color: MARK_MIN, backgroundColor: CHIP_MIN }}
                >
                  최저 {monthLabel(extremes.min.reference_month)} ·{" "}
                  {spec.format(spec.pick(extremes.min))}
                </span>
              </>
            ) : (
              <span className="text-ink-subtle" data-testid="landfill-trend-no-extremes">
                최고·최저를 구분할 수 있는 달이 없습니다.
              </span>
            )}
            <span className="text-ink-subtle">
              {points.length}개월 · 자료가 없는 달은 점을 찍지 않으며 0으로 채우지 않습니다.
            </span>
          </div>

          {/* 기술요청 #16 — '표로 보기' becomes a popup rather than an inline
              disclosure, on the shared `ui/Dialog` primitive (focus trap, Escape,
              focus restore to this button; the primitive itself is untouched). */}
          <div className="mt-3">
            <button
              type="button"
              className="wep-btn-quiet w-full justify-between"
              onClick={() => setTableOpen(true)}
              data-testid="landfill-trend-exact"
            >
              표로 보기 (월별 정확한 값)
            </button>
            <Dialog
              open={tableOpen}
              title="월별 정확한 값"
              description={`${spec.title} · ${points[0].reference_month} – ${points[points.length - 1].reference_month}`}
              onClose={() => setTableOpen(false)}
              testId="landfill-trend-table-modal"
            >
              <div className="px-5 py-4">
                <table className="w-full text-left text-[11px]" data-testid="landfill-trend-table">
                  <caption className="sr-only">{spec.title} — 월별 정확한 값</caption>
                  <thead>
                    <tr className="text-ink-subtle">
                      <th scope="col" className="py-0.5 pr-3 font-medium">
                        월
                      </th>
                      <th scope="col" className="py-0.5 pr-3 font-medium">
                        반입량 (정확한 값)
                      </th>
                      <th scope="col" className="py-0.5 font-medium">
                        공식 반입수수료 (정확한 값)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* BOTH metrics, always. The switch above changes what the chart
                        draws; it must not hide a served value from the one
                        representation a screen-reader user can actually read. */}
                    {points.map((point) => (
                      <tr key={point.reference_month}>
                        <th scope="row" className="py-0.5 pr-3 font-normal text-ink-muted">
                          {point.reference_month}
                        </th>
                        <td className="py-0.5 pr-3 tabular-nums text-ink-muted">
                          {METRICS.quantity.exact(point)}
                        </td>
                        <td className="py-0.5 tabular-nums text-ink-muted">
                          {METRICS.fee.exact(point)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-4 flex justify-end border-t border-hairline pt-3">
                  <button
                    type="button"
                    className="wep-btn-primary"
                    onClick={() => setTableOpen(false)}
                    data-testid="landfill-trend-table-dismiss"
                  >
                    닫기
                  </button>
                </div>
              </div>
            </Dialog>
          </div>
        </>
      )}
    </SectionCard>
  );
}

/** `2025-11` → `11월`, for a callout that reads as a month rather than a key. */
function monthLabel(referenceMonth: string): string {
  return `${Number(referenceMonth.slice(5, 7))}월`;
}

const CHART = { width: 720, height: 260, padLeft: 52, padBottom: 24, padTop: 10, padRight: 8 };

function TrendChart({
  points,
  spec,
  extremes,
  activeMonth,
  onHover,
  onFocusMonth,
}: {
  points: LandfillTrendPoint[];
  spec: MetricSpec;
  extremes: { max: LandfillTrendPoint; min: LandfillTrendPoint } | null;
  activeMonth: string | null;
  onHover: (month: string | null) => void;
  onFocusMonth: (month: string | null) => void;
}) {
  const plotWidth = CHART.width - CHART.padLeft - CHART.padRight;
  const plotHeight = CHART.height - CHART.padTop - CHART.padBottom;
  const max = Math.max(...points.map(spec.pick), 0);
  // A flat all-zero series still needs a finite scale; the bars then correctly
  // render at zero height rather than dividing by zero.
  const scale = max > 0 ? max : 1;
  const slot = plotWidth / points.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * scale);
  /** The x centre of a month's slot — shared by the line, the markers and the labels. */
  const centreX = (index: number, width: number) => CHART.padLeft + index * width + width / 2;
  /** A value's y, in plot coordinates. Scales geometry only; never a displayed figure. */
  const valueY = (value: number, denom: number, height: number) =>
    CHART.padTop + height - (value / denom) * height;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        className="h-[16rem] w-full min-w-[32rem]"
        role="img"
        aria-label={`${spec.title} — 세로축 단위 ${spec.yUnit}, ${points[0].reference_month}부터 ${points[points.length - 1].reference_month}까지의 월별 값. 정확한 값은 아래 표에 있습니다.`}
        data-testid="landfill-trend-chart"
      >
        {ticks.map((tick) => {
          const y = CHART.padTop + plotHeight - (tick / scale) * plotHeight;
          return (
            <g key={tick}>
              <line
                x1={CHART.padLeft}
                y1={y}
                x2={CHART.padLeft + plotWidth}
                y2={y}
                stroke="#eef0f4"
              />
              <text x={CHART.padLeft - 6} y={y + 3} textAnchor="end" className="fill-ink-subtle text-[9px]">
                {spec.format(tick)}
              </text>
            </g>
          );
        })}

        {/* The connecting line. Figma (125:5361) draws this series as a LINE with a
            marker per month, not as bars — a monthly series is a progression through
            time, and a line is what lets a reader see the shape of the year rather
            than compare twelve independent magnitudes.

            It is a single `polyline` over the SAME per-month geometry the markers and
            hit targets use, so the path can never disagree with the points. Decorative:
            the per-month hit targets below own every accessible name. */}
        <polyline
          points={points
            .map((point, index) => `${centreX(index, slot)},${valueY(spec.pick(point), scale, plotHeight)}`)
            .join(" ")}
          fill="none"
          stroke={LINE_STROKE}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          aria-hidden
          pointerEvents="none"
          data-testid="landfill-trend-line"
        />

        {points.map((point, index) => {
          const value = spec.pick(point);
          const cx = centreX(index, slot);
          const cy = valueY(value, scale, plotHeight);
          const isMax = extremes?.max.reference_month === point.reference_month;
          const isMin = extremes?.min.reference_month === point.reference_month;
          const isActive = activeMonth === point.reference_month;
          // BOTH metrics, matching the visible tooltip (Figma spec sheet 8): a
          // screen-reader user must hear what a sighted reader sees, not the plotted
          // series alone.
          const readout =
            `${monthLabel(point.reference_month)} · 반입량 ${METRICS.quantity.exact(point)}` +
            ` · 공식 반입수수료 ${METRICS.fee.exact(point)}`;
          return (
            <g key={point.reference_month}>
              {/* A full-height transparent target over the month's slot, so a low
                  month is as easy to reach as a high one — with the pointer and with
                  the Tab key. It carries the focus, the hover, and the accessible
                  name; the painted marker below stays purely visual. */}
              <rect
                x={CHART.padLeft + index * slot}
                y={CHART.padTop}
                width={slot}
                height={plotHeight}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={readout}
                className="cursor-default focus:outline-none focus-visible:stroke-[#111a56] focus-visible:stroke-2"
                data-testid="landfill-trend-hit"
                data-month={point.reference_month}
                onMouseEnter={() => onHover(point.reference_month)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onFocusMonth(point.reference_month)}
                onBlur={() => onFocusMonth(null)}
              >
                {/* Exact served value (lossless) in the pointer tooltip. Duplicated
                    in the readout above the table and in the table itself, which are
                    the reachable versions. */}
                <title>{readout}</title>
              </rect>
              {/* A guide from the axis to the active or extreme marker, so the eye can
                  land on the right month without a tooltip. */}
              {(isActive || isMax || isMin) && (
                <line
                  x1={cx}
                  y1={cy}
                  x2={cx}
                  y2={CHART.padTop + plotHeight}
                  stroke={isMax ? MARK_MAX : isMin ? MARK_MIN : "#111a56"}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  aria-hidden
                  pointerEvents="none"
                />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={isActive || isMax || isMin ? 5 : 3.5}
                fill={isMax ? MARK_MAX : isMin ? MARK_MIN : POINT_DEFAULT}
                stroke="#ffffff"
                strokeWidth={1.5}
                // Decorative: the hit target above owns the name and the focus.
                aria-hidden
                pointerEvents="none"
                data-testid="landfill-trend-point"
                data-month={point.reference_month}
                data-extreme={isMax ? "max" : isMin ? "min" : undefined}
                data-active={isActive ? "true" : undefined}
              />
              <text
                x={cx}
                y={CHART.height - 8}
                textAnchor="middle"
                className="fill-ink-subtle text-[9px]"
              >
                {Number(point.reference_month.slice(5, 7))}
              </text>
            </g>
          );
        })}

        {/* The extremes annotated ON the chart, which is where Figma puts them. The
            words below the chart remain the primary, reachable statement — these are a
            redundant echo, aria-hidden, and they are anchored so they can never sit
            outside the plot even when an extreme is the first or last month. */}
        {extremes &&
          (
            [
              { point: extremes.max, kind: "max" as const, fill: MARK_MAX, label: "최고" },
              { point: extremes.min, kind: "min" as const, fill: MARK_MIN, label: "최저" },
            ] satisfies { point: LandfillTrendPoint; kind: "max" | "min"; fill: string; label: string }[]
          ).map(({ point, kind, fill, label }) => {
            const index = points.findIndex((p) => p.reference_month === point.reference_month);
            if (index < 0) return null;
            const cx = centreX(index, slot);
            const cy = valueY(spec.pick(point), scale, plotHeight);
            // Above the marker for the maximum, below it for the minimum, and clamped
            // into the plot so neither can be clipped by the viewBox.
            const y = kind === "max" ? Math.max(CHART.padTop + 9, cy - 12) : Math.min(CHART.padTop + plotHeight - 4, cy + 18);
            const anchor = index === 0 ? "start" : index === points.length - 1 ? "end" : "middle";
            return (
              <text
                key={kind}
                x={cx}
                y={y}
                textAnchor={anchor}
                fill={fill}
                className="text-[9px] font-semibold"
                aria-hidden
                pointerEvents="none"
                data-testid={`landfill-trend-annotation-${kind}`}
              >
                {label} {monthLabel(point.reference_month)} · {spec.format(spec.pick(point))}
              </text>
            );
          })}
      </svg>
    </div>
  );
}
