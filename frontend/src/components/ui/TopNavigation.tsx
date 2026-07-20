"use client";

/**
 * TopNavigation — the single global navigation for the four citizen-facing areas.
 *
 * Phase 1 of the desktop redesign replaces the old `ModeSwitch`, which was rendered
 * FOUR separate times (inside the equity sidebar for the two map modes, and as a
 * full-width row above each of the three map-free dashboards). That made the nav's
 * structural position — and its wrapping behaviour inside the 384px sidebar — differ
 * per area. This component is rendered exactly once, by `DashboardShell`, above every
 * render branch, so the nav occupies the same place in all four areas.
 *
 * Contracts deliberately preserved from the old ModeSwitch (asserted by
 * `app/accessibility.test.tsx`, `app/terminology.audit.test.tsx`,
 * `e2e/accessibility.spec.ts` and `e2e/citizenFlows.spec.ts`):
 *   - native `<button>`s carrying `aria-pressed` (NOT `role="tab"`/`radiogroup`,
 *     which would promise roving arrow-key focus these buttons do not implement);
 *   - `data-testid="mode-switch"` on a `role="group"` named by
 *     `aria-labelledby="mode-switch-label"`;
 *   - `mode-equity` / `mode-suitability` / `mode-flow` / `mode-transparency` testids;
 *   - each button's `textContent` is EXACTLY `MODE_LABELS[key]` — the terminology
 *     audit compares with `.toBe`, so an icon, badge, counter, or any extra
 *     character inside a button breaks it.
 *
 * What changed: the visible "무엇을 볼까요?" label is gone. Its accessibility job was
 * real (it is the group's accessible name), so the label element survives as an
 * `sr-only` span with the same id — still in the a11y tree, no longer visual noise.
 *
 * This component intentionally renders NO heading. The product/area `<h1>` belongs to
 * each view (the equity sidebar, `LandfillDashboard`, `FacilityCostDashboard`, and the
 * transparency branch), and `app/accessibility.test.tsx` asserts exactly one `<h1>`
 * per view.
 */

import type { DashboardArea } from "../../lib/glossary";
import { MODE_LABELS } from "../../lib/glossary";

const NAV_ITEMS: readonly { key: DashboardArea; testId: string }[] = [
  { key: "equity", testId: "mode-equity" },
  { key: "suitability", testId: "mode-suitability" },
  { key: "flow", testId: "mode-flow" },
  { key: "transparency", testId: "mode-transparency" },
] as const;

export interface TopNavigationProps {
  /** The active dashboard area. */
  mode: DashboardArea;
  /** Called with the newly selected area. */
  onChange: (mode: DashboardArea) => void;
}

export default function TopNavigation({ mode, onChange }: TopNavigationProps) {
  return (
    <header className="wep-appbar" data-testid="top-navigation">
      <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8">
        {/* The group's accessible name. Visually hidden (the old visible
            "무엇을 볼까요?" was noise that interrupted each page title), but kept in
            the a11y tree and still referenced by aria-labelledby. Deliberately a
            <span>, not a heading: this nav renders above every branch, including
            those whose own <h1> follows it. */}
        <span id="mode-switch-label" className="sr-only">
          분석 영역 선택
        </span>
        {/* flex-wrap is retained for phone widths (four Korean labels do not fit on
            one line at 390px). At the desktop targets (1280/1440) the full-width bar
            leaves ample room, so the nav never wraps there — the sidebar-width
            wrapping documented in the Phase 0 audit is fixed by the relocation. */}
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-labelledby="mode-switch-label"
          data-testid="mode-switch"
        >
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={mode === item.key}
              onClick={() => onChange(item.key)}
              className="wep-nav-tab"
              data-testid={item.testId}
            >
              {MODE_LABELS[item.key]}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
