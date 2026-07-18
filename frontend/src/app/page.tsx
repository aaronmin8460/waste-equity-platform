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

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import {
  ApiError,
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
  fetchWastePerCapita,
  fetchWasteStatistics,
  suitabilityTileUrl,
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
  type WasteStatisticsItem,
} from "../lib/api";
import {
  CANDIDATE_SCORE_BREAKS,
  CANDIDATE_SCORE_PALETTE_5,
  METRICS,
  NO_DATA_COLOR,
  formatCount,
  formatLegendValue,
  formatQuantity,
  frequencyLabel,
  resolveActiveScale,
  scaleConfigForMetric,
  scaleMethodNote,
  type MetricKey,
} from "../lib/metrics";
import type { MapMode, RegionDisplayValue, StatusVisibility } from "../components/MapView";
import type { LandfillDashboardData } from "../components/LandfillDashboard";
import LandfillDashboard from "../components/LandfillDashboard";
import { classifyEquityRaw, topCandidateCellLabel } from "../lib/suitability";

const MapView = dynamic(() => import("../components/MapView"), { ssr: false });

/**
 * Every selectable mode. `MapMode` is the subset that renders a map; "flow" (the
 * 수도권매립지 inbound dashboard) deliberately has none, so the two types are
 * kept distinct rather than letting a non-map mode reach MapView.
 */
type DashboardMode = MapMode | "flow";

const PROFILES: { key: SuitabilityProfile; label: string }[] = [
  { key: "baseline", label: "기본 (baseline)" },
  { key: "equal", label: "균등 (equal)" },
  { key: "equity_focused", label: "형평성 중심 (equity)" },
  { key: "access_focused", label: "접근성 중심 (access)" },
];

const STATUS_LABELS: Record<SuitabilityStatus, string> = {
  ELIGIBLE: "적합 (eligible)",
  REVIEW_REQUIRED: "검토 필요 (review)",
  EXCLUDED: "제외 (excluded)",
};

interface LoadedData {
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

