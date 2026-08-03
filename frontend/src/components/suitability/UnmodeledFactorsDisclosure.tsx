"use client";

/**
 * "현재 분석에 포함되지 않은 항목" — the Phase 0 disclosure of the physical /
 * environmental / legal conditions the current regional screening does NOT yet
 * evaluate. Moved out of `app/page.tsx` unchanged.
 *
 * A compact, keyboard-reachable native `<details>`; the title and the core
 * limitation stay discoverable while collapsed. It lists the shared
 * `UNMODELED_SUITABILITY_FACTORS` and states that a missing value is NEVER treated
 * as 0 or as a safe condition — it shows no fake value, placeholder score, or
 * completion percentage. Rendered in the score-view methodology block AND inside
 * the selected-candidate summary, so a reader inspecting one candidate sees the
 * screening's limits without leaving the panel.
 *
 * This is a DISCLOSURE OF ABSENCE, never the only home for a required statement:
 * the screening disclaimer itself is standing, uncollapsed content above it
 * (`SuitabilityScreeningNotice`).
 */

import {
  UNMODELED_SUITABILITY_FACTORS,
  UNMODELED_SUITABILITY_NOTE,
  UNMODELED_SUITABILITY_TITLE,
} from "../../lib/glossary";

export default function UnmodeledFactorsDisclosure({ testId }: { testId: string }) {
  return (
    <details
      className="rounded-card border border-hairline bg-surface-muted p-3 text-xs text-ink-muted"
      data-testid={testId}
    >
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        {UNMODELED_SUITABILITY_TITLE}
      </summary>
      <ul className="mt-2 list-disc space-y-0.5 pl-4" data-testid={`${testId}-list`}>
        {UNMODELED_SUITABILITY_FACTORS.map((factor) => (
          <li key={factor}>{factor}</li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-ink-subtle">{UNMODELED_SUITABILITY_NOTE}</p>
    </details>
  );
}
