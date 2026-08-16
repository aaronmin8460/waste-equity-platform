# Suitability V3 Compatibility Audit

> **Status: read-only architecture/compatibility audit. No runtime code, schema,
> migration, test, or frontend file was modified by this audit — this document is
> the only artifact it produced.**
>
> Audited at `research/suitability-v3-contract-audit` @ `5148caa058b305e355100700bd85e534370b81c7`.
> Scope: the semantic dependency graph of the historical Z/R/E/D component model
> (`zoning` / `road` / `equity` / `demand`) and the safest **additive** architecture
> for a successor model (`existing_burden` / `air_impact_proxy` / `resident_impact` /
> `land_conversion`).
>
> Nothing in this document is a legal, permitting, engineering, or final-siting
> determination, and nothing here changes what any existing analysis run means.

---

## 1. Executive Recommendation

The historical four-factor model is not "four columns". It is a **semantic contract
replicated across eleven independent surfaces** — a Python policy registry, a second
duplicated registry inside CRITIC, four fixed SQL columns, hand-written SQL fragments
with positional bind names (`:wz/:wr/:we/:wd`), five Pydantic DTOs, an MVT tile
property set, a TypeScript union type, a Korean glossary with single-letter codes
(Z·R·E·D), three separately-versioned browser-state schemas, and roughly forty test
files. Any successor model that reaches production without addressing all eleven will
either corrupt the meaning of historical runs or silently present successor numbers
under historical names.

**The recommendation, in one paragraph.** Adopt the **hybrid persistence model
(Option D)**: leave the four legacy `*_score` columns permanently in place and
permanently untouched as the storage for the historical model, and add a
version-aware `component_scores` JSONB column that successor and all future models
write to; make the analysis run self-describing by adding an explicit
`component_model_version` **and** `component_order` to `suitability_analysis_runs`.
Serve both shapes additively from the API — legacy keys stay populated for historical
runs and are emitted as explicit `null` for successor runs, never reused — and bump
exactly four identifiers: the new `component_model_version`, `policy_version`,
`derivation_version`, and the three client-side schema versions that carry weights
(`URL_STATE_VERSION`, `SAVED_SCENARIO_SCHEMA_VERSION`, `SCENARIO_SESSION_SCHEMA`) plus
`USER_WEIGHT_SCENARIO_METHOD_VERSION`. Do **not** bump `candidate_grid_version`,
`CRITIC_METHOD_VERSION`, or `STABILITY_METHOD_VERSION` unless the specific conditions
in §16 are met. Two additive Alembic migrations are required (`0022`, `0023`); no
backfill of any score, rank, weight, or classification is needed or permitted.

**The three findings that most change the plan:**

1. **`policy_version` cannot answer "which components produced this run?"** It has
   already been bumped once (`v1` → `v2`) for a reason completely unrelated to
   component identity — `policy.py:26-31` states plainly that the v2 bump reflects
   "the new profile-derivation and candidate-output surface" while "the
   component-score formulas … are byte-for-byte unchanged". A version that moves for
   non-component reasons cannot be the component-model identifier. A dedicated field
   is required. (§7)

2. **`GET /api/v1/suitability/candidates` labels every run with the *running code's*
   version constants, not the run's own.** `suitability.py:738-740` returns
   `policy.DERIVATION_VERSION` / `policy.POLICY_VERSION` /
   `policy.CANDIDATE_GRID_VERSION`, and the run query at `suitability.py:579` does not
   even select those columns. Today this is latent (one model exists, so the labels
   happen to be right). The moment a successor run exists it becomes an **active
   mislabeling of historical data**: a v2 run's candidate collection would be stamped
   with v3 version strings. Every sibling endpoint (`/summary`, `/candidates/{id}`,
   scenario `/preview`) already reads the run row correctly. This must be fixed
   *before* any successor model ships, and it is the single highest-priority item in
   this audit. (§8, §19-B1)

3. **`_resolve_run_id` picks the latest succeeded run regardless of component model**
   (`suitability.py:208-216`). The frontend has no concept of a component model at
   all. The day the first successor run reaches `SUCCEEDED`, every default view,
   every un-pinned share link, and every saved-scenario re-verification silently
   switches to the new model with no user-visible signal and no client-side guard.
   This is a product-level decision that must be made explicitly, not inherited from
   an `ORDER BY completed_at DESC`. (§19-B2)

**One semantic trap deserves naming up front.** The historical `equity` component is
already labelled in the citizen-facing UI as **"기존 지역 부담"** — literally *existing
regional burden* (`frontend/src/lib/glossary.ts:366-373`). That is the natural Korean
rendering of the successor component `existing_burden`. They are **not** the same
quantity: `equity_score` is an *inverted avoidance* score (`equity_score_from_rank`,
`policy.py:335-338`: lower measured burden → **higher** score), computed at SIGUNGU
resolution from `facility-burden-v1` percentile ranks. Any successor `existing_burden`
that scores in the burden direction is the arithmetic *opposite*. A copy-level or
column-level reuse here would invert the meaning of the map while leaving every number
looking plausible. See §17.

---

## 2. Current Model Architecture

### 2.1 The end-to-end path

```
DATA
  structural_dataset_versions (zoning / roads / protected, is_active)
  regions (SIDO/SIGUNGU, boundary vintage)
  facility burden (facility-burden-v1, FACILITY_LOCATION_BASED_THROUGHPUT)
  per-capita waste demand (per-capita-v1, ORIGIN_BASED_TREATMENT_OUTCOME)
        │
        ▼
ANALYSIS ENGINE  backend/src/waste_equity_backend/analysis/suitability/
  policy.py   COMPONENTS, STATIC_WEIGHT_PROFILES, score curves, snapshot   [semantic root]
  engine.py   grid build → spatial enrich → per-cell scoring → profiles → CRITIC → stability
  critic.py   CRITERION_ORDER, data-derived weights                        [duplicate registry]
  scenario.py COMPONENT_ORDER, weight validation, canonical hash
        │
        ▼
STORAGE  models/suitability.py + alembic 0010, 0016
  suitability_analysis_runs   (policy/derivation/grid versions, policy_snapshot,
                               weight_profiles, weight_derivation, stability_definition)
  suitability_candidates      (zoning_score, road_score, equity_score, demand_score,
                               profile_totals, profile_ranks, stable_count, …)
        │
        ▼
API  api/routes/suitability.py + suitability_scenarios.py
  /policies  /runs  /runs/latest  /summary  /candidates  /candidates/{id}
  /tiles/{run}/{profile}/{z}/{x}/{y}.mvt
  /scenarios/preview  /scenarios/candidates/{id}  /scenarios/tiles/…
        │
        ▼
SCENARIO / CRITIC / STABILITY
  CRITIC   per-run derived weights, stored in run.weight_profiles.critic + weight_derivation
  Stability per-candidate top-10% membership across (baseline, equal, critic)
  Scenario on-read recombination of frozen component scores; nothing persisted
        │
        ▼
FRONTEND TYPES  frontend/src/lib/api.ts, glossary.ts, scenario.ts, urlState.ts, savedScenarios.ts
        │
        ▼
PAGE 4 (후보지 분석)              PAGE 5 (심층 분석 / 시나리오 비교)
  factor cards, candidate          scenario lab, A/B comparison, ranking analytics,
  summary, map, ranking dialog     candidate comparison
        │
        ▼
EXPORTS / SAVED STATE
  exports.ts (CSV), scenarioExport.ts (XLSX-style), report.ts
  localStorage saved-scenario list · sessionStorage draft · URL query state
```

### 2.2 What each layer is authoritative for

| Layer | Authoritative for | Model-aware today? |
| --- | --- | --- |
| `policy.COMPONENTS` | component identity + order | **is** the model definition |
| `critic.CRITERION_ORDER` | CRITIC vector/matrix order | duplicated literal, not derived |
| `suitability_candidates` columns | per-cell component values | four fixed columns only |
| `suitability_analysis_runs` | run identity + versions | policy/derivation/grid only |
| `policy_snapshot` (JSONB) | human-readable policy at run time | weights present; **order not recoverable** |
| Pydantic DTOs | wire contract | four fixed optional string fields |
| MVT tile | map attributes | four fixed columns, unused by styling |
| `glossary.ts` | citizen-facing names + Z·R·E·D codes | four-member union type |
| Browser state (×3) | user weights | four fixed keys, three schema versions |

A note on `policy_snapshot`: it records each profile's weights as a JSON object, so
the component *names* survive. It does **not** preserve component *order*, because
PostgreSQL `JSONB` does not preserve object key order. Component order is therefore
**not recoverable from any stored artifact today** — it exists only as a tuple literal
in source. This is the concrete reason §7 recommends storing `component_order`
explicitly rather than deriving it.

---

## 3. Semantic Dependency Graph

Read this as: *if the component set changes, everything downstream of the arrow must
be re-derived or explicitly version-gated.*

```
policy.COMPONENTS ("zoning","road","equity","demand")
├─→ policy.STATIC_WEIGHT_PROFILES   4 profiles × 4 keys, each summing to exactly 1
│     └─→ policy.validate_policy()  asserts set(weights) == set(COMPONENTS)  [policy.py:409]
│     └─→ policy.WEIGHT_RATIONALE   per-component justification text
│     └─→ policy.PROFILE_METHODOLOGY["critic"]  names 조닝/도로/형평성/수요 in prose
├─→ policy.composite() / provisional_composite()   iterate COMPONENTS
├─→ critic.CRITERION_ORDER          DUPLICATED literal (critic.py:23), not imported
│     ├─→ CRITIC means / std devs / correlation matrix / information values / weights
│     ├─→ CriticResult.metadata()   serialized into run.weight_derivation
│     └─→ critic.NORMALIZATION      assumes policy-fixed [0,100] BENEFICIAL direction
├─→ engine scoring loop             component_scores dict keyed by component
│     ├─→ completeness gate         set(component_scores) != set(COMPONENTS) → REVIEW  [engine.py:754]
│     ├─→ four fixed insert columns [engine.py:1033-1036, 1056-1057, 1074-1077]
│     ├─→ profile_totals / profile_ranks   per profile, over the component vector
│     └─→ CRITIC population rows    [engine.py:942]
├─→ stability                       membership over profile_ranks (baseline/equal/critic)
│     └─→ stable_count / stability_class / stability_membership
├─→ scenario.COMPONENT_ORDER = policy.COMPONENTS   (correctly derived)
│     ├─→ parse_and_validate_weights()  EXACT four-key requirement  [scenario.py:165-177]
│     ├─→ canonical_weight_strings()    fixed order
│     └─→ canonical_hash_payload()      → scenario_hash (SHA-256)
├─→ DB columns  zoning_score / road_score / equity_score / demand_score
│     ├─→ MVT _TILE_SQL              [suitability.py:165-168]
│     ├─→ /candidates SELECT          [suitability.py:665, 708-717]
│     ├─→ /summary top + top_stable   [suitability.py:381-384, 394-395, 440-443, 453-454]
│     ├─→ /candidates/{id}            [suitability.py:879-882]
│     └─→ scenario SQL fragments      [suitability_scenarios.py:80-95]
│           ├─→ _RAW_SCORE_SQL        weighted sum, :wz/:wr/:we/:wd
│           ├─→ _PROV_NUM/_DEN_SQL    provisional renormalization
│           ├─→ _PREVIEW_SQL          completeness WHERE + ranking ORDER BY
│           ├─→ _CANDIDATE_RANK_SQL   single-candidate rank
│           └─→ scenario MVT SQL
├─→ Pydantic DTOs
│     ├─→ CandidateProperties         [schemas/suitability.py:125-128]
│     ├─→ CandidateDetailOut          [schemas/suitability.py:186-189]
│     ├─→ SuitabilitySummaryOut       top_candidates / top_stable_candidates (untyped dicts)
│     ├─→ UserScenarioTopCandidate    [schemas/scenario.py:68-71]
│     └─→ UserScenarioCandidateDetailOut  [schemas/scenario.py:98-101]
└─→ FRONTEND
      ├─→ api.ts                     4 typed fields × 3 DTOs + ScenarioWeights + tile URL builder
      ├─→ glossary.ts                ScoreComponent union, COMPONENT_META, COMPONENT_ORDER,
      │                              codeWithName() → "용도지역 호환성(Z)" etc.
      ├─→ scenario.ts                SCENARIO_COMPONENTS, percent↔decimal conversion,
      │                              sessionStorage draft (SCENARIO_SESSION_SCHEMA = 1)
      ├─→ savedScenarios.ts          WEIGHT_KEYS, isCanonicalWeights(), localStorage list
      │                              (SAVED_SCENARIO_SCHEMA_VERSION = 1)
      ├─→ urlState.ts                ScenarioWeights, wz/wr/we/wd params (URL_STATE_VERSION = "1")
      ├─→ exports.ts / scenarioExport.ts / report.ts    CSV/XLSX headers + weight rows
      └─→ components                 SuitabilityFactorCards, SuitabilityCandidateSummary,
                                     SuitabilityScenarioLab, page5 analysis sections
```

