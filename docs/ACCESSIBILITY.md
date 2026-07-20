# Accessibility behaviour (Phase 2 foundation)

This documents the accessibility foundation the dashboard ships with. It is a
foundation, not a full WCAG audit: it establishes document semantics, keyboard
operability, status announcements, and accessible alternatives for the
canvas-only map. Later phases build map/dashboard UX on top of these hooks.

Scope note: no data-integrity behaviour changed. A region, candidate, or landfill
value that is unavailable is still shown as its served availability text, never as
a fabricated `0` — the accessible alternatives forward the same values the visual
UI shows.

## Document language

`app/layout.tsx` sets `<html lang="ko">`. The application text is primarily
Korean, so assistive technology reads it with Korean pronunciation.

## Skip navigation

A visible-on-focus skip link (`본문으로 바로가기`) is the first focusable element
in the body (`app/layout.tsx`, styled in `app/globals.css` as `.skip-link`). It is
positioned off-screen until it receives keyboard focus, then slides into view.
Activating it moves keyboard focus to the primary content region, which carries
`id="main-content" tabindex="-1"` in every rendered view (loading, error,
equity/suitability, and the 수도권매립지 dashboard).

## Status announcements (live regions)

Dynamically changing result areas are announced without moving focus:

| Area | Mechanism | Announced when |
| --- | --- | --- |
| Initial data load | `role="status"` `loading` on the loading text (the Phase 4 structural `Skeleton` beside it is `aria-hidden`) | load starts / resolves |
| Genuine load error | `role="alert"` on the error panel | a fetch fails |
| Selected metric | `role="status"` `selected-metric-summary` | the metric radio changes |
| Suitability profile / candidate counts | `role="status"` `suitability-live` | profile or summary updates |
| Selected region (accessible alt.) | `role="status"` inside `selected-region-summary` | a map region is clicked |
| Landfill results | `role="status"` `landfill-live` | a filter loads new official values |
| Landfill loading | `role="status"` `landfill-loading` | flow data is loading (the Phase 5 `Skeleton` beside it is `aria-hidden`) |
| Landfill no official record | `role="status"` `landfill-no-data-live` | a filter combination the backend holds no record for |
| Landfill request failure | `role="alert"` `landfill-error` | a landfill fetch genuinely fails |
| Cost service regions | `role="status"` `facility-cost-region-status` | a region is selected, removed, bulk-selected, or cleared |
| Cost calculate readiness | `role="status"` `facility-cost-calculate-status` | the primary action becomes (un)available |
| Cost calculation in flight | `role="status"` `facility-cost-calculating-status` | a calculation starts (the `Skeleton` beside it is `aria-hidden`) |
| Cost results | `role="status"` `facility-cost-results` | a calculation succeeds and the results view opens |
| Source catalog result count | `role="status"` `transparency-result-count` | the search text or either filter changes |
| Source reference periods | `role="status"` `transparency-freshness-status` (`sr-only`, persistent) | the freshness request starts, succeeds, or fails — the node stays mounted and its TEXT changes, because a live region that already holds its content when inserted is generally not announced, and removing one announces nothing |
| Facility-mapping loading | `role="status"` `transparency-mapping-loading` | the mapping panel is loading (the Phase 6 `Skeleton` beside it is `aria-hidden`) |
| Facility-mapping request failure | `role="alert"` `transparency-mapping-error` | the mapping fetch genuinely fails |

On the 데이터와 출처 surface the alert role is reserved for that one genuine failure.
The standing `transparency-notice` banner, the registry-served-no-records state
(`transparency-sources-empty`), the local search-matched-nothing state
(`transparency-empty-results`), and the freshness-request-failed note
(`transparency-freshness-error`) all carry **no** role — none of them is something the
reader must act on, and a standing disclaimer that interrupted on every render would
train people to ignore the real alerts. Every live region on that page is rendered
outside the accordions, so none can be trapped inside a collapsed `<details>`
(asserted).

Announcements are kept concise (single short sentence) to avoid verbose or
repetitive read-out; `role="status"`/`aria-live="polite"` never interrupts.

