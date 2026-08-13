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

Commit: `f71f927`.

---

## Phase 3 — 후보지 심층 분석 — **PARTIAL / IN PROGRESS**

> **Status: the A/B/C relative-grade foundation is complete, tested, and
> committed. The three-column collapsible workspace is NOT implemented.**
> Phase 3 is therefore **not** finished and must not be reported as PASS.

### Delivered: 상대 점수 구간 (A/B/C)

`frontend/src/lib/relativeGrade.ts` + `relativeGrade.test.ts` (20 tests).

**The population problem, and how it was solved without a backend change.**
The spec requires thresholds from the *complete* authoritative ELIGIBLE
population — never a viewport, filter, or top-N slice. That population is
**17,501** candidates at ~894 bytes/feature, i.e. ~15.6 MB of GeoJSON (measured
against production), which is not a safe thing to download to compute two
numbers.

Instead the module reads the two **order statistics** directly. The existing
`/suitability/candidates` endpoint already supports this:

- `top=…` switches the filter to `status = ELIGIBLE` *with a rank for the
  requested profile*, and orders by that rank **ascending**; `total_matched` on
  that query is exactly N.
- `limit=1&offset=k-1` returns the k-th ranked candidate, so its `total_score`
  **is** the order statistic.
- `min_score=` + `limit=1` returns an exact band count without listing anything.

`top` is capped at 5000 by the API, but it bounds only `effective_limit`
(`min(top, limit)`) — never the offset — so `top=5000&limit=1&offset=k-1`
reaches any rank. Total cost: **four ~1 KB requests**, no new endpoint, no
backend change, and the result is *exact* rather than sampled.

**Percentile method (deterministic).** Nearest-rank on the ascending score
order: `ascendingIndex(p) = ceil(p/100 × N)`, mapped to the API's descending
rank as `N − i + 1`. No interpolation; every threshold is a score some candidate
actually holds.

**Verified against production** (`https://waste-161-33-2-143.sslip.io`,
2026-08-10), run **48**, profile **baseline**:

| Quantity | Value |
| --- | --- |
| Population N (complete ELIGIBLE, ranked) | **17,501** |
| P25 (asc index 4,376 → desc rank 13,126) | **47.6779** |
| P75 (asc index 13,126 → desc rank 4,376) | **57.811** |
| A (`score ≥ P75`) | **4,914** |
| B (`P25 ≤ score < P75`) | **8,403** |
| C (`score < P25`) | **4,184** |
| Sum | 17,501 ✓ |

The bands are **not** 25/50/25. Because they are defined by *value*
(`score ≥ P75`) rather than by position, score **ties** at a threshold enlarge
the adjacent band. That is the truth about this distribution, so the module
counts the bands via the backend rather than assuming quarters, and the test
asserts `countA !== round(N/4)` so nobody "fixes" it back to an assumption.

**Safety properties, each individually tested:** a non-ELIGIBLE candidate is
never graded; a missing score is ungraded rather than a low grade; a population
below 4, an unscored threshold candidate, a degenerate `P75 < P25`, bands that
fail to partition N, and any request failure all resolve to `null` (grade
disabled) instead of a fabricated threshold. Band labels are banned from using
`적격 / 부적격 / 제외 / 통과 / 탈락`; the explanation *does* use those words, but
only to deny them explicitly.

### Not delivered in Phase 3

- left collapsible panel / central map / right collapsible panel workspace
- panel collapse + reopen controls and their MapLibre no-remount contract
- mobile stacked/drawer representation
- wiring the grade into the candidate list, legend, and selected-candidate panel
- the Phase 3 layout tests

`lib/relativeGrade.ts` is currently referenced only by its own test — it is a
**foundation awaiting the layout work**, deliberately committed rather than
discarded because the production verification behind its numbers is the
expensive part.

### Validation at this checkpoint

| Gate | Result |
| --- | --- |
| `npm run lint` | **PASS** |
| `npm run typecheck` | **PASS** |
| `npm test` | **1242 passed / 7 skipped** (up from 1222; +20 grade tests) |
| `npm run build` | **PASS** |

---

### Phase 3b — three-column workspace (this turn)

Delivered: `components/ui/CollapsiblePanel.tsx` (an `<aside>` per column),
`components/suitability/RelativeGradeChip.tsx`, the `part="left" | "right"` split
of `SuitabilitySidebar`, the workspace restructure in `page.tsx`, and
`app/page.deepAnalysis.test.tsx` (20 tests).

- Left = 분석 조건 (scoring basis, Z/R/E/D weights, status/stability context,
  method + limitations). Right = 후보지 결과 (relative bands, stability, ranking,
  selected candidate, served reasons). Map stays between them at a STABLE child
  index, so React reconciles it instead of remounting when areas change.
- Each column collapses to a 48px rail independently; the body is hidden by a
  CSS class scoped to md+ (never the `hidden` attribute), so a phone always has
  the full stacked content and no unopenable panel.
- Panels are always mounted — collapsing cannot remount the map or drop state.
  Asserted by node IDENTITY, not presence.
- `computeGradeDistribution` is now memoised per run+profile (successes only;
  failures stay retryable). This removed a real regression: the four reads fired
  on every mount and pushed `page.suitabilityDashboard.test.tsx` from ~17s to
  ~45s, which surfaced two `waitFor` flakes. With the cache the full unit suite
  is **1265 passed / 0 failed**, including the previously-documented
  `page.phase7` flake.
