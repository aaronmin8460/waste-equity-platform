/**
 * Domain CSV export builders for the citizen dashboard.
 *
 * Each builder returns a `CsvValue[][]` matrix — a labelled metadata preamble
 * (source, unit, reference period, accounting basis, and where applicable the
 * run/policy/derivation/scenario provenance), a plain-language disclaimer, the
 * "내보낸 시각" (export time), then the data table with deterministic headers.
 *
 * The matrix is handed to `csv.ts` for injection-safe, RFC-4180 serialisation.
 * Values are passed as exact strings; a genuinely missing value is `null` (an
 * empty cell), never `0`. These builders are pure (no DOM, no clock) — the `when`
 * timestamp is injected so exports are deterministic and unit-testable.
 */

import type { CsvValue } from "./csv";
import { readableTimestamp } from "./csv";
import {
  COMPONENT_META,
  COMPONENT_ORDER,
  SUITABILITY_SCOPE_STATEMENTS,
  SUITABILITY_SCREENING_DISCLAIMER,
  UNMODELED_SUITABILITY_FACTORS,
  UNMODELED_SUITABILITY_NOTE,
  UNMODELED_SUITABILITY_TITLE,
  codeWithName,
  componentExplanation,
  profileLabel,
  stabilitySentence,
  statusExplanation,
  statusLabel,
} from "./glossary";
import type { RankingResult, ScopeSelection } from "./ranking";
import { SCOPE_LABELS } from "./ranking";
import type { SuitabilityProfile, SuitabilityStatus } from "./api";

const EQUITY_DISCLAIMER =
  "이 표는 공식 공공자료의 표시용 내보내기입니다. 값이 없는 지역은 빈 칸이며 0이 아닙니다.";

const SCENARIO_DISCLAIMER =
  "사용자 가정 기반 임시 비교이며 공식 분석 실행·법적 입지 결정이 아닙니다. 저장되지 않습니다.";

// The single citizen-facing screening disclaimer, from the central glossary so the
// export and the on-screen banner can never carry two different wordings.
const SCREENING_DISCLAIMER = SUITABILITY_SCREENING_DISCLAIMER;

const SCREENING_STATUSES: readonly SuitabilityStatus[] = [
  "ELIGIBLE",
  "REVIEW_REQUIRED",
  "EXCLUDED",
];

/**
 * The Phase 0 "분석 범위와 한계" preamble rows shared by suitability exports: the
 * revised status labels + their explanations, each component's current definition,
 * the not-yet-modelled factors, and the three scope statements. Flat labelled rows,
 * matching this module's existing metadata-preamble architecture.
 */
function suitabilityScopeRows(): CsvValue[][] {
  const rows: CsvValue[][] = [["분석 범위와 한계"]];
  for (const st of SCREENING_STATUSES) {
    rows.push([`상태 · ${statusLabel(st)}`, statusExplanation(st)]);
  }
  for (const component of COMPONENT_ORDER) {
    rows.push([`구성요소 · ${COMPONENT_META[component].primary}`, componentExplanation(component)]);
  }
  rows.push([UNMODELED_SUITABILITY_TITLE, UNMODELED_SUITABILITY_FACTORS.join(", ")]);
  rows.push(["안내", UNMODELED_SUITABILITY_NOTE]);
  for (const statement of SUITABILITY_SCOPE_STATEMENTS) {
    rows.push(["안내", statement]);
  }
  rows.push([]); // blank separator before the data table
  return rows;
}

interface MetaField {
  label: string;
  value: CsvValue;
}

/** Build the labelled `[key, value]` preamble rows shared by every export. */
function metaRows(title: string, fields: MetaField[], disclaimer: string, when: Date): CsvValue[][] {
  const rows: CsvValue[][] = [[title]];
  for (const field of fields) {
    if (field.value === null || field.value === undefined || field.value === "") continue;
    rows.push([field.label, field.value]);
  }
  rows.push(["안내", disclaimer]);
  rows.push(["내보낸 시각", readableTimestamp(when)]);
  rows.push([]); // blank separator before the table
  return rows;
}

// --------------------------------------------------------------------------- //
// 1. Regional rankings
// --------------------------------------------------------------------------- //

export interface RankingExportInput {
  metricLabel: string;
  unit: string;
  source: string;
  referencePeriod: string;
  accountingBasis: string | null;
  scope: ScopeSelection;
  result: RankingResult;
  when: Date;
}

export function buildRankingCsv(input: RankingExportInput): CsvValue[][] {
  const { result } = input;
  const rows = metaRows(
    "지역 부담 순위",
    [
      { label: "지표", value: input.metricLabel },
      { label: "단위", value: input.unit },
      { label: "출처", value: input.source },
      { label: "자료 기준 시점", value: input.referencePeriod },
      { label: "집계 기준", value: input.accountingBasis },
      { label: "범위", value: SCOPE_LABELS[input.scope] },
      { label: "상위 표시 개수", value: input.result.topN },
      { label: "순위 대상 지역 수", value: result.rankedCount },
      { label: "값이 없어 제외한 지역 수", value: result.excludedCount },
    ],
    EQUITY_DISCLAIMER,
    input.when,
  );
  rows.push(["구분", "순위", "지역코드", "지역명", "값", "단위"]);
  for (const r of result.high) {
    rows.push(["값이 높은 지역", r.rank, r.code, r.name, r.display, input.unit]);
  }
  for (const r of result.low) {
    rows.push(["값이 낮은 지역", r.rank, r.code, r.name, r.display, input.unit]);
  }
  return rows;
}

