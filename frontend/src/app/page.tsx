"use client";

/**
 * Interactive map dashboard (Phase 4 equity + Phase 5.4 suitability).
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
  fetchBoundaries,
  fetchDataSources,
  fetchFacilities,
  fetchFacilityBurden,
  fetchPopulation,
  fetchSuitabilityCandidateDetail,
  fetchSuitabilityCandidates,
  fetchSuitabilityLatestRun,
  fetchSuitabilityPolicy,
  fetchSuitabilitySummary,
  fetchWastePerCapita,
  fetchWasteStatistics,
  type CandidateDetail,
  type DataSourceItem,
  type DatasetEnvelope,
  type EquityEnvelope,
  type FacilityBurdenEnvelope,
  type FacilityItem,
  type PopulationItem,
  type RegionBoundaryCollection,
  type SuitabilityCandidateCollection,
  type SuitabilityPolicy,
  type SuitabilityProfile,
  type SuitabilityRun,
  type SuitabilityStatus,
  type SuitabilitySummary,
  type WasteStatisticsItem,
} from "../lib/api";
import {
  CHOROPLETH_PALETTE,
  METRICS,
  NO_DATA_COLOR,
  computeBreaks,
  formatCount,
  formatLegendValue,
  formatQuantity,
  frequencyLabel,
  type MetricKey,
} from "../lib/metrics";
import type { RegionDisplayValue, StatusVisibility } from "../components/MapView";

const MapView = dynamic(() => import("../components/MapView"), { ssr: false });

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

  const [mode, setMode] = useState<"equity" | "suitability">("equity");
  const [profile, setProfile] = useState<SuitabilityProfile>("baseline");
  const [suit, setSuit] = useState<SuitabilityMeta | null>(null);
  const [suitError, setSuitError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SuitabilityCandidateCollection | null>(null);
  const [selected, setSelected] = useState<CandidateDetail | null>(null);
  const [bbox, setBbox] = useState<string | null>(null);
  const [statusVisibility, setStatusVisibility] = useState<StatusVisibility>({
    ELIGIBLE: true,
    REVIEW_REQUIRED: true,
    EXCLUDED: false,
  });

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetchBoundaries(),
      fetchPopulation(),
      fetchWasteStatistics(),
      fetchFacilities(),
      fetchWastePerCapita(),
      fetchFacilityBurden(),
      fetchDataSources(),
    ])
      .then(([boundaries, population, waste, facilities, perCapita, facilityBurden, sources]) => {
        setData({ boundaries, population, waste, facilities, perCapita, facilityBurden, sources });
      })
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

  // Refresh the summary when the profile changes.
  useEffect(() => {
    if (mode !== "suitability" || suit === null) return;
    fetchSuitabilitySummary(profile)
      .then((summary) => setSuit((prev) => (prev ? { ...prev, summary } : prev)))
      .catch(() => undefined);
  }, [profile, mode, suit]);

  // Candidate fetch: bbox + profile, debounced, cancelable, controlled limit.
  useEffect(() => {
    if (mode !== "suitability" || bbox === null || suit === null) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      fetchSuitabilityCandidates({ profile, bbox, limit: 2000 }, controller.signal)
        .then((coll) => setCandidates(coll))
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          if (cause instanceof ApiError && cause.status === 404) setCandidates(null);
        });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [mode, bbox, profile, suit]);

  const retry = useCallback(() => {
    setError(null);
    setData(null);
    load();
  }, [load]);

  const onViewportChange = useCallback((next: string) => setBbox(next), []);
  const onCandidateClick = useCallback(
    (id: number) => {
      fetchSuitabilityCandidateDetail(id, profile)
        .then(setSelected)
        .catch(() => undefined);
    },
    [profile],
  );

  const metric = METRICS.find((candidate) => candidate.key === metricKey) ?? METRICS[0];

  const { regionValues, unit } = useMemo(() => {
    const values = new Map<string, RegionDisplayValue>();
    if (!data) return { regionValues: values, unit: "" };
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

  const breaks = useMemo(
    () => computeBreaks([...regionValues.values()].map((value) => value.numeric)),
    [regionValues],
  );

  const candidateBreaks = useMemo(
    () =>
      computeBreaks(
        (candidates?.features ?? [])
          .filter((f) => !f.properties.is_excluded)
          .map((f) => Number(f.properties.total_score ?? f.properties.provisional_score ?? 0)),
      ),
    [candidates],
  );

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

  const legendRows = CHOROPLETH_PALETTE.slice(0, breaks.length + 1).map((color, index) => {
    const lower = index === 0 ? null : breaks[index - 1];
    const upper = index < breaks.length ? breaks[index] : null;
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

        <section aria-label="모드 선택">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">모드 (Mode)</h2>
          <div className="flex gap-1" role="radiogroup" data-testid="mode-switch">
            <button
              type="button"
              aria-pressed={mode === "equity"}
              onClick={() => setMode("equity")}
              className={`rounded px-3 py-1 text-sm ${mode === "equity" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              형평성 (Equity)
            </button>
            <button
              type="button"
              aria-pressed={mode === "suitability"}
              onClick={() => setMode("suitability")}
              className={`rounded px-3 py-1 text-sm ${mode === "suitability" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"}`}
              data-testid="mode-suitability"
            >
              적합성 (Suitability)
            </button>
          </div>
        </section>

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
              <ul className="flex flex-col gap-1">
                {legendRows.map((row) => (
                  <li key={row.color} className="flex items-center gap-2 text-xs text-slate-600">
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
            {sourceInfo && <SourcePanel info={sourceInfo} boundaries={data.boundaries} />}

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
            candidates={candidates}
            selected={selected}
            clearSelected={() => setSelected(null)}
            onSelect={onCandidateClick}
          />
        )}
      </aside>

      <div className="min-w-0 flex-1">
        <MapView
          boundaries={data.boundaries}
          regionValues={regionValues}
          breaks={breaks}
          metricLabel={metric.label}
          metricUnit={unit}
          facilities={data.facilities.items}
          showFacilities={showFacilities}
          mode={mode}
          candidates={candidates}
          candidateBreaks={candidateBreaks}
          statusVisibility={statusVisibility}
          onViewportChange={onViewportChange}
          onCandidateClick={onCandidateClick}
        />
      </div>
    </main>
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
  candidates,
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
  candidates: SuitabilityCandidateCollection | null;
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
                      ? CHOROPLETH_PALETTE[3]
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
                </button>
              </li>
            ))}
          </ol>
        )}
        {candidates && (
          <p className="mt-1 text-xs text-slate-500" data-testid="candidate-viewport-count">
            지도 영역 내 {formatCount(candidates.count)} / {formatCount(candidates.total_matched)}개
            표시 (뷰포트 제한).
          </p>
        )}
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
            <p className="mt-1">
              형평성 원자료: {String(eq.located_burden_kg_per_capita)} {String(eq.unit)} ·{" "}
              {String(eq.accounting_basis)} · {String(eq.source_id)} ({String(eq.reference_period)})
            </p>
          )}
          {dem && (
            <p className="mt-1">
              수요 원자료: {String(dem.household_per_capita_kg_per_year)} {String(dem.unit)} ·{" "}
              {String(dem.accounting_basis)} · {String(dem.source_id)} (
              {String(dem.reference_period)})
            </p>
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
    const item = data.perCapita.items.find((entry) => entry.waste_stream === metric.wasteStream);
    const excluded = data.perCapita.excluded_regions.filter(
      (entry) => entry.waste_stream === metric.wasteStream,
    );
    return {
      numeratorLabel: "발생량 출처",
      derivationVersion: data.perCapita.derivation_version,
      formula: data.perCapita.derivation_formula,
      unit: data.perCapita.unit,
      assumptions: data.perCapita.assumptions,
      excludedCount: excluded.length,
      numeratorSourceName: wasteRegistry?.source_name ?? "waste_statistics",
      numeratorFrequency,
      numeratorReferencePeriod: item?.waste_reference_period ?? String(data.perCapita.reference_year),
      officialDatasetName: item?.waste_official_dataset_name ?? null,
      accountingBasis: item?.accounting_basis ?? "ORIGIN_BASED_TREATMENT_OUTCOME",
      coverageNote: null,
      ...populationCommon,
      populationReferencePeriod:
        item?.population_reference_period ?? String(data.perCapita.reference_year),
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
}

function useSourceInfo(
  data: LoadedData | null,
  metric: (typeof METRICS)[number],
): SourceInfo | null {
  return useMemo(() => {
    if (!data || metric.dataset === "waste-per-capita") return null;
    const sourceId = metric.dataset === "population" ? "sgis" : "waste_statistics";
    const registry = data.sources.find((source) => source.source_id === sourceId);
    const wasteItem = data.waste.items.find((item) => item.waste_stream === metric.wasteStream);
    return {
      sourceId,
      sourceName: registry?.source_name ?? sourceId,
      frequency: registry ? frequencyLabel(registry.publication_frequency) : "UNKNOWN",
      referencePeriod:
        metric.dataset === "population"
          ? (data.population.items[0]?.reference_period ?? String(data.population.reference_year))
          : (wasteItem?.reference_period ?? String(data.waste.reference_year)),
      accountingBasis: metric.dataset === "waste-statistics" ? wasteItem?.accounting_basis : null,
      officialDatasetName:
        metric.dataset === "waste-statistics" ? wasteItem?.official_dataset_name : null,
      populationDefinition:
        metric.dataset === "population"
          ? (data.population.items[0]?.population_definition ?? null)
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