- Panel width is 15.5rem below 1280px and 21rem above. At 21rem the PAIR left
  only ~336px of map at the 1024px minimum and the floating overlays collided —
  a genuine defect found by e2e and fixed, not silenced.

**Stable-candidate semantics — checked, and deliberately NOT changed.** A review
instruction asserted the rule is "top 10 ranked positions". The authoritative
backend says otherwise, in two independent places:
`backend/src/waste_equity_backend/analysis/suitability/policy.py:128` and the
live production API, whose `stability_definition` reads *"remains in the top 10%
of complete ELIGIBLE candidates under baseline, equal, and CRITIC profiles"*
with `top_fraction: "0.10"` and `top_cutoff_rank: 1751` (= 10% of 17,501). The
3/3-across-baseline/equal/critic part is already correct. Rewriting "top 10%" to
"top 10 positions" would make the UI misstate the backend, so it was left alone.

#### Resolved open item

RESOLVED. `e2e/mapInsightDisclosure.spec.ts:393` (후보지 심층 분석 @ 1440×900) had failed: the
map is narrower with two columns, so the collapsed insight bar now sits at the
coordinate the test probes for a map click. This is a REAL overlay-collision
consequence of the new layout, not a stale assertion, and is the next thing to
fix. **Fixed:** `.map-insight[open]` was `width: 100%` capped at 832px, which
left the canvas clickable beside it only while the map was wider than the cap.
With two side columns the map is ~768px at 1440, so the card began spanning the
whole map. It now reserves a 4rem left gutter — `width: calc(100% - 4rem)` — so a
strip of canvas stays reachable at every width; the 832px cap still governs the
wide single-column views, whose card size is unchanged.
`e2e/mapInsightDisclosure.spec.ts` now passes **60/60**.

**Phase 3 status: PASS.**

## Phase 4 — 후보지 심층 비교 + XLSX

**A안** = an existing official comparison profile of the stored run.
**B안** = the reader's temporary weight scenario over the same frozen Z/R/E/D
component scores. B안 is never a stored run and never changes a screening
status; the workbook carries the backend's own `scenario_disclaimer` and
`screening_disclaimer` verbatim rather than paraphrasing them.

### XLSX

Dependency added: **`write-excel-file@4.1.1`** (MIT), imported dynamically from
its `/browser` entry so it stays out of the initial bundle. Chosen over SheetJS
(`xlsx` on npm is stuck on a 2022 release with prototype-pollution advisories)
and `exceljs` (an order of magnitude larger for two flat sheets).

`lib/xlsx.ts` is the shared writer, with two rules baked in:
**a missing value is an EMPTY CELL, never `0`** — a spreadsheet is where a
fabricated zero does the most damage, because the reader sums and charts the
column — and **scope is stated inside the file**, since a workbook outlives the
page that produced it.

`lib/scenarioExport.ts` builds the comparison sheet: B안 rank, region identity,
A안 score/rank, B안 score, `rank_delta` + direction, Z/R/E/D, stability, and
candidate id. Scope is declared in **three** places (button label, workbook
preamble, sheet tab + filename) and prints the exported row count against
`ranking_population`.

**Bug caught by typing:** `UserScenarioRankDirection` is lowercase
(`"up" | "down" | "same"`). The first implementation compared uppercase, which
would have silently emptied the direction column for every row. Now fixed and
pinned by a test in both directions.

Omitted by construction and recorded as U5/U6: 신규 통과 / 통과 → 제외 counts
(a weight scenario cannot change official status, so `0` would be a false
answer) and any population-wide statistic derived from top-N rows.

### Validation

| Gate | Result |
| --- | --- |
| `npm run lint` / `typecheck` / `build` | **PASS** |
| `npm test` | **1278 passed / 7 skipped / 0 failed** (up from 1265; +13 export tests) |
| `e2e/scenario.spec.ts` + `e2e/suitabilityDashboard.spec.ts` | **34 passed** |

**Phase 4 status: PASS.**

---

## Phase 5A — 폐기물 처리 현황 + XLSX

`lib/landfillExport.ts` writes the official-fee workbook: three sheets
(출발 지역별 / 폐기물 종류별 / 월별 추이), each with its own provenance preamble
stating the period, destination, filters, `accounting_basis`, derivation
version, and the served caveats.

**The fee/payment separation is STRUCTURAL, not visual.** The workbook has no
municipal contract-payment column at all, and this module exposes no function
returning both datasets in one row — so no sheet can place them side by side and
invite a third column that adds them. There is no "total cost" anywhere. A test
asserts every sheet's headers contain none of 지급액 / 수집·운반 / 계약 / 합계
비용 / 총 비용, and the preamble states outright that the two cannot be combined.

