# UI refresh — design tokens

The civic-dashboard token system: **one** set of semantic roles for application
chrome, kept strictly separate from the analytical map palette.

Tokens live in the `@theme` block of `frontend/src/app/globals.css`. There is no
`tailwind.config.*` — Tailwind v4 is configured CSS-first, and every `--color-*`
token automatically becomes `bg-*` / `text-*` / `border-*` utilities, every
`--radius-*` a `rounded-*` utility, and every `--shadow-*` a `shadow-*` utility.

## 1. Why values were re-pointed, not renamed

The Phase 7 token names (`surface`, `ink`, `hairline`, `primary`, `warn`, …) are
already used ~450 times across the components. Renaming them would have produced a
450-file diff with no visual meaning, so this milestone **kept every existing name
and re-pointed its value**, then added only the roles that genuinely did not exist:
`canvas`, `brand*`, `primary-border`, and `no-data`.

Adding a second parallel token system (`--color-bg-app`, `--color-text-primary`, …)
alongside the existing one was rejected for the same reason: two names for one role
is how token systems rot.

## 2. The roles

### Surfaces

| Token | Value | Role |
| --- | --- | --- |
| `--color-canvas` | `#f4f6fb` | **New.** The application background — a very light blue-gray behind everything. Used by the shell root and the error/loading branches. |
| `--color-surface` | `#ffffff` | Cards, panels, the app bar, popovers. |
| `--color-surface-muted` | `#f8fafc` | A quiet block inside a white surface (empty states, table headers). |
| `--color-surface-sunken` | `#f4f7f8` | A recessed area *inside* a surface (the segmented-control track, the sidebar column). |

Surfaces are white on a light blue-gray canvas. A card is separated from the canvas
by a **border**, not by a shadow.

### Borders and text

| Token | Value | Role |
| --- | --- | --- |
| `--color-hairline` | `#e3e8f0` | The default 1px border on every card, panel, and bar. |
| `--color-hairline-strong` | `#c9d3d9` | Input and quiet-button borders — the only borders that need to read as interactive. |
| `--color-ink` | `#171c29` | Primary text, headings, metric values. |
| `--color-ink-muted` | `#4d5466` | Secondary/body text. |
| `--color-ink-subtle` | `#687083` | Tertiary text: labels, captions, help text. |

Contrast on `--color-surface` (white): `ink` ≈ 15.4:1, `ink-muted` ≈ 8.6:1,
`ink-subtle` ≈ 4.96:1. `ink-subtle` is the lightest text in the system and still
clears WCAG AA 4.5:1 at the 12px caption sizes it is used at, so no smaller or
lighter body text may be introduced.

### Brand — teal

| Token | Value | Role |
| --- | --- | --- |
| `--color-brand` | `#17786c` | Identity only: the app-bar brand mark, and the "직접 보고값" data-status badge. ≈ 5.3:1 on white. |
| `--color-brand-hover` | `#12675d` | Brand hover/pressed. |
| `--color-brand-soft` | `#edf8f6` | Brand tint background (badge fill). |

Teal carries the civic/environmental identity. It is **not** an action color: a teal
button would compete with the action blue and blur "this is who we are" with "this is
what you can click".

### Action — blue

| Token | Value | Role |
| --- | --- | --- |
| `--color-primary` | `#2663eb` | Every interactive affordance: primary buttons, links, selection, the active navigation indicator, the focus ring. ≈ 5.2:1 on white. |
| `--color-primary-hover` | `#1f4fa8` | Hover/pressed. |
| `--color-primary-ink` | `#ffffff` | Text on a filled action surface. |
| `--color-primary-soft` | `#eaf0fe` | Selected/emphasis tint (selected filter chip, chips, derived-value badge). |
| `--color-primary-border` | `#c3d4f7` | **New.** The border that pairs with `primary-soft`, so a selected chip differs from an unselected one by border *and* fill *and* a mark — never by color alone. |
| `--focus-ring` | `#2663eb` | The `:focus-visible` outline color. Deliberately the same value as `--color-primary`; it is a separate name because it is a separate role. |

### Warning / caution — amber

| Token | Value | Role |
| --- | --- | --- |
| `--color-warn` | `#a05a00` | Caveats, exclusions, uncertainty, interpretation cautions. ≈ 5.3:1 on white, ≈ 4.9:1 on `warn-surface`. |
| `--color-warn-surface` | `#fdf6ea` | Warning banner/badge background. |
| `--color-warn-border` | `#f0dcb4` | Warning banner/badge border. |

Amber means "read this before you trust the number". It is **not** used for missing
data — that is a neutral, not a caution.

### Missing data — neutral gray

| Token | Value | Role |
| --- | --- | --- |
| `--color-no-data` | `#d7dbe1` | **New.** True absence of a served value, in application chrome (badges, swatches). |

