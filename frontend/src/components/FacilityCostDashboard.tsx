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
 * TWO VIEWS (desktop redesign Phase 3, unchanged by the civic-dashboard refresh):
 *   - `setup`   — the region picker, conditions, assumptions, primary action.
 *   - `results` — one hero answer, three secondary KPIs, then the report sections.
 * A successful calculation switches to `results`; a failure stays on `setup` with an
 * actionable error; "설정 바꾸기" returns to `setup` with every input intact and
 * issues no request. The results view is DERIVED (`resultCurrent`), so a stale
 * result — including a late response from superseded inputs — can never open or
 * survive on it.
 *
 * THIS FILE OWNS THE WORKFLOW STATE, and nothing else does: the loaded options, the
 * scenario, the captured advanced defaults, the result, the error, the in-flight
 * flag, the requested view, the input signature the output was computed for, and the
 * monotonic request id. Everything under `components/facilityCost/` is presentational
 * — it receives already-derived values and callbacks, holds no second form state, no
 * second result, and no copy of the cost formula.
 *
 * NUMBER CONTRACT. Primary surfaces show an APPROXIMATION produced by
 * `lib/displayNumber.ts` ("약 121억원"). The exact backend decimal string is never
 * changed and stays reachable in the "정밀값과 계산 기준" section, formatted only
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
  type FacilityCostCalculate,
  type FacilityCostOptions,
  type RegionBoundaryCollection,
} from "../lib/api";
import { approximatePercent } from "../lib/displayNumber";
import { regionDisplayName } from "../lib/regionDisplay";
import FacilityCostBreakdown from "./facilityCost/FacilityCostBreakdown";
import FacilityCostLimitations from "./facilityCost/FacilityCostLimitations";
import {
  FacilityCostAssumptions,
  FacilityCostEvidence,
  FacilityCostExactValues,
} from "./facilityCost/FacilityCostMethodology";
import FacilityCostNotice from "./facilityCost/FacilityCostNotice";
import {
  FacilityCostCandidateContext,
  FacilityCostRegionTable,
} from "./facilityCost/FacilityCostOfficialInputs";
import FacilityCostResultSummary from "./facilityCost/FacilityCostResultSummary";
import FacilityCostSetupPanel from "./facilityCost/FacilityCostSetupPanel";
import FacilityCostSetupSummary from "./facilityCost/FacilityCostSetupSummary";
import {
  excludedCostRows,
  HEADER_SUBTITLE,
  RESULT_FRAMING,
  RESULTS_NON_CLAIMS,
  summariseRegions,
  validateScenario,
  wasteStreamLabel,
  WASTE_STREAMS,
  type AdvancedDefaults,
  type ScenarioState,
} from "./facilityCost/shared";
import Accordion from "./ui/Accordion";
import DataStatusBadge from "./ui/DataStatusBadge";
import EmptyState from "./ui/EmptyState";
import InfoBanner from "./ui/InfoBanner";
import PageHeader from "./ui/PageHeader";
import SectionCard from "./ui/SectionCard";
import Skeleton from "./ui/Skeleton";

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
  /** Geometry for the 처리 대상 행정구역 selection map (spec §5). */
  regionBoundaries?: RegionBoundaryCollection | null;
  /**
   * The view's single `<h1>`, supplied by the page so it always equals the visible
   * navigation destination name (docs/YEOGIDA_UI_REDESIGN_SPEC.md §2.2). Previously
   * the literal "시설 비용 살펴보기"; that scope wording survives in
   * `HEADER_SUBTITLE` under the title.
   */
  title: string;
  /**
   * The destination's one-line orientation strip, rendered directly below the
   * `<h1>` — the same position it occupies in the other areas, and what keeps
   * `shell.test.tsx`'s "orientation follows the heading" check true here.
   */
  orientation?: React.ReactNode;
}

