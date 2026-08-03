# UI refresh — 매립지 현황 (landfill) dashboard

The fifth milestone of the civic-dashboard refresh. The first
(`feat/civic-dashboard-foundation`, merged as `a7ce49e`) established the tokens,
the shell, the navigation, and the shared primitives; the second
(`feat/equity-dashboard-refresh`, `8c16759`) rebuilt **지역 부담**; the third
(`feat/suitability-dashboard-refresh`, `68eb2d3`) rebuilt 후보지 점수 and
가중치 바꿔보기; the fourth (`feat/facility-cost-dashboard-refresh`, `db96118`)
rebuilt 비용 살펴보기. This milestone is:

```text
매립지 현황      mode=flow
```

It is presentation and information-architecture work. **No landfill request, query
parameter, response type, served value, unit, period rule, denominator, filter
option, ordering, formatter, rounding rule, or URL key was changed** — see §6 and
§7.

Everything below was read out of the repository or measured in a real browser at
the stated viewport. Nothing here is aspirational.

## 1. The before-state, and what was wrong with it

The screen was already careful. Phase 5 had removed the schematic flow map, rationed
the amber sprawl down to one `tone="info"` banner, separated the 404 "no official
record" answer from a genuine failure, and made every unavailable value render its
served reason instead of a `0`. Its **number contract needed no repair, and none was
made.** The problems were of hierarchy, of naming, and of one question the screen
could not answer.

| # | Before | Why it was a problem |
| --- | --- | --- |
| L-A | Six content blocks with **no titles above them**: a KPI `<dl>`, a table, a 2×2 grid mixing two trends with two compositions, and an evidence block. `핵심 지표` and `지역별 반입 현황` existed only as `aria-label`s or small inline `h2`s of equal weight. | A sighted reader scanning the page saw four card grids and could not tell which question each one answered. Nothing stated the reading order the data actually has. |
| L-B | The 2×2 grid put 월별 반입량, 월별 공식 반입수수료, 출발지 비교, and 폐기물 구성 in **one visual group**. | Two of them are a time series over the whole selected year; the other two are a decomposition of the selected period. They answer different questions and are scoped differently — the trends deliberately ignore the 기간 filter — but the layout said they were the same kind of thing. |
| L-C | All four KPI cards were the same size. | 총 반입량 is the number every other surface on the screen decomposes, and it looked exactly as important as 톤당 실효 수수료. |
| L-D | 공식 보고값 vs 계산값 was carried only by **prose inside captions** ("공식자료를 바탕으로 계산한 값입니다.") and by the 계산 방법 disclosure. | The distinction between an officially reported figure and this platform's arithmetic is a data-integrity rule, not a footnote. It had no consistent visual carrier on the values themselves. |
| L-E | **Nothing restated the current selection.** The four `<select>`s held the state; the only place the reader could see what was being asked was the controls themselves. | After scrolling past the filter row — which is most of the page — there was no way to answer "what am I looking at?" without scrolling back up. |
| L-F | Before the first response, and on every filter transition, the screen showed a skeleton and a status line but said **nothing about what had been asked for**. | "Loading" without "loading *what*" is the weakest possible answer to the reader's actual question. |
| L-G | 출발지 비교 as a heading. | 비교 invites a ranking reading. The dataset reports three metropolitan quantities; it does not rank them, and a larger quantity is not blame. |
| L-H | The 기준 기간 / 부분 연도 line sat as a loose `<p>` between the live region and the KPI grid, in `text-xs`. | The single most important qualifier on the page — *this is not an annual total* — was the smallest text above the largest numbers. |

## 2. The layout that replaced it

