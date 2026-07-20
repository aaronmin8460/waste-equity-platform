# Citizen facility cost lens (full-width dashboard UI)

The citizen-facing front end for the facility cost backend. It is reached **inside
the Suitability experience** as a sub-view — `[적합성 점수] [비용 렌즈]` — but the 비용
렌즈 view now renders as a **full-width dashboard with no map**
(`components/FacilityCostDashboard.tsx`, wired in `app/page.tsx`), replacing the
earlier narrow sidebar panel (`FacilityCostPanel.tsx`).

It is a **decision-support** tool, not propaganda for or against a facility. It
presents the backend's standard-construction-cost **analysis** with its disclaimer
and completeness; it never shows an actual total project cost, an approved subsidy,
a personal tax bill, or a cheapest-site ranking, and it renders unavailable
components as explicitly unavailable — never as `0`. Displayed money is the exact
backend-served decimal string, formatted without changing its value. Numeric
conversion is used **only** for chart proportions, never to reconstruct a displayed
value from an imprecise float.

## Full-width routing (no map)

Selecting 적합성 → 비용 렌즈 triggers a full-width early return in `app/page.tsx`. The
cost view mounts **no `MapView`, no map container, and no floating legend** — the V1
cost model does not vary by map cell, so a map beside it would be dead weight (the
same rationale and full-width shape as the 수도권매립지 flow dashboard). The main mode
switch (형평성 / 적합성 / 수도권매립지) and the 적합성 점수 / 비용 렌즈 sub-view switch stay
reachable above the dashboard (both keep `aria-pressed` and keyboard navigation), and
the selected suitability candidate is passed through so its context card still renders.
Returning to 적합성 점수 restores the sidebar + map. This is asserted by
`e2e/facilityCost.spec.ts` and `e2e/integration.spec.ts` (`map-container` count `0`
in the cost view) and `app/accessibility.test.tsx`.

## Information architecture

Since Phase 3 of the desktop redesign the dashboard is **two internal views**, not one
long page. `view` is component state — there is no route, no history entry, and no URL
parameter — and the results view is *derived*: it renders only while `resultCurrent`
holds, so a stale result can never be displayed beside changed inputs.

| Transition | Trigger | Effect |
| --- | --- | --- |
| setup → results | a **successful, current** calculation | results replace the setup form |
| results → setup | the **← 설정 바꾸기** button | every input retained; **no request issued** |
| stays on setup | a failed calculation | `role="alert"` error, settings kept, retry allowed |
| stays on setup | a calculation in flight | `Skeleton` + `role="status"` progress |
| results → setup | inputs change under a held result | stale notice, result hidden until recalculated |

A superseded in-flight response is discarded by the monotonic `requestSeq`, so a late
response from old inputs can neither render nor navigate.

**Shared, on both views:**

