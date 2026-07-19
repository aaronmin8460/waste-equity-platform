"use client";

/**
 * Citizen-facing facility cost lens (Phase 2/3), rendered as a FULL-WIDTH dashboard
 * (not a narrow sidebar beside a mostly-irrelevant map). The cost view mounts no
 * MapView — the cost model does not vary by map cell in V1, so a map would be dead
 * weight. See page.tsx for the full-width routing.
 *
 * This is a decision-support tool, NOT propaganda for or against a facility. It
 * presents the backend's **standard-construction-cost analysis** with its disclaimer
 * and completeness: it never shows an actual total project cost, an approved subsidy,
 * a personal tax bill, or a cheapest-site ranking, and it renders unavailable
 * components as explicitly unavailable — never as 0. All displayed money is the exact
 * backend-served decimal string, formatted without changing its value. Numeric
 * conversion is used ONLY for chart proportions, never to reconstruct a shown value.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  fetchFacilityCostCalculate,
  fetchFacilityCostOptions,
  type CandidateDetail,
  type FacilityCostBand,
  type FacilityCostCalculate,
  type FacilityCostOfficialInput,
  type FacilityCostOptions,
} from "../lib/api";
import { formatQuantity } from "../lib/metrics";
import { stabilityBadgeLabel } from "../lib/suitability";

const WASTE_STREAMS: { value: string; label: string }[] = [
  { value: "HOUSEHOLD", label: "생활계 폐기물 (Household)" },
  { value: "BUSINESS_NON_FACILITY", label: "사업장 비배출시설계 (Business non-facility)" },
  { value: "INDUSTRIAL_FACILITY", label: "사업장 배출시설계 (Industrial facility)" },
  { value: "CONSTRUCTION", label: "건설 폐기물 (Construction)" },
];

// The fixed minimum list of unavailable / non-claims the warning panel must always
// show, regardless of the backend's structured missing_components. These are the
// analytical-honesty guardrails (Task 10): what this number is NOT.
const COMPLETENESS_NOTICES = [
  "운영비 미포함",
  "실제 운송비 미포함",
  "토지·보상비 미포함",
  "잔여 매립비용 미포함",
  "후보지별 토목조건 미포함",
  "실제 총사업비가 아님",
  "실제 승인된 국고보조금이 아님",
  "주민 개인의 실제 세금 청구액이 아님",
];

// Backend missing_components codes → clear Korean labels. The backend REASON is
// always retained alongside; missing is never rendered as zero.
const MISSING_COMPONENT_LABELS: Record<string, string> = {
  OPERATING_COST: "운영비",
  ACTUAL_TRANSPORT_COST: "실제 운송비",
  LAND_AND_COMPENSATION: "토지·보상비",
  REMAINING_LANDFILL_COST: "잔여 매립비용",
};

const CITIZEN_CONDITIONS = [
  "실시간 배출정보 공개",
  "주민 감시 또는 협의체",
  "주거지 완충구역",
  "폐기물 차량 운행경로 관리",
  "악취·소음 상시 측정",
  "건강영향 조사",
  "기준 초과 시 가동중단 절차",
  "주민편익시설",
  "지원기금 공개",
  "사고 즉시 통보",
  "정기적인 재정·운영 정보 공개",
];

const CITIZEN_RESPONSES = [
  "현재 정보만으로도 검토 가능",
  "위 조건이 충족되면 검토 가능",
  "추가 정보가 필요함",
  "시설 설치에 반대함",
];

const PAGE_DISCLAIMER =
  "이 페이지는 시설 설치를 권고하거나 반대를 설득하기 위한 페이지가 아닙니다. 공식 데이터로 필요성, " +
  "비용, 입지 조건과 불확실성을 함께 검토하기 위한 시민 의사결정 지원 도구입니다.";

const HEADER_SUBTITLE =
  "선택한 지역의 공식 폐기물 발생량을 바탕으로 필요한 시설 규모와 정부 표준공사비 기준 설치비를 분석합니다.";

// Source + reference period for the subsidy rates shown in the scenario selector,
// so their provenance is visible in every state (not only after a calculation).
const SUBSIDY_RATE_FORM_NOTE =
  "명목 국고보조율(분석용 가정) · 출처: 폐기물처리시설 국고보조금 업무처리지침 · 기준 2025 지침 · " +
  "실제 승인된 국고보조금이 아닙니다.";

/** Validate the numeric scenario inputs; returns an actionable message or null. */
function validateScenario(s: ScenarioState, options: FacilityCostOptions): string | null {
  const share = Number(s.processingSharePercent);
  if (s.processingSharePercent === "" || Number.isNaN(share) || share < 0 || share > 100) {
    return "지역 처리 비율은 0–100(%) 사이여야 합니다.";
  }
  if (!Number.isInteger(s.operatingDays) || s.operatingDays < 1 || s.operatingDays > 366) {
    return "연간 가동일수는 1–366 사이여야 합니다.";
  }
  const min = Number(options.underground_multiplier.min);
  const max = Number(options.underground_multiplier.max);
  const um = Number(s.undergroundMultiplier);
  if (s.undergroundMultiplier === "" || Number.isNaN(um) || um < min || um > max) {
    return `지하화 배수는 ${options.underground_multiplier.min}–${options.underground_multiplier.max} 사이여야 합니다.`;
  }
  return null;
}

