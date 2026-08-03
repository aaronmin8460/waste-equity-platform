# UI refresh — 지역 부담 (equity) dashboard

The second milestone of the civic-dashboard refresh. The first
(`feat/civic-dashboard-foundation`, merged as `a7ce49e`) established the tokens,
the shell, the navigation, and the shared primitives; this one rebuilds the
**지역 부담** screen on top of them.

Everything below was read out of the repository or measured in a real browser at
the stated viewport. Nothing here is aspirational.

## 1. The before-state, and what was wrong with it

The screen worked. Its problems were of hierarchy and repetition, not function.

| # | Before | Why it was a problem |
| --- | --- | --- |
| B1 | Two adjacent cards — `선택한 지표` then `선택한 지역` — each rendered its **own copy** of `metricProvenance`. | The same source line appeared twice within ~200px. Repetition is how mandatory provenance stops being read. |
| B2 | The reference period existed only inside those provenance sentences (`… · 기준 2024`). | The single most-asked question about any public statistic — *when is this from?* — had no distinct, scannable slot. |
| B3 | The region `<select>` sat **inside** the selected-region summary, between its heading and its value. | The card that answers "what did I click?" opened with a form control, so it read as an input, not an answer. |
| B4 | Nothing on the screen said, in words, whether a displayed number was published by the source or computed by this platform. | `DerivedPanel` states it, but only inside the collapsed 출처와 계산 방법 disclosure at the bottom of the column. |
| B5 | The three metric families were bare `<legend>` + list stacks inside one card, visually indistinguishable from one another. | Eleven radios read as one long undifferentiated list. |
| B6 | The ranking's basis line named the metric and the unit but **not** the reference period. | Same as B2, at the point where regions are being compared against each other. |
| B7 | The map workspace carried only the legend. Interpretation, limitations, and provenance lived exclusively in the sidebar. | The map is where a reader looks; the caveats were 900px away from it. |
| B8 | A comparison row for a region with no served value showed a bare `자료 없음` and dropped the served reason. | The reason existed on the feature (`unavailable_reason`) and was already shown in the summary — the comparison threw it away. |
| B9 | `RegionComparison`, `ShareExportBar`, and parts of `RegionRanking` still used raw `slate-*` / `sky-*` / `amber-*` / `emerald-*` utilities. | The foundation milestone introduced semantic tokens; these call sites had not been migrated, so the screen mixed two color systems. |

## 2. The layout that replaced it

```text
Application bar (shared shell — unchanged)
└── 지역 부담 workspace  (<main>, one row at md+)
    ├── control column  <aside>, 384px, the ONE desktop scroll container
    │   ├── PageHeader        지역 부담 + scope line     (the view's single <h1>)
    │   ├── ModeOrientation   task line                 (unchanged, follows the h1)
    │   ├── 선택한 지역        region · value · [현재 지표 | 자료 기준] · source · status
    │   ├── 지역 조회          native <select> of every region on the active geometry
    │   ├── 지역 지표 선택      3 fieldsets → 11 radios
    │   ├── 지역 비교          searchable combobox, chips, value table
    │   ├── 값이 높은·낮은 지역  scope segmented control, top-N, two ranked lists
    │   ├── 공유 · 내보내기     link copy, ranking CSV, comparison CSV, report
    │   ├── 출처와 계산 방법     (disclosure — mobile only; force-open at md+)
    │   └── 시설 위치 표시      (disclosure — mobile only; force-open at md+)
    └── map workspace  .map-pane, fills the remaining width AND the viewport height
        ├── MapView (one instance, direct child of .map-pane)
        ├── top-left overlay stack   wetland layer control
        └── bottom overlay column    floating legend
                                     └── insight strip  [해석] [주의] [자료 기준·출처]
```

Section order follows the reading order the screen is meant to support: *what am I
looking at* → *change the region* → *change the metric* → *compare* → *rank* →
*take it away*. The comparison now precedes the ranking (it was the other way
round), because comparison is the narrower, more deliberate act and the ranking is
the long scrolling list that ends the analysis block.

