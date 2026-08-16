# Suitability Successor Model — Backend Foundation

> **Status: foundation only. The successor model is implemented and tested but
> NOT activated.** There is no successor policy version, no approved weight
> vector, and no persisted successor score. Nothing in this document changes what
> any stored analysis run means.
>
> **Update (backend phase 2).** The additive persistence and API contract this
> document *designed* in §8 are now **applied**: two component models can coexist
> in storage, in the API, in scenarios, and in tests. The successor model is still
> not activated — nothing writes a successor run and none can be produced. See
> [SUITABILITY_COMPONENT_MODEL_CONTRACT.md](SUITABILITY_COMPONENT_MODEL_CONTRACT.md)
> for the applied contract.
>
> Everything here is analytical decision support. Nothing is a legal, permitting,
> engineering, environmental-review, or final siting determination.

## 1. What this is

The historical screen scores four components — `zoning` / `road` / `equity` /
`demand` — defined in
`backend/src/waste_equity_backend/analysis/suitability/policy.py` and documented
in [SUITABILITY_POLICY_V1.md](SUITABILITY_POLICY_V1.md). This foundation adds a
**separate, disjoint** component namespace for a successor model:

| Component | Measures | Grain | Raw unit | Direction |
| --- | --- | --- | --- | --- |
| `existing_burden` | located facility throughput per resident | SIGUNGU | `kg/인/년` | lower raw → higher score |
| `air_impact_proxy` | total waste-generation activity per resident | SIGUNGU | `kg/인/년` | lower raw → higher score |
| `resident_impact` | population-weighted inverse-distance exposure | candidate cell | `persons/m` | lower raw → higher score |
| `land_conversion` | share of measured area not already developed | candidate cell | dimensionless share | lower raw → higher score |

Code lives in
`backend/src/waste_equity_backend/analysis/suitability/successor/`:

| Module | Responsibility |
| --- | --- |
| `contract.py` | the typed component contract, reason-code vocabulary, and the two normalization strategies |
| `policy.py` | successor identity, activation gate, missing-data policy gate, cross-model reuse guards, CRITIC pre-flight, persistence design |
| `existing_burden.py` · `air_impact_proxy.py` · `resident_impact.py` · `land_conversion.py` | one component each |

The package name is `successor`, not `v3`, deliberately: `suitability-screening-v3`
is already the **current** derivation version, and reusing "v3" for the successor
component model would collide with it in exactly the place a reader most needs
clarity.

## 2. The rules the code enforces

These are enforced in code and pinned by tests, not merely documented.

**Missing is never zero.** An observation is either *available* (an exact
`Decimal`) or *unavailable* (one or more stable reason codes). There is no third
state and no zero-fill anywhere. This matters more than it sounds: every successor
component is `LOWER_RAW_IS_BETTER`, so `0` is the *best possible* raw value —
zero-filling would systematically promote exactly the units with the least
evidence.

**Partial is visible.** A value computed from a known-incomplete input stays
available but carries `is_partial` and its reasons, so a consumer sees a
documented undercount instead of a silent one.

**Sources survive.** Every observation preserves the individual source values,
their units, reference periods, accounting bases, and provenance beside the
derived number — including when the observation turns out to be unavailable.

**Deterministic.** All arithmetic is exact `Decimal`; observation order never
affects a result; every summary serializes to fixed-point decimal strings.

**Disjoint namespaces.** No successor component name collides with a historical
one, and the disjointness is asserted rather than assumed.

## 3. Component notes

### 3.1 `existing_burden` — reuses the validated derivation, does not restate it

The module calls `facility_burden.aggregate_throughput` and
`per_capita.per_capita_kg_per_year` directly, so the successor component cannot
drift from the burden number the rest of the platform computes.

