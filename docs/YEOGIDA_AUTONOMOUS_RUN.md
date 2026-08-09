# 여기다 (Yeogida) UI Redesign — Autonomous Run Log

Compact phase log for the seven-phase unattended implementation on
`feat/yeogida-figma-redesign`.

Spec: [`YEOGIDA_UI_REDESIGN_SPEC.md`](YEOGIDA_UI_REDESIGN_SPEC.md)
Unsupported items: [`YEOGIDA_UI_UNSUPPORTED_REQUIREMENTS.md`](YEOGIDA_UI_UNSUPPORTED_REQUIREMENTS.md)

---

## Environment baseline

| Item | Value |
| --- | --- |
| Workspace | `/Users/byeongilmin/dev/waste-equity-platform-ui` |
| Branch | `feat/yeogida-figma-redesign` |
| Base | `origin/main` @ `aece252f477b69b0dc1546ed184e666ed3f0841d` |
| Node / npm | v22.22.0 / 11.8.0 |
| Install | `npm ci` from the committed lockfile — 487 packages, no upgrades |

### Pre-change validation baseline (measured, `aece252`)

| Command | Result |
| --- | --- |
| `npm run lint` | **PASS** (clean) |
| `npm run typecheck` | **PASS** (clean) |
| `npm test` | 52 files: 50 passed, 1 skipped, **1 failed** — 1196 tests: 1188 passed, 7 skipped, 1 failed |
| `npm run build` | **PASS** (Next.js 16.2.10 / Turbopack, 4 static pages) |

The single baseline failure is `src/app/page.phase7.test.tsx` — a `waitFor`
timeout on `landfill-year-select` that occurs only under full-suite
concurrency. Re-run in isolation: **11/11 pass**. Recorded as a **pre-existing
load-dependent flake on the base commit**, not a regression introduced by this
work.

### Figma access

Both supplied Figma files were **not accessible** from this environment:

- target file → HTTP **403 Forbidden**
- meeting-notes file → login wall, no content

No Figma MCP server is connected to this session (the available `DesignSync`
tool targets claude.ai design-system projects, not Figma). Every phase
therefore builds from the approved written decisions in the spec plus the
existing repository design documentation. The authorised minimal
target/crosshair inline SVG fallback is used for the brand mark. No numeric
value was invented in place of an unverifiable Figma frame.

---

## Phase 1 — Foundation + global shell

**Scope:** shared shell, navigation, brand, design foundation only. No Page 1–5
body layout redesign.

### Delivered

1. **Docs** — created `YEOGIDA_UI_REDESIGN_SPEC.md` (source of truth),
   this run log, and `YEOGIDA_UI_UNSUPPORTED_REQUIREMENTS.md`.
2. **Brand** — 여기다 / 쓰레기 매립지 입지 추천 플랫폼, replacing
   "우리 동네 폐기물 지도" / "Waste Equity Platform" in the app bar. Historical,
   provenance, and technical occurrences of "Waste Equity Platform" were left
   untouched by design (spec §1).
3. **Brand mark** — a target/crosshair inline SVG (concentric circles + four
   ticks + centre dot), decorative and `aria-hidden`.
4. **Font** — Noto Sans KR via `next/font/google` with the `korean` +
   `latin` subsets, exposed as `--font-noto-sans-kr` and bound to
   Tailwind's `--font-sans`. The hard-coded `font-family: Arial, Helvetica,
   sans-serif` on `body` — which previously beat the font variable — was
   replaced with `var(--font-sans)`.
5. **Design tokens** — re-pointed in place (no renames, no second system):
   navy `#111a56` primary/brand/focus, `#f9f9f9` canvas, white surfaces,
   20px card radius, restrained shadows, and a new `--color-ink-faint`
   (`#848a95`) restricted to large/decorative text.
6. **Six visible destinations** — `NAV_DESTINATIONS` in `lib/glossary.ts`
   projects the six names onto the existing `(mode, view)` state. No new
   backend mode, no new URL-state version, `v=1` links unchanged.
