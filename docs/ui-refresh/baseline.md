# UI refresh — frontend baseline

Captured **2026-08-02**, immediately before the civic-dashboard visual foundation
milestone (`feat/civic-dashboard-foundation`). This file records what the frontend
was, so the refresh can be reviewed against a written before-state rather than
memory.

Nothing in this document is aspirational: every path, command, and constraint below
was read out of the repository at that commit.

## 1. Application surface

The frontend is a **single Next.js App Router route** — there is no per-area URL path.

| Item | Value |
| --- | --- |
| Route | `/` only (`frontend/src/app/page.tsx`) |
| Root layout | `frontend/src/app/layout.tsx` (`<html lang="ko" class="h-full">`, skip link, Geist fonts) |
| Area selection | URL state, not routing: `?v=1&mode=<area>&view=<subview>&metric=…` |
| URL state module | `frontend/src/lib/urlState.ts` |

### Areas ("modes")

The four citizen-facing areas and their frozen Korean labels come from
`frontend/src/lib/glossary.ts` (`MODE_LABELS`):

| Mode key | Label | Layout variant | Mounts a map? |
| --- | --- | --- | --- |
| `equity` | 지역 부담 | `map` | yes |
| `suitability` | 후보지 분석 | `map` (score, scenario) / `page` (cost) | score + scenario only |
| `flow` | 매립지 현황 | `page` | no |
| `transparency` | 데이터·출처 | `page` | no |

`suitability` has three sub-views (`SUBVIEW_LABELS`): 후보지 점수 (`score`),
가중치 바꿔보기 (`scenario`), 비용 살펴보기 (`cost`).

## 2. Shared layout components

| Component | Path | Role |
| --- | --- | --- |
| `DashboardShell` | `frontend/src/components/DashboardShell.tsx` | The one shell for every branch: owns the viewport-height chain, renders `TopNavigation` once, the suitability sub-view bar, and the single `<main id="main-content" tabIndex={-1}>` |
| `TopNavigation` | `frontend/src/components/ui/TopNavigation.tsx` | The one global navigation (`role="group"` + four `aria-pressed` buttons) |
| `SegmentedControl` | `frontend/src/components/ui/SegmentedControl.tsx` | The suitability sub-view switch |
| `MapView` | `frontend/src/components/MapView.tsx` | MapLibre GL map; dynamically imported, mounted by at most one branch at a time |
| `MapLegendOverlay` | `frontend/src/components/MapLegendOverlay.tsx` | Floating legend card over the map |
| Area dashboards | `LandfillDashboard`, `FacilityCostDashboard`, `TransparencyDashboard` | Full-width, map-free areas; each owns its own `<h1>` |

Pre-existing shared primitives under `frontend/src/components/ui/`: `Accordion`,
`Chip`, `EmptyState`, `InfoBanner`, `KpiCard`, `SearchableRegionPicker`,
`SegmentedControl`, `Skeleton`.

## 3. Styling baseline

* `frontend/src/app/globals.css` — Tailwind v4 (`@import "tailwindcss"`), a `@theme`
  block of semantic tokens introduced in the Phase 7 consolidation, and a small set
  of `.wep-*` component classes (`wep-card`, `wep-appbar`, `wep-nav-tab`,
  `wep-segment`, `wep-banner`, `wep-accordion`, `wep-skeleton`, `wep-chip`,
  `wep-btn-primary`, `wep-btn-quiet`, `wep-orient`).
* There is **no `tailwind.config.*`** — configuration is CSS-first via `@theme`
  (`postcss.config.mjs` loads `@tailwindcss/postcss` only).
* The token names (`surface`, `ink`, `hairline`, `primary`, `warn`, …) are already
  used ~450 times across components, so the refresh **re-points token values and adds
  missing roles rather than renaming anything**.
* The application is deliberately light-only (`color-scheme: light`); no dark theme.

### Analytical map palette (separate, untouched)

`frontend/src/lib/metrics.ts` is the single source of truth for every analytical
color: the ColorBrewer choropleth ramps, `NO_DATA_COLOR`, the candidate score
palette and breaks, `CANDIDATE_REVIEW_COLOR`, `CANDIDATE_EXCLUDED_COLOR`,
`CANDIDATE_STABLE_OUTLINE_COLOR`, and `FACILITY_CATEGORY_COLORS`. Legends read the
same constants the map fills use, so the two can never diverge. This file is **not**
part of the UI token system and is not modified by the refresh.

## 4. Validation commands

Defined in `frontend/package.json` — there is no `format` script and no CI workflow
in this repository (`.github/workflows` does not exist).