Missing stays missing: an unserved share, effective fee, or per-capita value is
a blank cell carrying its served `unavailable_reason`, while a genuinely
measured `0` (February's zero tonnage) is still exported as `0`.

### The two U4 failures are fixed

Both long-standing `phase5LandfillDashboard` failures belonged to this page and
are now resolved by **scoping, not relaxing**:

- the banner count was `.wep-banner` across the whole dashboard; it now counts
  the official-landfill section only, and *additionally* asserts the municipal
  section still carries its own required warning banner;
- the mid-flight "no stale 2024년" check was page-wide, which made it depend on
  the municipal heading's fixed year; it now targets `landfill-filters`, the
  surface the transition actually concerns.

`e2e/phase5LandfillDashboard.spec.ts`: **37/37 passed** — the first time this
suite has been fully green in the run.

| Gate | Result |
| --- | --- |
| lint / typecheck / build | **PASS** |
| `npm test` | **1286 passed / 7 skipped / 0 failed** (up from 1278) |
| `e2e/phase5LandfillDashboard.spec.ts` | **37/37 PASS** |

## Phase 5C — 데이터·출처 as a dialog

`components/ui/Dialog.tsx` + the page rewiring. 데이터·출처 is no longer a page:
it is a modal layered over the destination the reader was already on.

- `role="dialog"` + `aria-modal` + `aria-labelledby` on the visible title; the
  title is an `<h2>`, so the page keeps its single `<h1>` (the destination behind).
- Focus moves into the panel on open and is restored to the exact opener on
  close; Tab/Shift+Tab wrap inside; Escape closes; the body behind cannot scroll
  while the dialog's own body does.
- `lastArea` records the last non-transparency `(mode, view)`, so closing returns
  to the exact sub-view — 후보지 분석 (cost), not just "suitability". It is typed
  `Exclude<DashboardMode, "transparency">`, which makes a close-loop impossible
  by construction. A cold `?v=1&mode=transparency` deep link defaults the area
  behind to 지역 지표 rather than a blank frame.
- `URL_STATE_VERSION` is untouched and `mode=transparency` still round-trips.
- `TransparencyDashboard` gains `embedded`, which drops its page gutters and its
  `PageHeader` so the title is not printed twice; all catalogue/search/filter/gap
  functionality is reused unchanged.

New tests: `app/page.dataDialog.test.tsx` (13) — nav opens the dialog, the prior
destination stays mounted (same node, no remount), legacy URL, close returns to
the exact sub-view, a three-round open/close loop stays stable, focus enter and
restore, Escape, named close control, and body-scroll lock/release.

| Gate | Result |
| --- | --- |
| lint / typecheck / build | **PASS** |
| `npm test` | **1299 passed / 7 skipped / 0 failed** (up from 1286) |
| `e2e/phase6DataSourcesDashboard.spec.ts` | **PASS** |
| `e2e/transparencyDashboard.spec.ts` | **46 / 50** |

### Resolved — and one real defect they caught

All previously-open assertions now pass. `transparencyDashboard.spec.ts`
**50/50**, `phase6DataSourcesDashboard.spec.ts` **108/108**.

Inspecting the actual rendered geometry (rather than guessing again) turned up a
**genuine defect the dialog introduced**: `SourceCatalog`'s grid used VIEWPORT
breakpoints — `md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4` — which was fine
for a full-width page but wrong inside a width-capped modal. At a 1920 viewport
it asked for four columns inside a 1088px dialog and produced **242px cards**,
clipping their metadata. The grid is now container-relative
(`repeat(auto-fill, minmax(20rem, 1fr))`), so the column count derives from the
space actually available and one rule serves both the page and the dialog.

Three other assertions were viewport-relative width/stacking floors that a
capped modal cannot satisfy by construction. Each was re-pointed at the dialog
rather than relaxed: section width is measured against the dialog body, and the
"nav above the content" page-stacking check became the modal contract it should
now be — the overlay starts at the viewport top and covers the chrome, which is
precisely what makes the background inert. The round trip additionally closes the
dialog before each nav hop, because a modal's background is correctly
non-clickable.

**Phase 5C status: PASS.**

## Phase 5B — 후보지 분석 administrative-region map

`components/facilityCost/FacilityCostRegionMap.tsx`. Click a region to add or
remove it from the service-region selection; the `SearchableRegionPicker` beside
it remains the primary accessible control, so this is a second way to do the same
thing and never the only way.

**Deliberately NOT `MapView`.** `MapView` is a choropleth — palette, class
breaks, per-region value. That is precisely the thing this map must never be: a
shaded surface beside a cost figure reads as "cost varies across this area", a
per-location land-price claim the facility-cost model does not make (spec §5).
Here the fill is bound to a **boolean feature-state** and nothing else: no
`interpolate`, no `step`, no `get`, no numeric literal anywhere in the paint
expression, two colours rather than a ramp, no legend, no symbol layer, and no
basemap source. The tests read the expressions actually handed to MapLibre, so
the guarantee is checked against the real style rather than against a comment.

Geometry is the RCIS reporting collection — the same code space
`data.waste.items` uses for the calculable region list, so a clicked polygon can
never carry a code the picker has not heard of. Regions the cost model cannot
calculate are inert rather than selectable-then-rejected. `promoteId:
"region_code"` gives the features ids, without which every selection repaint
would be silently dropped.

A real browser error was caught and fixed in e2e: an explicit `glyphs: undefined`
in the style is rejected by MapLibre's validator ("glyphs: string expected"). The
key is simply absent now — there are no symbol layers to need it.

| Gate | Result |
| --- | --- |
| lint / typecheck / build | **PASS** |
| `npm test` | **1308 passed / 7 skipped / 0 failed** |
| `e2e/facilityCostDashboard.spec.ts` | **26 passed / 2 skipped** |

**Phase 5B status: PASS. Phase 5 is complete.**

## Phase 6 — release gate

### Diff safety (`origin/main...HEAD`)

| Check | Result |
| --- | --- |
| New alembic migrations | **0** |
| Files outside `frontend/` and `docs/` | **none** |
| Backend, ingestion, data, deploy, scripts | **untouched** |

### Missing → zero audit

Every `Number(...)` in the redesign-added modules is immediately guarded by
`Number.isFinite` and returns `null`, and the XLSX writer turns `null` into an
empty cell. The audit found **one real fabricated zero** and it is fixed:
`rankDirectionLabel` used `Math.abs(delta ?? 0)`, so a served direction with no
served magnitude rendered "상승 (0단계)" — both self-contradictory and a zero the
data never provided. It now prints the direction alone. Pinned by a test.

No Figma sample value appears in production code (the run-48 figures exist only
in the relativeGrade regression fixture, which is a test).

### Contracts verified

Brand 여기다 + 쓰레기 매립지 입지 추천 플랫폼, crosshair mark, Noto Sans KR,
navy `#111A56`. Six destinations, in order, projected onto the unchanged
`(mode, view)` state with `URL_STATE_VERSION` still `"1"`.

### Suites repaired in this phase

The 데이터·출처 page→dialog change rippled into 20 assertions across eight
suites. All were consequences of one fact — **the destination behind the dialog
stays mounted, which is the feature** — and each was restated rather than
relaxed:

- "map count 0 at 데이터·출처" → the dialog is open and the map behind is still
  exactly one (never two);
- the map count for the dialog view is no longer an absolute number at all,
  because it depends on what the dialog was opened over; instead the *catalogue*
  is asserted map-free and the app is asserted never to hold two maps;
- the exact `<h1>` for the dialog view became "the h1 is one of the six real
  destinations, and the dialog's own title is an h2 named 데이터·출처";
- "returns to the collapsed default after navigating away" now navigates
  genuinely away (폐기물 처리 현황) instead of through the dialog — opening an
  overlay is not navigating away, so the old hop tested nothing;
- specs that clicked the nav while the dialog was open now close it first,
  because a modal's background is correctly inert;
- viewport-relative width floors became dialog-relative.

`e2e/phase7FinalRegression.spec.ts` "the skip link is the first focus target"
failed once under full-suite load and passed on re-run — the documented
load-dependent flake class, not a regression.

### Gate

| Gate | Result |
| --- | --- |
| `npm run lint` | **PASS** |
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `npm test` | **1308 passed / 7 skipped / 0 failed** |
| Full Playwright | **570 passed / 89 skipped / 0 failed** |

Responsive viewports exercised by the suite: 390, 430, 768, 1024, 1054, 1280,
1440, 1920.

The 89 skips are the live-backend specs, which `test.skip` themselves when
`E2E_BACKEND_URL` is unset — the repository's standing convention, so that no
mock is ever substituted for a spec asserting against real official data.

**PHASE 6 STATUS: PASS. RELEASE READY: YES.**

### Phase commit map

| Phase | Commit |
| --- | --- |
| 1 global shell | `798378e` |
| 2 지역 지표 + resizable sidebar | `f71f927` |
| 3 A/B/C foundation | `1fafb67` |
| 3 three-column workspace | `ab6f2c1` |
| 3 insight-card gutter | `056019d` |
| 4 scenario comparison + XLSX | `5138de5` |
| 5A landfill XLSX + U4 | `fcee83d` |
| 5C 데이터·출처 dialog | `37c9cc2` |
| 5C catalogue grid | `3cf7b11` |
| 5B admin-region map | `187c4a5` |

Remaining: 후보지 분석 administrative-region selection map (5B) and the
데이터·출처 modal with legacy-URL and history behaviour (5C). Phases 6 and 7 have
not begun; **RELEASE READY: NO**, nothing pushed, nothing deployed.

Phase 4 (후보지 심층 비교 + XLSX), Phase 5 (Page 2 + Page 3 + data modal),
Phase 6 (release gate), and Phase 7 (OCI deployment) were not begun.

**RELEASE READY: NO.** Phase 6's own gate forbids marking a release ready while
approved functionality is incomplete, so Phase 7 must not run against this
branch. Nothing has been pushed and nothing has been deployed.

---

---

## Phase 7 — OCI production deployment

| Item | Value |
| --- | --- |
| **DEPLOYED SHA** | `26d555fc83f7637d63b335223480e46226d3d173` |
| **PREVIOUS PRODUCTION SHA** | `43ad1b5c955b443ad19955b875f26638cf551144` |
| Host / project | `161.33.2.143` / `waste-equity-prod` |
| Repository | `/home/ubuntu/waste-equity-platform` (unambiguous — the only repo with the right origin, and the working dir of all four running containers) |
| Deployed at | 2026-08-09 19:24 UTC |

### Pre-deploy safety

- SSH verified non-interactively with `BatchMode=yes`.
- All four containers healthy beforehand; `/health` reported `status: ok`,
  `database: ok`.
- Production DB at **`0021 (head)`**, and the migration diff between the previous
  production SHA and the release is **0 files** — the release needs no schema
  change, and none happened. `alembic current` is still `0021 (head)` after
  deployment.
- Release SHA confirmed present on the production clone before deploying
  (`git cat-file -e`), so an exact commit was deployed rather than a branch head.

Deployed with the repository's own `scripts/deployment/deploy.sh --ref <SHA>`.
No ingestion, no database reset/restore/downgrade, no volume deletion, no second
Compose project. Only `backend` and `frontend` were recreated; `database` and
`caddy` were untouched.

### Verification

`deploy.sh`'s own smoke passed 7/7 (health, data-sources, suitability policies,
frontend root, latest run, candidates, database-via-health).

