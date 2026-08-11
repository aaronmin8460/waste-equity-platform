"use client";

/**
 * One section of the 데이터·출처 modal: a heading, a supporting line, and content.
 *
 * WHY THIS EXISTS RATHER THAN `ui/SectionCard`
 * --------------------------------------------
 * Figma frame 156:470 renders this screen's sections with NO card chrome. The modal
 * surface is already white, and the frame reserves the bordered/filled surface for
 * the things that are genuinely one record — the four overview tiles and the source
 * cards. Wrapping each section in `.wep-card` (white + hairline + 20px radius)
 * therefore drew a white box on a white box, six times, which is exactly the "tray of
 * floating tiles" the civic refresh set out to remove.
 *
 * WHAT IS NOT GIVEN UP
 * --------------------
 * The accessibility contract of `SectionCard` is reproduced exactly, because
 * `TransparencyDashboard.test.tsx` ("names every card section as a region") and the
 * screen-reader outline both depend on it:
 *
 *   - a real `<section>`, never a `<div>`;
 *   - `aria-labelledby` pointing at a VISIBLE `<h2>` (never `sr-only`), so the
 *     region's accessible name is the same string the reader sees;
 *   - the optional description is a sibling `<p>`, so it never joins the name.
 *
 * Heading level is fixed at 2: inside the dialog the `<h2>` sits under the dialog's
 * own title, and on the standalone page under the single `<h1>`. Either way 2 is
 * correct, and making it configurable would invite a call site to break the outline.
 */

import { useId } from "react";
import type { ReactNode } from "react";

export interface TransparencySectionProps {
  /** Visible heading. Also the section's accessible name. */
  title: string;
  /** Short supporting line under the heading. */
  description?: ReactNode;
  children: ReactNode;
  testId?: string;
}

export default function TransparencySection({
  title,
  description,
  children,
  testId,
}: TransparencySectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid={testId}>
      {/* 20px / 700 in Figma (measured 21.68px on the 1.0838-scaled frame). */}
      <h2 id={headingId} className="text-xl font-bold text-ink">
        {title}
      </h2>
      {description ? <p className="mt-1.5 text-sm text-ink-subtle">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}
