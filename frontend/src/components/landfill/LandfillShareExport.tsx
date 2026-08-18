"use client";

/**
 * 공유 및 내보내기 — Figma 126:5568.
 *
 * Two downloads of the SAME dataset in two file formats: the existing multi-sheet
 * workbook, and a CSV built on the shared safe primitives in `lib/csv.ts` (formula
 * -injection guard, RFC 4180 escaping, UTF-8 BOM for Excel Korean, `null` → empty
 * cell and never `0`).
 *
 * Deliberately NOT a "download everything on this page" control. The municipal
 * collection/transport contract payment below is a different accounting basis, a
 * different publisher, and a different spatial unit, so it is never written into
 * either file (docs/YEOGIDA_UI_REDESIGN_SPEC.md §4). The scope sentence says so.
 *
 * ── 보고서 보기 → 이미지 저장 (기술요청 #23) ─────────────────────────────────
 * The frame's third action is 보고서 보기, and the 기술요청 spells out the flow:
 * `페이지 맨 하단 [보고서 보기] > [이미지 저장]`. That IS the content model this page
 * previously lacked — a preview panel whose one export is a PNG — and the platform
 * already has both halves: `lib/report.ts`'s generic `ReportModel` and its text-only
 * canvas renderer, and `components/ReportPreview.tsx`, both already used by two other
 * areas.
 *
 * So this is a REUSE, not a new export pipeline: no added dependency (no
 * html2canvas/dom-to-image), no second definition of what an exported figure means,
 * and the same absence rule (`—`, never 0). The model is `buildLandfillReport`, whose
 * scope note states in the image itself that the municipal contract payment is not in
 * it and that landfill inbound exists only at 시·도 grain.
 */

import { useState } from "react";

import type { LandfillSummary, LandfillTrends } from "../../lib/api";
import { downloadLandfillCsv, downloadLandfillWorkbook } from "../../lib/landfillExport";
import { landfillFilenameBase, periodLabel } from "../../lib/landfillExport";
import { buildLandfillReport } from "../../lib/report";
import ReportPreview from "../ReportPreview";
import SectionCard from "../ui/SectionCard";
import { PAGE2_CARD_CLASS } from "./shared";

export interface LandfillShareExportProps {
  summary: LandfillSummary;
  trends: LandfillTrends | null;
}

export default function LandfillShareExport({ summary, trends }: LandfillShareExportProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 기술요청 #23 — the preview panel the 이미지 저장 action lives in.
  const [reportOpen, setReportOpen] = useState(false);

  const failed = () => setError("파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");

  return (
    <SectionCard title="공유 및 내보내기" className={PAGE2_CARD_CLASS} testId="landfill-export">
      {/* Tightened, NOT dropped. This is the file's scope, stated where the file is
          produced, and the second clause is the 반입수수료 ⇄ 계약 지급액 separation —
          two different accounting bases that must never be read as one number. That
          guarantee stays on the primary surface deliberately. */}
      <p className="text-xs leading-relaxed text-ink-subtle" data-testid="landfill-export-scope">
        수도권매립지 공식 반입량·반입수수료를 출발 지역별·폐기물 종류별·월별로 내려받습니다. 회계
        기준이 다른 시·군·구 수집·운반 계약 지급액은 이 파일에 포함되지 않습니다.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="wep-btn-primary"
          data-testid="landfill-export-xlsx"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            downloadLandfillWorkbook(summary, trends)
              .catch(failed)
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "파일 만드는 중…" : "엑셀(.xlsx) 내려받기"}
        </button>
        <button
          type="button"
          className="wep-btn-quiet"
          data-testid="landfill-export-csv"
          disabled={busy}
          onClick={() => {
            setError(null);
            try {
              downloadLandfillCsv(summary, trends);
            } catch {
              failed();
            }
          }}
        >
          CSV 내려받기
        </button>
        {/* 기술요청 #23 — `[보고서 보기] > [이미지 저장]`. The panel it opens carries
            the 이미지 저장 action, so the two-step flow the request describes is the
            flow the reader gets. */}
        <button
          type="button"
          className="wep-btn-quiet"
          data-testid="landfill-export-report"
          onClick={() => {
            setError(null);
            setReportOpen(true);
          }}
        >
          보고서 보기
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-danger" role="alert" data-testid="landfill-export-error">
          {error}
        </p>
      )}
      {reportOpen && (
        <ReportPreview
          model={buildLandfillReport({
            periodLabel: periodLabel(summary),
            destinationName: summary.destination_name,
            accountingBasis: summary.accounting_basis,
            originFilter: summary.origin_filter,
            wasteFilter: summary.waste_filter,
            totalQuantityTons: summary.total_quantity_tons,
            totalInboundFeeKrw: summary.total_inbound_fee_krw,
            feePerCapitaKrw: summary.fee_per_capita.fee_per_capita_krw,
            derivationVersion: summary.derivation_version,
            origins: summary.origin_shares.map((origin) => ({
              name: origin.origin_name,
              quantityTons: origin.quantity_tons,
              share: origin.quantity_share,
              feeKrw: origin.inbound_fee_krw,
            })),
          })}
          filenameBase={landfillFilenameBase(summary)}
          onClose={() => setReportOpen(false)}
        />
      )}
    </SectionCard>
  );
}
