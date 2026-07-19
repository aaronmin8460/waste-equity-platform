/**
 * Print- and PNG-ready analytical report model + renderers.
 *
 * A `ReportModel` is a flat list of blocks (title, key/value sections, a table, a
 * disclaimer). The SAME model drives:
 *   - the on-screen print panel (React renders the blocks to DOM; `@media print`
 *     hides the app chrome), and
 *   - the PNG export, which draws the blocks onto a `<canvas>` with the Canvas 2D
 *     text API.
 *
 * The PNG deliberately draws TEXT ONLY — it never captures the live MapLibre map,
 * never loads an external image/tile, and so never depends on OSM tile CORS or
 * taints the canvas. That keeps `canvas.toBlob` reliable across browsers with ZERO
 * added dependencies (no html2canvas/dom-to-image). Every export panel states that
 * the image excludes the interactive map.
 *
 * The model builders are pure; `drawReport` takes a minimal 2D-context interface so
 * the layout is unit-testable without a real canvas.
 */

import { readableTimestamp } from "./csv";
import type { ComparisonExportInput, RankingExportInput, ScenarioExportInput } from "./exports";
import { codeWithName, profileLabel, stabilitySentence } from "./glossary";
import { SCOPE_LABELS } from "./ranking";

export type ReportBlock =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "section"; heading: string; rows: [string, string][] }
  | { kind: "table"; caption: string; headers: string[]; rows: string[][] }
  | { kind: "note"; text: string }
  | { kind: "disclaimer"; text: string };

export interface ReportModel {
  blocks: ReportBlock[];
  /** Human-readable local time the report was generated. */
  generatedAt: string;
  /** Always present: the image/print excludes the interactive map. */
  mapExclusionNote: string;
}

export const MAP_EXCLUSION_NOTE =
  "이 보고서 이미지는 지도를 제외한 요약입니다. 지도는 화면에서 직접 확인하세요.";

// --------------------------------------------------------------------------- //
// Minimal 2D context surface (a subset of CanvasRenderingContext2D) so the
// renderer can be unit-tested with a stub.
// --------------------------------------------------------------------------- //

