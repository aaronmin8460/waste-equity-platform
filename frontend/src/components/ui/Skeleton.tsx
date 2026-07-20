"use client";

/**
 * Skeleton — a purely decorative loading placeholder.
 *
 * Planned consumers (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §7, §9 Phases 3/4): the
 * cost results region while a calculation is in flight, and the equity control
 * column + map region during the ten-request cold start (today the whole cold start
 * is a single centred sentence).
 *
 * ACCESSIBILITY CONTRACT: this is `aria-hidden`, so it announces nothing. The
 * meaningful loading state MUST stay in a separate `role="status"` live region — a
 * skeleton is a visual affordance, not an announcement. Consumers therefore render
 * both: this for sighted users, and the existing status text for AT.
 *
 * It renders no numbers and no fabricated content — only neutral bars — so it can
 * never be mistaken for official data (repo AGENTS.md).
 */

export interface SkeletonProps {
  /** Number of placeholder bars. */
  lines?: number;
  /** Extra utilities for sizing in a specific slot. */
  className?: string;
  testId?: string;
}

export default function Skeleton({ lines = 1, className, testId }: SkeletonProps) {
  return (
    <div aria-hidden className={className} data-testid={testId}>
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className={`wep-skeleton h-4 ${index === 0 ? "" : "mt-2"} ${
            // A slightly shorter last bar reads as text rather than a solid block.
            lines > 1 && index === lines - 1 ? "w-2/3" : "w-full"
          }`.trim()}
        />
      ))}
    </div>
  );
}
