"use client";

/**
 * 가중치 바꿔보기 (user-weight scenario lab) — Phase 6.
 *
 * A TEMPORARY decision-support experiment: the user edits the four Z/R/E/D weights
 * and the backend recombines ONE fixed run's frozen component scores on read. This
 * component owns the editor workflow (draft ⟶ applied ⟶ result), presets,
 * deterministic normalization, comparison selection, and the results/detail panels;
 * it lifts the *applied* scenario up to the page so the single MapView can render
 * the custom tiles and coordinate the selected candidate.
 *
 * It is never presented as an official run, saved profile, CRITIC replacement, or a
 * legal/permitting/final-siting result. Slider edits never fire an API request —
 * only the explicit "시나리오 적용" does.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  previewUserWeightScenario,
  type SuitabilityProfile,
  type SuitabilityRun,
  type UserScenarioCandidateDetail,
  type UserScenarioPreview,
  type UserScenarioWeights,
} from "../lib/api";
import { statusLabel } from "../lib/glossary";
import {
  SCENARIO_COMPONENTS,
  SCENARIO_COMPONENT_META,
  SCENARIO_PRESET_LABELS,
  decimalWeightsToPercents,
  draftTotal,
  isDraftValid,
  loadScenarioSession,
  normalizePercents,
  percentsToCanonical,
  rankMovementText,
  saveScenarioSession,
  scenarioPresets,
  totalDifference,
  type ScenarioComponent,
  type ScenarioPercents,
} from "../lib/scenario";
import { stabilityBadgeLabel } from "../lib/suitability";

/** The applied scenario the page needs to build the custom tile URL + detail fetches. */
export interface AppliedScenario {
  runId: number;
  weights: UserScenarioWeights;
  scenarioHash: string;
  compareProfile: SuitabilityProfile;
}

const PROFILE_LABEL: Record<string, string> = {
  ...SCENARIO_PRESET_LABELS,
};

const STALE_MESSAGE = "현재 결과는 마지막으로 적용한 가중치 기준입니다.";

interface Props {
  run: SuitabilityRun;
  runProfiles: SuitabilityProfile[];
  /** Lifts the applied scenario (or null on reset) to the page for MapView. */
  onApplied: (applied: AppliedScenario | null) => void;
  /** The scenario candidate detail the page fetched (map click or list click). */
  scenarioSelected: UserScenarioCandidateDetail | null;
  /** Ask the page to fetch a candidate's scenario detail + move/highlight the map. */
  onSelectCandidate: (candidateId: number) => void;
  onClearSelected: () => void;
  /**
   * A scenario restored from a shared URL. When present it takes precedence over
   * the sessionStorage draft and is AUTO-APPLIED once on mount — the apply goes
   * through the normal preview API path, so the restored weights are re-validated
   * by the server before anything is shown (never trusted from the URL alone).
   */
  initialScenario?: { percents: ScenarioPercents; compareProfile: SuitabilityProfile } | null;
}

const DEFAULT_PERCENTS: ScenarioPercents = { zoning: 35, road: 25, equity: 25, demand: 15 };

