"use client";

/**
 * 수도권매립지 반입 폐기물 구성 — Figma 125:5258, with the full-view modal 132:353.
 *
 * ── The taxonomy is the source's, not the design's ────────────────────────────
 * The Figma donut is mocked with four plain-language buckets (생활계 / 사업장 / 건설 /
 * 기타). Those are NOT this dataset's categories, and no approved crosswalk from the
 * official `waste_name` values onto them exists. Remapping them here would make the
 * chart disagree with the source it cites and with the workbook it exports, so the
 * SERVED names are printed verbatim and the rename is left as a product follow-up.
 * (The Figma MODAL, by contrast, already uses the real names — 생활폐기물, 하수 찌꺼기,
 * 음식물 폐수 … — which is what the whole surface follows.)
 *
 * ── 그 외 항목 합계 ───────────────────────────────────────────────────────────
 * The backend serves the largest categories plus the period's exact total, so the
 * residual is `total − Σ(named)` — a subtraction of two official quantities at one
 * scope, not a re-aggregation. It is emitted only when strictly positive and is
 * always badged 계산값, because it is a bucket this platform formed, not a category
 * any publisher reported. See `compositionRows` in lib/landfill.ts.
 *
 * The donut is a redundant encoding: every slice's exact value and share are printed
 * beside it, and the full list — with the same numbers — is one button away and also
 * exportable. No value is readable only by colour.
 */

import { useMemo, useState } from "react";

import type { LandfillSummary } from "../../lib/api";
import type { CompositionRow } from "../../lib/landfill";
import { compositionRows, formatShare, formatTonQuantity, formatTons } from "../../lib/landfill";
import { downloadCompositionCsv } from "../../lib/landfillExport";
import DataStatusBadge from "../ui/DataStatusBadge";
import Dialog from "../ui/Dialog";
import SectionCard from "../ui/SectionCard";

/**
 * Slice colours. Qualitative and colour-blind-distinguishable, and never the only
 * signal: every slice carries its name, exact tonnage, and share as text. The
 * roll-up always takes the last (neutral) swatch so a derived bucket never wears a
 * category colour.
 */
const SLICE_COLORS = ["#1b4f8f", "#2f8fbe", "#4bab8a", "#c98f2e", "#8e6bb0", "#6b7280"];
const ROLLUP_COLOR = "#9aa2ad";

function sliceColor(row: CompositionRow, index: number): string {
  return row.derived ? ROLLUP_COLOR : SLICE_COLORS[index % SLICE_COLORS.length];
}

export interface LandfillCompositionSectionProps {
  summary: LandfillSummary;
  periodLabel: string;
}

