# Page 5B — 순위 비교 분석 (output contract)

**Status:** frozen by Page 5B. Page-5 final integration consumes this; Page 5C does
not depend on it and stays independently mergeable.

Page 5A answers *"who are A안 and B안, and are they comparable?"*. Page 5B answers
*"what did the reweighting do to the ranking?"* — and only that. Contribution
analysis, candidate detail, the scenario map and export are Page 5C's.

---

## 1. What Page 5B consumes

Exactly one prop:

```ts
<SuitabilityScenarioRankingAnalytics comparison={comparison} />
```

`comparison` is the `ScenarioComparison` the foundation already built
(`PAGE_5_SCENARIO_CONTRACT.md` §9). Page 5B **does not**:

* read `localStorage`, or resolve `cmpA`/`cmpB`;
* call `POST /suitability/scenarios/preview`;
* canonicalise weights;
* build a second comparison model.

It reads `comparison.sideA.preview`, `comparison.sideB.preview` and
`comparison.runId`, and nothing else.

---

## 2. Preview fields actually used

Verified against a live run-47 preview, not assumed. Of the served
`UserScenarioPreview`:

| Field | Used | Why / why not |
|---|---|---|
| `top_candidates[].candidate_key` | ✅ | **the join key** (§4) |
| `top_candidates[].candidate_id` | ✅ | carried for downstream selection |
| `top_candidates[].custom_rank` | ✅ | the A/B rank on that side |
| `top_candidates[].custom_score` | ✅ | the A/B score on that side, verbatim |
| `top_candidates[].sigungu_region_name` | ✅ | the location line — **already fully qualified** (`"인천광역시 강화군"`), so the 시·도 is NOT prepended |
| `top_candidates[].sido_region_name` | ✅ | fallback only, for a cell with no 시·군·구 |
| `top_candidates[].centroid_lat/lon` | ✅ | carried for cell disambiguation |
| `ranking_population` | ✅ | the scope sentence and the 공통 후보 KPI caption |
| `run_id` | ✅ | via `comparison.runId` |
| `comparison_score` / `comparison_rank` / `rank_delta` / `rank_change_direction` | ❌ **never** | these describe that side against the official `compare_profile` (pinned to `baseline`), i.e. "A안 vs 공식 기준". Using them as an A/B figure would print a number that looks like an A→B movement and is not one. |
| `candidate_count_total/eligible/review/excluded` | ❌ | screening figures; a scenario does not move them (§7) |
| `scenario_hash`, `tile_url`, `selected_candidate`, disclaimers, versions | ❌ | not rank analytics |

**There is no `ranking_population`-wide rank list.** The endpoint serves a top-N cut
(`SCENARIO_COMPARISON_TOP_N` = 50, the schema maximum).

---

## 3. The exported model

`frontend/src/lib/scenarioRankingComparison.ts` — pure, React-free.

```ts
buildScenarioRankingComparison(comparison): ScenarioRankingComparison | null
```

`null` whenever either side is not `READY`. There is no partial model.

```ts
interface ScenarioRankingComparison {
  runId: number | null;
  boundaryA: RankBoundary;          // what A's served list proves
  boundaryB: RankBoundary;
  rankingPopulation: number | null; // only when both sides report the same one

  topCandidate: TopCandidateComparison;   // UNCHANGED | CHANGED | UNAVAILABLE
  topNRetention: TopNRetention;           // exact top-10 set overlap

  candidateRows: RankedCandidateRow[];    // UNION of both served lists
  comparableRows: RankedCandidateRow[];   // EXACT rank on both sides
  roseCount: number; fellCount: number; heldCount: number;

  slopeRows: ScenarioSlopeRow[];          // union of the two top-10 sets
  scopeDescription: string;               // the bounded population, in one sentence
}
```

Helpers integration may reuse: `sortRankingComparisonRows`, `topRankMovements`,
`scoreChange`, `formatRankMovement`, `formatUnavailableRank`, `rankBoundary`.

