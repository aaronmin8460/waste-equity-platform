/**
 * 후보지 심층 비교 — the A안 / B안 **saved-scenario** comparison workbook (Page 5C).
 *
 * ── THIS IS NOT `lib/scenarioExport.ts` ──────────────────────────────────────────
 * That module exports the LEGACY 시나리오 실험실 flow, where A안 is an official
 * stored profile and B안 is one ad-hoc weight vector, and its sheet is a TOP-N
 * ranking list. This module exports the Page-5 comparison, where A안 and B안 are BOTH
 * saved user scenarios and the subject is ONE selected candidate. Neither reads the
 * other, and the legacy workbook is unchanged.
 *
 * ── WHAT THIS FILE MAY CLAIM ─────────────────────────────────────────────────────
 * Its scope is a SINGLE CANDIDATE, so it says so — in the filename, in every sheet
 * name, and in the first preamble line of every sheet. It is never labelled
 * 전체 후보 비교: the workbook carries one cell's contributions, plus the two
 * scenarios' metadata, and a reader who opens it months later must be able to see
 * that from the file alone.
 *
 * ── MISSING IS MISSING ───────────────────────────────────────────────────────────
 * A rank absent because the cell falls outside a side's bounded top-N preview is
 * written as an explicit 미제공 marker with the reason, never as a number and never
 * as an empty cell that could read as zero. `lib/xlsx.ts` already writes `null` as an
 * EMPTY cell rather than `0`; that rule is inherited here for every numeric column.
 *
 * ── WHAT IS DELIBERATELY ABSENT ──────────────────────────────────────────────────
 * No 통과/제외 change column, no threshold, no "신규 통과", no sensitivity band, no
 * resident reaction, no future-waste forecast. A scenario reweights the RANKING;
 * screening is rule-based and does not move with the weights, so those columns are
 * not merely unavailable — they are zero by construction, and printing one would
 * imply the question was asked and answered.
 *
 * ── EXTENSION POINT FOR PAGE 5B ──────────────────────────────────────────────────
 * {@link ScenarioComparisonExportExtension} lets the later Page-5 integration append
 * a ranking-analysis sheet WITHOUT touching anything here: the extra sheets are typed
 * as already-sealed `AnyXlsxSheet`s and are appended after this lane's sheets. Nothing
 * in this module invents, imports, or reserves Page-5B data — with no extension the
 * workbook is complete and correct on its own.
 */

import type { UserScenarioCandidateDetail } from "./api";
import { profileLabel, statusLabel } from "./glossary";
import type { ComparisonSide, ScenarioComparison } from "./scenarioComparison";
import {
  majorImpactSentence,
  totalScoreDelta,
  type CandidateContributionRow,
  type MajorImpactFactor,
  type PreviewPlacement,
} from "./scenarioCandidateComparison";
import { downloadXlsx, sealSheet, type AnyXlsxSheet, type XlsxSheet } from "./xlsx";

/** The explicit "this was not served" marker. Never an empty cell, never a number. */
export const NOT_SERVED = "미제공";

/** Why a rank is 미제공 — a bounded preview is an absence, not a bad placement. */
export const RANK_OUT_OF_PREVIEW_NOTE =
  `상위 ${"{n}"}개 미리보기 목록에 이 후보 구역이 포함되지 않아 순위가 제공되지 않았습니다. ` +
  "순위가 낮다는 뜻이 아닙니다.";