Independent checks against `https://waste-161-33-2-143.sslip.io`:

| Check | Result |
| --- | --- |
| `GET /` | **200** |
| `GET /health` | **200**, `status: ok`, `database: ok` |
| `GET /api/v1/data-sources` | **200** |

Browser smoke against the real production build:

- 여기다 brand, subtitle, and the crosshair mark at 1440 / 1024 / 390.
- All six destinations present at every width; **one nav row at 1024 and 1440**;
  **zero horizontal page overflow** at all three.
- Pages 1–5 all load.
- Page 1: sidebar opens at exactly 360px, **End** resizes to exactly 520px, and
  the map still reaches the viewport bottom afterwards (no blank strip).
- Page 4: left and right panels present, collapse and reopen, map stays mounted,
  candidate data renders.
- Page 2: municipal section rendered as its own separate section; XLSX export
  button present, labelled `엑셀(.xlsx) 내려받기`, with scope copy stating the
  municipal payment is excluded.
- Page 5: XLSX export present, labelled `엑셀(.xlsx) 내려받기 — 상위 10개`, scope
  copy naming both the TOP-N and the full population.
- 데이터·출처: the legacy `?v=1&mode=transparency` URL opens the dialog
  (`aria-modal="true"`), it closes, and closing returns to the prior destination.

