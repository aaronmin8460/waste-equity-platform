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
 * ── Figma page-2 redesign (frame 125:5064) ──────────────────────────────────────
 * Presentation and information architecture. No request scoping, denominator
 * selection, served value, unit, period rule, comparability rule, filter option, or
 * URL key changed. What the redesign added or moved:
 *   - the body follows the Figma reading order — 조회 조건 → 핵심 지표 →
 *     (발생·처리 비교 | 반입 구조) → (폐기물 구성 | 월별 추이) → 지역별 상세 현황 →
 *     공유 및 내보내기 → 근거와 한계;
 *   - 지역별 폐기물 발생과 처리 비교 is NEW and reads two indicators this platform
 *     already serves (`LandfillGenerationScatter`); it fetches nothing of its own;
 *   - the monthly trend became ONE chart with a metric switch instead of two;
 *   - the composition gained a donut and a full-view modal with a CSV of exactly
 *     what is on screen;
 *   - all four filters are KEPT. The design shows three, but the 출발 지역 filter
 *     scopes every value on the screen and deleting it would remove the only way to
 *     ask a per-origin question.
 *
 * The standing scope banner is still exactly ONE `tone="info"` InfoBanner carrying
 * the metropolitan-only sentence verbatim, and it is still the only banner on a
 * successful screen: a permanent caveat repeated in a second coloured panel stops
 * being read.
 *
 * The 시·군·구 수집·운반 계약 지급액 module is NOT in the Figma design and is NOT
 * removed. It is a real analytical surface over a separate published dataset; the
 * redesign lowers its visual priority (it sits last, after 근거와 한계) and changes
 * nothing about its filters, table, methodology, or limitations.
 */

import type {
  FacilityBurdenEnvelope,
  LandfillComposition,
  LandfillOrigin,
  LandfillSummary,
  LandfillTrends,
  ReportingPerCapitaEnvelope,
} from "../lib/api";
import type { LandfillUnavailableState } from "../lib/landfill";
import { formatTons } from "../lib/landfill";
import LandfillCompositionSection from "./landfill/LandfillCompositionSection";
import LandfillFilterPanel, {
  type LandfillSelectionOutcome,
} from "./landfill/LandfillFilterPanel";
import LandfillFlowStructure from "./landfill/LandfillFlowStructure";
import LandfillGenerationScatter from "./landfill/LandfillGenerationScatter";
import LandfillHeadlineResults from "./landfill/LandfillHeadlineResults";
import LandfillMethodology from "./landfill/LandfillMethodology";
import LandfillRegionTable from "./landfill/LandfillRegionTable";
import LandfillShareExport from "./landfill/LandfillShareExport";
import { LandfillError, LandfillLoading, LandfillNoData } from "./landfill/LandfillStates";
import LandfillTrendSection from "./landfill/LandfillTrendSection";
import type { MunicipalCostSectionProps } from "./landfill/MunicipalCostSection";
import MunicipalCostSection from "./landfill/MunicipalCostSection";
import {
  HEADER_SUMMARY,
  LIMITATION_NOTICE,
  PERIOD_NOTICE,
  periodLabelOf,
} from "./landfill/shared";
import InfoBanner from "./ui/InfoBanner";
import PageHeader from "./ui/PageHeader";

