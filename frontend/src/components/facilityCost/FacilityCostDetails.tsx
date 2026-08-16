"use client";

/**
 * 계산 방법과 한계 — the progressive-disclosure surface the Figma alignment moved the
 * caveats and the report sections into.
 *
 * The Figma technical note (221:3443) asks for the standing 알림 banner and the
 * 「분석에 포함되지 않은 항목 8가지」 tab to leave the workflow. They leave the SCREEN,
 * not the product: every sentence of both, plus every report section the two-view
 * results screen used to carry, is here, one modal away from the primary action and
 * reachable at any time — before a calculation as well as after one.
 *
 * WHAT IS HERE, AND WHAT IT IS FOR
 *   이 계산의 범위             the three standing disclaimers + the eight-item list
 *   지역 자료 범위             which regions this stream cannot be calculated for
 *   비용 구성                  the decomposition of the headline cost, + 연간 환산 설치비
 *   포함되지 않은 비용          the served `missing_components`, merged with the
 *                             standing exclusion, never as zeroes
 *   지역별 공식 투입 데이터      the per-region official quantity and population
 *   선택한 후보지 정보          candidate context, when one was carried in
 *   계산 가정 / 출처와 계산 방법 / 정밀값과 계산 기준
 *
 * A reader can therefore still determine, for any figure on the screen: what
 * population was summed, what quantity was summed, the processing share, the
 * resulting capacity, the cost basis and its reference period, and the assumptions —
 * which is the transparency contract Figma parity is not allowed to erase.
 *
 * The sections that need a result are omitted (not emptied) before one exists, so an
 * accordion never promises content it has nothing to put in.
 */

import type { CandidateDetail, FacilityCostCalculate } from "../../lib/api";
import Accordion from "../ui/Accordion";
import Dialog from "../ui/Dialog";
import FacilityCostBreakdown from "./FacilityCostBreakdown";
import FacilityCostLimitations from "./FacilityCostLimitations";
import {
  FacilityCostAssumptions,
  FacilityCostEvidence,
  FacilityCostExactValues,
} from "./FacilityCostMethodology";
import FacilityCostNotice from "./FacilityCostNotice";
import {
  FacilityCostCandidateContext,
  FacilityCostRegionTable,
} from "./FacilityCostOfficialInputs";
import { formatQuantity } from "../../lib/metrics";
import {
  DETAILS_DESCRIPTION,
  DETAILS_TITLE,
  excludedCostRows,
  RESULTS_NON_CLAIMS,
} from "./shared";

export interface FacilityCostDetailsProps {
  open: boolean;
  onClose: () => void;
  /** The result the detail sections describe, or null before a calculation. */
  result: FacilityCostCalculate | null;
  /** Whether `result` still matches the live inputs. */
  resultCurrent: boolean;
  selectedCandidate: CandidateDetail | null;
  /** Plain-Korean name of the current stream, for the coverage section. */
  wasteStreamLabel: string;
  /** Regions with no official waste data for the current stream. */
  unavailableRegions: { code: string; label: string }[];
  /** How many regions the current stream CAN be calculated for. */
  calculableRegionCount: number;
}

