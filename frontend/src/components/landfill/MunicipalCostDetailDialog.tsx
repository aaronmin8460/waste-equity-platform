"use client";

/**
 * 시·군·구별 수집/운반 지급액 상세보기 — Figma `327:428`.
 *
 * The 66-row municipal comparison as a MODAL, which is what 기술요청 #8 and #16 ask
 * for ("[폐기물 관리비용]은 하단에 '상세보기' 버튼 있고, 팝업 내용은 아래에 제작해놓음").
 * It replaces an inline ~916px `<details>` that sat below a table already carrying the
 * same dataset as a column group, so the reader met the municipal figures twice and
 * met the second copy as a wall of rows.
 *
 * ── What the frame specifies, and is reproduced here ──────────────────────────
 * The frame is authored at ~1.133× scale; the values below are the unscaled ones.
 *
 *   header 98px      title 32/700 + close ✕
 *   scope strip      `{시·도} · {연도}` 16/700, then the basis line 14/400
 *   pill toggle      [주민 1인당 지급액] [총 지급액] — the METRIC, not the sort
 *   info + controls  `ⓘ 주민등록 인구 기준 · 단위: 원/인`, then 정렬 기준 (높은 순/낮은
 *                    순) and an export action, right-aligned
 *   body             TWO 525-wide columns of rank rows, each headed
 *                    `순위 / 시·군·구 / 주민 1인당 지급액(원/인)`
 *   rank row 45px    dot · rank · name · proportional bar · value
 *   footer           a primary button
 *
 * The two columns are a PRESENTATION split of one ordered list — the list is ranked
 * once and then halved, so reading down the left column and continuing down the right
 * preserves rank order. They are not two groups and not two rankings.
 *
 * ── Absence rules, unchanged from every other municipal surface ───────────────
 * A municipality with no disclosed amount keeps its place in the list, renders — and
 * its served reason, and is never ordered as if its value were 0 (which would rank it
 * as the cheapest in the capital region). Its bar is simply absent rather than
 * zero-length, so the absence never reads as a measurement.
 *
 * Accessibility is the shared `ui/Dialog` primitive's: focus moves in on open, is
 * trapped while open, is restored to the trigger on close, Escape closes, and the page
 * behind is `inert`. This file adds NO focus handling of its own and does not modify
 * the primitive.
 */

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { MunicipalCostResponse, MunicipalCostRow } from "../../lib/api";
import {
  formatPayment,
  formatPaymentPerCapita,
  primaryLimitation,
  statusLabel,
} from "../../lib/municipalCost";
import Dialog from "../ui/Dialog";

/** Which served amount the rows rank on. Both are served fields; neither is derived. */
type CostMetric = "perCapita" | "total";

const METRIC_LABELS: Record<CostMetric, string> = {
  perCapita: "주민 1인당 지급액",
  total: "총 지급액",
};

/** The unit line under the pill toggle. Names the DENOMINATOR, not only the unit. */
const METRIC_NOTES: Record<CostMetric, string> = {
  perCapita: "ⓘ 주민등록 인구 기준 · 단위: 원/인",
  total: "ⓘ 공개된 계약 지급액 합계 · 단위: 원",
};

const COLUMN_VALUE_HEADERS: Record<CostMetric, string> = {
  perCapita: "주민 1인당 지급액(원/인)",
  total: "총 지급액",
};

type SortDirection = "desc" | "asc";

const SORT_LABELS: Record<SortDirection, string> = {
  desc: "높은 순",
  asc: "낮은 순",
};

export interface MunicipalCostDetailDialogProps {
  open: boolean;
  onClose: () => void;
  /** The UNFILTERED served response, so the modal describes the published scope. */
  data: MunicipalCostResponse | null;
  /**
   * A municipality to bring to the reader's attention — set when the modal was opened
   * from a region name in 지역별 상세 현황 (기술요청 #21). It is HIGHLIGHTED in place,
   * never filtered to: narrowing the list to one row would destroy the ranking the
   * reader opened the modal to see.
   */
  focusRegionCode?: string | null;
  /**
   * The full filterable comparison table, rendered BELOW the ranking.
   *
   * The ranking answers "who pays most per resident"; the table carries each row's
   * status, its served reason codes and its population method. Moving this dataset
   * into a modal must not cost it that detail, so the table travels with it rather
   * than being replaced by the ranking.
   */
  children?: ReactNode;
}

/** The served amount for one row under the active metric, or null. */
function metricValue(row: MunicipalCostRow, metric: CostMetric): string | null {
  return metric === "perCapita" ? row.payment_per_capita_krw : row.total_eligible_payment_krw;
}