  // Capital-region landfill inbound dashboard (서울·인천·경기 → 수도권매립지) state.
  const [flowYear, setFlowYear] = useState<number | null>(null); // null = latest complete year
  const [flowMonth, setFlowMonth] = useState<number | null>(null); // null = annual
  const [flowOrigin, setFlowOrigin] = useState<LandfillOrigin | null>(null);
  const [flowWaste, setFlowWaste] = useState<string | null>(null);
  const [flowData, setFlowData] = useState<LandfillDashboardData | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [suit, setSuit] = useState<SuitabilityMeta | null>(null);
  const [suitError, setSuitError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CandidateDetail | null>(null);
  const [statusVisibility, setStatusVisibility] = useState<StatusVisibility>({
    ELIGIBLE: true,
    REVIEW_REQUIRED: true,
    EXCLUDED: false,
  });

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
            ? cause.message
            : "백엔드에 연결할 수 없습니다 (backend unreachable).",
        );
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
            ? cause.status === 404
              ? "아직 적합성 분석 실행 결과가 없습니다 (no suitability analysis run yet)."
              : cause.message
            : "적합성 데이터를 불러올 수 없습니다.",
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
    Promise.all([
      fetchLandfillSummary({
        year: flowYear,
        month: flowMonth,
        origin: flowOrigin,
        wasteName: flowWaste,
      }),
      fetchLandfillTrends(trendsQuery),
      fetchLandfillComposition({ year: flowYear, origin: flowOrigin }),
    ])
      .then(([summary, trends, composition]) => {
        if (cancelled) return;
        setFlowData({ summary, trends, composition });
        setFlowError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Drop the previous filter selection's values: leaving them on screen
        // under the new filters would misattribute official data to a period or
        // region it does not describe.
        setFlowData(null);
        setFlowError(
          cause instanceof ApiError
            ? cause.message
            : "수도권매립지 데이터를 불러올 수 없습니다 (landfill data unavailable).",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [mode, flowYear, flowMonth, flowOrigin, flowWaste]);

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

  // Immutable vector-tile URL for the active run + profile. Switching the profile
  // re-points the map's vector source at the new tiles; there is no run to render
  // outside suitability mode.
  const candidateTileUrl = useMemo(
    () => (mode === "suitability" && suit ? suitabilityTileUrl(suit.run.id, profile) : null),
    [mode, suit, profile],
  );

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

  if (error !== null) {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-100 p-8">
        <div className="max-w-lg rounded-lg border border-red-300 bg-white p-6 shadow" role="alert">
          <h1 className="text-lg font-semibold text-red-700">데이터를 불러올 수 없습니다</h1>
          <p className="mt-2 text-sm text-slate-700">{error}</p>
          <p className="mt-2 text-sm text-slate-500">
            공식 데이터를 불러오지 못하면 지도는 표시되지 않습니다. 대체 데이터는 사용하지 않습니다.
            (No fallback data is shown.)
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 rounded bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
          >
            다시 시도 (Retry)
          </button>
        </div>
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-600" data-testid="loading">
          공식 데이터를 불러오는 중… (Loading official data…)
        </p>
      </main>
    );
  }

  // 수도권매립지 mode: a full-width dashboard with no map and no sidebar. The
  // early return also narrows `mode` to MapMode for the map layout below, so a
  // non-map mode cannot reach MapView.
  if (mode === "flow") {
    return (
      <div className="min-h-screen bg-slate-100">
        <div className="mx-auto w-full max-w-screen-2xl px-4 pt-6 sm:px-6 lg:px-8">
          <ModeSwitch mode={mode} setMode={setMode} />
        </div>
        <LandfillDashboard
          data={flowData}
          error={flowError}
          year={flowYear}
          setYear={setFlowYear}
          month={flowMonth}
          setMonth={setFlowMonth}
          origin={flowOrigin}
          setOrigin={setFlowOrigin}
          waste={flowWaste}
          setWaste={setFlowWaste}
        />
      </div>
    );
  }

  // Legend rows read the exact active palette + breaks the map fill uses, so the
  // swatch count (effective classes) and colors always match the polygons.
  const legendRows = activeScale.palette.map((color, index) => {
    const lower = index === 0 ? null : activeScale.breaks[index - 1];
    const upper = index < activeScale.breaks.length ? activeScale.breaks[index] : null;
    const label =
      lower === null
        ? `< ${upper === null ? "…" : formatLegendValue(upper)}`
        : upper === null
          ? `≥ ${formatLegendValue(lower)}`
          : `${formatLegendValue(lower)} – ${formatLegendValue(upper)}`;
    return { color, label };
  });

  return (
    <main className="flex h-screen">
      <aside className="flex w-96 flex-col gap-4 overflow-y-auto border-r border-slate-200 bg-white p-5">
        <header>
          <h1 className="text-lg font-bold text-slate-900">수도권 폐기물 형평성·적합성 지도</h1>
          <p className="text-xs text-slate-500">
            Waste Equity Platform — Seoul · Incheon · Gyeonggi-do
          </p>
        </header>

        <ModeSwitch mode={mode} setMode={setMode} />

        {mode === "equity" && (
          <>
            <section aria-label="지표 선택">
              <h2 className="mb-2 text-sm font-semibold text-slate-800">
                지역 지표 (Regional metric)
              </h2>
              <div className="flex flex-col gap-1">
                {METRICS.map((candidate) => (
                  <label
                    key={candidate.key}
                    className="flex items-start gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="radio"
                      name="metric"
                      className="mt-1"
                      checked={metricKey === candidate.key}
                      onChange={() => setMetricKey(candidate.key)}
                    />
                    <span>{candidate.label}</span>
                  </label>
                ))}
              </div>
            </section>

            <section aria-label="범례" data-testid="legend">
              <h2 className="mb-2 text-sm font-semibold text-slate-800">
                범례 (Legend){unit ? ` — ${unit}` : ""}
              </h2>
              <p
                className="mb-2 text-[11px] text-slate-500"
                data-testid="choropleth-scale-method"
              >
                {scaleMethodNote(activeScale)}
              </p>
              <ul className="flex flex-col gap-1" data-testid="choropleth-legend">
                {legendRows.map((row) => (
                  <li
                    key={row.color}
                    className="flex items-center gap-2 text-xs text-slate-600"
                    data-testid="choropleth-legend-row"
                  >
                    <span
                      className="inline-block h-4 w-6 rounded-sm border border-slate-300"
                      style={{ backgroundColor: row.color }}
                    />
                    {row.label}
                  </li>
                ))}
                <li className="flex items-center gap-2 text-xs text-slate-600">
                  <span
                    className="inline-block h-4 w-6 rounded-sm border border-slate-300"
                    style={{ backgroundColor: NO_DATA_COLOR }}
                  />
                  데이터 없음 (no served value)
                </li>
              </ul>
            </section>

            {derivedInfo && <DerivedPanel info={derivedInfo} caveat={metric.caveat} />}
            {sourceInfo && <SourcePanel info={sourceInfo} boundaries={activeBoundaries} />}

            <section aria-label="시설 레이어">
              <h2 className="mb-2 text-sm font-semibold text-slate-800">
                폐기물 처리시설 (Treatment facilities)
              </h2>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={showFacilities}
                  onChange={(event) => setShowFacilities(event.target.checked)}
                  data-testid="facilities-toggle"
                />
                시설 위치 표시 (show facility points)
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
                  <p className="mt-1">집계 기준: {facilitySummary.accountingBasis}</p>
                </div>
              )}
            </section>
          </>
        )}

