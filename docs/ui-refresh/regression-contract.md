# UI refresh — regression contract

What the visual refresh may **not** change. Every item below is enforced by a test
that already exists or that this milestone added; the test is named so a future
phase can find it before "cleaning up" the behavior it protects.

A change to any item here is a product decision, not a styling decision. §10 lists
the single item this milestone deliberately changed, and why.

## 1. Primary navigation labels (frozen strings)

```text
지역 부담      후보지 분석      매립지 현황      데이터·출처
```

Source of truth: `MODE_LABELS` in `frontend/src/lib/glossary.ts`.

* Each nav button's `textContent` must equal `MODE_LABELS[key]` **exactly** — the
  terminology audit compares with `.toBe`, so an icon, badge, counter, or any extra
  character inside a button breaks it.
* Test IDs stay `mode-equity`, `mode-suitability`, `mode-flow`, `mode-transparency`.
* The group keeps `data-testid="mode-switch"`, `role="group"`, and
  `aria-labelledby="mode-switch-label"`; the label element keeps that id, keeps a
  non-empty accessible name, stays `sr-only`, and must not be a heading.
* Brand content and any future utility action stay **outside** the mode-switch group.

Enforced by: `components/ui/TopNavigation.test.tsx`, `app/terminology.audit.test.tsx`,
`app/shell.test.tsx`, `e2e/desktopNavigation.spec.ts`, `e2e/civicShell.spec.ts`.

## 2. Mode and sub-view switching

* Native `<button aria-pressed>` semantics — **not** `role="tab"` or
  `role="radiogroup"`, which would promise roving arrow-key focus that is not
  implemented.
* Sub-view labels stay 후보지 점수 / 가중치 바꿔보기 / 비용 살펴보기
  (`SUBVIEW_LABELS`) with test IDs `suitability-view-{score,scenario,cost}`.
* The sub-view bar renders **only** inside 후보지 분석, exactly once, in the same
  position for all three sub-views, as a direct child of the shell above `<main>`.

Enforced by: `app/shell.test.tsx`, `e2e/desktopNavigation.spec.ts`.

## 3. URL-state restoration

`?v=1&mode=…&view=…&metric=…&cand=…` still restores mode, sub-view, metric, and the
selected candidate on load, and the app still mirrors state back with
`history.replaceState`. `v=1` remains mandatory for a deep link to be honoured.

Enforced by: `lib/urlState.test.ts`, `app/shell.test.tsx`, `app/page.selection.test.tsx`,
`e2e/phase7FinalRegression.spec.ts`.

## 4. Map behavior

* **Exactly one `MapView`** instance. 비용 살펴보기, 매립지 현황, and 데이터·출처
  mount none — gone from the DOM, never hidden with CSS.
* The map is not remounted when navigating equity ↔ suitability (identity, not mere
  presence, is asserted): MapLibre viewport, sources, and the ResizeObserver survive.
* Map click → region/candidate selection, the popup, and the selection sync with the
  region selector and ranking list are unchanged.
* The map pane still fills the viewport bottom at desktop with no strip below it, and
  the floating legend stays inside the map bounds.

Enforced by: `app/shell.test.tsx`, `app/page.selection.test.tsx`, `components/MapView.test.tsx`,
`e2e/desktopNavigation.spec.ts`, `e2e/responsive.spec.ts`, `e2e/civicShell.spec.ts`.

## 5. Metric radios

The equity metric controls stay **three labelled `<fieldset>` groups** — total,
per-capita, burden (`metric-group-total`, `metric-group-per_capita`,
`metric-group-burden`) — with the same number of radios, the same grouping, and the
same accessible names. `e2e/accessibility.spec.ts` asserts the page has exactly three
fieldsets, so no new primitive may introduce a fourth.

## 6. Missing data is never zero

* A missing value renders its **served reason**, never `0`, never a placeholder
  figure, never an example value.
* An official `0` and 자료 없음 stay visually and semantically distinct, including in
  CSV export (`lib/exports.ts` writes an empty cell plus 자료 없음, not `0`).
* The map's no-data class keeps its own neutral color from `lib/metrics.ts`
  (`NO_DATA_COLOR`) and is never the lightest ramp step.
* The new `DataStatusBadge` carries a **text** label for every state, so status is
  never conveyed by color alone; its missing state uses the neutral `--color-no-data`
  gray, which is not part of any analytical ramp.

