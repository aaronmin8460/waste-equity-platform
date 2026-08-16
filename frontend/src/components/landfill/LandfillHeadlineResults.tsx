"use client";

/**
 * 핵심 지표 — the headline row.
 *
 * ── The six concepts the Figma design asks for ─────────────────────────────────
 * 총 폐기물 발생량 · 총 시설 처리량 · 수도권매립지 반입량 · 공식 반입수수료 ·
 * 톤당 환산 수수료 · 주민 1인당 환산 수수료.
 *
 * ── The two totals, and the period they actually have ─────────────────────────
 * 발생량 and 처리량 are published as complete per-municipality official series
 * (RCIS `NTN007`/`NTN008`/`NTN018`/`NTN022`, and the facility-burden indicator).
 * No publisher issues a capital-region TOTAL for either, so the total is derived
 * here — an exact sum of those official rows, computed in
 * `lib/capitalRegionWaste.ts`, badged 계산값, and captioned with how many
 * municipalities it covers and what it excludes. It is never labelled a reported
 * figure.
 *
 * Their reference period is the SOURCE's, not the landfill filter's. The RCIS
 * series and the facility inventory are ANNUAL and currently 2024; the landfill
 * inbound series is monthly and currently through 2025. The Figma mock puts "2025"
 * on all four cards — that year is a mock, and pretending the four share one period
 * would be the false statement. Each card therefore states its own.
 *
 * The two totals also carry their ACCOUNTING BASIS on the card, because the single
 * most likely misuse of this row is dividing one by the other: generation is
 * origin-based, throughput is facility-location-based, and the served facility
 * envelope forbids combining them in its own `assumptions`.
 *
 * The three tonne/fee cards below are the SAME served values, formatters, and
 * provenance the dashboard has always shown. An unavailable value renders its
 * SERVED reason — never 0, never a placeholder, never a figure carried forward from
 * a previous selection.
 *
 * ── Prior-period comparison ───────────────────────────────────────────────────
 * The 전년 대비 deltas are computed from the SAME endpoint at the immediately
 * preceding comparable period (prior year for an annual view, the same month of the
 * prior year for a monthly one). A period the backend does not hold produces
 * "비교 자료 없음", never 0% — a missing comparison is not an unchanged value.
 */

import type { LandfillFeePerCapita, LandfillSummary } from "../../lib/api";
import type { CapitalRegionWaste, DerivedTotal } from "../../lib/capitalRegionWaste";
import { coverageSentence } from "../../lib/capitalRegionWaste";
import {
  formatEffectiveFee,
  formatKrwEok,
  formatKrwPerPerson,
  formatPercentChange,
  formatTonQuantity,
  formatTons,
  partialYearRange,
  percentChange,
  perCapitaUnavailableCode,
  perCapitaUnavailableLabel,
} from "../../lib/landfill";
import DataStatusBadge from "../ui/DataStatusBadge";
import KpiCard from "../ui/KpiCard";
import {
  CROSS_BASIS_NOTICE,
  EFFECTIVE_FEE_LABEL,
  FEE_CAVEAT,
  GENERATION_BASIS_NOTE,
  GENERATION_TOTAL_LABEL,
  PER_CAPITA_DESCRIPTION,
  PER_CAPITA_LABEL,
  POPULATION_BASIS_NOTE,
  TREATMENT_BASIS_NOTE,
  TREATMENT_TOTAL_LABEL,
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
  /**
   * The joined municipal model the two derived totals come from, already scoped to
   * the selected 출발 지역. `null` while the underlying series are still loading —
   * in which case the two cards state the absence rather than showing a zero.
   */
  capitalRegion: CapitalRegionWaste | null;
  /** The tier noun for the counted units in the coverage sentence (시·군·구 etc.). */
  tierNoun: string;
}

