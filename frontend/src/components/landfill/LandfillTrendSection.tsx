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
 * ring; every month's exact served figure therefore also stays as text in the table
 * below, and the highest and lowest months are called out in words. The request asked
 * for the extremes in red and blue; colour is applied on TOP of those text callouts,
 * never instead of them. (The request's #F9F9F9 for the remaining bars is the page
 * canvas colour and would be invisible on a white card — the latest Figma read
 * 2026-08-16 still says #F9F9F9 and so does not resolve it — so the neutral bars use
 * the nearest visible step of the same neutral ramp.)
 */

import { useMemo, useState } from "react";

import type { LandfillTrendPoint, LandfillTrends } from "../../lib/api";
import { formatDecimalExact } from "../../lib/landfill";
import Accordion from "../ui/Accordion";
import DataStatusBadge from "../ui/DataStatusBadge";
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

/** Max red, min blue, everything else a visible neutral (see the file header). */
const BAR_MAX = "#b91c1c";
const BAR_MIN = "#1d4ed8";
const BAR_DEFAULT = "#ced3e0";

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
          <p
            className="mt-2 min-h-[1.25rem] text-xs font-medium tabular-nums text-ink"
            aria-live="polite"
            data-testid="landfill-trend-readout"
          >
            {activePoint ? (
              <>
                {monthLabel(activePoint.reference_month)} · {spec.exact(activePoint)}
              </>
            ) : (
              <span className="font-normal text-ink-subtle">
                막대에 커서를 올리거나 키보드로 이동하면 그 달의 정확한 값이 표시됩니다.
              </span>
            )}
          </p>

          {/* The extremes in words. These are the primary statement; the red/blue
              bars are a redundant echo of them. */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {extremes ? (
              <>
                <span data-testid="landfill-trend-max" className="font-semibold text-danger">
                  최고 {monthLabel(extremes.max.reference_month)} ·{" "}
                  {spec.format(spec.pick(extremes.max))}
                </span>
                <span data-testid="landfill-trend-min" className="font-semibold text-[#1d4ed8]">
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
              {points.length}개월 · 자료가 없는 달은 막대를 그리지 않으며 0으로 채우지 않습니다.
            </span>
          </div>

          <div className="mt-3">
            <Accordion label="표로 보기 (월별 정확한 값)" testId="landfill-trend-exact">
              <div className="max-h-56 overflow-y-auto">
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
              </div>
            </Accordion>
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
  const barWidth = Math.max(2, slot * 0.62);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * scale);

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

        {points.map((point, index) => {
          const value = spec.pick(point);
          const height = (value / scale) * plotHeight;
          const x = CHART.padLeft + index * slot + (slot - barWidth) / 2;
          const isMax = extremes?.max.reference_month === point.reference_month;
          const isMin = extremes?.min.reference_month === point.reference_month;
          const isActive = activeMonth === point.reference_month;
          const readout = `${monthLabel(point.reference_month)} · ${spec.exact(point)}`;
          return (
            <g key={point.reference_month}>
              {/* A full-height transparent target over the bar's slot, so a short
                  month is as easy to reach as a tall one — with the pointer and
                  with the Tab key. It carries the focus, the hover, and the
                  accessible name; the painted bar below stays purely visual. */}
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
              <rect
                x={x}
                y={CHART.padTop + plotHeight - height}
                width={barWidth}
                height={Math.max(0, height)}
                fill={isMax ? BAR_MAX : isMin ? BAR_MIN : BAR_DEFAULT}
                stroke={isActive ? "#111a56" : undefined}
                strokeWidth={isActive ? 1.5 : undefined}
                // Decorative: the hit target above owns the name and the focus.
                aria-hidden
                pointerEvents="none"
                data-testid="landfill-trend-bar"
                data-month={point.reference_month}
                data-extreme={isMax ? "max" : isMin ? "min" : undefined}
                data-active={isActive ? "true" : undefined}
              />
              <text
                x={x + barWidth / 2}
                y={CHART.height - 8}
                textAnchor="middle"
                className="fill-ink-subtle text-[9px]"
              >
                {Number(point.reference_month.slice(5, 7))}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
