# Suitability Successor V3 — Phase 4: explicit policy gate

**Status:** research, correctness fixes, and policy decisions. **The successor model
is NOT activated.** No successor run is written, no weight is persisted, no default
run moves, no historical value is touched, and no frontend file is changed.

**Verdict: PHASE 4 GREEN WITH EXPLICIT LIMITATION.**
**Recommendation: NOT READY FOR PHASE 5.**

Four correctness blockers are resolved and four policy questions are decided on
measured evidence. Four remain **OPEN** — final weights, the resident distance
floor, the land-cover class registry, and the ambiguous land classes — and each is
open because the evidence does not support an answer, not because it was not
examined. Phase 5 must not begin until they close.

Every claim below is labelled:

| Label | Meaning |
| --- | --- |
| **FACT** | measured on the real dataset |
| **BUG FIX** | a runtime defect corrected in this phase |
| **POLICY DECISION** | an analytical choice made here, with its evidence |
| **OPEN POLICY** | deliberately not decided |
| **RESEARCH DIAGNOSTIC** | measured to inform a decision; never a production value |

---

## 1. Base and scope

| | |
| --- | --- |
| Branch | `feat/suitability-v3-phase4-policy-gate` |
| Phase-3 base SHA | `b915901266277dddb532583016cc4c5cad2e7aa8` |
| Database | LOCAL PostGIS, read-only, docker volume `waste-equity-platform_pgdata` |
| Alembic | `0021` |
| Suitability run | 47 (`SUCCEEDED`, `suitability-policy-v1` / `suitability-screening-v2`) |
| Candidate grid | `capital-grid-500m-v1`, 47,893 candidates, 79 SIGUNGU, 3 SIDO |
| Reference years | facilities 2024 · waste statistics 2024 · population 2024 (`SGIS_TOTAL_POPULATION`) |
| Land cover | statistics version 1, `land-cover-cell-stats-v1`, EPSG:5186 |
| Capital-region population | 26,307,956 |

The snapshot is byte-identical to Phase 3's (same alembic version, run id, candidate
count, region count), so BEFORE and AFTER are measured on the same data. **The
source snapshot was not changed at any point.**

---

## 2. Phase 4A — correctness blockers

### 2.1 B16 — `land_conversion` float ↔ exact-Decimal boundary — **RESOLVED (BUG FIX)**

**FACT.** The defect reproduces exactly. Across all 40,427 covered cells the class
sum exceeds its own denominator for 11,678 of them, by:

| statistic | value |
| --- | --- |
| max absolute excess | **7.3292501 × 10⁻⁶ m²** (7.3 square micrometres) |
| max relative excess | **2.93 × 10⁻¹¹** |
| cells exceeding by > 10⁻⁶ m² | 3 |
| cells exceeding by > 10⁻⁴ m² | **0** |
| cells exceeding by > 1 m² | **0** |

**FACT.** The excess scales with magnitude, which is what fixes the shape of the
tolerance. Measured by denominator bucket:

| denominator range (m²) | cells | max absolute excess (m²) | max relative excess |
| --- | --- | --- | --- |
| 0.5 – 49,688 | 78 | 1.33 × 10⁻⁸ | 3.07 × 10⁻¹³ |
| 50,042 – 99,765 | 68 | 2.65 × 10⁻¹⁰ | 3.82 × 10⁻¹⁵ |
| 100,044 – 149,496 | 80 | 8.60 × 10⁻¹⁰ | 6.46 × 10⁻¹⁵ |
| 150,122 – 199,787 | 115 | 1.09 × 10⁻⁹ | 6.77 × 10⁻¹⁵ |
| 200,084 – 249,959 | 144 | 1.12 × 10⁻⁹ | 4.77 × 10⁻¹⁵ |
| 250,015 – 250,229 | 11,193 | 7.33 × 10⁻⁶ | 2.93 × 10⁻¹¹ |

`evaluated_area_m2` and `class_area_m2` are stored `double precision`; the component
does exact `Decimal` arithmetic. The stored total and the exact sum of the stored
parts are two different float64 computations of the same quantity.

**BUG FIX.** An explicit tolerance contract, in
`successor/land_conversion.py`:

```
AREA_RECONCILIATION_RELATIVE_TOLERANCE = Decimal("1e-9")   # dimensionless
AREA_UNIT = "m2"

excess    = class_area_sum − denominator_area
tolerance = denominator_area × AREA_RECONCILIATION_RELATIVE_TOLERANCE
excess > tolerance  ⇒  CLASS_AREA_EXCEEDS_DENOMINATOR (unchanged)
```

* The tolerance is **relative, dimensionless**, not an absolute area — float
  representation error is proportional to magnitude, and the bucket table shows the
  relative bound holding across four orders of magnitude of denominator while an
  absolute one would not.
* `1e-9` leaves ~34× headroom over the worst observed artifact (2.93 × 10⁻¹¹) while
  staying five orders of magnitude below the smallest excess any cell in the dataset
  comes near (no cell exceeds by even 10⁻⁴ m²).
* Genuine detection is preserved: a materially invalid class sum is still reported
  and never clamped.
* Within the tolerance a share can land a hair above 1, which bounded-ratio
  normalization rejects by contract. Such shares are clamped into [0,1] and the
  clamp is **recorded** (`share_clamped_to_unit_interval`), never silent.
* Every observation now carries `class_area_excess_m2`,
  `area_reconciliation_tolerance_m2`, `area_reconciliation_relative_tolerance`,
  `area_unit`, and `class_area_within_reconciliation_tolerance` — including rejected
  cells, so a reader sees how far outside a cell fell.

