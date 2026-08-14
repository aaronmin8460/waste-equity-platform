"use client";

/**
 * ⑤ 비교할 시나리오 선택 (Figma 136:8684 card ⑤).
 *
 * Two ordered slots — A안 / B안 — each holding one SAVED scenario, a `(선택 N/2개)`
 * counter, a `↻` reset, and the `두 시나리오 비교하기 →` call to action that moves
 * the reader to 후보지 심층 비교 (the page-4 기술요청 note 225:443: "우측 맨 하단
 * [두 시나리오 비교하기] 누르면 다음 페이지로 자동 이동").
 *
 * ── NO DEFAULTS ──────────────────────────────────────────────────────────────────
 * Both slots start empty and stay empty until the reader picks. Pre-filling A안
 * with, say, the two highest-ranked saved scenarios would make the comparison the
 * product's opinion rather than the reader's question. The CTA is unavailable until
 * exactly two DISTINCT slots resolve.
 *
 * ── A SLOT CAN FAIL TO RESOLVE, AND THAT IS SAID OUT LOUD ────────────────────────
 * `cmpA`/`cmpB` travel in a shared link, but the scenarios they name live in ONE
 * browser's localStorage. Opening such a link on another device leaves a slot in
 * the `MISSING` state, which is rendered as an explicit sentence — never as a
 * blank slot that looks like the reader simply has not chosen yet.
 *
 * ── WHAT THIS CARD DOES NOT DO ───────────────────────────────────────────────────
 * It shows no score, no rank and no winner. A comparison is produced by the
 * preview API on the next screen against the current run; this card only carries
 * the question there. Nothing here reads or writes storage — the page owns that.
 */

import type { ComparisonResolution, ComparisonSlot, ComparisonSlotResolution } from "../../lib/savedScenarios";
import { SAVED_SCENARIO_OTHER_RUN_NOTICE, scenarioRunState } from "../../lib/savedScenarios";
import { namedWeights } from "../../lib/suitability";
import SectionCard from "../ui/SectionCard";

export interface SuitabilityScenarioComparePickerProps {
  selection: ComparisonResolution;
  /** The run on screen, for the per-slot compatibility check. */
  activeRunId: number | null;
  /** How many scenarios this browser holds, for the empty-state guidance. */
  savedCount: number;
  onClearSlot: (slot: ComparisonSlot) => void;
  onReset: () => void;
  /** Navigate to 후보지 심층 비교 with the pair. Only ever called when enabled. */
  onCompare: () => void;
}

