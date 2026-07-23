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
  fetchPopulation,
  fetchReportingBoundaries,
  fetchReportingPerCapita,
  fetchReportingStatistics,
  fetchSuitabilityCandidateDetail,
  fetchSuitabilityLatestRun,
  fetchSuitabilityPolicy,
  fetchSuitabilitySummary,
  fetchUserScenarioCandidateDetail,
  fetchWastePerCapita,
  fetchWasteStatistics,
  hasCriticStability,
  suitabilityTileUrl,
  userScenarioTileUrl,
  type CandidateDetail,
  type DataSourceItem,
  type DatasetEnvelope,
  type EquityEnvelope,
  type FacilityBurdenEnvelope,
  type FacilityItem,
  type LandfillOrigin,
  type PopulationItem,
  type RegionBoundaryCollection,
  type ReportingBoundaryCollection,
  type ReportingPerCapitaEnvelope,
  type ReportingWasteStatisticsEnvelope,
  type SuitabilityPolicy,
  type SuitabilityProfile,
  type SuitabilityRun,
  type SuitabilityStatus,
  type SuitabilitySummary,
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
import { formatRegionMetricDisplay } from "../lib/regionDisplay";
import type { LandfillDashboardData } from "../components/LandfillDashboard";
import LandfillDashboard from "../components/LandfillDashboard";
import type { LandfillUnavailableState } from "../lib/landfill";
import { landfillUnavailableFromAll } from "../lib/landfill";
import DashboardShell from "../components/DashboardShell";
import FacilityCostDashboard from "../components/FacilityCostDashboard";
import MapLegendOverlay from "../components/MapLegendOverlay";
import SuitabilityScenarioLab, { type AppliedScenario } from "../components/SuitabilityScenarioLab";
import TransparencyDashboard from "../components/TransparencyDashboard";
import RegionRanking from "../components/RegionRanking";
import RegionComparison, { type ComparisonValue } from "../components/RegionComparison";
import ShareExportBar from "../components/ShareExportBar";
import ReportPreview from "../components/ReportPreview";
import InfoBanner from "../components/ui/InfoBanner";
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
import { classifyEquityRaw, stabilityBadgeLabel } from "../lib/suitability";
import {
  COMPONENT_META,
  COMPONENT_ORDER,
  MODE_ORIENTATION,
  PROFILE_META,
  SUITABILITY_SCREENING_DISCLAIMER,
  SUITABILITY_SCREENING_DISCLAIMER_TITLE,
  SUITABILITY_SCREENING_SHORT_LABEL,
  UNMODELED_SUITABILITY_FACTORS,
  UNMODELED_SUITABILITY_NOTE,
  UNMODELED_SUITABILITY_TITLE,
  accountingBasisLabel,
  codeWithName,
  plainError,
  profileLabel,
  statusExplanation,
  statusLabel,
  type DashboardArea,
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

// Plain-Korean score-basis (weight-profile) options. The primary label is the
// citizen phrasing; `method` is the short detail line shown under it. Both come
// from the central glossary so wording stays consistent across the app.
const PROFILES: { key: SuitabilityProfile; label: string; method: string }[] = [
  { key: "baseline", label: PROFILE_META.baseline.primary, method: PROFILE_META.baseline.detail ?? "" },
  { key: "equal", label: PROFILE_META.equal.primary, method: PROFILE_META.equal.detail ?? "" },
  {
    key: "equity_focused",
    label: PROFILE_META.equity_focused.primary,
    method: PROFILE_META.equity_focused.detail ?? "",
  },
  {
    key: "access_focused",
    label: PROFILE_META.access_focused.primary,
    method: PROFILE_META.access_focused.detail ?? "",
  },
  { key: "critic", label: PROFILE_META.critic.primary, method: PROFILE_META.critic.detail ?? "" },
];

// Old runs that predate CRITIC/stability carry no such results.
const OLD_RUN_NO_CRITIC_MESSAGE =
  "이 분석 실행에는 데이터 분포 기준·안정성 결과가 없습니다. 새 버전의 분석 실행이 필요합니다.";

// Plain-Korean primary status labels for legend/popup. The raw code stays in the
// detail layer (STATUS_META[...].code) where it is genuinely needed for diagnostics.
const STATUS_LABELS: Record<SuitabilityStatus, string> = {
  ELIGIBLE: statusLabel("ELIGIBLE"),
  REVIEW_REQUIRED: statusLabel("REVIEW_REQUIRED"),
  EXCLUDED: statusLabel("EXCLUDED"),
};

/** A weight component value (decimal string in [0,1]) as a whole percent. */
function weightPercent(value: string | undefined): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "-";
}

/**
 * The four Z/R/E/D weights rendered with their Korean names as percentages, e.g.
 * "용도지역 호환성(Z) 40% · 도로 근접성 대리지표(R) 30% · …" — never bare single-letter codes.
 */
function namedWeights(w: Record<string, string> | undefined): string {
  const weights = w ?? {};
  return COMPONENT_ORDER.map((c) => `${codeWithName(c)} ${weightPercent(weights[c])}`).join(" · ");
}

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

interface SuitabilityMeta {
  policy: SuitabilityPolicy;
  run: SuitabilityRun;
  summary: SuitabilitySummary;
}