### The map insight, and why it floats — and is now collapsed by default

**Follow-up (`feat/collapsible-map-insights`).** The strip described below was
originally always expanded. It is now a native `<details>` disclosure that arrives
**closed**, behind a compact bar at the map's bottom-right:

```text
[ 해석 · 주의 · 출처 보기 ▾ ]
```

Nothing was removed, reworded, reimplemented, or moved. Opening it reveals the same
three groups, in the same order, with the same served strings. See §12 for the whole
change; the paragraphs immediately below still describe why it floats at all, which
did not change.

### Why it floats

The strip is an **overlay inside the map workspace**, not a band below the map.
That is forced, not stylistic: `regression-contract.md` §4 and three separate e2e
specs assert that the map reaches the viewport bottom with nothing beneath it. An
in-flow strip would shorten the canvas and break all of them.

The legend and the strip are children of **one bottom-anchored flex column**
(`absolute bottom-8 left-2 right-2 … flex flex-col items-start gap-2`) rather than
two separately-anchored cards. Two `bottom-*` offsets would have collided the
moment either grew a line of Korean text at a narrower width; stacking them makes
non-collision structural. `MapLegendOverlay` therefore no longer carries its own
`absolute bottom-8 left-2` — the page owns overlay placement, which it already did
for the top-left layer controls. In every non-equity branch the column holds only
the legend, so the legend renders exactly where it did before.

The strip renders at `lg` (≥1024px) and up — the minimum supported width — and not
below it. Nothing in it is mandatory-only-there: the reference period, the source
lines, and the no-data wording all appear in the sidebar as well.

## 3. Components

New, under `frontend/src/components/equity/` — all presentational, none holding
analytical state:

| Component | Replaces | Owns |
| --- | --- | --- |
| `EquityRegionSummary` | the two former summary cards + the page-local `RegionSummary()` | region name, served value, the 현재 지표 / 자료 기준 pair, one provenance list, the `DataStatusBadge` |
| `EquityRegionPicker` | the `<select>` formerly nested in the summary | nothing — it is a controlled native `<select>` |
| `EquityMetricSelector` | the inline `METRIC_GROUPS.map(…)` block | nothing — 3 fieldsets, 11 radios, one `onSelectMetric` |
| `EquityMapInsightStrip` | — (new) | nothing — renders passed-in strings only |

Shared primitives adopted: `PageHeader` (already in use), `DataStatusBadge` (new
here), `InfoBanner` (the strip's 주의 block, and the share bar's restored-link
warning), `SegmentedControl` (the ranking scope filter).

Deliberately **not** used:

* `KpiCard` — the metric name and the region value both carry contracted
  typography (`text-base font-semibold` for the metric name, a warn-toned string
  for an unavailable value) that `KpiCard`'s fixed `text-xl` / `text-ink-muted`
  treatment would change. One `KpiCard` beside two hand-built cells would have
  looked accidental, so the summary's KPI pair is built inline against the same
  tokens.
* `SearchableRegionPicker` — it is the established picker for the facility-cost
  setup flow, not for this one. The equity region control is contracted as a
  native `<select>` named 지역 선택, and swapping a working native control for a
  custom one trades platform keyboard behaviour for styling.
* `Chip` — `RegionComparison`'s chip carries **two** actions (select on map,
  remove from comparison); `Chip` models one. Its markup and test IDs are kept.
* An `EquitySidebar` wrapper — the `<aside>` is shared with 후보지 분석, so
  wrapping only the equity fragment would have taken ~20 props to move one JSX
  block. The four section components are the useful extraction boundary.
* A second state store. `page.tsx` still owns `metricKey`, `selectedRegionCode`,
  `comparison`, `scope`, `topN`, and the URL mirror; every new component receives
  values and callbacks.

`page.tsx` is **126 lines shorter** (+142 / −268) and gained no new state, effect,
or memo beyond one derived constant (`metricDataStatus`, below).

