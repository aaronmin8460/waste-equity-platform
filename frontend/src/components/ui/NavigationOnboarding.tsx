"use client";

/**
 * NavigationOnboarding — the one-time overlay that introduces the six destinations
 * on a reader's first visit.
 *
 * The written Figma request is for a first-visit guide over the top navigation. The
 * hard part is not the copy, it is that the guidance must keep pointing at the real
 * controls: the six Korean labels change width with the font, the bar has two
 * different metric sets (compact below 1280, the Figma geometry above it), and the
 * design canvas is 1440 while the app renders from 1024 up. So NOTHING here is drawn
 * at a coordinate taken from the frame.
 *
 * ── Everything positioned comes from the live DOM ────────────────────────────────
 * The overlay measures `[data-testid="mode-switch"]` and its six
 * `button[data-destination]` children with `getBoundingClientRect()` and paints the
 * spotlight, the six numbered markers, the pointer, and the card from those numbers.
 * It re-measures on resize, on a `ResizeObserver` entry where one exists, and once
 * `document.fonts.ready` settles — because the Korean face arrives after first paint
 * (`display: "swap"`) and every label changes width when it does. A hard-coded 1440
 * layout would be wrong at every width the app actually renders at, and wrong again
 * the moment a destination is renamed.
 *
 * The numbers on the markers are the same numbers on the card's list, so "the third
 * item in this list" and "the third button up there" are visibly one thing.
 *
 * ── Why it is a sibling of TopNavigation, not part of it ─────────────────────────
 * `TopNavigation` is presentational: props in, six buttons out, no state, no storage,
 * no effects. Folding a stateful first-visit overlay into it would give the six
 * destinations a reason to re-render, and would put `localStorage` inside the one
 * component the terminology audit and the accessibility suite render on every
 * assertion. `DashboardShell` renders this beside the nav instead, so the nav keeps
 * its contract and this owns all of the overlay's state.
 *
 * ── Where it deliberately does NOT appear ────────────────────────────────────────
 *   - Below the 1024 desktop floor. `DashboardShell` renders `NarrowScreenGate`
 *     there and no navigation exists to point at.
 *   - When `matchMedia` is unavailable. The overlay is a progressive enhancement: it
 *     is shown only on a POSITIVE confirmation that the viewport is desktop, never
 *     on a guess. (This is also why it never appears in the jsdom component suites,
 *     which render the whole application at the floor and must not have a modal
 *     dropped on top of every assertion.)
 *   - When `localStorage` is unreadable or unwritable — private-browsing modes, a
 *     disabled-storage policy. A guide that cannot remember being dismissed would
 *     reappear on every single page load, which is worse than never showing it.
 *   - On any visit after the first, which is the whole point.
 *
 * ── Accessibility ────────────────────────────────────────────────────────────────
 * It is a real dialog, on the same terms as `ui/Dialog`: `role="dialog"` +
 * `aria-modal` + an accessible name from the visible title, focus moved into the
 * panel on open, Tab and Shift+Tab contained, focus returned to exactly where it was
 * on dismissal, Escape closes, and the page behind cannot scroll. Space closes too,
 * because the request asks for it by name. The entrance animation is dropped under
 * `prefers-reduced-motion: reduce` (globals.css).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { NAV_DESTINATIONS } from "../../lib/glossary";
import { DESKTOP_MIN_WIDTH } from "./NarrowScreenGate";
import { NAV_GROUP_TEST_ID } from "./TopNavigation";

/**
 * The remembered "this reader has seen the guide" flag.
 *
 * Versioned in the key rather than in the value: if the guide is ever rewritten
 * enough to be worth showing again, bumping `v1` re-offers it to everyone without
 * needing a migration, and leaves the old key harmlessly orphaned.
 */
export const NAV_ONBOARDING_STORAGE_KEY = "wep.nav-onboarding.seen.v1";

/** The media query the overlay requires — the same floor the shell gates on. */
const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

/** Card width in px. Kept in sync with `.wep-nav-onboarding-card` in globals.css. */
const CARD_WIDTH = 380;
/** Viewport margin the card is never allowed to cross. */
const VIEWPORT_MARGIN = 16;
/** Gap between the bottom of the navigation and the top of the card. */
const CARD_OFFSET = 42;

/** A viewport-space box, in CSS pixels. `position: fixed` reads the same space. */
export interface OnboardingRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface OnboardingGeometry {
  /** The navigation track as a whole. */
  track: OnboardingRect;
  /** One box per destination button, in nav order. */
  buttons: OnboardingRect[];
}

function toRect(element: Element): OnboardingRect {
  const { top, left, width, height } = element.getBoundingClientRect();
  return { top, left, width, height };
}

/**
 * Read the navigation's live geometry.
 *
 * Returns `null` when the nav is absent or has no size — jsdom reports every box as
 * 0x0, and a real browser reports the same for a display:none subtree. Callers then
 * render the card without the spotlight rather than drawing a marker on a point.
 * Exported for the unit tests, which stub `getBoundingClientRect` to prove the
 * overlay reads the DOM rather than a constant.
 */
