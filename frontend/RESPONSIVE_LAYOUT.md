# Responsive layout — the desktop contract

> **This file is the single source of truth for viewport behaviour.** Where any other
> document, comment, or test disagrees with it, this file is right and the other one
> is stale. It replaces the previous "Phase 1 — mobile usability" contract, under
> which the whole analytical dashboard stacked itself into a phone column below
> 768px. That layout was never in Figma and is gone; see
> [What was retired, and why](#what-was-retired-and-why).

## The contract

여기다 is a **desktop-first, desktop-required** analytical platform. There are exactly
two states:

| Viewport | What renders |
| --- | --- |
| **≥ 1024 px** | the analytical application, in its one desktop composition |
| **< 1024 px** | `components/ui/NarrowScreenGate.tsx`, **instead of** the application |

Within the desktop range there is one composition at three densities — not three
layouts:

| Width | Intent |
| --- | --- |
| **1440 px** | the canonical Figma composition, at the width it was drawn for |
| **1280 px** | normal desktop |
| **1024 px** | compressed but **fully functional** desktop — nothing analytical is dropped, hidden behind a toggle, or moved to a second row |

### Why 1024 is the floor

It is the narrowest width the redesign is specified to work at, and both of the
load-bearing desktop constraints resolve exactly there:

- `.wep-nav-track` holds all six destinations on **one row** from 1024 up
  (`docs/YEOGIDA_UI_REDESIGN_SPEC.md` §2);
- `.wep-panel`'s 15.5rem columns leave the 후보지 심층 분석 map above 500px at 1024,
  which is what keeps the floating overlays from colliding with each other and with
  the columns.

Below it there is no designed composition, so the application stops rather than
degrades.

### Why the product is desktop-required

Every full-page frame in the canonical Figma file is **1440 px wide**:

| Frame | Size | Page |
| --- | --- | --- |
| `74:1992` | 1440 × 1753 | 1 — 지역 지표 |
| `125:5064` | 1440 × 1871 | 2 — 폐기물 처리 현황 |
| `129:5709` | 1440 × 942 | 3 — 비용 |
| `136:8684` | 1440 × 1366 | 4 — 후보지 심층 분석 |
| `167:10554` | 1440 × 1922 | 5 — 후보지 심층 비교 |
| `156:470` | 1409 × 1720 | 6 — 데이터·출처 |

The file contains **no phone composition** for any of the six destinations. The only
sub-1024 frames in it are 320 px component *cards*, not page layouts. A phone
analytical UI would therefore have to be invented rather than implemented, and the
one that previously existed — sidebar above a 60vh map, and the three-column
workspace as left panel → map → right panel down a multi-screen scroll — is not a
usable way to compare candidate sites.

## The narrow-screen gate

`components/ui/NarrowScreenGate.tsx`. `DashboardShell` returns it **instead of** its
children below the floor.

- **Unmounted, not hidden.** No dashboard subtree exists below the floor: no
  `MapView`, no MapLibre canvas, no WebGL context, no tile requests. A `display:none`
  fix would leave all of that mounted and merely invisible, which is exactly the
  half-measure this contract rejects — and it is asserted directly
  (`e2e/responsive.spec.ts` checks `map-container`, `.maplibregl-canvas`, `app-shell`,
  `top-navigation` and `mode-switch` all have count 0).
- **The message**, in Korean and citizen-facing:
  > 넓은 화면에서 이용해 주세요
  > 이 분석 화면은 넓은 화면에 최적화되어 있습니다. 1024px 이상의 데스크톱 화면에서
  > 이용해 주세요.
  The width is interpolated from `DESKTOP_MIN_WIDTH`, the same constant the shell
  reads, so the sentence cannot drift from the actual floor.
- **Branding is retained** (the Figma `logo-target-01` mark, 여기다, and the
  subtitle) so the reader knows this is the product and not an error page.
- **Accessibility.** It renders the `<main id="main-content" tabIndex={-1}>` skip-link
  target — `app/layout.tsx` renders that link at every width, so losing the target
  would break the WCAG 2.4.1 bypass block on exactly the screens least able to absorb
  it — and exactly one `<h1>`, the same rule every dashboard view follows. Nothing in
  it is interactive, so there is no focus trap and no control that silently does
  nothing.
- **No horizontal overflow**, asserted at 390, 430, 768 and 1023.
- **Not a dead end.** The shell subscribes to the media query rather than reading it
  once on mount, so widening past the floor restores the application without a
  reload. `DashboardShell` is rendered *by* `app/page.tsx`, so page state, URL state,
  and the URL-state version are untouched by the swap. The one thing that does reset
  is the MapLibre viewport (centre/zoom), because the map subtree genuinely unmounts
  — the intended cost of not keeping a hidden WebGL context alive.

### How the width is detected

`useIsDesktopViewport()` (exported from the same file) is a `useSyncExternalStore`
over `matchMedia("(min-width: 1024px)")`, with `window.innerWidth` as the fallback
where `matchMedia` is absent and `true` as the server snapshot.

- **Server snapshot `true`** is the safe assumption for a desktop-required product,
  and there is no hydration mismatch: React uses the same value for the hydration
  render and only then re-reads the client snapshot. Nothing analytical flashes
  either way, because `app/page.tsx` fetches in an effect — the prerendered HTML is
  its loading state, never a populated dashboard.
- **jsdom** implements no `matchMedia` and defaults to `innerWidth === 1024`, i.e.
  exactly the floor, so every existing component test keeps rendering the desktop
  application. Only `app/narrowScreenGate.test.tsx`, which stubs `matchMedia`
  explicitly, exercises the gate.

### Browser zoom

Zoom is **not** disabled — `app/layout.tsx` leaves `userScalable` on. The honest
consequence: zooming a desktop window past roughly 150% reduces the CSS-pixel
viewport below the floor and shows the gate. Any width-based gate behaves this way,
because CSS pixels cannot distinguish a small screen from a zoomed large one. The
product decision is deliberate, so this is documented rather than papered over.

## Desktop invariants

### The height chain (the main regression risk)

`.map-pane` sizes the map with `height: 100%`, which needs a **definite** parent
height. The chain, top to bottom:

| Element | Rule | Why |
| --- | --- | --- |
| `<body>` | `min-h-screen min-h-dvh` | fallback-first, see below |
| shell root `div[data-testid="app-shell"]`, `variant="map"` | `flex h-screen h-dvh flex-col` | the fixed-height flex **column** |
| `TopNavigation` `<header>` | ordinary auto-height first child | deliberately **not** `sticky`/`fixed` — either would take it out of the column's height accounting and re-open the empty-strip bug |
| `<main>`, `variant="map"` | `flex min-h-0 flex-1 flex-row` | the row that fills the remaining height. **`min-h-0` is load-bearing** — the default `min-height: auto` would let content push the row past the viewport bottom |
| `.map-pane` | `height: 100%; min-height: 0; flex: 1 1 0%` | fills both the remaining width and the full row height, so nothing is left below the canvas |

`variant="page"` is the map-free layout: the root is `min-h-screen min-h-dvh` and
`<main>` is a plain `flex-1`, so those dashboards scroll normally.

### `vh` before `dvh`, and the `@supports` override

`dvh` is **not** self-falling-back. On an engine that does not support it the *entire*
`height: 100dvh` declaration is invalid and is dropped at parse time — the element is
left with **no** height rule at all. So every `dvh` utility is preceded by its static
`vh` equivalent (`h-screen` before `h-dvh`, `min-h-screen` before `min-h-dvh`).

Tailwind v4 emits the static utilities *after* their `dvh` counterparts in the
generated stylesheet, so at equal specificity the static class would win on **every**
engine and silently revert the dynamic behaviour. `app/globals.css` therefore
re-asserts the dynamic value under `@supports (height: 100dvh)` with two-class
selectors — `.h-screen.h-dvh` and `.min-h-screen.min-h-dvh` — which are unlayered and
out-specify Tailwind's single-class utilities. Engines without `dvh` fail the
`@supports` test and keep the static fallback.

> The map wrapper is **not** part of this override, and must never be added to it. It
> previously used a `.h-\[60vh\].h-\[60dvh\]` two-class rule whose specificity
> out-ranked the single-class `md:h-auto` desktop reset and forced the mobile `60dvh`
> height onto the desktop map — the empty-strip bug. `.map-pane` owns the map's height
> alone, as one unconditional rule, which is what makes that class of accident
> impossible.

### Navigation

- All six destinations on **one row**, never wrapped: a second row is both ugly and a
  direct tax on the map's height budget. `.wep-appbar-row` is `flex-wrap: nowrap`
  unconditionally.
- `.wep-nav-track` keeps `overflow-x: auto` + `min-width: 0` as the **overflow
  valve**, not as a phone affordance: if a longer label ever outgrew the width at
  1024, the overflow stays inside the nav and the page still never gains a horizontal
  scrollbar.
- The bar stays within **12% of viewport height** (`e2e/responsive.spec.ts`), which
  is also what makes a wrapped nav detectable from the outside.

### Columns and the map

- **Sidebar** (`components/ui/ResizableSidebar.tsx`): reader-controlled width
  (300–520, default 360) carried by `--wep-sidebar-width` on `.wep-sidebar`. The
  10px drag handle is always present — there is no longer a width at which it is
  hidden.
- **`CollapsiblePanel`** (후보지 심층 분석): collapsing a column swaps its width for a
  3rem rail and hands the freed width to `.map-pane` (`flex: 1 1 0%`). The panel is
  **always mounted** — collapsing hides the body with CSS — so it can never remount
  the map or drop a selection, and `MapView`'s container `ResizeObserver` is what
  resizes the canvas. Widths: 15.5rem from 1024, 21rem from 1280, and the Figma
  396/376 pair at 1440. The collapsed rail is selected as `.wep-panel.wep-panel-collapsed`
  (0,2,0) **on purpose** — see the note in `globals.css`; the later 1280/1440 blocks
  would otherwise out-cascade it.
- **No page-level horizontal overflow** at any width, gate included:
  `documentElement.scrollWidth ≤ clientWidth + 1`.
- **No empty or black strip below the map**: the pane starts within 2px of the chrome
  bottom and reaches the viewport bottom within 6px, exceeding 80% of viewport
  height.

### MapLibre resize handling

MapLibre only tracks **window** `resize` events (its built-in `trackResize`). Pure
container reflows — a panel collapsing, a sidebar drag, device rotation — do not fire
a window resize, so the canvas would keep its old size. `MapView` adds a
`ResizeObserver` on the map container that calls `map.resize()`, coalescing bursts
into one call per animation frame (resizing inside `requestAnimationFrame` rather
than synchronously in the callback also avoids the "ResizeObserver loop" warning).
The observer is disconnected and any pending frame cancelled on unmount. It is
guarded for non-DOM test environments.

**`MapView` is never remounted because a panel width changed.** Collapsing is a CSS
width change on an always-mounted column; nothing reorders or unmounts the map's
position in the React tree.

## Disclosures

The repository has three disclosure classes. Two of them lost their conditional
behaviour with the phone layout; the third never had any.

| Class | Contract now |
| --- | --- |
| `.mobile-collapsible` | **always open.** Legacy name, no remaining conditional behaviour, and currently no consumer — 지역 지표 was the last one and both of its disclosures moved to where their subject is. Delete the class once nothing references it. |
| `.map-legend` | **always open.** The floating legend reads as an expanded card; a legend key is never hidden behind a toggle. Its summary stays in the DOM (hidden by CSS), so the markup contract is unchanged. |
| `.map-insight` | **still genuinely collapses, at every width it renders at.** This is deliberate and must not be merged into either class above — see `components/equity/EquityMapInsightStrip.tsx` and the note in `globals.css`. |

A short-viewport cap (`@media (max-height: 820px)`) bounds the legend body and
`.wep-map-overlay-card`, because the map's left gutter carries two overlay stacks
that grow toward each other. It is scoped by **height only**; the `min-width: 768px`
half it used to carry existed solely to keep the cap off the phone layout.

## What was retired, and why

Everything below was removed, not merely bypassed. Each was unreachable once the
floor existed, and leaving unreachable branches in place is what makes a responsive
contract ambiguous.

| Retired | Where it lived |
| --- | --- |
| 390×844 and 430×932 as **primary analytical targets** | `e2e/responsive.spec.ts`, this document |
| full-dashboard stacking below 768 | `DashboardShell` (`flex-col md:flex-row`), `app/page.tsx` |
| the mobile **60vh/60dvh analytical map** and its 360px floor | `.map-pane` + its `@supports` companion |
| the `md`-scoped shell height (`md:h-screen md:h-dvh`) and its `@supports` selector | `DashboardShell`, `globals.css` |
| the stacked `.wep-panel` phone branch (full-width sections, no rail, no toggle) | `globals.css` |
| the full-width `.wep-sidebar` and the hidden resize handle | `globals.css` |
| mobile-collapsed `.mobile-collapsible` and `.map-legend` disclosures | `globals.css` |
| `flex-wrap` on the app bar; the `<640` brand-subtitle hide | `globals.css` |
| the `<640` full-screen dialog variant | `globals.css` |
| the `min-width: 768px` half of the short-viewport overlay caps | `globals.css` |
| tests and comments demanding Page 4 columns stack on a phone | `CollapsiblePanel`, specs |

The single `md` (768px) breakpoint no longer drives anything in the shell. The only
widths that mean something now are **1024** (the floor), **1280** and **1440**
(density steps).

## Tests

| Test | Covers |
| --- | --- |
| `e2e/responsive.spec.ts` | the whole contract: the application at 1024×768 / 1280×800 / 1440×900, the gate at 390×844 / 430×932 / 768×1024 / **1023×800**, and a resize crossing the floor in both directions |
| `e2e/accessibility.spec.ts` | dashboard a11y at 1024 and 1440; skip link, one `<h1>`, and no dashboard at 390 |
| `app/responsive.test.tsx` | jsdom structural guard — the shell's unconditional classes, fallback-before-`dvh` ordering, `.map-pane` carrying no viewport-relative height |
| `app/narrowScreenGate.test.tsx` | the gate path, with `matchMedia` stubbed: nothing mounted, skip target kept, one `<h1>`, and the widen-back restore |
| `e2e/desktopNavigation.spec.ts` | the desktop acceptance matrix at 1440×900 and 1280×800 |
| `e2e/deepAnalysisPanels.spec.ts` | the collapse rails and the width handed to the map |

`e2e/responsive.spec.ts` intercepts every backend request itself (`e2e/mockBackend.ts`),
so it needs no backend, tile server, or official data, and it asserts only on layout —
never on data values.

### The test mock uses an unavailable, non-official state

The mock is a **synthetic layout fixture**, never real or official public data.
Map-mode requests return genuinely empty collections (`count: 0`, no items), which
carry no evidence labels. The 수도권매립지 (landfill) endpoints are **not** stubbed with
an empty-but-"official" summary — the real backend labels every landfill value
`OFFICIAL_REPORTED_VALUE` / `OFFICIAL_INPUTS_DERIVED_VALUE`, so a synthetic summary of
zeros would render fabricated quantities and fees under official labels, which the
repo-root `AGENTS.md` forbids. Instead the mock reproduces the backend's real "no
official data" response (`404 NO_DATA_AVAILABLE`), so the flow dashboard renders its
**explicitly-unavailable** state and the spec asserts that no official-evidence label
ever appears. (`homeApiMock.ts` does the same for the jsdom test.)

### Specs still to migrate

These specs still drive the application at sub-1024 widths and expect a working phone
dashboard. Under this contract those viewports render the gate, so each needs its
narrow block either **re-pointed at a desktop width** or **rewritten as a gate
assertion**. They are feature and regression specs owned by other work streams, so
the migration is deliberately left to integration rather than done in parallel with
concurrent edits to the same files:

`correctionPass` · `equitySidebarResize` · `facilityCost` · `finalUiIntegration` ·
`integration` · `landCoverLayer` · `landfill` · `mapInsightDisclosure` ·
`phase3CostResults` · `phase4EquityMap` · `phase5LandfillDashboard` ·
`phase6DataSourcesDashboard` · `phase6Review` · `phase7FinalRegression` ·
`publicRelease` · `scenario`

Many of their narrow assertions survive unchanged — "no horizontal overflow" and
"exactly one `<h1>`" both still hold at 390, because the gate satisfies them. What
fails is anything asserting a *mounted dashboard* (a map container, the mode switch,
a KPI grid) at a narrow width.

## Non-responsive behaviour documented here

These sections are unaffected by the desktop contract and are kept for reference.

### Selected-region identity (code, not snapshot)

The selected-region summary's persistent identity is the region **code**
(`selectedRegionCode` in `app/page.tsx`), not a captured metric value. The full
`RegionSelection` (name, metric label, value, provenance) is **derived** from that
code under the currently-active metric via `buildRegionSelection`:

- Selecting a region — from a **map click** or from the accessible region `<select>` —
  stores the same code.
- **Changing the metric preserves** `selectedRegionCode`; the summary re-derives the
  new metric's label and value for that region. If the new metric serves no value,
  the existing explicit unavailable text is shown — **never a fabricated `0`**.
- If the active **geography** changes (native SGIS ↔ RCIS reporting) and the stored
  code is absent from the new boundary collection, the derivation returns `null` and
  the summary safely clears. Returning to a geography that contains the code restores
  the selection.

### Map popup invalidation (no stale metric values)

Both region popups are invalidated when the metric changes, so neither can display a
previous metric's label/value. The **hover tooltip**'s cache is keyed by region code
and is reset (and any visible tooltip closed) on a metric change. The **pinned popup**
is retained in a ref; a metric or mode change closes it, each new click removes the
previous pin, and it is removed on unmount. The sidebar selection is derived from page
state and stays active independently. Candidate and facility popups are unchanged.

### Map loading, tile-refresh, and error states

`MapView` renders its own accessible overlays inside the map wrapper: an initial
`role="status"` loading overlay (pointer-events-none, unmounted on `load`), a
candidate tile-refresh `role="status"`, and a concise non-blocking `role="alert"`
banner if the map cannot initialise. Transient individual raster tile failures are
**not** escalated to a fatal state, and the banner makes no claim about
official-data availability. No fake progress percentages.

### Floating map legend

The equity choropleth legend and the suitability status/score legend render as a
single floating card over the lower-left of the map (`components/MapLegendOverlay.tsx`),
not in the sidebar.

- **Single source of truth.** It is a pure presentation component: it never computes
  colour classes, breaks, thresholds, or the no-data colour. The page passes it
  already-computed rows from the same palettes and constants the MapLibre fill uses,
  so map colours and legend colours can never silently diverge.
- **Stability control (policy v2).** When the selected run computed CRITIC/stability,
  the suitability legend adds an accessible native 안정 후보만 보기 checkbox. This
  `stableOnly` state is **separate** from the canonical `statusVisibility`. The
  control is hidden for a run without stability data.
- **Placement.** A sibling of `<MapView>` inside the `relative .map-pane` wrapper,
  absolutely positioned bottom-left, clearing the top-right navigation control and
  the bottom-right OpenStreetMap attribution.
- **Suitability status filter.** The three status checkboxes (적합 / 검토 필요 / 제외)
  live in the legend and drive the page's canonical `statusVisibility` — the exact
  state MapView filters its candidate layer on. Status is conveyed by native checkbox
  labels and swatches, never by colour alone.

### Map-free dashboards

수도권매립지 (매립지 현황), 비용 살펴보기, and 데이터와 출처 are full-width, map-free
`variant="page"` branches that mount **zero** map containers. The cost dashboard's
setup half uses `lg:grid-cols-[minmax(0,1fr)_20rem]` with a `lg:sticky` summary
column — the one sticky element outside the top navigation, confined to a map-free
branch so it takes nothing out of a height chain `.map-pane` depends on. Their
information architecture, KPI definitions, and terminology rules live in
[`../docs/FACILITY_COST_LENS_UI.md`](../docs/FACILITY_COST_LENS_UI.md) and the
`docs/ui-refresh/*` page documents.

### Report preview modal

`.wep-modal-panel` owns `max-height: calc(100vh − 4rem)` with the `dvh` value
re-asserted under `@supports (height: 100dvh)` — the **same technique and the same
reason** as the shell height above. The panel is a flex column whose body is
`min-h-0 flex-1 overflow-y-auto`, so long reports scroll inside the modal; `min-h-0`
is load-bearing. The overlay carries `overscroll-contain`. Print is unaffected: the
existing `@media print` rules already reset `max-height`/`overflow`.

### Colour scheme

A full **dark theme** is intentionally out of scope. The app is pinned to a
consistent light palette (`color-scheme: light`); the previous
`prefers-color-scheme: dark` `<body>` override — which framed the light app in black,
most visibly in the empty strip below the map — was removed.

### Live specs

The **live** e2e specs (`map`, `regressions`, `landfill`) require `E2E_BACKEND_URL`
and skip without it. In sandboxed environments the OSM basemap and vector tiles are
network-blocked, so the map renders blank — the layout assertions measure the map
**container**, which is robust to tile/WebGL availability.