**Two structural observations.**

*The registry is duplicated once.* `critic.py:23` re-declares the tuple literally
instead of importing `policy.COMPONENTS`. `scenario.py:55` does it correctly
(`COMPONENT_ORDER: tuple[str, ...] = policy.COMPONENTS`). Under a single model this
drift is invisible; under two models it is a silent-divergence hazard, because CRITIC
would keep computing over the historical criteria while the engine scores the
successor ones.

*The completeness gate is set-based, not count-based.* `engine.py:754` uses
`set(component_scores) != set(policy.COMPONENTS)`, which generalizes correctly to any
component set. This is one of the few genuinely model-agnostic pieces of logic in the
pipeline and should be preserved as-is.

---

## 4. Hard-Coded Four-Factor Assumptions

Classified by *kind*, because the remediation differs sharply per kind. "Semantic"
means the code would produce wrong analytical meaning; "presentation" means it would
produce wrong words but not wrong numbers.

### 4.1 Semantic hard-coding (must be version-gated — wrong numbers or wrong meaning)

| Location | Assumption |
| --- | --- |
| `policy.py:72` | `COMPONENTS` tuple — the model definition itself |
| `policy.py:78-103` | four static profiles, each with exactly four keys |
| `policy.py:151-156` | `WEIGHT_RATIONALE` keyed by component |
| `policy.py:407-412` | `validate_policy()` asserts every profile weights exactly `COMPONENTS` |
| `policy.py:369, 385-391` | `composite` / `provisional_composite` iterate `COMPONENTS` |
| `critic.py:23` | **duplicated** `CRITERION_ORDER` literal |
| `critic.py:30` | `NORMALIZATION` assumes policy-fixed `[0,100]` **beneficial-direction** scores |
| `engine.py:696, 719, 741, 746` | per-component assignment into `component_scores` |
| `engine.py:754` | completeness gate (set-based — generalizes cleanly) |
| `engine.py:777-779, 819-822` | first-class per-component extraction for the insert |
| `engine.py:942` | CRITIC population row construction |
| `scenario.py:165-177` | **exact four-key** weight validation, no unknown keys |
| `scenario.py:247-261` | canonical hash payload — weights in fixed component order |
| `suitability_scenarios.py:80-95` | `_RAW_SCORE_SQL`, `_PROV_NUM_SQL`, `_PROV_DEN_SQL` |
| `suitability_scenarios.py:143-147, 172-176` | completeness `WHERE … IS NOT NULL` × 4 |
| `suitability_scenarios.py:269-273` | `_weight_params` → `:wz/:wr/:we/:wd` |

### 4.2 Database hard-coding (schema shape)

| Location | Assumption |
| --- | --- |
| `models/suitability.py:150-153` | four fixed `Numeric(7,4)` score columns |
| `alembic/…0010_suitability_analysis.py:90-93` | the migration that created them |
| `engine.py:1033-1036, 1056-1057, 1074-1077, 1102, 1112` | staging temp table + INSERT column list |

Note what is **not** database hard-coding: `profile_totals`, `profile_ranks`,
`stability_membership`, `weight_profiles`, `weight_derivation`, and `policy_snapshot`
are already `JsonVariant` (JSONB on PostgreSQL, JSON on SQLite —
`models/suitability.py:44`) and are structurally indifferent to the component set.
The project has therefore **already proven** the version-aware JSON pattern in
production for the closely analogous per-profile data. This is the strongest single
argument for Option D in §5.

### 4.3 API schema hard-coding (wire contract)

| Location | Assumption |
| --- | --- |
| `schemas/suitability.py:125-128` | `CandidateProperties` four optional strings |
| `schemas/suitability.py:186-189` | `CandidateDetailOut` four optional Decimals |
| `schemas/scenario.py:68-71` | `UserScenarioTopCandidate` |
| `schemas/scenario.py:98-101` | `UserScenarioCandidateDetailOut` |
| `routes/suitability.py:165-168` | MVT SQL emits four tile properties |
| `routes/suitability.py:665, 708-717` | `/candidates` SELECT + response mapping |
| `routes/suitability.py:381-384, 394-395, 440-443, 453-454` | `/summary` top-candidate dicts |
| `routes/suitability.py:879-882` | `/candidates/{id}` |
| `suitability_scenarios.py:315-323` | `_relative_tile_url` → `?wz=&wr=&we=&wd=` |
| `docs/SUITABILITY_VECTOR_TILES.md:92` | documented tile property contract |

`SuitabilitySummaryOut.top_candidates` and `top_stable_candidates` are typed
`list[dict[str, Any]]`, so the four keys are hard-coded in the *route construction*
rather than the schema. They are therefore invisible to schema-level review — a
maintenance hazard worth noting during implementation.

### 4.4 Presentation-only hard-coding (wrong words, not wrong numbers)

| Location | Assumption |
| --- | --- |
| `glossary.ts:331` | `ScoreComponent` union type |
| `glossary.ts:335` | `code: "Z" \| "R" \| "E" \| "D"` |
| `glossary.ts:349-381` | `COMPONENT_META` — Korean labels + explanations |
| `glossary.ts:384` | `COMPONENT_ORDER` display order |
| `glossary.ts:395-398` | `codeWithName()` |
| `glossary.ts:670, 706-710` | secondary label maps |
| `scenario.ts:16-17, 28-53` | `SCENARIO_COMPONENTS`, `SCENARIO_COMPONENT_META` |
| `scenarioExport.ts:91-94` | XLSX headers `용도지역 호환성(Z)` … |
| `scenarioExport.ts:120-121` | scenario description sentence |
| `exports.ts:191-194, 216-219` | CSV weight rows + header row |
| `report.ts:350` | report weight table |
| `SuitabilityFactorCards.tsx:52-55` | detail → factor-card mapping |
| `SuitabilityCandidateSummary.tsx:62-65, 229, 260` | summary mapping + two prose sentences |

The single-letter codes are presentation, but they are **not** cosmetic: `Z/R/E/D`
appear in exported CSV/XLSX headers that leave the system, so a code collision
survives outside the app. See §17.

### 4.5 Test-fixture hard-coding

| Surface | Files |
| --- | --- |
| Backend unit/integration | `test_suitability_policy.py`, `test_suitability_scoring.py`, `test_suitability_routes.py`, `test_suitability_routes_integration.py`, `test_suitability_scenario_routes_integration.py`, `test_suitability_scope_filters_integration.py`, `test_suitability_stability.py`, `test_suitability_critic.py`, `test_suitability_scenario.py` |
| E2E mock backend | `frontend/e2e/mockBackend.ts` (27 references), `frontend/e2e/suitabilityFixtures.ts:65, 112-115, 141` |
| Playwright specs | `citizenFlows`, `page4cRankingDialog`, `page4dScenarios`, `page5aComparison`, `page5bRankingAnalytics`, `page5cCandidateComparison`, `page5Integration` |
| Frontend unit | ~20 files, headed by `SuitabilityScenarioLab.test.tsx` (28), `page.suitabilityDashboard.test.tsx` (28), `scenarioCandidateComparison.test.ts` (27) |

### 4.6 Explicitly *not* a four-factor assumption

These look like four-factor coupling and are not. Misclassifying them would cause
unnecessary and risky churn:

- **`stable_count == 3`** (`engine.py:874`, `suitability.py:458`, `MapView.tsx:408,440`,
  `scenarioExport.ts:72`). This is the count of **stability profiles**
  (`baseline`, `equal`, `critic`), not components. It stays `3` under any component
  model, provided `STABILITY_PROFILES` keeps three members.
- **`Numeric(7,4)` / 4-dp quantization** (`policy.py:283`). Score precision, unrelated
  to component count.
- **`engine.py:754`'s set comparison.** Already generalized.
- **`profile_totals` / `profile_ranks` JSONB.** Keyed by *profile*, not component.

---

## 5. Persistence Alternatives

Baseline facts used in the comparison below: ~48,000 candidate rows per run; component
scores appear in **no** `WHERE` or `ORDER BY` clause of the stored-run read API (verified
across `/candidates`, `/summary`, `/candidates/{id}`, MVT — they are `SELECT`-list only);
they **do** appear in the scenario path's completeness predicate and in the expression
that feeds the ranking `ORDER BY` (`suitability_scenarios.py:118-162`); `JsonVariant`
(JSONB/JSON) is already in production use on both tables; SQLite backs the unit tests
and PostGIS backs the integration tests.

### Option A — Add four successor fixed columns

| Dimension | Assessment |
| --- | --- |
| Historical integrity | **Excellent.** Legacy columns untouched. |
| Migration risk | **Very low.** Four nullable `ADD COLUMN`s; metadata-only in PG11+. |
| PostgreSQL | Native, trivial. |
| SQLite test support | Native, trivial. |
| Candidate list perf | **Best.** Direct column reads. |
| Rank/filter perf | Unchanged (components are not predicates on this path). |
| Candidate detail | Simple, but the DTO grows to 8 fields of which 4 are always null. |
| API compatibility | Easy additively; invites "which four are real?" ambiguity at every call site. |
| MVT | 8 tile properties, half always null — wasted tile bytes on every cell. |
| Exports | Doubles the header set or requires per-model branching anyway. |
| Scenario recomputation | Requires a second parallel set of SQL fragments and bind names. |
| CRITIC / stability | Requires model-branching in the criteria loop. |
| Future evolution | **Poor.** A v4 model means twelve columns; the schema becomes a permanent ledger of every model generation ever shipped. |
| Developer complexity | Low today, compounding badly. |

