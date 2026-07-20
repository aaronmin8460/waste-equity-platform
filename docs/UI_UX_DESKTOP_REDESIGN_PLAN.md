# Desktop UI/UX Redesign — Phase 0 Baseline and Phased Plan

**Status:** Phases 0–4 complete. Phase 0 was audit + plan only; Phases 1–4 shipped
(global foundation, facility-cost setup, facility-cost results, regional burden map).
Phases 5–7 not started.
**Branch:** `docs/phase-0-desktop-ui-ux-baseline`
**Date:** 2026-07-20
**Scope of this document:** the frontend at `frontend/src`. No backend, API, calculation, or infrastructure change is proposed or made.

---

## 1. Executive summary

### Why the redesign is needed

The frontend grew feature-first across seven delivery phases. Each phase added a correct, well-tested, analytically honest surface — and each added it to the same place: `frontend/src/app/page.tsx`, now **2,643 lines** holding the shell, the mode router, the equity sidebar, the suitability panel, four provenance sub-panels, and three data-derivation hooks.

The result is a product whose *information* is trustworthy and whose *presentation* no longer helps an ordinary citizen act on it. Three measured symptoms:

1. **A design-token layer exists and is almost entirely unused.** `globals.css` defines a complete semantic system (`--color-surface`, `--color-primary`, `--radius-card: 0.75rem`, `--shadow-card`, plus `.wep-card` / `.wep-btn-primary` / `.wep-btn-quiet` / `.wep-chip`). Adoption across all non-test components: `.wep-card` — **1 file**; `.wep-btn-primary` — **2 files**. Meanwhile the raw utility `rounded` (0.25rem) appears **64 times**, `rounded-md` 4, `rounded-lg` 4, `rounded-sm` 8. The tokens are not the problem; the missing adoption is.
2. **Warning styling is the default styling, not the exception.** `amber-*` utilities appear **60 times** across 8 non-test components. When the disclaimer, the coverage note, the validation message, the partial-data note, and the "this is not a tax bill" caveat all render as amber-bordered amber-tinted panels, none of them reads as more important than the others — and the actual analytical result competes with all of them.
3. **The primary answer is rarely the most prominent thing on screen.** In 비용 살펴보기 at 1440×900, a citizen sees ~270px of amber warning before the first input, and the calculated result sits below both the warning and the full setup form (see `docs/ui-baseline/desktop/facility-cost-results-1440x900-full.png`).

### Why the work is desktop-first

The mobile/responsive layer was deliberately built and hardened in a prior phase (`frontend/RESPONSIVE_LAYOUT.md`, `e2e/responsive.spec.ts`, `src/app/responsive.test.tsx`) and it currently passes at every viewport from 390×844 to 1440×900. It is *correct*. What it is not is *designed* — the desktop layout is the mobile layout with a 384px sidebar bolted to the left.

Desktop is also where this product is actually used for deliberation: reading a cost breakdown, comparing regions, and checking provenance are wide-screen, long-session tasks. Phase 0 therefore targets **1440×900 primary / 1280×800 verified**, and explicitly defers mobile visual work rather than half-doing it.

### In scope

- Visual hierarchy, information architecture, navigation, and component consistency for the four dashboard areas and the three candidate-analysis subviews.
- A shared desktop component layer built on the **existing** `globals.css` tokens.
- Display-level number rounding, with the exact backend value preserved and reachable.
- Removing Korean/English label duplication from primary UI.
- Hiding raw backend reason codes from primary citizen UI (keeping them in detail layers, API, logs, and tests).

### Out of scope

- **Mobile and tablet redesign.** Existing responsive behavior must not regress, but no mobile optimization work is planned here.
- Any backend change: calculations, API shapes, error codes, migrations, ingestion.
- Dark theme (`globals.css` deliberately pins `color-scheme: light`).
- Adding a third-party UI library (React Aria, shadcn, Radix, MUI, …). Everything proposed is native HTML + Tailwind v4 + the existing tokens.
- New analytical features, metrics, or profiles.

### What must remain unchanged

| Invariant | Enforced by |
|---|---|
| Displayed analytical values come from official backend data only | Root `AGENTS.md`; no bundled/fallback dataset exists |
| A missing value is never rendered as `0` | `regionDisplay.ts`, `PerCapitaCard`, `FacilityCostRegionTable`, and ~8 test files |
| An official measured `0` stays distinct from `자료 없음` | `classifyEquityRaw`, `ranking.test.ts`, `csv.test.ts`, `landfill.test.ts` |
| Exact decimal strings are formatted, never reconstructed from floats | `formatQuantity` (string-regex based, no `Number()` round-trip) |
| Every displayed metric carries source + reference period | Root `AGENTS.md`; `metricProvenance`, `DerivedPanel`, `SourcePanel`, `FacilityCostEvidence` |
| Standard construction cost ≠ actual total project cost | `COMPLETENESS_NOTICES`; `총비용` asserted absent in 2 e2e specs |
| Estimated subsidy ≠ approved subsidy | `SUBSIDY_RATE_FORM_NOTE`, `subsidy.rate_basis` |
| Per-capita local share ≠ personal tax bill | `PerCapitaCard` caveat; `COMPLETENESS_NOTICES` |
| Suitability = analytical screening, not legal approval | `s.disclaimer`, `context.suitability_disclaimer`, legend disclaimer |
| Exactly one `MapView` instance ever | `responsive.spec.ts`, `page.test.tsx` |

---

## 2. Current architecture map

### 2.1 Top-level mode state