**Boundary tests** (`tests/test_successor_land_conversion.py`, 11 new): exact
equality · inside tolerance · exactly at the tolerance · one ULP outside · 1 m²
outside · a doubled overlay · the worst real-data artifact · the over-unity clamp ·
tolerance scaling on a 0.5 m² sliver.

**FACT — recovery.**

| | before | after |
| --- | --- | --- |
| available observations | 28,853 (60.24%) | **40,506 (84.58%)** |
| **recovered candidates** | — | **11,653** |
| clamped to [0,1] | — | 2,114 |
| remaining unavailable | 19,040 | **7,387** |
| remaining reasons | mixed | `NO_LAND_COVER_COVERAGE` + `NO_EVALUATED_AREA` only |

After the fix, `land_conversion`'s only remaining gap is the 7,387 genuinely
uncovered cells (15.42%) that Phase 3 identified as the real one.

---

### 2.2 B17 — ungeocoded facilities read as zero burden — **RESOLVED (BUG FIX)**

**FACT.** Confirmed, and larger than Phase 3 described. For reference year 2024:

| `region_mapping_status` | rows | with `region_id` | with throughput | throughput (t/yr) |
| --- | --- | --- | --- | --- |
| `EXACT_MATCH` | 552 | 552 | 552 | 6,865,073.3 |
| `REQUIRES_GEOCODE` | **99** | **0** | **99** | **1,907,717.3** |

All 99 unmapped rows carry a real throughput. The Phase-3 extraction inner-joins
`regions`, so **21.7% of all located facility throughput was silently dropped from
every region's total.**

**FACT — the root cause is B6, not geocoding noise.** The 99 rows name exactly seven
source reporting units:

| RCIS unit | rows | throughput (t/yr) |
| --- | --- | --- |
| 경기 고양시 | 19 | 222,457.1 |
| 경기 부천시 | 6 | 151,117.2 |
| 경기 성남시 | 8 | 335,085.9 |
| 경기 수원시 | 5 | 326,301.5 |
| 경기 안산시 | 12 | 411,241.1 |
| 경기 안양시 | 3 | 110,851.8 |
| 경기 용인시 | 46 | 350,662.7 |

These are the same seven large Gyeonggi cities RCIS reports at CITY level. The
`regions` table holds only their **child 구** at SIGUNGU level (수원시 장안구,
수원시 권선구, …) and contains **no CITY-grain geography at all** — only `SIDO` (3)
and `SIGUNGU` (79). The name join therefore cannot succeed.

**FACT.** 25 of 79 SIGUNGU had zero facility rows and so read zero burden — the
**best possible** value on a `LOWER_RAW_IS_BETTER` scale. 20 of those 25 are the
child districts of the seven CITY units. The other five — 종로구, 광진구, 영등포구,
서초구, 미추홀구 — are genuinely facility-free, and their zero is a real observation
that must survive.

**BUG FIX.** `successor/existing_burden.py` gains an explicit
`UnmappedFacilityEvidence` input and `contract.py` two reason codes:

| situation | behaviour |
| --- | --- |
| no facility rows, no unmapped evidence | **available**, zero is an observed fact (unchanged) |
| unmapped evidence, no located rows of its own | **unavailable** — `UNMAPPED_FACILITY_EVIDENCE` |
| unmapped evidence *and* located rows | **available**, `is_partial` with `UNMAPPED_FACILITY_EVIDENCE_UNDERCOUNT` |

The unmapped throughput is recorded as *evidence of an undercount* and is **never
added to the numerator**. The module never infers which region unmapped rows cover:
`UnmappedFacilityEvidence` requires an explicit `reason` and `coverage_basis` from
the caller, so the resulting unavailability is auditable back to its rule. In this
phase the coverage relation is reconstructed from official region names and is
labelled `DERIVED_FROM_REGION_NAME` throughout — it is **not** an official mapping,
and no facility coordinate is invented.

**FACT — corrected coverage.**

| | before | after |
| --- | --- | --- |
| available regions | 79 / 79 | **59 / 79** |
| withdrawn regions | — | **20** (all CITY-grain children) |
| flagged undercount | — | 0 |
| observed-zero regions retained | 25 | **5** (the genuinely facility-free ones) |
| candidates with `existing_burden` | 47,340 (98.85%) | **41,804 (87.29%)** |

**This tightening cost the model nothing.** The 20 withdrawn regions were already
excluded by `air_impact_proxy` — making `existing_burden` optional gains exactly
**zero** candidates (§3.2). B6 and B17 are one structural defect surfacing in two
components.

---

### 2.3 B18 — `percentile_ranks` is O(n²) — **RESOLVED (BUG FIX)**

**FACT.** `policy.percentile_ranks` counted strictly-lesser values with a linear
scan per key. Quadratic scaling confirmed (n → 4× time on doubling):

| n | time |
| --- | --- |
| 2,000 | 0.236 s |
| 4,000 | 1.021 s |
| 8,000 | 4.421 s |
| **47,893** | **267.450 s** |

**BUG FIX.** On the sorted values, "how many values are strictly less than v" is
exactly `bisect_left`. Ranks are then cached per distinct value, since a rank is a
function of the value alone.

| | before | after | speedup |
| --- | --- | --- | --- |
| n = 47,893 | 267.450 s | **0.117 s** | **2,285×** |

