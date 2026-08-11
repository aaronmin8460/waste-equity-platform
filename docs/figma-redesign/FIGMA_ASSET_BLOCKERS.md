# Figma asset blockers

Assets from the Phase 0 icon list that could **not** be retrieved as exact Figma vectors.

Per the client's P0 requirement, none of these has been substituted with Lucide, Font
Awesome, Material, Heroicons, emoji, a Unicode symbol, or a hand-drawn approximation, and
none has been fabricated. They are recorded here and left unimplemented until resolved.

Investigated 2026-08-11 against file `hETmPv3N31IJeW8XdLwoiS` (`lastModified
2026-08-11T04:32:17Z`), searched exhaustively: every node on both pages (`design`,
`back up`), plus the file's whole component and component-set index.

Successfully exported assets are in [FIGMA_ASSET_INVENTORY.md](FIGMA_ASSET_INVENTORY.md).

---

## A. Present in the design, but drawn as text rather than as a vector

These three exist in the six frames — but as **TEXT nodes set in Noto Sans KR**, not as
icon geometry. There is no vector to export. Rendering them as an SVG would mean drawing a
new glyph, which is precisely the substitution the requirement forbids.

| Icon | Figma page / frame | Node | UI location | Why extraction failed |
|---|---|---|---|---|
| `close` / `x-close` | design / page-1, page-4, page-6 | `223:451`, `226:624`, `156:475` (instances of `Icon Button / Close`, master `76:1096`) | Map region popup; 후보지 심층 분석 modal; 데이터·출처 modal | The instance's only child is a TEXT node `✕` (U+2715). The button chrome is a frame; the mark itself is a typed character. |
| `zoom-in` | design / page-1 | `74:2052` → text child `I74:2052;2:34` | Map zoom control | TEXT node `+` (U+002B). |
| `zoom-out` | design / page-1 | `74:2053` → text child `I74:2053;2:36` | Map zoom control | TEXT node `−` (U+2212, true minus). |

**Note.** The shipped UI already renders `✕` as a text character (`ui/Chip.tsx`,
`ui/Dialog.tsx`), so it currently matches Figma. Decide in Phase 1 whether to keep them as
text (faithful to Figma, zero risk) or ask the designer for real vectors.

## B. Not present anywhere in the file

No node, component, or component set under these names — or any visual equivalent used by
the six frames.

| Icon | Intended UI location | Why extraction failed |
|---|---|---|
| `refresh` | filter/scenario reset | Not in the file. |
| `dots-vertical` | row overflow menu | Not in the file. |
| `chevron-up` | disclosure / collapsible panel | Not in the file (but see §C). |
| `chevron-down` | disclosure / select field | Not in the file (but see §C). |
| `download-01` | CSV / XLSX export buttons | Not in the file (but see §C). |
| `arrow-up` | rank-change delta | Not in the file. |
| `arrow-down` | rank-change delta | Not in the file. |
| `arrow-up-right` | outbound source link | Not in the file. |
| `arrow-right` | "see more" affordance | Not in the file. |

The six frames express these differently: `Select Field` and the disclosures carry no
chevron child of their own (the master is external and undecorated), rank deltas are TEXT
(`+15%p ↑`, `-10%p ↓`, `▲`, `▼`), and export controls are `Button/Style=Outline` instances
with a text label and no icon.

## C. Available, but from a different design system in the same file

The `back up` page holds an **unrelated imported template** (layers named `TESLA`,
`Sidebar/…`, `Reports`, `Leaderboard Arrow`, `Photo / Thomas`). It contains components that
would satisfy some of §B:

| Component | Node | Would cover |
|---|---|---|
| `Icon / Chevron-Up` | `45:303` | `chevron-up` |
| `Icon / Chevron-Right` | `45:258` | `arrow-right` |
| `Icon / Download` | `45:283` | `download-01` |
| `Icon / More-Horizontal` | `45:252` | `dots-vertical` (horizontal, not vertical) |
| `Icon / Arrow Full Down` | `45:575` | `arrow-down` |
| `Icon=arrow-left` | `45:600` | — |

**These have deliberately not been used.** None is referenced by any of the six design
frames, and they belong to a different product's kit, so adopting them would be a
substitution — the same defect as reaching for Lucide, just sourced from inside the file.
Using them is a **client/designer decision**, not an implementation one.

## D. Grade badges

The Phase 0 brief mentions "ABC grade badge visuals". **No A/B/C badge exists in the file.**

The six frames grade with Korean TEXT labels — `1급` through `6급`, alongside `1위 · 통과
후보` style rank text. Searching every `COMPONENT`, `COMPONENT_SET`, `INSTANCE` and `FRAME`
whose name contains "grade", "badge", or "등급" returned nothing.

The shipped app already has `suitability/RelativeGradeChip.tsx` and the `.wep-grade` class.
Whether the redesign keeps those or adopts the `N급` wording is a Page 4/5 question.

---

## Resolving these

1. **Ask the designer to publish the missing icons as vectors** in the `design` page — the
   cleanest fix; §A and §B then export with the existing tooling and no code changes.
2. **Confirm §A stays typographic.** If `✕ + −` are intended as text, mark them resolved and
   keep the current text rendering.
3. **Explicitly approve §C** if the `back up` kit is in fact the intended source.

Until a decision is recorded here, no phase may ship a lookalike for any icon above.
