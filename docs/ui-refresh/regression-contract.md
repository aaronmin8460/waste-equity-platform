# UI refresh — regression contract

What the visual refresh may **not** change. Every item below is enforced by a test
that already exists or that this milestone added; the test is named so a future
phase can find it before "cleaning up" the behavior it protects.

A change to any item here is a product decision, not a styling decision.

The file spans the whole refresh. §1–§9 are the shared contracts; §10–§11 record
the two decisions the **civic-dashboard foundation** milestone took deliberately;
§12–§13 add what the **지역 부담 dashboard** milestone contracted and confirm it
changed no existing expectation (see `equity-dashboard.md`); §14–§15 do the same
for the **후보지 분석 dashboard** milestone (see `suitability-dashboard.md`);
§16–§17 add what the **비용 살펴보기 dashboard** milestone contracted and record its
one deliberate change (see `facility-cost-dashboard.md`); §18–§19 add what the
**매립지 현황 dashboard** milestone contracted and confirm it changed no existing
expectation (see `landfill-dashboard.md`); §20–§21 do the same for the
**데이터·출처 dashboard** milestone (see `transparency-dashboard.md`); §22–§24 record
what the **final UI integration** milestone established across all six areas at once
(see `final-integration-regression.md`); §25 records the **collapsible map insight**
follow-up (see `equity-dashboard.md` §12 and `suitability-dashboard.md` §14); §26
records the **UI correction pass** after the post-production visual review, which
deliberately restates §5, §10, and §16 (see
`docs/YEOGIDA_AUTONOMOUS_RUN.md`). **§5 and §10 are superseded by §26.1 and §26.2** —
read those first.

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
* **Map-workspace overlays are the page's, and they stack.** The legend and the
  지역 부담 / 후보지 분석 insight disclosure are children of ONE bottom-anchored flex
  column inside `.map-pane`, not two separately-anchored cards — hand-tuned
  `bottom-*` offsets overlap as soon as either grows a line of Korean text at a
  narrower width. `MapLegendOverlay` therefore owns no positioning of its own.
  Anything added to that band joins the column; nothing in it may be placed in flow
  **below** the map, which would shorten the canvas and break the bullet above. The
  insight is right-aligned within that column (`justify-end`) and the legend keeps
  the map's left edge, but the insight is still structurally BELOW the legend, so
  opening it lifts the legend rather than covering it (§25).
* `MapView` stays the DIRECT child of the `.map-pane` wrapper — overlays are its
  siblings (`app/page.phase4.test.tsx`, `app/responsive.test.tsx` both read
  `map-container.parentElement`).

Enforced by: `app/shell.test.tsx`, `app/page.selection.test.tsx`, `components/MapView.test.tsx`,
`app/page.equityDashboard.test.tsx`, `e2e/desktopNavigation.spec.ts`,
`e2e/responsive.spec.ts`, `e2e/civicShell.spec.ts`, `e2e/equityDashboard.spec.ts`.

## 5. Metric radios

> **SUPERSEDED by §26.1** (UI correction pass). The three groups below were re-cut
> into three SUBJECT sections and the eleven radios into seven category rows plus a
> 총량/1인당 switch. The structural guarantees — three fieldsets, one logical radio
> group, nothing behind a disclosure, four selection signals — carried over verbatim.

The equity metric controls stay **three labelled `<fieldset>` groups** — total,
per-capita, burden (`metric-group-total`, `metric-group-per_capita`,
`metric-group-burden`) — with the same number of radios, the same grouping, and the
same accessible names. `e2e/accessibility.spec.ts` asserts the page has exactly three
fieldsets, so no new primitive may introduce a fourth.

They live in `components/equity/EquityMetricSelector.tsx` since the equity-dashboard
milestone, and the rules travelled with them:

* eleven `input[type=radio][name="metric"]` in ONE logical group, so native arrow
  keys still traverse all of them — never a `<select>`, tabs, chips, or an
  accordion that hides a family on desktop;
* each `<legend>` renders its `MetricGroup.legend` string and **nothing else** —
  `app/page.phase4.test.tsx` compares the three with `toEqual`, so a count badge or
  an icon inside a legend breaks it;
* selection is signalled by the native `checked` radio + font weight + border in
  addition to the tint.

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
* A region whose value is unavailable is **never silently dropped**. The 지역 비교
  card that carried this rule was removed by the correction pass; 지표 순위 전체보기
  (§26.3) carries it now — such a region is not ranked, not ranked last, and not
  omitted, but named in its own 값이 없어 순위에서 제외한 지역 list with the count and
  an explicit 0으로 채우지 않았습니다.
* A card never fabricates a second value to fill a grid. When
  `metricReferencePeriod` is empty the 자료 기준 item is omitted, leaving fewer
  items — not padded with a placeholder.

Enforced by: `components/ui/primitives.test.tsx`,
`components/ui/dashboardPrimitives.test.tsx`, `lib/exports.test.ts`,
`app/accessibility.test.tsx`, `app/page.equityDashboard.test.tsx`,
`app/page.phase4.test.tsx`, `e2e/responsive.spec.ts`.

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

> **PARTLY SUPERSEDED by §26.2** (UI correction pass). The `<h1>`-is-the-area-title
> decision below still holds everywhere. On 지역 지표 the heading is now `sr-only`
> and the scope tagline + orientation strip were removed from that area entirely.

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

## 12. The 지역 부담 current-selection summary and its sections

Added by the equity-dashboard milestone (`docs/ui-refresh/equity-dashboard.md`).
The equity control column is now four presentational components under
`frontend/src/components/equity/`, and these facts travel with them:

* **One summary card, one provenance list.** `selected-region-summary` holds the
  region name, the served value, the 현재 지표 / 자료 기준 pair, the source lines,
  and a `DataStatusBadge`. The former second card is gone; `metricProvenance` must
  not be printed twice on one screen again.
* **`selected-metric-summary` stays a `role="status"` live region wrapping ONLY the
  metric name and unit.** The provenance caption is deliberately outside it — inside,
  it would be re-read on every radio change. The metric name keeps
  `text-base font-semibold` and the unit `text-xs`, i.e. visibly dominant
  (`app/page.phase4.test.tsx`, `e2e/phase4EquityMap.spec.ts` compare the two
  computed font sizes).
* **The region control stays a native `<select>`** named 지역 선택
  (`components/equity/EquityRegionPicker.tsx`). It is NOT replaced by
  `components/ui/SearchableRegionPicker.tsx`, which is the facility-cost setup
  picker. It is bound to the RESOLVED selection (`selectedRegion?.regionCode`), not
  to the raw stored code, so a metric change to a geography that lacks the region
  returns it to its empty option instead of holding a value not in its list.
