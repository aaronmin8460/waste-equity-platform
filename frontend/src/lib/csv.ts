/**
 * Safe CSV primitives for client-side export.
 *
 * Correctness + safety contract:
 *  - **Formula-injection guard**: a cell whose text begins with `= + - @` (or a
 *    tab/CR that some spreadsheets treat as a formula lead-in) is prefixed with a
 *    single quote so Excel/Sheets/LibreOffice render it as text, never evaluate it.
 *  - **RFC 4180 escaping**: after the guard, any field containing a quote, comma,
 *    or newline is wrapped in double quotes with internal quotes doubled. Rows are
 *    joined with CRLF.
 *  - **Exact values**: cells are written verbatim. A caller passes exact decimal
 *    STRINGS for quantities/scores so no precision is lost, and passes `null` for a
 *    genuinely missing value — this module renders it as an empty cell, never `0`.
 *  - **Excel Korean compatibility**: {@link csvDocument} prepends a UTF-8 BOM so
 *    Korean text opens correctly in Excel's default (system-codepage) importer.
 *
 * Domain export builders (rankings / comparison / scenario) live in `exports.ts`
 * and compose these primitives; this file has no domain knowledge.
 */

export type CsvValue = string | number | null | undefined;

const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Neutralise a spreadsheet formula lead-in. A value that begins with `= + - @`
 * (or tab/CR) is prefixed with a single quote. `null`/`undefined` → empty string.
 * Numbers are stringified as-is (their own sign handled by the same guard).
 */
export function sanitizeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(value) : value;
  if (FORMULA_LEAD.test(text)) return `'${text}`;
  return text;
}

/** RFC 4180 field escaping, applied AFTER {@link sanitizeCell}. */
export function escapeField(value: CsvValue): string {
  const cell = sanitizeCell(value);
  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

/** Serialise rows to an RFC 4180 CSV body (CRLF line endings, no BOM). */
export function toCsv(rows: readonly CsvValue[][]): string {
  return rows.map((row) => row.map(escapeField).join(",")).join("\r\n");
}

/** Full CSV document: UTF-8 BOM (Excel Korean) + body. */
export function csvDocument(rows: readonly CsvValue[][]): string {
  return `﻿${toCsv(rows)}`;
}

/**
 * A filesystem-safe, human-readable file name. Strips characters unsafe in file
 * names, collapses whitespace to underscores, and appends a compact timestamp and
 * extension. Example: `safeFilename("지역 부담 순위", "csv", date)`.
 */
export function safeFilename(base: string, ext: string, when: Date = new Date()): string {
  const stamp = compactTimestamp(when);
  const cleaned = base
    .replace(/[\\/:*?"<>|]+/g, " ") // path/OS-reserved
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  const safeBase = cleaned || "export";
  return `${safeBase}_${stamp}.${ext}`;
}

/** Compact local timestamp `YYYYMMDD_HHMMSS` for file names. */
export function compactTimestamp(when: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}` +
    `_${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}`
  );
}

/** Human-readable local timestamp for the in-document "내보낸 시각" label. */
export function readableTimestamp(when: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())} ` +
    `${p(when.getHours())}:${p(when.getMinutes())}`
  );
}

/**
 * Trigger a browser download of a CSV built from `rows`. Creates a Blob object URL
 * and revokes it after the click so no object URL leaks. No-op outside the browser.
 */
export function downloadCsv(filename: string, rows: readonly CsvValue[][]): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([csvDocument(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoke on the next tick so the click's navigation has consumed the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
