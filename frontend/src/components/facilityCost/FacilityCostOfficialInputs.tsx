"use client";

/**
 * 분석에 사용한 공식 자료 — the official input behind the calculation, per service
 * region, and the suitability candidate the calculation was carried out for.
 *
 * `FacilityCostRegionTable` shows each region's official generation quantity, its
 * official population, and its share of the official total — a share explicitly
 * labelled a display-only derived value. No regional cost allocation is invented:
 * cost is never split across regions.
 *
 * WHAT THE REFRESH CHANGED: a region with no official population rendered its
 * "공식 인구 미확정" text in amber. Amber is this project's caution colour for a value
 * that exists but needs care; a value that was not served is a NEUTRAL missing
 * state (docs/ui-refresh/design-tokens.md). Both that cell and the uncomputable
 * share now use `DataStatusBadge`, which carries a text label in every case — so
 * the state never depends on colour, and it is still never a 0.
 */

import type { CandidateDetail, FacilityCostCalculate, FacilityCostOfficialInput, SuitabilityProfile, SuitabilityStatus } from "../../lib/api";
import { profileLabel, statusLabel } from "../../lib/glossary";
import { formatQuantity } from "../../lib/metrics";
import { regionDisplayName } from "../../lib/regionDisplay";
import { stabilityBadgeLabel } from "../../lib/suitability";
import DataStatusBadge from "../ui/DataStatusBadge";