7. **SVG icons** — one per destination, `aria-hidden`, with the visible Korean
   label as the accessible name.
8. **Sub-view control removed** — the shell's suitability `SegmentedControl`
   is gone; the six destinations now select `view` directly. The `view` URL
   parameter, decoder, encoder, and `suitabilityView` state are unchanged.
9. **One-row header** — verified at 1024 / 1280 / 1440.
10. **Mobile** — product name visible, subtitle hidden below 640px, nav
    horizontally scrollable without page overflow.

### Destination → state projection (implemented)

| Destination | mode | view |
| --- | --- | --- |
| 지역 지표 | equity | — |
| 폐기물 처리 현황 | flow | — |
| 후보지 분석 | suitability | cost |
| 후보지 심층 분석 | suitability | score |
| 후보지 심층 비교 | suitability | scenario |
| 데이터·출처 | transparency | — |

### Renames applied

| Surface | Before | After |
| --- | --- | --- |
| Nav + `<h1>` (equity) | 지역 부담 | 지역 지표 |
| Nav + `<h1>` (flow) | 매립지 현황 | 폐기물 처리 현황 |
| `<h1>` (landfill dashboard) | 수도권매립지 반입 현황 | 폐기물 처리 현황 |
| `<h1>` (facility cost) | 시설 비용 살펴보기 | 후보지 분석 |
| `<h1>` (suitability score) | 후보지 분석 | 후보지 심층 분석 |
| `<h1>` (scenario) | 후보지 분석 | 후보지 심층 비교 |
| `<h1>` (transparency) | 데이터와 출처 | 데이터·출처 |
| Document title | 수도권 폐기물 형평성 지도 — Waste Equity Platform | 여기다 — 쓰레기 매립지 입지 추천 플랫폼 |

### Test-id policy (read this before touching a spec in a later phase)

Four of the six names changed, but the automation ids did **not** — keeping them
preserved ~130 unit/e2e assertions. The mapping is therefore *not* self-evident
from the id:

| Destination | testId |
| --- | --- |
| 지역 지표 | `mode-equity` |
| 폐기물 처리 현황 | `mode-flow` |
| 후보지 분석 | `suitability-view-cost` |
| 후보지 심층 분석 | `mode-suitability` |
| 후보지 심층 비교 | `suitability-view-scenario` |
| 데이터·출처 | `mode-transparency` |

Retired: `suitability-view-score` (it is `mode-suitability`) and
`suitability-subviews` (the bar itself). Each button also carries a readable
`data-destination` attribute.

### Validation

| Gate | Baseline (`aece252`) | After Phase 1 |
| --- | --- | --- |
| `npm run lint` | PASS | **PASS** |
| `npm run typecheck` | PASS | **PASS** |
| `npm test` | 1188 pass / 7 skip / 1 flake | **1197 pass / 7 skip / 0 fail** |
| `npm run build` | PASS | **PASS** |

Unit tests grew by 9 (new destination-projection, icon, and one-pressed-at-a-time
coverage). The baseline `page.phase7.test.tsx` flake did not recur.

Playwright, the suites the phase requires:

| Suite | Covers | Result |
| --- | --- | --- |
| `civicShell.spec.ts` | shell, brand, one-row bar, URL restore @ 1024/1280/1440/1920 | **PASS** |
| `desktopNavigation.spec.ts` | six destinations one row, keyboard order, map height @ 1280/1440 | **PASS** |
| `accessibility.spec.ts` | skip link, focus, nav group semantics | **PASS** |
| `responsive.spec.ts` | 390 mobile + desktop, no horizontal page overflow | **PASS** |

33 shell/navigation tests plus the accessibility and responsive suites pass. The
1024px "shows the whole app bar without clipping" test is the direct guard that
six destinations fit one unwrapped row at the minimum supported desktop width.