* **`DataStatusBadge` on this screen states metric PROVENANCE, not confidence.**
  `derived` for `waste-per-capita` / `facility-burden` (computed from two official
  inputs), `reported` otherwise, `missing` when the selected region has no served
  value. It is read off `metric.dataset`; it must never become an input to a value,
  a rank, a break, or a color.
* **The insight strip states limitations, never conclusions.** It may show the
  active metric's label/unit, its served reference period and source lines, and
  standing limitations this application already documents. It must not claim a
  region is unjust, unsafe, a good site, or responsible for another region's waste,
  and it carries **no** `role="alert"` — it is standing content.
* **No control on this screen is duplicated.** Exactly one `region-select`, one
  `comparison-search`, one `rank-topn`, one `region-ranking`, one
  `region-comparison`, one `share-export`, one `aside`.

Enforced by: `app/page.equityDashboard.test.tsx`, `app/page.phase4.test.tsx`,
`app/accessibility.test.tsx`, `app/page.selection.test.tsx`,
`e2e/equityDashboard.spec.ts`, `e2e/phase4EquityMap.spec.ts`,
`e2e/accessibility.spec.ts`.

## 13. The equity-dashboard milestone changed no test expectation

Unlike §10, this milestone has no deliberate contract change to record: every
pre-existing unit and e2e assertion passes unmodified.

One naming decision is worth keeping, because it looks like a styling choice and is
not. The insight strip's action that opens the data-source area is labelled
**출처 자세히 보기**, not 데이터·출처 화면 열기. `e2e/citizenFlows.spec.ts` locates the
navigation tabs by accessible name **without** `exact: true`, so any second control
whose name CONTAINS a frozen nav label (§1) makes that locator ambiguous — and it is
a genuine ambiguity for a screen-reader user scanning by name, not merely a test
artefact. The component was renamed; the test was left alone. Any future control
that references an area must name the action, not repeat the area's frozen label.

## 14. The 후보지 분석 workspace and its one-control rule

Added by the suitability-dashboard milestone
(`docs/ui-refresh/suitability-dashboard.md`). The score sidebar is now six
presentational components under `frontend/src/components/suitability/`, and these
facts travel with them:

* **The status-visibility control lives ONCE, in the floating legend.**
  `status-toggle-{ELIGIBLE,REVIEW_REQUIRED,EXCLUDED}` and `stable-only-toggle` are
  the only controls for that state anywhere on the screen; the sidebar's
  후보 상태 요약 REPORTS it in words (`지도 표시 중` / `지도에서 숨김`, and a sentence
  when 안정 후보만 보기 is on) and adds no second control. Three files contract those
  test ids — `components/MapLegendOverlay.test.tsx`, `e2e/integration.spec.ts`, and
  the live `e2e/landCoverLayer.spec.ts` — so relocating them is a contract change
  that must move those tests with it, not a styling edit. The legend's per-status
  count (`statusCounts`) is OPTIONAL and `null` until the summary loads: a count is
  never fabricated as `0`.
* **Status swatch colors are passed in, never re-declared.**
  `CANDIDATE_STATUS_COLORS` in `app/page.tsx` is built from `CANDIDATE_SCORE_PALETTE_5[3]`,
  `CANDIDATE_REVIEW_COLOR`, and `CANDIDATE_EXCLUDED_COLOR` (`lib/metrics.ts`) and
  handed to the sidebar summary. No suitability component contains a color literal,
  so the summary, the legend, and the MapLibre fill cannot drift.
* **The suitability map insight strip is the legend's SIBLING in the one bottom
  overlay column**, exactly like the equity strip (§4). It renders at `lg`+ only,
  states 해석 / 주의 / 현재 기준·출처, carries **no** `role="alert"`, and shows no
  score, rank, or count — so it cannot render a missing value as a zero. Version
  strings appear only inside its `기술 정보` disclosure, in a `[data-diagnostic]`
  node.
* **The selected-candidate summary has an explicit empty state.**
  `candidate-detail-empty` names both selection paths; it never renders a sample
  candidate, a placeholder score, or a `0`. A missing component score renders `-`
  with the sentence `점수가 -인 항목은 자료가 없다는 뜻이며 0점이 아닙니다`; a review
  candidate shows `참고용 임시 점수` + `순위 없음`; an EXCLUDED candidate shows its
  reasons, no score, no rank, and is NOT styled or roled as an error.
* **The ranked list stays neutral.** Its heading is `점수가 높은 후보 구역` and
  `SCORE_RANK_FRAMING` sits directly under it. 최적 / 최고 / 추천 / 건설 권고 must not
  appear next to a rank, in either sub-view.
* **The scenario view names its four weights apart** — 현재 운영 기준 / 사용자 설정 /
  적용된 시나리오 결과 / 비교 기준 — and must never say 새 공식 기준, 확정 기준, or
  정책 가중치. The weight controls keep integer `step={1}` in `[0,100]` and their
  accessible names `"<code> · <label> 가중치 슬라이더 | 퍼센트 입력"`, which
  `e2e/scenario.spec.ts` and `e2e/citizenFlows.spec.ts` locate them by. The total
  validation stays `role="status"`, never `role="alert"`.
* **`role="alert"` on these two sub-views is reserved for two genuine errors**: the
  suitability meta-load failure (`suitability-error`) and the scenario preview
  request failure (`scenario-error`).
* **The suitability `<fieldset>`s are suitability-only.** The profile selector is a
  fieldset, and so is the scenario weight editor. The "exactly three fieldsets"
  assertions in `e2e/accessibility.spec.ts`, `e2e/phase4EquityMap.spec.ts`,
  `app/accessibility.test.tsx`, `app/page.phase4.test.tsx`, and
  `app/page.equityDashboard.test.tsx` are all on the 지역 부담 view and must stay
  true there.

Enforced by: `app/page.suitabilityDashboard.test.tsx`, `app/page.phase0.test.tsx`,
`app/accessibility.test.tsx`, `app/terminology.audit.test.tsx`,
`components/MapLegendOverlay.test.tsx`, `components/SuitabilityScenarioLab.test.tsx`,
`lib/suitability.test.ts`, `e2e/suitabilityDashboard.spec.ts`, `e2e/scenario.spec.ts`,
`e2e/citizenFlows.spec.ts`, `e2e/integration.spec.ts`.

## 15. The 후보지 분석 milestone changed no test expectation

Like §13 and unlike §10, this milestone has no deliberate contract change to
record: every pre-existing unit and e2e assertion passes unmodified.

Two decisions are worth keeping, because both look like styling choices and are
not:

1. **`CriticMethodNote` kept its heading `CRITIC 데이터 기반 가중치` and still prints
   the run's raw decimal weights.** A first pass replaced both with plain-Korean
   equivalents; `app/accessibility.test.tsx` asserts the heading string AND that
   the note contains the run's actual `0.31`, which exists to prove the note shows
   run-specific CRITIC weights rather than a constant. Rather than relax that, the
   note now carries BOTH: `namedWeights` (Korean names + percentages) as the
   primary line, and the served decimals demoted to a `[data-diagnostic]` line.
   Codes are demoted, never deleted.
2. **`candidate-counts` moved from a sentence to the `<dl>` of status rows.** The
   test id is on the list itself, so `terminology.audit.test.tsx` and
   `app/page.phase0.test.tsx` still read the three plain status names and still
   find no raw enum — with no duplicated, screen-reader-only copy of the sentence
   beside the visible rows.

One behaviour changed, in `lib/suitability.ts` `weightPercent`: a **blank** weight
string now renders `-` instead of `0%`. `Number("")` is `0`, so the lifted version
would have printed a confident `0%` for a missing weight. No call site passes a
blank today; the change is covered by `lib/suitability.test.ts`.

## 16. The 비용 살펴보기 workflow and its calculation contract

Added by the facility-cost milestone (`docs/ui-refresh/facility-cost-dashboard.md`).
The cost view is now nine presentational components under
`frontend/src/components/facilityCost/`, and these facts travel with them:

* **`FacilityCostDashboard.tsx` remains the ONE owner of the cost workflow state.**
  `options`, `optionsError`, `scenario`, `advancedDefaults`, `result`, `calcError`,
  `calculating`, `view`, `outputSig`, the monotonic `requestSeq`, and the setup
  focus refs all still live there, and every component in `facilityCost/` is
  presentational. There is no second form representation, no second result, no
  duplicated validation, and no re-implementation of a cost formula in a visual
  component. `validateScenario` moved to `facilityCost/shared.ts` **verbatim** —
  same bounds (0–100 %, 1–366 days, the API-served multiplier range), same
  messages.
* **The results view stays DERIVED.** It renders only while `resultCurrent` holds,
  a superseded in-flight response is still discarded by `requestSeq`, 설정 바꾸기 is
  still pure view state that issues no request and clears no input, and a failed
  calculation still stays on setup with `role="alert"` and the settings intact.
* **The number contract is untouched.** Primary surfaces show
  `lib/displayNumber.ts` approximations; 정밀값과 계산 기준 shows the served decimal
  strings through `formatQuantity` only. No exact value is reconstructed from an
  approximation, and `Number()` still appears in exactly two places that were
  already there — the decorative funding bar's widths and the labelled derived
  display share in the region table.
* **A missing result is not a zero, and it is now SAID.** Before a calculation the
  view renders an explicit instruction (`facility-cost-no-result`) stating that no
  result is not a zero and that no example figure is being shown. It is replaced by
  the in-flight state and by the error state, never shown alongside them, and no
  KPI, skeleton value, or sample amount stands in for a result.
* **`completeness.is_partial` must be stated when served.** A partial response
  renders `facility-cost-partial` — an `InfoBanner tone="warning"` naming the
  included and excluded item counts and stating the excluded ones are not zero. It
  carries **no** `role="alert"`. The screen must never read as complete when the
  response marks itself partial.
* **Four data states are visually distinct, and none is amber-by-default.**
  분석 제외 → `DataStatusBadge status="excluded"`; a value that was not served →
  `status="missing"` (the neutral no-data gray, always with its text label);
  a served unavailability reason → the plain-Korean reason in the value's place,
  never `0`; a request failure → `InfoBanner tone="error"` + `role="alert"`.
  `text-warn` is reserved for caveats about values that exist.
* **The eight non-claims stay eight.** `COMPLETENESS_NOTICES` is the concatenation
  of `EXCLUDED_ITEM_NOTICES` (5) and `NON_CLAIM_NOTICES` (3), so the count in the
  disclosure summary cannot drift from the items inside it. The strings and their
  order are frozen.
* **The subsidy rate's provenance travels with the rate.**
  `SUBSIDY_RATE_FORM_NOTE` is unchanged as a string and stays beside the selector;
  it is now composed from `SUBSIDY_RATE_SOURCE_NOTE + SUBSIDY_RATE_NON_CLAIM` so
  the source half can be shown beside the assumption list without a second wording.
* **`role="alert"` on this view is reserved for two genuine errors**: the
  options-load failure (`facility-cost-options-error`) and the calculation failure
  (`facility-cost-error`), plus the out-of-range numeric message
  (`facility-cost-validation`) the user has just caused. The calculate status line,
  the calculating announcement, the stale notice, and the KPI block stay
  `role="status"`; the standing disclaimers, the partial banner, and the readiness
  checklist carry no live-region role.
* **The primary action's height budget is a contract, not a preference.**
  `e2e/facilityCost.spec.ts` measures that 비용 계산하기 is fully inside the viewport
  before any scrolling at 1280×800 and 1440×900, and the new spec adds 1024×768 and
  1920×1080. Content added to the sticky rail ABOVE the button must be checked
  against it; that is why the four analytical assumptions are listed in setup step
  3 rather than in the rail.
* **The cost view scrolls the document, and only the document.** The dashboard
  subtree must contain zero nested vertical scroll containers; the region table's
  own `overflow-x-auto` is the only bounded horizontal fallback, and the page never
  scrolls horizontally.
* **No action was invented.** The cost view has no export, report, or share action
  to preserve (`ShareExportBar` / `ReportPreview` are mounted by the equity branch,
  below the cost early-return in `page.tsx`), and no comparison calculation exists.
  A test asserts the results view contains exactly one button — 설정 바꾸기.
* **`SectionCard` gained `headingId` and `headingRef`.** Both optional, both
  additive; a heading given a ref also gets `tabIndex={-1}` so it is a programmatic
  focus target and never a Tab stop. It exists so setup step 1 can keep being
  `#fc-step-regions`, the documented focus target 설정 바꾸기 returns to.

Enforced by: `components/FacilityCostDashboard.test.tsx`,
`components/ui/dashboardPrimitives.test.tsx`, `e2e/facilityCostDashboard.spec.ts`,
`e2e/facilityCost.spec.ts`, `e2e/phase3CostResults.spec.ts`,
`e2e/integration.spec.ts`, `app/shell.test.tsx`, `app/accessibility.test.tsx`,
`app/page.suitabilityDashboard.test.tsx`.

## 17. The one deliberate change in the 비용 살펴보기 milestone