## 4. Existing data reused — nothing new was fetched or computed

| Surface | Source |
| --- | --- |
| region name, value, availability | `buildRegionSelection` → `formatRegionMetricDisplay` (unchanged) |
| metric label, unit | `METRICS` / the active envelope's `unit` (unchanged) |
| reference period | `metricReferencePeriod` (already derived for the map tooltip) |
| source lines | `metricProvenance` (already derived) |
| ranking | `rankRegions` (lib/ranking.ts) — called once, in `RegionRanking`, as before |
| comparison values | `resolveComparisonValue` (unchanged, plus the served reason) |
| comparison unavailable reason | `regionUnavailableReasonLabel(feature.properties.unavailable_reason)` — the same property the map popup and the summary already read |
| data status | `metric.dataset` |

`metricDataStatus` is the one new derived value. It is a **relabelling**, not a
judgement: `waste-per-capita` and `facility-burden` are computed from two official
inputs — exactly what `DerivedPanel` already says in prose — so they render as
`계산값`; `population` and `waste-statistics` are served as published, so they
render as `공식 값`. It affects no value, rank, break, or color.

No new API call was added. No statistic was invented to fill a card: when
`metricReferencePeriod` is empty the 자료 기준 cell is **omitted**, leaving a
one-item grid, rather than being padded to a 2×2.

## 5. Behaviour preserved

