"use client";

/**
 * TopNavigation — the single global navigation for the six citizen-facing
 * destinations of 여기다.
 *
 * It is rendered exactly once, by `DashboardShell`, above every render branch, so
 * the nav occupies the same place in every area.
 *
 * ── Six visible destinations over four analytical modes ──────────────────────────
 * The application still has four modes and a three-valued suitability sub-view.
 * `lib/glossary.NAV_DESTINATIONS` is the projection between the two, so this
 * component never owns routing knowledge and the redesign needs no new backend
 * mode and no new URL-state version. Selecting a destination hands the caller the
 * whole `NavDestination`, which carries the `(mode, view)` pair to apply.
 *
 * The old suitability `SegmentedControl` sub-bar is gone: three of the six
 * destinations ARE the three sub-views, and two controls writing one piece of
 * state is the duplication docs/YEOGIDA_UI_REDESIGN_SPEC.md §2.1 forbids.
 *
 * ── Contracts deliberately preserved ─────────────────────────────────────────────
 *   - native `<button>`s carrying `aria-pressed` (NOT `role="tab"`/`radiogroup`,
 *     which would promise roving arrow-key focus these buttons do not implement);
 *   - `data-testid="mode-switch"` on a `role="group"` named by
 *     `aria-labelledby="mode-switch-label"`;
 *   - the pre-existing per-destination testids (see the note in glossary.ts);
 *   - each button's `textContent` is EXACTLY the destination label — the
 *     terminology audit compares with `.toBe`. The icon is an `aria-hidden` SVG
 *     with NO text nodes, so it contributes nothing to `textContent` and nothing
 *     to the accessible name, which stays the visible Korean label.
 *   - this component renders NO heading. The area `<h1>` belongs to each view, and
 *     `app/accessibility.test.tsx` asserts exactly one `<h1>` per view.
 *
 * ── The brand block ──────────────────────────────────────────────────────────────
 * The bar is [brand] … [primary navigation]. Three constraints shape it:
 *   - The product name is a `<span>`, NOT a heading. It renders above every view,
 *     so a heading here would become a second (and, in document order, the first)
 *     `h1` on every screen.
 *   - It sits OUTSIDE `role="group"`/`data-testid="mode-switch"`, so it never joins
 *     the navigation's accessible group or its destination count.
 *   - The mark is a decorative `aria-hidden` SVG, beside the buttons and never
 *     inside one.
 *
 * No utility action is rendered. Every real export the product has is a
 * page-level control with its own context; lifting one into the bar would either
 * duplicate it or add a decorative button that looks like an export and does
 * nothing.
 */

import type { NavDestination, NavDestinationKey } from "../../lib/glossary";
import { NAV_DESTINATIONS } from "../../lib/glossary";

/** The citizen-facing product identity (spec §1). */
export const BRAND_NAME = "여기다";
export const BRAND_SUBTITLE = "쓰레기 매립지 입지 추천 플랫폼";

/**
 * The official visual motif: a target / crosshair. Concentric rings, four ticks,
 * and a filled centre — "this is the spot", which is what the product recommends.
 *
 * Authored inline from simple circles and lines because the Figma source was not
 * reachable (docs/YEOGIDA_UI_UNSUPPORTED_REQUIREMENTS.md U1); the spec explicitly
 * authorises this fallback. It carries no `<title>`, so it adds no text to the
 * brand's accessible name.
 */
function BrandMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      focusable="false"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.25" />
      <circle cx="12" cy="12" r="3.75" />
      <path d="M12 1.75v3.25M12 19v3.25M1.75 12H5M19 12h3.25" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * One small meaningful glyph per destination. Every icon is `aria-hidden` and
 * text-free: the visible Korean label is the button's accessible name, and adding
 * a `<title>` here would both duplicate it and break the exact-`textContent`
 * terminology audit.
 */
