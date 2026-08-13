"use client";

/**
 * The four factor cards of ② 계산 모델 가중치 설정 (Figma 136:8684).
 *
 * ── THE FOUR FACTORS ARE THE PRODUCTION MODEL'S OWN ──────────────────────────────
 * Z 용도지역 호환성 · R 도로 근접성 대리지표 · E 기존 지역 부담 · D 폐기물 처리 수요.
 * The Figma frame mocks a DIFFERENT four (시설 부담 정도 / 토지피복 기반 적합도 /
 * 장래 역내 쓰레기 발생량 / 시설에 대한 주민 반응). Three of those do not exist in
 * this backend at all — there is no land-cover suitability score, no future-waste
 * forecast, and no resident-reaction dataset — so rendering them would be a
 * fabricated analytical claim. The card LAYOUT is taken from Figma; the factors are
 * the repository's own (docs/SUITABILITY_CRITIC_STABILITY.md, glossary
 * COMPONENT_META).
 *
 * ── EVERY VALUE IS SERVED ────────────────────────────────────────────────────────
 * The weight is the active profile's served weight, formatted by `namedWeightRows`.
 * The component score, when shown, is the SELECTED candidate's served component
 * score, printed verbatim; a component with no served score renders "-", never 0.
 * Nothing here computes, rescales, or ranks anything.
 *
 * ── DIRECTION IS STATED, NOT IMPLIED ─────────────────────────────────────────────
 * Each card carries `COMPONENT_DIRECTION`, one sentence saying which way the score
 * points. This is what keeps 기존 지역 부담(E) from being read backwards: a HIGH E
 * score means LESS existing burden. The full "what this does and does not measure"
 * sentence stays one keystroke away in a `<details>`, so the card is scannable
 * without hiding anything a reader needs.
 */

import type { CandidateDetail } from "../../lib/api";
import {
  COMPONENT_META,
  COMPONENT_ORDER,
  codeWithName,
  componentExplanation,
  type ScoreComponent,
} from "../../lib/glossary";
import { COMPONENT_ACCENT } from "./factorAccents";
import { COMPONENT_DIRECTION } from "./shared";

export interface SuitabilityFactorCardsProps {
  /** Active-profile weights, already formatted ("40%" / "-"). */
  weights: { component: ScoreComponent; label: string; percent: string }[];
  /** The one selected candidate, or null when nothing is selected. */
  selected: CandidateDetail | null;
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

export default function SuitabilityFactorCards({
  weights,
  selected,
}: SuitabilityFactorCardsProps) {
  const byComponent = new Map(weights.map((row) => [row.component, row]));
  return (
    <ul className="mt-3 flex flex-col gap-2" data-testid="factor-cards">
      {COMPONENT_ORDER.map((component) => {
        const weight = byComponent.get(component);
        const score = servedScore(selected, component);
        const accent = COMPONENT_ACCENT[component];
        return (
          <li
            key={component}
            className="rounded-card border bg-surface p-3"
            style={{ borderColor: accent }}
            data-testid={`factor-card-${component}`}
          >
            <div className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-1 h-2.5 w-2.5 flex-none rounded-pill"
                style={{ backgroundColor: accent }}
              />
              <h4 className="min-w-0 flex-1 text-sm font-semibold text-ink">
                {codeWithName(component)}
              </h4>
              {/* The weight, as text, beside the name — the bar above is a second
                  encoding of this number, never its only home. */}
              <span
                className="flex-none rounded-pill bg-primary-soft px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink"
                data-testid={`factor-weight-${component}`}
              >
                가중치 {weight?.percent ?? "-"}
              </span>
            </div>

            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
              {COMPONENT_DIRECTION[component]}
            </p>

            {/* WHAT THE SCORE IS FOR THE CURRENT SELECTION. With nothing selected
                this states the instruction — never a sample score and never a 0. */}
            <p
              className="mt-1.5 flex items-baseline gap-2 text-[11px] text-ink-subtle"
              data-testid={`factor-score-${component}`}
            >
              <span>선택한 후보의 이 항목 점수</span>
              <span className="font-semibold tabular-nums text-ink">
                {selected === null ? "후보 미선택" : (score ?? "-")}
              </span>
            </p>

            <p className="mt-1.5 text-[11px] text-ink-subtle">
              자료 근거: {COMPONENT_META[component].detail}
            </p>

            <details className="mt-1.5" data-testid={`factor-explain-${component}`}>
              <summary className="cursor-pointer text-[11px] font-medium text-ink-muted">
                이 항목 설명 펼치기
              </summary>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                {componentExplanation(component)}
              </p>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
