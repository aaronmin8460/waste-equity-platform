"use client";

/**
 * DashboardShell — the shared application chrome for every render branch.
 *
 * Every branch renders through this shell, which owns — exactly once —
 *   1. the desktop floor (below it nothing analytical is rendered at all),
 *   2. the global `TopNavigation` (the six 여기다 destinations), and
 *   3. the single `<main id="main-content" tabIndex={-1}>` skip-link target.
 * Branch-specific content (and each view's own `<h1>`) is passed as children, so
 * the decision of which branch mounts a `MapView` is unchanged: this shell never
 * mounts a map and never hides one with CSS.
 *
 * ── The desktop floor ────────────────────────────────────────────────────────────
 * 여기다 is a desktop-first, desktop-REQUIRED analytical product: every full-page
 * frame in the canonical Figma file is 1440px wide and the file contains no phone
 * composition for any of the six destinations. Below `DESKTOP_MIN_WIDTH` (1024) this
 * shell returns `NarrowScreenGate` INSTEAD OF `children`, so the dashboards are not
 * merely hidden — they are never mounted, and no `MapView`/WebGL context exists.
 * See components/ui/NarrowScreenGate.tsx for why unmounting (not `display: none`) is
 * the contract, and frontend/RESPONSIVE_LAYOUT.md for the single source of truth.
 *
 * The gate renders its own `<main id="main-content" tabIndex={-1}>` and its own single
 * `<h1>`, so the skip link in app/layout.tsx resolves and the "one h1 per view" rule
 * holds at every width.
 *
 * ── The retired phone stack ──────────────────────────────────────────────────────
 * Until this cleanup the shell carried a second, `md`-scoped layout: below 768px the
 * root was a content-sized column, `<main>` stacked instead of flowing as a row, and
 * `.map-pane` took a definite `60vh`/`60dvh` so the map survived the stack. That
 * produced left panel → map → right panel as a multi-screen phone scroll, which was
 * never in Figma. With the floor above, every one of those branches was unreachable,
 * so the `md:` prefixes are gone rather than left as dead alternatives: the shell now
 * describes exactly one layout, the desktop one.
 *
 * ── The retired sub-view bar ─────────────────────────────────────────────────────
 * Until the 여기다 redesign this shell also rendered a `SegmentedControl` row for
 * the three suitability sub-views. Three of the six top-level destinations ARE
 * those sub-views now, so that row was a second control writing the same state
 * (docs/YEOGIDA_UI_REDESIGN_SPEC.md §2.1). It is gone; the `view` URL parameter,
 * its decoder/encoder, and the page's `suitabilityView` state are untouched.
 *
 * ── The map-height chain (the main regression risk) ──────────────────────────────
 * `.map-pane` sizes the map with `height: 100%`, which needs a DEFINITE parent
 * height.
 *
 *   - `variant="map"`: this shell root is the fixed-height flex COLUMN
 *     (`h-screen h-dvh`), the header is an ordinary auto-height first child, and
 *     `<main>` is `flex-1 min-h-0` — a flex item whose used height is definite, so
 *     `.map-pane`'s `height: 100%` still resolves. `min-h-0` is load-bearing:
 *     without it the default `min-height: auto` would let content push the row past
 *     the viewport bottom.
 *   - The static `vh` fallback classes stay BEFORE their `dvh` counterparts
 *     (`h-screen h-dvh`, `min-h-screen min-h-dvh`) and live on this root together,
 *     so the `@supports` overrides in globals.css — which match on the two-class
 *     selectors `.h-screen.h-dvh` and `.min-h-screen.min-h-dvh` — keep applying to
 *     the element that owns the height. `.map-pane` itself is untouched.
 *   - The header is deliberately NOT `position: sticky` or `fixed`; either would
 *     remove it from the column's height accounting.
 *
 * `variant="page"` is the map-free layout: the root only sets a minimum height and
 * `<main>` is a plain `flex-1`, so those dashboards scroll normally.
 */

import type { ReactNode } from "react";

import type { NavDestination } from "../lib/glossary";
import NarrowScreenGate, { useIsDesktopViewport } from "./ui/NarrowScreenGate";
import TopNavigation from "./ui/TopNavigation";

export interface DashboardShellProps {
  /** The destination currently rendered — drives the nav's active state. */
  destination: NavDestination;
  /** Called with the destination the reader picked (carries its `mode`/`view`). */
  onNavigate: (destination: NavDestination) => void;
  /**
   * `"map"` = the fixed-height row that hosts the sidebar + `.map-pane`.
   * `"page"` = a normally-scrolling full-width dashboard with no map.
   */
  variant: "map" | "page";
  children: ReactNode;
}

export default function DashboardShell({
  destination,
  onNavigate,
  variant,
  children,
}: DashboardShellProps) {
  const isDesktop = useIsDesktopViewport();

  // Below the desktop floor the analytical application is not rendered at all —
  // `children` never mount, so no map, no WebGL context, and no tile requests exist.
  if (!isDesktop) {
    return <NarrowScreenGate />;
  }

  return (
    <div
      data-testid="app-shell"
      className={
        variant === "map"
          ? // Fallback-first ordering (`h-screen` before `h-dvh`) is required: `dvh`
            // is not self-falling-back, so an engine without it drops the whole
            // declaration and the row would have no definite height for `.map-pane`
            // to resolve against.
            "flex h-screen h-dvh flex-col bg-canvas"
          : "flex min-h-screen min-h-dvh flex-col bg-canvas"
      }
    >
      <TopNavigation active={destination} onNavigate={onNavigate} />

      {/* The single skip-link target for every view. `tabIndex={-1}` is
          load-bearing: activating the skip link must move focus here
          (e2e/accessibility.spec.ts). */}
      <main
        id="main-content"
        tabIndex={-1}
        className={
          variant === "map"
            ? // The flex row that fills the remaining height — `min-h-0` lets it
              // shrink so the map pane ends exactly at the viewport bottom.
              "flex min-h-0 flex-1 flex-row"
            : "flex-1"
        }
      >
        {children}
      </main>
    </div>
  );
}
