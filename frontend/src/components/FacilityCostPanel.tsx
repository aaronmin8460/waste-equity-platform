"use client";

/**
 * Citizen-facing facility cost lens (Phase 5), shown inside the Suitability
 * experience under a "비용 렌즈" sub-view.
 *
 * This is a decision-support tool, NOT propaganda for or against a facility. It
 * presents the Phase 4 backend's **standard-construction-cost analysis** with its
 * disclaimer and completeness: it never shows an actual total project cost, an
 * approved subsidy, or a personal tax bill, and it renders unavailable components
 * as explicitly unavailable — never as 0. All displayed money is the exact
 * backend-served decimal string, formatted without changing its value.
 */

import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  fetchFacilityCostCalculate,
  fetchFacilityCostOptions,
  type CandidateDetail,
  type FacilityCostCalculate,
  type FacilityCostOptions,
} from "../lib/api";
import { formatQuantity } from "../lib/metrics";

const WASTE_STREAMS: { value: string; label: string }[] = [
  { value: "HOUSEHOLD", label: "생활계 폐기물 (Household)" },
  { value: "BUSINESS_NON_FACILITY", label: "사업장 비배출시설계 (Business non-facility)" },
  { value: "INDUSTRIAL_FACILITY", label: "사업장 배출시설계 (Industrial facility)" },
  { value: "CONSTRUCTION", label: "건설 폐기물 (Construction)" },
];

// The fixed minimum list of unavailable / non-claims the completeness block must
// always show, regardless of the backend's structured missing_components.
const COMPLETENESS_NOTICES = [
  "운영비 미포함",
  "실제 운송비 미포함",
  "토지·보상비 미포함",
  "후보지별 토목조건 미포함",
  "실제 총사업비가 아님",
  "실제 승인된 국고보조금이 아님",
  "주민 개인의 실제 세금 청구액이 아님",
];

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

/** Format an 억원 decimal string without changing its value. */
function formatBn(value: string): string {
  return `${formatQuantity(value)} 억원`;
}

/** Format a 원 decimal string, keeping small values visible. */
function formatWon(value: string): string {
  return `${formatQuantity(value)}원`;
}

export interface FacilityCostPanelProps {
  /** SIGUNGU service-region options (from the loaded SGIS boundaries). */
  regions: { code: string; name: string }[];
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

export default function FacilityCostPanel({ regions, selectedCandidate }: FacilityCostPanelProps) {
  const [options, setOptions] = useState<FacilityCostOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioState | null>(null);
  const [result, setResult] = useState<FacilityCostCalculate | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);

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
      setScenario((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  const calculate = useCallback(() => {
    if (!scenario || scenario.regionCodes.length === 0) return;
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
        setResult(res);
        setCalcError(null);
      })
      .catch((cause: unknown) => {
        // Drop any previous result so a stale scenario's numbers never linger.
        setResult(null);
        setCalcError(
          cause instanceof ApiError ? cause.message : "비용을 계산할 수 없습니다.",
        );
      })
      .finally(() => setCalculating(false));
  }, [scenario, selectedCandidate]);