**비용 구성 (the funding composition) is no longer a collapsed disclosure.**

* Before: `<Accordion label="국비·지방비 구성" testId="facility-cost-funding-section">`
  wrapped the composition, so the only decomposition of the headline cost on the
  screen had to be discovered and opened.
* After: `facility-cost-funding` is visible content under a titled 비용 구성
  section. `facility-cost-funding-section` no longer exists.
* Preserved verbatim: the three exact served amounts and their test ids
  (`fc-funding-subsidy`, `fc-funding-local`, `fc-funding-total`), their order, the
  decorative `aria-hidden` bar, `fc-funding-scheme`, `fc-funding-rate-basis`, the
  "보조금 승인을 의미하지 않으며" caption, the served note, and the rule that the
  annualized cost is never summed into the total.
* Three test files moved with it and **none was weakened**:
  `components/FacilityCostDashboard.test.tsx` drops funding from "collapses every
  detail section by default" and gains a test that the composition needs no
  disclosure, keeping both behaviour assertions; `e2e/phase3CostResults.spec.ts`
  drops it from `RESULT_SECTIONS` and asserts the same amounts in place;
  `e2e/phase3Review.spec.ts` (opt-in capture) captures it in place.

This is the milestone's only changed expectation. Like §10 it records an
information-architecture decision rather than masking a regression: the assertions
that protected the *behaviour* are unchanged and still enforced.

## 18. The 매립지 현황 workflow and its official-data contract

Added by the landfill milestone (`docs/ui-refresh/landfill-dashboard.md`). The
landfill view is now eight presentational components plus `shared.ts` under
`frontend/src/components/landfill/`, and these facts travel with them:

* **`app/page.tsx` remains the ONE owner of the landfill workflow state.**
  `flowYear`, `flowMonth`, `flowOrigin`, `flowWaste`, the `flowKey`-tagged
  `flowResult`, `flowYears`, `flowWasteOptions`, `flowMaxMonth`, the three parallel
  requests, and the URL mirroring all still live there. `LandfillDashboard.tsx`
  holds no state and never did; every component in `landfill/` is presentational,
  and the one derivation the dashboard performs (`outcome`) is a four-way union
  read off props it already received. There is no second filter representation, no
  second request state, and no landfill calculation inside a visual component.
* **The `<h1>` stays `수도권매립지 반입 현황`.** It is `PageHeader`'s heading now, but
  the string is frozen: `e2e/civicShell.spec.ts` compares it exactly, and the nav
  label 매립지 현황 (§1) is a different, also-frozen string. The area title and the
  view title are deliberately not the same words here — the view names the specific
  dataset, which is the geographic-scope statement.
* **The standing scope notice is exactly ONE `InfoBanner tone="info"`, always
  visible, never an alert, never inside a disclosure.** `landfill-limitation`
  carries the metropolitan-only sentence verbatim in every state — populated,
  loading, no-data, and failure. On a populated screen it is still the only
  `.wep-banner` on the page: a permanent caveat repeated in a second coloured panel
  stops being read.
* **Four filters, four native `<select>`s, unchanged.**
  `landfill-{year,month,origin,waste}-select` keep their options, their order, their
  defaults, their setters, and the rule that changing 연도 clears 기간. The reader's
  own selection is always folded into the option list, because a native `<select>`
  whose `value` matches no `<option>` renders blank and would erase the control's
  own state. The option lists stay page-owned so the filters remain operable through
  a failed or empty response. 기간 must not become a `SegmentedControl`: it is 13
  options, not 2–4, and splitting it would create a second representation of one
  filter.
* **`landfill-selection` reports state and is never a control.** The 현재 선택
  summary restates the four asked-for conditions plus one outcome sentence. It
  contains zero `select` / `input` / `button` elements (asserted in both suites),
  fabricates no result count, and shows no number before a response arrives. The
  year is spelled `2026`, **not** `2026년`: `기준 기간 …년` is the SERVED period and
  several specs wait for it as proof that new values arrived, so echoing it from
  filter state would satisfy that wait while stale numbers were still on screen.
* **`landfill-partial-year` stays in the headline section, above the KPIs.** 현재 선택
  states what was asked; the partial-year marker qualifies what was served and must
  sit beside the numbers it qualifies. It keeps `text-warn` — it cautions about
  values that exist — and it must never be softened into an annual total.
* **Provenance is per KPI card, in text.** 총 반입량 and 공식 반입수수료 carry
  `DataStatusBadge status="reported"`; 톤당 실효 수수료 and the per-capita conversion
  carry `derived`, and the per-capita card switches to `missing` when no value was
  served. A section-level badge cannot replace them: this row genuinely mixes the
  two kinds. 총 반입량 is the single `KpiCard size="hero"`, and `landfill-kpis` still
  holds exactly four cards.
* **Four data states stay distinct, and none is amber-by-default.** An official
  measured `0` renders as `0 t` and its row is never dropped; a value that was not
  served shows its plain-Korean reason in neutral no-data gray (the per-capita table
  cell moved off `text-warn`); the backend's 404 answer is an `EmptyState` with no
  `role`, no zeros, and the served `available_years`; a request failure is
  `InfoBanner tone="error"` + `role="alert"`. On a failure, 현재 선택 shows **no**
  data-status badge — a failed request says nothing about whether records exist.
* **`role="alert"` on this view is reserved for the one genuine failure**
  (`landfill-error`). `landfill-loading` and `landfill-no-data-live` stay
  `role="status"`; `landfill-live` (period + total quantity) stays outside every
  `<details>`; the scope banner, the selection summary, the partial-year marker, and
  every section header carry no live-region role.
* **The exact-value table owns the only horizontal scroll on the page.** Its
  `overflow-x-auto` container is the direct parent of the `<table>`, and the new spec
  enumerates every overflowing element to assert nothing else scrolls sideways. The
  table keeps its `<caption>`, four `scope="col"` headers, and `scope="row"` region
  cells.
* **Trend gaps stay gaps.** A month with no served value draws no bar and gets no
  row in the accessible table — never a zero bar, never an interpolation, never a
  carried-forward value. The chart's bar count and its exact table's row count are
  asserted equal.
* **Breakdown headings stay descriptive, never evaluative.** 출발 지역별 반입량 and
  폐기물 종류별 반입량; 최다 / 최악 / 1위 / 책임 / 위험 / 과도 are asserted absent. A
  larger quantity is a quantity, not blame.
* **`lib/displayNumber.ts` is not used here.** The landfill view has always formatted
  through `lib/landfill.ts`, and routing its figures through a second formatter would
  change displayed values.