## Metric grouping (fieldset / legend)

The 11 metric radios are grouped into three semantic `<fieldset>`s, each with a
`<legend>` (`lib/metrics.ts` `METRIC_GROUPS`, rendered in `app/page.tsx`):

- 총량 지표 — population + the four waste-generation totals
- 1인당 형평성 지표 — the four per-capita metrics
- 시설 부담 지표 — the two facility-throughput metrics

(The rendered `<legend>`s are Korean-only, as stated below. The English glosses that
used to appear here read as if the UI showed a bilingual label; it does not.)

All radios share `name="metric"`, so they remain one logical radio group (arrow
keys move across every option); the fieldsets only add accessible sub-grouping
and visual scanning. No metric calculation is affected — `group` is metadata only.

**This structure is a hard contract, re-asserted in Phase 4.** The desktop redesign
restyled the metric controls (one card per family, tighter rows, a selected row
emphasised by border + weight as well as the native radio) but changed nothing
structural: still exactly 3 `<fieldset>`s, 3 `<legend>`s, and 11
`input[type=radio][name="metric"]`, with the same values and the same `onChange`.
Native radios were **not** replaced by a select, combobox, segmented control, tabs,
or custom div-based controls, and no metric family is hidden behind a closed
disclosure — all eleven options stay visible and reachable on desktop. The group
legends are the Korean-only `총량 지표` / `1인당 형평성 지표` / `시설 부담 지표`
strings from `lib/metrics.ts`.

Phase 4 also made the **active** metric the visually dominant element of the control
column: its plain-Korean name renders at `text-base font-semibold` with the unit as
muted secondary text and the source/reference period as a caption. That block *is*
the existing `role="status"` `selected-metric-summary` live region — the live region
wraps only the name and unit so the announcement stays one short phrase, with the
provenance caption deliberately outside it.

The equity control column remains an `<aside>`, which both the terminology audit and
`page.phase4.test.tsx` depend on.

## Keyboard & focus

- A shared, high-contrast `:focus-visible` ring (`globals.css`) shows on keyboard
  focus for every native and custom control, including the MapLibre popup close
  button. It never appears for pointer focus, so status is never conveyed by color
  alone.
- All controls are native (buttons, radios, checkboxes, selects, `<details>`,
  links) and keyboard-operable; no custom key handlers were added where a native
  control already suffices.
- The one exception is the cost lens's service-region picker
  (`ui/SearchableRegionPicker.tsx`), where no native control provides
  type-to-filter multi-selection. It implements the standard ARIA 1.2 combobox:
  `role="combobox"` + `aria-expanded` / `aria-controls` / `aria-autocomplete="list"`
  on the input, a `role="listbox"` of `role="option"` elements with `aria-selected`,
  and `aria-activedescendant` for the keyboard-active option — so DOM focus never
  leaves the input, Tab always walks straight out, and there is no keyboard trap.
  ArrowDown/ArrowUp move the active option, Enter selects, Escape closes. Selection
  is conveyed by `aria-selected` **and** a visible 선택됨 word, never by color alone.
  Everything around it stays native: the facility-type cards are `<input
  type="radio">` in a `<fieldset>`/`<legend>`, and 고급 설정 is a `<details>`
  disclosure.
- The mode switch is a labelled `role="group"` of toggle buttons with
  `aria-pressed` (not a `radiogroup`, which would promise arrow-key roving focus
  the native buttons do not implement). Focus stays on the activated button after
  a mode change.
- The cost lens's setup ↔ results split (Phase 3 of the desktop redesign) is the one
  place focus is moved programmatically. Returning to setup via **← 설정 바꾸기** moves
  focus to the first setup heading (`#fc-step-regions`, `tabIndex={-1}` — a
  programmatic target only, never a Tab stop), so a keyboard or screen-reader user is
  not dropped at the top of the document with no idea the view changed. Focus moves
  only on a deliberate return, never on first paint. Opening the results view does not
  move focus: the KPI block is a polite live region, which announces without stealing
  it. Neither view manipulates browser history.