**One availability rule is deliberately stricter than the historical engine's, and
it is stated rather than hidden.** When facility rows exist for a region but
*every* row's throughput is unusable (missing, or in an unexpected unit), the
located total would be a pure zero-fill of missing data, so the observation is
`ALL_LOCATED_THROUGHPUT_MISSING` rather than a best-possible zero burden. A region
with genuinely *no* located facility rows is a different case: zero located
throughput is then an observed fact, the observation stays available, and
`no_located_facility_rows` records why.

**The label trap.** The historical `equity` component is already rendered in the
citizen-facing UI as 「기존 지역 부담」 — the natural Korean reading of
*existing burden*. They are not the same quantity and must never be aliased:

* `equity_score` is an **avoidance score**: `(1 − burden_percentile) × 100`.
  A *higher* stored value means *less* measured burden.
* `existing_burden.raw_value` is the **burden itself**, in `kg/인/년`.
  A *higher* raw value means *more* burden.

The successor component's *normalized score* is inverted to the same beneficial
direction, so the two scores read the same way — but the raw quantities are
opposites, and the two components draw from different availability populations.
Renaming or reusing the historical column would make every stored `equity_score`
assert the opposite of what it was computed to mean.
`test_successor_historical_compatibility.py` pins the historical direction.

### 3.2 `air_impact_proxy` — a proxy, named and disclaimed as one

`total_generation = HOUSEHOLD + BUSINESS_NON_FACILITY + INDUSTRIAL_FACILITY +
CONSTRUCTION`, then divided by resident population. All four canonical streams are
required; a missing stream is never zero-filled, because "no row" and "zero tonnes"
are different facts.

It is **not** measured atmospheric emissions, **not** a modelled stack or
dispersion concentration, and **not** a health-risk estimate. No air-quality
dataset is ingested by this platform, so the proxy has not been validated against
any measured air variable.

Compatibility is checked rather than assumed. Quantity units, reference periods,
and **aggregation grain** must all agree across the four streams. The grain check
is not theoretical: some RCIS PIDs report seven large Gyeonggi cities at CITY
level, and those records live in `reporting_region_waste_statistics` keyed by a
derived reporting region. Summing a CITY-grain value into a SIGUNGU-grain total
would silently mix geographies, so it raises `INCOMPATIBLE_GEOGRAPHIC_GRAIN`.

Two caveats travel with every observation in `PROXY_CAVEATS`: origin-based
generation says nothing about where combustion physically occurred, and the
`HOUSEHOLD` stream's population coverage cannot be verified from this platform's
data because RCIS `NTN002` (생활폐기물관리구역현황) is not ingested.

### 3.3 `resident_impact` — distances are metre-correct or refused

`raw = Σ population_r / max(distance_r, distance_floor)`.

* **Distances must be metre-correct.** Every population unit declares how its
  distance was measured; only PostGIS geography metres and a projected metre CRS
  are accepted. Degrees, screen/SVG coordinates, and prototype x/y values raise
  `INCOMPATIBLE_DISTANCE_MEASUREMENT`.
* **The distance floor is an explicit input with no default.** `DistanceFloor`
  requires a positive value and a stated basis; there is no module constant to
  inherit by accident.
* **The candidate's own containing region is NOT dropped.** The old prototype's
  `j != i` self-exclusion belonged to a region-to-region matrix. Candidates and
  population units are different analytical sets, so a candidate inside a
  populated region does expose that region's residents. The floor — not an
  exclusion rule — bounds the zero-distance term.
* **Runtime derivation is set-based.** `population_weighted_impact_sql()` returns
  one PostGIS aggregate over the candidate × population-unit join, not a Python
  nested loop.

