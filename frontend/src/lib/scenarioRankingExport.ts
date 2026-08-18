/**
 * 시나리오 순위 비교 — the Page-5B ranking sheet appended to Page 5C's workbook.
 *
 * ── WHY THIS MODULE EXISTS SEPARATELY ────────────────────────────────────────────
 * Page 5C's export declares a one-way seam: `ScenarioComparisonExportExtension` takes
 * already-sealed sheets and knows nothing about ranking. This module is the other
 * side of that seam. The dependency runs ONE WAY — this file imports the export lane,
 * the export lane never imports this one — so neither lane can drift into a cycle.
 *
 * ── IT DERIVES NOTHING ───────────────────────────────────────────────────────────
 * Every number here is read off the {@link ScenarioRankingComparison} Page 5B already
 * built from the foundation's one pair of previews. There is no second join, no second
 * ranking rule and no re-rounding: scores are written as the SERVED strings' numeric
 * value and movements come from `formatRankMovement`, so the workbook and the screen
 * cannot disagree.
 *
 * ── WHAT IS NOT IN IT ────────────────────────────────────────────────────────────
 * No 통과/제외 column, no threshold, no "신규 통과", no invented rank. A candidate the
 * other side's bounded preview did not list gets the same 미제공 marker and the same
 * reason the screen shows — never 51, never `ranking_population`, never blank.
 */

import {
  RANKING_COMPARISON_TOP_N,
  formatRankMovement,
  formatUnavailableRank,
  scoreChange,
  type RankedCandidateRow,
  type ScenarioRankingComparison,
} from "./scenarioRankingComparison";
import type { ScenarioComparison } from "./scenarioComparison";
import { SCENARIO_REWEIGHT_NOTE } from "./componentModelWeights";
import { NOT_SERVED, type ScenarioComparisonExportExtension } from "./scenarioComparisonExport";
import { sealSheet, type XlsxSheet } from "./xlsx";

/** Excel caps a tab name at 31 characters; this is well inside it. */
export const RANKING_SHEET_NAME = "시나리오 순위 비교";

/**
 * The closing sentence of the workbook's scope note once this sheet is attached.
 *
 * It replaces Page 5C's "전체 후보 구역에 대한 비교나 순위 분석이 아닙니다", which stops
 * being true the moment a ranking sheet is in the file. The replacement still refuses
 * the wider claim: this is the bounded top-N union, not a population-wide ranking.
 */
export const RANKING_SHEET_SCOPE_NOTE =
  `두 시나리오의 상위 ${RANKING_COMPARISON_TOP_N} 순위 비교를 함께 포함합니다. ` +
  "순위 비교는 각 시나리오가 서버에서 받은 미리보기 목록 안의 후보 구역만 대상으로 하며, " +
  "전체 후보 구역을 대상으로 한 순위 분석이 아닙니다.";

