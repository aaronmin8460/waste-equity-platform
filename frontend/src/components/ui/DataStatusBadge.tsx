"use client";

/**
 * DataStatusBadge — states how a displayed value came to be: reported by the
 * official source, derived by this platform, served-but-caveated, missing, or
 * deliberately excluded.
 *
 * This is the visual half of a data-integrity rule, not decoration (repo
 * AGENTS.md; docs/ui-refresh/design-tokens.md):
 *
 *   1. The label is always TEXT (`DATA_STATUS_META`), so provenance survives a
 *      grayscale render, a color deficiency, and a screen reader. Color is the
 *      supporting signal, never the only one.
 *   2. `missing` uses the neutral --color-no-data gray — never a pale step of the
 *      analytical ramp, which would read as "a very low value" rather than "no
 *      value was served", and never amber, which means "be careful with this
 *      number" and presupposes a number exists.
 *   3. A `missing` badge renders no value, ever. The optional `reason` is the
 *      SERVED explanation; this component never invents one, never substitutes a
 *      0, and never rounds or reformats anything.
 *   4. `derived` exists so a computed figure is never mistaken for an official
 *      published statistic.
 *
 * It is inline content, not a live region: provenance is stable for a given value,
 * so announcing it on every render would be noise. When a value's availability
 * changes in response to a user action, the surrounding view's existing
 * `role="status"` region is the place that announces it.
 */

import type { DataStatus } from "../../lib/glossary";
import { DATA_STATUS_META } from "../../lib/glossary";

export interface DataStatusBadgeProps {
  status: DataStatus;
  /**
   * Overrides the standard label. Use only when the served wording is more
   * specific than the generic term (e.g. "공식 인구 미확정" for a missing value);
   * pass the string the backend served, never an invented one.
   */
  label?: string;
  /** Longer served explanation, rendered as the badge's title/tooltip text. */
  reason?: string;
  testId?: string;
}

export default function DataStatusBadge({ status, label, reason, testId }: DataStatusBadgeProps) {
  const meta = DATA_STATUS_META[status];
  return (
    <span
      className={`wep-badge wep-badge-${status}`}
      title={reason ?? meta.detail}
      data-status={status}
      data-testid={testId}
    >
      {label ?? meta.primary}
    </span>
  );
}
