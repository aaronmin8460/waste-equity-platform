"use client";

/**
 * 선택한 후보 구역 — everything already fetched about the one selected candidate.
 *
 * This is the former `CandidateDetailPanel` from `app/page.tsx`, restructured and
 * given an explicit EMPTY state. It renders only fields the existing
 * `fetchSuitabilityCandidateDetail` response already carries: no new request is
 * made, no value is recomputed, and no component score, weight, rank, or status is
 * derived here.
 *
 * The rules it keeps, unchanged:
 *   - an EXCLUDED cell shows its exclusion reasons and has NO score or rank — it is
 *     an analytical exclusion, not a system error, so it is styled as ordinary
 *     content with a text status, never as a failure;
 *   - a REVIEW_REQUIRED cell shows its 참고용 임시 점수 (provisional score) labelled
 *     as provisional, with no rank, and its review reasons;
 *   - a component with no served score renders `-`, never `0` — and the equity raw
 *     block keeps an official measured zero (`OFFICIAL_ZERO`) distinct from a
 *     partially-missing throughput (`PARTIAL`) via the existing `classifyEquityRaw`;
 *   - stability is described as behaviour across the three compared profiles, and
 *     explicitly NOT as 최종 입지 / 허가 / 법적 적격성;
 *   - with nothing selected it prints an instruction — never a sample candidate, a
 *     placeholder score, or a zero.
 *
 * Component names are the citizen-facing `COMPONENT_META` terms shown WITH their
 * code, and every bar-like element carries its numeric value as text beside it.
 */

import type { CandidateDetail, SuitabilityProfile } from "../../lib/api";
import {
  COMPONENT_META,
  COMPONENT_ORDER,
  accountingBasisLabel,
  codeWithName,
  profileLabel,
  statusExplanation,
  statusLabel,
} from "../../lib/glossary";
import { classifyEquityRaw, weightPercent } from "../../lib/suitability";
import LandCoverCellPanel from "../LandCoverCellPanel";
import EmptyState from "../ui/EmptyState";
import SectionCard from "../ui/SectionCard";
import StabilityBadge from "./StabilityBadge";
import UnmodeledFactorsDisclosure from "./UnmodeledFactorsDisclosure";

const TITLE = "선택한 후보 구역";

export interface SuitabilityCandidateSummaryProps {
  detail: CandidateDetail | null;
  clearSelected: () => void;
}

/** Served component scores in the shared Z·R·E·D order. `null` stays `null`. */
function componentScores(detail: CandidateDetail): {
  component: (typeof COMPONENT_ORDER)[number];
  label: string;
  score: string | null;
  weight: string;
}[] {
  const scores: Record<(typeof COMPONENT_ORDER)[number], string | null> = {
    zoning: detail.zoning_score,
    road: detail.road_score,
    equity: detail.equity_score,
    demand: detail.demand_score,
  };
  return COMPONENT_ORDER.map((component) => ({
    component,
    label: codeWithName(component),
    score: scores[component],
    weight: weightPercent(detail.weights[component]),
  }));
}

