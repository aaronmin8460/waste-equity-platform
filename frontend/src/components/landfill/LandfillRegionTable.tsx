"use client";

/**
 * 지역별 상세 현황 — Figma 125:5358.
 *
 * The exact-value table, with the grouped header the design asks for, the two sort
 * options the technical-request frame specifies (반입량 · 반입수수료), and the
 * behaviour the design states in writing beneath it:
 *
 *     "· 지역명을 클릭하면 시/군/구 단위 상세 데이터를 확인할 수 있습니다."
 *
 * ── The two grains, and why a row belongs to exactly one of them ───────────────
 * The screen carries FOUR datasets that are published on THREE different
 * geographies, and a row must never imply it holds a figure at a grain its source
 * does not report:
 *
 *   광역 (3 rows)    수도권매립지 반입량 / 반입수수료 — the corporation reports
 *                    시·도 totals only, and declares no municipal origin.
 *   시·군·구 (66)    폐기물 발생량 (RCIS, 발생지 기준)
 *                    시설 처리량 (facility inventory, 시설 소재지 기준)
 *                    생활폐기물 수집·운반 계약 지급액 (each 기초지자체, 2024)
 *
 * So a METROPOLITAN row carries the landfill columns as served values and the
 * municipal columns as the exact SUM of its own municipalities; a MUNICIPALITY row
 * carries the municipal columns and states 시·도 단위 보고 in the landfill columns.
 * That is an absence of the CONCEPT at this grain, not a missing measurement, and it
 * is worded differently from 자료 없음 for exactly that reason. Apportioning a sido
 * inbound total down to districts would fabricate the origin data the source
 * explicitly withholds.
 *
 * ── What is NOT summed ────────────────────────────────────────────────────────
 *   - 계약 지급액 is never rolled up to a metropolitan total. Only 46 of the 66
 *     municipalities published an amount, so a metropolitan "total" would be a
 *     partial sum wearing a complete label. The metropolitan row shows the COVERAGE
 *     COUNT (n곳/m곳) instead, and the amounts stay on the municipality rows.
 *   - 계약 지급액 is never added to, differenced against, or ranked beside 반입수수료.
 *     They are separate column groups with separate headers, separate units, and a
 *     stated distinction; the two never share a cell or a total.
 *   - 발생량 and 처리량 are never divided by one another (different accounting bases).
 *
 * ── Sorting ──────────────────────────────────────────────────────────────────
 * Reordering three metropolitan rows by an exact served number changes nothing about
 * any value. The comparison is over `Number()` of the served decimal strings, and a
 * row whose value is unparseable sorts LAST in either direction rather than being
 * treated as zero (which would rank an unknown as the smallest). Municipality rows
 * keep their name order inside their parent — the sort selects between two landfill
 * measures, which municipalities do not have.
 *
 * A row whose value is unavailable is NEVER dropped: it keeps its place and states
 * the served reason. The table owns its horizontal scrolling; the page body never
 * scrolls sideways because of it.
 */

import { useMemo, useState } from "react";

import type { LandfillOriginShare, LandfillSummary, LandfillTrends } from "../../lib/api";
import type { CapitalRegionWaste, MetropolitanGroup, MunicipalityRow } from "../../lib/capitalRegionWaste";
import { formatPerCapitaKg } from "../../lib/capitalRegionWaste";
import {
  formatEffectiveFee,
  formatKrwEok,
  formatKrwPerPerson,
  formatShare,
  formatTonQuantity,
  formatTons,
  perCapitaUnavailableCode,
  perCapitaUnavailableLabel,
} from "../../lib/landfill";
import { downloadLandfillWorkbook } from "../../lib/landfillExport";
import { MUNICIPAL_COST_STATUS_META } from "../../lib/municipalCost";
import SectionCard from "../ui/SectionCard";
import LandfillProportionRule from "./LandfillProportionRule";
import {
  barRatio,
  CONTRACT_PAYMENT_GROUP_LABEL,
  CONTRACT_PAYMENT_PER_CAPITA_LABEL,
  CONTRACT_PAYMENT_TOTAL_LABEL,
  EFFECTIVE_FEE_LABEL,
  LANDFILL_NOT_AT_MUNICIPAL_GRAIN,
  PAGE2_CARD_CLASS,
  PER_CAPITA_LABEL,
} from "./shared";

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

/** Placeholder for a cell whose value the platform does not hold. Never a 0. */
const EMPTY = "자료 없음";

