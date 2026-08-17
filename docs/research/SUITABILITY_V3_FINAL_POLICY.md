# Suitability Successor V3 — final baseline policy

**Policy version:** `suitability-successor-policy-v1`
**Derivation version:** `suitability-successor-derivation-v1`
**Component model:** `suitability-components-successor-v1`
**Base SHA:** `30926eb26cff0e42bd6a1d5d4d99b73fe2be411e` (Phase 4 final)
**Status:** POLICY CLOSED — model **not yet activated** (engineering blockers remain)

---

## 0. Approval basis — read this before anything else

This policy was adopted by **project-owner delegated policy closure on 2026-08-17**.
The project owner explicitly delegated the four remaining Successor-V3 analytical
policy decisions so the project could be completed, authorising them to be made
from the strongest available Phase-3/Phase-4 evidence, the repository's own
contracts, the official source taxonomy, and conservative data-integrity
principles.

What that approval **is**: an explicit, recorded, versioned project-owner
judgement.

What it is **not**, stated plainly because the difference is the entire point:

- it is **not** external or independent expert review;
- it is **not** an AHP, elicitation, or stakeholder-consultation result;
- it is **not** a claim that these values are objectively or empirically correct;
- it is **not** derived from the data — Phase 4 closed that route.

Phase 4 returned NOT READY FOR PHASE 5 because three in-repo contracts require a
human policy owner for any served weighted composite. Those contracts are
satisfied here by the owner's delegation and by this document, not bypassed:
`docs/ANALYTICAL_METHODS.md` item 1 (written rationale per weight) is §1.2;
item 3 (reviewer recorded) is this section; and
`SUITABILITY_SUCCESSOR_MODEL_FOUNDATION.md` §6's prohibition on an *unapproved*
placeholder vector no longer applies, because the vector is now approved rather
than provisional.

Every decision below is versioned. A later policy version may change any of them.

---

## 1. Decision 1 — the weight vector

### 1.1 The approved vector

| component | weight |
| --- | --- |
| `existing_burden` | **0.25** |
| `air_impact_proxy` | **0.25** |
| `resident_impact` | **0.25** |
| `land_conversion` | **0.25** |

Registered as `SUCCESSOR_WEIGHT_PROFILES["baseline"]`. Sums to exactly 1;
validated at import.

### 1.2 What each weight asserts

- **`existing_burden` 0.25** — asserts that the waste-facility throughput a
  district already carries per resident weighs neither more nor less than the
  other three considerations. The platform's equity premise is that existing
  burden must count; this weight declines to claim *how much more* than the rest
  it should count.
- **`air_impact_proxy` 0.25** — asserts that the district's
  waste-generation-derived air-impact proxy counts equally, and deliberately does
  not elevate it, because the proxy is a generation rate rather than a measured
  emission or dispersion result.
- **`resident_impact` 0.25** — asserts that population-weighted proximity counts
  equally, and specifically declines to elevate it. Phase 4 measured that moving
  0.15 onto this component retains **1 of the top 50**, so any elevation would
  rewrite the ranking head and no evidence supports doing so. Its underlying
  geography is also the coarsest of the four, which is a further reason not to let
  it dominate.
- **`land_conversion` 0.25** — asserts that the share of the cell not already in a
  developed class counts equally. Siting on already-converted land is preferable,
  and this weight does not claim that preference outranks the other three.

### 1.3 Why equal rather than asymmetric

The data-derived route is closed: Phase 4 established CRITIC measures
normalization and analytical grain rather than information (switching one
component's strategy moved its σ by 11.9% while leaving the ranking identical at
Spearman 0.9999988, top-50 50/50). **CRITIC is diagnostic only and no CRITIC
vector may be persisted, served, or used to score a run.**

With no derivation available, every asymmetric vector would assert a *preference
ordering over the four considerations* that nothing in the repository, the source
data, or the measured evidence supports. Equal weighting is the one vector that
asserts no such ordering. **It is chosen for that property, not because it scored
well.**

Equal weighting is also the reference against which the entire Phase-3/Phase-4
evidence corpus was measured, so every published sensitivity number below is
calibrated against the vector actually adopted.

### 1.4 Measured stability of the approved vector

Perturbations on the ranking population (run 47, 500 m floor). Full matrix in
`v3_final_policy_evidence.json` → `weight_sensitivity`.

The asymmetry Phase 4 found is a property of the model, carried forward, not
resolved: the ranking head is `resident_impact`-determined. +0.15 onto it retains
1/50 of the top 50; the same shift onto any other component retains 44–49/50.

---

## 2. Decision 2 — the `resident_impact` distance floor

### 2.1 The approved floor

**500 m**, `resident_impact.PRODUCTION_DISTANCE_FLOOR`, `approved=True`.

### 2.2 Basis

