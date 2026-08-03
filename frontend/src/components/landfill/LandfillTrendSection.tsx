"use client";

/**
 * 월별 추이 — how the selected year's inbound quantity and official fee moved
 * month by month.
 *
 * The charts are UNCHANGED in what they encode: the same served points, the same
 * order, the same y units, the same rounded axis annotation, the same lossless
 * hover tooltip, and the same collapsed exact-value table. The refresh gives the
 * pair a section of their own with one heading that says what the two share (the
 * whole selected year, regardless of the 기간 filter) instead of repeating that
 * sentence inside each card.
 *
 * A month with no served value draws NO bar and gets NO row. It is never plotted at
 * the zero baseline and never interpolated from its neighbours — an absent month is
 * not a month with zero inbound waste (repo AGENTS.md).
 *
 * The chart is never the only way to read a value: every point's exact served
 * figure is available as text in the accessible table below it.
 */

import type { LandfillTrends } from "../../lib/api";
import { formatDecimalExact } from "../../lib/landfill";
import Accordion from "../ui/Accordion";
import DataStatusBadge from "../ui/DataStatusBadge";

export interface LandfillTrendSectionProps {
  trends: LandfillTrends;
}

export default function LandfillTrendSection({ trends }: LandfillTrendSectionProps) {
  return (
    <section aria-labelledby="landfill-trend-heading" data-testid="landfill-trends">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="landfill-trend-heading" className="text-sm font-semibold text-ink">
          월별 추이
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-ink-subtle">
          <DataStatusBadge status="reported" />
          선택한 연도 전체를 표시합니다 (월 필터와 무관).
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <LandfillMiniBars
          title="월별 반입량"
          testId="landfill-trend-quantity"
          points={trends.points}
          pick={(point) => Number(point.quantity_tons)}
          format={(value) => `${Math.round(value).toLocaleString("en-US")} t`}
          // Lossless: the backend-served exact tons string, never rounded.
          exactFormat={(point) => `${formatDecimalExact(point.quantity_tons)} t`}
          yUnit="톤 (t)"
          color="#0d9488"
        />
        <LandfillMiniBars
          title="월별 공식 반입수수료"
          testId="landfill-trend-fee"
          points={trends.points}
          pick={(point) => Number(point.inbound_fee_krw) / 100_000_000}
          format={(value) => `${value.toFixed(1)}억원`}
          // Lossless: the exact served KRW fee (the chart's 억원 conversion would
          // round), so the "exact value" table/tooltip keep full precision.
          exactFormat={(point) => `${formatDecimalExact(point.inbound_fee_krw)}원`}
          yUnit="억원 (0.1B KRW)"
          color="#2563eb"
        />
      </div>
    </section>
  );
}

function LandfillMiniBars({
  title,
  testId,
  points,
  pick,
  format,
  exactFormat,
  yUnit,
  color,
}: {
  title: string;
  testId: string;
  points: LandfillTrends["points"];
  pick: (point: LandfillTrends["points"][number]) => number;
  /** Rounded chart-scale formatter, used only for the "최대" annotation. */
  format: (value: number) => string;
  /**
   * Lossless per-point value (with its own unit) from the exact backend string,
   * used for the hover tooltip and the accessible table so neither shows a value
   * rounded by the chart formatter.
   */
  exactFormat: (point: LandfillTrends["points"][number]) => string;
  /** The y-axis unit, shown in the axis caption. */
  yUnit: string;
  color: string;
}) {
  const width = 240;
  const height = 64;
  const count = points.length || 1;
  const barWidth = width / count;
  const max = Math.max(1, ...points.map(pick));
  const firstMonth = points[0]?.reference_month ?? "";
  const lastMonth = points[points.length - 1]?.reference_month ?? "";
  return (
    <section aria-label={title} data-testid={testId} className="wep-card">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {points.length === 0 ? (
        <p className="mt-1 text-xs text-ink-subtle">해당 기간의 자료가 없습니다.</p>
      ) : (
        <>
          {/* Axis + reference period caption, so the chart's y unit and time span
              are explicit and the fee/quantity units are never confused. */}
          <p className="mt-0.5 mb-2 text-xs text-ink-subtle" data-testid={`${testId}-axis`}>
            세로축 단위: <span className="font-medium">{yUnit}</span> · 기준 기간 {firstMonth} –{" "}
            {lastMonth}
          </p>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            // Phase 5 (defect X5): the SVG previously had no height, so with
            // `preserveAspectRatio="none"` its rendered height tracked the card
            // width and the chart ballooned on a wide desktop card. A fixed height
            // pins it; bars still encode value by HEIGHT alone, so widening the
            // card rescales bar WIDTH only and distorts no value.
            className="h-20 w-full"
            role="img"
            aria-label={`${title} — 세로축 단위 ${yUnit}, ${firstMonth}부터 ${lastMonth}까지의 월별 값`}
            preserveAspectRatio="none"
          >
            {points.map((point, index) => {
              const value = pick(point);
              const barHeight = (value / max) * (height - 2);
              return (
                <rect
                  key={point.reference_month}
                  x={index * barWidth + 0.5}
                  y={height - barHeight}
                  width={Math.max(1, barWidth - 1)}
                  height={barHeight}
                  fill={color}
                >
                  {/* Exact served value (lossless) in the hover tooltip. */}
                  <title>{`${point.reference_month}: ${exactFormat(point)}`}</title>
                </rect>
              );
            })}
          </svg>
          {/* Endpoint month labels for the x-axis (a per-bar label would be
              unreadable at 12 bars). */}
          <div className="mt-0.5 flex justify-between text-[10px] text-ink-subtle" aria-hidden>
            <span>{firstMonth}</span>
            <span>{lastMonth}</span>
          </div>
          <p className="text-[11px] text-ink-subtle">
            최대 {format(max)} · {points.length}개월 · 선택 연도 전체(월 필터 무관). 자료가 없는
            달은 막대를 그리지 않으며 0으로 채우지 않습니다.
          </p>
          {/* Accessible table fallback: the hover <title> tooltips are not reachable
              by touch or screen readers, so every month's exact value is available
              here as text. Collapsed by default (Phase 5 AC3) — it holds no live
              region, so collapsing it hides nothing that needs announcing. */}
          <div className="mt-2">
            <Accordion label="표로 보기 (월별 정확한 값)" testId={`${testId}-exact`}>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-left text-[11px]" data-testid={`${testId}-table`}>
                  <caption className="sr-only">{title} — 월별 정확한 값</caption>
                  <thead>
                    <tr className="text-ink-subtle">
                      <th scope="col" className="py-0.5 pr-3 font-medium">
                        월
                      </th>
                      <th scope="col" className="py-0.5 font-medium">
                        정확한 값
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={point.reference_month}>
                        <th scope="row" className="py-0.5 pr-3 font-normal text-ink-muted">
                          {point.reference_month}
                        </th>
                        {/* Lossless served value, not the chart-rounded formatter. */}
                        <td className="py-0.5 tabular-nums text-ink-muted">{exactFormat(point)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Accordion>
          </div>
        </>
      )}
    </section>
  );
}
