/**
 * 지역별 폐기물 처리 현황 — the inbound workbook.
 *
 * ── The one rule this file exists to enforce ─────────────────────────────────────
 * Two different money figures live on this page and they are NOT the same
 * accounting basis:
 *
 *   A. 수도권매립지 공식 반입수수료 — the official inbound fee the landfill
 *      charges, by origin sido, served by the landfill endpoints.
 *   B. 시·군·구 생활폐기물 수집·운반 계약 지급액 — what individual municipalities
 *      paid their collection/transport contractors, a different publisher, a
 *      different spatial unit, and a different year.
 *
 * They must never be summed, averaged together, or presented as one cost
 * (docs/YEOGIDA_UI_REDESIGN_SPEC.md §4). A workbook makes that risk much worse
 * than a screen does, because two adjacent columns invite a third column that
 * adds them.
 *
 * So the separation is STRUCTURAL, not merely visual: **A and B are written to
 * different sheets**, each with its own provenance preamble, and this module has
 * no function that returns both in one row. There is deliberately no
 * "total cost" anywhere.
 *
 * The shared writer's rules apply throughout: an unserved value is an EMPTY
 * CELL, never `0`.
 */

import type {
  LandfillOriginShare,
  LandfillSummary,
  LandfillTrendPoint,
  LandfillTrends,
  LandfillWasteShare,
} from "./api";
import { downloadCsv, readableTimestamp, safeFilename, type CsvValue } from "./csv";
import { downloadXlsx, sealSheet, type XlsxColumn, type XlsxSheet } from "./xlsx";

