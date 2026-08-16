"use client";

/**
 * 시설 비용 살펴보기 — the facility-cost workflow, aligned to Figma frame 129:5709.
 *
 * ── LAYOUT ───────────────────────────────────────────────────────────────────────
 * Three columns on one screen ("레이아웃 3줄로 배치", note 221:3443):
 *
 *   ① 비용 계산 희망 지역 선택 │ ③ 비용 계산 결과 │ 선택 지도
 *   ② 계산 조건               │                 │
 *
 * The previous setup ⇄ results VIEW SWITCH is gone: Figma places the five result
 * figures inside card ③, directly under the button that produces them, so there is
 * no screen to leave in order to change an input and no 설정 바꾸기 return trip. The
 * guarantee that switch existed to provide is unchanged and still enforced here —
 * a result is displayed only while `resultCurrent` holds, i.e. while it still
 * matches the live inputs (scenario + selected candidate). Change any control and
 * the figures are replaced by "다시 계산하세요", never left standing beside inputs
 * they were not computed from. A late response from superseded inputs is discarded
 * by the monotonic request id, exactly as before.
 *
 * ── WHAT DID NOT CHANGE ──────────────────────────────────────────────────────────
 * The cost model. Not one formula, bound, unit, rounding rule, default, or payload
 * field was touched: this file still sends the served scenario to
 * `/api/v1/facility-cost/calculate` and renders the response's own strings. The
 * multi-region selection — search, 서울/인천/경기 bulk merge, chips, clear, map sync —
 * is the same `SearchableRegionPicker` and the same state it always was.
 *
 * ── THIS FILE OWNS THE WORKFLOW STATE, and nothing else does ─────────────────────
 * the loaded options, the scenario, the captured advanced defaults, the result, the
 * error, the in-flight flag, the input signature the output was computed for, the
 * monotonic request id, the no-data map feedback, and whether the detail surface is
 * open. Everything under `components/facilityCost/` is presentational — it receives
 * already-derived values and callbacks, holds no second form state, no second
 * result, and no copy of the cost formula.
 *
 * ── NUMBER CONTRACT ──────────────────────────────────────────────────────────────
 * Primary surfaces show an APPROXIMATION produced by `lib/displayNumber.ts`
 * ("약 121억원"). The exact backend decimal string is never changed and stays
 * reachable in 정밀값과 계산 기준 inside 계산 방법과 한계. An unavailable component is
 * rendered as explicitly unavailable — never as 0.
 *
 * ── REASON CODES ─────────────────────────────────────────────────────────────────
 * Backend codes (`OFFICIAL_SOURCE_NOT_INTEGRATED`, …) are mapped to plain Korean via
 * lib/glossary.ts. They are not deleted: every raw code stays in the API response
 * and in a `data-diagnostic` disclosure.
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
import { regionDisplayName } from "../lib/regionDisplay";
import FacilityCostConditionsCard from "./facilityCost/FacilityCostConditionsCard";
import FacilityCostDetails from "./facilityCost/FacilityCostDetails";
import FacilityCostMapPanel from "./facilityCost/FacilityCostMapPanel";
import FacilityCostRegionCard from "./facilityCost/FacilityCostRegionCard";
import FacilityCostResultCard from "./facilityCost/FacilityCostResultCard";
import {
  advancedChanged,
  validateScenario,
  wasteStreamLabel,
  WASTE_STREAMS,
  type AdvancedDefaults,
  type ScenarioState,
} from "./facilityCost/shared";
import InfoBanner from "./ui/InfoBanner";
import PageHeader from "./ui/PageHeader";
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
   * navigation destination name (docs/YEOGIDA_UI_REDESIGN_SPEC.md §2.2). The scope
   * wording "시설 비용 살펴보기" survives in `HEADER_SUBTITLE` under the title.
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
  // The input signature the current result/error was computed for. The result is
  // shown ONLY while it still matches the live inputs (scenario + selected
  // candidate), so a stale result never sits beside changed controls.
  const [outputSig, setOutputSig] = useState<string | null>(null);
  // The 계산 방법과 한계 surface. Reachable before a calculation too — its scope and
  // coverage sections do not need a result.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The answer to a click on a region the current stream cannot be calculated for.
  const [unavailableNotice, setUnavailableNotice] = useState("");
  // Monotonic request id: a superseded in-flight response is discarded, so a late
  // response from an old scenario can never overwrite a newer one.
  const requestSeq = useRef(0);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);

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
        // Defaults are unchanged — the redesign moves these controls, it does not
        // re-seed them.
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

  /**
   * The calculable region codes per waste stream, from the one served coverage
   * list. Built once here so a stream change can be answered from state the
   * screen already holds — it introduces no second source of truth, because it
   * is derived from the same `wasteRegions` prop `regionOptions` reads.
   */
  const codesByStream = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const region of wasteRegions) {
      let set = map.get(region.stream);
      if (!set) {
        set = new Set<string>();
        map.set(region.stream, set);
      }
      set.add(region.code);
    }
    return map;
  }, [wasteRegions]);

  // How many regions the last stream change had to drop, and their names, so the
  // screen can say so compactly instead of silently shrinking the selection.
  const [droppedRegions, setDroppedRegions] = useState<string[]>([]);

  const update = useCallback(
    <K extends keyof ScenarioState>(key: K, value: ScenarioState[K]) => {
      // Any input change invalidates the standing no-data message, which named a
      // region under the PREVIOUS stream.
      setUnavailableNotice("");
      if (key !== "wasteStream") {
        // Facility type, processing share, and every advanced value are scored
        // over WHATEVER regions are selected — none of them changes which regions
        // have official data, so none of them may touch the selection.
        setDroppedRegions([]);
        setScenario((prev) => (prev ? { ...prev, [key]: value } : prev));
        return;
      }
      // A stream change DOES change which regions are calculable, but most of a
      // selection normally survives it. Keep every code the new stream can still
      // calculate and drop only the ones it genuinely cannot — the old behaviour
      // cleared the whole selection, which threw away work the data supported.
      const nextStream = value as string;
      const calculable = codesByStream.get(nextStream) ?? new Set<string>();
      setScenario((prev) => {
        if (!prev) return prev;
        const kept = prev.regionCodes.filter((code) => calculable.has(code));
        const dropped = prev.regionCodes.filter((code) => !calculable.has(code));
        setDroppedRegions(
          dropped.map((code) => {
            const region = wasteRegions.find((r) => r.code === code);
            return regionDisplayName(code, region?.name ?? code);
          }),
        );
        return { ...prev, wasteStream: nextStream, regionCodes: kept };
      });
    },
    [codesByStream, wasteRegions],
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

  const selectableCodes = useMemo(() => regionOptions.map((r) => r.code), [regionOptions]);

  /**
   * Regions that exist on the map but have NO official waste statistics for the
   * current stream. Derived from the two sets the screen already holds — it is a
   * statement about coverage, not an invented dataset, and nothing is filled in for
   * them anywhere.
   */
  const unavailableRegions = useMemo(() => {
    if (!regionBoundaries) return [];
    const calculable = new Set(selectableCodes);
    const seen = new Set<string>();
    return regionBoundaries.features
      .map((f) => f.properties)
      .filter((p) => !calculable.has(p.region_code) && !seen.has(p.region_code) && seen.add(p.region_code))
      .map((p) => ({
        code: p.region_code,
        label: regionDisplayName(p.region_code, p.region_name),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ko"));
  }, [regionBoundaries, selectableCodes]);

  const streamLabel = wasteStreamLabel(scenario?.wasteStream ?? "");

  /** A click on a region the cost model cannot calculate — answered, never ignored. */
  const reportUnavailableRegion = useCallback(
    (regionName: string, regionCode: string) => {
      setUnavailableNotice(
        `${regionDisplayName(regionCode, regionName)}은(는) ${streamLabel} 공식 자료가 없어 선택할 수 없습니다. ` +
          "발생량이 0이라는 뜻이 아닙니다.",
      );
    },
    [streamLabel],
  );

  const toggleRegion = useCallback(
    (code: string) => {
      setUnavailableNotice("");
      // The citizen has acted on the selection themselves; the note about what a
      // previous stream change dropped has been read and is no longer news.
      setDroppedRegions([]);
      setScenario((prev) =>
        prev
          ? {
              ...prev,
              regionCodes: prev.regionCodes.includes(code)
                ? prev.regionCodes.filter((c) => c !== code)
                : [...prev.regionCodes, code],
            }
          : prev,
      );
    },
    [],
  );

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
      // Figma 129:5709 body: 1400 content width inside a 20 outer inset (1440
      // desktop). 1400 = 360 (①②) + 16 + 340 (③) + 16 + 668 (map), which is
      // exactly the column template below, so the map lands on its drawn width
      // at the target viewport and absorbs the slack on wider ones.
      className="mx-auto w-full max-w-[calc(87.5rem+2.5rem)] px-4 pb-6 sm:px-5"
      data-testid="facility-cost-dashboard"
    >
      {/* No `description`: the destination's own orientation strip below already
          says what this screen does ("공식 표준공사비로 설치비를 추정합니다.",
          lib/glossary.ts). Carrying a second, near-identical sentence under the
          same <h1> cost a line of the fold and told a reader nothing new. */}
      <PageHeader title={title} testId="facility-cost-header">
        {orientation}
      </PageHeader>

      {optionsError ? (
        // A genuine, actionable failure — the one place role="alert" is warranted.
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
        <div className="mt-4">
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
          selectableCodes={selectableCodes}
          unavailableRegions={unavailableRegions}
          streamLabel={streamLabel}
          regionBoundaries={regionBoundaries}
          update={update}
          onToggleRegion={toggleRegion}
          calculate={calculate}
          calculating={calculating}
          result={result}
          resultCurrent={resultCurrent}
          errorCurrent={errorCurrent}
          calcError={calcError}
          selectedCandidate={selectedCandidate}
          stepHeadingRef={stepHeadingRef}
          detailsOpen={detailsOpen}
          setDetailsOpen={setDetailsOpen}
          unavailableNotice={unavailableNotice}
          onUnavailableRegion={reportUnavailableRegion}
          droppedRegions={droppedRegions}
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
  selectableCodes,
  unavailableRegions,
  streamLabel,
  regionBoundaries,
  update,
  onToggleRegion,
  calculate,
  calculating,
  result,
  resultCurrent,
  errorCurrent,
  calcError,
  selectedCandidate,
  stepHeadingRef,
  detailsOpen,
  setDetailsOpen,
  unavailableNotice,
  onUnavailableRegion,
  droppedRegions,
}: {
  options: FacilityCostOptions;
  scenario: ScenarioState;
  advancedDefaults: AdvancedDefaults;
  regionOptions: { code: string; name: string }[];
  selectableCodes: string[];
  unavailableRegions: { code: string; label: string }[];
  streamLabel: string;
  regionBoundaries?: RegionBoundaryCollection | null;
  update: <K extends keyof ScenarioState>(key: K, value: ScenarioState[K]) => void;
  onToggleRegion: (code: string) => void;
  calculate: () => void;
  calculating: boolean;
  result: FacilityCostCalculate | null;
  resultCurrent: boolean;
  errorCurrent: boolean;
  calcError: string | null;
  selectedCandidate: CandidateDetail | null;
  stepHeadingRef: React.RefObject<HTMLHeadingElement | null>;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  unavailableNotice: string;
  onUnavailableRegion: (regionName: string, regionCode: string) => void;
  /** Regions the last waste-stream change had to drop, already named. */
  droppedRegions: string[];
}) {
  const validationMessage = validateScenario(scenario, options);
  const noRegions = scenario.regionCodes.length === 0;
  const noFacilityTypes = options.facility_types.length === 0;
  const disabled = noRegions || noFacilityTypes || calculating || validationMessage !== null;

  // Why the primary action is unavailable, in plain Korean. This is ordinary
  // guidance rather than an error, so it goes to a POLITE status region — the
  // numeric out-of-range message keeps role="alert" beside its own field, because
  // an input the user has actually put out of bounds is a genuine actionable error.
  //
  // There is no branch for `validationMessage !== null`. The card's status line
  // renders `validationMessage ?? blockedReason`, so the specific message — which
  // names the field AND its bound ("지역 처리 비율은 0–100(%) 사이여야 합니다.") — is
  // what a reader sees in that state. The generic pointer that used to sit here
  // ("고급 설정에 입력한 값을 확인해 주세요.") was already unreachable behind it, and
  // said less. The real validation error itself is untouched, in both of its homes:
  // beside its own field as an alert, and repeated here beside the button.
  const blockedReason = noFacilityTypes
    ? "시설 종류를 불러오지 못해 계산할 수 없습니다."
    : noRegions
      ? "처리할 지역을 한 곳 이상 선택하면 계산할 수 있습니다."
      : calculating
        ? "계산 중입니다."
        : "";

  return (
    <>
      {/* The three columns of Figma 129:5709. They stack below `lg`, where the map
          follows the workflow it belongs to rather than preceding it. */}
      <div
        className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[22.5rem_21.25rem_minmax(0,1fr)]"
        data-testid="facility-cost-workflow"
      >
        <div className="flex flex-col gap-4">
          <FacilityCostRegionCard
            regionOptions={regionOptions}
            unavailableRegions={unavailableRegions}
            selectedCodes={scenario.regionCodes}
            onChangeRegions={(codes) => update("regionCodes", codes)}
            wasteStreamLabel={streamLabel}
            headingRef={stepHeadingRef}
            droppedRegions={droppedRegions}
          />
          <FacilityCostConditionsCard
            options={options}
            scenario={scenario}
            update={update}
            validationMessage={validationMessage}
            advancedChanged={advancedChanged(scenario, advancedDefaults)}
          />
        </div>

        <div className="flex flex-col gap-4">
          <FacilityCostResultCard
            options={options}
            scenario={scenario}
            regionOptions={regionOptions}
            advancedChanged={advancedChanged(scenario, advancedDefaults)}
            onCalculate={calculate}
            calculating={calculating}
            disabled={disabled}
            blockedReason={blockedReason}
            validationMessage={validationMessage}
            result={result}
            resultCurrent={resultCurrent}
            errorCurrent={errorCurrent}
            calcError={calcError}
            onOpenDetails={() => setDetailsOpen(true)}
          />
        </div>

        {/* Without a boundary payload the picker alone is shown — the accessible
            path anyway — so a missing geometry degrades to "no map", not to a
            broken screen. The same applies when the chosen stream has no
            calculable region at all: card ① already says so in words, and a map on
            which every region is inert would only repeat that less clearly. */}
        {regionBoundaries && regionOptions.length > 0 && (
          <FacilityCostMapPanel
            boundaries={regionBoundaries}
            selectedCodes={scenario.regionCodes}
            selectableCodes={selectableCodes}
            onToggleRegion={onToggleRegion}
            wasteStreamLabel={streamLabel}
            unavailableNotice={unavailableNotice}
            onUnavailableRegion={onUnavailableRegion}
          />
        )}
      </div>

      <FacilityCostDetails
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        result={result}
        resultCurrent={resultCurrent}
        selectedCandidate={selectedCandidate}
        wasteStreamLabel={streamLabel}
        unavailableRegions={unavailableRegions}
        calculableRegionCount={regionOptions.length}
      />
    </>
  );
}
