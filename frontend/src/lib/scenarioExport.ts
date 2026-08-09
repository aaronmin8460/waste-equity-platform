/**
 * 후보지 심층 비교 — the A안 / B안 comparison workbook.
 *
 * ── What the export may and may not claim ────────────────────────────────────────
 * The scenario preview returns a TOP-N list (`top_candidates`), not the whole
 * candidate population, and it reports the full size separately as
 * `ranking_population`. Every honest consequence of that is enforced here:
 *
 *   - the sheet name, the preamble, and the filename all say TOP-N;
 *   - the preamble prints BOTH numbers, so the reader can see the exported rows
 *     against the population they were drawn from;
 *   - no column is a population-wide statistic derived from the top-N rows.
 *
 * ── What A안 and B안 are ─────────────────────────────────────────────────────────
 * A안 is an EXISTING OFFICIAL comparison profile of the stored run. B안 is the
 * reader's temporary weight scenario, which reweights the same frozen Z/R/E/D
 * component scores. B안 is never a stored run and never changes a screening
 * status, so the workbook carries the backend's own scenario disclaimer rather
 * than a summary of it.
 *
 * ── Metrics that do NOT exist ────────────────────────────────────────────────────
 * There is deliberately no "신규 통과" or "통과 → 제외" column. A weight scenario
 * cannot change ELIGIBLE / REVIEW_REQUIRED / EXCLUDED, so those counts are not
 * merely unavailable — they are zero by construction, and printing a zero would
 * imply the question was asked and answered. See
 * docs/YEOGIDA_UI_UNSUPPORTED_REQUIREMENTS.md.
 */

import type { UserScenarioPreview, UserScenarioTopCandidate } from "./api";
import { profileLabel } from "./glossary";
import { downloadXlsx, type XlsxColumn, type XlsxSheet } from "./xlsx";

