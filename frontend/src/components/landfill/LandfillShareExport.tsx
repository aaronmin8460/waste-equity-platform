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
 * ── 보고서 보기 is intentionally absent ────────────────────────────────────────
 * The Figma row carries a third action, 보고서 보기. There is no defined Page-2 report
 * artifact, route, or content model — no template, no scope, no statement of which
 * values it would assert — so implementing one would mean inventing an official-looking
 * document. It is left unimplemented and recorded as BLOCKED BY PRODUCT DEFINITION
 * rather than shipped as a button that produces something nobody specified.
 */

import { useState } from "react";

import type { LandfillSummary, LandfillTrends } from "../../lib/api";
import { downloadLandfillCsv, downloadLandfillWorkbook } from "../../lib/landfillExport";
import SectionCard from "../ui/SectionCard";

export interface LandfillShareExportProps {
  summary: LandfillSummary;
  trends: LandfillTrends | null;
}

export default function LandfillShareExport({ summary, trends }: LandfillShareExportProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const failed = () => setError("파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");

  return (
    <SectionCard title="공유 및 내보내기" testId="landfill-export">
      <p className="text-xs leading-relaxed text-ink-subtle" data-testid="landfill-export-scope">
        수도권매립지 공식 반입량과 반입수수료를 출발 지역별·폐기물 종류별·월별로 내려받습니다. 아래
        시·군·구 수집·운반 계약 지급액은 회계 기준이 다른 별도 자료이므로 이 파일에 포함되지 않습니다.
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
      </div>
      {error && (
        <p className="mt-2 text-xs text-danger" role="alert" data-testid="landfill-export-error">
          {error}
        </p>
      )}
    </SectionCard>
  );
}
