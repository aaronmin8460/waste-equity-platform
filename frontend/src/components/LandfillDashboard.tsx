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
 * ── Page-2 remediation ─────────────────────────────────────────────────────────
 * 1. NO standing notice banner. The screen previously opened with a coloured
 *    `자료 범위` panel carrying two permanent paragraphs, and the municipal section
 *    opened with a second coloured panel carrying two more. Between them they
 *    consumed the top of a presentation screen with text that never changes, which
 *    is how a permanent caveat stops being read. None of it is LOST — every
 *    sentence moved to where it is actually used:
 *      · the 시·도-grain limitation → the 지역별 상세 현황 note, beside the rows it
 *        governs, and 한계와 주의사항;
 *      · the period / "absent is not zero" rule → 한계와 주의사항;
 *      · the served contract-vs-inbound-fee distinction → the 계약 지급액 column
 *        group's own footnote, rendered verbatim at the point of use.
 *    Failure alerts, loading, and empty states are untouched — those are actionable
 *    and transient, which is exactly what a banner is for.
 *
 * 2. 총 폐기물 발생량 and 총 시설 처리량 now carry REAL values and REAL periods. They
 *    are exact sums of the official per-municipality series (`lib/capitalRegionWaste.ts`),
 *    badged 계산값, each stating its own source year — which is NOT the landfill
 *    year, and never the Figma mock's 2025.
 *
 * 3. 지역별 상세 현황 is now two-grain: the three metropolitan rows expand to their
 *    자치구 / 군·구 / 시·군, which is what the Figma frame asks for in writing. The
 *    2024 수집·운반 계약 지급액 appears on those municipal rows — the grain it is
 *    actually published on — as its own column group, never blended into the
 *    official inbound fee.
 *
 * The standalone 시·군·구 수집·운반 계약 지급액 module is KEPT below: it owns the
 * dataset's filters, source-file inventory, rejected-file list and methodology,
 * none of which belongs in a table cell. What it lost is its coloured banner.
 */

import { useMemo, useState } from "react";