500 m is exactly **one candidate grid cell**: the grid is `capital-grid-500m-v1`
with `GRID_CELL_METERS = 500`. The floor therefore says *this model does not
resolve distance below the size of the thing it is scoring*. That is a
reproducible in-repo fact rather than a tuned value, and it is the smallest floor
carrying a coherent interpretation.

### 2.3 Evidence — the floor is near-inert in the composite

Adjacent-floor comparison under the approved weights on the ranking population.
Phase 4 only compared every floor against 500 m; these are the steps between the
options actually adjacent to each other.

| comparison | Spearman | top-50 retained |
| --- | --- | --- |
| 500 m vs 1 km | 0.9999593 | 50 / 50 |
| 1 km vs 2 km | 0.9996833 | 50 / 50 |
| 2 km vs 5 km | 0.9989457 | 49 / 50 |

No floor is materially more stable than its neighbour, so the selection rule
("smallest defensible; on a tie prefer the simpler, smaller local interpretation")
resolves to 500 m.

### 2.4 What the floor does NOT fix — stated, not solved

The floor does not repair the component's geography. Population is one value per
SIGUNGU held at a single representative point, and every candidate floor is
smaller than the average region's own equivalent-circle radius. The within-region
score range — an **upper bound** on the placement artifact, not the artifact
itself, since part of it is genuine proximity variation to *other* regions —
barely moves:

| floor | mean within-region score range |
| --- | --- |
| 500 m | 46.71 |
| 1 km | 44.06 |
| 2 km | 41.52 |
| 5 km | 40.55 |

A tenfold increase in the floor buys a 13% reduction. **No available floor
controls this artifact**, so 500 m does not claim to; the defect is carried as an
accepted limitation (§6).

---

## 3. Decision 3 — the production land-cover registry

### 3.1 The approved registry

`successor-land-cover-l2-v1`, `class_level=2`, `approved=True`,
`land_conversion.PRODUCTION_REGISTRY`.

| bucket | codes |
| --- | --- |
| **DEVELOPED** | 110 주거지역 · 120 공업지역 · 130 상업지역 · 140 문화·체육·휴양지역 · 150 교통지역 · 160 공공시설지역 |
| **NOT DEVELOPED** | the other 16 codes (210, 220, 230, 240, 250, 310, 320, 330, 410, 420, 510, 520, 610, 620, 710, 720) |
| **EXCLUDED from the denominator** | none |
| **AMBIGUOUS (flagged, still resolved)** | 230, 420, 620, 710, 720 |

All 22 published L2 codes are known; every code lands in exactly one bucket, so
the registry is total and no observed class can fall through unclassified.

### 3.2 Why developed = 1xx and only 1xx

`100 시가화건조지역` is the single grouping the source taxonomy **itself** labels
as urbanised/built-up, so it is the only developed/not-developed boundary that can
be *read off the published structure* rather than asserted. Every 1xx child is a
built land use by the source's own definition, so the grouping is adopted whole.

This is **not** an authority's designation. No official developed-vs-natural
classification exists in the source or anywhere in this repository. This is an
explicit project reading, versioned and revisable.

### 3.3 Direction — confirmed

`land_conversion` is `LOWER_RAW_IS_BETTER`: a larger not-already-developed
(conversion-exposed) share is the **worse** screening outcome, because siting on
already-converted land converts less. Approved as implemented.

---

## 4. Decision 4 — ambiguous-class policy

### 4.1 The rule

**Ambiguity must never improve a candidate's score.** Because the component is
`LOWER_RAW_IS_BETTER`, counting a class as *developed* removes it from the
conversion-exposed numerator and **raises** the score. Every contested class is
therefore resolved to **NOT developed** — the direction that leaves a candidate
looking worse, never better — and stays flagged so the contested call is auditable.

| class | name | resolution | why contested |
| --- | --- | --- | --- |
| 230 | 시설재배지 | NOT developed | artificial structures over a continuing agricultural use; the source files it under 2xx 농업지역 |
| 420 | 인공초지 | NOT developed | managed, but not built-up |
| 620 | 인공나지 | NOT developed | construction sites, earthworks, quarries — arguably the most developed non-1xx class, and the largest exposure (24,411 cells) |
| 710 | 내륙수 | NOT developed, in denominator | water as conversion-exposed is a contested reading, but it is the conservative one |
| 720 | 해양수 | NOT developed, in denominator | as 710 |

### 4.2 Water: the Phase-3 exclusion was rejected **on evidence**

The Phase-3 research registry removed 7xx from numerator and denominator, so the
metric read "share of the *land* that is not developed". Measured on the real
dataset, that reading systematically improves water-dominated cells: a cell that
is mostly river or sea is judged only on its small land remainder, and if that
remainder happens to be built, the cell scores as though there were nothing left
to convert.

