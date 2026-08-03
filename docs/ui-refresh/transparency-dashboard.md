# UI refresh — 데이터·출처 (transparency) dashboard

The sixth and final per-area milestone of the civic-dashboard refresh. The first
(`feat/civic-dashboard-foundation`, merged as `a7ce49e`) established the tokens, the
shell, the navigation, and the shared primitives; the second
(`feat/equity-dashboard-refresh`, `8c16759`) rebuilt **지역 부담**; the third
(`feat/suitability-dashboard-refresh`, `68eb2d3`) rebuilt 후보지 점수 and
가중치 바꿔보기; the fourth (`feat/facility-cost-dashboard-refresh`, `db96118`) rebuilt
비용 살펴보기; the fifth (`feat/landfill-dashboard-refresh`, `28bdb6a`) rebuilt
매립지 현황. This milestone is:

```text
데이터·출처      mode=transparency
```

It is presentation and information-architecture work. **No endpoint, request
parameter, response field, served value, count, reference period, snapshot,
availability rule, freshness classification, filter option, ordering, link target,
page size, or URL key was changed** — see §7 and §8.

Everything below was read out of the repository or measured in a real browser at the
stated viewport. Nothing here is aspirational.

## 1. The before-state, and what was wrong with it

Phase 6 had already done the hard part. The catalog, its search, its two filters, the
five distinct outcomes, the Korean rendering of the registry, the demotion of
`freshness_status` out of the citizen surface, and the rule that an unfetched count
is never printed as `0` were all in place and all tested. **The data contract needed
no repair, and none was made.** What was left was structure, naming, and one question
the screen could not answer.

| # | Before | Why it was a problem |
| --- | --- | --- |
| T-A | The view rendered its **own** `<header>` + `<h1 class="text-xl sm:text-2xl">`, while the other four refreshed areas had moved to the shared `PageHeader`. | The single-`h1` rule was enforced by a local convention here and by a shared primitive everywhere else, and this page's title was visibly larger than every other area's. |
| T-B | `TransparencyDashboard.tsx` defined a **private `SectionCard`** — a `.wep-card` with a bare `<h2>` and no `aria-labelledby`, shadowing `components/ui/SectionCard.tsx` by the same name. | Four of the page's five card sections were **unnamed regions**: a screen-reader user enumerating the page heard a flat run of text instead of 출처 목록 / 자료별 기준 기간 / 현재 제공되지 않는 자료 / 시설 지도 표시 현황 / 계산 방법과 기술 정보. It was also exactly the duplicate-primitive drift the shared component exists to prevent. |
| T-C | The overview's only heading was `<h2 class="sr-only">자료 개요</h2>`. | The one block on the page a sighted reader could not name. Four counts with no stated relationship to each other. |
| T-D | The active filters were reported only as the suffix `(검색·필터 적용)` on the result count. | It said that filtering was **on**, never **what** it was filtering by. After scrolling into a catalog of eleven cards there was no way to answer "why am I seeing three of these?" without scrolling back to the controls. |
| T-E | 값 구분 in the dataset table was a **hand-rolled pill** (`bg-primary-soft` / `bg-surface-muted`), and no `DataStatusBadge` appeared anywhere on the page. | The reported-versus-derived distinction is this screen's entire subject, and it was carried by a locally-invented tint on one table while the rest of the application had a shared semantic badge for exactly that. |
| T-F | An absent reference period, a failed freshness lookup, and a switched-off registry row were all **the same weight of plain gray text** in the same `<dl>`. | Three different facts — "no period was served", "the lookup failed", "this source is registered but unused" — read as one undifferentiated shrug. |
| T-G | 현재 제공되지 않는 자료 held **two** gaps: the cost exclusions and the unmapped facilities. | The registry's own biggest gap — sources for which no reference period was served — was counted in the overview KPI and then never named as a gap, even though the KPI caption already had to explain that it does not mean the data is absent. |
| T-H | Table headers were plain `<th>` with no `scope`, and every body cell was a `<td>`. | A screen reader announced "주소 정제 실패" with no way to know which facility it belonged to. |
| T-I | Pagination buttons were named 이전 / 다음 only. | Out of context — which is how a screen-reader user scanning by name meets them — those name no object. |