```bash
cd frontend
npm run lint        # eslint (eslint-config-next)
npm run typecheck   # tsc --noEmit
npm test            # vitest run  (src/**/*.test.ts, src/**/*.test.tsx)
npm run build       # next build
npm run test:e2e    # playwright test (starts `next dev` on port 3000 itself)
```

Playwright specifics (`frontend/playwright.config.ts`):

* The dev server always starts; `baseURL` is `http://localhost:3000` because port
  3000 is the backend's CORS allowlist.
* Live smoke specs (`map`, `regressions`, `landfill`, `landCover*`, `publicRelease`,
  …) `test.skip` themselves unless `E2E_BACKEND_URL` (or `PUBLIC_BASE_URL`) is set.
* Layout specs (`responsive`, `desktopNavigation`, and the new `civicShell`) mock
  every backend request with `e2e/mockBackend.ts`, so they need no backend, no
  database, and no tile server.
* Playwright browsers are not installed in this environment; runs use the local
  Chrome channel.

## 5. Desktop viewport targets

| Viewport | Status |
| --- | --- |
| 1280 × 800 | supported target, asserted by e2e |
| 1440 × 900 | primary target, asserted by e2e |
| 1920 × 1080 | supported target, asserted by e2e (added in this milestone) |
| 1024 × 768 | minimum supported width — must not clip horizontally |
| < 1024 | not a design target; existing responsive behavior is preserved, not extended |

The repository additionally has a pre-existing, test-enforced responsive contract at
390 / 430 / 768 / 1054 px (`frontend/RESPONSIVE_LAYOUT.md`,
`e2e/responsive.spec.ts`). That contract is **preserved**; see
`regression-contract.md` §9 for why the reference `.app-shell { min-width: 1024px }`
rule was deliberately not adopted.

## 6. Known layout constraints (do not break)

1. **The map-height chain.** `.map-pane` sizes the map with `height: 100%` at md+,
   which requires a definite parent height. `DashboardShell`'s root is the
   fixed-height flex column (`md:h-screen md:h-dvh`), the header is an ordinary
   auto-height first child, and `<main>` is `md:flex-1 md:min-h-0`.
2. **The header must not be `sticky`/`fixed`** — that removes it from the column's
   height accounting and reintroduces the empty strip below the map.
3. **Fallback-before-dvh class ordering.** `min-h-screen` must precede `min-h-dvh`
   and `md:h-screen` must precede `md:h-dvh`; Tailwind emits the static utility
   *after* the dynamic one, so `globals.css` re-asserts the dynamic value in
   `@supports` blocks keyed on the two-class selectors.
4. **`.map-pane` and `.mobile-collapsible` and `.map-legend` are separate classes on
   purpose** — `.wep-accordion` genuinely collapses at every width, while
   `.mobile-collapsible` force-opens at md+ so no desktop analytical option is ever
   hidden behind a toggle.
5. **Exactly one `MapView`** may be mounted; map-free areas must not hide a map with
   CSS, they must not mount one.
6. **The equity sidebar is the scroll container** at md+
   (`md:overflow-y-auto`), not the page.
7. The suitability sub-view bar is rendered as a conditional **sibling before**
   `<main>` so React keeps `<main>` in the same child slot and the map is never
   remounted when entering or leaving 후보지 분석.
8. The chrome above the map must stay compact — `e2e/responsive.spec.ts` asserts the
   chrome bottom is within 12% of the viewport height at desktop sizes.

## 7. Screenshots available in the repository

Real, committed before-state captures at 1440 × 900 live in
`docs/ui-baseline/desktop/`:

`regional-burden-1440x900.png`, `candidate-score-1440x900.png`,
`candidate-weights-1440x900.png`, `facility-cost-setup-1440x900{,-full}.png`,
`facility-cost-results-1440x900{,-full}.png`,
`landfill-dashboard-1440x900{,-full}.png`, `data-sources-1440x900{,-full}.png`.

They were produced by `frontend/e2e/desktopBaseline.spec.ts`
(`CAPTURE_UI_BASELINE=1`), which is a **frozen Phase 0 artifact and is not
maintained** — two of its cost captures still drive a `<select>` that a later phase
replaced with a combobox, so opting in fails there. This milestone does **not**
re-capture or overwrite those images: they are the only committed before-state the
redesign is measured against.

There is **no visual-regression (pixel-snapshot) infrastructure** in this repository
— no `toHaveScreenshot`/`toMatchSnapshot` anywhere in `e2e/` — and this milestone
does not introduce one. New Playwright assertions are structural (counts, roles,
labels, geometry), never pixel comparisons.
