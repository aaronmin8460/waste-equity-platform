"use client";

/**
 * NarrowScreenGate — what 여기다 renders below the desktop floor.
 *
 * ── The product decision this encodes ────────────────────────────────────────────
 * 여기다 is a DESKTOP-FIRST, DESKTOP-REQUIRED analytical platform. Every full-page
 * frame in the canonical Figma file (74:1992, 125:5064, 129:5709, 136:8684,
 * 167:10554, 156:470) is drawn at 1440px wide; the file contains no phone frame for
 * any of the six destinations. The three-column 후보지 심층 분석 workspace, the
 * sidebar-plus-map areas, and the floating map overlays are all compositions of a
 * wide canvas — there is no designed phone form for them, and inventing one would
 * mean shipping an analytical UI the design never specified.
 *
 * The application previously DID stack itself into a phone column below 768px. That
 * layout was never in Figma; it was an accommodation that produced a multi-screen
 * vertical scroll of left panel → map → right panel, which is not a usable way to
 * compare candidate sites. This gate replaces it with an honest statement.
 *
 * ── Why the children are UNMOUNTED, not hidden ───────────────────────────────────
 * `DashboardShell` returns this component INSTEAD OF its children, so below the
 * floor no dashboard subtree exists: no `MapView`, no MapLibre canvas, no WebGL
 * context, no tile requests. Hiding the app with `display: none` would leave all of
 * that mounted and merely invisible, which is the "one CSS rule" fix this contract
 * explicitly rejects.
 *
 * The caller's own state is NOT unmounted — `DashboardShell` is rendered BY
 * `app/page.tsx`, so page state, URL state, and the URL-state version survive a
 * width change untouched. Widening past the floor re-mounts the dashboard on the
 * same state. The one thing that does reset is the MapLibre viewport (centre/zoom),
 * because the map subtree genuinely unmounts; that is the intended cost of not
 * keeping a hidden WebGL context alive on a phone.
 *
 * ── Accessibility ────────────────────────────────────────────────────────────────
 *   - It renders the `<main id="main-content" tabIndex={-1}>` skip-link target, so
 *     the anchor in `app/layout.tsx` still resolves at every width. Losing that
 *     would break the WCAG 2.4.1 bypass block on exactly the screens that need it.
 *   - It renders exactly ONE `<h1>`, so the "one h1 per view" contract
 *     (`app/accessibility.test.tsx`) holds at narrow widths too.
 *   - Nothing here is interactive, so there is no focus trap and no control that
 *     silently does nothing.
 *   - Browser zoom is NOT disabled (`app/layout.tsx` leaves `userScalable` on). Note
 *     the honest consequence: zooming a desktop window past ~150% reduces the CSS-pixel
 *     viewport below the floor and shows this gate. Any width-based gate behaves that
 *     way — CSS pixels cannot distinguish a small screen from a zoomed large one — and
 *     the product decision is deliberate, so this is documented rather than hidden.
 */

import { useSyncExternalStore } from "react";

import FigmaIcon from "./FigmaIcon";
import { BRAND_NAME, BRAND_SUBTITLE } from "./TopNavigation";

/**
 * The desktop floor, in CSS pixels.
 *
 * 1024 is the narrowest width the redesign is specified to work at: `.wep-nav-track`
 * holds all six destinations on one row from here up (spec §2), and `.wep-panel`'s
 * 15.5rem columns leave the map above 500px at exactly this width. Below it there is
 * no designed composition, so this is where the app stops rather than degrades.
 *
 * It is exported so the CSS media queries, the tests, and this component all read the
 * same number from one place.
 */
export const DESKTOP_MIN_WIDTH = 1024;

const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(DESKTOP_MEDIA_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined") return true;
  // `matchMedia` is the correct signal (it evaluates the same CSS pixel space the
  // stylesheet does). jsdom does not implement it, so the `innerWidth` branch is what
  // the component tests actually take — jsdom's default width is 1024, i.e. exactly
  // the floor, so every existing unit test keeps rendering the desktop application
  // and only a test that explicitly stubs one of these signals sees the gate.
  if (typeof window.matchMedia === "function") {
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  }
  return typeof window.innerWidth === "number" ? window.innerWidth >= DESKTOP_MIN_WIDTH : true;
}

/**
 * Server snapshot: assume desktop.
 *
 * The server cannot know the viewport, and this is the safe assumption for a
 * desktop-required product — the prerendered HTML is the desktop shape and the client
 * corrects it on its first commit. There is no hydration mismatch, because React uses
 * this same value for the hydration render and only then re-reads the client snapshot.
 * Nothing analytical flashes either way: `app/page.tsx` fetches in an effect, so the
 * prerendered HTML is its loading state, never a populated dashboard.
 */
function getServerSnapshot(): boolean {
  return true;
}

/** `true` when the viewport is at or above the desktop floor. */
export function useIsDesktopViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export default function NarrowScreenGate() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-testid="narrow-screen-gate"
      className="wep-narrow-gate"
    >
      <div className="wep-narrow-gate-card">
        {/* The same brand block the app bar uses, so the reader is plainly still in
            여기다 rather than on an error page. Decorative: the product name beside it
            is the accessible text. */}
        <span className="wep-narrow-gate-mark" aria-hidden>
          <FigmaIcon name="logo-target-01" />
        </span>
        <p className="wep-narrow-gate-brand">
          <span className="wep-narrow-gate-brand-name">{BRAND_NAME}</span>
          <span className="wep-narrow-gate-brand-sub">{BRAND_SUBTITLE}</span>
        </p>

        <h1 className="wep-narrow-gate-title">넓은 화면에서 이용해 주세요</h1>
        <p className="wep-narrow-gate-body">
          이 분석 화면은 넓은 화면에 최적화되어 있습니다. {DESKTOP_MIN_WIDTH}px 이상의 데스크톱
          화면에서 이용해 주세요.
        </p>
      </div>
    </main>
  );
}
