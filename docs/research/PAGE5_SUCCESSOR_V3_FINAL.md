# Page 5 — Successor-V3 final frontend lane

**Status: complete against the V3 contract preview. The single most important
finding is that Page 5 is a HISTORICAL-model page by contract — the successor
model serves no user scenario at all. See §3.**

| | |
|---|---|
| Base | `be93abb8ed61fabb7997f64a07f95d5ab356530c` (`origin/integration/frontend-fidelity-20260817`) |
| Branch | `feat/page5-successor-v3-final` |
| Worktree | `/Volumes/WASTE_QA2/worktrees/page5-v3-final` |
| Figma | `hETmPv3N31IJeW8XdLwoiS` node `167:10554` |
| Backend handoff SHA | `b93393a015d6d9d579ff4619e092d545e690f388` (`origin/integration/backend-v3-contract-preview-20260817`) — **provisional, non-production** |
| Authoritative branch | `origin/release/backend-v3-ready-20260817` — **still absent**, see §3.4 |
| Deployed | no |
| Merged | no |
| Backend modified | no |

---

## 1. Environment note

`/Volumes/WASTE_QA2` was unmounted at the start of this session (no external
disk attached at all; `/Volumes` held only the `Macintosh HD` symlink, and the
five `/Volumes/WASTE_QA/worktrees/*` entries in `git worktree list` were
`prunable`). The lane was blocked outright until the user remounted it — the
base SHA is not present in `/Users/byeongilmin/dev/waste-equity-platform`,
which was left untouched throughout. While blocked, the Figma forensic pass
(§4) was completed over the REST API, which needs no volume.

---

## 2. Files changed

| File | Change |
|---|---|
| `frontend/src/lib/scenarioRankingComparison.ts` | carries the run's frozen `stability_class` / `stable_count` onto `RankedCandidateRow`, with an `agreedStability` guard |
| `frontend/src/components/suitability/page5/ScenarioRankingTable.tsx` | new 실행 안정성 column; three stacked prose lines above the table collapsed into one strip; footnote de-duplicated |
| `frontend/src/components/suitability/page5/SuitabilityScenarioRankingAnalytics.tsx` | movement card reduced to the scatter alone; one-line card description |
| `frontend/src/components/suitability/page5/ScenarioRankingKpiRow.tsx` | KPI captions cut to the frame's one-line density |
| `frontend/src/components/suitability/page5/ScenarioRankMovementList.tsx` | **deleted** (see §5.1) |
| `frontend/src/components/suitability/page5/SuitabilityScenarioRankingAnalytics.test.tsx` | movement-list suite replaced by the movement-card and stability-column contracts; `ranked()` gained a per-row override |
| `frontend/e2e/page5bRankingAnalytics.spec.ts` | movement-list test replaced; one KPI caption assertion updated |

V3 contract wiring (§3):

| File | Change |
|---|---|
| `frontend/src/lib/api.ts` | `component_model_version` / `component_order` on the two scenario responses; `component_scores` on both candidate shapes; optional request selector; `COMPONENT_MODEL_HISTORICAL` |
| `frontend/src/lib/glossary.ts` | the two component-model error codes, worded apart |
| `frontend/src/lib/scenarioComparison.ts` | wrong-model guard in `buildSide`; the historical-only contract documented |
| `frontend/src/components/suitability/useScenarioComparison.ts` | `messageFor` overrides the two model refusals only |
| `frontend/src/lib/scenarioComparison.test.ts` | two tests for the guard |

Fixture-only updates, forced by the two now-required response fields (mechanical,
no assertion changed): `page.page5a.test.tsx`, `page.suitabilityDashboard.test.tsx`,
`SuitabilityScenarioLab.test.tsx`, `SuitabilityScenarioCandidateComparison.test.tsx`,
`SuitabilityScenarioAnalysisSections.test.tsx`, `scenarioCandidateComparison.test.ts`,
`scenarioComparisonExport.test.ts`, `scenarioRankingComparison.test.ts`,
`e2e/mockBackend.ts`, `e2e/page4dScenarios.spec.ts`, `e2e/page5aComparison.spec.ts`,
`e2e/page5cCandidateComparison.spec.ts`, `e2e/page5Integration.spec.ts`.

No backend file, no migration, no policy module, no shared shell component, and
no Page-1/2/3/4/6 *component* was touched. The fixture updates above are the only
files outside Page 5, and they exist solely because a shared response type gained
two required fields.

