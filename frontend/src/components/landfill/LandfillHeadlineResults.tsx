"use client";

/**
 * 핵심 지표 — the headline row.
 *
 * ── The six concepts the Figma design asks for ─────────────────────────────────
 * 총 폐기물 발생량 · 총 시설 처리량 · 수도권매립지 반입량 · 공식 반입수수료 ·
 * 톤당 환산 수수료 · 주민 1인당 환산 수수료.
 *
 * FOUR of them are bound to served values. The first two are NOT, and they say so.
 * This platform holds waste generation and facility throughput as official
 * PER-REGION, PER-STREAM series (RCIS `NTN007`/`NTN008`/…, and the facility-burden
 * indicator); no source publishes a single capital-region total, and adding the
 * series together in the browser would manufacture a statistic no publisher stands
 * behind — the one thing repo AGENTS.md forbids outright. So those two cards carry an
 * honest unavailable state that names what the platform DOES hold and where to read
 * it, rather than a number that would look official and be ours.
 *
 * The three tonne/fee cards below are the SAME served values, formatters, and
 * provenance the dashboard has always shown. Nothing here computes a quantity: every
 * figure is the backend's own decimal string put through `lib/landfill.ts`, and an
 * unavailable value renders its SERVED reason — never 0, never a placeholder, never a
 * figure carried forward from a previous selection.
 *
 * ── Prior-period comparison ───────────────────────────────────────────────────
 * The 전년 대비 deltas are computed from the SAME endpoint at the immediately
 * preceding comparable period (prior year for an annual view, the same month of the
 * prior year for a monthly one). A period the backend does not hold produces
 * "비교 자료 없음", never 0% — a missing comparison is not an unchanged value.
 */

import type { LandfillFeePerCapita, LandfillSummary } from "../../lib/api";
import {
  formatEffectiveFee,
  formatKrwEok,
  formatKrwPerPerson,
  formatPercentChange,
  formatTons,
  partialYearRange,
  percentChange,
  perCapitaUnavailableCode,
  perCapitaUnavailableLabel,
} from "../../lib/landfill";
import DataStatusBadge from "../ui/DataStatusBadge";
import KpiCard from "../ui/KpiCard";
import {
  EFFECTIVE_FEE_LABEL,
  FEE_CAVEAT,
  PER_CAPITA_DESCRIPTION,
  PER_CAPITA_LABEL,
  POPULATION_BASIS_NOTE,
  UNBOUND_TOTAL_REASON,
} from "./shared";

export interface LandfillHeadlineResultsProps {
  summary: LandfillSummary;
  periodLabel: string;
  /**
   * The immediately preceding comparable period, when the backend served one.
   * `null` means either "still being fetched" (`priorSettled` false) or "the
   * backend holds no record for that period" (`priorSettled` true).
   */
  priorSummary: LandfillSummary | null;
  priorSettled: boolean;
  /** How the prior period is described in the delta's own words, e.g. `2024년 3월`. */
  priorPeriodLabel: string;
}

export default function LandfillHeadlineResults({
  summary,
  periodLabel,
  priorSummary,
  priorSettled,
  priorPeriodLabel,
}: LandfillHeadlineResultsProps) {
  const period = summary.period;
  // A partial year is stated as the range it ACTUALLY covers. `available_through_month`
  // alone reads as January-through-that-month, which is false whenever a year's records
  // begin late; the lower bound comes from the same served month list as the upper one.
  const partialRange = partialYearRange(period);
  const delta = (current: string | null, previous: string | null) => ({
    change: percentChange(current, previous),
    settled: priorSettled,
  });

  return (
    <section aria-labelledby="landfill-headline-heading" data-testid="landfill-headline">
      <div className="landfill-compact-headline-title mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="landfill-headline-heading" className="text-base font-bold text-ink">
          핵심 지표
        </h2>
        <p className="text-xs text-ink-subtle">
          기준 기간: <span className="font-medium text-ink-muted">{periodLabel}</span>
          {!period.is_complete_year && (
            <span data-testid="landfill-partial-year" className="ml-1 text-warn">
              · 부분 연도 ({partialRange ?? `${period.available_through_month ?? "?"}까지`}) — 연간
              합계가 아닙니다
            </span>
          )}
        </p>
      </div>
      {/* Figma 125:5106 — three equal cards plus a wider combined fee card. KpiCard
          renders <dt>/<dd> pairs, so the consumer owns the <dl>. */}
      <dl
        data-testid="landfill-kpis"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.6fr]"
      >
        <UnboundTotalKpi
          testId="landfill-kpi-generation"
          label="총 폐기물 발생량"
          detail="공식 발생량은 지역별·폐기물 계열별로만 공표되며, 이를 하나로 더한 공식 총계는 없습니다. 아래 지역별 비교에서 계열별 값을 확인할 수 있습니다."
        />
        <UnboundTotalKpi
          testId="landfill-kpi-treatment"
          label="총 시설 처리량"
          detail="시설 처리량은 시설 소재지 기준의 지역별 지표로만 제공되며, 이를 합산한 공식 총계는 없습니다. 아래 지역별 비교에서 지역 단위 값을 확인할 수 있습니다."
        />
        <KpiCard
          size="hero"
          testId="landfill-kpi-quantity"
          label="수도권매립지 반입량"
          value={formatTons(summary.total_quantity_kg)}
          status={<DataStatusBadge status="reported" />}
          caption={
            <>
              <span className="block">공식 보고값 · 기준 기간 {periodLabel}</span>
              <YoyDelta
                testId="landfill-yoy-quantity"
                {...delta(summary.total_quantity_kg, priorSummary?.total_quantity_kg ?? null)}
                priorPeriodLabel={priorPeriodLabel}
              />
            </>
          }
        />
        <FeeCard
          summary={summary}
          priorSummary={priorSummary}
          priorSettled={priorSettled}
          priorPeriodLabel={priorPeriodLabel}
        />
      </dl>
    </section>
  );
}

