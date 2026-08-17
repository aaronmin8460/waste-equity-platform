# Suitability Successor V3 — Phase 5 runtime validation

**Branch:** `feat/suitability-v3-phase5-runtime`
**Base:** `83205bc` (policy closure, `suitability-successor-policy-v1`)
**Validated against:** local development snapshot, source run **47**, 47,893 candidates
**Status:** runtime implemented, validated on real data, **model activated**;
default run still pinned to the historical model.

---

## 1. What Phase 5 actually had to build

Two of the three engineering blockers were closer to done than the register
suggested, and saying so is more useful than re-deriving them:

| blocker | found to be | evidence |
| --- | --- | --- |
| `SUCCESSOR_MODEL_AWARE_DEFAULT_RUN_NOT_IMPLEMENTED` | **already shipped in Phase 2** | `component_model.DEFAULT_COMPONENT_MODEL` is pinned to the historical model and `_resolve_run_id()` already scopes unpinned requests by component model. Covered by `test_the_default_run_stays_historical_when_a_successor_shaped_run_is_newer`. |
| version-aware API serialization | **already shipped in Phase 2** | `legacy_score_fields()` / `component_scores_field()` mirror storage exactly, so a successor run serves `component_scores` with NULL legacy columns without new route code. |
| `SUCCESSOR_RUN_WRITE_PATH_NOT_IMPLEMENTED` | the real work | built here |

Step 1 of the approved switchover sequence — model-aware resolution shipping
*before* the first successor run is written — was therefore already satisfied when
that run was written, which is the ordering the sequence requires.

---

## 2. Architecture — re-score, never re-screen

A successor run is **derived from a historical run** and inherits its candidate
grid, region assignment, and constraint-screening status **by copy**.

This is the whole design. The ranking-population rule is not enforced by a filter
that could be edited away; it is structural, because `successor/runtime.py` never
evaluates a constraint at all. There is no code path that could admit a candidate
the zoning/protected-area/road screening excluded, because nothing in the module
knows what a constraint is.

Storage follows the applied additive schema: successor rows write
`component_scores`; the four legacy `*_score` columns are written **NULL** and are
never reused for a successor quantity.

### New modules

| module | role |
| --- | --- |
| `successor/inputs.py` | production loaders. One floor (the approved one) instead of research's four; the B17-corrected `existing_burden` loader only, so there is no uncorrected path to reach by accident. |
| `successor/stability.py` | successor stability, defined over successor axes only. |
| `successor/runtime.py` | scoring, ranking, and the run write path. |
| `research/run_successor_build.py` | real-data validation entrypoint. Calls the **production** path rather than re-implementing it. |

---

## 3. Stability — defined here, not inherited

The historical stability class is top-decile membership across the three
historical weight profiles. It is not reused: those profiles are vectors over
zoning/road/equity/demand, and the successor has one approved profile rather than
three.

What is defined instead follows the perturbation axis Phase 4 already specified:
**one symmetric perturbation per component**, each moving a fixed step onto that
component and taking it equally from the other three.

Two properties make it defensible rather than arbitrary:

* **Symmetric** — exactly one perturbation per component, same step, so no
  component is privileged. That matters here specifically because Phase 4 showed
  the ranking head is `resident_impact`-determined; a perturbation set containing
  two resident-leaning profiles would manufacture instability.
* **Anchored on the approved vector** — every profile is a displacement of the
  approved baseline, so the class describes robustness *of the approved policy*.

**The step is 0.06, and the reason is arithmetic.** Phase 4's small axis is 0.05,
but 0.05 taken equally from three components does not terminate in decimal, so
every profile would sum to 0.999… instead of 1. 0.06 is the smallest step at or
above Phase 4's small axis that divides exactly by three (0.02 each), giving
`0.31 / 0.23 / 0.23 / 0.23` summing to exactly 1. A guard raises if any profile
ever misses 1.

Thresholds: STABLE = survives all four; CONDITIONAL = two or three; SENSITIVE = at
most one.

---

## 4. Real-data validation — source run 47 → successor run 465

### 4.1 It reproduces the policy-closure measurement exactly

The runtime is a different implementation from the closure harness (production
loaders, production policy objects, database persistence). It lands on the same
numbers, which is the strongest available check that the write path scores what
the policy says it scores.

| measure | policy closure | Phase 5 runtime | |
| --- | --- | --- | --- |
| candidates | 47,893 | 47,893 | ✅ |
| strict complete case | 33,980 | 33,980 | ✅ |
| complete case ELIGIBLE | 13,734 | 13,734 | ✅ |
| complete case EXCLUDED | 8,933 | 8,933 | ✅ |
| complete case REVIEW | 11,313 | 11,313 | ✅ |
| ranking population | 13,734 | 13,734 | ✅ |
| composite mean | 31.1163 | 31.1163 | ✅ |
| composite min / max | 4.5437 / 61.0558 | 4.5437 / 61.0558 | ✅ |
| top-50 regions | 양평군 49 · 안성시 1 | 양평군 49 · 안성시 1 | ✅ |

Component availability also reproduces Phase 4 §3.1 exactly:

| component | available | Phase 4 |
| --- | --- | --- |
| `existing_burden` | 41,804 | 41,804 ✅ |
| `air_impact_proxy` | 38,592 | 38,592 ✅ |
| `resident_impact` | 47,893 | 47,893 ✅ |
| `land_conversion` | 40,506 | 40,506 ✅ |

