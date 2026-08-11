"use client";

/**
 * The five result figures of the Figma frame (129:5709, card ③): one hero and four
 * supporting tiles.
 *
 *   추정 설치비 (표준공사비 기준)  ← standard_cost.standard_construction_cost_bn
 *   대상 인구                     ← official_input.official_service_population
 *   연간 처리 대상량               ← capacity.annual_service_quantity_ton
 *   필요 시설 용량                 ← capacity.facility_capacity_ton_per_day
 *   1인당 참고치                   ← per_capita.per_capita_local_share_won
 *
 * EVERY ONE IS A SERVED VALUE. No arithmetic happens in this file: money and
 * capacity are approximated for the primary surface by `lib/displayNumber.ts` from
 * the backend's own decimal string, and the annual quantity is comma-grouped by
 * `formatQuantity`, which preserves the value exactly. The exact strings all stay
 * reachable in 정밀값과 계산 기준 inside 계산 방법과 한계.
 *
 * WHAT THE FIGMA ALIGNMENT CHANGED, AND WHAT IT DID NOT
 *   - The hero was the per-capita share; Figma makes it the installation cost and
 *     demotes the per-capita to one of the four tiles. Its wording is untouched:
 *     the label is still `per_capita.term_ko`, the served caveat is still shown,
 *     and the "not a bill" non-claim still sits directly beneath it. It is never
 *     relabelled 주민 부담 청구액 / 실제 세금 / 개인 부담금.
 *   - 대상 인구 and 연간 처리 대상량 were served all along and shown only inside the
 *     detail tables. They are now first-class figures, each carrying the basis it
 *     was measured on.
 *   - 연간 환산 설치비 is no longer one of the five, so it moved (with its lifetime
 *     basis) into 계산 방법과 한계 → 비용 구성. It was not dropped.
 *
 * An unavailable value is NEVER rendered as 0 or as a number of our own invention:
 * the tile keeps its position and states the served reason in plain Korean.
 */

import type { FacilityCostCalculate } from "../../lib/api";
import {
  approximateBillionWon,
  approximateTonPerDay,
  approximateWonAsManwon,
} from "../../lib/displayNumber";
import { perCapitaUnavailableExplanation } from "../../lib/glossary";
import { formatQuantity } from "../../lib/metrics";
import { approxOrExact, PER_CAPITA_NON_CLAIM, RESULT_FOOTNOTE } from "./shared";

/** One of the four supporting figures. A missing value states why, never 0. */
function ResultTile({
  label,
  value,
  unavailableReason,
  caption,
  valueTestId,
}: {
  label: string;
  value?: string;
  unavailableReason?: string;
  caption?: string;
  valueTestId?: string;
}) {
  const unavailable = unavailableReason !== undefined;
  return (
    <div className="rounded-control bg-surface-sunken px-2.5 py-2">
      <dt className="text-[0.625rem] font-medium text-ink-subtle">{label}</dt>
      <dd
        className={
          unavailable
            ? "mt-0.5 text-xs text-ink-muted"
            : "mt-0.5 text-sm font-bold tabular-nums text-ink"
        }
        data-testid={valueTestId}
      >
        {unavailable ? unavailableReason : value}
      </dd>
      {caption ? <p className="mt-0.5 text-[0.625rem] text-ink-subtle">{caption}</p> : null}
    </div>
  );
}

export default function FacilityCostResultSummary({ result }: { result: FacilityCostCalculate }) {
  const { capacity, standard_cost, official_input, per_capita } = result;

  const population = official_input.official_service_population;
  const perCapitaAvailable = per_capita.per_capita_local_share_won !== null;

  return (
    <div className="flex flex-col gap-3" data-testid="facility-cost-result-figures">
      <dl className="flex flex-col gap-3">
        {/* The hero: the answer the workflow was started for. */}
        <div className="rounded-card bg-primary-soft px-3.5 py-3" data-testid="facility-cost-hero">
          <dt className="text-xs font-medium text-ink-secondary">{standard_cost.term_ko}</dt>
          <dd
            className="mt-0.5 text-2xl font-bold tabular-nums text-primary"
            data-testid="fc-standard-cost"
          >
            {approxOrExact(
              approximateBillionWon(standard_cost.standard_construction_cost_bn),
              standard_cost.standard_construction_cost_bn,
              standard_cost.unit,
            )}
          </dd>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ResultTile
            label="대상 인구"
            value={population !== null ? `${population.toLocaleString("en-US")}명` : undefined}
            unavailableReason={
              population !== null
                ? undefined
                : "공식 인구 미확정 — 같은 기간의 공식 인구가 제공되지 않았습니다."
            }
            valueTestId="fc-service-population"
          />
          <ResultTile
            label="연간 처리 대상량"
            value={`${formatQuantity(capacity.annual_service_quantity_ton)} 톤/년`}
            caption={`처리 비율 ${result.scenario.processing_share_percent}% 적용`}
            valueTestId="fc-annual-quantity"
          />
          <ResultTile
            label="필요 시설 용량"
            value={approxOrExact(
              approximateTonPerDay(capacity.facility_capacity_ton_per_day),
              capacity.facility_capacity_ton_per_day,
              capacity.capacity_unit,
            )}
            caption={`연간 가동일수 ${capacity.operating_days_per_year}일 기준`}
            valueTestId="fc-capacity"
          />
          <ResultTile
            label={per_capita.term_ko}
            value={
              perCapitaAvailable
                ? approxOrExact(
                    approximateWonAsManwon(per_capita.per_capita_local_share_won as string),
                    per_capita.per_capita_local_share_won as string,
                    per_capita.unit,
                  )
                : undefined
            }
            unavailableReason={
              perCapitaAvailable
                ? undefined
                : `계산 불가 — ${perCapitaUnavailableExplanation(per_capita.unavailable_reason)}`
            }
            valueTestId={perCapitaAvailable ? "fc-per-capita" : "fc-per-capita-unavailable"}
          />
        </div>
      </dl>

      {/* The non-claims that must be readable WITHOUT opening anything. The
          per-capita caveat stays adjacent to the figure it qualifies. */}
      <div className="flex flex-col gap-1 text-[0.6875rem] text-ink-subtle">
        <p data-testid="facility-cost-result-footnote">*{RESULT_FOOTNOTE}</p>
        <p data-testid="facility-cost-per-capita-caveat">
          <span className="font-medium text-warn">1인당 참고치 — {PER_CAPITA_NON_CLAIM}</span>{" "}
          {per_capita.caveat}
        </p>
        {/* Population basis + reference period, beside the two figures derived from
            it. Page 3's denominator is the cost model's own SGIS population; it is
            named here rather than assumed (docs/FACILITY_COST_MODEL_V1.md §6). */}
        <p data-testid="facility-cost-population-basis">
          인구 기준: {official_input.population_source_id ?? "출처 미제공"}
          {official_input.population_reference_period
            ? ` · 기준 시점 ${official_input.population_reference_period}`
            : ""}
          {official_input.population_definition ? ` · ${official_input.population_definition}` : ""}
        </p>
        <p data-testid="facility-cost-waste-basis">
          발생량 기준: {official_input.waste_official_dataset_name} · 기준 시점{" "}
          {official_input.waste_reference_period}
        </p>
      </div>
    </div>
  );
}
