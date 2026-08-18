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
 * ── ⚠️ 시·군·구 IS THE DETAIL ROW — a deliberate divergence from the frame ─────
 * The Figma frame draws THREE collapsed 시·도 parents that the reader must expand to
 * reach any municipality, and its annotation #21 describes that expansion. The
 * product requirement overrides it: the detailed regional view operates directly at
 * 시·군·구 grain, and municipalities are NOT hidden behind a parent disclosure.
 *
 * So every 시·군·구 row is rendered and visible on arrival. 시·도 survives as a
 * GROUPING/CONTEXT field rather than as the data row:
 *   - a group header row per 시·도, which is also the only place the landfill inbound
 *     columns can appear at all (the corporation publishes them at 시·도 and declares
 *     no municipal origin), plus the contract-payment COVERAGE COUNT;
 *   - the 시·도 name repeated on each municipality row's label cell, so the grouping
 *     survives sorting and is announced with the row;
 *   - a collapse toggle kept purely as a grouping affordance — it starts OPEN, so it
 *     can hide nothing the reader has not chosen to hide.
 *
 * ── Sorting (기술요청 #20) ────────────────────────────────────────────────────
 * The separate 정렬 기준 dropdown is GONE and the 엑셀 다운로드 action takes its place
 * in the header, which is what #20 asks for. Sorting moved onto the column headers,
 * which is what Figma spec sheet 9 asks for ("표 정렬 및 Excel/CSV 다운로드 가능하도록
 * 구성") — one affordance satisfying both, rather than a control that says one thing
 * and a spec that says another.
 *
 * Only columns published at 시·군·구 grain are sortable, and the sort reorders
 * municipalities WITHIN their 시·도 group, so it can never interleave rows from
 * different groups under a group header. The five landfill columns are not sortable
 * because they do not exist on a municipality row at all.
 *
 * The comparison is over `Number()` of the served decimal strings — a positional
 * decision that never reconstructs a displayed figure — and a row whose value is
 * absent or unparseable sorts LAST in either direction rather than being treated as
 * zero (which would rank an unknown as the cheapest).
 *
 * A row whose value is unavailable is NEVER dropped: it keeps its place and states
 * the served reason. The table owns its horizontal scrolling; the page body never
 * scrolls sideways because of it.
 */

import { useMemo, useState } from "react";

import type { LandfillOriginShare, LandfillSummary, LandfillTrends } from "../../lib/api";
import type { CapitalRegionWaste, MetropolitanGroup, MunicipalityRow } from "../../lib/capitalRegionWaste";
import {
  formatPerCapitaKg,
  MANAGEMENT_COST_BASIS_NOTE,
  METRO_LANDFILL_FEE_PER_CAPITA_LABEL,
} from "../../lib/capitalRegionWaste";
import { SCOPE_LABELS } from "../../lib/ranking";
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

/**
 * The sortable columns — every one of them published at 시·군·구 grain.
 *
 * The five landfill columns are deliberately absent: they exist only on the 시·도
 * group header, so offering them here would promise an ordering of rows that hold no
 * such value.
 */
type MunicipalSort =
  | "name"
  | "generation"
  | "generationPerCapita"
  | "throughput"
  | "throughputPerCapita"
  | "contractTotal"
  | "contractPerCapita"
  | "managementTotal";

type SortDirection = "asc" | "desc";

/**
 * One municipality's value under a sort key, or `null` when the platform holds none.
 *
 * `null` is NOT 0 and never sorts as 0 — see `compareMunicipalities`.
 */
function municipalSortValue(row: MunicipalityRow, key: MunicipalSort): number | null {
  const numeric = (raw: string | null | undefined): number | null => {
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  switch (key) {
    case "generation":
      return numeric(row.generationTons);
    case "generationPerCapita":
      return row.generationPerCapitaKg;
    case "throughput":
      return numeric(row.throughputTons);
    case "throughputPerCapita":
      return row.throughputPerCapitaKg;
    case "contractTotal":
      return numeric(row.contract?.totalPaymentKrw ?? null);
    case "contractPerCapita":
      return numeric(row.contract?.perCapitaKrw ?? null);
    case "managementTotal":
      return numeric(row.managementCost.totalPerCapitaKrw);
    case "name":
      return null;
  }
}

/** Order two municipalities, with absent values pinned last in BOTH directions. */
function compareMunicipalities(
  a: MunicipalityRow,
  b: MunicipalityRow,
  key: MunicipalSort,
  direction: SortDirection,
): number {
  if (key === "name") {
    const byName = a.name.localeCompare(b.name, "ko");
    return direction === "asc" ? byName : -byName;
  }
  const left = municipalSortValue(a, key);
  const right = municipalSortValue(b, key);
  // An unknown is not the smallest value — it is not a value. It goes last whichever
  // way the column is pointing, so a municipality that disclosed nothing can never
  // be presented as the cheapest (or the largest) in the column.
  if (left === null && right === null) return a.name.localeCompare(b.name, "ko");
  if (left === null) return 1;
  if (right === null) return -1;
  if (left === right) return a.name.localeCompare(b.name, "ko");
  return direction === "asc" ? left - right : right - left;
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
  /**
   * Open one municipality's detail — what 기술요청 #21's sentence ("표 우측의 지역명을
   * 누르면 시·군·구별 상세 지표를 확인할 수 있습니다") promises the region name does.
   *
   * Optional: with no handler the name renders as plain text rather than as a button
   * that does nothing, so the affordance is never advertised without the behaviour.
   */
  onSelectMunicipality?: (row: MunicipalityRow) => void;
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
  onSelectMunicipality,
}: LandfillRegionTableProps) {
  // The active column sort. 시·군·구 rows are ordered by NAME on arrival, which is the
  // neutral presentation: no column is implied to be the one that matters.
  const [sort, setSort] = useState<{ key: MunicipalSort; direction: SortDirection }>({
    key: "name",
    direction: "asc",
  });
  // Which 시·도 groups are COLLAPSED. Inverted on purpose: the default is expanded, so
  // an unrecorded group is open and the 시·군·구 rows — the actual detail grain — are
  // visible on arrival without any interaction. Local presentation state only; it is
  // not a filter, changes no request, and is deliberately not in the URL.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groupByOrigin = useMemo(() => {
    const map = new Map<string, MetropolitanGroup>();
    for (const group of capitalRegion?.groups ?? []) map.set(group.landfillOrigin, group);
    return map;
  }, [capitalRegion]);

  // The 시·도 group headers keep the served landfill reading order (반입량 desc), which
  // is the order the frame draws and the only ordering the landfill columns support.
  // Column sorting reorders the municipalities INSIDE each group instead.
  const rows = useMemo(() => {
    return [...summary.origin_shares].sort((a, b) => {
      const left = Number(a.quantity_tons);
      const right = Number(b.quantity_tons);
      // Unreadable values last, in both directions — never ordered as if they were 0.
      if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
      if (!Number.isFinite(left)) return 1;
      if (!Number.isFinite(right)) return -1;
      return right - left;
    });
  }, [summary.origin_shares]);

  /** Toggle a column: first click sorts, clicking the active column reverses it. */
  const toggleSort = (key: MunicipalSort) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : // A name column reads A→Z first; a measure reads largest-first, which is
          // what a reader scanning for the biggest figure expects.
          { key, direction: key === "name" ? "asc" : "desc" },
    );

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
      /* 기술요청 #20: the 정렬 기준 dropdown is REMOVED and 엑셀 다운로드 occupies its
         place. Sorting did not disappear with it — it moved onto the column headers
         (Figma spec sheet 9), where it can address each column individually instead
         of offering two of the twelve. */
      headerAside={
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          {/* `relative min-w-0` — BOTH are load-bearing, and each fixes a different
              half of the same escape. Measured at the 1024 floor:

              1. `min-w-0`: the shared `.wep-table` sets `white-space: nowrap` on its
                 header cells, which raises this 13-column table's MIN-CONTENT width
                 well past the viewport. A scroll container whose own `min-width` is
                 still `auto` refuses to shrink below that, so the box grew to the
                 table's full width instead of scrolling.

              2. `relative`: the sortable headers each carry an `.sr-only` span, which
                 is `position: absolute`. With no positioned ancestor its containing
                 block is the initial one, so a span sitting at x≈1372 INSIDE the
                 horizontally-scrolled table extended the <html> scroll width to 1373
                 — page-level horizontal scrolling, even though every element from the
                 card upward measured 1024. Positioning this box makes it the
                 containing block, so those spans are clipped with the table.

              `landfillDashboard.spec.ts` ("keeps the regional table's overflow local
              to the table") is what catches either regression. */}
          <div className="relative min-w-0 overflow-x-auto border-t border-hairline">
            {/* 기술요청 #22 — the SHARED `.wep-table` (globals.css, owned by the
                foundation commit): a grey 1px rule on every edge, centred cells and a
                tinted header. Applied, never re-implemented; the per-column
                `.wep-table-num` / `.wep-table-text` opt-outs below are the documented
                way to keep a comparison column on its digits and a scanned label on
                the reading edge. */}
            <table className="wep-table min-w-[80rem]">
              <caption className="sr-only">
                선택한 조건({periodLabel})의 시·군·구별 폐기물 발생량, 시설 처리량, 생활폐기물
                수집·운반 계약 지급액과 주민 1인당 총 관리비용. 시·군·구 행이 기본 표시되며, 시·도
                행은 수도권매립지 반입량과 공식 반입수수료를 함께 나타냅니다(해당 자료는 시·도
                단위로만 보고됩니다). 열 제목을 누르면 각 시·도 안에서 시·군·구를 정렬합니다.
              </caption>
              <thead>
                {/* The grouped header the design asks for. `colSpan` groups are
                    announced as such, and each leaf column keeps its own scope="col". */}
                <tr>
                  <th scope="col" rowSpan={2} className="wep-table-text">
                    지역
                  </th>
                  <th colSpan={2}>폐기물 발생량</th>
                  <th colSpan={2}>시설 처리량 (지역 내)</th>
                  {/* Reported at 시·도 grain only — so these two groups are populated
                      on the group header row and state 시·도 단위 보고 on a 시·군·구 row. */}
                  <th colSpan={2}>수도권매립지 반입량</th>
                  <th colSpan={3}>공식 반입수수료</th>
                  {/* A SEPARATE group with its own name and year. It sits last and is
                      never adjacent to a fee subtotal, so no cell of it can be read
                      as part of the official fee to its left. */}
                  <th colSpan={2}>
                    {CONTRACT_PAYMENT_GROUP_LABEL}
                    {contractReferenceYear != null && (
                      <span className="ml-1 font-normal">({contractReferenceYear})</span>
                    )}
                  </th>
                  {/* The combined per-resident figure. Its own group, because it is
                      the only column that spans BOTH datasets — and its header names
                      that in one line so the sum is never mistaken for part of the
                      contract group to its left. */}
                  <SortableHeader
                    label={MANAGEMENT_COST_COLUMN_LABEL}
                    sortKey="managementTotal"
                    sort={sort}
                    onSort={toggleSort}
                    rowSpan={2}
                    testId="landfill-region-management-header"
                  />
                </tr>
                <tr>
                  <SortableHeader
                    label="총 발생량"
                    sortKey="generation"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label="1인당 (kg/인·년)"
                    sortKey="generationPerCapita"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label="총 처리량"
                    sortKey="throughput"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label="1인당 (kg/인·년)"
                    sortKey="throughputPerCapita"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  {/* NOT sortable: no municipality row holds these values. */}
                  <th scope="col">반입량</th>
                  <th scope="col">비중</th>
                  <th scope="col">금액</th>
                  <th scope="col">{EFFECTIVE_FEE_LABEL}</th>
                  <th scope="col">{PER_CAPITA_LABEL}</th>
                  <SortableHeader
                    label={CONTRACT_PAYMENT_TOTAL_LABEL}
                    sortKey="contractTotal"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label={CONTRACT_PAYMENT_PER_CAPITA_LABEL}
                    sortKey="contractPerCapita"
                    sort={sort}
                    onSort={toggleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {rows.map((share) => {
                  const group = groupByOrigin.get(share.origin_sgis_code) ?? null;
                  // Expanded unless the reader collapsed this group themselves.
                  const isOpen = !(collapsed[share.origin_region_code] ?? false);
                  return (
                    <MetropolitanRows
                      key={share.origin_region_code}
                      share={share}
                      group={group}
                      originMax={originMax}
                      open={isOpen}
                      sort={sort}
                      onSelectMunicipality={onSelectMunicipality}
                      onToggle={() =>
                        setCollapsed((current) => ({
                          ...current,
                          [share.origin_region_code]: isOpen,
                        }))
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 pt-3 pb-4 text-[11px] leading-relaxed text-ink-subtle">
            {/* Both lines are load-bearing rather than decorative: the first states the
                affordance and then the reason a 시·군·구 row shows a phrase instead of a
                number (and that the phrase is not a zero); the second says what the
                local 엑셀 다운로드 beside the heading actually contains — the shared
                landfill workbook holds only the official-fee dataset, so this table's
                two contract-payment columns are NOT in it, which is the difference
                between a scoped file and a file a reader thinks is the whole table. */}
            {/* 기술요청 #21. The previous sentence ("지역 이름을 누르면 … 펼쳐집니다")
                described a disclosure that no longer exists — 시·군·구 rows are the
                detail grain and are shown outright — so leaving it would have been
                describing the wrong interaction. What the region name now does is
                open that municipality's own detail, which is what this sentence says.

                The second clause is data integrity and is KEPT verbatim: it is the
                only place the page says that a blank landfill cell on a 시·군·구 row
                means the value does not EXIST at that grain rather than being zero. */}
            <p data-testid="landfill-region-grain-note">
              · 표 우측의 지역명을 누르면 시·군·구별 상세 지표를 확인할 수 있습니다. 수도권매립지 반입
              자료는 광역지자체(시·도) 단위로만 보고되므로 시·군·구 행에서는 「
              {LANDFILL_NOT_AT_MUNICIPAL_GRAIN}」으로 표시되며, 값이 0이라는 뜻이 아닙니다.
            </p>
            {/* The basis mismatch behind the combined column, stated where it is read
                rather than hidden — the two per-resident terms rest on different
                population series and that is structural, not a defect. */}
            <p className="mt-1" data-testid="landfill-region-management-basis">
              · {MANAGEMENT_COST_COLUMN_LABEL} = 1인당 계약 지급액 + {METRO_LANDFILL_FEE_PER_CAPITA_LABEL}
              (수도권 공통 값이며 조회 지역을 바꿔도 달라지지 않습니다). {MANAGEMENT_COST_BASIS_NOTE}
            </p>
            <p className="mt-1" data-testid="landfill-region-export-scope">
              · 엑셀 다운로드에는 공식 반입 자료만 담기며, 계약 지급액은 포함되지 않습니다.
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
  sort,
  onSelectMunicipality,
  onToggle,
}: {
  share: LandfillOriginShare;
  group: MetropolitanGroup | null;
  originMax: number;
  open: boolean;
  sort: { key: MunicipalSort; direction: SortDirection };
  onSelectMunicipality?: (row: MunicipalityRow) => void;
  onToggle: () => void;
}) {
  const perCapita = share.fee_per_capita;
  const value = perCapita.fee_per_capita_krw;
  const ratio = barRatio(share.quantity_tons, originMax);
  const population = perCapita?.population ?? null;
  // Sorted WITHIN the group, so a column sort can never interleave municipalities
  // from two different 시·도 under one group header.
  const municipalities = useMemo(
    () =>
      [...(group?.municipalities ?? [])].sort((a, b) =>
        compareMunicipalities(a, b, sort.key, sort.direction),
      ),
    [group, sort],
  );

  return (
    <>
      <tr className="bg-surface-muted/70" data-testid="landfill-region-row">
        <th scope="row" className="wep-table-text font-semibold text-ink">
          {municipalities.length > 0 ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              // No `aria-controls`: the group reveals N sibling <tr>s, and an id can
              // only point at one of them. `aria-expanded` on the trigger is the part
              // assistive technology acts on, and the rows follow it in reading order.
              //
              // This is a GROUPING affordance, not a disclosure the detail lives
              // behind: it starts open, so the 시·군·구 rows are present on arrival
              // and the reader is never required to expand anything to reach them.
              className="flex items-center gap-1 rounded-control text-left font-semibold text-ink hover:underline"
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
                {group?.tierLabel ?? "시·군·구"} 묶음 {open ? "접기" : "펼치기"}
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
          value={group?.generationTons != null ? formatTonQuantity(group.generationTons) : null}
        />
        <NumericCell value={formatPerCapitaKg(group?.generationPerCapitaKg ?? null)} />

        {/* 시설 처리량 (지역 내) */}
        <NumericCell
          value={group?.throughputTons != null ? formatTonQuantity(group.throughputTons) : null}
        />
        <NumericCell value={formatPerCapitaKg(group?.throughputPerCapitaKg ?? null)} />

        {/* 수도권매립지 반입량 — served at this grain. Carries a test id because the
            column INDEX is no longer stable: this row now leads with the municipal
            generation and throughput columns, and specs that reached for the first
            `<td>` were silently reading a different dataset. */}
        <td className="wep-table-num text-ink-muted" data-testid="landfill-region-quantity">
          {formatTons(share.quantity_kg)}
          {ratio !== null && <LandfillProportionRule ratio={ratio} align="right" />}
        </td>
        <td className="wep-table-num font-semibold text-ink">
          {formatShare(share.quantity_share)}
        </td>

        {/* 공식 반입수수료 */}
        <td className="wep-table-num text-ink-muted">{formatKrwEok(share.inbound_fee_krw)}</td>
        <td className="wep-table-num text-ink-muted">
          {formatEffectiveFee(share.effective_fee_per_ton)}
        </td>
        <td className="wep-table-num text-ink-muted">
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

        {/* 계약 지급액 — a COVERAGE COUNT at this grain, never a partial sum. Only 46
            of the 66 municipalities published an amount, so a 시·도 total would be a
            partial sum wearing a complete label. The amounts stay on the rows below.

            The combined-cost column is spanned into the same statement for the same
            reason: a 시·도 combined figure would inherit that partial coverage. */}
        <td className="text-[11px] text-ink-subtle" colSpan={3} data-testid="landfill-region-contract-coverage">
          {group?.contractCoverage
            ? `${group.contractCoverage.total}곳 중 ${group.contractCoverage.withAmount}곳 공개 · 합계는 표시하지 않습니다`
            : "자료 없음"}
        </td>
      </tr>

      {open &&
        municipalities.map((municipality) => (
          <MunicipalityTableRow
            key={municipality.code}
            row={municipality}
            onSelect={onSelectMunicipality}
          />
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
function MunicipalityTableRow({
  row,
  onSelect,
}: {
  row: MunicipalityRow;
  onSelect?: (row: MunicipalityRow) => void;
}) {
  const contract = row.contract;
  const statusMeta = contract ? MUNICIPAL_COST_STATUS_META[contract.status] : null;
  return (
    <tr
      className="last:border-0"
      data-testid="landfill-municipality-row"
      data-region-code={row.code}
      data-scope={row.scope}
    >
      <th scope="row" className="wep-table-text text-xs font-medium text-ink-muted">
        {/* 기술요청 #21 — "표 우측의 지역명을 누르면 시·군·구별 상세 지표를 확인할 수
            있습니다". The name is the affordance the footnote describes. It opens this
            municipality's detail; it does NOT gate the row's own figures, every one of
            which is already rendered in this row. */}
        {onSelect ? (
          <button
            type="button"
            className="rounded-control text-left font-medium text-ink hover:underline"
            onClick={() => onSelect(row)}
            data-testid="landfill-municipality-detail"
            data-region-code={row.code}
          >
            {row.name}
            <span className="sr-only"> 상세 지표 보기</span>
          </button>
        ) : (
          row.name
        )}
        <span className="block text-[11px] font-normal text-ink-subtle">
          {/* The 시·도 travels ON the row, not only in the group header above it, so the
              grouping survives a column sort and is announced with the row rather than
              having to be inferred from a heading several rows back. */}
          <span data-testid="landfill-municipality-scope">{SCOPE_LABELS[row.scope]}</span>
          {" · "}
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
        value={row.throughputTons != null ? formatTonQuantity(row.throughputTons) : null}
        note={row.throughputIsPartial ? "일부 시설 처리량 결측 — 과소집계" : undefined}
      />
      <NumericCell small value={formatPerCapitaKg(row.throughputPerCapitaKg)} />

      {/* The five landfill columns (반입량 · 비중 · 금액 · 톤당 환산 · 1인당 환산),
          spanned into one statement. NOT "자료 없음": the source reports this dataset
          at 시·도 grain and declares no municipal origin, so no municipal figure was
          measured and withheld — none exists to report. */}
      <td className="text-[11px] text-ink-subtle" colSpan={5} data-testid="landfill-municipality-no-landfill">
        {LANDFILL_NOT_AT_MUNICIPAL_GRAIN}
      </td>

      <td className="wep-table-num text-xs text-ink-muted">
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
      <td className="wep-table-num text-xs text-ink-muted">
        {contract?.perCapitaKrw != null ? (
          <span data-testid="landfill-municipality-contract-per-capita">
            {formatKrwPerPerson(contract.perCapitaKrw)}
          </span>
        ) : (
          <span className="text-ink-subtle">—</span>
        )}
      </td>

      {/* 주민 1인당 총 폐기물 관리비용 = this municipality's 1인당 계약 지급액 + the ONE
          common 수도권 반입수수료 per resident. Exact-decimal, computed in
          `lib/capitalRegionWaste.ts`.

          A missing operand makes the total —, never a partial figure and never 0:
          without this rule the ~20 municipalities that disclosed no payment would
          each read as the metropolitan fee alone and rank as the cheapest places in
          the capital region. */}
      <td className="wep-table-num text-xs font-semibold text-ink">
        {row.managementCost.totalPerCapitaKrw != null ? (
          <span data-testid="landfill-municipality-management-total">
            {formatKrwPerPerson(row.managementCost.totalPerCapitaKrw)}
          </span>
        ) : (
          <span
            className="font-normal text-ink-subtle"
            data-testid="landfill-municipality-management-unavailable"
          >
            —
          </span>
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
    <td className={`wep-table-num ${small ? "text-xs" : ""} text-ink-muted ${className ?? ""}`.trim()}>
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


/**
 * The combined per-resident cost column's name.
 *
 * It says 총 — the sum of BOTH datasets — in the header itself, because this is the
 * one column on the table that crosses the boundary the rest of the page keeps: every
 * other column belongs to exactly one dataset. The footnote beneath the table gives
 * the formula and the population-basis difference.
 */
const MANAGEMENT_COST_COLUMN_LABEL = "주민 1인당 총 관리비용";

/**
 * A column header that sorts the 시·군·구 rows (기술요청 #20 + Figma spec sheet 9).
 *
 * A real `<button>` inside the `<th>`, with `aria-sort` on the `<th>` itself — that is
 * the pair assistive technology reads, and it means the sort is operable from the
 * keyboard without any custom key handling. The arrow is `aria-hidden` decoration: the
 * state is already carried by `aria-sort` and by the button's own accessible name, so
 * direction is never glyph-only.
 */
function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  rowSpan,
  testId,
}: {
  label: string;
  sortKey: MunicipalSort;
  sort: { key: MunicipalSort; direction: SortDirection };
  onSort: (key: MunicipalSort) => void;
  rowSpan?: number;
  testId?: string;
}) {
  const active = sort.key === sortKey;
  const ascending = active && sort.direction === "asc";
  return (
    <th
      scope="col"
      rowSpan={rowSpan}
      aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}
      data-testid={testId}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex w-full items-center justify-center gap-1 rounded-control font-bold text-ink hover:underline"
        data-testid="landfill-region-sort-header"
        data-sort-key={sortKey}
        data-active={active ? "true" : undefined}
      >
        {label}
        <span aria-hidden className={active ? "text-ink" : "text-ink-faint"}>
          {active ? (ascending ? "\u25B2" : "\u25BC") : "\u21C5"}
        </span>
        <span className="sr-only">
          {active
            ? `현재 ${ascending ? "오름차순" : "내림차순"} 정렬 기준입니다. 누르면 정렬 방향이 바뀝니다.`
            : "이 열을 기준으로 시·군·구를 정렬합니다."}
        </span>
      </button>
    </th>
  );
}
