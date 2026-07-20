"use client";

/**
 * Full-width capital-region Sudokwon Landfill inbound dashboard (수도권매립지).
 *
 * This mode deliberately renders **no map**. The official source reports inbound
 * quantity and fee per metropolitan unit (서울시/인천시/경기도) only; it declares
 * no municipal origin, no route, and no destination coordinate. The previous
 * schematic straight-line map implied a movement path the data does not support,
 * so it was removed rather than re-labelled — see
 * docs/CAPITAL_REGION_LANDFILL_FLOW_IMPLEMENTATION.md.
 *
 * Every KPI, table row, trend, and comparison here is driven by the same four
 * filters. Official reported values and derived values are labelled separately,
 * and an unavailable derived value shows its served reason — never 0.
 *
 * ── Phase 5 (desktop redesign, docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §9) ──────────
 * Presentation only. No request scoping, denominator selection, served value,
 * unit, period rule, or comparability rule changed. What changed:
 *   - the full-bleed amber limitation block (defect L1) became ONE compact
 *     `tone="info"` InfoBanner carrying the same sentence verbatim, so the values
 *     — not the caveat — are the most prominent thing on a values page;
 *   - KPI value/label/explanation hierarchy is now the shared `KpiCard` (value
 *     `text-xl` semibold, explanation `text-xs` caption — never the reverse);
 *   - "no official record for these filters" is a distinct EmptyState, no longer
 *     rendered through the red `role="alert"` error panel (defect L4);
 *   - the origin-comparison and waste-composition bars became redundant visual
 *     encodings of the SAME exact text already shown, normalised only within the
 *     rows on screen;
 *   - long provenance/methodology/limitation prose moved into collapsed
 *     `Accordion`s. The `role="status"` live regions stay OUTSIDE them (§5 rule 9).
 */

import { useMemo } from "react";

import type {
  LandfillComposition,
  LandfillFeePerCapita,
  LandfillOrigin,
  LandfillSummary,
  LandfillTrends,
} from "../lib/api";
import { accountingBasisLabel } from "../lib/glossary";
import type { LandfillUnavailableState } from "../lib/landfill";
import {
  formatDecimalExact,
  formatEffectiveFee,
  formatKrwEok,
  formatKrwPerPerson,
  formatShare,
  formatTons,
  perCapitaUnavailableCode,
  perCapitaUnavailableLabel,
} from "../lib/landfill";
import Accordion from "./ui/Accordion";
import EmptyState from "./ui/EmptyState";
import InfoBanner from "./ui/InfoBanner";
import KpiCard from "./ui/KpiCard";
import Skeleton from "./ui/Skeleton";

export interface LandfillDashboardData {
  summary: LandfillSummary;
  trends: LandfillTrends;
  composition: LandfillComposition;
}

// Korean-only primary labels (Phase 5): the English parentheticals that used to
// ride along — 서울시 (Seoul), 연도 (Year), 출발 광역지자체 (Origin) — were the
// duplication documented as defect G3. The English terms are not lost; they remain
// in the served payload, in the evidence disclosures, and in the test ids.
const ORIGIN_OPTIONS: { code: LandfillOrigin; label: string }[] = [
  { code: "11", label: "서울시" },
  { code: "28", label: "인천시" },
  { code: "41", label: "경기도" },
];

// The metric name is fixed product copy: it must never read as an amount a
// resident actually paid or was taxed.
const PER_CAPITA_LABEL = "주민 1인당 환산 반입수수료";
const PER_CAPITA_DESCRIPTION =
  "선택 기간의 공식 반입수수료를 동일 기간 기준의 해당 지역 인구로 나눈 분석용 환산값입니다. " +
  "개인의 실제 납부액이 아닙니다.";
const LIMITATION_NOTICE =
  "광역지자체 단위 자료이며 시·군·구별 이동 경로나 실제 운송 경로를 의미하지 않습니다.";
// Fallback label only; the served population_source_id is authoritative.
const MOIS_SOURCE_ID = "mois_resident_population";
const FEE_CAVEAT =
  "반입수수료는 공식 보고된 금액이며 순수 운송비 또는 전체 폐기물 관리비가 아닙니다.";
/**
 * The orientation sentence under the <h1>. It states the scope precisely and
 * claims nothing the dataset cannot support: no real-time figure, no resident
 * bill, and no waste flow outside what the corporation reports as inbound.
 */
const HEADER_SUMMARY =
  "서울 · 인천 · 경기에서 수도권매립지로 반입된 공식 반입량과 반입수수료를 선택한 기간과 조건으로 보여줍니다.";
/**
 * The standing banner's second line. It states the four things a reader has to
 * know before reading any number, and it is deliberately NOT role="alert": a
 * permanent disclaimer that interrupts a screen reader on every render stops
 * being read (components/ui/InfoBanner.tsx).
 */