Enforced by: `components/LandfillDashboard.test.tsx`,
`e2e/landfillDashboard.spec.ts`, `e2e/phase5LandfillDashboard.spec.ts`,
`e2e/phase7FinalRegression.spec.ts`, `e2e/responsive.spec.ts`,
`e2e/integration.spec.ts`, `e2e/civicShell.spec.ts`, `app/shell.test.tsx`,
`app/page.phase7.test.tsx`, `app/page.test.tsx`, `app/accessibility.test.tsx`.

## 19. The 매립지 현황 milestone changed no test expectation

Like §13 and §15, and unlike §10 and §17, this milestone has no deliberate contract
change to record: **every pre-existing unit and e2e assertion passes unmodified**,
including all 57 in `LandfillDashboard.test.tsx` and all 37 in
`e2e/phase5LandfillDashboard.spec.ts`. No shared primitive was changed either — the
landfill view uses only props `SectionCard`, `KpiCard`, `InfoBanner`, `EmptyState`,
`Accordion`, `Skeleton`, and `DataStatusBadge` already had.

Two decisions are worth keeping, because both look like styling choices and are not:

1. **현재 선택 is a footer row of the 조건 선택 card, not a card of its own.**
   `e2e/phase5LandfillDashboard.spec.ts` measures that `landfill-limitation`,
   `landfill-filters`, and `landfill-kpi-quantity` are all fully inside the first
   viewport at 1280×800 before any scrolling. After the refresh the KPI row's bottom
   edge sits at 722.5px of 800; a separate summary card would have spent most of that
   margin for no informational gain. Content added between the banner and the KPI row
   must be checked against that assertion.
2. **`DataStatusBadge` is not used inside the exact-value table's per-capita cell.**
   `.wep-badge` is `white-space: nowrap`, and the longest served reason
   (`일부 지역의 동일 기간 인구가 없어 합계를 계산할 수 없습니다`) would widen the column
   far past the table. The cell keeps the served reason as neutral-gray text, which
   states the same thing in the same place without the width hazard.

## 20. The 데이터·출처 catalog and its source-of-truth contract

Added by the transparency milestone (`docs/ui-refresh/transparency-dashboard.md`).
The area is now twelve presentational components plus `shared.ts` under
`frontend/src/components/transparency/`, and these facts travel with them:

* **`TransparencyDashboard.tsx` remains the ONE owner of this area's state.**
  `freshness`, `freshnessState`, `policy`, `run`, `costOptions`, `mapping`,
  `mappingError`, `page`, `knownUnmappedTotal`, `query`, `areaFilter`,
  `frequencyFilter`, the three `useId`s, the search `ref`, both effects, the four
  `useMemo` derivations, and both clear handlers all still live there. Every
  component in `transparency/` is presentational: **no second source registry, no
  second filter state, no second request, no second pagination state, and no
  source classification outside `lib/dataSources.ts`.**
* **`lib/dataSources.ts` is the registry's only interpreter.** The Korean rendering
  per exact `source_id`, the subject-area assignment, the frequency labels, the
  ordering, the search text, the filters, the link safety check, the collection-date
  slice, and the four overview counts stay there. A presentational component may not
  re-derive any of them, and an unrecognised `source_id` must keep falling back to
  the served strings verbatim rather than acquiring an invented Korean name.
* **The `<h1>` stays `데이터와 출처`,** now rendered by `PageHeader`. It is a different
  string from the frozen nav label `데이터·출처` (§1) and both are compared exactly —
  `e2e/civicShell.spec.ts`, `e2e/phase6DataSourcesDashboard.spec.ts`, and
  `app/terminology.audit.test.tsx`.
* **This file's private `SectionCard` copy is gone.** All five card sections use the
  shared `components/ui/SectionCard`, so each is a `<section aria-labelledby>` named
  by its own `h2`; the overview is a `<section aria-labelledby>` with a **visible**
  `h2`. A future edit must not reintroduce a local card wrapper.
* **The section order is frozen:** `transparency-notice` → `transparency-overview` →
  `transparency-sources` → `transparency-datasets` → `transparency-gaps` →
  `transparency-facility-mapping` → `transparency-methodology`. Two suites compare
  document positions.
* **`transparency-filter-summary` REPORTS state and is never a control.** It contains
  zero `button`, `input`, and `select` elements (asserted in both suites), it is
  built from `Chip` (a `<span>`) and never `FilterChip` (a `<button aria-pressed>`),
  and it is absent entirely for an empty registry. Nothing focusable may be inserted
  between `transparency-search`, `transparency-search-clear`,
  `transparency-filter-category`, and `transparency-filter-frequency` — the Phase 6
  spec walks exactly that Tab order.
* **`DataStatusBadge` is used only where a value is or is not there**, and never as a
  grade. `reported` / `derived` in the dataset table carry the pre-existing wording
  `직접 보고값` / `공식 자료 기반 계산값` as their `label` override; `missing` marks an
  absent reference period; `excluded` marks `enabled: false`. A **served** period gets
  no badge, and a **failed freshness request** gets no badge — it is a statement about
  the request, not about the data, and it keeps its own sentence. No source is scored,
  ranked, graded, or given a percentage: a unit test scans the rendered catalog for
  점수 / 등급 / 순위 / 신뢰도 / `%`.
* **Five outcomes stay distinct, and exactly one is an alert.** loading
  (`role="status"` + `aria-hidden` skeleton) · catalog · registry served no records
  (`EmptyState`, no role, no controls, no count) · search matched nothing (a different
  `EmptyState`, with a recovery action) · request failure (`InfoBanner tone="error"` +
  `role="alert"` + a `[data-diagnostic]` code line). An official measured `0`
  (`without_address`) stays a rendered `0` with no badge.
* **The three gaps stay three.** `transparency-cost` (from `MISSING_COMPONENT_META`),
  `transparency-gap-unmapped`, and `transparency-gap-period`. The third prints a
  number only once the freshness join resolves; while it is loading or after it fails
  it prints none, and says so.
* **Every table announces its structure**: a `<caption>`, `scope="col"` on every
  header, and a `<th scope="row">` leading every body row. Each table's
  `overflow-x-auto` wrapper is the direct parent of its `<table>` and is the only
  horizontal scroll on the page; nothing in this view scrolls vertically inside the
  document.
* **Pagination stays native buttons with standalone names** (`aria-label="이전 페이지"`
  / `"다음 페이지"`) and is deliberately **not** a `<nav>` — the shell owns the single
  navigation landmark. The `unmapped.page === page` gate and the `knownUnmappedTotal`
  that keeps the pager operable through a failure are unchanged.