**The definition is unchanged and the output is byte-identical.** This function
feeds the historical `equity` and `demand` scores on every stored run, so the
original body is kept **verbatim in the test file as an oracle** and the two are
compared directly rather than against hand-written expectations. Coverage: empty ·
singleton · two distinct · all identical · ties at the bottom · ties at the top ·
negatives · all-negative · **mixed Decimal exponents of equal values** (the case the
per-value cache could have split) · high-precision neighbours · a rank forcing
ROUND_HALF_EVEN at 6 dp · zeros with positives · a 1,500-value heavy-tie population ·
insertion-order independence · a non-quadratic complexity guard.

No historical formula, weight, threshold, or stored value changed. The full PostGIS
suite confirms it (§7).

---

### 2.4 B19 — 553 candidates with no SIGUNGU code — **RESOLVED (expected geography, no fix applied)**

**FACT.** Traced end to end.

| | |
| --- | --- |
| total | 553 (379 경기도, 174 인천광역시, 0 서울) |
| status | 98 `EXCLUDED`, 455 `REVIEW_REQUIRED`, **0 `ELIGIBLE`** |
| already flagged | all 455 carry `AMBIGUOUS_OR_MISSING_SIGUNGU` (plus `MISSING_EQUITY_COMPONENT`, `MISSING_DEMAND_COMPONENT`) |
| centroid inside its SIDO polygon | **553 / 553** |
| centroid inside any SIGUNGU polygon | **0 / 553** |

Not ambiguous — genuinely outside every SIGUNGU polygon. The cause is that the two
geometry layers do not coincide:

| SIDO | SIDO area | area not covered by its SIGUNGU |
| --- | --- | --- |
| 서울특별시 | 617.52 km² | 19.63 km² |
| 인천광역시 | 1,026.82 km² | 48.80 km² |
| 경기도 | 10,338.47 km² | 106.07 km² |

The candidate grid is clipped against the SIDO layer while SIGUNGU attribution is an
independent point-in-polygon lookup, so a centroid landing in the inter-layer gap
gets a SIDO code and no SIGUNGU code. Distance to the nearest SIGUNGU:

| SIDO | n | min | median | p90 | max | within 250 m | beyond 1 km |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 인천 | 174 | 1.1 m | 130.3 m | 406.1 m | 910.5 m | 128 | 0 |
| 경기 | 379 | 0.7 m | 161.8 m | 525.9 m | 1,112.6 m | 238 | 5 |

**Classification: expected geography** — a boundary-generalization artifact between
two independently sourced layers, already modelled explicitly by the historical
engine. Not a data bug and not a deterministic mapping defect.

**No fix applied. No code fabricated.** Snapping to the nearest SIGUNGU would be a
new policy (a snapping contract), not the repair of a defect, and would be plainly
wrong at 1.1 km.

**Production eligibility consequence: zero.** None of the 553 is `ELIGIBLE`, and
none can receive a region-level component under any missing-data policy. The
successor's maximum addressable population is therefore 47,340 of 47,893 (98.85%);
the 553 are reported, never silently dropped.

---

## 3. Phase 4B — data policy gate

### 3.1 Corrected component coverage — **FACT**

| component | grain | available candidates | share | available regions |
| --- | --- | --- | --- | --- |
| `existing_burden` | SIGUNGU | 41,804 | 87.29% | 59 / 79 |
| `air_impact_proxy` | SIGUNGU | 38,592 | 80.58% | 57 / 79 |
| `resident_impact` | candidate | 47,893 | 100.00% | — |
| `land_conversion` | candidate | 40,506 | 84.58% | — |
| **strict complete case** | | **33,980** | **70.95%** | **57 / 79** |

Residents represented by the complete case: **19,958,650 of 26,307,956 (75.87%)**.

### 3.2 Missing-component policy — **POLICY DECISION: `STRICT_ALL_COMPONENTS_REQUIRED`**

**FACT — what each option costs.**

| policy | eligible | share | gain | regions | residents |
| --- | --- | --- | --- | --- | --- |
| STRICT (all four) | 33,980 | 70.95% | — | 57 | 19,958,650 |
| optional `existing_burden` | 33,980 | 70.95% | **+0** | 57 | 19,958,650 |
| optional `air_impact_proxy` | 34,738 | 72.53% | +758 | 59 | 20,018,228 |
| optional `land_conversion` | 38,592 | 80.58% | +4,612 | 57 | 19,958,650 |
| ZERO_FILL | — | — | — | — | **permanently forbidden** |

**FACT — the admitted groups are not exchangeable.** A renormalized composite puts
three-component and four-component units in one ranking, which is only meaningful if
the two groups are alike on the components they *do* share. They are not. Comparing
mean retained-component scores:

| optional component | extra units | retained component | complete-case mean | admitted-group mean | difference |
| --- | --- | --- | --- | --- | --- |
| `air_impact_proxy` | 758 | `resident_impact` | 49.7948 | 81.0999 | **+31.31** |
| | | `existing_burden` | 33.2861 | 42.2482 | +8.96 |
| | | `land_conversion` | 20.2556 | 9.4130 | −10.84 |
| `land_conversion` | 4,612 | `existing_burden` | 33.2861 | 56.6790 | **+23.39** |
| | | `resident_impact` | 49.7948 | 53.8350 | +4.04 |
| | | `air_impact_proxy` | 31.9508 | 29.8011 | −2.15 |

The 758 units admitted by dropping the air requirement are 옹진군 and 연천군 — remote
island and border districts that score 31 points higher on `resident_impact`.
Ranking them beside the complete cases on a renormalized three-component composite
would promote them for reasons unrelated to siting quality.