| water share of cell | cells | mean developed-share-of-land | scoring ≥ 0.95 |
| --- | --- | --- | --- |
| < 20% | 39,089 | 0.1894 | 351 (0.90%) |
| 20–50% | 738 | 0.2217 | 8 (1.08%) |
| **≥ 50%** | **679** | **0.2951** | **45 (6.63%)** |

A water-dominated cell was **7.4× more likely** to reach a near-perfect score
under exclusion. That is ambiguity improving a score, so the exclusion is
rejected. Water stays in the denominator and counts as conversion-exposed: a
facility cannot use open water without converting it, and reclamation is
conversion of a particularly consequential kind.

Keeping the excluded set empty also removes an entire configuration axis — there
is one denominator, the evaluated area, and no class silently leaves it.

### 4.3 Class sensitivity — the cost of each contested call

Measured end to end on the ranking population, approved weights. Identical at
500 m and 2 km, confirming these are floor-independent.

| variant | Spearman | top-50 retained | eligible Δ |
| --- | --- | --- | --- |
| 620 → developed | 0.9838 | 25 / 50 | 0 |
| 230 + 420 + 620 → developed | 0.9278 | 26 / 50 | 0 |
| water excluded (Phase-3 reading) | 0.9915 | **16 / 50** | 0 |

Water exclusion has the largest effect on the ranking head despite the highest
rank correlation — precisely the kind of change a Spearman figure alone hides.

The approved registry also produces the **lowest mean** `land_conversion` score of
every variant (18.43 against 21.27 water-excluded, 23.06 with 620 developed, 36.76
with all three developed), confirming it is the conservative choice by
construction, not merely by intention.

### 4.4 Missingness, eligibility, provenance, API

- **Developed share** — ambiguous classes never count as developed.
- **Denominator** — ambiguous classes stay in it; nothing is excluded.
- **Missing ≠ ambiguous** — a class observed in a cell but **absent from
  `known_class_codes`** makes the observation `UNCLASSIFIED_LAND_COVER_CLASS`
  (unavailable), never silently non-developed. `NO_COVERAGE` is unavailable, never
  "0% developed". Zero-fill remains permanently forbidden.
- **Eligibility** — unchanged by ambiguity; every variant moved the eligible count
  by exactly 0.
- **Provenance** — `registry.sanitized_summary()` (id, buckets, ambiguous codes,
  `approved`, note) travels in every observation.
- **API** — a successor result must expose `registry_id` and the ambiguous-class
  set alongside the score, so a consumer can see which contested calls produced it.

---

## 5. Decision 5 — the ranking population (found during closure)

**This was not one of the four delegated questions. It was found while measuring
them, and it changes the published result, so it is recorded as a decision.**

The successor model **re-scores; it never re-screens.** The historical constraint
screening (zoning, protected areas, road access) stays authoritative.

Measured on run 47, only `ELIGIBLE` candidates carry a rank or a score at all:

| status | candidates | ranked | scored |
| --- | --- | --- | --- |
| ELIGIBLE | 17,501 | 17,501 | 17,501 |
| REVIEW_REQUIRED | 18,132 | 0 | 0 |
| EXCLUDED | 12,260 | 0 | 0 |

Phase 4's "strict complete case" of **33,980** is a component-**availability**
set computed over all 47,893 candidates. It contains **8,933 EXCLUDED** and
**11,313 REVIEW_REQUIRED** candidates. Ranking it whole would publish a siting
recommendation over locations the constraint screening had already set aside —
which `docs/ANALYTICAL_METHODS.md` Weighting Policy item 2 forbids: burden and
demand indicators alone must never be presented as siting suitability.

**Approved rule:** ranking population = historical `ELIGIBLE` ∩ strict complete
case = **13,734** candidates on run 47.

### 5.1 This materially changes the published ranking head

| ranking population | top 50 by region |
| --- | --- |
| **approved** (ELIGIBLE ∩ complete case) | 경기도 양평군 **49** · 경기도 안성시 1 |
| unfiltered complete case (Phase-4-comparable) | 서울 광진구 25 · 서대문구 22 · 구로구 2 · 양평군 1 |

Phase 4's published concentration (광진구/서대문구) is an artifact of ranking
constraint-excluded candidates. It should not be cited going forward.

---

## 6. Model scope and limitations — publish these with any result

### 6.1 Scope

| measure | value |
| --- | --- |
| candidates in run 47 | 47,893 |
| strict complete case (all four components) | 33,980 (70.95%) |
| **ranking population** (ELIGIBLE ∩ complete case) | **13,734** |
| regions in the complete case | 57 / 79 |
| structurally excluded | 22 regions · 6,349,306 residents (24.13%) |

### 6.2 Accepted limitations — carried, not solved

Neither blocks activation; neither can be closed by a decision, because both need
data that does not exist locally. Recorded in `policy.ACCEPTED_LIMITATIONS`.

