"use client";

/**
 * 지자체 비교 조건 — the three filters, the served scope, and the reference year.
 *
 * ── What changed in the demo pass, and what deliberately did not ────────────────
 * 지역 and 정렬 stay native `<select>`s: keyboard operation, type-ahead, and the
 * platform picker on touch come free, and neither benefits from being a chip row.
 * 자료 상태 became a chip group because it is the control the comparison turns on —
 * the released default scopes the view to 계산 가능, so the reader has to be able to
 * see, in one glance and without opening a menu, how many municipalities each scope
 * holds and that widening it is one click away. A `<select>` hides exactly that.
 *
 * The chips are `<button aria-pressed>` inside a `role="group"` named by a VISIBLE
 * label, following `components/ui/SegmentedControl.tsx` and reusing its
 * `.wep-segment` track. Deliberately not a `<fieldset>` of radios:
 * `e2e/accessibility.spec.ts` asserts the page has exactly three fieldsets (the
 * equity metric groups). Selection is carried by `aria-pressed`, a raised white pill,
 * and a heavier weight — never by colour alone.
 *
 * ── Ownership ──────────────────────────────────────────────────────────────────
 * The panel holds NO state. Every value and setter is owned by `app/page.tsx`, which
 * also owns the request lifecycle and the URL mirroring, exactly as it does for the
 * four official landfill filters.
 *
 * All three map onto BACKEND parameters (`sido`, `status`, `sort`). Nothing is
 * filtered or re-sorted client-side: the server places nulls last on both value
 * sorts, and re-sorting the served array here would silently lose that rule and let
 * an unavailable municipality be ordered as if it were the cheapest.
 *
 * ── Counts ─────────────────────────────────────────────────────────────────────
 * Every figure comes from `meta.expected_count` / `available_count` /
 * `partial_count` / `unavailable_count`, which the backend computes over the selected
 * metropolitan BEFORE the status filter — so the denominators stay honest while a
 * status filter is applied, and defaulting the view to 계산 가능 conceals nothing.
 * None of them is hard-coded, and none is counted from the rendered rows. Before a
 * response arrives the chips carry no number at all rather than a 0.
 */

import { useId } from "react";

import type { MunicipalCostMeta, MunicipalCostSido, MunicipalCostSort } from "../../lib/api";
import type { MunicipalCostStatus } from "../../lib/api";
import {
  MUNICIPAL_COST_SIDO_OPTIONS,
  MUNICIPAL_COST_SORT_OPTIONS,
  MUNICIPAL_COST_STATUS_CHOICES,
  statusChoiceCount,
  statusChoiceLabel,
} from "../../lib/municipalCost";
import SectionCard from "../ui/SectionCard";
import {
  MUNICIPAL_COST_FILTER_DESCRIPTION,
  MUNICIPAL_COST_FILTER_TITLE,
  MUNICIPAL_COST_YEAR_CHIP_SUFFIX,
  MUNICIPAL_COST_YEAR_NOTE,
} from "./municipalCostShared";

export interface MunicipalCostFiltersProps {
  sido: MunicipalCostSido | null;
  setSido: (value: MunicipalCostSido | null) => void;
  status: MunicipalCostStatus | null;
  setStatus: (value: MunicipalCostStatus | null) => void;
  sort: MunicipalCostSort;
  setSort: (value: MunicipalCostSort) => void;
  /** Served metadata. `null` while the first request is in flight. */
  meta: MunicipalCostMeta | null;
  /** Rows currently returned for the applied filters. `null` before a response. */
  returnedCount: number | null;
}

const selectClass =
  "mt-1 min-h-[2.25rem] w-full rounded-control border border-hairline-strong bg-surface px-2 py-1.5 text-sm text-ink";
const labelClass = "text-xs font-medium text-ink-muted";

