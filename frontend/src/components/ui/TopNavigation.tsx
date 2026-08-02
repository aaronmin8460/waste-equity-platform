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
 * This component intentionally renders NO heading. The area `<h1>` belongs to each
 * view (the map sidebar, `LandfillDashboard`, `FacilityCostDashboard`, and the
 * transparency branch), and `app/accessibility.test.tsx` asserts exactly one `<h1>`
 * per view.
 *
 * ── The brand block (civic dashboard refresh) ────────────────────────────────────
 * The bar is now [brand] … [primary navigation]. Three constraints shape it:
 *   - The product name is a `<span>`, NOT a heading. It renders above every view,
 *     so a heading here would become a second (and, in document order, the first)
 *     `h1` on every screen.
 *   - It sits OUTSIDE `role="group"`/`data-testid="mode-switch"`, so it never joins
 *     the navigation's accessible group or its four-control count.
 *   - The mark is a decorative `aria-hidden` SVG. It is deliberately beside the
 *     buttons and never inside one: the terminology audit compares each button's
 *     `textContent` with `.toBe`, so any icon or extra character inside a button
 *     would break it.
 * The name is the product's established wording (it was the map sidebar's `<h1>`
 * before this refresh); moving it here is what let that `<h1>` become the area
 * title, matching how the three map-free areas already title themselves. See
 * docs/ui-refresh/regression-contract.md §10.
 *
 * No utility action is rendered. Every real export the product has (CSV, the
 * shareable URL, the print report) is a page-level control with its own context;
 * lifting one into the bar would either duplicate it or, worse, add a decorative
 * button that looks like an export and does nothing.
 */

import type { DashboardArea } from "../../lib/glossary";
import { MODE_LABELS } from "../../lib/glossary";

const NAV_ITEMS: readonly { key: DashboardArea; testId: string }[] = [
  { key: "equity", testId: "mode-equity" },
  { key: "suitability", testId: "mode-suitability" },
  { key: "flow", testId: "mode-flow" },
  { key: "transparency", testId: "mode-transparency" },
] as const;

/** The established product name and its English form (layout.tsx page title). */
export const BRAND_NAME = "우리 동네 폐기물 지도";
export const BRAND_SUBTITLE = "Waste Equity Platform";

export interface TopNavigationProps {
  /** The active dashboard area. */
  mode: DashboardArea;
  /** Called with the newly selected area. */
  onChange: (mode: DashboardArea) => void;
}

export default function TopNavigation({ mode, onChange }: TopNavigationProps) {
  return (
    <header className="wep-appbar" data-testid="top-navigation">
      <div className="wep-appbar-row mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8">
        <div className="wep-brand" data-testid="app-brand">
          {/* Decorative stacked-layers mark. aria-hidden: the product name beside it
              is the accessible text, so the mark adds no duplicate announcement. */}
          <span className="wep-brand-mark" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" focusable="false" aria-hidden>
              <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" fill="currentColor" />
              <path
                d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="wep-brand-text">
            {/* A span, never a heading — every view owns its own single <h1>. */}
            <span className="wep-brand-name">{BRAND_NAME}</span>
            <span className="wep-brand-sub">{BRAND_SUBTITLE}</span>
          </span>
        </div>

        {/* The group's accessible name. Visually hidden (the old visible
            "무엇을 볼까요?" was noise that interrupted each page title), but kept in
            the a11y tree and still referenced by aria-labelledby. Deliberately a
            <span>, not a heading: this nav renders above every branch, including
            those whose own <h1> follows it. */}
        <span id="mode-switch-label" className="sr-only">
          분석 영역 선택
        </span>
        {/* `.wep-nav-track` stretches each tab to the full bar height so the active
            tab's indicator is flush with the bar's bottom border, and keeps
            flex-wrap for phone widths (four Korean labels do not fit on one line at
            390px). At the desktop targets the full-width bar leaves ample room, so
            the nav never wraps there. */}
        <div
          className="wep-nav-track flex-wrap"
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