**Decision.** STRICT. Missing never equals zero, and it never equals "score them
anyway on a different basis". The measured price — 29.05% of candidates and 24.13%
of residents — is carried forward as an explicit limitation, not as a solved problem.
The `optional existing_burden` variant was measured too and gains literally nothing.

### 3.3 Air-impact grain — **POLICY DECISION (scoring time) + DEFERRED (root cause)**

**FACT — the 22 missing regions have two different causes**, which Phase 3 reported
as one:

| cause | regions | detail |
| --- | --- | --- |
| no stream rows at all | 20 | child districts of the seven CITY-grain cities |
| 3 of 4 canonical streams | 2 | 옹진군, 연천군 — `INDUSTRIAL_FACILITY` unreported |

**FACT — what each option costs.**

| option | regions recovered | candidates recovered | residents recovered | **eligible candidates recovered** |
| --- | --- | --- | --- | --- |
| **A** strict SIGUNGU | — | — | — | — |
| **B** CITY-grain projection | 20 | 5,536 | 6,289,728 | **0** |
| **C** partial / optional component | — | — | — | +758 (see §3.2, rejected) |

Option A excludes 22 regions, 8,748 candidates, 6,349,306 residents (24.13%).

**Option B is available and was evaluated numerically, not dismissed.** All seven
CITY units carry all four canonical streams and a known child-population denominator,
so a CITY per-capita rate is computable:

| CITY unit | children | population | derived per-capita (kg/인/년) |
| --- | --- | --- | --- |
| 고양시 | 3 | 1,044,968 | 3,286.8175 |
| 부천시 | 3 | 794,082 | 1,383.5125 |
| 성남시 | 3 | 900,867 | 2,139.0151 |
| 수원시 | 4 | 1,224,979 | 1,165.8209 |
| 안산시 | 2 | 701,551 | 2,010.5582 |
| 안양시 | 2 | 545,800 | 2,285.8512 |
| 용인시 | 3 | 1,077,481 | 2,330.3007 |

**Decision: Option A at scoring time. Option B rejected for production.** Three
reasons, in order of force:

1. **It recovers zero eligible candidates.** Under STRICT a candidate needs all four
   components. The 20 districts B would supply with air are exactly the 20 that lose
   `existing_burden` to the identical reporting-grain gap (§2.2), so the intersection
   does not move: 33,980 either way. B buys representation on one component and no
   eligibility at all.
2. **The gap cannot be closed symmetrically.** Per-capita generation can at least be
   argued to project; facility throughput cannot. A facility sits in exactly one
   district — spreading a city's throughput per capita across its children would
   assert that each district bears an equal share of a plant physically in one of
   them. Projecting air but not burden would leave the model's two region-level
   components on different geographies.
3. **The uniformity assumption is untestable here.** No city in the dataset is
   reported at both grains, so "per-capita generation is uniform within the city"
   cannot be checked against anything.

**DEFERRED — the real remedy is upstream.** Both halves are ingestion-level: the
facility rows carry an `address`, so geocoding would place each facility in its
actual district; district-grain waste statistics would close the other half. Until
then **22 regions and 6,349,306 residents (24.13% of the capital region) stay
outside the model**, and that is the single largest limitation of this phase.

**Recorded requirement.** If a CITY-derived value is ever admitted, the API, UI, and
provenance must label it as a derived coarser-geography value, never as a
child-district observation. No frontend wording is implemented in this phase.

**OPEN.** The numerator basis (total generation vs origin-based incinerated tonnage)
remains a separate unresolved choice on the same component.

### 3.4 Resident distance floor — **OPEN POLICY**

**No floor is approved. 2 km is explicitly not a default.**

**RESEARCH DIAGNOSTIC — the floor's importance depends on the unapproved weight.**

`resident_impact` alone, all 47,893 candidates:

| comparison | Spearman | top-10 | top-50 | max rank move |
| --- | --- | --- | --- | --- |
| 500 m vs 1 km | 0.99977 | 10/10 | 50/50 | — |
| 500 m vs 2 km | 0.99870 | 10/10 | 50/50 | — |
| 500 m vs 5 km | 0.99560 | 10/10 | **33/50** | **20,979** |

Four-component equal-weighted composite, corrected complete case (n = 33,980):

| comparison | Spearman | top-10 | top-50 |
| --- | --- | --- | --- |
| 500 m vs 1 km | 0.99989 | 10/10 | 50/50 |
| 500 m vs 2 km | 0.99945 | 9/10 | 49/50 |
| 500 m vs 5 km | 0.99815 | 9/10 | **49/50** |

The floor replaces a third of the component's top 50 and is nearly inert inside an
equal-weighted composite. **Its significance is a function of `resident_impact`'s
weight, which is itself OPEN (§4.3), so the floor cannot be settled first.**

Underneath sits a defect no floor can fix: the finest population geography is one
value per SIGUNGU at a single representative point, and every proposed floor is
smaller than the average region's own equivalent-circle radius. A floor chosen now
would be calibrated against the arbitrary placement of that point rather than
against anything on the ground.

### 3.5 Land-cover class registry — **OPEN POLICY**

`land_conversion.PRODUCTION_REGISTRY` **is and remains `None`**. The Phase-3 L2
registry (`RESEARCH-ONLY-l2-first-digit-v0-NOT-PRODUCTION-POLICY`, `approved=False`)
is used here for measurement only and **must not produce, rank, or publish any
candidate result.**

### 3.6 Ambiguous land classes — **OPEN POLICY**

**FACT (Phase 3, unchanged).** 26,795 of 28,853 then-available cells — **92.87%** —
touch at least one contested class:

| class | name | cells | why contested |
| --- | --- | --- | --- |
| 420 | 인공초지 | 26,066 | artificial grassland — managed but not built |
| 620 | 인공나지 | 24,411 | artificial bare ground — frequently construction sites; arguably the most developed non-`1xx` class, classified here as *not* developed |
| 710 | 내륙수 | 16,685 | inland water — excluded from both numerator and denominator |
| 230 | 시설재배지 | 16,152 | protected cultivation — structures over agricultural use |
| 720 | 해양수 | 408 | marine water — same treatment as 710 |

Flipping 620 alone would move 24,411 cells. Exposure is near-total, so the ambiguity
is a primary driver of this component's values, not a rounding detail. **Unresolved.**

---

## 4. Phase 4C — normalization, CRITIC, weights, stability

### 4.1 Normalization — **POLICY DECISION**

`land_conversion` is the only component whose raw value is a bounded [0,1] ratio, so
it is the only one that supports both strategies — which makes it the clean
experiment. On the corrected complete case (n = 33,980):

| strategy | mean | **stdev** | skew | unique |
| --- | --- | --- | --- | --- |
| `BOUNDED_RATIO` | 20.2556 | **24.9152** | 1.5160 | 28,667 |
| `PERCENTILE_RANK` | 50.6653 | **27.8694** | 0.0942 | 29,976 |

| | |
| --- | --- |
| Spearman between the two | **0.9999988231** |
| top-50 overlap | **50 / 50** |

**FACT.** The two strategies are **rank-equivalent** — they produce the same ranking
and the identical top 50 — while differing in standard deviation by **+11.9%**.
Percentile ranking flattens the distribution to near-uniform (skew 1.516 → 0.094;
stdev 27.87 is 96.5% of the theoretical uniform maximum of 28.87).

**Decision.** `BOUNDED_RATIO` wherever the raw value is a bounded ratio
(`land_conversion` only); percentile rank elsewhere, because the other three raws are
unbounded rates with no natural bound to divide by. Percentile-ranking a
bounded-ratio component buys **no ranking change** and inflates its derived weight,
so there is no case for it.

The consequence is a **mixed-strategy component set**, and that is not worked around
— it is exactly why CRITIC fails (§4.2).

### 4.2 CRITIC — **POLICY DECISION: DIAGNOSTIC ONLY, unsuitable for runtime weighting**

**RESEARCH DIAGNOSTIC.** A successor CRITIC is *mathematically* defined on the
corrected population — no zero-variance component, no undefined derivation:

| component | stdev | CRITIC weight (Phase 4) | CRITIC weight (Phase 3) |
| --- | --- | --- | --- |
| `existing_burden` | 0.2478450057 | 0.19496656 | 0.172 |
| `air_impact_proxy` | 0.2428171354 | 0.20300160 | 0.211 |
| `resident_impact` | **0.2825879389** | **0.35245768** | **0.361** |
| `land_conversion` | 0.2491524413 | 0.24957415 | 0.256 |

**Viability is not validity, and Phase 4 establishes it is not valid.**

1. **CRITIC's σ term measures normalization and grain, not information.** The four
   components reach a candidate-level distribution by **three different mechanisms**:
   candidate-grain percentile rank (`resident_impact`, near-uniform by construction),
   region-grain percentile rank over 57–59 values projected onto candidates
   (`existing_burden`, `air_impact_proxy`, lumpy and driven by how many candidates
   each region holds), and bounded ratio (`land_conversion`, naturally skewed). The
   component with the highest σ — and therefore the highest weight — is the one
   normalized in the way that maximises σ.
2. **§4.1 proves the mechanism directly.** Switching one component's strategy moves
   its σ by 11.9% while leaving the ranking identical at Spearman 0.9999988. A
   weighting method that responds to a change which provably carries no ranking
   information is measuring the wrong thing.
3. **The weights moved when only the data was corrected.** Same run, same method:
   `resident_impact` 0.361 → 0.35246, `existing_burden` 0.172 → 0.19497. CRITIC
   tracks the data's shape, not a siting judgement.

**Decision.** CRITIC is retained as a **diagnostic**. No CRITIC vector may be
persisted, served, or used to score a successor run. Recorded as the new activation
blocker `SUCCESSOR_CRITIC_UNSUITABLE_FOR_WEIGHTING`. **No replacement weighting
method is approved**, which closes the data-derived route to weights entirely.

The historical CRITIC was never reused: `critic.compute_critic_weights` iterates the
historical `CRITERION_ORDER` literal and cannot accept successor component keys.

### 4.3 Final weights — **OPEN POLICY**

**No weight vector is approved.** Equal weights are used in this phase strictly as a
**neutral reference** for perturbation — never as a proposal, default, or registered
profile. `SUCCESSOR_WEIGHT_PROFILES` remains `{}`.

**RESEARCH DIAGNOSTIC — sensitivity on the corrected complete case (n = 33,980),
baseline = equal weights:**

| perturbation | Spearman | top-10 | top-50 |
| --- | --- | --- | --- |
| equal weights vs research CRITIC | 0.9222 | **0/10** | **12/50** |
| +0.05 → `existing_burden` | 0.9960 | 10/10 | 49/50 |
| **+0.15 → `existing_burden`** | 0.9731 | 10/10 | **49/50** |
| +0.05 → `air_impact_proxy` | 0.9936 | 9/10 | 49/50 |
| **+0.15 → `air_impact_proxy`** | 0.9535 | 5/10 | **44/50** |
| +0.05 → `resident_impact` | 0.9835 | 7/10 | 41/50 |
| **+0.15 → `resident_impact`** | 0.8523 | **0/10** | **1/50** |
| +0.05 → `land_conversion` | 0.9919 | 9/10 | 48/50 |
| **+0.15 → `land_conversion`** | 0.9338 | 8/10 | **44/50** |