export function measureNavigation(root: Document | null): OnboardingGeometry | null {
  const track = root?.querySelector(`[data-testid="${NAV_GROUP_TEST_ID}"]`);
  if (!track) return null;
  const trackRect = toRect(track);
  if (trackRect.width <= 0 || trackRect.height <= 0) return null;
  const buttons = Array.from(track.querySelectorAll("button[data-destination]"))
    .map(toRect)
    .filter((rect) => rect.width > 0 && rect.height > 0);
  return { track: trackRect, buttons };
}

/**
 * Whether this visit should be offered the guide.
 *
 * Every "cannot tell" answer is `false`. Showing a modal over the whole application
 * is intrusive enough that it needs positive evidence on all three counts: a desktop
 * viewport the browser confirms, storage that works, and no record of a previous
 * dismissal. Exported so the decision is unit-testable without a DOM.
 */
export function shouldOfferNavOnboarding(win: Window | undefined): boolean {
  if (!win || typeof win.matchMedia !== "function") return false;
  if (!win.matchMedia(DESKTOP_MEDIA_QUERY).matches) return false;
  try {
    const storage = win.localStorage;
    if (!storage) return false;
    if (storage.getItem(NAV_ONBOARDING_STORAGE_KEY) !== null) return false;
    // Prove the WRITE works before showing anything. A storage that reads but
    // refuses to write would replay the guide on every load.
    storage.setItem(NAV_ONBOARDING_STORAGE_KEY, "probe");
    storage.removeItem(NAV_ONBOARDING_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Elements that can hold focus inside the panel, in DOM order. */
const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function clamp(value: number, min: number, max: number): number {
  // `max` can fall below `min` on a viewport narrower than the card; the left
  // margin wins there, so the card is never pushed off the left edge.
  return Math.max(min, Math.min(max, value));
}

export default function NavigationOnboarding() {
  // "pending" is the server snapshot AND the first client render: no storage is
  // read during render, so the markup React hydrates is the markup the server sent.
  const [status, setStatus] = useState<"pending" | "open" | "closed">("pending");
  const [geometry, setGeometry] = useState<OnboardingGeometry | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const titleId = "nav-onboarding-title";
  const bodyId = "nav-onboarding-body";

  const dismiss = useCallback(() => {
    setStatus((current) => {
      if (current !== "open") return current;
      try {
        window.localStorage.setItem(NAV_ONBOARDING_STORAGE_KEY, "1");
      } catch {
        // `shouldOfferNavOnboarding` probed the write before opening, so this is
        // a storage that failed between then and now. The guide still closes —
        // refusing to close because we cannot remember it would be absurd.
      }
      return "closed";
    });
  }, []);

  // Decide AFTER mount. A lazy `useState` initializer reading localStorage would be
  // a hydration mismatch on every return visit: the server has no storage and would
  // render the overlay open while the client renders it closed.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time first-visit probe */
    if (shouldOfferNavOnboarding(typeof window === "undefined" ? undefined : window)) {
      setStatus("open");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Measure the live navigation, and keep measuring while the overlay is open.
  useEffect(() => {
    if (status !== "open") return;

    // Lock the page BEFORE the first measurement: removing the document scrollbar
    // reflows the header a few pixels wider, and a spotlight measured beforehand
    // would sit that far off the track it is meant to be ringing.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // The geometry is state READ FROM the DOM rather than derived from props, so an
    // effect is the only place it can come from: it does not exist until the browser
    // has laid the navigation out.
    const remeasure = () => setGeometry(measureNavigation(document));
    remeasure();

    window.addEventListener("resize", remeasure);

    // The Korean face loads with `display: "swap"`, so every label changes width
    // after first paint. Without this the markers are correct for the fallback
    // metrics and wrong for the face the reader actually sees.
    let cancelled = false;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    void fonts?.ready.then(() => {
      if (!cancelled) remeasure();
    });

    // The bar itself resizes without the window doing so — the nav track grows when
    // the 1280 breakpoint swaps in the Figma metrics. jsdom has no ResizeObserver.
    let observer: ResizeObserver | undefined;
    const track = document.querySelector(`[data-testid="${NAV_GROUP_TEST_ID}"]`);
    if (track && typeof ResizeObserver === "function") {
      observer = new ResizeObserver(remeasure);
      observer.observe(track);
    }

    return () => {
      cancelled = true;
      window.removeEventListener("resize", remeasure);
      observer?.disconnect();
      document.body.style.overflow = previousOverflow;
    };
  }, [status]);

  // Focus management and the keyboard contract, on the same terms as ui/Dialog.
  useEffect(() => {
    if (status !== "open") return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // The panel, not its first button: a screen reader then announces the dialog's
    // name and role before any control, which is what says where the reader is.
    panel?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      // Space is the dismissal the written request names. `event.key` is a literal
      // " " in every current engine; "Spacebar" is the legacy IE/Edge spelling and
      // costs nothing to accept.
      if (event.key === " " || event.key === "Spacebar" || event.key === "Escape") {
        // preventDefault stops Space from also scrolling the page (and from
        // re-activating whichever button inside the panel had focus).
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && (active === last || active === panel)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Hand focus back to exactly where it was. On a first visit that is usually
      // <body>, in which case there is nothing to restore and forcing focus
      // somewhere arbitrary would be worse than leaving it.
      const opener = openerRef.current;
      if (opener && opener !== document.body && document.contains(opener)) opener.focus();
    };
  }, [status, dismiss]);

  if (status !== "open") return null;

  const track = geometry?.track;
  // The spotlight is the scrim: its box is the HOLE, and a 200vmax spread paints
  // everything outside it (see `.wep-nav-onboarding-spotlight`). With no geometry
  // there is nothing to cut out, so the scrim is a plain translucent sheet — the
  // reader still gets the overlay, just without a ring around a box we cannot find.
  const spotlightStyle: CSSProperties | undefined = track
    ? {
        top: `${track.top - 6}px`,
        left: `${track.left - 6}px`,
        width: `${track.width + 12}px`,
        height: `${track.height + 12}px`,
      }
    : undefined;

  const anchorX = track ? track.left + track.width / 2 : 0;
  const anchorBottom = track ? track.top + track.height : 0;

  const cardStyle: CSSProperties = track
    ? {
        top: `${anchorBottom + CARD_OFFSET}px`,
        left: `${clamp(
          anchorX - CARD_WIDTH / 2,
          VIEWPORT_MARGIN,
          window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN,
        )}px`,
        maxHeight: `calc(100vh - ${anchorBottom + CARD_OFFSET + VIEWPORT_MARGIN}px)`,
      }
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div
      className="wep-nav-onboarding"
      data-testid="nav-onboarding"
      // Everything except the card is pointer-transparent, so a click anywhere
      // outside the card lands here and dismisses — the same backdrop contract
      // ui/Dialog uses.
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        className={
          track
            ? "wep-nav-onboarding-spotlight"
            : "wep-nav-onboarding-spotlight wep-nav-onboarding-spotlight--flat"
        }
        data-testid="nav-onboarding-scrim"
        style={spotlightStyle}
        aria-hidden
      />

      {/* One numbered marker per REAL button, at that button's measured box. The
          number is the number beside the same destination in the card's list. */}
      {geometry?.buttons.map((rect, index) => (
        <span
          key={NAV_DESTINATIONS[index]?.key ?? index}
          className="wep-nav-onboarding-marker"
          data-testid="nav-onboarding-marker"
          data-destination={NAV_DESTINATIONS[index]?.key}
          style={{
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }}
          aria-hidden
        >
          <span className="wep-nav-onboarding-marker-badge">{index + 1}</span>
        </span>
      ))}

      {track && (
        <span
          className="wep-nav-onboarding-pointer"
          data-testid="nav-onboarding-pointer"
          style={{ top: `${anchorBottom + 22}px`, left: `${anchorX}px` }}
          aria-hidden
        />
      )}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="wep-nav-onboarding-card"
        data-testid="nav-onboarding-card"
        style={cardStyle}
      >
        <div className="wep-nav-onboarding-head">
          {/* An h2, not an h1 — the destination behind this overlay keeps the
              page's single h1, and every view is asserted to have exactly one. */}
          <h2 id={titleId} className="wep-nav-onboarding-title">
            상단 메뉴 여섯 곳을 안내합니다
          </h2>
          <button
            type="button"
            className="wep-nav-onboarding-close"
            data-testid="nav-onboarding-close"
            aria-label="안내 닫기"
            onClick={dismiss}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              focusable="false"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <p id={bodyId} className="wep-nav-onboarding-body">
          화면 위쪽 메뉴에서 원하는 분석으로 바로 이동할 수 있습니다. 번호는 위 메뉴 버튼의
          순서와 같습니다.
        </p>

        {/* The six destinations, from the same registry the navigation renders, so
            a renamed destination renames itself here too. */}
        <ol className="wep-nav-onboarding-list">
          {NAV_DESTINATIONS.map((destination, index) => (
            <li key={destination.key} className="wep-nav-onboarding-item">
              <span className="wep-nav-onboarding-item-number" aria-hidden>
                {index + 1}
              </span>
              <span className="wep-nav-onboarding-item-text">
                <span className="wep-nav-onboarding-item-label">{destination.label}</span>
                <span className="wep-nav-onboarding-item-orientation">
                  {destination.orientation}
                </span>
              </span>
            </li>
          ))}
        </ol>

        <div className="wep-nav-onboarding-foot">
          <p className="wep-nav-onboarding-hint">스페이스바 또는 Esc 키로도 닫을 수 있습니다.</p>
          <button
            type="button"
            className="wep-nav-onboarding-confirm"
            data-testid="nav-onboarding-confirm"
            onClick={dismiss}
          >
            확인했어요
          </button>
        </div>
      </div>
    </div>
  );
}
