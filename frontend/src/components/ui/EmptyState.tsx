"use client";

/**
 * EmptyState — a plain-text "nothing to show here, and why" block.
 *
 * Planned consumers (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §7, §9 Phases 2/3/5/6): the
 * "no calculable regions" cost state, an empty ranking, a run with no candidates, and
 * the landfill no-official-data state — all of which are ad-hoc `<p>`s today.
 *
 * DATA-INTEGRITY CONTRACT (repo AGENTS.md; redesign plan §5 rules 1–3): an empty
 * state means "no data was served", which is NOT the same as "the measured value is
 * zero". The description must say why data is absent and must never be phrased as a
 * quantity. This component renders only the strings it is given and never
 * substitutes a `0`, a placeholder figure, or an example value.
 */

import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** Short plain-Korean statement of what is absent. */
  title: string;
  /** Why it is absent — e.g. the served availability reason. */
  description?: ReactNode;
  /** Optional recovery affordance (e.g. a retry button). */
  action?: ReactNode;
  testId?: string;
}

export default function EmptyState({ title, description, action, testId }: EmptyStateProps) {
  return (
    <div
      className="rounded-card border border-hairline bg-surface-muted p-4 text-center"
      data-testid={testId}
    >
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
