# Suitability — User-Weight Scenario Lab (Phase 6)

**사용자 가정 기반 시나리오 (user-assumption-based scenario).**

A temporary, on-read decision-support experiment that lets a citizen re-weight the
four existing Z/R/E/D component scores of **one fixed, already-succeeded**
suitability run and compare the resulting candidate scores/ranks against a stored
profile. It is deliberately *separate* from every official stored artifact.

> This document is the human-readable companion to
> `backend/src/waste_equity_backend/analysis/suitability/scenario.py` (the machine
> source of truth for the weight model, hashing, and scoring). If they disagree,
> the code wins and this doc is the bug.

---

## 1. Purpose

Let a non-expert user ask *"what if I cared more about equity (or road access) than
the operating-default baseline assumes?"* and immediately see how the analytical
candidate ranking would shift — **without** creating an official run, mutating any
stored data, or implying a legal/permitting/final-siting outcome.

## 2. User-facing workflow (가중치 실험실)

Suitability → **가중치 실험실** sub-view (beside 적합성 점수 and 비용 렌즈):

1. Edit the four weights (0–100 % integer sliders + numeric inputs).
2. The running total and its difference from 100 % are shown continuously; **시나리오
   적용** is disabled until the total is exactly 100 %.
3. Optionally load a preset (기본 가정 / 균등 / 형평성 중심 / 접근성 중심 / CRITIC 데이터 기반) or
   press **100%로 비율 정규화**.
4. Press **시나리오 적용** → one preview request. The map switches to the custom tiles,
   the summary + top candidates appear.
5. Pick a comparison profile to see rank deltas; select a candidate to see its exact
   custom rank and weighted contributions and move/highlight the map.

Slider edits never fire a request; only the explicit apply does. After an apply, a
draft edit marks the result **stale** ("현재 결과는 마지막으로 적용한 가중치 기준입니다") until
the user re-applies.

## 3. Fixed run dependency

A scenario is always computed against exactly one succeeded `SuitabilityAnalysisRun`
and its `SuitabilityCandidate` rows. `run_id` omitted → latest succeeded run. The
run's frozen component scores, statuses, exclusion/review reasons, penalties,
provenance, and stability are the immutable source of truth. **Nothing about the run
is recalculated** — only the four component scores are recombined.

## 4. Canonical weight model

* Fixed criterion order: `zoning, road, equity, demand`.
* Canonical precision: **8 decimal places**, exact decimal strings (never floats).
* Validation (no silent repair): exactly the four keys, no unknowns; each value a
  finite decimal in `[0, 1]` (zero allowed); not all-zero; the canonical (8-dp)
  sum equals exactly `Decimal("1.00000000")`. Negative / NaN / Infinity / missing /
  malformed / over-one → structured `422 INVALID_SCENARIO_WEIGHTS`.
* The editor works in an integer 0–100 % scale; an integer total of exactly 100 maps
  to canonical weights that sum exactly to 1 (`p/100` is exact to 2 dp).

```json
{ "zoning": "0.35000000", "road": "0.25000000", "equity": "0.25000000", "demand": "0.15000000" }
```

## 5. Exact scoring equation

For an **ELIGIBLE** candidate (all four component scores present):

```
custom_score = zoning·w_zoning + road·w_road + equity·w_equity + demand·w_demand
```

on the 0–100 scale, quantized to **4 dp with ROUND_HALF_EVEN** — identical to
`policy.composite`, so a scenario score is quantized exactly like every stored
composite. PostgreSQL `round(numeric,4)` rounds *half away from zero*, so the SQL
uses a trusted, static banker's-rounding fragment (`_round_half_even_4`) to match
the Python helper byte-for-byte. See §9.

## 6. Provisional-score semantics (REVIEW_REQUIRED)

No final custom score and no custom rank. An optional provisional score reuses the
existing provisional-composite semantics: the available component contributions are
normalized by the **total weight of the available components** (missing components
are never zero-filled). If the available-weight denominator is zero (e.g. every
present component was assigned weight 0), the provisional score is **unavailable**.

**EXCLUDED**: no custom score, no provisional score, no custom rank; status and
exclusion reasons are unchanged. User weighting never overrides an exclusion.

## 7. Ranking population and tie-break

Only ELIGIBLE candidates of the fixed run that already carry all four component
scores are ranked. Ranking is `custom_score` **descending**, `candidate_key`
**ascending** (deterministic tie-break), sequential `1..N` (`row_number`, the same
behavior as the stored engine — never `dense_rank`). The window covers the
**complete** ELIGIBLE population *before* `LIMIT top_n`.

## 8. Rank-delta convention

```
rank_delta = comparison_profile_rank − custom_rank
```

* positive → moved **up** under the scenario (better/lower rank number),
* zero → unchanged,
* negative → moved **down**.

Direction is always shown in **text** (e.g. `42위 → 18위, 24계단 상승`), never color
alone.

