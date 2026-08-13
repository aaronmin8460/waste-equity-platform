"use client";

/**
 * ③ 비용 계산 결과 — the third card of the Figma three-step workflow (129:5709).
 *
 * It is one card carrying the whole tail of the workflow: what is currently set,
 * the primary action, and — in the same place, on the same screen — the five result
 * figures. That single-screen arrangement is the design's, and it replaces the
 * previous setup ⇄ results view switch: there is no longer a screen the citizen has
 * to leave in order to change an input, and no 설정 바꾸기 return trip.
 *
 * WHAT SURVIVES THE MERGE OF THE TWO VIEWS
 *   - Staleness. The result is rendered only while `resultCurrent` holds, i.e. while
 *     the answer still matches the live inputs. Change any control and the figures
 *     are replaced by "다시 계산하세요" — a stale answer is never displayed beside
 *     changed inputs, which is the guarantee the two-view split existed to provide.
 *   - The in-flight state, the actionable error, and the explicit "no result yet"
 *     state, which is never a 0 and never a sample number.
 *   - The blocked-reason line under the button (polite `role="status"`), which also
 *     repeats an out-of-range advanced input so a closed accordion can never be the
 *     only home for an active validation error.
 *
 * WHAT MOVED OUT
 *   - The 준비 상태 checklist. Every row of it restated something already visible on
 *     this screen (region count, calculable-region count, facility types, input
 *     range) and the blocked-reason line below the button states the one thing that
 *     actually matters — why the action is unavailable, in the same words.
 *   - The report sections. They are all reachable, in full, from 계산 방법과 한계.
 */

import { useMemo } from "react";

import type { FacilityCostCalculate, FacilityCostOptions } from "../../lib/api";
import { SUITABILITY_SCREENING_DISCLAIMER } from "../../lib/glossary";
import { regionDisplayName } from "../../lib/regionDisplay";
import EmptyState from "../ui/EmptyState";
import InfoBanner from "../ui/InfoBanner";
import SectionCard from "../ui/SectionCard";
import Skeleton from "../ui/Skeleton";
import FacilityCostResultSummary from "./FacilityCostResultSummary";
import {
  DETAILS_TITLE,
  SETUP_NON_CLAIMS,
  summariseRegions,
  wasteStreamLabel,
  type ScenarioState,
} from "./shared";

/** One label-left / value-right row of the condition summary. */
function SummaryRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="flex-none text-xs text-ink-subtle">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-bold text-ink" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

export interface FacilityCostResultCardProps {
  options: FacilityCostOptions;
  scenario: ScenarioState;
  regionOptions: { code: string; name: string }[];
  advancedChanged: boolean;
  onCalculate: () => void;
  calculating: boolean;
  disabled: boolean;
  blockedReason: string;
  validationMessage: string | null;
  result: FacilityCostCalculate | null;
  /** Whether `result` was computed for the inputs currently on screen. */
  resultCurrent: boolean;
  errorCurrent: boolean;
  calcError: string | null;
  onOpenDetails: () => void;
}