1. **`AIR_IMPACT_PROXY_GRAIN_AND_COVERAGE_UNRESOLVED`** — one ingestion-level
   defect affects two components: 99 facility rows carrying 1,907,717.3 t/yr are
   ungeocoded, and RCIS reports seven large Gyeonggi cities at CITY grain while
   `regions` holds only their child 구. **Cost: 22 regions, 6,349,306 residents
   (24.13%) outside the model.** The CITY-grain projection was evaluated
   numerically and rejected — it recovers the component for 5,536 candidates but
   **zero eligible** ones. The numerator basis stays total generation, as
   implemented and measured; origin-based incinerated tonnage is a candidate for a
   later policy version, not a silent alternative.
2. **`RESIDENT_IMPACT_POPULATION_RESOLUTION_UNRESOLVED`** — one population value
   per SIGUNGU at a single representative point. **Cost: the within-region score
   range only falls 46.71 → 40.55 across a tenfold floor increase**, so no
   available floor controls the placement artifact.

### 6.3 Regional concentration — the largest interpretive caveat

Under the approved policy the top 10 is **10/10 양평군** and the top 50 is
**49/50 양평군**.

This is **not** a tie-ordering artifact: the composite has 13,672 distinct values
across 13,734 candidates, so the head is genuinely score-determined.

It is coherent — a large rural county with abundant unconstrained land, low
existing burden, low generation, and low population proximity wins on all four
components at once — but a top-50 that is 98% one county is **not usable as a
ranking of places**, and concentrating every recommendation on one rural community
is itself an equity concern.

**This was deliberately not "fixed" by reweighting.** Any vector chosen because it
breaks the concentration would be choosing a ranking — exactly the failure mode
Phase 4 identified and §1.3 exists to avoid. The correct responses are
presentational and are handed to the Page 4/5 lanes: read the ranking at region
granularity, and/or cap candidates shown per region. Neither changes the policy.

### 6.4 Standing disclaimers

Output is analytical decision support. It is never a legal, permitting,
engineering, environmental-review, or final siting determination, and it is not a
"best site" or "recommended site" judgement.

---

## 7. Policy inputs, consolidated (machine-readable mirror)

`policy.successor_snapshot()` emits all of this as JSON, including
`weight_profiles`, `weight_rationale`, `policy_closure_approval`,
`closed_blockers`, `accepted_limitations`, and `ranking_population_rule`.

| input | value |
| --- | --- |
| policy version | `suitability-successor-policy-v1` |
| derivation version | `suitability-successor-derivation-v1` |
| component model | `suitability-components-successor-v1` |
| component order | `existing_burden, air_impact_proxy, resident_impact, land_conversion` |
| weights | 0.25 / 0.25 / 0.25 / 0.25 |
| missing-component policy | `STRICT_ALL_COMPONENTS_REQUIRED` (zero-fill permanently forbidden) |
| ranking population | historical `ELIGIBLE` ∩ strict complete case |
| normalization | `BOUNDED_RATIO` for `land_conversion`; percentile rank for the other three |
| resident distance floor | 500 m (one grid cell) |
| land-cover registry | `successor-land-cover-l2-v1`, L2, developed = 1xx, no exclusions |
| ambiguous classes | 230, 420, 620, 710, 720 — all resolved NOT developed |
| CRITIC | diagnostic only; never persisted, served, or used to score |
| stability | metrics and axes defined; thresholds validated in Phase 5 |
| default-run resolution | model-aware, **pinned to historical**; switchover only by explicit configuration change |

---

## 8. What is still open

Policy is closed. Three **engineering** blockers remain, all owned by the backend
lane and all closing in Phase 5:

1. `SUCCESSOR_RUN_WRITE_PATH_NOT_IMPLEMENTED`
2. `SUCCESSOR_STABILITY_THRESHOLDS_UNVALIDATED`
3. `SUCCESSOR_MODEL_AWARE_DEFAULT_RUN_NOT_IMPLEMENTED`

`policy.is_activated()` therefore still returns `False`, and
`assert_activated()` still raises. **An approved policy is not an activated
model** — that distinction is preserved deliberately and is asserted by tests.

---

## 9. Evidence

- `docs/research/v3_final_policy_evidence.json` — the full measured matrix
  (per-floor eligibility and distributions, screening-status intersection,
  adjacent-floor sensitivity, within-region artifact, weight perturbations, class
  sensitivity, registry variants).
- `backend/research/run_policy_closure.py` + `backend/research/suitability_v3_policy/`
  — the read-only harness that produced it, measuring the **production** policy
  objects rather than a research stand-in.
- Control: the Phase-4 gate re-run on this environment reproduces Phase 4 exactly
  (B16 28,853 → 40,506 (+11,653); B17 79 → 59 regions; 33,980 strict; CRITIC
  viable), so every number here is comparable with Phase 4's.