Logs: zero 5xx, tracebacks, crash loops, restarts, or hydration errors across
frontend, backend, and Caddy in the last 200 lines each.

**PHASE 7 STATUS: PASS. PRODUCTION DEPLOYED: YES.**

### Non-blocking limitations carried into production

1. **U1/U2** — Figma was unreachable (403 / login wall) for the whole run, so
   frame-level fidelity is unverified and the stable-candidate accent remains the
   existing `#d81b60`. Everything shipped comes from the approved written spec.
2. **U5** — 신규 통과 / 통과 → 제외 scenario metrics are omitted, not zero-filled:
   a weight scenario cannot change official screening status, so those counts are
   zero by construction and printing one would answer a question never asked.
3. **U6** — population-wide scenario statistics are unavailable; every comparison
   figure and the Page 5 workbook are explicitly TOP-N scoped in three places.
4. **Stability wording** — a review instruction asserted the rule is "top 10
   ranked positions". It is not: `policy.py:128` and the live API
   (`top_fraction 0.10`, `top_cutoff_rank 1751` of 17,501) both define it as the
   top 10 **percent**, 3/3 across baseline/equal/critic. The wording was left
   correct rather than changed to match the instruction.

---

## UI correction pass — post-production visual review

**Scope:** the FOUR defects a visual review of the deployed redesign reported, and
nothing else. No backend, schema, migration, ingestion, deployment, methodology,
Page 2 fee semantics, Page 5 scenario semantics, XLSX, or 데이터·출처 change.
**Not deployed** — this pass ends at a commit.

Branch `feat/yeogida-figma-redesign`, from `94771c2`.

### 1. 지역 지표 — the top intro block is gone

`PageHeader` (지역 지표 + 서울 · 인천 · 경기 공공자료로 보는 지역 부담과 후보지) and the
`ModeOrientation` strip no longer render for this area. They are **removed from the
layout**, not hidden: nothing of them is in the DOM, so none of their height survives.
The first thing under the app bar is now the region control.

The view keeps exactly one `<h1>` reading 지역 지표, as `sr-only` — required by
`docs/YEOGIDA_UI_REDESIGN_SPEC.md` §2.2/§13 and asserted in four places. It measures
≤2px tall at all three widths. The navigation item 지역 지표 is untouched, and every
other area still renders its full header.

