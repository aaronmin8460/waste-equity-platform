# UI refresh — 후보지 분석 (suitability) dashboard

The third milestone of the civic-dashboard refresh. The first
(`feat/civic-dashboard-foundation`, merged as `a7ce49e`) established the tokens,
the shell, the navigation, and the shared primitives; the second
(`feat/equity-dashboard-refresh`, merged as `8c16759`) rebuilt **지역 부담**; this
one rebuilds the two map sub-views of **후보지 분석**:

```text
후보지 점수       view=score
가중치 바꿔보기   view=scenario
```

**비용 살펴보기 (`view=cost`) is deliberately out of scope** and was not
redesigned — see §12.

Everything below was read out of the repository or measured in a real browser at
the stated viewport. Nothing here is aspirational.

## 1. The before-state, and what was wrong with it

The screen worked, and every analytical guarantee it made was correct. Its
problems were of hierarchy, of answer-first ordering, and of where a fact lived.

| # | Before | Why it was a problem |
| --- | --- | --- |
| S1 | The **active** scoring basis was only discoverable by working out which of five equally-weighted radio rows was checked. | The single question the whole screen depends on — *what is the map currently scoring by?* — had no answer-first statement. |
| S2 | The status counts were one dense sentence: `전체 47,893 · 스크리닝 통과 1,099 · 추가 검토 필요 34,534 · 프로젝트 스크리닝 제외 12,260`. | Four numbers in running text are not scannable, and the sentence carried no link to the map's own colors. |
| S3 | Nothing in the sidebar said which statuses the map was actually **drawing**, or that 안정 후보만 보기 was on. | The filter lived in the floating legend, so the column of counts described a population the map might not be showing. |
| S4 | With no candidate selected the detail area rendered **nothing at all**. | An empty region reads as "broken" or "still loading", and never explains how to select one. |
| S5 | `CandidateDetailPanel` was one ~190-line run of `<p>`s: identity, score, weights, components, road, equity raw, demand raw, sensitivity, stability, land cover, disclaimer. | The score and the rank — the two things a reader came for — had the same visual weight as the ninth provenance sentence. |
| S6 | The candidate list heading was `상위 후보지 · 기본 기준 기준`, with the neutrality caveat 900px below in the methodology card. | "상위" is fine, but the framing that a high screening score is **not** a recommendation was nowhere near the ranked list itself. |
| S7 | The map workspace carried only the legend. Interpretation, the active basis, the run/version context, and the caution lived exclusively in the sidebar. | The equity milestone had already fixed exactly this on its own screen (`equity-dashboard.md` §1 B7); 후보지 분석 still had the caveats 900px from the map. |
| S8 | The scenario lab was a flat 12-block stack with no card structure, so 현재 운영 기준 / 사용자가 조정한 값 / 적용된 결과 / 비교 기준 were visually indistinguishable. | Four different kinds of weight on one screen, none of them labelled apart, is the exact confusion the "never present a user scenario as official" rule exists to prevent. |
| S9 | The scenario summary printed `방법 버전`, `시나리오 해시`, and `분석 실행` as primary `<dt>`s. | Version identifiers as citizen-facing labels — the same demotion Phases 3/5/6 applied elsewhere had not reached this surface. |
| S10 | The whole suitability surface still used raw `slate-*` / `sky-*` / `amber-*` / `indigo-*` / `rose-*` utilities. | The foundation milestone introduced semantic tokens; this screen mixed two color systems. |

## 2. The score layout that replaced it

