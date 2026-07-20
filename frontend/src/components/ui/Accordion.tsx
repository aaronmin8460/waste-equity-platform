"use client";

/**
 * Accordion — a titled collapsible built on the native `<details>`/`<summary>`
 * disclosure, so no focus-management or keyboard code is introduced (the browser
 * already handles Enter/Space, expanded state, and AT announcement).
 *
 * Planned consumers (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §7, §9 Phases 3/5/6): the
 * collapsed cost-result sections, the landfill charts + exact-value fallback table,
 * and the transparency long tables and version identifiers.
 *
 * IMPORTANT — this is NOT `.mobile-collapsible`. That existing class force-opens its
 * body at md+ because the desktop sidebar must never hide an analytical option
 * behind a toggle. This component's contract is the opposite: it genuinely collapses
 * at every width, including desktop. Reusing the other class would silently make
 * every accordion permanently open on desktop, so `.wep-accordion` is a separate
 * class with no md+ override (see app/globals.css).
 *
 * Data-integrity note for consumers: a collapsed `<details>` is hidden from the
 * accessibility tree, so this must not be the only home for a `role="status"` live
 * region that needs to announce while collapsed (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md
 * §5 rule 9).
 */

import type { ReactNode } from "react";

export interface AccordionProps {
  /** Visible summary text. Always a real label — never icon-only. */
  label: string;
  /** Render expanded on first paint. */
  defaultOpen?: boolean;
  children: ReactNode;
  testId?: string;
}

export default function Accordion({
  label,
  defaultOpen = false,
  children,
  testId,
}: AccordionProps) {
  return (
    <details className="wep-accordion" open={defaultOpen} data-testid={testId}>
      <summary data-testid={testId ? `${testId}-summary` : undefined}>
        <span>{label}</span>
        {/* Decorative: the disclosure state is already conveyed by the native
            <details> semantics, so the chevron is hidden from AT. */}
        <span aria-hidden className="wep-accordion-chevron text-xs text-ink-subtle">
          ▾
        </span>
      </summary>
      <div className="wep-accordion-body">{children}</div>
    </details>
  );
}