const PERIOD_NOTICE =
  "공식 자료가 있는 기간만 표시하며 일부 연도는 부분 자료입니다. " +
  "수수료와 1인당 환산값은 같은 기간의 공식 자료가 있을 때만 계산되고, " +
  "자료가 없는 값은 0이 아니라 자료 없음으로 표시합니다.";

export interface LandfillDashboardProps {
  data: LandfillDashboardData | null;
  /**
   * Why there is nothing to show. Phase 5 replaced the previous `error: string`:
   * the backend distinguishes "no official record for these filters" from a
   * genuine failure, and rendering both as one red alert was defect L4.
   */
  unavailable: LandfillUnavailableState | null;
  year: number | null;
  setYear: (y: number | null) => void;
  month: number | null;
  setMonth: (m: number | null) => void;
  origin: LandfillOrigin | null;
  setOrigin: (o: LandfillOrigin | null) => void;
  waste: string | null;
  setWaste: (w: string | null) => void;
  /**
   * Years the backend has said it holds, owned by the page so they SURVIVE a failed
   * or empty response.
   *
   * Deriving them from `data` alone stranded the reader: a request that returned no
   * official record nulls `data`, which emptied the year `<select>` down to its
   * default — while the no-data panel was simultaneously saying "자료가 있는 연도:
   * 2023, 2024. 다른 연도를 선택해 주세요". The years the reader was told to pick were
   * the ones the control no longer offered.
   *
   * Retaining them is honest rather than stale: `available_years` describes the
   * DATASET, not the current filter combination, so it does not change with the
   * selection. It is only ever populated from a served response.
   */
  availableYears: number[];
  /**
   * Waste-type options, likewise owned by the page so the control stays operable
   * through a load or an empty answer. These ARE filter-scoped (year + origin), so
   * a retained option can turn out to have no rows — in which case the backend
   * answers "no official record" honestly rather than the UI guessing.
   */
  wasteOptions: string[];
  /**
   * The highest month the selected year actually covers (12 for a complete year).
   *
   * Page-owned for the same reason as the year list: deriving it from `data` widened
   * it back to 12 during every filter transition, so a partial year's 기간 control
   * briefly offered months the dataset does not cover — and a month picked in that
   * window would blank the select once the real bound returned.
   */
  maxMonth: number;
  /**
   * The area's one-line orientation strip, supplied by the page. It renders inside
   * this view's header, directly BELOW the <h1> it supports — the same position it
   * occupies in the other three areas. (Rendering it above the dashboard instead
   * would leave a stray sentence between the global navigation and the page title,
   * reading as a second navigation row.)
   */
  orientation?: React.ReactNode;
}

export default function LandfillDashboard({
  data,
  unavailable,
  year,
  setYear,
  month,
  setMonth,
  origin,
  setOrigin,
  waste,
  setWaste,
  availableYears,
  wasteOptions,
  maxMonth,
  orientation,
}: LandfillDashboardProps) {

  return (
    // Phase 1: the shared chrome (components/DashboardShell.tsx) now owns the single
    // <main id="main-content" tabIndex={-1}> skip-link target and the viewport-height
    // fallbacks for every view, so this dashboard is a plain content block. Two
    // <main> elements — or two id="main-content" targets — would be invalid and would
    // make the skip link ambiguous.
    <div className="w-full px-4 pt-6 pb-12 sm:px-6 lg:px-8" data-testid="landfill-dashboard">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        {/* The mode selector is rendered by the page above this component. */}
        <header>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">수도권매립지 반입 현황</h1>
          <p className="mt-1 text-sm text-ink-muted">{HEADER_SUMMARY}</p>
          {orientation}
        </header>

        {/* Phase 5 AC1: ONE compact neutral banner replaces the full-bleed amber
            block. The metropolitan-only sentence is preserved verbatim; the detailed
            caveats live in the 한계와 주의사항 disclosure rather than being repeated
            in a second coloured panel. */}
        <InfoBanner tone="info" title="자료 범위" testId="landfill-limitation">
          <p>{LIMITATION_NOTICE}</p>
          <p className="mt-1 text-xs">{PERIOD_NOTICE}</p>
        </InfoBanner>

        <LandfillFilters
          availableYears={availableYears}
          year={year}
          setYear={setYear}
          month={month}
          setMonth={setMonth}
          maxMonth={maxMonth}
          origin={origin}
          setOrigin={setOrigin}
          waste={waste}
          setWaste={setWaste}
          wasteOptions={wasteOptions}
        />

        {/* A genuine failure the reader can retry — the only role="alert" here. */}
        {unavailable?.kind === "error" && <LandfillError state={unavailable} />}

        {/* The backend answered: it holds no official record for these filters.
            That is data, not a fault, so it is NOT an alert and shows no zeros. */}
        {unavailable?.kind === "no-data" && <LandfillNoData state={unavailable} />}

        {data === null && unavailable === null && <LandfillLoading />}

        {data && <LandfillBody data={data} />}
      </div>
    </div>
  );
}