## 9. Shared scoring — one formula, four paths

The Python helper, the preview SQL, the candidate-detail SQL, and the MVT SQL all
compute the *same* value. SQL scoring reuses one trusted static fragment
(`_RAW_SCORE_SQL`) wrapped in `_round_half_even_4`; user values are always **bound
parameters** — never interpolated. The PostGIS integration tests assert exact
cross-path consistency (all-nonzero weights, one-weight-1, zero weights, ties,
partial review components, all-zero-available-weight review, excluded, exact 4-dp
quantization).

## 10. Preview API

`POST /api/v1/suitability/scenarios/preview`

Request: `{ run_id?, weights{zoning,road,equity,demand}, compare_profile, top_n=10
(1..50), selected_candidate_id? }`. Resolves a succeeded run, validates the
comparison profile is available for that run (an old run without CRITIC rejects
`compare_profile=critic` with `PROFILE_NOT_AVAILABLE_FOR_RUN`), validates +
canonicalizes weights, computes the scenario hash, ranks the full ELIGIBLE
population, returns the top N with comparison score/rank + rank deltas, fixed status
counts, an optional selected-candidate detail, the custom tile URL, assumptions, and
disclaimers. **Never writes to the database.**

## 11. Candidate-detail API

`POST /api/v1/suitability/scenarios/candidates/{candidate_id}`

Request: `{ run_id?, weights, compare_profile }`. Returns the fixed identity/status,
component scores, custom score/rank (ELIGIBLE) or provisional (REVIEW) or none
(EXCLUDED), comparison score/rank + delta, the per-component weighted-contribution
table (contributions sum to the custom score within the documented 4-dp
quantization), the stored stability class/membership, fixed exclusion/review
reasons, penalties, provenance, and both disclaimers. A candidate from another run →
structured `CANDIDATE_RUN_MISMATCH` (never silently resolved); missing →
`CANDIDATE_NOT_FOUND`.

## 12. Custom MVT API

`GET /api/v1/suitability/scenarios/tiles/{run_id}/{z}/{x}/{y}.mvt?wz&wr&we&wd&scenario_hash`

Validates z/x/y, canonicalizes the query weights, recomputes the expected scenario
hash and rejects a mismatch (`SCENARIO_HASH_MISMATCH`), resolves the run, and
computes the custom `score` (ELIGIBLE) / `provisional_score` (REVIEW) only for
geometries intersecting the tile (filter-before-transform on the 4326 GiST index).
It emits the **same source-layer name (`candidates`) and property names** as the
stored tiles (status, score, provisional_score, component scores, stable_count,
stability_class, candidate id/key, SIGUNGU), so the map reuses its fill/outline
expressions by swapping only the tile URL. **No global ranking inside a tile** — the
exact custom rank is fetched into the sidebar detail on selection; `rank` is
intentionally absent from the tile.

## 13. Cache and ETag behavior

The run + canonical weights + scenario hash fully determine a tile, so the ETag binds
`run + short(hash) + z + x + y`, and the response uses a **bounded** browser cache:
`Cache-Control: public, max-age=86400, immutable`. This differs from stored-profile
tiles (`max-age=31536000, immutable`) precisely because a scenario is a temporary
experiment, not a stored official immutable profile. No server-side in-memory tile
cache; no Redis.

## 14. Session-only storage

Scenario UI state (schema version, run id, draft weights, applied weights, comparison
profile, scenario hash, last selected candidate id) is persisted **only** in
`sessionStorage` under `waste-equity:suitability-scenario:v1`. On restore the schema,
weights, run id, and comparison-profile availability are validated; invalid state is
discarded; the active run changing discards it. A restored draft is **never** shown
as a current result — the user must re-apply (a fresh preview request). No
localStorage, cookies, DB, server-side session, or URL query parameters.

## 15. No database persistence / no migration

No tables, columns, or migration are added. Migration head remains **0016**. All
scenario results are computed on read from existing immutable rows.

## 16–18. Separation from stored profiles / CRITIC / stability

* `SuitabilityProfile` still means only `baseline / equal / equity_focused /
  access_focused / critic`; a user scenario is a **separate** type and is never added
  to `policy.SUPPORTED_PROFILES`, `STATIC_WEIGHT_PROFILES`, `DATA_DERIVED_PROFILES`,
  or `weight_profiles`.
* Not included in CRITIC derivation and never overwrites the CRITIC vector.
* Not part of stored stability: `stable_count` / `stability_class` /
  `stability_membership` / `stable_count` are shown **as-is from the stored run** and
  labelled as such ("저장된 run 기준이며 사용자 시나리오의 안정성 평가가 아닙니다"). Changing
  custom weights does **not** recalculate stability.

## 19. Security and parameter binding

