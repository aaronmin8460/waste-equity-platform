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
  SuitabilitySummary,
} from "../../lib/api";
import UnmodeledFactorsDisclosure from "./UnmodeledFactorsDisclosure";
import {
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
  summary,
}: SuitabilityScoringBasisProps) {
  // `stableOnly` stays on the props interface but is not read: it was only ever
  // consumed by the struck 안정 후보 row.
  const activeMeta = PROFILE_META[profile];
  const activeWeights = weightsFor(run, policy, profile);

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
        <SuitabilityWeightBar rows={namedWeightRows(activeWeights)} />
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
        {/* COMPACT PILL ROW, not five stacked full-width rows.
            Figma card ② has no radio list at all — its control is the per-factor
            weight input. That input is disabled while the run is a stored one, so
            removing the basis selector would leave the card with NO working control:
            a functional regression, not a copy cleanup. It stays, wrapped inline so
            it costs roughly one third of the height it did, and the inputs stay
            VISIBLE because e2e/integration.spec.ts asserts exactly that. */}
        <div className="flex flex-wrap gap-1">
          {PROFILE_OPTIONS.filter((option) => runProfiles.includes(option.key)).map((option) => {
            const selected = profile === option.key;
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
                  onChange={() => onSelectProfile(option.key)}
                  data-testid={`profile-radio-${option.key}`}
                />
                <span className="whitespace-nowrap">{option.label}</span>
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

      {/* THE FOUR SUCCESSOR-V3 FACTOR CARDS (Figma card ②, expanded form 356:582).
          Final presentation, honestly empty values — never Z/R/E/D numbers under a
          V3 heading. See SuitabilityV3FactorCards and lib/suitabilityV3.ts. */}
      {successor ? (
        <SuitabilityV3FactorCards
          factors={v3Factors}
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
        <SuitabilityFactorCards weights={namedWeightRows(activeWeights)} selected={selected} />
      )}

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