        {mode === "suitability" && (
          <SuitabilityPanel
            suit={suit}
            suitError={suitError}
            profile={profile}
            setProfile={setProfile}
            statusVisibility={statusVisibility}
            setStatusVisibility={setStatusVisibility}
            selected={selected}
            clearSelected={() => setSelected(null)}
            onSelect={onCandidateClick}
          />
        )}

      </aside>

      <div className="min-w-0 flex-1">
        <MapView
          boundaries={activeBoundaries}
          regionValues={regionValues}
          breaks={activeScale.breaks}
          palette={activeScale.palette}
          metricLabel={metric.label}
          metricUnit={unit}
          facilities={data.facilities.items}
          showFacilities={showFacilities}
          mode={mode}
          candidateTileUrl={candidateTileUrl}
          candidateBreaks={CANDIDATE_SCORE_BREAKS}
          statusVisibility={statusVisibility}
          selectedCandidate={selected}
          onCandidateClick={onCandidateClick}
        />
      </div>
    </main>
  );
}

// --------------------------------------------------------------------------- //
// Mode switch — rendered in the sidebar for the two map modes, and above the
// full-width dashboard in 수도권매립지 mode, so it stays reachable everywhere.
// --------------------------------------------------------------------------- //

const MODE_BUTTONS: { key: DashboardMode; label: string; testId: string }[] = [
  { key: "equity", label: "형평성 (Equity)", testId: "mode-equity" },
  { key: "suitability", label: "적합성 (Suitability)", testId: "mode-suitability" },
  { key: "flow", label: "수도권매립지 이동", testId: "mode-flow" },
];

