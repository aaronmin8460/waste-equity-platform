"use client";

/**
 * DashboardShell — the shared application chrome for every render branch.
 *
 * BEFORE (Phase 0 audit finding G1): `Home()` returned six trees, and the mode
 * switch was rendered four separate times — inside the 384px equity sidebar for the
 * two map modes, and as a full-width row above each of the three map-free
 * dashboards. The nav therefore changed structural position between areas and
 * wrapped onto two lines in the sidebar. Two of the six branches (transparency and
 * cost) also had no `id="main-content"` at all, so the skip link had no target there.
 *
 * AFTER: every branch renders through this shell, which owns — exactly once —
 *   1. the global `TopNavigation`,
 *   2. the optional 후보지 분석 `SegmentedControl` row, in the same place for the
 *      score, scenario, and cost sub-views, and
 *   3. the single `<main id="main-content" tabIndex={-1}>` skip-link target.
 * Branch-specific content (and each view's own `<h1>`) is passed as children, so the
 * decision of which branch mounts a `MapView` is unchanged: this shell never mounts
 * a map and never hides one with CSS.
 *
 * ── The map-height chain (the main Phase 1 regression risk) ──────────────────────
 * `.map-pane` sizes the map with `height: 100%` at md+, which needs a DEFINITE
 * parent height. Previously the `<main>` itself was the full-height row
 * (`md:h-screen md:h-dvh`). Inserting a header above it would have broken that chain
 * and reintroduced the empty strip below the map that `.map-pane` exists to prevent.
 *
 * The resolution (docs/UI_UX_DESKTOP_REDESIGN_PLAN.md §12 O4):
 *   - `variant="map"`: this shell root is the fixed-height flex COLUMN
 *     (`md:h-screen md:h-dvh`), the header is an ordinary auto-height first child,
 *     and `<main>` is `md:flex-1 md:min-h-0` — a flex item whose used height is
 *     definite, so `.map-pane`'s `height: 100%` still resolves. `min-h-0` is
 *     load-bearing: without it the default `min-height: auto` would let content push
 *     the row past the viewport bottom.
 *   - The static `vh` fallback classes stay BEFORE their `dvh` counterparts
 *     (`min-h-screen min-h-dvh`, `md:h-screen md:h-dvh`) and move to this root
 *     together, so the `@supports` overrides in globals.css — which match on the
 *     two-class selectors `.min-h-screen.min-h-dvh` and `.md\:h-screen.md\:h-dvh` —
 *     keep applying to the element that owns the height. `.map-pane` itself is
 *     untouched.
 *   - The header is deliberately NOT `position: sticky` or `fixed`; either would
 *     remove it from the column's height accounting.
 *
 * `variant="page"` is the map-free layout: the root only sets a minimum height and
 * `<main>` is a plain `flex-1`, so those dashboards scroll normally as before.
 */

import type { ReactNode } from "react";

import type { DashboardArea, SuitabilitySubview } from "../lib/glossary";
import { SUBVIEW_LABELS } from "../lib/glossary";
import SegmentedControl from "./ui/SegmentedControl";
import type { SegmentedControlOption } from "./ui/SegmentedControl";
import TopNavigation from "./ui/TopNavigation";

/** The three 후보지 분석 sub-views, in their fixed display order. */
const SUITABILITY_VIEWS: readonly SegmentedControlOption<SuitabilitySubview>[] = [
  { key: "score", label: SUBVIEW_LABELS.score, testId: "suitability-view-score" },
  { key: "scenario", label: SUBVIEW_LABELS.scenario, testId: "suitability-view-scenario" },
  { key: "cost", label: SUBVIEW_LABELS.cost, testId: "suitability-view-cost" },
] as const;

export interface DashboardShellProps {
  mode: DashboardArea;
  onModeChange: (mode: DashboardArea) => void;
  /**
   * `"map"` = the fixed-height row that hosts the sidebar + `.map-pane`.
   * `"page"` = a normally-scrolling full-width dashboard with no map.
   */
  variant: "map" | "page";
  /** Active sub-view. The segmented control renders only when mode is suitability. */
  suitabilityView?: SuitabilitySubview;
  onSuitabilityViewChange?: (view: SuitabilitySubview) => void;
  children: ReactNode;
}

export default function DashboardShell({
  mode,
  onModeChange,
  variant,
  suitabilityView,
  onSuitabilityViewChange,
  children,
}: DashboardShellProps) {
  const showSubviews =
    mode === "suitability" && suitabilityView !== undefined && onSuitabilityViewChange !== undefined;

  return (
    <div
      data-testid="app-shell"
      className={
        variant === "map"
          ? // Fallback-first ordering (`min-h-screen` before `min-h-dvh`, `md:h-screen`
            // before `md:h-dvh`) is required: `dvh` is not self-falling-back, so an
            // engine without it drops the whole declaration and the row would have no
            // definite height for `.map-pane` to resolve against.
            // `bg-surface-sunken` is the existing --color-surface-sunken token
            // (#f1f5f9) — the same neutral page background the branches used as a
            // raw `bg-slate-100`, now named rather than re-specified.
            "flex min-h-screen min-h-dvh flex-col bg-surface-sunken md:h-screen md:h-dvh"
          : "flex min-h-screen min-h-dvh flex-col bg-surface-sunken"
      }
    >
      <TopNavigation mode={mode} onChange={onModeChange} />

      {/* The sub-view switch belongs to the shared chrome, not to the cost dashboard
          or the suitability sidebar, so it keeps one position across score, scenario,
          and cost. Rendered as a conditional sibling BEFORE <main>: React keeps the
          <main> subtree in the same child slot when this row appears or disappears,
          so entering/leaving 후보지 분석 never remounts the map. */}
      {showSubviews ? (
        <div className="wep-subbar" data-testid="suitability-subviews">
          <div className="mx-auto w-full max-w-screen-2xl px-4 py-2 sm:px-6 lg:px-8">
            <SegmentedControl
              options={SUITABILITY_VIEWS}
              value={suitabilityView}
              onChange={onSuitabilityViewChange}
              ariaLabel="후보지 분석 하위 보기"
            />
          </div>
        </div>
      ) : null}

      {/* The single skip-link target for every view. `tabIndex={-1}` is load-bearing:
          activating the skip link must move focus here (e2e/accessibility.spec.ts). */}
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
