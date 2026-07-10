"use client";

/**
 * Interactive map dashboard (Phase 4).
 *
 * All displayed data comes from the platform backend; there is no bundled or
 * fallback dataset. If the backend is unreachable or reports no data, the UI
 * shows an explicit error instead of a map.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import {
  ApiError,
  fetchBoundaries,
  fetchDataSources,
  fetchFacilities,
  fetchFacilityBurden,
  fetchPopulation,
  fetchWastePerCapita,
  fetchWasteStatistics,
  type DataSourceItem,
  type DatasetEnvelope,
  type EquityEnvelope,
  type FacilityBurdenEnvelope,
  type FacilityItem,
  type PopulationItem,
  type RegionBoundaryCollection,
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
import type { RegionDisplayValue } from "../components/MapView";

const MapView = dynamic(() => import("../components/MapView"), { ssr: false });

interface LoadedData {
  boundaries: RegionBoundaryCollection;
  population: DatasetEnvelope<PopulationItem>;
  waste: DatasetEnvelope<WasteStatisticsItem>;
  facilities: DatasetEnvelope<FacilityItem>;
  perCapita: EquityEnvelope;
  facilityBurden: FacilityBurdenEnvelope;
  sources: DataSourceItem[];
}

export default function Home() {
  const [data, setData] = useState<LoadedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metricKey, setMetricKey] = useState<MetricKey>("population");
  const [showFacilities, setShowFacilities] = useState(true);

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
        const message =
          cause instanceof ApiError
            ? cause.message
            : "백엔드에 연결할 수 없습니다 (backend unreachable).";
        setError(message);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const retry = useCallback(() => {
    setError(null);
    setData(null);
    load();
  }, [load]);

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
        values.set(item.region_code, {
          numeric: Number(served),
          display: formatQuantity(served),
        });
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

  // Dual-source panel for the backend-derived indicators (Phase 5.1/5.2).
  const derivedInfo = useMemo(() => {
    if (!data) return null;
    if (metric.dataset !== "waste-per-capita" && metric.dataset !== "facility-burden") {
      return null;
    }
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
        numeratorReferencePeriod:
          item?.facility_reference_period ?? String(burden.reference_year),
        officialDatasetName: null,
        accountingBasis: item?.accounting_basis ?? "FACILITY_LOCATION_BASED_THROUGHPUT",
        coverageNote:
          `좌표 없는 시설 ${formatCount(burden.facilities_without_coordinates)}개는 인근(5km) ` +
          `측정에서 제외되고, 지역 미배정 시설 ${formatCount(burden.facilities_without_region)}개는 ` +
          `소재 집계에 포함되지 않습니다.` +
          (partialCount > 0
            ? ` 처리량 미보고 시설이 있는 ${formatCount(partialCount)}개 지역의 합계는 ` +
              `과소집계로 표시됩니다(추정하지 않음).`
            : ""),
        ...populationCommon,
        populationReferencePeriod:
          item?.population_reference_period ?? String(burden.reference_year),
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
      numeratorReferencePeriod:
        item?.waste_reference_period ?? String(data.perCapita.reference_year),
      officialDatasetName: item?.waste_official_dataset_name ?? null,
      accountingBasis: item?.accounting_basis ?? "ORIGIN_BASED_TREATMENT_OUTCOME",
      coverageNote: null,
      ...populationCommon,
      populationReferencePeriod:
        item?.population_reference_period ?? String(data.perCapita.reference_year),
      populationDefinition: item?.population_definition ?? null,
    };
  }, [data, metric]);

  const sourceInfo = useMemo(() => {
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

  const facilitySummary = useMemo(() => {
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

  if (error !== null) {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-100 p-8">
        <div className="max-w-lg rounded-lg border border-red-300 bg-white p-6 shadow" role="alert">
          <h1 className="text-lg font-semibold text-red-700">데이터를 불러올 수 없습니다</h1>
          <p className="mt-2 text-sm text-slate-700">{error}</p>
          <p className="mt-2 text-sm text-slate-500">
            공식 데이터를 불러오지 못하면 지도는 표시되지 않습니다. 대체 데이터는 사용하지
            않습니다. (No fallback data is shown.)
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
          <h1 className="text-lg font-bold text-slate-900">수도권 폐기물 형평성 지도</h1>
          <p className="text-xs text-slate-500">
            Waste Equity Platform — Seoul · Incheon · Gyeonggi-do
          </p>
        </header>

        <section aria-label="지표 선택">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">지역 지표 (Regional metric)</h2>
          <div className="flex flex-col gap-1">
            {METRICS.map((candidate) => (
              <label key={candidate.key} className="flex items-start gap-2 text-sm text-slate-700">
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

        {derivedInfo && (
          <section
            aria-label="파생 지표 출처"
            className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-slate-700"
            data-testid="derived-metric-metadata"
          >
            <h2 className="mb-1 text-sm font-semibold text-slate-800">
              파생 지표 (Derived indicator)
            </h2>
            <p className="mb-2 text-xs text-slate-600">
              백엔드에서 공식 데이터 2종으로 산출: {derivedInfo.formula} · 단위 {derivedInfo.unit}{" "}
              · 산출 버전 {derivedInfo.derivationVersion}
            </p>
            <dl className="space-y-1">
              <div>
                <dt className="inline font-medium">{derivedInfo.numeratorLabel}: </dt>
                <dd className="inline">
                  {derivedInfo.numeratorSourceName} · 기준 기간{" "}
                  <span data-testid="reference-period">
                    {derivedInfo.numeratorReferencePeriod}
                  </span>{" "}
                  · {derivedInfo.numeratorFrequency}
                </dd>
              </div>
              {derivedInfo.officialDatasetName && (
                <div>
                  <dt className="inline font-medium">공식 데이터셋: </dt>
                  <dd className="inline">{derivedInfo.officialDatasetName}</dd>
                </div>
              )}
              <div>
                <dt className="inline font-medium">집계 기준: </dt>
                <dd className="inline">{derivedInfo.accountingBasis}</dd>
              </div>
              <div>
                <dt className="inline font-medium">인구 출처: </dt>
                <dd className="inline">
                  {derivedInfo.populationSourceName} · 기준 기간{" "}
                  {derivedInfo.populationReferencePeriod} · {derivedInfo.populationFrequency}
                </dd>
              </div>
              {derivedInfo.populationDefinition && (
                <div>
                  <dt className="inline font-medium">인구 정의: </dt>
                  <dd className="inline">{derivedInfo.populationDefinition}</dd>
                </div>
              )}
            </dl>
            {derivedInfo.coverageNote && (
              <p className="mt-2" data-testid="coverage-note">
                {derivedInfo.coverageNote}
              </p>
            )}
            {derivedInfo.excludedCount > 0 && (
              <p className="mt-2" data-testid="excluded-regions-note">
                <strong>{formatCount(derivedInfo.excludedCount)}개 지역</strong>은 분모(인구) 또는
                단위 문제로 산출할 수 없어 표시하지 않습니다 (0으로 대체하지 않습니다).
              </p>
            )}
            {metric.caveat && <p className="mt-2 font-medium text-amber-800">{metric.caveat}</p>}
            <details className="mt-2">
              <summary className="cursor-pointer font-medium">산출 가정 (assumptions)</summary>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {derivedInfo.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </details>
          </section>
        )}

        {sourceInfo && (
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
                  {sourceInfo.sourceName} ({sourceInfo.sourceId})
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">기준 기간: </dt>
                <dd className="inline" data-testid="reference-period">
                  {sourceInfo.referencePeriod}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">갱신 주기: </dt>
                <dd className="inline">{sourceInfo.frequency}</dd>
              </div>
              {sourceInfo.officialDatasetName && (
                <div>
                  <dt className="inline font-medium">공식 데이터셋: </dt>
                  <dd className="inline">{sourceInfo.officialDatasetName}</dd>
                </div>
              )}
              {sourceInfo.accountingBasis && (
                <div>
                  <dt className="inline font-medium">집계 기준: </dt>
                  <dd className="inline">{sourceInfo.accountingBasis}</dd>
                </div>
              )}
              {sourceInfo.populationDefinition && (
                <div>
                  <dt className="inline font-medium">인구 정의: </dt>
                  <dd className="inline">{sourceInfo.populationDefinition}</dd>
                </div>
              )}
              <div>
                <dt className="inline font-medium">경계 출처: </dt>
                <dd className="inline">
                  {data.boundaries.features[0]?.properties.source_id ?? "sgis"} ·{" "}
                  {data.boundaries.features[0]?.properties.boundary_reference_period ??
                    String(data.boundaries.reference_year)}
                </dd>
              </div>
            </dl>
          </section>
        )}

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
                지오코딩이 실패하여 지도에 표시하지 않습니다 (좌표를 임의로 만들지 않습니다).
              </p>
              <p className="mt-1">
                출처: waste_statistics · 기준 기간: {facilitySummary.referencePeriod} · 갱신 주기:{" "}
                {facilitySummary.frequency}
              </p>
              <p className="mt-1">집계 기준: {facilitySummary.accountingBasis}</p>
            </div>
          )}
        </section>
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
        />
      </div>
    </main>
  );
}