---

## 3. Backend handoff — the V3 contract preview

Consumed `b93393a` (`integration/backend-v3-contract-preview-20260817`), read as
**provisional and non-production**. Nothing was deployed from it.

Sources read: `docs/research/SUITABILITY_V3_FINAL_POLICY.md`,
`docs/research/SUITABILITY_V3_PHASE5_RUNTIME_VALIDATION.md`,
`schemas/scenario.py`, `schemas/suitability.py`,
`api/routes/suitability_scenarios.py`.

### 3.1 The finding that governs this page

**User-weight scenarios exist for the historical component model ONLY.**

`_assert_scenario_model_supported` refuses any run whose component model is not
`suitability-components-zred-v1` with **422
`COMPONENT_MODEL_SCENARIOS_UNAVAILABLE`**, because the successor model has no
approved weight vector or normalization strategy for recombination — so any
recombination "would be a fabricated result rather than the user's scenario".

Page 5 is the A/B *scenario* page. It therefore remains a historical-model page
by contract, and **Z/R/E/D on this screen is correct rather than legacy**: it is
the only component set this page can ever be asked about. The successor
components (`existing_burden`, `air_impact_proxy`, `resident_impact`,
`land_conversion`) are never reachable here, and nothing was renamed to them.

That is also why no V3 policy number appears in Page-5 copy. The approved
vector (0.25 × 4), the 500 m `resident_impact` floor, the
`successor-land-cover-l2-v1` registry and the `suitability-successor-policy-v1`
identity all govern the *successor* model's own runs, which this page cannot
display. Putting any of them on Page 5 would attach a successor policy value to
a historical-model result.

### 3.2 What was wired

| contract element | value | where it went |
|---|---|---|
| model identity | `component_model_version`, `component_order` on preview **and** candidate detail | typed in `lib/api.ts`; enforced in `lib/scenarioComparison.ts` |
| version-aware scores | `component_scores: dict[str, str \| null]` — `{}` for historical runs, whose scores stay in the four legacy fields | typed; unread by Page 5, which uses `custom_score`/`custom_rank` |
| model selector | optional request field `component_model_version` | typed; deliberately **not sent** — omitting it resolves the default (historical) model, which is what this page wants |
| `COMPONENT_MODEL_MISMATCH` | the reader's own scenario belongs to another model and stays valid against a run of that model | distinct Korean message in `glossary.ts` |
| `COMPONENT_MODEL_SCENARIOS_UNAVAILABLE` | the run on screen has no approved weight vector | separate Korean message |
| stability | "Stored-run weight-sensitivity stability (**NOT recomputed under the scenario**)" | confirms §6 — the implementation already matched |
| eligibility | successor "re-scores; it never re-screens"; 0 of 47,893 statuses differ from the source run | confirms the existing invariant; no change needed |
| missingness | `STRICT_ALL_COMPONENTS_REQUIRED`, zero-fill permanently forbidden | confirms the existing rule; no change needed |

**The two error codes must not read alike**, and the route says so explicitly: a
mismatch is a statement about the reader's artifact, unavailable is a statement
about the run. `useScenarioComparison.messageFor` overrides **only** those two
with Korean; every other failure keeps the backend's own sentence, which names
the offending value ("가중치 합이 1이 아닙니다: 1.05") in a way a generic line
cannot.

A defence-in-depth guard was added: a READY side whose preview declares any
non-historical component model is downgraded to `PREVIEW_ERROR`. The backend
refuses such a request before computing, so it should be unreachable — but the
failure it prevents is silent and total. `canonical_weights` is keyed by the
run's own components, so a successor preview would make every Z/R/E/D lookup
read `undefined`, printing one model's numbers under another model's four
labels instead of failing.

### 3.3 What was NOT wired, and why

`component_model_version` / `component_order` / `component_scores` are also now
served by every run-scoped and candidate-bearing **suitability** response (run,
summary, candidate, candidate detail). Those types drive Pages 4 and 6 and are
left to those lanes; this branch types only the two scenario endpoints Page 5
consumes. Wiring them here would have forced unrelated fixtures and pre-empted
another lane's design decisions.

No successor stability semantics were adopted. The successor defines its own
(four symmetric per-component perturbations, step 0.06, STABLE = survives all
four) and it is deliberately *not* the historical three-profile definition. Page
5 can only ever show a historical run, so `STABILITY_META`'s existing
three-profile wording is the correct labelling here. If Page 5 ever became
successor-capable, that mapping — not this page's layout — is what would have to
change.

