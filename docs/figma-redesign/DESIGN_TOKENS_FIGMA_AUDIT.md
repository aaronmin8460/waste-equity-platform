# Design tokens — Figma vs. the shipped token set

Measured 2026-08-11 from `hETmPv3N31IJeW8XdLwoiS`, page **design**, frames 74:1992,
125:5064, 129:5709, 136:8684, 167:10554, 156:470. Values were read from the Figma REST API
(866 TEXT nodes, all fills, strokes, corner radii, padding and auto-layout gaps) — none was
eyeballed from a screenshot.

**Headline: the existing token set already encodes the Figma design.** The 여기다 refresh
that shipped to production was built from this same Figma file, so most roles match to the
hex. Phase 0 therefore adds a little and re-points nothing.

## 1. Typography

| Property | Figma | Shipped | Verdict |
|---|---|---|---|
| Family | **Noto Sans KR** (866/866 TEXT nodes) | `--font-sans: var(--font-noto-sans-kr), …` | **match** |
| Weights | 400 (391), 500 (69), 700 (401), 900 (5) | Tailwind defaults | **match** |
| Sizes | 13 (117), 12 (106), 14 (67), 16 (59), 11 (56), 20 (17), 10 (23) | Tailwind `text-*` | **match** |

Fractional sizes in the raw data (12.5, 15.6, 16.3, 11.5, 14.2, 13.8) are scaling artefacts:
frame `156:470` is 1409 px wide and several inner frames are scaled, so their type is
reported off-grid. The integer ladder above is the real one. **Weight 900 (5 uses) has no
Tailwind default in use today** — check before Page 2/5 relies on it.

## 2. Colour — already matching

| Role | Figma | Shipped token | |
|---|---|---|---|
| Brand / action navy | `#111A56` (417 text + 177 fill + 25 stroke) | `--color-brand`, `--color-primary` | **exact** |
| Surface | `#FFFFFF` (225) | `--color-surface` | **exact** |
| Canvas | `#F9F9F9` (26) | `--color-canvas` | **exact** |
| Tertiary ink | `#848A95` (260) | `--color-ink-faint` | **exact** |
| Caption ink | `#646676` (21) | `--color-ink-subtle` | **exact** |

`#111A56` matching is what lets every exported icon become `currentColor` without shifting
hue — see [FIGMA_ASSET_INVENTORY.md](FIGMA_ASSET_INVENTORY.md).

## 3. Colour — Figma differs, and Phase 0 deliberately does NOT change it

Each of these would restyle **all six pages at once**. That is a visual decision belonging to
each page's own phase, where it can be reviewed against that page's Figma frame — not to an
infrastructure step whose contract is "no page-specific behaviour change".

| Role | Shipped | Figma | Δ | Deferred to |
|---|---|---|---|---|
| `--color-hairline` | `#e6e7ee` | `#EFF0F6` (43 fill + 43 stroke) | lighter, cooler | Page 1 shell |
| `--color-primary-soft` | `#eef0f8` | `#EEF0F6` (27) | ~1 step | Page 1 shell |
| `--color-primary-border` | `#c5cbe4` | `#D7DCEE` (58) | lighter | Page 1 shell |
| `--color-surface-muted` | `#f4f5f8` | `#F5F6FA` (17) | ~1 step | Page 1 shell |
| `--color-success` | `#047857` | `#188A52` (27) | brighter | Page 2/4 |
| `--color-warn` | `#a05a00` | `#B3790A` | brighter | Page 2/4 |
| `--color-danger` | `#b91c1c` | `#E82117` | brighter | Page 2/4 |

**Accessibility gate — the status trio must not be adopted wholesale.** The Figma status
colours are brighter, i.e. lower contrast. Measured on white:

| Role | Shipped | Figma | Figma verdict at body size |
|---|---|---|---|
| danger | `#b91c1c` 6.47:1 | `#E82117` **4.51:1** | scrapes past 4.5:1 |
| success | `#047857` 5.48:1 | `#188A52` **4.38:1** | **fails 4.5:1** |
| warn | `#a05a00` 5.31:1 | `#B3790A` **3.71:1** | **fails 4.5:1** |