### Specs updated for the new contract (not weakened)

`civicShell`, `desktopNavigation`, `finalUiIntegration`, `phase7FinalRegression`,
`transparencyDashboard`, `landfillDashboard`, `phase5LandfillDashboard`,
`phase6DataSourcesDashboard`, `equityDashboard`, `facilityCost`,
`facilityCostDashboard`, `phase3CostResults`, `suitabilityDashboard`, `scenario`,
`citizenFlows`, `landfill`, `mapInsightDisclosure`.

Two contracts were **inverted on purpose**, and each inversion is now asserted
rather than deleted:

1. `suitability-subviews` must be absent everywhere (was: present in the three
   suitability views) — replaced by "exactly one of six destinations is pressed",
   which is a strictly stronger check because the three suitability destinations
   share a `mode`.
2. The `<h1>` equals the nav label (was: 데이터·출처 nav vs 데이터와 출처
   heading, deliberately different). The old test asserted the two strings were
   distinct; the new one asserts, for all six destinations, that they match.

### Full Playwright suite

`npx playwright test` — **541 passed, 89 skipped, 2 failed**.

The 89 skips are the live-backend specs, which `test.skip` themselves when
`E2E_BACKEND_URL` is unset (the repository's standing convention — no mock is
ever substituted for a spec that asserts against real official data).

The 2 failures are **pre-existing on `origin/main`**, not caused by this phase.
Both are in `e2e/phase5LandfillDashboard.spec.ts` and both are caused by the
municipal-cost section that landed in `063d977`:

| Test | Cause |
| --- | --- |
| `the standing limitation is one compact info banner, not an alert` | asserts `.wep-banner` count is 1 across the whole dashboard; `MunicipalCostSection` renders a second, legitimate warning banner |
| `clears the previous filter's values before the new ones arrive` | asserts the dashboard does not contain `2024년` mid-flight; the municipal section's heading is `… 계약 지급액 — 2024년`, a different dataset unaffected by the landfill period filter |

**Proof, not assumption:** a detached `git worktree` at `origin/main`
(`aece252`) with its own `npm ci` and its own dev server reproduces both
failures identically — the baseline failure output still shows the old
`수도권매립지 반입 현황` heading, confirming it was the baseline code under test.
Left unfixed deliberately: repairing them means deciding whether those
assertions should be scoped to the landfill section, which is Page 2's
question (Phase 5), not the global shell's.

### Measured visual verification

Live measurement in Chromium against the running app (not inferred from source):

| Property | 390×844 | 1024×800 | 1440×900 |
| --- | --- | --- | --- |
| Nav buttons | 6 | 6 | 6 |
| Nav rows | **1** | **1** | **1** |
| App-bar height | 91px (brand + nav rows) | 65px | 65px |
| Page horizontal overflow | **0px** | **0px** | **0px** |
| `<h1>` | 지역 지표 | 지역 지표 | 지역 지표 |

- `body` computed font: `"Noto Sans KR", "Noto Sans KR Fallback", "Apple SD
  Gothic Neo", "Malgun Gothic", sans-serif` — the webfont genuinely applies.
  (Before this phase `body` pinned `Arial, Helvetica, sans-serif`, which beat
  the font variable, so any Korean webfont would have been inert.)
- Brand colour: `rgb(17, 26, 86)` = `#111A56`.
- Canvas: `rgb(249, 249, 249)` = `#F9F9F9`.
- At 390px the subtitle is hidden, 여기다 stays visible, and the nav track
  scrolls horizontally — the page itself does not.

### Phase 1 result

**PHASE STATUS: PASS WITH NON-BLOCKING LIMITATIONS**

Limitations, both recorded in `YEOGIDA_UI_UNSUPPORTED_REQUIREMENTS.md`:

1. Figma was unreachable (403 / login wall), so exact frame fidelity is
   unverifiable; the approved written decisions were implemented instead (U1).