### 3.4 Diff against the authoritative branch — still pending

`origin/release/backend-v3-ready-20260817` did not exist at any poll up to
16:39 KST. The preview contract is therefore unconfirmed. **Before final
integration, diff `b93393a`'s `schemas/scenario.py` and
`api/routes/suitability_scenarios.py` against the release branch.** The three
things that would force a Page-5 change:

1. scenarios becoming available for the successor model — would make Z/R/E/D
   insufficient and require a component-model-driven weight table;
2. either error code being renamed, merged, or re-scoped;
3. `component_model_version` changing shape or leaving the scenario responses —
   the guard in `buildSide` reads it directly.

If none of the three changed, this branch needs no edit.

## 4. Figma forensic transcription

Full geometry/typography/copy transcription of `167:10554` was taken from the
REST API (`/v1/files/.../nodes` + `/v1/images`) rather than eyeballed. Frame is
1440×1921.5: 78px header, 1px rule, body from y=79 with a 24px gutter and
1392px content column. Six cards: scenario/weight (1392×312), ResultKPIRow
(5 × 267 tiles), Row3 (740 | 636), Row4 (688 | 688, **equal**), and a
full-width comparison table (1392×350).

Type scale: card title 19/700, KPI label 16/500, KPI value 19/700, KPI caption
11.5/700, section subtitle 15/700, body 13–14/400, table header 11.5/700,
table cell 13/400, footnote 11.5/400.

### 4.1 Where the frame is not truthful, and what was done

These are the points at which Figma loses to analytics, per the lane rule. The
first two were already resolved on the base branch by earlier lanes; they are
recorded because they are what the frame demands and this lane confirmed the
existing resolution rather than reverting it.

1. **`가중치 민감도 (결과 안정성)` (Row4-right).** Every point the frame plots is
   a region from the A/B table keyed by its A→B rank delta (시흥시 ↑4, 안산시 ↓2,
   A지역 ↓17), and the 변동성 legend buckets that same delta (±10 / ±5–9 / ±4).
   That is a two-point weight swap, not a perturbation study. Kept titled
   **순위 변동 분포**, and this lane tightened the caption to say so in one line:
   "두 시나리오 사이의 순위 차이입니다. 가중치를 여러 번 바꿔 본 민감도 분석이 아닙니다."
   A unit test now asserts the card never claims otherwise.
2. **Screening KPIs.** 통과 지역 수 304→328, 신규 통과 32개, 통과→제외 rows and the
   60점 통과 기준 footnote all describe screening moving with weights. It does
   not. Absent, and the e2e suite already forbids the vocabulary.
3. **Factor names.** The frame lists 시설부담 정도 / 토지피복 기반 적합도 /
   장래 쓰레기 발생량 / 주민 반응. The model's factors are Z/R/E/D
   (용도지역 호환성 / 도로 근접성 대리지표 / 기존 지역 부담 / 폐기물 처리 수요).
   Renaming E to "시설 부담" would invert its direction and D is served
   present-day demand, not a forecast. Frame names not adopted.
4. **`용도지역` appears in the frame's 주요 변화 요인 column** but is not one of
   the four factors it lists two cards above. Comp inconsistency; that column
   is a causal attribution and is absent anyway.
5. **`시지역` / `A지역`** are placeholder region names in the comp.

---

## 5. Figma Pass 1 → Pass 2 → Pass 3

Rendered at 1440×900 against a self-mocked backend (no database, no tile
server, no government API), captured in viewport bands. `fullPage` is unusable
here: it resizes the viewport, which remounts the map and re-issues both
previews, so the tail returns as a loading state.

Captures: `pass{1,2,3}-band*.png`.

### Pass 1 — findings

| # | Kind | Finding |
|---|---|---|
| P1-1 | geometry | Row4 badly ragged: the right card ran ~2.5× the left, which ended in ~400px of white. Frame draws two **equal** 688×458 cards. |
| P1-2 | content | 순위 변화가 큰 후보 구역 list (≤10 rows) inside the movement card restated the comparison table below it. Not in the frame. |
| P1-3 | copy density | KPI captions were 2–3 line sentences against the frame's single short line; tiles ran tall. |
| P1-4 | copy density | Card 5 stacked three full-width prose lines (description, scope, row count) above a table the frame gives one caption. |
| P1-5 | copy | Screening-independence stated three times within ~600px (map note, table footnote, page method note). |
| P1-6 | geometry | Page title band + orientation strip (~87px) above card 1; the frame's body opens directly on card 1. |
| P1-7 | analytics | Backend `stability_class` / `stable_count` are served on every candidate row and were displayed nowhere on Page 5. |

