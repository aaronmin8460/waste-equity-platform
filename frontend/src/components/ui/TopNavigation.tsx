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
 *
 * ── PHASE 1: the icons are now the EXACT Figma vectors ───────────────────────────
 * Every glyph in this bar used to be inline `<path>` data drawn by hand, because
 * the Figma file was unreachable when the 여기다 redesign shipped. All seven are now
 * the real exports — `logo-target-01` for the brand and one per destination —
 * rendered through `ui/FigmaIcon`, whose registry is closed so a name that was never
 * exported from Figma is a type error rather than a silent lookalike. The mapping
 * below is not inferred from the labels: Phase 0 read it from layer visibility
 * inside each `Nav Button` instance, and it is identical across all five full-page
 * frames (docs/figma-redesign/FIGMA_ASSET_INVENTORY.md).
 *
 * The other Figma change here is the ACTIVE STATE. It was a 2px bottom indicator on
 * a full-bleed tab; frame 74:2000 instead puts the six tabs inside a rounded track
 * and marks the active one with a white pill. The obsolete indicator is gone rather
 * than kept alongside — see `.wep-nav-tab` in globals.css for how the state stays
 * more than colour. The 1x20 rule before 데이터·출처 is likewise from the design (the
 * `page-1 기술요청` annotation asks for it by name); it is a decorative `<span>`
 * OUTSIDE every button, so the group still holds exactly six controls and no
 * button's `textContent` gains a character.
 */

import { Fragment } from "react";

import type { NavDestination, NavDestinationKey } from "../../lib/glossary";
import { NAV_DESTINATIONS } from "../../lib/glossary";
import FigmaIcon, { type FigmaIconName } from "./FigmaIcon";

/** The citizen-facing product identity (spec §1). */
export const BRAND_NAME = "여기다";
export const BRAND_SUBTITLE = "쓰레기 매립지 입지 추천 플랫폼";

/**
 * Destination → its exact Figma vector.
 *
 * Read from layer visibility inside the `Nav Button` instances, NOT guessed from
 * the labels, and identical across all five full-page frames. `Record<…>` over the
 * closed `NavDestinationKey`/`FigmaIconName` unions means a new destination cannot
 * be added without choosing a real exported asset for it.
 */
const DESTINATION_ICONS: Record<NavDestinationKey, FigmaIconName> = {
  "regional-indicators": "nav-region-marker-02",
  "waste-treatment": "nav-waste-barchart",
  "candidate-analysis": "nav-candidate-file-02",
  "candidate-deep-analysis": "nav-analysis-audio-settings-01",
  "candidate-deep-comparison": "nav-compare-column-vertical-01",
  "data-sources": "nav-data-server-02",
};

/**
 * The destination the Figma header separates from the other five with a vertical
 * rule. 데이터·출처 is the reference surface rather than a fifth analysis, which is
 * what the rule says visually.
 */
const DIVIDED_DESTINATION: NavDestinationKey = "data-sources";

export interface TopNavigationProps {
  /** The destination currently rendered. */
  active: NavDestination;
  /** Called with the newly selected destination (carries its `mode` and `view`). */
  onNavigate: (destination: NavDestination) => void;
}

export default function TopNavigation({ active, onNavigate }: TopNavigationProps) {
  return (
    <header className="wep-appbar" data-testid="top-navigation">
      {/* Horizontal padding comes from `.wep-appbar-row` (globals.css), which owns
          the Figma 28px at desktop; the utilities here only centre the row. */}
      <div className="wep-appbar-row mx-auto w-full max-w-screen-2xl">
        <div className="wep-brand" data-testid="app-brand">
          {/* aria-hidden: the product name beside it is the accessible text, so
              the mark adds no duplicate announcement. FigmaIcon is decorative by
              default, so this wrapper's aria-hidden is belt-and-braces rather than
              the only thing keeping the glyph out of the accessible name. */}
          <span className="wep-brand-mark" aria-hidden>
            <FigmaIcon name="logo-target-01" />
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
        {/* `.wep-nav-track` is the Figma pill track (74:2000) the six tabs sit
            inside. It NEVER wraps: the six labels fit one row down to the 1024px
            desktop floor on compressed spacing, which is the narrowest width this
            bar renders at (below it the shell renders ui/NarrowScreenGate instead).
            The track keeps `overflow-x: auto` as the overflow valve — if the labels
            ever did outgrow 1024, the overflow stays inside the nav and the PAGE
            still never gains a horizontal scrollbar. */}
        <div
          className="wep-nav-track"
          role="group"
          aria-labelledby="mode-switch-label"
          data-testid="mode-switch"
        >
          {NAV_DESTINATIONS.map((destination) => (
            <Fragment key={destination.key}>
              {/* Decorative and OUTSIDE the button: a rule inside one would join
                  that button's textContent, which the terminology audit compares
                  with `.toBe`. */}
              {destination.key === DIVIDED_DESTINATION && (
                <span className="wep-nav-divider" aria-hidden data-testid="nav-divider" />
              )}
              <button
                type="button"
                aria-pressed={destination.key === active.key}
                onClick={() => onNavigate(destination)}
                className="wep-nav-tab"
                data-testid={destination.testId}
                data-destination={destination.key}
              >
                <FigmaIcon name={DESTINATION_ICONS[destination.key]} className="wep-nav-icon" />
                <span className="wep-nav-tab-label">{destination.label}</span>
              </button>
            </Fragment>
          ))}
        </div>
      </div>
    </header>
  );
}
