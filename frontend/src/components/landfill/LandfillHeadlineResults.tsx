"use client";

/**
 * 핵심 지표 — the headline row, rebuilt to the Figma page-2 frame (125:5064).
 *
 * ── The composition the frame asks for ────────────────────────────────────────
 * Four cards on one row, 261 · 261 · 261 · 561 wide. Card 1 is a FILLED navy card
 * carrying the largest figure on the screen; cards 2 and 3 are white; card 4 is
 * double-width and holds 폐기물 관리비용 as TWO columns — the official inbound fee
 * and the municipal collection/transport contract payment side by side, with the
 * `시·군·구별 상세 보기 →` affordance inside it.
 *
 * Every card has the same internal skeleton, which is what makes the row read as a
 * row: label + provenance badge → value → change pill → rule → a bottom slot pinned
 * with `mt-auto`. The bottom slot is pinned deliberately: the previous row let each
 * card's content sit at the top of a stretched grid cell, so three of the four cards
 * were ~170px of content in a 302px box and the row read as mostly empty.
 *
 * ── The two ratios the frame wants, and why one of them is not here ───────────
 * Figma fills the bottom slot of cards 2 and 3 with `발생량 대비 처리 규모 75.9%` and
 * `발생량 대비 반입 비율 39.4%`. Both divide origin-based generation by a
 * facility-location-based or destination-based tonnage. The served facility envelope
 * forbids that combination in its own `assumptions`, and it is the single misuse this
 * row is most likely to invite — so neither is implemented, at any size, under any
 * label. The visual slot is kept and filled truthfully instead:
 *
 *   · card 3 (반입량) shows the LARGEST ORIGIN'S SHARE of the inbound total. That
 *     ratio is served (`origin_shares[].quantity_share`) and its numerator and
 *     denominator are the same series on the same basis, so it is a real proportion
 *     and it fills the percentage + progress-bar slot exactly as the frame draws it;
 *   · card 2 (시설 처리량) has NO valid same-basis ratio available, so its slot
 *     carries the coverage statement — how many 시·군·구 the sum counted and what it
 *     excluded — rather than a percentage. A slot is left unfilled before it is
 *     filled with a number that means something else.
 *
 * `CROSS_BASIS_NOTICE` stays under the row for the same reason it was added: the two
 * derived totals are adjacent tonnages and the prohibition on dividing them has to be
 * legible without expanding anything.
 *
 * ── Periods ───────────────────────────────────────────────────────────────────
 * Each card states its OWN reference period where that period differs. The RCIS and
 * facility series are annual and currently a year behind the monthly landfill series;
 * the Figma mock puts one year on all four cards, and adopting that would be the false
 * statement. The landfill pair's shared period is stated once, by the 조회 조건 panel.
 *
 * ── Prior-period comparison ───────────────────────────────────────────────────
 * The 전년 대비 deltas come from the SAME endpoint at the immediately preceding
 * comparable period. A period the backend does not hold produces "비교 자료 없음",
 * never 0% — a missing comparison is not an unchanged value. The two derived totals
 * carry no delta at all: this platform does not fetch a prior-year RCIS sum, and the
 * frame's `2024 → 2025` comparison on card 1 is mock content, not a served figure.
 */

import type { LandfillFeePerCapita, LandfillOriginShare, LandfillSummary } from "../../lib/api";
import type { MunicipalCostResponse } from "../../lib/api";
import type { CapitalRegionWaste, DerivedTotal } from "../../lib/capitalRegionWaste";
import { coverageSentence } from "../../lib/capitalRegionWaste";
import {
  formatEffectiveFee,
  formatKrwEok,
  formatKrwPerPerson,
  formatPercentChange,
  formatShare,
  formatTonQuantity,
  formatTons,
  partialYearRange,
  percentChange,
  perCapitaUnavailableCode,
  perCapitaUnavailableLabel,
} from "../../lib/landfill";
import type { MunicipalCostErrorState } from "../../lib/municipalCost";
import { MUNICIPAL_COST_STATUSES, statusChoiceCount, statusLabel } from "../../lib/municipalCost";
import DataStatusBadge from "../ui/DataStatusBadge";
import {
  MUNICIPAL_COST_DETAIL_LINK_LABEL,
  MUNICIPAL_COST_DETAIL_TARGET_ID,
  MUNICIPAL_COST_DISTINCTION_TITLE,
  MUNICIPAL_COST_SUMMARY_TITLE,
} from "./municipalCostShared";
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