**Verdict: rejected**, but not because it is unsafe — it is the *safest* option
mechanically. It is rejected because it does not generalize, it doubles the null
surface on the hottest read path (MVT), and — most importantly — eight parallel
same-shaped columns is precisely the layout that invites the positional-mapping error
this audit is chartered to prevent.

### Option B — Version-aware JSON/JSONB `component_scores` (replacing columns)

| Dimension | Assessment |
| --- | --- |
| Historical integrity | **Unacceptable *if* it migrates legacy rows out of their columns.** That is a destructive rewrite of historical analytical results. |
| Migration risk | High if backfilled; nil if not. |
| PostgreSQL | Excellent — JSONB is proven here already. |
| SQLite test support | Proven (`JsonVariant`, `models/suitability.py:44`). |
| Candidate list perf | Slightly worse: 4 `->>` extracts + casts per returned row (bounded by `LIMIT`, ≤5000). Negligible. |
| Rank/filter perf | Unchanged — components are not predicates on this path. |
| Candidate detail | Simple; one uniform map. |
| API compatibility | Clean generic contract; **breaks** every existing client if legacy keys disappear. |
| MVT | Requires per-model property expansion in SQL, or a generic JSON property (which MapLibre cannot style on). |
| Exports | Clean and generic. |
| Scenario recomputation | Full-population expression over JSONB extracts on ~48k rows — measurable but small; no index available for a user-supplied weight vector regardless of storage. |
| CRITIC / stability | Clean and generic. |
| Future evolution | **Excellent.** |
| Developer complexity | Moderate; loses column-level typing and NOT NULL guarantees. |

**Verdict: rejected as a wholesale replacement, adopted as the successor-side half of
Option D.** The fatal flaw is only the migration of *existing* rows. Applied to
successor runs alone, every strength survives and the flaw disappears.

### Option C — Normalized child table `candidate_component_scores`

| Dimension | Assessment |
| --- | --- |
| Historical integrity | Good if legacy rows are not moved; the same "don't backfill" rule applies. |
| Migration risk | Moderate — new table, FK, composite unique constraint, indexes. |
| PostgreSQL | Fine. |
| SQLite test support | Fine, but every fixture that builds a candidate now builds 4–5 extra rows. |
| Candidate list perf | **Worst.** ~192,000 child rows per run; a 500-row page needs a join + aggregate or a pivot. |
| Rank/filter perf | Fine on the stored path (not a predicate), poor if ever needed. |
| Candidate detail | Extra query or join for one candidate — acceptable. |
| API compatibility | Requires pivoting back to a map at every serializer. |
| MVT | **Severe.** `ST_AsMVT` needs a flat row; a lateral pivot inside the tile query on the hot map path is a real regression against the existing filter-before-transform design (`suitability.py:141-180`). |
| Exports | Requires pivot. |
| Scenario recomputation | Join + conditional aggregate over ~192k rows per preview, replacing four direct column reads. Clear regression. |
| CRITIC / stability | Requires pivot to build the criteria matrix. |
| Future evolution | Excellent in the abstract. |
| Developer complexity | **Highest.** Every read path gains a pivot. |

**Verdict: rejected.** It is the most normalized model and the worst operational fit.
The read patterns here are overwhelmingly "give me this cell's whole vector" — the
exact shape a document column serves best and a child table serves worst. The MVT
path alone disqualifies it.

### Option D — Hybrid: legacy fixed columns retained + version-aware representation for successors

| Dimension | Assessment |
| --- | --- |
| Historical integrity | **Best available.** Historical rows are bit-identical forever; no statement about them is rewritten. |
| Migration risk | **Very low.** Two additive migrations, constant server defaults, metadata-only `ADD COLUMN` in PG11+. |
| PostgreSQL | JSONB, already proven on both tables. |
| SQLite test support | `JsonVariant` already proven. |
| Candidate list perf | Historical: unchanged. Successor: 4 extracts per returned row, `LIMIT`-bounded. |
| Rank/filter perf | Unchanged for both — the indexed `rank` column and `profile_totals`/`profile_ranks` JSONB carry the entire ranking/filtering contract, and neither involves component columns. |
| Candidate detail | One model-selected branch in the serializer. |
| API compatibility | **Fully additive.** Legacy keys keep working for legacy runs; new generic map serves both. |
| MVT | Historical tiles byte-identical. Successor tiles expand the JSONB into named properties in SQL — same shape, same source-layer, same cache semantics. |
| Exports | Model-driven headers; historical exports reproducible unchanged. |
| Scenario recomputation | Two SQL variants (legacy columns / JSONB extracts), selected by the run's model. Honest duplication, bounded to one module. |
| CRITIC / stability | Criteria order read from the run; math untouched. |
| Future evolution | **Excellent** — v4 needs zero schema change. |
| Developer complexity | Moderate: one branch point per read path, and a permanent legacy code path that must never be deleted. |

**Verdict: recommended.**

---

## 6. Recommended Persistence Architecture

### 6.1 The design

**Run level — `suitability_analysis_runs` gains two columns:**

```
component_model_version : String(50)  NOT NULL
      server_default 'suitability-components-zred-v1'
component_order         : JsonVariant NOT NULL
      server_default '["zoning","road","equity","demand"]'
```

**Candidate level — `suitability_candidates` gains one column:**

```
component_scores : JsonVariant NOT NULL  server_default '{}'
      {component_name: "decimal string"}   — successor and all future models
      {}                                    — historical zred-v1 rows (unchanged)
```

**Write rules:**

- Historical runs: **nothing is written, nothing is backfilled.** Their four legacy
  columns remain the sole and authoritative storage. `component_scores` stays `{}`.
- Successor runs: `component_scores` is populated; the four legacy columns are written
  `NULL` and are never reused for any successor quantity.
- The two run-level defaults are a **labelling** statement, not a semantic rewrite:
  the `suitability_candidates` table physically cannot hold any model other than
  Z/R/E/D today, so stamping every existing run `zred-v1` records a fact that is
  already true rather than asserting a new one. This is the same discipline migration
  `0016` used when it defaulted `weight_derivation` / `stability_definition` to `{}`
  rather than inventing CRITIC results for pre-CRITIC runs.

### 6.2 Why this and not the alternatives

**Because the project has already validated this exact pattern.** `profile_totals`,
`profile_ranks`, `weight_profiles`, `weight_derivation`, `stability_definition`, and
`stability_membership` are all `JsonVariant` maps carrying analytically significant,
exactly-quantized decimal strings, on both PostgreSQL and SQLite, on these same two
tables. Option D introduces no new storage technique — it applies the established one
to a new axis.

**Because the hot paths do not touch component columns.** The read API's ranking and
filtering contract runs entirely on the indexed `rank` column, `profile_totals`, and
`profile_ranks`. Component scores are `SELECT`-list payload. Moving successor
components to JSONB therefore costs nothing where cost would matter.

**Because it is the only option that makes "don't reuse the old fields" structurally
enforceable.** Under Option A, `land_conversion` and `zoning_score` are two adjacent
`Numeric(7,4)` columns on the same row and nothing but discipline stops a future
change from cross-wiring them. Under Option D the successor model has no column to be
cross-wired into: legacy columns are `NULL` for successor runs, and a `NULL` cannot be
silently mistaken for a score.

**Because historical interpretability is preserved indefinitely and *literally*.** A
v2 run's row is byte-identical after this change. The audit's governing requirement —
"the historical model must remain interpretable indefinitely" — is met by not touching
it, which is strictly stronger than migrating it faithfully.

### 6.3 Honest costs

1. **A permanent dual read path.** Every serializer that emits component scores needs
   a model branch. This is real, ongoing complexity that can never be removed while
   historical runs are served. It should be centralized in exactly one helper
   (e.g. a `component_scores_for(run, candidate) -> dict[str, str]` accessor used by
   every route) rather than repeated at eight call sites.

2. **Scenario ranking over JSONB.** For successor runs, `_RAW_SCORE_SQL` becomes four
   `(component_scores->>'name')::numeric` extracts, and the completeness `WHERE`
   becomes four JSONB null checks, evaluated across the full eligible population per
   preview. No index helps a *user-supplied* weight vector under any storage design,
   so the comparison is extract-vs-column-read on ~48k rows — expected to be a small
   constant factor, but it **must be measured on real PostGIS data before rollout**,
   not assumed. If it regresses materially, the mitigation is a PostgreSQL generated
   column or an expression index per component — additive, and decidable later.

3. **Loss of column-level typing for successor scores.** `Numeric(7,4)` enforced range
   and precision at the database boundary; a JSONB string does not. The engine already
   quantizes through `policy.quantize_score` and serializes with `str()`, so the
   invariant is upheld in Python, but the database no longer double-checks it. A
   run-level validation step asserting every stored component string re-parses to a
   4-dp `Decimal` in `[0,100]` is recommended compensation.

---

## 7. Analysis-Run Versioning

### 7.1 The question a stored run must answer

> *"What component model produced this run?"*

Today the answer must be inferred from `policy_version` plus tribal knowledge. That is
insufficient, for a documented reason.

### 7.2 Why existing versioning is not enough

**`policy_version` is already overloaded.** `policy.py:26-31` records that the
`v1 → v2` bump happened for the CRITIC profile and stability output surface, while
"the component-score formulas … are byte-for-byte unchanged". So `policy_version`
moves for reasons that have nothing to do with component identity. A reader in 2030
holding `suitability-policy-v2` cannot conclude anything about which components exist —
they would have to consult the source at that revision.

**`derivation_version` is likewise overloaded** (`policy.py:33-36`: bumped for CRITIC +
stability derivation, components unchanged).

**`candidate_grid_version` is orthogonal** — it describes geometry, not scoring.

**`policy_snapshot` is close but not sufficient.** It contains `weight_profiles`, whose
per-profile keys *are* the component names, so a determined reader can recover the
component **set**. It cannot recover the component **order**, because JSONB does not
preserve object key order — and order is load-bearing for the CRITIC correlation
matrix, the scenario hash payload, and every export column sequence. It also requires a
reader to reason through a nested snapshot to answer a first-order question.

### 7.3 Recommendation

**Add a dedicated `component_model_version` field.** Recommended over the alternatives
because:

- vs. `scoring_model` — too broad; the run already has policy/derivation versions that
  describe scoring, and a third broad name invites overlap.
- vs. `component_schema_version` — suggests a *serialization* schema (the shape of the
  JSON), which is a genuinely different axis. If the storage envelope ever changes
  without the components changing, that is what `component_schema_version` would mean.
  Conflating the two now would repeat exactly the overloading mistake `policy_version`
  already made.
- `component_model_version` names precisely the thing that must be unambiguous: *which
  set of measured quantities, with which meanings and directions, produced these
  scores.*

**Also add `component_order`** (JSONB list), for the reason in §7.2 — order is not
recoverable from any existing artifact, and the run must stay interpretable without
the code (which is the stated purpose of `policy_snapshot`,
`models/suitability.py:85-87`).

**Suggested values:** `suitability-components-zred-v1` for every existing run;
`suitability-components-v3` (or a name encoding the four successor components) for
successor runs. The historical identifier should name the components it describes, not
merely say "v1", so that the label is self-explanatory at a glance.