export default function FacilityCostResultCard({
  options,
  scenario,
  regionOptions,
  advancedChanged,
  onCalculate,
  calculating,
  disabled,
  blockedReason,
  validationMessage,
  result,
  resultCurrent,
  errorCurrent,
  calcError,
  onOpenDetails,
}: FacilityCostResultCardProps) {
  const selectedLabels = useMemo(() => {
    const byCode = new Map(regionOptions.map((r) => [r.code, r]));
    return scenario.regionCodes
      .map((code) => {
        const region = byCode.get(code);
        return region ? regionDisplayName(region.code, region.name) : null;
      })
      .filter((label): label is string => label !== null);
  }, [regionOptions, scenario.regionCodes]);

  const facilityLabel =
    options.facility_types.find((f) => f.value === scenario.facilityType)?.label ?? "선택 안 함";
  const showResult = result !== null && resultCurrent && !calculating;

  return (
    <SectionCard title="③ 비용 계산 결과" testId="facility-cost-step-result">
      {/* Two standing lines, readable at every moment of the workflow — before a
          calculation as well as beside its result, and without opening anything:
          the regional-screening disclaimer this sub-view shares with the other two
          (docs/SUITABILITY_PHASE_0_TRANSPARENCY.md requires it VISIBLE in every
          suitability sub-view, so it cannot live only inside 계산 방법과 한계), and
          the three claims a citizen must not misread. The full eight-item list
          keeps its own home in 계산 방법과 한계. */}
      <div className="mb-3 flex flex-col gap-1 text-xs text-ink-subtle">
        <p data-testid="suitability-screening-disclaimer">{SUITABILITY_SCREENING_DISCLAIMER}</p>
        <p data-testid="facility-cost-standing-non-claims">{SETUP_NON_CLAIMS}</p>
      </div>

      <dl className="flex flex-col gap-2">
        <SummaryRow
          label="선택 지역"
          value={
            scenario.regionCodes.length === 0
              ? "선택 안 함"
              : `${scenario.regionCodes.length}개 · ${summariseRegions(selectedLabels)}`
          }
          testId="facility-cost-summary-regions"
        />
        <SummaryRow label="폐기물" value={wasteStreamLabel(scenario.wasteStream)} />
        <SummaryRow
          label="처리 비율"
          value={
            scenario.processingSharePercent === ""
              ? "미입력"
              : `${scenario.processingSharePercent}%`
          }
          testId="facility-cost-summary-share"
        />
        <SummaryRow label="시설 종류" value={facilityLabel} />
        <SummaryRow
          label="고급 설정"
          value={advancedChanged ? "기본값에서 변경됨" : "기본값"}
          testId="facility-cost-summary-advanced"
        />
      </dl>

      <button
        type="button"
        onClick={onCalculate}
        disabled={disabled}
        className="wep-btn-primary mt-3 w-full"
        data-testid="facility-cost-calculate"
      >
        {calculating ? "계산 중…" : "비용 계산하기"}
      </button>

      {/* Polite guidance for the ordinary "not ready yet" states, and the summary
          of an out-of-range advanced input. */}
      <p
        className="mt-2 text-xs text-ink-muted empty:hidden"
        role="status"
        data-testid="facility-cost-calculate-status"
      >
        {validationMessage ?? blockedReason}
      </p>

      <div className="mt-3">
        {calculating && (
          <div data-testid="facility-cost-calculating">
            <p
              className="text-xs text-ink-muted"
              role="status"
              data-testid="facility-cost-calculating-status"
            >
              결과를 계산하고 있습니다…
            </p>
            <Skeleton lines={4} className="mt-2" />
          </div>
        )}

        {!calculating && errorCurrent && (
          <InfoBanner tone="error" title="계산할 수 없습니다" role="alert" testId="facility-cost-error">
            <p className="font-semibold">{calcError}</p>
            <p className="mt-1 text-xs">
              공식 데이터를 계산할 수 없으면 값을 표시하지 않습니다. 대체 데이터는 사용하지 않습니다.
            </p>
          </InfoBanner>
        )}

        {!calculating && !errorCurrent && result !== null && !resultCurrent && (
          <p className="text-xs text-warn" role="status" data-testid="facility-cost-stale">
            입력이 변경되었습니다. 다시 계산하세요.
          </p>
        )}

        {/* No result yet: an explicit instruction, never a placeholder number. */}
        {!calculating && !errorCurrent && result === null && (
          <EmptyState
            title="아직 계산한 결과가 없습니다."
            description="지역을 선택하고 “비용 계산하기”를 누르면 결과가 여기에 표시됩니다. 결과가 없다는 것은 비용이 0이라는 뜻이 아니며, 예시 금액이나 임의의 값을 대신 보여주지 않습니다."
            testId="facility-cost-no-result"
          />
        )}

        {showResult && (
          <>
            {/* Only the figures are a live region: they hold the answer worth
                announcing, and keeping the disclosures outside it means a
                collapsed surface is never the only home for a role="status". */}
            <div role="status" data-testid="facility-cost-results">
              <FacilityCostResultSummary result={result} />
            </div>
            {result.completeness.is_partial && (
              <p className="mt-2 text-xs text-warn" data-testid="facility-cost-partial">
                일부 비용 항목은 자료가 없어 계산에 포함되지 않았습니다. 그 비용이 0이라는 뜻이 아니며,
                빠진 항목은 「{DETAILS_TITLE}」에서 확인할 수 있습니다.
              </p>
            )}
          </>
        )}
      </div>

      {/* The one door to everything the primary workflow no longer shows inline:
          scope, exclusions, assumptions, sources, and the exact values. */}
      <button
        type="button"
        onClick={onOpenDetails}
        className="wep-btn-quiet mt-3 w-full"
        data-testid="facility-cost-open-details"
      >
        {DETAILS_TITLE} 자세히 보기
      </button>
    </SectionCard>
  );
}
