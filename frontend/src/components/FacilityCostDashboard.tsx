"use client";

/**
 * Citizen-facing facility cost lens, rendered as a FULL-WIDTH dashboard (not a
 * narrow sidebar beside a mostly-irrelevant map). The cost view mounts no MapView —
 * the cost model does not vary by map cell in V1, so a map would be dead weight.
 * See page.tsx for the full-width routing.
 *
 * This is a decision-support tool, NOT propaganda for or against a facility. It
 * presents the backend's **standard-construction-cost analysis** with its disclaimer
 * and completeness: it never shows an actual total project cost, an approved subsidy,
 * a personal tax bill, or a cheapest-site ranking, and it renders unavailable
 * components as explicitly unavailable — never as 0.
 *
 * TWO VIEWS (desktop redesign Phase 3). Phase 2 redesigned SETUP; Phase 3 splits
 * setup from results:
 *   - `setup`   — the region picker, conditions, advanced settings, primary action.
 *   - `results` — one hero answer, three secondary KPIs, everything else collapsed.
 * A successful calculation switches to `results`; a failure stays on `setup` with an
 * actionable error; "설정 바꾸기" returns to `setup` with every input intact and
 * issues no request. The results view is DERIVED (`resultCurrent`), so a stale
 * result — including a late response from superseded inputs — can never open or
 * survive on it.
 *
 * NUMBER CONTRACT. Primary surfaces show an APPROXIMATION produced by
 * `lib/displayNumber.ts` ("약 121억원"). The exact backend decimal string is never
 * changed and stays reachable in the "정밀값과 계산 기준" accordion, formatted only
 * by `formatQuantity` (comma grouping; value-preserving). `Number()` conversion is
 * used ONLY for the decorative funding-bar proportions and the derived display
 * share — never to produce a value described as exact.
 *
 * REASON CODES. Backend codes (`OFFICIAL_SOURCE_NOT_INTEGRATED`, …) are mapped to
 * plain Korean via lib/glossary.ts. They are not deleted: every raw code stays in
 * the API response and in a `data-diagnostic` disclosure.
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
  type SuitabilityProfile,
  type SuitabilityStatus,
} from "../lib/api";
import {
  approximateAnnualBillionWon,
  approximateBillionWon,
  approximatePercent,
  approximateTonPerDay,
  approximateWonAsManwon,
  type ApproximateValue,
} from "../lib/displayNumber";
import {
  accountingBasisLabel,
  MISSING_COMPONENT_META,
  missingComponentLabel,
  missingReasonExplanation,
  perCapitaUnavailableExplanation,
  profileLabel,
  statusLabel,
} from "../lib/glossary";
import { formatQuantity } from "../lib/metrics";
import { regionDisplayName } from "../lib/regionDisplay";
import { stabilityBadgeLabel } from "../lib/suitability";
import Accordion from "./ui/Accordion";
import EmptyState from "./ui/EmptyState";
import InfoBanner from "./ui/InfoBanner";
import KpiCard from "./ui/KpiCard";
import SearchableRegionPicker from "./ui/SearchableRegionPicker";
import Skeleton from "./ui/Skeleton";

// Primary labels are plain Korean only — the parenthesised English that used to
// follow each one ("생활계 폐기물 (Household)") is the G3 duplication the redesign
// plan removes from primary labels. The backend enum is unchanged; it is still the
// option VALUE and still what the calculation payload carries.
const WASTE_STREAMS: { value: string; label: string }[] = [
  { value: "HOUSEHOLD", label: "생활계 폐기물" },
  { value: "BUSINESS_NON_FACILITY", label: "사업장 비배출시설계" },
  { value: "INDUSTRIAL_FACILITY", label: "사업장 배출시설계" },
  { value: "CONSTRUCTION", label: "건설 폐기물" },
];

function wasteStreamLabel(value: string): string {
  return WASTE_STREAMS.find((s) => s.value === value)?.label ?? value;
}

// The fixed minimum list of unavailable / non-claims the SETUP notice must always
// show, regardless of the backend's structured missing_components. These are the
// analytical-honesty guardrails: what this number is NOT.
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

/**
 * The cost components this analysis excludes, in a fixed display order. The first
 * four are the components the endpoint itself enumerates in `missing_components`;
 * the fifth is a standing project-level exclusion the endpoint does not enumerate,
 * so it carries its own wording rather than a served reason.
 */
const EXCLUDED_COMPONENT_ORDER = [
  "OPERATING_COST",
  "ACTUAL_TRANSPORT_COST",
  "LAND_AND_COMPENSATION",
  "REMAINING_LANDFILL_COST",
];

const SITE_WORKS_EXCLUSION = {
  label: "후보지별 토목조건",
  explanation: "후보지마다 다른 지형·기반시설 조건에 따른 공사비 차이는 반영하지 않았습니다.",
};

interface ExcludedRow {
  label: string;
  explanation: string;
  /** The raw served reason code, when the backend reported this component. */
  servedReason: string | null;
  /** The raw component code, when this row corresponds to a backend component. */
  code: string | null;
}

/**
 * Merge the served `missing_components` with the standing exclusion list.
 *
 * Nothing is dropped: a component the backend reports uses ITS served reason, a
 * component it does not report still appears with the registry explanation, and a
 * component this build has never seen is appended rather than swallowed.
 */
function excludedCostRows(missing: { component: string; reason: string }[]): ExcludedRow[] {
  const served = new Map(missing.map((m) => [m.component, m]));
  const rows: ExcludedRow[] = EXCLUDED_COMPONENT_ORDER.map((code) => {
    const hit = served.get(code);
    served.delete(code);
    return {
      label: missingComponentLabel(code),
      explanation: hit
        ? missingReasonExplanation(hit.reason)
        : MISSING_COMPONENT_META[code].explanation,
      servedReason: hit?.reason ?? null,
      code,
    };
  });
  for (const [code, m] of served) {
    rows.push({
      label: missingComponentLabel(code),
      explanation: missingReasonExplanation(m.reason),
      servedReason: m.reason,
      code,
    });
  }
  rows.push({
    label: SITE_WORKS_EXCLUSION.label,
    explanation: SITE_WORKS_EXCLUSION.explanation,
    servedReason: null,
    code: null,
  });
  return rows;
}

const PAGE_DISCLAIMER =
  "이 페이지는 시설 설치를 권고하거나 반대를 설득하기 위한 페이지가 아닙니다. 공식 데이터로 필요성, " +
  "비용, 입지 조건과 불확실성을 함께 검토하기 위한 시민 의사결정 지원 도구입니다.";

const HEADER_SUBTITLE =
  "선택한 지역의 공식 폐기물 자료를 기준으로 필요한 시설 규모와 표준공사비 기반 설치비를 계산합니다.";

// The three non-claims that must be readable BEFORE anything is expanded, on both
// views. The full eight-item exclusion list stays in the collapsed setup accordion,
// and the results view carries its own "포함되지 않은 비용" accordion. Nothing is
// deleted — this is a change of prominence, not of content.
const SETUP_NON_CLAIMS =
  "표준공사비를 기준으로 한 참고용 추정치입니다. 실제 총사업비가 아니며, 주민 개인에게 청구되는 " +
  "금액이나 세금 고지액도 아닙니다.";