/**
 * A Figma headline concept this platform cannot serve as one number.
 *
 * Rendered rather than dropped, because silently omitting it would hide the gap; and
 * rendered WITHOUT a value, because the alternative — a browser-side sum of official
 * per-region series — would put a figure on screen that no publisher issued. The
 * badge is the neutral 자료 없음 gray, not amber: amber cautions about a value that
 * exists (docs/ui-refresh/design-tokens.md §"Missing data").
 */
function UnboundTotalKpi({
  testId,
  label,
  detail,
}: {
  testId: string;
  label: string;
  detail: string;
}) {
  return (
    <KpiCard
      testId={testId}
      label={label}
      status={<DataStatusBadge status="missing" reason={UNBOUND_TOTAL_REASON} />}
      unavailableReason={UNBOUND_TOTAL_REASON}
      valueTestId={`${testId}-unavailable`}
      caption={<span className="block">{detail}</span>}
    />
  );
}

/**
 * The 수수료 card — Figma 234:441 puts the official fee and the two conversions
 * derived from it in ONE card, separated by a rule.
 *
 * That grouping is exactly right for this data and is kept: the two smaller figures
 * are not independent measurements, they are this card's own official amount divided
 * by a tonnage and by a population. Each still carries its own 계산값 badge, because a
 * single card-level badge would have had to lie about half the card.
 */
function FeeCard({
  summary,
  priorSummary,
  priorSettled,
  priorPeriodLabel,
}: {
  summary: LandfillSummary;
  priorSummary: LandfillSummary | null;
  priorSettled: boolean;
  priorPeriodLabel: string;
}) {
  return (
    <div className="wep-card" data-testid="landfill-kpi-fee">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-4">
        <div className="min-w-0 sm:flex-1">
          <dt className="flex items-start justify-between gap-2 text-xs font-medium text-ink-subtle">
            <span className="min-w-0">공식 반입수수료</span>
            <span className="flex-none">
              <DataStatusBadge status="reported" />
            </span>
          </dt>
          {/* `text-xl`, not the hero `text-3xl`: 반입량 stays the ONE dominant number
              on this screen, because it is what every other surface below
              decomposes. (The Figma mock sizes all four headline figures equally;
              the platform's established one-hero rule is kept instead — two heroes
              give a reader no entry point.) */}
          <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">
            {formatKrwEok(summary.total_inbound_fee_krw)}
          </dd>
          <p className="mt-1 text-xs text-ink-subtle" data-testid="landfill-fee-caveat">
            {FEE_CAVEAT}
          </p>
          <YoyDelta
            testId="landfill-yoy-fee"
            change={percentChange(
              summary.total_inbound_fee_krw,
              priorSummary?.total_inbound_fee_krw ?? null,
            )}
            settled={priorSettled}
            priorPeriodLabel={priorPeriodLabel}
          />
        </div>

        <div aria-hidden className="hidden w-px flex-none self-stretch bg-hairline sm:block" />

        <div className="flex min-w-0 flex-col gap-3 sm:w-[15rem] sm:flex-none">
          <div>
            <dt className="flex items-center justify-between gap-2 text-xs text-ink-subtle">
              <span className="min-w-0">{EFFECTIVE_FEE_LABEL}</span>
              <span className="flex-none">
                <DataStatusBadge status="derived" />
              </span>
            </dt>
            <dd
              className="mt-0.5 text-lg font-semibold tabular-nums text-ink"
              data-testid="landfill-kpi-effective-fee"
            >
              {formatEffectiveFee(summary.effective_fee_per_ton)}
            </dd>
          </div>
          <PerCapitaFigure perCapita={summary.fee_per_capita} />
        </div>
      </div>
    </div>
  );
}

