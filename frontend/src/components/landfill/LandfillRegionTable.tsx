"use client";

/**
 * 지역별 상세 현황 — Figma 125:5358.
 *
 * The exact-value table, with the grouped header the design asks for and the two
 * sort options the technical-request frame specifies (반입량 · 반입수수료).
 *
 * ── Which Figma columns exist, and which do not ───────────────────────────────
 * The design's header groups 폐기물 발생량 and 시설 처리량 beside the landfill columns.
 * Those two datasets are published on 시·군·구 units; the landfill source reports
 * 시·도 totals only. Filling the three metropolitan rows would mean adding official
 * per-district figures into a sido total this platform would then be the sole
 * publisher of. Those groups are therefore ABSENT rather than blank — a column of
 * dashes reads as "measured and missing" — and the section says where those values
 * actually live (the 지역별 비교 above, at their own spatial grain).
 *
 * ── Sorting ──────────────────────────────────────────────────────────────────
 * Reordering three rows by an exact served number changes nothing about any value.
 * The comparison is over `Number()` of the served decimal strings, and a row whose
 * value is unparseable sorts LAST in either direction rather than being treated as
 * zero (which would rank an unknown as the smallest).
 *
 * A row whose per-capita value is unavailable is NEVER dropped: it keeps its place and
 * states the served reason. The table owns its horizontal scrolling; the page body
 * never scrolls sideways because of it.
 */

import { useMemo, useState } from "react";

import type { LandfillOriginShare, LandfillSummary } from "../../lib/api";
import {
  formatEffectiveFee,
  formatKrwEok,
  formatKrwPerPerson,
  formatShare,
  formatTons,
  perCapitaUnavailableCode,
  perCapitaUnavailableLabel,
} from "../../lib/landfill";
import SectionCard from "../ui/SectionCard";
import LandfillProportionRule from "./LandfillProportionRule";
import { barRatio, EFFECTIVE_FEE_LABEL, PER_CAPITA_LABEL } from "./shared";

type RegionSort = "quantity" | "fee";

const SORT_LABELS: Record<RegionSort, string> = {
  quantity: "반입량",
  fee: "반입수수료",
};

/** Sort key for a row, or null when the served value cannot be read as a number. */
function sortValue(share: LandfillOriginShare, sort: RegionSort): number | null {
  const raw = sort === "fee" ? share.inbound_fee_krw : share.quantity_tons;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

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
  const [sort, setSort] = useState<RegionSort>("quantity");

  const rows = useMemo(() => {
    return [...summary.origin_shares].sort((a, b) => {
      const left = sortValue(a, sort);
      const right = sortValue(b, sort);
      // Unreadable values last, in both directions — never ordered as if they were 0.
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left;
    });
  }, [summary.origin_shares, sort]);

  return (
    <SectionCard
      flush
      title="지역별 상세 현황"
      description="반입량과 반입수수료는 공식 보고값이고, 환산값은 계산값입니다. 값이 없는 항목은 0이 아니라 자료 없음으로 표시합니다."
      headerAside={
        <label className="flex items-center gap-2 text-xs text-ink-subtle">
          정렬 기준
          <select
            className="min-h-[2.25rem] rounded-control border border-hairline-strong bg-surface px-2 py-1.5 text-sm text-ink"
            data-testid="landfill-region-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as RegionSort)}
          >
            {(Object.keys(SORT_LABELS) as RegionSort[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      }
      testId="landfill-region-table"
    >
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-ink-subtle" data-testid="landfill-region-empty">
          해당 조건의 반입 자료가 없습니다.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto border-t border-hairline">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <caption className="sr-only">
                선택한 조건({periodLabel})의 광역지자체별 반입량, 비중, 공식 반입수수료,{" "}
                {EFFECTIVE_FEE_LABEL}, {PER_CAPITA_LABEL}. {SORT_LABELS[sort]} 내림차순.
              </caption>
              <thead>
                {/* The grouped header the design asks for. `colSpan` groups are
                    announced as such, and each leaf column keeps its own scope="col". */}
                <tr className="border-b border-hairline bg-surface-muted text-[11px] text-ink-subtle">
                  <th scope="col" rowSpan={2} className="px-3 py-2 text-left font-medium">
                    지역
                  </th>
                  <th colSpan={2} className="border-l border-hairline px-3 py-1.5 text-center font-semibold">
                    수도권매립지 반입량
                  </th>
                  <th colSpan={3} className="border-l border-hairline px-3 py-1.5 text-center font-semibold">
                    공식 반입수수료
                  </th>
                </tr>
                <tr className="border-b border-hairline bg-surface-muted text-xs text-ink-muted">
                  <th scope="col" className="border-l border-hairline px-3 py-2 text-right font-medium">
                    반입량
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    비중
                  </th>
                  <th scope="col" className="border-l border-hairline px-3 py-2 text-right font-medium">
                    금액
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {EFFECTIVE_FEE_LABEL}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {PER_CAPITA_LABEL}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((share) => {
                  const perCapita = share.fee_per_capita;
                  const value = perCapita.fee_per_capita_krw;
                  const ratio = barRatio(share.quantity_tons, originMax);
                  const population = perCapita?.population ?? null;
                  return (
                    <tr
                      key={share.origin_region_code}
                      className="border-b border-hairline last:border-0"
                      data-testid="landfill-region-row"
                    >
                      <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                        {share.origin_name}
                        <span className="block text-[11px] font-normal text-ink-subtle">
                          {population !== null
                            ? `${population.toLocaleString("en-US")}명`
                            : "인구 자료 없음"}
                        </span>
                      </th>
                      <td className="border-l border-hairline px-3 py-2 text-right tabular-nums text-ink-muted">
                        {formatTons(share.quantity_kg)}
                        {ratio !== null && <LandfillProportionRule ratio={ratio} align="right" />}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                        {formatShare(share.quantity_share)}
                      </td>
                      <td className="border-l border-hairline px-3 py-2 text-right tabular-nums text-ink-muted">
                        {formatKrwEok(share.inbound_fee_krw)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                        {formatEffectiveFee(share.effective_fee_per_ton)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                        {value !== null ? (
                          formatKrwPerPerson(value)
                        ) : (
                          <>
                            {/* Never 0원: an absent denominator is not a zero fee.
                                Neutral gray, not amber — amber cautions about a value
                                that EXISTS. The served reason is the label, so the
                                state is carried by text and never by colour. A
                                `DataStatusBadge` is deliberately not used in this
                                cell: `.wep-badge` is `white-space: nowrap`, and the
                                longest served reason would widen the column far past
                                the table. */}
                            <span className="text-ink-subtle" data-testid="landfill-row-unavailable">
                              {perCapitaUnavailableLabel(perCapita.unavailable_reason)}
                            </span>
                            {/* A reason code this build cannot translate must stay
                                recoverable from the page. */}
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
          <p
            className="px-4 pt-3 pb-4 text-[11px] leading-relaxed text-ink-subtle"
            data-testid="landfill-region-grain-note"
          >
            · 수도권매립지 자료는 광역지자체(시·도) 단위로만 보고되므로 시·군·구 단위로 펼칠 수
            없습니다. 시·군·구 단위의 폐기물 발생량과 시설 처리량은 위의 「지역별 폐기물 발생과 처리
            비교」에서 각자의 지역 단위로 확인할 수 있습니다.
          </p>
        </>
      )}
    </SectionCard>
  );
}