All four areas are one client component: `Home()` at [page.tsx:213](../frontend/src/app/page.tsx#L213).

```
type DashboardMode = MapMode | "flow" | "transparency"   // page.tsx:145
type MapMode       = "equity" | "suitability"            // components/MapView.tsx
type SuitabilityView = "score" | "scenario" | "cost"     // page.tsx:135
```

`DashboardMode` is exactly the citizen-facing `DashboardArea` in [glossary.ts:37](../frontend/src/lib/glossary.ts#L37). Mode changes route through `changeMode` ([page.tsx:485](../frontend/src/app/page.tsx#L485)), which clears the applied scenario when leaving suitability and closes the report overlay when leaving equity. Subview changes route through `changeSuitabilityView` ([page.tsx:493](../frontend/src/app/page.tsx#L493)), which clears the scenario when leaving the weight lab.

### 2.2 Render routing — four early returns before the map layout

`Home()` returns one of six trees, in this order:

| Order | Line | Condition | Tree |
|---|---|---|---|
| 1 | [1016](../frontend/src/app/page.tsx#L1016) | `error !== null` | Centered `role="alert"` card + 다시 시도 |
| 2 | [1037](../frontend/src/app/page.tsx#L1037) | `data === null` | Centered `role="status"` loading text |
| 3 | [1056](../frontend/src/app/page.tsx#L1056) | `mode === "transparency"` | Full-width, **no map** → `TransparencyDashboard` |
| 4 | [1071](../frontend/src/app/page.tsx#L1071) | `mode === "flow"` | Full-width, **no map** → `LandfillDashboard` |
| 5 | [1100](../frontend/src/app/page.tsx#L1100) | `mode === "suitability" && view === "cost"` | Full-width, **no map** → `FacilityCostDashboard` |
| 6 | [1144](../frontend/src/app/page.tsx#L1144) | fallback | Map layout: `<aside w-96>` + `.map-pane` + `MapLegendOverlay` |

**Architecturally load-bearing consequence:** the top navigation renders in **two structurally different places**. In trees 3–5 it is a full-width row above the content (`mx-auto max-w-screen-2xl px-4`); in tree 6 it is inside the 384px sidebar. This is the root cause of the "two unrelated navigation rows" complaint, and it is why the nav *wraps to two lines* in equity/score mode (four buttons in 384px) but sits on one line elsewhere. Verified in `regional-burden-1440x900.png` vs `landfill-dashboard-1440x900.png`.

### 2.3 State ownership

| State | Owner | Notes |
|---|---|---|
| `data: LoadedData` | `Home` | 10 parallel fetches in `load()` ([page.tsx:280](../frontend/src/app/page.tsx#L280)) |
| `mode`, `suitabilityView` | `Home` | wrapped setters clear dependent state |
| `metricKey`, `showFacilities` | `Home` | |
| `selectedRegionCode` | `Home` | **code only** — the selection is *derived* per metric via `buildRegionSelection` ([700](../frontend/src/app/page.tsx#L700)); never a value snapshot |
| `flowYear/Month/Origin/Waste`, `flowData`, `flowError` | `Home` | passed down to `LandfillDashboard` as controlled props |
| `suit` (policy+run+summary), `suitError`, `selected` | `Home` | |
| `statusVisibility`, `stableOnly` | `Home` | canonical; `MapLegendOverlay` checkboxes drive these, no duplicate state |
| `appliedScenario`, `scenarioSelected` | `Home` | the *applied* scenario; the **draft editor state lives inside `SuitabilityScenarioLab`** (+ sessionStorage) |
| `scope`, `topN`, `comparison`, `reportKind`, `urlWarnings` | `Home` | equity ranking/comparison/share |
| `restoredScenario`, `restoredCandidate`, `urlRestored` | `Home` | one-shot URL restore |
| cost scenario form, options, result, `outputSig`, `requestSeq` | **`FacilityCostDashboard`** | fully self-contained; `Home` only supplies `wasteRegions` + `selectedCandidate` |

### 2.4 Where API data is fetched

- **`Home.load()`** — 10 parallel calls on mount: boundaries, population, waste-statistics, facilities, waste-per-capita, facility-burden, reporting-boundaries, reporting-statistics, reporting-per-capita, data-sources.
- **`Home` effect (suitability)** — policy + latest run + summary on entering the mode ([344](../frontend/src/app/page.tsx#L344)); summary refetched on profile change ([366](../frontend/src/app/page.tsx#L366)). *The dependency list deliberately excludes `suit` — a documented infinite-refetch fix.*
- **`Home` effect (flow)** — summary + trends + composition on mode entry and on any of four filter changes ([390](../frontend/src/app/page.tsx#L390)), with a `cancelled` guard.
- **`Home` callbacks** — `onCandidateClick`, `selectScenarioCandidate`.
- **`FacilityCostDashboard`** — `fetchFacilityCostOptions` on mount; `fetchFacilityCostCalculate` on explicit button click only.
- **`SuitabilityScenarioLab`** — `previewUserWeightScenario` on explicit apply.
- **`MapView`** — vector tiles (`.mvt`) directly via MapLibre; no bbox GeoJSON fetch, no row limit.

### 2.5 Facility-cost data flow

```
Home.data.waste.items
  └─ facilityCostWasteRegions  (page.tsx:1004)  {code, name, stream}[]
       └─ FacilityCostDashboard
            ├─ fetchFacilityCostOptions()  → options → seeds ScenarioState
            ├─ regionOptions = wasteRegions.filter(stream === scenario.wasteStream)  (dedupe + ko sort)
            ├─ currentSig = JSON.stringify({scenario, candidateId})
            ├─ calculate() → requestSeq guard → fetchFacilityCostCalculate → {result, outputSig}
            └─ resultCurrent = result !== null && outputSig === currentSig
```

`resultCurrent` is the staleness gate: **any** input change (or a different map candidate) changes `currentSig`, so a result stops rendering until recalculated. `requestSeq` discards superseded in-flight responses. Both behaviors are tested and must survive the redesign.

Render order inside the cost view ([FacilityCostBody:326](../frontend/src/components/FacilityCostDashboard.tsx#L326)):
`FacilityCostNotice` → `FacilityCostFilters` → error/stale → `FacilityCostResults` → `CitizenConditions`. *(Phase 2 replaced `FacilityCostFilters` with `FacilityCostSetup` and removed `CitizenConditions`.)*
`FacilityCostResults` ([683](../frontend/src/components/FacilityCostDashboard.tsx#L683)) then renders: KPI grid → funding breakdown → region table → candidate context → evidence.

### 2.6 Landfill dashboard data flow

`Home` owns all four filters and the fetched `flowData`; `LandfillDashboard` is a controlled presentational component receiving `{data, error, year/setYear, month/setMonth, origin/setOrigin, waste/setWaste}`. Request scoping differs per endpoint by design (summary = all four filters; trends = year+origin+waste, spanning the whole year; composition = year+origin only, so the waste dropdown is not narrowed by itself). On error, `flowData` is set to `null` — previous-filter values are dropped rather than misattributed.

### 2.7 Transparency dashboard data flow

Purely derived: `TransparencyDashboard` receives the already-loaded `LoadedData` and renders sources, dataset periods/counts, suitability run info, and cost inclusion/exclusion. It also fetches facility mapping transparency separately. It is the **only component already using `.wep-card`** and is the closest existing thing to the target visual language.

### 2.8 Shared URL state

`lib/urlState.ts` — pure, no `window` access, version-gated on `v=1`.

- **Fields:** `mode, metric, region, cmp[], scope, top, view, profile, statusOn[], stableOnly, weights{z,r,e,d}, cmpProfile, candidate`.
- **Decode** ([94](../frontend/src/lib/urlState.ts#L94)): every field enum/bounds/regex checked; invalid fields dropped with a plain-Korean warning, never fatal; unknown `v` ignores everything. Region codes format-screened (`/^[A-Za-z0-9-]{1,30}$/`); existence validated by the caller against loaded geography. `cmp` capped at `MAX_COMPARE = 3` and deduped. Status has an explicit `none` sentinel so "all hidden" round-trips.
- **Encode** ([232](../frontend/src/lib/urlState.ts#L232)): defaults omitted; suitability-only fields written only in suitability mode; weights only in the scenario subview.
- **Restore** ([922](../frontend/src/app/page.tsx#L922)): once, after `data` loads, guarded by `urlRestored` ref.
- **Mirror** ([968](../frontend/src/app/page.tsx#L968)): one-way state→URL via `history.replaceState` — no navigation, no history spam, no loop.

Restored scenario weights are re-validated by the **preview API** before anything renders; `urlState.ts` never decides analytical validity.

### 2.9 Component inventory (complete)

| File | Lines | Role |
|---|---|---|
| `app/page.tsx` | 2643 | Shell, router, equity sidebar, suitability panel, provenance panels |
| `app/globals.css` | 388 | Tokens, `.wep-*` classes, `.map-pane`, skip link, focus ring, print |
| `app/layout.tsx` | — | `lang="ko"`, viewport, skip link |
| `components/MapView.tsx` | 1001 | MapLibre; choropleth + candidate vector tiles + popups |
| `components/FacilityCostDashboard.tsx` | 1147 | 비용 살펴보기 (redesign target #1) |
| `components/LandfillDashboard.tsx` | 814 | 매립지 현황 |
| `components/SuitabilityScenarioLab.tsx` | 778 | 가중치 바꿔보기 |
| `components/TransparencyDashboard.tsx` | 446 | 데이터·출처 |
| `components/MapLegendOverlay.tsx` | 308 | Floating legend (equity + suitability) |
| `components/RegionComparison.tsx` | 262 | Combobox + chips (up to 3) |
| `components/ReportPreview.tsx` | 237 | Print/PNG modal |
| `components/RegionRanking.tsx` | 174 | High/low ranking |
| `components/ShareExportBar.tsx` | 127 | Share link + CSV + report |
| `lib/` | 15 modules | `api, metrics, glossary, urlState, regionDisplay, suitability, ranking, scenario, landfill, csv, exports, report` |

---

## 3. Current desktop UI inventory

### 3.1 지역 부담 (equity) — map layout

- **Main component:** `Home` map-layout branch ([1144](../frontend/src/app/page.tsx#L1144)); sidebar `<aside className="… md:w-96 …">`.
- **Children:** `ModeSwitch`, `ModeOrientation`, metric fieldsets (inline), `RegionSummary`, `RegionRanking`, `RegionComparison`, `ShareExportBar`, `CollapsibleSection`×2 (`출처와 계산 방법`, `시설 위치 표시`), `MapView`, `MapLegendOverlay`, `ReportPreview`.
- **Main controls:** 11 metric radios in 3 `<fieldset>`s (all `name="metric"`); region `<select>`; scope + topN; comparison combobox (max 3); facilities checkbox; share/CSV/report buttons.
- **Main results:** choropleth; `선택한 지역` summary (name, value, metric provenance, boundary provenance, derived-city note); high/low ranking; comparison table.
- **Warnings/disclaimers:** `DerivedPanel` (amber card, `metric.caveat`), coverage note, excluded-regions note, `urlWarnings` in `ShareExportBar`.
- **Loading:** page-level `data-testid="loading"`, `role="status"`, plain text. `MapView` has its own overlay.
- **Empty:** `selected-region-empty` prompt; ranking excluded-count line.
- **Error:** page-level `role="alert"` card via `plainError(...)`.
- **URL params:** `v, mode, metric, region, cmp, scope, top`.
- **Tests:** `page.equity.test.tsx`, `page.selection.test.tsx`, `accessibility.test.tsx`, `terminology.audit.test.tsx`, `responsive.test.tsx`, `MapView.test.tsx`, `MapLegendOverlay.test.tsx`, `ranking/exports/report/regionDisplay/metrics` unit tests, e2e `citizenFlows`, `map` (live), `responsive`, `accessibility`, `integration`.

### 3.2 후보지 분석 → 후보지 점수 — map layout

- **Main component:** `SuitabilityPanel` ([1839](../frontend/src/app/page.tsx#L1839)) in the sidebar.
- **Children:** `SuitabilityViewSwitch`, summary section, profile radios, `CriticMethodNote`, `StabilitySummary`, stable-candidate list, top-candidate list, `ReasonSummary`×2, coverage warnings, `CandidateDetailPanel`, assumptions section, `StabilityBadge`.
- **Main controls:** profile radios (`profile-radio-*`, only run-supported profiles); candidate list buttons; status checkboxes + stable-only in the floating legend.
- **Main results:** candidate counts by plain status; stability counts; top candidates (rank · 지역 · 점수 · badge); candidate detail (Z/R/E/D, raw equity/demand, sensitivity, stability membership).
- **Warnings:** `이 결과는 공공자료를 이용한 1차 비교이며 실제 입지 결정이 아닙니다.` (amber, in-summary); `OLD_RUN_NO_CRITIC_MESSAGE` (amber); coverage-warnings (amber); `s.disclaimer` (amber).
- **Loading:** `suitability-loading` plain text. **Error:** `suitability-error` amber section.
- **URL params:** `v, mode, view, profile, status, stable, cand`.
- **Tests:** `page.test.tsx`, `accessibility.test.tsx`, `terminology.audit.test.tsx`, `MapView.test.tsx`, `suitability.test.ts`, e2e `citizenFlows`, `map`/`regressions` (live).

### 3.3 후보지 분석 → 가중치 바꿔보기 — map layout

- **Main component:** `SuitabilityScenarioLab` (778 lines) in the sidebar; the map stays mounted and renders **custom scenario tiles** once applied.
- **Owns:** draft percents, preset selection, comparison profile, preview result, sessionStorage persistence, applied/stale state. `Home` owns only the *applied* scenario + selected scenario candidate.
- **Controls:** 4 sliders + 4 numeric inputs (kept in sync), preset buttons (CRITIC preset only when the run computed it), normalize, apply (enabled only at exactly 100), comparison-profile select.
- **Results:** custom score/rank, rank-movement **text** (never color alone), top candidates, scenario candidate detail with contribution table.
- **Warnings:** always-visible user-scenario warning; legend disclaimer switches to `사용자 가정 기반 임시 비교이며 공식 분석 실행·법적 입지 결정이 아닙니다.`
- **URL params:** `wz, wr, we, wd, cmpProfile` (+ `cand`). A shared scenario is re-validated via the preview API before display.
- **Tests:** `SuitabilityScenarioLab.test.tsx`, `scenario.test.ts`, `api.scenario.test.ts`, e2e `scenario.spec.ts`, `citizenFlows` Task C.

### 3.4 후보지 분석 → 비용 살펴보기 — full-width, no map ★ redesign target #1

- **Main component:** `FacilityCostDashboard` ([164](../frontend/src/components/FacilityCostDashboard.tsx#L164)).
- **Children in render order:** `FacilityCostHeader` → `FacilityCostNotice` (+`FacilityCostMissingComponents`) → `FacilityCostFilters` → error/stale → `FacilityCostResults` (`FacilityCostKpiGrid` + `KpiCard`/`PerCapitaCard` → `FacilityCostFundingBreakdown` → `FacilityCostRegionTable` → `FacilityCostCandidateContext` → `FacilityCostEvidence`) → `CitizenConditions`. *(Phase 2: `FacilityCostFilters` → `FacilityCostSetup` (+`FacilityTypeCards`, `FacilityCostSetupSummary`, `SearchableRegionPicker`); `CitizenConditions` removed.)*
- **Main controls:** facility-type select; waste-stream select; processing-share number; **native `<select multiple size={6}>` for service regions**; `<details>` advanced settings (operating days, underground multiplier, subsidy scheme, cost version); calculate button.
- **Main results:** 8 KPI cards; stacked funding bar; per-region official-input table; candidate context; sources & method.
- **Warnings:** `PAGE_DISCLAIMER`; 8 fixed `COMPLETENESS_NOTICES`; backend `missing_components` with raw reason codes; `SUBSIDY_RATE_FORM_NOTE`; per-capita caveat; validation message; stale-input note; `result.disclaimer`.
- **Loading:** `facility-cost-loading` — `비용 옵션을 불러오는 중… (Loading cost options…)`. **No loading state for the calculation itself** beyond the button label `계산 중…`.
- **Empty:** `이 폐기물 종류로 계산 가능한 지역이 없습니다.` / `계산 가능한 지역만 표시됩니다. 지역을 선택하세요.`
- **Error:** `facility-cost-options-error` (amber, `role="alert"`); `facility-cost-error` (red, `role="alert"`).
- **URL params:** `v, mode=suitability, view=cost` (+ `cand` when a candidate is selected). **The cost scenario form itself is not URL-encoded.**
- **Tests:** `FacilityCostDashboard.test.tsx` (24 tests), e2e `facilityCost.spec.ts` (390×844 + 1440×900), `citizenFlows` Task D, `accessibility.test.tsx` subview test.

### 3.5 매립지 현황 — full-width, no map

- **Main component:** `LandfillDashboard`, controlled by `Home`.
- **Controls:** 4 selects — 연도 / 월·연간 / 출발 광역지자체 / 폐기물 종류.
- **Results:** 4 KPI cards; 4-column regional table; 4 charts + accessible exact-value table fallback; per-capita fee with both reference periods; MOIS source + v2 derivation.
- **Warnings:** full-width amber block `광역지자체 단위 자료이며 시·군·구별 이동 경로나 실제 운송 경로를 의미하지 않습니다.`; per-capita fee caveat; partial-year label; population-definition-change disclosure.
- **Loading:** `landfill-loading`, `role="status"`. **Error:** red panel.
- **URL params:** `v, mode=flow` only — **the four filters are not URL-encoded** (a real sharing gap).
- **Tests:** `LandfillDashboard.test.tsx` (27 tests), `landfill.test.ts`, e2e `landfill.spec.ts` (live-only, 10 tests).

### 3.6 데이터·출처 — full-width, no map

- **Main component:** `TransparencyDashboard`.
- **Sections:** 사용한 공공자료 (table) · 자료별 기준 시점과 표시 개수 (table) · 후보지 분석 정보 · 비용 계산에 포함된 항목과 빠진 항목 · facility mapping transparency · scenario-not-persisted note.
- **Warnings:** `아직 포함하지 못한 비용` list; `값이 없는 지역은 빈 칸으로 두며 0으로 채우지 않습니다.`
- **URL params:** `v, mode=transparency`.
- **Tests:** `TransparencyDashboard.test.tsx` (4 tests), e2e `citizenFlows` Task E.
- **Note:** this area already uses `.wep-card` and has **no Korean/English label duplication in headings**. It is the de-facto reference for the target style.

---

## 4. Verified UX problems

Each claim was checked against the code and the captured 1440×900 baseline. Verdicts are **Confirmed**, **Partially confirmed**, or **Not confirmed**.

### Global

| # | Claim | Verdict | Evidence & effect |
|---|---|---|---|
| G1 | Top nav and candidate subnav feel like two unrelated rows | **Confirmed** | `ModeSwitch` ([1473](../frontend/src/app/page.tsx#L1473)) and `SuitabilityViewSwitch` ([1538](../frontend/src/app/page.tsx#L1538)) render **identical markup**: `flex flex-wrap gap-1.5`, buttons `min-h-[38px] rounded px-3 py-1 text-sm`, active `bg-slate-800 text-white`. Nothing encodes that one is a parent of the other. Worse, the nav's *structural position moves*: full-width row in flow/transparency/cost, but inside the 384px sidebar in equity/score/scenario — where the four buttons **wrap onto two lines** (`regional-burden-1440x900.png`). A user cannot build a stable mental model of "where am I". |
| G2 | `무엇을 볼까요?` adds visual noise | **Confirmed** | [page.tsx:1486](../frontend/src/app/page.tsx#L1486). It is a `<p id="mode-switch-label">`, not a heading, and exists to satisfy `aria-labelledby` on the `role="group"`. It is visible in all 7 baselines. In 데이터·출처 it renders *below* the `<h1>데이터·출처</h1>`, so the page reads "데이터·출처 / 무엇을 볼까요? / [nav]" — the question interrupts the title. **Its accessibility job is real and must be preserved** (see §7 `TopNavigation`). |
| G3 | Korean and English labels are repeatedly shown together | **Partially confirmed — heavily area-dependent** | Dense in `FacilityCostDashboard` (≥15 occurrences: `시나리오 설정 (Scenario)`, `시설 종류 (Facility type)`, `폐기물 종류 (Waste stream)`, `지역 처리 비율 (Processing share, %)`, `서비스 지역 (Service regions)`, `고급 설정 (Advanced settings)`, `핵심 지표 (Key indicators)`, `지역별 공식 투입 데이터 (Official input)`, `출처·방법 (Sources & method)`, `시민 검토 조건 (Deliberation)`, plus option labels like `생활계 폐기물 (Household)`) and in `LandfillDashboard` filters (`연도 (Year)`, `월/연간 (Month / annual)`, `출발 광역지자체 (Origin)`, `폐기물 종류 (Waste type)`, `전체 (all)`). Also `범례 (Legend)` in `MapLegendOverlay` and `파생 지표 (Derived indicator)` / `지표 출처 (Metric source)` in `page.tsx`. **Absent** from `TransparencyDashboard` headings and from all `glossary.ts` primary labels. So this is a component-level inconsistency, not a system-wide policy. |
| G4 | Warning colors and borders are overused | **Confirmed (measured)** | 60 `amber-*` utility occurrences across 8 non-test components: `page.tsx` 16, `FacilityCostDashboard` 15, `LandfillDashboard` 10, `SuitabilityScenarioLab` 7, `TransparencyDashboard` 5, `ShareExportBar` 3, `ReportPreview` 3, `RegionComparison` 1. In the cost view a single screen carries the page disclaimer, an 8-item exclusion list, a missing-components block, a subsidy-rate note, a per-capita caveat, and a result disclaimer — all amber. Three compounding factors: (a) **7 distinct amber shades** are in use (`amber-50/200/300/500/700/800/900`) for one semantic role — borders alone split between `amber-200` and `amber-300` with no rule; (b) amber serves five *different* jobs — genuine caveat, routine missing-value cell, form-validation state, an actual error (`TransparencyDashboard` styles a `role="alert"` as `text-amber-800`), and a map status category; (c) **two error palettes coexist** — `rose-*` (4 uses, `SuitabilityScenarioLab` only) vs `red-*` (12 uses, everywhere else). Effect: the mandatory legal/analytical caveats stop being read because everything is styled as a caveat. |
| G8 | *(new finding)* Color weighting is inverted relative to importance | **Confirmed** | The most analytically important caveats render in the **lowest-contrast** text on screen — `text-slate-400`: the ranking's "값이 없어 제외한 지역 …개(0으로 채우지 않음)" ([RegionRanking.tsx:168](../frontend/src/components/RegionRanking.tsx#L168)), the scenario disclaimers, and `보고서 이미지에는 지도가 포함되지 않습니다.` Meanwhile routine absent-value cells get the loudest treatment (`amber-700`/`amber-800`). A redesign that only *reduces* amber without *raising* these would make the problem worse. |
| G9 | *(new finding)* Three components have no card container at all | **Confirmed** | `RegionRanking`, `RegionComparison`, and `ShareExportBar` are bare `<section className="text-xs …">` with no border, background, radius, or padding — they inherit their box from the sidebar. They sit in the same column as `.wep-card`-styled surfaces, so the equity sidebar mixes carded and un-carded sections with no visual logic. |
| G5 | Card radius, shadow, spacing, typography inconsistent | **Confirmed (measured)** | Radii: `rounded` ×64, `rounded-sm` ×8, `rounded-md` ×4, `rounded-lg` ×4, `rounded-full` ×1 — while the token `--radius-card: 0.75rem` is used essentially nowhere. Shadows: only `.wep-card` (1 file) and `.map-legend` carry one; every other card is borderless-shadow flat. Typography: card titles vary between `text-sm font-semibold`, `text-xs font-semibold`, and `text-[11px] font-semibold` with no rule. Padding varies `p-2/p-3/p-4`. |
| G6 | Long exact decimals are hard to read | **Confirmed** | `formatQuantity` correctly preserves exact values (trims padded zeros only). Rendered results at 1440×900 include `120.75 억원`, `36.225 억원`, `84.525 억원`, `8.05 억원/년`, `42,262.5원`. With production data these are longer (`1,277.222078 억원`, `439,553.13원`, `279.479667 톤/일`). No display-rounding layer exists anywhere in the codebase. |
| G7 | Results and methodology have similar visual weight | **Confirmed** | In `FacilityCostKpiGrid` the hero (`표준공사비 기반 설치비 산정액`) differs from the other seven cards only by `emphasis` → `text-lg` vs `text-base` — a 2px difference — and it sits as the 4th cell of a 4-column row, visually indistinguishable. Meanwhile `FacilityCostEvidence` and `FacilityCostNotice` occupy far more area. |

### 지역 부담

| # | Claim | Verdict | Evidence & effect |
|---|---|---|---|
| E1 | 11 metrics in dense radio groups | **Confirmed** | [page.tsx:1190–1222](../frontend/src/app/page.tsx#L1190). 3 `<fieldset>`s, 11 radios, consuming ~400px of the 384px-wide sidebar before any result appears. Ranking, comparison, and share/export are pushed below the fold at 1440×900 (`regional-burden-1440x900.png`). |
| E2 | Selected metric not dominant enough | **Confirmed** | The only indicator is `selected-metric-summary` — `text-xs text-slate-600` on `bg-slate-50` — plus a native radio dot. At a glance the active metric is not identifiable. |
| E3 | Loading states rely on plain text | **Confirmed** | Page loading is a single `<p className="text-sm text-slate-600">공공자료를 불러오는 중…</p>`. No skeleton exists anywhere in the codebase. Given 10 parallel requests, the screen is a centered sentence for the whole cold-start. |
| E4 | Legend may occupy too much map space | **Partially confirmed** | `MapLegendOverlay` is `w-[min(86vw,288px)]` — at 1440px that is a fixed 288px, ~20% of map width, bottom-left, and `responsive.spec.ts` already asserts it stays in-bounds and clear of the OSM attribution. With a 7-class quantile scale plus a no-data row it grows to ~8 rows tall. Not a correctness problem; a density/priority one. It also duplicates language: `범례 (Legend) — persons`. |
| E5 | Selected-region experience must stay synced with map clicks | **Confirmed as already-correct — must not regress** | This is a *strength*, not a defect. `selectedRegionCode` stores the **code only**; `selectedRegion` is derived per active metric ([730](../frontend/src/app/page.tsx#L730)). Map click, region `<select>`, ranking row, and comparison all write the same state. Changing metric re-derives rather than dropping. Guarded by `page.selection.test.tsx` (5 tests). |

### 후보지 분석

| # | Claim | Verdict | Evidence & effect |
|---|---|---|---|
| C1 | Current location among score/weights/cost is unclear | **Confirmed** | The subview switch is styled identically to the top nav (G1), and in cost mode the top nav + subnav stack as two visually identical rows at the very top of a full-width page (`facility-cost-results-1440x900-full.png`). |
| C2 | Cost view puts setup, warnings, results, deliberation in one long vertical page (deliberation removed and setup rebuilt in Phase 2; results split follows in Phase 3) | **Confirmed** | `FacilityCostBody` renders all five blocks unconditionally in one column. Full-page height at 1440 wide is **2,060px** with the minimal test fixture — production data (multiple regions, more missing components) is longer. |
| C3 | Service-region selector is a native multi-select needing Ctrl/Cmd | **Confirmed** | [FacilityCostDashboard.tsx:547–576](../frontend/src/components/FacilityCostDashboard.tsx#L547). `<select multiple size={6}>`. Multi-selection requires Ctrl/Cmd+click (or Shift for ranges) with **no on-screen instruction**; the helper text only says `계산 가능한 지역만 표시됩니다. 지역을 선택하세요.` Accidental plain clicks silently *replace* the whole selection. There is no search, so finding one of ~70 regions means scrolling a 6-row box. |
| C4 | Internal region codes are unnecessarily prominent | **Confirmed** | Rendered twice: in every option — `{r.name} ({r.code})` → `종로구 (KR-SGIS-11110)` — and in the results table — `{region.region_name} <span>({region.region_code})</span>`. The code exists for a real reason (disambiguating 서울 중구 vs 인천 중구), so it must be *replaced by better disambiguation*, not simply deleted. |
| C5 | Important results sit below large warnings and configuration | **Confirmed** | Measured from the baseline: at 1440×900 the amber notice block occupies roughly the first 270px; the setup card runs to ~860px; the first KPI value appears at ~y=950 — i.e. **below the fold** even after a successful calculation. |

### 매립지 현황

| # | Claim | Verdict | Evidence & effect |
|---|---|---|---|
| L1 | A large warning block dominates | **Confirmed** | Full-bleed amber block directly under the title, before the filters (`landfill-dashboard-1440x900.png`). It is the single most visually prominent element on a page whose purpose is to show inbound quantities. |
| L2 | Filters, KPIs, explanations, tables create excessive density | **Partially confirmed** | Filters are a clean 4-across grid and are fine. The density claim applies to the results region (4 KPIs + 4-column table + 4 charts + an exact-value fallback table + source/derivation notes). **Could not be visually confirmed at 1440×900** — the deterministic fixture serves the genuine 404 NO_DATA, so the populated layout did not render (see §"Baseline gaps"). Verdict rests on code reading, not on a screenshot. |
| L3 | KPI explanations too prominent vs KPI values | **Partially confirmed** | Same limitation as L2 — asserted from code, not from a captured populated view. |
| L4 | *(new finding)* Raw backend error code shown to citizens | **Confirmed — concrete defect** | [page.tsx:425](../frontend/src/app/page.tsx#L425) uses `cause.message` directly, while the equity ([323](../frontend/src/app/page.tsx#L323)) and suitability ([355](../frontend/src/app/page.tsx#L355)) paths both use `plainError(...)`. Result, visible in the baseline: **`NO_DATA_AVAILABLE: No landfill inbound data has been ingested.`** — a raw enum plus an English sentence — is shown to a Korean citizen. `plainError` already has a `NO_DATA_AVAILABLE` entry (`현재 조건에 맞는 공식 자료가 없습니다.`) that is simply not being used here. |
| L5 | *(new finding)* Landfill filters are not shareable | **Confirmed** | `flowYear/Month/Origin/Waste` are absent from `AppUrlState`. A user cannot share "2023 · 서울 · 생활폐기물". |

### 데이터·출처

| # | Claim | Verdict | Evidence & effect |
|---|---|---|---|
| D1 | Large tables create high reading density | **Partially confirmed** | Two wide tables (사용한 공공자료 4-col; 자료별 기준 시점 4-col). Structure is clean and already `.wep-card`-wrapped. With the fixture, `data-sources` returns `[]` so the first table rendered header-only; density with the full production source registry is asserted from code, not observed. |
| D2 | Korean/English repeats within cells | **Not confirmed for this area** | No Korean/English duplication in `TransparencyDashboard` headings or cells in the captured baseline. Cells do carry raw **version identifiers** (`suitability-policy-v2`, `capital-grid-500m-v1`, `capex-standard-v2022dec`, `suitability-screening-v3`) — a real but *different* problem (technical strings, not bilingual duplication). |
| D3 | Status information has weak hierarchy | **Confirmed** | The `상태` column is a plain right-most table cell with no badge, icon, or color treatment; dataset health is the least prominent thing on a page whose job is disclosing dataset health. |
| D4 | Missing/incomplete datasets not summarized prominently | **Confirmed** | `아직 포함하지 못한 비용` is a small red-ish heading with a bullet list at the *bottom* of the page. There is no top-of-page "what's missing" summary, so a citizen must read the whole page to learn what the platform does not know. |

### Additional confirmed defects found during the audit

Not in the original problem list, but verified in code and worth fixing in the phase that touches the file.

| # | Defect | Location | Phase |
|---|---|---|---|
| X1 | **Facility popups accumulate.** Region and candidate popups are tracked in refs and `.remove()`d before a new one opens; the facility popup is not — every facility click leaves the previous popup on the map. | `MapView.tsx` ~795 | 4 |
| X2 | **The map error banner collides with the legend.** The error banner is `absolute inset-x-2 bottom-2`; `MapLegendOverlay` is `absolute bottom-8 left-2`. Both occupy the lower-left. | `MapView.tsx` ~990, `MapLegendOverlay.tsx:108` | 4 |
| X3 | **Raw status enum in citizen prose.** `SuitabilityScenarioLab` renders `상태 {detail.status}` → `상태 EXCLUDED`, while `MapView` runs the same value through `statusLabel()`. Also `제외 사유:`/`검토 사유:` join raw reason codes with `, `. | `SuitabilityScenarioLab.tsx` ~716, ~753, ~757 | 3 or 4 |
| X4 | **Desktop touch targets *shrink*.** `SuitabilityScenarioLab` buttons carry `min-h-[36px]`/`min-h-[38px]`/`min-h-[44px]` **plus `md:min-h-0`**, so on desktop the min-height is removed entirely and the control collapses to padding (~24–30px). This is backwards for a desktop-first redesign. | `SuitabilityScenarioLab.tsx` (preset/normalize/apply buttons) | 1 (sizing rule), applied in 4 |
| X5 | **Charts distort horizontally on desktop.** `MiniBars` uses `viewBox="0 0 240 64"` with `preserveAspectRatio="none"`, so bars stretch as the card widens. | `LandfillDashboard.tsx` ~603 | 5 |
| X6 | **`perCapitaUnavailableLabel` prints unmapped codes verbatim** — falls through to `` `계산 불가 (${reason})` ``. | `lib/landfill.ts:91–94`, rendered at `LandfillDashboard.tsx` ~428 and ~515 | 5 |
| X7 | **Report modal capped at `max-w-2xl` (672px)** for a document containing multi-column tables. | `ReportPreview.tsx:182` | 6 or 7 |
| X8 | **Amber disclaimer is the `switch` fallback branch** in `Blocks`, so an unrecognised block kind silently renders as a warning box. | `ReportPreview.tsx:98–107` | 7 |
| X9 | **`ShareExportBar` has no primary action** — all four buttons are `.wep-btn-quiet`, so 링크 복사 / CSV / 보고서 have identical weight. Its copy-state `setTimeout` is also not cleared on unmount. | `ShareExportBar.tsx` | 4 |

### Baseline gaps (screenshots that could not show a populated state)

Deterministic capture uses `e2e/mockBackend.ts`, which intentionally serves the backend's **genuine 404 `NO_DATA_AVAILABLE`** for the three landfill endpoints and empty collections for boundaries/population/data-sources, because fabricating official-looking values is exactly what this project forbids. Consequences, all documented rather than worked around:

- **매립지 현황** renders its unavailable state; the populated KPI/table/chart layout is **not** captured.
- **후보지 점수** renders counts and stability numbers, but `top_candidates: []` so the candidate lists are empty.
- **지역 부담** renders the full sidebar but a blank map (empty boundaries; `.mvt` and OSM raster tiles are aborted by the fixture).
- **데이터·출처** first table renders header-only (`data-sources: []`).

Capturing populated versions requires a live backend (`E2E_BACKEND_URL`), which was unavailable: the Docker daemon was not running (`Cannot connect to the Docker daemon`) and nothing was listening on `:8000`. Phase 0 did **not** start, create, or modify any container to obtain screenshots.

---

## 5. Non-negotiable data-integrity rules

These bind every later phase. Violating any of them fails the phase regardless of visual outcome.

1. **Official data is the only source of displayed analytical values.** There is no bundled or fallback dataset; if the backend is unreachable the UI shows an explicit state. A redesign may never introduce a placeholder, sample, or "example" value into a production surface.
2. **A missing value never becomes zero.** `null`/absent must render as its served availability text or an explicit unavailable label. Reference implementations to preserve: `formatRegionMetricDisplay`, `PerCapitaCard` (`계산 불가 (…)`), `FacilityCostRegionTable` (`공식 인구 미확정`), `perCapitaUnavailableLabel`.
3. **An official measured `0` stays distinct from `자료 없음`.** `classifyEquityRaw` returns `OFFICIAL_ZERO` vs `PARTIAL` vs `MEASURED_VALUE` vs `null`; rankings rank an official 0 and exclude an unavailable value.
4. **Display rounding never changes a calculation value.** Rounded output is presentation only; the exact backend string must remain reachable in a detail layer. Rounding must be applied to the *rendered string*, never fed back into any comparison, sort, share computation, CSV, or report.
5. **Standard construction cost is not actual total project cost.** `표준공사비 기반 설치비 산정액` must never be relabeled `총비용`, `총사업비`, or `확정 사업비`. Two e2e specs assert `총비용` has count 0.
6. **Estimated subsidy is not an approved subsidy.** `명목 국고보조 추정액` must keep `실제 승인된 국고보조금이 아닙니다` and its `rate_basis` in reach.
7. **Per-capita local share is not a personal tax bill.** `주민 1인당 환산 지방비` must keep `개인의 실제 세금 청구액이 아닙니다.`
8. **Candidate suitability is analytical screening, not legal approval.** `1차 분석 통과` never implies permit, eligibility, or siting. "Stable" is a sensitivity indicator, not approval.
9. **Source and reference-period provenance stays accessible.** Every displayed analytical metric keeps its source id/name and reference period; derived metrics keep *both* inputs. Provenance may move into a collapsible section — it may not be removed, and a collapsed `<details>` must not be the only home for a `role="status"` live region.
10. **API decimal strings are formatted, never reconstructed.** `formatQuantity` operates on the string via regex. `Number()` conversion is permitted **only** for chart proportions and color scaling — never to produce a displayed exact value.
11. **The three accounting bases are never merged.** `ORIGIN_BASED_TREATMENT_OUTCOME`, `FACILITY_LOCATION_BASED_THROUGHPUT`, and `VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW` stay segregated.
12. **Reason codes may be hidden from primary UI but never deleted from the system.** They must remain in API responses, detail disclosures, diagnostics, logs, CSV/report exports where already present, and tests.

---

## 6. Proposed desktop information architecture

### Top navigation (persistent, full-width, identical position in every area)

```
┌──────────────────────────────────────────────────────────────────────┐
│  우리 동네 폐기물 지도                                                │
│  지역 부담   후보지 분석   매립지 현황   데이터·출처                  │
│  ─────────                                                            │
└──────────────────────────────────────────────────────────────────────┘
```

- Selected tab: strong text (`font-semibold text-ink`) **plus a 2px bottom indicator** in `--color-primary`. Unselected: `text-ink-muted`, no fill.
- **The nav moves out of the sidebar** into a persistent full-width header rendered once, above all six render branches. This is the single highest-leverage change: it fixes G1 and the sidebar nav-wrapping defect at once.

### Candidate-analysis segmented control

```
┌ 후보지 분석 ────────────────────────────────────────────────────────┐
│  ( 후보지 점수 │ 가중치 바꿔보기 │ 비용 살펴보기 )                    │
└──────────────────────────────────────────────────────────────────────┘
```

- A **segmented pill control**: one rounded-full track (`bg-surface-sunken`), the active segment a raised white pill with `--shadow-card`. Visually a *child* of the top nav, never a peer.
- Rendered only inside 후보지 분석, indented/below the top nav, so hierarchy is positional as well as stylistic.

### Documented decisions

- **`무엇을 볼까요?` will be removed** as visible text. Its accessibility contract is preserved by moving the group label into a visually-hidden element (`class="sr-only"`) still referenced by `aria-labelledby="mode-switch-label"`, or by replacing `role="group"` + `aria-labelledby` with a `<nav aria-label="주요 화면">`. **Either way `mode-switch` must keep `role="group"`+`aria-labelledby` or the swap must be made together with the matching test update** — `accessibility.test.tsx` asserts both attributes today.
- **English duplication removed from primary labels.** `시나리오 설정 (Scenario)` → `시나리오 설정`; `핵심 지표 (Key indicators)` → `핵심 지표`; `연도 (Year)` → `연도`; `범례 (Legend)` → `범례`. Option labels likewise (`생활계 폐기물 (Household)` → `생활계 폐기물`).
- **English may remain** in: `<details>` detail layers, methodology/glossary text, diagnostic lines, tooltips, CSV/report exports, and `data-testid`s. `glossary.ts` already models this as `primary` vs `detail` — reuse it rather than inventing a parallel convention.
- **Top-level labels are frozen strings.** `terminology.audit.test.tsx` asserts `textContent` **exactly equals** `MODE_LABELS.*` and `SUBVIEW_LABELS.*` (`.toBe`, not `.toContain`). Adding an icon, a count badge, or any character inside those buttons breaks the audit. Put indicators *outside* the label element or update the audit deliberately.

---

## 7. Shared desktop design system proposal

New directory: **`frontend/src/components/ui/`**. No third-party UI library. Every component is native HTML + Tailwind v4 + the **existing** `globals.css` tokens.

| Component | Responsibility | Reused in | Accessibility requirements | Equivalent today? | Wrap / replace / reuse |
|---|---|---|---|---|---|
| `TopNavigation` | Persistent 4-area nav + product title; active tab strong + bottom indicator | All 6 render branches | Native `<button>`s with `aria-pressed`; `role="group"` + `aria-labelledby` (label `sr-only`); **`textContent` must equal `MODE_LABELS[k]` exactly**; keep `data-testid="mode-switch"`, `mode-equity/-suitability/-flow/-transparency` | `ModeSwitch` ([1473](../frontend/src/app/page.tsx#L1473)) | **Replace** `ModeSwitch`, hoist call site above all early returns |
| `SegmentedControl` | Generic 2–4 option pill switcher | Candidate subnav; later landfill 월/연간 | Native `<button aria-pressed>`; not `radiogroup` (no roving focus implemented); keep `suitability-view-*` testids and exact `SUBVIEW_LABELS` text | `SuitabilityViewSwitch` ([1538](../frontend/src/app/page.tsx#L1538)) | **Replace** `SuitabilityViewSwitch`; generalise props |
| `InfoBanner` | One banner primitive with `tone: "info" \| "warning" \| "danger"`; collapses today's ad-hoc amber panels into a rationed set | Cost notice, landfill notice, coverage notes, scenario warning, URL warnings | Text conveys severity (never color alone); `role="alert"` **only** for genuine errors, not standing disclaimers | None — 60 hand-rolled `amber-*` panels | **New**; migrate call sites incrementally |
| `Accordion` | Titled collapsible built on native `<details>`/`<summary>` | All 6 collapsible result sections in the cost results; provenance panels | Native disclosure (no JS focus management); **must not** wrap any `role="status"` live region that needs announcing while collapsed | `CollapsibleSection` ([1584](../frontend/src/app/page.tsx#L1584)) — but it is *forced open at md+* by `.mobile-collapsible` CSS | **New, separate class.** Do **not** reuse `.mobile-collapsible`: desktop must now genuinely collapse, which is the opposite of that class's contract. Reuse the `::details-content` + legacy dual-override technique. |
| `KpiCard` | One metric: label, value, optional caption, `size: "hero" \| "default"` | Cost KPIs, landfill KPIs, equity summary | `<dt>`/`<dd>` inside a `<dl>`; `tabular-nums`; unavailable state renders reason text, never `0` | `KpiCard` + `PerCapitaCard` ([709](../frontend/src/components/FacilityCostDashboard.tsx#L709), [742](../frontend/src/components/FacilityCostDashboard.tsx#L742)) | **Promote + extend** — lift to `ui/`, add `hero`, keep `fc-*` testids |
| `Chip` | Removable selection token | Region picker, comparison | Remove button has an accessible name incl. the region name (not a bare ✕) | `.wep-chip` CSS class, used in `RegionComparison` only | **Wrap** the existing class in a component |
| `SearchableRegionPicker` | Search → results → selected chips → bulk 서울/인천/경기 → clear | Cost service regions; later comparison | ARIA combobox: `role="combobox"`, `aria-expanded`, `aria-controls`, `role="listbox"`/`option`, `aria-activedescendant`, ↑↓/Enter/Escape; announce selection count via `role="status"` | `RegionComparison`'s combobox is the closest working pattern | **New, modeled on `RegionComparison`.** Replaces the `<select multiple>` |
| `Skeleton` | Neutral shimmer placeholder | Initial load, cost calculating, landfill filter refetch | Decorative (`aria-hidden`); the **live region announcing load state stays separate** and must keep `role="status"` | None | **New** |
| `EmptyState` | Icon-free title + explanation + optional action | No calculable regions, empty ranking, no candidates, no landfill data | Plain text; never implies zero data means zero value | Ad-hoc `<p>`s | **New** |

**Rule for all of them:** consume `var(--color-*)` / `var(--radius-*)` / `var(--shadow-*)` from `globals.css`. Do not introduce new raw `slate-*`/`amber-*` combinations. The analytical map/legend palette stays in `lib/metrics.ts` and is deliberately **not** tokenised.

---

## 8. Desktop layout specifications (1440×900 primary, 1280×800 verified)

Values chosen to match what the codebase already does where it is consistent, and to pick one option where it is not.

| Property | Specification | Rationale |
|---|---|---|
| Max content width | `max-w-screen-2xl` (1536px) — **keep** | Already used by all three full-width branches; at 1440 the page is edge-to-edge minus padding |
| Main horizontal padding | `px-4 sm:px-6 lg:px-8` — **keep** | Already the established pattern |
| Page top/bottom | `pt-6 pb-12` | Matches the cost dashboard; standardise across areas |
| Vertical section spacing | `gap-5` (1.25rem) between major sections; `gap-3` within a section | `FacilityCostBody` already uses `gap-5`; make it the rule |
| Card padding | **`p-4`** (1rem) standard; `p-5` for a hero card | `.wep-card` is already `padding: 1rem`; eliminates today's p-2/p-3/p-4 mix |
| Card radius | **`--radius-card` (0.75rem)** for cards; `--radius-control` (0.5rem) for inputs/buttons; `--radius-pill` for chips/segments | Replaces the 64× `rounded` (0.25rem) default. Tokens already exist |
| Card border / shadow | `1px solid var(--color-hairline)` + `var(--shadow-card)` | Exactly `.wep-card`; adopt everywhere |
| Grid gaps | `gap-3` inside card grids; `gap-4` between cards | Matches current KPI grid |
| KPI grid | Hero full-width row; then `lg:grid-cols-3` for secondary | Today's flat `lg:grid-cols-4` is what flattens the hierarchy (G7) |
| Header hierarchy | `h1` `text-2xl font-bold text-ink` (exactly one per view) · `h2` `text-base font-semibold` · `h3` `text-sm font-semibold` · body `text-sm` · caption `text-xs text-ink-subtle` | Today `h2`s are `text-sm` and captions `text-[11px]` — arbitrary values with no scale |
| KPI number hierarchy | Hero `text-3xl font-bold tabular-nums` · secondary `text-xl font-semibold tabular-nums` · tertiary `text-base` | Today hero vs secondary is `text-lg` vs `text-base` — visually indistinguishable |
| Neutral backgrounds | Page `--color-surface-sunken` (slate-100) · cards `--color-surface` (white) · nested/inert `--color-surface-muted` (slate-50) | Already the de-facto pattern; name it |
| Accent | Exactly one — `--color-primary` (#1d4ed8) for the primary CTA, active nav indicator, active segment, focus ring | Today: slate-800 buttons, sky-600 bars, sky-100 selection rings, blue-700 tokens — four accents |
| Warning rationing | **At most one** `tone="warning"` banner per screen. Secondary caveats become caption text under the value they qualify | Directly addresses G4 |
| Sticky regions | Top navigation `sticky top-0 z-20` with a hairline bottom border. **Nothing else sticky.** In the cost results view the setup summary bar may be sticky *only* if it does not exceed 56px | Keeps 900px of height usable |
| Focus | Keep `:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px }` | Already global and correct |
| Motion | Transitions ≤150ms on color/opacity/transform only; no layout animation | Matches existing `.mobile-collapsible-chevron` |

**Explicitly unchanged:** `.map-pane` sizing, the `vh`-before-`dvh` fallback ordering, the `@supports` overrides, `md:w-96` sidebar width, the single `md` breakpoint, and `color-scheme: light`. These are documented regression fixes (`frontend/RESPONSIVE_LAYOUT.md`) and are not design decisions to revisit.

---

## 9. Phased implementation plan

### Phase 1 — Global navigation and shared UI foundation
**Branch:** `ui/phase-1-global-foundation`

- **Objective:** One persistent top navigation, a segmented subnav, and the `ui/` primitives everything else will build on. No area's content is redesigned.
- **Files likely to change:** `app/page.tsx` (extract + hoist nav; remove `ModeSwitch`/`SuitabilityViewSwitch`), `app/globals.css` (add `.wep-segment`, `.wep-nav-tab`, an `Accordion` class distinct from `.mobile-collapsible`), `app/accessibility.test.tsx`, `app/terminology.audit.test.tsx`, `app/responsive.test.tsx`.
- **New components:** `ui/TopNavigation.tsx`, `ui/SegmentedControl.tsx`, `ui/InfoBanner.tsx`, `ui/Accordion.tsx`, `ui/KpiCard.tsx`, `ui/Chip.tsx`, `ui/Skeleton.tsx`, `ui/EmptyState.tsx` (+ colocated tests).
- **Non-goals:** no change to cost/landfill/transparency/equity *content*; no number-rounding; no region-picker replacement; no `CitizenConditions` removal *(both landed in Phase 2)*.
- **Acceptance criteria:**
  1. Top nav renders in the same DOM position and at the same size in all four areas; it does **not** wrap at 1280 or 1440.
  2. `무엇을 볼까요?` is not visible; `mode-switch` still exposes `role="group"` + `aria-labelledby`, and the label text is still in the a11y tree.
  3. Active top tab has `aria-pressed="true"`, `font-semibold`, and a bottom indicator; active segment is a raised pill.
  4. `getByTestId("mode-equity").textContent === MODE_LABELS.equity` (and the other three) still holds exactly.
  5. `suitability-view-*` testids and exact `SUBVIEW_LABELS` text unchanged.
  6. Exactly one `<h1>` per view; exactly one `MapView` instance.
  7. All eight `ui/` primitives exist with tests and consume only `globals.css` tokens.
- **Automated tests:** all 26 Vitest files green; new `ui/*.test.tsx`; `e2e/responsive.spec.ts`, `e2e/accessibility.spec.ts`, `e2e/integration.spec.ts`, `e2e/citizenFlows.spec.ts` green.
- **Manual desktop checks:** at 1440×900 and 1280×800, tab through all four areas — nav position stable, no wrap, no horizontal scrollbar, keyboard focus ring visible on every tab and segment.
- **Dependencies:** none.
- **Regression risks:** (a) `terminology.audit.test.tsx` uses exact `.toBe()` on button `textContent` — any icon/badge inside breaks it; (b) `terminology.audit.test.tsx` queries `document.querySelector("aside")` — the equity sidebar must remain an `<aside>`; (c) `responsive.test.tsx` asserts literal Tailwind class strings incl. `.map-pane` and the `min-h-screen min-h-dvh` ordering; (d) hoisting the nav above the early returns changes heading order in 매립지 현황 — the mode label must stay a non-heading; (e) **`MapView` popup footers hardcode a directional reference to the sidebar** — [MapView.tsx:458–459](../frontend/src/components/MapView.tsx#L458) end with `자세히는 왼쪽 상세` / `자세히는 왼쪽 목록`. If Phase 1 (or any later phase) moves the detail panel away from the left, these strings become wrong. They are raw `setHTML` strings, so no test catches it — check them manually whenever the shell layout changes.

### Phase 2 — Facility-cost setup workflow
**Branch:** `ui/phase-2-cost-setup`

- **Objective:** Turn setup into a focused single-purpose screen: searchable region picker, rationed warnings, one primary action.
- **Files likely to change:** `components/FacilityCostDashboard.tsx` (`FacilityCostFilters`, `FacilityCostNotice`), `components/FacilityCostDashboard.test.tsx`, `e2e/facilityCost.spec.ts`.
- **New components:** `ui/SearchableRegionPicker.tsx`.
- **Non-goals:** results layout untouched; no display rounding.
- **Scope change made during Phase 2:** `CitizenConditions` was removed here rather than in Phase 7 (§9.1 scope, executed early), and the `<h1>` was renamed 우리 지역에 시설이 생긴다면 → **시설 비용 살펴보기** so the heading matches the 비용 살펴보기 tab that leads to it. Both are documented in `docs/FACILITY_COST_LENS_UI.md`.
- **Acceptance criteria:**
  1. `<select multiple>` is gone; region selection works with **plain clicks only** — no Ctrl/Cmd anywhere in the flow.
  2. Search filters by Korean name; results are keyboard-navigable (↑↓/Enter/Escape) and expose a correct ARIA combobox.
  3. Selected regions render as removable chips; each remove control has an accessible name including the region name.
  4. 서울 / 인천 / 경기 bulk-select and 전체 해제 exist and operate on the *currently calculable* set only.
  5. **No raw region code is visible in the default UI**; 서울 중구 and 인천 중구 are still unambiguously distinguishable (e.g. `중구 · 서울`). Codes remain in the DOM `value`, in exports, and in a detail layer.
  6. At most one `tone="warning"` banner on the setup screen; the remaining exclusions live in a collapsed accordion whose summary states how many items it holds. *(Delivered as **zero** warning banners: the standing notice is `tone="info"`, since it is a caveat rather than something gone wrong. `tone="error"`/`role="alert"` remains reserved for a genuine options or calculation failure.)*
  7. The `resultCurrent` staleness gate and `requestSeq` supersede logic are unchanged.
  8. Calculate stays disabled with no region selected or with an invalid numeric input, and the validation message keeps `role="alert"`. *(Kept. Ordinary "not ready yet" guidance — no region chosen, options unavailable, request in flight — goes to a separate polite `role="status"` beside the button, which also mirrors the alert so a collapsed accordion is never the only home for an active validation error.)*
  9. **Sticky deviation from §8.** §8 says "nothing else sticky" and caps a cost summary bar at 56px. Phase 2 instead makes the right-hand setup summary column sticky (`lg:sticky lg:top-6 lg:self-start`), which is taller. That cap was written for a horizontal bar in the results view; this is a two-column rail, and it is safe here because the cost branch is map-free — unlike the shell header it removes nothing from a height chain `.map-pane` depends on. It is still the only sticky element besides the top navigation.
- **Automated tests:** `FacilityCostDashboard.test.tsx` extended (search, chips, bulk-select, clear, no visible code, disambiguation); `e2e/facilityCost.spec.ts` updated to drive the new picker; `e2e/citizenFlows.spec.ts` Task D green.
- **Manual desktop checks:** 1440×900 — select 3 regions across two metros using only the mouse, then only the keyboard; confirm no horizontal overflow and that the setup screen fits within one viewport height.
- **Dependencies:** Phase 1 (`Chip`, `InfoBanner`, `Accordion`).
- **Regression risks:** `facilityCost.spec.ts` and `FacilityCostDashboard.test.tsx` currently call `selectOption` on `facility-cost-regions`; both must be migrated in the same commit. Losing the stream-change reset (`update("wasteStream")` clears `regionCodes`) would allow an uncalculable region to persist.

### Phase 3 — Facility-cost results workflow ✅ delivered
**Branch:** `ui/phase-3-cost-results`

- **Objective:** Answer first. Hero result, three secondary KPIs, everything else collapsed. Hide reason codes; add display rounding.
- **Files likely to change:** `components/FacilityCostDashboard.tsx` (`FacilityCostBody`, `FacilityCostResults`, `FacilityCostKpiGrid`, `FacilityCostMissingComponents`, `FacilityCostEvidence`), `lib/glossary.ts` (reason-code → plain-Korean map; extend `FORBIDDEN_PRIMARY_TOKENS`), **new** `lib/displayNumber.ts`, tests for all of the above.
- **New components:** none beyond Phase 1 primitives; new pure module `lib/displayNumber.ts`.
- **Non-goals:** no backend/API change; no change to which values are calculated.
- **Acceptance criteria:**
  1. Setup → loading → results are three distinct states. A calculation in flight shows a `Skeleton` results region plus a `role="status"` announcement.
  2. Results order is exactly: **hero → 3 secondary KPIs → 재원 구성 → 지역별 공식 투입 → 선택한 후보지 → 계산 가정 → 미포함 비용 항목 → 출처·방법**, with everything after the KPIs in collapsed `Accordion`s.
  3. Hero uses `text-3xl` and is the largest number on screen; secondary KPIs `text-xl`.
  4. Display rounding: `1,277.222078 억원` → `약 1,277억원`; `439,553.13원` → `약 44만원`; `279.479667 톤/일` → `약 280톤/일`. The **exact** string is present in the corresponding detail disclosure and unchanged in CSV/report output.
  5. `lib/displayNumber.ts` is pure and unit-tested, including: never rounds a value used for a comparison/sort; renders `null` as unavailable text, never `약 0`.
  6. **No raw reason code appears in the default results UI** — `OFFICIAL_SOURCE_NOT_INTEGRATED`, `ACTUAL_ROUTE_AND_CONTRACT_RATE_UNAVAILABLE`, `PARCEL_SPECIFIC_COST_UNAVAILABLE`, `FACILITY_MASS_BALANCE_NOT_ESTABLISHED` each map to a plain-Korean explanation. Raw codes remain in a detail disclosure, in the API response, and in tests.
     - **The plain-Korean mapping already exists** — hardcoded at [TransparencyDashboard.tsx:288–291](../frontend/src/components/TransparencyDashboard.tsx#L288): `운영비 (공식 자료 미연계)`, `실제 운반비 (실 경로·계약 단가 미확보)`, `토지·보상비 (필지별 비용 미확보)`, `매립지 잔여 비용 (시설 물질수지 미확립)`. Phase 3 should lift these into `glossary.ts` as a shared `MISSING_COMPONENT_REASONS` registry and consume it in **both** places, rather than writing a second translation.
     - Two render sites leak codes today, both by pass-through: `{m.reason}` in `FacilityCostMissingComponents` ([456](../frontend/src/components/FacilityCostDashboard.tsx#L456)) and `계산 불가 ({pc.unavailable_reason})` in `PerCapitaCard` ([754](../frontend/src/components/FacilityCostDashboard.tsx#L754)).
  7. These four codes are added to `FORBIDDEN_PRIMARY_TOKENS`, and the terminology audit is extended to scan the cost results surface (it currently scans only the equity `<aside>`).
     - ⚠️ **`FacilityCostDashboard.test.tsx:521–522` currently asserts the opposite** — `expect(text).toContain("OFFICIAL_SOURCE_NOT_INTEGRATED")` under the comment *"The backend reason codes are retained, never discarded."* That assertion encodes a real rule (codes must not be *discarded*) and must be **rewritten, not deleted**: assert the plain-Korean label is in the primary surface **and** the raw code is still reachable in the detail disclosure. Deleting it would drop the guarantee that reason codes survive.
  8. Unchanged: `총비용` count 0; per-capita `null` → served reason, never `0원`; missing components never rendered as a zero cost line; funding bar proportions still the only `Number()` use.
- **Automated tests:** `lib/displayNumber.test.ts` (new); `FacilityCostDashboard.test.tsx` extended (order, hero size, rounding + exact-value reachability, no visible codes); terminology audit extended; `e2e/facilityCost.spec.ts` updated for the new value strings.
- **Manual desktop checks:** 1440×900 — after calculating, the hero result is visible **without scrolling**; expanding every accordion causes no horizontal overflow.
- **Dependencies:** Phases 1–2.
- **Regression risks:** `facilityCost.spec.ts` asserts literal `"120.75 억원"` and `"42,262.5원"` — these change under display rounding and must be updated deliberately, keeping an assertion that the exact value is still reachable. Wrapping the results region in accordions must not remove the `role="status"` on `facility-cost-results`.

**Delivery notes.**

- **AC1 delivered as setup / calculating / results.** The in-flight state stays on the
  SETUP view (a `Skeleton` plus a separate polite `facility-cost-calculating-status`
  region) rather than rendering a skeleton results screen. Navigating on submit would
  have meant showing a results view that holds no result, and the brief for this phase
  required the citizen to remain on setup while calculating.
- **AC2 delivered with one addition.** The order is exactly as specified, followed by a
  seventh accordion, **정밀값과 계산 기준**, which is where the exact backend strings live
  now that the primary cards are approximations. 선택한 후보지 정보 is omitted entirely
  (not rendered empty) when no candidate was carried in.
- **AC4/AC5 delivered, with the 톤/일 rule made explicit (open question O1).** 억원 and
  원→만원 round to a grouped integer as recommended. 톤/일 could not: `279.479667` rounds
  to `279` at integer precision, and the required example is `약 280톤/일`. The shipped
  rule is **1톤/일 단위 below 100, 10톤/일 단위 at and above 100**, which satisfies both
  that example and the existing `35.000000` → `35톤/일` fixture. Full precision table in
  [FACILITY_COST_LENS_UI.md](FACILITY_COST_LENS_UI.md).
- **`displayNumber.ts` uses no floating point at all.** Rounding is string/BigInt, so it
  is correct beyond `Number.MAX_SAFE_INTEGER` and cannot be repurposed to reconstruct an
  exact value. A unit test scans the source for `Number(`, `parseFloat`, `parseInt`,
  `toFixed`, and `Math.`. Sub-unit values render "1억원 미만" rather than "약 0억원", since
  displaying a real cost as `0` is the same failure as zero-filling a missing value.
- **AC6 registry lifted, transparency call site deferred to Phase 6.** `glossary.ts` now
  owns `MISSING_COMPONENT_META` (including the exact short parentheticals the
  transparency centre renders, asserted by `glossary.test.ts`),
  `MISSING_REASON_EXPLANATIONS`, and `PER_CAPITA_UNAVAILABLE_EXPLANATIONS`.
  `TransparencyDashboard.tsx` was **not** modified: its wording is Phase 6's surface and
  Phase 6 AC5 requires it verbatim, so Phase 3 establishes the shared registry and locks
  the strings with a test instead of editing another phase's component.
- **AC7 delivered, audit placed in the cost test.** Eleven codes were added to
  `FORBIDDEN_PRIMARY_TOKENS` (the four missing-component reasons, the four component
  codes, and the three per-capita reasons). The surface scan lives in
  `FacilityCostDashboard.test.tsx`, not `terminology.audit.test.tsx`, because the
  latter's `homeApiMock` rejects `fetchFacilityCostCalculate` — no result can be
  rendered there. It clones the results view, removes every `[data-diagnostic]`
  subtree, and asserts the remaining text contains no forbidden token.
- **Two pre-existing leaks fixed in passing.** The candidate context rendered the raw
  `ELIGIBLE` enum and the `capital-grid-500m-v1:…` / `suitability-policy-v1` identifiers
  as primary text, and the methodology line rendered the raw `accounting_basis` enum.
  These are all already in `FORBIDDEN_PRIMARY_TOKENS`, so the AC7 scan could not pass
  while they remained. They now use `statusLabel` / `profileLabel` /
  `accountingBasisLabel`, with every raw identifier kept in the diagnostic disclosure
  (`fc-candidate-provenance` still carries the reference year and all three versions).
- **AC7's ⚠️ honoured.** The "codes are retained, never discarded" assertion was
  rewritten, not deleted: the plain Korean is asserted on the primary surface AND every
  raw code is asserted present in `facility-cost-missing-diagnostic`.
- **Region codes removed from the results table too.** The region table showed
  "종로구 (KR-SGIS-11110)"; it now shows the metro-prefixed display name and keeps the
  codes in a diagnostic disclosure, matching the Phase 2 setup rule.
- **Exclusions count is 5, not the served `missing_components` length.** The accordion
  merges the four backend components with the standing 후보지별 토목조건 exclusion, so an
  item the endpoint does not enumerate is still disclosed. A component the backend adds
  later that the registry does not know is appended with the safe generic explanation
  rather than swallowed (asserted).
- **Not done in this phase:** results are still absent from URL state, and no CSV/report
  export was touched — display rounding is presentation-only and never reaches them.

### Phase 4 — Regional burden map desktop improvements ✅ delivered
**Branch:** `ui/phase-4-equity-map`

- **Objective:** Make the active metric obvious, shorten the control column, give the map more room.
- **Files likely to change:** `app/page.tsx` (metric section, `RegionSummary`, collapsibles), `components/MapLegendOverlay.tsx`, `components/RegionRanking.tsx`, `components/RegionComparison.tsx`, `app/accessibility.test.tsx`, `app/page.equity.test.tsx`, `app/responsive.test.tsx`.
- **New components:** none beyond Phase 1.
- **Non-goals:** no change to metric definitions, scales, palettes, breaks, or geography routing; `lib/metrics.ts` untouched.
- **Acceptance criteria:**
  1. Selected metric is visually dominant in the control column (name at `text-base font-semibold` + unit), not a `text-xs` strip.
  2. Metric selection still uses **exactly 3 `<fieldset>`s and exactly 11 `input[type=radio][name="metric"]`** in one logical group. *(Hard constraint from `accessibility.test.tsx` — a redesign to a dropdown or accordion of metrics would break it and is out of scope for this phase.)*
  3. Initial load shows a `Skeleton` for the control column and the map region; the `role="status"` loading announcement is retained.
  4. Legend loses English duplication (`범례`), keeps every class row, the class numbers, the unit, the method note, and the explicit no-data row; still floats within map bounds clear of the OSM attribution.
  5. Ranking / comparison / share adopt `wep-card` spacing and the standard header scale; behavior unchanged.
  6. Map click ↔ region `<select>` ↔ ranking ↔ comparison remain one canonical `selectedRegionCode`; changing metric re-derives, never fabricates.
  7. `region-select` remains a native `<select>` (`tagName === "SELECT"`).
- **Automated tests:** `accessibility.test.tsx`, `page.equity.test.tsx`, `page.selection.test.tsx`, `MapLegendOverlay.test.tsx`, `metrics.test.ts` all green; `e2e/responsive.spec.ts` legend-geometry assertions green.
- **Manual desktop checks:** 1440×900 and 1280×800 — switch metrics across native↔reporting geography; confirm the selection survives or clears correctly and the map fills to the viewport bottom with no strip below.
- **Dependencies:** Phase 1.
- **Regression risks:** the 3-fieldset/11-radio and `<select>` tagName assertions; `responsive.spec.ts` legend bounding-box math; `.map-pane` must not be replaced with utilities.

**Delivery notes.**

- **AC1 — met.** The active metric is now its own `.wep-card` at the top of the control
  column: `선택한 지표` eyebrow, the plain-Korean metric name at `text-base font-semibold`,
  the unit as muted `text-xs`, and the metric source + reference period as a caption
  under a hairline rule. `role="status"` and `data-testid="selected-metric-summary"` are
  unchanged, and the live region wraps **only** the name + unit so the announcement stays
  one short phrase — the provenance caption sits deliberately outside it, since it would
  otherwise be re-read on every metric change.
  - *Deviation:* AC1 also asks for "a concise plain-Korean description when already
    available". No such per-metric description exists in the data model — the only
    available prose is `MetricDefinition.caveat`, which is long and is already rendered
    in the 출처와 계산 방법 disclosure. Duplicating it into the summary card would have
    worked against the density goal, so it was left where it is. Adding real one-line
    metric descriptions is a `lib/metrics.ts` change and therefore out of this phase.
- **AC2 — met, structure untouched.** Still exactly 3 `<fieldset>`s, 3 `<legend>`s, and 11
  `input[type=radio][name="metric"]` sharing one name. Density came from presentation
  only: one `.wep-card` per family instead of a nested bordered box, `gap-0.5` rows, and a
  selected row emphasised by border + background + font weight **in addition to** the
  native radio. `lib/metrics.ts` is byte-for-byte unchanged.
  - *Deviation from the O2 recommendation:* the two non-active groups are **not**
    collapsed. All 11 options stay visible and reachable on desktop — collapsing them
    would have hidden metric families behind a closed disclosure, and the density target
    was met without it. O2 is closed on that basis: keep the 11 radios, keep them visible.
- **AC3 — met.** The cold start renders a structural skeleton of the control column (header,
  metric summary, three group cards, a selection card) beside a skeleton map surface, built
  from the shared `components/ui/Skeleton.tsx`. The skeletons are `aria-hidden`; the single
  `role="status"` `data-testid="loading"` announcement is retained and is not inside an
  aria-hidden subtree. The skeleton renders neutral bars only — no digits, region names,
  ranking rows, or legend classes that could be mistaken for official data.
- **AC4 — met.** `범례 (Legend)` → `범례` in both the `<summary>` and the equity `<h2>`; the
  unit still rides on the heading (`범례 — persons`). Every class row, row order, class
  number, numeric range, unit, method note, and the explicit no-data row and **wording**
  (`데이터 없음 (no served value)`) are preserved — that parenthetical is analytical no-data
  wording, not an English duplicate of a primary label, and is deliberately kept. Placement,
  collapse behaviour, and the attribution clearance are unchanged.
- **AC5 — met.** `RegionRanking`, `RegionComparison`, and `ShareExportBar` adopt `.wep-card`
  + `p-4` + the standard `h2`/`h3` scale, `min-h-[32px]` controls, and the semantic tokens.
  Per Phase 0 defect X9, `링크 복사` is now the single `.wep-btn-primary` in the share card;
  the other three stay `.wep-btn-quiet`. No algorithm, ordering, tie behaviour, comparison
  maximum, CSV column, or report field changed.
- **AC6 / AC7 — met and re-asserted.** `selectedRegionCode` remains the one selection state;
  new e2e coverage drives ranking → panel → `<select>` and back. `region-select` is still a
  native `<select>`; the Phase 2 `SearchableRegionPicker` was **not** substituted.
- **Selected-region card moved above the metric list (not in the ACs).** The 1440×900 review
  capture showed the flow defect the phase objective names: clicking a region on the map
  landed on a panel *below the fold*, so the reader had to scroll to see what they had just
  clicked. The column now reads 선택한 지표 → 선택한 지역 → 지역 지표 선택 → 순위 → 비교 →
  공유: the two "answer" cards first, the controls after. Only the JSX order changed — the
  state, the test IDs, the native `<select>`, and the props are identical. Verified in the
  re-captured 1440×900 review set: region name, metric label, and the value with its unit are
  all above the fold, with provenance beneath.
- **Sidebar surface change (not in the ACs).** The control column moved to
  `--color-surface-sunken` so each section reads as a `.wep-card`, per the §8 "page = sunken,
  cards = surface" rule. `w-full`, `md:w-96`, and `md:flex-none` are unchanged, so the
  responsive contract and the `.map-pane` height chain are untouched. `CollapsibleSection`
  became a `.wep-card` for the same reason — it kept its `.mobile-collapsible` class, so the
  desktop force-open CSS still applies.
- **Pre-existing e2e fixture gap found and worked around.** `e2e/mockBackend.ts` serves the
  derived endpoints (`equity/waste-per-capita`, `waste-reporting/per-capita`,
  `equity/facility-burden`) as a bare empty envelope missing `indicator`,
  `derivation_version`, `derivation_formula`, and `assumptions`, which the real backend always
  returns. No previous spec selected a per-capita or facility-burden metric, so the gap was
  never exercised; doing so crashes the derivation panel on `assumptions.map`. Phase 4 supplies
  contract-complete (still genuinely empty) envelopes in `e2e/phase4Fixtures.ts` rather than
  editing the shared mock, so no other spec's behaviour changes. **The shared mock is still
  wrong and should be fixed in a later phase.**
- **Known defects deliberately NOT fixed here.** Phase 0 tagged X1 (facility popups accumulate)
  and X2 (the map error banner at `inset-x-2 bottom-2` collides with the legend at
  `bottom-8 left-2`) as Phase 4 items. Both live in `components/MapView.tsx`, which this phase
  did not otherwise touch; fixing them means changing map behaviour rather than the control
  column, so they are carried forward. The `ShareExportBar` copy-state `setTimeout` is likewise
  still not cleared on unmount.
- **Not done in this phase:** no metric definition, unit, palette, break, scale type, class
  count, no-data color, geography, scope routing, URL-state field, encoding, or restoration
  behaviour changed; no backend, API, cost, landfill, transparency, or suitability change.

### Phase 5 — Landfill dashboard desktop improvements
**Branch:** `ui/phase-5-landfill-dashboard`

- **Objective:** Values first, caveats rationed, and fix the raw-error-code defect.
- **Files likely to change:** `components/LandfillDashboard.tsx`, `app/page.tsx` (flow error path, line ~425; optionally add flow filters to URL state), `lib/urlState.ts` + `lib/urlState.test.ts` (if filters are added), `components/LandfillDashboard.test.tsx`, `e2e/landfill.spec.ts`.
- **New components:** none beyond Phase 1.
- **Non-goals:** no change to request scoping per endpoint, to denominator selection, or to any served value.
- **Acceptance criteria:**
  1. The metropolitan-only limitation becomes a **single** `tone="info"` banner, visually subordinate to the KPI row; its full text is preserved verbatim.
  2. KPI values are `text-xl`+; their explanations become `text-xs` captions beneath — explanation never larger than the value.
  3. Charts and the exact-value fallback table move into collapsed accordions; the fallback keeps **full lossless precision** (never chart-rounded).
  4. **`page.tsx:425` uses `plainError(...)`** like the other two paths. `NO_DATA_AVAILABLE: No landfill inbound data has been ingested.` no longer reaches the citizen; `현재 조건에 맞는 공식 자료가 없습니다.` is shown, with the raw code kept in a diagnostic detail line.
  5. On error, previous-filter values are still dropped (never misattributed), and the four filters remain fully operable.
  6. Per-capita fee `null` still renders its served reason, never `0원`; both reference periods still shown; the fee caveat retained.
  7. *(Optional, if taken)* `year/month/origin/waste` added to `AppUrlState` with the same whitelist/bounds discipline and round-trip tests.
- **Automated tests:** `LandfillDashboard.test.tsx` (27 tests) green + a new test asserting no raw `NO_DATA_AVAILABLE` in the citizen error text; `landfill.test.ts` green; `e2e/landfill.spec.ts` green **when run with `E2E_BACKEND_URL`** (see Open question O3).
- **Manual desktop checks:** with a live backend, 1440×900 — change each filter and confirm every displayed value/period updates together with no stale mixing.
- **Dependencies:** Phase 1.
- **Regression risks:** `landfill.spec.ts` is live-backend-only and will not run in a Docker-less environment — a code regression here is invisible to the offline suite. `LandfillDashboard.test.tsx` is the real safety net and must be extended, not merely kept green.

### Phase 6 — Data and sources desktop improvements
**Branch:** `ui/phase-6-data-sources`

- **Objective:** Lead with what is missing; give dataset status real hierarchy.
- **Files likely to change:** `components/TransparencyDashboard.tsx`, `components/TransparencyDashboard.test.tsx`, `e2e/citizenFlows.spec.ts` (Task E).
- **New components:** none beyond Phase 1 (uses `InfoBanner`, `Accordion`, `EmptyState`, `Chip` as a status badge).
- **Non-goals:** no change to which sources/datasets/counts are reported.
- **Acceptance criteria:**
  1. A top-of-page summary states, in plain Korean, how many datasets are complete vs incomplete and what is missing — before any table.
  2. Dataset `상태` renders as a text-first badge (label text carries the meaning; color is secondary only).
  3. Long tables sit in `Accordion`s or scroll inside `overflow-x-auto`; the page body never scrolls horizontally at 1280 or 1440.
  4. Raw version identifiers (`suitability-policy-v2`, `capital-grid-500m-v1`, `capex-standard-v2022dec`, `suitability-screening-v3`) move behind a `자세히 보기` disclosure, using the plain labels already in `GLOSSARY` (`분석 규칙 버전`, `분석 구역 버전`, `계산 방식 버전`).
  5. `값이 없는 지역은 빈 칸으로 두며 0으로 채우지 않습니다.` and the cost-exclusion list are preserved verbatim.
  6. `.wep-card` usage is retained and extended (this area is the reference implementation).
- **Automated tests:** `TransparencyDashboard.test.tsx` extended (summary present; status badge has text; version strings not in primary surface); `e2e/citizenFlows.spec.ts` Task E green.
- **Manual desktop checks:** 1440×900 with a live backend and the full source registry — confirm no horizontal overflow and that "what's missing" is legible without scrolling.
- **Dependencies:** Phase 1.
- **Regression risks:** `citizenFlows.spec.ts` drives this area by **visible Korean label text**, not testids — any heading rename breaks it.

### Phase 7 — Desktop regression, accessibility, and cleanup
**Branch:** `ui/phase-7-desktop-regression`

- **Objective:** Consolidate, delete dead code, prove nothing regressed.
- **Files likely to change:** `app/globals.css` (prune superseded utilities), `e2e/desktopBaseline.spec.ts` (re-capture), `docs/ui-baseline/desktop/*`, `frontend/RESPONSIVE_LAYOUT.md`, `docs/CITIZEN_LANGUAGE_AND_UX.md`, `docs/ACCESSIBILITY.md`. (`CitizenConditions` removal moved forward to Phase 2 and is already done.)
- **Non-goals:** no new visual features.
- **Acceptance criteria:**
  1. ~~**`CitizenConditions` removed in full**~~ — done in Phase 2; §9.1 below records the executed scope.
  2. Zero remaining raw `amber-*` panels outside `InfoBanner`; `rounded` (0.25rem) no longer used for cards.
  3. Full suite green: lint, typecheck, 26+ Vitest files, all non-live e2e, production build.
  4. Post-redesign baseline re-captured into `docs/ui-baseline/desktop/` and the old set replaced in one reviewable commit.
  5. `e2e/desktopBaseline.spec.ts` still drives the cost captures through the pre-Phase-2 `facility-cost-regions` multi-select, which no longer exists. It is opt-in (`CAPTURE_UI_BASELINE=1`) and skipped in every normal run, so it fails nothing today — but it must be migrated to the combobox as part of this re-capture. Phase 2 deliberately left it and `docs/ui-baseline/desktop/*` untouched so the "before" baseline stays intact.
  5. Keyboard-only pass over all four areas at 1440×900: skip link first, no trap, visible focus everywhere, all live regions still announcing.
  6. `1280×800` verified: no horizontal overflow, no clipped controls, no wrapped nav.
  7. Mobile has **not** regressed — the full `responsive.spec.ts` matrix (390/430/768/1054/1280/1440) is green and no mobile-specific redesign was introduced.
- **Automated tests:** everything, plus `e2e/desktopBaseline.spec.ts` re-run.
- **Manual desktop checks:** side-by-side before/after baseline review at 1440×900.
- **Dependencies:** Phases 1–6.
- **Regression risks:** removing `CitizenConditions` touches an e2e assertion and a Vitest block that must be deleted in the same commit or the suite fails.

#### 9.1 `CitizenConditions` removal scope (documented in Phase 0, **executed in Phase 2**)

> **Status: done.** Everything below was removed on `ui/phase-2-cost-setup`, together with the `e2e/facilityCost.spec.ts` assertion. `docs/FACILITY_COST_LENS_UI.md` — the only doc that substantively described the section, and which this list originally omitted — was updated in the same commit.

Confirmed client-only: no backend call, no persistence, no PII, no aggregation, no effect on any calculation, ranking, API request, URL state, export, or stored data. Its own copy says so: *"Client-only; nothing is stored, sent, or aggregated."*

Exact deletions in `frontend/src/components/FacilityCostDashboard.tsx`:

| Lines | Item |
|---|---|
| 63–75 | `const CITIZEN_CONDITIONS` (11 strings) |
| 77–82 | `const CITIZEN_RESPONSES` (4 strings) |
| 391 | `<CitizenConditions />` call site in `FacilityCostBody` |
| 1085–1147 | `function CitizenConditions()` — the whole component |

Test deletions:

| File | Lines | Item |
|---|---|---|
| `src/components/FacilityCostDashboard.test.tsx` | ~593–601 | `describe("citizen conditions (client-only)")` → `it("renders a non-persistent deliberation section with conditions and a stance")` (uses `facility-cost-conditions`, `facility-cost-condition`, `facility-cost-response`) |
| `e2e/facilityCost.spec.ts` | ~106 | the `expect(page.getByTestId("facility-cost-conditions")).toContainText(...)` assertion |

Retired testids: `facility-cost-conditions`, `facility-cost-condition`, `facility-cost-response`. No other file references them (verified by repo-wide grep). No `lib/`, API, or URL-state change is required.

---

## 10. Phase 1 implementation checklist

Ready to execute without repeating the architecture investigation.

**Setup**
- [ ] `git checkout main && git pull --ff-only && git checkout -b ui/phase-1-global-foundation`
- [ ] Baseline: `cd frontend && npm run lint && npm run typecheck && npm run test && npx playwright test` (expect **355 unit tests**, **60 e2e passed / 22 skipped**).

**Create `frontend/src/components/ui/`**
- [ ] `TopNavigation.tsx` — props `{ mode: DashboardArea; onChange: (m: DashboardArea) => void }`. Renders the product title `우리 동네 폐기물 지도` + 4 tabs from `MODE_LABELS`. Keep `data-testid="mode-switch"` on the group and `mode-equity`/`mode-suitability`/`mode-flow`/`mode-transparency` on the buttons. Keep `role="group"` + `aria-labelledby="mode-switch-label"`; render the label as `<span id="mode-switch-label" className="sr-only">주요 화면</span>`. **Button `textContent` must equal `MODE_LABELS[key]` exactly — no icons, no badges inside.**
- [ ] `SegmentedControl.tsx` — props `{ options: {key,label,testId}[]; value; onChange; ariaLabel }`. Native `<button aria-pressed>`; pill track `rounded-pill bg-surface-sunken`, active segment white + `shadow-card`.
- [ ] `InfoBanner.tsx` — props `{ tone: "info"|"warning"|"danger"; title?; children; role? }`. `role="alert"` only when explicitly passed.
- [ ] `Accordion.tsx` — props `{ label; defaultOpen?; children; testId? }`. Native `<details>` with a **new** class (e.g. `.wep-accordion`), *not* `.mobile-collapsible`.
- [ ] `KpiCard.tsx` — props `{ label; value; caption?; size?: "hero"|"default"; unavailableReason?; testId?; valueTestId? }`. Renders `<div><dt/><dd/></div>`; when `unavailableReason` is set, render the reason text, never `0`.
- [ ] `Chip.tsx` — props `{ label; onRemove?; removeLabel? }`. Wraps `.wep-chip`; remove button accessible name includes the label.
- [ ] `Skeleton.tsx` — props `{ className?; lines? }`, `aria-hidden`.
- [ ] `EmptyState.tsx` — props `{ title; description?; action? }`.
- [ ] Colocated `*.test.tsx` for each (render + a11y attributes + token classes).

**Wire into `app/page.tsx`**
- [ ] Delete `ModeSwitch` (1473–1517), `MODE_BUTTONS` (1466–1471), `SuitabilityViewSwitch` (1538–1570).
- [ ] Extract a `<PageShell>` (or an early fragment) that renders `<TopNavigation>` **once, above all six early returns**, so nav DOM position is identical in every branch. Remove the four in-branch `<ModeSwitch />` call sites (1063, 1075, 1104, 1164).
- [ ] Render `<SegmentedControl>` for the candidate subviews only inside `mode === "suitability"`, below the top nav (replacing call sites at 1105 and 1324).
- [ ] Keep `ModeOrientation` for now (Phase 4/5/6 decide per area).
- [ ] Keep the equity sidebar as an `<aside>` (terminology audit queries it).

**globals.css**
- [ ] Add `.wep-nav-tab` (+ active bottom indicator), `.wep-segment`/`.wep-segment-active`, `.wep-accordion` (with the dual `display:block` + `::details-content` force-open technique **only where desktop should stay open** — the new accordion should genuinely collapse on desktop).
- [ ] Do **not** touch `.map-pane`, the `@supports` dvh blocks, `.skip-link`, `:focus-visible`, or the print rules.

**Update tests**
- [ ] `accessibility.test.tsx` — mode-toggle group assertions still pass against `TopNavigation`; add a case that the group label is in the a11y tree while not visible.
- [ ] `terminology.audit.test.tsx` — exact-`textContent` assertions still pass; `document.querySelector("aside")` still resolves.
- [ ] `responsive.test.tsx` — update any class-string assertions touched by the nav hoist; leave `.map-pane` and the `min-h-screen min-h-dvh` ordering assertions untouched.

**Verify**
- [ ] `npm run lint && npm run typecheck && npm run test && npm run build`
- [ ] `npx playwright test` — 60 passed / 22 skipped, no new failures.
- [ ] `CAPTURE_UI_BASELINE=1 npx playwright test e2e/desktopBaseline.spec.ts` — inspect the 7 screenshots; nav must be in the same position and unwrapped in all of them.
- [ ] Manual: 1440×900 and 1280×800, keyboard-only tour of all four areas.

---

## 11. Proposed branch names

| Phase | Branch |
|---|---|
| 0 (this document) | `docs/phase-0-desktop-ui-ux-baseline` |
| 1 | `ui/phase-1-global-foundation` |
| 2 | `ui/phase-2-cost-setup` |
| 3 | `ui/phase-3-cost-results` |
| 4 | `ui/phase-4-equity-map` |
| 5 | `ui/phase-5-landfill-dashboard` |
| 6 | `ui/phase-6-data-sources` |
| 7 | `ui/phase-7-desktop-regression` |

---

## 12. Open questions and decisions

Only genuinely unresolved items. Anything answerable by reading the repository has been answered above and is not listed.

### O1 — How should display rounding express magnitude in Korean?
**Why unresolved:** `약 44만원` (Korean 만 units) vs `약 439,553원` (grouped exact) vs `약 44.0만원` are all defensible, and the choice is a language/product judgement, not a code fact. The examples in the brief use 만 units for 원 and plain grouping for 억원 and 톤/일 — that mix needs an explicit rule.
**Recommendation:** adopt the brief's examples as the rule — 억원 and 톤/일 round to a grouped integer with `약` (`약 1,277억원`, `약 280톤/일`); 원 rounds to 만 units with `약` (`약 44만원`); values below 1만원 keep grouped 원. Encode it once in `lib/displayNumber.ts` with unit-tests per unit.
**Blocks Phase 1?** **No.** Needed before Phase 3.

### O2 — Should the equity metric selector stay 11 radios?
**Why unresolved:** `accessibility.test.tsx` hard-asserts exactly 3 `<fieldset>`s and exactly 11 `input[type=radio][name="metric"]`, and that assertion encodes a deliberate a11y decision (one logical radio group, arrow-key traversal across all metrics). Replacing it with a searchable dropdown would improve density but is a real accessibility trade-off, not a styling change.
**Recommendation:** keep the 11 radios in Phase 4; solve density by making the *selected* metric dominant and letting the two non-active groups collapse, rather than by changing the control. Revisit only with a dedicated a11y review.
**Blocks Phase 1?** No.
**Resolved in Phase 4:** keep the 11 radios, and keep all three groups **expanded**. Making the selected metric dominant plus tighter card/row spacing met the density goal on its own, so the "collapse the two non-active groups" half of the recommendation was not needed — and collapsing them would have hidden metric families behind a closed disclosure. The 3-fieldset / 11-radio / shared-`name` structure is now asserted in `app/page.phase4.test.tsx` as well as `accessibility.test.tsx`.

### O3 — How is the landfill dashboard regression-tested without Docker?
**Why unresolved:** `e2e/landfill.spec.ts` (10 tests) is live-backend-only and self-skips without `E2E_BACKEND_URL`; the Docker daemon was down during Phase 0, so those 10 tests have not run against the current code in this environment. Phase 5 changes that component *and* its error path.
**Recommendation:** treat `LandfillDashboard.test.tsx` (27 Vitest tests, jsdom, no backend) as the binding safety net for Phase 5 and extend it with the new error-path case; run `landfill.spec.ts` against a live backend once before merging Phase 5. Do not weaken the live spec's skip guard, and do not add a synthetic landfill fixture to make it run offline — the fixture's 404 is deliberate.
**Blocks Phase 1?** No.

### O4 — Does the top navigation belong inside the equity sidebar or above it?
**Why unresolved:** hoisting the nav to a full-width header is the right IA, but the map layout is a full-height `md:h-dvh` flex row whose child `.map-pane` resolves `height: 100%` against it. Adding a sticky header above that row reduces the available row height and interacts with the documented `vh`-before-`dvh` fallback and the `@supports` overrides — the exact area of a previously-fixed layout bug.
**Recommendation:** wrap the shell in a column flex container (`h-dvh flex flex-col`) with the header as a fixed-height first child and the existing row as `flex-1 min-h-0`, keeping `.map-pane`'s rules untouched. Verify with the existing `responsive.spec.ts` assertion that the map still fills to the viewport bottom (`> 80%` of viewport height) at 1054, 1280, and 1440.
**Blocks Phase 1?** **Yes — this is the main technical risk in Phase 1.** Resolve it first; if the flex-column approach threatens the map-height guarantees, fall back to a non-sticky header in Phase 1 and revisit stickiness in Phase 7.

---

## Appendix A — Phase 0 validation results

Run on `docs/phase-0-desktop-ui-ux-baseline`, 2026-07-20, from `frontend/`.

| Command | Result |
|---|---|
| `npm run lint` | **PASS** (no output, exit 0) |
| `npm run typecheck` | **PASS** (`tsc --noEmit`, exit 0) |
| `npm run test` | **PASS** — 26 files, **355 tests**, 10.19s |
| `npm run build` | **PASS** — Next.js 16.2.10 Turbopack, compiled 22.1s, 4 static pages |
| `npx playwright test e2e/responsive.spec.ts e2e/accessibility.spec.ts` | **PASS** — 44 passed |
| `npx playwright test` (full) | **PASS** — 60 passed, 22 skipped |
| `CAPTURE_UI_BASELINE=1 npx playwright test e2e/desktopBaseline.spec.ts` | **PASS** — 7 passed, 11 PNGs written |

**22 skipped, itemised (all environment, not code):** `landfill.spec.ts` 10 + `map.spec.ts` 3 + `regressions.spec.ts` 2 = 15 live-backend specs that self-skip without `E2E_BACKEND_URL` (Docker daemon unavailable); plus `desktopBaseline.spec.ts` 7, which self-skips unless `CAPTURE_UI_BASELINE=1`.

## Appendix B — Baseline screenshots

`docs/ui-baseline/desktop/`, captured at 1440×900 via `frontend/e2e/desktopBaseline.spec.ts` with `mockBackend` (no backend, no database, no tiles).

| File | Area | Populated? |
|---|---|---|
| `regional-burden-1440x900.png` | 지역 부담 | Sidebar yes; map blank (empty boundary fixture) |
| `candidate-score-1440x900.png` | 후보지 점수 | Counts/stability yes; candidate lists empty |
| `candidate-weights-1440x900.png` | 가중치 바꿔보기 | Yes |
| `facility-cost-setup-1440x900.png` (+`-full`) | 비용 살펴보기, before | Yes |
| `facility-cost-results-1440x900.png` (+`-full`) | 비용 살펴보기, after | Yes |
| `landfill-dashboard-1440x900.png` (+`-full`) | 매립지 현황 | **No** — genuine 404 NO_DATA state |
| `data-sources-1440x900.png` (+`-full`) | 데이터·출처 | Partial — source table header-only |

The `-full` companions are full-page captures for the scrolling areas; the plain files are the 1440×900 viewport frame (what a desktop user sees above the fold). A small Next.js dev-mode indicator badge appears at the lower-left of some captures — a development artifact, not application UI.

**No visual-snapshot assertions were added.** The repository has no such convention (`toHaveScreenshot`/`toMatchSnapshot` appear nowhere), and a pixel baseline would fail on the first redesign commit it exists to document.
