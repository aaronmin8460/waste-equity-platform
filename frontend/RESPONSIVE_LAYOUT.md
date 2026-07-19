# Responsive layout (Phase 1 — mobile usability)

Status: **implemented on the `fix/responsive-mobile-layout` feature branch. Not
deployed.** This phase makes the existing dashboard usable on phones without
changing analytical logic, the data model, API behavior, map calculations, the
cost/scoring model, or the visual design beyond what responsive layout requires.

The dashboard was previously a permanently horizontal `flex` row with a fixed
384 px (`w-96`) sidebar, so on a ~390 px phone the sidebar filled the viewport and
the map was pushed off-screen. It now adapts to the viewport.

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
- Verbose control panels collapse into native `<details>` disclosures with clear
  Korean labels — 지도 범례 (Legend), 출처 및 방법 (Sources & method), 시설 레이어
  (Facility layer) — so the map stays reachable with minimal scrolling. Primary
  controls (mode switch, metric selection) are never collapsed.
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

`h-screen` (static `100vh`) is replaced with the dynamic viewport unit `dvh`
everywhere the app fills the screen:

- Root shell: `min-h-dvh` on mobile, `md:h-dvh` on desktop.
- Loading / error states and the landfill dashboard: `min-h-dvh`.
- `<body>`: `min-h-dvh`.

`dvh` accounts for mobile browser chrome (address bar) expanding/collapsing, so
the app is never cropped by, or leaves a gap under, the browser toolbars.

An explicit responsive `viewport` is exported from `app/layout.tsx`
(`width=device-width, initialScale=1`), with pinch-zoom left enabled for
accessibility.

## Map minimum-height strategy

MapLibre's container is `h-full` (100 % of its wrapper). A percentage height needs
a **definite** parent height, so on mobile the map wrapper uses a fixed
`h-[60dvh]` rather than a bare `min-h`: a bare min-height leaves the height
indefinite and the percentage child collapses to zero (the "map collapses when the
flex direction changes" bug). 60 dvh gives a prominent, stable map (~500 px on a
844 px phone). On desktop the wrapper switches to `md:flex-1 md:h-auto md:min-h-0`
and simply fills the fixed-height row.

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

| Viewport         | Size      | Layout       |
| ---------------- | --------- | ------------ |
| Phone            | 390 × 844 | stacked      |
| Large phone      | 430 × 932 | stacked      |
| Tablet portrait  | 768 × 1024| side-by-side |
| Desktop          | 1440 × 900| side-by-side |

Each viewport asserts: the app loads, the map container has meaningful width and
height and is not pushed off-screen, no page-level horizontal overflow
(`documentElement.scrollWidth ≤ clientWidth + 1`), the mode switcher is visible and
every mode is selectable, and the map stays visible across mode switches. Mobile
additionally verifies collapsed panels open/toggle and radios stay reachable;
desktop verifies the panels are force-expanded with no toggles. `app/responsive.test.tsx`
adds a jsdom structural guard for the responsive classes.

## Known limitations

- The **suitability** sidebar panel (provenance, weights, reasons, method) is not
  collapsed on mobile; it is a long single-column scroll. It is overflow-free and
  fully usable — collapsing it further is a possible later refinement.
- The **live** e2e specs (`map`, `regressions`, `landfill`) still require
  `E2E_BACKEND_URL` and skip without it; only the self-mocked `responsive.spec.ts`
  runs unconditionally. In sandboxed environments the OSM basemap and vector tiles
  are network-blocked, so the map renders blank — the layout assertions measure the
  map **container**, which is robust to tile/WebGL availability.
- `dvh`/`svh`/`lvh` require a 2022-or-later browser engine; older engines fall back
  to viewport-relative behavior. Safe-area insets are handled by the default
  `viewport-fit` (content stays within the safe area); `viewport-fit=cover` is not
  used, so no notch-overlap handling is needed.