---

## 4. The join key

`candidate_key`. Never the display name, the 시·군·구, the row position, or the rank.
A 시·군·구 holds many 500 m cells, so a location join would merge distinct cells and
invent movements between them; a positional join would pair A's 3rd row with B's 3rd
row, which is precisely what the comparison exists to tell apart.

**The ranked object is a 500 m candidate cell, not a city.** Every row names the
시·군·구 as a *location* and carries `500m 후보 구역 · <candidate_key>` beside it.

---

## 5. Rank-delta semantics

```
rankDelta = rankB − rankA
rankB < rankA  → direction "UP"    (순위 상승)
rankB > rankA  → direction "DOWN"  (순위 하락)
rankB = rankA  → direction "SAME"  (유지)
movement = |rankDelta|
```

This is the **opposite sign convention** to the backend's own `rank_delta`
(`comparison_rank − custom_rank`, where positive is up). The two never meet because
Page 5B does not read that field — but consumers must key off `direction`, never the
sign of the number. `movement` is exported unsigned so nothing downstream needs to
know the convention at all.

---

## 6. Missing ranks

A candidate may be in A's cut and not B's. The backend ranks the **complete**
eligible population before it cuts (`_PREVIEW_SQL`: `row_number() OVER (...)` then
`ORDER BY custom_rank ASC LIMIT :top_n`), so a served list of *k* rows is exactly
ranks 1..*k*. `rankBoundary()` re-derives that from the response rather than assuming
it, and `RankAvailability` is the three-state answer:

| State | Meaning | Rendered as |
|---|---|---|
| `EXACT` | the server sent this rank | `27위` |
| `OUTSIDE_PREVIEW` | the served rows are provably 1..*k* **and** *k* < population, so this candidate ranks worse than *k* | `B안 상위 50 밖` |
| `UNKNOWN` | the rows are not contiguous 1..*k*, **or** the cut already held the whole population — nothing can be concluded | `B안 순위 미제공` |

**No rank is ever fabricated.** `top_n + 1`, `ranking_population`, `999` and every
other stand-in are absent. A row without an exact rank on both sides has
`rankDelta`/`movement`/`direction` all `null`, is excluded from `comparableRows`,
from every rise/fall count, and from the movement list's ordering.

---

## 7. Scopes, and what each figure may be called

Every figure is computed over the two top-50 cuts, never the ranked population.

| Surface | Population | May NOT be called |
|---|---|---|
| `1위 후보 구역` | rank-1 row of each side | 최적 지역 (the ranked object is a cell) |
| `TOP 10 유지 후보 구역` | exact overlap of the two top-10 key sets; denominator `min(10, servedA, servedB)` and labelled when reduced | 전체 순위 안정성 / 전체 후보 유지율 |
| `순위 상승` / `순위 하락` | `comparableRows` only | 전체 후보 순위 상승 |
| `양쪽에서 순위를 확인한 후보 구역` | `comparableRows.length`, captioned with `ranking_population` | a total |
| slope chart | union of the two top-10 sets | a population-wide slope chart |
| 순위 변화가 큰 후보 | `comparableRows` with `movement > 0` | — |
| 상세 비교표 | union of both served lists | the complete ranking |

`scopeDescription` states the bound once, in full, above the sections.

---

## 8. Forbidden analytics — deliberately not implemented

The Figma frame's KPI row and table carry mock findings that this product cannot
produce. A scenario reweights the **ranking**; screening is rule-based and does not
move with the weights.

* 통과 지역 수 변화 (`304개 → 328개`), 신규 통과 지역 (`32개`), 통과 → 제외
* `A안 결과` / `B안 결과` status columns, and any status *change*
* `통과 기준은 종합 점수 60점 이상`, 62점 기준
* 주요 변화 요인 (a one-cause narrative for a four-factor reweighting)
* 가중치 민감도 / sensitivity band, 주민 반응, 장래 쓰레기 발생량

