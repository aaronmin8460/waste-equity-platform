/**
 * generate-figma-icons.mjs — turn the committed Figma SVG exports into a typed
 * registry the app can render inline.
 *
 * WHY A GENERATOR AND NOT HAND-WRITTEN JSX
 * The client requirement is that the site ships the ACTUAL Figma vectors, not
 * lookalikes. Re-typing path data by hand is exactly how a "close enough" icon
 * gets in. This script copies the geometry verbatim from the exported files, so
 * `figmaIcons.generated.ts` can always be reproduced from the SVGs and a diff
 * proves nothing drifted:
 *
 *     npm run icons:generate   # then `git diff --exit-code` must be empty
 *
 * WHAT IT CHANGES, AND THE ONE THING IT REWRITES
 * viewBox, intrinsic width/height, path/rect geometry, stroke-width, linecap and
 * linejoin are copied byte-for-byte. The ONLY rewrite is the literal colour
 * `#111A56` -> `currentColor`. Figma bakes the brand navy into every export, but
 * the navigation has to render the same glyph in an active and an inactive
 * colour, which a hard-coded hex cannot do. #111A56 is already the value of the
 * --color-brand / --color-primary token (app/globals.css), so an icon left at its
 * default `color` still paints the exact Figma navy.
 *
 * Re-run after adding or re-exporting any file in public/icons/figma/.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ICON_DIR = resolve(here, "..", "public", "icons", "figma");
const OUT_FILE = resolve(here, "..", "src", "components", "ui", "figmaIcons.generated.ts");

/** The Figma brand navy, baked into every export. See the header comment. */
const FIGMA_BRAND_NAVY = /#111A56/gi;

/**
 * Provenance: which Figma node each file came from. Recorded here (and mirrored in
 * docs/figma-redesign/FIGMA_ASSET_INVENTORY.md) so a future re-export can target
 * the same node instead of guessing.
 */
const PROVENANCE = {
  "logo-target-01": { node: "74:1996", component: "target-01", where: "Header/Brandmark/Logo" },
  "nav-region-marker-02": { node: "74:2725", component: "marker-02", where: "Nav / 지역 지표" },
  "nav-waste-barchart": {
    node: "I74:2002;51:404",
    component: "BarChart (flattened frame, not a library component)",
    where: "Nav / 폐기물 처리 현황",
  },
  "nav-candidate-file-02": { node: "74:2664", component: "file-02", where: "Nav / 후보지 분석" },
  "nav-analysis-audio-settings-01": {
    node: "74:2618",
    component: "audio-settings-01",
    where: "Nav / 후보지 심층 분석",
  },
  "nav-compare-column-vertical-01": {
    node: "74:2542",
    component: "column-vertical-01",
    where: "Nav / 후보지 심층 비교",
  },
  "nav-data-server-02": { node: "74:2469", component: "server-02", where: "Nav / 데이터·출처" },
};

const FIGMA_FILE_KEY = "hETmPv3N31IJeW8XdLwoiS";

function parse(svg, name) {
  const open = svg.match(/<svg\b[^>]*>/);
  if (!open) throw new Error(`${name}: no <svg> root`);
  const attrs = open[0];

  const viewBox = attrs.match(/viewBox="([^"]+)"/)?.[1];
  const width = attrs.match(/\bwidth="([\d.]+)"/)?.[1];
  const height = attrs.match(/\bheight="([\d.]+)"/)?.[1];
  if (!viewBox || !width || !height) {
    throw new Error(`${name}: missing viewBox/width/height — refusing to guess`);
  }

  // Everything between the root tags, verbatim apart from the colour rewrite.
  const body = svg
    .slice(open.index + attrs.length, svg.lastIndexOf("</svg>"))
    .replace(FIGMA_BRAND_NAVY, "currentColor")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("");

  if (!body) throw new Error(`${name}: empty body`);
  // A stray colour that is not the brand navy would silently ship off-palette.
  const stray = body.match(/#[0-9a-f]{3,8}/i);
  if (stray) throw new Error(`${name}: unexpected hard-coded colour ${stray[0]}`);

  return { viewBox, width: Number(width), height: Number(height), body };
}

const files = readdirSync(ICON_DIR).filter((f) => f.endsWith(".svg")).sort();
if (files.length === 0) throw new Error(`no SVGs in ${ICON_DIR}`);

const entries = files.map((file) => {
  const name = file.replace(/\.svg$/, "");
  const parsed = parse(readFileSync(join(ICON_DIR, file), "utf8"), file);
  const prov = PROVENANCE[name];
  if (!prov) throw new Error(`${file}: no PROVENANCE entry — add its Figma node id`);
  return { name, file, ...parsed, ...prov };
});

const lines = [
  "/**",
  " * GENERATED FILE — DO NOT EDIT BY HAND.",
  " *",
  " * Source: frontend/public/icons/figma/*.svg, exported from the Figma file",
  ` * ${FIGMA_FILE_KEY} (page \"design\") via the Figma REST images API.`,
  " * Regenerate with `npm run icons:generate`.",
  " *",
  " * Geometry, viewBox, intrinsic size, stroke-width, linecap and linejoin are",
  " * verbatim from Figma. The literal #111A56 is rewritten to `currentColor` so a",
  " * single glyph can render in an active and an inactive colour; that hex is the",
  " * value of --color-brand, so the default `color` still paints the exact navy.",
  " */",
  "",
  "export interface FigmaIconSpec {",
  "  /** Verbatim Figma viewBox. */",
  "  viewBox: string;",
  "  /** Intrinsic width in px, as drawn in Figma. */",
  "  width: number;",
  "  /** Intrinsic height in px, as drawn in Figma. */",
  "  height: number;",
  "  /** Inner SVG markup, verbatim apart from the currentColor rewrite. */",
  "  body: string;",
  "  /** Figma node id this was exported from. */",
  "  node: string;",
  "  /** Figma component (or frame) name. */",
  "  component: string;",
  "  /** Where it appears in the design. */",
  "  where: string;",
  "}",
  "",
  "export const FIGMA_ICONS = {",
];

for (const e of entries) {
  lines.push(`  ${JSON.stringify(e.name)}: {`);
  lines.push(`    viewBox: ${JSON.stringify(e.viewBox)},`);
  lines.push(`    width: ${e.width},`);
  lines.push(`    height: ${e.height},`);
  lines.push(`    body: ${JSON.stringify(e.body)},`);
  lines.push(`    node: ${JSON.stringify(e.node)},`);
  lines.push(`    component: ${JSON.stringify(e.component)},`);
  lines.push(`    where: ${JSON.stringify(e.where)},`);
  lines.push("  },");
}

lines.push("} as const satisfies Record<string, FigmaIconSpec>;");
lines.push("");
lines.push("/** Every locally committed exact-Figma icon. */");
lines.push("export type FigmaIconName = keyof typeof FIGMA_ICONS;");
lines.push("");

writeFileSync(OUT_FILE, lines.join("\n"), "utf8");
console.log(`generated ${entries.length} icons -> ${OUT_FILE}`);
for (const e of entries) {
  console.log(`  ${e.name.padEnd(34)} ${e.width}x${e.height}  node=${e.node}`);
}