1. **Header** — `<h1>` **시설 비용 살펴보기** + supporting explanation ("선택한 지역의
   공식 폐기물 자료를 기준으로 필요한 시설 규모와 표준공사비 기반 설치비를 계산합니다."). It is
   the single logical `h1` of the full-width view — the results view adds an `<h2>`,
   never a second `h1` — and it names the task in the same vocabulary as the
   비용 살펴보기 sub-view tab that leads here. (Before Phase 2 of the desktop redesign
   it read 우리 지역에 시설이 생긴다면.)

**Setup view** (`facility-cost-setup-view`):

2. **Notice** — a single compact `InfoBanner` (`tone="info"`, never `role="alert"`)
   carrying the fixed disclaimer that this page does not recommend for or against
   construction, plus the three claims a citizen must not misread: standard-cost
   reference estimate / not actual total project cost / not a personal bill. The full
   eight-item non-claims list sits directly below it in a **collapsed** `Accordion`
   whose summary states the item count ("분석에 포함되지 않은 항목 8가지"). Nothing is
   deleted and no wording is softened — only prominence changes, so the mandatory
   caveats are read rather than tuned out (Phase 0 audit finding G4). Since Phase 3 the
   backend's structured `missing_components` are no longer duplicated here: they have
   their own results accordion, which is the screen they belong to.
3. **Setup workflow** — a constrained centred two-column grid: numbered setup steps on
   the left, a sticky scenario summary carrying the primary action on the right (see
   below).

**Results view** (`facility-cost-results-view`) — answer first, in this fixed order:

4. **← 설정 바꾸기** (`facility-cost-edit-settings`) — a native button, not history
   navigation. Returning moves focus to the first setup heading.
5. **Heading + scenario context** — `<h2>` 시설 비용 계산 결과 and a one-line summary of
   what was calculated: region count, a short region summary, waste stream, processing
   share, facility type. Regions are named through `regionDisplayName` (서울 종로구), so
   **no raw region code appears**, and a long selection collapses to "… 외 N개" rather
   than listing 60+ names.
6. **Disclaimer** — one compact `InfoBanner` (`tone="info"`, never `role="alert"`)
   stating the four non-claims: standard-cost reference / not actual total project cost
   / subsidy not approved / per-capita not a personal bill.
7. **Hero KPI** — 주민 1인당 환산 지방비, `size="hero"`, the largest number on screen.
8. **Three secondary KPIs** — 표준공사비 기반 설치비 산정액 · 필요한 시설 규모 ·
   연간 환산 설치비, in an `lg:grid-cols-3` row.
9. **Collapsed detail `Accordion`s**, in order: 국비·지방비 구성 → 지역별 공식 투입 데이터
   → 선택한 후보지 정보 (omitted entirely when no candidate) → 계산 가정 →
   포함되지 않은 비용 N개 → 출처와 계산 방법 → 정밀값과 계산 기준.

Only the KPI block (`facility-cost-results`) is the `role="status"` live region. The
accordions sit outside it, so a collapsed `<details>` is never the only home for a live
region that must announce while closed.

The client-only **citizen deliberation** block (a conditions checklist plus a stance
radio group) was item 10 until Phase 2 of the desktop redesign, which removed it in
full — component, its two string constants, its tests, and the `facility-cost-conditions`
/ `-condition` / `-response` testids. It collected nothing, sent nothing, and fed no
calculation, so removing it changed no request, result, score, ranking, API, schema, or
URL state. It was not replaced with another survey or checklist.

## KPI definitions and units (exact backend units)

| # | Card | Backend field | Unit |
| - | ---- | ------------- | ---- |
| 1 | 공식 연간 폐기물 발생량 | `official_input.official_annual_quantity_ton` | 톤/년 |
| 2 | 시나리오 처리량 | `capacity.annual_service_quantity_ton` | 톤/년 |
| 3 | 필요 시설 규모 | `capacity.facility_capacity_ton_per_day` | 톤/일 |
| 4 | 표준공사비 기반 설치비 산정액 | `standard_cost.standard_construction_cost_bn` | 억원 |
| 5 | 연간 환산 설치비 | `annualization.annualized_construction_cost_bn` | 억원/년 |
| 6 | 명목 국고보조 추정액 | `subsidy.estimated_national_subsidy_bn` | 억원 |
| 7 | 단순 지방비 추정액 | `subsidy.simplified_local_government_share_bn` | 억원 |
| 8 | 주민 1인당 환산 지방비 | `per_capita.per_capita_local_share_won` | 원 |

Since Phase 3 these eight are **ranked, not gridded**. Every value is still displayed —
none was removed — but only four are KPI cards:

| Placement | Indicators |
| --- | --- |
| Hero card (`size="hero"`) | 8 주민 1인당 환산 지방비 |
| Three secondary cards | 4 표준공사비 기반 설치비 산정액 · 3 필요한 시설 규모 · 5 연간 환산 설치비 |
| 국비·지방비 구성 accordion | 6 명목 국고보조 추정액 · 7 단순 지방비 추정액 (+ the total) |
| 정밀값과 계산 기준 accordion | 1, 2 and the exact value of every other indicator |

The KPI block (`facility-cost-results`) is a `role="status"` region so a screen reader
announces a new calculation.

### Display rounding (presentation only)

Cards show a human-readable APPROXIMATION produced by
[`frontend/src/lib/displayNumber.ts`](../frontend/src/lib/displayNumber.ts); the exact
backend decimal string is unchanged and stays reachable in 정밀값과 계산 기준.

| Unit | Display precision | Example |
| --- | --- | --- |
| 억원 | 1억원 단위 | `"1277.222078"` → `약 1,277억원` |
| 억원/년 | 1억원 단위, "/년" appended | `"8.050000"` → `약 8억원/년` |
| 원 → 만원 | 원 ÷ 10,000, 1만원 단위 | `"439553.13"` → `약 44만원` |
| 원/인 | identical to 원 → 만원 (the hero) | `"42262.50"` → `약 4만원` |
| 톤/일 | 1톤/일 단위 below 100, 10톤/일 단위 at and above 100 | `"279.479667"` → `약 280톤/일` |
| % | 1% 단위 | `"62.5"` → `약 63%` |

Rounding is half-up on the magnitude, applied once. The module's guarantees:

- **No floating point anywhere.** Rounding is string/BigInt only, so a value beyond
  `Number.MAX_SAFE_INTEGER` still rounds correctly, and none of these helpers can be
  used to reconstruct an exact value. A unit test scans the source for `Number(`,
  `parseFloat`, `parseInt`, `toFixed`, and `Math.`.
- **A non-zero value never displays as `0`.** Below one display unit it reads
  "1억원 미만", because "약 0억원" for a real cost would read as free.
- **An exact zero drops the `약`** — claiming approximation for an exact value is its
  own small dishonesty. So is claiming it when nothing was rounded away
  (`"35.000000"` → `35톤/일`, no `약`).
- **Malformed input returns `null`**, and the caller falls back to the unchanged exact
  string. It never substitutes zero.

### Exact values

`정밀값과 계산 기준` carries every exact figure, rendered from the ORIGINAL API string
through `formatQuantity` (comma grouping only — value-preserving): 표준공사비 기반 설치비
산정액 `120.75 억원`, 주민 1인당 환산 지방비 `42,262.5원`, 필요한 시설 규모 `35 톤/일`, and so
on. No exact value is reconstructed from an approximation, and CSV/report exports are
untouched by display rounding.

## Permitted vs prohibited terminology

- **Permitted (honest):** 표준공사비 기반 설치비 산정액, 연간 환산 설치비, 명목 국고보조
  추정액, 단순 지방비 추정액, 주민 1인당 환산 지방비. Every monetary card is a
  standard-cost **analysis / estimate**, and the caveats state what it is **not**.
- **Prohibited (never used as an affirmative label):** 총비용, 실제 총사업비, 확정
  사업비, 확정 보조금, 실제 세금, 주민 부담 청구액, "최저 비용" / cheapest-site ranking.
  (The honest caveats legitimately contain "…이 아닙니다" phrasings such as "실제
  총사업비가 아님"; these negations are required and are distinct from an affirmative
  claim. `total`-cost wording — 총비용 — never appears at all.)

The eight non-claims are 운영비 미포함 · 실제 운송비 미포함 · 토지·보상비 미포함 · 잔여
매립비용 미포함 · 후보지별 토목조건 미포함 · 실제 총사업비가 아님 · 실제 승인된 국고보조금이
아님 · 주민 개인의 실제 세금 청구액이 아님. Since Phase 2 they live in the collapsed
"분석에 포함되지 않은 항목 8가지" accordion rather than an always-open amber panel, with
the three most misreadable of them restated in the always-visible banner above it. The
list itself is unchanged and the count is in the summary, so none of it is hidden by
omission.

## Funding-breakdown interpretation

A stacked horizontal bar (decorative, `aria-hidden`) splits the **one-time**
표준공사비 기반 설치비 산정액 into 명목 국고보조 추정액 + 단순 지방비 추정액; all three
amounts are also shown as exact text. The bar widths use `Number()` conversion for
proportion only. Rules:

- It does **not** mix the annualized cost into the same total.
- It does **not** imply subsidy approval — the caption states "보조금 승인을 의미하지
  않으며 …".
- Missing components are **not** drawn as zero-width categories; missing is not zero,
  so they appear only in the warning/missing sections.

## Per-capita caveat

`per_capita.per_capita_local_share_won` is a simplified per-resident conversion of the
local share, **not** an individual tax bill. It is the **hero** result since Phase 3, so
its caveat carries the most weight on the screen: the card states
"개인에게 실제로 청구되는 세금이나 부담금이 아닙니다." above the backend's own served
caveat. The label stays `per_capita.term_ko` (주민 1인당 환산 지방비) and is never
relabelled 주민 부담 청구액 / 실제 세금 / 개인 부담금 / 확정 주민 부담.

When the backend cannot compute it (no compatible official population), the hero keeps
its position and shows the plain-Korean rendering of the served `unavailable_reason` —
**never a fabricated `0원`**, and never a per-capita of our own invention. The raw
reason code stays in the diagnostic disclosure.

## Backend reason codes

Reason codes are ALL-CAPS enums; a code is not an explanation. Since Phase 3 the results
surface renders plain Korean, and the codes are demoted — **never deleted**. They remain
in the API response, the TypeScript types, tests, and a `data-diagnostic` disclosure.

The single source of truth is
[`frontend/src/lib/glossary.ts`](../frontend/src/lib/glossary.ts):
`MISSING_COMPONENT_META`, `MISSING_REASON_EXPLANATIONS`, and
`PER_CAPITA_UNAVAILABLE_EXPLANATIONS`, with `UNKNOWN_REASON_EXPLANATION`
("현재 공식 계산 자료가 제공되지 않습니다.") as the safe fallback so an unrecognised code
never becomes an invented claim about a specific dataset. All eleven codes are also in
`FORBIDDEN_PRIMARY_TOKENS`, and `FacilityCostDashboard.test.tsx` scans the whole results
surface (diagnostic subtrees removed) against that list.

`MISSING_COMPONENT_META` also holds the short parenthetical wording the transparency
centre renders ("운영비 (공식 자료 미연계)"), so the two surfaces cannot drift into two
translations of one code. Phase 6 is where `TransparencyDashboard.tsx` starts consuming
it; Phase 3 only establishes the registry and asserts the strings match.

## No regional cost allocation

The official-input region table shows each service region's official generation,
population, and its **share of the official total generation** — a share explicitly
labelled a display-only derived value ("표시용 파생값"). The dashboard does **not**
split subsidy or local-government cost across regions by population, waste, equal
split, or any assumed agreement — regional cost allocation is a non-goal. A region
with no official population shows explicit unavailable text, never `0명`.

## Setup workflow

Desktop layout (1440×900 primary, 1280×800 verified): a constrained centred container
holding a two-column grid. The left column carries the setup steps — **1. 처리할 지역**
(the region picker) and **2. 처리 조건** (waste stream · processing share · facility
type), followed by the collapsed 고급 설정 accordion. The right column is a compact
**현재 설정** summary — selected-region count and a truncated name list ("서울 중구,
인천 강화군 외 1개", never 60+ names and never a code), waste stream, processing share,
facility type, and whether the advanced values still equal the API defaults — with the
primary 비용 계산하기 button inside it. That column is `lg:sticky lg:top-6 lg:self-start`,
so the action stays on screen without scrolling to the end of a long form. Below `lg`
the columns stack and the summary returns to normal document flow. Sticky is safe here
only because this branch is map-free: it mounts no `.map-pane`, so nothing depends on
this subtree's height (see frontend/RESPONSIVE_LAYOUT.md, "Sticky positioning").

**Basic settings** are service regions · waste stream · processing share · facility
type. **Advanced settings**, in the shared collapsed `Accordion`: operating days ·
underground multiplier · subsidy scheme · cost version. Every control has an associated
`<label>`; a keystroke never sends a request — the explicit calculate button is the
only submit path, and it is disabled while no region is chosen, while facility types
are unavailable, while an input is out of range, or while a request is active (no
duplicate submission). Why it is disabled is always stated: ordinary "not ready yet"
guidance goes to a **polite `role="status"`** beside the button, while an out-of-range
numeric input keeps its `role="alert"` message. The alert is also mirrored into that
status line, so a *closed* accordion is never the only place an active validation error
is stated.

The cost version is offered as a `<select>` only when the API serves more than one; a
single version renders read-only rather than as a one-option select pretending to be
editable. The subsidy-rate source (the 국고보조금 업무처리지침 nominal rates, an
analytical assumption) stays immediately beside the subsidy selector, moving with it
into the accordion — it is never separated from the control it qualifies.

**Facility type** is a `<fieldset>`/`<legend>` of selection cards, each a native
`<input type="radio">` wrapped in its `<label>`. One card is rendered per facility type
**served by the options endpoint** — the count is never assumed, so a third type would
lay out with no code change — and the visible text is exactly the served label. No
capacity, cost, approval, or engineering description is invented, because the endpoint
provides none. Selection shows as the radio dot + a border change + a heavier weight,
so it never depends on color alone.

### Service-region picker

`ui/SearchableRegionPicker.tsx` — an ARIA combobox that replaced the native
`<select multiple size={6}>` in Phase 2. It is presentational and controlled: it fetches
nothing, and receives the calculable regions and the current selection as props.

Its options are still derived from **calculable coverage** — the regions that actually
have `RegionalWasteStatistics` for the *selected* waste stream — so a citizen can never
pick a code that always returns `OFFICIAL_WASTE_UNAVAILABLE`. Changing the waste stream
re-derives the choices, clears the now-invalid selection, and resets a stale search
query. Numeric inputs elsewhere are validated (processing share 0–100, operating days
1–366, underground multiplier within bounds).

**No raw region code is visible.** The old options read `중구 (KR-SGIS-11140)`, making a
citizen decode an internal identifier to tell Seoul's 중구 from Incheon's. Labels are now
prefixed with the metropolitan area — `서울 중구` / `인천 중구` — via
`lib/regionDisplay.ts#regionDisplayName`, which classifies codes with the existing
`lib/ranking.ts#regionScope` (SGIS sido digits 11 Seoul / 23 Incheon / 31 Gyeonggi, plus
the `KR-RCISRG-*` derived-city codes → Gyeonggi) rather than introducing a second,
divergent classification. Codes remain the option value, the chip key, the
`data-region-code` test hook, and the API payload — they are simply not visible text.
Ordering is deterministic: 서울 → 인천 → 경기 → unclassified, then by name, then by code;
options and selected chips use the same comparator so they can never disagree.

Interaction: type a Korean name to filter · ArrowDown/ArrowUp move the active option ·
Enter selects it · Escape closes the list · click selects · selected regions appear as
removable chips whose remove button is named `<지역 이름> 제거` (never a bare ✕) ·
서울 전체 / 인천 전체 / 경기 전체 bulk-select **only the currently calculable** regions of
that area, merging with rather than replacing the existing selection, and a metro with
no calculable region is disabled · 선택 초기화 clears everything. Re-selecting an
already-selected region is a no-op, so a duplicate is impossible. Selection changes are
announced through a **polite `role="status"`** — ordinary feedback, never an alert.
Empty results state why ("…과(와) 이름이 일치하는 지역이 없습니다"), and an entirely
uncalculable stream says so instead of looking like a failed search.

## Stale-result handling

Results/errors are shown **only** while they still match the live inputs: a control
change (or a new map candidate) changes the input signature, so an out-of-date result
disappears and a "입력이 변경되었습니다. 다시 계산하세요." notice is shown until the user
recalculates. A superseded in-flight response (inputs changed while it was pending) is
discarded by a monotonic request id and never rendered.

Since Phase 3 the same gate also governs *navigation*: the results view is derived from
`resultCurrent`, so it can only be reached by a successful **current** response, and it
collapses back to setup the moment the inputs stop matching. A late response from
superseded inputs therefore cannot open a stale results screen either. Returning via
설정 바꾸기 is pure view state — it issues no request, clears no input, and does not
touch browser history.

## Candidate integration

When a suitability candidate is selected, its `candidate_id` is passed to the backend
and the result shows the candidate key/region/analytical status/run+profile with the
note that the standard cost does not vary meaningfully by candidate cell, plus the
suitability screening disclaimer and the candidate's own reference year + versions. An
`ELIGIBLE` screening status is never reinterpreted as legally eligible / permitted /
approved / developable, and the dashboard never claims the candidate changes land,
transport, or site-specific cost (unavailable in V1).

## Accessibility

One logical `h1` **on both views** (the results view adds an `<h2>`); section headings in
order; every input has an associated label; the KPI group and each section carry
accessible names; the KPI block is `role="status"` (polite announcement); validation and
calculation errors use `role="alert"`; the funding chart is decorative (`aria-hidden`)
with full text equivalents; no meaning is conveyed by color alone. Native form controls
throughout, and both views keep exactly one `#main-content` skip target and no `<aside>`.

Phase 3 adds two behaviours:

- **Calculating** shows a decorative `Skeleton` (`aria-hidden`, announces nothing) beside
  a separate polite `facility-cost-calculating-status` live region, so the progress is
  announced without the skeleton being read out.
- **Returning to setup** moves DOM focus to the first setup heading
  (`#fc-step-regions`, `tabIndex={-1}` — a programmatic target, never a Tab stop), so a
  keyboard or screen-reader user is not dropped at the top of the document. Focus is
  moved only on a deliberate return, never on first paint.

The results detail sections are native `<details>`/`<summary>` `Accordion`s and sit
**outside** the live region, so a collapsed disclosure is never the only home for a
`role="status"` that must announce while closed. The region table keeps a `<caption>`,
`scope="col"` headers, a `scope="row"` region cell, and its own `overflow-x-auto`
container.

The service-region combobox follows the ARIA 1.2 pattern: the input is `role="combobox"`
with `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, and
`aria-activedescendant` pointing at the keyboard-active option; the popup is a
`role="listbox"` of `role="option"` elements carrying `aria-selected`. DOM focus never
leaves the input, so there is no keyboard trap and Tab always walks straight out. The
selected state is conveyed by `aria-selected` **and** a visible 선택됨 word; selection
changes announce through a polite `role="status"`, never an alert. Facility-type cards
are native radios in a `<fieldset>`/`<legend>`, so keyboard selection is the browser's,
not a custom key handler.

## Tested viewports

390 × 844, 430 × 932, 768 × 1024, 1024 × 768, 1280 × 800, 1440 × 900 — the dashboard is
full width, mounts no map, its KPI/filter/table layouts stay usable, tables scroll
inside their own `overflow-x-auto` container, and the page never scrolls horizontally.

## Tests

- `lib/displayNumber.test.ts` — the documented precision per unit, half-up boundaries,
  comma formatting, exact zero vs sub-unit "미만", malformed input → `null` (never a
  fabricated zero), values beyond `Number.MAX_SAFE_INTEGER`, the caller's string left
  unmutated, and a source scan proving no floating-point path exists.
- `lib/glossary.test.ts` — the reason-code registries cover every code the backend can
  emit, no explanation echoes its own code or implies a zero cost, unknown codes fall
  back to the safe generic sentence, and the transparency centre's wording is preserved
  verbatim.
- `components/FacilityCostDashboard.test.tsx` — controls, validation, the setup↔results
  transition (success navigates, failure stays, inputs preserved on return, no request
  on return, recalculation uses the changed inputs, late responses cannot navigate), the
  hero and three secondary KPIs as approximations, the exact strings in 정밀값과 계산
  기준, the funding breakdown (subsidy + local = installation cost, no approval claim),
  the official-input region table (no invented allocation, never `0명`), the exclusions
  accordion (plain Korean, never a `0` cost, unknown components appended not swallowed),
  the null per-capita path, candidate integration, one `h1`, no map, no `<aside>`,
  and — the terminology audit extended to this surface — that no
  `FORBIDDEN_PRIMARY_TOKENS` entry appears once diagnostic subtrees are removed.
  (The audit lives here rather than in `app/terminology.audit.test.tsx` because that
  file's `homeApiMock` rejects `fetchFacilityCostCalculate`, so no result can be
  rendered there.)
- `app/accessibility.test.tsx` — the suitability sub-view switch (score ↔ cost),
  the full-width cost view mounting no map, and the neutral framing.
- `e2e/facilityCost.spec.ts`, `e2e/integration.spec.ts` — the full scenario→results
  flow at mobile + desktop, zero map containers in the cost view, no horizontal
  overflow, and the round-trip back to the score view (which restores the map).
- `e2e/phase3CostResults.spec.ts` — the results workflow at 1440×900, 1280×800, and
  390×844: the transition, one hero + three secondary KPIs (hero font size strictly
  larger), accordions collapsed then revealing exact values, no raw region code and no
  raw reason code in the VISIBLE text, codes still present in the diagnostic disclosure,
  return-to-setup preserving chips and inputs while issuing no request (verified by
  spying on the request URLs), recalculation carrying the changed value, a failed
  request staying on setup, and no horizontal overflow.
- `e2e/phase3Review.spec.ts` — opt-in design-review screenshots
  (`CAPTURE_PHASE3_REVIEW=1`) written to the gitignored
  `frontend/test-results/phase-3-cost-results/`. It asserts nothing and never writes to
  `docs/ui-baseline/desktop/`, which holds the Phase 0 before-redesign baseline.

The e2e/vitest fixtures are controlled contract fixtures clearly in the test
environment; the cost result is analytical standard-cost data shown only with its
disclaimer + completeness, never labelled as official metric data.

## Deployment status

Implemented on the `feat/floating-legends-and-cost-dashboard` branch and merged to
`main`. **Not deployed** to any environment (AWS or OCI).