Pinned by unit, component and e2e assertions that the rendered text contains none of
these phrases.

---

## 9. Sorting

`sortRankingComparisonRows(rows, sort)` returns a **copy**; the model's own order is
never mutated. `movement_desc | rank_a_asc | rank_b_asc | score_change_desc`. Rows
lacking the sorted quantity sort **last in every direction** — an absent rank is not
a large one or a small one. No sort issues a request or widens the cut, and the table
says so on screen. Pinned by an e2e test that counts preview requests across a sort.

---

## 10. Files owned by Page 5B

```
frontend/src/lib/scenarioRankingComparison.ts
frontend/src/lib/scenarioRankingComparison.test.ts
frontend/src/components/suitability/page5/ScenarioRankingKpiRow.tsx
frontend/src/components/suitability/page5/ScenarioRankSlopeChart.tsx
frontend/src/components/suitability/page5/ScenarioRankMovementList.tsx
frontend/src/components/suitability/page5/ScenarioRankingTable.tsx
frontend/src/components/suitability/page5/SuitabilityScenarioRankingAnalytics.tsx
frontend/src/components/suitability/page5/SuitabilityScenarioRankingAnalytics.test.tsx
frontend/e2e/page5bRankingAnalytics.spec.ts
docs/figma-redesign/PAGE_5B_RANKING_ANALYTICS.md
```

**One shared file touched:** `SuitabilityScenarioComparison.tsx` — a single import
and a single `<SuitabilityScenarioRankingAnalytics comparison={comparison} />` line
in the existing layout. `savedScenarios.ts`, `scenarioComparison.ts`,
`useScenarioComparison.ts`, `urlState.ts`, `MapView.tsx`, the backend and the export
modules are untouched. Page 5C's insertion point in the same file is a different
region of the tree.

---

## 11. Test coverage that pins this document

| Concern | File | Count |
|---|---|---|
| Join, top-1, exact TOP-10 retention, rank up/down/same, missing on either side, no fabricated rank, boundary proofs, bounded labelling, sorting, no screening analytics | `lib/scenarioRankingComparison.test.ts` | 63 |
| KPI row, slope view, movement list, ranking table, empty states, readiness gate, no 60/62 wording, candidate-cell identity | `components/suitability/page5/SuitabilityScenarioRankingAnalytics.test.tsx` | 29 |
| Real browser: KPI figures, out-of-preview wording, movement ordering, top-10 union, sorting issues no request, not-READY renders nothing, forbidden vocabulary, no overflow at 1440 | `e2e/page5bRankingAnalytics.spec.ts` | 9 |

---

## 12. Verified against real data

Run 47 on the local backend (`ranking_population` 17,501), two saved scenarios
re-previewed through the real endpoint:

| Check | Expected (computed independently from the two payloads) | UI |
|---|---|---|
| served / population | 50 / 50, 17,501 both sides | ✅ |
| ranks contiguous 1..50 | true | ✅ |
| TOP-1 (E100 vs Z10) | UNCHANGED, `…1774_3950` | ✅ |
| TOP-1 (Z70 vs E70) | CHANGED, 옹진군 cell → 강화군 cell | ✅ |
| TOP-10 retention | 5/10 = 50% | ✅ |
| rises / falls / common | 8 / 0 / 9 | ✅ |
| slope population | 15 (top-10 union) | ✅ |
| table population | 91 (top-50 union) | ✅ |
| largest movement | `…1781_3958` A47 → B9, ↑38계단 | ✅ |
| slot swap inverts direction | 8 falls, ↓38계단, 밖 state moves to A | ✅ |

**Known property of this run:** every candidate in the top 50 shares one component
tuple, so scores tie and ties break on `candidate_key`. Rank movement is therefore
only observable where the two cuts overlap *partially* — which the E100/Z10 pair
does. It is not a defect in the model.
