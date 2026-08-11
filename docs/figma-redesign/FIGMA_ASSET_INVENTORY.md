# Figma asset inventory — exact vectors committed

Source file: `hETmPv3N31IJeW8XdLwoiS` ("UI/UX"), page **design**, `lastModified 2026-08-11T04:32:17Z`.
Exported 2026-08-11 via the Figma REST images API (`GET /v1/images/:key?format=svg`,
`svg_simplify_stroke=true`, `svg_outline_text=false`) so strokes stay strokes rather than
being flattened into masks.

Everything below is the **actual Figma vector**. No icon in this table was drawn, traced,
approximated, or taken from a third-party set. Assets that could not be retrieved are in
[FIGMA_ASSET_BLOCKERS.md](FIGMA_ASSET_BLOCKERS.md) — they are recorded there rather than
substituted.

## Committed files

Location: `frontend/public/icons/figma/`

| File | Figma component | Node id | Intrinsic | UI location |
|---|---|---|---|---|
| `logo-target-01.svg` | `target-01` | `74:1996` | 41×41 | Brand mark, app header |
| `nav-region-marker-02.svg` | `marker-02` | `74:2725` | 18×20 | Nav — 지역 지표 |
| `nav-waste-barchart.svg` | `BarChart` (frame) | `I74:2002;51:404` | 14×14 | Nav — 폐기물 처리 현황 |
| `nav-candidate-file-02.svg` | `file-02` | `74:2664` | 17×20 | Nav — 후보지 분석 |
| `nav-analysis-audio-settings-01.svg` | `audio-settings-01` | `74:2618` | 20×17 | Nav — 후보지 심층 분석 |
| `nav-compare-column-vertical-01.svg` | `column-vertical-01` | `74:2542` | 17×20 | Nav — 후보지 심층 비교 |
| `nav-data-server-02.svg` | `server-02` | `74:2469` | 17×20 | Nav — 데이터·출처 |

The nav mapping was not assumed from the labels. It was read from layer visibility inside
each `Nav Button` instance and is **identical across all five full-page frames**
(74:1992, 125:5064, 129:5709, 136:8684, 167:10554).

### Two things worth knowing about these assets

**`nav-waste-barchart` is not a library component.** The other five nav glyphs are
instances of Untitled-UI-style components (`marker-02`, `file-02`, …) whose masters live in
an external library. 폐기물 처리 현황 instead uses a frame named `BarChart` built from three
rounded `<rect>`s inside the `Nav Button` component's `IconSlot`. It is exported the same
way and is equally exact — it just has no master component to cite.

**The masters are external.** `Nav Button`, `Icon Button / Close`, `Select Field`, `Zoom
Button`, `Pill Toggle`, `Rank Row`, `Card` and `Button` resolve to components that are not
defined in this file. Their on-page instances render and export fine, but their definitions
cannot be inspected here — relevant if a later phase needs variant states.

## How these become React

`frontend/scripts/generate-figma-icons.mjs` reads the committed SVGs and writes
`frontend/src/components/ui/figmaIcons.generated.ts`. Geometry, `viewBox`, intrinsic size,
`stroke-width`, `stroke-linecap` and `stroke-linejoin` are copied verbatim.

The single rewrite is `#111A56` → `currentColor`, because the navigation must render the
same glyph in an active and an inactive colour and a baked hex cannot. `#111A56` is already
the value of `--color-brand` / `--color-primary`, so an icon at its default `color` paints
the exact Figma navy.

```
npm run icons:generate     # then `git diff --exit-code` must be clean
```

`figmaIcons.generated.test.ts` re-reads the SVGs on every test run and fails if the registry
drifts, if an off-palette colour appears, or if an asset gains an external reference.

## Re-exporting

```bash
curl -s -G -H "X-Figma-Token: $FIGMA_TOKEN" \
  --data-urlencode "ids=74:1996,74:2725,I74:2002;51:404,74:2664,74:2618,74:2542,74:2469" \
  --data-urlencode "format=svg" --data-urlencode "svg_simplify_stroke=true" \
  https://api.figma.com/v1/images/hETmPv3N31IJeW8XdLwoiS
```

The token is a credential: keep it in the environment, never in the repo (repo `AGENTS.md`).
A token needs the **file content: read** scope; `current_user:read` is not required.