import type {
  FacilityBurdenEnvelope,
  LandfillComposition,
  LandfillOrigin,
  LandfillSummary,
  LandfillTrends,
  MunicipalCostResponse,
  ReportingPerCapitaEnvelope,
  ReportingWasteStatisticsEnvelope,
} from "../lib/api";
import type { CapitalRegionWaste, MunicipalityRow } from "../lib/capitalRegionWaste";
import {
  buildCapitalRegionWaste,
  scopeOfLandfillOrigin,
} from "../lib/capitalRegionWaste";
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
import MunicipalCostSummary from "./landfill/MunicipalCostSummary";
import { periodLabelOf } from "./landfill/shared";
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
   * The official per-municipality generation series (RCIS reporting geography).
   * Already loaded by the page for the 지역 지표 area, so this view issues no
   * request of its own; it is the numerator of the 총 폐기물 발생량 total and of the
   * 발생량 columns in the municipal drill-down.
   */
  reportingStats: ReportingWasteStatisticsEnvelope | null;
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
   * dashboard renders for.
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
  /**
   * The UNFILTERED municipal contract-payment response, joined into the 지역별 상세
   * 현황 drill-down.
   *
   * Deliberately NOT `municipalCost.data`: that one is scoped by the section's own
   * 자료 상태 control, whose default is 계산 가능 — so it holds 38 of the 66
   * municipalities. A municipality filtered OUT of that section must never appear in
   * the table as though it had no data, and the metropolitan coverage counts must
   * describe the published scope rather than the current filter.
   */
  municipalCostAll: MunicipalCostResponse | null;
  /**
   * The 수도권-wide 반입수수료 per resident, from an UNFILTERED `landfill/summary`.
   *
   * The common second term of every municipality's 주민 1인당 폐기물 관리비용. It is a
   * PROP rather than a read off `data.summary` because that summary is scoped by the
   * 출발 지역 filter — with 서울 selected it serves Seoul's per-capita figure, and a
   * value the UI labels 수도권 공통 must not move when the reader narrows the view.
   * `null` while it loads, or when the backend served no per-capita value; it then
   * propagates as — rather than as a partial figure.
   */
  metroLandfillFeePerCapitaKrw?: string | null;
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
  reportingStats,
  facilityBurden,
  orientation,
  title,
  municipalCost,
  municipalCostAll,
  metroLandfillFeePerCapitaKrw = null,
}: LandfillDashboardProps) {
  /**
   * The two-grain capital-region model, scoped to the SAME 출발 지역 the landfill
   * values are scoped to — so the KPI row and the table describe one selection
   * rather than two. The crosswalk is not optional: the filter speaks
   * administrative sido codes (11/28/41) and every region row speaks SGIS
   * (11/23/31), so joining on the raw digits would silently empty 인천 and 경기.
   *
   * Built here, once, and handed to both consumers: two independent joins over the
   * same four envelopes would be two chances for the totals and the rows beneath
   * them to disagree.
   */
  /**
   * The 시·군·구별 지급액 상세 popup, opened from THREE places (기술요청 #8 / #21):
   * the KPI row's 폐기물 관리비용 card, a region name in 지역별 상세 현황, and the
   * municipal section's own button. One piece of state so two of them can never be
   * open at once, and so the region name can say WHICH municipality to highlight.
   */
  const [costDetail, setCostDetail] = useState<{ open: boolean; regionCode: string | null }>({
    open: false,
    regionCode: null,
  });

  const scope = scopeOfLandfillOrigin(origin);
  const capitalRegion: CapitalRegionWaste = useMemo(
    () =>
      buildCapitalRegionWaste({
        reportingStats,
        reportingPerCapita,
        facilityBurden,
        municipalCost: municipalCostAll,
        scope,
        metroLandfillFeePerCapitaKrw,
      }),
    [
      reportingStats,
      reportingPerCapita,
      facilityBurden,
      municipalCostAll,
      scope,
      metroLandfillFeePerCapitaKrw,
    ],
  );
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
    // `landfill-compact` scopes the short-desktop fold budget (globals.css). It is
    // inert at >=850px tall, so 1440×900 is unchanged; below that it tightens the
    // rhythm above the fold so the KPI row is visible without scrolling at
    // 1280×800. Nothing is hidden or removed at any height.
    <div
      className="landfill-compact w-full px-4 pt-6 pb-12 sm:px-6 lg:px-8"
      data-testid="landfill-dashboard"
    >
      <div className="landfill-compact-stack mx-auto flex w-full max-w-screen-2xl flex-col gap-4">
        {/* The mode selector is rendered by the page above this component.

            NO `description`. The area's orientation strip renders directly below the
            <h1> and already says what this screen is for; the header description was
            a second sentence in the same voice, one line apart, restating it with
            more words ("서울 · 인천 · 경기에서 수도권매립지로 반입된 공식 반입량과
            반입수수료를 선택한 기간과 조건으로 보여줍니다"). The three facts it added
            beyond the orientation are all still on the screen as VALUES rather than
            prose: the origins are the 출발 지역 filter and the three table rows, the
            fee is its own KPI, and the period is the 조회 조건 selection. */}
        {/* NO orientation strip. The Figma page-2 frame opens directly on the 조회 조건
            card — it carries no page title and no supporting sentence, because every
            fact the sentence offered ("수도권매립지 반입량과 지역별 흐름을 확인합니다")
            is a VALUE on the screen a moment later: the inbound total is a KPI, the
            per-region flow is a card of its own, and the period is the 조회 조건
            selection.

            The <h1> itself STAYS, compact. Dropping it would leave the view without a
            heading and would break the rule that the visible title always equals the
            navigation destination name (docs/YEOGIDA_UI_REDESIGN_SPEC.md §2.2); that
            is an accessibility floor the frame is not authoritative over. `orientation`
            is still accepted so the page's call site is unchanged, and is rendered for
            assistive tech only. */}
        <PageHeader title={title}>
          <span className="sr-only">{orientation}</span>
        </PageHeader>

        {/* No standing notice panel here — see the file header. */}

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
          <>
            {/* Screen-reader status announced when a filter change loads new official
                values (the period + total-quantity text changes). Concise, so
                switching filters does not produce a verbose read-out. It sits
                OUTSIDE every accordion: a collapsed <details> is hidden from the
                accessibility tree and must not be the only home for a live region
                (redesign plan §5 rule 9). */}
            <p role="status" className="sr-only" data-testid="landfill-live">
              {periodLabelOf(data.summary.period)} 반입 자료를 표시합니다. 총 반입량{" "}
              {formatTons(data.summary.total_quantity_kg)}.
            </p>

            <LandfillHeadlineResults
              summary={data.summary}
              periodLabel={periodLabelOf(data.summary.period)}
              priorSummary={priorSummary}
              priorSettled={priorSettled}
              priorPeriodLabel={priorPeriodLabelOf(data.summary)}
              capitalRegion={capitalRegion}
              /* The municipal contract-payment dataset now lives INSIDE the KPI row's
                 폐기물 관리비용 card, as its right-hand column — the arrangement the
                 Figma frame draws. It used to be a separate full-width card between
                 the KPI row and the body, which put 130px of page between two money
                 figures a reader has to keep apart.

                 It stays a SEPARATE dataset with its own badge, its own year, its own
                 loading and failure wording, and its own link into the detail section:
                 only the position changed. Passing it here rather than fetching it here
                 also keeps the two independent — an official 404 (what a fresh database
                 returns) still leaves the cost column and its section fully operable. */
              municipalCost={municipalCostAll}
              municipalCostError={municipalCost.error}
              /* 기술요청 #8 — the card's 상세 보기 opens the popup the frame draws
                 (`327:428`) rather than scrolling to a section. */
              onOpenCostDetail={() => setCostDetail({ open: true, regionCode: null })}
            />
          </>
        )}

        {/* ── Independence fallback ───────────────────────────────────────────────
            When the official landfill request HAS an answer, the municipal dataset is
            the right-hand column of the KPI row's 폐기물 관리비용 card, which is where
            the Figma frame puts it.

            When it does not — an official 404 is what a fresh database returns — that
            whole row is absent, and folding the municipal summary into it would have
            made a second, independently-fetched dataset disappear because a different
            request failed. So it falls back to its own card here, in the position it
            occupied before, with the same counts, the same wording and the same link.
            The two datasets are fetched independently and must fail independently. */}
        {data === null && (
          <MunicipalCostSummary data={municipalCostAll} error={municipalCost.error} />
        )}

        {data && (
          <LandfillBody
            data={data}
            reportingPerCapita={reportingPerCapita}
            facilityBurden={facilityBurden}
            capitalRegion={capitalRegion}
            contractReferenceYear={municipalCostAll?.meta.reference_year ?? null}
            contractDistinction={
              municipalCostAll?.meta.difference_from_official_landfill_fee ?? null
            }
            /* 기술요청 #21 — "표 우측의 지역명을 누르면 시·군·구별 상세 지표를 확인할
               수 있습니다". The name opens the same popup, with that municipality
               highlighted in place rather than filtered to. */
            onSelectMunicipality={(row) =>
              setCostDetail({ open: true, regionCode: row.code })
            }
          />
        )}

        {/* The full municipal contract-payment comparison — a DIFFERENT dataset,
            rendered OUTSIDE the official-data branch above for the same reason as
            its summary. It keeps every filter, every row, its own methodology, its
            own missing states, and its own failure alert: the summary above
            abbreviates nothing away, it only points here. */}
        <MunicipalCostSection
          {...municipalCost}
          /* The popup all three affordances open describes the PUBLISHED scope, so it
             reads the unfiltered response — the same one the KPI card counts from and
             the drill-down joins against. Spread order matters: this must land AFTER
             `{...municipalCost}`, which carries the section's own filtered `data`.

             Without it the popup inherited 시·도/자료 상태 from a section far below the
             card that opened it: with the released 서울 + 계산 가능 default, a reader who
             pressed 시·군·구별 상세 보기 on the KPI card met 13 서울 자치구 under a
             수도권 heading and no 인천 or 경기 row at all. */
          dataAll={municipalCostAll}
          detailOpen={costDetail.open}
          setDetailOpen={(open) => setCostDetail((current) => ({ ...current, open }))}
          detailFocusRegionCode={costDetail.regionCode}
        />
      </div>
    </div>
  );
}