export interface LandfillDashboardData {
  summary: LandfillSummary;
  trends: LandfillTrends;
  composition: LandfillComposition;
}

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
   * The immediately preceding comparable period's summary, for the 전년 대비 deltas.
   * `null` with `priorSettled` false means "being fetched"; `null` with it true means
   * "the backend holds no record for that period" — which renders as 비교 자료 없음,
   * never as 0%.
   */
  priorSummary: LandfillSummary | null;
  priorSettled: boolean;
  /**
   * The two SERVED equity indicators the 발생·처리 비교 plots. Passed in because the
   * page already loads both for the 지역 지표 area — this view issues no request of
   * its own and adds no aggregate.
   */
  reportingPerCapita: ReportingPerCapitaEnvelope | null;
  facilityBurden: FacilityBurdenEnvelope | null;
  /**
   * The area's one-line orientation strip, supplied by the page. It renders inside
   * this view's header, directly BELOW the <h1> it supports — the same position it
   * occupies in the other three areas. (Rendering it above the dashboard instead
   * would leave a stray sentence between the global navigation and the page title,
   * reading as a second navigation row.)
   */
  orientation?: React.ReactNode;
  /**
   * The view's single `<h1>`, supplied by the page so it always equals the visible
   * navigation destination name (docs/YEOGIDA_UI_REDESIGN_SPEC.md §2.2). It was the
   * literal "수도권매립지 반입 현황", which no longer matches the destination this
   * dashboard renders for. That narrower scope statement is not lost — it stays in
   * `HEADER_SUMMARY`, directly below the title.
   */
  title: string;
  /**
   * The 2024 municipal collection/transport contract-payment section — a SEPARATE
   * analytical dataset from the official inbound fee above (see
   * `landfill/MunicipalCostSection.tsx`).
   *
   * Passed as one prop object rather than spread into this interface so the two
   * datasets' props cannot be confused at a call site, and so the official
   * landfill contract above stays exactly as it was.
   */
  municipalCost: MunicipalCostSectionProps;
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
  priorSummary,
  priorSettled,
  reportingPerCapita,
  facilityBurden,
  orientation,
  title,
  municipalCost,
}: LandfillDashboardProps) {
  // What the filter summary states. Derived from the props the page already hands
  // down — no second request state, and no classification of its own.
  const outcome: LandfillSelectionOutcome = data
    ? { kind: "data", periodLabel: periodLabelOf(data.summary.period) }
    : unavailable?.kind === "no-data"
      ? { kind: "no-data" }
      : unavailable?.kind === "error"
        ? { kind: "error" }
        : { kind: "loading" };

  return (
    // Phase 1: the shared chrome (components/DashboardShell.tsx) now owns the single
    // <main id="main-content" tabIndex={-1}> skip-link target and the viewport-height
    // fallbacks for every view, so this dashboard is a plain content block. Two
    // <main> elements — or two id="main-content" targets — would be invalid and would
    // make the skip link ambiguous.
    <div className="w-full px-4 pt-6 pb-12 sm:px-6 lg:px-8" data-testid="landfill-dashboard">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4">
        {/* The mode selector is rendered by the page above this component. */}
        <PageHeader title={title} description={HEADER_SUMMARY}>
          {orientation}
        </PageHeader>

        {/* ONE compact neutral banner. The metropolitan-only sentence is preserved
            verbatim; the detailed caveats live in the 한계와 주의사항 disclosure
            rather than being repeated in a second coloured panel. It is a standing
            statement of what this dataset covers, so it must stay visible without
            expanding anything — and must NOT be role="alert". */}
        <InfoBanner tone="info" title="자료 범위" testId="landfill-limitation">
          <p>{LIMITATION_NOTICE}</p>
          <p className="mt-1 text-xs">{PERIOD_NOTICE}</p>
        </InfoBanner>

        <LandfillFilterPanel
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
          outcome={outcome}
        />

        {/* A genuine failure the reader can retry — the only role="alert" here. */}
        {unavailable?.kind === "error" && <LandfillError state={unavailable} />}

        {/* The backend answered: it holds no official record for these filters.
            That is data, not a fault, so it is NOT an alert and shows no zeros. */}
        {unavailable?.kind === "no-data" && <LandfillNoData state={unavailable} />}

        {data === null && unavailable === null && <LandfillLoading />}

        {data && (
          <LandfillBody
            data={data}
            priorSummary={priorSummary}
            priorSettled={priorSettled}
            reportingPerCapita={reportingPerCapita}
            facilityBurden={facilityBurden}
          />
        )}

        {/* The 2024 municipal contract-payment comparison — a DIFFERENT dataset,
            rendered OUTSIDE the official-data branch above on purpose. The two are
            fetched independently and fail independently: an official 404 (which is
            what a fresh database returns) must not take this section down with it,
            and a failure here must not blank the official values. Its own banner
            states the distinction, and its heading names the unit and the year so
            the boundary between the two is visible without reading either. */}
        <MunicipalCostSection {...municipalCost} />
      </div>
    </div>
  );
}

/**
 * The values, in the Figma reading order: what the totals are → how the generation
 * and processing of each region compare and what the inbound is made of → how it
 * moved through the year → the exact figures → how to take them away → where they
 * came from and what they do not mean.
 */
function LandfillBody({
  data,
  priorSummary,
  priorSettled,
  reportingPerCapita,
  facilityBurden,
}: {
  data: LandfillDashboardData;
  priorSummary: LandfillSummary | null;
  priorSettled: boolean;
  reportingPerCapita: ReportingPerCapitaEnvelope | null;
  facilityBurden: FacilityBurdenEnvelope | null;
}) {
  const { summary, trends } = data;
  const periodLabel = periodLabelOf(summary.period);
  const priorPeriodLabel = priorPeriodLabelOf(summary);

  // Bar proportions only. `Number()` is permitted here because the result scales a
  // CSS width and NEVER reconstructs a displayed value (redesign plan §5 rule 10) —
  // every figure on screen is still the backend's exact string, formatted.
  const originMax = Math.max(0, ...summary.origin_shares.map((o) => Number(o.quantity_tons)));

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

      <LandfillHeadlineResults
        summary={summary}
        periodLabel={periodLabel}
        priorSummary={priorSummary}
        priorSettled={priorSettled}
        priorPeriodLabel={priorPeriodLabel}
      />

      {/* Figma Row2 — the comparison and the inbound structure side by side. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <LandfillGenerationScatter perCapita={reportingPerCapita} burden={facilityBurden} />
        </div>
        <div className="xl:col-span-5">
          <LandfillFlowStructure
            summary={summary}
            periodLabel={periodLabel}
            originMax={originMax}
          />
        </div>
      </div>

      {/* Figma Row3 — composition and the monthly trend side by side. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <LandfillCompositionSection summary={summary} periodLabel={periodLabel} />
        </div>
        <div className="xl:col-span-7">
          <LandfillTrendSection trends={trends} />
        </div>
      </div>

      <LandfillRegionTable summary={summary} originMax={originMax} periodLabel={periodLabel} />

      {/* The export sits INSIDE the official-fee block, above the methodology and
          well above the municipal section, so the files it produces are unmistakably
          the landfill-fee dataset (spec §4). */}
      <LandfillShareExport summary={summary} trends={trends} />

      <LandfillMethodology summary={summary} />
    </>
  );
}

/**
 * How the comparison period is named in the deltas.
 *
 * A monthly view compares against the SAME month of the prior year (the nearest
 * like-for-like period — the previous calendar month would compare a February against
 * a January); an annual view compares against the prior year.
 */
function priorPeriodLabelOf(summary: LandfillSummary): string {
  const { year, month } = summary.period;
  return month ? `${year - 1}년 ${Number(month.slice(5, 7))}월` : `${year - 1}년`;
}