export default function Home() {
  const [data, setData] = useState<LoadedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metricKey, setMetricKey] = useState<MetricKey>("population");
  const [showFacilities, setShowFacilities] = useState(true);

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
      return {
        code,
        name: selection.regionName,
        display: value?.display ?? "",
        hasValue: selection.hasValue,
        numeric: value?.numeric,
      };
    },
    [buildRegionSelection, regionValues],
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
        className="flex min-h-screen min-h-dvh items-center justify-center bg-slate-100 p-8"
      >
        <div className="max-w-lg rounded-lg border border-red-300 bg-white p-6 shadow" role="alert">
          <h1 className="text-lg font-semibold text-red-700">자료를 불러오지 못했습니다</h1>
          <p className="mt-2 text-sm text-slate-700">{error}</p>
          <p className="mt-2 text-sm text-slate-500">
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
        className="relative flex min-h-screen min-h-dvh flex-col bg-slate-100 md:flex-row"
      >
        <div
          aria-hidden
          className="flex w-full flex-col gap-4 border-b border-slate-200 bg-white p-5 md:w-96 md:flex-none md:border-r md:border-b-0"
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
          className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm text-slate-600 shadow-sm"
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
      <DashboardShell mode={mode} onModeChange={changeMode} variant="page">
        {/* Phase 6: the heading and the orientation strip moved INTO the dashboard,
            matching the Phase 5 landfill pattern. The strip still renders directly
            below the single <h1> (asserted by shell.test.tsx's document-order check)
            and the view still has exactly one <h1>. */}
        <TransparencyDashboard data={data} orientation={<ModeOrientation mode={mode} />} />
      </DashboardShell>
    );
  }

  if (mode === "flow") {
    return (
      <DashboardShell mode={mode} onModeChange={changeMode} variant="page">
        <LandfillDashboard
          // Rendered inside the dashboard's own header, below its <h1> — the same
          // place the orientation strip sits in the other three areas.
          orientation={<ModeOrientation mode={mode} />}
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
      <DashboardShell
        mode={mode}
        onModeChange={changeMode}
        variant="page"
        suitabilityView={suitabilityView}
        onSuitabilityViewChange={changeSuitabilityView}
      >
        <div className="pt-6">
          <FacilityCostDashboard
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
    <DashboardShell
      mode={mode}
      onModeChange={changeMode}
      variant="map"
      suitabilityView={suitabilityView}
      onSuitabilityViewChange={changeSuitabilityView}
    >
      {/* Phase 4: the control column is a SUNKEN surface so each section reads as a
          distinct `.wep-card` (Phase 1 §8: page = surface-sunken, cards = surface).
          The layout classes the responsive contract asserts — w-full, md:w-96,
          md:flex-none — are unchanged; only the background and inner spacing move. */}
      <aside className="flex w-full flex-col gap-3 border-b border-hairline bg-surface-sunken p-4 md:w-96 md:flex-none md:overflow-y-auto md:border-r md:border-b-0">
        <header>
          <h1 className="text-lg font-bold text-ink">우리 동네 폐기물 지도</h1>
          <p className="text-xs text-ink-subtle">서울 · 인천 · 경기 공공자료로 보는 지역 부담과 후보지</p>
        </header>

        <ModeOrientation mode={mode} />

        {mode === "equity" && (
          <>
            {/* ACTIVE-METRIC SUMMARY (Phase 4 AC1).
                The selected metric is the answer-first element of this column: its
                plain-Korean name is the largest text here (text-base font-semibold),
                the unit is muted secondary text, and the source + reference period
                sit below as caption text so the metric's provenance is reachable
                without opening a disclosure (repo AGENTS.md).

                role="status" is unchanged — an implicit polite live region, so every
                radio change is announced. It wraps ONLY the name + unit so the
                announcement stays one short phrase; the provenance caption is
                deliberately outside the live region (it would otherwise be re-read
                on every metric change). There is no second metric state: this reads
                the same `metric`/`unit` the map fill and legend read. */}
            <section aria-label="지표 선택" className="wep-card p-4">
              <div role="status" data-testid="selected-metric-summary">
                <p className="text-xs font-medium text-ink-subtle">선택한 지표</p>
                <p className="mt-0.5 text-base font-semibold leading-tight text-ink">
                  {metric.label}
                </p>
                {unit ? <p className="mt-0.5 text-xs text-ink-subtle">단위 {unit}</p> : null}
              </div>
              {metricProvenance.length > 0 && (
                <dl className="mt-2 border-t border-hairline pt-2 text-xs text-ink-subtle">
                  {metricProvenance.map((entry) => (
                    <div key={entry.label}>
                      <dt className="inline font-medium">{entry.label}: </dt>
                      <dd className="inline">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            {/* SELECTED REGION.
                Ordered directly after the active-metric card so the column answers
                before it asks: "which metric am I looking at" then "which region did
                I pick", with the controls below. Phase 4 moved it above the metric
                list because a map click otherwise landed on a panel below the fold at
                1440×900 — the reader had to scroll to see what they had just clicked.
                Only the DOM order changed; the state, the testids, and the native
                <select> are untouched. */}
            <RegionSummary
              selected={selectedRegion}
              clear={() => setSelectedRegionCode(null)}
              regionOptions={regionOptions}
              onSelectRegion={(code) => setSelectedRegionCode(code)}
              metricProvenance={metricProvenance}
            />

            {/* METRIC GROUPS (Phase 4 AC2 — structure deliberately unchanged).
                Still exactly 3 <fieldset>s / 3 <legend>s / 11
                input[type=radio][name="metric"] in ONE logical radio group, with the
                same values and the same onChange, so native arrow-key behaviour and
                every metric definition are untouched. Phase 4 only reduces density:
                one card per family instead of a nested bordered box, tighter rows,
                and a selected row that is emphasised by border + text weight in
                addition to the native radio — never by color alone. */}
            <section aria-label="지표 목록" className="wep-card p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">지역 지표 선택</h2>
              <div className="flex flex-col gap-3">
                {METRIC_GROUPS.map((group) => (
                  <fieldset key={group.key} className="m-0" data-testid={`metric-group-${group.key}`}>
                    <legend className="mb-1 p-0 text-xs font-semibold text-ink-muted">
                      {group.legend}
                    </legend>
                    <div className="flex flex-col gap-0.5">
                      {METRICS.filter((candidate) => candidate.group === group.key).map(
                        (candidate) => {
                          const isActive = metricKey === candidate.key;
                          return (
                            <label
                              key={candidate.key}
                              className={`flex items-start gap-2 rounded-control border px-2 py-1.5 text-sm ${
                                isActive
                                  ? "border-primary bg-primary-soft font-semibold text-ink"
                                  : "border-transparent text-ink-muted hover:bg-surface-muted"
                              }`}
                            >
                              <input
                                type="radio"
                                name="metric"
                                className="mt-0.5"
                                checked={isActive}
                                onChange={() => selectMetric(candidate.key)}
                              />
                              <span>{candidate.label}</span>
                            </label>
                          );
                        },
                      )}
                    </div>
                  </fieldset>
                ))}
              </div>
            </section>

            {/* Regional ranking + comparison + share/export. All read the active
                metric's served values, so they follow the metric automatically, and
                selecting a region here drives the ONE canonical selected-region state
                (map + summary stay in sync). */}
            <RegionRanking
              regions={rankableRegions}
              metricLabel={metric.label}
              unit={unit}
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
              <SuitabilityPanel
                suit={suit}
                suitError={suitError}
                profile={profile}
                setProfile={setProfile}
                runProfiles={runProfiles}
                stabilityAvailable={stabilityAvailable}
                selected={selected}
                clearSelected={() => setSelected(null)}
                onSelect={onCandidateClick}
              />
            )}
          </>
        )}

      </aside>

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
        {/* Floating legend over the lower-left of the map — one legend per map mode.
            It never recomputes colors/breaks: equity mode receives the page's active
            scale rows (same palette/breaks as the fill); suitability mode receives the
            candidate palette/breaks and the CANONICAL statusVisibility state (its
            checkboxes drive the same filter the map reads). */}
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

function ModeOrientation({ mode }: { mode: DashboardMode }) {
  return (
    <p className="wep-orient" data-testid="mode-orientation">
      {MODE_ORIENTATION[mode as DashboardArea]}
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
// Selected-region summary — the accessible DOM alternative to a map region click.
//
// The MapLibre canvas cannot be reached by keyboard or a screen reader, so this
// offers a keyboard-operable region <select> that populates the same summary the
// map click does. It never fabricates a value: a region with no served value shows
// its availability text (never a zero), and the displayed analytical value carries
// its metric source and reference period (repo AGENTS.md) in addition to the
// boundary provenance. Kept OUT of a collapsed <details> so its role="status"
// region can announce the selection (a closed disclosure would hide it from the
// a11y tree).
// --------------------------------------------------------------------------- //

function RegionSummary({
  selected,
  clear,
  regionOptions,
  onSelectRegion,
  metricProvenance,
}: {
  selected: RegionSelection | null;
  clear: () => void;
  regionOptions: { code: string; name: string }[];
  onSelectRegion: (code: string | null) => void;
  metricProvenance: { label: string; value: string }[];
}) {
  return (
    <section
      aria-label="선택한 지역 요약"
      className="wep-card p-4 text-xs text-ink-muted"
      data-testid="selected-region-summary"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">선택한 지역</h2>
        {selected && (
          <button
            type="button"
            onClick={clear}
            className="text-ink-subtle hover:text-ink"
            data-testid="selected-region-clear"
          >
            지우기 ✕
          </button>
        )}
      </div>
      {/* Keyboard/screen-reader selection path: a native <select> of every region
          on the active geometry. Selecting one populates the same summary as a map
          click, so pointer input is not required. Phase 4 restyles it and leaves the
          element type, testid, and onChange contract untouched — it stays a native
          <select> and is NOT replaced by the Phase 2 SearchableRegionPicker. */}
      <label className="mt-2 block font-medium text-ink-muted">
        지역 선택
        <select
          className="mt-1 w-full rounded-control border border-hairline-strong bg-surface px-2 py-1.5 text-sm text-ink"
          data-testid="region-select"
          value={selected?.regionCode ?? ""}
          onChange={(event) => onSelectRegion(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">지역을 선택하세요…</option>
          {regionOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      {/* The live region wraps only the populated state, so a chosen region is
          announced, while clearing it (e.g. on a metric change) does not read out
          the empty prompt. */}
      {selected === null ? (
        <p className="mt-2 text-ink-subtle" data-testid="selected-region-empty">
          지도에서 지역을 누르거나 위 목록에서 지역을 선택하면 이름과 값이 여기에 표시됩니다.
        </p>
      ) : (
        // Phase 4 hierarchy: region name → value + unit → availability → provenance.
        // The name and the value lead; every supporting line is de-emphasised caption
        // text. No analytical content was removed.
        <div role="status" className="mt-3">
          <p className="text-base font-semibold leading-tight text-ink" data-testid="selected-region-name">
            {selected.regionName}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">{selected.metricLabel}</p>
          {/* hasValue ⇒ served value (with its unit); otherwise the availability text
              carried on the feature (e.g. "데이터 없음 — …"), never a fabricated 0.
              Availability is conveyed by the TEXT itself, not by color — the smaller
              warn-toned treatment is redundant emphasis, not the signal. */}
          <p
            className={
              selected.hasValue
                ? "mt-0.5 text-xl font-semibold tabular-nums text-ink"
                : "mt-0.5 text-sm font-medium text-warn"
            }
            data-testid="selected-region-value"
          >
            {selected.metricDisplay}
          </p>
          <dl className="mt-2 space-y-0.5 border-t border-hairline pt-2 text-xs text-ink-subtle">
            {/* Metric source + reference period(s) for the displayed value — for
                derived metrics both inputs (AGENTS.md). Distinct from the boundary
                provenance below. */}
            {metricProvenance.map((entry) => (
              <div key={entry.label} data-testid="selected-region-metric-source">
                <dt className="inline font-medium">{entry.label}: </dt>
                <dd className="inline">{entry.value}</dd>
              </div>
            ))}
            <div>
              <dt className="inline font-medium">경계 출처: </dt>
              <dd className="inline">
                {selected.sourceId} ({selected.boundaryReferencePeriod})
              </dd>
            </div>
          </dl>
          {selected.geometryKind === "DERIVED" && selected.childRegionNames.length > 0 && (
            <p className="mt-1 text-xs text-ink-subtle" data-testid="selected-region-derived-note">
              통계 보고 단위: 시 · 경계는 {selected.childRegionNames.join("·")} 자치구 경계의 파생
              합집합입니다. 구별 공식 폐기물 값은 제공되지 않습니다.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Suitability panel
// --------------------------------------------------------------------------- //

// Text-first stability badge. Stability is always conveyed by the label text (the
// count and meaning), with color only as a secondary cue — never color alone.
function StabilityBadge({
  stabilityClass,
  stableCount,
}: {
  stabilityClass: string;
  stableCount: number;
}) {
  const label = stabilityBadgeLabel(stabilityClass, stableCount);
  if (label === null) return null;
  const styles: Record<string, string> = {
    STABLE: "border-pink-600 bg-pink-50 text-pink-800",
    CONDITIONALLY_STABLE: "border-amber-500 bg-amber-50 text-amber-800",
    WEIGHT_SENSITIVE: "border-slate-400 bg-slate-100 text-slate-600",
  };
  return (
    <span
      data-testid="stability-badge"
      className={`inline-block rounded border px-1 text-[10px] font-semibold ${
        styles[stabilityClass] ?? styles.WEIGHT_SENSITIVE
      }`}
    >
      {label}
    </span>
  );
}

// Run-specific CRITIC methodology note: candidate population, method version, the
// actual Z/R/E/D weights, any zero-variance criteria, and the mandatory disclaimer.
function CriticMethodNote({ run }: { run: SuitabilityRun }) {
  const w = run.weight_profiles.critic;
  if (!w) return null;
  const deriv = run.weight_derivation as Record<string, unknown>;
  const pop = deriv.population_candidate_count;
  const methodVersion = deriv.method_version;
  const zeroVar = (deriv.zero_variance_criteria as string[] | undefined) ?? [];
  return (
    <div
      className="mt-2 rounded border border-sky-200 bg-sky-50 p-2 text-[11px] text-slate-600"
      data-testid="critic-method-note"
    >
      <p className="font-medium text-slate-700">CRITIC 데이터 기반 가중치</p>
      <p className="mt-0.5">
        방법: CRITIC · 대상 후보 {pop != null ? formatCount(Number(pop)) : "-"}개 (자료가 완전한
        스크리닝 통과 후보)
        {/* Phase 7: the raw method-version identifier is demoted out of the visible
            sentence, matching how Phase 6 moved the analysis version strings into a
            technical layer. The value itself is unchanged and still rendered. */}
        {methodVersion ? (
          <span className="ml-1 break-all text-slate-400" data-diagnostic>
            (방법 버전 {String(methodVersion)})
          </span>
        ) : null}
      </p>
      <p className="mt-0.5 tabular-nums">
        가중치: Z {w.zoning} · R {w.road} · E {w.equity} · D {w.demand}
      </p>
      {zeroVar.length > 0 && (
        <p className="mt-0.5" data-testid="critic-zero-variance">
          분산 0(정보 없음)으로 가중치 0인 기준: {zeroVar.join(", ")}
        </p>
      )}
      <p className="mt-0.5">
        가중치는 이 실행의 완전한 스크리닝 통과 후보 점수의 분산·상관관계로 계산되며, 조닝/도로/형평성/수요의
        규범적 중요도가 아닌 선택된 데이터·분석 범위의 구조를 나타냅니다. 전문가 판단·법적 우선순위·보편적
        정책 중요도가 아닙니다.
      </p>
    </div>
  );
}

// Weight-sensitivity stability summary: stable/conditional/sensitive counts, the
// top-10% cutoff, the three compared profiles, and the sensitivity disclaimer.
function StabilitySummary({ summary }: { summary: SuitabilitySummary }) {
  return (
    <section
      className="rounded border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700"
      data-testid="stability-summary"
    >
      <h2 className="mb-1 text-sm font-semibold text-slate-800">
        기준을 바꿔도 상위권을 유지하는 정도
      </h2>
      <dl className="space-y-0.5" data-testid="stability-counts">
        <div>
          <dt className="inline font-medium">안정 후보: </dt>
          <dd className="inline">{formatCount(summary.candidate_count_stable)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">조건부 안정 후보: </dt>
          <dd className="inline">{formatCount(summary.candidate_count_conditionally_stable)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">가중치 민감 후보: </dt>
          <dd className="inline">{formatCount(summary.candidate_count_weight_sensitive)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">상위 기준: </dt>
          <dd className="inline">
            상위 10%, rank ≤ {summary.stability_top_cutoff_rank ?? "-"}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">비교 방식: </dt>
          <dd className="inline">baseline / equal / critic</dd>
        </div>
      </dl>
      <p className="mt-1 text-[11px] text-slate-500">
        안정 후보는 세 비교 방식 모두에서 상위 10%에 포함된 후보입니다. 가중치 변화에 덜 민감하다는
        뜻이며 최종 입지, 허가 가능성 또는 법적 적격성을 의미하지 않습니다.
      </p>
    </section>
  );
}

/**
 * The Phase 0 standing analytical-screening disclaimer for the map sub-views (후보지
 * 점수 / 가중치 바꿔보기). Rendered at the TOP of the suitability sidebar rather than as
 * a full-width header row, because the map sub-views guarantee the map starts
 * immediately below the sub-view bar and fills the viewport (e2e/desktopNavigation +
 * responsive); a full-width band there would open a gap above the map and shrink it
 * below its dominant height. In the sidebar it is visible near the top of the view on
 * both desktop and mobile (the sidebar stacks above the map on mobile) without
 * obstructing the map. It is a neutral `InfoBanner` (tone `info`, never
 * `role="alert"`) with a text severity label, inside an aria-labelled landmark. The
 * 비용 살펴보기 (cost) sub-view has no sidebar, so it renders the SAME shared string in
 * its own top notice (FacilityCostDashboard). It never appears in the equity map.
 */
function SuitabilityScreeningNotice() {
  return (
    <section aria-label="후보지 분석 안내" data-testid="suitability-screening-notice">
      <InfoBanner
        tone="info"
        title={SUITABILITY_SCREENING_DISCLAIMER_TITLE}
        testId="suitability-screening-disclaimer"
      >
        <p>{SUITABILITY_SCREENING_DISCLAIMER}</p>
      </InfoBanner>
    </section>
  );
}

/**
 * "현재 분석에 포함되지 않은 항목" — the Phase 0 disclosure of the physical /
 * environmental / legal conditions the current regional screening does NOT yet
 * evaluate. A compact, collapsible native <details> (keyboard reachable); the title
 * and the core limitation stay discoverable while collapsed. It lists the shared
 * `UNMODELED_SUITABILITY_FACTORS` and states that a missing value is NEVER treated as
 * 0 or as a safe condition — it shows no fake value, placeholder score, or completion
 * percentage. Rendered in the score-view methodology AND the candidate detail panel.
 */
function UnmodeledFactorsDisclosure({ testId }: { testId: string }) {
  return (
    <details
      className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
      data-testid={testId}
    >
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        {UNMODELED_SUITABILITY_TITLE}
      </summary>
      <ul className="mt-2 list-disc space-y-0.5 pl-4" data-testid={`${testId}-list`}>
        {UNMODELED_SUITABILITY_FACTORS.map((factor) => (
          <li key={factor}>{factor}</li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-slate-500">{UNMODELED_SUITABILITY_NOTE}</p>
    </details>
  );
}

function SuitabilityPanel({
  suit,
  suitError,
  profile,
  setProfile,
  runProfiles,
  stabilityAvailable,
  selected,
  clearSelected,
  onSelect,
}: {
  suit: SuitabilityMeta | null;
  suitError: string | null;
  profile: SuitabilityProfile;
  setProfile: (p: SuitabilityProfile) => void;
  runProfiles: SuitabilityProfile[];
  stabilityAvailable: boolean;
  selected: CandidateDetail | null;
  clearSelected: () => void;
  onSelect: (id: number) => void;
}) {
  if (suitError) {
    return (
      <section
        className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-slate-700"
        data-testid="suitability-error"
      >
        <h2 className="mb-1 text-sm font-semibold text-slate-800">후보지 점수</h2>
        <p>{suitError}</p>
      </section>
    );
  }
  if (suit === null) {
    return (
      <p className="text-sm text-slate-600" data-testid="suitability-loading">
        후보지 분석을 불러오는 중…
      </p>
    );
  }
  const s = suit.summary;
  return (
    <>
      {/* Screen-reader status: announced when the weight profile changes and when
          the candidate summary updates (both change this text). Kept concise to
          avoid verbose repetition; the same counts are shown visibly below. */}
      <p role="status" className="sr-only" data-testid="suitability-live">
        점수 반영 기준 {profileLabel(profile)}. {statusLabel("ELIGIBLE")}{" "}
        {formatCount(s.candidate_count_eligible)}개, {statusLabel("REVIEW_REQUIRED")}{" "}
        {formatCount(s.candidate_count_review)}개.
      </p>
      <section
        className="rounded border border-slate-300 bg-slate-50 p-3 text-xs break-words text-slate-700"
        data-testid="suitability-summary"
      >
        <h2 className="mb-1 text-sm font-semibold text-slate-800">후보지 점수 요약</h2>
        <p className="mb-2 font-medium text-amber-800">
          이 결과는 공공자료를 이용한 1차 비교이며 실제 입지 결정이 아닙니다. &apos;통과&apos;는 법적
          적격을 의미하지 않습니다.
        </p>
        <dl className="space-y-1">
          <div>
            <dt className="inline font-medium">후보 구역: </dt>
            <dd className="inline" data-testid="candidate-counts">
              전체 {formatCount(s.candidate_count_total)} · {statusLabel("ELIGIBLE")}{" "}
              {formatCount(s.candidate_count_eligible)} · {statusLabel("REVIEW_REQUIRED")}{" "}
              {formatCount(s.candidate_count_review)} · {statusLabel("EXCLUDED")}{" "}
              {formatCount(s.candidate_count_excluded)}
            </dd>
          </div>
        </dl>
        {/* Phase 0: what each screening status means, from the shared glossary. A
            compact <details> (keyboard reachable) so the meaning is one click away in
            the same place the counts appear; the labels themselves are already plain. */}
        <details className="mt-2" data-testid="status-explanations">
          <summary className="cursor-pointer font-medium text-slate-600">상태 설명 보기</summary>
          <dl className="mt-1 space-y-1 text-[11px] text-slate-600">
            {(["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"] as SuitabilityStatus[]).map((st) => (
              <div key={st} data-testid={`status-explanation-${st}`}>
                <dt className="inline font-semibold">{statusLabel(st)}: </dt>
                <dd className="inline">{statusExplanation(st)}</dd>
              </div>
            ))}
          </dl>
        </details>
        {/* Technical run/version provenance moved behind a disclosure (progressive
            disclosure) — the citizen sees the counts first; the analyst opens this. */}
        <details className="mt-2">
          <summary className="cursor-pointer font-medium text-slate-600">분석 정보 자세히 보기</summary>
          <dl className="mt-1 space-y-1 text-[11px] text-slate-500">
            <div>
              <dt className="inline font-medium">분석 실행: </dt>
              <dd className="inline">
                #{suit.run.id} · 기준연도 {suit.run.reference_year} · 경계 {suit.run.boundary_vintage}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">버전: </dt>
              <dd className="inline">
                분석 규칙 {suit.policy.policy_version} · 계산 방식 {suit.policy.derivation_version} ·
                분석 구역 {suit.policy.candidate_grid_version}
              </dd>
            </div>
          </dl>
        </details>
      </section>

      <section aria-label="점수 반영 기준" data-testid="profile-selector">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">점수 반영 기준</h2>
        <div className="flex flex-col gap-1">
          {PROFILES.filter((p) => runProfiles.includes(p.key)).map((p) => {
            // Display the ACTUAL run weights (run-specific for critic), falling back
            // to the policy static weights only for a pre-CRITIC run whose stored
            // weight_profiles were never populated. Never a fixed critic constant.
            const w =
              (suit.run.weight_profiles ?? {})[p.key] ?? suit.policy.weight_profiles[p.key] ?? {};
            return (
              <label key={p.key} className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="profile"
                  className="mt-1"
                  checked={profile === p.key}
                  onChange={() => setProfile(p.key)}
                  data-testid={`profile-radio-${p.key}`}
                />
                <span>
                  {p.label}
                  <span className="mt-0.5 block text-[11px] text-slate-500">{p.method}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">{namedWeights(w)}</span>
                </span>
              </label>
            );
          })}
        </div>
        {/* Distinguish the fixed policy-assumption bases from the data-distribution one. */}
        <p className="mt-1 text-xs text-slate-500">
          기본·모두 똑같이·지역 부담 중심·도로 근접성 중심은 <strong>운영 가정</strong>으로 정한 고정
          비율이며 전문가 AHP 결과가 아닙니다. <strong>데이터 분포 기준</strong>은 이 분석 실행의 후보
          점수 분포에서 자동 계산된 비율입니다.
        </p>
        {stabilityAvailable ? (
          <CriticMethodNote run={suit.run} />
        ) : (
          <p
            className="mt-1 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-slate-600"
            data-testid="critic-unavailable"
          >
            {OLD_RUN_NO_CRITIC_MESSAGE}
          </p>
        )}
      </section>

      {stabilityAvailable ? (
        <StabilitySummary summary={s} />
      ) : (
        <section
          className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
          data-testid="stability-unavailable"
        >
          <h2 className="mb-1 text-sm font-semibold text-slate-800">
            기준을 바꿔도 상위권을 유지하는 정도
          </h2>
          <p>{OLD_RUN_NO_CRITIC_MESSAGE}</p>
        </section>
      )}

      {stabilityAvailable && s.top_stable_candidates.length > 0 && (
        <section aria-label="안정 후보" data-testid="stable-candidates">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">
            기준을 바꿔도 상위권인 후보지
          </h2>
          <ol className="flex flex-col gap-1 text-xs text-slate-700">
            {s.top_stable_candidates.map((c) => {
              const isSelected = selected?.candidate_id === Number(c.candidate_id);
              return (
                <li key={String(c.candidate_id)}>
                  <button
                    type="button"
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => onSelect(Number(c.candidate_id))}
                    className={`w-full rounded px-2 py-1 text-left ${
                      isSelected ? "bg-sky-100 ring-2 ring-sky-500" : "bg-slate-50 hover:bg-slate-100"
                    }`}
                    data-testid="stable-candidate-item"
                  >
                    {isSelected && (
                      <span className="mr-1 font-semibold text-sky-700">✓ 선택됨</span>
                    )}
                    <span className="font-medium">#{String(c.rank)}</span> ·{" "}
                    {String(c.sigungu ?? "")} · {String(c.total_score)}점{" "}
                    <StabilityBadge
                      stabilityClass={String(c.stability_class)}
                      stableCount={Number(c.stable_count)}
                    />
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* The status filter + score legend now float over the map (MapLegendOverlay);
          they are no longer duplicated in this panel. The map's candidate layer and
          the floating checkboxes share the same canonical statusVisibility state. */}

      <section aria-label="상위 후보" data-testid="top-candidates">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">
          상위 후보지 · {profileLabel(profile)} 기준
        </h2>
        {s.top_candidates.length === 0 ? (
          <p className="text-xs text-slate-500">이 프로파일의 순위 후보가 없습니다.</p>
        ) : (
          <ol className="flex flex-col gap-1 text-xs text-slate-700">
            {s.top_candidates.map((c) => {
              const isSelected = selected?.candidate_id === Number(c.candidate_id);
              return (
              <li key={String(c.candidate_id)}>
                <button
                  type="button"
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => onSelect(Number(c.candidate_id))}
                  className={`w-full rounded px-2 py-1 text-left ${
                    isSelected
                      ? "bg-sky-100 ring-2 ring-sky-500"
                      : "bg-slate-50 hover:bg-slate-100"
                  }`}
                  data-testid="top-candidate-item"
                >
                  {/* Selection is conveyed by text + a ring, never color alone. */}
                  {isSelected && (
                    <span className="mr-1 font-semibold text-sky-700" data-testid="top-candidate-selected">
                      ✓ 선택됨
                    </span>
                  )}
                  <span className="font-medium">#{String(c.rank)}</span> ·{" "}
                  {String(c.sigungu ?? "")} · {String(c.total_score)}점{" "}
                  {c.stability_class != null && c.stable_count != null && (
                    <StabilityBadge
                      stabilityClass={String(c.stability_class)}
                      stableCount={Number(c.stable_count)}
                    />
                  )}
                </button>
              </li>
              );
            })}
          </ol>
        )}
        <div className="mt-1 text-xs text-slate-500" data-testid="candidate-vector-note">
          <p>
            전체 후보 구역 {formatCount(s.candidate_count_total)}개가 모두 지도에 표시됩니다. 표시
            개수 제한 없이 전체 자료를 볼 수 있고, 화면에 보이는 부분만 빠르게 불러옵니다.
          </p>
          <p className="mt-0.5">
            {statusLabel("ELIGIBLE")} {formatCount(s.candidate_count_eligible)} ·{" "}
            {statusLabel("REVIEW_REQUIRED")} {formatCount(s.candidate_count_review)} ·{" "}
            {statusLabel("EXCLUDED")} {formatCount(s.candidate_count_excluded)} — 상태 필터는 지도에
            함께 적용됩니다. 공공자료 기반 1차 비교이며 실제 입지 결정이 아닙니다.
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-slate-500">자세히 보기</summary>
            <p className="mt-1 text-[11px] text-slate-400">
              지도는 화면에 필요한 부분만 벡터 타일(MVT)로 전송해 빠르게 표시합니다.
            </p>
          </details>
        </div>
      </section>

      <ReasonSummary title="현재 기준에서 제외된 사유" counts={s.exclusion_reason_counts} />
      <ReasonSummary title="추가 확인이 필요한 사유" counts={s.review_reason_counts} />

      {s.coverage_notes.length > 0 && (
        <section
          className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-slate-700"
          data-testid="coverage-warnings"
        >
          <h2 className="mb-1 text-sm font-semibold text-slate-800">
            자료 공백 안내
          </h2>
          <ul className="list-disc space-y-1 pl-4">
            {s.coverage_notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <p className="mt-1">
            자료가 없는 항목은 공백이며 &quot;해당 없음&quot;을 확인한 것이 아닙니다.
          </p>
        </section>
      )}

      {selected && (
        <CandidateDetailPanel detail={selected} clearSelected={clearSelected} />
      )}

      <section className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">계산 방법과 가정</h2>
        <ul className="list-disc space-y-1 pl-4">
          {s.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <p className="mt-2 font-medium text-amber-800" data-testid="suitability-disclaimer">
          {s.disclaimer}
        </p>
      </section>

      {/* Phase 0: what the current regional screening does NOT yet evaluate. */}
      <UnmodeledFactorsDisclosure testId="suitability-unmodeled-factors" />
    </>
  );
}

function ReasonSummary({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <section className="text-xs text-slate-700">
      <h2 className="mb-1 text-sm font-semibold text-slate-800">{title}</h2>
      <ul className="flex flex-col gap-0.5">
        {entries.map(([reason, count]) => (
          <li key={reason} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">{reason}</span>
            <span className="text-slate-500">{formatCount(count)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CandidateDetailPanel({
  detail,
  clearSelected,
}: {
  detail: CandidateDetail;
  clearSelected: () => void;
}) {
  const eq = detail.raw_components?.equity as Record<string, unknown> | undefined;
  const dem = detail.raw_components?.demand as Record<string, unknown> | undefined;
  const equityKind = classifyEquityRaw(eq);
  return (
    <section
      className="rounded border border-sky-300 bg-sky-50 p-3 text-xs break-words text-slate-700"
      data-testid="candidate-detail"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">후보 구역 상세</h2>
        <button type="button" onClick={clearSelected} className="text-slate-400 hover:text-slate-700">
          닫기 ✕
        </button>
      </div>
      <p className="mt-1">
        <strong>{detail.sigungu_region_name ?? "(지역 미배정)"}</strong> · {statusLabel(detail.status)}
      </p>
      {/* Phase 0: the plain meaning of this candidate's screening status, so the
          reader is not left to infer it from the label alone. */}
      <p className="mt-0.5 text-[11px] text-slate-500" data-testid="candidate-status-explanation">
        {statusExplanation(detail.status)}
      </p>
      <p className="mt-0.5 font-mono text-[11px] break-all text-slate-400">
        구역 식별키 {detail.candidate_key}
      </p>
      {detail.status === "EXCLUDED" ? (
        <div className="mt-1" data-testid="candidate-exclusion-reasons">
          <p className="font-medium">제외 사유:</p>
          <ul className="list-disc pl-4">
            {detail.exclusion_reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="mt-1 text-slate-500">제외 셀은 점수·순위가 없습니다.</p>
        </div>
      ) : (
        <>
          <p className="mt-1">
            {detail.status === "ELIGIBLE" ? (
              <>
                점수 <strong>{detail.total_score}</strong> · 순위 {detail.rank ?? "-"}
              </>
            ) : (
              <>
                잠정 점수 <strong>{detail.provisional_score ?? "-"}</strong> · 순위 없음 (검토 필요)
              </>
            )}
          </p>
          <p className="mt-1 tabular-nums" data-testid="candidate-selected-weights">
            선택 프로파일 <strong>{detail.profile}</strong> — 가중치 Z {detail.weights.zoning} · R{" "}
            {detail.weights.road} · E {detail.weights.equity} · D {detail.weights.demand}
          </p>
          {/* Component labels are the Phase 0 citizen-facing terms from the central
              glossary ("용도지역 호환성", "도로 근접성 대리지표", …); the raw scores
              and their meaning are unchanged. */}
          <table className="mt-1 w-full text-left">
            <caption className="sr-only">구성요소별 점수</caption>
            <tbody>
              <tr>
                <td>{COMPONENT_META.zoning.primary}</td>
                <td>{detail.zoning_score ?? "-"}</td>
              </tr>
              <tr>
                <td>{COMPONENT_META.road.primary}</td>
                <td>{detail.road_score ?? "-"}</td>
              </tr>
              <tr>
                <td>{COMPONENT_META.equity.primary}</td>
                <td>{detail.equity_score ?? "-"}</td>
              </tr>
              <tr>
                <td>{COMPONENT_META.demand.primary}</td>
                <td>{detail.demand_score ?? "-"}</td>
              </tr>
            </tbody>
          </table>
          {detail.review_reasons.length > 0 && (
            <p className="mt-1" data-testid="candidate-review-reasons">
              검토 사유: {detail.review_reasons.join(", ")}
            </p>
          )}
          <p className="mt-1">
            최근접 도로: {detail.nearest_road_distance_m ?? "-"} m ·{" "}
            {String(detail.nearest_road_provenance?.official_layer_code ?? "")} (근접성 대리지표, 차량
            진입 보장 아님)
          </p>
          {eq && (
            <div className="mt-1" data-testid="candidate-equity-raw">
              <p>
                형평성 원자료(소재 시설 부담): <strong>{String(eq.located_burden_kg_per_capita)}</strong>{" "}
                {String(eq.unit)} · {accountingBasisLabel(String(eq.accounting_basis))} · {String(eq.source_id)} (
                {String(eq.reference_period)})
              </p>
              <p className="text-slate-500" data-testid="equity-score-direction">
                점수 방향: 시설 부담이 낮을수록 형평성 점수가 높습니다. 형평성 점수{" "}
                <strong>{detail.equity_score ?? "-"}</strong>.
              </p>
              {equityKind === "PARTIAL" && (
                <p className="text-amber-700" data-testid="equity-partial">
                  일부 시설 처리량 결측 {String(eq.missing_throughput_count)}건 — 부담이 과소집계이며
                  추정하지 않습니다.
                </p>
              )}
              {equityKind === "OFFICIAL_ZERO" && (
                <p className="text-slate-500" data-testid="equity-zero-note">
                  소재 시설 {String(eq.facility_count_located)}개 · 결측 0건. 값 0은 공식 측정값 0이며
                  결측이 아닙니다.
                </p>
              )}
              {equityKind === "MEASURED_VALUE" && (
                <p className="text-slate-500" data-testid="equity-measured-note">
                  소재 시설 {String(eq.facility_count_located)}개 · 결측 0건 (측정값).
                </p>
              )}
            </div>
          )}
          {dem && (
            <div className="mt-1" data-testid="candidate-demand-raw">
              <p>
                수요 원자료: {String(dem.household_per_capita_kg_per_year)} {String(dem.unit)} ·{" "}
                {accountingBasisLabel(String(dem.accounting_basis))} · {String(dem.source_id)} (
                {String(dem.reference_period)})
              </p>
              <p className="text-slate-500" data-testid="demand-score-direction">
                점수 방향: 1인당 발생량이 높을수록 수요 점수가 높습니다. 수요 점수{" "}
                <strong>{detail.demand_score ?? "-"}</strong>.
              </p>
            </div>
          )}
          <div className="mt-2" data-testid="candidate-sensitivity">
            <p className="font-medium">프로파일별 민감도 (sensitivity):</p>
            <ul className="pl-2">
              {Object.keys(detail.profile_totals).map((p) => (
                <li key={p}>
                  {p}: 점수 {detail.profile_totals[p] ?? "-"} · 순위 {detail.profile_ranks[p] ?? "-"}
                </li>
              ))}
            </ul>
          </div>
          {detail.status === "ELIGIBLE" && detail.stable_count != null ? (
            <div className="mt-2" data-testid="candidate-stability">
              <p className="font-medium">
                가중치 민감도 안정성:{" "}
                <StabilityBadge
                  stabilityClass={String(detail.stability_class)}
                  stableCount={detail.stable_count}
                />
              </p>
              <ul className="pl-2">
                {["baseline", "equal", "critic"].map((p) => (
                  <li key={p}>
                    {p}: {detail.stability_membership[p] ? "상위 10% 포함" : "미포함"}
                  </li>
                ))}
              </ul>
              <p className="mt-0.5 text-[11px] text-slate-500">
                안정성은 세 비교 방식(baseline·equal·critic) 상위 10% 포함 여부를 나타내는 민감도
                지표이며, 최종 입지·허가·법적 적격성을 의미하지 않습니다.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-slate-500" data-testid="candidate-stability-na">
              안정성 평가 대상 아님 (스크리닝 통과 후보만 평가)
            </p>
          )}
        </>
      )}
      {/* Phase 0: the same "not yet included" disclosure, so a reader inspecting one
          candidate sees the screening's limits without leaving the panel. */}
      <div className="mt-2">
        <UnmodeledFactorsDisclosure testId="candidate-unmodeled-factors" />
      </div>
      <p className="mt-2 text-slate-500">{detail.disclaimer}</p>
    </section>
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

function DerivedPanel({ info, caveat }: { info: DerivedInfo; caveat?: string }) {
  return (
    <section
      aria-label="파생 지표 출처"
      className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-slate-700"
      data-testid="derived-metric-metadata"
    >
      {/* Korean-only primary heading (Phase 4). The technical framing stays in the
          method/derivation detail rendered below — nothing was removed. */}
      <h2 className="mb-1 text-sm font-semibold text-ink">파생 지표</h2>
      <p className="mb-2 text-xs text-slate-600">
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
      {caveat && <p className="mt-2 font-medium text-amber-800">{caveat}</p>}
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
