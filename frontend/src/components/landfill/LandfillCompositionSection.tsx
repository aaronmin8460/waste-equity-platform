"use client";

/**
 * 반입 구성 — which origin regions and which waste categories the selected period's
 * inbound quantity is made of.
 *
 * Both breakdowns are the SAME two lists the dashboard has always shown, in the
 * SAME served order, with the SAME exact values and the SAME shares. Nothing is
 * re-ranked, re-grouped, merged, or renamed here; the served `origin_name` and
 * `waste_name` are printed verbatim.
 *
 * The headings are deliberately descriptive rather than evaluative — 출발 지역별
 * 반입량, not 최다 배출 지역. A larger quantity is a quantity, not blame, fault, or
 * legal responsibility, and this screen must never imply otherwise.
 *
 * The bars are a redundant encoding of text that is already on the row, normalised
 * only within the rows on screen. A row with no honest proportion draws no track at
 * all rather than an empty one, which would read as an official zero.
 */

import type { LandfillSummary } from "../../lib/api";
import { formatShare, formatTons } from "../../lib/landfill";
import DataStatusBadge from "../ui/DataStatusBadge";
import LandfillProportionRule from "./LandfillProportionRule";
import { barRatio } from "./shared";

export interface LandfillCompositionSectionProps {
  summary: LandfillSummary;
  periodLabel: string;
  /** The widest origin quantity on screen; shared with the exact-value table. */
  originMax: number;
  /** The rows the waste breakdown shows — sliced by the caller, never re-sorted. */
  wasteRows: LandfillSummary["top_waste_types"];
}

export default function LandfillCompositionSection({
  summary,
  periodLabel,
  originMax,
  wasteRows,
}: LandfillCompositionSectionProps) {
  const wasteMax = Math.max(0, ...wasteRows.map((waste) => Number(waste.quantity_tons)));
  return (
    <section aria-labelledby="landfill-composition-heading" data-testid="landfill-composition">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="landfill-composition-heading" className="text-sm font-semibold text-ink">
          반입 구성
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-ink-subtle">
          <DataStatusBadge status="reported" />
          비중은 공식 보고값으로 계산했습니다. 순위나 평가가 아닙니다.
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <LandfillComparisonBars
          title="출발 지역별 반입량"
          testId="landfill-origin-comparison"
          caption={`기준 기간 ${periodLabel} · 반입량 기준`}
          rows={summary.origin_shares.map((share) => ({
            key: share.origin_region_code,
            label: share.origin_name,
            ratio: barRatio(share.quantity_tons, originMax),
            display: `${formatTons(share.quantity_kg)} · ${formatShare(share.quantity_share)}`,
          }))}
        />
        <LandfillComparisonBars
          title="폐기물 종류별 반입량"
          testId="landfill-waste-composition"
          caption={`기준 기간 ${periodLabel} · 반입량 상위 ${wasteRows.length}개 항목`}
          rows={wasteRows.map((share) => ({
            key: share.waste_name,
            label: share.waste_name,
            ratio: barRatio(share.quantity_tons, wasteMax),
            display: `${formatTons(share.quantity_kg)} · ${formatShare(share.quantity_share)}`,
          }))}
        />
      </div>
    </section>
  );
}

/**
 * A labelled row per item: the served name, the exact served value as text, and a
 * proportional bar that re-encodes that same value.
 *
 * The bar is never the only way a value is communicated, and a row whose ratio is
 * unavailable renders no track at all rather than an empty one that would read as
 * an official zero.
 */
function LandfillComparisonBars({
  title,
  testId,
  caption,
  rows,
}: {
  title: string;
  testId: string;
  caption: string;
  rows: { key: string; label: string; ratio: number | null; display: string }[];
}) {
  return (
    <section aria-label={title} data-testid={testId} className="wep-card">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-0.5 mb-2 text-xs text-ink-subtle">{caption}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-subtle">해당 조건의 자료가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="flex justify-between gap-2 text-xs text-ink-muted">
                <span className="truncate">{row.label}</span>
                <span className="shrink-0 tabular-nums text-ink">{row.display}</span>
              </div>
              {row.ratio === null ? (
                <p className="mt-0.5 text-[11px] text-ink-subtle">비율 표시 불가</p>
              ) : (
                <LandfillProportionRule ratio={row.ratio} align="left" />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
