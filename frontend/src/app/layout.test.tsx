/**
 * Root layout contracts — the two things the six-page Figma forensic audit found
 * drifting silently, both of which are invisible until someone looks.
 *
 *   1. The DOCUMENT TITLE and the app bar's brand block are one string, not two
 *      copies of one string. The audit found the tab still saying 쓰레기 매립지 while
 *      the header had moved on; hard-coding the subtitle here is what made that
 *      possible, so the title is now composed from the same `lib/glossary` constants
 *      the header and the narrow-screen gate render.
 *   2. Every font WEIGHT the UI asks for is a weight `next/font` actually loads. A
 *      missing weight is not an error anywhere — the browser quietly substitutes the
 *      nearest face or synthesises one — so nothing fails until a designer compares
 *      screenshots. `font-semibold` was in that state at 132 call sites.
 *
 * `next/font/google` is mocked: outside `next build` it is a compile-time transform
 * and throws when imported directly. The mock returns the same shape the transform
 * emits, which is all this module uses.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Noto_Sans_KR: () => ({ variable: "--font-noto-sans-kr", className: "noto" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono", className: "mono" }),
}));

import { BRAND_NAME, BRAND_SUBTITLE } from "../lib/glossary";
import { metadata, viewport } from "./layout";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("document metadata names the product exactly once", () => {
  it("composes the browser title from the shared brand constants", () => {
    // Not `toContain` on a literal: the point is that the title is DERIVED, so a
    // future subtitle edit in lib/glossary moves the tab with the header.
    expect(metadata.title).toBe(`${BRAND_NAME} — ${BRAND_SUBTITLE}`);
    expect(metadata.title).toBe("여기다 — 폐기물 처리시설 입지 추천 플랫폼");
  });

  it("describes the product with the corrected facility terminology", () => {
    // 매립지 named one disposal route; the product analyses 소각·재활용·매립 alike.
    const description = String(metadata.description);
    expect(description).toContain("폐기물 처리시설");
    expect(description).not.toContain("매립지");
  });

  it("keeps pinch-zoom available", () => {
    // A width-based desktop gate must never be paired with a zoom lock: zooming is
    // how a low-vision reader uses the desktop app at all (WCAG 1.4.4).
    expect(viewport.width).toBe("device-width");
    expect(viewport.initialScale).toBe(1);
    expect(viewport.userScalable).toBeUndefined();
  });
});

// --------------------------------------------------------------------------- //
// Static font-weight audit.
// --------------------------------------------------------------------------- //

/** Tailwind's named weights, in the only mapping that matters here. */
const UTILITY_WEIGHTS: Record<string, string> = {
  thin: "100",
  extralight: "200",
  light: "300",
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
  black: "900",
};

/** Every `.ts`/`.tsx`/`.css` file under `src`, excluding the tests themselves. */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((rel) => /\.(tsx?|css)$/.test(rel) && !/\.test\.tsx?$/.test(rel))
    .map((rel) => path.join(SRC, rel));
}

/**
 * Strip comments before scanning.
 *
 * This repository documents its CSS heavily, and several docblocks — including the
 * one directly above the font loader — discuss weights by name. Prose about a weight
 * is not a use of it, and counting it would let a genuinely dead download look alive.
 * The `//` rule is guarded on a preceding `:` so a URL is never mistaken for one.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The weights the UI genuinely renders at, from utilities and raw declarations. */
function weightsUsedInSource(): Set<string> {
  const used = new Set<string>();
  for (const file of sourceFiles()) {
    const text = withoutComments(readFileSync(file, "utf8"));
    for (const [name, weight] of Object.entries(UTILITY_WEIGHTS)) {
      // Word-bounded so `font-semibold` never matches inside a longer token.
      if (new RegExp(`\\bfont-${name}\\b`).test(text)) used.add(weight);
    }
    for (const match of text.matchAll(/font-weight:\s*(\d{3})/g)) used.add(match[1]);
    for (const match of text.matchAll(/\bfont-\[(\d{3})\]/g)) used.add(match[1]);
  }
  return used;
}

/** The weights `layout.tsx` asks `next/font/google` to download for Noto Sans KR. */
function weightsLoadedForNotoSansKr(): Set<string> {
  const source = readFileSync(path.join(SRC, "app/layout.tsx"), "utf8");
  const call = source.slice(source.indexOf("Noto_Sans_KR("));
  const array = call.slice(call.indexOf("weight:"), call.indexOf("display:"));
  return new Set(Array.from(array.matchAll(/"(\d{3})"/g), (m) => m[1]));
}

describe("the Korean face loads exactly the weights the UI renders at", () => {
  it("loads a real face for every weight the source asks for", () => {
    const loaded = weightsLoadedForNotoSansKr();
    const missing = [...weightsUsedInSource()].filter((w) => !loaded.has(w)).sort();
    // A missing weight fails silently in the browser — it substitutes the nearest
    // face or synthesises one — so this assertion is the only place it shows up.
    // 600 (`font-semibold`) was missing at 132 call sites before the audit.
    expect(missing, `weights used but never downloaded: ${missing.join(", ")}`).toEqual([]);
  });

  it("downloads no weight the UI never uses", () => {
    const used = weightsUsedInSource();
    const dead = [...weightsLoadedForNotoSansKr()].filter((w) => !used.has(w)).sort();
    // Each weight of a CJK face is a large download. 800 was loaded and referenced
    // nowhere — the brand wordmark it was claimed for renders at 700.
    expect(dead, `weights downloaded but never used: ${dead.join(", ")}`).toEqual([]);
  });

  it("still declares the expected set, so a silent widening is visible in review", () => {
    expect([...weightsLoadedForNotoSansKr()].sort()).toEqual(["400", "500", "600", "700"]);
  });
});
