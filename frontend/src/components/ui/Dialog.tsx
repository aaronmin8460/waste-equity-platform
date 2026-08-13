"use client";

/**
 * Dialog — a large, accessible modal for 데이터·출처
 * (docs/YEOGIDA_UI_REDESIGN_SPEC.md §8).
 *
 * Hand-rolled rather than `<dialog showModal>` for one reason that matters here:
 * the source catalogue is long and internally scrollable, and Safari's native
 * modal still mishandles a scrolling flex child inside the top layer. Everything
 * the native element would have given us is implemented explicitly below, so
 * nothing is lost:
 *
 *   - `role="dialog"` + `aria-modal` + `aria-labelledby` pointing at the visible
 *     title, so the accessible name is the same string the reader sees;
 *   - focus moves INTO the panel on open and is restored to the exact element
 *     that opened it on close — including when the dialog was opened from a URL,
 *     in which case there is no trigger and focus simply stays inside;
 *   - Tab and Shift+Tab are contained: the first and last tabbable elements wrap
 *     to each other, so focus cannot escape to the page behind;
 *   - the background is `inert` while open, so it is not reachable by keyboard,
 *     by screen-reader virtual cursor, or by a stray click;
 *   - Escape closes, and so does a click on the backdrop (never a click that
 *     merely ENDED there after a drag started inside the panel);
 *   - the body cannot scroll behind the dialog, but the panel's own body can.
 */

import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";

/** Elements that can hold focus, in DOM order. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  /** Visible title. Also the dialog's accessible name, via aria-labelledby. */
  title: string;
  /** Optional line under the title. */
  description?: string;
  onClose: () => void;
  testId: string;
  children: ReactNode;
}

export default function Dialog({
  open,
  title,
  description,
  onClose,
  testId,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `${testId}-title`;
  // Where focus came from, so it can be given back precisely.
  const openerRef = useRef<HTMLElement | null>(null);
  // Guards a backdrop click that merely FINISHED on the backdrop after the
  // pointer went down inside the panel (a text selection dragged outward).
  const downOnBackdrop = useRef(false);

  // Held in a ref so the open effect does NOT depend on the callback's identity.
  // A parent that re-creates `onClose` each render would otherwise re-run the
  // effect, and its first act is to focus the panel — which would yank focus back
  // from whatever control the reader had just tabbed to.
  const onCloseRef = useRef(onClose);
  // Synced in an effect rather than during render: mutating a ref while
  // rendering is not safe under concurrent React.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const close = useCallback(() => onCloseRef.current(), []);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;

    // Move focus into the panel. The panel itself is the target rather than its
    // first control: a screen reader then announces the dialog's name and role
    // before any control, which is what tells the reader where they now are.
    const panel = panelRef.current;
    panel?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        // Nothing to tab to — keep focus on the panel rather than letting it
        // fall through to the inert page behind.
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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      // Give focus back to whatever opened this. When the dialog was restored
      // from a URL there is no opener, and forcing focus somewhere arbitrary
      // would be worse than leaving it where the browser put it.
      const opener = openerRef.current;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="wep-dialog-backdrop"
      data-testid={`${testId}-backdrop`}
      onPointerDown={(event) => {
        downOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && downOnBackdrop.current) close();
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // -1 so the panel can receive focus programmatically without joining the
        // tab order itself.
        tabIndex={-1}
        className="wep-dialog"
        data-testid={testId}
      >
        <div className="wep-dialog-head">
          <div className="min-w-0">
            {/* An h2, not an h1: the destination behind the dialog keeps the
                page's single h1, and a dialog title is not the page title. */}
            <h2 id={titleId} className="wep-dialog-title">
              {title}
            </h2>
            {description && <p className="wep-dialog-desc">{description}</p>}
          </div>
          <button
            type="button"
            className="wep-dialog-close"
            data-testid={`${testId}-close`}
            aria-label={`${title} 닫기`}
            onClick={close}
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
        {/* The long content scrolls HERE, not the page. */}
        <div className="wep-dialog-body" data-testid={`${testId}-body`}>
          {children}
        </div>
      </div>
    </div>
  );
}
