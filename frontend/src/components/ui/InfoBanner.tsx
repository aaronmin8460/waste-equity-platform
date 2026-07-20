"use client";

/**
 * InfoBanner — the single banner primitive for caveats, warnings, and errors.
 *
 * Why it exists: the Phase 0 audit measured 60 hand-rolled `amber-*` utility
 * occurrences across 8 components, using SEVEN different amber shades for one
 * semantic role, and serving five different jobs (genuine caveat, routine missing
 * value, form validation, an actual error, and a map status category). When
 * everything is styled as a warning, the mandatory legal/analytical caveats stop
 * being read. This primitive rations that down to four semantic tones.
 *
 * Planned consumers (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §7 and §9): the cost setup
 * notice and exclusion list (Phase 2/3), the landfill metropolitan-only limitation
 * (Phase 5), and the transparency "what is missing" summary (Phase 6). Phase 1
 * establishes it without migrating existing call sites — the redesign plan
 * deliberately converts only shared global chrome in this phase.
 *
 * Accessibility:
 *   - Severity is carried by a TEXT label ("알림"/"주의"/"오류"/"완료"), never by
 *     color alone.
 *   - `role` is opt-in. A standing disclaimer must NOT be `role="alert"` — that
 *     would interrupt a screen reader on every render. Pass `role="alert"` only for
 *     a genuine, actionable error.
 */

import type { ReactNode } from "react";

export type InfoBannerTone = "info" | "warning" | "error" | "success";

/** The visible severity word, so tone never depends on color alone. */
const TONE_LABELS: Record<InfoBannerTone, string> = {
  info: "알림",
  warning: "주의",
  error: "오류",
  success: "완료",
};

export interface InfoBannerProps {
  tone: InfoBannerTone;
  /** Optional bold headline shown above the body. */
  title?: string;
  children: ReactNode;
  /**
   * Opt-in live-region role. Use `"alert"` only for genuine errors the user must
   * act on; leave undefined for standing disclaimers.
   */
  role?: "alert" | "status";
  testId?: string;
}

export default function InfoBanner({ tone, title, children, role, testId }: InfoBannerProps) {
  return (
    <div className={`wep-banner wep-banner-${tone}`} role={role} data-testid={testId}>
      <p className="wep-banner-label" data-testid={testId ? `${testId}-tone` : undefined}>
        {TONE_LABELS[tone]}
        {title ? ` · ${title}` : ""}
      </p>
      <div className="mt-1 text-ink-muted">{children}</div>
    </div>
  );
}