**Extend `policy_snapshot()`** to include `component_model_version`, `component_order`,
and a per-component `direction` (`beneficial` / `cost`) plus `scale`. The direction
field is not decoration: `critic.py:30` currently *assumes* beneficial direction across
all criteria, and a successor `air_impact_proxy` may well be cost-direction (§19-B3).
Recording direction per component makes that assumption auditable instead of implicit.

**Add `component_model_version` to `_analysis_signature`'s payload**
(`engine.py:238-253`). It is currently absent, and while `policy_version` would in
practice change alongside a component-model change, the signature is the run's
idempotency key and must not depend on a *convention* that two versions always move
together. Adding it makes model identity a signed input. Note this changes future
signatures only; existing signatures are already computed and stored and are not
recomputed.

**Backfill classification: labelling, not semantic.** Setting
`component_model_version = 'suitability-components-zred-v1'` and the matching
`component_order` on existing rows via a constant `server_default` states what those
rows already are. No score, rank, weight, classification, status, reason, or geometry
is read or written. This satisfies "historical result semantics must not require
destructive backfill" — nothing is destroyed and no semantics change.

---

## 8. API Compatibility Contract

### 8.1 How the four scores are exposed today

| Endpoint | Exposure | Version labelling |
| --- | --- | --- |
| `GET /policies` | not per-candidate; serves `weight_profiles`, `weight_rationale`, `zoning_registry` — all component-keyed | **live module constants** (correct — it describes the *current* policy, not a run) |
| `GET /runs`, `/runs/latest` | no component scores; serves `weight_profiles` (component-keyed) | run row ✅ |
| `GET /summary` | `top_candidates[]` and `top_stable_candidates[]` carry the four keys as strings (`suitability.py:381-384, 440-443`) | run row ✅ |
| `GET /candidates` | `CandidateProperties` — four optional strings | ❌ **live module constants** (`suitability.py:738-740`) |
| `GET /candidates/{id}` | `CandidateDetailOut` — four optional Decimals | run row ✅ (`suitability.py:826, 904-906`) |
| `GET /tiles/{run}/{profile}/{z}/{x}/{y}.mvt` | four tile properties (`suitability.py:165-168`) | none in payload (URL carries run + profile) |
| `POST /scenarios/preview` | `UserScenarioTopCandidate` × N — four keys | run row ✅ (`suitability_scenarios.py:557-559`) |
| `POST /scenarios/candidates/{id}` | `UserScenarioCandidateDetailOut` — four keys + `contributions[]` | run row ✅ |
| `GET /scenarios/tiles/…` | same four properties; weights via `?wz&wr&we&wd` | none in payload |

**The `/candidates` defect in detail.** The run query at `suitability.py:576-586`
selects only `reference_year, weight_profiles`; the response at `suitability.py:738-740`
then fills `derivation_version` / `policy_version` / `candidate_grid_version` from
`policy.*`. Requesting a historical run's candidates while running successor code
would return that run's genuine scores stamped with the successor's version strings.
Every other run-scoped endpoint already does this correctly, so the fix is a
three-line alignment — but it is a **precondition** for shipping any second model, not
a follow-up.

### 8.2 Evaluation of the four proposed contract shapes

| Shape | Verdict |
| --- | --- |
| **Additive generic component map** | Necessary but insufficient alone. `component_scores: {name: string}` serves any model uniformly, but on its own a client cannot tell *which* model it received, so it can still render successor numbers under historical labels held in its own glossary. |
| **Version-specific DTO** (`/v3/candidates` or `CandidatePropertiesV3`) | Rejected as the primary mechanism. The real hazard is one endpoint serving runs of *mixed* models, which a URL-level split does not solve unless the split is per-run — and it is not, because the run is a query parameter. It also doubles a surface that already has nine endpoints. |
| **Legacy fields + `component_scores`** | The right storage-to-wire mapping, and safe *only when* the legacy fields are hard-`null` for successor runs. Without that rule it is the most dangerous option in the list. |
| **Explicit model metadata** | Mandatory. `component_model_version` + `component_order` on every candidate-bearing response is what turns the generic map from "a map of numbers" into "a map of *known* quantities". |

### 8.3 Recommended contract

**Adopt all three of: legacy fields + generic component map + explicit model metadata.**

Add to `SuitabilitySummaryOut`, `SuitabilityCandidateCollection`, `CandidateDetailOut`,
`UserWeightScenarioPreviewOut`, and `UserScenarioCandidateDetailOut`:

```
component_model_version : str
component_order         : list[str]
```

Add to `CandidateProperties`, `CandidateDetailOut`, `UserScenarioTopCandidate`,
`UserScenarioCandidateDetailOut`, and each `top_candidates` / `top_stable_candidates`
dict:

```
component_scores : dict[str, str | None]     # keyed by component name
```

**Historical (`zred-v1`) response behaviour**

- Legacy keys `zoning_score` / `road_score` / `equity_score` / `demand_score`:
  populated exactly as today. Byte-identical to the current contract.
- `component_scores`: mirrors the same four values under the same names. A dual
  emission, not a second source of truth — both are read from the same four columns.
- `component_model_version`: `"suitability-components-zred-v1"`.
- No existing client breaks. No existing field changes meaning.

**Successor response behaviour**

- Legacy keys: **present and explicitly `null`.** Not omitted — an omitted key
  invites a client to fall back to a default, while an explicit `null` renders as
  "자료 없음" through the existing null-handling every one of these fields already has.
  Never reused for a successor quantity under any circumstance.
- `component_scores`: the successor components, keyed by their own names.
- `component_model_version`: the successor identifier.

**Error contract**

- Add `COMPONENT_MODEL_MISMATCH` (422) to the scenario endpoints, raised when the
  submitted weight keys do not match the resolved run's `component_order`. This must
  be a **distinct code** from the existing `INVALID_SCENARIO_WEIGHTS`
  (`scenario.py:65`), because the client remediation differs completely: malformed
  weights are a correctable input error, whereas a model mismatch means *this scenario
  cannot be applied to this run at all*. Collapsing them would push the UI toward
  "fix your weights", which is the wrong instruction and nudges toward remapping.
- Model this on the existing `PROFILE_NOT_AVAILABLE_FOR_RUN` pattern
  (`suitability.py:118-124`), which already solves the structurally identical problem
  of "this run does not carry that analytical artifact" — and solves it by refusing
  rather than fabricating.

**MVT contract.** Keep the source-layer name `candidates` and the existing property
names for historical runs (documented at `docs/SUITABILITY_VECTOR_TILES.md:81-101`).
For successor runs, expand `component_scores` into named tile properties in SQL. This
is low-risk: the map styles only on `score`, `status`, `stable_count`, and
`sigungu_region_code` (`MapView.tsx:308-447`) — it never styles on a component score —
so component properties are inspection payload, and adding or renaming them cannot
break rendering. Tile cache semantics are unaffected: the URL already embeds an
immutable run, and a run belongs to exactly one component model.

**Export contract.** Component headers must be driven by the response's
`component_order` + a model-scoped label map, never by a module-level constant. A
historical export must remain reproducible with its original headers and its original
Z·R·E·D codes.

---

## 9. Scenario Compatibility

### 9.1 How scenarios store and recombine weights

There are **four** distinct scenario-state surfaces. Their isolation strength differs
sharply, which drives the per-surface recommendation.

| # | Surface | Location | Carries | Model gate today |
| --- | --- | --- | --- | --- |
| 1 | **Backend-persisted scenarios** | *none exist* | — | N/A — scenarios are computed on read and never written (`scenario.py:1-30`) |
| 2 | **sessionStorage draft** | `waste-equity:suitability-scenario:v1`, `SCENARIO_SESSION_SCHEMA = 1` | draft/applied percents, compare profile, scenario hash, selected candidate, `runId` | **Strong** — `scenario.ts:271` discards the whole draft when `s.runId !== runId` |
| 3 | **localStorage saved list** | `waste-equity:suitability-saved-scenarios:v1`, `SAVED_SCENARIO_SCHEMA_VERSION = 1`, cap 20 | `{schemaVersion, id, name, weights, runId, profileSource, timestamps}` | **Weak** — `scenarioRunState()` returns `OTHER_RUN` but the entry is deliberately still shown and its weights still readable (`savedScenarios.ts:219-234`) |
| 4 | **URL query state** | `?v=1&…&wz=&wr=&we=&wd=` | one ad-hoc weight vector + `cmpA`/`cmpB` saved-scenario ids | **Version-gated but not run-bound** — `decodeUrlState` drops everything on `v` mismatch (`urlState.ts:252-256`); `AppUrlState` has **no** `runId` |

Recombination itself: the client sends `{run_id, weights, compare_profile, top_n}` to
`POST /scenarios/preview`; the server validates the weights against an exact four-key
requirement (`scenario.py:165-177`), canonicalizes to 8 dp, computes
`scenario_hash = SHA256({method_version, run_id, canonical weights})`
(`scenario.py:247-272`), and recombines the frozen stored component scores in SQL.
Nothing is persisted server-side.

**Default scenarios** are not stored objects: `scenarioPresets()` (`scenario.ts:167-183`)
derives loadable presets from `run.weight_profiles`, so it already only offers what the
*selected run* actually carries — CRITIC appears only for runs that computed it. This
is correct model-relative behaviour and generalizes to v3 for free.

### 9.2 How the model version is attached today

**It is not.** No surface carries a component-model identifier. Model identity is
currently a *transitive consequence* of `run_id`: a run belongs to one model, so a
run-bound scenario is implicitly model-bound. That inference holds only where the
run binding is actually enforced — surface 2 only. Surfaces 3 and 4 are exposed.

### 9.3 What happens if an old Z/R/E/D scenario is opened against a v3 run

Traced end to end, assuming the successor validation stays key-strict:

- **Surface 2 (draft):** discarded silently at `scenario.ts:271`. **Safe today.**
- **Surface 3 (saved list):** the entry passes `isCanonicalWeights()` (it is
  well-formed Z/R/E/D), is listed, and is marked `OTHER_RUN` with a notice
  (`savedScenarios.ts:95-96`). If the user re-verifies it against the active v3 run,
  the request carries Z/R/E/D keys and the backend returns **422 with `missing` /
  `unknown` field detail** (`scenario.py:167-177`). No mismapping — but the failure
  presents as a generic weight error, and the surviving `INVALID_SCENARIO_WEIGHTS`
  copy would read as "your weights are wrong", not "this scenario belongs to a
  different analytical model".
- **Surface 4 (URL):** with `v=1` still current, `wz/wr/we/wd` decode into
  `ScenarioWeights` and are applied against whatever run is active. Backend rejects
  with the same 422. **The numbers never cross models** — but only because backend
  validation is key-strict, which is a property that must be *deliberately preserved*
  rather than assumed.

**The load-bearing safety property is `scenario.parse_and_validate_weights`'s
rejection of both missing and unknown keys.** It must remain strict, and must become
*run-model-relative* rather than relative to a module constant. If it were ever
loosened to "accept any subset and renormalize", every one of the above safe failures
becomes a silent cross-model recombination.

### 9.4 Recommendation: blocked, isolated, and clearly explained — never migrated