Verified by the existing suite, which passes unchanged — 973 pre-existing unit
assertions (994 total with this milestone's 21) and 318 pre-existing e2e
assertions (348 total with this milestone's 30):

* all 11 metric radios, their keys, their labels, their API requests;
* exactly three `<fieldset>`/`<legend>` groups with the frozen legend strings;
* map click → selection, `<select>` → selection, ranking row → selection, all
  driving the one `selectedRegionCode`;
* comparison add/remove, the 3-region maximum, its CSV and report rows;
* URL encoding, restoration, `v=1`, and `history.replaceState` mirroring;
* ranking order, ties, top-N, scope, and the excluded-count line;
* number formatting, reference-period display, provenance display;
* CSV export, report preview, shareable-link copy;
* one `MapView`, one `<main id="main-content">`, one `<h1>`, one navigation;
* the exact top-navigation labels;
* the `.map-pane` height chain and the sub-1024 responsive contract.

The `<h1>` text, its scope description
(`서울 · 인천 · 경기 공공자료로 보는 지역 부담과 후보지`), and the orientation line
are unchanged — the description was **not** rewritten, because
`regression-contract.md` §10 preserves that exact string and `MODE_ORIENTATION`
already carries the task sentence beneath it.

## 6. Missing data

The rule is unchanged and now stated in three places instead of one:

1. **The value.** A region with no served value renders
   `selection.metricDisplay`, i.e. `데이터 없음 — <served reason>` (or
   `데이터 없음 (no served value)` when the source attached none). Never `0`,
   never `-`, never a placeholder.
2. **The status.** `DataStatusBadge` switches to `missing`, whose label is the
   word `자료 없음` and whose color is the neutral `--color-no-data` gray — never a
   pale step of the analytical ramp, which would read as "a very low value".
3. **The comparison.** A region whose value is unavailable keeps its chip and its
   row and now shows the served reason beneath `자료 없음`. It is never silently
   dropped from the comparison.
4. **The strip.** `자료 없음은 0이 아니고, 기준 시점이 다른 값은 직접 비교할 수
   없습니다.` — standing text, next to the map.

The ranking's `값이 없어 제외한 지역 N개(0으로 채우지 않음)` line is unchanged, and
the legend keeps its explicit `데이터 없음` swatch.

## 7. Accessibility decisions

* **One `role="status"` per announcement.** The metric block keeps its live region
  and still wraps *only* the metric name and unit, so a radio change announces one
  short phrase; the provenance list is deliberately outside it. The region block
  keeps its own `role="status"`.
* **No `role="alert"` anywhere on this screen.** The strip's 주의 block is standing
  explanatory content, so it is a plain `InfoBanner` with no role. `role="alert"`
  remains reserved for the copy-failure message, which is a genuine, actionable
  error.
* **Nothing is communicated by color alone.** The selected metric row carries the
  native `checked` radio + a heavier weight + a stronger border alongside the tint;
  a selected ranking row carries `aria-current="true"` + a ✓ glyph + weight +
  border; every data status carries a text label; the caution block carries the
  word 주의.
* **Native controls kept native.** The region picker stays a `<select>`, the
  metric groups stay radios in one `name="metric"` group (so arrow keys still
  traverse all eleven), the scope filter stays `<button aria-pressed>`, and no
  `role="tab"`/`role="radiogroup"` was introduced that would promise roving focus
  the app does not implement.
* **Target size.** The clear, scope, top-N, and export controls are all ≥36px tall
  (`.wep-btn-quiet` / `.wep-segment` `min-height: 2.25rem`); metric rows are ≥32px.
* **Nothing mandatory behind a disclosure.** The reference period, the source
  lines, and the data status all render in open content at desktop.
* **The map's text alternative is unchanged**, and its description still points at
  the 선택한 지역 summary, which still exists under that name.

## 8. Viewport behaviour

Measured with `mockEquityBackend`, in Chrome:

| Viewport | Sidebar | Map (px) | Map bottom | Strip |
| --- | --- | --- | --- | --- |
| 1024 × 768 | 384, scrolls locally | 640 × 703 | 768 | 173px — 25% of the map |
| 1280 × 800 | 384, scrolls locally | 896 × 735 | 800 | 154px — 21% |
| 1440 × 900 | 384, scrolls locally | 1056 × 835 | 900 | 135px — 16% |
| 1920 × 1080 | 384, scrolls locally | 1536 × 1015 | 1080 | 130px — 13% |

At every one of them: the document does not scroll in either axis, the sidebar is
the only vertical scroll container, the map's bottom edge is within 6px of the
viewport bottom, and the strip covers less than a third of the map's height and
never overlaps the legend or the OpenStreetMap attribution.

Below 1024px the strip is not rendered and the pre-existing responsive behaviour
(stacked sidebar above a 60vh map, disclosures collapsed, legend collapsed) is
untouched — this milestone added no mobile-specific workflow, per its scope.

## 9. Tests added

`frontend/src/app/page.equityDashboard.test.tsx` — 21 assertions (jsdom, MapLibre
stubbed, backend mocked):

* one `<h1>` carrying the area label; the scope line and the orientation, in order;
* the summary's empty prompt, region name, served value, unit, reference period,
  source lines, and status badge;
* a missing value rendering its served reason with a `missing` status and no zero;
* `reported` vs `derived` status by metric family;
* 11 radios / 3 fieldsets / exactly one checked; no select, tabs, or disclosure
  substituted; the selected row marked by weight and border, not color alone;
* one metric change propagating to the summary, the legend, and the strip;
* ranking-row → selection → picker sync, and map-click → the same one selection;
* the ranking basis carrying metric, unit, and reference period;
* comparison add/remove leaving the ranking untouched;
* one map, one legend, one strip; the map still the direct child of `.map-pane`;
* the strip's neutral interpretation, standing caution, served provenance, and its
  route to 데이터·출처; no `role="alert"` in it;
* exactly one of each selection control, one `<main>`, one nav, one `<aside>`;
* the sidebar's `md:overflow-y-auto md:w-96 md:flex-none` scroll contract.

`frontend/e2e/equityDashboard.spec.ts` — 30 assertions at 1024×768, 1280×800,
1440×900, and 1920×1080, self-mocked, structure and geometry only:

* no horizontal overflow, no page-level vertical scroll, sidebar scrolls locally
  and moves without moving the page;
* the map reaches the viewport bottom, keeps >75% of the viewport height and
  >400px of width, and the strip covers less than a third of it;
* the legend sits directly above the strip with no overlap, inside the map, and
  the attribution stays uncovered;
* one map / one `<h1>` / one navigation / one `<main>`; three fieldsets; all
  eleven radios individually reachable;
* the header, the summary, the reference period, and the source lines visible
  without scrolling;
* metric selection updating summary + legend + strip + the versioned URL;
* region selection synchronising picker, ranking (`aria-current`), and summary,
  and clearing back to the explicit empty prompt;
* comparison add/remove and the three real export actions;
* the strip's source button routing to 데이터·출처, which mounts no map.

Deliberately no pixel snapshots — the repository has no visual-regression
infrastructure (`baseline.md` §7).

## 10. One intentional test change

`e2e/citizenFlows.spec.ts` locates the navigation tabs with
`getByRole("button", { name: "데이터·출처" })` **without** `exact: true`, i.e. by
substring. The strip's source action was first labelled `데이터·출처 화면 열기`,
which made that locator ambiguous. The **component** was renamed to
`출처 자세히 보기` rather than the test being relaxed: the nav label is a frozen
string (`regression-contract.md` §1) and a second control containing it is a real
ambiguity for a screen-reader user too, not just for Playwright. No test
expectation was changed anywhere in this milestone.

## 11. Deferred

* **`FacilityCostDashboard`, `LandfillDashboard`, `TransparencyDashboard`,
  `SuitabilityPanel`** keep their raw `slate-*`/`amber-*` utilities. They belong to
  their own milestones; this one migrated only the components the equity screen
  renders.
* **`DerivedPanel` / `SourcePanel`** (inside 출처와 계산 방법) were not restyled.
  They are shared with 후보지 분석's data surfaces and carry the long-form method
  text; converting them is a docs-and-terminology job, not a layout one.
* **Two `data-testid="reference-period"` nodes** can co-exist for the two
  facility-burden metrics, because `useDerivedInfo` and `useSourceInfo` both return
  non-null there. Pre-existing, untouched, and not currently queried by any test —
  worth collapsing when `SourcePanel` is next opened.
* **A metric's own `caveat`** (five of the eleven metrics have one) is shown in
  `DerivedPanel`, not in the strip's 주의 block. The strip carries only fixed-length
  standing limitations so its height stays bounded; a per-metric caveat of ~90
  Korean characters would have made it 40% taller at 1024px.
* **Mobile.** No drawer, bottom sheet, tab bar, or KPI carousel was built; the
  existing sub-1024 behaviour is preserved as-is.
* **Deployment.** This milestone is not deployed. OCI currently runs `39413a3`
  plus the later land-cover release; the UI refresh has not been shipped there.

## 12. Follow-up — the insight is collapsed by default

Shipped on `feat/collapsible-map-insights`, together with the identical change to
`suitability/SuitabilityMapInsightStrip` (see `suitability-dashboard.md` §14). The
two overlays now share one label, one CSS class, and one interaction.

### Before → after

| | Before | After |
| --- | --- | --- |
| Default state | always expanded | **closed** |
| Collapsed footprint | — | one bar, **163 × 42 px**, bottom-right |
| Expanded footprint | full map width × ~176 px, permanently | ≤ **832 px** wide × ~200 px, only while opened |
| Share of the 1440×900 map covered by default | ~19% of the canvas width-band | **<1%** |
| Position | bottom band, left-aligned, full width | bottom band, **right-aligned** |
| Element | `<section>` | `<details>` + `<summary>` |

The compact label is exactly `해석 · 주의 · 출처 보기`, frozen in
`lib/glossary.ts` as `MAP_INSIGHT_SUMMARY_LABEL` — one constant, shared by both map
overlays, so the two bars cannot drift apart. A `▾` chevron sits at the right of the
bar and rotates 180° on `[open]`; it is `aria-hidden`, so the accessible name equals
the printed label exactly.

### Content preserved

Every string, test ID, and behaviour survives the change untouched:

* 해석 — the metric label, its unit, and the relative-shading sentence
  (`insight-interpretation`);
* 주의 — the standing `InfoBanner`, still `tone="warning"`, still **not**
  `role="alert"` (`insight-caution`);
* 자료 기준·출처 — the `DataStatusBadge`, the served reference period
  (`insight-reference-period`), the served source lines (`insight-provenance`), and
  the `출처 자세히 보기` action (`insight-open-sources`);
* the "자료 없음은 0이 아니고…" caveat, verbatim;
* the omit-rather-than-pad rule: no reference-period cell and no provenance list
  when nothing was served.

Nothing was duplicated. The sidebar remains the other home for the same facts, as
before, and no second provenance implementation was created.

### Structure

It is still the **second child of the same bottom-anchored overlay column** as the
legend (`page.tsx`) — only its cross-axis alignment changed, from full-width to
`justify-end`. Because the column is anchored to `bottom`, opening the disclosure
grows the card **upward** and lifts the legend with it, so the two can never overlap
in either state. `regression-contract.md` §4 is therefore unchanged.

### Pointer-event behaviour

The full-width positioning row stays `pointer-events-none`; only the `<details>`
itself is `pointer-events-auto`. Verified by hit testing, not by inspection: at every
supported viewport, `document.elementFromPoint` returns the map canvas immediately to
the left of the bar and at the map centre, in **both** the closed and the open state,
and a real `mousedown`+`mousemove`+`mouseup` drag lands on `.maplibregl-canvas-container`
with nothing else in the capture log. No test anywhere uses `{ force: true }`.

### Viewport behaviour

* **Desktop collapsed** — a 163 × 42 px bar at the bottom-right, inside the map,
  above the OSM attribution, clear of the legend, of the MapLibre zoom controls
  (top-right), of the top-left layer stack, and of the sidebar.
* **Desktop expanded** — a card capped at 832 px, narrowed by the column to the
  available map width at 1024 px (616 px there), keeping the existing
  `grid-cols-1 lg:grid-cols-3` layout, growing upward, never scrolling internally.
* **Below 1024 px** — unchanged: it does not render at all. Nothing in it is
  mandatory-only-there; the sidebar carries the same reference period, the same
  source lines, and the same no-data wording.

### Accessibility

Native `<details>`/`<summary>`, so Enter and Space toggle it, the expanded state is
exposed by the platform, the closed body is out of the tab order, focus is never
trapped, and the global `:focus-visible` ring applies unmodified. The named region
(`aria-label="지도 해석 안내"`) moved from the outer element onto the disclosure body,
where it describes exactly the content being revealed — a collapsed `<details>`
exposes nothing, so a permanently-named empty landmark would have lied. No
`aria-label` sits on the summary: it would replace the visible label in the
accessible name. No live region was added; a `role="status"` inside a collapsed
`<details>` would silently stop announcing.

### Tests added

* `components/equity/EquityMapInsightStrip.test.tsx` — 9 new assertions: one native
  disclosure, the exact label, closed on first paint, containment of every group,
  open → each group, close → re-gated, served values verbatim, omit-when-absent, no
  duplicate and no live region.
* `app/page.equityDashboard.test.tsx` — one new integration test (mounted collapsed,
  one `details.map-insight`, not the legend's class) plus two existing tests updated
  to open the disclosure before reading it.
* `e2e/mapInsightDisclosure.spec.ts` (new, 60 tests) — geometry at 1024×768,
  1280×800, 1440×900, 1920×1080; behaviour, keyboard, hit testing, drag, and
  no-state-change at 1440×900; narrow regression at 390×844 and 768×1024.
* `e2e/equityDashboard.spec.ts` — open-state geometry added; two assertions updated
  for the collapsed default.

### Deployment scope

Frontend only. No backend, database, migration, ingestion, Docker, Compose, Caddy,
or infrastructure change, and no data change of any kind.