/**
 * The per-resident conversion. It shows a value only when the backend derived one
 * from a same-period population; otherwise it shows the served reason. It never
 * claims a resident payment or tax burden.
 */
function PerCapitaFigure({ perCapita }: { perCapita: LandfillFeePerCapita }) {
  const available = perCapita.fee_per_capita_krw !== null;
  const diagnosticCode = perCapitaUnavailableCode(perCapita.unavailable_reason);
  return (
    <div data-testid="landfill-kpi-per-capita">
      <dt className="flex items-center justify-between gap-2 text-xs text-ink-subtle">
        <span className="min-w-0">{PER_CAPITA_LABEL}</span>
        <span className="flex-none">
          {available ? (
            <DataStatusBadge status="derived" />
          ) : (
            <DataStatusBadge
              status="missing"
              reason={perCapitaUnavailableLabel(perCapita.unavailable_reason)}
            />
          )}
        </span>
      </dt>
      {/* Never 0원: an absent denominator is not a zero fee. */}
      <dd
        className={
          available
            ? "mt-0.5 text-lg font-semibold tabular-nums text-ink"
            : "mt-0.5 text-sm text-ink-muted"
        }
        data-testid={available ? undefined : "landfill-per-capita-unavailable"}
      >
        {available
          ? formatKrwPerPerson(perCapita.fee_per_capita_krw)
          : perCapitaUnavailableLabel(perCapita.unavailable_reason)}
      </dd>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
        {/* The served caveat is authoritative; PER_CAPITA_DESCRIPTION is only a
            fallback if an older backend omits it. */}
        <span className="block">{perCapita.caveat || PER_CAPITA_DESCRIPTION}</span>
        {/* The population BASIS, stated on the page that uses it. 지역 지표 divides by
            the SGIS annual series instead, so a reader comparing per-resident figures
            across the two screens must be told they do not share a denominator. */}
        <span className="mt-1 block" data-testid="landfill-population-basis">
          {POPULATION_BASIS_NOTE}
        </span>
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
            translate, so an unrecognised enum is never the citizen's explanation yet
            is still recoverable from the page. */}
        {diagnosticCode && (
          <span className="mt-1 block" data-diagnostic data-testid="landfill-per-capita-code">
            기술 코드: {diagnosticCode}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * 전년 대비 — the change against the immediately preceding comparable period.
 *
 * Three distinct states, and none of them is a zero. While the prior period is still
 * being fetched it says so; when the backend holds no record for that period it says
 * THAT, because "no comparison exists" and "no change" are different facts and only
 * one of them is 0%.
 *
 * The arrow is decorative — the sign is already in the text — so it is aria-hidden and
 * direction is never carried by colour alone.
 */
function YoyDelta({
  change,
  settled,
  priorPeriodLabel,
  testId,
}: {
  change: number | null;
  settled: boolean;
  priorPeriodLabel: string;
  testId: string;
}) {
  if (!settled) {
    return (
      <span className="mt-1 block text-[11px] text-ink-subtle" data-testid={testId}>
        {priorPeriodLabel} 비교 자료를 확인하는 중입니다.
      </span>
    );
  }
  if (change === null) {
    return (
      <span className="mt-1 block text-[11px] text-ink-subtle" data-testid={testId}>
        {priorPeriodLabel} 비교 자료 없음 (변화 없음이라는 뜻이 아닙니다)
      </span>
    );
  }
  const rising = change > 0;
  return (
    <span
      className={`mt-1 inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
        rising
          ? "bg-danger-surface text-danger"
          : change < 0
            ? "bg-success-surface text-success"
            : "bg-surface-muted text-ink-muted"
      }`}
      data-testid={testId}
    >
      <span aria-hidden>{rising ? "↑" : change < 0 ? "↓" : "→"}</span>
      {priorPeriodLabel} 대비 {formatPercentChange(change)}
    </span>
  );
}