## 2. The layout that replaced it

```text
Application bar + 4-tab navigation      (shared chrome — rendered once, unchanged)
└── 데이터·출처 workspace  (<main>, full width, map-free, normal document scrolling)
    └── max-w-screen-2xl content column
        ├── PageHeader          데이터와 출처 + summary line + mode-orientation
        ├── 알림 · 이 화면을 읽는 방법   InfoBanner tone="info" — the ONE banner
        ├── 자료 현황 요약        h2 + 4 KPI cards + the freshness live region
        ├── 출처 목록            SectionCard
        │   ├── 출처 검색 · 자료 분야 · 갱신 주기   one desktop control row
        │   ├── 현재 조건        active conditions as chips + result count   [new]
        │   ├── the source catalog (2 / 3 / 4 columns)
        │   └── 내륙습지 · 토지피복 exposure notes            (unchanged)
        ├── 자료별 기준 기간과 표시 개수  SectionCard  → the 6-column table
        ├── 현재 제공되지 않는 자료      SectionCard  → 3 gaps                [3rd new]
        ├── 시설 지도 표시 현황          SectionCard  → counts, breakdown, unmapped list
        └── 계산 방법과 기술 정보        SectionCard  → 4 disclosures          [1 new]
```

The section order is unchanged and is **frozen by test**:
`e2e/phase6DataSourcesDashboard.spec.ts` compares the document positions of
`transparency-notice` → `transparency-overview` → `transparency-sources` →
`transparency-datasets` → `transparency-gaps`. It also happens to be the order the
questions arrive in: *how do I read this* → *how much is here* → *what exactly is
here* → *what period does each figure cover* → *what is missing* → *which records
could not be placed* → *how was it calculated and which version produced it*.

### Why the catalog stayed cards and did not become a table

Eleven records with heterogeneous metadata: some have a reference period, some do
not; some have a collection timestamp, some do not; some have an institutional link,
some do not; one is switched off. A uniform table would have needed an empty cell or
a dash in every one of those columns for most rows — and a dash for "not served" is
the exact thing this screen exists to avoid. Cards let a record carry only the facts
it actually has.

### Why 현재 조건 is a strip and not a card

It restates the controls immediately above it. A separate card would cost a card plus
a grid gap for no informational gain, and would push the catalog's first row below the
fold at the minimum supported width — measured, see §10.

## 3. Components

New, under `frontend/src/components/transparency/` — all presentational, none holding
workflow state, none holding a second copy of the registry:

| Component | Replaces | Owns |
| --- | --- | --- |
| `shared.ts` | the constants and pure helpers at the top of `TransparencyDashboard.tsx` | copy, `VALUE_KIND_LABELS`, `labelFor`, the two enum registries, `UNMAPPED_PAGE_SIZE`, `buildDatasetRows` |
| `TransparencyNotice` | the inline standing `InfoBanner` | nothing |
| `SourceOverview` | the `sr-only`-titled overview `<section>` | nothing |
| `SourceFilterPanel` | the inline control row | nothing — the controls plus the **new** 현재 조건 summary |
| `SourceCatalog` | the three-outcome branch inside 출처 목록 | nothing |
| `SourceCatalogItem` | `SourceCard` | nothing |
| `DatasetPeriodTable` | the inline 자료별 기준 기간 table | nothing |
| `KnownDataGaps` | the inline 2-column gaps grid | nothing |
| `FacilityMappingPanel` | the inline mapping branch | nothing |
| `UnmappedFacilityTable` | the inline unmapped table | nothing |
| `UnmappedPagination` | `UnmappedPagination` (moved verbatim, plus `aria-label`s) | nothing |
| `TransparencyMethodology` | the inline disclosure stack | nothing |