// The results-screen equivalent: the same four non-claims, stated compactly beside
// the numbers they qualify. One neutral banner, never role="alert" — a standing
// disclaimer must not interrupt a screen reader on every render.
const RESULTS_NON_CLAIMS =
  "정부 표준공사비 기준으로 계산한 참고용 추정치입니다. 실제 총사업비가 아니며, 국비 보조금이 " +
  "승인되었다는 뜻도 아니고, 1인당 금액은 주민 개인에게 청구되는 금액이 아닙니다.";

const PER_CAPITA_NON_CLAIM = "개인에게 실제로 청구되는 세금이나 부담금이 아닙니다.";

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
 * The approximate text for a primary surface, with a safe fallback.
 *
 * A malformed decimal string makes `displayNumber` return null; the caller then
 * shows the UNCHANGED exact string rather than substituting a fabricated zero.
 */
function approxOrExact(approx: ApproximateValue | null, exact: string, unit: string): string {
  return approx?.text ?? `${formatQuantity(exact)} ${unit}`.trim();
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

/** The advanced inputs only, used to tell the summary whether defaults still hold. */
type AdvancedDefaults = Pick<
  ScenarioState,
  "subsidyScheme" | "operatingDays" | "undergroundMultiplier" | "costVersion"
>;

function advancedChanged(s: ScenarioState, defaults: AdvancedDefaults): boolean {
  return (
    s.subsidyScheme !== defaults.subsidyScheme ||
    s.operatingDays !== defaults.operatingDays ||
    s.undergroundMultiplier !== defaults.undergroundMultiplier ||
    s.costVersion !== defaults.costVersion
  );
}

export default function FacilityCostDashboard({
  wasteRegions,
  selectedCandidate,
}: FacilityCostDashboardProps) {
  const [options, setOptions] = useState<FacilityCostOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioState | null>(null);
  // The advanced values as served, captured once, so the summary can say whether
  // the citizen has moved any of them off the API-provided default.
  const [advancedDefaults, setAdvancedDefaults] = useState<AdvancedDefaults | null>(null);
  const [result, setResult] = useState<FacilityCostCalculate | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  // Which of the two views the citizen asked for. It is only ever a REQUEST: the
  // results view also requires a current result (see `showResults` below), so this
  // flag alone can never surface a stale calculation.
  const [view, setView] = useState<"setup" | "results">("setup");
  // The input signature the current result/error was computed for. The result is
  // shown ONLY while it still matches the live inputs (scenario + selected
  // candidate), so a stale result never sits beside changed controls.
  const [outputSig, setOutputSig] = useState<string | null>(null);
  // Monotonic request id: a superseded in-flight response is discarded, so a late
  // response from an old scenario can never overwrite a newer one.
  const requestSeq = useRef(0);
  // Focus target when returning from results, and the flag that distinguishes a
  // deliberate return from the first paint (which must not steal focus).
  const setupHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const returningToSetup = useRef(false);

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
        // Defaults are unchanged from the previous implementation — the redesign
        // moves these controls, it does not re-seed them.
        const seeded: ScenarioState = {
          facilityType: opts.facility_types[0]?.value ?? "sorting_auto",
          wasteStream: WASTE_STREAMS[0].value,
          subsidyScheme: opts.subsidy_schemes[0]?.value ?? "city_or_county",
          regionCodes: [],
          processingSharePercent: "100",
          operatingDays: opts.default_operating_days,
          undergroundMultiplier: opts.underground_multiplier.default,
          costVersion: opts.active_cost_version,
        };
        setScenario(seeded);
        setAdvancedDefaults({
          subsidyScheme: seeded.subsidyScheme,
          operatingDays: seeded.operatingDays,
          undergroundMultiplier: seeded.undergroundMultiplier,
          costVersion: seeded.costVersion,
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

  // The calculable regions for the SELECTED stream, deduped by code. Only these are
  // offered, so a chosen code always has official waste data. Ordering is applied by
  // SearchableRegionPicker (서울 → 인천 → 경기 → name), which is also what orders the
  // selected chips, so options and chips can never disagree.
  const regionOptions = useMemo(() => {
    const stream = scenario?.wasteStream;
    const seen = new Set<string>();
    return wasteRegions
      .filter((r) => r.stream === stream && !seen.has(r.code) && seen.add(r.code))
      .map((r) => ({ code: r.code, name: r.name }));
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
        // Only a CURRENT, successful response opens the results view.
        setView("results");
      })
      .catch((cause: unknown) => {
        if (myId !== requestSeq.current) return; // superseded → discard
        setResult(null);
        setOutputSig(mySig);
        setCalcError(cause instanceof ApiError ? cause.message : "비용을 계산할 수 없습니다.");
        // A failed calculation stays on setup, with the settings intact.
        setView("setup");
      })
      .finally(() => {
        if (myId === requestSeq.current) setCalculating(false);
      });
  }, [scenario, options, selectedCandidate]);

  /** Return to setup. Pure view state — it issues no request and clears no input. */
  const editSettings = useCallback(() => {
    returningToSetup.current = true;
    setView("setup");
  }, []);

  // Move focus to the first setup heading after a deliberate return, so a keyboard
  // or screen-reader user is not left at the top of the document. Never on mount.
  useEffect(() => {
    if (view !== "setup" || !returningToSetup.current) return;
    returningToSetup.current = false;
    setupHeadingRef.current?.focus();
  }, [view]);

  return (
    <div
      className="mx-auto w-full max-w-screen-2xl px-4 pb-12 sm:px-6 lg:px-8"
      data-testid="facility-cost-dashboard"
    >
      <FacilityCostHeader />

      {optionsError ? (
        // A genuine, actionable failure — the one place role="alert" is warranted
        // for the setup screen.
        <div className="mt-4">
          <InfoBanner
            tone="error"
            title="비용 옵션을 불러오지 못했습니다"
            role="alert"
            testId="facility-cost-options-error"
          >
            <p>{optionsError}</p>
          </InfoBanner>
        </div>
      ) : !options || !scenario || !advancedDefaults ? (
        <p className="mt-4 text-sm text-ink-muted" data-testid="facility-cost-loading" role="status">
          비용 옵션을 불러오는 중…
        </p>
      ) : (
        <FacilityCostBody
          options={options}
          scenario={scenario}
          advancedDefaults={advancedDefaults}
          regionOptions={regionOptions}
          update={update}
          calculate={calculate}
          calculating={calculating}
          result={result}
          resultCurrent={resultCurrent}
          errorCurrent={errorCurrent}
          calcError={calcError}
          selectedCandidate={selectedCandidate}
          view={view}
          onEditSettings={editSettings}
          setupHeadingRef={setupHeadingRef}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //

function FacilityCostBody({
  options,
  scenario,
  advancedDefaults,
  regionOptions,
  update,
  calculate,
  calculating,
  result,
  resultCurrent,
  errorCurrent,
  calcError,
  selectedCandidate,
  view,
  onEditSettings,
  setupHeadingRef,
}: {
  options: FacilityCostOptions;
  scenario: ScenarioState;
  advancedDefaults: AdvancedDefaults;
  regionOptions: { code: string; name: string }[];
  update: <K extends keyof ScenarioState>(key: K, value: ScenarioState[K]) => void;
  calculate: () => void;
  calculating: boolean;
  result: FacilityCostCalculate | null;
  resultCurrent: boolean;
  errorCurrent: boolean;
  calcError: string | null;
  selectedCandidate: CandidateDetail | null;
  view: "setup" | "results";
  onEditSettings: () => void;
  setupHeadingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const validationMessage = validateScenario(scenario, options);
  // The results view is DERIVED, not merely requested: it also requires a result
  // that still matches the live inputs. If the selected candidate changes while the
  // results are open, `resultCurrent` goes false and the citizen is returned to
  // setup with the "recalculate" notice — a stale answer is never displayed.
  const showResults = view === "results" && resultCurrent && result !== null;

  if (showResults && result !== null) {
    return (
      <div className="mt-4">
        <FacilityCostResultsView
          result={result}
          selectedCandidate={selectedCandidate}
          onEditSettings={onEditSettings}
        />
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-5" data-testid="facility-cost-setup-view">
      <FacilityCostSetup
        options={options}
        scenario={scenario}
        advancedDefaults={advancedDefaults}
        regionOptions={regionOptions}
        update={update}
        onCalculate={calculate}
        calculating={calculating}
        validationMessage={validationMessage}
        headingRef={setupHeadingRef}
      />

      {/* A calculation in flight is its own visible state: a decorative skeleton
          where the answer will appear, plus a polite live region (the skeleton is
          aria-hidden and announces nothing on its own). */}
      {calculating && (
        <div className="mx-auto w-full max-w-6xl" data-testid="facility-cost-calculating">
          <p className="text-sm text-ink-muted" role="status" data-testid="facility-cost-calculating-status">
            결과를 계산하고 있습니다…
          </p>
          <Skeleton lines={4} className="mt-3" />
        </div>
      )}

      {errorCurrent && (
        <div className="mx-auto w-full max-w-6xl">
          <InfoBanner
            tone="error"
            title="계산할 수 없습니다"
            role="alert"
            testId="facility-cost-error"
          >
            <p className="font-semibold">{calcError}</p>
            <p className="mt-1 text-xs">
              공식 데이터를 계산할 수 없으면 값을 표시하지 않습니다. 대체 데이터는 사용하지 않습니다.
            </p>
          </InfoBanner>
        </div>
      )}

      {result && !resultCurrent && !calculating && (
        <p
          className="mx-auto w-full max-w-6xl text-xs text-warn"
          role="status"
          data-testid="facility-cost-stale"
        >
          입력이 변경되었습니다. 다시 계산하세요.
        </p>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //

function FacilityCostHeader() {
  return (
    <header data-testid="facility-cost-header">
      {/* The one h1 for this view, on BOTH the setup and results screens — the two
          views are one page, so the results screen adds an h2, not a second h1. */}
      <h1 className="text-2xl font-bold text-ink">시설 비용 살펴보기</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-muted">{HEADER_SUBTITLE}</p>
    </header>
  );
}

// --------------------------------------------------------------------------- //

/**
 * What this analysis is NOT, rationed into two layers on the SETUP screen: a single
 * compact neutral banner with the three claims a citizen must not misread, and the
 * full eight-item list in a COLLAPSED accordion whose summary states how many items
 * it holds. Nothing is removed and no wording is softened — only its prominence
 * changes.
 *
 * `facility-cost-completeness` stays on the element that holds the full list, so its
 * test contract is unchanged. The backend's structured `missing_components` are no
 * longer duplicated here: Phase 3 gives them their own results accordion
 * ("포함되지 않은 비용"), which is the screen they actually belong to.
 */
function FacilityCostNotice() {
  return (
    <>
      {/* Standing disclaimer: informational, never role="alert" — it must not
          interrupt a screen reader on every render. */}
      <InfoBanner tone="info" testId="facility-cost-notice">
        <p data-testid="facility-cost-disclaimer">{PAGE_DISCLAIMER}</p>
        <p className="mt-2 font-medium">{SETUP_NON_CLAIMS}</p>
      </InfoBanner>

      <div className="mt-3">
        <Accordion
          label={`분석에 포함되지 않은 항목 ${COMPLETENESS_NOTICES.length}가지`}
          testId="facility-cost-completeness"
        >
          <p className="text-sm text-ink-muted">
            현재 결과는 표준공사비 기반 설치비 분석입니다. 아래 항목은 포함되지 않았습니다.
          </p>
          <ul className="mt-2 grid list-disc grid-cols-1 gap-x-6 gap-y-1 pl-5 text-sm text-ink-muted sm:grid-cols-2">
            {COMPLETENESS_NOTICES.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </Accordion>
      </div>
    </>
  );
}

// --------------------------------------------------------------------------- //

const fieldClass =
  "mt-1 w-full rounded-control border border-hairline-strong bg-surface px-2 py-1.5 text-sm text-ink";
const labelClass = "block text-sm font-medium text-ink";
const captionClass = "mt-1 block text-xs font-normal text-ink-subtle";

/**
 * The redesigned setup workflow (Phase 2, unchanged by Phase 3 apart from the
 * heading focus target used when returning from results).
 *
 * Desktop layout: a constrained centred container holding a two-column grid — setup
 * controls on the left, a compact scenario summary on the right that sticks while
 * the left column scrolls, so the primary action is reachable without scrolling to
 * the bottom of a long form. Below `lg` the columns stack and the summary returns to
 * normal document flow. Sticky is safe here specifically because the cost branch is
 * map-free: it mounts no `.map-pane`, so nothing depends on this subtree's height
 * (frontend/RESPONSIVE_LAYOUT.md "Sticky positioning").
 */
function FacilityCostSetup({
  options,
  scenario,
  advancedDefaults,
  regionOptions,
  update,
  onCalculate,
  calculating,
  validationMessage,
  headingRef,
}: {
  options: FacilityCostOptions;
  scenario: ScenarioState;
  advancedDefaults: AdvancedDefaults;
  regionOptions: { code: string; name: string }[];
  update: <K extends keyof ScenarioState>(key: K, value: ScenarioState[K]) => void;
  onCalculate: () => void;
  calculating: boolean;
  validationMessage: string | null;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const noRegions = scenario.regionCodes.length === 0;
  const noFacilityTypes = options.facility_types.length === 0;
  const disabled = noRegions || noFacilityTypes || calculating || validationMessage !== null;

  // Why the primary action is unavailable, in plain Korean. This is ordinary
  // guidance rather than an error, so it goes to a POLITE status region — the
  // numeric out-of-range message below keeps role="alert", because an input the
  // user has actually put out of bounds is a genuine actionable error.
  const blockedReason = noFacilityTypes
    ? "시설 종류를 불러오지 못해 계산할 수 없습니다."
    : noRegions
      ? "처리할 지역을 한 곳 이상 선택하면 계산할 수 있습니다."
      : calculating
        ? "계산 중입니다."
        : validationMessage !== null
          ? "고급 설정에 입력한 값을 확인해 주세요."
          : "";

  return (
    <div className="mx-auto w-full max-w-6xl" data-testid="facility-cost-form">
      <FacilityCostNotice />

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ── Left column: the setup controls ─────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <section className="wep-card p-4" aria-labelledby="fc-step-regions">
            {/* tabIndex -1 so returning from the results view can land focus here
                (it is a programmatic target only, never a Tab stop). */}
            <h2
              id="fc-step-regions"
              ref={headingRef}
              tabIndex={-1}
              className="text-base font-semibold text-ink"
            >
              1. 처리할 지역
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              공식 폐기물 자료가 있는 지역만 선택할 수 있습니다.
            </p>
            <div className="mt-3">
              {regionOptions.length === 0 ? (
                <EmptyState
                  title="이 폐기물 종류로 계산 가능한 지역이 없습니다."
                  description="공식 폐기물 자료가 있는 지역이 없어 계산할 수 없습니다. 폐기물 종류를 바꿔 보세요."
                  testId="facility-cost-regions-empty"
                />
              ) : (
                <SearchableRegionPicker
                  label="지역 이름 검색"
                  hint="이름을 입력하거나 아래 버튼으로 광역시·도 전체를 선택할 수 있습니다."
                  regions={regionOptions}
                  selectedCodes={scenario.regionCodes}
                  onChange={(codes) => update("regionCodes", codes)}
                />
              )}
            </div>
          </section>

          <section className="wep-card p-4" aria-labelledby="fc-step-conditions">
            <h2 id="fc-step-conditions" className="text-base font-semibold text-ink">
              2. 처리 조건
            </h2>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                폐기물 종류
                <select
                  className={fieldClass}
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
                <span className={captionClass}>
                  종류를 바꾸면 계산 가능한 지역이 달라져 선택한 지역이 초기화됩니다.
                </span>
              </label>

              <label className={labelClass}>
                지역 처리 비율 (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className={fieldClass}
                  data-testid="facility-cost-processing-share"
                  value={scenario.processingSharePercent}
                  onChange={(e) => update("processingSharePercent", e.target.value)}
                />
                <span className={captionClass}>
                  선택한 지역의 발생량 중 이 시설에서 처리할 비율입니다.
                </span>
              </label>
            </div>

            <div className="mt-4">
              <FacilityTypeCards
                facilityTypes={options.facility_types}
                value={scenario.facilityType}
                onChange={(value) => update("facilityType", value)}
              />
            </div>
          </section>

          {/* Advanced settings collapse by default. They open automatically when a
              value inside is out of range, so an invalid input is never hidden — and
              the summary card repeats the reason next to the calculate button. */}
          <Accordion
            label="고급 설정"
            defaultOpen={validationMessage !== null}
            testId="facility-cost-advanced-settings"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                연간 가동일수
                <input
                  type="number"
                  min={1}
                  max={366}
                  step={1}
                  className={fieldClass}
                  data-testid="facility-cost-operating-days"
                  value={scenario.operatingDays}
                  onChange={(e) => update("operatingDays", Number(e.target.value))}
                />
              </label>

              <label className={labelClass}>
                지하화 배수 ({options.underground_multiplier.min}–
                {options.underground_multiplier.max})
                <input
                  type="number"
                  min={Number(options.underground_multiplier.min)}
                  max={Number(options.underground_multiplier.max)}
                  step={0.05}
                  className={fieldClass}
                  data-testid="facility-cost-underground"
                  value={scenario.undergroundMultiplier}
                  onChange={(e) => update("undergroundMultiplier", e.target.value)}
                />
                <span className={captionClass}>{options.underground_multiplier.note}</span>
              </label>

              <label className={labelClass}>
                보조 시나리오
                <select
                  className={fieldClass}
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
                {/* The subsidy rate's source + reference period, kept immediately
                    beside its selector in every state (docs/FACILITY_COST_LENS_UI.md).
                    It moves with the control; it is never separated from it. */}
                <span className={captionClass} data-testid="facility-cost-subsidy-note">
                  {SUBSIDY_RATE_FORM_NOTE}
                </span>
              </label>

              {options.cost_versions.length > 1 ? (
                <label className={labelClass}>
                  공사비 버전
                  <select
                    className={fieldClass}
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
              ) : (
                // Exactly one version exists, so the API exposes no choice. It is
                // shown read-only rather than as a one-option select that pretends
                // to be editable.
                <div className={labelClass}>
                  공사비 버전
                  <p className="mt-1 text-sm text-ink-muted" data-testid="facility-cost-version-fixed">
                    {scenario.costVersion}
                  </p>
                  <span className={captionClass}>현재 적용 중인 기준 한 가지만 제공됩니다.</span>
                </div>
              )}
            </div>

            {/* Validation stays inside the accordion beside the field it refers to,
                AND is summarised next to the calculate button, so a closed accordion
                never becomes the only home for an active error. */}
            {validationMessage && (
              <p className="mt-3 text-sm text-warn" role="alert" data-testid="facility-cost-validation">
                {validationMessage}
              </p>
            )}
          </Accordion>
        </div>

        {/* ── Right column: the scenario summary + primary action ─────────── */}
        <FacilityCostSetupSummary
          options={options}
          scenario={scenario}
          advancedDefaults={advancedDefaults}
          regionOptions={regionOptions}
          onCalculate={onCalculate}
          calculating={calculating}
          disabled={disabled}
          blockedReason={blockedReason}
          validationMessage={validationMessage}
        />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //

/**
 * Facility type as selection cards instead of a dropdown.
 *
 * Native `<input type="radio">` inside a `<fieldset>`/`<legend>`, one per option
 * SERVED BY THE API — the count is never assumed, so a third facility type would
 * lay out correctly with no code change. The visible text is exactly the served
 * label: no capacity, cost, approval, or engineering description is invented here,
 * because the options endpoint does not provide one.
 *
 * Selection is signalled by the native radio dot, a border change, AND a heavier
 * font weight — three signals, so it never depends on color alone.
 */
function FacilityTypeCards({
  facilityTypes,
  value,
  onChange,
}: {
  facilityTypes: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (facilityTypes.length === 0) {
    return (
      <EmptyState
        title="시설 종류를 불러오지 못했습니다."
        description="서버가 시설 종류를 제공하지 않아 계산할 수 없습니다."
        testId="facility-cost-facility-type-empty"
      />
    );
  }
  return (
    <fieldset data-testid="facility-cost-facility-type">
      <legend className="text-sm font-medium text-ink">시설 종류</legend>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {facilityTypes.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              data-testid="facility-cost-facility-type-card"
              data-selected={selected || undefined}
              className={`flex cursor-pointer items-start gap-2 rounded-card border p-3 text-sm ${
                selected
                  ? "border-primary bg-primary-soft font-semibold text-ink"
                  : "border-hairline bg-surface text-ink-muted"
              }`}
            >
              <input
                type="radio"
                name="facility-cost-facility-type"
                className="mt-0.5"
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// --------------------------------------------------------------------------- //

/** "서울 중구, 인천 중구 외 8개" — never the full list, and never a region code. */
function summariseRegions(labels: string[], head = 2): string {
  if (labels.length === 0) return "선택 안 함";
  if (labels.length <= head) return labels.join(", ");
  return `${labels.slice(0, head).join(", ")} 외 ${labels.length - head}개`;
}

/**
 * The compact scenario summary. Sticky at `lg`+ so the primary action stays on
 * screen; a plain block below that, where the columns stack.
 */
function FacilityCostSetupSummary({
  options,
  scenario,
  advancedDefaults,
  regionOptions,
  onCalculate,
  calculating,
  disabled,
  blockedReason,
  validationMessage,
}: {
  options: FacilityCostOptions;
  scenario: ScenarioState;
  advancedDefaults: AdvancedDefaults;
  regionOptions: { code: string; name: string }[];
  onCalculate: () => void;
  calculating: boolean;
  disabled: boolean;
  blockedReason: string;
  validationMessage: string | null;
}) {
  const selectedLabels = useMemo(() => {
    const byCode = new Map(regionOptions.map((r) => [r.code, r]));
    return scenario.regionCodes
      .map((code) => {
        const region = byCode.get(code);
        return region ? regionDisplayName(region.code, region.name) : null;
      })
      .filter((label): label is string => label !== null);
  }, [regionOptions, scenario.regionCodes]);

  const facilityLabel =
    options.facility_types.find((f) => f.value === scenario.facilityType)?.label ?? "선택 안 함";
  const changed = advancedChanged(scenario, advancedDefaults);

  return (
    // Deliberately a <section>, not an <aside>: in this codebase `<aside>` marks the
    // equity map sidebar specifically (e2e/desktopNavigation.spec.ts asserts the
    // map-free pages have none, and terminology.audit.test.tsx queries for it), so a
    // second one here would blur a landmark that other checks rely on.
    <section
      aria-labelledby="fc-summary-heading"
      className="lg:sticky lg:top-6 lg:self-start"
      data-testid="facility-cost-setup-summary"
    >
      <div className="wep-card p-4">
        <h2 id="fc-summary-heading" className="text-base font-semibold text-ink">
          현재 설정
        </h2>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <div>
            <dt className="text-xs text-ink-subtle">선택 지역</dt>
            <dd className="text-ink" data-testid="facility-cost-summary-regions">
              {scenario.regionCodes.length}개 · {summariseRegions(selectedLabels)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">폐기물</dt>
            <dd className="text-ink">{wasteStreamLabel(scenario.wasteStream)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">처리 비율</dt>
            <dd className="text-ink">
              {scenario.processingSharePercent === "" ? "미입력" : `${scenario.processingSharePercent}%`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">시설 종류</dt>
            <dd className="text-ink">{facilityLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">고급 설정</dt>
            <dd className="text-ink" data-testid="facility-cost-summary-advanced">
              {changed ? "기본값에서 변경됨" : "기본값"}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={onCalculate}
          disabled={disabled}
          className="wep-btn-primary mt-4 w-full"
          data-testid="facility-cost-calculate"
        >
          {calculating ? "계산 중…" : "비용 계산하기"}
        </button>

        {/* Polite guidance for the ordinary "not ready yet" states. An out-of-range
            advanced input is ALSO surfaced here, so a collapsed accordion can never
            be the only place an active validation error is stated. */}
        <p
          className="mt-2 text-xs text-ink-muted"
          role="status"
          data-testid="facility-cost-calculate-status"
        >
          {validationMessage ?? blockedReason}
        </p>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Results view (Phase 3)
// --------------------------------------------------------------------------- //

/**
 * The calculated answer, in one deliberate order: return-to-setup → heading and
 * scenario context → one compact disclaimer → hero KPI → three secondary KPIs →
 * collapsed detail accordions.
 *
 * Only the KPI block is a live region: it holds the answer worth announcing, and
 * keeping the accordions outside it means a collapsed `<details>` is never the only
 * home for a `role="status"` (Accordion.tsx's stated consumer contract).
 */
function FacilityCostResultsView({
  result,
  selectedCandidate,
  onEditSettings,
}: {
  result: FacilityCostCalculate;
  selectedCandidate: CandidateDetail | null;
  onEditSettings: () => void;
}) {
  const excluded = useMemo(
    () => excludedCostRows(result.completeness.missing_components),
    [result.completeness.missing_components],
  );

  return (
    <div className="mx-auto w-full max-w-6xl" data-testid="facility-cost-results-view">
      {/* A native button, not history navigation: the two views are internal state,
          so hijacking the back button would break the browser's own semantics. */}
      <button
        type="button"
        onClick={onEditSettings}
        className="wep-btn-quiet"
        data-testid="facility-cost-edit-settings"
      >
        ← 설정 바꾸기
      </button>

      <div className="mt-4">
        <h2 className="text-xl font-bold text-ink">시설 비용 계산 결과</h2>
        <p className="mt-1 text-sm text-ink-muted" data-testid="facility-cost-results-context">
          {resultsContextLine(result)}
        </p>
      </div>

      {/* One compact neutral banner. A standing disclaimer is never role="alert". */}
      <div className="mt-3">
        <InfoBanner tone="info" testId="facility-cost-results-notice">
          <p>{RESULTS_NON_CLAIMS}</p>
        </InfoBanner>
      </div>

      <div className="mt-5 flex flex-col gap-4" role="status" data-testid="facility-cost-results">
        <FacilityCostHeroKpi result={result} />
        <FacilityCostSecondaryKpis result={result} />
      </div>

      <div className="mt-6 flex flex-col gap-3" data-testid="facility-cost-result-sections">
        <Accordion label="국비·지방비 구성" testId="facility-cost-funding-section">
          <FacilityCostFundingBreakdown result={result} />
        </Accordion>

        <Accordion label="지역별 공식 투입 데이터" testId="facility-cost-region-section">
          <FacilityCostRegionTable officialInput={result.official_input} />
        </Accordion>

        {/* Omitted entirely when no candidate was carried in — an empty accordion
            would imply there is something to open. */}
        {result.candidate_context && (
          <Accordion label="선택한 후보지 정보" testId="facility-cost-candidate-section">
            <FacilityCostCandidateContext
              context={result.candidate_context}
              selectedCandidate={selectedCandidate}
            />
          </Accordion>
        )}

        <Accordion label="계산 가정" testId="facility-cost-assumptions">
          <FacilityCostAssumptions result={result} />
        </Accordion>

        <Accordion
          label={`포함되지 않은 비용 ${excluded.length}개`}
          testId="facility-cost-exclusions"
        >
          <FacilityCostExclusions rows={excluded} />
        </Accordion>

        <Accordion label="출처와 계산 방법" testId="facility-cost-methodology-section">
          <FacilityCostEvidence result={result} />
        </Accordion>

        <Accordion label="정밀값과 계산 기준" testId="facility-cost-exact-values">
          <FacilityCostExactValues result={result} />
        </Accordion>
      </div>
    </div>
  );
}

/**
 * "선택한 3개 지역 · 서울 종로구 · 생활계 폐기물 · 처리 비율 100% · 자동선별 재활용시설"
 *
 * Built from the regions the backend actually calculated with, named through
 * `regionDisplayName` so 서울 중구 and 인천 중구 stay distinguishable WITHOUT a raw
 * region code reaching the screen (the Phase 2 rule, carried into results).
 */
function resultsContextLine(result: FacilityCostCalculate): string {
  const regions = result.official_input.regions;
  const labels = regions.map((r) => regionDisplayName(r.region_code, r.region_name));
  const share = approximatePercent(result.scenario.processing_share_percent);
  return [
    `선택한 ${regions.length}개 지역`,
    summariseRegions(labels),
    wasteStreamLabel(result.official_input.waste_stream),
    `처리 비율 ${share?.text ?? `${result.scenario.processing_share_percent}%`}`,
    result.scenario.facility_type_label,
  ].join(" · ");
}

// --------------------------------------------------------------------------- //

/**
 * The one dominant answer: the per-resident conversion of the simplified local
 * share, shown as a readable approximation.
 *
 * It is NOT a bill. The caveat is served by the backend and is restated in the
 * project's own words, and the label is never rewritten to 주민 부담 청구액 /
 * 실제 세금 / 개인 부담금 / 확정 주민 부담. When the backend cannot compute it, the
 * card keeps its position and shows the plain-Korean rendering of the served
 * reason — never 0원, and never an invented per-capita of our own.
 */
function FacilityCostHeroKpi({ result }: { result: FacilityCostCalculate }) {
  const pc = result.per_capita;
  const available = pc.per_capita_local_share_won !== null;
  const approx = available ? approximateWonAsManwon(pc.per_capita_local_share_won as string) : null;

  return (
    <dl>
      <KpiCard
        size="hero"
        label={pc.term_ko}
        value={
          available
            ? approxOrExact(approx, pc.per_capita_local_share_won as string, pc.unit)
            : undefined
        }
        unavailableReason={
          available
            ? undefined
            : `계산 불가 — ${perCapitaUnavailableExplanation(pc.unavailable_reason)}`
        }
        caption={
          <>
            <span className="block font-medium text-warn">{PER_CAPITA_NON_CLAIM}</span>
            <span className="mt-1 block">{pc.caveat}</span>
            {available && (
              <span className="mt-1 block">
                정확한 값은 아래 &ldquo;정밀값과 계산 기준&rdquo;에서 확인할 수 있습니다.
              </span>
            )}
          </>
        }
        testId="facility-cost-hero"
        valueTestId={available ? "fc-per-capita" : "fc-per-capita-unavailable"}
      />
    </dl>
  );
}

/**
 * The three supporting numbers, all approximations. Each keeps the honest concept
 * name the backend serves — never 총비용 / 총사업비 / 확정 사업비 / 최종 사업비.
 */
function FacilityCostSecondaryKpis({ result }: { result: FacilityCostCalculate }) {
  const { capacity, standard_cost, annualization } = result;
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard
        label={standard_cost.term_ko}
        value={approxOrExact(
          approximateBillionWon(standard_cost.standard_construction_cost_bn),
          standard_cost.standard_construction_cost_bn,
          standard_cost.unit,
        )}
        caption={`적용 구간: ${matchedBandLabel(standard_cost.matched_band)}`}
        valueTestId="fc-standard-cost"
      />
      <KpiCard
        label="필요한 시설 규모"
        value={approxOrExact(
          approximateTonPerDay(capacity.facility_capacity_ton_per_day),
          capacity.facility_capacity_ton_per_day,
          capacity.capacity_unit,
        )}
        caption={`연간 가동일수 ${capacity.operating_days_per_year}일 기준`}
        valueTestId="fc-capacity"
      />
      <KpiCard
        label={annualization.term_ko}
        value={approxOrExact(
          approximateAnnualBillionWon(annualization.annualized_construction_cost_bn),
          annualization.annualized_construction_cost_bn,
          annualization.unit,
        )}
        caption={`내용연수 ${annualization.facility_lifetime_years}년 가정`}
        valueTestId="fc-annualized"
      />
    </dl>
  );
}

// --------------------------------------------------------------------------- //

/**
 * Funding breakdown of the ONE-TIME standard construction cost into its nominal
 * national subsidy + simplified local share. A stacked horizontal bar; the widths
 * use Number() conversion for proportion only — every displayed money value is the
 * exact backend string. Annualized cost is deliberately NOT mixed in, and missing
 * components are NOT shown as zero-width categories (they are in the exclusions
 * accordion).
 */
function FacilityCostFundingBreakdown({ result }: { result: FacilityCostCalculate }) {
  const total = Number(result.standard_cost.standard_construction_cost_bn);
  const subsidyN = Number(result.subsidy.estimated_national_subsidy_bn);
  const localN = Number(result.subsidy.simplified_local_government_share_bn);
  const subsidyPct = total > 0 ? Math.max(0, Math.min(100, (subsidyN / total) * 100)) : 0;
  const localPct = total > 0 ? Math.max(0, Math.min(100, (localN / total) * 100)) : 0;
  return (
    <section aria-label="설치비 재원 구성" data-testid="facility-cost-funding">
      <p className="text-xs text-ink-subtle">
        일회성 설치비 산정액을 명목 국고보조 추정액과 단순 지방비 추정액으로 나눈 분석용 구성입니다. 보조금
        승인을 의미하지 않으며, 연간 환산 설치비와 합산하지 않습니다.
      </p>
      {/* The stacked bar is decorative; every value is available as text below. */}
      <div
        aria-hidden
        className="mt-3 flex h-5 w-full overflow-hidden rounded border border-hairline-strong"
      >
        <div className="h-full bg-primary" style={{ width: `${subsidyPct}%` }} />
        <div className="h-full bg-hairline-strong" style={{ width: `${localPct}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-primary" />
          <div>
            <dt className="text-xs text-ink-subtle">명목 국고보조 추정액</dt>
            <dd className="text-sm font-semibold tabular-nums text-ink" data-testid="fc-funding-subsidy">
              {formatBn(result.subsidy.estimated_national_subsidy_bn)}
            </dd>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-hairline-strong" />
          <div>
            <dt className="text-xs text-ink-subtle">단순 지방비 추정액</dt>
            <dd className="text-sm font-semibold tabular-nums text-ink" data-testid="fc-funding-local">
              {formatBn(result.subsidy.simplified_local_government_share_bn)}
            </dd>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm border border-hairline-strong" />
          <div>
            <dt className="text-xs text-ink-subtle">합계 (설치비 산정액)</dt>
            <dd className="text-sm font-semibold tabular-nums text-ink" data-testid="fc-funding-total">
              {formatBn(result.standard_cost.standard_construction_cost_bn)}
            </dd>
          </div>
        </div>
      </dl>
      <dl className="mt-3 flex flex-col gap-1 text-xs text-ink-muted">
        <div>
          <dt className="inline font-medium">적용 보조 시나리오: </dt>
          <dd className="inline" data-testid="fc-funding-scheme">
            {result.subsidy.subsidy_scheme_label} · 명목 보조율 {result.subsidy.subsidy_rate}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">보조율 근거: </dt>
          <dd className="inline" data-testid="fc-funding-rate-basis">
            {result.subsidy.rate_basis} · 출처 {result.subsidy.rate_source} · 기준{" "}
            {result.subsidy.rate_reference_period}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs font-medium text-warn">{result.subsidy.note}</p>
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
    <section aria-label="지역별 공식 투입 데이터" data-testid="facility-cost-region-table">
      <p className="text-xs text-ink-subtle">
        비중은 공식 지역 발생량 ÷ 공식 합계로 계산한 표시용 파생값입니다. 비용은 지역별로 배분하지 않습니다.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-xs">
          <caption className="sr-only">
            선택한 지역별 공식 연간 폐기물 발생량, 공식 인구, 전체 발생량 중 비중
          </caption>
          <thead>
            <tr className="border-b border-hairline text-ink-subtle">
              <th scope="col" className="py-1 pr-3 font-medium">
                지역
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                공식 연간 발생량
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                인구
              </th>
              <th scope="col" className="py-1 font-medium">
                전체 발생량 중 비중
              </th>
            </tr>
          </thead>
          <tbody>
            {officialInput.regions.map((region) => {
              const gen = Number(region.generation_quantity_ton);
              const sharePct = total > 0 && Number.isFinite(gen) ? (gen / total) * 100 : null;
              return (
                <tr
                  key={region.region_code}
                  className="border-b border-hairline last:border-0"
                  data-testid="fc-region-row"
                >
                  <th scope="row" className="py-1 pr-3 text-left font-normal text-ink">
                    {/* The metro-prefixed display name, so 서울 중구 and 인천 중구
                        are distinguishable without exposing a raw code (the code is
                        in the diagnostic list below). */}
                    {regionDisplayName(region.region_code, region.region_name)}
                  </th>
                  <td className="py-1 pr-3 tabular-nums text-ink-muted">
                    {formatQuantity(region.generation_quantity_ton)} {officialInput.quantity_unit}
                  </td>
                  <td className="py-1 pr-3 tabular-nums text-ink-muted">
                    {region.population !== null ? (
                      `${region.population.toLocaleString("en-US")}명`
                    ) : (
                      <span className="text-warn" data-testid="fc-region-population-unavailable">
                        공식 인구 미확정
                      </span>
                    )}
                  </td>
                  <td className="py-1 tabular-nums text-ink-muted">
                    {sharePct !== null ? `${sharePct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="mt-3" data-diagnostic="true" data-testid="fc-region-codes">
        <summary className="cursor-pointer text-xs text-ink-subtle">지역 코드 자세히 보기</summary>
        <p className="mt-1 break-words text-xs text-ink-subtle">
          {officialInput.regions.map((r) => `${r.region_name}: ${r.region_code}`).join(" · ")}
        </p>
      </details>
    </section>
  );
}

// --------------------------------------------------------------------------- //

/**
 * Candidate context.
 *
 * The candidate is identified to a citizen by its REGION, and its screening outcome
 * by the plain status label — not by the grid key (`capital-grid-500m-v1:10_20`) or
 * the raw enum (`ELIGIBLE`), which are technical identifiers this project's own
 * glossary demotes to a detail layer. Nothing is lost: the key, the raw status, the
 * profile, the run, the reference year, and every version string stay in the
 * diagnostic disclosure below, which is what `fc-candidate-provenance` marks.
 *
 * An `ELIGIBLE` screening status is never reinterpreted as legally eligible,
 * permitted, approved, or developable.
 */
function FacilityCostCandidateContext({
  context,
  selectedCandidate,
}: {
  context: NonNullable<FacilityCostCalculate["candidate_context"]>;
  selectedCandidate: CandidateDetail | null;
}) {
  const regionLabel =
    [context.sido_region_name, context.sigungu_region_name].filter(Boolean).join(" ") ||
    "(시군구 미배정)";
  const status = context.suitability_status;
  const profile = context.profile;
  return (
    <section aria-label="후보지 연계" className="text-xs text-ink-muted" data-testid="facility-cost-candidate">
      <p className="text-ink">
        <strong>{regionLabel}</strong>
        {status ? ` · ${statusLabel(status as SuitabilityStatus)}` : ""}
        {profile ? ` · ${profileLabel(profile as SuitabilityProfile)}` : ""}
      </p>
      {/* Source + reference period for the displayed analytical suitability status
          (AGENTS.md), from the candidate's own provenance — with the technical
          identifiers kept here rather than in the primary line. */}
      <details className="mt-1" data-diagnostic="true">
        <summary className="cursor-pointer text-ink-subtle">후보지 분석 정보 자세히 보기</summary>
        <p className="mt-1 break-words" data-testid="fc-candidate-provenance">
          {context.candidate_key ?? selectedCandidate?.candidate_key} · 분석 실행 #{context.run_id} ·
          상태 코드 {status ?? "—"} · 점수 기준 {profile ?? "—"}
          {selectedCandidate && (
            <>
              {" "}
              · 분석 기준연도 {selectedCandidate.reference_year} ·{" "}
              {selectedCandidate.derivation_version} · {selectedCandidate.policy_version} ·{" "}
              {selectedCandidate.candidate_grid_version}
            </>
          )}
        </p>
      </details>
      {/* Optional concise stability badge (ELIGIBLE candidates only). Cost V1 does
          NOT vary by candidate cell, and "stable" is not legal eligibility and adds
          no land/transport/compensation/site-specific cost — preserved as caveats. */}
      {selectedCandidate &&
        selectedCandidate.stable_count != null &&
        stabilityBadgeLabel(selectedCandidate.stability_class, selectedCandidate.stable_count) && (
          <p className="mt-1" data-testid="fc-candidate-stability">
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
      <p className="mt-1">{context.note}</p>
      <p className="mt-1 font-medium text-warn">{context.suitability_disclaimer}</p>
    </section>
  );
}

// --------------------------------------------------------------------------- //

/**
 * What the calculation assumed, in Korean-first labels. Technical identifiers
 * (derivation version, cost version, annualization method) are demoted to the
 * diagnostic disclosure at the end rather than used as primary labels.
 */
function FacilityCostAssumptions({ result }: { result: FacilityCostCalculate }) {
  const { scenario, capacity, annualization, standard_cost, official_input } = result;
  const rows: { label: string; value: string; testId?: string }[] = [
    { label: "폐기물 종류", value: wasteStreamLabel(official_input.waste_stream) },
    { label: "시설 종류", value: scenario.facility_type_label },
    { label: "지역 처리 비율", value: `${scenario.processing_share_percent}%` },
    { label: "연간 가동일수", value: `${capacity.operating_days_per_year}일` },
    {
      label: "지하화 배수",
      value: `${scenario.underground_multiplier} · ${scenario.underground_multiplier_note}`,
    },
    {
      label: "보조 시나리오",
      value: `${scenario.subsidy_scheme_label} · 명목 보조율 ${scenario.subsidy_rate}`,
    },
    { label: "적용 공사비 기준", value: standard_cost.term_ko },
    {
      label: "적용 표준공사비 구간",
      value: `${matchedBandLabel(standard_cost.matched_band)} · 단가 ${formatQuantity(
        standard_cost.matched_band.cost_per_capacity_bn,
      )} ${standard_cost.matched_band.cost_per_capacity_unit}`,
      testId: "fc-matched-band",
    },
    {
      label: "연간 환산 기준",
      value: `내용연수 ${annualization.facility_lifetime_years}년 · ${annualization.lifetime_basis}`,
    },
  ];

  return (
    <div className="text-xs text-ink-muted">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="inline font-medium text-ink">{row.label}: </dt>
            <dd className="inline" data-testid={row.testId}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <ul className="mt-3 list-disc space-y-1 pl-4" data-testid="fc-assumption-list">
        {result.assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- //

/**
 * The cost items this analysis does not include.
 *
 * Every component is stated in plain Korean with a plain reason. The raw backend
 * component/reason codes are NOT discarded — they sit in the diagnostic disclosure
 * at the end, which is also the only place they may appear (redesign plan §9 Phase 3
 * AC6/AC7). An unavailable component is never described as 0.
 */
function FacilityCostExclusions({ rows }: { rows: ExcludedRow[] }) {
  const served = rows.filter((r) => r.servedReason !== null);
  return (
    <div data-testid="facility-cost-missing">
      <p className="text-xs text-ink-subtle">
        아래 항목은 이 계산에 포함되지 않았습니다. 자료가 없어 계산하지 못한 것이며, 비용이 0이라는 뜻이
        아닙니다.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.label} className="text-sm" data-testid="facility-cost-missing-row">
            <span className="font-medium text-ink">{row.label}</span>{" "}
            <span className="text-warn">미포함</span>
            <span className="mt-0.5 block text-xs text-ink-muted">{row.explanation}</span>
          </li>
        ))}
      </ul>
      {served.length > 0 && (
        <details className="mt-3" data-diagnostic="true" data-testid="facility-cost-missing-diagnostic">
          <summary className="cursor-pointer text-xs text-ink-subtle">
            서버가 보낸 항목 코드 자세히 보기
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 break-words text-xs text-ink-subtle">
            {served.map((row) => (
              <li key={row.code}>
                {row.code}: {row.servedReason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //

function FacilityCostEvidence({ result }: { result: FacilityCostCalculate }) {
  const p = result.provenance;
  const basis = result.official_input.accounting_basis;
  return (
    <section aria-label="출처와 방법" className="text-xs text-ink-muted" data-testid="facility-cost-methodology">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <div>
          <dt className="inline font-medium text-ink">공사비 출처: </dt>
          <dd className="inline" data-testid="fc-source">
            {p.source_document} · {p.source_page} · 기준일 {p.price_base_date}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium text-ink">보조율 출처: </dt>
          <dd className="inline">
            {p.subsidy_rate_source} · {p.subsidy_rate_reference_period}
          </dd>
        </div>
        {/* Source + reference period for every official input behind the derived
            metrics (AGENTS.md), not just the periods. */}
        <div data-testid="fc-waste-source">
          <dt className="inline font-medium text-ink">발생량 출처: </dt>
          <dd className="inline">
            {result.official_input.waste_official_dataset_name} (
            {result.official_input.waste_source_id}) · 집계 {accountingBasisLabel(basis)} · 기준{" "}
            {result.official_input.waste_reference_period}
          </dd>
        </div>
        <div data-testid="fc-population-source">
          <dt className="inline font-medium text-ink">인구 출처: </dt>
          <dd className="inline">
            {result.official_input.population_source_id
              ? `${result.official_input.population_source_id} · 정의 ${
                  result.official_input.population_definition ?? "—"
                } · 기준 ${result.official_input.population_reference_period ?? "—"}`
              : "동일 기간 공식 인구 미확정 (1인당 지방비 계산 불가)"}
          </dd>
        </div>
      </dl>
      <p className="mt-2 font-medium text-warn">{result.disclaimer}</p>
    </section>
  );
}

// --------------------------------------------------------------------------- //

/**
 * The exact backend-served values, unchanged.
 *
 * Every number here is the ORIGINAL API decimal string passed through
 * `formatQuantity` (comma grouping only — value-preserving). None of them is
 * reconstructed from the approximation shown above, and none is parsed to a
 * JavaScript Number on the way to the screen.
 */
function FacilityCostExactValues({ result }: { result: FacilityCostCalculate }) {
  const { official_input, capacity, standard_cost, annualization, subsidy, per_capita } = result;
  const rows: { label: string; value: string; testId: string }[] = [
    {
      label: "공식 연간 폐기물 발생량",
      value: `${formatQuantity(official_input.official_annual_quantity_ton)} ${official_input.quantity_unit}`,
      testId: "fc-official-quantity",
    },
    {
      label: "시나리오 처리량",
      value: `${formatQuantity(capacity.annual_service_quantity_ton)} 톤/년`,
      testId: "fc-scenario-quantity",
    },
    {
      label: "필요한 시설 규모",
      value: `${formatQuantity(capacity.facility_capacity_ton_per_day)} ${capacity.capacity_unit}`,
      testId: "fc-exact-capacity",
    },
    {
      label: standard_cost.term_ko,
      value: formatBn(standard_cost.standard_construction_cost_bn),
      testId: "fc-exact-standard-cost",
    },
    {
      label: annualization.term_ko,
      value: `${formatQuantity(annualization.annualized_construction_cost_bn)} ${annualization.unit}`,
      testId: "fc-exact-annualized",
    },
    {
      label: "명목 국고보조 추정액",
      value: formatBn(subsidy.estimated_national_subsidy_bn),
      testId: "fc-exact-subsidy",
    },
    {
      label: "단순 지방비 추정액",
      value: formatBn(subsidy.simplified_local_government_share_bn),
      testId: "fc-exact-local-share",
    },
  ];

  return (
    <div className="text-xs text-ink-muted">
      <p className="text-xs text-ink-subtle">
        위쪽 카드의 값은 읽기 쉽도록 반올림한 표시용 근삿값입니다. 아래는 서버가 계산한 값 그대로입니다.
      </p>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.testId}>
            <dt className="inline font-medium text-ink">{row.label}: </dt>
            <dd className="inline tabular-nums" data-testid={row.testId}>
              {row.value}
            </dd>
          </div>
        ))}
        <div>
          <dt className="inline font-medium text-ink">{per_capita.term_ko}: </dt>
          {per_capita.per_capita_local_share_won !== null ? (
            <dd className="inline tabular-nums" data-testid="fc-exact-per-capita">
              {formatWon(per_capita.per_capita_local_share_won)}
            </dd>
          ) : (
            // Unavailable stays unavailable here too — never a fabricated 0원.
            <dd className="inline text-warn" data-testid="fc-exact-per-capita-unavailable">
              계산 불가 — {perCapitaUnavailableExplanation(per_capita.unavailable_reason)}
            </dd>
          )}
        </div>
      </dl>

      <details className="mt-3" data-diagnostic="true" data-testid="facility-cost-diagnostics">
        <summary className="cursor-pointer text-xs text-ink-subtle">기술 정보 자세히 보기</summary>
        <ul className="mt-1 flex flex-col gap-0.5 break-words text-xs text-ink-subtle">
          <li>계산 방식 버전: {result.provenance.derivation_version}</li>
          <li>공사비 버전: {result.provenance.cost_version}</li>
          <li>연간 환산 방식: {annualization.method}</li>
          <li>집계 기준 코드: {official_input.accounting_basis}</li>
          <li>기준 연도: {official_input.reference_year}</li>
          <li>
            포함된 항목 코드: {result.completeness.included_components.join(", ") || "—"}
          </li>
          {per_capita.unavailable_reason && (
            <li>1인당 지방비 미제공 사유 코드: {per_capita.unavailable_reason}</li>
          )}
        </ul>
      </details>
    </div>
  );
}
