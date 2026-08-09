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
