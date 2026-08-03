"use client";

/**
 * 핵심 지표 — the headline answer for the selected conditions, and the three
 * supporting figures.
 *
 * 총 반입량 is the one dominant number on this screen: it is what the dataset is
 * FOR, and it is the only figure every other surface below decomposes. It is
 * therefore the single `KpiCard size="hero"`; the other three stay default-sized.
 * The grid still holds exactly four cards.
 *
 * Provenance is per-card and not per-section, because this row genuinely mixes the
 * two kinds: 반입량 and 반입수수료 are 공식 값 as reported by 수도권매립지관리공사,
 * while 톤당 실효 수수료 and the per-capita conversion are 계산값 this platform
 * derived from them. A single section badge would have had to lie about half the
 * row (docs/ui-refresh/facility-cost-dashboard.md §9 anticipated exactly this case).
 *
 * No value is computed here. Every figure is the backend's own decimal string put
 * through the unchanged formatters in `lib/landfill.ts`, and an unavailable value
 * renders its SERVED reason — never 0, never a placeholder, never a carried-forward
 * figure from a previous selection.
 */

import type { LandfillFeePerCapita, LandfillSummary } from "../../lib/api";
import {
  formatEffectiveFee,
  formatKrwEok,
  formatKrwPerPerson,
  formatTons,
  perCapitaUnavailableCode,
  perCapitaUnavailableLabel,
} from "../../lib/landfill";
import DataStatusBadge from "../ui/DataStatusBadge";
import KpiCard from "../ui/KpiCard";
import { FEE_CAVEAT, PER_CAPITA_DESCRIPTION, PER_CAPITA_LABEL } from "./shared";

export interface LandfillHeadlineResultsProps {
  summary: LandfillSummary;
  periodLabel: string;
}

export default function LandfillHeadlineResults({
  summary,
  periodLabel,
}: LandfillHeadlineResultsProps) {
  const period = summary.period;
  return (
    <section aria-labelledby="landfill-headline-heading" data-testid="landfill-headline">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="landfill-headline-heading" className="text-sm font-semibold text-ink">
          핵심 지표
        </h2>
        <p className="text-xs text-ink-subtle">
          기준 기간: <span className="font-medium text-ink-muted">{periodLabel}</span>
          {!period.is_complete_year && (
            <span data-testid="landfill-partial-year" className="ml-1 text-warn">
              · 부분 연도 ({period.available_through_month ?? "?"}까지) — 연간 합계가 아닙니다
            </span>
          )}
        </p>
      </div>
      {/* KpiCard renders <dt>/<dd> pairs, so the consumer owns the <dl>. */}
      <dl
        data-testid="landfill-kpis"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <KpiCard
          size="hero"
          testId="landfill-kpi-quantity"
          label="총 반입량"
          value={formatTons(summary.total_quantity_kg)}
          status={<DataStatusBadge status="reported" />}
          caption={<span className="block">공식 보고값 · 기준 기간 {periodLabel}</span>}
        />
        <KpiCard
          testId="landfill-kpi-fee"
          label="공식 반입수수료"
          value={formatKrwEok(summary.total_inbound_fee_krw)}
          status={<DataStatusBadge status="reported" />}
          caption={
            <span className="block" data-testid="landfill-fee-caveat">
              {FEE_CAVEAT}
            </span>
          }
        />
        <KpiCard
          testId="landfill-kpi-effective-fee"
          label="톤당 실효 수수료"
          value={formatEffectiveFee(summary.effective_fee_per_ton)}
          status={<DataStatusBadge status="derived" />}
          caption={<span className="block">공식자료를 바탕으로 계산한 값입니다.</span>}
        />
        <PerCapitaKpi perCapita={summary.fee_per_capita} />
      </dl>
    </section>
  );
}

/**
 * The fourth KPI. It shows a value only when the backend derived one from a
 * same-period population; otherwise it shows the served reason. It never claims a
 * resident payment or tax burden.
 *
 * Its badge follows the same rule: 계산값 when a value exists, the neutral 자료 없음
 * gray when it does not. Amber is reserved for a caution about a value that IS
 * there (docs/ui-refresh/design-tokens.md §"Missing data").
 */
function PerCapitaKpi({ perCapita }: { perCapita: LandfillFeePerCapita }) {
  const available = perCapita.fee_per_capita_krw !== null;
  const diagnosticCode = perCapitaUnavailableCode(perCapita.unavailable_reason);
  return (
    <KpiCard
      testId="landfill-kpi-per-capita"
      label={PER_CAPITA_LABEL}
      value={available ? formatKrwPerPerson(perCapita.fee_per_capita_krw) : undefined}
      status={
        available ? (
          <DataStatusBadge status="derived" />
        ) : (
          <DataStatusBadge
            status="missing"
            reason={perCapitaUnavailableLabel(perCapita.unavailable_reason)}
          />
        )
      }
      // Never 0원: an absent denominator is not a zero fee. KpiCard renders the
      // reason INSTEAD of a value, so no zero-ish placeholder can slip through.
      unavailableReason={
        available ? undefined : perCapitaUnavailableLabel(perCapita.unavailable_reason)
      }
      valueTestId={available ? undefined : "landfill-per-capita-unavailable"}
      caption={
        <>
          {/* The served caveat is authoritative; PER_CAPITA_DESCRIPTION is only a
              fallback if an older backend omits it. */}
          <span className="block">{perCapita.caveat || PER_CAPITA_DESCRIPTION}</span>
          {available && (
            <span className="mt-1 block" data-testid="landfill-per-capita-periods">
              수수료 기준 {perCapita.fee_reference_period} · 인구 기준{" "}
              <span data-testid="landfill-population-month">
                {perCapita.population_reference_month ?? perCapita.population_reference_period}
              </span>{" "}
              (월말) · {(perCapita.population ?? 0).toLocaleString("en-US")}명
            </span>
          )}
          {!available && perCapita.required_population_month && (
            <span className="mt-1 block" data-testid="landfill-required-month">
              필요한 인구 기준월: {perCapita.required_population_month}
            </span>
          )}
          {/* Diagnostic only — shown solely for a reason code this build cannot
              translate, so an unrecognised enum is never the citizen's explanation
              yet is still recoverable from the page. */}
          {diagnosticCode && (
            <span className="mt-1 block" data-diagnostic data-testid="landfill-per-capita-code">
              기술 코드: {diagnosticCode}
            </span>
          )}
        </>
      }
    />
  );
}