/** Format an 억원 decimal string without changing its value. */
function formatBn(value: string): string {
  return `${formatQuantity(value)} 억원`;
}

/** Format a 원 decimal string, keeping small values visible. */
function formatWon(value: string): string {
  return `${formatQuantity(value)}원`;
}

/**
 * The matched band's capacity range with its true endpoint semantics: bounded
 * middle bands are lower-exclusive / upper-inclusive, so the label reflects the
 * inclusivity flags (e.g. "30 톤/일 초과 ~ 40 톤/일 이하") rather than a bare "30–40".
 */
function matchedBandLabel(band: FacilityCostBand): string {
  const lo = band.capacity_min_ton_per_day;
  const hi = band.capacity_max_ton_per_day;
  const loPart =
    lo !== null ? `${formatQuantity(lo)} 톤/일 ${band.capacity_min_inclusive ? "이상" : "초과"}` : null;
  const hiPart =
    hi !== null ? `${formatQuantity(hi)} 톤/일 ${band.capacity_max_inclusive ? "이하" : "미만"}` : null;
  if (loPart && hiPart) return `${loPart} ~ ${hiPart}`;
  return loPart ?? hiPart ?? "전체 규모";
}

export interface FacilityCostDashboardProps {
  /**
   * Calculable service regions: the regions that actually have waste statistics,
   * tagged with their waste stream (from the loaded RegionalWasteStatistics). The
   * picker offers only the regions calculable for the SELECTED stream, so a citizen
   * can never choose a code that always returns OFFICIAL_WASTE_UNAVAILABLE.
   */
  wasteRegions: { code: string; name: string; stream: string }[];
  /** The currently-selected suitability candidate (for candidate integration). */
  selectedCandidate: CandidateDetail | null;
}

interface ScenarioState {
  facilityType: string;
  wasteStream: string;
  subsidyScheme: string;
  regionCodes: string[];
  processingSharePercent: string;
  operatingDays: number;
  undergroundMultiplier: string;
  costVersion: string;
}