export default function FacilityCostDetails({
  open,
  onClose,
  result,
  resultCurrent,
  selectedCandidate,
  wasteStreamLabel,
  unavailableRegions,
  calculableRegionCount,
}: FacilityCostDetailsProps) {
  // A result is described here only while it still matches the live inputs, on the
  // same rule the result card uses — the detail sections can never outlive the
  // figures they explain.
  const shown = result !== null && resultCurrent ? result : null;
  const excluded = shown ? excludedCostRows(shown.completeness.missing_components) : [];

  return (
    <Dialog
      open={open}
      title={DETAILS_TITLE}
      description={DETAILS_DESCRIPTION}
      onClose={onClose}
      testId="facility-cost-details"
    >
      {/* `.wep-dialog-body` is a bare scroll container with NO padding of its own,
          so each consumer insets its own content — `p-4 sm:p-5` is what
          FullRankingDialog and SuitabilityRankingDialog already use, and it lines
          the content up with the dialog head's 1rem/1.25rem. This surface was the
          one that never applied it, which is why its accordions ran edge to edge
          against the panel and read as denser than the same components elsewhere.
          Nothing was added or removed here — only the inset and the section gap. */}
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <Accordion label="이 계산의 범위" defaultOpen testId="facility-cost-scope-section">
          <FacilityCostNotice />
        </Accordion>

        <Accordion label="지역 자료 범위" testId="facility-cost-coverage-section">
          <p className="text-sm text-ink-muted">
            {wasteStreamLabel} 자료가 있어 계산할 수 있는 지역은 {calculableRegionCount}곳입니다.
            {unavailableRegions.length > 0 && (
              <>
                {" "}
                나머지 {unavailableRegions.length}곳은 같은 기간의 공식 발생량이 제공되지 않아 계산에서
                빠지며, 발생량이 0이라는 뜻이 아닙니다. 없는 값을 대신 채워 넣지 않습니다.
              </>
            )}
          </p>
          {unavailableRegions.length > 0 && (
            <p
              className="mt-2 break-words text-xs text-ink-muted"
              data-testid="facility-cost-coverage-list"
            >
              {unavailableRegions.map((r) => r.label).join(" · ")}
            </p>
          )}
          <p className="mt-2 text-xs text-ink-subtle">
            일부 시(市)는 공식 통계가 일반구 단위까지 제공되지 않습니다. 그런 경우 상위 행정구역
            단위로만 계산되며, 없는 하위 단위 자료를 만들어 내지 않습니다.
          </p>
        </Accordion>

        {shown === null ? (
          <p className="text-sm text-ink-muted" data-testid="facility-cost-details-no-result">
            비용을 계산하면 비용 구성, 포함되지 않은 항목, 지역별 공식 투입 데이터, 계산 가정과 출처,
            정밀값이 여기에 함께 표시됩니다.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-muted" data-testid="facility-cost-results-notice">
              {RESULTS_NON_CLAIMS}
            </p>

            <Accordion label="비용 구성" testId="facility-cost-breakdown-section">
              <FacilityCostBreakdown result={shown} />
              {/* The annualized restatement of the SAME one-time cost. It is not an
                  additional cost and is never added to the composition above. */}
              <p className="mt-3 text-sm text-ink-muted" data-testid="facility-cost-annualized">
                {shown.annualization.term_ko}:{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {formatQuantity(shown.annualization.annualized_construction_cost_bn)}{" "}
                  {shown.annualization.unit}
                </span>{" "}
                — 내용연수 {shown.annualization.facility_lifetime_years}년 가정 (
                {shown.annualization.lifetime_basis}). {shown.annualization.method}
              </p>
            </Accordion>

            <Accordion
              label={`포함되지 않은 비용 ${excluded.length}개`}
              testId="facility-cost-exclusions"
            >
              <p className="text-sm text-ink-muted">
                계산에 포함된 비용 항목은 {shown.completeness.included_components.length}개,
                포함되지 않은 항목은 {excluded.length}개입니다. 포함되지 않은 항목은 자료가 없어
                계산하지 못한 것이며, 그 비용이 0이라는 뜻이 아닙니다.
              </p>
              <div className="mt-3">
                <FacilityCostLimitations rows={excluded} />
              </div>
            </Accordion>

            <Accordion label="지역별 공식 투입 데이터" testId="facility-cost-region-section">
              <FacilityCostRegionTable officialInput={shown.official_input} />
            </Accordion>

            {/* Omitted entirely when no candidate was carried in — an empty
                accordion would imply there is something to open. */}
            {shown.candidate_context && (
              <Accordion label="선택한 후보지 정보" testId="facility-cost-candidate-section">
                <FacilityCostCandidateContext
                  context={shown.candidate_context}
                  selectedCandidate={selectedCandidate}
                />
              </Accordion>
            )}

            <Accordion label="계산 가정" testId="facility-cost-assumptions">
              <FacilityCostAssumptions result={shown} />
            </Accordion>

            <Accordion label="출처와 계산 방법" testId="facility-cost-methodology-section">
              <FacilityCostEvidence result={shown} />
            </Accordion>

            <Accordion label="정밀값과 계산 기준" testId="facility-cost-exact-values">
              <FacilityCostExactValues result={shown} />
            </Accordion>
          </>
        )}
      </div>
    </Dialog>
  );
}