2. Two pre-existing `phase5LandfillDashboard` e2e failures inherited from
   `origin/main`, proven against a baseline worktree and scheduled for Phase 5.

Commit: `798378e`.

---

## Phase 2 — Page 1 지역 지표 + resizable sidebar

**Scope:** the 지역 지표 destination only. No analytical logic rewritten.

### The resizable control column

New `components/ui/ResizableSidebar.tsx` replaces the fixed `md:w-96` (384px).

| Behaviour | Implementation |
| --- | --- |
| Bounds | min **300**, default **360**, max **520** |
| Persistence | `localStorage["yeogida.equity.sidebarWidth"]`, validated + clamped on read |
| Pointer | `pointerdown` + **pointer capture**, so a drag that crosses onto the map keeps working and the map never sees it |
| Cursor | `col-resize` |
| Hit target | a real **10px** flex band that paints only a 1px hairline down its centre |
| Keyboard | ←/→ ±16px, **Home** → 300, **End** → 520 |
| Double-click | restores 360 |
| ARIA | focusable `role="separator"`, `aria-orientation="vertical"`, live `aria-valuenow/min/max/valuetext` |
| Mobile | `.wep-sidebar-resizer` is `display: none` below 768px |

Two design decisions worth keeping in mind for later phases:

1. **The width is a CSS custom property, not an inline `width`.** An inline
   width would beat every media query and pin the *phone* column to the desktop
   size. `--wep-sidebar-width` is published by the component and read only
   inside the `min-width: 768px` block, so "mobile ignores desktop resize" is
   structural rather than a JS branch that could drift from the CSS.
2. **No new `ResizeObserver`.** `MapView` already observes its own container and
   coalesces bursts into one `map.resize()` per animation frame. Narrowing the
   column widens the sibling `.map-pane`, that observer fires, and the canvas
   follows. A second observer would double every resize during a drag. The width
   state also lives inside `ResizableSidebar`, so a drag re-renders neither the
   page nor the map subtree — the map is never remounted.

### Panel hierarchy

Reordered to the approved Figma hierarchy (spec §3):

| Before | After |
| --- | --- |
| 선택 요약 → 지역 선택 → 지표 선택 → 비교 → 순위 → 공유 | **지역 선택 → 지표 선택 → 선택 요약 → 지표 순위 → 비교 → 공유** |

The two *choices* now lead and the summary is presented as their *result*.
Every component, prop, test id, and data path is unchanged — this is ordering
only.

### Validation

| Gate | Result |
| --- | --- |
| `npm run lint` | **PASS** |
| `npm run typecheck` | **PASS** |
| `npm test` | **1222 passed / 7 skipped** (up from 1197; +24 sidebar tests) |
| `npm run build` | **PASS** |
| `e2e/equitySidebarResize.spec.ts` (new, 12 tests) | **PASS** |
| Full Playwright suite | **568 passed / 89 skipped / 2 failed** (up from 552; the 2 are the same pre-existing `phase5LandfillDashboard` failures — see U4) |

The new e2e spec covers what jsdom cannot: a real pointer drag, clamping at both
bounds, the canvas tracking its pane after a resize, the map surviving repeated
drags without remounting, keyboard operation with a visible focus ring,
double-click reset, persistence across reload (plus corrupted- and
out-of-range-store repair), no page-level horizontal scrolling at any drag
position, selection preserved across a resize, the full range still usable at
1024px, and no handle at all on a 390px phone.

### One test re-pointed (not weakened)

`equityDashboard.spec.ts` asserted the selection summary sat above the fold.
The approved reorder moved it below the two choice cards, so that assertion was
split in two rather than deleted:

- **the header and BOTH choices** must be actionable without scrolling — the
  stronger form of the original intent, since those are what a reader acts on;
- **the summary's facts** must still have a real on-screen home, reachable in
  the column and never only in a tooltip — the original guarantee, verbatim,
  including the collapsed-map-insight checks.

---
