/**
 * Asset-integrity checks for the exact-Figma icon set.
 *
 * The client requirement is that the site ship the ACTUAL Figma vectors. Two ways
 * that quietly breaks: someone hand-edits the generated registry so it no longer
 * matches the exported SVG, or someone drops a lookalike SVG into the icon folder.
 * These tests read the committed files and fail on either.
 *
 * They are the reason `npm run icons:generate` is safe to re-run: if the generator
 * and the committed output ever disagree, this suite says so.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIGMA_ICONS } from "./figmaIcons.generated";

const ICON_DIR = join(process.cwd(), "public", "icons", "figma");

const svgFiles = readdirSync(ICON_DIR)
  .filter((f) => f.endsWith(".svg"))
  .sort();

describe("figma icon assets", () => {
  it("has a registry entry for every committed SVG, and no phantom entries", () => {
    const fromDisk = svgFiles.map((f) => f.replace(/\.svg$/, ""));
    expect(Object.keys(FIGMA_ICONS).sort()).toEqual(fromDisk);
  });

  it("registry geometry matches the exported SVG byte-for-byte (modulo currentColor)", () => {
    for (const [name, spec] of Object.entries(FIGMA_ICONS)) {
      const raw = readFileSync(join(ICON_DIR, `${name}.svg`), "utf8");
      const open = raw.match(/<svg\b[^>]*>/);
      expect(open, `${name}: no <svg> root`).toBeTruthy();

      const body = raw
        .slice(open!.index! + open![0].length, raw.lastIndexOf("</svg>"))
        .replace(/#111A56/gi, "currentColor")
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("");

      expect(spec.body, `${name} drifted from its SVG — re-run npm run icons:generate`).toBe(body);
      expect(open![0]).toContain(`viewBox="${spec.viewBox}"`);
      expect(open![0]).toContain(`width="${spec.width}"`);
      expect(open![0]).toContain(`height="${spec.height}"`);
    }
  });

  it("records the Figma node every icon came from", () => {
    for (const [name, spec] of Object.entries(FIGMA_ICONS)) {
      // e.g. "74:2725" or the nested-instance form "I74:2002;51:404".
      expect(spec.node, `${name} has no usable Figma node id`).toMatch(/^I?\d+:\d+(;\d+:\d+)?$/);
      expect(spec.component.length).toBeGreaterThan(0);
    }
  });

  it("carries no colour other than the brand navy it was drawn in", () => {
    for (const file of svgFiles) {
      const raw = readFileSync(join(ICON_DIR, file), "utf8");
      const colours = new Set((raw.match(/#[0-9a-f]{3,8}/gi) ?? []).map((c) => c.toUpperCase()));
      expect([...colours], `${file} has an off-palette colour`).toEqual(
        colours.size ? ["#111A56"] : [],
      );
    }
  });

  it("embeds no external reference", () => {
    for (const file of svgFiles) {
      const raw = readFileSync(join(ICON_DIR, file), "utf8");
      expect(raw, `${file} references something outside the repo`).not.toMatch(
        /https?:\/\/(?!www\.w3\.org)|<image\b|xlink:href/i,
      );
    }
  });
});