/**
 * Initial load and every filter transition.
 *
 * The skeleton is decorative and `aria-hidden`; the meaningful announcement stays
 * in the separate `role="status"` line (components/ui/Skeleton.tsx contract). It
 * renders neutral bars only — never a placeholder digit that could be mistaken for
 * an official quantity, and never a zero-filled KPI.
 */
function LandfillLoading() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-muted" data-testid="landfill-loading" role="status">
        공식 반입 데이터를 불러오는 중입니다.
      </p>
      <div aria-hidden data-testid="landfill-loading-skeleton" className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="wep-card">
              <Skeleton lines={3} />
            </div>
          ))}
        </div>
        <div className="wep-card">
          <Skeleton lines={5} />
        </div>
      </div>
    </div>
  );
}

/** A genuine request/network/server failure. Actionable, so `role="alert"`. */
function LandfillError({ state }: { state: LandfillUnavailableState }) {
  return (
    <InfoBanner tone="error" role="alert" title="자료를 불러오지 못했습니다" testId="landfill-error">
      <p className="font-medium text-ink">{state.message}</p>
      <p className="mt-1 text-xs">
        공식 데이터를 불러오지 못하면 값을 표시하지 않습니다. 이전 조건의 값을 그대로 두거나 대체
        데이터를 사용하지 않습니다. 잠시 후 다시 시도하거나 다른 조건을 선택해 주세요.
      </p>
      {/* Diagnostic only. The backend code is retained (redesign plan §5 rule 12)
          but is never the citizen's explanation. */}
      {state.detail && (
        <p className="mt-1 text-xs text-ink-subtle" data-diagnostic data-testid="landfill-error-detail">
          기술 정보: {state.detail}
        </p>
      )}
    </InfoBanner>
  );
}

/**
 * The backend served a 404 "no official record" answer for these filters.
 *
 * Distinct from {@link LandfillError} on purpose: it is not a fault, it is not an
 * alert, and it must never be filled with zero quantities or zero fees — an absent
 * record is not a measured zero (repo AGENTS.md; redesign plan §5 rules 2–3).
 */
function LandfillNoData({ state }: { state: LandfillUnavailableState }) {
  const years = state.availableYears;
  return (
    <>
      {/* Politely announced. The EmptyState itself carries no role — it is not an
          alert — but without SOME live region a screen-reader user who filters from
          a populated year to an empty one hears nothing at all as the whole results
          region is replaced. `role="status"` waits for a pause instead of
          interrupting, which is the right register for "there is nothing here". */}
      <p role="status" className="sr-only" data-testid="landfill-no-data-live">
        선택한 조건의 공식 반입 자료가 없습니다.
      </p>
      <EmptyState
        testId="landfill-no-data"
        title="선택한 조건의 공식 반입 자료가 없습니다."
        description={
          <>
            <span className="block">{state.message}</span>
            {/* Only rendered when the backend actually serves the list. Never
                invented — and the same list populates the 연도 control, so every
                year named here is one the reader can actually select. */}
            {years.length > 0 && (
              <span className="mt-1 block" data-testid="landfill-available-years">
                자료가 있는 연도: {years.join(", ")}
              </span>
            )}
            <span className="mt-1 block text-xs text-ink-subtle">
              값이 없는 기간은 0이 아니라 자료 없음으로 표시합니다. 다른 연도나 조건을 선택해
              주세요.
            </span>
            {state.detail && (
              <span
                className="mt-1 block text-xs text-ink-subtle"
                data-diagnostic
                data-testid="landfill-no-data-detail"
              >
                기술 정보: {state.detail}
              </span>
            )}
          </>
        }
      />
    </>
  );
}

/**
 * The 연도 options, newest first.
 *
 * The currently selected year is always included even when the served list does not
 * contain it. A native `<select>` whose `value` matches no `<option>` renders
 * **blank**, so selecting a year the backend then reports as empty would silently
 * erase the control's own state — the reader could no longer see what they had
 * asked for while being told to ask for something else. Including it reports the
 * user's own selection back to them; it asserts nothing about the data, and the
 * no-data panel alongside states plainly which years do have records.
 */
function yearOptions(availableYears: number[], selected: number | null): number[] {
  const years = new Set(availableYears);
  if (selected != null) years.add(selected);
  return [...years].sort((a, b) => b - a);
}

/**
 * The 기간 options: every month the selected year covers, plus the reader's own
 * selection if a narrower bound has since arrived. Same blank-select reasoning as
 * {@link yearOptions} — the control must never silently lose its own value.
 */
function monthOptions(maxMonth: number, selected: number | null): number[] {
  const months = new Set(Array.from({ length: maxMonth }, (_, index) => index + 1));
  if (selected != null) months.add(selected);
  return [...months].sort((a, b) => a - b);
}