/**
 * The values below the KPI region, in the Figma reading order: how the generation and
 * processing of each region compare and what the inbound is made of → how it moved
 * through the year → the exact figures → how to take them away → where they came from
 * and what they do not mean.
 *
 * The KPI row and its live region are rendered by the parent, so the municipal-cost
 * summary can sit between them and this block without either being conditional on the
 * other's dataset.
 */
function LandfillBody({
  data,
  reportingPerCapita,
  facilityBurden,
  capitalRegion,
  contractReferenceYear,
  contractDistinction,
  onSelectMunicipality,
}: {
  data: LandfillDashboardData;
  reportingPerCapita: ReportingPerCapitaEnvelope | null;
  facilityBurden: FacilityBurdenEnvelope | null;
  capitalRegion: CapitalRegionWaste;
  contractReferenceYear: number | null;
  contractDistinction: string | null;
  onSelectMunicipality: (row: MunicipalityRow) => void;
}) {
  const { summary, trends } = data;
  const periodLabel = periodLabelOf(summary.period);

  // Bar proportions only. `Number()` is permitted here because the result scales a
  // CSS width and NEVER reconstructs a displayed value (redesign plan §5 rule 10) —
  // every figure on screen is still the backend's exact string, formatted.
  const originMax = Math.max(0, ...summary.origin_shares.map((o) => Number(o.quantity_tons)));

  return (
    <>
      {/* ── Figma Row2 — 발생·처리 비교 ‖ 반입 구조 ────────────────────────────
          ⚠️ SAME-ROW CARDS MUST HAVE EQUAL OUTER HEIGHTS, tops and bottoms aligned.
          Measured on the frame: both cards are h=517 at y=547, and both end at 1064.
          Row3's pair is h=460 — so rows differ FROM EACH OTHER, but never within a row.

          Two things make that true here, and both matter:
            1. the cards are DIRECT grid children (the old `xl:col-span-*` wrapper
               <div>s are gone). A grid item stretches to its row by default, so the
               card itself — not a wrapper around it — is what gets the full height;
            2. `items-stretch` is stated explicitly rather than relied on, because it
               is the whole contract of this row.

          `min-h` and not a fixed height: the frame's 517 is a FLOOR that keeps the
          Figma vertical rhythm, while a card whose real content runs longer (the
          scatter grows when a dot is selected) pushes BOTH cards down together
          instead of being clipped. That is also 기술요청 #18 — selecting a dot keeps
          the right-hand 반입 구조 card's height in sync — obtained structurally
          rather than by measuring anything in JavaScript.

          The column proportions are the frame's own: 760 ‖ 624 in a 1400 track with a
          16px gap. */}
      <div className="grid grid-cols-1 items-stretch gap-4 xl:min-h-[517px] xl:grid-cols-[760fr_624fr]">
        <LandfillGenerationScatter perCapita={reportingPerCapita} burden={facilityBurden} />
        <LandfillFlowStructure summary={summary} originMax={originMax} />
      </div>

      {/* ── Figma Row3 — 반입 폐기물 구성 ‖ 월별 반입 추이 ────────────────────
          Same rule, this row's own height: both cards h=460 on the frame.

          Proportions 628 ‖ 756. The frame authors the right-hand card at 884, but
          Row3 sets `clipsContent` and is only 1400 wide, so 884 is an un-resized
          frame Figma clips — the drawn width is 1400 − 628 − 16 = 756, which is what
          the rendered page shows and what is used here. */}
      <div className="grid grid-cols-1 items-stretch gap-4 xl:min-h-[460px] xl:grid-cols-[628fr_756fr]">
        <LandfillCompositionSection summary={summary} periodLabel={periodLabel} />
        <LandfillTrendSection trends={trends} />
      </div>

      <LandfillRegionTable
        summary={summary}
        originMax={originMax}
        periodLabel={periodLabel}
        trends={trends}
        capitalRegion={capitalRegion}
        municipalReferenceYear={capitalRegion.generation.referenceYear}
        contractReferenceYear={contractReferenceYear}
        contractDistinction={contractDistinction}
        onSelectMunicipality={onSelectMunicipality}
      />

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