Every user-controlled value (run id, weights, profile, top_n, candidate id, z/x/y,
scenario hash) is a **bound** SQL parameter. The only interpolated SQL is a static,
trusted banker's-rounding expression and the fixed source-layer name — never any
user text. POST endpoints are stateless read-only computations (CORS allows GET +
POST).

## 20. Performance findings

The production run has ~47,893 candidates (~17,501 ELIGIBLE). The preview query ranks
the complete ELIGIBLE population in PostgreSQL (weighted score, `row_number`, top-N)
— Python never sorts all rows. Responses are bounded to `top_n ≤ 50`. Existing
run/status + geometry (GiST) indexes are used; **no index is created on a dynamic
weighted expression**. The MVT query filters-before-transform and never globally
ranks. Frontend: slider edits cause **zero** preview requests; one explicit apply
causes **one** preview request; the custom tile source is replaced once per applied
scenario (the tile URL changes → MapView removes + re-adds the vector source); an
`AbortController` + sequence guard ensures an older response can never replace a newer
one and duplicate applies are prevented (Apply disabled during a request).

> Benchmark note: exact production-scale timings are best measured against the
> production run; a disposable local PostGIS test DB (migrated to head 0016) confirms
> functional correctness and cross-path scoring consistency, but does not hold the
> full ~48k-cell population, so it is not a representative latency benchmark.

## 21. Accessibility behavior

One heading hierarchy; a `fieldset`/`legend` for the four weights; each slider and
numeric input has an accessible name; the running total is a polite `role="status"`
live region; the invalid-total state is conveyed in text (not color alone); the
normalization button and preset buttons have descriptive text; the comparison
selector has an associated label; the Apply disabled state is understandable; the
stale-result notice and both disclaimers are always reachable; rank movement is text.
The full workflow is keyboard-operable.

## 22. Mobile behavior

The scenario editor stacks above the map at `< md`; sliders/inputs fit the viewport;
preset buttons wrap; top-candidate rows stay readable; the floating legend stays
compact; no page-level horizontal overflow. Cost view remains full-width and
map-free; landfill unchanged.

## 23. Error semantics

* `INVALID_SCENARIO_WEIGHTS` (422) with `fields` (e.g. `{ sum }`) — surfaced verbatim,
  never flattened to a generic error.
* `PROFILE_NOT_AVAILABLE_FOR_RUN` (400), `RUN_NOT_FOUND` / `NO_ANALYSIS_AVAILABLE`
  (404), `CANDIDATE_NOT_FOUND` / `CANDIDATE_RUN_MISMATCH` (404),
  `SCENARIO_HASH_MISMATCH` / `INVALID_TILE_COORDINATE` (422).
* Loading uses `role="status"`; actionable errors use `role="alert"`. A failed custom
  tile never permanently blocks the map.

## 24. Prohibited terminology

A scenario / its candidates are **never** called: new run, new analysis execution,
saved profile, official profile, CRITIC replacement, optimal scenario, recommended,
approved, final, valid, legally eligible, developable, or optimal sites. ELIGIBLE is
not legal eligibility; EXCLUDED is a `PROJECT_SCREENING_EXCLUSION`.

## 25. Limitations

Not a legal, engineering, environmental-review, permitting, or final siting result.
No adjacent-cell clustering, contiguous-area, parcel-level, DEM/slope, geology,
truck-route, land-ownership, or land/operating/transport-cost integration. Ranking is
only among the fixed run's ELIGIBLE candidates.

## 26. Test coverage

* Backend unit (`tests/test_suitability_scenario.py`): weight parse/validate/canonical,
  hashing determinism + payload, exact scoring, provisional semantics, rank-delta.
* Backend PostGIS integration
  (`tests/test_suitability_scenario_routes_integration.py`): preview ranking/tie-break/
  deltas/no-write/determinism, candidate detail (eligible/review/provisional-unavailable/
  excluded/mismatch/missing/rank-consistency), MVT (scores, hash gating, malformed
  weights, z/x/y, ETag, cache, cross-path score equality), regression (stored summary
  unchanged, head==0016, no scenario tables).
* Frontend unit (`lib/scenario.test.ts`, `lib/api.scenario.test.ts`,
  `components/SuitabilityScenarioLab.test.tsx`, `components/MapLegendOverlay.scenario.test.tsx`,
  `app/page.test.tsx`): validation/normalization/session, POST clients + tile URL +
  structured error fields, the editor/apply/stale/comparison/selection workflow, the
  scenario legend, and score→scenario→cost navigation with a single MapView.
* Playwright (`e2e/scenario.spec.ts`, self-mocked): the full edit → normalize → apply →
  select → navigate workflow, canonical-weight payload, mobile layout, accessibility.

## 27. Deployment status

Implemented and merged to `main`. **Not deployed to OCI.** No production migration is
introduced, no ingestion is run, no new official suitability run is created, and the
latest production run (48) is unchanged. User scenarios are never persisted.
