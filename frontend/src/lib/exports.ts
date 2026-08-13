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
import type { CandidateFeature, SuitabilityProfile, SuitabilitySort, SuitabilityStatus } from "./api";
import { GRADE_LABELS, gradeFor, type GradeThresholds } from "./relativeGrade";

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
// 2. User-weight scenario top candidates
//
// A 지역 비교 CSV builder sat between these two until the correction pass. Its only
// consumer — the Page 1 지역 비교 card — was removed, and an exported builder no
// screen can reach is a maintenance liability rather than an API. The equity CSV's
// formula-injection guard is unaffected: it lives in `csv.ts` and is exercised
// through `buildRankingCsv` in exports.test.ts.
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

// --------------------------------------------------------------------------- //
// 3. 후보 구역 순위 전체보기 (Page 4C)
//
// The complete SCOPED candidate ranking, exactly as the 전체보기 dialog is showing
// it. Two properties this builder exists to guarantee:
//
//   1. SCOPE HONESTY. The rows handed in are the ones `/suitability/candidates`
//      returned under the ACTIVE ① 분석 범위 and ③ 순위 방향, collected by paging
//      that same query (lib/suitabilityRanking.ts). The scope, the direction and
//      the authoritative `total_matched` are printed in the preamble, so a file
//      can never be mistaken for the unfiltered ranking — and when the collected
//      row count is short of the total, the preamble says so in words.
//   2. THE ROW IS A CELL. Every row carries its own `candidate_key`, and the
//      first column after the rank says 500m 후보 구역. There is no per-시군구
//      aggregate anywhere in this file.
// --------------------------------------------------------------------------- //

const RANKING_SORT_LABELS: Record<SuitabilitySort, string> = {
  score_desc: "높은 순",
  score_asc: "낮은 순",
};

/** The scored object, named in its own column so no row reads as a city total. */
const CANDIDATE_UNIT_LABEL = "500m 후보 구역";

export interface SuitabilityRankingExportInput {
  runId: number;
  profile: SuitabilityProfile;
  /** The active scope's visible name, e.g. 수도권 전체 / 인천 / 경기 시흥시. */
  scopeName: string;
  sort: SuitabilitySort;
  /** The backend's authoritative count for this scope — never the row count. */
  totalMatched: number;
  /** The rows actually collected, in served order. */
  features: readonly CandidateFeature[];
  /** True when a safety cap stopped collection before `totalMatched` rows. */
  truncated: boolean;
  /**
   * The scoped A/B/C boundaries, or null when the population was too small or the
   * read failed. Null leaves every grade cell EMPTY — never a guessed band.
   */
  thresholds: Pick<GradeThresholds, "p25" | "p75"> | null;
  referenceYear: number | null;
  policyVersion: string | null;
  derivationVersion: string | null;
  candidateGridVersion: string | null;
  when: Date;
}

const RANKING_DISCLAIMER =
  "이 표는 공공자료 기반 광역 분석 스크리닝 결과의 표시용 내보내기이며, 법적·공학적 입지 적합 판정이 " +
  "아닙니다. 각 행은 시·군·구가 아니라 그 안에 있는 500m 후보 구역 한 곳입니다.";

/**
 * The A/B/C column's meaning, printed beside the data.
 *
 * A/B/C is a RELATIVE band within the scored 스크리닝 통과 population — it is not
 * a pass mark, and there is no fixed point threshold behind it. The Figma modal
 * subtitle claimed "스크리닝 통과 62점 기준"; no such rule exists in the analysis,
 * so it appears nowhere in this file.
 */
const RANKING_GRADE_NOTE =
  "A·B·C는 현재 범위의 스크리닝 통과 구역 점수 분포를 상위 25% · 중간 50% · 하위 25%로 나눈 상대 " +
  "구간입니다. 고정 합격 점수가 아니며, A가 적격을, C가 제외를 뜻하지 않습니다.";

export function buildSuitabilityRankingCsv(input: SuitabilityRankingExportInput): CsvValue[][] {
  const collected = input.features.length;
  const rows = metaRows(
    "후보 구역 순위",
    [
      { label: "분석 실행", value: `#${input.runId}` },
      { label: "점수 반영 기준", value: profileLabel(input.profile) },
      { label: "분석 범위", value: input.scopeName },
      { label: "순위 방향", value: RANKING_SORT_LABELS[input.sort] },
      { label: "순위 대상", value: `${statusLabel("ELIGIBLE")} 후보 구역` },
      { label: "분석 단위", value: CANDIDATE_UNIT_LABEL },
      // The authoritative scoped total, and the number of rows this file holds.
      // Printed as two separate facts so they can be compared at a glance.
      { label: "범위 내 총 후보 구역 수", value: input.totalMatched },
      { label: "이 파일에 포함된 행 수", value: collected },
      {
        label: "내보내기 범위",
        value: input.truncated
          ? `일부만 포함 — 안전 상한에 걸려 상위 ${collected}개까지만 내보냈습니다. ` +
            `범위 내 전체 ${input.totalMatched}개가 아닙니다.`
          : "현재 범위의 전체 순위",
      },
      { label: "자료 기준 연도", value: input.referenceYear },
      { label: "분석 규칙 버전", value: input.policyVersion },
      { label: "계산 방식 버전", value: input.derivationVersion },
      { label: "분석 구역 버전", value: input.candidateGridVersion },
      { label: "상대 구간 안내", value: RANKING_GRADE_NOTE },
    ],
    `${RANKING_DISCLAIMER} ${SCREENING_DISCLAIMER}`,
    input.when,
  );
  // The same 분석 범위와 한계 block every suitability export carries.
  for (const row of suitabilityScopeRows()) rows.push(row);
  rows.push([
    "순위",
    "분석 단위",
    "후보 구역 식별키",
    "후보 구역 번호",
    "시도",
    "시군구",
    "종합 점수",
    "상대 점수 구간",
    "안정성",
    "스크리닝 상태",
    "점수 반영 기준",
    "자료 기준 연도",
  ]);
  for (const feature of input.features) {
    const c = feature.properties;
    const grade = gradeFor(c.status, c.total_score, input.thresholds);
    rows.push([
      c.rank,
      CANDIDATE_UNIT_LABEL,
      c.candidate_key,
      c.candidate_id,
      c.sido_region_name,
      c.sigungu_region_name,
      // The exact served decimal string — a CSV cell has no numeric formatting to
      // lose precision to, so the honest value is the one the backend served.
      c.total_score,
      grade === null ? null : GRADE_LABELS[grade],
      stabilitySentence(c.stability_class),
      statusLabel(c.status),
      profileLabel(input.profile),
      input.referenceYear,
    ]);
  }
  return rows;
}

/**
 * The export's file-name stem. It names the SCOPE and the DIRECTION, so two files
 * downloaded minutes apart under different scopes cannot be confused in a
 * downloads folder — the single most likely way a scoped export gets read as the
 * whole capital region.
 */
export function suitabilityRankingFilenameBase(input: {
  runId: number;
  profile: SuitabilityProfile;
  scopeName: string;
  sort: SuitabilitySort;
}): string {
  return [
    "후보구역순위",
    input.scopeName,
    profileLabel(input.profile),
    RANKING_SORT_LABELS[input.sort],
    `run${input.runId}`,
  ].join("_");
}