**FACT — the instability is sharply asymmetric, which Phase 3 could not see.** Phase 3
concluded "the ranking head is entirely weight-determined". On corrected data the
truer statement is narrower and more useful: **the ranking head is
`resident_impact`-determined.** Moving 0.15 onto `resident_impact` retains **1 of
50**; the identical shift onto any other component retains **44–49 of 50**.

That is the same component whose percentile-rank normalization inflates its CRITIC
weight to the largest of the four. The two problems compound: the method most likely
to be reached for would assign the largest weight to the one component that can
single-handedly rewrite the ranking.

**RESEARCH DIAGNOSTIC — regional concentration.** Under equal weights the top 50 sits
in two Seoul districts: 광진구 29, 서대문구 20, 양평군 1. Any weight decision must be
argued against this concentration, not only against rank-stability metrics.

**Decision: weights remain OPEN.** The data-derived route is closed (§4.2) and no
interpretive argument for any particular vector has been established. A vector chosen
now would be choosing a ranking. **This is the primary reason Phase 4 returns NOT
READY FOR PHASE 5.**

### 4.4 Stability contract — **DEFERRED (defined, not satisfiable)**

The historical stability class is **not inherited**: it is defined over
zoning/road/equity/demand and the historical weight-profile registry, and the
successor has no profile registry at all.

Defined in `policy.STABILITY_CONTRACT_DESIGN`. Metrics: Spearman · top-10 overlap ·
top-50 overlap · regional concentration of the top 50 · eligible-population delta.
Perturbation axes and their measured run-47 behaviour:

| axis | measured behaviour |
| --- | --- |
| weights | asymmetric — see §4.3 |
| resident floor | scale-dependent — 33/50 on the component, 49/50 in the composite (§3.4) |
| normalization | rank-neutral, weight-decisive — Spearman 0.9999988, σ +11.9% (§4.1) |
| missingness / eligibility | strict 33,980; +0 / +758 / +4,612 per variant, groups not exchangeable (§3.2) |

**Acceptance thresholds are deliberately UNSET.** A stability classification needs an
approved reference weight vector to perturb around; setting thresholds now would fix
the target to whatever the current data happens to produce.

---

## 5. Phase 4D — version and runtime policy (designed, NOT activated)

Recorded in `policy.SUCCESSOR_RUNTIME_DESIGN`, status `DESIGNED_NOT_ACTIVATED`.

**Successor model version.** `component_model_version = "suitability-components-successor-v1"`.
`SUCCESSOR_POLICY_VERSION` and `SUCCESSOR_DERIVATION_VERSION` stay **`None`** —
unmintable until every activation blocker closes, so no run row can carry a
plausible-looking successor identity by accident. `component_model_version` must
become part of the signed analysis signature, because `policy_version` and
`derivation_version` have both already moved for reasons unrelated to component
identity and neither can answer "which components produced this run?".

**Scenario versions.** A stored scenario must record the `component_model_version` it
was authored against; one authored under a different model is surfaced as
incompatible, never silently recombined. Historical four-weight scenarios must never
be positionally re-read as successor weights — `translate_weights_by_position` exists
to refuse exactly that. Successor user-weight scenarios stay refused while no weight
vector is approved.

**Coexistence.** Historical and successor runs coexist as peers in one table,
distinguished by `component_model_version`. Historical runs keep the four legacy
`*_score` columns as their sole authoritative storage; successor runs write
`component_scores` and leave the legacy columns NULL. Neither reads the other's
storage, and no historical score is ever copied into `component_scores`. Every stored
historical run stays byte-identical and fully interpretable.

**Default-run resolution.** Today it selects the latest succeeded run regardless of
component model, so **the first successful successor run would silently switch every
default view and every un-pinned shared link to a different model.** Resolution must
become component-model-aware, and that change must ship **before** the first
successor run is written, not with it. Which model is the configured default is a
product decision and remains open.

**Switchover.** (1) model-aware default-run resolution ships with the default pinned
to historical → (2) a successor run is written, reachable only by explicit run id →
(3) the successor result is reviewed against the historical one on the same grid →
(4) the default is moved by an explicit configuration change. Rollback of the default
is a configuration change; historical runs are untouched throughout, so it never
needs to restore or recompute anything.

**Persistence.** The additive schema (migrations `0022` run-level identity, `0023`
candidate-level `component_scores`) is already applied and unchanged by this phase.
Dropping `component_scores` stops being safe once the first successor run exists,
because those rows' legacy columns are NULL by design.

**API exposure.** A successor result must be labelled with its component model
wherever it is served, and a derived or coarser-geography input must be labelled as
derived. **Not implemented in this phase** — Phase 4 changes no frontend and no API
wording; this records the requirement any later exposure work must satisfy.

---

## 6. BEFORE vs AFTER — real-data matrix

Same snapshot throughout (alembic `0021`, run 47, 47,893 candidates, 79 SIGUNGU).
BEFORE is the committed Phase-3 evidence bundle
(`docs/research/phase3_evidence.json`); AFTER is
`docs/research/phase4_evidence.json`.