export default function FacilityCostDashboard({
  wasteRegions,
  selectedCandidate,
}: FacilityCostDashboardProps) {
  const [options, setOptions] = useState<FacilityCostOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioState | null>(null);
  const [result, setResult] = useState<FacilityCostCalculate | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  // The input signature the current result/error was computed for. The result is
  // shown ONLY while it still matches the live inputs (scenario + selected
  // candidate), so a stale result never sits beside changed controls.
  const [outputSig, setOutputSig] = useState<string | null>(null);
  // Monotonic request id: a superseded in-flight response is discarded, so a late
  // response from an old scenario can never overwrite a newer one.
  const requestSeq = useRef(0);

  const currentSig = useMemo(
    () => JSON.stringify({ scenario, candidateId: selectedCandidate?.candidate_id ?? null }),
    [scenario, selectedCandidate],
  );
  const resultCurrent = result !== null && outputSig === currentSig;
  const errorCurrent = calcError !== null && outputSig === currentSig;

  // Load the scenario options once; seed the form defaults from them.
  useEffect(() => {
    let cancelled = false;
    fetchFacilityCostOptions()
      .then((opts) => {
        if (cancelled) return;
        setOptions(opts);
        setScenario({
          facilityType: opts.facility_types[0]?.value ?? "sorting_auto",
          wasteStream: WASTE_STREAMS[0].value,
          subsidyScheme: opts.subsidy_schemes[0]?.value ?? "city_or_county",
          regionCodes: [],
          processingSharePercent: "100",
          operatingDays: opts.default_operating_days,
          undergroundMultiplier: opts.underground_multiplier.default,
          costVersion: opts.active_cost_version,
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setOptionsError(
          cause instanceof ApiError ? cause.message : "비용 옵션을 불러올 수 없습니다.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(
    <K extends keyof ScenarioState>(key: K, value: ScenarioState[K]) => {
      setScenario((prev) => {
        if (!prev) return prev;
        // Changing the waste stream changes which regions are calculable, so drop
        // the current region selection (it may not exist for the new stream).
        if (key === "wasteStream") return { ...prev, wasteStream: value as string, regionCodes: [] };
        return { ...prev, [key]: value };
      });
    },
    [],
  );

  // The calculable regions for the SELECTED stream, deduped by code and sorted by
  // name. Only these are offered, so a chosen code always has official waste data.
  const regionOptions = useMemo(() => {
    const stream = scenario?.wasteStream;
    const seen = new Set<string>();
    return wasteRegions
      .filter((r) => r.stream === stream && !seen.has(r.code) && seen.add(r.code))
      .map((r) => ({ code: r.code, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [wasteRegions, scenario?.wasteStream]);

  const calculate = useCallback(() => {
    // Guard: never fire with no region or invalid numeric inputs (the button is
    // also disabled in those states) — avoids an unnecessary backend 422.
    if (!scenario || !options || scenario.regionCodes.length === 0) return;
    if (validateScenario(scenario, options) !== null) return;
    const myId = (requestSeq.current += 1);
    const mySig = JSON.stringify({
      scenario,
      candidateId: selectedCandidate?.candidate_id ?? null,
    });
    setCalculating(true);
    setCalcError(null);
    fetchFacilityCostCalculate({
      facilityType: scenario.facilityType,
      wasteStream: scenario.wasteStream,
      subsidyScheme: scenario.subsidyScheme,
      regionCodes: scenario.regionCodes,
      processingSharePercent: scenario.processingSharePercent,
      operatingDays: scenario.operatingDays,
      undergroundMultiplier: scenario.undergroundMultiplier,
      costVersion: scenario.costVersion,
      candidateId: selectedCandidate?.candidate_id ?? null,
    })
      .then((res) => {
        if (myId !== requestSeq.current) return; // superseded → discard
        setResult(res);
        setOutputSig(mySig);
        setCalcError(null);
      })
      .catch((cause: unknown) => {
        if (myId !== requestSeq.current) return; // superseded → discard
        setResult(null);
        setOutputSig(mySig);
        setCalcError(cause instanceof ApiError ? cause.message : "비용을 계산할 수 없습니다.");
      })
      .finally(() => {
        if (myId === requestSeq.current) setCalculating(false);
      });
  }, [scenario, options, selectedCandidate]);

  return (
    <div
      className="mx-auto w-full max-w-screen-2xl px-4 pb-12 sm:px-6 lg:px-8"
      data-testid="facility-cost-dashboard"
    >
      <FacilityCostHeader />

      {optionsError ? (
        <section
          className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-slate-700"
          data-testid="facility-cost-options-error"
          role="alert"
        >
          <p>{optionsError}</p>
        </section>
      ) : !options || !scenario ? (
        <p
          className="mt-4 text-sm text-slate-600"
          data-testid="facility-cost-loading"
          role="status"
        >
          비용 옵션을 불러오는 중… (Loading cost options…)
        </p>
      ) : (
        <FacilityCostBody
          options={options}
          scenario={scenario}
          regionOptions={regionOptions}
          update={update}
          calculate={calculate}
          calculating={calculating}
          result={result}
          resultCurrent={resultCurrent}
          errorCurrent={errorCurrent}
          calcError={calcError}
          selectedCandidate={selectedCandidate}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //

function FacilityCostBody({
  options,
  scenario,
  regionOptions,
  update,
  calculate,
  calculating,
  result,
  resultCurrent,
  errorCurrent,
  calcError,
  selectedCandidate,
}: {
  options: FacilityCostOptions;
  scenario: ScenarioState;
  regionOptions: { code: string; name: string }[];
  update: <K extends keyof ScenarioState>(key: K, value: ScenarioState[K]) => void;
  calculate: () => void;
  calculating: boolean;
  result: FacilityCostCalculate | null;
  resultCurrent: boolean;
  errorCurrent: boolean;
  calcError: string | null;
  selectedCandidate: CandidateDetail | null;
}) {
  const validationMessage = validateScenario(scenario, options);
  return (
    <div className="mt-4 flex flex-col gap-5">
      <FacilityCostNotice result={resultCurrent ? result : null} />

      <FacilityCostFilters
        options={options}
        regionOptions={regionOptions}
        scenario={scenario}
        update={update}
        onCalculate={calculate}
        calculating={calculating}
        validationMessage={validationMessage}
      />

      {/* Results/errors are shown ONLY while they still match the live inputs. A
          control change (or a new map candidate) changes currentSig, so an
          out-of-date output disappears until the user recalculates. */}
      {errorCurrent && (
        <section
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-slate-800"
          role="alert"
          data-testid="facility-cost-error"
        >
          <p className="font-semibold text-red-800">{calcError}</p>
          <p className="mt-1 text-xs text-slate-600">
            공식 데이터를 계산할 수 없으면 값을 표시하지 않습니다. 대체 데이터는 사용하지 않습니다.
          </p>
        </section>
      )}
      {result && !resultCurrent && !calculating && (
        <p className="text-xs text-amber-700" role="status" data-testid="facility-cost-stale">
          입력이 변경되었습니다. 다시 계산하세요. (Inputs changed — recalculate.)
        </p>
      )}

      {resultCurrent && result && (
        <FacilityCostResults result={result} selectedCandidate={selectedCandidate} />
      )}

      <CitizenConditions />
    </div>
  );
}

// --------------------------------------------------------------------------- //

function FacilityCostHeader() {
  return (
    <header data-testid="facility-cost-header">
      <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">우리 지역에 시설이 생긴다면</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">{HEADER_SUBTITLE}</p>
    </header>
  );
}

// --------------------------------------------------------------------------- //

/**
 * The prominent warning panel (Task 10): what this analysis is NOT. Always visible,
 * so the partial nature is clear before and after any calculation. When a result is
 * present it also lists the backend's structured missing components with their
 * reasons — never as a zero cost line.
 */
function FacilityCostNotice({ result }: { result: FacilityCostCalculate | null }) {
  return (
    <section
      aria-label="분석 범위와 한계"
      className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-slate-700"
      data-testid="facility-cost-completeness"
    >
      <p
        className="rounded border border-amber-300 bg-white/70 p-2 font-medium text-amber-900"
        data-testid="facility-cost-disclaimer"
      >
        {PAGE_DISCLAIMER}
      </p>
      <p className="mt-3 font-semibold text-amber-900">
        현재 결과는 표준공사비 기반 설치비 분석입니다. 아래 항목은 포함되지 않았습니다:
      </p>
      <ul className="mt-2 grid list-disc grid-cols-1 gap-x-6 gap-y-1 pl-5 sm:grid-cols-2">
        {COMPLETENESS_NOTICES.map((notice) => (
          <li key={notice}>{notice}</li>
        ))}
      </ul>
      {result && <FacilityCostMissingComponents result={result} />}
    </section>
  );
}

/** Backend structured missing components with Korean labels + retained reason codes. */
function FacilityCostMissingComponents({ result }: { result: FacilityCostCalculate }) {
  const missing = result.completeness.missing_components;
  if (missing.length === 0) return null;
  return (
    <div className="mt-3 rounded border border-amber-200 bg-white/60 p-3" data-testid="facility-cost-missing">
      <p className="text-xs font-semibold text-slate-700">
        서버가 명시한 미포함 비용 항목 (missing — never counted as 0):
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {missing.map((m) => (
          <li key={m.component} className="text-xs text-slate-600" data-testid="facility-cost-missing-row">
            <span className="font-medium text-slate-800">
              {MISSING_COMPONENT_LABELS[m.component] ?? m.component}
            </span>{" "}
            <span className="text-amber-700">미포함</span> — {m.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- //

const selectClass =
  "mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800";
const labelClass = "text-xs font-medium text-slate-600";

function FacilityCostFilters({
  options,
  regionOptions,
  scenario,
  update,
  onCalculate,
  calculating,
  validationMessage,
}: {
  options: FacilityCostOptions;
  regionOptions: { code: string; name: string }[];
  scenario: ScenarioState;
  update: <K extends keyof ScenarioState>(key: K, value: ScenarioState[K]) => void;
  onCalculate: () => void;
  calculating: boolean;
  validationMessage: string | null;
}) {
  const noRegions = scenario.regionCodes.length === 0;
  return (
    <section
      aria-label="시나리오 설정"
      className="rounded border border-slate-200 bg-white p-4"
      data-testid="facility-cost-form"
    >
      <h2 className="mb-3 text-sm font-semibold text-slate-800">시나리오 설정 (Scenario)</h2>

      {/* Primary inputs: multi-column on wide desktop, two columns on tablet, one
          column on mobile — no horizontal overflow at any width. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={labelClass}>
          시설 종류 (Facility type)
          <select
            className={selectClass}
            data-testid="facility-cost-facility-type"
            value={scenario.facilityType}
            onChange={(e) => update("facilityType", e.target.value)}
          >
            {options.facility_types.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          폐기물 종류 (Waste stream)
          <select
            className={selectClass}
            data-testid="facility-cost-waste-stream"
            value={scenario.wasteStream}
            onChange={(e) => update("wasteStream", e.target.value)}
          >
            {WASTE_STREAMS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          지역 처리 비율 (Processing share, %)
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            className={selectClass}
            data-testid="facility-cost-processing-share"
            value={scenario.processingSharePercent}
            onChange={(e) => update("processingSharePercent", e.target.value)}
          />
        </label>

        {/* The service-region multi-select spans the full grid row so long Korean
            names never clip; it stays a native multi-select in this phase. */}
        <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>
          서비스 지역 (Service regions) — 하나 이상 선택
          <select
            multiple
            size={6}
            className={`${selectClass} h-auto`}
            data-testid="facility-cost-regions"
            value={scenario.regionCodes}
            onChange={(e) =>
              update(
                "regionCodes",
                Array.from(e.target.selectedOptions, (opt) => opt.value),
              )
            }
          >
            {regionOptions.map((r) => (
              // The code disambiguates duplicate names (e.g. 서울 중구 vs 인천 중구).
              <option key={r.code} value={r.code}>
                {r.name} ({r.code})
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
            {regionOptions.length === 0
              ? "이 폐기물 종류로 계산 가능한 지역이 없습니다."
              : noRegions
                ? "계산 가능한 지역만 표시됩니다. 지역을 선택하세요."
                : `선택: ${scenario.regionCodes.length}개`}
          </span>
        </label>
      </div>

      {/* Advanced settings in an accessible disclosure. Kept open on none-of-the
          screens by default so a keystroke never triggers a request; the explicit
          calculate button below is the only submit path. */}
      <details className="mt-3 rounded border border-slate-200 bg-slate-50 p-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-600">
          고급 설정 (Advanced settings)
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className={labelClass}>
            연간 가동일수 (Operating days)
            <input
              type="number"
              min={1}
              max={366}
              step={1}
              className={selectClass}
              data-testid="facility-cost-operating-days"
              value={scenario.operatingDays}
              onChange={(e) => update("operatingDays", Number(e.target.value))}
            />
          </label>

          <label className={labelClass}>
            지하화 배수 (Underground multiplier {options.underground_multiplier.min}–
            {options.underground_multiplier.max})
            <input
              type="number"
              min={Number(options.underground_multiplier.min)}
              max={Number(options.underground_multiplier.max)}
              step={0.05}
              className={selectClass}
              data-testid="facility-cost-underground"
              value={scenario.undergroundMultiplier}
              onChange={(e) => update("undergroundMultiplier", e.target.value)}
            />
            <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
              {options.underground_multiplier.note}
            </span>
          </label>

          <label className={labelClass}>
            보조 시나리오 (Subsidy scheme)
            <select
              className={selectClass}
              data-testid="facility-cost-subsidy-scheme"
              value={scenario.subsidyScheme}
              onChange={(e) => update("subsidyScheme", e.target.value)}
            >
              {options.subsidy_schemes.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span
              className="mt-0.5 block text-[11px] font-normal text-slate-400"
              data-testid="facility-cost-subsidy-note"
            >
              {SUBSIDY_RATE_FORM_NOTE}
            </span>
          </label>

          {options.cost_versions.length > 1 && (
            <label className={labelClass}>
              공사비 버전 (Cost version)
              <select
                className={selectClass}
                data-testid="facility-cost-version"
                value={scenario.costVersion}
                onChange={(e) => update("costVersion", e.target.value)}
              >
                {options.cost_versions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </details>

      {/* Validation is announced accessibly, and the button is disabled while an
          input is out of range or a request is active (no duplicate submit). */}
      {validationMessage && (
        <p className="mt-3 text-xs text-amber-700" role="alert" data-testid="facility-cost-validation">
          {validationMessage}
        </p>
      )}
      <button
        type="button"
        onClick={onCalculate}
        disabled={noRegions || calculating || validationMessage !== null}
        className="mt-3 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        data-testid="facility-cost-calculate"
      >
        {calculating ? "계산 중…" : "표준공사비 기반 설치비 계산"}
      </button>
    </section>
  );
}

// --------------------------------------------------------------------------- //

function FacilityCostResults({
  result,
  selectedCandidate,
}: {
  result: FacilityCostCalculate;
  selectedCandidate: CandidateDetail | null;
}) {
  return (
    // aria-live so the newly calculated result is announced.
    <div className="flex flex-col gap-5" role="status" data-testid="facility-cost-results">
      <FacilityCostKpiGrid result={result} />
      <FacilityCostFundingBreakdown result={result} />
      <FacilityCostRegionTable officialInput={result.official_input} />
      {result.candidate_context && (
        <FacilityCostCandidateContext
          context={result.candidate_context}
          selectedCandidate={selectedCandidate}
        />
      )}
      <FacilityCostEvidence result={result} />
    </div>
  );
}

// --------------------------------------------------------------------------- //

function KpiCard({
  label,
  value,
  caption,
  testId,
  valueTestId,
  emphasis,
}: {
  label: string;
  value: string;
  caption?: string;
  testId?: string;
  valueTestId?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className="flex flex-col rounded border border-slate-200 bg-white p-3"
      data-testid={testId}
    >
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd
        className={`mt-1 font-semibold tabular-nums ${emphasis ? "text-lg text-slate-900" : "text-base text-slate-800"}`}
        data-testid={valueTestId}
      >
        {value}
      </dd>
      {caption && <p className="mt-1 text-[11px] text-slate-400">{caption}</p>}
    </div>
  );
}

/** Value card for the per-capita KPI, which may be an explicit unavailable reason. */
function PerCapitaCard({ result }: { result: FacilityCostCalculate }) {
  const pc = result.per_capita;
  return (
    <div className="flex flex-col rounded border border-slate-200 bg-white p-3">
      <dt className="text-[11px] text-slate-500">{pc.term_ko}</dt>
      {pc.per_capita_local_share_won !== null ? (
        <dd className="mt-1 text-base font-semibold tabular-nums text-slate-800" data-testid="fc-per-capita">
          {formatWon(pc.per_capita_local_share_won)}
        </dd>
      ) : (
        // Never rendered as 0 — the served reason is shown instead, and the card
        // stays visible with its caveat.
        <dd className="mt-1 text-sm font-semibold text-amber-700" data-testid="fc-per-capita-unavailable">
          계산 불가 ({pc.unavailable_reason})
        </dd>
      )}
      <p className="mt-1 text-[11px] text-slate-400">{pc.caveat}</p>
    </div>
  );
}

function FacilityCostKpiGrid({ result }: { result: FacilityCostCalculate }) {
  const { scenario, official_input, capacity, standard_cost, annualization, subsidy } = result;
  const band = standard_cost.matched_band;
  return (
    <section aria-label="핵심 지표 (Key indicators)" data-testid="facility-cost-kpi-grid">
      <h2 className="mb-2 text-sm font-semibold text-slate-800">핵심 지표 (Key indicators)</h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="공식 연간 폐기물 발생량"
          value={`${formatQuantity(official_input.official_annual_quantity_ton)} ${official_input.quantity_unit}`}
          valueTestId="fc-official-quantity"
        />
        <KpiCard
          label="시나리오 처리량"
          value={`${formatQuantity(capacity.annual_service_quantity_ton)} 톤/년`}
          caption={`처리 비율 ${scenario.processing_share_percent}%`}
          valueTestId="fc-scenario-quantity"
        />
        <KpiCard
          label="필요 시설 규모"
          value={`${formatQuantity(capacity.facility_capacity_ton_per_day)} ${capacity.capacity_unit}`}
          valueTestId="fc-capacity"
        />
        <KpiCard
          label={standard_cost.term_ko}
          value={formatBn(standard_cost.standard_construction_cost_bn)}
          caption={`적용 구간: ${matchedBandLabel(band)}`}
          valueTestId="fc-standard-cost"
          emphasis
        />
        <KpiCard
          label={`${annualization.term_ko} (내용연수 ${annualization.facility_lifetime_years}년, 가정)`}
          value={`${formatQuantity(annualization.annualized_construction_cost_bn)} ${annualization.unit}`}
          valueTestId="fc-annualized"
        />
        <KpiCard
          label={`명목 국고보조 추정액 (${subsidy.subsidy_scheme_label})`}
          value={formatBn(subsidy.estimated_national_subsidy_bn)}
          caption={`명목 보조율 ${subsidy.subsidy_rate} · ${subsidy.rate_basis}`}
          valueTestId="fc-subsidy"
        />
        <KpiCard
          label="단순 지방비 추정액"
          value={formatBn(subsidy.simplified_local_government_share_bn)}
          valueTestId="fc-local-share"
        />
        <PerCapitaCard result={result} />
      </dl>
      {/* The matched band's endpoint semantics, kept as an explicit line so its
          inclusivity is readable and testable. */}
      <p className="mt-2 text-[11px] text-slate-500" data-testid="fc-matched-band">
        적용 표준공사비 구간: {matchedBandLabel(band)} · 단가 {formatQuantity(band.cost_per_capacity_bn)}{" "}
        {band.cost_per_capacity_unit}
      </p>
    </section>
  );
}

// --------------------------------------------------------------------------- //

/**
 * Funding breakdown of the ONE-TIME standard construction cost into its nominal
 * national subsidy + simplified local share. A stacked horizontal bar; the widths
 * use Number() conversion for proportion only — every displayed money value is the
 * exact backend string. Annualized cost is deliberately NOT mixed in, and missing
 * components are NOT shown as zero-width categories (they are in the notice panel).
 */
function FacilityCostFundingBreakdown({ result }: { result: FacilityCostCalculate }) {
  const total = Number(result.standard_cost.standard_construction_cost_bn);
  const subsidyN = Number(result.subsidy.estimated_national_subsidy_bn);
  const localN = Number(result.subsidy.simplified_local_government_share_bn);
  const subsidyPct = total > 0 ? Math.max(0, Math.min(100, (subsidyN / total) * 100)) : 0;
  const localPct = total > 0 ? Math.max(0, Math.min(100, (localN / total) * 100)) : 0;
  return (
    <section
      aria-label="설치비 재원 구성"
      className="rounded border border-slate-200 bg-white p-4"
      data-testid="facility-cost-funding"
    >
      <h2 className="text-sm font-semibold text-slate-800">
        {result.standard_cost.term_ko} 재원 구성 (분석용)
      </h2>
      <p className="mt-1 text-[11px] text-slate-500">
        일회성 설치비 산정액을 명목 국고보조 추정액과 단순 지방비 추정액으로 나눈 분석용 구성입니다. 보조금
        승인을 의미하지 않으며, 연간 환산 설치비와 합산하지 않습니다.
      </p>
      {/* The stacked bar is decorative; every value is available as text below. */}
      <div
        aria-hidden
        className="mt-3 flex h-5 w-full overflow-hidden rounded border border-slate-300"
      >
        <div className="h-full bg-sky-600" style={{ width: `${subsidyPct}%` }} />
        <div className="h-full bg-slate-400" style={{ width: `${localPct}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-sky-600" />
          <div>
            <dt className="text-[11px] text-slate-500">명목 국고보조 추정액</dt>
            <dd className="text-sm font-semibold tabular-nums text-slate-800" data-testid="fc-funding-subsidy">
              {formatBn(result.subsidy.estimated_national_subsidy_bn)}
            </dd>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-slate-400" />
          <div>
            <dt className="text-[11px] text-slate-500">단순 지방비 추정액</dt>
            <dd className="text-sm font-semibold tabular-nums text-slate-800" data-testid="fc-funding-local">
              {formatBn(result.subsidy.simplified_local_government_share_bn)}
            </dd>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm border border-slate-300" />
          <div>
            <dt className="text-[11px] text-slate-500">합계 (설치비 산정액)</dt>
            <dd className="text-sm font-semibold tabular-nums text-slate-800" data-testid="fc-funding-total">
              {formatBn(result.standard_cost.standard_construction_cost_bn)}
            </dd>
          </div>
        </div>
      </dl>
    </section>
  );
}

// --------------------------------------------------------------------------- //

/**
 * The selected official input per region: generation quantity, population, and the
 * region's share of the official total (a DERIVED display share, clearly labelled).
 * No regional cost allocation is invented — cost is never split across regions.
 * A region with no official population shows explicit unavailable text, never 0명.
 */
function FacilityCostRegionTable({
  officialInput,
}: {
  officialInput: FacilityCostOfficialInput;
}) {
  const total = Number(officialInput.official_annual_quantity_ton);
  return (
    <section
      aria-label="지역별 공식 투입 데이터"
      className="rounded border border-slate-200 bg-white p-4"
      data-testid="facility-cost-region-table"
    >
      <h2 className="text-sm font-semibold text-slate-800">지역별 공식 투입 데이터 (Official input)</h2>
      <p className="mt-1 text-[11px] text-slate-500">
        비중은 공식 지역 발생량 ÷ 공식 합계로 계산한 표시용 파생값입니다. 비용은 지역별로 배분하지 않습니다.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-3 font-medium">지역</th>
              <th className="py-1 pr-3 font-medium">공식 연간 발생량</th>
              <th className="py-1 pr-3 font-medium">인구</th>
              <th className="py-1 font-medium">전체 발생량 중 비중</th>
            </tr>
          </thead>
          <tbody>
            {officialInput.regions.map((region) => {
              const gen = Number(region.generation_quantity_ton);
              const sharePct = total > 0 && Number.isFinite(gen) ? (gen / total) * 100 : null;
              return (
                <tr
                  key={region.region_code}
                  className="border-b border-slate-100 last:border-0"
                  data-testid="fc-region-row"
                >
                  <td className="py-1 pr-3 text-slate-800">
                    {region.region_name}{" "}
                    <span className="text-slate-400">({region.region_code})</span>
                  </td>
                  <td className="py-1 pr-3 tabular-nums text-slate-700">
                    {formatQuantity(region.generation_quantity_ton)} {officialInput.quantity_unit}
                  </td>
                  <td className="py-1 pr-3 tabular-nums text-slate-700">
                    {region.population !== null ? (
                      `${region.population.toLocaleString("en-US")}명`
                    ) : (
                      <span className="text-amber-700" data-testid="fc-region-population-unavailable">
                        공식 인구 미확정
                      </span>
                    )}
                  </td>
                  <td className="py-1 tabular-nums text-slate-700">
                    {sharePct !== null ? `${sharePct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- //

function FacilityCostCandidateContext({
  context,
  selectedCandidate,
}: {
  context: NonNullable<FacilityCostCalculate["candidate_context"]>;
  selectedCandidate: CandidateDetail | null;
}) {
  return (
    <section
      aria-label="후보지 연계"
      className="rounded border border-sky-300 bg-sky-50 p-4 text-xs text-slate-700"
      data-testid="facility-cost-candidate"
    >
      <h2 className="text-sm font-semibold text-slate-900">선택한 후보지 (Selected candidate)</h2>
      <p className="mt-1">
        <strong>{context.candidate_key ?? selectedCandidate?.candidate_key}</strong> ·{" "}
        {context.sigungu_region_name ?? "(시군구 미배정)"} · 상태 {context.suitability_status} · run #
        {context.run_id} · {context.profile}
      </p>
      {/* Source + reference period for the displayed analytical suitability status
          (AGENTS.md), from the candidate's own provenance. */}
      {selectedCandidate && (
        <p className="mt-1 text-slate-500" data-testid="fc-candidate-provenance">
          분석 기준연도 {selectedCandidate.reference_year} · {selectedCandidate.derivation_version} ·{" "}
          {selectedCandidate.policy_version} · {selectedCandidate.candidate_grid_version}
        </p>
      )}
      {/* Optional concise stability badge (ELIGIBLE candidates only). Cost V1 does
          NOT vary by candidate cell, and "stable" is not legal eligibility and adds
          no land/transport/compensation/site-specific cost — preserved as caveats. */}
      {selectedCandidate &&
        selectedCandidate.stable_count != null &&
        stabilityBadgeLabel(selectedCandidate.stability_class, selectedCandidate.stable_count) && (
          <p className="mt-1 text-slate-600" data-testid="fc-candidate-stability">
            가중치 안정성:{" "}
            <span className="font-semibold">
              {stabilityBadgeLabel(
                selectedCandidate.stability_class,
                selectedCandidate.stable_count,
              )}
            </span>{" "}
            — 민감도 지표이며 법적 적격성이 아니고, 비용 V1은 후보 셀별로 달라지지 않습니다 (토지·운송·보상
            등 부지별 비용을 추가하지 않음).
          </p>
        )}
      <p className="mt-1 text-slate-600">{context.note}</p>
      <p className="mt-1 font-medium text-amber-800">{context.suitability_disclaimer}</p>
    </section>
  );
}

// --------------------------------------------------------------------------- //

function FacilityCostEvidence({ result }: { result: FacilityCostCalculate }) {
  const p = result.provenance;
  return (
    <section
      aria-label="출처와 방법"
      className="rounded border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600"
      data-testid="facility-cost-methodology"
    >
      <h2 className="mb-1 text-sm font-semibold text-slate-800">출처·방법 (Sources & method)</h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
        <div>
          <dt className="inline font-medium">공사비 출처: </dt>
          <dd className="inline" data-testid="fc-source">
            {p.source_document} · {p.source_page} · 기준일 {p.price_base_date}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">보조율 출처: </dt>
          <dd className="inline">
            {p.subsidy_rate_source} · {p.subsidy_rate_reference_period}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">계산 버전: </dt>
          <dd className="inline">
            {p.derivation_version} · {p.cost_version}
          </dd>
        </div>
        {/* Source + reference period for every official input behind the derived
            metrics (AGENTS.md), not just the periods. */}
        <div data-testid="fc-waste-source">
          <dt className="inline font-medium">발생량 출처: </dt>
          <dd className="inline">
            {result.official_input.waste_official_dataset_name} (
            {result.official_input.waste_source_id}) · 집계 {result.official_input.accounting_basis}{" "}
            · 기준 {result.official_input.waste_reference_period}
          </dd>
        </div>
        <div data-testid="fc-population-source">
          <dt className="inline font-medium">인구 출처: </dt>
          <dd className="inline">
            {result.official_input.population_source_id
              ? `${result.official_input.population_source_id} · 정의 ${
                  result.official_input.population_definition ?? "—"
                } · 기준 ${result.official_input.population_reference_period ?? "—"}`
              : "동일 기간 공식 인구 미확정 (1인당 지방비 계산 불가)"}
          </dd>
        </div>
      </dl>
      <details className="mt-2">
        <summary className="cursor-pointer font-medium">계산 가정 (assumptions)</summary>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {result.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
      <p className="mt-2 font-medium text-amber-800">{result.disclaimer}</p>
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Citizen deliberation — client-only, NON-persistent (no backend, no PII, no
// aggregate opinion). The selections live only in this component's state.
// --------------------------------------------------------------------------- //

function CitizenConditions() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [response, setResponse] = useState<string | null>(null);
  const toggle = (condition: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(condition)) next.delete(condition);
      else next.add(condition);
      return next;
    });
  return (
    <section
      aria-label="시민 검토 조건"
      className="rounded border border-slate-200 bg-white p-4 text-xs text-slate-700"
      data-testid="facility-cost-conditions"
    >
      <h2 className="text-sm font-semibold text-slate-900">시민 검토 조건 (Deliberation)</h2>
      <p className="mt-1 text-[11px] text-slate-500">
        아래 선택은 이 화면에만 저장되며 서버로 전송되거나 집계되지 않습니다. 개인정보를 수집하지
        않습니다. (Client-only; nothing is stored, sent, or aggregated.)
      </p>
      <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
        <fieldset>
          <legend className="text-[11px] font-semibold text-slate-500">
            검토에 필요한 조건 (select conditions)
          </legend>
          <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2 md:grid-cols-1">
            {CITIZEN_CONDITIONS.map((condition) => (
              <label key={condition} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(condition)}
                  onChange={() => toggle(condition)}
                  data-testid="facility-cost-condition"
                />
                <span>{condition}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-[11px] font-semibold text-slate-500">
            현재 나의 검토 상태 (my current stance)
          </legend>
          <div className="mt-1 flex flex-col gap-1">
            {CITIZEN_RESPONSES.map((option) => (
              <label key={option} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="facility-cost-response"
                  checked={response === option}
                  onChange={() => setResponse(option)}
                  data-testid="facility-cost-response"
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}