  if (optionsError) {
    return (
      <section
        className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-slate-700"
        data-testid="facility-cost-options-error"
        role="alert"
      >
        <p>{optionsError}</p>
      </section>
    );
  }
  if (!options || !scenario) {
    return (
      <p className="text-sm text-slate-600" data-testid="facility-cost-loading" role="status">
        비용 옵션을 불러오는 중… (Loading cost options…)
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="facility-cost-panel">
      <CitizenGuide />
      <ScenarioForm
        options={options}
        regions={regions}
        scenario={scenario}
        update={update}
        onCalculate={calculate}
        calculating={calculating}
      />
      {calcError && (
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
      {result && <Results result={result} selectedCandidate={selectedCandidate} />}
      <CitizenConditions />
    </div>
  );
}

// --------------------------------------------------------------------------- //

function CitizenGuide() {
  return (
    <section
      aria-label="시민 안내"
      className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-700"
      data-testid="facility-cost-citizen-guide"
    >
      <h3 className="text-sm font-semibold text-slate-900">우리 지역에 시설이 생긴다면</h3>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-600">
        <li>우리 지역에서 발생한 폐기물은 현재 어떻게 처리되는가</li>
        <li>어느 정도를 지역 시설에서 처리하는 시나리오인가</li>
        <li>필요한 시설 규모는 어느 정도인가</li>
        <li>정부 표준공사비 기준으로 어느 정도인가</li>
        <li>어떤 비용은 아직 계산할 수 없는가</li>
        <li>어떤 조건이 충족되어야 시민이 검토할 수 있는가</li>
      </ul>
      <p
        className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 font-medium text-amber-900"
        data-testid="facility-cost-disclaimer"
      >
        {PAGE_DISCLAIMER}
      </p>
    </section>
  );
}

// --------------------------------------------------------------------------- //

const selectClass =
  "mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800";

function ScenarioForm({
  options,
  regions,
  scenario,
  update,
  onCalculate,
  calculating,
}: {
  options: FacilityCostOptions;
  regions: { code: string; name: string }[];
  scenario: ScenarioState;
  update: <K extends keyof ScenarioState>(key: K, value: ScenarioState[K]) => void;
  onCalculate: () => void;
  calculating: boolean;
}) {
  const noRegions = scenario.regionCodes.length === 0;
  return (
    <section aria-label="시나리오 설정" data-testid="facility-cost-form">
      <h3 className="mb-2 text-sm font-semibold text-slate-800">시나리오 설정 (Scenario)</h3>
      {/* Single column so long Korean labels never clip on a phone. */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium text-slate-600">
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

        <label className="text-xs font-medium text-slate-600">
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

        <label className="text-xs font-medium text-slate-600">
          서비스 지역 (Service regions, SIGUNGU) — 하나 이상 선택
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
            {regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
            {noRegions ? "지역을 선택하면 계산할 수 있습니다." : `선택: ${scenario.regionCodes.length}개`}
          </span>
        </label>

        <label className="text-xs font-medium text-slate-600">
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

        <label className="text-xs font-medium text-slate-600">
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

        <label className="text-xs font-medium text-slate-600">
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

        <label className="text-xs font-medium text-slate-600">
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
        </label>

        {options.cost_versions.length > 1 && (
          <label className="text-xs font-medium text-slate-600">
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

        <button
          type="button"
          onClick={onCalculate}
          disabled={noRegions || calculating}
          className="mt-1 rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          data-testid="facility-cost-calculate"
        >
          {calculating ? "계산 중…" : "표준공사비 기반 설치비 계산"}
        </button>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- //

function Field({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col border-b border-slate-100 py-1 last:border-0">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function Results({
  result,
  selectedCandidate,
}: {
  result: FacilityCostCalculate;
  selectedCandidate: CandidateDetail | null;
}) {
  const { scenario, official_input, capacity, standard_cost, annualization, subsidy, per_capita } =
    result;
  const band = standard_cost.matched_band;
  const bandRange =
    `${band.capacity_min_ton_per_day ?? "0"}–${band.capacity_max_ton_per_day ?? "∞"} 톤/일`;
  return (
    // aria-live so the newly calculated result is announced.
    <div className="flex flex-col gap-4" role="status" data-testid="facility-cost-results">
      <section
        aria-label="계산 결과"
        className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-700"
      >
        <h3 className="mb-2 text-sm font-semibold text-slate-900">
          계산 결과 (Standard-cost analysis)
        </h3>
        <dl className="text-sm">
          <Field
            label="공식 연간 발생량 (official annual quantity)"
            value={`${formatQuantity(official_input.official_annual_quantity_ton)} ${official_input.quantity_unit}`}
            testId="fc-official-quantity"
          />
          <Field
            label="시나리오 처리량 (scenario quantity)"
            value={`${formatQuantity(capacity.annual_service_quantity_ton)} 톤/년 (처리 비율 ${scenario.processing_share_percent}%)`}
          />
          <Field
            label="필요 시설 규모 (required capacity)"
            value={`${formatQuantity(capacity.facility_capacity_ton_per_day)} ${capacity.capacity_unit}`}
            testId="fc-capacity"
          />
          <Field
            label="적용 표준공사비 구간 (matched band)"
            value={`${bandRange} · 단가 ${band.cost_per_capacity_bn} ${band.cost_per_capacity_unit}`}
          />
          <Field
            label={standard_cost.term_ko}
            value={formatBn(standard_cost.standard_construction_cost_bn)}
            testId="fc-standard-cost"
          />
          <Field
            label={`${annualization.term_ko} (내용연수 ${annualization.facility_lifetime_years}년, 가정)`}
            value={`${formatBn(annualization.annualized_construction_cost_bn).replace("억원", "")}${annualization.unit}`}
            testId="fc-annualized"
          />
          <Field
            label={`명목 보조율 (${subsidy.subsidy_scheme_label})`}
            value={`${subsidy.subsidy_rate} · ${subsidy.rate_basis}`}
          />
          <Field
            label="추정 국고보조 (estimated national subsidy)"
            value={formatBn(subsidy.estimated_national_subsidy_bn)}
            testId="fc-subsidy"
          />
          <Field
            label="단순 지방비 추정 (simplified local share)"
            value={formatBn(subsidy.simplified_local_government_share_bn)}
            testId="fc-local-share"
          />
          <div className="flex flex-col py-1">
            <dt className="text-[11px] text-slate-500">{per_capita.term_ko}</dt>
            {per_capita.per_capita_local_share_won !== null ? (
              <dd className="font-medium text-slate-800" data-testid="fc-per-capita">
                {formatWon(per_capita.per_capita_local_share_won)}
              </dd>
            ) : (
              // Never rendered as 0 — the served reason is shown instead.
              <dd className="font-medium text-amber-700" data-testid="fc-per-capita-unavailable">
                계산 불가 ({per_capita.unavailable_reason})
              </dd>
            )}
            <span className="text-[11px] text-slate-500">{per_capita.caveat}</span>
          </div>
        </dl>
      </section>

      <Completeness result={result} />

      {result.candidate_context && (
        <CandidateContext context={result.candidate_context} selectedCandidate={selectedCandidate} />
      )}

      <Methodology result={result} />
    </div>
  );
}

// --------------------------------------------------------------------------- //

function Completeness({ result }: { result: FacilityCostCalculate }) {
  return (
    <section
      aria-label="계산 범위와 한계"
      className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-slate-700"
      data-testid="facility-cost-completeness"
    >
      <p className="font-semibold text-amber-900">현재 결과는 표준공사비 기반 설치비 분석입니다.</p>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        {COMPLETENESS_NOTICES.map((notice) => (
          <li key={notice}>{notice}</li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-slate-500">
        서버 제공 미포함 항목: {result.completeness.missing_components.map((m) => m.component).join(", ")}
      </p>
    </section>
  );
}

function CandidateContext({
  context,
  selectedCandidate,
}: {
  context: NonNullable<FacilityCostCalculate["candidate_context"]>;
  selectedCandidate: CandidateDetail | null;
}) {
  return (
    <section
      aria-label="후보지 연계"
      className="rounded border border-sky-300 bg-sky-50 p-3 text-xs text-slate-700"
      data-testid="facility-cost-candidate"
    >
      <h3 className="text-sm font-semibold text-slate-900">선택한 후보지 (Selected candidate)</h3>
      <p className="mt-1">
        <strong>{context.candidate_key ?? selectedCandidate?.candidate_key}</strong> ·{" "}
        {context.sigungu_region_name ?? "(시군구 미배정)"} · 상태 {context.suitability_status} · run #
        {context.run_id} · {context.profile}
      </p>
      <p className="mt-1 text-slate-600">{context.note}</p>
      <p className="mt-1 font-medium text-amber-800">{context.suitability_disclaimer}</p>
    </section>
  );
}

function Methodology({ result }: { result: FacilityCostCalculate }) {
  const p = result.provenance;
  return (
    <section
      aria-label="출처와 방법"
      className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
      data-testid="facility-cost-methodology"
    >
      <h3 className="mb-1 text-sm font-semibold text-slate-800">출처·방법 (Sources & method)</h3>
      <dl className="space-y-0.5">
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
        <div>
          <dt className="inline font-medium">폐기물·인구 기준: </dt>
          <dd className="inline">
            발생량 {result.official_input.waste_reference_period}
            {result.official_input.population_reference_period
              ? ` · 인구 ${result.official_input.population_reference_period}`
              : " · 인구 기준 미확정"}
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
      className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-700"
      data-testid="facility-cost-conditions"
    >
      <h3 className="text-sm font-semibold text-slate-900">시민 검토 조건 (Deliberation)</h3>
      <p className="mt-1 text-[11px] text-slate-500">
        아래 선택은 이 화면에만 저장되며 서버로 전송되거나 집계되지 않습니다. 개인정보를 수집하지
        않습니다. (Client-only; nothing is stored, sent, or aggregated.)
      </p>
      <fieldset className="mt-2">
        <legend className="text-[11px] font-semibold text-slate-500">
          검토에 필요한 조건 (select conditions)
        </legend>
        <div className="mt-1 flex flex-col gap-1">
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
      <fieldset className="mt-2">
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
    </section>
  );
}
