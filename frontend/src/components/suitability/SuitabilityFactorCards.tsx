"use client";

/**
 * The four factor cards of ② 계산 모델 가중치 설정 (Figma 136:8684, expanded 356:582).
 *
 * ── THE FOUR FACTORS ARE THE PRODUCTION MODEL'S OWN ──────────────────────────────
 * Z 용도지역 호환성 · R 도로 근접성 대리지표 · E 기존 지역 부담 · D 폐기물 처리 수요.
 * The Figma frame mocks a DIFFERENT four (기존시설 부담지수 / 대기영향 지수 / 용도변경
 * 가능지수 / 주민영향 지수, and elsewhere 시설 부담 / 토지피복 / 장래 발생량 / 주민
 * 반응). Those two sets do not match each other and neither matches this backend, so
 * rendering them would be a fabricated analytical claim. The card LAYOUT and the
 * CONTROLS are taken from Figma; the factors are the repository's own
 * (docs/SUITABILITY_CRITIC_STABILITY.md, glossary COMPONENT_META).
 *
 * ── EVERY VALUE IS SERVED ────────────────────────────────────────────────────────
 * The component score, when shown, is the SELECTED candidate's served component
 * score, printed verbatim; a component with no served score renders "-", never 0. The
 * 우수/양호/보통/미흡/부적합 word beside it is `lib/factorScoreBand.ts` reading that
 * same served number against the design's fixed 0–100 cut points — an absolute,
 * per-factor label, NOT the relative A/B/C band over the total score.
 *
 * ── THE WEIGHT CONTROL ───────────────────────────────────────────────────────────
 * Figma draws `가중치 설정 [ __ ] %` in every card. When {@link SuitabilityFactorCardsProps.editor}
 * is supplied (the Page-4 workspace) that input is LIVE: typing a value moves the
 * editor to 사용자 지정 and, once the four total exactly 100 and the reader applies
 * them, the vector is sent to the scenario preview endpoint and comes back as this
 * screen's ranking, scores and map tiles. See `useSuitabilityCustomWeights.ts` for
 * the exact-decimal contract and `customWeightRanking.ts` for what the response
 * drives.
 *
 * Without an `editor` — the single-column shape, which 후보지 심층 비교 renders — the
 * weight stays a READ-OUT of the active profile's served weight. That screen has its
 * own weight lab; a second editable control there would be two surfaces competing to
 * define one scenario.
 *
 * ── DIRECTION IS STATED, NOT IMPLIED ─────────────────────────────────────────────
 * Each card carries `COMPONENT_DIRECTION`, one sentence saying which way the score
 * points. This is what keeps 기존 지역 부담(E) from being read backwards: a HIGH E
 * score means LESS existing burden.
 */

import type { CandidateDetail } from "../../lib/api";
import { factorScoreBandLabel } from "../../lib/factorScoreBand";
import {
  COMPONENT_META,
  COMPONENT_ORDER,
  codeWithName,
  componentExplanation,
  type ScoreComponent,
} from "../../lib/glossary";
import type { ScenarioComponent, ScenarioPercents } from "../../lib/scenario";
import { COMPONENT_ACCENT } from "./factorAccents";
import { COMPONENT_DIRECTION } from "./shared";

/** The live weight editor, when this card group is the editable one. */
export interface FactorWeightEditor {
  percents: ScenarioPercents;
  setPercent: (component: ScenarioComponent, percent: number) => void;
  /** Blocks editing while an apply is in flight, so a half-typed vector cannot race it. */
  disabled?: boolean;
}

export interface SuitabilityFactorCardsProps {
  /** Active-profile weights, already formatted ("40%" / "-"). */
  weights: { component: ScoreComponent; label: string; percent: string }[];
  /** The one selected candidate, or null when nothing is selected. */
  selected: CandidateDetail | null;
  /** Supplied only where the weight is genuinely editable — see the header. */
  editor?: FactorWeightEditor;
}

/** The selected candidate's served score for a component. `null` stays `null`. */
function servedScore(detail: CandidateDetail | null, component: ScoreComponent): string | null {
  if (detail === null) return null;
  const scores: Record<ScoreComponent, string | null> = {
    zoning: detail.zoning_score,
    road: detail.road_score,
    equity: detail.equity_score,
    demand: detail.demand_score,
  };
  return scores[component];
}

/**
 * The four component keys are the same set in both namespaces — `ScoreComponent`
 * (glossary) and `ScenarioComponent` (the weight editor) — so the cast is a
 * restatement, not a widening. `lib/scenario.ts`'s `SCENARIO_COMPONENTS` and
 * `glossary.ts`'s `COMPONENT_ORDER` are both exactly zoning/road/equity/demand.
 */
function asScenarioComponent(component: ScoreComponent): ScenarioComponent {
  return component as ScenarioComponent;
}

