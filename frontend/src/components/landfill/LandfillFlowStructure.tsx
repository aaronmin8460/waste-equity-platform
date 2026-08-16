"use client";

/**
 * 수도권매립지 반입 구조 (지역별) — Figma 125:5218.
 *
 * What the selected period's inbound quantity is made of, by ORIGIN. The rows are
 * the served `origin_shares` in the served order, with the served `origin_name`,
 * `quantity_kg`, and `quantity_share` printed verbatim; nothing is re-ranked,
 * re-grouped, merged, or renamed.
 *
 * The population beside each row is the SAME served denominator the per-resident
 * conversion used (`fee_per_capita.population`) — not a second population from
 * somewhere else, and shown only when that conversion actually had one, so the number
 * on screen is always the number the platform divided by. A row whose denominator was
 * unavailable says so rather than borrowing another period's figure.
 *
 * The heading is descriptive, not evaluative — 반입 구조, never 최다 배출 지역. A
 * larger quantity is a quantity, not blame, fault, or legal responsibility.
 *
 * The bars are a redundant encoding of text already on the row, normalised only
 * within the rows on screen. A row with no honest proportion draws no track at all
 * rather than an empty one, which would read as an official zero.
 */

import type { LandfillSummary } from "../../lib/api";
import { formatShare, formatTons } from "../../lib/landfill";
import DataStatusBadge from "../ui/DataStatusBadge";
import SectionCard from "../ui/SectionCard";
import LandfillProportionRule from "./LandfillProportionRule";
import { barRatio, PAGE2_CARD_CLASS } from "./shared";

export interface LandfillFlowStructureProps {
  summary: LandfillSummary;
  /** The widest origin quantity on screen; shared with the exact-value table. */
  originMax: number;
}

export default function LandfillFlowStructure({
  summary,
  originMax,
}: LandfillFlowStructureProps) {
  return (
    <SectionCard
      title="수도권매립지 반입 구조 (지역별)"
      // The Figma sentence (125:5064) only. `기준 기간 …` is stated once for the
      // landfill pair in the KPI strip above and once in the 지역별 상세 현황 unit
      // line; repeating it on every card in between was the page's single most
      // duplicated string and told a reader nothing new.
      description="선택한 조건에서 수도권매립지로 반입된 지역별 폐기물입니다."
      headerAside={<DataStatusBadge status="reported" />}
      className={PAGE2_CARD_CLASS}
      testId="landfill-flow-structure"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-3">
        <span className="text-sm font-bold text-ink">총 반입량</span>
        <span className="text-sm font-bold tabular-nums text-ink" data-testid="landfill-flow-total">
          {formatTons(summary.total_quantity_kg)} (100%)
        </span>
      </div>

      {summary.origin_shares.length === 0 ? (
        <p className="pt-3 text-xs text-ink-subtle" data-testid="landfill-flow-empty">
          해당 조건의 반입 자료가 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline">
          {summary.origin_shares.map((share) => {
            const ratio = barRatio(share.quantity_tons, originMax);
            const population = share.fee_per_capita?.population ?? null;
            return (
              <li key={share.origin_region_code} className="py-3" data-testid="landfill-flow-row">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-base font-bold text-ink">{share.origin_name}</span>
                  <span className="text-sm tabular-nums text-ink-muted">
                    {formatTons(share.quantity_kg)}{" "}
                    <span className="font-bold text-ink">{formatShare(share.quantity_share)}</span>
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-subtle" data-testid="landfill-flow-population">
                  {population !== null
                    ? `주민등록 인구 ${population.toLocaleString("en-US")}명 (월말)`
                    : "동일 기간 주민등록 인구 자료 없음"}
                </p>
                {ratio === null ? (
                  <p className="mt-1 text-[11px] text-ink-subtle">비율 표시 불가</p>
                ) : (
                  <LandfillProportionRule ratio={ratio} align="left" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
