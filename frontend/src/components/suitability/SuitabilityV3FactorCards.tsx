"use client";

/**
 * The four Successor-V3 factor cards of ② 계산 모델 가중치 설정.
 *
 * Figma authority: frame 136:8684 card ② for the closed card, and 356:582
 * (계산 모델 가중치 설정 · 펼침 예시) for the expanded one.
 *
 * ── THE CARD IS FINAL; ITS DATA IS HONESTLY ABSENT ───────────────────────────────
 * The frame is already Successor-V3 — it names 기존시설 부담지수 · 대기영향 지수 ·
 * 용도변경 가능지수 · 주민영향 지수. The backend that serves those four indices has
 * not shipped, so every VALUE here arrives as `null` and renders as an explicit
 * unavailable state.
 *
 * What is NOT done, and must never be done: filling these slots with the Z/R/E/D
 * model's numbers. V3 is not a rename of Z/R/E/D — `land_conversion` and
 * `resident_impact` are new computations and `road` has no successor — so a Z/R/E/D
 * value under a V3 heading would be a fabricated measurement. `lib/suitabilityV3.ts`
 * documents the full crosswalk and why it does not exist.
 *
 * ── THE WEIGHT CONTROL ───────────────────────────────────────────────────────────
 * The frame draws a free `가중치 설정 __%` input per card. It is rendered here at
 * full fidelity but DISABLED, because Page 4's map and ranking are a STORED run:
 * an editable weight would imply a recomputation that does not happen, and the
 * mandate is explicit that changing a ranking weight must not silently redefine
 * screening eligibility. Whether it becomes editable is decided by the served V3
 * scenario contract, not here. The disabled state carries a real reason rather than
 * a bare greyed box, so the control explains itself.
 *
 * ── COLOUR IS NEVER THE ONLY SIGNAL ──────────────────────────────────────────────
 * The accent border and the bar segment share one value per component, but every
 * card also states its full Korean name, its own score line, and its own weight.
 */

import { useId } from "react";
import {
  V3_COMPONENT_META,
  type V3Component,
  type V3FactorView,
} from "../../lib/suitabilityV3";

export interface SuitabilityV3FactorCardsProps {
  factors: readonly V3FactorView[];
  /**
   * One sentence explaining WHY the values are absent, shown once at the foot of
   * the group rather than repeated in all four cards. Omitted when values arrive.
   */
  pendingReason?: string;
}

/** The served score as `NN/100`, or the unavailable marker — never a fabricated 0. */
function scoreText(score: number | null): string {
  return score === null ? "—/100" : `${score}/100`;
}