function ModeSwitch({
  mode,
  setMode,
}: {
  mode: DashboardMode;
  setMode: (m: DashboardMode) => void;
}) {
  return (
    <section aria-label="모드 선택">
      <h2 className="mb-2 text-sm font-semibold text-slate-800">모드 (Mode)</h2>
      <div className="flex flex-wrap gap-1" role="radiogroup" data-testid="mode-switch">
        {MODE_BUTTONS.map((button) => (
          <button
            key={button.key}
            type="button"
            aria-pressed={mode === button.key}
            onClick={() => setMode(button.key)}
            className={`rounded px-3 py-1 text-sm ${
              mode === button.key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"
            }`}
            data-testid={button.testId}
          >
            {button.label}
          </button>
        ))}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Suitability panel
// --------------------------------------------------------------------------- //

function SuitabilityPanel({
  suit,
  suitError,
  profile,
  setProfile,
  statusVisibility,
  setStatusVisibility,
  selected,
  clearSelected,
  onSelect,
}: {
  suit: SuitabilityMeta | null;
  suitError: string | null;
  profile: SuitabilityProfile;
  setProfile: (p: SuitabilityProfile) => void;
  statusVisibility: StatusVisibility;
  setStatusVisibility: (v: StatusVisibility) => void;
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
        <h2 className="mb-1 text-sm font-semibold text-slate-800">적합성 스크리닝 (Suitability)</h2>
        <p>{suitError}</p>
      </section>
    );
  }
  if (suit === null) {
    return (
      <p className="text-sm text-slate-600" data-testid="suitability-loading">
        적합성 분석을 불러오는 중… (Loading suitability analysis…)
      </p>
    );
  }
  const s = suit.summary;
  return (
    <>
      <section
        className="rounded border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700"
        data-testid="suitability-summary"
      >
        <h2 className="mb-1 text-sm font-semibold text-slate-800">적합성 스크리닝 (Suitability)</h2>
        <p className="mb-2 font-medium text-amber-800">
          분석용 스크리닝 결과입니다 — 법적 허가·인허가·최종 입지 결정이 아닙니다. &quot;적합&quot;은
          법적 적격을 의미하지 않습니다.
        </p>
        <dl className="space-y-1">
          <div>
            <dt className="inline font-medium">실행(run): </dt>
            <dd className="inline">
              #{suit.run.id} · 기준연도 {suit.run.reference_year} · 경계 {suit.run.boundary_vintage}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">버전: </dt>
            <dd className="inline">
              {suit.policy.policy_version} · {suit.policy.derivation_version} ·{" "}
              {suit.policy.candidate_grid_version}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">후보 셀: </dt>
            <dd className="inline" data-testid="candidate-counts">
              총 {formatCount(s.candidate_count_total)} · 적합{" "}
              {formatCount(s.candidate_count_eligible)} · 검토{" "}
              {formatCount(s.candidate_count_review)} · 제외{" "}
              {formatCount(s.candidate_count_excluded)}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label="가중치 프로파일" data-testid="profile-selector">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">가중치 프로파일 (Weight profile)</h2>
        <div className="flex flex-col gap-1">
          {PROFILES.map((p) => (
            <label key={p.key} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="profile"
                checked={profile === p.key}
                onChange={() => setProfile(p.key)}
              />
              <span>
                {p.label} — Z {suit.policy.weight_profiles[p.key]?.zoning} · R{" "}
                {suit.policy.weight_profiles[p.key]?.road} · E{" "}
                {suit.policy.weight_profiles[p.key]?.equity} · D{" "}
                {suit.policy.weight_profiles[p.key]?.demand}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">가중치는 가정입니다 (weights are assumptions).</p>
      </section>

      <section aria-label="상태 범례 및 필터" data-testid="suitability-legend">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">상태 (Status) · 점수 범례</h2>
        <div className="flex flex-col gap-1 text-xs text-slate-600">
          {(Object.keys(statusVisibility) as SuitabilityStatus[]).map((st) => (
            <label key={st} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={statusVisibility[st]}
                onChange={() =>
                  setStatusVisibility({ ...statusVisibility, [st]: !statusVisibility[st] })
                }
                data-testid={`status-toggle-${st}`}
              />
              <span
                className="inline-block h-4 w-6 rounded-sm border border-slate-300"
                style={{
                  backgroundColor:
                    st === "ELIGIBLE"
                      ? CANDIDATE_SCORE_PALETTE_5[3]
                      : st === "REVIEW_REQUIRED"
                        ? "#e8a33d"
                        : "#9aa2ad",
                }}
              />
              {STATUS_LABELS[st]}
            </label>
          ))}
          <p className="mt-1">적합 셀은 점수(0–100)로 음영, 검토 셀은 주황 점선, 제외 셀은 회색입니다.</p>
        </div>
      </section>

      <section aria-label="상위 후보" data-testid="top-candidates">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">
          상위 적합 후보 (Top eligible — {profile})
        </h2>
        {s.top_candidates.length === 0 ? (
          <p className="text-xs text-slate-500">이 프로파일의 순위 후보가 없습니다.</p>
        ) : (
          <ol className="flex flex-col gap-1 text-xs text-slate-700">
            {s.top_candidates.map((c) => (
              <li key={String(c.candidate_id)}>
                <button
                  type="button"
                  onClick={() => onSelect(Number(c.candidate_id))}
                  className="w-full rounded bg-slate-50 px-2 py-1 text-left hover:bg-slate-100"
                  data-testid="top-candidate-item"
                >
                  #{String(c.rank)} · {String(c.total_score)} · {String(c.sigungu ?? "")}{" "}
                  <span className="text-slate-400">
                    (Z {String(c.zoning_score)} R {String(c.road_score)} E {String(c.equity_score)} D{" "}
                    {String(c.demand_score)})
                  </span>
                  <span
                    className="mt-0.5 block font-mono text-[11px] text-slate-500"
                    data-testid="top-candidate-cell"
                  >
                    {topCandidateCellLabel(c)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-1 text-xs text-slate-500" data-testid="candidate-vector-note">
          <p>
            전체 후보 셀({formatCount(s.candidate_count_total)}개)은 현재 지도 영역에 필요한 벡터
            타일(MVT)로 표시됩니다 — 뷰포트 표시 개수 제한 없이 전체 데이터가 제공되며, 화면에 필요한
            타일만 전송됩니다. (전체 데이터 사용 가능; 뷰포트에 필요한 타일만 전송)
          </p>
          <p className="mt-0.5">
            적합 {formatCount(s.candidate_count_eligible)} · 검토{" "}
            {formatCount(s.candidate_count_review)} · 제외 {formatCount(s.candidate_count_excluded)} —
            상태 필터는 불러온 벡터 타일에 적용됩니다. 분석용 스크리닝이며 법적 입지 결정이 아닙니다.
          </p>
        </div>
      </section>

      <ReasonSummary title="제외 사유 (Exclusion reasons)" counts={s.exclusion_reason_counts} />
      <ReasonSummary title="검토 사유 (Review reasons)" counts={s.review_reason_counts} />

      {s.coverage_notes.length > 0 && (
        <section
          className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-slate-700"
          data-testid="coverage-warnings"
        >
          <h2 className="mb-1 text-sm font-semibold text-slate-800">
            데이터 공백 (Coverage warnings)
          </h2>
          <ul className="list-disc space-y-1 pl-4">
            {s.coverage_notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <p className="mt-1">
            OFFICIAL_SOURCE_UNAVAILABLE는 공백이며 &quot;해당 없음&quot;의 확인이 아닙니다 (never a
            confirmed absence).
          </p>
        </section>
      )}

      {selected && (
        <CandidateDetailPanel detail={selected} clearSelected={clearSelected} />
      )}

      <section className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">방법·가정 (Method)</h2>
        <ul className="list-disc space-y-1 pl-4">
          {s.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <p className="mt-2 font-medium text-amber-800" data-testid="suitability-disclaimer">
          {s.disclaimer}
        </p>
      </section>
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
            <span className="truncate">{reason}</span>
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
      className="rounded border border-sky-300 bg-sky-50 p-3 text-xs text-slate-700"
      data-testid="candidate-detail"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">후보 상세 (Candidate)</h2>
        <button type="button" onClick={clearSelected} className="text-slate-400 hover:text-slate-700">
          닫기 ✕
        </button>
      </div>
      <p className="mt-1">
        <strong>{detail.candidate_key}</strong> · {detail.status} ·{" "}
        {detail.sigungu_region_name ?? "(시군구 미배정)"}
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
          <table className="mt-1 w-full text-left">
            <tbody>
              <tr>
                <td>토지이용 Zoning</td>
                <td>{detail.zoning_score ?? "-"}</td>
              </tr>
              <tr>
                <td>도로접근 Road</td>
                <td>{detail.road_score ?? "-"}</td>
              </tr>
              <tr>
                <td>형평성 Equity</td>
                <td>{detail.equity_score ?? "-"}</td>
              </tr>
              <tr>
                <td>수요 Demand</td>
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
            {String(detail.nearest_road_provenance?.official_layer_code ?? "")} (접근성 프록시, 차량
            진입 보장 아님)
          </p>
          {eq && (
            <div className="mt-1" data-testid="candidate-equity-raw">
              <p>
                형평성 원자료(소재 시설 부담): <strong>{String(eq.located_burden_kg_per_capita)}</strong>{" "}
                {String(eq.unit)} · {String(eq.accounting_basis)} · {String(eq.source_id)} (
                {String(eq.reference_period)})
              </p>
              <p className="text-slate-500" data-testid="equity-score-direction">
                점수 방향(역방향): 시설 부담이 낮을수록 형평성 점수가 높습니다 (inverse — lower
                located-facility burden → higher equity score). 형평성 점수{" "}
                <strong>{detail.equity_score ?? "-"}</strong>.
              </p>
              {equityKind === "PARTIAL" && (
                <p className="text-amber-700" data-testid="equity-partial">
                  일부 시설 처리량 결측 {String(eq.missing_throughput_count)}건 — 부담이 과소집계이며
                  추정하지 않습니다 (partial; missing throughput is never estimated).
                </p>
              )}
              {equityKind === "OFFICIAL_ZERO" && (
                <p className="text-slate-500" data-testid="equity-zero-note">
                  소재 시설 {String(eq.facility_count_located)}개 · 결측 0건. 값 0은 공식 측정값 0이며
                  결측이 아닙니다 (official measured zero, not missing data).
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
                {String(dem.accounting_basis)} · {String(dem.source_id)} (
                {String(dem.reference_period)})
              </p>
              <p className="text-slate-500" data-testid="demand-score-direction">
                점수 방향(정방향): 1인당 발생량이 높을수록 수요 점수가 높습니다 (higher per-capita
                generation → higher demand score). 수요 점수 <strong>{detail.demand_score ?? "-"}</strong>.
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
        </>
      )}
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
      : "UNKNOWN";
    const populationCommon = {
      populationSourceName: populationRegistry?.source_name ?? "sgis",
      populationFrequency: populationRegistry
        ? frequencyLabel(populationRegistry.publication_frequency)
        : "UNKNOWN",
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
      <h2 className="mb-1 text-sm font-semibold text-slate-800">파생 지표 (Derived indicator)</h2>
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
          <dd className="inline">{info.accountingBasis}</dd>
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
      frequency: registry ? frequencyLabel(registry.publication_frequency) : "UNKNOWN",
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
      <h2 className="mb-1 text-sm font-semibold text-slate-800">지표 출처 (Metric source)</h2>
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
            <dd className="inline">{info.accountingBasis}</dd>
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
      frequency: registry ? frequencyLabel(registry.publication_frequency) : "UNKNOWN",
    };
  }, [data]);
}