`TransparencyDashboard.tsx` went **1233 → 351 lines** because the JSX moved, not
because behaviour did. It still owns every piece of state it owned before —
`freshness`, `freshnessState`, `policy`, `run`, `costOptions`, `mapping`,
`mappingError`, `page`, `knownUnmappedTotal`, `query`, `areaFilter`,
`frequencyFilter`, the three `useId`s, and the search `ref` — plus the two effects,
the four `useMemo` derivations, and the two clear handlers. Nothing moved to a child;
nothing was duplicated in one.

Shared primitives adopted: `PageHeader` (the `<h1>`), `SectionCard` (all five card
sections), `DataStatusBadge` (§5), and `Chip` (the 현재 조건 tokens), plus the
`InfoBanner`, `Accordion`, `EmptyState`, `KpiCard`, and `Skeleton` already in use.

Deliberately **not** used:

* **`FilterChip` in 현재 조건.** A `FilterChip` *is a control* (`<button aria-pressed>`).
  The summary must report state, not become a second way to change it — and a
  focusable element between the search field and 검색어 지우기 would break the Tab
  order `phase6DataSourcesDashboard.spec.ts` walks. Both suites assert the summary
  contains zero `button`, `input`, and `select` elements.
* **`SegmentedControl` for 자료 분야.** Up to eight subject areas plus 전체 — far past
  the 2–4 the primitive is for — and it would create a second representation of a
  filter that already has a working native `<select>`.
* **`Accordion` for the per-card 기술 정보.** `Accordion` takes no arbitrary
  attributes, and the card disclosure must carry `[data-diagnostic]` — that attribute
  is what the terminology audit and three e2e specs strip before scanning the primary
  surface. It stays a native `<details data-diagnostic>`, which the milestone's rules
  explicitly permit.
* **A second source registry, a second filter state, a second request, or any
  classification logic in a visual component.**

**No shared primitive was changed by this milestone.** `PageHeader`, `SectionCard`,
`KpiCard`, `DataStatusBadge`, `InfoBanner`, `Chip`, `EmptyState`, `Accordion`, and
`Skeleton` are untouched; this view uses only props they already had.

## 4. Search, filters, and the current-condition summary — preserved exactly

| Control | Test id | Options | Default |
| --- | --- | --- | --- |
| 출처 검색 | `transparency-search` | native `type="search"`, matched against `sourceSearchText` | `""` |
| 검색어 지우기 | `transparency-search-clear` | rendered only while a query exists | — |
| 자료 분야 | `transparency-filter-category` | 전체 + the areas **present in the served records**, in `SOURCE_AREA_ORDER` | `all` |
| 갱신 주기 | `transparency-filter-frequency` | 전체 + the cadences **present in the served records**, Korean-collated | `all` |

Unchanged behaviour that is easy to break and was not: matching is
case-insensitive and covers the Korean name, the organisation, the `source_id`, the
area label, the frequency label, and both served English strings; filtering never
re-orders the survivors (`filterDisplaySources` preserves input order); an option is
never offered that no record could satisfy; both clear paths return focus to the
search field, because both controls unmount themselves on activation and focus would
otherwise fall to `<body>`; and none of the three is written to the URL.

**New:** `transparency-filter-summary` states the active conditions as `Chip`s —
`검색어 · 반입수수료`, `자료 분야 · 수도권매립지`, `갱신 주기 · 월간` — or, when nothing
is set, the sentence *검색어와 필터를 적용하지 않았습니다. 등록된 출처를 모두
표시합니다.* The result count keeps its exact previous wording and its `role="status"`
and now lives inside that strip. The whole strip is absent for an empty registry: a
condition summary over zero records would imply a filter that is not there.

## 5. Provenance, statuses, and the four data states

`DataStatusBadge` is now used in exactly three places, and only where a **value** is
or is not there. A source is never graded, scored, ranked, or given a confidence — a
unit test scans the rendered catalog for 점수 / 등급 / 순위 / 신뢰도 / `%` and asserts
all five absent.

