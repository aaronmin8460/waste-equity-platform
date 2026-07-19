# Responsive layout (Phase 1 — mobile usability)

> **Phase 2/3 update (floating legends + full-width cost dashboard).** The map
> legends now float over the map instead of living in the sidebar, and the facility
> cost lens renders as a full-width dashboard with **no map**. See
> [Floating map legend](#floating-map-legend-phase-23) and
> [Full-width facility-cost dashboard](#full-width-facility-cost-dashboard-phase-23)
> below; the cost dashboard's information architecture and terminology rules live in
> [`../docs/FACILITY_COST_LENS_UI.md`](../docs/FACILITY_COST_LENS_UI.md). Not deployed.


Status: **merged into `main` (PR #27). Not deployed** to any environment. A
follow-up (Phase 1.1) corrects two post-merge review findings: it adds explicit
static-viewport (`vh`) fallbacks in front of the dynamic-viewport (`dvh`)
utilities, and it replaces the responsive test's landfill fixture with the
backend's real "no official data" state (no fabricated official values). This
phase makes the existing dashboard usable on phones without changing analytical
logic, the data model, API behavior, map calculations, the cost/scoring model, or
the visual design beyond what responsive layout requires.

Phase 2 (accessibility) has **not** been started.

The dashboard was previously a permanently horizontal `flex` row with a fixed
384 px (`w-96`) sidebar, so on a ~390 px phone the sidebar filled the viewport and
the map was pushed off-screen. It now adapts to the viewport.

## Map shell, loading, and selection sync (later fix)

A follow-up (`fix/map-shell-loading-and-selection-sync`, **not deployed**)
corrects three map-shell defects introduced/exposed by the responsive work and
adds map feedback states, **without changing any backend API contract or
analytical calculation**:

- **Desktop map height.** The map wrapper's sizing moved from an ambiguous stack
  of Tailwind utilities (`h-[60vh] h-[60dvh] md:h-auto md:min-h-0 md:flex-1`) to a
  dedicated `.map-pane` class (see [Map pane sizing](#map-pane-sizing-mobile-60-desktop-fill)).
  The old `@supports` rule that re-asserted the mobile `60dvh` value used a
  two-class selector, so it out-specified the single-class `md:h-auto` reset and
  forced `60dvh` **even at desktop widths** — leaving the map ~60 % tall with a
  large empty strip below it in the full-height row. `.map-pane` owns the mobile
  and desktop heights unambiguously, and no broadly-scoped rule can leak the mobile
  height onto the desktop map.
- **No black frame.** The app is a single light UI, but a `prefers-color-scheme:
  dark` override previously flipped only the `<body>` background to near-black,
  framing the light app in black (most visible in the empty strip above). The dark
  override is removed and `color-scheme: light` is pinned, so the background is a
  consistent light color everywhere. A full dark theme remains out of scope.
- **Selected-region identity.** Page state now stores the selected region **code**
  (`selectedRegionCode`) and DERIVES the summary (name + label + value + provenance)
  under the active metric, instead of snapshotting a metric-specific value. See
  [Selected-region identity](#selected-region-identity-code-not-snapshot).
- **Popup invalidation + map feedback.** Pinned/hover map popups are invalidated on
  a metric change so they never show a stale value, and the map now shows loading,
  candidate tile-refresh, and error states. See
  [Map popups](#map-popup-invalidation-no-stale-metric-values) and
  [Map loading states](#map-loading-tile-refresh-and-error-states).

## Breakpoints

A single breakpoint drives the shell: Tailwind's `md` (**≥ 768 px**). Below it the
app is a mobile-first vertical column; at and above it the original side-by-side
layout is used. Tablet portrait at exactly 768 px therefore gets the side-by-side
layout (a 384 px sidebar beside a 384 px map), which is intentional and overflow-free.

## Mobile behavior (< 768 px)

- Root shell is a vertical column (`flex-col`): controls stacked above a
  full-width map.
- The sidebar is full width (`w-full`) — no fixed 384 px width, so it never
  covers the map.
- The mode switcher uses `flex-wrap`, so all three modes stay on screen at
  320–430 px (they wrap instead of overflowing); each button has a ≥ 38 px tap
  target on mobile only.
- Verbose sidebar control panels collapse into native `<details>` disclosures with
  clear Korean labels — 출처 및 방법 (Sources & method), 시설 레이어 (Facility layer)
  — so the map stays reachable with minimal scrolling. Primary controls (mode switch,
  metric selection) are never collapsed. The map legend is **no longer** a sidebar
  disclosure: it floats over the map (see
  [Floating map legend](#floating-map-legend-phase-23)) and is collapsed by default
  on mobile behind a labelled "범례 (Legend)" summary.
- The landfill (수도권매립지) dashboard is already single-column responsive; its
  table scrolls inside its own `overflow-x-auto` container and long ASCII
  identifiers wrap (`break-words`), so the page never scrolls horizontally.
- No page-level horizontal overflow at any tested width.

## Desktop / tablet-landscape behavior (≥ 768 px)

- The original side-by-side layout is preserved: a fixed ~384 px sidebar
  (`md:w-96 md:flex-none`) on the left, the map filling the remaining width
  (`md:flex-1`).
- The mobile disclosure summaries are hidden and their bodies are force-expanded
  by CSS, so the desktop sidebar renders exactly as before — no toggles are added
  and no analytical option is ever hidden behind one.
- The shell is a fixed-height column/row (`md:h-dvh`) so the app fits the viewport
  without unintended document scrolling; the sidebar scrolls internally
  (`md:overflow-y-auto`).

## Viewport-height strategy

The dynamic viewport unit `dvh` is used everywhere the app fills the screen, so
the layout accounts for mobile browser chrome (address bar) expanding/collapsing
and is never cropped by, or leaves a gap under, the browser toolbars:

- Root shell: `min-h-dvh` on mobile, `md:h-dvh` on desktop.
- Loading / error states and the landfill dashboard: `min-h-dvh`.
- `<body>`: `min-h-dvh`.

### `vh` fallback before `dvh` (compatibility)

`dvh` is **not** self-falling-back. On an engine that does not support it, the
*entire* `min-height: 100dvh` / `height: 60dvh` declaration is invalid and is
dropped at parse time — the element is then left with **no** height rule at all,
not with a viewport-relative one. So every `dvh` utility is preceded by its
static `vh` equivalent as an explicit fallback:

| Element | Classes (fallback first) |
| --- | --- |
| Root shell | `min-h-screen min-h-dvh … md:h-screen md:h-dvh` |
| `<body>` | `min-h-screen min-h-dvh` |
| Loading / error / flow states | `min-h-screen min-h-dvh` |
| Landfill dashboard root | `min-h-screen min-h-dvh` |
| Map wrapper | `.map-pane` (dedicated class — see [Map pane sizing](#map-pane-sizing-mobile-60-desktop-fill)) |

How it resolves:

- **Engine without `dvh`:** it drops the invalid `dvh` declaration and keeps the
  valid `vh` one, so the element still has a definite full/60 % viewport height —
  the map never collapses.
- **Engine with `dvh`:** the dynamic value is applied and the dynamic-viewport
  behavior is preserved (see the override note below).

### The Tailwind ordering caveat (and the `@supports` override)

The markup lists the `vh` class first and the `dvh` class second, but in Tailwind
v4 that source order does **not** decide the cascade: Tailwind emits the static
`vh`/`*-screen` utilities *after* their `dvh` counterparts in the generated
stylesheet (`.h-[60dvh]{…}` then `.h-[60vh]{…}`). Since both classes sit on the
element at equal specificity, the later rule — the static `vh` one — would win on
**every** engine, silently reverting the dynamic behavior even where `dvh` is
supported.

So the dynamic value is re-asserted for the **shell** in `app/globals.css` under
`@supports (height: 100dvh)` with a two-class selector (`.min-h-screen.min-h-dvh`
and a `md`-scoped `.md\:h-screen.md\:h-dvh`). These rules are unlayered and more
specific than Tailwind's single-class utilities, so:

- engines **without** `dvh` fail the `@supports` test, skip the override, and keep
  the static fallback class; and
- engines **with** `dvh` apply the override and keep the dynamic-viewport
  behavior.

This corrects the earlier (incorrect) claim that unsupported engines "fall back to
viewport-relative behavior" automatically — without the explicit `vh` class they
fall back to *nothing* — and it is why the fallback lives in both the utility
classes (for markup readability / the tests) and the `@supports` block (for the
actual cascade).

> The map wrapper is **no longer** part of this override. It previously used a
> `.h-\[60vh\].h-\[60dvh\]` two-class `@supports` rule, but that same two-class
> specificity out-ranked the single-class `md:h-auto` desktop reset and forced the
> mobile `60dvh` height onto the desktop map (the empty-strip bug). Its sizing now
> lives entirely in the dedicated `.map-pane` class below, where the desktop rule is
> a later same-specificity rule that cleanly wins at `md+`.

An explicit responsive `viewport` is exported from `app/layout.tsx`
(`width=device-width, initialScale=1`), with pinch-zoom left enabled for
accessibility.

## Map pane sizing (mobile 60%, desktop fill)

MapLibre's container is `h-full` (100 % of its wrapper). A percentage height needs
a **definite** parent height, so the map wrapper's height must be explicit — a bare
`min-h` leaves the height indefinite and the percentage child collapses to zero
(the "map collapses when the flex direction changes" bug). A single dedicated class,
`.map-pane` (in `app/globals.css`), owns this responsive sizing unambiguously:

```css
.map-pane {                 /* mobile: definite 60% viewport height + a minimum */
  height: 60vh;             /* static fallback (see the dvh note above) */
  min-height: 360px;
}
@supports (height: 100dvh) {
  .map-pane { height: 60dvh; }   /* dynamic-viewport value where supported */
}
@media (min-width: 768px) {      /* md+: fill the fixed-height sidebar row */
  .map-pane { height: 100%; min-height: 0; flex: 1 1 0%; }
}
```

- **Mobile (< 768 px):** a definite `60vh`/`60dvh` (~500 px on an 844 px phone) with
  a `360px` floor, so the canvas is prominent and never collapses. The `60vh`
  fallback precedes the `60dvh` value so a `dvh`-less engine keeps a valid definite
  height.
- **Desktop (≥ 768 px):** `height: 100%` (of the fixed-height `md:h-dvh` row) plus
  `flex: 1 1 0%`, so the pane fills **both** the remaining row width and the full
  row height. Nothing is left below the canvas.

Because `.map-pane` is one class, the mobile `@supports` rule and the desktop
`@media` rule sit at equal specificity, and the desktop rule — written later — wins
at `md+`. Crucially, no two-class `@supports` selector can out-specify a desktop
reset and leak the mobile height onto the desktop map (the previous
`h-[60vh] h-[60dvh] md:h-auto …` bug). `min-w-0` stays on the wrapper so the flex
child can shrink and long map content never forces horizontal overflow.

## Selected-region identity (code, not snapshot)

The selected-region summary's persistent identity is the region **code**
(`selectedRegionCode` in `app/page.tsx`), not a captured metric value. The full
`RegionSelection` (name, metric label, value, provenance) is **derived** from that
code under the currently-active metric via `buildRegionSelection`:

- Selecting a region — from a **map click** (`onRegionClick` now passes only the
  region code) or from the accessible **region `<select>`** — stores the same code.
- **Changing the metric preserves** `selectedRegionCode`; the summary re-derives the
  new metric's label and value for that same region. If the new metric serves no
  value for the region, the existing explicit unavailable text is shown — **never a
  fabricated `0`**.
- If the active **geography** changes (native SGIS ↔ RCIS reporting) and the stored
  code is not present in the new boundary collection, the derivation returns `null`
  and the summary safely clears. Returning to a geography that contains the code
  restores the selection (the identity was preserved).

This replaces the earlier behavior where changing the metric cleared the selection
(its snapshot value belonged to the old metric).

## Map popup invalidation (no stale metric values)

Both region popups are invalidated when the metric changes, so neither can display a
previous metric's label/value:

- **Hover tooltip** (desktop): its cache is keyed by region code, so on a metric
  change the cache is reset **and** any currently-visible tooltip is closed, so the
  next pointer move rebuilds it from the active metric.
- **Pinned popup** (click/tap): the single pin is retained in a ref. A metric or
  mode change closes it, and each new click removes the previous pin before opening
  a new one (no abandoned popups accumulate). It is also removed on unmount. The
  sidebar selection is derived from page state and stays active independently — only
  the on-map pin is dismissed; the next click rebuilds it from the new metric.

Candidate and facility popups are unchanged and keep working.

## Map loading, tile-refresh, and error states

`MapView` renders its own accessible overlays inside the map wrapper:

- **Initial loading** — `role="status"` overlay "지도를 불러오는 중… (Loading map…)"
  shown until MapLibre fires `load`, then removed. It is `pointer-events-none` and
  unmounts on load, so it never blocks interaction or traps focus afterwards.
- **Candidate tile refresh** — `role="status"` "후보지 타일을 갱신하는 중…" shown when
  entering suitability mode or switching the profile/tile URL, cleared when the
  candidate vector source finishes loading (`sourcedata`/`isSourceLoaded`) or the
  map reaches `idle` (so it never sticks when the viewport holds no tiles). No fake
  progress percentages.
- **Error** — a concise, non-blocking `role="alert"` banner if the map cannot
  initialize (e.g. WebGL unavailable) or a source fails. Transient individual raster
  tile failures are **not** escalated to a fatal full-screen state; the banner makes
  no claim about official-data availability, and the app-level backend error state
  and accessible DOM alternatives remain.

## MapLibre resize handling

MapLibre only tracks **window** `resize` events (its built-in `trackResize`). Pure
container reflows — the flex direction flipping at the `md` breakpoint, device
rotation, or a mobile collapsible panel above the map opening/closing — do not
fire a window resize, so the canvas would otherwise keep its old size. `MapView`
adds a `ResizeObserver` on the map container that calls `map.resize()`, coalescing
bursts into one call per animation frame (resizing inside `requestAnimationFrame`
rather than synchronously in the callback also avoids the "ResizeObserver loop"
warning). The observer is disconnected and any pending frame cancelled on unmount —
no leaking listeners. It is guarded for non-DOM test environments.

## Tested viewport sizes

`e2e/responsive.spec.ts` exercises the real app (backend intercepted via
`e2e/mockBackend.ts`, so no backend is required) at:

| Viewport         | Size       | Layout       |
| ---------------- | ---------- | ------------ |
| Phone            | 390 × 844  | stacked      |
| Large phone      | 430 × 932  | stacked      |
| Tablet portrait  | 768 × 1024 | side-by-side |
| Narrow desktop   | 1054 × 800 | side-by-side |
| Desktop          | 1280 × 800 | side-by-side |
| Desktop          | 1440 × 900 | side-by-side |

Each viewport asserts: the app loads, the map container has meaningful width and
height and is not pushed off-screen, no page-level horizontal overflow
(`documentElement.scrollWidth ≤ clientWidth + 1`), the mode switcher is visible and
every mode is selectable, and the map stays visible across mode switches. **Desktop**
additionally asserts the map pane reaches the viewport bottom within a small
rounding tolerance and is taller than 80 % of the viewport (a regression guard for
the empty-strip bug, where the map was ~60 % tall), and that the panels are
force-expanded with no toggles, and that the floating equity legend sits within the
map bounds, anchored to the left edge and above the OpenStreetMap attribution.
**Mobile** asserts a definite, useful map height (~40–85 % of the viewport, stacked
below the sidebar), that any visible loading overlay is contained within the map box,
and that collapsed panels — including the floating "범례 (Legend)" — open/toggle with
radios reachable. `e2e/facilityCost.spec.ts` and `e2e/integration.spec.ts` additionally
assert the cost lens mounts **zero** map containers at their viewports. `app/responsive.test.tsx` adds a jsdom structural guard for the
responsive classes, including that the map wrapper carries the dedicated `.map-pane`
class (and no longer the ambiguous `h-[60dvh] / md:h-auto / md:flex-1` utilities)
and that the shell carries its `min-h-screen` / `md:h-screen` fallbacks before the
matching `dvh` classes.

### The test mock uses an unavailable, non-official state

The mock is a **synthetic layout fixture**, never real or official public data.
Map-mode requests return genuinely empty collections (`count: 0`, no items), which
carry no evidence labels. The 수도권매립지 (landfill) endpoints are **not** stubbed
with an empty-but-"official" summary — the real backend labels every landfill value
`OFFICIAL_REPORTED_VALUE` / `OFFICIAL_INPUTS_DERIVED_VALUE`, so a synthetic summary
of zeros would render fabricated quantities and fees under official labels, which
the repo-root `AGENTS.md` forbids. Instead the mock reproduces the backend's real
"no official data" response (`404 NO_DATA_AVAILABLE`), so the flow dashboard renders
its **explicitly-unavailable** state and the spec asserts that no official-evidence
label ever appears. (`homeApiMock.ts` does the same for the jsdom test by rejecting
the landfill fetchers with the identical `ApiError`.)

## Floating map legend (Phase 2/3)

The equity choropleth legend and the suitability status/score legend are rendered as
a single floating card over the lower-left of the map by
`components/MapLegendOverlay.tsx`, **not** in the sidebar. This removes the sidebar's
duplicated legend and keeps one legend per map mode.

- **Single source of truth.** `MapLegendOverlay` is a pure presentation component: it
  never computes color classes, breaks, thresholds, or the no-data color. The page
  passes it the already-computed rows — equity mode from the same `activeScale`
  palette/breaks the MapLibre fill uses, suitability mode from
  `CANDIDATE_SCORE_PALETTE_5` + `CANDIDATE_SCORE_BREAKS` and the shared
  `CANDIDATE_REVIEW_COLOR` / `CANDIDATE_EXCLUDED_COLOR` constants (now in
  `lib/metrics.ts`, imported by both the map and the legend). Map colors and legend
  colors therefore can never silently diverge.
- **Stability control (policy v2).** When the selected run computed CRITIC/stability,
  the suitability legend adds an accessible native "안정 후보만 보기" checkbox and a
  `CANDIDATE_STABLE_OUTLINE_COLOR` outline sample. This `stableOnly` state is
  **separate** from the canonical `statusVisibility`: it restricts ELIGIBLE cells to
  `stable_count = 3` while REVIEW/EXCLUDED remain governed by their status
  checkboxes, and STABLE eligible cells always get a distinct
  `candidates-stable-outline` layer (the selected-candidate highlight stays on top).
  The control is hidden for a run without stability data.
- **Rendered in the page, over the map.** The card is a sibling of `<MapView>` inside
  the `relative .map-pane` wrapper (not inside `MapView`), so it receives the derived
  legend data directly and the stubbed-`MapView` unit tests still exercise it. Only
  the small card overlays the map, so the rest of the map stays interactive — there is
  no full-container wrapper intercepting pointer events, and wheel/scroll inside the
  card never reaches the map canvas.
- **Placement.** `absolute`, anchored bottom-left (`bottom-8 left-2`/`md:left-3`),
  `z-10`, ~288 px wide (`w-[min(86vw,288px)]`), translucent white with a border,
  shadow, and backdrop blur. It clears the top-right navigation control and — by
  sitting a fixed distance above the map's bottom edge — never overlaps the
  bottom-right OpenStreetMap attribution, even when the map (and thus the legend's
  share of it) is narrow.
- **Responsive collapse.** A native `<details>` with its own `.map-legend` class:
  collapsed by default on mobile behind a labelled "범례 (Legend)" `<summary>` (never
  icon-only), with the body scrolling internally (`max-h-[40vh] overflow-y-auto`) so
  it never covers most of the map. At `md+` the summary is hidden and the body is
  force-expanded — the same `<details>` force-open technique as the sidebar
  `.mobile-collapsible` (legacy `display:none` children **and** the modern
  `::details-content` wrapper), but scoped to its own class. Because the card is an
  absolutely-positioned overlay, opening/closing it never resizes the MapLibre canvas.
- **Suitability status filter.** The three status checkboxes (적합 / 검토 필요 / 제외)
  moved into the floating legend and still drive the page's canonical
  `statusVisibility` state via `onToggleStatus` — the exact state MapView filters its
  candidate layer on. There is no duplicate visibility state in the legend, and a
  checkbox change updates the MapLibre candidate-layer filter immediately. Status is
  conveyed by native checkbox labels and swatches (review = amber dashed sample), never
  by color alone; the eligible score classes (0–100) and the analytical-screening
  disclaimer are shown alongside.

## Full-width facility-cost dashboard (Phase 2/3)

Selecting 적합성 (Suitability) → 비용 렌즈 now renders a **full-width dashboard** with
**no map**, instead of a narrow panel beside a mostly-irrelevant map (the cost model
does not vary by map cell in V1). `app/page.tsx` early-returns this view — it mounts
no `MapView`, no map container, and no floating legend, mirroring the 수도권매립지
(flow) full-width pattern. The main mode switch and the 적합성 점수 / 비용 렌즈 sub-view
switch stay reachable above the dashboard, and the selected suitability candidate is
passed through for the candidate-context card. Full information architecture,
KPI definitions, permitted/prohibited terminology, funding-breakdown interpretation,
the per-capita caveat, and the no-regional-allocation rule are documented in
[`../docs/FACILITY_COST_LENS_UI.md`](../docs/FACILITY_COST_LENS_UI.md).
`components/FacilityCostDashboard.tsx` replaces the old `FacilityCostPanel.tsx`; it
reuses the same calculation/validation/staleness logic and the same official
`/facility-cost/calculate` response, re-laid-out as a header + warning notice +
multi-column filter bar (advanced settings in a disclosure) + responsive KPI grid +
funding breakdown + official-input region table + missing-components list + candidate
context + provenance.

## Known limitations

- The **suitability** sidebar panel (provenance, weights, reasons, method) is not
  collapsed on mobile; it is a long single-column scroll. It is overflow-free and
  fully usable — collapsing it further is a possible later refinement.
- The service-region picker in the cost dashboard remains a native multi-select in
  this phase; a searchable combobox is a later phase.
- The **live** e2e specs (`map`, `regressions`, `landfill`) still require
  `E2E_BACKEND_URL` and skip without it; only the self-mocked `responsive.spec.ts`
  runs unconditionally. In sandboxed environments the OSM basemap and vector tiles
  are network-blocked, so the map renders blank — the layout assertions measure the
  map **container**, which is robust to tile/WebGL availability.
- `dvh`/`svh`/`lvh` require a 2022-or-later browser engine. Older engines do **not**
  fall back on their own — an unsupported `dvh` value invalidates and drops the whole
  declaration. The layout therefore ships an explicit static-`vh` fallback before
  each `dvh` value: the shell via its `min-h-screen`/`md:h-screen` utility classes
  (see "Viewport-height strategy"), and the map via the `height: 60vh` base rule in
  `.map-pane` (see "Map pane sizing"), so those engines keep a valid full/60 %
  viewport height. Safe-area insets are handled by the default `viewport-fit`
  (content stays within the safe area); `viewport-fit=cover` is not used, so no
  notch-overlap handling is needed.
- A full **dark theme** is intentionally out of scope. The app is pinned to a
  consistent light palette (`color-scheme: light`); the previous `prefers-color-scheme:
  dark` `<body>` override (which framed the light app in black) was removed.

## 가중치 실험실 (weight scenario lab) sub-view

The scenario lab lives in the suitability sidebar beside the shared MapView (it is
NOT a full-width early-return like the cost lens — it keeps the map). At `< md` the
editor stacks above the map; sliders and numeric inputs fit the viewport; preset
buttons wrap; top-candidate rows and the floating scenario legend stay readable and
compact; there is no page-level horizontal overflow (verified in
`e2e/scenario.spec.ts` at 390×844 and by the shared responsive spec). At `md+` the
lab sidebar and map sit side by side with the sidebar scrolling internally. Cost view
remains full-width and map-free; landfill is unchanged.
