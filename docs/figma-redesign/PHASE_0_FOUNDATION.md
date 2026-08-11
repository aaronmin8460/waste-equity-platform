# Phase 0 — Figma six-page redesign foundation

Infrastructure only. No page was redesigned, no analytical logic was touched, nothing was
deployed. The purpose is to make Page 1 (지역 지표) a safe next step.

Branch `feat/figma-six-page-redesign`, worktree
`/Users/byeongilmin/dev/waste-equity-platform-figma`.

## 1. Branch base — read this before comparing against `main`

Phase 0 branched from **`feat/yeogida-figma-redesign` (755d0eb)**, not from `main`.

Production (`https://waste-161-33-2-143.sslip.io`) runs `bf5165f`, which lives on that
branch and **was never merged to `main`**. `main` (aece252) is 14 commits and 86 frontend
files behind what is live (+7,826 / −1,624). Concretely, 데이터·출처 is a modal in production
and in Figma but is still a full page on `main` (`ui/Dialog.tsx` exists only on the yeogida
branch), so a redesign based on `main` would have started from a shell that does not match
either the deployed app or the design.

**`main` and production have diverged and still need reconciling.** That is a separate
decision, out of Phase 0's scope, but it should not be left indefinitely.

## 2. Baseline

Captured on the branch point before any Phase 0 edit, re-run after.

| Check | Command | Before | After |
|---|---|---|---|
| Lint | `npm run lint` | PASS | PASS |
| Types | `npm run typecheck` | PASS | PASS |
| Unit | `npm test` | 1320–1321 / 1329, 7 skipped | 1335–1336 / 1344, 7 skipped |
| Build | `npm run build` | PASS | PASS |
| Backend | pytest | NOT RUN | NOT RUN |

**The one unit failure is a pre-existing flake, not a regression.**
`page.suitabilityDashboard.test.tsx > 후보지 점수 — candidate list and selection > restores a
candidate from the versioned URL` fails only in a full-suite run. It passed 3/3 in isolation,
and two consecutive full-suite runs produced *disjoint* failing sets — the signature of the
first-paint race already recorded in `docs/ui-refresh/`. Phase 0 added 15 tests; the totals
move by exactly that.

**Backend was not run**, and Phase 0 changes no backend file — `git show --stat` on the
commit is entirely `frontend/` and `docs/`. Prerequisites were absent locally (Docker daemon
down, `TEST_DATABASE_URL` unset, which makes the PostGIS tier skip silently). Step 9's
contract — no change to calculations, API semantics, PostGIS, scoring, screening, schema,
ingestion, routes, or URL parameters — holds by construction, not by assertion.

## 3. Frontend architecture

Next.js **16.2.10** App Router (Turbopack), React **19.2.4**, TypeScript strict, npm,
**Tailwind v4** (CSS-first `@theme` in `app/globals.css`; there is no `tailwind.config`),
vitest + @testing-library (jsdom), Playwright e2e, MapLibre GL, `write-excel-file`.
No component framework, and **no icon library of any kind** — before Phase 0 there were five
inline `<svg>` in the whole app.

**One route.** `src/app/page.tsx` is the only page; all six surfaces are query-param state
(`?v=1&mode=…&view=…`). There is no per-page routing to redesign — Page N means a branch
inside this component tree.

`lib/glossary.ts → NAV_DESTINATIONS` is the single registry projecting the six visible
destinations onto four analytical modes plus a three-valued sub-view, and it already matches
the six Figma frames 1:1:

| # | Destination | mode / view | Figma frame |
|---|---|---|---|
| 1 | 지역 지표 | `equity` | 74:1992 |
| 2 | 폐기물 처리 현황 | `flow` | 125:5064 |
| 3 | 후보지 분석 | `suitability` + `cost` | 129:5709 |
| 4 | 후보지 심층 분석 | `suitability` + `score` | 136:8684 |
| 5 | 후보지 심층 비교 | `suitability` + `scenario` | 167:10554 |
| 6 | 데이터·출처 | `transparency` | 156:470 |

**Do not rename the test ids.** `mode-suitability` is 후보지 심층 분석 and
`suitability-view-cost` is 후보지 분석 — deliberately counterintuitive, kept so ~130
existing assertions keep addressing the same controls.

### Element → source map

