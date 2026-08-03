"use client";

/**
 * 핵심 결과 — the headline answer and the three supporting numbers.
 *
 * Moved out of `FacilityCostDashboard` unchanged in substance: the hero is still
 * the per-resident conversion of the simplified local share, the three secondary
 * cards are still 표준공사비 기반 설치비 산정액 · 필요한 시설 규모 · 연간 환산 설치비, and
 * every value is still produced by `lib/displayNumber.ts` from the backend's own
 * decimal string. No arithmetic happens in this file.
 *
 * The hero is NOT a bill. Its caveat is served by the backend and restated in the
 * project's own words, and the label is never rewritten to 주민 부담 청구액 /
 * 실제 세금 / 개인 부담금 / 확정 주민 부담. When the backend cannot compute it, the card
 * keeps its position and shows the plain-Korean rendering of the served reason —
 * never 0원, and never a per-capita of our own invention.
 *
 * The three secondary cards keep the honest concept names the backend serves —
 * never 총비용 / 총사업비 / 확정 사업비 / 최종 사업비 — and each states the basis it was
 * computed on (matched band, operating days, assumed lifetime).
 */

import type { FacilityCostCalculate } from "../../lib/api";
import {
  approximateAnnualBillionWon,
  approximateBillionWon,
  approximateTonPerDay,
  approximateWonAsManwon,
} from "../../lib/displayNumber";
import { perCapitaUnavailableExplanation } from "../../lib/glossary";
import KpiCard from "../ui/KpiCard";
import { approxOrExact, matchedBandLabel, PER_CAPITA_NON_CLAIM } from "./shared";

function FacilityCostHeroKpi({ result }: { result: FacilityCostCalculate }) {
  const pc = result.per_capita;
  const available = pc.per_capita_local_share_won !== null;
  const approx = available ? approximateWonAsManwon(pc.per_capita_local_share_won as string) : null;

  return (
    <dl>
      <KpiCard
        size="hero"
        label={pc.term_ko}
        value={
          available
            ? approxOrExact(approx, pc.per_capita_local_share_won as string, pc.unit)
            : undefined
        }
        unavailableReason={
          available
            ? undefined
            : `계산 불가 — ${perCapitaUnavailableExplanation(pc.unavailable_reason)}`
        }
        caption={
          <>
            <span className="block font-medium text-warn">{PER_CAPITA_NON_CLAIM}</span>
            <span className="mt-1 block">{pc.caveat}</span>
            {available && (
              <span className="mt-1 block">
                정확한 값은 아래 &ldquo;정밀값과 계산 기준&rdquo;에서 확인할 수 있습니다.
              </span>
            )}
          </>
        }
        testId="facility-cost-hero"
        valueTestId={available ? "fc-per-capita" : "fc-per-capita-unavailable"}
      />
    </dl>
  );
}

function FacilityCostSecondaryKpis({ result }: { result: FacilityCostCalculate }) {
  const { capacity, standard_cost, annualization } = result;
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard
        label={standard_cost.term_ko}
        value={approxOrExact(
          approximateBillionWon(standard_cost.standard_construction_cost_bn),
          standard_cost.standard_construction_cost_bn,
          standard_cost.unit,
        )}
        caption={`적용 구간: ${matchedBandLabel(standard_cost.matched_band)}`}
        valueTestId="fc-standard-cost"
      />
      <KpiCard
        label="필요한 시설 규모"
        value={approxOrExact(
          approximateTonPerDay(capacity.facility_capacity_ton_per_day),
          capacity.facility_capacity_ton_per_day,
          capacity.capacity_unit,
        )}
        caption={`연간 가동일수 ${capacity.operating_days_per_year}일 기준`}
        valueTestId="fc-capacity"
      />
      <KpiCard
        label={annualization.term_ko}
        value={approxOrExact(
          approximateAnnualBillionWon(annualization.annualized_construction_cost_bn),
          annualization.annualized_construction_cost_bn,
          annualization.unit,
        )}
        caption={`내용연수 ${annualization.facility_lifetime_years}년 가정`}
        valueTestId="fc-annualized"
      />
    </dl>
  );
}

export default function FacilityCostResultSummary({ result }: { result: FacilityCostCalculate }) {
  return (
    <>
      <FacilityCostHeroKpi result={result} />
      <FacilityCostSecondaryKpis result={result} />
    </>
  );
}