export default function SuitabilityFactorCards({
  weights,
  selected,
  editor,
}: SuitabilityFactorCardsProps) {
  const byComponent = new Map(weights.map((row) => [row.component, row]));
  return (
    <ul className="mt-3 flex flex-col gap-2" data-testid="factor-cards">
      {COMPONENT_ORDER.map((component) => {
        const weight = byComponent.get(component);
        const score = servedScore(selected, component);
        // The ABSOLUTE per-factor label (Figma 352:1255). Null whenever there is no
        // score to read — a data gap is never labelled 부적합.
        const band = factorScoreBandLabel(score);
        const accent = COMPONENT_ACCENT[component];
        const inputId = `factor-weight-input-${component}`;
        return (
          <li
            key={component}
            // Figma 136:8684 draws each factor card at r=14 with 18/16 padding and
            // an accent border, which is what these three values are.
            className="rounded-[14px] border bg-surface px-[18px] py-4"
            style={{ borderColor: accent }}
            data-testid={`factor-card-${component}`}
          >
            {/* THE TITLE LINE, Figma 356:582's shape: the factor's name and its
                score on the left ("기존시설 부담지수 : 87/100"), the absolute band
                word on the right ("우수"). With no candidate selected there is no
                score and therefore no band word — the slot stays empty rather than
                showing a label for a number that does not exist. */}
            <div className="flex items-baseline gap-2">
              <span
                aria-hidden
                className="h-2.5 w-2.5 flex-none self-center rounded-pill"
                style={{ backgroundColor: accent }}
              />
              <h4 className="min-w-0 flex-1 text-[15px] font-bold leading-tight text-ink">
                {codeWithName(component)}
                <span
                  className="ml-1 tabular-nums"
                  data-testid={`factor-score-${component}`}
                >
                  : {selected === null ? "후보 미선택" : score === null ? "-" : `${score}/100`}
                </span>
              </h4>
              {band !== null && (
                <span
                  className="flex-none text-[15px] font-bold leading-tight text-ink"
                  data-testid={`factor-band-${component}`}
                >
                  {band}
                </span>
              )}
            </div>

            {/* 가중치 설정 [ __ ] % — Figma's own control. Editable in the Page-4
                workspace, a read-out everywhere else (see the header). Both forms
                print the SAME number, so the segmented bar above and this row can
                never disagree.

                `relative` is LOAD-BEARING, not decoration: the `sr-only` note below is
                `position: absolute`, so without a positioned ancestor its containing
                block is the initial one — it then sits at a document coordinate rather
                than inside the scrolling analysis column, and its static position at
                the foot of a long column pushes `documentElement.scrollHeight` past the
                viewport. The Page-4 workspace contract is that the COLUMNS scroll and
                the page never does (e2e/suitabilityDashboard.spec.ts), so this one word
                is what keeps a screen-reader-only string from breaking that. */}
            <div className="relative mt-2 flex items-center gap-2">
              <label className="text-sm font-bold text-ink-subtle" htmlFor={inputId}>
                가중치 설정
              </label>
              {editor ? (
                <input
                  id={inputId}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  disabled={editor.disabled}
                  // Figma: 43×27, r=8, 1.2px accent border.
                  className="h-[27px] w-[52px] rounded-[8px] border-[1.2px] bg-surface px-1 text-center text-[13px] tabular-nums text-ink disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: accent }}
                  value={editor.percents[asScenarioComponent(component)]}
                  onChange={(event) =>
                    editor.setPercent(
                      asScenarioComponent(component),
                      // An emptied field reads as NaN and the editor floors it to 0,
                      // which keeps the running total truthful (and therefore
                      // invalid) instead of silently holding the previous value.
                      Number.parseInt(event.target.value, 10),
                    )
                  }
                  aria-describedby={`${inputId}-note`}
                  data-testid={`factor-weight-${component}`}
                />
              ) : (
                <span
                  className="inline-flex h-[27px] min-w-[52px] items-center justify-center rounded-[8px] border-[1.2px] px-1 text-[13px] font-semibold tabular-nums text-ink"
                  style={{ borderColor: accent }}
                  data-testid={`factor-weight-${component}`}
                >
                  {weight?.percent ?? "-"}
                </span>
              )}
              {editor && (
                <span className="text-[13px] text-ink-subtle" aria-hidden>
                  %
                </span>
              )}
              <span id={`${inputId}-note`} className="sr-only">
                {COMPONENT_META[component].primary} 가중치.
                {editor
                  ? " 0에서 100 사이의 정수로 입력하며, 네 항목의 합이 정확히 100%일 때만 계산할 수 있습니다."
                  : " 현재 적용 중인 점수 반영 기준이 정한 값입니다."}
              </span>
            </div>

            <p className="mt-2 text-xs leading-snug text-ink-muted">
              {COMPONENT_DIRECTION[component]}
            </p>

            {/* Figma keeps one disclosure per card ("▼ 계산 모델 설명 접기"). The data
                provenance that used to sit above it as a fifth always-on line joins
                it inside, so the closed card is the four lines the frame draws. */}
            <details className="mt-1.5" data-testid={`factor-explain-${component}`}>
              <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                이 항목 설명 펼치기
              </summary>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                {componentExplanation(component)}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
                자료 근거: {COMPONENT_META[component].detail}
              </p>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