**Representative geometry is a recorded choice, not a silent one.** A region's
`ST_Centroid` and its `ST_PointOnSurface` are not interchangeable: the centroid of
a multipart geometry is the area-weighted mean of its parts, which for an
archipelago can fall in open water — outside every constituent polygon — placing a
whole county's population where nobody lives. `ST_PointOnSurface` is guaranteed to
land on the surface but lands on *one* part, which is a plausible-looking answer
rather than a representative one. So `representative_point_audit_sql()` records
**both** points, the containment predicate, and their separation, and
`representative_point_divergence_flags()` flags the regions where they disagree
materially — the same discipline the land-cover derivation applies when it stores
`topological_cover_predicate` beside the residual-based coverage status.

No choice of point fixes the underlying limit, which is that the finest population
geography available is one value per SIGUNGU. `POPULATION_RESOLUTION_DISCLOSURE`
travels with every series so the component's apparent per-cell precision is never
mistaken for the resolution of the data behind it.

### 3.4 `land_conversion` — the registry is an input, never a guess

The component consumes the existing derived candidate-cell land-cover statistics
(`environmental_land_cover_cell_statistics` and its per-class child rows,
derivation `land-cover-cell-stats-v1`). It does not re-measure geometry and does
not re-label classes.

It ships **no** developed/artificial class list. Class codes and names are stored
verbatim from the source with no developed/natural classification anywhere in this
repository, so `LandCoverClassRegistry` is a required explicit input and
`PRODUCTION_REGISTRY` is `None`. Tests use an explicitly fabricated registry whose
codes are not official codes.

The registry is **total** by construction, which is what keeps "not classified"
distinguishable from "not developed":

* `known_class_codes` — every code the registry classifies. A class observed in a
  cell but absent from this set makes the cell **unavailable**
  (`UNCLASSIFIED_LAND_COVER_CLASS`), never quietly counted as non-developed.
