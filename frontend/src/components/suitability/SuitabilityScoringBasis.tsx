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
 * over the four served weights, and one card per factor.
 *
 * ── 사용자 지정 가중치 — THE FRAME'S OWN CONTROL, NOW LIVE ───────────────────────
 * Figma 356:582 draws a free "가중치 설정 __%" input in every factor card, and the
 * saved-scenario list 231:442 shows non-preset vectors that can only exist if the
 * reader authors them. An earlier pass rendered that input DISABLED, reasoning that
 * the map and ranking are a STORED run and an editable weight would imply a
 * recomputation that does not happen.
 *
 * The recomputation DOES happen, and always did: `POST /suitability/scenarios/preview`
 * recombines this run's frozen Z/R/E/D component scores under any weight vector that
 * sums to exactly 1.00000000, and `userScenarioTileUrl` serves the matching map tiles.
 * The owner has required the control explicitly, so the input is live and its result
 * is REAL — ③'s rows, their scores and the map's tile source all come from that
 * response while a vector is applied. What the earlier refusal was protecting is kept
 * instead by labelling: an applied vector is named 사용자 지정 everywhere it appears,
 * it never re-runs screening, and it never relabels a candidate's official status.
 *
 * The profile radios remain, as the PRESETS the requirement asks to keep; selecting
 * one reloads its served vector and drops any applied scenario, and editing a loaded
 * preset moves the editor to 사용자 지정 without the reader having to declare it
 * (`useSuitabilityCustomWeights.ts`).
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
  SuitabilitySummary,
} from "../../lib/api";
import UnmodeledFactorsDisclosure from "./UnmodeledFactorsDisclosure";
import {
  COMPONENT_META,
  PROFILE_META,
  profileLabel,
  statusExplanation,
  statusLabel,
} from "../../lib/glossary";
import { formatCount } from "../../lib/metrics";
import { namedWeights } from "../../lib/suitability";
import SectionCard from "../ui/SectionCard";
import SuitabilityFactorCards from "./SuitabilityFactorCards";
import SuitabilityWeightBar from "./SuitabilityWeightBar";
import SuitabilityV3FactorCards, {
  SuitabilityV3WeightBar,
} from "./SuitabilityV3FactorCards";
import { isSuccessorRun, pendingV3Factors, v3FactorViews } from "../../lib/suitabilityV3";
import { namedWeightRows } from "../../lib/suitability";
import { OLD_RUN_NO_CRITIC_MESSAGE, PROFILE_OPTIONS } from "./shared";
import {
  FACTOR_SCORE_BANDS,
  FACTOR_SCORE_BAND_SOURCE_NOTE,
  FACTOR_SCORE_BAND_TITLE,
} from "../../lib/factorScoreBand";
import { SCENARIO_COMPONENTS, type ComponentPercents } from "../../lib/scenario";
import type { SuitabilityCustomWeights } from "./useSuitabilityCustomWeights";

/** The three screening statuses, in the order every surface lists them. */
const SCREENING_STATUSES = ["ELIGIBLE", "REVIEW_REQUIRED", "EXCLUDED"] as const;

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
  /**
   * The run summary, passed ONLY in the Page-4 workspace.
   *
   * That shape strikes 자료 공백 안내 and 계산 방법과 가정 as standing cards (Figma
   * 225:440), so this card takes custody of what they said and renders it behind the
   * 점수 기준 자세히 보기 disclosure the frame draws at its own foot. `undefined` in
   * the single-column shape, where both still exist as their own cards and a second
   * copy here would be a duplicate.
   */
  summary?: SuitabilitySummary;
  /**
   * The 사용자 지정 weight editor, passed ONLY in the Page-4 workspace.
   *
   * `undefined` leaves every weight a read-out of the served profile, which is the
   * correct shape for 후보지 심층 비교 — that screen has its own weight lab, and two
   * editors defining one scenario would be a contradiction rather than a convenience.
   */
  customWeights?: SuitabilityCustomWeights;
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

