# Final UI integration and regression

The last pre-deployment UI milestone. It ships **no new product surface**: it
verifies the six refreshed civic-dashboard areas as one application, repairs the one
confirmed layout defect they were carrying, and makes the assertion that was supposed
to catch that defect deterministic.

Branch `fix/final-ui-integration-regression`, cut from `main` at `98372d7`.

---

## 1. Starting repository state

```text
local main   98372d7eeca7ef99d10e40bdbb3cd078cb66746d
origin/main  98372d7eeca7ef99d10e40bdbb3cd078cb66746d
```

`git pull --ff-only origin main` reported *Already up to date*. The working tree was
clean except for one untracked file, `docs/SUITABILITY_SITE_CLUSTERS_SPEC.md`, which
belongs to unrelated work and was **not** added, edited, moved, staged, or committed.

All six milestone merges were verified present in **both** local `main` and
`origin/main` (`git merge-base --is-ancestor`, all YES/YES):

| Commit | Milestone |
| --- | --- |
| `a7ce49e` | shared civic-dashboard foundation |
| `8c16759` | 지역 부담 refresh |
| `68eb2d3` | 후보지 분석 refresh |
| `db96118` | 비용 살펴보기 refresh |
| `28bdb6a` | 매립지 현황 refresh |
| `98372d7` | 데이터·출처 refresh |

No deployment work was present on the branch point, and none was performed. OCI still
runs the land-cover release; the UI refresh has never been shipped there.

## 2. Scope

**In:** the confirmed facility-cost 1024×768 repair, the deterministic viewport test,
cross-view integration verification of all six areas, the deferred
`DerivedPanel` / `SourcePanel` compatibility review, one integration Playwright spec,
and this documentation.

**Out, and untouched:** analytical calculations, cost formulas, scoring logic,
landfill calculations, source-registry records, datasets, API endpoints and payloads,
backend, database, migrations, ingestion, Docker, Caddy, OCI deployment, and
production data. The diff contains three source/test files and three documents.

---

## 3. The confirmed facility-cost defect

### What was measured

At **1024×768**, on the as-loaded 비용 살펴보기 setup screen with
`window.scrollY === 0`:

| Element | Geometry | Verdict |
| --- | --- | --- |
| 현재 설정 card | 464 → 879 | 111px past the fold |
| 계산 준비 상태 checklist | 702 → 778 | clipped |
| **비용 계산하기** | **794 → 838** | **70px clipped** |
| `facility-cost-calculate-status` | 846 → 862 | entirely below the fold |

The failure is real and reproducible, not a flake. It reproduced on unmodified `main`
at `28bdb6a` and again at `98372d7`, with the same file, the same assertion, and the
same 838-against-768 measurement. It had been recorded as a suspected flake in
`landfill-dashboard.md` §10 and `transparency-dashboard.md` §11.

The three larger targets *looked* fine and were not: they measured **752 → 796**,
i.e. 4px inside an 800px viewport, with their status line at 804 → 820 already below
the fold. Nothing measured the status line, so nothing failed.

### Root cause

**`position: sticky` cannot pull an element above its static position.**

`FacilityCostSetup` rendered `FacilityCostNotice` — the `알림` scope banner plus the
분석에 포함되지 않은 항목 8가지 disclosure — full-width **above** the two-column grid.
At 1024 that block consumed 250px (banner 214 → 386, disclosure 398 → 444, plus
margins), so the grid began at y = 464, and with it the
`lg:sticky lg:top-6 lg:self-start` summary rail. The rail's card is 415px tall
→ 879.

Sticky only engages once the element's static position has scrolled above `top: 24px`.
Before any scrolling the rail is ordinary flow content, so it contributed nothing to
the first screen — which is precisely the state the first-screen contract is about.
The rail helped only *after* the citizen had already scrolled, i.e. exactly when it
was no longer needed.

### The repair

`FacilityCostNotice` moved from above the grid into the grid's **workflow column**, as
its first block; the grid's now-redundant `mt-5` was removed. One JSX move in
`frontend/src/components/FacilityCostDashboard.tsx`.

This was chosen over the alternatives on evidence, not preference:

* there is no duplicated explanation on this screen to delete — the notice's three
  paragraphs and its eight non-claims are each stated once, and the 현재 설정 rows and
  the 계산 준비 상태 rows answer different questions (*what is set* vs *what is still
  missing*), both contracted by existing tests;