**Blocked**, with a specific, distinguishable reason. A Z/R/E/D scenario applied to a
v3 run must produce `COMPONENT_MODEL_MISMATCH`, not `INVALID_SCENARIO_WEIGHTS`, and
not a renormalized partial result.

**Legacy-only, not deleted.** A saved Z/R/E/D scenario retains full meaning against
its own run. If historical runs remain queryable, the scenario should stay usable
against them and be visibly labelled with its model. The user's saved work is not
invalidated by the existence of a new model — it is *scoped* by it.

**Never auto-migrated.** There is no defensible mapping from a Z/R/E/D weight vector
to a successor weight vector. The components are different measured quantities with
different derivations, resolutions, and possibly different directions.

**Per-surface actions:**

| Surface | Action |
| --- | --- |
| sessionStorage draft | Bump `SCENARIO_SESSION_SCHEMA` → `2`; add `componentModel`. The existing `runId` gate already makes this safe; the bump makes it *explicit* rather than incidental. |
| localStorage saved list | Bump `SAVED_SCENARIO_SCHEMA_VERSION` → `2`; add a `componentModel` field. **See the data-loss warning below.** Gate application on `componentModel === activeRun.component_model_version`; show a distinct legacy badge otherwise. |
| URL | Bump `URL_STATE_VERSION` → `"2"`; rename the weight parameters (below). |
| Backend | Make weight validation run-model-relative; add `COMPONENT_MODEL_MISMATCH`. |

> **Data-loss warning on the saved-scenario bump.** `parseScenario` currently
> **rejects and discards** any entry whose `schemaVersion` is not exactly the current
> constant (`savedScenarios.ts:243`). A naive bump to `2` therefore silently deletes
> every scenario a user has ever saved — up to 20 named entries per browser, with no
> notice. The parser must first be taught to accept `schemaVersion: 1` entries and
> upgrade them in place by stamping `componentModel: "suitability-components-zred-v1"`.
>
> This is **not** "auto-migrating a saved scenario without semantic proof". The proof
> is structural and complete: schema v1's writer (`savedScenarios.ts:440-448`) could
> only ever emit the four Z/R/E/D keys, and `isCanonicalWeights` could only ever admit
> them, so a v1 entry *cannot* represent any other model. Recording the model a record
> demonstrably used is labelling. Translating its weights onto different components
> would be migration — and that is forbidden.

### 9.5 How old URLs should behave

Bumping `URL_STATE_VERSION` to `"2"` makes every pre-existing shared link decode to
`{state: {}, warnings: ["공유 링크의 형식이 달라 일부 설정을 복원하지 못했습니다."]}`
(`urlState.ts:252-256`). The reader lands on defaults with an honest explanation
instead of a mismapped scenario. **This mechanism already exists, is already tested,
and is exactly the right behaviour** — it should be used rather than replaced.

**Additionally, rename the weight parameters.** `wz/wr/we/wd` are positional
abbreviations whose letters are meaningless outside the historical model. The specific
hazard: a successor `existing_burden` abbreviates naturally to `we` — **the exact
parameter that currently means `equity`**. Any partial version gate, any log analysis,
any hand-edited URL, or any third-party integration reading these parameters would
cross the two. Use explicit component-named keys (`w.existing_burden=0.35`) so a
parameter name can never be reinterpreted. New single letters must not be minted.

### 9.6 How Page 5 should determine compatible scenarios

Page 5 must compare **component models**, not run ids. The predicate becomes:

```
compatible ⇔ saved.componentModel === activeRun.component_model_version
```

with `runId` equality remaining a *secondary, softer* signal — as it is today — that
distinguishes "same model, different run" (re-verifiable) from "same model, same run"
(current). Three states result, which the existing two-state UI must grow to
represent:

| State | Meaning | A/B selectable |
| --- | --- | --- |
| `CURRENT_RUN` | same model, same run | yes |
| `OTHER_RUN` | same model, different run | after re-verification (today's behaviour) |
| `OTHER_MODEL` | different component model | **no** — legacy badge, explanation, no re-verify affordance |

Critically, `OTHER_MODEL` must not offer a "re-verify against current run" action at
all. Offering it and then failing with a 422 teaches the user that the scenario is
*broken*, when it is in fact *valid for a different model*.

---

## 10. Browser / URL Compatibility

Consolidated view of the three client-side schema versions, all currently at 1:

| Surface | Constant | Now | Recommended | Behaviour on mismatch |
| --- | --- | --- | --- | --- |
| URL | `URL_STATE_VERSION` (`urlState.ts:39`) | `"1"` | `"2"` | Full drop + Korean warning — already implemented, already correct |
| Saved list | `SAVED_SCENARIO_SCHEMA_VERSION` (`savedScenarios.ts:50`) | `1` | `2` | **Currently discards. Must become upgrade-in-place first** (§9.4) |
| Draft | `SCENARIO_SESSION_SCHEMA` (`scenario.ts:64`) | `1` | `2` | Returns `null`; already additionally run-gated |

Storage keys themselves end in `:v1` (`savedScenarios.ts:47`, `scenario.ts:63`). These
should **not** be bumped to `:v2`. Changing the key orphans the old blob rather than
reading and upgrading it, guaranteeing the data loss described above and leaving dead
bytes in the user's browser forever. Keep the key; version the payload.

Other browser state reviewed and found model-independent: `ResizableSidebar`'s width
preference (`ResizableSidebar.tsx:116-125`). No cookies carry analytical state. No
credentials or tokens are serialized to URL or storage (`urlState.ts:5`).

**Shareable links.** `shareableUrl()` (`urlState.ts:577`) serializes `AppUrlState`,
which contains **no `runId`**. A shared suitability link is therefore *run-relative*:
it resolves against whatever run is latest when opened. Combined with §19-B2 (the
default run flips model silently on first successor success), a link shared before the
switch and opened after it would render a *different analysis entirely* under the same
URL. The `v` bump prevents the weights from being mismapped, but does **not** prevent
the underlying run — and therefore the model — from changing beneath a shared link.
Adding `run` to the URL state, or pinning the served default, is the decision recorded
in §19-B2.

---

## 11. CRITIC Compatibility

### 11.1 Trace

| Stage | Location | Component coupling |
| --- | --- | --- |
| Criterion order | `critic.py:23` | **duplicated literal**, not imported from policy |
| Population selection | `engine.py:940-942` | complete ELIGIBLE rows over `policy.COMPONENTS` |
| Normalization | `critic.py:30, 147` | `score / 100`; assumes policy-fixed `[0,100]` **beneficial** scale |
| Statistics | `critic.py:154-166` | means, population σ, per-criterion |
| Correlation | `critic.py:168-189` | full pairwise matrix over criteria |
| Information + weights | `critic.py:192-234` | `C_j = σ_j · Σ(1 − r_jk)`, normalized, residual to max-information criterion |
| Stored output | `engine.py:992-999` | `run.weight_derivation` + `run.weight_profiles.critic` |
| API | `SuitabilityRunOut.weight_derivation`, `SuitabilitySummaryOut.critic_weights` | per-run, component-keyed |
| Frontend | `scenarioPresets()` (`scenario.ts:167-183`), CRITIC preset in the scenario lab | reads `run.weight_profiles` |

### 11.2 Version boundaries required

**Structural isolation already exists and is strong.** CRITIC output is computed
per-run and stored per-run (`weight_derivation`, `weight_profiles.critic`). There is no
global CRITIC vector, no cache, and no cross-run reuse path. `_ensure_profile_available`
(`suitability.py:106-124`) already refuses `critic` for runs that never computed it,
rather than fabricating a value. Old CRITIC output therefore **cannot** be reused for a
successor run through any existing code path.

**What must be added:**

1. **`critic.CRITERION_ORDER` must stop being a duplicated literal.** It must derive
   from the run's component model. As written, a successor engine would score
   successor components while CRITIC computed over `("zoning","road","equity","demand")` —
   producing a `KeyError` at best (`critic.py:147` indexes `row[c]`) and a silently
   wrong vector if the model sets ever partially overlap. This is the single highest-risk
   line in the CRITIC path.
2. **`weight_derivation` must record `component_model_version`.** It already records
   `criterion_order`, `policy_version`, and `derivation_version`
   (`critic.py:98`, `engine.py:993-995`), so the vector is largely self-describing —
   adding the model identifier closes the gap.
3. **No cross-model comparison in the UI.** A CRITIC vector is a statement about *these
   criteria in this run's data*. Two vectors from different models share no axis and
   must never appear in the same chart, table, or delta.

### 11.3 Is a CRITIC method-version bump required?

**Conditionally — and by default, no.**

The CRITIC *method* is unchanged: same normalization rule, same population σ, same
Pearson correlation, same information formula, same residual assignment. What changes
is the *input criteria*, and that is already captured by `component_model_version` plus
the `criterion_order` recorded in `weight_derivation`. Bumping `critic-weights-v1` →
`v2` for unchanged mathematics would be a calendar bump, which this audit is instructed
to avoid, and it would falsely imply the method itself changed.

**The condition that flips this to yes:** if **any** successor component is not a
policy-fixed `[0,100]` **beneficial-direction** score. `critic.py:30` encodes exactly
that assumption:

```
NORMALIZATION = "x_ij = component_score / 100 (policy-fixed [0,100] scale; no observed min-max)"
```

`air_impact_proxy` is the obvious candidate for a cost-direction quantity (more air
impact is worse). If any component is cost-direction, CRITIC needs a direction-aware
normalization step, which **is** a genuine method change and **does** require
`critic-weights-v2`. This is recorded as blocker §19-B3 because it cannot be resolved
without the successor components' definitions.

---

## 12. Stability Compatibility

### 12.1 Trace

| Stage | Location | Coupling |
| --- | --- | --- |
| Compared profiles | `policy.py:119` | `("baseline","equal","critic")` — profiles, not components |
| Top fraction | `policy.py:49` | `Decimal("0.10")` |
| Cutoff rank | `engine.py:881-886` | `max(1, ceil(N × 0.10))` over eligible count |
| Membership | `engine.py:983-990` | per-profile top-tier booleans from `profile_ranks` |
| Classification | `engine.py:873-878` | `3 → STABLE`, `2 → CONDITIONAL`, else `SENSITIVE` |
| Storage | `stable_count`, `stability_class`, `stability_membership` (candidate); `stability_definition` (run) | |
| API | `SuitabilitySummaryOut` counts + `top_stable_candidates`; `CandidateProperties`; `CandidateDetailOut` | |
| Frontend | `MapView.tsx:408, 440` (`stable_count == 3` filter); `scenarioExport.ts:72` (`n/3` label) | |

### 12.2 Version boundaries

**Stability depends on components only transitively**, through `profile_ranks` — which
are themselves computed from the component vector. So while no stability code names a
component, every stability output is a *function of* the component model and is
therefore model-specific.

**Structural isolation is already complete.** All stability fields are per-candidate
columns within a run, and `stability_definition` is per-run and empty `{}` for
pre-stability runs (`models/suitability.py:96-97`). There is no shared or cached
stability artifact. Old stability output cannot leak into a successor run.

**What must be added:** `stability_definition` should record
`component_model_version` alongside its existing `compared_profiles` /
`top_fraction` / `method_version`, so a stored classification is interpretable
standalone. Cross-model stability comparison ("this cell was STABLE in v2 and
WEIGHT_SENSITIVE in v3") must be refused in the UI, or presented only with an explicit
statement that the two classifications answer different questions.

### 12.3 Is a stability method-version bump required?

**No.** `suitability-stability-v1` describes "top-10% membership across baseline, equal,
and critic". That method is unchanged. The compared profiles are still three, the
fraction is still 0.10, the classification thresholds are unchanged. Bumping would
misrepresent an unchanged method.

**Conditions that would flip this to yes:** a change to `STABILITY_TOP_FRACTION`, a
change to the membership of `STABILITY_PROFILES`, or a change to the class thresholds.
None is implied by a component-model change.

**Do not "fix" `stable_count == 3`.** It is the count of stability profiles, not
components (§4.6). It is correct as written and must stay 3 while
`STABILITY_PROFILES` has three members.

---

## 13. Migration Sequence

Current head: `0021` (`20260805_0021_municipal_waste_costs.py`). The two migrations
below chain from it. Both follow the `0016` precedent exactly: additive, constant
server defaults, reversible, no analytical backfill.

**No migration is proposed for a component catalogue table.** The project's
established pattern is *code registry + per-run snapshot* (`policy.py` →
`policy_snapshot`), and `docs/SUITABILITY_ENVIRONMENTAL_ARCHITECTURE.md:144-162` commits
to reusing existing versioning "wholesale — no new versioning scheme is invented". A
catalogue table would duplicate `policy.py` and create a second source of truth.

### Migration 0022 — run-level component-model metadata

- **Purpose.** Make every stored run self-describing about which component model
  produced it, without consulting source code.
- **Changes.**
  - `suitability_analysis_runs.component_model_version` — `String(50)`, `NOT NULL`,
    `server_default 'suitability-components-zred-v1'`
  - `suitability_analysis_runs.component_order` — `JsonVariant`, `NOT NULL`,
    `server_default '["zoning","road","equity","demand"]'`
- **Old-data handling.** The constant defaults label existing rows with what they
  already are (§7.3). No score, rank, weight, classification, status, or geometry is
  read or written. Not a semantic backfill.
- **Index.** None required. `suitability_analysis_runs` holds tens of rows; a
  `component_model_version` index would not be selected by the planner and would be
  pure overhead. If a "list runs of model X" screen is later built, add it then.
- **Rollback.** `downgrade` drops both columns. Because no other table references them
  and no stored analytical value depends on them, dropping is inert — the same
  reasoning `0016`'s downgrade relies on. Application code must tolerate their absence
  until the app is rolled back too; deploy order is migrate-then-app, roll back
  app-then-migrate.
- **Size / performance.** Tens of rows. Instantaneous. Note that a `NOT NULL` +
  constant `server_default` `ADD COLUMN` is metadata-only on PostgreSQL 11+ — no table
  rewrite even at scale.
- **Backfill needed.** No (the defaults are the labelling, applied by the DDL itself).

### Migration 0023 — candidate-level version-aware component scores

- **Purpose.** Give successor and all future models a storage location that does not
  require schema change, while leaving the historical model's four columns permanently
  untouched.
- **Changes.**
  - `suitability_candidates.component_scores` — `JsonVariant`, `NOT NULL`,
    `server_default '{}'`
- **Old-data handling.** Every existing row gets `{}`. Their four legacy columns remain
  the sole and authoritative storage. **No historical component score is copied,
  moved, transformed, or duplicated.**
- **Index.** None. `component_scores` is never a filter predicate on any read path
  (verified in §5); a GIN index would add write cost on ~48k rows per run for no read
  benefit. Revisit only if a future feature filters on a component value — and if
  scenario ranking over JSONB measures poorly (§6.3), the correct remedy is a generated
  column or expression index per component, added as its own later migration.
- **Rollback.** `downgrade` drops the column. On a database where a successor run
  already exists, this **destroys that run's component scores** — the legacy columns
  are `NULL` for those rows and hold nothing to fall back on. The rollback is therefore
  safe *only before the first successor run is written*, and this constraint must be
  stated in the migration docstring and in the deployment runbook. Historical runs are
  entirely unaffected by the downgrade under all conditions.
- **Size / performance.** `{}` is ~1 byte of JSONB per row; ~48k rows per run. The
  `ADD COLUMN` is metadata-only in PG11+ (constant default), so it does not rewrite the
  table regardless of run count.
- **Backfill needed.** **No — and backfilling would be actively wrong.** Copying
  historical scores into `component_scores` would create a second copy of an
  authoritative analytical value that could later drift from the first.

### Explicitly not required

- No migration to add successor `*_score` columns (Option A rejected).
- No migration to create `candidate_component_scores` (Option C rejected).
- No migration to alter, rename, or drop any existing column. The successor model adds
  a run; it never rewrites one.
- No data migration of any kind.

### Deployment gate

Unchanged from `docs/SUITABILITY_ENVIRONMENTAL_ROADMAP.md:207-233`: apply the
migration, confirm `GET /health` → `{"status":"ok","database":"ok"}`, and confirm
existing suitability counts and statuses are unchanged. Add one check specific to this
work: **confirm a historical run's `/candidates`, `/summary`, and `/candidates/{id}`
responses are byte-identical before and after**, which is the operational proof that
historical semantics did not move.

---

## 14. Frontend Impact Map

Read-only inventory. **No frontend file was modified.** Classification is of the change
that will *later* be required. The Chrome-extension lane is separately handling visual
and Figma fidelity; nothing below is a visual finding.

### SHARED CONTRACT

| File | Coupling | Later change |
| --- | --- | --- |
| `src/lib/api.ts` | `zoning_score`… on 3 DTOs (`:665-668`, `:1373-1376`, `:1401-1404`); `UserScenarioWeights` (`:1338-1341`); scenario tile URL builder (`:1497`); `SuitabilityProfile` union (`:568`, `:863`) | Add `component_model_version`, `component_order`, `component_scores`; make the tile-URL builder component-driven |
| `src/lib/glossary.ts` | `ScoreComponent` union (`:331`); `code: "Z"\|"R"\|"E"\|"D"` (`:335`); `COMPONENT_META` (`:349-381`); `COMPONENT_ORDER` (`:384`); `codeWithName()` (`:395-398`); label maps (`:670`, `:706-710`) | Make the registry model-keyed: `Record<ComponentModel, Record<string, ComponentMeta>>`. Historical entries must remain byte-identical |
| `src/lib/scenario.ts` | `SCENARIO_COMPONENTS` (`:16`); `SCENARIO_COMPONENT_META` (`:28-53`); percent↔decimal conversion (`:90-160`); `scenarioPresets()` (`:167-183`) | Model-driven component list; `scenarioPresets` already run-driven and needs no change |
| `src/lib/suitability.ts` | component references | Review with the shared contract |

### PAGE 4

| File | Coupling | Later change |
| --- | --- | --- |
| `src/components/suitability/SuitabilityFactorCards.tsx` | `:52-55` fixed detail→card mapping | Iterate `component_order` |
| `src/components/suitability/SuitabilityCandidateSummary.tsx` | `:62-65` mapping; `:229`, `:260` prose naming equity and demand | Iterate `component_order`; prose must be model-scoped |
| `src/components/MapView.tsx` | styles on `score`/`status`/`stable_count`/`sigungu_region_code` only | **None required.** Component scores are not styled on |
| `src/app/page.tsx` | saved-list mirror (`:514-520`), draft lifecycle (`:1059`), storage write (`:2217`) | Thread `componentModel` through saved-scenario state |

### PAGE 5

| File | Coupling | Later change |
| --- | --- | --- |
| `src/components/SuitabilityScenarioLab.tsx` | weight editor over the four components; URL-vs-draft precedence (`:122-134`) | Model-driven slider set; `COMPONENT_MODEL_MISMATCH` handling |
| `src/components/suitability/SuitabilityScenarioComparePicker.tsx` | A/B slot resolution | Add the `OTHER_MODEL` state (§9.6) |
| `src/components/suitability/SuitabilitySidebar.tsx` | owns list + re-verification + A/B | Suppress re-verify for `OTHER_MODEL` |
| `src/components/suitability/useScenarioComparison.ts`, `useScenarioCandidateDetail.ts` | preview/detail fetch hooks | Surface the new error code distinctly |
| `src/components/suitability/page5/SuitabilityScenarioAnalysisSections.tsx`, `SuitabilityScenarioRankingAnalytics.tsx` | per-component contribution rendering | Iterate `component_order` |
| `src/components/suitability/SuitabilityScenarioCandidateComparison.tsx` | candidate A/B | Model-driven rows |
| `src/lib/scenarioComparison.ts`, `scenarioCandidateComparison.ts`, `scenarioRankingComparison.ts` | comparison math over component keys | Component-agnostic; **must refuse cross-model pairs** |

### EXPORT

| File | Coupling | Later change |
| --- | --- | --- |
| `src/lib/exports.ts` | `:156-159` row type; `:171` weights type; `:191-194` weight rows; `:216-219` headers; `:231-234` values | Headers from `component_order` + model label map; historical exports must reproduce byte-identically |
| `src/lib/scenarioExport.ts` | `:91-94` Korean headers with Z/R/E/D codes; `:120-121` description sentence | Model-scoped headers and sentence |
| `src/lib/report.ts` | `:350` weight table via `codeWithName` | Model-scoped |

### SAVED STATE

| File | Coupling | Later change |
| --- | --- | --- |
| `src/lib/savedScenarios.ts` | `WEIGHT_KEYS` (`:78`); `isCanonicalWeights` (`:202-212`); `scenarioRunState` (`:228-234`); `parseScenario` (`:240-262`); writer (`:440-448`) | Add `componentModel`; bump to schema 2 **with upgrade-in-place**; add `OTHER_MODEL` |
| `src/lib/urlState.ts` | `URL_STATE_VERSION` (`:39`); `ScenarioWeights` (`:134-139`); decode (`:472-483`); encode (`:520-523`) | Bump to `"2"`; replace `wz/wr/we/wd` with component-named keys |
| `src/lib/scenario.ts` | `SCENARIO_STORAGE_KEY` (`:63`); `SCENARIO_SESSION_SCHEMA` (`:64`); run gate (`:271`) | Bump to 2; add `componentModel` |

### GLOSSARY / COPY

- `glossary.ts:349-381` — four Korean labels + explanations, and the Z·R·E·D codes.
- `glossary.ts:366-373` — **the collision**: `equity` is already labelled
  「기존 지역 부담」. A successor `existing_burden` cannot reuse this string while the
  historical component still uses it, or the two become indistinguishable in the UI,
  in exports, and in any screenshot of either. Resolving this is blocker §19-B6.
- `glossary.ts:401-432` — the "현재 분석에 포함되지 않은 항목" disclosure. Components the
  successor model *adds* must be removed from this not-yet-modelled list **for
  successor runs only**; the historical run's disclosure must continue to say they were
  not modelled, because they were not.
- `scenarioExport.ts:120-121`, `SuitabilityCandidateSummary.tsx:229, 260` — prose that
  names components inline.

---

## 15. Test Impact Matrix

Classification uses the four requested categories. The governing rule applied
throughout: **a historical test asserting historical behaviour is a valid historical
regression contract, not a stale assumption.** A test is category C only when it
asserts that *no other model can ever exist* — not when it asserts what the Z/R/E/D
model does.

### A — Valid historical regression contract (keep unchanged; these are the proof historical semantics did not move)

| Test | Why it stays |
| --- | --- |
| `test_suitability_policy.py` | Asserts v2 profile weights, sums, validation invariants. These are frozen policy facts. |
| `test_suitability_scoring.py` | Road curve, percentile ranks, equity/demand inversion, composite/provisional math. Component-model-specific and correct. |
| `test_suitability_critic.py` | CRITIC math over four criteria — the v1 method's regression contract. |
| `test_suitability_stability.py` | Cutoff, membership, classification. Method unchanged. |
| `test_suitability_scenario.py` | Weight parsing, canonicalization, hash determinism, rank-delta. |
| `test_suitability_routes.py`, `test_suitability_routes_integration.py` | Historical response shape for historical runs. |
| `test_suitability_scenario_routes_integration.py` | Scenario endpoints against a Z/R/E/D run. |
| `test_suitability_scope_filters_integration.py` | Region scoping — model-independent. |
| `frontend/src/lib/glossary.test.ts` | Historical Korean labels and codes. |
| `frontend/src/lib/urlState.test.ts` | Existing decode/encode semantics; **gains** a v1-link-rejection case. |
| `frontend/src/lib/savedScenarios.test.ts` | Existing validation and run-state semantics. |
| Page-4/Page-5 unit + e2e specs asserting Z/R/E/D rendering **against Z/R/E/D fixtures** | Valid for the historical model. |

### B — Expected successor-model contract addition (new tests)

- Successor run serializes `component_scores` with successor keys; legacy keys explicit
  `null`.
- `component_model_version` + `component_order` present on all five envelope schemas.
- CRITIC over successor criteria; `weight_derivation.criterion_order` matches the run's
  `component_order`.
- Stability classification unchanged in *method* under the successor model.
- Successor MVT carries successor component properties on source-layer `candidates`.
- Successor scenario preview/detail/tile round-trip with successor weights.
- `parse_and_validate_weights` is run-model-relative: successor keys accepted for a
  successor run, rejected for a historical one, and vice versa.
- Frontend: model-driven glossary, factor cards, exports, scenario lab.
- Migration `0022`/`0023` upgrade + downgrade under both SQLite and PostGIS.

### C — Stale assumption that only Z/R/E/D can exist (must change; each is a *mechanism* assertion, not a historical fact)

| Location | Why it is stale |
| --- | --- |
| `scenario.py` error copy "must include exactly zoning, road, equity, demand" and any test asserting that literal string | The message must become model-relative; a test pinning the literal blocks that |
| Any test asserting `policy.COMPONENTS == ("zoning","road","equity","demand")` **as the system-wide invariant** rather than as the zred-v1 model definition | Must be re-scoped to the model, not the system |
| `frontend/e2e/mockBackend.ts` | Serves only a Z/R/E/D run; cannot express a successor run at all |
| `frontend/e2e/suitabilityFixtures.ts:65, 112-115, 141` | Single-model fixtures |
| Frontend tests asserting `COMPONENT_ORDER.length === 4` as a global truth | Model-relative |
| Any assertion that `/candidates` echoes `policy.POLICY_VERSION` | Encodes the §1-finding-2 defect as expected behaviour and would block the fix |

The last row deserves emphasis: if such a test exists, it is not merely stale — it
actively *protects a bug*. This should be checked explicitly during implementation.

### D — Fixture / setup risk

| Risk | Detail |
| --- | --- |
| Mock backend cannot express two models | `mockBackend.ts` must serve a run whose `component_model_version` varies, or every Page-5 compatibility path is untestable end to end |
| `suitabilityFixtures.ts` builders assume four columns | `candidateDetail(...)` hard-codes the four scores; needs a model parameter |
| SQLite vs PostGIS divergence | Scenario SQL is PostgreSQL-specific (`jsonb_array_elements_text`, `ST_AsMVT`, the banker's-rounding fragment). JSONB extract paths **must** be integration-tested on PostGIS, not only unit-tested on SQLite |
| `server_default` visibility | SQLAlchemy does not populate `server_default` on ORM-constructed objects until refresh; fixtures building `SuitabilityAnalysisRun()` directly may see `None` for `component_model_version` and silently exercise a null-model path |
| Cross-model comparison fixtures | Testing `OTHER_MODEL` requires two runs of different models in one fixture set — a shape no current fixture supports |

### Required new compatibility tests (the audit's explicit list)

| # | Test | Asserts |
| --- | --- | --- |
| 1 | Old run serialized as old model | A `zred-v1` run's `/candidates`, `/summary`, `/candidates/{id}`, and MVT responses are **byte-identical** to the pre-change baseline |
| 2 | New run serialized as new model | Successor keys in `component_scores`; legacy keys explicit `null`; correct `component_model_version` |
| 3 | Old scenario rejected from new model | Z/R/E/D weights + successor `run_id` → `422 COMPONENT_MODEL_MISMATCH`, **distinct** from `INVALID_SCENARIO_WEIGHTS` |
| 3b | New scenario rejected from old model | The symmetric case — successor weights + historical `run_id` |
| 4 | Historical export preserved | CSV/XLSX for a historical run reproduces original headers, order, Z·R·E·D codes, and values |
| 5 | URL incompatibility handled safely | A `v=1` link decodes to `{}` + the Korean warning; **no** weight is applied |
| 5b | Saved-scenario upgrade is lossless | A schema-1 localStorage blob survives the bump, gains `componentModel: zred-v1`, and is **not** discarded |
| 6 | CRITIC/stability isolated by model | Successor CRITIC never reads historical criteria; `weight_derivation.criterion_order` matches the run; a historical run still returns `PROFILE_NOT_AVAILABLE_FOR_RUN` where it does today |
| 7 | Mixed-model run list | `/runs` returns both models with correct per-row `component_model_version`, and `/candidates` labels **each** run with **its own** versions (the §1-finding-2 regression test) |

---

## 16. Version-Bump Matrix

| Identifier | Bump? | Reasoning |
| --- | --- | --- |
| **Policy** (`POLICY_VERSION`) | **Yes** — `suitability-policy-v3` | The component set, the weight profiles, the per-component rationale, and the profile methodology text all change. `policy.py:1-12` requires a bump for "any change to a … weight, profile, … normalization". This is the clearest yes in the matrix. |
| **Derivation** (`DERIVATION_VERSION`) | **Yes** — `suitability-screening-v4` | The scoring pipeline computes different quantities from different inputs. Precedent: v3 was minted for adding CRITIC + stability, a strictly smaller change than replacing every component. |
| **Candidate grid** (`CANDIDATE_GRID_VERSION`) | **No** | `capital-grid-500m-v1` describes cell geometry: 500 m, EPSG:5179, origin-aligned. None of that changes because the scored quantities changed. Bumping would falsely imply cells moved — and would break the cell-identity continuity that lets a reader compare *the same place* across models, which is the one legitimate cross-model comparison available. **Reverse if and only if** a successor component requires a different cell size or CRS. |
| **Component model** (`component_model_version`) | **Yes** — new field (§7) | The entire point. `zred-v1` for history, a successor identifier for v3. |
| **CRITIC method** (`CRITIC_METHOD_VERSION`) | **No, conditionally** | The mathematics is unchanged; the criteria are not part of the method identity, and `criterion_order` is already recorded per run. **Bump to `critic-weights-v2` if and only if** any successor component is not policy-fixed `[0,100]` beneficial-direction, which would force a direction-aware normalization — a real method change (§11.3, §19-B3). |
| **Stability method** (`STABILITY_METHOD_VERSION`) | **No** | Same three profiles, same 0.10 fraction, same thresholds, same formula. Only the inputs differ, and those are identified by the component model. Bumping unchanged mathematics would be a calendar bump (§12.3). |
| **Scenario schema** (`USER_WEIGHT_SCENARIO_METHOD_VERSION`) | **Yes** — `user-weight-scenario-v2` | The module's own rule (`scenario.py:46-51`): bump "only signals a change to the scenario recombination contract itself (**weight model**, hashing payload, or scoring/quantization)". The weight model is exactly what changes — validation moves from a fixed four-key set to a run-relative one. Cost is negligible: no scenario hash is persisted server-side, `SavedScenario` stores weights rather than hashes, and the sessionStorage draft that does store a hash is already discarded on run change. |
| **URL schema** (`URL_STATE_VERSION`) | **Yes** — `"2"` | `wz/wr/we/wd` are positional abbreviations that a successor model would silently reinterpret — and `we` (currently *equity*) is the natural abbreviation for `existing_burden`. The existing gate already drops old links with an honest warning, which is precisely the desired behaviour (§9.5). |
| **Export schema** | **Yes** — introduce one | There is **no** export-schema version today: `exports.ts`, `scenarioExport.ts`, and `report.ts` embed `policy_version` / `derivation_version` as text but carry no independent identifier for the file layout. Once two models produce differently-shaped exports with different headers, a recipient holding a CSV cannot tell which layout it is. Introduce `EXPORT_SCHEMA_VERSION` and emit it in a header row. This is a **new** identifier, not a bump. |

**Deliberately not bumped:** `SAVED_SCENARIOS_STORAGE_KEY` and `SCENARIO_STORAGE_KEY`
(the `:v1` suffixes in the storage key strings). Changing a key orphans the stored blob
instead of upgrading it, guaranteeing user data loss (§10). The payload's
`schemaVersion` is bumped; the key is not.

---

## 17. Prohibited Shortcuts

Each entry states the concrete failure, not a general principle.

**1. Reusing `zoning_score` as `land_conversion`.**
`zoning_score` is a fixed lookup over the four top-level 용도지역 codes
(`policy.py:208-257`): UQ111 → `REVIEW_REQUIRED` with no score, UQ112 → 55, UQ113 → 25,
UQ114 → hard exclusion. Its documented ceiling is 55 (`policy.py:264`) because no
industrial high-compatibility class exists in the ingested NA_24 data. It is an
*administrative land-use context* score and, per its own glossary entry
(`glossary.ts:354-356`), explicitly **not** land cover. A `land_conversion` component
would measure actual conversion of existing land cover — a different source, a
different resolution, a different value range, and a different meaning. Reusing the
column would silently import the 55-point ceiling and the four-code lookup into a
quantity that has neither.

**2. Reusing `road_score` as `resident_impact`.**
`road_score` is a piecewise-linear function of centroid-to-nearest-road distance
(`policy.py:271-309`), documented in three separate places as an access *proxy* that
"never proves truck access". `resident_impact` would measure effect on residents.
Distance-to-road is at best weakly and non-monotonically related to resident impact —
proximity to roads can indicate *more* residents nearby, inverting the relationship.
Reusing the column asserts a causal claim the data does not support.

**3. Renaming `equity_score` and pretending history changed.**
A rename rewrites the meaning of every already-computed run. Every stored
`equity_score` was produced by `equity_score_from_rank` (`policy.py:335-338`) as
`(1 − burden_percentile) × 100` over `facility-burden-v1`. Renaming the column to
`existing_burden` would make ~48,000 rows per historical run assert the *opposite* of
what they were computed to mean — a **higher** value would read as more burden when it
was computed to mean less. This is the single most damaging shortcut available, and it
is made attractive by the fact that the UI *already* labels equity 「기존 지역 부담」
(`glossary.ts:367`). The label similarity is a trap, not evidence of equivalence.

**4. Positional mapping of weights.**
Mapping `{zoning, road, equity, demand}` → `{existing_burden, air_impact_proxy,
resident_impact, land_conversion}` by index. Every stored artifact that carries weights
is a *named* map — `STATIC_WEIGHT_PROFILES` (`policy.py:78-103`), `run.weight_profiles`,
`weight_derivation.weights`, the scenario hash payload (`scenario.py:256-261`), the
saved-scenario `weights` object. Position is a display convention only. A positional
map would take a `baseline` profile that weights zoning at 0.35 *because land-use
context is fundamental* (`policy.py:152`) and silently apply 0.35 to `existing_burden`,
carrying over a justification written about a different quantity.

**5. Reusing old CRITIC weights.**
CRITIC weights are a function of the variance and inter-criterion correlation of *these
criteria* in *this run's* eligible population (`critic.py:1-13`). They are, by the
module's own disclaimer, a description of one run's data structure and not a normative
importance ranking. A CRITIC vector computed over `{zoning, road, equity, demand}`
correlations has no defined meaning applied to different criteria — the correlation
matrix that produced it does not exist for the new criteria. Structurally this is
already prevented (weights are stored per run), and it must stay that way.

**6. Reusing old stability outputs.**
`stable_count` / `stability_class` are top-10% membership across baseline, equal, and
CRITIC ranks — all computed from the component vector. A cell that is `STABLE` under
Z/R/E/D is making a claim about robustness to *those* weight profiles over *those*
components. Carrying the classification into a successor run would present a
sensitivity finding for one model as a sensitivity finding for another. The stated
disclaimer (`policy.py:127-132`) would become false.

**7. Auto-migrating saved scenarios without semantic proof.**
A saved Z/R/E/D scenario is a statement about which of *those four* factors the user
weighted. There is no evidence about how that user would weight `air_impact_proxy`.
Translating the vector fabricates a user preference and attributes it to them — a
direct violation of the data-integrity rule against presenting generated values as real
(`AGENTS.md`). Note the permitted, distinct operation: stamping a schema-1 record with
the model it *demonstrably* used (§9.4) is labelling, because schema 1 could not encode
any other model. Labelling records a fact; migration invents one.

**8. Stripping historical API fields immediately.**
Removing `zoning_score` and friends the moment the successor ships breaks every
existing client — including any deployed frontend build, any bookmarked export flow,
and any external consumer of the documented tile property contract
(`docs/SUITABILITY_VECTOR_TILES.md:81-101`). It would also make historical runs
unreadable through the current API, defeating the entire premise of preserving them.
The fields must remain, populated for historical runs and explicitly `null` for
successor runs, for as long as historical runs are served.

**9. Destructive migration of old candidate rows.**
Moving historical scores out of their columns into `component_scores`, dropping the
legacy columns, or rewriting historical rows in any way. `suitability_analysis_runs`
rows are immutable by design — the whole idempotency model rests on
`analysis_signature` identifying an unchanged build (`models/suitability.py:1-16`), and
the environmental roadmap commits explicitly that adopting a factor "does **not** mutate
or backfill historical runs" (`docs/SUITABILITY_ENVIRONMENTAL_ROADMAP.md:216-220`). A
destructive migration would also make every archived export, screenshot, and cited
figure unverifiable against the database.

---

## 18. Recommended Implementation Order

Each phase is independently shippable and independently revertible. Phases 1–2 are
worth doing **regardless** of whether the successor model proceeds.

**Phase 0 — Correctness preconditions (no successor model involved)**

1. Fix `/candidates` to serve the run's own `policy_version`, `derivation_version`, and
   `candidate_grid_version` from the run row (`suitability.py:576-586, 738-740`), matching
   every sibling endpoint. Add the regression test.
2. Make `critic.CRITERION_ORDER` derive from `policy.COMPONENTS` instead of duplicating
   the literal (`critic.py:23`). Behaviour-neutral today; removes the drift hazard.

**Phase 1 — Run self-description (migration `0022`)**
3. Add `component_model_version` + `component_order`; extend `policy_snapshot()` with
   both plus per-component `direction` and `scale`; add `component_model_version` to
   `_analysis_signature`'s payload.
4. Expose both on every run-bearing and candidate-bearing response.
5. Frontend reads and displays the model identifier. **No behaviour change yet** — this
   phase only makes the existing model explicit.

**Phase 2 — Client-side model awareness (no successor model yet)**
6. Bump `SAVED_SCENARIO_SCHEMA_VERSION` → 2 **with upgrade-in-place** and add
   `componentModel`. Ship and verify this *before* any model exists, so the upgrade path
   is proven on real user data under zero-risk conditions.
7. Add the `OTHER_MODEL` state to the comparison picker (inert while one model exists).
8. Introduce `EXPORT_SCHEMA_VERSION`.

**Phase 3 — Successor storage (migration `0023`)**
9. Add `component_scores`; centralize reads behind a single
   `component_scores_for(run, candidate)` accessor; dual-emit for historical runs.
10. Add `component_scores` + `component_model_version` to all five envelope schemas.

**Phase 4 — Successor model definition**
11. Define the successor components in `policy.py` as a *model-keyed* registry:
    directions, scales, derivations, sources, reference periods, weight profiles,
    rationale, and methodology text. Resolve §19-B3 (component directions) here.
12. Make CRITIC and the scenario validator run-model-relative.
13. Make the engine write `component_scores` and `NULL` legacy columns for successor runs.

**Phase 5 — Successor client surfaces**
14. Model-keyed glossary; component-driven factor cards, summary, scenario lab,
    analysis sections, exports.
15. Bump `URL_STATE_VERSION` → `"2"` and rename weight parameters to component names.
16. Bump `USER_WEIGHT_SCENARIO_METHOD_VERSION` → `v2`; add `COMPONENT_MODEL_MISMATCH`
    handling with distinct copy.

**Phase 6 — Rollout**
17. Build the first successor run alongside the historical run. Decide and implement
    §19-B2 (which run is the default) **before** it reaches `SUCCEEDED`.
18. Verify a historical run's responses are byte-identical to the pre-change baseline.
19. Measure scenario-preview latency on PostGIS for a successor run against the
    historical baseline (§6.3); add expression indexes only if measurement warrants.

---

## 19. Exact Blockers / Decisions Still Required

### Blockers — cannot be resolved from the repository

**B1. `/candidates` version mislabeling must be fixed before any second model exists.**
`suitability.py:738-740` returns live module constants; the run query at `:576-586`
does not select the run's versions. Latent today, actively wrong the moment two models
coexist. *Owner: backend. Decision needed: none — this is a defect. Fix in Phase 0.*

**B2. Which run does the platform serve by default once two models exist?**
`_resolve_run_id` (`suitability.py:197-216`) returns the latest `SUCCEEDED` run
regardless of model, and `AppUrlState` carries no `runId` (`urlState.ts:142-228`), so
every default view and every shared link is run-relative. The first successful
successor run would silently switch the meaning of the entire product, including links
shared before the switch. Options: (a) pin the default to a configured run id;
(b) filter the default by an explicitly designated "published" model; (c) add `run` to
the URL state. *This is a product decision, not a technical one, and it gates rollout.*

**B3. What is each successor component's direction and scale?**
`critic.py:30` hard-assumes policy-fixed `[0,100]` **beneficial-direction** scores. If
`air_impact_proxy` (or any other successor component) is cost-direction, CRITIC needs
direction-aware normalization — which is a genuine method change requiring
`critic-weights-v2` (§11.3, §16). *This determines one row of the version-bump matrix
and cannot be answered from the repository.*

**B4. Do official public datasets exist for all four successor components, at what
resolution and reference period?**
`AGENTS.md` forbids presenting generated or placeholder data as official, and requires
source + reference period for every displayed metric. The historical model already mixes
resolutions — zoning and road are per-cell, while equity and demand are SIGUNGU-level
percentile ranks broadcast to cells (`engine.py:740-746`). The successor model's
resolutions must be established before its components can be defined, and any
resolution mismatch must be disclosed as the current model's is.

**B5. Are historical Z/R/E/D runs to remain publicly served, or archived?**
This determines how long the legacy API fields, the legacy glossary entries, and the
legacy scenario path must be maintained. §6 assumes indefinite serving, per the mission's
"interpretable indefinitely" requirement — but "interpretable" and "publicly served" are
different commitments and should be decided explicitly.

**B6. How is the Korean label collision resolved?**
`equity` is already 「기존 지역 부담」 (`glossary.ts:367`) — the natural rendering of
`existing_burden`, and the two are arithmetically opposed in direction. Either the
historical label changes (a copy-only change that does not alter any number, but does
alter what past screenshots and exports appear to say) or the successor label differs.
Both components will be visible simultaneously if historical runs stay served.
*Requires a Korean-language product decision.*

### Decisions recommended in this audit (open to override, with the rationale stated)

| Decision | Recommendation | §|
| --- | --- | --- |
| Persistence architecture | Hybrid (Option D) | 5, 6 |
| Run versioning field name | `component_model_version` + `component_order` | 7 |
| API shape | legacy fields + generic map + explicit model metadata | 8 |
| Successor legacy-field behaviour | present and explicitly `null`, never omitted, never reused | 8.3 |
| Scenario cross-model behaviour | blocked with a distinct error code; legacy-only; never migrated | 9 |
| Saved-scenario bump | schema 2 **with upgrade-in-place** — a naive bump silently deletes user data | 9.4, 10 |
| URL weight parameters | component-named keys, not new single letters (`we` collision) | 9.5 |
| Migrations | exactly two: `0022`, `0023`; no backfill, no catalogue table | 13 |
| CRITIC method bump | no, unless B3 says otherwise | 11.3, 16 |
| Stability method bump | no | 12.3, 16 |
| Grid version bump | no | 16 |
| Export schema version | introduce one (none exists today) | 16 |

### Verified non-issues (checked and deliberately excluded from the plan)

- `stable_count == 3` is a stability-profile count, not a component count. Leave it.
- MapLibre styling never reads a component score (`MapView.tsx:308-447`). Adding or
  renaming component tile properties cannot break map rendering.
- `engine.py:754`'s completeness gate is set-based and already generalizes.
- `scenarioPresets()` (`scenario.ts:167-183`) already derives presets from the selected
  run's `weight_profiles` and needs no change.
- `_ensure_profile_available` (`suitability.py:106-124`) is the correct existing
  precedent for refusing an artifact a run does not carry, and should be the model for
  `COMPONENT_MODEL_MISMATCH`.
- No backend-persisted scenario table exists; scenarios are read-only recombinations,
  which removes an entire class of migration risk.
- The sessionStorage draft is already hard-discarded on run change
  (`scenario.ts:271`) — the strongest existing isolation of the three browser surfaces.

---

## Confirmation

This audit is read-only. It created exactly one file — this document — and modified no
runtime backend code, frontend code, migration, test, fixture, or deployment file. No
package was installed, no build was run, no database was touched, and no test suite was
executed. Every claim above cites the file and line it was read from at
`5148caa058b305e355100700bd85e534370b81c7`.
