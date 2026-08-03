# UI refresh — 비용 살펴보기 (facility cost) dashboard

The fourth milestone of the civic-dashboard refresh. The first
(`feat/civic-dashboard-foundation`, merged as `a7ce49e`) established the tokens,
the shell, the navigation, and the shared primitives; the second
(`feat/equity-dashboard-refresh`, `8c16759`) rebuilt **지역 부담**; the third
(`feat/suitability-dashboard-refresh`, `68eb2d3`) rebuilt the two map sub-views of
**후보지 분석** and deliberately deferred the third one. This milestone is that
deferral:

```text
후보지 분석 → 비용 살펴보기      mode=suitability   view=cost
```

It is presentation and interaction-clarity work. **No cost formula, term, unit,
rounding rule, validation rule, default, API request, or response handling was
changed** — see §6 and §7.

Everything below was read out of the repository or measured in a real browser at
the stated viewport. Nothing here is aspirational.

## 1. The before-state, and what was wrong with it

The screen worked. Its number contract was already careful — approximations on
primary surfaces, untouched decimals in a disclosure, reason codes mapped to plain
Korean, unavailable never rendered as `0`. The problems were of hierarchy, of what
had to be discovered by clicking, and of one served fact that was never shown.

| # | Before | Why it was a problem |
| --- | --- | --- |
| C1 | The `<h1>` sat in the full-width `max-w-screen-2xl` container while every card below it was centred in `max-w-6xl`. | At 1440px and above the title started ~144px to the left of the first card. The page had two left edges. |
| C2 | Setup was **two** numbered steps (처리할 지역, 처리 조건) followed by an unnumbered `고급 설정` accordion. | The four analytical assumptions that shape the number read as an optional appendix rather than a stage of the calculation. |
| C3 | The assumption VALUES were reachable only by opening that accordion. The 현재 설정 rail described all four with one word: `기본값` / `기본값에서 변경됨`. | A citizen could not see what the calculation was about to assume without clicking, and the rail claimed to be "current settings" while hiding half of them. |
| C4 | The only readiness signal was one line under the button carrying either the validation message or a single blocked reason. | "Why can I not calculate yet, and what else is missing?" had a one-at-a-time answer. |
| C5 | Before a calculation the result area was **empty** — nothing at all. | An empty region reads as "broken" or "still loading", and nothing said that a missing result is not a zero. |
| C6 | The result was one hero + three KPIs followed by **seven visually identical collapsed disclosures**. | 포함되지 않은 비용 (a mandatory caveat) had exactly the weight of 정밀값과 계산 기준 (a diagnostic). A flat stack states no priority. |
| C7 | 국비·지방비 구성 — the only decomposition of the headline cost — was one of those disclosures. | "What is this number made of?" required discovering and opening a `<details>`. |
| C8 | `completeness.is_partial` was served on every response and rendered **nowhere**. | The repository's own rule is that a partial result must not read as complete. The exclusion list implied it, but nothing said it. |
| C9 | 미포함 (an analytical exclusion) and 공식 인구 미확정 (a missing value) were both amber `text-warn`. | `design-tokens.md` §"Missing data": amber means "be careful with a value that exists"; absence is a neutral state and an exclusion-by-rule is a third thing again. |
| C10 | The eight non-claims were one flat bullet list mixing five excluded COSTS with three things the number IS NOT. | Two different kinds of statement under one heading. |

## 2. The setup layout that replaced it

```text
Application bar + 후보지 분석 sub-view selector   (shared chrome — rendered once, unchanged)
└── 비용 살펴보기 workspace  (<main>, full width, map-free, normal document scrolling)
    └── max-w-6xl content column
        ├── PageHeader          시설 비용 살펴보기 + task line   (the view's single <h1>)
        ├── 알림 InfoBanner      screening disclaimer → page disclaimer → three non-claims
        ├── 분석에 포함되지 않은 항목 8가지   collapsed, now under TWO headings
        └── grid  lg:[minmax(0,1fr) 20rem]
            ├── setup steps
            │   ├── 1. 처리할 지역     SearchableRegionPicker  (focus target #fc-step-regions)
            │   ├── 2. 처리 조건       waste stream · processing share · facility-type cards
            │   └── 3. 계산 가정       the four assumption VALUES, then 고급 설정 (collapsed)
            └── 현재 설정  (lg:sticky)
                ├── 5 summary rows (label left / value right)
                ├── 계산 준비 상태     4-item checklist
                ├── 비용 계산하기      the primary action
                └── role="status"     why it is unavailable
        └── 아직 계산한 결과가 없습니다   EmptyState — an instruction, never a placeholder cost
```