/** Numeric value of a served decimal string; `null` keeps "not served" out of the cell. */
function scoreValue(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * A rank cell: the exact rank when the side served one, else the SAME words the screen
 * uses for why it did not. Never a number standing in for an absence.
 */
function rankCell(
  row: RankedCandidateRow,
  slot: "A" | "B",
  model: ScenarioRankingComparison,
): string | number {
  const rank = slot === "A" ? row.aRank : row.bRank;
  if (rank !== null) return rank;
  const state = slot === "A" ? row.aRankState : row.bRankState;
  const boundary = slot === "A" ? model.boundaryA : model.boundaryB;
  return formatUnavailableRank(state, slot, boundary);
}

interface RankingExportRow {
  candidateKey: string;
  location: string | null;
  aRank: string | number;
  bRank: string | number;
  movement: string;
  aScore: number | null;
  bScore: number | null;
  scoreDelta: number | null;
  note: string | null;
}

/** Why this row has no movement figure — stated per row, so no cell is silently blank. */
function noteFor(row: RankedCandidateRow): string | null {
  if (row.aRankState === "EXACT" && row.bRankState === "EXACT") return null;
  return "양쪽 순위가 모두 제공된 후보 구역만 순위 이동을 계산합니다.";
}

/**
 * The sheet. Rows are the union Page 5B already assembled and ordered, so the file's
 * row order is the table's row order.
 */
export function buildRankingComparisonSheet(
  model: ScenarioRankingComparison,
  comparison: ScenarioComparison,
): XlsxSheet<RankingExportRow> {
  const name = (slot: "A" | "B") => {
    const side = slot === "A" ? comparison.sideA : comparison.sideB;
    return side.scenarioName ?? side.scenarioId ?? NOT_SERVED;
  };

  const top = model.topCandidate;
  const topLine = (slot: "A" | "B") => {
    const row = slot === "A" ? top.a : top.b;
    if (row === null) return `${slot}안 1위 후보 구역: ${NOT_SERVED}`;
    return `${slot}안 1위 후보 구역: ${row.candidateKey}${row.locationLabel ? ` (${row.locationLabel})` : ""}`;
  };

  const retention = model.topNRetention;
  const retentionLine =
    retention.percent === null
      ? `상위 ${retention.n} 유지율: ${NOT_SERVED} (양쪽 모두에서 비교 가능한 후보 구역이 없습니다)`
      : `상위 ${retention.n} 유지율: ${retention.denominator}개 중 ${retention.retained}개 유지 ` +
        `(${retention.percent}%)` +
        (retention.reduced
          ? ` — 양쪽에서 실제로 비교 가능한 후보 구역이 ${retention.denominator}개뿐이어서 ` +
            `${retention.n}개가 아닌 ${retention.denominator}개를 기준으로 계산했습니다.`
          : "");

  const preamble = [
    "시나리오 순위 비교 — A안 / B안 (이 브라우저에 저장된 사용자 시나리오)",
    model.runId === null ? "분석 실행: 확인되지 않음" : `분석 실행 ${model.runId}`,
    `A안: ${name("A")}`,
    `B안: ${name("B")}`,
    // The bound every figure on this sheet lives inside, in Page 5B's own words.
    model.scopeDescription,
    retentionLine,
    topLine("A"),
    topLine("B"),
    top.state === "UNCHANGED"
      ? "두 시나리오의 1위 후보 구역은 같습니다."
      : top.state === "CHANGED"
        ? "두 시나리오의 1위 후보 구역이 서로 다릅니다."
        : `1위 후보 구역 비교: ${NOT_SERVED} (한쪽 이상에서 1위가 제공되지 않았습니다)`,
    `순위 이동이 계산된 후보 구역 ${model.comparableRows.length}개 중 상승 ${model.roseCount}개 · ` +
      `하락 ${model.fellCount}개 · 유지 ${model.heldCount}개.`,
    // The standing limit, repeated here because a detached sheet must carry it.
    SCENARIO_REWEIGHT_NOTE,
    `순위 칸의 "${"A안/B안"} 상위 N 밖" 또는 "순위 미제공"은 그 시나리오의 미리보기 목록에 ` +
      "이 후보 구역이 없었다는 뜻이며, 순위가 낮다는 뜻도 0이라는 뜻도 아닙니다.",
  ];

  const rows: RankingExportRow[] = model.candidateRows.map((row) => ({
    candidateKey: row.candidateKey,
    location: row.locationLabel,
    aRank: rankCell(row, "A", model),
    bRank: rankCell(row, "B", model),
    movement: formatRankMovement(row) ?? NOT_SERVED,
    aScore: scoreValue(row.aScore),
    bScore: scoreValue(row.bScore),
    scoreDelta: scoreChange(row),
    note: noteFor(row),
  }));

  return {
    name: RANKING_SHEET_NAME,
    preamble,
    columns: [
      { header: "후보 구역 식별자", value: (r) => r.candidateKey, width: 24 },
      { header: "위치", value: (r) => r.location, width: 24 },
      { header: "A안 순위", value: (r) => r.aRank, width: 18 },
      { header: "B안 순위", value: (r) => r.bRank, width: 18 },
      { header: "순위 이동", value: (r) => r.movement, width: 14 },
      { header: "A안 종합 점수", value: (r) => r.aScore, width: 16 },
      { header: "B안 종합 점수", value: (r) => r.bScore, width: 16 },
      { header: "점수 변화 (B−A)", value: (r) => r.scoreDelta, width: 16 },
      { header: "비고", value: (r) => r.note, width: 44 },
    ],
    rows,
  };
}

/**
 * The extension Page 5C's workbook builder accepts, or `undefined` when there is no
 * truthful ranking sheet to add.
 *
 * `undefined` for a `null` model — the comparison is not READY, exactly the state in
 * which Page 5B renders nothing — so the workbook falls back to Page 5C's three sheets
 * rather than gaining an empty one captioned 순위 비교.
 */
export function rankingComparisonExportExtension(
  model: ScenarioRankingComparison | null,
  comparison: ScenarioComparison,
): ScenarioComparisonExportExtension | undefined {
  if (model === null) return undefined;
  return {
    sheets: [sealSheet(buildRankingComparisonSheet(model, comparison))],
    metadataNotes: [
      `이 파일에는 "${RANKING_SHEET_NAME}" 시트가 포함되어 있습니다: ${model.scopeDescription}`,
    ],
    scopeNote: RANKING_SHEET_SCOPE_NOTE,
    filenameMarker: "순위비교",
  };
}
