"use client";

/**
 * ② 계산 모델 가중치 설정 — the active scoring basis, the four factors it combines,
 * and the control that changes it (Figma 136:8684, card ②).
 *
 * Split out of the former `SuitabilityPanel` in `app/page.tsx`. It is PURE
 * PRESENTATION: the active profile, the profile list, and every weight it renders
 * are passed in, and the weights are the ones the RUN served (falling back to the
 * policy's static profile only for a pre-CRITIC run whose `weight_profiles` were
 * never populated — exactly as before). It computes no weight, no score, and no
 * ranking, and it invents no profile.
 *
 * The restructure is one of hierarchy, not content: the ACTIVE basis is stated
 * first as an answer — name, plain-Korean method, the four weights as labelled rows
 * — and the radio list that changes it follows. Before, a reader had to work out
 * which of five equally-weighted rows was checked to learn what the map was showing.
 *
 * PAGE 4A adds the Figma shape on top of that same content: a segmented weight bar
 * over the four served weights, and one card per factor. The Figma card also carries
 * a free "가중치 설정 __%" input per factor; this view has no such control, because
 * the scores and ranks on the map are a STORED run — editing a weight here would
 * imply a recomputation that does not happen. Weight experimentation already has its
 * own screen (후보지 심층 비교), which recomputes explicitly and labels the result as
 * a user scenario, so the profile radios below stay the honest control for this one.
 *
 * Wording rules this component keeps (docs/SUITABILITY_CRITIC_STABILITY.md):
 *   - the fixed policy-assumption bases are labelled 운영 가정, never expert AHP;
 *   - 데이터 분포 기준 (CRITIC) is described as automatically computed from the
 *     spread and overlap of the values — never as importance, expert judgement, or
 *     policy priority;
 *   - the raw profile keys (`baseline`, `critic`, …) stay in the diagnostic layer.
 */

import type {
  CandidateDetail,
  SuitabilityPolicy,
  SuitabilityProfile,
  SuitabilityRun,
} from "../../lib/api";
import { PROFILE_META, profileLabel } from "../../lib/glossary";
import { formatCount } from "../../lib/metrics";
import { namedWeightRows, namedWeights } from "../../lib/suitability";
import SectionCard from "../ui/SectionCard";
import SuitabilityFactorCards from "./SuitabilityFactorCards";
import SuitabilityWeightBar from "./SuitabilityWeightBar";
import { OLD_RUN_NO_CRITIC_MESSAGE, PROFILE_OPTIONS, STABILITY_RULE_SHORT } from "./shared";

export interface SuitabilityScoringBasisProps {
  policy: SuitabilityPolicy;
  run: SuitabilityRun;
  /** The active profile — the ONE canonical page state, never a local copy. */
  profile: SuitabilityProfile;
  onSelectProfile: (profile: SuitabilityProfile) => void;
  /** The profiles this run actually supports (critic only when computed). */
  runProfiles: SuitabilityProfile[];
  /** Whether the run carries CRITIC + stability results. */
  stabilityAvailable: boolean;
  /** The one selected candidate, so each factor card can show its served score. */
  selected: CandidateDetail | null;
  /** Whether the map is currently restricted to stable candidates (reported only). */
  stableOnly: boolean;
}

/**
 * The weights actually in force for a profile on THIS run. Run-specific for critic;
 * the policy's static profile is the fallback for an old run that stored none.
 * Identical resolution to the pre-refresh panel — never a fixed critic constant.
 */
function weightsFor(
  run: SuitabilityRun,
  policy: SuitabilityPolicy,
  profile: SuitabilityProfile,
): Record<string, string> {
  return (run.weight_profiles ?? {})[profile] ?? policy.weight_profiles[profile] ?? {};
}