Section order follows the workflow the milestone is meant to support: *what does
this include and exclude* → *what am I calculating for* → *under what conditions*
→ *under what assumptions* → *can it run yet* → *run it*.

### Why the assumptions are listed in step 3 and not in the rail

A first pass listed the four assumption values in the 현재 설정 rail, which is
where a "current settings" summary belongs on paper. It made the rail ~200px
taller and pushed 비용 계산하기 below the fold at 1280×800 and 1440×900 —
`e2e/facilityCost.spec.ts` measures exactly that, and it is the entire purpose of a
sticky action rail. The values moved to step 3, beside the controls that set them,
which is also the better place for them; the rail keeps the unchanged
`기본값` / `기본값에서 변경됨` row as the statement that they still hold.

This is recorded because it looks like a styling preference and is not: it is a
measured constraint with a test that enforces it.

## 3. The result layout that replaced it

```text
└── max-w-6xl content column
    ├── result actions       ← 설정 바꾸기   (the only real action this screen has)
    ├── h2 시설 비용 계산 결과 + scenario context line
    ├── 알림 InfoBanner       the four non-claims
    ├── 주의 · 부분 계산 결과  InfoBanner, ONLY when completeness.is_partial   [new]
    ├── 핵심 결과             [계산값]  hero KPI + three secondary KPIs   (role="status")
    ├── 비용 구성             [계산값]  the funding composition — now VISIBLE   [promoted]
    ├── 빠진 항목과 주의사항            counts + "not zero" visible; the list in a disclosure
    ├── 분석에 사용한 공식 자료 [공식 값] 지역별 공식 투입 데이터 · 선택한 후보지 정보
    └── 계산 기준·출처·버전             계산 가정 · 출처와 계산 방법 · 정밀값과 계산 기준
```

Seven equal disclosures became five titled sections, each stating what it holds.
Five disclosures remain, but each now sits under a heading that says why it is
there — and the two facts that must not be discovered by clicking (the composition
of the cost, and the fact that items are missing) are outside them.

**There is no 비교 section.** The dashboard has no candidate, region, or
configuration comparison to preserve, and this milestone was explicitly forbidden
to invent one — see §11.

## 4. The one deliberate contract change: 비용 구성 is no longer a disclosure

`facility-cost-funding-section` (the `<details>` labelled 국비·지방비 구성) is
gone. Its body, `facility-cost-funding`, is now visible section content under the
heading **비용 구성**.

* **What it protects, kept:** the exact served amounts (`fc-funding-subsidy`,
  `fc-funding-local`, `fc-funding-total`), their order, the decorative
  `aria-hidden` bar, the rate and its basis (`fc-funding-scheme`,
  `fc-funding-rate-basis`), the "보조금 승인을 의미하지 않으며" caption, the served
  note, and the rule that the annualized cost is not summed into the total.
* **What changed:** it is not collapsed, so `openSection()` no longer applies to
  it, and each row now also names what KIND of cost it is (`일회성 · 설치비 산정액의
  일부` / `일회성 합계`) with one sentence stating the composition relationship in
  words.
* **Tests moved with it, not weakened:** `FacilityCostDashboard.test.tsx` drops
  funding from "collapses every detail section by default" and gains
  "shows the cost composition WITHOUT a disclosure to open"; the two behaviour
  assertions (exact amounts, no approval claim) are unchanged and now run without
  opening anything. `e2e/phase3CostResults.spec.ts` drops it from
  `RESULT_SECTIONS` and asserts the same amounts in place. `e2e/phase3Review.spec.ts`
  (opt-in screenshot capture) captures it in place.

No other markup assertion in the repository was changed by this milestone.

## 5. Components

New, under `frontend/src/components/facilityCost/` — all presentational, none
holding workflow state:

| Component | Replaces | Owns |
| --- | --- | --- |
| `shared.ts` | the constants and pure helpers at the top of `FacilityCostDashboard.tsx` | copy, `validateScenario`, `excludedCostRows`, the format wrappers, `ScenarioState` |
| `FacilityCostNotice` | the same function in the dashboard | nothing — the banner and the (now grouped) eight-item disclosure |
| `FacilityCostSetupPanel` | `FacilityCostSetup`'s left column + `FacilityTypeCards` | nothing — the three step cards and every existing control |
| `FacilityCostSetupSummary` | the same function in the dashboard | nothing — the summary rows, the **new** readiness checklist, the action |
| `FacilityCostResultSummary` | `FacilityCostHeroKpi` + `FacilityCostSecondaryKpis` | nothing |
| `FacilityCostBreakdown` | `FacilityCostFundingBreakdown` | nothing |
| `FacilityCostLimitations` | `FacilityCostExclusions` | nothing |
| `FacilityCostOfficialInputs` | `FacilityCostRegionTable` + `FacilityCostCandidateContext` | nothing |
| `FacilityCostMethodology` | `FacilityCostAssumptions` + `FacilityCostEvidence` + `FacilityCostExactValues` | nothing |

`FacilityCostDashboard.tsx` was **not** rewritten to be shorter. Its state machine
is untouched and it still owns every piece of it — `options`, `optionsError`,
`scenario`, `advancedDefaults`, `result`, `calcError`, `calculating`, `view`,
`outputSig`, the `requestSeq` ref, the focus refs, `currentSig` / `resultCurrent` /
`errorCurrent`, `regionOptions`, `update`, `calculate`, and `editSettings`. It
gained no state, no effect, no memo, and no API call; the file went 1822 → 710
lines because the JSX moved, not because behaviour did.

Shared primitives adopted: `PageHeader` (the `<h1>`), `SectionCard` (every card on
both screens), `DataStatusBadge` (provenance + the two token corrections in §9),
`EmptyState` (the new pre-calculation state), plus the `InfoBanner`, `Accordion`,
`KpiCard`, `Skeleton`, and `SearchableRegionPicker` already in use.

Deliberately **not** used:

* `KpiCard`'s `status` slot on the hero — the slot renders inside the `<dt>`, and
  the hero's `<dt>` must equal the served term `주민 1인당 환산 지방비` and nothing
  else (a test compares it with `.toBe`). The 계산값 badge sits on the section
  header instead, where it governs all four cards.
* `FilterChip` / `SegmentedControl` / `Chip` — nothing on this screen is a filter,
  a segment, or a removable token except the region chips, which
  `SearchableRegionPicker` already renders through `Chip`.
* A second state store, a second form representation, and a second result.

### One narrow shared-component change

`SectionCard` gained two optional props, `headingId` and `headingRef`. Setup step 1
is the documented focus target the results view returns to (`#fc-step-regions`,
asserted by `FacilityCostDashboard.test.tsx`), and a card cannot be that target
without a fixed id and a ref. A heading given a `headingRef` also receives
`tabIndex={-1}`, so it is focusable programmatically and never a Tab stop.
`aria-labelledby` follows the resolved id, so the accessible name is unchanged.
Both props are optional and every existing call site is unaffected; two tests were
added in `components/ui/dashboardPrimitives.test.tsx`.

## 6. Existing analysis reused — nothing new was fetched or computed

| Surface | Source |
| --- | --- |
| facility types, subsidy schemes, multiplier bounds, default operating days, cost versions | `fetchFacilityCostOptions` (unchanged call, unchanged seeding) |
| every cost figure | `fetchFacilityCostCalculate` (unchanged call, unchanged payload) |
| primary-surface numbers | `approximateWonAsManwon` / `approximateBillionWon` / `approximateAnnualBillionWon` / `approximateTonPerDay` / `approximatePercent` (`lib/displayNumber.ts`, unchanged) |
| exact values | the served decimal strings through `formatQuantity` (`lib/metrics.ts`, unchanged) |
| reason codes → plain Korean | `MISSING_COMPONENT_META`, `missingReasonExplanation`, `perCapitaUnavailableExplanation`, `accountingBasisLabel` (`lib/glossary.ts`, unchanged) |
| region display names and ordering | `regionDisplayName` (`lib/regionDisplay.ts`, unchanged) |
| candidate status / profile names, stability badge | `statusLabel`, `profileLabel`, `stabilityBadgeLabel` (unchanged) |
| partial-result statement | `completeness.is_partial` and `completeness.included_components.length` — both already served, now displayed |

