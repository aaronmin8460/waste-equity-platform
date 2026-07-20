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
| Initial data load | `role="status"` on the loading text | load starts / resolves |
| Genuine load error | `role="alert"` on the error panel | a fetch fails |
| Selected metric | `role="status"` `selected-metric-summary` | the metric radio changes |
| Suitability profile / candidate counts | `role="status"` `suitability-live` | profile or summary updates |
| Selected region (accessible alt.) | `role="status"` inside `selected-region-summary` | a map region is clicked |
| Landfill results | `role="status"` `landfill-live` | a filter loads new official values |
| Landfill loading | `role="status"` `landfill-loading` | flow data is loading |
| Cost service regions | `role="status"` `facility-cost-region-status` | a region is selected, removed, bulk-selected, or cleared |
| Cost calculate readiness | `role="status"` `facility-cost-calculate-status` | the primary action becomes (un)available |

Announcements are kept concise (single short sentence) to avoid verbose or
repetitive read-out; `role="status"`/`aria-live="polite"` never interrupts.

## Metric grouping (fieldset / legend)

The 11 metric radios are grouped into three semantic `<fieldset>`s, each with a
`<legend>` (`lib/metrics.ts` `METRIC_GROUPS`, rendered in `app/page.tsx`):

- 총량 지표 (Total-quantity indicators) — population + the four waste-generation totals
- 1인당 형평성 지표 (Per-capita equity indicators) — the four per-capita metrics
- 시설 부담 지표 (Facility-burden indicators) — the two facility-throughput metrics

All radios share `name="metric"`, so they remain one logical radio group (arrow
keys move across every option); the fieldsets only add accessible sub-grouping
and visual scanning. No metric calculation is affected — `group` is metadata only.

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

No axe/large a11y dependency was added (the repo did not already use one); the
existing vitest + Playwright tooling covers the foundation.
