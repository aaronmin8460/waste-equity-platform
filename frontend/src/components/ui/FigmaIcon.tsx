"use client";

/**
 * FigmaIcon — renders one of the exact vectors exported from the project's Figma
 * file, and nothing else.
 *
 * WHY THIS EXISTS
 * The nav and brand glyphs in the shipped UI are hand-drawn approximations written
 * as inline <path> data (see ui/TopNavigation.tsx). The client requirement for the
 * six-page redesign is that the site show the ACTUAL Figma icons. This component is
 * the single place that renders them, so "is this the real icon?" has one answer.
 *
 * THE REGISTRY IS CLOSED ON PURPOSE
 * `name` is typed to `FigmaIconName`, which is derived from the files committed in
 * public/icons/figma/. There is no string fallback, no remote URL, and no
 * third-party icon library behind it: an icon that was never exported from Figma
 * cannot be referenced, so a missing asset is a TYPE ERROR rather than a silent
 * substitution. Icons that could not be exported are listed, with the reason, in
 * docs/figma-redesign/FIGMA_ASSET_BLOCKERS.md — do not paper over one of those with
 * a lookalike from another set.
 *
 * ACCESSIBILITY
 * Decorative by default: an icon sitting next to its own text label (every nav tab,
 * the brand mark beside the product name) is `aria-hidden` and contributes NO
 * accessible text, so a screen reader announces the label once rather than twice.
 * Pass `title` only when the icon is the sole carrier of meaning — then it becomes
 * `role="img"` with an accessible name.
 *
 * SIZING
 * Icons default to the intrinsic width/height they were drawn at in Figma. `size`
 * scales both axes by the SAME factor so the glyph fits a size x size box without
 * ever being stretched — these vectors are not all square (17x20, 20x17, 14x14),
 * so forcing width = height = size would distort them.
 */

import { FIGMA_ICONS, type FigmaIconName } from "./figmaIcons.generated";

export type { FigmaIconName };

export interface FigmaIconProps {
  /** Which committed Figma export to render. */
  name: FigmaIconName;
  /**
   * Fit the glyph inside a `size` x `size` box, preserving its aspect ratio.
   * Omit to render at the intrinsic Figma dimensions.
   */
  size?: number;
  /**
   * Accessible name. Provide ONLY when the icon is not accompanied by visible text
   * that already says the same thing; otherwise the icon stays decorative.
   */
  title?: string;
  /** Applied to the <svg>. Colour comes from `currentColor`, so set text-* here. */
  className?: string;
  testId?: string;
}

/** `<title>` is injected as markup, so its text must be escaped. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function FigmaIcon({ name, size, title, className, testId }: FigmaIconProps) {
  const icon = FIGMA_ICONS[name];

  // Uniform scale — never width=size, height=size, which would stretch a 17x20 glyph.
  const scale = size === undefined ? 1 : size / Math.max(icon.width, icon.height);
  const width = Math.round(icon.width * scale * 1000) / 1000;
  const height = Math.round(icon.height * scale * 1000) / 1000;

  const decorative = title === undefined;
  // React forbids children alongside dangerouslySetInnerHTML, so the optional
  // <title> is concatenated into the same markup string as the Figma geometry.
  const markup = decorative ? icon.body : `<title>${escapeXml(title)}</title>${icon.body}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={icon.viewBox}
      width={width}
      height={height}
      fill="none"
      focusable="false"
      // Decorative icons are removed from the tree entirely; a titled icon is an
      // image whose accessible name is the <title>.
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : "img"}
      className={className}
      data-testid={testId}
      data-figma-icon={name}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