Rules, which are data-integrity rules and not styling preferences:

1. Missing data is **gray**, never the lightest step of a sequential ramp — a pale
   ramp color reads as "a very low value", which is a different claim than "no value
   was served".
2. Missing data is never amber. Amber is a caution about a value that exists.
3. A gray badge always carries its text label as well (`자료 없음` and, where the
   backend served one, the reason), so the state never depends on color alone.
4. `--color-no-data` is the **UI** no-data color. The **map's** no-data color is
   `NO_DATA_COLOR` in `frontend/src/lib/metrics.ts` and stays the map's own source of
   truth. They are intentionally two constants: the map value must stay in the file
   the legend and the fill both read, or the two could diverge.

### Status (unchanged from Phase 7)

`--color-danger{,-surface,-border}`, `--color-success{,-surface,-border}`, and
`--color-info{,-surface,-border}` keep their existing values. They are consumed by
`InfoBanner`'s four tones and were already consistent; re-tinting them was out of
scope for this milestone.

## 3. UI tokens versus the analytical map palette

**They are separate systems and must stay separate.**

| | Application UI | Analytical map |
| --- | --- | --- |
| Home | `globals.css` `@theme` | `frontend/src/lib/metrics.ts` |
| Consumed by | Tailwind utilities, `.wep-*` classes | MapLibre paint expressions **and** the legend components |
| Contains | surfaces, text, borders, brand, action, warning, no-data | ColorBrewer ramps, `NO_DATA_COLOR`, candidate score palette + breaks, status colors, stable-outline color, facility category colors |
| Changed in this milestone | yes (values re-pointed, 5 roles added) | **no** |

The choropleth palette, the candidate score palette, the class breaks, and every
status color are untouched. The legend reads the same constants the map fill uses, so
the two can never disagree; re-tinting a ramp from the UI token layer would break
that guarantee, so UI tokens are never referenced by map code and map constants are
never referenced by chrome.

## 4. Border, radius, spacing, and shadow rules

**Borders.** Every card, panel, bar, and badge is separated by a 1px
`--color-hairline` border. `--color-hairline-strong` is reserved for controls that
must read as interactive (inputs, quiet buttons).

**Radius.** Three values only:

| Token | Value | Used for |
| --- | --- | --- |
| `--radius-card` | `0.625rem` (10px) | Cards, panels, banners, accordions |
| `--radius-control` | `0.5rem` (8px) | Buttons, inputs, small controls |
| `--radius-pill` | `9999px` | Chips and the segmented-control track only |

Moderate, not playful. 10px was chosen over the previous 12px so a dense grid of
cards reads as a data surface rather than a set of app tiles.

**Spacing.** Card padding is `1rem` (`1.25rem` for a hero metric). Gaps between cards
in a column or grid are `0.75rem`. The app bar uses a `4rem` (64px) row height with
`px-4 / sm:px-6 / lg:px-8` gutters, matching the existing `max-w-screen-2xl` content
width used everywhere else in the shell.

**Shadows.** Shadows indicate *floating above the page*, not "this is a card".

* `.wep-card` has **no** shadow — border only.
* `--shadow-card` (`0 1px 2px rgba(23,28,41,0.06)`) is reserved for the one raised
  segment of a segmented control and for dropdown/popover surfaces.
* `--shadow-float` (`0 8px 24px rgba(23,28,41,0.10)`) is for genuinely floating
  overlays (the map legend card, modals).

**Numerals.** Every metric value uses `tabular-nums` so digits align down a column.
Values are rendered as the exact string the caller supplies — the primitives never
parse, round, or reformat a number.

## 5. Component classes built from the tokens

`globals.css` keeps a small set of `.wep-*` classes so repeated patterns cannot drift.
Added or updated in this milestone:

| Class | Component |
| --- | --- |
| `.wep-brand`, `.wep-brand-mark`, `.wep-brand-name`, `.wep-brand-sub` | The app-bar brand block |
| `.wep-nav-tab` | Navigation tab (now full app-bar height, indicator flush with the bar's bottom border) |
| `.wep-card` | `SectionCard`, `KpiCard`, and existing cards — border-only |
| `.wep-filter-chip` | `FilterChip` |
| `.wep-badge`, `.wep-badge-{reported,derived,caveat,missing,excluded}` | `DataStatusBadge` |

New React components must use token utilities (`bg-surface`, `text-ink-muted`,
`border-hairline`, …) or these classes. **No hard-coded hex values in components.**
After this milestone the only literal colors left in the frontend are the token
definitions themselves and `lib/metrics.ts` — the analytical palette, deliberately.
The skip link, the focus ring, and the MapLibre popup rules in `globals.css` were
converted to tokens as part of the refresh.