export interface Ctx2D {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

interface DrawOptions {
  width: number;
  padding?: number;
  scale?: number;
}

const COLORS = {
  ink: "#0f172a",
  muted: "#475569",
  subtle: "#64748b",
  hairline: "#e2e8f0",
  warnBg: "#fffbeb",
  warnInk: "#b45309",
  headBg: "#f1f5f9",
};

/** Wrap `text` to `maxWidth` using the context's font metrics. */
function wrap(ctx: Ctx2D, text: string, maxWidth: number): string[] {
  if (!text) return [""];
  const lines: string[] = [];
  let line = "";
  // Break on spaces first; for long unbroken Korean strings, fall back to chars.
  const words = text.split(/(\s+)/);
  for (const word of words) {
    const candidate = line + word;
    if (ctx.measureText(candidate).width <= maxWidth || line === "") {
      line = candidate;
    } else {
      lines.push(line.trimEnd());
      line = word.trimStart();
    }
    // Hard-wrap a single token wider than the box (char by char).
    while (ctx.measureText(line).width > maxWidth && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut -= 1;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/**
 * Draw the report onto `ctx` and return the total height used. When `ctx` is a
 * measuring stub the return value is the height a real canvas needs (call twice:
 * once to size the canvas, once to paint).
 */
export function drawReport(ctx: Ctx2D, model: ReportModel, opts: DrawOptions): number {
  const width = opts.width;
  const pad = opts.padding ?? 32;
  const contentWidth = width - pad * 2;
  let y = pad;
  ctx.textBaseline = "alphabetic";

  const line = (
    text: string,
    { size = 14, color = COLORS.ink, weight = "normal", gap = 6, x = pad, maxW = contentWidth } = {},
  ) => {
    ctx.font = `${weight} ${size}px sans-serif`;
    ctx.fillStyle = color;
    for (const l of wrap(ctx, text, maxW)) {
      y += size;
      ctx.fillText(l, x, y);
      y += gap;
    }
  };

  for (const block of model.blocks) {
    if (block.kind === "title") {
      line(block.text, { size: 22, weight: "bold", gap: 8 });
    } else if (block.kind === "subtitle") {
      line(block.text, { size: 13, color: COLORS.subtle, gap: 12 });
    } else if (block.kind === "note") {
      line(block.text, { size: 11, color: COLORS.subtle, gap: 8 });
    } else if (block.kind === "section") {
      y += 4;
      line(block.heading, { size: 14, weight: "bold", color: COLORS.ink, gap: 6 });
      for (const [label, value] of block.rows) {
        ctx.font = "600 12px sans-serif";
        ctx.fillStyle = COLORS.muted;
        const labelText = `${label}: `;
        const labelWidth = Math.min(ctx.measureText(labelText).width, contentWidth * 0.45);
        y += 12;
        ctx.fillText(labelText, pad, y);
        ctx.font = "normal 12px sans-serif";
        ctx.fillStyle = COLORS.ink;
        const valueX = pad + labelWidth + 6;
        const valLines = wrap(ctx, value, contentWidth - labelWidth - 6);
        ctx.fillText(valLines[0], valueX, y);
        y += 5;
        for (const extra of valLines.slice(1)) {
          y += 12;
          ctx.fillText(extra, valueX, y);
          y += 5;
        }
      }
      y += 6;
    } else if (block.kind === "table") {
      y += 4;
      if (block.caption) line(block.caption, { size: 13, weight: "bold", gap: 4 });
      const cols = block.headers.length;
      const colWidth = contentWidth / cols;
      // Header row.
      ctx.font = "600 11px sans-serif";
      ctx.fillStyle = COLORS.headBg;
      ctx.fillRect(pad, y, contentWidth, 22);
      ctx.fillStyle = COLORS.muted;
      block.headers.forEach((h, i) => {
        ctx.fillText(clip(ctx, h, colWidth - 8), pad + i * colWidth + 4, y + 15);
      });
      y += 22;
      // Data rows.
      ctx.font = "normal 11px sans-serif";
      for (const row of block.rows) {
        ctx.fillStyle = COLORS.ink;
        row.forEach((cell, i) => {
          ctx.fillText(clip(ctx, cell, colWidth - 8), pad + i * colWidth + 4, y + 14);
        });
        y += 20;
      }
      y += 8;
    } else if (block.kind === "disclaimer") {
      const lines = wrap(ctx, block.text, contentWidth - 16);
      const boxH = lines.length * 18 + 16;
      ctx.fillStyle = COLORS.warnBg;
      ctx.fillRect(pad, y, contentWidth, boxH);
      ctx.font = "600 12px sans-serif";
      ctx.fillStyle = COLORS.warnInk;
      let ly = y + 8;
      for (const l of lines) {
        ly += 14;
        ctx.fillText(l, pad + 8, ly);
        ly += 4;
      }
      y += boxH + 8;
    }
  }

  // Footer: generated-at + map-exclusion note.
  y += 4;
  line(`생성 시각: ${model.generatedAt}`, { size: 11, color: COLORS.subtle, gap: 4 });
  line(model.mapExclusionNote, { size: 11, color: COLORS.subtle, gap: 4 });

  return y + pad;
}

/** Truncate a cell to fit a column, appending an ellipsis. */
function clip(ctx: Ctx2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

// --------------------------------------------------------------------------- //
// Browser PNG rendering + download
// --------------------------------------------------------------------------- //

/**
 * Render `model` to a PNG Blob via an offscreen canvas (2× for crispness). Draws
 * text only — no map, no external image — so it never taints the canvas. Rejects
 * if the canvas 2D context is unavailable.
 */
export function renderReportPng(model: ReportModel, width = 720): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("PNG export is only available in the browser."));
      return;
    }
    const scale = 2;
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) {
      reject(new Error("이미지를 생성할 수 없습니다. (canvas unavailable)"));
      return;
    }
    const height = drawReport(measure as unknown as Ctx2D, model, { width });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("이미지를 생성할 수 없습니다. (canvas unavailable)"));
      return;
    }
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    drawReport(ctx as unknown as Ctx2D, model, { width });

    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("이미지를 생성할 수 없습니다. (toBlob failed)"));
    }, "image/png");
  });
}

// --------------------------------------------------------------------------- //
// Domain report builders (pure) — the same inputs the CSV builders take, so the
// on-screen print panel, the PNG, and the CSV never diverge.
// --------------------------------------------------------------------------- //

const EQUITY_REPORT_DISCLAIMER =
  "공식 공공자료 기반 표시용 요약입니다. 값이 없는 지역은 빈 칸이며 0이 아닙니다.";