export default function LandfillCompositionSection({
  summary,
  periodLabel,
}: LandfillCompositionSectionProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const rows = useMemo(
    () => compositionRows(summary.top_waste_types, summary.total_quantity_tons),
    [summary.top_waste_types, summary.total_quantity_tons],
  );
  // The card shows the largest few; the modal shows all of them. Both read the SAME
  // ordered list, so the card can never disagree with its own "전체보기".
  const cardRows = rows.slice(0, 4);

  return (
    <SectionCard
      title="수도권매립지 반입 폐기물 구성"
      description={`기준 기간 ${periodLabel} · 비중은 공식 보고값으로 계산했습니다. 순위나 평가가 아닙니다.`}
      headerAside={<DataStatusBadge status="reported" />}
      testId="landfill-composition"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-3">
        <span className="text-sm font-bold text-ink">총 반입량</span>
        <span className="text-sm font-bold tabular-nums text-ink">
          {formatTons(summary.total_quantity_kg)} (100%)
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="pt-3 text-xs text-ink-subtle" data-testid="landfill-composition-empty">
          해당 조건의 자료가 없습니다.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-center">
            <CompositionDonut rows={rows} total={formatTons(summary.total_quantity_kg)} />
            <ul className="min-w-0 flex-1 space-y-2" data-testid="landfill-composition-legend">
              {cardRows.map((row, index) => (
                <li
                  key={row.name}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-ink-muted">
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 flex-none rounded-full"
                      style={{ backgroundColor: sliceColor(row, index) }}
                    />
                    <span className="truncate">{row.name}</span>
                    {row.derived && <DataStatusBadge status="derived" />}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-ink-muted">
                    {formatTonQuantity(row.quantityTons)}{" "}
                    <span className="font-bold text-ink">{formatShare(row.share)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            className="wep-btn-quiet mt-3 w-full"
            data-testid="landfill-composition-open"
            onClick={() => setModalOpen(true)}
          >
            폐기물 구성 전체보기 ({rows.length}개 항목)
          </button>
        </>
      )}

      <CompositionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        rows={rows}
        summary={summary}
        periodLabel={periodLabel}
        onExport={() => {
          setExportError(null);
          try {
            downloadCompositionCsv(summary, rows);
          } catch {
            setExportError("파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
          }
        }}
        exportError={exportError}
      />
    </SectionCard>
  );
}

const DONUT = { size: 150, stroke: 22 };

/**
 * The donut. Purely a redundant encoding of the legend beside it — it carries no
 * number the list does not, and it is `aria-hidden` for exactly that reason: a screen
 * reader reads the list, not a re-narrated version of the same figures.
 *
 * A row whose share was not served draws no arc at all rather than a zero-width one,
 * which would read as an official zero.
 */
function CompositionDonut({ rows, total }: { rows: CompositionRow[]; total: string }) {
  const radius = (DONUT.size - DONUT.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Arc geometry resolved BEFORE the render pass, so nothing accumulates while JSX
  // is being produced. A row whose share was not served contributes no arc and no
  // rotation, rather than a zero-width one that would read as an official zero.
  const arcs: { name: string; color: string; length: number; rotation: number }[] = [];
  let offset = 0;
  rows.forEach((row, index) => {
    const share = row.share === null ? null : Number(row.share);
    if (share === null || !Number.isFinite(share) || share <= 0) return;
    const length = share * circumference;
    arcs.push({
      name: row.name,
      color: sliceColor(row, index),
      length,
      rotation: (offset / circumference) * 360 - 90,
    });
    offset += length;
  });
  return (
    <div className="relative flex-none" data-testid="landfill-composition-donut">
      <svg width={DONUT.size} height={DONUT.size} viewBox={`0 0 ${DONUT.size} ${DONUT.size}`} aria-hidden>
        <circle
          cx={DONUT.size / 2}
          cy={DONUT.size / 2}
          r={radius}
          fill="none"
          stroke="#eef0f4"
          strokeWidth={DONUT.stroke}
        />
        {arcs.map((arc) => (
          <circle
            key={arc.name}
            cx={DONUT.size / 2}
            cy={DONUT.size / 2}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={DONUT.stroke}
            strokeDasharray={`${arc.length} ${circumference - arc.length}`}
            transform={`rotate(${arc.rotation} ${DONUT.size / 2} ${DONUT.size / 2})`}
          />
        ))}
      </svg>
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums text-ink"
      >
        {total}
      </span>
    </div>
  );
}

/**
 * 폐기물 구성 전체보기 — every category at the current filter scope, descending, with
 * the exact served tonnage and share, plus a CSV of exactly what is on screen.
 *
 * It is a <table>, not a styled list: this is tabular data with a header, and a
 * screen-reader user navigating it by column is the point.
 */
function CompositionModal({
  open,
  onClose,
  rows,
  summary,
  periodLabel,
  onExport,
  exportError,
}: {
  open: boolean;
  onClose: () => void;
  rows: CompositionRow[];
  summary: LandfillSummary;
  periodLabel: string;
  onExport: () => void;
  exportError: string | null;
}) {
  const sharesKnown = rows.every((row) => row.share !== null);
  return (
    <Dialog
      open={open}
      title="폐기물 구성 전체보기"
      description={`수도권매립지 반입 · 단위 t · 비중 높은 순 · ${periodLabel} 기준 · 출발 지역 ${summary.origin_filter ?? "전체"}`}
      onClose={onClose}
      testId="landfill-composition-modal"
    >
      {/* `.wep-dialog-body` already scrolls and carries NO padding of its own, so the
          content owns its inset — without it the table's last column sits flush
          against the panel edge and reads as clipped. A second scroll container here
          would nest two scrollbars for the same list. */}
      <div className="px-5 py-4">
        <table className="w-full text-left text-sm" data-testid="landfill-composition-modal-table">
          <caption className="sr-only">
            {periodLabel} 수도권매립지 반입 폐기물 구성 — 항목별 반입량과 비중
          </caption>
          <thead>
            <tr className="border-b border-hairline text-xs text-ink-subtle">
              <th scope="col" className="py-2 pr-3 font-medium">
                폐기물 종류
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                비중
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                반입량
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.name}
                className="border-b border-hairline last:border-0"
                data-testid="landfill-composition-modal-row"
              >
                <th scope="row" className="py-2 pr-3 text-left font-normal text-ink-muted">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 flex-none rounded-full"
                      style={{ backgroundColor: sliceColor(row, index) }}
                    />
                    <span className="truncate">{row.name}</span>
                    {row.derived && <DataStatusBadge status="derived" />}
                  </span>
                </th>
                <td className="py-2 pr-3 text-right font-bold tabular-nums text-ink">
                  {formatShare(row.share)}
                </td>
                <td className="py-2 text-right tabular-nums text-ink-muted">
                  {formatTonQuantity(row.quantityTons)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
          <p className="text-xs text-ink-subtle" data-testid="landfill-composition-modal-footer">
            총 {rows.length}개 항목
            {/* The 100% claim is made only when every share was actually served. */}
            {sharesKnown && " · 비중 합계 100%"}
            {rows.some((row) => row.derived) &&
              " · '그 외 항목 합계'는 총 반입량에서 위 항목을 뺀 계산값입니다."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="wep-btn-quiet"
              data-testid="landfill-composition-modal-csv"
              onClick={onExport}
            >
              구성 CSV 내보내기
            </button>
            <button
              type="button"
              className="wep-btn-primary"
              data-testid="landfill-composition-modal-dismiss"
              onClick={onClose}
            >
              닫기
            </button>
          </div>
        </div>
        {exportError && (
          <p className="mt-2 text-xs text-danger" role="alert">
            {exportError}
          </p>
        )}
      </div>
    </Dialog>
  );
}