- No keyboard trap: focus walks from the skip link through the sidebar controls
  and back out (asserted in `e2e/accessibility.spec.ts`).

## Map alternatives & semantics

The MapLibre canvas is not independently tabbable; instead the map is a labelled
`region` landmark (`role="region"` + `aria-label` that names the mode/metric) with
an `aria-describedby` textual description that points users at the accessible DOM
alternatives (`components/MapView.tsx`):

- Equity: clicking a region mirrors the popup into an accessible `선택한 지역`
  summary (region name, metric label, exact served value **or** its availability
  text, boundary source, derived-geometry note). This is the keyboard/screen-reader
  path to region information.
- Suitability: the top-candidate list and the candidate-detail panel are native
  buttons/DOM (already present); the selected list item is marked with text
  (`✓ 선택됨`) and `aria-current`, not color alone.

## Headings & labels

- One logical `<h1>` per rendered view.
- The mode-switch label is a non-heading (`<p>` + `aria-labelledby`) so that in
  수도권매립지 mode — where the switch renders above the dashboard's own `<h1>` —
  the heading order is not broken by an `<h2>` before the `<h1>`.
- Every input has an associated `<label>`; icon-only affordances are either given
  text (`지우기 ✕`, `닫기 ✕`) or marked `aria-hidden` when decorative (the
  collapsible chevron `▾`).

## Color independence

Selected states, candidate status, and data availability are never conveyed by
color alone: the mode switch and top-candidate use `aria-pressed`/`aria-current`
plus text/ring; candidate status and the no-data class carry text labels; the
selected-region value shows availability text (`데이터 없음 — …`) rather than a bare
recolor.

## Tests

- `src/app/accessibility.test.tsx` — fieldset groups, live regions, mode group,
  single `<h1>`, suitability candidate-list selection.
- `src/components/MapView.test.tsx` — map region label/description, region-click →
  accessible selection (no fabricated value).
- `src/components/LandfillDashboard.test.tsx` — skip target + landfill status region.
- `e2e/accessibility.spec.ts` — `lang="ko"`, skip link focus behaviour, keyboard
  focus ring, map region label, fieldsets, live regions, keyboard walk (no trap),
  at mobile (390×844) and desktop (1440×900).
- `src/app/page.phase4.test.tsx` — the Phase 4 equity contracts: 3 fieldsets / 3
  legends / 11 shared-name radios, Korean-only group legends, no metric family behind
  a closed disclosure, the active-metric live region and its typographic hierarchy,
  the native `region-select`, map-click ↔ select ↔ panel synchronisation through one
  `selectedRegionCode`, missing-never-zero, the `aria-hidden` loading skeleton beside
  the `role="status"` announcement, one `<h1>`, one map, and a token-free `<aside>`.
- `e2e/phase4EquityMap.spec.ts` — the same contracts at real viewports (390×844,
  768×1024, 1054×800, 1280×800, 1440×900): single nav/main/map/h1, legend geometry
  inside the map and clear of the attribution, no horizontal overflow, no empty strip
  below the map, keyboard focus visible, and no keyboard trap.
- `src/components/LandfillDashboard.test.tsx` — the Phase 5 landfill contracts: one
  `<h1>` and no map/sidebar/second nav, the four native `<select>`s each wrapped by
  their `<label>`, the `aria-hidden` loading skeleton beside the `role="status"`
  announcement, the standing `tone="info"` banner carrying **no** `role`, the
  `role="alert"` genuine error kept separate from the no-data state — which is not an
  alert but is still announced politely by its own `role="status"` line, since the
  whole results region is replaced when a filter empties it — the
  `role="status"` `landfill-live` region never inside a collapsed `<details>`,
  captioned table with `th[scope]` headers, `aria-hidden` comparison bars whose values
  remain readable as text, filter controls that stay populated through a load and an
  empty answer (a native `<select>` whose value matches no option renders blank), and
  a forbidden-token scan of the primary surface.