| Surface | Badge | Why |
| --- | --- | --- |
| 값 구분, reported rows (인구, 폐기물 발생량, 처리시설) | `reported` — label `직접 보고값` | the agency reported the figure itself |
| 값 구분, 1인당 발생량 | `derived` — label `공식 자료 기반 계산값` | this platform's arithmetic over two official inputs, both of which the row names |
| 기준 기간 with no served period | `missing` — label `기준 기간 정보 없음` | no value was served; neutral no-data gray, never amber |
| `enabled: false` | `excluded` — label `사용 안 함` | registered but deliberately outside current use |

Two decisions inside that table are deliberate and are recorded because they look
arbitrary:

1. **The wording did not change.** `직접 보고값` / `공식 자료 기반 계산값` /
   `기준 기간 정보 없음` / `사용 안 함` are passed to the badge as its `label`
   override, so the page adopts the shared semantic (teal = reported, blue = derived,
   gray = missing, outlined = excluded) **without** altering a single citizen-facing
   string. Three suites compare those strings.
2. **A served reference period gets no badge, and neither does a failed lookup.** A
   period that exists is a value; badging it would state a provenance for a fact that
   has none. A freshness request that failed is a statement about the *request*, not
   about the data, so it keeps its own sentence — *기준 기간을 불러오지 못했습니다* —
   and must not borrow the badge that means "no value was served". Both suites assert
   `transparency-source-noperiod` is absent in the failure state.

The five outcomes stay distinct, and only one of them is an alert:

* **loading** — `transparency-mapping-loading`, `role="status"`, beside an
  `aria-hidden` skeleton that renders no digits and no names;
* **catalog** — the records;
* **registry served no sources** — `EmptyState`, no `role`, no invented rows, no
  controls, no count;
* **search matched nothing** — a different `EmptyState`, no `role`, with a recovery
  action, stating explicitly that no match does not mean no data;
* **a genuine request failure** — `InfoBanner tone="error"` + `role="alert"`, the raw
  backend code demoted to a `[data-diagnostic]` line, no stale rows or counts beside
  it, and the pager still operable.

An **official measured zero** stays a zero: `without_address: 0` renders as `0` in its
own KPI card and carries no badge at all. A unit test and an e2e test both scope that
assertion to that one card's `<dd>`, because asserting `"0"` against the whole
120/90/30/0 grid would be satisfied by the `120` alone.

## 6. Known gaps — the third one is new

`현재 제공되지 않는 자료` now holds three genuinely different kinds of gap, side by
side, none of them an error:

| Gap | Test id | Source of the statement |
| --- | --- | --- |
| 비용 계산에 넣지 못한 항목 | `transparency-cost` | rendered from `MISSING_COMPONENT_META`, so this list and the cost dashboard cannot drift into two wordings (they already had, once) |
| 지도에 표시하지 못한 시설 | `transparency-gap-unmapped` | the served `total` / `without_map_location`, with *집계에는 그대로 포함됩니다* |
| 기준 기간을 확인하지 못한 자료 | `transparency-gap-period` | `summarizeSources().total − .withReferencePeriod` — the same tested helper the overview KPI already uses |

The third is a **restatement of a count already on the page**, not a new fact, and it
is shown as a number only once the freshness join has resolved. While the join is in
flight it says *확인하는 중*; after it fails it says *0건이라는 뜻이 아닙니다* and
prints no figure at all. An e2e assertion cross-checks it against the overview KPI in
the same run (11 registered − 4 with a period = 7 without).

None of the three implies the data does not exist. The unmapped facilities are stated
to remain in every aggregate; the un-integrated cost components carry their served
explanations; and the sources with no period are explicitly *not* described as
sources that published nothing.

## 7. Existing analysis reused — nothing new was fetched or computed