const SCENARIO_REPORT_DISCLAIMER =
  "사용자 가정 기반 임시 비교이며 공식 분석 실행·법적 입지 결정이 아닙니다. 저장되지 않습니다.";

function kv(label: string, value: string | null | undefined): [string, string] | null {
  return value === null || value === undefined || value === "" ? null : [label, value];
}

function compact<T>(items: (T | null)[]): T[] {
  return items.filter((i): i is T => i !== null);
}

export function buildEquityReport(input: RankingExportInput): ReportModel {
  const { result } = input;
  return {
    generatedAt: readableTimestamp(input.when),
    mapExclusionNote: MAP_EXCLUSION_NOTE,
    blocks: [
      { kind: "title", text: "지역 부담 순위" },
      { kind: "subtitle", text: `${input.metricLabel}${input.unit ? ` · 단위 ${input.unit}` : ""}` },
      {
        kind: "section",
        heading: "자료 정보",
        rows: compact([
          kv("출처", input.source),
          kv("자료 기준 시점", input.referencePeriod),
          kv("집계 기준", input.accountingBasis),
          kv("범위", SCOPE_LABELS[input.scope]),
          kv("순위 대상 지역 수", String(result.rankedCount)),
          kv("값이 없어 제외한 지역 수", String(result.excludedCount)),
        ]),
      },
      {
        kind: "table",
        caption: "값이 높은 지역",
        headers: ["순위", "지역", "값"],
        rows: result.high.map((r) => [String(r.rank), r.name, r.display]),
      },
      {
        kind: "table",
        caption: "값이 낮은 지역",
        headers: ["순위", "지역", "값"],
        rows: result.low.map((r) => [String(r.rank), r.name, r.display]),
      },
      { kind: "disclaimer", text: EQUITY_REPORT_DISCLAIMER },
    ],
  };
}

export function buildComparisonReport(input: ComparisonExportInput): ReportModel {
  return {
    generatedAt: readableTimestamp(input.when),
    mapExclusionNote: MAP_EXCLUSION_NOTE,
    blocks: [
      { kind: "title", text: "지역 비교" },
      { kind: "subtitle", text: `${input.metricLabel}${input.unit ? ` · 단위 ${input.unit}` : ""}` },
      {
        kind: "section",
        heading: "자료 정보",
        rows: compact([
          kv("출처", input.source),
          kv("자료 기준 시점", input.referencePeriod),
          kv("집계 기준", input.accountingBasis),
        ]),
      },
      {
        kind: "table",
        caption: "비교한 지역",
        headers: ["지역", "값", "자료 상태"],
        rows: input.regions.map((r) => [
          r.name,
          r.hasValue ? r.display : "",
          r.hasValue ? "공식 값" : "자료 없음",
        ]),
      },
      { kind: "disclaimer", text: EQUITY_REPORT_DISCLAIMER },
    ],
  };
}

export function buildScenarioReport(input: ScenarioExportInput): ReportModel {
  const w = input.weights;
  return {
    generatedAt: readableTimestamp(input.when),
    mapExclusionNote: MAP_EXCLUSION_NOTE,
    blocks: [
      { kind: "title", text: "가중치 바꿔보기 — 상위 후보지" },
      { kind: "subtitle", text: `분석 실행 #${input.runId} · 비교 기준 ${profileLabel(input.compareProfile)}` },
      {
        kind: "section",
        heading: "점수 반영 기준(가중치)",
        rows: [
          [codeWithName("zoning"), w.zoning],
          [codeWithName("road"), w.road],
          [codeWithName("equity"), w.equity],
          [codeWithName("demand"), w.demand],
        ],
      },
      {
        kind: "table",
        caption: "상위 후보지",
        headers: ["순위", "점수", "지역", "안정성"],
        rows: input.candidates.map((c) => [
          String(c.custom_rank),
          c.custom_score,
          [c.sido_region_name, c.sigungu_region_name].filter(Boolean).join(" "),
          stabilitySentence(c.stability_class) ?? "-",
        ]),
      },
      { kind: "disclaimer", text: SCENARIO_REPORT_DISCLAIMER },
    ],
  };
}

/** Download a Blob and revoke its object URL (no leak). No-op outside the browser. */
export function downloadBlob(filename: string, blob: Blob): void {
  if (typeof document === "undefined") return;
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
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