Enforced by: `components/ui/primitives.test.tsx`,
`components/ui/dashboardPrimitives.test.tsx`, `lib/exports.test.ts`,
`app/accessibility.test.tsx`, `e2e/responsive.spec.ts`.

## 7. Provenance, reference periods, and disclaimers

* Every displayed analytical metric keeps its source and reference period on screen
  (repo `AGENTS.md`).
* The suitability disclaimers stay visible and unsoftened: the 광역 분석 스크리닝
  framing, 참고용 임시 점수, the CRITIC-weight caveat, and the "decision-support, not
  a siting decision" statement.
* Land-cover and wetland source/licence notes keep their exact served wording.
* The transparency area keeps its plain-Korean primary surface: raw enums, version
  strings, and English dataset names stay behind `자세히 보기` disclosures and
  `[data-diagnostic]` nodes.

Enforced by: `app/terminology.audit.test.tsx`, `components/TransparencyDashboard.test.tsx`,
`components/LandCoverSourceNote.test.tsx`, `components/WetlandSourceNote.test.tsx`,
`lib/glossary.test.ts`.

## 8. Landmarks and headings

* Exactly **one** `<main id="main-content" tabIndex={-1}>` per view, owned by the
  shell, and it is the skip link's target.
* Exactly **one `<h1>` per view**. `TopNavigation` renders **no heading** — the brand
  in the app bar is a `<span>`, so it cannot become a second `h1`.
* Exactly one navigation landmark; no duplicate nav region is introduced.
* `:focus-visible` keeps a ≥3px high-contrast ring on every control, and the skip
  link stays the first focusable element.

Enforced by: `app/shell.test.tsx`, `app/accessibility.test.tsx`,
`e2e/accessibility.spec.ts`, `e2e/desktopNavigation.spec.ts`, `e2e/civicShell.spec.ts`.

## 9. Exports and existing actions

The existing real actions are unchanged and no decorative action was added:

* CSV export (`lib/csv.ts`, `lib/exports.ts`) and the share/export bar
  (`components/ShareExportBar.tsx`);
* the print-ready report modal (`components/ReportPreview.tsx`, `.wep-print`);
* the shareable-URL copy action.

The refreshed app bar deliberately renders **no utility action**, because attaching
one would mean either duplicating a page-level control or adding a decorative button
with no real function. Utility actions may be added later only when wired to an
existing export.

## 10. The one deliberate change in this milestone

**The equity/suitability map view's `<h1>` is now the area title, not the product
name.**

* Before: the sidebar `<h1>` read `우리 동네 폐기물 지도` (the product name), and the
  app bar showed only the four tabs.
* After: the product name and its English subtitle live in the app bar brand block
  (a `<span>`, outside the mode-switch group), and the sidebar `<h1>` is
  `MODE_LABELS[mode]` — 지역 부담 or 후보지 분석 — matching how 매립지 현황,
  데이터·출처, and 비용 살펴보기 already title themselves.
* The existing tagline `서울 · 인천 · 경기 공공자료로 보는 지역 부담과 후보지` is
  preserved verbatim as the page-header description.
* Unchanged: one `h1` per view, the `h1` precedes the `mode-orientation` strip, and
  the nav labels are untouched.

`app/accessibility.test.tsx` was updated from asserting the product name to asserting
the active area's label. That is the only test expectation this milestone changed,
and it records an intentional information-architecture decision — it does not mask a
regression: the count assertion (exactly one `h1`) is unchanged and still enforced in
every area.

## 11. Deliberately not adopted: `min-width: 1024px` on the shell

The reference height contract for this milestone suggested
`.app-shell { min-width: 1024px; height: 100vh; overflow: hidden }`. The height and
overflow parts are already satisfied by `DashboardShell` (see `baseline.md` §6). The
`min-width: 1024px` part was **not** adopted, because this repository has a
pre-existing, test-enforced responsive contract at 390 / 430 / 768 / 1054 px:
`e2e/responsive.spec.ts` asserts `document.documentElement.scrollWidth <= clientWidth`
at every one of those widths, and a hard 1024px minimum would guarantee document-level
horizontal overflow on all three sub-1024 viewports.

Adopting it would therefore have meant deleting passing tests to make a styling rule
fit — exactly what this contract exists to prevent. The application remains
desktop-first (the desktop layout is the designed one; sub-1024 is preserved, not
extended).