/**
 * The editor's integer percents as the bar's row shape.
 *
 * A FORMATTING STEP, not a computation: it restates the four numbers the reader
 * typed. The label comes from the shared glossary, so the bar, the factor cards and
 * every export name each factor identically.
 */
function percentBarRows(percents: ComponentPercents) {
  return SCENARIO_COMPONENTS.map((component) => ({
    component,
    label: COMPONENT_META[component].primary,
    percent: `${percents[component]}%`,
  }));
}

export default function SuitabilityScoringBasis({
  policy,
  run,
  profile,
  onSelectProfile,
  runProfiles,
  stabilityAvailable,
  selected,
  summary,
  customWeights,
}: SuitabilityScoringBasisProps) {
  // `stableOnly` stays on the props interface but is not read: it was only ever
  // consumed by the struck 안정 후보 row.
  const activeMeta = PROFILE_META[profile];
  const activeWeights = weightsFor(run, policy, profile);

  /**
   * The rows the segmented bar draws.
   *
   * While the editor is open the bar follows the EDITOR, so the shape above the
   * cards is the vector the reader is composing rather than the one they moved away
   * from. It is the same redundant encoding either way — the number it draws is
   * always printed as text in the factor card beneath it.
   */
  const barRows = customWeights
    ? percentBarRows(customWeights.percents)
    : namedWeightRows(activeWeights);

  /**
   * WHICH MODEL THIS RUN IS — read from the RUN, never assumed.
   *
   * The backend serves every run's own `component_model_version`
   * (docs/SUITABILITY_COMPONENT_MODEL_CONTRACT.md) and its default run resolution
   * is still the HISTORICAL model: flipping that is the product owner's rollout
   * decision, recorded as SUCCESSOR_DEFAULT_RUN_RESOLUTION_UNDECIDED. So this card
   * renders whichever model the run reports rather than forcing the successor —
   * pinning the request to V3 here would both preempt that decision and break the
   * screen everywhere no successor run exists.
   */
  const successor = isSuccessorRun(run.component_model_version);

  /**
   * THE SUCCESSOR-V3 FACTOR STATE, built from SERVED values.
   *
   * `component_scores` is the authoritative representation for a successor run; the
   * four legacy columns are explicit null there and are never read for V3. Scores
   * are per-CANDIDATE, so they fill only once a candidate is selected — with none
   * selected the cards show their weights and an unavailable score, never a 0.
   */
  const v3Factors = successor
    ? v3FactorViews({
        componentScores: selected?.component_scores,
        weights: activeWeights,
        componentOrder: run.component_order,
      })
    : pendingV3Factors();
  const v3Pending = v3Factors.every((f) => f.score === null);

  return (
    <SectionCard
      /* No description line: Figma 136:8684 draws card ② as heading → bar → four
         factor cards → 점수 기준 자세히 보기, with no prose between them. */
      title="② 계산 모델 가중치 설정"
      testId="scoring-basis"
      className="wep-figma-card wep-numbered-card"
    >
      {/* THE SEGMENTED BAR SITS DIRECTLY UNDER THE HEADING, full width, exactly as
          Figma 136:8684 draws it — before the restructure it was buried inside a
          "현재 적용 중인 기준" sub-box three blocks down, so the card opened with a
          tinted panel instead of with the distribution it is about. It is drawn
          from the SAME served rows the factor cards print: it adds a shape, never
          a number. */}
      {/* THE BAR FOR THE MODEL THIS RUN ACTUALLY IS. A historical run keeps the
          Z/R/E/D bar drawn from its own served vector; a successor run gets the V3
          bar. Neither is ever drawn from the other model's numbers. */}
      {successor ? (
        <SuitabilityV3WeightBar factors={v3Factors} />
      ) : (
        <SuitabilityWeightBar rows={barRows} />
      )}

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
          {/* Once the reader has authored a vector, the basis in force is THEIRS —
              printing a preset's name over 사용자 지정 numbers would be the one
              mislabel this card cannot afford. */}
          {/* The name of the basis IN FORCE. On a successor run the five historical
              profile labels do not apply — the model has one approved profile — so
              naming it "기본 기준" would attach a historical policy name to a
              successor vector. */}
          {customWeights?.isCustom
            ? CUSTOM_WEIGHTS_LABEL
            : successor
              ? SUCCESSOR_BASIS_LABEL
              : profileLabel(profile)}
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
        {/* ── THE SUCCESSOR MODEL HAS ONE APPROVED PROFILE ───────────────────────
            `baseline` (equal 0.25×4) is the only registered successor weight vector.
            The five historical pills below (기본/모두 똑같이/지역 부담 중심/도로 근접성
            중심/데이터 분포 기준) are defined over the Z/R/E/D components and have NO
            approved successor equivalent — showing them here would label a vector
            with a policy that was never registered for it, and mapping them across
            by position would rename one measurement to another. So a successor run
            gets exactly 기준 and 사용자 지정. */}
        {successor && customWeights && (
          <div className="flex flex-wrap gap-1" data-testid="v3-preset-row">
            <label
              title="후속 모델에 등록된 하나뿐인 승인 가중치입니다 (네 지수 각 25%)."
              className={`inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-[11px] ${
                customWeights.isCustom
                  ? "border-hairline bg-surface text-ink-muted"
                  : "border-primary-border bg-primary-soft font-semibold text-ink"
              }`}
            >
              <input
                type="radio"
                name="profile"
                checked={!customWeights.isCustom}
                onChange={customWeights.reset}
                data-testid="v3-preset-baseline"
              />
              <span className="whitespace-nowrap">기준</span>
            </label>
            <label
              title="네 지수의 가중치를 직접 입력합니다."
              className={`inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-[11px] ${
                customWeights.isCustom
                  ? "border-primary-border bg-primary-soft font-semibold text-ink"
                  : "border-hairline bg-surface text-ink-muted"
              }`}
            >
              <input
                type="radio"
                name="profile"
                checked={customWeights.isCustom}
                onChange={customWeights.selectCustom}
                data-testid="profile-radio-custom"
              />
              <span className="whitespace-nowrap">{CUSTOM_WEIGHTS_LABEL}</span>
            </label>
          </div>
        )}
        {/* COMPACT PILL ROW, not five stacked full-width rows.
            Figma card ② has no radio list at all — its control is the per-factor
            weight input. That input is disabled while the run is a stored one, so
            removing the basis selector would leave the card with NO working control:
            a functional regression, not a copy cleanup. It stays, wrapped inline so
            it costs roughly one third of the height it did, and the inputs stay
            VISIBLE because e2e/integration.spec.ts asserts exactly that. */}
        {/* NOT RENDERED for a successor run — not merely hidden. A hidden duplicate
            is still in the DOM, still focusable by assistive technology, and still
            a second element carrying the same testid. The V3 row above replaces it
            entirely. */}
        {!successor && (
        <div className="flex flex-wrap gap-1">
          {PROFILE_OPTIONS.filter((option) => runProfiles.includes(option.key)).map((option) => {
            // A preset is only "the basis in force" while the reader has not
            // authored their own vector — otherwise two pills would look selected.
            const selected = profile === option.key && !customWeights?.isCustom;
            return (
              <label
                key={option.key}
                title={option.method}
                className={`inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-[11px] ${
                  selected
                    ? "border-primary-border bg-primary-soft font-semibold text-ink"
                    : "border-hairline bg-surface text-ink-muted"
                }`}
              >
                <input
                  type="radio"
                  name="profile"
                  checked={selected}
                  onChange={() => {
                    // Selecting a preset RELOADS its served vector and drops any
                    // applied scenario — that is what makes the pills presets rather
                    // than labels sitting beside unrelated numbers.
                    customWeights?.reset();
                    onSelectProfile(option.key);
                  }}
                  data-testid={`profile-radio-${option.key}`}
                />
                <span className="whitespace-nowrap">{option.label}</span>
              </label>
            );
          })}
          {/* 사용자 지정 — the requirement's explicit Custom option, in the SAME
              radio group as the presets so arrow keys traverse all of them and only
              one can ever be current. It selects the mode without changing a value:
              the numbers already in the four inputs become the reader's own. */}
          {customWeights && (
            <label
              title="네 지수의 가중치를 직접 입력합니다."
              className={`inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-[11px] ${
                customWeights.isCustom
                  ? "border-primary-border bg-primary-soft font-semibold text-ink"
                  : "border-hairline bg-surface text-ink-muted"
              }`}
            >
              <input
                type="radio"
                name="profile"
                checked={customWeights.isCustom}
                onChange={customWeights.selectCustom}
                data-testid="profile-radio-custom"
              />
              <span className="whitespace-nowrap">{CUSTOM_WEIGHTS_LABEL}</span>
            </label>
          )}
        </div>
        )}
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

      {/* THE FOUR SUCCESSOR-V3 FACTOR CARDS (Figma card ②, expanded form 356:582).
          Final presentation, honestly empty values — never Z/R/E/D numbers under a
          V3 heading. See SuitabilityV3FactorCards and lib/suitabilityV3.ts. */}
      {successor ? (
        <SuitabilityV3FactorCards
          factors={v3Factors}
          editor={
            customWeights
              ? {
                  percents: customWeights.percents,
                  setPercent: customWeights.setPercent,
                  disabled: customWeights.applying,
                }
              : undefined
          }
          pendingReason={
            v3Pending
              ? "지수 점수는 후보를 선택하면 그 후보의 실제 계산 결과로 표시됩니다. 값이 없는 항목은 0으로 채우지 않습니다."
              : undefined
          }
        />
      ) : (
        /* A HISTORICAL RUN KEEPS ITS OWN CARDS. Showing four empty V3 cards over a
           zred-v1 run would hide the real component scores that run actually has —
           the mirror image of the fabrication the V3 cards exist to prevent. The
           model a reader sees is always the model the run is. */
        <SuitabilityFactorCards
          weights={namedWeightRows(activeWeights)}
          selected={selected}
          editor={
            customWeights
              ? {
                  percents: customWeights.percents,
                  setPercent: customWeights.setPercent,
                  disabled: customWeights.applying,
                }
              : undefined
          }
        />
      )}

      {/* THE TOTAL, THE VALIDATION, AND THE APPLY. Only where the inputs are live. */}
      {customWeights && <CustomWeightControls custom={customWeights} />}

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

        {/* THE RUN'S OWN ANALYTICAL IDENTITY — model, policy and derivation version.
            Kept OUT of the primary canvas (the mandate limits technical metadata
            there) but never hidden: which model produced the numbers on screen is
            exactly what an analyst reproducing a result needs, and the successor and
            historical models share no component namespace. Read from the run row,
            never from this client's constants. */}
        <dl
          className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-ink-subtle"
          data-testid="scoring-basis-model-identity"
        >
          <dt className="font-medium text-ink">분석 모델</dt>
          <dd data-diagnostic className="break-all">
            {run.component_model_version ?? "모델 정보를 제공하지 않는 분석 실행"}
            {successor ? " (후속 모델)" : " (기존 모델)"}
          </dd>
          <dt className="font-medium text-ink">정책 버전</dt>
          <dd data-diagnostic className="break-all">
            {run.policy_version}
          </dd>
          <dt className="font-medium text-ink">산출 버전</dt>
          <dd data-diagnostic className="break-all">
            {run.derivation_version}
          </dd>
        </dl>

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

      {/* 안정 후보 — STRUCK. The page-4 기술 참고사항 list (Figma 225:440) says
          "[② 계산 모델 가중치 설정] 하단에 '안정 후보'에 대한 설명은 삭제. 지도 쪽에
          있는 것만으로도 충분함."

          Nothing is lost: the map legend still draws the stable outline beside its
          own 안정 후보 entry, and the ONE checkbox that drives `stableOnly` was
          always in that legend, never here — this block only ever REPORTED the
          state. The rule text lives on in the legend and in 점수 기준 자세히 보기. */}

      {/* ▼ 점수 기준 자세히 보기 — the disclosure Figma 136:8684 draws at the foot of
          card ② (48,1096), and the new home of the two cards the 기술 참고사항 list
          strikes from the left column: 자료 공백 안내 and 계산 방법과 가정.

          Their content is NOT rewritten and NOT dropped — the served coverage notes,
          the served assumptions, the served disclaimer and the unmodeled-factor
          disclosure all render here verbatim. The strike removes standing grey blocks
          from the primary canvas; it does not remove the integrity statements, which
          stay one keystroke away. Without this the coverage notes would simply be
          absent from the workspace, which would be a real loss rather than a
          relocation. */}
      {summary && (
        <details className="mt-3" data-testid="score-basis-detail">
          <summary className="cursor-pointer text-[11px] text-ink-subtle">
            점수 기준 자세히 보기
          </summary>

          <p className="mt-1.5 text-[11px] leading-snug text-ink-subtle">
            각 지수는 100점 만점이며, 점수가 높을수록 그 지수에서 유리하다는 뜻입니다. 지수 점수와 합산
            점수는 <strong>후보를 비교하기 위한 상대적 선별 값</strong>이며, 법적 입지 적합성이나 인허가
            가능 여부를 판정한 결과가 아닙니다.
          </p>

          {/* THE PER-FACTOR LABEL TABLE — Figma 225:440 asks for exactly this, behind
              exactly this disclosure: "각 계산 모델의 만점은 100점이고, 라벨은 다음과
              같음 (라벨링 기준은 하단에 '점수 기준 자세히 보기' 누르면 나오도록)".
              The five words are the ABSOLUTE per-factor label each card prints beside
              its own score; they are NOT the relative A/B/C band over the total score,
              which lives in ③ and is computed from the population's distribution. */}
          <div className="mt-2" data-testid="factor-score-band-table">
            <p className="text-[11px] font-semibold text-ink">{FACTOR_SCORE_BAND_TITLE}</p>
            <dl className="mt-1 flex flex-col gap-0.5">
              {FACTOR_SCORE_BANDS.map((band) => (
                <div
                  key={band.key}
                  className="flex items-baseline justify-between gap-2 text-[11px]"
                  data-testid={`factor-score-band-${band.key}`}
                >
                  <dt className="tabular-nums text-ink-subtle">{band.range}</dt>
                  <dd className="font-semibold text-ink">{band.label}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-1 text-[11px] leading-snug text-ink-subtle">
              {FACTOR_SCORE_BAND_SOURCE_NOTE}
            </p>
          </div>

          {summary.assumptions.length > 0 && (
            <ul
              className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-snug text-ink-subtle"
              data-testid="score-basis-assumptions"
            >
              {summary.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          )}

          {/* A gap is a BLANK, never a confirmed "해당 없음", and the sentence saying
              so travels WITH the list rather than being summarised away. */}
          {summary.coverage_notes.length > 0 && (
            <div className="mt-2" data-testid="score-basis-coverage">
              <p className="text-[11px] font-semibold text-ink">자료 공백</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-snug text-ink-subtle">
                {summary.coverage_notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] leading-snug text-ink-subtle">
                자료가 없는 항목은 공백이며 &quot;해당 없음&quot;을 확인한 것이 아닙니다.
              </p>
            </div>
          )}

          {/* WHAT EACH SCREENING STATUS MEANS, from the shared glossary — the
              Phase-0 terminology contract. It stood in the struck 후보 상태 요약; the
              map legend names the three statuses and counts them but never defines
              them, so the definitions land here rather than being lost with the card.
              Same testids, because the meaning is genuinely preserved. */}
          <dl className="mt-2 flex flex-col gap-1" data-testid="score-basis-status-meanings">
            {SCREENING_STATUSES.map((status) => (
              <div key={status} data-testid={`status-explanation-${status}`}>
                <dt className="inline text-[11px] font-semibold text-ink">
                  {statusLabel(status)}:{" "}
                </dt>
                <dd className="inline text-[11px] leading-snug text-ink-subtle">
                  {statusExplanation(status)}
                </dd>
              </div>
            ))}
          </dl>

          {/* WHAT 안정 후보 MEANS, and — the part no other surface carries — what it
              explicitly does NOT mean. The map legend describes the outline but not
              this limit, so striking 기준을 바꿔도 상위권을 유지하는 정도 would have
              dropped a legal disclaimer rather than a duplicate. */}
          {stabilityAvailable && (
            <p
              className="mt-2 text-[11px] leading-snug text-ink-subtle"
              data-testid="score-basis-stability-meaning"
            >
              안정 후보는 세 비교 방식(baseline / equal / critic) 모두에서 상위 10%에 포함된
              후보입니다. 가중치 변화에 덜 민감하다는 뜻이며 최종 입지, 허가 가능성 또는 법적 적격성을
              의미하지 않습니다.
            </p>
          )}

          {/* WHICH RUN produced everything above. Kept with the analytical identity
              rather than in the canvas, but never dropped: a score without its run is
              not reproducible. */}
          <p
            className="mt-2 text-[11px] leading-snug text-ink-subtle"
            data-testid="suitability-run-context"
          >
            분석 실행 <span data-diagnostic>#{run.id}</span> · 기준연도 {run.reference_year} · 경계{" "}
            {run.boundary_vintage} · <span data-diagnostic>{run.policy_version}</span>
          </p>

          <div className="mt-2">
            <UnmodeledFactorsDisclosure testId="score-basis-unmodeled-factors" />
          </div>
        </details>
      )}

      {/* THE SCREENING LIMITATION STAYS VISIBLE — deliberately OUTSIDE the disclosure
          above. It is the standing statement that these scores are an analytical
          screening and not a legal determination, and the repository contracts it as
          never-collapsed (app/page.phase0.test.tsx, page.suitabilityDashboard.test.tsx).
          Relocating the methodology card was a copy cleanup; putting THIS behind a
          keystroke would have been a semantic weakening, so it did not move.
          One short line, which is a density the frame can carry. */}
      {summary && (
        <p
          className="mt-3 text-[11px] font-medium leading-snug text-warn"
          data-testid="score-basis-disclaimer"
        >
          {summary.disclaimer}
        </p>
      )}
    </SectionCard>
  );
}

/** The name the Custom option carries on every surface that mentions it. */
export const CUSTOM_WEIGHTS_LABEL = "사용자 지정";

/**
 * The successor model's one approved profile, named as itself.
 *
 * NOT "기본 기준": that is the historical `baseline` profile's citizen-facing label,
 * defined over Z/R/E/D, and printing it above successor weights would name a policy
 * that was never registered for them.
 */
export const SUCCESSOR_BASIS_LABEL = "기준";

/**
 * The running total, its validation, and the two actions — 계산 적용 / 기준값으로
 * 되돌리기.
 *
 * ── VALIDATION IS THE BACKEND'S OWN RULE, STATED EARLY ───────────────────────────
 * `analysis/suitability/scenario.py` requires the canonical 8-dp weight sum to equal
 * exactly `Decimal("1.00000000")` and records that invalid weights are *"never
 * silently normalized, replaced with equal weights, or have a remainder
 * redistributed — the caller is always informed"*. This block is the client-side
 * expression of that same rule: the total is shown live, a total that is not exactly
 * 100% DISABLES 계산 적용 and says by how much it is off, and nothing is ever
 * auto-corrected. Each input is already bounded to 0–100 by the card that renders it,
 * so the only reachable failure is the total — which is named rather than repaired.
 *
 * The disabled button is paired with a visible reason (`aria-describedby`), because a
 * greyed control with no explanation is the failure mode this validation exists to
 * avoid.
 *
 * ── WHAT "적용" DOES ─────────────────────────────────────────────────────────────
 * Sends the vector to the scenario preview endpoint and, on success, hands the
 * response to the page, which re-points ③'s rows and the map's tile source at it. On
 * refusal, the backend's own message is shown verbatim and NO scenario is left
 * applied — the screen never shows one weighting while claiming another.
 */
function CustomWeightControls({ custom }: { custom: SuitabilityCustomWeights }) {
  const noteId = "custom-weight-total-note";
  const overBy = custom.difference;
  return (
    <div className="mt-3 rounded-card border border-hairline bg-surface-muted p-2.5" data-testid="custom-weight-controls">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="text-[11px] font-semibold text-ink">가중치 합계</span>
        <span
          className={`text-sm font-bold tabular-nums ${custom.valid ? "text-ink" : "text-danger"}`}
          data-testid="custom-weight-total"
        >
          {custom.total}%
        </span>
      </div>

      {/* The rule, then the live verdict. Both are text; the colour above is a second
          encoding of a state this line already names. */}
      <p
        id={noteId}
        className={`mt-1 text-[11px] leading-snug ${custom.valid ? "text-ink-subtle" : "text-danger"}`}
        data-testid="custom-weight-validation"
      >
        {custom.valid
          ? "네 항목의 합이 100%입니다. 계산을 적용할 수 있습니다."
          : `네 항목의 합이 정확히 100%여야 계산할 수 있습니다. 현재 ${
              overBy > 0 ? `${overBy}%p 많습니다` : `${Math.abs(overBy)}%p 모자랍니다`
            }. 합계는 자동으로 맞추지 않습니다.`}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={custom.apply}
          disabled={!custom.canApply}
          aria-describedby={custom.canApply ? undefined : noteId}
          className="h-8 rounded-control border border-primary-border bg-primary-soft px-3 text-[11px] font-bold text-ink disabled:cursor-not-allowed disabled:border-hairline disabled:bg-surface disabled:text-ink-subtle"
          data-testid="custom-weight-apply"
        >
          {custom.applying ? "계산 중…" : "이 가중치로 계산"}
        </button>
        <button
          type="button"
          onClick={custom.reset}
          disabled={custom.applying}
          className="h-8 rounded-control border border-hairline bg-surface px-3 text-[11px] text-ink-muted disabled:cursor-not-allowed"
          data-testid="custom-weight-reset"
        >
          기준값으로 되돌리기
        </button>
      </div>

      {custom.error !== null && (
        <p
          className="mt-2 rounded-card border border-danger-border bg-danger-surface p-2 text-[11px] leading-snug text-danger"
          role="alert"
          data-testid="custom-weight-error"
        >
          {custom.error}
        </p>
      )}

      {custom.applied !== null && custom.error === null && (
        <p
          className="mt-2 text-[11px] leading-snug text-ink-muted"
          role="status"
          data-testid="custom-weight-applied"
        >
          {CUSTOM_WEIGHTS_LABEL} 가중치를 적용했습니다. 아래 지도와 ③ 순위·점수가 이 가중치로 다시
          계산된 결과입니다. 스크리닝 통과·제외 판정은 가중치와 무관하므로 달라지지 않습니다.{" "}
          <span data-diagnostic>시나리오 {custom.applied.scenarioHashShort}</span>
        </p>
      )}
    </div>
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