export default function SuitabilityScenarioComparePicker({
  selection,
  activeRunId,
  savedCount,
  onClearSlot,
  onReset,
  onCompare,
}: SuitabilityScenarioComparePickerProps) {
  // A slot whose scenario belongs to another run is NOT comparable: its weights
  // were verified against a different frozen run, so the two sides would not be
  // measuring the same thing. It can reach this state through a shared link or a
  // run change, so the check is repeated here rather than trusted from the list.
  const incompatible = [selection.a, selection.b].some(
    (slot) => slot.scenario !== null && scenarioRunState(slot.scenario, activeRunId) === "OTHER_RUN",
  );
  const canCompare = selection.complete && !incompatible;
  const anySelected = selection.a.id !== null || selection.b.id !== null;

  return (
    <SectionCard
      title="⑤ 비교할 시나리오 선택"
      testId="scenario-compare-picker"
      className="wep-figma-card wep-numbered-card"
      // Figma 136:8684 puts "(선택 N/2개)" on its own line UNDER the ⑤ heading, not
      // beside it — at 20px the heading and the counter no longer share a line.
      description={
        <span className="tabular-nums" data-testid="scenario-compare-count">
          (선택 {selection.selectedCount}/2개)
        </span>
      }
      headerAside={
        <div className="flex items-center gap-1">
          {/* The name is an `aria-label`, NOT an `sr-only` child element.
              `.sr-only` is `position: absolute`, and neither this card nor the
              scrolling `.wep-panel` around it establishes a containing block, so
              such a span resolves against the initial containing block — it escapes
              the panel's `overflow-y: auto` and adds its offset to
              `documentElement.scrollHeight`, giving the whole page a vertical
              scrollbar (e2e/suitabilityDashboard.spec.ts asserts there is none).
              An attribute has no box and cannot escape anything. */}
          <button
            type="button"
            onClick={onReset}
            disabled={!anySelected}
            aria-label="비교 시나리오 선택 초기화"
            className="h-9 w-11 rounded-[12px] border border-hairline-strong bg-surface text-sm text-ink-muted hover:bg-surface-muted disabled:opacity-40"
            data-testid="scenario-compare-reset"
          >
            <span aria-hidden="true">↻</span>
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Slot resolution={selection.a} activeRunId={activeRunId} onClear={() => onClearSlot("A")} />
        <Slot resolution={selection.b} activeRunId={activeRunId} onClear={() => onClearSlot("B")} />
      </div>

      {savedCount === 0 && (
        <p className="mt-1 text-[11px] leading-snug text-ink-muted" data-testid="scenario-compare-no-saved">
          저장한 시나리오가 없습니다. ④ 시나리오 저장에서 먼저 저장해 주세요.
        </p>
      )}

      {incompatible && (
        <p className="mt-1 text-[11px] leading-snug text-warn" data-testid="scenario-compare-incompatible">
          {SAVED_SCENARIO_OTHER_RUN_NOTICE}
        </p>
      )}

      <button
        type="button"
        onClick={onCompare}
        disabled={!canCompare}
        // The Figma CTA: full width, 41px, r=12, navy. It is the one action that
        // leaves this screen, and it closes the numbered sequence.
        className="mt-4 flex h-[41px] w-full items-center justify-center gap-3 rounded-[12px] bg-primary text-sm font-bold text-primary-ink hover:bg-primary-hover disabled:opacity-40"
        data-testid="scenario-compare-cta"
      >
        두 시나리오 비교하기 <span aria-hidden="true">→</span>
      </button>

      {!canCompare && (
        <p className="mt-1 text-[10px] leading-snug text-ink-subtle" data-testid="scenario-compare-hint">
          서로 다른 시나리오 2개를 고르면 비교할 수 있습니다.
        </p>
      )}

      {/* The standing limit on what the next screen will show. Stated before the
          reader commits, not after: the comparison recomputes both sides from the
          saved WEIGHTS against the current run — it never replays a stored result. */}
      <p className="mt-1 text-[10px] leading-snug text-ink-subtle" data-testid="scenario-compare-method-note">
        비교 결과는 저장된 가중치를 현재 분석 실행에 다시 적용해 계산합니다. 저장 당시의 점수나 순위를
        그대로 보여주지 않습니다.
      </p>
    </SectionCard>
  );
}

function Slot({
  resolution,
  activeRunId,
  onClear,
}: {
  resolution: ComparisonSlotResolution;
  activeRunId: number | null;
  onClear: () => void;
}) {
  const { slot, scenario, state } = resolution;
  const otherRun = scenario !== null && scenarioRunState(scenario, activeRunId) === "OTHER_RUN";

  return (
    // FIGMA 136:8684: "A안" is a label ABOVE the slot, and the slot itself is a
    // r=14 card carrying a round letter avatar, the scenario name at title weight,
    // a clear control, and the weights line. The frame tints A blue and B pink;
    // that pairing is not in this palette and a second hue would have to mean
    // something, so both slots keep the one navy selection tint and are told apart
    // by the letter — the same rule the A/B/C chips follow.
    <div data-testid={`scenario-compare-slot-${slot.toLowerCase()}`}>
      <p className="text-[14.5px] font-bold text-ink">{slot}안</p>
      <div
        className={`mt-1.5 rounded-[14px] border px-[18px] py-4 ${
          state === "RESOLVED"
            ? "border-primary-border bg-primary-soft"
            : "border-hairline bg-surface"
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-ink"
            aria-hidden="true"
          >
            {slot}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink"
            data-testid="scenario-compare-slot-name"
          >
            {state === "RESOLVED" && scenario ? scenario.name : ""}
          </span>
          {state !== "EMPTY" && (
            <button
              type="button"
              onClick={onClear}
              // An attribute, not an `sr-only` box — see the reset button above.
              aria-label={`${slot}안 선택 해제`}
              className="flex-none rounded-control border border-hairline px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-surface"
              data-testid="scenario-compare-slot-clear"
            >
              <span aria-hidden="true">✕</span>
            </button>
          )}
        </div>

        {state === "EMPTY" && (
          <p className="mt-2 text-[11px] text-ink-subtle" data-testid="scenario-compare-slot-empty">
            저장목록에서 {slot}안을 선택해 주세요.
          </p>
        )}

        {/* An id that resolves to nothing is a REAL, nameable state — a link opened
            in a browser that never held the scenario. Saying so is the whole point;
            a blank slot here would read as "you have not chosen yet". */}
        {state === "MISSING" && (
          <p className="mt-2 text-[11px] leading-snug text-warn" data-testid="scenario-compare-slot-missing">
            이 링크가 가리키는 시나리오를 이 브라우저에서 찾을 수 없습니다. 시나리오는 저장한
            브라우저에만 남아 있습니다.
          </p>
        )}

        {state === "RESOLVED" && scenario && (
          <>
            <p
              className="mt-2 text-[12.5px] leading-snug text-ink-muted"
              data-testid="scenario-compare-slot-weights"
            >
              {namedWeights(scenario.weights)}
            </p>
            {otherRun && (
              <p className="mt-1 text-[11px] leading-snug text-warn" data-testid="scenario-compare-slot-other-run">
                {SAVED_SCENARIO_OTHER_RUN_NOTICE}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