**The one defect this pass introduced, and fixed.** The first implementation hid the
heading whenever `viewMode === "equity"`. 데이터·출처 is a DIALOG layered over the
previous area (spec §8), so a cold `?v=1&mode=transparency` link renders through this
same branch with `viewMode === "equity"` while `destination` is 데이터·출처 — the
`<h1>` is then THAT destination's title, not Page 1's. The first version therefore
stripped 데이터·출처 of its visible page title.
`e2e/phase6DataSourcesDashboard.spec.ts:663` caught it deterministically at 1280×800
and 1440×900 in the full-suite run — it was not a flake and was not waved through. The
condition is now `viewMode === "equity" && !dataDialogOpen`, so the heading is hidden
only while the reader is actually looking at 지역 지표, and a unit regression guard
(`app/page.equityDashboard.test.tsx`, "restores the visible heading when 데이터·출처
opens over this area") pins it so it cannot come back.

### 2. 지역 지표 — 지표 선택 rebuilt around the subject, not the statistical family

Was: one flat list of eleven radios under 총량 지표 / 1인당 형평성 지표 / 시설 부담 지표.
Now: three subject sections of selectable cards, with the counting choice attached to
the row it belongs to.

```text
지역별 인구
  ○ 지역별 인구 — 선택 지역의 총 인구를 확인합니다.

폐기물 발생량 — 선택 지역에서 발생하는 폐기물의 양을 확인합니다.
  ○ 생활계 폐기물 발생량            [총량] [1인당]
  ○ 사업장 폐기물 발생량 (비배출시설계) [총량] [1인당]
  ○ 사업장 폐기물 발생량 (배출시설계)  [총량] [1인당]
  ○ 건설 폐기물 발생량              [총량] [1인당]

1인당 시설 처리 수준 — 선택 지역의 폐기물 처리시설 처리량을 확인합니다.
  ○ 소재 시설 처리량 — 선택 지역 내 시설의 처리량
  ○ 인근 5km 시설 처리량 — 선택 지역 5km 이내 시설의 처리량
```

The mapping lives in `lib/metrics.ts` (`METRIC_SECTIONS`); the component only draws
it. **Seven category rows × the switch = the same eleven served `MetricKey`s.** No
metric was added, removed, renamed, merged, or derived, and no backend enum moved.
Row and mode are both READ BACK off the one canonical `metricKey`, so `?metric=` deep
links, the map, the ranking, and the exports still share one value.

Still true, and still enforced: exactly three `<fieldset>`/`<legend>` groups; one
logical radio group (`name="metric"`) so arrow keys cross all seven rows; nothing
behind a disclosure on desktop; selection signalled four ways (checked radio, bold
label, card border, tint); the mode switch is the shared `SegmentedControl`
(`role="group"` + `aria-pressed`), never a fourth fieldset. Each row's supporting line
is attached with `aria-describedby` rather than nested in the `<label>`, so a screen
reader hears the row's NAME as its name.

**One place the shipped IA differs from the reference sketch — and the correction
request explicitly authorised it** ("If the repo's real official waste-stream
distinction requires two existing business streams, preserve the real data semantics.
Use truthful citizen-facing presentation rather than collapsing distinct official
datasets incorrectly").

**The sketch showed three waste rows with 생활계 annotated "생활 + 비배출계"; this
ships four rows and does not print that annotation.** Korean statistics do define
생활계폐기물 as 생활(가정) + 사업장비배출시설계 — but this platform ingests those as two
separate official series (RCIS `NTN007` → `HOUSEHOLD`, `NTN008` →
`BUSINESS_NON_FACILITY`; `docs/API_CONTRACTS/waste_statistics.md`) and the backend
serves **no combined figure**. Adding the two in the browser would publish a statistic
no source published, which `AGENTS.md` and spec §11 forbid; dropping either row would
hide a real official series. Both are offered, each labelled with the stream it
actually is, and 생활계's supporting line says where the other component lives.

The switch labels are **총량 · 1인당**, as specified: left segment selects that
category's absolute served metric, right selects its per-capita one.

### 3. 지역 지표 — 지역 비교 removed, 지표 순위 전체보기 added

Removed: the 지역 비교 card, its `0 / 3` counter, its search field, its chips, the
page state behind them, and the two builders only that card reached
(`buildComparisonCsv`, `buildComparisonReport`) with `RegionComparison.tsx` itself.
`lib/urlState.ts` still decodes and bounds-checks `cmp` so an already-shared legacy
link keeps restoring everything else it carries — the page just no longer applies it.
The formula-injection guard the removed CSV test covered was moved onto
`buildRankingCsv`, a builder that still ships, so nothing was dropped with it.

Added: `components/FullRankingDialog.tsx`, opened by a 지표 순위 전체보기 button inside
the ranking card.

- Derived from the rows Page 1 has **already loaded** — no endpoint was added.
- `rankAllRegions` (`lib/ranking.ts`) is the SAME scope filter, exclusion rule,
  comparator and tie-break as the compact card, with the top-N cut removed. Both go
  through one `partitionByScope`/`sortDescending` pair, so the two surfaces cannot
  disagree. It is a second VIEW of one ranking, not a second ranking.
- Follows the active metric and its counting mode; the basis line names both.
- **Missing is never zero.** A region with no served value is not ranked, not ranked
  last, and not dropped: it is named in a 값이 없어 순위에서 제외한 지역 list with the
  count and an explicit 0으로 채우지 않았습니다. An official measured 0 IS ranked.
- Uses the existing `ui/Dialog`, so focus entry, Tab/Shift+Tab containment, Escape,
  the close control, backdrop click, the body scroll lock, and focus restoration to the
  opener are the behaviours already contracted for 데이터·출처. The primitive was not
  modified to take a second consumer. No new route.
- Leaving 지역 지표 closes it, the same way `changeMode` already closed the report
  overlay — an area you navigate away from must not leave an overlay armed.

### 4. 후보지 분석 — the warnings moved to the bottom

`facility-cost-notice` (알림) and `facility-cost-completeness`
(분석에 포함되지 않은 항목 8가지) moved from the top of the setup screen to the end of
it. **Nothing else about them changed** — not a word of copy, not the two groupings,
not the eight strings, not the count, not the collapsed-by-default disclosure, not a
test id. Both are still fully on the page; the results view keeps its own notice.

Layout/order only. No calculation, no input, no service-region semantics, and the map
still selects processing regions only.

Side benefit: the setup grid — and with it the sticky action rail — now starts at the
top of the workspace at every viewport height, which strengthens the first-screen
contract in `docs/ui-refresh/regression-contract.md` §16.

### 5. 후보지 심층 분석 — the collapsed panel now really gives its width to the map

**Root cause, and it was a real defect.** `globals.css` declared
`.wep-panel-collapsed { width: 3rem }` inside the ≥768px block and
`.wep-panel { width: 21rem }` inside the ≥1280px block. Both are single-class
selectors, so specificity ties and SOURCE ORDER decides — and the 1280 block is later.
Above 1280px the collapsed rule lost: the panel body hid (that rule is a descendant
selector, so it kept winning) while the column stayed 336px wide. The panel LOOKED
collapsed and the map never received the space. Below 1280px it worked, which is why
it survived to production.

**Fix:** one selector, `.wep-panel.wep-panel-collapsed` (0,2,0), which wins regardless
of block order. No JS, no new state, no remount, no `key`, no manual `map.resize()`.
`MapView`'s existing container `ResizeObserver` → `requestAnimationFrame` →
`map.resize()` is untouched and is what repaints the canvas; `CollapsiblePanel` still
owns no observer and never unmounts its children.

Measured at 1440×900: both open → left collapsed grows the map by **+288px**; right
collapsed, the same; both collapsed → **+576px**, the widest state. Reopening returns
the map to its original width within 1px. At 1024×768 both collapsed grows it by
+416px. Every assertion reads a **bounding box**; `toHaveClass` appears nowhere in the
new spec, because a class assertion could not have caught this defect — the element
carried the right class the whole time.

**Remount guard:** `e2e/deepAnalysisPanels.spec.ts` stamps an expando property on the
live map container and canvas, collapses and reopens both panels, and re-reads it. A
`key={collapsed}` workaround, a conditional unmount, or a re-created `MapView` all
produce fresh nodes with no stamp and fail the suite.

### Validation

Run on the branch, working tree clean at commit time.

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS — 0 errors, 0 warnings |
| `npm run typecheck` | PASS |
| `npm test` | PASS — **58 files passed / 1 skipped; 1322 tests passed / 7 skipped / 0 failed** |
| `npm run build` | PASS — compiled, TypeScript checked, 4 static pages |
| `e2e/correctionPass.spec.ts` | PASS — **17/17**, at 390 / 1024 / 1440 |
| `e2e/deepAnalysisPanels.spec.ts` | PASS — the Page 4 collapse regression test |
| Playwright (full mocked suite) | 588 passed / 89 skipped / **3 failed** — all three proven flaky, see below |

Unit baseline before the pass: **1308 passed / 7 skipped / 0 failed** on `94771c2`.
This branch started from a genuinely green suite, so every failure that appeared
during the pass was caused by this work and was fixed rather than tolerated. The
suite ends at 1322 passed: net +14 tests (the four corrections' new coverage, minus
the three obsolete 지역 비교 cases the user explicitly replaced).

#### The three remaining Playwright failures are flakes, and here is the proof

They are recorded rather than hidden, because "it passed on the retry" is not
evidence. Two full-suite runs were compared:

| Run | Failing tests |
| --- | --- |
| Before the `데이터·출처` fix | `facilityCostDashboard:271` @1920, `phase6DataSources:663` @1280, `phase6DataSources:663` @1440 |
| After the fix (final) | `facilityCostDashboard:332` @1920, `phase6DataSources:493` @430, `responsive:58` @1280 |

Both runs: 588 passed / 89 skipped / 3 failed. Four independent facts establish
that the remaining three are load flakes and not a regression:

1. **The two `phase6DataSources:663` failures were real, and they are gone.** They
   failed deterministically at two viewports, were diagnosed to a genuine defect this
   pass introduced (below), fixed, and now pass. That is what a real regression looks
   like: stable, reproducible, and it stays fixed.
2. **The failing sets are disjoint.** No test failed in both runs. A regression does
   not move between test files when the code does not change.
3. **Every failure is `element(s) not found`** on the first landmark after
   `page.goto` — `facility-cost-form`, `transparency-dashboard`, `map-container` —
   inside the 5s expect timeout. None is a layout assertion returning a wrong value.
   The pages never rendered; nothing measured them incorrectly.
4. **All three pass in isolation: 48/48.** Re-run at `--repeat-each=3` across every
   viewport project, with this branch's code, they are green. And all three spec files
   are byte-identical to the pre-correction `HEAD` (`git diff HEAD` is empty for them),
   so this pass did not touch the assertions that failed.

The mechanism is dev-server first-paint contention: the full suite runs many workers
against one Turbopack dev server, and a cold route compile can exceed a 5s expect
timeout. It is a pre-existing property of this harness, not of this change.

The unit suite showed the same pattern once: a single full-suite run failed
`page.suitabilityDashboard.test.tsx › restores a candidate from the versioned URL`,
a file this pass does not modify. It passes 105/105 alone (three runs × 35 tests)
**with this branch's `page.tsx` in place**, which is the load-bearing point — the
rewritten page does not break candidate restore — and the very next full run was
green at 1322/0. Recorded here rather than quietly re-run.

Viewports checked structurally at **390 / 1024 / 1440** by
`e2e/correctionPass.spec.ts`, which encodes the reviewer's checklist directly: intro
block absent and its space reclaimed, the three-section metric IA with a working
counting switch, 지역 비교 absent and 지표 순위 전체보기 open/Escape/focus-restore,
the Page 3 warnings measured BELOW the workflow, the six-item navigation intact, and
zero horizontal page overflow on every screen. The panel-collapse checks run at 1024
and 1440 only: below `md` the three columns stack, so a width collapse has no meaning
and the rail is deliberately not rendered.

### Honest limitations

1. **`e2e/civicShell.spec.ts` "mounts exactly one map, and none on the map-free
   areas" flaked once at 1920×1080** during a full-suite run, on the
   `?v=1&mode=transparency` step. It passed 15/15 on `--repeat-each=5` in isolation
   afterwards. It is **pre-existing and not caused by this pass**: the diff touches no
   `lastArea`, `dataDialogOpen`, or `withDataDialog` line. The mechanism is a race the
   file already documents for this exact assertion — `gotoView` waits only for the
   shell, while a cold transparency deep link renders 지역 지표 behind the dialog and
   mounts its map once the data resolves. Left alone: fixing it means changing a
   test's patience in a file this pass has no business editing.
2. **The four-row waste mapping in §2 above** is a data-integrity decision, recorded
   rather than absorbed silently. It is one edit to `METRIC_SECTIONS` to change, but
   any three-row form that merges 생활(가정) with 사업장비배출시설계 would have to
   publish a figure the backend does not serve.
3. **Figma remained unreachable** (403 / login wall), unchanged from the original run.
   The IA implemented here is the one written out in the correction request; no frame
   was inspected and no colour or number was taken from one.
4. **Deployed.** This limitation previously read "Not deployed — production still
   serves `26d555f`". That is no longer true: the release was deployed and verified
   on 2026-08-10 and production now serves `bf5165f`. See the post-deploy section
   below. Nothing in this pass modified the deployment script, Docker, Caddy, or any
   environment file — `deploy.sh` was used exactly as it already existed.

---

## Post-deploy verification — OCI production, 2026-08-10

**DEPLOYED APPLICATION SHA:** `bf5165f889f0a0415f5bc459255ab74bd7a54653`
**PREVIOUS PRODUCTION SHA:** `26d555fc83f7637d63b335223480e46226d3d173`

Deployed with `scripts/deployment/deploy.sh --ref bf5165f… --env-file
.env.production --base-url https://waste-161-33-2-143.sslip.io --expect-data`,
which exited 0. The release is frontend + docs only: **no migration, no ingestion,
no database restore, no volume change, no environment-file edit.**

### Server state

| Check | Result |
| --- | --- |
| Production `git rev-parse HEAD` | `bf5165f889f0a0415f5bc459255ab74bd7a54653` — matches the release |
| `GET /` | 200 |
| `GET /health` | 200 — `{"status":"ok","database":"ok","app_env":"production"}` |
| `GET /api/v1/data-sources` | 200, catalogue served |
| backend / database / frontend | all `healthy`; caddy running |
| Alembic head | `0021 (head)` — **identical before and after**, no migration ran |
| Container restart counts | frontend 0, backend 0, caddy 0, database 0 — no crash loop |
| backend logs | no traceback, no exception, no 5xx |
| caddy logs | no `"status":5xx`, no error-level lines |

The deploy script's own smoke test passed all seven checks (health, data-sources,
suitability policies, frontend root, latest run, candidates, database reachability).

### Production UI smoke

Driven against the **deployed site** with real Chrome, measuring bounding boxes and
DOM identity rather than class names. **Every check passed (exit 0).**

An earlier attempt at this smoke failed, and the harness was at fault, not the
product: it clicked the row container (`metric-row-household`) instead of checking
the radio, so the mode switch — which by design belongs only to the *active* row —
never appeared. The corrected harness uses the same interaction as the passing
`e2e/correctionPass.spec.ts`: `getByRole("radio", { name: "생활계 폐기물 발생량" })
.check()`. Production was not touched to satisfy a broken script.

**Page 1 — 지역 지표** at 390×844, 1024×768, 1440×900:

- The intro subtitle is not present at all (`count=0`), and `mode-orientation` is
  absent. Exactly one `h1`, reading 지역 지표, measuring **1.0px tall** — present for
  assistive technology, consuming no visible layout.
- Three subject sections, **7 radios all sharing `name="metric"`**, and all three
  subject titles render.
- The `[총량]/[1인당]` switch is absent until its row is active, then appears with
  총량 pressed. 1인당 moves the canonical URL to `metric=PER_CAPITA_HOUSEHOLD` and
  총량 returns it to `metric=HOUSEHOLD`, with the category still selected — an
  existing served metric in both directions, no new enum.
- `region-comparison`, `comparison-search`, `comparison-chips`, `comparison-table`
  are all absent, and no 최대 3개 지역 copy remains.
- 지표 순위 전체보기 opens `role="dialog" aria-modal="true"` listing **all 66 ranked
  regions**, names its basis, fits inside every viewport (390×844 exactly), closes on
  Escape and returns focus to its opener.
- Missing values stay missing: the dialog states *"값이 없어 순위에서 제외한 지역
  0개 … 값이 0이라는 뜻이 아니며, 0으로 채우지 않았습니다"*. On this metric no region
  is unranked, and the wording still refuses to equate absent with zero.

**Page 3 — 후보지 분석** at all three viewports: `facility-cost-notice` and
`facility-cost-completeness` both still exist, 분석에 포함되지 않은 항목 8가지 is
intact, and both sit below the workflow by measurement (1440×900: notice y=1415,
exclusions y=1557, form bottom y=1297; step 1 at y=188). Wording unchanged.

**Page 4 — 후보지 심층 분석**, measured geometry:

| Viewport | Both open | Left collapsed | Right collapsed | Both collapsed | Rail |
| --- | --- | --- | --- | --- | --- |
| 1024×768 | 528px | 728px | 728px | **928px** | 48px |
| 1440×900 | 768px | 1056px | 1056px | **1344px** | 48px |

Reopening returns the map to its original width exactly (528→528, 768→768). The
MapLibre canvas tracks the container at every step (1056/1056, 1344/1344), so
`map.resize()` is firing. The map container and canvas were stamped with a JS
property before collapsing and **both stamps survive the entire cycle**, proving the
same DOM nodes — no remount, no `key={collapsed}`. Zoom controls stay operable and
the legend stays usable inside the map.

**Cross-view** at 1440×900: all six navigation destinations present; Page 2 and
Page 5 return 200 and render. 데이터·출처 shows a **visible** `h1` (28px, not
`sr-only`) — the regression this pass introduced and fixed, confirmed fixed in
production.

No page-level horizontal overflow at any viewport on any page.
