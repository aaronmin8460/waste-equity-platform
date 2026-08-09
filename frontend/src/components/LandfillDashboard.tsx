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
 * ── Civic-dashboard refresh (docs/ui-refresh/landfill-dashboard.md) ─────────────
 * Presentation and information architecture only. No request scoping, denominator
 * selection, served value, unit, period rule, comparability rule, filter option, or
 * URL key changed — see the milestone doc §6. What changed:
 *   - the view is a sequence of TITLED sections that answer one question each —
 *     조건 선택 → 핵심 지표 → 월별 추이 → 반입 구성 → 지역별 정확한 값 → 근거와 한계 —
 *     instead of a flat run of cards whose headings all carried the same weight;
 *   - 총 반입량 is now the one `size="hero"` KPI, because it is the number every
 *     other surface on the screen decomposes;
 *   - provenance is stated per card with `DataStatusBadge`, because this screen
 *     genuinely mixes 공식 값 (반입량, 반입수수료) with 계산값 (실효 수수료, 1인당 환산);
 *   - a 현재 선택 summary restates the four asked-for conditions and says in words
 *     what the platform currently holds for them (공식 값 / 자료 없음 / 불러오는 중);
 *   - the JSX moved into `components/landfill/`. This file kept the composition,
 *     the prop contract, and the state ownership — which is to say, none: the page
 *     owns every filter, the request lifecycle, and the URL mirroring, and it still
 *     does.
 *
 * The standing scope banner is still exactly ONE `tone="info"` InfoBanner carrying
 * the metropolitan-only sentence verbatim, and it is still the only banner on a
 * successful screen: a permanent caveat repeated in a second coloured panel stops
 * being read.
 */

import { useMemo, useState } from "react";

import type {
  LandfillComposition,
  LandfillOrigin,
  LandfillSummary,
  LandfillTrends,
} from "../lib/api";
import type { LandfillUnavailableState } from "../lib/landfill";
import { formatTons } from "../lib/landfill";
import LandfillCompositionSection from "./landfill/LandfillCompositionSection";
import LandfillFilterPanel, {
  type LandfillSelectionOutcome,
} from "./landfill/LandfillFilterPanel";
import LandfillHeadlineResults from "./landfill/LandfillHeadlineResults";
import LandfillMethodology from "./landfill/LandfillMethodology";
import LandfillRegionTable from "./landfill/LandfillRegionTable";
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
import SectionCard from "./ui/SectionCard";
import { downloadLandfillWorkbook } from "../lib/landfillExport";

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

        {data && <LandfillBody data={data} />}

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
 * The values, in the order the questions arrive: what is the total → how did it
 * move → what is it made of → what are the exact figures → where did they come
 * from and what do they not mean.
 */
function LandfillBody({ data }: { data: LandfillDashboardData }) {
  const { summary, trends } = data;
  const periodLabel = periodLabelOf(summary.period);

  // Bar proportions only. `Number()` is permitted here because the result scales a
  // CSS width and NEVER reconstructs a displayed value (redesign plan §5 rule 10) —
  // every figure on screen is still the backend's exact string, formatted.
  const originMax = Math.max(0, ...summary.origin_shares.map((o) => Number(o.quantity_tons)));
  // The waste composition reads the SUMMARY's waste shares, which respond to all
  // four filters. (The /composition endpoint is scoped to year+origin and is used
  // only to populate the waste dropdown.)
  const wasteRows = useMemo(() => summary.top_waste_types.slice(0, 8), [summary.top_waste_types]);

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

      <LandfillHeadlineResults summary={summary} periodLabel={periodLabel} />

      <LandfillTrendSection trends={trends} />

      <LandfillCompositionSection
        summary={summary}
        periodLabel={periodLabel}
        originMax={originMax}
        wasteRows={wasteRows}
      />

      <LandfillRegionTable summary={summary} originMax={originMax} periodLabel={periodLabel} />

      {/* The export sits INSIDE the official-fee block, above the methodology and
          well above the municipal section, so the workbook it produces is
          unmistakably the landfill-fee dataset (spec §4). */}
      <LandfillExport summary={summary} trends={trends} />

      <LandfillMethodology summary={summary} />
    </>
  );
}

/**
 * 반입 자료 내려받기 — the official-fee workbook only.
 *
 * Deliberately NOT a "download everything on this page" button. The municipal
 * collection/transport contract payment is a different accounting basis, a
 * different publisher, and a different spatial unit, so it is never written into
 * this workbook (docs/YEOGIDA_UI_REDESIGN_SPEC.md §4). The button says which
 * dataset it exports for exactly that reason.
 */
function LandfillExport({
  summary,
  trends,
}: {
  summary: LandfillSummary;
  trends: LandfillTrends | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <SectionCard title="반입 자료 내려받기" testId="landfill-export">
      <p className="text-xs leading-relaxed text-ink-muted" data-testid="landfill-export-scope">
        수도권매립지 공식 반입량과 반입수수료를 출발 지역별·폐기물 종류별·월별 시트로 내려받습니다.
        아래 시·군·구 수집·운반 계약 지급액은 회계 기준이 다른 별도 자료이므로 이 파일에 포함되지
        않습니다.
      </p>
      <button
        type="button"
        className="wep-btn-quiet mt-2"
        data-testid="landfill-export-xlsx"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          downloadLandfillWorkbook(summary, trends)
            .catch(() => setError("파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요."))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "엑셀 파일 만드는 중…" : "엑셀(.xlsx) 내려받기"}
      </button>
      {error && (
        <p className="mt-2 text-xs text-danger" role="alert" data-testid="landfill-export-error">
          {error}
        </p>
      )}
    </SectionCard>
  );
}