* **No live region sits inside a `<details>`,** and the raw technical identifiers stay
  behind the 기술 정보 disclosure in `[data-diagnostic]` nodes — demoted, never
  deleted.
* **The catalog filters are still NOT written to the URL.** `?v=1&mode=transparency`
  behaves exactly as before, so existing shared links are unaffected.

Enforced by: `components/TransparencyDashboard.test.tsx`,
`e2e/transparencyDashboard.spec.ts`, `e2e/phase6DataSourcesDashboard.spec.ts`,
`e2e/citizenFlows.spec.ts`, `e2e/civicShell.spec.ts`, `e2e/desktopNavigation.spec.ts`,
`e2e/phase7FinalRegression.spec.ts`, `app/shell.test.tsx`,
`app/accessibility.test.tsx`, `app/terminology.audit.test.tsx`, `lib/dataSources.test.ts`.

## 21. The 데이터·출처 milestone changed no test expectation

Like §13, §15, and §19, and unlike §10 and §17, this milestone has no deliberate
contract change to record: **every pre-existing unit and e2e assertion passes
unmodified**, including all 53 in `TransparencyDashboard.test.tsx` and all 108 in
`e2e/phase6DataSourcesDashboard.spec.ts`. No shared primitive was changed either — the
transparency view uses only props `PageHeader`, `SectionCard`, `KpiCard`,
`DataStatusBadge`, `InfoBanner`, `Chip`, `EmptyState`, `Accordion`, and `Skeleton`
already had, and `lib/dataSources.ts` was not touched.

Two decisions are worth keeping, because both look like styling choices and are not:

1. **The provenance wording did not change when the badge did.** `DataStatusBadge`
   renders `공식 값` / `계산값` by default, but the dataset table passes
   `직접 보고값` / `공식 자료 기반 계산값` as its `label` override. Three suites compare
   those strings, and they are also the longer, more explicit wording for a screen
   whose whole subject is that distinction. The badge supplies the semantic; the page
   keeps its own words.
2. **The overview KPI grid is `lg:grid-cols-4`, not `xl:grid-cols-4`.** At 1024×768 a
   2×2 grid cost ~145px of the first viewport and pushed the catalog's first card to
   772px — below the fold. Four across puts it at 674px. Content added between the
   page header and the catalog controls must be measured against that ~94px margin.

## 22. The six-view integration contract

Added by the final UI integration milestone
(`docs/ui-refresh/final-integration-regression.md`). The six refreshed areas are now
verified **together**, and these facts are enforced across the whole application
rather than per area:

* **Six user-facing views, one table.** `e2e/finalUiIntegration.spec.ts` enumerates
  지역 부담 · 후보지 점수 · 가중치 바꿔보기 · 비용 살펴보기 · 매립지 현황 · 데이터·출처
  with, for each: the deep link, the mount marker, the exact `<h1>`, the exact
  primary-navigation label, the `aria-pressed` nav button, the map count, and
  whether the sub-view selector belongs there. A new view must join that table; it
  may not be added by relaxing a row.
* **The map counts are 1 / 1 / 1 / 0 / 0 / 0**, in that order, and are asserted at
  1024×768, 1280×800, 1440×900, 1920×1080, 768×1024, and 390×844.
* **Contracted singletons stay singletons.** `SINGLETON_TESTIDS` in that spec lists
  the shell chrome, the one map, and each area's owned top-level surfaces; each must
  appear **at most once** in the live document in every view and after every
  navigation. This is what catches a retained map, a second cost form, a second
  source catalog, a duplicated navigation, a doubled sub-view selector, and a stale
  panel left mounted under a new view — as one failure naming the offending id.
  It is deliberately **not** "no `data-testid` repeats": `score-class-row`,
  `land-cover-legend-row`, `facility-cost-facility-type-card`, region chips, and
  catalog items legitimately repeat, and a blanket rule would report list rendering
  as a defect.
* **No view leaves its owned components behind.** `VIEW_OWNED_TESTIDS` maps each
  view to the surfaces it owns; every other view asserts their absence (count 0,
  not merely hidden).
* **No live region is duplicated or nested.** In every view, no `data-testid` on a
  `role="status"` / `role="alert"` / `aria-live` node appears twice, and no live
  region has another live region as an ancestor.
* **A served no-data answer is still missing after integration.** The 수도권매립지
  404 `NO_DATA_AVAILABLE` path renders its empty state with no `role="alert"`, no
  KPI row, and none of `0 t` / `0톤` / `0원` / `0 원` / `0.0` anywhere in
  `#main-content`.
* **Text scans join element boundaries with a space.** Korean labels concatenate
  across elements into words that were never rendered (수집 시점 + 수집 기록 없음 →
  a phantom `점수`). Any forbidden-token scan must collect per-element text nodes
  and join them with a separator, never read a subtree's `textContent`. Weakening
  the scan to hide a *real* leak is a different thing and is not permitted.
* **Browser back/forward restore the deep-linked view.** In-app mode changes mirror
  with `history.replaceState` and by design add no history entries (§3); two real
  document navigations do, and back/forward across them restore the full view
  contract on both sides.

## 23. The one deliberate change in the final integration milestone

**The 비용 살펴보기 scope notice moved into the setup workflow column.**

* Before: `FacilityCostNotice` rendered full-width **above** the two-column grid, so
  the `lg:sticky` action rail's static position started at y = 464 at 1024×768 and
  its 415px card ended at 879 — 비용 계산하기 clipped at 838 of 768.
  `position: sticky` never rescues that: it cannot pull an element above its static
  position, so the rail did nothing until the citizen had already scrolled.
* After: the notice is the first block of the grid's workflow column. The rail
  starts at the top of the workspace and the action measures 544–588 at all four
  desktop targets.
* Preserved: the notice's content, wording, test ids
  (`facility-cost-notice`, `facility-cost-completeness`,
  `suitability-screening-disclaimer`, `facility-cost-disclaimer`), its position in
  document order as the first block under the `<h1>`, the setup sequence
  처리할 지역 → 처리 조건 → 계산 가정 → 현재 설정·계산 준비 상태 → 비용 계산하기, and
  every validation rule, default, payload, and request.

**The first-screen assertion is now deterministic and stronger.** `page.mouse.wheel`
is gone from it. `scrollToTop()` polls `window.scrollY` to `0` before anything is
measured, and `expectActionOnFirstScreen()` additionally asserts the 44px target
size, non-overlap via `elementFromPoint`, and that both 계산 준비 상태 and the
`role="status"` line are in the viewport. Content added to the rail above the button
— or to the workflow column above the grid — must be checked against it. The fix, if
it ever fires again, is to move content, not to relax the assertion.

