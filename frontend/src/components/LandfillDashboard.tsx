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
 */

import { useMemo } from "react";

import type {
  LandfillComposition,
  LandfillFeePerCapita,
  LandfillOrigin,
  LandfillSummary,
  LandfillTrends,
} from "../lib/api";
import {
  formatEffectiveFee,
  formatKrwEok,
  formatKrwPerPerson,
  formatShare,
  formatTons,
  perCapitaUnavailableLabel,
} from "../lib/landfill";

export interface LandfillDashboardData {
  summary: LandfillSummary;
  trends: LandfillTrends;
  composition: LandfillComposition;
}

const ORIGIN_OPTIONS: { code: LandfillOrigin; label: string }[] = [
  { code: "11", label: "서울시 (Seoul)" },
  { code: "28", label: "인천시 (Incheon)" },
  { code: "41", label: "경기도 (Gyeonggi)" },
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

export interface LandfillDashboardProps {
  data: LandfillDashboardData | null;
  error: string | null;
  year: number | null;
  setYear: (y: number | null) => void;
  month: number | null;
  setMonth: (m: number | null) => void;
  origin: LandfillOrigin | null;
  setOrigin: (o: LandfillOrigin | null) => void;
  waste: string | null;
  setWaste: (w: string | null) => void;
}

export default function LandfillDashboard({
  data,
  error,
  year,
  setYear,
  month,
  setMonth,
  origin,
  setOrigin,
  waste,
  setWaste,
}: LandfillDashboardProps) {
  const period = data?.summary.period ?? null;
  const availableYears = period?.available_years ?? [];
  const maxMonth =
    period == null || period.is_complete_year || period.available_through_month == null
      ? 12
      : Number(period.available_through_month.slice(5, 7));
  // Waste options are scoped to the selected year/origin and deliberately NOT to
  // the waste filter itself, so switching between types stays possible.
  const wasteOptions = data?.composition.waste_types.map((w) => w.waste_name) ?? [];

  return (
    <main
      className="min-h-dvh w-full bg-slate-100 px-4 py-6 sm:px-6 lg:px-8"
      data-testid="landfill-dashboard"
    >
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        {/* The mode selector is rendered by the page above this component. */}
        <header>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">수도권매립지 반입 현황</h1>
          <p className="text-sm text-slate-500">서울 · 인천 · 경기 공식 반입자료</p>
        </header>

        <section
          aria-label="자료 한계"
          className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-slate-800"
          data-testid="landfill-limitation"
        >
          <p className="font-semibold text-amber-900">{LIMITATION_NOTICE}</p>
          <p className="mt-1 text-xs text-slate-700">
            수도권매립지관리공사가 서울시·경기도·인천시 단위로 보고한 반입 자료입니다. 시·군·구별
            반입량을 의미하지 않습니다.
          </p>
        </section>

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

        {error && (
          <section
            className="rounded border border-red-300 bg-red-50 p-4 text-sm text-slate-800"
            role="alert"
            data-testid="landfill-error"
          >
            <p className="font-semibold text-red-800">{error}</p>
            <p className="mt-1 text-xs text-slate-600">
              공식 데이터를 불러오지 못하면 값을 표시하지 않습니다. 이전 조건의 값을 그대로 두거나
              대체 데이터를 사용하지 않습니다.
            </p>
          </section>
        )}

        {data === null && error === null && (
          <p className="text-sm text-slate-600" data-testid="landfill-loading">
            공식 반입 데이터를 불러오는 중… (Loading official inbound data…)
          </p>
        )}

        {data && <LandfillBody data={data} />}
      </div>
    </main>
  );
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
  const selectClass =
    "mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800";
  return (
    <section
      aria-label="필터"
      data-testid="landfill-filters"
      className="grid grid-cols-1 gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <label className="text-xs font-medium text-slate-600">
        연도 (Year)
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
          <option value="">최신 완결연도 (latest complete)</option>
          {[...availableYears].reverse().map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-slate-600">
        월/연간 (Month / annual)
        <select
          className={selectClass}
          data-testid="landfill-month-select"
          value={month ?? ""}
          onChange={(event) =>
            setMonth(event.target.value === "" ? null : Number(event.target.value))
          }
        >
          <option value="">연간 (annual)</option>
          {Array.from({ length: maxMonth }, (_, index) => index + 1).map((m) => (
            <option key={m} value={m}>
              {m}월
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-slate-600">
        출발 광역지자체 (Origin)
        <select
          className={selectClass}
          data-testid="landfill-origin-select"
          value={origin ?? ""}
          onChange={(event) =>
            setOrigin(event.target.value === "" ? null : (event.target.value as LandfillOrigin))
          }
        >
          <option value="">전체 (all)</option>
          {ORIGIN_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-slate-600">
        폐기물 종류 (Waste type)
        <select
          className={selectClass}
          data-testid="landfill-waste-select"
          value={waste ?? ""}
          onChange={(event) => setWaste(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">전체 (all)</option>
          {wasteOptions.map((name) => (
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

  const originMax = Math.max(1, ...summary.origin_shares.map((o) => Number(o.quantity_tons)));
  // The waste composition chart reads the SUMMARY's waste shares, which respond
  // to all four filters. (The /composition endpoint is scoped to year+origin and
  // is used only to populate the waste dropdown.)
  const wasteRows = useMemo(() => summary.top_waste_types.slice(0, 8), [summary.top_waste_types]);
  const wasteMax = Math.max(1, ...wasteRows.map((w) => Number(w.quantity_tons)));

  return (
    <>
      <p className="text-xs text-slate-500">
        기준 기간: <span className="font-medium text-slate-700">{periodLabel}</span>
        {!period.is_complete_year && (
          <span data-testid="landfill-partial-year" className="ml-1 text-amber-700">
            · 부분 연도 ({period.available_through_month ?? "?"}까지)
          </span>
        )}
      </p>

      <section
        aria-label="핵심 지표"
        data-testid="landfill-kpis"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Kpi
          testId="landfill-kpi-quantity"
          label="총 반입량"
          value={formatTons(summary.total_quantity_kg)}
          note="공식 보고값 (official reported)"
        />
        <Kpi
          testId="landfill-kpi-fee"
          label="공식 반입수수료"
          value={formatKrwEok(summary.total_inbound_fee_krw)}
          note={FEE_CAVEAT}
        />
        <Kpi
          testId="landfill-kpi-effective-fee"
          label="톤당 실효 수수료"
          value={formatEffectiveFee(summary.effective_fee_per_ton)}
          note="공식자료 기반 계산값 (derived)"
        />
        <PerCapitaKpi perCapita={perCapita} />
      </section>

      <RegionTable summary={summary} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <MiniBars
          title="월별 반입량 (monthly inbound)"
          testId="landfill-trend-quantity"
          points={trends.points}
          pick={(point) => Number(point.quantity_tons)}
          format={(value) => `${Math.round(value).toLocaleString("en-US")} t`}
          color="#0d9488"
        />
        <MiniBars
          title="월별 공식 반입수수료 (monthly fee)"
          testId="landfill-trend-fee"
          points={trends.points}
          pick={(point) => Number(point.inbound_fee_krw) / 100_000_000}
          format={(value) => `${value.toFixed(1)}억원`}
          color="#2563eb"
        />
        <BarList
          title="출발지 비교 (origin comparison)"
          testId="landfill-origin-comparison"
          rows={summary.origin_shares.map((share) => ({
            key: share.origin_region_code,
            label: share.origin_name,
            ratio: Number(share.quantity_tons) / originMax,
            display: `${formatTons(share.quantity_kg)} · ${formatShare(share.quantity_share)}`,
          }))}
        />
        <BarList
          title="폐기물 구성 (waste composition)"
          testId="landfill-waste-composition"
          rows={wasteRows.map((share) => ({
            key: share.waste_name,
            label: share.waste_name,
            ratio: Number(share.quantity_tons) / wasteMax,
            display: `${formatTons(share.quantity_kg)} · ${formatShare(share.quantity_share)}`,
          }))}
        />
      </div>

      <Evidence summary={summary} />
    </>
  );
}

function Kpi({
  testId,
  label,
  value,
  note,
}: {
  testId: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4" data-testid={testId}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-slate-500">{note}</p>
    </div>
  );
}

/**
 * The fourth KPI. It shows a value only when the backend derived one from a
 * same-year population; otherwise it shows the served reason. It never claims a
 * resident payment or tax burden.
 */
function PerCapitaKpi({ perCapita }: { perCapita: LandfillFeePerCapita }) {
  const available = perCapita.fee_per_capita_krw !== null;
  return (
    <div
      className="rounded border border-slate-200 bg-white p-4"
      data-testid="landfill-kpi-per-capita"
    >
      <p className="text-xs font-medium text-slate-500">{PER_CAPITA_LABEL}</p>
      {available ? (
        <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
          {formatKrwPerPerson(perCapita.fee_per_capita_krw)}
        </p>
      ) : (
        <p
          className="mt-1 text-base font-semibold text-amber-800"
          data-testid="landfill-per-capita-unavailable"
        >
          {perCapitaUnavailableLabel(perCapita.unavailable_reason)}
        </p>
      )}
      {/* The served caveat is authoritative; PER_CAPITA_DESCRIPTION is only a
          fallback if an older backend omits it. */}
      <p className="mt-1 text-[11px] leading-snug text-slate-500">
        {perCapita.caveat || PER_CAPITA_DESCRIPTION}
      </p>
      {available && (
        <p className="mt-1 text-[11px] text-slate-500" data-testid="landfill-per-capita-periods">
          수수료 기준 {perCapita.fee_reference_period} · 인구 기준{" "}
          <span data-testid="landfill-population-month">
            {perCapita.population_reference_month ?? perCapita.population_reference_period}
          </span>{" "}
          (월말) · {(perCapita.population ?? 0).toLocaleString("en-US")}명
        </p>
      )}
      {!available && perCapita.required_population_month && (
        <p className="mt-1 text-[11px] text-slate-500" data-testid="landfill-required-month">
          필요한 인구 기준월: {perCapita.required_population_month}
        </p>
      )}
    </div>
  );
}

/**
 * Exactly four columns: 지역 / 반입량 / 공식 반입수수료 / 주민 1인당 환산 반입수수료.
 * All origins → the three metropolitan rows; a specific origin → only that one.
 */
function RegionTable({ summary }: { summary: LandfillSummary }) {
  return (
    <section aria-label="지역별 반입 현황" data-testid="landfill-region-table">
      <h2 className="mb-2 text-sm font-semibold text-slate-800">
        지역별 반입 현황 (by metropolitan origin)
      </h2>
      {summary.origin_shares.length === 0 ? (
        <p className="text-xs text-slate-500" data-testid="landfill-region-empty">
          해당 조건의 반입 자료가 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">
              선택한 조건의 광역지자체별 반입량, 공식 반입수수료, 주민 1인당 환산 반입수수료
            </caption>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
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
                return (
                  <tr
                    key={share.origin_region_code}
                    className="border-b border-slate-100 last:border-0"
                    data-testid="landfill-region-row"
                  >
                    <th scope="row" className="px-3 py-2 text-left font-medium text-slate-800">
                      {share.origin_name}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatTons(share.quantity_kg)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatKrwEok(share.inbound_fee_krw)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {value !== null ? (
                        formatKrwPerPerson(value)
                      ) : (
                        // Never 0원: an absent denominator is not a zero fee.
                        <span className="text-amber-800" data-testid="landfill-row-unavailable">
                          {perCapitaUnavailableLabel(perCapita.unavailable_reason)}
                        </span>
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

function BarList({
  title,
  testId,
  rows,
}: {
  title: string;
  testId: string;
  rows: { key: string; label: string; ratio: number; display: string }[];
}) {
  return (
    <section aria-label={title} data-testid={testId} className="rounded border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-800">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">해당 조건 데이터 없음</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="flex justify-between text-xs text-slate-600">
                <span className="truncate">{row.label}</span>
                <span className="ml-2 shrink-0 tabular-nums text-slate-500">{row.display}</span>
              </div>
              <div className="mt-0.5 h-2 rounded bg-slate-100">
                <div
                  className="h-2 rounded bg-teal-500"
                  style={{ width: `${Math.max(2, Math.min(100, row.ratio * 100))}%` }}
                />
              </div>
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
  color,
}: {
  title: string;
  testId: string;
  points: LandfillTrends["points"];
  pick: (point: LandfillTrends["points"][number]) => number;
  format: (value: number) => string;
  color: string;
}) {
  const width = 240;
  const height = 64;
  const count = points.length || 1;
  const barWidth = width / count;
  const max = Math.max(1, ...points.map(pick));
  return (
    <section aria-label={title} data-testid={testId} className="rounded border border-slate-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-800">{title}</h2>
      {points.length === 0 ? (
        <p className="text-xs text-slate-500">해당 기간 데이터 없음</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full"
            role="img"
            aria-label={title}
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
                  <title>{`${point.reference_month}: ${format(value)}`}</title>
                </rect>
              );
            })}
          </svg>
          <p className="text-[11px] text-slate-400">
            최대 {format(max)} · {points.length}개월 · 선택 연도 전체(월 필터 무관)
          </p>
        </>
      )}
    </section>
  );
}

function Evidence({ summary }: { summary: LandfillSummary }) {
  const perCapita = summary.fee_per_capita;
  return (
    <section
      aria-label="근거 및 주의"
      className="rounded border border-slate-200 bg-white p-4 text-xs text-slate-700"
      data-testid="landfill-evidence"
    >
      <h2 className="mb-2 text-sm font-semibold text-slate-800">근거 (Evidence)</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="font-medium text-slate-700">공식 보고값 (OFFICIAL_REPORTED_VALUE)</p>
          <ul className="list-disc pl-4">
            <li>반입량 (inbound quantity)</li>
            <li>반입수수료 (inbound fee)</li>
            <li>주민등록 인구 (행정안전부 · 월말 기준)</li>
          </ul>
          <p className="mt-1 font-medium text-slate-700">
            공식자료 기반 계산 (OFFICIAL_INPUTS_DERIVED_VALUE)
          </p>
          <ul className="list-disc pl-4">
            <li>월·연 집계 (monthly/annual totals) · 비중 (shares)</li>
            <li>톤당 실효 수수료 — {summary.derivation_version}</li>
            <li>
              {PER_CAPITA_LABEL} — {perCapita.derivation_version}
            </li>
          </ul>
        </div>
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
          <div>
            <dt className="inline font-medium">산출 버전: </dt>
            <dd className="inline" data-testid="landfill-derivation-version">
              {perCapita.derivation_version}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">산출식: </dt>
            <dd className="inline">{perCapita.derivation_formula}</dd>
          </div>
          <div>
            <dt className="inline font-medium">집계 기준: </dt>
            <dd className="inline">{summary.accounting_basis}</dd>
          </div>
        </dl>
      </div>

      {/* The MOIS total-population definition changed twice inside the 2008–2026
          window, so a long-run comparison is not like-for-like. Disclosed with
          the data rather than only in the docs. */}
      <p
        className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-slate-700"
        data-testid="landfill-comparability-note"
      >
        <strong className="text-amber-900">인구 정의 변경 안내:</strong> 주민등록 총인구의 정의는
        2010-10(거주불명자 포함)과 2015-01(재외국민 포함)에 변경되었습니다. 서로 다른 시기의 값을
        비교할 때는 정의 차이를 고려해야 하며, 완전히 동일한 기준의 시계열이 아닙니다. (외국인은
        모든 시기에서 제외됩니다.)
        {perCapita.population_comparability_note && (
          <span className="mt-1 block text-slate-600">
            {perCapita.population_comparability_note}
          </span>
        )}
      </p>
      <p className="mt-3 font-medium text-amber-800" data-testid="landfill-fee-caveat">
        {FEE_CAVEAT}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-600" data-testid="landfill-caveats">
        {summary.caveats.map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>
    </section>
  );
}