```text
Application bar + 4-tab navigation      (shared chrome — rendered once, unchanged)
└── 매립지 현황 workspace  (<main>, full width, map-free, normal document scrolling)
    └── max-w-screen-2xl content column
        ├── PageHeader          수도권매립지 반입 현황 + scope line + mode-orientation
        ├── 알림 · 자료 범위     InfoBanner tone="info"  — the ONE banner   (unchanged)
        ├── 조건 선택            SectionCard
        │   ├── 연도 · 기간 · 출발 지역 · 폐기물 종류   4 native selects, one desktop row
        │   └── 현재 선택        the four conditions as text + one outcome sentence  [new]
        ├── (error | no-data | loading)  — mutually exclusive, never stacked
        └── when data:
            ├── 핵심 지표        h2 + 기준 기간 / 부분 연도   →  hero + 3 KPIs
            ├── 월별 추이        h2 + scope note              →  2 charts + exact tables
            ├── 반입 구성        h2 + provenance note         →  origin + waste breakdowns
            ├── 지역별 정확한 값  SectionCard flush            →  the 4-column table
            └── 근거와 한계      SectionCard                  →  4 collapsed disclosures
```

Section order follows the questions the milestone is meant to make answerable:
*what does this dataset cover* → *what am I asking for* → *is it official, partial,
missing, or broken* → *what is the total* → *how did it move* → *what is it made of*
→ *what are the exact figures* → *where did they come from and what do they not
mean*.

The six sections are `landfill-filters`, `landfill-headline`, `landfill-trends`,
`landfill-composition`, `landfill-region-table`, and `landfill-evidence`; the new
e2e spec walks all six by ordinary page scrolling at four viewports.

### Why 현재 선택 is a footer row of the filter card and not its own card

`e2e/phase5LandfillDashboard.spec.ts` measures that `landfill-limitation`,
`landfill-filters`, and `landfill-kpi-quantity` are **all fully inside the first
viewport at 1280×800** before any scrolling. A separate summary card between the
filters and the KPI row costs a card plus a grid gap for no informational gain — the
summary describes the controls immediately above it. Measured after the refresh, the
KPI row's bottom edge sits at **722.5px of 800** at 1280×800 and **706.5px of 900**
at 1440×900; a separate card would have spent most of that margin.

This is recorded because it looks like a styling preference and is not: it is a
measured constraint with a test that enforces it.

### Why the served period stayed with the values

`landfill-partial-year` — *부분 연도 (2026-05까지) — 연간 합계가 아닙니다* — is in the
**핵심 지표 section header**, not in 현재 선택. 현재 선택 states what was *asked*;
the partial-year marker qualifies what was *served*, and it must sit directly above
the numbers it qualifies. The e2e spec asserts it renders inside `landfill-headline`
and above `landfill-kpis`.

### Why the year in 현재 선택 is spelled `2026` and not `2026년`

`기준 기간 …년` is the **served** period, and several existing specs
(`landfill.spec.ts`, `phase5LandfillDashboard.spec.ts`) wait for it as proof that
new values have arrived after a filter change. Echoing `2026년` from filter state
would satisfy that wait while the *previous* period's numbers were still on screen.
The chip therefore spells the bare year exactly as the `<option>` does. A unit test
pins this, with the reason.

## 3. Components

New, under `frontend/src/components/landfill/` — all presentational, none holding
workflow state:

| Component | Replaces | Owns |
| --- | --- | --- |
| `shared.ts` | the constants and pure helpers at the top of `LandfillDashboard.tsx` | copy, `yearOptions`, `monthOptions`, `barRatio`, `periodLabelOf`, `originLabel` |
| `LandfillFilterPanel` | `LandfillFilters` | nothing — the four selects plus the **new** 현재 선택 summary |
| `LandfillHeadlineResults` | the KPI `<section>` + `PerCapitaKpi` + the loose 기준 기간 line | nothing |
| `LandfillTrendSection` | the two `MiniBars` inside the 2×2 grid | nothing |
| `LandfillCompositionSection` | the two `ComparisonBars` inside the 2×2 grid | nothing |
| `LandfillRegionTable` | `RegionTable` | nothing |
| `LandfillMethodology` | `Evidence` | nothing |
| `LandfillStates` | `LandfillLoading` + `LandfillError` + `LandfillNoData` | nothing |
| `LandfillProportionRule` | `ProportionRule` | nothing |