**`DerivedPanel` lost its amber container.** It carried
`border-amber-300 bg-amber-50`, and `.mobile-collapsible` force-opens
출처와 계산 방법 at md+, so a strong yellow card sat permanently among the refreshed
white surfaces on every desktop 지역 부담 screen. Amber is this system's caveat tone
(§6, §16, §18), and 파생 지표 is neutral provenance that the same screen already
states neutrally via `DataStatusBadge status="derived"`. The container moved to
`bg-surface-muted` + `border-hairline` + `text-ink-muted`; the metric's own `caveat`
keeps the warn role, now as `text-warn`. No wording, formula, source, value,
structure, or test id changed.

`SourcePanel` was deliberately **left unchanged**: its `slate-50` / `slate-200`
resolve to `#f8fafc` / `#e2e8f0`, i.e. the same value as `--color-surface-muted` and
within 1/255 of `--color-hairline`, so it has no visible conflict to repair.

## 24. What the final integration milestone did NOT change

No analytical calculation, cost formula, scoring rule, landfill calculation, source
registry record, API endpoint, payload, migration, or dataset. No backend, database,
ingestion, Docker, or Caddy file is touched. No existing test expectation was
weakened: the two changed assertions in `e2e/facilityCostDashboard.spec.ts` are both
**strictly stronger** than what they replaced, and every other pre-existing unit and
e2e assertion passes unmodified.

## 25. The map insight disclosures are closed by default

Added by the collapsible-map-insight follow-up (`equity-dashboard.md` §12,
`suitability-dashboard.md` §14). Both map overlays —
`components/equity/EquityMapInsightStrip.tsx` and
`components/suitability/SuitabilityMapInsightStrip.tsx`, the latter in **both** its
score and its scenario variant — are native `<details>` disclosures that render
**closed**. A future phase may restyle them; making either open by default is a
product decision, not a styling one.

* **One shared, frozen label.** Both bars print exactly `해석 · 주의 · 출처 보기`,
  from the single `MAP_INSIGHT_SUMMARY_LABEL` constant in `lib/glossary.ts`. The
  chevron beside it is `aria-hidden`, so the accessible name equals the visible
  label; no `aria-label` may be placed on either `<summary>`.
* **One shared class, with its own contract.** `.map-insight` genuinely collapses at
  every width it renders at. It is deliberately NOT `.map-legend` and NOT
  `.mobile-collapsible`, both of which force their body open at md+. Reusing either
  would silently pin the insight open again.
* **All provenance and caveat information remains reachable.** Collapsing hides
  nothing permanently: 해석, the 주의 banner, the served reference period, the source
  lines, the profile / applied weights / visible statuses / stable-only note, the
  reference year, the policy, derivation, and candidate-grid versions, and the
  `출처 자세히 보기` action are all one click away, and the sidebar independently
  carries the same facts. Nothing in either disclosure may become the ONLY home for a
  mandatory disclosure. Neither carries `role="alert"`, and neither may host a live
  region — a `role="status"` inside a collapsed `<details>` stops announcing.
* **The map legend and the top-left layer controls must remain independently
  operable.** The legend, the MapLibre zoom controls, `wetland-layer-control`, and
  `land-cover-layer-control` each take their own clicks with the insight both
  collapsed and expanded, at every supported viewport. The full-width positioning row
  around each disclosure stays `pointer-events-none`; only the visible `<details>` is
  `pointer-events-auto`.
* **Tests must not use forced clicks to conceal overlay collisions.** `{ force: true }`
  is banned in the map-overlay specs. An overlay collision is a defect to fix in the
  layout, not an obstacle to click through — this rule is what surfaced the
  legend-over-land-cover conflict, and the bounded-height correction that resolved it
  (`suitability-dashboard.md` §14).

Enforced by: `components/equity/EquityMapInsightStrip.test.tsx`,
`components/suitability/SuitabilityMapInsightStrip.test.tsx`,
`app/page.equityDashboard.test.tsx`, `app/page.suitabilityDashboard.test.tsx`,
`e2e/mapInsightDisclosure.spec.ts`, `e2e/equityDashboard.spec.ts`,
`e2e/suitabilityDashboard.spec.ts`.

### The one deliberate expectation change

Four pre-existing assertions were updated, none weakened:

1. `e2e/equityDashboard.spec.ts` — `insight-reference-period` / `insight-provenance`
   were asserted visible on arrival. They are now asserted **hidden** on arrival and
   visible after one click, which is strictly more specific than before.
2. `e2e/equityDashboard.spec.ts` and `e2e/suitabilityDashboard.spec.ts` — the
   `insight-open-sources` routing tests now open the disclosure first, as a reader
   does. Same for the three unit tests that read the panel's content.
3. The open-state height bound is `< 40%` of the map height rather than the collapsed
   state's `< 1/3`: the expanded card is transient and carries a ~40px summary bar the
   always-expanded card did not have. The collapsed bar is still held to `< 1/3`, and
   is measured at 42px.
4. The bottom overlay column's geometry assertions gained open-state counterparts
   rather than losing their closed-state ones.
5. `e2e/accessibility.spec.ts:65` now waits for `map-container` with the repository's
   15s budget before reading its attributes. That file set **no** timeout anywhere, so
   it asserted at Playwright's default 5s while the map mounts only after the view's
   initial requests resolve. `e2e/mapInsightDisclosure.spec.ts` adds ~5.1 min of load
   (full mocked suite 8.3 min → 12.0 min), which made that pre-existing race fire once
   at 390×844; it passed in isolation and at 1440×900 in the same run. This is the
   same mechanism, and the same correction, already recorded for `civicShell.spec.ts`
   in `final-integration-regression.md`. Every assertion is unchanged — only the
   patience is.

---

## 26. UI correction pass — what the post-production visual review changed

A visual review of the deployed 여기다 redesign found four defects. The corrections
are deliberate product decisions, so the contracts they touched are **restated here
rather than silently broken**. Nothing outside these four items moved.

### 26.1 §5 restated — 지표 선택 is now three SUBJECT sections

§5 above froze the metric controls as three STATISTICAL-FAMILY fieldsets
(총량 지표 / 1인당 형평성 지표 / 시설 부담 지표) holding eleven radios. The reader has
to know the taxonomy before they can find anything, which is what the review objected
to. The new shape (`lib/metrics.ts` `METRIC_SECTIONS`,
`components/equity/EquityMetricSelector.tsx`):

```text
지역별 인구            → 지역별 인구
폐기물 발생량           → 생활계 / 사업장(비배출시설계) / 사업장(배출시설계) / 건설
                        each with a 총량 · 1인당 switch
1인당 시설 처리 수준     → 소재 시설 처리량 / 인근 5km 시설 처리량
```

