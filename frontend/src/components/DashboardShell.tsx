"use client";

/**
 * DashboardShell — the shared application chrome for every render branch.
 *
 * Every branch renders through this shell, which owns — exactly once —
 *   1. the global `TopNavigation` (the six 여기다 destinations), and
 *   2. the single `<main id="main-content" tabIndex={-1}>` skip-link target.
 * Branch-specific content (and each view's own `<h1>`) is passed as children, so
 * the decision of which branch mounts a `MapView` is unchanged: this shell never
 * mounts a map and never hides one with CSS.
 *
 * ── The retired sub-view bar ─────────────────────────────────────────────────────
 * Until the 여기다 redesign this shell also rendered a `SegmentedControl` row for
 * the three suitability sub-views. Three of the six top-level destinations ARE
 * those sub-views now, so that row was a second control writing the same state
 * (docs/YEOGIDA_UI_REDESIGN_SPEC.md §2.1). It is gone; the `view` URL parameter,
 * its decoder/encoder, and the page's `suitabilityView` state are untouched.
 *
 * Removing it also simplifies the height chain below: `<main>` is now always the
 * shell's second and last child, in every area.
 *
 * ── The map-height chain (the main regression risk) ──────────────────────────────
 * `.map-pane` sizes the map with `height: 100%` at md+, which needs a DEFINITE
 * parent height.
 *
 *   - `variant="map"`: this shell root is the fixed-height flex COLUMN
 *     (`md:h-screen md:h-dvh`), the header is an ordinary auto-height first child,
 *     and `<main>` is `md:flex-1 md:min-h-0` — a flex item whose used height is
 *     definite, so `.map-pane`'s `height: 100%` still resolves. `min-h-0` is
 *     load-bearing: without it the default `min-height: auto` would let content
 *     push the row past the viewport bottom.
 *   - The static `vh` fallback classes stay BEFORE their `dvh` counterparts
 *     (`min-h-screen min-h-dvh`, `md:h-screen md:h-dvh`) and live on this root
 *     together, so the `@supports` overrides in globals.css — which match on the
 *     two-class selectors `.min-h-screen.min-h-dvh` and `.md\:h-screen.md\:h-dvh`
 *     — keep applying to the element that owns the height. `.map-pane` itself is
 *     untouched.
 *   - The header is deliberately NOT `position: sticky` or `fixed`; either would
 *     remove it from the column's height accounting.
 *
 * `variant="page"` is the map-free layout: the root only sets a minimum height and
 * `<main>` is a plain `flex-1`, so those dashboards scroll normally.
 */

import type { ReactNode } from "react";

import type { NavDestination } from "../lib/glossary";
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
  return (
    <div
      data-testid="app-shell"
      className={
        variant === "map"
          ? // Fallback-first ordering (`min-h-screen` before `min-h-dvh`,
            // `md:h-screen` before `md:h-dvh`) is required: `dvh` is not
            // self-falling-back, so an engine without it drops the whole
            // declaration and the row would have no definite height for
            // `.map-pane` to resolve against.
            "flex min-h-screen min-h-dvh flex-col bg-canvas md:h-screen md:h-dvh"
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
            ? // Mobile: a plain content-sized column (unchanged stacking). md+: the
              // flex row that fills the remaining height — `min-h-0` lets it shrink
              // so the map pane ends exactly at the viewport bottom.
              "flex flex-col md:min-h-0 md:flex-1 md:flex-row"
            : "flex-1"
        }
      >
        {children}
      </main>
    </div>
  );
}
