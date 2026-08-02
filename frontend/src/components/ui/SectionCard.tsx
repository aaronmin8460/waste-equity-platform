"use client";

/**
 * SectionCard — the standard content container: a white surface on the canvas,
 * separated by a hairline border, 10px radius, restrained padding, no shadow.
 *
 * Why it is not a trivial `<div className="wep-card">` wrapper: it owns the
 * card's HEADING SEMANTICS. A card with a visible title is a `<section>` whose
 * accessible name comes from that title via `aria-labelledby`, so screen-reader
 * users can enumerate the dashboard's regions instead of hearing a flat run of
 * text. Getting that wrong (or hand-rolling it per call site, which is what the
 * dashboards do today) is exactly the drift this primitive prevents.
 *
 * Heading level is a required decision, not a default: these cards sit under a
 * view's single `<h1>`, and the correct level depends on the nesting at the call
 * site. `headingLevel` therefore defaults to 2 but is explicit in the type.
 *
 * With no `title`, it renders a plain `<div>` — a nameless `<section>` is not a
 * landmark worth announcing, so it must not claim to be one.
 *
 * Migration note: existing screens keep their current `.wep-card` markup for now.
 * This milestone establishes the primitive; the analytical pages adopt it in the
 * later per-page milestones (docs/ui-refresh/regression-contract.md).
 */

import { useId } from "react";
import type { ReactNode } from "react";

export interface SectionCardProps {
  /** Visible card title. Omit for an untitled container. */
  title?: string;
  /** Short supporting line under the title. */
  description?: ReactNode;
  /**
   * Right-aligned header slot — a status badge, a reference period, a small
   * control. Kept out of the heading so it never pollutes the accessible name.
   */
  headerAside?: ReactNode;
  /** Heading level for `title`. Defaults to 2 (cards sit under the view's h1). */
  headingLevel?: 2 | 3 | 4;
  /** Removes the body padding for edge-to-edge content (a table, a chart). */
  flush?: boolean;
  children: ReactNode;
  className?: string;
  testId?: string;
}

export default function SectionCard({
  title,
  description,
  headerAside,
  headingLevel = 2,
  flush = false,
  children,
  className,
  testId,
}: SectionCardProps) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as const;

  const classes = ["wep-card", flush ? "p-0" : "", className].filter(Boolean).join(" ");

  const header = title ? (
    <div className={`flex items-start justify-between gap-3 ${flush ? "p-4 pb-3" : "mb-3"}`}>
      <div className="min-w-0">
        <Heading id={headingId} className="text-sm font-semibold text-ink">
          {title}
        </Heading>
        {description ? <p className="mt-0.5 text-xs text-ink-subtle">{description}</p> : null}
      </div>
      {headerAside ? <div className="flex-none">{headerAside}</div> : null}
    </div>
  ) : null;

  // Untitled: a plain div. An unnamed <section> adds a landmark with nothing to
  // announce, which makes the region list noisier, not more useful.
  if (!title) {
    return (
      <div className={classes} data-testid={testId}>
        {children}
      </div>
    );
  }

  return (
    <section className={classes} aria-labelledby={headingId} data-testid={testId}>
      {header}
      {flush ? children : <div>{children}</div>}
    </section>
  );
}