* spacing alone could not recover 111px from a 415px card without deleting content;
* moving 계산 준비 상태 below the button would have freed enough room but breaks the
  required setup sequence and pushes the readiness context off the first screen.

The notice's content, wording, prominence order (still the first block under the
`<h1>`, still above `1. 처리할 지역`), and test ids are unchanged. So is the setup
sequence:

```text
처리할 지역 → 처리 조건 → 계산 가정 → 현재 설정·계산 준비 상태 → 비용 계산하기
```

No validation rule, default value, payload, request, or calculation changed.

### Before and after at 1024×768

| Element | Before | After | Δ |
| --- | --- | --- | --- |
| 현재 설정 card | 464 → 879 | 214 → 629 | −250 |
| 계산 준비 상태 | 702 → 778 | 452 → 528 | −250 |
| **비용 계산하기** | **794 → 838** | **544 → 588** | **−250** |
| status line | 846 → 862 | 596 → 612 | −250 |
| margin to the 768px fold | **−70px** | **+180px** | |

Because the rail now starts at the top of the workspace, the geometry is **identical
at all four desktop targets** — 544 → 588 at 1024×768, 1280×800, 1440×900, and
1920×1080. Sub-`lg` widths are unchanged in behaviour: the columns still stack and the
summary is still ordinary flow content reached by scrolling (768×1024: 1579 → 1623;
390×844: 2077 → 2121; both were 1587 → 1631 and 2085 → 2129 before, a −8px shift from
the removed margin).

None of the prohibited techniques were used: no zoom, no transform, no negative
margin, no width-conditional hiding, no nested scrolling, no viewport-fixed button, no
reduction of the 44px target, and no weakening of the contract to
"reachable by scrolling".

---

## 4. The deterministic test repair

The assertion in `frontend/e2e/facilityCostDashboard.spec.ts` was also
nondeterministic. It returned to the top of the page with:

```js
await page.mouse.wheel(0, -2000);
```

A wheel event is dispatched, not awaited. The bounding box could therefore be read
while the scroll was still settling, and **against a partly-scrolled page a clipped
button measures as if it fitted**. That is why a genuine, permanent 70px clip
survived several green full-suite runs, including the post-merge run recorded at the
end of the 데이터·출처 milestone. A lucky pass was never evidence of anything.

Two helpers replace it:

```js
async function scrollToTop(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}
```

and `expectActionOnFirstScreen(page, viewportHeight)`, which asserts:

| Assertion | Why |
| --- | --- |
| `window.scrollY === 0` | measured at the top, provably |
| button `top >= 0` | not clipped above |
| button `bottom <= viewportHeight` | not clipped by the fold |
| button `height >= 44` | the accessibility target size is a floor, not something to shrink to fit |
| `elementFromPoint(centre)` is the button | not overlapped by a sticky element, overlay, or neighbouring card |
| 계산 준비 상태 `toBeInViewport()` | readiness context on the same screen |
| `facility-cost-calculate-status` `toBeInViewport()` | *why* the action is disabled, on the same screen |
| `scrollWidth <= clientWidth + 1` | no page-level horizontal overflow |

It runs **twice** per viewport: once on the as-loaded page, and again after scrolling
through all three setup steps and returning — so the rail is proved not to be a
one-shot initial-paint effect.

### Proof the new assertion catches the defect

With only the layout fix stashed and the new test in place:

```text
1024×768  Error: calculate button is not clipped by the fold
          expect(received).toBeLessThanOrEqual(expected)
          Received: 838

1280×800  Error: expect(locator).toBeInViewport() failed
          Received: viewport ratio 0
          → facility-cost-calculate-status
```

The 1280×800 failure is new information: that viewport had been passing while its
readiness explanation sat below the fold, because the old assertion never looked.

### Repeat run

```bash
npx playwright test e2e/facilityCostDashboard.spec.ts --repeat-each=10
260 passed (3.8m)
```

26 tests × 10 repetitions, zero failures, zero retries, nothing skipped, nothing
marked flaky.

---

## 5. Cross-view map contract

Verified in every view at 1024×768, 1280×800, 1440×900, 1920×1080, 768×1024, and
390×844, and again after each navigation:

| View | Maps | Result |
| --- | --- | --- |
| 지역 부담 | 1 | pass |
| 후보지 점수 | 1 | pass |
| 가중치 바꿔보기 | 1 | pass |
| 비용 살펴보기 | 0 | pass |
| 매립지 현황 | 0 | pass |
| 데이터·출처 | 0 | pass |

`map-container` is absent from the DOM in the map-free views, never hidden with CSS,
and never retained after navigating away from a map view.

## 6. Navigation, heading, and terminology contract

Asserted in all six views, at all six viewports:

* exactly one `top-navigation`, one `mode-switch`, one `#main-content`, one `<h1>`;
* the four primary labels present and compared **exactly** —
  `지역 부담`, `후보지 분석`, `매립지 현황`, `데이터·출처`;
* the active area's nav button carries `aria-pressed="true"`;
* the sub-view selector renders in the three 후보지 분석 sub-views and **only** there,
  exactly once, with the active sub-view `aria-pressed="true"`;
* the sub-view labels stay 후보지 점수 / 가중치 바꿔보기 / 비용 살펴보기.

Exact `<h1>` per view:

| View | `<h1>` |
| --- | --- |
| 지역 부담 | `지역 부담` |
| 후보지 점수 · 가중치 바꿔보기 | `후보지 분석` |
| 비용 살펴보기 | `시설 비용 살펴보기` |
| 매립지 현황 | `수도권매립지 반입 현황` |
| 데이터·출처 | `데이터와 출처` |

No additional HTML navigation landmark was introduced. `TopNavigation` remains a
labelled `role="group"` and stays the source of truth (regression-contract §1, §8).

### The 데이터·출처 distinction

```text
page <h1>          데이터와 출처
navigation label   데이터·출처
```

These are deliberately different strings and both are asserted on the same screen.
The spec additionally asserts that **no heading anywhere** renders the nav label
exactly, so the two can never be quietly unified.

### Terminology-scan discipline

Any forbidden-token scan in this repository must collect per-element text nodes and
join them **with a separator**. Reading a subtree's `textContent` concatenates Korean
labels across element boundaries into words that were never rendered — `수집 시점`
followed by `수집 기록 없음` produces a phantom `점수`. The missing-data assertion in
the new spec does this explicitly. This is a scanning-method fix, not a relaxation:
a genuine technical-token leak still fails.

## 7. URL restoration and staleness

Every documented deep link restores its view, its nav `aria-pressed`, and its sub-view
`aria-pressed`:

```text
/?v=1&mode=equity
/?v=1&mode=suitability&view=score
/?v=1&mode=suitability&view=scenario
/?v=1&mode=suitability&view=cost
/?v=1&mode=flow
/?v=1&mode=transparency
```