export default function SuitabilityScenarioLab({
  run,
  runProfiles,
  onApplied,
  scenarioSelected,
  onSelectCandidate,
  onClearSelected,
  initialScenario,
}: Props) {
  const presets = useMemo(() => scenarioPresets(run), [run]);
  const [draft, setDraft] = useState<ScenarioPercents>(
    () => presets.find((p) => p.key === "baseline")?.percents ?? DEFAULT_PERCENTS,
  );
  const [applied, setApplied] = useState<ScenarioPercents | null>(null);
  const [result, setResult] = useState<UserScenarioPreview | null>(null);
  const [compareProfile, setCompareProfile] = useState<SuitabilityProfile>("baseline");
  const [loading, setLoading] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [normalizeNote, setNormalizeNote] = useState<string | null>(null);

  // Sequence guard + abort so an older preview response can never replace a newer
  // one, and a rapid re-apply cancels the in-flight request.
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const restoredRef = useRef(false);

  const total = draftTotal(draft);
  const valid = isDraftValid(draft);
  const diff = totalDifference(draft);
  // A result is stale once the draft diverges from what produced it.
  const stale =
    result !== null && applied !== null && SCENARIO_COMPONENTS.some((c) => draft[c] !== applied[c]);

  // --- session restore (once, for the current run) --------------------------
  // Post-mount (not a lazy useState initializer) so server and first client render
  // agree — sessionStorage is client-only, so restoring during render would risk a
  // hydration mismatch. A restored draft is NEVER shown as a current result; the
  // user must re-apply, which re-issues a fresh preview request.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydrate from URL/session */
    // A shared-URL scenario wins over the local sessionStorage draft: it seeds the
    // editor with the shared weights (the page keeps them in the address bar so the
    // link is not self-stripped). The result is NOT shown until the user presses
    // 시나리오 적용, which re-validates the weights through the preview API — the
    // same "a restored draft is never shown as a current result" discipline used
    // for the sessionStorage draft (and it stays robust under React StrictMode's
    // effect double-invocation, which would otherwise abort an in-effect fetch).
    if (initialScenario) {
      setDraft(initialScenario.percents);
      setCompareProfile(initialScenario.compareProfile);
      return;
    }
    const restored = loadScenarioSession(run.id, runProfiles);
    if (!restored) return;
    setDraft(restored.draftPercents);
    setCompareProfile(restored.compareProfile);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  // --- persist session state ------------------------------------------------
  useEffect(() => {
    saveScenarioSession({
      schemaVersion: 1,
      runId: run.id,
      draftPercents: draft,
      appliedPercents: applied,
      compareProfile,
      scenarioHash: result?.scenario_hash ?? null,
      selectedCandidateId: scenarioSelected?.candidate_id ?? null,
    });
  }, [run.id, draft, applied, compareProfile, result, scenarioSelected]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function setComponent(component: ScenarioComponent, value: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
    setDraft((prev) => ({ ...prev, [component]: clamped }));
    setNormalizeNote(null);
  }

  function loadPreset(percents: ScenarioPercents): void {
    setDraft(percents);
    setNormalizeNote(null);
  }

  function doNormalize(): void {
    const next = normalizePercents(draft);
    if (next === null) {
      setNormalizeNote("모든 값이 0이면 정규화할 수 없습니다. 값을 입력해 주세요.");
      return;
    }
    setDraft(next.percents);
    setNormalizeNote(
      next.changed
        ? "합계 100%가 되도록 값을 조정했습니다."
        : "값이 이미 100%였습니다.",
    );
  }

  function resetToStoredProfile(): void {
    const profile = run.weight_profiles?.[compareProfile];
    if (profile) loadPreset(decimalWeightsToPercents(profile));
  }

  function revertToApplied(): void {
    if (applied) {
      setDraft(applied);
      setNormalizeNote(null);
    }
  }

  async function runPreview(
    weightsPercents: ScenarioPercents,
    profile: SuitabilityProfile,
  ): Promise<void> {
    if (!isDraftValid(weightsPercents)) return;
    const canonical = percentsToCanonical(weightsPercents);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++seqRef.current;
    setLoading(true);
    setErrorDetail(null);
    try {
      const preview = await previewUserWeightScenario(
        {
          run_id: run.id,
          weights: canonical,
          compare_profile: profile,
          top_n: 10,
          selected_candidate_id: scenarioSelected?.candidate_id ?? null,
        },
        controller.signal,
      );
      if (seq !== seqRef.current) return; // a newer request superseded this one
      setResult(preview);
      setApplied(weightsPercents);
      onApplied({
        runId: run.id,
        weights: preview.canonical_weights,
        scenarioHash: preview.scenario_hash,
        compareProfile: profile,
      });
    } catch (err) {
      if (controller.signal.aborted || seq !== seqRef.current) return;
      if (err instanceof ApiError && err.detail) {
        const fields = err.detail.fields;
        const suffix =
          fields && typeof fields.sum === "string" ? ` (합계 ${fields.sum})` : "";
        setErrorDetail(`${err.detail.detail}${suffix}`);
      } else {
        setErrorDetail("시나리오를 계산하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }

  function applyScenario(): void {
    void runPreview(draft, compareProfile);
  }

  function changeCompareProfile(profile: SuitabilityProfile): void {
    setCompareProfile(profile);
    // Re-preview only when a scenario is already applied. The scenario hash does
    // not depend on the comparison profile, so the map source (tile URL) is unchanged.
    if (applied) void runPreview(applied, profile);
  }

  const appliedWeights = result?.canonical_weights ?? null;

  // Phase 7: the accessible name now matches the visible sub-view tab
  // (가중치 바꿔보기). It previously read 가중치 실험실, the pre-Phase-1 name, so a
  // screen-reader user heard a region name that no visible control used.
  return (
    <section aria-label="가중치 바꿔보기" data-testid="scenario-lab" className="flex flex-col gap-4">
      <ScenarioWarning />

      <ScenarioPresetButtons presets={presets} onLoad={loadPreset} />

      <ScenarioWeightEditor draft={draft} onChange={setComponent} />

      <ScenarioValidation total={total} diff={diff} valid={valid} normalizeNote={normalizeNote} />

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={doNormalize}
          data-testid="scenario-normalize"
          className="min-h-[38px] rounded bg-slate-100 px-3 py-1 text-sm text-slate-700 md:min-h-0"
        >
          100%로 비율 정규화
        </button>
        <button
          type="button"
          onClick={resetToStoredProfile}
          data-testid="scenario-reset-stored"
          className="min-h-[38px] rounded bg-slate-100 px-3 py-1 text-sm text-slate-700 md:min-h-0"
        >
          현재 저장 프로파일과 동일하게 재설정
        </button>
        <button
          type="button"
          onClick={revertToApplied}
          disabled={!applied}
          data-testid="scenario-revert-applied"
          className="min-h-[38px] rounded bg-slate-100 px-3 py-1 text-sm text-slate-700 disabled:opacity-40 md:min-h-0"
        >
          마지막 적용값으로 되돌리기
        </button>
      </div>

      <ScenarioComparisonSelector
        value={compareProfile}
        options={runProfiles}
        onChange={changeCompareProfile}
      />

      <ScenarioApplyControls valid={valid} loading={loading} onApply={applyScenario} />

      {errorDetail && (
        <p
          role="alert"
          data-testid="scenario-error"
          className="rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800"
        >
          {errorDetail}
        </p>
      )}

      {loading && (
        <p role="status" data-testid="scenario-loading" className="text-xs text-slate-500">
          시나리오 계산 중…
        </p>
      )}

      {stale && (
        <p
          role="status"
          data-testid="scenario-stale-notice"
          className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800"
        >
          {STALE_MESSAGE} 새 가중치를 반영하려면 다시 「시나리오 적용」을 눌러 주세요.
        </p>
      )}

      {!result && !loading && (
        <p
          role="status"
          data-testid="scenario-no-applied"
          className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600"
        >
          아직 사용자 시나리오가 적용되지 않았습니다. 지도는 저장된 후보 상태를 표시합니다.
          가중치를 조정한 뒤 「시나리오 적용」을 누르면 사용자 가정 기반 점수가 지도에 반영됩니다.
        </p>
      )}

      {result && (
        <>
          <ScenarioSummary result={result} appliedWeights={appliedWeights} stale={stale} />
          <ScenarioTopCandidates
            result={result}
            selectedId={scenarioSelected?.candidate_id ?? null}
            onSelect={onSelectCandidate}
          />
        </>
      )}

      {scenarioSelected && (
        <ScenarioCandidateDetail detail={scenarioSelected} onClear={onClearSelected} />
      )}

      <ScenarioMethodology />
    </section>
  );
}

// --------------------------------------------------------------------------- //
// Sub-components
// --------------------------------------------------------------------------- //

function ScenarioWarning() {
  return (
    <div
      role="note"
      data-testid="scenario-warning"
      className="rounded border border-indigo-300 bg-indigo-50 p-3 text-xs text-indigo-900"
    >
      <p className="font-semibold">사용자 가정 기반 시나리오</p>
      <p className="mt-1">
        사용자가 입력한 가중치로 기존 분석 실행의 Z/R/E/D 구성점수를 재결합한 임시 비교
        결과입니다. 공식 분석 실행, 전문가 판단, 법적 적격성, 인허가 가능성 또는 최종 입지
        결정을 의미하지 않습니다.
      </p>
    </div>
  );
}

function ScenarioPresetButtons({
  presets,
  onLoad,
}: {
  presets: { key: string; label: string; percents: ScenarioPercents }[];
  onLoad: (percents: ScenarioPercents) => void;
}) {
  return (
    <section aria-label="프리셋 가중치">
      <h3 className="mb-1 text-xs font-semibold text-slate-700">저장된 프로파일 불러오기 (프리셋)</h3>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="프리셋 선택">
        {presets.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onLoad(preset.percents)}
            data-testid={`scenario-preset-${preset.key}`}
            className="min-h-[36px] rounded bg-slate-100 px-2.5 py-1 text-xs text-slate-700 md:min-h-0"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        프리셋은 저장된 프로파일 값을 편집란에 불러오기만 합니다. 공식·전문가 승인 값이 아니며,
        적용하려면 「시나리오 적용」을 눌러야 합니다.
      </p>
    </section>
  );
}

function ScenarioWeightEditor({
  draft,
  onChange,
}: {
  draft: ScenarioPercents;
  onChange: (component: ScenarioComponent, value: number) => void;
}) {
  return (
    <fieldset className="m-0 rounded-md border border-slate-200 p-2">
      <legend className="px-1 text-xs font-semibold text-slate-600">
        구성요소 가중치 (Z/R/E/D, 합계 100%)
      </legend>
      <div className="flex flex-col gap-3">
        {SCENARIO_COMPONENTS.map((component) => {
          const meta = SCENARIO_COMPONENT_META[component];
          const value = draft[component];
          const sliderId = `scenario-slider-${component}`;
          const inputId = `scenario-input-${component}`;
          const name = `${meta.code} · ${meta.label}`;
          return (
            <div key={component} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label htmlFor={sliderId} className="text-sm text-slate-700">
                  {name}
                </label>
                <span className="text-xs font-medium text-slate-800" data-testid={`scenario-value-${component}`}>
                  {value}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id={sliderId}
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={value}
                  aria-label={`${name} 가중치 슬라이더`}
                  onChange={(e) => onChange(component, Number(e.target.value))}
                  data-testid={sliderId}
                  className="flex-1"
                />
                <input
                  id={inputId}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={value}
                  aria-label={`${name} 가중치 퍼센트 입력`}
                  onChange={(e) => onChange(component, Number(e.target.value))}
                  data-testid={inputId}
                  className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right text-sm"
                />
                <span aria-hidden className="text-xs text-slate-400">
                  %
                </span>
              </div>
              <p className="text-[11px] text-slate-500">{meta.explanation}</p>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function ScenarioValidation({
  total,
  diff,
  valid,
  normalizeNote,
}: {
  total: number;
  diff: number;
  valid: boolean;
  normalizeNote: string | null;
}) {
  const diffText = diff === 0 ? "정확히 100%" : diff > 0 ? `100% 초과 +${diff}` : `100% 부족 ${diff}`;
  return (
    <div
      role="status"
      data-testid="scenario-total-status"
      className={`rounded p-2 text-xs ${
        valid ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
      }`}
    >
      <span data-testid="scenario-total">현재 합계: {total}%</span> · {diffText} ·{" "}
      {valid ? "적용 가능" : "합계가 정확히 100%여야 적용할 수 있습니다"}
      {normalizeNote && (
        <span data-testid="scenario-normalize-note" className="mt-1 block">
          {normalizeNote}
        </span>
      )}
    </div>
  );
}

function ScenarioComparisonSelector({
  value,
  options,
  onChange,
}: {
  value: SuitabilityProfile;
  options: SuitabilityProfile[];
  onChange: (profile: SuitabilityProfile) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="scenario-compare-select" className="text-xs font-semibold text-slate-700">
        비교 대상 저장 프로파일
      </label>
      <select
        id="scenario-compare-select"
        data-testid="scenario-compare-select"
        value={value}
        onChange={(e) => onChange(e.target.value as SuitabilityProfile)}
        className="rounded border border-slate-300 px-2 py-1 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {PROFILE_LABEL[option] ?? option}
          </option>
        ))}
      </select>
    </div>
  );
}

function ScenarioApplyControls({
  valid,
  loading,
  onApply,
}: {
  valid: boolean;
  loading: boolean;
  onApply: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onApply}
      disabled={!valid || loading}
      data-testid="scenario-apply"
      aria-disabled={!valid || loading}
      className="min-h-[44px] rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 md:min-h-0"
    >
      {loading ? "적용 중…" : "시나리오 적용"}
    </button>
  );
}

function ScenarioSummary({
  result,
  appliedWeights,
  stale,
}: {
  result: UserScenarioPreview;
  appliedWeights: UserScenarioWeights | null;
  stale: boolean;
}) {
  const pct = (w: string | undefined): string =>
    w == null ? "—" : `${Math.round(Number(w) * 100)}%`;
  return (
    <section
      aria-label="시나리오 요약"
      data-testid="scenario-summary"
      className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-700"
    >
      <p className="text-sm font-semibold text-slate-900">사용자 가정 기반 시나리오</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-slate-500">분석 실행</dt>
        <dd>#{result.run_id}</dd>
        <dt className="text-slate-500">기준 연도</dt>
        <dd>{result.reference_year}</dd>
        <dt className="text-slate-500">방법 버전</dt>
        <dd>{result.method_version}</dd>
        <dt className="text-slate-500">시나리오 해시</dt>
        <dd title={result.scenario_hash}>
          <code>{result.scenario_hash_short}…</code>
        </dd>
        <dt className="text-slate-500">비교 프로파일</dt>
        <dd>{PROFILE_LABEL[result.compare_profile] ?? result.compare_profile}</dd>
        <dt className="text-slate-500">순위 산정 대상</dt>
        <dd>{result.ranking_population.toLocaleString()}개</dd>
        <dt className="text-slate-500">적용 가중치 Z/R/E/D</dt>
        <dd>
          {pct(appliedWeights?.zoning)} / {pct(appliedWeights?.road)} /{" "}
          {pct(appliedWeights?.equity)} / {pct(appliedWeights?.demand)}
        </dd>
        <dt className="text-slate-500">상태 분포</dt>
        <dd>
          {statusLabel("ELIGIBLE")} {result.candidate_count_eligible.toLocaleString()} ·{" "}
          {statusLabel("REVIEW_REQUIRED")} {result.candidate_count_review.toLocaleString()} ·{" "}
          {statusLabel("EXCLUDED")} {result.candidate_count_excluded.toLocaleString()}
        </dd>
      </dl>
      {/* Phase 7: the primary <dt>s read `분석 실행` / `순위 산정 대상`; the raw
          screening enum they used to carry inline is demoted here rather than
          deleted — the same "codes are demoted, never deleted" rule Phases 3, 5,
          and 6 applied on their own surfaces. */}
      <p className="mt-2 text-[11px] text-slate-400" data-diagnostic data-testid="scenario-summary-diagnostic">
        기술 정보: 순위 산정 대상 = 상태 ELIGIBLE 후보 구역 수
      </p>
      {stale && <p className="mt-2 text-amber-700">{STALE_MESSAGE}</p>}
      <p className="mt-2 text-[11px] text-slate-500">{result.scenario_disclaimer}</p>
    </section>
  );
}

function directionText(direction: string | null): string {
  if (direction === "up") return "상승";
  if (direction === "down") return "하락";
  if (direction === "same") return "변화 없음";
  return "";
}

function ScenarioTopCandidates({
  result,
  selectedId,
  onSelect,
}: {
  result: UserScenarioPreview;
  selectedId: number | null;
  onSelect: (candidateId: number) => void;
}) {
  return (
    <section aria-label="사용자 시나리오 상위 후보" data-testid="scenario-top-candidates">
      <h3 className="mb-1 text-xs font-semibold text-slate-700">사용자 시나리오 상위 후보</h3>
      {result.top_candidates.length === 0 ? (
        <p className="text-xs text-slate-500">표시할 스크리닝 통과 후보가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {result.top_candidates.map((c) => {
            const badge = stabilityBadgeLabel(c.stability_class, c.stable_count);
            const movement = rankMovementText(c.comparison_rank, c.custom_rank);
            const isSelected = selectedId === c.candidate_id;
            return (
              <li key={c.candidate_id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.candidate_id)}
                  data-testid="scenario-top-row"
                  aria-pressed={isSelected}
                  className={`w-full rounded border p-2 text-left text-xs ${
                    isSelected ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white"
                  }`}
                >
                  <span className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">
                      {c.custom_rank}위 · {c.custom_score}점
                    </span>
                    <span className="text-slate-500">{c.sigungu_region_name ?? ""}</span>
                  </span>
                  <span className="mt-0.5 block text-slate-600" data-testid="scenario-rank-move">
                    {movement}
                    {directionText(c.rank_change_direction) &&
                      ` (${directionText(c.rank_change_direction)})`}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    Z {c.zoning_score ?? "-"} · R {c.road_score ?? "-"} · E {c.equity_score ?? "-"} ·
                    D {c.demand_score ?? "-"}
                    {badge ? ` · ${badge}` : ""}
                  </span>
                  <span className="sr-only">{c.candidate_key}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ScenarioCandidateDetail({
  detail,
  onClear,
}: {
  detail: UserScenarioCandidateDetail;
  onClear: () => void;
}) {
  const scoreLine =
    detail.status === "ELIGIBLE"
      ? `${detail.custom_score ?? "-"}점 · ${detail.custom_rank ?? "-"}위`
      : detail.status === "REVIEW_REQUIRED"
        ? detail.custom_provisional_score != null
          ? `잠정 ${detail.custom_provisional_score}점 (최종 점수·순위 없음)`
          : "잠정 점수 없음 (구성요소 부족)"
        : `${statusLabel("EXCLUDED")} — 점수·순위 없음`;
  return (
    <section
      aria-label="사용자 시나리오 후보 상세"
      data-testid="scenario-candidate-detail"
      className="rounded border border-indigo-200 bg-white p-3 text-xs text-slate-700"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">후보 상세 (사용자 시나리오)</h3>
        <button
          type="button"
          onClick={onClear}
          data-testid="scenario-detail-clear"
          className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
        >
          닫기
        </button>
      </div>
      <p className="mt-1">
        <span className="font-medium">{detail.sigungu_region_name ?? ""}</span> · 상태{" "}
        {statusLabel(detail.status)}
      </p>
      <p className="mt-0.5" data-testid="scenario-detail-score">
        점수: {scoreLine}
      </p>
      <p className="mt-0.5" data-testid="scenario-detail-movement">
        {rankMovementText(detail.comparison_rank, detail.custom_rank)}
      </p>
      <table className="mt-2 w-full border-collapse text-[11px]">
        <caption className="sr-only">구성요소별 가중 기여</caption>
        <thead>
          <tr className="text-left text-slate-500">
            <th scope="col">구성</th>
            <th scope="col">점수</th>
            <th scope="col">가중치</th>
            <th scope="col">기여</th>
          </tr>
        </thead>
        <tbody>
          {detail.contributions.map((row) => (
            <tr key={row.component}>
              <td>{SCENARIO_COMPONENT_META[row.component as ScenarioComponent]?.code ?? row.component}</td>
              <td>{row.component_score ?? "—"}</td>
              <td>{Math.round(Number(row.weight) * 100)}%</td>
              <td>{row.weighted_contribution ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.stable_count != null && (
        <p className="mt-2 text-[11px] text-slate-500">
          저장된 안정성: {stabilityBadgeLabel(detail.stability_class, detail.stable_count) ?? "-"} (저장된
          run 기준이며 사용자 시나리오의 안정성 평가가 아닙니다)
        </p>
      )}
      {detail.status === "EXCLUDED" && detail.exclusion_reasons.length > 0 && (
        <p className="mt-1 text-[11px] text-rose-700">
          제외 사유: {detail.exclusion_reasons.join(", ")} — 사용자 가중치는 배제를 뒤집지 않습니다.
        </p>
      )}
      {detail.status === "REVIEW_REQUIRED" && detail.review_reasons.length > 0 && (
        <p className="mt-1 text-[11px] text-amber-700">검토 사유: {detail.review_reasons.join(", ")}</p>
      )}
      <p className="mt-2 text-[11px] text-slate-400">{detail.scenario_disclaimer}</p>
      <p className="mt-1 text-[11px] text-slate-400">{detail.screening_disclaimer}</p>
    </section>
  );
}

function ScenarioMethodology() {
  return (
    <details data-testid="scenario-methodology" className="rounded border border-slate-200 p-2 text-xs">
      <summary className="cursor-pointer font-semibold text-slate-700">방법론 및 한계</summary>
      <ul className="mt-1 list-disc pl-4 text-slate-600">
        <li>고정된 한 개 분석 실행의 저장된 Z/R/E/D 구성점수만 재결합합니다.</li>
        <li>구역 상태 판정, 배제·검토 사유, 안정성은 재계산되지 않습니다.</li>
        <li>순위는 완전한 ELIGIBLE 후보에 대해 custom_score 내림차순·candidate_key 오름차순으로 산정됩니다.</li>
        <li>검토 후보는 최종 점수·순위가 없으며, 결측 구성요소는 0으로 대체되지 않습니다.</li>
        <li>새 공식 분석 실행·저장 프로파일·CRITIC·안정성 정의를 만들지 않으며 데이터베이스에 저장되지 않습니다.</li>
      </ul>
    </details>
  );
}