export interface LandfillRegionTableProps {
  summary: LandfillSummary;
  originMax: number;
  periodLabel: string;
  /**
   * The monthly series, passed ONLY so the table's local 엑셀 다운로드 produces the
   * SAME workbook the 공유 및 내보내기 section produces — the design asks for the
   * action here, not for a second, narrower file with its own rules
   * (`lib/landfillExport.ts` owns every export rule this page has).
   */
  trends: LandfillTrends | null;
  /**
   * The joined municipal model. `null` while the underlying series load — the
   * landfill columns still render, and the municipal columns say so rather than
   * showing zeros.
   */
  capitalRegion: CapitalRegionWaste | null;
  /** The source year of the 발생량 / 처리량 columns, for the header unit line. */
  municipalReferenceYear: number | null;
  /** The source year of the contract-payment columns. */
  contractReferenceYear: number | null;
  /**
   * The served statement of how the contract payment differs from the official
   * inbound fee, rendered VERBATIM under the table. Passed in rather than
   * paraphrased here.
   */
  contractDistinction: string | null;
}

export default function LandfillRegionTable({
  summary,
  originMax,
  periodLabel,
  trends,
  capitalRegion,
  municipalReferenceYear,
  contractReferenceYear,
  contractDistinction,
}: LandfillRegionTableProps) {
  const [sort, setSort] = useState<RegionSort>("quantity");
  // Which metropolitan rows are expanded. Local presentation state only — it is not
  // a filter, it changes no request, and it is deliberately not in the URL: a shared
  // link should restore an ANALYSIS, not someone else's open/closed rows.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const groupByOrigin = useMemo(() => {
    const map = new Map<string, MetropolitanGroup>();
    for (const group of capitalRegion?.groups ?? []) map.set(group.landfillOrigin, group);
    return map;
  }, [capitalRegion]);

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

  const unitLine = [
    "단위: t · 억원",
    municipalReferenceYear != null ? `발생량·처리량 ${municipalReferenceYear}년` : null,
    contractReferenceYear != null ? `계약 지급액 ${contractReferenceYear}년` : null,
    `반입 ${periodLabel}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SectionCard
      flush
      title="지역별 상세 현황"
      description={unitLine}
      headerAside={
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          <RegionTableExcelAction summary={summary} trends={trends} />
        </div>
      }
      className={PAGE2_CARD_CLASS}
      testId="landfill-region-table"
    >
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-ink-subtle" data-testid="landfill-region-empty">
          해당 조건의 반입 자료가 없습니다.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto border-t border-hairline">
            <table className="w-full min-w-[72rem] border-collapse text-sm">
              <caption className="sr-only">
                선택한 조건({periodLabel})의 광역지자체별 폐기물 발생량, 시설 처리량, 수도권매립지
                반입량과 공식 반입수수료. 지역 이름을 누르면 해당 광역지자체의 시·군·구별 발생량,
                처리량, 생활폐기물 수집·운반 계약 지급액이 펼쳐집니다. {SORT_LABELS[sort]} 내림차순.
              </caption>
              <thead>
                {/* The grouped header the design asks for. `colSpan` groups are
                    announced as such, and each leaf column keeps its own scope="col". */}
                <tr className="border-b border-hairline bg-surface-muted text-[11px] text-ink-subtle">
                  <th scope="col" rowSpan={2} className="px-3 py-2 text-left font-medium">
                    지역
                  </th>
                  <th colSpan={2} className="border-l border-hairline px-3 py-1.5 text-center font-semibold">
                    폐기물 발생량
                  </th>
                  <th colSpan={2} className="border-l border-hairline px-3 py-1.5 text-center font-semibold">
                    시설 처리량 (지역 내)
                  </th>
                  <th colSpan={2} className="border-l border-hairline px-3 py-1.5 text-center font-semibold">
                    수도권매립지 반입량
                  </th>
                  <th colSpan={3} className="border-l border-hairline px-3 py-1.5 text-center font-semibold">
                    공식 반입수수료
                  </th>
                  {/* A SEPARATE group with its own name and year. It sits last and is
                      never adjacent to a fee subtotal, so no cell of it can be read
                      as part of the official fee to its left. */}
                  <th colSpan={2} className="border-l-2 border-hairline-strong px-3 py-1.5 text-center font-semibold">
                    {CONTRACT_PAYMENT_GROUP_LABEL}
                    {contractReferenceYear != null && (
                      <span className="ml-1 font-normal">({contractReferenceYear})</span>
                    )}
                  </th>
                </tr>
                <tr className="border-b border-hairline bg-surface-muted text-xs text-ink-muted">
                  <th scope="col" className="border-l border-hairline px-3 py-2 text-right font-medium">
                    총 발생량
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    1인당 (kg/인·년)
                  </th>
                  <th scope="col" className="border-l border-hairline px-3 py-2 text-right font-medium">
                    총 처리량
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    1인당 (kg/인·년)
                  </th>
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
                  <th scope="col" className="border-l-2 border-hairline-strong px-3 py-2 text-right font-medium">
                    {CONTRACT_PAYMENT_TOTAL_LABEL}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {CONTRACT_PAYMENT_PER_CAPITA_LABEL}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((share) => {
                  const group = groupByOrigin.get(share.origin_sgis_code) ?? null;
                  const isOpen = expanded[share.origin_region_code] ?? false;
                  return (
                    <MetropolitanRows
                      key={share.origin_region_code}
                      share={share}
                      group={group}
                      originMax={originMax}
                      open={isOpen}
                      onToggle={() =>
                        setExpanded((current) => ({
                          ...current,
                          [share.origin_region_code]: !isOpen,
                        }))
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 pt-3 pb-4 text-[11px] leading-relaxed text-ink-subtle">
            <p data-testid="landfill-region-grain-note">
              · 지역 이름을 누르면 시·군·구 단위 상세 자료가 펼쳐집니다. 수도권매립지 반입 자료는
              광역지자체(시·도) 단위로만 보고되므로 시·군·구 행에서는 「
              {LANDFILL_NOT_AT_MUNICIPAL_GRAIN}」으로 표시되며, 값이 0이라는 뜻이 아닙니다.
            </p>
            {/* What the local 엑셀 다운로드 beside the heading actually contains. The
                file is the shared landfill workbook, which by design holds only the
                official-fee dataset — so the two contract-payment columns in this
                table are NOT in it, and saying so here is the difference between a
                scoped file and a file a reader thinks is the whole table. */}
            <p className="mt-1" data-testid="landfill-region-export-scope">
              · 엑셀 다운로드에는 공식 반입 자료만 담기며, 회계 기준이 다른 계약 지급액은 포함되지
              않습니다.
            </p>
            {contractDistinction && (
              // Served verbatim. It sits at the point of use — beside the column
              // group it qualifies — rather than in a separate banner above the
              // dashboard, so the reader meets it while looking at the numbers.
              <p className="mt-1" data-testid="landfill-region-contract-distinction">
                · {contractDistinction}
              </p>
            )}
          </div>
        </>
      )}
    </SectionCard>
  );
}

/**
 * 엑셀 다운로드 — the local export the design places on this table's own header
 * (Figma 376:582).
 *
 * It calls `downloadLandfillWorkbook`, the SAME function the 공유 및 내보내기 section
 * calls, so there is exactly one definition of what a landfill workbook contains,
 * one filename rule, one preamble, and one "an unserved value is an empty cell,
 * never 0" guarantee. This component adds no column, no sheet, and no scope of its
 * own — it is a second entry point to one file, not a second file.
 */
function RegionTableExcelAction({
  summary,
  trends,
}: {
  summary: LandfillSummary;
  trends: LandfillTrends | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        className="wep-btn-quiet"
        data-testid="landfill-region-export-xlsx"
        disabled={busy}
        // The visible label is the design's. The accessible name adds the scope,
        // because "엑셀 다운로드" alone does not say which of this screen's two
        // datasets the file holds.
        aria-label="공식 반입 자료 엑셀(.xlsx) 다운로드"
        onClick={() => {
          setBusy(true);
          setError(null);
          downloadLandfillWorkbook(summary, trends)
            .catch(() => setError("파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요."))
            .finally(() => setBusy(false));
        }}
      >
        <span aria-hidden>↓</span> {busy ? "파일 만드는 중…" : "엑셀 다운로드"}
      </button>
      {error && (
        <p
          className="mt-1 text-xs text-danger"
          role="alert"
          data-testid="landfill-region-export-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One metropolitan row plus, when expanded, its municipalities.
 *
 * Returned as a fragment of `<tr>`s rather than a nested table so every row shares
 * ONE column grid — a nested table would let the two grains drift out of alignment
 * and would announce a second, unrelated table to a screen reader.
 */
function MetropolitanRows({
  share,
  group,
  originMax,
  open,
  onToggle,
}: {
  share: LandfillOriginShare;
  group: MetropolitanGroup | null;
  originMax: number;
  open: boolean;
  onToggle: () => void;
}) {
  const perCapita = share.fee_per_capita;
  const value = perCapita.fee_per_capita_krw;
  const ratio = barRatio(share.quantity_tons, originMax);
  const population = perCapita?.population ?? null;
  const municipalities = group?.municipalities ?? [];

  return (
    <>
      <tr className="border-b border-hairline" data-testid="landfill-region-row">
        <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
          {municipalities.length > 0 ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              // No `aria-controls`: the disclosure reveals N sibling <tr>s, and an
              // id can only point at one of them. `aria-expanded` on the trigger is
              // the part assistive technology actually acts on, and the revealed
              // rows follow immediately in the reading order.
              className="flex items-center gap-1 rounded-control text-left font-medium text-ink hover:underline"
              data-testid="landfill-region-expand"
              data-origin={share.origin_sgis_code}
            >
              {/* Decorative: the state is already carried by aria-expanded and by
                  the visible 접기/펼치기 word, so direction is never colour- or
                  glyph-only. */}
              <span aria-hidden>{open ? "⌄" : "›"}</span>
              {share.origin_name}
              <span className="sr-only">
                {" "}
                {group?.tierLabel ?? "시·군·구"} 상세 {open ? "접기" : "펼치기"}
              </span>
            </button>
          ) : (
            share.origin_name
          )}
          <span className="block text-[11px] font-normal text-ink-subtle">
            {population !== null ? `${population.toLocaleString("en-US")}명` : "인구 자료 없음"}
            {municipalities.length > 0 && (
              <span data-testid="landfill-region-municipal-count">
                {" "}
                · {group?.tierLabel} {municipalities.length}곳
              </span>
            )}
          </span>
        </th>

        {/* 폐기물 발생량 — the exact sum of this metropolitan's municipalities. */}
        <NumericCell
          className="border-l border-hairline"
          value={group?.generationTons != null ? formatTonQuantity(group.generationTons) : null}
        />
        <NumericCell value={formatPerCapitaKg(group?.generationPerCapitaKg ?? null)} />

        {/* 시설 처리량 (지역 내) */}
        <NumericCell
          className="border-l border-hairline"
          value={group?.throughputTons != null ? formatTonQuantity(group.throughputTons) : null}
        />
        <NumericCell value={formatPerCapitaKg(group?.throughputPerCapitaKg ?? null)} />

        {/* 수도권매립지 반입량 — served at this grain. Carries a test id because the
            column INDEX is no longer stable: this row now leads with the municipal
            generation and throughput columns, and specs that reached for the first
            `<td>` were silently reading a different dataset. */}
        <td
          className="border-l border-hairline px-3 py-2 text-right tabular-nums text-ink-muted"
          data-testid="landfill-region-quantity"
        >
          {formatTons(share.quantity_kg)}
          {ratio !== null && <LandfillProportionRule ratio={ratio} align="right" />}
        </td>
        <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
          {formatShare(share.quantity_share)}
        </td>

        {/* 공식 반입수수료 */}
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
              {/* Never 0원: an absent denominator is not a zero fee. Neutral gray,
                  not amber — amber cautions about a value that EXISTS. The served
                  reason is the label, so the state is carried by text and never by
                  colour. A `DataStatusBadge` is deliberately not used in this cell:
                  `.wep-badge` is `white-space: nowrap`, and the longest served
                  reason would widen the column far past the table. */}
              <span className="text-ink-subtle" data-testid="landfill-row-unavailable">
                {perCapitaUnavailableLabel(perCapita.unavailable_reason)}
              </span>
              {/* A reason code this build cannot translate must stay recoverable. */}
              {perCapitaUnavailableCode(perCapita.unavailable_reason) && (
                <span className="block text-[11px] text-ink-subtle" data-diagnostic>
                  기술 코드: {perCapitaUnavailableCode(perCapita.unavailable_reason)}
                </span>
              )}
            </>
          )}
        </td>

        {/* 계약 지급액 — a COVERAGE COUNT at this grain, never a partial sum. */}
        <td
          className="border-l-2 border-hairline-strong px-3 py-2 text-right text-[11px] text-ink-subtle"
          colSpan={2}
          data-testid="landfill-region-contract-coverage"
        >
          {group?.contractCoverage
            ? `${group.contractCoverage.total}곳 중 ${group.contractCoverage.withAmount}곳 공개 · 합계는 표시하지 않습니다`
            : "자료 없음"}
        </td>
      </tr>

      {open &&
        municipalities.map((municipality) => (
          <MunicipalityTableRow key={municipality.code} row={municipality} />
        ))}
    </>
  );
}

/**
 * One 시·군·구 row.
 *
 * It carries the three datasets published at this grain and states plainly that the
 * landfill columns are not reported here. The contract-payment cells show the served
 * amount or, when none was served, the backend's own reason sentence — never ₩0.
 */
function MunicipalityTableRow({ row }: { row: MunicipalityRow }) {
  const contract = row.contract;
  const statusMeta = contract ? MUNICIPAL_COST_STATUS_META[contract.status] : null;
  return (
    <tr
      className="border-b border-hairline bg-surface-muted/40 last:border-0"
      data-testid="landfill-municipality-row"
      data-region-code={row.code}
    >
      <th scope="row" className="py-2 pr-3 pl-8 text-left text-xs font-medium text-ink-muted">
        {row.name}
        <span className="block text-[11px] font-normal text-ink-subtle">
          {row.population !== null ? `${row.population.toLocaleString("en-US")}명` : "인구 자료 없음"}
          {" · "}
          {row.tierLabel}
          {/* The seven Gyeonggi cities RCIS reports at city level exist canonically
              only as 일반구, so both their numerator and their denominator are a
              roll-up. Saying so here keeps a reader from taking the figure for a
              source-reported city-level observation. */}
          {row.isCityUnion && (
            <span data-testid="landfill-municipality-derived"> · 구성 일반구 합산</span>
          )}
        </span>
      </th>

      <NumericCell
        small
        className="border-l border-hairline"
        value={row.generationTons != null ? formatTonQuantity(row.generationTons) : null}
        note={
          row.missingStreams.length > 0
            ? `미보고 ${row.missingStreams.length}개 계열 제외`
            : undefined
        }
        noteTestId={row.missingStreams.length > 0 ? "landfill-municipality-missing-stream" : undefined}
      />
      <NumericCell small value={formatPerCapitaKg(row.generationPerCapitaKg)} />

      <NumericCell
        small
        className="border-l border-hairline"
        value={row.throughputTons != null ? formatTonQuantity(row.throughputTons) : null}
        note={row.throughputIsPartial ? "일부 시설 처리량 결측 — 과소집계" : undefined}
      />
      <NumericCell small value={formatPerCapitaKg(row.throughputPerCapitaKg)} />

      {/* The five landfill columns (반입량 · 비중 · 금액 · 톤당 환산 · 1인당 환산),
          spanned into one statement. NOT "자료 없음": the source reports this dataset
          at 시·도 grain and declares no municipal origin, so no municipal figure was
          measured and withheld — none exists to report. */}
      <td
        className="border-l border-hairline px-3 py-2 text-right text-[11px] text-ink-subtle"
        colSpan={5}
        data-testid="landfill-municipality-no-landfill"
      >
        {LANDFILL_NOT_AT_MUNICIPAL_GRAIN}
      </td>

      <td className="border-l-2 border-hairline-strong px-3 py-2 text-right text-xs tabular-nums text-ink-muted">
        {contract?.totalPaymentKrw != null ? (
          <span data-testid="landfill-municipality-contract-total">
            {formatKrwEok(contract.totalPaymentKrw)}
          </span>
        ) : (
          // Never ₩0. The served status label is the citizen-facing text; the
          // backend's own limitation sentence sits beneath it as the reason.
          <span className="text-ink-subtle" data-testid="landfill-municipality-contract-unavailable">
            {statusMeta?.label ?? EMPTY}
          </span>
        )}
        {contract?.limitation && contract.totalPaymentKrw == null && (
          <span className="mt-0.5 block text-[10px] leading-tight font-normal text-ink-subtle">
            {contract.limitation}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-muted">
        {contract?.perCapitaKrw != null ? (
          <span data-testid="landfill-municipality-contract-per-capita">
            {formatKrwPerPerson(contract.perCapitaKrw)}
          </span>
        ) : (
          <span className="text-ink-subtle">—</span>
        )}
      </td>
    </tr>
  );
}

/**
 * A right-aligned numeric cell that renders `자료 없음` — never `0` — for a value the
 * platform does not hold, with an optional qualifying note beneath.
 */
function NumericCell({
  value,
  className,
  small = false,
  note,
  noteTestId,
}: {
  value: string | null;
  className?: string;
  small?: boolean;
  note?: string;
  noteTestId?: string;
}) {
  return (
    <td
      className={`px-3 py-2 text-right tabular-nums ${small ? "text-xs" : ""} text-ink-muted ${className ?? ""}`.trim()}
    >
      {value ?? <span className="text-ink-subtle">{EMPTY}</span>}
      {note && (
        <span
          className="mt-0.5 block text-[10px] leading-tight font-normal text-ink-subtle"
          data-testid={noteTestId}
        >
          {note}
        </span>
      )}
    </td>
  );
}
