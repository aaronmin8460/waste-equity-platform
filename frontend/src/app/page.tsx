"use client";

/**
 * Dashboard shell (Phase 4 equity + Phase 5.4 suitability + landfill inbound).
 *
 * Three modes. 형평성/적합성 render the MapLibre map; 수도권매립지 renders a
 * full-width data dashboard with **no map**, because its official source reports
 * metropolitan totals only and declares no municipal route — see
 * components/LandfillDashboard.tsx.
 *
 * All displayed data comes from the platform backend; there is no bundled or
 * fallback dataset. Suitability results are analytical screening only — never a
 * legal permit, engineering, or final siting decision. If the backend is
 * unreachable or reports no data, the UI shows an explicit state, never fake data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import {
  ApiError,
  availableProfiles,
  fetchBoundaries,
  fetchDataSources,
  fetchFacilities,
  fetchFacilityBurden,
  fetchLandfillComposition,
  fetchLandfillSummary,
  fetchLandfillTrends,
  fetchMunicipalCosts,
  fetchPopulation,
  fetchReportingBoundaries,
  fetchReportingPerCapita,
  fetchReportingStatistics,
  fetchLandCoverActiveRelease,
  fetchSuitabilityCandidateDetail,
  fetchSuitabilityLatestRun,
  fetchSuitabilityPolicy,
  fetchSuitabilitySummary,
  fetchUserScenarioCandidateDetail,
  fetchWastePerCapita,
  fetchWasteStatistics,
  hasCriticStability,
  landCoverCellTileUrl,
  suitabilityTileUrl,
  userScenarioTileUrl,
  wetlandTileUrl,
  type CandidateDetail,
  type LandCoverActiveRelease,
  type LandCoverCoverageStatus,
  type DataSourceItem,
  type DatasetEnvelope,
  type EquityEnvelope,
  type FacilityBurdenEnvelope,
  type FacilityItem,
  type LandfillOrigin,
  type MunicipalCostResponse,
  type MunicipalCostSido,
  type MunicipalCostSort,
  type MunicipalCostStatus,
  type PopulationItem,
  type RegionBoundaryCollection,
  type ReportingBoundaryCollection,
  type ReportingPerCapitaEnvelope,
  type ReportingWasteStatisticsEnvelope,
  type SuitabilityProfile,
  type SuitabilityStatus,
  type UserScenarioCandidateDetail,
  type WasteStatisticsItem,
} from "../lib/api";
import {
  CANDIDATE_EXCLUDED_COLOR,
  CANDIDATE_REVIEW_COLOR,
  CANDIDATE_SCORE_BREAKS,
  CANDIDATE_SCORE_PALETTE_5,
  CANDIDATE_STABLE_OUTLINE_COLOR,
  METRIC_GROUPS,
  METRICS,
  NO_DATA_COLOR,
  formatCount,
  formatLegendValue,
  formatQuantity,
  frequencyLabel,
  UNKNOWN_FREQUENCY_LABEL,
  resolveActiveScale,
  scaleConfigForMetric,
  scaleMethodNote,
  type MetricKey,
} from "../lib/metrics";
import type {
  MapMode,
  RegionDisplayValue,
  RegionSelection,
  StatusVisibility,
} from "../components/MapView";
import { formatRegionMetricDisplay, regionUnavailableReasonLabel } from "../lib/regionDisplay";
import EquityMapInsightStrip from "../components/equity/EquityMapInsightStrip";
import EquityMetricSelector from "../components/equity/EquityMetricSelector";
import EquityRegionPicker from "../components/equity/EquityRegionPicker";
import EquityRegionSummary from "../components/equity/EquityRegionSummary";
import type { LandfillDashboardData } from "../components/LandfillDashboard";
import LandfillDashboard from "../components/LandfillDashboard";
import type { LandfillUnavailableState } from "../lib/landfill";
import { landfillUnavailableFromAll } from "../lib/landfill";
import type { MunicipalCostErrorState } from "../lib/municipalCost";
import { municipalCostErrorFrom } from "../lib/municipalCost";
import DashboardShell from "../components/DashboardShell";
import ResizableSidebar from "../components/ui/ResizableSidebar";
import FacilityCostDashboard from "../components/FacilityCostDashboard";
import LandCoverLayerControl from "../components/LandCoverLayerControl";
import type { ClassLevel } from "../lib/landCover";
import { landCoverErrorKind, validateActiveRelease } from "../lib/landCover";
import {
  LAND_COVER_LAYER_ERRORS,
  type LandCoverAvailableClasses,
  type LandCoverCoverageVisibility,
  type LandCoverHiddenClasses,
  type LandCoverVisualizationMode,
  defaultCoverageVisibility,
  defaultHiddenClasses,
  emptyAvailableClasses,
  mergeAvailableClasses,
} from "../lib/landCoverLayer";
import MapLegendOverlay from "../components/MapLegendOverlay";
import SuitabilityMapInsightStrip from "../components/suitability/SuitabilityMapInsightStrip";
import SuitabilityScreeningNotice from "../components/suitability/SuitabilityScreeningNotice";
import SuitabilitySidebar, {
  type SuitabilityMeta,
} from "../components/suitability/SuitabilitySidebar";
import { STATUS_LABELS } from "../components/suitability/shared";
import SuitabilityScenarioLab, { type AppliedScenario } from "../components/SuitabilityScenarioLab";
import TransparencyDashboard from "../components/TransparencyDashboard";
import WetlandLayerControl from "../components/WetlandLayerControl";
import type { WetlandType } from "../lib/wetland";
import { defaultWetlandTypeVisibility } from "../lib/wetland";
import RegionRanking from "../components/RegionRanking";
import RegionComparison, { type ComparisonValue } from "../components/RegionComparison";
import ShareExportBar from "../components/ShareExportBar";
import ReportPreview from "../components/ReportPreview";
import PageHeader from "../components/ui/PageHeader";
import Skeleton from "../components/ui/Skeleton";
import {
  rankRegions,
  type RankableRegion,
  type ScopeSelection,
} from "../lib/ranking";
import {
  decodeUrlState,
  encodeUrlState,
  shareableUrl,
  MAX_COMPARE,
  MUNICIPAL_COST_DEFAULT_SORT,
  type AppUrlState,
} from "../lib/urlState";
import { downloadCsv, safeFilename } from "../lib/csv";
import {
  buildComparisonCsv,
  buildRankingCsv,
  type ComparisonRegionRow,
} from "../lib/exports";
import { buildComparisonReport, buildEquityReport, type ReportModel } from "../lib/report";
import { decimalWeightsToPercents, type ScenarioPercents } from "../lib/scenario";
import { namedWeightRows } from "../lib/suitability";
import {
  SUITABILITY_SCREENING_SHORT_LABEL,
  accountingBasisLabel,
  destinationFor,
  plainError,
  type DashboardArea,
  type DataStatus,
  type NavDestination,
} from "../lib/glossary";

/** Sub-view inside suitability mode: the score screening, the weight lab, or cost. */
type SuitabilityView = "score" | "scenario" | "cost";

const MapView = dynamic(() => import("../components/MapView"), { ssr: false });

/**
 * Every selectable mode. `MapMode` is the subset that renders a map; "flow" (the
 * 매립지 현황 inbound dashboard) and "transparency" (the 데이터·출처 page)
 * deliberately have none, so the types stay distinct rather than letting a non-map
 * mode reach MapView. `DashboardMode` is exactly the citizen `DashboardArea`.
 */
type DashboardMode = MapMode | "flow" | "transparency";

/**
 * The candidate status → representative swatch color, built from the SAME
 * `lib/metrics.ts` constants the MapLibre candidate fill and `MapLegendOverlay`
 * read. The suitability sidebar's status summary receives this map rather than
 * hard-coding colors, so the summary, the legend, and the map cells can never
 * drift apart. Eligible cells are score-shaded, so the representative swatch is
 * the same mid class the legend's ELIGIBLE checkbox uses.
 */
const CANDIDATE_STATUS_COLORS: Record<SuitabilityStatus, string> = {
  ELIGIBLE: CANDIDATE_SCORE_PALETTE_5[3],
  REVIEW_REQUIRED: CANDIDATE_REVIEW_COLOR,
  EXCLUDED: CANDIDATE_EXCLUDED_COLOR,
};

export interface LoadedData {
  boundaries: RegionBoundaryCollection;
  population: DatasetEnvelope<PopulationItem>;
  waste: DatasetEnvelope<WasteStatisticsItem>;
  facilities: DatasetEnvelope<FacilityItem>;
  perCapita: EquityEnvelope;
  facilityBurden: FacilityBurdenEnvelope;
  // RCIS waste reporting geometry + values for the waste and per-capita metrics.
  reportingBoundaries: ReportingBoundaryCollection;
  reportingStats: ReportingWasteStatisticsEnvelope;
  reportingPerCapita: ReportingPerCapitaEnvelope;
  sources: DataSourceItem[];
}