/** Parse a served decimal to a number, preserving "not served" as null. */
function num(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Everything Page 5C knows about the selected cell, as the export needs it. */
export interface ScenarioComparisonExportInput {
  comparison: ScenarioComparison;
  /** The stable public identity of the selected cell. */
  candidateKey: string | null;
  candidateId: number | null;
  /** Whichever side served a detail — used for location and screening status. */
  detailA: UserScenarioCandidateDetail | null;
  detailB: UserScenarioCandidateDetail | null;
  /** Bounded-preview placement per side; `inPreview: false` becomes 미제공. */
  placementA: PreviewPlacement;
  placementB: PreviewPlacement;
  rows: readonly CandidateContributionRow[];
  majorImpact: MajorImpactFactor | null;
  /** `SCENARIO_COMPARISON_TOP_N`, so the 미제공 note can name the real bound. */
  previewTopN: number;
}

/**
 * Extra sheets appended after this lane's own.
 *
 * The Page-5 integration supplies one (`lib/scenarioRankingExport.ts`, the 시나리오 순위
 * 비교 sheet built from the Page-5B model). It stays OPTIONAL: with no extension
 * `buildScenarioComparisonWorkbook` still produces a complete, correct workbook, and
 * nothing here imports or knows the ranking module — the dependency runs one way only.
 */
export interface ScenarioComparisonExportExtension {
  sheets: AnyXlsxSheet[];
  /** Appended to the metadata sheet's preamble, so added scope is stated too. */
  metadataNotes?: string[];
  /**
   * REPLACES the second half of {@link comparisonExportScopeNote} when the extension
   * adds sheets that widen what the file covers.
   *
   * Without it the note ends "전체 후보 구역에 대한 비교나 순위 분석이 아닙니다", which is
   * exact for this lane's three single-candidate sheets and becomes FALSE the moment a
   * ranking sheet is appended. A workbook whose sheets state different scopes is worse
   * than one that states a wide scope plainly, so the extension supplies the sentence
   * that is true of the assembled file and every sheet prints that one.
   */
  scopeNote?: string;
  /** Appended to the filename, so the file names the wider scope its sheets carry. */
  filenameMarker?: string;
}

// --------------------------------------------------------------------------- //
// Shared preamble
// --------------------------------------------------------------------------- //

function sideLine(side: ComparisonSide): string {
  const label = side.slot === "A" ? "A안" : "B안";
  const name = side.scenarioName ?? side.scenarioId ?? "선택 없음";
  if (side.state !== "READY" || side.canonicalWeights === null) {
    return `${label}: ${name} — 이 분석 실행 기준으로 검증되지 않아 값이 제공되지 않았습니다 (${side.state}).`;
  }
  const w = side.canonicalWeights;
  return (
    `${label}: ${name} — 용도지역 호환성 ${w.zoning}, 도로 근접성 대리지표 ${w.road}, ` +
    `기존 지역 부담 ${w.equity}, 폐기물 처리 수요 ${w.demand}` +
    (side.preview ? ` (계산 방식 ${side.preview.method_version}, 설정 식별자 ${side.preview.scenario_hash_short})` : "")
  );
}

/**
 * The scope sentence. Exported so the UI can print the SAME words next to the button —
 * a workbook's scope must not be a claim only the file makes.
 */
export function comparisonExportScopeNote(
  input: ScenarioComparisonExportInput,
  extension?: ScenarioComparisonExportExtension,
): string {
  const key = input.candidateKey ?? "선택된 후보 구역";
  // With extension sheets the file is no longer single-candidate, so the closing
  // sentence comes from whoever added them rather than being quietly left wrong.
  if (extension?.scopeNote) {
    return `이 파일은 선택한 후보 구역 1곳(${key})의 A안·B안 상세 비교와 ${extension.scopeNote}`;
  }
  return (
    `이 파일은 선택한 후보 구역 1곳(${key})의 A안·B안 비교만 포함합니다. ` +
    "전체 후보 구역에 대한 비교나 순위 분석이 아닙니다."
  );
}

/** The lines every sheet repeats, so a single detached sheet still states its basis. */
function commonPreamble(
  input: ScenarioComparisonExportInput,
  extension?: ScenarioComparisonExportExtension,
): string[] {
  const { comparison } = input;
  const ready = comparison.sideA.preview ?? comparison.sideB.preview;
  const lines = [
    "후보지 심층 비교 — A안 / B안 (이 브라우저에 저장된 사용자 시나리오)",
    comparison.runId === null
      ? "분석 실행: 확인되지 않음"
      : `분석 실행 ${comparison.runId}` +
        (ready
          ? ` · 자료 기준 ${ready.reference_year} · 분석 규칙 ${ready.policy_version} · ` +
            `계산 방식 ${ready.derivation_version} · 후보 격자 ${ready.candidate_grid_version}`
          : ""),
    sideLine(comparison.sideA),
    sideLine(comparison.sideB),
    `비교 기준 프로필: ${ready ? profileLabel(ready.compare_profile as never) : NOT_SERVED}`,
    comparisonExportScopeNote(input, extension),
  ];
  // The backend's own disclaimers, verbatim rather than paraphrased.
  if (ready) {
    lines.push(ready.scenario_disclaimer, ready.screening_disclaimer);
  }
  lines.push(
    "가중치는 이미 계산된 Z·R·E·D 점수에 다시 적용됩니다. 배제·검토 판정(스크리닝)은 규칙 기반이며 " +
      "가중치를 바꿔도 달라지지 않습니다.",
    `값이 "${NOT_SERVED}"이거나 비어 있는 칸은 해당 자료가 제공되지 않았다는 뜻이며 0이 아닙니다.`,
  );
  return lines;
}

// --------------------------------------------------------------------------- //
// Sheet 1 — 비교 조건 (metadata + canonical weights)
// --------------------------------------------------------------------------- //

interface MetaRow {
  item: string;
  a: string | number | null;
  b: string | number | null;
}

export function buildMetadataSheet(
  input: ScenarioComparisonExportInput,
  extension?: ScenarioComparisonExportExtension,
): XlsxSheet<MetaRow> {
  const { sideA, sideB } = input.comparison;
  const weight = (side: ComparisonSide, key: "zoning" | "road" | "equity" | "demand") =>
    side.canonicalWeights?.[key] ?? NOT_SERVED;

  const rows: MetaRow[] = [
    { item: "시나리오 이름", a: sideA.scenarioName ?? NOT_SERVED, b: sideB.scenarioName ?? NOT_SERVED },
    { item: "시나리오 식별자", a: sideA.scenarioId ?? NOT_SERVED, b: sideB.scenarioId ?? NOT_SERVED },
    { item: "상태", a: sideA.state, b: sideB.state },
    { item: "검증된 분석 실행", a: sideA.runId ?? NOT_SERVED, b: sideB.runId ?? NOT_SERVED },
    {
      item: "설정 식별자",
      a: sideA.preview?.scenario_hash_short ?? NOT_SERVED,
      b: sideB.preview?.scenario_hash_short ?? NOT_SERVED,
    },
    { item: "가중치 — 용도지역 호환성(Z)", a: weight(sideA, "zoning"), b: weight(sideB, "zoning") },
    { item: "가중치 — 도로 근접성 대리지표(R)", a: weight(sideA, "road"), b: weight(sideB, "road") },
    { item: "가중치 — 기존 지역 부담(E)", a: weight(sideA, "equity"), b: weight(sideB, "equity") },
    { item: "가중치 — 폐기물 처리 수요(D)", a: weight(sideA, "demand"), b: weight(sideB, "demand") },
    {
      item: "순위 산정 대상 후보 수",
      a: sideA.preview?.ranking_population ?? null,
      b: sideB.preview?.ranking_population ?? null,
    },
  ];

  const preamble = [...commonPreamble(input, extension)];
  // The stored-scenario caveat: a saved weight vector is the reader's bookmark, not
  // an official basis, even when its numbers happen to equal a stored profile's.
  preamble.push(
    "A안과 B안은 이 브라우저에 저장된 사용자 시나리오이며, 공식 계산 기준이 아닙니다.",
  );
  if (extension?.metadataNotes) preamble.push(...extension.metadataNotes);

  return {
    name: "비교 조건",
    preamble,
    columns: [
      { header: "항목", value: (r) => r.item, width: 30 },
      { header: "A안", value: (r) => r.a, width: 30 },
      { header: "B안", value: (r) => r.b, width: 30 },
    ],
    rows,
  };
}

// --------------------------------------------------------------------------- //
// Sheet 2 — 선택 후보 구역
// --------------------------------------------------------------------------- //

interface CandidateRow {
  item: string;
  a: string | number | null;
  b: string | number | null;
  note: string | null;
}

/** The rank cell: a number when served, the explicit marker when it was not. */
function rankCell(placement: PreviewPlacement): string | number {
  return placement.inPreview && placement.rank !== null ? placement.rank : NOT_SERVED;
}

export function buildSelectedCandidateSheet(
  input: ScenarioComparisonExportInput,
  extension?: ScenarioComparisonExportExtension,
): XlsxSheet<CandidateRow> {
  const { detailA, detailB, placementA, placementB } = input;
  const anyDetail = detailA ?? detailB;
  const outOfPreviewNote = RANK_OUT_OF_PREVIEW_NOTE.replace("{n}", String(input.previewTopN));

  const rows: CandidateRow[] = [
    { item: "후보 구역 코드", a: input.candidateKey ?? NOT_SERVED, b: input.candidateKey ?? NOT_SERVED, note: "두 시나리오는 같은 후보 구역을 봅니다." },
    { item: "후보 구역 ID", a: input.candidateId, b: input.candidateId, note: null },
    { item: "시·도", a: anyDetail?.sido_region_name ?? NOT_SERVED, b: anyDetail?.sido_region_name ?? NOT_SERVED, note: null },
    { item: "시·군·구", a: anyDetail?.sigungu_region_name ?? NOT_SERVED, b: anyDetail?.sigungu_region_name ?? NOT_SERVED, note: null },
    {
      item: "판정(스크리닝)",
      a: detailA ? statusLabel(detailA.status) : NOT_SERVED,
      b: detailB ? statusLabel(detailB.status) : NOT_SERVED,
      // The one column a reader is most likely to misread as scenario-driven.
      note: "규칙 기반 판정이며 A안·B안 가중치와 무관하게 동일합니다.",
    },
    {
      item: "종합 점수",
      a: num(detailA?.custom_score ?? null),
      b: num(detailB?.custom_score ?? null),
      note: "해당 시나리오 가중치로 다시 계산된 점수입니다.",
    },
    {
      item: "종합 점수 차이 (B안 − A안)",
      a: null,
      b: num(totalScoreDelta(detailA?.custom_score ?? null, detailB?.custom_score ?? null)),
      note: null,
    },
    {
      item: `순위 (상위 ${input.previewTopN}개 미리보기 기준)`,
      a: rankCell(placementA),
      b: rankCell(placementB),
      note:
        placementA.inPreview && placementB.inPreview
          ? null
          : outOfPreviewNote,
    },
  ];

  return {
    name: "선택 후보 구역",
    preamble: commonPreamble(input, extension),
    columns: [
      { header: "항목", value: (r) => r.item, width: 34 },
      { header: "A안", value: (r) => r.a, width: 22 },
      { header: "B안", value: (r) => r.b, width: 22 },
      { header: "설명", value: (r) => r.note, width: 52 },
    ],
    rows,
  };
}

// --------------------------------------------------------------------------- //
// Sheet 3 — 평가 요소별 기여도
// --------------------------------------------------------------------------- //

export function buildContributionSheet(
  input: ScenarioComparisonExportInput,
  extension?: ScenarioComparisonExportExtension,
): XlsxSheet<CandidateContributionRow> {
  const preamble = [
    ...commonPreamble(input, extension),
    // The formula, stated in the file: a reader must be able to check the columns
    // against each other without the app.
    "가중 기여도 = 요소 점수 × 가중치 (분석 서버가 계산해 제공한 값이며, 네 요소의 합이 종합 점수입니다).",
    "요소 점수는 분석 실행의 값이므로 A안과 B안에서 같습니다. 달라지는 것은 가중치뿐입니다.",
    majorImpactSentence(input.majorImpact),
  ];

  return {
    name: "평가 요소별 기여도",
    preamble,
    columns: [
      { header: "평가 요소", value: (r) => `${r.label}(${r.code})`, width: 26 },
      { header: "요소 점수", value: (r) => num(r.componentScore), width: 14 },
      { header: "A안 가중치", value: (r) => num(r.aWeight), width: 14 },
      { header: "B안 가중치", value: (r) => num(r.bWeight), width: 14 },
      { header: "A안 가중 기여도", value: (r) => num(r.aContribution), width: 18 },
      { header: "B안 가중 기여도", value: (r) => num(r.bContribution), width: 18 },
      { header: "기여도 차이 (B안 − A안)", value: (r) => num(r.deltaContribution), width: 22 },
      {
        header: "가중 기여도 변화가 가장 큰 요소",
        // Marked on the winning row only — and on every co-equal row when the
        // maximum is tied, so the file never presents one factor as uniquely largest.
        value: (r) =>
          input.majorImpact !== null &&
          (r.component === input.majorImpact.component ||
            input.majorImpact.tiedWith.includes(r.component))
            ? input.majorImpact.tiedWith.length > 0
              ? "해당 (동률)"
              : "해당"
            : null,
        width: 28,
      },
    ],
    rows: [...input.rows],
  };
}

// --------------------------------------------------------------------------- //
// Workbook
// --------------------------------------------------------------------------- //

/**
 * Filename base. Carries the run, the cell, and the scope of what is actually inside.
 *
 * The `단일후보` marker stays — the workbook is still built around one cell — but an
 * extension that adds a ranking sheet appends its own marker, so a file sitting in a
 * downloads folder does not describe itself more narrowly than its contents.
 */
export function comparisonExportFilenameBase(
  input: ScenarioComparisonExportInput,
  extension?: ScenarioComparisonExportExtension,
): string {
  const run = input.comparison.runId ?? "미확인";
  const key = input.candidateKey ?? (input.candidateId !== null ? `id${input.candidateId}` : "후보미선택");
  const extra = extension?.filenameMarker ? `_${extension.filenameMarker}` : "";
  return `후보지_심층비교_run${run}_${key}_단일후보${extra}`;
}

/**
 * The three Page-5C sheets, plus any extension sheets appended after them.
 *
 * Row types differ per sheet, so each is sealed — `lib/xlsx.ts` erases the row type in
 * exactly one documented place, which is what keeps the call site cast-free.
 */
export function buildScenarioComparisonWorkbook(
  input: ScenarioComparisonExportInput,
  extension?: ScenarioComparisonExportExtension,
): AnyXlsxSheet[] {
  return [
    sealSheet(buildMetadataSheet(input, extension)),
    sealSheet(buildSelectedCandidateSheet(input, extension)),
    sealSheet(buildContributionSheet(input, extension)),
    ...(extension?.sheets ?? []),
  ];
}

/** Build and download the comparison workbook. Returns the filename written. */
export function downloadScenarioComparisonWorkbook(
  input: ScenarioComparisonExportInput,
  extension?: ScenarioComparisonExportExtension,
): Promise<string> {
  return downloadXlsx(
    comparisonExportFilenameBase(input, extension),
    buildScenarioComparisonWorkbook(input, extension),
  );
}