The only arithmetic anywhere in the new components is the pre-existing
`Number()`-based proportion for the decorative funding bar and the labelled derived
display share in the region table. Both were already there and neither produces a
value described as exact.

## 7. Formulas intentionally untouched

Unchanged: the standard-construction-cost formula, the matched capacity band and
its inclusivity semantics, the unit cost, the underground multiplier, the capacity
calculation from annual quantity and operating days, the processing-share
application, the annualization method and assumed lifetime, the nominal subsidy
rate and the simplified local share, the per-capita conversion and its
unavailability reasons, the completeness/missing-component contract, every
validation bound (0–100 %, 1–366 days, the served multiplier range), every default,
the request payload, the response types, the request-supersession guard, the
result-currency (`outputSig`) rule, and the `derivation_version` / `cost_version` /
reference-period provenance.

No cost calculation was reimplemented inside a visual component, no total is
recomputed from a displayed string, and no backend value is reverse-engineered on
the client.

## 8. Missing, partial, and excluded data

The screen now distinguishes four states rather than styling three of them the
same way:

* **부분 계산 결과 (served `is_partial`).** A standing `InfoBanner tone="warning"`,
  above the numbers it qualifies, naming how many cost items were included and how
  many were not, and stating that the missing ones are not zero. It carries **no**
  `role="alert"` — it is standing content, not an event.
* **분석 제외 (an exclusion by rule).** Each of the five rows in 포함되지 않은 비용
  now carries `DataStatusBadge status="excluded"` with the text label 미포함, plus
  the served reason underneath. The count and the "비용이 0이라는 뜻이 아닙니다"
  sentence sit OUTSIDE the disclosure, so the caveat is readable while it is
  closed.
* **자료 없음 (a value that was not served).** 공식 인구 미확정 and the uncomputable
  display share moved from amber to `DataStatusBadge status="missing"` — the
  neutral no-data gray, always with its text label. So did the unavailable
  per-capita in 정밀값과 계산 기준.
* **계산 불가 (a served unavailability reason).** The hero keeps its position and
  renders the plain-Korean rendering of the served `unavailable_reason` — never a
  fabricated `0원`, never a per-capita of our own.

Unchanged and re-verified: an unrecognised component is appended rather than
swallowed; the raw codes survive in `[data-diagnostic]` disclosures; the primary
results surface contains no `FORBIDDEN_PRIMARY_TOKENS` entry; and the region table
invents no per-region cost allocation.

## 9. Provenance and version display