- `e2e/phase5LandfillDashboard.spec.ts` — the same contracts at real viewports
  (390×844, 768×1024, 1024×768, 1280×800, 1440×900): single nav/main/h1 with no map,
  the four filters on one desktop row, computed font sizes proving each KPI value
  outranks its label and explanation, no page-level horizontal overflow with the table
  scrolling locally, a keyboard walk across the filter row with a visible focus outline
  and no trap, and the loading / data / no-data / partial / error states each asserted
  distinctly.
- `src/components/TransparencyDashboard.test.tsx` — the Phase 6 데이터와 출처
  contracts: one `<h1>` and no map/nav/main/aside of its own, the orientation strip
  following the heading, the standing banner carrying **no** `role`, the visible
  `<label>` bound to the native search input, the polite `transparency-result-count`
  rendered outside every disclosure, the `aria-hidden` skeleton beside the
  `role="status"` loading line, the `role="alert"` genuine failure kept distinct from
  both empty states and from a failed freshness request, every disclosure being a
  native `<details>` with a non-empty `<summary>`, no live region inside a collapsed
  disclosure, long identifiers wrapping via `break-all`, and a forbidden-token scan of
  the primary surface.
- `e2e/phase6DataSourcesDashboard.spec.ts` — the same contracts at real viewports
  (390×844, 430×932, 768×1024, 1024×768, 1280×800, 1440×900): single nav/main/h1 with
  no map, canvas, sidebar, or segmented control; the search and both filters sharing
  one desktop row; a multi-column catalog; the orientation content inside the first
  viewport at both desktop widths; no page-level horizontal overflow with tables
  scrolling locally; a keyboard walk from the search field across the clear control
  and both selects with a visible focus outline and no trap; and the five states each
  asserted distinctly.

- `src/components/ReportPreview.test.tsx` — the Phase 7 report-dialog contracts: the
  modal's `aria-modal` + accessible name resolving to real title text, focus moving
  into the dialog on open, the 닫기 control having a meaningful name rather than a
  bare glyph, Escape / backdrop / button close (and a panel click NOT closing), the
  widened viewport-safe panel with a locally scrolling body, and that only a genuine
  `disclaimer` block renders as a warning.
- `e2e/phase7FinalRegression.spec.ts` — the Phase 7 cross-dashboard integration pass
  in a real browser (36 tests): one shell / one `#main-content` / exactly one `<h1>`
  in every one of the four areas and three sub-views, the frozen navigation and
  sub-view labels, the segmented control existing only inside 후보지 분석, exactly one
  map in map views and zero in map-free views with `.map-pane` still the height owner,
  the desktop map reaching the viewport bottom at 1440×900 and 1280×800, landfill
  filter URL round-tripping via `replaceState` with no history growth, the report
  modal's real bounding box at both desktop targets plus mobile/tablet containment and
  keyboard close, a forbidden-token scan of all five primary surfaces, a standing
  disclaimer that is not an alert, no live region inside a collapsed `<details>`, and
  no page-level horizontal overflow at 390 / 430 / 768 / 1024 / 1054 / 1280 / 1440.

## Phase 7 accessibility findings

Three genuine defects were found on surfaces no audit had previously scanned (the
terminology audit covered the equity `<aside>`, cost results, landfill, and
데이터와 출처 — never the suitability legend or the weight lab):

- the suitability legend heading rendered `상태 (Status) · 점수 범례`; it is now Korean-only;
- the weight lab rendered `순위 산정 대상 (ELIGIBLE)` and `분석 실행 (run)` as primary
  `<dt>`s; both are plain Korean now, with the raw enum demoted to a `data-diagnostic`
  line rather than deleted;
- `page.tsx` used the raw `ELIGIBLE` enum in two citizen sentences.

Separately, the weight lab's landmark `aria-label` still read `가중치 실험실` — the
pre-Phase-1 name — so a screen-reader user heard a region name that no visible control
used. It now matches the visible sub-view tab, `가중치 바꿔보기`.

No axe/large a11y dependency was added (the repo did not already use one); the
existing vitest + Playwright tooling covers the foundation.