function DestinationIcon({ destination }: { destination: NavDestinationKey }) {
  const paths: Record<NavDestinationKey, React.ReactNode> = {
    // Bar chart — regional indicators compared side by side.
    "regional-indicators": (
      <>
        <path d="M3.5 20.5h17" />
        <path d="M7.5 20.5V13M12 20.5V6.5M16.5 20.5v-5" />
      </>
    ),
    // Material falling into a container — generation flowing to treatment.
    "waste-treatment": (
      <>
        <path d="M12 3v7.5" />
        <path d="m8.75 7.5 3.25 3.25L15.25 7.5" />
        <path d="M3.75 13.5h16.5V19a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2z" />
      </>
    ),
    // The brand crosshair — siting a candidate.
    "candidate-analysis": (
      <>
        <circle cx="12" cy="12" r="7.25" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      </>
    ),
    // Candidate grid under a magnifier — deep analysis of the 500 m cells.
    "candidate-deep-analysis": (
      <>
        <path d="M3.5 4.5h6v6h-6zM14.5 4.5h6v6h-6zM3.5 14.5h6v6h-6z" />
        <circle cx="16.75" cy="16.75" r="2.75" />
        <path d="m18.9 18.9 1.85 1.85" />
      </>
    ),
    // Two ranked lists split by a rule — A안 against B안.
    "candidate-deep-comparison": (
      <>
        <path d="M12 3.5v17" />
        <path d="M3.5 8h5M3.5 12h5M3.5 16h5" />
        <path d="M15.5 8h5M15.5 12h5M15.5 16h5" />
      </>
    ),
    // A source document.
    "data-sources": (
      <>
        <path d="M6.5 3h7l4.5 4.5V20a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
        <path d="M13.25 3.25V8h4.75" />
        <path d="M9 13h6M9 16.5h4.5" />
      </>
    ),
  };

  return (
    <svg
      className="wep-nav-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden
    >
      {paths[destination]}
    </svg>
  );
}

export interface TopNavigationProps {
  /** The destination currently rendered. */
  active: NavDestination;
  /** Called with the newly selected destination (carries its `mode` and `view`). */
  onNavigate: (destination: NavDestination) => void;
}

export default function TopNavigation({ active, onNavigate }: TopNavigationProps) {
  return (
    <header className="wep-appbar" data-testid="top-navigation">
      <div className="wep-appbar-row mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8">
        <div className="wep-brand" data-testid="app-brand">
          {/* aria-hidden: the product name beside it is the accessible text, so
              the mark adds no duplicate announcement. */}
          <span className="wep-brand-mark" aria-hidden>
            <BrandMark />
          </span>
          <span className="wep-brand-text">
            {/* A span, never a heading — every view owns its own single <h1>. */}
            <span className="wep-brand-name">{BRAND_NAME}</span>
            <span className="wep-brand-sub">{BRAND_SUBTITLE}</span>
          </span>
        </div>

        {/* The group's accessible name. Visually hidden but kept in the a11y tree
            and still referenced by aria-labelledby. Deliberately a <span>, not a
            heading: this nav renders above every branch's own <h1>. */}
        <span id="mode-switch-label" className="sr-only">
          분석 영역 선택
        </span>
        {/* `.wep-nav-track` stretches each tab to the full bar height so the active
            tab's indicator is flush with the bar's bottom border. It NEVER wraps:
            at desktop the six labels fit one row down to 1024px on compressed
            spacing, and at phone widths the track itself scrolls horizontally so
            the PAGE never gains a horizontal scrollbar. */}
        <div
          className="wep-nav-track"
          role="group"
          aria-labelledby="mode-switch-label"
          data-testid="mode-switch"
        >
          {NAV_DESTINATIONS.map((destination) => (
            <button
              key={destination.key}
              type="button"
              aria-pressed={destination.key === active.key}
              onClick={() => onNavigate(destination)}
              className="wep-nav-tab"
              data-testid={destination.testId}
              data-destination={destination.key}
            >
              <DestinationIcon destination={destination.key} />
              <span className="wep-nav-tab-label">{destination.label}</span>
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