| Surface | Source |
| --- | --- |
| the registry, the Korean renderings, the ordering | `buildDisplaySources` (`lib/dataSources.ts`, unchanged) |
| search matching | `sourceSearchText` + `filterDisplaySources` (unchanged) |
| filter option lists | `availableAreas` / `availableFrequencies` (unchanged) |
| the four overview counts | `summarizeSources` (unchanged) |
| link safety | `safeSourceUrl` — absolute `http(s)` only, never constructed (unchanged) |
| collection date | `collectionDate` + `COLLECTION_DATE_SUFFIX` — string-sliced, never `new Date()` (unchanged) |
| source attribution per dataset row | `organizationLabel` off each response's own `source_id` (unchanged) |
| cost-exclusion wording | `MISSING_COMPONENT_META` (`lib/glossary.ts`, unchanged) |
| error code → plain Korean | `plainError` (unchanged) |
| counts and category labels | `formatCount` / `FACILITY_CATEGORY_LABELS` (`lib/metrics.ts`, unchanged) |

The five requests (`fetchDataFreshness`, `fetchSuitabilityPolicy`,
`fetchSuitabilityLatestRun`, `fetchFacilityCostOptions`,
`fetchFacilityMappingTransparency`) fire with the same parameters, in the same
effects, with the same cancellation, the same page size of 25, and the same
success/failure handling. `lib/dataSources.ts` was **not modified by this milestone**.

## 8. Behaviour intentionally untouched

Unchanged: every source record, area classification, institution name, dataset name,
`source_id`, endpoint, snapshot, reference period, publication frequency, and
documentation URL; the rule that an unrecognised `source_id` keeps the served strings
verbatim and takes no invented Korean name; the demotion of `freshness_status` to a
diagnostic line, and the refusal to render it as `최신`; the retention of every served
English string inside the per-card disclosure; the version identifiers behind the
기술 정보 disclosure with `[data-diagnostic]`; the unmapped page size, page state, the
`unmapped.page === page` gate that stops one page's facilities rendering under
another's label, and the `knownUnmappedTotal` that keeps the pager operable through a
failure; the wetland and land-cover exposure notes with their exact served wording;
and the whole `role="alert"` / `role="status"` allocation.

No source fact is hard-coded in a presentational component, no URL is constructed, and
no classification that `lib/dataSources.ts` owns is re-derived downstream.

## 9. Accessibility decisions

* **One `<h1>`, one `<main>`, one navigation, zero maps, zero `<fieldset>`s, zero
  sub-view controls**, asserted at four viewports and in unit tests. The `<h1>` is now
  `PageHeader`'s, so "exactly one" is enforced by the shared primitive; its text
  `데이터와 출처` is unchanged and compared exactly by `civicShell.spec.ts`,
  `phase6DataSourcesDashboard.spec.ts`, and `terminology.audit.test.tsx`.
* **Every section is a named region.** All five card sections are `SectionCard`s with
  `aria-labelledby` pointing at their own `h2`; the overview is a `<section
  aria-labelledby>` with a **visible** `h2`. Heading levels run h1 → h2 (section) →
  h3 (block inside a section).
* **`role="alert"` is used exactly once**, for the mapping request failure. The
  standing notice, the 현재 조건 summary, the gap blocks, and every section header
  carry no live-region role. `transparency-result-count`,
  `transparency-freshness-status`, `transparency-mapping-loading`, and
  `transparency-unmapped-paging` stay `role="status"`, and **no live region sits
  inside a `<details>`** — a collapsed disclosure is hidden from the accessibility
  tree, so it must never be the only home for one. A unit test walks every live
  region and asserts it.
* **Native controls stayed native.** One `<input type="search">` and two `<select>`s,
  each with a visible associated `<label>`; native `<details>` disclosures; native
  `<button>`s for pagination and both clear actions; no `div` control anywhere.
* **Tables announce their structure.** Every table has a `<caption>`, `scope="col"` on
  every header cell, and a `<th scope="row">` leading every body row — so 주소 정제 실패
  is announced with the facility it belongs to. A unit test enumerates every table on
  the page and checks all three.
* **Pagination names its objects.** `aria-label="이전 페이지"` / `"다음 페이지"`, with
  the short visible labels kept. It is deliberately **not** wrapped in a `<nav>`: the
  shell owns the application's single navigation landmark.