### 4.2 Missing-reason distribution

Every unavailable observation names why. Nothing is silently absent and nothing is
zero-filled.

| component | reason | units |
| --- | --- | --- |
| `existing_burden` | `UNMAPPED_FACILITY_EVIDENCE` | 20 regions |
| `air_impact_proxy` | `MISSING_WASTE_STREAM` | 22 regions |
| `land_conversion` | `NO_EVALUATED_AREA` | 7,387 cells |
| `land_conversion` | `NO_LAND_COVER_COVERAGE` | 7,387 cells |
| `resident_impact` | — | none |

### 4.3 Stored-state invariants

Read back out of the database after commit:

| invariant | result |
| --- | --- |
| candidates written | 47,893 |
| ranked | 13,734 |
| rows carrying `component_scores` | 47,893 |
| **rows with any legacy `*_score` written** | **0** |
| rows classified for stability | 13,734 |
| **statuses differing from the source run** | **0 of 47,893** |
| **ranked candidates that are not ELIGIBLE** | **0** |
| **source run 47 candidates still scored** | **17,501** (unchanged) |

The last three are the ones that matter most: the screening was carried over
verbatim, nothing outside the screened-eligible set was ranked, and the historical
run it derived from was not touched.

### 4.4 Stability distribution

| class | candidates |
| --- | --- |
| STABLE | 1,195 |
| CONDITIONALLY_STABLE | 214 |
| WEIGHT_SENSITIVE | 12,325 |

Top-decile cutoff rank 1,374 of 13,734. Every class is populated and none is
degenerate, which is what the thresholds needed validating for.

The distribution is heavily weighted toward SENSITIVE, and that is a real finding
rather than a defect: it is the same asymmetry Phase 4 measured, now expressed
per candidate. 1,195 candidates hold top-decile membership under every
perturbation.

### 4.5 Determinism

The build was run twice against the same source run. See §6 for the comparison.

---

## 5. Scope finding — the ranking population spans 16 regions

Worth stating separately because it is narrower than any figure published so far:

| measure | value |
| --- | --- |
| regions with at least one ranked candidate | **16 of 79** |
| residents in those regions | **5,736,197** |

The complete case spans 57 regions and 19,958,650 residents, but the *ranking*
population — after intersecting with the constraint screening — spans 16 regions.
Any statement about the successor model's coverage should use 16 / 5,736,197 when
talking about the ranking, and 57 / 19,958,650 only when talking about component
availability. They answer different questions and the smaller one is the one a
reader of the ranking needs.

This compounds the concentration caveat already recorded in the final policy: the
top 50 is 49 candidates in 양평군.

---

## 6. Verification summary

| gate | result |
| --- | --- |
| Ruff | clean |
| mypy (project) | clean |
| mypy `--strict src research` | clean, 86 source files |
| focused successor tests | 138 passed |
| migration tests (component model + integration) | 9 passed, 4 skipped (PostGIS tier) |
| migration on real data | 0021 → 0022 → 0023 applied; 2 runs labelled; 95,786 empty `component_scores`; 18,600 historical scores intact |
| **rollback on real data** | 0023 → 0021 drops the column with 18,600 scores intact; re-upgrade clean |
| real-data build | successor run 465 from source 47 |

### Migration and rollback

Validated against the real development snapshot, with a verified backup of the two
affected tables taken first (`pre0022_suitability.dump`, sha256
`2e66fb99…9d0a311`, confirmed restorable with `pg_restore -l`). A full copy was not
possible — the database is 16 GB against ~15 GiB of free disk — so the backup is
scoped to exactly what the migration touches.

The downgrade was exercised **before** the first successor run existed, which is
the window the persistence design says it is safe in: once successor rows exist,
their legacy columns are NULL by design and dropping `component_scores` would
leave nothing to fall back on.

---

## 7. Activation state

`is_activated()` now returns **True**: every blocker is closed, and the model may
produce and serve runs under its own identity.

**Activation is not a default switch.** `component_model.DEFAULT_COMPONENT_MODEL`
remains pinned to `suitability-components-zred-v1`, so every unpinned request and
every un-pinned shared link still resolves to the historical model. Successor run
465 is reachable only by explicit run id. Moving the default is a separate,
explicitly reviewed edit — step 4 of the switchover sequence — and
`validate_successor_policy()` now *asserts* that activation has not dragged the
default with it, so an accidental edit fails at import rather than in production.

Nine blockers are recorded closed with the basis each closed on; two data defects
remain published limitations rather than blockers.

---

## 8. Known limitations carried forward

Unchanged from the final policy, and none of them is solved here:

1. **`AIR_IMPACT_PROXY_GRAIN_AND_COVERAGE_UNRESOLVED`** — 22 regions and 6,349,306
   residents (24.13%) outside the model; the remedy is upstream geocoding or
   district-grain statistics.
2. **`RESIDENT_IMPACT_POPULATION_RESOLUTION_UNRESOLVED`** — one population value
   per SIGUNGU at one representative point; no available floor controls the
   placement artifact.
3. **Regional concentration** — top 10 is 10/10 양평군, top 50 is 49/50. Not a tie
   artifact. Deliberately not "fixed" by reweighting, because a vector chosen to
   break the concentration would be choosing a ranking. The response is
   presentational and belongs to Page 4/5.
4. **Ranking population spans 16 regions** (§5).