export default function LandfillHeadlineResults({
  summary,
  periodLabel,
  priorSummary,
  priorSettled,
  priorPeriodLabel,
  capitalRegion,
  tierNoun,
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
      {/* The visible 핵심 지표 label is gone: the Figma frame puts the KPI row
          directly under 조회 조건, and a heading that only repeats "these are the
          numbers" above four labelled numbers costs a line of the fold and tells a
          reader nothing. The heading itself REMAINS for the accessibility tree, so
          the region is still enumerable and still named. */}
      <div className="landfill-compact-headline-title mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="landfill-headline-heading" className="sr-only">
          핵심 지표
        </h2>
        {/* Scoped to the landfill pair BY NAME. It used to read as the period of the
            whole row, which was false the moment the two derived totals stated their
            own (2024) source year. */}
        <p className="text-xs text-ink-subtle">
          수도권매립지 기준 기간: <span className="font-medium text-ink-muted">{periodLabel}</span>
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
        <DerivedTotalKpi
          testId="landfill-kpi-generation"
          label={GENERATION_TOTAL_LABEL}
          basisNote={GENERATION_BASIS_NOTE}
          total={capitalRegion?.generation ?? null}
          tierNoun={tierNoun}
        />
        <DerivedTotalKpi
          testId="landfill-kpi-treatment"
          label={TREATMENT_TOTAL_LABEL}
          basisNote={TREATMENT_BASIS_NOTE}
          total={capitalRegion?.throughput ?? null}
          tierNoun={tierNoun}
        />
        <KpiCard
          size="hero"
          testId="landfill-kpi-quantity"
          label="수도권매립지 반입량"
          value={formatTons(summary.total_quantity_kg)}
          status={<DataStatusBadge status="reported" />}
          caption={
            <>
              {/* No 기준 기간 here. The strip directly above states the landfill
                  period ONCE, by name, for this card and the fee card beside it;
                  the two derived cards to the left keep their own because theirs is
                  a different year. */}
              <span className="block">공식 보고값</span>
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
      {/* One line, directly under the row it qualifies. The two derived totals are
          adjacent on screen and are both tonnages, which is precisely why the
          prohibition on dividing them has to be visible without expanding anything. */}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle" data-testid="landfill-kpi-basis-note">
        {CROSS_BASIS_NOTICE}
      </p>
    </section>
  );
}

/**
 * A headline total this platform DERIVES from the official per-municipality series.
 *
 * The arithmetic is an exact sum of served values (`lib/capitalRegionWaste.ts`), so
 * the figure is reproducible from the same endpoints the table below reads. It is
 * badged 계산값 rather than 공식 보고값 — no publisher issues this number — and its
 * caption states the source year, the accounting basis, how many municipalities
 * were counted, and anything excluded from the sum.
 *
 * With no value to sum (the series has not arrived, or the selection has no
 * municipalities) it shows the served-absence reason. The badge is then the neutral
 * 자료 없음 gray, not amber: amber cautions about a value that exists
 * (docs/ui-refresh/design-tokens.md §"Missing data").
 */
function DerivedTotalKpi({
  testId,
  label,
  basisNote,
  total,
  tierNoun,
}: {
  testId: string;
  label: string;
  basisNote: string;
  total: DerivedTotal | null;
  tierNoun: string;
}) {
  if (total == null || total.tons === null) {
    return (
      <KpiCard
        testId={testId}
        label={label}
        status={<DataStatusBadge status="missing" reason={UNBOUND_TOTAL_REASON} />}
        unavailableReason={UNBOUND_TOTAL_REASON}
        valueTestId={`${testId}-unavailable`}
        caption={
          <span className="block">
            시·군·구별 공식 {label.replace("총 ", "")} 자료를 아직 불러오지 못했습니다. 값이 0이라는
            뜻이 아닙니다.
          </span>
        }
      />
    );
  }
  return (
    <KpiCard
      testId={testId}
      label={label}
      value={formatTonQuantity(total.tons)}
      status={<DataStatusBadge status="derived" />}
      valueTestId={`${testId}-value`}
      caption={
        <>
          {/* The card's OWN period. It is deliberately not the landfill period: the
              RCIS and facility series are annual and currently a year behind. */}
          <span className="block" data-testid={`${testId}-period`}>
            기준 기간 {total.referenceYear != null ? `${total.referenceYear}년` : "확인 필요"} ·{" "}
            {basisNote}
          </span>
          <span className="mt-0.5 block" data-testid={`${testId}-coverage`}>
            {coverageSentence(total, tierNoun)}
          </span>
        </>
      }
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
  // Plain `.wep-card`, like the three `KpiCard`s beside it. `.wep-figma-card` is this
  // page's CONTENT-card treatment; giving it to one KPI tile and not the other three
  // (KpiCard is a shared primitive this lane does not change) would split the row
  // into two surfaces.
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
          {/* The provenance, without the period: the strip above states the landfill
               기준 기간 once for both official cards. The two derived cards to the
              left still carry theirs, because theirs is a different year. */}
          <p className="mt-1 text-xs text-ink-subtle" data-testid="landfill-fee-caveat">
            공식 보고값 · {FEE_CAVEAT}
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