export function FacilityCostRegionTable({
  officialInput,
}: {
  officialInput: FacilityCostOfficialInput;
}) {
  const total = Number(officialInput.official_annual_quantity_ton);
  return (
    <section aria-label="지역별 공식 투입 데이터" data-testid="facility-cost-region-table">
      <p className="text-xs text-ink-subtle">
        비중은 공식 지역 발생량 ÷ 공식 합계로 계산한 표시용 파생값입니다. 비용은 지역별로 배분하지 않습니다.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-xs">
          <caption className="sr-only">
            선택한 지역별 공식 연간 폐기물 발생량, 공식 인구, 전체 발생량 중 비중
          </caption>
          <thead>
            <tr className="border-b border-hairline text-ink-subtle">
              <th scope="col" className="py-1 pr-3 font-medium">
                지역
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                공식 연간 발생량
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                인구
              </th>
              <th scope="col" className="py-1 font-medium">
                전체 발생량 중 비중
              </th>
            </tr>
          </thead>
          <tbody>
            {officialInput.regions.map((region) => {
              const gen = Number(region.generation_quantity_ton);
              const sharePct = total > 0 && Number.isFinite(gen) ? (gen / total) * 100 : null;
              return (
                <tr
                  key={region.region_code}
                  className="border-b border-hairline last:border-0"
                  data-testid="fc-region-row"
                >
                  <th scope="row" className="py-1 pr-3 text-left font-normal text-ink">
                    {/* The metro-prefixed display name, so 서울 중구 and 인천 중구
                        are distinguishable without exposing a raw code (the code is
                        in the diagnostic list below). */}
                    {regionDisplayName(region.region_code, region.region_name)}
                  </th>
                  <td className="py-1 pr-3 tabular-nums text-ink-muted">
                    {formatQuantity(region.generation_quantity_ton)} {officialInput.quantity_unit}
                  </td>
                  <td className="py-1 pr-3 tabular-nums text-ink-muted">
                    {region.population !== null ? (
                      `${region.population.toLocaleString("en-US")}명`
                    ) : (
                      <DataStatusBadge
                        status="missing"
                        label="공식 인구 미확정"
                        reason="같은 기간의 공식 인구가 제공되지 않았습니다. 인구가 0이라는 뜻이 아닙니다."
                        testId="fc-region-population-unavailable"
                      />
                    )}
                  </td>
                  <td className="py-1 tabular-nums text-ink-muted">
                    {sharePct !== null ? (
                      `${sharePct.toFixed(1)}%`
                    ) : (
                      <DataStatusBadge
                        status="missing"
                        label="계산 불가"
                        reason="공식 합계가 제공되지 않아 비중을 계산할 수 없습니다."
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="mt-3" data-diagnostic="true" data-testid="fc-region-codes">
        <summary className="cursor-pointer text-xs text-ink-subtle">지역 코드 자세히 보기</summary>
        <p className="mt-1 break-words text-xs text-ink-subtle">
          {officialInput.regions.map((r) => `${r.region_name}: ${r.region_code}`).join(" · ")}
        </p>
      </details>
    </section>
  );
}

/**
 * Candidate context.
 *
 * The candidate is identified to a citizen by its REGION, and its screening outcome
 * by the plain status label — not by the grid key (`capital-grid-500m-v1:10_20`) or
 * the raw enum (`ELIGIBLE`), which are technical identifiers this project's own
 * glossary demotes to a detail layer. Nothing is lost: the key, the raw status, the
 * profile, the run, the reference year, and every version string stay in the
 * diagnostic disclosure below, which is what `fc-candidate-provenance` marks.
 *
 * An `ELIGIBLE` screening status is never reinterpreted as legally eligible,
 * permitted, approved, or developable.
 */
export function FacilityCostCandidateContext({
  context,
  selectedCandidate,
}: {
  context: NonNullable<FacilityCostCalculate["candidate_context"]>;
  selectedCandidate: CandidateDetail | null;
}) {
  const regionLabel =
    [context.sido_region_name, context.sigungu_region_name].filter(Boolean).join(" ") ||
    "(시군구 미배정)";
  const status = context.suitability_status;
  const profile = context.profile;
  return (
    <section aria-label="후보지 연계" className="text-xs text-ink-muted" data-testid="facility-cost-candidate">
      <p className="text-ink">
        <strong>{regionLabel}</strong>
        {status ? ` · ${statusLabel(status as SuitabilityStatus)}` : ""}
        {profile ? ` · ${profileLabel(profile as SuitabilityProfile)}` : ""}
      </p>
      {/* Source + reference period for the displayed analytical suitability status
          (AGENTS.md), from the candidate's own provenance — with the technical
          identifiers kept here rather than in the primary line. */}
      <details className="mt-1" data-diagnostic="true">
        <summary className="cursor-pointer text-ink-subtle">후보지 분석 정보 자세히 보기</summary>
        <p className="mt-1 break-words" data-testid="fc-candidate-provenance">
          {context.candidate_key ?? selectedCandidate?.candidate_key} · 분석 실행 #{context.run_id} ·
          상태 코드 {status ?? "—"} · 점수 기준 {profile ?? "—"}
          {selectedCandidate && (
            <>
              {" "}
              · 분석 기준연도 {selectedCandidate.reference_year} ·{" "}
              {selectedCandidate.derivation_version} · {selectedCandidate.policy_version} ·{" "}
              {selectedCandidate.candidate_grid_version}
            </>
          )}
        </p>
      </details>
      {/* Optional concise stability badge (ELIGIBLE candidates only). Cost V1 does
          NOT vary by candidate cell, and "stable" is not legal eligibility and adds
          no land/transport/compensation/site-specific cost — preserved as caveats. */}
      {selectedCandidate &&
        selectedCandidate.stable_count != null &&
        stabilityBadgeLabel(selectedCandidate.stability_class, selectedCandidate.stable_count) && (
          <p className="mt-1" data-testid="fc-candidate-stability">
            가중치 안정성:{" "}
            <span className="font-semibold">
              {stabilityBadgeLabel(
                selectedCandidate.stability_class,
                selectedCandidate.stable_count,
              )}
            </span>{" "}
            — 민감도 지표이며 법적 적격성이 아니고, 비용 V1은 후보 셀별로 달라지지 않습니다 (토지·운송·보상
            등 부지별 비용을 추가하지 않음).
          </p>
        )}
      <p className="mt-1">{context.note}</p>
      <p className="mt-1 font-medium text-warn">{context.suitability_disclaimer}</p>
    </section>
  );
}