What is still frozen, and still enforced:

* **exactly three `<fieldset>`/`<legend>` groups** — `e2e/accessibility.spec.ts` counts
  the whole page's fieldsets, so the mode switch stays a `role="group"` of
  `aria-pressed` buttons (`SegmentedControl`) and must never become a fourth fieldset;
* **ONE logical radio group** — all seven category radios keep `name="metric"`, so
  native arrow keys still traverse every row across section boundaries;
* **no disclosure, no `<select>`, no tabs** on desktop: every row and every switch is
  directly selectable;
* **four independent selection signals** — the native checked radio, a heavier label,
  the card border, and the tint;
* **the same eleven served metrics.** Seven rows × the switch = eleven `MetricKey`s.
  No metric was added, removed, renamed, merged, or derived.

One point where the shipped IA differs from the reference sketch, **explicitly
sanctioned by the correction request** ("preserve the real data semantics… rather than
collapsing distinct official datasets incorrectly"):

**생활계 is four waste rows, not three, and is not annotated "생활 + 비배출계".**
Korean statistics do define 생활계폐기물 as 생활(가정) + 사업장비배출시설계, but this
platform ingests those as two separate official series (RCIS `NTN007` → `HOUSEHOLD`,
`NTN008` → `BUSINESS_NON_FACILITY`) and the backend serves no combined figure. Adding
them in the browser would publish a statistic no source published; dropping either row
would hide a real official series. Both are offered, each labelled with the stream it
actually is, and 생활계's supporting line says where the other component lives.

The switch labels are **총량 · 1인당**, as specified. Left segment selects the
category's absolute served metric, right selects its per-capita one.

Enforced by: `app/page.equityDashboard.test.tsx`, `app/page.phase4.test.tsx`,
`app/accessibility.test.tsx`, `e2e/equityDashboard.spec.ts`,
`e2e/phase4EquityMap.spec.ts`, `e2e/accessibility.spec.ts`.

### 26.2 §10 restated — 지역 지표 shows no visible title block

Every other area still renders `PageHeader` + the orientation strip. 지역 지표 does
not: the destination name, the scope tagline, and the orientation repeated what the
active navigation item already said, and cost the column its first band of height.

* The `<h1>` **still exists and still reads 지역 지표** — one per view, unchanged
  (spec §2.2/§13). It is `sr-only`, so it occupies no layout at all; it is not hidden
  with `visibility` or an opacity that would keep its box.
* The scope tagline and `mode-orientation` are **absent from the DOM** in this area,
  not merely invisible.
* The navigation item 지역 지표 is untouched.
* **The condition is `viewMode === "equity" && !dataDialogOpen`, and the second half
  is load-bearing.** 데이터·출처 is a dialog layered over the previous area (§8), so a
  cold `?v=1&mode=transparency` link renders this same branch with `viewMode` equity
  while `destination` is 데이터·출처 — the `<h1>` is then that destination's title.
  Dropping `!dataDialogOpen` strips 데이터·출처 of its visible page title, which is
  exactly the defect `e2e/phase6DataSourcesDashboard.spec.ts:663` caught at 1280 and
  1440 during this pass.

Enforced by: `app/page.equityDashboard.test.tsx`, `app/shell.test.tsx`,
`app/terminology.audit.test.tsx`, `e2e/equityDashboard.spec.ts`.

### 26.3 지역 비교 removed; 지표 순위 전체보기 added

The 지역 비교 card, its 0/3 counter, its search field, and its chips are gone, along
with the page state, the CSV builder, and the report model that only it reached
(`buildComparisonCsv`, `buildComparisonReport`). `lib/urlState.ts` still decodes and
bounds-checks `cmp` so an already-shared legacy link keeps restoring everything else
it carries; the page simply no longer applies it.

Its replacement, `components/FullRankingDialog.tsx`, opens from inside the ranking
card and is bound by the same analytical rules as the card:

* the ranking is `rankAllRegions` — the SAME scope filter, exclusion rule, comparator
  and tie-break as `rankRegions`, with the top-N cut removed. Not a second ranking;
* it follows the active metric and its counting mode;
* **a region with no served value is never ranked and never shown as 0** — it is named
  in a separate 값이 없어 순위에서 제외한 지역 list that says so explicitly;
* an official measured 0 IS ranked;
* it uses the existing `ui/Dialog` primitive, so focus entry, Tab containment,
  Escape, the close control, the body scroll lock, and focus restoration to the opener
  are the behaviours already contracted for 데이터·출처. That primitive was not
  modified to take a second consumer;
* no endpoint was added: it derives from the rows Page 1 already loaded.

Enforced by: `lib/ranking.test.ts`, `app/page.equity.test.tsx`,
`app/page.equityDashboard.test.tsx`, `e2e/equityDashboard.spec.ts`,
`e2e/citizenFlows.spec.ts`, `e2e/finalUiIntegration.spec.ts`.

### 26.4 §16 extended — 후보지 분석 opens with the workflow, not the caveats

The scope notice (`facility-cost-notice`) and its eight-item disclosure
(`facility-cost-completeness`) moved from the top of the setup screen to the END of
it. **No wording, grouping, count, prominence-within-itself, or test id changed** —
only the position. Both are still fully present on the page, and the results view
keeps its own separate notice.

This also strengthens §16: the setup grid, and with it the sticky action rail, now
starts at the very top of the workspace at every viewport height.

Enforced by: `components/FacilityCostDashboard.test.tsx` (DOM-order assertions),
`e2e/facilityCost.spec.ts`, `e2e/facilityCostDashboard.spec.ts`.

### 26.5 The collapsed panel really gives its width to the map

`docs/YEOGIDA_UI_REDESIGN_SPEC.md` §6 promised it; nothing measured it, and above
1280px it was false. `.wep-panel { width: 21rem }` in the ≥1280px block came AFTER
`.wep-panel-collapsed { width: 3rem }` in the ≥768px block at equal specificity, so
the collapsed column kept its full 336px while its body disappeared — the map never
grew. The collapsed rule is now `.wep-panel.wep-panel-collapsed` (0,2,0), which wins
regardless of block order. **Do not simplify that selector back to one class.**

`e2e/deepAnalysisPanels.spec.ts` measures BOUNDING BOXES, never class names — a class
assertion could not have caught this, because the element carried the right class the
whole time. It also asserts the map DOM node's IDENTITY across collapse/reopen via an
expando property that only survives if the same node stays mounted, so a `key`-based
remount workaround fails the suite. `MapView`'s `ResizeObserver` → `rAF` →
`map.resize()` contract is untouched and is what repaints the canvas.
