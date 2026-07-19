import { describe, expect, it } from "vitest";

import {
  compactTimestamp,
  csvDocument,
  escapeField,
  readableTimestamp,
  safeFilename,
  sanitizeCell,
  toCsv,
} from "./csv";

describe("sanitizeCell — formula-injection guard", () => {
  it("prefixes a leading = + - @ with a single quote", () => {
    expect(sanitizeCell("=1+1")).toBe("'=1+1");
    expect(sanitizeCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(sanitizeCell("-2+3")).toBe("'-2+3");
    expect(sanitizeCell("@import")).toBe("'@import");
    expect(sanitizeCell("\tTAB")).toBe("'\tTAB");
    expect(sanitizeCell("\rCR")).toBe("'\rCR");
  });

  it("leaves ordinary text and interior symbols untouched", () => {
    expect(sanitizeCell("종로구")).toBe("종로구");
    expect(sanitizeCell("1,234")).toBe("1,234");
    expect(sanitizeCell("A+B")).toBe("A+B"); // + not leading
  });

  it("renders missing values as an empty cell, never zero", () => {
    expect(sanitizeCell(null)).toBe("");
    expect(sanitizeCell(undefined)).toBe("");
    expect(sanitizeCell(0)).toBe("0"); // an explicit numeric zero is preserved
  });

  it("guards a negative number lead-in (spreadsheet formula safety)", () => {
    expect(sanitizeCell(-5)).toBe("'-5");
    expect(sanitizeCell("-3")).toBe("'-3");
  });
});

describe("escapeField — RFC 4180", () => {
  it("wraps and doubles quotes", () => {
    expect(escapeField('a"b')).toBe('"a""b"');
  });

  it("wraps fields containing commas or newlines", () => {
    expect(escapeField("a,b")).toBe('"a,b"');
    expect(escapeField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeField("cr\rlf")).toBe('"cr\rlf"');
  });

  it("does not wrap plain fields", () => {
    expect(escapeField("plain")).toBe("plain");
    expect(escapeField("종로구")).toBe("종로구");
  });

  it("guards then escapes a formula that also contains a comma", () => {
    // Leading '=' guarded to '= , then the comma forces quoting.
    expect(escapeField("=A1,B1")).toBe('"\'=A1,B1"');
  });
});

describe("toCsv / csvDocument", () => {
  const rows = [
    ["지역", "값", "단위"],
    ["종로구", "1,234.5", "kg/인/년"],
    ["중구", null, "kg/인/년"], // missing value → empty cell
  ];

  it("joins rows with CRLF and columns with commas, escaping as needed", () => {
    expect(toCsv(rows)).toBe(
      '지역,값,단위\r\n' + '종로구,"1,234.5",kg/인/년\r\n' + "중구,,kg/인/년",
    );
  });

  it("is deterministic for the same input", () => {
    expect(toCsv(rows)).toBe(toCsv(rows));
  });

  it("prepends a UTF-8 BOM for Excel Korean compatibility", () => {
    const doc = csvDocument([["가"]]);
    expect(doc.charCodeAt(0)).toBe(0xfeff);
    expect(doc.slice(1)).toBe("가");
  });

  it("keeps a missing value distinct from an official zero", () => {
    const out = toCsv([["a", null, 0]]);
    expect(out).toBe("a,,0");
  });
});

describe("safeFilename", () => {
  const when = new Date(2026, 6, 20, 3, 7, 9); // 2026-07-20 03:07:09 local

  it("produces a readable, filesystem-safe name with a timestamp", () => {
    expect(safeFilename("지역 부담 순위", "csv", when)).toBe("지역_부담_순위_20260720_030709.csv");
  });

  it("strips path/OS-reserved characters", () => {
    expect(safeFilename('a/b:c*?"<>|d', "csv", when)).toBe("a_b_c_d_20260720_030709.csv");
  });

  it("falls back to a default base when empty", () => {
    expect(safeFilename("", "csv", when)).toBe("export_20260720_030709.csv");
  });
});

describe("timestamps", () => {
  const when = new Date(2026, 6, 20, 3, 7, 9);
  it("compact form is YYYYMMDD_HHMMSS", () => {
    expect(compactTimestamp(when)).toBe("20260720_030709");
  });
  it("readable form is YYYY-MM-DD HH:MM", () => {
    expect(readableTimestamp(when)).toBe("2026-07-20 03:07");
  });
});
