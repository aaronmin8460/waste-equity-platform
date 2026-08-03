# UI refresh — regression contract

What the visual refresh may **not** change. Every item below is enforced by a test
that already exists or that this milestone added; the test is named so a future
phase can find it before "cleaning up" the behavior it protects.

A change to any item here is a product decision, not a styling decision.

The file spans the whole refresh. §1–§9 are the shared contracts; §10–§11 record
the two decisions the **civic-dashboard foundation** milestone took deliberately;
§12–§13 add what the **지역 부담 dashboard** milestone contracted and confirm it
changed no existing expectation (see `equity-dashboard.md`); §14–§15 do the same
for the **후보지 분석 dashboard** milestone (see `suitability-dashboard.md`).

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
  지역 부담 insight strip are children of ONE bottom-anchored flex column inside
  `.map-pane`, not two separately-anchored cards — hand-tuned `bottom-*` offsets
  overlap as soon as either grows a line of Korean text at a narrower width.
  `MapLegendOverlay` therefore owns no positioning of its own. Anything added to
  that band joins the column; nothing in it may be placed in flow **below** the
  map, which would shorten the canvas and break the bullet above.
* `MapView` stays the DIRECT child of the `.map-pane` wrapper — overlays are its
  siblings (`app/page.phase4.test.tsx`, `app/responsive.test.tsx` both read
  `map-container.parentElement`).

Enforced by: `app/shell.test.tsx`, `app/page.selection.test.tsx`, `components/MapView.test.tsx`,
`app/page.equityDashboard.test.tsx`, `e2e/desktopNavigation.spec.ts`,
`e2e/responsive.spec.ts`, `e2e/civicShell.spec.ts`, `e2e/equityDashboard.spec.ts`.

## 5. Metric radios

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
* A region whose value is unavailable is **never silently dropped** from the region
  comparison: it keeps its chip and its row, and shows the served reason under
  자료 없음 when the source attached one.
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