| UI element | Source | Shared | Phase 0 verdict |
|---|---|---|---|
| Shell / header / brand / nav / active state | `ui/TopNavigation.tsx` | yes | reuse; visual replace in **Page 1** |
| Nav registry | `lib/glossary.ts` `NAV_DESTINATIONS` | yes | reuse unchanged |
| Tokens | `app/globals.css` `@theme` + ~50 `.wep-*` | yes | **extended, additive only** |
| Icons | inline `<path>` in `TopNavigation` | no | **replaced by `FigmaIcon` in Page 1** |
| Card | `ui/SectionCard`, `.wep-card`, `ui/PageHeader` | yes | reuse |
| Modal | `ui/Dialog.tsx` | yes | reuse (데이터·출처) |
| Disclosure | `ui/Accordion`, `ui/CollapsiblePanel` | yes | reuse |
| Chips / pills / segmented | `ui/Chip`, `ui/FilterChip`, `ui/SegmentedControl` | yes | reuse |
| Region picker | `ui/SearchableRegionPicker`, `equity/EquityRegionPicker` | partly | assess in Page 1 |
| Ranking | `RegionRanking`, `FullRankingDialog`, `lib/ranking.ts` | yes | assess in Page 1 |
| Sidebar | `ui/ResizableSidebar` | yes | reuse |
| Loading / empty | `ui/Skeleton`, `ui/EmptyState` | yes | reuse |
| Map + legend | `MapView`, `MapLegendOverlay`; palette in `lib/metrics.ts` | yes | reuse; **palette stays in `metrics.ts`** |
| Buttons | `.wep-btn-primary` / `.wep-btn-quiet` | yes | reuse |
| Select / search field | ad-hoc `<select>` per dashboard | **no** | Figma has a `Select Field` component — Page 1 |
| **Tooltip** | **does not exist** | — | build when a page needs it |
| **Table** | **no primitive** — 12 ad-hoc `<table>` | **no** | Pages 2/3/6 |

## 4. What Phase 0 built

Only what is unquestionably shared, needed for Page 1, and inert until used.

- **`ui/FigmaIcon.tsx`** — the single renderer for exact Figma vectors. Closed registry: a
  name that was never exported from Figma is a type error, not a silent substitution.
  Decorative by default (`aria-hidden`) so a nav tab is not announced twice; `title` makes it
  a named `role="img"`. `size` scales both axes equally, since these glyphs are not square
  (17×20, 20×17, 14×14) and forcing width = height would distort them.
- **`ui/figmaIcons.generated.ts`** — generated, never hand-edited.
- **`scripts/generate-figma-icons.mjs`** + `npm run icons:generate` — copies geometry
  verbatim from the committed SVGs so nothing is re-typed by hand.
- **`public/icons/figma/*.svg`** — 7 exact exports. See `FIGMA_ASSET_INVENTORY.md`.
- **Tokens** — one new role (`--color-ink-secondary`) plus 17 measured `--figma-*` shell
  values. Nothing re-pointed. See `DESIGN_TOKENS_FIGMA_AUDIT.md`.
- **15 tests** across `FigmaIcon.test.tsx` and `figmaIcons.generated.test.ts`, including a
  drift check that re-reads the SVGs and fails if the registry no longer matches.

Deliberately **not** built — no page needs them yet, and building them now would guess at
requirements the page audits have not settled: `Card`/`SectionTitle` (adequate primitives
exist), `SelectField`, `SearchField`, `PillToggle`, `RegionSelector`, `RegionChip`,
`RankingList`, `RankingModal`, `MapLegend`, `SourceBadge`, `ExportButton`, `Tooltip`,
`EmptyState`/`LoadingState` (already exist).

## 5. Known debt relevant to Page 1

1. **Nav icons are hand-drawn.** `TopNavigation.tsx` carries approximated `<path>` data for
   all six destinations plus the brand. Page 1 replaces them with `FigmaIcon`; its snapshot
   assertions in `TopNavigation.test.tsx` will need updating alongside.
2. **`main` ≠ production.** See §1.
3. **Icons missing from Figma.** 13 of the 20 requested assets do not exist as vectors —
   `FIGMA_ASSET_BLOCKERS.md`. None was substituted. Page 1's shell needs none of them; later
   pages do.
4. **Figma status colours fail contrast.** Two of three are below 4.5:1 — see the audit §3.
5. **No shared table or tooltip.** Pages 2/3/6 will need them.
6. **Full-suite flake.** Re-run a suspect test in isolation before calling it a regression.
7. **Figma frames are desktop-only at 1440 px.** The app ships a responsive layout with a
   documented `md` breakpoint (`frontend/RESPONSIVE_LAYOUT.md`). The design specifies no
   mobile behaviour, so each page phase must preserve the existing responsive rules rather
   than hard-coding 1440 px assumptions.

## 6. Recommended start for Page 1

1. Read frame **74:1992** in full (`page-1`, 1440×1753).
2. Rebuild the shell in `ui/TopNavigation.tsx`: swap the seven inline `<svg>` for `FigmaIcon`
   and adopt the `--figma-*` geometry (header 78, nav track 50/999, tab 38/40, gap 7).
   Update `TopNavigation.test.tsx` in the same commit.
3. Only then move to the 지역 지표 body, keeping `NAV_DESTINATIONS`, the test ids, the URL
   contract, and `lib/metrics.ts` untouched.