`LandfillDashboard.tsx` went 1121 → 256 lines because the JSX moved, not because
behaviour did. It still owns **no state** — it never did: `app/page.tsx` owns
`flowYear`, `flowMonth`, `flowOrigin`, `flowWaste`, `flowResult` (keyed by
`flowKey`), `flowYears`, `flowWasteOptions`, `flowMaxMonth`, the three parallel
requests, and the URL mirroring, and it still does. The dashboard gained no state,
no effect, no API call, and one derivation: `outcome`, a four-way discriminated
union read off the `data` / `unavailable` props it already received, so the summary
never classifies a response itself.

Shared primitives adopted: `PageHeader` (the `<h1>`), `SectionCard` (조건 선택,
지역별 정확한 값, 근거와 한계), `DataStatusBadge` (provenance, §5), plus the
`InfoBanner`, `Accordion`, `EmptyState`, `KpiCard`, and `Skeleton` already in use.

Deliberately **not** used:

* `SegmentedControl` for the 기간 (연간 / 월) switch. `SegmentedControl`'s own
  docstring names this as a planned consumer, but 기간 is **13 options**, not 2–4:
  연간 plus every month the selected year covers. A segmented control cannot carry
  that, and splitting it into a segment *plus* a month select would create a second
  representation of one filter — with its own restore, its own URL mapping, and its
  own way of disagreeing with the select. The native `<select>` stays.
* `FilterChip` in 현재 선택. A `FilterChip` **is a control** (`<button
  aria-pressed>`); the summary must report state, not become a second way to change
  it. An e2e assertion and a unit assertion both check that 현재 선택 contains zero
  `select`, `input`, or `button` elements.
* `DataStatusBadge` inside the exact-value table's per-capita cell. `.wep-badge` is
  `white-space: nowrap`, and the longest served reason
  (`일부 지역의 동일 기간 인구가 없어 합계를 계산할 수 없습니다`) would widen the column far
  past the table. The cell keeps the served reason as neutral-gray text, which is
  the same rule stated in the same place — §5.
* A second state store, a second filter representation, and a second result.

**No shared primitive was changed by this milestone.** `SectionCard`, `KpiCard`,
`InfoBanner`, `EmptyState`, `Accordion`, `Skeleton`, and `DataStatusBadge` are
untouched; the landfill view uses only props that already existed.

## 4. Filters — preserved exactly

Four native `<select>`s, in the same order, with the same options, the same
defaults, the same test ids, the same setters, and the same interaction rules:

| Control | Test id | Options | Default |
| --- | --- | --- | --- |
| 연도 | `landfill-year-select` | `최신 완결연도` + served `available_years`, newest first, **plus the reader's own selection** | `""` (latest complete year) |
| 기간 | `landfill-month-select` | `연간` + 1…`maxMonth`, **plus the reader's own selection** | `""` (annual) |
| 출발 지역 | `landfill-origin-select` | `전체` + 서울시 / 인천시 / 경기도 (SGIS 11 / 28 / 41) | `""` (all) |
| 폐기물 종류 | `landfill-waste-select` | `전체` + served `wasteOptions`, **plus the reader's own selection** | `""` (all) |

Unchanged behaviour that is easy to break and was not:

* changing 연도 clears 기간 (a month from the previous year may not exist in the new
  one) — the same single `setMonth(null)` call, in the same handler;
* the reader's own selection is always folded into the option list, because a native
  `<select>` whose `value` matches no `<option>` renders **blank** and would erase
  the control's own state;
* the option lists are **page-owned**, so they survive a failed or empty response and
  the filters stay operable in the no-data and error states;
* `?v=1&mode=flow&year=&month=&origin=&waste=` still serialise and restore through
  `lib/urlState.ts` unchanged, and the landfill parameters are still dropped when the
  reader leaves the area.

## 5. Provenance, and the four data states

Provenance is now carried by `DataStatusBadge` **per card**, not per section. This
row genuinely mixes the two kinds, and a single section badge would have had to lie
about half of it:

| Value | Badge | Why |
| --- | --- | --- |
| 총 반입량 | `reported` — 공식 값 | reported by 수도권매립지관리공사 |
| 공식 반입수수료 | `reported` — 공식 값 | reported by 수도권매립지관리공사 |
| 톤당 실효 수수료 | `derived` — 계산값 | this platform's arithmetic over two official inputs |
| 주민 1인당 환산 반입수수료 | `derived`, or `missing` when no value was served | ditto; absence is not a zero fee |