function num(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** A served share is a 0–1 decimal; express it as a percentage, or leave blank. */
function percent(raw: string | null | undefined): number | null {
  const value = num(raw);
  return value === null ? null : Math.round(value * 1000) / 10;
}

/** The human period label for a served landfill period. */
export function periodLabel(summary: LandfillSummary): string {
  const period = summary.period as unknown as Record<string, unknown>;
  const year = period.reference_year ?? period.year;
  const month = period.reference_month ?? period.month;
  return month ? `${year}년 ${String(month).slice(-2)}월` : `${year}년`;
}

/**
 * The provenance lines every landfill sheet carries.
 *
 * `accounting_basis` is printed explicitly: it is the single fact that tells a
 * reader this sheet cannot be combined with the municipal one.
 */
function landfillPreamble(summary: LandfillSummary, title: string): string[] {
  return [
    title,
    `대상 시점 ${periodLabel(summary)} · 도착지 ${summary.destination_name} · ` +
      `집계 기준 ${summary.accounting_basis}`,
    `출발 지역 ${summary.origin_filter ?? "전체"} · 폐기물 종류 ${summary.waste_filter ?? "전체"}`,
    `계산 방식 ${summary.derivation_version}`,
    "이 표의 금액은 수도권매립지 공식 반입수수료입니다. " +
      "시·군·구 수집·운반 계약 지급액과는 회계 기준·제공기관·공간 단위가 모두 달라 " +
      "더하거나 같은 비용으로 비교할 수 없습니다.",
    ...summary.caveats,
    "값이 비어 있는 칸은 해당 자료가 제공되지 않았다는 뜻이며 0이 아닙니다.",
  ];
}

const ORIGIN_COLUMNS: XlsxColumn<LandfillOriginShare>[] = [
  { header: "출발 지역", value: (r) => r.origin_name, width: 14 },
  { header: "지역 코드", value: (r) => r.origin_region_code, width: 16 },
  { header: "반입량(톤)", value: (r) => num(r.quantity_tons), width: 16 },
  { header: "반입량(kg)", value: (r) => num(r.quantity_kg), width: 18 },
  { header: "공식 반입수수료(원)", value: (r) => num(r.inbound_fee_krw), width: 20 },
  { header: "반입량 비중(%)", value: (r) => percent(r.quantity_share), width: 16 },
  { header: "톤당 환산 수수료(원)", value: (r) => num(r.effective_fee_per_ton), width: 20 },
  {
    header: "1인당 수수료(원)",
    // The served per-capita object carries its own unavailability reason; an
    // uncomputed value stays blank rather than becoming 0.
    //
    // Read through the TYPED field. This was `fee_per_capita.value` behind an
    // `unknown` cast — a field the payload has never had — so every workbook ever
    // downloaded carried a blank column where a served value existed, and the cast
    // is what stopped the compiler saying so.
    value: (r) => num(r.fee_per_capita?.fee_per_capita_krw),
    width: 18,
  },
  {
    header: "1인당 계산 불가 사유",
    value: (r) => r.fee_per_capita?.unavailable_reason ?? null,
    width: 26,
  },
];

const WASTE_COLUMNS: XlsxColumn<LandfillWasteShare>[] = [
  { header: "폐기물 종류", value: (r) => r.waste_name, width: 20 },
  { header: "반입량(톤)", value: (r) => num(r.quantity_tons), width: 16 },
  { header: "공식 반입수수료(원)", value: (r) => num(r.inbound_fee_krw), width: 20 },
  { header: "반입량 비중(%)", value: (r) => percent(r.quantity_share), width: 16 },
];

const TREND_COLUMNS: XlsxColumn<LandfillTrendPoint>[] = [
  { header: "기준 월", value: (r) => r.reference_month, width: 14 },
  { header: "반입량(톤)", value: (r) => num(r.quantity_tons), width: 16 },
  { header: "공식 반입수수료(원)", value: (r) => num(r.inbound_fee_krw), width: 20 },
  { header: "톤당 환산 수수료(원)", value: (r) => num(r.effective_fee_per_ton), width: 20 },
];

export function buildOriginSheet(summary: LandfillSummary): XlsxSheet<LandfillOriginShare> {
  return {
    name: "출발지역별 반입",
    preamble: landfillPreamble(summary, "수도권매립지 반입 현황 — 출발 지역별"),
    columns: ORIGIN_COLUMNS,
    rows: summary.origin_shares,
  };
}

export function buildWasteSheet(summary: LandfillSummary): XlsxSheet<LandfillWasteShare> {
  return {
    name: "폐기물 종류별 반입",
    preamble: landfillPreamble(summary, "수도권매립지 반입 현황 — 폐기물 종류별"),
    columns: WASTE_COLUMNS,
    rows: summary.top_waste_types,
  };
}

export function buildTrendSheet(
  summary: LandfillSummary,
  trends: LandfillTrends,
): XlsxSheet<LandfillTrendPoint> {
  return {
    name: "월별 반입 추이",
    preamble: [
      "수도권매립지 반입 현황 — 월별 추이",
      `기간 ${trends.start_month} ~ ${trends.end_month} · 집계 기준 ${trends.accounting_basis}`,
      `출발 지역 ${trends.origin_filter ?? "전체"} · 폐기물 종류 ${trends.waste_filter ?? "전체"}`,
      `계산 방식 ${trends.derivation_version}`,
      "이 표의 금액은 수도권매립지 공식 반입수수료입니다. " +
        "시·군·구 수집·운반 계약 지급액과 더하거나 같은 비용으로 비교할 수 없습니다.",
      ...trends.caveats,
      "표시된 달만 공식 자료가 있는 기간입니다. 빠진 달은 0이 아니라 자료 없음입니다.",
    ],
    columns: TREND_COLUMNS,
    rows: trends.points,
  };
}

export function landfillFilenameBase(summary: LandfillSummary): string {
  return `수도권매립지_반입현황_${periodLabel(summary).replace(/\s+/g, "")}`;
}

/**
 * Download the landfill workbook.
 *
 * Only the official-fee sheets. The municipal contract-payment dataset is a
 * separate export precisely so no workbook can ever place the two side by side
 * in one row.
 */
export function downloadLandfillWorkbook(
  summary: LandfillSummary,
  trends: LandfillTrends | null,
): Promise<string> {
  const sheets = [
    sealSheet(buildOriginSheet(summary)),
    sealSheet(buildWasteSheet(summary)),
    ...(trends && trends.points.length > 0 ? [sealSheet(buildTrendSheet(summary, trends))] : []),
  ];
  return downloadXlsx(landfillFilenameBase(summary), sheets);
}

// --------------------------------------------------------------------------- //
// CSV — the same three tables, in one flat file
// --------------------------------------------------------------------------- //
//
// A CSV has no sheets, so the one rule this module exists to enforce has to be
// carried differently: each block is preceded by its own `[표]` heading line and the
// preamble that names its accounting basis, and the blocks are separated by a blank
// row. There is still no row anywhere that places the landfill fee beside the
// municipal contract payment, and still no total.
//
// Values are written as the EXACT served decimal strings, not the numbers the
// workbook uses: a CSV cell has no numeric formatting to lose precision to, so the
// honest thing is to hand over what the backend served. `null` stays an empty cell
// (lib/csv.ts), never `0`.

function csvBlock(title: string, preamble: string[], header: string[], rows: CsvValue[][]) {
  return [[`[표] ${title}`], ...preamble.map((line) => [line]), header, ...rows, []];
}

/**
 * Build the landfill CSV rows. Exported for tests so the file's structure can be
 * asserted without touching the DOM.
 */
export function buildLandfillCsvRows(
  summary: LandfillSummary,
  trends: LandfillTrends | null,
  now: Date = new Date(),
): CsvValue[][] {
  const rows: CsvValue[][] = [
    ["수도권매립지 반입 현황"],
    [`내보낸 시각 ${readableTimestamp(now)}`],
    [],
  ];

  rows.push(
    ...csvBlock(
      "출발 지역별 반입",
      landfillPreamble(summary, "수도권매립지 반입 현황 — 출발 지역별"),
      ORIGIN_COLUMNS.map((column) => column.header),
      summary.origin_shares.map((share) => [
        share.origin_name,
        share.origin_region_code,
        share.quantity_tons,
        share.quantity_kg,
        share.inbound_fee_krw,
        percent(share.quantity_share),
        share.effective_fee_per_ton,
        share.fee_per_capita?.fee_per_capita_krw ?? null,
        share.fee_per_capita?.unavailable_reason ?? null,
      ]),
    ),
  );

  rows.push(
    ...csvBlock(
      "폐기물 종류별 반입",
      landfillPreamble(summary, "수도권매립지 반입 현황 — 폐기물 종류별"),
      WASTE_COLUMNS.map((column) => column.header),
      summary.top_waste_types.map((waste) => [
        waste.waste_name,
        waste.quantity_tons,
        waste.inbound_fee_krw,
        percent(waste.quantity_share),
      ]),
    ),
  );

  if (trends && trends.points.length > 0) {
    rows.push(
      ...csvBlock(
        "월별 반입 추이",
        [
          `기간 ${trends.start_month} ~ ${trends.end_month} · 집계 기준 ${trends.accounting_basis}`,
          "표시된 달만 공식 자료가 있는 기간입니다. 빠진 달은 0이 아니라 자료 없음입니다.",
        ],
        TREND_COLUMNS.map((column) => column.header),
        trends.points.map((point) => [
          point.reference_month,
          point.quantity_tons,
          point.inbound_fee_krw,
          point.effective_fee_per_ton,
        ]),
      ),
    );
  }

  return rows;
}

/** Download the landfill CSV — the same scope as the workbook, never wider. */
export function downloadLandfillCsv(
  summary: LandfillSummary,
  trends: LandfillTrends | null,
  now: Date = new Date(),
): string {
  const filename = safeFilename(landfillFilenameBase(summary), "csv", now);
  downloadCsv(filename, buildLandfillCsvRows(summary, trends, now));
  return filename;
}

/**
 * The waste-composition CSV offered inside 폐기물 구성 전체보기.
 *
 * Deliberately its own file rather than a slice of the one above: the modal shows the
 * composition at the CURRENT four-filter scope plus the residual roll-up, and a reader
 * who exports what they are looking at must get exactly that, with the roll-up marked
 * as the derived value it is.
 */
export function buildCompositionCsvRows(
  summary: LandfillSummary,
  rows: { name: string; quantityTons: string | null; share: string | null; derived: boolean }[],
  now: Date = new Date(),
): CsvValue[][] {
  return [
    ["수도권매립지 반입 폐기물 구성"],
    [`대상 시점 ${periodLabel(summary)} · 집계 기준 ${summary.accounting_basis}`],
    [`출발 지역 ${summary.origin_filter ?? "전체"} · 폐기물 종류 ${summary.waste_filter ?? "전체"}`],
    [`총 반입량(톤) ${summary.total_quantity_tons}`],
    [`내보낸 시각 ${readableTimestamp(now)}`],
    [
      "'그 외 항목 합계'는 총 반입량에서 위 항목들을 뺀 계산값이며, " +
        "공식적으로 보고된 하나의 항목이 아닙니다.",
    ],
    [],
    ["폐기물 종류", "반입량(톤)", "비중(%)", "값의 종류"],
    ...rows.map((row) => [
      row.name,
      row.quantityTons,
      percent(row.share),
      row.derived ? "계산값" : "공식 보고값",
    ]),
  ];
}

export function downloadCompositionCsv(
  summary: LandfillSummary,
  rows: { name: string; quantityTons: string | null; share: string | null; derived: boolean }[],
  now: Date = new Date(),
): string {
  const filename = safeFilename(`${landfillFilenameBase(summary)}_폐기물구성`, "csv", now);
  downloadCsv(filename, buildCompositionCsvRows(summary, rows, now));
  return filename;
}
