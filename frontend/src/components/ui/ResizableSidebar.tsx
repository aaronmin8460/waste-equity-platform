"use client";

/**
 * ResizableSidebar — the 지역 지표 control column plus its drag handle.
 *
 * Replaces the fixed `md:w-96` (384px) column with a reader-controlled width of
 * 300–520px, defaulting to 360px and remembered across visits
 * (docs/YEOGIDA_UI_REDESIGN_SPEC.md §3).
 *
 * ── Why the width is a CSS custom property, not an inline `width` ────────────────
 * The desktop width must not apply on phones, where the column is full-width and
 * stacked above the map. An inline `style={{ width }}` would win at every
 * breakpoint, so the value is published as `--wep-sidebar-width` and *consumed*
 * only inside the `min-width: 768px` block in globals.css. Below md the property
 * is simply unread, which is what "mobile ignores desktop drag-resize" means
 * structurally rather than by a JS branch that could drift from the CSS.
 *
 * ── The MapLibre contract: nothing is added here ─────────────────────────────────
 * `components/MapView.tsx` already observes its own container with a
 * `ResizeObserver` that coalesces bursts into one `map.resize()` per animation
 * frame. Narrowing this column widens the sibling `.map-pane`, that observer
 * fires, and the canvas follows. So this component deliberately owns NO observer,
 * NO `map.resize()` call, and no map reference at all — a second observer would
 * double every resize during a drag and could re-introduce the "ResizeObserver
 * loop" warning the existing rAF guard exists to avoid.
 *
 * Dragging also cannot remount the map: the width state lives HERE, and `children`
 * arrives as an already-constructed element, so a re-render of this component
 * reuses that subtree untouched. The page never re-renders during a drag.
 *
 * ── Accessibility ────────────────────────────────────────────────────────────────
 * The handle is the ARIA window-splitter pattern: a focusable `role="separator"`
 * carrying `aria-orientation="vertical"` and live `aria-valuenow/min/max`, so the
 * current width is announced as it changes. It is fully keyboard-operable
 * (←/→ nudge, Home/End jump to the bounds) and double-click restores the default,
 * because a pointer-only affordance would strand keyboard users at whatever width
 * was last stored.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/** The approved desktop bounds (spec §3). */
export const SIDEBAR_MIN_WIDTH = 300;
export const SIDEBAR_DEFAULT_WIDTH = 360;
export const SIDEBAR_MAX_WIDTH = 520;

/** How far one arrow-key press moves the divider. */
export const SIDEBAR_KEY_STEP = 16;

export const SIDEBAR_WIDTH_STORAGE_KEY = "yeogida.equity.sidebarWidth";

/**
 * Clamp any candidate width into the approved range.
 *
 * Non-finite input (a corrupted store, `NaN` from a bad parse) falls back to the
 * DEFAULT rather than to a bound: 300 or 520 would be a silent claim that the
 * reader once chose an extreme, and the default is the honest "no valid
 * preference" answer.
 */
export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

/**
 * Read the remembered width from a storage-like object.
 *
 * Every failure mode resolves to the default: no entry, a non-numeric string, a
 * number outside the range (clamped), or a `localStorage` access that throws
 * (Safari private mode, disabled storage). Taking `storage` as a parameter keeps
 * this unit-testable without touching a global.
 */
export function readStoredSidebarWidth(storage: Pick<Storage, "getItem"> | null): number {
  if (!storage) return SIDEBAR_DEFAULT_WIDTH;
  let raw: string | null = null;
  try {
    raw = storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  if (raw === null || raw.trim() === "") return SIDEBAR_DEFAULT_WIDTH;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_WIDTH;
  return clampSidebarWidth(parsed);
}

export interface ResizableSidebarProps {
  /** The control column's content. */
  children: ReactNode;
  /** Accessible name for the drag handle. */
  resizerLabel?: string;
  /** Extra classes for the `<aside>`, appended after the layout classes. */
  className?: string;
}

export default function ResizableSidebar({
  children,
  resizerLabel = "지역 지표 패널 너비 조절",
  className = "",
}: ResizableSidebarProps) {
  // Always start at the default so the server and the first client render agree;
  // the stored preference is applied in the effect below. Seeding from
  // localStorage during render would be a hydration mismatch.
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydrate from localStorage */
    // Post-mount, not a lazy `useState` initializer, so the server and the first
    // client render agree: localStorage is client-only, and seeding during render
    // would be a hydration mismatch on any visit with a stored preference. This
    // is the same discipline `SuitabilityScenarioLab` uses for its sessionStorage
    // draft. It runs once; re-running under StrictMode's double-invoke is
    // harmless because reading storage is idempotent.
    setWidth(readStoredSidebarWidth(typeof window === "undefined" ? null : window.localStorage));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  /** Apply a width and remember it. A failed write must never break resizing. */
  const commitWidth = useCallback((next: number) => {
    const clamped = clampSidebarWidth(next);
    setWidth(clamped);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      // Storage unavailable (private mode, quota). The width still applies for
      // this visit; only the memory of it is lost.
    }
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Left button / primary contact only, so a right-click or a secondary
      // pointer never starts a drag.
      if (event.button !== 0) return;
      const aside = asideRef.current;
      if (!aside) return;
      const left = aside.getBoundingClientRect().left;
      const handle = event.currentTarget;
      // Pointer capture routes every subsequent move to THIS element, so the drag
      // survives the cursor crossing onto the map and the map never sees it.
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();

      const onMove = (moveEvent: PointerEvent) => {
        setWidth(clampSidebarWidth(moveEvent.clientX - left));
      };
      const onUp = (upEvent: PointerEvent) => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        // Persist once, at the end — not on every move, which would write
        // hundreds of times per drag.
        commitWidth(upEvent.clientX - left);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [commitWidth],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      let next: number | null = null;
      if (event.key === "ArrowLeft") next = width - SIDEBAR_KEY_STEP;
      else if (event.key === "ArrowRight") next = width + SIDEBAR_KEY_STEP;
      else if (event.key === "Home") next = SIDEBAR_MIN_WIDTH;
      else if (event.key === "End") next = SIDEBAR_MAX_WIDTH;
      if (next === null) return;
      // Arrow keys would otherwise scroll the column, and Home/End would jump it
      // to top/bottom, while the reader is trying to resize.
      event.preventDefault();
      commitWidth(next);
    },
    [width, commitWidth],
  );

  return (
    <>
      <aside
        ref={asideRef}
        data-testid="equity-sidebar"
        // `wep-sidebar` owns the width; the utilities keep the column's existing
        // stacking, scrolling, and surface behaviour. The desktop right border
        // moved to the divider, which now draws that line.
        className={`wep-sidebar flex w-full flex-col gap-3 border-b border-hairline bg-surface-sunken p-4 md:flex-none md:overflow-y-auto md:border-b-0 ${className}`}
        style={{ "--wep-sidebar-width": `${width}px` } as CSSProperties}
      >
        {children}
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={resizerLabel}
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuetext={`${width} 픽셀`}
        tabIndex={0}
        data-testid="sidebar-resizer"
        className="wep-sidebar-resizer"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => commitWidth(SIDEBAR_DEFAULT_WIDTH)}
      />
    </>
  );
}
