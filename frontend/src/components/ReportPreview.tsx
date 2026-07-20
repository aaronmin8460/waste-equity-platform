"use client";

/**
 * Report preview modal — a print-ready, PNG-exportable analytical report.
 *
 * Renders a `ReportModel` (from lib/report) to the DOM inside a `.wep-print`
 * container. The user can review it, then:
 *   - 인쇄: window.print(); the print CSS (globals.css) isolates `.wep-print`, so
 *     the printout is the report only — never the interactive map. Grayscale-safe.
 *   - 이미지 저장: renders the SAME model to a PNG via a text-only canvas (no map,
 *     no external tile, so no CORS taint), with loading/success/error state and a
 *     revoked object URL. The panel and docs state the image excludes the map.
 *
 * Accessible: role="dialog" aria-modal, labelled by the report title, Escape and a
 * backdrop click close it, focus moves into the dialog on open, and the PNG status
 * is a role="status" / role="alert" live region.
 */

import { useEffect, useRef, useState } from "react";

import { safeFilename } from "../lib/csv";
import { downloadBlob, renderReportPng, type ReportBlock, type ReportModel } from "../lib/report";

type PngState = { kind: "idle" } | { kind: "loading" } | { kind: "success" } | { kind: "error"; message: string };

/**
 * Compile-time exhaustiveness guard for `ReportBlock` (Phase 0 defect X8). Reached
 * only if a new block kind is added without a render branch, which TypeScript
 * rejects at build time. At runtime it deliberately does nothing: dropping an
 * unknown block is safer than styling it as a disclaimer.
 */
function assertNoUnhandledBlock(block: never): void {
  void block;
}

function Blocks({ blocks }: { blocks: ReportBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        if (block.kind === "title") {
          return (
            <h2 key={i} id="report-title" className="text-lg font-bold text-slate-900">
              {block.text}
            </h2>
          );
        }
        if (block.kind === "subtitle") {
          return (
            <p key={i} className="mt-0.5 text-xs text-slate-500">
              {block.text}
            </p>
          );
        }
        if (block.kind === "note") {
          return (
            <p key={i} className="mt-1 text-[11px] text-slate-400">
              {block.text}
            </p>
          );
        }
        if (block.kind === "section") {
          return (
            <section key={i} className="mt-3">
              <h3 className="text-sm font-semibold text-slate-800">{block.heading}</h3>
              <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                {block.rows.map(([label, value]) => (
                  <div key={label}>
                    <dt className="inline font-medium text-slate-600">{label}: </dt>
                    <dd className="inline text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        }
        if (block.kind === "table") {
          return (
            <section key={i} className="mt-3">
              {block.caption && (
                <h3 className="mb-1 text-sm font-semibold text-slate-800">{block.caption}</h3>
              )}
              <table className="w-full text-left text-xs">
                <caption className="sr-only">{block.caption}</caption>
                <thead>
                  <tr className="border-b border-slate-300 text-slate-600">
                    {block.headers.map((h) => (
                      <th key={h} className="py-1 pr-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r} className="border-b border-slate-100">
                      {row.map((cell, c) => (
                        <td key={c} className="py-1 pr-2 text-slate-800">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        }
        if (block.kind === "disclaimer") {
          return (
            <p
              key={i}
              className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs font-medium text-amber-800"
            >
              {block.text}
            </p>
          );
        }
        // Phase 0 defect X8: the amber disclaimer used to be the `switch` FALLBACK,
        // so any unrecognised block kind silently rendered as a warning — inventing
        // an analytical caveat the model never carried. Every kind in the
        // `ReportBlock` union is now handled explicitly; `block` is therefore `never`
        // here, so adding a kind without a branch is a compile error rather than a
        // mislabelled runtime render.
        assertNoUnhandledBlock(block);
        return null;
      })}
    </>
  );
}

export default function ReportPreview({
  model,
  filenameBase,
  onClose,
}: {
  model: ReportModel;
  filenameBase: string;
  onClose: () => void;
}) {
  const [png, setPng] = useState<PngState>({ kind: "idle" });
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Remember the trigger so focus returns to it on close (WCAG 2.4.3).
    const trigger = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Contain focus within the dialog (a lightweight focus trap).
      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === dialog)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      trigger?.focus?.();
    };
  }, [onClose]);

  async function savePng() {
    setPng({ kind: "loading" });
    try {
      const blob = await renderReportPng(model);
      downloadBlob(safeFilename(filenameBase, "png"), blob);
      setPng({ kind: "success" });
    } catch (cause) {
      setPng({
        kind: "error",
        message: cause instanceof Error ? cause.message : "이미지를 만들지 못했습니다.",
      });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-900/40 p-4"
      onClick={onClose}
      data-testid="report-preview"
    >
      {/* Phase 0 defect X7: the panel was capped at `max-w-2xl` (672px) despite
          holding 3- and 4-column report tables and a two-column `<dl>`. It is now
          `max-w-5xl` (1024px) — materially wider on desktop — while `w-full` inside
          the overlay's `p-4` keeps it viewport-safe at every width (min(100vw-2rem,
          1024px)), so the modal never causes page-level horizontal overflow.
          `.wep-modal-panel` owns the max-height (vh fallback before dvh, per
          RESPONSIVE_LAYOUT.md) so the BODY scrolls locally rather than the panel
          growing past the viewport. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        tabIndex={-1}
        className="wep-modal-panel my-8 flex w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar (never printed) */}
        <div className="wep-no-print flex items-center justify-between gap-2 border-b border-slate-200 p-3">
          <p className="text-sm font-semibold text-slate-700">보고서 미리보기</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="wep-btn-quiet" onClick={() => window.print()} data-testid="report-print">
              인쇄
            </button>
            <button
              type="button"
              className="wep-btn-primary"
              onClick={savePng}
              disabled={png.kind === "loading"}
              data-testid="report-png"
            >
              {png.kind === "loading" ? "이미지 만드는 중…" : "이미지 저장"}
            </button>
            <button type="button" className="wep-btn-quiet" onClick={onClose} aria-label="닫기">
              ✕
            </button>
          </div>
        </div>

        {/* PNG status (live region) */}
        <div aria-live="polite" className="wep-no-print px-3">
          {png.kind === "success" && (
            <p role="status" className="mt-2 text-xs text-emerald-700">
              이미지를 저장했습니다. (지도는 이미지에 포함되지 않습니다.)
            </p>
          )}
          {png.kind === "error" && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {png.message}
            </p>
          )}
        </div>

        {/* The report itself (printed / captured). `min-h-0` is load-bearing in the
            flex column — the default `min-height: auto` would let the content push
            the panel past its max-height instead of scrolling here. The print rules
            in globals.css already reset `max-height`/`overflow` on `.wep-print`, so
            printing is unaffected and never clipped. */}
        <div className="wep-print min-h-0 flex-1 overflow-y-auto p-4">
          <Blocks blocks={model.blocks} />
          <p className="mt-4 border-t border-slate-200 pt-2 text-[11px] text-slate-400">
            생성 시각: {model.generatedAt} · {model.mapExclusionNote}
          </p>
        </div>
      </div>
    </div>
  );
}