// --------------------------------------------------------------------------- //
// 2. Region comparison
// --------------------------------------------------------------------------- //

export interface ComparisonRegionRow {
  code: string;
  name: string;
  /** Exact display string ("142,000", "83,721.3", or the availability text). */
  display: string;
  /** True when an official value was served (distinguishes official 0 from 자료 없음). */
  hasValue: boolean;
}

export interface ComparisonExportInput {
  metricLabel: string;
  unit: string;
  source: string;
  referencePeriod: string;
  accountingBasis: string | null;
  regions: ComparisonRegionRow[];
  when: Date;
}

export function buildComparisonCsv(input: ComparisonExportInput): CsvValue[][] {
  const rows = metaRows(
    "지역 비교",
    [
      { label: "지표", value: input.metricLabel },
      { label: "단위", value: input.unit },
      { label: "출처", value: input.source },
      { label: "자료 기준 시점", value: input.referencePeriod },
      { label: "집계 기준", value: input.accountingBasis },
      { label: "비교 지역 수", value: input.regions.length },
    ],
    EQUITY_DISCLAIMER,
    input.when,
  );
  rows.push(["지역코드", "지역명", "값", "단위", "자료 상태"]);
  for (const r of input.regions) {
    rows.push([
      r.code,
      r.name,
      // Missing value → empty cell (never 0); official value → the exact string.
      r.hasValue ? r.display : null,
      input.unit,
      r.hasValue ? "공식 값" : "자료 없음",
    ]);
  }
  return rows;
}

// --------------------------------------------------------------------------- //
// 3. User-weight scenario top candidates
// --------------------------------------------------------------------------- //

export interface ScenarioExportCandidate {
  custom_rank: number;
  custom_score: string;
  sido_region_name: string | null;
  sigungu_region_name: string | null;
  candidate_key: string;
  comparison_rank: number | null;
  rank_delta: number | null;
  rank_change_direction: string | null;
  zoning_score: string | null;
  road_score: string | null;
  equity_score: string | null;
  demand_score: string | null;
  stability_class: string | null;
  stable_count: number | null;
}

export interface ScenarioExportInput {
  runId: number;
  policyVersion: string;
  derivationVersion: string;
  candidateGridVersion: string;
  methodVersion: string;
  scenarioHashShort: string;
  weights: { zoning: string; road: string; equity: string; demand: string };
  compareProfile: SuitabilityProfile;
  candidates: ScenarioExportCandidate[];
  when: Date;
}

/** Plain arrow for a rank movement direction. */
function rankMoveText(delta: number | null, direction: string | null): CsvValue {
  if (delta === null || direction === null) return null;
  if (direction === "up") return `▲ ${Math.abs(delta)}칸 상승`;
  if (direction === "down") return `▼ ${Math.abs(delta)}칸 하락`;
  return "변화 없음";
}

export function buildScenarioCsv(input: ScenarioExportInput): CsvValue[][] {
  const w = input.weights;
  const rows = metaRows(
    "가중치 바꿔보기 — 상위 후보지",
    [
      { label: "분석 실행", value: `#${input.runId}` },
      { label: codeWithName("zoning"), value: w.zoning },
      { label: codeWithName("road"), value: w.road },
      { label: codeWithName("equity"), value: w.equity },
      { label: codeWithName("demand"), value: w.demand },
      { label: "비교 기준", value: profileLabel(input.compareProfile) },
      { label: "분석 규칙 버전", value: input.policyVersion },
      { label: "계산 방식 버전", value: input.derivationVersion },
      { label: "분석 구역 버전", value: input.candidateGridVersion },
      { label: "계산 방법", value: input.methodVersion },
      { label: "설정 식별값", value: input.scenarioHashShort },
    ],
    `${SCENARIO_DISCLAIMER} ${SCREENING_DISCLAIMER}`,
    input.when,
  );
  // Phase 0: the analytical scope & limitations block (status meanings, component
  // definitions, unmodelled factors, scope statements) travels with the export.
  for (const row of suitabilityScopeRows()) rows.push(row);
  rows.push([
    "순위",
    "점수",
    "시도",
    "시군구",
    "구역 식별키",
    "비교 순위",
    "순위 변화",
    codeWithName("zoning"),
    codeWithName("road"),
    codeWithName("equity"),
    codeWithName("demand"),
    "안정성",
  ]);
  for (const c of input.candidates) {
    rows.push([
      c.custom_rank,
      c.custom_score,
      c.sido_region_name,
      c.sigungu_region_name,
      c.candidate_key,
      c.comparison_rank,
      rankMoveText(c.rank_delta, c.rank_change_direction),
      c.zoning_score,
      c.road_score,
      c.equity_score,
      c.demand_score,
      stabilitySentence(c.stability_class),
    ]);
  }
  return rows;
}