export default function SuitabilityScoringBasis({
  policy,
  run,
  profile,
  onSelectProfile,
  runProfiles,
  stabilityAvailable,
  selected,
  stableOnly,
}: SuitabilityScoringBasisProps) {
  const activeWeights = weightsFor(run, policy, profile);
  const activeRows = namedWeightRows(activeWeights);
  const activeMeta = PROFILE_META[profile];

  return (
    <SectionCard
      title="② 계산 모델 가중치 설정"
      description="네 항목을 어떤 비율로 반영해 후보 점수를 계산할지 결정합니다."
      testId="scoring-basis"
      className="wep-figma-card"
    >
      {/* THE ACTIVE BASIS, answer-first. Everything here is already-served state:
          the profile's glossary label + method sentence, and the run's own weights. */}
      <div
        className="rounded-card border border-primary-border bg-primary-soft p-3"
        data-testid="suitability-active-basis"
      >
        <p className="text-[11px] font-medium text-ink-subtle">현재 적용 중인 기준</p>
        <p className="mt-0.5 text-base font-semibold text-ink" data-testid="active-basis-name">
          {profileLabel(profile)}
        </p>
        {activeMeta?.detail ? (
          <p className="mt-1 text-xs text-ink-muted" data-testid="active-basis-explanation">
            {activeMeta.detail}
          </p>
        ) : null}
        {/* The Figma segmented distribution strip, drawn from the SAME served rows
            the labelled list below prints. It adds a shape, never a number. */}
        <div className="mt-2">
          <SuitabilityWeightBar rows={activeRows} />
        </div>
        {/* The four weights as labelled rows with their numeric percentage beside
            the bar — the bar is never the only carrier of the value. */}
        <dl className="mt-2 flex flex-col gap-1" data-testid="active-basis-weights">
          {activeRows.map((row) => (
            <div key={row.component} className="flex items-center gap-2 text-xs">
              <dt className="min-w-0 flex-1 truncate text-ink-muted">{row.label}</dt>
              <dd className="flex flex-none items-center gap-2">
                <span aria-hidden className="hidden h-1.5 w-16 rounded-pill bg-surface sm:block">
                  <span
                    className="block h-full rounded-pill bg-primary"
                    style={{ width: row.percent === "-" ? "0%" : row.percent }}
                  />
                </span>
                <span className="w-9 text-right font-semibold tabular-nums text-ink">
                  {row.percent}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[11px] text-ink-subtle" data-testid="active-basis-stability">
          {stabilityAvailable
            ? "이 분석 실행은 기준을 바꿔도 상위권을 유지하는 정도(안정성)를 함께 제공합니다."
            : "이 분석 실행에는 안정성 결과가 없습니다."}
        </p>
      </div>

      {/* THE FOUR FACTORS, one card each (Figma card ②). Same weights, same order,
          same glossary names — this is the active basis broken out per factor. */}
      <SuitabilityFactorCards weights={activeRows} selected={selected} />

      {/* THE CONTROL. Native radios in one `name="profile"` group, so arrow keys
          traverse the whole list; the checked input, the heavier label weight, and
          the stronger border all mark the selection alongside the tint. Test ids
          `profile-selector` / `profile-radio-*` are unchanged. */}
      <fieldset className="mt-3 m-0 border-0 p-0" data-testid="profile-selector">
        <legend className="mb-1 text-xs font-semibold text-ink-subtle">
          점수 반영 기준
        </legend>
        <div className="flex flex-col gap-1">
          {PROFILE_OPTIONS.filter((option) => runProfiles.includes(option.key)).map((option) => {
            const selected = profile === option.key;
            return (
              <label
                key={option.key}
                className={`flex items-start gap-2 rounded-card border p-2 text-sm ${
                  selected
                    ? "border-primary-border bg-primary-soft font-semibold text-ink"
                    : "border-hairline bg-surface text-ink-muted"
                }`}
              >
                <input
                  type="radio"
                  name="profile"
                  className="mt-1"
                  checked={selected}
                  onChange={() => onSelectProfile(option.key)}
                  data-testid={`profile-radio-${option.key}`}
                />
                <span className="min-w-0">
                  {option.label}
                  <span className="mt-0.5 block text-[11px] font-normal text-ink-subtle">
                    {option.method}
                  </span>
                  <span className="mt-0.5 block text-[11px] font-normal tabular-nums text-ink-subtle">
                    {namedWeights(weightsFor(run, policy, option.key))}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Distinguish the fixed policy-assumption bases from the data-distribution
          one. Unchanged wording. */}
      <p className="mt-2 text-xs text-ink-subtle">
        기본·모두 똑같이·지역 부담 중심·도로 근접성 중심은 <strong>운영 가정</strong>으로 정한 고정
        비율이며 전문가 AHP 결과가 아닙니다. <strong>데이터 분포 기준</strong>은 이 분석 실행의 후보
        점수 분포에서 자동 계산된 비율입니다.
      </p>

      {stabilityAvailable ? (
        <CriticMethodNote run={run} />
      ) : (
        <p
          className="mt-2 rounded-card border border-warn-border bg-warn-surface p-2 text-[11px] text-ink-muted"
          data-testid="critic-unavailable"
        >
          {OLD_RUN_NO_CRITIC_MESSAGE}
        </p>
      )}

      {/* 안정 후보 — the Figma frame closes card ② with this. It is a REPORT of the
          canonical `stableOnly` state, not a second control: the one checkbox that
          drives it lives in the map's own legend, beside the outline it explains,
          and the screen is contracted to have exactly one
          (app/page.suitabilityDashboard.test.tsx). Duplicating it here would give a
          reader two switches for one state.

          The rule is stated as the production definition actually is: THREE
          comparison bases (기본 · 모두 똑같이 · 데이터 분포), not four. Nothing is
          recomputed here — the classification comes from the stored run. */}
      {stabilityAvailable && (
        <p
          className="mt-2 rounded-card border border-hairline bg-surface-muted p-2 text-[11px] leading-relaxed text-ink-muted"
          data-testid="scoring-basis-stability"
        >
          <span className="font-semibold text-ink">안정 후보</span> — {STABILITY_RULE_SHORT} 현재{" "}
          <span className="font-semibold text-ink">
            {stableOnly ? "안정 후보만 보기가 켜져 있습니다" : "안정 후보만 보기가 꺼져 있습니다"}
          </span>
          . 표시 설정은 지도 왼쪽 아래 범례에서 바꿀 수 있으며, 후보 수와 점수는 바뀌지 않습니다.
        </p>
      )}
    </SectionCard>
  );
}

/**
 * Run-specific CRITIC methodology note: candidate population, method version, the
 * actual Z/R/E/D weights, any zero-variance criteria, and the mandatory
 * interpretation caveat. Moved from `app/page.tsx` with its content unchanged —
 * only the raw slate/sky utilities were replaced by the shared tokens.
 */
function CriticMethodNote({ run }: { run: SuitabilityRun }) {
  const w = run.weight_profiles.critic;
  if (!w) return null;
  const deriv = run.weight_derivation as Record<string, unknown>;
  const pop = deriv.population_candidate_count;
  const methodVersion = deriv.method_version;
  const zeroVar = (deriv.zero_variance_criteria as string[] | undefined) ?? [];
  return (
    <div
      className="mt-2 rounded-card border border-info-border bg-info-surface p-2 text-[11px] text-ink-muted"
      data-testid="critic-method-note"
    >
      <p className="font-medium text-ink">CRITIC 데이터 기반 가중치</p>
      <p className="mt-0.5">
        방법: CRITIC · 대상 후보 {pop != null ? formatCount(Number(pop)) : "-"}개 (자료가 완전한
        스크리닝 통과 후보)
        {methodVersion ? (
          <span className="ml-1 break-all text-ink-subtle" data-diagnostic>
            (방법 버전 {String(methodVersion)})
          </span>
        ) : null}
      </p>
      {/* The four weights with their Korean names, never bare single letters. The
          run's exact served decimals stay reachable in the diagnostic line below —
          demoted, never deleted, so an analyst can still read the actual vector. */}
      <p className="mt-0.5 tabular-nums">가중치: {namedWeights(w)}</p>
      <p className="mt-0.5 tabular-nums text-ink-subtle" data-diagnostic>
        원값 Z {w.zoning} · R {w.road} · E {w.equity} · D {w.demand}
      </p>
      {zeroVar.length > 0 && (
        <p className="mt-0.5" data-testid="critic-zero-variance">
          분산 0(정보 없음)으로 가중치 0인 기준: {zeroVar.join(", ")}
        </p>
      )}
      <p className="mt-0.5">
        가중치는 이 실행의 완전한 스크리닝 통과 후보 점수의 분산·상관관계로 계산되며, 조닝/도로/형평성/수요의
        규범적 중요도가 아닌 선택된 데이터·분석 범위의 구조를 나타냅니다. 전문가 판단·법적 우선순위·보편적
        정책 중요도가 아닙니다.
      </p>
    </div>
  );
}