export default function MunicipalCostFilters({
  sido,
  setSido,
  status,
  setStatus,
  sort,
  setSort,
  meta,
  returnedCount,
}: MunicipalCostFiltersProps) {
  return (
    <SectionCard
      title={MUNICIPAL_COST_FILTER_TITLE}
      headingLevel={3}
      description={MUNICIPAL_COST_FILTER_DESCRIPTION}
      // The reference year sits in the card header, beside the controls it qualifies,
      // rather than only in the section title far above the filter row.
      headerAside={<ReferenceYearChip meta={meta} />}
      testId="municipal-cost-filters"
    >
      <MunicipalCostStatusFilter status={status} setStatus={setStatus} meta={meta} />

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          지역
          <select
            className={selectClass}
            data-testid="municipal-cost-sido-select"
            value={sido ?? ""}
            onChange={(event) =>
              setSido(event.target.value === "" ? null : (event.target.value as MunicipalCostSido))
            }
          >
            <option value="">전체</option>
            {MUNICIPAL_COST_SIDO_OPTIONS.map((option) => (
              // The tier travels with the metropolitan: 서울 자치구 / 인천 군·구 /
              // 경기 시·군 are three different kinds of 기초자치단체, and the served
              // geography policy names them exactly this way.
              <option key={option.code} value={option.code}>
                {`${option.label} ${option.unit}`}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          정렬
          <select
            className={selectClass}
            data-testid="municipal-cost-sort-select"
            value={sort}
            onChange={(event) => setSort(event.target.value as MunicipalCostSort)}
          >
            {MUNICIPAL_COST_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <MunicipalCostScopeSummary
        meta={meta}
        returnedCount={returnedCount}
        sido={sido}
        status={status}
        sort={sort}
      />
    </SectionCard>
  );
}

/**
 * The served reference year, as a chip.
 *
 * Rendered only once a response has arrived, and always from `meta.reference_year` —
 * the section title states the year this release publishes, but the chip must be the
 * year the server actually answered with, so a backend that moved on cannot be
 * contradicted by a constant in the frontend.
 */
function ReferenceYearChip({ meta }: { meta: MunicipalCostMeta | null }) {
  if (meta === null) return null;
  return (
    <span className="wep-chip" data-testid="municipal-cost-reference-year">
      {meta.reference_year}
      {MUNICIPAL_COST_YEAR_CHIP_SUFFIX}
    </span>
  );
}

/** 자료 상태 — the scope chips, each carrying its served count. */
function MunicipalCostStatusFilter({
  status,
  setStatus,
  meta,
}: {
  status: MunicipalCostStatus | null;
  setStatus: (value: MunicipalCostStatus | null) => void;
  meta: MunicipalCostMeta | null;
}) {
  const labelId = useId();
  return (
    <div>
      <p id={labelId} className={labelClass}>
        자료 상태
      </p>
      <div
        className="wep-segment-track mt-1"
        role="group"
        aria-labelledby={labelId}
        data-testid="municipal-cost-status-group"
      >
        {MUNICIPAL_COST_STATUS_CHOICES.map((choice) => {
          const count = statusChoiceCount(meta, choice);
          const key = choice ?? "ALL";
          return (
            <button
              key={key}
              type="button"
              className="wep-segment"
              aria-pressed={status === choice}
              onClick={() => setStatus(choice)}
              data-testid={`municipal-cost-status-${key}`}
            >
              {statusChoiceLabel(choice)}
              {/* No count before a response: a 0 here would be a claim about the
                  scope that the platform has not yet earned. */}
              {count !== null && (
                <span
                  className="ml-1.5 tabular-nums text-ink-subtle"
                  data-testid={`municipal-cost-count-${countTestId(choice)}`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 전체 reports the full published scope, which the summary calls `expected`. */
function countTestId(choice: MunicipalCostStatus | null): string {
  if (choice === null) return "expected";
  return choice.toLowerCase();
}

/**
 * 현재 선택 조건 — the applied selection restated as text, then what it returned.
 *
 * It reports STATE and served counts, never a result the backend did not send.
 * Before a response arrives it says so rather than showing zeros.
 */
function MunicipalCostScopeSummary({
  meta,
  returnedCount,
  sido,
  status,
  sort,
}: {
  meta: MunicipalCostMeta | null;
  returnedCount: number | null;
  sido: MunicipalCostSido | null;
  status: MunicipalCostStatus | null;
  sort: MunicipalCostSort;
}) {
  const sidoOption = MUNICIPAL_COST_SIDO_OPTIONS.find((option) => option.code === sido);
  const items: { term: string; value: string }[] = [
    { term: "지역", value: sidoOption ? `${sidoOption.label} ${sidoOption.unit}` : "전체" },
    { term: "자료 상태", value: statusChoiceLabel(status) },
    {
      term: "정렬",
      value:
        MUNICIPAL_COST_SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "기본 정렬",
    },
  ];
  const totalScope = statusChoiceCount(meta, null);
  return (
    <div className="mt-3 border-t border-hairline pt-3" data-testid="municipal-cost-summary">
      <p className="text-xs font-medium text-ink-subtle">현재 선택 조건</p>
      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {items.map((item) => (
          <div key={item.term}>
            <dt className="inline text-ink-subtle">{item.term} </dt>
            <dd className="inline font-medium text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>

      {/* The reference year, said in words next to the selection it does NOT follow. */}
      <p className="mt-2 text-xs text-ink-subtle" data-testid="municipal-cost-year-note">
        {MUNICIPAL_COST_YEAR_NOTE}
      </p>

      {meta === null ? (
        <p className="mt-2 text-xs text-ink-subtle" data-testid="municipal-cost-summary-pending">
          선택한 조건의 자료를 불러오는 중입니다.
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-ink-subtle" data-testid="municipal-cost-returned">
            {/* The chip counts describe the selected 지역 before the 자료 상태 filter;
                this line says how many rows the applied filters actually returned, so
                the two can differ without either being wrong.

                The "값이 없는 지자체도 목록에서 빼지 않습니다" clause that used to close
                this line is NOT gone from the screen — it is the first of
                MUNICIPAL_COST_TABLE_FOOTNOTES, rendered visibly under the table it
                describes, together with the "지급액이 0이라는 뜻이 아닙니다" half this
                line never carried. Saying it here as well was the same rule printed
                twice inside one section. */}
            현재 표시 중인 지자체 {returnedCount ?? meta.returned_count}곳.
          </p>
          {/* Said out loud whenever a scope is applied — including the released
              default — so a narrowed comparison never reads as the whole picture. */}
          {status !== null && (
            <p className="mt-1 text-xs text-ink-subtle" data-testid="municipal-cost-scope-note">
              지금은 ‘{statusChoiceLabel(status)}’ 지자체만 표시합니다. ‘전체’를 누르면 대상{" "}
              {totalScope}곳을 모두 볼 수 있습니다.
            </p>
          )}
        </>
      )}
    </div>
  );
}