### Fixes applied

**5.1 The movement list was removed, not relocated.** Its rows were the
comparison table minus the score columns, under a different heading: the
table's default sort is `movement_desc` — literally 순위 변화가 큰 순 — so the
two printed the same cells in the same order. Deleting it fixed P1-2 and P1-1
together. `topRankMovements` survives in `lib/` (exported, still unit-tested)
for the export sheet. Cost: four unit tests and one e2e test that contracted
the list were rewritten against the new contract. The behaviour they guarded
(ordering, cell naming, exact-rank-only, no padding with holds) remains
covered by `lib/scenarioRankingComparison.test.ts`.

**5.2 The run's stability is now displayed (P1-7).** A single 실행 안정성
column in the comparison table, occupying roughly where the frame puts
A안 결과 / B안 결과. It carries the backend's frozen `stability_class` verbatim.
This is the one robustness statement Page 5 is entitled to make, because it is
a property of the **run** — computed once, identical inside both previews,
unmoved by either scenario's weights — rather than something derived from the
reader's two weight vectors. See §6.

**5.3 Copy density (P1-3, P1-4).** KPI captions cut to one line each; the
three lines above the table folded into one strip carrying row count + scope +
the sort-does-not-refilter clause.

**5.4 Duplicate warning (P1-5).** The table footnote's screening-independence
clause was dropped — the page already closes with that statement
(`scenario-comparison-method-note`) ~100px lower. The footnote now states only
what is local to the table. The map note's copy of it was **kept**: it is
anchored to the 배제/검토 swatches in the legend directly above it, which a
reader could otherwise take as moving with the weights. Two anchored
statements, not three floating ones.

### Pass 2 — findings

- P1-1/2/3/4 resolved; page shrank from four viewport bands to three.
- Row4 now stretches evenly, but the right card carries trailing white because
  the scatter is shorter than the contribution card beside it. The frame has
  the same property (scatter 342 inside a 458 card), so this was left.
- P1-5 still present → fixed as 5.4.

### Pass 3 — findings

- KPI row now reads as the frame's five single-caption tiles.
- Table carries 실행 안정성 with real served classes across all three values.
- No horizontal overflow at 1440 (e2e-asserted).
- Remaining divergence is §7 only.

### Pass 4 — after the V3 contract wiring

Re-captured once the model identity, the guard and the two error codes were in.
The wiring is behavioural, and the capture confirms it changed nothing visual:
same three bands, same card geometry, 실행 안정성 still rendering all three
classes, one scope strip, one table footnote, and the page-level method note
still stated exactly once at the foot. The 39 Page-5 e2e tests render the same
page at 1440×900 against fixtures carrying the new required fields.

---

## 6. Stability semantics as actually implemented

Read verbatim off the served rows; nothing derived, nothing invented:

- source: `UserScenarioTopCandidate.stability_class` / `.stable_count`
- backend definition (`analysis/suitability/engine.py` `_stability_class`,
  `analysis/suitability/policy.py`): membership in the top
  `STABILITY_TOP_FRACTION` = 0.10 of each of `STABILITY_PROFILES` =
  `("baseline", "equal", "critic")`; `stable_count == 3` → `STABLE`, `== 2` →
  `CONDITIONALLY_STABLE`, `∈ {0,1}` → `WEIGHT_SENSITIVE`. Method version
  `suitability-stability-v1`.
- labels come from the existing shared `STABILITY_META`, so no policy number
  is restated in Page-5 copy. **If V3 redefines the classes or the fraction,
  no Page-5 file changes.**
- `agreedStability` withholds the class if the two sides ever serve different
  values for one cell — the page has no basis for picking a winner between two
  contradicting responses.
- rendered flat: no arrow, no colour ramp, no A/B pairing, so it cannot be
  misread as a third comparison beside the two rank columns. An unserved class
  prints 자료 없음, never "안정적".

**This is not, and is not labelled as, a sensitivity analysis.** No
perturbation sweep, Spearman correlation, or rank-stability score is computed
or displayed, because the backend serves none and Page 5 holds exactly two
weight vectors.

### Metrics displayed

Served or deterministically derived from served values only:

| Metric | Basis |
|---|---|
| 1위 후보 구역 A→B | `custom_rank == 1` on each side |
| TOP-10 유지 | exact key-set overlap, denominator `min(10, served A, served B)` |
| 순위 상승 / 하락 | sign of `rankB − rankA`, exact ranks both sides only |
| 양쪽에서 순위를 확인한 후보 구역 | size of the comparable set |
| 순위 변화 TOP 10 slope | union of the two top-10 sets |
| 순위 변동 분포 scatter | B-rank band × signed movement |
| 순위 / 점수 / 점수 변화 table | `custom_rank`, `custom_score` verbatim |
| 실행 안정성 | served `stability_class` (§6) |

Not displayed, because unserved: Spearman, Top-N overlap beyond N=10, regional
concentration, rank-movement significance, scenario/model/policy version
badges.

### Eligibility

Unchanged and untouched. Screening stays rule-based and weight-independent;
no scenario path recomputes, re-labels, or re-counts an eligibility verdict.
Missing stays missing: absent ranks print
`A안 상위 N 밖` / `순위 미제공`, absent scores print 자료 없음, absent stability
prints 자료 없음 — never a substituted number, never a zero, never a default.

---

## 7. Remaining limitations

1. **The contract is the PREVIEW, not the release** (§3.4).
   `origin/release/backend-v3-ready-20260817` has not appeared, so the wired
   contract is provisional and must be diffed before final integration.
2. **The successor model's own results are unreachable from Page 5** — by
   contract, not by omission (§3.1). A reader who wants successor scores needs
   Page 4/6; this page shows historical-model scenarios only. If the project
   later wants A/B on successor runs, that needs a backend decision (an approved
   weight vector for recombination), not a frontend change.
3. **Regional concentration is handed to this lane and is NOT addressed here.**
   The final policy (§6.3) records the successor top-50 as 49/50 양평군 and says
   the correct response is presentational — read the ranking at region grain
   and/or cap candidates per region — explicitly assigning it to "the Page 4/5
   lanes". That concerns the *successor* ranking, which Page 5 cannot display,
   so it is out of scope here and belongs to Page 4.
4. **Page title band retained.** The frame gives Page 5 no title, but the band
   is the app-wide `PageHeader` and carries the page's `h1`. Removing it for
   this page alone would break shell consistency with Pages 1–4/6 and cost the
   document its heading. Accepted deviation: content starts ~87px below the
   frame's y=99.
5. **Row4-left exceeds the frame's 458px.** The real per-factor contribution
   table, its 주요 영향 요인 line and the export scope note do not compress into
   the comp's height. Row4 therefore stretches taller than the frame, evenly.
6. **The frame's 후보 결과 변화 지도 legend counts** (신규 통과 32 / 통과 유지 296 /
   통과 → 제외 28 / 양쪽 제외 144) remain unimplementable for the reason in §4.1.2.
7. The map is unpainted in QA captures (no tile server in the mock); map
   rendering was not re-verified by this lane and is unchanged from base.

---

## 8. Verification

Run with node 22.22.0 under `recovery-env.sh`, on an isolated port (3187) with
its own dev server, so this lane never contended for :3000 with another lane
or with the full product suite. The full product Playwright suite was **not**
run, per the lane brief.

| Check | Result |
|---|---|
| `tsc --noEmit` | pass |
| `eslint` (changed files) | pass, 0 findings |
| `vitest src/components/suitability/page5` + `lib/scenarioRankingComparison` | **106/106** |
| `vitest src/lib src/components src/app` (whole unit suite) | **2165 passed / 2173**, 7 skipped, 1 contention flake |
| `playwright` Page-5A + 5B + 5C + integration, isolated port | **39/39** |
| 1440×900 visual | four capture passes, §5 |

The single unit failure was `FacilityCostDashboard.test.tsx > toggles a calculable
region from the map` under a 4-lane parallel run; it **passes 86/86 in isolation**
and is in a file this branch does not touch (the known vitest lane-contention
flake). Every scenario, Page-5, accessibility and terminology suite passed in the
same run.

Accessibility: the new column is a real `<th scope="col">` inside the existing
table semantics and is picked up by the table's `<caption>`; the removed list
took no landmark or heading with it that another element did not already
provide; `src/app/accessibility.test.tsx` passes unchanged.

No backend modification. No production deployment. No merge to `main`.

READY FOR FINAL INTEGRATION
