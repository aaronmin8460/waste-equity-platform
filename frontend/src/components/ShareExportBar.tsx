"use client";

/**
 * Share & export bar for the 지역 부담 view.
 *
 * - 링크 복사: copies a validated, versioned share URL (encoded upstream) to the
 *   clipboard with accessible success/failure feedback (role="status"/"alert").
 * - CSV 내려받기: regional rankings and (when regions are selected) the region
 *   comparison, as injection-safe CSV.
 * - 보고서 보기: opens the print/PNG report preview.
 *
 * Also renders a brief, accessible notice when a restored shared link had invalid
 * fields that were safely ignored.
 */

import { useState } from "react";

interface ShareExportBarProps {
  getShareUrl: () => string;
  onDownloadRankingCsv: () => void;
  onDownloadComparisonCsv?: () => void;
  onOpenReport: () => void;
  urlWarnings?: string[];
}

export default function ShareExportBar({
  getShareUrl,
  onDownloadRankingCsv,
  onDownloadComparisonCsv,
  onOpenReport,
  urlWarnings,
}: ShareExportBarProps) {
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");

  async function copyLink() {
    const url = getShareUrl();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for environments without the async clipboard API.
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (!ok) throw new Error("copy failed");
      }
      setCopyState("ok");
    } catch {
      setCopyState("fail");
    }
    setTimeout(() => setCopyState("idle"), 4000);
  }

  return (
    <section aria-label="공유 및 내보내기" data-testid="share-export" className="text-xs">
      <h2 className="mb-1 text-sm font-semibold text-slate-800">공유 · 내보내기</h2>

      {/* Always-present live region so a restored-link warning is announced even
          when it is injected after mount. */}
      <div role="status" aria-live="polite">
        {urlWarnings && urlWarnings.length > 0 && (
          <div
            className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800"
            data-testid="url-warnings"
          >
            공유 링크의 일부 설정을 복원하지 못했습니다:
            <ul className="mt-0.5 list-disc pl-4">
              {urlWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="wep-btn-quiet" onClick={copyLink} data-testid="share-copy">
          링크 복사
        </button>
        <button
          type="button"
          className="wep-btn-quiet"
          onClick={onDownloadRankingCsv}
          data-testid="csv-ranking"
        >
          순위 CSV
        </button>
        {onDownloadComparisonCsv && (
          <button
            type="button"
            className="wep-btn-quiet"
            onClick={onDownloadComparisonCsv}
            data-testid="csv-comparison"
          >
            비교 CSV
          </button>
        )}
        <button type="button" className="wep-btn-quiet" onClick={onOpenReport} data-testid="open-report">
          보고서 보기
        </button>
      </div>

      {/* Copy feedback (live region). */}
      <div aria-live="polite" className="mt-1 min-h-[1rem]">
        {copyState === "ok" && (
          <p role="status" className="text-[11px] text-emerald-700" data-testid="copy-ok">
            링크를 복사했습니다.
          </p>
        )}
        {copyState === "fail" && (
          <p role="alert" className="text-[11px] text-red-700" data-testid="copy-fail">
            복사하지 못했습니다. 주소창의 링크를 직접 복사해 주세요.
          </p>
        )}
      </div>

      <p className="mt-1 text-[11px] text-slate-400">
        보고서 이미지에는 지도가 포함되지 않습니다.
      </p>
    </section>
  );
}
