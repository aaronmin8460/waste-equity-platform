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
      {/* 16px / 700.

          The frame reports 21.68px, but frame 156:470 is SCALED: its `strokeWeight`
          is 1.354808 where the unscaled sibling artboards (page-1 74:1992 at 1440,
          modal1 221:441 at 1180) both report 1.0. Dividing by that factor turns
          essentially every value in the frame into an exact integer — 1040 wide,
          976 content, 32 gutter, 22 section gap, 14 radius — and lands the type on
          the same scale the unscaled sibling modal uses (title 20, card title 13,
          body 12, small 11). So the design width is 1040, not 1300, and the heading
          is 16px. The app's dialog is 1088 (`.wep-dialog` max-width 68rem), a 1.046
          ratio, so the frame's px apply about 1:1.

          A previous pass read the scale as 1.0838 and rendered this at 20px, which
          made every heading, tile and card on the screen ~25% larger than the frame. */}
      <h2 id={headingId} className="text-base font-bold text-ink">
        {title}
      </h2>
      {/* 12.5px × 1.046 ≈ 13; the frame's heading→description gap is 8. */}
      {description ? <p className="mt-2 text-[13px] text-ink-subtle">{description}</p> : null}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}
