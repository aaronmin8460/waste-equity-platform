"use client";

/**
 * 조건 선택 + 대상 범위 for the 수집·운반 계약 지급액 section.
 *
 * Three native `<select>`s — 지역 / 상태 / 정렬 — following the 매립지 현황 filter row
 * exactly: native controls (keyboard operation, type-ahead, and the platform picker
 * on touch come free), a `<label>` wrapping each control so the accessible name is
 * the visible text, and no state of its own. Every value and setter is owned by
 * `app/page.tsx`, which also owns the request lifecycle and the URL mirroring.
 *
 * All three map onto BACKEND parameters (`sido`, `status`, `sort`). Nothing is
 * filtered or re-sorted client-side: the server places nulls last on both value
 * sorts, and re-sorting the served array here would silently lose that rule and let
 * an unavailable municipality be ordered as if it were the cheapest.
 *
 * The summary beneath reports the SERVED scope counts. They come from
 * `meta.expected_count` / `available_count` / `partial_count` / `unavailable_count`,
 * which the backend computes over the selected metropolitan BEFORE the status
 * filter — so the denominators stay honest while a status filter is applied. They
 * are never hard-coded here.
 */

import type { MunicipalCostMeta, MunicipalCostSido, MunicipalCostSort } from "../../lib/api";
import type { MunicipalCostStatus } from "../../lib/api";
import {
  MUNICIPAL_COST_SIDO_OPTIONS,
  MUNICIPAL_COST_SORT_OPTIONS,
  MUNICIPAL_COST_STATUSES,
  statusLabel,
} from "../../lib/municipalCost";

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
  const selectClass =
    "mt-1 min-h-[2.25rem] w-full rounded-control border border-hairline-strong bg-surface px-2 py-1.5 text-sm text-ink";
  const labelClass = "text-xs font-medium text-ink-muted";
  return (
    <div className="wep-card" data-testid="municipal-cost-filters">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          자료 상태
          <select
            className={selectClass}
            data-testid="municipal-cost-status-select"
            value={status ?? ""}
            onChange={(event) =>
              setStatus(
                event.target.value === "" ? null : (event.target.value as MunicipalCostStatus),
              )
            }
          >
            {/* Korean labels throughout; the served enum is the option VALUE only,
                so it never becomes citizen-facing text. */}
            <option value="">전체</option>
            {MUNICIPAL_COST_STATUSES.map((value) => (
              <option key={value} value={value}>
                {statusLabel(value)}
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

      <MunicipalCostScopeSummary meta={meta} returnedCount={returnedCount} />
    </div>
  );
}

/**
 * 대상 범위 — the served scope counts, as a compact definition list.
 *
 * Every figure is read from `meta`; none is counted from the rendered rows and none
 * is hard-coded. Before a response arrives it says so rather than showing zeros —
 * a count of 0 would be a claim the platform has not yet earned.
 */
function MunicipalCostScopeSummary({
  meta,
  returnedCount,
}: {
  meta: MunicipalCostMeta | null;
  returnedCount: number | null;
}) {
  return (
    <div className="mt-3 border-t border-hairline pt-3" data-testid="municipal-cost-summary">
      <p className="text-xs font-medium text-ink-subtle">대상 범위</p>
      {meta === null ? (
        <p className="mt-1 text-xs text-ink-subtle" data-testid="municipal-cost-summary-pending">
          선택한 조건의 자료를 불러오는 중입니다.
        </p>
      ) : (
        <>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {[
              { term: "대상 지자체", value: meta.expected_count, testId: "expected" },
              { term: "계산 가능", value: meta.available_count, testId: "available" },
              { term: "일부 제한", value: meta.partial_count, testId: "partial" },
              { term: "자료 없음", value: meta.unavailable_count, testId: "unavailable" },
            ].map((item) => (
              <div key={item.term}>
                <dt className="inline text-ink-subtle">{item.term} </dt>
                <dd
                  className="inline font-medium tabular-nums text-ink"
                  data-testid={`municipal-cost-count-${item.testId}`}
                >
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-ink-subtle" data-testid="municipal-cost-returned">
            {/* The counts above describe the selected 지역 before the 자료 상태 filter;
                this line says how many rows the applied filters actually returned, so
                the two can differ without either being wrong. */}
            현재 표시 중인 지자체 {returnedCount ?? meta.returned_count}곳. 값이 없는 지자체도
            목록에서 빼지 않고 그대로 표시합니다.
          </p>
        </>
      )}
    </div>
  );
}