The 월별 추이 and 반입 구성 section headers each carry one `reported` badge, because
every value in them is a served figure (the shares are the backend's own
`quantity_share`). The exact-value table states the split in its section
description instead, since its four columns mix the two.

Four states stay visually and semantically distinct, and none is amber-by-default:

* **공식 측정 0.** A reported `0` renders as `0 t` and its row is **never dropped**.
  A new unit test renders a zero total beside a missing per-capita in the same
  fixture and asserts both readings on one screen.
* **자료 없음 (a value that was not served).** The neutral `--color-no-data` gray with
  its text label on the KPI card and in 현재 선택; the served reason as neutral-gray
  text in the table cell. The per-capita cell moved off `text-warn`, which is
  reserved for a caution about a value that exists
  (`design-tokens.md` §"Missing data").
* **선택 조건에 자료 없음 (the backend's 404 answer).** `EmptyState`, no `role`, no
  zeros, the served `available_years` offered as a way forward, and 현재 선택 stating
  *값이 0이라는 뜻이 아닙니다*.
* **요청 실패.** `InfoBanner tone="error"` + `role="alert"` — the only alert on this
  screen. 현재 선택 shows **no** data-status badge in this state, because a failed
  request says nothing about whether records exist.

The 부분 자료 case is a fifth, orthogonal state: it qualifies values that *are*
there, so it keeps `text-warn` and stays in the headline section beside them.

## 6. Existing analysis reused — nothing new was fetched or computed

| Surface | Source |
| --- | --- |
| every quantity, fee, share, and period | `fetchLandfillSummary` / `fetchLandfillTrends` / `fetchLandfillComposition` (unchanged calls, unchanged parameters, unchanged scoping) |
| 반입량 formatting | `formatTons` (`lib/landfill.ts`, unchanged) |
| 반입수수료 formatting | `formatKrwEok` (unchanged) |
| 톤당 실효 수수료 | `formatEffectiveFee` (unchanged) |
| 1인당 환산값 | `formatKrwPerPerson` (unchanged) |
| exact monthly values | `formatDecimalExact` (unchanged — lossless, never chart-rounded) |
| 비중 | `formatShare` over the served `quantity_share` (unchanged) |
| unavailability reason → plain Korean | `perCapitaUnavailableLabel` / `perCapitaUnavailableCode` (unchanged) |
| 집계 기준 → plain Korean | `accountingBasisLabel` (`lib/glossary.ts`, unchanged) |
| 404 vs failure classification | `landfillUnavailableFrom` / `landfillUnavailableFromAll` (`lib/landfill.ts`, unchanged) |
| filter serialisation and restore | `lib/urlState.ts` (unchanged) |

`lib/displayNumber.ts` and `lib/metrics.ts` are deliberately **not** used here: the
landfill view has always formatted through `lib/landfill.ts`, and routing its
figures through a second formatter would have changed displayed values. That is
exactly what this milestone was not allowed to do.

The only arithmetic in any new file is the pre-existing `barRatio` (`Number()` →
a CSS width) and the pre-existing `Math.max` that finds the widest row on screen.
Neither reconstructs a displayed value: every figure on screen is still the
backend's exact string, formatted.

## 7. Behaviour intentionally untouched

Unchanged: the three parallel requests and their scoping (summary by
year+month+origin+waste, trends by the year's month range + origin + waste,
composition by year + origin only); the `flowKey` result tagging that clears the
previous selection's values the moment a filter changes; the retention of
`available_years` / `wasteOptions` / `maxMonth` across a failed or empty response;
the December-month-end denominator for a complete year, the final covered month for
a partial year, and the exact month for a monthly selection; the
`is_complete_year` / `available_through_month` partial-year rule; the
`landfill-fee-per-capita-v2` derivation and all five of its unavailability codes;
the trend gap rule (no bar, no row, never a zero); the accessible exact-value tables
and their lossless formatting; the MOIS comparability disclosure; every source id,
snapshot date, reference period, and version string; and the whole `role="alert"` /
`role="status"` allocation.

No landfill calculation is reimplemented inside a visual component, no total is
recomputed from a displayed string, and no backend value is reverse-engineered on
the client.

## 8. Accessibility decisions

* **One `<h1>`, one `<main>`, one navigation, zero maps, zero sub-view controls, zero
  `<fieldset>`s**, asserted at four viewports and in unit tests. The `<h1>` is now
  `PageHeader`'s, so "exactly one" is enforced by the shared primitive; its text is
  unchanged (`수도권매립지 반입 현황`), which `e2e/civicShell.spec.ts` compares exactly.
* **The mode-orientation strip still follows the `<h1>`** — it is `PageHeader`'s
  `children`, which render after the header block, keeping the document order
  `app/shell.test.tsx` asserts.
* **`role="alert"` is used exactly once**, for the genuine request failure. The
  standing scope banner, the 현재 선택 summary, the partial-year marker, and the
  section headers carry no live-region role at all. The loading line and the
  no-data announcement stay `role="status"`, and `landfill-live` (period + total)
  stays outside every `<details>` — a collapsed disclosure is hidden from the
  accessibility tree and must never be the only home for a live region.
* **Every section is a named region.** `SectionCard` supplies `aria-labelledby` for
  the three card sections; 핵심 지표 / 월별 추이 / 반입 구성 use `aria-labelledby`
  pointing at their own `h2`. Heading levels are h1 → h2 (section) → h3 (card inside
  a section), so the outline is walkable.
* **Native controls stayed native.** Four `<select>`s wrapped by their `<label>`s,
  native `<details>` disclosures, no `div` control anywhere, and the Tab order
  through the filter row is unchanged (an existing e2e test walks it).
* **No state is colour-only.** Every `DataStatusBadge` renders its text label; the
  partial-year marker is a sentence; the missing per-capita is its served reason;
  and every comparison bar is `aria-hidden` beside the exact value it re-encodes.
* **The exact-value table** keeps its `<caption>`, `scope="col"` headers,
  `scope="row"` region cells, and its own `overflow-x-auto` container.

## 9. Viewport behaviour

Measured in Chrome with the mocked backend, on the populated screen:

| Viewport | Page h-overflow | KPI row bottom | Nested h-scroll panes | Document scrolls |
| --- | --- | --- | --- | --- |
| 1024 × 768 | none | 813px (2-column grid — below the fold by design) | table only | yes |
| 1280 × 800 | none | 722.5px of 800 | table only | yes |
| 1440 × 900 | none | 706.5px of 900 | table only | yes |
| 1920 × 1080 | none | 686.5px of 1080 | table only | yes |

The dashboard scrolls the **document** — expected for a long report — and the new
spec asserts both that it does and that the exact-value table's own
`overflow-x-auto` is the only container that ever scrolls sideways. The two
`표로 보기` disclosures keep their pre-existing `max-h-40 overflow-y-auto`, which is
a deliberately bounded list inside a collapsed `<details>`, not a page-level scroll
trap.

Sub-1024 behaviour is preserved as-is: `phase5LandfillDashboard.spec.ts` still runs
at 390×844 and 768×1024 and passes unchanged. No mobile-specific work was done.

## 10. Tests

`frontend/src/components/LandfillDashboard.test.tsx` — 75 assertions (was 57). **All
57 pre-existing assertions pass unmodified.** Added:

* the six titled sections, each exactly one `h2`, under exactly one `h1`;
* the standing scope notice present, `tone="info"`, never an alert, and never inside
  a disclosure — checked in all four states;
* 현재 선택 restating the four conditions, naming the defaults rather than inventing
  them, and containing zero controls;
* the year spelled without `년`, with the wait-semantics reason;
* the outcome statement per state: `reported` badge + served period, "불러오는 중"
  with no digit and no badge, the neutral `missing` badge with "값이 0이라는 뜻이
  아닙니다", and no badge at all on a request failure;
* 총 반입량 being the only `size="hero"` card, with the grid still holding four;
* per-card provenance — two `reported`, two `derived` — and the per-capita card
  switching to `missing` with the served reason and no `0원`;
* an official measured zero rendering as `0 t` with its row kept, beside a missing
  value that renders neither a zero nor amber, on the same screen;
* the exact-value table owning the section's only scroll container and stating the
  zero-versus-missing rule;
* the two trend charts grouped under one heading that states their scope;
* the two breakdowns named descriptively, with 최다 / 최악 / 1위 / 책임 / 위험 / 과도
  asserted absent;
* no map, sidebar, sub-view control, `nav`, `main`, or `fieldset` in this view;
* `FORBIDDEN_PRIMARY_TOKENS` absent from the refreshed surface with the diagnostic
  layer stripped, including in the unavailable-per-capita fixture.

`frontend/e2e/landfillDashboard.spec.ts` — **new**, 22 assertions at 1024×768,
1280×800, 1440×900, and 1920×1080, self-mocked, structure and geometry only:

* one map-free workspace with one `h1` / one `top-navigation` / one `mode-switch` /
  one `#main-content` / zero `map-container` / zero `suitability-subviews`, and all
  six sections reachable by ordinary scrolling, at every viewport;
* the document scrolling, and the exact-value table being the only container that
  scrolls horizontally — asserted by enumerating every overflowing element;
* the headline outranking every other value, with `공식 값` / `계산값` as text;
* the exact-value table and the origin breakdown reporting the **same tonnages in
  the same order**, and the monthly chart's bar count matching its exact table's row
  count;
* 현재 선택 tracking a filter change together with the values, and holding no control;
* the partial-year statement rendering inside `landfill-headline`, above the KPIs;
* methodology openable, with the population source, the fee period, and a snapshot
  date non-empty;
* populated / no-data / failure as three different screens — including that the
  evidence section is absent rather than empty on a no-data answer, and that the
  scope banner survives all three without becoming an alert;
* the cross-view map contract through a full round trip: 매립지 현황 (0) → 지역 부담
  (1) → 후보지 점수 (1) → 가중치 바꿔보기 (1) → 비용 살펴보기 (0) → 매립지 현황 (0),
  with the chrome never doubling and the nav label frozen;
* `?v=1&mode=flow&year=2024&month=3&origin=11&waste=생활폐기물` restoring all four
  controls and the summary that reports them.

Unchanged and re-run green: `e2e/phase5LandfillDashboard.spec.ts` (37),
`e2e/phase7FinalRegression.spec.ts`, `e2e/responsive.spec.ts`,
`e2e/integration.spec.ts`, `e2e/civicShell.spec.ts`, `e2e/desktopNavigation.spec.ts`,
`e2e/scenario.spec.ts`, `app/shell.test.tsx`, `app/page.phase7.test.tsx`,
`app/page.test.tsx`, `app/accessibility.test.tsx`, and
`app/terminology.audit.test.tsx` — which between them own the cross-view contract
(zero maps in 매립지 현황, the frozen nav labels, the landfill filter URL state, and
the single skip-link target).

`e2e/landfill.spec.ts` is the live-backend smoke test; its `E2E_BACKEND_URL` skip
guard is untouched and it was not modified.

Deliberately no pixel snapshots — the repository has no visual-regression
infrastructure (`baseline.md` §7).

### Two pre-existing flakes, so the next validator does not blame this milestone

Both were measured on this branch **and** on unmodified `main` at `db96118`. Neither
is caused by this work, and neither was "fixed" by relaxing an assertion.

**1. `src/app/page.phase7.test.tsx` (the landfill filter URL-state suite).** Fails
intermittently under full-suite concurrency (`npm test`), never in isolation.
Measured on this branch — 1 failure in 3 full runs, at the `scope`/`top` assertion —
and on `main` — **1 failure in the first run and 2 in the second, clean in the
third**, at a different assertion in the same file. All 11 of its assertions pass
8/8 when the file is run alone, on both branches. It is a timing sensitivity in that
file's `waitFor`-on-`window.location.search` pattern under load; this milestone
touched neither `app/page.tsx` nor `lib/urlState.ts`.

**2. `e2e/facilityCostDashboard.spec.ts:126` at 1024×768** ("keeps the whole setup
workflow reachable, with the action on the first screen"). Failed 2 of 4 full-suite
runs on this branch (`box.y + box.height` = 838 against a 768 viewport) and 0 of 1 on
`main`. It is **not** a layout change from this work: the test passes **40/40**
(`--repeat-each=10` × 4 viewports) in isolation on this branch, and this milestone
changes no facility-cost file, no shared primitive, and no global CSS.

The root cause was traced. Line 148 is `await page.mouse.wheel(0, -2000)`, which
dispatches the wheel event but does not wait for the scroll to settle, and the
sticky rail is measured on the very next line. The assertion therefore depends on
where the scroll happens to come to rest. Replacing it with a deterministic
`window.scrollTo(0, 0)` plus an `expect.poll` on `window.scrollY` makes the 1024×768
case fail **3/3** — i.e. with the page genuinely at the top, 비용 계산하기 does not
fit above the fold at 1024×768, and the test has been passing only because the wheel
left the page partially scrolled, where `lg:sticky` pulls the button up.

That experiment was **reverted**, and the spec is committed unchanged. Making it
honest requires either changing the 비용 살펴보기 setup layout or re-stating what
`facility-cost-dashboard.md` §14 promises at 1024×768 — both are 비용 살펴보기 product
decisions, and this milestone is explicitly scoped out of that view. It is recorded
here so the finding is not lost.

## 11. Deliberately not built

* **A landfill map, or a placeholder for one.** The source declares metropolitan
  totals with no municipal origin, no route, and no destination coordinate. Phase 5
  removed the schematic straight-line map rather than re-labelling it, and this
  milestone did not bring it back in any form.
* **A year-over-year change KPI.** No tested helper computes it, the backend does not
  serve it, and the definition changes twice inside the available window
  (2010-10 and 2015-01 for the population denominator). Computing it in a
  presentation component was explicitly out of scope.
* **A 자료가 있는 월 수 / 최대 반입 월 / 평균 월 반입량 KPI row.** Each would have been
  new client-side arithmetic over the trend points to fill a grid. A smaller truthful
  KPI set was preferred.
* **An export, report, or share action.** The landfill view has never had one
  (`ShareExportBar` and `ReportPreview` are mounted by the equity branch, below the
  flow early-return in `page.tsx`), and a decorative button with no action is out of
  scope.
* **Anything mobile.** No drawer, bottom sheet, tab bar, or carousel; the existing
  sub-1024 behaviour is preserved, not extended.

## 12. Remaining risks

* **The first-viewport budget at 1280×800 is 78px.** Anything added between the
  banner and the KPI row — a fifth filter, a second summary line, a wrapped
  description — has to be checked against
  `e2e/phase5LandfillDashboard.spec.ts`'s `toBeInViewport({ ratio: 1 })`. The fix, if
  it ever fires, is to move content below the KPI row, not to relax the assertion.
* **The two chart colours are still literals** (`#0d9488`, `#2563eb`) inside
  `LandfillTrendSection`. They were carried over verbatim rather than re-pointed at
  tokens, because re-tinting a chart is a change to what the reader sees and this
  milestone was scoped to leave every value's presentation alone. They are the only
  hex literals in `components/landfill/`.
* **현재 선택 and the 핵심 지표 header both mention the served period.** They are
  deliberately different statements — *what you asked for and what is held* versus
  *what the numbers cover* — but if a future change makes one of them wrong, the
  screen will contradict itself rather than simply go quiet.
* **Provenance badges are per card.** A future KPI whose provenance is conditional
  (reported for some filters, derived for others) would need the badge computed from
  the served evidence block rather than hard-coded per card.

## 13. Deferred work

* **데이터·출처** keeps its current treatment; it is its own milestone, and this one
  deliberately did not begin it.
* **`DerivedPanel` / `SourcePanel`** (the equity 출처와 계산 방법 disclosure) were
  again not restyled — unchanged from the previous three milestones' deferral.
* **Mobile.** No mobile-specific work was done, per scope.
* **Deployment.** This milestone is **not deployed**. OCI currently runs the
  land-cover release; the whole UI refresh has not been shipped there.