function LandfillFilters({
  availableYears,
  year,
  setYear,
  month,
  setMonth,
  maxMonth,
  origin,
  setOrigin,
  waste,
  setWaste,
  wasteOptions,
}: {
  availableYears: number[];
  year: number | null;
  setYear: (y: number | null) => void;
  month: number | null;
  setMonth: (m: number | null) => void;
  maxMonth: number;
  origin: LandfillOrigin | null;
  setOrigin: (o: LandfillOrigin | null) => void;
  waste: string | null;
  setWaste: (w: string | null) => void;
  wasteOptions: string[];
}) {
  // Native <select>s throughout: they already give keyboard operation, type-ahead,
  // and the platform picker on touch. Phase 5 restyles the ROW, not the controls.
  const selectClass =
    "mt-1 min-h-[2.25rem] w-full rounded-control border border-hairline-strong bg-surface px-2 py-1.5 text-sm text-ink";
  const labelClass = "text-xs font-medium text-ink-muted";
  return (
    <section
      aria-label="조건 선택"
      data-testid="landfill-filters"
      // One desktop row from lg up (the four controls fit comfortably at 1280 and
      // 1440); two columns on tablets; stacked on phones. Nothing overflows the
      // page — the row wraps rather than scrolling sideways.
      className="wep-card grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <label className={labelClass}>
        연도
        <select
          className={selectClass}
          data-testid="landfill-year-select"
          value={year ?? ""}
          onChange={(event) => {
            setYear(event.target.value === "" ? null : Number(event.target.value));
            // A month from the previous year may not exist in the new one.
            setMonth(null);
          }}
        >
          <option value="">최신 완결연도</option>
          {yearOptions(availableYears, year).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        기간
        <select
          className={selectClass}
          data-testid="landfill-month-select"
          value={month ?? ""}
          onChange={(event) =>
            setMonth(event.target.value === "" ? null : Number(event.target.value))
          }
        >
          <option value="">연간</option>
          {monthOptions(maxMonth, month).map((m) => (
            <option key={m} value={m}>
              {m}월
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        출발 지역
        <select
          className={selectClass}
          data-testid="landfill-origin-select"
          value={origin ?? ""}
          onChange={(event) =>
            setOrigin(event.target.value === "" ? null : (event.target.value as LandfillOrigin))
          }
        >
          <option value="">전체</option>
          {ORIGIN_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        폐기물 종류
        <select
          className={selectClass}
          data-testid="landfill-waste-select"
          value={waste ?? ""}
          onChange={(event) => setWaste(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">전체</option>
          {/* Same reasoning as the year options: a selected type missing from the
              served list would blank the control rather than show the selection. */}
          {(waste != null && !wasteOptions.includes(waste)
            ? [waste, ...wasteOptions]
            : wasteOptions
          ).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

function LandfillBody({ data }: { data: LandfillDashboardData }) {
  const { summary, trends } = data;
  const period = summary.period;
  const periodLabel = `${period.year}년${
    period.month ? ` ${Number(period.month.slice(5, 7))}월` : " 연간"
  }`;
  const perCapita = summary.fee_per_capita;

  // Bar proportions only. `Number()` is permitted here because the result scales a
  // CSS width and NEVER reconstructs a displayed value (redesign plan §5 rule 10) —
  // every figure on screen is still the backend's exact string, formatted.
  const originMax = Math.max(0, ...summary.origin_shares.map((o) => Number(o.quantity_tons)));
  // The waste composition chart reads the SUMMARY's waste shares, which respond
  // to all four filters. (The /composition endpoint is scoped to year+origin and
  // is used only to populate the waste dropdown.)
  const wasteRows = useMemo(() => summary.top_waste_types.slice(0, 8), [summary.top_waste_types]);
  const wasteMax = Math.max(0, ...wasteRows.map((w) => Number(w.quantity_tons)));

  return (
    <>
      {/* Screen-reader status announced when a filter change loads new official
          values (the period + total-quantity text changes). Concise, so switching
          filters does not produce a verbose read-out. It sits OUTSIDE every
          accordion: a collapsed <details> is hidden from the accessibility tree and
          must not be the only home for a live region (redesign plan §5 rule 9). */}
      <p role="status" className="sr-only" data-testid="landfill-live">
        {periodLabel} 반입 자료를 표시합니다. 총 반입량 {formatTons(summary.total_quantity_kg)}.
      </p>
      <p className="text-xs text-ink-subtle">
        기준 기간: <span className="font-medium text-ink-muted">{periodLabel}</span>
        {!period.is_complete_year && (
          <span data-testid="landfill-partial-year" className="ml-1 text-warn">
            · 부분 연도 ({period.available_through_month ?? "?"}까지) — 연간 합계가 아닙니다
          </span>
        )}
      </p>

      <section aria-label="핵심 지표">
        {/* KpiCard renders <dt>/<dd> pairs, so the consumer owns the <dl>. */}
        <dl
          data-testid="landfill-kpis"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          <KpiCard
            testId="landfill-kpi-quantity"
            label="총 반입량"
            value={formatTons(summary.total_quantity_kg)}
            caption={<span className="block">공식 보고값 · 기준 기간 {periodLabel}</span>}
          />
          <KpiCard
            testId="landfill-kpi-fee"
            label="공식 반입수수료"
            value={formatKrwEok(summary.total_inbound_fee_krw)}
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
            caption={<span className="block">공식자료를 바탕으로 계산한 값입니다.</span>}
          />
          <PerCapitaKpi perCapita={perCapita} />
        </dl>
      </section>

      <RegionTable summary={summary} originMax={originMax} periodLabel={periodLabel} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <MiniBars
          title="월별 반입량"
          testId="landfill-trend-quantity"
          points={trends.points}
          pick={(point) => Number(point.quantity_tons)}
          format={(value) => `${Math.round(value).toLocaleString("en-US")} t`}
          // Lossless: the backend-served exact tons string, never rounded.
          exactFormat={(point) => `${formatDecimalExact(point.quantity_tons)} t`}
          yUnit="톤 (t)"
          color="#0d9488"
        />
        <MiniBars
          title="월별 공식 반입수수료"
          testId="landfill-trend-fee"
          points={trends.points}
          pick={(point) => Number(point.inbound_fee_krw) / 100_000_000}
          format={(value) => `${value.toFixed(1)}억원`}
          // Lossless: the exact served KRW fee (the chart's 억원 conversion would
          // round), so the "exact value" table/tooltip keep full precision.
          exactFormat={(point) => `${formatDecimalExact(point.inbound_fee_krw)}원`}
          yUnit="억원 (0.1B KRW)"
          color="#2563eb"
        />
        <ComparisonBars
          title="출발지 비교"
          testId="landfill-origin-comparison"
          caption={`기준 기간 ${periodLabel} · 반입량 기준`}
          rows={summary.origin_shares.map((share) => ({
            key: share.origin_region_code,
            label: share.origin_name,
            ratio: barRatio(share.quantity_tons, originMax),
            display: `${formatTons(share.quantity_kg)} · ${formatShare(share.quantity_share)}`,
          }))}
        />
        <ComparisonBars
          title="폐기물 구성"
          testId="landfill-waste-composition"
          caption={`기준 기간 ${periodLabel} · 반입량 상위 ${wasteRows.length}개 항목`}
          rows={wasteRows.map((share) => ({
            key: share.waste_name,
            label: share.waste_name,
            ratio: barRatio(share.quantity_tons, wasteMax),
            display: `${formatTons(share.quantity_kg)} · ${formatShare(share.quantity_share)}`,
          }))}
        />
      </div>

      <Evidence summary={summary} />
    </>
  );
}

/**
 * The bar's share of the widest row currently on screen, or `null` when there is
 * nothing honest to draw.
 *
 * This is a REDUNDANT VISUAL ENCODING of a value already printed as exact text
 * beside it — not a score, not a ranking, and not a new analytical output. It is
 * normalised only within the rows displayed, so it never implies a national or
 * historical reference point.
 *
 * `null` (no bar at all) when the value is unparseable or the set has no positive
 * maximum: drawing a zero-width bar there would assert an official zero the data
 * does not claim. A genuine `0` returns `0` and draws a genuinely empty track.
 */
function barRatio(tons: string, max: number): number | null {
  const value = Number(tons);
  if (!Number.isFinite(value) || value < 0) return null;
  // `max` must be guarded for finiteness too, not just sign: a single unparseable
  // row makes `Math.max(...)` NaN, and `NaN <= 0` is false. That would return NaN,
  // emit `width: NaN%`, be rejected by the CSSOM, and leave the bar at its `auto`
  // width — painting EVERY row full-width, the exact misreading this returns null
  // to avoid.
  if (!Number.isFinite(max) || max <= 0) return null;
  return value / max;
}

/**
 * The fourth KPI. It shows a value only when the backend derived one from a
 * same-period population; otherwise it shows the served reason. It never claims a
 * resident payment or tax burden.
 */
function PerCapitaKpi({ perCapita }: { perCapita: LandfillFeePerCapita }) {
  const available = perCapita.fee_per_capita_krw !== null;
  const diagnosticCode = perCapitaUnavailableCode(perCapita.unavailable_reason);
  return (
    <KpiCard
      testId="landfill-kpi-per-capita"
      label={PER_CAPITA_LABEL}
      value={available ? formatKrwPerPerson(perCapita.fee_per_capita_krw) : undefined}
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

/**
 * Exactly four columns: 지역 / 반입량 / 공식 반입수수료 / 주민 1인당 환산 반입수수료.
 * All origins → the three metropolitan rows; a specific origin → only that one.
 *
 * Phase 5 adds a decorative proportional rule under the 반입량 figure. It is
 * `aria-hidden` and carries no number of its own: the exact value stays the cell's
 * text, so removing the bar would lose nothing but visual scanning speed.
 */
function RegionTable({
  summary,
  originMax,
  periodLabel,
}: {
  summary: LandfillSummary;
  originMax: number;
  periodLabel: string;
}) {
  return (
    <section aria-label="지역별 반입 현황" data-testid="landfill-region-table">
      <h2 className="mb-2 text-base font-semibold text-ink">지역별 반입 현황</h2>
      {summary.origin_shares.length === 0 ? (
        <p className="text-xs text-ink-subtle" data-testid="landfill-region-empty">
          해당 조건의 반입 자료가 없습니다.
        </p>
      ) : (
        // The table owns its horizontal scrolling; the page body never scrolls
        // sideways because of it.
        <div className="overflow-x-auto rounded-card border border-hairline bg-surface">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">
              선택한 조건({periodLabel})의 광역지자체별 반입량, 공식 반입수수료, 주민 1인당 환산
              반입수수료
            </caption>
            <thead>
              <tr className="border-b border-hairline bg-surface-muted text-xs text-ink-muted">
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  지역
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  반입량
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  공식 반입수수료
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {PER_CAPITA_LABEL}
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.origin_shares.map((share) => {
                const perCapita = share.fee_per_capita;
                const value = perCapita.fee_per_capita_krw;
                const ratio = barRatio(share.quantity_tons, originMax);
                return (
                  <tr
                    key={share.origin_region_code}
                    className="border-b border-hairline last:border-0"
                    data-testid="landfill-region-row"
                  >
                    <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                      {share.origin_name}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {formatTons(share.quantity_kg)}
                      {ratio !== null && <ProportionRule ratio={ratio} align="right" />}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {formatKrwEok(share.inbound_fee_krw)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {value !== null ? (
                        formatKrwPerPerson(value)
                      ) : (
                        <>
                          {/* Never 0원: an absent denominator is not a zero fee. */}
                          <span className="text-warn" data-testid="landfill-row-unavailable">
                            {perCapitaUnavailableLabel(perCapita.unavailable_reason)}
                          </span>
                          {/* A reason code this build cannot translate must stay
                              recoverable from the page (redesign plan §5 rule 12).
                              Without this the row's code would be dropped entirely —
                              the label alone degrades to a bare "계산 불가". */}
                          {perCapitaUnavailableCode(perCapita.unavailable_reason) && (
                            <span className="block text-[11px] text-ink-subtle" data-diagnostic>
                              기술 코드: {perCapitaUnavailableCode(perCapita.unavailable_reason)}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * A decorative proportional rule. Purely a second encoding of the exact figure
 * printed beside it, hence `aria-hidden` — assistive technology reads the number.
 */
function ProportionRule({ ratio, align }: { ratio: number; align: "left" | "right" }) {
  return (
    <span aria-hidden className="mt-1 block h-1 w-full rounded-pill bg-surface-sunken">
      <span
        className={`block h-1 rounded-pill bg-primary ${align === "right" ? "ml-auto" : ""}`}
        style={{ width: `${Math.min(100, ratio * 100)}%` }}
      />
    </span>
  );
}

/**
 * Origin comparison / waste composition: a labelled row per item, the exact served
 * value as text, and a proportional bar that re-encodes that same value.
 *
 * The bar is never the only way a value is communicated, and a row whose ratio is
 * unavailable renders no track at all rather than an empty one that would read as
 * an official zero.
 */
function ComparisonBars({
  title,
  testId,
  caption,
  rows,
}: {
  title: string;
  testId: string;
  caption: string;
  rows: { key: string; label: string; ratio: number | null; display: string }[];
}) {
  return (
    <section aria-label={title} data-testid={testId} className="wep-card">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 mb-2 text-xs text-ink-subtle">{caption}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-subtle">해당 조건의 자료가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="flex justify-between gap-2 text-xs text-ink-muted">
                <span className="truncate">{row.label}</span>
                <span className="shrink-0 tabular-nums text-ink">{row.display}</span>
              </div>
              {row.ratio === null ? (
                <p className="mt-0.5 text-[11px] text-ink-subtle">비율 표시 불가</p>
              ) : (
                <ProportionRule ratio={row.ratio} align="left" />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MiniBars({
  title,
  testId,
  points,
  pick,
  format,
  exactFormat,
  yUnit,
  color,
}: {
  title: string;
  testId: string;
  points: LandfillTrends["points"];
  pick: (point: LandfillTrends["points"][number]) => number;
  /** Rounded chart-scale formatter, used only for the "최대" annotation. */
  format: (value: number) => string;
  /**
   * Lossless per-point value (with its own unit) from the exact backend string,
   * used for the hover tooltip and the accessible table so neither shows a value
   * rounded by the chart formatter.
   */
  exactFormat: (point: LandfillTrends["points"][number]) => string;
  /** The y-axis unit, shown in the axis caption. */
  yUnit: string;
  color: string;
}) {
  const width = 240;
  const height = 64;
  const count = points.length || 1;
  const barWidth = width / count;
  const max = Math.max(1, ...points.map(pick));
  const firstMonth = points[0]?.reference_month ?? "";
  const lastMonth = points[points.length - 1]?.reference_month ?? "";
  return (
    <section aria-label={title} data-testid={testId} className="wep-card">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {points.length === 0 ? (
        <p className="mt-1 text-xs text-ink-subtle">해당 기간의 자료가 없습니다.</p>
      ) : (
        <>
          {/* Axis + reference period caption, so the chart's y unit and time span
              are explicit and the fee/quantity units are never confused. */}
          <p className="mt-0.5 mb-2 text-xs text-ink-subtle" data-testid={`${testId}-axis`}>
            세로축 단위: <span className="font-medium">{yUnit}</span> · 기준 기간 {firstMonth} –{" "}
            {lastMonth}
          </p>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            // Phase 5 (defect X5): the SVG previously had no height, so with
            // `preserveAspectRatio="none"` its rendered height tracked the card
            // width and the chart ballooned on a wide desktop card. A fixed height
            // pins it; bars still encode value by HEIGHT alone, so widening the
            // card rescales bar WIDTH only and distorts no value.
            className="h-20 w-full"
            role="img"
            aria-label={`${title} — 세로축 단위 ${yUnit}, ${firstMonth}부터 ${lastMonth}까지의 월별 값`}
            preserveAspectRatio="none"
          >
            {points.map((point, index) => {
              const value = pick(point);
              const barHeight = (value / max) * (height - 2);
              return (
                <rect
                  key={point.reference_month}
                  x={index * barWidth + 0.5}
                  y={height - barHeight}
                  width={Math.max(1, barWidth - 1)}
                  height={barHeight}
                  fill={color}
                >
                  {/* Exact served value (lossless) in the hover tooltip. */}
                  <title>{`${point.reference_month}: ${exactFormat(point)}`}</title>
                </rect>
              );
            })}
          </svg>
          {/* Endpoint month labels for the x-axis (a per-bar label would be
              unreadable at 12 bars). */}
          <div className="mt-0.5 flex justify-between text-[10px] text-ink-subtle" aria-hidden>
            <span>{firstMonth}</span>
            <span>{lastMonth}</span>
          </div>
          <p className="text-[11px] text-ink-subtle">
            최대 {format(max)} · {points.length}개월 · 선택 연도 전체(월 필터 무관). 자료가 없는
            달은 막대를 그리지 않으며 0으로 채우지 않습니다.
          </p>
          {/* Accessible table fallback: the hover <title> tooltips are not reachable
              by touch or screen readers, so every month's exact value is available
              here as text. Collapsed by default (Phase 5 AC3) — it holds no live
              region, so collapsing it hides nothing that needs announcing. */}
          <div className="mt-2">
            <Accordion label="표로 보기 (월별 정확한 값)" testId={`${testId}-exact`}>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-left text-[11px]" data-testid={`${testId}-table`}>
                  <caption className="sr-only">{title} — 월별 정확한 값</caption>
                  <thead>
                    <tr className="text-ink-subtle">
                      <th scope="col" className="py-0.5 pr-3 font-medium">
                        월
                      </th>
                      <th scope="col" className="py-0.5 font-medium">
                        정확한 값
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={point.reference_month}>
                        <th scope="row" className="py-0.5 pr-3 font-normal text-ink-muted">
                          {point.reference_month}
                        </th>
                        {/* Lossless served value, not the chart-rounded formatter. */}
                        <td className="py-0.5 tabular-nums text-ink-muted">{exactFormat(point)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Accordion>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Provenance, methodology, comparability, and limitations.
 *
 * Phase 5 splits what was one dense panel into four collapsed disclosures. Nothing
 * was removed: every source id, snapshot date, reference period, definition
 * version, derivation formula, accounting basis, and served caveat still renders —
 * it is simply no longer competing with the values for attention. Raw enums stay,
 * but each now sits beside its plain-Korean name instead of standing alone.
 */
function Evidence({ summary }: { summary: LandfillSummary }) {
  const perCapita = summary.fee_per_capita;
  return (
    <section
      aria-label="근거와 한계"
      className="flex flex-col gap-2 text-xs text-ink-muted"
      data-testid="landfill-evidence"
    >
      <h2 className="text-base font-semibold text-ink">근거와 한계</h2>

      <Accordion label="자료와 기준 기간" testId="landfill-evidence-sources">
        {/* break-words: the served identifiers (e.g. the definition version
            MOIS_TOTAL_WITH_UNREGISTERED_RESIDENT_AND_OVERSEAS_NATIONALS) are long
            unbreakable ASCII tokens that would otherwise force the page to scroll
            sideways on a phone. */}
        <dl className="space-y-1 break-words">
          {summary.sources.map((source) => (
            <div key={source.dataset_id}>
              <dt className="inline font-medium">출처 {source.dataset_id}: </dt>
              <dd className="inline">
                {source.official_dataset_name} · 스냅샷{" "}
                <span data-testid="reference-period">{source.snapshot_date ?? "—"}</span>
              </dd>
            </div>
          ))}
          <div>
            <dt className="inline font-medium">수수료 기준 기간: </dt>
            <dd className="inline" data-testid="landfill-fee-period">
              {perCapita.fee_reference_period}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">인구 출처: </dt>
            <dd className="inline" data-testid="landfill-population-source">
              행정안전부 주민등록 인구통계 (행정동별 주민등록 인구 및 세대현황) ·{" "}
              {perCapita.population_source_id ?? MOIS_SOURCE_ID} · 기준 기간{" "}
              <span data-testid="landfill-population-period">
                {perCapita.population_reference_period ?? "해당 기간 자료 없음"}
              </span>
              {perCapita.population_temporal_granularity && (
                <> · {perCapita.population_temporal_granularity === "MONTHLY" ? "월간" : "연간"}</>
              )}
            </dd>
          </div>
          {perCapita.population_source_administrative_code && (
            <div>
              <dt className="inline font-medium">인구 행정구역 코드: </dt>
              <dd className="inline" data-testid="landfill-population-admin-code">
                {perCapita.population_source_administrative_code}
              </dd>
            </div>
          )}
          <div>
            <dt className="inline font-medium">인구 정의: </dt>
            <dd className="inline">
              {perCapita.population_definition ?? "—"}
              {perCapita.population_definition_version && (
                <> · {perCapita.population_definition_version}</>
              )}
            </dd>
          </div>
        </dl>
      </Accordion>

      <Accordion label="비교 가능성" testId="landfill-evidence-comparability">
        {/* The MOIS total-population definition changed twice inside the 2008–2026
            window, so a long-run comparison is not like-for-like. Disclosed with
            the data rather than only in the docs. */}
        <p data-testid="landfill-comparability-note">
          <strong className="text-ink">인구 정의 변경 안내:</strong> 주민등록 총인구의 정의는
          2010-10(거주불명자 포함)과 2015-01(재외국민 포함)에 변경되었습니다. 서로 다른 시기의 값을
          비교할 때는 정의 차이를 고려해야 하며, 완전히 동일한 기준의 시계열이 아닙니다. (외국인은
          모든 시기에서 제외됩니다.)
          {perCapita.population_comparability_note && (
            <span className="mt-1 block">{perCapita.population_comparability_note}</span>
          )}
        </p>
        <p className="mt-2">
          집계 기준: <span className="font-medium text-ink">{accountingBasisLabel(summary.accounting_basis)}</span>
          . 이 기준의 값은 발생지 기준·시설 소재지 기준 자료와 합치거나 비교할 수 없습니다.
        </p>
        <p className="mt-1" data-diagnostic data-testid="landfill-accounting-basis-code">
          기술 코드: {summary.accounting_basis}
        </p>
      </Accordion>

      <Accordion label="계산 방법" testId="landfill-evidence-method">
        <p className="font-medium text-ink">공식 보고값</p>
        <ul className="list-disc pl-4">
          <li>반입량</li>
          <li>반입수수료</li>
          <li>주민등록 인구 (행정안전부 · 월말 기준)</li>
        </ul>
        <p className="mt-2 font-medium text-ink">공식자료를 바탕으로 계산한 값</p>
        <ul className="list-disc pl-4">
          <li>월·연 집계 · 비중</li>
          <li>톤당 실효 수수료</li>
          <li>{PER_CAPITA_LABEL}</li>
        </ul>
        <dl className="mt-2 space-y-1 break-words">
          <div>
            <dt className="inline font-medium">산출식: </dt>
            <dd className="inline">{perCapita.derivation_formula}</dd>
          </div>
          <div>
            <dt className="inline font-medium">계산 방식 버전: </dt>
            <dd className="inline" data-diagnostic data-testid="landfill-derivation-version">
              {perCapita.derivation_version}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">반입 지표 계산 방식 버전: </dt>
            <dd className="inline" data-diagnostic>
              {summary.derivation_version}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">근거 표기: </dt>
            <dd className="inline" data-diagnostic>
              공식 보고값 {summary.evidence.quantity_status} · 계산값{" "}
              {summary.evidence.derived_status}
            </dd>
          </div>
        </dl>
      </Accordion>

      <Accordion label="한계와 주의사항" testId="landfill-limitation-details">
        <p>{LIMITATION_NOTICE}</p>
        <ul className="mt-2 list-disc space-y-1 pl-4" data-testid="landfill-caveats">
          {summary.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </Accordion>
    </section>
  );
}
