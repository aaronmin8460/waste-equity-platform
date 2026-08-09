/**
 * Real `.xlsx` export.
 *
 * The workbooks this module writes are analytical exports of served values, so
 * two rules govern every column:
 *
 *  1. **A missing value stays missing.** `null`/`undefined` is written as an
 *     EMPTY CELL, never as `0` and never as the string "0". A spreadsheet is
 *     exactly where a fabricated zero does the most damage, because the reader
 *     will sum, average, and chart the column (repo AGENTS.md).
 *  2. **Scope is stated in the file, not just in the UI.** A workbook can be
 *     re-sent, renamed, and opened months later with no page around it, so the
 *     sheet itself has to say what population it covers.
 *
 * `write-excel-file` is used rather than SheetJS: the npm build of `xlsx` has
 * been stuck on a 2022 release with known prototype-pollution advisories, and
 * `exceljs` is an order of magnitude larger for a feature that writes two flat
 * sheets. This one is MIT, browser-first, and imported dynamically so its cost
 * lands only on the click that asks for a download.
 */

/** One column of a sheet: a header and how to read the value out of a row. */
export interface XlsxColumn<Row> {
  header: string;
  /** Return `null` for "no value served" — it becomes an empty cell. */
  value: (row: Row) => string | number | null;
  /** Column width in characters. */
  width?: number;
}

export interface XlsxSheet<Row> {
  /** Sheet tab name. Excel forbids : \\ / ? * [ ] and caps it at 31 characters. */
  name: string;
  /**
   * Lines written above the table — what this dataset is, its reference period,
   * and its scope. The scope line is mandatory for a top-N export.
   */
  preamble: string[];
  columns: XlsxColumn<Row>[];
  rows: Row[];
}

/** Excel's own sheet-name restrictions. */
export function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Sheet1";
}

/**
 * A filename that survives every OS and HTTP header we might hand it to.
 *
 * Korean text is kept — it is what the reader recognises — but path separators,
 * control characters, and the Windows-reserved set are stripped, and the whole
 * thing is bounded so no filesystem truncates it mid-extension.
 */
export function safeFilename(base: string): string {
  const cleaned = base
    // Escaped ranges rather than literal control characters, so the intent is
    // readable in a diff and `no-control-regex` has nothing to flag.
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 120);
  return `${cleaned || "export"}.xlsx`;
}

type Cell = { value?: string | number; type?: typeof String | typeof Number; fontWeight?: "bold"; span?: number; wrap?: boolean };

/** Build the sheet matrix: preamble lines, a blank row, the header, then data. */
function toMatrix<Row>(sheet: XlsxSheet<Row>): Cell[][] {
  const width = sheet.columns.length;
  const matrix: Cell[][] = [];
  for (const line of sheet.preamble) {
    // A preamble line spans the table so long sentences stay readable.
    matrix.push([{ value: line, type: String, span: width, wrap: true }]);
  }
  if (sheet.preamble.length > 0) matrix.push([{}]);
  matrix.push(sheet.columns.map((column) => ({ value: column.header, type: String, fontWeight: "bold" as const })));
  for (const row of sheet.rows) {
    matrix.push(
      sheet.columns.map((column) => {
        const value = column.value(row);
        // THE rule: absence is an empty cell, never a zero.
        if (value === null) return {};
        return typeof value === "number"
          ? { value, type: Number }
          : { value, type: String };
      }),
    );
  }
  return matrix;
}

/**
 * Write one or more sheets and trigger a download. Returns the filename used.
 *
 * The library is imported dynamically so it is not in the initial bundle.
 */
export async function downloadXlsx<Row>(
  filenameBase: string,
  sheets: XlsxSheet<Row>[],
): Promise<string> {
  // The `/browser` entry point: the package has no root export, and this build
  // is the one that produces a Blob and triggers the download client-side. The
  // `/node` build would pull in Node stream APIs that do not belong in a bundle.
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const fileName = safeFilename(filenameBase);
  // The multi-sheet overload: one object per sheet carrying its own data, tab
  // name, and column widths. The browser build returns a handle rather than
  // downloading directly, so `toFile` is what actually saves it.
  const workbook = await writeXlsxFile(
    sheets.map((sheet) => ({
      data: toMatrix(sheet),
      sheet: safeSheetName(sheet.name),
      columns: sheet.columns.map((column) => ({ width: column.width ?? 18 })),
    })),
  );
  await workbook.toFile(fileName);
  return fileName;
}