function formatMetric(row: MunicipalCostRow, metric: CostMetric): string | null {
  return metric === "perCapita"
    ? formatPaymentPerCapita(row.payment_per_capita_krw)
    : formatPayment(row.total_eligible_payment_krw);
}

export default function MunicipalCostDetailDialog({
  open,
  onClose,
  data,
  focusRegionCode = null,
  children,
}: MunicipalCostDetailDialogProps) {
  const [metric, setMetric] = useState<CostMetric>("perCapita");
  const [direction, setDirection] = useState<SortDirection>("desc");

  const rows = useMemo(() => data?.municipalities ?? [], [data]);

  /**
   * The ranked list.
   *
   * Rows WITH an amount are ranked; rows without keep their place at the end in name
   * order and carry no rank number at all. Giving an absent value a rank would assert
   * a position in a comparison it is not part of.
   */
  const ranked = useMemo(() => {
    const withValue: MunicipalCostRow[] = [];
    const withoutValue: MunicipalCostRow[] = [];
    for (const row of rows) {
      (metricValue(row, metric) != null ? withValue : withoutValue).push(row);
    }
    withValue.sort((a, b) => {
      const left = Number(metricValue(a, metric));
      const right = Number(metricValue(b, metric));
      if (!Number.isFinite(left) && !Number.isFinite(right)) return 0;
      if (!Number.isFinite(left)) return 1;
      if (!Number.isFinite(right)) return -1;
      return direction === "desc" ? right - left : left - right;
    });
    withoutValue.sort((a, b) => a.display_name.localeCompare(b.display_name, "ko"));
    return [
      ...withValue.map((row, index) => ({ row, rank: index + 1 })),
      ...withoutValue.map((row) => ({ row, rank: null as number | null })),
    ];
  }, [rows, metric, direction]);

  /** Bar scale — the largest value on screen. Positional only; never a printed figure. */
  const max = useMemo(() => {
    const values = ranked
      .map(({ row }) => Number(metricValue(row, metric)))
      .filter((value) => Number.isFinite(value) && value > 0);
    return values.length > 0 ? Math.max(...values) : 0;
  }, [ranked, metric]);

  // A presentation split of ONE ordered list: left column first, right column
  // continues it, so reading order still follows rank.
  const half = Math.ceil(ranked.length / 2);
  const columns = [ranked.slice(0, half), ranked.slice(half)];

  const referenceYear = data?.meta.reference_year ?? null;
  /**
   * What the list actually covers, read off the ROWS rather than asserted.
   *
   * The frame's strip reads 서울특별시 · 2024년, but this modal is handed the
   * UNFILTERED response, so naming one 시·도 would be false. It names the single
   * metropolitan when the rows really do belong to one, and 수도권 전체 otherwise —
   * the label follows the data instead of the mock.
   */
  const scopeLabel = useMemo(() => {
    const names = new Set(rows.map((row) => row.metropolitan_name));
    return names.size === 1 ? [...names][0] : "수도권 전체";
  }, [rows]);

  return (
    <Dialog
      open={open}
      title="시·군·구별 수집/운반 지급액 상세보기"
      onClose={onClose}
      testId="municipal-cost-detail-modal"
    >
      <div className="px-5 py-4">
        {/* Scope strip — 서울특별시 · 2024년 + what the amount actually is. */}
        <div data-testid="municipal-cost-detail-scope">
          <p className="text-base font-bold text-ink">
            {scopeLabel}
            {referenceYear != null && ` · ${referenceYear}년`}
          </p>
          <p className="mt-0.5 text-sm text-ink-subtle">
            생활계 폐기물 수집·운반 용역 계약에 대한 지급액 기준
          </p>
        </div>

        {/* The metric toggle the frame draws as a Pill Toggle pair. Both options are
            SERVED fields — switching does not derive anything. */}
        <div
          className="mt-3 flex flex-wrap gap-2"
          role="group"
          aria-label="표시할 지급액 기준"
          data-testid="municipal-cost-detail-metric"
        >
          {(Object.keys(METRIC_LABELS) as CostMetric[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setMetric(key)}
              aria-pressed={metric === key}
              className={
                metric === key
                  ? "rounded-full bg-brand px-4 py-2 text-sm font-bold text-white"
                  : "rounded-full border border-hairline-strong px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink"
              }
              data-testid={`municipal-cost-detail-metric-${key}`}
            >
              {METRIC_LABELS[key]}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-subtle" data-testid="municipal-cost-detail-unit">
            {METRIC_NOTES[metric]}
          </p>
          <label className="flex items-center gap-2 text-xs text-ink-subtle">
            정렬 기준
            <select
              className="min-h-[2.25rem] rounded-control border border-hairline-strong bg-surface px-2 py-1.5 text-sm font-bold text-ink"
              value={direction}
              onChange={(event) => setDirection(event.target.value as SortDirection)}
              data-testid="municipal-cost-detail-sort"
            >
              {(Object.keys(SORT_LABELS) as SortDirection[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 border-t border-hairline pt-3">
          {ranked.length === 0 ? (
            <p className="text-sm text-ink-subtle" data-testid="municipal-cost-detail-empty">
              표시할 시·군·구 자료가 없습니다.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-x-8 gap-y-0 lg:grid-cols-2">
              {columns.map((column, columnIndex) => (
                <table
                  key={columnIndex}
                  className="w-full text-left text-sm"
                  data-testid="municipal-cost-detail-column"
                >
                  <caption className="sr-only">
                    {METRIC_LABELS[metric]} {SORT_LABELS[direction]} — {columnIndex + 1}번째 단
                  </caption>
                  <thead>
                    <tr className="border-b border-hairline text-xs text-ink-subtle">
                      <th scope="col" className="w-10 py-2 pr-2 font-bold">
                        순위
                      </th>
                      <th scope="col" className="py-2 pr-3 font-bold">
                        시·군·구
                      </th>
                      <th scope="col" className="py-2 text-right font-bold">
                        {COLUMN_VALUE_HEADERS[metric]}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {column.map(({ row, rank }) => {
                      const value = metricValue(row, metric);
                      const numeric = Number(value);
                      const ratio =
                        value != null && Number.isFinite(numeric) && max > 0
                          ? Math.max(0, Math.min(1, numeric / max))
                          : null;
                      const highlighted =
                        focusRegionCode != null && row.direct_region_code === focusRegionCode;
                      return (
                        <tr
                          key={row.municipality_key}
                          className={
                            highlighted
                              ? "border-b border-hairline bg-surface-muted last:border-0"
                              : "border-b border-hairline last:border-0"
                          }
                          data-testid="municipal-cost-detail-row"
                          data-municipality={row.municipality_key}
                          data-highlighted={highlighted ? "true" : undefined}
                        >
                          <td className="py-2 pr-2 align-middle text-xs tabular-nums text-ink-subtle">
                            {/* No rank for a row with no amount — see `ranked`. */}
                            {rank !== null ? `${rank}.` : "—"}
                          </td>
                          <th
                            scope="row"
                            className="py-2 pr-3 text-left align-middle font-bold text-ink"
                          >
                            {row.display_name}
                            {highlighted && <span className="sr-only"> (선택한 지역)</span>}
                            {value == null && (
                              // Never ₩0: the served status is the citizen-facing
                              // text and the backend's own reason sits beneath it.
                              <span className="block text-[11px] font-normal text-ink-subtle">
                                {statusLabel(row.status)}
                                {primaryLimitation(row) && ` · ${primaryLimitation(row)}`}
                              </span>
                            )}
                          </th>
                          <td className="py-2 align-middle">
                            <span className="flex items-center justify-end gap-2">
                              {/* Positional only, and ABSENT rather than zero-length
                                  when there is no value — a 0px bar would read as a
                                  measured zero. */}
                              {ratio !== null && (
                                <span
                                  aria-hidden
                                  className="hidden h-2 w-24 flex-none overflow-hidden rounded-full bg-surface-muted sm:block"
                                >
                                  <span
                                    className="block h-full rounded-full bg-brand"
                                    style={{ width: `${ratio * 100}%` }}
                                  />
                                </span>
                              )}
                              <span className="tabular-nums text-ink-muted">
                                {formatMetric(row, metric) ?? (
                                  <span className="text-ink-subtle">—</span>
                                )}
                              </span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ))}
            </div>
          )}
        </div>

        {children && (
          <details className="mt-4 border-t border-hairline pt-3" data-testid="municipal-cost-detail-table">
            <summary className="cursor-pointer list-none text-sm font-semibold text-ink marker:content-none">
              자료 상태와 산출 근거가 있는 전체 표 보기
            </summary>
            <div className="pt-3">{children}</div>
          </details>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
          <p className="text-xs text-ink-subtle" data-testid="municipal-cost-detail-footer">
            총 {ranked.length}곳 · 금액이 공개된 곳 {ranked.filter(({ rank }) => rank !== null).length}곳
            {/* The coverage is stated rather than implied: a list of 66 rows of which
                20 have no amount is not a complete comparison, and saying so here is
                what stops the ranking being read as one. */}
          </p>
          <button
            type="button"
            className="wep-btn-primary"
            data-testid="municipal-cost-detail-dismiss"
            onClick={onClose}
          >
            닫기
          </button>
        </div>
      </div>
    </Dialog>
  );
}
