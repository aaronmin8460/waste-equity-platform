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
 * a user scenario, so the profile radios stay the honest control for this one.
 *
 * THE FIGMA REMEDIATION re-ordered the card to the frame's own reading — heading,
 * segmented bar, the basis it belongs to, the control that changes it, the four
 * factor cards, then the 안정 후보 row that closes it. The bar used to be three
 * blocks down inside a tinted "현재 적용 중인 기준" panel, and the radio list carried
 * two extra wrapped lines per option, which together put the factor cards a full
 * screen below the heading of the card they are the subject of. Nothing was deleted:
 * see the control block below for where each moved line went.
 *
 * THE PRIMARY-COPY CLEANUP finished that job. Figma 136:8684 draws card ② as five
 * things and no prose: the heading, the segmented bar, four factor cards, and the
 * 안정 후보 row — every explanation in the frame sits behind a per-card
 * "가중치 설명 펼치기" disclosure. Production had grown four standing explanatory
 * blocks that the frame has no room for, three of which repeated something the card
 * already showed:
 *
 *   - the one-line Z/R/E/D percentage sentence → the bar draws it and each factor
 *     card prints its own weight beside the factor's Korean name;
 *   - the active profile's method sentence → 기준별 가중치 비교, where all five
 *     methods can be compared, and the 가중치 계산 방법 disclosure;
 *   - the standing "this run also reports stability" sentence → the 안정 후보 row
 *     states the rule AND the live state, and `critic-unavailable` covers the run
 *     that has no stability at all;
 *   - the 운영 가정 paragraph and the CRITIC derivation note → the 가중치 계산 방법
 *     disclosure at the foot of the card.
 *
 * NOTHING LEFT THE PRODUCT and no second methodology card was created: every line
 * has a named home above, and each removal is pinned by a test in
 * app/page.page4PrimaryCopy.test.tsx so it cannot drift back into the primary card.
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
import { CANDIDATE_STABLE_OUTLINE_COLOR, formatCount } from "../../lib/metrics";
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
      className="wep-figma-card wep-numbered-card"
    >
      {/* THE SEGMENTED BAR SITS DIRECTLY UNDER THE HEADING, full width, exactly as
          Figma 136:8684 draws it — before the restructure it was buried inside a
          "현재 적용 중인 기준" sub-box three blocks down, so the card opened with a
          tinted panel instead of with the distribution it is about. It is drawn
          from the SAME served rows the factor cards print: it adds a shape, never
          a number. */}
      <SuitabilityWeightBar rows={activeRows} />

      {/* WHICH basis those proportions belong to — the NAME, and nothing else.
          This row used to carry three more standing lines, all of which said again
          what the card already shows or explains elsewhere:

            - `active-basis-weights`, the one-line "용도지역 호환성(Z) 25% · …"
              sentence. The bar directly above draws that distribution and the four
              factor cards below each print `가중치 NN%` beside the factor's full
              Korean name, so this was a third copy of the same four numbers.
            - `active-basis-explanation`, the profile's method sentence ("…민감도
              비교 가정입니다."). Every basis's method is in 기준별 가중치 비교 below,
              where the five can actually be read against one another.
            - `active-basis-stability`, a standing sentence saying this run reports
              stability. The 안정 후보 표시 row closes the card with the actual rule
              and the actual state; when the run has NO stability the
              `critic-unavailable` notice below says so in actionable terms.

          Nothing was deleted from the product — see each line's new home above. */}
      <div
        className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
        data-testid="suitability-active-basis"
      >
        <span className="text-[11px] text-ink-subtle">현재 적용 중인 기준</span>
        <span className="text-sm font-semibold text-ink" data-testid="active-basis-name">
          {profileLabel(profile)}
        </span>
      </div>

      {/* THE CONTROL, directly under the distribution it changes.
          Figma puts a free "가중치 설정 __%" input in every factor card; this screen
          has none (see the file header — the map shows a STORED run), so the honest
          control is the basis selector, and it belongs here rather than below the
          four cards it drives.

          Native radios in one `name="profile"` group, so arrow keys traverse the
          whole list; the checked input, the heavier label weight, and the stronger
          border all mark the selection alongside the tint. Test ids
          `profile-selector` / `profile-radio-*` are unchanged, and the inputs stay
          visible (e2e/integration.spec.ts asserts it).

          THE ROWS ARE ONE LINE EACH. They used to carry the option's method
          sentence and its four named weights, which wrap to three lines at 360px —
          five of those put the factor cards, the subject of this card, a full
          screen below its heading. Neither is deleted: the method belongs to the
          ACTIVE basis and is printed above by `active-basis-explanation`, and every
          basis's weights are in the comparison disclosure below, where they can
          actually be read side by side instead of scattered down a radio list. */}
      <fieldset className="mt-3 m-0 border-0 p-0" data-testid="profile-selector">
        <legend className="mb-1 text-[11px] font-semibold text-ink-subtle">점수 반영 기준</legend>
        <div className="flex flex-col gap-1">
          {PROFILE_OPTIONS.filter((option) => runProfiles.includes(option.key)).map((option) => {
            const selected = profile === option.key;
            return (
              <label
                key={option.key}
                title={option.method}
                className={`flex items-center gap-2 rounded-control border px-2.5 py-1.5 text-xs ${
                  selected
                    ? "border-primary-border bg-primary-soft font-semibold text-ink"
                    : "border-hairline bg-surface text-ink-muted"
                }`}
              >
                <input
                  type="radio"
                  name="profile"
                  checked={selected}
                  onChange={() => onSelectProfile(option.key)}
                  data-testid={`profile-radio-${option.key}`}
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </label>
            );
          })}
        </div>
        {/* Every basis's four weights in one place, with their full Korean names —
            never bare code letters. Closed by default; the one in force is already
            stated above the list. */}
        <details className="mt-1.5" data-testid="profile-weight-comparison">
          <summary className="cursor-pointer text-[11px] font-medium text-ink-muted">
            기준별 가중치 비교
          </summary>
          <dl className="mt-1 flex flex-col gap-1">
            {PROFILE_OPTIONS.filter((option) => runProfiles.includes(option.key)).map((option) => (
              <div key={option.key}>
                <dt className="text-[11px] font-medium text-ink">{option.label}</dt>
                <dd className="text-[10px] leading-snug tabular-nums text-ink-subtle">
                  {namedWeights(weightsFor(run, policy, option.key))}
                </dd>
                <dd className="text-[10px] leading-snug text-ink-subtle">{option.method}</dd>
              </div>
            ))}
          </dl>
        </details>
      </fieldset>

      {/* THE FOUR FACTORS, one card each (Figma card ②). Same weights, same order,
          same glossary names — this is the active basis broken out per factor. */}
      <SuitabilityFactorCards weights={activeRows} selected={selected} />

      {/* THE METHODOLOGY, BEHIND ONE DISCLOSURE. Both blocks below are unchanged in
          wording and both used to stand open in the primary card: a reader had to
          get past a four-line paragraph about 운영 가정 and a six-line CRITIC
          derivation (candidate population, method version, the raw weight vector,
          zero-variance criteria, the normative-importance caveat) before reaching
          the 안정 후보 row that closes the card.

          Neither is optional information, so neither moves out of the card and
          neither is duplicated into a second methodology card — they move ONE
          keystroke away, which is the same treatment Figma 136:8684 gives every
          factor card's own explanation (가중치 설명 펼치기). The mandatory
          "이것은 규범적 중요도가 아니다" caveat still travels with the CRITIC
          weights it qualifies, and is never separated from them. */}
      <details className="mt-3" data-testid="scoring-basis-method">
        <summary className="cursor-pointer text-[11px] font-medium text-ink-muted">
          가중치 계산 방법 펼치기
        </summary>

        {/* Distinguish the fixed policy-assumption bases from the data-distribution
            one. Unchanged wording. */}
        <p className="mt-1.5 text-[11px] leading-snug text-ink-subtle">
          기본·모두 똑같이·지역 부담 중심·도로 근접성 중심은 <strong>운영 가정</strong>으로 정한 고정
          비율이며 전문가 AHP 결과가 아닙니다. <strong>데이터 분포 기준</strong>은 이 분석 실행의 후보
          점수 분포에서 자동 계산된 비율입니다.
        </p>

        {/* The method sentence for the basis currently in force. It left the primary
            row above; this is where it lands, beside the paragraph that frames what
            kind of assumption it is. */}
        {activeMeta?.detail ? (
          <p
            className="mt-1.5 text-[11px] leading-snug text-ink-subtle"
            data-testid="active-basis-method-detail"
          >
            현재 기준({profileLabel(profile)}): {activeMeta.detail}
          </p>
        ) : null}

        {stabilityAvailable && <CriticMethodNote run={run} />}
      </details>

      {stabilityAvailable ? null : (
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
        <div
          className="mt-3 flex items-start gap-2.5 rounded-control border border-hairline bg-surface-muted px-4 py-3.5"
          data-testid="scoring-basis-stability"
        >
          {/* The stable-candidate OUTLINE, not a checkbox: the swatch is the same
              signal the map draws, so the row reads as the legend entry it is. */}
          <span
            aria-hidden
            className="mt-0.5 h-3.5 w-3.5 flex-none rounded-[3px] border-2"
            style={{ borderColor: CANDIDATE_STABLE_OUTLINE_COLOR }}
          />
          <p className="min-w-0 text-[11px] leading-snug text-ink-muted">
            <span className="text-[13px] font-bold text-ink">안정 후보 표시</span>
            <span className="mt-0.5 block">
              {STABILITY_RULE_SHORT} 현재{" "}
              <span className="font-semibold text-ink">
                {stableOnly
                  ? "안정 후보만 보기가 켜져 있습니다"
                  : "안정 후보만 보기가 꺼져 있습니다"}
              </span>
              . 표시 설정은 지도 왼쪽 아래 범례에서 바꿀 수 있으며, 후보 수와 점수는 바뀌지 않습니다.
            </span>
          </p>
        </div>
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