* `developed_class_codes` — the subset treated as already developed / artificial.
* `excluded_class_codes` — classes belonging in **neither** numerator nor
  denominator (the natural treatment for water under a "share of the *land* that
  is developed" reading). Opt-in, and only effective under the explicitly named
  `EVALUATED_AREA_EXCLUDING_EXCLUDED_CLASSES` denominator.
* `ambiguous_class_codes` — contested classifications. Flagging does not leave a
  hole: an ambiguous class must still resolve to exactly one bucket, so the flag
  makes the contested decision auditable in every observation's provenance.

Coverage handling: `NO_COVERAGE` is **unavailable**, not "0% developed";
`PARTIAL` stays available but flagged with its coverage ratio; a class-area sum
larger than its own denominator is reported (`CLASS_AREA_EXCEEDS_DENOMINATOR`)
rather than clamped into a plausible-looking share.

`assert_developed_share_monotone_across_levels()` provides the free integrity
check that a finer registry can never report *less* developed area than a coarser
one for the same cell.

## 4. Normalization — two strategies, neither approved

Both strategies produce a dimensionless **[0,100] beneficial-direction** score
(higher = better screening outcome), which is exactly the scale the existing
CRITIC normalization already assumes (`x = score / 100` on a policy-fixed
beneficial scale).

| Strategy | Behaviour | Trade-off |
| --- | --- | --- |
| `PERCENTILE_RANK` | the project's existing convention, reused verbatim from `policy.percentile_ranks` | run-relative: a unit's score describes its position among whichever other units were scored |
| `BOUNDED_RATIO` | a bounded `[0,1]` raw value maps straight to `[0,100]` | run-independent and physically interpretable; preserves the raw distribution's shape |

The choice is analytically load-bearing, not cosmetic: percentile-ranking a
component hands CRITIC a near-uniform distribution whose standard deviation sits
near the theoretical maximum, mechanically inflating that component's *derived*
weight relative to a naturally-clustered one — letting a normalization choice
masquerade as a data-derived importance finding.

`land_conversion` defaults to `BOUNDED_RATIO` because its raw value is already a
bounded areal share with a source and reference period. The other three default to
`PERCENTILE_RANK`, the project's existing convention. **Neither default is approved
successor policy** — see `SUCCESSOR_NORMALIZATION_STRATEGY_UNAPPROVED`.

**Consequence for CRITIC versioning:** because both strategies land on the
policy-fixed `[0,100]` beneficial scale regardless of a component's raw direction,
no direction-aware CRITIC normalization is implied, and therefore **no
`CRITIC_METHOD_VERSION` bump is required** by the component model alone. Pinned by
`test_successor_model_boundary.py`.

## 5. Missing-component eligibility — a model policy decision, deliberately unmade

The historical engine's rule is "any missing component ⇒ `REVIEW_REQUIRED`". Under
that rule every successor component would *shrink* the eligible set rather than
re-rank it, because each is unavailable for a real and non-trivial share of units.
That makes missing-value handling a **model policy decision**, and it is not made
here.

| Option | Status |
| --- | --- |
| `STRICT_ALL_COMPONENTS_REQUIRED` | permitted — the historical rule, but only after the post-activation eligible count is measured |
| `OPTIONAL_COMPONENT_RENORMALIZED` | permitted — promotes the existing `provisional_composite` renormalization to a first-class rule; a unit loses the *component*, not its eligibility |
| `ZERO_FILL` | **permanently forbidden** — `resolve_missing_component_policy()` raises |

`SELECTED_MISSING_COMPONENT_POLICY` is `None` and `OPTIONAL_COMPONENTS` is empty.
The registry refuses to declare components optional before a policy is chosen.

## 6. Version identity and the activation gate

Each component derivation carries its own method version
(`successor-existing-burden-v1`, …). The **model-level** identity is deliberately
unassigned: `SUCCESSOR_POLICY_VERSION` and `SUCCESSOR_DERIVATION_VERSION` are
`None`, and `SUCCESSOR_WEIGHT_PROFILES` is empty — inventing "equal weights as a
placeholder" would be an unapproved analytical assumption, so there is no
provisional vector at all.

`assert_activated()` raises `SuccessorActivationBlockedError` while any blocker is
open, and every blocker names what it blocks and who owns it:

| Blocker | Blocks |
| --- | --- |
| `RESIDENT_IMPACT_DISTANCE_FLOOR_UNAPPROVED` | `resident_impact` activation |
| `RESIDENT_IMPACT_POPULATION_RESOLUTION_UNRESOLVED` | `resident_impact` activation |
| `LAND_COVER_DEVELOPED_CLASS_REGISTRY_UNAVAILABLE` | `land_conversion` activation |
| `LAND_CONVERSION_DIRECTION_UNAPPROVED` | `land_conversion` activation |
| `AIR_IMPACT_PROXY_GRAIN_AND_COVERAGE_UNRESOLVED` | `air_impact_proxy` activation |
| `SUCCESSOR_WEIGHT_VECTOR_UNAPPROVED` | composite scoring, profile registration |
| `SUCCESSOR_NORMALIZATION_STRATEGY_UNAPPROVED` | component scoring, successor CRITIC |
| `MISSING_COMPONENT_ELIGIBILITY_POLICY_UNDECIDED` | every component's effect on candidate status |
| `SUCCESSOR_CRITIC_STABILITY_METHOD_UNVALIDATED` | successor CRITIC weights and stability |
| `SUCCESSOR_ELIGIBLE_POPULATION_NOT_MEASURED` | successor CRITIC, stability, rollout |
| `SUCCESSOR_RUN_WRITE_PATH_NOT_IMPLEMENTED` | producing any stored successor run, and successor scenario recombination |
| `SUCCESSOR_DEFAULT_RUN_RESOLUTION_UNDECIDED` | rollout and default-run switchover |

### Component-model identity

`policy_version` cannot answer *"which components produced this run?"* — it has
already moved once (v1 → v2) for a reason unrelated to component identity, while
the component-score formulas stayed byte-for-byte unchanged. `derivation_version`
is overloaded the same way and `candidate_grid_version` describes geometry. So
component identity gets its own identifier, and component **order** travels with
it (order is load-bearing for the CRITIC correlation matrix, the scenario hash
payload, and export column sequences, and is not recoverable from a JSON object's
key order):

```
COMPONENT_MODEL_VERSION_HISTORICAL = "suitability-components-zred-v1"
COMPONENT_MODEL_VERSION_SUCCESSOR  = "suitability-components-successor-v1"
```

Stamping an existing run `zred-v1` is **labelling**, not a semantic backfill: the
candidate table physically cannot hold any other component model today, so the
label records a fact that is already true without reading or writing any
analytical value. The successor identifier's final public name is subject to the
same approval as activation.

These are now **persisted** on every run row (`component_model_version` +
`component_order`) and served by every run-scoped endpoint. The backend-side source
of truth for how they are resolved, validated, and served is
`analysis/suitability/component_model.py`.

## 7. Cross-model reuse is refused, never approximated

Historical CRITIC weights, stability classes, saved Z/R/E/D scenarios, and
positional URL weight vectors all describe the historical component matrix. Each
translation path raises `CrossModelReuseError` instead of returning a plausible
answer:

| Attempt | Why it is refused |
| --- | --- |
| `translate_historical_weights()` | `baseline` weights zoning at 0.35 *because land-use context is fundamental*; carrying that number to `existing_burden` carries a justification written about a different quantity |
| `translate_weights_by_position()` | position 1 is `road` historically and `air_impact_proxy` in the successor model — a positional read silently relabels every weight |
| `translate_saved_scenario()` | a saved scenario states which of *those four* factors a user weighted; there is no evidence about how they would weight `air_impact_proxy`, and inventing one attributes a fabricated preference to a real person |
| reusing a stored CRITIC vector | CRITIC weights are a function of the variance and correlation of *those* criteria in *that* run's population; the correlation matrix that produced them does not exist for different criteria |
| reusing a stability class | `stable_count` is top-fraction membership across ranks computed from the historical component vector; carrying it over would present one model's sensitivity finding as another's |

`classify_component_set()` is the integration seam: a future engine stage calls it
to pick the right CRITIC/stability path rather than assuming the historical one
applies. A `MIXED` set is always an error at the call site.

### CRITIC pre-flight

`critic_preflight()` asserts, before any successor CRITIC derivation, that the
population exceeds an explicitly supplied minimum and that **every** component
actually varies across it. Each added required component demotes the units it
cannot measure, and a sufficiently collapsed eligible set makes a region-level
component exactly constant — zero variance, zero weight, and in the limit an
undefined CRITIC that fails the whole build. The minimum has no default: no value
is approved, and inventing one would put an unreviewed threshold on the build's
failure boundary.

## 8. Persistence — designed here, applied in backend phase 2

The design below is recorded in `policy.PERSISTENCE_DESIGN`. It was
`DESIGN_ONLY_NOT_APPLIED` when this document was written and is now
**`APPLIED_ADDITIVE_SCHEMA_ONLY`**: migrations `0022` (run-level identity) and
`0023` (candidate-level `component_scores`) are in the chain, and the API serves
both shapes. What is still not applied is any successor *write* — nothing produces
a successor run, so `component_scores` is `{}` and the legacy columns are populated
on every stored row. Full details, including the API and default-run contracts, are
in [SUITABILITY_COMPONENT_MODEL_CONTRACT.md](SUITABILITY_COMPONENT_MODEL_CONTRACT.md).

The design as recorded:

* **Run level** — `suitability_analysis_runs` gains `component_model_version`
  (`String(50)`, `NOT NULL`, constant server default) and `component_order`
  (`JsonVariant`, `NOT NULL`, constant server default).
* **Candidate level** — `suitability_candidates` gains `component_scores`
  (`JsonVariant`, `NOT NULL`, server default `{}`).
* **Write rules** — historical runs: nothing written, nothing backfilled, the four
  legacy `*_score` columns remain the sole authoritative storage. Successor runs:
  `component_scores` populated, the four legacy columns written `NULL` and never
  reused. No historical score is ever copied into `component_scores` — a second
  copy of an authoritative analytical value can drift from the first.
* **Signature** — `component_model_version` must join the analysis-signature
  payload so model identity is a *signed* input rather than a convention that two
  versions always move together. Future signatures only; stored signatures are
  never recomputed.
* **Rollback constraint** — dropping `component_scores` is safe only *before* the
  first successor run is written; after that the legacy columns are `NULL` for
  those rows and hold nothing to fall back on. Historical runs are unaffected in
  all cases.

The load-bearing property is that the successor model has **no column to be
cross-wired into**. Four adjacent `Numeric(7,4)` columns and a fifth successor
quantity are one careless edit away from each other; a `NULL` legacy column and a
separate versioned map are not.

## 9. One historical defect fixed

`GET /api/v1/suitability/candidates` stamped every response with the **running
code's** `policy_version` / `derivation_version` / `candidate_grid_version`
instead of the run's own, while every sibling endpoint (`/summary`,
`/candidates/{id}`, `/runs`) already read them from the run row. That is latent
while one model exists and becomes an active mislabeling of historical data the
moment a second one does — a v2 run's candidate collection would be stamped with
v3 version strings.