function FactorCard({ view }: { view: V3FactorView }) {
  const meta = V3_COMPONENT_META[view.component];
  const inputId = useId();
  const unavailable = view.score === null;

  return (
    <li
      // Figma: r=14, 1.6px accent border, 16/18 padding, 8px internal gap.
      className="rounded-[14px] border-[1.6px] bg-surface px-[18px] py-4"
      style={{ borderColor: meta.accent }}
      data-testid={`v3-factor-card-${view.component}`}
    >
      {/* TITLE ROW — "이름 : NN/100" left, the served grade word right, both 15.5/700. */}
      <div className="flex items-baseline gap-2">
        <h4 className="min-w-0 flex-1 text-[15.5px] font-bold leading-tight text-ink">
          {meta.label}
          <span className="ml-1 tabular-nums" data-testid={`v3-factor-score-${view.component}`}>
            : {scoreText(view.score)}
          </span>
        </h4>
        {/* The grade word is POLICY-OWNED. With nothing served the slot stays empty
            rather than guessing a 우수/미흡 from an unknown threshold. */}
        {view.gradeLabel !== null && (
          <span
            className="flex-none text-[15.5px] font-bold leading-tight text-ink"
            data-testid={`v3-factor-grade-${view.component}`}
          >
            {view.gradeLabel}
          </span>
        )}
      </div>

      {/* WEIGHT CONTROL — Figma "가중치 설정 [ __ ] %". Full shape, disabled. */}
      <div className="mt-2 flex items-center gap-2">
        <label
          className="text-sm font-bold text-ink-subtle"
          htmlFor={inputId}
        >
          가중치 설정
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          readOnly
          disabled
          // Figma: 43×27, r=8, 1.2px accent border.
          className="h-[27px] w-[43px] rounded-[8px] border-[1.2px] bg-surface text-center text-[13px] tabular-nums text-ink disabled:cursor-not-allowed disabled:opacity-70"
          style={{ borderColor: meta.accent }}
          value={view.weightPercent === null ? "" : String(view.weightPercent)}
          aria-describedby={`${inputId}-note`}
          data-testid={`v3-factor-weight-${view.component}`}
        />
        <span className="text-[13px] text-ink-subtle" aria-hidden>
          %
        </span>
        <span id={`${inputId}-note`} className="sr-only">
          {meta.label} 가중치. 현재 이 화면은 저장된 분석 실행 결과를 보여주므로 값을 바꿀 수
          없습니다.
        </span>
      </div>

      {/* The frame's one-line description, 12.5/400. */}
      <p className="mt-2 text-[12.5px] leading-snug text-ink-subtle">{meta.description}</p>

      {/* Figma's per-card disclosure. Its BODY is deliberately not the frame's
          prototype formula — 356:582 prints one whose coordinates it describes as
          "실제 위경도가 아닌 SVG 캔버스 좌표", which would mis-describe a real served
          score. The served policy's own method text fills this once wired. */}
      <details className="mt-2" data-testid={`v3-factor-explain-${view.component}`}>
        <summary className="cursor-pointer text-xs text-ink-subtle">계산 모델 설명 펼치기</summary>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
          {unavailable
            ? "이 지수의 계산식과 사용 데이터, 한계는 분석 모델이 연결되면 실제 정책 정의에서 그대로 표시됩니다."
            : meta.description}
        </p>
      </details>
    </li>
  );
}

export default function SuitabilityV3FactorCards({
  factors,
  pendingReason,
}: SuitabilityV3FactorCardsProps) {
  return (
    <div data-testid="v3-factor-cards">
      <ul className="mt-3 flex flex-col gap-2">
        {factors.map((view) => (
          <FactorCard key={view.component} view={view} />
        ))}
      </ul>
      {pendingReason && (
        <p className="mt-2 text-[11px] leading-snug text-ink-subtle" data-testid="v3-factors-pending">
          {pendingReason}
        </p>
      )}
    </div>
  );
}

/**
 * The segmented weight bar Figma draws directly under the ② heading (48,432 · 304×10, r=6).
 *
 * It draws ONLY served weights. The frame's own bar is four equal 76px segments —
 * a 25/25/25/25 mock — and that is deliberately NOT reproduced while the weights are
 * unserved: four equal segments would read as a real, evenly-weighted policy vector.
 * With nothing served the track renders empty and says so, which is the honest shape
 * of "this slot is final, its data has not arrived".
 */
export function SuitabilityV3WeightBar({ factors }: { factors: readonly V3FactorView[] }) {
  const served = factors.filter(
    (f): f is V3FactorView & { weightPercent: number } => f.weightPercent !== null,
  );
  return (
    <div data-testid="v3-weight-bar">
      <span aria-hidden className="flex h-2.5 w-full overflow-hidden rounded-[6px] bg-surface-sunken">
        {served.map((f) => (
          <span
            key={f.component}
            className="block h-full"
            style={{
              width: `${f.weightPercent}%`,
              backgroundColor: V3_COMPONENT_META[f.component].accent,
            }}
            data-testid={`v3-weight-segment-${f.component}`}
          />
        ))}
      </span>
    </div>
  );
}

/** The four accents in frame order, for the segmented bar above the cards. */
export function v3BarSegments(
  factors: readonly V3FactorView[],
): { component: V3Component; accent: string; percent: number | null }[] {
  return factors.map((f) => ({
    component: f.component,
    accent: V3_COMPONENT_META[f.component].accent,
    percent: f.weightPercent,
  }));
}