Two of the three fall below the 4.5:1 body-text threshold that `docs/ACCESSIBILITY.md` and
the `globals.css` token comments hold the palette to. Adopting them for small text would be
an accessibility regression. When Page 2/4 reaches these, either keep the shipped values for
text and use the Figma hues for fills/borders only, or take the contrast question back to the
designer. Do not silently swap them.

### Not tokens, on purpose

`#E39490` (111×), `#188A52` (70×) and `#B3790A` (63×) appear at **alpha 0.55** — these are
map choropleth / legend fills. `globals.css` states the analytical palette is the single
source of truth in `lib/metrics.ts` and is deliberately not tokenised, so the legend always
reads the same constants the MapLibre fill uses. Phase 0 respects that boundary. `#1B59F8`,
`#AFC3FB`, `#9DBBFF`, `#0C3AE0`, `#B23A78` are likewise chart series colours.

## 4. Radii — already matching

| Figma | Count | Shipped | |
|---|---|---|---|
| 20 px | 41 | `--radius-card: 1.25rem` | **exact** |
| 10 px | 91 | `--radius-control: 0.625rem` | **exact** |
| 999 px | nav track | `--radius-pill: 9999px` | **match** |
| 3 px | 454 | — | chart bars/rects, not chrome |
| 40 px | 21 | added as `--figma-nav-tab-radius` | active nav pill |
| 11 px | logo | added as `--figma-brand-logo-radius` | brand mark |

## 5. What Phase 0 actually added

Additive only — nothing existing was re-pointed, and none of it is referenced by a rendering
component yet, so the six pages are byte-identical.

**One new semantic role** (`@theme`, so Tailwind emits `text-ink-secondary`):

| Token | Value | Why |
|---|---|---|
| `--color-ink-secondary` | `#6b6c7e` | Figma's secondary ink, ~148 uses. No existing equivalent: it sits between `--color-ink-muted` (#4a4d5c, 8.38:1) and `--color-ink-faint` (#848a95, 3.47:1). At 5.16:1 on white / 4.90:1 on canvas it clears 4.5:1, which `-faint` does not. |

**Measured shell geometry** (`:root`, `--figma-*`, no Tailwind utilities generated):

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `--figma-shell-width` | 1440px | | `--figma-nav-track-height` | 50px |
| `--figma-header-height` | 78px | | `--figma-nav-track-radius` | 999px |
| `--figma-header-pad-x` | 28px | | `--figma-nav-track-pad` | 6px |
| `--figma-header-pad-y` | 14px | | `--figma-nav-track-gap` | 2px |
| `--figma-brand-logo-size` | 42px | | `--figma-nav-tab-height` | 38px |
| `--figma-brand-logo-radius` | 11px | | `--figma-nav-tab-radius` | 40px |
| `--figma-brand-gap` | 10px | | `--figma-nav-tab-pad-x` | 15px |
| `--figma-nav-icon-slot` | 14px | | `--figma-nav-tab-pad-y` | 9px |
| | | | `--figma-nav-tab-gap` | 7px |

They are namespaced `--figma-*` rather than folded into the semantic roles because they are
raw measurements, not roles. `globals.css` warns against a second parallel token set; the
prefix keeps that boundary legible and lets Phase 1 promote them as it rebuilds the shell.

## 6. Spacing

Figma's auto-layout gaps cluster at **8 (71), 10 (47), 12 (34), 7 (33), 6 (28), 16 (21)** and
padding at **9, 18, 12, 10, 14, 16, 15, 20**. This is a 2 px-step scale, not a 4 px one — the
7 px and 9 px steps are load-bearing (they are the nav tab's own gap and padding), so a
Phase 1 shell that snaps everything to a 4 px grid will not match the design. No spacing
token was added: Tailwind's default scale plus the `--figma-nav-*` values above cover the
shell, and a project-wide spacing scale should be derived once a second page confirms it.