export default function Home() {
  const [data, setData] = useState<LoadedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metricKey, setMetricKey] = useState<MetricKey>("population");
  const [showFacilities, setShowFacilities] = useState(true);

  // Inland-wetland inventory (내륙습지 목록) — a SEPARATE optional environmental
  // layer, OFF by default (it is background context, never a scored/exclusion
  // layer, and distinct from the statutory UM901 layer). Not URL-serialized —
  // mirrors the `showFacilities` precedent, so existing shared links are unaffected.
  const [showWetlands, setShowWetlands] = useState(false);
  const [wetlandTypeVisibility, setWetlandTypeVisibility] = useState<Record<WetlandType, boolean>>(
    defaultWetlandTypeVisibility,
  );
  const [wetlandDesignationOnly, setWetlandDesignationOnly] = useState(false);

  // Land-cover candidate-cell statistics (토지피복 격자 통계) — a SEPARATE optional
  // layer over the SAME 500 m candidate grid, available only in suitability mode and
  // OFF by default. Off by default deliberately: the source licence is still pending
  // written clarification, the layer is locally verified only, and a fill above the
  // candidate grid must never appear unrequested over the suitability visualization.
  // Not URL-serialized (same precedent as showFacilities/showWetlands), so existing
  // shared links are unaffected.
  const [showLandCover, setShowLandCover] = useState(false);
  const [landCoverMode, setLandCoverMode] = useState<LandCoverVisualizationMode>("coverage");
  const [landCoverClassLevel, setLandCoverClassLevel] = useState<ClassLevel>(1);
  const [landCoverCoverage, setLandCoverCoverage] = useState<LandCoverCoverageVisibility>(
    defaultCoverageVisibility,
  );
  const [landCoverHidden, setLandCoverHidden] = useState<LandCoverHiddenClasses>(
    defaultHiddenClasses,
  );
  const [landCoverClasses, setLandCoverClasses] = useState<LandCoverAvailableClasses>(
    emptyAvailableClasses,
  );
  const [landCoverRelease, setLandCoverRelease] = useState<LandCoverActiveRelease | null>(null);
  const [landCoverLayerError, setLandCoverLayerError] = useState<string | null>(null);

  const [mode, setMode] = useState<DashboardMode>("equity");
  const [profile, setProfile] = useState<SuitabilityProfile>("baseline");
  // Sub-view inside suitability mode: 후보지 점수 (score) or 비용 살펴보기 (cost).
  const [suitabilityView, setSuitabilityView] = useState<SuitabilityView>("score");

  // The persistent identity of the selected region is its region CODE, not a
  // captured metric-value snapshot. The full RegionSelection (label + value +
  // provenance) is DERIVED from this code under the currently-active metric (see
  // `selectedRegion` below), so changing the metric re-computes the summary for the
  // same region instead of dropping it. Both selection paths — a map region click
  // and the accessible region <select> — store the same code here.
  const [selectedRegionCode, setSelectedRegionCode] = useState<string | null>(null);

  // Capital-region landfill inbound dashboard (서울·인천·경기 → 수도권매립지) state.
  const [flowYear, setFlowYear] = useState<number | null>(null); // null = latest complete year
  const [flowMonth, setFlowMonth] = useState<number | null>(null); // null = annual
  const [flowOrigin, setFlowOrigin] = useState<LandfillOrigin | null>(null);
  const [flowWaste, setFlowWaste] = useState<string | null>(null);
  /**
   * The landfill outcome, TAGGED with the filter combination it describes.
   *
   * Phase 5: results are keyed rather than cleared. Values only ever render when
   * their key matches the current filters, so a selection change makes the previous
   * period's KPIs, table and trends disappear in the SAME render that requests the
   * new ones — no window in which official data sits under filter controls it does
   * not describe, and no second render pass to arrange it. It also makes a late
   * response from an abandoned filter state unrenderable on its own terms, not only
   * because the effect's `cancelled` flag suppressed it.
   *
   * `unavailable` distinguishes "the backend holds no official record for these
   * filters" from "the request failed"; both are still scoped to their key.
   */
  const [flowResult, setFlowResult] = useState<{
    key: string;
    data: LandfillDashboardData | null;
    unavailable: LandfillUnavailableState | null;
  } | null>(null);
  // Filter OPTIONS are held separately from the results so the four controls stay
  // usable while a request is in flight and after one comes back empty. Deriving
  // them from the results alone emptied the year <select> exactly when the no-data
  // panel was telling the reader to pick a different year.
  const [flowYears, setFlowYears] = useState<number[]>([]);
  const [flowWasteOptions, setFlowWasteOptions] = useState<string[]>([]);
  // The 기간 bound, held alongside the other options so a partial year's month list
  // does not widen back to 12 while a request is in flight.
  const [flowMaxMonth, setFlowMaxMonth] = useState<number>(12);
  // The identity of the current filter combination. Everything the landfill view
  // renders is scoped to it. JSON rather than a delimiter-joined string: the waste
  // name is free text served by the backend, so any separator character could in
  // principle appear inside it and let two different filter states produce one key.
  const flowKey = JSON.stringify([flowYear, flowMonth, flowOrigin, flowWaste]);
  const flowMatchesFilters = flowResult?.key === flowKey;
  const flowData = flowMatchesFilters ? flowResult.data : null;
  const flowUnavailable = flowMatchesFilters ? flowResult.unavailable : null;

  // 시·군·구 수집·운반 계약 지급액 — a SEPARATE dataset sharing the 매립지 현황 area. Its
  // three filters are held apart from the four official-landfill ones above and are
  // sent to the backend as `sido` / `status` / `sort`; nothing is filtered or
  // re-sorted client-side, so the server's nulls-last ordering is preserved.
  const [mcSido, setMcSido] = useState<MunicipalCostSido | null>(null);
  const [mcStatus, setMcStatus] = useState<MunicipalCostStatus | null>(null);
  const [mcSort, setMcSort] = useState<MunicipalCostSort>(MUNICIPAL_COST_DEFAULT_SORT);
  /**
   * The municipal-payment outcome, TAGGED with the filter combination it describes,
   * for the same reason `flowResult` is: values only ever render when their key
   * matches the current filters, so a filter change makes the previous selection's
   * rows disappear in the SAME render that requests the new ones, and a late
   * response from an abandoned filter state is unrenderable on its own terms.
   *
   * `error` is a genuine request failure only. This endpoint has NO "no record"
   * path — it returns all 66 municipalities for the published year, with the
   * unavailable ones carried as null rows — so a missing value never reaches here.
   */
  const [mcResult, setMcResult] = useState<{
    key: string;
    data: MunicipalCostResponse | null;
    error: MunicipalCostErrorState | null;
  } | null>(null);
  const mcKey = JSON.stringify([mcSido, mcStatus, mcSort]);
  const mcMatchesFilters = mcResult?.key === mcKey;
  const mcData = mcMatchesFilters ? mcResult.data : null;
  const mcError = mcMatchesFilters ? mcResult.error : null;
  const [suit, setSuit] = useState<SuitabilityMeta | null>(null);
  const [suitError, setSuitError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CandidateDetail | null>(null);
  const [statusVisibility, setStatusVisibility] = useState<StatusVisibility>({
    ELIGIBLE: true,
    REVIEW_REQUIRED: true,
    EXCLUDED: false,
  });
  // Stable-only map display — a SEPARATE state from the canonical statusVisibility,
  // so it never alters the status filters or reclassifies review/excluded cells.
  const [stableOnly, setStableOnly] = useState(false);

  // 가중치 바꿔보기 (user-weight scenario lab). The lab owns the editor workflow; the
  // page owns the APPLIED scenario (so the single MapView can render custom tiles)
  // and the scenario-selected candidate detail (so the map coordinates highlight +
  // fly-to). Both are null until an explicit apply / candidate selection.
  const [appliedScenario, setAppliedScenario] = useState<AppliedScenario | null>(null);
  const [scenarioSelected, setScenarioSelected] = useState<UserScenarioCandidateDetail | null>(
    null,
  );

  // 지역 부담 ranking + comparison + share/export state.
  const [scope, setScope] = useState<ScopeSelection>("all");
  const [topN, setTopN] = useState(10);
  const [comparison, setComparison] = useState<string[]>([]);
  const [reportKind, setReportKind] = useState<"ranking" | "comparison" | null>(null);
  const [urlWarnings, setUrlWarnings] = useState<string[]>([]);
  // A scenario / candidate restored from a shared URL, held until consumed (the
  // scenario is auto-applied by the lab via the preview API; the candidate is
  // fetched once the run is ready). Kept in the encoded URL until then so a shared
  // link is never self-stripped before it can be honoured.
  const [restoredScenario, setRestoredScenario] = useState<{
    weights: { zoning: string; road: string; equity: string; demand: string };
    percents: ScenarioPercents;
    compareProfile: SuitabilityProfile;
  } | null>(null);
  const [restoredCandidate, setRestoredCandidate] = useState<number | null>(null);
  // Guards so URL state is restored exactly once and written only afterwards
  // (a one-way state→URL sync via replaceState, so there is no update loop).
  const urlRestored = useRef(false);

  const load = useCallback(() => {
    Promise.all([
      fetchBoundaries(),
      fetchPopulation(),
      fetchWasteStatistics(),
      fetchFacilities(),
      fetchWastePerCapita(),
      fetchFacilityBurden(),
      fetchReportingBoundaries(),
      fetchReportingStatistics(),
      fetchReportingPerCapita(),
      fetchDataSources(),
    ])
      .then(
        ([
          boundaries,
          population,
          waste,
          facilities,
          perCapita,
          facilityBurden,
          reportingBoundaries,
          reportingStats,
          reportingPerCapita,
          sources,
        ]) => {
          setData({
            boundaries,
            population,
            waste,
            facilities,
            perCapita,
            facilityBurden,
            reportingBoundaries,
            reportingStats,
            reportingPerCapita,
            sources,
          });
        },
      )
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiError
            ? plainError(cause.detail?.error ?? cause.message).primary
            : "공공자료 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        );
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Select a metric while PRESERVING the selected region: the summary is derived
  // from `selectedRegionCode` under the active metric, so switching metric simply
  // re-derives the same region's label + value (or its explicit unavailable text
  // if the new metric serves no value for it). The stored code is retained here —
  // it is only dropped when the region no longer exists in the active geography
  // (handled by the derivation returning null; see `selectedRegion`).
  const selectMetric = useCallback((key: MetricKey) => {
    setMetricKey(key);
  }, []);

  // Suitability meta (policy + latest run + summary): load once when entering the mode.
  useEffect(() => {
    if (mode !== "suitability" || suit !== null) return;
    Promise.all([
      fetchSuitabilityPolicy(),
      fetchSuitabilityLatestRun(),
      fetchSuitabilitySummary(profile),
    ])
      .then(([policy, run, summary]) => setSuit({ policy, run, summary }))
      .catch((cause: unknown) => {
        setSuitError(
          cause instanceof ApiError
            ? plainError(cause.detail?.error ?? cause.message).primary
            : "후보지 분석 자료를 불러올 수 없습니다.",
        );
      });
  }, [mode, suit, profile]);

  // Refresh the summary when the profile changes. Deliberately depends only on
  // profile/mode — NOT suit. Updating suit here must never re-trigger this
  // effect: doing so created an infinite summary-refetch loop (each run built a
  // new suit object, which re-ran the effect). The functional update is a no-op
  // until the initial meta load has populated suit.
  useEffect(() => {
    if (mode !== "suitability") return;
    fetchSuitabilitySummary(profile)
      .then((summary) => setSuit((prev) => (prev ? { ...prev, summary } : prev)))
      .catch(() => undefined);
  }, [profile, mode]);

  // No candidate fetch here anymore: the map serves the complete suitability grid
  // as PostGIS vector tiles (see suitabilityTileUrl / MapView's vector source), so
  // the viewport pulls only the tiles it needs. There is no bbox-driven GeoJSON
  // fetch, no 300 ms debounce, no AbortController, and no limit — every candidate
  // cell of the run is reachable without a partial-map row cap.

  // Landfill dashboard data: (re)fetch summary + trends + composition when
  // entering the mode or when any of the four filters changes.
  //
  // Scope of each request, so nothing on screen is stale relative to the filters:
  // - summary: all four filters (drives the KPIs, the regional table, the origin
  //   comparison, and the waste-composition chart);
  // - trends: year + origin + waste — a monthly trend intentionally spans the
  //   whole selected year and ignores the month filter (a single-month trend
  //   would be one bar); the chart labels this scope difference;
  // - composition: year + origin, used ONLY to populate the waste dropdown, so
  //   the options are not narrowed by the waste filter itself.
  useEffect(() => {
    if (mode !== "flow") return;
    let cancelled = false;
    const trendsQuery =
      flowYear != null
        ? {
            startMonth: `${flowYear}-01`,
            endMonth: `${flowYear}-12`,
            origin: flowOrigin,
            wasteName: flowWaste,
          }
        : { origin: flowOrigin, wasteName: flowWaste };
    // The previous selection's values stop rendering the moment `flowKey` changes
    // (they are keyed, see `flowResult`), so nothing needs clearing here — and the
    // loading state therefore covers every filter transition, not just first load.
    // The filter OPTIONS deliberately survive (see `flowYears`/`flowWasteOptions`).
    //
    // `allSettled`, not `all`: `all` reports whichever request rejected FIRST, which
    // is not necessarily the most serious. A fast 404 from /composition alongside a
    // slow 500 from /summary would otherwise be reported as "no official record"
    // while the server is actually broken.
    Promise.allSettled([
      fetchLandfillSummary({
        year: flowYear,
        month: flowMonth,
        origin: flowOrigin,
        wasteName: flowWaste,
      }),
      fetchLandfillTrends(trendsQuery),
      fetchLandfillComposition({ year: flowYear, origin: flowOrigin }),
    ]).then(([summaryResult, trendsResult, compositionResult]) => {
      if (cancelled) return;
      // Data is accepted only when ALL THREE responses arrived: a partial set would
      // leave the KPIs describing one scope and the trends another. Destructuring the
      // settled tuple (rather than casting a mapped array) keeps each `.value`
      // correctly typed with no assertion.
      if (
        summaryResult.status === "fulfilled" &&
        trendsResult.status === "fulfilled" &&
        compositionResult.status === "fulfilled"
      ) {
        const summary = summaryResult.value;
        const composition = compositionResult.value;
        setFlowResult({
          key: flowKey,
          data: { summary, trends: trendsResult.value, composition },
          unavailable: null,
        });
        setFlowYears(summary.period.available_years);
        setFlowWasteOptions(composition.waste_types.map((waste) => waste.waste_name));
        // A complete year covers all twelve months; a partial one only through the
        // month the dataset actually reaches.
        setFlowMaxMonth(
          summary.period.is_complete_year || summary.period.available_through_month == null
            ? 12
            : Number(summary.period.available_through_month.slice(5, 7)),
        );
        return;
      }
      // Phase 5 AC4: routed through `plainError` like the equity and suitability
      // paths, so the raw `NO_DATA_AVAILABLE: No landfill inbound data has been
      // ingested.` never reaches a citizen. The code survives in the state's
      // `detail` for the diagnostic line.
      const settled = [summaryResult, trendsResult, compositionResult];
      const unavailable = landfillUnavailableFromAll(
        settled
          .filter((result) => result.status === "rejected")
          .map((result) => (result as PromiseRejectedResult).reason),
        // Passing the request count lets a PARTIAL failure be reported as a failure
        // rather than as "no official record exists" — some endpoints served data.
        settled.length,
      );
      setFlowResult({ key: flowKey, data: null, unavailable });
      // Years the backend named as available are kept, so the reader can act on the
      // "다른 연도를 선택해 주세요" the empty state shows them. Only from a genuine
      // no-data answer: an error body's year list describes nothing reliable, and
      // letting it overwrite a list built from a successful load would narrow the
      // control on the strength of a failed request.
      if (unavailable.kind === "no-data" && unavailable.availableYears.length > 0) {
        setFlowYears(unavailable.availableYears);
      }
    });
    return () => {
      cancelled = true;
    };
    // `flowKey` is derived from the four filters listed alongside it, so including it
    // does not change how often this runs — it only keeps the tag written into
    // `flowResult` in step with the request that produced it.
  }, [mode, flowKey, flowYear, flowMonth, flowOrigin, flowWaste]);

  // 시·군·구 수집·운반 계약 지급액: one request per filter combination, issued only in
  // the 매립지 현황 area.
  //
  // Deliberately a SEPARATE effect from the official landfill one above, not a
  // fourth entry in its `Promise.allSettled`. The two are different datasets from
  // different providers and they must fail independently: folding this request into
  // that set would let a municipal failure blank the official values (which are
  // accepted only when all requests succeed), and an official 404 — what a database
  // without landfill rows returns — would take this section down with it.
  //
  // Filtering and ordering are BACKEND parameters. The server places nulls last on
  // both value sorts, so re-sorting the served array here would let an unavailable
  // municipality be ordered as if it were the cheapest.
  useEffect(() => {
    if (mode !== "flow") return;
    let cancelled = false;
    // Nothing is cleared here: the rows stop rendering the moment `mcKey` changes
    // (they are keyed, see `mcResult`), so the loading state covers every filter
    // transition rather than only the first load.
    fetchMunicipalCosts({ sido: mcSido, status: mcStatus, sort: mcSort })
      .then((data) => {
        if (cancelled) return;
        setMcResult({ key: mcKey, data, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Routed through `plainError` like every other path, so a raw backend
        // string never reaches a citizen; the code survives in the diagnostic line.
        setMcResult({ key: mcKey, data: null, error: municipalCostErrorFrom(cause) });
      });
    return () => {
      cancelled = true;
    };
    // `mcKey` is derived from the three filters listed alongside it, so including it
    // does not change how often this runs — it only keeps the tag written into
    // `mcResult` in step with the request that produced it.
  }, [mode, mcKey, mcSido, mcStatus, mcSort]);

  const retry = useCallback(() => {
    setError(null);
    setData(null);
    load();
  }, [load]);

  const onCandidateClick = useCallback(
    (id: number) => {
      fetchSuitabilityCandidateDetail(id, profile)
        .then(setSelected)
        .catch(() => undefined);
    },
    [profile],
  );

  // Fetch a candidate's SCENARIO detail (custom score/rank under the applied
  // weights) and move/highlight the map — shared by the top-candidate list and a
  // map click while a scenario is applied. No-op until a scenario is applied.
  const selectScenarioCandidate = useCallback(
    (id: number) => {
      if (!appliedScenario) return;
      fetchUserScenarioCandidateDetail(id, {
        run_id: appliedScenario.runId,
        weights: appliedScenario.weights,
        compare_profile: appliedScenario.compareProfile,
      })
        .then(setScenarioSelected)
        .catch(() => undefined);
    },
    [appliedScenario],
  );

  // When the applied scenario is cleared (reset / leaving the lab), drop the
  // scenario-selected candidate so a stale detail never lingers. A non-null apply
  // (including the lab auto-applying a shared-URL scenario) consumes the restored
  // scenario, so the live applied weights own the URL from then on.
  const onScenarioApplied = useCallback((applied: AppliedScenario | null) => {
    setAppliedScenario(applied);
    if (applied === null) setScenarioSelected(null);
    else setRestoredScenario(null);
  }, []);

  // Reset the applied scenario when navigating AWAY from the scenario sub-view (or
  // out of suitability entirely), so the custom tiles never leak into another
  // view/mode. Event-driven (wrapped setters) rather than an effect. The lab's
  // draft is separately restored from sessionStorage the next time it mounts.
  const clearScenario = useCallback(() => {
    setAppliedScenario(null);
    setScenarioSelected(null);
    setRestoredScenario(null);
  }, []);
  const changeMode = useCallback(
    (next: DashboardMode) => {
      if (next !== "suitability") clearScenario();
      if (next !== "equity") setReportKind(null); // close the equity report overlay
      setMode(next);
    },
    [clearScenario],
  );
  const changeSuitabilityView = useCallback(
    (next: SuitabilityView) => {
      if (next !== "scenario") clearScenario();
      setSuitabilityView(next);
    },
    [clearScenario],
  );

  /**
   * Apply a visible destination: the ONE entry point the global navigation uses.
   *
   * The six destinations are a projection over `(mode, view)`
   * (lib/glossary.NAV_DESTINATIONS), so navigating is just setting both — through
   * the existing guarded setters, which is what keeps the scenario-clearing and
   * report-closing side effects intact. `view` is only written for the suitability
   * destinations, so moving to 지역 지표 or 폐기물 처리 현황 leaves the reader's
   * last suitability sub-view alone and returning to it is not a surprise.
   */
  const navigate = useCallback(
    (destination: NavDestination) => {
      if (destination.view !== null) changeSuitabilityView(destination.view);
      changeMode(destination.mode);
    },
    [changeMode, changeSuitabilityView],
  );

  /** The destination the current analytical state renders as. */
  const destination = useMemo(
    () => destinationFor(mode as DashboardArea, suitabilityView),
    [mode, suitabilityView],
  );

  // Flip one suitability status' visibility in the canonical page state. This is the
  // single source of truth the MapLibre candidate-layer filter reads AND the floating
  // legend's checkboxes drive — there is no duplicate visibility state in the legend.
  const toggleStatus = useCallback((status: SuitabilityStatus) => {
    setStatusVisibility((prev) => ({ ...prev, [status]: !prev[status] }));
  }, []);

  // Whether a user-weight scenario is currently applied AND shown on the map.
  const scenarioActive = mode === "suitability" && suitabilityView === "scenario" && !!appliedScenario;

  // Immutable vector-tile URL for the active map context:
  //  - score view: the stored run + profile tiles;
  //  - scenario view with an applied scenario: the CUSTOM scenario tiles (canonical
  //    weights + hash in the URL, so re-applying swaps the source once);
  //  - scenario view before first apply: the stored baseline tiles as a neutral
  //    candidate-status backdrop (the lab states clearly no scenario is applied yet).
  // There is no run to render outside suitability mode.
  const candidateTileUrl = useMemo(() => {
    if (mode !== "suitability" || !suit) return null;
    if (suitabilityView === "scenario") {
      return appliedScenario
        ? userScenarioTileUrl(
            appliedScenario.runId,
            appliedScenario.weights,
            appliedScenario.scenarioHash,
          )
        : suitabilityTileUrl(suit.run.id, "baseline");
    }
    return suitabilityTileUrl(suit.run.id, profile);
  }, [mode, suit, profile, suitabilityView, appliedScenario]);

  // The map's selected candidate + click handler follow the active sub-view: the
  // scenario view uses the scenario detail (custom score/rank), the score view the
  // stored detail. A single MapView is shared — never a second map instance.
  const mapSelectedCandidate =
    mode === "suitability" && suitabilityView === "scenario" ? scenarioSelected : selected;
  const mapCandidateClick =
    mode === "suitability" && suitabilityView === "scenario"
      ? selectScenarioCandidate
      : onCandidateClick;

  // Whether the selected run carries run-specific CRITIC + stability results.
  const stabilityAvailable = mode === "suitability" && hasCriticStability(suit?.run);
  // The profile options offered for the selected run (critic only when computed).
  // The profile selector only renders these options, so the active profile is
  // always one the run supports — no read ever requests an unavailable profile.
  const runProfiles = useMemo(() => availableProfiles(suit?.run), [suit?.run]);

  // Stable-only display toggle (independent of statusVisibility).
  const toggleStableOnly = useCallback(() => setStableOnly((prev) => !prev), []);

  // Inland-wetland layer controls. The tile URL is constant (pinned to the active
  // release server-side), so it is computed once. Toggles only affect this
  // separate overlay — never any candidate, score, status, or region state.
  const wetlandTiles = useMemo(() => wetlandTileUrl(), []);
  const toggleWetlands = useCallback(() => setShowWetlands((prev) => !prev), []);
  const toggleWetlandType = useCallback((type: WetlandType) => {
    setWetlandTypeVisibility((prev) => ({ ...prev, [type]: !prev[type] }));
  }, []);
  const toggleWetlandDesignationOnly = useCallback(
    () => setWetlandDesignationOnly((prev) => !prev),
    [],
  );

  // --- Land-cover candidate-cell layer (Phase 1B-LC5B) ------------------------
  // The tile URL is VERSION-PINNED, so the active statistics release is resolved
  // first and its immutable `statistics_version_id` goes into the template. The
  // release is fetched once per entry into suitability mode; a failure here disables
  // ONLY this layer — the base map, the candidate grid, facilities, candidate
  // selection, the LC5A detail panel and Equity mode are untouched.
  const suitabilityMapActive = mode === "suitability";
  useEffect(() => {
    if (!suitabilityMapActive || landCoverRelease) return;
    const controller = new AbortController();
    fetchLandCoverActiveRelease(controller.signal)
      .then((raw) => {
        if (controller.signal.aborted) return;
        const release = validateActiveRelease(raw);
        if (release) {
          setLandCoverRelease(release);
          setLandCoverLayerError(null);
        } else {
          // A response we cannot trust is never rendered as a usable layer, and the
          // message never claims land cover is absent.
          setLandCoverLayerError(LAND_COVER_LAYER_ERRORS.MALFORMED);
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLandCoverLayerError(LAND_COVER_LAYER_ERRORS[landCoverErrorKind(cause)]);
      });
    return () => controller.abort();
  }, [suitabilityMapActive, landCoverRelease]);

  const landCoverTiles = useMemo(
    () =>
      landCoverRelease ? landCoverCellTileUrl(landCoverRelease.statistics_version_id) : null,
    [landCoverRelease],
  );
  const toggleLandCover = useCallback(() => setShowLandCover((prev) => !prev), []);
  const toggleLandCoverCoverage = useCallback((status: LandCoverCoverageStatus) => {
    setLandCoverCoverage((prev) => ({ ...prev, [status]: !prev[status] }));
  }, []);
  const toggleLandCoverClass = useCallback(
    (code: string) => {
      setLandCoverHidden((prev) => {
        const current = prev[landCoverClassLevel];
        const next = current.includes(code)
          ? current.filter((value) => value !== code)
          : [...current, code];
        return { ...prev, [landCoverClassLevel]: next };
      });
    },
    [landCoverClassLevel],
  );
  const setAllLandCoverClasses = useCallback(
    (visible: boolean) => {
      setLandCoverHidden((prev) => ({
        ...prev,
        [landCoverClassLevel]: visible
          ? []
          : landCoverClasses[landCoverClassLevel].map((option) => option.code),
      }));
    },
    [landCoverClassLevel, landCoverClasses],
  );
  // Classes observed in the loaded tiles are MERGED, never replaced, so a class does
  // not vanish from the legend when it pans out of view. `mergeAvailableClasses`
  // returns the previous object identity when nothing was added, so a quiet map
  // (every tile already seen) causes no re-render.
  const handleLandCoverClasses = useCallback((observed: LandCoverAvailableClasses) => {
    setLandCoverClasses((prev) => mergeAvailableClasses(prev, observed));
  }, []);

  const metric = METRICS.find((candidate) => candidate.key === metricKey) ?? METRICS[0];

  const { regionValues, unit } = useMemo(() => {
    const values = new Map<string, RegionDisplayValue>();
    if (!data) return { regionValues: values, unit: "" };
    // Waste generation and per-capita render on the RCIS reporting geometry:
    // values are keyed by reporting_region_code (the seven cities appear once).
    if (metric.geography === "reporting") {
      if (metric.dataset === "waste-per-capita") {
        for (const item of data.reportingPerCapita.items) {
          if (item.waste_stream !== metric.wasteStream) continue;
          values.set(item.reporting_region_code, {
            numeric: Number(item.per_capita_kg_per_year),
            display: formatQuantity(item.per_capita_kg_per_year),
          });
        }
        return { regionValues: values, unit: data.reportingPerCapita.unit };
      }
      let reportingUnit = "";
      for (const item of data.reportingStats.items) {
        if (item.waste_stream !== metric.wasteStream) continue;
        values.set(item.reporting_region_code, {
          numeric: Number(item.generation_quantity),
          display: formatQuantity(item.generation_quantity),
        });
        reportingUnit = item.quantity_unit;
      }
      return { regionValues: values, unit: reportingUnit };
    }
    if (metric.dataset === "population") {
      for (const item of data.population.items) {
        values.set(item.region_code, {
          numeric: item.population,
          display: formatCount(item.population),
        });
      }
      return { regionValues: values, unit: data.population.items[0]?.unit ?? "persons" };
    }
    if (metric.dataset === "waste-per-capita") {
      for (const item of data.perCapita.items) {
        if (item.waste_stream !== metric.wasteStream) continue;
        values.set(item.region_code, {
          numeric: Number(item.per_capita_kg_per_year),
          display: formatQuantity(item.per_capita_kg_per_year),
        });
      }
      return { regionValues: values, unit: data.perCapita.unit };
    }
    if (metric.dataset === "facility-burden") {
      for (const item of data.facilityBurden.items) {
        const served =
          metric.burdenMeasure === "buffer"
            ? item.throughput_within_buffer_kg_per_capita
            : item.throughput_located_kg_per_capita;
        values.set(item.region_code, { numeric: Number(served), display: formatQuantity(served) });
      }
      return { regionValues: values, unit: data.facilityBurden.unit };
    }
    let quantityUnit = "";
    for (const item of data.waste.items) {
      if (item.waste_stream !== metric.wasteStream) continue;
      values.set(item.region_code, {
        numeric: Number(item.generation_quantity),
        display: formatQuantity(item.generation_quantity),
      });
      quantityUnit = item.quantity_unit;
    }
    return { regionValues: values, unit: quantityUnit };
  }, [data, metric]);

  // One resolved scale (metric-aware method + palette + breaks) drives BOTH the
  // MapLibre region fill and the legend below, so they can never disagree.
  const activeScale = useMemo(
    () =>
      resolveActiveScale(
        [...regionValues.values()].map((value) => value.numeric),
        scaleConfigForMetric(metric),
      ),
    [regionValues, metric],
  );

  // The geometry the active metric renders on. Native metrics keep SGIS
  // boundaries; reporting metrics (waste generation, per-capita) render the RCIS
  // reporting geometry, where the seven Gyeonggi cities appear once each and
  // their child districts are not drawn as separate value polygons. The reporting
  // features are adapted into the shared boundary shape (join key = reporting
  // region code) and carry the reporting metadata for the popup.
  const activeBoundaries = useMemo<RegionBoundaryCollection>(() => {
    const empty: RegionBoundaryCollection = {
      type: "FeatureCollection",
      reference_year: 0,
      count: 0,
      features: [],
    };
    if (!data) return empty;
    if (metric.geography !== "reporting") return data.boundaries;
    const reasons = new Map<string, string>();
    for (const u of data.reportingStats.unavailable_regions) {
      if (metric.wasteStream === undefined || u.waste_stream === metric.wasteStream) {
        reasons.set(u.reporting_region_code, u.reason);
      }
    }
    const features = data.reportingBoundaries.features.map((f) => ({
      type: "Feature" as const,
      geometry: f.geometry,
      properties: {
        region_code: f.properties.reporting_region_code,
        region_name: f.properties.reporting_region_name,
        region_level: f.properties.source_reporting_level,
        parent_region_code: null,
        source_id: f.properties.source_id,
        boundary_reference_period: f.properties.boundary_reference_period,
        reporting_geography_type: f.properties.reporting_geography_type,
        geometry_kind: f.properties.geometry_kind,
        derived_geometry_method: f.properties.derived_geometry_method,
        child_region_names: f.properties.child_region_names,
        source_reporting_level: f.properties.source_reporting_level,
        unavailable_reason: reasons.get(f.properties.reporting_region_code) ?? null,
      },
    }));
    return {
      type: "FeatureCollection",
      reference_year: data.reportingBoundaries.reference_year,
      count: features.length,
      features,
    };
  }, [data, metric]);

  const derivedInfo = useDerivedInfo(data, metric);
  const sourceInfo = useSourceInfo(data, metric);
  const facilitySummary = useFacilitySummary(data);

  // Keyboard-accessible region selection path (the map click is pointer-only).
  // Every region on the active geometry, sorted by name, offered in a <select>.
  const regionOptions = useMemo(
    () =>
      activeBoundaries.features
        .map((feature) => ({
          code: feature.properties.region_code,
          name: feature.properties.region_name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [activeBoundaries],
  );

  // Build the accessible selection for a region code, using the SAME display
  // formatter the map popup/feature uses so the two paths never diverge. A region
  // with no served value carries its availability text, never a fabricated 0.
  const buildRegionSelection = useCallback(
    (code: string): RegionSelection | null => {
      const feature = activeBoundaries.features.find((f) => f.properties.region_code === code);
      if (!feature) return null;
      const value = regionValues.get(code);
      return {
        regionCode: code,
        regionName: feature.properties.region_name,
        metricLabel: metric.label,
        metricDisplay: formatRegionMetricDisplay(
          value?.display,
          unit,
          feature.properties.unavailable_reason,
        ),
        hasValue: value !== undefined,
        geometryKind: feature.properties.geometry_kind ?? null,
        childRegionNames: feature.properties.child_region_names ?? [],
        sourceId: feature.properties.source_id,
        boundaryReferencePeriod: feature.properties.boundary_reference_period,
      };
    },
    [activeBoundaries, regionValues, metric, unit],
  );

  // The canonical selected-region detail, DERIVED from the persistent region code
  // under the active metric/geography. `buildRegionSelection` returns null when the
  // stored code is not present in the active boundary collection — e.g. after the
  // metric switches to a different geography (native ↔ reporting) that does not
  // contain it — which safely clears the summary without ever fabricating a value.
  // A metric change on the SAME geography keeps the region and re-derives its value.
  const selectedRegion = useMemo<RegionSelection | null>(
    () => (selectedRegionCode === null ? null : buildRegionSelection(selectedRegionCode)),
    [selectedRegionCode, buildRegionSelection],
  );

  // Metric SOURCE + reference period(s) to show alongside a selected region value
  // (repo AGENTS.md: every displayed analytical metric must carry its source and
  // reference period). Derived metrics list BOTH inputs. Distinct from the boundary
  // provenance the summary already shows.
  const metricProvenance = useMemo<{ label: string; value: string }[]>(() => {
    if (derivedInfo) {
      return [
        {
          label: derivedInfo.numeratorLabel,
          value: `${derivedInfo.numeratorSourceName} · 기준 ${derivedInfo.numeratorReferencePeriod}`,
        },
        {
          label: "인구 출처",
          value: `${derivedInfo.populationSourceName} · 기준 ${derivedInfo.populationReferencePeriod}`,
        },
      ];
    }
    if (sourceInfo) {
      return [
        {
          label: "지표 출처",
          value: `${sourceInfo.sourceName} (${sourceInfo.sourceId}) · 기준 ${sourceInfo.referencePeriod}`,
        },
      ];
    }
    return [];
  }, [derivedInfo, sourceInfo]);

  // The active metric's reference period, shown in the map hover/tap tooltip.
  const metricReferencePeriod =
    derivedInfo?.numeratorReferencePeriod ?? sourceInfo?.referencePeriod ?? "";

  // How the active metric's values came to be, in the shared provenance vocabulary
  // (lib/glossary DATA_STATUS_META). This is READ OFF the existing metric
  // definition, not a new judgement: per-capita and facility-burden are computed
  // from two official inputs (the same fact `DerivedPanel` already states in
  // words), while population and waste generation are served as published. Used
  // only to label provenance — it never affects a value, a rank, or a color.
  const metricDataStatus: DataStatus =
    metric.dataset === "waste-per-capita" || metric.dataset === "facility-burden"
      ? "derived"
      : "reported";

  // --- 지역 부담 ranking + comparison + export derivations ------------------- //

  // Every region on the active geography paired with its served value (or undefined
  // when unavailable) — the input to the ranking, which never fabricates a 0.
  const rankableRegions = useMemo<RankableRegion[]>(
    () =>
      activeBoundaries.features.map((feature) => ({
        code: feature.properties.region_code,
        name: feature.properties.region_name,
        value: regionValues.get(feature.properties.region_code),
      })),
    [activeBoundaries, regionValues],
  );

  // Resolve one region's comparison cell (exact value or 자료 없음). Reuses the same
  // formatter path as the summary, so an official 0 stays distinct from unavailable.
  const resolveComparisonValue = useCallback(
    (code: string): ComparisonValue | null => {
      const selection = buildRegionSelection(code);
      if (!selection) return null;
      const value = regionValues.get(code);
      // The SERVED availability reason for a region with no value, so the
      // comparison row can say WHY the cell is empty instead of only 자료 없음.
      // Read from the same feature the summary and the map popup read; when the
      // source attached no reason the label is "" and nothing extra is rendered.
      const feature = activeBoundaries.features.find((f) => f.properties.region_code === code);
      return {
        code,
        name: selection.regionName,
        display: value?.display ?? "",
        hasValue: selection.hasValue,
        numeric: value?.numeric,
        unavailableReason: selection.hasValue
          ? undefined
          : regionUnavailableReasonLabel(feature?.properties.unavailable_reason) || undefined,
      };
    },
    [buildRegionSelection, regionValues, activeBoundaries],
  );

  // Concise source/period/accounting provenance for the CSV + report metadata.
  const exportProvenance = useMemo(() => {
    const source = sourceInfo
      ? `${sourceInfo.sourceName} (${sourceInfo.sourceId})`
      : derivedInfo
        ? derivedInfo.numeratorSourceName
        : "";
    return {
      source,
      referencePeriod: metricReferencePeriod,
      accountingBasis: sourceInfo?.accountingBasis ?? derivedInfo?.accountingBasis ?? null,
    };
  }, [sourceInfo, derivedInfo, metricReferencePeriod]);

  const comparisonExportRows = useCallback((): ComparisonRegionRow[] => {
    return comparison.map((code) => {
      const value = resolveComparisonValue(code);
      return value
        ? { code, name: value.name, display: value.display, hasValue: value.hasValue }
        : { code, name: code, display: "", hasValue: false };
    });
  }, [comparison, resolveComparisonValue]);

  const downloadRankingCsv = useCallback(() => {
    const result = rankRegions(rankableRegions, scope, topN);
    const rows = buildRankingCsv({
      metricLabel: metric.label,
      unit,
      source: exportProvenance.source,
      referencePeriod: exportProvenance.referencePeriod,
      accountingBasis: exportProvenance.accountingBasis,
      scope,
      result,
      when: new Date(),
    });
    downloadCsv(safeFilename(`지역부담순위_${metric.label}`, "csv"), rows);
  }, [rankableRegions, scope, topN, metric.label, unit, exportProvenance]);

  const downloadComparisonCsv = useCallback(() => {
    const rows = buildComparisonCsv({
      metricLabel: metric.label,
      unit,
      source: exportProvenance.source,
      referencePeriod: exportProvenance.referencePeriod,
      accountingBasis: exportProvenance.accountingBasis,
      regions: comparisonExportRows(),
      when: new Date(),
    });
    downloadCsv(safeFilename(`지역비교_${metric.label}`, "csv"), rows);
  }, [metric.label, unit, exportProvenance, comparisonExportRows]);

  // The report model for the print/PNG preview, built when a report is opened.
  const reportModel = useMemo<ReportModel | null>(() => {
    if (reportKind === null) return null;
    const when = new Date();
    if (reportKind === "ranking") {
      return buildEquityReport({
        metricLabel: metric.label,
        unit,
        source: exportProvenance.source,
        referencePeriod: exportProvenance.referencePeriod,
        accountingBasis: exportProvenance.accountingBasis,
        scope,
        result: rankRegions(rankableRegions, scope, topN),
        when,
      });
    }
    return buildComparisonReport({
      metricLabel: metric.label,
      unit,
      source: exportProvenance.source,
      referencePeriod: exportProvenance.referencePeriod,
      accountingBasis: exportProvenance.accountingBasis,
      regions: comparisonExportRows(),
      when,
    });
  }, [reportKind, metric.label, unit, exportProvenance, scope, topN, rankableRegions, comparisonExportRows]);

  // --- Shareable, validated URL state -------------------------------------- //

  const currentUrlState = useCallback(
    (): AppUrlState => ({
      mode: mode as DashboardArea,
      metric: metricKey,
      region: selectedRegionCode,
      cmp: comparison,
      scope,
      top: topN,
      view: suitabilityView,
      profile,
      statusOn: (Object.keys(statusVisibility) as SuitabilityStatus[]).filter(
        (status) => statusVisibility[status],
      ),
      stableOnly,
      // Prefer the live applied scenario / selection; fall back to a not-yet-consumed
      // shared-URL value so a scenario/candidate link is preserved, not self-stripped.
      weights: appliedScenario?.weights ?? restoredScenario?.weights ?? null,
      cmpProfile: appliedScenario?.compareProfile ?? restoredScenario?.compareProfile ?? "baseline",
      candidate: selected?.candidate_id ?? scenarioSelected?.candidate_id ?? restoredCandidate ?? null,
      // 매립지 현황 filters — the canonical state already lives here, so the URL
      // mirror reads it directly rather than introducing a second copy.
      landfillYear: flowYear,
      landfillMonth: flowMonth,
      landfillOrigin: flowOrigin,
      landfillWaste: flowWaste,
      // 수집·운반 계약 지급액 filters — same rule, `mc`-prefixed keys so the two
      // datasets sharing this area cannot collide in a shared link.
      municipalCostSido: mcSido,
      municipalCostStatus: mcStatus,
      municipalCostSort: mcSort,
    }),
    [
      mode,
      metricKey,
      selectedRegionCode,
      comparison,
      scope,
      topN,
      suitabilityView,
      profile,
      statusVisibility,
      stableOnly,
      appliedScenario,
      restoredScenario,
      selected,
      scenarioSelected,
      restoredCandidate,
      // Load-bearing: without these four the mirror effect keeps its identity and
      // a filter change would never reach the URL.
      flowYear,
      flowMonth,
      flowOrigin,
      flowWaste,
      // Load-bearing for the same reason.
      mcSido,
      mcStatus,
      mcSort,
    ],
  );

  // Restore shared state ONCE, after the regions have loaded (so restored region
  // and comparison codes resolve against real geography; a code the active metric's
  // geometry does not contain simply shows no value — never a fabricated one). The
  // decoder has already whitelisted/bounds-checked every field.
  useEffect(() => {
    if (urlRestored.current || data === null || typeof window === "undefined") return;
    urlRestored.current = true;
    const { state, warnings } = decodeUrlState(window.location.search);
    // A one-time restore of external (URL) state after the regions have loaded; the
    // batched setState calls run once on mount, so the set-state-in-effect guard
    // (aimed at render-loop cascades) does not apply here.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (state.mode) setMode(state.mode);
    if (state.metric) setMetricKey(state.metric);
    if (state.region) setSelectedRegionCode(state.region);
    if (state.cmp) setComparison(state.cmp.slice(0, MAX_COMPARE));
    if (state.scope) setScope(state.scope);
    if (state.top) setTopN(state.top);
    if (state.view) setSuitabilityView(state.view);
    if (state.profile) setProfile(state.profile);
    if (state.statusOn) {
      setStatusVisibility({
        ELIGIBLE: state.statusOn.includes("ELIGIBLE"),
        REVIEW_REQUIRED: state.statusOn.includes("REVIEW_REQUIRED"),
        EXCLUDED: state.statusOn.includes("EXCLUDED"),
      });
    }
    if (state.stableOnly !== undefined) setStableOnly(state.stableOnly);
    // Scenario weights + selected candidate: held for the lab to auto-apply (with
    // preview-API re-validation) and for the candidate fetch once the run loads.
    if (state.weights) {
      const w = state.weights;
      setRestoredScenario({
        weights: w,
        percents: decimalWeightsToPercents({
          zoning: w.zoning,
          road: w.road,
          equity: w.equity,
          demand: w.demand,
        }),
        compareProfile: state.cmpProfile ?? "baseline",
      });
    }
    if (state.candidate) setRestoredCandidate(state.candidate);
    // 매립지 현황 filters. `undefined` means "not in the link" (keep the default);
    // every value that survives here was already shape-screened by the decoder.
    // These are set in the SAME batch as `mode`, so the landfill effect below sees
    // the fully restored filter set on its first run and issues one request set,
    // not one for the default and another for the restored state.
    if (state.landfillYear !== undefined) setFlowYear(state.landfillYear);
    if (state.landfillMonth !== undefined) setFlowMonth(state.landfillMonth);
    if (state.landfillOrigin !== undefined) setFlowOrigin(state.landfillOrigin);
    if (state.landfillWaste !== undefined) setFlowWaste(state.landfillWaste);
    // 수집·운반 계약 지급액 filters. Set in the SAME batch as `mode`, so the effect
    // above sees the fully restored filter set on its first run and issues one
    // request, not one for the default and another for the restored state.
    if (state.municipalCostSido !== undefined) setMcSido(state.municipalCostSido);
    if (state.municipalCostStatus !== undefined) setMcStatus(state.municipalCostStatus);
    if (state.municipalCostSort !== undefined) setMcSort(state.municipalCostSort);
    setUrlWarnings(warnings);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [data]);

  // Passively mirror state into the URL (replaceState — no navigation, no history
  // spam, no loop) once the initial restore has run.
  useEffect(() => {
    if (!urlRestored.current || typeof window === "undefined") return;
    window.history.replaceState(null, "", encodeUrlState(currentUrlState()));
  }, [currentUrlState]);

  const getShareUrl = useCallback(() => shareableUrl(currentUrlState()), [currentUrlState]);

  // Restore a shared candidate once the run is loaded (score view): fetch + select
  // it, which highlights and flies the map to it, then consume the restored id.
  useEffect(() => {
    if (
      restoredCandidate === null ||
      mode !== "suitability" ||
      suitabilityView !== "score" ||
      suit === null ||
      selected !== null
    ) {
      return;
    }
    onCandidateClick(restoredCandidate);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consume the restored id once
    setRestoredCandidate(null);
  }, [restoredCandidate, mode, suitabilityView, suit, selected, onCandidateClick]);

  // Service-region options for the cost lens, derived from CALCULABLE coverage:
  // the regions that actually have RegionalWasteStatistics rows (which the cost
  // backend joins by region_code, per stream), with their served names + codes.
  // This excludes the 7 RCIS city-level cities' SGIS districts, which have no
  // native waste row and would always return OFFICIAL_WASTE_UNAVAILABLE.
  //
  // Assumption: this uses /waste-statistics' single latest ingested year, which
  // matches the current RCIS ingestion where every stream shares one reference
  // year. If a future PID-specific refresh left one stream a year behind, its
  // regions could be under-offered here even though /facility-cost/calculate
  // (which resolves the latest year PER stream) could still compute them; that
  // would then warrant a backend per-stream coverage endpoint.
  const facilityCostWasteRegions = useMemo(
    () =>
      data
        ? data.waste.items.map((item) => ({
            code: item.region_code,
            name: item.region_name,
            stream: item.waste_stream,
          }))
        : [],
    [data],
  );

  if (error !== null) {
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-screen min-h-dvh items-center justify-center bg-canvas p-8"
      >
        <div
          className="max-w-lg rounded-card border border-danger-border bg-surface p-6"
          role="alert"
        >
          <h1 className="text-lg font-semibold text-danger">자료를 불러오지 못했습니다</h1>
          <p className="mt-2 text-sm text-ink-muted">{error}</p>
          <p className="mt-2 text-sm text-ink-subtle">
            공공자료를 불러오지 못하면 지도는 표시되지 않습니다. 없는 값을 임의로 채우지 않습니다.
          </p>
          <button type="button" onClick={retry} className="wep-btn-primary mt-4">
            다시 시도
          </button>
        </div>
      </main>
    );
  }

  if (data === null) {
    return (
      // Phase 4: the cold start is a structured skeleton that previews the real
      // layout (control column + map pane) instead of one centred sentence, so the
      // page does not appear broken while the requests are in flight.
      //
      // ACCESSIBILITY: the skeleton is DECORATIVE and `aria-hidden`; the single
      // concise announcement below stays the only thing assistive tech reads, and
      // it keeps `data-testid="loading"` + `role="status"` unchanged.
      //
      // DATA INTEGRITY: the placeholders are neutral bars only — no numbers, no
      // region names, no ranking rows, no legend classes. Nothing here can be read
      // as official public data (repo AGENTS.md).
      <main
        id="main-content"
        tabIndex={-1}
        className="relative flex min-h-screen min-h-dvh flex-col bg-canvas md:flex-row"
      >
        <div
          aria-hidden
          className="wep-sidebar flex w-full flex-col gap-4 border-b border-hairline bg-surface p-5 md:flex-none md:border-r md:border-b-0"
          data-testid="loading-skeleton-sidebar"
        >
          {/* Header block */}
          <Skeleton lines={2} />
          {/* Active-metric summary block */}
          <div className="wep-card p-4">
            <Skeleton lines={2} />
          </div>
          {/* The three metric group cards */}
          {[0, 1, 2].map((group) => (
            <div key={group} className="wep-card p-4">
              <Skeleton lines={4} />
            </div>
          ))}
          {/* Selected-region / ranking blocks */}
          <div className="wep-card p-4">
            <Skeleton lines={3} />
          </div>
        </div>
        <div
          aria-hidden
          className="wep-skeleton min-h-[240px] flex-1 rounded-none md:min-h-0"
          data-testid="loading-skeleton-map"
        />
        {/* The ONE announcement. role="status" is an implicit polite live region, so
            assistive tech reads the loading state and its resolution. */}
        <p
          className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded-pill border border-hairline bg-surface/95 px-4 py-2 text-sm text-ink-muted shadow-card"
          data-testid="loading"
          role="status"
        >
          공공자료를 불러오는 중…
        </p>
      </main>
    );
  }

  // 수도권매립지 mode: a full-width dashboard with no map and no sidebar. The
  // early return also narrows `mode` to MapMode for the map layout below, so a
  // non-map mode cannot reach MapView.
  if (mode === "transparency") {
    return (
      <DashboardShell destination={destination} onNavigate={navigate} variant="page">
        {/* Phase 6: the heading and the orientation strip moved INTO the dashboard,
            matching the Phase 5 landfill pattern. The strip still renders directly
            below the single <h1> (asserted by shell.test.tsx's document-order check)
            and the view still has exactly one <h1>. */}
        <TransparencyDashboard
          data={data}
          title={destination.label}
          orientation={<ModeOrientation destination={destination} />}
        />
      </DashboardShell>
    );
  }

  if (mode === "flow") {
    return (
      <DashboardShell destination={destination} onNavigate={navigate} variant="page">
        <LandfillDashboard
          title={destination.label}
          // Rendered inside the dashboard's own header, below its <h1> — the same
          // place the orientation strip sits in the other three areas.
          orientation={<ModeOrientation destination={destination} />}
          data={flowData}
          unavailable={flowUnavailable}
          year={flowYear}
          setYear={setFlowYear}
          month={flowMonth}
          setMonth={setFlowMonth}
          origin={flowOrigin}
          setOrigin={setFlowOrigin}
          waste={flowWaste}
          setWaste={setFlowWaste}
          availableYears={flowYears}
          wasteOptions={flowWasteOptions}
          maxMonth={flowMaxMonth}
          // The 2024 municipal contract-payment dataset. One prop object, so the
          // two datasets' state can never be crossed at this call site.
          municipalCost={{
            data: mcData,
            error: mcError,
            sido: mcSido,
            setSido: setMcSido,
            status: mcStatus,
            setStatus: setMcStatus,
            sort: mcSort,
            setSort: setMcSort,
          }}
        />
      </DashboardShell>
    );
  }

  // 적합성 → 비용 살펴보기: a full-width facility-cost dashboard with NO map. The cost
  // model does not vary by map cell in V1, so a map beside it would be dead weight;
  // this early return mounts no MapView, no map container, and no floating legend.
  // The main mode switch and the suitability sub-view switch stay reachable above it,
  // and the selected candidate context is preserved (passed through). The map layout
  // below is thus only ever reached by the equity map and the suitability SCORE view.
  if (mode === "suitability" && suitabilityView === "cost") {
    return (
      <DashboardShell destination={destination} onNavigate={navigate} variant="page">
        <div className="pt-6">
          <FacilityCostDashboard
            title={destination.label}
            orientation={<ModeOrientation destination={destination} />}
            wasteRegions={facilityCostWasteRegions}
            selectedCandidate={selected}
          />
        </div>
      </DashboardShell>
    );
  }

  // Legend rows read the exact active palette + breaks the map fill uses, so the
  // swatch count (effective classes) and colors always match the polygons. Each
  // row carries a class number and the numeric lower–upper range, so a region's
  // class is readable without relying on color alone.
  const legendRows = activeScale.palette.map((color, index) => {
    const lower = index === 0 ? null : activeScale.breaks[index - 1];
    const upper = index < activeScale.breaks.length ? activeScale.breaks[index] : null;
    const range =
      lower === null
        ? `< ${upper === null ? "…" : formatLegendValue(upper)}`
        : upper === null
          ? `≥ ${formatLegendValue(lower)}`
          : `${formatLegendValue(lower)} – ${formatLegendValue(upper)}`;
    return { color, range, classNumber: index + 1 };
  });

  // Eligible score classes for the suitability floating legend, built from the SAME
  // palette + stable 0–100 breaks the map's candidate fill uses (never recomputed in
  // the legend component), so the legend swatches and the map cells always agree.
  const suitabilityScoreClasses = CANDIDATE_SCORE_PALETTE_5.map((color, index) => {
    const lower = index === 0 ? null : CANDIDATE_SCORE_BREAKS[index - 1];
    const upper = index < CANDIDATE_SCORE_BREAKS.length ? CANDIDATE_SCORE_BREAKS[index] : null;
    const range =
      lower === null ? `< ${upper}` : upper === null ? `≥ ${lower}` : `${lower} – ${upper}`;
    return { color, range };
  });

  return (
    // The shell owns the viewport-height chain (see components/DashboardShell.tsx):
    // it is the fixed-height flex COLUMN at md+, the global nav is its auto-height
    // first child, and <main> is `md:flex-1 md:min-h-0` — a definite-height flex
    // item, so the `.map-pane` child's `height: 100%` still resolves and the map
    // still reaches the viewport bottom with no empty strip below it.
    // Inside <main>: mobile stacks the sidebar above a full-width map; md+ is the
    // original side-by-side row.
    <DashboardShell destination={destination} onNavigate={navigate} variant="map">
      {/* The control column is a SUNKEN surface so each section inside it reads as a
          distinct `.wep-card` (the shell root is the application canvas, cards are
          white surfaces — docs/ui-refresh/design-tokens.md §2).

          `ResizableSidebar` renders the <aside> AND the drag handle beside it. The
          fixed `md:w-96` (384px) is gone: the desktop width is now 300–520px,
          default 360, remembered per reader (spec §3). It still stacks full-width on
          phones and scrolls independently at md+, and the map beside it follows
          through MapView's EXISTING container ResizeObserver — this adds no second
          observer and never remounts the map. */}
      <ResizableSidebar>
        {/* The view's single <h1> is the AREA title, matching how 매립지 현황,
            데이터·출처, and 비용 살펴보기 already title themselves. The product name
            it replaced now lives in the app bar's brand block, so the same words no
            longer appear twice on one screen; the scope line below it is the exact
            string this header carried before. See
            docs/ui-refresh/regression-contract.md §10. ModeOrientation stays a
            SIBLING so it still follows the h1 in document order (shell.test.tsx)
            while keeping the column's gap-3 rhythm. */}
        <PageHeader
          title={destination.label}
          description="서울 · 인천 · 경기 공공자료로 보는 지역 부담과 후보지"
        />

        <ModeOrientation destination={destination} />

        {mode === "equity" && (
          <>
            {/* REGION SEARCH & SELECTION — the keyboard path to the same canonical
                `selectedRegionCode`, now its own labelled section instead of a form
                control wedged inside the summary above. `selectedRegion?.regionCode`
                (not the raw code) is passed deliberately: when a metric change moves
                to a geography that lacks the stored region the derived selection is
                null, and the select must return to its empty option rather than hold
                a value no longer in its option list. */}
            <EquityRegionPicker
              regionOptions={regionOptions}
              selectedRegionCode={selectedRegion?.regionCode ?? null}
              onSelectRegion={(code) => setSelectedRegionCode(code)}
            />

            {/* METRIC GROUPS — structure frozen: 3 fieldsets / 3 legends / 11 radios
                in one logical group (regression-contract §5). Presentation only. */}
            <EquityMetricSelector
              groups={METRIC_GROUPS}
              metrics={METRICS}
              metricKey={metricKey}
              onSelectMetric={selectMetric}
            />

            {/* CURRENT SELECTION — the answer to the two choices above, so it now
                sits BELOW them rather than opening the column (spec §3: 지역 선택 →
                지표 선택 → the resulting context). Nothing about the card changed:
                region → value → what is measured → when the data is from → source,
                with the provenance printed once, the role="status" live region, the
                contracted test IDs, and the "a missing value shows its served
                reason, never a 0" rule (docs/ui-refresh/equity-dashboard.md). */}
            <EquityRegionSummary
              metricLabel={metric.label}
              unit={unit}
              referencePeriod={metricReferencePeriod}
              metricStatus={metricDataStatus}
              metricProvenance={metricProvenance}
              selected={selectedRegion}
              onClear={() => setSelectedRegionCode(null)}
            />

            {/* 지표 순위, then comparison, then share/export. All three read the
                active metric's served values, so they follow the metric
                automatically, and selecting a region in any of them drives the ONE
                canonical selected-region state (map + summary stay in sync).
                Ranking leads because it answers "where does this stand?" for every
                region, while comparison answers a follow-up about a chosen few. */}
            <RegionRanking
              regions={rankableRegions}
              metricLabel={metric.label}
              unit={unit}
              referencePeriod={metricReferencePeriod}
              scope={scope}
              setScope={setScope}
              topN={topN}
              setTopN={setTopN}
              selectedRegionCode={selectedRegionCode}
              onSelectRegion={(code) => setSelectedRegionCode(code)}
            />

            <RegionComparison
              regionOptions={regionOptions}
              resolveValue={resolveComparisonValue}
              metricLabel={metric.label}
              unit={unit}
              selected={comparison}
              setSelected={setComparison}
              onSelectRegionOnMap={(code) => setSelectedRegionCode(code)}
              maxCompare={MAX_COMPARE}
            />

            <ShareExportBar
              getShareUrl={getShareUrl}
              onDownloadRankingCsv={downloadRankingCsv}
              onDownloadComparisonCsv={comparison.length > 0 ? downloadComparisonCsv : undefined}
              onOpenReport={() => setReportKind(comparison.length > 0 ? "comparison" : "ranking")}
              urlWarnings={urlWarnings}
            />

            {/* The equity map legend is no longer duplicated here — it floats over
                the map as a single source of truth (MapLegendOverlay below), built
                from the SAME activeScale palette/breaks the map fill uses. */}

            {(derivedInfo || sourceInfo) && (
              <CollapsibleSection label="출처와 계산 방법">
                {derivedInfo && <DerivedPanel info={derivedInfo} caveat={metric.caveat} />}
                {sourceInfo && <SourcePanel info={sourceInfo} boundaries={activeBoundaries} />}
              </CollapsibleSection>
            )}

            <CollapsibleSection label="시설 위치 표시">
              <section aria-label="시설 레이어">
                <h2 className="mb-2 text-sm font-semibold text-slate-800">
                  폐기물 처리시설
                </h2>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={showFacilities}
                    onChange={(event) => setShowFacilities(event.target.checked)}
                    data-testid="facilities-toggle"
                  />
                  지도에 시설 위치 표시
                </label>
                {facilitySummary && (
                  <div
                    className="mt-2 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"
                    data-testid="facility-metadata"
                  >
                    <p>
                      좌표 보유 시설 {formatCount(facilitySummary.withCoordinates)} /{" "}
                      {formatCount(facilitySummary.total)}개 표시.{" "}
                      <strong>{formatCount(facilitySummary.withoutCoordinates)}개</strong>는 공식
                      지오코딩이 실패하여 지도에 표시하지 않습니다.
                    </p>
                    <p className="mt-1">
                      출처: waste_statistics · 기준 기간: {facilitySummary.referencePeriod} · 갱신
                      주기: {facilitySummary.frequency}
                    </p>
                    <p className="mt-1">집계 기준: {accountingBasisLabel(facilitySummary.accountingBasis)}</p>
                  </div>
                )}
              </section>
            </CollapsibleSection>
          </>
        )}

        {mode === "suitability" && (
          <>
            {/* Phase 0: the standing analytical-screening disclaimer heads the
                suitability sidebar for both map sub-views (score + scenario). */}
            <SuitabilityScreeningNotice />
            {/* The 비용 살펴보기 sub-view is handled by the full-width early return
                above, so this sidebar branch always renders the score screening or
                the weight lab. The sub-view switch itself is NOT here: it is part of
                the shared chrome (components/DashboardShell.tsx), so it keeps one
                position across all three sub-views instead of appearing in the
                sidebar for two of them and above a full-width page for the third.
                The suitability status filter + score legend float over the map
                (MapLegendOverlay below), not in this panel. */}
            {suitabilityView === "scenario" ? (
              suit ? (
                <SuitabilityScenarioLab
                  run={suit.run}
                  runProfiles={runProfiles}
                  onApplied={onScenarioApplied}
                  scenarioSelected={scenarioSelected}
                  onSelectCandidate={selectScenarioCandidate}
                  onClearSelected={() => setScenarioSelected(null)}
                  initialScenario={
                    restoredScenario
                      ? {
                          percents: restoredScenario.percents,
                          compareProfile: restoredScenario.compareProfile,
                        }
                      : null
                  }
                />
              ) : (
                <p className="text-sm text-slate-500" role="status">
                  적합성 분석 실행을 불러오는 중입니다…
                </p>
              )
            ) : (
              <SuitabilitySidebar
                suit={suit}
                suitError={suitError}
                profile={profile}
                setProfile={setProfile}
                runProfiles={runProfiles}
                stabilityAvailable={stabilityAvailable}
                selected={selected}
                clearSelected={() => setSelected(null)}
                onSelect={onCandidateClick}
                // The canonical map-display state, REPORTED by the sidebar (the
                // controls that change it stay in the floating legend, so there is
                // exactly one status-visibility control on the screen).
                statusVisibility={statusVisibility}
                stableOnly={stableOnly && stabilityAvailable}
                statusColors={CANDIDATE_STATUS_COLORS}
              />
            )}
          </>
        )}

      </ResizableSidebar>

      {/* The map wrapper. Its MapLibre child is `h-full` (100% of this box), so the
          box needs a *definite* height. The dedicated `.map-pane` class (globals.css)
          owns that responsive sizing unambiguously: a definite 60vh/60dvh with a
          minimum on mobile (so the percentage child never collapses), and `height:
          100% / flex: 1 1 0%` at md+ so it fills BOTH the remaining row width and the
          full row height — leaving no empty strip below the canvas. `min-w-0` keeps
          the flex child shrinkable so long map content never forces horizontal
          overflow. MapView renders its own loading/refresh/error overlays inside.
          `relative` makes it the positioning context for the floating legend below,
          which is rendered here (in the page, not inside MapView) so it receives the
          already-computed legend data — the single source of truth shared with the
          map fill — and so the stubbed-MapView unit tests still exercise it. */}
      <div className="map-pane relative min-w-0">
        <MapView
          boundaries={activeBoundaries}
          regionValues={regionValues}
          breaks={activeScale.breaks}
          palette={activeScale.palette}
          metricLabel={metric.label}
          metricUnit={unit}
          metricReferencePeriod={metricReferencePeriod}
          facilities={data.facilities.items}
          showFacilities={showFacilities}
          mode={mode}
          showWetlands={showWetlands}
          wetlandTileUrl={wetlandTiles}
          wetlandTypeVisibility={wetlandTypeVisibility}
          wetlandDesignationOnly={wetlandDesignationOnly}
          showLandCover={showLandCover}
          landCoverTileUrl={landCoverTiles}
          landCoverMode={landCoverMode}
          landCoverClassLevel={landCoverClassLevel}
          landCoverCoverage={landCoverCoverage}
          landCoverHiddenClassCodes={landCoverHidden[landCoverClassLevel]}
          landCoverClasses={landCoverClasses}
          onLandCoverClassesChange={handleLandCoverClasses}
          candidateTileUrl={candidateTileUrl}
          candidateBreaks={CANDIDATE_SCORE_BREAKS}
          candidateContext={scenarioActive ? "scenario" : "stored"}
          statusVisibility={statusVisibility}
          stableOnly={stableOnly && stabilityAvailable}
          selectedCandidate={mapSelectedCandidate}
          onCandidateClick={mapCandidateClick}
          ariaLabel={
            mode === "equity"
              ? `지역 지표 지도 — ${metric.label} (interactive choropleth map)`
              : "적합성 후보 격자 지도 (suitability candidate grid, interactive map)"
          }
          ariaDescription={
            mode === "equity"
              ? "지역별 지표를 색으로 표시한 인터랙티브 지도입니다. 지역을 클릭하면 좌측 '선택한 지역' 요약에 이름과 값이 표시되며, 키보드·스크린리더 사용자는 그 요약으로 같은 정보를 확인할 수 있습니다."
              : "500m 후보 격자를 표시한 인터랙티브 지도입니다. 상세 후보는 좌측 '상위 후보지' 목록과 '후보 상세' 패널에서 접근할 수 있습니다. 광역 분석 스크리닝이며 법적·공학적 적합 판정이 아닙니다."
          }
          onRegionClick={(code) => setSelectedRegionCode(code)}
        />
        {/* Optional environmental layer controls, stacked at the map's TOP-LEFT so
            they never overlap the score/status legend (bottom-left) or the navigation
            control (top-right). Both are collapsed and OFF by default; toggling either
            never affects candidates, scores, statuses, or region state. The land-cover
            control is mounted only in suitability mode, which is the only context its
            layer exists in. `min-w-0` keeps long Korean class names from forcing
            horizontal overflow in the narrow mobile card. */}
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex w-[min(86vw,272px)] min-w-0 flex-col gap-2 md:left-3 md:top-3">
          <div className="pointer-events-auto min-w-0">
            <WetlandLayerControl
              show={showWetlands}
              onToggleShow={toggleWetlands}
              typeVisibility={wetlandTypeVisibility}
              onToggleType={toggleWetlandType}
              designationOnly={wetlandDesignationOnly}
              onToggleDesignationOnly={toggleWetlandDesignationOnly}
            />
          </div>
          {mode === "suitability" ? (
            <div className="pointer-events-auto min-w-0">
              <LandCoverLayerControl
                show={showLandCover}
                onToggleShow={toggleLandCover}
                available={landCoverTiles !== null}
                unavailableMessage={landCoverLayerError}
                mode={landCoverMode}
                onModeChange={setLandCoverMode}
                classLevel={landCoverClassLevel}
                onClassLevelChange={setLandCoverClassLevel}
                coverage={landCoverCoverage}
                onToggleCoverage={toggleLandCoverCoverage}
                availableClasses={landCoverClasses}
                hiddenClassCodes={landCoverHidden[landCoverClassLevel]}
                onToggleClass={toggleLandCoverClass}
                onSetAllClasses={setAllLandCoverClasses}
                statisticsVersionId={landCoverRelease?.statistics_version_id ?? null}
                disclosures={landCoverRelease?.disclosures}
              />
            </div>
          ) : null}
        </div>
        {/* THE MAP'S BOTTOM OVERLAY STACK — one bottom-anchored, left-aligned flex
            column holding the floating legend and, in 지역 부담 only, the 해석·주의·
            자료 기준·출처 insight strip beneath it.

            Why a column instead of two absolutely-positioned cards: both belong in
            the same bottom band, and hand-tuned `bottom-*` offsets would overlap the
            moment either grew a line of Korean text at a narrower width. Stacking
            them makes non-collision structural. It grows UPWARD from `bottom-8`,
            which keeps the OSM attribution (bottom-right, ~24px) uncovered, and
            `items-start` keeps each card at its own width, so the legend is
            positioned exactly as before in every non-equity branch.

            The strip is an OVERLAY, never an in-flow band under the map: the map
            pane is contracted to reach the viewport bottom with nothing below it
            (docs/ui-refresh/regression-contract.md §4), so an in-flow strip would
            shorten the canvas and break that contract.

            The legend never recomputes colors/breaks: equity mode receives the
            page's active scale rows (same palette/breaks as the fill); suitability
            mode receives the candidate palette/breaks and the CANONICAL
            statusVisibility state (its checkboxes drive the filter the map reads). */}
        <div className="pointer-events-none absolute bottom-8 left-2 right-2 z-10 flex flex-col items-start gap-2 md:left-3 md:right-3">
          <div className="pointer-events-auto">
            {mode === "equity" ? (
              <MapLegendOverlay
                mode="equity"
                metricLabel={metric.label}
                unit={unit}
                methodNote={scaleMethodNote(activeScale)}
                rows={legendRows}
                noDataColor={NO_DATA_COLOR}
              />
            ) : (
              <MapLegendOverlay
                mode="suitability"
                scoreClasses={suitabilityScoreClasses}
                eligibleColor={CANDIDATE_SCORE_PALETTE_5[3]}
                reviewColor={CANDIDATE_REVIEW_COLOR}
                excludedColor={CANDIDATE_EXCLUDED_COLOR}
                statusVisibility={statusVisibility}
                onToggleStatus={toggleStatus}
                statusLabels={STATUS_LABELS}
                // Served counts only — null until the summary loads, so the filter
                // never shows a fabricated 0 beside a status.
                statusCounts={
                  suit
                    ? {
                        ELIGIBLE: suit.summary.candidate_count_eligible,
                        REVIEW_REQUIRED: suit.summary.candidate_count_review,
                        EXCLUDED: suit.summary.candidate_count_excluded,
                      }
                    : null
                }
                stabilityAvailable={stabilityAvailable}
                stableOnly={stableOnly}
                onToggleStableOnly={toggleStableOnly}
                stableOutlineColor={CANDIDATE_STABLE_OUTLINE_COLOR}
                disclaimer={
                  scenarioActive
                    ? "사용자 가정 기반 임시 비교이며 공식 분석 실행·법적 입지 결정이 아닙니다."
                    : SUITABILITY_SCREENING_SHORT_LABEL
                }
                scenarioActive={scenarioActive}
                scenarioWeights={appliedScenario?.weights ?? null}
              />
            )}
          </div>
          {mode === "equity" ? (
            <EquityMapInsightStrip
              metricLabel={metric.label}
              unit={unit}
              metricStatus={metricDataStatus}
              referencePeriod={metricReferencePeriod}
              metricProvenance={metricProvenance}
              onOpenSources={() => changeMode("transparency")}
            />
          ) : null}
          {/* The suitability counterpart. It joins the SAME bottom overlay column,
              so it can never collide with the legend above it, and it renders only
              once the run/policy are loaded — there is no version string, run id, or
              basis to state before then, and it must not print a placeholder. */}
          {mode === "suitability" && suit ? (
            <SuitabilityMapInsightStrip
              variant={suitabilityView === "scenario" ? "scenario" : "score"}
              profile={
                suitabilityView === "scenario"
                  ? (appliedScenario?.compareProfile ?? "baseline")
                  : profile
              }
              scenarioWeights={
                appliedScenario
                  ? namedWeightRows(appliedScenario.weights).map((row) => ({
                      label: row.label,
                      percent: row.percent,
                    }))
                  : null
              }
              visibleStatuses={(Object.keys(statusVisibility) as SuitabilityStatus[]).filter(
                (status) => statusVisibility[status],
              )}
              stableOnly={stableOnly && stabilityAvailable}
              runId={suit.run.id}
              referenceYear={suit.run.reference_year}
              policyVersion={suit.policy.policy_version}
              derivationVersion={suit.policy.derivation_version}
              candidateGridVersion={suit.policy.candidate_grid_version}
              onOpenSources={() => changeMode("transparency")}
            />
          ) : null}
        </div>
      </div>

      {/* Print / PNG report preview overlay (map-free). Opened from the equity
          share/export bar; the model is the ranking or the region comparison. */}
      {reportModel && (
        <ReportPreview
          model={reportModel}
          filenameBase={reportKind === "comparison" ? `지역비교_${metric.label}` : `지역부담순위_${metric.label}`}
          onClose={() => setReportKind(null)}
        />
      )}
    </DashboardShell>
  );
}

// --------------------------------------------------------------------------- //
// One-line, task-oriented orientation shown at the top of each area, so a
// first-time visitor understands what the area does before reading any control.
//
// Phase 1: this is now plain muted supporting text inside the active view's
// content area. It previously carried a filled `bg-slate-50` strip, which — sitting
// directly under the mode switch — read as a second navigation row. The text and
// its `mode-orientation` testid are unchanged (the citizen-language guarantee in
// docs/CITIZEN_LANGUAGE_AND_UX.md and terminology.audit.test.tsx).
//
// The global TopNavigation and the 후보지 분석 SegmentedControl now live in
// components/DashboardShell.tsx, rendered once above every branch.
// --------------------------------------------------------------------------- //

function ModeOrientation({ destination }: { destination: NavDestination }) {
  return (
    <p className="wep-orient" data-testid="mode-orientation">
      {destination.orientation}
    </p>
  );
}

// --------------------------------------------------------------------------- //
// Collapsible control section.
//
// A native <details> disclosure so no UI dependency or focus-management code is
// introduced. On small screens the summary is a tappable header that collapses
// the body, keeping the stacked mobile sidebar short so the map stays reachable.
// On md+ the summary is hidden and the body is forced open by CSS (see
// globals.css), so the desktop sidebar is visually unchanged and no analytical
// option is ever permanently hidden. Children keep their own headings, testids,
// and aria labels.
// --------------------------------------------------------------------------- //

function CollapsibleSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    // Phase 4: the sidebar is now a sunken surface, so the disclosure reads as a card
    // (surface + hairline) instead of the old slate-100 fill, which would otherwise be
    // invisible against the new background. The <details> element, the
    // `.mobile-collapsible` class that the desktop force-open CSS keys on, and the
    // labelled (never icon-only) summary are all unchanged.
    <details className="mobile-collapsible wep-card" open={defaultOpen}>
      <summary className="flex cursor-pointer items-center justify-between gap-2 rounded-card px-4 py-3 text-sm font-semibold text-ink">
        <span>{label}</span>
        <span aria-hidden className="mobile-collapsible-chevron text-xs text-ink-subtle">
          ▾
        </span>
      </summary>
      {/* At md+ the summary is hidden by CSS, so the body supplies its own top
          padding there; on mobile the visible summary already provides it. */}
      <div className="mobile-collapsible-body flex flex-col gap-4 px-4 pb-4 md:pt-4">{children}</div>
    </details>
  );
}

// --------------------------------------------------------------------------- //
// Equity-mode provenance panels (extracted for readability)
// --------------------------------------------------------------------------- //

interface DerivedInfo {
  numeratorLabel: string;
  derivationVersion: string;
  formula: string;
  unit: string;
  assumptions: string[];
  excludedCount: number;
  numeratorSourceName: string;
  numeratorFrequency: string;
  numeratorReferencePeriod: string;
  officialDatasetName: string | null;
  accountingBasis: string;
  coverageNote: string | null;
  populationSourceName: string;
  populationFrequency: string;
  populationReferencePeriod: string;
  populationDefinition: string | null;
}

function useDerivedInfo(
  data: LoadedData | null,
  metric: (typeof METRICS)[number],
): DerivedInfo | null {
  return useMemo(() => {
    if (!data) return null;
    if (metric.dataset !== "waste-per-capita" && metric.dataset !== "facility-burden") return null;
    const wasteRegistry = data.sources.find((source) => source.source_id === "waste_statistics");
    const populationRegistry = data.sources.find((source) => source.source_id === "sgis");
    const numeratorFrequency = wasteRegistry
      ? frequencyLabel(wasteRegistry.publication_frequency)
      : UNKNOWN_FREQUENCY_LABEL;
    const populationCommon = {
      populationSourceName: populationRegistry?.source_name ?? "sgis",
      populationFrequency: populationRegistry
        ? frequencyLabel(populationRegistry.publication_frequency)
        : UNKNOWN_FREQUENCY_LABEL,
    };
    if (metric.dataset === "facility-burden") {
      const burden = data.facilityBurden;
      const item = burden.items[0];
      const partialCount = burden.items.filter((entry) =>
        metric.burdenMeasure === "buffer"
          ? entry.buffer_throughput_is_partial
          : entry.located_throughput_is_partial,
      ).length;
      return {
        numeratorLabel: "시설 출처",
        derivationVersion: burden.derivation_version,
        formula: burden.derivation_formula,
        unit: burden.unit,
        assumptions: burden.assumptions,
        excludedCount: burden.excluded_regions.length,
        numeratorSourceName: wasteRegistry?.source_name ?? "waste_statistics",
        numeratorFrequency,
        numeratorReferencePeriod: item?.facility_reference_period ?? String(burden.reference_year),
        officialDatasetName: null,
        accountingBasis: item?.accounting_basis ?? "FACILITY_LOCATION_BASED_THROUGHPUT",
        coverageNote:
          `좌표 없는 시설 ${formatCount(burden.facilities_without_coordinates)}개는 인근(5km) 측정에서 제외되고, ` +
          `지역 미배정 시설 ${formatCount(burden.facilities_without_region)}개는 소재 집계에 포함되지 않습니다.` +
          (partialCount > 0
            ? ` 처리량 미보고 시설이 있는 ${formatCount(partialCount)}개 지역의 합계는 과소집계로 표시됩니다.`
            : ""),
        ...populationCommon,
        populationReferencePeriod: item?.population_reference_period ?? String(burden.reference_year),
        populationDefinition: item?.population_definition ?? null,
      };
    }
    // Per-capita renders on the RCIS reporting geometry (Phase reporting-geo):
    // the seven Gyeonggi cities use the source-native city numerator over a
    // derived denominator (sum of SGIS child populations).
    const perCapita = data.reportingPerCapita;
    const item = perCapita.items.find((entry) => entry.waste_stream === metric.wasteStream);
    const excluded = perCapita.excluded_regions.filter(
      (entry) => entry.waste_stream === metric.wasteStream,
    );
    const derivedCityCount = perCapita.items.filter(
      (entry) => entry.waste_stream === metric.wasteStream && entry.population_is_derived,
    ).length;
    return {
      numeratorLabel: "발생량 출처",
      derivationVersion: perCapita.derivation_version,
      formula: perCapita.derivation_formula,
      unit: perCapita.unit,
      assumptions: perCapita.assumptions,
      excludedCount: excluded.length,
      numeratorSourceName: wasteRegistry?.source_name ?? "waste_statistics",
      numeratorFrequency,
      numeratorReferencePeriod: item?.waste_reference_period ?? String(perCapita.reference_year),
      officialDatasetName: item?.waste_official_dataset_name ?? null,
      accountingBasis: item?.accounting_basis ?? "ORIGIN_BASED_TREATMENT_OUTCOME",
      coverageNote:
        derivedCityCount > 0
          ? `경기 ${derivedCityCount}개 시(고양·부천·성남·수원·안산·안양·용인)는 RCIS 시 단위 발생량을 ` +
            `SGIS 자치구 인구의 합(파생 분모)으로 나눈 값이며, 경계는 자치구 경계의 파생 합집합입니다. ` +
            `구 단위 공식 폐기물 값은 제공되지 않습니다.`
          : null,
      ...populationCommon,
      populationReferencePeriod:
        item?.population_reference_period ?? String(perCapita.reference_year),
      populationDefinition: item?.population_definition ?? null,
    };
  }, [data, metric]);
}

/**
 * WHY THIS PANEL IS NO LONGER AMBER (final UI integration milestone).
 *
 * It carried `border-amber-300 bg-amber-50`, and `.mobile-collapsible` force-opens
 * 출처와 계산 방법 at md+, so on every desktop 지역 부담 screen a strong yellow card
 * sat permanently between the refreshed white `wep-card` surfaces. In the refreshed
 * system amber is the CAVEAT tone (`InfoBanner tone="warning"`, `--color-warn`), and
 * three sections of docs/ui-refresh/regression-contract.md (§6, §16, §18) say neutral
 * provenance must not be amber-by-default. 파생 지표 is neutral provenance: the same
 * screen already states exactly this fact neutrally, through the
 * `DataStatusBadge status="derived"` on `selected-region-summary`. Two contradictory
 * visual languages for one semantic, with the louder one on the lesser surface.
 *
 * The container therefore moves onto the shared neutral tokens. Amber is KEPT for
 * the one thing here that genuinely is a caveat — the metric's own `caveat` string —
 * now via `text-warn` rather than a raw utility. Nothing else changed: no wording, no
 * formula, no source, no value, no structure, no test id.
 *
 * `SourcePanel` below was deliberately left alone: its `slate-50` / `slate-200`
 * resolve to `#f8fafc` / `#e2e8f0`, i.e. the same value as `--color-surface-muted`
 * and within 1/255 of `--color-hairline`, so it has no visible conflict to fix.
 */
function DerivedPanel({ info, caveat }: { info: DerivedInfo; caveat?: string }) {
  return (
    <section
      aria-label="파생 지표 출처"
      className="rounded-card border border-hairline bg-surface-muted p-3 text-xs text-ink-muted"
      data-testid="derived-metric-metadata"
    >
      {/* Korean-only primary heading (Phase 4). The technical framing stays in the
          method/derivation detail rendered below — nothing was removed. */}
      <h2 className="mb-1 text-sm font-semibold text-ink">파생 지표</h2>
      <p className="mb-2 text-xs text-ink-subtle">
        백엔드에서 공식 데이터 2종으로 산출: {info.formula} · 단위 {info.unit} · 산출 버전{" "}
        {info.derivationVersion}
      </p>
      <dl className="space-y-1">
        <div>
          <dt className="inline font-medium">{info.numeratorLabel}: </dt>
          <dd className="inline">
            {info.numeratorSourceName} · 기준 기간{" "}
            <span data-testid="reference-period">{info.numeratorReferencePeriod}</span> ·{" "}
            {info.numeratorFrequency}
          </dd>
        </div>
        {info.officialDatasetName && (
          <div>
            <dt className="inline font-medium">공식 데이터셋: </dt>
            <dd className="inline">{info.officialDatasetName}</dd>
          </div>
        )}
        <div>
          <dt className="inline font-medium">집계 기준: </dt>
          <dd className="inline">{accountingBasisLabel(info.accountingBasis ?? undefined)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">인구 출처: </dt>
          <dd className="inline">
            {info.populationSourceName} · 기준 기간 {info.populationReferencePeriod} ·{" "}
            {info.populationFrequency}
          </dd>
        </div>
        {info.populationDefinition && (
          <div>
            <dt className="inline font-medium">인구 정의: </dt>
            <dd className="inline">{info.populationDefinition}</dd>
          </div>
        )}
      </dl>
      {info.coverageNote && (
        <p className="mt-2" data-testid="coverage-note">
          {info.coverageNote}
        </p>
      )}
      {info.excludedCount > 0 && (
        <p className="mt-2" data-testid="excluded-regions-note">
          <strong>{formatCount(info.excludedCount)}개 지역</strong>은 분모(인구) 또는 단위 문제로
          산출할 수 없어 표시하지 않습니다.
        </p>
      )}
      {/* The metric's own caveat IS a caution about a value that exists, so it keeps
          the warn role — as the token, and as the only warn-coloured text here. */}
      {caveat && <p className="mt-2 font-medium text-warn">{caveat}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer font-medium">산출 가정 (assumptions)</summary>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {info.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

interface SourceInfo {
  sourceId: string;
  sourceName: string;
  frequency: string;
  referencePeriod: string;
  accountingBasis: string | null | undefined;
  officialDatasetName: string | null | undefined;
  populationDefinition: string | null;
  // Reporting-geometry note for the waste-generation metric (city-level cities).
  reportingNote: string | null;
}

function useSourceInfo(
  data: LoadedData | null,
  metric: (typeof METRICS)[number],
): SourceInfo | null {
  return useMemo(() => {
    if (!data || metric.dataset === "waste-per-capita") return null;
    const sourceId = metric.dataset === "population" ? "sgis" : "waste_statistics";
    const registry = data.sources.find((source) => source.source_id === sourceId);
    const isReportingWaste = metric.geography === "reporting" && metric.dataset === "waste-statistics";
    const wasteItem = isReportingWaste
      ? data.reportingStats.items.find((item) => item.waste_stream === metric.wasteStream)
      : data.waste.items.find((item) => item.waste_stream === metric.wasteStream);
    const wasteYear = isReportingWaste
      ? data.reportingStats.reference_year
      : data.waste.reference_year;
    return {
      sourceId,
      sourceName: registry?.source_name ?? sourceId,
      frequency: registry ? frequencyLabel(registry.publication_frequency) : UNKNOWN_FREQUENCY_LABEL,
      referencePeriod:
        metric.dataset === "population"
          ? (data.population.items[0]?.reference_period ?? String(data.population.reference_year))
          : (wasteItem?.reference_period ?? String(wasteYear)),
      accountingBasis: metric.dataset === "waste-statistics" ? wasteItem?.accounting_basis : null,
      officialDatasetName:
        metric.dataset === "waste-statistics" ? wasteItem?.official_dataset_name : null,
      populationDefinition:
        metric.dataset === "population"
          ? (data.population.items[0]?.population_definition ?? null)
          : null,
      reportingNote: isReportingWaste
        ? "일곱 개 경기 시(고양·부천·성남·수원·안산·안양·용인)는 RCIS가 시 단위로 보고하여 " +
          "지도에 시 단위로 1회 표시되며, 경계는 SGIS 자치구 경계의 파생 합집합입니다. " +
          "구별 공식 폐기물 값은 제공되지 않습니다."
        : null,
    };
  }, [data, metric]);
}

function SourcePanel({
  info,
  boundaries,
}: {
  info: SourceInfo;
  boundaries: RegionBoundaryCollection;
}) {
  return (
    <section
      aria-label="지표 출처"
      className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"
      data-testid="metric-metadata"
    >
      {/* Korean-only primary heading (Phase 4). The source id, reference period, and
          update frequency continue to be rendered in full below. */}
      <h2 className="mb-1 text-sm font-semibold text-ink">지표 출처</h2>
      <dl className="space-y-1">
        <div>
          <dt className="inline font-medium">출처: </dt>
          <dd className="inline">
            {info.sourceName} ({info.sourceId})
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">기준 기간: </dt>
          <dd className="inline" data-testid="reference-period">
            {info.referencePeriod}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">갱신 주기: </dt>
          <dd className="inline">{info.frequency}</dd>
        </div>
        {info.officialDatasetName && (
          <div>
            <dt className="inline font-medium">공식 데이터셋: </dt>
            <dd className="inline">{info.officialDatasetName}</dd>
          </div>
        )}
        {info.accountingBasis && (
          <div>
            <dt className="inline font-medium">집계 기준: </dt>
            <dd className="inline">{accountingBasisLabel(info.accountingBasis ?? undefined)}</dd>
          </div>
        )}
        {info.populationDefinition && (
          <div>
            <dt className="inline font-medium">인구 정의: </dt>
            <dd className="inline">{info.populationDefinition}</dd>
          </div>
        )}
        <div>
          <dt className="inline font-medium">경계 출처: </dt>
          <dd className="inline">
            {boundaries.features[0]?.properties.source_id ?? "sgis"} ·{" "}
            {boundaries.features[0]?.properties.boundary_reference_period ??
              String(boundaries.reference_year)}
          </dd>
        </div>
      </dl>
      {info.reportingNote && (
        <p className="mt-2 text-slate-600" data-testid="reporting-geography-note">
          {info.reportingNote}
        </p>
      )}
    </section>
  );
}

interface FacilitySummary {
  total: number;
  withCoordinates: number;
  withoutCoordinates: number;
  referencePeriod: string;
  accountingBasis: string;
  frequency: string;
}

function useFacilitySummary(data: LoadedData | null): FacilitySummary | null {
  return useMemo(() => {
    if (!data) return null;
    const withCoordinates = data.facilities.items.filter((item) => item.longitude !== null);
    const registry = data.sources.find((source) => source.source_id === "waste_statistics");
    return {
      total: data.facilities.count,
      withCoordinates: withCoordinates.length,
      withoutCoordinates: data.facilities.count - withCoordinates.length,
      referencePeriod:
        data.facilities.items[0]?.reference_period ?? String(data.facilities.reference_year),
      accountingBasis: data.facilities.items[0]?.accounting_basis ?? "",
      frequency: registry ? frequencyLabel(registry.publication_frequency) : UNKNOWN_FREQUENCY_LABEL,
    };
  }, [data]);
}