export default function FacilityCostDashboard({
  wasteRegions,
  selectedCandidate,
  regionBoundaries,
  title,
  orientation,
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
        // Defaults are unchanged from the previous implementation — the refresh
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
      {/* The header shares the content column with the cards below it, so the title
          and the first card start on the same vertical line at every width. */}
      <div className="mx-auto w-full max-w-6xl">
        <PageHeader title={title} description={HEADER_SUBTITLE} testId="facility-cost-header">
          {orientation}
        </PageHeader>
      </div>

      {optionsError ? (
        // A genuine, actionable failure — the one place role="alert" is warranted
        // for the setup screen.
        <div className="mx-auto mt-4 w-full max-w-6xl">
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
        <div className="mx-auto mt-4 w-full max-w-6xl">
          <p className="text-sm text-ink-muted" data-testid="facility-cost-loading" role="status">
            비용 옵션을 불러오는 중…
          </p>
          <Skeleton lines={3} className="mt-3" />
        </div>
      ) : (
        <FacilityCostBody
          options={options}
          scenario={scenario}
          advancedDefaults={advancedDefaults}
          regionOptions={regionOptions}
          regionBoundaries={regionBoundaries}
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
  regionBoundaries,
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
  regionBoundaries?: RegionBoundaryCollection | null;
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
        regionBoundaries={regionBoundaries}
        update={update}
        onCalculate={calculate}
        calculating={calculating}
        validationMessage={validationMessage}
        headingRef={setupHeadingRef}
        hasPreviousResult={result !== null}
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

      {/* No result yet: an explicit instruction, never a placeholder number. A
          missing result is not a zero, and no example cost is shown in its place. */}
      {!calculating && !errorCurrent && result === null && (
        <div className="mx-auto w-full max-w-6xl">
          <EmptyState
            title="아직 계산한 결과가 없습니다."
            description="지역을 선택하고 “비용 계산하기”를 누르면 결과가 여기에 표시됩니다. 결과가 없다는 것은 비용이 0이라는 뜻이 아니며, 예시 금액이나 임의의 값을 대신 보여주지 않습니다."
            testId="facility-cost-no-result"
          />
        </div>
      )}

      {/* THE SCOPE NOTICE, LAST — moved here by the post-production visual review
          (docs/YEOGIDA_AUTONOMOUS_RUN.md, "UI correction pass").

          It used to open the screen, so 후보지 분석 began with two blocks of caveat
          before the reader met a single control. Nothing about it is weakened by
          the move: the banner keeps every sentence, the eight-item disclosure keeps
          all eight strings, its two groupings, its count, and its test ids, and it
          is still on the page in full at the end of the workflow it qualifies. Only
          its position changed. It also remains OUTSIDE any results view, so the
          numbers screen keeps its own notice rather than borrowing this one.

          A side benefit worth keeping: this is also the position that best serves
          the first-screen contract (docs/ui-refresh/regression-contract.md §16) —
          the setup grid, and with it the sticky action rail, now starts at the very
          top of the workspace at every viewport height. */}
      <div className="mx-auto w-full max-w-6xl" data-testid="facility-cost-scope-notice">
        <FacilityCostNotice />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Setup view
// --------------------------------------------------------------------------- //

/**
 * The setup workflow: a constrained centred container holding a two-column grid —
 * the standing scope notice and the three setup steps on the left, and a compact
 * summary on the right that sticks while the left column scrolls, so the primary
 * action is reachable without scrolling to the bottom of a long form. Below `lg` the
 * columns stack and the summary returns to normal document flow.
 *
 * WHERE THE SCOPE NOTICE IS, AND WHY IT IS NOT HERE.
 * It once sat full-width ABOVE this grid, which made it part of the sticky rail's
 * STATIC position: at 1024×768 the banner plus its exclusion disclosure spent 250px
 * before the grid even began, so the rail started at y=464 and its 415px-tall card
 * ended at y=879 — 111px below the fold, with 비용 계산하기 clipped at 838. Sticky
 * positioning cannot rescue that: `position: sticky` only ever pulls an element
 * DOWN-page toward `top`, never above its static position, so the rail was of no
 * help until the citizen had already scrolled — which is exactly the state the
 * first-screen contract is about (docs/ui-refresh/regression-contract.md §16).
 *
 * The final-integration milestone moved it into this column's top; the post-
 * production visual review moved it further, to the END of the setup view
 * (`FacilityCostBody`), so the workflow — not a caveat — opens the screen. Both
 * moves keep the grid, and so the rail, starting at the top of the workspace. The
 * notice's content, wording, grouping, count, and test ids are unchanged throughout;
 * only its position ever moved.
 */
function FacilityCostSetup({
  options,
  scenario,
  advancedDefaults,
  regionOptions,
  regionBoundaries,
  update,
  onCalculate,
  calculating,
  validationMessage,
  headingRef,
  hasPreviousResult,
}: {
  options: FacilityCostOptions;
  scenario: ScenarioState;
  advancedDefaults: AdvancedDefaults;
  regionOptions: { code: string; name: string }[];
  regionBoundaries?: RegionBoundaryCollection | null;
  update: <K extends keyof ScenarioState>(key: K, value: ScenarioState[K]) => void;
  onCalculate: () => void;
  calculating: boolean;
  validationMessage: string | null;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  hasPreviousResult: boolean;
}) {
  const noRegions = scenario.regionCodes.length === 0;
  const noFacilityTypes = options.facility_types.length === 0;
  const disabled = noRegions || noFacilityTypes || calculating || validationMessage !== null;

  // Why the primary action is unavailable, in plain Korean. This is ordinary
  // guidance rather than an error, so it goes to a POLITE status region — the
  // numeric out-of-range message keeps role="alert", because an input the user has
  // actually put out of bounds is a genuine actionable error.
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* The workflow column. It carries its own `flex flex-col gap-3`, so the
            wrapper the scope notice used to share with it is gone rather than left
            behind as a single-child div. */}
        <FacilityCostSetupPanel
          options={options}
          scenario={scenario}
          regionOptions={regionOptions}
          regionBoundaries={regionBoundaries}
          update={update}
          validationMessage={validationMessage}
          headingRef={headingRef}
        />

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
          hasPreviousResult={hasPreviousResult}
        />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Results view
// --------------------------------------------------------------------------- //

/**
 * "선택한 3개 지역 · 서울 종로구 · 생활계 폐기물 · 처리 비율 100% · 자동선별 재활용시설"
 *
 * Built from the regions the backend actually calculated with, named through
 * `regionDisplayName` so 서울 중구 and 인천 중구 stay distinguishable WITHOUT a raw
 * region code reaching the screen.
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

/**
 * The calculated answer, in one deliberate order: result actions → heading and
 * scenario context → standing disclaimer → the partial-result statement when the
 * response marks itself partial → 핵심 결과 → 비용 구성 → 빠진 항목과 주의사항 →
 * 분석에 사용한 공식 자료 → 계산 기준·출처·버전.
 *
 * WHAT THE REFRESH CHANGED
 *   - The seven collapsed disclosures were a flat, visually identical stack, so a
 *     mandatory caveat had exactly the weight of a diagnostic. They are now grouped
 *     into four titled sections, each stating what it holds.
 *   - 비용 구성 (the funding composition) was one of those disclosures. It is the
 *     only decomposition of the headline cost on the screen, so it is now VISIBLE
 *     content rather than something to be discovered. Its amounts, order, test ids,
 *     and caveats are unchanged.
 *   - `completeness.is_partial` was served and never shown. A partial result now
 *     says so, in plain Korean, above the numbers it qualifies — as a standing
 *     notice, never `role="alert"`.
 *
 * Only the headline KPI block is a live region: it holds the answer worth
 * announcing, and keeping the disclosures outside it means a collapsed `<details>`
 * is never the only home for a `role="status"` (Accordion.tsx's consumer contract).
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
  const includedCount = result.completeness.included_components.length;

  return (
    <div className="mx-auto w-full max-w-6xl" data-testid="facility-cost-results-view">
      {/* The result actions. Only real actions live here — the cost view has no
          export, report, or share action to preserve, and no decorative button was
          added to fill the row. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="facility-cost-result-actions">
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
      </div>

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

      {/* The served completeness flag, stated rather than left in the response. Also
          standing content, so it carries no alert role. */}
      {result.completeness.is_partial && (
        <div className="mt-3">
          <InfoBanner tone="warning" title="부분 계산 결과" testId="facility-cost-partial">
            <p>
              이 결과에는 일부 비용 항목이 포함되지 않았습니다. 계산에 포함된 비용 항목은{" "}
              {includedCount}개이고, 포함되지 않은 항목은 {excluded.length}개입니다. 포함되지 않은
              항목은 자료가 없어 계산하지 못한 것이며, 그 비용이 0이라는 뜻이 아닙니다.
            </p>
          </InfoBanner>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3" data-testid="facility-cost-result-sections">
        <SectionCard
          title="핵심 결과"
          description={RESULT_FRAMING}
          headerAside={<DataStatusBadge status="derived" />}
        >
          <div className="flex flex-col gap-4" role="status" data-testid="facility-cost-results">
            <FacilityCostResultSummary result={result} />
          </div>
        </SectionCard>

        <SectionCard
          title="비용 구성"
          description="설치비 산정액이 어떤 항목으로 나뉘는지 보여 줍니다."
          headerAside={<DataStatusBadge status="derived" />}
        >
          <FacilityCostBreakdown result={result} />
        </SectionCard>

        <SectionCard
          title="빠진 항목과 주의사항"
          description="이 계산이 다루지 않은 비용입니다. 결과를 읽기 전에 함께 보아야 합니다."
        >
          <p className="text-sm text-ink-muted">
            계산에 포함된 비용 항목은 {includedCount}개, 포함되지 않은 항목은 {excluded.length}개입니다.
            포함되지 않은 항목은 자료가 없어 계산하지 못한 것이며, 그 비용이 0이라는 뜻이 아닙니다.
          </p>
          <div className="mt-3">
            <Accordion
              label={`포함되지 않은 비용 ${excluded.length}개`}
              testId="facility-cost-exclusions"
            >
              <FacilityCostLimitations rows={excluded} />
            </Accordion>
          </div>
        </SectionCard>

        <SectionCard
          title="분석에 사용한 공식 자료"
          description="계산의 출발점이 된 공식 발생량과 인구, 그리고 함께 본 후보지입니다."
          headerAside={<DataStatusBadge status="reported" />}
        >
          <div className="flex flex-col gap-3">
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
          </div>
        </SectionCard>

        <SectionCard
          title="계산 기준·출처·버전"
          description="어떤 가정으로, 어떤 공식 자료를 근거로, 어떤 기준 시점에 계산했는지입니다."
        >
          <div className="flex flex-col gap-3">
            <Accordion label="계산 가정" testId="facility-cost-assumptions">
              <FacilityCostAssumptions result={result} />
            </Accordion>

            <Accordion label="출처와 계산 방법" testId="facility-cost-methodology-section">
              <FacilityCostEvidence result={result} />
            </Accordion>

            <Accordion label="정밀값과 계산 기준" testId="facility-cost-exact-values">
              <FacilityCostExactValues result={result} />
            </Accordion>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