/** Parse a served decimal string to a number, preserving "not served" as null. */
function num(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Plain Korean for the served rank-direction enum; null stays null. */
export function rankDirectionLabel(
  direction: string | null | undefined,
  delta: number | null,
): string | null {
  if (direction === null || direction === undefined) return null;
  // The served enum is LOWERCASE ("up" | "down" | "same"); an uppercase compare
  // here would silently label every row null.
  //
  // The magnitude is only printed when one was actually served. `delta ?? 0`
  // would render "상승 (0단계)" — a contradiction, and a fabricated zero in the
  // one place a reader is most likely to trust it (repo AGENTS.md).
  const steps = delta === null || delta === undefined ? null : Math.abs(delta);
  if (direction === "up") return steps === null ? "상승" : `상승 (${steps}단계)`;
  if (direction === "down") return steps === null ? "하락" : `하락 (${steps}단계)`;
  if (direction === "same") return "변화 없음";
  return null;
}

/** Plain Korean for the stability class; never invents one. */
export function stabilityLabel(
  stabilityClass: string | null | undefined,
  stableCount: number | null | undefined,
): string | null {
  if (!stabilityClass) return null;
  const names: Record<string, string> = {
    STABLE: "세 기준 모두 상위권",
    CONDITIONALLY_STABLE: "두 기준에서 상위권",
    WEIGHT_SENSITIVE: "기준에 따라 순위 변화 큼",
  };
  const name = names[stabilityClass];
  if (!name) return null;
  return stableCount === null || stableCount === undefined ? name : `${name} (${stableCount}/3)`;
}

export function scenarioColumns(
  compareProfile: string,
): XlsxColumn<UserScenarioTopCandidate>[] {
  const a = `A안 ${profileLabel(compareProfile as never)}`;
  return [
    { header: "B안 순위", value: (r) => r.custom_rank, width: 10 },
    { header: "구역 코드", value: (r) => r.candidate_key, width: 22 },
    { header: "시·도", value: (r) => r.sido_region_name, width: 12 },
    { header: "시·군·구", value: (r) => r.sigungu_region_name, width: 14 },
    { header: `${a} 점수`, value: (r) => num(r.comparison_score), width: 16 },
    { header: `${a} 순위`, value: (r) => r.comparison_rank, width: 16 },
    { header: "B안 사용자 가중치 점수", value: (r) => num(r.custom_score), width: 20 },
    // A positive delta is an improvement in the served contract; it is passed
    // through unchanged rather than re-signed here.
    { header: "순위 변화(A안→B안)", value: (r) => r.rank_delta, width: 18 },
    { header: "순위 변화 방향", value: (r) => rankDirectionLabel(r.rank_change_direction, r.rank_delta), width: 18 },
    { header: "용도지역 호환성(Z)", value: (r) => num(r.zoning_score), width: 18 },
    { header: "도로 근접성 대리지표(R)", value: (r) => num(r.road_score), width: 20 },
    { header: "기존 지역 부담(E)", value: (r) => num(r.equity_score), width: 18 },
    { header: "폐기물 처리 수요(D)", value: (r) => num(r.demand_score), width: 18 },
    { header: "가중치 민감도", value: (r) => stabilityLabel(r.stability_class, r.stable_count), width: 24 },
    { header: "후보 구역 ID", value: (r) => r.candidate_id, width: 14 },
  ];
}

/** The scope sentence. Exported so the UI can print the SAME words on the button. */
export function scenarioScopeNote(preview: UserScenarioPreview): string {
  return (
    `이 파일은 화면에 표시된 상위 ${preview.top_candidates.length.toLocaleString("ko-KR")}개 ` +
    `후보 구역만 포함합니다. B안 순위 산정 대상 전체는 ` +
    `${preview.ranking_population.toLocaleString("ko-KR")}개이며, 전체 후보에 대한 통계가 아닙니다.`
  );
}

export function buildScenarioSheet(
  preview: UserScenarioPreview,
): XlsxSheet<UserScenarioTopCandidate> {
  const weights = preview.canonical_weights as unknown as Record<string, string>;
  return {
    name: `A안 B안 비교 상위 ${preview.top_candidates.length}`,
    preamble: [
      "후보지 심층 비교 — A안(공식 비교 기준) / B안(사용자 가중치 시나리오)",
      `분석 실행 ${preview.run_id} · 자료 기준 ${preview.reference_year} · ` +
        `분석 규칙 ${preview.policy_version} · 계산 방식 ${preview.derivation_version}`,
      `A안: ${profileLabel(preview.compare_profile as never)} (공식 비교 기준)`,
      `B안: 사용자 가중치 — 용도지역 호환성 ${weights.zoning}, 도로 근접성 대리지표 ${weights.road}, ` +
        `기존 지역 부담 ${weights.equity}, 폐기물 처리 수요 ${weights.demand} ` +
        `(계산 방식 ${preview.method_version}, 설정 식별자 ${preview.scenario_hash_short})`,
      // The scope statement — mandatory, and first among the caveats.
      scenarioScopeNote(preview),
      // The backend's own disclaimers, verbatim rather than paraphrased.
      preview.scenario_disclaimer,
      preview.screening_disclaimer,
      "값이 비어 있는 칸은 해당 자료가 제공되지 않았다는 뜻이며 0이 아닙니다.",
    ],
    columns: scenarioColumns(preview.compare_profile),
    rows: preview.top_candidates,
  };
}

/** Filename base. Carries the run, the scenario identifier, and the TOP-N scope. */
export function scenarioFilenameBase(preview: UserScenarioPreview): string {
  return `후보지_심층비교_run${preview.run_id}_${preview.scenario_hash_short}_상위${preview.top_candidates.length}`;
}

/** Build and download the comparison workbook. Returns the filename written. */
export function downloadScenarioComparison(preview: UserScenarioPreview): Promise<string> {
  return downloadXlsx(scenarioFilenameBase(preview), [buildScenarioSheet(preview)]);
}