export default function SuitabilityCandidateSummary({
  detail,
  clearSelected,
}: SuitabilityCandidateSummaryProps) {
  if (detail === null) {
    return (
      <SectionCard title={TITLE} testId="candidate-detail-empty">
        <EmptyState
          title="선택한 후보 구역이 없습니다."
          description="지도에서 구역을 클릭하거나 위의 '점수가 높은 후보 구역' 목록에서 하나를 선택하면 점수·구성요소·근거와 한계를 여기에 표시합니다."
        />
      </SectionCard>
    );
  }

  const eq = detail.raw_components?.equity as Record<string, unknown> | undefined;
  const dem = detail.raw_components?.demand as Record<string, unknown> | undefined;
  const equityKind = classifyEquityRaw(eq);
  const excluded = detail.status === "EXCLUDED";

  return (
    <SectionCard
      title={TITLE}
      headerAside={
        <button
          type="button"
          onClick={clearSelected}
          className="wep-btn-quiet"
          data-testid="candidate-detail-clear"
        >
          선택 해제
        </button>
      }
      testId="candidate-detail"
    >
      <div className="text-xs break-words text-ink-muted">
        {/* IDENTITY + STATUS. The status is a text label; its plain meaning follows,
            so the reader is not left to infer it. */}
        <p className="text-sm font-semibold text-ink">
          {detail.sigungu_region_name ?? "(지역 미배정)"}
        </p>
        <p className="mt-0.5">
          <span className="font-medium text-ink">{statusLabel(detail.status)}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-ink-subtle" data-testid="candidate-status-explanation">
          {statusExplanation(detail.status)}
        </p>
        <p className="mt-0.5 font-mono text-[11px] break-all text-ink-subtle" data-diagnostic>
          구역 식별키 {detail.candidate_key}
        </p>

        {excluded ? (
          <div className="mt-2" data-testid="candidate-exclusion-reasons">
            <p className="font-medium text-ink">제외 사유:</p>
            <ul className="list-disc pl-4">
              {detail.exclusion_reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className="mt-1 text-ink-subtle">
              제외 셀은 점수·순위가 없습니다. 분석 규칙에 따른 제외이며 자료 오류가 아닙니다.
            </p>
          </div>
        ) : (
          <>
            {/* SCORE + RANK. An eligible cell has both; a review cell has only a
                provisional score, labelled as such, and no rank. */}
            <dl className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-card border border-hairline bg-surface-muted p-2">
                <dt className="text-[11px] text-ink-subtle">
                  {detail.status === "ELIGIBLE" ? "점수" : "참고용 임시 점수"}
                </dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">
                  {detail.status === "ELIGIBLE"
                    ? detail.total_score
                    : (detail.provisional_score ?? "-")}
                </dd>
              </div>
              <div className="rounded-card border border-hairline bg-surface-muted p-2">
                <dt className="text-[11px] text-ink-subtle">현재 기준 순위</dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">
                  {detail.status === "ELIGIBLE" ? (detail.rank ?? "-") : "순위 없음"}
                </dd>
              </div>
            </dl>
            {detail.status !== "ELIGIBLE" && (
              <p className="mt-1 text-[11px] text-warn">
                일부 항목이 없어 현재 항목만으로 계산한 참고용 임시 점수이며 최종 점수가 아닙니다.
                없는 항목은 0으로 대체하지 않습니다.
              </p>
            )}

            <p className="mt-2 tabular-nums" data-testid="candidate-selected-weights">
              점수 반영 기준 <strong>{profileLabel(detail.profile as SuitabilityProfile)}</strong>
              <span className="ml-1 text-ink-subtle" data-diagnostic>
                ({detail.profile})
              </span>
            </p>

            {/* COMPONENT SCORES. Citizen-facing names with their code, the served
                score, and the weight in force — each value as text. */}
            <table className="mt-1 w-full text-left" data-testid="candidate-components">
              <caption className="sr-only">구성요소별 점수와 가중치</caption>
              <thead>
                <tr className="text-[11px] text-ink-subtle">
                  <th scope="col" className="font-medium">
                    구성요소
                  </th>
                  <th scope="col" className="text-right font-medium">
                    점수
                  </th>
                  <th scope="col" className="text-right font-medium">
                    가중치
                  </th>
                </tr>
              </thead>
              <tbody>
                {componentScores(detail).map((row) => (
                  <tr key={row.component} data-testid={`candidate-component-${row.component}`}>
                    <td className="py-0.5">{COMPONENT_META[row.component].primary}</td>
                    <td className="py-0.5 text-right tabular-nums text-ink">
                      {row.score ?? "-"}
                    </td>
                    <td className="py-0.5 text-right tabular-nums text-ink-subtle">{row.weight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-ink-subtle">
              점수가 <code>-</code>인 항목은 자료가 없다는 뜻이며 0점이 아닙니다.
            </p>

            {detail.review_reasons.length > 0 && (
              <p className="mt-1" data-testid="candidate-review-reasons">
                검토 사유: {detail.review_reasons.join(", ")}
              </p>
            )}

            <p className="mt-2">
              최근접 도로: {detail.nearest_road_distance_m ?? "-"} m ·{" "}
              {String(detail.nearest_road_provenance?.official_layer_code ?? "")} (근접성 대리지표,
              차량 진입 보장 아님)
            </p>

            {eq && (
              <div className="mt-2" data-testid="candidate-equity-raw">
                <p>
                  형평성 원자료(소재 시설 부담):{" "}
                  <strong>{String(eq.located_burden_kg_per_capita)}</strong> {String(eq.unit)} ·{" "}
                  {accountingBasisLabel(String(eq.accounting_basis))} · {String(eq.source_id)} (
                  {String(eq.reference_period)})
                </p>
                <p className="text-ink-subtle" data-testid="equity-score-direction">
                  점수 방향: 시설 부담이 낮을수록 형평성 점수가 높습니다. 형평성 점수{" "}
                  <strong>{detail.equity_score ?? "-"}</strong>.
                </p>
                {equityKind === "PARTIAL" && (
                  <p className="text-warn" data-testid="equity-partial">
                    일부 시설 처리량 결측 {String(eq.missing_throughput_count)}건 — 부담이 과소집계이며
                    추정하지 않습니다.
                  </p>
                )}
                {equityKind === "OFFICIAL_ZERO" && (
                  <p className="text-ink-subtle" data-testid="equity-zero-note">
                    소재 시설 {String(eq.facility_count_located)}개 · 결측 0건. 값 0은 공식 측정값 0이며
                    결측이 아닙니다.
                  </p>
                )}
                {equityKind === "MEASURED_VALUE" && (
                  <p className="text-ink-subtle" data-testid="equity-measured-note">
                    소재 시설 {String(eq.facility_count_located)}개 · 결측 0건 (측정값).
                  </p>
                )}
              </div>
            )}

            {dem && (
              <div className="mt-2" data-testid="candidate-demand-raw">
                <p>
                  수요 원자료: {String(dem.household_per_capita_kg_per_year)} {String(dem.unit)} ·{" "}
                  {accountingBasisLabel(String(dem.accounting_basis))} · {String(dem.source_id)} (
                  {String(dem.reference_period)})
                </p>
                <p className="text-ink-subtle" data-testid="demand-score-direction">
                  점수 방향: 1인당 발생량이 높을수록 수요 점수가 높습니다. 수요 점수{" "}
                  <strong>{detail.demand_score ?? "-"}</strong>.
                </p>
              </div>
            )}

            {/* Per-profile sensitivity — the served totals/ranks, unchanged. The raw
                profile keys are the API's own and stay in the diagnostic layer. */}
            <div className="mt-2" data-testid="candidate-sensitivity">
              <p className="font-medium text-ink">점수 반영 기준을 바꾸면</p>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {Object.keys(detail.profile_totals).map((key) => (
                  <li key={key} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {profileLabel(key as SuitabilityProfile)}
                      <span className="ml-1 text-ink-subtle" data-diagnostic>
                        ({key})
                      </span>
                    </span>
                    <span className="flex-none tabular-nums text-ink">
                      점수 {detail.profile_totals[key] ?? "-"} · 순위{" "}
                      {detail.profile_ranks[key] ?? "-"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {detail.status === "ELIGIBLE" && detail.stable_count != null ? (
              <div className="mt-2" data-testid="candidate-stability">
                <p className="font-medium text-ink">
                  기준을 바꿔도 상위권을 유지하는 정도:{" "}
                  <StabilityBadge
                    stabilityClass={String(detail.stability_class)}
                    stableCount={detail.stable_count}
                  />
                </p>
                <ul className="mt-0.5 pl-2">
                  {["baseline", "equal", "critic"].map((key) => (
                    <li key={key}>
                      {key}: {detail.stability_membership[key] ? "상위 10% 포함" : "미포함"}
                    </li>
                  ))}
                </ul>
                <p className="mt-0.5 text-[11px] text-ink-subtle">
                  안정성은 세 비교 방식(baseline·equal·critic) 상위 10% 포함 여부를 나타내는 민감도
                  지표이며, 최종 입지·허가·법적 적격성을 의미하지 않습니다.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-ink-subtle" data-testid="candidate-stability-na">
                안정성 평가 대상 아님 (스크리닝 통과 후보만 평가)
              </p>
            )}
          </>
        )}

        {/* This cell's land-cover composition — a clearly separated descriptive
            section that owns its own fetch/loading/error state, so a land-cover
            failure never hides the suitability details above. Rendered for every
            status (including EXCLUDED) because the statistics describe the cell,
            not its screening outcome. */}
        <LandCoverCellPanel candidateKey={detail.candidate_key} />

        {/* The screening's own limits, in the panel the reader is already in. */}
        <div className="mt-2">
          <UnmodeledFactorsDisclosure testId="candidate-unmodeled-factors" />
        </div>

        <p className="mt-2 text-[11px] text-ink-subtle">{detail.disclaimer}</p>

        {/* Reference + version context for the value above (repo AGENTS.md: every
            displayed analytical metric carries its source and reference period). */}
        <dl
          className="mt-1 space-y-0.5 text-[11px] text-ink-subtle"
          data-testid="candidate-provenance"
        >
          <div>
            <dt className="inline font-medium">자료 기준 시점: </dt>
            <dd className="inline">{detail.reference_year}</dd>
          </div>
          <div>
            <dt className="inline font-medium">분석 실행: </dt>
            <dd className="inline">#{detail.run_id}</dd>
          </div>
          <div data-diagnostic>
            <dt className="inline font-medium">버전: </dt>
            <dd className="inline">
              분석 규칙 {detail.policy_version} · 계산 방식 {detail.derivation_version} · 분석 구역{" "}
              {detail.candidate_grid_version}
            </dd>
          </div>
        </dl>
      </div>
    </SectionCard>
  );
}
