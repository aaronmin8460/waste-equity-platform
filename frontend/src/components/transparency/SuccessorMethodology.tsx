"use client";

/**
 * 후속 판정 기준 — the Successor-V3 screening methodology.
 *
 * ── WHERE EVERY VALUE COMES FROM ───────────────────────────────────────────────
 * `transparency/shared.ts` (`SUCCESSOR_*`), transcribed from
 * `docs/research/SUITABILITY_V3_FINAL_POLICY.md` and
 * `..._PHASE5_RUNTIME_VALIDATION.md` at `b93393a`, the commit both the release and
 * the preview branch resolve to. This file renders those constants and computes
 * nothing.
 *
 * ── THE ORDER IS THE ARGUMENT ──────────────────────────────────────────────────
 * Status first, components second, weights third, detail last.
 *
 * Status has to come first because the single most likely misreading of this screen
 * is that the numbers elsewhere in the product were produced by this model. They
 * were not: `/policies` reports the historical model, the default run is pinned to
 * it, and the successor run is reachable only by explicit run id. A reader who
 * scrolled straight into a weight table would have no way to know that.
 *
 * ── WHY THIS IS NOT A WALL OF PROSE ────────────────────────────────────────────
 * The lane brief allows Page 6 to be denser than the other screens, but not to
 * become an essay. So: a short status paragraph, four definition rows carrying the
 * components, one line of weight summary, and everything else — the seven scoring
 * rules, the four limitations, and the version identifiers — behind three
 * disclosures. Nothing is deleted to achieve that; it is ranked.
 *
 * The technical identifiers (`existing_burden`, `suitability-successor-policy-v1`,
 * …) are SECONDARY labels, never the primary name, and the version strings sit
 * behind a disclosure marked `[data-diagnostic]` like every other raw identifier on
 * this screen.
 */

import Accordion from "../ui/Accordion";
import {
  SUCCESSOR_COMPONENTS,
  SUCCESSOR_LIMITS,
  SUCCESSOR_RULES,
  SUCCESSOR_STATUS,
  SUCCESSOR_VERSIONS,
  SUCCESSOR_WEIGHT_NOTE,
  type GlobalDefinition,
} from "./shared";

function RuleList({ definitions, testId }: { definitions: readonly GlobalDefinition[]; testId: string }) {
  return (
    <dl className="flex flex-col gap-2.5" data-testid={testId}>
      {definitions.map((definition) => (
        <div key={definition.term}>
          <dt className="text-[13px] font-medium text-ink">{definition.term}</dt>
          <dd className="mt-0.5 text-[13px] leading-snug text-ink-muted">{definition.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function SuccessorMethodology() {
  return (
    <div className="flex flex-col gap-4">
      {/* 1. STATUS — read before anything else on this block. Not an alert: it is a
             standing description, not something the reader must act on. */}
      <div
        className="rounded-2xl border border-hairline bg-surface-muted p-4"
        data-testid="transparency-successor-status"
      >
        <h3 className="text-sm font-semibold text-ink">{SUCCESSOR_STATUS.title}</h3>
        <p className="mt-1 text-[13px] leading-snug text-ink-muted">{SUCCESSOR_STATUS.body}</p>
        {/* The coexistence rule. Kept on the FACE, not in a disclosure: "the stored
            historical results were not rewritten" is the claim a reader is most
            likely to get wrong, and a rule behind a summary cannot correct it. */}
        <p className="mt-2 text-[13px] leading-snug text-ink-muted">
          {SUCCESSOR_STATUS.coexistence}
        </p>
      </div>

      {/* 2. THE FOUR COMPONENTS — the citizen-facing name leads; the stored
             identifier follows as a quiet technical label. */}
      <div>
        <h3 className="text-sm font-semibold text-ink">평가하는 네 가지</h3>
        <dl className="mt-2 grid grid-cols-1 gap-2.5 lg:grid-cols-2" data-testid="transparency-successor-components">
          {SUCCESSOR_COMPONENTS.map((component) => (
            <div key={component.technical} data-testid={`successor-component-${component.technical}`}>
              <dt className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-medium text-ink">
                {component.name}
                <span className="text-[11px] font-semibold tabular-nums text-primary">
                  {component.weight}
                </span>
                <span className="text-[11px] font-normal text-ink-subtle" data-diagnostic>
                  {component.technical}
                </span>
              </dt>
              <dd className="mt-0.5 text-[13px] leading-snug text-ink-muted">{component.meaning}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* 3. WEIGHTS — the summary is visible; the reasoning is one line under it,
             because "these are a versioned choice, not an objective truth" is the
             part a reader must not miss. */}
      <div data-testid="transparency-successor-weights">
        <h3 className="text-sm font-semibold text-ink">가중치</h3>
        <p className="mt-1 text-[13px] text-ink">{SUCCESSOR_WEIGHT_NOTE.summary}</p>
        <p className="mt-1 text-[13px] leading-snug text-ink-muted">{SUCCESSOR_WEIGHT_NOTE.body}</p>
      </div>

      {/* 4. THE DETAIL — three disclosures, so the block above stays scannable. */}
      <Accordion label="자세한 산정 규칙" testId="transparency-successor-rules">
        <RuleList definitions={SUCCESSOR_RULES} testId="transparency-successor-rule-list" />
      </Accordion>

      <Accordion label="이 모형의 범위와 한계" testId="transparency-successor-limits">
        <RuleList definitions={SUCCESSOR_LIMITS} testId="transparency-successor-limit-list" />
      </Accordion>

      <Accordion
        label="기술 정보 (후속 모형 식별자)"
        testId="transparency-successor-technical"
      >
        <dl className="grid grid-cols-1 gap-2 text-[13px] text-ink-muted sm:grid-cols-2">
          <div>
            <dt className="inline font-medium text-ink">판정 기준 버전: </dt>
            <dd className="inline break-all" data-diagnostic>
              {SUCCESSOR_VERSIONS.policy}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-ink">계산 방식 버전: </dt>
            <dd className="inline break-all" data-diagnostic>
              {SUCCESSOR_VERSIONS.derivation}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-ink">평가 항목 모형: </dt>
            <dd className="inline break-all" data-diagnostic>
              {SUCCESSOR_VERSIONS.componentModel}
            </dd>
          </div>
          <div>
            {/* Named explicitly so the two model identities are legible side by side
                — this is the one that produced the figures on screen. */}
            <dt className="inline font-medium text-ink">현재 기본 모형: </dt>
            <dd className="inline break-all" data-diagnostic>
              {SUCCESSOR_VERSIONS.historicalComponentModel}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-ink">토지 분류 기준: </dt>
            <dd className="inline break-all" data-diagnostic>
              {SUCCESSOR_VERSIONS.landCoverRegistry}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium text-ink">분석 구역 버전: </dt>
            <dd className="inline break-all" data-diagnostic>
              {SUCCESSOR_VERSIONS.grid}
            </dd>
          </div>
          {/* The data-derived weighting method by its technical name. It is on
              `FORBIDDEN_PRIMARY_TOKENS`, so it appears HERE and only here — the
              weight note above describes it in plain Korean without naming it. */}
          <div>
            <dt className="inline font-medium text-ink">가중치 자동 산출 방식: </dt>
            <dd className="inline break-all" data-diagnostic>
              CRITIC — 진단 전용, 점수 계산·저장·제공에 사용하지 않음
            </dd>
          </div>
        </dl>
      </Accordion>
    </div>
  );
}
