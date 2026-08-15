"use client";

/**
 * CollapsiblePanel — one side column of the 후보지 심층 분석 three-column
 * workspace (docs/YEOGIDA_UI_REDESIGN_SPEC.md §6).
 *
 * Collapsed, the column becomes a narrow vertical rail carrying only a reopen
 * button; the width it gives up goes to the map, which is the point.
 *
 * ── Why this is NOT a <details> disclosure ───────────────────────────────────────
 * The repository already has three disclosure classes (`.mobile-collapsible`,
 * `.map-legend`, `.map-insight`) and this is deliberately a fourth mechanism
 * rather than a fourth class on the same one. A `<details>` collapses its body to
 * zero height in the FLOW direction; here the column has to change its WIDTH and
 * hand that width to a flex sibling, which `<details>` does not express. The
 * collapsed state is also a persistent layout preference, not a disclosure of
 * supporting text — the two behave differently on reopen.
 *
 * ── The MapLibre contract ────────────────────────────────────────────────────────
 * Collapsing changes this column's width, which widens the sibling `.map-pane`.
 * `MapView`'s existing container `ResizeObserver` (rAF-coalesced) fires and calls
 * `map.resize()`. This component therefore owns NO observer, NO map reference,
 * and no `map.resize()` call of its own — see components/ui/ResizableSidebar.tsx
 * for the same reasoning.
 *
 * Crucially the panel is ALWAYS MOUNTED. Collapsing hides the body with CSS and
 * shrinks the column; it does not unmount `children`. That keeps sibling React
 * state (and, more importantly, the map subtree's position in the tree) stable,
 * so collapsing can never remount the map or drop a selection.
 *
 * ── Why <aside> ──────────────────────────────────────────────────────────────────
 * These are complementary control/result columns flanking the map, which is the
 * same role the 지역 지표 column already plays as an `<aside>`. Keeping the
 * element consistent means one landmark vocabulary across the whole app, and a
 * screen-reader user meets the same landmark type in every map view.
 *
 * ── One layout, no phone branch ──────────────────────────────────────────────────
 * This workspace used to have a second form: below `md` the three columns stacked,
 * a width-collapse was meaningless there, so the rail and the collapse control were
 * hidden and each column became a section in a vertical scroll. That produced left
 * panel → map → right panel as a multi-screen phone page, which the canonical Figma
 * file never specified. 여기다 is desktop-required now — below 1024px the shell
 * renders `ui/NarrowScreenGate` instead of any dashboard — so the stacked branch was
 * unreachable and both it and its CSS are gone. Every width this component renders
 * at is a width where the collapse means something.
 */

import type { ReactNode } from "react";

export type PanelSide = "left" | "right";

export interface CollapsiblePanelProps {
  /** Which edge of the map this column sits on — decides the chevron direction. */
  side: PanelSide;
  /** Accessible name for the column and its collapse/expand control. */
  label: string;
  /** `true` when the column is collapsed to its rail. */
  collapsed: boolean;
  onToggle: (collapsed: boolean) => void;
  /** Stable id so the toggle can point `aria-controls` at the body it governs. */
  panelId: string;
  testId: string;
  children: ReactNode;
}

/** A chevron that points the way the column will move when activated. */
function Chevron({ pointsLeft }: { pointsLeft: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden
    >
      <path d={pointsLeft ? "m15 5-7 7 7 7" : "m9 5 7 7-7 7"} />
    </svg>
  );
}

export default function CollapsiblePanel({
  side,
  label,
  collapsed,
  onToggle,
  panelId,
  testId,
  children,
}: CollapsiblePanelProps) {
  // Collapsing the LEFT column moves it left, so its control points left when
  // open and right when collapsed. The right column is the mirror image.
  const pointsLeft = side === "left" ? !collapsed : collapsed;

  return (
    <aside
      aria-label={label}
      data-testid={testId}
      data-collapsed={collapsed ? "true" : "false"}
      data-side={side}
      className={`wep-panel ${collapsed ? "wep-panel-collapsed" : ""}`}
    >
      <div className="wep-panel-bar">
        {/* The title is hidden with the body when collapsed so the rail stays
            narrow, but the BUTTON keeps the full accessible name either way. */}
        {!collapsed && <span className="wep-panel-title">{label}</span>}
        <button
          type="button"
          // A native button: keyboard activation and focus order come free.
          className="wep-panel-toggle"
          // `aria-expanded` is the state; the visible chevron is a second,
          // non-colour signal, and the accessible name says which panel it is.
          aria-expanded={!collapsed}
          aria-controls={panelId}
          aria-label={collapsed ? `${label} 열기` : `${label} 접기`}
          data-testid={`${testId}-toggle`}
          onClick={() => onToggle(!collapsed)}
        >
          <Chevron pointsLeft={pointsLeft} />
        </button>
      </div>
      {/*
        ALWAYS RENDERED, and hidden by CSS rather than by the `hidden` attribute.

        Two reasons. (1) React keeps the subtree mounted either way, so reopening
        is instant and neither the map nor any sibling state is disturbed. (2) The
        collapse is a DESKTOP-only concept: below md the columns stack and the
        body must always show. `hidden` is a UA `display: none` that a media query
        would have to fight; a class lets globals.css scope the hiding to md+
        cleanly, so a phone can never end up with an analytical panel it cannot
        open. `display: none` at md+ also removes the body from the a11y tree and
        from the tab order, which is exactly right for a collapsed column.
      */}
      <div id={panelId} className="wep-panel-body">
        {children}
      </div>
    </aside>
  );
}