The route now selects and echoes the run's own three version columns.
`test_suitability_routes_integration.py::test_candidates_report_the_runs_own_versions_not_the_running_codes`
pins it against a seeded run stored under older versions, and asserts the
collection, summary, and detail endpoints agree.

## 10. What was deliberately *not* changed

* **`critic.CRITERION_ORDER` stays a written-out literal.** Deriving it from
  `policy.COMPONENTS` would be cleaner, but `policy` imports `critic`, so the
  reverse import is a cycle. `test_successor_historical_compatibility.py` asserts
  the two are equal instead, which catches the drift without restructuring.
* **No version constant is bumped.** `POLICY_VERSION`, `DERIVATION_VERSION`,
  `CANDIDATE_GRID_VERSION`, `CRITIC_METHOD_VERSION`, `STABILITY_METHOD_VERSION`,
  and `USER_WEIGHT_SCENARIO_METHOD_VERSION` are all unchanged — the successor
  model is not activated, so nothing they describe has moved.
* **No frontend file, Figma asset, deployment config, or production datum was
  touched.**

## 11. Open dependencies

Blocking activation, in the order they must be resolved:

1. **Missing-component eligibility policy** — determines whether the successor
   model is viable at all, and must be decided against a *measured*
   post-activation eligible count.
2. **Developed/artificial class registry** — under audit by a separate research
   lane. The finer official hierarchy levels are the ones that make the
   natural/artificial distinction explicit, so a coarse-level fallback discards a
   distinction the source taxonomy makes itself.
3. **Ambiguous-class policy** — greenhouse/protected cultivation and water need an
   explicit sign-off, including whether water is excluded from both numerator and
   denominator.
4. **`land_conversion` score direction** — a policy decision with a written
   rationale, never inferred from which direction produces a nicer ranking.
5. **`resident_impact` distance floor and representative point** — no floor value
   is approved, and every candidate floor discussed so far is smaller than the
   average region's own equivalent-circle radius.
6. **`air_impact_proxy` grain, coverage contract, and numerator basis** — including
   whether origin-based incinerated tonnage is the better numerator than total
   generation.
7. **Successor weight vector**, then normalization strategy per component.
8. **A successor run write path** — the persistence migrations and the version-aware
   API contract are applied, but nothing scores successor components into candidate
   rows. That work depends on items 1–7.
9. **Default-run switchover** as the rollout gate. The backend boundary exists and is
   pinned to the historical model; flipping
   `component_model.DEFAULT_COMPONENT_MODEL` is the product decision.