* 핵심 결과 and 비용 구성 carry `DataStatusBadge status="derived"` (계산값 — "공식
  자료를 이 플랫폼이 계산한 값이며 공식 발표 수치가 아님"); 분석에 사용한 공식 자료
  carries `status="reported"`. Provenance is stated once per section rather than
  repeated on every card.
* The subsidy rate's source and reference period travel with the rate everywhere it
  appears: the full sentence beside the selector (`facility-cost-subsidy-note`,
  unchanged), and the source half of it under the step-3 assumption list.
  `SUBSIDY_RATE_FORM_NOTE` is still the exact same string — it is now composed from
  `SUBSIDY_RATE_SOURCE_NOTE + SUBSIDY_RATE_NON_CLAIM`.
* Sources, reference periods, the accounting basis in plain Korean, and the served
  disclaimer stay in 출처와 계산 방법; the raw `derivation_version`, `cost_version`,
  annualization method, accounting-basis code, reference year, and included-component
  codes stay demoted to the `기술 정보` diagnostic disclosure.
* The eight non-claims are now grouped under **이 계산에 포함되지 않은 비용** (5) and
  **이 값이 아닌 것** (3). The strings, their order, and the count in the summary are
  unchanged — `COMPLETENESS_NOTICES` is still the concatenation of the two arrays,
  so the count cannot drift from the items.

## 10. Accessibility decisions

* **One `<h1>`, one `<main>`, one navigation, one sub-view control, zero maps** on
  both the setup and the result screen, asserted at four viewports. The `<h1>` is
  now `PageHeader`'s, so the "exactly one" rule is enforced by the shared primitive
  rather than by a hand-rolled header.
* **No `<aside>`.** The summary rail is a `SectionCard`, i.e. a `<section>`; in this
  codebase `<aside>` marks the equity map sidebar specifically and two other suites
  assert the map-free pages have none.
* **`role="alert"` is used exactly twice**, both for genuine, actionable errors that
  have just occurred: the options-load failure and the calculation failure. The
  out-of-range numeric message keeps its alert because the user has just put a value
  out of bounds. Everything else is polite: the calculate status line, the
  calculating announcement, the stale notice, and the picker's selection feedback
  stay `role="status"`; the standing disclaimers, the partial-result banner, and the
  readiness checklist carry no live-region role at all.
* **The readiness checklist states each item in words** (`✓` / `!` plus the item name
  and its detail), so it never depends on colour, and it repeats an active validation
  message verbatim rather than paraphrasing it.
* **Native controls stayed native.** The region picker is the unchanged ARIA 1.2
  combobox; facility type is unchanged native radios in a `<fieldset>`; every
  numeric input keeps its `min`/`max`/`step`; the disclosures are native
  `<details>`; every action is a native `<button>`.
* **The live region still holds only the answer.** `facility-cost-results` wraps the
  hero and the three KPIs and nothing else, so no collapsed `<details>` is ever the
  only home for a `role="status"`.
* **Focus on return is unchanged**: 설정 바꾸기 moves DOM focus to `#fc-step-regions`,
  now via `SectionCard`'s `headingRef`, still `tabIndex={-1}` and never a Tab stop.
* **The region table** keeps its `<caption>`, `scope="col"` headers, `scope="row"`
  region cell, and its own `overflow-x-auto` container.

## 11. Deliberately not built

* **A comparison section.** The dashboard supports no candidate, region,
  configuration, or baseline comparison today: `candidate_context` is context for
  one calculation, not a second one. The milestone forbids inventing a comparison
  calculation, and an empty 비교 card would have been a section built to match a
  diagram. Nothing was removed either.
* **An export, report, or share action.** `ShareExportBar` and `ReportPreview` are
  mounted by the equity map branch in `page.tsx`, below the cost early-return — the
  cost view has never had one. A decorative button with no action is explicitly out
  of scope, so the result-actions row holds the one real action there is, and a test
  asserts the results view contains exactly that one button.
* **Anything mobile.** No drawer, bottom sheet, tab bar, or carousel. The existing
  sub-1024 behaviour is preserved as-is; the cost e2e specs still run at 390×844 and
  pass unchanged.

## 12. Viewport behaviour

Measured in Chrome with the mocked backend, on the setup and result screens:

| Viewport | Page h-overflow | Calculate button (before scrolling) | Hero (result) | Nested scroll panes |
| --- | --- | --- | --- | --- |
| 1024 × 768 | none | fully inside the viewport | inside the first viewport | none |
| 1280 × 800 | none | fully inside the viewport | inside the first viewport | none |
| 1440 × 900 | none | fully inside the viewport | inside the first viewport | none |
| 1920 × 1080 | none | fully inside the viewport | inside the first viewport | none |

Unlike the map views, the cost view scrolls the **document** — that is expected for
a long report, and the new spec asserts both that the document actually scrolls and
that the dashboard subtree contains **zero** nested vertical scroll containers. The
only bounded horizontal fallback is the region table's own `overflow-x-auto`, which
is asserted to be the thing that scrolls rather than the page.

## 13. Tests

`frontend/src/components/FacilityCostDashboard.test.tsx` — 66 assertions (was 52).
The 50 pre-existing ones are unchanged except the two in §4. Added:

* the three numbered setup steps, with step 1 still `#fc-step-regions`;
* the eight non-claims still all present, now under their two headings, with the
  count in the summary still matching the list;
* the four assumption values stated outside the accordion, updating live, with the
  unchanged `기본값` / `기본값에서 변경됨` row and the subsidy provenance beside them;
* the readiness checklist reporting region count, calculable coverage, facility
  types, and the verbatim validation message — never enabling a blocked action, and
  carrying no live-region role;
* the pre-calculation instruction, its "not zero" sentence, and the absence of any
  result-shaped surface before a calculation;
* the instruction being replaced by the in-flight state and then by the error;
* the "a previous result will be replaced" line appearing only once one exists;
* the five titled result sections and the absence of a second `h1`;
* the derived/reported badges, with the hero's `<dt>` still exactly the served term;
* exactly one action button on the results view;
* the partial-result statement, its counts, its lack of `role="alert"`, and its
  absence when the response does not mark itself partial;
* the count and "not zero" sentence being readable outside the collapsed disclosure;
* excluded terms carrying the excluded status and a missing population carrying the
  missing status — with `0명` still absent.

`frontend/e2e/facilityCostDashboard.spec.ts` — 26 assertions at 1024×768,
1280×800, 1440×900, and 1920×1080, self-mocked, structure and geometry only:

* no horizontal overflow on setup, on validation, on results, and with the wide
  table open;
* one `h1` / one `top-navigation` / one `mode-switch` / one `suitability-subviews` /
  one `#main-content` / zero `map-container`;
* all three setup steps individually reachable, and the calculate button fully
  inside the first viewport before any scrolling;
* the readiness summary explaining the disabled action;
* the pre-calculation instruction, with no hero, no funding block, and no result
  region present;
* the selected region visible in both the picker and the rail, and an out-of-range
  value blocking the action with the message visible in both places;
* all five result sections reachable by ordinary page scrolling, the document
  actually scrolling, and zero nested vertical scroll containers;
* the cost composition visible without opening anything, and neither the KPI row nor
  the composition row overflowing its container;
* the region table's own container being the bounded horizontal fallback;
* the result actions reachable and 설정 바꾸기 preserving the selection;
* cost ↔ score ↔ scenario switching with exactly one map on each map sub-view and
  none on cost, the sub-view control never doubling, and a shared
  `?v=1&mode=suitability&view=cost` link restoring with the screening disclaimer.

`frontend/src/components/ui/dashboardPrimitives.test.tsx` — 2 added assertions for
`SectionCard`'s `headingId` and `headingRef`.

Unchanged and re-run green: `e2e/facilityCost.spec.ts`,
`e2e/phase3CostResults.spec.ts` (bar §4), `e2e/integration.spec.ts`,
`e2e/citizenFlows.spec.ts`, `e2e/desktopNavigation.spec.ts`,
`e2e/civicShell.spec.ts`, `e2e/suitabilityDashboard.spec.ts`,
`e2e/phase7FinalRegression.spec.ts`, `app/shell.test.tsx`,
`app/accessibility.test.tsx`, `app/page.suitabilityDashboard.test.tsx`, and
`app/terminology.audit.test.tsx` — which between them own the cross-view contract
(one map on score, one on scenario, none on cost; the sub-view switch rendered once;
URL restoration to `mode=suitability&view=cost`).

Deliberately no pixel snapshots — the repository has no visual-regression
infrastructure (`baseline.md` §7).

## 14. Remaining risks

* **The sticky rail's height budget is not enormous.** At 1024×768 the calculate
  button clears the fold, but adding two more rows to 현재 설정 or two more
  readiness items would put it at risk again. The e2e assertion catches it; the
  fix, if it ever fires, is to move content below the button rather than to relax
  the assertion.
* **`is_partial` is now load-bearing copy.** If the backend ever serves
  `is_partial: false` alongside a non-empty `missing_components`, the banner
  disappears while the exclusions remain. That is the honest reading of the two
  fields, and the exclusion list still states the same facts, but it is worth
  knowing the two are displayed independently.
* **The 계산값 / 공식 값 badges are section-level.** A future section that mixes
  reported and derived values would need per-card badges instead; the hero cannot
  take one without breaking its `<dt>` contract (§5).

## 15. Deferred work

* **매립지 현황 and 데이터·출처** keep their current treatment; they belong to their
  own milestones.
* **`DerivedPanel` / `SourcePanel`** (the equity 출처와 계산 방법 disclosure) were
  again not restyled — unchanged from the previous two milestones' deferral.
* **Mobile.** No mobile-specific work was done, per scope.
* **Deployment.** This milestone is **not deployed**. OCI currently runs the
  land-cover release; the whole UI refresh has not been shipped there.