```text
Application bar (shared shell — unchanged)
후보지 분석 sub-view selector (shared chrome — rendered once, unchanged)
└── 후보지 점수 workspace  (<main>, one row at md+)
    ├── analysis sidebar  <aside>, 384px, the ONE desktop scroll container
    │   ├── PageHeader          후보지 분석 + scope line   (the view's single <h1>)
    │   ├── ModeOrientation     task line                (unchanged, follows the h1)
    │   ├── 광역 분석 스크리닝    standing InfoBanner, never collapsed
    │   ├── 점수 반영 기준        ACTIVE basis card → 5 radios → CRITIC method note
    │   ├── 후보 상태 요약        total · 3 status rows · map display state · meanings
    │   ├── 기준을 바꿔도…        stability counts, cutoff, compared profiles
    │   ├── 점수가 높은 후보 구역  neutral framing + ranked rows (+ stable short-list)
    │   ├── 선택한 후보 구역      selected-candidate summary, or an explicit prompt
    │   ├── 제외 / 검토 사유      served reason → count breakdowns
    │   ├── 자료 공백 안내        served coverage notes
    │   └── 계산 방법과 가정      assumptions + disclaimer + 미포함 항목 disclosure
    └── map workspace  .map-pane, fills the remaining width AND the viewport height
        ├── MapView (one instance, direct child of .map-pane)
        ├── top-left overlay stack    wetland + land-cover layer controls
        └── bottom overlay column     floating legend (status filter + score classes)
                                      └── insight strip [해석] [주의] [현재 기준·출처]
```

Section order follows the workflow the milestone is meant to support: *what are
the limits* → *what is it scoring by* → *how many of each outcome* → *how stable
is that* → *which cells rank high* → *what does this one cell say* → *what is
missing* → *how was it computed*.

## 3. The scenario layout that replaced it

```text
Application bar + sub-view selector (shared chrome — unchanged)
└── 가중치 바꿔보기 workspace
    ├── analysis sidebar  <aside>, same 384px scroll container
    │   ├── PageHeader / ModeOrientation / 광역 분석 스크리닝   (identical to score)
    │   ├── 가중치 바꿔보기      scenario explanation + 현재 운영 기준 reference
    │   ├── 가중치 조정          presets → 4 weight controls → total validation →
    │   │                       정규화 / 기준 재설정 / 마지막 적용값
    │   ├── 시나리오 적용        comparison-profile select → apply → state messages
    │   ├── 적용된 시나리오 결과  applied weights · comparison basis · counts ·
    │   │                       selected-candidate baseline-vs-scenario comparison
    │   ├── 사용자 설정 기준 상위 후보   ranked rows with served rank movement
    │   ├── 선택한 후보 구역 (사용자 설정)  contribution table
    │   └── 방법론 및 한계        (disclosure)
    └── map workspace  identical structure; the strip switches to its scenario copy
```

The four kinds of weight on this screen are now named apart, in this order:
**현재 운영 기준** (the stored profile, shown for reference) → **사용자 설정**
(the draft) → **적용된 시나리오 결과** → **비교 기준**. The wording 새 공식 기준 /
확정 기준 / 정책 가중치 appears nowhere, and a unit test asserts their absence.

### The map insight, and why it floats — and is now collapsed by default

**Follow-up (`feat/collapsible-map-insights`).** The strip described below was
originally always expanded, in BOTH 후보지 점수 and 가중치 바꿔보기. It is now a native
`<details>` disclosure that arrives **closed**, behind the same compact bar the equity
map uses:

```text
[ 해석 · 주의 · 출처 보기 ▾ ]
```

Nothing was removed, reworded, reimplemented, or moved, in either variant. See §14 for
the whole change; the paragraphs immediately below still describe why it floats at
all, which did not change.

### Why it floats

Same forcing constraint as the equity strip: `regression-contract.md` §4 and four
separate e2e specs assert that the map reaches the viewport bottom with nothing
beneath it. An in-flow strip would shorten the canvas and break all of them. So
the strip is an **overlay inside the map workspace**, and it joins the SAME
bottom-anchored flex column the legend already lives in, so non-collision is
structural rather than a hand-tuned `bottom-*` offset.

It renders at `lg` (≥1024px, the minimum supported width) and up. Nothing in it
is mandatory-only-there: the active basis, the run and version context, the
status visibility, and both disclaimers all appear in the sidebar as well.

## 4. The one structural decision worth recording: the status filter was NOT moved

The milestone brief places "status and stability filters" in the left sidebar.
They stayed in the **floating legend**, and the sidebar reports their state in
words instead. This is deliberate:

* `status-toggle-{ELIGIBLE,REVIEW_REQUIRED,EXCLUDED}` and `stable-only-toggle`
  are contracted in three separate files — `components/MapLegendOverlay.test.tsx`,
  `e2e/integration.spec.ts`, and the live `e2e/landCoverLayer.spec.ts` (which
  asserts the user's status filter survives a land-cover toggle and cannot be run
  in this environment, since it needs `E2E_BACKEND_URL`).
* A second set of checkboxes for one piece of state is exactly the duplication the
  equity milestone removed (`regression-contract.md` §12, "No control on this
  screen is duplicated"), and it would make every `getByTestId`/`getByLabel`
  locator for those controls ambiguous under Playwright's strict mode.
* The control **is** the legend: a checkbox next to the swatch whose color it
  governs. At desktop the legend `<details>` is force-open by CSS, so the filter
  needs no interaction to be visible.

What the refresh did instead:

* the legend's status filter became a labelled `role="group"` (`지도에 표시할 후보
  상태`) and each row now carries its **served count** beside the label — an
  optional `statusCounts` prop, `null` until the summary loads, so a count is
  never fabricated as `0`;
* the sidebar's 후보 상태 요약 reports, per status, `지도 표시 중` / `지도에서 숨김`
  as TEXT, plus one sentence naming where to change it and stating that display
  settings change no count and no score.

## 5. Components

New, under `frontend/src/components/suitability/` — all presentational, none
holding analytical state:

| Component | Replaces | Owns |
| --- | --- | --- |
| `SuitabilitySidebar` | `SuitabilityPanel()` in `page.tsx` | composition + the `suitability-live` region + the reason/coverage/method cards |
| `SuitabilityScoringBasis` | the inline `profile-selector` section + `CriticMethodNote()` | the active-basis card, the 5 radios, the CRITIC method note |
| `SuitabilityStatusSummary` | the inline `suitability-summary` section | the total, 3 status rows, map display state, status meanings, run/version disclosure |
| `SuitabilityStabilitySummary` | `StabilitySummary()` + the `stability-unavailable` branch | the three counts, the cutoff, the compared profiles, the caveat |
| `SuitabilityCandidateList` | the inline `top-candidates` + `stable-candidates` sections | the ranked rows, the neutral framing, the vector-tile note |
| `SuitabilityCandidateSummary` | `CandidateDetailPanel()` | the selected candidate, **plus a new explicit empty state** |
| `SuitabilityMapInsightStrip` | — (new) | nothing — renders passed-in strings only |
| `SuitabilityScreeningNotice` | the same function in `page.tsx` | nothing (moved verbatim) |
| `UnmodeledFactorsDisclosure` | the same function in `page.tsx` | nothing (moved verbatim) |
| `StabilityBadge` | the same function in `page.tsx` | nothing (moved verbatim) |
| `shared.ts` | `PROFILES` / `STATUS_LABELS` / `OLD_RUN_NO_CRITIC_MESSAGE` in `page.tsx` | three constants + the neutral rank-framing sentence |

`SuitabilityScenarioLab` was **not** replaced. Its state machine, its effects, its
request path, its sequence guard, and its session persistence are untouched; only
its JSX was restructured into `SectionCard`s and two sub-components were added
(`ScenarioOverview`, and the selected-candidate comparison inside
`ScenarioSummary`).

Shared primitives adopted: `SectionCard` (every section on both sub-views),
`InfoBanner` (the screening notice, the strip's 주의 block, the scenario request
error), `EmptyState` (no candidate selected, and an empty ranking), `PageHeader`
(already in use).

Deliberately **not** used:

* `KpiCard` — the selected candidate's 점수 / 순위 pair must render `순위 없음` and
  `참고용 임시 점수` as *labels*, not as an `unavailableReason` replacing a value;
  `KpiCard`'s contract is one value or one reason, not a labelled pair.
* `FilterChip` — the status filters are native checkboxes contracted by test id
  (§4); converting them to `aria-pressed` buttons would change their semantics.
* `Accordion` — it genuinely collapses at desktop, which is wrong for the
  analytical sections here; the two remaining disclosures (상태 설명, 분석 정보) are
  plain `<details>` holding *supplementary* content only.
* `Chip` — nothing on this screen is a removable token.
* A second state store. `page.tsx` still owns `profile`, `selected`,
  `statusVisibility`, `stableOnly`, `appliedScenario`, `scenarioSelected`,
  `restoredScenario`, `restoredCandidate`, and the URL mirror.

`page.tsx` is **695 lines shorter** (2943 → 2248; +68 / −763) and gained no new state, effect,
memo, or API call — only one module-level constant (`CANDIDATE_STATUS_COLORS`,
built from the existing `lib/metrics.ts` candidate constants).

## 6. Existing analysis reused — nothing new was fetched or computed

| Surface | Source |
| --- | --- |
| status counts, totals, reasons, coverage notes, assumptions | `SuitabilitySummary` (unchanged) |
| ranked candidates, stable short-list | `summary.top_candidates` / `top_stable_candidates`, in served order |
| active profile weights | `run.weight_profiles[profile]`, falling back to `policy.weight_profiles[profile]` for a pre-CRITIC run — the identical resolution the old panel used |
| CRITIC method, population, zero-variance criteria | `run.weight_derivation` (unchanged) |
| stability counts, cutoff, compared profiles | `summary.candidate_count_*` / `stability_top_cutoff_rank` |
| candidate detail, component scores, reasons, sensitivity | `fetchSuitabilityCandidateDetail` (unchanged call, unchanged caching) |
| equity/demand raw interpretation | `classifyEquityRaw` (lib/suitability.ts, unchanged) |
| stability badge text | `stabilityBadgeLabel` (lib/suitability.ts, unchanged) |
| scenario totals, ranks, contributions, movement | `previewUserWeightScenario` + `rankMovementText` (lib/scenario.ts, unchanged) |
| scenario 현재 운영 기준 reference | `decimalWeightsToPercents(run.weight_profiles[compareProfile])` — the same tested function the preset buttons already used |
| map colors | `CANDIDATE_SCORE_PALETTE_5`, `CANDIDATE_REVIEW_COLOR`, `CANDIDATE_EXCLUDED_COLOR`, `CANDIDATE_SCORE_BREAKS`, `CANDIDATE_STABLE_OUTLINE_COLOR` (lib/metrics.ts, unchanged) |

Three pure helpers moved into `lib/suitability.ts` so they are unit-testable:
`weightPercent`, `namedWeights` (both lifted verbatim from `page.tsx`), and
`namedWeightRows` (the same values in row form, so a table and a sentence cannot
disagree). One behaviour changed inside `weightPercent`: a **blank** string now
renders `-` instead of `0%`, because `Number("")` is `0` and a blank weight is
missing, not zero. No call site passes a blank today.

## 7. Formulas intentionally untouched

Nothing in this milestone touches the analysis. Specifically unchanged: the
suitability and component score formulas, component normalization, candidate
score calculation, the baseline / equal / equity-focused / access-focused / CRITIC
weights, the user-scenario calculation and its weight validation, candidate status
classification and the eligible/review/excluded rules, exclusion and review
reasons, ranking and tie behaviour, top-N, candidate stability and the stable
definition, the map color breaks and palette, the status colors, the stable
outline color, every API request parameter and response type, every URL-state key,
candidate IDs, and the candidate-grid / derivation / policy versioning.

No scoring calculation was reimplemented inside a visual component. The only
arithmetic any new component performs is `Math.round(decimal * 100)` for display.

## 8. Status, stability, and missing data

* **Status is never color alone.** Each summary row carries the plain name
  (`스크리닝 통과` / `추가 검토 필요` / `프로젝트 스크리닝 제외`), its count, and its
  display state as text; the swatch is `aria-hidden` supporting context. Raw enums
  stay out of primary text — `ELIGIBLE` survives only inside `[data-diagnostic]`
  nodes and served reason strings.
* **Stability is stated in words.** `STABILITY_META` / `stabilityBadgeLabel`
  supply "안정 후보 3/3" etc.; the map's magenta outline remains a supporting
  signal, unchanged. The summary repeats the standing caveat that stability is a
  sensitivity property, not 최종 입지 / 허가 / 법적 적격성, and a test asserts the
  words 안전성 / 시공 가능성 / 법적 안정성 / 정책 확정성 never appear.
* **A missing component renders `-`**, with the sentence
  `점수가 -인 항목은 자료가 없다는 뜻이며 0점이 아닙니다` directly under the table.
* **A review candidate** shows its `참고용 임시 점수` labelled as provisional,
  `순위 없음`, its review reasons, and the note that missing items are not
  substituted with 0.
* **An excluded candidate** shows its exclusion reasons and the sentence
  `분석 규칙에 따른 제외이며 자료 오류가 아닙니다` — analytical exclusion is visibly
  distinguished from missing data and from a system error, and carries no
  `role="alert"`.
* **A count that was not served** renders `자료 없음` (`countText`), never `0`; the
  legend's per-status counts are omitted entirely until the summary loads.
* **No candidate selected** renders an explicit instruction naming both selection
  paths — never a sample candidate, a placeholder score, or a zero.

## 9. Accessibility decisions

* **The screening disclaimer is standing, uncollapsed content** at the top of both
  map sub-views, with a text severity label (`알림 · 광역 분석 스크리닝`) and no
  `role="alert"`.
* **`role="alert"` is used exactly twice**, both for genuine, actionable errors
  that have just occurred: the suitability meta-load failure, and the scenario
  preview request failure. The total-weight validation is `role="status"` — it
  changes on every keystroke, and an invalid total is a state of the editor, not
  an error event.
* **Native controls stayed native.** The profile control is five
  `input[type=radio][name="profile"]` in ONE group (so arrow keys traverse all
  five) inside a labelled `<fieldset>`; the status filters and the stable-only
  restriction stay native checkboxes; the comparison profile stays a `<select>`;
  the weight controls stay a paired `range` + `number` with unchanged accessible
  names. No `role="tab"` or `role="radiogroup"` was introduced.
* **The new `<fieldset>` is in suitability only.** `e2e/accessibility.spec.ts`,
  `e2e/phase4EquityMap.spec.ts`, and three unit suites assert the page has exactly
  three fieldsets — all on the default 지역 부담 view, which this milestone does not
  touch. (The scenario lab's weight editor was already a fieldset in that area.)
* **Nothing is communicated by color alone.** The selected profile row carries the
  native `checked` radio + a heavier weight + a stronger border; a selected
  candidate row carries `aria-current="true"` + `✓ 선택됨` + weight + border; the
  scenario total carries `✓`/`!` + the words 적용 가능 / 합계가 정확히 100%여야…;
  every status and every stability class carries its text label.
* **Every bar has its number beside it.** The active-basis weight rows render a
  short track *and* the percentage as text; the track is `aria-hidden` and hidden
  below `sm`.
* **The keyboard path to a candidate is unchanged**: the ranked rows are native
  buttons, and the map's `aria-describedby` text still points at the sidebar list
  and detail panel.
* **One `<h1>`, one `<main>`, one navigation, one `MapView`** on both sub-views —
  asserted at four viewports.

## 10. Viewport behaviour

Measured with `mockSuitabilityBackend`, in Chrome, on 후보지 점수:

| Viewport | Sidebar | Map (px) | Map bottom | Strip | Legend bottom → strip top |
| --- | --- | --- | --- | --- | --- |
| 1024 × 768 | 384, scrolls locally | 640 × 640 | 768 | 177px — 28% of the map | 551 → 559 |
| 1280 × 800 | 384, scrolls locally | 896 × 672 | 800 | 161px — 24% | 599 → 607 |
| 1440 × 900 | 384, scrolls locally | 1056 × 772 | 900 | 161px — 21% | 699 → 707 |
| 1920 × 1080 | 384, scrolls locally | 1536 × 952 | 1080 | 161px — 17% | 879 → 887 |

At every one of them: the document does not scroll in either axis, the sidebar is
the only vertical scroll container, the map's bottom edge is at the viewport
bottom, the map keeps >75% of the viewport height and >400px of width, the strip
covers less than a third of the map, the legend sits above the strip with an 8px
gap, and neither overlay reaches the MapLibre navigation control or the
OpenStreetMap attribution.

Below 1024px the strip is not rendered and the pre-existing responsive behaviour
is untouched — this milestone added no mobile drawer, bottom sheet, tab bar, or
candidate carousel, per its scope.

## 11. Tests added

`frontend/src/app/page.suitabilityDashboard.test.tsx` — 34 assertions (jsdom,
MapLibre stubbed with a candidate-click trigger, backend mocked):

* one `h1` / one map / one `<main>` / one `<aside>` / one nav / one sub-view
  control, on both map sub-views;
* the screening disclaimer outside any `<details>`, and not `role="alert"`;
* the active basis name, its glossary method sentence, its four named weights, and
  its live-region announcement — following the profile radio, with the CRITIC
  caveat wording;
* status totals, per-status counts, the total, and the display state of each
  status; the display state updating when the ONE legend control is flipped;
* exactly one control per status and one `stable-only-toggle` on the whole screen;
* the stable-only restriction being reported in the sidebar;
* the run/version context and the served coverage note;
* stability stated in words, without 안전성 / 시공 가능성 / 법적 안정성 / 정책 확정성;
* the served ranked order rendered verbatim, with the neutrality framing and
  without 최적 / 최고 / 추천 / 건설 권고;
* the empty selected-candidate prompt; list → selection → summary + `aria-current`;
* map click → the SAME single selection; URL `cand=` restoration;
* citizen component names with their score and weight; a review candidate's
  provisional score and its `-` component; an excluded candidate's reasons with no
  score, no rank, and no alert role;
* the candidate's reference year, run, and version context;
* a forbidden-token scan of the sidebar with diagnostics and disclosures stripped;
* the legend and the strip sharing one overlay column inside `.map-pane`, with
  `MapView` still the direct child;
* the strip's neutral interpretation, standing caution, served basis, and its
  route to 데이터·출처;
* the scenario editor's four controls and citizen labels, 현재 운영 기준 named apart
  from 사용자 설정, the absence of 새 공식 기준 / 확정 기준 / 정책 가중치;
* invalid total → apply disabled + no request; normalize → apply enabled;
* preset load without applying; reset restoring the stored profile;
* the applied summary's weights, comparison basis, and rank movement, with no
  "better site" claim; the selected-candidate baseline-vs-scenario comparison;
* the applied weights reaching the versioned URL and the strip; a shared scenario
  URL seeding the editor without showing a result and without a request;
* one editor / one apply / one result list / one compare select.

`frontend/e2e/suitabilityDashboard.spec.ts` — 31 assertions at 1024×768,
1280×800, 1440×900, and 1920×1080, self-mocked
(`e2e/suitabilityFixtures.ts`), structure and geometry only:

* no horizontal overflow, no page-level vertical scroll, the sidebar scrolling
  locally and moving without moving the page;
* the map reaching the viewport bottom, >75% of the viewport height, >400px wide;
* the strip inside the map bounds and under a third of its height;
* the legend directly above the strip with no overlap, clear of the attribution
  and of the MapLibre navigation control;
* one map / one `h1` / one navigation / one sub-view switch / one `<main>`;
* the header, the disclaimer, and the active basis visible without scrolling; all
  five profile radios, all three status filters, the stable-only toggle, and all
  three candidate rows individually reachable;
* status totals and display state, and exactly one control per status;
* changing the basis, and it reaching the strip and the URL;
* list selection → summary + `aria-current` + `cand=` in the URL, and clearing back
  to the explicit prompt;
* a review candidate's provisional score and `-` component; an excluded
  candidate's reasons with no component table;
* a shared candidate link restoring, and the strip routing to 데이터·출처 (no map);
* the scenario map geometry, the invalid-total block, apply, the strip switching
  to its scenario copy, the URL carrying the weights, the selected-candidate
  comparison, and the reset control;
* the cost sub-view still mounting its dashboard with no map and intact chrome.

`frontend/src/lib/suitability.test.ts` — 5 added assertions for `weightPercent`,
`namedWeights`, and `namedWeightRows`, including that a blank weight renders `-`
rather than `0%` and that the row form and the sentence form agree.

Deliberately no pixel snapshots — the repository has no visual-regression
infrastructure (`baseline.md` §7).

## 12. 비용 살펴보기 intentionally deferred

`view=cost` was **not** redesigned and `components/FacilityCostDashboard.tsx` was
**not modified** — no styling change, no behaviour change, not one line. It keeps
its own top screening notice, its own `<h1>`, the shared top navigation, the shared
sub-view switch, URL restoration, and its full existing test suite.

Both new suites carry a cost regression guard (a unit test and an e2e test) that
assert it still mounts, still mounts **no** map, still has exactly one `h1` and one
sub-view control, still shows the screening disclaimer, and that returning to
후보지 점수 restores the score workspace and its single map.

## 13. Other deferred work

* **매립지 현황 and 데이터·출처** keep their current treatment; they belong to their
  own milestones.
* **`DerivedPanel` / `SourcePanel`** (the equity 출처와 계산 방법 disclosure) were
  again not restyled — unchanged from the equity milestone's deferral.
* **The status filter's location.** §4 records why it stayed in the legend. If a
  future milestone wants it in the sidebar, that is a contract change requiring the
  three test files named there to move with it — not a styling edit.
* **`e2e/regressions.spec.ts:133`** expects `equity-score-direction` to contain the
  word `inverse`, which the current Korean-only wording has not carried since the
  Phase 0 terminology work. It is a live spec (skipped without `E2E_BACKEND_URL`),
  so it neither passed nor failed here; it was pre-existing and is untouched.
* **Mobile.** No drawer, bottom sheet, tab bar, or candidate carousel was built;
  the existing sub-1024 behaviour is preserved as-is.
* **Deployment.** This milestone is not deployed. OCI currently runs the
  land-cover release; the UI refresh has not been shipped there.

## 14. Follow-up — the insight is collapsed by default, in both variants

Shipped on `feat/collapsible-map-insights`, together with the identical change to
`equity/EquityMapInsightStrip` (see `equity-dashboard.md` §12). The two overlays share
one label constant (`MAP_INSIGHT_SUMMARY_LABEL` in `lib/glossary.ts`), one CSS class
(`.map-insight` in `app/globals.css`), and one interaction — there is no second style
system and no second implementation.

### Before → after

| | Before | After |
| --- | --- | --- |
| Default state (score AND scenario) | always expanded | **closed** |
| Collapsed footprint | — | one bar, **163 × 42 px**, bottom-right |
| Expanded footprint | full map width × ~180 px, permanently | ≤ **832 px** wide × ~201 px, only while opened |
| Position | bottom band, left-aligned, full width | bottom band, **right-aligned** |
| Element | `<section>` | `<details>` + `<summary>` |

The compact label is exactly `해석 · 주의 · 출처 보기`. Its `▾` chevron is
`aria-hidden` and rotates on `[open]`, so the accessible name equals the printed label.
`data-testid="suitability-insight-summary"` names the bar; every pre-existing test ID
is untouched.

### Content preserved, per variant

| Group | 후보지 점수 | 가중치 바꿔보기 |
| --- | --- | --- |
| 해석 (`suitability-insight-interpretation`) | the stored profile's relative-screening sentence | the applied-weights sentence, or the not-yet-applied prompt |
| 주의 (`suitability-insight-caution`) | `결과 해석 한계` — 법적·공학적 적합 판정이 아닙니다 | `비교용 시나리오` — 공식 분석 실행이 아닙니다 |
| 현재 기준·출처 (`suitability-insight-basis`) | 점수 반영 기준 · 자료 기준 시점 · 지도 표시 | 비교 기준 · **적용 가중치** · 자료 기준 시점 · 지도 표시 |
| Visible statuses + stable-only (`suitability-insight-visibility`) | preserved, including `표시 중인 상태 없음` and `· 안정 후보만` | same |
| 기술 정보 (`suitability-insight-technical`) | run id, policy version, derivation version, candidate-grid version | same |
| Action (`suitability-insight-open-sources`) | `출처 자세히 보기` | same |

The 기술 정보 `<details>` is **kept nested inside** the new outer disclosure rather than
promoted or flattened; the version strings stay out of primary text exactly as before.
`.map-insight > summary` uses the direct-child combinator, so the nested summary is
untouched by the new styling.

No scoring, weight, status-visibility, stable-only, tile, URL, or API behaviour
changed. The component still computes nothing and renders no score, rank, or count.

### The land-cover / legend overlay conflict

The previously observed production defect — at ≤768 px viewport heights the bottom
overlay stack rose over the top-left land-cover control, and the legend intercepted
clicks meant for it — was caused by the tall always-expanded card lifting the legend.
Measured at 1024×768, map height 640 px:

| State | bottom-column top | land-cover control bottom | verdict |
| --- | --- | --- | --- |
| Before (always expanded) | **156 px** | 224 px | legend covers the control |
| After, collapsed (the new default) | **454 px** | 224 px | clear by 230 px |
| After, expanded, before the bound | 156 px | 224 px | still covered |
| After, expanded, with the bound | **278 px** | 224 px | clear by 54 px |

Collapsing by default resolves the defect in the default state outright. The one
remaining case — the insight deliberately expanded at a short viewport — needed the
smallest bounded-height correction: at `min-width: 768px and max-height: 820px` the
legend body's cap drops from `46vh` to `30vh` (`app/globals.css`). That body is
already an internally-scrollable container, so no class row, break, color, or count is
lost — a scroll replaces a taller card. It is scoped by **height**, because vertical
space is what the two stacks compete for; at ≥860 px heights they never meet and the
legend keeps its full 46vh.

`e2e/mapInsightDisclosure.spec.ts` now exercises `land-cover-layer-summary`,
`land-cover-layer-toggle`, `status-toggle-ELIGIBLE`, and the MapLibre zoom buttons with
real, unforced clicks at 1024×768 and 1440×900, with the insight both collapsed and
expanded.

**Known residual, pre-existing and out of scope:** at 1024×768 a *fully expanded*
land-cover panel (its own body is capped at `52vh`) and the legend still share the
map's left gutter, and the legend — later in DOM order at the same `z-10` — paints
over its lower part. The panel's own interactive controls (its summary and its layer
toggle) stay clear and clickable, which is what this task contracted. Resolving the
deeper overlap requires re-laying-out the map overlay stacks and belongs to its own
milestone.

### Pointer-event behaviour, viewports, accessibility

Identical to the equity disclosure — see `equity-dashboard.md` §12. In short: the
full-width positioning row is `pointer-events-none` and only the `<details>` is
`pointer-events-auto`; the card grows upward from the bottom-anchored column and never
overlaps the legend, the zoom controls, the top-left layer stack, or the sidebar; it
does not render below 1024 px; Enter and Space toggle it natively; the closed body is
out of the tab order; focus is not trapped; the named region moved onto the body; no
live region was added.

### Tests added

* `components/suitability/SuitabilityMapInsightStrip.test.tsx` — 12 new assertions
  across both variants: collapsed by default, the shared label, one outer disclosure
  with the technical one nested inside it, containment, the score interpretation, the
  scenario interpretation, both caveats, the applied weights, stable-only, the
  empty-visibility wording, close-and-re-gate, the routed action, no duplicate, no
  live region.
* `app/page.suitabilityDashboard.test.tsx` — one new integration test plus three
  existing tests updated to open the disclosure before reading it.
* `e2e/mapInsightDisclosure.spec.ts` (new, 60 tests, shared with equity) — both
  suitability sub-views at 1024×768, 1280×800, 1440×900, 1920×1080; behaviour,
  keyboard, hit testing, drag, control operability, and narrow regression.
* `e2e/suitabilityDashboard.spec.ts` — open-state geometry added; one assertion
  updated for the collapsed default.

### Deployment scope

Frontend only. No backend, database, migration, ingestion, Docker, Compose, Caddy, or
infrastructure change, and no data change of any kind.