| measure | BEFORE (Phase 3) | AFTER (Phase 4) | Δ |
| --- | --- | --- | --- |
| candidates | 47,893 | 47,893 | — |
| SIGUNGU | 79 | 79 | — |
| candidates with SIGUNGU code | 47,340 | 47,340 | — (B19: expected geography) |
| `existing_burden` candidates | 47,340 (98.85%) | 41,804 (87.29%) | **−5,536** |
| `existing_burden` regions | 79 | **59** | −20 |
| `air_impact_proxy` candidates | 38,592 (80.58%) | 38,592 (80.58%) | — |
| `air_impact_proxy` regions | 57 | 57 | — |
| `resident_impact` candidates | 47,893 (100%) | 47,893 (100%) | — |
| `land_conversion` candidates | 28,853 (60.24%) | **40,506 (84.58%)** | **+11,653** |
| `land_conversion` non-genuine losses | 11,653 | **0** | −11,653 |
| **strict complete case** | **24,064 (50.25%)** | **33,980 (70.95%)** | **+9,916 (+20.70 pp)** |
| regions in the complete case | 57 | 57 | — |
| residents in the complete case | — | 19,958,650 (75.87%) | — |
| regions excluded | 22 | 22 | — |
| residents excluded | 6,349,306 (24.13%) | 6,349,306 (24.13%) | — |
| `percentile_ranks` at n = 47,893 | 267.450 s | **0.117 s** | **2,285×** |
| CRITIC viable | yes | yes | — |
| CRITIC `resident_impact` weight | 0.361 | 0.35246 | data-dependent |
| top-50 churn, +0.15 → `resident_impact` | 0/50 | **1/50** | reproduced |
| top-50 churn, +0.15 → other components | not measured | **44–49/50** | **new** |
| floor 500 m→5 km, component | 33/50 | 33/50 | reproduced |
| floor 500 m→5 km, composite | not measured | **49/50** | **new** |

**Recovered candidates: 11,653** (B16). **Net eligible gain: +9,916** — the recovery
minus the overlap with regions already excluded on other grounds. B17's tightening
withdrew 20 regions at **zero** cost to eligibility, because `air_impact_proxy`
already excluded the same 20.

The Phase-3 counterfactual predicted 50.25% → 70.95%. The measured result is
**exactly 70.95%**.

---

## 7. Verification

| check | result |
| --- | --- |
| Ruff `check` | **All checks passed** |
| mypy (project config, `src/waste_equity_backend`) | **Success: no issues found in 66 source files** |
| mypy `--strict src research` | **Success: no issues found in 80 source files** |
| focused suites (10 files + research) | **362 passed, 0 failed** |
| **full backend suite incl. PostGIS** | **1193 passed, 2 skipped, 0 failed** |
| **control: base `b915901`, identical empty DB** | **1154 passed, 2 skipped, 0 failed** |

**No regression.** +39 tests, all passing, zero failures on either side. The two runs
used two separately created, identically empty PostGIS 16-3.4 databases. (A first
invocation against a brand-new database produces setup errors on *both* the base and
this branch while the schema is created; both totals above are from the second run,
so the comparison is like-for-like.)

Focused counts: `test_successor_land_conversion` 44 · `test_successor_existing_burden`
23 · `test_suitability_policy` 38 · `test_successor_model_boundary` 37 ·
`test_successor_contract` 19 · `test_successor_air_impact_proxy` 21 ·
`test_successor_resident_impact` 33 · `test_successor_historical_compatibility` 24 ·
`test_suitability_scenario` 40 · `test_suitability_component_model` 30 ·
`research/tests` 53.

The PostGIS tier was run because this phase changes shared suitability runtime
(`policy.percentile_ranks` feeds the historical `equity` and `demand` scores).

---

## 8. Decision register — B1–B19

No blocker disappears silently.

