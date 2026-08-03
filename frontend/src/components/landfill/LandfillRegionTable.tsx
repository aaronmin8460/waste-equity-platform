"use client";

/**
 * 지역별 정확한 값 — the exact-value table.
 *
 * Exactly four columns: 지역 / 반입량 / 공식 반입수수료 / 주민 1인당 환산 반입수수료.
 * All origins → the three metropolitan rows; a specific origin → only that one.
 * Rows are served, never re-sorted, and a row whose per-capita value is unavailable
 * is NEVER dropped: it keeps its place and states the served reason.
 *
 * The 반입량 cell carries a decorative proportional rule. It is `aria-hidden` and
 * carries no number of its own — the exact value stays the cell's text, so removing
 * the bar would lose nothing but visual scanning speed.
 *
 * The table owns its horizontal scrolling; the page body never scrolls sideways
 * because of it.
 */

import type { LandfillSummary } from "../../lib/api";
import {
  formatKrwEok,
  formatKrwPerPerson,
  formatTons,
  perCapitaUnavailableCode,
  perCapitaUnavailableLabel,
} from "../../lib/landfill";
import SectionCard from "../ui/SectionCard";
import LandfillProportionRule from "./LandfillProportionRule";
import { barRatio, PER_CAPITA_LABEL } from "./shared";

export interface LandfillRegionTableProps {
  summary: LandfillSummary;
  originMax: number;
  periodLabel: string;
}

export default function LandfillRegionTable({
  summary,
  originMax,
  periodLabel,
}: LandfillRegionTableProps) {
  return (
    <SectionCard
      flush
      title="지역별 정확한 값"
      description="반입량과 반입수수료는 공식 보고값이고, 1인당 환산값은 계산값입니다. 값이 없는 항목은 0이 아니라 자료 없음으로 표시합니다."
      testId="landfill-region-table"
    >
      {summary.origin_shares.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-ink-subtle" data-testid="landfill-region-empty">
          해당 조건의 반입 자료가 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto border-t border-hairline">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">
              선택한 조건({periodLabel})의 광역지자체별 반입량, 공식 반입수수료, 주민 1인당 환산
              반입수수료
            </caption>
            <thead>
              <tr className="border-b border-hairline bg-surface-muted text-xs text-ink-muted">
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  지역
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  반입량
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  공식 반입수수료
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {PER_CAPITA_LABEL}
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.origin_shares.map((share) => {
                const perCapita = share.fee_per_capita;
                const value = perCapita.fee_per_capita_krw;
                const ratio = barRatio(share.quantity_tons, originMax);
                return (
                  <tr
                    key={share.origin_region_code}
                    className="border-b border-hairline last:border-0"
                    data-testid="landfill-region-row"
                  >
                    <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                      {share.origin_name}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {formatTons(share.quantity_kg)}
                      {ratio !== null && <LandfillProportionRule ratio={ratio} align="right" />}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {formatKrwEok(share.inbound_fee_krw)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {value !== null ? (
                        formatKrwPerPerson(value)
                      ) : (
                        <>
                          {/* Never 0원: an absent denominator is not a zero fee.
                              Neutral gray, not amber — amber cautions about a value
                              that EXISTS, and absence is a different state
                              (docs/ui-refresh/design-tokens.md §"Missing data"). The
                              served reason is the label, so the state is carried by
                              text and never by colour. A `DataStatusBadge` is
                              deliberately not used in this cell: `.wep-badge` is
                              `white-space: nowrap`, and the longest served reason
                              would widen the column far past the table. */}
                          <span className="text-ink-subtle" data-testid="landfill-row-unavailable">
                            {perCapitaUnavailableLabel(perCapita.unavailable_reason)}
                          </span>
                          {/* A reason code this build cannot translate must stay
                              recoverable from the page (redesign plan §5 rule 12).
                              Without this the row's code would be dropped entirely —
                              the label alone degrades to a bare "계산 불가". */}
                          {perCapitaUnavailableCode(perCapita.unavailable_reason) && (
                            <span className="block text-[11px] text-ink-subtle" data-diagnostic>
                              기술 코드: {perCapitaUnavailableCode(perCapita.unavailable_reason)}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