/** 폐기물 관리비용 — the Figma title for the combined cost card (card 4). */
const COST_CARD_TITLE = "폐기물 관리비용";
const OFFICIAL_FEE_LABEL = "반입 수수료";
const CONTRACT_PAYMENT_LABEL = "수집·운반 지급액";

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
  /**
   * The UNFILTERED municipal contract-payment response. It populates the right half
   * of the 폐기물 관리비용 card, which the Figma frame draws INSIDE this row rather
   * than as a separate block below it.
   *
   * It is deliberately a different dataset from everything else on this row and is
   * badged as such. No total is rendered from it — see `CostContractColumn`.
   *
   * Optional so a caller that is only exercising the official landfill values does not
   * have to construct a municipal envelope; omitted behaves exactly like "not yet
   * loaded", which the column already renders honestly rather than as a 0.
   */
  municipalCost?: MunicipalCostResponse | null;
  municipalCostError?: MunicipalCostErrorState | null;
}

export default function LandfillHeadlineResults({
  summary,
  periodLabel,
  priorSummary,
  priorSettled,
  priorPeriodLabel,
  capitalRegion,
  tierNoun,
  municipalCost = null,
  municipalCostError = null,
}: LandfillHeadlineResultsProps) {
  return (
    <section aria-labelledby="landfill-headline-heading" data-testid="landfill-headline">
      {/* The visible 핵심 지표 label is gone: the Figma frame puts the KPI row directly
          under 조회 조건, and a heading that only says "these are the numbers" above
          four labelled numbers costs a line of the fold. The heading REMAINS for the
          accessibility tree, so the region is still enumerable and still named.

          The 기준 기간 strip that used to sit here is gone too — the 조회 조건 panel
          states the selected period, and repeating it 24px lower was this screen's
          most duplicated string. `periodLabel` is still consumed below by the
          screen-reader description of the landfill pair. */}
      <h2 id="landfill-headline-heading" className="sr-only">
        핵심 지표
      </h2>
      {/* The landfill pair's period and, when the year is incomplete, the range it
          ACTUALLY covers. Screen-reader only: the 조회 조건 card states the served
          period visibly one card above, so printing it again here was the page's most
          duplicated string — but a partial year is a WARNING, not a restatement, so it
          also renders visibly below, inside the card whose value it qualifies. */}
      <p className="sr-only">수도권매립지 기준 기간: {periodLabel}</p>
      {/* Figma 125:5106 — three equal cards plus the double-width cost card.
          KpiCard-style <dt>/<dd> pairs, so this consumer owns the <dl>. */}
      <dl
        data-testid="landfill-kpis"
        className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_2.15fr]"
      >
        <DerivedTotalKpi
          testId="landfill-kpi-generation"
          label={GENERATION_TOTAL_LABEL}
          basisNote={GENERATION_BASIS_NOTE}
          total={capitalRegion?.generation ?? null}
          tierNoun={tierNoun}
          /* Figma card 1 is the filled navy card and carries the largest figure. */
          tone="hero"
        />
        <DerivedTotalKpi
          testId="landfill-kpi-treatment"
          label={TREATMENT_TOTAL_LABEL}
          basisNote={TREATMENT_BASIS_NOTE}
          total={capitalRegion?.throughput ?? null}
          tierNoun={tierNoun}
          tone="plain"
        />
        <InboundQuantityKpi
          summary={summary}
          priorSummary={priorSummary}
          priorSettled={priorSettled}
          priorPeriodLabel={priorPeriodLabel}
        />
        <CostCard
          summary={summary}
          priorSummary={priorSummary}
          priorSettled={priorSettled}
          priorPeriodLabel={priorPeriodLabel}
          municipalCost={municipalCost}
          municipalCostError={municipalCostError}
        />
      </dl>
      {/* One line, directly under the row it qualifies. The two derived totals are
          adjacent on screen and are both tonnages, which is precisely why the
          prohibition on dividing them has to be visible without expanding anything. */}
      <p
        className="mt-2 text-[11px] leading-relaxed text-ink-subtle"
        data-testid="landfill-kpi-basis-note"
      >
        {CROSS_BASIS_NOTICE}
      </p>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Card shell
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The one card skeleton every tile on this row uses.
 *
 * `tone="hero"` is the Figma navy fill. It is a PRESENTATION tone only — it never
 * changes what the card is allowed to say, and the card it is applied to still shows
 * its own provenance badge and its own coverage. On the navy fill the muted ink
 * tokens would fall under contrast, so the hero variant switches to white and a
 * white-alpha scale rather than reusing `--color-ink-*`.
 */
function CardShell({
  tone,
  testId,
  children,
}: {
  tone: "hero" | "plain";
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        tone === "hero"
          ? "flex h-full flex-col rounded-card bg-brand p-4 text-white"
          : "wep-card flex h-full flex-col"
      }
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** Label + provenance badge — the `<dt>` every card opens with. */
function CardLabel({ tone, children, badge }: { tone: "hero" | "plain"; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <dt
      className={`flex items-start justify-between gap-2 text-xs font-medium ${
        tone === "hero" ? "text-white/80" : "text-ink-subtle"
      }`}
    >
      <span className="min-w-0">{children}</span>
      {badge ? <span className="flex-none">{badge}</span> : null}
    </dt>
  );
}

/** The card's headline figure. Rendered verbatim — never re-parsed or rounded. */
function CardValue({
  tone,
  children,
  testId,
}: {
  tone: "hero" | "plain";
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <dd
      /* `text-3xl` on exactly one card. The row keeps the platform's one-hero rule —
         a reader gets a single entry point — but the Figma frame moves WHICH card
         holds it: 총 폐기물 발생량 is the filled navy card carrying the largest figure,
         where this row previously made 수도권매립지 반입량 the hero. Emphasis is fill +
         size together, never colour alone. */
      className={`mt-1 font-bold tabular-nums ${
        tone === "hero" ? "text-3xl leading-tight text-white" : "text-2xl text-ink"
      }`}
      data-testid={testId}
    >
      {children}
    </dd>
  );
}

/**
 * The rule + bottom slot, pinned to the foot of the card with `mt-auto` so every
 * card in the row breaks at the same place regardless of how much its top half says.
 */
function CardFoot({ tone, children }: { tone: "hero" | "plain"; children: React.ReactNode }) {
  return (
    <div
      className={`mt-auto border-t pt-2 ${tone === "hero" ? "border-white/25" : "border-hairline"}`}
    >
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Cards 1 & 2 — the derived totals
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * A headline total this platform DERIVES from the official per-municipality series.
 *
 * The arithmetic is an exact sum of served values (`lib/capitalRegionWaste.ts`), so
 * the figure is reproducible from the same endpoints the table below reads. It is
 * badged 계산값 rather than 공식 보고값 — no publisher issues this number — and its
 * foot states the source year, the accounting basis, how many municipalities were
 * counted, and anything excluded from the sum.
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
  tone,
}: {
  testId: string;
  label: string;
  basisNote: string;
  total: DerivedTotal | null;
  tierNoun: string;
  tone: "hero" | "plain";
}) {
  // An early return rather than a ternary: it is what narrows `total.tons` to a
  // string for the branch below, and it keeps the unavailable card — which must never
  // inherit the hero fill — physically separate from the one that shows a value.
  if (total == null || total.tons === null) {
    return (
      <CardShell tone="plain" testId={testId}>
        <CardLabel
          tone="plain"
          badge={<DataStatusBadge status="missing" reason={UNBOUND_TOTAL_REASON} />}
        >
          {label}
        </CardLabel>
        <dd className="mt-1 text-sm text-ink-muted" data-testid={`${testId}-unavailable`}>
          {UNBOUND_TOTAL_REASON}
        </dd>
        <CardFoot tone="plain">
          <p className="text-[11px] leading-relaxed text-ink-subtle">
            시·군·구별 공식 {label.replace("총 ", "")} 자료를 아직 불러오지 못했습니다. 값이 0이라는
            뜻이 아닙니다.
          </p>
        </CardFoot>
      </CardShell>
    );
  }
  return (
    <CardShell tone={tone} testId={testId}>
      <CardLabel
        tone={tone}
        badge={
          tone === "hero" ? (
            // On the navy fill the shared badge's light surface would vanish, so the
            // hero states its provenance as a white-alpha chip. Same word, and it keeps
            // `data-status` so the provenance stays machine-identifiable exactly as the
            // shared badge's is — the fill is a tone change, not a downgrade in what the
            // card declares about where its number came from.
            <span
              className="rounded-pill bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white"
              data-status="derived"
            >
              계산값
            </span>
          ) : (
            <DataStatusBadge status="derived" />
          )
        }
      >
        {label}
      </CardLabel>

      <CardValue tone={tone} testId={`${testId}-value`}>
        {formatTonQuantity(total.tons)}
      </CardValue>
      <CardFoot tone={tone}>
        {/* The card's OWN period. Deliberately not the landfill period: the RCIS
            and facility series are annual and currently a year behind. */}
        <p
          className={`text-[11px] font-medium ${tone === "hero" ? "text-white/85" : "text-ink-muted"}`}
          data-testid={`${testId}-period`}
        >
          기준 기간 {total.referenceYear != null ? `${total.referenceYear}년` : "확인 필요"} ·{" "}
          {basisNote}
        </p>
        <p
          className={`mt-0.5 text-[11px] leading-relaxed ${
            tone === "hero" ? "text-white/70" : "text-ink-subtle"
          }`}
          data-testid={`${testId}-coverage`}
        >
          {coverageSentence(total, tierNoun)}
        </p>
      </CardFoot>
    </CardShell>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Card 3 — the official inbound quantity
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * 수도권매립지 반입량 — the official reported total, with the frame's percentage +
 * progress-bar slot filled by the largest origin's SHARE OF THAT SAME TOTAL.
 *
 * The share is served (`origin_shares[].quantity_share`) and is printed verbatim; the
 * bar is scaled from it and never reconstructs the displayed figure. Both sides of the
 * ratio are the same series on the same accounting basis, which is the whole reason
 * this is allowed where the frame's `발생량 대비 반입 비율` is not.
 */
function InboundQuantityKpi({
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
  const top = topOriginShare(summary.origin_shares);
  const share = top?.quantity_share ?? null;
  const ratio = share === null ? null : clampRatio(Number(share));
  return (
    <CardShell tone="plain" testId="landfill-kpi-quantity">
      <CardLabel tone="plain" badge={<DataStatusBadge status="reported" />}>
        수도권매립지 반입량
      </CardLabel>
      <CardValue tone="plain">{formatTons(summary.total_quantity_kg)}</CardValue>
      {/* The provenance in words beside the badge. No 기준 기간 here — the 조회 조건
          line states the served period once for both official cards. */}
      <p className="mt-1 text-[11px] text-ink-subtle">공식 보고값</p>
      <YoyDelta
        testId="landfill-yoy-quantity"
        change={percentChange(summary.total_quantity_kg, priorSummary?.total_quantity_kg ?? null)}
        settled={priorSettled}
        priorPeriodLabel={priorPeriodLabel}
      />
      {/* A partial year is a WARNING about the value directly above it, not a period
          restatement, so it stays VISIBLE on the card even though the plain period
          moved to the 조회 조건 line. `available_through_month` alone reads as
          January-through-that-month, which is false whenever a year's records begin
          late — so the lower bound comes from the same served month list as the upper. */}
      {!summary.period.is_complete_year && (
        <p className="mt-1 text-[11px] leading-snug text-warn" data-testid="landfill-partial-year">
          부분 연도 ({partialYearRange(summary.period) ??
            `${summary.period.available_through_month ?? "?"}까지`}
          ) — 연간 합계가 아닙니다
        </p>
      )}
      <CardFoot tone="plain">
        {top === null || ratio === null ? (
          <p className="text-[11px] leading-relaxed text-ink-subtle">
            지역별 구성 비율 자료가 없습니다.
          </p>
        ) : (
          <div data-testid="landfill-kpi-top-origin">
            <p className="flex items-baseline justify-between gap-2 text-[11px] text-ink-subtle">
              {/* Named precisely. This is a share OF THE INBOUND TOTAL, not a share of
                  anything generated — the label has to close that gap by itself. */}
              <span className="min-w-0 truncate">반입량 최대 지역 · {top.origin_name}</span>
              <span className="flex-none text-sm font-bold tabular-nums text-ink">
                {formatShare(top.quantity_share)}
              </span>
            </p>
            <div
              aria-hidden
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
            >
              <div className="h-full rounded-pill bg-brand" style={{ width: `${ratio * 100}%` }} />
            </div>
          </div>
        )}
      </CardFoot>
    </CardShell>
  );
}

/** The largest served origin by quantity. `null` when nothing was served. */
function topOriginShare(shares: readonly LandfillOriginShare[]): LandfillOriginShare | null {
  let best: LandfillOriginShare | null = null;
  for (const s of shares) {
    if (best === null || Number(s.quantity_tons) > Number(best.quantity_tons)) best = s;
  }
  return best;
}

/**
 * Bar width only. `Number()` is permitted here because the result scales a CSS width
 * and NEVER reconstructs a displayed value — the percentage on screen is always the
 * served string, formatted.
 */
function clampRatio(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

/* ────────────────────────────────────────────────────────────────────────────
   Card 4 — 폐기물 관리비용
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The double-width cost card the Figma frame draws as ONE surface with two columns:
 * the official landfill inbound fee, and the municipal collection/transport contract
 * payment. Before this pass they were two separate blocks 130px apart, which is the
 * arrangement most likely to be read as one running total.
 *
 * Putting them in one card makes the distinction a LAYOUT problem rather than a
 * paragraph: two titled columns, each with its own provenance badge, separated by a
 * rule, with the contract column stating in its own words that it is a different
 * dataset. Neither column ever shows the other's unit, and no figure spans the rule.
 */
function CostCard({
  summary,
  priorSummary,
  priorSettled,
  priorPeriodLabel,
  municipalCost,
  municipalCostError,
}: {
  summary: LandfillSummary;
  priorSummary: LandfillSummary | null;
  priorSettled: boolean;
  priorPeriodLabel: string;
  municipalCost: MunicipalCostResponse | null;
  municipalCostError: MunicipalCostErrorState | null;
}) {
  return (
    <div className="wep-card flex h-full flex-col" data-testid="landfill-kpi-fee">
      <p className="text-sm font-bold text-ink">{COST_CARD_TITLE}</p>
      <div className="mt-2 flex flex-1 flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-4">
        <CostFeeColumn
          summary={summary}
          priorSummary={priorSummary}
          priorSettled={priorSettled}
          priorPeriodLabel={priorPeriodLabel}
        />
        <div aria-hidden className="hidden w-px flex-none self-stretch bg-hairline sm:block" />
        <CostContractColumn data={municipalCost} error={municipalCostError} />
      </div>
    </div>
  );
}

/**
 * The official inbound fee, and the two conversions derived from it.
 *
 * The two smaller figures are not independent measurements — they are this column's
 * own official amount divided by a tonnage and by a population — so they sit under it
 * rather than beside it, and each still carries its own 계산값 badge.
 */
function CostFeeColumn({
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
    <div className="flex min-w-0 flex-col sm:flex-1">
      <CardLabel tone="plain" badge={<DataStatusBadge status="reported" />}>
        {OFFICIAL_FEE_LABEL}
      </CardLabel>
      {/* Not the hero size: 반입량 stays the ONE dominant number on this screen,
          because it is what every surface below decomposes. */}
      <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">
        {formatKrwEok(summary.total_inbound_fee_krw)}
      </dd>
      {/* The scope caveat, and it is load-bearing precisely BECAUSE this card is now
          titled 폐기물 관리비용: the figure above is the reported inbound charge, not a
          transport cost and not a total waste-management budget. No 기준 기간 here —
          the 조회 조건 line states the served period once. */}
      <p className="mt-1 text-[11px] leading-snug text-ink-subtle" data-testid="landfill-fee-caveat">
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
      {/* The two conversions. Their labels WRAP rather than truncate: at this column
          width `주민 1인당 환산 반입수수료` clipped to `주민 1인…`, which turns a
          precisely-scoped label — the word that says this is a per-resident CONVERSION
          and not a bill — into an ellipsis. A label a reader cannot finish is worse
          than a second line. The badge sits under the label, on the value's row, so the
          label has the full column to itself. */}
      <div className="mt-auto border-t border-hairline pt-2">
        <div className="grid grid-cols-2 gap-x-3">
          <div>
            {/* The badge sits with the LABEL, not inside the value: a `<dd>` whose
                text is a served unavailability reason must read as exactly that reason
                and nothing else. The label wraps rather than truncating — at this
                column width `주민 1인당 환산 반입수수료` clipped to `주민 1인…`, which
                turns the word that says this is a per-resident CONVERSION and not a
                bill into an ellipsis. */}
            <dt className="flex flex-wrap items-center gap-x-1 text-[11px] leading-snug text-ink-subtle">
              <span>{EFFECTIVE_FEE_LABEL}</span>
              <DataStatusBadge status="derived" />
            </dt>
            <dd
              className="mt-0.5 text-sm font-semibold tabular-nums text-ink"
              data-testid="landfill-kpi-effective-fee"
            >
              {formatEffectiveFee(summary.effective_fee_per_ton)}
            </dd>
          </div>
          <PerCapitaFigure perCapita={summary.fee_per_capita} />
        </div>
        {/* The per-resident provenance spans BOTH columns rather than sitting inside
            the narrow right cell: at ~120px it wrapped to eight lines and became the
            tallest thing in the card. It stays visible rather than moving to a tooltip
            — the denominator, its month, and the population count are what make the
            conversion checkable, and 지역 지표 divides by a different series. */}
        <PerCapitaProvenance perCapita={summary.fee_per_capita} />
      </div>
    </div>
  );
}

/**
 * The municipal contract-payment column.
 *
 * ── Why there is no 총 지급액 here ──────────────────────────────────────────────
 * The Figma card fills this column with `총 지급액 (합계) 5,812.6 억원` and a
 * 톤당/1인당 pair derived from it. This platform does NOT publish that total, and the
 * omission is deliberate: only a subset of the 66 기초지자체 disclosed an amount, so a
 * "합계" would be a partial sum wearing a complete label — the same rule
 * `LandfillRegionTable` enforces by showing a coverage count on a metropolitan row.
 * A 톤당 지급액 is refused for a second reason: the only tonnage on this screen is
 * landfill INBOUND at 시·도 grain, and dividing a municipal contract payment by it
 * would combine the two accounting bases this page exists to keep apart.
 *
 * So the column states the dataset's SCOPE — reference year and how many
 * municipalities fall in each served status — and hands the reader to the section
 * holding the values. Every count comes from `meta`, computed by the backend over the
 * published scope; none is counted from rendered rows, and before a response arrives
 * the column says so rather than showing a 0.
 *
 * The affordance is a same-page `<a>` rather than a scripted scroll: it works with
 * keyboard, with middle-click, and with JavaScript off, and because the target heading
 * carries `tabIndex={-1}` the browser moves FOCUS there, not just the viewport.
 */
function CostContractColumn({
  data,
  error,
}: {
  data: MunicipalCostResponse | null;
  error: MunicipalCostErrorState | null;
}) {
  const meta = data?.meta ?? null;
  return (
    <div
      className="flex min-w-0 flex-col sm:w-[15rem] sm:flex-none"
      data-testid="municipal-cost-kpi-summary"
    >
      <CardLabel
        tone="plain"
        badge={
          meta ? (
            <span className="wep-chip" data-testid="municipal-cost-summary-year">
              {meta.reference_year}
            </span>
          ) : null
        }
      >
        {CONTRACT_PAYMENT_LABEL}
      </CardLabel>
      {/* One line, and it is the distinction — this column's whole risk is that it
          sits a rule away from 반입 수수료 and gets read as more of the same money. */}
      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-subtle">
        {MUNICIPAL_COST_SUMMARY_TITLE} · {MUNICIPAL_COST_DISTINCTION_TITLE}
      </p>

      {meta === null ? (
        <p className="mt-2 text-[11px] text-ink-subtle" data-testid="municipal-cost-kpi-summary-state">
          {/* Never a 0 and never a dash that could be read as one. The no-error wording
              covers a request still in flight AND one that failed quietly (the
              unfiltered fetch this column counts from is deliberately silent — see
              `app/page.tsx` — because the section below reports the failure with its
              own retryable message). Both are "not yet known". */}
          {error
            ? "지급액 자료를 불러오지 못했습니다. 아래 상세 섹션에서 다시 확인할 수 있습니다."
            : "집계 범위를 아직 불러오지 못했습니다. 값이 0이라는 뜻이 아닙니다."}
        </p>
      ) : (
        <dl
          className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]"
          data-testid="municipal-cost-kpi-coverage"
        >
          <Count term="대상 지자체" value={statusChoiceCount(meta, null)} />
          {MUNICIPAL_COST_STATUSES.map((status) => (
            <Count
              key={status}
              term={statusLabel(status)}
              value={statusChoiceCount(meta, status)}
              testId={`municipal-cost-kpi-count-${status.toLowerCase()}`}
            />
          ))}
        </dl>
      )}

      {/* Always offered, even while the dataset is loading or failed: the section it
          points at is always rendered, and its own states are the honest place to meet
          a loading or a failed request. */}
      <a
        className="wep-btn-quiet mt-auto w-full justify-center pt-0 text-center"
        href={`#${MUNICIPAL_COST_DETAIL_TARGET_ID}`}
        data-testid="municipal-cost-detail-link"
      >
        {MUNICIPAL_COST_DETAIL_LINK_LABEL}
      </a>
    </div>
  );
}

/** One served count. Renders nothing at all rather than a 0 it has not been given. */
function Count({ term, value, testId }: { term: string; value: number | null; testId?: string }) {
  if (value === null) return null;
  return (
    <div>
      <dt className="text-ink-subtle">{term}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink" data-testid={testId}>
        {value}곳
      </dd>
    </div>
  );
}

/**
 * The per-resident conversion — label and value only. It shows a value solely when the
 * backend derived one from a same-period population; otherwise it shows the served
 * reason. It never claims a resident payment or tax burden.
 *
 * Its provenance (caveat, population basis, both reference periods) is rendered by
 * `PerCapitaProvenance` below the two-column pair, so those lines get the card's full
 * width instead of wrapping inside a ~120px cell.
 */
function PerCapitaFigure({ perCapita }: { perCapita: LandfillFeePerCapita }) {
  const available = perCapita.fee_per_capita_krw !== null;
  return (
    <div data-testid="landfill-kpi-per-capita">
      <dt className="flex flex-wrap items-center gap-x-1 text-[11px] leading-snug text-ink-subtle">
        <span>{PER_CAPITA_LABEL}</span>
        {available ? (
          <DataStatusBadge status="derived" />
        ) : (
          <DataStatusBadge
            status="missing"
            reason={perCapitaUnavailableLabel(perCapita.unavailable_reason)}
          />
        )}
      </dt>
      {/* Never 0원: an absent denominator is not a zero fee, and this `<dd>` reads as
          the served reason alone — no badge text folded in beside it. */}
      <dd
        className={
          available
            ? "mt-0.5 text-sm font-semibold tabular-nums text-ink"
            : "mt-0.5 text-[11px] text-ink-muted"
        }
        data-testid={available ? undefined : "landfill-per-capita-unavailable"}
      >
        {available
          ? formatKrwPerPerson(perCapita.fee_per_capita_krw)
          : perCapitaUnavailableLabel(perCapita.unavailable_reason)}
      </dd>
    </div>
  );
}

/**
 * Where the per-resident conversion's numerator and denominator came from.
 *
 * Kept VISIBLE rather than folded into a tooltip: the denominator's month and size are
 * what let a reader reproduce the figure, and the basis note is the only thing stopping
 * a per-resident number here from being compared with the per-resident numbers on
 * 지역 지표, which divide by a different (SGIS annual) series.
 */
function PerCapitaProvenance({ perCapita }: { perCapita: LandfillFeePerCapita }) {
  const available = perCapita.fee_per_capita_krw !== null;
  const diagnosticCode = perCapitaUnavailableCode(perCapita.unavailable_reason);
  return (
    <p className="mt-1.5 text-[10px] leading-[1.35] text-ink-subtle">
      {/* The served caveat is authoritative; PER_CAPITA_DESCRIPTION is only a
          fallback if an older backend omits it. */}
      <span className="block">{perCapita.caveat || PER_CAPITA_DESCRIPTION}</span>
      {/* The population BASIS, stated on the page that uses it. */}
      <span className="mt-0.5 block" data-testid="landfill-population-basis">
        {POPULATION_BASIS_NOTE}
      </span>
      {available && (
        <span className="mt-0.5 block" data-testid="landfill-per-capita-periods">
          수수료 기준 {perCapita.fee_reference_period} · 인구 기준{" "}
          <span data-testid="landfill-population-month">
            {perCapita.population_reference_month ?? perCapita.population_reference_period}
          </span>{" "}
          (월말) · {(perCapita.population ?? 0).toLocaleString("en-US")}명
        </span>
      )}
      {!available && perCapita.required_population_month && (
        <span className="mt-0.5 block" data-testid="landfill-required-month">
          필요한 인구 기준월: {perCapita.required_population_month}
        </span>
      )}
      {/* Diagnostic only — shown solely for a reason code this build cannot translate,
          so an unrecognised enum is never the citizen's explanation yet is still
          recoverable from the page. */}
      {diagnosticCode && (
        <span className="mt-0.5 block" data-diagnostic data-testid="landfill-per-capita-code">
          기술 코드: {diagnosticCode}
        </span>
      )}
    </p>
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
      <p className="mt-1 text-[11px] text-ink-subtle" data-testid={testId}>
        {priorPeriodLabel} 비교 자료를 확인하는 중입니다.
      </p>
    );
  }
  if (change === null) {
    return (
      <p className="mt-1 text-[11px] text-ink-subtle" data-testid={testId}>
        {priorPeriodLabel} 비교 자료 없음 (변화 없음이라는 뜻이 아닙니다)
      </p>
    );
  }
  const rising = change > 0;
  return (
    <p className="mt-1">
      <span
        className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
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
    </p>
  );
}