| # | Blocker | Status | Basis |
| --- | --- | --- | --- |
| B1 | `SUCCESSOR_WEIGHT_VECTOR_UNAPPROVED` | **OPEN** | §4.3. Data-derived route closed by B8; ranking head is `resident_impact`-determined (+0.15 → 1/50 vs 44–49/50 elsewhere). |
| B2 | Missing-component eligibility policy | **POLICY DECIDED** | §3.2. `STRICT_ALL_COMPONENTS_REQUIRED`. Admitted groups differ by +31.31 / +23.39 on retained components. Cost 70.95% / 75.87% of residents. |
| B3 | `RESIDENT_IMPACT_DISTANCE_FLOOR_UNAPPROVED` | **OPEN** | §3.4. Decisive on the component (33/50), inert in the composite (49/50) — cannot be settled before B1. 2 km still not a default. |
| B4 | `LAND_COVER_DEVELOPED_CLASS_REGISTRY_UNAVAILABLE` | **OPEN** | §3.5. `PRODUCTION_REGISTRY` is still `None`. |
| B5 | Ambiguous land classes | **OPEN** | §3.6. 92.87% exposure; 620 인공나지 alone moves 24,411 cells. |
| B6 | `AIR_IMPACT_PROXY_GRAIN_AND_COVERAGE_UNRESOLVED` | **POLICY DECIDED** (scoring) / **DEFERRED** (root cause) | §3.3. Option A at scoring time; Option B rejected — it recovers 0 eligible candidates. Root cause is ingestion-level and unfixed: 22 regions, 6,349,306 residents. Numerator basis still OPEN. |
| B7 | `SUCCESSOR_NORMALIZATION_STRATEGY_UNAPPROVED` | **POLICY DECIDED** | §4.1. `BOUNDED_RATIO` where the raw is a bounded ratio, percentile rank elsewhere. Rank-equivalent (0.9999988) but σ +11.9%. |
| B8 | Successor CRITIC contract | **POLICY DECIDED** | §4.2. **CRITIC is diagnostic only and unsuitable for weighting.** New blocker `SUCCESSOR_CRITIC_UNSUITABLE_FOR_WEIGHTING`. |
| B9 | Successor stability contract | **DEFERRED** | §4.4. Metrics and axes defined and measured; thresholds unset pending B1. |
| B10 | Scenario version behaviour | **DEFERRED** | §5. Designed; successor scenario recombination still refused. |
| B11 | Production model-version behaviour | **DEFERRED** | §5. Designed; `SUCCESSOR_POLICY_VERSION` / `SUCCESSOR_DERIVATION_VERSION` remain `None`. |
| B12 | `SUCCESSOR_DEFAULT_RUN_RESOLUTION_UNDECIDED` | **DEFERRED** | §5. Model-aware resolution designed and required *before* the first successor write. Which model is default is a product decision. |
| B13 | Historical / successor coexistence | **DEFERRED** | §5. Mechanism designed and asserted (disjoint namespaces, untouched historical CRITIC order); coexistence *policy* still a product decision. |
| B14 | Production switchover strategy | **DEFERRED** | §5. Four-step sequence with configuration-only rollback. |
| B15 | `SUCCESSOR_RUN_WRITE_PATH_NOT_IMPLEMENTED` | **OPEN (unchanged)** | Nothing written. Schema `0022`/`0023` applied; the analysis DB is at `0021`. |
| B16 | `land_conversion` float/Decimal boundary | **RESOLVED** | §2.1. Relative tolerance `1e-9`; **+11,653 candidates**; 11 boundary tests. |
| B17 | `existing_burden` zeros are partly a geocoding gap | **RESOLVED** | §2.2. `UnmappedFacilityEvidence`; 99 rows / 1,907,717.3 t/yr; 79 → 59 regions; 5 genuine zeros retained. |
| B18 | `PERCENTILE_RANK` is O(n²) | **RESOLVED** | §2.3. 267.450 s → 0.117 s (2,285×), byte-identical, oracle-pinned. |
| B19 | 553 candidates have no SIGUNGU code | **RESOLVED** (expected geography) | §2.4. Inter-layer boundary gap; 0 are `ELIGIBLE`; no code fabricated. |

Statuses used: **RESOLVED** (defect fixed or question answered) · **POLICY DECIDED**
(choice made on evidence) · **DEFERRED** (designed/defined, deliberately not applied)
· **OPEN** (evidence does not support an answer).

---

## 9. Invariants confirmed

* **Frontend untouched.** No file under `frontend/` is changed.
* **Historical Z/R/E/D untouched.** No historical component formula, weight,
  profile, threshold, distance curve, CRITIC vector, stability class, or stored value
  is changed. `percentile_ranks` was made faster with byte-identical output, pinned
  against the original body kept verbatim as a test oracle, and the full PostGIS
  suite passes.
* **Successor NOT ACTIVATED.** `is_activated()` is `False`;
  `SUCCESSOR_POLICY_VERSION` and `SUCCESSOR_DERIVATION_VERSION` are `None`;
  `SUCCESSOR_WEIGHT_PROFILES` is `{}`; `PRODUCTION_REGISTRY` is `None`;
  `validate_successor_policy()` raises if an OPEN Phase-4 decision ever coexists with
  activation.
* **No production contact.** No production query, credential, deployment config, or
  raw database dump. No migration added. Read-only local PostGIS only.
* **Missing never equals zero**, at every point examined, and now at two more.

---

## 10. Final gate

| # | Question | Answer |
| --- | --- | --- |
| 1 | Correctness blockers required for scoring resolved? | **Yes** — B16, B17, B18, B19 |
| 2 | Component coverage acceptable under the chosen policy? | **With explicit limitation** — 70.95% of candidates, 75.87% of residents; 24.13% structurally excluded |
| 3 | Missing-data behaviour explicit? | **Yes** — STRICT, zero-fill permanently forbidden |
| 4 | Resident floor explicit? | **No — OPEN** |
| 5 | Land registry explicit? | **No — OPEN** |
| 6 | Normalization explicit? | **Yes** |
| 7 | Final weights explicit? | **No — OPEN** |
| 8 | CRITIC policy explicit? | **Yes** — diagnostic only |
| 9 | Stability policy explicit? | **Partially** — defined and measured; thresholds deferred |
| 10 | Model-version behaviour explicit? | **Designed, not activated** |
| 11 | Can historical and successor coexist safely? | **Yes, by design and by assertion** — policy still deferred |
| 12 | Ready for runtime implementation? | **No** |

### Recommendation

> **NOT READY FOR PHASE 5.**

Four mandatory gates are OPEN: **final weights (B1)**, **resident distance floor
(B3)**, **land-cover class registry (B4)**, and **ambiguous land classes (B5)**.
Weights are the binding one — Phase 4 closed the data-derived route by establishing
that CRITIC is unsuitable, and no interpretive argument for any vector has been made.

### Verdict

> **PHASE 4 GREEN WITH EXPLICIT LIMITATION.**

Green: every correctness blocker is resolved with tests and re-measured on real data;
the eligible population rose 50.25% → 70.95%; four policy questions are decided on
evidence; the runtime and version behaviour is designed; nothing is activated.

The limitation: **24.13% of capital-region residents remain outside the model** on an
ingestion-level defect that scoring policy cannot fix, and the ranking head is
determined by a single component whose weight, distance floor, and normalization
interact in ways no approved contract yet governs.

**Phase 5 must not begin automatically.**