* **No state is colour-only.** Every `DataStatusBadge` renders its text label, and
  `missing` uses the neutral `--color-no-data` gray rather than a pale ramp step or
  amber.
* **Focus is never dropped.** Both clear controls unmount themselves on activation and
  both return focus to the search field.

## 10. Viewport behaviour

Measured in Chrome with the mocked backend, on the populated screen, before any
scrolling:

| Viewport | Page h-overflow | Catalog columns | Catalog's first card | Nested v-scroll panes | Document scrolls |
| --- | --- | --- | --- | --- | --- |
| 1024 × 768 | none | 2 | top 674 of 768 | none | yes |
| 1280 × 800 | none | 3 | top 658 of 800 | none | yes |
| 1440 × 900 | none | 3 | top 658 of 900 | none | yes |
| 1920 × 1080 | none | 4 | top 658 of 1080 | none | yes |

Two layout decisions came out of those measurements:

1. **The overview KPI grid is `lg:grid-cols-4`, not `xl:grid-cols-4`.** At 1024 the
   2×2 grid cost ~145px of the first viewport and pushed the catalog's first card to
   772 — below the fold — for no informational gain. Four across at 1024 puts it at
   674.
2. **The catalog is `md:2 / xl:3 / 2xl:4`.** At 1920 the content column is capped at
   `max-w-screen-2xl` (1536px), so three columns left each card 500px wide with the
   metadata rag unchanged; four columns at ~367px each still clear the 300px
   readability floor the new spec asserts.

The two tables keep their own `overflow-x-auto` wrappers (min-widths 720px and 680px)
as a bounded fallback. At every desktop width above they fit and do not actually
scroll; below 720/680 they do, and `phase6DataSourcesDashboard.spec.ts` asserts the
scroll is real rather than nominal at 390/430px. The new spec enumerates every
horizontally-scrollable element in the dashboard subtree and asserts that **all** of
them are table wrappers, and that no element scrolls vertically inside the page.

Sub-1024 behaviour is preserved as-is: the Phase 6 spec still runs at 390×844,
430×932, and 768×1024 and passes unchanged. No mobile-specific work was done.

## 11. Tests

`frontend/src/components/TransparencyDashboard.test.tsx` — **79 tests, was 53. All 53
pre-existing assertions pass unmodified.** Added, in five new describes:

* the five card sections as named regions with `h2` accessible names, the overview's
  heading visible and no longer `sr-only`, the documented reading order, and no second
  `h1`, `fieldset`, result count, or live region;
* 현재 조건 stating the unfiltered case in words, naming the search term and both
  filters when they are set, containing zero controls, clearing back, holding the
  `role="status"` count outside every disclosure, and being absent entirely for an
  empty registry;
* the provenance badges — `reported` ×3 and `derived` ×1 in the dataset table with the
  exact previous wording, `missing` on an absent period with `wep-badge-missing` and
  *not* `wep-badge-caveat`, no badge on a served period, no badge on a failed lookup,
  `excluded` on a switched-off row with no badge on an enabled one, and no
  score/grade/rank/confidence/percentage anywhere in the catalog;
* the three gaps as three separate blocks with no alert among them, the
  no-period count read from the served records, no count at all while the join is
  unresolved, and no measured zero after it fails;
* table semantics (caption + `scope="col"` + `scope="row"` on every table), each
  table's overflow inside its own wrapper, every unmapped record kept with its
  recorded reason or the honest placeholder, and the pager's standalone accessible
  names and disabled boundary;
* the new 표시 용어 안내 disclosure defining every state label this screen uses,
  including that an absent period and a failed lookup are different states, and
  containing no currency claim.

`frontend/e2e/transparencyDashboard.spec.ts` — **new, 50 tests** (12 per viewport at
1024×768 / 1280×800 / 1440×900 / 1920×1080, plus 2 cross-view), self-mocked from
`phase6Fixtures.ts`, structure and geometry only:

* one map-free workspace with one `h1` / one `top-navigation` / one `mode-switch` /
  one `#main-content` / zero `map-container` / zero `aside` / zero
  `suitability-subviews` / zero `fieldset`, and all five regions named and reachable
  by ordinary scrolling;
* the document scrolling, no nested vertical scroll pane, and every horizontally
  scrollable element being a table wrapper;
* the catalog's column count per viewport, the section spanning the full content
  column, and every card clearing a 300px readability floor;
* 현재 조건 naming both filters and the search term, holding no control, and clearing;
* an official `0`, an absent period (`data-status="missing"`), and a failed freshness
  lookup as three different renderings;
* the three gaps agreeing with the mapping panel and the overview KPI on the same run;
* the unmapped table's caption / five `scope="col"` headers / two `scope="row"` rows /
  both reason branches, and the pager's disabled boundary;
* an empty unmapped list versus a failed page request, and an empty registry versus a
  failure;
* a source link as a real anchor with both `rel` tokens, and both disclosure layers
  opening from the keyboard alone;
* the cross-view map contract through a full round trip — 데이터·출처 (0) → 지역 부담
  (1) → 후보지 분석 (1) → 매립지 현황 (0) → 데이터·출처 (0) → 비용 살펴보기 (0) — with
  the chrome never doubling and the nav labels frozen;
* `?v=1&mode=transparency` restoring the area cold, the catalog state not leaking into
  another area, and the URL dropping the mode on the way out.

Unchanged and re-run green: `e2e/phase6DataSourcesDashboard.spec.ts` (**108, all
passing unmodified**), `e2e/phase6Review.spec.ts` (opt-in capture),
`e2e/citizenFlows.spec.ts`, `e2e/civicShell.spec.ts`, `e2e/desktopNavigation.spec.ts`,
`e2e/phase7FinalRegression.spec.ts`, `e2e/responsive.spec.ts`,
`e2e/integration.spec.ts`, `app/shell.test.tsx`, `app/accessibility.test.tsx`, and
`app/terminology.audit.test.tsx` — which between them own the cross-view contract (zero
maps in 데이터·출처, the frozen nav labels, the single skip-link target, and the
plain-Korean primary surface).

Deliberately no pixel snapshots — the repository has no visual-regression
infrastructure (`baseline.md` §7).

### One pre-existing failure reproduced, and it is not this milestone's