Also verified: the three sub-views round-trip in the order
cost → score → scenario → cost → scenario → score with one selector, one `h1`, and the
correct map count at every step; a full equity → cost → transparency → equity tour
leaves no trace of the previous view; and browser **back**/**forward** across two real
document navigations restore the complete view contract on both sides.

In-app mode changes mirror state with `history.replaceState` and therefore add no
history entries — that is the existing documented contract (§3), not a regression, and
the test is written against it rather than around it.

### Staleness

`VIEW_OWNED_TESTIDS` maps each view to the surfaces it owns; every other view asserts
their **absence** (count 0, not hidden). Additionally, a curated `SINGLETON_TESTIDS`
list — shell chrome, the one map, and each area's owned top-level surfaces — is
asserted to appear at most once in the live document in every view and after every
navigation. That single assertion covers no duplicate map, no duplicate cost form, no
duplicate source catalog, no duplicate navigation, no duplicated sub-view selector,
and no stale panel left mounted underneath a new view.

It is deliberately a curated list rather than "no `data-testid` repeats". The first
draft used the blanket rule and it reported `score-class-row×5`,
`land-cover-legend-row×3`, and `facility-cost-facility-type-card×2` — all legitimate
repeated rows. A blanket rule would have made list rendering look like a defect.

## 8. Data-integrity checks

No missing value is rendered as `0`, `0.0`, `0원`, `0톤`, `-`, or `N/A` anywhere the
integration sweep touched.

The representative missing-data fixture is the 수도권매립지 **404
`NO_DATA_AVAILABLE`** path that `e2e/mockBackend.ts` reproduces from the real backend.
It is the right fixture precisely because it carries no `evidence` object, so nothing
synthetic is labelled official. On that screen the spec asserts:

* the empty state is visible and is **not** `role="alert"` — an unavailable official
  record is an answer, not an error;
* `landfill-kpis` and `landfill-kpi-quantity` are **absent** — no headline number was
  invented to fill the layout;
* none of `0 t`, `0톤`, `0원`, `0 원`, `0.0` appears anywhere in `#main-content`.

The existing `DataStatusBadge` semantics (reported / derived / caveat / missing /
excluded), the official-zero rules, provenance and reference periods, export
behaviour, and `lib/dataSources.ts` as the single source-registry interpreter are all
unchanged — no component under `components/transparency/` gained a second registry or
reinterpreted a raw `source_id`.

### Known transparency risks, verified and left as-is

These were inherited from the 데이터·출처 milestone. Each was re-verified as still
true and is **not** broadened into backend work here:

* four dataset-summary rows and their coverage strings remain frontend copy;
* row-level attribution reads the first served item;
* the known-gap count is derived from the existing summary;
* `.wep-badge` keeps `white-space: nowrap`, which is why the per-capita table cell
  states its reason as neutral text rather than as a badge;
* the exact-value dataset table keeps bounded horizontal scrolling, and it is the only
  horizontal scroll on that page.

## 9. `DerivedPanel` / `SourcePanel` review

Both are defined in `frontend/src/app/page.tsx` and consumed once, inside the equity
sidebar's `출처와 계산 방법` `CollapsibleSection`. The five previous milestones each
deferred them.

**The material fact the deferrals missed:** `.mobile-collapsible` **force-opens its
body at md+** (`globals.css`, "desktop must never hide an analytical option behind a
toggle"). These panels are therefore *always visible* on every desktop 지역 부담
screen — not tucked behind a disclosure.

Measured against the seven review criteria, with the refreshed sidebar rendered:

| Criterion | Finding |
| --- | --- |
| Conflicts with refreshed tokens | **`DerivedPanel`: yes.** `bg-amber-50` + `border-amber-300` (`#fffbeb` / `#fcd34d`) rendered permanently between white `wep-card` surfaces. |
| | **`SourcePanel`: no.** `slate-50` / `slate-200` resolve to `#f8fafc` / `#e2e8f0` — the same value as `--color-surface-muted`, and within 1/255 of `--color-hairline` (`#e3e8f0`). |
| Duplicate headings or landmarks | No. `파생 지표` and `지표 출처` are unique; one `<h1>` on the page; each `<section aria-label>` has a distinct name. |
| Raw technical terminology | Present but pre-existing and unchanged — `산출 가정 (assumptions)`, `산출 버전 …-v1`, `출처: … (sgis)`. The terminology audit passes. Not a refresh-integration defect; see risks. |
| Horizontal overflow | None. Both measure `scrollWidth === clientWidth` (283/283) inside the 383px sidebar; page overflow is 0 at 1024, 1440, and 390. |
| Inconsistent missing-data styling | No zero-filling or placeholder values in either. |
| Disclosure semantics | Accessible; the nested `산출 가정` `<details>` holds no live region. |
| Duplicates a refreshed view | Partially — the *derived-ness* fact is now also stated by `DataStatusBadge status="derived"` on `selected-region-summary`, in the neutral derived styling. |

**Decision.** One confirmed integration defect, one smallest presentational fix.

Amber is this system's caveat tone (`InfoBanner tone="warning"`, `--color-warn`), and
three sections of the regression contract (§6, §16, §18) state that neutral provenance
must not be amber-by-default. `파생 지표` is neutral provenance — and the same screen
already says so neutrally. Two contradictory visual languages for one semantic, with
the louder one attached to the lesser surface.

`DerivedPanel`'s container moved to `rounded-card border border-hairline
bg-surface-muted text-ink-muted`, and its sub-caption to `text-ink-subtle`. The
metric's own `caveat` — the one thing in the panel that genuinely *is* a caution about
a value that exists — keeps the warn role, now as the `text-warn` token instead of a
raw `text-amber-800` utility. Verified after the change: background `rgb(248,250,252)`,
border `rgb(227,232,240)`, text `rgb(77,84,102)`, identical to `SourcePanel`.

**Nothing else changed** — no formula, no source list, no value, no method
description, no wording, no export behaviour, no map behaviour, no test id, no
structure. `SourcePanel` was left entirely unchanged, because it has no visible
conflict to repair.

## 10. Accessibility checks

Verified across the integrated app: Korean document language; the skip link is the
first focusable element and moves focus to the single `#main-content`; exactly one
`h1` per view; one shared navigation; native controls stay native (`<button
aria-pressed>`, native radios, native `<select>`, native pagination buttons); visible
focus; logical Tab order; no clickable-`div` controls; no fake tabs or radio groups;
standing caveats are not alerts and genuine errors are; loading states are polite
`role="status"`; and chart values remain available as text or tables with captioned,
`scope`-annotated headers.

Two live-region rules are newly asserted **per view** by the integration spec: no
`data-testid` on a live region appears twice, and no live region is nested inside
another (which would announce it twice). `phase7FinalRegression.spec.ts` continues to
own the complementary rule that no live region is trapped inside a collapsed
disclosure.

No accessibility test was changed to accept a regression. The one component change in
this milestone is colour-only and preserves the text label that carries the semantic.

## 11. Viewport results

Desktop targets — all six views, all pass:

| Viewport | h-overflow | one `h1` | one `#main-content` | map counts | singletons | 비용 계산하기 |
| --- | --- | --- | --- | --- | --- | --- |
| 1024 × 768 | none | yes | yes | 1/1/1/0/0/0 | no duplicates | 544 → 588 |
| 1280 × 800 | none | yes | yes | 1/1/1/0/0/0 | no duplicates | 544 → 588 |
| 1440 × 900 | none | yes | yes | 1/1/1/0/0/0 | no duplicates | 544 → 588 |
| 1920 × 1080 | none | yes | yes | 1/1/1/0/0/0 | no duplicates | 544 → 588 |

Basic responsive regression — regression checks only, no mobile redesign:

| Viewport | h-overflow | one `h1` | one `#main-content` | map counts | singletons |
| --- | --- | --- | --- | --- | --- |
| 768 × 1024 | none | yes | yes | 1/1/1/0/0/0 | no duplicates |
| 390 × 844 | none | yes | yes | 1/1/1/0/0/0 | no duplicates |

Also still passing unchanged: `responsive.spec.ts` and the `phase7FinalRegression`
responsive smoke at 390×844, 430×932, 768×1024, 1024×768, 1054×800, 1280×800, and
1440×900. Tables keep their overflow local, disclosures stay reachable, full-width
pages scroll as ordinary documents, map views do not clip the map, overlays stay
inside the map workspace, and no action is covered by a sticky element.

No dashboard other than the contracted 비용 살펴보기 setup action is required to fit
inside one viewport.

## 12. Tests added and changed

| File | Change |
| --- | --- |
| `frontend/e2e/finalUiIntegration.spec.ts` | **New.** 17 tests: the six-view table at four desktop and two responsive viewports, the singleton/staleness sweep, the navigated-to cost first-screen check, deep-link restoration, an in-app tour, browser back/forward, the sub-view round trip, the 데이터·출처 heading-vs-label distinction, per-view live-region duplication, and the missing-data-is-not-zero check. |
| `frontend/e2e/facilityCostDashboard.spec.ts` | `scrollToTop()` + `expectActionOnFirstScreen()` replace the `page.mouse.wheel` race. Strictly stronger: adds `scrollY === 0`, the 44px floor, non-overlap, and both readiness surfaces in viewport. |
| `frontend/src/components/FacilityCostDashboard.tsx` | Layout repair + rationale comment. |
| `frontend/src/app/page.tsx` | `DerivedPanel` container tokens + rationale comment. |

No existing assertion was weakened, skipped, or deleted. No pixel snapshots were
added — the repository has no visual-regression infrastructure (`baseline.md` §7).

## 13. Feature-branch validation

All run in `frontend/` on `fix/final-ui-integration-regression`.

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | **pass**, exit 0, no warnings |
| Typecheck | `npm run typecheck` | **pass**, exit 0 |
| Unit | `npm test` | **1094 passed, 7 skipped, 0 failed** (47 files passed, 1 skipped), 38.27s |
| Build | `npm run build` | **pass** — compiled in 6.0s, TypeScript 11.7s, 4/4 static pages |
| Focused cost (×10) | `npx playwright test e2e/facilityCostDashboard.spec.ts --repeat-each=10` | **260 passed, 0 skipped, 0 failed**, 3.8m |
| Focused integration | `civicShell` + `desktopNavigation` + `facilityCostDashboard` + `integration` + `phase7FinalRegression` + `finalUiIntegration` | **117 passed, 0 skipped, 0 failed**, 3.6m |
| Full Playwright (clean server) | `lsof -ti tcp:3000 \| xargs kill -9` then `npm run test:e2e` | **494 passed, 89 skipped, 0 failed**, 10.0m |

### Reading the full-suite numbers against history

| Run | Passed | Skipped | Failed |
| --- | --- | --- | --- |
| 데이터·출처 feature branch | 476 | 89 | 1 (the cost defect) |
| 데이터·출처 post-merge (lucky) | 477 | 89 | 0 |
| **this branch** | **494** | **89** | **0** |

494 = 477 + the 17 new integration tests. The zero is now earned rather than lucky:
the same suite fails at 838-against-768 when the layout fix alone is removed.

### Skipped tests

All 89 skips are the live-backend specs, which `test.skip` themselves when
`E2E_BACKEND_URL` is unset (it was unset for every run above; the config comment
documents the convention). They assert against real official data and are never given
a mock substitute:

```text
e2e/map.spec.ts              e2e/landfill.spec.ts
e2e/regressions.spec.ts      e2e/phase5LandfillDashboard.spec.ts
e2e/landCoverLayer.spec.ts   e2e/landCoverIntegratedQa.spec.ts
e2e/landCoverPerformance.spec.ts
```

The skip count is **unchanged** from the previous milestone, so this branch neither
added nor silenced a live-backend test.

## 14. Post-merge validation

The branch was pushed and merged into the latest `main` with `--no-ff`, with no
conflicts, in three pushes: `98372d7..ecf1d7f` (the work), `ecf1d7f..775a4df` (this
section), and `775a4df..93263ba` (the `civicShell` wait fix described below).
Everything was re-run **from merged `main`**, not carried over from the feature
branch — first at `ecf1d7f`, then in full again at `93263ba`, the last
code-bearing commit:

| Check | at `ecf1d7f` | at `93263ba` (final) |
| --- | --- | --- |
| `npm run lint` | **pass**, exit 0 | **pass**, exit 0 |
| `npm run typecheck` | **pass**, exit 0 | **pass**, exit 0 |
| `npm test` | **1094 passed, 7 skipped, 0 failed**, 31.04s | **1094 passed, 7 skipped, 0 failed** |
| `npm run build` | **pass**, exit 0 | **pass**, exit 0 |
| `…facilityCostDashboard.spec.ts --repeat-each=10` | **260 passed, 0 failed**, 3.6m | **260 passed, 0 failed**, 3.7m |
| `npm run test:e2e` (clean server on port 3000) | **494 passed, 89 skipped, 0 failed**, 9.8m | **494 passed, 89 skipped, 0 failed**, 9.1m |

Identical to the feature-branch results in §13, including the unchanged 89
live-backend skips. Merged `main` therefore has 0 relevant lint, TypeScript, unit,
build, and Playwright failures.

Repository state:

```text
current branch  main
local HEAD      93263baf2aebdeac38f170dd70ef67d885d24f90   (+ this docs-only commit)
origin/main     same
working tree    clean except untracked docs/SUITABILITY_SITE_CLUSTERS_SPEC.md
```

The only commit after `93263ba` is this documentation edit, which touches no code.

### One further failure, found by the final re-run, investigated and fixed

The whole validation set was re-run once more at the final `main` HEAD. That run
surfaced a failure the two previous full runs had not:

```text
e2e/civicShell.spec.ts:155 › desktop 1920×1080 › mounts exactly one map, …
expect(locator).toHaveCount(expected) failed
Locator: getByTestId('map-container')   Expected: 1   Received: 0
13 × locator resolved to 0 elements
```

It was **not** dismissed as a flake. Evidence gathered before deciding:

* **Isolation:** `e2e/civicShell.spec.ts --repeat-each=10` → **170 passed**, 5.6m.
  So it is not a code defect — the map does mount.
* **Baseline:** the full suite at unmodified `main` `98372d7` → **477 passed, 89
  skipped, 0 failed**, 8.3m. One clean run there settles nothing on its own, but it
  shows the fragility is not constant.
* **Mechanism, read from the spec:** `gotoView()` waits for `mode-switch`, which
  `DashboardShell` renders **immediately in every branch**, including while the
  view's initial requests are still in flight. The map mounts only once that data
  resolves. Every map assertion in the file therefore raced the load on Playwright's
  default **5s** budget. The failing run took 11.2m against the baseline's 8.3m — the
  17 new integration tests each load all six views, so the suite genuinely applies
  more concurrent load to the dev server than before.

Rather than call a load-sensitive 5s wait "flaky", the wait was corrected.
`gotoMapView()` waits for `map-container` itself with the **15s** budget the rest of
the repository already uses for exactly this (`e2e/equityDashboard.spec.ts`,
`e2e/finalUiIntegration.spec.ts`), and the three map-dependent tests use it. This
changes only how long the test is willing to wait — **every assertion is unchanged**,
including `toHaveCount(1)`. The map-free views deliberately keep `gotoView` +
`toHaveCount(0)`, which must not be given extra patience, since a longer wait there
could only ever mask a map mounting late.

Re-verified: `--repeat-each=5` → **85 passed**, 3.0m; lint and typecheck exit 0.

*(§14 was itself merged after `ecf1d7f`, together with the `civicShell.spec.ts` wait
fix; the right-hand column above is the complete re-run at `93263ba`.)*

## 15. CI

```text
No CI workflow exists in this repository; local validation is the available
automated verification.
```

`find .github -maxdepth 3 -type f` returns nothing.

## 16. Deployment readiness

The frontend is deployment-ready from the UI side:

* the one confirmed layout defect is repaired at its cause, with ~180px of margin;
* the assertion guarding it is deterministic and proven to fail on the old layout;
* all six areas pass integration regression together at six viewports;
* lint, typecheck, unit, build, and the full clean-server Playwright suite are green
  on merged `main`;
* no backend, database, migration, ingestion, Docker, or Caddy change is involved, so
  the deployment is a frontend-only recreate.

**OCI deployment is deliberately deferred to the next milestone** and no production
operation was performed here. Points to carry into it, from the deployment memories:

* the compose project must be named explicitly — `-p waste-equity-prod`;
* the SSH key is passphrase-protected → `ssh-add --apple-load-keychain` first;
* production HEAD has previously been **detached**, so diff the actual deployed SHA
  rather than assuming it matches `main`;
* `/ready` returning 404 and the static lifecycle reading `NOT_RUN` are pre-existing
  non-defects.

## 17. Remaining risks

* **The cost rail's budget is healthy but finite.** ~180px at 1024×768. Content added
  to the rail above the button, *or to the workflow column above the grid*, must be
  measured against `expectActionOnFirstScreen`. The fix, if it fires again, is to move
  content — not to relax the assertion.
* **The scope notice is now 624px wide at 1024** instead of 960, so it wraps to more
  lines. It is in the scrolling column, so this costs no first-screen budget, but it
  does make the workflow column taller.
* **Two `data-testid="reference-period"` nodes co-exist** on the two facility-burden
  metrics, because `useDerivedInfo` and `useSourceInfo` both return non-null there.
  Pre-existing and recorded in `equity-dashboard.md` §11; left alone here because the
  live `e2e/map.spec.ts` queries that id and changing it is a live-spec change, not a
  presentational one.
* **`DerivedPanel` still prints raw technical text on a visible surface** —
  `산출 가정 (assumptions)`, `산출 버전 …-v1`, `출처: … (sgis)` — none of it in a
  `[data-diagnostic]` node. It is pre-existing, the terminology audit passes, and
  demoting it is a wording change rather than the presentational compatibility fix
  this milestone is scoped to. It is the natural next piece of work on these panels.
* **The transparency frontend-copy items in §8 remain frontend copy.** Resolving them
  requires backend work that is explicitly out of scope here.
* **`e2e/phase6DataSourcesDashboard.spec.ts` is the suite's slow file** (5.8m of the
  10.0m wall clock). Not a defect, but it dominates full-suite time.
