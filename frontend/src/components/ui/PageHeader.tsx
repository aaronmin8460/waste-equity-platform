"use client";

/**
 * PageHeader — the title block at the top of a view: the view's single `<h1>`, a
 * short description, and an optional metadata/status slot.
 *
 * CONTRACT — exactly one `<h1>` per view. This component renders that `<h1>`, so a
 * view that uses it must not render another, and the app bar deliberately renders
 * none (`components/ui/TopNavigation.tsx`). `app/shell.test.tsx` and
 * `app/accessibility.test.tsx` assert the count in every area.
 *
 * It holds NO page-specific content: title, description, and meta are all supplied
 * by the caller, so the same component titles 지역 부담, 후보지 분석, and any later
 * view without special-casing.
 *
 * `children` renders after the header block, inside the same container — that is
 * where the existing `mode-orientation` strip goes, which keeps the document order
 * `h1` → orientation that `app/shell.test.tsx` asserts.
 *
 * The `meta` slot is for provenance the repo requires next to a metric (source,
 * reference period, a `DataStatusBadge`). It never fabricates one: when the caller
 * passes nothing, nothing renders.
 */

import type { ReactNode } from "react";

export interface PageHeaderProps {
  /** The view's `<h1>` text. */
  title: string;
  /** One short supporting line. */
  description?: ReactNode;
  /** Optional metadata/status area (reference period, provenance badge, count). */
  meta?: ReactNode;
  /** Rendered below the header block — e.g. the mode-orientation strip. */
  children?: ReactNode;
  className?: string;
  testId?: string;
}

export default function PageHeader({
  title,
  description,
  meta,
  children,
  className,
  testId,
}: PageHeaderProps) {
  return (
    <header className={className} data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-ink">{title}</h1>
          {description ? <p className="mt-0.5 text-xs text-ink-subtle">{description}</p> : null}
        </div>
        {meta ? <div className="flex-none text-xs text-ink-subtle">{meta}</div> : null}
      </div>
      {children}
    </header>
  );
}