`e2e/facilityCostDashboard.spec.ts:126` at **1024×768** ("keeps the whole setup
workflow reachable, with the action on the first screen") failed once in the
full-suite run on this branch — `box.y + box.height` = **838** against a 768 viewport,
the same figure the landfill milestone recorded at `db96118`
(`landfill-dashboard.md` §10, flake 2).

It was measured on both branches:

* on this branch, it passes **26/26** when `e2e/facilityCostDashboard.spec.ts` is run
  alone, and failed **1 of 1** full-suite runs;
* on unmodified `main` at `28bdb6a`, the full suite was run **twice**: the first run
  passed 427/427, the second reproduced the **identical** failure — same file, same
  line, same 838-against-768 measurement.

So it fires on `main` too, at roughly the same rate, and only under four-worker load.

The root cause is already traced and written down: line 148 of that spec is
`await page.mouse.wheel(0, -2000)`, which dispatches the wheel event without waiting
for the scroll to settle, and the sticky rail is measured on the very next line. With
the page genuinely at the top, 비용 계산하기 does **not** fit above the fold at
1024×768. This milestone changes no facility-cost file, no shared primitive, and no
global CSS, and it deliberately did not touch either the spec or the layout: fixing it
means changing the 비용 살펴보기 setup layout or re-stating what
`facility-cost-dashboard.md` §14 promises at 1024×768, and both are 비용 살펴보기
product decisions belonging to the whole-application integration milestone.

## 12. Deliberately not built

* **A "which feature uses this dataset" field on each source card.** The registry
  carries no such column, and `lib/dataSources.ts` says so explicitly: `SourceArea`
  describes *what a dataset is about*, read off its own `dataset_name`, and
  deliberately does not claim which dashboard consumes it. Adding one would be
  inference presented as metadata. The question is answered at the dataset level
  instead, by 자료별 기준 기간과 표시 개수, which names the four surfaces the
  application actually loads.
* **A freshness age, an "out of date" marker, or a staleness threshold.** Nothing in
  this repository ever demotes `freshness_status` from `FRESH`, so it records "the last
  ingestion succeeded", not "this data is current". Computing an age from
  `last_success_at` in a presentation component would invent a classification the
  backend does not make.
* **A completeness percentage, coverage score, or source-quality grade.** Forbidden by
  the redesign plan's non-goals, and the registry carries nothing that could honestly
  support one. A unit test asserts the overview contains no `%`, 점수, or 등급.
* **URL state for the catalog filters.** Phase 6 decided against it deliberately; this
  milestone did not reopen the decision, so `?v=1&mode=transparency` behaves exactly as
  before and no existing shared link changes meaning.
* **A source network diagram, an institution logo wall, or a marketplace-style card.**
  Named as non-goals; none was built.
* **Anything mobile.** No drawer, bottom sheet, tab bar, or carousel; the existing
  sub-1024 behaviour is preserved, not extended.

## 13. Remaining risks

* **The dataset table's four rows are still hard-coded in `buildDatasetRows`.** They
  describe the four envelopes `app/page.tsx` loads, and their 범위 strings
  (서울·인천·경기 시군구, 수도권 보고 지역, 수도권 처리시설) are copy, not served
  metadata. They moved verbatim into `shared.ts`; a fifth loaded dataset would have to
  be added by hand, and nothing fails if it is not.
* **Row-level source attribution reads the first served item.** `/population` is
  query-scoped to one `source_id` on the backend so that row cannot borrow, but
  `/facilities` and the reporting endpoints apply no such filter — they are
  single-sourced today only because the current ingestion writers share one constant.
  A second facility source would silently attribute every record to whichever item
  came first. The fix is the read path declaring its sources, which is a backend
  change. Unchanged by this milestone, and re-recorded here so it is not lost.
* **The 기준 기간 gap count is a subtraction.** `total − withReferencePeriod` is
  correct for the served records, but if a future response could carry a period that
  `buildDisplaySources` does not surface, the gap block would over-report. Both halves
  come from `summarizeSources`, so they can only drift together.
* **`.wep-badge` is `white-space: nowrap`.** `공식 자료 기반 계산값` is the longest
  label on the page and it is why the dataset table's minimum width went from 560 to
  720px. A longer label in that column widens the table rather than wrapping.
* **The first-viewport margin at 1024×768 is ~94px** between the 현재 조건 strip and the
  fold. Anything added between the page header and the catalog controls has to be
  measured against it.

## 14. Validation

Run on the feature branch and again from merged `main`; both runs are recorded in the
milestone report. `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and
`npm run test:e2e` all from `frontend/`. The repository has **no CI workflow**
(`find .github` returns nothing), so local validation is the available automated
verification.

Feature-branch results: lint clean, typecheck clean, **1094 unit tests passed / 7
skipped** (was 1068 / 7), build succeeded, and **476 Playwright tests passed / 89
skipped** in 8.1 minutes with the single pre-existing facility-cost failure described
in §11. The 89 skips are the live-backend specs, which self-skip without
`E2E_BACKEND_URL`, plus the two opt-in capture suites.

## 15. Deferred work

* **The whole-application integration milestone** — the cross-view regression sweep,
  and the facility-cost 1024×768 first-viewport repair described in §11. This
  milestone is explicitly scoped out of both.
* **`DerivedPanel` / `SourcePanel`** (the equity 출처와 계산 방법 disclosure) were again
  not restyled — unchanged from the previous four milestones' deferral.
* **Mobile.** No mobile-specific work was done, per scope.
* **Deployment.** This milestone is **not deployed**. OCI currently runs the land-cover
  release; the whole UI refresh has not been shipped there.
